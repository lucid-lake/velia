// Regatta's hub on a live v2 page (owner 2026-11-16: Regatta opens on a hub; owner 2026-11-20: select, then go, one card,
// the water is the preview):
//   1280 × 720   ?mode=regatta opens the hub over the live lake with the area's first place race selected and laid behind it (its start line,
//                marks, gates and lines on the water; the page's wind, clock and sky are its own); a click on a row SELECTS (the highlight, the card's
//                one line, the course on the water and the camera follow, the race not started); a double-click, Enter or To the line starts the
//                selected race (the fleet already sailing at the line, a short countdown); the arrows move the selection; Custom still opens its
//                sheet; no right card, no dealt hand, no Another hand, no fact grid, no Emerald Cup block; the Level row's Adjust sheet sets the
//                presets and the two dials (the session follows); Race again skips the hub; the results card's New hand opens the hub; Esc leaves
//   844 × 390    a sideways phone: one card, nothing off the screen or under 15 px, the buttons 44 px tall, no scroll; a tap selects, a double-tap
//                or To the line starts
//   390 × 844    an upright phone: the page turned, the same hub in the 844 × 390 frame
//   the URL      a race flag (?wind=) skips the hub; ?quick=1 deals a hand and goes straight in the box
//   cups         the hub groups the races by place: two cups (Emerald Bay, The Mouth), the chosen cup's races with their length and
//                best, no retired race listed, Tessie's Deep left out where she cannot go (a phone), Custom still holding the retired courses
// Run by `npm run test:pages:v2 -- regattaHub`, or node v2/tests/pages/regattaHub.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
const SHOTS = argv.includes('--shots') ? argv[argv.indexOf('--shots') + 1] : null;   // [--shots <dir>]: the cups hub, one still
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const PHONE = { deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, viewport = { width: 1280, height: 720 }, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  return { page, errors };
}
const st = (page) => page.evaluate(() => {
  const V = window.__velia, r = V.regatta.r, S = r?.session, h = r?.hand;
  return { mode: V._stats().mode, on: !!r?.on, hub: !!r?.hubOpen, hand: h ? { ...h } : null, key: h ? `${h.length}|${h.wind}|${h.time}|${h.sky}|${h.rivals}` : null, clock: r?.on ? r.state().clock : null,
    flying: S?.flying ?? null, pre: S?.prestartS ?? null, go: document.querySelector('#rgh .go')?.textContent ?? '', rivals: S?.rivals?.length ?? null, skill: S?.rivals?.[0]?.skill ?? null, helper: S?.helper ?? null, aids: r?.aids?.level ?? null, pace: r?.speed?.() ?? null, setup: r?.setup ? { ...r.setup } : null,
    hubShown: !!document.querySelector('#rgh:not([hidden])'), adjShown: !!document.querySelector('#rgh .adj:not([hidden])'), watch: !!document.querySelector('#rg .watch'),
    name: document.querySelector('#rgh .sl')?.innerText ?? '', sel: r?.selected ?? null, course: r?.course?.id ?? null, centre: r?.course?.line?.centre?.map(Math.round) ?? null, cam: r?.stats?.hubCam ?? null };
});
// the hub's layout: every shown piece inside the frame, the two columns apart, the smallest text, the buttons' height, no scroll
const layout = (page) => page.evaluate(() => {
  const vis = (e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 ? r : null; };
  const pieces = [...document.querySelectorAll('#rgh .col, #rgh .col > *, #rgh .cups > *')].map((e) => [e.className || e.tagName, vis(e)]).filter(([, r]) => r);
  const W = innerWidth, H = innerHeight;
  const out = pieces.filter(([, r]) => r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5).map(([c, r]) => `${c} ${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}`);
  const col = vis(document.querySelector('#rgh .col'));
  const apart = !!col && col.right <= W * 0.6 && !document.querySelector('#rgh .board');   // one card on the left; the water is the rest
  let minPx = 99; for (const e of document.querySelectorAll('#rgh *')) { if (!vis(e) || [...e.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) continue; minPx = Math.min(minPx, parseFloat(getComputedStyle(e).fontSize)); }
  const btns = [...document.querySelectorAll('#rgh .go, #rgh .row, #rgh .seg button')].map(vis).filter(Boolean), minBtn = Math.min(...btns.map((r) => r.height));
  const svgText = [...document.querySelectorAll('#rgh svg text')].map((t) => +t.getAttribute('font-size'));
  return { W, H, out, apart, minPx: Math.min(minPx, ...svgText), minBtn, scroll: document.documentElement.scrollHeight > H + 1 || document.scrollingElement.scrollTop > 0, top: document.querySelector('.lk-view')?.getBoundingClientRect().bottom ?? 0, colTop: col?.top ?? 0 };
});

try {
  // ---------------- 1280 × 720: the flow ----------------
  {
    const { page, errors } = await open('mode=regatta&once=0&seed=1&handseed=7');
    await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 20, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const a = await st(page); await page.waitForTimeout(2000); const a2 = await st(page);
    check(a.mode === 'regatta' && a.hub && a.hubShown && a.hand && !a.watch, `open Regatta: the hub, no race plates (${JSON.stringify({ mode: a.mode, hub: a.hub, shown: a.hubShown, watch: a.watch })})`);
    check(a.flying && a.hand.prestartS === 0 && a.clock <= -a.pre + 0.1 && a2.clock <= -a.pre + 0.1 && a.rivals === a.hand.rivals && a.go === 'To the line ›', `a flying start held behind the hub (${a.clock} → ${a2.clock} of −${a.pre}; "${a.go}"), the hand's ${a.hand.rivals} rivals laid`);
    const cond = await page.evaluate(() => { const V = window.__velia; return { wind: V.boat.wind.level, hour: V.clock.hour, sky: V.weatherMenu.current() }; });
    check(Math.abs(((cond.hour - a.hand.hour) + 36) % 24 - 12) < 0.2 && cond.sky === a.hand.sky && cond.wind === a.hand.wind, `the page took the hand's conditions (hour ${cond.hour?.toFixed(2)} vs ${a.hand.hour}, sky ${cond.sky} vs ${a.hand.sky}, wind ${cond.wind} vs ${a.hand.wind})`);
    const rowsV = await page.evaluate(() => [...document.querySelectorAll('#rgh .rlist:not([hidden]) .rc:not(.rx)')].map((b) => b.dataset.race));
    check(a.sel === rowsV[0] && a.hand.place === a.sel && a.course === a.sel && /^\d\.\d km · \d+ min · \d+ rivals? · (no best yet|best )/.test(a.name.trim()), `the area's first race is selected and laid (${a.sel}; "${a.name.trim()}")`);
    const L = await layout(page);
    check(!L.out.length && L.apart && L.minPx >= 15 && !L.scroll && L.colTop >= L.top, `1280 × 720: one card, inside the frame, under the bar, smallest text ${L.minPx} px, no scroll (${L.out.join('; ') || 'ok'})`);
    const gone = await page.evaluate(() => ({ pieces: !!document.querySelector('#rgh .board, #rgh .facts, #rgh .chips, #rgh .big, #rgh .hand, #rgh .deal, #rgh .cupc'), text: /Another hand|today.s hand|Race now|Emerald Cup|Continue the Cup/.test(document.querySelector('#rgh').innerText) }));
    check(!gone.pieces && !gone.text, `the retired pieces are gone: no right card, no dealt hand, no Another hand, no fact grid, no Emerald Cup block (${JSON.stringify(gone)})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hub-first.png` });
    // select, then go: a click selects (the highlight, the card's line, the course on the water, the camera gliding), it never starts
    await page.click(`#rgh .rc[data-race=${rowsV[1]}]`); await page.waitForTimeout(120);
    const s1 = await st(page);
    await page.waitForTimeout(3500);
    const s2 = await st(page);
    const hl = await page.evaluate(() => [...document.querySelectorAll('#rgh .rc')].filter((b) => b.getAttribute('aria-selected') === 'true').map((b) => b.dataset.race));
    check(s1.hub && !s1.watch && s1.sel === rowsV[1] && s1.hand.place === rowsV[1] && s1.course === rowsV[1] && JSON.stringify(hl) === JSON.stringify([rowsV[1]]), `a row click selects without starting: ${rowsV[1]} is highlighted and its course laid (${JSON.stringify({ hub: s1.hub, watch: s1.watch, sel: s1.sel, course: s1.course, hl })})`);
    check(JSON.stringify(s1.centre) !== JSON.stringify(a.centre) && s1.name !== a.name, `the card's line and the water's start area changed (${a.centre} -> ${s1.centre}; "${s1.name.trim()}")`);
    check(s1.cam?.lag > 5 && s2.cam?.lag < 1.5, `the camera glides to the new course, no snap (lag ${s1.cam?.lag} m at 0.1 s, ${s2.cam?.lag} m at 3.5 s)`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hub-second.png` });
    // the arrows move the selection (Enter starts it: checked at the cups below)
    await page.keyboard.press('ArrowUp'); await page.waitForTimeout(400);
    const s3 = await st(page);
    check(s3.hub && !s3.watch && s3.sel === rowsV[0], `ArrowUp moves the selection back to ${rowsV[0]} (${s3.sel})`);
    // the Level row: the Adjust sheet, the presets and the two dials
    await page.click('#rgh .lvl'); await page.waitForTimeout(300);
    const c0 = await st(page);
    await page.click('#rgh .adj [data-seg=preset] [data-v=pro]'); await page.waitForTimeout(300);
    const c1 = await st(page);
    check(c0.adjShown && c1.setup.skill === 'hard' && c1.setup.aids === 'pro' && c1.aids === 'pro' && c1.helper === false && c1.pace === 1.5, `the Pro preset: hard rivals, Pro aids, no helper, 1.5 × (${JSON.stringify({ s: c1.setup.skill, a: c1.aids, h: c1.helper, p: c1.pace })})`);
    await page.click('#rgh .adj [data-seg=skill] [data-v=pro]'); await page.click('#rgh .adj [data-seg=aids] [data-v=beginner]'); await page.waitForTimeout(300);
    const c2 = await st(page);
    check(c2.hand.tier === 'pro' && c2.skill > c1.skill && c2.aids === 'beginner' && c2.helper === true && c2.key === c1.key, `the two dials apart: Pro rivals (${c1.skill?.toFixed(2)} → ${c2.skill?.toFixed(2)}) with Beginner aids, the hand's conditions kept`);
    const lvlText = await page.evaluate(() => document.querySelector('#rgh .lvl .t').textContent);
    await page.click('#rgh .adj .done'); await page.waitForTimeout(200);
    check(!(await st(page)).adjShown && /Custom/.test(lvlText), `Done closes the sheet; the row says ${lvlText}`);
    // To the line: the flying start runs with the hand's settings
    const h = (await st(page)).hand;
    await page.click('#rgh .go');
    await page.waitForTimeout(1500);
    const d = await st(page);
    check(!d.hub && !d.hubShown && d.watch && d.flying && d.clock > -d.pre + 0.5 && d.clock < -1 && d.rivals === h.rivals && d.aids === h.aids && d.hand.tier === h.tier, `To the line: the flying start runs (−${d.pre} s) with the hand's ${h.rivals} rivals, ${h.tier} rivals, ${h.aids} aids (clock ${d.clock?.toFixed(1)})`);
    // Race again: instant, no hub
    await page.evaluate(() => window.__velia.regatta.r.ui.results({ finished: true, place: 2, medal: 'silver', ord: '2nd', boats: 6, time: '3:12.0', level: 'beginner', gap: '+2 s', tip: { text: 'tip' } }));
    await page.click('#rg .res .again'); await page.waitForTimeout(400);
    const e = await st(page);
    check(!e.hub && !e.hubShown && e.clock < -e.pre + 1 && e.key === d.key, `Race again: back at the start at once, no hub, the same hand (${e.clock?.toFixed(1)})`);
    // the results card's New hand: the hub again
    await page.evaluate(() => window.__velia.regatta.r.ui.results({ finished: true, place: 2, medal: 'silver', ord: '2nd', boats: 6, time: '3:12.0', level: 'beginner', gap: '+2 s', tip: { text: 'tip' } }));
    await page.click('#rg .res .hand'); await page.waitForTimeout(600);
    const f = await st(page);
    check(f.hub && f.hubShown && !!f.sel && f.clock <= -f.pre + 0.1, `New hand: the hub again on a race (${f.sel})`);
    // Esc: back to the lake
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__velia._stats().mode === 'sail', null, { timeout: 5000 }).catch(() => {});
    const g = await st(page);
    check(g.mode === 'sail' && !g.on && !g.hubShown, `Esc on the hub: back to the lake (${g.mode})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- the cups: two cups, their races; Custom keeps the retired four; a row races ----------------
  {
    const { page, errors } = await open('mode=regatta&once=0&seed=1&handseed=7&tessie=1');
    await page.waitForFunction(() => window.__velia?.regatta?.r?.hubOpen && window.__velia.frames > 20, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const cups = () => page.evaluate(() => {
      const vis = (e) => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
      return { tabs: [...document.querySelectorAll('#rgh .ctab')].map((b) => [b.querySelector('.cn').textContent, b.getAttribute('aria-selected')]),
        shown: [...document.querySelectorAll('#rgh .rc:not(.rx)')].filter(vis).map((b) => b.querySelector('.rt').textContent), all: [...document.querySelectorAll('#rgh .rc:not(.rx)')].map((b) => b.dataset.race),
        extras: [...document.querySelectorAll('#rgh .rc.rx')].filter(vis).map((b) => [b.dataset.race, b.querySelector('.rt').textContent, b.querySelector('.rs').textContent, b.querySelector('.rk').textContent]), btn: document.querySelector('#rgh .selc .go').textContent, sl: document.querySelector('#rgh .sl').textContent,
        text: document.querySelector('#rgh').innerText, bt: [...document.querySelectorAll('#rgh .rc:not(.rx)')].map((e) => `${e.querySelector('.rk')?.textContent} / ${e.querySelector('.bt')?.textContent}`),
        feet: document.querySelectorAll('#rgh .cupfoot, #rgh .sailcup').length };
    });
    await page.click('#rgh .ctab[data-cup=emerald-bay]'); await page.waitForTimeout(400);   // the hub opens on the cup of the area the boat is in (here The Mouth); the tab selects Emerald Bay's first race
    let c = await cups();
    check(JSON.stringify(c.tabs.map((t) => t[0])) === '["Emerald Bay","The Mouth"]' && c.tabs[0][1] === 'true', `cups: two plates, Emerald Bay chosen (${JSON.stringify(c.tabs)})`);
    check(JSON.stringify(c.shown) === '["Tea House Run","Tessie\'s Deep","Glass Boat Chase"]', `cups: Emerald Bay lists Tea House Run, Tessie's Deep and Glass Boat Chase (${c.shown})`);
    check(c.extras.length === 2 && c.extras[0][1] === 'Explore the Bay' && /^Find 8 hidden corners of the bay: sail close to discover them\.$/.test(c.extras[0][2]) && /^\d of 8 found$/.test(c.extras[0][3]) && c.extras[1][1] === 'Race all three' && /^The three races back to back; lowest total points wins\.$/.test(c.extras[1][2]) && c.extras[1][3] === 'cup points' && c.feet === 0, `cups: an Explore row and a Race all three row end the list, no bare Sail the cup button (${JSON.stringify(c.extras)})`);
    check(c.all.length === 6 && c.all.includes('pass-the-channel') && c.bt.every((t) => /^\d+\.\d km · \d+ min \/ (new|best \d:\d\d\.\d)$/.test(t)), `cups: the rows carry their length, minutes and best (${c.bt.join(' | ')})`);
    check(!/Harbour Dash|Twice Round|Bay Tour|Match race|Beat to the head/.test(c.text), 'cups: none of the retired races is listed on the hub');
    await page.click('#rgh .ctab[data-cup=the-mouth]'); await page.waitForTimeout(200);
    c = await cups();
    check(JSON.stringify(c.shown) === '["Pass the Channel","Storm Run","Lights on the Lake"]' && c.tabs[1][1] === 'true', `cups: The Mouth lists Pass the Channel, Storm Run and Lights on the Lake (${c.shown})`);
    check(c.extras[0]?.[1] === 'Explore the Mouth' && /^Find 8 hidden corners of the mouth/.test(c.extras[0][2]), `cups: The Mouth's Explore row (${JSON.stringify(c.extras[0])})`);
    await page.click('#rgh .ctab[data-cup=emerald-bay]'); await page.waitForTimeout(300);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/cups-hub.png` });
    // Custom keeps the retired four's courses
    await page.click('#rgh .cusr'); await page.waitForTimeout(400);
    await page.click('#rgh .r[data-row=course] > .val'); await page.waitForTimeout(200);
    const cus = await page.evaluate(() => [...document.querySelectorAll('#rgh .cus .card')].map((b) => b.dataset.v));
    check(['harbour-dash', 'twice-round', 'bay-tour'].every((id) => cus.includes(id)), `Custom: the retired courses are still its cards (${cus})`);
    await page.keyboard.press('Escape'); await page.waitForTimeout(150); await page.keyboard.press('Escape'); await page.waitForTimeout(500);
    // Explore: selecting it frames the hunt's area on the water and turns the button to Explore; a double-click leaves for free sailing
    await page.click('#rgh .rc[data-kind=hunt]'); await page.waitForTimeout(600);
    const ex = await page.evaluate(() => { const R = window.__velia.regatta.r; return { sel: R.selected, hub: !!R.hubOpen, btn: document.querySelector('#rgh .selc .go').textContent, sl: document.querySelector('#rgh .sl').textContent, hl: document.querySelector('#rgh .rc[aria-selected=true]')?.dataset.race, lag: R.stats.hubCam?.lag }; });
    check(/^hunt:/.test(ex.sel ?? '') && ex.hub && ex.btn === 'Explore ›' && /found · free sailing/.test(ex.sl) && ex.hl === ex.sel, `Explore: selected, the button says Explore (${JSON.stringify(ex)})`);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/hub-explore.png` });
    // a row click only selects; a double-click starts it (the place race, its rivals, no hub)
    await page.click('#rgh .rc[data-race=tessies-deep]'); await page.waitForTimeout(400);
    const one = await page.evaluate(() => { const R = window.__velia.regatta.r; return { sel: R.selected, hub: !!R.hubOpen, on: !!R.placeRace && !R.hubOpen }; });
    check(one.sel === 'tessies-deep' && one.hub && !one.on, `cups: one click selects Tessie's Deep and starts nothing (${JSON.stringify(one)})`);
    await page.dblclick('#rgh .rc[data-race=tea-house-run]'); await page.waitForTimeout(1500);
    const r = await page.evaluate(() => { const R = window.__velia.regatta.r; return { place: R.placeRace?.id ?? null, hub: !!R.hubOpen, rivals: R.session?.rivals?.length ?? null, watch: !!document.querySelector('#rg .watch') }; });
    check(r.place === 'tea-house-run' && !r.hub && r.rivals === 4 && r.watch, `a double-click: Tea House Run starts (${JSON.stringify(r)})`);
    // Sail the cup: from the hub, the cup's races back to back with one fleet; the first race at once
    await page.evaluate(() => window.__velia.regatta.r.openHub()); await page.waitForTimeout(800);
    await page.click('#rgh .rc[data-kind=cup]'); await page.waitForTimeout(500);
    const cs = await page.evaluate(() => { const R = window.__velia.regatta.r; return { sel: R.selected, hub: !!R.hubOpen, place: R.hand?.place ?? null, btn: document.querySelector('#rgh .selc .go').textContent, on: !!R.placeCup && !R.hubOpen }; });
    check(/^cup:/.test(cs.sel ?? '') && cs.hub && !cs.on && !!cs.place && cs.btn === 'To the line ›', `Race all three: one click selects it, the water shows the first race (${JSON.stringify(cs)}) and starts nothing`);
    await page.dblclick('#rgh .rc[data-kind=cup]'); await page.waitForTimeout(1500);
    const sc = await page.evaluate(() => { const R = window.__velia.regatta.r; return { place: R.placeRace?.id ?? null, hub: !!R.hubOpen, cup: R.placeCup?.cup ?? null, races: R.placeCup?.races ?? null, i: R.hand?.placeCup?.i ?? null, rivals: R.session?.rivals?.length ?? null }; });
    check(sc.cup === 'emerald-bay' && sc.place === sc.races?.[0] && sc.i === 0 && !sc.hub && sc.rivals === 4, `Race all three: the Emerald Bay series, its first race at once (${JSON.stringify(sc)})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- Enter starts the selection; Reduce Motion cuts the camera ----------------
  {
    const { page, errors } = await open('mode=regatta&once=0&seed=1&handseed=7&tessie=1', { width: 1280, height: 720 }, { reducedMotion: 'reduce' });
    await page.waitForFunction(() => window.__velia?.regatta?.r?.hubOpen && window.__velia.frames > 20, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#rgh .rlist:not([hidden]) .rc:not(.rx)')].map((b) => b.dataset.race));
    await page.click(`#rgh .rc[data-race=${rows[1]}]`); await page.waitForTimeout(250);
    const m = await st(page);
    check(m.hub && m.sel === rows[1] && m.cam?.lag < 1.5, `Reduce Motion: the camera cuts to ${rows[1]} (lag ${m.cam?.lag} m at 0.25 s)`);
    await page.keyboard.press('ArrowDown'); await page.waitForTimeout(300);
    const dn = await st(page);
    check(dn.hub && dn.sel === (rows[2] ?? rows[1]), `ArrowDown moves the selection (${dn.sel})`);
    await page.keyboard.press('Enter'); await page.waitForTimeout(1500);
    const en = await st(page);
    check(!en.hub && en.watch && en.hand.place === dn.sel, `Enter starts the selected race (${en.hand?.place})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- phones: sideways and upright (turned) ----------------
  for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
    const { page, errors } = await open('mode=regatta&once=0&seed=1&handseed=7&touch=1', vp, PHONE);
    await page.waitForFunction(() => window.__velia?.regatta?.r?.hubOpen && window.__velia.frames > 20, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const L = await layout(page);
    check(L.W === 844 && L.H === 390 && !L.out.length && L.apart && L.minPx >= 15 && L.minBtn >= 43.5 && !L.scroll, `${vp.width} × ${vp.height}: one ${L.W} × ${L.H} screen, inside it, one card, text ≥ 15 px (${L.minPx}), buttons ${L.minBtn.toFixed(0)} px, no scroll (${L.out.join('; ') || 'ok'})`);
    const ph = await page.evaluate(() => [...document.querySelectorAll('#rgh .rc')].map((b) => b.dataset.race));
    check(!ph.includes('tessies-deep') && !ph.includes('glass-boat-chase') && !ph.includes('storm-run') && ph.includes('tea-house-run') && ph.includes('pass-the-channel') && ph.includes('lights-on-the-lake'), `${vp.width} × ${vp.height}: the cups list the races a phone can sail (Tessie's Deep, Glass Boat Chase and Storm Run left out: ${ph})`);
    const sel0 = (await st(page)).sel;
    await page.tap('#rgh .lvl'); await page.waitForTimeout(300);
    const A = await page.evaluate(() => { const r = document.querySelector('#rgh .adj').getBoundingClientRect(); return { b: r.bottom, H: innerHeight, sh: document.querySelector('#rgh .adj').scrollHeight, ch: document.querySelector('#rgh .adj').clientHeight }; });
    check(A.b <= A.H + 0.5 && A.sh <= A.ch + 1, `${vp.width} × ${vp.height}: the Adjust sheet fits (${JSON.stringify(A)})`);
    await page.tap('#rgh .adj .done'); await page.waitForTimeout(200);
    // a tap selects (the card and the water follow), the card's button starts it; a double-tap on a row starts it too
    const phv = await page.evaluate(() => [...document.querySelectorAll('#rgh .rlist:not([hidden]) .rc:not(.rx)')].map((b) => b.dataset.race)), second = phv.find((id) => id !== sel0);
    await page.tap(`#rgh .rc[data-race=${second}]`); await page.waitForTimeout(500);
    const t1 = await st(page);
    check(t1.hub && !t1.watch && t1.sel === second && t1.course === second, `${vp.width} × ${vp.height}: a tap selects ${second} and starts nothing (${JSON.stringify({ hub: t1.hub, watch: t1.watch, sel: t1.sel })})`);
    if (SHOTS && vp.width === 844) await page.screenshot({ path: `${SHOTS}/hub-phone.png` });
    if (vp.width === 844) { await page.tap(`#rgh .rc[data-race=${second}]`); await page.tap(`#rgh .rc[data-race=${second}]`); await page.waitForTimeout(1200); }   // two quick taps on the selected row: a double-tap
    else { await page.tap('#rgh .go'); await page.waitForTimeout(1200); }
    const s = await st(page);
    check(!s.hub && s.watch && s.clock > -s.pre + 0.3 && s.hand.place === second, `${vp.width} × ${vp.height}: ${vp.width === 844 ? 'a double-tap' : 'To the line'} starts the selected race (${s.clock?.toFixed(1)} of −${s.pre})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- the URL: a race flag skips the hub; ?quick=1 deals and goes straight in ----------------
  for (const [q, want] of [['mode=regatta&once=0&seed=1&wind=2', 'url'], ['mode=regatta&once=0&seed=1&quick=1&handseed=4', 'quick']]) {
    const { page, errors } = await open(q);
    await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 10, null, { timeout: 240000 });
    await page.waitForTimeout(1000);
    const s = await st(page);
    check(!s.hub && !s.hubShown && s.watch && s.clock > -s.pre + 0.05 && (want === 'url' ? s.hand == null && !s.flying && s.pre === 45 : !!s.hand && s.flying), `${q}: straight to the start (${want === 'url' ? 'the URL\'s race, the box' : 'a dealt hand, flying'}, clock ${s.clock?.toFixed(1)} of −${s.pre})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
