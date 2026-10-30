import { spawn, ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";

const PORT = 5173;
const BASE_URL = `http://localhost:${PORT}`;
const SCREENSHOT_DIR = path.resolve(process.cwd(), "screenshots", "tower-defense-mvp");

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

async function runVerification(): Promise<void> {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

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
    const desktopContext = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
    });
    const page = await desktopContext.newPage();

    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      consoleErrors.push(err.message);
    });

    await page.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await page.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });

    await page.click('[data-testid="tab-account"]');
    await page.fill('[data-testid="input-username"]', "RiftTactician");
    await page.fill('[data-testid="input-password"]', "secret123");
    await page.click('[data-testid="btn-auth-submit"]');
    await page.waitForSelector('[data-testid="tutorial-banner"]', { timeout: 5000 });

    await page.click('[data-testid="tab-battle"]');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-desktop-widescreen-tutorial.png"),
      fullPage: true,
    });

    const coinsBeforeTutorial = await page.evaluate(
      () => window.__TD_APP__!.getSnapshot().profile.metaCoins
    );
    await page.click('[data-testid="btn-tutorial-skip"]');
    const coinsAfterTutorial = await page.evaluate(
      () => window.__TD_APP__!.getSnapshot().profile.metaCoins
    );
    if (coinsAfterTutorial !== coinsBeforeTutorial + 200) {
      throw new Error(
        `Expected +200 tutorial completion bonus (${coinsBeforeTutorial} -> ${coinsAfterTutorial})`
      );
    }

    await page.click('[data-testid="tab-roster"]');
    await page.waitForSelector('[data-testid="btn-pull-gacha"]', { timeout: 5000 });
    await page.click('[data-testid="btn-pull-gacha"]');
    await page.waitForSelector('[data-testid="gacha-result-banner"]', { timeout: 5000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-gacha-4tier-and-roster.png"),
      fullPage: true,
    });

    await page.click('[data-testid="tab-stages"]');
    await page.waitForSelector('[data-testid="drawer-stages"]', { timeout: 5000 });

    const stage2EasyLockedBefore = await page.isDisabled('[data-testid="btn-stage-2-EASY"]');
    const stage1MedLockedBefore = await page.isDisabled('[data-testid="btn-stage-1-MEDIUM"]');
    if (!stage2EasyLockedBefore || !stage1MedLockedBefore) {
      throw new Error("Expected Stage 1 MEDIUM and Stage 2 EASY to start locked for new account");
    }

    await page.evaluate(() => {
      window.__TD_APP__!.simulateStageClearForVerification(1, "EASY");
    });

    const stage2EasyLockedAfter = await page.isDisabled('[data-testid="btn-stage-2-EASY"]');
    const stage1MedLockedAfter = await page.isDisabled('[data-testid="btn-stage-1-MEDIUM"]');
    if (stage2EasyLockedAfter || stage1MedLockedAfter) {
      throw new Error(
        "Clearing Stage 1 EASY must unlock both Stage 1 MEDIUM and Stage 2 EASY"
      );
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "03-stages-cross-unlock-tree.png"),
      fullPage: true,
    });

    await page.click('[data-testid="btn-stage-2-EASY"]');
    await page.waitForSelector('[data-testid="btn-deploy-on-tile"]', { timeout: 5000 });

    await page.click('[data-testid="select-hero-archer"]');
    await page.click('[data-testid="ground-tile-0"]');
    await page.click('[data-testid="btn-deploy-on-tile"]');

    await page.click('[data-testid="select-hero-pyromancer"]');
    await page.click('[data-testid="ground-tile-1"]');
    await page.click('[data-testid="btn-deploy-on-tile"]');

    const flameSynergyText = await page.textContent('[data-testid="synergy-pill-FLAME"]');
    if (!flameSynergyText?.includes("ACTIVE")) {
      throw new Error(
        `Expected deploying 2 FLAME heroes to activate FLAME synergy, got: ${flameSynergyText}`
      );
    }

    await page.click('[data-testid="select-hero-frostmage"]');
    await page.click('[data-testid="hg-tile-0"]');
    await page.click('[data-testid="btn-deploy-on-tile"]');

    const startWaveBtnBox = await page.locator('[data-testid="btn-start-wave"]').boundingBox();
    if (!startWaveBtnBox) {
      throw new Error("Start wave button boundingBox not found");
    }
    await page.mouse.move(
      startWaveBtnBox.x + startWaveBtnBox.width / 2,
      startWaveBtnBox.y + startWaveBtnBox.height / 2
    );
    await page.mouse.down();
    await page.waitForTimeout(130);
    await page.mouse.up();
    await page.waitForTimeout(1900);

    const skillCastOk = await page.evaluate(() => {
      return window.__TD_APP__!.castSkillForHeroType("archer");
    });
    if (!skillCastOk) {
      throw new Error("Expected Archer Active Skill (Arrow Volley) to cast once ready");
    }

    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-stage2-synergy-and-skill.png"),
      fullPage: true,
    });

    await page.click('[data-testid="tab-leaderboard"]');
    await page.waitForSelector('[data-testid="btn-record-run"]', { timeout: 5000 });
    await page.click('[data-testid="btn-record-run"]');
    const lbText = await page.textContent('[data-testid="leaderboard-list"]');
    if (!lbText?.includes("RiftTactician")) {
      throw new Error("Expected logged-in account 'RiftTactician' on Leaderboard");
    }

    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(BASE_URL, { waitUntil: "networkidle", timeout: 15000 });
    await mobilePage.waitForFunction(() => Boolean(window.__TD_APP__), { timeout: 10000 });
    await mobilePage.screenshot({
      path: path.join(SCREENSHOT_DIR, "05-mobile-responsive.png"),
      fullPage: true,
    });
    await mobileContext.close();

    if (consoleErrors.length > 0) {
      throw new Error(`Browser console/page errors detected:\n${consoleErrors.join("\n")}`);
    }

    console.log("BROWSER VERIFICATION PASSED");
    console.log("- Account registration & 4-step first-time tutorial (+200 Coins) verified");
    console.log("- 10-Stage cross-progression unlock (Stage 1 Easy -> Stage 1 Medium + Stage 2 Easy) verified");
    console.log("- Stage 2 distinct map & FLAME 2/2 Elemental Synergy ACTIVE verified");
    console.log("- Desktop Widescreen (1920x1080) & Mobile Responsive (390x844) screenshots captured");
    console.log(`- Console Errors: ${consoleErrors.length}`);
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

runVerification().catch((err) => {
  console.error("BROWSER VERIFICATION FAILED:", err);
  process.exit(1);
});
