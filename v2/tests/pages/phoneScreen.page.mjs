// A phone's screen space (owner 2026-11-16; v2/ui/screenFit.js, v2/ui/install.js) on the real v2 page under real CDP
// touches (an iPhone's Safari UA, hasTouch, isMobile), at a browser tab's height and the Home Screen's: 844 × 340 and 844 × 390 held
// sideways, and 340 × 844 and 390 × 844 held upright (the landscape page turned to the same frames):
//   - the tier: html.lk-short at 340, lk-tall at 390; the flat controls take the compact or the full sizes; a resize between the two
//     (Safari's bars) re-lays them out live
//   - Sail: every control inside the frame and the safe areas, ≥ 44 px, nothing over anything else (the top bar too); the drawer, the
//     Pro panel and the Conditions sheet inside the frame; the Menu card inside the frame, its "Add to Home Screen" row ≥ 44 px
//   - Regatta: the hub and its Custom sheet inside the frame (or scrolling inside it)
//   - the safe areas: an iPhone's insets keep every control off the notch, sideways and turned (the turned page's insets a quarter round);
//     a notched iPhone whose insets read 0 while the page spans the screen gets the fallback (html.lk-fit-fallback), ?fit=cover never
//   - the Home Screen card: a first visit never (however long the sail); a later visit once, "Not now" closes it and it stays closed;
//     the Home Screen app never; upright it points at Safari's toolbar (the turned page's right); the Menu row opens it
//   - the manifest: linked, served as application/manifest+json, valid, its icons served as PNGs
// Run by `npm run test:pages:v2 -- phoneScreen`, or node v2/tests/pages/phoneScreen.page.mjs --base http://127.0.0.1:<port> [--shots <dir>]
import { chromium } from 'playwright-core';
import { overlaps } from '../../ui/flat.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : (process.env.LAKESHORE_SHOTS || null);   // a folder: the stills
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SIDE = { top: 0, bottom: 21, left: 59, right: 59 }, UP = { top: 59, bottom: 34, left: 0, right: 0 };
// [name, W, H, insets, standalone]
const SIZES = [
  ['sideways 844x340', 844, 340, SIDE, false],
  ['sideways 844x390', 844, 390, SIDE, true],
  ['turned 340x844', 340, 844, UP, false],
  ['turned 390x844', 390, 844, UP, true],
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });

async function open({ W, H, insets = null, standalone = false, query = 'mode=sail&hour=13&seed=1&windspeed=7.7', record = null, ready = 'flat', ctx: ctx0 = null }) {
  const ctx = ctx0 ?? await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: UA });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (insets) await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }).catch(() => {});
  if (standalone) await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'display-mode', value: 'standalone' }] }).catch(() => {});
  if (standalone) await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'standalone', { configurable: true, get: () => true }); });   // iOS's own Home Screen flag (the display-mode emulation is not in every Chrome)
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  if (record) await page.addInitScript((r) => { try { if (!sessionStorage.getItem('t-rec')) { localStorage.setItem('velia.install.v1', JSON.stringify(r)); sessionStorage.setItem('t-rec', '1'); } } catch { /* blocked */ } }, record);
  await page.goto(`${BASE}/?${query}&once=0&quality=1&kayaks=0&hud=full`, { waitUntil: 'load' });
  if (ready === 'flat') await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui?.flat?.on && window.__velia.m4.ui.flat.shown, null, { timeout: 240000 });
  else await page.waitForFunction(ready, null, { timeout: 240000 });
  await page.waitForFunction(() => { const r = document.getElementById('lk-load'); return !r || r.dataset.state === 'gone'; }, null, { timeout: 20000 }).catch(() => {});   // the loading card gone
  await page.waitForTimeout(1500);
  const scr = (pts) => page.evaluate((p) => p.map(([x, y]) => (window.__veliaTurn ? window.__veliaTurn.toScreen(x, y) : [x, y])), pts);
  const tap = async (p) => { const [sp] = await scr([p]); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sp[0], y: sp[1], id: 0 }] }); await wait(70); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await wait(350); };
  const tapEl = async (sel) => { const c = await page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }, sel); if (c) await tap(c); return !!c; };
  return { ctx, page, cdp, errors, tap, tapEl };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

// what is on screen: the flat controls (their layout shapes), the readout, the recentre chip and the top bar's buttons
const screenShapes = (page) => page.evaluate(() => {
  const fl = window.__velia.m4.ui.flat, L = fl.layout, S = {}, el = fl.el;
  const vis = (n) => { if (!n || n.hidden) return null; const c = getComputedStyle(n); if (c.display === 'none' || c.visibility === 'hidden' || +c.opacity < 0.05) return null; const r = n.getBoundingClientRect(); return r.width > 1 && r.height > 1 ? { kind: 'rect', x: r.x, y: r.y, w: r.width, h: r.height } : null; };
  for (const [k, s] of Object.entries(L.shapes)) {
    const n = { auto: '.auto', take: '.take', tack: '.tack', steer: '.side.l', sheet: '.side.r', more: '.more', 'dial-chart': '.dl[data-k=chart]', 'dial-wind': '.dl[data-k=wind]', jib: '.side.r' }[k];
    if (n && vis(el.querySelector(n))) S[k] = s;
  }
  for (const [k, q] of [['readout', '.ro'], ['recentre', '.rc']]) { const r = vis(el.querySelector(q)); if (r) S[k] = r; }
  const bs = [...document.querySelectorAll('.lk-view:not(.off) button')].map(vis).filter(Boolean);
  if (bs.length) { const x0 = Math.min(...bs.map((b) => b.x)), y0 = Math.min(...bs.map((b) => b.y)), x1 = Math.max(...bs.map((b) => b.x + b.w)), y1 = Math.max(...bs.map((b) => b.y + b.h)); S.topbar = { kind: 'rect', x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; }
  const box = (s) => s.kind === 'rect' ? s : s.kind === 'circle' ? { x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r } : s.kind === 'quarter' ? { x: s.p.side > 0 ? s.p.x : s.p.x - s.r, y: s.p.y - s.r, w: s.r, h: s.r } : { x: s.p.side > 0 ? s.p.x : s.p.x - s.r1, y: s.p.y - s.r1, w: s.r1, h: s.r1 };
  const boxes = Object.fromEntries(Object.entries(S).map(([k, s]) => [k, box(s)]));
  const ins = window.__veliaScreen?.insets?.() ?? {};
  return { S, boxes, w: innerWidth, h: innerHeight, ins, q: L.q, dial: L.dials.chart.d, tall: L.tall, tier: window.__veliaScreen?.tier?.(), cls: { short: document.documentElement.classList.contains('lk-short'), tall: document.documentElement.classList.contains('lk-tall'), fb: document.documentElement.classList.contains('lk-fit-fallback') } };
});
// a block inside the frame: its box (or, for a scrolling block, its own box) within 0..w × 0..h
const inFrame = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s); if (!e) return { found: false };
  const r = e.getBoundingClientRect(), W = innerWidth, H = innerHeight;
  const scrolls = e.scrollHeight > e.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(e).overflowY);
  const inScroller = (n) => { for (let p = n.parentElement; p && p !== e.parentElement; p = p.parentElement) { if (p.scrollHeight > p.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(p).overflowY)) return true; } return false; };
  const cut = [...e.querySelectorAll('*')].filter((n) => { const q = n.getBoundingClientRect(); if (q.width < 1 || q.height < 1 || getComputedStyle(n).visibility === 'hidden') return false; return !scrolls && !inScroller(n) && (q.bottom > H + 0.5 || q.right > W + 0.5 || q.left < -0.5 || q.top < -0.5); }).length;
  return { found: true, ok: r.left >= -0.5 && r.top >= -0.5 && r.right <= W + 0.5 && r.bottom <= H + 0.5 && cut === 0, r: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)], W, H, scrolls, cut };
}, sel);

try {
  // ---------------- the manifest ----------------
  {
    const res = await fetch(`${BASE}/brand/app/velia.webmanifest`);
    const ct = res.headers.get('content-type') ?? '';
    let m = null; try { m = await res.json(); } catch { m = null; }
    check(res.ok && /manifest\+json/.test(ct) && m?.name === 'Velia' && m.display === 'fullscreen' && m.orientation === 'landscape', `the manifest served (${res.status}, ${ct}): name ${m?.name}, display ${m?.display}, ${m?.orientation}`);
    const icons = await Promise.all((m?.icons ?? []).map(async (ic) => { const r = await fetch(`${BASE}${ic.src}`); return r.ok && r.headers.get('content-type') === 'image/png'; }));
    check(icons.length >= 3 && icons.every(Boolean), `its ${icons.length} icons served as PNGs`);
    const at = await fetch(`${BASE}/brand/app/velia-icon-180.png`);
    check(at.ok, 'the apple-touch-icon served');
  }

  // ---------------- the sizes ----------------
  for (const [name, W, H, insets, standalone] of SIZES) {
    const turned = H > W;
    const t = await open({ W, H, insets, standalone });
    const { page } = t;
    let s = await screenShapes(page);
    const short = Math.min(W, H) < 370;
    check(s.tier === (short ? 'short' : 'tall') && s.cls.short === short && s.cls.tall === !short && s.tall === !short, `${name}: the ${short ? 'compact' : 'full'} tier (tier ${s.tier}, quarter ${s.q}, dials ${s.dial} px)`);
    check(!s.cls.fb, `${name}: insets read, no fallback (${JSON.stringify(s.ins)})`);
    const bad = overlaps(s.S, 2);
    check(bad.length === 0, `${name}, Sail: nothing overlaps (${Object.keys(s.S).join(', ')})${bad.length ? `: ${bad.map((p) => p.join(' × ')).join('; ')}` : ''}`);
    const out = Object.entries(s.boxes).filter(([k, b]) => b.x < -0.5 || b.y < -0.5 || b.x + b.w > s.w + 0.5 || b.y + b.h > s.h + 0.5).map(([k]) => k);
    check(out.length === 0, `${name}, Sail: all inside the frame ${s.w}×${s.h} (${out.join(', ') || 'yes'})`);
    const safe = Object.entries(s.boxes).filter(([k]) => k !== 'topbar').filter(([, b]) => b.x < (s.ins.left ?? 0) - 0.5 || b.x + b.w > s.w - (s.ins.right ?? 0) + 0.5 || b.y + b.h > s.h - (s.ins.bottom ?? 0) + 0.5).map(([k]) => k);
    check(safe.length === 0 && (s.ins.left ?? 0) >= 50, `${name}: every control inside the safe area (layout insets ${JSON.stringify(s.ins)}; outside: ${safe.join(', ') || 'none'})`);
    const small = await page.evaluate(() => [...window.__velia.m4.ui.flat.el.querySelectorAll('button:not([hidden]):not(.dl)')].filter((b) => getComputedStyle(b).display !== 'none' && b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return [b.className, Math.round(r.width), Math.round(r.height)]; }).filter(([, w, h]) => w < 44 || h < 44));
    check(small.length === 0, `${name}: every flat button ≥ 44 px (${JSON.stringify(small)})`);
    const barBtns = await page.evaluate(() => [...document.querySelectorAll('.lk-view:not(.off) button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right), Math.round(r.bottom)]; }));
    check(barBtns.length > 0 && barBtns.every(([l, r, b]) => l >= -0.5 && r <= s.w + 0.5 && b <= s.h / 2), `${name}: the top bar's ${barBtns.length} buttons inside the frame`);
    await shot(page, `${name.replace(/\W+/g, '-')}-sail`);

    // the drawer and the Pro panel
    const L = await page.evaluate(() => window.__velia.m4.ui.flat.layout);
    await t.tap([L.more.x, L.more.y]);
    const dr = await inFrame(page, '.lk-flat .sheet.drawer');
    check(dr.found && dr.ok, `${name}: the drawer inside the frame (${JSON.stringify(dr)})`);
    await shot(page, `${name.replace(/\W+/g, '-')}-drawer`);
    const proOn = await page.evaluate(() => { const b = window.__velia.m4.ui.flat.el.querySelector('.row[data-row=pro] .pair button[data-v="1"]'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    if (proOn) {
      await t.tap(proOn);
      const pr = await inFrame(page, '.lk-flat .sheet.pro');
      check(pr.found && pr.ok, `${name}: the Pro panel inside the frame (${JSON.stringify(pr)})`);
      await shot(page, `${name.replace(/\W+/g, '-')}-pro`);
      const proOff = await page.evaluate(() => { const b = window.__velia.m4.ui.flat.el.querySelector('.row[data-row=pro] .pair button[data-v="0"]'); const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
      await t.tap(proOff);
    }
    await t.tap([s.w / 2, s.h / 2]);   // a tap outside closes them
    check(!(await page.evaluate(() => window.__velia.m4.ui.flat.drawer)), `${name}: a tap outside closes the drawer`);

    // the Conditions sheet
    if (await t.tapEl('.lk-view:not(.off) .xt[data-x=cond]')) {
      await wait(400);
      const cs = await inFrame(page, '.lk-cond:not([hidden])');
      check(cs.found && cs.ok, `${name}: the Conditions sheet inside the frame (${JSON.stringify(cs)})`);
      await shot(page, `${name.replace(/\W+/g, '-')}-conditions`);
      await page.keyboard.press('Escape'); await wait(300);
      if (await page.evaluate(() => !!document.querySelector('.lk-cond:not([hidden])'))) await t.tapEl('.lk-view:not(.off) .xt[data-x=cond]');
    } else check(false, `${name}: the Conditions pill found`);

    // the Menu card and its Home Screen row
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__velia.m4.front.home.isOpen, null, { timeout: 8000 }).catch(() => {});
    await wait(600);
    const mc = await inFrame(page, '#lk-load .lk-card');
    check(mc.found && mc.ok, `${name}: the Menu card inside the frame (${JSON.stringify(mc)})`);
    await page.evaluate(() => document.querySelector('#lk-load .lk-pmore')?.click()); await wait(250);   // the phone card folds its foot into the ⋯ menu (v2/ui/phoneCard.js): open it for the row
    const row = await page.evaluate(() => { const b = document.querySelector('#lk-load .lk-foot .lk-a2hs'); if (!b) return null; const r = b.getBoundingClientRect(), c = document.querySelector('#lk-load .lk-card').getBoundingClientRect(); return { shown: getComputedStyle(b).display !== 'none' && r.width > 0, w: Math.round(r.width), h: Math.round(r.height), inCard: r.left >= c.left - 0.5 && r.right <= c.right + 0.5 && r.bottom <= c.bottom + 0.5, text: b.textContent }; });
    if (standalone) check(row && !row.shown, `${name} (Home Screen app): no Add to Home Screen row (${JSON.stringify(row)})`);
    else check(row?.shown && row.h >= 44 && row.inCard && row.text === 'Add to Home Screen', `${name}: the Menu card's "Add to Home Screen" row, ${row?.w} × ${row?.h}, inside the card`);
    await shot(page, `${name.replace(/\W+/g, '-')}-menu`);
    if (!standalone && row?.shown) {
      await t.tapEl('#lk-load .lk-foot .lk-a2hs');
      await wait(500);
      const c = await page.evaluate(() => window.__veliaInstall?.card);
      check(c?.kind === 'ios' && c.spot === (turned ? 'right' : 'top'), `${name}: the row opens the iPhone card, pointing ${c?.spot} (${JSON.stringify(c)})`);
      const ic = await inFrame(page, '.lk-a2hs-card');
      check(ic.found && ic.ok, `${name}: the card inside the frame (${JSON.stringify(ic)})`);
      await shot(page, `${name.replace(/\W+/g, '-')}-install-card`);
      await t.tapEl('.lk-a2hs-card .no'); await wait(400);
      check(!(await page.evaluate(() => window.__veliaInstall?.card)), `${name}: Not now closes it`);
    }
    check(t.errors.length === 0, `${name}: no page errors (${t.errors.slice(0, 2).join(' | ')})`);
    await t.ctx.close();
  }

  // ---------------- Regatta: the hub and its Custom sheet ----------------
  for (const [name, W, H, insets, standalone] of SIZES) {
    const t = await open({ W, H, insets, standalone, query: 'mode=regatta&seed=1&handseed=7', ready: () => window.__velia?.regatta?.r?.hubOpen && window.__velia.frames > 20 });
    const hub = await t.page.evaluate(() => {
      const W = innerWidth, H = innerHeight, vis = (e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0 ? r : null; };
      const out = [...document.querySelectorAll('#rgh .col > *, #rgh .cups > *, #rgh .go, #rgh .row')].map((e) => [e.className || e.tagName, vis(e)]).filter(([, r]) => r && (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5)).map(([c, r]) => `${c} ${Math.round(r.bottom)}`);
      const btns = [...document.querySelectorAll('#rgh .go, #rgh .row')].map(vis).filter(Boolean);
      return { W, H, out, minBtn: Math.round(Math.min(...btns.map((r) => r.height))), n: btns.length };
    });
    check(hub.out.length === 0 && hub.minBtn >= 43.5, `${name}: the Regatta hub inside the ${hub.W} × ${hub.H} frame (outside: ${hub.out.join(', ') || 'none'}; ${hub.n} buttons, the least ${hub.minBtn} px tall)`);
    await shot(t.page, `${name.replace(/\W+/g, '-')}-regatta-hub`);
    if (await t.tapEl('#rgh .cusr')) {
      await wait(700);
      const cs = await inFrame(t.page, '#rgh .cus');
      check(cs.found && cs.ok, `${name}: the Custom sheet inside the frame (${JSON.stringify(cs)})`);
      await shot(t.page, `${name.replace(/\W+/g, '-')}-regatta-custom`);
    } else check(false, `${name}: the hub's Custom race row found`);
    check(t.errors.length === 0, `${name}, Regatta: no page errors (${t.errors.slice(0, 2).join(' | ')})`);
    await t.ctx.close();
  }

  // ---------------- no Fireworks pick on a phone (owner, 2026-11-19; src/core/features.js fireworks: off on a phone) ----------------
  {
    const t = await open({ W: 844, H: 390, insets: SIDE, query: 'mode=sail&hour=21&seed=1&windspeed=7.7' });
    await t.tapEl('.lk-view:not(.off) .xt[data-x=cond]'); await wait(600);
    const r = await t.page.evaluate(() => { const sh = document.querySelector('.lk-cond:not([hidden])'); return { open: !!sh, fw: !!sh?.querySelector('[data-t=fireworks], .fw'), text: sh?.innerText ?? '', hours: [...(sh?.querySelectorAll('.seg [data-t]') ?? [])].map((b) => b.textContent.trim()).join('|') }; });
    check(r.open && !r.fw && !/fireworks/i.test(r.text) && r.hours === 'Dawn|Midday|Golden|Night', `phone 844x390: the Conditions sheet has no Fireworks pick and no ✳ (the four cuts: ${r.hours})`);
    check(t.errors.length === 0, `phone Fireworks pick: no page errors (${t.errors.slice(0, 2).join(' | ')})`);
    await t.ctx.close();
  }

  // ---------------- live: the bars come and go (a resize between the tiers) ----------------
  {
    const t = await open({ W: 844, H: 390, insets: SIDE });
    const a = await screenShapes(t.page);
    await t.page.setViewportSize({ width: 844, height: 340 }); await wait(800);
    const b = await screenShapes(t.page);
    await t.page.setViewportSize({ width: 844, height: 390 }); await wait(800);
    const c = await screenShapes(t.page);
    check(a.tier === 'tall' && b.tier === 'short' && c.tier === 'tall' && b.q < a.q && c.q === a.q && b.h === 340, `live: 390 → 340 → 390 px re-lays out (tier ${a.tier} → ${b.tier} → ${c.tier}, quarter ${a.q} → ${b.q} → ${c.q})`);
    const bad = overlaps(b.S, 2), out = Object.entries(b.boxes).filter(([, x]) => x.y + x.h > b.h + 0.5).map(([k]) => k);
    check(bad.length === 0 && out.length === 0, `live: at 340 px nothing overlaps and nothing below the foot (${out.join(', ') || 'none'})`);
    await t.ctx.close();
  }

  // ---------------- the safe-area fallback ----------------
  for (const [what, query, want] of [['insets 0 (the Safari 26 bug)', 'mode=sail&hour=13&seed=1', true], ['?fit=cover', 'mode=sail&hour=13&seed=1&fit=cover', false]]) {
    const t = await open({ W: 844, H: 390, insets: { top: 0, bottom: 0, left: 0, right: 0 }, query });
    const s = await screenShapes(t.page);
    const left = Math.min(...Object.entries(s.boxes).filter(([k]) => k !== 'topbar').map(([, b]) => b.x));
    check(s.cls.fb === want && (!want || left >= 59), `fallback, ${what}: ${want ? 'on, the controls off the notch' : 'off'} (fallback ${s.cls.fb}, insets ${JSON.stringify(s.ins)}, leftmost control x ${left.toFixed(0)})`);
    await t.ctx.close();
  }

  // ---------------- the Home Screen card's rules ----------------
  {
    // a first visit: never, however long the sail
    const t1 = await open({ W: 844, H: 390, insets: SIDE });
    const r1 = await t1.page.evaluate(() => { const I = window.__veliaInstall; for (let i = 0; i < 400; i++) I.tick(); return { card: I.card, rec: I.record, sailed: I.sailedS }; });
    check(r1.rec.visits === 1 && !r1.card && r1.sailed >= 300, `install: a first visit never asks (visit ${r1.rec.visits}, ${r1.sailed} s sailed, card ${JSON.stringify(r1.card)})`);
    await t1.ctx.close();
    // a later visit: once, after a little sailing; Not now; then not again this visit
    const t2 = await open({ W: 844, H: 390, insets: SIDE, record: { visits: 1, lastAt: 0, shown: 0, shownVisit: 0 } });
    const r2 = await t2.page.evaluate(() => { const I = window.__veliaInstall; let at = null; for (let i = 0; i < 60 && !I.card; i++) { I.tick(); if (I.card) at = I.sailedS; } return { card: I.card, rec: I.record, at }; });
    check(r2.rec.visits === 2 && r2.card?.kind === 'ios' && r2.card.spot === 'top' && r2.rec.shown === 1 && r2.at >= 20, `install: a later visit asks once, after ${r2.at} s of sailing, pointing at the top bar (${JSON.stringify(r2.card)})`);
    await wait(400); await shot(t2.page, 'install-card-sideways-844x390');
    const words = await t2.page.evaluate(() => document.querySelector('.lk-a2hs-card p')?.textContent ?? '');
    check(words === 'For full screen: tap Share, then Add to Home Screen.', `install: the card's line ("${words}")`);
    await t2.tapEl('.lk-a2hs-card .no'); await wait(400);
    const r3 = await t2.page.evaluate(() => { const I = window.__veliaInstall; for (let i = 0; i < 400; i++) I.tick(); return { card: I.card, rec: I.record }; });
    check(!r3.card && r3.rec.shown === 1, `install: Not now closes it, and it does not ask again this visit (${JSON.stringify(r3)})`);
    await t2.ctx.close();
    // the Home Screen app: never
    const t4 = await open({ W: 844, H: 390, insets: SIDE, standalone: true, record: { visits: 5, lastAt: 0, shown: 0, shownVisit: 0 } });
    const r4 = await t4.page.evaluate(() => { const I = window.__veliaInstall; for (let i = 0; i < 400; i++) I.tick(); return { card: I.card, standalone: document.documentElement.classList.contains('lk-standalone') }; });
    check(r4.standalone && !r4.card, `install: the Home Screen app never asks (standalone ${r4.standalone}, card ${JSON.stringify(r4.card)})`);
    await t4.ctx.close();
    // upright: the card points at Safari's toolbar (the turned page's right edge)
    const t5 = await open({ W: 390, H: 844, insets: UP, record: { visits: 1, lastAt: 0, shown: 0, shownVisit: 0 } });
    const r5 = await t5.page.evaluate(() => { const I = window.__veliaInstall; for (let i = 0; i < 60 && !I.card; i++) I.tick(); return I.card; });
    check(r5?.spot === 'right', `install: upright, the card points at Safari's toolbar (${JSON.stringify(r5)})`);
    await wait(400); await shot(t5.page, 'install-card-turned-390x844');
    await t5.ctx.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} check(s) failed` : '\nall phoneScreen checks pass');
process.exit(fails ? 1 : 0);
