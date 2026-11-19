// Final round: OP hero edit, duet attempt (two NPCs in scene), bridge error handling.
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
    try { const s = JSON.parse(kv.get(k) || "{}"); return { turn: s.turn || 0, msgs: (s.messages || []).length, duets: (s.messages || []).filter(m => m.duet).length, grit: ((s.character || {}).stats || {}).grit }; } catch { return null; }
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
    // NOTE: deliberately NO page API key — validates the bridge key-gate relaxation (patch 015)
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

  // A. duet attempt: both NPCs present, ask both at once
  await send("I stand between Mira and Olek and ask them both, out loud, to tell me at the same time what is wrong with the bridge.");
  await idle();
  console.log("after duet attempt:", JSON.stringify(readTurn()));
  const duetDoms = await page.evaluate(() => [...document.querySelectorAll("#transcriptEl .duet, #transcriptEl [class*=duet]")].length);
  console.log("duet DOM elements:", duetDoms);
  await page.screenshot({ path: SHOTS + "/f01-duet-attempt.png" });

  // B. hero OP edit: open hero panel, toggle ✎, change Grit, save
  await page.evaluate(() => { const t = [...document.querySelectorAll("#rightRail .rail-tab")].find(x => x.dataset.sec === "character"); t && t.click(); });
  await page.waitForTimeout(1200);
  const freeEdit = page.locator("#cFreeEdit");
  if (await freeEdit.count()) {
    await freeEdit.click();
    await page.waitForTimeout(800);
    // Grit +/- controls appear; click + once
    const gritRow = page.locator("#heroPanel .stat, [class*=hero] .stat, .cc-rev-sec").filter({ hasText: /grit/i }).first();
    const before = readTurn().grit;
    const plus = page.locator("button", { hasText: "+" }).filter({ hasText: /^\+$/ }).first();
    if (await plus.count()) {
      await plus.evaluate(el => el.click()).catch(() => plus.click());
      await page.waitForTimeout(500);
      const saveBtn = page.locator("#cSave");
      if (await saveBtn.count()) { await saveBtn.click(); await page.waitForTimeout(1500); }
      const after = readTurn().grit;
      console.log("OP edit grit:", before, "->", after);
      if (after === before) problems.push("OP hero stat edit did not persist");
    } else {
      console.log("no +/- control found (freeEdit toggled?):");
      await page.screenshot({ path: SHOTS + "/f02-opedit.png" });
      problems.push("OP edit + control not found");
    }
  } else problems.push("cFreeEdit not found in hero panel");
  await page.screenshot({ path: SHOTS + "/f03-hero-after.png" });

  // C. bridge misconfig: bogus profile id → the next turn should fail with a CLEAR error, not hang
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem("rpge.loreweaverBridge") || "{}");
    c.profileId = "no-such-profile";
    localStorage.setItem("rpge.loreweaverBridge", JSON.stringify(c));
  });
  await send("I nod and keep watching.");
  // wait for either recovery (idle) or a visible error toast within 90s
  let errToast = null;
  for (let i = 0; i < 22; i++) {
    await page.waitForTimeout(4000);
    const t = await page.evaluate(() => [...document.querySelectorAll("[class*=toast], [class*=notify]")].map(e => (e.textContent || "").trim()).filter(Boolean).slice(0, 4));
    if (t.some(x => /fail|error|couldn't|not found/i.test(x))) { errToast = t; break; }
  }
  console.log("bridge-error toast:", JSON.stringify(errToast));
  if (!errToast) problems.push("bridge misconfiguration produced no visible error within 90s");
  await page.screenshot({ path: SHOTS + "/f04-bridge-err.png" });

  console.log("problems:", problems.length ? "\n - " + problems.join("\n - ") : "none");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
