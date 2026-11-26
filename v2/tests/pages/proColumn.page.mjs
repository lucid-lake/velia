// The Pro column's layout on phones (fix/v2-pro-slider, 2026-11-14; the owner's iPhone 16 Pro upright drew the PRO slider panel,
// TRAVELLER / TWIST / WING, at 0,0 over the top bar and its buttons). With Pro on and ?diag=1, at each phone size:
//   - the pro trim panel (src/stations/sloop/trimPanel.js, .lk-tp): when shown (.in) its box intersects none of the top bar
//     (.lk-view), the helm strip (#hands), the instruments (.lk-cv, the cockpit's .lk-inst) or the diag panel (#diag); upright
//     it is not shown at all (v1 never places it on an upright phone either: its layout has no trim rect)
//   - no left-edge column on a phone (the nav column went on 2026-11-25) and no Pro instruments panel (a desktop only, even with
//     ?prohud=1: v2/ui/proHud.js)
//   - since a phone has the flat controls (no station, no trim panel, no nav column): Pro's own panel in the ⋯ drawer
//     is on screen and clear of the top bar
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/proColumn.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, proMode: true };
const SIZES = [['iPhone 16 Pro upright', 402, 874], ['393x852 upright', 393, 852], ['390x844 upright', 390, 844], ['852x393 sideways', 852, 393]];

const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  for (const [name, w, h] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    await page.goto(`${BASE}/?start=1200,-1050&heading=251&mode=sail&hour=13&seed=1&once=0&noload=1&fv=1&quality=1&diag=1&pro=1&prohud=1`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.ready && (window.__velia.m4?.ui?.station || window.__velia.m4?.ui?.flat?.shown) && window.__velia.boat?.sim?.t > 1, null, { timeout: 240000 });   // a phone has the flat controls, no station
    await page.waitForTimeout(2500);
    const L = await page.evaluate(() => {
      const seen = (e) => { if (!e || e.hidden) return false; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      const box = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      const all = (sel) => [...document.querySelectorAll(sel)].filter(seen).map((e) => ({ sel, ...box(e) }));
      const tp = document.querySelector('.lk-tp');
      return {
        pro: !!window.__velia.m4.ui.pro,
        upright: innerHeight > innerWidth,
        tp: tp && tp.classList.contains('in') && seen(tp) ? box(tp) : null,
        nav: !!document.querySelector('.lk-nav'), proi: [...document.querySelectorAll('.lk-proi')].some(seen),
        bar: all('.lk-view'), hands: all('#hands'), inst: all('.lk-cv, .lk-inst'), diag: all('#diag'),
        sal: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lk-sal')) || 0, iw: innerWidth, ih: innerHeight,
      };
    });
    const hit = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) + 0.5 && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y) + 0.5;
    const hits = (r, list) => list.filter((o) => hit(r, o)).map((o) => o.sel);
    check(L.pro, `${name}: Pro is on`);
    check(L.bar.length > 0, `${name}: the top bar is drawn`);
    if (L.upright) check(!L.tp, `${name}: upright, the pro trim panel is not shown (v1 never places it there)${L.tp ? ` (at ${Math.round(L.tp.x)},${Math.round(L.tp.y)})` : ''}`);
    if (L.tp) {
      const h1 = hits(L.tp, [...L.bar, ...L.hands, ...L.inst, ...L.diag]);
      check(h1.length === 0, `${name}: the pro trim panel clears the top bar, helm strip, instruments and diag (${h1.join(', ') || 'clear'})`);
    }
    check(!L.nav && !L.proi, `${name}: no left-edge column and no Pro instruments panel on a phone (nav ${L.nav}, panel ${L.proi})`);
    // a phone's flat controls (v2/ui/flat.js): Pro's own panel opens from ⋯, inside the screen and clear of the top bar
    const fp = await page.evaluate(() => {
      const f = window.__velia.m4.ui.flat; if (!f?.on) return null;
      f.open(true);
      const b = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
      const pro = f.el.querySelector('.sheet.pro'), bar = [...document.querySelectorAll('.lk-view:not(.off) button')].map(b).filter((r) => r.w > 0);
      const out = { shown: !pro.hidden, pro: b(pro), bar, iw: innerWidth, ih: innerHeight };
      f.open(false);
      return out;
    });
    if (fp) {
      check(fp.shown, `${name}: the flat controls: Pro on shows Pro's panel in the ⋯ drawer`);
      check(hits({ ...fp.pro }, fp.bar.map((r) => ({ sel: 'bar', ...r }))).length === 0 && fp.pro.x >= 0 && fp.pro.y >= 0 && fp.pro.x + fp.pro.w <= fp.iw && fp.pro.y + fp.pro.h <= fp.ih,
        `${name}: Pro's panel is on screen and clear of the top bar (${JSON.stringify(Object.values(fp.pro).map(Math.round))})`);
    }
    check(errors.length === 0, `${name}: no page errors${errors.length ? ` (${errors[0]})` : ''}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `proColumn: ${fails} FAIL` : 'proColumn: all PASS');
process.exit(fails ? 1 : 0);
