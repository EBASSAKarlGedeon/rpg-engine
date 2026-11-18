// Loreweaver bridge: route the engine's AI calls through the Loreweaver server
// instead of calling providers directly from the browser.
//
// HOW IT WORKS
//   Every OpenAI-compatible call the app makes is a POST to `<baseUrl>/chat/completions`
//   (main model, connection test, cheap model). This shim wraps window.fetch and, when
//   the bridge is enabled, rewrites those requests to the Loreweaver server endpoint
//   /api/backends/chat-completions/generate with:
//       chat_completion_source: "custom"   (or the configured source)
//       custom_url: <the original baseUrl>
//   The Loreweaver server then resolves the API key from ITS OWN secrets store
//   (Settings -> API Keys -> Custom) and streams the upstream SSE back unchanged —
//   the app's stream parser needs no changes. The API key never reaches this page.
//
//   It must load BEFORE perchance-shim.js and src/scripts/main.js so the wrapper is
//   in place before any call site captures fetch.
//
// CONFIG
//   localStorage["rpge.loreweaverBridge"] = { enabled: true, source: "custom" }
//   Configure it on loreweaver-bridge.html (same folder as index.html).
//
// NOTES
//   - Only works when the app is served by the Loreweaver backend (same origin);
//     the bridge page verifies this. Standalone serving (python http.server) keeps
//     working with the bridge OFF.
//   - The engine's own "API key" field becomes a placeholder when the bridge is on
//     (any non-empty string) — the real key is applied server-side.
//   - Body fields the Loreweaver endpoint does not whitelist (e.g. Ollama's `think`)
//     are dropped server-side; harmless.
(function () {
  "use strict";

  const CFG_KEY = "rpge.loreweaverBridge";
  const BRIDGE_PATH = "/api/backends/chat-completions/generate";
  const CHAT_RE = /\/chat\/completions\/?$/;

  function readCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      return c && typeof c === "object" ? c : {};
    } catch (e) { return {}; }
  }
  function writeCfg(cfg) {
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg || {})); } catch (e) {}
  }
  const isEnabled = () => readCfg().enabled === true;

  // Session CSRF token: Loreweaver issues one per session at /csrf-token and
  // requires it as the X-CSRF-Token header on every POST.
  let tokenPromise = null;
  const getToken = () => {
    if (!tokenPromise) {
      tokenPromise = fetch(new URL("/csrf-token", location.origin), { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error("/csrf-token returned " + r.status); return r.json(); })
        .then((j) => { if (!j || !j.token) throw new Error("/csrf-token returned no token"); return j.token; })
        .catch((e) => { tokenPromise = null; throw e; });
    }
    return tokenPromise;
  };

  // fetch-compatible call: (urlEndingInChatCompletions, init) -> Response
  async function bridgeFetch(url, init) {
    const base = String(url).replace(CHAT_RE, "").replace(/\/+$/, "");
    let payload = {};
    if (init && typeof init.body === "string") {
      try { payload = JSON.parse(init.body) || {}; } catch (e) { payload = {}; }
    }
    payload.chat_completion_source = payload.chat_completion_source || readCfg().source || "custom";
    payload.custom_url = base;
    const bodyJson = JSON.stringify(payload);

    const headers = new Headers((init && init.headers) || null);
    headers.delete("Authorization"); // the server applies the real key
    headers.set("X-CSRF-Token", await getToken());
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

    const send = () => fetch(new URL(BRIDGE_PATH, location.origin),
      Object.assign({}, init, { headers, credentials: "include", body: bodyJson }));
    let res = await send();
    if (res.status === 403) {
      // Session CSRF token rotated (e.g. relogin) — refresh once and retry.
      tokenPromise = null;
      headers.set("X-CSRF-Token", await getToken());
      res = await send();
    }
    return res;
  }

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    let url = "";
    try {
      if (typeof input === "string") url = input;
      else if (input instanceof URL) url = String(input);
      else if (input && input.url) url = input.url;
      const method = String((init && init.method) || (input && input.method) || "GET").toUpperCase();
      if (isEnabled() && method === "POST" && CHAT_RE.test(url)) {
        return bridgeFetch(url, init);
      }
    } catch (e) {
      console.error("Loreweaver bridge:", e);
      // Surface a clear failure rather than silently calling the provider with a
      // placeholder key. Throw only for bridged calls that already decided to bridge.
      if (isEnabled() && /\/chat\/completions\/?$/.test(url) && String((init && init.method) || "GET").toUpperCase() === "POST") {
        return Promise.reject(new Error("Loreweaver bridge failed: " + (e && e.message || e)));
      }
    }
    return origFetch(input, init);
  };

  // console + config-page API
  window.LoreweaverBridge = { read: readCfg, write: writeCfg, isEnabled, bridgeFetch, BRIDGE_PATH };
})();
