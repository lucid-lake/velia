// The throttle's lit word and the whole-or-gone cockpit on the v2 page (owner, 2026-11-14; v2/ui/throttleWord.js, v2/ui/station.js
// cockpitTarget). The word: + + + lights FULL AHEAD; with the lever still it is gone within 2.5 s and stays gone, also when the engine's
// own rules or a driver move the lever; the next lever change (a key, a tap on the lever) lights it again. The cockpit: after the idle
// its one value (the slide and the fade) is only ever 0 or 1 outside a short transition, even while a sail calls its winch (v1's peek).
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/throttleWord.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: 'no-preference' });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } catch {} });
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=15&seed=1&noload=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.throttle && window.__velia.m4.ui.station?.cockpit, null, { timeout: 240000 });
  await page.waitForTimeout(1000);
  const word = () => page.evaluate(() => { const ui = window.__velia.m4.ui, lit = ui.throttle.el.querySelector('.lit'); return { text: lit.textContent, op: +(+getComputedStyle(lit).opacity).toFixed(3), lever: ui.services.get('seamanship').engine.lever, engine: ui.services.get('seamanship').engine.state }; });
  // keep the dashboard up (the pointer rests on it) so only the word's own timing counts
  await page.mouse.move(250, 690);
  check((await word()).op < 0.05, `before any touch: no word (${JSON.stringify(await word())})`);

  // + + +: the engine starts and the lever goes to FULL AHEAD; the word lights
  for (let i = 0; i < 3; i++) { await page.keyboard.press('Equal'); await page.waitForTimeout(200); }
  await page.waitForFunction(() => window.__velia.m4.ui.services.get('seamanship').engine.state === 'running', null, { timeout: 15000 }).catch(() => {});
  await page.keyboard.press('Equal');   // at the stop: still a touch
  await page.waitForTimeout(250);
  const lit = await word();
  check(lit.text === 'FULL AHEAD' && lit.op > 0.9, `a lever change lights the word (${JSON.stringify(lit)})`);

  // the lever still: gone within 2.5 s
  await page.waitForTimeout(2500);
  const gone = await word();
  check(gone.op < 0.05 && gone.lever === 1 && gone.engine === 'running', `the lever still, the engine running: the word gone within 2.5 s (${JSON.stringify(gone)})`);

  // not back by itself: 2 s more, and the lever moved by the engine's own side (a driver, not the player)
  await page.evaluate(() => window.__velia.m4.ui.services.get('seamanship').actions.lever(0.6));
  const maxOp = await page.evaluate(() => new Promise((ok) => {
    const lit = window.__velia.m4.ui.throttle.el.querySelector('.lit'), t0 = performance.now(); let m = 0;
    const f = () => { m = Math.max(m, +getComputedStyle(lit).opacity); if (performance.now() - t0 < 2000) requestAnimationFrame(f); else ok(m); };
    f();
  }));
  check(maxOp < 0.05, `not back by itself, nor when a driver moves the lever (max opacity ${maxOp.toFixed(3)} over 2 s)`);

  // the next lever change by the player: a key, then a tap on the lever
  await page.keyboard.press('Minus'); await page.waitForTimeout(250);
  const again = await word();
  check(again.op > 0.9 && again.text === 'SLOW AHEAD', `the next lever change (−) lights it again (${JSON.stringify(again)})`);
  await page.waitForTimeout(2500);
  check((await word()).op < 0.05, 'gone again 2.5 s later');
  const lv = await page.evaluate(() => { const r = window.__velia.m4.ui.throttle.el.querySelector('.lv').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.click(lv.x, lv.y); await page.waitForTimeout(250);
  check((await word()).op > 0.9, `a tap on the lever lights it (${JSON.stringify(await word())})`);

  // the cockpit: whole or gone. The pointer leaves the dashboard; over 9 s the idle takes it (a luffing sail at the stop calls its winch:
  // v1's peek would rest it half sunk). Its one value may sit between 0 and 1 only during a transition (0.4 s, allowed 0.6 s).
  await page.keyboard.press('Digit0');   // N: the sails shake at a stop, so a winch is called
  await page.mouse.move(640, 300);
  const run = await page.evaluate(() => new Promise((ok) => {
    const ui = window.__velia.m4.ui, t0 = performance.now(); let midSince = null, longest = 0, peeked = false, mismatch = 0, last = null;
    const f = () => {
      const now = performance.now(), ck = ui.station.cockpit, k = ck.opacity, n = ui.calm.view.need;
      if (n.jib || n.main || n.trim) peeked = true;
      if (Math.abs(ck.sink - (1 - k)) > 1e-6) mismatch++;
      const mid = (k > 0.001 && k < 0.999) || (ck.sink > 0.001 && ck.sink < 0.999);   // half faded or half sunk (v1's peek: at full, sunk to the cap)
      if (mid) { midSince ??= now; longest = Math.max(longest, now - midSince); } else midSince = null;
      last = { k: +k.toFixed(4), sink: +ck.sink.toFixed(4), thr: getComputedStyle(ui.throttle.el).visibility, dash: document.documentElement.classList.contains('lk-calm-dash') };
      if (now - t0 < 9000) requestAnimationFrame(f); else ok({ longestMs: Math.round(longest), peeked, mismatch, last });
    };
    f();
  }));
  check(run.last.dash && run.last.k === 0 && run.last.sink === 1 && run.last.thr === 'hidden', `after the idle the cockpit is gone whole, the throttle column with it (${JSON.stringify(run)})`);
  check(run.longestMs <= 600 && run.mismatch === 0, `the cockpit's value is 0 or 1 outside a transition of at most 600 ms, the slide and the fade one value (${JSON.stringify(run)})`);
  console.log(`note  a winch was called during the idle: ${run.peeked}`);
  // a helm key brings it back whole
  await page.keyboard.down('KeyA'); await page.waitForTimeout(150); await page.keyboard.up('KeyA'); await page.waitForTimeout(800);
  const back = await page.evaluate(() => { const ck = window.__velia.m4.ui.station.cockpit; return { k: ck.opacity, sink: ck.sink }; });
  check(back.k === 1 && back.sink === 0, `a helm key brings it back whole (${JSON.stringify(back)})`);
  const ve = await page.evaluate(() => window.__velia.errors.slice());
  check(!errors.length && !ve.length, `no page errors (${[...errors, ...ve].join(' | ').slice(0, 300) || 'none'})`);
} catch (e) {
  check(false, `the run: ${String(e).split('\n')[0]}`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
