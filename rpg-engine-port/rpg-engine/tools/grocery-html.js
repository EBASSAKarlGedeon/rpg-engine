// Grocery HTML test: seed a world + hero (real e2e), ask the AI in chat for an HTML grocery-list
// preview, then screenshot the reply to verify GFX panels (patch 020) render real HTML + inline
// images passthrough in a genuine assistant message (not just a synthetic fixture).
// Usage: node tools/grocery-html.js
const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const OUT = "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const fs = require("fs");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const kv = new Map();
  const put = (folder, key, val) => kv.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  const seed = () => {
    put("worlds", "wstress", makeWorld());
    put("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
    const s = makeSession();
    put("rpg", "sessions", [{ id: s.id, name: s.name, charName: "Wren", worldId: "wstress", worldName: "Stress Test Valley", turn: 11, lastUpdated: 1700000000000, avatar: "", portraitSig: "" }]);
    put("rpg", "session_" + s.id, s);
    put("rpg", "activeSession", s.id);
  };
  seed();

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message.slice(0, 200)));
  await page.addInitScript(() => {
    localStorage.setItem("mno.aiProvider", JSON.stringify({ provider: "openai", providers: { openai: { baseUrl: "http://bridge.invalid/v1", model: "bridged-model" } }, useExternal: { tracker: false, staging: false, check: false } }));
    localStorage.setItem("mno.aiProviderKey", JSON.stringify({ openai: "sk-test" }));
    localStorage.setItem("rpge.loreweaverBridge", JSON.stringify({ enabled: true, profileId: "432b3e02-09e4-4bf0-a93c-662c9f8d5f7c", usePreset: true, roles: {} }));
  });
  await page.route("**/api/rpg-engine-kv/**", async (r) => {
    const req = r.request(); let body = {};
    try { body = req.postDataJSON(); } catch {}
    const op = (req.url() || "").split("/").pop();
    if (op === "list") return r.fulfill({ json: { entries: [...kv.keys()].map(n => ({ name: n, mtimeMs: 1700000000000, size: (kv.get(n) || "").length })) } });
    if (op === "get") return r.fulfill({ json: { content: kv.has(body.name) ? kv.get(body.name) : null, mtimeMs: kv.has(body.name) ? 1700000000000 : 0 } });
    if (op === "put") { kv.set(body.name, body.content); return r.fulfill({ json: { mtimeMs: 1700000000000 } }); }
    return r.fulfill({ json: { ok: true } });
  });

  await page.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => document.querySelector("#transcriptEl") || document.querySelector(".hn-item"), undefined, { timeout: 90000 });
  await page.waitForTimeout(6000);
  seed(); // re-seed after the first boot's writes (index-overwrite race)
  await page.reload({ waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => document.querySelector("#transcriptEl") || document.querySelector(".hn-item"), undefined, { timeout: 90000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: OUT + "/grocery-01-boot.png" });
  console.log("booted:", await page.title());

  // Send the real request.
  const ta = page.locator('textarea[placeholder*="What do you do"]');
  await ta.waitFor({ timeout: 30000 });
  await ta.fill("Please create an HTML preview of a list of groceries — use a real HTML panel (the GFX block markup) and also try showing one inline image. Render it visually, don't just describe it.");
  await page.keyboard.press("Enter");
  console.log("sent — waiting for AI reply (bridged, real model, can take up to ~2-4 min)...");

  // Wait for the send button to flip back to idle (➤), then give the render pass a beat.
  await page.waitForFunction(() => {
    const b = document.querySelector("#sendBtn");
    return b && b.textContent.trim() === "➤";
  }, undefined, { timeout: 300000 });
  // Chill for two stability cycles like heavy-interact.js's idle() checks for message count settling.
  let last = -1, stable = 0, msgs = -1;
  while (stable < 2) {
    await page.waitForTimeout(4000);
    msgs = await page.evaluate(() => document.querySelectorAll("#transcriptEl > *").length).catch(() => -1);
    if (msgs === last) stable++; else { stable = 0; last = msgs; }
  }
  await page.waitForTimeout(2000);

  // Inspect the last message's rendered HTML.
  const inspect = await page.evaluate(() => {
    const root = document.querySelector("#transcriptEl");
    const kids = root ? [...root.children] : [];
    const last = kids[kids.length - 1];
    if (!last) return { msgCount: 0, error: "no messages found" };
    const gfxBlocks = last.querySelectorAll(".gfx-wrap > *").length;
    const allGfx = [...document.querySelectorAll(".gfx-terminal, .gfx-map, .gfx-letter, .gfx-phone, .gfx-wrap")].length;
    const inlineImgs = [...document.querySelectorAll(".msg-img")].length;
    const badImgs = [...document.querySelectorAll(".msg-img-bad")].length;
    return {
      msgCount: kids.length,
      lastTextSample: (last.textContent || "").slice(0, 500),
      gfxBlocks, allGfx, inlineImgs, badImgs,
      gfxHtml: (last.querySelector(".gfx-wrap") || {}).outerHTML?.slice(0, 800) || "(none)",
    };
  });
  console.log("inspect:", JSON.stringify(inspect, null, 2));

  await page.screenshot({ path: OUT + "/grocery-02-reply.png" });
  console.log("screenshot saved:", OUT + "/grocery-02-reply.png");

  if (errs.length) console.log("page errors:", errs.join("\n"));
  await browser.close();
})().catch(e => { console.error("HARNESS FAIL:", e); process.exit(1); });