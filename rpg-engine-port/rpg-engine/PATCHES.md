## [rpge-patch 018] Loreweaver-native text AI + Import page in the landing nav

**Date:** 2026-11-21 — **user decision:** the "keep mnomno's code intact" rule is RETIRED from
this patch on. The engine fuses into Loreweaver step by step; Perchance AI and the BYOK
providers were removed for TEXT generation (Image Generation keeps its Perchance source — its
fusion is a later step).

**Files:** `src/scripts/ai-provider.js` (rewrite), `src/scripts/main.js`, `src/scripts/loreweaver-import.js`
(new, ported from the deleted `app/loreweaver-import.html`), `shims/loreweaver-bridge.js`
(settings-cache invalidator), `index.html`-level pages (`loreweaver-bridge.html`, `cheap-model.html`
deleted), Loreweaver wrapper `index.js`, inner wrapper `index.js`, `src/scripts/context-budget.js`
(one user-visible note), tools `check-bridge.js` / `check-imports.js` / `heavy-import.js` / `shot-imports.js`.

**What changed:**
- Text AI is Loreweaver-ONLY: every `genText` call posts to `<origin>/v1/chat/completions`, the
  bridge shim maps it to a Connection Manager profile (endpoint/model/key all server-side).
  Perchance AI + OpenAI/DeepSeek/OpenRouter/Ollama, their key forms, model/baseUrl fields,
  sampling sliders, thinking toggles and the route-off→Perchance fallback are GONE. A route
  switched off now means THE JOB DOES NOT RUN (no silent fallback); route defaults are all-ON.
  `mno.aiProvider` collapses to loreweaver; the shared key map (`mno.aiProviderKey`) stays for
  the IMAGE providers.
- Settings → AI Model section rebuilt as the bridge page's true home: MAIN PROFILE dropdown
  (fed from `/api/settings/get`, ↻ refresh; first run auto-picks Loreweaver's SELECTED profile),
  per-job profiles (10 roles incl. cheap), profile-preset sampling checkbox, context budget,
  Test call (must fail on the server's 200-wrapped upstream errors — no false positives).
  The AI Model close-gate is removed (nothing to revert to).
- First-run default written at module load: `rpge.loreweaverBridge` = `{enabled:true, usePreset:true,
  contextTokens:16384}` — the shim resolves an empty profileId to Loreweaver's selected profile,
  so a fresh browser generates with zero setup.
- Import page: the floating `loreweaver-import.html` overlay is now the landing page
  "Import from Loreweaver" (nav item right under Adventures, `#imports` hash). Logic ported
  verbatim; the `rpge-worlds-changed` listener no longer remounts the landing while this page is
  mounted (the old full remount tore the page down mid-import once it shared the app's frame).
- Deep links: `window.rpgEngine.open(target)` postMessages `{rpgeOpen:true, target}`; the app
  re-enters the landing from a chat (session kept) and mounts `imports` / opens Settings on
  `settings/aimodel`. `#settings/<section>` hashes work directly too. The Loreweaver extension's
  Bridge → AI Model settings, Imports → Import page; the two floating overlay pages are removed.
- `cheap-model.html` deleted (its cheap slot is a per-job profile). `perchance-limits.js` kept
  ONLY as dead constants for fit-measure fallback paths (isPerchanceAIFor is always false).
- Consequence: standalone serving (python http.server) shows the game but cannot generate.

**Verified:** `tools/check-bridge.js` (mock Loreweaver server: profile dropdown, selected-profile
default, test call parameterized by profile, role matrix, preset sampling, key never leaves the
server), `tools/check-imports.js` (full import pipeline INSIDE the app frame: personas, card→NPC,
card→world, book→lorebook, re-import field preservation), `tools/check-overlay.js`, and LIVE
against the real server: first-run bridge auto-on, real profile list, Test call ✓/✖ by profile,
one REAL streamed generation through the OpenRouter profile, image bridge still 13/13 (one real
Recraft generation). Screenshots `rpge-heavy/f081-imports-live.png`, `f082/f083-aimodel-*.png`.

## [rpge-patch 018] followups (2026-11-21)

**1. Test call false positive** (`ai-provider.js`): the server wraps upstream failures in an
HTTP 200 with an `{error:{message}}` payload in non-stream mode — the Test button now treats
that as a failure instead of green-lighting a broken profile.

**2. Import page tab strip** (`loreweaver-import.js`, harness `check-imports.js`): the three
import flows are now internal tabs — "👤 Personas → Heroes" / "🎭 Cards → NPCs" / "📖 World
Info → Lore" — styled after the Worlds header action strip (`.hm-act`): boxed, letterspaced
uppercase, accent border + tint on the active tab. The target-world selector is shared by the
cards and books tabs (hidden on the personas tab); the last tab is remembered
(`rpge.importTab`). Logic unchanged — everything renders regardless of the active tab.

**3. Fresh-browser worlds dropdown stayed empty** (`loreweaver-import.js`): the storage
shim's one-shot `rpge-saves-synced` event can fire BEFORE the page mounts its listener. The
page now polls up to 6× (6 s apart, only while the world select is still empty).

**4. CRITICAL: fresh browsers were zeroing the server's worlds index** (`loreweaver-storage.js`):
the write-through mirror pushed the app's BOOT-time writes (e.g. the worlds/index normalization
pass on an empty fresh browser) BEFORE the first reconcile had pulled anything — every fresh
boot overwrote the server's worlds index with an empty list, and real devices kept
conflict-copying against it (the live index ping-ponged to empty; 22 conflict copies piled up).
Fix: until the first reconcile completes, pushes/deletes/wipes are only allowed for keys the
server does NOT have; keys the server has are left alone and merged by the reconcile (local
boot writes land as conflict copies, server wins into the browser — lossless in both
directions). The server's live index was restored from the newest conflict copy
(conflict-1795124459634, 5 entries). Verified: a fresh boot against the real server no longer
touches the server index and fills the dropdown (world `w-2158c5195cf6` selected).

**5. Wrapper syntax error** (Loreweaver-side `index.js`): a stray unclosed
`function onButtonClick() {` left by the 018 edit broke the whole extension parse — the
drawer panel AND the wand entry both vanished silently. Rule: `node --check` every wrapper
edit before deploy (an extension that fails to parse disappears without any UI error).

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

### [rpge-patch 018] followups #3 (2026-11-21) — console triage + hero tab fix
- **postHostHash leftover** (`8abb7b4`): the hash-echo repair postMessage targeted the hardcoded
  `https://perchance.org` origin (pre-Loreweaver leftover) — under Loreweaver the browser refused
  delivery ("Failed to execute postMessage … does not match the recipient window's origin").
  Now derives the target from `location.ancestorOrigins` (nearest last) with `document.referrer`
  fallback; skips silently when the host origin is unknown. Nobody consumes `changeUrl` under
  Loreweaver (Perchance host-bar vestige) — kept for standalone-serving parity.
- **Hero panel tab switch was dead** (`73bd71b`): `.hero-tab-body { display: flex }` (author rule)
  beat the UA `[hidden] { display: none }`, so BOTH Stats and Profile panes rendered at once and
  the tab buttons looked like no-ops (user-reported with video). Fix: explicit
  `.hero-tab-body[hidden] { display: none }`. New `tools/check-hero-tabs.js` (seeded kv stub, no
  real-server writes) verifies initial/profile/stats states via DOM probe + clipped screenshots;
  NPC popup unaffected (it swaps content per tab, no hidden attribute).
- **Phantom system extension documented, not fixable in place**: packaged builds discover the dev
  clone (`public/scripts/extensions/rpg-engine`) as a SYSTEM extension alongside the real
  third-party one; its wrapper's `../../../` imports resolve to `/extensions.js` (404) at system
  depth → "Extension 'RPG Engine' failed to load: [object Event]" toast. Real extension loads
  fine right after. Loreweaver FAQ entry added; only real fix is moving the dev clone out of the
  public tree (future reorg; renaming manifest.json would break the third-party deployment).

### [rpge-patch 019] Actions & abilities (2026-11-21)
The hero's capabilities become DECLARED DATA instead of tracked text — a Pokémon/FF-style
ability list with real stat math, while keeping the inviolable rule: the AI never writes stats.

**Data shape** (`app/src/scripts/actions.js`, new module):
`{ id, name, icon, kind: "passive"|"active", deltas: {statKey: ±N}, effect, active, source: "hero"|"story" }`.
Passive cards apply their deltas constantly; active cards only while toggled on. Deltas STACK.

**Buff math (code, never AI)**: `effectiveStats(character, statDefs)` = base + passive deltas +
active deltas (while on). Buffs deliberately EXCEED the world stat max (creation budget, not a
cap — being buffed is the point); only the LOW side clamps to the stat min (curses can't go <1).
Applied at: `resolveCheck` (dice), the referee call (determineCheck sees effective values), the
hero sheet (row shows `base → eff` + net badge, tooltip lists each contributing action), and the
GM context (an EFFECTIVE STATS block appears while any buff differs from base, so narration
agrees with the dice). Tracker cap formulas still read BASE stats (deliberate: a strength buff
shouldn't silently inflate an exp cap).

**GM context**: `characterSheet` gains an ACTIONS & ABILITIES block; a world with stats always
carries the ACTION_GAIN_RULE inviting the GM to award new abilities when the story genuinely
grants one.

**GM strip (machine-readable, extracted pre-render like [TRACKERS])**:
`[ACTION: Name | passive|active | str +3, agi -1 | One-sentence effect.]` (optional `icon: X`
segment). `parseActionStrips` pulls them out of the reply; gains ride on the turn's last message
(`m.actionGains`) and render as an inline ACCEPT card in the chat — accepting normalizes the
card (unknown stat keys dropped), stores it (`source: "story"`), and marks the message
(`actionGainsAccepted`) so re-renders/rewinds stay consistent. The strip itself never renders.

**UI**: hero panel gets an **Actions** tab (Stats | Actions | Profile); card list with kind tags,
delta lines, effect text, story badge; inline editor (name, icon, kind seg-buttons, per-stat
delta inputs, effect textarea) for authored actions; ⏹/▶ toggle for active ones; ✕ delete with
confirm. Composer gets an **⚡** button that opens the hero panel straight onto Actions.
`wireActionsTab` re-renders the PANEL ROOT (a tab-body re-render would nest the panel inside
itself — caught by the harness, fixed).

**Verified**: Node unit checks (strip parse, normalize, effective math, context text) +
`tools/check-actions.js` e2e on the seeded kv stub — offer renders/accepts/persists, tab
switches, buff badge `8 → 39 +31` (stacking, max-breaking), active toggle `9 → 11`, editor add,
⚡ button. check-storage.js + check-imports.js still OK. Screenshots a01–a04.

**Not covered (future)**: action costs/cooldowns, NPC actions, auto-expiry timers.

### [rpge-patch 020] GFX panels + inline images in message text (2026-11-21)
The first of the preset-intake series (see `PRESET-PLAN.md`, design rationale in
`docs/PRESETS.md` on the Loreweaver side). Two new markup forms recognized by the shared
message-text renderer `app/src/scripts/rich-text.js` (`core()` is the single choke point for
`inlineMd`/`richText`/`richTextWithMentions`, so this lights up the transcript, world
descriptions and changelog at once):

**GFX panels** — `<!-- GFX_START -->…<!-- GFX_END -->` wraps a real HTML fragment (FF 5.4's
`<gfx_protocol>` Pop-in Graphics: terminals, signs, maps, phones rendered live in chat). Because
the body is intentionally live HTML, it's lifted out of the raw source BEFORE `esc()` runs (a
NUL-ish `GFX_MARK` placeholder rides the escape/markdown pipeline untouched, same trick as code
spans) and only spliced back at the very end of `core()` — so no mark-up pass (mentions, quotes,
bold, italic, the blanket `\n→<br>` in `richText`) can ever reach into it. Body is
whitelist-sanitized via `DOMParser` (`sanitizeGfxHtml`): allowed tags are a fixed set (div/span/
p/br/b/i/pre/code/headings/tables/lists/button/img/…); every attribute except `class`/`title`/
`style`/`src`/`alt`/`width`/`height` is stripped (notably `id=` — collides with app
`querySelector` lookups — and all `on*` handlers); `style` values are filtered to a
CSS-property allowlist AND checked against a function/keyword blacklist (`url()`/`expression()`/
`javascript:`/`@import`/`behavior:`); `src` on images goes through the same
`isSafeImgSrc` whitelist as inline images. Newlines in text nodes become `<br>` at the source
(the outer `richText` pass would otherwise double-process them into stray breaks inside the
panel). Body is trimmed before sanitizing (authoring whitespace around the comment markers would
otherwise show up as stray `<br>` siblings). Default theme CSS for `.gfx-wrap` +
`.gfx-terminal`/`.gfx-map`/`.gfx-letter`/`.gfx-phone` (purely cosmetic — an AI can override
inline via `style="…"`, which gets filtered too).

**Inline images** — `![alt](src)` renders `<img class="msg-img">`. Both URL forms work (verified
end-to-end on the real server): external `https://…` URLs (helmet CSP is off in
`src/server-main.js` — `contentSecurityPolicy: false`) and Loreweaver-served `/user/images/…`
paths (real route in `src/users.js`: `router.use('/user/images/*', …)` serving
`req.user.directories.userImages` — same-origin, no CORS issue). `src` runs through
`isSafeImgSrc` (rejects `javascript:`/`vbscript:`/non-image `data:`); rejected URLs degrade to a
visible literal-text fallback (`.msg-img-bad`) instead of a broken tag. Alt + src are captured
post-`esc()` (brackets/parens survive `esc()`, which only touches `&<>"'`) so they're already
entity-safe for attribute use — no attribute-injection vector.

**Verified**: `tools/check-gfx-images.js` (seeded kv stub, boot→re-seed→reload pattern like
`heavy-session.js`) — 12/12 checks green: GFX panel renders as real DOM (not escaped text), both
image URL forms render with correct `src`/`alt`, and a hostile fixture (GFX block containing
`<img onerror=…>` + `<script>`, plus a `![](javascript:…)` image) leaks zero executable payload:
no `window.__pwned*` flags set, no `img[onerror]`/`<script>` survived the sanitizer, no
`javascript:` src on any rendered image, rejected URL visibly degraded to literal text. Screenshots
`gz01-gfx-images-1500.png` / `gz02-gfx-images-1000.png` in `C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/`.

**Not covered (future)**: `chatMd` (Discussion page) stays plain-markdown-only — out of scope
unless requested. Preset system / macro expansion / regex engine are separate patches (021/022/023).

### [rpge-patch 021] Regex engine port (2026-11-21)
Second patch in the preset-intake series (see `PRESET-PLAN.md`). New module
`app/src/scripts/regex.js` — a self-contained port of Loreweaver's
`public/scripts/extensions/regex/engine.js`. That file reaches into ST globals the engine
doesn't have (`script.js` `substituteParams`, `extensions.js` `extension_settings`,
`preset-manager.js`, `lodash`), so this keeps the *behavior* faithful and swaps the surroundings:

- **Ported faithfully**: `RegexProvider` (LRU compiled-`RegExp` cache, size 1000, `lastIndex`
  reset on global/sticky so cache reuse can't skip matches), `regexFromString` (`/pattern/flags`
  parsing with the same invalid-flag fallback as `public/scripts/utils.js`),
  `sanitizeRegexMacro` (regex-escape set for the ESCAPED substitute mode),
  `substitute_find_regex` enum (NONE/RAW/ESCAPED), `regex_placement` enum (MD_DISPLAY,
  USER_INPUT, AI_OUTPUT, SLASH_COMMAND, WORLD_INFO, REASONING — same numeric values as ST),
  `runRegexScript` (`{{match}}`→`$0`, `$1`/`$<name>` capture-group refs, `trimStrings`
  post-match filtering, final macro expansion), `filterString`, and `getRegexedString`'s gate
  (placement match, markdownOnly/promptOnly mutual-exclusion — including the "neither flag runs
  only when input is neither markdown nor prompt" rule — `runOnEdit` gate, `minDepth`/`maxDepth`
  window).
- **Swapped for engine-native**: scripts come in as a plain `scripts[]` argument instead of ST's
  `extension_settings.regex`/character-scoped/preset-scoped storage lookups (that storage layer is
  deliberately NOT ported — the engine manages its own script storage in a later patch, so this
  module stays pure JS, no DOM, unit-testable in plain Node); macro expansion uses the engine's
  own `{{user}}` convention (`subUser` from `text-utils.js`, resolving the hero's name) via a
  small `expandMacros` helper, instead of ST's full `substituteParams` universe. A caller can
  extend macros via `params.macros` (e.g. inject `{{char}}` for a specific NPC at a call site
  that knows one). Unknown `{{…}}` macros are left as literal text, not silently dropped.

**Verified**: `tools/check-regex.js` — 40/40 checks green as plain Node unit tests (no browser
needed, unlike `rich-text.js`): `/pattern/flags` parsing + invalid-flag fallback,
`sanitizeRegexMacro` escaping, numbered + named capture groups, `{{match}}` shorthand,
`trimStrings`, `{{user}}` expansion (with and without a `macros` override), all three
`substituteRegex` modes (incl. proving ESCAPED is real escaping, not just RAW — `a.b` matches
literally, not `axb`), disabled/invalid-script graceful degradation, `regex_placement` gating,
markdownOnly/promptOnly mutual exclusion (all 6 permutations), `runOnEdit` gating,
`minDepth`/`maxDepth` window, `RegexProvider` LRU cache reuse + `lastIndex` reset, and
ordered multi-script chaining.

**Not covered (future)**: script storage/UI (likely world-level regex rules, a later patch).
Preset system + macro universe + FF 5.4 Engine Edition preset data remain patches 022/023.

### [rpge-patch 022] Prompt-stack preset model + editor (2026-11-22)
Third patch in the preset-intake series (see `PRESET-PLAN.md` §022). The engine can now load a
SillyTavern chat-completion preset (the `prompts` + `prompt_order` JSON) and feed its enabled
blocks into every GM turn. Data reuse, not UI copy — the schema and macro grammar speak ST's
exact format, the editor is the engine's own lean panel.

**New module `app/src/scripts/presets.js`** (pure data + text, no DOM — plain-Node testable):
- `parsePresetJson(raw)` — validates an ST preset JSON and keeps the parsed object verbatim
  (Export round-trips byte-identically; extra keys untouched). Builds the play order from
  `prompt_order`'s global group (`character_id: 100001`, else the first group); entries are
  `{ identifier, enabled }` exactly like ST's.
- `expandMacros(text, ctx)` — the ST macro grammar, engine-local, ST pass order
  (comments → rolls → variable setters → getters → whitespace/legacy → env → choice):
  `{{// comment}}`, `{{trim}}` (ST's newline-eating regex), `{{noop}}`, `{{newline}}`,
  `{{user}}`/`{{char}}` + `<USER>`/`<BOT>`/`<CHAR>`, `{{setvar}}`/`{{addvar}}`/`{{incvar}}`/
  `{{decvar}}`/`{{getvar}}` (values stored raw; nested `{{getvar}}`s inside templates resolve
  on later passes — the same fixpoint ST's newer macro engine reaches), `{{roll:FORMULA}}`
  (tiny NdM parser, digits-only = 1dN; `{{roll::1d20}}` double-colon tolerated — ST's old regex
  engine renders that form EMPTY, here the intended dice actually roll), `{{random:…}}` (fresh
  per call) and `{{pick:…}}` (stable within one expansion), `{{isotime FMT}}`/`{{isodate FMT}}`
  (moment-token subset: yyyy/yy/MMMM/MMM/MM/dd/DD/dddd/ddd/HH/hh/h/mm/ss/A/a — token order
  proven safe against month/day names eating each other), `{{date}}`/`{{time}}`/`{{weekday}}`.
  Unknown macros stay LITERAL (no silent loss). Variable scope = one assembly call = one turn
  (matches ST's per-chat chat_metadata being reset by the preset's own blanking setvars).
- `assemblePresetPrompt(preset, ctx)` — walks the play order: disabled skipped, `marker: true`
  skipped (their slots are ENGINE-NATIVE: charDescription→character sheet, chatHistory→
  transcript, scenario→premise, worldInfo*→lorebook), unreferenced prompts ignored (ST never
  plays out-of-order clones), empty content dropped. In-flow blocks macro-expand and join with
  `\n\n`; `injection_position: 1` blocks split out as injections sorted by depth →
  injection_order → play order.

**Engine seam (`rp-engine.js`)**: `RPEngine` now takes `preset` (the parsed preset, or null for
byte-identical pre-022 prompting) and `buildContext` has two insertions:
1. `PRESET DIRECTIVES (…)` cluster rides the STABLE prefix right after the prose pack and before
   the premise (a preset's blocks are static per preset, so the prefix cache stays banked).
2. ABSOLUTE injections ride immediately before the final `Now write your reply:` directive
   (the end-of-conversation position, i.e. depth 0 — ST splices them into the message list at
   `injection_depth`; the engine sends ONE assembled text, so depth is a sort key only. The
   target preset uses depth 0 exclusively).
`presetAssemble(hero)` expands fresh per turn ({{time}}, {{roll}}, setvar/getvar chains are
per-turn state) and degrades gracefully: a broken preset plays the turn WITHOUT the stack, never
takes down the session. {{user}} inside preset blocks resolves to the hero via the same
substitution as every other section.

**Editor (Settings → Prompt Preset, `main.js presetSection()`)**: lean ST Prompt Manager —
Import (`⬆`, speaks ST's `.json`, errors toast, never partial), Export (`⬇`, round-trip),
On/Off switch (live: flips `engine.preset` on the running engine, next turn picks it up),
play-order list with per-block enable checkbox, role/in-chat badges, ▲▼ reorder, delete
(confirm popup), ＋ New block, and a click-to-expand content editor (name, role
system/user/assistant, full text with macros — same grammar the assembler runs). Engine-native
marker slots render as dimmed rows ("engine slot") so the stack reads exactly like ST's manager
without pretending the engine fills them from ST data.

**Storage**: `localStorage["rpge.promptPreset"]` = `{ raw, name, on }` — machine-local, same tier
as the AI provider prefs (an authoring choice, not story data; stays out of session saves and
out of the hub sync's `data/` scope). `raw` is re-serialized after every edit, so the stored blob
is always the truth Export speaks.

**Verified**: `tools/check-presets.js` — 80/80 checks green as plain Node (no browser):
macro grammar (incl. blank-then-fill template resolution across passes, `{{trim}}`'s exact
newline eating, invalid-roll→empty), parse validation, play-order assembly (disable/marker/
orphan/whitespace rules), injection splitting + sorting, vars shared across blocks, and the
REAL FF 5.4 file: 68 prompts / 61 order entries parsed error-free, Export round-trips
byte-identically, no raw `{{user}}`/`{{getvar}}`/`{{setvar}}` survives expansion, and the real
`RPEngine.buildContext` seam (no-preset baseline, cluster placement between prose rules and the
premise, injections before the reply directive, garbage-preset degradation).
`check-regex.js` stays green (40/40); `main.js`/`presets.js`/`rp-engine.js` pass `node --check`.

**Not covered (future)**: per-turn sampler mapping (temperature etc. — the bridge's connection
profiles already own that job), `injection_depth` positional slicing inside the transcript
(only relevant if a preset ships non-zero depths; the target preset doesn't), and the FF 5.4
"Engine Edition" preset DATA itself — that's patch 023.

### [rpge-patch 022] followup — syncable preset library + AI Model response tuning (2026-11-22)
User decisions (2026-11-22): the preset applies to GM narration only (confirmed correct — tracker
extraction stays deliberately narrow); close the orphan-visibility gap; add preset delete +
switching; samplers are NOT imported from preset files but become explicit settings in AI Model.

**Syncable preset library**: storage moved from a device-local localStorage blob to the kv
session folder — `kv.rpg["promptPresets"]` = `{ presets: [{ name, raw }], active, on }`. The
`rpg` folder is in the server-save mirror's `MIRROR_FOLDERS`, so the library rides the same
offline-capable server sync as sessions/worlds (IndexedDB locally, reconciled to
`data/<user>/rpg-engine/kv/rpg/promptPresets.json` — the hub sync carries it between devices).
The editor gains a library row (preset select + On/Off gate), 🗑 Delete preset (confirm; clears
back to engine-native), and switching = pick another entry (live flip on a running engine).
One-time migration from the pre-library localStorage blob. Missing kv shim (bare standalone)
falls back to localStorage.

**Orphan visibility**: blocks present in the file but outside the play order (ST's "out of
order" clones) now render in a collapsed **"Not in play order (N)"** group with ＋ add-to-order
(edit/delete like any other block; markers stay engine slots — nothing to add).

**AI Model → Response tuning (optional foldbox)**: Temperature, Top P, Top K, Frequency penalty,
Presence penalty (blank = the connection profile or its preset sampling decides — exactly
today's behavior; a number always wins because the bridge shim only fills fields the payload
leaves unset), **Max reply tokens** (GM narration call ONLY — bookkeeping calls keep their
engine caps so machine-output shapes stay intact), **Streaming** on/off (off sends
`stream:false`; the reply parser already handles both content types). Persisted in the engine
config (`mno.aiProvider`), carried through `readStore`/`setResponseTuning`.

**Bug found & fixed by verification** (`app/shims/tweaks.js`): the cosmetic shim's
default-section redirect clicked the "AI Model" nav button ~70 ms after ANY Settings open —
stealing the requested section (Prompt Preset opened, then flipped to AI Model). Now it only
redirects when NO section was requested (the default landing on the hidden Identity), by
checking the already-active `.pf-md-btn.on`. Pre-existing bug — everyone who opened a specific
section via deep links was affected; nobody noticed because manual clicks came after.

**Verified**: `tools/check-preset-ui.js` — full UI harness green (kv-stubbed, isolated context,
zero real-server writes): section opens, import→library blob {presets, active, on}, play-order
rows, orphan foldout + add-to-order (blob order updated), block edit persisted, Off switch
persisted, delete clears to engine-native, and the Response-tuning foldbox (5 sampler inputs +
max-reply + streaming; temperature 0.7 persisted, blanks stay blank). Screenshots ps01–ps03 in
Temp/rpge-heavy/. `check-presets.js` 80/80 and `check-regex.js` 40/40 stay green.

---

## [rpge-patch 023] — FF 5.4 — Engine Edition (bundled preset + dialogue colors + CoT leak guard)

**Goal**: the "Freaky Frankenstein 5.4" preset — the user's signature SillyTavern stack —
running inside the engine with its internal-state dashboards replaced by engine-native panels.
Built from the user's own **Prose-Only** curation (their scrubbed derivative of the FULL
preset), verbatim, with engine-specific adjustments.

**Bundled preset** (`app/src/game/presets/ff54-engine-edition.json`, 59 prompts / 52 in play
order / ~10.5k-token ON stack) + a **⭐ FF 5.4 Engine Edition** button in Settings → Prompt
Preset (same import pipeline, fixed library name, same-name re-import replaces → it installs
AND updates). Presets sync across devices with the library (kv `rpg` mirror, patch 022).

Recipe vs Prose-Only: the 9 Internal-States dashboards + Twitter X Feed dropped entirely (each
has a superior engine-native counterpart); MAX/Micro CoT kept OFF, BOLT CoT kept ON; "Character
Cells" (the user's discontinued extension) renamed + rewritten as "🧩 Scene State — injected by
the app" describing the engine's native scene-state feed; both Colored Dialogue blocks became
comment-only no-ops (coloring is app-side); Auto Image Gen SDXL became an app-side no-op (the
Image Bridge replaces it); **Pop in Graphics flipped ON** (the engine renders GFX natively).

**Engine addition 1 — `stripThinkBlocks()`** (`rp-engine.js`, wired into the GM-reply and
death-scene parse paths before the tracker-echo strippers): closed
think/thinking/thought/reasoning pairs are cut with their blank lines; an unclosed opener (a
truncated stream that ended mid-reasoning) cuts everything from the last opener to the end.
Reasoning can flash briefly in the live stream (the accumulator is raw) but never lands in the
transcript, history, or memory.

**Engine addition 2 — per-NPC dialogue colors** (replaces ST's Colored Dialogue tags): the
model writes plain quoted dialogue; the engine colors each character. `npc.color` on the
session roster entry (inherited from an authored world-cast color when set), a **Dialogue
color** ColorPicker in the NPC profile popup (debounced save + chat re-render), and a stable
auto hue — hash of the canonical name into a curated 12-color palette — when unset. Rendered as
the speaker's name label + a 2px portrait ring on npc/thought/duet bubbles via `--npc-col`
(unset bubbles keep the default accent). Full-sentence color was rejected: name + ring reads
clean and never hurts legibility.

**Verified**: `tools/check-presets.js` **106/106** — new sections: the bundled file (parse
clean, dropped blocks absent, Scene State renamed, MAX/Micro present + OFF, BOLT ON, Pop-in ON,
Light Novel ON, both Colored Dialogue blocks expand to nothing, expanded stack free of
`<internal_dndsim>` dashboards / color tags / raw macros) and `stripThinkBlocks` unit tests
(closed pair, thinking variant, unclosed tail cut, reasoning-only, echo-content preserved).
`check-regex.js` 40/40, `check-preset-ui.js` green, `node --check` clean on all touched files.

---

## [rpge-patch 024] SD-follow — the engine follows Loreweaver's Image Generation settings (wave 1: ComfyUI)

**Goal** (user contract): "whatever endpoint I configure in Loreweaver's Image Generation
extension — if it works in chat, it works in the RPG engine." One set of image settings for
chat and game, on every device.

**Design**: instead of mirroring the chat extension's ~25 per-source payload builders into the
engine (upstream code, drifts on every pull), the mirror lives SERVER-side, next to the settings
it mirrors:

- NEW src/endpoints/sd-follow.js (Loreweaver-owned, mounted at /api/sd-follow):
  - /generate — reads the user's saved extension_settings.sd from settings.json, requires
    source = ComfyUI (wave 1; other sources get a clear "not mirrored yet" message), reads the
    workflow file from comfyWorkflows/, performs the chat extension's exact placeholder
    substitution (prompt / negative_prompt / seed / denoise / clip_skip / model / vae /
    sampler / scheduler / steps / scale / width / height + custom comfy_placeholders, all
    quote-wrapped so the workflow stays valid JSON), then runs the upstream comfy
    enqueue-poll-fetch port (incl. the client-close /interrupt).
  - /status — free probe for the Test button: what the mirror sees + ComfyUI reachability.
- Aspect to dims: base comes from the extension's own width/height; the engine's aspect only
  re-orients them (portrait = short side across) so the user keeps pixel control.
- user_avatar / char_avatar placeholders fall back to the 1x1 pixel, same as the extension's
  error path (no chat-character context in the engine; hero-portrait pass-through is wave 2).

**Engine side**: Settings > Image Gen > Loreweaver (server) gains a **Follow Image Gen** toggle
(persisted in mno.imageProvider.follow). On: generation calls POST /api/sd-follow/generate
{prompt, negative_prompt, aspect} — prompt in, image out; the Model row hides with a hint.
Off: the previous fixed /api/openrouter/image/generate path (unchanged). Test button switches
to the /status probe with three outcomes: following+reachable, wrong-source warning,
unreachable-with-listen hint. The bridge shim now passes the server's error TEXT through
(all endpoints benefit).

**Pre-existing bug found by the harness** (image-provider.js paint()): main.js spreads the
builder box's children into the section after mount, so the closure's `box` is an empty shell —
every post-mount paint() scoped to `box` was a silent no-op (row state could only ever be set at
build time). paint() now scopes its row queries to `remoteBox`, a direct element reference that
survives the move.

**Verified**: tests/sd-follow.test.js 13/13 (aspect mapping, substitution fidelity incl.
quote-wrapping and custom placeholders, mock-ComfyUI enqueue-poll-fetch, unreachable hint);
tools/check-sdfollow.js **16/16** live harness (mocked endpoints, zero spend): follow routing +
body shapes + aspect mapping, plain path when off, UI toggle/rows/persistence, all three Test
outcomes. **Live end-to-end**: one real render through the user's local ComfyUI (75 s, PNG)
matching the prompt exactly. Screenshots sdf01/sdf02 + sdf03-live-follow-render.png.

### [rpge-patch 024] wave 2 — every source mirrored
`buildSourceRequest` now ports the extension client's payload builder for ALL sources (extras,
horde, auto/vlad, drawthings, sdcpp, novel incl. the Anlas guard, openai incl. dalle-3/gpt-image
size rules, aimlapi, comfyrunpod, togetherai, pollinations, stability, huggingface, chutes,
electronhub incl. the /sizes probe, nanogpt, bfl, falai, xai, google incl. vertexai fields from
oai_settings, zai incl. the per-model size multiples, openrouter, workersai) and dispatches them
internally through the SAME upstream server routers the extension uses (minimal req/res shim,
real `request.user` for secrets). Response mappers are the extension client's exact mappings.
Video-capable models (sora-2, veo-*, CogVideoX, Vidu) are refused with a clear message — the
engine renders images only. Engine Test button now shows "Following — source: X" for cloud
sources (no free reachability probe exists for them). Server tests 41/41 (per-source builders,
response-mapper parity, internal dispatch, video guards, NovelAI guard, closestAspectRatio/
closestSize); check-sdfollow 16/16. Live re-check after deploy: endpoint correctly reports the
unreachable state + --listen hint when ComfyUI is not running (user had closed it).

---

## [rpge-patch 025] — Generatable actions + auto-invoke

**Goal**: close out the Actions feature (019) with the two missing halves — abilities you can
*generate* rather than hand-write (in the hero-forging wizard AND during play), and active
abilities that switch themselves on when you say you use them.

**Entry point A — Forge Your Hero gets an Actions step** (between Stats and Trackers; present
whether or not the world has multi-start openings or number trackers). The step renders the SAME
shared component as the in-game hero panel Actions tab — `actionsTabHtml` + `wireActionsTab`,
now parameterized: `wireActionsTab(body, c, rerender, saveFn, ctxFn)` (the hero panel keeps its
defaults; the wizard passes its own re-render + `store.save(s)` + a wizard-context builder).
Cards, the inline editor, active ⏹/▶ toggles and deletion all work identically; edits persist to
the session immediately and ride the wizard draft (`ccActions` in the draft blob, re-normalized
on restore). The Review step lists the accepted actions.

**Entry point B — ✨ Generate in the in-game Actions tab** — same button, same machinery.

**Generation** (one shared path, `generateActionOffers`): a content-rich instruction — world canon
(vibe/scenario/worldDescription/lorebook via `actionCtxFromWorld`) + hero text (wizard: the
bio-as-written + Powers; in-game: persona/powers + the last 8 messages as RECENT STORY) + the
world's stat keys with starts/maxes + existing action names (no repeats) + the player's optional
direction — then `actionGenRule` demands a strict JSON ARRAY of 2–4 offers (delta cap: 3 at
forging, 5 in play, 10 under free-build). Replies parse through `parseAiJson`, validate through
the new `normalizeActionOffer` (unknown stat keys dropped, |delta| clamped, zeros dropped, name
required, icon ≤ 2 code points), dedupe against existing actions, and soft-cap actives at one
(extras demote to passive, visible on the card). Offers render as Add/Skip cards; **Add**
normalizes through the exact same `normalizeAction` path as every other action card with
`source:"hero"` — the AI never writes stats, it only lists cards. Route: `other` (same as
Generate Hero).

**Auto-invoke** — active abilities toggle from the player's OWN submitted text, before the GM
call so the turn's referee/roll already plays with the buff (no confirmation card: the player
declaring it IS the instruction; the GM can never flip switches). `detectActionToggles` matches
per SENTENCE: the action name (word-boundary, case-insensitive) + an invocation cue
(invoke/use/cast/channel/unleash/trigger/call upon/tap into/power up…) → ON; a dismissal cue
(dismiss/deactivate/dispel/switch off/turn off/shut off/stop using/cancel/stow/release/end/drop…)
→ OFF, and dismissal beats invocation. A bare mention ("Blink Step saved me last week") changes
nothing; already-correct states are no-ops. `applyActionToggles` applies and reports what
changed; the submit path (`submitAction`) toasts each flip and saves. Toggles persist through
re-rolls (documented behavior).

**Harness bug fixed en route**: `check-actions.js` had gone stale — a fresh browser profile
reads kv BEFORE the first server reconcile (boot race), so the seeded session never resumed. It
now follows the seed → settle → reseed → reload recipe, and the AI path is exercised through a
content-aware mock on `/api/backends/chat-completions/*` (marker → offer arrays; everything else
→ plain prose; SSE and JSON both handled).

**Verified**: `tools/check-actions-auto.js` 27/27 pure Node (detection matrix, idempotence,
dismissal-wins, word-boundary guard, passive exclusion, offer clamp/validation, rule text);
`tools/check-actions.js` full browser harness all green incl. new sections 4 (auto-invoke ON/OFF
via the composer, mention-without-cue inert) and 5 (wizard: picker → wizard → Actions step →
generated offers → Add/Skip → manual add → review lists actions → Begin with a mocked opening →
actions survive with source=hero); `check-regex` OK, `check-presets` 106/106, `check-preset-ui`
OK. Screenshots: `a02b-editor.png` (editor layout fix), `a05-wizard-actions.png` (wizard step).

**Layout fix en route**: the editor's Name/Icon inputs used to spill out of the narrow hero
panel (fixed-width flex row) — the grid now stacks and inputs use the standard box styling.

## [rpge-patch 026] — Landing refreshes itself after the boot saves-sync

**Date:** 2026-11-21. **Trigger:** user report on the repo install — "my worlds and conversations
inside RPG-Engine weren't there; there were conflicts; the adventures aren't getting synced."
Investigation (Loreweaver repo + both installs' `rpg-engine/kv` mirrors + the sync client state)
showed NO data loss: the server mirror holds the full state (5 worlds, 2 adventures) and file sync
had carried it to both devices within seconds. The visible failure was purely client-side timing.

**Root cause:** the storage shim's boot reconcile runs late (`requestIdleCallback`, ≤12 s cap, then
list+get roundtrips), while the landing renders the Worlds/Adventures lists from IndexedDB at boot.
On a fresh browser (or a window whose IndexedDB lags the server — every device change since the
last boot qualifies), the landing paints an empty/stale library; seconds later the reconcile pulls
the server state into IndexedDB, but the only `rpge-saves-synced` listener was the import page's
dropdown (`loreweaver-import.js`). The landing never re-rendered, so the user kept seeing the
empty/stale lists until a manual reload — and read it as "saves don't sync". The recurring
`.conflict-<ts>.json` copies in `rpg-engine/kv/` are the by-design both-sides-changed record of
exactly these stale-local vs server-newer boots (server wins; the loser is kept server-side) —
noisy but never data-losing.

**Fix:**
- `shims/loreweaver-storage.js`: reconcile counts the entries it pulls into IndexedDB
  (`lastReconcilePulled`) and `rpge-saves-synced` is now a `CustomEvent` with
  `detail.changed` (backwards compatible; import page listener unaffected).
- `src/scripts/main.js`: the landing now listens for `rpge-saves-synced` and calls
  `refreshLanding()` when `detail.changed > 0` — re-rendering the Worlds/Adventures lists from the
  freshly synced store without a reload. Guards: never fires while a game session is running
  (`homePage === null` while chatting — no mid-play yank) and skips the import page (it refreshes
  its own dropdowns on this event; a landing re-mount would tear down its DOM mid-import, same
  guard as the existing `rpge-worlds-changed` handler).

**Verified:** `node --check` both files; `tools/check-storage.js` extended with a
`detail.changed ≥ 1` assertion across the boot-2 pull scenario — all green.

**Deploy:** dev clone → push → `git -C "%LOCALAPPDATA%/SillyTavern/Data/data/default-user/extensions/rpg-engine" pull`
→ reload the game page. No Loreweaver-server changes; no packaged-app rebuild required for this one.
