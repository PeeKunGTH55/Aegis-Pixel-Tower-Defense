import Phaser from "phaser";
import { SoundEngine } from "./audio/sound-engine";
import {
  ALL_HERO_IDS,
  getTileTerrain,
  getUnlockedLoadoutSlots,
  HERO_CATALOG,
  HIGH_GROUND_TILES,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_LOADOUT_SLOTS,
  STAGE_CATALOG,
} from "./core/catalog";
import {
  applyCommand,
  createInitialBattleState,
  getDeployCountForHero,
  getHeroEffectiveDamage,
  getHeroUpgradeCost,
  stepSimulationTick,
} from "./core/engine";
import {
  awardBattleCompletion,
  createDefaultProfile,
  GACHA_PULL_COST,
  LEGENDARY_PITY_THRESHOLD,
  pullGachaWithSeed,
  toggleHeroInLoadout,
} from "./core/progression";
import {
  BattleMode,
  BattleState,
  GameCommand,
  HeroId,
  PlayerProfile,
  TargetPriority,
} from "./core/types";
import { BattleScene } from "./scenes/BattleScene";

const PROFILE_STORAGE_KEY = "aegis_pixel_td_profile_v3";

function loadProfile(): PlayerProfile {
  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) return createDefaultProfile();
    const parsed = JSON.parse(raw) as PlayerProfile;
    if (typeof parsed.playerLevel !== "number" || !Array.isArray(parsed.loadout)) {
      return createDefaultProfile();
    }
    return parsed;
  } catch {
    return createDefaultProfile();
  }
}

function saveProfile(profile: PlayerProfile): void {
  try {
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
  } catch {
    return;
  }
}

type ActiveTab = "BATTLE" | "ROSTER" | "LEADERBOARD";

const RECOMMENDED_GROUND_TILES: readonly { readonly col: number; readonly row: number }[] = [
  { col: 2, row: 3 },
  { col: 5, row: 4 },
  { col: 7, row: 5 },
  { col: 4, row: 9 },
  { col: 11, row: 9 },
  { col: 13, row: 5 },
];

class TowerDefenseController {
  private profile: PlayerProfile;
  private battleState: BattleState;
  private battleScene: BattleScene;
  private sound = new SoundEngine();

  private activeTab: ActiveTab = "BATTLE";
  private selectedStageId = 1;
  private selectedMode: BattleMode = "STAGE";
  private selectedHeroToDeploy: HeroId = "archer";
  private selectedTile: { col: number; row: number } = { col: 2, row: 3 };
  private speedMultiplier: 1 | 2 | 4 = 1;
  private statusBannerText =
    "พร้อมรบ: คลิกช่องว่างบนแผนที่เพื่อวาง Hero ได้ทันที (ยกเว้นทางเดินศัตรู | ช่อง ▲HG สำหรับ Cryo Warden & Aeon Sovereign)";
  private gachaResultBanner = "";
  private completionRecorded = false;
  private lastHudStructureKey = "";

  constructor(scene: BattleScene) {
    this.profile = loadProfile();
    this.battleScene = scene;
    this.selectedHeroToDeploy = this.profile.loadout[0] ?? "archer";
    this.battleScene.setActiveHeroToDeploy(this.selectedHeroToDeploy);
    this.battleScene.setSelectedTile(this.selectedTile.col, this.selectedTile.row);
    this.battleState = this.buildNewBattleState(20261029);

    this.battleScene.setOnTileClick((col, row) => {
      this.selectTileOrDeploy(col, row);
    });

    this.bindKeyboardShortcuts();
    this.renderHud();
    this.startSimulationLoop();
  }

  private buildNewBattleState(seed: number): BattleState {
    this.completionRecorded = false;
    return createInitialBattleState({
      seed,
      stageId: this.selectedStageId,
      mode: this.selectedMode,
      playerLevel: this.profile.playerLevel,
      loadout: this.profile.loadout,
      heroStars: this.profile.ownedHeroes,
    });
  }

  private computeHudStructureKey(): string {
    const st = this.battleState;
    const readyFlags = st.deployedHeroes
      .map(
        (h) =>
          `${h.instanceId}:${h.level}:${st.tick >= h.skillReadyAtTick ? 1 : 0}:${st.tick < h.silencedUntilTick ? 1 : 0}`
      )
      .join(",");
    return [
      this.activeTab,
      this.selectedStageId,
      this.selectedMode,
      this.selectedHeroToDeploy,
      `${this.selectedTile.col},${this.selectedTile.row}`,
      this.speedMultiplier,
      st.phase,
      st.wave,
      readyFlags,
      this.profile.metaCoins,
      this.profile.playerLevel,
      this.profile.loadout.join(","),
      this.profile.leaderboard.length,
    ].join("|");
  }

  public startNewBattle(stageId: number, mode: BattleMode, customSeed?: number): void {
    this.selectedStageId = stageId;
    this.selectedMode = mode;
    const seed = customSeed ?? ((Date.now() & 0x7fffffff) || 20261029);
    this.battleState = this.buildNewBattleState(seed);
    this.statusBannerText = `เริ่มภารกิจ Stage ${stageId} (${mode === "STAGE" ? "10 Waves" : "Endless Mode"})`;
    this.battleScene.syncBattleState(this.battleState);
    this.renderHud();
  }

  public dispatchGameCommand(cmd: GameCommand): boolean {
    const res = applyCommand(this.battleState, cmd);
    this.battleState = res.state;
    if (res.ok) {
      this.statusBannerText = res.eventText;
      if (cmd.kind === "DEPLOY") this.sound.playDeploy();
      if (cmd.kind === "CAST_SKILL") this.sound.playSkillCast();
      if (cmd.kind === "START_WAVE") this.sound.playWaveStart();
    } else {
      this.statusBannerText = `คำสั่งถูกปฏิเสธ: ${res.reason}`;
    }
    this.battleScene.syncBattleState(this.battleState);
    this.renderHud();
    return res.ok;
  }

  public selectTile(col: number, row: number): void {
    this.selectedTile = { col, row };
    this.battleScene.setSelectedTile(col, row);
    const existing = this.battleState.deployedHeroes.find(
      (h) => h.col === col && h.row === row
    );
    this.battleScene.setSelectedHeroInstanceId(existing ? existing.instanceId : null);
    this.battleScene.syncBattleState(this.battleState);
    this.renderHud();
  }

  public selectTileOrDeploy(col: number, row: number): void {
    this.selectedTile = { col, row };
    this.battleScene.setSelectedTile(col, row);
    const existing = this.battleState.deployedHeroes.find(
      (h) => h.col === col && h.row === row
    );
    if (existing) {
      this.battleScene.setSelectedHeroInstanceId(existing.instanceId);
      this.statusBannerText = `เลือกป้อม ${HERO_CATALOG[existing.heroId].name} ที่ช่อง (${col},${row})`;
      this.battleScene.syncBattleState(this.battleState);
      this.renderHud();
      return;
    }
    this.dispatchGameCommand({
      kind: "DEPLOY",
      tick: this.battleState.tick,
      heroId: this.selectedHeroToDeploy,
      col,
      row,
    });
  }

  public castSkillForHeroType(heroId: HeroId): boolean {
    const readyHero = this.battleState.deployedHeroes.find(
      (h) =>
        h.heroId === heroId &&
        this.battleState.tick >= h.skillReadyAtTick &&
        (this.battleState.tick >= h.silencedUntilTick ||
          HERO_CATALOG[h.heroId].skillEffect.kind === "SANCTUARY_CLEANSE")
    );
    const fallbackHero = this.battleState.deployedHeroes.find((h) => h.heroId === heroId);
    const targetHero = readyHero ?? fallbackHero;
    if (!targetHero) {
      this.statusBannerText = `ยังไม่ได้วาง ${HERO_CATALOG[heroId].name} ลงในสนาม`;
      this.renderHud();
      return false;
    }
    return this.dispatchGameCommand({
      kind: "CAST_SKILL",
      tick: this.battleState.tick,
      instanceId: targetHero.instanceId,
    });
  }

  public performGachaPull(seedOverride?: number): void {
    const seed = seedOverride ?? ((Date.now() + this.profile.pityCounter * 997) >>> 0);
    const outcome = pullGachaWithSeed(this.profile, seed);
    if (!outcome.ok || !outcome.pulledHeroId) {
      this.gachaResultBanner = "เหรียญ Meta Coins ไม่พอ (ต้องการ 100 Coins)";
      this.renderHud();
      return;
    }
    this.profile = outcome.profile;
    saveProfile(this.profile);
    const def = HERO_CATALOG[outcome.pulledHeroId];
    this.sound.playGachaPull(def.rarity === "LEGENDARY");
    this.gachaResultBanner = outcome.isDuplicate
      ? `สุ่มซ้ำ! ${def.name} เลื่อนขั้นเป็น ★${outcome.newStarLevel} (เพิ่มพลังโจมตี + ลด Cooldown สกิล)`
      : `ปลดล็อก Hero ใหม่: ${def.name} [${def.rarity}] (${def.placementDomain === "HIGH_GROUND" ? "วางบนที่สูง ▲HG" : "วางบนพื้นราบ"} | สูงสุด ${def.maxDeployCount} ตัว)`;
    this.renderHud();
  }

  public toggleLoadoutHero(heroId: HeroId): void {
    const res = toggleHeroInLoadout(this.profile, heroId);
    this.profile = res.profile;
    saveProfile(this.profile);
    this.statusBannerText = res.message;
    if (!this.profile.loadout.includes(this.selectedHeroToDeploy)) {
      this.selectedHeroToDeploy = this.profile.loadout[0] ?? "archer";
      this.battleScene.setActiveHeroToDeploy(this.selectedHeroToDeploy);
    }
    if (this.battleState.wave === 0 && this.battleState.deployedHeroes.length === 0) {
      this.battleState = this.buildNewBattleState(this.battleState.config.seed);
    }
    this.renderHud();
  }

  private bindKeyboardShortcuts(): void {
    window.addEventListener("keydown", (ev) => {
      if (ev.key >= "1" && ev.key <= "6") {
        const idx = Number(ev.key) - 1;
        const heroId = this.profile.loadout[idx];
        if (heroId) {
          this.selectedHeroToDeploy = heroId;
          this.battleScene.setActiveHeroToDeploy(heroId);
          this.statusBannerText = `เลือกการ์ด ${HERO_CATALOG[heroId].name} (${HERO_CATALOG[heroId].placementDomain === "HIGH_GROUND" ? "วางเฉพาะช่องที่สูง ▲HG" : "วางช่องพื้นราบได้ทุกช่อง"})`;
          this.renderHud();
        }
      } else if (ev.key.toLowerCase() === "q") {
        this.castSkillForHeroType(this.selectedHeroToDeploy);
      } else if (ev.key === " ") {
        ev.preventDefault();
        this.dispatchGameCommand({ kind: "START_WAVE", tick: this.battleState.tick });
      }
    });
  }

  private startSimulationLoop(): void {
    window.setInterval(() => {
      for (let i = 0; i < this.speedMultiplier; i++) {
        const prevTick = this.battleState.tick;
        this.battleState = stepSimulationTick(this.battleState);
        if (
          this.battleState.tick !== prevTick &&
          this.battleState.recentEvents.some(
            (e) => e.tick === this.battleState.tick && e.kind === "PROJECTILE"
          ) &&
          this.battleState.tick % 4 === 0
        ) {
          this.sound.playAttack();
        }
      }

      if (
        (this.battleState.phase === "VICTORY" || this.battleState.phase === "DEFEAT") &&
        !this.completionRecorded
      ) {
        this.completionRecorded = true;
        this.profile = awardBattleCompletion(this.profile, {
          playerName: "Tactician Player",
          config: this.battleState.config,
          finalTick: this.battleState.tick,
          waveReached: this.battleState.wave,
          victory: this.battleState.phase === "VICTORY",
          commandLog: this.battleState.commandLog,
        });
        saveProfile(this.profile);
      }

      this.battleScene.syncBattleState(this.battleState);
      const nextKey = this.computeHudStructureKey();
      if (nextKey !== this.lastHudStructureKey) {
        this.renderHud();
      } else {
        this.updateLiveCountersOnly();
      }
    }, 50);
  }

  private updateLiveCountersOnly(): void {
    const st = this.battleState;
    const waveEl = document.querySelector('[data-testid="hud-wave"]');
    if (waveEl) {
      waveEl.innerHTML = `WAVE: <strong style="color:var(--accent-gold);">${st.wave}${st.config.mode === "STAGE" ? `/${st.maxWave}` : " (ENDLESS)"}</strong>`;
    }
    const goldEl = document.querySelector('[data-testid="hud-gold"]');
    if (goldEl) {
      goldEl.innerHTML = `GOLD: <strong style="color:#fde047;">${st.gold}</strong>`;
    }
    const hpEl = document.querySelector('[data-testid="hud-hp"]');
    if (hpEl) {
      hpEl.innerHTML = `BASE HP: <strong style="color:${st.baseHp > 8 ? "#10b981" : "#ef4444"};">${st.baseHp}/${st.maxBaseHp}</strong>`;
    }
    const scoreEl = document.querySelector('[data-testid="hud-score"]');
    if (scoreEl) {
      scoreEl.innerHTML = `SCORE: <strong style="color:#38bdf8;">${st.score}</strong>`;
    }
    const phaseEl = document.querySelector('[data-testid="hud-phase"]');
    if (phaseEl) {
      phaseEl.textContent = st.phase;
    }

    const selectedTileHero = st.deployedHeroes.find(
      (h) => h.col === this.selectedTile.col && h.row === this.selectedTile.row
    );
    const castBtn = document.getElementById("btn-cast-selected");
    if (selectedTileHero && castBtn) {
      const def = HERO_CATALOG[selectedTileHero.heroId];
      const skillReady = st.tick >= selectedTileHero.skillReadyAtTick;
      const cdRemainSec = Math.max(
        0,
        (selectedTileHero.skillReadyAtTick - st.tick) / 20
      ).toFixed(1);
      castBtn.textContent = skillReady
        ? `⚡ กดสกิล ${def.skillName}`
        : `Cooldown (${cdRemainSec}s)`;
    }
  }

  public setTab(tab: ActiveTab): void {
    this.activeTab = tab;
    this.renderHud();
  }

  public getSnapshot() {
    return {
      profile: this.profile,
      battleState: this.battleState,
      selectedHeroToDeploy: this.selectedHeroToDeploy,
      selectedTile: this.selectedTile,
      activeTab: this.activeTab,
    };
  }

  public renderHud(): void {
    const topEl = document.getElementById("hud-top");
    const sideEl = document.getElementById("hud-side");
    const bottomEl = document.getElementById("hud-bottom");
    if (!topEl || !sideEl || !bottomEl) return;

    this.lastHudStructureKey = this.computeHudStructureKey();
    const unlockedSlots = getUnlockedLoadoutSlots(this.profile.playerLevel);
    const st = this.battleState;

    topEl.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; background:var(--bg-panel); border:2px solid var(--border-stone); padding:10px 14px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-family:'Press Start 2P',monospace; font-size:13px; color:var(--accent-gold);">AEGIS PIXEL TD</span>
          <span data-testid="player-level-badge" style="background:#1e293b; border:1px solid var(--border-gold); padding:3px 8px; font-size:12px; font-weight:700;">
            Lv.${this.profile.playerLevel} (Slots: ${this.profile.loadout.length}/${unlockedSlots} | Max ${MAX_LOADOUT_SLOTS})
          </span>
          <span data-testid="meta-coins-badge" style="background:#1e293b; border:1px solid #38bdf8; padding:3px 8px; font-size:12px; color:#38bdf8; font-weight:700;">
            Meta Coins: ${this.profile.metaCoins}
          </span>
        </div>

        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button data-testid="tab-battle" id="btn-tab-battle" style="padding:6px 12px; background:${this.activeTab === "BATTLE" ? "var(--accent-gold)" : "#1e293b"}; color:${this.activeTab === "BATTLE" ? "#090b10" : "#f8fafc"}; border:1px solid var(--border-stone); font-weight:700; cursor:pointer;">
            สนามรบ (Battle)
          </button>
          <button data-testid="tab-roster" id="btn-tab-roster" style="padding:6px 12px; background:${this.activeTab === "ROSTER" ? "var(--accent-gold)" : "#1e293b"}; color:${this.activeTab === "ROSTER" ? "#090b10" : "#f8fafc"}; border:1px solid var(--border-stone); font-weight:700; cursor:pointer;">
            จัดทีม & สุ่ม Gacha (${this.profile.pityCounter}/${LEGENDARY_PITY_THRESHOLD})
          </button>
          <button data-testid="tab-leaderboard" id="btn-tab-leaderboard" style="padding:6px 12px; background:${this.activeTab === "LEADERBOARD" ? "var(--accent-gold)" : "#1e293b"}; color:${this.activeTab === "LEADERBOARD" ? "#090b10" : "#f8fafc"}; border:1px solid var(--border-stone); font-weight:700; cursor:pointer;">
            Endless Leaderboard (${this.profile.leaderboard.length})
          </button>
          <button data-testid="btn-mute" id="btn-mute" style="padding:6px 10px; background:#1e293b; color:#e2e8f0; border:1px solid var(--border-stone); cursor:pointer;">
            ${this.sound.isMuted() ? "เสียง: ปิด" : "เสียง: เปิด"}
          </button>
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:8px; background:#111622; border:1px solid var(--border-stone); padding:8px 14px; margin-top:6px;">
        <div style="display:flex; gap:14px; align-items:center; font-family:'JetBrains Mono',monospace; font-size:13px;">
          <span data-testid="hud-wave">WAVE: <strong style="color:var(--accent-gold);">${st.wave}${st.config.mode === "STAGE" ? `/${st.maxWave}` : " (ENDLESS)"}</strong></span>
          <span data-testid="hud-gold">GOLD: <strong style="color:#fde047;">${st.gold}</strong></span>
          <span data-testid="hud-hp">BASE HP: <strong style="color:${st.baseHp > 8 ? "#10b981" : "#ef4444"};">${st.baseHp}/${st.maxBaseHp}</strong></span>
          <span data-testid="hud-score">SCORE: <strong style="color:#38bdf8;">${st.score}</strong></span>
          <span data-testid="hud-phase" style="padding:2px 6px; background:#1e293b; font-size:11px;">${st.phase}</span>
        </div>
        <div style="display:flex; gap:6px; align-items:center;">
          <button data-testid="btn-start-wave" id="btn-start-wave" style="padding:5px 12px; background:${st.phase === "PREPARING" ? "#10b981" : "#334155"}; color:#090b10; font-weight:700; border:none; cursor:pointer;">
            ${st.wave === 0 ? "เริ่ม Wave 1" : "เรียก Wave ถัดไป (+Bonus)"}
          </button>
          <button data-testid="btn-speed" id="btn-speed" style="padding:5px 10px; background:#1e293b; color:#f8fafc; border:1px solid var(--border-stone); cursor:pointer;">
            Speed: ${this.speedMultiplier}x
          </button>
          <button data-testid="btn-mode-stage" id="btn-mode-stage" style="padding:5px 9px; background:${this.selectedMode === "STAGE" ? "#38bdf8" : "#1e293b"}; color:${this.selectedMode === "STAGE" ? "#090b10" : "#f8fafc"}; border:1px solid var(--border-stone); cursor:pointer; font-weight:600;">
            10-Wave Stage
          </button>
          <button data-testid="btn-mode-endless" id="btn-mode-endless" style="padding:5px 9px; background:${this.selectedMode === "ENDLESS" ? "#a855f7" : "#1e293b"}; color:#f8fafc; border:1px solid var(--border-stone); cursor:pointer; font-weight:600;">
            Endless Mode
          </button>
        </div>
      </div>
    `;

    if (this.activeTab === "BATTLE") {
      const selectedTileHero = st.deployedHeroes.find(
        (h) => h.col === this.selectedTile.col && h.row === this.selectedTile.row
      );
      const tileTerrain = getTileTerrain(this.selectedTile.col, this.selectedTile.row);
      const selectedHeroDef = HERO_CATALOG[this.selectedHeroToDeploy];

      sideEl.innerHTML = `
        <div style="background:var(--bg-panel); border:2px solid var(--border-stone); padding:12px; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span style="font-weight:700; color:var(--accent-gold);">เลือกด่าน & พิกัดวางอิสระ (20x13 Grid)</span>
            <div style="display:flex; gap:4px;">
              ${STAGE_CATALOG.map(
                (s) => `
                <button data-testid="btn-stage-${s.id}" class="btn-stage-select" data-stage="${s.id}" style="padding:3px 8px; font-size:11px; background:${this.selectedStageId === s.id ? "var(--accent-gold)" : "#1e293b"}; color:${this.selectedStageId === s.id ? "#090b10" : "#e2e8f0"}; border:1px solid var(--border-stone); cursor:pointer;">
                  ด่าน ${s.id}
                </button>`
              ).join("")}
            </div>
          </div>

          <div style="font-size:11px; color:#94a3b8;">
            คลิกช่องใดก็ได้บนแผนที่ (ยกเว้นทางเดิน) หรือเลือกพิกัดด่วนด้านล่าง:
          </div>

          <div>
            <div style="font-size:11px; color:#38bdf8; margin-bottom:4px; font-weight:700;">▲ ช่องที่สูง (High Ground — สำหรับ Cryo Warden & Aeon Sovereign):</div>
            <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:4px;">
              ${HIGH_GROUND_TILES.slice(0, 10)
                .map((t, idx) => {
                  const occ = st.deployedHeroes.find(
                    (h) => h.col === t.col && h.row === t.row
                  );
                  const isSel =
                    this.selectedTile.col === t.col && this.selectedTile.row === t.row;
                  return `<button data-testid="hg-tile-${idx}" class="btn-tile-select" data-col="${t.col}" data-row="${t.row}" style="padding:4px 2px; font-family:'JetBrains Mono',monospace; font-size:10px; background:${isSel ? "#f59e0b" : occ ? "#0284c7" : "#162a3a"}; color:${isSel ? "#090b10" : "#e0f2fe"}; border:1px solid #38bdf8; cursor:pointer;">
                    ▲(${t.col},${t.row})${occ ? "★" : ""}
                  </button>`;
                })
                .join("")}
            </div>
          </div>

          <div>
            <div style="font-size:11px; color:#10b981; margin-bottom:4px; font-weight:700;">■ ช่องพื้นราบแนะนำ (Ground — หรือคลิกช่องว่างใดก็ได้บนแผนที่):</div>
            <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:4px;">
              ${RECOMMENDED_GROUND_TILES.map((t, idx) => {
                const occ = st.deployedHeroes.find(
                  (h) => h.col === t.col && h.row === t.row
                );
                const isSel =
                  this.selectedTile.col === t.col && this.selectedTile.row === t.row;
                return `<button data-testid="ground-tile-${idx}" class="btn-tile-select" data-col="${t.col}" data-row="${t.row}" style="padding:4px 2px; font-family:'JetBrains Mono',monospace; font-size:10px; background:${isSel ? "#f59e0b" : occ ? "#059669" : "#1e293b"}; color:${isSel ? "#090b10" : "#f8fafc"}; border:1px solid var(--border-stone); cursor:pointer;">
                  (${t.col},${t.row})${occ ? "★" : ""}
                </button>`;
              }).join("")}
            </div>
          </div>

          <div style="background:var(--bg-card); border:1px solid var(--border-stone); padding:10px;">
            ${
              selectedTileHero
                ? (() => {
                    const def = HERO_CATALOG[selectedTileHero.heroId];
                    const upgCost = getHeroUpgradeCost(
                      selectedTileHero.heroId,
                      selectedTileHero.level
                    );
                    const skillReady = st.tick >= selectedTileHero.skillReadyAtTick;
                    const cdRemainSec = Math.max(
                      0,
                      (selectedTileHero.skillReadyAtTick - st.tick) / 20
                    ).toFixed(1);
                    const isSilenced = st.tick < selectedTileHero.silencedUntilTick;
                    return `
                      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
                        <strong>${def.name} (Lv.${selectedTileHero.level} ★${selectedTileHero.stars}) @ (${selectedTileHero.col},${selectedTileHero.row})</strong>
                        <span style="font-size:11px; color:#94a3b8;">DMG: ${getHeroEffectiveDamage(selectedTileHero)}</span>
                      </div>
                      <div style="font-size:12px; color:#cbd5e1; margin-bottom:8px;">
                        สกิลกดใช้: <strong style="color:#fde047;">${def.skillName}</strong> — ${def.skillDescThai}
                        ${isSilenced ? `<div style="color:#f87171; font-weight:700;">สถานะ: ติดใบ้จากบอส (ใช้ Sanctuary Cleanse ล้างได้)</div>` : ""}
                      </div>
                      <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px;">
                        <button data-testid="btn-cast-selected" id="btn-cast-selected" style="flex:1; padding:7px 10px; background:${skillReady ? "#eab308" : "#334155"}; color:#090b10; font-weight:700; border:none; cursor:pointer;">
                          ${skillReady ? `⚡ กดสกิล ${def.skillName}` : `Cooldown (${cdRemainSec}s)`}
                        </button>
                        <button data-testid="btn-upgrade-selected" id="btn-upgrade-selected" style="padding:7px 10px; background:#10b981; color:#090b10; font-weight:700; border:none; cursor:pointer;">
                          ${selectedTileHero.level >= 5 ? "MAX LV" : `อัปเกรด (${upgCost}G)`}
                        </button>
                        <button data-testid="btn-sell-selected" id="btn-sell-selected" style="padding:7px 8px; background:#ef4444; color:#fff; font-weight:700; border:none; cursor:pointer;">
                          ถอน
                        </button>
                      </div>
                      <div style="display:flex; gap:4px; align-items:center; font-size:11px;">
                        <span>เป้าเล็ง:</span>
                        ${(["FIRST", "STRONGEST", "CLOSEST", "WEAKEST"] as const)
                          .map(
                            (p) => `<button data-testid="btn-prio-${p}" class="btn-prio" data-prio="${p}" style="padding:3px 6px; font-size:10px; background:${selectedTileHero.targetPriority === p ? "#38bdf8" : "#0f172a"}; color:${selectedTileHero.targetPriority === p ? "#090b10" : "#cbd5e1"}; border:1px solid var(--border-stone); cursor:pointer;">${p}</button>`
                          )
                          .join("")}
                      </div>
                    `;
                  })()
                : `
                  <div data-testid="selected-tile-info" style="font-size:12px; color:#cbd5e1; margin-bottom:8px;">
                    พิกัดที่เลือก: <strong>(${this.selectedTile.col},${this.selectedTile.row})</strong> — พื้นที่: <strong style="color:${tileTerrain === "HIGH_GROUND" ? "#38bdf8" : tileTerrain === "GROUND" ? "#10b981" : "#ef4444"};">${tileTerrain}</strong>
                  </div>
                  <button data-testid="btn-deploy-on-tile" id="btn-deploy-on-tile" style="width:100%; padding:8px; background:var(--accent-gold); color:#090b10; font-weight:700; border:none; cursor:pointer;">
                    วาง ${selectedHeroDef.name} [${selectedHeroDef.placementDomain === "HIGH_GROUND" ? "ต้องวางที่สูง ▲HG" : "วางพื้นราบ"}] ลง (${this.selectedTile.col},${this.selectedTile.row}) (${selectedHeroDef.deployCost}G)
                  </button>
                `
            }
          </div>

          <div data-testid="status-banner" style="background:#0f172a; border-left:3px solid var(--accent-cyan); padding:8px 10px; font-size:12px; color:#e2e8f0;">
            ${this.statusBannerText}
          </div>
        </div>
      `;
    } else if (this.activeTab === "ROSTER") {
      sideEl.innerHTML = `
        <div style="background:var(--bg-panel); border:2px solid var(--border-stone); padding:12px; display:flex; flex-direction:column; gap:10px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:var(--accent-gold);">ตู้สุ่ม Hero Gacha (100 Coins)</strong>
            <span style="font-size:11px; color:#94a3b8;">การันตี Legend ใน ${LEGENDARY_PITY_THRESHOLD - this.profile.pityCounter} ครั้ง</span>
          </div>
          <button data-testid="btn-pull-gacha" id="btn-pull-gacha" style="padding:10px; background:linear-gradient(90deg,#f59e0b,#ec4899); color:#090b10; font-weight:700; border:none; cursor:pointer;">
            สุ่มหา Hero ใหม่ / อัปดาว (${GACHA_PULL_COST} Meta Coins)
          </button>
          ${
            this.gachaResultBanner
              ? `<div data-testid="gacha-result-banner" style="background:#1e293b; border:1px solid var(--border-gold); padding:8px; font-size:12px; color:#fde047;">${this.gachaResultBanner}</div>`
              : ""
          }
          <div style="font-size:12px; color:#94a3b8;">
            ช่องจัดทีมที่ปลดล็อกตาม Lv.${this.profile.playerLevel}: <strong>${this.profile.loadout.length}/${unlockedSlots}</strong> (สูงสุด 6 ช่องที่ Lv.5)
          </div>
          <div style="display:flex; flex-direction:column; gap:6px; max-height:260px; overflow-y:auto;">
            ${ALL_HERO_IDS.map((id) => {
              const def = HERO_CATALOG[id];
              const stars = this.profile.ownedHeroes[id] ?? 0;
              const inDeck = this.profile.loadout.includes(id);
              return `
                <div style="display:flex; justify-content:space-between; align-items:center; background:var(--bg-card); border:1px solid ${inDeck ? "var(--border-gold)" : "var(--border-stone)"}; padding:6px 8px;">
                  <div>
                    <div style="font-size:12px; font-weight:700;">
                      ${def.name}
                      <span style="font-size:10px; color:${def.placementDomain === "HIGH_GROUND" ? "#38bdf8" : "#10b981"};">[${def.placementDomain === "HIGH_GROUND" ? "▲ที่สูง" : "■พื้นราบ"} | วางได้ ${def.maxDeployCount}]</span>
                      ${stars > 0 ? `<span style="color:#fde047;">★${stars}</span>` : `<span style="color:#64748b;">(ล็อก)</span>`}
                    </div>
                    <div style="font-size:11px; color:#94a3b8;">${def.skillName}: ${def.skillDescThai}</div>
                  </div>
                  <button data-testid="btn-toggle-loadout-${id}" class="btn-toggle-loadout" data-hero="${id}" style="padding:4px 8px; font-size:11px; background:${inDeck ? "#ef4444" : stars > 0 ? "#10b981" : "#334155"}; color:#fff; border:none; cursor:pointer;">
                    ${inDeck ? "ถอดออก" : stars > 0 ? "ใส่ทีม" : "ยังไม่ปลด"}
                  </button>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    } else {
      sideEl.innerHTML = `
        <div style="background:var(--bg-panel); border:2px solid var(--border-stone); padding:12px; display:flex; flex-direction:column; gap:8px;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <strong style="color:var(--accent-gold);">Endless & Skill Play Leaderboard</strong>
            <button data-testid="btn-record-run" id="btn-record-run" style="padding:4px 8px; font-size:11px; background:#38bdf8; color:#090b10; font-weight:700; border:none; cursor:pointer;">
              บันทึกสถิติรอบปัจจุบัน
            </button>
          </div>
          <div style="font-size:11px; color:#94a3b8;">
            ทุกสถิติผ่านการตรวจสอบ Deterministic Replay (Seed + Action Log ของการวางและกดสกิล)
          </div>
          <div data-testid="leaderboard-list" style="display:flex; flex-direction:column; gap:6px; max-height:290px; overflow-y:auto;">
            ${this.profile.leaderboard
              .map(
                (entry, i) => `
                <div data-testid="leaderboard-row-${i}" style="background:var(--bg-card); border:1px solid var(--border-stone); padding:7px 9px; display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                  <div>
                    <strong>#${i + 1} ${entry.playerName}</strong>
                    <div style="font-size:10px; color:#94a3b8;">
                      Wave ${entry.waveReached} | กดสกิล ${entry.skillCasts} ครั้ง | Seed #${entry.seed}
                    </div>
                  </div>
                  <div style="text-align:right; font-family:'JetBrains Mono',monospace;">
                    <div style="color:#fde047; font-weight:700;">${entry.score} PTS</div>
                    <div style="font-size:9px; color:#10b981;">✓ REPLAY VERIFIED</div>
                  </div>
                </div>
              `
              )
              .join("")}
          </div>
        </div>
      `;
    }

    const slotsHtml: string[] = [];
    for (let slotIdx = 0; slotIdx < MAX_LOADOUT_SLOTS; slotIdx++) {
      const isUnlocked = slotIdx < unlockedSlots;
      const heroId = this.profile.loadout[slotIdx];
      if (!isUnlocked) {
        slotsHtml.push(`
          <div data-testid="loadout-slot-${slotIdx}" style="flex:1; min-width:140px; background:#0f131d; border:1px dashed #334155; padding:8px; color:#64748b; font-size:11px; text-align:center;">
            ช่องที่ ${slotIdx + 1} ล็อก<br/>(ปลดล็อกที่ Lv.${slotIdx})
          </div>
        `);
        continue;
      }
      if (!heroId) {
        slotsHtml.push(`
          <div data-testid="loadout-slot-${slotIdx}" style="flex:1; min-width:140px; background:#151924; border:1px dashed #475569; padding:8px; color:#94a3b8; font-size:11px; text-align:center;">
            ช่องที่ ${slotIdx + 1} ว่าง<br/>(เลือกใส่ในหน้าจัดทีม)
          </div>
        `);
        continue;
      }

      const def = HERO_CATALOG[heroId];
      const deployedCount = getDeployCountForHero(st, heroId);
      const isSelectedCard = this.selectedHeroToDeploy === heroId;
      const readyInstance = st.deployedHeroes.find(
        (h) => h.heroId === heroId && st.tick >= h.skillReadyAtTick
      );
      slotsHtml.push(`
        <div data-testid="loadout-slot-${slotIdx}" style="flex:1; min-width:155px; background:${isSelectedCard ? "#1e293b" : "var(--bg-panel)"}; border:2px solid ${isSelectedCard ? "var(--border-gold)" : "var(--border-stone)"}; padding:8px; display:flex; flex-direction:column; gap:5px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
            <strong>[${slotIdx + 1}] ${def.name}</strong>
            <span data-testid="deploy-cap-${heroId}" style="font-family:'JetBrains Mono',monospace; font-size:11px; padding:1px 5px; background:${deployedCount >= def.maxDeployCount ? "#ef4444" : "#0f172a"}; color:#fff;">
              ${deployedCount}/${def.maxDeployCount}
            </span>
          </div>
          <div style="font-size:10px; color:#94a3b8; display:flex; justify-content:space-between;">
            <span style="color:${def.placementDomain === "HIGH_GROUND" ? "#38bdf8" : "#10b981"};">${def.placementDomain === "HIGH_GROUND" ? "▲ ที่สูงเท่านั้น" : "■ พื้นราบทุกช่อง"}</span>
            <span>${def.deployCost}G | ★${this.profile.ownedHeroes[heroId] ?? 1}</span>
          </div>
          <div style="display:flex; gap:4px;">
            <button data-testid="select-hero-${heroId}" class="btn-select-card" data-hero="${heroId}" style="flex:1; padding:4px; font-size:11px; background:${isSelectedCard ? "var(--accent-gold)" : "#334155"}; color:${isSelectedCard ? "#090b10" : "#f8fafc"}; font-weight:700; border:none; cursor:pointer;">
              เลือกวาง
            </button>
            <button data-testid="quick-skill-${heroId}" class="btn-quick-skill" data-hero="${heroId}" style="flex:1; padding:4px; font-size:11px; background:${readyInstance ? "#eab308" : "#1e293b"}; color:${readyInstance ? "#090b10" : "#64748b"}; font-weight:700; border:1px solid var(--border-stone); cursor:pointer;">
              ⚡ ${def.skillName.split(" ")[0]}
            </button>
          </div>
        </div>
      `);
    }

    bottomEl.innerHTML = `
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        ${slotsHtml.join("")}
      </div>
    `;

    this.attachDomListeners();
  }

  private attachDomListeners(): void {
    document.getElementById("btn-tab-battle")?.addEventListener("click", () => this.setTab("BATTLE"));
    document.getElementById("btn-tab-roster")?.addEventListener("click", () => this.setTab("ROSTER"));
    document
      .getElementById("btn-tab-leaderboard")
      ?.addEventListener("click", () => this.setTab("LEADERBOARD"));
    document.getElementById("btn-mute")?.addEventListener("click", () => {
      this.sound.toggleMute();
      this.renderHud();
    });
    document.getElementById("btn-start-wave")?.addEventListener("click", () => {
      this.dispatchGameCommand({ kind: "START_WAVE", tick: this.battleState.tick });
    });
    document.getElementById("btn-speed")?.addEventListener("click", () => {
      this.speedMultiplier =
        this.speedMultiplier === 1 ? 2 : this.speedMultiplier === 2 ? 4 : 1;
      this.renderHud();
    });
    document.getElementById("btn-mode-stage")?.addEventListener("click", () => {
      this.startNewBattle(this.selectedStageId, "STAGE");
    });
    document.getElementById("btn-mode-endless")?.addEventListener("click", () => {
      this.startNewBattle(this.selectedStageId, "ENDLESS");
    });
    document.getElementById("btn-deploy-on-tile")?.addEventListener("click", () => {
      this.dispatchGameCommand({
        kind: "DEPLOY",
        tick: this.battleState.tick,
        heroId: this.selectedHeroToDeploy,
        col: this.selectedTile.col,
        row: this.selectedTile.row,
      });
    });

    const selectedTileHero = this.battleState.deployedHeroes.find(
      (h) => h.col === this.selectedTile.col && h.row === this.selectedTile.row
    );
    if (selectedTileHero) {
      document.getElementById("btn-cast-selected")?.addEventListener("click", () => {
        this.dispatchGameCommand({
          kind: "CAST_SKILL",
          tick: this.battleState.tick,
          instanceId: selectedTileHero.instanceId,
        });
      });
      document.getElementById("btn-upgrade-selected")?.addEventListener("click", () => {
        this.dispatchGameCommand({
          kind: "UPGRADE",
          tick: this.battleState.tick,
          instanceId: selectedTileHero.instanceId,
        });
      });
      document.getElementById("btn-sell-selected")?.addEventListener("click", () => {
        this.dispatchGameCommand({
          kind: "SELL",
          tick: this.battleState.tick,
          instanceId: selectedTileHero.instanceId,
        });
      });
    }

    document.querySelectorAll(".btn-prio").forEach((btn) => {
      btn.addEventListener("click", () => {
        const prio = (btn as HTMLElement).dataset.prio as TargetPriority;
        if (selectedTileHero && prio) {
          this.dispatchGameCommand({
            kind: "SET_TARGET",
            tick: this.battleState.tick,
            instanceId: selectedTileHero.instanceId,
            priority: prio,
          });
        }
      });
    });

    document.querySelectorAll(".btn-tile-select").forEach((btn) => {
      btn.addEventListener("click", () => {
        const col = Number((btn as HTMLElement).dataset.col);
        const row = Number((btn as HTMLElement).dataset.row);
        this.selectTile(col, row);
      });
    });

    document.querySelectorAll(".btn-stage-select").forEach((btn) => {
      btn.addEventListener("click", () => {
        const stageId = Number((btn as HTMLElement).dataset.stage);
        this.startNewBattle(stageId, this.selectedMode);
      });
    });

    document.querySelectorAll(".btn-select-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const heroId = (btn as HTMLElement).dataset.hero as HeroId;
        if (heroId) {
          this.selectedHeroToDeploy = heroId;
          this.battleScene.setActiveHeroToDeploy(heroId);
          this.renderHud();
        }
      });
    });

    document.querySelectorAll(".btn-quick-skill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const heroId = (btn as HTMLElement).dataset.hero as HeroId;
        if (heroId) {
          this.castSkillForHeroType(heroId);
        }
      });
    });

    document.getElementById("btn-pull-gacha")?.addEventListener("click", () => {
      this.performGachaPull();
    });

    document.querySelectorAll(".btn-toggle-loadout").forEach((btn) => {
      btn.addEventListener("click", () => {
        const heroId = (btn as HTMLElement).dataset.hero as HeroId;
        if (heroId) {
          this.toggleLoadoutHero(heroId);
        }
      });
    });

    document.getElementById("btn-record-run")?.addEventListener("click", () => {
      this.profile = awardBattleCompletion(this.profile, {
        playerName: "Commander You",
        config: this.battleState.config,
        finalTick: Math.max(1, this.battleState.tick),
        waveReached: Math.max(1, this.battleState.wave),
        victory: this.battleState.phase === "VICTORY",
        commandLog: this.battleState.commandLog,
      });
      saveProfile(this.profile);
      this.renderHud();
    });
  }
}

declare global {
  interface Window {
    __TD_APP__?: TowerDefenseController;
  }
}

const battleScene = new BattleScene();

const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.CANVAS,
  parent: "phaser-mount",
  width: MAP_WIDTH,
  height: MAP_HEIGHT,
  backgroundColor: "#0c0e14",
  pixelArt: true,
  roundPixels: true,
  scene: [battleScene],
};

const game = new Phaser.Game(gameConfig);

game.events.once("ready", () => {
  window.__TD_APP__ = new TowerDefenseController(battleScene);
});
