# Preset Intake Plan — RPG Engine ([rpge-patch 020]–[023])

> Runner-up doc to `docs/PRESETS.md` (Loreweaver repo) — that one explains "what a preset is and
> how Loreweaver's code turns one into an API call"; THIS is the actionable plan for grafting that
> capability onto the RPG Engine. One patch at a time, hand-test each, `node --check` before deploy.

## Big picture (decided 2026-11-21)

| Concern | Decision |
|---|---|
| Samplers (`temperature`, `top_p`, …) | Already works — `loreweaver-bridge.js` reads `/api/settings/get` connection profiles + named preset fields. No new work. |
| Prompt stack (`prompts` + `prompt_order` JSON schema + `{{setvar}}`/`{{getvar}}`/`{{// }}` macros) | Engine-local, schema-*compatible* (not UI-copy) chat-preset model + lightweight in-engine editor. Import/Export speaks ST's exact `.json` format so a preset can move between ST and the engine as a file. |
| Regex port | Lift `runRegexScript` from `public/scripts/extensions/regex/engine.js` (self-contained `public/` module, not an extension) so external presets' text can be post-processed before render. |
| Internal States HTML blocks (FF 5.4's `<details>` dashboards) | **Not copied.** Each fake module already has a superior engine-native counterpart (`scene-dice.js` `stats.js` = DnD Sim; `actions.js` = Inv/Feats/Titles; `openThreads`/`npc-life.js` = GM's Notebook/Agenda; tracker rows = Relationships). Proposed "FF 5.4 — Engine Edition" preset keeps FF 5.4's prose/POV/NSFW/behavior blocks verbatim but drops those 8 `injection_position:1` state-HTML modules entirely — this is a data task, not a code task. |

## Patch order

### [rpge-patch 020] — GFX panels + inline images in message text
Small, visual, self-contained — no dependency on the preset system. This patch.

### [rpge-patch 021] — Regex engine port (full spec)
**New module**: `app/src/scripts/regex.js` — self-contained port of Loreweaver's
`public/scripts/extensions/regex/engine.js`. No imports from Loreweaver's `script.js` /
`extensions.js` / `preset-manager.js` (those reach into ST globals the engine doesn't have);
instead scripts are passed in explicitly by the caller, and macro expansion uses the engine's own
`{{user}}` convention (`subUser` from `text-utils.js`) rather than ST's full `substituteParams`
macro universe.

**Ported pieces (behavior-faithful to ST)**:
1. `RegexProvider` — LRU-cached `RegExp` compiler (cache size 1000, `lastIndex` reset for
   global/sticky regexes). Pure JS, ported verbatim.
2. `regexFromString(input)` — parse `/pattern/flags` → `RegExp`, same flag-validation fallback
   as `public/scripts/utils.js` (invalid flags → `RegExp(input)`).
3. `sanitizeRegexMacro(x)` — regex-escape macro-expanded text (for `substituteRegex: ESCAPED`
   mode), ported verbatim.
4. `substitute_find_regex` enum — `NONE:0, RAW:1, ESCAPED:2`, verbatim (RAW = macro-expand
   `findRegex` as-is; ESCAPED = macro-expand then regex-escape the result; NONE = literal).
5. `runRegexScript(regexScript, rawString, { macros })` — core find/replace engine:
   `{{match}}` → `$0`, `$1..$9` / `$<namedGroup>` capture-group refs in `replaceString`,
   `trimStrings` post-match filtering, final macro expansion of the replacement. Ported
   faithfully; macro expansion swapped for the engine's `{{user}}`-only convention
   (`expandMacros` helper built on `subUser`).
6. `filterString` — applies `trimStrings` (each entry macro-expanded, then literal `.replaceAll`
   removal), verbatim.
7. `regex_placement` enum — `MD_DISPLAY:0, USER_INPUT:1, AI_OUTPUT:2, SLASH_COMMAND:3,
   WORLD_INFO:5, REASONING:6`, verbatim.
8. `getRegexedString(rawString, placement, { scripts, isMarkdown, isPrompt, isEdit, depth })` —
   the "which scripts run where" gate: `placement.includes()`, `markdownOnly`/`promptOnly`
   mutual-exclusion, `runOnEdit` gating, `minDepth`/`maxDepth` window — all faithful — but takes
   an explicit `scripts` array parameter instead of ST's `extension_settings.regex`/
   character-scoped/preset-scoped storage lookups.

**Not ported (deliberate)**: `getRegexScripts`/`getScriptsByType`/`saveScriptsByType` (ST's
storage layer) — the engine manages its own script storage in a later patch (likely world-level
regex rules). For now callers pass `scripts` in explicitly; keeps the module pure/testable and
the storage decision deferred.

**Test plan** (`tools/check-regex.js`): headless Node unit-style checks (this module is pure JS,
no DOM dependency — unlike `rich-text.js`): capture groups (`$1`/`$<name>`), `{{match}}`
shorthand, `trimStrings`, `{{user}}` macro expansion, `substituteRegex: ESCAPED` mode escapes
regex metacharacters, `regex_placement` gating, `minDepth`/`maxDepth` gating,
`runOnEdit`/`markdownOnly`/`promptOnly` gating, LRU cache reuse. No new DOM harness needed.

### [rpge-patch 022] — Engine-native prompt-stack model + editor — SHIPPED (2026-11-22, see PATCHES.md)
Original sketch: New `app/src/scripts/presets.js` (or similar): schema-compatible model of ST's `prompts` +
`prompt_order`, expand `{{setvar}}`/`{{getvar}}`/`{{// }}` macros, feed the assembled system prompt
to the existing `rp-engine.js` `RPEngine` prompt pipeline (`narratorPrompt` currently takes `genText`
+ `promptText` + `proseRulesText` + `vibeText`… — this layer replaces that growing if/else tree).
Lightweight in-engine editor panel (reuses the engine's panel/seg-btn/tab component style, NOT a
copy of ST's 5k-line PromptManager HTML). Import/Export buttons speak ST's `.json` format.

### [rpge-patch 023] — "FF 5.4 — Engine Edition" preset data
Hand-port the prose-style / POV / NSFW / behavior-wording blocks from
`data/default-user/OpenAI Settings/Freaky Frankenstein 5.4 Internal States vers. Fiction Styles + Ground Prose Rules.json`
verbatim into a preset file the engine can load. Drops the 8 Internal-States HTML modules (see
rationale above). Delivers the actual "FF 5.4 without internal-state dashboards" ask.

## [rpge-patch 020] — full spec

### Markup shape (author/AI-facing)
Two additions to message text, matched in `app/src/scripts/rich-text.js` **before** the existing
escape-first pipeline, so they can't be neutered by `esc()` and can't leak markup.

1. **GFX panel** (from FF 5.4's `<!-- GFX_START -->` / `<!-- GFX_END -->` syntax):
   ```
   <!-- GFX_START -->
     <div class="gfx-terminal">...any allowlisted html...</div>
   <!-- GFX_END -->
   ```
   Regex: `/<!--\s*GFX_START\s*-->([\s\S]*?)<!--\s*GFX_END\s*-->/gi` over the RAW (pre-`esc`)
   source. Body lifted aside into a `gfx[]` cache, placeholder `GFX_MARK + i + GFX_MARK`
   (`"\u0002"`, same trick as `CODE_MARK` `"\u0000"`) spliced into the escaping stream so the body
   is never HTML-escaped and never touches bold/italic/quote passes. Restored at the very end of
   `core()` as `<div class="gfx-wrap">{sanitized}</div>`.

2. **Inline image** (CommonMark-ish `![alt](src)`):
   ```
   ![Great Sage portrait](/user/images/Test/Great_Sage.png)
   ![](https://ella.janitorai.com/media-approved/UOwsuxUbwT61brx9RzhEx.webp)
   ```
   Regex (run AFTER `esc()`, so alt + src are already entity-safe for attribute injection):
   `/!\[([^\]]*)\]\(([^()\s]+)\)/g` → `<img class="msg-img" alt="$1" src="$2" loading="lazy">`.
   `[^()\s]+` deliberately rejects URLs containing spaces/parens → malformed attempts degrade to
   literal text instead of a broken tag. URLs are additionally whitelisted at render time
   (`http://`, `https://`, `/user/…`, `/scripts/extensions/…`, `/api/…`) — `javascript:`,
   `data:`, `vbscript:` never render as `src` (mark the wrapper with a `bad` class instead).

### Sanitizer (GFX body only — not needed for images, those go through `esc()` naturally)
Browser-side (`rich-text.js` is app code, `DOMParser` available): parse the raw body with
`new DOMParser().parseFromString(body, "text/html")`, walk the tree, and copy only:

* **Tags**: `div, span, p, br, hr, b, i, em, strong, u, s, pre, code, h1-h6, table, tr, td, th, thead, tbody, ul, ol, li, button, small, kbd, mark, sub, sup`. Anything else dropped (children kept — copy the subtree but not the wrapper — so a stray `<script>` contents can't smuggle back as "text").
* **Attributes**: `class`, `title`, `style`. Everything else (`id` — collides with app
  `querySelector` lookups; `onclick`/`on*` — XSS; `href`/`src` on non-img — not needed by
  `<gfx_protocol>`) stripped.
* **`style` values**: parse `prop: value` pairs; `prop` must be in
  `{color, background, background-color, background-image, border, border-radius, border-color,
  border-style, border-width, padding, margin, width, height, max-width, max-height, min-width,
  min-height, font-family, font-size, font-weight, font-style, text-align, line-height,
  letter-spacing, text-transform, opacity, display, overflow, overflow-x, overflow-y,
  box-shadow, text-shadow, white-space, flex, flex-direction, justify-content, align-items,
  gap, outline, vertical-align, float, transform}`;
  `value` must NOT match `/(?:url\s*\(|expression\s*\(|javascript:|@import|behavior\s*:)/i`.
  Anything failing this is silently dropped (degrades to same appearance minus the risky bit
  — no error, no throw). This still allows everything `<gfx_protocol>` actually documents
  (`font-family:monospace; background:#0a0a0a; color:#0f0; border:1px solid #0f03;
  box-shadow:0 0 10px #0f03; padding:…`) because none of those values use parentheses.

### UI / CSS additions (`app/src/styles.css`)
* `.gfx-wrap` — margin/vertical rhythm around a panel, overflow-x:auto so a wide terminal can
  scroll inside its bubble instead of stretching the transcript row.
* `.gfx-terminal`, `.gfx-map`, `.gfx-letter`, `.gfx-phone` — cosmetic default themes matching the
  preset's described looks (monospace/terminal-green, parchment/rotated-corner letter, rounded
  phone frame with a header bar). Used as `class="gfx-wrap gfx-terminal"` etc. — purely additive,
  the AI can style its own inline `style="…"` too (sanitized as above).
* `.msg-img` — `max-width:min(100%,520px); max-height:60vh; border-radius:10px; display:block; margin:4px 0;`
  plus a `.msg-img.bad` variant (dimmed, shown as literal fallback text) for rejected URLs.

### Where this plugs in
* `app/src/scripts/rich-text.js` `core()` — the single choke point for `inlineMd`, `richText`,
  `richTextWithMentions` (transcript + world descriptions + changelog all route through it), so
  both features light up everywhere messages render. No changes to `chatMd` (Discussion page) —
  out of scope unless requested.

### Test plan (real-server seeded stub, `tools/check-gfx-images.js`)
Pattern: copy `check-hero-tabs.js` kv-stub + `makeWorld`/`makeSession` seam. Seed a session whose
messages include one GFX terminal panel and one image with both URL forms. Verify:
1. GFX body renders as live HTML (e.g. `getComputedStyle($('.gfx-wrap')).background-color` matches
   the inline style set by the fixture), no `&lt;…&gt;` literal-angle-bracket residue visible.
2. `<img class="msg-img">` present in the DOM for both file-forms; `src` matches the fixture URL.
3. Hostile fixture (a "GFX panel" containing `<img src=x onerror=alert(1)>` and a
   `![](javascript:alert(1))`) produces NO `onerror`-carrying element and NO javascript: `src`
   anywhere in `document.documentElement.outerHTML` — the sanitizer/whitelist held.
4. Screenshot for review at 1500px + 1000px.

`node --check` the touched module(s) via the ESM-copy trick before deploy:
`cp app/src/scripts/rich-text.js "$TEMP/chk.mjs" && node --check "$TEMP/chk.mjs"`.
Deploy = commit + push (engine `main`) + `git pull` in
`C:/Users/Gedeon/AppData/Local/SillyTavern/Data/data/default-user/extensions/rpg-engine`, then run
the harness. Add screenshots to `C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/` (`gz01`–… prefix).

### Out of scope (explicit)
* `chatMd` (Discussion page) remains plain-markdown-only for now.
* No preset system / macro changes in 020 — those are 022.
* No regex engine in 020 — 021.
* No CSP/helmet changes — `contentSecurityPolicy: false` already, fine to rely on.