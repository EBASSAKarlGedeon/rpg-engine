// Temporary live test for rpge-patch 017 (Loreweaver image bridge) against the
// deployed module on the running Loreweaver server. One real image generation
// is spent (cheap OpenRouter image model).
// Run: node tools/imgbridge-test.js
import { chromium } from 'playwright';

const APP_URL = 'http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html';
const MOD_URL = 'http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/src/scripts/image-provider.js';
const PROFILE_ID = '432b3e02-09e4-4bf0-a93c-662c9f8d5f7c'; // "Openrouter" profile (works)

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.addInitScript(() => {
  localStorage.setItem('rpge.loreweaverBridge', JSON.stringify({ enabled: true, profileId: '__PROFILE__', usePreset: true, roles: {} }));
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver', providers: { loreweaver: { model: 'recraft/recraft-v4.1-flash-v2:free' } } }));
  window.__apiCalls = [];
  const orig = window.LoreweaverBridge; // not yet defined here; wrapped after load below
});
await page.goto(APP_URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.LoreweaverBridge && window.LoreweaverBridge.isEnabled(), undefined, { timeout: 60000 });

// Wrap bridge.api to log calls (keep real behavior)
await page.evaluate(() => {
  const b = window.LoreweaverBridge;
  const orig = b.api.bind(b);
  b.api = async (p, body) => {
    window.__apiCalls.push({ path: p, body });
    return orig(p, body);
  };
});

const results = await page.evaluate(async (MOD_URL) => {
  const m = await import(MOD_URL);
  const out = [];
  const cfg0 = m.getImageConfig();
  out.push(['config-provider-loreweaver', cfg0.provider === 'loreweaver']);
  out.push(['active-loreweaver', m.activeImageProvider() === 'loreweaver']);
  out.push(['close-blocker-null', m.imageCloseBlocker() === null]);
  // free probe: server key valid, no generation spent
  const t = await m.testImageConnection('', '', 'loreweaver');
  out.push(['test-connection-true', t === true]);
  const ms = await m.loreweaverImageModels();
  out.push(['models-list-real', Array.isArray(ms) && ms.length > 0 && ms.every(x => x.value && typeof x.value === 'string')]);
  // stored perchance choice respected (no bridge-dependent default clobbering)
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'perchance' }));
  out.push(['stored-perchance-respected', m.getImageConfig().provider === 'perchance' && m.activeImageProvider() === 'perchance']);
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver', providers: { loreweaver: { model: 'recraft/recraft-v4.1-flash-v2:free' } } }));
  // bridge down → active falls back, close blocker blocks, generation throws
  window.LoreweaverBridge.isEnabled = () => false;
  out.push(['active-falls-back', m.activeImageProvider() === 'perchance']);
  out.push(['close-blocker-blocks', !!m.imageCloseBlocker()]);
  let threw = false;
  try { await m.routedGenImage('x', { route: 'portraits' }); } catch (e) { threw = /not connected|not available/i.test(e.message); }
  out.push(['bridge-down-throws', threw]);
  window.LoreweaverBridge.isEnabled = () => true;
  // route off → Perchance fallback path (under Loreweaver the built-in rejects)
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver', useExternal: { portraits: false }, providers: { loreweaver: { model: 'recraft/recraft-v4.1-flash-v2:free' } } }));
  let offRej = false;
  try { await m.routedGenImage('off', { route: 'portraits' }); } catch (e) { offRej = /not available here/i.test(e.message); }
  out.push(['route-off-perchance-path', offRej]);
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver', providers: { loreweaver: { model: 'recraft/recraft-v4.1-flash-v2:free' } } }));
  // ONE real generation through the server (server-held OpenRouter key)
  const r = await m.routedGenImage('portrait of a weathered knight in simple armor, warm lamp light, painterly style', { route: 'portraits' });
  out.push(['real-gen-dataurl', !!r && typeof r.dataUrl === 'string' && r.dataUrl.startsWith('data:image/') && r.dataUrl.length > 5000]);
  out.push(['real-gen-provider-tag', r.provider === 'loreweaver']);
  const calls = window.__apiCalls;
  out.push(['gen-call-logged', calls.some(c => c.path === '/api/openrouter/image/generate' && c.body.model === 'recraft/recraft-v4.1-flash-v2:free' && c.body.aspect_ratio === '1:1')]);
  // aspect mapping still purely client-side: check landscape body shape with a cheap re-call? no — logged above for 1:1 only.
  return { out, ms, len: r && r.dataUrl ? r.dataUrl.length : 0 };
}, MOD_URL);

let pass = 0;
for (const [name, ok] of results.out) { console.log(ok ? 'PASS' : 'FAIL', name); if (ok) pass++; }
console.log('model count:', results.ms.length, '| first models:', results.ms.slice(0, 5).map(x => x.value).join(', '));
console.log('dataUrl length:', results.len);
console.log(`== ${pass}/${results.out.length} passed ==`);
await page.screenshot({ path: 'C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/f070-imgbridge.png' });
await browser.close();
process.exit(pass === results.out.length ? 0 : 1);
