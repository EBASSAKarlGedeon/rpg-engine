// Patch 020 verification: GFX panels + inline images in message text. Seeded kv stub (no
// real-server writes). Verifies: (1) a GFX block renders as live sanitized HTML (not escaped
// text), (2) inline ![](src) images render for both external-URL and /user/images/ paths,
// (3) a hostile fixture (img onerror + javascript: URL) leaks NO executable payload.
// Follows the heavy-session boot pattern: seed → boot → re-seed (first boot's writes clobber
// activeSession) → reload (triggers auto-resume into the transcript).
// Usage: node tools/check-gfx-images.js
const { chromium } = require("playwright");
const { makeWorld, makeSession } = require("./test-seeds.js");
const APP_URL = "http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html";
const b64url = (s) => Buffer.from(s, "utf8").toString("base64url");
const SHOT = "C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/";
require("fs").mkdirSync(SHOT, { recursive: true });
const problems = [];
const ok = (cond, msg) => { if (cond) console.log("  ok:", msg); else { problems.push(msg); console.log("  FAIL:", msg); } };

(async () => {
  const kv = new Map();
  const put = (folder, key, val) => kv.set(b64url(folder + "\u0000" + key) + ".json", JSON.stringify(val));
  const seed = () => {
    const s = makeSession();
    s.messages.push({ role: "narrator", text: [
      "You boot the terminal against the far wall. It flickers to life.",
      "",
      "<!-- GFX_START -->",
      '<div class="gfx-terminal">C:\\VAULT&gt; scan --sector 7',
      "SECTOR 7: 3 HOSTILES DETECTED",
      "ACCESS: GRANTED</div>",
      "<!-- GFX_END -->",
      "",
      "The screen confirms it. You spot a portrait pinned to the noticeboard:",
      "",
      "![Great Sage portrait](/user/images/Test/Great_Sage.png)",
      "",
      "And a rough sketch passed to you by a traveler:",
      "",
      "![](https://ella.janitorai.com/media-approved/UOwsuxUbwT61brx9RzhEx.webp)",
    ].join("\n") });
    s.messages.push({ role: "narrator", text: [
      "A hostile note is slipped under the door — someone testing you:",
      "",
      "<!-- GFX_START -->",
      '<div class="gfx-terminal">HACK ATTEMPT <img src=x onerror="window.__pwned=1"> and <script>window.__pwned2=1</script></div>',
      "<!-- GFX_END -->",
      "",
      "Also a suspicious sketch with a dangerous link:",
      "",
      "![](javascript:window.__pwned3=1)",
    ].join("\n") });
    s.messages.push({ role: "narrator", text: "Plain message with no panels or images — baseline control." });
    put("worlds", "wstress", makeWorld());
    put("worlds", "index", [{ id: "wstress", name: "Stress Test Valley", cover: "", tags: [], description: "test", nsfw: false, author: "", authorId: "", remix: null, origin: "", createdAt: "2026-01-01", updatedAt: "2026-01-01" }]);
    put("rpg", "sessions", [{ id: s.id, name: s.name, charName: "Wren", worldId: "wstress", worldName: "Stress Test Valley", turn: 11, lastUpdated: 1700000000000, avatar: "", portraitSig: "" }]);
    put("rpg", "session_" + s.id, s);
    put("rpg", "activeSession", s.id);
    return s;
  };
  seed();

  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 1100 } })).newPage();
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
  // [rpge-patch 021 followup] Serve a real 1x1 PNG at the fixture's /user/images/ path — that
  // URL used to point at a file that never existed on the server (404), so the <img> tag rendered
  // with correct src/alt attributes but loaded ZERO pixels. The old assertion only checked
  // getAttribute("src")/getAttribute("alt") and never noticed. This route makes the fixture honest
  // (real bytes, real load) without polluting the real user/images/ directory with test files.
  await page.route("**/user/images/**", async (r) => {
    const url = r.request().url();
    if (!/Great_Sage\.png/i.test(url)) return r.fulfill({ status: 404, body: "" });
    // Solid magenta 64x64 PNG (generated, real decodable pixels) — visible in screenshots so a
    // human eyeball can confirm the image displays, not just the automated naturalWidth check.
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAl0lEQVR4nO3QMREAIAzAwMrBv556ARk/kOH3XGbP3p+NDtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QGuADtAaoAO0BugArQE6QHvU5fKk1LXJBwAAAABJRU5ErkJggg==", "base64");
    return r.fulfill({ status: 200, contentType: "image/png", body: png });
  });

  // Boot once to get the app shell up (first boot's writes clobber activeSession).
  const bootOnce = async () => {
    await page.goto(APP_URL, { waitUntil: "load", timeout: 90000 });
    try {
      await page.waitForFunction(
        () => document.querySelector(".hn-item") || document.querySelector("#transcriptEl") || document.querySelector('textarea[placeholder*="What do you do"]'),
        { timeout: 90000 }
      );
      return true;
    } catch { return false; }
  };
  let booted = await bootOnce();
  for (let a = 0; a < 3 && !booted; a++) {
    console.log("boot flake, retry", a + 1);
    await page.waitForTimeout(3000);
    booted = await bootOnce();
  }
  if (!booted) throw new Error("app never booted");
  await page.waitForTimeout(4000);
  seed(); // re-seed after first boot's writes
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(
    () => document.querySelector("#transcriptEl"),
    { timeout: 120000 }
  );
  await page.waitForTimeout(8000);
  await page.evaluate(() => { const ov = [...document.querySelectorAll(".popup-overlay")].find(o => o.offsetParent); if (ov) { const b = [...ov.querySelectorAll("button")].find(b => b.offsetParent); b && b.click(); } });
  await page.waitForTimeout(500);

  console.log("1) GFX terminal panel renders as live HTML");
  const gfx = await page.evaluate(() => {
    const wraps = [...document.querySelectorAll(".gfx-wrap")];
    return {
      count: wraps.length,
      terminalText: wraps.map(w => w.textContent).join(" || "),
      firstTag: wraps[0] ? (wraps[0].firstElementChild ? wraps[0].firstElementChild.tagName.toLowerCase() : null) : null,
      hasLiteralAngleBrackets: wraps.some(w => w.textContent.includes("<div")),
    };
  });
  ok(gfx.count >= 1, `at least one .gfx-wrap rendered in the transcript (got ${gfx.count})`);
  ok(gfx.terminalText.includes("SECTOR 7: 3 HOSTILES DETECTED"), "terminal panel shows its inner text");
  ok(gfx.firstTag === "div", `gfx-wrap's first child is a real DOM element (div), not escaped text (got ${gfx.firstTag})`);
  ok(!gfx.hasLiteralAngleBrackets, "no literal '<div' text visible — markup was rendered, not escaped");

  console.log("2) inline images render (both URL forms)");
  const imgs = await page.evaluate(() => [...document.querySelectorAll(".msg-img")].map(i => ({ src: i.getAttribute("src"), alt: i.getAttribute("alt"), complete: i.complete, w: i.naturalWidth, h: i.naturalHeight })));
  ok(imgs.some(i => i.src === "/user/images/Test/Great_Sage.png" && i.alt.includes("Great Sage") && i.complete && i.w > 0 && i.h > 0), "/user/images/ path image rendered WITH real pixels loaded (complete=true, naturalWidth>0) — not just the right DOM attrs");
  ok(imgs.some(i => i.src.startsWith("https://ella.janitorai.com/") && i.complete && i.w > 0 && i.h > 0), "external https:// image rendered WITH real pixels loaded");
  ok(imgs.length >= 2, `at least 2 inline images rendered (got ${imgs.length})`);
  ok(imgs.every(i => i.complete && i.w > 0 && i.h > 0), `EVERY visible inline image actually loaded real pixels — zero silent broken images (checked: ${JSON.stringify(imgs.map(i => ({ src: i.src, w: i.w, h: i.h, complete: i.complete })))})`);

  console.log("3) hostile fixture leaks no executable payload");
  const hostile = await page.evaluate(() => ({
    pwned: window.__pwned, pwned2: window.__pwned2, pwned3: window.__pwned3,
    imgsOnerror: [...document.querySelectorAll(".gfx-wrap img[onerror]")].length,
    scriptTags: [...document.querySelectorAll(".gfx-wrap script")].length,
    jsSrcImgs: [...document.querySelectorAll(".msg-img")].filter(i => /^javascript:/i.test(i.getAttribute("src") || "")).length,
    badFallback: [...document.querySelectorAll(".msg-img-bad")].map(e => e.textContent).join(" || "),
    outerHtml: document.documentElement.outerHTML,
  }));
  ok(hostile.pwned === undefined && hostile.pwned2 === undefined && hostile.pwned3 === undefined, "no window.__pwned* flag set — XSS payloads never executed");
  ok(hostile.imgsOnerror === 0, "no img[onerror] survived the sanitizer");
  ok(hostile.scriptTags === 0, "no <script> tag survived the sanitizer");
  ok(hostile.jsSrcImgs === 0, "no msg-img carries a javascript: src");
  ok(hostile.badFallback.includes("javascript:"), "rejected javascript: URL degraded to visible literal text fallback");
  ok(!/<script>window\.__pwned2/.test(hostile.outerHtml) && !/onerror="window\.__pwned/.test(hostile.outerHtml), "raw payload strings absent from serialized DOM");

  await page.screenshot({ path: SHOT + "gz01-gfx-images-1500.png" });
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: SHOT + "gz02-gfx-images-1000.png" });

  await browser.close();
  if (problems.length) { console.log("\nPROBLEMS: " + problems.join(" | ")); process.exit(1); }
  console.log("\nGFX+IMAGES OK");
})().catch(e => { console.error("ERR", e.message); process.exit(1); });
