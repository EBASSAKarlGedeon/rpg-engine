// Stop-mid-generation + session shelf switching test (real AI).
const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const problems = [];
const SHOTS = "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy";

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
  const readTurn = () => {
    const k = b64url("rpg\u0000session_s_stress_1") + ".json";
    try { const s = JSON.parse(kv.get(k) || "{}"); return { turn: s.turn || 0, msgs: (s.messages || []).length }; } catch { return null; }
  };
  const idle = async () => {
    await page.waitForFunction(() => { const b = document.querySelector("#sendBtn"); return b && b.textContent.trim() === "➤"; }, undefined, { timeout: 300000 });
    let last = -1, stable = 0;
    while (stable < 2) { await page.waitForTimeout(4000); const st = readTurn(); if (st && st.msgs === last) stable++; else stable = 0; last = st ? st.msgs : -1; }
  };
  const send = async (text) => {
    await idle();
    const ta = page.locator('textarea[placeholder*="What do you do"]');
    await ta.fill(text);
    await page.keyboard.press("Enter");
  };

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on("pageerror", e => { if (!/offline|MiniMini|tokenizer|image|portrait/i.test(e.message)) problems.push("pageerror: " + e.message.slice(0, 160)); });
  await page.addInitScript(() => {
    localStorage.setItem("mno.aiProvider", JSON.stringify({ provider: "openai", providers: { openai: { baseUrl: "http://bridge.invalid/v1", model: "bridged" } } }));
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

  // 1. send and STOP mid-stream
  await send("I settle in for a long night of watching the river. Then, over the next hour, I sketch what I saw so far in my journal.");
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(2000);
    const st = readTurn();
    const btn = await page.evaluate(() => (document.querySelector("#sendBtn") || {}).textContent || "?");
    console.log(`poll ${i}: btn=${btn.trim()} state=${JSON.stringify(st)}`);
    if (btn.trim() === "■") break;
  }
  const isStop = await page.evaluate(() => { const b = document.querySelector("#sendBtn"); return b && b.textContent.trim() === "■"; });
  if (!isStop) problems.push("send button never showed the stop state (■)");
  await page.waitForTimeout(5000); // let some text stream in
  await page.screenshot({ path: SHOTS + "/s01-streaming.png" });
  await page.locator("#sendBtn").click(); // the ■ stop button
  await page.waitForFunction(() => { const b = document.querySelector("#sendBtn"); return b && b.textContent.trim() === "➤"; }, undefined, { timeout: 60000 });
  await page.waitForTimeout(4000);
  const stStop = readTurn();
  console.log("after stop:", JSON.stringify(stStop));
  const lastNarr = await page.evaluate(() => {
    const n = [...document.querySelectorAll("#transcriptEl .msg.narrator")].pop();
    return n ? (n.textContent || "").length : -1;
  });
  console.log("last narrator length after stop:", lastNarr);
  if (lastNarr <= 0) problems.push("stop kept no partial text");
  // the turn should still be playable: send another action
  await send("I finally go to bed.");
  await idle();
  console.log("after follow-up turn:", JSON.stringify(readTurn()));

  // 2. session shelf: load the seeded save again after playing (it's the same session; test via Session tab visibility)
  await page.evaluate(() => { const t = [...document.querySelectorAll("#leftRail .rail-tab")].find(x => x.dataset.sec === "session"); t && t.click(); });
  await page.waitForTimeout(1200);
  const shelf = await page.evaluate(() => {
    const rows = [...document.querySelectorAll("#leftRail [class*=adventure], #leftRail [class*=session]")].map(e => (e.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60)).filter(x => x);
    return rows.slice(0, 6);
  });
  console.log("shelf rows:", JSON.stringify(shelf));
  await page.screenshot({ path: SHOTS + "/s02-shelf.png" });

  console.log("problems:", problems.length ? "\n - " + problems.join("\n - ") : "none");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
