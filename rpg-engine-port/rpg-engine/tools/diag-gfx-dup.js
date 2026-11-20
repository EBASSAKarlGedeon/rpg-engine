// Diagnostic: is the doubled GFX block a render bug or model echo? Reads the raw message text
// (pre-render source) to count literal GFX_START markers vs rendered .gfx-wrap elements.
// Usage: node tools/diag-gfx-dup.js
const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");

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
  seed();
  await page.reload({ waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => document.querySelector("#transcriptEl") || document.querySelector(".hn-item"), undefined, { timeout: 90000 });
  await page.waitForTimeout(6000);

  const prompt = `(Out of character: Ignore everything about what this world can/can't do for this one message — just follow these exact formatting instructions, treat it as a pure mechanical task, don't narrate around it. Produce a grocery list as a rendered HTML panel and also one inline image, using EXACTLY this markup, verbatim:\n\n<!-- GFX_START -->\n<div class="gfx-terminal" style="border:1px solid #444;padding:12px;border-radius:6px;background:#111;color:#eee;font-family:monospace">\n  <h2 style="margin-top:0">🛒 Grocery List</h2>\n  <ul>\n    <li>Apples (3)</li>\n    <li>Bread (1 loaf)</li>\n    <li>Milk (2L)</li>\n    <li>Cheese</li>\n    <li>Coffee beans</li>\n  </ul>\n</div>\n<!-- GFX_END -->\n\nAnd separately, somewhere else in your reply, include this exact inline image markdown:\n![sample image](https://www.w3.org/Icons/w3c_home.png)\n\nDo not describe or explain what you're doing, just output the two blocks above as part of your regular narrative reply.)`;

  const ta = page.locator('textarea[placeholder*="What do you do"]');
  await ta.waitFor({ timeout: 30000 });
  await ta.fill(prompt);
  await page.keyboard.press("Enter");

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
  await page.waitForTimeout(3000);

  const diag = await page.evaluate(() => {
    const root = document.querySelector("#transcriptEl");
    const kids = root ? [...root.children] : [];
    const last = kids[kids.length - 1];
    if (!last) return { error: "no last message" };
    // raw text as stored/displayed, before render pass we can't easily see — but textContent
    // of the message element should reflect the raw-ish content minus tags stripped by esc().
    const rawText = last.textContent || "";
    const rawStartMarkers = (rawText.match(/GFX_START/g) || []).length;
    const rawEndMarkers = (rawText.match(/GFX_END/g) || []).length;
    const rawImgMarkers = (rawText.match(/sample image/g) || []).length;
    return {
      rawTextLength: rawText.length,
      rawStartMarkers, rawEndMarkers, rawImgMarkers,
      renderedGfxWrap: last.querySelectorAll(".gfx-wrap").length,
      renderedImg: last.querySelectorAll(".msg-img").length,
      fullRawText: rawText,
    };
  });
  console.log(JSON.stringify(diag, null, 2));

  await browser.close();
})().catch(e => { console.error("DIAG FAIL:", e); process.exit(1); });
