// popups.js — themed replacements for browser dialogs (no prompt()/confirm()/alert()).
// TextPopup (prompt/alert with optional password + char-count) and ConfirmPopup (confirmations).
// Only dependency is back-close (Back button / gesture closes the topmost overlay).

import { pushBackClose } from "./back-close.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- text popup (replaces browser prompt/alert dialogs) ---------- */
// `password: true` renders a masked single-line `<input type="password">` instead of the textarea — the
// one thing the browser's own `prompt()` did that this cannot otherwise do. It changes two behaviours to
// match a single-line field: the value is set through the DOM (never interpolated into the markup, so a
// quote can't break out of the attribute) and plain Enter submits.
// UTF-8 byte helpers: byte caps like the profile bio (emoji = up to 4 bytes). Truncation is
// char-boundary-safe (never splits a code point).
export function utf8ByteLen(s) {
  return new TextEncoder().encode(String(s)).length;
}
export function utf8ByteTrunc(s, maxBytes) {
  const b = new TextEncoder().encode(String(s));
  if (b.length <= maxBytes) return String(s);
  let n = maxBytes;
  while (n > 0 && (b[n] & 0xc0) === 0x80) n--; // step back to a lead byte
  return new TextDecoder().decode(b.subarray(0, n));
}

class TextPopup {
  static open({ title = "Edit", value = "", placeholder = "", rows = 6, readonly = false, confirmText = "Save", cancelText = "Close", password = false, maxLength = 0, maxBytes = 0, note = "" }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "popup-overlay";
      const cap = Math.max(0, maxLength | 0);
      const byteCap = Math.max(0, maxBytes | 0);
      const field = password
        ? `<input type="password" class="popup-ta popup-pw" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" ${readonly ? "readonly" : ""}>`
        : `<textarea class="popup-ta" rows="${rows}" ${readonly ? "readonly" : ""} ${cap && !byteCap ? `maxlength="${cap}"` : ""} placeholder="${esc(placeholder)}">${esc(value)}</textarea>`;
      overlay.innerHTML = `
        <div class="popup">
          <div class="popup-head"><span class="popup-title">${esc(title)}</span><button class="popup-x" title="Close">✕</button></div>
          <div class="popup-text-body" style="padding: 12px 14px;">${note ? `<div class="popup-note">${esc(note)}</div>` : ""}${field}${(cap || byteCap) ? `<div class="popup-count"><span></span> / ${byteCap ? byteCap + " bytes" : cap}</div>` : ""}</div>
          <div class="popup-acts">
            <button class="mini popup-cancel">${esc(cancelText)}</button>
            ${readonly ? "" : `<button class="mini ok popup-save">${esc(confirmText)}</button>`}
          </div>
        </div>`;
      const ta = overlay.querySelector(".popup-ta");
      if (password) ta.value = value;
      const count = overlay.querySelector(".popup-count span");
      if (count && (cap || byteCap)) {
        const paintCount = () => { count.textContent = String(byteCap ? utf8ByteLen(ta.value) : ta.value.length); };
        ta.addEventListener("input", paintCount);
        paintCount();
      }
      const release = pushBackClose(() => done(null));
      const done = (val) => { release(); overlay.remove(); resolve(val); };
      overlay.querySelector(".popup-x").onclick = () => done(null);
      overlay.querySelector(".popup-cancel").onclick = () => done(null);
      const saveBtn = overlay.querySelector(".popup-save");
      if (saveBtn) saveBtn.onclick = () => done(byteCap ? utf8ByteTrunc(ta.value, byteCap) : ta.value);
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(null); });
      ta.addEventListener("keydown", (e) => {
        if (e.key === "Escape") done(null);
        else if (e.key === "Enter" && (password || e.ctrlKey || e.metaKey)) done(byteCap ? utf8ByteTrunc(ta.value, byteCap) : ta.value);
      });
      document.body.appendChild(overlay);
      const keepVisible = (el) => {
        // On-screen keyboard shrinks the visual viewport (or overlays it on iOS) — after it
        // animates in, bring the focused field back into view inside the scrollable popup.
        setTimeout(() => { try { el.scrollIntoView({ block: "center" }); } catch (_) {} }, 300);
      };
      ta.addEventListener("focus", () => keepVisible(ta));
      ta.focus();
      ta.select();
    });
  }
}

/* ---------- confirm dialog (replaces browser confirm dialogs) ---------- */
class ConfirmPopup {
  static open({ title = "Confirm", message = "", warning = "", confirmText = "Confirm", danger = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "popup-overlay";
      overlay.innerHTML = `
        <div class="popup confirm-pop">
          <div class="popup-head"><span class="popup-title">${esc(title)}</span><button class="popup-x" title="Close">✕</button></div>
          <div class="confirm-msg">${esc(message)}</div>
          ${warning ? `<div class="confirm-warn">${esc(warning)}</div>` : ""}
          <div class="popup-acts">
            <button class="mini confirm-cancel">Cancel</button>
            <button class="mini ${danger ? "warn" : "ok"} confirm-ok">${esc(confirmText)}</button>
          </div>
        </div>`;
      const release = pushBackClose(() => done(false));
      const done = (v) => { release(); overlay.remove(); resolve(v); };
      overlay.querySelector(".popup-x").onclick = () => done(false);
      overlay.querySelector(".confirm-cancel").onclick = () => done(false);
      overlay.querySelector(".confirm-ok").onclick = () => done(true);
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(false); });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") done(false);
        else if (e.key === "Enter") done(true);
      });
      document.body.appendChild(overlay);
      overlay.querySelector(".confirm-cancel").focus();
    });
  }

  // Multi-choice confirm: same chrome as open(), but N named buttons instead of one.
  // `options` is [{ label, value, kind, icon, actions }] where kind is "ok" | "warn" | "" and
  // icon is an optional leading svg string (escaped labels stay text — the icon is trusted app
  // chrome, e.g. the folder picker's marks). In `list` mode an option may also carry
  // `actions: [{ icon, title, value, cls }]` — small icon buttons riding at the row's end
  // (e.g. the folder picker's per-folder Rename/Delete). Picking the row resolves the
  // option's `value`; pressing an action button resolves that action's `value` instead.
  // Resolves to the picked option's `value`, or null on Cancel/X/overlay/Escape.
  // `list: true` renders the options as a vertical list INSIDE the panel (above the footer,
  // which keeps only Cancel) instead of crowding them into the footer — for pickers with many
  // options, like the folder picker.
  static choose({ title = "Confirm", message = "", warning = "", options = [], cancelText = "Cancel", list = false }) {
    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "popup-overlay";
      const optBtn = (o, i) => `<button class="mini confirm-pick${o.kind === "warn" ? " warn" : o.kind === "ok" ? " ok" : ""}" data-i="${i}">${o.icon ? `<span class="confirm-pick-ic">${o.icon}</span>` : ""}<span class="confirm-pick-tx">${esc(o.label)}</span></button>`;
      // A row with actions is a group container, not a button (nested buttons are invalid):
      // the main pick takes the row, the action icons ride at its end. The row mirrors the
      // option's kind (ok/warn) so the marked row keeps its accent at the row level.
      const optRow = (o, i) => {
        if (list && o.actions && o.actions.length) {
          const kind = o.kind === "warn" ? " warn" : o.kind === "ok" ? " ok" : "";
          return `<div class="confirm-pick-row${kind}">${optBtn(o, i)}${o.actions.map((a, j) => `<button class="confirm-row-act${a.cls ? " " + esc(a.cls) : ""}" data-i="${i}" data-a="${j}" title="${esc(a.title || "")}" aria-label="${esc(a.title || "")}">${a.icon || ""}</button>`).join("")}</div>`;
        }
        return optBtn(o, i);
      };
      overlay.innerHTML = `
        <div class="popup confirm-pop">
          <div class="popup-head"><span class="popup-title">${esc(title)}</span><button class="popup-x" title="Close">✕</button></div>
          <div class="confirm-msg">${esc(message)}</div>
          ${warning ? `<div class="confirm-warn">${esc(warning)}</div>` : ""}
          ${list ? `<div class="confirm-list">${options.map(optRow).join("")}</div>` : ""}
          <div class="popup-acts">
            <button class="mini confirm-cancel">${esc(cancelText)}</button>
            ${list ? "" : options.map(optBtn).join("")}
          </div>
        </div>`;
      const release = pushBackClose(() => done(null));
      const done = (v) => { release(); overlay.remove(); resolve(v); };
      overlay.querySelector(".popup-x").onclick = () => done(null);
      overlay.querySelector(".confirm-cancel").onclick = () => done(null);
      overlay.querySelectorAll(".confirm-pick").forEach((b) => {
        b.onclick = () => done(options[Number(b.dataset.i)].value);
      });
      overlay.querySelectorAll(".confirm-row-act").forEach((b) => {
        b.onclick = (e) => {
          e.stopPropagation();
          const o = options[Number(b.dataset.i)];
          const a = o && o.actions && o.actions[Number(b.dataset.a)];
          done(a ? a.value : null);
        };
      });
      overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) done(null); });
      overlay.addEventListener("keydown", (e) => {
        if (e.key === "Escape") { e.stopPropagation(); done(null); }
      });
      document.body.appendChild(overlay);
      // Focus the first safe (non-destructive) choice so keyboard users land on the
      // non-destructive action; fall back to Cancel when every choice is destructive.
      const safe = overlay.querySelector(".confirm-pick.ok") || overlay.querySelector(".confirm-cancel");
      if (safe) safe.focus();
    });
  }
}

export { TextPopup, ConfirmPopup };
