// Actions & abilities (patch 019): declared hero capabilities as data. An action card is
// { id, name, icon, kind: "passive"|"active", deltas: {stat: ±N}, effect, active, source }.
// Passive actions always contribute their deltas; active ones only while `active` is true.
// Deltas are applied BY CODE at roll time (effectiveStats) — the AI never writes stat values,
// it only ever LISTS a new ability via the machine strip below, which the player accepts.
// GM strip format (one line, extracted out of the narration like [TRACKERS]):
//   [ACTION: Name | passive | str +30, agi -2 | One-sentence effect the GM must honor.]
// Segments: name | kind(optional, default passive) | deltas(optional) | effect(optional);
// a segment starting with "icon:" supplies the icon; "source" is "story" for stripped ones.

import { clampStat } from "./stats.js";

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
// Returns a fresh object; never mutates the character.
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
    if (out[d.key] !== undefined) out[d.key] = clampStat(out[d.key], d);
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
