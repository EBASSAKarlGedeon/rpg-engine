// Hero tab-switch verification — seeded kv stub, no real-server writes.
const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
(async () => {
  const kv = new Map();
  const put = (folder, key, val) => kv.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  const s = makeSession();
  put("worlds", "wstress", makeWorld());
  put("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
  put("rpg", "sessions", [{ id: s.id, name: s.name, charName: "Wren", worldId: "wstress", worldName: "Stress Test Valley", turn: 11, lastUpdated: 1700000000000, avatar: "", portraitSig: "" }]);
  put("rpg", "session_" + s.id, s);
  put("rpg", "activeSession", s.id);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
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
  // close the menu drawer if it opened, so the right rail is clear
  await page.evaluate(() => { const x = document.querySelector(".drawer-close, #menuClose, .menu-head .popup-x"); if (x) x.click(); });
  await page.waitForTimeout(800);
  // open the HERO (character) rail section — force the drawer open, then pick the section
  await page.evaluate(() => {
    const rail = document.querySelector("#rightRail");
    if (rail) rail.classList.remove("collapsed");
    const scrim = document.querySelector("#railScrim"); if (scrim) scrim.classList.add("show");
    const b = document.querySelector('#rightRail .rail-tab[data-sec="character"]'); if (b) b.click();
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/ht10-fixed-initial.png" });
  const snap = () => page.evaluate(() => ({
    tabs: [...document.querySelectorAll(".hero-tabs .seg-btn")].map(b => ({ t: b.textContent.trim(), on: b.classList.contains("on") })),
    bodies: [...document.querySelectorAll(".hero-tab-body")].map(b => ({ tab: b.dataset.tab, hidden: b.hidden, display: getComputedStyle(b).display }))
  }));
  const before = await snap();
  console.log("INITIAL:", JSON.stringify(before));
  await page.evaluate(() => { const b = document.querySelector('.hero-tabs .seg-btn[data-htab="bio"]'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/ht11-fixed-profile.png" });
  console.log("AFTER PROFILE CLICK:", JSON.stringify(await snap()));
  await page.evaluate(() => { const b = document.querySelector('.hero-tabs .seg-btn[data-htab="stats"]'); if (b) b.click(); });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/ht12-fixed-stats.png" });
  console.log("AFTER STATS CLICK:", JSON.stringify(await snap()));
  await browser.close();
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
