// Scene-direction dice — the co-director's d20 (feature E of the preset-port plan).
//
// What this is: every SCENE_DICE_EVERY_TURNS turns, the ENGINE (client-side, no AI call) rolls a
// d20 and — on a hit — schedules a one-line DIRECTION for the NEXT turn's GM context: the scene
// gets pushed somewhere the player didn't steer. Deliberately SEPARATE from the open-thread dice
// (patch 013): thread dice fire TRACKED story debt; scene dice inject RANDOM director noise even
// when nothing is owed. Most rolls are calm — the dice mostly don't interfere; a hit every ~30
// turns on average is the intended feel ("that's the moment a scene can go stale").
//
// What this is NOT: not an outcome system. The GM weaves the nudge into the beat; it never
// dictates success/failure (skill checks own that) and never overrides the player's stated
// actions. Nudges are directives about DIRECTION, not about dice-law results.

export const SCENE_DICE_EVERY_TURNS = 15;

// d20 → nudge. Calm rolls (the majority) return null.
const NUDGES = [
  { min: 1, max: 2, kind: "Complication", text: "an existing plan, errand, or comfortable routine fails in a small concrete way this beat" },
  { min: 3, max: 4, kind: "Twist", text: "new information arrives that reframes something the hero currently believes" },
  { min: 5, max: 6, kind: "Arrival", text: "someone the hero has met before arrives unexpectedly (pick a fitting known face; if none fits, a messenger or stranger bearing news)" },
  { min: 7, max: 8, kind: "Pressure", text: "the stakes or urgency of the current situation visibly rise" },
  { min: 9, max: 10, kind: "Quiet beat", text: "a quiet beat: let the story breathe — a small warm or reflective moment before momentum resumes" }
];

// @returns {kind, text} for a hit, or null on a calm roll (11–20).
export function sceneNudgeFor(roll) {
  const r = Math.round(Number(roll));
  if (!(r >= 1 && r <= 20)) return null;
  return NUDGES.find((n) => r >= n.min && r <= n.max) || null;
}

// Short toast label for a roll ("" on a calm roll).
export function sceneDiceToast(roll) {
  const n = sceneNudgeFor(roll);
  return n ? n.kind : "";
}
