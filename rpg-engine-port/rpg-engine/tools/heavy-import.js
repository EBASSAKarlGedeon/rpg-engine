// Import pipeline test: seed a world in the REAL server kv, then drive loreweaver-import.html
// to pull "Bram Testwell" (real server character) into that world as a standing NPC.
const { chromium } = require("playwright");
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const APP = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html#imports";
const problems = [];

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
  page.on("pageerror", e => problems.push("pageerror: " + e.message.slice(0, 160)));

  // seed a target world via the real kv router
  await page.goto("http://127.0.0.1:8000/csrf-token", { waitUntil: "domcontentloaded" }).catch(() => {});
  const seeded = await page.evaluate(async () => {
    const t = (await fetch("/csrf-token", { credentials: "include" }).then(r => r.json())).token;
    const H = { "Content-Type": "application/json", "X-CSRF-Token": t };
    const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const put = (name, content) => fetch("/api/rpg-engine-kv/put", { method: "POST", credentials: "include", headers: H, body: JSON.stringify({ name, content: JSON.stringify(content) }) }).then(r => r.status);
    const world = {
      format: "mno-world", version: 1,
      meta: { id: "wimport", name: "Import Target", description: "", author: "", authorId: "", tags: [], nsfw: false },
      narrativeVibe: "test", worldDescription: "test", proseRules: true, threadFires: true, sceneDice: true,
      lorebook: [], scenario: "test", start: "You arrive.", startMode: "verbatim",
      starts: [{ id: "start", title: "", description: "", text: "You arrive.", mode: "verbatim" }],
      imageStyleTags: "", imageNegativeTags: "", imageIncludeTrackers: false, imageIncludeNpcTrackers: false,
      imageTrackerKeys: [], imageNpcTrackerKeys: [],
      stats: { cfg: {}, defs: [] }, trackers: [], npcTrackers: [], npcs: []
    };
    const s1 = await put(b64url("worlds\u0000wimport") + ".json", world);
    const s2 = await put(b64url("worlds\u0000index") + ".json", [{ id: "wimport", name: "Import Target", cover: "", tags: [], description: "", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "", updatedAt: "" }]);
    return { s1, s2 };
  });
  console.log("seeded:", JSON.stringify(seeded));

  await page.goto(APP, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(6000);
  // pick the target world
  const picked = await page.evaluate(() => {
    const sel = document.querySelector("#lwimpTargetWorld");
    if (!sel) return "no select";
    const opt = [...sel.options].find(o => (o.textContent || o.value).includes("wimport") || (o.textContent || "").includes("Import Target"));
    if (!opt) return "no option: " + [...sel.options].map(o => o.textContent).join("|").slice(0, 200);
    sel.value = opt.value;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    return "picked " + opt.textContent;
  });
  console.log("target world:", picked);
  await page.waitForTimeout(4000);
  // find Bram and import
  const imported = await page.evaluate(async () => {
    const btns = [...document.querySelectorAll("button")].filter(b => b.offsetParent && /import|add/i.test(b.textContent));
    const info = { buttons: btns.map(b => b.textContent.trim().slice(0, 30)).slice(0, 10) };
    const bramBtn = btns.find(b => (b.closest("[class*=card], li, div, tr") || {}).textContent && /Bram/i.test(b.closest("[class*=card], li, div, tr").textContent));
    if (!bramBtn) return { ...info, clicked: false };
    bramBtn.click();
    return { ...info, clicked: true };
  });
  console.log("import click:", JSON.stringify(imported).slice(0, 300));
  await page.waitForTimeout(6000);
  // verify the world NPC landed in the real kv
  const verify = await page.evaluate(async () => {
    const t = (await fetch("/csrf-token", { credentials: "include" }).then(r => r.json())).token;
    const b64url = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const r = await fetch("/api/rpg-engine-kv/get", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Token": t }, body: JSON.stringify({ name: b64url("worlds\u0000wimport") + ".json" }) }).then(x => x.json());
    let w = null; try { w = JSON.parse(r.content); } catch {}
    return w ? { npcs: w.npcs.map(n => n.name), lorebook: (w.lorebook || []).length } : "no world";
  });
  console.log("world after import:", JSON.stringify(verify));
  if (!(verify && verify.npcs && verify.npcs.some(n => /Bram/i.test(n)))) problems.push("Bram did not land as a world NPC");
  await page.screenshot({ path: "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/im01-import.png" });
  console.log("problems:", problems.length ? "\n - " + problems.join("\n - ") : "none");
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})().catch(e => { console.error("ERR", e); process.exit(1); });
