# Tracked patches to `app/src/`

The port rule is to keep `app/src/` untouched so upstream updates drop in. Every deviation
is listed here with exact locations. If you ever re-copy a newer `app/src/`, re-apply these.

---

## [rpge-patch 001] Route id on outgoing requests (per-job profile routing)

**File:** `src/scripts/ai-provider.js`

**Why:** the engine's per-job routing (`routedGenText`) knows which job a call is for
(`route` ids: gm / check / staging / tracker / npc / scene / memory / npclife / other) but
strips the id before calling `openaiGenText`, so nothing on the wire identifies the job.
The Loreweaver bridge shim needs that id to pick the **Connection Manager profile** for the
job (role matrix, bridge v3).

**Change (2 lines):**

1. `openaiGenText(norm)` → `openaiGenText(norm, route)`; after the `headers` block, add:
   ```js
   headers["X-RPGE-Route"] = AI_ROUTE_IDS.includes(route) ? route : "other";
   ```
2. In `routedGenText`, the external branch becomes:
   ```js
   return openaiGenText(normalizeInput(cleanInput, cleanExtra), route);
   ```

**Impact when bridge is off:** one extra custom header on direct provider calls; real
providers ignore unknown headers. No behaviour change otherwise.

**Revert:** delete both lines and the `, route` arguments.

---

## [rpge-patch 002] World Editor tabs never switch panes (`[hidden]` beaten by display:flex)

**File:** `src/styles.css` (editor section, next to the `.ce-view` rule ~line 2680)

**Why:** the editor hides inactive tab panes by toggling the `hidden` attribute on
`.ce-view` divs (`world-editor.js showTab`), but the stylesheet sets
`.ce-view { display: flex }` — an author `display` beats the UA `[hidden]{display:none}`
rule, so **every pane stays visible**: the initially painted Basics pane never goes away
and each newly shown pane collapses to height 0 and stacks behind it. Symptom: clicking
Story/Lorebook/NPC/Stats/… highlights the tab but keeps showing Basics, with fragments of
other panes overlapping (user report 2026-11-18, browser recording). The codebase's own
convention elsewhere is explicit `[hidden]` display rules (`.ce-dirty[hidden]`,
`#tavernFab[hidden]`, …) — this one was simply missing upstream.

**Change (2 rules):**

```css
.ce-view[hidden] { display: none; }
.ce-lore-aiwrap[hidden] { display: none; }   /* "Split text with AI" wrapper — same class of bug:
                                                toggled via .hidden in world-editor.js, its
                                                display:flex rule defeated the hidden attribute */
```

**Impact when reverted:** editor tabs visually break for every world (not world-specific);
the AI-split wrapper can never collapse in Lorebook/NPC/Stats/Trackers tabs.

**Revert:** delete both rules.

---

## [rpge-patch 003] Live Worlds-list refresh when a world is written from outside the game

**File:** `src/scripts/main.js` (right after the `initScenarioImport({…})` call, ~line 393)

**Why:** "Add as world" on the import page writes the world into `kv.worlds` from a different
document (import overlay / another tab). The game's Worlds list only refreshed on its own
writes (`refreshWorldNameCache` / `refreshLanding` are main.js-internal, no global hook, no
focus/visibility re-render), so the user had to reload the page to see the new world.

**Change (2 lines):**

```js
window.addEventListener("rpge-worlds-changed", () => { try { refreshWorldNameCache(); refreshLanding(); } catch (e) { /* optional */ } });
```

Plus a forwarder in OUR shim `app/shims/loreweaver-storage.js` (not a patch — our file):
`BroadcastChannel("rpge-kv")` messages of type `worlds-changed` are re-dispatched as the
window event above. The import page posts that message after "Add as world". Same-origin
BroadcastChannel crosses overlay iframes and tabs; a missing channel just means the world
appears on next page load as before.

**Impact when bridge is off:** none — the event only fires on the channel message.

**Revert:** delete the `window.addEventListener` line (and optionally the shim block).

---

## [rpge-patch 004] `worldDescription` — a first-class always-canon world field (v2.6 mapping)

**Files:** `src/scripts/world.js`, `src/scripts/rp-engine.js`, `src/scripts/world-editor.js`, `src/scripts/context-budget.js` (one param each), plus our `app/loreweaver-import.html` (not a patch).

**Why (user decision 2026-11-18):** "Add as world" collapsed card description+personality+scenario
into one always-on law entry — wrong scope, bloated every prompt. A card's description/personality
is **world canon**, so it gets its own field instead of pretending to be lore.

**Change:**
- `world.js`: `normalizeWorld`/`worldToFile` carry `worldDescription: str(obj.worldDescription)`.
  `WORLD_VERSION` stays 1 — optional field: old engine + new file silently drops it (canonical
  builder whitelist, no error); new engine + old world reads empty. That IS the backwards compat.
- `rp-engine.js`: constructor `worldDescriptionText`; `buildContext` injects, after NARRATIVE VIBE
  and before WORLD PREMISE: `"WORLD DESCRIPTION (always true — canon about the world and its people):\n" + sub(...)`. GM-only (not in map/NPC digests).
- `context-budget.js` measurement factory passes it too (token accounting honest).
- `world-editor.js` Story tab: "Description" textarea (`#ceWDesc`, both single- and multi-start
  paths), tip distinguishes it from the Basics tab's Description (= `meta.description`, UI-only).
- Import v2.6 (our import page): description+personality → `worldDescription`; scenario →
  `world.scenario`; `first_mes` → opening 1 + `alternate_greetings` → openings 2..N (verbatim,
  auto-titled "Greeting N"); `system_prompt` → `narrativeVibe`; `creator_notes` →
  `meta.authorNotes`; `tags` → `meta.tags` with `nsfw` → `meta.nsfw`; dropped (no slot):
  `mes_example`, `post_history_instructions`, `depth_prompt`, `talkativeness`, `regex_scripts`.
  The auto "Rules" law entry is gone. Update migrates old imports: strips an always-law titled
  "Rules" with no keywords, overwrites story/scenario (only with fresh content), appends
  system_prompt to vibe with `\n\n---\n\n`, replaces previously imported openings (ids tracked in
  the registry record as `startIds`; custom + game-side openings survive).

**Impact when bridge is off:** none — it's core schema/prompt behavior; worlds without the field behave as before.

**Revert:** remove the `worldDescription` lines in world.js (2), rp-engine.js (2), context-budget.js,
world-editor.js (3 lines + the textarea in 2 templates); import page falls back to v2.5 mapping by history.

## [rpge-patch 005] OP-MC free-build features (free stats, tracker overrides/modes, powers, mid-game edit, no-crit-fail)

**Files:** `src/scripts/character.js`, `src/scripts/main.js`, `src/scripts/trackers.js`,
`src/scripts/rp-engine.js`, `src/scripts/stats.js`, `src/styles.css`.

**Why (user decision 2026-11-18, answered 7 plan questions):** the point of the port — support
overpowered player characters: no point budget, hand-set tracker starts, per-tracker
locked/unlimited modes, a free-text powers sheet the GM always knows, mid-game stat/tracker
editing, and an optional no-critical-failure rule. All per-hero, off by default.

**Change:**
- `character.js`: `defaultCharacter()` gains optional fields — `freeBuild`, `powers`,
  `trackerOverrides` (world-opening shape), `trackerModes` (`{key:"locked"|"unlimited"}`),
  `freeEdit`, `noCritFail`; `characterSheet` emits a `Powers & abilities` block after stats.
  `initCharacterStats` (main.js) normalizes them at load (booleans/string; overrides restricted
  to finite numbers on known tracker keys; modes restricted to `locked`/`unlimited` on known keys).
- Wizard: Stats step gains a **Free build** checkbox (ignores `ccBudget` + `ccCeiling`; a stat is
  capped only by its own world `max`, and a world without one is unlimited); a **Trackers step**
  (worlds with number trackers only) lists Start/Max inputs seeded from `initialTrackers` +
  the opening's own `trackerOverrides`, with a Normal/🔒Locked/∞Unlimited select per tracker; the
  Review step gains a **Powers & abilities** textarea and a **No critical failures** checkbox.
  All of it persists through the wizard draft and onto the hero at Begin. The hero's
  `trackerOverrides` merge OVER the opening's (hero wins) when seeding `s.initialTrackers`.
- `trackers.js`: `applyTrackerModes(snap, defs, modes, current, stats)` — applied AFTER the
  tracker call's parse (and the chat-side editor path): locked = value restored to the pre-turn
  snapshot; unlimited = number trackers re-filled to their live max (formula caps keep working).
  GM context annotated: `trackerValueLines`/`buildTrackerValuesContext` get a `modes` arg
  ("LOCKED: never changes" / "UNLIMITED: never depletes"); `buildTrackerContext` gets hard
  instructions for the tracker call.
- `rp-engine.js`: passes `state.character.trackerModes` into both context builders and applies
  `applyTrackerModes` in `updateTrackers` after `parseTrackerBlock`.
- Hero panel: a ✎ **free-edit** toggle (always visible, gold while on) — stats keep −/+ outside
  level-up windows (raising costs no points), a tracker editor (value/max inputs) appears, and
  `showSave` follows. `spendStat` handles freeEdit. `applyManualTrackerEdit` rewrites the LATEST
  `afterTrackers` snapshot (or `initialTrackers`) so the next turn's GM context picks it up.
  Tracker chips/bars show 🔒/∞ badges.
- `stats.js`: `resolveCheck(decision, stats, defs, cfg, opts)` — `opts.noCritFail` disables the
  critical-FAILURE window (worst rolls decided by total vs DC; crit successes stay).

**Impact when bridge is off:** none — all core behavior; heroes without these fields behave exactly as before.

**Revert:** drop the new fields in character.js + their initCharacterStats normalization; wizard
reverts to ["start","bio","avatar","stats","review"] without the new views/handlers; remove
`applyTrackerModes` + the `modes` args; hero panel reverts to windowOpen-only editing; resolveCheck
drops `opts`. (Large surface — easiest to keep.)
