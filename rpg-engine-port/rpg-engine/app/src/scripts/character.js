// Lightweight character model. The hero is created in the character-creation wizard
// (openCharacterCreation in main.js) and afterwards edited via the Hero panel. Combat-relevant
// LIVE numbers (HP, level, exp, coins) are NOT stored here — they're AI-tracked resources defined
// in the loaded world's trackers. The hero's STATS (STR, INT, …) ARE stored here — player-owned,
// defined in the loaded world's stats config, changed only at level-up (spending stat points).

import { buildStatsContext } from "./stats.js";

export function defaultCharacter() {
  return {
    name: "",
    portrait: "src/images/portrait-placeholder.webp",
    age: "",
    gender: "",
    race: "",
    appearance: "",
    job: "",
    persona: "",
    extra: "",
    background: "",
    stats: {},              // hero attributes — player-owned, filled from the loaded world's stats
    statPoints: 0,          // unspent level-up points
    statFloors: {},         // per-stat minimum value for refunds (−) — the value when the current
                            // level-up window opened; you can never decrease below it
    statCommitted: false,   // true once a level-up allocation has been Saved — decreases (−) are
                            // locked until the next level-up grants fresh points
    statsAwardedLevel: undefined, // the hero level at which stat points were last granted
    // ---- OP-MC / free-build fields (all optional; old saves just lack them, see
    // initCharacterStats in main.js for the load-time normalization) ----
    freeBuild: false,       // wizard "Free build": stats ignore the point budget + ccCeiling (capped
                            // only by each stat's world max); also lifts the Hero panel's edit gating
    powers: "",             // free-text "Powers & abilities" fed to the GM in the character sheet
    trackerOverrides: null, // hero-level starting-tracker overrides {key: value, "key.max": n} — same
                            // shape as a world opening's trackerOverrides; merged OVER it (hero wins)
    trackerModes: null,     // {key: "locked"|"unlimited"} — locked = value frozen at creation;
                            // unlimited = never depletes (re-fills to its live max after every update)
    freeEdit: false,        // Hero panel ✎ toggle: edit stats/trackers mid-game without a level-up window
    noCritFail: false       // checks ignore the critical-failure window (lowest ~5% of the die) —
                            // the worst roll is decided by the math (total vs DC), not auto-failed
  };
}

// Human-readable character sheet used inside the GM context. Includes the bio (age, gender,
// appearance, job, persona, extra details) and the player-owned STATS section (from the loaded
// world) so the GM can use them for checks — but never change them.
export function characterSheet(c, statDefs) {
  const s = c || defaultCharacter();
  const bio = [];
  if (s.age) bio.push(`Age: ${s.age}`);
  if (s.gender) bio.push(`Gender: ${s.gender}`);
  if (s.race) bio.push(`Race: ${s.race}`);
  if (s.appearance) bio.push(`Appearance: ${s.appearance}`);
  if (s.job) bio.push(`Job: ${s.job}`);
  if (s.persona) bio.push(`Persona: ${s.persona}`);
  if (s.extra) bio.push(`Extra details: ${s.extra}`);
  const parts = [
    `Name: ${s.name || "Unnamed"}`,
    ...bio
  ].filter(Boolean);
  const statsTxt = buildStatsContext(statDefs, s.stats);
  if (statsTxt) parts.push(statsTxt);
  const powers = String(s.powers || "").trim();
  if (powers) parts.push("Powers & abilities (true of this character — reflect them in the story):\n" + powers);
  return parts.join("\n");
}
