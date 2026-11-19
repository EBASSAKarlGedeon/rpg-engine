// Heavy interaction sweep: real AI turn, then re-roll / version nav / edit / delete /
// unicode / empty-idle / skill-check flows against the seeded stress session.
const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const problems = [];

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
    try {
      const s = JSON.parse(kv.get(k) || "{}");
      const rr = (s.messages || []).filter(m => m.rerolls);
      return {
        turn: s.turn || 0, msgs: (s.messages || []).length,
        lastRerolls: rr.length ? (rr[rr.length - 1].rerolls || []).length : 0,
        hasCheck: (s.messages || []).some(m => m.role === "check")
      };
    } catch { return null; }
  };
  const idle = async (extra = 0) => {
    await page.waitForFunction(() => { const b = document.querySelector("#sendBtn"); return b && b.textContent.trim() === "➤"; }, undefined, { timeout: 300000 });
    let last = -1, stable = 0;
    while (stable < 2) {
      await page.waitForTimeout(4000);
      const st = readTurn();
      if (st && st.msgs === last) stable++; else stable = 0;
      last = st ? st.msgs : -1;
    }
    if (extra) await page.waitForTimeout(extra);
  };
  const send = async (text) => {
    await idle();
    const ta = page.locator('textarea[placeholder*="What do you do"]');
    await ta.fill(text);
    await page.keyboard.press("Enter");
  };

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on("pageerror", e => { if (!/offline|MiniMini|tokenizer|image-gen|portrait generation/i.test(e.message + e.text)) problems.push("pageerror: " + e.message.slice(0, 160)); });
  await page.addInitScript(() => {
    localStorage.setItem("mno.aiProvider", JSON.stringify({ provider: "openai", providers: { openai: { baseUrl: "http://bridge.invalid/v1", model: "bridged-model" } }, useExternal: { tracker: false, staging: false, check: false } }));
    localStorage.setItem("mno.aiProviderKey", JSON.stringify({ openai: "sk-test" }));
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
  seed(); // re-seed after the first boot's writes (index-overwrite race)
  await page.reload({ waitUntil: "load", timeout: 90000 });
  await page.waitForFunction(() => document.querySelector("#transcriptEl") || document.querySelector(".hn-item"), undefined, { timeout: 90000 });
  await page.waitForTimeout(6000);

  // 1. real turn
  await send("I try to force the swollen back door open to check the cellar.");
  await idle();
  console.log("turn after check attempt:", JSON.stringify(readTurn()));

  // 2. re-roll the latest GM reply (controls are hover-revealed — hover the row first)
  const gmRow = page.locator("#transcriptEl .gm-row").last();
  await gmRow.hover();
  await page.waitForTimeout(400);
  const rrBtn = page.locator("#transcriptEl .gm-row:hover button.c-btn.reroll, #transcriptEl button.c-btn.reroll").last();
  const rrCount = await rrBtn.count();
  if (!rrCount) problems.push("re-roll button not found on latest GM reply");
  else {
    await rrBtn.click();
    await idle();
    const st = readTurn();
    console.log("after re-roll:", JSON.stringify(st));
    if (!st.lastRerolls) problems.push("re-roll did not record a reroll version");
  }

  // 3. version nav if >1
  await gmRow.hover(); await page.waitForTimeout(300);
  const navBtns = await page.locator("#transcriptEl button.c-btn.nav").count();
  if (navBtns >= 2) {
    await page.locator('#transcriptEl button.c-btn.nav[data-nav="-1"]').last().click();
    await page.waitForTimeout(1500);
    await page.locator('#transcriptEl button.c-btn.nav[data-nav="1"]').last().click();
    await page.waitForTimeout(1500);
    console.log("version nav OK");
  } else problems.push("version nav buttons missing after re-roll (count=" + navBtns + ")");

  // 4. edit an action bubble
  const actRow = page.locator("#transcriptEl .msg.action").last().locator("xpath=ancestor::div[contains(@class,'gm-row')]").first();
  await actRow.hover().catch(() => {});
  await page.waitForTimeout(300);
  const editBtn = page.locator("#transcriptEl .msg.action .action-ctrl button.c-btn").first();
  if (await editBtn.count()) {
    await editBtn.evaluate((el) => el.click());
    await page.waitForTimeout(1000);
    // an inline textarea/editor appears; find it
    const ed = page.locator("#transcriptEl textarea:visible").last();
    if (await ed.count()) {
      await ed.fill("I quietly pocket a candle stub instead.");
      const save = page.locator("#transcriptEl button:visible").filter({ hasText: /save|done|✓/i }).last();
      if (await save.count()) await save.click();
      else await page.keyboard.press("Control+Enter");
      await page.waitForTimeout(1500);
      const after = await page.evaluate(() => [...document.querySelectorAll("#transcriptEl .msg.action")].map(e => e.textContent).join(" ").includes("candle stub"));
      console.log("action edit applied:", after);
      if (!after) problems.push("action edit did not apply");
    } else problems.push("edit mode did not open a textarea");
  } else problems.push("no action bubbles / edit button found");

  // 5. unicode + long action
  await send("I whisper to Mira: 「晚上了」 — then try the door again 🚪✨ …and press hard, twice.");
  await idle();
  console.log("after unicode turn:", JSON.stringify(readTurn()));

  // 6. empty send = idle "Waiting" turn
  await idle();
  await page.locator("#sendBtn").click();
  await idle(4000);
  const stIdle = readTurn();
  console.log("after empty send:", JSON.stringify(stIdle));
  if (stIdle.msgs === readTurn.msgs) problems.push("empty send produced no turn");

  // 7. delete an old GM reply (confirm popup)
  const delRow = page.locator("#transcriptEl .gm-row").first();
  const delBtn = delRow.locator("button.c-btn.del").first();
  const before = readTurn();
  // controls are hover-revealed; synthetic JS click is reliable in automation
  await delBtn.evaluate((el) => el.click());
  await page.waitForTimeout(800);
  // confirm popup (the overlay blocks the transcript — answer it)
  const conf = page.locator(".popup-overlay button").filter({ hasText: /delete|confirm|yes/i }).first();
  if (await conf.count()) await conf.click();
  await page.waitForTimeout(2000);
  await idle();
  const afterDel = readTurn();
  console.log("delete:", before.msgs, "->", afterDel.msgs);
  if (afterDel.msgs >= before.msgs) problems.push("delete did not reduce the transcript");

  await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/i01-final.png" });
  console.log("problems:", problems.length ? "\n - " + problems.join("\n - ") : "none");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
