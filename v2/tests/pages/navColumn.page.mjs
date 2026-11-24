// The nav column on a live v2 page (v2/ui/nav.js, v2/ui/sail.js; v1's src/ui/navColumn.js and src/ui/passage.js as they are):
//   the default   a regular player (Pro off, no mark): the left edge is empty
//   Pro           ?pro=1 or the PRO switch: COG · TWS · TWA | VMG · HEEL · RUD on the left, the boat's own numbers (COG = the
//                 state's course over ground), refreshed while it sails; the helm view keeps it (the legend goes); Clear takes it
//   a waypoint    Sail Pro's click on the enlarged chart (chartplotter setWaypoint): MARK WP, DTW, BTW, TTG, XTE join
//   old keys      v2 has no edge instruments row (owner, 2026-11-17): a stored 'off' never hides the column with Pro on (the owner's
//                 screenshot: Pro on by the cockpit's switch, the left edge empty), a stored 'always' never shows it with Pro off;
//                 ?navcol=0|1 still wins
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/navColumn.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const Q = 'mode=sail&hour=15&wind=2&once=0&noload=1&fv=1&hm=0&chatter=0&hud=full';
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, settings = {}) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, { ...SEEN, ...settings });
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.navColumn && window.__velia.m4.ui.station?.cockpit && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });
  await page.waitForTimeout(1500);
  return { page, errors };
}
// the column as the eye sees it: on, its opacity, the rows shown top to bottom with their strings, its box
const col = (page) => page.evaluate(() => {
  const el = document.querySelector('.lk-nav'); if (!el) return null;
  const rows = [...el.children].filter((r) => !r.classList.contains('fade') && !r.classList.contains('off')).sort((a, b) => +a.style.order - +b.style.order);
  const text = (r) => (r.dataset.id === 'mark' ? r.textContent.trim() : `${r.querySelector('.v')?.textContent ?? ''}${r.querySelector('.u')?.textContent ?? ''}${r.querySelector('.sd')?.textContent ? ` ${r.querySelector('.sd').textContent}` : ''}`);
  const b = el.getBoundingClientRect();
  return { on: el.classList.contains('on'), op: +getComputedStyle(el).opacity, ids: rows.map((r) => r.dataset.id).filter((id) => !id.startsWith('gap')), rows: Object.fromEntries(rows.filter((r) => !r.dataset.id.startsWith('gap')).map((r) => [r.dataset.id, text(r)])),
    box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) } };
});
const state = (page) => page.evaluate(() => { const s = window.__velia.m4.ui.services.get('player').phys.state; return { cog: s.cog * 180 / Math.PI, sog: s.sog }; });

try {
  // ---------------- the default: an empty left edge ----------------
  {
    const { page, errors } = await open(Q);
    const C = await col(page);
    check(!!C && C.on === false && C.ids.length === 0, `Pro off, no mark: the left edge is empty (${JSON.stringify(C && { on: C.on, ids: C.ids })})`);
    // the PRO switch brings the readings (the trim panel's switch, the dock's 'pro')
    await page.evaluate(() => window.__velia.m4.ui.setPro(true)); await page.waitForTimeout(1200);
    const P = await col(page);
    check(P.on && P.op > 0.9 && P.ids.join(' ') === 'cog tws twa vmg heel rud', `Pro on: v1's rows (${P.ids.join(' ')}, opacity ${P.op})`);
    // the key legend mirrors the column (owner, 2026-11-17): six rows, the column's top and bottom, row height and margin, clear of the cockpit
    for (const [w, h] of [[1280, 720], [1920, 1080], [1024, 720]]) {   // under 1100 px the legend is off by rule (keyLegend MIN_WIDTH): geometry only
      await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(1500);
      const L = await page.evaluate(() => { const k = document.querySelector('.lk-keys:not(.tp-keys)'), n = document.querySelector('.lk-nav'), kb = k.getBoundingClientRect(), nb = n.getBoundingClientRect();
        const rows = [...k.querySelectorAll('.kl:not(.off):not(.fade)')];
        return { on: k.classList.contains('on'), ids: rows.map((r) => r.dataset.id).join(' '), rowH: [...new Set(rows.map((r) => Math.round(r.getBoundingClientRect().height)))].join(),
          dTop: Math.round(kb.top - nb.top), dBot: Math.round(kb.bottom - nb.bottom), mR: Math.round(innerWidth - kb.right), mL: Math.round(nb.left), wK: kb.width, wN: nb.width, bottom: Math.round(kb.bottom), vh: innerHeight }; });
      if (w >= 1100) check(L.on && L.ids.split(' ').sort().join(' ') === 'anchor engine jib main tack view' && L.rowH === '36', `${w}x${h}, Pro on: the legend is six 36 px rows (${L.ids}; ${L.rowH})`);
      check(Math.abs(L.dTop) <= 1 && Math.abs(L.dBot) <= 1, `${w}x${h}: the legend's top and bottom are the column's (${L.dTop}, ${L.dBot} px)`);
      check(Math.abs(L.wK / L.wN - 1) <= 0.1, `${w}x${h}: the legend is as wide as the column, within 10 % (${Math.round(L.wK)} vs ${Math.round(L.wN)} px)`);
      check(Math.abs(L.mR - L.mL) <= 1, `${w}x${h}: the legend's right margin is the column's left (${L.mR} vs ${L.mL})`);
    }
    await page.setViewportSize({ width: 1280, height: 720 }); await page.waitForTimeout(800);
    await page.evaluate(() => window.__velia.m4.ui.setPro(false)); await page.waitForTimeout(1200);
    check((await col(page)).on === false, 'Pro off again: empty');
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- ?pro=1: the readings, the boat's numbers, the helm view, Clear, a waypoint ----------------
  {
    const { page, errors } = await open(`${Q}&pro=1`);
    const C = await col(page), s = await state(page);
    check(C.on && C.ids.join(' ') === 'cog tws twa vmg heel rud', `?pro=1: ${Object.entries(C.rows).map(([k, v]) => `${k.toUpperCase()} ${v}`).join(' · ')}`);
    const cog = parseInt(C.rows.cog, 10), d = Math.abs(((cog - s.cog + 540) % 360) - 180);
    check(/^\d{3}°$/.test(C.rows.cog) && d <= 1.5, `COG is the boat's course over ground (${C.rows.cog} vs ${s.cog.toFixed(1)}°)`);
    check(/^\d+(\.\d)?kn$/.test(C.rows.tws) && /^\d+(\.\d)?kn$/.test(C.rows.vmg) && /^\d+° [PS]$|^0°$/.test(C.rows.twa), 'the units on the face: kn, °, P or S');
    check(C.box.x >= 10 && C.box.x < 80 && C.box.y > 200 && C.box.y + C.box.h < 720 * 0.86, `on the left margin, above the coaming dials (${JSON.stringify(C.box)})`);
    // it updates while the boat sails and turns: COG follows
    await page.keyboard.down('KeyA'); await page.waitForTimeout(3000); await page.keyboard.up('KeyA'); await page.waitForTimeout(2500);   // the pilot takes the helm back and the swing dies
    const C2 = await col(page), s2 = await state(page);
    check(C2.rows.cog !== C.rows.cog && Math.abs(((parseInt(C2.rows.cog, 10) - s2.cog + 540) % 360) - 180) <= 3, `a turn to port: COG ${C.rows.cog} → ${C2.rows.cog} (the boat's ${s2.cog.toFixed(1)}°; within 3°: the column samples at 4 Hz)`);
    // the helm view keeps it (owner decision 4); the key legend goes
    await page.evaluate(() => window.__velia.m4.ui.views.set('helm')); await page.waitForTimeout(1500);
    check((await col(page)).on === true, 'the helm view: the column stays');
    await page.evaluate(() => window.__velia.m4.ui.views.set('follow')); await page.waitForTimeout(800);
    // Clear takes it (the Calm HUD's preset)
    await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('clear')); await page.waitForTimeout(800);
    const cl = await page.evaluate(() => window.__velia.m4.ui.calm.mode);
    if (cl === 'clear') { check((await col(page)).on === false, 'Clear: the column goes'); await page.evaluate(() => window.__velia.m4.ui.calm.setPreset('full')); await page.waitForTimeout(800); }
    // a waypoint on the chart (Sail Pro's click on the enlarged chart): the passage block joins
    const ok = await page.evaluate(() => { const ui = window.__velia.m4.ui, c = ui.chart?.chart, s = ui.services.get('player').phys.state; if (!c) return false; c.setWaypoint({ x: s.x + 400, z: s.z - 600 }); return true; });
    await page.waitForTimeout(2200);
    const W = await col(page);
    check(ok && W.ids.join(' ') === 'cog tws twa vmg heel rud mark dtw btw ttg xte' && W.rows.mark === 'MARK WP' && /nm$/.test(W.rows.dtw) && /^\d{3}°$/.test(W.rows.btw),
      `a chart waypoint: ${W.ids.slice(6).map((k) => `${k.toUpperCase()} ${W.rows[k]}`).join(' · ')}`);
    check(errors.length === 0, `no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- old Setup keys never decide it; ?navcol ----------------
  {
    const a = await open(Q, { edgeInstruments: 'always' });
    check((await col(a.page)).on === false, 'a stored "always", Pro off: the left edge stays empty (the column follows Pro)');
    await a.page.close();
    // the owner's case: an old 'off' and HUD Calm in the store, Pro switched on by the player (the PRO recess's path)
    const o = await open(Q.replace('&hud=full', ''), { edgeInstruments: 'off', hud: 'calm' });
    await o.page.evaluate(() => window.__velia.m4.ui.setPro(true, { user: true }));
    await o.page.mouse.move(640, 600); await o.page.mouse.move(650, 620); await o.page.waitForTimeout(1500);
    const O = await col(o.page);
    check(O.on && O.op > 0.9 && O.ids.join(' ') === 'cog tws twa vmg heel rud', `a stored "off", Pro switched on: the readings show (${O.ids.join(' ')}, opacity ${O.op})`);
    check(await o.page.evaluate(() => JSON.parse(localStorage.getItem('lakeshore.settings.v1')).proMode === true), 'the switch is remembered (proMode, its only store)');
    await o.page.close();
    const n0 = await open(`${Q}&pro=1&navcol=0`);
    check((await col(n0.page)).on === false, '?navcol=0: never');
    await n0.page.close();
    const n1 = await open(`${Q}&navcol=1`, { edgeInstruments: 'off' });
    check((await col(n1.page)).on === true, '?navcol=1: shown whatever the setting');
    await n1.page.close();
    const errs = [...a.errors, ...o.errors, ...n0.errors, ...n1.errors];
    check(errs.length === 0, `no page errors (${errs.join(' | ')})`);
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
