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
    const context = await browser.newContext({
      viewport: { width: 1240, height: 840 },
    });
    const page = await context.newPage();

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

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "01-battle-initial.png"),
      fullPage: true,
    });

    await page.click('[data-testid="tab-roster"]');
    await page.waitForSelector('[data-testid="btn-pull-gacha"]', { timeout: 5000 });

    const beforeCoins = await page.evaluate(
      () => window.__TD_APP__!.getSnapshot().profile.metaCoins
    );
    await page.click('[data-testid="btn-pull-gacha"]');
    await page.waitForSelector('[data-testid="gacha-result-banner"]', { timeout: 5000 });
    const afterCoins = await page.evaluate(
      () => window.__TD_APP__!.getSnapshot().profile.metaCoins
    );
    if (afterCoins !== beforeCoins - 100) {
      throw new Error(`Expected metaCoins to drop by 100 (${beforeCoins} -> ${afterCoins})`);
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "02-gacha-and-roster.png"),
      fullPage: true,
    });

    await page.click('[data-testid="tab-battle"]');
    await page.waitForSelector('[data-testid="btn-deploy-on-tile"]', { timeout: 5000 });

    const canvasBox = await page.locator("#phaser-mount canvas").boundingBox();
    if (!canvasBox) {
      throw new Error("Phaser canvas boundingBox not found");
    }

    await page.mouse.click(canvasBox.x + 2 * 32 + 16, canvasBox.y + 2 * 32 + 16);
    const pathRejectBanner = await page.textContent('[data-testid="status-banner"]');
    if (!pathRejectBanner?.includes("TILE_IS_PATH")) {
      throw new Error(
        `Expected clicking enemy path tile (2,2) to reject with TILE_IS_PATH, got: ${pathRejectBanner}`
      );
    }

    await page.click('[data-testid="select-hero-frostmage"]');
    await page.click('[data-testid="ground-tile-0"]');
    await page.click('[data-testid="btn-deploy-on-tile"]');
    const terrainMismatchBanner = await page.textContent('[data-testid="status-banner"]');
    if (!terrainMismatchBanner?.includes("TERRAIN_MISMATCH")) {
      throw new Error(
        `Expected placing High-Ground hero frostmage on Ground tile to reject with TERRAIN_MISMATCH, got: ${terrainMismatchBanner}`
      );
    }

    await page.click('[data-testid="hg-tile-0"]');
    await page.click('[data-testid="btn-deploy-on-tile"]');

    await page.click('[data-testid="hg-tile-1"]');
    await page.click('[data-testid="btn-deploy-on-tile"]');

    const frostCount = await page.textContent('[data-testid="deploy-cap-frostmage"]');
    if (frostCount?.trim() !== "2/2") {
      throw new Error(`Expected frostmage deploy cap badge to be 2/2, got ${frostCount}`);
    }

    await page.click('[data-testid="hg-tile-2"]');
    await page.click('[data-testid="btn-deploy-on-tile"]');
    const capBanner = await page.textContent('[data-testid="status-banner"]');
    if (!capBanner?.includes("DEPLOY_CAP_REACHED")) {
      throw new Error(`Expected 3rd frostmage deploy to fail with DEPLOY_CAP_REACHED, got: ${capBanner}`);
    }

    await page.click('[data-testid="hg-tile-1"]');
    await page.click('[data-testid="btn-sell-selected"]');

    await page.click('[data-testid="select-hero-pyromancer"]');
    await page.mouse.click(canvasBox.x + 2 * 32 + 16, canvasBox.y + 4 * 32 + 16);
    const pyroCount = await page.textContent('[data-testid="deploy-cap-pyromancer"]');
    if (pyroCount?.trim() !== "1/6") {
      throw new Error(
        `Expected free canvas click on Ground tile (2,4) to deploy pyromancer (1/6), got ${pyroCount}`
      );
    }

    await page.click('[data-testid="select-hero-archer"]');
    await page.mouse.click(canvasBox.x + 5 * 32 + 16, canvasBox.y + 4 * 32 + 16);

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
      path: path.join(SCREENSHOT_DIR, "03-tactical-deploy-and-skill.png"),
      fullPage: true,
    });

    await page.click('[data-testid="tab-leaderboard"]');
    await page.waitForSelector('[data-testid="btn-record-run"]', { timeout: 5000 });
    await page.click('[data-testid="btn-record-run"]');
    await page.waitForSelector('[data-testid="leaderboard-row-2"]', { timeout: 5000 });
    const lbText = await page.textContent('[data-testid="leaderboard-list"]');
    if (!lbText?.includes("Commander You")) {
      throw new Error("Expected recorded run 'Commander You' to appear in Leaderboard");
    }

    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, "04-endless-leaderboard.png"),
      fullPage: true,
    });

    if (consoleErrors.length > 0) {
      throw new Error(`Browser console/page errors detected:\n${consoleErrors.join("\n")}`);
    }

    console.log("BROWSER VERIFICATION PASSED");
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
