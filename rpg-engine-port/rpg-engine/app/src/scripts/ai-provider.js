// [rpge-patch 018] Loreweaver-native text AI. This module used to host five text
// providers (Perchance AI + four BYOK endpoints) with a Perchance fallback behind
// every route toggle; that whole layer is gone. Text AI now has ONE path: the
// Loreweaver bridge (app/shims/loreweaver-bridge.js), which maps every
// chat-completions call onto a Connection Manager profile — endpoint, model and
// API key resolved SERVER-side. Loreweaver is where AI model config is made; the
// game only picks profiles. See PATCHES.md [rpge-patch 018].
import { switchEl } from "./search-bar.js";
import { infoTipLabelHtml } from "./info-tip.js";

const CFG_KEY = "mno.aiProvider";
const KEY_KEY = "mno.aiProviderKey"; // shared with the image providers (Settings → Image Gen BYOK)
// The Perchance root generateText, captured at module load (boot.js sets window.genText
// before main.js replaces it with routedGenText). Kept ONLY for the token-counter meta
// probe: context-budget.js and ctx-meter.js call genText({ getMetaObject: true }) to reach
// the plugin's tokenizer, and the app's own counter rides the same object.
const rootGenText = window.genText;

const PROVIDERS = [
  { id: "loreweaver", label: "Loreweaver", baseUrl: location.origin + "/v1", model: "loreweaver", noKey: true }
];

function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0];
}

// First-run default: the bridge is ALWAYS on (profiles-only AI, no off state). Without
// this a fresh browser's calls would 404 until the user opened Settings once. The shim
// resolves an empty profileId to Loreweaver's selected profile, so zero config works.
(function bridgeDefaultOn() {
  try {
    const B = window.LoreweaverBridge;
    if (!B || typeof B.read !== "function") return;
    const c = B.read() || {};
    if (c.enabled === true) return;
    B.write(Object.assign({ enabled: true, usePreset: true, contextTokens: 16384 }, c));
  } catch (e) {}
})();

function readStore() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem(CFG_KEY) || "{}") || {}; } catch (e) {}
  // Old stores (any provider) collapse to loreweaver — the only provider now.
  return {
    provider: "loreweaver",
    profileName: typeof s.profileName === "string" ? s.profileName : "",
    allowReasoning: s.allowReasoning === true,
    thinkingBudget: sanitizeBudget(s.thinkingBudget),
    useExternal: sanitizeUseExternal(s.useExternal)
  };
}

function writeStore(store) {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(store)); } catch (e) {}
}

function sanitizeBudget(v) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return 256;
  return Math.min(128000, Math.max(1, n));
}

// Per-call routing: which jobs may ride the bridge at all. Every text-AI call
// carries a `route` id (see AI_ROUTE_IDS); the Settings → AI Model toggles decide
// per route, and a job switched off DOESN'T RUN (there is no fallback provider
// anymore). Unknown/missing routes ride "other".
export const AI_ROUTE_IDS = ["gm", "check", "staging", "tracker", "npc", "scene", "memory", "npclife", "other"];
export const AI_ROUTE_LABELS = {
  gm: "GM",
  check: "Skill checks",
  staging: "Scene manager",
  tracker: "Trackers",
  npc: "NPC generation",
  scene: "Scene image prompt",
  memory: "Memories",
  npclife: "NPC life sim",
  other: "Other"
};
export const AI_ROUTE_HINTS = {
  gm: "Story narration and dialogues.",
  check: "Stat-based check referee before GM call.",
  staging: "Keeps track of who is in the scene, so the story gives the right characters attention.",
  tracker: "Hero + NPC tracker updates after each turn.",
  npc: "In-session NPC profiles and portrait backdrops.",
  scene: "Scene-image prompt writer.",
  memory: "Session memory roll-ups (the digest written every few turns).",
  npclife: "Off-screen NPC life simulation ticks.",
  other: "Everything else: map, hero creation, world editor + crafting, imports."
};

function sanitizeUseExternal(v) {
  const o = v && typeof v === "object" ? v : {};
  const out = {};
  for (const id of AI_ROUTE_IDS) out[id] = o[id] !== false;
  return out;
}

// ---- shared per-provider API keys (IMAGE providers only since patch 018) ----

function readKeys() {
  let raw = "";
  try { raw = localStorage.getItem(KEY_KEY) || ""; } catch (e) {}
  if (raw.trim().startsWith("{")) {
    try {
      const j = JSON.parse(raw) || {};
      const out = {};
      for (const k of Object.keys(j)) {
        if (typeof j[k] === "string" && j[k]) out[k] = j[k];
      }
      return out;
    } catch (e) {}
  }
  return {};
}

function writeKeys(map) {
  try {
    const ids = Object.keys(map || {}).filter((k) => map[k]);
    if (!ids.length) localStorage.removeItem(KEY_KEY);
    else localStorage.setItem(KEY_KEY, JSON.stringify(map));
  } catch (e) {}
}

export function getAiKeyFor(id) {
  return readKeys()[id] || "";
}

// Shared-key writer for the image provider (Settings → Image Gen keeps its own
// model/baseUrl store but the same key map, so one key serves both).
export function setAiKeyFor(id, key) {
  const keys = readKeys();
  if (key) keys[id] = key;
  else delete keys[id];
  writeKeys(keys);
}

// ---- config ---------------------------------------------------------------

export function getAiConfig() {
  const store = readStore();
  const preset = getProvider("loreweaver");
  return {
    provider: "loreweaver",
    baseUrl: preset.baseUrl,
    model: preset.model,
    profileName: store.profileName,
    useExternal: sanitizeUseExternal(store.useExternal)
  };
}

export function saveAiConfig(cfg) {
  const store = readStore();
  if (cfg && cfg.profileName !== undefined) store.profileName = String(cfg.profileName || "");
  if (cfg && cfg.useExternal !== undefined) store.useExternal = sanitizeUseExternal(Object.assign({}, store.useExternal, cfg.useExternal));
  writeStore(store);
  return getAiConfig();
}

export function aiActiveProvider() {
  return "loreweaver";
}

// Cheap bool for engine-side budget switches (roll-up chunking, etc.). With Perchance
// gone there IS no small-window provider: every active call rides a real profile, so
// this is always false (big windows — don't multiply calls). The functions stay
// exported because memory-system.js and rp-engine.js fail-safe probe them.
export function isPerchanceAI() {
  return false;
}

export function isPerchanceAIFor(route) {
  return false;
}

// Per-route switch: true when THIS route's calls may run (route toggle on). GM
// trimming, memory/lore caps and tracker output caps read this. A route switched
// off simply doesn't run — there is no Perchance fallback to budget for.
export function routeUsesExternal(route) {
  try {
    if (bridgedInputCap() !== null) return true;
    if (!AI_ROUTE_IDS.includes(route)) route = "other";
    return getAiConfig().useExternal[route] !== false;
  } catch (e) { return false; }
}

// [rpge-patch 006] The input-token budget the engine should assume for bridged calls.
// Read from the bridge config (`contextTokens`, set in Settings → AI Model — default
// 16384), clamped to a sane range. Returns null only when the bridge config is
// disabled (hand-edited) — callers keep their legacy behavior.
export function bridgedInputCap() {
  try {
    const c = JSON.parse(localStorage.getItem("rpge.loreweaverBridge") || "null");
    if (!c || c.enabled !== true) return null;
    const n = Number(c.contextTokens);
    return Number.isFinite(n) && n >= 2048 ? Math.min(200000, Math.round(n)) : 16384;
  } catch (e) { return null; }
}

// Close-time gate for the Settings panel. Nothing to block anymore: AI Model has no
// key to forget and no fallback to revert to — a missing profile shows its own
// empty state and call sites error with a clear message. (The IMAGE side keeps its
// own blocker in image-provider.js.)
export function aiCloseBlocker() {
  return null;
}

export function aiModelLabel() {
  const store = readStore();
  return "Loreweaver · " + (store.profileName || "no profile yet");
}

// ---- the call path --------------------------------------------------------

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(new Error("Could not read attached image."));
    r.readAsDataURL(blob);
  });
}

function normalizeInput(inputData, extraOpts) {
  if (typeof inputData === "string" || inputData instanceof String) {
    const o = { instruction: inputData + "" };
    if (extraOpts) for (const k of ["startWith", "stopSequences", "hideStartWith", "onChunk", "onStart", "onFinish"]) {
      if (extraOpts[k] !== undefined) o[k] = extraOpts[k];
    }
    return o;
  }
  const o = Object.assign({}, inputData || {});
  if (typeof o.instruction !== "string" && !Array.isArray(o.instruction)) o.instruction = "Write something.";
  return o;
}

async function instructionToContent(instruction) {
  if (!Array.isArray(instruction)) return String(instruction ?? "");
  const texts = [];
  const images = [];
  for (const p of instruction) {
    if (typeof Blob !== "undefined" && p instanceof Blob) images.push(await blobToDataUrl(p));
    else texts.push(String(p ?? ""));
  }
  if (!images.length) return texts.join("");
  const content = [];
  if (texts.join("").trim()) content.push({ type: "text", text: texts.join("") });
  for (const url of images) content.push({ type: "image_url", image_url: { url } });
  return content;
}

// Cap the completion length from the call's `maxTokens` (see call table in the README).
function maxTokensFor(norm) {
  const n = parseInt(norm && norm.maxTokens, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(128000, Math.max(1, n));
}

// The one text path: POST to `<origin>/v1/chat/completions`, which the bridge shim
// (window.fetch wrapper) rewrites to the Loreweaver server with the chosen profile.
// The API key never touches the page. Streaming SSE comes back unchanged from the
// server, so this parser is the shim-era one, minus the BYOK branches.
function bridgeGenText(norm, route) {
  const headers = { "Content-Type": "application/json" };
  // [rpge-patch 001] carry the call's job id on the request so the bridge shim can
  // route per job (main profile for unmapped roles).
  headers["X-RPGE-Route"] = AI_ROUTE_IDS.includes(route) ? route : "other";
  const ctrl = new AbortController();
  let activeReader = null;
  const startWith = typeof norm.startWith === "string" ? norm.startWith : "";
  const prefix = startWith && !norm.hideStartWith ? startWith : "";
  let acc = prefix;
  let generated = "";
  const finishData = () => {
    const out = new String(acc);
    out.text = acc;
    out.generatedText = generated;
    return out;
  };
  const fire = (textChunk) => {
    if (norm.onChunk) {
      try { norm.onChunk({ fullTextSoFar: acc, textChunk }); } catch (e) { console.error("Error in onChunk:", e); }
    }
  };
  const p = (async () => {
    if (norm.onStart) {
      try { norm.onStart(p); } catch (e) { console.error(e); }
    }
    if (prefix) fire(prefix);
    const userContent = await instructionToContent(norm.instruction);
    const messages = [{ role: "user", content: userContent }];
    if (startWith) messages.push({ role: "assistant", content: startWith });
    const body = { model: "loreweaver", messages, stream: true };
    const cap = maxTokensFor(norm);
    if (cap > 0) body.max_tokens = cap;
    if (Array.isArray(norm.stopSequences) && norm.stopSequences.length) body.stop = norm.stopSequences.slice(0, 4);
    else if (typeof norm.stopSequences === "string" && norm.stopSequences) body.stop = [norm.stopSequences];
    const post = (b) => fetch(getProvider("loreweaver").baseUrl + "/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(b),
      signal: ctrl.signal
    });
    let res;
    try {
      res = await post(body);
    } catch (e) {
      if (e && e.name === "AbortError") return finishData();
      throw new Error("Could not reach the Loreweaver bridge: " + (e.message || e) +
        " — is the Loreweaver server running, and is a connection profile chosen (Settings → AI Model)?");
    }
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      const j = await res.json();
      const txt = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "") : "";
      if (txt) { generated += txt; acc += txt; fire(txt); }
    } else {
      const reader = res.body.getReader();
      activeReader = reader;
      const dec = new TextDecoder();
      let buf = "";
      const STALL_MS = 90000;
      const ABS_MS = 300000;
      const startAt = Date.now();
      const stall = Symbol("stall");
      let stalled = false;
      let streamDone = false;
      for (;;) {
        let chunk;
        try {
          chunk = await Promise.race([
            reader.read(),
            new Promise((_, rej) => setTimeout(() => rej(stall), STALL_MS))
          ]);
        } catch (e) {
          if (e === stall || (e && e.name === "AbortError")) {
            stalled = stalled || e === stall;
            try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (e2) {}
            break;
          }
          throw e;
        }
        const { done, value } = chunk;
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split("\n\n");
        buf = events.pop();
        for (const ev of events) {
          for (const line of ev.split("\n")) {
            const t = line.trim();
            if (!t.startsWith("data:")) continue;
            const payload = t.slice(5).trim();
            if (payload === "[DONE]") { streamDone = true; break; }
            let j = null;
            try { j = JSON.parse(payload); } catch (e) { continue; }
            const piece = j && j.choices && j.choices[0] && j.choices[0].delta ? j.choices[0].delta.content : "";
            if (piece) { generated += piece; acc += piece; fire(piece); }
          }
          if (streamDone) break;
        }
        if (streamDone) break;
        if (Date.now() - startAt > ABS_MS) {
          try { Promise.resolve(reader.cancel()).catch(() => {}); } catch (e) {}
          break;
        }
      }
      if (stalled && !generated && !prefix) throw new Error("The model stopped responding mid-reply (no data for 90s).");
    }
    if (!res.ok) {
      let detail = res.status + " " + res.statusText;
      try {
        const j = await res.json();
        if (j && j.error && j.error.message) detail = j.error.message;
      } catch (e) {}
      if (res.status === 404) detail += " — the bridge only works when the app is served by the Loreweaver server.";
      throw new Error("Loreweaver bridge error: " + detail);
    }
    const out = finishData();
    if (norm.onFinish) {
      try { norm.onFinish(out); } catch (e) { console.error("error in onFinish:", e); }
    }
    return out;
  })();
  p.stop = () => {
    try { ctrl.abort(); } catch (e) {}
    try { if (activeReader) Promise.resolve(activeReader.cancel()).catch(() => {}); } catch (e) {}
    return p;
  };
  return p;
}

export function routedGenText(inputData, extraOpts) {
  // Token-counter meta probe (context-budget.js / ctx-meter.js): delegate to the
  // engine-native root's meta object — nothing rides the bridge for counting.
  if (inputData && typeof inputData === "object" && inputData.getMetaObject === true) {
    return rootGenText(inputData, extraOpts);
  }
  // Per-route toggle: a call switched off doesn't run — there is no fallback
  // provider. Callers already catch per-job failures (trackers, memory, checks
  // log and skip; the GM turn shows the failure toast).
  let route = "other";
  if (extraOpts && typeof extraOpts === "object" && typeof extraOpts.route === "string") route = extraOpts.route;
  const plainObj = inputData && typeof inputData === "object" && !Array.isArray(inputData) && !(inputData instanceof String);
  if (plainObj && typeof inputData.route === "string") route = inputData.route;
  if (!AI_ROUTE_IDS.includes(route)) route = "other";
  let cleanInput = inputData, cleanExtra = extraOpts;
  if (plainObj && ("route" in inputData)) { cleanInput = Object.assign({}, inputData); delete cleanInput.route; }
  if (extraOpts && typeof extraOpts === "object" && ("route" in extraOpts)) { cleanExtra = Object.assign({}, extraOpts); delete cleanExtra.route; }
  if (!routeUsesExternal(route)) {
    throw new Error((AI_ROUTE_LABELS[route] || route) + " is switched off (Settings → AI Model → External AI calls), so this job did not run.");
  }
  return bridgeGenText(normalizeInput(cleanInput, cleanExtra), route);
}

// One real turn through the bridge with the MAIN profile — the AI Model section's
// Test call. Same URL shape as a real call, so the shim rewrites it identically.
export async function testBridgeConnection() {
  const res = await fetch(getProvider("loreweaver").baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "loreweaver", messages: [{ role: "user", content: "Reply with exactly: OK" }], max_tokens: 5, stream: false })
  });
  if (!res.ok) {
    let detail = res.status + " " + res.statusText;
    try {
      const j = await res.json();
      if (j && j.error && j.error.message) detail = j.error.message;
    } catch (e) {}
    if (res.status === 404) detail += " — the bridge only works when the app is served by the Loreweaver server.";
    throw new Error(detail);
  }
  const j = await res.json();
  const txt = j && j.choices && j.choices[0] && j.choices[0].message ? String(j.choices[0].message.content || "").trim() : "";
  return txt || "OK";
}

// ---- Settings → AI Model section ------------------------------------------

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function aiModelSection() {
  const sec = document.createElement("section");
  sec.className = "pf-sec";
  sec.innerHTML = `
    <style>
      .pf-lw-profrow { flex-wrap: nowrap; align-items: center; }
      .pf-lw-profrow select { max-width: 260px; flex: 1; min-width: 0; }
      .pf-lw-refresh { flex: none; }
      .pf-lw-profinfo { font-size: 12px; color: var(--muted); margin: 6px 0 0; }
      .pf-lw-rolebox .pf-row { align-items: center; }
      .pf-lw-rolebox .pf-row select { max-width: 220px; }
      .pf-ai-saved.is-warn { color: var(--warn); }
      .pf-ai-routelist .pf-ai-routerow + .pf-ai-routerow { margin-top: 12px; }
      .pf-ai-routeall { border-bottom: 1px solid var(--border); padding-bottom: 12px; }
      .pf-ai-routes > .pf-hint { margin-bottom: 14px; }
    </style>
    <h3 class="pf-sec-title">AI Model</h3>
    <p class="pf-hint">Every AI call rides the Loreweaver server through one of your
    <b>Connection Manager profiles</b> — the same connections the chat uses. Endpoint,
    model and API key are resolved server-side; nothing is stored in this browser.</p>
    <p class="hint pf-hint pf-lw-empty" hidden>⚠️ No connection profiles found. Create one in
    Loreweaver: <b>Extensions → Connection Manager</b> (a profile needs an API endpoint and
    model), then press ↻ here.</p>
    <p class="hint pf-hint pf-lw-error" hidden></p>
    <div class="pf-kv pf-lw-profrow"><span class="pf-k">Main profile</span><select class="popup-in pf-lw-profile"></select><button class="mini pf-lw-refresh" type="button" title="Reload the profile list from Loreweaver">↻</button></div>
    <div class="pf-lw-profinfo"></div>
    <details class="foldbox pf-lw-rolebox">
    <summary>Per-job profiles (optional)</summary>
    <p class="pf-hint">Leave a job on <b>(main profile)</b> to use the main profile above. Assign
    a different profile to a job to run it on that connection instead — e.g. trackers, checks and
    memories on a cheap model, the GM on your best one.</p>
    <div class="pf-lw-rolelist"></div>
    </details>
    <div class="pf-kv" style="border-bottom:none;padding-bottom:0"><span class="pf-k">Profile preset sampling</span><span class="pf-v pf-lw-usepreset"></span></div>
    <p class="pf-hint">When on, the profile's preset sampling (temperature, top&nbsp;p, penalties…)
    is applied whenever the game doesn't set its own. Recommended: on.</p>
    <div class="pf-kv" style="border-bottom:none;padding-bottom:0"><span class="pf-k">Context budget (tokens)</span><span class="pf-v"><input class="popup-in pf-lw-ctx" type="number" min="2048" max="200000" step="1024" style="max-width:120px"></span></div>
    <p class="pf-hint">How much of the model's context window the game may use per prompt — roughly
    your model's window (e.g. 32768, 65536, 131072). The game fills it with as much recent story +
    lore + memories as fits. Too high for the actual model: the API truncates or errors.</p>
    <details class="foldbox pf-ai-routes" open>
    <summary>External AI calls</summary>
    <p class="pf-hint">Each job below rides the Loreweaver bridge — or, when switched off, DOESN'T
    RUN AT ALL (there is no free fallback anymore). Off is useful to disable a job entirely.</p>
    <div class="pf-ai-routelist"></div>
    </details>
    <div class="pf-row" style="border-top:1px solid var(--border);padding-top:9px"><button class="btn pf-lw-test" type="button">Test call through bridge</button><span class="pf-note pf-lw-status"></span></div>
    <div class="pf-row"><span class="pf-note pf-ai-saved"></span></div>`;
  const emptyEl = sec.querySelector(".pf-lw-empty");
  const errorEl = sec.querySelector(".pf-lw-error");
  const profEl = sec.querySelector(".pf-lw-profile");
  const refreshBtn = sec.querySelector(".pf-lw-refresh");
  const infoEl = sec.querySelector(".pf-lw-profinfo");
  const roleList = sec.querySelector(".pf-lw-rolelist");
  const presetBox = sec.querySelector(".pf-lw-usepreset");
  const ctxEl = sec.querySelector(".pf-lw-ctx");
  const statusEl = sec.querySelector(".pf-lw-status");
  const savedEl = sec.querySelector(".pf-ai-saved");
  const routesList = sec.querySelector(".pf-ai-routelist");

  const B = () => (typeof window !== "undefined" ? window.LoreweaverBridge : null);
  const readBridge = () => {
    try { const b = B(); return b ? (b.read() || {}) : {}; } catch (e) { return {}; }
  };

  // Route switches (see AI_ROUTE_IDS): on = the job rides the bridge; off = skipped.
  const cfg0 = getAiConfig();
  const routeMounts = {};
  const routeSwitches = {};
  const paintRouteSw = (id) => {
    const sw = routeSwitches[id];
    if (!sw || !routeMounts[id]) return;
    sw.paint();
    sw.setLabel(routeMounts[id].dataset.on === "1" ? "On" : "Off");
  };
  for (const id of AI_ROUTE_IDS) {
    const row = document.createElement("div");
    row.className = "pf-row pf-ai-routerow";
    row.innerHTML = `<span class="pf-k" style="min-width:130px">${infoTipLabelHtml(AI_ROUTE_LABELS[id], AI_ROUTE_HINTS[id])}</span><span class="pf-v pf-ai-routesw"></span>`;
    const mount = row.querySelector(".pf-ai-routesw");
    mount.dataset.on = (cfg0.useExternal && cfg0.useExternal[id] !== false) ? "1" : "";
    const sw = switchEl({
      on: () => mount.dataset.on === "1",
      set: (on) => { mount.dataset.on = on ? "1" : ""; },
      text: mount.dataset.on === "1" ? "On" : "Off",
      plain: true,
      onChange: () => { paintRouteSw(id); allSw.paint(); allSw.setLabel(allOn() ? "On" : "Off"); persistRoutes(); }
    });
    mount.appendChild(sw.el);
    routeMounts[id] = mount;
    routeSwitches[id] = sw;
    routesList.appendChild(row);
  }
  const allOn = () => AI_ROUTE_IDS.every((id) => routeMounts[id] && routeMounts[id].dataset.on === "1");
  const allRow = document.createElement("div");
  allRow.className = "pf-row pf-ai-routerow pf-ai-routeall";
  allRow.innerHTML = `<span class="pf-k" style="min-width:130px">${infoTipLabelHtml("All", "Switch every job below at once.")}</span><span class="pf-v pf-ai-routesw"></span>`;
  const allMount = allRow.querySelector(".pf-ai-routesw");
  const allSw = switchEl({
    on: () => allOn(),
    set: (on) => { for (const id of AI_ROUTE_IDS) routeMounts[id].dataset.on = on ? "1" : ""; },
    text: allOn() ? "On" : "Off",
    plain: true,
    onChange: () => { for (const id of AI_ROUTE_IDS) paintRouteSw(id); allSw.paint(); allSw.setLabel(allOn() ? "On" : "Off"); persistRoutes(); }
  });
  allMount.appendChild(allSw.el);
  routesList.prepend(allRow);
  const persistRoutes = () => {
    const out = {};
    for (const id of AI_ROUTE_IDS) out[id] = !routeMounts[id] || routeMounts[id].dataset.on === "1";
    saveAiConfig({ useExternal: out });
    try { window.dispatchEvent(new Event("mno:aimodel-changed")); } catch (e) {}
  };

  // Bridge params live in rpge.loreweaverBridge (the bridge shim reads them live) —
  // always `enabled: true`: with profiles-only AI there is no off state anymore.
  const bridge = readBridge();
  ctxEl.value = Number.isFinite(Number(bridge.contextTokens)) && Number(bridge.contextTokens) >= 2048 ? Math.round(Number(bridge.contextTokens)) : 16384;
  const swPreset = switchEl({
    on: () => bridge.usePreset !== false,
    set: (on) => { bridge.usePreset = on; },
    text: bridge.usePreset !== false ? "On" : "Off",
    plain: true,
    onChange: () => { swPreset.setLabel(bridge.usePreset !== false ? "On" : "Off"); persistBridge(); }
  });
  presetBox.appendChild(swPreset.el);
  const persistBridge = () => {
    const b = B();
    if (!b) return;
    b.write(Object.assign({}, readBridge(), bridge, { enabled: true }));
    try { window.dispatchEvent(new Event("mno:aimodel-changed")); } catch (e) {}
  };

  ctxEl.addEventListener("change", () => {
    const n = parseInt(ctxEl.value, 10);
    bridge.contextTokens = Number.isFinite(n) ? Math.min(200000, Math.max(2048, n)) : 16384;
    ctxEl.value = bridge.contextTokens;
    persistBridge();
  });

  // Per-job profile selects (the bridge shim's ROLE_IDS, minus "main").
  const ROLE_IDS = (B() && B().ROLE_IDS) || ["gm", "check", "staging", "tracker", "npc", "scene", "memory", "npclife", "other", "cheap"];
  const roleMounts = {};
  const roleSel = {};
  const paintRoleOptions = () => {
    for (const id of ROLE_IDS) {
      const sel = roleSel[id];
      if (!sel) continue;
      const cur = (bridge.roles && bridge.roles[id]) || "";
      sel.innerHTML = "";
      const main = document.createElement("option");
      main.value = "";
      main.textContent = "(main profile)";
      sel.appendChild(main);
      for (const p of profList) {
        const o = document.createElement("option");
        o.value = p.id;
        o.textContent = (p.name || p.id) + (p.model ? " — " + p.model : "");
        sel.appendChild(o);
      }
      sel.value = profList.some((p) => p.id === cur) ? cur : "";
    }
  };
  for (const id of ROLE_IDS) {
    const row = document.createElement("div");
    row.className = "pf-row";
    row.innerHTML = `<span class="pf-k" style="min-width:130px">${esc(id === "cheap" ? "Cheap secondary model" : (AI_ROUTE_LABELS[id] || id))}</span><select class="popup-in pf-lw-role"></select>`;
    const sel = row.querySelector("select");
    sel.addEventListener("change", () => {
      bridge.roles = bridge.roles && typeof bridge.roles === "object" ? bridge.roles : {};
      if (sel.value) bridge.roles[id] = sel.value;
      else delete bridge.roles[id];
      persistBridge();
    });
    roleMounts[id] = row;
    roleSel[id] = sel;
    roleList.appendChild(row);
  }

  let profList = [];
  const readProfileId = () => {
    const b = readBridge();
    return (b.profileId && profList.some((p) => p.id === b.profileId)) ? b.profileId : "";
  };
  const paintProfiles = () => {
    const pid = readProfileId();
    profEl.innerHTML = "";
    if (!profList.length) {
      profEl.innerHTML = "<option value=''>No profiles found</option>";
      profEl.disabled = true;
      emptyEl.hidden = false;
      infoEl.textContent = "";
      return;
    }
    profEl.disabled = false;
    emptyEl.hidden = true;
    for (const p of profList) {
      const o = document.createElement("option");
      o.value = p.id;
      o.textContent = (p.name || p.id) + (p.model ? " — " + p.model : "");
      profEl.appendChild(o);
    }
    const effective = profList.some((p) => p.id === pid) ? pid : profList[0].id;
    profEl.value = effective;
    paintProfileInfo(effective);
  };
  const paintProfileInfo = (pid) => {
    const p = profList.find((x) => x.id === pid);
    if (!p) { infoEl.textContent = ""; return; }
    infoEl.textContent = [
      "api: " + (p.api || "?"),
      "model: " + (p.model || "?"),
      p["api-url"] ? "url: " + p["api-url"] : ""
    ].filter(Boolean).join(" · ") + " — key stays on the server.";
  };
  profEl.addEventListener("change", () => {
    const p = profList.find((x) => x.id === profEl.value);
    bridge.profileId = profEl.value || "";
    bridge.profileName = p ? (p.name || p.id) : "";
    persistBridge();
    saveAiConfig({ profileName: bridge.profileName });
    paintProfileInfo(profEl.value);
    paintRoleOptions();
    try { window.dispatchEvent(new Event("mno:aimodel-changed")); } catch (e) {}
  });

  const loadProfiles = async (force) => {
    const b = B();
    if (!b || typeof b.getSettings !== "function") {
      errorEl.hidden = false;
      errorEl.textContent = "The Loreweaver bridge shim is not loaded — the app only works when served by Loreweaver.";
      return;
    }
    try {
      const lw = await b.getSettings();
      profList = Array.isArray(lw.profiles) ? lw.profiles : [];
      // First-run default: the profile Loreweaver itself has selected (one less click).
      const cur = readBridge();
      if (!cur.profileId && lw.selectedProfile && profList.some((p) => p.id === lw.selectedProfile)) {
        bridge.profileId = lw.selectedProfile;
        const p = profList.find((x) => x.id === lw.selectedProfile);
        bridge.profileName = p ? (p.name || p.id) : "";
        persistBridge();
        saveAiConfig({ profileName: bridge.profileName });
      }
      errorEl.hidden = true;
      paintProfiles();
      paintRoleOptions();
    } catch (e) {
      errorEl.hidden = false;
      errorEl.textContent = "Could not load the connection profiles (" + (e.message || e) +
        "). The AI Model section only works when the app is served by the Loreweaver server.";
      profList = [];
      paintProfiles();
    }
  };
  refreshBtn.onclick = async () => {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "…";
    try { const b = B(); if (b && typeof b.getSettings === "function") { b.settingsCacheInvalidate ? b.settingsCacheInvalidate() : null; } } catch (e) {}
    await loadProfiles(true);
    refreshBtn.disabled = false;
    refreshBtn.textContent = "↻";
  };

  sec.querySelector(".pf-lw-test").onclick = async (e) => {
    const btn = e.target;
    btn.disabled = true;
    statusEl.textContent = "Testing…";
    try {
      const reply = await testBridgeConnection();
      statusEl.textContent = "✓ Connected" + (reply ? " — replied: " + reply.slice(0, 40) : "");
    } catch (err) {
      statusEl.textContent = "✖ " + (err.message || err);
    }
    btn.disabled = false;
  };

  loadProfiles();
  return sec;
}
