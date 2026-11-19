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
      .lwimp h2.lwimp-h { font-size: 15px; letter-spacing: .1em; text-transform: uppercase; color: var(--accent); font-weight: 600; margin: 30px 0 8px; }
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
      <h2 class="lwimp-h" style="margin-top:6px">Personas → hero library</h2>
      <p>Import your <b>Loreweaver personas</b> as saved heroes. A linked snapshot is created in the
      game's hero library — forge a hero, and <b>Load</b> it from the library in any world. Mapping:
      name → <b>Name</b>, description → <b>Persona</b>, avatar → <b>Portrait</b>; the other bio fields
      stay blank for you to fill in the game (stats are always per-world and never imported).</p>
      <p class="hint">The import keeps a link to the source persona. Come back here to check for
      changes — updating overwrites only the imported fields (Name, Persona, Portrait), never
      anything you added in the game.</p>
      <div id="lwimpList">Loading personas…</div>

      <h2 class="lwimp-h">Character cards → world NPCs</h2>
      <p>Add a Loreweaver <b>character</b> as a standing NPC in one of the game's worlds. Mapping:
      name → <b>Name</b>, description + personality → <b>Persona</b>, scenario → <b>Extra
      details</b>, card image → avatar. Fill the rest (race, appearance…) in the game's World
      Editor. New adventures see the NPC at once; a RUNNING adventure picks it up on its next
      load.</p>
      <label class="lbl" for="lwimpTargetWorld">Target world</label>
      <select id="lwimpTargetWorld"><option value="">Loading worlds…</option></select>
      <div id="lwimpChars">Loading characters…</div>

      <h2 class="lwimp-h">World Info → world lorebook</h2>
      <p>Copy a Loreweaver <b>World Info</b> book into the selected world's lorebook. Keywords
      (secondary keys merged in) → triggers, constant entries → always-on, comment → title.
      ST macros like <code>{{user}}</code>/<code>{{char}}</code> stay literal — edit them in the
      World Editor if needed.</p>
      <div id="lwimpBooks">Loading World Info…</div>

      <div id="lwimpMsg" role="status"></div>
    </div>`;

  const $ = (id) => pane.querySelector("#" + id);
  const say = (t, cls) => { const m = $("lwimpMsg"); m.textContent = t; m.className = cls || ""; };

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
  function cardThumbUrl(avatar) { return "/thumbnail?type=avatar&file=" + encodeURIComponent(avatar); }

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
    const rpg = window.root.kv.rpg;
    while (list.length > 40) list.shift(); // same cap as the engine's HeroStore
    await rpg.set("savedHeroes", list);
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
  function cardHash(c) { return fnv1a([c.description, c.personality, c.scenario].join("\u0000")); }

  function bookHash(b) { return fnv1a([b.file_id, b.name].join("\u0000")); }

  function buildNpcFromCard(card) {
    const persona = [card.description, card.personality]
      .map(function (s) { return String(s || "").trim(); }).filter(Boolean).join("\n\n");
    return {
      name: String(card.name || "").trim(),
      age: "", gender: "", race: "", appearance: "", job: "",
      persona: persona,
      secrets: "",
      extra: String(card.scenario || "").trim(),
      avatar: card.avatar ? cardThumbUrl(card.avatar) : ""
    };
  }

  function buildCardLore(card) {
    const lore = [];
    const titles = [];
    const book = (card.data && card.data.character_book) || card.character_book || null;
    const entries = book && Array.isArray(book.entries) ? book.entries : [];
    for (const e of entries) {
      if (!e || e.enabled === false) continue;
      const content = String(e.content || "").trim();
      if (!content) continue;
      const kw = [].concat(Array.isArray(e.keys) ? e.keys : [], Array.isArray(e.key) ? e.key : [], Array.isArray(e.secondary_keys) ? e.secondary_keys : [])
        .map(function (s) { return String(s || "").trim(); }).filter(Boolean);
      const title = String(e.comment || "").trim() || (kw[0] ? kw[0] : "");
      lore.push({
        title: title,
        type: "character",
        activation: e.constant === true || String(e.constant) === "true" ? "always" : (kw.length ? "keywords" : "always"),
        keywords: kw,
        content: content
      });
      titles.push(title);
    }
    return { lore: lore, titles: titles };
  }

  function slugifyWorldName(name) {
    let x = String(name || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
    return x || "world";
  }

  async function freshWorldId(name, idx) {
    const base = slugifyWorldName(name);
    const taken = new Set(idx.map(function (w) { return w.id; }));
    if (!taken.has(base)) return base;
    for (let n = 2; ; n++) {
      const tail = "-" + n;
      const cand = (base.length + tail.length > 40) ? base.slice(0, 40 - tail.length) + tail : base + tail;
      if (!taken.has(cand)) return cand;
    }
  }

  async function refreshWorldImport(card, w) {
    const raw = await loadWorldRaw(w.worldId);
    if (!raw) return;
    const fresh = buildCardLore(card);
    const wf = cardWorldFields(card);
    raw.lorebook = (Array.isArray(raw.lorebook) ? raw.lorebook : []).filter(function (e) {
      return !(e && typeof e === "object" && e.type === "law" && e.activation === "always"
        && String(e.title || "").trim().toLowerCase() === "rules" && (!e.keywords || !e.keywords.length));
    });
    const titles = new Set((w.titles || []).map(function (t) { return String(t || "").toLowerCase(); }));
    raw.lorebook = raw.lorebook.filter(function (e) {
      const t = e && typeof e === "object" ? String(e.title || "").toLowerCase() : null;
      return t === null || !titles.has(t);
    });
    raw.lorebook.push(...fresh.lore);
    if (wf.story) raw.worldDescription = wf.story;
    if (wf.scenario) raw.scenario = wf.scenario;
    if (wf.vibe) raw.narrativeVibe = (String(raw.narrativeVibe || "").trim())
      ? (String(raw.narrativeVibe).trim() + "\n\n---\n\n" + wf.vibe) : wf.vibe;
    if (wf.tags.length) raw.meta.tags = wf.tags;
    if (wf.nsfw) raw.meta.nsfw = true;
    if (wf.authorNotes) raw.meta.authorNotes = wf.authorNotes;
    const prevStartIds = new Set((w.startIds || []).map(String));
    const freshIds = new Set(wf.starts.map(function (s) { return s.id; }));
    const starts = (Array.isArray(raw.starts) ? raw.starts : [])
      .filter(function (s) { return s && typeof s === "object" && s.custom !== true; })
      .filter(function (s) { return !(s.id && (prevStartIds.has(String(s.id)) || freshIds.has(String(s.id)))); });
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
    const story = [card.description, card.personality]
      .map(function (s) { return String(s || "").trim(); }).filter(Boolean).join("\n\n");
    const alt = (Array.isArray(card.alternate_greetings) ? card.alternate_greetings : null)
      || ((card.data && Array.isArray(card.data.alternate_greetings)) ? card.data.alternate_greetings : []) || [];
    const greetings = [card.first_mes].concat(alt)
      .map(function (s) { return String(s || "").trim(); }).filter(Boolean);
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
    const authorNotes = String(card.creator_notes || (card.data && card.data.creator_notes) || card.creatorcomment || "").trim();
    return {
      story: story,
      scenario: String(card.scenario || "").trim(),
      vibe: String(card.system_prompt || (card.data && card.data.system_prompt) || "").trim(),
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
    const cover = card.avatar ? await toCoverDataUrl(cardThumbUrl(card.avatar)) : "";
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
    recs.push({ worldId: id, asWorld: true, titles: fresh.titles });
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
  function wiEntryToLore(e) {
    const content = String(e.content || "").trim();
    if (!content) return null;
    const kw = [].concat(Array.isArray(e.key) ? e.key : [], Array.isArray(e.keysecondary) ? e.keysecondary : []);
    const entry = {
      title: String(e.comment || "").trim(),
      type: "lore",
      activation: e.constant === true ? "always" : "keywords",
      keywords: kw.map(function (s) { return String(s || "").trim(); }).filter(Boolean),
      content: content
    };
    if (entry.activation === "keywords" && !entry.keywords.length) entry.activation = "always";
    return entry;
  }

  async function importBookToWorld(book, worldId) {
    const data = await window.LoreweaverBridge.api("/api/worldinfo/get", { name: book.file_id });
    const rawEntries = (data && data.entries) || {};
    const lore = [];
    for (const uid of Object.keys(rawEntries)) {
      const e = rawEntries[uid];
      if (!e || e.disable === true || String(e.disable) === "true") continue;
      const l = wiEntryToLore(e);
      if (l) lore.push(l);
    }
    if (!lore.length) throw new Error("book has no enabled entries with content");
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
        wr.lorebook = Array.isArray(wr.lorebook) ? wr.lorebook : [];
        const titles = new Set(w.titles.map(function (t) { return String(t || "").toLowerCase(); }));
        wr.lorebook = wr.lorebook.filter(function (e) {
          const t = e && typeof e === "object" ? String(e.title || "").toLowerCase() : null;
          return t === null || !titles.has(t);
        });
        wr.lorebook.push(...lore);
        await window.root.kv.worlds.set(w.worldId, wr);
      }
      const worlds = prev.worlds.map(function (w) {
        return Object.assign({}, w, { titles: lore.map(function (l) { return l.title; }) });
      });
      await regRecord(reg, "books", book.file_id, { hash: bookHash(book), at: Date.now(), worlds: worlds });
      return { updated: true, count: lore.length };
    }
    raw.lorebook.push(...lore);
    await window.root.kv.worlds.set(worldId, raw);
    const worlds = prev ? prev.worlds || [] : [];
    worlds.push({ worldId: worldId, titles: lore.map(function (l) { return l.title; }) });
    await regRecord(reg, "books", book.file_id, { hash: bookHash(book), at: Date.now(), worlds: worlds });
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
      const div = row(
        '<img alt="" src="' + cardThumbUrl(c.avatar) + '" onerror="this.style.visibility=\'hidden\'">' +
        '<div class="pmain"><span class="pname">' + esc(c.name || "(unnamed)") + "</span>" +
        '<div class="pdesc">' + esc(String(c.description || "").slice(0, 140)) + "</div>" +
        '<div class="pstatus ' + st.cls + '">' + st.text + "</div></div>" +
        '<div class="pbtns"><button>' + btn + "</button><button class=\"secondary\" title=\"Creates a NEW game world from this card: the description as always-on rules, its embedded lorebook as the cast.\">Add as world</button></div>");
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
          this.disabled = false; this.textContent = "Add as world";
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
        st = linked.hash !== bookHash(b)
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
  refresh();
  // The page's teardown: drop the sync listener so a re-mount never double-binds.
  return () => window.removeEventListener("rpge-saves-synced", onSynced);
}
