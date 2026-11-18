// End-to-end check: boots the app, creates a hero, plays two turns against the mock LLM,
// and verifies which model each call used. Needs Playwright (npm i -D playwright) and:
//   node tools/mock-llm.js /tmp/mock.log        (terminal 1)
//   npx http-server app -p 8765   OR   python3 -m http.server 8765 --directory app   (terminal 2)
//   node tools/e2e.js http://127.0.0.1:8765/index.html /tmp/mock.log [screenshot-dir]
const { chromium } = require("playwright");
const fs = require("fs");

(async () => {
  const [url, logFile, shotDir = "."] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => { if (!/^offline$/.test(e.message)) problems.push("pageerror: " + e.message.slice(0, 160)); });
  await page.addInitScript(() => {
    if (localStorage.getItem("mno.aiProvider")) return;
    // main model = "mock-main"; cheap model = "mock-cheap" (used by routes switched OFF)
    localStorage.setItem("mno.aiProvider", JSON.stringify({
      provider: "openai",
      providers: { openai: { baseUrl: "http://127.0.0.1:8766/v1", model: "mock-main" } },
      useExternal: { tracker: false, staging: false, check: false },
    }));
    localStorage.setItem("mno.aiProviderKey", JSON.stringify({ openai: "sk-test" }));
    localStorage.setItem("rpge.cheapModel", JSON.stringify({ baseUrl: "http://127.0.0.1:8766/v1", apiKey: "k", model: "mock-cheap" }));
  });
  await page.route("**/*", (r) => (/^(http:\/\/127\.0\.0\.1|data:|blob:)/.test(r.request().url()) ? r.continue() : r.abort()));

  await page.goto(url);
  await page.waitForTimeout(2500);
  await page.getByText(/begin your adventure/i).first().click();
  await page.getByText(/use this world/i).first().click();
  await page.waitForSelector("#cc_name");
  await page.fill("#cc_name", "Hiro");
  for (let i = 0; i < 4; i++) {
    const next = page.getByRole("button", { name: /next/i });
    if (await next.count() && await next.first().isVisible()) { await next.first().click(); await page.waitForTimeout(300); } else break;
  }
  await page.getByRole("button", { name: /begin adventure/i }).click();
  const composer = page.locator('textarea[placeholder*="What do you do"]');
  await composer.waitFor({ timeout: 20000 });
  await page.waitForTimeout(7000);
  await composer.fill("I bow politely and ask where we are.");
  await composer.press("Enter");
  await page.waitForTimeout(8000);
  await page.screenshot({ path: shotDir + "/e2e-game.png" });

  const dharraBubbles = await page.locator("text=You came. Good. Sit.").count();
  if (dharraBubbles < 2) problems.push("expected the NPC line to render on both turns, saw " + dharraBubbles);
  const calls = fs.readFileSync(logFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const summary = {};
  for (const c of calls) { const key = c.kind + " -> " + c.model; summary[key] = (summary[key] || 0) + 1; }
  console.log("calls by kind -> model:", JSON.stringify(summary, null, 1));
  const gm = calls.filter((c) => c.kind === "gm");
  if (!gm.length || gm.some((c) => c.model !== "mock-main")) problems.push("GM calls should use mock-main");
  const cheap = calls.filter((c) => ["staging", "hero-tracker", "npc-tracker", "check"].includes(c.kind));
  if (!cheap.length || cheap.some((c) => c.model !== "mock-cheap")) problems.push("tracker/staging/check calls should use mock-cheap");
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "E2E OK");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
