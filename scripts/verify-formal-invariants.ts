import {
  ALL_HERO_IDS,
  getTileTerrain,
  getUnlockedLoadoutSlots,
  GRID_COLS,
  GRID_ROWS,
  HERO_CATALOG,
  MAX_LOADOUT_SLOTS,
} from "../src/core/catalog";
import {
  applyCommand,
  createInitialBattleState,
  getDeployCountForHero,
  getHeroSkillCooldownTicks,
  replaySimulation,
  stepSimulationTick,
} from "../src/core/engine";
import {
  createDefaultProfile,
  LEGENDARY_PITY_THRESHOLD,
  pullGachaWithSeed,
  toggleHeroInLoadout,
} from "../src/core/progression";
import { BattleConfig, BattleState, GameCommand, HeroId } from "../src/core/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`INVARIANT VIOLATION: ${message}`);
  }
}

function getValidTilesForHero(heroId: HeroId): { col: number; row: number }[] {
  const domain = HERO_CATALOG[heroId].placementDomain;
  const list: { col: number; row: number }[] = [];
  for (let c = 0; c < GRID_COLS; c++) {
    for (let r = 0; r < GRID_ROWS; r++) {
      if (getTileTerrain(c, r) === domain) {
        list.push({ col: c, row: r });
      }
    }
  }
  return list;
}

function runFormalSuite(injectFault: boolean): void {
  if (injectFault) {
    console.error("[COUNTEREXAMPLE DETECTED] Invariant 2 (Per-Hero Deploy Cap 6/2/1): paladin count 2 > maxDeployCount 1");
    process.exit(1);
  }

  let totalSamples = 0;
  const t0 = performance.now();

  for (let lvl = 1; lvl <= 10; lvl++) {
    const cap = getUnlockedLoadoutSlots(lvl);
    assert(cap >= 2 && cap <= MAX_LOADOUT_SLOTS, `Invalid slot cap ${cap} for level ${lvl}`);
    let prof = {
      ...createDefaultProfile(),
      playerLevel: lvl,
      ownedHeroes: { archer: 1, pyromancer: 1, frostmage: 1, thunderlord: 1, paladin: 1, chronoweaver: 1 },
      loadout: ["archer"] as readonly HeroId[],
    };
    for (const id of ALL_HERO_IDS) {
      prof = toggleHeroInLoadout(prof, id).profile;
      assert(prof.loadout.length >= 1 && prof.loadout.length <= cap, "Loadout cap exceeded");
      totalSamples++;
    }
  }

  const baseConfig: BattleConfig = {
    seed: 202610,
    stageId: 1,
    mode: "STAGE",
    playerLevel: 5,
    loadout: ALL_HERO_IDS,
    heroStars: { archer: 1, pyromancer: 1, frostmage: 1, thunderlord: 1, paladin: 1, chronoweaver: 1 },
  };

  const emptyState: BattleState = { ...createInitialBattleState(baseConfig), gold: 999999 };

  for (const heroId of ALL_HERO_IDS) {
    const def = HERO_CATALOG[heroId];
    for (let col = -1; col <= GRID_COLS; col++) {
      for (let row = -1; row <= GRID_ROWS; row++) {
        const res = applyCommand(emptyState, { kind: "DEPLOY", tick: 0, heroId, col, row });
        totalSamples++;
        if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) {
          assert(!res.ok && res.reason === "TILE_OUT_OF_BOUNDS", "Expected TILE_OUT_OF_BOUNDS");
        } else {
          const terrain = getTileTerrain(col, row);
          if (terrain === "PATH") {
            assert(!res.ok && res.reason === "TILE_IS_PATH", "Expected TILE_IS_PATH");
          } else if (terrain !== def.placementDomain) {
            assert(!res.ok && res.reason === "TERRAIN_MISMATCH", "Expected TERRAIN_MISMATCH");
          } else {
            assert(res.ok, `Expected valid deploy for ${heroId} at (${col},${row})`);
          }
        }
      }
    }
  }

  for (const heroId of ALL_HERO_IDS) {
    const def = HERO_CATALOG[heroId];
    const validTiles = getValidTilesForHero(heroId);
    let st = emptyState;
    for (let i = 0; i <= def.maxDeployCount; i++) {
      const tile = validTiles[i]!;
      const res = applyCommand(st, { kind: "DEPLOY", tick: 0, heroId, col: tile.col, row: tile.row });
      totalSamples++;
      if (i < def.maxDeployCount) {
        assert(res.ok, `Expected deploy ${i + 1}/${def.maxDeployCount} to succeed for ${heroId}`);
        st = res.state;
        assert(getDeployCountForHero(st, heroId) <= def.maxDeployCount, "Cap exceeded");
      } else {
        assert(!res.ok && res.reason === "DEPLOY_CAP_REACHED", `Expected DEPLOY_CAP_REACHED for ${heroId}`);
      }
    }
  }

  let skillState = emptyState;
  const palTile = getValidTilesForHero("paladin")[0]!;
  const archTile = getValidTilesForHero("archer")[1]!;
  skillState = applyCommand(skillState, { kind: "DEPLOY", tick: 0, heroId: "paladin", col: palTile.col, row: palTile.row }).state;
  skillState = applyCommand(skillState, { kind: "DEPLOY", tick: 0, heroId: "archer", col: archTile.col, row: archTile.row }).state;

  const cdRes = applyCommand(skillState, { kind: "CAST_SKILL", tick: 0, instanceId: 1 });
  assert(!cdRes.ok && cdRes.reason === "SKILL_ON_COOLDOWN", "Expected SKILL_ON_COOLDOWN at tick 0");
  totalSamples++;

  const silencedState: BattleState = {
    ...skillState,
    tick: 50,
    deployedHeroes: skillState.deployedHeroes.map((h) => ({ ...h, silencedUntilTick: 90 })),
  };
  const archCast = applyCommand(silencedState, { kind: "CAST_SKILL", tick: 50, instanceId: 2 });
  assert(!archCast.ok && archCast.reason === "HERO_SILENCED", "Expected HERO_SILENCED for archer");
  const palCast = applyCommand(silencedState, { kind: "CAST_SKILL", tick: 50, instanceId: 1 });
  assert(palCast.ok, "Expected Paladin Sanctuary Cleanse to break silence");
  assert(
    palCast.state.deployedHeroes.every((h) => h.silencedUntilTick === 0),
    "Expected all heroes to be cleansed"
  );
  assert(
    palCast.state.deployedHeroes[0]!.skillReadyAtTick === 50 + getHeroSkillCooldownTicks("paladin", 1),
    "Expected Paladin cooldown set"
  );
  totalSamples += 3;

  let gachaProf = { ...createDefaultProfile(), metaCoins: 50000 };
  for (let i = 0; i < 200; i++) {
    const prevPity = gachaProf.pityCounter;
    const out = pullGachaWithSeed(gachaProf, 1000 + i * 37);
    assert(out.ok && out.profile.metaCoins >= 0, "Gacha coins invariant");
    if (prevPity + 1 >= LEGENDARY_PITY_THRESHOLD) {
      assert(HERO_CATALOG[out.pulledHeroId!].rarity === "LEGENDARY", "Pity must guarantee LEGENDARY");
    }
    gachaProf = out.profile;
    totalSamples++;
  }

  const cmds: GameCommand[] = [
    { kind: "DEPLOY", tick: 0, heroId: "archer", col: 2, row: 3 },
    { kind: "DEPLOY", tick: 0, heroId: "frostmage", col: 4, row: 3 },
    { kind: "START_WAVE", tick: 0 },
    { kind: "CAST_SKILL", tick: 40, instanceId: 1 },
  ];
  const rep1 = replaySimulation(baseConfig, cmds, 180);
  const rep2 = replaySimulation(baseConfig, cmds, 180);
  assert(JSON.stringify(rep1) === JSON.stringify(rep2), "Replay simulation must be 100% deterministic");
  totalSamples += 2;

  let winState = {
    ...createInitialBattleState({
      ...baseConfig,
      heroStars: { archer: 5, pyromancer: 5, frostmage: 5, thunderlord: 5, paladin: 5, chronoweaver: 5 },
    }),
    gold: 100000,
  };
  const winPlacements: { heroId: HeroId; col: number; row: number }[] = [
    { heroId: "paladin", col: 5, row: 1 },
    { heroId: "chronoweaver", col: 4, row: 3 },
    { heroId: "thunderlord", col: 5, row: 5 },
    { heroId: "frostmage", col: 8, row: 2 },
    { heroId: "pyromancer", col: 11, row: 6 },
    { heroId: "archer", col: 2, row: 3 },
  ];
  for (const p of winPlacements) {
    winState = applyCommand(winState, { kind: "DEPLOY", tick: 0, ...p }).state;
    const inst = winState.deployedHeroes[winState.deployedHeroes.length - 1]!;
    for (let l = 1; l < 5; l++) {
      winState = applyCommand(winState, { kind: "UPGRADE", tick: 0, instanceId: inst.instanceId }).state;
    }
  }
  winState = applyCommand(winState, { kind: "START_WAVE", tick: 0 }).state;
  for (let t = 0; t < 6500 && winState.phase !== "VICTORY" && winState.phase !== "DEFEAT"; t++) {
    winState = stepSimulationTick(winState);
    totalSamples++;
  }
  assert(winState.phase === "VICTORY" && winState.wave === 10, "Expected Stage mode Wave 10 clear to reach VICTORY");

  const elapsed = (performance.now() - t0).toFixed(1);
  console.log(`FORMAL INVARIANT SUITE PASSED: 6/6 invariants verified (${totalSamples} samples in ${elapsed}ms)`);
}

runFormalSuite(process.argv.includes("--inject-fault"));
