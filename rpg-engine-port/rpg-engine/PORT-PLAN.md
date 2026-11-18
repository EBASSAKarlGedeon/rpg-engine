# RPG Engine port: plan for you and the coding model

This replaces the "rebuild from scratch" idea as the main route. It is based on the real generator source (the MNO RPG Engine files you downloaded), not on guesses from screenshots. Everything marked **TESTED** was run in headless Chromium against a fake AI server. Everything marked **VERIFY** has not been run on a real SillyTavern and must be checked by whoever installs it.

## 0. The short version

1. **The generator already supports your own API.** In Settings > AI Model the provider list is Perchance AI, OpenAI, DeepSeek, OpenRouter and Ollama (local). "OpenAI" accepts any OpenAI-compatible Base URL. You can also switch each kind of call (story, skill checks, trackers, memories, ...) on or off for the external model. Whatever is switched off falls back to the "Perchance AI" slot.
2. **Its source runs outside Perchance with a small shim layer.** This package contains that layer. **TESTED:** the app boots, the Worlds page renders, the hero wizard works, an opening scene and a player turn run end to end, NPC bubbles and tracker bars render, and calls are routed to two different models.
3. **A SillyTavern overlay wrapper is included** (`manifest.json`, `index.js`, `style.css`). **TESTED** only against a stand-in page. **VERIFY** on real SillyTavern (section 4, P3).
4. The old `PLAN.md` (from-scratch rebuild) is now only the fallback. Its prompt design is different from how the real engine works; see section 7.

### Which path to take

| Path | What you do | Effort | Good for |
|---|---|---|---|
| 0. Use it as hosted | Open the generator on its own site, Settings > AI Model, pick OpenRouter / DeepSeek / OpenAI-compatible, paste a key | minutes | Trying your favourite model today |
| 1. This port | Run the same code locally or inside SillyTavern (sections 3 and 4) | an hour or two | A local copy under your control, custom prompts, ST overlay |
| 2. Rebuild | Write original code from `PLAN.md` | days | Publishing something of your own |

Recommendation: do Path 0 first to confirm the feel with your model. Then Path 1 if you want it inside SillyTavern or fully local.

## 1. How the real engine works (read from the source)

### 1.1 What happens on one turn (observed in my test, two turns)

| Call | Route name in Settings | Max output tokens | Notes |
|---|---|---|---|
| Skill-check referee | Skill checks | 120 | Only when stat checks are on and the action is risky |
| Scene manager ("staging") | Scene manager | 120 | Decides who is in the scene |
| **GM narration** | GM | 2000 | The story. Streamed |
| Hero tracker | Trackers | 750 | Rewrites the `[TRACKERS]` block (HP, gold, ...) |
| NPC tracker | Trackers | 658 | Per-character tracked state |
| Location phrase | NPC generation | 24 | Used for portrait backdrops |
| Map call | Other | 320 | First turn and when the location changes |
| Memory roll-up, NPC life ticks | Memories, NPC life sim | | Every few turns; not seen in a 2-turn test |

Rough size, from the characters sent in my test (characters divided by 4, bundled "Goddess Reborn" world, early turns): the GM call was about 4,000 to 5,200 tokens in, the trackers about 1,400 each, the scene manager and referee about 700 each, the map call about 1,900. A whole turn was about 10,000 input tokens and a few hundred output tokens. **These are estimates from a mock run, not real billing numbers.** With the cheap-model setup (P2) only the GM and map calls use the main model.

### 1.2 The narrator prompt and output format

`src/scripts/narrator-prompt.md` is a plain text file fetched at runtime. The GM does **not** answer in JSON. It writes prose paragraphs and tags dialogue:

```
[Name] "spoken line"
[Name inner] private thought (optional, no quotes)
[[NPC: Name | 1-3 sentence description]]   <- asks the engine to create a profile
```

`parseGmOutput` in `rp-engine.js` turns these into narrator paragraphs, NPC bubbles with portraits, and thought bubbles. State (HP, gold, mood, ...) is **not** written by the story model: a separate small call writes a `[TRACKERS]` block of `key: value` lines, and a failed call keeps the previous values. That separation is why cheap models can still look good: each call has a narrow job.

### 1.3 What the GM sees (context order)

Instructions, narrative vibe, world premise, starting scenario (first 20 turns), character sheet and attributes, tracked state, relevant lore (keyword plus local embedding search), latest situation, open threads, memories (only those owned by NPCs in the scene), distant-past digest, NPC profiles in three tiers, NPC tracked state, surroundings (map), the last 10 turns, then the new action. Static parts come first so providers that cache prefixes can reuse them. Full detail: `src/README.md` section 6.2.

### 1.4 Where to read more

| Topic | `src/README.md` section | Main source file |
|---|---|---|
| World JSON format (lore, trackers, stats, NPCs) | 4 | `world.js`, `game/templates/*.json` |
| Turn model, re-rolls, edits | 5 | `main.js` |
| Context construction | 6.2 | `rp-engine.js` |
| Trackers | 6.3, 6.3.1 | `trackers.js` |
| Stats and skill checks | 6.4 | `stats.js` |
| Memory | 6.5 | `memory-system.js` |
| NPCs and offscreen life | 6.6 | `npc-system.js`, `npc-life.js` |
| Lorebook | 6.7 | `lorebook.js`, `bm25.js`, `embeddings.js` |
| Map | 6.8 | `map-system.js` |
| Settings, backup | 6.15, 6.16 | `ai-provider.js`, `backup.js` |

## 2. The package

```
rpg-engine/                      <- this is the SillyTavern extension folder
  manifest.json  index.js  style.css      SillyTavern wrapper (overlay + iframe)
  app/
    index.html                           replaces the platform's HTML shell
    cheap-model.html                     tiny settings page for the second model
    shims/perchance-shim.js              stand-ins for the platform plugins (storage, AI, stubs)
    shims/tweaks.js                      hides community-only UI (Explore, Tavern, Identity, Admin)
    src/                                 <- YOU COPY the generator's `src` contents here (not included)
  tools/                                 tests (mock AI server, boot, e2e, tweaks, overlay)
  PORT-PLAN.md  README.md  package.json
```

`src/` is deliberately **not** included and is never edited, so a newer copy from the author can be dropped in later (section 6).

### What the shim provides (the contract with the app)

The app reads these globals off `root` (see `src/scripts/boot.js`): `generateText`, `generateImage`, `kv`, `uploadPlugin`, `createServerSocket`, `commentsPlugin`, `copyTextPlugin`, `communityResLib`, `$meta`.

- `kv`: IndexedDB folders `rpg`, `worlds`, `community`, `embvec` with `get set has delete keys values entries clear getMany setMany deleteMany update`. All saves live here.
- `generateText`: the "Perchance AI" slot. Here it is an optional second OpenAI-compatible model (P2). With no second model configured it fails with a clear message, so keep every route on your main provider.
- `generateImage`: not available; use Settings > Image Gen with your own provider.
- upload, server socket, comments: offline stubs. Community features (Explore, publishing, Tavern) fail quietly and are hidden by `tweaks.js`. The app logs one harmless `offline` error and two 404s for the hosting platform's view counter.

## 3. Run it on its own (no SillyTavern)

1. Copy the generator's `src` contents into `app/src/`, so that `app/src/scripts/main.js` exists.
2. From this folder: `python3 -m http.server 8765 --bind 127.0.0.1 --directory app`
3. Open `http://127.0.0.1:8765/index.html`. Open Settings > AI Model, choose a provider, paste a key (see P1).

File URLs do not work: the app uses ES modules and needs `http://`.

## 4. Milestones

Do them in order. After each one, run its check and stop for review.

**P0. Boot.** Done in my environment. Check: `npm i -D playwright` (needs network), start the server, then `node tools/boot-test.js http://127.0.0.1:8765/index.html` prints `BOOT OK`.

**P1. Connect your model.** In the app: Settings > AI Model.
- OpenRouter, DeepSeek: pick the preset, paste the key, set the model id.
- Any other OpenAI-compatible service (GLM, Gemini compatibility endpoints, a local server): choose "OpenAI", edit the Base URL and model. The Base URL must end where `/chat/completions` can be appended.
- Use "Test connection". If the browser reports a network error, the provider probably blocks browser requests (CORS). Then use an OpenRouter-style service, or P7.
- Leave "Allow reasoning" off unless your model needs it; thinking text counts as cost.
- Check: play five turns, confirm the story streams, trackers update, no red error toasts. Note the token usage in your provider dashboard.

**P2. Cheap second model for background calls.** **TESTED with the mock.**
1. Open `app/cheap-model.html` (same origin as the app), fill Base URL, key and model, Save, Test.
2. In the app: Settings > AI Model, switch OFF the routes to run cheaply: Trackers, Scene manager, Skill checks, and optionally Memories and NPC life sim. Keep GM on.
3. Check: `node tools/mock-llm.js /tmp/rpge-mock.log` and `node tools/e2e.js http://127.0.0.1:8765/index.html /tmp/rpge-mock.log .` end with `E2E OK`. It proves GM calls use the main model and tracker/scene/check calls use the cheap one.
4. In real use: if the cheap model writes malformed tracker blocks, the app keeps the previous values, so the worst case is stale numbers. Watch for that in the first few turns.

**P3. SillyTavern overlay.** Install: copy this whole folder (with `app/src/` filled in) to `SillyTavern/public/scripts/extensions/third-party/rpg-engine/` (or your user-scoped extensions folder), restart SillyTavern. Open it from the Extensions (wand) menu entry "RPG Engine" or the small round button at the bottom left. **VERIFY each of these on the real app:**
- The folder path and that SillyTavern serves `/scripts/extensions/third-party/rpg-engine/app/index.html` (open that URL directly).
- The menu id is `#extensionsMenu`; if the entry is missing, the floating button still works.
- The overlay sits above SillyTavern's own popups (z-index 30000 in `style.css`).
- `index.js` is loaded as a module (it uses `import.meta.url`, with a fallback).
- Data origin: storage belongs to SillyTavern's origin (scheme + host + port). Changing from `localhost` to `127.0.0.1` or to a LAN address shows an empty app. Use Settings > Data & Backup to export and import.
- Check: open, start an adventure, close the overlay while a turn is streaming, reopen it: the turn finished. Reload SillyTavern: the adventure is still listed.
- `node tools/check-overlay.js http://127.0.0.1:8767/tools/fake-st.html` passes against the stand-in page (serve the folder root on port 8767).

**P4. Hide platform-only UI.** Done in `tweaks.js` (**TESTED**: `node tools/check-tweaks.js ...`). It hides Explore, Tavern, Identity, Admin, the platform counters, and the Explore column of the welcome banner. Remaining platform text is harmless.

**P5. Backup habit.** Settings > Data & Backup > Download full backup. The app also asks the browser for persistent storage; allow it. Test an export, clear site data, import, and confirm the adventure returns.

**P6. Make it feel like your game.** No code needed:
- `app/src/scripts/narrator-prompt.md`: the GM's rules. To get the "one exact sentence or action per character" feel, tighten the Hard Rules, for example: at most one short line per NPC per turn, one action beat per NPC, a few short paragraphs, a banned-phrase list. After editing, hard-reload (the file is fetched at runtime and may be cached).
- Worlds are single JSON files (`game/templates/*.json`, format in README section 4). The "internal states" idea from your SillyTavern preset maps to `trackers` (hero) and `npcTrackers` (per character), including numeric bars with a `max`.
- `scripts/banned-words.js` only affects AI-invented names. Stale-phrase bans belong in the narrator prompt.
- Sampling sliders are under Settings > AI Model > Advanced ("Custom parameters").
- Check: change one rule, play two turns, confirm the behaviour changed; revert if worse.

**P7. Optional: use SillyTavern's own connection.** Goal: no CORS limits and no second place for keys. Idea: change the `generateText` shim (or add a route) to call SillyTavern's server-side chat-completion endpoint with the keys stored in SillyTavern. **VERIFY** the endpoint and request shape against your SillyTavern version first; it is an internal API and changes between releases. Do not start this before P1 to P3 pass.

**P8. Optional: images.** Settings > Image Gen supports OpenAI and OpenRouter image models with your key. No shim work needed. Check by generating one NPC portrait.

## 5. Costs: knobs, in order of effect

1. Put Trackers, Scene manager, Skill checks, Memories and NPC life sim on a cheap model (P2).
2. Turn off "Simulate NPC life" and "Stat check" in the Story tab when you do not need them. Each removes calls.
3. Reduce history and lore budgets in `rp-engine.js` only if you must (`RECENT_TURNS` is 10). That is code; prefer the settings above.
4. Leave reasoning off.

## 6. Updating when the author updates

Replace `app/src/` with the new files. Then run `tools/boot-test.js`, `tools/e2e.js` and `tools/check-tweaks.js`. Things that can break: a new global on `root` (add a stub in `perchance-shim.js`), a new `kv` method (add it to `makeFolder`), new platform-only menu items (extend `tweaks.js`), changed route names (the `e2e.js` assertions use the names Trackers, Scene manager, Skill checks).

## 7. Errata for `PLAN.md` (the from-scratch rebuild)

If you ever choose Path 2, follow the real engine, not `PLAN.md` section 6:
- Use tagged prose (`[Name] "..."`, `[Name inner]`, `[[NPC: Name | ...]]`) for the story call instead of one JSON object.
- Keep state in a separate small "tracker" call that outputs `key: value` lines, and keep the previous values when it fails.
- Use the call table in section 1.1 as the pipeline. Memory ownership (NPCs only know what they witnessed) and the three-tier NPC profile feed are the two ideas worth copying.
- Appendices A to D of `PLAN.md` (screens, colors, layout) remain accurate for the UI.

## 8. Credit and licensing

The files you sent include no license text for the code. The generator is the author's work (credited in its footer as "by mnomno"). This package contains only my own files (shim, wrapper, tests) and leaves the author's code untouched and out of the package. Using it privately is one thing; if you plan to publish a fork or a modified copy, ask the author first and keep their credit. Path 2 avoids the question.

## 9. Test commands (all need Playwright installed locally)

```
python3 -m http.server 8765 --bind 127.0.0.1 --directory app     # app
python3 -m http.server 8767 --bind 127.0.0.1                     # extension root, for the overlay test
node tools/mock-llm.js /tmp/rpge-mock.log                         # fake AI server on :8766
node tools/boot-test.js     http://127.0.0.1:8765/index.html
node tools/check-tweaks.js  http://127.0.0.1:8765/index.html
node tools/e2e.js           http://127.0.0.1:8765/index.html /tmp/rpge-mock.log .
node tools/check-overlay.js http://127.0.0.1:8767/tools/fake-st.html
```
