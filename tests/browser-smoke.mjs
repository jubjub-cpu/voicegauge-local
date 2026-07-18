import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const port = Number(process.env.VOICEGAUGE_TEST_PORT || 4199);
const deployed = process.env.VOICEGAUGE_BASE_URL?.trim();
const base = deployed ? `${deployed.replace(/\/$/, "")}/` : `http://127.0.0.1:${port}/`;
const target = process.env.PLAYWRIGHT_MODULE || "playwright";
const specifier = /^[A-Za-z]:[\\/]/.test(target) ? pathToFileURL(target).href : target;
const { chromium } = await import(specifier);
const desktopShot = fileURLToPath(new URL("../docs/screenshots/voicegauge-local-desktop.png", import.meta.url));
const mobileShot = fileURLToPath(new URL("../docs/screenshots/voicegauge-local-mobile.png", import.meta.url));
const importPath = fileURLToPath(new URL("../data/audio/clear-brief.wav", import.meta.url));
const server = deployed ? null : spawn(process.execPath, ["tools/static-server.mjs", "--port", String(port)], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });

async function ready() {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error("VoiceGauge server did not start");
}

async function acceptClippedWithEvidence(page) {
  await page.locator('[data-sample="clipped-brief"]').click();
  assert.match(await page.locator("#findings-list").innerText(), /Clipping exceeds policy/);
  await page.locator("#accept-audio").click();
  assert.match(await page.locator("#decision-error").innerText(), /12-character/);
  await page.locator("#review-note").fill("Reviewer heard distortion and accepts this synthetic exception.");
  await page.locator("#accept-audio").click();
  assert.match(await page.locator("#decision-summary").innerText(), /Accepted for handoff by human reviewer/);
  assert.match(await page.locator("#audit-list").innerText(), /Audio accepted/);
}

let browser;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await desktop.newPage();
  const errors = [];
  const failed = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failed.push(request.url()));
  await page.goto(base, { waitUntil: "networkidle" });
  assert.equal(await page.locator("[data-sample]").count(), 4);
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains("skip-link")), true);
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => location.hash), "#workspace");
  assert.match(await page.locator("#source-heading").innerText(), /Overdriven handoff/);
  assert.match(await page.locator("#audio-player").getAttribute("src"), /clipped-brief\.wav/);
  assert.match(await page.locator("#readiness-status").innerText(), /review/i);
  await acceptClippedWithEvidence(page);

  const waveformPixels = await page.locator("#waveform").evaluate((canvas) => {
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let count = 0;
    for (let index = 0; index < data.length; index += 80) if (data[index] > 30 || data[index + 1] > 40 || data[index + 2] > 40) count += 1;
    return count;
  });
  assert.ok(waveformPixels > 100);
  await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: desktopShot, fullPage: true });

  await page.locator('[data-sample="noisy-brief"]').click();
  assert.match(await page.locator("#findings-list").innerText(), /Quiet-floor proxy is elevated/);
  await page.locator('[data-sample="pause-heavy"]').click();
  assert.match(await page.locator("#findings-list").innerText(), /Silence ratio is high/);
  await page.locator("#maxSilencePercent").evaluate((input) => { input.value = "70"; input.dispatchEvent(new Event("change", { bubbles: true })); });
  assert.match(await page.locator("#readiness-status").innerText(), /ready/i);
  await page.locator("#reset-policy").click();
  assert.match(await page.locator("#findings-list").innerText(), /Silence ratio is high/);
  await page.locator('[data-sample="clear-brief"]').click();
  assert.match(await page.locator("#findings-list").innerText(), /All configured checks pass/);

  const download = page.waitForEvent("download");
  await page.locator("#export-report").click();
  assert.match((await download).suggestedFilename(), /voicegauge-report\.json$/);
  await page.locator("#audio-import").setInputFiles(importPath);
  await page.locator('[data-sample^="local-"]').waitFor({ state: "visible" });
  assert.equal(await page.locator("[data-sample]").count(), 5);
  assert.match(await page.locator("#audit-list").innerText(), /Local audio opened/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobilePage = await mobile.newPage();
  await mobilePage.goto(base, { waitUntil: "networkidle" });
  await mobilePage.locator('[data-sample="pause-heavy"]').click();
  await mobilePage.locator("#review-note").fill("Long silence exceeds the synthetic delivery policy.");
  await mobilePage.locator("#request-rerecord").click();
  assert.match(await mobilePage.locator("#decision-summary").innerText(), /Re-record requested/);
  assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await mobilePage.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
  await mobilePage.screenshot({ path: mobileShot, fullPage: true });
  await mobile.close();

  const errorContext = await browser.newContext();
  const errorPage = await errorContext.newPage();
  await errorPage.route("**/data/fixtures.json", (route) => route.abort());
  await errorPage.goto(base, { waitUntil: "domcontentloaded" });
  await errorPage.getByRole("heading", { name: "The synthetic audio fixtures could not be decoded." }).waitFor({ state: "visible" });
  assert.equal(await errorPage.getByRole("button", { name: "Retry" }).isVisible(), true);
  await errorContext.close();

  console.log("VOICEGAUGE BROWSER TESTS PASSED");
  console.log(JSON.stringify({ target: deployed ? "deployed" : "local", fixtures: 4, webAudioDecode: true, pcmMetrics: 6, waveform: true, clipping: true, noise: true, silence: true, policyTuning: true, humanGate: true, localImport: true, jsonExport: true, keyboard: true, desktopOverflow: false, mobileOverflow: false, consoleErrors: 0, failedRequests: 0 }));
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}
