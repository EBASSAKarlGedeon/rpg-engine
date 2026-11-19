// Verifies the bridge end-to-end through the app's Settings → AI Model section [rpge-patch 018]: the section
// loads connection profiles from /api/settings/get, defaults to the SELECTED PROFILE, and the
// "Test call" goes through the mock Loreweaver server parameterised by the profile (api source,
// custom_url, model, secret_id, preset sampling). Also checks the key never leaves the server.
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
const PROFILE2 = {
  id: "prof-2", mode: "cc", api: "custom", name: "Cheap Profile",
  "api-url": "http://cheap.example/v1", model: "cheap-model",
  "secret-id": "sec-uuid-2", preset: "Cheap Preset", proxy: "None",
  "prompt-post-processing": "none",
};
const PROFILES = [PROFILE, PROFILE2];
const PRESETS = {
  "Test Preset": { temperature: 0.42, top_p: 0.9, frequency_penalty: 0.5 },
  "Cheap Preset": { temperature: 0.7, top_p: 0.95, frequency_penalty: 0.1 },
};

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
    // production: POST + CSRF (like the real endpoint); served to any logged-in session
    if (req.method === "POST") {
      let b = "";
      req.on("data", (c) => (b += c));
      return req.on("end", () => {
        const token = req.headers["x-csrf-token"];
        if (!cookies.sid || !sessions.has(cookies.sid) || token !== "csrf-" + cookies.sid) {
          res.writeHead(403); return res.end();
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          settings: { extension_settings: { connectionManager: { selectedProfile: PROFILE.id, profiles: PROFILES } } },
          openai_setting_names: Object.keys(PRESETS),
          openai_settings: Object.values(PRESETS).map((p) => JSON.stringify(p)),
        }));
      });
    }
    res.writeHead(404); return res.end();
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
        route: req.headers["x-rpge-route"] || "",
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

  // [rpge-patch 018] the bridge page is gone — its controls live in the app's Settings →
  // AI Model section now. The shim checks below (direct fetch + role matrix) are unchanged;
  // the UI part opens the app and drives that section instead.
  const url = `http://127.0.0.1:${STATIC_PORT}/index.html`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const problems = [];
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message.slice(0, 160)));
  // only local traffic
  await page.route("**/*", (r) => (/^http:\/\/127\.0\.0\.1/.test(r.request().url()) ? r.continue() : r.abort()));

  await page.goto(url);
  await page.waitForSelector(".hn-item, #transcriptEl", { timeout: 30000 });
  await page.waitForTimeout(1500);
  // open the Settings popup and switch to the AI Model section
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("mno:open-settings", { detail: {} })));
  await page.waitForSelector(".pf-md-nav", { timeout: 15000 });
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll(".pf-md-nav button, .pf-md-nav a")];
    const t = btns.find((x) => /AI Model/i.test(x.textContent || ""));
    if (t) t.click();
  });
  await page.waitForSelector(".pf-lw-profile", { timeout: 20000 });

  // the profile dropdown must be fed from /api/settings/get and default to the
  // selected profile (the section auto-picks it on first run)
  const opts = await page.$$eval(".pf-lw-profile option", (os) => os.map((o) => o.textContent));
  if (!opts.some((o) => /Mock Profile/.test(o))) problems.push("profile dropdown did not load: " + JSON.stringify(opts));
  const profVal = await page.$eval(".pf-lw-profile", (s) => s.value);
  if (profVal !== PROFILE.id) problems.push("profile did not default to the selected profile: " + profVal);
  const ctxVal = await page.$eval(".pf-lw-ctx", (s) => s.value);
  if (Number(ctxVal) !== 16384) problems.push("context budget default wrong: " + ctxVal);
  await page.click(".pf-lw-test");
  await page.waitForFunction(() => /Connected|✖/.test(document.querySelector(".pf-lw-status").textContent), { timeout: 15000 });
  const statusTxt = await page.$eval(".pf-lw-status", (e) => e.textContent);
  if (!/Connected/.test(statusTxt)) problems.push("test call failed: " + statusTxt);

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

  // ---- role matrix: map the "tracker" job to the cheap profile, then call again ----
  await page.evaluate(() => {
    const c = window.LoreweaverBridge.read();
    c.roles = { tracker: "prof-2" };
    window.LoreweaverBridge.write(c);
  });
  const routed = await page.evaluate(async () => {
    const call = (route) => fetch("http://placeholder.invalid/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer placeholder", "X-RPGE-Route": route },
      body: JSON.stringify({ model: "engine-model", stream: false, messages: [{ role: "user", content: "hi" }], max_tokens: 16 }),
    }).then((r) => r.status);
    return { tracker: await call("tracker"), gm: await call("gm") };
  });
  if (routed.tracker !== 200 || routed.gm !== 200) problems.push("role-routed calls failed: " + JSON.stringify(routed));

  // assertions on what the mock Loreweaver server saw: each call must have been
  // parameterised by the profile its JOB maps to (unrouted/test -> main profile).
  const EXPECT = { "": PROFILE, main: PROFILE, gm: PROFILE, tracker: PROFILE2 };
  if (CALL_LOG.length < 4) problems.push("expected 4 bridged calls, saw " + CALL_LOG.length);
  for (const c of CALL_LOG) {
    const p = EXPECT[c.route] || PROFILE;
    if (c.source !== p.api) problems.push("chat_completion_source wrong for route '" + c.route + "': " + c.source);
    if (c.custom_url !== p["api-url"]) problems.push("custom_url not from profile for route '" + c.route + "': " + c.custom_url);
    if (c.model !== p.model) problems.push("model not from profile for route '" + c.route + "': " + c.model);
    if (c.secret_id !== p["secret-id"]) problems.push("secret_id not from profile for route '" + c.route + "': " + c.secret_id);
    if (c.pageAuth) problems.push("placeholder Authorization reached the server (bridge did not strip it)");
    // preset sampling must be applied for fields the engine did not set, from the
    // ROLE's OWN profile preset (cheap profile's Cheap Preset for tracker calls).
    if (c.route === "tracker") {
      if (c.temperature !== 0.7) problems.push("cheap preset temperature not applied: " + c.temperature);
      if (c.top_p !== 0.95) problems.push("cheap preset top_p not applied: " + c.top_p);
    }
  }
  const nonStream = CALL_LOG.find((c) => !c.stream && (c.route === "" || c.route === "main"));
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

  const [shot] = process.argv.slice(2);
  console.log("calls:", JSON.stringify(CALL_LOG));
  if (shot) await page.screenshot({ path: shot });
  await browser.close();
  staticSrv.close();
  console.log(problems.length ? "PROBLEMS:\n - " + problems.join("\n - ") : "BRIDGE OK");
  process.exit(problems.length ? 1 : 0);
})();
