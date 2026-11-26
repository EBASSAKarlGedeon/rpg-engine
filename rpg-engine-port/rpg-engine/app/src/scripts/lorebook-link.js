// Lorebook link — the pure half of "pull a World Info book into a world".
//
// The Import page copies a SillyTavern World Info book into a world's lorebook once and keeps a
// snapshot in the kv registry (`lwImports`). This module is the other half: re-pulling that book
// later and replacing exactly what the previous pull wrote, without touching the world's own
// hand-written entries. It is deliberately DOM-free and kv-free (callers pass the world object and
// the registry) so the replacement rules can be unit-tested with plain objects.
//
// Identity, in order of reliability:
//   1. `entry.src = { book, uid }` — written by every pull and every new import from now on.
//   2. the recorded title set — what imports made before 2026-11 stored (they had no src tag).
//      Titles are only trusted when the book has no tagged entries in that world, because two
//      World Info entries may share a title (and an empty one).

export const REG_KEY = "lwImports";

export function contentHash(entries) {
  const rows = Object.keys(entries || {}).sort().map(function (uid) {
    const e = entries[uid] || {};
    return [uid, String(e.content || ""), e.disable === true || String(e.disable) === "true" ? "1" : "0"].join("\u0000");
  });
  return fnv1a(rows.join("\n"));
}

// Same 32-bit FNV-1a the import page uses for its identity hashes.
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16);
}

// ST World Info entry -> engine lore entry, tagged with where it came from. Disabled entries are
// skipped (an import that carried them would resurrect lore the author switched off).
export function entriesToLore(entries, bookId) {
  const out = [];
  for (const uid of Object.keys(entries || {})) {
    const e = entries[uid];
    if (!e || e.disable === true || String(e.disable) === "true") continue;
    const text = String(e.content || "").trim();
    if (!text) continue;
    const kw = [].concat(Array.isArray(e.key) ? e.key : [], Array.isArray(e.keysecondary) ? e.keysecondary : [])
      .map(function (s) { return String(s || "").trim(); })
      .filter(Boolean);
    const activation = e.constant === true ? "always" : (kw.length ? "keywords" : "always");
    out.push({
      title: String(e.comment || "").trim(),
      type: "lore",
      activation: activation,
      keywords: kw,
      content: text,
      src: { book: String(bookId), uid: String(uid) }
    });
  }
  return out;
}

function isOurs(entry, bookId, legacyTitles) {
  if (!entry || typeof entry !== "object") return false;
  if (entry.src && entry.src.book === bookId) return true;
  if (!legacyTitles || !legacyTitles.length) return false;
  const t = String(entry.title || "").toLowerCase();
  return legacyTitles.indexOf(t) !== -1;
}

export function splitWorld(worldRaw, bookId, legacyTitles) {
  const raw = Object.assign({}, worldRaw);
  let entries;
  if (typeof raw.lorebook === "string" && raw.lorebook.trim()) {
    entries = [{ title: "", type: "world", activation: "always", keywords: [], content: raw.lorebook.trim() }];
  } else {
    entries = Array.isArray(raw.lorebook) ? raw.lorebook.slice() : [];
  }
  const ours = [];
  const rest = [];
  entries.forEach(function (e) {
    if (isOurs(e, bookId, legacyTitles)) ours.push(e); else rest.push(e);
  });
  return { world: raw, ours: ours, rest: rest };
}

// Replace this book's entries in one world. The previous set is kept one level deep in
// `world.lorebookBackup[bookId]` so a pull can be undone without touching anything else.
export function replaceInWorld(worldRaw, bookId, lore, legacyTitles, now) {
  const split = splitWorld(worldRaw, bookId, legacyTitles);
  const world = split.world;
  if (split.ours.length) {
    const backup = Object.assign({}, world.lorebookBackup || {});
    backup[bookId] = { at: now || Date.now(), entries: split.ours };
    world.lorebookBackup = backup;
  }
  world.lorebook = split.rest.concat(lore);
  return { world: world, replaced: split.ours.length, kept: split.rest.length, added: lore.length };
}

// Put the backup back and drop it (one level, by design).
export function restoreInWorld(worldRaw, bookId, legacyTitles) {
  const world = Object.assign({}, worldRaw);
  const backup = Object.assign({}, world.lorebookBackup || {});
  const saved = backup[bookId];
  if (!saved || !Array.isArray(saved.entries)) return { world: world, restored: 0, empty: true };
  const split = splitWorld(world, bookId, legacyTitles);
  delete backup[bookId];
  world.lorebookBackup = backup;
  world.lorebook = split.rest.concat(saved.entries);
  return { world: world, restored: saved.entries.length, empty: false };
}

// Remove this book's entries and leave nothing behind in the backup slot.
export function removeFromWorld(worldRaw, bookId, legacyTitles) {
  const split = splitWorld(worldRaw, bookId, legacyTitles);
  const world = split.world;
  world.lorebook = split.rest;
  if (world.lorebookBackup && world.lorebookBackup[bookId]) {
    const backup = Object.assign({}, world.lorebookBackup);
    delete backup[bookId];
    world.lorebookBackup = backup;
  }
  return { world: world, removed: split.ours.length };
}
