// Verifies the cosmetic tweaks: Explore/Tavern hidden in the sidebar and Settings, Settings opens on AI Model.
//   node tools/check-tweaks.js http://127.0.0.1:8765/index.html [screenshot.png]
const { chromium } = require("playwright");
(async () => {
  const [url, shot] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.route("**/*", (r) => (/^(http:\/\/127\.0\.0\.1|http:\/\/localhost|data:|blob:)/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.goto(url);
  await page.waitForTimeout(2500);
  const hiddenNav = await page.evaluate(() => [...document.querySelectorAll(".hn-item")].filter((e) => getComputedStyle(e).display === "none").map((e) => e.textContent.trim()));
  await page.locator(".hn-item", { hasText: /settings/i }).first().click();
  await page.waitForTimeout(1200);
  const state = await page.evaluate(() => {
    const popup = document.querySelector(".popup");
    const btns = popup ? [...popup.querySelectorAll("button")].filter((b) => getComputedStyle(b).display !== "none").map((b) => b.textContent.trim()) : [];
    const title = popup && popup.querySelector(".hm-title, .pf-title, h2");
    return { visibleSettingsButtons: btns, activeTitle: title ? title.textContent.trim() : null };
  });
  console.log("hidden sidebar items:", JSON.stringify(hiddenNav));
  console.log("settings:", JSON.stringify(state));
  const ok = hiddenNav.some((t) => /explore/i.test(t)) && hiddenNav.some((t) => /tavern/i.test(t))
    && !state.visibleSettingsButtons.some((t) => /^(identity|admin)$/i.test(t))
    && state.visibleSettingsButtons.some((t) => /^AI Model$/i.test(t));
  if (shot) await page.screenshot({ path: shot });
  console.log(ok ? "TWEAKS OK" : "TWEAKS PROBLEM");
  await browser.close();
  process.exit(ok ? 0 : 1);
})();
