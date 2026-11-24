// The edge pair in a real browser: the key legend (right) and the nav column (left) on one stylesheet
// (src/ui/edgeStyle.js). Mirrored anchors (left = W - right = --lk-mx), one foot, a 36 px row; tabular numbers ("1111" as
// wide as "8888"); both fade with the Calm dashboard and a helm key brings both back; the helm view keeps the column and
// drops the legend; the big chart covers both; the passage block appears with a waypoint; phones have no legend and keep
// the column clear of the dials and the bottom band. The pure parts: tests/navColumn.test.mjs, tests/passage.test.mjs.
// Run by `npm run test:pages` (LAKESHORE_BASE set), or node tests/pages/edgePair.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const Q = 'seed=1&hour=15&wind=2&noload=1&fv=1&once=0&attract=0&mute=1&hm=0&chatter=0&keylegend=1&navcol=1';

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
async function open(query, { w = 1280, h = 720, touch = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__lakeshore?.navColumn && window.__lakeshore?.calm && window.__lakeshore?.player?.phys?.t > 1, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  return { page, ctx, errors };
}
const read = (page) => page.evaluate(() => {
  const vis = (n) => !!n && getComputedStyle(n).visibility !== 'hidden' && +getComputedStyle(n).opacity > 0.5;
  const R = (n) => { const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
  const L = document.querySelector('.lk-nav'), K = document.querySelector('.lk-keys');
  const shown = (el, sel) => [...el.querySelectorAll(sel)].filter((r) => !r.classList.contains('off') && !r.classList.contains('fade'));
  const lrows = shown(L, '.nr:not(.gap)').map((r) => ({ id: r.dataset.id, ...R(r), text: r.textContent }));
  const krows = shown(K, '.kl').map(R);
  const mx = parseFloat(getComputedStyle(K).right);   // --lk-mx (the legend's anchor, set even while it is hidden)
  return { W: innerWidth, H: innerHeight, left: { on: vis(L), ...R(L) }, right: { on: vis(K), ...R(K) }, lrows, krows, mx,
    ids: lrows.map((r) => r.id), helm: !!window.__lakeshore.station?.helmView };
});
const pitch = (rows) => rows.slice(1).map((r, i) => Math.round(r.t - rows[i].t));

try {
  for (const [w, h] of [[1920, 1080], [1280, 720]]) {
    const { page, ctx, errors } = await open(`mode=sail&hud=calm&${Q}`, { w, h });
    let r = await read(page);
    check(r.left.on && r.right.on, `${w}x${h}: both blocks on (left ${r.left.on}, right ${r.right.on})`);
    check(Math.abs(r.left.l - r.mx) <= 1 && Math.abs((r.W - r.right.r) - r.mx) <= 1, `${w}x${h}: mirrored margins: left ${r.left.l.toFixed(1)}, W - right ${(r.W - r.right.r).toFixed(1)}, --lk-mx ${r.mx}`);
    check(Math.abs(r.left.b - r.right.b) <= 1, `${w}x${h}: one foot (left ${r.left.b.toFixed(1)}, right ${r.right.b.toFixed(1)})`);
    const lp = pitch(r.lrows.filter((x) => ['cog', 'tws', 'twa'].includes(x.id))), kp = pitch(r.krows);
    check(lp.every((p) => p === 36) && kp.every((p) => p === 36), `${w}x${h}: a 36 px row on both edges (left ${lp}, right ${kp})`);
    check(JSON.stringify(r.ids) === JSON.stringify(['cog', 'tws', 'twa', 'vmg', 'heel']), `${w}x${h}: the five readings, no SOG (${r.ids})`);
    check(r.lrows.every((x) => x.t > 103), `${w}x${h}: under the skipper's line (top ${Math.round(r.left.t)})`);
    const tab = await page.evaluate(() => {
      const n = document.querySelector('.lk-nav .n'), m = (s) => { const sp = document.createElement('span'); sp.textContent = s; n.appendChild(sp); const v = sp.getBoundingClientRect().width; sp.remove(); return v; };
      return [m('1111'), m('8888')];
    });
    check(Math.abs(tab[0] - tab[1]) <= 0.5, `${w}x${h}: tabular digits: "1111" ${tab[0].toFixed(2)} px, "8888" ${tab[1].toFixed(2)} px`);
    // the passage block with a waypoint (the pro chart's setWaypoint: the chart state the passage service reads)
    await page.evaluate(() => { const L = window.__lakeshore, s = L.player.phys.state, a = s.heading + 0.5; L.chart.chart.setWaypoint({ x: s.x + Math.sin(a) * 2200, z: s.z - Math.cos(a) * 2200 }); });
    await page.waitForTimeout(1800);
    r = await read(page);
    check(['mark', 'dtw', 'btw', 'ttg', 'xte'].every((id) => r.ids.includes(id)) && !r.ids.includes('eta'), `${w}x${h}: a waypoint brings the passage block, no ETA (${r.ids})`);
    check(r.lrows.every((x) => x.t > 103) && Math.abs(r.left.b - r.right.b) <= 1, `${w}x${h}: the passage block grows upward, under the skipper's line (top ${Math.round(r.left.t)})`);
    // Calm: 5 s idle and both edges go with the dashboard; a helm key brings both back
    await page.mouse.move(w / 2, h / 3);
    await page.waitForFunction(() => document.documentElement.classList.contains('lk-calm-dash'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    r = await read(page);
    check(!r.left.on && !r.right.on, `${w}x${h}: Calm idle: both blocks fade with the dashboard (left ${r.left.on}, right ${r.right.on})`);
    await page.keyboard.down('KeyA'); await page.waitForTimeout(120); await page.keyboard.up('KeyA'); await page.waitForTimeout(800);
    r = await read(page);
    check(r.left.on && r.right.on, `${w}x${h}: a helm key brings both back (left ${r.left.on}, right ${r.right.on})`);
    // the helm view: the column stays, the legend goes
    await page.evaluate(() => { window.__lakeshore.controls.view = 'helm'; }); await page.waitForTimeout(1600);
    r = await read(page);
    check(r.helm && r.left.on && !r.right.on, `${w}x${h}: the helm view: the column stays, the legend goes (left ${r.left.on}, right ${r.right.on})`);
    await page.evaluate(() => { window.__lakeshore.controls.view = 'follow'; }); await page.waitForTimeout(1400);
    // the big chart covers both
    await page.evaluate(() => window.__lakeshore.chart.chart.toggle.pin()); await page.waitForTimeout(900);
    r = await read(page);
    check(!r.left.on && !r.right.on, `${w}x${h}: the big chart: both hidden (left ${r.left.on}, right ${r.right.on})`);
    check(errors.length === 0, `${w}x${h}: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // the default (no ?navcol, the setting at auto, Pro off): an empty left edge until a mark is set; then the passage block alone;
  // Pro on brings the instruments (owner, 2026-11-12: "regular people should not always look at it")
  {
    const { page, ctx, errors } = await open(`mode=sail&hud=full&${Q.replace('&navcol=1', '')}`, { w: 1920, h: 1080 });
    let r = await read(page);
    check(!r.left.on && r.ids.length === 0 && r.right.on, `default, Pro off, no mark: the left edge is empty, the legend stands (${r.ids})`);
    await page.evaluate(() => { const L = window.__lakeshore, s = L.player.phys.state, a = s.heading + 0.5; L.chart.chart.setWaypoint({ x: s.x + Math.sin(a) * 2200, z: s.z - Math.cos(a) * 2200 }); });
    await page.waitForTimeout(1800);
    r = await read(page);
    check(r.left.on && JSON.stringify(r.ids) === JSON.stringify(['dtw', 'btw', 'ttg', 'xte', 'mark']), `default, Pro off, a mark: the passage block alone (${r.ids})`);
    await page.evaluate(() => { window.__lakeshore.controls.setPro(true); }); await page.waitForTimeout(1200);   // the PRO recess / TRIM switch
    r = await read(page);
    check(['cog', 'tws', 'twa', 'vmg', 'heel', 'rud', 'dtw'].every((id) => r.ids.includes(id)), `default, Pro on: the instruments join (${r.ids})`);
    check(errors.length === 0, `default: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // Cruise: nothing at rest; a mark (the lake's double-tap, through the tools' spot finder) brings the passage block with the bar
  {
    const { page, ctx, errors } = await open(`mode=cruise&${Q}`);
    await page.waitForTimeout(3000);
    let r = await read(page);
    check(!r.left.on, `Cruise, no mark: nothing on the left (${r.ids})`);
    const how = await page.evaluate(() => { const c = window.__lakeshore.chill, sp = c?.markSpot?.(); return sp ? c.markAt(sp[0], sp[1]) : 'no spot'; });
    await page.mouse.move(640, 300); await page.mouse.move(660, 310); await page.waitForTimeout(1800);
    r = await read(page);
    check(how === 'set' && r.left.on && JSON.stringify(r.ids) === JSON.stringify(['dtw', 'ttg', 'mark']), `Cruise, a mark set (${how}): the passage block only, MARK, DTW, TTG (${r.ids})`);
    await page.waitForFunction(() => document.documentElement.classList.contains('lk-calm-bar'), null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(900);
    r = await read(page);
    check(!r.left.on, `Cruise: it fades with the bar at rest (${r.left.on})`);
    check(errors.length === 0, `Cruise: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // Regatta: the race plates own the left margin, so the column takes the right edge (no legend outside Sail), RUD always
  {
    const { page, ctx, errors } = await open(`mode=regatta&hud=full&${Q.replace('&navcol=1', '')}`);   // the default: Regatta shows the instruments
    const r = await read(page);
    const plates = await page.evaluate(() => [...document.querySelectorAll('.lk-rg > *')].filter((n) => n.getBoundingClientRect().width > 0 && getComputedStyle(n).visibility !== 'hidden')
      .map((n) => { const b = n.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; }));
    const hit = r.lrows.filter((x) => plates.some((d) => x.l < d.r && x.r > d.l && x.t < d.b && x.b > d.t)).map((x) => x.id);
    check(r.left.on && r.ids.includes('rud') && !r.right.on, `Regatta: the column with RUD, no legend (${r.ids})`);
    check(Math.abs((r.W - r.left.r) - r.mx) <= 1 && hit.length === 0, `Regatta: on the right edge at --lk-mx, clear of ${plates.length} race plates (W - right ${(r.W - r.left.r).toFixed(1)}; over: ${hit.join(',') || 'none'})`);
    check(errors.length === 0, `Regatta: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
  // phones: no legend; the column clear of the dials and the bottom band
  for (const [w, h, name] of [[412, 915, 'upright'], [844, 390, 'sideways']]) {
    const { page, ctx, errors } = await open(`mode=sail&hud=full&${Q.replace('&keylegend=1', '')}`, { w, h, touch: true });
    await page.evaluate(() => { const L = window.__lakeshore, s = L.player.phys.state, a = s.heading + 0.5; L.chart?.chart?.setWaypoint({ x: s.x + Math.sin(a) * 2200, z: s.z - Math.cos(a) * 2200 }); });
    await page.waitForTimeout(2200);
    const r = await read(page);
    const box = await page.evaluate(() => {
      const out = [];
      // (.pad.steer is the sideways phone's invisible thumb-slide zone: nothing drawn, and the column takes no pointer)
      for (const n of document.querySelectorAll('.lk-chart .small,.lk-cv,.lk-helm>:not(.pad.steer)')) {
        const s = getComputedStyle(n); if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.05) continue;
        const b = n.getBoundingClientRect(); if (b.width > 0 && b.height > 0) out.push({ k: n.className.toString().slice(0, 24), l: b.left, t: b.top, r: b.right, b: b.bottom });
      }
      return out;
    });
    const hit = r.lrows.flatMap((x) => box.filter((d) => x.l < d.r && x.r > d.l && x.t < d.b && x.b > d.t).map((d) => `${x.id}/${d.k}`));
    check(!r.right.on, `${name} phone: no key legend (touch has none)`);
    check(r.left.on && JSON.stringify(r.ids) === JSON.stringify(['tws', 'vmg', 'heel', 'dtw', 'ttg']), `${name} phone: the column with TWS, VMG, HEEL and DTW, TTG (${r.ids})`);
    check(hit.length === 0, `${name} phone: no row over a dial or a control (${hit.slice(0, 4).join(', ') || 'none'}; top ${Math.round(r.left.t)}, foot ${Math.round(r.left.b)})`);
    if (name === 'upright') check(r.left.b < 700, `upright phone: nothing in the bottom band (foot ${Math.round(r.left.b)} < 700)`);
    check(errors.length === 0, `${name} phone: no page errors (${errors.slice(0, 2).join(' | ')})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAIL` : 'all PASS');
process.exit(fails ? 1 : 0);
