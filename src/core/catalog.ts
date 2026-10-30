import {
  ElementalSynergyBonus,
  HeroDefinition,
  HeroElement,
  HeroId,
  HeroRarity,
  StageDifficulty,
  TileTerrain,
} from "./types";

export const TICKS_PER_SECOND = 20;

export const MAX_LOADOUT_SLOTS = 6;

export function getUnlockedLoadoutSlots(playerLevel: number): number {
  const clampedLevel = Math.max(1, Math.floor(playerLevel));
  return Math.min(MAX_LOADOUT_SLOTS, 1 + clampedLevel);
}

export interface Point2D {
  readonly x: number;
  readonly y: number;
}

export interface GridCoord {
  readonly col: number;
  readonly row: number;
}

export const TILE_SIZE_PX = 36;
export const GRID_COLS = 20;
export const GRID_ROWS = 13;
export const MAP_WIDTH = GRID_COLS * TILE_SIZE_PX;
export const MAP_HEIGHT = GRID_ROWS * TILE_SIZE_PX;

export function tileToWorldCenter(col: number, row: number): Point2D {
  return {
    x: col * TILE_SIZE_PX + TILE_SIZE_PX / 2,
    y: row * TILE_SIZE_PX + TILE_SIZE_PX / 2,
  };
}

export function worldToTile(x: number, y: number): GridCoord {
  return {
    col: Math.floor(x / TILE_SIZE_PX),
    row: Math.floor(y / TILE_SIZE_PX),
  };
}

export function isTileInBounds(col: number, row: number): boolean {
  return (
    Number.isInteger(col) &&
    Number.isInteger(row) &&
    col >= 0 &&
    col < GRID_COLS &&
    row >= 0 &&
    row < GRID_ROWS
  );
}

export interface StageDefinition {
  readonly id: number;
  readonly name: string;
  readonly subtitleThai: string;
  readonly biomeName: string;
  readonly startingGold: number;
  readonly hpScale: number;
  readonly speedScale: number;
  readonly clearRewardCoins: number;
  readonly waypointTiles: readonly GridCoord[];
  readonly highGroundTiles: readonly GridCoord[];
  readonly biomeColors: {
    readonly groundA: number;
    readonly groundB: number;
    readonly pathFill: number;
    readonly pathBorder: number;
    readonly hgFill: number;
    readonly hgBorder: number;
  };
}

export const STAGE_CATALOG: readonly StageDefinition[] = [
  {
    id: 1,
    name: "Emerald Outpost",
    subtitleThai: "ด่าน 1: ชายแดนมรกต",
    biomeName: "EMERALD",
    startingGold: 320,
    hpScale: 1.0,
    speedScale: 1.0,
    clearRewardCoins: 150,
    waypointTiles: [
      { col: 0, row: 2 },
      { col: 6, row: 2 },
      { col: 6, row: 6 },
      { col: 3, row: 6 },
      { col: 3, row: 10 },
      { col: 12, row: 10 },
      { col: 12, row: 4 },
      { col: 16, row: 4 },
      { col: 16, row: 9 },
      { col: 19, row: 9 },
    ],
    highGroundTiles: [
      { col: 4, row: 3 },
      { col: 4, row: 4 },
      { col: 8, row: 2 },
      { col: 8, row: 3 },
      { col: 5, row: 8 },
      { col: 6, row: 8 },
      { col: 9, row: 8 },
      { col: 10, row: 8 },
      { col: 10, row: 5 },
      { col: 10, row: 6 },
      { col: 14, row: 2 },
      { col: 14, row: 6 },
      { col: 14, row: 7 },
      { col: 18, row: 6 },
      { col: 18, row: 7 },
    ],
    biomeColors: {
      groundA: 0x0f1a18,
      groundB: 0x13221f,
      pathFill: 0x26313a,
      pathBorder: 0x3b4d59,
      hgFill: 0x153147,
      hgBorder: 0x38bdf8,
    },
  },
  {
    id: 2,
    name: "Cinder Canyon",
    subtitleThai: "ด่าน 2: หุบเขาเถ้าถ่าน",
    biomeName: "CINDER",
    startingGold: 330,
    hpScale: 1.25,
    speedScale: 1.05,
    clearRewardCoins: 180,
    waypointTiles: [
      { col: 0, row: 6 },
      { col: 5, row: 6 },
      { col: 5, row: 2 },
      { col: 11, row: 2 },
      { col: 11, row: 10 },
      { col: 15, row: 10 },
      { col: 15, row: 5 },
      { col: 19, row: 5 },
    ],
    highGroundTiles: [
      { col: 3, row: 4 },
      { col: 7, row: 4 },
      { col: 8, row: 4 },
      { col: 9, row: 6 },
      { col: 9, row: 7 },
      { col: 13, row: 4 },
      { col: 13, row: 8 },
      { col: 17, row: 3 },
      { col: 17, row: 7 },
    ],
    biomeColors: {
      groundA: 0x1f1212,
      groundB: 0x261717,
      pathFill: 0x382624,
      pathBorder: 0x6e423c,
      hgFill: 0x3b1d2e,
      hgBorder: 0xf97316,
    },
  },
  {
    id: 3,
    name: "Glacier Ridge",
    subtitleThai: "ด่าน 3: สันเขาน้ำแข็งนิรันดร์",
    biomeName: "GLACIER",
    startingGold: 340,
    hpScale: 1.5,
    speedScale: 1.08,
    clearRewardCoins: 210,
    waypointTiles: [
      { col: 0, row: 1 },
      { col: 14, row: 1 },
      { col: 14, row: 5 },
      { col: 4, row: 5 },
      { col: 4, row: 9 },
      { col: 16, row: 9 },
      { col: 16, row: 11 },
      { col: 19, row: 11 },
    ],
    highGroundTiles: [
      { col: 6, row: 3 },
      { col: 7, row: 3 },
      { col: 10, row: 3 },
      { col: 11, row: 3 },
      { col: 7, row: 7 },
      { col: 8, row: 7 },
      { col: 11, row: 7 },
      { col: 12, row: 7 },
      { col: 17, row: 7 },
    ],
    biomeColors: {
      groundA: 0x0f1926,
      groundB: 0x142132,
      pathFill: 0x23354d,
      pathBorder: 0x4b6b94,
      hgFill: 0x1a3f5c,
      hgBorder: 0x67e8f9,
    },
  },
  {
    id: 4,
    name: "Thunder Steppe",
    subtitleThai: "ด่าน 4: ที่ราบอัสนีบาต",
    biomeName: "STORM",
    startingGold: 350,
    hpScale: 1.8,
    speedScale: 1.12,
    clearRewardCoins: 240,
    waypointTiles: [
      { col: 0, row: 10 },
      { col: 4, row: 10 },
      { col: 4, row: 3 },
      { col: 9, row: 3 },
      { col: 9, row: 9 },
      { col: 14, row: 9 },
      { col: 14, row: 2 },
      { col: 19, row: 2 },
    ],
    highGroundTiles: [
      { col: 2, row: 5 },
      { col: 6, row: 5 },
      { col: 6, row: 6 },
      { col: 11, row: 5 },
      { col: 11, row: 6 },
      { col: 16, row: 4 },
      { col: 16, row: 5 },
      { col: 17, row: 4 },
    ],
    biomeColors: {
      groundA: 0x171326,
      groundB: 0x1d1830,
      pathFill: 0x2d2647,
      pathBorder: 0x5b4d8c,
      hgFill: 0x33245c,
      hgBorder: 0xc084fc,
    },
  },
  {
    id: 5,
    name: "Obsidian Labyrinth",
    subtitleThai: "ด่าน 5: เขาวงกตหินนิล",
    biomeName: "OBSIDIAN",
    startingGold: 360,
    hpScale: 2.15,
    speedScale: 1.15,
    clearRewardCoins: 280,
    waypointTiles: [
      { col: 0, row: 6 },
      { col: 3, row: 6 },
      { col: 3, row: 1 },
      { col: 8, row: 1 },
      { col: 8, row: 11 },
      { col: 13, row: 11 },
      { col: 13, row: 1 },
      { col: 17, row: 1 },
      { col: 17, row: 7 },
      { col: 19, row: 7 },
    ],
    highGroundTiles: [
      { col: 5, row: 3 },
      { col: 5, row: 4 },
      { col: 5, row: 8 },
      { col: 10, row: 4 },
      { col: 10, row: 5 },
      { col: 10, row: 8 },
      { col: 15, row: 3 },
      { col: 15, row: 4 },
      { col: 15, row: 8 },
    ],
    biomeColors: {
      groundA: 0x11131a,
      groundB: 0x161922,
      pathFill: 0x272c3a,
      pathBorder: 0x475569,
      hgFill: 0x1e293b,
      hgBorder: 0x38bdf8,
    },
  },
  {
    id: 6,
    name: "Solar Sanctum",
    subtitleThai: "ด่าน 6: วิหารสุริยัน",
    biomeName: "SOLAR",
    startingGold: 375,
    hpScale: 2.55,
    speedScale: 1.18,
    clearRewardCoins: 320,
    waypointTiles: [
      { col: 0, row: 3 },
      { col: 10, row: 3 },
      { col: 10, row: 6 },
      { col: 2, row: 6 },
      { col: 2, row: 10 },
      { col: 15, row: 10 },
      { col: 15, row: 4 },
      { col: 19, row: 4 },
    ],
    highGroundTiles: [
      { col: 5, row: 1 },
      { col: 6, row: 1 },
      { col: 5, row: 8 },
      { col: 6, row: 8 },
      { col: 12, row: 5 },
      { col: 12, row: 8 },
      { col: 17, row: 6 },
      { col: 17, row: 7 },
    ],
    biomeColors: {
      groundA: 0x1f1910,
      groundB: 0x292115,
      pathFill: 0x3d311f,
      pathBorder: 0x85683a,
      hgFill: 0x473417,
      hgBorder: 0xfacc15,
    },
  },
  {
    id: 7,
    name: "Abyssal Causeway",
    subtitleThai: "ด่าน 7: สะพานข้ามห้วงเหว",
    biomeName: "ABYSS",
    startingGold: 390,
    hpScale: 3.0,
    speedScale: 1.2,
    clearRewardCoins: 360,
    waypointTiles: [
      { col: 0, row: 2 },
      { col: 4, row: 2 },
      { col: 4, row: 8 },
      { col: 8, row: 8 },
      { col: 8, row: 4 },
      { col: 12, row: 4 },
      { col: 12, row: 8 },
      { col: 16, row: 8 },
      { col: 16, row: 3 },
      { col: 19, row: 3 },
    ],
    highGroundTiles: [
      { col: 2, row: 5 },
      { col: 6, row: 5 },
      { col: 6, row: 6 },
      { col: 10, row: 6 },
      { col: 10, row: 7 },
      { col: 14, row: 5 },
      { col: 14, row: 6 },
      { col: 18, row: 6 },
    ],
    biomeColors: {
      groundA: 0x0d1322,
      groundB: 0x11192e,
      pathFill: 0x1e2c4c,
      pathBorder: 0x3b5998,
      hgFill: 0x19355c,
      hgBorder: 0x60a5fa,
    },
  },
  {
    id: 8,
    name: "Crimson Spire",
    subtitleThai: "ด่าน 8: หอคอยโลหิต",
    biomeName: "CRIMSON",
    startingGold: 410,
    hpScale: 3.5,
    speedScale: 1.24,
    clearRewardCoins: 410,
    waypointTiles: [
      { col: 0, row: 11 },
      { col: 7, row: 11 },
      { col: 7, row: 2 },
      { col: 12, row: 2 },
      { col: 12, row: 9 },
      { col: 17, row: 9 },
      { col: 17, row: 4 },
      { col: 19, row: 4 },
    ],
    highGroundTiles: [
      { col: 4, row: 8 },
      { col: 5, row: 8 },
      { col: 9, row: 4 },
      { col: 9, row: 5 },
      { col: 9, row: 7 },
      { col: 14, row: 5 },
      { col: 14, row: 6 },
      { col: 15, row: 6 },
    ],
    biomeColors: {
      groundA: 0x210e16,
      groundB: 0x2b131d,
      pathFill: 0x421d2b,
      pathBorder: 0x883352,
      hgFill: 0x4c1d3d,
      hgBorder: 0xf43f5e,
    },
  },
  {
    id: 9,
    name: "Chrono Nexus",
    subtitleThai: "ด่าน 9: จุดตัดกาลเวลา",
    biomeName: "CHRONO",
    startingGold: 430,
    hpScale: 4.1,
    speedScale: 1.28,
    clearRewardCoins: 460,
    waypointTiles: [
      { col: 0, row: 5 },
      { col: 6, row: 5 },
      { col: 6, row: 1 },
      { col: 15, row: 1 },
      { col: 15, row: 7 },
      { col: 9, row: 7 },
      { col: 9, row: 11 },
      { col: 18, row: 11 },
      { col: 18, row: 6 },
      { col: 19, row: 6 },
    ],
    highGroundTiles: [
      { col: 3, row: 3 },
      { col: 8, row: 3 },
      { col: 9, row: 3 },
      { col: 12, row: 4 },
      { col: 13, row: 4 },
      { col: 7, row: 9 },
      { col: 12, row: 9 },
      { col: 16, row: 9 },
    ],
    biomeColors: {
      groundA: 0x131929,
      groundB: 0x182036,
      pathFill: 0x263454,
      pathBorder: 0x4d69a6,
      hgFill: 0x2d2459,
      hgBorder: 0xe879f9,
    },
  },
  {
    id: 10,
    name: "Heart of the Void Rift",
    subtitleThai: "ด่าน 10: แกนกลางรอยแยกสุญญตา",
    biomeName: "VOID_HEART",
    startingGold: 460,
    hpScale: 4.8,
    speedScale: 1.32,
    clearRewardCoins: 600,
    waypointTiles: [
      { col: 0, row: 1 },
      { col: 5, row: 1 },
      { col: 5, row: 11 },
      { col: 10, row: 11 },
      { col: 10, row: 2 },
      { col: 15, row: 2 },
      { col: 15, row: 10 },
      { col: 19, row: 10 },
    ],
    highGroundTiles: [
      { col: 2, row: 4 },
      { col: 2, row: 7 },
      { col: 7, row: 5 },
      { col: 7, row: 6 },
      { col: 8, row: 5 },
      { col: 12, row: 5 },
      { col: 12, row: 6 },
      { col: 13, row: 6 },
      { col: 17, row: 5 },
      { col: 17, row: 6 },
    ],
    biomeColors: {
      groundA: 0x140d21,
      groundB: 0x1b122c,
      pathFill: 0x2e1f47,
      pathBorder: 0x6b46a8,
      hgFill: 0x3b1d5e,
      hgBorder: 0xa855f7,
    },
  },
];

export const PATH_WAYPOINT_TILES = STAGE_CATALOG[0]!.waypointTiles;
export const ENEMY_WAYPOINTS = PATH_WAYPOINT_TILES.map((t) => tileToWorldCenter(t.col, t.row));
export const HIGH_GROUND_TILES = STAGE_CATALOG[0]!.highGroundTiles;

const STAGE_TERRAIN_CACHE = new Map<
  number,
  {
    readonly pathSet: ReadonlySet<string>;
    readonly hgSet: ReadonlySet<string>;
    readonly waypointsPx: readonly Point2D[];
  }
>();

function getStageTerrainSets(stageId: number) {
  const cached = STAGE_TERRAIN_CACHE.get(stageId);
  if (cached) return cached;
  const stage = STAGE_CATALOG.find((s) => s.id === stageId) ?? STAGE_CATALOG[0]!;
  const pathSet = new Set<string>();
  for (let i = 0; i < stage.waypointTiles.length - 1; i++) {
    const a = stage.waypointTiles[i]!;
    const b = stage.waypointTiles[i + 1]!;
    const minC = Math.min(a.col, b.col);
    const maxC = Math.max(a.col, b.col);
    const minR = Math.min(a.row, b.row);
    const maxR = Math.max(a.row, b.row);
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        pathSet.add(`${c},${r}`);
      }
    }
  }
  const hgSet = new Set<string>();
  for (const t of stage.highGroundTiles) {
    const key = `${t.col},${t.row}`;
    if (!pathSet.has(key)) {
      hgSet.add(key);
    }
  }
  const built = {
    pathSet,
    hgSet,
    waypointsPx: stage.waypointTiles.map((t) => tileToWorldCenter(t.col, t.row)),
  };
  STAGE_TERRAIN_CACHE.set(stage.id, built);
  return built;
}

export function getStageWaypointsPx(stageId: number): readonly Point2D[] {
  return getStageTerrainSets(stageId).waypointsPx;
}

export function getTileTerrainForStage(
  stageId: number,
  col: number,
  row: number
): TileTerrain {
  const sets = getStageTerrainSets(stageId);
  const key = `${col},${row}`;
  if (sets.pathSet.has(key)) {
    return "PATH";
  }
  if (sets.hgSet.has(key)) {
    return "HIGH_GROUND";
  }
  return "GROUND";
}

export function getTileTerrain(col: number, row: number): TileTerrain {
  return getTileTerrainForStage(1, col, row);
}

export const DIFFICULTY_MULTIPLIERS: Readonly<
  Record<
    StageDifficulty,
    {
      readonly labelThai: string;
      readonly hpMultiplier: number;
      readonly speedMultiplier: number;
      readonly rewardMultiplier: number;
    }
  >
> = {
  EASY: {
    labelThai: "Easy (ปกติ)",
    hpMultiplier: 1.0,
    speedMultiplier: 1.0,
    rewardMultiplier: 1.0,
  },
  MEDIUM: {
    labelThai: "Medium (ท้าทาย)",
    hpMultiplier: 1.45,
    speedMultiplier: 1.12,
    rewardMultiplier: 1.5,
  },
  HARD: {
    labelThai: "Hard (นรกแตก)",
    hpMultiplier: 2.1,
    speedMultiplier: 1.24,
    rewardMultiplier: 2.25,
  },
};

export const RARITY_CONFIG: Readonly<
  Record<
    HeroRarity,
    {
      readonly label: string;
      readonly ratePercent: number;
      readonly colorHex: string;
      readonly deployCap: 1 | 2 | 4 | 6;
    }
  >
> = {
  COMMON: {
    label: "COMMON",
    ratePercent: 55,
    colorHex: "#22c55e",
    deployCap: 6,
  },
  UNCOMMON: {
    label: "UNCOMMON",
    ratePercent: 28,
    colorHex: "#38bdf8",
    deployCap: 4,
  },
  RARE: {
    label: "RARE",
    ratePercent: 13,
    colorHex: "#a855f7",
    deployCap: 2,
  },
  ULTRA_RARE: {
    label: "ULTRA RARE",
    ratePercent: 4,
    colorHex: "#f59e0b",
    deployCap: 1,
  },
};

export const ELEMENT_SYNERGY_DEFS: Readonly<
  Record<
    HeroElement,
    {
      readonly name: string;
      readonly descThai: string;
      readonly colorHex: string;
    }
  >
> = {
  FLAME: {
    name: "Flame Resonance (2+)",
    descThai: "วางธาตุไฟครบ 2 ตัว: ดาเมจธาตุไฟ +25% และเผาไหม้แรงขึ้น +50%",
    colorHex: "#f97316",
  },
  FROST: {
    name: "Permafrost Aura (2+)",
    descThai: "วางธาตุน้ำแข็งครบ 2 ตัว: ระยะยิง +15% และสโลว์ศัตรูหนักขึ้น +15%",
    colorHex: "#38bdf8",
  },
  STORM: {
    name: "Surge Conduit (2+)",
    descThai: "วางธาตุสายฟ้าครบ 2 ตัว: ลด Cooldown สกิลกดใช้ -20% และยิงไวขึ้น +15%",
    colorHex: "#c084fc",
  },
  SOLAR: {
    name: "Solar Ascendance (2+)",
    descThai: "วางธาตุแสงครบ 2 ตัว (หรือคู่ธาตุอื่น): ดาเมจทุกป้อม +20% และโบนัสจบ Wave +25G",
    colorHex: "#facc15",
  },
};

export const HERO_CATALOG: Readonly<Record<HeroId, HeroDefinition>> = {
  archer: {
    id: "archer",
    name: "Sylva Flarebow",
    titleThai: "นักธนูศรเพลิง (พื้นราบ | วางได้ 6)",
    rarity: "COMMON",
    element: "FLAME",
    role: "SINGLE_DPS",
    placementDomain: "GROUND",
    maxDeployCount: 6,
    deployCost: 60,
    upgradeBaseCost: 50,
    baseDamage: 24,
    attackIntervalTicks: 14,
    rangePx: 164,
    splashRadiusPx: 0,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Arrow Volley",
    skillDescThai: "ระดมยิงศรพายุเพลิงใส่ศัตรู 5 เป้าหมายแรก (260% DMG)",
    skillCooldownTicks: 160,
    skillEffect: {
      kind: "ARROW_VOLLEY",
      hits: 5,
      damageMultiplier: 2.6,
    },
    palette: {
      primary: 0x22c55e,
      secondary: 0x14532d,
      accent: 0xfacc15,
    },
  },
  frostarcher: {
    id: "frostarcher",
    name: "Rime Scout",
    titleThai: "พรานธนูเหมันต์ (พื้นราบ | วางได้ 6)",
    rarity: "COMMON",
    element: "FROST",
    role: "CROWD_CONTROL",
    placementDomain: "GROUND",
    maxDeployCount: 6,
    deployCost: 65,
    upgradeBaseCost: 55,
    baseDamage: 20,
    attackIntervalTicks: 15,
    rangePx: 160,
    splashRadiusPx: 0,
    slowPercent: 20,
    slowTicks: 30,
    skillName: "Frost Barrage",
    skillDescThai: "ยิงศรน้ำแข็งใส่ศัตรู 4 เป้าหมายแรก (240% DMG)",
    skillCooldownTicks: 165,
    skillEffect: {
      kind: "ARROW_VOLLEY",
      hits: 4,
      damageMultiplier: 2.4,
    },
    palette: {
      primary: 0x38bdf8,
      secondary: 0x1e3a8a,
      accent: 0xe0f2fe,
    },
  },
  pyromancer: {
    id: "pyromancer",
    name: "Ignis Alchemist",
    titleThai: "จอมเวทเพลิงผลาญ (พื้นราบ | วางได้ 4)",
    rarity: "UNCOMMON",
    element: "FLAME",
    role: "AOE_BLAST",
    placementDomain: "GROUND",
    maxDeployCount: 4,
    deployCost: 85,
    upgradeBaseCost: 70,
    baseDamage: 35,
    attackIntervalTicks: 21,
    rangePx: 142,
    splashRadiusPx: 52,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Meteor Strike",
    skillDescThai: "ทิ้งอุกกาบาตระเบิดหมู่ (300% DMG) และเผาไหม้ต่อเนื่อง",
    skillCooldownTicks: 195,
    skillEffect: {
      kind: "METEOR_STRIKE",
      radiusPx: 100,
      damageMultiplier: 3.0,
      burnTicks: 80,
    },
    palette: {
      primary: 0xf97316,
      secondary: 0x7c2d12,
      accent: 0xfde047,
    },
  },
  stormcaller: {
    id: "stormcaller",
    name: "Tempest Adept",
    titleThai: "นักเวทพายุสายฟ้า (ที่สูง ▲HG | วางได้ 4)",
    rarity: "UNCOMMON",
    element: "STORM",
    role: "AOE_BLAST",
    placementDomain: "HIGH_GROUND",
    maxDeployCount: 4,
    deployCost: 95,
    upgradeBaseCost: 80,
    baseDamage: 42,
    attackIntervalTicks: 18,
    rangePx: 170,
    splashRadiusPx: 40,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Static Surge",
    skillDescThai: "ปล่อยสายฟ้าชิ่ง 4 เป้าหมาย (280% DMG) และสตั๊นสั้นๆ",
    skillCooldownTicks: 190,
    skillEffect: {
      kind: "CHAIN_OVERLOAD",
      bounces: 4,
      damageMultiplier: 2.8,
      stunTicks: 22,
    },
    palette: {
      primary: 0x818cf8,
      secondary: 0x312e81,
      accent: 0xfef08a,
    },
  },
  frostmage: {
    id: "frostmage",
    name: "Cryo Warden",
    titleThai: "ผู้คุมป้อมน้ำแข็ง (ที่สูง ▲HG | วางได้ 2)",
    rarity: "RARE",
    element: "FROST",
    role: "CROWD_CONTROL",
    placementDomain: "HIGH_GROUND",
    maxDeployCount: 2,
    deployCost: 120,
    upgradeBaseCost: 95,
    baseDamage: 48,
    attackIntervalTicks: 17,
    rangePx: 176,
    splashRadiusPx: 45,
    slowPercent: 35,
    slowTicks: 45,
    skillName: "Absolute Zero",
    skillDescThai: "แช่แข็งศัตรูทั้งแผนที่ 2.5 วินาที และลดความเร็ว 60%",
    skillCooldownTicks: 230,
    skillEffect: {
      kind: "ABSOLUTE_ZERO",
      slowPercent: 60,
      freezeTicks: 50,
    },
    palette: {
      primary: 0x06b6d4,
      secondary: 0x164e63,
      accent: 0xcffafe,
    },
  },
  thunderlord: {
    id: "thunderlord",
    name: "Volt Lancer",
    titleThai: "อัศวินหอกอัสนี (พื้นราบ | วางได้ 2)",
    rarity: "RARE",
    element: "STORM",
    role: "SINGLE_DPS",
    placementDomain: "GROUND",
    maxDeployCount: 2,
    deployCost: 140,
    upgradeBaseCost: 110,
    baseDamage: 74,
    attackIntervalTicks: 18,
    rangePx: 162,
    splashRadiusPx: 0,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Chain Overload",
    skillDescThai: "ฟาดสายฟ้าชิ่ง 6 เป้าหมาย (350% DMG) พร้อมสตั๊น 1.5 วินาที",
    skillCooldownTicks: 205,
    skillEffect: {
      kind: "CHAIN_OVERLOAD",
      bounces: 6,
      damageMultiplier: 3.5,
      stunTicks: 30,
    },
    palette: {
      primary: 0xa855f7,
      secondary: 0x4c1d95,
      accent: 0xfef08a,
    },
  },
  paladin: {
    id: "paladin",
    name: "Solaris Commander",
    titleThai: "แม่ทัพสุริยันศักดิ์สิทธิ์ (พื้นราบ | วางได้ 1)",
    rarity: "ULTRA_RARE",
    element: "SOLAR",
    role: "SUPPORT_CLEANSE",
    placementDomain: "GROUND",
    maxDeployCount: 1,
    deployCost: 180,
    upgradeBaseCost: 140,
    baseDamage: 96,
    attackIntervalTicks: 15,
    rangePx: 175,
    splashRadiusPx: 46,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Sanctuary Cleanse",
    skillDescThai: "ล้างสถานะใบ้ของบอสให้ทุกป้อม และเร่งความเร็วโจมตี +45% นาน 6 วินาที",
    skillCooldownTicks: 215,
    skillEffect: {
      kind: "SANCTUARY_CLEANSE",
      buffAttackSpeedPercent: 45,
      buffDurationTicks: 120,
    },
    palette: {
      primary: 0xf59e0b,
      secondary: 0x78350f,
      accent: 0xffffff,
    },
  },
  chronoweaver: {
    id: "chronoweaver",
    name: "Aeon Sovereign",
    titleThai: "จ้าวแห่งดาราและเวลา (ที่สูง ▲HG | วางได้ 1)",
    rarity: "ULTRA_RARE",
    element: "SOLAR",
    role: "CROWD_CONTROL",
    placementDomain: "HIGH_GROUND",
    maxDeployCount: 1,
    deployCost: 210,
    upgradeBaseCost: 160,
    baseDamage: 115,
    attackIntervalTicks: 14,
    rangePx: 196,
    splashRadiusPx: 54,
    slowPercent: 25,
    slowTicks: 35,
    skillName: "Time Warp",
    skillDescThai: "ย้อนตำแหน่งศัตรูทุกตัวถอยหลังตามเส้นทาง และเร่งป้อมทั้งหมด",
    skillCooldownTicks: 250,
    skillEffect: {
      kind: "TIME_WARP",
      rewindProgress: 95,
      globalHasteTicks: 100,
    },
    palette: {
      primary: 0xec4899,
      secondary: 0x831843,
      accent: 0x67e8f9,
    },
  },
};

export const ALL_HERO_IDS: readonly HeroId[] = [
  "archer",
  "frostarcher",
  "pyromancer",
  "stormcaller",
  "frostmage",
  "thunderlord",
  "paladin",
  "chronoweaver",
];

export const ALL_ELEMENTS: readonly HeroElement[] = ["FLAME", "FROST", "STORM", "SOLAR"];

export function computeActiveSynergies(
  deployedHeroes: readonly { readonly heroId: HeroId }[]
): readonly ElementalSynergyBonus[] {
  const counts: Record<HeroElement, number> = {
    FLAME: 0,
    FROST: 0,
    STORM: 0,
    SOLAR: 0,
  };
  for (const h of deployedHeroes) {
    const el = HERO_CATALOG[h.heroId].element;
    counts[el] += 1;
  }
  return ALL_ELEMENTS.map((el) => {
    const def = ELEMENT_SYNERGY_DEFS[el];
    return {
      element: el,
      deployedUnits: counts[el],
      active: counts[el] >= 2,
      name: def.name,
      descThai: def.descThai,
    };
  });
}
