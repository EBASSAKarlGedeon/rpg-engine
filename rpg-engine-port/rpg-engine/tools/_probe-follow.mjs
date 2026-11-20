import { chromium } from 'playwright';
const APP_URL = 'http://127.0.0.1:8000/scripts/extensions/third-party/rpg-engine/rpg-engine-port/rpg-engine/app/index.html';
const PROFILE_ID = '432b3e02-09e4-4bf0-a93c-662c9f8d5f7c';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 900 } })).newPage();
await page.addInitScript((pid) => {
  localStorage.setItem('rpge.loreweaverBridge', JSON.stringify({ enabled: true, profileId: pid, usePreset: true, roles: {} }));
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver', follow: true, providers: { loreweaver: { model: 'x' } } }));
}, PROFILE_ID);
await page.route('**/api/sd-follow/**', (r) => r.fulfill({ json: { ok: true, source: 'comfy', reachable: true } }));
await page.goto(APP_URL, { waitUntil: 'load', timeout: 90000 });
await page.waitForTimeout(3000);
await page.evaluate(() => window.dispatchEvent(new CustomEvent('mno:open-settings', { detail: { section: 'imagegen' } })));
await page.waitForSelector('.pf-img-prov', { timeout: 20000 });
const before = await page.evaluate(() => ({
  prov: [...document.querySelectorAll('.pf-img-prov')].length,
  followsw: [...document.querySelectorAll('.pf-img-followsw')].length,
  modelrow: [...document.querySelectorAll('.pf-img-modelrow')].map(e => ({ hidden: e.hidden, inPopup: !!e.closest('.pf-md-panel, .popup, dialog, .md-root') })),
}));
await page.evaluate(() => { window.addEventListener('error', (e) => console.log('WINERR:', e.message, e.filename, e.lineno)); });
await page.locator('.pf-img-followsw .ui-sw').click();
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({
  modelrow: [...document.querySelectorAll('.pf-img-modelrow')].map(e => e.hidden),
  followsw: [...document.querySelectorAll('.pf-img-followsw')].map(e => e.dataset.on),
}));
console.log('BEFORE:', JSON.stringify(before));
const rel = await page.evaluate(() => {
  const sw = document.querySelector('.pf-img-followsw');
  const mr = document.querySelector('.pf-img-modelrow');
  const prov = document.querySelector('.pf-img-prov');
  // walk up from sw, checking at which ancestor mr stops being a descendant
  let el = sw, hops = 0, found = null;
  while (el && el !== document.body && hops < 30) {
    if (el.contains(mr)) { found = hops; break; }
    el = el.parentElement; hops++;
  }
  return { swClass: sw.parentElement.className, mrInSwAncestorAtHop: found,
    mrParentClass: mr.parentElement ? mr.parentElement.className : null,
    mrGrandParent: mr.parentElement && mr.parentElement.parentElement ? mr.parentElement.parentElement.className : null,
    sameRoot: !!sw.closest('div') && sw.closest('div').contains(mr) };
});
console.log('REL:', JSON.stringify(rel));
console.log('AFTER:', JSON.stringify(after));
await browser.close();
