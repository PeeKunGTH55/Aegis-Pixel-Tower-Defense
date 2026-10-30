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
    // PERSONA 1: First-Time Novice Player (Desktop 1920x1080)
    // =========================================================================
    const p1Context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const p1Page = await p1Context.newPage();
    p1Page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`[P1] ${m.text()}`);
    });
    p1Page.on("pageerror", (e) => consoleErrors.push(`[P1] ${e.message}`));

    await p1Page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await p1Page.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });

    await p1Page.waitForSelector('[data-testid="modal-tutorial"]', { timeout: 5000 });
    await p1Page.click('[data-testid="btn-tut-step-2"]');
    await p1Page.waitForSelector('[data-testid="tutorial-illustration-2"]', { timeout: 5000 });
    await p1Page.screenshot({
      path: path.join(AUDIT_DIR, "01-persona1-tutorial-slide2.png"),
      fullPage: true,
    });
    await p1Page.click('[data-testid="btn-tutorial-claim"]');

    // Open Roster & click on heroes to inspect their skills
    await p1Page.click('[data-testid="btn-modal-roster"]');
    await p1Page.waitForSelector('[data-testid="roster-hero-inspector"]', { timeout: 5000 });

    await p1Page.click('[data-testid="roster-card-paladin"]');
    const paladinInspectedName = await p1Page.textContent('[data-testid="inspector-hero-name"]');
    const paladinSkillText = await p1Page.textContent('[data-testid="inspector-skill-box"]');
    if (!paladinInspectedName?.includes("Solaris Commander") || !paladinSkillText?.includes("Sanctuary Cleanse")) {
      throw new Error(`Expected clicking paladin card to show Solaris Commander & Sanctuary Cleanse in inspector, got: ${paladinInspectedName} / ${paladinSkillText}`);
    }
    await p1Page.screenshot({
      path: path.join(AUDIT_DIR, "02-persona1-roster-skill-inspector-active.png"),
      fullPage: true,
    });
    await p1Page.screenshot({
      path: path.join(MVP_DIR, "03-modal-roster-30-heroes.png"),
      fullPage: true,
    });

    await p1Page.click('[data-testid="roster-card-ashbomber"]');
    const passiveSkillText = await p1Page.textContent('[data-testid="inspector-skill-box"]');
    if (!passiveSkillText?.includes("PASSIVE ROLE")) {
      throw new Error(`Expected clicking COMMON ashbomber card to show PASSIVE ROLE in inspector, got: ${passiveSkillText}`);
    }
    await p1Page.screenshot({
      path: path.join(AUDIT_DIR, "03-persona1-roster-skill-inspector-passive.png"),
      fullPage: true,
    });
    await p1Page.click('[data-testid="btn-close-modal"]');
    await p1Context.close();

    // =========================================================================
    // PERSONA 2: Power / Competitive Player (Auto Wave + 4x Speed + Hotkeys)
    // =========================================================================
    const p2Context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const p2Page = await p2Context.newPage();
    p2Page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`[P2] ${m.text()}`);
    });
    await p2Page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await p2Page.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });
    await p2Page.keyboard.press("Escape");

    await p2Page.keyboard.press("1");
    await p2Page.click('[data-testid="ground-tile-0"]');
    await p2Page.click('[data-testid="btn-deploy-on-tile"]');

    await p2Page.keyboard.press("2");
    await p2Page.click('[data-testid="ground-tile-1"]');
    await p2Page.click('[data-testid="btn-deploy-on-tile"]');

    await p2Page.keyboard.press("3");
    await p2Page.click('[data-testid="hg-tile-0"]');
    await p2Page.click('[data-testid="btn-deploy-on-tile"]');

    await p2Page.click('[data-testid="btn-speed"]');
    await p2Page.click('[data-testid="btn-speed"]');
    await p2Page.click('[data-testid="btn-auto-wave"]');
    await p2Page.waitForTimeout(900);

    await p2Page.keyboard.press("q");
    await p2Page.waitForTimeout(300);
    await p2Page.screenshot({
      path: path.join(AUDIT_DIR, "04-persona2-power-autowave-4x.png"),
      fullPage: true,
    });
    await p2Context.close();

    // =========================================================================
    // PERSONA 3: Adversarial / Breaker & Login/Logout Security Tester
    // =========================================================================
    const p3Context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const p3Page = await p3Context.newPage();
    let xssTriggered = false;
    p3Page.on("dialog", async (d) => {
      xssTriggered = true;
      await d.dismiss();
    });
    p3Page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`[P3] ${m.text()}`);
    });

    await p3Page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await p3Page.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });
    await p3Page.click('[data-testid="btn-tutorial-claim"]');

    // Check Account modal when logged in: ONLY current account summary + Logout button
    await p3Page.click('[data-testid="btn-modal-account"]');
    await p3Page.waitForSelector('[data-testid="current-account-summary"]', { timeout: 5000 });
    const loginInputsWhenLoggedIn = await p3Page.locator('[data-testid="input-username"]').count();
    const logoutBtnWhenLoggedIn = await p3Page.locator('[data-testid="btn-logout"]').count();
    if (loginInputsWhenLoggedIn !== 0 || logoutBtnWhenLoggedIn !== 1) {
      throw new Error(
        `When logged in, expected 0 login inputs and 1 logout button, got inputs=${loginInputsWhenLoggedIn}, logout=${logoutBtnWhenLoggedIn}`
      );
    }
    await p3Page.screenshot({
      path: path.join(AUDIT_DIR, "05-persona3-account-logged-in-only.png"),
      fullPage: true,
    });

    // Click Logout -> verify switched to Login/Register form and locked out of game until logged in
    await p3Page.click('[data-testid="btn-logout"]');
    await p3Page.waitForSelector('[data-testid="input-username"]', { timeout: 5000 });
    const logoutBtnAfterLogout = await p3Page.locator('[data-testid="btn-logout"]').count();
    const summaryAfterLogout = await p3Page.locator('[data-testid="current-account-summary"]').count();
    if (logoutBtnAfterLogout !== 0 || summaryAfterLogout !== 0) {
      throw new Error("After logout, expected current-account-summary and btn-logout to be hidden");
    }
    await p3Page.screenshot({
      path: path.join(AUDIT_DIR, "06-persona3-account-logged-out-form.png"),
      fullPage: true,
    });

    // Register account with Thai + XSS string
    await p3Page.fill('[data-testid="input-username"]', "เทพธาตุ_<script>alert(1)</script>");
    await p3Page.fill('[data-testid="input-password"]', "pass999");
    await p3Page.click('[data-testid="btn-auth-submit"]');
    await p3Page.waitForSelector('[data-testid="modal-tutorial"]', { timeout: 5000 });
    await p3Page.click('[data-testid="btn-tutorial-claim"]');

    if (xssTriggered) {
      throw new Error("XSS payload executed in username!");
    }

    // Logout and test wrong password rejection
    await p3Page.click('[data-testid="btn-modal-account"]');
    await p3Page.click('[data-testid="btn-logout"]');
    await p3Page.fill('[data-testid="input-username"]', "เทพธาตุ_<script>alert(1)</script>");
    await p3Page.fill('[data-testid="input-password"]', "wrong_pass");
    await p3Page.click('[data-testid="btn-auth-submit"]');
    const isAuthAfterWrongPass = await p3Page.evaluate(
      () => window.__TD_APP__!.getSnapshot().isAuthenticated
    );
    if (isAuthAfterWrongPass) {
      throw new Error("Expected wrong password login attempt to remain unauthenticated");
    }

    // Login with correct password -> verify 600 Meta Coins preserved
    await p3Page.fill('[data-testid="input-password"]', "pass999");
    await p3Page.click('[data-testid="btn-auth-submit"]');
    const snapAfterReLogin = await p3Page.evaluate(() => window.__TD_APP__!.getSnapshot());
    if (!snapAfterReLogin.isAuthenticated || snapAfterReLogin.profile.metaCoins !== 600) {
      throw new Error(
        `Expected re-login to restore 600 Meta Coins, got auth=${snapAfterReLogin.isAuthenticated}, coins=${snapAfterReLogin.profile.metaCoins}`
      );
    }

    // Rage-click Gacha 10 times
    await p3Page.click('[data-testid="btn-modal-gacha"]');
    for (let i = 0; i < 10; i++) {
      await p3Page.click('[data-testid="btn-pull-gacha"]');
    }
    const coinsAfterRage = await p3Page.evaluate(
      () => window.__TD_APP__!.getSnapshot().profile.metaCoins
    );
    if (coinsAfterRage < 0) {
      throw new Error(`Coins went negative after rage-clicking Gacha: ${coinsAfterRage}`);
    }
    await p3Context.close();

    // =========================================================================
    // PERSONA 4: Mobile Touch User (390x844 Portrait & 844x390 Landscape)
    // =========================================================================
    const p4Context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const p4Page = await p4Context.newPage();
    await p4Page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await p4Page.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });
    await p4Page.click('[data-testid="btn-tutorial-claim"]');

    const hasHorizontalOverflow = await p4Page.evaluate(() => {
      return document.documentElement.scrollWidth > window.innerWidth + 2;
    });
    if (hasHorizontalOverflow) {
      throw new Error("Mobile viewport 390x844 has unexpected horizontal page overflow");
    }

    const mapBox = await p4Page.locator("#phaser-mount").boundingBox();
    const deployBtnBox = await p4Page.locator('[data-testid="btn-deploy-on-tile"]').boundingBox();
    const bottomDockBox = await p4Page.locator("#hud-bottom").boundingBox();
    if (!mapBox || !deployBtnBox || !bottomDockBox) {
      throw new Error("Mobile battle screen elements missing boundingBox");
    }
    if (
      mapBox.y < 0 ||
      mapBox.y + mapBox.height > 845 ||
      deployBtnBox.y + deployBtnBox.height > 845 ||
      bottomDockBox.y + bottomDockBox.height > 845
    ) {
      throw new Error(
        `Mobile 390x844 Zero-Scroll check failed: mapBottom=${mapBox.y + mapBox.height}, deployBottom=${deployBtnBox.y + deployBtnBox.height}, dockBottom=${bottomDockBox.y + bottomDockBox.height} (expected all <= 845)`
      );
    }

    await p4Page.click('[data-testid="select-hero-pyromancer"]');
    await p4Page.click('[data-testid="btn-deploy-on-tile"]');
    await p4Page.click('[data-testid="btn-auto-wave"]');
    await p4Page.waitForTimeout(400);

    await p4Page.screenshot({
      path: path.join(AUDIT_DIR, "08-mobile-portrait-zero-scroll-battle.png"),
      fullPage: false,
    });

    await p4Page.click('[data-testid="btn-modal-roster"]');
    await p4Page.waitForSelector('[data-testid="roster-hero-inspector"]', { timeout: 5000 });
    await p4Page.click('[data-testid="roster-card-chronoweaver"]');
    await p4Page.screenshot({
      path: path.join(AUDIT_DIR, "07-persona4-mobile-roster-inspector.png"),
      fullPage: false,
    });
    await p4Page.click('[data-testid="btn-close-modal"]');

    await p4Page.setViewportSize({ width: 844, height: 390 });
    await p4Page.waitForTimeout(300);
    await p4Page.screenshot({
      path: path.join(AUDIT_DIR, "09-mobile-landscape-battle.png"),
      fullPage: false,
    });
    await p4Context.close();

    if (consoleErrors.length > 0) {
      throw new Error(`Console errors detected:\n${consoleErrors.join("\n")}`);
    }

    console.log("MULTI-PERSONA AUDIT & BROWSER VERIFICATION PASSED (4/4 Personas)");
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
  console.error("PERSONA AUDIT FAILED:", err);
  process.exit(1);
});
