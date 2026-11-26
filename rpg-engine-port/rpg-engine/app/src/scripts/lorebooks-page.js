// Lorebooks page — the management home for World Info books pulled from SillyTavern.
//
// One row per linked book: where it came from, how many entries it put in each world, whether the
// SillyTavern copy has changed since the last pull, and the four actions that are allowed here —
// Pull (replace what the last pull wrote), Unlink (stop tracking, keep the entries), Remove (delete
// the entries this book added) and Restore (put back the set the last pull replaced).
//
// Pull is one-way by design: reads go through the Loreweaver bridge's /api/worldinfo endpoints, and
// nothing in this file (or in lorebook-link.js) ever writes to SillyTavern.

import { notify } from "./notify.js";
import { REG_KEY, contentHash, entriesToLore, replaceInWorld, restoreInWorld, removeFromWorld } from "./lorebook-link.js";

const bridge = () => window.LoreweaverBridge || null;
const kv = () => (window.root && window.root.kv) || null;

async function readRegistry() {
  const v = await kv().rpg.get(REG_KEY);
  const reg = (v && typeof v === "object") ? v : {};
  reg.cards = reg.cards || {};
  reg.books = reg.books || {};
  return reg;
}
async function writeRegistry(reg) { await kv().rpg.set(REG_KEY, reg); }

async function getWorld(id) {
  const raw = await kv().worlds.get(id);
  return (raw && typeof raw === "object") ? raw : null;
}
async function setWorld(id, raw) { await kv().worlds.set(id, raw); }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}
function fmtNum(n) { return Number(n || 0).toLocaleString(); }

// Fetch the live SillyTavern copy of one book (read-only endpoints).
async function fetchBook(fileId) {
  const data = await bridge().api("/api/worldinfo/get", { name: fileId });
  const entries = (data && data.entries) || {};
  return { entries: entries, hash: contentHash(entries), lore: entriesToLore(entries, fileId) };
}

function statusOf(link, live) {
  if (!live) return { cls: "bad", text: "source unavailable" };
  if (!link.contentHash) return { cls: "warn", text: "linked before change tracking — pull to start" };
  if (link.contentHash !== live.hash) return { cls: "warn", text: "source changed — pull to update" };
  return { cls: "ok", text: "up to date" };
}

export async function mountLorebooksPage(pane, ctx) {
  if (!bridge() || !kv()) {
    pane.innerHTML = '<div class="hm-empty">This page needs to run inside Loreweaver.</div>';
    return;
  }

  pane.innerHTML = `
    <style>
      .lbx { max-width: 900px; }
      .lbx h3 { font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent, #8b9a6e); font-weight: 600; margin: 26px 2px 10px; }
      .lbx h3:first-child { margin-top: 10px; }
      .lbx-chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 4px 2px 12px; }
      .lbx-chip { background: transparent; border: 1px solid var(--border, #2a2520); color: var(--muted, #a89c82); font: inherit; font-size: 11px; letter-spacing: 1.1px; text-transform: uppercase; font-weight: 600; padding: 7px 11px; border-radius: 2px; cursor: pointer; }
      .lbx-chip:hover { color: var(--text, #e0d6b8); border-color: var(--accent, #8b9a6e); }
      .lbx-chip.on { color: var(--accent, #8b9a6e); border-color: var(--accent, #8b9a6e); background: rgba(139,154,110,.13); }
      .lbx-row { display: flex; align-items: center; gap: 14px; padding: 12px 12px; border: 1px solid var(--border, #2a2520); border-radius: 4px; margin-top: 8px; background: var(--panel, #161512); }
      .lbx-main { flex: 1; min-width: 0; }
      .lbx-name { font-weight: 600; color: var(--text, #e0d6b8); }
      .lbx-meta { font-size: 12px; color: var(--muted2, #8a8070); margin-top: 2px; }
      .lbx-st { font-size: 12px; letter-spacing: .04em; }
      .lbx-st.ok { color: #8b9a6e; } .lbx-st.warn { color: #c2a25a; } .lbx-st.bad { color: #b0735b; }
      .lbx-btns { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
      .lbx-btn { background: transparent; border: 1px solid var(--border, #2a2520); color: var(--text, #e0d6b8); font: inherit; font-size: 12px; padding: 6px 10px; border-radius: 3px; cursor: pointer; }
      .lbx-btn:hover { border-color: var(--accent, #8b9a6e); color: var(--accent, #8b9a6e); }
      .lbx-btn.primary { border-color: var(--accent, #8b9a6e); color: var(--accent, #8b9a6e); }
      .lbx-btn.danger:hover { border-color: #b0735b; color: #b0735b; }
      .lbx-btn[disabled] { opacity: .45; cursor: default; }
      .lbx-hint { color: var(--muted2, #8a8070); font-size: 13px; margin: 6px 2px; }
      .lbx-select { background: var(--panel2, #1a1a18); color: var(--text, #e0d6b8); border: 1px solid var(--border, #2a2520); border-radius: 3px; padding: 6px 8px; font: inherit; font-size: 12px; }
    </style>
    <div class="lbx">
      <div class="lbx-chips" id="lbxChips"></div>
      <div id="lbxBody"><p class="lbx-hint">Loading books…</p></div>
    </div>`;

  const body = pane.querySelector("#lbxBody");
  const chips = pane.querySelector("#lbxChips");
  let filter = "all";

  // Header action: re-read the SillyTavern side (the badge is only honest if it is recomputed).
  if (ctx && ctx.actionsEl) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hm-act";
    b.textContent = "Refresh";
    b.onclick = function () { void render(); };
    ctx.actionsEl.appendChild(b);
  }

  async function worldName(id) {
    const w = await getWorld(id);
    return (w && (w.name || w.title)) || id;
  }

  async function pull(reg, fileId) {
    const link = reg.books[fileId];
    const live = await fetchBook(fileId);
    if (!live.lore.length) throw new Error("the book has no enabled entries with content");
    const names = await Promise.all(link.worlds.map(function (w) { return worldName(w.worldId); }));
    if (!window.confirm("Replace this book's entries in " + names.length + " world(s)?\n\n" + names.join("\n") + "\n\nThe previous set is kept for one restore.")) return false;
    let total = 0;
    for (const w of link.worlds) {
      const raw = await getWorld(w.worldId);
      if (!raw) continue;
      const r = replaceInWorld(raw, fileId, live.lore, w.titles || []);
      await setWorld(w.worldId, r.world);
      w.titles = live.lore.map(function (l) { return l.title; });
      w.count = live.lore.length;
      total += r.replaced;
    }
    link.contentHash = live.hash;
    link.at = Date.now();
    link.name = link.name || "";
    await writeRegistry(reg);
    notify("Pulled " + live.lore.length + " entries (" + total + " replaced).");
    return true;
  }

  async function importInto(reg, book, worldId) {
    const live = await fetchBook(book.file_id);
    const raw = await getWorld(worldId);
    if (!raw) throw new Error("world not found");
    const r = replaceInWorld(raw, book.file_id, live.lore, []);
    await setWorld(worldId, r.world);
    const link = reg.books[book.file_id] || { worlds: [] };
    const prev = (link.worlds || []).find(function (w) { return w.worldId === worldId; });
    const rec = { worldId: worldId, titles: live.lore.map(function (l) { return l.title; }), count: live.lore.length };
    if (prev) Object.assign(prev, rec); else (link.worlds = link.worlds || []).push(rec);
    link.hash = book.file_id + "\u0000" + (book.name || "");
    link.contentHash = live.hash;
    link.name = book.name || "";
    link.at = Date.now();
    reg.books[book.file_id] = link;
    await writeRegistry(reg);
    notify("Imported " + live.lore.length + " entries from " + (book.name || book.file_id) + ".");
  }

  async function unlink(reg, fileId, worldId) {
    const link = reg.books[fileId];
    if (!link) return;
    link.worlds = (link.worlds || []).filter(function (w) { return w.worldId !== worldId; });
    if (!link.worlds.length) delete reg.books[fileId];
    await writeRegistry(reg);
    notify(worldId === "all" ? "Unlinked." : "Unlinked — the entries stay in the world.");
  }

  async function remove(reg, fileId, worldId) {
    if (!window.confirm("Delete the entries this book added" + (worldId === "all" ? " in every world" : "") + "?\nUnlink first if you only want to stop tracking.")) return;
    const link = reg.books[fileId];
    const worlds = worldId === "all" ? link.worlds.map(function (w) { return w.worldId; }) : [worldId];
    for (const wid of worlds) {
      const raw = await getWorld(wid);
      if (!raw) continue;
      const rec = (link.worlds.find(function (w) { return w.worldId === wid; }) || {});
      const r = removeFromWorld(raw, fileId, rec.titles || []);
      await setWorld(wid, r.world);
    }
    await unlink(reg, fileId, worldId === "all" ? link.worlds[0] && link.worlds[0].worldId : worldId);
    if (worldId === "all" && reg.books[fileId]) { delete reg.books[fileId]; await writeRegistry(reg); }
    notify("Removed.");
  }

  async function restore(reg, fileId, worldId) {
    const link = reg.books[fileId];
    const rec = (link.worlds || []).find(function (w) { return w.worldId === worldId; }) || {};
    const raw = await getWorld(worldId);
    if (!raw) return;
    if (!raw.lorebookBackup || !raw.lorebookBackup[fileId]) { notify("Nothing to restore for this book."); return; }
    if (!window.confirm("Put back the entries the last pull replaced? The current set is discarded.")) return;
    const r = restoreInWorld(raw, fileId, rec.titles || []);
    await setWorld(worldId, r.world);
    notify("Restored " + r.restored + " entries.");
  }

  async function render() {
    body.innerHTML = '<p class="lbx-hint">Reading SillyTavern World Info…</p>';
    let reg, books;
    try {
      reg = await readRegistry();
      books = await bridge().api("/api/worldinfo/list");
      books = Array.isArray(books) ? books : [];
    } catch (e) {
      body.innerHTML = '<p class="lbx-hint">Could not read World Info: ' + esc(e && e.message || e) + "</p>";
      return;
    }
    const bookById = {};
    books.forEach(function (b) { bookById[b.file_id] = b; });

    // world chips: every world that has at least one link
    const linkedWorlds = [];
    Object.keys(reg.books).forEach(function (id) {
      (reg.books[id].worlds || []).forEach(function (w) {
        if (!linkedWorlds.some(function (x) { return x.worldId === w.worldId; })) linkedWorlds.push({ worldId: w.worldId });
      });
    });
    // Every world is a valid import target; only the linked ones get a filter chip.
    const names = {};
    let allWorlds = [];
    try {
      const idx = (await kv().worlds.get("index")) || [];
      allWorlds = Array.isArray(idx) ? idx : [];
    } catch (e) { allWorlds = []; }
    for (const w of allWorlds) {
      const id = typeof w === "string" ? w : (w && (w.id || w.worldId));
      if (!id) continue;
      names[id] = (w && (w.name || w.title)) || id;
    }
    // A world can be deleted while a book still points at it; drop those links instead of listing ghosts.
    let pruned = false;
    for (const id of Object.keys(reg.books)) {
      const kept = (reg.books[id].worlds || []).filter(function (w) { return names[w.worldId]; });
      if (kept.length !== (reg.books[id].worlds || []).length) {
        pruned = true;
        if (kept.length) reg.books[id].worlds = kept; else delete reg.books[id];
      }
    }
    if (pruned) await writeRegistry(reg);
    for (const w of linkedWorlds) if (!names[w.worldId]) names[w.worldId] = await worldName(w.worldId);
    linkedWorlds.sort(function (a, b) { return String(names[a.worldId]).localeCompare(String(names[b.worldId])); });
    if (filter !== "all" && !linkedWorlds.some(function (w) { return w.worldId === filter; })) filter = "all";

    chips.innerHTML = "";
    const mkChip = function (id, label) {
      const c = document.createElement("button");
      c.type = "button";
      c.className = "lbx-chip" + (filter === id ? " on" : "");
      c.textContent = label;
      c.onclick = function () { filter = id; void render(); };
      chips.appendChild(c);
    };
    mkChip("all", "All worlds");
    linkedWorlds.forEach(function (w) { mkChip(w.worldId, names[w.worldId]); });

    // Linked rows
    const ids = Object.keys(reg.books);
    const linkedHtml = [];
    if (!ids.length) linkedHtml.push('<p class="lbx-hint">No book has been pulled yet. Import one from the list below — or from Import from Loreweaver → World Info.</p>');
    for (const id of ids) {
      const link = reg.books[id];
      const worlds = (link.worlds || []).filter(function (w) { return filter === "all" || w.worldId === filter; });
      if (!worlds.length) continue;
      const live = await fetchBook(id).catch(function () { return null; });
      const st = statusOf(link, live);
      const count = live ? live.lore.length : 0;
      const chars = live ? live.lore.reduce(function (n, l) { return n + l.content.length; }, 0) : 0;
      linkedHtml.push(
        '<div class="lbx-row" data-book="' + esc(id) + '">' +
        '<div class="lbx-main"><div class="lbx-name">' + esc(link.name || (bookById[id] && bookById[id].name) || id) + "</div>" +
        '<div class="lbx-meta">' + worlds.map(function (w) { return esc(names[w.worldId]); }).join(" · ") +
        (live ? " · " + fmtNum(count) + " entries · " + fmtNum(chars) + " chars" : "") + "</div>" +
        '<div class="lbx-st ' + st.cls + '">' + esc(st.text) + "</div></div>" +
        '<div class="lbx-btns">' +
        '<button class="lbx-btn primary" data-act="pull">Pull</button>' +
        (worlds.length === 1 ? '<button class="lbx-btn" data-act="restore" data-world="' + esc(worlds[0].worldId) + '">Restore</button>' : "") +
        '<button class="lbx-btn" data-act="unlink">Unlink</button>' +
        '<button class="lbx-btn danger" data-act="remove">Remove</button>' +
        "</div></div>");
    }

    // Available books
    const available = books.filter(function (b) { return !reg.books[b.file_id]; });
    const availHtml = [];
    if (!available.length) availHtml.push('<p class="lbx-hint">Every World Info book is already linked.</p>');
    else {
      availHtml.push('<div class="lbx-row" style="border-style:dashed"><div class="lbx-main"><div class="lbx-meta">Target world for new imports</div></div>' +
        '<select class="lbx-select" id="lbxTarget">' + Object.keys(names).map(function (id) { return '<option value="' + esc(id) + '">' + esc(names[id]) + "</option>"; }).join("") + "</select></div>");
      for (const b of available) {
        availHtml.push('<div class="lbx-row" data-book="' + esc(b.file_id) + '"><div class="lbx-main"><div class="lbx-name">' + esc(b.name || b.file_id) + "</div>" +
          '<div class="lbx-meta">not imported</div></div><div class="lbx-btns"><button class="lbx-btn primary" data-act="import">Import</button></div></div>');
      }
    }

    body.innerHTML = "<h3>Linked books</h3>" + linkedHtml.join("") + "<h3>Available in SillyTavern</h3>" + availHtml.join("");

    body.querySelectorAll('[data-act="pull"]').forEach(function (btn) {
      btn.onclick = async function () {
        const id = btn.closest(".lbx-row").dataset.book;
        btn.disabled = true;
        try { await pull(reg, id); } catch (e) { notify("Pull failed: " + (e && e.message || e)); } finally { btn.disabled = false; void render(); }
      };
    });
    body.querySelectorAll('[data-act="unlink"]').forEach(function (btn) {
      btn.onclick = async function () {
        const id = btn.closest(".lbx-row").dataset.book;
        const link = reg.books[id];
        const targets = filter === "all" ? link.worlds.map(function (w) { return w.worldId; }) : [filter];
        for (const wid of targets) await unlink(reg, id, wid);
        void render();
      };
    });
    body.querySelectorAll('[data-act="remove"]').forEach(function (btn) {
      btn.onclick = async function () {
        const id = btn.closest(".lbx-row").dataset.book;
        try { await remove(reg, id, filter === "all" ? "all" : filter); } catch (e) { notify("Remove failed: " + (e && e.message || e)); }
        void render();
      };
    });
    body.querySelectorAll('[data-act="restore"]').forEach(function (btn) {
      btn.onclick = async function () {
        const id = btn.closest(".lbx-row").dataset.book;
        try { await restore(reg, id, btn.dataset.world); } catch (e) { notify("Restore failed: " + (e && e.message || e)); }
        void render();
      };
    });
    body.querySelectorAll('[data-act="import"]').forEach(function (btn) {
      btn.onclick = async function () {
        const id = btn.closest(".lbx-row").dataset.book;
        const target = body.querySelector("#lbxTarget");
        const worldId = target && target.value;
        if (!worldId) { notify("Pick a target world first."); return; }
        btn.disabled = true;
        try { await importInto(reg, bookById[id] || { file_id: id }, worldId); } catch (e) { notify("Import failed: " + (e && e.message || e)); } finally { btn.disabled = false; void render(); }
      };
    });
  }

  await render();
}
