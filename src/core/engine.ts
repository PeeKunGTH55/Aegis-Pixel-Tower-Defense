import {
  computeActiveSynergies,
  DIFFICULTY_MULTIPLIERS,
  getStageWaypointsPx,
  getTileTerrainForStage,
  getUnlockedLoadoutSlots,
  HERO_CATALOG,
  isTileInBounds,
  STAGE_CATALOG,
  tileToWorldCenter,
} from "./catalog";
import { rngInt } from "./prng";
import {
  BattleConfig,
  BattlePhase,
  BattleState,
  CommandResult,
  DeployedHero,
  ElementalSynergyBonus,
  EnemySnapshot,
  EnemyTrait,
  GameCommand,
  HeroElement,
  HeroId,
  VisualFxEvent,
} from "./types";

interface PathSegment {
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly lengthPx: number;
  readonly startDistancePx: number;
}

interface StagePathData {
  readonly segments: readonly PathSegment[];
  readonly totalLengthPx: number;
}

const STAGE_PATH_CACHE = new Map<number, StagePathData>();

export function getStagePathData(stageId: number): StagePathData {
  const cached = STAGE_PATH_CACHE.get(stageId);
  if (cached) return cached;
  const waypoints = getStageWaypointsPx(stageId);
  const segments: PathSegment[] = [];
  let acc = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i]!;
    const b = waypoints[i + 1]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    segments.push({
      fromX: a.x,
      fromY: a.y,
      toX: b.x,
      toY: b.y,
      lengthPx: len,
      startDistancePx: acc,
    });
    acc += len;
  }
  const built: StagePathData = { segments, totalLengthPx: acc };
  STAGE_PATH_CACHE.set(stageId, built);
  return built;
}

export const TOTAL_PATH_LENGTH_PX = getStagePathData(1).totalLengthPx;

export function positionAlongStagePath(
  stageId: number,
  distancePx: number
): { readonly x: number; readonly y: number } {
  const pathData = getStagePathData(stageId);
  const waypoints = getStageWaypointsPx(stageId);
  const clamped = Math.max(0, Math.min(pathData.totalLengthPx, distancePx));
  for (const seg of pathData.segments) {
    if (clamped <= seg.startDistancePx + seg.lengthPx) {
      const local = seg.lengthPx > 0 ? (clamped - seg.startDistancePx) / seg.lengthPx : 0;
      return {
        x: Math.round(seg.fromX + (seg.toX - seg.fromX) * local),
        y: Math.round(seg.fromY + (seg.toY - seg.fromY) * local),
      };
    }
  }
  const last = waypoints[waypoints.length - 1]!;
  return { x: last.x, y: last.y };
}

export function positionAlongPath(distancePx: number): { readonly x: number; readonly y: number } {
  return positionAlongStagePath(1, distancePx);
}

export function isSynergyActive(
  synergies: readonly ElementalSynergyBonus[],
  element: HeroElement
): boolean {
  return synergies.some((s) => s.element === element && s.active);
}

export function getHeroUpgradeCost(heroId: HeroId, currentLevel: number): number {
  const def = HERO_CATALOG[heroId];
  return Math.round(def.upgradeBaseCost * Math.pow(1.45, currentLevel - 1));
}

export function getHeroEffectiveDamage(
  hero: DeployedHero,
  synergies?: readonly ElementalSynergyBonus[]
): number {
  const def = HERO_CATALOG[hero.heroId];
  const levelMultiplier = 1 + (hero.level - 1) * 0.35;
  const starMultiplier = 1 + (hero.stars - 1) * 0.18;
  let synMultiplier = 1.0;
  if (synergies) {
    if (def.element === "FLAME" && isSynergyActive(synergies, "FLAME")) {
      synMultiplier += 0.25;
    }
    if (isSynergyActive(synergies, "SOLAR")) {
      synMultiplier += 0.2;
    }
  }
  return Math.round(def.baseDamage * levelMultiplier * starMultiplier * synMultiplier);
}

export function getHeroSkillCooldownTicks(
  heroId: HeroId,
  stars: number,
  synergies?: readonly ElementalSynergyBonus[]
): number {
  const def = HERO_CATALOG[heroId];
  const starReduction = Math.min(0.32, (Math.max(1, stars) - 1) * 0.08);
  const stormBonus =
    synergies && isSynergyActive(synergies, "STORM") ? 0.2 : 0;
  const totalReduction = Math.min(0.48, starReduction + stormBonus);
  return Math.max(50, Math.round(def.skillCooldownTicks * (1 - totalReduction)));
}

export function getDeployCountForHero(state: BattleState, heroId: HeroId): number {
  let count = 0;
  for (const h of state.deployedHeroes) {
    if (h.heroId === heroId) {
      count += 1;
    }
  }
  return count;
}

export function createInitialBattleState(config: BattleConfig): BattleState {
  const unlockedSlots = getUnlockedLoadoutSlots(config.playerLevel);
  const uniqueLoadout: HeroId[] = [];
  for (const hId of config.loadout) {
    if (!uniqueLoadout.includes(hId) && uniqueLoadout.length < unlockedSlots) {
      uniqueLoadout.push(hId);
    }
  }
  const stageDef = STAGE_CATALOG.find((s) => s.id === config.stageId) ?? STAGE_CATALOG[0]!;
  return {
    config: {
      ...config,
      difficulty: config.difficulty ?? "EASY",
      loadout: uniqueLoadout,
    },
    rngState: config.seed >>> 0,
    tick: 0,
    phase: "PREPARING",
    wave: 0,
    maxWave: config.mode === "STAGE" ? 10 : 999,
    gold: stageDef.startingGold,
    baseHp: 20,
    maxBaseHp: 20,
    score: 0,
    totalKills: 0,
    nextEntityId: 1,
    waveSpawnRemaining: 0,
    nextSpawnTick: 0,
    waveCooldownUntilTick: 40,
    deployedHeroes: [],
    enemies: [],
    activeSynergies: computeActiveSynergies([]),
    commandLog: [],
    recentEvents: [],
  };
}

function buildEnemyForWave(
  state: BattleState,
  waveNumber: number,
  spawnIndex: number
): { readonly enemy: EnemySnapshot; readonly nextRngState: number } {
  const stageDef = STAGE_CATALOG.find((s) => s.id === state.config.stageId) ?? STAGE_CATALOG[0]!;
  const diffDef = DIFFICULTY_MULTIPLIERS[state.config.difficulty ?? "EASY"];
  const rollStep = rngInt(state.rngState, 0, 99);
  const roll = rollStep.result;

  const isBossSlot = spawnIndex === 0 && waveNumber % 5 === 0;
  let trait: EnemyTrait = "NORMAL";
  let archetypeName = "Rift Stalker";
  let hpMultiplier = 1.0;
  let speedPxPerTick = 1.35 * stageDef.speedScale * diffDef.speedMultiplier;
  let armor = 2 + Math.floor(waveNumber * 0.8);
  let rewardGold = 14 + Math.floor(waveNumber * 1.5);

  if (isBossSlot) {
    trait = "BOSS_SILENCER";
    archetypeName = "Void Warlord (Boss)";
    hpMultiplier = 4.2;
    speedPxPerTick = 0.88 * stageDef.speedScale * diffDef.speedMultiplier;
    armor = 12 + waveNumber * 2;
    rewardGold = 65 + waveNumber * 6;
  } else if (waveNumber >= 2 && roll < 28) {
    trait = "SWIFT";
    archetypeName = "Shadowhound";
    hpMultiplier = 0.72;
    speedPxPerTick = 2.15 * stageDef.speedScale * diffDef.speedMultiplier;
    armor = 1;
  } else if (waveNumber >= 3 && roll >= 28 && roll < 56) {
    trait = "ARMORED";
    archetypeName = "Iron Juggernaut";
    hpMultiplier = 1.85;
    speedPxPerTick = 0.95 * stageDef.speedScale * diffDef.speedMultiplier;
    armor = 10 + waveNumber * 2;
    rewardGold += 6;
  } else if (waveNumber >= 4 && roll >= 56 && roll < 76) {
    trait = "HEALER";
    archetypeName = "Abyssal Shaman";
    hpMultiplier = 1.15;
    speedPxPerTick = 1.2 * stageDef.speedScale * diffDef.speedMultiplier;
    armor = 4 + waveNumber;
    rewardGold += 5;
  }

  const endlessScale =
    waveNumber > 10 ? Math.pow(1.22, waveNumber - 10) : 1 + (waveNumber - 1) * 0.28;
  const baseWaveHp =
    68 *
    stageDef.hpScale *
    diffDef.hpMultiplier *
    endlessScale *
    (waveNumber > 10 ? 2.6 : 1.0);
  const maxHp = Math.max(30, Math.round(baseWaveHp * hpMultiplier));
  const waypoints = getStageWaypointsPx(stageDef.id);
  const startPos = waypoints[0]!;

  return {
    enemy: {
      instanceId: state.nextEntityId,
      archetypeName,
      trait,
      maxHp,
      hp: maxHp,
      armor,
      speedPxPerTick,
      rewardGold,
      scoreValue: Math.round(
        (isBossSlot ? 250 * waveNumber : 25 * waveNumber) * diffDef.rewardMultiplier
      ),
      pathDistancePx: 0,
      x: startPos.x,
      y: startPos.y,
      slowTicksRemaining: 0,
      slowFactor: 1,
      stunTicksRemaining: 0,
      burnTicksRemaining: 0,
      burnDamagePerTick: 0,
      abilityCooldownTicks: trait === "BOSS_SILENCER" ? 70 : 50,
    },
    nextRngState: rollStep.nextState,
  };
}

export function applyCommand(state: BattleState, command: GameCommand): CommandResult {
  if (state.phase === "VICTORY" || state.phase === "DEFEAT") {
    return { ok: false, reason: "BATTLE_ENDED", state };
  }

  const normalizedCommand: GameCommand = { ...command, tick: state.tick };

  switch (normalizedCommand.kind) {
    case "DEPLOY": {
      if (!state.config.loadout.includes(normalizedCommand.heroId)) {
        return { ok: false, reason: "HERO_NOT_IN_LOADOUT", state };
      }
      const { col, row } = normalizedCommand;
      if (!isTileInBounds(col, row)) {
        return { ok: false, reason: "TILE_OUT_OF_BOUNDS", state };
      }
      const terrain = getTileTerrainForStage(state.config.stageId, col, row);
      if (terrain === "PATH") {
        return { ok: false, reason: "TILE_IS_PATH", state };
      }
      const def = HERO_CATALOG[normalizedCommand.heroId];
      if (terrain !== def.placementDomain) {
        return { ok: false, reason: "TERRAIN_MISMATCH", state };
      }
      const tileOccupied = state.deployedHeroes.some(
        (h) => h.col === col && h.row === row
      );
      if (tileOccupied) {
        return { ok: false, reason: "TILE_OCCUPIED", state };
      }
      const currentCount = getDeployCountForHero(state, normalizedCommand.heroId);
      if (currentCount >= def.maxDeployCount) {
        return { ok: false, reason: "DEPLOY_CAP_REACHED", state };
      }
      if (state.gold < def.deployCost) {
        return { ok: false, reason: "INSUFFICIENT_GOLD", state };
      }

      const center = tileToWorldCenter(col, row);
      const stars = Math.max(1, state.config.heroStars[normalizedCommand.heroId] ?? 1);
      const newHero: DeployedHero = {
        instanceId: state.nextEntityId,
        heroId: normalizedCommand.heroId,
        col,
        row,
        x: center.x,
        y: center.y,
        level: 1,
        stars,
        targetPriority: "FIRST",
        nextAttackTick: state.tick + 5,
        skillReadyAtTick: state.tick + 30,
        silencedUntilTick: 0,
        hasteUntilTick: 0,
        totalDamageDealt: 0,
        totalSkillCasts: 0,
      };

      const nextDeployed = [...state.deployedHeroes, newHero];
      const nextSynergies = computeActiveSynergies(nextDeployed);

      const nextState: BattleState = {
        ...state,
        gold: state.gold - def.deployCost,
        nextEntityId: state.nextEntityId + 1,
        deployedHeroes: nextDeployed,
        activeSynergies: nextSynergies,
        commandLog: [...state.commandLog, normalizedCommand],
      };
      return {
        ok: true,
        state: nextState,
        eventText: `วาง ${def.name} [${def.element}] ที่ (${col},${row}) (${currentCount + 1}/${def.maxDeployCount})`,
      };
    }

    case "UPGRADE": {
      const target = state.deployedHeroes.find(
        (h) => h.instanceId === normalizedCommand.instanceId
      );
      if (!target) {
        return { ok: false, reason: "HERO_NOT_FOUND", state };
      }
      if (target.level >= 5) {
        return { ok: false, reason: "MAX_LEVEL_REACHED", state };
      }
      const cost = getHeroUpgradeCost(target.heroId, target.level);
      if (state.gold < cost) {
        return { ok: false, reason: "INSUFFICIENT_GOLD", state };
      }
      const updated = state.deployedHeroes.map((h) =>
        h.instanceId === target.instanceId ? { ...h, level: h.level + 1 } : h
      );
      return {
        ok: true,
        state: {
          ...state,
          gold: state.gold - cost,
          deployedHeroes: updated,
          commandLog: [...state.commandLog, normalizedCommand],
        },
        eventText: `อัปเกรด ${HERO_CATALOG[target.heroId].name} เป็น Lv.${target.level + 1}`,
      };
    }

    case "SELL": {
      const target = state.deployedHeroes.find(
        (h) => h.instanceId === normalizedCommand.instanceId
      );
      if (!target) {
        return { ok: false, reason: "HERO_NOT_FOUND", state };
      }
      const def = HERO_CATALOG[target.heroId];
      const refund = Math.round(def.deployCost * 0.7 + (target.level - 1) * def.upgradeBaseCost * 0.5);
      const nextDeployed = state.deployedHeroes.filter(
        (h) => h.instanceId !== target.instanceId
      );
      return {
        ok: true,
        state: {
          ...state,
          gold: state.gold + refund,
          deployedHeroes: nextDeployed,
          activeSynergies: computeActiveSynergies(nextDeployed),
          commandLog: [...state.commandLog, normalizedCommand],
        },
        eventText: `ถอน ${def.name} (+${refund} Gold)`,
      };
    }

    case "SET_TARGET": {
      const target = state.deployedHeroes.find(
        (h) => h.instanceId === normalizedCommand.instanceId
      );
      if (!target) {
        return { ok: false, reason: "HERO_NOT_FOUND", state };
      }
      return {
        ok: true,
        state: {
          ...state,
          deployedHeroes: state.deployedHeroes.map((h) =>
            h.instanceId === target.instanceId
              ? { ...h, targetPriority: normalizedCommand.priority }
              : h
          ),
          commandLog: [...state.commandLog, normalizedCommand],
        },
        eventText: `ตั้งเป้าเล็ง ${normalizedCommand.priority}`,
      };
    }

    case "CAST_SKILL": {
      const caster = state.deployedHeroes.find(
        (h) => h.instanceId === normalizedCommand.instanceId
      );
      if (!caster) {
        return { ok: false, reason: "HERO_NOT_FOUND", state };
      }
      const def = HERO_CATALOG[caster.heroId];
      if (state.tick < caster.skillReadyAtTick) {
        return { ok: false, reason: "SKILL_ON_COOLDOWN", state };
      }
      if (
        state.tick < caster.silencedUntilTick &&
        def.skillEffect.kind !== "SANCTUARY_CLEANSE"
      ) {
        return { ok: false, reason: "HERO_SILENCED", state };
      }

      const cooldown = getHeroSkillCooldownTicks(
        caster.heroId,
        caster.stars,
        state.activeSynergies
      );
      const baseDmg = getHeroEffectiveDamage(caster, state.activeSynergies);
      const flameSynergy = isSynergyActive(state.activeSynergies, "FLAME");
      let updatedEnemies = [...state.enemies];
      let updatedHeroes = state.deployedHeroes.map((h) =>
        h.instanceId === caster.instanceId
          ? {
              ...h,
              skillReadyAtTick: state.tick + cooldown,
              totalSkillCasts: h.totalSkillCasts + 1,
            }
          : h
      );
      const fxEvents: VisualFxEvent[] = [...state.recentEvents];
      let bonusDamageDealt = 0;

      const effect = def.skillEffect;
      switch (effect.kind) {
        case "ARROW_VOLLEY": {
          const sorted = [...updatedEnemies].sort(
            (a, b) => b.pathDistancePx - a.pathDistancePx
          );
          const targets = sorted.slice(0, effect.hits);
          const hitIds = new Set(targets.map((t) => t.instanceId));
          const burstDmg = Math.round(baseDmg * effect.damageMultiplier);
          updatedEnemies = updatedEnemies.map((e) => {
            if (!hitIds.has(e.instanceId)) return e;
            const dealt = Math.max(8, burstDmg - Math.floor(e.armor * 0.4));
            bonusDamageDealt += dealt;
            fxEvents.push({
              tick: state.tick,
              kind: "SKILL_BURST",
              fromX: caster.x,
              fromY: caster.y,
              toX: e.x,
              toY: e.y,
              color: def.palette.accent,
              label: def.skillName,
            });
            return { ...e, hp: e.hp - dealt };
          });
          break;
        }
        case "METEOR_STRIKE": {
          const lead = [...updatedEnemies].sort(
            (a, b) => b.pathDistancePx - a.pathDistancePx
          )[0];
          const centerX = lead ? lead.x : caster.x;
          const centerY = lead ? lead.y : caster.y;
          const burstDmg = Math.round(baseDmg * effect.damageMultiplier);
          const burnScale = flameSynergy ? 0.27 : 0.18;
          fxEvents.push({
            tick: state.tick,
            kind: "SKILL_BURST",
            fromX: caster.x,
            fromY: caster.y,
            toX: centerX,
            toY: centerY,
            color: def.palette.primary,
            label: def.skillName,
          });
          updatedEnemies = updatedEnemies.map((e) => {
            const dist = Math.hypot(e.x - centerX, e.y - centerY);
            if (dist > effect.radiusPx) return e;
            const dealt = Math.max(12, burstDmg - Math.floor(e.armor * 0.25));
            bonusDamageDealt += dealt;
            return {
              ...e,
              hp: e.hp - dealt,
              burnTicksRemaining: Math.max(e.burnTicksRemaining, effect.burnTicks),
              burnDamagePerTick: Math.max(
                e.burnDamagePerTick,
                Math.round(baseDmg * burnScale)
              ),
            };
          });
          break;
        }
        case "ABSOLUTE_ZERO": {
          const burstDmg = Math.round(baseDmg * 1.6);
          fxEvents.push({
            tick: state.tick,
            kind: "SKILL_BURST",
            fromX: caster.x,
            fromY: caster.y,
            toX: 360,
            toY: 234,
            color: def.palette.primary,
            label: def.skillName,
          });
          updatedEnemies = updatedEnemies.map((e) => {
            bonusDamageDealt += burstDmg;
            return {
              ...e,
              hp: e.hp - burstDmg,
              stunTicksRemaining: Math.max(e.stunTicksRemaining, effect.freezeTicks),
              slowTicksRemaining: Math.max(e.slowTicksRemaining, effect.freezeTicks + 60),
              slowFactor: 1 - effect.slowPercent / 100,
            };
          });
          break;
        }
        case "CHAIN_OVERLOAD": {
          const sorted = [...updatedEnemies].sort((a, b) => b.hp - a.hp);
          const hitIds = new Set(sorted.slice(0, effect.bounces).map((t) => t.instanceId));
          const burstDmg = Math.round(baseDmg * effect.damageMultiplier);
          updatedEnemies = updatedEnemies.map((e) => {
            if (!hitIds.has(e.instanceId)) return e;
            bonusDamageDealt += burstDmg;
            fxEvents.push({
              tick: state.tick,
              kind: "SKILL_BURST",
              fromX: caster.x,
              fromY: caster.y,
              toX: e.x,
              toY: e.y,
              color: def.palette.primary,
              label: def.skillName,
            });
            return {
              ...e,
              hp: e.hp - burstDmg,
              stunTicksRemaining: Math.max(e.stunTicksRemaining, effect.stunTicks),
            };
          });
          break;
        }
        case "SANCTUARY_CLEANSE": {
          fxEvents.push({
            tick: state.tick,
            kind: "SKILL_BURST",
            fromX: caster.x,
            fromY: caster.y,
            toX: caster.x,
            toY: caster.y,
            color: def.palette.primary,
            label: def.skillName,
          });
          updatedHeroes = updatedHeroes.map((h) => ({
            ...h,
            silencedUntilTick: 0,
            hasteUntilTick: Math.max(h.hasteUntilTick, state.tick + effect.buffDurationTicks),
          }));
          break;
        }
        case "TIME_WARP": {
          fxEvents.push({
            tick: state.tick,
            kind: "SKILL_BURST",
            fromX: caster.x,
            fromY: caster.y,
            toX: 360,
            toY: 234,
            color: def.palette.primary,
            label: def.skillName,
          });
          updatedEnemies = updatedEnemies.map((e) => {
            const nextDist = Math.max(0, e.pathDistancePx - effect.rewindProgress);
            const pos = positionAlongStagePath(state.config.stageId, nextDist);
            const warpDmg = Math.round(baseDmg * 1.8);
            bonusDamageDealt += warpDmg;
            return {
              ...e,
              hp: e.hp - warpDmg,
              pathDistancePx: nextDist,
              x: pos.x,
              y: pos.y,
            };
          });
          updatedHeroes = updatedHeroes.map((h) => ({
            ...h,
            hasteUntilTick: Math.max(h.hasteUntilTick, state.tick + effect.globalHasteTicks),
          }));
          break;
        }
      }

      let gainedGold = 0;
      let gainedScore = 35;
      let gainedKills = 0;
      const survivingEnemies: EnemySnapshot[] = [];
      for (const e of updatedEnemies) {
        if (e.hp <= 0) {
          gainedGold += e.rewardGold;
          gainedScore += e.scoreValue;
          gainedKills += 1;
        } else {
          survivingEnemies.push(e);
        }
      }

      updatedHeroes = updatedHeroes.map((h) =>
        h.instanceId === caster.instanceId
          ? { ...h, totalDamageDealt: h.totalDamageDealt + bonusDamageDealt }
          : h
      );

      return {
        ok: true,
        state: {
          ...state,
          gold: state.gold + gainedGold,
          score: state.score + gainedScore,
          totalKills: state.totalKills + gainedKills,
          deployedHeroes: updatedHeroes,
          enemies: survivingEnemies,
          commandLog: [...state.commandLog, normalizedCommand],
          recentEvents: fxEvents.slice(-16),
        },
        eventText: `ใช้สกิล ${def.skillName}!`,
      };
    }

    case "START_WAVE": {
      if (state.phase === "WAVE_ACTIVE") {
        return { ok: false, reason: "WAVE_ALREADY_ACTIVE", state };
      }
      const nextWave = state.wave + 1;
      const earlyBonus =
        state.wave > 0 && state.tick < state.waveCooldownUntilTick ? 25 : 0;
      const spawnCount = 6 + Math.min(14, Math.floor(nextWave * 1.4));
      return {
        ok: true,
        state: {
          ...state,
          phase: "WAVE_ACTIVE",
          wave: nextWave,
          gold: state.gold + earlyBonus,
          score: state.score + earlyBonus * 2,
          waveSpawnRemaining: spawnCount,
          nextSpawnTick: state.tick + 4,
          commandLog: [...state.commandLog, normalizedCommand],
        },
        eventText: `เริ่ม Wave ${nextWave}${earlyBonus > 0 ? ` (+${earlyBonus} Gold โบนัสเรียกไว)` : ""}`,
      };
    }
  }
}

function selectEnemyTarget(
  hero: DeployedHero,
  candidates: readonly EnemySnapshot[]
): EnemySnapshot | undefined {
  if (candidates.length === 0) return undefined;
  const sorted = [...candidates];
  switch (hero.targetPriority) {
    case "FIRST":
      sorted.sort((a, b) => b.pathDistancePx - a.pathDistancePx);
      return sorted[0];
    case "STRONGEST":
      sorted.sort((a, b) => b.hp - a.hp || b.pathDistancePx - a.pathDistancePx);
      return sorted[0];
    case "WEAKEST":
      sorted.sort((a, b) => a.hp - b.hp || b.pathDistancePx - a.pathDistancePx);
      return sorted[0];
    case "CLOSEST":
      sorted.sort(
        (a, b) =>
          Math.hypot(a.x - hero.x, a.y - hero.y) -
          Math.hypot(b.x - hero.x, b.y - hero.y)
      );
      return sorted[0];
  }
}

export function stepSimulationTick(state: BattleState): BattleState {
  if (state.phase === "VICTORY" || state.phase === "DEFEAT") {
    return state;
  }

  const nextTick = state.tick + 1;
  let rngState = state.rngState;
  let nextEntityId = state.nextEntityId;
  let phase: BattlePhase = state.phase;
  let wave = state.wave;
  let gold = state.gold;
  let baseHp = state.baseHp;
  let score = state.score;
  let totalKills = state.totalKills;
  let waveSpawnRemaining = state.waveSpawnRemaining;
  let nextSpawnTick = state.nextSpawnTick;
  let waveCooldownUntilTick = state.waveCooldownUntilTick;
  let deployedHeroes = [...state.deployedHeroes];
  let enemies = [...state.enemies];
  const fxEvents: VisualFxEvent[] = [];
  const stagePathData = getStagePathData(state.config.stageId);
  const frostSynergy = isSynergyActive(state.activeSynergies, "FROST");
  const stormSynergy = isSynergyActive(state.activeSynergies, "STORM");
  const solarSynergy = isSynergyActive(state.activeSynergies, "SOLAR");

  if (phase === "PREPARING" && nextTick >= waveCooldownUntilTick && wave > 0) {
    const started = applyCommand({ ...state, tick: nextTick }, { kind: "START_WAVE", tick: nextTick });
    if (started.ok) {
      return started.state;
    }
  }

  if (phase === "WAVE_ACTIVE" && waveSpawnRemaining > 0 && nextTick >= nextSpawnTick) {
    const built = buildEnemyForWave(
      { ...state, rngState, nextEntityId },
      wave,
      waveSpawnRemaining - 1
    );
    rngState = built.nextRngState;
    nextEntityId += 1;
    enemies.push(built.enemy);
    waveSpawnRemaining -= 1;
    nextSpawnTick = nextTick + Math.max(8, 18 - Math.floor(wave * 0.5));
  }

  const movedEnemies: EnemySnapshot[] = [];
  for (const enemy of enemies) {
    let hp = enemy.hp;
    const burnTicksRemaining = Math.max(0, enemy.burnTicksRemaining - 1);
    if (enemy.burnTicksRemaining > 0 && nextTick % 5 === 0) {
      hp -= enemy.burnDamagePerTick;
    }

    let abilityCooldownTicks = enemy.abilityCooldownTicks - 1;
    if (enemy.trait === "HEALER" && abilityCooldownTicks <= 0) {
      abilityCooldownTicks = 55;
      hp = Math.min(enemy.maxHp, hp + Math.round(enemy.maxHp * 0.08));
    } else if (enemy.trait === "BOSS_SILENCER" && abilityCooldownTicks <= 0) {
      abilityCooldownTicks = 85;
      fxEvents.push({
        tick: nextTick,
        kind: "BOSS_PULSE",
        fromX: enemy.x,
        fromY: enemy.y,
        toX: enemy.x,
        toY: enemy.y,
        color: 0xef4444,
        label: "VOID SILENCE",
      });
      deployedHeroes = deployedHeroes.map((h) => {
        const dist = Math.hypot(h.x - enemy.x, h.y - enemy.y);
        if (dist <= 165) {
          return { ...h, silencedUntilTick: Math.max(h.silencedUntilTick, nextTick + 45) };
        }
        return h;
      });
    }

    const stunTicksRemaining = Math.max(0, enemy.stunTicksRemaining - 1);
    const slowTicksRemaining = Math.max(0, enemy.slowTicksRemaining - 1);
    const activeSlowFactor = slowTicksRemaining > 0 ? enemy.slowFactor : 1;
    const stepDistance =
      stunTicksRemaining > 0 ? 0 : enemy.speedPxPerTick * activeSlowFactor;
    const nextDistance = enemy.pathDistancePx + stepDistance;

    if (nextDistance >= stagePathData.totalLengthPx) {
      const leakDamage = enemy.trait === "BOSS_SILENCER" ? 4 : 1;
      baseHp = Math.max(0, baseHp - leakDamage);
      fxEvents.push({
        tick: nextTick,
        kind: "BASE_DAMAGE",
        fromX: enemy.x,
        fromY: enemy.y,
        toX: enemy.x,
        toY: enemy.y,
        color: 0xef4444,
      });
      continue;
    }

    const pos = positionAlongStagePath(state.config.stageId, nextDistance);
    movedEnemies.push({
      ...enemy,
      hp,
      pathDistancePx: nextDistance,
      x: pos.x,
      y: pos.y,
      stunTicksRemaining,
      slowTicksRemaining,
      slowFactor: activeSlowFactor,
      burnTicksRemaining,
      abilityCooldownTicks,
    });
  }
  enemies = movedEnemies;

  if (baseHp <= 0) {
    return {
      ...state,
      rngState,
      tick: nextTick,
      phase: "DEFEAT",
      baseHp: 0,
      enemies,
      deployedHeroes,
      recentEvents: fxEvents,
    };
  }

  deployedHeroes = deployedHeroes.map((hero) => {
    if (nextTick < hero.nextAttackTick || nextTick < hero.silencedUntilTick) {
      return hero;
    }
    const def = HERO_CATALOG[hero.heroId];
    const effectiveRange =
      def.element === "FROST" && frostSynergy
        ? Math.round(def.rangePx * 1.15)
        : def.rangePx;
    const inRange = enemies.filter(
      (e) => e.hp > 0 && Math.hypot(e.x - hero.x, e.y - hero.y) <= effectiveRange
    );
    const primaryTarget = selectEnemyTarget(hero, inRange);
    if (!primaryTarget) {
      return hero;
    }

    const rawDmg = getHeroEffectiveDamage(hero, state.activeSynergies);
    let heroDealt = 0;

    enemies = enemies.map((e) => {
      const isPrimary = e.instanceId === primaryTarget.instanceId;
      const inSplash =
        def.splashRadiusPx > 0 &&
        Math.hypot(e.x - primaryTarget.x, e.y - primaryTarget.y) <= def.splashRadiusPx;
      if (!isPrimary && !inSplash) return e;

      const splashScale = isPrimary ? 1.0 : 0.65;
      const armorMitigation = Math.floor(e.armor * 0.45);
      const dealt = Math.max(4, Math.round(rawDmg * splashScale) - armorMitigation);
      heroDealt += dealt;

      const applySlow = def.slowPercent > 0;
      const extraSlow = frostSynergy ? 12 : 0;
      return {
        ...e,
        hp: e.hp - dealt,
        slowTicksRemaining: applySlow
          ? Math.max(e.slowTicksRemaining, def.slowTicks)
          : e.slowTicksRemaining,
        slowFactor: applySlow
          ? Math.min(e.slowFactor, Math.max(0.25, 1 - (def.slowPercent + extraSlow) / 100))
          : e.slowFactor,
      };
    });

    fxEvents.push({
      tick: nextTick,
      kind: "PROJECTILE",
      fromX: hero.x,
      fromY: hero.y,
      toX: primaryTarget.x,
      toY: primaryTarget.y,
      color: def.palette.accent,
    });

    const hasteMultiplier = nextTick < hero.hasteUntilTick ? 0.62 : 1.0;
    const stormSpeedMultiplier =
      def.element === "STORM" && stormSynergy ? 0.85 : 1.0;
    const interval = Math.max(
      5,
      Math.round(def.attackIntervalTicks * hasteMultiplier * stormSpeedMultiplier)
    );
    return {
      ...hero,
      nextAttackTick: nextTick + interval,
      totalDamageDealt: hero.totalDamageDealt + heroDealt,
    };
  });

  const aliveAfterCombat: EnemySnapshot[] = [];
  for (const e of enemies) {
    if (e.hp <= 0) {
      gold += e.rewardGold;
      score += e.scoreValue;
      totalKills += 1;
    } else {
      aliveAfterCombat.push(e);
    }
  }
  enemies = aliveAfterCombat;

  if (phase === "WAVE_ACTIVE" && waveSpawnRemaining === 0 && enemies.length === 0) {
    const solarBonus = solarSynergy ? 25 : 0;
    const waveClearGold = 35 + wave * 8 + solarBonus;
    gold += waveClearGold;
    score += 120 * wave;
    if (state.config.mode === "STAGE" && wave >= state.maxWave) {
      phase = "VICTORY";
    } else {
      phase = "PREPARING";
      waveCooldownUntilTick = nextTick + 70;
    }
  }

  return {
    ...state,
    rngState,
    tick: nextTick,
    phase,
    wave,
    gold,
    baseHp,
    score,
    totalKills,
    nextEntityId,
    waveSpawnRemaining,
    nextSpawnTick,
    waveCooldownUntilTick,
    deployedHeroes,
    enemies,
    recentEvents: fxEvents.slice(-16),
  };
}

export function replaySimulation(
  config: BattleConfig,
  commandLog: readonly GameCommand[],
  maxTicks: number
): BattleState {
  let state = createInitialBattleState(config);
  const commandsByTick = new Map<number, GameCommand[]>();
  for (const cmd of commandLog) {
    const bucket = commandsByTick.get(cmd.tick) ?? [];
    bucket.push(cmd);
    commandsByTick.set(cmd.tick, bucket);
  }

  const zeroTickCmds = commandsByTick.get(0) ?? [];
  for (const cmd of zeroTickCmds) {
    const res = applyCommand(state, cmd);
    state = res.state;
  }

  for (let t = 1; t <= maxTicks; t++) {
    state = stepSimulationTick(state);
    const cmds = commandsByTick.get(state.tick);
    if (cmds) {
      for (const cmd of cmds) {
        const res = applyCommand(state, cmd);
        state = res.state;
      }
    }
    if (state.phase === "VICTORY" || state.phase === "DEFEAT") {
      break;
    }
  }
  return state;
}
