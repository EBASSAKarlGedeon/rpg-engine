// SillyTavern background -> RPG Engine landing background.
//
// SillyTavern paints the picture chosen in its Backgrounds panel onto #bg1
// (public/scripts/backgrounds.js). The engine runs in a same-origin iframe, so it can read that
// element straight from the parent document: no API, no copy of the file, and a change made in
// SillyTavern shows up here without a reload. One background for every page of the engine; nothing
// is written back, and there is no dim/blur control (the image is shown as SillyTavern shows it).

let started = false;
let observer = null;

function parentDoc() {
  try {
    if (window.parent && window.parent !== window) return window.parent.document;
  } catch (e) { /* cross-origin: leave the engine's own background alone */ }
  return null;
}

function readStBackground() {
  const doc = parentDoc();
  const src = doc && doc.getElementById("bg1");
  if (!src) return "";
  let img = src.style.backgroundImage || "";
  if (!img || img === "none") {
    try { img = window.parent.getComputedStyle(src).backgroundImage || ""; } catch (e) { img = ""; }
  }
  if (!img || img === "none") return "";
  // SillyTavern's url() is relative to ITS page; inside the iframe that path would 404.
  const m = img.match(/url\((["']?)(.*?)\1\)/);
  if (!m) return "";
  try {
    const abs = new URL(m[2], doc.baseURI || window.parent.location.href).href;
    return 'url("' + abs + '")';
  } catch (e) { return img; }
}

export function initStBackground() {
  const bg = document.getElementById("ldBg");
  if (!bg || started) return;
  started = true;

  const sync = function () {
    const img = readStBackground();
    if (!img) {
      // No background chosen in SillyTavern: fall back to the engine's own look.
      bg.style.backgroundImage = "";
      bg.style.removeProperty("background-size");
      bg.style.removeProperty("background-position");
      return;
    }
    bg.style.backgroundImage = img;
    bg.style.backgroundSize = "cover";
    bg.style.backgroundPosition = "center";
    bg.style.backgroundRepeat = "no-repeat";
  };

  sync();

  const doc = parentDoc();
  if (doc && doc.getElementById("bg1")) {
    observer = new MutationObserver(sync);
    observer.observe(doc.getElementById("bg1"), { attributes: true, attributeFilter: ["style", "class", "src"] });
  }
  // SillyTavern may swap #bg1's source element entirely (theme changes); watch the body shallowly
  // so a replaced #bg1 is picked up, without observing every style change in the app.
  if (doc) observer.observe(doc.body, { childList: true, subtree: false });
  window.addEventListener("pagehide", function () { if (observer) observer.disconnect(); observer = null; }, { once: true });
}
