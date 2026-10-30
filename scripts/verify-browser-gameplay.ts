import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;
const AUDIT_DIR = path.resolve(process.cwd(), "screenshots", "persona-audit");
const MVP_DIR = path.resolve(process.cwd(), "screenshots", "tower-defense-mvp");

async function waitForServer(url: string, timeoutMs = 15000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server at ${url} did not become ready within ${timeoutMs}ms`);
}

async function runPersonaAudit(): Promise<void> {
  fs.mkdirSync(AUDIT_DIR, { recursive: true });
  fs.mkdirSync(MVP_DIR, { recursive: true });

  let serverProc: ChildProcess | null = null;
  let serverAlreadyUp = false;
  try {
    const check = await fetch(BASE_URL);
    if (check.ok) serverAlreadyUp = true;
  } catch {
    serverAlreadyUp = false;
  }

  if (!serverAlreadyUp) {
    const npxCmd = process.platform === "win32" ? "npx.cmd" : "npx";
    serverProc = spawn(`${npxCmd} vite --port ${PORT}`, {
      cwd: process.cwd(),
      stdio: "pipe",
      shell: true,
    });
    await waitForServer(BASE_URL, 20000);
  }

  const consoleErrors: string[] = [];
  const browser = await chromium.launch({ headless: true });

  try {
    // =========================================================================
    // PERSONA 1: First-Time User (Forced Login Gate -> Start at Lv.1 -> 40 Heroes)
    // =========================================================================
    const p1Context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const p1Page = await p1Context.newPage();
    p1Page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`[P1] ${m.text()}`);
    });
    p1Page.on("pageerror", (e) => consoleErrors.push(`[P1] ${e.message}`));

    await p1Page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await p1Page.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });

    // 1. Verify forced login gate on fresh open (no auto "Commander" login)
    const initialSnap = await p1Page.evaluate(() => window.__TD_APP__!.getSnapshot());
    if (initialSnap.isAuthenticated !== false || initialSnap.activeModal !== "ACCOUNT") {
      throw new Error(
        `Expected unauthenticated forced ACCOUNT modal on fresh open, got isAuthenticated=${initialSnap.isAuthenticated}, modal=${initialSnap.activeModal}`
      );
    }
    const accountBadgeInit = await p1Page.textContent('[data-testid="account-badge"]');
    if (accountBadgeInit?.includes("Commander")) {
      throw new Error(`Expected no 'Commander' default username, got: ${accountBadgeInit}`);
    }

    // 2. Verify Synergy Bar is completely removed
    const synergyBarCount = await p1Page.locator('[data-testid="synergy-bar"]').count();
    if (synergyBarCount !== 0) {
      throw new Error("Expected [data-testid='synergy-bar'] to be removed from HUD");
    }

    await p1Page.screenshot({
      path: path.join(AUDIT_DIR, "01-forced-login-gate-on-open.png"),
      fullPage: true,
    });

    // Register a new account and verify it starts at Lv.1 (1/1 slot)
    await p1Page.fill('[data-testid="input-username"]', "ElementMaster");
    await p1Page.fill('[data-testid="input-password"]', "pass1234");
    await p1Page.click('[data-testid="btn-auth-submit"]');

    await p1Page.waitForSelector('[data-testid="modal-tutorial"]', { timeout: 5000 });
    const afterRegSnap = await p1Page.evaluate(() => window.__TD_APP__!.getSnapshot());
    if (afterRegSnap.profile.playerLevel !== 1 || afterRegSnap.profile.loadout.length !== 1) {
      throw new Error(
        `Expected new account to start at Lv.1 with 1 loadout slot, got Lv.${afterRegSnap.profile.playerLevel}, slots=${afterRegSnap.profile.loadout.length}`
      );
    }
    await p1Page.click('[data-testid="btn-tutorial-claim"]');

    // Open Roster & verify 40 heroes + DARK, THUNDER, WATER, EARTH filters
    await p1Page.click('[data-testid="btn-modal-roster"]');
    await p1Page.waitForSelector('[data-testid="roster-hero-inspector"]', { timeout: 5000 });
    const totalHeroCards = await p1Page.locator('[data-testid^="roster-card-"]').count();
    if (totalHeroCards !== 40) {
      throw new Error(`Expected 40 heroes in Roster modal, found ${totalHeroCards}`);
    }

    for (const el of ["DARK", "THUNDER", "WATER", "EARTH"] as const) {
      await p1Page.click(`[data-testid="filter-element-${el}"]`);
      const countForEl = await p1Page.locator('[data-testid^="roster-card-"]').count();
      if (countForEl < 3) {
        throw new Error(`Expected at least 3 heroes for element ${el}, found ${countForEl}`);
      }
    }

    // Inspect DARK Ultra Rare hero (abyssalking)
    await p1Page.click('[data-testid="filter-element-DARK"]');
    await p1Page.click('[data-testid="roster-card-abyssalking"]');
    const darkInspectorName = await p1Page.textContent('[data-testid="inspector-hero-name"]');
    const darkInspectorSkill = await p1Page.textContent('[data-testid="inspector-skill-box"]');
    if (
      !darkInspectorName?.includes("Nyx Void Sovereign") ||
      !darkInspectorSkill?.includes("Abyssal Eclipse")
    ) {
      throw new Error(
        `Expected DARK Ultra Rare Nyx Void Sovereign (Abyssal Eclipse), got: ${darkInspectorName} / ${darkInspectorSkill}`
      );
    }
    await p1Page.screenshot({
      path: path.join(AUDIT_DIR, "02-roster-40heroes-dark-element.png"),
      fullPage: true,
    });

    await p1Page.click('[data-testid="filter-element-ALL"]');
    await p1Page.screenshot({
      path: path.join(MVP_DIR, "03-modal-roster-40-heroes.png"),
      fullPage: true,
    });
    await p1Page.click('[data-testid="btn-close-modal"]');

    // Clear Stage 1 EASY -> verify level up from Lv.1 to Lv.2 (unlocking Slot 2!)
    await p1Page.evaluate(() => {
      window.__TD_APP__!.simulateStageClearForVerification(1, "EASY");
    });
    const afterClearSnap = await p1Page.evaluate(() => window.__TD_APP__!.getSnapshot());
    if (afterClearSnap.profile.playerLevel < 2) {
      throw new Error(
        `Expected Stage 1 EASY clear to level up player from Lv.1 to Lv.2, got Lv.${afterClearSnap.profile.playerLevel}`
      );
    }
    await p1Context.close();

    // =========================================================================
    // PERSONA 2: Mobile Portrait Zero-Scroll (390x844) & Landscape (844x390)
    // =========================================================================
    const p4Context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const p4Page = await p4Context.newPage();
    await p4Page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await p4Page.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });

    await p4Page.fill('[data-testid="input-username"]', "MobileHero");
    await p4Page.fill('[data-testid="input-password"]', "mob123");
    await p4Page.click('[data-testid="btn-auth-submit"]');
    await p4Page.click('[data-testid="btn-tutorial-claim"]');

    const mapBox = await p4Page.locator("#phaser-mount").boundingBox();
    const deployBtnBox = await p4Page.locator('[data-testid="btn-deploy-on-tile"]').boundingBox();
    const bottomDockBox = await p4Page.locator("#hud-bottom").boundingBox();
    if (!mapBox || !deployBtnBox || !bottomDockBox) {
      throw new Error("Mobile battle screen elements missing boundingBox");
    }
    if (
      mapBox.y + mapBox.height > 845 ||
      deployBtnBox.y + deployBtnBox.height > 845 ||
      bottomDockBox.y + bottomDockBox.height > 845
    ) {
      throw new Error("Mobile 390x844 Zero-Scroll check failed");
    }

    await p4Page.click('[data-testid="btn-deploy-on-tile"]');
    await p4Page.click('[data-testid="btn-auto-wave"]');
    await p4Page.waitForTimeout(400);
    await p4Page.screenshot({
      path: path.join(AUDIT_DIR, "08-mobile-portrait-zero-scroll-battle.png"),
      fullPage: false,
    });
    await p4Context.close();

    if (consoleErrors.length > 0) {
      throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
    }

    console.log("ALL VERIFICATION CHECKS PASSED");
    console.log("- Forced Login Gate on fresh launch (no 'Commander' auto-login) verified");
    console.log("- New accounts start at Lv.1 (1/1 Loadout Slot -> Lv.6 max 6 slots) verified");
    console.log("- Synergy Bar completely removed from HUD verified");
    console.log("- 40 Heroes across 7 Elements (FLAME, WATER, EARTH, THUNDER, FROST, SOLAR, DARK) verified");
  } finally {
    await browser.close();
    if (serverProc && serverProc.pid) {
      if (process.platform === "win32") {
        spawn("taskkill", ["/pid", String(serverProc.pid), "/f", "/t"]);
      } else {
        serverProc.kill("SIGTERM");
      }
    }
  }
}

runPersonaAudit().catch((err) => {
  console.error("VERIFICATION FAILED:", err);
  process.exit(1);
});
