// Loreweaver bridge: route the engine's AI calls through the Loreweaver server
// instead of calling providers directly from the browser.
//
// HOW IT WORKS
//   Every OpenAI-compatible call the app makes is a POST to `<baseUrl>/chat/completions`
//   (main model, connection test, cheap model). This shim wraps window.fetch and, when
//   the bridge is enabled, rewrites those requests to the Loreweaver server endpoint
//   /api/backends/chat-completions/generate — parameterised by a CONNECTION PROFILE
//   from Loreweaver's Connection Manager (the same profiles the chat UI uses):
//       chat_completion_source: profile.api          (e.g. "custom")
//       custom_url:             profile["api-url"]   (overrides the engine's baseUrl)
//       model:                  profile.model        (overrides the engine's model)
//       secret_id:              profile["secret-id"] (the profile's own key, server-side)
//       custom_prompt_post_processing: profile["prompt-post-processing"]
//   The server resolves the API key from its secrets store by secret_id and streams the
//   upstream SSE back unchanged — the app's stream parser needs no changes. The API key
//   never reaches this page.
//
//   Optionally the profile's chat-completion PRESET (Settings > AI Response Configuration)
//   contributes its sampling params (temperature, top_p, top_k, frequency_penalty,
//   presence_penalty, …) for fields the engine did not set itself.
//
//   ROLE MATRIX (bridge v3): the engine tags every call with its job id (X-RPGE-Route
//   header, see PATCHES.md — gm/check/staging/tracker/npc/scene/memory/npclife/other).
//   cfg.roles maps a job id to a DIFFERENT profile id (e.g. trackers on a cheap model);
//   anything unmapped (or "main") uses the main profile. The cheap-model.html page's
//   whole job is the cheap secondary slot, so it is auto-tagged "cheap".
//
//   It must load BEFORE perchance-shim.js and src/scripts/main.js so the wrapper is
//   in place before any call site captures fetch.
//
// CONFIG
//   localStorage["rpge.loreweaverBridge"] = { enabled, profileId, usePreset, roles }
//   roles: { [jobId]: profileId } — jobs not listed use profileId. Configure it on
//   loreweaver-bridge.html (same folder as index.html).
//
// NOTES
//   - Only works when the app is served by the Loreweaver backend (same origin);
//     the bridge page verifies this. Standalone serving (python http.server) keeps
//     working with the bridge OFF.
//   - Text-completion profiles (mode "textgenerationwebui") are not supported yet —
//     the bridge errors with a clear message for those.
//   - Proxy presets (profile.proxy) are not applied yet.
//   - Body fields the Loreweaver endpoint does not whitelist (e.g. Ollama's `think`)
//     are dropped server-side; harmless.
(function () {
  "use strict";

  const CFG_KEY = "rpge.loreweaverBridge";
  const BRIDGE_PATH = "/api/backends/chat-completions/generate";
  const CHAT_RE = /\/chat\/completions\/?$/;
  const SETTINGS_TTL = 5 * 60 * 1000;

  // Engine job ids (AI_ROUTE_IDS in src/scripts/ai-provider.js) + the cheap secondary
  // model page. Labels are for the bridge config page only.
  const ROLE_IDS = ["gm", "check", "staging", "tracker", "npc", "scene", "memory", "npclife", "other", "cheap"];
  const ROLE_LABELS = {
    gm: "GM narration",
    check: "Skill checks",
    staging: "Scene manager",
    tracker: "Tracker updates",
    npc: "NPC generation",
    scene: "Scene image prompt",
    memory: "Memories",
    npclife: "NPC life sim",
    other: "Other engine calls",
    cheap: "Cheap secondary model",
  };

  // Which job does this fetch belong to? The engine tags its calls (patch 001);
  // the cheap-model page is wholesale the cheap slot; anything else is unrouted
  // (bridge page's own test, engine's connection test) and uses the main profile.
  function routeFromInit(input, init) {
    let v = "";
    try { if (init && init.headers) v = new Headers(init.headers).get("X-RPGE-Route") || ""; } catch (e) {}
    if (!v) { try { if (input && input.headers && input.headers.get) v = input.headers.get("X-RPGE-Route") || ""; } catch (e) {} }
    v = String(v).trim().toLowerCase();
    if (ROLE_IDS.includes(v)) return v;
    if (v === "main") return "main";
    if (/\/cheap-model\.html$/.test(location.pathname)) return "cheap";
    return "main";
  }

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

  // ---- Loreweaver connection profiles + presets (from /api/settings/get, cached) ----
  let settingsPromise = null;
  let settingsAt = 0;
  async function getLoreweaverSettings() {
    if (settingsPromise && Date.now() - settingsAt < SETTINGS_TTL) return settingsPromise;
    settingsAt = Date.now();
    settingsPromise = fetch(new URL("/api/settings/get", location.origin), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": await getToken() },
      body: JSON.stringify({}),
    })
      .then((r) => { if (!r.ok) throw new Error("/api/settings/get returned " + r.status); return r.json(); })
      .then((data) => {
        let settings = data.settings;
        if (typeof settings === "string") { try { settings = JSON.parse(settings); } catch (e) { settings = {}; } }
        const es = (settings && settings.extension_settings) || {};
        const cm = es.connectionManager || {};
        const profiles = Array.isArray(cm.profiles) ? cm.profiles : [];
        const names = Array.isArray(data.openai_setting_names) ? data.openai_setting_names : [];
        const raw = Array.isArray(data.openai_settings) ? data.openai_settings : [];
        const presets = {};
        names.forEach((name, i) => {
          try { presets[name] = typeof raw[i] === "string" ? JSON.parse(raw[i]) : raw[i]; } catch (e) {}
        });
        return { profiles, selectedProfile: cm.selectedProfile || null, presets, settings: data.settings || {}, parsed: settings || {} };
      })
      .catch((e) => { settingsPromise = null; throw e; });
    return settingsPromise;
  }

  const SAMPLER_KEYS = ["temperature", "top_p", "top_k", "top_a", "min_p",
    "frequency_penalty", "presence_penalty", "repetition_penalty"];

  // Map the engine's plain <baseUrl>/chat/completions call onto the chosen profile:
  // the call's job id picks cfg.roles[roleId] when set, else the main profile.
  async function buildBridgedPayload(url, payload, roleId) {
    const cfg = readCfg();
    const lw = await getLoreweaverSettings();
    if (!lw.profiles.length) throw new Error("No connection profiles in Loreweaver (Connection Manager is empty).");
    const roles = cfg.roles && typeof cfg.roles === "object" ? cfg.roles : {};
    const rolePid = roleId && roleId !== "main" ? String(roles[roleId] || "") : "";
    let profile = rolePid ? (lw.profiles.find((p) => p && p.id === rolePid) || null) : null;
    if (!profile) {
      profile = lw.profiles.find((p) => p && p.id === cfg.profileId)
        || lw.profiles.find((p) => p && p.id === lw.selectedProfile)
        || lw.profiles[0];
    }
    if (!profile) throw new Error("Selected connection profile not found in Loreweaver.");
    if (profile.mode && profile.mode !== "cc") {
      throw new Error('Profile "' + profile.name + '" is a text-completion profile — the bridge only supports chat-completion profiles.');
    }
    const out = Object.assign({}, payload);
    out.chat_completion_source = profile.api;
    out.custom_url = profile["api-url"];
    if (profile.model) out.model = profile.model; // the profile decides the model
    if (profile["secret-id"]) out.secret_id = profile["secret-id"];
    const post = profile["prompt-post-processing"];
    if (post && post !== "none") out.custom_prompt_post_processing = post;
    // Profile preset sampling: only fill fields the engine did not set itself.
    if (cfg.usePreset !== false && profile.preset && lw.presets[profile.preset]) {
      const preset = lw.presets[profile.preset];
      for (const k of SAMPLER_KEYS) {
        if (out[k] === undefined && typeof preset[k] === "number") out[k] = preset[k];
      }
    }
    return out;
  }

  // fetch-compatible call: (urlEndingInChatCompletions, init) -> Response
  async function bridgeFetch(url, init, input) {
    const roleId = routeFromInit(input, init);
    let payload = {};
    if (init && typeof init.body === "string") {
      try { payload = JSON.parse(init.body) || {}; } catch (e) { payload = {}; }
    }
    payload = await buildBridgedPayload(url, payload, roleId);
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
        return bridgeFetch(url, init, input);
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
  window.LoreweaverBridge = {
    read: readCfg, write: writeCfg, isEnabled, bridgeFetch, BRIDGE_PATH,
    getSettings: getLoreweaverSettings,
    ROLE_IDS, ROLE_LABELS,
  };
})();
