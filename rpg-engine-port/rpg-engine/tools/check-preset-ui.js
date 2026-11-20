// [rpge-patch 022 followup] verification: Prompt Preset library UI + AI Model response tuning.
// Seeded kv STUB (no real-server writes), isolated browser context (own localStorage).
// Verifies: library row (select + On/Off), import, play-order rows, orphan group + add-to-order,
// block editing persisted into the synced blob, preset delete, and the AI Model Response-tuning
// foldbox (sampler inputs persisted to the engine config).
// Usage: node tools/check-preset-ui.js
const { chromium } = require("playwright");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const SHOT = "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/";
const fs = require("fs");
fs.mkdirSync(SHOT, { recursive: true });
const problems = [];
const ok = (cond, msg) => { if (cond) console.log("  ok:", msg); else { problems.push(msg); console.log("  FAIL:", msg); } };

// Small fixture preset: 2 blocks in the play order, 1 orphaned block (not in order).
const FIXTURE = JSON.stringify({
  prompts: [
    { identifier: "blk-1", name: "Weather Rule", role: "system", content: "STYLE TEST: end every reply with one weather observation.", marker: false, system_prompt: false, injection_position: 0, injection_depth: 4, forbid_overrides: false, injection_order: 100, injection_trigger: [] },
    { identifier: "blk-2", name: "Pace Rule", role: "system", content: "Keep replies under 300 words.", marker: false, system_prompt: false, injection_position: 0, injection_depth: 4, forbid_overrides: false, injection_order: 100, injection_trigger: [] },
    { identifier: "blk-orphan", name: "Old Version (unused)", role: "system", content: "ORPHAN CONTENT — not in the play order.", marker: false, system_prompt: false, injection_position: 0, injection_depth: 4, forbid_overrides: false, injection_order: 100, injection_trigger: [] },
  ],
  prompt_order: [{ character_id: 100001, order: [{ identifier: "blk-1", enabled: true }, { identifier: "blk-2", enabled: true }] }],
});
const FIXTURE_PATH = SHOT + "preset-fixture.json";
fs.writeFileSync(FIXTURE_PATH, FIXTURE, "utf8");

(async () => {
  const kv = new Map();
  const put = (folder, key, val) => kv.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  put("worlds", "index", []);
  put("rpg", "sessions", []);

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("pageerror", (e) => { if (!/^offline$/.test(e.message)) problems.push("pageerror: " + e.message.slice(0, 160)); });
  page.on("console", (m) => { const t = m.text(); if (/\[rpge\]|preset|Preset|error|Error/i.test(t)) console.log("  console:", m.type(), t.slice(0, 220)); });
  await page.route("**/api/rpg-engine-kv/**", async (r) => {
    const op = r.request().url().split("/").pop().split("?")[0];
    const body = r.request().postDataJSON() || {};
    if (op === "list") return r.fulfill({ json: { entries: [...kv.keys()].map(n => ({ name: n, mtimeMs: 1700000000000, size: (kv.get(n) || "").length })) } });
    if (op === "get") return r.fulfill({ json: { content: kv.has(body.name) ? kv.get(body.name) : null, mtimeMs: kv.has(body.name) ? 1700000000000 : 0 } });
    if (op === "put") { kv.set(body.name, body.content); return r.fulfill({ json: { mtimeMs: 1700000000000 } }); }
    if (op === "delete") { kv.set(body.name.replace(/\.json$/, "") + ".tomb.json", JSON.stringify({ deletedAt: 1700000000000 })); kv.delete(body.name); return r.fulfill({ json: { ok: true, mtimeMs: 1700000000000 } }); }
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(20000);

  const libKey = b64url("rpg\u0000promptPresets") + ".json";
  const readLib = () => { try { return JSON.parse(kv.get(libKey)); } catch { return null; } };

  console.log("1) Settings → Prompt Preset opens");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mno:open-settings", { detail: { section: "preset" } })));
  try {
    await page.waitForSelector(".pf-preset", { timeout: 20000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({ activeNav: [...document.querySelectorAll(".pf-md-btn")].filter(b => b.classList.contains("on")).map(b => b.textContent), empty: !!document.querySelector(".pf-md-panel .hm-empty"), emptyText: (document.querySelector(".pf-md-panel .hm-empty") || {}).textContent || "", loading: !!document.querySelector(".pf-md-panel .set-loading") }));
    console.log("DIAG:", JSON.stringify(diag));
    throw e;
  }
  ok(true, "preset section rendered");

  console.log("2) import via the hidden file input");
  await page.setInputFiles("#psFile", FIXTURE_PATH);
  await page.waitForTimeout(1500);
  ok((await page.locator(".pf-preset #psLibSel option:not([value=''])").count()) === 1, "library lists the imported preset");
  ok(await page.locator(".pf-preset #psLibSel").inputValue() === "preset-fixture", "imported preset is active");
  const libBlob = readLib();
  ok(libBlob && libBlob.on === true && libBlob.active === "preset-fixture" && libBlob.presets.length === 1, "synced blob written: {presets, active, on:true}");
  ok((await page.locator(".pf-preset > .ps-list > .ps-row").count()) === 2, "two play-order rows render");
  ok(await page.locator(".pf-preset .ps-orph summary").textContent().then(t => t.includes("Not in play order (1)")), "orphan foldout shows 1 block");
  await page.screenshot({ path: SHOT + "ps01-import.png" });

  console.log("3) orphan add-to-order");
  await page.locator(".pf-preset .ps-orph summary").click();
  await page.waitForTimeout(400);
  await page.locator(".pf-preset .ps-addorphan").first().click();
  await page.waitForTimeout(800);
  ok((await page.locator(".pf-preset > .ps-list > .ps-row").count()) === 3, "orphan appended to the play order");
  ok((await page.locator(".pf-preset .ps-orph").count()) === 0, "orphan foldout gone (nothing left outside the order)");
  const libBlob2 = readLib();
  const order2 = libBlob2 && libBlob2.presets[0] && JSON.parse(libBlob2.presets[0].raw).prompt_order[0].order;
  ok(order2 && order2.length === 3 && order2[2].identifier === "blk-orphan", "order entry appended in the synced blob");

  console.log("4) block edit persists");
  await page.locator('.pf-preset .ps-name[data-id="blk-1"]').click();
  await page.waitForTimeout(400);
  const ta = page.locator('.pf-preset .ps-content[data-id="blk-1"]');
  ok(await ta.count() === 1, "content editor opens");
  await ta.fill("STYLE TEST: end every reply with one BIRD observation.");
  await page.locator('.pf-preset .ps-save[data-id="blk-1"]').click();
  await page.waitForTimeout(800);
  const libBlob3 = readLib();
  ok(libBlob3 && JSON.stringify(libBlob3).includes("one BIRD observation"), "edited content persisted into the synced blob");

  console.log("5) library switch + delete preset");
  const swText = await page.locator("#psOnMount .ui-sw .sw-text").textContent();
  ok(swText === "On", "stack switch reads On after import");
  await page.locator("#psOnMount .ui-sw").click();
  await page.waitForTimeout(500);
  ok((readLib() || {}).on === false, "switching Off persists on:false");
  await page.locator("#psDelPreset").click();
  await page.waitForTimeout(400);
  await page.locator(".confirm-ok").click();
  await page.waitForTimeout(800);
  const libBlob4 = readLib();
  ok(libBlob4 && libBlob4.presets.length === 0 && libBlob4.on === false && libBlob4.active === "", "delete clears the library back to engine-native");
  await page.screenshot({ path: SHOT + "ps02-deleted.png" });

  console.log("6) AI Model → Response tuning");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mno:open-settings", { detail: { section: "aimodel" } })));
  await page.locator(".pf-ai-samp summary").first().click(); // open the Response tuning foldbox
  await page.waitForSelector(".pf-ai-sampgrid", { timeout: 30000 });
  ok((await page.locator(".pf-ai-sampgrid input.pf-ai-samp").count()) === 5, "5 sampler inputs render");
  ok(await page.locator("#pfAiMaxReply").count() === 1, "max-reply input renders");
  await page.locator('.pf-ai-samp[data-k="temperature"]').fill("0.7");
  await page.locator('.pf-ai-samp[data-k="temperature"]').dispatchEvent("change");
  await page.waitForTimeout(400);
  const cfg = await page.evaluate(() => JSON.parse(localStorage.getItem("mno.aiProvider") || "{}"));
  ok(cfg.samplers && cfg.samplers.temperature === 0.7, "temperature 0.7 persisted to the engine config");
  ok(cfg.samplers && cfg.samplers.top_p === "", "unset samplers stay blank (= profile decides)");
  await page.screenshot({ path: SHOT + "ps03-tuning.png" });

  await browser.close();
  console.log("");
  console.log(problems.length === 0 ? "PRESET-UI OK" : "PRESET-UI FAIL: " + problems.length + " problem(s)");
  process.exit(problems.length === 0 ? 0 : 1);
})().catch((e) => { console.error("HARNESS FAIL:", e); process.exit(1); });
