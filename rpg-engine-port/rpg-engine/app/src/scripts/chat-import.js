// Chats tab — turn a SillyTavern chat into a continuable RPG Engine adventure.
//
// Single-character chats only. The world must already exist; the hero is matched by name in the
// saved-hero library and created from the card's description when missing. Every message is kept, in
// order, and only the ACTIVE swipe is read (SillyTavern keeps the visible text in `mes`).
//
// The chat body comes from POST /api/chats/get with { avatar_url, file_name } — the server keys on
// `file_name` WITHOUT the .jsonl extension (src/endpoints/chats.js:532); sending `ch_name` silently
// returns {} and the import reports "no messages".
//
// Nothing here writes back to SillyTavern, and nothing spends AI tokens: memory digestion and tracker
// inference are not performed yet (they need the opt-in checkbox UI and an LLM call).

import { notify } from "./notify.js";

const bridge = () => window.LoreweaverBridge;
const api = () => window.mnoApp;
const kv = () => (window.root && window.root.kv) || null;

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}

async function listChats(avatar) {
  try {
    const r = await bridge().api("/api/characters/chats", { avatar_url: avatar });
    if (Array.isArray(r)) return r;
  } catch (e) { /* the query form below covers the older route */ }
  const r = await bridge().api("/api/characters/chats?avatar_url=" + encodeURIComponent(avatar));
  return Array.isArray(r) ? r : [];
}

async function loadChat(avatar, fileName) {
  const name = String(fileName).replace(/\.jsonl$/, "");
  const r = await bridge().api("/api/chats/get", { avatar_url: avatar, file_name: name });
  const msgs = Array.isArray(r) ? r : (r && (Array.isArray(r.chat) ? r.chat : (Array.isArray(r.messages) ? r.messages : [])));
  return msgs.filter(function (m) { return m && typeof m.mes === "string" && m.mes.trim(); });
}

export async function mountChatImport(pane) {
  if (!bridge() || !api() || !kv()) {
    pane.innerHTML = '<p class="hint">This tab needs to run inside Loreweaver.</p>';
    return;
  }
  pane.innerHTML = `
    <h2 class="lwimp-h" style="margin-top:6px">Chats → adventures</h2>
    <p>Pick a Loreweaver chat and a world; the engine writes a normal adventure from it, so it shows up
    under <b>Adventures</b> and plays on from its last message. The hero is matched by name in the
    saved-hero library (created from the card when missing). Nothing is written back to Loreweaver.</p>
    <label class="lbl" for="ciChar">Character</label>
    <select id="ciChar"><option value="">Loading characters…</option></select>
    <label class="lbl" for="ciChat">Chat</label>
    <select id="ciChat" disabled><option value="">Pick a character first</option></select>
    <label class="lbl" for="ciWorld">World</label>
    <select id="ciWorld"><option value="">Loading worlds…</option></select>
    <div style="margin-top:14px"><button type="button" id="ciGo" disabled>📥 Import chat</button></div>
    <div id="ciMsg" style="margin-top:12px;min-height:1.5em"></div>`;

  const $ = function (id) { return pane.querySelector("#" + id); };
  const say = function (t, cls) { const m = $("ciMsg"); m.textContent = t; m.className = cls || ""; };
  const charSel = $("ciChar"), chatSel = $("ciChat"), worldSel = $("ciWorld"), go = $("ciGo");
  let chars = [];

  const worlds = [];
  try {
    const idx = (await kv().worlds.get("index")) || [];
    for (const w of idx) {
      const id = typeof w === "string" ? w : (w && (w.id || w.worldId));
      if (id) worlds.push({ id: id, name: (w && (w.name || w.title)) || id });
    }
  } catch (e) { /* empty picker, the button stays disabled */ }
  worldSel.innerHTML = worlds.length
    ? worlds.map(function (w) { return '<option value="' + esc(w.id) + '">' + esc(w.name) + "</option>"; }).join("")
    : '<option value="">No world installed</option>';

  try {
    chars = (await bridge().api("/api/characters/all")) || [];
    charSel.innerHTML = chars.length
      ? '<option value="">Pick a character…</option>' + chars.map(function (c) { return '<option value="' + esc(c.avatar) + '">' + esc(c.name) + "</option>"; }).join("")
      : '<option value="">No characters found</option>';
  } catch (e) {
    charSel.innerHTML = '<option value="">Could not read characters</option>';
    say("Could not read characters: " + (e && e.message || e), "bad");
  }

  charSel.onchange = async function () {
    const avatar = charSel.value;
    chatSel.disabled = true; chatSel.innerHTML = '<option value="">Loading chats…</option>'; go.disabled = true;
    if (!avatar) return;
    try {
      const list = await listChats(avatar);
      list.sort(function (a, b) { return String(b.last_mes || "").localeCompare(String(a.last_mes || "")); });
      chatSel.innerHTML = list.length
        ? '<option value="">Pick a chat…</option>' + list.map(function (c) {
            const when = c.last_mes ? " · " + new Date(c.last_mes).toLocaleDateString() : "";
            return '<option value="' + esc(c.file_name) + '">' + esc(String(c.file_name || "").replace(/\.jsonl$/, "")) + when + "</option>";
          }).join("")
        : '<option value="">No chats for this character</option>';
      chatSel.disabled = !list.length;
    } catch (e) {
      chatSel.innerHTML = '<option value="">Could not read chats</option>';
      say("Could not read chats: " + (e && e.message || e), "bad");
    }
  };
  chatSel.onchange = function () { go.disabled = !chatSel.value || !worldSel.value; };
  worldSel.onchange = function () { go.disabled = !chatSel.value || !worldSel.value; };

  async function ensureHero(avatar, cardName) {
    const store = api().heroStore;
    const list = await store.list();
    const hit = list.find(function (h) {
      return String(h.name || h.label || "").toLowerCase() === String(cardName).toLowerCase();
    });
    if (hit) return hit;
    let desc = "";
    try {
      const full = await bridge().api("/api/characters/get", { avatar_url: avatar });
      desc = [full && full.description, full && full.personality].filter(Boolean).join("\n\n");
    } catch (e) { /* a missing description only costs the persona text */ }
    const hero = { name: cardName, label: cardName, persona: desc };
    await store.save(hero, cardName);
    return hero;
  }

  go.onclick = async function () {
    const avatar = charSel.value, fileName = chatSel.value, worldId = worldSel.value;
    if (!avatar || !fileName || !worldId) return;
    go.disabled = true;
    say("Reading the chat…", "info");
    try {
      const card = chars.find(function (c) { return c.avatar === avatar; }) || { name: avatar };
      const msgs = await loadChat(avatar, fileName);
      if (!msgs.length) { say("That chat has no messages.", "bad"); return; }
      const hero = await ensureHero(avatar, card.name);
      const world = await kv().worlds.get(worldId);
      const state = api().newSession(undefined, worldId, null);
      state.worldName = (world && (world.name || world.title)) || "";
      state.name = card.name + " · " + (String(fileName).replace(/\.jsonl$/, "").split(" - ").pop() || "chat");
      state.character = Object.assign({}, state.character, { name: hero.name || card.name, portrait: hero.portrait || "" });
      state.messages = msgs.map(function (m) {
        const role = m.is_user ? "user" : (m.is_system ? "action" : "assistant");
        return { role: role, text: String(m.mes || "").trim(), ts: Date.parse(m.send_date || "") || Date.now() };
      });
      state.messageCount = state.messages.length;
      state.turn = state.messages.length;
      await api().sessionStore.save(state);
      say("Imported " + state.messages.length + ' messages as "' + state.name + '". Open it from Adventures.', "ok");
      notify("Chat imported as an adventure.");
    } catch (e) {
      say("Import failed: " + (e && e.message || e), "bad");
    } finally {
      go.disabled = false;
    }
  };
}
