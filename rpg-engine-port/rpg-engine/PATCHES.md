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
