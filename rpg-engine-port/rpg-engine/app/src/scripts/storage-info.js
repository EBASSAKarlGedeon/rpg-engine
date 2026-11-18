// storage-info.js — what the BROWSER says about this generator's storage.
// The browser's side of the Settings panel's Storage group (§6.16): `readBrowserStorage()` reads
// `navigator.storage` and feeds the **Browser report** row, which reports those figures verbatim. The
// app's own byte count — the one every other row in that group is built from — lives in backup.js.
//
// The two are deliberately NOT merged. `estimate().usage` is the browser's own bookkeeping for the whole
// origin and it refreshes lazily (a 5 MB write once moved it by ~235 kB), so it drifts below a count of
// the actual records; nor does it itemise, and its `quota` is a heuristic (roughly a share of free disk),
// not a promise. So the browser's answer is reported as the browser's answer, and the app's own sum is
// reported as the app's — `fmtBytes` is shared by both so neither shows one number in two unit systems.

const UNITS = ["B", "KB", "MB", "GB", "TB", "PB"];

// Bytes → a compact human string (`9.1 MB`, `35 MB`, `10.7 GB`). One decimal where it
// says something (9.1 MB reads better than 9 MB); whole numbers stay whole (35 MB, not 35.0 MB);
// 100+ rounds to a whole number. Labels are the familiar KB/MB/GB capitals every OS uses,
// with 1024-based steps like Windows Explorer (142000 bytes reads 139 KB).
export function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "?";
  let v = n;
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  const text = i === 0 || v >= 100 ? String(Math.round(v)) : String(parseFloat(v.toFixed(1)));
  return text + " " + UNITS[i];
}

// `{ usage, quota, persisted }`, or `{ unsupported: true }` on a browser that can't answer. `usage` and
// `quota` are exactly what the StorageManager reported (either may be undefined); `persisted` is
// true/false/null (null = the browser doesn't say). Never rejects.
export async function readBrowserStorage() {
  const sm = navigator.storage;
  if (!sm || typeof sm.estimate !== "function") return { unsupported: true };
  let est;
  try {
    est = (await sm.estimate()) || {};
  } catch (e) {
    return { unsupported: true };
  }
  let persisted = null;
  if (typeof sm.persisted === "function") {
    try { persisted = await sm.persisted(); } catch (e) { persisted = null; }
  }
  return { usage: est.usage, quota: est.quota, persisted };
}
