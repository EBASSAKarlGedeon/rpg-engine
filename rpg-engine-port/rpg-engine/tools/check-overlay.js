// Tests the SillyTavern wrapper (index.js + style.css) against tools/fake-st.html.
//   python3 -m http.server 8767 --bind 127.0.0.1      (run in the extension root)
//   node tools/check-overlay.js http://127.0.0.1:8767/tools/fake-st.html [screenshot.png]
const { chromium } = require("playwright");
(async () => {
  const [url, shot] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 850 } });
  const problems = [];
  page.on("pageerror", (e) => { if (!/^offline$/.test(e.message)) problems.push("pageerror: " + e.message.slice(0, 160)); });
  await page.route("**/*", (r) => (/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(url);
  await page.waitForSelector("#rpge-menu-entry", { timeout: 5000 }).catch(() => problems.push("menu entry was not added"));
  if (!(await page.locator("#rpge-launcher").count())) problems.push("launcher button missing");
  if (await page.locator("#rpge-root").count()) problems.push("overlay should not exist before the first open");
  await page.locator("#rpge-menu-entry").click();
  await page.waitForTimeout(3500);
  const visible = await page.locator("#rpge-root").isVisible();
  if (!visible) problems.push("overlay not visible after clicking the menu entry");
  const frame = page.frames().find((f) => f.url().includes("/app/index.html"));
  const heading = frame ? await frame.evaluate(() => (document.querySelector(".ld-title, h1, h2") || {}).textContent || "") : "";
  if (!/world/i.test(heading)) problems.push("app did not render inside the iframe (heading: " + JSON.stringify(heading) + ")");
  if (shot) await page.screenshot({ path: shot });
  await page.locator("#rpge-root .rpge-close").click();
  if (await page.locator("#rpge-root").isVisible()) problems.push("overlay still visible after Close");
  await page.locator("#rpge-launcher").click();
  if (!(await page.locator("#rpge-root").isVisible())) problems.push("launcher did not reopen the overlay");
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "OVERLAY OK");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
