// Panels + world editor save round-trip (no AI needed).
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
    const w = makeWorld();
    w.meta.name = "Round Trip Valley";
    put("worlds", "wstress", w);
    put("worlds", "index", [{ id: "wstress", name: "Round Trip Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
    const s = makeSession();
    // pre-load memories + life data so panels have something to show
    s.memories = {
      auto: [{ text: "The hero owes Mira a favor from the last visit.", turn: 4, pinned: false }, { text: "The river rose past the mill mark overnight.", turn: 8, pinned: true }],
      manual: [], digest: "", history: { layers: [[{ text: "Earlier in the valley: the hero arrived soaked and made peace with Olek.", turn: 3 }]], summarizedUpTo: 3 }
    };
    s.npcs["Mira"].lifeGoal = "Finish the river chart before the flood";
    s.npcs["Mira"].lifeWhere = "The inn, corner table";
    s.npcs["Mira"].lifeTick = 10;
    put("rpg", "sessions", [{ id: s.id, name: s.name, charName: "Wren", worldId: "wstress", worldName: "Round Trip Valley", turn: 11, lastUpdated: 1700000000000, avatar: "", portraitSig: "" }]);
    put("rpg", "session_" + s.id, s);
    put("rpg", "activeSession", s.id);
  };
  seed();
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on("pageerror", e => { if (!/offline|MiniMini|tokenizer|image/i.test(e.message)) problems.push("pageerror: " + e.message.slice(0, 160)); });
  await page.addInitScript(() => {
    localStorage.setItem("mno.aiProvider", JSON.stringify({ provider: "openai", providers: { openai: { baseUrl: "http://bridge.invalid/v1", model: "bridged" } } }));
    localStorage.setItem("rpge.loreweaverBridge", JSON.stringify({ enabled: false }));
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
  const boot = async () => {
    await page.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
    await page.waitForFunction(() => document.querySelector("#transcriptEl") || document.querySelector(".hn-item"), { timeout: 90000 });
    await page.waitForTimeout(5000);
    seed();
    await page.reload({ waitUntil: "load", timeout: 90000 });
    await page.waitForFunction(() => document.querySelector("#transcriptEl") || document.querySelector(".hn-item"), { timeout: 90000 });
    await page.waitForTimeout(5000);
  };
  await boot();
  const ov = await page.evaluate(() => { const o = [...document.querySelectorAll(".popup-overlay")].find(x => x.offsetParent); if (o) { const b = [...o.querySelectorAll("button")].find(b => b.offsetParent); b && b.click(); return true; } return false; });
  console.log("popup dismissed:", ov);

  // MEMORIES rail tab
  await page.evaluate(() => { const t = [...document.querySelectorAll("#leftRail .rail-tab")].find(x => x.dataset.sec === "memory"); t && t.click(); });
  await page.waitForTimeout(1500);
  const memTabs = await page.evaluate(() => [...document.querySelectorAll(".seg-btn[data-mtab]")].map(b => b.textContent.trim()));
  console.log("memory sub-tabs:", JSON.stringify(memTabs));
  for (const mt of ["auto", "threads", "story"]) {
    await page.evaluate((mt) => { const b = [...document.querySelectorAll(".seg-btn[data-mtab]")].find(x => x.dataset.mtab === mt); b && b.click(); }, mt);
    await page.waitForTimeout(600);
  }
  await page.screenshot({ path: SHOTS + "/p01-memory.png" });

  // Session tab (saves shelf)
  await page.evaluate(() => { const t = [...document.querySelectorAll("#leftRail .rail-tab")].find(x => x.dataset.sec === "session"); t && t.click(); });
  await page.waitForTimeout(1200);
  const shelf = await page.evaluate(() => (document.querySelector("#leftRail") || {}).textContent.replace(/\s+/g, " ").slice(0, 300));
  console.log("session shelf:", shelf.slice(0, 200));
  await page.screenshot({ path: SHOTS + "/p02-session.png" });

  // NPC panel + Life tab
  await page.evaluate(() => { const t = [...document.querySelectorAll("#rightRail .rail-tab")].find(x => x.dataset.sec === "npc"); t && t.click(); });
  await page.waitForTimeout(1200);
  const npcNames = await page.evaluate(() => [...document.querySelectorAll("#rightRail .npc-name, #rightRail [class*=npc]")].map(e => e.textContent.trim().slice(0, 20)).filter(Boolean).slice(0, 8));
  console.log("npc roster:", JSON.stringify(npcNames));
  await page.screenshot({ path: SHOTS + "/p03-npc.png" });

  // World editor save round-trip: Worlds → wstress card → ⋮ → Edit → change name → Save World
  await page.evaluate(() => { const t = [...document.querySelectorAll("#leftRail .rail-tab")].find(x => x.dataset.sec === "menu"); t && t.click(); });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const it = [...document.querySelectorAll("button, .hn-item")].filter(x => x.offsetParent).find(x => (x.textContent || "").trim().toUpperCase().includes("WORLDS"));
    it && it.click();
  });
  await page.waitForSelector(".ld-wcard", { timeout: 40000 });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const c = [...document.querySelectorAll(".ld-wcard")].find(x => (x.textContent || "").includes("Round Trip Valley"));
    const dots = c && c.querySelector(".ld-wmore");
    dots && dots.click();
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => { const mi = [...document.querySelectorAll("button")].filter(x => x.offsetParent).find(x => (x.textContent || "").trim().includes("Edit")); mi && mi.click(); });
  await page.waitForTimeout(2500);
  // Basics tab: change the name field
  const nameInput = page.locator("#ceName, input[class*=ce-name], #edName").first();
  const nameSel = await page.evaluate(() => {
    const inp = [...document.querySelectorAll("input")].filter(i => i.offsetParent && i.value === "Round Trip Valley");
    if (inp.length) { inp[0].focus(); inp[0].select(); document.execCommand("insertText", false, "Round Trip Valley II"); return inp[0].id || "found"; }
    return null;
  });
  console.log("name field:", nameSel);
  await page.waitForTimeout(500);
  await page.evaluate(() => { const b = [...document.querySelectorAll("button")].filter(x => x.offsetParent).find(x => (x.textContent || "").includes("Save World")); b && b.click(); });
  await page.waitForTimeout(3000);
  const savedName = JSON.parse(kv.get(b64url("worlds\u0000wstress") + ".json") || "{}").meta.name;
  console.log("saved world name:", savedName);
  if (savedName !== "Round Trip Valley II") problems.push("world editor save round-trip failed (name=" + savedName + ")");
  const idx = JSON.parse(kv.get(b64url("worlds\u0000index") + ".json") || "[]");
  console.log("index after save:", JSON.stringify(idx.map(e => e.name)));
  if (!idx.some(e => e.name === "Round Trip Valley II")) problems.push("world index not updated after save");

  console.log("problems:", problems.length ? "\n - " + problems.join("\n - ") : "none");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
