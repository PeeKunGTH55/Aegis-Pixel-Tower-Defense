import { ALL_HERO_IDS, getUnlockedLoadoutSlots, HERO_CATALOG } from "./catalog";
import { replaySimulation } from "./engine";
import { nextRng } from "./prng";
import {
  BattleConfig,
  GameCommand,
  HeroId,
  LeaderboardEntry,
  PlayerProfile,
} from "./types";

export const GACHA_PULL_COST = 100;
export const LEGENDARY_PITY_THRESHOLD = 10;

export function createDefaultProfile(): PlayerProfile {
  return {
    playerLevel: 2,
    xp: 0,
    metaCoins: 300,
    pityCounter: 0,
    unlockedStages: 1,
    ownedHeroes: {
      archer: 1,
      pyromancer: 1,
      frostmage: 1,
      thunderlord: 0,
      paladin: 0,
      chronoweaver: 0,
    },
    loadout: ["archer", "pyromancer", "frostmage"],
    leaderboard: [
      {
        id: "seed-entry-1",
        playerName: "Commander Aria",
        stageId: 1,
        waveReached: 14,
        score: 6420,
        skillCasts: 11,
        seed: 202610,
        loadout: ["archer", "pyromancer", "frostmage", "paladin"],
        commandCount: 19,
        verifiedDeterministic: true,
        createdAtIso: "2026-10-29T00:00:00.000Z",
      },
      {
        id: "seed-entry-2",
        playerName: "Tactician Kael",
        stageId: 1,
        waveReached: 12,
        score: 4890,
        skillCasts: 7,
        seed: 778899,
        loadout: ["archer", "pyromancer", "frostmage"],
        commandCount: 14,
        verifiedDeterministic: true,
        createdAtIso: "2026-10-29T00:00:00.000Z",
      },
    ],
  };
}

export interface GachaPullOutcome {
  readonly ok: boolean;
  readonly reason?: "INSUFFICIENT_COINS";
  readonly profile: PlayerProfile;
  readonly pulledHeroId?: HeroId;
  readonly isDuplicate?: boolean;
  readonly newStarLevel?: number;
}

export function pullGachaWithSeed(
  profile: PlayerProfile,
  rngSeed: number
): GachaPullOutcome {
  if (profile.metaCoins < GACHA_PULL_COST) {
    return { ok: false, reason: "INSUFFICIENT_COINS", profile };
  }

  const nextPity = profile.pityCounter + 1;
  const step1 = nextRng(rngSeed);
  const step2 = nextRng(step1.nextState);

  let pool: readonly HeroId[];
  let resetPity = false;

  if (nextPity >= LEGENDARY_PITY_THRESHOLD || step1.value < 0.16) {
    pool = ALL_HERO_IDS.filter((id) => HERO_CATALOG[id].rarity === "LEGENDARY");
    resetPity = true;
  } else if (step1.value < 0.52) {
    pool = ALL_HERO_IDS.filter((id) => HERO_CATALOG[id].rarity === "ELITE");
  } else {
    pool = ALL_HERO_IDS.filter((id) => HERO_CATALOG[id].rarity === "COMMON");
  }

  const pickIndex = Math.min(pool.length - 1, Math.floor(step2.value * pool.length));
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
      pityCounter: resetPity ? 0 : nextPity,
      ownedHeroes: nextOwned,
      loadout: nextLoadout,
    },
    pulledHeroId,
    isDuplicate,
    newStarLevel,
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

  const earnedCoins =
    (params.victory ? 160 : 35) + verifiedWave * 18 + totalSkillCasts * 10;
  const earnedXp = (params.victory ? 120 : 40) + verifiedWave * 15;
  const totalXp = profile.xp + earnedXp;
  const levelUps = Math.floor(totalXp / 150);
  const nextLevel = Math.min(5, profile.playerLevel + levelUps);
  const remainingXp = totalXp % 150;

  const nextUnlockedStages =
    params.victory && params.config.stageId >= profile.unlockedStages
      ? Math.min(3, profile.unlockedStages + 1)
      : profile.unlockedStages;

  let nextLeaderboard = [...profile.leaderboard];
  if (params.config.mode === "ENDLESS" || verifiedWave >= 1 || verifiedScore > 0) {
    const entry: LeaderboardEntry = {
      id: `run-${params.config.seed}-${Date.now()}`,
      playerName: params.playerName,
      stageId: params.config.stageId,
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
      .slice(0, 10);
  }

  return {
    ...profile,
    playerLevel: nextLevel,
    xp: remainingXp,
    metaCoins: profile.metaCoins + earnedCoins,
    unlockedStages: nextUnlockedStages,
    leaderboard: nextLeaderboard,
  };
}
