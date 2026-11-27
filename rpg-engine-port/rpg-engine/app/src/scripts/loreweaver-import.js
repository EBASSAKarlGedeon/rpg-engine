import { mountChatImport } from "./chat-import.js";
import { MAX_SAVED_HEROES } from "./storage.js";
import {
  buildCardLore,
  cardImportHash,
  resolveCharMacro,
  npcFromCard,
  loreFromWorldInfoEntry,
  importedTitleSet,
  importedContentHashes,
  stripPreviousImport,
} from "./loreweaver-import-map.js";
// [rpge-patch 018] Import from Loreweaver — the landing page that used to be the floating
// loreweaver-import.html overlay. Its logic is ported verbatim from that page (the shims
// it needs — perchance-shim's window.root.kv, loreweaver-bridge.js — are already loaded in
// the app frame, and writes mirror to the Loreweaver server through loreweaver-storage.js
// exactly as before). Only the chrome changed: it now mounts into #homeMain as a landing
// page, with the app's page-header shape.
export async function mountImportsPage(pane, ctx) {
  // `pane` is the page's .hm-body (setHomePage builds the header) — everything renders inside it.
  pane.innerHTML = `
    <style>
      .lwimp { max-width: 760px; }
      /* Internal tab strip for the three import flows — styled after the Worlds header
         action buttons (.hm-act): boxed, letterspaced uppercase, accent when active. */
      .lwimp-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 8px 2px 10px; }
      .lwimp-tab { background: transparent; border: 1px solid var(--border, #2a2520); color: var(--muted, #a89c82); font: inherit; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; font-weight: 600; padding: 8px 12px; border-radius: 2px; cursor: pointer; white-space: nowrap; }
      .lwimp-tab:hover { color: var(--text, #e0d6b8); border-color: var(--accent, #8b9a6e); }
      .lwimp-tab.on { color: var(--accent, #8b9a6e); border-color: var(--accent, #8b9a6e); background: rgba(139,154,110,.13); }
      .lwimp-tab[hidden], .lwimp-pane[hidden], .lwimp-worldbox[hidden] { display: none; }
      .lwimp-worldbox { margin: 0 2px 6px; }
      .lwimp h2.lwimp-h { font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); font-weight: 600; margin: 30px 0 8px; }
      .lwimp-pane > h2.lwimp-h:first-child { margin-top: 14px; }
      .lwimp p { color: var(--muted, #a89c82); }
      .lwimp .hint { font-size: 13px; color: var(--muted2, #8a8070); margin-top: 4px; }
      .lwimp .prow { display: flex; align-items: center; gap: 14px; padding: 12px 10px; border: 1px solid var(--border, #2a2520); border-radius: 4px; margin-top: 10px; background: var(--panel, #161512); }
      .lwimp .prow img { width: 52px; height: 52px; border-radius: 4px; object-fit: cover; background: var(--panel2, #1a1a18); flex: none; }
      .lwimp .pmain { flex: 1; min-width: 0; }
      .lwimp .pname { font-weight: 600; color: var(--text, #e0d6b8); }
      .lwimp .pbadge { display: inline-block; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: #11100e; background: var(--accent, #8b9a6e); border-radius: 2px; padding: 1px 6px; margin-left: 8px; vertical-align: 2px; }
      .lwimp .pdesc { font-size: 13px; color: var(--muted2, #8a8070); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .lwimp .pstatus { font-size: 12px; color: var(--muted2, #8a8070); }
      .lwimp .pstatus.st-ok { color: #7bd07b; }
      .lwimp .pstatus.st-changed { color: #e0b060; }
      .lwimp .pbtns { display: flex; gap: 8px; flex: none; }
      .lwimp button { padding: 8px 14px; background: var(--panel2, #1a1a18); border: 1px solid var(--accent, #8b9a6e); color: var(--accent, #8b9a6e); font: inherit; cursor: pointer; border-radius: 2px; flex: none; }
      .lwimp button.secondary { border-color: var(--border, #3a3528); color: var(--text, #e0d6b8); }
      .lwimp button:disabled { opacity: .45; cursor: default; }
      .lwimp #lwimpMsg { margin-top: 18px; min-height: 1.5em; }
      .lwimp .ok { color: #7bd07b; } .lwimp .bad { color: #e06666; } .lwimp .info { color: var(--muted, #a89c82); }
      .lwimp select { width: 100%; box-sizing: border-box; padding: 8px 10px; background: var(--panel2, #1a1a18); border: 1px solid var(--border, #2a2520); color: var(--text, #e0d6b8); font: inherit; border-radius: 2px; }
      .lwimp label.lbl { display: block; margin: 14px 0 4px; font-size: 12px; letter-spacing: .1em; text-transform: uppercase; color: var(--muted2, #8a8070); }
      .lwimp code { color: var(--text, #e0d6b8); background: var(--panel2, #1a1a18); padding: 1px 5px; }
    </style>
    <div class="lwimp">
      <div class="lwimp-tabs" role="tablist">
        <button type="button" class="lwimp-tab" data-tab="personas">👤 Personas → Heroes</button>
        <button type="button" class="lwimp-tab" data-tab="cards">🎭 Cards → NPCs</button>
        <button type="button" class="lwimp-tab" data-tab="books">📖 World Info → Lore</button>
        <button type="button" class="lwimp-tab" data-tab="chats">💬 Chats → Adventures</button>
      </div>
      <div class="lwimp-worldbox" id="lwimpWorldBox" hidden>
        <label class="lbl" for="lwimpTargetWorld">Target world</label>
        <select id="lwimpTargetWorld"><option value="">Loading worlds…</option></select>
      </div>
      <div class="lwimp-pane" data-pane="personas">
        <h2 class="lwimp-h" style="margin-top:6px">Personas → hero library</h2>
        <p>Import your <b>Loreweaver personas</b> as saved heroes. A linked snapshot is created in the
        game's hero library — forge a hero, and <b>Load</b> it from the library in any world. Mapping:
        name → <b>Name</b>, description → <b>Persona</b>, avatar → <b>Portrait</b>; the other bio fields
        stay blank for you to fill in the game (stats are always per-world and never imported).</p>
        <p class="hint">The import keeps a link to the source persona. Come back here to check for
        changes — updating overwrites only the imported fields (Name, Persona, Portrait), never
        anything you added in the game.</p>
        <div id="lwimpList">Loading personas…</div>
      </div>
      <div class="lwimp-pane" data-pane="cards">
        <h2 class="lwimp-h" style="margin-top:6px">Character cards → world NPCs</h2>
        <p>Add a Loreweaver <b>character</b> as a standing NPC in one of the game's worlds. Mapping:
        name → <b>Name</b>, description + personality → <b>Persona</b>, scenario → <b>Extra
        details</b>, card image → avatar. Fill the rest (race, appearance…) in the game's World
        Editor. New adventures see the NPC at once; a RUNNING adventure picks it up on its next
        load.</p>
        <div id="lwimpChars">Loading characters…</div>
      </div>
      <div class="lwimp-pane" data-pane="chats"></div>
      <div class="lwimp-pane" data-pane="books">
        <h2 class="lwimp-h" style="margin-top:6px">World Info → world lorebook</h2>
        <p>Copy a Loreweaver <b>World Info</b> book into the selected world's lorebook. Keywords
        (secondary keys merged in) → triggers, constant entries → always-on, comment → title.
        ST macros like <code>{{user}}</code>/<code>{{char}}</code> stay literal — edit them in the
        World Editor if needed.</p>
        <div id="lwimpBooks">Loading World Info…</div>
      </div>
      <div id="lwimpMsg" role="status"></div>
    </div>`;

  const $ = (id) => pane.querySelector("#" + id);
  const say = (t, cls) => { const m = $("lwimpMsg"); m.textContent = t; m.className = cls || ""; };

  // Every engine-initiated import changes lists the game may already be showing (landing counts,
  // the worlds grid, the hero shelf, adventures). Repaint them in place — no reload, no lost state.
  function afterImport() {
    const a = window.mnoApp || {};
    for (const fn of ["refreshLanding", "repaintWorldsPage", "refreshUserPage", "refreshAddedWorlds"]) {
      try { if (typeof a[fn] === "function") a[fn](); } catch (e) { /* a page that isn't mounted may not refresh */ }
    }
  }

  // ---- tab strip: three import flows, one visible at a time (chrome only — logic below is
  // untouched; everything renders regardless of the active tab). The last tab is remembered.
  const TABS = ["personas", "cards", "books", "chats"];
  let curTab = "personas";
  try { curTab = localStorage.getItem("rpge.importTab") || "personas"; } catch (e) {}
  if (!TABS.includes(curTab)) curTab = "personas";
  function showTab(t) {
    curTab = t;
    try { localStorage.setItem("rpge.importTab", t); } catch (e) {}
    pane.querySelectorAll(".lwimp-tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    pane.querySelectorAll(".lwimp-pane").forEach((p) => { p.hidden = p.dataset.pane !== t; });
    // The target-world selector is shared by the cards and books tabs; personas don't need it.
    const wb = $("lwimpWorldBox");
    if (wb) wb.hidden = t === "personas";
  }
  pane.querySelectorAll(".lwimp-tab").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  showTab(curTab);
  void mountChatImport(pane.querySelector('[data-pane="chats"]'));

  // Small non-crypto content hash (fnv1a hex) — enough to notice a source change.
  function fnv1a(str) {
    var h = 0x811c9dc5, i, c;
    str = String(str || "");
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      h ^= c; h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return ("00000000" + h.toString(16)).slice(-8);
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Downscale an avatar image to a compact JPEG dataURL (engine portraits are stored inline).
  function toPortraitDataUrl(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var MAX = 256, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var s = Math.min(1, MAX / Math.max(w, h));
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL("image/jpeg", 0.85));
        } catch (e) { resolve(""); }
      };
      img.onerror = function () { resolve(""); };
      img.src = url;
    });
  }

  // same downscale for world covers, but larger (the Worlds list renders covers ~400px tall)
  function toCoverDataUrl(url) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        try {
          var MAX = 1024, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
          var s = Math.min(1, MAX / Math.max(w, h));
          var cv = document.createElement("canvas");
          cv.width = Math.max(1, Math.round(w * s)); cv.height = Math.max(1, Math.round(h * s));
          cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
          resolve(cv.toDataURL("image/jpeg", 1.0)); // user call 2026-11-18: max quality, 1024px cap kept
        } catch (e) { resolve(""); }
      };
      img.onerror = function () { resolve(""); };
      img.src = url;
    });
  }

  function personaAvatarUrl(id) { return "/User%20Avatars/" + encodeURIComponent(id); }
  // List tiles only. The thumbnail endpoint renders 96x144 by default (config
  // thumbnails.dimensions.avatar), which is fine for a 52px row but destroys stored art — importing
  // an NPC avatar or a world cover from it is what made both look pixelated.
  function cardThumbUrl(avatar) { return "/thumbnail?type=avatar&file=" + encodeURIComponent(avatar); }
  // The card's own file at whatever resolution it was imported with. Stored art always comes from here.
  function cardImageUrl(avatar) { return "/characters/" + encodeURIComponent(avatar); }

  // ---- linked-snapshot registry (kv.rpg "lwImports") ----
  const REG_KEY = "lwImports";
  async function regRead() {
    const v = await window.root.kv.rpg.get(REG_KEY);
    const reg = (v && typeof v === "object") ? v : {};
    reg.cards = reg.cards || {}; reg.books = reg.books || {};
    return reg;
  }
  async function regWrite(reg) { await window.root.kv.rpg.set(REG_KEY, reg); }
  async function regRecord(reg, kind, srcId, rec) { reg[kind][srcId] = rec; await regWrite(reg); }

  async function loadWorldRaw(id) {
    const raw = await window.root.kv.worlds.get(id);
    return (raw && typeof raw === "object") ? raw : null;
  }

  // ---- personas -> hero library ----
  async function heroList() {
    const v = await window.root.kv.rpg.get("savedHeroes");
    return Array.isArray(v) ? v : [];
  }
  async function saveHeroList(list) {
    // Same rule as HeroStore.save: never evict the oldest hero to make room. This page writes
    // savedHeroes directly, so it needs the cap too — `shift()` here silently deleted a hero when
    // a 41st persona was imported.
    if (list.length > MAX_SAVED_HEROES) {
      const err = new Error("The saved-hero library is full (" + MAX_SAVED_HEROES + "). Delete a slot in Saved Heroes first - nothing was overwritten.");
      err.code = "hero-limit";
      err.limit = MAX_SAVED_HEROES;
      throw err;
    }
    await window.root.kv.rpg.set("savedHeroes", list);
  }
  function findLinkedHero(list, srcId) {
    return list.find(function (h) { return h && h.lwSource && h.lwSource.type === "persona" && h.lwSource.id === srcId; }) || null;
  }
  async function importPersona(p) {
    const list = await heroList();
    const existing = findLinkedHero(list, p.id);
    const portrait = await toPortraitDataUrl(personaAvatarUrl(p.id));
    const rec = existing || {
      id: "h_" + Math.random().toString(36).slice(2, 10),
      gender: "", race: "", age: "", job: "", appearance: "", extra: ""
    };
    rec.name = p.name || "";
    rec.label = p.name || rec.label || "Unnamed";
    rec.persona = p.description || "";
    if (portrait) rec.portrait = portrait;
    rec.savedAt = Date.now();
    rec.lwSource = { type: "persona", id: p.id, name: p.name || "", descHash: fnv1a(p.description), importedAt: Date.now() };
    if (existing) {
      const i = list.findIndex(function (h) { return h.id === existing.id; });
      list[i] = rec;
    } else {
      list.push(rec);
    }
    await saveHeroList(list);
    return { created: !existing };
  }

  // ---- character cards -> world NPCs / standalone worlds ----
  // Covers greetings/tags/embedded book too, so a lorebook edit shows as "source changed"
  // (the old description/personality/scenario-only hash never did).
  const cardHash = cardImportHash;

  // The list endpoint returns only file_id/name/extensions — never the entries — so hashing those
  // two fields marked every edited book "up to date" forever. Content is fetched for linked books
  // once per list render and folded into the hash; the stored hash uses the same entries payload.
  function bookHash(b, data) {
    const entries = data && data.entries ? data.entries : null;
    return fnv1a([b.file_id, b.name, entries ? JSON.stringify(entries) : ""].join("\u0000"));
  }
  function linkedBookHash(b) { return b.__hash || bookHash(b); }

  function buildNpcFromCard(card) {
    return npcFromCard(card, card.avatar ? cardImageUrl(card.avatar) : "");
  }

  function slugifyWorldName(name) {
    let x = String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
    return x || "world";
  }

  async function freshWorldId(name, idx) {
    const base = slugifyWorldName(name);
    const taken = new Set(idx.map(function (w) { return w.id; }));
    for (let n = 1; ; n++) {
      const tail = n === 1 ? "" : "-" + n;
      const cand = (base.length + tail.length > 40) ? base.slice(0, 40 - tail.length) + tail : base + tail;
      if (taken.has(cand)) continue;
      // The index is a cache: a failed/stale read must not let a new world overwrite the blob
      // already stored under this id. Check the world itself before reusing a slug.
      let exists = false;
      try { exists = !!(await window.root.kv.worlds.get(cand)); } catch (e) { exists = false; }
      if (!exists) return cand;
    }
  }

  async function refreshWorldImport(card, w) {
    const raw = await loadWorldRaw(w.worldId);
    if (!raw) return false;
    const fresh = buildCardLore(card);
    const wf = cardWorldFields(card);
    // Legacy imports wrote the card description as a "Rules" law entry in addition to
    // worldDescription. Only that legacy shape (no tracked titles/hashes) is cleaned up: once a
    // link has tracked entries, a "Rules" entry may be something the player wrote and must stay.
    const legacyLink = !Array.isArray(w.titles) && !Array.isArray(w.hashes);
    raw.lorebook = (Array.isArray(raw.lorebook) ? raw.lorebook : []).filter(function (e) {
      return !(legacyLink && e && typeof e === "object" && e.type === "law" && e.activation === "always"
        && String(e.title || "").trim().toLowerCase() === "rules" && (!e.keywords || !e.keywords.length));
    });
    // Only this card's previous entries are removed. Untitled entries are matched by content
    // hash, never by "" (which used to delete every hand-written untitled entry in the world).
    raw.lorebook = stripPreviousImport(
      raw.lorebook,
      importedTitleSet(w.titles),
      new Set(Array.isArray(w.hashes) ? w.hashes : []),
      fresh.lore,
    );
    raw.lorebook.push(...fresh.lore);
    if (wf.story) raw.worldDescription = wf.story;
    if (wf.scenario) raw.scenario = wf.scenario;
    // Replace the previously imported vibe instead of appending it again: the old code grew
    // narrativeVibe by one "---" segment on every refresh.
    const prevVibe = String(w.vibe || "").trim();
    let vibeBase = String(raw.narrativeVibe || "").trim();
    if (prevVibe) {
      if (vibeBase === prevVibe) vibeBase = "";
      else {
        const tail = "\n\n---\n\n" + prevVibe;
        if (vibeBase.endsWith(tail)) vibeBase = vibeBase.slice(0, -tail.length).trim();
      }
    }
    if (wf.vibe) {
      // Legacy link records have no w.vibe; never append a copy that is already present.
      if (!prevVibe && vibeBase.includes(wf.vibe)) {
        raw.narrativeVibe = vibeBase;
      } else {
        raw.narrativeVibe = vibeBase ? vibeBase + "\n\n---\n\n" + wf.vibe : wf.vibe;
      }
      w.vibe = wf.vibe;
    } else {
      raw.narrativeVibe = vibeBase;
      w.vibe = "";
    }
    if (wf.tags.length) {
      // Union, not replace: tags the player added to the world must survive a source refresh.
      const tags = Array.isArray(raw.meta.tags) ? raw.meta.tags.slice() : [];
      const seen = new Set(tags.map(function (t) { return String(t).toLowerCase(); }));
      for (const t of wf.tags) if (!seen.has(String(t).toLowerCase())) { tags.push(t); seen.add(String(t).toLowerCase()); }
      raw.meta.tags = tags;
    }
    if (wf.nsfw) raw.meta.nsfw = true;
    if (wf.authorNotes) raw.meta.authorNotes = wf.authorNotes;
    const hasTrackedStarts = Array.isArray(w.startIds);
    const prevStartIds = new Set((w.startIds || []).map(String));
    const freshIds = new Set(wf.starts.map(function (s) { return s.id; }));
    const freshTexts = new Set(wf.starts.map(function (s) { return String(s.text || "").trim(); }));
    const starts = (Array.isArray(raw.starts) ? raw.starts : [])
      .filter(function (s) { return s && typeof s === "object" && s.custom !== true; })
      .filter(function (s) {
        if (s.id && (prevStartIds.has(String(s.id)) || freshIds.has(String(s.id)))) return false;
        // Legacy links did not track startIds: an exact greeting match is the only marker.
        return !(!hasTrackedStarts && freshTexts.has(String(s.text || "").trim()));
      });
    if (!Array.isArray(raw.starts) && String(raw.start || "").trim()) {
      starts.push({ id: "start", title: "", description: "", text: String(raw.start).trim(), mode: raw.startMode === "verbatim" ? "verbatim" : "prompt" });
    }
    const customs = (Array.isArray(raw.starts) ? raw.starts : []).filter(function (s) { return s && s.custom === true; });
    raw.starts = starts.concat(wf.starts).concat(customs);
    raw.start = raw.starts[0] ? raw.starts[0].text : "";
    raw.startMode = raw.starts[0] ? (raw.starts[0].mode || "prompt") : "prompt";
    w.startIds = wf.starts.map(function (s) { return s.id; });
    await window.root.kv.worlds.set(w.worldId, raw);
    w.titles = fresh.titles;
    w.hashes = [...importedContentHashes(fresh.lore)];
    return true;
  }

  // Re-read a card and update the worlds it was imported AS, without touching any world's NPC
  // list. Before this existed the only "update" path was "add as NPC", which silently inserted
  // the card into its own world as a duplicate character.
  async function refreshCardWorlds(card) {
    const reg = await regRead();
    const prev = reg.cards[card.avatar];
    if (!prev) return { worlds: 0 };
    const links = (prev.worlds || []).filter(function (w) { return w && w.asWorld; });
    let live = 0;
    const dead = [];
    for (const w of links) {
      if (await refreshWorldImport(card, w)) live++;
      else dead.push(w);
    }
    // A world deleted in the game must drop out of the link record too, or the row keeps
    // advertising a tombstone and every refresh keeps re-reading it.
    if (dead.length) prev.worlds = (prev.worlds || []).filter(function (w) { return dead.indexOf(w) < 0; });
    if (links.length) {
      await regRecord(reg, "cards", card.avatar, { hash: cardHash(card), at: Date.now(), worlds: prev.worlds });
      notifyWorldsChanged();
    }
    return { worlds: live };
  }

  async function importCardToWorld(card, worldId) {
    const raw = await loadWorldRaw(worldId);
    if (!raw) throw new Error("world not found");
    const npc = buildNpcFromCard(card);
    if (!npc.name) throw new Error("card has no name");
    const reg = await regRead();
    const prev = reg.cards[card.avatar];
    let updated = 0;
    if (prev) {
      for (const w of prev.worlds) {
        if (w.asWorld) { await refreshWorldImport(card, w); updated++; continue; }
        const wr = await loadWorldRaw(w.worldId);
        if (!wr || !Array.isArray(wr.npcs)) continue;
        const i = wr.npcs.findIndex(function (n) { return n && n.name === w.npcName; });
        if (i < 0) continue;
        const fresh = buildNpcFromCard(card);
        for (const k of Object.keys(fresh)) if (fresh[k] === "") delete fresh[k];
        wr.npcs[i] = Object.assign({}, wr.npcs[i], fresh);
        wr.npcs[i].name = npc.name;
        w.npcName = npc.name;
        await window.root.kv.worlds.set(w.worldId, wr);
        updated++;
      }
    }
    const worlds = prev ? prev.worlds || [] : [];
    const inThisWorld = worlds.some(function (w) { return !w.asWorld && w.worldId === worldId; });
    // Target is this card's own imported world: the refresh above is the whole job. Adding the
    // card as an NPC here would duplicate the protagonist inside their own world.
    if (worlds.some(function (w) { return w.asWorld && w.worldId === worldId; })) {
      await regRecord(reg, "cards", card.avatar, { hash: cardHash(card), at: Date.now(), worlds: worlds });
      return { created: false, updated: true, count: 1, name: npc.name };
    }
    if (!inThisWorld) {
      raw.npcs = Array.isArray(raw.npcs) ? raw.npcs : [];
      let targetName = npc.name;
      const base = npc.name; let n = 2;
      while (raw.npcs.some(function (x) { return x && String(x.name || "").toLowerCase() === targetName.toLowerCase(); })) {
        targetName = base + " (" + (n++) + ")";
      }
      npc.name = targetName;
      raw.npcs.push(npc);
      await window.root.kv.worlds.set(worldId, raw);
      worlds.push({ worldId: worldId, npcName: targetName });
      await regRecord(reg, "cards", card.avatar, { hash: cardHash(card), at: Date.now(), worlds: worlds });
      return { created: true, name: targetName, updated: updated };
    }
    await regRecord(reg, "cards", card.avatar, { hash: cardHash(card), at: Date.now(), worlds: worlds });
    return { updated: true, count: updated };
  }

  function cardWorldFields(card) {
    const charName = String(card.name || "").trim();
    const story = [card.description, card.personality]
      .map(function (s) { return resolveCharMacro(String(s || "").trim(), charName); }).filter(Boolean).join("\n\n");
    const alt = (Array.isArray(card.alternate_greetings) ? card.alternate_greetings : null)
      || ((card.data && Array.isArray(card.data.alternate_greetings)) ? card.data.alternate_greetings : []) || [];
    const greetings = [card.first_mes].concat(alt)
      .map(function (s) { return resolveCharMacro(String(s || "").trim(), charName); }).filter(Boolean);
    const starts = greetings.map(function (text, i) {
      return i === 0
        ? { id: "start", title: "", description: "", text: text, mode: "verbatim" }
        : { id: "greeting-" + (i + 1), title: "Greeting " + (i + 1), description: "", text: text, mode: "verbatim" };
    });
    const rawTags = [].concat(Array.isArray(card.tags) ? card.tags : [], (card.data && Array.isArray(card.data.tags)) ? card.data.tags : [])
      .map(function (s) { return String(s || "").trim(); }).filter(Boolean);
    const seen = new Set(); const tags = [];
    let nsfw = false;
    for (const t of rawTags) {
      const low = t.toLowerCase();
      if (low === "nsfw") { nsfw = true; continue; }
      if (low === "remix" || seen.has(low)) continue;
      seen.add(low); tags.push(t);
    }
    const authorNotes = resolveCharMacro(String(card.creator_notes || (card.data && card.data.creator_notes) || card.creatorcomment || "").trim(), charName);
    return {
      story: story,
      scenario: resolveCharMacro(String(card.scenario || "").trim(), charName),
      vibe: resolveCharMacro(String(card.system_prompt || (card.data && card.data.system_prompt) || "").trim(), charName),
      starts: starts,
      tags: tags.slice(0, 12),
      nsfw: nsfw,
      authorNotes: authorNotes.slice(0, 2000)
    };
  }

  async function importCardAsWorld(card) {
    const name = String(card.name || "").trim();
    if (!name) throw new Error("card has no name");
    const fresh = buildCardLore(card);
    const wf = cardWorldFields(card);
    if (!fresh.lore.length && !wf.story) throw new Error("card has no description and no embedded book to import");
    let idx = [];
    try { idx = (await window.root.kv.worlds.get("index")) || []; } catch (e) {}
    if (!Array.isArray(idx)) idx = [];
    const id = await freshWorldId(name, idx);
    const now = new Date().toISOString();
    let cover = card.avatar ? await toCoverDataUrl(cardImageUrl(card.avatar)) : "";
    // The full card file is the source; the thumbnail only stands in if that file cannot be read.
    if (card.avatar && !cover) cover = await toCoverDataUrl(cardThumbUrl(card.avatar));
    const world = {
      format: "mno-world", version: 1,
      meta: { id: id, name: name, description: "", author: "", authorId: "", tags: wf.tags, nsfw: wf.nsfw, commentsOff: false, cover: cover, authorNotes: wf.authorNotes, createdAt: now, updatedAt: now },
      worldDescription: wf.story,
      narrativeVibe: wf.vibe,
      lorebook: fresh.lore,
      scenario: wf.scenario,
      start: wf.starts.length ? wf.starts[0].text : "",
      startMode: wf.starts.length ? wf.starts[0].mode : "prompt",
      starts: wf.starts,
      imageStyleTags: "", imageNegativeTags: "",
      imageIncludeTrackers: false, imageIncludeNpcTrackers: false, imageTrackerKeys: [], imageNpcTrackerKeys: [],
      stats: { pointsPerLevel: 2, ccBudget: 12, ccFloor: 5, ccCeiling: 20, averageThreshold: 10, exceptionalThreshold: 15, modStep: 5, dieSides: 20, useStatModFormula: false, statModFormula: "", checkIncludeTrackers: false, checkIncludeNpcTrackers: false, checkTrackerKeys: [], checkNpcTrackerKeys: [], useCheckInstruction: false, checkInstruction: "" },
      trackers: [], npcTrackers: [], npcs: []
    };
    await window.root.kv.worlds.set(id, world);
    if (!idx.some(function (w) { return w.id === id; })) {
      idx.push({ id: id, name: name, description: "", tags: wf.tags, nsfw: wf.nsfw, author: "", authorId: "", remix: null, origin: "", cover: cover, createdAt: now, updatedAt: now });
      await window.root.kv.worlds.set("index", idx);
    }
    const reg = await regRead();
    const prev = reg.cards[card.avatar];
    const recs = prev ? (prev.worlds || []) : [];
    recs.push({ worldId: id, asWorld: true, titles: fresh.titles, hashes: [...importedContentHashes(fresh.lore)], vibe: wf.vibe });
    await regRecord(reg, "cards", card.avatar, { hash: cardHash(card), at: Date.now(), worlds: recs });
    notifyWorldsChanged();
    return { created: true, worldId: id, name: name };
  }

  // Tell the running app (and any other open tab) that the worlds library changed so the
  // Worlds list refreshes live — the storage shim forwards this channel to the app's
  // rpge-worlds-changed listener (patch 003 hook).
  function notifyWorldsChanged() {
    try { new BroadcastChannel("rpge-kv").postMessage({ type: "worlds-changed" }); } catch (e) {}
  }

  // ---- World Info -> world lorebook ----
  async function importBookToWorld(book, worldId) {
    const data = await window.LoreweaverBridge.api("/api/worldinfo/get", { name: book.file_id });
    const rawEntries = (data && data.entries) || {};
    const lore = [];
    for (const uid of Object.keys(rawEntries)) {
      const l = loreFromWorldInfoEntry(rawEntries[uid]);
      if (l) lore.push(l);
    }
    if (!lore.length) throw new Error("book has no enabled entries with content");
    const freshTitles = lore.map(function (l) { return l.title; }).filter(Boolean);
    const freshHashes = [...importedContentHashes(lore)];
    const raw = await loadWorldRaw(worldId);
    if (!raw) throw new Error("world not found");
    if (typeof raw.lorebook === "string" && raw.lorebook.trim()) {
      raw.lorebook = [{ title: "", type: "world", activation: "always", keywords: [], content: raw.lorebook.trim() }];
    }
    raw.lorebook = Array.isArray(raw.lorebook) ? raw.lorebook : [];
    const reg = await regRead();
    const prev = reg.books[book.file_id];
    if (prev) {
      for (const w of prev.worlds) {
        const wr = await loadWorldRaw(w.worldId);
        if (!wr) continue;
        wr.lorebook = stripPreviousImport(
          Array.isArray(wr.lorebook) ? wr.lorebook : [],
          importedTitleSet(w.titles),
          new Set(Array.isArray(w.hashes) ? w.hashes : []),
          lore,
        );
        wr.lorebook.push(...lore);
        await window.root.kv.worlds.set(w.worldId, wr);
        w.titles = freshTitles;
        w.hashes = freshHashes;
      }
      await regRecord(reg, "books", book.file_id, { hash: bookHash(book, data), at: Date.now(), worlds: prev.worlds });
      return { updated: true, count: lore.length };
    }
    raw.lorebook.push(...lore);
    await window.root.kv.worlds.set(worldId, raw);
    const worlds = prev ? prev.worlds || [] : [];
    worlds.push({ worldId: worldId, titles: freshTitles, hashes: freshHashes });
    await regRecord(reg, "books", book.file_id, { hash: bookHash(book, data), at: Date.now(), worlds: worlds });
    return { created: true, count: lore.length };
  }

  // ---- row rendering helper ----
  function row(html) {
    const div = document.createElement("div");
    div.className = "prow";
    div.innerHTML = html;
    return div;
  }

  // ---- personas UI ----
  function statusFor(p, linked) {
    if (!linked) return { cls: "", text: "not imported" };
    if (linked.lwSource.descHash !== fnv1a(p.description)) return { cls: "st-changed", text: "linked → hero \u201c" + (linked.label || linked.name || "?") + "\u201d — source changed, update" };
    return { cls: "st-ok", text: "linked → hero \u201c" + (linked.label || linked.name || "?") + "\u201d — up to date" };
  }

  async function renderPersonas() {
    try {
      const lw = await window.LoreweaverBridge.getSettings();
      const pu = (lw.parsed && lw.parsed.power_user) || {};
      const names = pu.personas && typeof pu.personas === "object" ? pu.personas : {};
      const descs = pu.persona_descriptions && typeof pu.persona_descriptions === "object" ? pu.persona_descriptions : {};
      const def = pu.default_persona || null;
      const rows = Object.keys(names).map(function (id) {
        return { id: id, name: names[id], description: (descs[id] && descs[id].description) || "", isDefault: id === def };
      });
      const list = await heroList();
      const box = $("lwimpList");
      box.innerHTML = rows.length ? "" : "<p>No personas found in Loreweaver.</p>";
      rows.forEach(function (p) {
        const linked = findLinkedHero(list, p.id);
        const st = statusFor(p, linked);
        const div = row(
          '<img alt="" src="' + personaAvatarUrl(p.id) + '" onerror="this.style.visibility=\'hidden\'">' +
          '<div class="pmain"><span class="pname">' + esc(p.name || "(unnamed persona)") + "</span>" +
          (p.isDefault ? '<span class="pbadge">default</span>' : "") +
          '<div class="pdesc">' + esc(p.description || "no description") + "</div>" +
          '<div class="pstatus ' + st.cls + '">' + st.text + "</div></div>" +
          '<button>' + (linked ? "Update" : "Import as hero") + "</button>");
        div.querySelector("button").onclick = async function () {
          this.disabled = true; this.textContent = "…";
          try {
            const r = await importPersona(p);
            say(r.created ? "Imported \u201c" + esc(p.name) + "\u201d as a saved hero — Load it from the hero library in the game."
                          : "Updated the linked hero \u201c" + esc(p.name) + "\u201d.", "ok");
            await renderPersonas();
            afterImport();
          } catch (e) {
            say("Import failed: " + (e && e.message || e), "bad");
            this.disabled = false; this.textContent = linked ? "Update" : "Import as hero";
          }
        };
        box.appendChild(div);
      });
    } catch (e) {
      $("lwimpList").innerHTML = "";
      say("Could not load Loreweaver data (" + (e && e.message || e) + "). This page only works when the game is served by the Loreweaver backend.", "bad");
    }
  }

  // ---- target world dropdown ----
  async function loadWorlds() {
    const sel = $("lwimpTargetWorld");
    let idx = [];
    try { idx = (await window.root.kv.worlds.get("index")) || []; } catch (e) {}
    if (!Array.isArray(idx) || !idx.length) {
      sel.innerHTML = '<option value="">No game worlds yet — create one in the game first</option>';
      return;
    }
    const remember = localStorage.getItem("rpge.importWorld") || "";
    sel.innerHTML = idx.map(function (w) {
      return '<option value="' + esc(w.id) + '"' + (w.id === remember ? " selected" : "") + ">" + esc(w.name || w.id) + "</option>";
    }).join("");
    if (!idx.some(function (w) { return w.id === sel.value; })) sel.value = idx[0].id;
    sel.onchange = function () {
      localStorage.setItem("rpge.importWorld", sel.value);
      loadCards(); renderBooks();
    };
  }

  // ---- characters UI ----
  let cardList = [];

  async function cardsCache() { return (await window.root.kv.lwcache.get("cards")) || null; }
  async function cardsCacheSave(list) { try { await window.root.kv.lwcache.set("cards", { at: Date.now(), list }); } catch (e) {} }

  async function fetchCardList(force) {
    if (!force) {
      const c = await cardsCache();
      if (c && Array.isArray(c.list) && c.list.length) {
        cardList = c.list;
        if (Date.now() - (c.at || 0) > 5 * 60 * 1000) refreshCardsSilently();
        return;
      }
    }
    cardList = (await window.LoreweaverBridge.api("/api/characters/all")) || [];
    await cardsCacheSave(cardList);
  }

  let refreshingCards = false;
  async function refreshCardsSilently() {
    if (refreshingCards) return;
    refreshingCards = true;
    try {
      const fresh = (await window.LoreweaverBridge.api("/api/characters/all")) || [];
      cardList = fresh;
      await cardsCacheSave(fresh);
      await renderChars();
    } catch (e) {} finally { refreshingCards = false; }
  }

  async function loadCards() {
    try {
      await fetchCardList(false);
      cardList.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
    } catch (e) {
      $("lwimpChars").innerHTML = "";
      say("Could not load characters: " + (e && e.message || e), "bad");
      return;
    }
    await renderChars();
  }

  async function renderChars() {
    const worldId = $("lwimpTargetWorld").value;
    if (!worldId) {
      $("lwimpChars").innerHTML = '<p class="hint">Pick a target world above (create one in the game if you have none yet) — then the characters are listed here.</p>';
      return;
    }
    const reg = await regRead();
    const box = $("lwimpChars");
    box.innerHTML = "";
    const head = document.createElement("div");
    head.style.cssText = "margin-top:10px";
    head.innerHTML = '<button class="secondary" style="padding:4px 10px;font-size:12px">\u27f3 Refresh list (' + cardList.length + ")</button>";
    head.querySelector("button").onclick = async function () {
      this.disabled = true; this.textContent = "\u27f3 \u2026";
      try {
        cardList = (await window.LoreweaverBridge.api("/api/characters/all")) || [];
        await cardsCacheSave(cardList);
        cardList.sort(function (a, b) { return String(a.name || "").localeCompare(String(b.name || "")); });
        await renderChars();
      } catch (e) {
        say("Refresh failed: " + (e && e.message || e), "bad");
        this.disabled = false;
      }
    };
    box.appendChild(head);
    cardList.forEach(function (c) {
      const linked = reg.cards[c.avatar];
      const inWorld = linked && linked.worlds.some(function (w) { return w.worldId === worldId; });
      const asWorld = (linked && linked.worlds.filter(function (w) { return w.asWorld; })) || [];
      let st, btn;
      if (inWorld) {
        st = linked.hash !== cardHash(c)
          ? { cls: "st-changed", text: "linked → NPC in this world" + (asWorld.length ? " · also imported as world" : "") + " — source changed, update" }
          : { cls: "st-ok", text: "linked → NPC in this world" + (asWorld.length ? " · also imported as world" : "") + " — up to date" };
        btn = "Update";
      } else if (asWorld.length) {
        st = linked.hash !== cardHash(c)
          ? { cls: "st-changed", text: "linked → world \u201c" + asWorld.map(function (w) { return w.worldId; }).join(", ") + "\u201d — source changed; update or add as NPC here" }
          : { cls: "st-ok", text: "linked → world \u201c" + asWorld.map(function (w) { return w.worldId; }).join(", ") + "\u201d — add as NPC here too" };
        btn = "Add as NPC";
      } else if (linked) {
        st = { cls: "", text: "linked in \u201c" + linked.worlds.map(function (w) { return w.worldId; }).join(", ") + "\u201d — add to this world too" };
        btn = "Add as NPC";
      } else {
        st = { cls: "", text: "not imported" };
        btn = "Add as NPC";
      }
      const refreshBtn = asWorld.length
        ? '<button class="secondary" title="Re-read this card and update the world it was imported as — without adding an NPC here.">\u21bb Refresh world</button>'
        : "";
      const div = row(
        '<img alt="" src="' + cardThumbUrl(c.avatar) + '" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="pmain"><span class="pname">' + esc(c.name || "(unnamed)") + "</span>" +
        '<div class="pdesc">' + esc(String(c.description || "").slice(0, 140)) + "</div>" +
        '<div class="pstatus ' + st.cls + '">' + st.text + "</div></div>" +
        '<div class="pbtns"><button>' + btn + "</button><button class=\"secondary\" title=\"Creates a NEW game world from this card: the description as always-on rules, its embedded lorebook as the cast.\">" + (asWorld.length ? "Add another world" : "Add as world") + "</button>" + refreshBtn + "</div>");
      const buttons = div.querySelectorAll("button");
      buttons[0].onclick = async function () {
        this.disabled = true; this.textContent = "…";
        try {
          const full = await window.LoreweaverBridge.api("/api/characters/get", { avatar_url: c.avatar });
          const card = (full && typeof full === "object" && full.name !== undefined) ? full : c;
          const r = await importCardToWorld(card, worldId);
          say(r.created ? (r.updated ? "Added \u201c" + esc(r.name) + "\u201d as an NPC (other linked imports refreshed)."
                                     : "Added \u201c" + esc(r.name) + "\u201d as an NPC.")
                        : "Updated the linked imports (" + r.count + ").", "ok");
          await renderChars();
          afterImport();
        } catch (e) {
          say("Import failed: " + (e && e.message || e), "bad");
          this.disabled = false; this.textContent = btn;
        }
      };
      buttons[1].onclick = async function () {
        this.disabled = true; this.textContent = "…";
        try {
          const full = await window.LoreweaverBridge.api("/api/characters/get", { avatar_url: c.avatar });
          const card = (full && typeof full === "object" && full.name !== undefined) ? full : c;
          const r = await importCardAsWorld(card);
          localStorage.setItem("rpge.importWorld", r.worldId);
          await loadWorlds();
          say("Created world \u201c" + esc(r.name) + "\u201d from the card (" + r.worldId + ") — rules and lorebook are in; it's now the target world. Open it from the game's Worlds list.", "ok");
          await renderChars();
        } catch (e) {
          say("Import failed: " + (e && e.message || e), "bad");
          this.disabled = false; this.textContent = asWorld.length ? "Add another world" : "Add as world";
        }
      };
      if (refreshBtn) buttons[2].onclick = async function () {
        this.disabled = true; this.textContent = "…";
        try {
          const full = await window.LoreweaverBridge.api("/api/characters/get", { avatar_url: c.avatar });
          const card = (full && typeof full === "object" && full.name !== undefined) ? full : c;
          const r = await refreshCardWorlds(card);
          say(r.worlds ? "Refreshed " + r.worlds + " imported world" + (r.worlds === 1 ? "" : "s") + " from \u201c" + esc(c.name) + "\u201d."
                       : "This card is not linked to an imported world.", r.worlds ? "ok" : "bad");
          await renderChars();
          afterImport();
        } catch (e) {
          say("Refresh failed: " + (e && e.message || e), "bad");
          this.disabled = false; this.textContent = "\u21bb Refresh world";
        }
      };
      box.appendChild(div);
    });
  }

  // ---- World Info UI ----
  let bookList = [];

  async function loadBooks() {
    try {
      bookList = (await window.LoreweaverBridge.api("/api/worldinfo/list")) || [];
    } catch (e) {
      $("lwimpBooks").innerHTML = "";
      say("Could not load World Info: " + (e && e.message || e), "bad");
      return;
    }
    // Only linked books need a content hash; fetch those in parallel and cache on the row object.
    try {
      const reg = await regRead();
      await Promise.all(bookList.map(async function (b) {
        if (!reg.books[b.file_id]) return;
        try {
          const d = await window.LoreweaverBridge.api("/api/worldinfo/get", { name: b.file_id });
          b.__hash = bookHash(b, d);
        } catch (e) { /* leave the fallback name hash; the row still works */ }
      }));
    } catch (e) {}
    await renderBooks();
  }

  async function renderBooks() {
    const worldId = $("lwimpTargetWorld").value;
    if (!worldId) {
      $("lwimpBooks").innerHTML = '<p class="hint">Pick a target world above — then the World Info books are listed here.</p>';
      return;
    }
    const reg = await regRead();
    const box = $("lwimpBooks");
    box.innerHTML = bookList.length ? "" : "<p>No World Info books found.</p>";
    bookList.forEach(function (b) {
      const linked = reg.books[b.file_id];
      const inWorld = linked && linked.worlds.some(function (w) { return w.worldId === worldId; });
      let st, btn;
      if (inWorld) {
        st = linked.hash !== linkedBookHash(b)
          ? { cls: "st-changed", text: "linked → lorebook in this world — source changed, update" }
          : { cls: "st-ok", text: "linked → lorebook in this world — up to date" };
        btn = "Update";
      } else if (linked) {
        st = { cls: "", text: "linked in \u201c" + linked.worlds.map(function (w) { return w.worldId; }).join(", ") + "\u201d — add to this world too" };
        btn = "Import book";
      } else {
        st = { cls: "", text: "not imported" };
        btn = "Import book";
      }
      const div = row(
        '<div class="pmain"><span class="pname">' + esc(b.name || b.file_id) + "</span>" +
        '<div class="pstatus ' + st.cls + '">' + st.text + "</div></div>" +
        '<button>' + btn + "</button>");
      div.querySelector("button").onclick = async function () {
        this.disabled = true; this.textContent = "…";
        try {
          const r = await importBookToWorld(b, worldId);
          say(r.updated ? "Updated the imported lorebook entries (" + r.count + ")."
                        : "Imported " + r.count + " lore entries.", "ok");
          await renderBooks();
          afterImport();
        } catch (e) {
          say("Import failed: " + (e && e.message || e), "bad");
          this.disabled = false; this.textContent = btn;
        }
      };
      box.appendChild(div);
    });
  }

  async function refresh() {
    await loadWorlds();
    await renderPersonas();
    if ($("lwimpTargetWorld").value) await loadCards();
    await loadBooks();
  }
  // The storage shim's boot reconcile lands a few seconds AFTER this page reads the worlds
  // index — a fresh browser (or a slow sync) shows "No game worlds yet" even when worlds exist
  // server-side. When the sync completes, re-read the dropdown if it found nothing.
  const onSynced = () => { if (!$("lwimpTargetWorld").value) refresh(); };
  window.addEventListener("rpge-saves-synced", onSynced);
  // The sync event is one-shot and can fire BEFORE this page mounts (the reconcile starts on
  // boot idle, the landing mounts later), which would leave the dropdown empty forever. Poll a
  // few times until a world shows up; each tick only fires while the select is still empty.
  let pollTimer = 0, pollTries = 0;
  const pollWorlds = () => {
    if (!$("lwimpTargetWorld") || $("lwimpTargetWorld").value) return;
    refresh();
    if (++pollTries < 6) pollTimer = setTimeout(pollWorlds, 6000);
  };
  pollTimer = setTimeout(pollWorlds, 6000);
  refresh();
  // The page's teardown: drop the sync listener so a re-mount never double-binds.
  return () => { window.removeEventListener("rpge-saves-synced", onSynced); clearTimeout(pollTimer); };
}
