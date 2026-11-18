// One-off: screenshot the import page against the live packaged app (single-user mode, no login).
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1100 } });
  await page.goto("http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/loreweaver-import.html", { waitUntil: "load" });
  await page.waitForSelector(".prow", { timeout: 15000 });
  await page.waitForTimeout(1500); // avatars paint
  await page.screenshot({ path: process.env.OUT, fullPage: false });
  await browser.close();
  console.log("saved", process.env.OUT);
})().catch((e) => { console.error(e.message); process.exit(1); });
