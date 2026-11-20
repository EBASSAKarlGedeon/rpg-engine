const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
(async () => {
  const kv = new Map();
  const put = (folder, key, val) => kv.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  const s = makeSession();
  s.messages.push({ role: "narrator", text: "TESTMSG-A plain baseline message visible?" });
  s.messages.push({ role: "narrator", text: "GFX test\n\n<!-- GFX_START -->\n<div class=\"gfx-terminal\">HELLO_TERMINAL_XYZ</div>\n<!-- GFX_END -->\n\n![img1](/user/images/Test/a.png)" });
  put("worlds", "wstress", makeWorld());
  put("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
  put("rpg", "sessions", [{ id: s.id, name: s.name, charName: "Wren", worldId: "wstress", worldName: "Stress Test Valley", turn: 11, lastUpdated: 1700000000000, avatar: "", portraitSig: "" }]);
  put("rpg", "session_" + s.id, s);
  put("rpg", "activeSession", s.id);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE-ERR:", m.text().slice(0,150)); });
  page.on("pageerror", (e) => console.log("PAGEERR:", e.message.slice(0,150)));
  await page.route("**/api/rpg-engine-kv/**", async (r) => {
    const op = r.request().url().split("/").pop().split("?")[0];
    const body = r.request().postDataJSON() || {};
    if (op === "list") return r.fulfill({ json: { entries: [...kv.keys()].map(n => ({ name: n, mtimeMs: 1700000000000, size: (kv.get(n) || "").length })) } });
    if (op === "get") return r.fulfill({ json: { content: kv.has(body.name) ? kv.get(body.name) : null, mtimeMs: kv.has(body.name) ? 1700000000000 : 0 } });
    if (op === "put") { kv.set(body.name, body.content); return r.fulfill({ json: { mtimeMs: 1700000000000 } }); }
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(20000);
  const info = await page.evaluate(() => ({
    turnCount: document.querySelectorAll(".turn").length,
    bodyTextSample: document.querySelector("#transcriptEl") ? document.querySelector("#transcriptEl").textContent.slice(0, 500) : "(no #transcriptEl)",
    hasA: document.body.textContent.includes("TESTMSG-A"),
    hasGfxText: document.body.textContent.includes("HELLO_TERMINAL_XYZ"),
    gfxWrapCount: document.querySelectorAll(".gfx-wrap").length,
    msgImgCount: document.querySelectorAll(".msg-img").length,
  }));
  console.log(JSON.stringify(info, null, 1));
  await browser.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
