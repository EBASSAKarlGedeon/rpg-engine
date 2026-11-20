// [rpge-patch 021] Regex engine — a self-contained port of Loreweaver's
// `public/scripts/extensions/regex/engine.js`. That file reaches into ST globals the engine
// doesn't have (`script.js`'s `substituteParams`, `extensions.js` `extension_settings`,
// `preset-manager.js`, `lodash`), so this port keeps the *behavior* (LRU regex cache, `/pattern/`
// string parsing, `{{match}}`/`$1`/`$<name>` group refs, `trimStrings`, the markdownOnly/promptOnly
// + depth + placement gate) and swaps the surroundings for engine-native ones:
//
//  - Scripts come in as a plain `scripts[]` argument to `getRegexedString` (ST's storage layer —
//    `extension_settings.regex`, character-scoped, preset-scoped — is deliberately NOT ported;
//    the engine manages its own script storage in a later patch, so this module stays pure JS,
//    no DOM, unit-testable in plain Node).
//  - Macro expansion uses the engine's own `{{user}}` convention (`subUser` from text-utils.js,
//    which resolves the hero's name) instead of ST's full `substituteParams` macro universe.
//
// Everything else — RegexProvider's LRU + lastIndex reset, regexFromString's flag-validation
// fallback, sanitizeRegexMacro's escape set, runRegexScript's replacement semantics — is ported
// faithfully so the same script definition behaves identically here and in ST.
//
// Usage (e.g. before rendering a message, or before handing text to the GM):
//   import { getRegexedString, regex_placement } from "./regex.js";
//   const clean = getRegexedString(raw, regex_placement.AI_OUTPUT, { scripts: myScripts, isPrompt: true });

import { subUser } from "./text-utils.js";

/**
 * @typedef {object} RegexScript
 * @property {string} scriptName
 * @property {string} findRegex - `/pattern/flags` string or bare pattern
 * @property {string} replaceString - replacement; supports `{{match}}`, `$1`, `$<name>` group refs
 * @property {string[]} trimStrings - literal strings to strip from each match before inserting
 * @property {number[]} placement - array of regex_placement values where this script applies
 * @property {boolean} [markdownOnly] - only apply when the input is Markdown-rendered text
 * @property {boolean} [promptOnly] - only apply when the input is prompt/LLM-bound text
 * @property {boolean} [runOnEdit] - also apply when the user re-edits an existing message
 * @property {number} [minDepth] - only apply at chat depth >= this (see getRegexedString's `depth`)
 * @property {number} [maxDepth] - only apply at chat depth <= this
 * @property {number} [substituteRegex] - 0=NONE (literal findRegex), 1=RAW (macro-expand as-is),
 *   2=ESCAPED (macro-expand, then regex-escape the expansion — safe for inserting names/vars
 *   that might contain regex metacharacters like `.` or `*`)
 * @property {boolean} [disabled] - skip this script entirely
 */

/**
 * @readonly
 * @enum {number} Where a regex script should be applied (mirrors ST's regex_placement).
 */
export const regex_placement = {
    /** @deprecated MD display is deprecated upstream; kept for value parity with ST scripts. */
    MD_DISPLAY: 0,
    USER_INPUT: 1,
    AI_OUTPUT: 2,
    SLASH_COMMAND: 3,
    WORLD_INFO: 5,
    REASONING: 6,
};

/**
 * @readonly
 * @enum {number} How to expand macros in `findRegex` before compiling it.
 */
export const substitute_find_regex = {
    NONE: 0,
    RAW: 1,
    ESCAPED: 2,
};

/**
 * Expand the engine's known macros in `text`. Currently only `{{user}}` (the hero's name) is
 * supported — ST's full macro list (`{{char}}`, `{{random:…}}`, dice, etc.) isn't ported since
 * the engine's own text-utils convention only defines `{{user}}`. Unknown `{{…}}` macros are left
 * as-is (visible literal text) rather than silently dropped, so a script author can see what
 * didn't resolve. `macros` lets a caller override/extend this (e.g. inject `{{char}}` for a
 * specific NPC name in a call site that knows one).
 */
function expandMacros(text, macros) {
    let out = String(text == null ? "" : text);
    if (macros && typeof macros === "object") {
        for (const [key, value] of Object.entries(macros)) {
            out = out.split("{{" + key + "}}").join(String(value == null ? "" : value));
        }
    }
    return subUser(out, (macros && macros.user) || undefined);
}

/**
 * Parse a `/pattern/flags` string (or a bare pattern) into a RegExp. Ported verbatim from
 * `public/scripts/utils.js` `regexFromString` — invalid flag strings fall back to `RegExp(input)`
 * rather than throwing, and a syntax error anywhere returns undefined (caller treats as "skip").
 */
export function regexFromString(input) {
    try {
        const m = input.match(/(\/?)(.+)\1([a-z]*)/i);
        if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) {
            return RegExp(input);
        }
        return new RegExp(m[2], m[3]);
    } catch {
        return undefined;
    }
}

/**
 * Regex-escape a macro-expanded string so it can be safely embedded in a pattern (used by the
 * ESCAPED substitute mode). Ported verbatim from `sanitizeRegexMacro` in ST's regex engine.js.
 */
export function sanitizeRegexMacro(x) {
    return (x && typeof x === "string")
        ? x.replaceAll(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, function (s) {
            switch (s) {
                case "\n": return "\\n";
                case "\r": return "\\r";
                case "\t": return "\\t";
                case "\v": return "\\v";
                case "\f": return "\\f";
                case "\0": return "\\0";
                default: return "\\" + s;
            }
        })
        : x;
}

/**
 * Compiled-regex cache with LRU eviction, ported verbatim from `RegexProvider` in ST's regex
 * engine.js (private fields + a singleton `.instance`). Resets `lastIndex` on global/sticky
 * regexes so repeated `.replace()` calls don't silently skip matches on the second run.
 */
export class RegexProvider {
    /** @type {Map<string, RegExp>} */
    #cache = new Map();
    /** @type {number} */
    #maxSize = 1000;

    static instance = new RegexProvider();

    /**
     * @param {string} regexString
     * @returns {RegExp?} Compiled regex, or null if invalid (mirrors ST's null-on-invalid contract).
     */
    get(regexString) {
        const isCached = this.#cache.has(regexString);
        const regex = isCached ? this.#cache.get(regexString) : regexFromString(regexString);

        if (!regex) {
            return null;
        }

        if (isCached) {
            // LRU: Move to end by re-inserting
            this.#cache.delete(regexString);
            this.#cache.set(regexString, regex);
        } else {
            // Evict oldest if at capacity
            if (this.#cache.size >= this.#maxSize) {
                const firstKey = this.#cache.keys().next().value;
                this.#cache.delete(firstKey);
            }
            this.#cache.set(regexString, regex);
        }

        // Reset lastIndex for global/sticky regexes
        if (regex.global || regex.sticky) {
            regex.lastIndex = 0;
        }

        return regex;
    }

    clear() {
        this.#cache.clear();
    }
}

/**
 * Remove `trimStrings` (each macro-expanded first, then literally replaced away) from a match.
 * Ported faithfully from `filterString` in ST's regex engine.js.
 */
function filterString(rawString, trimStrings, macros) {
    let finalString = rawString;
    (Array.isArray(trimStrings) ? trimStrings : []).forEach((trimString) => {
        const subTrimString = expandMacros(trimString, macros);
        finalString = finalString.replaceAll(subTrimString, "");
    });
    return finalString;
}

/**
 * Run a single regex script's find/replace over `rawString`. Ported faithfully from
 * `runRegexScript` in ST's regex engine.js: `{{match}}` in `replaceString` becomes `$0`
 * (whole match), `$1`/`$<name>` become capture-group references (each passed through
 * `trimStrings` filtering before insertion), and the assembled replacement is macro-expanded
 * as a final step.
 *
 * @param {RegexScript} regexScript
 * @param {string} rawString
 * @param {{macros?: Record<string,string>}} [params] - extra macros for expandMacros (e.g. `{ user: "Wren" }`)
 * @returns {string} The transformed string (unchanged if the script is disabled/invalid).
 */
export function runRegexScript(regexScript, rawString, params = {}) {
    const macros = params.macros;
    let newString = rawString;
    if (!regexScript || !!regexScript.disabled || !regexScript?.findRegex || !rawString) {
        return newString;
    }

    const getRegexString = () => {
        switch (Number(regexScript.substituteRegex)) {
            case substitute_find_regex.NONE:
                return regexScript.findRegex;
            case substitute_find_regex.RAW:
                return expandMacros(regexScript.findRegex, macros);
            case substitute_find_regex.ESCAPED:
                return sanitizeRegexMacro(expandMacros(regexScript.findRegex, macros));
            default:
                console.warn(`runRegexScript: Unknown substituteRegex value ${regexScript.substituteRegex}. Using raw regex.`);
                return regexScript.findRegex;
        }
    };
    const regexString = getRegexString();
    const findRegex = RegexProvider.instance.get(regexString);

    // Invalid regex — return unchanged rather than throwing (matches ST's behavior).
    if (!findRegex) {
        return newString;
    }

    newString = rawString.replace(findRegex, function (match) {
        const args = [...arguments];
        const replaceString = regexScript.replaceString.replace(/{{match}}/gi, "$0");
        const replaceWithGroups = replaceString.replaceAll(/\$(\d+)|\$<([^>]+)>/g, (_, num, groupName) => {
            if (num) {
                // Numbered capture group ($1, $2, …)
                match = args[Number(num)];
            } else if (groupName) {
                // Named capture group ($<name>)
                const groups = args[args.length - 1];
                match = groups && typeof groups === "object" ? groups[groupName] : undefined;
            }
            if (!match) {
                return "";
            }
            return filterString(match, regexScript.trimStrings, macros);
        });

        return expandMacros(replaceWithGroups, macros);
    });

    return newString;
}

/**
 * Run every applicable script from `scripts` over `rawString`, gated by `placement` (which
 * `regex_placement` slot this text is being prepared for), `isMarkdown`/`isPrompt` (the
 * markdownOnly/promptOnly mutual-exclusion rule), `isEdit` (runOnEdit gate), and `depth`
 * (minDepth/maxDepth window). Ported faithfully from `getRegexedString` in ST's regex engine.js,
 * except ST pulls the script list from `extension_settings.regex` + character/preset-scoped
 * storage — here the caller passes `scripts` in directly (see module header).
 *
 * @param {string} rawString
 * @param {number} placement - a regex_placement value
 * @param {{scripts?: RegexScript[], macros?: Record<string,string>, isMarkdown?: boolean,
 *          isPrompt?: boolean, isEdit?: boolean, depth?: number}} [params]
 * @returns {string} The transformed string.
 */
export function getRegexedString(rawString, placement, params = {}) {
    const { scripts = [], macros, isMarkdown, isPrompt, isEdit, depth } = params;
    if (typeof rawString !== "string") {
        console.warn("getRegexedString: rawString is not a string. Returning empty string.");
        return "";
    }

    let finalString = rawString;
    if (!rawString || placement === undefined) {
        return finalString;
    }

    scripts.forEach((script) => {
        if (
            // Script applies to Markdown and input is Markdown
            (script.markdownOnly && isMarkdown) ||
            // Script applies to Generate and input is Generate
            (script.promptOnly && isPrompt) ||
            // Script applies to all cases when neither "only" is true, and this input is neither
            // Markdown nor Prompt
            (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
        ) {
            if (isEdit && !script.runOnEdit) {
                return;
            }

            if (typeof depth === "number") {
                if (!isNaN(script.minDepth) && script.minDepth !== null && script.minDepth >= -1 && depth < script.minDepth) {
                    return;
                }
                if (!isNaN(script.maxDepth) && script.maxDepth !== null && script.maxDepth >= 0 && depth > script.maxDepth) {
                    return;
                }
            }

            if (script.placement.includes(placement)) {
                finalString = runRegexScript(script, finalString, { macros });
            }
        }
    });

    return finalString;
}
