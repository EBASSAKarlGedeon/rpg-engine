// world-folders.js — the Worlds page folder system (storage + shared picker).
//
// Folders are a per-device organization layer over the Worlds library: a world (bundled, your own,
// imported, or an added community copy) can sit in at most one folder. Everything lives in
// localStorage, like the other Worlds UI prefs — no kv, no server, no migration:
//
//   mno.worlds.folders      JSON [{id, name}]                    the folders (file order is
//                                                        creation order; loadFolders() presents them alphabetically)
//   mno.worlds.folderMap    JSON {worldRecId: folderId}          world -> folder ("" / missing = unfiled)
//   mno.worlds.activeFolder the selected strip entry (`all` | `__unfiled` | folder id)
//
// `worldRecId` is `worldRecords()`' `rec.id` (bundled/mine: `meta.id`, added: `lib:<worldId>`), so one
// map covers every source without touching the world files themselves. Stale entries (deleted worlds,
// deleted folders) are pruned lazily by `pruneStale()` — called by the Worlds page, never enforced here.
//
// No app state, no imports from main.js/community.js (both import this, never the reverse).

import { TextPopup, ConfirmPopup } from "./popups.js";
import { ICON_FOLDER, ICON_FOLDER_OPEN, ICON_PENCIL, ICON_TRASH } from "./icons.js";

export const FOLDERS_KEY = "mno.worlds.folders";
export const FOLDER_MAP_KEY = "mno.worlds.folderMap";
export const ACTIVE_FOLDER_KEY = "mno.worlds.activeFolder";
export const ALL_FOLDERS = "all";
export const UNFILED = "__unfiled";
export const FOLDER_NAME_MAX = 40;

const memFallback = { folders: null, map: null, active: null };

function readLS(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function writeLS(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* private mode etc. — folders just don't persist */ }
}

function cleanName(s) {
  return String(s == null ? "" : s).trim().replace(/\s+/g, " ").slice(0, FOLDER_NAME_MAX);
}

function validFolders(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const id = String(f.id || "").trim();
    const name = cleanName(f.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name });
  }
  return out;
}

// Folders sort alphabetically (case-insensitive, natural numbers), everywhere, from the
// single choke point below — the stored file stays in creation order, presentation sorts.
function byName(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, { sensitivity: "base", numeric: true });
}

// Every folder the device has, in alphabetical order. Never throws — unreadable storage reads as [].
export function loadFolders() {
  if (memFallback.folders) return memFallback.folders.slice().sort(byName);
  try {
    const raw = readLS(FOLDERS_KEY);
    if (!raw) return [];
    return validFolders(JSON.parse(raw)).sort(byName);
  } catch (e) {
    return [];
  }
}

export function saveFolders(folders) {
  const clean = validFolders(folders);
  memFallback.folders = clean.slice();
  writeLS(FOLDERS_KEY, JSON.stringify(clean));
  return clean;
}

function newFolderId() {
  return "f_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Unique display name: "Foo", "Foo 2", "Foo 3", … (case-insensitive), so creation never fails on a clash.
function uniqueName(folders, base, ignoreId) {
  const want = cleanName(base) || "Untitled folder";
  const taken = new Set(
    folders.filter((f) => f.id !== ignoreId).map((f) => f.name.toLowerCase())
  );
  if (!taken.has(want.toLowerCase())) return want;
  let n = 2;
  while (taken.has(`${want} ${n}`.toLowerCase())) n++;
  return `${want} ${n}`.slice(0, FOLDER_NAME_MAX);
}

export function createFolder(name) {
  const folders = loadFolders();
  const folder = { id: newFolderId(), name: uniqueName(folders, name) };
  folders.push(folder);
  saveFolders(folders);
  return folder;
}

export function renameFolder(id, name) {
  const folders = loadFolders();
  const f = folders.find((x) => x.id === id);
  if (!f) return null;
  f.name = uniqueName(folders, name, id);
  saveFolders(folders);
  return f;
}

// Deleting a folder unfiles its worlds (their map entries are dropped) — worlds are never deleted.
export function deleteFolder(id) {
  saveFolders(loadFolders().filter((f) => f.id !== id));
  const map = loadMap();
  let changed = false;
  for (const k of Object.keys(map)) {
    if (map[k] === id) { delete map[k]; changed = true; }
  }
  if (changed) saveMap(map);
}

export function folderById(id) {
  return loadFolders().find((f) => f.id === id) || null;
}

// The raw world -> folder map. Keys are `worldRecords()` rec.ids; values are folder ids.
export function loadMap() {
  if (memFallback.map) return { ...memFallback.map };
  try {
    const raw = readLS(FOLDER_MAP_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k && typeof v === "string" && v) out[k] = v;
    }
    return out;
  } catch (e) {
    return {};
  }
}

export function saveMap(map) {
  const out = {};
  if (map && typeof map === "object") {
    for (const [k, v] of Object.entries(map)) {
      if (k && typeof v === "string" && v) out[k] = v;
    }
  }
  memFallback.map = { ...out };
  writeLS(FOLDER_MAP_KEY, JSON.stringify(out));
  return out;
}

// Which folder holds this world ("" = unfiled). Unknown folder ids read as unfiled.
export function folderOf(worldId) {
  if (!worldId) return "";
  const fid = loadMap()[String(worldId)] || "";
  if (!fid) return "";
  return folderById(fid) ? fid : "";
}

export function setWorldFolder(worldId, folderId) {
  if (!worldId) return;
  const map = loadMap();
  if (!folderId || !folderById(folderId)) delete map[String(worldId)];
  else map[String(worldId)] = folderId;
  saveMap(map);
}

// Drop map entries pointing at deleted folders or worlds that no longer exist.
// `validIds` is the current `worldRecords()` id set. Returns true when something was removed.
export function pruneStale(validIds) {
  const folders = loadFolders();
  const live = new Set(folders.map((f) => f.id));
  const valid = validIds instanceof Set ? validIds : new Set(validIds || []);
  const map = loadMap();
  let changed = false;
  for (const k of Object.keys(map)) {
    if (!live.has(map[k]) || (valid.size && !valid.has(k))) { delete map[k]; changed = true; }
  }
  if (changed) saveMap(map);
  return changed;
}

export function getActiveFolder() {
  if (memFallback.active) return memFallback.active;
  const raw = readLS(ACTIVE_FOLDER_KEY) || ALL_FOLDERS;
  if (raw === ALL_FOLDERS || raw === UNFILED) return raw;
  if (folderById(raw)) return raw;
  return ALL_FOLDERS;
}

// True when `id` is a real folder that still exists (not All / Unfiled).
export function isRealFolderId(id) {
  return !!id && id !== ALL_FOLDERS && id !== UNFILED && !!folderById(id);
}

// The folder a brand-new world should land in: the opened folder when one is open, else unfiled.
export function folderForNewWorld() {
  const a = getActiveFolder();
  return isRealFolderId(a) ? a : "";
}

// The folder a duplicate should land in: always the original's folder when it has one,
// else the opened folder when one is open (so duplicating an unfiled world from inside a
// folder keeps the copy visible), else unfiled.
export function folderForDuplicate(originalRecId) {
  const f = originalRecId ? folderOf(originalRecId) : "";
  if (f && folderById(f)) return f;
  return folderForNewWorld();
}

export function setActiveFolder(v) {
  const next = v === UNFILED ? UNFILED : v || ALL_FOLDERS;
  const final = next !== ALL_FOLDERS && next !== UNFILED && !folderById(next) ? ALL_FOLDERS : next;
  memFallback.active = final;
  writeLS(ACTIVE_FOLDER_KEY, final);
  return final;
}

// The shared folder list dialog behind the card's ⋮ folder entry ("Move to folder", own
// worlds and added copies alike, so the two can never drift) and the strip's manager button
// ("Folders"). `markId` gets the ✓ + open-folder mark (the world's folder in move mode, the
// active strip filter in manage mode). Each folder row carries its Rename/Delete as icon
// buttons at the row's end — after either one the dialog reopens on the updated list.
// Resolves { op: "pick", id } for a folder row, { op: "new" } for + New folder,
// { op: "none" } for Unfiled, or { op: "cancel", dirty } on cancel — `dirty` is true once a
// rename or delete has gone through, so the caller still repaints.
async function folderDialog({ title, message, markId, unfiledLabel }) {
  let dirty = false;
  for (;;) {
    const folders = loadFolders();
    const pick = await ConfirmPopup.choose({
      title,
      message,
      options: [
        { label: "+ New folder…", value: "__new__", icon: ICON_FOLDER },
        ...folders.map((f) => ({
          label: `${f.id === markId ? "✓ " : ""}${f.name}`,
          value: f.id,
          kind: f.id === markId ? "ok" : "",
          icon: f.id === markId ? ICON_FOLDER_OPEN : ICON_FOLDER,
          actions: [
            { icon: ICON_PENCIL, title: `Rename “${f.name}”`, value: `__rename:${f.id}` },
            { icon: ICON_TRASH, title: `Delete “${f.name}”`, value: `__delete:${f.id}`, cls: "warn" }
          ]
        })),
        { label: unfiledLabel, value: "__none__", kind: markId === UNFILED ? "ok" : "" }
      ],
      cancelText: "Cancel",
      list: true
    });
    if (pick === "__new__") return { op: "new", dirty };
    if (pick === "__none__") return { op: "none", dirty };
    if (typeof pick === "string" && pick.startsWith("__rename:")) {
      const folder = folderById(pick.slice("__rename:".length));
      if (folder) {
        const name = await TextPopup.open({
          title: "Rename folder",
          value: folder.name,
          placeholder: "Folder name…",
          rows: 1,
          confirmText: "Save",
          maxLength: FOLDER_NAME_MAX
        });
        if (name !== null && cleanName(name)) {
          renameFolder(folder.id, name);
          dirty = true;
        }
      }
      continue;
    }
    if (typeof pick === "string" && pick.startsWith("__delete:")) {
      const folder = folderById(pick.slice("__delete:".length));
      if (folder) {
        const n = Object.values(loadMap()).filter((fid) => fid === folder.id).length;
        const ok = await ConfirmPopup.open({
          title: "Delete folder",
          message: `Delete the folder “${folder.name}”?${n ? ` The ${n} world${n === 1 ? "" : "s"} inside become${n === 1 ? "s" : ""} Unfiled — no worlds are deleted.` : " No worlds are deleted."}`,
          confirmText: "Delete",
          danger: true
        });
        if (ok) {
          deleteFolder(folder.id);
          if (getActiveFolder() === folder.id) setActiveFolder(ALL_FOLDERS);
          dirty = true;
        }
      }
      continue;
    }
    if (typeof pick === "string" && pick && folderById(pick)) return { op: "pick", id: pick, dirty };
    return { op: "cancel", dirty };
  }
}

// The card ⋮ → Move to folder flow: files the world, creating the folder inline on + New.
// Resolves to the picked folder id, "" for Unfiled, or the world's current folder when a
// rename/delete went through before cancelling (so the caller still repaints) — else null.
export async function openMoveToFolderPicker(worldId, worldName) {
  const cur = folderOf(worldId);
  const r = await folderDialog({
    title: "Move to folder",
    message: `Choose a folder for "${String(worldName || "this world").slice(0, 80)}".`,
    markId: cur,
    unfiledLabel: cur ? "Unfiled (remove from folder)" : "Unfiled (no folder)"
  });
  if (r.op === "new") {
    const name = await TextPopup.open({
      title: "New folder",
      value: "",
      placeholder: "Folder name…",
      rows: 1,
      confirmText: "Create",
      maxLength: FOLDER_NAME_MAX
    });
    if (name === null || !cleanName(name)) return r.dirty ? folderOf(worldId) : null;
    const created = createFolder(name);
    setWorldFolder(worldId, created.id);
    return created.id;
  }
  if (r.op === "none") {
    setWorldFolder(worldId, null);
    return "";
  }
  if (r.op === "pick") {
    setWorldFolder(worldId, r.id);
    return r.id;
  }
  return r.dirty ? folderOf(worldId) : null;
}

// The strip's manager button: the same list standalone. Picking a row (or creating one, or
// Unfiled) resolves to the filter the strip should show; cancelling after a rename/delete
// resolves to the current filter (so the caller still repaints), else null.
export async function openFolderManager() {
  const r = await folderDialog({
    title: "Folders",
    message: "Manage and open your folders.",
    markId: getActiveFolder(),
    unfiledLabel: "Unfiled"
  });
  if (r.op === "new") {
    const name = await TextPopup.open({
      title: "New folder",
      value: "",
      placeholder: "Folder name…",
      rows: 1,
      confirmText: "Create",
      maxLength: FOLDER_NAME_MAX
    });
    if (name === null || !cleanName(name)) return r.dirty ? getActiveFolder() : null;
    return createFolder(name).id;
  }
  if (r.op === "none") return UNFILED;
  if (r.op === "pick") return r.id;
  return r.dirty ? getActiveFolder() : null;
}
