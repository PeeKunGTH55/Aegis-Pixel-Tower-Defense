import Phaser from "phaser";
import { ALL_HERO_IDS, HERO_CATALOG } from "../core/catalog";
import { EnemyTrait, HeroId, SpriteArchetype } from "../core/types";

const ARCHETYPE_PATTERNS: Readonly<Record<SpriteArchetype, readonly string[]>> = {
  BOW: [
    "....111111......",
    "...11222211.....",
    "..1122222211....",
    "..1223333221..3.",
    "..1231111321..33",
    "...13333331..3.3",
    "....113311...3.3",
    "...11111111.3..3",
    "..11211112113333",
    "..12211112213..3",
    "...11122111..3.3",
    "....112211....33",
    "...111..111....3",
    "...22....22.....",
    "..22......22....",
    "................",
  ],
  STAFF: [
    "......33........",
    "....331133......",
    "...31111113.....",
    "...11222211..3..",
    "...12311321.333.",
    "...12333321..3..",
    "....113311...2..",
    "...11311311..2..",
    "..1111331111.2..",
    "..1121111211.2..",
    "...11111111..2..",
    "...11333311..2..",
    "....11..11...2..",
    "...22....22.....",
    "..22......22....",
    "................",
  ],
  SPEAR: [
    "......333.....3.",
    ".....33133...33.",
    "....1111111..3..",
    "...11233211..2..",
    "...12311321..2..",
    "...12333321..2..",
    "....112211...2..",
    "..1111331111.2..",
    "..1211331121.2..",
    "..1111111111.2..",
    "...11222211..2..",
    "...111..111..2..",
    "...11....11..2..",
    "..222....222....",
    "..22......22....",
    "................",
  ],
  SHIELD: [
    "....111111......",
    "...11222211.....",
    "..1123333211....",
    "..1231111321....",
    "...12333321.333.",
    "....113311.31113",
    "..11111111131313",
    ".112213312231313",
    ".122213312231113",
    "..111111111.333.",
    "...11222211.....",
    "....11..11......",
    "...22....22.....",
    "..222....222....",
    "................",
    "................",
  ],
  CANNON: [
    ".....1111.......",
    "....122221......",
    "...12311321.333.",
    "...1233332132223",
    "....113311.32323",
    "..11111111132223",
    "..1221331221333.",
    "..111111111122..",
    "...11222211.22..",
    "...111..111.22..",
    "...22....22.22..",
    "..22......22....",
    "................",
    "................",
    "................",
    "................",
  ],
  TOME: [
    "....331133......",
    "...31122113.....",
    "..1123113211....",
    "..1123333211.33.",
    "...11333311.3113",
    "....112211..3333",
    "..1111331111.22.",
    "..1221331221....",
    "...11111111.....",
    "...11233211.....",
    "....11..11......",
    "...22....22.....",
    "..22......22....",
    "................",
    "................",
    "................",
  ],
  HALBERD: [
    "....111111..33..",
    "...11222211.313.",
    "..112311321133..",
    "...12333321.2...",
    "....113311..2...",
    "..11111111112...",
    ".112213312212...",
    ".122213312212...",
    "..11111111112...",
    "...11222211.2...",
    "....11..11..2...",
    "...22....22.....",
    "..22......22....",
    "................",
    "................",
    "................",
  ],
  CROWN: [
    "...3.3333.3.....",
    "...33111133.....",
    "..3113333113....",
    "..3131111313.3..",
    "...12311321.333.",
    "...12333321..3..",
    "....113311...3..",
    "..3311111133.3..",
    ".3111333311133..",
    ".311113311113...",
    ".331111111133...",
    "..3311221133....",
    "....11..11......",
    "...33....33.....",
    "..333....333....",
    "................",
  ],
};

const ENEMY_PATTERNS: Readonly<Record<EnemyTrait, readonly string[]>> = {
  NORMAL: [
    "................",
    "....111111......",
    "...11222211.....",
    "..1123113211....",
    "..1122222211....",
    "...11233211.....",
    "....111111......",
    "...11222211.....",
    "..1122222211....",
    "..1112222111....",
    "...11111111.....",
    "....11..11......",
    "...11....11.....",
    "...22....22.....",
    "................",
    "................",
  ],
  SWIFT: [
    "................",
    "..........11....",
    ".........1221...",
    "....1111123211..",
    "..112222222221..",
    ".122222222111...",
    "..111222211.....",
    "....122221......",
    "...11....11.....",
    "..11......11....",
    ".33........33...",
    "................",
    "................",
    "................",
    "................",
    "................",
  ],
  ARMORED: [
    "..1111111111....",
    ".112222222211...",
    ".122331133221...",
    ".122222222221...",
    ".112233332211...",
    ".111111111111...",
    "11222133122211..",
    "12222133122221..",
    "12222222222221..",
    ".112222222211...",
    "..1112222111....",
    "..111....111....",
    "..222....222....",
    "................",
    "................",
    "................",
  ],
  HEALER: [
    ".....3333.......",
    "....311113......",
    "...31222213.....",
    "...12311321..3..",
    "...12222221.333.",
    "....112211...3..",
    "...11133111..2..",
    "..1113333111.2..",
    "..1111331111.2..",
    "...11111111..2..",
    "...11222211..2..",
    "....11..11......",
    "...22....22.....",
    "................",
    "................",
    "................",
  ],
  BOSS_SILENCER: [
    ".33..111111..33.",
    ".33111222211133.",
    "..112233332211..",
    "..123311113321..",
    "..123133331321..",
    "..112233332211..",
    ".11111111111111.",
    "1122133333312211",
    "1222131111312221",
    "1222133333312221",
    ".11112222221111.",
    "..111222222111..",
    "..1111....1111..",
    "..333......333..",
    ".333........333.",
    "................",
  ],
};

function hexToCss(hex: number): string {
  return `#${hex.toString(16).padStart(6, "0")}`;
}

const AVATAR_CACHE = new Map<HeroId, string>();

export function getHeroAvatarDataUrl(heroId: HeroId): string {
  const cached = AVATAR_CACHE.get(heroId);
  if (cached) return cached;
  const def = HERO_CATALOG[heroId];
  const pattern = ARCHETYPE_PATTERNS[def.spriteArchetype];
  const scale = 3;
  const size = 16 * scale;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.fillStyle = "#0b111e";
  ctx.fillRect(0, 0, size, size);

  const colors = {
    "1": def.palette.primary,
    "2": def.palette.secondary,
    "3": def.palette.accent,
  };

  for (let row = 0; row < pattern.length; row++) {
    const line = pattern[row]!;
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === "1" || ch === "2" || ch === "3") {
        ctx.fillStyle = hexToCss(colors[ch]);
        ctx.fillRect(col * scale, row * scale, scale, scale);
      }
    }
  }

  const heroIndex = ALL_HERO_IDS.indexOf(heroId);
  ctx.fillStyle = hexToCss(def.palette.accent);
  ctx.fillRect(((heroIndex % 4) + 1) * scale, 14 * scale, scale, scale);

  const url = canvas.toDataURL("image/png");
  AVATAR_CACHE.set(heroId, url);
  return url;
}

function renderPixelPatternToTexture(
  scene: Phaser.Scene,
  key: string,
  pattern: readonly string[],
  colors: { readonly "1": number; readonly "2": number; readonly "3": number },
  scale = 2,
  crestSlot = 0
): void {
  if (scene.textures.exists(key)) return;
  const size = 16 * scale;
  const canvasTex = scene.textures.createCanvas(key, size, size);
  if (!canvasTex) return;
  const ctx = canvasTex.getContext();
  ctx.clearRect(0, 0, size, size);

  for (let row = 0; row < pattern.length; row++) {
    const line = pattern[row]!;
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === "1" || ch === "2" || ch === "3") {
        ctx.fillStyle = hexToCss(colors[ch]);
        ctx.fillRect(col * scale, row * scale, scale, scale);
      }
    }
  }
  if (crestSlot > 0) {
    ctx.fillStyle = hexToCss(colors["3"]);
    ctx.fillRect(((crestSlot % 4) + 1) * scale, 0, scale, scale);
  }
  canvasTex.refresh();
}

export function generateAllPixelTextures(scene: Phaser.Scene): void {
  ALL_HERO_IDS.forEach((heroId, idx) => {
    const def = HERO_CATALOG[heroId];
    renderPixelPatternToTexture(
      scene,
      `hero-${heroId}`,
      ARCHETYPE_PATTERNS[def.spriteArchetype],
      {
        "1": def.palette.primary,
        "2": def.palette.secondary,
        "3": def.palette.accent,
      },
      2,
      idx + 1
    );
  });

  const enemyColors: Readonly<
    Record<EnemyTrait, { readonly "1": number; readonly "2": number; readonly "3": number }>
  > = {
    NORMAL: { "1": 0x84cc16, "2": 0x365314, "3": 0xef4444 },
    SWIFT: { "1": 0xf43f5e, "2": 0x881337, "3": 0xfde047 },
    ARMORED: { "1": 0x94a3b8, "2": 0x334155, "3": 0x38bdf8 },
    HEALER: { "1": 0x10b981, "2": 0x064e3b, "3": 0xa7f3d0 },
    BOSS_SILENCER: { "1": 0xc084fc, "2": 0x581c87, "3": 0xf43f5e },
  };

  const traits: readonly EnemyTrait[] = [
    "NORMAL",
    "SWIFT",
    "ARMORED",
    "HEALER",
    "BOSS_SILENCER",
  ];
  for (const trait of traits) {
    renderPixelPatternToTexture(
      scene,
      `enemy-${trait}`,
      ENEMY_PATTERNS[trait],
      enemyColors[trait],
      trait === "BOSS_SILENCER" ? 3 : 2,
      0
    );
  }
}

export function renderTutorialIllustrationSvg(step: number): string {
  if (step === 1) {
    return `
      <svg viewBox="0 0 560 150" width="100%" height="110" style="display:block; pointer-events:none; background:#0b111e; border:1px solid #2a3752; border-radius:8px;">
        <rect x="20" y="25" width="96" height="96" fill="#13221f" stroke="#10b981" stroke-width="2"/>
        <text x="68" y="65" fill="#10b981" font-family="JetBrains Mono" font-size="12" text-anchor="middle">GROUND</text>
        <text x="68" y="88" fill="#cbd5e1" font-family="Chakra Petch" font-size="11" text-anchor="middle">วางสายพื้นราบอิสระ</text>

        <rect x="145" y="25" width="96" height="96" fill="#153147" stroke="#38bdf8" stroke-width="2"/>
        <text x="193" y="65" fill="#38bdf8" font-family="JetBrains Mono" font-size="12" text-anchor="middle">▲ HIGH GROUND</text>
        <text x="193" y="88" fill="#cbd5e1" font-family="Chakra Petch" font-size="11" text-anchor="middle">เฉพาะสายที่สูง</text>

        <rect x="270" y="25" width="96" height="96" fill="#382624" stroke="#f43f5e" stroke-width="2"/>
        <text x="318" y="65" fill="#f43f5e" font-family="JetBrains Mono" font-size="12" text-anchor="middle">PATH (ห้ามวาง)</text>
        <text x="318" y="88" fill="#cbd5e1" font-family="Chakra Petch" font-size="11" text-anchor="middle">ทางเดินมอนสเตอร์</text>

        <rect x="395" y="25" width="145" height="96" fill="#1a2336" stroke="#f59e0b" stroke-width="2" rx="6"/>
        <text x="467" y="55" fill="#f59e0b" font-family="JetBrains Mono" font-size="12" text-anchor="middle">DEPLOY CAPS</text>
        <text x="467" y="76" fill="#22c55e" font-family="JetBrains Mono" font-size="11" text-anchor="middle">COMMON: 6 | UNCOMMON: 4</text>
        <text x="467" y="96" fill="#a855f7" font-family="JetBrains Mono" font-size="11" text-anchor="middle">RARE: 2 | ULTRA: 1</text>
      </svg>
    `;
  }
  if (step === 2) {
    return `
      <svg viewBox="0 0 560 150" width="100%" height="110" style="display:block; pointer-events:none; background:#0b111e; border:1px solid #2a3752; border-radius:8px;">
        <rect x="24" y="22" width="240" height="106" fill="#111827" stroke="#38bdf8" stroke-width="2" rx="8"/>
        <text x="144" y="50" fill="#22c55e" font-family="JetBrains Mono" font-size="12" text-anchor="middle">COMMON &amp; UNCOMMON (19 ตัว)</text>
        <text x="144" y="75" fill="#f1f5f9" font-family="Chakra Petch" font-size="13" text-anchor="middle">PASSIVE (โจมตีอัตโนมัติล้วน)</text>
        <text x="144" y="98" fill="#94a3b8" font-family="Chakra Petch" font-size="11" text-anchor="middle">ราคาประหยัด วางได้เยอะ (6 หรือ 4 ตัว)</text>

        <rect x="296" y="22" width="240" height="106" fill="#1a2336" stroke="#f59e0b" stroke-width="2" rx="8"/>
        <text x="416" y="50" fill="#f59e0b" font-family="JetBrains Mono" font-size="12" text-anchor="middle">RARE &amp; ULTRA RARE (11 ตัว)</text>
        <text x="416" y="75" fill="#fde047" font-family="Chakra Petch" font-size="13" text-anchor="middle">มี ACTIVE SKILL กดใช้เอง (ปุ่ม Q)</text>
        <text x="416" y="98" fill="#cbd5e1" font-family="Chakra Petch" font-size="11" text-anchor="middle">ท่าไม้ตายระเบิดหมู่ / แช่แข็ง / ล้างคำสาปบอส</text>
      </svg>
    `;
  }
  if (step === 3) {
    return `
      <svg viewBox="0 0 560 150" width="100%" height="110" style="display:block; pointer-events:none; background:#0b111e; border:1px solid #2a3752; border-radius:8px;">
        <rect x="20" y="26" width="120" height="98" fill="#1f1212" stroke="#f97316" stroke-width="2" rx="6"/>
        <text x="80" y="56" fill="#f97316" font-family="JetBrains Mono" font-size="12" text-anchor="middle">FLAME 2/2</text>
        <text x="80" y="82" fill="#f1f5f9" font-family="Chakra Petch" font-size="11" text-anchor="middle">ดาเมจไฟ +25%</text>
        <text x="80" y="100" fill="#cbd5e1" font-family="Chakra Petch" font-size="10" text-anchor="middle">เผาไหม้แรงขึ้น +50%</text>

        <rect x="153" y="26" width="120" height="98" fill="#0f1926" stroke="#38bdf8" stroke-width="2" rx="6"/>
        <text x="213" y="56" fill="#38bdf8" font-family="JetBrains Mono" font-size="12" text-anchor="middle">FROST 2/2</text>
        <text x="213" y="82" fill="#f1f5f9" font-family="Chakra Petch" font-size="11" text-anchor="middle">ระยะยิง +15%</text>
        <text x="213" y="100" fill="#cbd5e1" font-family="Chakra Petch" font-size="10" text-anchor="middle">สโลว์ศัตรูหนักขึ้น</text>

        <rect x="286" y="26" width="120" height="98" fill="#171326" stroke="#c084fc" stroke-width="2" rx="6"/>
        <text x="346" y="56" fill="#c084fc" font-family="JetBrains Mono" font-size="12" text-anchor="middle">STORM 2/2</text>
        <text x="346" y="82" fill="#f1f5f9" font-family="Chakra Petch" font-size="11" text-anchor="middle">ลด Cooldown -20%</text>
        <text x="346" y="100" fill="#cbd5e1" font-family="Chakra Petch" font-size="10" text-anchor="middle">โจมตีไวขึ้น +15%</text>

        <rect x="419" y="26" width="120" height="98" fill="#1f1910" stroke="#facc15" stroke-width="2" rx="6"/>
        <text x="479" y="56" fill="#facc15" font-family="JetBrains Mono" font-size="12" text-anchor="middle">SOLAR 2/2</text>
        <text x="479" y="82" fill="#f1f5f9" font-family="Chakra Petch" font-size="11" text-anchor="middle">ดาเมจทุกป้อม +20%</text>
        <text x="479" y="100" fill="#cbd5e1" font-family="Chakra Petch" font-size="10" text-anchor="middle">โบนัสจบ Wave +25G</text>
      </svg>
    `;
  }
  return `
    <svg viewBox="0 0 560 150" width="100%" height="110" style="display:block; pointer-events:none; background:#0b111e; border:1px solid #2a3752; border-radius:8px;">
      <rect x="24" y="42" width="130" height="64" fill="#1a2336" stroke="#10b981" stroke-width="2" rx="6"/>
      <text x="89" y="72" fill="#10b981" font-family="JetBrains Mono" font-size="12" text-anchor="middle">ชนะ ด่าน N [EASY]</text>
      <text x="89" y="92" fill="#cbd5e1" font-family="Chakra Petch" font-size="10" text-anchor="middle">ปลดล็อก 2 ทางพร้อมกัน</text>

      <line x1="154" y1="62" x2="210" y2="42" stroke="#f59e0b" stroke-width="2"/>
      <line x1="154" y1="86" x2="210" y2="106" stroke="#38bdf8" stroke-width="2"/>

      <rect x="210" y="18" width="150" height="46" fill="#1a2336" stroke="#f59e0b" stroke-width="2" rx="6"/>
      <text x="285" y="45" fill="#f59e0b" font-family="JetBrains Mono" font-size="11" text-anchor="middle">ด่าน N [MEDIUM]</text>

      <rect x="210" y="84" width="150" height="46" fill="#1a2336" stroke="#38bdf8" stroke-width="2" rx="6"/>
      <text x="285" y="111" fill="#38bdf8" font-family="JetBrains Mono" font-size="11" text-anchor="middle">ด่าน N+1 [EASY]</text>

      <line x1="360" y1="41" x2="400" y2="41" stroke="#f43f5e" stroke-width="2"/>
      <rect x="400" y="18" width="136" height="46" fill="#1a2336" stroke="#f43f5e" stroke-width="2" rx="6"/>
      <text x="468" y="45" fill="#f43f5e" font-family="JetBrains Mono" font-size="11" text-anchor="middle">ด่าน N [HARD]</text>
    </svg>
  `;
}
