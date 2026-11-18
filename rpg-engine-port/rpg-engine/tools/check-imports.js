// Verifies the "Import from Loreweaver" page (linked snapshots):
//   personas -> game hero library, character cards -> world NPCs, World Info -> world lorebook:
//   - personas are listed from /api/settings/get (power_user.personas + persona_descriptions),
//   - Import writes a proper hero record into kv.rpg.savedHeroes (name/persona/portrait/lwSource),
//   - re-import does not duplicate (updates the linked hero),
//   - a changed source description is detected and the Update overwrites only imported fields,
//   - character cards land as world NPCs (persona/extra/avatar + lwImports registry),
//   - "Add as world" turns a card into a NEW game world (rules -> always-on law entry,
//     embedded character_book -> character entries, world index + registry updated),
//   - World Info books land as lorebook entries (keywords merged, constant -> always, disabled skipped).
//   node tools/check-imports.js
// (starts a combined static + mock-Loreweaver server on 8768 — same origin, like production)
const { chromium } = require("playwright");
const http = require("http");
const path = require("path");

const APP_ROOT = path.join(__dirname, ".."); // rpg-engine root: serves app/ and tools/
const PORT = 8768;
const problems = [];

// ---- mock Loreweaver backend ----
// power_user state that /api/settings/get would return; /__mock/setdesc simulates the persona
// being edited on the Loreweaver side.
const powerUser = {
  personas: { "p1.png": "Ashrith", "p2.png": "Mira the Quiet" },
  persona_descriptions: {
    "p1.png": { description: "A storm-born wanderer with a silver tongue. Speaks in proverbs.", title: "Stormwanderer" },
    "p2.png": { description: "Small, patient, deadly with a needle. Never raises her voice.", title: "Seamstress" },
  },
  default_persona: "p1.png",
};
// 1x1 transparent PNG served as the persona avatar
const AVATAR_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const sessions = new Set();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const srv = http.createServer((req, res) => {
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((c) => {
    const i = c.indexOf("="); return [c.slice(0, i).trim(), c.slice(i + 1)];
  }));
  const url = new URL(req.url, "http://x");
  const readBody = (cb) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => cb(b ? JSON.parse(b) : {})); };
  const json = (o) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(o)); };

  if (url.pathname === "/csrf-token") {
    const sid = cookies.sid || ("S" + Math.random().toString(36).slice(2));
    sessions.add(sid);
    res.setHeader("Set-Cookie", "sid=" + sid + "; Path=/");
    return json({ token: "csrf-" + sid });
  }

  if (url.pathname === "/api/settings/get" && req.method === "POST") {
    const sid = cookies.sid, token = req.headers["x-csrf-token"];
    if (!sid || !sessions.has(sid) || token !== "csrf-" + sid) { res.writeHead(403); return res.end(); }
    return json({ settings: JSON.stringify({ power_user: powerUser }), openai_setting_names: [], openai_settings: [] });
  }

  if (url.pathname === "/User%20Avatars/p1.png" || url.pathname === "/User%20Avatars/p2.png") {
    res.writeHead(200, { "Content-Type": "image/png" });
    return res.end(AVATAR_PNG);
  }

  // test-only: persona edited on the Loreweaver side
  if (url.pathname === "/__mock/setdesc" && req.method === "POST") {
    return readBody((body) => {
      powerUser.persona_descriptions[body.id].description = body.description;
      return json({ ok: true });
    });
  }

  // ---- characters + World Info mocks ----
  const cards = [
    { name: "Kael", avatar: "kael.png", description: "A grim mercenary.", personality: "Cold, loyal.", scenario: "He owes you a debt." },
    { name: "Rulesville", avatar: "rules.png", description: "<SYSTEM DIRECTIVE: RULES ENGINE> Be fair.", personality: "", scenario: "The town has secrets.",
      data: { character_book: { entries: [
        { keys: ["Anna"], secondary_keys: [], comment: "Anna", content: "Anna runs the inn.", constant: false, enabled: true },
        { keys: [], secondary_keys: [], comment: "Town charter", content: "The charter is always in force.", constant: true, enabled: true },
        { keys: ["gone"], comment: "gone", content: "Disabled entry.", enabled: false },
      ] } } },
    { name: "Vex", avatar: "vex.png", description: "A sly fixer.", personality: "Charming.", scenario: "She knows everyone." },
  ];
  if (url.pathname === "/api/characters/all" && req.method === "POST") {
    const sid = cookies.sid, token = req.headers["x-csrf-token"];
    if (!sid || !sessions.has(sid) || token !== "csrf-" + sid) { res.writeHead(403); return res.end(); }
    return json(cards);
  }
  if (url.pathname === "/api/characters/get" && req.method === "POST") {
    const sid = cookies.sid, token = req.headers["x-csrf-token"];
    if (!sid || !sessions.has(sid) || token !== "csrf-" + sid) { res.writeHead(403); return res.end(); }
    return readBody((body) => {
      const c = cards.find((x) => x.avatar === body.avatar_url);
      return c ? json(Object.assign({ first_mes: "Hi.", creator_notes: "n/a" }, c)) : (res.writeHead(404), res.end());
    });
  }
  if (url.pathname === "/thumbnail" && url.searchParams.get("type") === "avatar") {
    res.writeHead(200, { "Content-Type": "image/png" });
    return res.end(AVATAR_PNG);
  }
  const wiBooks = { b1: { name: "Eldoria", entries: {
    "0": { key: ["eldoria", "wood"], keysecondary: ["forest"], content: "Eldoria is an old wood.", comment: "eldoria", constant: false, disable: false },
    "1": { key: [], content: "The crown always watches.", comment: "crown", constant: true, disable: false },
    "2": { key: ["never"], content: "Disabled entry.", comment: "gone", constant: false, disable: true },
    "3": { key: ["x"], content: "", comment: "empty", constant: false, disable: false },
  } } };
  if (url.pathname === "/api/worldinfo/list" && req.method === "POST") {
    const sid = cookies.sid, token = req.headers["x-csrf-token"];
    if (!sid || !sessions.has(sid) || token !== "csrf-" + sid) { res.writeHead(403); return res.end(); }
    return json(Object.keys(wiBooks).map((id) => ({ file_id: id, name: wiBooks[id].name })));
  }
  if (url.pathname === "/api/worldinfo/get" && req.method === "POST") {
    const sid = cookies.sid, token = req.headers["x-csrf-token"];
    if (!sid || !sessions.has(sid) || token !== "csrf-" + sid) { res.writeHead(403); return res.end(); }
    return readBody((body) => (wiBooks[body.name] ? json(wiBooks[body.name]) : (res.writeHead(404), res.end())));
  }

  const p = path.join(APP_ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(APP_ROOT)) { res.writeHead(403); return res.end(); }
  require("fs").readFile(p, (err, d) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  });
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => srv.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (/rpge|import/i.test(m.text())) console.log("[page]", m.text().slice(0, 200)); });
  await page.route("**/*", (r) => (/^http:\/\/127\.0\.0\.1/.test(r.request().url()) ? r.continue() : r.abort()));
  const url = `http://127.0.0.1:${PORT}/app/loreweaver-import.html`;
  const heroes = () => page.evaluate(async () => (await window.root.kv.rpg.get("savedHeroes")) || []);

  await page.goto(url);
  await page.waitForSelector(".prow", { timeout: 8000 });
  const rows = await page.$$eval(".prow", (rs) => rs.map((r) => ({
    name: r.querySelector(".pname").textContent,
    badge: !!r.querySelector(".pbadge"),
    status: r.querySelector(".pstatus").textContent,
    btn: r.querySelector("button").textContent,
  })));
  if (rows.length !== 2) problems.push("expected 2 persona rows, got " + rows.length);
  if (!rows[0] || rows[0].name !== "Ashrith") problems.push("persona row order/name wrong: " + JSON.stringify(rows.map(r => r.name)));
  if (!rows[0] || !rows[0].badge) problems.push("default persona badge missing on Ashrith");
  if (!rows[0] || !/not imported/.test(rows[0].status) || !/Import as hero/.test(rows[0].btn)) problems.push("pre-import status wrong: " + JSON.stringify(rows[0]));

  // ---- import the default persona ----
  await page.click(".prow button");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Imported"), { timeout: 8000 });
  let list = await heroes();
  if (list.length !== 1) problems.push("after import expected 1 hero, got " + list.length);
  const h = list[0];
  if (!h || h.name !== "Ashrith" || h.label !== "Ashrith") problems.push("hero name/label wrong: " + JSON.stringify(h));
  if (!h || h.persona !== powerUser.persona_descriptions["p1.png"].description) problems.push("hero.persona != description");
  if (!h || !/^data:image\/(png|jpeg);base64,/.test(h.portrait || "")) problems.push("portrait is not a dataURL: " + (h && h.portrait || "").slice(0, 40));
  if (!h || !h.lwSource || h.lwSource.type !== "persona" || h.lwSource.id !== "p1.png" || !h.lwSource.descHash) problems.push("lwSource missing/wrong: " + JSON.stringify(h && h.lwSource));
  if (!h || typeof h.savedAt !== "number") problems.push("savedAt missing");

  // ---- re-import: update, no duplicate; non-imported fields preserved ----
  await page.evaluate(async () => {
    const l = await window.root.kv.rpg.get("savedHeroes");
    l[0].race = "stormborn"; // a field the user would fill in the game
    await window.root.kv.rpg.set("savedHeroes", l);
  });
  await page.waitForFunction(() => /up to date/.test(document.querySelector(".prow .pstatus").textContent), { timeout: 8000 });
  await page.click(".prow button");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Updated"), { timeout: 8000 });
  list = await heroes();
  if (list.length !== 1) problems.push("re-import duplicated the hero (got " + list.length + ")");
  if (!list[0] || list[0].race !== "stormborn") problems.push("update clobbered a game-side field (race)");
  if (!list[0] || list[0].name !== "Ashrith") problems.push("update lost the name");

  // ---- source changes -> status shows "changed", Update overwrites imported fields only ----
  await page.evaluate(() => fetch("/__mock/setdesc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "p1.png", description: "Rewritten: now a retired pirate captain." }) }));
  await page.reload();
  await page.waitForSelector(".prow", { timeout: 8000 });
  const st = await page.$eval(".prow .pstatus", (e) => e.textContent);
  if (!/source changed/.test(st)) problems.push("changed-source status not shown: " + st);
  const btnTxt = await page.$eval(".prow button", (b) => b.textContent);
  if (!/Update/.test(btnTxt)) problems.push("button should say Update after change, got: " + btnTxt);
  await page.click(".prow button");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Updated"), { timeout: 8000 });
  list = await heroes();
  if (!list[0] || list[0].persona !== "Rewritten: now a retired pirate captain.") problems.push("update did not pull the new description");
  if (!list[0] || list[0].race !== "stormborn") problems.push("update clobbered game-side field after source change (race)");

  // ---- second persona still importable independently ----
  const btns = await page.$$(".prow button");
  await btns[1].click();
  await page.waitForFunction(() => document.querySelectorAll(".prow").length === 2 && document.querySelector("#msg").textContent.includes("Imported"), { timeout: 8000 });
  list = await heroes();
  if (list.length !== 2) problems.push("second import failed (got " + list.length + ")");
  const mira = list.find((x) => x.lwSource && x.lwSource.id === "p2.png");
  if (!mira || mira.name !== "Mira the Quiet") problems.push("second hero wrong: " + JSON.stringify(mira && mira.name));

  // ---- character card -> world NPC ----
  // A game world must exist for the dropdown: seed one in the raw stored file form.
  await page.evaluate(async () => {
    await window.root.kv.worlds.set("w1", { meta: { id: "w1", name: "Test World" }, npcs: [], lorebook: [] });
    const idx = (await window.root.kv.worlds.get("index")) || [];
    if (!idx.some((w) => w.id === "w1")) { idx.push({ id: "w1", name: "Test World" }); await window.root.kv.worlds.set("index", idx); }
  });
  await page.reload();
  await page.waitForSelector("#chars .prow", { timeout: 8000 });
  const selVal = await page.$eval("#targetWorld", (s) => s.value);
  if (selVal !== "w1") problems.push("world dropdown did not select w1: " + selVal);
  const cardRows = await page.$$eval("#chars .prow", (rs) => rs.map((r) => ({ name: r.querySelector(".pname").textContent, btn: r.querySelector("button").textContent, btns: r.querySelectorAll("button").length })));
  if (cardRows.length !== 3 || cardRows[0].name !== "Kael" || !/Add as NPC/.test(cardRows[0].btn)) problems.push("card rows wrong: " + JSON.stringify(cardRows));
  if (cardRows.some((r) => r.btns !== 2)) problems.push("card rows should have 2 buttons (NPC + world): " + JSON.stringify(cardRows));
  await page.click("#chars .prow button");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Added"), { timeout: 8000 });
  let world = await page.evaluate(async () => await window.root.kv.worlds.get("w1"));
  if (!world || !Array.isArray(world.npcs) || world.npcs.length !== 1) problems.push("card import: world.npcs wrong");
  const npc = world && world.npcs && world.npcs[0];
  if (!npc || npc.name !== "Kael" || npc.persona !== "A grim mercenary.\n\nCold, loyal." || npc.extra !== "He owes you a debt.") problems.push("NPC fields wrong: " + JSON.stringify(npc));
  if (!npc || npc.avatar !== "/thumbnail?type=avatar&file=kael.png") problems.push("NPC avatar wrong: " + (npc && npc.avatar));
  let reg = await page.evaluate(async () => await window.root.kv.rpg.get("lwImports"));
  if (!reg || !reg.cards || !reg.cards["kael.png"] || reg.cards["kael.png"].worlds[0].npcName !== "Kael") problems.push("card registry missing: " + JSON.stringify(reg && reg.cards));

  // re-import follows the same link (no duplicate); game-side field survives
  await page.evaluate(async () => {
    const w = await window.root.kv.worlds.get("w1");
    w.npcs[0].race = "greyfolk";
    await window.root.kv.worlds.set("w1", w);
  });
  await page.click("#chars .prow button");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Updated"), { timeout: 8000 });
  world = await page.evaluate(async () => await window.root.kv.worlds.get("w1"));
  if (!world || world.npcs.length !== 1) problems.push("card re-import duplicated the NPC");
  if (!world || !world.npcs[0] || world.npcs[0].race !== "greyfolk") problems.push("card update clobbered a game-side field (race)");

  // ---- card -> standalone world ("Add as world") ----
  // Rulesville row is the 2nd card row (sorted Kael, Rulesville, Vex); its second button.
  await page.click("#chars .prow:nth-of-type(3) button.secondary");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Created world"), { timeout: 8000 });
  const rw = await page.evaluate(async () => await window.root.kv.worlds.get("rulesville"));
  if (!rw || rw.format !== "mno-world" || rw.version !== 1) problems.push("card-world: file form wrong: " + JSON.stringify(rw && { format: rw && rw.format, version: rw && rw.version }));
  if (!rw || !rw.meta || rw.meta.name !== "Rulesville" || rw.meta.id !== "rulesville") problems.push("card-world: meta wrong: " + JSON.stringify(rw && rw.meta));
  if (!rw || !Array.isArray(rw.lorebook) || rw.lorebook.length !== 3) problems.push("card-world: lorebook count wrong: " + (rw && rw.lorebook && rw.lorebook.length));
  const rl = (rw && rw.lorebook) || [];
  if (!rl[0] || rl[0].title !== "Rules" || rl[0].type !== "law" || rl[0].activation !== "always" || rl[0].content !== "<SYSTEM DIRECTIVE: RULES ENGINE> Be fair.\n\nThe town has secrets.") problems.push("card-world: rules entry wrong: " + JSON.stringify(rl[0]));
  if (!rl[1] || rl[1].title !== "Anna" || rl[1].type !== "character" || rl[1].activation !== "keywords" || JSON.stringify(rl[1].keywords) !== JSON.stringify(["Anna"]) || rl[1].content !== "Anna runs the inn.") problems.push("card-world: keyword cast entry wrong: " + JSON.stringify(rl[1]));
  if (!rl[2] || rl[2].title !== "Town charter" || rl[2].activation !== "always" || rl[2].content !== "The charter is always in force.") problems.push("card-world: constant cast entry wrong: " + JSON.stringify(rl[2]));
  if (rw && (rw.npcs.length !== 0 || rw.trackers.length !== 0)) problems.push("card-world: npcs/trackers should be empty");
  if (!rw || !rw.meta || !/^data:image\/(jpeg|png);base64,/.test(rw.meta.cover || "")) problems.push("card-world: cover should be the card image as a dataURL: " + JSON.stringify(rw && rw.meta && String(rw.meta.cover).slice(0, 40)));
  const idx2 = await page.evaluate(async () => await window.root.kv.worlds.get("index"));
  const idxEntry = idx2 && idx2.find((w) => w.id === "rulesville");
  if (!idxEntry || idxEntry.name !== "Rulesville" || !/^data:image\//.test(idxEntry.cover || "")) problems.push("card-world: index entry wrong (missing cover/meta): " + JSON.stringify(idxEntry));
  reg = await page.evaluate(async () => await window.root.kv.rpg.get("lwImports"));
  const rwReg = reg && reg.cards && reg.cards["rules.png"];
  if (!rwReg || !rwReg.worlds[0] || rwReg.worlds[0].worldId !== "rulesville" || rwReg.worlds[0].asWorld !== true || JSON.stringify(rwReg.worlds[0].titles) !== JSON.stringify(["Rules", "Anna", "Town charter"])) problems.push("card-world: registry wrong: " + JSON.stringify(rwReg));
  const selAfter = await page.$eval("#targetWorld", (s) => s.value);
  if (selAfter !== "rulesville") problems.push("card-world: target world did not switch to the new world: " + selAfter);

  // mixed update: with target back on w1, "Add as NPC" adds the NPC there AND refreshes the world import (no dup)
  await page.evaluate(() => localStorage.setItem("rpge.importWorld", "w1"));
  await page.reload();
  await page.waitForSelector("#chars .prow", { timeout: 8000 });
  const selBack = await page.$eval("#targetWorld", (s) => s.value);
  if (selBack !== "w1") problems.push("remembered world selection broken: " + selBack);
  const rvRow = await page.$$eval("#chars .prow", (rs) => rs.findIndex((r) => r.querySelector(".pname").textContent === "Rulesville"));
  if (rvRow < 0) problems.push("Rulesville row missing after reload");
  await page.evaluate((i) => { document.querySelectorAll("#chars .prow")[i].querySelector("button").click(); }, rvRow);
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Added"), { timeout: 8000 });
  world = await page.evaluate(async () => await window.root.kv.worlds.get("w1"));
  if (!world || !world.npcs.some((n) => n && n.name === "Rulesville" && n.persona === "<SYSTEM DIRECTIVE: RULES ENGINE> Be fair.")) problems.push("card-world: NPC not added to w1 on mixed update");
  const rwAfter = await page.evaluate(async () => await window.root.kv.worlds.get("rulesville"));
  if (!rwAfter || rwAfter.lorebook.length !== 3) problems.push("card-world: update duplicated world lorebook: " + (rwAfter && rwAfter.lorebook.length));

  // a card WITHOUT an embedded book still becomes a world (rules only)
  await page.evaluate((i) => { document.querySelectorAll("#chars .prow")[i].querySelector("button.secondary").click(); }, rvRow === 0 ? 1 : 0); // Kael row's world button
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Created world"), { timeout: 8000 });
  const kw = await page.evaluate(async () => await window.root.kv.worlds.get("kael"));
  if (!kw || !kw.meta || kw.meta.name !== "Kael") problems.push("card-world (no book): world missing: " + JSON.stringify(kw && kw.meta));
  if (!kw || kw.lorebook.length !== 1 || kw.lorebook[0].title !== "Rules" || kw.lorebook[0].content !== "A grim mercenary.\n\nCold, loyal.\n\nHe owes you a debt.") problems.push("card-world (no book): rules entry wrong: " + JSON.stringify(kw && kw.lorebook));

  // ---- World Info -> lorebook ----
  await page.waitForSelector("#books .prow", { timeout: 8000 });
  await page.click("#books .prow button");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Imported 2"), { timeout: 8000 });
  world = await page.evaluate(async () => await window.root.kv.worlds.get("w1"));
  const lb = world && world.lorebook;
  if (!lb || lb.length !== 2) problems.push("book import entry count wrong: " + (lb && lb.length));
  const e0 = lb && lb[0], e1 = lb && lb[1];
  if (!e0 || e0.title !== "eldoria" || e0.activation !== "keywords" || JSON.stringify(e0.keywords) !== JSON.stringify(["eldoria", "wood", "forest"]) || e0.content !== "Eldoria is an old wood.") problems.push("keyword entry wrong: " + JSON.stringify(e0));
  if (!e1 || e1.title !== "crown" || e1.activation !== "always") problems.push("constant entry wrong: " + JSON.stringify(e1));
  reg = await page.evaluate(async () => await window.root.kv.rpg.get("lwImports"));
  if (!reg || !reg.books || !reg.books.b1 || reg.books.b1.worlds[0].worldId !== "w1") problems.push("book registry missing");

  // book Update: re-fetch replaces (no duplicates), removal + re-add by title
  await page.click("#books .prow button");
  await page.waitForFunction(() => document.querySelector("#msg").textContent.includes("Updated"), { timeout: 8000 });
  world = await page.evaluate(async () => await window.root.kv.worlds.get("w1"));
  if (!world || !world.lorebook || world.lorebook.length !== 2) problems.push("book update duplicated entries: " + (world && world.lorebook && world.lorebook.length));

  await browser.close();
  srv.close();
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "IMPORTS OK");
  process.exit(problems.length ? 1 : 0);
})();
