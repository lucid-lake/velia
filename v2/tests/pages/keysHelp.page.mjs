// The desktop key help on the LEAN key set (owner, 2026-11-20) on the real v2 page: Menu › Keys lists the lean keys (R F on
// the Pro tab only; tabs Keys | Cruise | Mouse, touch | Pro trim; no scroll at 1280 × 720, on the Mouse tab too); H is a tap that folds
// the cockpit on key-down and holds no list; the removed keys do nothing (K: the REEF switch is the reef's, with the sails down it still
// says nothing on the skipper's line; L, O, M, `, 1–4, U, G, Shift+C, ?); the crew's net has its Setup button; and the audit's two open
// checks: Shift+F has no v2 handler (the top bar's Full button is full screen), and the live chart's focus never double-fires a key
// (the chart pans and zooms, the boat is not steered, trimmed or throttled). Run by `npm run test:pages:v2 -- keysHelp`.
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
    // Shift+F probe: count every requestFullscreen the page makes
    window.__fsCalls = 0; const orig = Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = function (...a) { window.__fsCalls++; try { return orig?.apply(this, a); } catch { return Promise.resolve(); } };
    try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true, autoReef: false })); } catch {} });
  await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&kayaks=0&wind=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front, null, { timeout: 240000 });
  await pickMode(page, 'sail');
  await page.waitForFunction(() => window.__veliaLoading.state === 'gone', null, { timeout: 20000 });
  await page.waitForTimeout(2000);
  const folded = () => page.evaluate(() => !!window.__velia.m4.ui.services.get('calm')?.folded);

  // H: no list (held for a second shows nothing), and a tap folds the cockpit on key-down, again unfolds
  await page.keyboard.down('KeyH'); await page.waitForTimeout(1000);
  const h = await page.evaluate(() => { const U = window.__velia.m4.ui.hint; return { cur: U.current, caps: U.el.querySelectorAll('.list .cap').length }; });
  check(h.cur !== 'keys' && h.caps === 0, `H held 1 s: no key list (hint ${h.cur}, ${h.caps} caps)`);
  await page.keyboard.up('KeyH'); await page.waitForTimeout(300);
  await page.keyboard.press('KeyH'); await page.waitForTimeout(150);
  const f1 = await folded();
  await page.keyboard.down('KeyH'); await page.waitForTimeout(60);
  const f2 = await folded();   // the fold is on key-down: before the key is up
  await page.keyboard.up('KeyH'); await page.waitForTimeout(500);
  const f3 = await folded();
  check(f2 !== f1 && f3 === f2, `H folds on key-down, once per press (${f1} → ${f2} → ${f3} after the key came up)`);
  if (f3) { await page.keyboard.press('KeyH'); await page.waitForTimeout(500); }

  // the key legend: the lean rows, no R F in basic
  const leg = await page.evaluate(() => [...document.querySelectorAll('.lk-keys:not(.tp-keys) .kl:not(.off):not(.fade)')].sort((a, b) => +a.style.order - +b.style.order).map((r) => r.dataset.id));
  check(leg.join(' ') === 'main tack view bino engine anchor', `legend (basic): W S, Space, C, B, I, J (${leg.join(' ')})`);
  await page.evaluate(() => window.__velia.m4.ui.setPro(true)); await page.waitForTimeout(400);
  const legP = await page.evaluate(() => [...document.querySelectorAll('.lk-keys:not(.tp-keys) .kl:not(.off):not(.fade)')].sort((a, b) => +a.style.order - +b.style.order).map((r) => r.dataset.id));
  check(legP.join(' ') === 'main jib tack view engine anchor', `legend (Pro): R F takes B's place after W S, still six rows (${legP.join(' ')})`);
  await page.evaluate(() => window.__velia.m4.ui.setPro(false)); await page.waitForTimeout(300);

  // Shift+F: no v2 handler; the top bar's Full button is the way (and the probe sees it)
  await page.keyboard.press('Shift+KeyF'); await page.waitForTimeout(300);
  const fs0 = await page.evaluate(() => window.__fsCalls);
  const fsLabel = await page.evaluate(() => document.querySelector('.lk-view .xt[data-x=fullscreen]')?.getAttribute('aria-label') ?? null);
  check(fs0 === 0, `Shift+F does nothing on v2 (${fs0} requestFullscreen calls)`);
  check(fsLabel != null && !/Shift/.test(fsLabel), `the Full button's label has no Shift+F (${fsLabel})`);
  await page.click('.lk-view .xt[data-x=fullscreen]'); await page.waitForTimeout(300);
  check((await page.evaluate(() => window.__fsCalls)) >= 1, 'the Full button does ask for full screen (the probe works)');
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen?.()); await page.waitForTimeout(300);

  // the removed keys do nothing
  const snap = () => page.evaluate(() => { const V = window.__velia, B = V.boat.sim, U = V.m4.ui; return { reef: B.reefSel, level: V.boat.wind?.level ?? null, wing: !!B.ctl.jibSide, view: U.views?.view, log: !!U.services.get('logbook')?.logbook?.isOpen, ch: U.services.get('captainTools')?.channel ?? null, muted: !!window.__velia.music?.core?.muted, mode: document.querySelector('.lk-view .xt[data-x=mode] .w')?.textContent ?? null, lines: V.boat.sim.sea?.tackle?.mode ?? null, chase: !!B.follow?.chase }; });
  const s0 = await snap();
  for (const code of ['KeyK', 'KeyG', 'KeyL', 'KeyO', 'KeyM', 'KeyU', 'Digit1', 'Digit4', 'Backquote', 'Shift+KeyC', 'Shift+Slash']) { await page.keyboard.press(code); await page.waitForTimeout(150); }
  await page.waitForTimeout(500);
  const s1 = await snap();
  check(JSON.stringify(s0) === JSON.stringify(s1), `K G L O M U 1 4 \` Shift+C ?: nothing changes (${JSON.stringify(s0)} → ${JSON.stringify(s1)})`);
  check(await page.evaluate(() => document.querySelectorAll('.lk-hint .list').length === 0 && !document.querySelector('.lk-load[data-state=menu]')), '? shows nothing');

  // Menu › Keys
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await page.click('#lk-load .lk-link[data-go=keys]'); await page.waitForTimeout(400);
  const fit = (tab) => page.evaluate((tab) => { const pg = document.querySelector('#lk-load .pg.on'); const b = pg.querySelector('.pg-b') ?? pg; const tp = pg.querySelector(`#tp-keys-${tab}`);
    const foot = pg.querySelector('#tp-keys-keys .kfoot')?.getBoundingClientRect(), c = b.getBoundingClientRect();
    return { tabs: [...pg.querySelectorAll('[role=tab]')].map((t) => t.dataset.tab), rows: [...(tp ?? pg).querySelectorAll('[data-row]')].map((r) => r.dataset.row), over: b.scrollHeight - b.clientHeight, tpOver: tp ? tp.scrollHeight - tp.clientHeight : 0, footIn: tab !== 'keys' || (foot && foot.bottom <= c.bottom + 1) }; }, tab);
  const k = await fit('keys');
  check(JSON.stringify(k.tabs) === JSON.stringify(['keys', 'cruise', 'tessie', 'hand', 'pro']), `Keys: the tabs, Tessie's on a desktop (playTessie) (${k.tabs.join(' ')})`);
  check(['steer', 'tack', 'auto', 'sheets', 'furl', 'engine', 'throttle', 'neutral', 'anchor', 'view', 'bino', 'fold', 'chart', 'menu'].every((r) => k.rows.includes(r)), `Keys: the lean rows (${k.rows.join(' ')})`);
  check(!['jib', 'chase', 'reef', 'wing', 'moor', 'log', 'vhf', 'sound', 'cruise', 'hints', 'held', 'list', 'wind'].some((r) => k.rows.includes(r)), 'Keys: none of the removed rows');
  check(k.over <= 1 && k.footIn, `Keys: no scroll at 1280 × 720, the foot inside the card (${JSON.stringify({ over: k.over, footIn: k.footIn })})`);
  await page.click('#lk-load .pg.on [data-tab=cruise]'); await page.waitForTimeout(200);
  const cr = (await fit('cruise')).rows;
  check(cr.includes('c-above') && cr.includes('c-cam') && !cr.includes('c-photo'), `Keys › Cruise: its keys, no P (${cr.join(' ')})`);
  await page.click('#lk-load .pg.on [data-tab=tessie]'); await page.waitForTimeout(200);
  const ts = await fit('tessie');
  check(['t-swim', 't-dash', 't-bite', 't-updown', 't-view', 't-swap'].every((r) => ts.rows.includes(r)) && ts.over <= 1, `Keys › Tessie: her keys, T included, no scroll (${ts.rows.join(' ')}, over ${ts.over})`);
  await page.click('#lk-load .pg.on [data-tab=hand]'); await page.waitForTimeout(200);
  const hd = await fit('hand');
  check(['mark', 'jib-hand', 'reef-hand', 'wind-hand', 'moor-hand', 'log-hand', 'sound-hand', 'vhf-hand', 'cruise-hand'].every((r) => hd.rows.includes(r)), `Mouse, touch: every function that left the keyboard has its way (${hd.rows.length} rows)`);
  check(hd.over <= 1 && hd.tpOver <= 1, `Mouse, touch: no scroll (${hd.over}, ${hd.tpOver})`);
  await page.click('#lk-load .pg.on [data-tab=pro]'); await page.waitForTimeout(200);
  const pr = (await fit('pro')).rows;
  check(['jib', 'trav', 'twist', 'backstay'].every((r) => pr.includes(r)), `Pro trim: R F with the Pro trims (${pr.join(' ')})`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.keyboard.press('Escape'); await page.waitForTimeout(700);

  // Setup › Aids: the crew's net, a button that steps auto · 12 s · 25 s · off
  const net = await page.evaluate(() => { const b = document.querySelector('#lk-load [data-net=cycle]'); return b ? { text: b.textContent, in: !!b.closest('#tp-set-aids') } : null; });
  check(net && net.in && /^crew’s net: auto/.test(net.text), `Setup › Aids has the crew's net button (${JSON.stringify(net)})`);
  const netStep = await page.evaluate(() => { const b = document.querySelector('#lk-load [data-net=cycle]'); const sk = window.__velia.m4.ui.skills; const seen = [sk.net]; for (let i = 0; i < 4; i++) { b.click(); seen.push(sk.net); } return { seen, text: b.textContent }; });
  check(JSON.stringify(netStep.seen) === JSON.stringify(['auto', 12, 25, 'off', 'auto']), `the net button steps the skill model auto → 12 → 25 → off → auto (${JSON.stringify(netStep.seen)})`);

  // the reef with the sails down: REEF is the switch (K is no key)
  await page.evaluate(() => window.__velia.boat.sim.sea.actions.sails()); await page.waitForTimeout(12000);
  const reefClick = () => page.evaluate(() => document.querySelector('.lk-cp .c[data-id=reef]')?.click());
  await reefClick(); await page.waitForTimeout(600);
  const r1 = await page.evaluate(() => { const U = window.__velia.m4.ui; return { line: U.hint.el.innerText, reef: window.__velia.boat.state.reef, sel: window.__velia.boat.sim.reefSel, lever: U.cockpitStates?.().toggles.reef }; });
  check(r1.sel !== 0, `sails down, REEF clicked: the selector stepped (${JSON.stringify(r1)})`);
  check(!/Reef in|Reefing/.test(r1.line), `…and no status line on the skipper's row (${JSON.stringify(r1.line.slice(0, 80))})`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);

  // the audit's open check: the live chart's focus never double-fires a key
  await page.evaluate(() => window.__velia.boat.sim.sea.actions.sails()); await page.waitForTimeout(500);
  await page.keyboard.press('KeyN');
  await page.waitForFunction(() => { const l = window.__velia.m4.ui.services.get('liveChart'); return l?.shown && l.state.mode === 'play'; }, null, { timeout: 30000 });
  await page.focus('.lk-livechart'); await page.waitForTimeout(400);
  const c0 = await page.evaluate(() => { const B = window.__velia.boat.sim, e = B.sea.engine; return { rudder: B.ctl.rudder, sheet: B.hand.sheet, lever: e.lever, on: e.on, view: window.__velia.m4.ui.services.get('liveChart').state.view }; });
  for (const code of ['ArrowLeft', 'ArrowUp', 'Equal', 'Minus']) { await page.keyboard.down(code); await page.waitForTimeout(500); await page.keyboard.up(code); }
  await page.keyboard.press('Digit2'); await page.waitForTimeout(500);
  const c1 = await page.evaluate(() => { const B = window.__velia.boat.sim, e = B.sea.engine; return { rudder: B.ctl.rudder, sheet: B.hand.sheet, lever: e.lever, on: e.on, view: window.__velia.m4.ui.services.get('liveChart').state.view }; });
  check(Math.abs(c1.rudder - c0.rudder) < 0.05 && Math.abs(c1.sheet - c0.sheet) < 0.01 && c1.lever === c0.lever && c1.on === c0.on, `chart focused: arrows, + and − trim and steer nothing (${JSON.stringify({ c0: { r: c0.rudder, s: c0.sheet, l: c0.lever }, c1: { r: c1.rudder, s: c1.sheet, l: c1.lever } })})`);
  check(Math.abs(c1.view.cx - c0.view.cx) + Math.abs(c1.view.cz - c0.view.cz) > 1 || c1.view.mpp !== c0.view.mpp, 'chart focused: the keys panned and zoomed the chart');
  check(errors.length === 0, `no page errors at the end (${errors.slice(0, 2).join(' | ')})`);
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
