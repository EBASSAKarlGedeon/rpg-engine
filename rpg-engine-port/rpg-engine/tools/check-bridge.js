// Verifies the Loreweaver bridge shim end-to-end: loreweaver-bridge.html toggles the bridge,
// the "Test call" goes through the mock Loreweaver server, which injects the server-side key
// and streams the reply back. Also checks the key never leaves the server side.
//   node tools/check-bridge.js http://127.0.0.1:8765/loreweaver-bridge.html [screenshot.png]
// (the script itself starts a combined static + mock-Loreweaver server on 8765 — same origin,
//  like production where the Loreweaver backend serves the app)
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const APP_ROOT = path.join(__dirname, "..", "app");
const STATIC_PORT = 8765;
const CALL_LOG = [];

// ---- static server for app/ + mock Loreweaver backend on the SAME origin (as in production:
//      the app is served by the Loreweaver server itself). Upstream "provider" is simulated
//      inline (no second server needed): the mock injects the server-side key and streams SSE.
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml" };
const sessions = new Set();
const staticSrv = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const cookies = Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map((c) => {
    const i = c.indexOf("="); return [c.slice(0, i).trim(), c.slice(i + 1)];
  }));
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/csrf-token") {
    const sid = cookies.sid || ("S" + Math.random().toString(36).slice(2));
    sessions.add(sid);
    res.setHeader("Set-Cookie", "sid=" + sid + "; Path=/");
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ token: "csrf-" + sid }));
  }
  if (url.pathname === "/api/backends/chat-completions/generate" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const j = JSON.parse(body || "{}");
      // simulate csrf-sync-protection: session cookie + X-CSRF-Token must match
      const sid = cookies.sid, token = req.headers["x-csrf-token"];
      if (!sid || !sessions.has(sid) || token !== "csrf-" + sid) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "Invalid CSRF token" } }));
      }
      if (j.chat_completion_source !== "custom" || !j.custom_url) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "missing custom source/url" } }));
      }
      CALL_LOG.push({
        custom_url: j.custom_url,
        model: j.model,
        stream: !!j.stream,
        max_tokens: j.max_tokens,
        stop: j.stop,
        pageAuth: req.headers.authorization === "Bearer placeholder",
      });
      // in production the server forwards to {custom_url}/chat/completions with the real
      // key; here we just answer like a provider would.
      const text = "OK";
      if (j.stream) {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        for (const p of text.match(/[\s\S]{1,8}/g) || [text]) {
          res.write("data: " + JSON.stringify({ choices: [{ delta: { content: p } }] }) + "\n\n");
        }
        res.write("data: [DONE]\n\n");
        return res.end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] }));
    });
    return;
  }
  const p = path.join(APP_ROOT, decodeURIComponent(url.pathname));
  if (!p.startsWith(APP_ROOT)) { res.writeHead(403); return res.end(); }
  fs.readFile(p, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(data);
  });
});

(async () => {
  await new Promise((r) => staticSrv.listen(STATIC_PORT, "127.0.0.1", r));

  const [givenUrl, shot] = process.argv.slice(2);
  const url = givenUrl || `http://127.0.0.1:${STATIC_PORT}/loreweaver-bridge.html`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 160)));
  // only local traffic
  await page.route("**/*", (r) => (/^http:\/\/127\.0\.0\.1/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.addInitScript(() => {
    localStorage.setItem("mno.aiProvider", JSON.stringify({
      provider: "openai", providers: { openai: { baseUrl: "http://127.0.0.1:8769/v1", model: "mock-main" } },
    }));
    localStorage.setItem("mno.aiProviderKey", JSON.stringify({ openai: "placeholder" }));
  });

  await page.goto(url);
  await page.waitForTimeout(400);

  // the config page itself: toggle on, save, run the built-in test
  await page.locator("#enabled").check();
  await page.locator("#save").click();
  const stateTxt = await page.locator("#state").textContent();
  if (!/on/i.test(stateTxt)) problems.push("state did not show ON after save");
  await page.locator("#test").click();
  await page.waitForTimeout(2500);
  const msg = await page.locator("#msg").textContent();
  if (!/Connected through Loreweaver/i.test(msg)) problems.push("test call failed: " + JSON.stringify(msg));

  // and the same flow through a plain page fetch (what ai-provider.js does)
  const direct = await page.evaluate(async () => {
    const res = await fetch("http://127.0.0.1:8769/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer placeholder" },
      body: JSON.stringify({ model: "mock-stream", stream: true, messages: [{ role: "user", content: "hi" }], max_tokens: 16, stop: ["\n\n"] }),
    });
    const text = await res.text();
    return { status: res.status, streamOk: /"delta"/.test(text) && /\[DONE\]/.test(text) };
  });
  if (direct.status !== 200 || !direct.streamOk) problems.push("raw bridged stream failed: " + JSON.stringify(direct));

  // assertions on what the mock Loreweaver server saw
  if (!CALL_LOG.length) problems.push("no calls reached the mock Loreweaver server");
  for (const c of CALL_LOG) {
    if (c.custom_url !== "http://127.0.0.1:8769/v1") problems.push("custom_url wrong: " + c.custom_url);
    if (c.model !== "mock-main" && c.model !== "mock-stream") problems.push("model wrong: " + c.model);
  }

  // the page must never talk to the provider directly (route blocking would abort it);
  // prove the shim dropped the placeholder Authorization before sending (server logged it)
  const sawPlaceholder = CALL_LOG.some((c) => c.pageAuth);
  // NOTE: the mock treats the header the PAGE sent as "pageAuth"; the bridge should strip it,
  // so pageAuth must be false (the server-side key is injected by the real backend).
  if (sawPlaceholder) problems.push("placeholder Authorization reached the server (bridge did not strip it)");

  console.log("calls:", JSON.stringify(CALL_LOG));
  if (shot) await page.screenshot({ path: shot });
  await browser.close();
  staticSrv.close();
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "BRIDGE OK");
  process.exit(problems.length ? 1 : 0);
})();
