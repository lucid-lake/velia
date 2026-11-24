// v2 port of tests/pages/calmHud.page.mjs: the Calm HUD (src/ui/calmHud.js, mounted by v2/ui/sail.js) on the v2 page. A headless
// capture page has no UI at all; on a played page the dashboard goes after 5 s idle and the 3D cockpit (v2/render/cockpit.js, one
// object: v1's desktop cockpit slot) sinks and fades with it, whole (v2: no winch peek, owner 2026-11-14); a helm key brings it back;
// reduced motion sets the fade token to 0 ms in the real cascade.
// Map: __lakeshore.calm → __velia.m4.ui.calm, .station → __velia.m4.ui.station, core.hud.slots (the 3D slots) → the cockpit's one
// opacity (station.cockpit.opacity, the value the rig's setOpacity is driven by).
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/calmHud.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  // a headless capture page: the world, no UI (v2: no Calm, no station, no top bar)
  const cap = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await cap.goto(`${BASE}/?mode=sail&hour=15&seed=1&headless=1`, { waitUntil: 'load' });
  await cap.waitForFunction(() => window.__velia?.renderOnce, null, { timeout: 240000 });
  await cap.waitForTimeout(1500);
  const h = await cap.evaluate(() => ({ calm: !!document.querySelector('.lk-calm-mark') || !!document.getElementById('lk-calm-css'), shell: !!document.querySelector('.lk-menu-mark'), ui: !!window.__velia.m4?.ui, helm: !!document.querySelector('.lk-helm'), classes: [...document.documentElement.classList].filter((c) => c.startsWith('lk-calm')) }));
  check(!h.calm && !h.shell && !h.ui && !h.helm && h.classes.length === 0, `headless: no UI and no Calm (${JSON.stringify(h)})`);
  await cap.close();

  // a played page: Calm takes the dashboard and the cockpit after 5 s idle
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } catch {} });
  await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&noload=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.calm && window.__velia.m4.ui.station?.cockpit, null, { timeout: 240000 });
  // dropped: 'a played page loads the shell' (v2 has no shell: no menu, no Settings; the top bar is v1's viewSwitch alone)
  check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lk-calm-fade').trim()) === '600ms', 'the fade token is 600 ms');
  const slots = () => page.evaluate(() => [+window.__velia.m4.ui.station.cockpit.opacity.toFixed(3)]);
  check((await slots()).every((v) => v === 1), `before the idle: the cockpit at full (${await slots()})`);
  await page.waitForFunction(() => document.documentElement.classList.contains('lk-calm-dash'), null, { timeout: 20000 }).catch(() => {});
  // over the next 1.2 s (twice the 600 ms fade), what the boat needs each frame: a shaking sail (or the 'ease' hint) calls its winch
  // back on purpose (calmHud.js needsNow), so a winch is expected at 0 only while nothing calls it, and at 1 while something does
  const idle = await page.evaluate(() => new Promise((ok) => {
    const ui = window.__velia.m4.ui, seen = { jib: new Set(), main: new Set() }, t0 = performance.now();
    const f = () => {
      const n = ui.calm.view.need;
      for (const w of ['jib', 'main']) seen[w].add(!!(n.trim || n[w]));
      if (performance.now() - t0 < 1200) { requestAnimationFrame(f); return; }
      const ck = ui.station.cockpit;
      ok({ called: { jib: [...seen.jib], main: [...seen.main] }, op: ui.station.opacity, sails: ui.station.sails, gpu: [+ck.opacity.toFixed(3)],
        cockpit: { sink: +ck.sink.toFixed(3), peek: +ck.peek.toFixed(3) } });
    };
    f();
  }));
  check(await page.evaluate(() => document.documentElement.classList.contains('lk-calm-dash')), 'after 5 s idle the dashboard goes');
  const winchOk = (w) => (idle.called[w].length !== 1 ? null : idle.called[w][0] ? idle.op[w] > 0.99 : idle.op[w] < 0.01);
  // the 3D cockpit is one object, shown whole or gone whole (owner, 2026-11-14; v2/ui/station.js cockpitTarget, unlike v1): at rest it
  // sinks below the frame and fades, and a winch the boat needs does not raise it half way (no peek: the cap at the frame's foot)
  const cockpitOk = idle.op.wheel < 0.01 && idle.cockpit.sink > 0.99 && idle.gpu[0] < 0.01;
  check(idle.op.wheel < 0.01 && winchOk('jib') !== false && winchOk('main') !== false && cockpitOk,
    `the wheel's slot fades to 0 with it, each winch's slot to 0 unless its sail calls it, and the 3D cockpit is gone whole even so (${JSON.stringify(idle)})`);
  await page.keyboard.down('KeyA'); await page.waitForTimeout(150); await page.keyboard.up('KeyA');
  await page.waitForTimeout(900);
  const back = await page.evaluate(() => ({ op: window.__velia.m4.ui.station.opacity, sink: +window.__velia.m4.ui.station.cockpit.sink.toFixed(3) }));
  check((await slots()).every((v) => v > 0.99) && back.sink < 0.01, `a helm key brings it back (${await slots()}, ${JSON.stringify(back)})`);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  check(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--lk-calm-fade').trim()) === '0ms', 'reduced motion: the fade token is 0 ms');
  const ve = await page.evaluate(() => window.__velia.errors.slice());
  check(!errors.length && !ve.length, `no page errors (${[...errors, ...ve].join(' | ').slice(0, 300) || 'none'})`);
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
