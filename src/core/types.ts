export type DeployCap = 1 | 2 | 6;

export type HeroRarity = "COMMON" | "ELITE" | "LEGENDARY";

export type HeroRole = "SINGLE_DPS" | "AOE_BLAST" | "CROWD_CONTROL" | "SUPPORT_CLEANSE";

export type TargetPriority = "FIRST" | "STRONGEST" | "CLOSEST" | "WEAKEST";

export type TileTerrain = "PATH" | "GROUND" | "HIGH_GROUND";

export type HeroPlacementDomain = "GROUND" | "HIGH_GROUND";

export type HeroId =
  | "archer"
  | "pyromancer"
  | "frostmage"
  | "thunderlord"
  | "paladin"
  | "chronoweaver";

export type ActiveSkillKind =
  | {
      readonly kind: "ARROW_VOLLEY";
      readonly hits: number;
      readonly damageMultiplier: number;
    }
  | {
      readonly kind: "METEOR_STRIKE";
      readonly radiusPx: number;
      readonly damageMultiplier: number;
      readonly burnTicks: number;
    }
  | {
      readonly kind: "ABSOLUTE_ZERO";
      readonly slowPercent: number;
      readonly freezeTicks: number;
    }
  | {
      readonly kind: "CHAIN_OVERLOAD";
      readonly bounces: number;
      readonly damageMultiplier: number;
      readonly stunTicks: number;
    }
  | {
      readonly kind: "SANCTUARY_CLEANSE";
      readonly buffAttackSpeedPercent: number;
      readonly buffDurationTicks: number;
    }
  | {
      readonly kind: "TIME_WARP";
      readonly rewindProgress: number;
      readonly globalHasteTicks: number;
    };

export interface HeroDefinition {
  readonly id: HeroId;
  readonly name: string;
  readonly titleThai: string;
  readonly rarity: HeroRarity;
  readonly role: HeroRole;
  readonly placementDomain: HeroPlacementDomain;
  readonly maxDeployCount: DeployCap;
  readonly deployCost: number;
  readonly upgradeBaseCost: number;
  readonly baseDamage: number;
  readonly attackIntervalTicks: number;
  readonly rangePx: number;
  readonly splashRadiusPx: number;
  readonly slowPercent: number;
  readonly slowTicks: number;
  readonly skillName: string;
  readonly skillDescThai: string;
  readonly skillCooldownTicks: number;
  readonly skillEffect: ActiveSkillKind;
  readonly palette: {
    readonly primary: number;
    readonly secondary: number;
    readonly accent: number;
  };
}

export type EnemyTrait = "NORMAL" | "SWIFT" | "ARMORED" | "HEALER" | "BOSS_SILENCER";

export interface EnemySnapshot {
  readonly instanceId: number;
  readonly archetypeName: string;
  readonly trait: EnemyTrait;
  readonly maxHp: number;
  readonly hp: number;
  readonly armor: number;
  readonly speedPxPerTick: number;
  readonly rewardGold: number;
  readonly scoreValue: number;
  readonly pathDistancePx: number;
  readonly x: number;
  readonly y: number;
  readonly slowTicksRemaining: number;
  readonly slowFactor: number;
  readonly stunTicksRemaining: number;
  readonly burnTicksRemaining: number;
  readonly burnDamagePerTick: number;
  readonly abilityCooldownTicks: number;
}

export interface DeployedHero {
  readonly instanceId: number;
  readonly heroId: HeroId;
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly stars: number;
  readonly targetPriority: TargetPriority;
  readonly nextAttackTick: number;
  readonly skillReadyAtTick: number;
  readonly silencedUntilTick: number;
  readonly hasteUntilTick: number;
  readonly totalDamageDealt: number;
  readonly totalSkillCasts: number;
}

export type BattleMode = "STAGE" | "ENDLESS";

export type BattlePhase = "PREPARING" | "WAVE_ACTIVE" | "VICTORY" | "DEFEAT";

export type GameCommand =
  | {
      readonly kind: "DEPLOY";
      readonly tick: number;
      readonly heroId: HeroId;
      readonly col: number;
      readonly row: number;
    }
  | {
      readonly kind: "UPGRADE";
      readonly tick: number;
      readonly instanceId: number;
    }
  | {
      readonly kind: "SELL";
      readonly tick: number;
      readonly instanceId: number;
    }
  | {
      readonly kind: "SET_TARGET";
      readonly tick: number;
      readonly instanceId: number;
      readonly priority: TargetPriority;
    }
  | {
      readonly kind: "CAST_SKILL";
      readonly tick: number;
      readonly instanceId: number;
    }
  | {
      readonly kind: "START_WAVE";
      readonly tick: number;
    };

export type CommandRejectionReason =
  | "BATTLE_ENDED"
  | "HERO_NOT_IN_LOADOUT"
  | "TILE_OUT_OF_BOUNDS"
  | "TILE_IS_PATH"
  | "TERRAIN_MISMATCH"
  | "TILE_OCCUPIED"
  | "DEPLOY_CAP_REACHED"
  | "INSUFFICIENT_GOLD"
  | "HERO_NOT_FOUND"
  | "MAX_LEVEL_REACHED"
  | "HERO_SILENCED"
  | "SKILL_ON_COOLDOWN"
  | "WAVE_ALREADY_ACTIVE";

export type CommandResult =
  | { readonly ok: true; readonly state: BattleState; readonly eventText: string }
  | { readonly ok: false; readonly reason: CommandRejectionReason; readonly state: BattleState };

export interface VisualFxEvent {
  readonly tick: number;
  readonly kind: "PROJECTILE" | "SKILL_BURST" | "ENEMY_HIT" | "BOSS_PULSE" | "BASE_DAMAGE";
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly color: number;
  readonly label?: string;
}

export interface BattleConfig {
  readonly seed: number;
  readonly stageId: number;
  readonly mode: BattleMode;
  readonly playerLevel: number;
  readonly loadout: readonly HeroId[];
  readonly heroStars: Readonly<Record<HeroId, number>>;
}

export interface BattleState {
  readonly config: BattleConfig;
  readonly rngState: number;
  readonly tick: number;
  readonly phase: BattlePhase;
  readonly wave: number;
  readonly maxWave: number;
  readonly gold: number;
  readonly baseHp: number;
  readonly maxBaseHp: number;
  readonly score: number;
  readonly totalKills: number;
  readonly nextEntityId: number;
  readonly waveSpawnRemaining: number;
  readonly nextSpawnTick: number;
  readonly waveCooldownUntilTick: number;
  readonly deployedHeroes: readonly DeployedHero[];
  readonly enemies: readonly EnemySnapshot[];
  readonly commandLog: readonly GameCommand[];
  readonly recentEvents: readonly VisualFxEvent[];
}

export interface LeaderboardEntry {
  readonly id: string;
  readonly playerName: string;
  readonly stageId: number;
  readonly waveReached: number;
  readonly score: number;
  readonly skillCasts: number;
  readonly seed: number;
  readonly loadout: readonly HeroId[];
  readonly commandCount: number;
  readonly verifiedDeterministic: boolean;
  readonly createdAtIso: string;
}

export interface PlayerProfile {
  readonly playerLevel: number;
  readonly xp: number;
  readonly metaCoins: number;
  readonly pityCounter: number;
  readonly unlockedStages: number;
  readonly ownedHeroes: Readonly<Record<HeroId, number>>;
  readonly loadout: readonly HeroId[];
  readonly leaderboard: readonly LeaderboardEntry[];
}
