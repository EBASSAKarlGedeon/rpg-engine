// Verifies the Loreweaver bridge shim end-to-end: loreweaver-bridge.html loads connection
// profiles from /api/settings/get, the "Test call" goes through the mock Loreweaver server,
// and the request is parameterised by the SELECTED PROFILE (api source, custom_url, model,
// secret_id, preset sampling). Also checks the key never leaves the server side.
//   node tools/check-bridge.js [screenshot.png]
// (the script starts a combined static + mock-Loreweaver server on 8765 — same origin, like
//  production where the Loreweaver backend serves the app)
const { chromium } = require("playwright");
const http = require("http");
const fs = require("fs");
const path = require("path");

const APP_ROOT = path.join(__dirname, "..", "app");
const STATIC_PORT = 8765;
const CALL_LOG = [];

const PROFILE = {
  id: "prof-1", mode: "cc", api: "custom", name: "Mock Profile",
  "api-url": "http://upstream.example/v1", model: "profile-model",
  "secret-id": "sec-uuid-1", preset: "Test Preset", proxy: "None",
  "prompt-post-processing": "none",
};
const PRESETS = { "Test Preset": { temperature: 0.42, top_p: 0.9, frequency_penalty: 0.5 } };

// ---- static server for app/ + mock Loreweaver backend on the SAME origin (as in production:
//      the app is served by the Loreweaver server itself) ----
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
  if (url.pathname === "/api/settings/get") {
    // production: served to any logged-in session; not CSRF-gated (GET)
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({
      settings: { extension_settings: { connectionManager: { selectedProfile: PROFILE.id, profiles: [PROFILE] } } },
      openai_setting_names: Object.keys(PRESETS),
      openai_settings: Object.values(PRESETS).map((p) => JSON.stringify(p)),
    }));
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
      CALL_LOG.push({
        source: j.chat_completion_source,
        custom_url: j.custom_url,
        model: j.model,
        secret_id: j.secret_id,
        max_tokens: j.max_tokens,
        temperature: j.temperature,
        top_p: j.top_p,
        frequency_penalty: j.frequency_penalty,
        stream: !!j.stream,
        pageAuth: req.headers.authorization === "Bearer placeholder",
      });
      // in production the server looks up the key by secret_id and forwards to
      // {custom_url}/chat/completions; here we just answer like a provider would.
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

  const [shot] = process.argv.slice(2);
  const url = `http://127.0.0.1:${STATIC_PORT}/loreweaver-bridge.html`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 160)));
  // only local traffic
  await page.route("**/*", (r) => (/^http:\/\/127\.0\.0\.1/.test(r.request().url()) ? r.continue() : r.abort()));
  await page.addInitScript(() => {
    localStorage.setItem("mno.aiProvider", JSON.stringify({
      provider: "openai", providers: { openai: { baseUrl: "http://placeholder.invalid/v1", model: "engine-model" } },
    }));
    localStorage.setItem("mno.aiProviderKey", JSON.stringify({ openai: "placeholder" }));
  });

  await page.goto(url);
  await page.waitForTimeout(500);

  // the config page itself: profile dropdown loaded, toggle on, save, run the built-in test
  const opt = await page.locator("#profile option").first().textContent();
  if (!/Mock Profile/.test(opt)) problems.push("profile dropdown did not load: " + JSON.stringify(opt));
  await page.locator("#enabled").check();
  await page.locator("#save").click();
  const stateTxt = await page.locator("#state").textContent();
  if (!/on/i.test(stateTxt)) problems.push("state did not show ON after save");
  await page.locator("#test").click();
  await page.waitForTimeout(2500);
  const msg = await page.locator("#msg").textContent();
  if (!/Connected through Loreweaver/i.test(msg)) problems.push("test call failed: " + JSON.stringify(msg));

  // and the same flow through a plain page fetch (what ai-provider.js does): engine asks for
  // its own baseUrl/model, the bridge must replace them with the profile's.
  const direct = await page.evaluate(async () => {
    const res = await fetch("http://placeholder.invalid/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer placeholder" },
      body: JSON.stringify({ model: "engine-model", stream: true, messages: [{ role: "user", content: "hi" }], max_tokens: 16, stop: ["\n\n"] }),
    });
    const text = await res.text();
    return { status: res.status, streamOk: /"delta"/.test(text) && /\[DONE\]/.test(text) };
  });
  if (direct.status !== 200 || !direct.streamOk) problems.push("raw bridged stream failed: " + JSON.stringify(direct));

  // assertions on what the mock Loreweaver server saw
  if (CALL_LOG.length < 2) problems.push("expected 2 bridged calls, saw " + CALL_LOG.length);
  for (const c of CALL_LOG) {
    if (c.source !== "custom") problems.push("chat_completion_source wrong: " + c.source);
    if (c.custom_url !== PROFILE["api-url"]) problems.push("custom_url not from profile: " + c.custom_url);
    if (c.model !== "profile-model") problems.push("model not from profile: " + c.model);
    if (c.secret_id !== "sec-uuid-1") problems.push("secret_id not from profile: " + c.secret_id);
    if (c.pageAuth) problems.push("placeholder Authorization reached the server (bridge did not strip it)");
  }
  const nonStream = CALL_LOG.find((c) => !c.stream);
  if (nonStream) {
    // preset sampling must be applied for fields the engine did not set
    if (nonStream.temperature !== 0.42) problems.push("preset temperature not applied: " + nonStream.temperature);
    if (nonStream.top_p !== 0.9) problems.push("preset top_p not applied: " + nonStream.top_p);
    if (nonStream.frequency_penalty !== 0.5) problems.push("preset frequency_penalty not applied: " + nonStream.frequency_penalty);
  }
  const stream = CALL_LOG.find((c) => c.stream);
  if (stream && stream.temperature !== undefined) {
    // the engine set no temperature here either, so the preset should apply too
    if (stream.temperature !== 0.42) problems.push("preset temperature missing on stream call: " + stream.temperature);
  }

  console.log("calls:", JSON.stringify(CALL_LOG));
  if (shot) await page.screenshot({ path: shot });
  await browser.close();
  staticSrv.close();
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "BRIDGE OK");
  process.exit(problems.length ? 1 : 0);
})();
