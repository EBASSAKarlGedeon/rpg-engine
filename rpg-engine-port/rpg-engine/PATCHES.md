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

**Change (1 rule):**

```css
.ce-view[hidden] { display: none; }
```

**Impact when reverted:** editor tabs visually break for every world (not world-specific).

**Revert:** delete the rule.
