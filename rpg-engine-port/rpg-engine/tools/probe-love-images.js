// Read-only probe: does the Loreweaver page context load /user/images/* like /img/* ?
// Loads the root page, then creates Image() elements + fetch() for both paths and reports
// load status, response headers, and any console errors. NO data writes anywhere.
// Usage: node tools/probe-love-images.js
const { chromium } = require("playwright");
const ROOT = "http://127.0.0.1:8000/";

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  const consoleMsgs = [];
  page.on("console", m => { if (m.type() === "error" || m.type() === "warning") consoleMsgs.push(m.type() + ": " + m.text().slice(0, 200)); });
  page.on("response", r => {
    const u = r.url();
    if (/user\/images|\/img\//.test(u)) console.log("net:", r.status(), u.slice(0, 120));
  });

  await page.goto(ROOT, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(8000);
  const where = await page.evaluate(() => ({ url: location.href, title: document.title, hasChat: !!document.querySelector("#chat"), loginForm: !!document.querySelector("form") }));
  console.log("where:", JSON.stringify(where));

  // If login page, try logging in as the default user (read-only action; session only)
  if (where.loginForm && !where.hasChat) {
    const handleInput = page.locator('input[name="handle"], #handle, input[type="text"]').first();
    const handleVisible = await handleInput.isVisible().catch(() => false);
    console.log("login page detected, handle field visible:", handleVisible);
    if (handleVisible) {
      await handleInput.fill("default-user");
      const btn = page.locator('button[type="submit"], #loginButton, button:has-text("Login")').first();
      await btn.click().catch(() => {});
      await page.waitForTimeout(6000);
      console.log("after login:", JSON.stringify(await page.evaluate(() => ({ url: location.href, hasChat: !!document.querySelector("#chat") }))));
    }
  }

  // The actual probe: Image() load test for both paths, inside the real page context.
  const probe = await page.evaluate(async () => {
    const tryImg = (src) => new Promise((resolve) => {
      const img = new Image();
      const t0 = Date.now();
      img.onload = () => resolve({ src, ok: true, w: img.naturalWidth, h: img.naturalHeight, ms: Date.now() - t0 });
      img.onerror = () => resolve({ src, ok: false, ms: Date.now() - t0 });
      img.src = src;
    });
    const tryFetch = async (url) => {
      try {
        const r = await fetch(url, { method: "GET" });
        return { url, status: r.status, type: r.headers.get("content-type"), size: (await r.arrayBuffer()).byteLength };
      } catch (e) {
        return { url, error: String(e).slice(0, 120) };
      }
    };
    const results = {};
    results.img_userImages = await tryImg("/user/images/Test/Great_sage.png");
    results.img_public = await tryImg("/img/five.png");
    results.img_publicSvg = await tryImg("/img/ai4.png");
    results.fetch_userImages = await tryFetch("/user/images/Test/Great_sage.png");
    results.fetch_public = await tryFetch("/img/five.png");
    results.origin = location.origin;
    return results;
  });
  console.log("PROBE:", JSON.stringify(probe, null, 2));
  if (consoleMsgs.length) console.log("console:", consoleMsgs.slice(-10).join("\n"));
  await browser.close();
})().catch(e => { console.error("PROBE FAIL:", e); process.exit(1); });
