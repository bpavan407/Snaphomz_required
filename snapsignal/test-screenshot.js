const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto("http://localhost:3000/dashboard", { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "debug-page.png", fullPage: false });
  // Log what overlay says
  const overlay = await page.locator(".smp-modal-overlay").textContent().catch(() => "not found");
  console.log("Overlay text (first 200):", overlay?.slice(0, 200));
  await browser.close();
})();
