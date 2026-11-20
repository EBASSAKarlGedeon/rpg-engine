const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
(async () => {
  const kv = new Map();
  const put = (folder, key, val) => kv.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  const s = makeSession();
  s.character.stats = { grit: 8, wit: 9 };
  s.character.actions = [];
  put("worlds", "wstress", makeWorld());
  put("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
  put("rpg", "sessions", [{ id: s.id, name: s.name, charName: "Wren", worldId: "wstress", worldName: "Stress Test Valley", turn: 11, lastUpdated: 1700000000000, avatar: "", portraitSig: "" }]);
  put("rpg", "session_" + s.id, s);
  put("rpg", "activeSession", s.id);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on("pageerror", e => console.log("PAGEERROR", e.message.slice(0, 200)));
  page.on("console", m => { if (m.type() === "error") console.log("CONSOLE-ERR", m.text().slice(0, 150)); });
  await page.route("**/api/rpg-engine-kv/**", async (r) => {
    const op = r.request().url().split("/").pop().split("?")[0];
    const body = r.request().postDataJSON() || {};
    if (op === "list") return r.fulfill({ json: { entries: [...kv.keys()].map(n => ({ name: n, mtimeMs: 1700000000000, size: (kv.get(n) || "").length })) } });
    if (op === "get") return r.fulfill({ json: { content: kv.has(body.name) ? kv.get(body.name) : null, mtimeMs: 1700000000000 } });
    if (op === "put") { kv.set(body.name, body.content); return r.fulfill({ json: { mtimeMs: 1700000000000 } }); }
    return r.fulfill({ json: { ok: true } });
  });
  await page.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
  await page.waitForTimeout(20000);
  await page.evaluate(() => { const rail = document.querySelector("#rightRail"); if (rail) rail.classList.remove("collapsed"); const b = document.querySelector('#rightRail .rail-tab[data-sec="character"]'); if (b) b.click(); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('.hero-tabs .seg-btn[data-htab="actions"]'); if (b) b.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => { document.querySelector(".act-add").click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    document.querySelector("#actName").value = "Blink Step";
    document.querySelector("#actIcon").value = "🌫";
    document.querySelector('.act-kindpick .seg-btn[data-kind="active"]').click();
    document.querySelector('.act-delta[data-k="wit"]').value = "2";
    document.querySelector("#actEffect").value = "Short teleport.";
    document.querySelector("#actSave").click();
  });
  await page.waitForTimeout(900);
  const d1 = await page.evaluate(() => ({
    cards: [...document.querySelectorAll(".act-card")].map(c => c.textContent.replace(/\s+/g, " ").trim().slice(0, 100)),
    rows: [...document.querySelectorAll(".statrow")].map(r => r.textContent.replace(/\s+/g, " ").trim()),
    toggles: document.querySelectorAll(".act-card .act-toggle").length
  }));
  console.log("AFTER ADD:", JSON.stringify(d1, null, 1));
  await page.evaluate(() => { document.querySelector(".act-card .act-toggle").click(); });
  await page.waitForTimeout(900);
  const d2 = await page.evaluate(() => ({
    rows: [...document.querySelectorAll(".statrow")].map(r => r.textContent.replace(/\s+/g, " ").trim()),
    cards: [...document.querySelectorAll(".act-card")].map(c => c.textContent.replace(/\s+/g, " ").trim().slice(0, 100))
  }));
  console.log("AFTER TOGGLE:", JSON.stringify(d2, null, 1));
  await browser.close();
})().catch(e => { console.error("ERR", e); process.exit(1); });
