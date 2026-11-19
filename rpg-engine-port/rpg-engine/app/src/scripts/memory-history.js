// memory-history.js — the layered narrative history spine ([rpge-patch 009]).
//
// A Summaryception-style recursive summary that is ALWAYS fed to the GM: every few turns a
// small "delta snippet" is written against everything already summarized (only the narrative
// delta — nothing repeated), and when a layer fills up its oldest snippets merge into the next
// layer down, recursively. The whole history renders oldest→newest in a bounded token budget
// (default 10000), covering potentially thousands of turns in roughly that budget forever.
//
// Design decisions (user-locked 2026-11-18, see handoff §8):
//   cadence: snippets cover 5 turns, first run when the session reaches turn 10;
//   layer shape: 30 snippets/layer, merge 3 on promotion; first promotion into an EMPTY layer
//   takes the single oldest snippet verbatim as the SEED (no LLM call — Summaryception rule);
//   budget: 10000 tokens (setting in the History panel; clamped under the bridged context
//   budget); importance-3 verbatim commitments live in the memory system (pinned), not here.
//
// The snippets are stored on the session (`state.memories.history`) and sync with saves like
// everything else. `summarizedUpTo` counts ANCHORED player turns (actions + directs, the same
// turn notion the roll-up uses) fully covered by snippets; `MEMORY_LAG_TURNS` behind the live
// edge, matching the roll-up's lag so never-summarized recent prose isn't double-fed.

import { messageTurns, isNonStoryMessage, renderRollUpLines, lagStartIndex, str } from "./memory-system.js";

export const HISTORY_SNIPPET_TURNS = 5;   // anchored turns per layer-0 snippet
export const HISTORY_START_TURN = 10;     // first snippet runs when the session turn reaches this
export const HISTORY_LAYER_CAP = 30;      // snippets per layer before promotion
export const HISTORY_MERGE = 3;           // snippets merged per promotion
export const HISTORY_MAX_LAYERS = 5;      // depth cap; a full deepest layer self-merges
export const HISTORY_BUDGET_TOKENS = 10000;
export const HISTORY_TOKEN_MARGIN = 300;  // headroom under the budget (estimator noise)
const EST_CHARS_PER_TOKEN = 4.0;          // same fallback estimator the roll-up uses

// The config lives in localStorage (per-device, like the bridge config): the budget is a
// device/model property, not a session property. Overridable in the History panel.
export function historyConfig() {
  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem("rpge.memoryHistory") || "null") || {}; } catch (e) {}
  const n = Number(cfg.budgetTokens);
  return { budgetTokens: Number.isFinite(n) && n >= 2000 ? Math.min(50000, Math.round(n)) : HISTORY_BUDGET_TOKENS };
}
export function setHistoryBudget(tokens) {
  try {
    const n = Math.min(50000, Math.max(2000, Math.round(Number(tokens)) || HISTORY_BUDGET_TOKENS));
    localStorage.setItem("rpge.memoryHistory", JSON.stringify({ budgetTokens: n }));
    return n;
  } catch (e) { return HISTORY_BUDGET_TOKENS; }
}

// Effective render budget: never exceed the bridged context budget minus what the rest of the
// prompt needs headroom for. Without a bridged cap (legacy Perchance) the configured budget
// stands alone — the history block is fed unmeasured there, exactly like the old digest.
export function effectiveBudget() {
  let cap = null;
  try {
    const c = JSON.parse(localStorage.getItem("rpge.loreweaverBridge") || "null");
    if (c && c.enabled === true) {
      const n = Number(c.contextTokens);
      cap = Number.isFinite(n) && n >= 2048 ? Math.min(200000, Math.round(n)) : 16384;
    }
  } catch (e) {}
  const cfg = historyConfig().budgetTokens;
  return cap !== null ? Math.max(2000, Math.min(cfg, cap - 2000)) : cfg;
}

// Normalize a stored history: tolerate anything an old/corrupt save carries.
export function normalizeHistory(raw) {
  const h = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw : {};
  const layers = [];
  const src = Array.isArray(h.layers) ? h.layers : [];
  for (const l of src.slice(0, HISTORY_MAX_LAYERS)) {
    const arr = Array.isArray(l) ? l : [];
    const clean = [];
    for (const s of arr) {
      if (!s || typeof s !== "object") continue;
      const text = str(s.text).trim();
      if (!text) continue;
      clean.push({ text, from: Math.max(1, Math.round(Number(s.from)) || 1), to: Math.max(1, Math.round(Number(s.to)) || 1) });
    }
    layers.push(clean);
  }
  while (layers.length < 1) layers.push([]);
  return { layers, summarizedUpTo: Math.max(0, Math.round(Number(h.summarizedUpTo)) || 0) };
}

function ensureHistory(state) {
  if (!state.memories) state.memories = { auto: [], manual: [], digest: "" };
  state.memories.history = normalizeHistory(state.memories.history);
  return state.memories.history;
}

// Anchored-turn ordinals per message (same notion as the roll-up's turn numbers).
function anchoredTurns(messages) {
  const turnAt = messageTurns(messages);
  let total = 0;
  for (const t of turnAt) total = Math.max(total, t);
  return { turnAt, total };
}

// How many anchored turns are still unsummarized (informational — panel stats).
export function pendingTurns(state) {
  if (!state || !state.messages) return 0;
  const h = state.memories && state.memories.history ? normalizeHistory(state.memories.history) : { summarizedUpTo: 0 };
  const { total } = anchoredTurns(state.messages);
  return Math.max(0, total - h.summarizedUpTo);
}

// Should the next snippet run? Cadence: the session has reached HISTORY_START_TURN and at
// least HISTORY_SNIPPET_TURNS unsummarized (lagged) turns are waiting.
export function historyDue(state) {
  if (!state || !state.messages || !(state.turn >= HISTORY_START_TURN)) return false;
  const msgs = state.messages;
  const end = lagStartIndex(msgs, 3); // keep 3 recent turns unsummarized — they're still verbatim
  const h = ensureHistory(state);
  const { turnAt } = anchoredTurns(msgs);
  let covered = 0;
  for (let i = 0; i < end; i++) {
    if (!isNonStoryMessage(msgs[i])) covered = turnAt[i];
  }
  return covered - h.summarizedUpTo >= HISTORY_SNIPPET_TURNS;
}

// The delta summarizer prompt: prior context = every existing snippet (all layers, oldest
// first, trimmed to a char budget so very deep histories stay bounded); input = the next
// snippet's turns verbatim. Output: ONE prose snippet of ONLY the narrative delta.
function buildSnippetPrompt(priorText, heroName, block, turnMin, turnMax) {
  return [
    "You are the story historian for a text-based RPG. You will be given the PRIOR CONTEXT — compressed summaries of everything that happened so far — and a new passage of RECENT EVENTS.",
    "Write ONE compact prose snippet summarizing ONLY what the new passage adds: new plot points, decisions, promises or deals made, reveals, relationship changes, arrivals/departures, state changes (who holds what, who knows what, where things stand now).",
    "RULES:",
    "- Include NOTHING the prior context already covers — characters, settings, relationships and facts recorded there are established; do not restate them.",
    "- Use characters' exact names. NEVER invent facts not present in the passage.",
    "- Nameless characters are described by role (\"the hero's two unnamed guards\"), never given invented names.",
    "- Past tense, third person, factual, dense. No headings, no bullets, no preamble — reply with the snippet text ONLY.",
    `- Target length: 40–90 words${priorText ? "" : " (this is the FIRST snippet — establish the who/where/what that later snippets will rely on)"}.`,
    priorText ? "PRIOR CONTEXT (everything already recorded — do not repeat any of it):\n" + priorText : "PRIOR CONTEXT: (none yet — this is the first snippet)",
    `HERO: ${heroName}`,
    `RECENT EVENTS (turns ${turnMin}–${turnMax}):\n${block}`,
  ].join("\n\n");
}

// Promotion: the oldest HISTORY_MERGE snippets of layer L merge into ONE snippet of layer L+1
// (context-aware, against that deeper layer's existing content). First entry into an EMPTY
// deeper layer is the SEED rule: the single oldest snippet is copied verbatim, no LLM call.
// A full deepest layer self-merges (coverage per snippet keeps growing). Returns the list of
// genText calls to make, or null entries for seed moves. `genText` may be null for seed moves.
async function promoteOnce(state, genText, heroName) {
  const h = ensureHistory(state);
  // find the shallowest layer that is over cap
  let L = -1;
  for (let i = 0; i < h.layers.length; i++) {
    if (h.layers[i].length >= HISTORY_LAYER_CAP) { L = i; break; }
  }
  if (L < 0) return false;
  const src = h.layers[L];
  const deep = L + 1;
  const isEmpty = (h.layers[deep] || []).length === 0;
  if (deep >= HISTORY_MAX_LAYERS) {
    // deepest layer: self-merge — the 3 oldest snippets merge into one appended at the END
    // (they stay in place chronologically as a merged record; order within the layer shifts,
    // but the layer's text remains oldest-first overall because the merged text summarizes
    // those oldest snippets).
    return await mergeSnippets(state, genText, heroName, src, src.splice(0, HISTORY_MERGE), L);
  }
  if (!h.layers[deep]) h.layers[deep] = [];
  if (isEmpty) {
    // SEED: move the single oldest snippet verbatim (no LLM call — maximum information).
    const seed = src.shift();
    h.layers[deep].push({ ...seed });
    return true;
  }
  const batch = src.splice(0, HISTORY_MERGE);
  return await mergeSnippets(state, genText, heroName, h.layers[deep], batch, deep);
}

// One promotion merge: summarize `batch` against the destination layer's existing content.
async function mergeSnippets(state, genText, heroName, dest, batch, depth) {
  if (!genText) return false; // no AI available — leave the batch in place (retry later)
  const priorText = dest.map((s) => s.text).join("\n");
  const batchText = batch.map((s) => s.text).join("\n\n");
  const instruction = [
    "You compress story-history snippets into ONE snippet for a deeper memory layer of a text-based RPG.",
    "Write ONE compact prose snippet covering ONLY the narrative delta the INPUT adds to the PRIOR CONTEXT — merge overlapping points, drop restatements, keep every distinct fact (names, promises, deals, reveals, state changes).",
    "Same rules as always: exact character names; nameless characters stay role-descriptions; past tense, third person, no headings or bullets; reply with the snippet text ONLY. Target 40–90 words.",
    `PRIOR CONTEXT (layer ${depth} — do not repeat):\n${priorText || "(none)"}`,
    `INPUT (snippets to merge):\n${batchText}`,
  ].join("\n\n");
  try {
    const res = await genText({ instruction, route: "memory" });
    const out = String((res && res.text) || res || "").trim();
    if (!out) return false;
    dest.push({ text: out, from: batch[0].from, to: batch[batch.length - 1].to });
    return true;
  } catch (e) {
    console.warn("[history] promotion merge failed:", e && e.message);
    return false;
  }
}

// Run ONE snippet: summarize the next HISTORY_SNIPPET_TURNS unsummarized turns (oldest first,
// behind the lag window), append to layer 0, then run promotions while any layer is over cap.
// Returns { snippet: true|false, promotions: n } — false means nothing was runnable this call.
export async function runHistorySnippet(state, genText) {
  const msgs = state.messages || [];
  if (!msgs.length) return { snippet: false, promotions: 0 };
  const h = ensureHistory(state);
  const end = lagStartIndex(msgs, 3);
  const { turnAt } = anchoredTurns(msgs);
  // find the message span covering the next HISTORY_SNIPPET_TURNS distinct unsummarized
  // ANCHORED TURNS (a turn = action + its reply messages — count turns, not messages).
  let startMsg = -1, endMsg = end, from = 0, to = 0;
  let count = 0, lastT = -1;
  for (let i = 0; i < end; i++) {
    const m = msgs[i];
    if (isNonStoryMessage(m)) { if (startMsg >= 0) endMsg = i + 1; continue; } // rides along inside the span
    const t = turnAt[i];
    if (t <= h.summarizedUpTo) {
      if (startMsg >= 0) { endMsg = i; break; } // gap (shouldn't happen — spans are contiguous)
      continue;
    }
    if (startMsg < 0) { startMsg = i; from = t; }
    if (t !== lastT) { count++; lastT = t; }
    if (count > HISTORY_SNIPPET_TURNS) { endMsg = i; break; } // the 6th turn starts — exclude it
    endMsg = i + 1;
    to = t;
  }
  if (startMsg < 0 || count < HISTORY_SNIPPET_TURNS) return { snippet: false, promotions: 0 };
  const heroName = String(((state.character || {}).name) || "").trim() || "the hero";
  // prior context: all snippets oldest→newest, char-trimmed to keep the prompt bounded
  const allSnips = [];
  for (let l = h.layers.length - 1; l >= 0; l--) for (const s of h.layers[l] || []) allSnips.push(s.text);
  let prior = allSnips.join("\n");
  if (prior.length > 12000) prior = "…(older layers trimmed)…\n" + prior.slice(-12000);
  const block = renderRollUpLines(msgs, turnAt, startMsg, endMsg);
  const instruction = buildSnippetPrompt(prior, heroName, block.lines.join("\n"), block.turnMin || from, block.turnMax || to);
  let text = "";
  try {
    const res = await genText({ instruction, route: "memory" });
    text = String((res && res.text) || res || "").trim();
  } catch (e) {
    console.warn("[history] snippet call failed:", e && e.message);
    return { snippet: false, promotions: 0 };
  }
  if (!text) return { snippet: false, promotions: 0 };
  // defensive: a reply wrapped in a code fence still yields prose
  const fenced = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  if (fenced && fenced[1].trim()) text = fenced[1].trim();
  h.layers[0].push({ text, from, to });
  h.summarizedUpTo = to;
  let promotions = 0;
  for (let guard = HISTORY_MAX_LAYERS * 2 + 2; guard > 0; guard--) {
    const done = await promoteOnce(state, genText, heroName);
    if (!done) break;
    promotions++;
  }
  return { snippet: true, promotions };
}

// Render the whole history oldest→newest within the token budget. Over budget → trim the
// SHALLOWEST layer's oldest snippets first (they carry the least turn-coverage per token).
// Returns "" when there is nothing recorded yet.
export function renderHistory(state) {
  const h = state && state.memories && state.memories.history ? normalizeHistory(state.memories.history) : null;
  if (!h) return "";
  const est = (t) => Math.ceil(String(t).length / EST_CHARS_PER_TOKEN);
  const budget = effectiveBudget() - HISTORY_TOKEN_MARGIN;
  // collect (layerIdx, snippetIdx) from deepest (oldest) to shallowest (newest), each layer oldest-first
  const order = [];
  for (let l = h.layers.length - 1; l >= 0; l--) {
    const arr = h.layers[l] || [];
    for (let i = 0; i < arr.length; i++) order.push([l, i]);
  }
  let tokens = 0;
  const kept = [];
  for (const [l, i] of order) {
    const t = est(h.layers[l][i].text);
    // the newest tail (layer 0's last snippet) is always kept — the freshest summary never drops
    const isTail = l === 0 && i === (h.layers[0] || []).length - 1;
    if (kept.length && tokens + t > budget && !isTail) continue;
    kept.push([l, i]);
    tokens += t;
  }
  if (!kept.length) return "";
  const keptSet = new Set(kept.map(([l, i]) => l + ":" + i));
  const out = [];
  for (const [l, i] of kept) {
    const s = h.layers[l][i];
    const span = s.from && s.to ? (s.from === s.to ? `turn ${s.from}` : `turns ${s.from}–${s.to}`) : "";
    out.push(span ? `- (${span}) ${s.text}` : `- ${s.text}`);
  }
  return out.join("\n");
}

// Stats for the History panel: snippets per layer, coverage span, estimated tokens.
export function historyStats(state) {
  const h = state && state.memories && state.memories.history ? normalizeHistory(state.memories.history) : null;
  if (!h) return { layers: [], coveredTo: 0, tokens: 0, snippets: 0 };
  let tokens = 0, snippets = 0, coveredTo = 0;
  const layers = [];
  for (let l = 0; l < h.layers.length; l++) {
    const arr = h.layers[l] || [];
    if (!arr.length && l > 0) { layers.push(0); continue; }
    layers.push(arr.length);
    for (const s of arr) { tokens += Math.ceil(s.text.length / EST_CHARS_PER_TOKEN); snippets++; coveredTo = Math.max(coveredTo, s.to); }
  }
  return { layers, coveredTo, tokens, snippets };
}

// Invalidate everything from an anchored turn onward (edit/reroll/delete): drop snippets whose
// span reaches it, in any layer, and recompute the covered cursor.
export function invalidateFromTurn(state, turnOrdinal) {
  if (!state) return false;
  const h = ensureHistory(state);
  let changed = false;
  for (let l = 0; l < h.layers.length; l++) {
    const before = (h.layers[l] || []).length;
    h.layers[l] = (h.layers[l] || []).filter((s) => s.to < turnOrdinal);
    if ((h.layers[l] || []).length !== before) changed = true;
  }
  let covered = 0;
  for (const arr of h.layers) for (const s of arr) covered = Math.max(covered, s.to);
  if (h.summarizedUpTo !== covered) { h.summarizedUpTo = covered; changed = true; }
  return changed;
}

// Is a backlog build available for this session? (long transcript, nothing summarized yet)
export function backlogEligible(state) {
  if (!state || !state.messages) return false;
  const h = state.memories && state.memories.history ? normalizeHistory(state.memories.history) : null;
  const summarized = h ? h.summarizedUpTo : 0;
  if (summarized > 0) return false;
  const digest = str(state.memories && state.memories.digest).trim();
  if (digest) return false; // will be migrated instead
  const { turnAt, total } = anchoredTurns(state.messages);
  let storyTurns = 0;
  for (let i = 0; i < state.messages.length; i++) if (!isNonStoryMessage(state.messages[i])) storyTurns = Math.max(storyTurns, turnAt[i]);
  return storyTurns >= 15 && total >= 20;
}

// Migrate a legacy digest into the layer stack as a deep seed (digest retirement, plan §8c).
// Returns true when a migration happened.
export function migrateDigest(state) {
  if (!state || !state.memories) return false;
  const digest = str(state.memories.digest).trim();
  if (!digest) return false;
  const h = ensureHistory(state);
  const already = (h.layers[1] || []).some((s) => s.migrated);
  if (already || h.summarizedUpTo > 0) return false;
  if (!h.layers[1]) h.layers[1] = [];
  h.layers[1].push({ text: digest, from: 1, to: 1, migrated: true });
  try { state.memories.digest = ""; } catch (e) {}
  return true;
}
