// [rpge-patch 022] Prompt-stack preset model — SillyTavern's chat-completion preset schema
// (docs/PRESETS.md) ported engine-side. Data reuse, not UI copy: this module speaks ST's exact
// `prompts` + `prompt_order` JSON on Import/Export and assembles the author's block stack for the
// engine's prompt pipeline (rp-engine.js buildContext), with the ST macro grammar engine-local.
//
// Pure data + text processing — NO DOM — so `tools/check-presets.js` covers it in plain Node.
// (Storage of the loaded preset lives in main.js: a localStorage blob, like the AI provider prefs.)
//
// What ST behavior is kept verbatim:
//  - Preset shape: `prompts` (blocks) + `prompt_order` (per-`character_id` play orders, the global
//    one being `character_id: 100001`). Import keeps the whole parsed JSON object verbatim so
//    Export round-trips (same shape, extra keys untouched — only the `enabled` flags and content
//    the editor actually edits change).
//  - `prompt_order[].order` entries are `{ identifier, enabled }` pairs; the editor's checkboxes
//    read/write exactly those.
//  - `marker: true` prompts are SKIPPED at assembly: in ST they are empty placeholders that the
//    send pipeline fills with world/character/chat state (charDescription → character sheet,
//    chatHistory → transcript, scenario → premise, worldInfo* → lorebook). The engine already owns
//    all of those jobs natively, so a marker contributes nothing — its slot is engine-native.
//  - Macro semantics follow ST's macro lists (public/scripts/macros.js `evaluateMacros` +
//    variables.js `getVariableMacros`): each macro family runs as a whole-text pass, in ST's
//    family order, and nested macro text inside `{{getvar}}`-returned values resolves on later
//    passes (ST's newer macro engine resolves nested macros the same way; `{{trim}}` eats the
//    newlines around it exactly like ST's `(?:\r?\n)*{{trim}}(?:\r?\n)*`).
//  - Unknown `{{...}}` macros stay literal text (same call the regex port made: no silent data
//    loss; a template the engine doesn't know is the author's to see, not to vanish).
//
// What is deliberately simplified (documented deviations, all no-ops for the target preset):
//  - `injection_position: 1` (ABSOLUTE in-chat injections): ST splices them into the message list
//    at `injection_depth` messages from the end. The engine sends ONE assembled text, so they ride
//    at the very end (right before the final "write your reply" directive), sorted by
//    `injection_order` then play order — depth honored as a sort key only. The target preset
//    (FF 5.4) uses depth 0 exclusively, and its only ABSOLUTE blocks (the Internal-States modules)
//    are dropped by design in the Engine Edition ([rpge-patch 023]).
//  - `{{pick:…}}` is cached per assembly instead of seeded per chat (same value every call in one
//    turn, fresh next turn — close enough for flavor lists).
//  - `{{maxContext}}`/`{{maxResponse}}`/provider-specific macros (`{{kimi…}}`) stay literal: the
//    engine's context budget lives in the bridge layer, not in prompt text.
//  - `{{roll::1d20}}` — ST's old regex engine fails this form (formula ":1d20" is invalid) and
//    renders it EMPTY; the leading colon is stripped here so the intended dice actually roll. The
//    preset's rolls are story seeds (Chekhov's-Gun d20s), never hero stat math — the engine's own
//    dice (scene-dice.js / stats.js) stay the authority on outcomes.

export const GLOBAL_ORDER_CHAR_ID = 100001;
// Hard stop for nested-macro passes (setvar→getvar→setvar chains converge in 2–3; 12 is paranoia).
const MAX_PASSES = 12;

// ---- parsing -------------------------------------------------------------------------------

/**
 * Parses an ST chat-completion preset JSON string into the engine's preset model.
 * The raw parsed object is kept verbatim on `preset.data` so Export round-trips.
 * @param {string} raw JSON text (ST `OpenAI Settings/*.json` export)
 * @returns {{ ok: boolean, preset: object|null, errors: string[] }}
 */
export function parsePresetJson(raw) {
  const errors = [];
  let data = null;
  try {
    data = JSON.parse(String(raw));
  } catch (e) {
    return { ok: false, preset: null, errors: ["Couldn't read the file as JSON: " + (e && e.message ? e.message : e)] };
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { ok: false, preset: null, errors: ["Not a preset object."] };
  }
  if (!Array.isArray(data.prompts)) {
    return { ok: false, preset: null, errors: ["No `prompts` list found — this doesn't look like a chat-completion preset."] };
  }
  const prompts = new Map();
  data.prompts.forEach((p, i) => {
    if (!p || typeof p !== "object") { errors.push(`prompts[${i}] is not an object — skipped.`); return; }
    if (!p.identifier) { errors.push(`prompts[${i}] has no identifier — skipped.`); return; }
    prompts.set(p.identifier, p);
  });
  // Global play order: the group tagged 100001 (ST's convention), else the first group, else [].
  let order = [];
  if (Array.isArray(data.prompt_order) && data.prompt_order.length) {
    const g = data.prompt_order.find((x) => x && x.character_id === GLOBAL_ORDER_CHAR_ID) || data.prompt_order.find((x) => Array.isArray(x.order));
    if (g && Array.isArray(g.order)) {
      order = g.order.filter((e) => e && typeof e === "object" && e.identifier)
        .map((e) => ({ identifier: e.identifier, enabled: e.enabled !== false }));
    }
  }
  if (!order.length) errors.push("No usable `prompt_order` found — every block will read as disabled until you enable them in the editor.");
  return { ok: true, preset: { data, prompts, order }, errors };
}

// ---- macro engine ---------------------------------------------------------------------------

/**
 * Whole-text pass: replace every `{{macro}}` of the given handler kind. Brace-aware for
 * argument-bearing macros (values may contain nested `{{...}}` — see setvar templates).
 * @param {string} text
 * @param {RegExp} open pattern matching the macro opening, e.g. /\{\{setvar::/gi
 * @param {(args: string[], m: RegExpMatchArray) => string} fn receives the `::`-split body plus
 *   the open-match (group 1 useful for variant macros like incvar/decvar, random/pick)
 */
function passReplace(text, open, fn) {
  open.lastIndex = 0;
  let out = "";
  let at = 0;
  let m;
  while ((m = open.exec(text)) !== null) {
    // Find the balanced end of this macro: walk forward counting `{{`/`}}` pairs so a nested
    // `{{getvar::x}}` inside a setvar value doesn't truncate the value.
    let depth = 1;
    let i = m.index + m[0].length;
    let closed = false;
    while (i < text.length) {
      if (text.startsWith("{{", i)) { depth++; i += 2; continue; }
      if (text.startsWith("}}", i)) { depth--; i += 2; if (!depth) { closed = true; break; } continue; }
      i++;
    }
    const body = text.slice(m.index + m[0].length, closed ? i - 2 : i);
    const rep = fn(body.split("::"), m);
    out += text.slice(at, m.index) + rep;
    at = closed ? i : text.length; // unclosed macro: swallow to the end (matches ST's permissive regexes)
    if (!closed) break;
    // Guard against zero-length loops when the replacement re-triggers `open` (never the case in
    // this grammar, but cheap to be sure).
    if (open.lastIndex === m.index) open.lastIndex++;
  }
  return out + text.slice(at);
}

/**
 * Rolls a dice formula ST-style: digits-only means 1dN; otherwise NdM(+/-K)*. No `droll`
 * dependency — the engine ships without it and the grammar is small.
 * @returns {string} total, or "" for an invalid formula (ST renders invalid rolls empty).
 */
export function rollFormula(formula) {
  let f = String(formula || "").trim();
  while (f.startsWith(":")) f = f.slice(1).trim(); // {{roll::1d20}} double-colon tolerance
  if (/^\d+$/.test(f)) f = "1d" + f;
  if (!/^\d*d\d+(?:\s*[+-]\s*\d+)*$/i.test(f)) return "";
  const dm = f.match(/^(\d*)d(\d+)/i);
  const count = Math.min(Math.max(parseInt(dm[1] || "1", 10), 1), 100);
  const sides = Math.min(Math.max(parseInt(dm[2], 10), 1), 1000);
  let total = 0;
  for (let i = 0; i < count; i++) total += 1 + Math.floor(Math.random() * sides);
  // +/- modifiers
  let rest = f.slice(dm[0].length).replace(/\s+/g, "");
  const mods = rest.match(/[+-]\d+/g) || [];
  for (const mod of mods) total += parseInt(mod, 10);
  return String(total);
}

// Tiny `{{isotime FORMAT}}`/`{{isodate FORMAT}}` subset of moment's tokens (enough for presets:
// yyyy, yy, MMMM, MMM, MM, dd, dddd, ddd, HH, H, hh, h, mm, ss, A, a).
// Token replacements run in an order that can never eat each other: all digit-producing tokens
// first, then the spelled-out names, then AM/PM (whose lowercase 'a' must not match the 'a' in
// "May", so it runs before any month name exists in the string).
function fmtDate(d, format) {
  const pad = (n) => String(n).padStart(2, "0");
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const H = d.getHours();
  const h12 = H % 12 || 12;
  let s = String(format || "");
  // Order matters and is safe by construction: every token replaced here produces digits
  // (never token letters), and the spelled month/day names are inserted LAST — they contain
  // letters ('March' has an 'h', 'May' an 'a') that earlier letter patterns would eat if the
  // names existed first. MMMM/MMM precede MM (else the 2-digit pass eats the name token), and
  // dddd/ddd precede dd/DD the same way.
  s = s.replace(/HH/g, pad(H));
  s = s.replace(/hh/g, pad(h12));
  s = s.replace(/(^|[^h])h/g, "$1" + h12); // single 'h' after hh consumed
  s = s.replace(/A/g, H < 12 ? "AM" : "PM");
  s = s.replace(/a/g, H < 12 ? "am" : "pm");
  s = s.replace(/mm/g, pad(d.getMinutes()));
  s = s.replace(/ss/g, pad(d.getSeconds()));
  s = s.replace(/yyyy/gi, String(d.getFullYear()));
  s = s.replace(/yy/gi, pad(d.getFullYear() % 100));
  s = s.replace(/MMMM/g, months[d.getMonth()]);
  s = s.replace(/MMM/g, months[d.getMonth()].slice(0, 3));
  s = s.replace(/MM/g, pad(d.getMonth() + 1));
  s = s.replace(/dddd/g, days[d.getDay()]);
  s = s.replace(/ddd/g, days[d.getDay()].slice(0, 3));
  s = s.replace(/dd/g, pad(d.getDate()));
  s = s.replace(/DD/g, pad(d.getDate())); // moment's uppercase day-of-month, too
  return s;
}

/**
 * Expands the ST macro grammar over one block of text. ST-faithful pass order:
 * comments → rolls → variable setters → getters → whitespace/legacy → env (user/char/date)
 * → random/pick; then the WHOLE result is re-scanned until no macro changes anything
 * (max MAX_PASSES) so templates stored via `{{setvar}}` resolve their inner `{{getvar}}`s —
 * the same nested resolution ST's newer macro engine performs.
 *
 * @param {string} text
 * @param {object} [ctx] `{ user, char, vars (Map), now (Date) }` — vars is mutated by setvar and
 *   carried across the whole stack assembly (fresh per turn, like ST's per-chat chat_metadata).
 */
export function expandMacros(text, ctx = {}) {
  let out = String(text || "");
  const vars = ctx.vars instanceof Map ? ctx.vars : new Map();
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  const env = {
    user: ctx.user == null ? "" : String(ctx.user),
    char: ctx.char == null ? "" : String(ctx.char),
  };
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const before = out;
    // Comments: `{{// anything }}` → "" (to the first `}}`; brace-aware so a comment containing
    // a stray macro doesn't leak).
    out = passReplace(out, /\{\{\s*\/\//gi, () => "");
    // Dice: {{roll: FORMULA}} / {{roll FORMULA}} (invalid formulas render "" — ST behavior).
    out = passReplace(out, /\{\{\s*roll[ :]+/gi, (args) => rollFormula(args.join("::")));
    // Variables — execute ALL setters first (text order, later wins), then resolve getters.
    // Values stored RAW (no nested expansion at set time — the author's template must still hold
    // its `{{getvar}}`s until it is printed, which the multi-pass loop resolves afterwards).
    out = passReplace(out, /\{\{\s*setvar::/gi, (args) => {
      const k = (args[0] || "").trim();
      const v = args.length > 1 ? args.slice(1).join("::") : "";
      if (k) vars.set(k, v);
      return "";
    });
    out = passReplace(out, /\{\{\s*addvar::/gi, (args) => {
      const k = (args[0] || "").trim();
      const v = args.length > 1 ? args.slice(1).join("::") : "";
      if (k) {
        const cur = String(vars.get(k) || "");
        const curN = parseFloat(cur);
        const addN = parseFloat(v);
        vars.set(k, (Number.isFinite(curN) && cur !== "" && Number.isFinite(addN)) ? String(curN + addN) : cur + v);
      }
      return "";
    });
    out = passReplace(out, /\{\{\s*(incvar|decvar)::/gi, (args, m) => {
      const k = (args[0] || "").trim();
      if (k) {
        const n = parseFloat(String(vars.get(k) || "0")) || 0;
        const inc = ((m[1] || "").toLowerCase()) === "incvar" ? 1 : -1;
        vars.set(k, String(n + inc));
      }
      return "";
    });
    out = passReplace(out, /\{\{\s*getvar::/gi, (args) => String(vars.get((args[0] || "").trim()) || ""));
    // Whitespace & legacy
    out = out.replace(/(?:\r?\n)*\{\{\s*trim\s*\}\}(?:\r?\n)*/gi, "");
    out = out.replace(/\{\{\s*noop\s*\}\}/gi, "");
    out = out.replace(/\{\{\s*newline\s*\}\}/gi, "\n");
    // Env
    out = out.replace(/\{\{\s*user\s*\}\}/gi, env.user);
    out = out.replace(/\{\{\s*char\s*\}\}/gi, env.char);
    out = out.replace(/<USER>/gi, env.user);
    out = out.replace(/<BOT>/gi, env.char);
    out = out.replace(/<CHAR>/gi, env.char);
    // Dates
    out = out.replace(/\{\{\s*isotime\s*([^}]*)\}\}/gi, (_, f) => fmtDate(now, f.trim().replace(/^["']|["']$/g, "") || "h:mm a"));
    out = out.replace(/\{\{\s*isodate\s*([^}]*)\}\}/gi, (_, f) => fmtDate(now, f.trim().replace(/^["']|["']$/g, "") || "YYYY-MM-DD"));
    out = out.replace(/\{\{\s*time\s*\}\}/gi, () => fmtDate(now, "h:mm a"));
    out = out.replace(/\{\{\s*date\s*\}\}/gi, () => fmtDate(now, "MMMM d, yyyy"));
    out = out.replace(/\{\{\s*weekday\s*\}\}/gi, () => fmtDate(now, "dddd"));
    // Choice macros (post-env in ST): `{{random:a,b,c}}` fresh per call; `{{pick:…}}` stable
    // within one expansion (cached in vars so repeated picks in one turn match).
    out = passReplace(out, /\{\{\s*(random|pick)[ :]+/gi, (args, m) => {
      const kind = ((m[1] || "").trim().toLowerCase());
      const list = args[0].split(",").map((s) => s.trim()).filter(Boolean);
      if (!list.length) return "";
      if (kind === "random") return list[Math.floor(Math.random() * list.length)];
      const key = "__pick:" + list.join(",");
      if (!vars.has(key)) vars.set(key, list[Math.floor(Math.random() * list.length)]);
      return String(vars.get(key) || "");
    });
    if (out === before) break; // fixpoint: nothing expanded this pass
  }
  return out;
}

// ---- assembly --------------------------------------------------------------------------------

/**
 * Assembles the enabled block stack for one turn: in-flow blocks joined in play order, plus the
 * ABSOLUTE in-chat injections as a separate list (see header note on the depth simplification).
 * Markers are skipped (their slots are engine-native), disabled entries skipped, unreferenced
 * prompts ignored (ST never plays out-of-order clones).
 *
 * @param {object} preset parsed preset from parsePresetJson
 * @param {object} [ctx] macro context `{ user, char, now }`
 * @returns {{ inFlow: string, injections: Array<{identifier,name,role,depth,order,seq,text}> }}
 */
export function assemblePresetPrompt(preset, ctx = {}) {
  const out = { inFlow: "", injections: [] };
  if (!preset || !Array.isArray(preset.order)) return out;
  // Caller-owned when supplied: setvar values are per-chat state in ST and must survive turns.
  const vars = ctx.vars instanceof Map ? ctx.vars : new Map();
  const macroCtx = { ...ctx, vars };
  const inFlow = [];
  let seq = 0;
  for (const entry of preset.order) {
    const p = preset.prompts.get(entry.identifier);
    if (!p || entry.enabled === false) continue;
    if (p.marker === true) continue; // placeholder → engine-native slot
    const content = typeof p.content === "string" ? p.content : "";
    if (!content.trim()) continue;
    const text = expandMacros(content, macroCtx).trim();
    if (!text) continue;
    if (p.injection_position === 1) {
      out.injections.push({
        identifier: p.identifier,
        name: p.name || p.identifier,
        role: p.role || "system",
        depth: Number(p.injection_depth) || 0,
        order: Number(p.injection_order) || 100,
        seq: seq++,
        text,
      });
    } else {
      inFlow.push(text);
    }
  }
  // Sort injections by depth (shallow first — ST's end-anchored slices), then injection_order,
  // then play order, so future depth handling has a stable basis.
  out.injections.sort((a, b) => (a.depth - b.depth) || (a.order - b.order) || (a.seq - b.seq));
  out.inFlow = inFlow.join("\n\n");
  return out;
}

/**
 * The ST-JSON Export string for a preset: the imported object verbatim (only whatever the editor
 * edited is different — the schema is untouched), pretty-printed like ST's exports.
 */
export function serializePresetExport(preset) {
  if (!preset || !preset.data) return "";
  return JSON.stringify(preset.data, null, 4);
}
