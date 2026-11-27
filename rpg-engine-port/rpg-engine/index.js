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
  let appReady = false;        // app boots ~90 modules before its rpgeOpen listener exists
  let pendingOpen = null;      // { target, seq } — cleared only by the app's acknowledgement
  let openSeq = 0;
  let retryTimer = null;
  let fallbackTimer = null;
  let settleTimer = null;
  let readyTimeOrigin = 0; // document that sent rpgeReady; a reload gives a new timeOrigin

  function frameTimeOrigin() {
    try { return frame.contentWindow.performance.timeOrigin || 0; } catch (e) { return 0; }
  }
  function clearFallback() {
    if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
  }
  function clearSettle() {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null; }
  }
  // The app registers its message listener early but only finishes mounting its shells at the end
  // of init(). A deep link delivered before that has nothing to mount into, so wait for rpgeReady
  // instead of posting blindly. The fallback covers an app version that predates the handshake.
  function waitForReady() {
    clearFallback();
    fallbackTimer = setTimeout(function () {
      fallbackTimer = null;
      if (!appReady && pendingOpen !== null) { postOpen(pendingOpen); armRetries(); }
    }, 10000);
  }

  function postOpen(req) {
    try { frame.contentWindow.postMessage({ rpgeOpen: true, target: req.target, seq: req.seq }, location.origin); } catch (e) {}
  }
  function clearRetries() {
    if (retryTimer) { clearInterval(retryTimer); retryTimer = null; }
  }
  // Retry the deep link until the app answers its ready handshake. Re-posting a target that
  // already mounted is a no-op (setHomePage returns for the current page), so the retries are safe.
  function armRetries() {
    clearRetries();
    let tries = 0;
    retryTimer = setInterval(function () {
      if (pendingOpen === null || ++tries > 30) { clearRetries(); return; }
      postOpen(pendingOpen);
    }, 250);
  }

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
    frame.addEventListener("load", function () {
      // A reload restarts the app: its listener is gone until boot finishes. Keep the last target
      // queued and retry, rather than treating the stale "ready" as still valid.
      appReady = false;
      clearRetries();
      clearSettle();
      if (pendingOpen !== null) {
        pendingOpen.docOrigin = frameTimeOrigin();
        pendingOpen.acked = false;
        waitForReady();
      }
    });
    window.addEventListener("message", function (e) {
      if (e.source !== frame.contentWindow || e.origin !== location.origin) return;
      if (!e.data) return;
      if (e.data.rpgeReady === true) {
        appReady = true;
        readyTimeOrigin = frameTimeOrigin();
        clearFallback();
        clearSettle();
        if (pendingOpen !== null) {
          pendingOpen.docOrigin = frameTimeOrigin();
          pendingOpen.acked = false;
          postOpen(pendingOpen);
          armRetries();
        }
        return;
      }
      if (e.data.rpgeOpenAck !== undefined && pendingOpen && e.data.rpgeOpenAck === pendingOpen.seq
          && (e.data.docOrigin === undefined || e.data.docOrigin === pendingOpen.docOrigin)) {
        // An ack can come from the OLD document while a reload is already navigating: its work is
        // about to be thrown away. Keep the request until the document settles, then decide.
        pendingOpen.acked = true;
        clearRetries();
        clearFallback();
        clearSettle();
        const seq = pendingOpen.seq;
        settleTimer = setTimeout(function () {
          settleTimer = null;
          if (!pendingOpen || pendingOpen.seq !== seq) return;
          if (frameTimeOrigin() === pendingOpen.docOrigin) {
            pendingOpen = null;
          } else {
            pendingOpen.acked = false;
            waitForReady();
          }
        }, 2500);
      }
    });
    return root;
  }

  // openOverlay(target): with a deep-link target (postMessage into the app, see main.js's
  // rpgeOpen listener) the game opens straight on it — "imports" mounts the Import page,
  // "settings/aimodel" opens the Settings popup on AI Model. Works from the chat too (the
  // app re-enters the landing first); safe when the iframe is still loading (posted on load).
  function openOverlay(target) {
    if (target && typeof target !== "string") target = undefined; // click handlers pass the event object
    ensureOverlay();
    // A reload swaps the document without necessarily delivering "load" before the click; the
    // new document's timeOrigin is the reliable marker that the previous ready handshake is stale.
    if (appReady && frameTimeOrigin() !== readyTimeOrigin) appReady = false;
    clearSettle();
    pendingOpen = { target: target || "", seq: ++openSeq, docOrigin: frameTimeOrigin(), acked: false };
    if (!frame.getAttribute("src")) frame.setAttribute("src", APP_URL); // load lazily on first open
    root.hidden = false;
    document.documentElement.classList.add("rpge-open");
    if (appReady) {
      // Fully booted: post now, then retry until the app acknowledges it.
      postOpen(pendingOpen);
      armRetries();
    } else {
      // Still booting/navigating: the ready handshake flushes the queued target.
      waitForReady();
    }
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
