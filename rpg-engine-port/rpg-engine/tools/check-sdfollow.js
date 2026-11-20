// [rpge-patch 024] SD-follow verification: the engine's follow path (UI + routing +
// request shape) against the REAL Loreweaver server with only /api/sd-follow/* and
// /api/openrouter/image/generate* mocked — zero generations spent, no server writes.
// Run: node tools/check-sdfollow.js
import { chromium } from 'playwright';

const APP_URL = 'http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html';
const MOD_URL = 'http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/src/scripts/image-provider.js';
const PROFILE_ID = '432b3e02-09e4-4bf0-a93c-662c9f8d5f7c'; // "Openrouter" profile
const SHOT = 'C:/Users/Gedeon/AppData/Local/Temp/rpge-heavy/';

// 1×1 red PNG (real decodable image)
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
page.on('pageerror', (e) => console.log('  pageerror:', e.message.slice(0, 160)));

await page.addInitScript((profileId) => {
  localStorage.setItem('rpge.loreweaverBridge', JSON.stringify({ enabled: true, profileId, usePreset: true, roles: {} }));
  localStorage.setItem('mno.imageProvider', JSON.stringify({
    provider: 'loreweaver', follow: true,
    providers: { loreweaver: { model: 'recraft/recraft-v4.1-flash-v2:free' } },
  }));
}, PROFILE_ID);

const followCalls = [];
const plainCalls = [];
await page.route('**/api/sd-follow/**', async (r) => {
  const body = r.request().postDataJSON() || {};
  if (r.request().url().includes('/status')) {
    return r.fulfill({ json: followStatusPayload });
  }
  followCalls.push(body);
  return r.fulfill({ json: { format: 'png', data: PNG_1PX } });
});
await page.route('**/api/openrouter/image/generate', async (r) => {
  plainCalls.push(r.request().postDataJSON() || {});
  return r.fulfill({ json: { format: 'png', image: PNG_1PX } });
});
let followStatusPayload = { ok: true, source: 'comfy', comfy_url: 'http://127.0.0.1:8188', workflow: 'Default_Comfy_Workflow.json', reachable: true };

await page.goto(APP_URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForFunction(() => window.LoreweaverBridge && window.LoreweaverBridge.isEnabled(), undefined, { timeout: 60000 });

const out = [];
const ok = (name, cond) => { out.push([name, !!cond]); console.log((cond ? 'ok:' : 'FAIL:'), name); };

console.log('== module: follow routing ==');
const r = await page.evaluate(async (MOD_URL) => {
  const m = await import(MOD_URL);
  const res = { calls: [] };
  res.cfg = m.getImageConfig();
  res.portrait = await m.routedGenImage('a weathered knight portrait', { route: 'portraits', resolution: '512x768', negativePrompt: 'blurry, lowres' });
  res.landscape = await m.routedGenImage('a valley scene', { route: 'scene', resolution: '768x512', negativePrompt: 'text' });
  res.square = await m.routedGenImage('a cover emblem', { route: 'other', resolution: '', negativePrompt: '' });
  return res;
}, MOD_URL);
ok('follow flag read from store', r.cfg.follow === true && r.cfg.provider === 'loreweaver');
ok('portrait call → follow endpoint', followCalls.length === 3 && !plainCalls.length);
ok('portrait body: prompt+negative+aspect', followCalls[0] && followCalls[0].prompt === 'a weathered knight portrait' && followCalls[0].negative_prompt === 'blurry, lowres' && followCalls[0].aspect === 'portrait');
ok('landscape aspect mapped', followCalls[1] && followCalls[1].aspect === 'landscape');
ok('square aspect mapped', followCalls[2] && followCalls[2].aspect === 'square');
ok('returned image decodes', await page.evaluate(async (dataUrl) => new Promise((done) => {
  const img = new Image();
  img.onload = () => done(img.complete && img.naturalWidth > 0);
  img.onerror = () => done(false);
  img.src = dataUrl;
}), r.portrait.dataUrl));

console.log('== module: follow off → plain endpoint ==');
await page.evaluate((MOD_URL) => {
  const s = JSON.parse(localStorage.getItem('mno.imageProvider'));
  s.follow = false;
  localStorage.setItem('mno.imageProvider', JSON.stringify(s));
}, MOD_URL);
const r2 = await page.evaluate(async (MOD_URL) => {
  const m = await import(MOD_URL);
  return m.routedGenImage('plain path probe', { route: 'portraits', resolution: '512x768', negativePrompt: '' });
}, MOD_URL);
ok('plain loreweaver path still used when follow off', plainCalls.length === 1 && !!r2.dataUrl);

console.log('== UI: follow toggle in Settings → Image Gen ==');
await page.evaluate(() => window.dispatchEvent(new CustomEvent('mno:open-settings', { detail: { section: 'imagegen' } })));
try {
  await page.waitForSelector('.pf-img-prov', { timeout: 20000 });
} catch (e) {
  console.log('DIAG: imagegen section did not open');
  throw e;
}
const ui = await page.evaluate(() => {
  const box = document.querySelector('.pf-img-prov') && document.querySelector('.pf-img-prov').closest('.pf-img-root, div');
  const root = document.querySelector('.pf-img-prov').parentElement.parentElement;
  const rows = root.querySelectorAll('.pf-img-followrow, .pf-img-followhint');
  const modelRows = root.querySelectorAll('.pf-img-modelrow');
  return {
    prov: document.querySelector('.pf-img-prov').value,
    followVisible: rows.length >= 2 && [...rows].every((el) => !el.hidden),
    modelHidden: modelRows.length >= 2 && [...modelRows].every((el) => el.hidden),
    swOn: (root.querySelector('.pf-img-followsw') || {}).dataset ? root.querySelector('.pf-img-followsw').dataset.on === '1' : false,
  };
});
ok('provider = loreweaver in UI', ui.prov === 'loreweaver');
ok('follow row + hint visible', ui.followVisible);
ok('follow switch reads On', ui.swOn);
ok('model row hidden while following', ui.modelHidden);
await page.screenshot({ path: SHOT + 'sdf01-follow-settings.png' });

console.log('== UI: Test button (follow status) ==');
await page.locator('.pf-img-test').click();
await page.waitForTimeout(1200);
const t1 = await page.locator('.pf-img-status').textContent();
ok('test shows following + reachable', /Following Image Generation/.test(t1) && /reachable/.test(t1));
// source not comfy → actionable warning
followStatusPayload = { ok: false, source: 'openrouter', comfy_url: null, workflow: null, reachable: false };
await page.locator('.pf-img-test').click();
await page.waitForTimeout(1200);
const t2 = await page.locator('.pf-img-status').textContent();
ok('non-comfy source warns to switch source', /not mirrored yet|set it to ComfyUI/i.test(t2));
// unreachable comfy → --listen hint (server text passthrough via bridge error)
await page.unroute('**/api/sd-follow/**');
await page.route('**/api/sd-follow/status', (r) => r.fulfill({ status: 500, body: 'SD-follow probe failed: ComfyUI unreachable — start it with --listen 0.0.0.0' }));
await page.locator('.pf-img-test').click();
await page.waitForTimeout(1200);
const t3 = await page.locator('.pf-img-status').textContent();
ok('server error text reaches the status line', /--listen 0\.0\.0\.0/.test(t3));
followStatusPayload = { ok: true, source: 'comfy', comfy_url: 'http://127.0.0.1:8188', workflow: 'Default_Comfy_Workflow.json', reachable: true };
await page.route('**/api/sd-follow/status', (r) => r.fulfill({ json: followStatusPayload }));
// toggle off → model row reappears, follow row stays (loreweaver), config persists
await page.locator('.pf-img-followsw').click();
await page.waitForTimeout(500);
const ui2 = await page.evaluate(() => {
  const root = document.querySelector('.pf-img-prov').parentElement.parentElement;
  const modelRows = [...root.querySelectorAll('.pf-img-modelrow')];
  const cfg = JSON.parse(localStorage.getItem('mno.imageProvider'));
  return { modelVisible: modelRows.every((el) => !el.hidden), storedFollow: cfg.follow, swOff: root.querySelector('.pf-img-followsw').dataset.on !== '1' };
});
ok('toggle off → model row reappears', ui2.modelVisible);
ok('toggle off persists follow:false', ui2.storedFollow === false && ui2.swOff);
await page.screenshot({ path: SHOT + 'sdf02-follow-off.png' });

await browser.close();
const pass = out.filter(([, v]) => v).length;
console.log(`\n== SD-FOLLOW ${pass}/${out.length} passed ==`);
process.exit(pass === out.length ? 0 : 1);
