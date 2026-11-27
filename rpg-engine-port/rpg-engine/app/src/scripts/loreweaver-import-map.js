// Pure mapping helpers for "Import from Loreweaver" (app/src/scripts/loreweaver-import.js).
//
// Kept free of DOM/kv access so the SillyTavern -> RPG Engine conversion rules can be unit
// tested directly (tests/rpg/loreweaver-import-map.test.js). Every rule here exists because the
// two formats disagree about something:
//
//   SillyTavern World Info     RPG Engine lorebook
//   key / keys                 keywords (OR within the list)
//   keysecondary + selective   secondary + selective: AND with the primary list (native now)
//   use_regex                  useRegex: the engine runs the key as a regex, as authored
//   probability                probability: per-turn chance; 0 is skipped as never-firing
//   order                      order: priority tiebreak in the engine's lore ranking
//   position 4 + role + depth  role/depth: insert into the transcript instead of WORLD LORE
//   constant                   activation "always"
//   disable (book) / enabled  entry is skipped entirely
//   comment                    title (may be empty; empty titles must never be used as a
//                              deletion key when a linked import is refreshed)
//
//   SillyTavern chat            RPG Engine adventure
//   user_name / message .name   the HERO's name (the card is the AI side, not the player)
//   {{char}} / {{user}}         resolved to concrete names - the engine has no {{char}}

// ---- flags ----

/** SillyTavern writes booleans as JSON booleans, but imported/vault cards also carry "true"/"false". */
export function truthyFlag(v) {
  return v === true || String(v).toLowerCase() === "true" || v === 1 || v === "1";
}

/** A World Info / character-book entry the author switched off. Covers both spellings. */
export function entryDisabled(e) {
  if (!e || typeof e !== "object") return true;
  if (e.disable === true || String(e.disable).toLowerCase() === "true") return true;
  if (e.enabled === false || String(e.enabled).toLowerCase() === "false") return true;
  return false;
}

// ---- text/keywords ----

function str(v) {
  return v === undefined || v === null ? "" : String(v);
}

function strList(v) {
  const raw = Array.isArray(v) ? v : (v === undefined || v === null ? [] : [v]);
  return raw.map((s) => str(s).trim()).filter(Boolean);
}

/** De-duplicate case-insensitively while keeping the author's casing. */
export function dedupeKeywords(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const k = str(raw).trim();
    if (!k) continue;
    const key = k.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out;
}

/** Regex keys are patterns: preserve `|`, braces and escapes exactly; de-dupe exact strings only. */
export function dedupeRegexKeywords(list) {
  const out = [];
  const seen = new Set();
  for (const raw of list || []) {
    const k = str(raw).trim();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

// World Info role numbers (0 system, 1 user, 2 assistant), plus the string spellings.
function worldInfoRole(v) {
  const s = str(v).trim().toLowerCase();
  if (s === "0" || s === "system") return "system";
  if (s === "1" || s === "user") return "user";
  if (s === "2" || s === "assistant") return "assistant";
  return "";
}

// Depth is messages back from the newest one; SillyTavern's default is 4 when position is 4.
function worldInfoDepth(v) {
  if (v === undefined || v === null || v === "") return 4;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(999, Math.trunc(n))) : 4;
}

// ---- World Info book -> lorebook ----

/** One /api/worldinfo/get entry -> one engine lorebook entry (or null when it must be skipped). */
export function loreFromWorldInfoEntry(e) {
  if (entryDisabled(e)) return null;
  // probability 0 means "never fire" in SillyTavern; importing it as always-on would invert the
  // author's intent. Every other chance is carried as-is and rolled by the engine per turn. A
  // missing/null chance means "default", not zero (Number(null) is 0, which used to drop entries).
  const rawProbability = e && e.probability;
  const probability = rawProbability === undefined || rawProbability === null || rawProbability === "" ? NaN : Number(rawProbability);
  if (Number.isFinite(probability) && probability <= 0) return null;
  const content = str(e.content).trim();
  if (!content) return null;
  const useRegex = truthyFlag(e.use_regex) || truthyFlag(e.useRegex);
  let keywords = useRegex
    ? dedupeRegexKeywords([].concat(strList(e.key), strList(e.keys)))
    : dedupeKeywords([].concat(strList(e.key), strList(e.keys)));
  let secondary = useRegex
    ? dedupeRegexKeywords([].concat(strList(e.keysecondary), strList(e.secondary_keys)))
    : dedupeKeywords([].concat(strList(e.keysecondary), strList(e.secondary_keys)));
  // A legacy entry with only secondary keys had no primary trigger in SillyTavern either, but
  // the old importer promoted them; keep that rescue rather than silently turning it always-on.
  if (!keywords.length && secondary.length) { keywords = secondary; secondary = []; }
  const selective = truthyFlag(e.selective) && keywords.length > 0 && secondary.length > 0;
  const order = Number(e.order);
  const position = Number(e.position);
  const role = position === 4 ? worldInfoRole(e.role) : "";
  const depth = position === 4 ? worldInfoDepth(e.depth) : null;
  const title = str(e.comment || e.name).trim();
  const out = {
    title,
    type: loreTypeForWorldEntry(title),
    activation: truthyFlag(e.constant) || !keywords.length ? "always" : "keywords",
    keywords,
    content,
  };
  if (Number.isFinite(order) && order !== 0) out.order = Math.trunc(order);
  if (Number.isFinite(probability) && probability !== 100) out.probability = Math.max(0, Math.min(100, probability));
  if (selective) { out.selective = true; out.secondary = secondary; }
  if (useRegex) out.useRegex = true;
  // Only "at depth" (position 4) needs the transcript. Before/after-character and author's-note
  // positions already live in the engine's standing lore context, so they stay standard lore.
  if (position === 4 && role) { out.role = role; out.depth = depth; }
  return out;
}

// SillyTavern has no lore-entry type, so the importer has to guess one. Places matter beyond the
// GM prompt: the map subsystem only reads "world"/"location" entries (MAP_LORE_TYPES), so typing
// every card entry "character" left imported worlds with no geographic canon at all.
const LAW_TITLE = /\b(rules?|laws?|policy|policies|code of conduct|commandments?)\b/i;
const PLACE_TITLE = /\b(house|home|room|campus|diner|street|town|city|village|school|college|university|library|bar|club|beach|forest|desert|cabin|apartment|store|shop|motel|hotel|restaurant|park|office|gym|dorm|court|church|temple|hospital|station|airport|harbor|port|island|mountain|river|lake|cave|ruins|castle|palace|tavern|inn|market|garden|yard|porch|kitchen|bedroom|bathroom)\b/i;

/** World Info has no entry types: only promote the unambiguous place/rule titles, keep the rest lore. */
export function loreTypeForWorldEntry(title) {
  const t = str(title);
  if (LAW_TITLE.test(t)) return "law";
  if (PLACE_TITLE.test(t)) return "location";
  return "lore";
}

export function loreTypeForTitle(title) {
  const t = str(title);
  if (LAW_TITLE.test(t)) return "law";
  if (PLACE_TITLE.test(t)) return "location";
  return "character";
}

/** A card as an engine NPC. Macros are resolved here because the engine only knows {{user}}. */
export function npcFromCard(card, avatar) {
  const c = card || {};
  const name = str(c.name).trim();
  const persona = [c.description, c.personality]
    .map((s) => resolveCharMacro(str(s).trim(), name))
    .filter(Boolean)
    .join("\n\n");
  return {
    name: name,
    age: "", gender: "", race: "", appearance: "", job: "",
    persona: persona,
    secrets: "",
    extra: resolveCharMacro(str(c.scenario).trim(), name),
    avatar: avatar || "",
  };
}

/** The engine has no {{char}} macro; imported prose must not leak the braces into prompts or the UI. */
export function resolveCharMacro(text, charName) {
  const name = str(charName).trim() || "the character";
  return str(text).replace(/\{\{char\}\}/gi, name);
}

/** One embedded character_book entry -> one engine lorebook entry. */
export function loreFromCardEntry(e, charName) {
  if (entryDisabled(e)) return null;
  const rawProbability = e && e.probability;
  const probability = rawProbability === undefined || rawProbability === null || rawProbability === "" ? NaN : Number(rawProbability);
  if (Number.isFinite(probability) && probability <= 0) return null;
  const content = str(e.content).trim();
  if (!content) return null;
  const useRegex = truthyFlag(e.use_regex) || truthyFlag(e.useRegex);
  let keywords = (useRegex
    ? dedupeRegexKeywords([].concat(strList(e.keys), strList(e.key)))
    : dedupeKeywords([].concat(strList(e.keys), strList(e.key)))
  ).map((k) => resolveCharMacro(k, charName));
  let secondary = (useRegex
    ? dedupeRegexKeywords([].concat(strList(e.secondary_keys), strList(e.keysecondary)))
    : dedupeKeywords([].concat(strList(e.secondary_keys), strList(e.keysecondary)))
  ).map((k) => resolveCharMacro(k, charName));
  if (!keywords.length && secondary.length) { keywords = secondary; secondary = []; }
  const selective = truthyFlag(e.selective) && keywords.length > 0 && secondary.length > 0;
  const order = Number(e.order);
  const position = Number(e.position);
  const role = position === 4 ? worldInfoRole(e.role) : "";
  const depth = position === 4 ? worldInfoDepth(e.depth) : null;
  const title = resolveCharMacro(str(e.comment || e.name).trim(), charName) || (keywords[0] || "");
  const out = {
    title,
    type: loreTypeForTitle(title),
    activation: truthyFlag(e.constant) || !keywords.length ? "always" : "keywords",
    keywords,
    content: resolveCharMacro(content, charName),
  };
  if (Number.isFinite(order) && order !== 0) out.order = Math.trunc(order);
  if (Number.isFinite(probability) && probability !== 100) out.probability = Math.max(0, Math.min(100, probability));
  if (selective) { out.selective = true; out.secondary = secondary; }
  if (useRegex) out.useRegex = true;
  if (position === 4 && role) { out.role = role; out.depth = depth; }
  return out;
}

/** The card's embedded lorebook, in both flat and `data`-wrapped card shapes. */
export function cardBookEntries(card) {
  const book = (card && card.data && card.data.character_book) || (card && card.character_book) || null;
  const entries = book && Array.isArray(book.entries) ? book.entries : [];
  return entries;
}

export function buildCardLore(card) {
  const lore = [];
  const titles = [];
  for (const e of cardBookEntries(card)) {
    const entry = loreFromCardEntry(e, card && card.name);
    if (!entry) continue;
    lore.push(entry);
    if (entry.title) titles.push(entry.title);
  }
  return { lore, titles };
}

// ---- linked-import bookkeeping ----

const normTitle = (v) => str(v).trim().toLowerCase();

/** Tracked titles for a link record. Accepts entry objects and the plain strings the registry stores. */
export function importedTitleSet(entries) {
  const set = new Set();
  for (const e of entries || []) {
    const raw = typeof e === "string" ? e : (e && e.title);
    const t = normTitle(raw);
    if (t) set.add(t);
  }
  return set;
}

/** Content hashes let a refresh recognise its own untitled entries without using "" as a key. */
export function importedContentHashes(entries) {
  const set = new Set();
  for (const e of entries || []) {
    const c = str(e && e.content).trim();
    if (c) set.add(fnv1a(c));
  }
  return set;
}

/**
 * Remove only what THIS import previously added.
 *
 * The old code filtered by `new Set(w.titles)` and `w.titles` could contain "", which matched
 * every untitled entry in the world - including entries the player had written by hand. A title
 * match is still the primary key; for imported entries that never had a title, exact content is
 * the only safe marker. Renamed entries are left in place (a duplicate is recoverable, a deleted
 * hand-written entry is not).
 */
export function stripPreviousImport(book, trackedTitles, trackedHashes, freshEntries) {
  const titles = trackedTitles instanceof Set ? trackedTitles : importedTitleSet(trackedTitles);
  const hashes = trackedHashes instanceof Set ? trackedHashes : importedContentHashes(trackedHashes);
  const freshContents = new Set(
    (freshEntries || []).map((e) => str(e && e.content).trim()).filter(Boolean),
  );
  // Link records written before titles/hashes were tracked have no marker at all; an exact
  // content match is the only safe way to recognise their entries on that first refresh.
  const legacy = titles.size === 0 && hashes.size === 0;
  return (Array.isArray(book) ? book : []).filter((e) => {
    if (!e || typeof e !== "object") return true;
    const title = normTitle(e.title);
    const content = str(e.content).trim();
    if (title) {
      if (titles.has(title)) return false;
      if (legacy && content && freshContents.has(content)) return false;
      return true;
    }
    if (!content) return true;
    if (hashes.has(fnv1a(content))) return false;
    // Untitled legacy entries: exact content match is the only marker they have.
    return !freshContents.has(content);
  });
}

// ---- character card -> hero/world ----

function fnv1a(strValue) {
  let h = 0x811c9dc5;
  const s = String(strValue == null ? "" : strValue);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * What "source changed" means for a linked card import. It must cover everything the import
 * copies: prose, greetings, tags and the embedded book. The old hash only looked at
 * description/personality/scenario, so editing the lorebook never lit up "update".
 */
export function cardImportHash(card) {
  const c = card || {};
  const alt = Array.isArray(c.alternate_greetings)
    ? c.alternate_greetings
    : ((c.data && Array.isArray(c.data.alternate_greetings)) ? c.data.alternate_greetings : []);
  const tags = [].concat(Array.isArray(c.tags) ? c.tags : [], (c.data && Array.isArray(c.data.tags)) ? c.data.tags : []);
  const book = cardBookEntries(c).map((e) => [
    str(e && (e.comment || e.name)),
    strList(e && (e.keys || e.key)),
    strList(e && (e.secondary_keys || e.keysecondary)),
    str(e && e.content),
    entryDisabled(e) ? "off" : "on",
    truthyFlag(e && e.constant) ? "constant" : "",
  ].join("\u0001"));
  return fnv1a([
    str(c.description),
    str(c.personality),
    str(c.scenario),
    str(c.first_mes),
    alt.join("\u0001"),
    tags.join("\u0001"),
    str(c.system_prompt || (c.data && c.data.system_prompt)),
    str(c.creator_notes || c.creatorcomment || (c.data && c.data.creator_notes)),
    book.join("\u0002"),
  ].join("\u0000"));
}

// ---- chat -> adventure ----

const GENERIC_PLAYER_NAMES = new Set(["", "unused", "user", "you", "player", "user name", "char"]);

/**
 * The hero is the PLAYER, not the card. Prefer the chat's stored user_name, then the first user
 * message's name (SillyTavern writes the active persona's name there), then "You". Never return
 * the AI card's name - that is what made imported adventures call the player by the bot's name.
 */
export function chatPlayerName(meta, msgs, charName) {
  const m = meta || {};
  const stored = str(m.user_name).trim();
  if (!GENERIC_PLAYER_NAMES.has(stored.toLowerCase())) return stored;
  const bot = str(charName).trim().toLowerCase();
  for (const msg of msgs || []) {
    if (!msg || !msg.is_user) continue;
    const name = str(msg.name).trim();
    if (!name) continue;
    if (GENERIC_PLAYER_NAMES.has(name.toLowerCase())) continue;
    if (bot && name.toLowerCase() === bot) continue;
    return name;
  }
  return "You";
}

/** Turn 1 is the opening; each imported player message is one further turn (not each message). */
export function chatTurnCount(msgs) {
  const turns = (msgs || []).filter((m) => m && m.role === "user").length;
  return Math.max(1, turns);
}

/** Convert SillyTavern messages to engine messages and resolve the macros the engine lacks. */
export function chatMessagesToImport(msgs, opts) {
  const charName = str(opts && opts.charName).trim();
  const playerName = str(opts && opts.playerName).trim() || "You";
  const out = [];
  for (const m of msgs || []) {
    if (!m || typeof m.mes !== "string") continue;
    let text = m.mes.trim();
    if (!text) continue;
    // The engine substitutes {{user}} in prompts but has no {{char}} concept, and the transcript
    // renders raw text - so both are resolved at import time instead of leaking braces to the UI.
    text = text.replace(/\{\{char\}\}/gi, charName || "the character");
    text = text.replace(/\{\{user\}\}/gi, playerName);
    out.push({
      role: m.is_user ? "user" : (m.is_system ? "action" : "assistant"),
      text,
      ts: Date.parse(m.send_date || "") || Date.now(),
    });
  }
  return out;
}
