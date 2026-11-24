// The binoculars and the VHF on the real v2 page (#5, #6: v2/ui/captain.js, v1's captainTools on v2):
//   B raises the glasses: the field narrows to 6.5°, v1's lens mask and HUD fade in, the top bar and the 3D cockpit step aside;
//   the mouse aims with no drag; a click on the water lowers them; B again lowers them; the PRO recess's BINOS (the dock's
//   'binoculars') raises them too; the frames after it build no pipeline. The VHF: nothing fetched from audio/vhf/ before the first
//   frame; on by default (the clip table only); O plays the forecast through the page's sound (the sprite fetched then, the radio's
//   own bus on the master; #35: the set's LCD on the pedestal shows WX 1, RX and the words); the Pro panel's VHF turns it off (Settings 'vhf' saved false, the radio quiet) and on; a headless
//   capture builds none of it. The node half: v2/tests/captain.test.mjs.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/captain.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
const row = (page) => page.evaluate(() => ({ ...window.__velia.m4.captain.row(), fov: +window.__velia.camera.fov.toFixed(2), cockpit: window.__velia.m4.cockpit?.on, bar: +getComputedStyle(document.querySelector('.lk-view')).opacity,
  mask: getComputedStyle(document.querySelector('.lk-bino')).display, maskOp: +document.querySelector('.lk-bino').style.opacity, hud: getComputedStyle(document.querySelector('.lk-bhud')).display, late: window.__velia.stats().pipelines.afterFirstFrame }));

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  const vhfReq = [], vhfAt = []; page.on('request', (r) => { if (r.url().includes('/audio/vhf/')) { vhfReq.push(r.url().split('/').pop()); vhfAt.push(Date.now()); } });
  await page.addInitScript((s) => { try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); sessionStorage.setItem('seeded', '1'); } } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=15&seed=1&once=0&noload=1&fv=1&chatter=0&hm=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.captain && window.__velia.m4.ui?.station && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  await page.waitForTimeout(500);
  const ffWall = await page.evaluate(() => performance.timeOrigin + window.__velia.stats().firstFrameFromNavMs);
  check(vhfReq.length >= 1 && vhfAt.every((t) => t > ffWall) && vhfReq.every((f) => f === 'forecast.json'), `nothing from audio/vhf/ before the first frame; then only the clip table (${vhfReq.map((f, i) => `${f} +${vhfAt[i] - Math.round(ffWall)} ms`).join(', ')})`);

  // ---- the binoculars ----
  await page.mouse.click(640, 300); await page.waitForTimeout(300);   // the first gesture: the page's sound
  let r = await row(page);
  check(!r.latched && r.k === 0 && r.fov > 30 && r.cockpit === true && r.mask === 'none', `down at the start: the views' lens, the cockpit drawn, no mask (${JSON.stringify(r)})`);
  await page.keyboard.press('KeyB'); await page.waitForTimeout(1600);
  r = await row(page);
  check(r.latched && r.k === 1 && r.fov === 6.5, `B: raised, the field 6.5° (k ${r.k}, fov ${r.fov})`);
  check(r.mask === 'block' && r.maskOp === 1 && r.hud === 'block', `v1's lens mask and HUD over the page (${r.mask} ${r.maskOp}, hud ${r.hud})`);
  check(r.cockpit === false && r.bar < 0.05, `the 3D cockpit and the top bar step aside (cockpit ${r.cockpit}, bar ${r.bar})`);
  check(await page.evaluate(() => document.documentElement.classList.contains('lk-bino-up')), '<html>.lk-bino-up (no chart circle over the glasses)');
  const y0 = await page.evaluate(() => window.__velia.m4.captain.bino.yaw);
  await page.mouse.move(640, 360); for (let i = 1; i <= 10; i++) { await page.mouse.move(640 + i * 12, 360); await page.waitForTimeout(20); }
  await page.waitForTimeout(150);
  const y1 = await page.evaluate(() => window.__velia.m4.captain.bino.yaw);
  check(y1 - y0 > 0.03 * Math.PI / 180, `the mouse aims with no drag (120 px → ${((y1 - y0) * 57.3).toFixed(2)}°)`);
  // 2026-11-19: the tilt reaches the ridge and the sky (it stopped just above the horizon: the cursor ran out of screen)
  const pitchNow = () => page.evaluate(() => +(window.__velia.m4.captain.bino.pitch * 57.2958).toFixed(2));
  await page.mouse.move(640, 500);
  for (let y = 500; y >= 2; y -= 25) { await page.mouse.move(640, y); await page.waitForTimeout(16); }   // up to the window's top edge
  await page.waitForTimeout(2500);   // held at the edge: it keeps tilting by itself
  const up = await pitchNow();
  check(up >= 30, `the mouse tilts the glasses up to the ridge and the sky: pitch ${up}° (>= +30°)`);
  { const png = await page.screenshot({ path: process.env.LAKESHORE_BINO_SHOT || undefined });
    const px = await page.evaluate(async (b64) => { const im = new Image(); im.src = 'data:image/png;base64,' + b64; await im.decode(); const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; const g = c.getContext('2d'); g.drawImage(im, 0, 0); const d = g.getImageData(im.width / 2 - 4, im.height / 2 - 4, 8, 8).data; let r = 0, gg = 0, bb = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; bb += d[i + 2]; } const n = d.length / 4; return [r / n, gg / n, bb / n]; }, png.toString('base64'));
    check(px[2] > px[0] + 8 && px[2] > 90, `the centre of the view is sky (rgb ${px.map((v) => Math.round(v)).join(',')})`); }
  await page.mouse.move(640, 360); await page.waitForTimeout(300);
  for (let y = 360; y <= 710; y += 25) { await page.mouse.move(640, y); await page.waitForTimeout(16); }
  await page.mouse.move(640, 719); await page.waitForTimeout(1500);
  const dn = await pitchNow();
  check(dn <= -15 && dn >= -20.01, `down to the water by the boat: pitch ${dn}° (<= -15°, floor -20°)`);
  await page.mouse.move(640, 360); await page.waitForTimeout(500);
  await page.mouse.click(640, 360); await page.waitForTimeout(800);
  r = await row(page);
  check(!r.latched && r.k === 0 && r.fov > 30 && r.cockpit === true, `a click on the water lowers them; the cockpit back (${JSON.stringify({ k: r.k, fov: r.fov, cockpit: r.cockpit })})`);
  await page.keyboard.press('KeyB'); await page.waitForTimeout(900); await page.keyboard.press('KeyB'); await page.waitForTimeout(800);
  check((await row(page)).k === 0, 'B again lowers them');
  await page.evaluate(() => window.__velia.m4.ui.setPro(true)); await page.waitForTimeout(300);
  const binos = await page.evaluate(() => { const b = document.querySelector('.lk-pro .c[data-id=binoculars]'); b?.click(); return !!b; });
  await page.waitForTimeout(1200);
  r = await row(page);
  check(binos && r.latched && r.k === 1, `the PRO recess's BINOS: raised (${binos}, k ${r.k})`);
  const lit = await page.evaluate(() => Object.fromEntries(window.__velia.m4.ui.proRecess.cells.filter((c) => c.id === 'binoculars' || c.id === 'radio').map((c) => [c.id, c.pressed])));
  check(lit.binoculars === 'true' && lit.radio === 'true', `BINOS lit while up, VHF lit while the radio is on (${JSON.stringify(lit)})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(800);
  { const e = await row(page), menu = await page.evaluate(() => !!window.__velia.m4.front?.home?.isOpen); check(e.k === 0 && !menu, `Escape lowers them, the Menu card stays down (#34: ${JSON.stringify({ latched: e.latched, k: e.k, menu })})`); }
  if (await page.evaluate(() => !!window.__velia.m4.front?.home?.isOpen)) { await page.keyboard.press('Escape'); await page.waitForTimeout(600); }   // (a failed check above: close the card for the rest)
  check(r.late === 0, `0 pipelines built after the first frame (${r.late})`);

  // ---- the VHF ----
  r = await row(page);
  check(r.on && r.channel === '16' && !r.playing, `on by default, on 16, quiet (${JSON.stringify({ on: r.on, ch: r.channel })})`);
  check(!vhfReq.some((f) => /forecast\.(opus|m4a)$/.test(f)), `no sprite yet (${vhfReq.join(', ')})`);
  await page.keyboard.press('KeyO'); await page.waitForTimeout(500);
  check((await row(page)).channel === '16', 'O is no key any more: still on 16');
  await page.evaluate(() => window.__velia.m4.captain.listen());   // the Conditions sheet's VHF button calls this (topBar.js radio.toggle)
  await page.waitForFunction(() => window.__velia.m4.captain.row().playing, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  r = await row(page);
  check(r.playing && r.channel === 'WX 1' && /^Lake forecast for this afternoon\./.test(r.forecast ?? '') && r.token >= 1, `the VHF button: the forecast plays on WX 1 (token ${r.token}, ${r.forecast?.slice(0, 60)}…)`);
  check(vhfReq.some((f) => /forecast\.(opus|m4a)$/.test(f)), `the sprite fetched for the play (${vhfReq.join(', ')})`);
  // #35: the VHF set's LCD on the pedestal shows the radio's state: WX 1, RX, a window of the forecast's words (upper case), drawn
  const lcd = await page.evaluate(() => ({ s: window.__velia.boat.render.instruments.stats.vhf, text: window.__velia.m4.captain.forecast?.text ?? '' }));
  check(lcd.s.big === 'WX 1' && lcd.s.tag === 'RX' && lcd.s.line.trim().length > 0 && lcd.text.toUpperCase().includes(lcd.s.line.trim()) && lcd.s.draws > 1, `the set's LCD: ${JSON.stringify(lcd.s)}`);
  const bus = await page.evaluate(() => { const b = window.__velia.m4.captain.bus; return b ? { gain: +b.gain.value.toFixed(3), state: b.context.state } : null; });
  check(bus && bus.state === 'running' && bus.gain > 0.9, `the radio's own bus on the page's sound, running (${JSON.stringify(bus)})`);
  // the Pro panel's VHF: the recess's dome (the cockpit form), as v1's onTool('radio')
  const off = await page.evaluate(() => { const b = document.querySelector('.lk-pro .c[data-id=radio]'); b?.click(); return { clicked: !!b, saved: JSON.parse(localStorage.getItem('lakeshore.settings.v1') ?? '{}').vhf }; });
  await page.waitForTimeout(300);
  r = await row(page);
  check(!r.on && !r.playing && r.channel === '16' && off.clicked && off.saved === false, `the Pro panel's VHF: off, quiet, Settings 'vhf' saved false (${JSON.stringify({ ...off, on: r.on, playing: r.playing })})`);
  await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__velia.m4.captain.radio.state.playing === false), 'stays quiet');
  await page.evaluate(() => window.__velia.m4.captain.toggle());
  check((await row(page)).on && await page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.settings.v1')).vhf === true), 'and on again (saved)');
  { const v = await page.evaluate(() => window.__velia.boat.render.instruments.stats.vhf); check(v.big === '16' && v.tag === '' && v.line.trim() === '', `the set's LCD back on 16, quiet (${JSON.stringify(v)})`); }
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  await page.close();

  // a headless capture builds none of it
  const cap = await browser.newPage({ viewport: { width: 640, height: 360 } });
  const capReq = []; cap.on('request', (q) => { if (q.url().includes('/audio/vhf/')) capReq.push(q.url()); });
  await cap.goto(`${BASE}/?headless=1&hour=13&wind=2`, { waitUntil: 'load' });
  await cap.waitForFunction(() => window.__velia?.ready, null, { timeout: 240000 });
  await cap.waitForTimeout(1000);
  check(await cap.evaluate(() => window.__velia.m4.captain === null && !document.querySelector('.lk-bino')) && capReq.length === 0, `headless: no binoculars, no radio, no audio/vhf fetch (${capReq.length})`);
  await cap.close();
} finally { await browser.close(); }
console.log(fails ? `captain: ${fails} FAIL` : 'captain: all PASS');
process.exit(fails ? 1 : 0);
