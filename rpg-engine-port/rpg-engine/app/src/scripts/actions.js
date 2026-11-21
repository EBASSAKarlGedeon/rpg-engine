// Actions & abilities (patch 019): declared hero capabilities as data. An action card is
// { id, name, icon, kind: "passive"|"active", deltas: {stat: ±N}, effect, active, source }.
// Passive actions always contribute their deltas; active ones only while `active` is true.
// Deltas are applied BY CODE at roll time (effectiveStats) — the AI never writes stat values,
// it only ever LISTS a new ability via the machine strip below, which the player accepts.
// GM strip format (one line, extracted out of the narration like [TRACKERS]):
//   [ACTION: Name | passive | str +30, agi -2 | One-sentence effect the GM must honor.]
// Segments: name | kind(optional, default passive) | deltas(optional) | effect(optional);
// a segment starting with "icon:" supplies the icon; "source" is "story" for stripped ones.

const ACTION_STRIP_RE = /^\s*\[ACTION:\s*(.+?)\s*\]\s*$/i;
let actionSeq = 0;

export function defaultActions() { return []; }

export function normalizeAction(raw, statDefs) {
  const r = raw && typeof raw === "object" ? raw : {};
  const name = String(r.name || "").trim().slice(0, 60) || "Unnamed action";
  const kind = r.kind === "active" ? "active" : "passive";
  const icon = String(r.icon || "").trim().slice(0, 4) || (kind === "active" ? "⚡" : "✦");
  const deltas = {};
  const src = r.deltas && typeof r.deltas === "object" ? r.deltas : {};
  const keys = new Set((statDefs || []).map((d) => d.key));
  for (const k of Object.keys(src)) {
    const n = Number(src[k]);
    if (keys.has(k) && Number.isFinite(n) && n !== 0) deltas[k] = Math.round(n);
  }
  const effect = String(r.effect || "").trim().slice(0, 400);
  return {
    id: r.id || "act-" + Date.now().toString(36) + "-" + (++actionSeq),
    name, icon, kind, deltas, effect,
    active: kind === "active" ? !!r.active : false,
    source: r.source === "hero" ? "hero" : "story",
  };
}

// Pull every `[ACTION: ...]` line out of the raw GM reply. Returns { text, gains } where text is
// the narration with the strips removed (they must never render) and gains are raw parsed cards
// (normalized later against statDefs).
export function parseActionStrips(rawText) {
  const src = String(rawText || "");
  const gains = [];
  const kept = [];
  for (const ln of src.split("\n")) {
    const m = ln.match(ACTION_STRIP_RE);
    if (!m) { kept.push(ln); continue; }
    const segs = m[1].split("|").map((s) => s.trim()).filter(Boolean);
    if (!segs.length) continue;
    const card = { name: segs[0], kind: "passive", deltas: {}, effect: "", icon: "" };
    for (const seg of segs.slice(1)) {
      const im = seg.match(/^icon:\s*(.+)$/i);
      if (im) { card.icon = im[1].trim(); continue; }
      if (/^(passive|active)$/i.test(seg)) { card.kind = seg.toLowerCase(); continue; }
      // delta tokens: `key ±N` / `key N`, comma separated
      const dm = seg.match(/^([A-Za-z_][\w-]*)\s*([+-]?\d+)\s*(?:,|\s|$)/);
      if (dm) { card.deltas[dm[1]] = Number(dm[2]); continue; }
      if (!card.effect) card.effect = seg;
    }
    gains.push(card);
  }
  const text = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, gains };
}

// The stat values the world actually plays with: base + passive deltas + (active deltas while on).
// Returns a fresh object; never mutates the character. Buffs deliberately EXCEED the world's stat
// max (the max is a creation budget — being buffed is the point); only the LOW side is clamped
// to the stat's min so a curse can't push a stat under 1.
export function effectiveStats(character, statDefs) {
  const base = (character && character.stats) || {};
  const out = { ...base };
  const acts = (character && character.actions) || [];
  if (!acts.length) return out;
  for (const a of acts) {
    if (a.kind === "active" && !a.active) continue;
    for (const k of Object.keys(a.deltas || {})) out[k] = (Number(out[k]) || 0) + Number(a.deltas[k]);
  }
  for (const d of statDefs || []) {
    const min = Number(d && d.min);
    if (out[d.key] !== undefined && Number.isFinite(min) && out[d.key] < min) out[d.key] = min;
  }
  return out;
}

// Which actions contribute to a stat right now (sheet badge / tooltip).
export function buffsFor(character, statKey) {
  const acts = (character && character.actions) || [];
  return acts.filter((a) => a.kind === "passive" || a.active)
    .filter((a) => Number(a.deltas && a.deltas[statKey]))
    .map((a) => ({ name: a.name, icon: a.icon, amount: Number(a.deltas[statKey]) }));
}

// GM context block: the hero's declared capabilities. Truth the narrator must honor.
export function actionsContext(character) {
  const acts = (character && character.actions) || [];
  if (!acts.length) return "";
  const lines = acts.map((a) => {
    const state = a.kind === "active" ? (a.active ? "ACTIVE" : "ready (not active)") : "passive";
    const deltas = Object.keys(a.deltas || {}).length
      ? " " + Object.keys(a.deltas).map((k) => `${k} ${a.deltas[k] > 0 ? "+" : ""}${a.deltas[k]}`).join(", ")
      : "";
    return `- ${a.icon} ${a.name} (${state})${deltas}${a.effect ? ": " + a.effect : ""}`;
  });
  return "ACTIONS & ABILITIES (declared capabilities — true of the hero; honor their effects when the story turns on them; never change the hero's STATS yourself):\n" + lines.join("\n");
}

// The rule the GM follows for granting NEW abilities mid-story.
export const ACTION_GAIN_RULE = [
  "GRANTING NEW ACTIONS (only when the story genuinely awards a lasting capability — a spell learned, a technique mastered, an innate power awakened, a pact sealed; not for everyday competence the hero already has):",
  "At the very END of your reply, on its own line, output EXACTLY one line per granted action in this format:",
  "[ACTION: Name | passive or active | str +3, agi -1 | One-sentence effect you must honor.]",
  "Fields: short Name (no pipes); kind passive (always on) or active (the hero must invoke it); stat deltas use ONLY the STATS keys above (omit the segment if none); effect is what the action does. Omit the whole line when nothing is granted this turn."
].join("\n");

// ---- [rpge-patch 025] Auto-invoke + generatable actions ------------------------------------
// The PLAYER'S OWN WORDS toggle their ACTIVE actions. When a submitted action mentions an
// ability's name in a sentence that also reads as an invocation, the engine flips the switch
// BEFORE the GM call — this turn's referee and roll already play with the buff. No confirmation
// card: the player declared it, that IS the instruction. The AI is never involved in toggling
// (no strip, the GM cannot flip switches) — state changes come only from the player's text.
// A bare mention without an invocation cue ("Blink Step saved me last week") changes nothing.
const INVOKE_CUE_RE = /\b(?:invoke|invokes|invoked|invoking|activate|activates|activated|activating|use|uses|used|using|cast|casts|casting|channel|channels|channeling|unleash|unleashes|unleashing|trigger|triggers|triggered|call upon|calls upon|calling upon|tap into|taps into|tapping into|power up|powers up)\b/i;
const DISMISS_CUE_RE = /\b(?:dismiss|dismisses|dismissed|deactivate|deactivates|deactivated|dispel|dispels|dispelled|switch off|switches off|shut off|shuts off|turn off|turns off|stop using|stops using|cancel|cancels|stow|stows|release|releases|end|ends|ended|drop|drops|dropped)\b/i;

// Sentence split good enough for toggle detection: hard breaks + terminal punctuation. Abbrev-
// false-positives only cost a missed/extra sentence boundary — the name+cue pairing inside each
// sentence is what decides.
function toggleSentences(text) {
  return String(text || "")
    .split(/(?<=[.!?:;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function sentenceNamesAction(name, sentence) {
  const esc = String(name || "").trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!esc) return false;
  try {
    return new RegExp("(^|[^\\p{L}\\p{N}])" + esc + "([^\\p{L}\\p{N}]|$)", "iu").test(sentence);
  } catch (_) { return sentence.toLowerCase().includes(esc.toLowerCase()); }
}

// Which active actions does this player text turn ON / OFF? Returns {on:[action], off:[action]}
// (direct references into character.actions; NOT yet applied). Dismissal beats invocation when
// a sentence carries both kinds of cue. Already-correct states are omitted (idempotent).
export function detectActionToggles(text, character) {
  const acts = ((character && character.actions) || []).filter((a) => a && a.kind === "active");
  const sents = toggleSentences(text);
  const on = [], off = [];
  for (const a of acts) {
    if (!a.name) continue;
    let wantOn = false, wantOff = false;
    for (const s of sents) {
      if (!sentenceNamesAction(a.name, s)) continue;
      if (DISMISS_CUE_RE.test(s)) wantOff = true;
      else if (INVOKE_CUE_RE.test(s)) wantOn = true;
    }
    if (wantOff && a.active) off.push(a);       // dismissal wins over invocation
    else if (wantOn && !a.active) on.push(a);
  }
  return { on, off };
}

// Apply a detectActionToggles result in place. Returns the actions whose state actually changed
// (caller toasts/saves them).
export function applyActionToggles(det) {
  const d = det && typeof det === "object" ? det : { on: [], off: [] };
  const changed = [];
  for (const a of d.on || []) if (a && a.kind === "active" && !a.active) { a.active = true; changed.push(a); }
  for (const a of d.off || []) if (a && a.kind === "active" && a.active) { a.active = false; changed.push(a); }
  return changed;
}

// Validate + clamp ONE AI-proposed action offer (wizard / Actions-tab generator): unknown stat
// keys dropped, |delta| clamped to maxDelta (creation scale — buffs later may exceed the max,
// but generated STARTING abilities stay inside the budget; free-build widens the clamp), zeros
// dropped, name required. Returns a plain offer object (no id yet — Add normalizes via
// normalizeAction) or null when unusable.
export function normalizeActionOffer(raw, statDefs, opts) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  if (!r) return null;
  const name = String(r.name || "").trim().slice(0, 60);
  if (!name) return null;
  const o = opts || {};
  const maxDelta = Number.isFinite(o.maxDelta) ? Math.abs(o.maxDelta) : 3;
  const statKeys = new Set((statDefs || []).map((d) => d.key));
  const deltas = {};
  const src = r.deltas && typeof r.deltas === "object" ? r.deltas : {};
  for (const k of Object.keys(src)) {
    if (!statKeys.has(k)) continue;
    const n = Math.round(Number(src[k]));
    if (!Number.isFinite(n) || n === 0) continue;
    deltas[k] = Math.max(-maxDelta, Math.min(maxDelta, n));
  }
  const kind = r.kind === "active" ? "active" : "passive";
  const icon = String(r.icon || "").trim().slice(0, 4) || (kind === "active" ? "⚡" : "✦");
  const effect = String(r.effect || "").trim().slice(0, 300);
  return { name, icon, kind, deltas, effect };
}

// The offer-generation prompt block (main.js assembles the context around it).
export function actionGenRule(maxDelta) {
  const cap = Number.isFinite(maxDelta) ? Math.abs(maxDelta) : 3;
  return [
    "PROPOSING HERO ACTIONS (abilities the GM must always honor):",
    `Return a JSON ARRAY of 2–4 action objects. Each object: {"name": short name (no pipes), "icon": ONE emoji, "kind": "passive" or "active", "deltas": {"stat_key": ±N}, "effect": one sentence}.`,
    `deltas use ONLY the STATS keys given above, each |value| ≤ ${cap}. kind "passive" = always applies; "active" = the hero must invoke it — at most ONE active unless the direction asks for more.`,
    "effect: ≤ 25 words, phrased as a lasting capability (what it does and what it costs/limits, if any). No duplicates of the hero's existing actions.",
    "Reply with ONLY the JSON array — no prose, no code fence. Strict valid JSON: double quotes, no trailing commas."
  ].join("\n");
}
