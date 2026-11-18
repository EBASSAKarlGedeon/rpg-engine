// Server-state bans — runtime cache (replaces hardcoded ban-list.js).
// Source of truth is server `state` (getBans). Refresh-required: fetched once
// per page load, before the first comments embed mounts.

export const BAN_TITLE = "Banned";
export const BAN_MSG = "You are banned from the Tavern and world comments. You can still use the app, but you can't publish or comment.";

export function normBanId(id) {
  return String(id == null ? "" : id).trim().toLowerCase().split("-").pop().trim();
}
export function normAppId(id) {
  return String(id == null ? "" : id).trim().toLowerCase();
}

let loaded = false;
let loadPromise = null;
// Freshness window: a cached list younger than this is reused as-is; once it
// ages past, the next non-force load fetches a new one. One constant — 5
// minutes keeps ban enforcement tight while repeated Tavern opens (and the
// publish gate) skip the RPC. Force loads always fetch.
export const BAN_CACHE_MS = 5 * 60_000;
let fetchedAt = 0;
// Negative cache: a failed fetch stamps lastFailedAt instead of fetchedAt, so
// 1006/unreachable users don't re-attempt the socket on every Tavern open.
// loadServerBans returns the stale (fail-open) snapshot until this elapses.
export const BAN_FAIL_COOLDOWN_MS = 60_000;
// Per-stage ceiling: fail-open fast instead of hanging the Tavern veil on a
// dead socket (open and rpc each get this long — worst case ~2x).
const BAN_FETCH_TIMEOUT_MS = 4000;
// force=true (panel re-open) still respects a short retry floor so spam-opens
// can't hammer a down server.
const BAN_FORCE_RETRY_MS = 15_000;
let lastFailedAt = 0;
// The cache is memory-only: a reload re-evaluates this module, so fetchedAt
// restarts at 0 and the first load after boot always fetches. Back-forward
// cache restores are the one exception (JS memory survives them) — invalidate
// there too, so a restored page refetches instead of trusting a stale stamp.
try {
  window.addEventListener("pageshow", (e) => { if (e && e.persisted) { fetchedAt = 0; lastFailedAt = 0; } });
} catch (e) {}
// How old the cache is (Infinity when nothing ever loaded — e.g. every fetch
// failed so far, which fail-open leaves as an empty list with no stamp).
export function banCacheAge() { return loaded && fetchedAt ? Date.now() - fetchedAt : Infinity; }
export function isBansFresh() { return banCacheAge() < BAN_CACHE_MS; }
function failCooldownLeft() {
  if (!lastFailedAt) return 0;
  const left = BAN_FAIL_COOLDOWN_MS - (Date.now() - lastFailedAt);
  return left > 0 ? left : 0;
}
let commentIds = [];
let appIds = [];
let commentSet = new Set();
let appSet = new Set();

function applyLists(c, a) {
  commentIds = (c || []).map(normBanId).filter(Boolean);
  appIds = (a || []).map(normAppId).filter(Boolean);
  commentSet = new Set(commentIds);
  appSet = new Set(appIds);
  loaded = true;
}

export async function loadServerBans(force = false) {
  if (!force && isBansFresh()) return { commentIds, appIds };
  // Recent failure: serve the fail-open snapshot without touching the network.
  // force=true still waits out a short floor (spam-open protection).
  try {
    const cool = failCooldownLeft();
    if (cool > 0) {
      if (!force) return { commentIds, appIds };
      if (Date.now() - lastFailedAt < BAN_FORCE_RETRY_MS) return { commentIds, appIds };
    }
  } catch (e) {}
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    let s = null;
    try {
      s = window.createServerSocket();
      const openP = Promise.resolve().then(() => s.opened);
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("ban fetch timeout")), BAN_FETCH_TIMEOUT_MS);
        openP.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
      });
      const rpcP = Promise.resolve().then(() => s.rpc.getBans(JSON.stringify({})));
      const raw = await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error("ban fetch timeout")), BAN_FETCH_TIMEOUT_MS);
        rpcP.then((v) => { clearTimeout(t); res(v); }, (e) => { clearTimeout(t); rej(e); });
      });
      try { s.close(1000, "done"); } catch (e) {}
      const o = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (o && o.ok) { applyLists(o.commentIds, o.appIds); fetchedAt = Date.now(); lastFailedAt = 0; }
      else if (!loaded) applyLists([], []);
      // Non-ok without an exception (shouldn't happen — the server answers
      // ok:true/false): treat like a failure for cooldown purposes, but keep
      // serving the stale snapshot fail-open.
      else { try { lastFailedAt = Date.now(); } catch (e) {} }
    } catch (e) {
      // Fail-open for reads (see spec §6): Tavern still opens, server catalog
      // writes remain authoritative. Stamp the failure so the next load
      // inside the cooldown reuses the snapshot instead of re-dialing.
      try { lastFailedAt = Date.now(); } catch (e2) {}
      try { if (s) s.close(1000, "done"); } catch (e3) {}
      if (!loaded) applyLists([], []);
    }
    return { commentIds, appIds };
  })();
  const out = await loadPromise;
  loadPromise = null;
  return out;
}

export function getCommentIds() { return commentIds.slice(); }
export function getAppIds() { return appIds.slice(); }
export function isBansLoaded() { return loaded; }

export function isCommentIdBanned(id) {
  const n = normBanId(id);
  return !!n && commentSet.has(n);
}
export function isAppIdBanned(id) {
  const n = normAppId(id);
  return !!n && appSet.has(n);
}

// ---- live ban pushes (server pub/sub "bans" topic) --------------------------
// One shared socket, refcounted by listeners. The server publishes a nudge on
// every banSet/banRemove; the payload carries no data, so any nudge (or any
// reconnect, which may have missed nudges) re-reads the list and then notifies
// listeners. Fail-open throughout: a dead watch just leaves the TTL snapshot.
const banWatchers = new Set();
let banWatchSocket = null;
let banWatchConnecting = null;
let banWatchGen = 0; // bumped when the last listener leaves; in-flight connects from an older generation drop their result
let banWatchRetry = 0;
let banWatchTimer = 0;
// Permanent closes: retrying can never help (same codes as community.js),
// so the watch parks until a new listener arrives.
function banWatchDead(code) { return code === 4403 || code === 4429; }
function banWatchBackoffMs() {
  const ms = 2000 * Math.pow(2, Math.min(banWatchRetry, 4));
  return Math.min(60000, ms) + Math.floor(Math.random() * 1000);
}
function banWatchFire() {
  for (const fn of [...banWatchers]) { try { fn(); } catch (e) {} }
}
function banListsKey() {
  try { return commentIds.join(",") + "|" + appIds.join(","); } catch (e) { return ""; }
}
async function banWatchResync() {
  // Conditional fire: nudges carry no data and reconnects may have missed nothing,
  // so only notify when the re-read actually changed the lists. Unchanged (reconnect
  // no-op, duplicate nudge, failed fetch keeping the stale snapshot) costs one RPC
  // and a key compare — no repaint, no self-scan (see discussion.js onBanPush).
  let before = "";
  try { before = banListsKey(); } catch (e) {}
  try { await loadServerBans(true); } catch (e) {}
  let after = "";
  try { after = banListsKey(); } catch (e) {}
  if (after === before) return false;
  banWatchFire();
  return true;
}
function banWatchOnMessage(ev) {
  let msg = null;
  try {
    const d = ev && ev.data;
    if (typeof d !== "string" || d.charCodeAt(0) !== 123) return;
    msg = JSON.parse(d);
  } catch (e) { return; }
  if (!msg || msg.type !== "changed") return;
  banWatchResync();
}
function banWatchOnClose(ev) {
  if (banWatchSocket) { try { banWatchSocket.close(1000, "done"); } catch (e) {} }
  banWatchSocket = null;
  banWatchConnecting = null;
  if (!banWatchers.size) return;
  const code = (ev && ev.code) || 0;
  if (banWatchDead(code)) return;
  banWatchRetry++;
  try { clearTimeout(banWatchTimer); } catch (e) {}
  try { banWatchTimer = setTimeout(() => { if (banWatchers.size) banWatchConnect(); }, banWatchBackoffMs()); } catch (e) {}
}
async function banWatchConnect() {
  if (banWatchSocket || banWatchConnecting || !banWatchers.size) return banWatchConnecting;
  const gen = banWatchGen;
  banWatchConnecting = (async () => {
    const s = window.createServerSocket();
    s.addEventListener("message", banWatchOnMessage);
    s.addEventListener("close", banWatchOnClose);
    await s.opened;
    try { await s.rpc.watchBans(JSON.stringify({})); } catch (e) {}
    if (gen !== banWatchGen || !banWatchers.size) { try { s.close(1000, "done"); } catch (e2) {} return; }
    banWatchSocket = s;
    banWatchRetry = 0;
    await banWatchResync();
  })().catch(() => {
    banWatchSocket = null;
    if (banWatchers.size) {
      banWatchRetry++;
      try { clearTimeout(banWatchTimer); } catch (e) {}
      try { banWatchTimer = setTimeout(() => { if (banWatchers.size) banWatchConnect(); }, banWatchBackoffMs()); } catch (e2) {}
    }
  }).finally(() => { banWatchConnecting = null; });
  return banWatchConnecting;
}
// Subscribe to live ban changes. The listener fires after every re-read
// (nudge or reconnect resync). Returns an unwatch function; the socket closes
// when the last listener leaves.
export function watchBans(fn) {  if (typeof fn === "function") banWatchers.add(fn);
  banWatchConnect();
  return () => {
    try { banWatchers.delete(fn); } catch (e) {}
    if (!banWatchers.size) {
      banWatchGen++; // orphan any in-flight connect; its result is dropped
      try { clearTimeout(banWatchTimer); } catch (e) {}
      if (banWatchSocket) { try { banWatchSocket.close(1000, "done"); } catch (e2) {} }
      banWatchSocket = null;
    }
  };
}
