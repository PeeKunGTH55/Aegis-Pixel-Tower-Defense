import Phaser from "phaser";
import { generateAllPixelTextures } from "../assets/pixel-sprites";
import {
  ENEMY_WAYPOINTS,
  getTileTerrain,
  GRID_COLS,
  GRID_ROWS,
  HERO_CATALOG,
  HIGH_GROUND_TILES,
  isTileInBounds,
  TILE_SIZE_PX,
  tileToWorldCenter,
  worldToTile,
} from "../core/catalog";
import { BattleState, HeroId } from "../core/types";

export class BattleScene extends Phaser.Scene {
  private mapGraphics!: Phaser.GameObjects.Graphics;
  private overlayGraphics!: Phaser.GameObjects.Graphics;
  private fxGraphics!: Phaser.GameObjects.Graphics;
  private heroSprites = new Map<number, Phaser.GameObjects.Sprite>();
  private heroLabels = new Map<number, Phaser.GameObjects.Text>();
  private enemySprites = new Map<number, Phaser.GameObjects.Sprite>();
  private highGroundBadges: Phaser.GameObjects.Text[] = [];
  private floatingLabels: {
    readonly textObj: Phaser.GameObjects.Text;
    expiresAt: number;
  }[] = [];

  private currentState: BattleState | null = null;
  private selectedTile: { col: number; row: number } = { col: 2, row: 3 };
  private hoverTile: { col: number; row: number } | null = null;
  private activeHeroToDeploy: HeroId = "archer";
  private selectedHeroInstanceId: number | null = null;
  private onTileClickCallback: ((col: number, row: number) => void) | null = null;

  constructor() {
    super("battle");
  }

  public setOnTileClick(cb: (col: number, row: number) => void): void {
    this.onTileClickCallback = cb;
  }

  public setSelectedTile(col: number, row: number): void {
    this.selectedTile = { col, row };
  }

  public setActiveHeroToDeploy(heroId: HeroId): void {
    this.activeHeroToDeploy = heroId;
  }

  public setSelectedHeroInstanceId(instanceId: number | null): void {
    this.selectedHeroInstanceId = instanceId;
  }

  public create(): void {
    generateAllPixelTextures(this);

    this.mapGraphics = this.add.graphics();
    this.overlayGraphics = this.add.graphics();
    this.fxGraphics = this.add.graphics();

    this.drawStaticMap();

    for (const hg of HIGH_GROUND_TILES) {
      const center = tileToWorldCenter(hg.col, hg.row);
      const badge = this.add
        .text(center.x - 11, center.y - 13, "▲HG", {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: "9px",
          color: "#38bdf8",
        })
        .setDepth(4);
      this.highGroundBadges.push(badge);
    }

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      const tile = worldToTile(pointer.x, pointer.y);
      if (isTileInBounds(tile.col, tile.row)) {
        this.hoverTile = tile;
        if (this.currentState) {
          this.syncBattleState(this.currentState);
        }
      }
    });

    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      const tile = worldToTile(pointer.x, pointer.y);
      if (isTileInBounds(tile.col, tile.row) && this.onTileClickCallback) {
        this.onTileClickCallback(tile.col, tile.row);
      }
    });
  }

  private drawStaticMap(): void {
    this.mapGraphics.clear();

    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const terrain = getTileTerrain(col, row);
        const x = col * TILE_SIZE_PX;
        const y = row * TILE_SIZE_PX;

        if (terrain === "PATH") {
          this.mapGraphics.fillStyle(0x262f40, 1);
          this.mapGraphics.fillRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
          this.mapGraphics.lineStyle(1, 0x334155, 0.5);
          this.mapGraphics.strokeRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
        } else if (terrain === "HIGH_GROUND") {
          this.mapGraphics.fillStyle(0x162a3a, 1);
          this.mapGraphics.fillRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
          this.mapGraphics.fillStyle(0x0c4a6e, 1);
          this.mapGraphics.fillRect(x + 2, y + TILE_SIZE_PX - 5, TILE_SIZE_PX - 4, 4);
          this.mapGraphics.lineStyle(1.5, 0x38bdf8, 0.85);
          this.mapGraphics.strokeRect(x + 1, y + 1, TILE_SIZE_PX - 2, TILE_SIZE_PX - 2);
        } else {
          const checker = (col + row) % 2 === 0 ? 0x101722 : 0x131b28;
          this.mapGraphics.fillStyle(checker, 1);
          this.mapGraphics.fillRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
          this.mapGraphics.lineStyle(1, 0x1c2638, 0.65);
          this.mapGraphics.strokeRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
        }
      }
    }

    this.mapGraphics.lineStyle(2, 0x475569, 0.75);
    this.mapGraphics.beginPath();
    const first = ENEMY_WAYPOINTS[0]!;
    this.mapGraphics.moveTo(first.x, first.y);
    for (let i = 1; i < ENEMY_WAYPOINTS.length; i++) {
      const pt = ENEMY_WAYPOINTS[i]!;
      this.mapGraphics.lineTo(pt.x, pt.y);
    }
    this.mapGraphics.strokePath();

    const spawnPt = ENEMY_WAYPOINTS[0]!;
    this.mapGraphics.fillStyle(0xef4444, 0.95);
    this.mapGraphics.fillCircle(spawnPt.x, spawnPt.y, 11);

    const basePt = ENEMY_WAYPOINTS[ENEMY_WAYPOINTS.length - 1]!;
    this.mapGraphics.fillStyle(0x38bdf8, 0.95);
    this.mapGraphics.fillRect(basePt.x - 13, basePt.y - 13, 26, 26);
    this.mapGraphics.lineStyle(2, 0xe0f2fe, 1);
    this.mapGraphics.strokeRect(basePt.x - 13, basePt.y - 13, 26, 26);
  }

  public syncBattleState(state: BattleState): void {
    this.currentState = state;
    if (!this.scene.isActive()) return;

    this.overlayGraphics.clear();
    this.fxGraphics.clear();

    const activeHeroDef = HERO_CATALOG[this.activeHeroToDeploy];

    if (this.hoverTile) {
      const { col, row } = this.hoverTile;
      const terrain = getTileTerrain(col, row);
      const occupied = state.deployedHeroes.some((h) => h.col === col && h.row === row);
      const canPlace = !occupied && terrain === activeHeroDef.placementDomain;
      const hx = col * TILE_SIZE_PX;
      const hy = row * TILE_SIZE_PX;
      this.overlayGraphics.fillStyle(canPlace ? 0x22c55e : 0xef4444, 0.22);
      this.overlayGraphics.fillRect(hx, hy, TILE_SIZE_PX, TILE_SIZE_PX);
    }

    const selX = this.selectedTile.col * TILE_SIZE_PX;
    const selY = this.selectedTile.row * TILE_SIZE_PX;
    this.overlayGraphics.lineStyle(2.5, 0xf59e0b, 1);
    this.overlayGraphics.strokeRect(selX + 1, selY + 1, TILE_SIZE_PX - 2, TILE_SIZE_PX - 2);

    const selectedOccupant = state.deployedHeroes.find(
      (h) =>
        (h.col === this.selectedTile.col && h.row === this.selectedTile.row) ||
        h.instanceId === this.selectedHeroInstanceId
    );
    if (selectedOccupant) {
      const def = HERO_CATALOG[selectedOccupant.heroId];
      this.overlayGraphics.lineStyle(1.5, def.palette.primary, 0.5);
      this.overlayGraphics.strokeCircle(
        selectedOccupant.x,
        selectedOccupant.y,
        def.rangePx
      );
    }

    const activeHeroIds = new Set<number>();
    for (const hero of state.deployedHeroes) {
      activeHeroIds.add(hero.instanceId);
      const def = HERO_CATALOG[hero.heroId];
      const tx = hero.col * TILE_SIZE_PX;
      const ty = hero.row * TILE_SIZE_PX;
      this.overlayGraphics.lineStyle(1.5, def.palette.primary, 0.9);
      this.overlayGraphics.strokeRect(tx + 2, ty + 2, TILE_SIZE_PX - 4, TILE_SIZE_PX - 4);

      let spr = this.heroSprites.get(hero.instanceId);
      if (!spr) {
        spr = this.add
          .sprite(hero.x, hero.y, `hero-${hero.heroId}`)
          .setDepth(10);
        this.heroSprites.set(hero.instanceId, spr);
      }
      spr.setPosition(hero.x, hero.y);
      spr.setTexture(`hero-${hero.heroId}`);

      let lbl = this.heroLabels.get(hero.instanceId);
      if (!lbl) {
        lbl = this.add
          .text(hero.x - 15, hero.y + 8, "", {
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "9px",
            color: "#f8fafc",
            backgroundColor: "#0f172acc",
          })
          .setDepth(12);
        this.heroLabels.set(hero.instanceId, lbl);
      }
      const skillReady = state.tick >= hero.skillReadyAtTick;
      const isSilenced = state.tick < hero.silencedUntilTick;
      lbl.setPosition(hero.x - 15, hero.y + 7);
      lbl.setText(
        isSilenced
          ? `SILENCED`
          : `L${hero.level}★${hero.stars}${skillReady ? "⚡" : ""}`
      );
      lbl.setColor(isSilenced ? "#f87171" : skillReady ? "#fde047" : "#e2e8f0");
    }

    for (const [id, spr] of this.heroSprites.entries()) {
      if (!activeHeroIds.has(id)) {
        spr.destroy();
        this.heroSprites.delete(id);
      }
    }
    for (const [id, lbl] of this.heroLabels.entries()) {
      if (!activeHeroIds.has(id)) {
        lbl.destroy();
        this.heroLabels.delete(id);
      }
    }

    const activeEnemyIds = new Set<number>();
    for (const enemy of state.enemies) {
      activeEnemyIds.add(enemy.instanceId);
      let spr = this.enemySprites.get(enemy.instanceId);
      if (!spr) {
        spr = this.add
          .sprite(enemy.x, enemy.y, `enemy-${enemy.trait}`)
          .setDepth(15);
        this.enemySprites.set(enemy.instanceId, spr);
      }
      spr.setPosition(enemy.x, enemy.y);

      const barW = enemy.trait === "BOSS_SILENCER" ? 36 : 24;
      const hpRatio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
      this.overlayGraphics.fillStyle(0x090d16, 0.9);
      this.overlayGraphics.fillRect(enemy.x - barW / 2, enemy.y - 20, barW, 4);
      this.overlayGraphics.fillStyle(
        enemy.trait === "BOSS_SILENCER" ? 0xc084fc : 0x22c55e,
        1
      );
      this.overlayGraphics.fillRect(
        enemy.x - barW / 2,
        enemy.y - 20,
        Math.round(barW * hpRatio),
        4
      );
    }

    for (const [id, spr] of this.enemySprites.entries()) {
      if (!activeEnemyIds.has(id)) {
        spr.destroy();
        this.enemySprites.delete(id);
      }
    }

    for (const ev of state.recentEvents) {
      if (state.tick - ev.tick > 3) continue;
      if (ev.kind === "PROJECTILE") {
        this.fxGraphics.lineStyle(2, ev.color, 0.9);
        this.fxGraphics.lineBetween(ev.fromX, ev.fromY, ev.toX, ev.toY);
      } else if (ev.kind === "SKILL_BURST" || ev.kind === "BOSS_PULSE") {
        this.fxGraphics.lineStyle(3, ev.color, 0.95);
        this.fxGraphics.strokeCircle(ev.toX, ev.toY, 34);
        this.fxGraphics.lineBetween(ev.fromX, ev.fromY, ev.toX, ev.toY);
        if (ev.label && state.tick === ev.tick) {
          const txt = this.add
            .text(ev.toX - 30, ev.toY - 28, ev.label, {
              fontFamily: '"Press Start 2P", monospace',
              fontSize: "9px",
              color: "#fef08a",
              backgroundColor: "#090b10dd",
            })
            .setDepth(30);
          this.floatingLabels.push({ textObj: txt, expiresAt: Date.now() + 650 });
        }
      }
    }

    const now = Date.now();
    this.floatingLabels = this.floatingLabels.filter((item) => {
      if (now >= item.expiresAt) {
        item.textObj.destroy();
        return false;
      }
      item.textObj.y -= 0.4;
      return true;
    });
  }

  public getCurrentState(): BattleState | null {
    return this.currentState;
  }
}
