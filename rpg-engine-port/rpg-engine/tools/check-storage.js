// Verifies the RPG Engine server-side saves (storage mirror shim + Loreweaver kv endpoints):
//   - boot reconcile pushes local-only keys to the server,
//   - every write/delete is mirrored (write-through),
//   - server-newer values (synced from another device) flow into the browser on reload,
//   - both-sides-changed keeps the local value as a server-side conflict copy,
//   - remote deletes (tombstones) remove the local entry on the next boot.
//   node tools/check-storage.js
// (starts a combined static + mock-Loreweaver server on 8767 — same origin, like production)
const { chromium } = require("playwright");
const http = require("http");
const path = require("path");

const APP_ROOT = path.join(__dirname, ".."); // rpg-engine root: serves app/ and tools/
const PORT = 8767;
const problems = [];

// ---- mock Loreweaver kv backend ----
const data = new Map();   // name -> { content, mtimeMs }
const tombs = new Map();  // name (without .tomb.json) -> mtimeMs
let mtimeCounter = Date.now();
const nowM = () => (mtimeCounter += 7); // strictly increasing fake clock
const sessions = new Set();
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const staticSrv = http.createServer((req, res) => {
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

  if (url.pathname.startsWith("/api/rpg-engine-kv/") && req.method === "POST") {
    const sid = cookies.sid, token = req.headers["x-csrf-token"];
    if (!sid || !sessions.has(sid) || token !== "csrf-" + sid) {
      res.writeHead(403); return res.end();
    }
    return readBody((body) => {
      const op = url.pathname.slice("/api/rpg-engine-kv/".length);
      if (op === "list") {
        const entries = [];
        for (const [name, v] of data) entries.push({ name, mtimeMs: v.mtimeMs, size: v.content.length });
        for (const [name, t] of tombs) entries.push({ name: name + ".tomb.json", mtimeMs: t, size: 40 });
        return json({ entries });
      }
      if (op === "get") {
        const v = data.get(body.name);
        return json(v ? { content: v.content, mtimeMs: v.mtimeMs } : { content: null, mtimeMs: 0 });
      }
      if (op === "put") {
        const m = body.mtime || nowM();
        data.set(body.name, { content: body.content, mtimeMs: m });
        tombs.delete(body.name.replace(/\.json$/, ""));
        return json({ mtimeMs: m });
      }
      if (op === "delete") {
        data.delete(body.name);
        tombs.set(body.name.replace(/\.json$/, ""), nowM());
        return json({ ok: true, mtimeMs: nowM() });
      }
      res.writeHead(404); return res.end();
    });
  }

  // test-only: simulate another device having written/deleted via sync
  if (url.pathname === "/__mock/put" && req.method === "POST") {
    return readBody((body) => { data.set(body.name, { content: body.content, mtimeMs: nowM() }); return json({ ok: true }); });
  }
  if (url.pathname === "/__mock/tomb" && req.method === "POST") {
    return readBody((body) => { data.delete(body.name); tombs.set(body.name.replace(/\.json$/, ""), nowM()); return json({ ok: true }); });
  }
  if (url.pathname === "/__mock/state" && req.method === "GET") {
    return json({ data: [...data.entries()].map(([k, v]) => ({ name: k, content: v.content, mtimeMs: v.mtimeMs })), tombs: [...tombs.entries()] });
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
  await new Promise((r) => staticSrv.listen(PORT, "127.0.0.1", r));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 160)));
  page.on("console", (m) => { if (/rpge saves/.test(m.text())) console.log("[page]", m.text().slice(0, 220)); });
  await page.route("**/*", (r) => (/^http:\/\/127\.0\.0\.1/.test(r.request().url()) ? r.continue() : r.abort()));
  const url = `http://127.0.0.1:${PORT}/tools/storage-test.html`;
  const state = () => page.evaluate(() => fetch("/__mock/state").then((r) => r.json()));

  // ---- boot 1: reconcile pushes local-only keys (indexedDB has none yet, so set then wait) ----
  await page.goto(url);
  await page.waitForFunction(() => { const e = document.getElementById("status"); return !!e && e.textContent.includes("ready kv=yes"); }, { timeout: 8000 });
  // local writes BEFORE the reconcile's idle callback fires would be pushed as local-only;
  // deterministic: write now (write-through covers it anyway).
  await page.evaluate(async () => {
    await window.root.kv.rpg.set("session_1", { id: "s1", turn: 1, hero: "Ashrith" });
    await window.root.kv.worlds.set("w_1", { id: "w_1", name: "Test World" });
  });
  await wait(1200); // debounce (400ms) + push
  let st = await state();
  let s1 = st.data.find((e) => e.name.endsWith(".json") && !e.name.includes(".tomb") && JSON.parse(e.content).hero === "Ashrith");
  if (!s1) problems.push("write-through push failed: session_1 not on server");
  if (!st.data.some((e) => JSON.parse(e.content || "{}").name === "Test World")) problems.push("write-through push failed: worlds/w_1 not on server");

  // ---- boot 2: another device updated session_1 (server newer) -> flows into the browser ----
  const nameOf = (folder, key) => Buffer.from(folder + "\u0000" + key, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const s1name = nameOf("rpg", "session_1") + ".json";
  const w1name = nameOf("worlds", "w_1") + ".json";
  await page.evaluate(({ n, c }) => fetch("/__mock/put", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n, content: c }) }), { n: s1name, c: JSON.stringify({ id: "s1", turn: 9, hero: "Ashrith", editedOn: "other-device" }) });
  // [rpge-patch 026] the reconcile fires rpge-saves-synced with detail.changed = entries pulled
  // into IndexedDB — the landing's "re-render after sync" listener relies on this.
  await page.addInitScript(() => { window.addEventListener("rpge-saves-synced", (e) => { window.__syncDetail = e && e.detail ? JSON.parse(JSON.stringify(e.detail)) : null; }); });
  await page.reload();
  await page.waitForFunction(() => { const e = document.getElementById("status"); return !!e && e.textContent.includes("ready kv=yes"); }, { timeout: 8000 });
  await wait(2600); // reconcile on idle
  const syncDetail = await page.evaluate(() => window.__syncDetail);
  if (!syncDetail || typeof syncDetail.changed !== "number" || syncDetail.changed < 1) problems.push("rpge-saves-synced did not report pulled entries: " + JSON.stringify(syncDetail));
  const pulled = await page.evaluate(async () => await window.root.kv.rpg.get("session_1"));
  if (!pulled || pulled.editedOn !== "other-device" || pulled.turn !== 9) problems.push("server-newer value did not flow into the browser: " + JSON.stringify(pulled));
  // local old value must be preserved as a conflict copy
  st = await state();
  const conflicts = st.data.filter((e) => e.name.includes(".conflict-"));
  if (!conflicts.length) problems.push("both-sides-changed did not keep a conflict copy");
  else if (!conflicts[0].content.includes("Ashrith") || !conflicts[0].content.includes("\"turn\":1")) problems.push("conflict copy has wrong content: " + conflicts[0].content);

  // ---- boot 3: remote delete (tombstone) removes the local entry ----
  await page.evaluate(({ n }) => fetch("/__mock/tomb", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: n }) }), { n: w1name });
  await page.reload();
  await page.waitForFunction(() => { const e = document.getElementById("status"); return !!e && e.textContent.includes("ready kv=yes"); }, { timeout: 8000 });
  await wait(2600);
  const hasWorld = await page.evaluate(async () => await window.root.kv.worlds.has("w_1"));
  if (hasWorld) problems.push("tombstone did not remove the locally deleted... er, locally known world");

  // ---- boot 4: new local key after the tombstone is still pushed (not blocked) ----
  await page.evaluate(async () => { await window.root.kv.rpg.set("session_2", { id: "s2", fresh: true }); });
  await wait(1200);
  st = await state();
  if (!st.data.some((e) => e.name.endsWith(".json") && !e.name.includes(".tomb") && JSON.parse(e.content || "{}").fresh === true)) problems.push("fresh local key was not pushed");

  console.log("server entries seen:", st.data.length, "| tombs:", st.tombs.length);
  await browser.close();
  staticSrv.close();
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "STORAGE OK");
  process.exit(problems.length ? 1 : 0);
})();
