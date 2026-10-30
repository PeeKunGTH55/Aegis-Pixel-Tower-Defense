import {
  ALL_HERO_IDS,
  DIFFICULTY_MULTIPLIERS,
  getUnlockedLoadoutSlots,
  HERO_CATALOG,
} from "./catalog";
import { replaySimulation } from "./engine";
import { nextRng } from "./prng";
import {
  BattleConfig,
  GameCommand,
  HeroId,
  HeroRarity,
  LeaderboardEntry,
  PlayerProfile,
  StageDifficulty,
} from "./types";

export const GACHA_PULL_COST = 100;
export const RARE_PITY_THRESHOLD = 10;
export const ULTRA_RARE_PITY_THRESHOLD = 20;
export const LEGENDARY_PITY_THRESHOLD = ULTRA_RARE_PITY_THRESHOLD;

export function stageDifficultyKey(
  stageId: number,
  difficulty: StageDifficulty
): string {
  return `${stageId}:${difficulty}`;
}

export function isStageDifficultyUnlocked(
  profile: PlayerProfile,
  stageId: number,
  difficulty: StageDifficulty
): boolean {
  return Boolean(
    profile.unlockedStageDifficulties[stageDifficultyKey(stageId, difficulty)]
  );
}

export function applyStageVictoryUnlocks(
  unlockedMap: Readonly<Record<string, boolean>>,
  stageId: number,
  difficulty: StageDifficulty
): Readonly<Record<string, boolean>> {
  const next: Record<string, boolean> = {
    ...unlockedMap,
    [stageDifficultyKey(stageId, difficulty)]: true,
  };
  if (difficulty === "EASY") {
    next[stageDifficultyKey(stageId, "MEDIUM")] = true;
    if (stageId < 10) {
      next[stageDifficultyKey(stageId + 1, "EASY")] = true;
    }
  } else if (difficulty === "MEDIUM") {
    next[stageDifficultyKey(stageId, "HARD")] = true;
  }
  return next;
}

export function createDefaultProfile(username = "Commander"): PlayerProfile {
  const initialOwned: Record<HeroId, number> = {} as Record<HeroId, number>;
  for (const id of ALL_HERO_IDS) {
    initialOwned[id] = 0;
  }
  initialOwned.archer = 1;
  initialOwned.frostarcher = 1;
  initialOwned.pyromancer = 1;
  initialOwned.frostmage = 1;

  return {
    username,
    tutorialCompleted: false,
    tutorialStep: 1,
    playerLevel: 2,
    xp: 0,
    metaCoins: 400,
    pityCounter: 0,
    rarePityCounter: 0,
    unlockedStages: 1,
    unlockedStageDifficulties: {
      "1:EASY": true,
    },
    ownedHeroes: initialOwned,
    loadout: ["archer", "pyromancer", "frostmage"],
    leaderboard: [
      {
        id: "seed-entry-1",
        playerName: "Aria_Vanguard",
        stageId: 1,
        difficulty: "HARD",
        waveReached: 16,
        score: 8420,
        skillCasts: 14,
        seed: 202610,
        loadout: ["archer", "pyromancer", "frostmage", "paladin"],
        commandCount: 22,
        verifiedDeterministic: true,
        createdAtIso: "2026-10-30T00:00:00.000Z",
      },
      {
        id: "seed-entry-2",
        playerName: "Kael_Riftwalker",
        stageId: 1,
        difficulty: "MEDIUM",
        waveReached: 12,
        score: 5190,
        skillCasts: 9,
        seed: 778899,
        loadout: ["archer", "pyromancer", "frostmage"],
        commandCount: 15,
        verifiedDeterministic: true,
        createdAtIso: "2026-10-30T00:00:00.000Z",
      },
    ],
  };
}

export interface GachaPullOutcome {
  readonly ok: boolean;
  readonly reason?: "INSUFFICIENT_COINS";
  readonly profile: PlayerProfile;
  readonly pulledHeroId?: HeroId;
  readonly pulledRarity?: HeroRarity;
  readonly isDuplicate?: boolean;
  readonly newStarLevel?: number;
  readonly nextRngSeed?: number;
}

export function pullGachaWithSeed(
  profile: PlayerProfile,
  rngSeed: number
): GachaPullOutcome {
  if (profile.metaCoins < GACHA_PULL_COST) {
    return { ok: false, reason: "INSUFFICIENT_COINS", profile };
  }

  const nextUltraPity = profile.pityCounter + 1;
  const nextRarePity = (profile.rarePityCounter ?? 0) + 1;
  const step1 = nextRng(rngSeed);
  const step2 = nextRng(step1.nextState);

  let chosenRarity: HeroRarity;
  let resetUltraPity = false;
  let resetRarePity = false;

  if (nextUltraPity >= ULTRA_RARE_PITY_THRESHOLD || step1.value < 0.04) {
    chosenRarity = "ULTRA_RARE";
    resetUltraPity = true;
    resetRarePity = true;
  } else if (nextRarePity >= RARE_PITY_THRESHOLD || step1.value < 0.17) {
    chosenRarity = "RARE";
    resetRarePity = true;
  } else if (step1.value < 0.45) {
    chosenRarity = "UNCOMMON";
  } else {
    chosenRarity = "COMMON";
  }

  const pool = ALL_HERO_IDS.filter(
    (id) => HERO_CATALOG[id].rarity === chosenRarity
  );
  const pickIndex = Math.min(
    pool.length - 1,
    Math.floor(step2.value * pool.length)
  );
  const pulledHeroId = pool[pickIndex] ?? "archer";
  const currentStars = profile.ownedHeroes[pulledHeroId] ?? 0;
  const isDuplicate = currentStars > 0;
  const newStarLevel = Math.min(5, currentStars + 1);

  const nextOwned: Record<HeroId, number> = {
    ...profile.ownedHeroes,
    [pulledHeroId]: newStarLevel,
  };

  const unlockedSlots = getUnlockedLoadoutSlots(profile.playerLevel);
  const nextLoadout = [...profile.loadout];
  if (!nextLoadout.includes(pulledHeroId) && nextLoadout.length < unlockedSlots) {
    nextLoadout.push(pulledHeroId);
  }

  return {
    ok: true,
    profile: {
      ...profile,
      metaCoins: profile.metaCoins - GACHA_PULL_COST,
      pityCounter: resetUltraPity ? 0 : nextUltraPity,
      rarePityCounter: resetRarePity ? 0 : nextRarePity,
      ownedHeroes: nextOwned,
      loadout: nextLoadout,
    },
    pulledHeroId,
    pulledRarity: chosenRarity,
    isDuplicate,
    newStarLevel,
    nextRngSeed: step2.nextState,
  };
}

export function pullGachaBatchWithSeed(
  profile: PlayerProfile,
  count: 1 | 10,
  rngSeed: number
): {
  readonly ok: boolean;
  readonly reason?: "INSUFFICIENT_COINS";
  readonly profile: PlayerProfile;
  readonly results: readonly {
    readonly heroId: HeroId;
    readonly rarity: HeroRarity;
    readonly isDuplicate: boolean;
    readonly newStarLevel: number;
  }[];
} {
  if (profile.metaCoins < GACHA_PULL_COST * count) {
    return { ok: false, reason: "INSUFFICIENT_COINS", profile, results: [] };
  }
  let currentProfile = profile;
  let currentSeed = rngSeed;
  const results: {
    readonly heroId: HeroId;
    readonly rarity: HeroRarity;
    readonly isDuplicate: boolean;
    readonly newStarLevel: number;
  }[] = [];

  for (let i = 0; i < count; i++) {
    const out = pullGachaWithSeed(currentProfile, currentSeed);
    if (!out.ok || !out.pulledHeroId || !out.pulledRarity) break;
    currentProfile = out.profile;
    currentSeed = out.nextRngSeed ?? currentSeed + 997;
    results.push({
      heroId: out.pulledHeroId,
      rarity: out.pulledRarity,
      isDuplicate: Boolean(out.isDuplicate),
      newStarLevel: out.newStarLevel ?? 1,
    });
  }

  return {
    ok: true,
    profile: currentProfile,
    results,
  };
}

export function toggleHeroInLoadout(
  profile: PlayerProfile,
  heroId: HeroId
): { readonly ok: boolean; readonly message: string; readonly profile: PlayerProfile } {
  const stars = profile.ownedHeroes[heroId] ?? 0;
  if (stars <= 0) {
    return { ok: false, message: "ยังไม่ได้ปลดล็อก Hero ตัวนี้", profile };
  }

  if (profile.loadout.includes(heroId)) {
    if (profile.loadout.length <= 1) {
      return { ok: false, message: "ต้องมี Hero ในทีมอย่างน้อย 1 ตัว", profile };
    }
    return {
      ok: true,
      message: `นำ ${HERO_CATALOG[heroId].name} ออกจากทีม`,
      profile: {
        ...profile,
        loadout: profile.loadout.filter((id) => id !== heroId),
      },
    };
  }

  const maxSlots = getUnlockedLoadoutSlots(profile.playerLevel);
  if (profile.loadout.length >= maxSlots) {
    return {
      ok: false,
      message: `ช่องจัดทีมเต็มแล้ว (${maxSlots}/${maxSlots}) อัปเลเวลผู้เล่นเพื่อปลดล็อกสูงสุด 6 ช่อง`,
      profile,
    };
  }

  return {
    ok: true,
    message: `เพิ่ม ${HERO_CATALOG[heroId].name} เข้าทีม (${profile.loadout.length + 1}/${maxSlots})`,
    profile: {
      ...profile,
      loadout: [...profile.loadout, heroId],
    },
  };
}

export function completeAccountTutorial(profile: PlayerProfile): PlayerProfile {
  if (profile.tutorialCompleted) {
    return { ...profile, tutorialStep: 0 };
  }
  return {
    ...profile,
    tutorialCompleted: true,
    tutorialStep: 0,
    metaCoins: profile.metaCoins + 200,
  };
}

export function awardBattleCompletion(
  profile: PlayerProfile,
  params: {
    readonly playerName: string;
    readonly config: BattleConfig;
    readonly finalTick: number;
    readonly waveReached: number;
    readonly victory: boolean;
    readonly commandLog: readonly GameCommand[];
  }
): PlayerProfile {
  const replayed = replaySimulation(
    params.config,
    params.commandLog,
    params.finalTick
  );
  const verifiedScore = replayed.score;
  const verifiedWave = Math.max(params.waveReached, replayed.wave);
  const totalSkillCasts = replayed.deployedHeroes.reduce(
    (sum, h) => sum + h.totalSkillCasts,
    0
  );
  const difficulty = params.config.difficulty ?? "EASY";
  const diffMult = DIFFICULTY_MULTIPLIERS[difficulty].rewardMultiplier;

  const earnedCoins = Math.round(
    ((params.victory ? 160 : 35) + verifiedWave * 18 + totalSkillCasts * 10) *
      diffMult
  );
  const earnedXp = Math.round(
    ((params.victory ? 120 : 40) + verifiedWave * 15) * diffMult
  );
  const totalXp = profile.xp + earnedXp;
  const levelUps = Math.floor(totalXp / 150);
  const nextLevel = Math.min(5, profile.playerLevel + levelUps);
  const remainingXp = totalXp % 150;

  let nextUnlockedMap = profile.unlockedStageDifficulties;
  let nextUnlockedStages = profile.unlockedStages;
  if (params.victory) {
    nextUnlockedMap = applyStageVictoryUnlocks(
      profile.unlockedStageDifficulties,
      params.config.stageId,
      difficulty
    );
    if (difficulty === "EASY" && params.config.stageId >= profile.unlockedStages) {
      nextUnlockedStages = Math.min(10, params.config.stageId + 1);
    }
  }

  let nextLeaderboard = [...profile.leaderboard];
  if (params.config.mode === "ENDLESS" || verifiedWave >= 1 || verifiedScore > 0) {
    const entry: LeaderboardEntry = {
      id: `run-${params.config.seed}-${Date.now()}`,
      playerName: params.playerName || profile.username,
      stageId: params.config.stageId,
      difficulty,
      waveReached: verifiedWave,
      score: verifiedScore,
      skillCasts: totalSkillCasts,
      seed: params.config.seed,
      loadout: params.config.loadout,
      commandCount: params.commandLog.length,
      verifiedDeterministic: true,
      createdAtIso: new Date().toISOString(),
    };
    nextLeaderboard = [...nextLeaderboard, entry]
      .sort((a, b) => b.score - a.score || b.waveReached - a.waveReached)
      .slice(0, 15);
  }

  return {
    ...profile,
    playerLevel: nextLevel,
    xp: remainingXp,
    metaCoins: profile.metaCoins + earnedCoins,
    unlockedStages: nextUnlockedStages,
    unlockedStageDifficulties: nextUnlockedMap,
    leaderboard: nextLeaderboard,
  };
}
