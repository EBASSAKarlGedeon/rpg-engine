// Heavy session sweep: boots the app against the REAL Loreweaver server (real AI through the
// bridge, cheap profile), with the kv routes stubbed for deterministic seeds. Plays a seeded
// session from turn 11 up past turn 15 (scene dice + npc-life cadence) and reports anomalies.
// Usage: node tools/heavy-session.js [maxTurns=16]
const { chromium } = require("playwright");

const PROFILE_ID = "432b3e02-09e4-4bf0-a93c-662c9f8d5f7c"; // Openrouter profile (deepseek flash)
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");

function makeWorld() {
  const npcs = [
    { name: "Mira", age: "27", gender: "female", race: "human", appearance: "Short dark hair, ink-stained fingers, a leather satchel of maps.", job: "Cartographer", persona: "Sharp-tongued, restless, always halfway out the door. Talks fast when nervous.", secrets: "She is being followed by a debt collector.", extra: "", avatar: "", trackers: {} },
    { name: "Olek", age: "52", gender: "male", race: "human", appearance: "Grey beard, burn scars on one forearm, smells of pine resin.", job: "Bridge keeper", persona: "Slow to speak, quick to act. Hums old marching songs.", secrets: "He buried something under the east pillar.", extra: "", avatar: "", trackers: {} }
  ];
  return {
    format: "mno-world", version: 1,
    meta: { id: "wstress", name: "Stress Test Valley", description: "A test world.", author: "tester", authorId: "", tags: [], nsfw: false },
    narrativeVibe: "Grounded fantasy, tense but hopeful.",
    worldDescription: "A rain-slick valley with one stone bridge, a flooded mill, and a crossroads inn. The river has been rising for days.",
    proseRules: true, threadFires: true, sceneDice: true,
    lorebook: [
      { id: "l1", keys: ["river", "flood"], name: "The Rising", text: "The river Vess has flooded three times in living memory. Each flood took a barn and gave back a boat.", always: false },
      { id: "l2", keys: ["inn"], name: "The Split Cask", text: "The crossroads inn, run by a retired smuggler who charges double for questions.", always: false }
    ],
    scenario: "The hero arrives at the valley as the river begins to rise.",
    start: "Rain hammers the crossroads sign. The bridge keeper waves you toward the inn.",
    startMode: "verbatim",
    starts: [{ id: "start", title: "Arrival", description: "", text: "Rain hammers the crossroads sign. The bridge keeper waves you toward the inn.", mode: "verbatim" }],
    imageStyleTags: "", imageNegativeTags: "",
    imageIncludeTrackers: false, imageIncludeNpcTrackers: false,
    imageTrackerKeys: [], imageNpcTrackerKeys: [],
    stats: {
      cfg: { pointsPerLevel: 2, ccBudget: 12, ccFloor: 5, averageThreshold: 10, exceptionalThreshold: 15, modStep: 5, dieSides: 20 },
      defs: [
        { key: "grit", label: "Grit", type: "number", start: 8, min: 1, max: 20, icon: "🪨", color: "#b0713a", show: "hero", effects: "", rules: "" },
        { key: "wit", label: "Wit", type: "number", start: 9, min: 1, max: 20, icon: "💡", color: "#7a6fc4", show: "hero", effects: "", rules: "" }
      ]
    },
    trackers: [
      { key: "supplies", label: "Supplies", type: "number", start: 3, max: 10, icon: "🎒", color: "#5a8f5a", show: "both", effects: "", rules: "Falls on travel, buys at the inn." },
      { key: "suspicion", label: "Suspicion", type: "number", start: 1, max: 10, icon: "👁", color: "#a33", show: "both", effects: "", rules: "Rises when the hero is caught prying." }
    ],
    npcTrackers: [
      { key: "patience", label: "Patience", type: "number", start: 5, max: 10, icon: "⏳", color: "#888", show: "profile" }
    ],
    npcs
  };
}

function makeSession() {
  const msgs = [];
  for (let i = 1; i <= 11; i++) {
    msgs.push({ role: "action", text: i === 1 ? "I shrug off my soaked cloak and step inside." : `I ask about the rising river (visit ${i}).` });
    msgs.push({ role: "narrator", text: `Turn ${i}: The inn's fire crackles. Mira sketches river levels on a napkin; Olek hums by the door. The rain keeps coming.` });
    if (i % 2 === 0) msgs.push({ role: "npc", name: "Mira", text: `Turn ${i}: You again? Fine — one question, then I work.` });
  }
  return {
    id: "s_stress_1",
    name: "Heavy Test Run",
    worldId: "wstress", worldName: "Stress Test Valley",
    turn: msgs.filter(m => m.role === "action").length, // 11 — recomputed from messages anyway
    character: { name: "Wren", portrait: "", age: "30", gender: "female", race: "human", appearance: "", job: "Courier", persona: "", extra: "", background: "", stats: {}, statPoints: 0, statFloors: {}, trackerModes: {} },
    messages: msgs,
    npcs: {
      "Mira": { name: "Mira", portrait: "", description: "", details: null, importance: "medium", appearanceCount: 5, firstSeenTurn: 1, lastSeenTurn: 10, everSpoke: true, pinned: false, trackers: null },
      "Olek": { name: "Olek", portrait: "", description: "", details: null, importance: "medium", appearanceCount: 3, firstSeenTurn: 1, lastSeenTurn: 8, everSpoke: true, pinned: false, trackers: null }
    },
    settings: { showInnerThoughts: false, rollChecks: true, simNpcLife: true, showTrackerChanges: true },
    openThreads: [
      { text: "The debt collector following Mira closes in.", from: 3, lastFired: null },
      { text: "Something Olek buried under the east pillar.", from: 5, lastFired: null }
    ],
    memories: { notes: [], history: [] },
    latestSituation: "", latestSituationTurn: 0,
    lastAutoMemoryTurn: 0, lastNpcLifeTurn: 0, lastSceneDiceTurn: 0
  };
}

(async () => {
  const maxTurns = Number(process.argv[2] || 16);
  const problems = [];
  const notes = [];
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

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  page.on("pageerror", e => { if (!/offline|MiniMini|tokenizer/i.test(e.message)) problems.push("pageerror: " + e.message.slice(0, 200)); });
  page.on("console", m => { if (m.type() === "error" && /bridge|failed|unhandled/i.test(m.text()) && !/MiniMini|tokenizer|image-gen|secondary/i.test(m.text())) problems.push("console.error: " + m.text().slice(0, 200)); });

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
    if (op === "delete") { kv.set(body.name.replace(/\.json$/, "") + ".tomb.json", JSON.stringify({ deletedAt: 1700000000000 })); kv.delete(body.name); return r.fulfill({ json: { ok: true, mtimeMs: 1700000000000 } }); }
    return r.fulfill({ json: { ok: true } });
  });

  const bootOnce = async () => {
    await page.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
    try {
      // The nav rail (.hn-item) OR the resumed game view (transcript/composer) counts as booted:
      // with a seeded activeSession the app can swap to the game before the landing ever paints.
      await page.waitForFunction(
        () => document.querySelector(".hn-item") || document.querySelector("#transcriptEl") || document.querySelector('textarea[placeholder*="What do you do"]'),
        { timeout: 90000 }
      );
      return true;
    } catch { return false; }
  };
  let ok = await bootOnce();
  for (let a = 0; a < 3 && !ok; a++) {
    console.log("boot flake, retry", a + 1);
    await page.waitForTimeout(3000);
    ok = await bootOnce();
  }
  if (!ok) throw new Error("app never booted (landing shell missing)");
  await page.waitForTimeout(4000);
  seed(); // re-seed after first boot's writes
  await page.reload({ waitUntil: "load" });
  // A seeded activeSession auto-resumes into the GAME view (nav rail may be replaced) —
  // wait for either the landing nav or the transcript.
  const booted1 = await page.waitForFunction(
    () => document.querySelector(".hn-item") || document.querySelector("#transcriptEl"),
    { timeout: 120000 }
  );
  await page.waitForTimeout(8000);
  await page.evaluate(() => { const ov = [...document.querySelectorAll(".popup-overlay")].find(o => o.offsetParent); if (ov) { const b = [...ov.querySelectorAll("button")].find(b => b.offsetParent); b && b.click(); } });
  await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/h01-resume.png" });

  // Did the session auto-resume into the transcript?
  const booted = await page.evaluate(() => ({
    transcript: !!document.querySelector("#transcriptEl"),
    msgs: document.querySelectorAll("#transcriptEl .msg").length,
    composer: !!document.querySelector('textarea[placeholder*="What do you do"], #composer, [class*=composer]'),
    hero: (document.querySelector("[class*=hero]") ? document.querySelector("[class*=hero]").textContent.slice(0, 60) : "")
  }));
  console.log("booted:", JSON.stringify(booted));
  if (!booted.transcript || booted.msgs < 10) problems.push("session did not resume with seeded transcript (msgs=" + booted.msgs + ")");

  // Read the app's current turn from the kv stub (state saves after each turn)
  const readTurn = () => {
    const k = b64url("rpg\u0000session_s_stress_1") + ".json";
    try { const s = JSON.parse(kv.get(k) || "{}"); return { turn: s.turn || 0, msgs: (s.messages || []).length, threads: (s.openThreads || []).length, sceneDir: !!s.sceneDirective, threadDir: !!s.threadDirective, lastScene: s.lastSceneDiceTurn || 0, memAuto: ((s.memories || {}).auto || []).length, memManual: ((s.memories || {}).manual || []).length, lifeTurn: s.lastNpcLifeTurn || 0, sit: (s.latestSituation || "").length, npcs: Object.keys(s.npcs || {}).length }; } catch { return null; }
  };
  console.log("seeded state:", JSON.stringify(readTurn()));

  // Play turns with real AI until maxTurns
  const sendAction = async (text) => {
    // Idle-gate: wait for the idle send button AND a stable saved state — Enter mid-turn
    // is deliberately swallowed by send()'s generating gate.
    await page.waitForFunction(
      () => { const b = document.querySelector("#sendBtn"); return b && b.textContent.trim() === "\u27a4"; },
      { timeout: 300000 }
    );
    let last = -1, stable = 0;
    while (stable < 2) {
      await page.waitForTimeout(4000);
      const st = readTurn();
      if (st && st.msgs === last) stable++; else stable = 0;
      last = st ? st.msgs : -1;
    }
    const ta = page.locator('textarea[placeholder*="What do you do"]');
    await ta.fill(text);
    await page.keyboard.press("Enter");
  };
  // wait for the turn to advance in the saved state and messages to stop growing
  const waitForTurnEnd = async (prevTurn, prevMsgs, timeoutMs = 240000) => {
    const start = Date.now();
    let lastMsgs = -1, stable = 0;
    while (Date.now() - start < timeoutMs) {
      await page.waitForTimeout(4000);
      const st = readTurn();
      if (st && st.turn > prevTurn && st.msgs > prevMsgs) {
        if (st.msgs === lastMsgs) { stable++; if (stable >= 2) return st; }
        else stable = 0;
        lastMsgs = st.msgs;
      }
    }
    return readTurn();
  };

  const actions = [
    "I order soup and listen to the room.",
    "I ask Mira why the river is rising.",
    "I walk out to look at the bridge.",
    "I help Olek sandbag the east pillar.",
    "I ask Olek what is buried under the pillars.",
    "I follow Mira when she slips out the back.",
    "I check the water level at the mill.",
    "I warm up and dry my boots by the fire."
  ];
  let ai = 0;
  for (let i = 0; i < actions.length && ai < maxTurns - 11; i++) {
    const prev = readTurn() || { turn: 11, msgs: 27 };
    await sendAction(actions[i]);
    const st = await waitForTurnEnd(prev.turn, prev.msgs, 240000);
    ai++;
    console.log(`turn ${st ? st.turn : "?"} done (action ${i + 1}) -> state:`, JSON.stringify(st));
  if (!st || st.turn <= prev.turn) {
    problems.push(`action ${i + 1}: turn did not advance (still ${st ? st.turn : "?"})`);
    // diagnostics: tail of saved messages + hero tracker strip + portrait
    const tail = await page.evaluate(() => [...document.querySelectorAll("#transcriptEl .msg")].slice(-4).map(e => e.className.replace(/\s+/g, " ").slice(0, 40) + " :: " + (e.textContent || "").replace(/\s+/g, " ").slice(0, 80)));
    console.log("stalled tail:", JSON.stringify(tail, null, 1));
    const strip = await page.evaluate(() => ({ trk: (document.querySelector("#heroTrkRow") || {}).innerHTML?.slice(0, 200) || null, portrait: [...document.querySelectorAll("img")].filter(im => (im.src || "").includes("portrait") || (im.alt || "")).slice(0, 3).map(im => ({ src: (im.src || "").slice(-40), w: im.clientWidth, h: im.clientHeight, broken: im.complete && im.naturalWidth === 0 })) }));
    console.log("hero strip/portrait:", JSON.stringify(strip));
    await page.screenshot({ path: `C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/h04-stall-a${i + 1}.png` });
    break;
  }
    if (st && st.turn >= 15) await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/h02-turn15.png" });
  }

  await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/h03-final.png", fullPage: false });
  console.log("\nfinal state:", JSON.stringify(readTurn()));
  console.log("problems:", problems.length ? "\n - " + problems.join("\n - ") : "none");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
