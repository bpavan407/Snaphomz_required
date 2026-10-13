const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ headless: false, slowMo: 150 });
  const page    = await browser.newPage();
  page.setDefaultTimeout(20000);

  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });

  // Dismiss role picker modal ("Welcome — who are you?")
  const enterBtn = page.locator("text=Enter Agent Dashboard");
  if (await enterBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
    await enterBtn.click();
    await page.waitForTimeout(800);
  }

  // Click first Generate button
  await page.locator("button").filter({ hasText: /Generate/i }).first().click();
  await page.waitForSelector("text=Generating Video", { timeout: 8000 });
  console.log("Modal open ✓");
  await page.screenshot({ path: "confirm-01-modal.png" });

  // Wait for script (~15s)
  await page.waitForFunction(
    () => [...document.querySelectorAll("div")].some(d => /HOOK|PROBLEM|INSIGHT/i.test(d.textContent)),
    { timeout: 30000 }
  );
  console.log("Script shown ✓");
  await page.screenshot({ path: "confirm-02-script.png" });

  // Wait for video (live gen or fallback — fallback is instant)
  await page.waitForSelector("video", { timeout: 360000 });
  const src = await page.locator("video").getAttribute("src");
  console.log(`Video playing: ${src} ✓`);
  await page.screenshot({ path: "confirm-03-video.png" });

  // Confirm Post to YouTube button visible
  const ytBtn = await page.locator("button", { hasText: /Post to YouTube/i }).isVisible();
  console.log(`Post to YouTube button: ${ytBtn ? "visible ✓" : "MISSING ✗"}`);

  await page.waitForTimeout(5000);
  await browser.close();
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
