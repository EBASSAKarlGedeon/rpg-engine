// Loreweaver storage mirror: persist the RPG Engine's saves server-side so Loreweaver's
// Phase 2 sync carries them between devices.
//
// WHY
//   The engine stores adventures, the hero library and the world library in a browser
//   IndexedDB kv store ("folders" rpg / worlds, see perchance-shim.js). IndexedDB is
//   device-bound: it never syncs. This shim wraps those kv folders and mirrors every write
//   into data/<user>/rpg-engine/kv/ on the Loreweaver server through /api/rpg-engine-kv/* —
//   a directory the sync engine now carries (SYNCED_DIRS includes rpg-engine).
//
// HOW
//   - IndexedDB stays the primary store: reads/writes are local and instant, and the game
//     keeps working offline and when the page is served standalone (python http.server).
//   - Every mutating kv call (set / setMany / update / delete / deleteMany / clear) is
//     mirrored to the server (debounced per key). Mirrored folders: rpg, worlds.
//     NOT mirrored: embvec (regenerable embedding vectors, megabytes) and community
//     (deprecated features).
//   - On boot the shim reconciles, so saves synced from another device flow into this
//     browser: server-newer values are loaded into IndexedDB, local-only values are pushed,
//     and tombstones (server-side delete markers) remove locally deleted entries.
//   - Conflict rule: when both sides changed since the last known sync, the SERVER value
//     wins and the local value is preserved server-side as <name>.conflict-<ts>.json (it
//     syncs too; the game UI doesn't read these yet). mtime of the server file decides.
//
// CONFIG
//   localStorage["rpge.serverSaves"] = { enabled: false }  — turns mirroring off (default on).
//
// LIMITATIONS (v1)
//   - Reconcile runs at page load only; saves synced in mid-session appear at next load.
//   - Conflict copies are preserved but not yet surfaced in the game UI.
(function () {
  "use strict";

  const CFG_KEY = "rpge.serverSaves";
  const META_KEY = "rpge.kvMeta";
  const MIRROR_FOLDERS = ["rpg", "worlds"];
  // [rpge-patch 018 fix] A fresh browser used to clobber the server on boot: the app's own
  // initialization writes (e.g. worlds/index normalization) pushed the LOCAL empty state to
  // the server BEFORE the first reconcile had pulled anything — every fresh boot zeroed the
  // server's worlds index (the real data survived only as conflict copies). Writes are now
  // gated: until the first reconcile completes, a push is only allowed for keys the server
  // does not have; keys the server HAS are left alone and merged by the reconcile.
  let firstSyncDone = false;
  const serverNames = new Set();
  const DEBOUNCE_MS = 400;

  function readCfg() {
    try {
      const c = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
      return c && typeof c === "object" ? c : {};
    } catch (e) { return {}; }
  }
  const isEnabled = () => readCfg().enabled !== false;

  // ---- opaque, filesystem-safe entry names (base64url of "folder\u0000key") ----
  const b64url = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unb64url = (s) => {
    s = s.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    return decodeURIComponent(escape(atob(s)));
  };
  const nameOf = (folder, key) => b64url(folder + "\u0000" + String(key)) + ".json";
  const DATA_RE = /^[A-Za-z0-9_-]+\.json$/;
  const TOMB_RE = /^[A-Za-z0-9_-]+\.tomb\.json$/;
  const CONFLICT_MARK = ".conflict-";
  const parseDataName = (name) => {
    if (!DATA_RE.test(name) || name.includes(CONFLICT_MARK)) return null;
    try {
      const dec = unb64url(name.slice(0, -5)); // strip ".json"
      const i = dec.indexOf("\u0000");
      if (i <= 0) return null;
      return { folder: dec.slice(0, i), key: dec.slice(i + 1) };
    } catch (e) { return null; }
  };

  // ---- per-key sync bookkeeping (last pushed server mtime) ----
  function readMeta() {
    try { const m = JSON.parse(localStorage.getItem(META_KEY) || "{}"); return m && typeof m === "object" ? m : {}; } catch (e) { return {}; }
  }
  function writeMeta(m) {
    try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch (e) { /* non-fatal */ }
  }
  const metaKey = (folder, key) => folder + "\u0000" + String(key);

  // ---- server API (same session + CSRF as the rest of Loreweaver) ----
  let tokenPromise = null;
  function getToken() {
    if (!tokenPromise) {
      tokenPromise = fetch(new URL("/csrf-token", location.origin), { credentials: "include" })
        .then((r) => { if (!r.ok) throw new Error("/csrf-token " + r.status); return r.json(); })
        .then((j) => { if (!j || !j.token) throw new Error("no csrf token"); return j.token; })
        .catch((e) => { tokenPromise = null; throw e; });
    }
    return tokenPromise;
  }
  async function api(op, body) {
    const token = await getToken();
    const send = () => fetch(new URL("/api/rpg-engine-kv/" + op, location.origin), {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
      body: JSON.stringify(body || {}),
    });
    let res = await send();
    if (res.status === 403) { // csrf token rotated — refresh once and retry
      tokenPromise = null;
      const t2 = await getToken();
      res = await fetch(new URL("/api/rpg-engine-kv/" + op, location.origin), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": t2 },
        body: JSON.stringify(body || {}),
      });
    }
    if (!res.ok) throw new Error("rpg-engine-kv/" + op + " returned " + res.status);
    return res.json();
  }

  // ---- write-through mirroring ----
  const timers = new Map(); // metaKey -> timeout
  function schedule(folder, key, fn) {
    const mk = metaKey(folder, key);
    clearTimeout(timers.get(mk));
    timers.set(mk, setTimeout(() => { timers.delete(mk); fn(); }, DEBOUNCE_MS));
  }

  function mirrorFolder(name, folder) {
    const wrapped = Object.create(folder); // reads pass through to the local store
    const pushValue = async (key, value) => {
      if (!firstSyncDone && serverNames.has(nameOf(name, key))) {
        console.warn("[rpge saves] skipped pre-sync push of", name + "/" + key, "— server copy not yet loaded; first reconcile will merge it.");
        return;
      }
      try {
        const r = await api("put", { name: nameOf(name, key), content: JSON.stringify(value === undefined ? null : value) });
        const m = readMeta();
        m[metaKey(name, key)] = r.mtimeMs;
        writeMeta(m);
      } catch (e) {
        console.warn("[rpge saves] server push failed for", name + "/" + key, "(kept locally, retried next load):", (e && e.message) || e);
      }
    };
    const pushDelete = async (key) => {
      if (!firstSyncDone && serverNames.has(nameOf(name, key))) {
        console.warn("[rpge saves] skipped pre-sync delete of", name + "/" + key, "— server copy not yet loaded; first reconcile will merge it.");
        return;
      }
      try {
        await api("delete", { name: nameOf(name, key) });
        const m = readMeta();
        delete m[metaKey(name, key)];
        writeMeta(m);
      } catch (e) {
        console.warn("[rpge saves] server delete failed for", name + "/" + key, "(retried next load):", (e && e.message) || e);
      }
    };
    wrapped.set = async function (key, value) {
      const out = await folder.set(key, value);
      schedule(name, key, () => pushValue(key, value));
      return out;
    };
    wrapped.setMany = async function (obj) {
      const out = await folder.setMany(obj);
      for (const [k, v] of Object.entries(obj || {})) schedule(name, k, () => pushValue(k, v));
      return out;
    };
    wrapped.update = async function (key, fn) {
      const out = await folder.update(key, fn);
      schedule(name, key, () => pushValue(key, out === undefined ? undefined : out));
      return out;
    };
    wrapped.delete = async function (key) {
      const out = await folder.delete(key);
      schedule(name, key, () => pushDelete(key));
      return out;
    };
    wrapped.deleteMany = async function (keys) {
      const out = await folder.deleteMany(keys);
      for (const k of keys || []) schedule(name, k, () => pushDelete(k));
      return out;
    };
    wrapped.clear = async function () {
      const out = await folder.clear();
      // wipe the whole folder server-side so a boot reconcile cannot resurrect keys
      schedule(name, "\u0000clear", async () => {
        if (!firstSyncDone) { console.warn("[rpge saves] skipped pre-sync server wipe of", name); return; }
        try {
          const { entries } = await api("list", {});
          const mine = entries.filter((e) => {
            const p = parseDataName(e.name);
            return p && p.folder === name;
          });
          for (const e of mine) await api("delete", { name: e.name });
          const m = readMeta();
          for (const e of mine) { const p = parseDataName(e.name); delete m[metaKey(p.folder, p.key)]; }
          writeMeta(m);
        } catch (e) {
          console.warn("[rpge saves] server clear failed for", name, ":", (e && e.message) || e);
        }
      });
      return out;
    };
    return wrapped;
  }

  // ---- boot reconcile (server <-> local) ----
  async function reconcile(origKv) {
    const { entries } = await api("list", {});
    for (const e of entries) serverNames.add(e.name);
    const tombs = {};
    const data = {};
    for (const e of entries) {
      if (TOMB_RE.test(e.name)) tombs[e.name.slice(0, -TOMB_SUFFIX_LEN)] = e;
      else if (parseDataName(e.name)) data[e.name] = e;
    }
    const meta = readMeta();
    const seen = new Set();
    for (const [name, srv] of Object.entries(data)) {
      const p = parseDataName(name);
      if (!p || !MIRROR_FOLDERS.includes(p.folder)) continue;
      seen.add(name);
      const folder = origKv[p.folder];
      if (!folder) continue;
      const pushed = meta[metaKey(p.folder, p.key)] || 0;
      if (srv.mtimeMs <= pushed) continue; // unchanged since our last push
      const { content } = await api("get", { name });
      if (content === null || content === undefined) continue;
      let serverValue;
      try { serverValue = JSON.parse(content); } catch (e) { console.warn("[rpge saves] unparseable server value for", name); continue; }
      const localValue = await folder.get(p.key);
      if (localValue !== undefined && localValue !== null) {
        let localJson;
        try { localJson = JSON.stringify(JSON.parse(JSON.stringify(localValue))); } catch (e) { localJson = "??"; }
        if (localJson === content.trim()) {
          // same value, just a different mtime (e.g. rewritten identically) — adopt
          meta[metaKey(p.folder, p.key)] = srv.mtimeMs;
          continue;
        }
        // both sides changed: server wins into the browser, local version is preserved
        // server-side as a conflict copy (it syncs; the UI surfaces these later).
        try {
          await api("put", { name: b64url(p.folder + "\u0000" + String(p.key)) + CONFLICT_MARK + Date.now() + ".json", content: localJson });
          console.warn("[rpge saves] CONFLICT on", p.folder + "/" + p.key, "— server version loaded, your version kept as a conflict copy.");
        } catch (e) {
          console.warn("[rpge saves] conflict copy failed for", p.folder + "/" + p.key, ":", (e && e.message) || e);
        }
      }
      await folder.set(p.key, serverValue);
      meta[metaKey(p.folder, p.key)] = srv.mtimeMs;
    }
    // local-only keys: push unless a newer tombstone says another device deleted them
    for (const fname of MIRROR_FOLDERS) {
      const folder = origKv[fname];
      if (!folder) continue;
      let localKeys;
      try { localKeys = await folder.keys(); } catch (e) { continue; }
      for (const key of localKeys) {
        const nm = nameOf(fname, key);
        if (data[nm]) continue;
        const pushed = meta[metaKey(fname, key)] || 0;
        const tomb = tombs[nm.slice(0, -5)]; // ".json" stripped to match tomb key
        if (tomb && tomb.mtimeMs > pushed) {
          try { await folder.delete(key); } catch (e) { /* local delete is best-effort */ }
          delete meta[metaKey(fname, key)];
          continue;
        }
        const value = await folder.get(key);
        if (value === undefined) continue;
        try {
          const r = await api("put", { name: nm, content: JSON.stringify(JSON.parse(JSON.stringify(value))) });
          meta[metaKey(fname, key)] = r.mtimeMs;
        } catch (e) {
          console.warn("[rpge saves] initial push failed for", fname + "/" + key, ":", (e && e.message) || e);
        }
      }
    }
    writeMeta(meta);
    firstSyncDone = true; // from here on, ordinary writes push through as user intent
  }

  const TOMB_SUFFIX_LEN = ".tomb.json".length;
  let origKvRef = null;

  function init(origKv) {
    origKvRef = origKv;
    // Wrap the kv proxy so every folder access returns a mirrored folder.
    const wrappedCache = {};
    const proxy = new Proxy({}, {
      get(_, prop) {
        if (typeof prop !== "string") return undefined;
        if (!MIRROR_FOLDERS.includes(prop)) return origKv[prop];
        if (!wrappedCache[prop]) wrappedCache[prop] = mirrorFolder(prop, origKv[prop]);
        return wrappedCache[prop];
      },
    });
    try { window.root.kv = proxy; } catch (e) { console.warn("[rpge saves] could not install mirrored kv:", e); return; }
    if (!isEnabled()) { console.info("[rpge saves] server-side saves disabled by config."); return; }
    // Know the server's entry names as early as possible — pre-sync writes must not clobber
    // server data the browser hasn't loaded yet (see the gate above pushValue/pushDelete).
    api("list", {}).then(({ entries }) => { for (const e of entries) serverNames.add(e.name); }).catch(() => {});
    // Reconcile shortly after boot so the app's own reads see server data; failures are
    // non-fatal (the game keeps working on IndexedDB alone).
    const go = () => reconcile(origKv)
      .then(() => {
        console.info("[rpge saves] server-side saves synced.");
        // Tell late-boot pages (import/bridge panels read kv before this lands) so they can
        // re-render from server data instead of staying on their pre-sync (empty) view.
        try { window.dispatchEvent(new Event("rpge-saves-synced")); } catch (e) {}
      })
      .catch((e) => console.warn("[rpge saves] server-side saves unavailable (local only):", (e && e.message) || e));
    if (window.requestIdleCallback) window.requestIdleCallback(go, { timeout: 12000 });
    else setTimeout(go, 3000);
  }

  // perchance-shim.js must have run already (it defines root.kv).
  if (window.root && window.root.kv) init(window.root.kv);
  else document.addEventListener("DOMContentLoaded", () => {
    if (window.root && window.root.kv) init(window.root.kv);
    else console.warn("[rpge saves] no kv plugin found; server-side saves inactive.");
  });

  // console/debug API
  window.LoreweaverSaves = {
    isEnabled,
    meta: readMeta,
    reconcileNow: () => (origKvRef ? reconcile(origKvRef) : Promise.reject(new Error("no kv"))),
  };

  // [rpge-patch 003] external world writes: the import page (and future sync) posts on this
  // channel when the worlds library changes; forward it to the game page so the Worlds list
  // refreshes live (main.js listens for the "rpge-worlds-changed" window event).
  try {
    const bc = new BroadcastChannel("rpge-kv");
    bc.onmessage = (e) => {
      if (e && e.data && e.data.type === "worlds-changed") {
        try { window.dispatchEvent(new Event("rpge-worlds-changed")); } catch (err) {}
      }
    };
  } catch (e) { /* BroadcastChannel unsupported — next page load still sees the world */ }
})();
