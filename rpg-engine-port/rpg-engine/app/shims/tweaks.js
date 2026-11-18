// Cosmetic tweaks: hide features that only make sense on the original hosted platform
// (community Explore page, Tavern chat, identity/admin settings). Nothing in src/ is edited;
// delete this file (and its <script> tag in index.html) to get the full UI back.
(function () {
  "use strict";
  const HIDE_NAV = /^(explore|tavern)$/i;
  const HIDE_SETTINGS = /^(identity|admin)$/i;
  const text = (el) => (el.textContent || "").replace(/\d+$/, "").trim();

  function sweep() {
    // sidebar items (.hn-item), left-panel menu tiles (.menu-cell) and the floating Tavern button
    for (const el of document.querySelectorAll(".hn-item, .menu-cell, #tavernFab")) {
      if (el.id === "tavernFab" || HIDE_NAV.test(text(el))) el.style.display = "none";
    }
    // footer counters that come from the hosting platform ("Last edit ... | Views ...")
    for (const el of document.querySelectorAll(".hn-stats")) el.style.display = "none";
    // welcome banner: the "Explore" column describes the community catalog
    for (const el of document.querySelectorAll(".hm-welcome-step")) {
      if (el.querySelector('.hm-welcome-go[data-go="explore"]')) el.style.display = "none";
    }
    // Settings popup: hide Identity and Admin, and start on "AI Model" instead of Identity
    for (const btn of document.querySelectorAll(".popup button")) {
      if (!HIDE_SETTINGS.test(text(btn))) continue;
      const wasVisible = btn.style.display !== "none";
      btn.style.display = "none";
      const popup = btn.closest(".popup");
      if (wasVisible && popup && !popup.dataset.rpgeStart && /identity/i.test(text(btn))) {
        popup.dataset.rpgeStart = "1";
        const ai = [...popup.querySelectorAll("button")].find((b) => /^AI Model$/i.test(text(b)));
        if (ai) ai.click();
      }
    }
  }
  let queued = false;
  const schedule = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; sweep(); }, 50); };
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  sweep();
})();
