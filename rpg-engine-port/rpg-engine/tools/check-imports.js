// Verifies the "Import from Loreweaver" page (personas -> game hero library, linked snapshots):
//   - personas are listed from /api/settings/get (power_user.personas + persona_descriptions),
//   - Import writes a proper hero record into kv.rpg.savedHeroes (name/persona/portrait/lwSource),
//   - re-import does not duplicate (updates the linked hero),
//   - a changed source description is detected and the Update overwrites only imported fields.
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

  await browser.close();
  srv.close();
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "IMPORTS OK");
  process.exit(problems.length ? 1 : 0);
})();
