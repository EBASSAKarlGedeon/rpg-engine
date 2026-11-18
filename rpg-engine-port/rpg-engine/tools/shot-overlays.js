// One-off visual check: open Loreweaver, click the RPG Engine drawer buttons, screenshot overlays.
const { chromium } = require("playwright");
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 780 } });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message.slice(0, 160)));
  await page.goto("http://127.0.0.1:8000/", { waitUntil: "load" });
  await page.waitForSelector("#rpg_engine_bridge", { timeout: 15000, state: "attached" });
  await page.waitForTimeout(1500);
  for (const [btn, out] of [
    ["#rpg_engine_bridge", process.env.OUT1],
    ["#rpg_engine_import", process.env.OUT2],
  ]) {
    await page.evaluate((b) => document.querySelector(b).click(), btn);
    await page.waitForTimeout(2500); // iframe lazy-loads + renders
    const vis = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".rpge-page-root")];
      return els.map((e) => ({ id: e.id, hidden: e.hidden, h: e.getBoundingClientRect().height, w: e.getBoundingClientRect().width }));
    });
    console.log(btn, JSON.stringify(vis));
    await page.screenshot({ path: out });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await browser.close();
  console.log("done");
})().catch((e) => { console.error("FAIL", e.message.slice(0, 300)); process.exit(1); });
