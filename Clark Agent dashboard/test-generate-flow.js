/**
 * Quick Playwright smoke test for the Generate Video flow.
 * Run: node test-generate-flow.js
 */
const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const page    = await browser.newPage();
  page.setDefaultTimeout(30000);

  console.log("Opening dashboard...");
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await page.screenshot({ path: "test-01-dashboard.png" });
  console.log("  Screenshot: test-01-dashboard.png");

  // Click first Generate Video button (Top Video Opportunities or signal feed)
  const btn = page.locator("button").filter({ hasText: /Generate/i }).first();
  const btnText = await btn.textContent().catch(() => "?");
  console.log(`Clicking: "${btnText.trim()}"`);
  await btn.click();

  // Wait for modal
  await page.waitForSelector("text=Generating Video", { timeout: 10000 });
  console.log("  Modal opened ✓");
  await page.screenshot({ path: "test-02-modal-open.png" });
  console.log("  Screenshot: test-02-modal-open.png");

  // Wait for script to appear (right panel loses spinner)
  console.log("  Waiting for AI script (~10s)...");
  try {
    await page.waitForFunction(
      () => {
        const panels = [...document.querySelectorAll("div")];
        return panels.some(d => d.textContent?.includes("hook") || d.textContent?.includes("HOOK") || d.textContent?.includes("problem"));
      },
      { timeout: 45000 }
    );
    console.log("  Script panel populated ✓");
    await page.screenshot({ path: "test-03-script-shown.png" });
    console.log("  Screenshot: test-03-script-shown.png");
  } catch {
    console.log("  Script panel timeout — taking screenshot anyway");
    await page.screenshot({ path: "test-03-script-timeout.png" });
  }

  // Wait for video to appear OR fallback (up to 5 min)
  console.log("  Waiting for video player (~1-5 min)...");
  try {
    await page.waitForSelector("video", { timeout: 360000 });
    const videoSrc = await page.locator("video").getAttribute("src").catch(() => "?");
    console.log(`  Video player appeared ✓  src=${videoSrc}`);
    await page.screenshot({ path: "test-04-video-ready.png" });
    console.log("  Screenshot: test-04-video-ready.png");

    // Check video actually loads
    const videoOk = await page.evaluate(() => {
      const v = document.querySelector("video");
      return v ? v.readyState >= 2 : false;  // HAVE_CURRENT_DATA or better
    });
    console.log(`  Video loaded: ${videoOk}`);
  } catch (e) {
    console.log(`  Video player timeout: ${e.message}`);
    await page.screenshot({ path: "test-04-video-timeout.png" });
  }

  console.log("\nDone. Leaving browser open for 10s...");
  await page.waitForTimeout(10000);
  await browser.close();
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
