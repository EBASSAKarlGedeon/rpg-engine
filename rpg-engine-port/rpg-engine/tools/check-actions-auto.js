// [rpge-patch 025] Auto-invoke + action-offer normalization — pure Node checks (no browser).
// Usage: node tools/check-actions-auto.js
import { detectActionToggles, applyActionToggles, normalizeActionOffer, actionGenRule } from "../app/src/scripts/actions.js";

const problems = [];
const ok = (cond, msg) => { if (cond) console.log("  ok:", msg); else { problems.push(msg); console.log("  FAIL:", msg); } };

const char = (actions) => ({ stats: { str: 10, agi: 10 }, actions });
const blink = (active) => ({ id: "a1", name: "Blink Step", icon: "🌫", kind: "active", deltas: { agi: 2 }, effect: "Short-range teleport.", active: !!active, source: "hero" });
const aura = { id: "a2", name: "All Enhancement", icon: "✨", kind: "passive", deltas: { str: 30 }, effect: "Ten times stronger.", active: false, source: "hero" };

console.log("1) auto-invoke detection");
let det = detectActionToggles("I invoke Blink Step and cross the chasm.", char([blink(false), aura]));
ok(det.on.length === 1 && det.on[0].id === "a1", "invoke cue toggles the named action ON");
ok(det.off.length === 0, "nothing toggled OFF");
ok(applyActionToggles(det)[0].active === true, "apply flips active on");

det = detectActionToggles("Blink Step saved me last week. Now I rest.", char([blink(false)]));
ok(det.on.length === 0 && det.off.length === 0, "bare mention without a cue changes nothing");

det = detectActionToggles("I stop using Blink Step for a moment.", char([blink(true)]));
ok(det.off.length === 1 && det.off[0].id === "a1", "dismissal cue toggles OFF while active");
ok(applyActionToggles(det)[0].active === false, "apply flips active off");

det = detectActionToggles("I invoke Blink Step and cross the chasm.", char([blink(true)]));
ok(det.on.length === 0 && det.off.length === 0, "invoke while already on is a no-op (idempotent)");

det = detectActionToggles("I deactivate Blink Step.", char([blink(true)]));
ok(det.off.length === 1, "deactivate wording recognized");
det = detectActionToggles("I dismiss Blink Step and walk on.", char([blink(true)]));
ok(det.off.length === 1, "dismiss wording recognized");

det = detectActionToggles("I end Blink Step, then I invoke Blink Step again.", char([blink(true)]));
ok(det.off.length === 1 && det.on.length === 0, "dismissal beats invocation across sentences");

det = detectActionToggles("I use Blink Step.", char([blink(false), aura]));
ok(det.on.length === 1, "generic 'use' cue counts");

det = detectActionToggles("My blink steps echo in the hall.", char([blink(false)]));
ok(det.on.length === 0, "word-boundary guard: a phrase containing the name as substring does not match");
det = detectActionToggles("I invoke the ALL ENHANCEMENT state — wait, that's passive anyway.", char([aura]));
ok(det.on.length === 0, "passive actions are never toggle targets");

det = detectActionToggles("I invoke All Enhancement. I use Blink Step.", char([blink(false)]));
ok(det.on.length === 1, "cue and name may sit in different sentences of the same submit — per-action any-sentence pairing");

det = detectActionToggles("I look at the river. The night is dark. Nothing here.", char([blink(false)]));
ok(det.on.length === 0 && det.off.length === 0, "no cues → no change");

console.log("2) offer normalization");
const statDefs = [{ key: "str", label: "Strength", start: 10, max: 50 }, { key: "agi", label: "Agility", start: 10 }];
let o = normalizeActionOffer({ name: "Shadow Meld", icon: "🌑🌙x", kind: "active", deltas: { agi: 9, luck: 5, str: 0 }, effect: "Meld into shadows." }, statDefs, { maxDelta: 3 });
ok(o && o.name === "Shadow Meld", "valid offer kept");
ok(o.icon === "🌑🌙" && [...o.icon].length === 2, "icon clamped to 2 code points");
ok(o.deltas.agi === 3, "delta clamped to maxDelta");
ok(!("luck" in o.deltas), "unknown stat key dropped");
ok(!("str" in o.deltas), "zero delta dropped");
o = normalizeActionOffer({ name: "", kind: "passive" }, statDefs, {});
ok(o === null, "missing name rejected");
o = normalizeActionOffer("not an object", statDefs, {});
ok(o === null, "non-object rejected");
o = normalizeActionOffer({ name: "X", kind: "warrior" }, statDefs, {});
ok(o && o.kind === "passive", "unknown kind defaults to passive");
o = normalizeActionOffer({ name: "X" }, statDefs, {});
ok(o && o.icon === "✦", "default icon supplied");

console.log("3) generation rule text");
const rule = actionGenRule(5);
ok(rule.includes("≤ 5"), "rule carries the delta cap");
ok(rule.includes("JSON ARRAY"), "rule demands a JSON array");
ok(rule.includes("at most ONE active"), "active cap stated");

console.log(problems.length ? "PROBLEMS: " + problems.join(" | ") : "ACTIONS-AUTO OK");
if (problems.length) process.exit(1);
