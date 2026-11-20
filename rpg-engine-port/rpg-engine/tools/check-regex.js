// Patch 021 verification: regex engine port (app/src/scripts/regex.js). Pure-JS module — no
// browser/DOM needed, so this runs as plain Node unit checks. Verifies: capture groups
// ($1/$<name>), {{match}} shorthand, trimStrings, {{user}} macro expansion, substituteRegex
// ESCAPED mode, regex_placement gating, minDepth/maxDepth gating, markdownOnly/promptOnly/
// runOnEdit gating, and RegexProvider LRU cache reuse.
// Usage: node tools/check-regex.js
const {
  runRegexScript,
  getRegexedString,
  regex_placement,
  substitute_find_regex,
  RegexProvider,
  regexFromString,
  sanitizeRegexMacro,
} = require("../app/src/scripts/regex.js");
const problems = [];
const ok = (cond, msg) => { if (cond) console.log("  ok:", msg); else { problems.push(msg); console.log("  FAIL:", msg); } };
const eq = (a, b, msg) => { if (a === b) console.log("  ok:", msg); else { problems.push(msg); console.log("  FAIL:", msg, `\n    got:      ${JSON.stringify(a)}\n    expected: ${JSON.stringify(b)}`); } };

console.log("1) regexFromString — /pattern/flags parsing");
ok(regexFromString("/foo/gi") instanceof RegExp, "explicit /pattern/flags form compiles");
eq(regexFromString("/foo/gi").flags, "gi", "flags preserved");
ok(regexFromString("plainstring") instanceof RegExp, "bare pattern (no slashes) also compiles");
eq(String(regexFromString("/foo/ZZZ")), "/\\/foo\\/ZZZ/", "invalid flags fall back to RegExp(input) (literal whole-string match), matching ST's regexFromString");

console.log("2) sanitizeRegexMacro — metacharacter escaping");
eq(sanitizeRegexMacro("a.b*c"), "a\\.b\\*c", "dot and star escaped");
eq(sanitizeRegexMacro("plain"), "plain", "no metacharacters passes through unchanged");
eq(sanitizeRegexMacro("line\nbreak"), "line\\nbreak", "newline escaped to \\n literal");

console.log("3) runRegexScript — capture groups");
const s1 = { findRegex: "/(\\w+)@(\\w+)/", replaceString: "$2-$1", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(runRegexScript(s1, "contact foo@bar now"), "contact bar-foo now", "numbered capture groups ($1, $2)");

const s2 = { findRegex: "/(?<key>\\w+)=(?<val>\\d+)/", replaceString: "$<val>:$<key>", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(runRegexScript(s2, "count=42 here"), "42:count here", "named capture groups ($<name>)");

console.log("4) {{match}} shorthand = whole match");
const s3 = { findRegex: "/\\d+/", replaceString: "[{{match}}]", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(runRegexScript(s3, "roll 7 now"), "roll [7] now", "{{match}} resolves to the whole matched substring");

console.log("5) trimStrings");
const s4 = { findRegex: "/###(.*?)###/", replaceString: "$1", trimStrings: ["."], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(runRegexScript(s4, "###a.b.c###"), "abc", "trimStrings literal characters stripped from the match before insertion");

console.log("6) {{user}} macro expansion (engine convention via text-utils subUser)");
const s5 = { findRegex: "/hero/", replaceString: "{{user}}", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(runRegexScript(s5, "the hero runs", { macros: { user: "Wren" } }), "the Wren runs", "{{user}} expands via macros.user");
eq(runRegexScript(s5, "the hero runs"), "the the hero runs", "no macros supplied -> subUser's neutral fallback ('the hero') — documented behavior");

console.log("7) substituteRegex modes");
const s6 = { findRegex: "{{user}}", replaceString: "FOUND", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.RAW };
eq(runRegexScript(s6, "Wren runs", { macros: { user: "Wren" } }), "FOUND runs", "RAW mode: findRegex macro-expanded as-is (plain substring match)");

const s7 = { findRegex: "{{user}}", replaceString: "FOUND", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.ESCAPED };
eq(runRegexScript(s7, "a.b runs", { macros: { user: "a.b" } }), "FOUND runs", "ESCAPED mode: macro value regex-escaped, so 'a.b' matches literally (dot not treated as wildcard)");
eq(runRegexScript(s7, "axb runs", { macros: { user: "a.b" } }), "axb runs", "ESCAPED mode: 'a.b' does NOT match 'axb' (proves escaping is real, not just RAW)");

console.log("8) disabled / invalid scripts degrade gracefully");
const s8 = { findRegex: "/foo/", replaceString: "bar", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, disabled: true };
eq(runRegexScript(s8, "foo"), "foo", "disabled script leaves string unchanged");
const s9 = { findRegex: "/(/", replaceString: "bar", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(runRegexScript(s9, "foo"), "foo", "invalid regex (throws on compile) leaves string unchanged, no throw");

console.log("9) getRegexedString — placement gating");
const scripts = [
  { scriptName: "ai-only", findRegex: "/X/", replaceString: "Y", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, promptOnly: true },
  { scriptName: "user-only", findRegex: "/A/", replaceString: "B", trimStrings: [], placement: [regex_placement.USER_INPUT], substituteRegex: substitute_find_regex.NONE, promptOnly: true },
];
eq(getRegexedString("X and A", regex_placement.AI_OUTPUT, { scripts, isPrompt: true }), "Y and A", "AI_OUTPUT placement runs only the ai-only script");
eq(getRegexedString("X and A", regex_placement.USER_INPUT, { scripts, isPrompt: true }), "X and B", "USER_INPUT placement runs only the user-only script");

console.log("10) markdownOnly / promptOnly mutual exclusion");
const s10 = { scriptName: "md", findRegex: "/M/", replaceString: "N", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, markdownOnly: true };
eq(getRegexedString("M", regex_placement.AI_OUTPUT, { scripts: [s10], isMarkdown: true, isPrompt: false }), "N", "markdownOnly script runs when isMarkdown=true");
eq(getRegexedString("M", regex_placement.AI_OUTPUT, { scripts: [s10], isMarkdown: false, isPrompt: true }), "M", "markdownOnly script does NOT run when isPrompt=true (isMarkdown=false)");
const s11 = { scriptName: "prompt", findRegex: "/P/", replaceString: "Q", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, promptOnly: true };
eq(getRegexedString("P", regex_placement.AI_OUTPUT, { scripts: [s11], isMarkdown: false, isPrompt: true }), "Q", "promptOnly script runs when isPrompt=true");
eq(getRegexedString("P", regex_placement.AI_OUTPUT, { scripts: [s11], isMarkdown: true, isPrompt: false }), "P", "promptOnly script does NOT run when isMarkdown=true");
const s12 = { scriptName: "neither", findRegex: "/R/", replaceString: "S", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(getRegexedString("R", regex_placement.AI_OUTPUT, { scripts: [s12], isMarkdown: true, isPrompt: true }), "R", "script with neither only-flag does NOT run when input is both markdown AND prompt (matches ST's rule)");
eq(getRegexedString("R", regex_placement.AI_OUTPUT, { scripts: [s12], isMarkdown: false, isPrompt: false }), "S", "script with neither only-flag runs when input is neither markdown nor prompt");

console.log("11) runOnEdit gating");
const s13 = { scriptName: "edit", findRegex: "/E/", replaceString: "F", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, runOnEdit: false, promptOnly: true };
eq(getRegexedString("E", regex_placement.AI_OUTPUT, { scripts: [s13], isPrompt: true, isEdit: true }), "E", "runOnEdit=false script skipped when isEdit=true");
eq(getRegexedString("E", regex_placement.AI_OUTPUT, { scripts: [s13], isPrompt: true, isEdit: false }), "F", "runOnEdit=false script still runs when isEdit=false");

console.log("12) minDepth / maxDepth gating");
const s14 = { scriptName: "depth", findRegex: "/D/", replaceString: "H", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, minDepth: 2, maxDepth: 4, promptOnly: true };
eq(getRegexedString("D", regex_placement.AI_OUTPUT, { scripts: [s14], isPrompt: true, depth: 1 }), "D", "depth below minDepth -> skipped");
eq(getRegexedString("D", regex_placement.AI_OUTPUT, { scripts: [s14], isPrompt: true, depth: 3 }), "H", "depth within window -> runs");
eq(getRegexedString("D", regex_placement.AI_OUTPUT, { scripts: [s14], isPrompt: true, depth: 5 }), "D", "depth above maxDepth -> skipped");

console.log("13) RegexProvider LRU cache + lastIndex reset");
const provider = RegexProvider.instance;
const r1 = provider.get("/z/g");
ok(r1 instanceof RegExp, "cache returns a compiled regex");
eq(provider.get("/z/g"), r1, "same key returns the same cached instance (no recompile)");
r1.lastIndex = 5;
provider.get("/z/g"); // touch again
eq(r1.lastIndex, 0, "global regex's lastIndex reset to 0 on cache hit (prevents skipped matches on reuse)");
const s15 = { findRegex: "/a/g", replaceString: "-", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE };
eq(runRegexScript(s15, "aaa"), "---", "global regex replaces all matches on first run");
eq(runRegexScript(s15, "aaa"), "---", "global regex still replaces all matches on second run (cache reuse doesn't break it)");

console.log("14) multiple scripts chain in order");
const chain = [
  { scriptName: "one", findRegex: "/1/g", replaceString: "a", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, promptOnly: true },
  { scriptName: "two", findRegex: "/a/g", replaceString: "b", trimStrings: [], placement: [regex_placement.AI_OUTPUT], substituteRegex: substitute_find_regex.NONE, promptOnly: true },
];
eq(getRegexedString("111", regex_placement.AI_OUTPUT, { scripts: chain, isPrompt: true }), "bbb", "scripts run in array order (1->a then a->b)");

if (problems.length) { console.log("\nPROBLEMS: " + problems.join(" | ")); process.exit(1); }
console.log("\nREGEX OK");
