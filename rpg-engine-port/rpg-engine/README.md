# RPG Engine (SillyTavern wrapper + local port)

A local copy of the MNO RPG Engine generator that runs outside Perchance, with your own AI provider, plus a SillyTavern extension that opens it as a full-screen overlay.

**Not included:** the generator's own `src/` folder. Copy its contents into `app/src/` so that `app/src/scripts/main.js` exists. Credit and licensing notes: PORT-PLAN.md section 8.

## Quick start (no SillyTavern)

```
python3 -m http.server 8765 --bind 127.0.0.1 --directory app
```

Open http://127.0.0.1:8765/index.html, then Settings > AI Model, choose a provider and paste a key.

## Install in SillyTavern

Copy this whole folder (with `app/src/` filled in) to `SillyTavern/public/scripts/extensions/third-party/rpg-engine/`, restart SillyTavern, and open "RPG Engine" from the Extensions (wand) menu or the small round button at the bottom left. Not yet verified on a real SillyTavern: see PORT-PLAN.md, milestone P3.

## Files

| File | Purpose |
|---|---|
| `PORT-PLAN.md` | The full plan, milestones and checks. Start here. |
| `manifest.json`, `index.js`, `style.css` | SillyTavern wrapper |
| `app/index.html` | HTML shell for the generator |
| `app/shims/perchance-shim.js` | Stand-ins for the Perchance plugins (storage, AI, stubs) |
| `app/shims/tweaks.js` | Hides community-only UI |
| `app/cheap-model.html` | Settings for an optional cheaper second model |
| `tools/` | Test scripts and a fake AI server |
