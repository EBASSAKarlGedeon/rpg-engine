// Heroes page — the shelf for the saved-hero library (kv rpg/savedHeroes).
//
// The library is global (shared by every world), which is what makes it useful and also what makes
// deletion dangerous: a hero can be wearing three adventures. Delete therefore names those
// adventures before it asks a second time (answers C: warn, second confirm, then delete).
//
// Hero <-> adventure linkage is by NAME: SessionStore.save only records `charName`, so a rename
// detaches an old adventure from its hero. That is the engine's existing contract, not something
// this page can fix from the outside; it is recorded in the commit message and the page degrades
// safely (an unmatched adventure simply is not counted).

import { HeroStore, SessionStore } from "./storage.js";
import { notify } from "./notify.js";

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
  });
}
function when(ts) {
  if (!ts) return "never";
  const d = new Date(ts);
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return days + " days ago";
  return d.toLocaleDateString();
}
function portraitEl(h, size) {
  const box = document.createElement("div");
  box.className = "hx-thumb";
  box.style.width = box.style.height = size + "px";
  const p = h && h.portrait;
  if (p && (p.startsWith("data:") || p.startsWith("/") || p.startsWith("http"))) {
    const img = document.createElement("img");
    img.src = p;
    img.alt = "";
    box.appendChild(img);
  } else {
    const initials = String((h && (h.label || h.name)) || "?").trim().slice(0, 2).toUpperCase();
    box.classList.add("hx-initials");
    box.textContent = initials;
  }
  return box;
}
function heroNameOf(h) { return String((h && (h.label || h.name)) || "Unnamed"); }

const FIELDS = [
  ["label", "Slot name"], ["name", "Name"], ["gender", "Gender"], ["race", "Race"],
  ["age", "Age"], ["job", "Job / class"], ["appearance", "Appearance"], ["extra", "Notes"],
  ["persona", "Persona / bio"]
];

async function openEditor(hero) {
  return new Promise(function (resolve) {
    const overlay = document.createElement("div");
    overlay.className = "hx-modal";
    overlay.innerHTML =
      '<div class="hx-panel" tabindex="-1">' +
      '<div class="hx-head"><span>' + (hero ? "Edit hero" : "New hero") + '</span>' +
      '<button type="button" class="hx-x" title="Close">✕</button></div>' +
      '<div class="hx-form">' + FIELDS.map(function (f) {
        const long = f[0] === "appearance" || f[0] === "extra" || f[0] === "persona";
        const v = esc((hero && hero[f[0]]) || "");
        return '<label class="hx-row' + (long ? " hx-long" : "") + '"><span>' + f[1] + "</span>" +
          (long ? '<textarea rows="4">' + v + "</textarea>" : '<input type="text" value="' + v + '">') +
          "</label>";
      }).join("") + "</div>" +
      '<div class="hx-acts"><button type="button" class="hx-btn" data-x="cancel">Cancel</button>' +
      '<button type="button" class="hx-btn primary" data-x="save">Save</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector(".hx-panel").focus();
    const close = function (v) { overlay.remove(); resolve(v); };
    overlay.querySelector(".hx-x").onclick = function () { close(null); };
    overlay.querySelector('[data-x="cancel"]').onclick = function () { close(null); };
    overlay.addEventListener("keydown", function (e) { if (e.key === "Escape") close(null); });
    overlay.querySelector('[data-x="save"]').onclick = function () {
      const out = Object.assign({}, hero || {});
      const inputs = overlay.querySelectorAll(".hx-form input, .hx-form textarea");
      FIELDS.forEach(function (f, i) {
        const v = inputs[i].value.trim();
        if (v) out[f[0]] = v; else delete out[f[0]];
      });
      if (!out.name && !out.label) { notify("Give the hero a name first."); return; }
      close(out);
    };
  });
}

function download(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
}

export async function mountHeroesPage(pane, ctx) {
  if (!window.root || !window.root.kv) {
    pane.innerHTML = '<div class="hm-empty">This page needs to run inside Loreweaver.</div>';
    return;
  }
  const heroes = new HeroStore(window.root.kv);
  const sessions = new SessionStore(window.root.kv);

  pane.innerHTML = `
    <style>
      .hx-wrap { max-width: 980px; }
      .hx-bar { display: flex; gap: 8px; align-items: center; margin: 8px 2px 14px; }
      .hx-search { flex: 1; max-width: 320px; background: var(--panel2, #1a1a18); color: var(--text, #e0d6b8); border: 1px solid var(--border, #2a2520); border-radius: 3px; padding: 8px 10px; font: inherit; font-size: 13px; }
      .hx-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
      .hx-card { border: 1px solid var(--border, #2a2520); border-radius: 4px; background: var(--panel, #161512); padding: 12px; display: flex; flex-direction: column; gap: 10px; }
      .hx-top { display: flex; gap: 10px; align-items: center; }
      .hx-thumb { border-radius: 4px; overflow: hidden; background: var(--panel2, #1a1a18); border: 1px solid var(--border, #2a2520); flex: none; display: flex; align-items: center; justify-content: center; }
      .hx-thumb img { width: 100%; height: 100%; object-fit: cover; }
      .hx-initials { color: var(--muted, #a89c82); font-size: 15px; letter-spacing: .08em; }
      .hx-name { font-weight: 600; color: var(--text, #e0d6b8); line-height: 1.2; }
      .hx-sub { font-size: 12px; color: var(--muted2, #8a8070); margin-top: 2px; }
      .hx-when { font-size: 12px; color: var(--muted2, #8a8070); }
      .hx-acts { display: flex; gap: 6px; flex-wrap: wrap; }
      .hx-btn { background: transparent; border: 1px solid var(--border, #2a2520); color: var(--text, #e0d6b8); font: inherit; font-size: 12px; padding: 6px 9px; border-radius: 3px; cursor: pointer; }
      .hx-btn:hover { border-color: var(--accent, #8b9a6e); color: var(--accent, #8b9a6e); }
      .hx-btn.primary { border-color: var(--accent, #8b9a6e); color: var(--accent, #8b9a6e); }
      .hx-btn.danger:hover { border-color: #b0735b; color: #b0735b; }
      .hx-empty { color: var(--muted2, #8a8070); font-size: 13px; }
      .hx-modal { position: fixed; inset: 0; background: rgba(0,0,0,.6); display: flex; align-items: center; justify-content: center; z-index: 9999; }
      .hx-panel { background: var(--panel, #161512); border: 1px solid var(--border, #2a2520); border-radius: 5px; width: min(560px, 92vw); max-height: 86vh; overflow: auto; outline: none; }
      .hx-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; border-bottom: 1px solid var(--border, #2a2520); font-weight: 600; color: var(--text, #e0d6b8); }
      .hx-x { background: none; border: 0; color: var(--muted, #a89c82); font-size: 15px; cursor: pointer; }
      .hx-form { padding: 12px 14px; display: flex; flex-direction: column; gap: 9px; }
      .hx-row { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: var(--muted, #a89c82); }
      .hx-row input, .hx-row textarea { background: var(--panel2, #1a1a18); color: var(--text, #e0d6b8); border: 1px solid var(--border, #2a2520); border-radius: 3px; padding: 7px 8px; font: inherit; font-size: 13px; }
      .hx-acts .hx-btn { padding: 8px 14px; }
      .hx-panel .hx-acts { padding: 12px 14px; border-top: 1px solid var(--border, #2a2520); justify-content: flex-end; }
    </style>
    <div class="hx-wrap">
      <div class="hx-bar"><input class="hx-search" type="search" placeholder="Search heroes…"><span class="hx-count"></span></div>
      <div class="hx-grid"></div>
    </div>`;

  const grid = pane.querySelector(".hx-grid");
  const search = pane.querySelector(".hx-search");
  const countEl = pane.querySelector(".hx-count");
  let q = "";
  search.oninput = function () { q = search.value.toLowerCase(); void render(); };

  if (ctx && ctx.actionsEl) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hm-act hm-act-primary";
    b.textContent = "＋ New Hero";
    b.onclick = async function () {
      const made = await openEditor(null);
      if (!made) return;
      await heroes.save(made, made.label || made.name);
      notify("Hero created.");
      void render();
    };
    ctx.actionsEl.appendChild(b);
  }

  async function playCount(hero) {
    const name = String(hero.name || hero.label || "").toLowerCase();
    const list = await sessions.list();
    return list.filter(function (s) { return String(s.charName || "").toLowerCase() === name; });
  }

  async function render() {
    let list = await heroes.list();
    list = list.filter(function (h) {
      const hay = [h.label, h.name, h.race, h.job, h.appearance].join(" ").toLowerCase();
      return !q || hay.indexOf(q) !== -1;
    });
    countEl.textContent = list.length + (list.length === 1 ? " hero" : " heroes");
    grid.innerHTML = "";
    if (!list.length) {
      grid.innerHTML = '<p class="hx-empty">No heroes yet. Create one here, or import personas from Import from Loreweaver.</p>';
      return;
    }
    const advs = await sessions.list();
    for (const h of list) {
      const name = String(h.name || h.label || "").toLowerCase();
      const mine = advs.filter(function (s) { return String(s.charName || "").toLowerCase() === name; });
      const last = mine.reduce(function (n, s) { return Math.max(n, s.lastUpdated || 0); }, 0);
      const card = document.createElement("div");
      card.className = "hx-card";
      const top = document.createElement("div");
      top.className = "hx-top";
      top.appendChild(portraitEl(h, 56));
      const info = document.createElement("div");
      info.innerHTML = '<div class="hx-name">' + esc(heroNameOf(h)) + "</div>" +
        '<div class="hx-sub">' + esc([h.race, h.job].filter(Boolean).join(" · ") || "—") + "</div>";
      top.appendChild(info);
      card.appendChild(top);
      const meta = document.createElement("div");
      meta.className = "hx-when";
      meta.textContent = "Last played " + when(last) + (mine.length ? " · " + mine.length + (mine.length === 1 ? " adventure" : " adventures") : "");
      card.appendChild(meta);

      const acts = document.createElement("div");
      acts.className = "hx-acts";
      const mk = function (label, cls, fn) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "hx-btn" + (cls ? " " + cls : "");
        b.textContent = label;
        b.onclick = fn;
        acts.appendChild(b);
        return b;
      };
      mk("Edit", "", async function () {
        const made = await openEditor(h);
        if (!made) return;
        await heroes.save(made, made.label || made.name, h.id);
        notify("Hero saved.");
        void render();
      });
      mk("Duplicate", "", async function () {
        const copy = Object.assign({}, h, { id: undefined, savedAt: Date.now(), label: heroNameOf(h) + " (copy)", lwSource: undefined });
        delete copy.id;
        await heroes.save(copy, copy.label);
        notify("Duplicated.");
        void render();
      });
      mk("Export", "", function () {
        download(heroNameOf(h).replace(/[^\w -]+/g, "_") + ".hero.json", JSON.stringify(h, null, 2));
      });
      mk("Delete", "danger", async function () {
        if (!window.confirm('Delete "' + heroNameOf(h) + '"?\n\n' + (mine.length
          ? "Used by " + mine.length + " adventure(s):\n" + mine.slice(0, 8).map(function (s) { return "· " + (s.name || s.charName); }).join("\n") + "\n\nThose adventures keep playing, but they lose the link to this hero."
          : "No adventure uses this hero."))) return;
        if (!window.confirm("Delete " + heroNameOf(h) + " permanently? This cannot be undone.")) return;
        await heroes.remove(h.id);
        notify("Hero deleted.");
        void render();
      });
      card.appendChild(acts);
      grid.appendChild(card);
    }
  }

  await render();
}
