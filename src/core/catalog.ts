import { HeroDefinition, HeroId, TileTerrain } from "./types";

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

export const TILE_SIZE_PX = 32;
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

export const PATH_WAYPOINT_TILES: readonly GridCoord[] = [
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
];

export const ENEMY_WAYPOINTS: readonly Point2D[] = PATH_WAYPOINT_TILES.map((t) =>
  tileToWorldCenter(t.col, t.row)
);

const PATH_TILE_SET: ReadonlySet<string> = (() => {
  const set = new Set<string>();
  for (let i = 0; i < PATH_WAYPOINT_TILES.length - 1; i++) {
    const a = PATH_WAYPOINT_TILES[i]!;
    const b = PATH_WAYPOINT_TILES[i + 1]!;
    const minC = Math.min(a.col, b.col);
    const maxC = Math.max(a.col, b.col);
    const minR = Math.min(a.row, b.row);
    const maxR = Math.max(a.row, b.row);
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        set.add(`${c},${r}`);
      }
    }
  }
  return set;
})();

export const HIGH_GROUND_TILES: readonly GridCoord[] = [
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
];

const HIGH_GROUND_SET: ReadonlySet<string> = new Set(
  HIGH_GROUND_TILES.map((t) => `${t.col},${t.row}`)
);

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

export function getTileTerrain(col: number, row: number): TileTerrain {
  const key = `${col},${row}`;
  if (PATH_TILE_SET.has(key)) {
    return "PATH";
  }
  if (HIGH_GROUND_SET.has(key)) {
    return "HIGH_GROUND";
  }
  return "GROUND";
}

export const HERO_CATALOG: Readonly<Record<HeroId, HeroDefinition>> = {
  archer: {
    id: "archer",
    name: "Sylva Ranger",
    titleThai: "นักธนูพงไพร (วางพื้นราบได้ทุกช่อง | สูงสุด 6)",
    rarity: "COMMON",
    role: "SINGLE_DPS",
    placementDomain: "GROUND",
    maxDeployCount: 6,
    deployCost: 65,
    upgradeBaseCost: 55,
    baseDamage: 24,
    attackIntervalTicks: 14,
    rangePx: 164,
    splashRadiusPx: 0,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Arrow Volley",
    skillDescThai: "ระดมยิงศรพายุใส่ศัตรู 5 เป้าหมายแรก (260% DMG)",
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
  pyromancer: {
    id: "pyromancer",
    name: "Ignis Alchemist",
    titleThai: "จอมเวทเพลิง (พื้นราบ | วางได้ 6)",
    rarity: "COMMON",
    role: "AOE_BLAST",
    placementDomain: "GROUND",
    maxDeployCount: 6,
    deployCost: 85,
    upgradeBaseCost: 70,
    baseDamage: 32,
    attackIntervalTicks: 22,
    rangePx: 132,
    splashRadiusPx: 48,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Meteor Strike",
    skillDescThai: "ทิ้งอุกกาบาตระเบิดหมู่ (300% DMG) และเผาไหม้ต่อเนื่อง",
    skillCooldownTicks: 200,
    skillEffect: {
      kind: "METEOR_STRIKE",
      radiusPx: 95,
      damageMultiplier: 3.0,
      burnTicks: 80,
    },
    palette: {
      primary: 0xf97316,
      secondary: 0x7c2d12,
      accent: 0xfde047,
    },
  },
  frostmage: {
    id: "frostmage",
    name: "Cryo Warden",
    titleThai: "ผู้คุมน้ำแข็ง (ที่สูงเท่านั้น | วางได้ 2)",
    rarity: "ELITE",
    role: "CROWD_CONTROL",
    placementDomain: "HIGH_GROUND",
    maxDeployCount: 2,
    deployCost: 120,
    upgradeBaseCost: 95,
    baseDamage: 36,
    attackIntervalTicks: 18,
    rangePx: 158,
    splashRadiusPx: 38,
    slowPercent: 35,
    slowTicks: 40,
    skillName: "Absolute Zero",
    skillDescThai: "แช่แข็งศัตรูทั้งแผนที่ 2.5 วินาที และลดความเร็ว 60%",
    skillCooldownTicks: 240,
    skillEffect: {
      kind: "ABSOLUTE_ZERO",
      slowPercent: 60,
      freezeTicks: 50,
    },
    palette: {
      primary: 0x38bdf8,
      secondary: 0x0c4a6e,
      accent: 0xe0f2fe,
    },
  },
  thunderlord: {
    id: "thunderlord",
    name: "Volt Lancer",
    titleThai: "อัศวินสายฟ้า (พื้นราบ | วางได้ 2)",
    rarity: "ELITE",
    role: "SINGLE_DPS",
    placementDomain: "GROUND",
    maxDeployCount: 2,
    deployCost: 145,
    upgradeBaseCost: 110,
    baseDamage: 68,
    attackIntervalTicks: 19,
    rangePx: 154,
    splashRadiusPx: 0,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Chain Overload",
    skillDescThai: "ฟาดสายฟ้าชิ่ง 6 เป้าหมาย (340% DMG) พร้อมสตั๊น 1.5 วินาที",
    skillCooldownTicks: 210,
    skillEffect: {
      kind: "CHAIN_OVERLOAD",
      bounces: 6,
      damageMultiplier: 3.4,
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
    titleThai: "แม่ทัพศักดิ์สิทธิ์ (พื้นราบ | วางได้ 1)",
    rarity: "LEGENDARY",
    role: "SUPPORT_CLEANSE",
    placementDomain: "GROUND",
    maxDeployCount: 1,
    deployCost: 180,
    upgradeBaseCost: 140,
    baseDamage: 88,
    attackIntervalTicks: 16,
    rangePx: 165,
    splashRadiusPx: 42,
    slowPercent: 0,
    slowTicks: 0,
    skillName: "Sanctuary Cleanse",
    skillDescThai: "ล้างสถานะใบ้ของบอสให้ทุกป้อม และเร่งความเร็วโจมตี +45% นาน 6 วินาที",
    skillCooldownTicks: 220,
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
    titleThai: "จ้าวแห่งกาลเวลา (ที่สูงเท่านั้น | วางได้ 1)",
    rarity: "LEGENDARY",
    role: "CROWD_CONTROL",
    placementDomain: "HIGH_GROUND",
    maxDeployCount: 1,
    deployCost: 210,
    upgradeBaseCost: 160,
    baseDamage: 105,
    attackIntervalTicks: 15,
    rangePx: 185,
    splashRadiusPx: 50,
    slowPercent: 25,
    slowTicks: 30,
    skillName: "Time Warp",
    skillDescThai: "ย้อนตำแหน่งศัตรูทุกตัวถอยหลังตามเส้นทาง และเร่งป้อมทั้งหมด",
    skillCooldownTicks: 260,
    skillEffect: {
      kind: "TIME_WARP",
      rewindProgress: 85,
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
  "pyromancer",
  "frostmage",
  "thunderlord",
  "paladin",
  "chronoweaver",
];

export interface StageDefinition {
  readonly id: number;
  readonly name: string;
  readonly subtitleThai: string;
  readonly startingGold: number;
  readonly hpScale: number;
  readonly speedScale: number;
  readonly clearRewardCoins: number;
}

export const STAGE_CATALOG: readonly StageDefinition[] = [
  {
    id: 1,
    name: "Emerald Outpost",
    subtitleThai: "ด่าน 1: ชายแดนมรกต (10 Waves + Endless)",
    startingGold: 320,
    hpScale: 1.0,
    speedScale: 1.0,
    clearRewardCoins: 150,
  },
  {
    id: 2,
    name: "Obsidian Gorge",
    subtitleThai: "ด่าน 2: หุบเขาหินนิล (ศัตรูเกราะหนา & วิ่งเร็ว)",
    startingGold: 280,
    hpScale: 1.45,
    speedScale: 1.12,
    clearRewardCoins: 240,
  },
  {
    id: 3,
    name: "Void Citadel",
    subtitleThai: "ด่าน 3: ป้อมปราการสุญญตา (บอสปล่อยคลื่นใบ้ป้อม)",
    startingGold: 330,
    hpScale: 2.0,
    speedScale: 1.22,
    clearRewardCoins: 380,
  },
];
