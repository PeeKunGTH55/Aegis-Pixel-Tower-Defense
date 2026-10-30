import Phaser from "phaser";
import {
  getHeroAvatarDataUrl,
  renderTutorialIllustrationSvg,
} from "./assets/pixel-sprites";
import { SoundEngine } from "./audio/sound-engine";
import {
  ALL_ELEMENTS,
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
  getHeroSkillCooldownTicks,
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
  HeroDefinition,
  HeroElement,
  HeroId,
  HeroRarity,
  PlayerProfile,
  StageDifficulty,
  TargetPriority,
} from "./core/types";
import { BattleScene } from "./scenes/BattleScene";

const ACCOUNTS_STORAGE_KEY = "elemental_rift_td_accounts_v2";
const ACTIVE_USER_KEY = "elemental_rift_td_active_user_v2";
const GLOBAL_LEADERBOARD_KEY = "elemental_rift_td_global_leaderboard_v2";

interface StoredAccountRecord {
  readonly username: string;
  readonly password: string;
  readonly profile: PlayerProfile;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function loadGlobalLeaderboard(): PlayerProfile["leaderboard"] {
  try {
    const raw = localStorage.getItem(GLOBAL_LEADERBOARD_KEY);
    if (!raw) return createDefaultProfile("Guest").leaderboard;
    const parsed = JSON.parse(raw) as PlayerProfile["leaderboard"];
    return Array.isArray(parsed) && parsed.length > 0
      ? parsed
      : createDefaultProfile("Guest").leaderboard;
  } catch {
    return createDefaultProfile("Guest").leaderboard;
  }
}

function saveGlobalLeaderboard(entries: PlayerProfile["leaderboard"]): void {
  try {
    localStorage.setItem(GLOBAL_LEADERBOARD_KEY, JSON.stringify(entries));
  } catch {
    return;
  }
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

function normalizeLoadedProfile(raw: PlayerProfile): PlayerProfile {
  const base = createDefaultProfile(raw.username || "Player");
  const globalLb = loadGlobalLeaderboard();
  const mergedLb = [...globalLb];
  for (const item of raw.leaderboard ?? []) {
    if (!mergedLb.some((e) => e.id === item.id)) {
      mergedLb.push(item);
    }
  }
  mergedLb.sort((a, b) => b.score - a.score || b.waveReached - a.waveReached);
  const topLb = mergedLb.slice(0, 15);
  return {
    ...base,
    ...raw,
    ownedHeroes: {
      ...base.ownedHeroes,
      ...(raw.ownedHeroes ?? {}),
    },
    unlockedStageDifficulties: {
      ...base.unlockedStageDifficulties,
      ...(raw.unlockedStageDifficulties ?? {}),
    },
    leaderboard: topLb,
  };
}

function loadExistingSessionProfile(): PlayerProfile | null {
  try {
    const activeUser = localStorage.getItem(ACTIVE_USER_KEY);
    if (!activeUser) return null;
    const accounts = loadAccountsMap();
    const existing = accounts[activeUser];
    if (existing && existing.profile) {
      return normalizeLoadedProfile(existing.profile);
    }
    return null;
  } catch {
    return null;
  }
}

function persistProfile(profile: PlayerProfile): void {
  const accounts = loadAccountsMap();
  const existing = accounts[profile.username];
  saveGlobalLeaderboard(profile.leaderboard);
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

export type ActiveModal =
  | null
  | "STAGES"
  | "GACHA"
  | "ROSTER"
  | "LEADERBOARD"
  | "ACCOUNT"
  | "TUTORIAL";

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

function describePassiveRoleThai(def: HeroDefinition): string {
  const terrainText =
    def.placementDomain === "HIGH_GROUND"
      ? "ซุ่มยิงจากแท่นที่สูง (▲HG)"
      : "ตั้งรับบนพื้นราบ";
  if (def.splashRadiusPx > 0 && def.slowPercent > 0) {
    return `โจมตีอัตโนมัติแบบระเบิดวงกว้าง (${def.splashRadiusPx}px) พร้อมสโลว์ศัตรู ${def.slowPercent}% (${terrainText}) เหมาะสำหรับชะลอฝูงมอนสเตอร์และเปิดธาตุ ${def.element}`;
  }
  if (def.splashRadiusPx > 0) {
    return `โจมตีอัตโนมัติแบบระเบิดพื้นที่รัศมี ${def.splashRadiusPx}px (${terrainText}) เหมาะสำหรับกวาดมอนสเตอร์กลุ่มใหญ่และเปิดธาตุ ${def.element}`;
  }
  if (def.slowPercent > 0) {
    return `โจมตีอัตโนมัติพร้อมลดความเร็วศัตรู ${def.slowPercent}% นาน ${(def.slowTicks / 20).toFixed(1)} วินาที (${terrainText}) ช่วยถ่วงเวลาให้ป้อมดาเมจหลัก`;
  }
  return `โจมตีเดี่ยวอัตโนมัติความเร็วสูง (${(20 / def.attackIntervalTicks).toFixed(2)} นัด/วินาที · ${terrainText}) ราคาประหยัด วางได้สูงสุด ${def.maxDeployCount} ตัวเพื่อสะสมจำนวนเปิดบัฟธาตุ ${def.element}`;
}

function formatRejectionReasonThai(reason: string): string {
  switch (reason) {
    case "TILE_IS_PATH":
      return "ห้ามวางทับเส้นทางเดินของมอนสเตอร์ (TILE_IS_PATH)";
    case "TERRAIN_MISMATCH":
      return "ประเภทพื้นที่ไม่ตรงกับตัวละคร — สังเกตป้าย ▲ที่สูง หรือ ■พื้นราบ (TERRAIN_MISMATCH)";
    case "TILE_OCCUPIED":
      return "ช่องนี้มี Hero วางอยู่แล้ว (TILE_OCCUPIED)";
    case "DEPLOY_CAP_REACHED":
      return "วาง Hero ตัวนี้ครบจำนวนสูงสุดในสนามแล้ว (DEPLOY_CAP_REACHED)";
    case "INSUFFICIENT_GOLD":
      return "Gold ในด่านไม่พอสำหรับการกระทำนี้ (INSUFFICIENT_GOLD)";
    case "HERO_HAS_NO_SKILL":
      return "ตัวละครนี้เป็นสาย PASSIVE โจมตีอัตโนมัติ ไม่มีสกิลกดใช้ (HERO_HAS_NO_SKILL)";
    case "SKILL_ON_COOLDOWN":
      return "สกิลยังติด Cooldown อยู่ กรุณารอสักครู่ (SKILL_ON_COOLDOWN)";
    case "HERO_SILENCED":
      return "ป้อมติดสถานะใบ้จากบอส ต้องรอหมดเวลาหรือใช้สกิลล้างคำสาป (HERO_SILENCED)";
    case "WAVE_ALREADY_ACTIVE":
      return "กำลังอยู่ในระหว่าง Wave รอให้เคลียร์มอนสเตอร์ชุดนี้ก่อน (WAVE_ALREADY_ACTIVE)";
    default:
      return `คำสั่งถูกปฏิเสธ (${reason})`;
  }
}

class TowerDefenseController {
  private profile: PlayerProfile;
  private isAuthenticated = true;
  private battleState: BattleState;
  private battleScene: BattleScene;
  private sound = new SoundEngine();

  private activeModal: ActiveModal = null;
  private selectedStageId = 1;
  private selectedDifficulty: StageDifficulty = "EASY";
  private selectedMode: BattleMode = "STAGE";
  private selectedHeroToDeploy: HeroId = "archer";
  private inspectedHeroId: HeroId = "frostmage";
  private selectedTile: { col: number; row: number } = { col: 2, row: 3 };
  private speedMultiplier: 1 | 2 | 4 = 1;
  private autoWaveEnabled = false;
  private rosterRarityFilter: HeroRarity | "ALL" = "ALL";
  private rosterElementFilter: HeroElement | "ALL" = "ALL";
  private statusBannerText =
    "พร้อมรบ: คลิกช่องว่างบนแผนที่เพื่อวาง Hero ได้ทันที (COMMON/UNCOMMON โจมตีอัตโนมัติ | RARE/ULTRA RARE มีสกิลกดใช้)";
  private gachaResultBanner = "";
  private lastPulledHeroes: {
    readonly heroId: HeroId;
    readonly rarity: HeroRarity;
    readonly isDuplicate: boolean;
    readonly newStarLevel: number;
  }[] = [];
  private authBannerText = "";
  private pendingAuthUsername = "";
  private completionRecorded = false;
  private lastHudStructureKey = "";

  constructor(scene: BattleScene) {
    const existingSession = loadExistingSessionProfile();
    if (existingSession) {
      this.profile = existingSession;
      this.isAuthenticated = true;
      this.activeModal = this.profile.tutorialCompleted ? null : "TUTORIAL";
    } else {
      this.profile = createDefaultProfile("");
      this.isAuthenticated = false;
      this.activeModal = "ACCOUNT";
    }
    this.battleScene = scene;
    this.selectedHeroToDeploy = this.profile.loadout[0] ?? "archer";
    this.inspectedHeroId = this.profile.loadout[0] ?? "frostmage";
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
      this.isAuthenticated ? 1 : 0,
      this.profile.username,
      this.profile.tutorialCompleted ? 1 : 0,
      this.profile.tutorialStep,
      this.activeModal ?? "NONE",
      this.inspectedHeroId,
      this.rosterRarityFilter,
      this.rosterElementFilter,
      this.selectedStageId,
      this.selectedDifficulty,
      this.selectedMode,
      this.selectedHeroToDeploy,
      `${this.selectedTile.col},${this.selectedTile.row}`,
      this.speedMultiplier,
      this.autoWaveEnabled ? 1 : 0,
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

  public openModal(modal: ActiveModal): void {
    if (!this.isAuthenticated && modal !== "ACCOUNT") {
      this.activeModal = "ACCOUNT";
      this.authBannerText = "กรุณาเข้าสู่ระบบหรือสมัครสมาชิกก่อนใช้งาน";
      this.renderHud();
      return;
    }
    if (modal === "TUTORIAL" && this.profile.tutorialStep <= 0) {
      this.profile = { ...this.profile, tutorialStep: 1 };
      persistProfile(this.profile);
    }
    this.activeModal = modal;
    this.renderHud();
  }

  public closeModal(): void {
    if (!this.isAuthenticated) {
      this.authBannerText = "กรุณาเข้าสู่ระบบหรือสมัครสมาชิกก่อนเข้าสู่สนามรบ";
      this.renderHud();
      return;
    }
    this.activeModal = null;
    this.renderHud();
  }

  public inspectHero(heroId: HeroId): void {
    this.inspectedHeroId = heroId;
    this.renderHud();
  }

  public logoutAccount(): void {
    this.isAuthenticated = false;
    this.autoWaveEnabled = false;
    this.activeModal = "ACCOUNT";
    this.authBannerText = "ออกจากระบบเรียบร้อย กรุณาเข้าสู่ระบบหรือสมัครบัญชีใหม่";
    try {
      localStorage.removeItem(ACTIVE_USER_KEY);
    } catch {
      // ignore
    }
    this.renderHud();
  }

  public toggleAutoWave(): boolean {
    if (!this.isAuthenticated) return false;
    this.autoWaveEnabled = !this.autoWaveEnabled;
    if (this.autoWaveEnabled && this.battleState.phase === "PREPARING") {
      this.dispatchGameCommand({
        kind: "START_WAVE",
        tick: this.battleState.tick,
      });
    } else {
      this.renderHud();
    }
    return this.autoWaveEnabled;
  }

  public startNewBattle(
    stageId: number,
    mode: BattleMode,
    difficulty: StageDifficulty = this.selectedDifficulty,
    customSeed?: number
  ): boolean {
    if (!this.isAuthenticated) return false;
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
    const username = usernameRaw.trim().slice(0, 28);
    this.pendingAuthUsername = username;
    if (username.length < 2) {
      this.authBannerText = "กรุณาระบุชื่อบัญชีอย่างน้อย 2 ตัวอักษร";
      this.renderHud();
      return false;
    }
    const accounts = loadAccountsMap();
    const existing = accounts[username];
    if (existing) {
      if (existing.password !== passwordRaw) {
        this.authBannerText = "รหัสผ่านไม่ถูกต้องสำหรับบัญชีนี้";
        this.renderHud();
        return false;
      }
      this.isAuthenticated = true;
      this.profile = normalizeLoadedProfile(existing.profile);
      this.authBannerText = `เข้าสู่ระบบบัญชี "${username}" สำเร็จ`;
      this.activeModal = this.profile.tutorialCompleted ? null : "TUTORIAL";
    } else {
      if (passwordRaw.length < 1) {
        this.authBannerText = "กรุณากำหนดรหัสผ่านสำหรับสมัครบัญชีใหม่";
        this.renderHud();
        return false;
      }
      const fresh = createDefaultProfile(username);
      accounts[username] = {
        username,
        password: passwordRaw,
        profile: fresh,
      };
      saveAccountsMap(accounts);
      this.isAuthenticated = true;
      this.profile = fresh;
      this.authBannerText = `สมัครบัญชีใหม่ "${username}" สำเร็จ`;
      this.activeModal = "TUTORIAL";
    }
    persistProfile(this.profile);
    this.selectedStageId = 1;
    this.selectedDifficulty = "EASY";
    this.selectedHeroToDeploy = this.profile.loadout[0] ?? "archer";
    this.inspectedHeroId = this.profile.loadout[0] ?? "frostmage";
    this.battleState = this.buildNewBattleState(20261030);
    this.battleScene.syncBattleState(this.battleState);
    this.renderHud();
    return true;
  }

  public setTutorialStep(step: number): void {
    const clamped = Math.max(1, Math.min(4, step));
    this.profile = { ...this.profile, tutorialStep: clamped };
    persistProfile(this.profile);
    this.renderHud();
  }

  public claimAndCloseTutorial(): void {
    const wasCompleted = this.profile.tutorialCompleted;
    this.profile = completeAccountTutorial(this.profile);
    persistProfile(this.profile);
    this.activeModal = null;
    this.statusBannerText = wasCompleted
      ? "ปิดคู่มือสอนเล่นแล้ว"
      : "ผ่านการฝึกสอนสำเร็จ! ได้รับโบนัสต้อนรับ +200 Meta Coins";
    this.renderHud();
  }

  public dispatchGameCommand(cmd: GameCommand): boolean {
    if (!this.isAuthenticated) {
      this.openModal("ACCOUNT");
      return false;
    }
    const res = applyCommand(this.battleState, cmd);
    this.battleState = res.state;
    if (res.ok) {
      this.statusBannerText = res.eventText;
      if (cmd.kind === "DEPLOY") this.sound.playDeploy();
      if (cmd.kind === "CAST_SKILL") this.sound.playSkillCast();
      if (cmd.kind === "START_WAVE") this.sound.playWaveStart();
    } else {
      this.statusBannerText = formatRejectionReasonThai(res.reason);
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
    if (!this.isAuthenticated) {
      this.openModal("ACCOUNT");
      return;
    }
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
    if (!this.isAuthenticated) return false;
    const def = HERO_CATALOG[heroId];
    if (!def.skillEffect) {
      this.statusBannerText = `${def.name} เป็นสาย PASSIVE (ไม่มีสกิลกดใช้)`;
      this.renderHud();
      return false;
    }
    const readyHero = this.battleState.deployedHeroes.find(
      (h) =>
        h.heroId === heroId &&
        this.battleState.tick >= h.skillReadyAtTick &&
        (this.battleState.tick >= h.silencedUntilTick ||
          HERO_CATALOG[h.heroId].skillEffect?.kind === "SANCTUARY_CLEANSE")
    );
    const fallbackHero = this.battleState.deployedHeroes.find((h) => h.heroId === heroId);
    const targetHero = readyHero ?? fallbackHero;
    if (!targetHero) {
      this.statusBannerText = `ยังไม่ได้วาง ${def.name} ลงในสนาม`;
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
    if (!this.isAuthenticated) return;
    const seed = seedOverride ?? ((Date.now() + this.profile.pityCounter * 997) >>> 0);
    if (count === 1) {
      const outcome = pullGachaWithSeed(this.profile, seed);
      if (!outcome.ok || !outcome.pulledHeroId || !outcome.pulledRarity) {
        this.gachaResultBanner = "เหรียญ Meta Coins ไม่พอ (ต้องการ 100 Coins)";
        this.renderHud();
        return;
      }
      this.profile = outcome.profile;
      persistProfile(this.profile);
      const def = HERO_CATALOG[outcome.pulledHeroId];
      this.sound.playGachaPull(def.rarity === "ULTRA_RARE" || def.rarity === "RARE");
      this.lastPulledHeroes = [
        {
          heroId: outcome.pulledHeroId,
          rarity: outcome.pulledRarity,
          isDuplicate: Boolean(outcome.isDuplicate),
          newStarLevel: outcome.newStarLevel ?? 1,
        },
      ];
      this.gachaResultBanner = outcome.isDuplicate
        ? `สุ่มซ้ำ! ${def.name} [${def.rarity}] เลื่อนขั้นเป็น ★${outcome.newStarLevel}`
        : `ปลดล็อก Hero ใหม่: ${def.name} [${def.rarity} · ${def.element}]`;
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
    this.lastPulledHeroes = [...batch.results];
    const hasUltra = batch.results.some((r) => r.rarity === "ULTRA_RARE");
    this.sound.playGachaPull(hasUltra);
    this.gachaResultBanner = `สุ่ม 10 โรลสำเร็จ! ได้รับตัวละคร ${batch.results.length} รายการ`;
    this.renderHud();
  }

  public toggleLoadoutHero(heroId: HeroId): void {
    if (!this.isAuthenticated) return;
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
      if (ev.key === "Escape" && this.activeModal !== null) {
        this.closeModal();
        return;
      }
      if (
        document.activeElement &&
        document.activeElement.tagName.toLowerCase() === "input"
      ) {
        return;
      }
      if (!this.isAuthenticated) return;
      if (ev.key >= "1" && ev.key <= "6") {
        const idx = Number(ev.key) - 1;
        const heroId = this.profile.loadout[idx];
        if (heroId) {
          this.selectedHeroToDeploy = heroId;
          this.battleScene.setActiveHeroToDeploy(heroId);
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
      if (!this.isAuthenticated) return;
      for (let i = 0; i < this.speedMultiplier; i++) {
        const prevTick = this.battleState.tick;
        this.battleState = stepSimulationTick(this.battleState);

        if (
          this.autoWaveEnabled &&
          this.battleState.phase === "PREPARING" &&
          this.battleState.wave < this.battleState.maxWave
        ) {
          const started = applyCommand(this.battleState, {
            kind: "START_WAVE",
            tick: this.battleState.tick,
          });
          if (started.ok) {
            this.battleState = started.state;
            this.statusBannerText = `[Auto Wave] ${started.eventText}`;
          }
        }

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
      if (def.skillEffect && def.skillName) {
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
  }

  public getSnapshot() {
    return {
      isAuthenticated: this.isAuthenticated,
      profile: this.profile,
      battleState: this.battleState,
      selectedStageId: this.selectedStageId,
      selectedDifficulty: this.selectedDifficulty,
      selectedHeroToDeploy: this.selectedHeroToDeploy,
      inspectedHeroId: this.inspectedHeroId,
      selectedTile: this.selectedTile,
      activeModal: this.activeModal,
      autoWaveEnabled: this.autoWaveEnabled,
    };
  }

  public renderHud(): void {
    const topEl = document.getElementById("hud-top");
    const sideEl = document.getElementById("hud-side");
    const bottomEl = document.getElementById("hud-bottom");
    const modalRoot = document.getElementById("modal-root");
    if (!topEl || !sideEl || !bottomEl || !modalRoot) return;

    this.lastHudStructureKey = this.computeHudStructureKey();
    const unlockedSlots = getUnlockedLoadoutSlots(this.profile.playerLevel);
    const st = this.battleState;
    const stageDef =
      STAGE_CATALOG.find((s) => s.id === this.selectedStageId) ?? STAGE_CATALOG[0]!;
    const safeUsername = escapeHtml(this.profile.username);

    topEl.innerHTML = `
      <div class="top-bar-card">
        <div class="top-brand-row">
          <div style="display:flex; align-items:center; gap:8px;">
            <img src="/favicon.svg" alt="Elemental Rift Crest" style="width:24px; height:24px; image-rendering:pixelated; display:block;" />
            <h1 style="font-family:'Press Start 2P',monospace; font-size:14px; color:var(--accent-amber); letter-spacing:-0.02em;">
              ELEMENTAL RIFT TD
            </h1>
          </div>
          <span data-testid="account-badge" class="num" style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:6px; padding:3px 8px; font-size:11px; color:var(--text-primary);">
            ${this.isAuthenticated ? `<strong>${safeUsername}</strong>` : `<strong style="color:var(--accent-rose);">ยังไม่ได้ Login</strong>`}
          </span>
          <span data-testid="player-level-badge" class="num" style="background:var(--bg-elevated); border:1px solid var(--border-focus); border-radius:6px; padding:3px 8px; font-size:11px; font-weight:700;">
            Lv.${this.profile.playerLevel} (Slots ${this.profile.loadout.length}/${unlockedSlots} | Max ${MAX_LOADOUT_SLOTS})
          </span>
          <span data-testid="meta-coins-badge" class="num" style="background:var(--bg-elevated); border:1px solid var(--accent-sky); border-radius:6px; padding:3px 8px; font-size:11px; color:var(--accent-sky); font-weight:700;">
            Coins: ${this.profile.metaCoins}
          </span>
        </div>

        <nav class="top-nav-strip">
          <button data-testid="btn-modal-stages" id="btn-modal-stages" class="btn-touch" style="background:${this.activeModal === "STAGES" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeModal === "STAGES" ? "#090d16" : "var(--text-primary)"};">
            เลือกด่าน (1-10)
          </button>
          <button data-testid="btn-modal-gacha" id="btn-modal-gacha" class="btn-touch" style="background:${this.activeModal === "GACHA" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeModal === "GACHA" ? "#090d16" : "var(--text-primary)"};">
            สุ่ม Gacha (${this.profile.pityCounter}/${ULTRA_RARE_PITY_THRESHOLD})
          </button>
          <button data-testid="btn-modal-roster" id="btn-modal-roster" class="btn-touch" style="background:${this.activeModal === "ROSTER" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeModal === "ROSTER" ? "#090d16" : "var(--text-primary)"};">
            จัดทีม (40 Heroes)
          </button>
          <button data-testid="btn-modal-leaderboard" id="btn-modal-leaderboard" class="btn-touch" style="background:${this.activeModal === "LEADERBOARD" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeModal === "LEADERBOARD" ? "#090d16" : "var(--text-primary)"};">
            Leaderboard (${this.profile.leaderboard.length})
          </button>
          <button data-testid="btn-modal-account" id="btn-modal-account" class="btn-touch" style="background:${this.activeModal === "ACCOUNT" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeModal === "ACCOUNT" ? "#090d16" : "var(--text-primary)"};">
            บัญชีผู้เล่น
          </button>
          <button data-testid="btn-modal-tutorial" id="btn-modal-tutorial" class="btn-touch" style="background:${this.activeModal === "TUTORIAL" ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.activeModal === "TUTORIAL" ? "#090d16" : "var(--text-primary)"};">
            สอนเล่น
          </button>
          <button data-testid="btn-mute" id="btn-mute" class="btn-touch">
            ${this.sound.isMuted() ? "เสียง: ปิด" : "เสียง: เปิด"}
          </button>
        </nav>
      </div>

      <div class="telemetry-card">
        <div class="num telemetry-stats-row">
          <span data-testid="hud-stage-badge" style="color:var(--text-secondary);">
            <strong>ด่าน ${stageDef.id}</strong> [${this.selectedDifficulty}]
          </span>
          <span data-testid="hud-wave">WAVE <strong style="color:var(--accent-amber);">${st.wave}${st.config.mode === "STAGE" ? `/${st.maxWave}` : " (ENDLESS)"}</strong></span>
          <span data-testid="hud-gold">GOLD <strong style="color:#fde047;">${st.gold}</strong></span>
          <span data-testid="hud-hp">HP <strong style="color:${st.baseHp > 8 ? "#10b981" : "#f43f5e"};">${st.baseHp}/${st.maxBaseHp}</strong></span>
          <span data-testid="hud-score">SCORE <strong style="color:var(--accent-sky);">${st.score}</strong></span>
          <span data-testid="hud-phase" style="padding:2px 6px; background:var(--bg-elevated); border-radius:4px; font-size:10px;">${st.phase}</span>
        </div>

        <div class="wave-controls-strip">
          <button data-testid="btn-start-wave" id="btn-start-wave" class="btn-touch" style="background:${st.phase === "PREPARING" ? "var(--accent-emerald)" : "var(--bg-elevated)"}; color:${st.phase === "PREPARING" ? "#090d16" : "var(--text-primary)"}; border:none;">
            ${st.wave === 0 ? "เริ่ม Wave 1" : "เรียก Wave (+Bonus)"}
          </button>
          <button data-testid="btn-auto-wave" id="btn-auto-wave" class="btn-touch" style="background:${this.autoWaveEnabled ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.autoWaveEnabled ? "#090d16" : "var(--text-primary)"};">
            Auto Wave: ${this.autoWaveEnabled ? "เปิด" : "ปิด"}
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
      <div class="side-command-panel">
        <div class="side-command-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h2 style="font-size:15px; font-weight:700; color:var(--text-primary);">ศูนย์บัญชาการสนามรบ</h2>
          <span class="num" style="font-size:12px; color:var(--accent-amber);">${stageDef.name}</span>
        </div>

        <div class="desktop-only-coord-grid">
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

        <div class="desktop-only-coord-grid">
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

        <div style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:8px; padding:8px 10px;">
          ${
            selectedTileHero
              ? (() => {
                  const def = HERO_CATALOG[selectedTileHero.heroId];
                  const upgCost = getHeroUpgradeCost(
                    selectedTileHero.heroId,
                    selectedTileHero.level
                  );
                  const hasSkill = def.skillEffect !== null && def.skillName !== null;
                  const skillReady =
                    hasSkill && st.tick >= selectedTileHero.skillReadyAtTick;
                  const cdRemainSec = Math.max(
                    0,
                    (selectedTileHero.skillReadyAtTick - st.tick) / 20
                  ).toFixed(1);
                  const isSilenced = st.tick < selectedTileHero.silencedUntilTick;
                  return `
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                      <strong style="font-size:12px;">${def.name} [${def.element}] (Lv.${selectedTileHero.level} ★${selectedTileHero.stars})</strong>
                      <span class="num" style="font-size:11px; color:var(--text-secondary);">DMG ${getHeroEffectiveDamage(selectedTileHero, st.activeSynergies)}</span>
                    </div>
                    ${isSilenced ? `<div style="font-size:11px; color:var(--accent-rose); font-weight:700; margin-bottom:4px;">สถานะ: ติดใบ้จากบอส</div>` : ""}
                    <div style="display:flex; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
                      ${
                        hasSkill
                          ? `<button data-testid="btn-cast-selected" id="btn-cast-selected" class="btn-touch" style="flex:1; min-height:34px; padding:4px 8px; font-size:12px; background:${skillReady ? "#eab308" : "var(--bg-surface)"}; color:${skillReady ? "#090d16" : "var(--text-secondary)"}; border:none;">
                              ${skillReady ? `กดสกิล ${def.skillName}` : `Cooldown (${cdRemainSec}s)`}
                            </button>`
                          : `<span data-testid="passive-badge-selected" style="flex:1; display:inline-flex; align-items:center; justify-content:center; padding:4px 8px; border-radius:6px; background:var(--bg-void); color:var(--text-muted); font-size:11px; font-weight:600;">PASSIVE AUTO</span>`
                      }
                      <button data-testid="btn-upgrade-selected" id="btn-upgrade-selected" class="btn-touch" style="min-height:34px; padding:4px 8px; font-size:12px; background:var(--accent-emerald); color:#090d16; border:none;">
                        ${selectedTileHero.level >= 5 ? "MAX LV" : `อัปเกรด (${upgCost}G)`}
                      </button>
                      <button data-testid="btn-sell-selected" id="btn-sell-selected" class="btn-touch" style="min-height:34px; padding:4px 8px; font-size:12px; background:var(--accent-rose); color:#fff; border:none;">
                        ถอน
                      </button>
                    </div>
                    <div style="display:flex; gap:4px; align-items:center; font-size:11px;">
                      <span>เป้าเล็ง:</span>
                      ${(["FIRST", "STRONGEST", "CLOSEST", "WEAKEST"] as const)
                        .map(
                          (p) => `<button data-testid="btn-prio-${p}" class="btn-prio num" data-prio="${p}" style="padding:3px 6px; font-size:10px; border-radius:4px; background:${selectedTileHero.targetPriority === p ? "var(--accent-sky)" : "var(--bg-surface)"}; color:${selectedTileHero.targetPriority === p ? "#090d16" : "var(--text-secondary)"}; border:1px solid var(--border-subtle); cursor:pointer;">${p}</button>`
                        )
                        .join("")}
                    </div>
                  `;
                })()
              : `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap;">
                  <div data-testid="selected-tile-info" style="font-size:12px; color:var(--text-secondary);">
                    พิกัด <strong class="num">(${this.selectedTile.col},${this.selectedTile.row})</strong> [<strong style="color:${tileTerrain === "HIGH_GROUND" ? "var(--accent-sky)" : tileTerrain === "GROUND" ? "var(--accent-emerald)" : "var(--accent-rose)"};">${tileTerrain}</strong>]
                  </div>
                  <button data-testid="btn-deploy-on-tile" id="btn-deploy-on-tile" class="btn-touch" style="flex:1; min-height:36px; padding:6px 10px; background:var(--accent-amber); color:#090d16; border:none;">
                    วาง ${selectedHeroDef.name} [${selectedHeroDef.placementDomain === "HIGH_GROUND" ? "▲HG" : "พื้นราบ"}] (${selectedHeroDef.deployCost}G)
                  </button>
                </div>
              `
          }
        </div>

        <div data-testid="status-banner" style="background:var(--bg-void); border:1px solid var(--border-subtle); border-radius:6px; padding:6px 10px; font-size:11px; color:var(--text-primary); margin-top:auto; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
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
            ช่องที่ ${slotIdx + 1} ล็อก (ปลดที่ Lv.${slotIdx + 1})
          </div>
        `);
        continue;
      }
      if (!heroId) {
        slotsHtml.push(`
          <div data-testid="loadout-slot-${slotIdx}" style="background:var(--bg-surface); border:1px dashed var(--border-strong); border-radius:12px; padding:12px; color:var(--text-secondary); font-size:12px; display:flex; align-items:center; justify-content:center; text-align:center;">
            ช่องที่ ${slotIdx + 1} ว่าง (เลือกใส่ในปุ่มจัดทีม)
          </div>
        `);
        continue;
      }

      const def = HERO_CATALOG[heroId];
      const rarCfg = RARITY_CONFIG[def.rarity];
      const deployedCount = getDeployCountForHero(st, heroId);
      const isSelectedCard = this.selectedHeroToDeploy === heroId;
      const hasSkill = def.skillEffect !== null && def.skillName !== null;
      const readyInstance =
        hasSkill &&
        st.deployedHeroes.find(
          (h) => h.heroId === heroId && st.tick >= h.skillReadyAtTick
        );
      const avatarUrl = getHeroAvatarDataUrl(heroId);
      slotsHtml.push(`
        <div data-testid="loadout-slot-${slotIdx}" style="background:${isSelectedCard ? "var(--bg-elevated)" : "var(--bg-surface)"}; border:2px solid ${isSelectedCard ? "var(--accent-amber)" : "var(--border-subtle)"}; border-radius:12px; padding:10px 12px; display:flex; flex-direction:column; gap:6px;">
          <div style="display:flex; gap:8px; align-items:center;">
            <img src="${avatarUrl}" alt="${def.name}" class="pixel-avatar" style="width:36px; height:36px;" />
            <div style="flex:1; min-width:0;">
              <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px;">
                <strong style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">[${slotIdx + 1}] ${def.name}</strong>
                <span data-testid="deploy-cap-${heroId}" class="num" style="font-size:11px; padding:1px 6px; border-radius:4px; background:${deployedCount >= def.maxDeployCount ? "var(--accent-rose)" : "var(--bg-void)"}; color:#fff;">
                  ${deployedCount}/${def.maxDeployCount}
                </span>
              </div>
              <div class="num" style="font-size:10px; color:var(--text-secondary); display:flex; justify-content:space-between;">
                <span style="color:${rarCfg.colorHex};">${def.rarity} · ${def.element}</span>
                <span>${def.deployCost}G · ★${this.profile.ownedHeroes[heroId] ?? 1}</span>
              </div>
            </div>
          </div>
          <div style="display:flex; gap:6px; margin-top:2px;">
            <button data-testid="select-hero-${heroId}" class="btn-select-card btn-touch" data-hero="${heroId}" style="flex:1; min-height:34px; padding:4px 8px; font-size:12px; background:${isSelectedCard ? "var(--accent-amber)" : "var(--bg-interactive)"}; color:${isSelectedCard ? "#090d16" : "var(--text-primary)"}; border:none;">
              เลือกวาง
            </button>
            ${
              hasSkill
                ? `<button data-testid="quick-skill-${heroId}" class="btn-quick-skill btn-touch" data-hero="${heroId}" style="flex:1; min-height:34px; padding:4px 8px; font-size:12px; background:${readyInstance ? "#eab308" : "var(--bg-void)"}; color:${readyInstance ? "#090d16" : "var(--text-muted)"};">
                    สกิล ${def.skillName.split(" ")[0]}
                  </button>`
                : `<span data-testid="passive-card-badge-${heroId}" style="flex:1; display:inline-flex; align-items:center; justify-content:center; min-height:34px; padding:4px 6px; border-radius:6px; background:var(--bg-void); color:var(--text-muted); font-size:11px; font-weight:600;">
                    PASSIVE
                  </span>`
            }
          </div>
        </div>
      `);
    }

    bottomEl.innerHTML = `
      <div class="loadout-grid">
        ${slotsHtml.join("")}
      </div>
    `;

    modalRoot.innerHTML = this.renderActiveModalHtml();
    const isModalOpen = this.activeModal !== null;
    document.documentElement.classList.toggle("modal-open", isModalOpen);
    document.body.classList.toggle("modal-open", isModalOpen);

    this.attachDomListeners();
  }

  private renderHeroInspectorHtml(heroId: HeroId): string {
    const def = HERO_CATALOG[heroId];
    const rarCfg = RARITY_CONFIG[def.rarity];
    const synDef = ELEMENT_SYNERGY_DEFS[def.element];
    const ownedStars = this.profile.ownedHeroes[heroId] ?? 0;
    const effectiveStars = Math.max(1, ownedStars);
    const dmgAtStars = Math.round(def.baseDamage * (1 + (effectiveStars - 1) * 0.18));
    const atkPerSec = (20 / def.attackIntervalTicks).toFixed(2);
    const avatarUrl = getHeroAvatarDataUrl(heroId);
    const inDeck = this.profile.loadout.includes(heroId);
    const hasSkill = def.skillEffect !== null && def.skillName !== null;
    const cooldownSec = hasSkill
      ? (getHeroSkillCooldownTicks(heroId, effectiveStars) / 20).toFixed(1)
      : "0";

    return `
      <div data-testid="roster-hero-inspector" style="background:var(--bg-elevated); border:2px solid ${rarCfg.colorHex}; border-radius:12px; padding:14px 16px; display:flex; flex-direction:column; gap:12px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap;">
          <div style="display:flex; gap:14px; align-items:center;">
            <img src="${avatarUrl}" alt="${def.name}" class="pixel-avatar" style="width:64px; height:64px; border-color:${rarCfg.colorHex};" />
            <div>
              <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                <h3 data-testid="inspector-hero-name" style="font-size:16px; font-weight:700; color:var(--text-primary);">${def.name}</h3>
                <span class="num" style="font-size:11px; padding:2px 8px; border-radius:4px; background:var(--bg-void); color:${rarCfg.colorHex}; font-weight:700;">${def.rarity}</span>
                <span class="num" style="font-size:11px; padding:2px 8px; border-radius:4px; background:var(--bg-void); color:${synDef.colorHex}; font-weight:700;">ธาตุ ${def.element}</span>
                <span class="num" style="font-size:11px; color:#fde047;">${ownedStars > 0 ? `ปลดล็อกแล้ว ★${ownedStars}` : "ยังไม่ปลดล็อก (แสดงค่าพลังที่ ★1)"}</span>
              </div>
              <div style="font-size:13px; color:var(--text-secondary); margin-top:3px;">${def.titleThai}</div>
              <div style="font-size:11px; color:${synDef.colorHex}; margin-top:4px;">
                เอกลักษณ์${synDef.name}: ${synDef.descThai}
              </div>
            </div>
          </div>

          <button data-testid="inspector-toggle-loadout" id="inspector-toggle-loadout" data-hero="${heroId}" class="btn-touch" style="background:${inDeck ? "var(--accent-rose)" : ownedStars > 0 ? "var(--accent-emerald)" : "var(--bg-void)"}; color:#fff; border:none;">
            ${inDeck ? "ถอดออกจากทีม" : ownedStars > 0 ? "ใส่เข้าทีมรบ" : "ยังไม่ปลดล็อก"}
          </button>
        </div>

        <div class="num" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(145px, 1fr)); gap:8px; background:var(--bg-surface); border:1px solid var(--border-subtle); border-radius:8px; padding:10px 12px; font-size:12px;">
          <div>พลังโจมตี: <strong style="color:#fde047;">${dmgAtStars} DMG</strong></div>
          <div>ความเร็วยิง: <strong style="color:var(--accent-sky);">${atkPerSec} ครั้ง/วิ</strong></div>
          <div>ระยะยิง: <strong>${def.rangePx} px</strong></div>
          <div>ค่าตัววาง: <strong style="color:var(--accent-amber);">${def.deployCost} Gold</strong></div>
          <div>โควตาวางสนาม: <strong>สูงสุด ${def.maxDeployCount} ตัว</strong></div>
          <div>พื้นที่วาง: <strong style="color:${def.placementDomain === "HIGH_GROUND" ? "var(--accent-sky)" : "var(--accent-emerald)"};">${def.placementDomain === "HIGH_GROUND" ? "▲ ที่สูงเท่านั้น" : "■ พื้นราบทุกช่อง"}</strong></div>
        </div>

        <div data-testid="inspector-skill-box" style="background:var(--bg-void); border:1px solid ${hasSkill ? "var(--accent-amber)" : "var(--border-subtle)"}; border-radius:8px; padding:10px 14px;">
          ${
            hasSkill
              ? `
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:4px;">
                  <strong style="font-size:13px; color:#fde047;">ACTIVE SKILL: ${def.skillName}</strong>
                  <span class="num" style="font-size:11px; color:var(--accent-sky);">Cooldown: ${cooldownSec} วินาที (กดปุ่ม Q หรือปุ่มสกิลในสนาม)</span>
                </div>
                <p style="font-size:13px; color:var(--text-primary);">${def.skillDescThai}</p>
              `
              : `
                <div style="font-size:13px; font-weight:700; color:var(--accent-emerald); margin-bottom:4px;">
                  PASSIVE ROLE (โจมตีอัตโนมัติ — ไม่มีสกิลกดใช้)
                </div>
                <p style="font-size:13px; color:var(--text-secondary);">${describePassiveRoleThai(def)}</p>
              `
          }
        </div>
      </div>
    `;
  }

  private renderActiveModalHtml(): string {
    if (!this.activeModal) return "";

    let title = "";
    let bodyHtml = "";

    if (this.activeModal === "STAGES") {
      title = "เลือกด่านทั้ง 10 แผนที่ & ระดับความยาก (Cross-Progression Tree)";
      bodyHtml = `
        <p style="font-size:13px; color:var(--text-secondary);">
          กฎการปลดล็อก: ชนะด่าน N [EASY] จะปลดล็อกทั้งด่าน N [MEDIUM] และด่าน N+1 [EASY] พร้อมกัน | ชนะด่าน N [MEDIUM] จะปลดล็อกด่าน N [HARD]
        </p>
        <div data-testid="modal-stages-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(235px, 1fr)); gap:10px;">
          ${STAGE_CATALOG.map((stage) => {
            const diffs: readonly StageDifficulty[] = ["EASY", "MEDIUM", "HARD"];
            return `
              <div data-testid="stage-card-${stage.id}" style="background:var(--bg-elevated); border:1px solid ${this.selectedStageId === stage.id ? "var(--accent-amber)" : "var(--border-subtle)"}; border-radius:10px; padding:12px; display:flex; flex-direction:column; gap:8px;">
                <div>
                  <div style="font-size:13px; font-weight:700; color:var(--text-primary);">${stage.subtitleThai}</div>
                  <div class="num" style="font-size:11px; color:var(--text-muted);">
                    Biome: ${stage.biomeName} · รางวัล ${stage.clearRewardCoins} Coins
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
      `;
    } else if (this.activeModal === "GACHA") {
      title = "ตู้สุ่ม Elemental Rift Gacha (40 Heroes · การันตี 20 โรล = ULTRA RARE 100%)";
      bodyHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:10px; padding:14px;">
          <div>
            <div class="num" style="font-size:13px; color:var(--text-primary); margin-bottom:4px;">
              เหรียญของคุณ: <strong style="color:var(--accent-sky);">${this.profile.metaCoins} Meta Coins</strong>
              · การันตี RARE+ ในอีก <strong>${RARE_PITY_THRESHOLD - (this.profile.rarePityCounter ?? 0)}</strong> โรล
              · การันตี ULTRA RARE ในอีก <strong style="color:var(--accent-amber);">${ULTRA_RARE_PITY_THRESHOLD - this.profile.pityCounter}</strong> โรล
            </div>
            <div class="num" style="font-size:12px; color:var(--text-secondary);">
              COMMON (14 ตัว · 55% · Passive) · UNCOMMON (12 ตัว · 28% · Passive) · RARE (9 ตัว · 13% · Active Skill) · ULTRA RARE (5 ตัว · 4% · Ultimate Skill)
            </div>
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
            ? `<div data-testid="gacha-result-banner" style="background:var(--bg-elevated); border:1px solid var(--accent-amber); border-radius:10px; padding:12px 14px; font-size:13px; color:#fde047;">${this.gachaResultBanner}</div>`
            : ""
        }

        ${
          this.lastPulledHeroes.length > 0
            ? `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:10px;">
                ${this.lastPulledHeroes
                  .map((item) => {
                    const def = HERO_CATALOG[item.heroId];
                    const rarCfg = RARITY_CONFIG[item.rarity];
                    const avatarUrl = getHeroAvatarDataUrl(item.heroId);
                    return `
                      <div style="background:var(--bg-elevated); border:1px solid ${rarCfg.colorHex}; border-radius:10px; padding:10px; display:flex; gap:10px; align-items:center;">
                        <img src="${avatarUrl}" alt="${def.name}" class="pixel-avatar" />
                        <div>
                          <div style="font-size:13px; font-weight:700;">${def.name}</div>
                          <div class="num" style="font-size:11px; color:${rarCfg.colorHex};">${def.rarity} · ${def.element} · ★${item.newStarLevel}</div>
                          <div style="font-size:11px; color:var(--text-secondary);">
                            ${def.skillName ? `Skill: ${def.skillName}` : "PASSIVE (โจมตีอัตโนมัติ)"}
                          </div>
                        </div>
                      </div>
                    `;
                  })
                  .join("")}
              </div>`
            : `<div style="padding:20px; text-align:center; color:var(--text-muted); font-size:13px; background:var(--bg-void); border-radius:10px;">
                กดปุ่มสุ่ม 1 ครั้ง หรือ 10 ครั้งด้านบนเพื่ออัญเชิญ Hero ใหม่เข้าคลัง (หากต้องการจัดทีมเข้าด่าน กดปุ่ม "จัดทีม (30 Heroes)" บนแถบด้านบน)
              </div>`
        }
      `;
    } else if (this.activeModal === "ROSTER") {
      const unlockedSlots = getUnlockedLoadoutSlots(this.profile.playerLevel);
      title = `คลังตัวละคร & จัดทีม (คลิกที่ตัวละครเพื่อดูรายละเอียดสกิล · ช่องจัดทีม ${this.profile.loadout.length}/${unlockedSlots})`;
      const filteredHeroes = ALL_HERO_IDS.filter((id) => {
        const def = HERO_CATALOG[id];
        if (this.rosterRarityFilter !== "ALL" && def.rarity !== this.rosterRarityFilter) {
          return false;
        }
        if (this.rosterElementFilter !== "ALL" && def.element !== this.rosterElementFilter) {
          return false;
        }
        return true;
      });

      bodyHtml = `
        ${this.renderHeroInspectorHtml(this.inspectedHeroId)}

        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${(["ALL", "COMMON", "UNCOMMON", "RARE", "ULTRA_RARE"] as const)
              .map(
                (r) => `<button data-testid="filter-rarity-${r}" class="btn-filter-rarity btn-touch num" data-rarity="${r}" style="min-height:32px; padding:4px 10px; font-size:11px; background:${this.rosterRarityFilter === r ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${this.rosterRarityFilter === r ? "#090d16" : "var(--text-primary)"};">
                  ${r === "ALL" ? "ทุก Rarity (40)" : r}
                </button>`
              )
              .join("")}
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            ${(["ALL", ...ALL_ELEMENTS] as const)
              .map(
                (el) => `<button data-testid="filter-element-${el}" class="btn-filter-element btn-touch num" data-element="${el}" style="min-height:32px; padding:4px 10px; font-size:11px; background:${this.rosterElementFilter === el ? "var(--accent-sky)" : "var(--bg-elevated)"}; color:${this.rosterElementFilter === el ? "#090d16" : "var(--text-primary)"};">
                  ${el === "ALL" ? "ทุกธาตุ" : el}
                </button>`
              )
              .join("")}
          </div>
        </div>

        <div data-testid="roster-hero-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(295px, 1fr)); gap:10px;">
          ${filteredHeroes
            .map((id) => {
              const def = HERO_CATALOG[id];
              const rarCfg = RARITY_CONFIG[def.rarity];
              const stars = this.profile.ownedHeroes[id] ?? 0;
              const inDeck = this.profile.loadout.includes(id);
              const isInspected = this.inspectedHeroId === id;
              const avatarUrl = getHeroAvatarDataUrl(id);
              return `
                <div data-testid="roster-card-${id}" class="roster-card-item" data-hero="${id}" style="background:${isInspected ? "var(--bg-interactive)" : "var(--bg-elevated)"}; border:2px solid ${isInspected ? "var(--accent-sky)" : inDeck ? "var(--accent-amber)" : "var(--border-subtle)"}; border-radius:10px; padding:10px 12px; display:flex; justify-content:space-between; align-items:center; gap:10px; cursor:pointer;">
                  <div style="display:flex; gap:10px; align-items:center; min-width:0;">
                    <img src="${avatarUrl}" alt="${def.name}" class="pixel-avatar" />
                    <div style="min-width:0;">
                      <div style="font-size:13px; font-weight:700;">
                        ${def.name}
                        <span class="num" style="font-size:10px; color:${rarCfg.colorHex};">[${def.rarity} · ${def.element}]</span>
                      </div>
                      <div class="num" style="font-size:11px; color:var(--text-secondary);">
                        วางได้ <strong>${def.maxDeployCount}</strong> · ${def.placementDomain === "HIGH_GROUND" ? "▲ ที่สูง" : "■ พื้นราบ"} · ${def.deployCost}G · ${stars > 0 ? `★${stars}` : "ล็อก"}
                      </div>
                      <div style="font-size:11px; color:${def.skillName ? "#fde047" : "var(--text-muted)"}; margin-top:2px;">
                        ${def.skillName ? `Active: ${def.skillName} (คลิกดูสกิล)` : "PASSIVE (คลิกดูบทบาท)"}
                      </div>
                    </div>
                  </div>
                  <button data-testid="btn-toggle-loadout-${id}" class="btn-toggle-loadout btn-touch" data-hero="${id}" style="background:${inDeck ? "var(--accent-rose)" : stars > 0 ? "var(--accent-emerald)" : "var(--bg-void)"}; color:#fff; border:none; flex-shrink:0;">
                    ${inDeck ? "ถอดออก" : stars > 0 ? "ใส่ทีม" : "ล็อก"}
                  </button>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
    } else if (this.activeModal === "LEADERBOARD") {
      title = "Competitive Endless & Stage Leaderboard";
      bodyHtml = `
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:8px;">
          <p style="font-size:13px; color:var(--text-secondary);">
            ทุกสถิติผูกกับชื่อ Account และผ่านการตรวจสอบ Deterministic Replay (Seed + Action Log)
          </p>
          <button data-testid="btn-record-run" id="btn-record-run" class="btn-touch" style="background:var(--accent-sky); color:#090d16; border:none;">
            บันทึกสถิติรอบปัจจุบัน (${escapeHtml(this.profile.username)})
          </button>
        </div>
        <div data-testid="leaderboard-list" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:10px;">
          ${this.profile.leaderboard
            .map(
              (entry, i) => `
              <div data-testid="leaderboard-row-${i}" style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:10px; padding:10px 14px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                  <strong style="font-size:13px;">#${i + 1} ${escapeHtml(entry.playerName)}</strong>
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
      `;
    } else if (this.activeModal === "ACCOUNT") {
      if (this.isAuthenticated) {
        const ownedCount = ALL_HERO_IDS.filter(
          (id) => (this.profile.ownedHeroes[id] ?? 0) > 0
        ).length;
        const unlockedDiffCount = Object.values(
          this.profile.unlockedStageDifficulties
        ).filter(Boolean).length;
        const bestPersonalScore = this.profile.leaderboard
          .filter((e) => e.playerName === this.profile.username)
          .reduce((max, e) => Math.max(max, e.score), 0);
        const safeUser = escapeHtml(this.profile.username);

        title = "ข้อมูลบัญชีที่ใช้งานอยู่";
        bodyHtml = `
          <div data-testid="current-account-summary" style="background:var(--bg-elevated); border:1px solid var(--accent-amber); border-radius:12px; padding:18px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:14px;">
            <div>
              <div style="font-size:16px; font-weight:700; color:var(--accent-amber);">
                ผู้บัญชาการ: ${safeUser} (Lv.${this.profile.playerLevel})
              </div>
              <div class="num" style="font-size:13px; color:var(--text-primary); margin-top:8px; display:flex; gap:16px; flex-wrap:wrap;">
                <span>Meta Coins: <strong style="color:var(--accent-sky);">${this.profile.metaCoins}</strong></span>
                <span>Hero ที่ปลดล็อก: <strong style="color:var(--accent-emerald);">${ownedCount}/40 ตัว</strong></span>
                <span>ด่านที่ปลดล็อก: <strong>${unlockedDiffCount}/30 ระดับ</strong></span>
                <span>คะแนนสูงสุด: <strong style="color:#fde047;">${bestPersonalScore} PTS</strong></span>
              </div>
            </div>
            <button data-testid="btn-logout" id="btn-logout" class="btn-touch" style="background:var(--accent-rose); color:#fff; border:none;">
              ออกจากระบบ (Logout)
            </button>
          </div>
          ${
            this.authBannerText
              ? `<div data-testid="auth-status-banner" style="background:var(--bg-elevated); border:1px solid var(--accent-emerald); border-radius:8px; padding:10px 12px; font-size:13px; color:var(--text-primary);">${escapeHtml(this.authBannerText)}</div>`
              : ""
          }
        `;
      } else {
        title = "เข้าสู่ระบบ / สมัครสมาชิกผู้บัญชาการใหม่";
        bodyHtml = `
          <p style="font-size:13px; color:var(--text-secondary);">
            กรอกชื่อผู้ใช้และรหัสผ่านเพื่อเข้าสู่ระบบบัญชีเดิม หรือสมัครบัญชีใหม่ (บัญชีใหม่จะได้รับสิทธิ์ฝึกสอนพร้อมโบนัสต้อนรับ +200 Meta Coins)
          </p>
          <div style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
            <input data-testid="input-username" id="input-username" type="text" placeholder="ชื่อผู้ใช้ (Username)" value="${escapeHtml(this.pendingAuthUsername)}" style="min-height:42px; padding:8px 12px; border-radius:6px; border:1px solid var(--border-strong); background:var(--bg-void); color:var(--text-primary); font-size:13px;" />
            <input data-testid="input-password" id="input-password" type="password" placeholder="รหัสผ่าน (Password)" value="" style="min-height:42px; padding:8px 12px; border-radius:6px; border:1px solid var(--border-strong); background:var(--bg-void); color:var(--text-primary); font-size:13px;" />
            <button data-testid="btn-auth-submit" id="btn-auth-submit" class="btn-touch" style="background:var(--accent-emerald); color:#090d16; border:none;">
              เข้าสู่ระบบ / สมัครสมาชิก
            </button>
          </div>
          ${
            this.authBannerText
              ? `<div data-testid="auth-status-banner" style="background:var(--bg-elevated); border:1px solid var(--accent-amber); border-radius:8px; padding:10px 12px; font-size:13px; color:var(--text-primary);">${escapeHtml(this.authBannerText)}</div>`
              : ""
          }
        `;
      }
    } else if (this.activeModal === "TUTORIAL") {
      const currentStep = Math.max(1, Math.min(4, this.profile.tutorialStep || 1));
      const slideTitles: Readonly<Record<number, string>> = {
        1: "1/4 การวาง Hero อิสระ & พื้นที่สูง (▲HG) และโควตาวาง 6/4/2/1",
        2: "2/4 กองทัพ 30 Heroes: สาย PASSIVE vs สาย ACTIVE SKILL (RARE / ULTRA RARE)",
        3: "3/4 ระบบธาตุประสาน (Elemental Synergy) & ปุ่ม Auto Wave",
        4: "4/4 แผนผังการปลดล็อก 10 ด่าน (Easy -> Medium + ด่านถัดไป Easy) & การันตี 20 โรล",
      };
      const slideDescriptions: Readonly<Record<number, string>> = {
        1: "คลิกวาง Hero สายพื้นราบตรงช่องว่างใดก็ได้บนแผนที่ (ยกเว้นทางเดินมอนสเตอร์) ส่วนช่อง ▲HG สงวนไว้ให้ตัวละครสายที่สูงเท่านั้น โดยจำนวนที่วางได้ขึ้นอยู่กับ Rarity (COMMON วางได้ 6, UNCOMMON 4, RARE 2, ULTRA RARE 1 ตัว)",
        2: "ตัวละครระดับ COMMON (10 ตัว) และ UNCOMMON (9 ตัว) เป็นสาย PASSIVE โจมตีอัตโนมัติล้วนโดยไม่ต้องกดสกิล ส่วนตัวระดับ RARE (7 ตัว) และ ULTRA RARE (4 ตัว) ทุกตัวจะมีท่าไม้ตาย Active Skill ให้กดใช้พลิกเกม",
        3: "เมื่อวาง Hero ธาตุเดียวกัน (FLAME, FROST, STORM, SOLAR) ในสนามครบ 2 ตัว จะเปิดบัฟ Elemental Synergy ทันที และสามารถเปิดปุ่ม 'Auto Wave' เพื่อให้ระบบเรียก Wave ถัดไปพร้อมรับโบนัสให้อัตโนมัติ",
        4: "เมื่อชนะด่าน N ระดับ EASY จะปลดล็อกทั้งด่าน N ระดับ MEDIUM และด่าน N+1 ระดับ EASY พร้อมกัน ส่วนตู้สุ่ม Gacha มีการันตี RARE+ ทุก 10 โรล และการันตี ULTRA RARE 100% ที่ 20 โรล",
      };
      title = `คู่มือสอนเล่น ELEMENTAL RIFT TD (${escapeHtml(this.profile.username)})`;
      bodyHtml = `
        <div data-testid="tutorial-modal-content" style="display:flex; flex-direction:column; gap:14px;">
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            ${[1, 2, 3, 4]
              .map(
                (s) => `<button data-testid="btn-tut-step-${s}" class="btn-tut-step btn-touch num" data-step="${s}" style="flex:1; background:${currentStep === s ? "var(--accent-amber)" : "var(--bg-elevated)"}; color:${currentStep === s ? "#090d16" : "var(--text-primary)"};">
                  ภาพที่ ${s}/4
                </button>`
              )
              .join("")}
          </div>

          <div style="background:var(--bg-elevated); border:1px solid var(--border-subtle); border-radius:10px; padding:16px; display:flex; flex-direction:column; gap:12px;">
            <h3 style="font-size:15px; color:var(--accent-amber);">${slideTitles[currentStep]}</h3>
            <div data-testid="tutorial-illustration-${currentStep}">
              ${renderTutorialIllustrationSvg(currentStep)}
            </div>
            <p style="font-size:13px; color:var(--text-primary); line-height:1.6;">
              ${slideDescriptions[currentStep]}
            </p>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
            <span style="font-size:12px; color:var(--text-muted);">
              ${this.profile.tutorialCompleted ? "คุณรับโบนัสต้อนรับของบัญชีนี้แล้ว" : "รางวัลผู้บัญชาการใหม่: รับฟรี +200 Meta Coins เมื่อจบคู่มือ"}
            </span>
            <div style="display:flex; gap:8px;">
              ${
                currentStep < 4
                  ? `<button data-testid="btn-tutorial-next" id="btn-tutorial-next" class="btn-touch" style="background:var(--accent-sky); color:#090d16; border:none;">
                      ภาพถัดไป (${currentStep + 1}/4)
                    </button>`
                  : ""
              }
              <button data-testid="btn-tutorial-claim" id="btn-tutorial-claim" class="btn-touch" style="background:var(--accent-emerald); color:#090d16; border:none;">
                ${this.profile.tutorialCompleted ? "เข้าใจแล้ว (ปิดหน้าต่าง)" : "รับ +200 Coins & เริ่มเล่น"}
              </button>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div data-testid="active-modal-backdrop" id="active-modal-backdrop" class="modal-backdrop">
        <div data-testid="modal-${this.activeModal.toLowerCase()}" class="modal-dialog" role="dialog" aria-modal="true">
          <div class="modal-header-sticky">
            <h2 style="font-size:15px; font-weight:700; color:var(--accent-amber);">${title}</h2>
            ${
              this.isAuthenticated
                ? `<button data-testid="btn-close-modal" id="btn-close-modal" class="btn-touch" style="min-height:34px; padding:4px 12px;">
                    ปิดหน้าต่าง (ESC)
                  </button>`
                : ""
            }
          </div>
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  private attachDomListeners(): void {
    document
      .getElementById("btn-modal-stages")
      ?.addEventListener("click", () => this.openModal("STAGES"));
    document
      .getElementById("btn-modal-gacha")
      ?.addEventListener("click", () => this.openModal("GACHA"));
    document
      .getElementById("btn-modal-roster")
      ?.addEventListener("click", () => this.openModal("ROSTER"));
    document
      .getElementById("btn-modal-leaderboard")
      ?.addEventListener("click", () => this.openModal("LEADERBOARD"));
    document
      .getElementById("btn-modal-account")
      ?.addEventListener("click", () => this.openModal("ACCOUNT"));
    document
      .getElementById("btn-modal-tutorial")
      ?.addEventListener("click", () => this.openModal("TUTORIAL"));

    document.getElementById("btn-close-modal")?.addEventListener("click", () => {
      this.closeModal();
    });
    document
      .getElementById("active-modal-backdrop")
      ?.addEventListener("click", (ev) => {
        if (ev.target && (ev.target as HTMLElement).id === "active-modal-backdrop") {
          this.closeModal();
        }
      });

    document.querySelectorAll(".btn-tut-step").forEach((btn) => {
      btn.addEventListener("click", () => {
        const s = Number((btn as HTMLElement).dataset.step);
        this.setTutorialStep(s);
      });
    });
    document.getElementById("btn-tutorial-next")?.addEventListener("click", () => {
      this.setTutorialStep((this.profile.tutorialStep || 1) + 1);
    });
    document.getElementById("btn-tutorial-claim")?.addEventListener("click", () => {
      this.claimAndCloseTutorial();
    });

    document.getElementById("btn-logout")?.addEventListener("click", () => {
      this.logoutAccount();
    });

    document.getElementById("btn-auth-submit")?.addEventListener("click", () => {
      const u =
        (document.getElementById("input-username") as HTMLInputElement | null)
          ?.value ?? "";
      const p =
        (document.getElementById("input-password") as HTMLInputElement | null)
          ?.value ?? "";
      this.registerOrLoginAccount(u, p);
    });

    document.getElementById("btn-mute")?.addEventListener("click", () => {
      this.sound.toggleMute();
      this.renderHud();
    });
    document.getElementById("btn-start-wave")?.addEventListener("click", () => {
      this.dispatchGameCommand({ kind: "START_WAVE", tick: this.battleState.tick });
    });
    document.getElementById("btn-auto-wave")?.addEventListener("click", () => {
      this.toggleAutoWave();
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
          this.closeModal();
        }
      });
    });

    document.querySelectorAll(".btn-filter-rarity").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.rosterRarityFilter = ((btn as HTMLElement).dataset.rarity ?? "ALL") as
          | HeroRarity
          | "ALL";
        this.renderHud();
      });
    });

    document.querySelectorAll(".btn-filter-element").forEach((btn) => {
      btn.addEventListener("click", () => {
        this.rosterElementFilter = ((btn as HTMLElement).dataset.element ??
          "ALL") as HeroElement | "ALL";
        this.renderHud();
      });
    });

    document.querySelectorAll(".roster-card-item").forEach((card) => {
      card.addEventListener("click", (ev) => {
        const target = ev.target as HTMLElement;
        if (target.closest(".btn-toggle-loadout")) return;
        const heroId = (card as HTMLElement).dataset.hero as HeroId;
        if (heroId) {
          this.inspectHero(heroId);
        }
      });
    });

    document
      .getElementById("inspector-toggle-loadout")
      ?.addEventListener("click", (ev) => {
        const heroId = (ev.currentTarget as HTMLElement).dataset.hero as HeroId;
        if (heroId) {
          this.toggleLoadoutHero(heroId);
        }
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
      this.performGachaPull(1);
    });
    document.getElementById("btn-pull-gacha-10")?.addEventListener("click", () => {
      this.performGachaPull(10);
    });

    document.querySelectorAll(".btn-toggle-loadout").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const heroId = (btn as HTMLElement).dataset.hero as HeroId;
        if (heroId) {
          this.inspectHero(heroId);
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
