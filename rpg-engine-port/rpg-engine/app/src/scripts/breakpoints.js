// breakpoints.js — the single source of truth for width breakpoints (no dependencies).
//
// Canonical layout breakpoints (see the header comment in src/styles.css — keep the two in sync):
//   PHONE = 640 — all phone layout (tracker/composer/topbar, editor split, lightbox, search fit)
//   PANEL = 760 — card/panel stacking (settings rail, explore cards, world panel, Tavern)
//   SHELL = 900 — nav drawer, landing header bar, session rails (phones + tablets, no separate tablet)
//   WIDE  = 1024 — transcript full-width + rail default-open (default-state, not layout)
// Micro-refinements (not layout triggers, stay as literals in CSS): 560, 470, 360, 340,
// max-height rules, pointer/hover/motion queries.
//
// Rule: width-based layout decisions use these helpers. `pointer: coarse` / `hover: none`
// stay reserved for input affordances only (composer placeholder, tap vs hover tips),
// never for layout.

export const BP_PHONE = 640;
export const BP_PANEL = 760;
export const BP_SHELL = 900;
export const BP_WIDE = 1024;

export const Q_PHONE = `(max-width: ${BP_PHONE}px)`;
export const Q_PANEL = `(max-width: ${BP_PANEL}px)`;
export const Q_SHELL = `(max-width: ${BP_SHELL}px)`;
export const Q_WIDE_MIN = `(min-width: ${BP_WIDE}px)`;

export function isPhoneWidth() { return window.matchMedia(Q_PHONE).matches; }
export function isPanelNarrow() { return window.matchMedia(Q_PANEL).matches; }
export function isShellNarrow() { return window.matchMedia(Q_SHELL).matches; }
export function isWide() { return window.matchMedia(Q_WIDE_MIN).matches; }
