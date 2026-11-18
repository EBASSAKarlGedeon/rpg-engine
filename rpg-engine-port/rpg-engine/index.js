// SillyTavern glue for the RPG Engine port. Deliberately tiny: it only shows a full-screen overlay
// containing app/index.html in an iframe. No SillyTavern internals are imported, so it survives
// SillyTavern updates. UNTESTED against a live SillyTavern: see the VERIFY list in PORT-PLAN.md (P3).
(function () {
  "use strict";

  // The folder this extension was installed into, derived from this file's own URL.
  // Typical result: /scripts/extensions/third-party/rpg-engine/
  const BASE = (() => {
    try {
      if (typeof import.meta !== "undefined" && import.meta.url) return new URL(".", import.meta.url).href;
    } catch (e) { /* fall through */ }
    const s = document.currentScript && document.currentScript.src;
    if (s) return new URL(".", s).href;
    return "/scripts/extensions/third-party/rpg-engine/";
  })();
  const APP_URL = BASE + "app/index.html";

  let root = null;
  let frame = null;

  function ensureOverlay() {
    if (root) return root;
    root = document.createElement("div");
    root.id = "rpge-root";
    root.hidden = true;

    const bar = document.createElement("div");
    bar.id = "rpge-bar";
    const title = document.createElement("span");
    title.className = "rpge-title";
    title.textContent = "RPG ENGINE";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "rpge-close";
    close.textContent = "Close ✕";
    close.setAttribute("aria-label", "Close RPG Engine");
    close.addEventListener("click", closeOverlay);
    bar.append(title, close);

    frame = document.createElement("iframe");
    frame.id = "rpge-frame";
    frame.title = "RPG Engine";
    // Same-origin on purpose: the app stores its data in this origin's IndexedDB/localStorage.
    frame.setAttribute("allow", "fullscreen; clipboard-write");

    root.append(bar, frame);
    document.body.appendChild(root);
    return root;
  }

  function openOverlay() {
    ensureOverlay();
    if (!frame.getAttribute("src")) frame.setAttribute("src", APP_URL); // load lazily on first open
    root.hidden = false;
    document.documentElement.classList.add("rpge-open");
  }

  function closeOverlay() {
    if (!root) return;
    root.hidden = true; // keep the iframe alive so a running turn is not interrupted
    document.documentElement.classList.remove("rpge-open");
  }

  // 1) entry in the Extensions (wand) menu. VERIFY the id/markup against your SillyTavern version.
  function addMenuEntry() {
    const menu = document.getElementById("extensionsMenu");
    if (!menu || document.getElementById("rpge-menu-entry")) return !!menu;
    const item = document.createElement("div");
    item.id = "rpge-menu-entry";
    item.className = "list-group-item flex-container flexGap5 interactable";
    item.tabIndex = 0;
    item.title = "Open RPG Engine";
    const icon = document.createElement("div");
    icon.className = "fa-solid fa-dice-d20 extensionsMenuExtensionButton";
    const label = document.createElement("span");
    label.textContent = "RPG Engine";
    item.append(icon, label);
    item.addEventListener("click", openOverlay);
    item.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") openOverlay(); });
    menu.appendChild(item);
    return true;
  }

  // 2) floating launcher, so the extension is reachable even if the menu markup changes.
  //    Hide it with:  #rpge-launcher { display: none }
  function addLauncher() {
    if (document.getElementById("rpge-launcher")) return;
    const b = document.createElement("button");
    b.id = "rpge-launcher";
    b.type = "button";
    b.title = "Open RPG Engine";
    b.setAttribute("aria-label", "Open RPG Engine");
    b.textContent = "⚔";
    b.addEventListener("click", openOverlay);
    document.body.appendChild(b);
  }

  function ensureStyles() {
    // Loreweaver/ST only loads the manifest CSS of top-level extension folders, so this
    // nested port's style.css is never linked automatically. Inject it ourselves so the
    // overlay + launcher are styled wherever this wrapper runs.
    if (document.getElementById("rpge-style")) return;
    const link = document.createElement("link");
    link.id = "rpge-style";
    link.rel = "stylesheet";
    link.href = BASE + "style.css";
    document.head.appendChild(link);
  }

  function init() {
    ensureStyles();
    addLauncher();
    // Preload the game iframe while hidden, so the first "Open RPG Engine" is instant
    // (same renderer page just sits idle). Deferred so Loreweaver's own startup is
    // not slowed; the overlay stays hidden until opened.
    const preload = () => {
      try { ensureOverlay(); if (!frame.getAttribute("src")) frame.setAttribute("src", APP_URL); } catch (e) {}
    };
    if (window.requestIdleCallback) window.requestIdleCallback(preload, { timeout: 15000 });
    else setTimeout(preload, 3000);
    // The menu can be built after our script runs; retry for a while.
    let tries = 0;
    const timer = setInterval(() => {
      if (addMenuEntry() || ++tries > 60) clearInterval(timer);
    }, 500);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.rpgEngine = { open: openOverlay, close: closeOverlay, appUrl: APP_URL }; // handy from the console
})();
