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

## [rpge-patch 006] Bridged context budget + dead-community asset cleanup (roadmap 6 & 7)

**Files:** `src/scripts/ai-provider.js`, `src/scripts/rp-engine.js`, `src/scripts/community.js`
(deletions only), plus our `app/loreweaver-bridge.html` (config page). Deleted files:
`app/src/stickers/` (~1.4 MB), `app/src/scripts/mock-seed.js`.

**Why:** (7) under the Loreweaver bridge the engine believed it was talking to Perchance — the
shim still presents as Perchance AI — so every prompt was measured/fit against
`PERCHANCE_INPUT_CAP = 6976` and the memory/lore feed caps stayed at ×1, massively under-using
real models' windows. (6) roadmap cleanup: the community backend doesn't exist in Loreweaver, so
the mock-catalog seeder and the sticker pack are dead weight.

**Change:**
- `ai-provider.js`: `routeUsesExternal()` returns true for EVERY route while the bridge is
  enabled (checks `rpge.loreweaverBridge.enabled`) — the existing EXTERNAL_CAP_MULTIPLIER ×2
  memory/lore caps, external tracker output caps and roll-up behavior light up automatically.
  New export `bridgedInputCap()`: reads `contextTokens` from the bridge config (clamped
  2048–200000, default 16384), null when the bridge is off or unreadable → callers keep legacy
  behavior. Bridge OFF = byte-identical to before.
- `rp-engine.js`: `bridgedCap()` (cached dynamic import, fails safe to null). `gmFitOpts` —
  bridged routes now MEASURE and FIT to the configured budget (estimator, no Perchance plugin
  counter off-Perchance) instead of sending an unmeasured full window; engine-native external
  providers (bridge off) keep the legacy full-window behavior. `fittedInstruction` and
  `fitTranscript` take the cap through `fitBase.cap`/`fit.cap` (`limit = cap − GM_FIT_MARGIN`).
- `loreweaver-bridge.html`: "Context budget (tokens)" number field → `rpge.loreweaverBridge.contextTokens`.
- `community.js`: removed the 🧪 "Seed mock worlds" button + `runMockSeed`; `mock-seed.js` deleted
  (nothing else imports it).
- `app/src/stickers/` deleted: only the dead Tavern/discussion module referenced it; its picker
  and sticker rendering would 404 images IF a community server were ever configured (it won't be
  in Loreweaver). Code left untouched — a full discussion.js surgery isn't worth the risk.

**Impact when bridge is off:** none (all new logic gated on `bridgedInputCap() !== null`; deletions
touch dead code only). With the bridge ON and no `contextTokens` saved yet: 16384 default.

**Revert:** restore `mock-seed.js` + `stickers/` from history; remove the bridge branch in
`routeUsesExternal`, `bridgedInputCap`, `bridgedCap`, the `cap` threading, and the config field.

## [rpge-patch 007] Generator prompts see the worldDescription canon (NPC / stat / tracker generators)

**Files:** `src/scripts/world-editor.js` (2 spots).

**Why (user request 2026-11-18):** the ✨ Generate NPC / stat / tracker prompts were built from
vibe + scenario + lorebook — after patch 004 the card-import canon lives in `worldDescription`,
so generated cast matched the lorebook tail but not the card's actual rules (first try would
need manual fixing on imported worlds).

**Change:** `npcAiInstruction` adds `WORLD DESCRIPTION (always true — canon about the world and
its people):` (first 3000 chars) after the scenario; `defAiContext` (shared by the stat and
tracker generators) adds a 1200-char canon slice. The lorebook converter (`loreAiInstruction`) is
deliberately untouched — the raw pasted text IS its source.

**Impact when bridge is off:** none — prompts only get longer when a world actually has a
worldDescription (patch 004 worlds); old worlds generate exactly as before.

**Revert:** delete the two `M.worldDescription ? … : ""` lines.

## [rpge-patch 008] NPC generator pulls keyword-matched lorebook entries IN FULL

**Files:** `src/scripts/world-editor.js` (import + `npcAiInstruction`).

**Why (user request 2026-11-18):** generating an NPC for an existing character (present as a
lorebook entry deep in a big book) worked only if the entry happened to sit inside the blind
first-3500-chars slice — otherwise the AI invented plausible but contradicting details.

**Change:** `npcAiInstruction` additionally feeds `keywordLoreForText(M.lorebook, userText,
{ capChars: 6000 })` as `LOREBOOK ENTRIES MATCHING THE REQUEST (canon — build this NPC
consistently with these facts)`. Each keyword-triggered entry's trigger words are matched
against the REQUEST text; hits are rendered whole regardless of book position. No hits (vague
request like "a shopkeeper") → the section is empty and the prompt is identical to before.

**Impact when bridge is off:** none for old behavior; matched entries add at most ~6 k chars
(~1.5 k tokens) — still well under the Perchance input cap.

**Revert:** remove the `matchedLore` lines and the import.

## [rpge-patch 009] Layered narrative history + importance-tagged memories (Summaryception-style)

**Files:** NEW `src/scripts/memory-history.js`; `src/scripts/memory-system.js`; `src/scripts/rp-engine.js`;
`src/scripts/main.js`; `src/styles.css`.

**Why (user pains + decisions 2026-11-18, handoff §8):** long games lost specifics — the GM re-introduced
met characters, forgot promises/deals, treated 50-turn-old actions as novel, and attributed facts to
nameless characters (later named). User approved: layered delta summaries ALWAYS fed + importance
1–3 (3 = verbatim) + attribution rules. Budget 10000 tokens, cadence every 5 turns from turn 10,
30 snippets/layer merging 3, backlog auto-offer, importance-3 pinned, DISTANT PAST digest retired
and migrated into the layers.

**Change:**
- NEW `memory-history.js`: layer stack in `state.memories.history` (`{layers: [[{text, from, to}]],
  summarizedUpTo}` — anchored player turns, same notion as the roll-up). `historyDue` (turn ≥ 10 &&
  ≥ 5 lagged unsummarized turns), `runHistorySnippet` (delta-summarizer call on route "memory" —
  the cheap role; prior context = every snippet trimmed to 12k chars; 40–90-word prose delta;
  nameless characters stay role-descriptions), promotion (layer ≥ 30 → first promotion into an
  EMPTY deeper layer copies the oldest snippet VERBATIM as the seed, no LLM call; later merges
  summarize 3 snippets against the destination layer; deepest layer self-merges),
  `renderHistory` (oldest→newest, budget = `rpge.memoryHistory.budgetTokens` default 10000,
  clamped ≤ bridgedInputCap − 2000; over budget trims the shallowest layer's oldest snippets —
  least coverage per token; the newest tail snippet never drops), `invalidateFromTurn` (rewinds),
  `migrateDigest` (legacy digest → deep-layer seed once), `backlogEligible`.
- `memory-system.js`: `messageTurns`/`renderRollUpLines`/`isNonStoryMessage`/`lagStartIndex`/`str`
  exported (reused); roll-up prompt: memories gain `importance` 1–3 (3 = verbatim commitment —
  the prompt demands near-verbatim wording for promises/deals/oaths; importance-3 entries are
  auto-PINNED so they survive rewinds); the digest input removed from the prompt (retired);
  `migrateMemoryEntry` normalizes `importance` (default 2).
- `rp-engine.js`: the DISTANT PAST digest block REPLACED by an always-fed `NARRATIVE HISTORY`
  block (ground-truth framing: never re-introduce a met character, never act like an old event
  didn't happen, never contradict); NEW `STANDING COMMITMENTS` block: importance-3 memories always
  fed (most recent 15, ~3000 chars), tagged VERBATIM COMMITMENT — binding until resolved. Both
  accounted automatically (context-budget reuses the real buildContext).
- `main.js`: history tick before each roll-up in `saveAndMaybeMemory`; all 7 rewind sites also
  call `invalidateFromTurn` (snippets covering the rewritten span drop; the tick re-covers);
  `normalize()` normalizes the stack + migrates the digest once; Memory panel gains a **History**
  tab (layer stats, preview of exactly what the GM receives, budget setting, snippet
  edit/delete, Build button — 10 snippets per click); `enterSession` offers a one-time backlog
  build for old sessions (per-session dismiss flag, 60-snippet cap per run).

**Impact when bridge is off:** the history still builds (Perchance route "memory" — small calls);
the render budget falls back to the configured 10000. Old sessions without history behave as
before (empty history block). The digest no longer feeds even for old saves (migrated instead).

**Revert:** delete memory-history.js + its imports/wiring; restore the digest block in rp-engine.js;
remove the importance lines in memory-system.js. (Large surface — easiest to keep.)

### [rpge-patch 009 hotfix `406145b`] `normalizeMemories` dropped `history` on every load
**Problem:** the layer stack vanished the SECOND time a session was opened — the digest-migration
had already blanked the digest, so the load path's `migrateDigest` couldn't rebuild it, and
`normalizeMemories` (which returns a fresh `{auto, manual, digest}` object) silently discarded the
stored history. **Fix:** `normalizeMemories` passes `history` through raw; the load path assigns
`d.memories.history = normalizeHistory(...)` (sanitize on load). Playwright-verified: a session
with a migrated seed + snippets keeps its full stack across repeated opens.

### [rpge-patch 010] Prose Rules Pack (feature A of the preset-port plan)
Distilled the anti-slop writing layer from four community presets (Freaky Frankenstein 5.4 "Ground
Prose Rules", Pura Director 16, Sola V4, Voyage) into a single ~560-token block (`prose-rules.js`):
direct statements over corrective negation (bad/good examples), show-don't-label emotion, every
spoken line is an action with nothing owed back (0% dialogue turns valid), anti-omniscient NPCs,
no plot armor, cliché ban-list, idiolect rhythm.
- New module `app/src/scripts/prose-rules.js` (`PROSE_RULES_TEXT`, `proseRulesOn`).
- World field `proseRules` (default ON; explicit false = off — old saves stay on).
- `rp-engine.js`: constructor param `proseRulesText`; `buildContext` feeds `WRITING RULES (prose
  pack — binding for every reply)` in the STABLE prefix cluster (after WORLD DESCRIPTION, before
  WORLD PREMISE) so the prefix cache keeps working.
- `main.js` + `context-budget.js` engine factories pass `proseRulesOn(world) ? PROSE_RULES_TEXT : ""`.
- `world-editor.js`: "prose rules" switch on the Story tab (both single- and multi-opening renderers).
Off = byte-identical to pre-patch prompts. Logic-tested (on/off/position/toggle), suites green.

### [rpge-patch 011] Dual-NPC simultaneous speech (side-by-side duet)
Feature from the dual-NPC idea backlog (user request 2026-11-20). Two named NPCs speaking in the
same beat render as ONE side-by-side block: circular portrait over each speaker's name and line.
- Prompt: `narrator-prompt.md` gains a SIMULTANEOUS SPEECH section — `[A & B] line A | line B`
  (halves split on ` | `); both saying the same words = one line with no ` | `.
- Parser (`rp-engine.js` parseGmOutput): `[A & B] ...` emits TWO adjacent npc messages flagged
  `duet` (first half carries `duetFull`, the original combined line). Zero downstream changes —
  speaker presence, trackers, NPC links and memory still see ordinary npc lines. Empty halves are
  dropped, so a streaming pair degrades to a normal bubble until the sibling arrives. `inner` and
  OOC names never become duets. fmt() re-feeds the pair as its original `[A & B]` line so the
  model keeps learning the format from its own past turns.
- Renderer (`main.js`): `appendPartsGrouped` (used by BOTH the final turn render and the live
  stream) pairs adjacent duet-flagged lines into `duetEl` — portraits/names/lines side by side,
  same avatar + name click targets (profile / link menu) as normal bubbles; identical texts
  collapse to one shared line under both portraits.
- `styles.css`: `.msg.duet` block styles; halves stack vertically under 640px.
Presentational only — no save-schema or state changes. Logic-tested (6 parser cases), suites green.

---

## [rpge-patch 012] NPC life tick: self-classified importance (2026-11-20, `d1c1631`)

**Problem.** Patch 009's importance system classifies memories the *roll-up* writes
(importance 3 = verbatim commitment, pinned, always fed). NPC-life events bypassed it:
the tick's reply had no importance field, so an off-screen promise/deal recorded by a
background tick entered the pool as an ordinary importance-2 note — recalled by trigger
match, first dropped under context pressure, losing the exact terms of the deal.

**Fix (`app/src/scripts/npc-life.js` only).**
- The tick's reply shape gains `"importance": <1|2|3>`, with a rules bullet mirroring the
  roll-up's wording (2 = normal event, default; 3 = commitment whose exact wording matters,
  recorded as close to VERBATIM as possible, RARE — only when terms were actually agreed;
  1 = minor color). The event-writing bullet adds: importance 3 must state the commitment's
  exact terms verbatim.
- The repair pass's reply shape gains the field too, and the merge preserves the original
  tick's importance when the repair supplies none.
- Push site: `importance` validated to 1–3 (default 2), `pinned: importance === 3`, and the
  rating stored on the memory — the same fields the roll-up writes, so the engine's feed
  (rp-engine.js always-3 tier: `pinned && importance === 3` → VERBATIM COMMITMENT, always
  fed), pruning and load normalizer treat tick memories identically with zero engine changes.

**Verification.** `node --check` clean; check-imports / check-bridge / check-storage green;
pushed `e7f5cb4..d1c1631` and pulled into the deployed AppData clone.

---

## [rpge-patch 013] Open threads get teeth — ages, OVERDUE, d20 resurfacing (2026-11-20, `d2c8ab2`+`c1c17b6`)

**Problem.** The roll-up's open-threads list (Memory panel → Threads) tracked narrative debt as
plain strings: no age, nothing forced a payoff, threads could rot forever, and the player had no
idea how long each had been dangling. Feature C from the preset-port plan (Chekhov's Gun),
rebuilt as an upgrade to the EXISTING list (no parallel system).

**Changes.**
- `memory-system.js` roll-up write: threads are now `{text, from, lastFired}`. `from` is the
  ENGINE-stamped planted turn (never read from the model): a thread already in the list keeps its
  original stamp (matched case-insensitively by text), a brand-new one is stamped with the current
  turn, a legacy string thread starts aging NOW. Kept threads preserve `lastFired` through
  refreshes (`c1c17b6`).
- `rp-engine.js` buildContext: the OPEN THREADS feed shows each age ("planted N turns ago"; ≥10 =
  OVERDUE: visible progress or resolution soon). A pending `state.threadDirective` whose
  targetTurn === current turn injects "DIRECTION — OPEN THREAD RESURFACES NOW: <thread>" —
  targetTurn-matched, so same-turn re-rolls re-inject and later turns never see it.
- `main.js`: `pickFireThread` (oldest thread past `from`, age ≥ 3, not fired within 4 turns);
  fire roll inside saveAndMaybeMemory's roll-up block (once per roll-up): d20 threshold scales
  with age (young 18+, ≥5 turns 14+, ≥10 10+, ≥16 8+); on a hit the thread gets `lastFired`, the
  player gets a 🎯 toast, and the NEXT turn's context carries the directive. Gated by
  `world.threadFires !== false` (default ON; OFF = no directives ever created, prompts otherwise
  unchanged). Stale directives cleared when their window passes.
- `main.js` normalize: threads → validated `{text, from, lastFired}` (legacy strings stamped with
  the session's current turn); `threadDirective` validated (text + numeric targetTurn) else null.
- Threads panel: age chips, a 🎯 "resurfaces next turn" badge on the scheduled thread, add-thread
  stamps the current turn, editing keeps the original stamp.
- `world.js` + `world-editor.js`: `threadFires` world field (default ON) + "Thread dice" switch
  in the World Editor Story tab (both renderers), beside the prose-rules switch.

**Verification.** 18/18 logic tests against the REAL modules (roll-up stamping incl. kept/new/
legacy threads; feed ages + OVERDUE + directive injection/target-turn scoping/re-roll; fire
picker age+cooldown+oldest-first; normalize compat). check-imports/bridge/storage green.
Playwright (kv-stub recipe): seeded 22-turn session — Threads panel shows "planted 18 turns
ago" / "planted 3 turns ago" / legacy stamped "planted 0 turns ago", and the seeded directive
shows the 🎯 badge (f060-threads.png). Test-infra note: session `turn` is message-derived
(seed enough action messages or the turn counter resets to the message count).

---

## [rpge-patch 014] Scene-direction dice — the co-director's d20 (2026-11-20, `5230b06`)

**Problem.** Feature E of the preset-port plan: the story could go arbitrarily long without the
scene ever being pushed off its smoothest path. User decisions (2026-11-20): keep it SEPARATE
from the open-thread dice (thread dice fire tracked debt; scene dice inject unscheduled
direction), automatic only, every **15 turns** ("the moment a scene can become stale").

**Changes.**
- New `app/src/scripts/scene-dice.js`: `SCENE_DICE_EVERY_TURNS = 15`; d20 → nudge table —
  1–2 Complication (a plan/errand/routine fails concretely), 3–4 Twist (reframing information
  arrives), 5–6 Arrival (a known face shows up unexpectedly), 7–8 Pressure (stakes/urgency rise),
  9–10 Quiet beat (a breather), 11–20 calm (null — the dice mostly don't interfere; ~50% hit per
  15-turn check ≈ one nudge per ~30 turns). Directives are about DIRECTION, never outcomes
  (skill checks own success/failure).
- `main.js`: fire block in saveAndMaybeMemory (independent of the roll-up cadence): every 15 turns
  roll d20; a hit sets `state.sceneDirective = {kind, text, targetTurn: turn+1}` + 🎲 toast; stale
  directives cleared when their window passes; gated by `world.sceneDice !== false` (default ON).
- `rp-engine.js` buildContext: injects `DIRECTION — SCENE DICE (<kind>): <text>. Weave it into this
  reply.` on its targetTurn only (same re-roll-safe contract as the patch-013 thread directive;
  both can fire the same turn).
- `world.js` (3 spots) + `world-editor.js` (both renderers): `sceneDice` world field + "Scene
  dice" switch in the World Editor Story tab beside prose rules and thread dice.
- Normalize: `sceneDirective` validated like the thread directive; `lastSceneDiceTurn` cursor
  sanitized.

**Verification.** 19/19 logic tests on the REAL modules (nudge table edges incl. calm range +
invalid rolls; thread + scene directives coexist and neither leaks past its target turn; scene
directive alone; re-roll re-injection; normalize). check-imports/bridge/storage green. Playwright
(kv-stub recipe, seed-reload workaround): World Editor → Story tab shows PROSE RULES / THREAD
DICE / SCENE DICE switches, all default ON; `#ceScene` toggles cleanly true→false→true
(f068-scenedice.png). Test-infra note: a world seeded with empty `meta.authorId` gets ADOPTED by
the local identity at boot (⋮ menu shows ✏️ Edit); the card's LAST button is ✖ Delete — don't
blind-click `.ld-wcard button:last-child`.

---

## Heavy-testing sweep (2026-11-20, fixes `5a916fa`–`0ba4cfd`)

Full frontend + backend sweep against the packaged Loreweaver server (real AI through the bridge
on the cheap DeepSeek flash profile; kv-stub Playwright harnesses in `tools/heavy-*.js` + shared
seeds in `tools/test-seeds.js`). Verified live: 32/32 kv-router edge cases (traversal, tombs,
bursts, unicode, 4 MB payloads); 8+ real GM turns end-to-end (streaming, NPC catalogue, tracker
bars, lorebook); scene dice ON cadence; npc-life ticks; memory roll-up (notes + threads + latest
situation); re-roll + version nav; message edit/delete; skill checks; idle turns; unicode input;
world editor save round-trip; imports (persona→hero, card→NPC, card→world with embedded-book
keywords); stop mid-generation; session shelf; OP free edit (stat 8→9 persisted); duet
side-by-side rendering in real play.

**Bugs found and fixed:**
- **[Loreweaver `src/sync/scan.js`] same-key concurrent kv writes could 500.** The temp filename
  was shared between same-millisecond writers (first rename moved it away; second rename ENOENT),
  and Windows rename-over-existing transiently EPERMs under concurrent writers. Fix: unique
  per-call temp suffix + in-process per-path write mutex + bounded EPERM/EBUSY/ENOENT retry.
  200-way concurrency now 0 failures; 130/130 sync tests pass.
- **`portraitHtml` rendered an EMPTY portrait as the raw placeholder path in 71px text** in the
  hero panel and every portrait box. Fix: empty portrait renders the stock placeholder as a real
  `<img>` (`5a916fa`).
- **[rpge-patch 014 fix] Scene dice rode the roll-up gate** (fired only on roll-up turns, so the
  "every 15 turns" cadence never ran — verified never-fired in a 19-turn real session). Fix: the
  fire block moved to the main save path next to the npc-life tick; cursor persists even on a
  calm roll (`741218b`). Verified: fired exactly at turn 15, nudge scheduled, consumed at 16.
- **Bridged calls gated on a page-stored API key** (`ai-provider.js`): with the bridge ON the
  server holds the key, but the engine refused NPC profiles / checks / staging / history /
  roll-up calls with "No API key saved for OpenAI" before fetch. Fix: when
  `window.LoreweaverBridge.isEnabled()`, the key gate is skipped (`ea55471`). (The GM narration
  path happened to pass because it used a different provider slot with a key present.)
- **Perchance-only landing widgets 404'd under Loreweaver serving** (last-edit / views /
  update-check fetched `/api/getGeneratorStats?name=undefined`). Fix: skip when
  `window.generatorName` is not set (`891f85f`).
- **Import page's world dropdown never refreshed after the saves shim's sync landed** — a fresh
  browser showed "No game worlds yet" until reload. Fix: the shim now dispatches
  `rpge-saves-synced` after boot reconcile; the page re-reads the dropdown then (`31e4c76`).
- **[rpge-patch 016] A failed GM turn died as a silent unhandled rejection** — the player's
  action sat unanswered with no feedback (the engine's own `lastError` toast covers the AI-call
  failure path; anything throwing outside it escaped silently). Fix: runGmTurn catches,
  toasts one human sentence ("⚠ The narrator didn't answer this turn … send an empty message to
  retry it"), and re-throws so recovery paths (empty-send retry, re-roll, edit, delete) are
  untouched (`0ba4cfd`). Verified live with a deliberately misconfigured bridge profile.

**User-config finding (reported, not code):** the "Cheaper" connection profile had the NanoGPT
secret bound (sk-nan…) instead of an OpenRouter key, so every call 400'd. Rebinding via the
settings API was reverted by the live UI's in-memory settings copy — the user should rebind it in
the Connection Manager UI.

**Harness notes:** Playwright `waitForFunction(fn, {timeout})` passes options as ARG — must be
`waitForFunction(fn, undefined, {timeout})` (silent 30 s default otherwise). Hover-revealed turn
controls need a hover or a synthetic JS click. Toast text lives in `#toastEl` (id, not class).
`normalizeWorld` silently drops a malformed `trackers: {defs:[]}` object (file form is a plain
array) with no warning — improvement candidate, not fixed.

---

## [rpge-patch 017] Loreweaver image bridge — server-side image provider (2026-11-21)

The engine's image jobs (NPC portraits auto-generating, scene illustrations, hero/world art) gain
a fourth provider in Settings → Image Gen: **"Loreweaver (server)"**. Like the text bridge, the
key stays on the server: calls ride the Loreweaver bridge shim (`LoreweaverBridge.api`) to the
server's own OpenRouter image endpoint (`/api/openrouter/image/generate`, the same endpoint the
chat-side Image Generation extension uses — see `docs/IMAGE-GENERATION.md` §4). Shape chosen as
"prompt + dimensions in, image out" so a future patch can point it at any other server-backed
backend (e.g. a local ComfyUI) without touching the engine again (option C).

- `image-provider.js`: new provider preset (`loreweaver`, default model `recraft/recraft-v4.1-flash-v2:free` (user choice — the OpenAI image mini tier gets expensive at NPC-portrait volume));
  `bridgeApi()` gate; `loreweaverGenImage` (aspect 1:1 / 2:3 / 3:2 mapped from the call's
  resolution opt; refs/tier opts ignored like on the Perchance path); `loreweaverImageModels()`
  fed by `/api/openrouter/models/image`; `testImageConnection` probes the models list for free;
  `activeImageProvider` + `imageCloseBlocker` treat "bridge connected" as the key requirement;
  routed dispatch in `routedGenImage`; per-route toggles work unchanged (off → Perchance
  fallback, which still errors under Loreweaver as before).
- **Out-of-the-box default**: with no stored `mno.imageProvider` AND the bridge connected, the
  provider defaults to Loreweaver (server) — portraits auto-generate for new NPCs from the first
  boot (user decision: portraits ON by default), scenes ride the 🎨 button as before.
- Settings UI: Base URL + API key rows hidden for the server provider (the server holds the
  key); Model field gets a datalist populated from the account's real image models; Test button
  verifies bridge + server key without spending a generation; the "No key saved yet" status and
  the keyless fallback warning are suppressed for it.

Server-key requirement found during live testing: `/api/openrouter/image/generate` reads the
STANDARD `api_key_openrouter` server secret (the user's keys were profile-bound custom secrets),
so the working OpenRouter key was registered into the standard slot via `/api/secrets/write` —
a one-time server-side setup, key never leaves the server.

`testImageConnection` probes `/api/openrouter/credits` (free, but REQUIRES the server key) so the
Test button really validates end to end; generation errors hint at the missing-key cause.

Verified by `tools/imgbridge-test.js` (13 live checks against the deployed module + REAL server:
config/active/close-blocker behavior, free test probe, 74 real image models listed, one REAL
generation on `recraft/recraft-v4.1-flash-v2:free` (user choice — the OpenAI image mini tier gets
expensive at NPC-portrait volume), route-off + bridge-down paths). Settings UI verified by
screenshot: server provider selected, Base URL/key rows hidden, model datalist populated,
Portraits/Scene/Other all ON.
