// [rpge-patch 010] Prose Rules Pack — the engine's anti-slop writing layer, distilled from four
// community presets (Freaky Frankenstein 5.4 "Ground Prose Rules", Pura's Director 16 "Grounded
// Prose", Sola V4 "Prose Standards/Idiolect", Voyage's micro-rule format).
//
// What was kept and why: Voyage's [bad] → [good] example format (tiny tokens, unambiguous), FF's
// Ground Prose ban-list (somatic tics, stock scents, echoing), Sola's anti-echo / "no answer is
// owed" / idiolect rules, and both presets' anti-omniscient + no-plot-armor clauses (which are
// gameplay rules, not just prose taste — they pair with the engine's dice).
//
// What was dropped: the preset-proprietary extensions (HTML HUDs, colored dialogue, persona
// modules, CoT nesting) — the engine's overlay UI and role-matrix bridge already own those jobs.
//
// Injection: a per-world toggle (world.proseRules, default ON — see world.js). When on, the pack
// rides in the STABLE prefix cluster of every GM prompt (rp-engine.js buildContext, right after
// WORLD DESCRIPTION), so it stays prefix-cache friendly across turns. When off, nothing is fed —
// the GM prompt is byte-identical to pre-patch behavior.

export const PROSE_RULES_TEXT = `STATE THINGS DIRECTLY — no negation-framing, no hedging:
- bad: "It's not cold, but warm." -> good: "It's warm."
- bad: "She doesn't sit. Instead, she removes her jacket." -> good: "She removes her jacket."
- bad: "The silence spoke volumes." -> good: "Everyone stays quiet."
- bad: "He is so happy!" -> good: "He is happy." / "He is excited!"

SHOW EMOTION, NEVER LABEL IT — the feeling stays unnamed:
- bad: "'You're noisy!' he says angrily." -> good: "'SHUT YOUR DAMN MOUTH!' he screams from his chair."
- Show it through what the body does: posture, grip, distance, gaze, breath, what the hands do. No diagnosing feelings, no emotion adverbs, no stock tics (jaw tightening, breath catching, knuckle whitening).

EVERY SPOKEN LINE IS AN ACTION — an NPC speaks to get something (information, safety, leverage, comfort). Nothing is owed back: a question need not be answered, an insult need not be countered, a joke need not be topped. Silence, a gesture, or walking away is a complete response. A turn with no dialogue at all is valid when nobody has a reason to speak.

NO MIND-READING, NO OMNISCIENCE — each character knows only what they witnessed or were told. Never reveal a character's hidden thoughts through narration or through another character's words; never identify anyone or anything by smell alone.

NO PLOT ARMOR — wounds, exhaustion and damage persist until treated; resources run out; any character can fail, be hurt, or die when events and dice say so. Do not soften outcomes to protect a character.

CUT THE CLICHES — replace each with one concrete observable: "not X but Y" framing; echoing the player's words back ("You're asking me to...?"); therapy-speak ("That's completely valid", "What I hear you saying..."); rule-of-three lists; "a beat" / "a pause"; purring or growling from human characters; stock scents (ozone, sandalwood, cedar); stock fantasy names (Blackwood, Ashworth, Eldoria); melodramatic overreaction ("Nobody has ever said that to me!").

DIALOGUE RHYTHM — break long speech with physical action beats; give each character their own vocabulary, cadence and dialect (a dock worker never sounds like a lecturer); answer the intent of what was said with new action, never with a summary of it.`;

// The pack is per-world: world.proseRules defaults ON (absent = on, for old saves); only an
// explicit false turns it off.
export function proseRulesOn(world) {
  return !world || world.proseRules !== false;
}
