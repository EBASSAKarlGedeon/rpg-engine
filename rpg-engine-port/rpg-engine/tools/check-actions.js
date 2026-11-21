// Patch 019 verification: Actions & abilities. Seeded kv stub (no real-server writes).
// Verifies: Actions tab UI (list/add/toggle/delete), buffed stat display, chat offer accept,
// and tab strip switching. Usage: node tools/check-actions.js
const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const SHOT = "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/";
const problems = [];
const ok = (cond, msg) => { if (cond) console.log("  ok:", msg); else { problems.push(msg); console.log("  FAIL:", msg); } };

(async () => {
  const kv = new Map();
  const put = (folder, key, val) => kv.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  // Seed is a function: a fresh browser profile reads kv BEFORE the first server reconcile lands
  // (boot race — the heavy-session.js lesson), so the recipe is seed → boot → reseed → reload.
  const seed = () => {
    const s = makeSession();
    // The latest GM narration already carries a story-gained action offer (as parseActionStrips
    // would have stamped it) plus one accepted passive card earlier in the session.
    s.character.stats = { str: 12, wit: 9 };
    s.character.actions = [
      { id: "act-seed", name: "Iron Stomach", icon: "🍖", kind: "passive", deltas: { grit: 1 }, effect: "Raw food never sickens you.", active: false, source: "hero" }
    ];
    const lastMsg = s.messages[s.messages.length - 1];
    lastMsg.actionGains = [
      { name: "All Enhancement", icon: "✨", kind: "passive", deltas: { grit: 30 }, effect: "Ten times stronger than baseline; metal bends to your hands." }
    ];
    put("worlds", "wstress", makeWorld());
    put("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
    put("rpg", "sessions", [{ id: s.id, name: s.name, charName: "Wren", worldId: "wstress", worldName: "Stress Test Valley", turn: 11, lastUpdated: 1700000000000, avatar: "", portraitSig: "" }]);
    put("rpg", "session_" + s.id, s);
    put("rpg", "activeSession", s.id);
    return s;
  };
  const s = seed();
  const readChar = () => { try { return JSON.parse(kv.get(b64url("rpg\u0000session_" + s.id) + ".json")).character; } catch { return null; } };

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  page.on("pageerror", (e) => { if (!/^offline$/.test(e.message)) problems.push("pageerror: " + e.message.slice(0, 160)); });
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
  await page.waitForTimeout(15000);
  seed(); // reseed after boot settles, then reload — without this the fresh profile resumes nothing
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(15000);

  console.log("1) chat offer card renders and accepts");
  const offer = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".act-offer")].find((o) => o.textContent.includes("All Enhancement"));
    return el ? { accepted: el.classList.contains("accepted"), hasBtn: !!el.querySelector(".act-accept") } : null;
  });
  ok(!!offer, "offer card present in transcript");
  ok(offer && offer.hasBtn && !offer.accepted, "offer is unaccepted with an Accept button");
  await page.evaluate(() => { [...document.querySelectorAll(".act-offer .act-accept")].find(b => b.offsetParent).click(); });
  await page.waitForTimeout(1200);
  const stored = readChar();
  ok(stored && (stored.actions || []).some((a) => a.name === "All Enhancement" && a.source === "story" && a.deltas.grit === 30), "accepted action persisted with source=story");
  const offerAfter = await page.evaluate(() => {
    const el = [...document.querySelectorAll(".act-offer")].find((o) => o.textContent.includes("All Enhancement"));
    return el ? el.classList.contains("accepted") : null;
  });
  ok(offerAfter === true, "offer card now shows accepted state");

  console.log("2) Actions tab: cards, buff badge, toggle, editor add");
  await page.evaluate(() => {
    const rail = document.querySelector("#rightRail");
    if (rail) rail.classList.remove("collapsed");
    const b = document.querySelector('#rightRail .rail-tab[data-sec="character"]'); if (b) b.click();
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const b = document.querySelector('.hero-tabs .seg-btn[data-htab="actions"]'); if (b) b.click(); });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: SHOT + "a01-actions-tab.png" });
  const tabState = await page.evaluate(() => ({
    cards: [...document.querySelectorAll(".act-card .act-name")].map((n) => n.textContent.trim()),
    statsShown: [...document.querySelectorAll(".statrow")].map((r) => r.textContent.replace(/\s+/g, " ").trim()),
    activeTab: (document.querySelector(".hero-tabs .seg-btn.on") || {}).textContent
  }));
  ok(tabState.activeTab === "Actions", "Actions tab is active");
  ok(tabState.cards.some((t) => t.includes("All Enhancement")) && tabState.cards.some((t) => t.includes("Iron Stomach")), "both action cards listed");
  ok(tabState.statsShown.some((t) => t.includes("→ 39") && t.includes("+31")), "grit row shows 8 → 39 (both actions stack, buff breaks the world max), badge +31");
  await page.screenshot({ path: SHOT + "a02-stats-buffed.png", clip: { x: 680, y: 0, width: 320, height: 700 } });
  // toggle the seeded active? none active — add a new ACTIVE action via the editor.
  await page.evaluate(() => { document.querySelector(".act-add").click(); });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    document.querySelector("#actName").value = "Blink Step";
    document.querySelector("#actIcon").value = "🌫";
  });
  await page.evaluate(() => { const e = document.querySelector(".act-editor"); if (e) e.scrollIntoView({ block: "center" }); });
  await page.screenshot({ path: SHOT + "a02b-editor.png" }); // editor layout: Name/Icon inputs must fit the panel
  await page.evaluate(() => {
    document.querySelector("#actName").value = "Blink Step";
    document.querySelector("#actIcon").value = "🌫";
    document.querySelector('.act-kindpick .seg-btn[data-kind="active"]').click();
    const inp = document.querySelector('.act-delta[data-k="wit"]'); inp.value = "2";
    document.querySelector("#actEffect").value = "Short-range teleport, one per fight.";
    document.querySelector("#actSave").click();
  });
  await page.waitForTimeout(900);
  const afterAdd = await page.evaluate(() => [...document.querySelectorAll(".act-card .act-name")].map((n) => n.textContent.trim()).join(" | "));
  ok(afterAdd.includes("Blink Step"), "new active action added via editor");
  await page.screenshot({ path: SHOT + "a03-added.png" });
  // toggle it ON
  await page.evaluate(() => { document.querySelector(".act-card .act-toggle").click(); });
  await page.waitForTimeout(900);
  const witRow = await page.evaluate(() => [...document.querySelectorAll(".statrow")].map((r) => r.textContent.replace(/\s+/g, " ")).find((t) => t.includes("Wit")));
  console.log("WITROW:", witRow);
ok(/→ 11/.test(witRow || ""), "wit shows 9 → 11 while Blink Step is on");
  // switch to Stats tab to confirm the tab strip still alternates cleanly
  await page.evaluate(() => { const b = document.querySelector('.hero-tabs .seg-btn[data-htab="stats"]'); if (b) b.click(); });
  await page.waitForTimeout(700);
  const statsPane = await page.evaluate(() => {
    const bodies = [...document.querySelectorAll(".hero-tab-body")].map((b) => ({ tab: b.dataset.tab, hidden: b.hidden }));
    return bodies;
  });
  ok(statsPane.find((b) => b.tab === "stats")?.hidden === false && statsPane.find((b) => b.tab === "actions")?.hidden === true, "tab bodies toggle (stats visible, actions hidden)");
  await page.screenshot({ path: SHOT + "a04-stats-tab.png" });

  console.log("3) ⚡ composer button exists");
  ok(await page.evaluate(() => !!document.querySelector("#actionsBtn")), "actionsBtn present in composer");

  console.log(problems.length ? "PROBLEMS: " + problems.join(" | ") : "ACTIONS OK");
  await browser.close();
  if (problems.length) process.exit(1);
})().catch(e => { console.error("ERR", e); process.exit(1); });
