// Temporary logic test for rpge-patch 017 (Loreweaver image bridge).
// Run: node tools/imgbridge-test.js
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mod = fs.readFileSync(path.join(__dirname, '../app/src/scripts/image-provider.js'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.addInitScript(() => {
  window.genImage = () => Promise.resolve({ dataUrl: 'data:image/png;base64,perchance', provider: 'perchance' });
  window.LoreweaverBridge = {
    isEnabled: () => true,
    api: async (p, body) => {
      window.__apiCalls = window.__apiCalls || [];
      window.__apiCalls.push({ path: p, body });
      if (p === '/api/openrouter/image/generate') return { format: 'jpg', image: 'QUJD' };
      if (p === '/api/openrouter/models/image') return [{ value: 'a', text: 'A' }, { value: 'b', text: 'B' }];
      throw new Error('404');
    },
  };
});
await page.goto('about:blank');
await page.evaluate((m) => { window.__mod = m; }, mod);
const results = await page.evaluate(async () => {
  const m = await import(URL.createObjectURL(new Blob([window.__mod], { type: 'text/javascript' })));
  const out = [];
  localStorage.removeItem('mno.imageProvider');
  out.push(['fresh-default-loreweaver', m.getImageConfig().provider === 'loreweaver']);
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'perchance' }));
  out.push(['stored-perchance-respected', m.getImageConfig().provider === 'perchance']);
  localStorage.removeItem('mno.imageProvider');
  window.LoreweaverBridge.isEnabled = () => false;
  out.push(['no-bridge-default-perchance', m.getImageConfig().provider === 'perchance']);
  window.LoreweaverBridge.isEnabled = () => true;
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver' }));
  out.push(['active-loreweaver', m.activeImageProvider() === 'loreweaver']);
  window.LoreweaverBridge.isEnabled = () => false;
  out.push(['active-falls-back-perchance', m.activeImageProvider() === 'perchance']);
  window.LoreweaverBridge.isEnabled = () => true;
  out.push(['close-blocker-null', m.imageCloseBlocker() === null]);
  window.LoreweaverBridge.isEnabled = () => false;
  out.push(['close-blocker-blocks', !!m.imageCloseBlocker()]);
  window.LoreweaverBridge.isEnabled = () => true;
  const r = await m.routedGenImage('portrait of a knight', { route: 'portraits' });
  out.push(['genimage-dataurl', r && r.dataUrl === 'data:image/jpeg;base64,QUJD' && r.provider === 'loreweaver']);
  const calls = window.__apiCalls;
  out.push(['genimage-body', calls.some(c => c.path === '/api/openrouter/image/generate' && c.body.model === 'openai/gpt-5-image-mini' && c.body.aspect_ratio === '1:1' && c.body.prompt === 'portrait of a knight')]);
  await m.routedGenImage('wide scene', { route: 'scene', resolution: '768x512' });
  out.push(['landscape-aspect', calls.some(c => c.body.aspect_ratio === '3:2')]);
  await m.routedGenImage('tall', { route: 'scene', resolution: '512x768' });
  out.push(['portrait-aspect', calls.some(c => c.body.aspect_ratio === '2:3')]);
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver', useExternal: { portraits: false } }));
  const rp = await m.routedGenImage('off', { route: 'portraits' });
  out.push(['route-off-fallback', rp && rp.provider === 'perchance']);
  const t = await m.testImageConnection('', '', 'loreweaver');
  out.push(['test-connection-true', t === true && calls.some(c => c.path === '/api/openrouter/models/image')]);
  const ms = await m.loreweaverImageModels();
  out.push(['models-shape', ms.length === 2 && ms[0].value === 'a']);
  localStorage.setItem('mno.imageProvider', JSON.stringify({ provider: 'loreweaver' }));
  window.LoreweaverBridge.isEnabled = () => false;
  let threw = false;
  try { await m.routedGenImage('x', { route: 'portraits' }); } catch (e) { threw = /not connected/i.test(e.message); }
  out.push(['bridge-down-throws', threw]);
  return out;
});
let pass = 0;
for (const [name, ok] of results) { console.log(ok ? 'PASS' : 'FAIL', name); if (ok) pass++; }
console.log(`== ${pass}/${results.length} passed ==`);
await browser.close();
process.exit(pass === results.length ? 0 : 1);
