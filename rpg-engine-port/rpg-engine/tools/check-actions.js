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

  // ---- [rpge-patch 025] content-aware AI mock: action-gen calls (marker) get offer arrays,
  // everything else (GM narration / referee / trackers) gets plain prose. Handles both
  // stream:true (SSE) and non-stream (JSON) bodies.
  const OFFERS = [
    { name: "Riverwalk", icon: "🌊", kind: "active", deltas: { str: 2 }, effect: "Walk on water for a few strides when invoked." },
    { name: "Nimble Recovery", icon: "🤸", kind: "passive", deltas: { agi: 2 }, effect: "Land on your feet from any fall." },
    { name: "Gritty Stare", icon: "😠", kind: "active", deltas: { wit: 2 }, effect: "Unnerve one listener with a look." }
  ];
  const aiMock = (route) => {
    let body = {};
    try { body = route.request().postDataJSON() || {}; } catch (_) {}
    let content = "Turn 12: The night passes quietly. Nothing stirs.";
    const lastMsg = body && Array.isArray(body.messages) ? String(body.messages[body.messages.length - 1].content || "") : "";
    if (lastMsg.includes("PROPOSING HERO ACTIONS")) content = JSON.stringify(OFFERS);
    if (body && body.stream) {
      const chunk = JSON.stringify({ choices: [{ delta: { content } }] });
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${chunk}\n\ndata: [DONE]\n\n` });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ choices: [{ message: { content } }] }) });
  };

  console.log("4) auto-invoke via composer (player's own words toggle active actions)");
  await page.route("**/api/backends/chat-completions/**", aiMock);
  const charNow = () => { try { return JSON.parse(kv.get(b64url("rpg\u0000session_" + s.id) + ".json")).character; } catch { return null; } };
  const actState = (name) => { const c = charNow(); const a = c && (c.actions || []).find((x) => x.name === name); return a ? a.active : null; };
  const composerSend = async (text, waitMs) => {
    await page.evaluate((t) => { const el = document.querySelector("#inputEl"); el.value = t; }, text);
    await page.evaluate(() => { document.querySelector("#sendBtn").click(); });
    await page.waitForTimeout(waitMs || 9000);
  };
  // Section 2 left Blink Step (active kind) toggled ON.
  ok(actState("Blink Step") === true, "Blink Step starts this section ON (from the manual toggle)");
  await composerSend("I stop using Blink Step and rest by the fire.");
  ok(actState("Blink Step") === false, "dismissal in the player's own text switched it OFF");
  await composerSend("I invoke Blink Step and dart across the courtyard.");
  ok(actState("Blink Step") === true, "invocation in the player's own text switched it ON (no confirm card)");
  await composerSend("Blink Step saved me last week, I remember.");
  ok(actState("Blink Step") === true, "bare mention without an invocation cue leaves the state untouched");

  console.log("5) Forge Your Hero — Actions step (generator + manual add)");
  // Fresh browser context: no active session → landing → Begin → world picker → wizard.
  const kv2 = new Map();
  const put2 = (folder, key, val) => kv2.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  put2("worlds", "wstress", makeWorld());
  put2("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => { if (!/^offline$/.test(e.message)) problems.push("wizard pageerror: " + e.message.slice(0, 160)); });
  await p2.route("**/api/rpg-engine-kv/**", async (r) => {
    const op = r.request().url().split("/").pop().split("?")[0];
    const body = r.request().postDataJSON() || {};
    if (op === "list") return r.fulfill({ json: { entries: [...kv2.keys()].map(n => ({ name: n, mtimeMs: 1700000000000, size: (kv2.get(n) || "").length })) } });
    if (op === "get") return r.fulfill({ json: { content: kv2.has(body.name) ? kv2.get(body.name) : null, mtimeMs: kv2.has(body.name) ? 1700000000000 : 0 } });
    if (op === "put") { kv2.set(body.name, body.content); return r.fulfill({ json: { mtimeMs: 1700000000000 } }); }
    if (op === "delete") { kv2.set(body.name.replace(/\.json$/, "") + ".tomb.json", JSON.stringify({ deletedAt: 1700000000000 })); kv2.delete(body.name); return r.fulfill({ json: { ok: true } }); }
    return r.fulfill({ json: { ok: true } });
  });
  await p2.route("**/api/backends/chat-completions/**", aiMock);
  await p2.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
  await p2.waitForTimeout(15000);
  put2("worlds", "wstress", makeWorld());
  put2("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
  await p2.reload({ waitUntil: "load" });
  await p2.waitForTimeout(15000);
  await p2.evaluate(() => { document.querySelector(".hm-act-primary").click(); });
  await p2.waitForTimeout(2500);
  // 2+ worlds installed (bundled + ours) → the world picker opens; pick Stress Test Valley.
  const picked = await p2.evaluate(() => {
    const cards = [...document.querySelectorAll(".wp-card")];
    const mine = cards.find((c) => c.textContent.includes("Stress Test Valley"));
    if (mine) { mine.click(); return true; }
    return !!document.querySelector(".cc-overlay");
  });
  ok(picked, "world picker resolved (or wizard opened directly)");
  await p2.waitForTimeout(2500);
  ok(await p2.evaluate(() => !!document.querySelector(".cc-wizard")), "Forge Your Hero wizard opened");
  await p2.evaluate(() => { const t = [...document.querySelectorAll(".cc-wizard .ce-tab")].find((x) => x.dataset.step === "actions"); if (t) t.click(); });
  await p2.waitForTimeout(1200);
  ok(await p2.evaluate(() => !!document.querySelector("#ccActBox .act-add")), "Actions step renders the shared actions component");
  // ✨ Generate → offer cards → Add one, Skip one
  await p2.evaluate(() => { document.querySelector("#ccActBox .act-gen").click(); });
  await p2.waitForTimeout(400);
  await p2.evaluate(() => { document.querySelector("#ccActBox .act-genrun").click(); });
  await p2.waitForFunction(() => document.querySelectorAll("#ccActBox .act-offer").length > 0, undefined, { timeout: 20000 });
  const offerCount = await p2.evaluate(() => document.querySelectorAll("#ccActBox .act-offer").length);
  ok(offerCount >= 2, `AI offered ${offerCount} action cards (expect 2–3 after dedupe/caps)`);
  await p2.evaluate(() => { document.querySelector("#ccActBox .act-offer .act-offer-add").click(); });
  await p2.evaluate(() => { const skips = [...document.querySelectorAll("#ccActBox .act-offer-skip")]; skips.forEach((b) => b.click()); });
  await p2.waitForTimeout(600);
  const wizActs = await p2.evaluate(() => [...document.querySelectorAll("#ccActBox .act-card .act-name")].map((n) => n.textContent.trim()));
  ok(wizActs.some((t) => t.includes("Riverwalk")), "accepted offer became an action card");
  ok(wizActs.length === 1, "skipped offers did not land");
  const wizKv = () => { try { return JSON.parse(kv2.get(b64url("rpg\u0000sessions") + ".json")); } catch { return null; } };
  ok(Array.isArray(wizKv()) && wizKv().length === 1, "wizard action edits persist to the session save");
  // Manual add through the same editor
  await p2.evaluate(() => { document.querySelector("#ccActBox .act-add").click(); });
  await p2.waitForTimeout(500);
  await p2.evaluate(() => {
    document.querySelector("#ccActBox #actName").value = "Nightwatch";
    document.querySelector("#ccActBox #actIcon").value = "🌙";
    document.querySelector("#ccActBox #actSave").click();
  });
  await p2.waitForTimeout(600);
  const wizActs2 = await p2.evaluate(() => [...document.querySelectorAll("#ccActBox .act-card .act-name")].map((n) => n.textContent.trim()));
  ok(wizActs2.some((t) => t.includes("Nightwatch")), "manual editor add works in the wizard");
  await p2.screenshot({ path: SHOT + "a05-wizard-actions.png" });
  // Review step lists the actions, then Begin → opening GM turn (mocked) runs.
  await p2.evaluate(() => { const t = [...document.querySelectorAll(".cc-wizard .ce-tab")].find((x) => x.dataset.step === "review"); if (t) t.click(); });
  await p2.waitForTimeout(1000);
  const revHas = await p2.evaluate(() => !!document.querySelector("#ccReview") && document.querySelector("#ccReview").textContent.includes("Riverwalk"));
  ok(revHas, "review step lists the accepted actions");
  // Begin requires a hero name — fill the Bio name field first, then step forward until the
  // button reads Begin (each click advances ONE step; review is not reachable in one jump).
  await p2.evaluate(() => { const t = [...document.querySelectorAll(".cc-wizard .ce-tab")].find((x) => x.dataset.step === "bio"); if (t) t.click(); });
  await p2.waitForTimeout(600);
  await p2.evaluate(() => { const n = document.querySelector("#cc_name"); if (n) n.value = "Wren"; });
  for (let i = 0; i < 8; i++) {
    const label = await p2.evaluate(() => { const b = document.querySelector(".cc-next"); return b ? b.textContent : ""; });
    if (/Begin/.test(label)) break;
    await p2.evaluate(() => document.querySelector(".cc-next").click());
    await p2.waitForTimeout(500);
  }
  await p2.evaluate(() => document.querySelector(".cc-next").click()); // Begin Adventure
  await p2.waitForTimeout(12000);
  const opened = await p2.evaluate(() => (document.getElementById("transcriptEl") || { children: [] }).children.length > 0);
  ok(opened, "adventure began and the opening turn rendered");
  const finalChar = () => { try { const sess = kv2.get(b64url("rpg\u0000sessions") + ".json"); const id = JSON.parse(sess)[0].id; return JSON.parse(kv2.get(b64url("rpg\u0000session_" + id) + ".json")).character; } catch { return null; } };
  const fc = finalChar();
  ok(fc && (fc.actions || []).some((a) => a.name === "Riverwalk" && a.source === "hero"), "hero's accepted actions survived Begin (source=hero)");
  await ctx2.close();

  console.log(problems.length ? "PROBLEMS: " + problems.join(" | ") : "ACTIONS OK");
  await browser.close();
  if (problems.length) process.exit(1);
})().catch(e => { console.error("ERR", e); process.exit(1); });
