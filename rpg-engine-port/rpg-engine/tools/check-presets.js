// [rpge-patch 022] Prompt-stack preset model — unit + seam tests, plain Node (no DOM).
// Covers: parsePresetJson (validation + round-trip against the REAL FF 5.4 preset file),
// expandMacros (ST grammar), assemblePresetPrompt (order/markers/injections), and the real
// RPEngine buildContext seam (no preset = byte-identical; with preset = blocks land in the
// stable cluster and ABSOLUTE injections right before the final reply directive).
// Run: node tools/check-presets.js
import { parsePresetJson, expandMacros, assemblePresetPrompt, serializePresetExport, rollFormula } from "../app/src/scripts/presets.js";
import { RPEngine } from "../app/src/scripts/rp-engine.js";
import { readFileSync } from "node:fs";

let n = 0;
let bad = 0;
const ok = (cond, label) => { n++; if (!cond) { bad++; console.log("  FAIL:", label); } };
const eq = (got, want, label) => ok(Object.is(got, want), `${label} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`);

console.log("== expandMacros ==");
{
  const vars = new Map();
  const ctx = { user: "Wren", char: "GM", vars };
  eq(expandMacros("hi {{user}}", ctx), "hi Wren", "{{user}}");
  eq(expandMacros("hi {{USER}}", ctx), "hi Wren", "{{USER}} case-insensitive");
  eq(expandMacros("<USER> and <BOT>", ctx), "Wren and GM", "legacy <USER>/<BOT>");
  eq(expandMacros("{{char}}?", ctx), "GM?", "{{char}}");
  eq(expandMacros("a {{// secret note}} b", ctx), "a  b", "comment macro");
  eq(expandMacros("x {{trim}}\n\n  y", ctx), "x   y", "{{trim}} eats surrounding newlines (ST keeps spaces)");
  eq(expandMacros("a{{noop}}b", ctx), "ab", "{{noop}}");
  eq(expandMacros("a{{newline}}b", ctx), "a\nb", "{{newline}}");
  eq(expandMacros("{{unknownmacro}}", ctx), "{{unknownmacro}}", "unknown stays literal");
  eq(expandMacros("{{kimi-K3}}", ctx), "{{kimi-K3}}", "provider macro stays literal");
  eq(expandMacros("{{maxContext}}", ctx), "{{maxContext}}", "maxContext stays literal");
  // setvar/getvar, including the FF pattern: blank-then-fill templates resolved across passes
  eq(expandMacros("{{setvar::color::red}}The wall is {{getvar::color}}.", ctx), "The wall is red.", "setvar/getvar");
  eq(expandMacros("{{setvar::k::{{getvar::color}}}}={{getvar::k}}", ctx), "=red", "nested template resolves on a later pass");
  eq(expandMacros("{{getvar::missing}}", ctx), "", "getvar of missing var = empty");
  eq(expandMacros("{{setvar::dndTemplate::}}{{getvar::dndTemplate}}x", ctx), "x", "blanked template = empty");
  // addvar/incvar/decvar
  const v2 = new Map();
  v2.set("score", "10");
  eq(expandMacros("{{addvar::score::5}}", { vars: v2 }), "", "addvar empty replacement");
  eq(v2.get("score"), "15", "addvar numeric add");
  v2.set("name", "a");
  expandMacros("{{addvar::name::b}}", { vars: v2 });
  eq(v2.get("name"), "ab", "addvar string concat when not numeric");
  const v3 = new Map();
  expandMacros("{{setvar::i::7}}{{incvar::i}}{{getvar::i}}", { vars: v3 });
  eq(v3.get("i"), "8", "incvar +1 and visible to getvar");
  // roll
  const seen = new Set([1, 2, 3]);
  for (let i = 0; i < 30; i++) { const r = parseInt(expandMacros("{{roll::1d20}}", {}), 10); seen.add(r); }
  ok([...seen].every((r) => r >= 1 && r <= 20) && seen.size >= 5, "roll::1d20 rolls fresh values in range (got " + [...seen].sort((a, b) => a - b).join(",") + ")");
  eq(parseInt(expandMacros("{{roll:2d6+1}}", {}), 10) >= 3, true, "roll:2d6+1 produces a total >= 3");
  eq(expandMacros("{{roll: 3}}", {}).length >= 1 && parseInt(expandMacros("{{roll: 3}}", {}), 10) >= 1, true, "digits-only roll means 1dN");
  eq(expandMacros("{{roll:bogus}}", {}), "", "invalid roll = empty (ST behavior)");
  // random/pick
  const opts = ["a", "b", "c"];
  for (let i = 0; i < 20; i++) ok(opts.includes(expandMacros("{{random:a,b,c}}", {})), "random returns a member");
  {
    const pv = new Map();
    const first = expandMacros("{{pick:x,y,z}}", { vars: pv });
    let stable = true;
    for (let i = 0; i < 5; i++) if (expandMacros("{{pick:x,y,z}}", { vars: pv }) !== first) stable = false;
    ok(stable, "pick stable within one vars context");
  }
  // dates: format tokens survive names containing letters (March must not lose its 'h')
  {
    const d = expandMacros("{{isotime YYYY-MM-DD h:mm A}}", { now: new Date(2026, 2, 14, 9, 5) }); // March 14 2026
    ok(/^2026-03-14 9:0\d (AM|PM)$/.test(d), "isotime with format, March keeps its letters (got '" + d + "')");
  }
  {
    const d = expandMacros("{{isodate}}", { now: new Date(2026, 10, 21, 15, 30) });
    eq(d, "2026-11-21", "isodate default format");
  }
}

console.log("== parsePresetJson ==");
{
  eq(parsePresetJson("not json").ok, false, "garbage rejected");
  eq(parsePresetJson("{}").ok, false, "no prompts rejected");
  eq(parsePresetJson('{"prompts":[]}').ok, true, "empty prompts accepted");
  const r = parsePresetJson(JSON.stringify({ prompts: [{ identifier: "a" }, { identifier: "", content: "x" }, "nope"] }));
  eq(r.ok, true, "partial validity still parses");
  eq(r.errors.length, 3, "bad entries + missing order reported (3 errors)");
  eq(r.preset.prompts.size, 1, "only valid prompts kept");
  eq(parsePresetJson('{"prompts":[{"identifier":"a"}]}').preset.order.length, 0, "no prompt_order = empty order");
}

console.log("== assemblePresetPrompt ==");
{
  const mk = (data) => parsePresetJson(JSON.stringify(data)).preset;
  // order + enable + markers
  const p1 = mk({
    prompts: [
      { identifier: "main", marker: false, content: "MAIN BLOCK", role: "system", injection_position: 0 },
      { identifier: "m1", marker: true, content: "MARKER SHOULD VANISH", role: "system", injection_position: 0 },
      { identifier: "b", marker: false, content: "B BLOCK", role: "user", injection_position: 0 },
      { identifier: "c", marker: false, content: "C DISABLED", role: "user", injection_position: 0 },
      { identifier: "orphan", marker: false, content: "NOT IN ORDER", role: "system", injection_position: 0 },
      { identifier: "inj", marker: false, content: "INJECTED", role: "user", injection_position: 1, injection_depth: 0, injection_order: 100 },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "main", enabled: true }, { identifier: "m1", enabled: true }, { identifier: "b", enabled: true }, { identifier: "c", enabled: false }, { identifier: "inj", enabled: true }] }],
  });
  const out1 = assemblePresetPrompt(p1, { user: "Wren" });
  eq(out1.inFlow, "MAIN BLOCK\n\nB BLOCK", "play order kept, disabled + markers + orphans skipped");
  eq(out1.injections.length, 1, "ABSOLUTE injection split out");
  eq(out1.injections[0].text, "INJECTED", "injection text present");
  eq(out1.injections[0].role, "user", "injection role carried");
  // sorting: depth, then injection_order, then play order
  const p2 = mk({
    prompts: [
      { identifier: "i2", content: "TWO", injection_position: 1, injection_depth: 0, injection_order: 200 },
      { identifier: "i1", content: "ONE", injection_position: 1, injection_depth: 0, injection_order: 100 },
      { identifier: "i0", content: "ZERO", injection_position: 1, injection_depth: 0, injection_order: 100 },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "i2", enabled: true }, { identifier: "i1", enabled: true }, { identifier: "i0", enabled: true }] }],
  });
  const out2 = assemblePresetPrompt(p2);
  eq(out2.injections.map((i) => i.text).join(","), "ONE,ZERO,TWO", "injection_order then play order");
  // macro context is shared across blocks (vars set in block 1 read in block 2)
  const p3 = mk({
    prompts: [
      { identifier: "s", content: "{{setvar::greeting::Hello}}", injection_position: 0 },
      { identifier: "u", content: "{{getvar::greeting}}, {{user}}!", injection_position: 0 },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "s", enabled: true }, { identifier: "u", enabled: true }] }],
  });
  const out3 = assemblePresetPrompt(p3, { user: "Wren" });
  eq(out3.inFlow, "Hello, Wren!", "vars shared across the stack");
  // empty content blocks dropped
  const p4 = mk({ prompts: [{ identifier: "e", content: "   ", injection_position: 0 }], prompt_order: [{ character_id: 100001, order: [{ identifier: "e", enabled: true }] }] });
  eq(assemblePresetPrompt(p4).inFlow, "", "whitespace-only block dropped");
}

console.log("== round-trip vs the REAL FF 5.4 preset file ==");
const FF_PATH = "../../../../../../../data/default-user/OpenAI Settings/Freaky Frankenstein 5.4 Internal States vers. Fiction Styles + Ground Prose Rules.json";
let ffData = null;
try { ffData = JSON.parse(readFileSync(new URL(FF_PATH, import.meta.url), "utf8")); } catch (e) { console.log("  (skip: FF5.4 file not reachable — " + e.message + ")"); }
if (ffData) {
  const r = parsePresetJson(JSON.stringify(ffData));
  eq(r.ok, true, "FF 5.4 parses");
  eq(r.errors.length, 0, "no parse errors");
  eq(r.preset.prompts.size, 68, "68 prompts");
  eq(r.preset.order.length, 61, "61 play-order entries (global group)");
  // Export = the imported object verbatim → deep-equal to the original file's parsed JSON
  const back = JSON.parse(serializePresetExport(r.preset));
  eq(JSON.stringify(back) === JSON.stringify(ffData), true, "Export round-trips byte-identically (as JSON)");
  // assembly sanity: with everything enabled as the file ships, the enabled blocks play
  const out = assemblePresetPrompt(r.preset, { user: "Wren" });
  ok(out.inFlow.length > 500, "in-flow stack is substantial (" + out.inFlow.length + " chars)");
  ok(out.injections.length >= 8, "Internal-States ABSOLUTE injections detected (" + out.injections.length + ")");
  ok(!out.inFlow.includes("{{user}}"), "no raw {{user}} left in the expanded stack");
  ok(!out.inFlow.includes("{{getvar"), "no unresolved {{getvar in the expanded stack");
  ok(!out.inFlow.includes("{{setvar"), "setvar directives fully consumed");
}

console.log("== RPEngine seam (real buildContext) ==");
{
  const genText = async () => "";
  const mkEngine = (preset) => new RPEngine({ genText, promptText: "Test GM instructions.", scenarioText: "premise", startText: "start", proseRulesText: "PROSE RULES TEXT", preset });
  const state = { turn: 3, character: { name: "Wren" }, trackers: {}, npcs: {}, memories: { manual: [], auto: [] } };
  const base = await mkEngine(null).buildContext(state, [], "I look around", "action", false, {});
  ok(base.includes("Test GM instructions."), "baseline prompt built");
  ok(base.includes("WRITING RULES"), "baseline prose pack present");
  ok(!base.includes("PRESET DIRECTIVES"), "baseline has no preset cluster");

  // with preset: in-flow lands right after prose rules, before the premise
  const preset = parsePresetJson(JSON.stringify({
    prompts: [
      { identifier: "style", name: "Style", role: "system", content: "STYLE: light-novel prose.", marker: false, injection_position: 0 },
      { identifier: "inj", name: "Beat", role: "user", content: "INJECTED BEAT", marker: false, injection_position: 1, injection_depth: 0, injection_order: 100 },
    ],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "style", enabled: true }, { identifier: "inj", enabled: true }] }],
  })).preset;
  const withP = await mkEngine(preset).buildContext(state, [], "I look around", "action", false, {});
  ok(withP.includes("PRESET DIRECTIVES (instructions from the author's loaded prompt preset — binding):\nSTYLE: light-novel prose."), "preset cluster rides with its header");
  ok(withP.includes("INJECTED BEAT"), "injection text present in the assembled context");
  const iProse = withP.indexOf("WRITING RULES");
  const iPreset = withP.indexOf("PRESET DIRECTIVES");
  const iPremise = withP.indexOf("WORLD PREMISE");
  ok(iProse >= 0 && iPreset > iProse && iPreset < iPremise, "cluster sits between prose rules and the premise (stable prefix)");
  const iBeat = withP.indexOf("INJECTED BEAT");
  const iReply = withP.indexOf("Now write your reply:");
  ok(iBeat >= 0 && iBeat < iReply, "injection rides before the final reply directive");
  // {{user}} inside preset blocks is resolved (hero substitution)
  const preset2 = parsePresetJson(JSON.stringify({
    prompts: [{ identifier: "x", content: "Never write what {{user}} did.", marker: false, injection_position: 0 }],
    prompt_order: [{ character_id: 100001, order: [{ identifier: "x", enabled: true }] }],
  })).preset;
  const withP2 = await mkEngine(preset2).buildContext(state, [], "I look around", "action", false, {});
  ok(withP2.includes("Never write what Wren did."), "preset {{user}} resolved to the hero");
  // presetAssemble degrades gracefully on garbage
  {
    const e = mkEngine({ nonsense: true });
    const out = e.presetAssemble("Wren");
    eq(out.inFlow, "", "garbage preset degrades to no stack");
    eq(out.injections.length, 0, "garbage preset degrades to no injections");
  }
}

console.log("");
console.log(bad === 0 ? `PRESET OK — ${n}/${n} green` : `PRESET FAIL — ${bad}/${n} red`);
process.exit(bad === 0 ? 0 : 1);
