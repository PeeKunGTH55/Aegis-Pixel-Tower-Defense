import Phaser from "phaser";
import { generateAllPixelTextures } from "../assets/pixel-sprites";
import {
  getStageWaypointsPx,
  getTileTerrainForStage,
  GRID_COLS,
  GRID_ROWS,
  HERO_CATALOG,
  isTileInBounds,
  STAGE_CATALOG,
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
  private renderedStageId = -1;
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

    this.drawStaticMapForStage(1);

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

  private drawStaticMapForStage(stageId: number): void {
    this.renderedStageId = stageId;
    const stageDef = STAGE_CATALOG.find((s) => s.id === stageId) ?? STAGE_CATALOG[0]!;
    const colors = stageDef.biomeColors;
    const waypoints = getStageWaypointsPx(stageDef.id);

    this.mapGraphics.clear();
    for (const b of this.highGroundBadges) {
      b.destroy();
    }
    this.highGroundBadges = [];

    for (let col = 0; col < GRID_COLS; col++) {
      for (let row = 0; row < GRID_ROWS; row++) {
        const terrain = getTileTerrainForStage(stageDef.id, col, row);
        const x = col * TILE_SIZE_PX;
        const y = row * TILE_SIZE_PX;

        if (terrain === "PATH") {
          this.mapGraphics.fillStyle(colors.pathFill, 1);
          this.mapGraphics.fillRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
          this.mapGraphics.lineStyle(1, colors.pathBorder, 0.55);
          this.mapGraphics.strokeRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
        } else if (terrain === "HIGH_GROUND") {
          this.mapGraphics.fillStyle(colors.hgFill, 1);
          this.mapGraphics.fillRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
          this.mapGraphics.fillStyle(0x091526, 0.85);
          this.mapGraphics.fillRect(x + 2, y + TILE_SIZE_PX - 6, TILE_SIZE_PX - 4, 5);
          this.mapGraphics.lineStyle(1.5, colors.hgBorder, 0.9);
          this.mapGraphics.strokeRect(x + 1, y + 1, TILE_SIZE_PX - 2, TILE_SIZE_PX - 2);

          const center = tileToWorldCenter(col, row);
          const badge = this.add
            .text(center.x - 12, center.y - 14, "▲HG", {
              fontFamily: '"JetBrains Mono", monospace',
              fontSize: "9px",
              color: "#7dd3fc",
            })
            .setDepth(4);
          this.highGroundBadges.push(badge);
        } else {
          const checker = (col + row) % 2 === 0 ? colors.groundA : colors.groundB;
          this.mapGraphics.fillStyle(checker, 1);
          this.mapGraphics.fillRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
          this.mapGraphics.lineStyle(1, 0x1e293b, 0.45);
          this.mapGraphics.strokeRect(x, y, TILE_SIZE_PX, TILE_SIZE_PX);
        }
      }
    }

    this.mapGraphics.lineStyle(2.5, colors.pathBorder, 0.85);
    this.mapGraphics.beginPath();
    const first = waypoints[0]!;
    this.mapGraphics.moveTo(first.x, first.y);
    for (let i = 1; i < waypoints.length; i++) {
      const pt = waypoints[i]!;
      this.mapGraphics.lineTo(pt.x, pt.y);
    }
    this.mapGraphics.strokePath();

    const spawnPt = waypoints[0]!;
    this.mapGraphics.fillStyle(0xef4444, 0.95);
    this.mapGraphics.fillCircle(spawnPt.x, spawnPt.y, 12);

    const basePt = waypoints[waypoints.length - 1]!;
    this.mapGraphics.fillStyle(0x38bdf8, 0.95);
    this.mapGraphics.fillRect(basePt.x - 14, basePt.y - 14, 28, 28);
    this.mapGraphics.lineStyle(2, 0xe0f2fe, 1);
    this.mapGraphics.strokeRect(basePt.x - 14, basePt.y - 14, 28, 28);
  }

  public syncBattleState(state: BattleState): void {
    this.currentState = state;
    if (!this.scene.isActive()) return;

    if (this.renderedStageId !== state.config.stageId) {
      this.drawStaticMapForStage(state.config.stageId);
    }

    this.overlayGraphics.clear();
    this.fxGraphics.clear();

    const activeHeroDef = HERO_CATALOG[this.activeHeroToDeploy];

    if (this.hoverTile) {
      const { col, row } = this.hoverTile;
      const terrain = getTileTerrainForStage(state.config.stageId, col, row);
      const occupied = state.deployedHeroes.some((h) => h.col === col && h.row === row);
      const canPlace = !occupied && terrain === activeHeroDef.placementDomain;
      const hx = col * TILE_SIZE_PX;
      const hy = row * TILE_SIZE_PX;
      this.overlayGraphics.fillStyle(canPlace ? 0x22c55e : 0xef4444, 0.24);
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
      this.overlayGraphics.lineStyle(1.5, def.palette.primary, 0.55);
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
          .text(hero.x - 16, hero.y + 9, "", {
            fontFamily: '"JetBrains Mono", monospace',
            fontSize: "9px",
            color: "#f8fafc",
            backgroundColor: "#0f172acc",
          })
          .setDepth(12);
        this.heroLabels.set(hero.instanceId, lbl);
      }
      const hasSkill = def.skillEffect !== null;
      const skillReady = hasSkill && state.tick >= hero.skillReadyAtTick;
      const isSilenced = state.tick < hero.silencedUntilTick;
      lbl.setPosition(hero.x - 16, hero.y + 8);
      lbl.setText(
        isSilenced
          ? `SILENCED`
          : `L${hero.level}★${hero.stars}${skillReady ? "!" : ""}`
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

      const barW = enemy.trait === "BOSS_SILENCER" ? 38 : 26;
      const hpRatio = Math.max(0, Math.min(1, enemy.hp / enemy.maxHp));
      this.overlayGraphics.fillStyle(0x090d16, 0.9);
      this.overlayGraphics.fillRect(enemy.x - barW / 2, enemy.y - 21, barW, 4);
      this.overlayGraphics.fillStyle(
        enemy.trait === "BOSS_SILENCER" ? 0xc084fc : 0x22c55e,
        1
      );
      this.overlayGraphics.fillRect(
        enemy.x - barW / 2,
        enemy.y - 21,
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
        this.fxGraphics.strokeCircle(ev.toX, ev.toY, 36);
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
