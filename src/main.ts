import Phaser from "phaser";
import { SoundEngine } from "./audio/sound-engine";
import {
  ALL_HERO_IDS,
  ELEMENT_SYNERGY_DEFS,
  getTileTerrainForStage,
  getUnlockedLoadoutSlots,
  HERO_CATALOG,
  MAP_HEIGHT,
  MAP_WIDTH,
  MAX_LOADOUT_SLOTS,
  RARITY_CONFIG,
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
  completeAccountTutorial,
  createDefaultProfile,
  GACHA_PULL_COST,
  isStageDifficultyUnlocked,
  pullGachaBatchWithSeed,
  pullGachaWithSeed,
  RARE_PITY_THRESHOLD,
   toggleHeroInLoadout,
  ULTRA_RARE_PITY_THRESHOLD,
} from "./core/progression";
import {
  BattleMode,
  BattleState,
  GameCommand,
  HeroId,
  PlayerProfile,
  StageDifficulty,
  TargetPriority,
} from "./core/types";
import { BattleScene } from "./scenes/BattleScene";

const ACCOUNTS_STORAGE_KEY = "elemental_rift_td_accounts_v1";
const ACTIVE_USER_KEY = "elemental_rift_td_active_user_v1";

interface StoredAccountRecord {
  readonly username: string;
  readonly password: string;
  readonly profile: PlayerProfile;
}

function loadAccountsMap(): Record<string, StoredAccountRecord> {
  try {
    const raw = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, StoredAccountRecord>;
  } catch {
    return {};
  }
}

function saveAccountsMap(map: Record<string, StoredAccountRecord>): void {
  try {
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(map));
  } catch {
    return;
  }
}

function loadOrInitActiveProfile(): PlayerProfile {
  const accounts = loadAccountsMap();
  const activeUser = localStorage.getItem(ACTIVE_USER_KEY) || "Commander";
  const existing = accounts[activeUser];
  if (existing && existing.profile && existing.profile.unlockedStageDifficulties) {
    return existing.profile;
  }
  const fresh = createDefaultProfile(activeUser);
  accounts[activeUser] = {
    username: activeUser,
    password: "",
    profile: fresh,
  };
  saveAccountsMap(accounts);
  try {
    localStorage.setItem(ACTIVE_USER_KEY, activeUser);
  } catch {
    // ignore
  }
  return fresh;
}

function persistProfile(profile: PlayerProfile): void {
  const accounts = loadAccountsMap();
  const existing = accounts[profile.username];
  accounts[profile.username] = {
    username: profile.username,
    password: existing?.password ?? "",
    profile,
  };
  saveAccountsMap(accounts);
  try {
    localStorage.setItem(ACTIVE_USER_KEY, profile.username);
  } catch {
    return;
  }
}

type ActiveTab = "BATTLE" | "STAGES" | "ROSTER" | "LEADERBOARD" | "ACCOUNT";

function getRecommendedGroundTilesForStage(
  stageId: number
): readonly { readonly col: number; readonly row: number }[] {
  const candidates: { readonly col: number; readonly row: number }[] = [
    { col: 2, row: 3 },
    { col: 2, row: 4 },
    { col: 4, row: 5 },
    { col: 6, row: 4 },
    { col: 7, row: 5 },
    { col: 8, row: 6 },
    { col: 10, row: 4 },
    { col: 12, row: 6 },
    { col: 13, row: 5 },
    { col: 14, row: 8 },
  ];
  const valid = candidates.filter(
    (t) => getTileTerrainForStage(stageId, t.col, t.row) === "GROUND"
  );
  return valid.slice(0, 6);
}

class TowerDefenseController {
  private profile: PlayerProfile;
  private battleState: BattleState;
  private battleScene: BattleScene;
  private sound = new SoundEngine();

  private activeTab: ActiveTab = "BATTLE";
  private selectedStageId = 1;
  private selectedDifficulty: StageDifficulty = "EASY";
  private selectedMode: BattleMode = "STAGE";
  private selectedHeroToDeploy: HeroId = "archer";
  private selectedTile: { col: number; row: number } = { col: 2, row: 3 };
  private speedMultiplier: 1 | 2 | 4 = 1;
  private statusBannerText =
    "พร้อมรบ: คลิกช่องว่างบนแผนที่เพื่อวาง Hero ได้ทันที (ยกเว้นทางเดินศัตรู | ช่อง ▲HG สำหรับสายที่สูง)";
  private gachaResultBanner = "";
  private authBannerText = "";
  private completionRecorded = false;
  private lastHudStructureKey = "";

  constructor(scene: BattleScene) {
    this.profile = loadOrInitActiveProfile();
    this.battleScene = scene;
    this.selectedHeroToDeploy = this.profile.loadout[0] ?? "archer";
    this.battleScene.setActiveHeroToDeploy(this.selectedHeroToDeploy);
    this.battleScene.setSelectedTile(this.selectedTile.col, this.selectedTile.row);
    this.battleState = this.buildNewBattleState(20261030);

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
      difficulty: this.selectedDifficulty,
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
    const synKey = st.activeSynergies
      .map((s) => `${s.element}:${s.deployedUnits}:${s.active ? 1 : 0}`)
      .join(",");
    return [
      this.profile.username,
      this.profile.tutorialCompleted ? 1 : 0,
      this.profile.tutorialStep,
      this.activeTab,
      this.selectedStageId,
      this.selectedDifficulty,
      this.selectedMode,
      this.selectedHeroToDeploy,
      `${this.selectedTile.col},${this.selectedTile.row}`,
      this.speedMultiplier,
      st.phase,
      st.wave,
      readyFlags,
      synKey,
      this.profile.metaCoins,
      this.profile.pityCounter,
      this.profile.rarePityCounter,
      this.profile.playerLevel,
      this.profile.loadout.join(","),
      Object.keys(this.profile.unlockedStageDifficulties).sort().join(","),
      this.profile.leaderboard.length,
    ].join("|");
  }

  public startNewBattle(
    stageId: number,
    mode: BattleMode,
    difficulty: StageDifficulty = this.selectedDifficulty,
    customSeed?: number
  ): boolean {
    if (!isStageDifficultyUnlocked(this.profile, stageId, difficulty)) {
      this.statusBannerText = `ด่าน ${stageId} [${difficulty}] ยังล็อกอยู่ ต้องชนะด่านก่อนหน้าตามเงื่อนไขก่อน`;
      this.renderHud();
      return false;
    }
    this.selectedStageId = stageId;
    this.selectedDifficulty = difficulty;
    this.selectedMode = mode;
    const seed = customSeed ?? ((Date.now() & 0x7fffffff) || 20261030);
    this.battleState = this.buildNewBattleState(seed);
    const stageDef = STAGE_CATALOG.find((s) => s.id === stageId) ?? STAGE_CATALOG[0]!;
    this.statusBannerText = `เข้าสู่ ${stageDef.subtitleThai} [${difficulty}] (${mode === "STAGE" ? "10 Waves" : "Endless Mode"})`;
    this.battleScene.syncBattleState(this.battleState);
    this.renderHud();
    return true;
  }

  public simulateStageClearForVerification(
    stageId = this.selectedStageId,
    difficulty: StageDifficulty = this.selectedDifficulty
  ): PlayerProfile {
    this.profile = awardBattleCompletion(this.profile, {
      playerName: this.profile.username,
      config: {
        ...this.battleState.config,
        stageId,
        difficulty,
        mode: "STAGE",
      },
      finalTick: Math.max(10, this.battleState.tick),
      waveReached: 10,
      victory: true,
      commandLog: this.battleState.commandLog,
    });
    persistProfile(this.profile);
    this.statusBannerText = `ผ่านด่าน ${stageId} [${difficulty}] สำเร็จ! ปลดล็อกระดับถัดไปเรียบร้อย`;
    this.renderHud();
    return this.profile;
  }

  public registerOrLoginAccount(usernameRaw: string, passwordRaw: string): boolean {
    const username = usernameRaw.trim();
    if (username.length < 2) {
      this.authBannerText = "กรุณาระบุชื่อบัญชีอย่างน้อย 2 ตัวอักษร";
      this.renderHud();
      return false;
    }
    const accounts = loadAccountsMap();
    const existing = accounts[username];
    if (existing) {
      if (existing.password && existing.password !== passwordRaw) {
        this.authBannerText = "รหัสผ่านไม่ถูกต้องสำหรับบัญชีนี้";
        this.renderHud();
        return false;
      }
      this.profile = existing.profile;
      this.authBannerText = `เข้าสู่ระบบบัญชี "${username}" สำเร็จ`;
    } else {
      const fresh = createDefaultProfile(username);
      accounts[username] = {
        username,
        password: passwordRaw,
        profile: fresh,
      };
      saveAccountsMap(accounts);
      this.profile = fresh;
      this.authBannerText = `สมัครบัญชีใหม่ "${username}" สำเร็จ เริ่มต้นคู่มือสอนเล่นครั้งแรก`;
    }
    persistProfile(this.profile);
    this.selectedStageId = 1;
    this.selectedDifficulty = "EASY";
    this.selectedHeroToDeploy = this.profile.loadout[0] ?? "archer";
    this.battleState = this.buildNewBattleState(20261030);
    this.battleScene.syncBattleState(this.battleState);
    this.renderHud();
    return true;
  }

  public advanceOrCompleteTutorial(finishNow = false): void {
    if (finishNow || this.profile.tutorialStep >= 4) {
      this.profile = completeAccountTutorial(this.profile);
      persistProfile(this.profile);
      this.statusBannerText = "ผ่านการฝึกสอนสำเร็จ! ได้รับโบนัสต้อนรับ +200 Meta Coins";
      this.renderHud();
      return;
    }
    this.profile = {
      ...this.profile,
      tutorialStep: this.profile.tutorialStep + 1,
    };
    persistProfile(this.profile);
    this.renderHud();
  }

  public reopenTutorial(): void {
    this.profile = {
      ...this.profile,
      tutorialStep: 1,
    };
    persistProfile(this.profile);
    this.renderHud();
  }

  public dispatchGameCommand(cmd: GameCommand): boolean {
    const res = applyCommand(this.battleState, cmd);
    this.battleState = res.state;
    if (res.ok) {
      this.statusBannerText = res.eventText;
      if (cmd.kind === "DEPLOY") {
        this.sound.playDeploy();
        if (!this.profile.tutorialCompleted && this.profile.tutorialStep === 2) {
          this.profile = { ...this.profile, tutorialStep: 3 };
          persistProfile(this.profile);
        }
      }
      if (cmd.kind === "CAST_SKILL") {
        this.sound.playSkillCast();
        if (!this.profile.tutorialCompleted && this.profile.tutorialStep === 3) {
          this.profile = { ...this.profile, tutorialStep: 4 };
          persistProfile(this.profile);
        }
      }
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

  public performGachaPull(count: 1 | 10 = 1, seedOverride?: number): void {
    const seed = seedOverride ?? ((Date.now() + this.profile.pityCounter * 997) >>> 0);
    if (count === 1) {
      const outcome = pullGachaWithSeed(this.profile, seed);
      if (!outcome.ok || !outcome.pulledHeroId) {
        this.gachaResultBanner = "เหรียญ Meta Coins ไม่พอ (ต้องการ 100 Coins)";
        this.renderHud();
        return;
      }
      this.profile = outcome.profile;
      persistProfile(this.profile);
      const def = HERO_CATALOG[outcome.pulledHeroId];
      this.sound.playGachaPull(def.rarity === "ULTRA_RARE" || def.rarity === "RARE");
      this.gachaResultBanner = outcome.isDuplicate
        ? `สุ่มซ้ำ! ${def.name} [${def.rarity}] เลื่อนขั้นเป็น ★${outcome.newStarLevel}`
        : `ปลดล็อก Hero ใหม่: ${def.name} [${def.rarity} | ${def.element}] (วางได้สูงสุด ${def.maxDeployCount} ตัว)`;
      this.renderHud();
      return;
    }

    const batch = pullGachaBatchWithSeed(this.profile, 10, seed);
    if (!batch.ok || batch.results.length === 0) {
      this.gachaResultBanner = "เหรียญ Meta Coins ไม่พอสำหรับสุ่ม 10 โรล (ต้องการ 1,000 Coins)";
      this.renderHud();
      return;
    }
    this.profile = batch.profile;
    persistProfile(this.profile);
    const hasUltra = batch.results.some((r) => r.rarity === "ULTRA_RARE");
    this.sound.playGachaPull(hasUltra);
    const summary = batch.results
      .map((r) => `${HERO_CATALOG[r.heroId].name} (${r.rarity})`)
      .join(", ");
    this.gachaResultBanner = `ผลสุ่ม 10 โรล: ${summary}`;
    this.renderHud();
  }

  public toggleLoadoutHero(heroId: HeroId): void {
    const res = toggleHeroInLoadout(this.profile, heroId);
    this.profile = res.profile;
    persistProfile(this.profile);
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
      if (
        document.activeElement &&
        document.activeElement.tagName.toLowerCase() === "input"
      ) {
        return;
      }
      if (ev.key >= "1" && ev.key <= "6") {
        const idx = Number(ev.key) - 1;
        const heroId = this.profile.loadout[idx];
        if (heroId) {
          this.selectedHeroToDeploy = heroId;
          this.battleScene.setActiveHeroToDeploy(heroId);
          if (!this.profile.tutorialCompleted && this.profile.tutorialStep === 1) {
            this.profile = { ...this.profile, tutorialStep: 2 };
            persistProfile(this.profile);
          }
          this.statusBannerText = `เลือกการ์ด ${HERO_CATALOG[heroId].name} [${HERO_CATALOG[heroId].element}]`;
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
          playerName: this.profile.username,
          config: this.battleState.config,
          finalTick: this.battleState.tick,
          waveReached: this.battleState.wave,
          victory: this.battleState.phase === "VICTORY",
          commandLog: this.battleState.commandLog,
        });
        persistProfile(this.profile);
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
      waveEl.innerHTML = `WAVE <strong style="color:var(--accent-amber);">${st.wave}${st.config.mode === "STAGE" ? `/${st.maxWave}` : " (ENDLESS)"}</strong>`;
    }
    const goldEl = document.querySelector('[data-testid="hud-gold"]');
    if (goldEl) {
      goldEl.innerHTML = `GOLD <strong style="color:#fde047;">${st.gold}</strong>`;
    }
    const hpEl = document.querySelector('[data-testid="hud-hp"]');
    if (hpEl) {
      hpEl.innerHTML = `BASE HP <strong style="color:${st.baseHp > 8 ? "#10b981" : "#f43f5e"};">${st.baseHp}/${st.maxBaseHp}</strong>`;
    }
    const scoreEl = document.querySelector('[data-testid="hud-score"]');
    if (scoreEl) {
      scoreEl.innerHTML = `SCORE <strong style="color:var(--accent-sky);">${st.score}</strong>`;
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
        ? `กดสกิล ${def.skillName}`
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
      selectedStageId: this.selectedStageId,
      selectedDifficulty: this.selectedDifficulty,
      selectedHeroToDeploy: this.selectedHeroToDeploy,
      selectedTile: this.selectedTile,
      activeTab: this.activeTab,
    };
  }

  public renderHud(): void {
    const topEl = document.getElementById("hud-top");
    const tutEl = document.getElementById("hud-tutorial");
    const sideEl = document.getElementById("hud-side");
    const bottomEl = document.getElementById("hud-bottom");
    const drawerEl = document.getElementById("hud-drawer");
    if (!topEl || !tutEl || !sideEl || !bottomEl || !drawerEl) return;

    this.lastHudStructureKey = this.computeHudStructureKey();
    const unlockedSlots = getUnlockedLoadoutSlots(this.profile.playerLevel);
    const st = this.battleState;
    const stageDef =
      STAGE_CATALOG.find((s) => s.id === this.selectedStageId) ?? STAGE_CATALOG[0]!;

    topEl.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:10px 16px;">
        <div style="display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
          <h1 style="font-family:'Press Start 2P',monospace; font-size:14px; color:var(--accent-amber); letter-spacing:-0.02em;">
            ELEMENTAL RIFT TD
          </h1>
          <span data-testid="account-badge" class="num" style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:6px; padding:4px 10px; font-size:12px; color:var(--text-primary);">
            ผู้เล่น: <strong>${this.profile.username}</strong>
          </span>
          <span data-testid="player-level-badge" class="num" style="background:var(--bg-elevated); border:1px solid var(--border-focus); border-radius:6px; padding:4px 10px; font-size:12px; font-weight:700;">
            Lv.${this.profile.playerLevel} (Slots ${this.profile.loadout.length}/${unlockedSlots} | Max ${MAX_LOADOUT_SLOTS})
          </span>
          <span data-testid="meta-coins-badge" class="num" style="background:var(--bg-elevated); border:1px solid var(--accent-sky); border-radius:6px; padding:4px 10px; font-size:12px; color:var(--accent-sky); font-weight:700;">
            Meta Coins: ${this.profile.metaCoins}
          </span>
        </div>

        <nav style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
          <button data-testid="tab-battle" id="btn-tab-battle" class="btn-touch" style="background:${this.activeTab === "BATTLE" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeTab === "BATTLE" ? "#090d16" : "var(--text-primary)"};">
            สนามรบ
          </button>
          <button data-testid="tab-stages" id="btn-tab-stages" class="btn-touch" style="background:${this.activeTab === "STAGES" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeTab === "STAGES" ? "#090d16" : "var(--text-primary)"};">
            เลือกด่าน (1-10)
          </button>
          <button data-testid="tab-roster" id="btn-tab-roster" class="btn-touch" style="background:${this.activeTab === "ROSTER" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeTab === "ROSTER" ? "#090d16" : "var(--text-primary)"};">
            สุ่ม Gacha & จัดทีม (${this.profile.pityCounter}/${ULTRA_RARE_PITY_THRESHOLD})
          </button>
          <button data-testid="tab-leaderboard" id="btn-tab-leaderboard" class="btn-touch" style="background:${this.activeTab === "LEADERBOARD" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeTab === "LEADERBOARD" ? "#090d16" : "var(--text-primary)"};">
            Leaderboard (${this.profile.leaderboard.length})
          </button>
          <button data-testid="tab-account" id="btn-tab-account" class="btn-touch" style="background:${this.activeTab === "ACCOUNT" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeTab === "ACCOUNT" ? "#090d16" : "var(--text-primary)"};">
            บัญชี & สอนเล่น
          </button>
          <button data-testid="btn-mute" id="btn-mute" class="btn-touch">
            ${this.sound.isMuted() ? "เสียง: ปิด" : "เสียง: เปิด"}
          </button>
        </nav>
      </div>

      <div style="display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:8px 16px; margin-top:8px;">
        <div class="num" style="display:flex; gap:16px; align-items:center; flex-wrap:wrap; font-size:13px;">
          <span data-testid="hud-stage-badge" style="color:var(--text-secondary);">
            <strong>${stageDef.subtitleThai}</strong> [${this.selectedDifficulty}]
          </span>
          <span data-testid="hud-wave">WAVE <strong style="color:var(--accent-amber);">${st.wave}${st.config.mode === "STAGE" ? `/${st.maxWave}` : " (ENDLESS)"}</strong></span>
          <span data-testid="hud-gold">GOLD <strong style="color:#fde047;">${st.gold}</strong></span>
          <span data-testid="hud-hp">BASE HP <strong style="color:${st.baseHp > 8 ? "#10b981" : "#f43f5e"};">${st.baseHp}/${st.maxBaseHp}</strong></span>
          <span data-testid="hud-score">SCORE <strong style="color:var(--accent-sky);">${st.score}</strong></span>
          <span data-testid="hud-phase" style="padding:2px 8px; background:var(--bg-elevated); border-radius:4px; font-size:11px;">${st.phase}</span>
        </div>

        <div data-testid="synergy-bar" style="display:flex; gap:6px; align-items:center; flex-wrap:wrap;">
          ${st.activeSynergies
            .map((syn) => {
              const def = ELEMENT_SYNERGY_DEFS[syn.element];
              return `<span data-testid="synergy-pill-${syn.element}" class="num" title="${def.descThai}" style="font-size:11px; padding:3px 8px; border-radius:4px; border:1px solid ${syn.active ? def.colorHex : "var(--border-subtle)"}; background:${syn.active ? "var(--bg-elevated)" : "var(--bg-void)"}; color:${syn.active ? def.colorHex : "var(--text-muted)"}; font-weight:${syn.active ? "700" : "500"};">
                ${syn.element} ${syn.deployedUnits}/2 ${syn.active ? "ACTIVE" : ""}
              </span>`;
            })
            .join("")}
        </div>

        <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
          <button data-testid="btn-start-wave" id="btn-start-wave" class="btn-touch" style="background:${st.phase === "PREPARING" ? "var(--accent-emerald)" : "var(--bg-elevated)"}; color:${st.phase === "PREPARING" ? "#090d16" : "var(--text-primary)"}; border:none;">
            ${st.wave === 0 ? "เริ่ม Wave 1" : "เรียก Wave ถัดไป (+Bonus)"}
          </button>
          <button data-testid="btn-speed" id="btn-speed" class="btn-touch num">
            Speed: ${this.speedMultiplier}x
          </button>
          <button data-testid="btn-mode-stage" id="btn-mode-stage" class="btn-touch" style="background:${this.selectedMode === "STAGE" ? "var(--accent-sky)" : "var(--bg-elevated)"}; color:${this.selectedMode === "STAGE" ? "#090d16" : "var(--text-primary)"};">
            10-Wave Stage
          </button>
          <button data-testid="btn-mode-endless" id="btn-mode-endless" class="btn-touch" style="background:${this.selectedMode === "ENDLESS" ? "var(--accent-violet)" : "var(--bg-elevated)"}; color:#f8fafc;">
            Endless Mode
          </button>
        </div>
      </div>
    `;

    if (this.profile.tutorialStep > 0 && !this.profile.tutorialCompleted) {
      const stepMessages: Readonly<Record<number, string>> = {
        1: "ขั้นที่ 1/4 (เลือกการ์ด Hero): กดเลือกการ์ด Hero ด้านล่างจอ (หรือปุ่มคีย์บอร์ด 1-6) สังเกตโควตาจำนวนวาง (6/4/2/1) และธาตุประจำตัว",
        2: "ขั้นที่ 2/4 (วาง Hero & เปิด Elemental Synergy): คลิกวาง Hero บนแผนที่ (ช่องพื้นราบ หรือช่องที่สูง ▲HG) หากวางธาตุเดียวกันครบ 2 ตัว จะเปิดบัฟ Elemental Synergy ทันที",
        3: "ขั้นที่ 3/4 (เริ่มรบ & กดใช้ Active Skill): กดปุ่ม 'เริ่ม Wave 1' แล้วกดปุ่มสกิลของการ์ด (หรือปุ่ม Q) เพื่อปล่อยท่าไม้ตาย",
        4: "ขั้นที่ 4/4 (การปลดล็อก 10 ด่าน & การันตี 20 โรล): ชนะด่าน Easy จะปลดล็อกทั้ง Medium ของด่านนั้นและ Easy ของด่านถัดไป กดรับรางวัลฝึกสอน +200 Meta Coins ได้เลย!",
      };
      tutEl.innerHTML = `
        <div data-testid="tutorial-banner" style="background:var(--bg-elevated); border:1px solid var(--accent-amber); border-radius:12px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap;">
          <div>
            <div style="font-size:13px; font-weight:700; color:var(--accent-amber); margin-bottom:2px;">
              คู่มือฝึกสอนผู้บัญชาการใหม่ (${this.profile.username}) — ขั้นที่ ${this.profile.tutorialStep}/4
            </div>
            <div style="font-size:13px; color:var(--text-primary);">
              ${stepMessages[this.profile.tutorialStep] ?? stepMessages[4]}
            </div>
          </div>
          <div style="display:flex; gap:8px;">
            <button data-testid="btn-tutorial-next" id="btn-tutorial-next" class="btn-touch" style="background:var(--accent-amber); color:#090d16; border:none;">
              ${this.profile.tutorialStep >= 4 ? "รับ +200 Coins & จบการสอน" : "ขั้นตอนถัดไป"}
            </button>
            <button data-testid="btn-tutorial-skip" id="btn-tutorial-skip" class="btn-touch">
              ข้ามและรับ +200 Coins
            </button>
          </div>
        </div>
      `;
    } else {
      tutEl.innerHTML = "";
    }

    const selectedTileHero = st.deployedHeroes.find(
      (h) => h.col === this.selectedTile.col && h.row === this.selectedTile.row
    );
    const tileTerrain = getTileTerrainForStage(
      this.selectedStageId,
      this.selectedTile.col,
      this.selectedTile.row
    );
    const selectedHeroDef = HERO_CATALOG[this.selectedHeroToDeploy];
    const stageHgTiles = stageDef.highGroundTiles;

    sideEl.innerHTML = `
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:14px; display:flex; flex-direction:column; gap:12px; height:100%;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h2 style="font-size:15px; font-weight:700; color:var(--text-primary);">ศูนย์บัญชาการสนามรบ</h2>
          <span class="num" style="font-size:12px; color:var(--accent-amber);">${stageDef.name}</span>
        </div>

        <div>
          <div style="font-size:12px; color:var(--accent-sky); margin-bottom:6px; font-weight:600;">
            พิกัดที่สูงประจำด่าน (▲HG สำหรับสายที่สูง):
          </div>
          <div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:6px;">
            ${stageHgTiles
              .slice(0, 10)
              .map((t, idx) => {
                const occ = st.deployedHeroes.find(
                  (h) => h.col === t.col && h.row === t.row
                );
                const isSel =
                  this.selectedTile.col === t.col && this.selectedTile.row === t.row;
                return `<button data-testid="hg-tile-${idx}" class="btn-tile-select num" data-col="${t.col}" data-row="${t.row}" style="min-height:34px; padding:4px 2px; font-size:11px; border-radius:6px; background:${isSel ? "var(--accent-amber)" : occ ? "#0284c7" : "var(--bg-elevated)"}; color:${isSel ? "#090d16" : "#e0f2fe"}; border:1px solid var(--accent-sky); cursor:pointer;">
                  ▲(${t.col},${t.row})${occ ? "*" : ""}
                </button>`;
              })
              .join("")}
          </div>
        </div>

        <div>
          <div style="font-size:12px; color:var(--accent-emerald); margin-bottom:6px; font-weight:600;">
            พิกัดพื้นราบด่วน (หรือคลิกช่องว่างใดก็ได้บนแผนที่):
          </div>
          <div style="display:grid; grid-template-columns:repeat(6, 1fr); gap:6px;">
            ${getRecommendedGroundTilesForStage(this.selectedStageId).map((t, idx) => {
              const occ = st.deployedHeroes.find(
                (h) => h.col === t.col && h.row === t.row
              );
              const isSel =
                this.selectedTile.col === t.col && this.selectedTile.row === t.row;
              return `<button data-testid="ground-tile-${idx}" class="btn-tile-select num" data-col="${t.col}" data-row="${t.row}" style="min-height:34px; padding:4px 2px; font-size:11px; border-radius:6px; background:${isSel ? "var(--accent-amber)" : occ ? "#059669" : "var(--bg-elevated)"}; color:${isSel ? "#090d16" : "var(--text-primary)"}; border:1px solid var(--border-subtle); cursor:pointer;">
                (${t.col},${t.row})${occ ? "*" : ""}
              </button>`;
            }).join("")}
          </div>
        </div>

        <div style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:10px; padding:12px;">
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
                      <strong>${def.name} [${def.element}] (Lv.${selectedTileHero.level} ★${selectedTileHero.stars})</strong>
                      <span class="num" style="font-size:12px; color:var(--text-secondary);">DMG ${getHeroEffectiveDamage(selectedTileHero, st.activeSynergies)}</span>
                    </div>
                    <div style="font-size:12px; color:var(--text-secondary); margin-bottom:10px;">
                      สกิล: <strong style="color:#fde047;">${def.skillName}</strong> — ${def.skillDescThai}
                      ${isSilenced ? `<div style="color:var(--accent-rose); font-weight:700;">สถานะ: ติดใบ้จากบอส</div>` : ""}
                    </div>
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:10px;">
                      <button data-testid="btn-cast-selected" id="btn-cast-selected" class="btn-touch" style="flex:1; background:${skillReady ? "#eab308" : "var(--bg-surface)"}; color:${skillReady ? "#090d16" : "var(--text-secondary)"}; border:none;">
                        ${skillReady ? `กดสกิล ${def.skillName}` : `Cooldown (${cdRemainSec}s)`}
                      </button>
                      <button data-testid="btn-upgrade-selected" id="btn-upgrade-selected" class="btn-touch" style="background:var(--accent-emerald); color:#090d16; border:none;">
                        ${selectedTileHero.level >= 5 ? "MAX LV" : `อัปเกรด (${upgCost}G)`}
                      </button>
                      <button data-testid="btn-sell-selected" id="btn-sell-selected" class="btn-touch" style="background:var(--accent-rose); color:#fff; border:none;">
                        ถอน
                      </button>
                    </div>
                    <div style="display:flex; gap:6px; align-items:center; font-size:11px;">
                      <span>เป้าเล็ง:</span>
                      ${(["FIRST", "STRONGEST", "CLOSEST", "WEAKEST"] as const)
                        .map(
                          (p) => `<button data-testid="btn-prio-${p}" class="btn-prio num" data-prio="${p}" style="padding:4px 8px; font-size:10px; border-radius:4px; background:${selectedTileHero.targetPriority === p ? "var(--accent-sky)" : "var(--bg-surface)"}; color:${selectedTileHero.targetPriority === p ? "#090d16" : "var(--text-secondary)"}; border:1px solid var(--border-subtle); cursor:pointer;">${p}</button>`
                        )
                        .join("")}
                    </div>
                  `;
                })()
              : `
                <div data-testid="selected-tile-info" style="font-size:13px; color:var(--text-secondary); margin-bottom:10px;">
                  พิกัดที่เลือก: <strong class="num">(${this.selectedTile.col},${this.selectedTile.row})</strong> — พื้นที่: <strong style="color:${tileTerrain === "HIGH_GROUND" ? "var(--accent-sky)" : tileTerrain === "GROUND" ? "var(--accent-emerald)" : "var(--accent-rose)"};">${tileTerrain}</strong>
                </div>
                <button data-testid="btn-deploy-on-tile" id="btn-deploy-on-tile" class="btn-touch" style="width:100%; background:var(--accent-amber); color:#090d16; border:none;">
                  วาง ${selectedHeroDef.name} [${selectedHeroDef.placementDomain === "HIGH_GROUND" ? "ที่สูง ▲HG" : "พื้นราบ"}] ลง (${this.selectedTile.col},${this.selectedTile.row}) (${selectedHeroDef.deployCost}G)
                </button>
              `
          }
        </div>

        <div data-testid="status-banner" style="background:var(--bg-void); border:1px solid var(--border-subtle); border-radius:8px; padding:10px 12px; font-size:12px; color:var(--text-primary); margin-top:auto;">
          ${this.statusBannerText}
        </div>
      </div>
    `;

    const slotsHtml: string[] = [];
    for (let slotIdx = 0; slotIdx < MAX_LOADOUT_SLOTS; slotIdx++) {
      const isUnlocked = slotIdx < unlockedSlots;
      const heroId = this.profile.loadout[slotIdx];
      if (!isUnlocked) {
        slotsHtml.push(`
          <div data-testid="loadout-slot-${slotIdx}" style="background:var(--bg-surface); border:1px dashed var(--border-subtle); border-radius:12px; padding:12px; color:var(--text-muted); font-size:12px; display:flex; align-items:center; justify-content:center; text-align:center;">
            ช่องที่ ${slotIdx + 1} ล็อก (ปลดที่ Lv.${slotIdx})
          </div>
        `);
        continue;
      }
      if (!heroId) {
        slotsHtml.push(`
          <div data-testid="loadout-slot-${slotIdx}" style="background:var(--bg-surface); border:1px dashed var(--border-strong); border-radius:12px; padding:12px; color:var(--text-secondary); font-size:12px; display:flex; align-items:center; justify-content:center; text-align:center;">
            ช่องที่ ${slotIdx + 1} ว่าง (เลือกใส่ในหน้าสุ่ม Gacha & จัดทีม)
          </div>
        `);
        continue;
      }

      const def = HERO_CATALOG[heroId];
      const rarCfg = RARITY_CONFIG[def.rarity];
      const deployedCount = getDeployCountForHero(st, heroId);
      const isSelectedCard = this.selectedHeroToDeploy === heroId;
      const readyInstance = st.deployedHeroes.find(
        (h) => h.heroId === heroId && st.tick >= h.skillReadyAtTick
      );
      slotsHtml.push(`
        <div data-testid="loadout-slot-${slotIdx}" style="background:${isSelectedCard ? "var(--bg-elevated)" : "var(--bg-surface)"}; border:2px solid ${isSelectedCard ? "var(--accent-amber)" : "var(--border-subtle)"}; border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
            <strong>[${slotIdx + 1}] ${def.name}</strong>
            <span data-testid="deploy-cap-${heroId}" class="num" style="font-size:11px; padding:2px 6px; border-radius:4px; background:${deployedCount >= def.maxDeployCount ? "var(--accent-rose)" : "var(--bg-void)"}; color:#fff;">
              ${deployedCount}/${def.maxDeployCount}
            </span>
          </div>
          <div class="num" style="font-size:11px; color:var(--text-secondary); display:flex; justify-content:space-between;">
            <span style="color:${rarCfg.colorHex};">${def.rarity} · ${def.element}</span>
            <span>${def.deployCost}G · ★${this.profile.ownedHeroes[heroId] ?? 1}</span>
          </div>
          <div style="font-size:11px; color:${def.placementDomain === "HIGH_GROUND" ? "var(--accent-sky)" : "var(--accent-emerald)"};">
            ${def.placementDomain === "HIGH_GROUND" ? "▲ วางเฉพาะช่องที่สูง (HG)" : "■ วางพื้นราบทุกช่อง"}
          </div>
          <div style="display:flex; gap:6px; margin-top:2px;">
            <button data-testid="select-hero-${heroId}" class="btn-select-card btn-touch" data-hero="${heroId}" style="flex:1; min-height:34px; padding:4px 8px; font-size:12px; background:${isSelectedCard ? "var(--accent-amber)" : "var(--bg-interactive)"}; color:${isSelectedCard ? "#090d16" : "var(--text-primary)"}; border:none;">
              เลือกวาง
            </button>
            <button data-testid="quick-skill-${heroId}" class="btn-quick-skill btn-touch" data-hero="${heroId}" style="flex:1; min-height:34px; padding:4px 8px; font-size:12px; background:${readyInstance ? "#eab308" : "var(--bg-void)"}; color:${readyInstance ? "#090d16" : "var(--text-muted)"};">
              สกิล ${def.skillName.split(" ")[0]}
            </button>
          </div>
        </div>
      `);
    }

    bottomEl.innerHTML = `
      <div class="loadout-grid">
        ${slotsHtml.join("")}
      </div>
    `;

    drawerEl.innerHTML = this.renderBottomDrawerHtml();

    this.attachDomListeners();
  }

  private renderBottomDrawerHtml(): string {
    if (this.activeTab === "STAGES") {
      return `
        <div data-testid="drawer-stages" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <h2 style="font-size:16px; font-weight:700; color:var(--accent-amber);">แผนที่ทั้ง 10 ด่าน & ระดับความยาก (Cross-Progression Tree)</h2>
              <p style="font-size:12px; color:var(--text-secondary);">
                กฎการปลดล็อก: ชนะด่าน N [EASY] จะปลดล็อกทั้งด่าน N [MEDIUM] และด่าน N+1 [EASY] พร้อมกัน | ชนะ [MEDIUM] จะปลดล็อก [HARD]
              </p>
            </div>
          </div>
          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(230px, 1fr)); gap:10px;">
            ${STAGE_CATALOG.map((stage) => {
              const diffs: readonly StageDifficulty[] = ["EASY", "MEDIUM", "HARD"];
              return `
                <div data-testid="stage-card-${stage.id}" style="background:var(--bg-elevated); border:1px solid ${this.selectedStageId === stage.id ? "var(--accent-amber)" : "var(--border-subtle)"}; border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px;">
                  <div>
                    <div style="font-size:13px; font-weight:700; color:var(--text-primary);">${stage.subtitleThai}</div>
                    <div class="num" style="font-size:11px; color:var(--text-muted);">
                      Biome: ${stage.biomeName} · รางวัลพื้นฐาน ${stage.clearRewardCoins} Coins
                    </div>
                  </div>
                  <div style="display:flex; gap:6px;">
                    ${diffs
                      .map((diff) => {
                        const unlocked = isStageDifficultyUnlocked(
                          this.profile,
                          stage.id,
                          diff
                        );
                        const isActive =
                          this.selectedStageId === stage.id &&
                          this.selectedDifficulty === diff;
                        return `
                          <button data-testid="btn-stage-${stage.id}-${diff}" class="btn-stage-diff btn-touch num" data-stage="${stage.id}" data-diff="${diff}" ${unlocked ? "" : "disabled"} style="flex:1; min-height:36px; padding:4px; font-size:11px; background:${isActive ? "var(--accent-amber)" : unlocked ? "var(--bg-interactive)" : "var(--bg-void)"}; color:${isActive ? "#090d16" : unlocked ? "var(--text-primary)" : "var(--text-muted)"}; opacity:${unlocked ? "1" : "0.55"}; cursor:${unlocked ? "pointer" : "not-allowed"};">
                            ${diff}${unlocked ? "" : " (ล็อก)"}
                          </button>
                        `;
                      })
                      .join("")}
                  </div>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }

    if (this.activeTab === "ROSTER") {
      return `
        <div data-testid="drawer-roster" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
            <div>
              <h2 style="font-size:16px; font-weight:700; color:var(--accent-amber);">
                ตู้สุ่ม Elemental Rift Gacha (การันตี 20 โรล = ULTRA RARE 100%)
              </h2>
              <p class="num" style="font-size:12px; color:var(--text-secondary);">
                เรตสุ่ม: COMMON 55% (วาง 6) · UNCOMMON 28% (วาง 4) · RARE 13% (วาง 2) · ULTRA RARE 4% (วาง 1) | การันตี RARE+ ในอีก ${RARE_PITY_THRESHOLD - (this.profile.rarePityCounter ?? 0)} โรล | การันตี ULTRA RARE ในอีก ${ULTRA_RARE_PITY_THRESHOLD - this.profile.pityCounter} โรล
              </p>
            </div>
            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button data-testid="btn-pull-gacha" id="btn-pull-gacha" class="btn-touch" style="background:var(--accent-amber); color:#090d16; border:none;">
                สุ่ม 1 ครั้ง (${GACHA_PULL_COST} Coins)
              </button>
              <button data-testid="btn-pull-gacha-10" id="btn-pull-gacha-10" class="btn-touch" style="background:var(--accent-violet); color:#fff; border:none;">
                สุ่ม 10 ครั้งรวด (${GACHA_PULL_COST * 10} Coins)
              </button>
            </div>
          </div>

          ${
            this.gachaResultBanner
              ? `<div data-testid="gacha-result-banner" style="background:var(--bg-elevated); border:1px solid var(--accent-amber); border-radius:8px; padding:10px 14px; font-size:13px; color:#fde047;">${this.gachaResultBanner}</div>`
              : ""
          }

          <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px;">
            ${ALL_HERO_IDS.map((id) => {
              const def = HERO_CATALOG[id];
              const rarCfg = RARITY_CONFIG[def.rarity];
              const stars = this.profile.ownedHeroes[id] ?? 0;
              const inDeck = this.profile.loadout.includes(id);
              return `
                <div style="background:var(--bg-elevated); border:1px solid ${inDeck ? "var(--accent-amber)" : "var(--border-subtle)"}; border-radius:10px; padding:12px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
                  <div>
                    <div style="font-size:13px; font-weight:700;">
                      ${def.name}
                      <span class="num" style="font-size:11px; color:${rarCfg.colorHex};">[${def.rarity} · ${def.element}]</span>
                    </div>
                    <div style="font-size:11px; color:var(--text-secondary);">
                      โควตาวาง: <strong>${def.maxDeployCount} ตัว</strong> · ${def.placementDomain === "HIGH_GROUND" ? "▲ ที่สูง" : "■ พื้นราบ"} · ${stars > 0 ? `★${stars}` : "ยังไม่ปลดล็อก"}
                    </div>
                    <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${def.skillName}: ${def.skillDescThai}</div>
                  </div>
                  <button data-testid="btn-toggle-loadout-${id}" class="btn-toggle-loadout btn-touch" data-hero="${id}" style="background:${inDeck ? "var(--accent-rose)" : stars > 0 ? "var(--accent-emerald)" : "var(--bg-void)"}; color:#fff; border:none;">
                    ${inDeck ? "ถอดออก" : stars > 0 ? "ใส่ทีม" : "ล็อก"}
                  </button>
                </div>
              `;
            }).join("")}
          </div>
        </div>
      `;
    }

    if (this.activeTab === "LEADERBOARD") {
      return `
        <div data-testid="drawer-leaderboard" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
            <div>
              <h2 style="font-size:16px; font-weight:700; color:var(--accent-amber);">
                Competitive Endless & Stage Leaderboard
              </h2>
              <p style="font-size:12px; color:var(--text-secondary);">
                ทุกสถิติผูกกับชื่อ Account และผ่านการตรวจสอบ Deterministic Replay (Seed + Action Log)
              </p>
            </div>
            <button data-testid="btn-record-run" id="btn-record-run" class="btn-touch" style="background:var(--accent-sky); color:#090d16; border:none;">
              บันทึกสถิติรอบปัจจุบัน (${this.profile.username})
            </button>
          </div>
          <div data-testid="leaderboard-list" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:10px;">
            ${this.profile.leaderboard
              .map(
                (entry, i) => `
                <div data-testid="leaderboard-row-${i}" style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
                  <div>
                    <strong style="font-size:13px;">#${i + 1} ${entry.playerName}</strong>
                    <div class="num" style="font-size:11px; color:var(--text-secondary);">
                      ด่าน ${entry.stageId} [${entry.difficulty ?? "EASY"}] · Wave ${entry.waveReached} · สกิล ${entry.skillCasts} ครั้ง
                    </div>
                  </div>
                  <div class="num" style="text-align:right;">
                    <div style="color:#fde047; font-weight:700; font-size:14px;">${entry.score} PTS</div>
                    <div style="font-size:10px; color:var(--accent-emerald);">REPLAY VERIFIED</div>
                  </div>
                </div>
              `
              )
              .join("")}
          </div>
        </div>
      `;
    }

    if (this.activeTab === "ACCOUNT") {
      return `
        <div data-testid="drawer-account" style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:16px; display:flex; flex-direction:column; gap:14px;">
          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <div>
              <h2 style="font-size:16px; font-weight:700; color:var(--accent-amber);">
                ระบบบัญชีผู้เล่น (Register / Login) & คู่มือสอนเล่น
              </h2>
              <p style="font-size:12px; color:var(--text-secondary);">
                สมัครหรือสลับบัญชีเพื่อแยกข้อมูลความคืบหน้า 10 ด่าน, คลัง Hero, และชื่อบน Leaderboard (บัญชีใหม่จะได้เริ่ม Interactive Tutorial พร้อมรับ +200 Coins)
              </p>
            </div>
            <button data-testid="btn-reopen-tutorial" id="btn-reopen-tutorial" class="btn-touch">
              เปิดคู่มือสอนเล่นซ้ำ (Interactive Tutorial)
            </button>
          </div>

          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <input data-testid="input-username" id="input-username" type="text" placeholder="ชื่อผู้ใช้ (Username)" value="" style="min-height:40px; padding:8px 12px; border-radius:6px; border:1px solid var(--border-strong); background:var(--bg-void); color:var(--text-primary); font-size:13px;" />
            <input data-testid="input-password" id="input-password" type="password" placeholder="รหัสผ่าน (Password)" value="" style="min-height:40px; padding:8px 12px; border-radius:6px; border:1px solid var(--border-strong); background:var(--bg-void); color:var(--text-primary); font-size:13px;" />
            <button data-testid="btn-auth-submit" id="btn-auth-submit" class="btn-touch" style="background:var(--accent-emerald); color:#090d16; border:none;">
              สมัครสมาชิก / เข้าสู่ระบบ
            </button>
          </div>

          ${
            this.authBannerText
              ? `<div data-testid="auth-status-banner" style="background:var(--bg-elevated); border:1px solid var(--accent-emerald); border-radius:8px; padding:10px 12px; font-size:13px; color:var(--text-primary);">${this.authBannerText}</div>`
              : ""
          }
        </div>
      `;
    }

    const currentStageDef =
      STAGE_CATALOG.find((s) => s.id === this.selectedStageId) ?? STAGE_CATALOG[0]!;
    return `
      <div style="background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:12px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px;">
        <div style="font-size:13px; color:var(--text-secondary);">
          <strong>คำแนะนำด่วน:</strong> กดแท็บ <strong>เลือกด่าน (1-10)</strong> เพื่อเปลี่ยนแผนที่และความยาก Easy/Medium/Hard หรือกด <strong>สุ่ม Gacha & จัดทีม</strong> เพื่อสุ่มหาตัวละครระดับ ULTRA RARE (การันตีใน 20 โรล)
        </div>
        <div style="display:flex; gap:8px;">
          <button data-testid="quick-open-stages" id="quick-open-stages" class="btn-touch">
            เลือกด่าน 1-10 (${currentStageDef.subtitleThai})
          </button>
          <button data-testid="quick-open-gacha" id="quick-open-gacha" class="btn-touch" style="background:var(--accent-amber); color:#090d16; border:none;">
            เปิดตู้สุ่ม Gacha (${this.profile.pityCounter}/${ULTRA_RARE_PITY_THRESHOLD})
          </button>
        </div>
      </div>
    `;
  }

  private attachDomListeners(): void {
    document.getElementById("btn-tab-battle")?.addEventListener("click", () => this.setTab("BATTLE"));
    document.getElementById("btn-tab-stages")?.addEventListener("click", () => this.setTab("STAGES"));
    document.getElementById("btn-tab-roster")?.addEventListener("click", () => this.setTab("ROSTER"));
    document
      .getElementById("btn-tab-leaderboard")
      ?.addEventListener("click", () => this.setTab("LEADERBOARD"));
    document.getElementById("btn-tab-account")?.addEventListener("click", () => this.setTab("ACCOUNT"));
    document.getElementById("quick-open-stages")?.addEventListener("click", () => this.setTab("STAGES"));
    document.getElementById("quick-open-gacha")?.addEventListener("click", () => this.setTab("ROSTER"));

    document.getElementById("btn-tutorial-next")?.addEventListener("click", () => {
      this.advanceOrCompleteTutorial(false);
    });
    document.getElementById("btn-tutorial-skip")?.addEventListener("click", () => {
      this.advanceOrCompleteTutorial(true);
    });
    document.getElementById("btn-reopen-tutorial")?.addEventListener("click", () => {
      this.reopenTutorial();
    });

    document.getElementById("btn-auth-submit")?.addEventListener("click", () => {
      const u = (document.getElementById("input-username") as HTMLInputElement | null)?.value ?? "";
      const p = (document.getElementById("input-password") as HTMLInputElement | null)?.value ?? "";
      this.registerOrLoginAccount(u, p);
    });

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
      this.startNewBattle(this.selectedStageId, "STAGE", this.selectedDifficulty);
    });
    document.getElementById("btn-mode-endless")?.addEventListener("click", () => {
      this.startNewBattle(this.selectedStageId, "ENDLESS", this.selectedDifficulty);
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

    document.querySelectorAll(".btn-stage-diff").forEach((btn) => {
      btn.addEventListener("click", () => {
        const stageId = Number((btn as HTMLElement).dataset.stage);
        const diff = ((btn as HTMLElement).dataset.diff ?? "EASY") as StageDifficulty;
        if (this.startNewBattle(stageId, this.selectedMode, diff)) {
          this.setTab("BATTLE");
        }
      });
    });

    document.querySelectorAll(".btn-select-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const heroId = (btn as HTMLElement).dataset.hero as HeroId;
        if (heroId) {
          this.selectedHeroToDeploy = heroId;
          this.battleScene.setActiveHeroToDeploy(heroId);
          if (!this.profile.tutorialCompleted && this.profile.tutorialStep === 1) {
            this.profile = { ...this.profile, tutorialStep: 2 };
            persistProfile(this.profile);
          }
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
      this.performGachaPull(1);
    });
    document.getElementById("btn-pull-gacha-10")?.addEventListener("click", () => {
      this.performGachaPull(10);
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
        playerName: this.profile.username,
        config: this.battleState.config,
        finalTick: Math.max(1, this.battleState.tick),
        waveReached: Math.max(1, this.battleState.wave),
        victory: this.battleState.phase === "VICTORY",
        commandLog: this.battleState.commandLog,
      });
      persistProfile(this.profile);
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
  backgroundColor: "#090d16",
  pixelArt: true,
  roundPixels: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: MAP_WIDTH,
    height: MAP_HEIGHT,
  },
  scene: [battleScene],
};

const game = new Phaser.Game(gameConfig);

game.events.once("ready", () => {
  window.__TD_APP__ = new TowerDefenseController(battleScene);
});
