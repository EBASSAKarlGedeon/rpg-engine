// Boot check: loads the app, reports uncaught errors and the visible page heading.
//   node tools/boot-test.js http://127.0.0.1:8765/index.html [screenshot.png]
const { chromium } = require("playwright");
(async () => {
  const [url, shot] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => { if (!/^offline$/.test(e.message)) errors.push(e.message.slice(0, 200)); });
  await page.route("**/*", (r) => (/^(http:\/\/127\.0\.0\.1|http:\/\/localhost|data:|blob:)/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(url);
  await page.waitForTimeout(3500);
  const heading = await page.evaluate(() => (document.querySelector(".ld-title, h1, h2") || {}).textContent || "");
  const nav = await page.evaluate(() => [...document.querySelectorAll(".hn-item")].filter((e) => e.offsetParent).map((e) => e.textContent.trim()));
  console.log("heading:", JSON.stringify(heading.trim()), "| visible nav:", JSON.stringify(nav));
  console.log(errors.length ? "ERRORS:\n - " + errors.join("\n - ") : "BOOT OK");
  if (shot) await page.screenshot({ path: shot });
  await browser.close();
  process.exit(errors.length || !/world/i.test(heading) ? 1 : 0);
})();
