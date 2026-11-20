// Grocery HTML test (v2): explicit OOC message spelling out the exact GFX markup syntax, since
// the narrator prompt doesn't yet advertise the capability (that's patch 023's job). This test
// proves the RENDER pipeline (patch 020) works end-to-end on a real AI reply when the model
// emits the markup — not that the model knows to do so unprompted.
// Usage: node tools/grocery-html2.js
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

  // Precise OOC instruction: exact literal markup, no need for the model to "know" the protocol.
  const prompt = `(Out of character: Ignore everything about what this world can/can't do for this one message — just follow these exact formatting instructions, treat it as a pure mechanical task, don't narrate around it. Produce a grocery list as a rendered HTML panel and also one inline image, using EXACTLY this markup, verbatim:\n\n<!-- GFX_START -->\n<div class="gfx-terminal" style="border:1px solid #444;padding:12px;border-radius:6px;background:#111;color:#eee;font-family:monospace">\n  <h2 style="margin-top:0">🛒 Grocery List</h2>\n  <ul>\n    <li>Apples (3)</li>\n    <li>Bread (1 loaf)</li>\n    <li>Milk (2L)</li>\n    <li>Cheese</li>\n    <li>Coffee beans</li>\n  </ul>\n</div>\n<!-- GFX_END -->\n\nAnd separately, somewhere else in your reply, include this exact inline image markdown:\n![sample image](https://www.w3.org/Icons/w3c_home.png)\n\nDo not describe or explain what you're doing, just output the two blocks above as part of your regular narrative reply.)`;

  const ta = page.locator('textarea[placeholder*="What do you do"]');
  await ta.waitFor({ timeout: 30000 });
  await ta.fill(prompt);
  await page.keyboard.press("Enter");
  console.log("sent — waiting for AI reply...");

  await page.waitForFunction(() => {
    const b = document.querySelector("#sendBtn");
    return b && b.textContent.trim() === "➤";
  }, undefined, { timeout: 300000 });
  let last = -1, stable = 0, msgs = -1;
  while (stable < 2) {
    await page.waitForTimeout(4000);
    msgs = await page.evaluate(() => document.querySelectorAll("#transcriptEl > *").length).catch(() => -1);
    if (msgs === last) stable++; else { stable = 0; last = msgs; }
  }
  await page.waitForTimeout(3000); // let images/GFX finish hydrating

  const inspect = await page.evaluate(() => {
    const root = document.querySelector("#transcriptEl");
    const kids = root ? [...root.children] : [];
    const last = kids[kids.length - 1];
    if (!last) return { msgCount: 0, error: "no messages found" };
    return {
      msgCount: kids.length,
      lastTextSample: (last.textContent || "").slice(0, 400),
      // Scope to the LAST message only — the document-wide count earlier picked up stray
      // .gfx-wrap references elsewhere (e.g. templates/composer hints), inflating to 2.
      lastMsgGfxBlocks: last.querySelectorAll(".gfx-wrap").length,
      lastMsgGfxTerminal: last.querySelectorAll(".gfx-terminal").length,
      docWideGfxBlocks: document.querySelectorAll(".gfx-wrap").length,
      inlineImgs: [...last.querySelectorAll(".msg-img")].map(i => ({ src: i.src, complete: i.complete, w: i.naturalWidth, h: i.naturalHeight })),
      badImgs: last.querySelectorAll(".msg-img-bad").length,
      gfxHtml: (last.querySelector(".gfx-wrap") || {}).outerHTML?.slice(0, 1000) || "(none)",
    };
  });
  console.log("inspect:", JSON.stringify(inspect, null, 2));

  await page.screenshot({ path: OUT + "/grocery2-01-reply.png" });
  console.log("screenshot saved:", OUT + "/grocery2-01-reply.png");

  // Scroll the GFX/image into view for a second focused shot.
  await page.evaluate(() => {
    const el = document.querySelector(".gfx-wrap") || document.querySelector(".msg-img");
    if (el) el.scrollIntoView({ block: "center" });
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: OUT + "/grocery2-02-focused.png" });
  console.log("focused screenshot saved:", OUT + "/grocery2-02-focused.png");

  if (errs.length) console.log("page errors:", errs.join("\n"));
  await browser.close();
})().catch(e => { console.error("HARNESS FAIL:", e); process.exit(1); });
