// Regatta on a live v2 page (BACKLOG-v2 #12, R1 + R2):
//   ?mode=regatta   (with a race flag: a bare ?mode=regatta opens the hub, regattaHub.page.mjs) in the box at once (no card first): the boat below the line, the clock running from −0:45, the lines and the
//                   props drawn, no pipeline built after the first frame; the helper's untouched start in the live loop
//                   (?speed=4: the race's real time × 4) is clean
//   off a race      a Sail page never loads the chunk and records no race draw; the card's Regatta enters the race and Sail
//                   leaves it, after which the race's draws stop (the guard: the race costs nothing outside a race)
//   R3              a whole beginner race on ?course=short at ×8 (?autoplay=1: the helper, then v1's pro): the level picker on the first
//                   race, the coach one line at a time, the results card (place, time, tip, medal), Race again back in the box
//   phones          390 × 844 and 844 × 390: the race's plates in the viewport, none over another
//   R4              Sail's HUD steps aside in a race (a passage plan first; 4 sizes); R trims the jib, the clock's button restarts
//   R4              the fleet: 6 boats, the level of detail's bands, the near rivals off the boat's slots off a race; the R3 race with
//                   5 rivals all finishing and the ladder (DOM) in the race's order at every sample; no tag over a plate
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/regatta.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, viewport = { width: 1280, height: 720 }, extra = {}) {
  const page = await browser.newPage({ viewport, ...extra });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  return { page, errors };
}
const R = (page) => page.evaluate(() => {
  const V = window.__velia, s = V._stats(), r = V.regatta.r, S = r?.session, b = V.boat.state;
  const L = S?.line, below = L ? -((b.x - L.centre[0]) * L.up[0] + (b.z - L.centre[1]) * L.up[1]) : null;
  return { mode: s.mode, race: s.race, pipelines: s.pipelines, st: r?.on ? r.state() : null, below, wall: performance.now() / 1000, flying: S?.flying ?? null, pre: S?.prestartS ?? null,
    plates: [...document.querySelectorAll('#rg .watch, #rg .fleet, #rg .coach:not(.off)')].map((e) => { const q = e.getBoundingClientRect(); return { c: e.className, x: q.x, y: q.y, w: q.width, h: q.height }; }),
    watch: document.querySelector('#rg .watch')?.innerText ?? null };
});
// R4 HUD: an upright phone's budget for the race's graphics (the screen less the top bar, the dials and the controls leaves about half
// of it as water; 15 % keeps the boat and the course clear: broadcast towers and lower thirds sit in the edges)
const HUD_BUDGET = 0.15;
const overlap = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

try {
  // ---------------- a Sail page: no chunk, no race draw ----------------
  {
    const { page, errors } = await open('once=0&seed=1&kayaks=0');
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui, null, { timeout: 240000 });
    await page.waitForTimeout(3000);
    const a = await R(page);
    check(a.mode === 'sail' && !a.race.loaded && !a.race.on, `Sail: the Regatta chunk is not loaded (${JSON.stringify({ mode: a.mode, loaded: a.race.loaded })})`);
    //: the kit comes with a race or Sail's practice marks; since 2026-11-18 the busy lake's far boats ask for it too
    // (after the first frame, its late group): then nothing of a race is recorded (no lines, no race props), only the lake's layer
    const kitOk = a.race.lines === null && a.race.props === null
      || (a.race.props?.lake > 0 && !a.race.props.active && a.race.props.instances === 0 && a.race.props.draws === 0 && !a.race.lines?.active && a.race.lines?.draws === 0);
    check(kitOk, `Sail: the race's lines and props not imported, or only the busy lake's far boats on the props (${JSON.stringify({ lines: a.race.lines, props: a.race.props })})`);
    // the card's Regatta: the hub, its start (a dealt hand: a flying start); then Sail: the draws stop
    await page.evaluate(async () => { await window.__velia.mode.go('regatta'); window.__velia.regatta.r.go(); });
    await page.waitForTimeout(1500);
    const b = await R(page);
    check(b.mode === 'regatta' && b.st && b.flying && b.st.clock < -1 && b.below > 3 && b.race.lines.draws > 0, `the card's Regatta: a flying start at ${b.st?.clock?.toFixed(1)} s, ${b.below?.toFixed(0)} m below the line, lines drawn (${b.race.lines.draws})`);
    await page.evaluate(() => window.__velia.mode.go('sail'));
    await page.waitForTimeout(400);
    const c0 = await R(page); await page.waitForTimeout(1500); const c1 = await R(page);
    check(c1.mode === 'sail' && !c1.race.on && c1.race.lines.draws === c0.race.lines.draws && c1.race.props.draws === c0.race.props.draws, `back in Sail: the race's draws stop (${c0.race.lines.draws} → ${c1.race.lines.draws})`);
    check(c1.pipelines.afterFirstFrame === 0, `no pipeline after the first frame (${c1.pipelines.afterFirstFrame})`);
    const rv = await page.evaluate(() => window.__velia.boat?.render?.rivals ?? window.__velia.boatR?.rivals ?? null);
    // the boats at anchor (v2/sim/anchoredBoats.js) take the slots back in Sail; no race rival keeps one
    check(!rv || rv.slots.every((k) => k == null || String(k).startsWith('anc-')), `back in Sail: no race rival on the boat's slots (${JSON.stringify(rv)})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- the home card's Regatta pick (a person, the card up): in the box ----------------
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
    await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
    await page.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0&kayaks=0`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
    await page.waitForTimeout(500);
    await pickMode(page, 'regatta');
    await page.waitForFunction(() => window.__velia.regatta?.r?.on, null, { timeout: 60000 }).catch(() => {});
    const hub = await page.evaluate(() => ({ open: window.__velia.regatta.r.hubOpen, shown: !!document.querySelector('#rgh:not([hidden])') }));
    check(hub.open && hub.shown, `the card's Regatta pick: the hub first (owner 2026-11-16) (${JSON.stringify(hub)})`);
    await page.click('#rgh .go'); await page.waitForTimeout(1200);
    // a person's first race of the course: the fly-over up the course (owner 2026-11-16), the race held at its first clock while it plays
    const f0 = await page.evaluate(() => ({ fly: !!window.__velia.regatta.r.fly, clock: window.__velia.regatta.r.state().clock }));
    await page.waitForTimeout(800);
    const f0b = await page.evaluate(() => window.__velia.regatta.r.state().clock);
    check(f0.fly && Math.abs(f0b - f0.clock) < 0.05, `To the line: the fly-over plays first, the race held (${JSON.stringify({ ...f0, after: f0b })})`);
    await page.mouse.click(640, 420); await page.waitForTimeout(1500);   // any input skips it (a tap on the water)
    const a = await R(page), f1 = await page.evaluate(() => !!window.__velia.regatta.r.fly);
    check(!f1 && a.mode === 'regatta' && a.st && a.flying && a.st.clock < -1 && a.st.clock > -a.pre && a.below > 3, `a tap skips it; the flying start runs (${JSON.stringify({ fly: f1, mode: a.mode, clock: a.st?.clock, pre: a.pre, below: a.below })})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- ?mode=regatta: in the box, the clock runs, the lines; the untouched start ----------------
  {
    const { page, errors } = await open('mode=regatta&once=0&seed=1&wind=2&speed=4');
    await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 10, null, { timeout: 240000 });
    const a = await R(page); await page.waitForTimeout(1500); const b = await R(page);
    check(a.mode === 'regatta' && a.st.clock < -30 && a.st.me.status === 'prestart' && a.below > 25 && a.below < 90, `in the box at once: ${a.st.clock.toFixed(1)} s, ${a.below.toFixed(0)} m below the line, no card first`);
    check(b.st.clock > a.st.clock + 3, `the clock runs (${a.st.clock.toFixed(1)} → ${b.st.clock.toFixed(1)} in 1.5 s at ×4)`);
    // the race fixes (2026-11-18): every rival near the start at full detail (5 slots) and the marks and the pin on the channel buoys'
    // pipeline (round 2), so the props draw the committee boat (1); the lite boats only beyond 150 m
    check(b.race.lines.count >= 8 && b.race.lines.draws > a.race.lines.draws && b.race.props.instances >= 1, `the lines (${b.race.lines.count} segments) and the props (${b.race.props.instances}) drawn`);
    const lod = b.st.lod ?? null, ids = b.st.order?.length;
    check(ids === 6 && lod && lod.near + lod.mid + lod.far === 5 && lod.near <= 5, `R4: 6 boats, the rivals' bands ${JSON.stringify(lod)}`);
    check(/0:\d\d/.test(b.watch ?? '') && /Line \d+ m/.test(b.watch ?? ''), `the watch counts: ${JSON.stringify(b.watch)}`);
    // the guidance pass (owner 2026-11-16): the course card open in the pre-start (desktop), the marks' number plates on the buoys
    const g0 = await page.evaluate(() => ({ card: !document.querySelector('#rg .ccard')?.hidden, art: document.querySelector('#rg .ccard svg')?.textContent ?? '', plates: [...document.querySelectorAll('#rg .plt:not([hidden])')].map((e) => e.textContent) }));
    check(g0.card && /1/.test(g0.art) && /F/.test(g0.art) && !/\b[WI]\b/.test(g0.art) && g0.plates.includes('1'), `the pre-start: the course card (marks numbered, F), the plates ${JSON.stringify(g0)}`);
    check(b.pipelines.afterFirstFrame === 0, `pipelines after the first frame: ${b.pipelines.afterFirstFrame}`);
    await page.waitForFunction(() => { const s = window.__velia.regatta.r.state(); return s.clock > 8; }, null, { timeout: 120000 });
    const c = await R(page);
    check(c.st.start != null && c.st.start < 5 && !c.st.calls.includes('rc_ocs_me') && c.st.me.status === 'racing', `the untouched start in the live loop is clean (started ${c.st.start} s after the gun; calls ${c.st.calls.join(', ')})`);
    // one voice per fact: the watch names the leg, the mark and the side; no side line on the mark's tag, no step count, rivals by name only
    await page.waitForTimeout(600);
    const g1 = await page.evaluate(() => ({ watch: document.querySelector('#rg .watch')?.innerText ?? '', tags: [...document.querySelectorAll('#rg .tag:not([hidden]), #rg .edge:not([hidden])')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()), coach: document.querySelector('#rg .coach .o')?.textContent ?? '', card: !document.querySelector('#rg .ccard')?.hidden }));
    const all = [g1.watch, ...g1.tags, g1.coach].join(' | ');
    check(/Leg 1 of \d \u00b7 Mark 1 \u00b7 round to (port|starboard)/.test(g1.watch) && !/keep it on your|step \d of|m ahead|m behind|\bW \d+ m/.test(all) && g1.tags.some((t) => /^(\u25B2 )?1 \u00b7 \d+ m$/.test(t)) && !g1.card, `racing: the leg line, "1 · N m", no side line, no step, no rival metres, the card folded (${JSON.stringify(g1)})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- R3: a whole beginner race on the short course, the coach, the results card, Race again ----------------
  {
    const { page, errors } = await open('mode=regatta&once=0&seed=1&wind=3&speed=8&autoplay=1&course=short');
    await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 10, null, { timeout: 240000 });
    const a = await R(page);
    const picker = await page.evaluate(() => !document.querySelector('#rg .pick')?.hidden);
    check(picker && a.st.level === 'beginner' && a.st.helper === true, `the first race: the level picker up, Beginner meanwhile, the helper on (${JSON.stringify({ picker, level: a.st.level })})`);
    // the card never holds two lines: sample it through the race
    let two = 0, seen = new Set(), ladderN = 0, ladderOff = 0, ladderBad = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 420000) {
      const c = await page.evaluate(() => { const st = window.__velia.regatta.r.state(); const names = Object.fromEntries(window.__velia.regatta.r.session.boats.map((b) => [b.id, b.id === 'me' ? 'You' : b.name]));
        return { n: document.querySelectorAll('#rg .coach:not(.off)').length, id: st.line?.id ?? null, res: !document.querySelector('#rg .res')?.hidden, want: st.order.map((id) => names[id]), painted: (document.querySelector('#rg .fleet')?.dataset.ids ?? '').split(',').filter(Boolean).map((id) => names[id]), dom: [...document.querySelectorAll('#rg .fleet .r .nm')].map((e) => e.textContent.trim()) }; });
      if (c.n > 1) two++; if (c.id) seen.add(c.id);
      if (!c.res && c.dom.length) { ladderN++; if (c.dom.join('|') !== c.painted.join('|')) ladderBad++; if (c.painted.join('|') !== c.want.join('|')) ladderOff++; }
      if (c.res) break;
      await page.waitForTimeout(200);
    }
    const res = await page.evaluate(() => ({ shown: !document.querySelector('#rg .res')?.hidden, text: document.querySelector('#rg .res')?.innerText ?? '', st: window.__velia.regatta.r.state() }));
    check(two === 0 && ['prestart', 'beat', 'rounding', 'finish'].every((k) => seen.has(k)), `the coach: one line at a time, its steps seen (${[...seen].join(', ')})`);
    await page.waitForFunction(() => { const r = window.__velia.regatta.r; return r.session.rivals.every((b) => r.session.race.view(b.id).status === 'finished'); }, null, { timeout: 420000 }).catch(() => {});
    const fin = await page.evaluate(() => { const r = window.__velia.regatta.r, R = r.session.race; return { n: r.session.rivals.filter((b) => R.view(b.id).status === 'finished').length, order: R.order(), places: R.order().map((id) => R.view(id).place) }; });
    await page.waitForTimeout(400);
    const finLadder = await page.evaluate(() => (document.querySelector('#rg .fleet')?.dataset.ids ?? ''));
    check(finLadder === fin.order.join(','), `R4: at the end the ladder is the final order (${finLadder})`);
    check(fin.n === 5 && fin.places.every((p, i) => p === i + 1), `R4: the 5 rivals finish, the order by place (${JSON.stringify(fin)})`);
    // the ladder's rows are exactly the order it was handed, every sample; that order trails the race's by at most a repaint (10 Hz):
    // boats bow to bow swap places between two samples
    check(ladderN > 20 && ladderBad === 0 && ladderOff <= Math.ceil(ladderN * 0.12), `R4: the ladder shows the order it is handed (${ladderN - ladderBad} of ${ladderN}), the race's order (${ladderN - ladderOff} of ${ladderN}; a repaint behind at most)`);
    check(res.shown && /of 6/.test(res.text) && /Time \d+:\d\d\.\d/.test(res.text) && /Tip/i.test(res.text) && /Race again/.test(res.text) && /Home/.test(res.text) && (res.st.result?.place > 3 ? res.st.result.medal == null : !!res.st.result?.medal),   // a medal for the podium only (6 boats: 4th has none)
      `the results card: ${JSON.stringify(res.text.replace(/\s+/g, ' ').slice(0, 160))} (${JSON.stringify(res.st.result)})`);
    await page.click('#rg .res .again');
    await page.waitForTimeout(300);
    const b = await R(page), hidden = await page.evaluate(() => document.querySelector('#rg .res')?.hidden);
    check(hidden && b.st.clock < -40 && b.st.me.status === 'prestart' && b.below > 25 && b.st.helper === true, `Race again: back in the box (${b.st.clock.toFixed(1)} s, ${b.below?.toFixed(0)} m below the line, the card gone)`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- phones: the plates on the screen, none over another ----------------
  for (const vp of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const { page } = await open('mode=regatta&once=0&seed=1&wind=2&touch=1', vp, { deviceScaleFactor: 2, hasTouch: true, isMobile: true });
    await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 10, null, { timeout: 240000 });
    await page.waitForTimeout(1200);
    // the page's frame: an upright phone shows the landscape page turned on its side (phones are landscape-only, 2026-11-15)
    const a = await R(page), P = a.plates, fr = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    const inside = P.every((p) => p.x >= 0 && p.y >= 0 && p.x + p.w <= fr.w + 0.5 && p.y + p.h <= fr.h + 0.5);
    let clash = null; for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) if (overlap(P[i], P[j])) clash = [P[i].c, P[j].c];
    check(P.length >= 2 && inside && !clash, `${vp.width} × ${vp.height}: ${P.length} plates on the screen, none over another (${clash ? clash.join(' / ') : 'ok'})`);
    // R4 HUD (the owner: "large navy colour blocks"): the race's graphics cover at most HUD_BUDGET of an upright phone, in the box and on
    // the beat (the water band between the dials and the controls must stay clear for the boat and the course), and no text under 11 px
    const hud = async () => page.evaluate(() => {
      const els = [...document.querySelectorAll('#rg .watch, #rg .fleet, #rg .coach:not(.off), #rg .tag:not([hidden]), #rg .edge:not([hidden]), #rg .pick:not([hidden])')];
      let a = 0; for (const e of els) { if (getComputedStyle(e).display === 'none') continue; const r = e.getBoundingClientRect(); a += r.width * r.height; }
      let minPx = 99; for (const e of document.querySelectorAll('#rg *')) { if (!e.offsetParent || !e.textContent.trim() || [...e.childNodes].every((n) => n.nodeType !== 3 || !n.textContent.trim())) continue; minPx = Math.min(minPx, parseFloat(getComputedStyle(e).fontSize)); }
      return { cover: a / (innerWidth * innerHeight), minPx };
    });
    const h0 = await hud();
    await page.evaluate(() => window.__velia.regatta.r.settle(70)); await page.waitForTimeout(800);
    const h1 = await hud();
    if (fr.h > fr.w) check(Math.max(h0.cover, h1.cover) <= HUD_BUDGET, `${vp.width} × ${vp.height}: the HUD covers ${(h0.cover * 100).toFixed(1)} % in the box, ${(h1.cover * 100).toFixed(1)} % on the beat (budget ${HUD_BUDGET * 100} %)`);
    check(Math.min(h0.minPx, h1.minPx) >= 11, `${vp.width} × ${vp.height}: the HUD's smallest text ${Math.min(h0.minPx, h1.minPx)} px (11 px at least)`);
    await page.close();
  }
  // ---------------- R4: Sail's HUD steps aside in a race (a passage plan laid first), at the 4 sizes ----------------
  for (const vp of [{ width: 1280, height: 720 }, { width: 2560, height: 1600 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const phone = vp.width < 900;
    const { page, errors } = await open('once=0&seed=1&kayaks=0&hour=15' + (phone ? '&touch=1' : ''), vp, phone ? { deviceScaleFactor: 2, hasTouch: true, isMobile: true } : {});
    await page.waitForFunction(() => window.__velia?.ready && window.__velia.m4?.ui, null, { timeout: 240000 });
    // a passage plan: two waypoints ahead of her (the nav column's WP, DTW, BTW, TTG, XTE block)
    const planned = await page.evaluate(async () => { await window.__velia.m4.mountChart?.(); const ch = window.__velia.m4.ui.services.get('chart'); if (!ch) return 'no chart'; await ch.planReady; const c = ch.course, b = window.__velia.boat.state; if (!c?.setRoute) return 'no course'; c.setRoute([{ x: b.x + Math.sin(b.heading) * 400, z: b.z - Math.cos(b.heading) * 400 }, { x: b.x + Math.sin(b.heading) * 900, z: b.z - Math.cos(b.heading) * 900 }], { activeLeg: 0, from: [b.x, b.z] }); return c.active ? 'ok' : 'not active'; });
    await page.waitForTimeout(2500);
    await page.evaluate(async () => { await window.__velia.mode.go('regatta'); window.__velia.regatta.r.go(); });   // the hub's In the box
    await page.waitForFunction(() => window.__velia.regatta?.r?.on, null, { timeout: 60000 });
    const sample = () => page.evaluate(() => {
      const vis = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return cs.display !== 'none' && cs.visibility !== 'hidden' && +cs.opacity > 0.05 && r.width > 0 && r.height > 0 ? { c: e.className, x: r.x, y: r.y, w: r.width, h: r.height } : null; };
      const sail = [...document.querySelectorAll('.lk-nav, .lk-keys, .lk-hint, .lk-calm-mark, .lk-guide, .lk-ntag, .lk-chart .pane, .lk-inst, .lk-hudc')].map(vis).filter(Boolean);
      const race = [...document.querySelectorAll('#rg .watch, #rg .fleet, #rg .coach:not(.off), #rg .tag:not([hidden]), #rg .edge:not([hidden]), #rg .pick:not([hidden])')].map(vis).filter(Boolean);
      const nav = document.querySelector('.lk-nav'); return { sail, race, navShown: !!nav && vis(nav) !== null, route: window.__velia.m4.ui.services.get('chart')?.plan?.route?.length ?? null };
    });
    let clash = null, navShown = false;
    for (const wait of [1500, 6000, 6000]) {
      await page.waitForTimeout(wait);
      const o = await sample(); navShown ||= o.navShown;
      for (const a of o.sail) for (const b of o.race) if (overlap(a, b)) clash ??= `${a.c} / ${b.c}`;
    }
    check(planned === 'ok' && !navShown && !clash, `${vp.width} × ${vp.height}: a plan laid, then the race: the nav column hidden, no Sail HUD piece under a race one (${planned}; ${clash ?? 'ok'})`);
    // leaving the race gives Sail its HUD and its plan back
    await page.evaluate(() => window.__velia.mode.go('sail')); await page.waitForTimeout(2500);
    const back = await page.evaluate(() => { const c = window.__velia.m4.ui.services.get('chart')?.course, p = window.__velia.m4.ui.services.get('passage'); return { active: !!c?.active, target: !!(p?.sync?.() ?? p)?.target }; });
    check(back.active && back.target, `${vp.width} × ${vp.height}: back in Sail, the plan's waypoint again (${JSON.stringify(back)})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
  // ---------------- R4: R is the jib in a race, never a restart; the clock's button restarts ----------------
  {
    const { page, errors } = await open('mode=regatta&once=0&seed=1&wind=3', { width: 1280, height: 720 });
    await page.addInitScript(() => { try { localStorage.setItem('lakeshore.regatta.level.v1', JSON.stringify({ level: 'club', laylines: false })); } catch { /* */ } });
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__velia?.regatta?.r?.on && window.__velia.frames > 10, null, { timeout: 240000 });
    await page.waitForTimeout(1500);
    const s0 = await page.evaluate(() => ({ clock: window.__velia.regatta.r.state().clock, restarts: window.__velia.regatta.r.session.restarts, jib: window.__velia.boat.sim.ctl.jibTrim ?? 0, level: window.__velia.regatta.r.aids.level }));
    await page.mouse.click(640, 300);   // the canvas has the keys
    await page.keyboard.down('KeyR'); await page.waitForTimeout(1500); await page.keyboard.up('KeyR'); await page.waitForTimeout(300);
    const s1 = await page.evaluate(() => ({ clock: window.__velia.regatta.r.state().clock, restarts: window.__velia.regatta.r.session.restarts, jib: window.__velia.boat.sim.ctl.jibTrim ?? 0 }));
    check(s0.level === 'club' && s1.restarts === s0.restarts && s1.clock > s0.clock + 1 && Math.abs(s1.jib - s0.jib) < 0.02, `R in a race does nothing in basic (the jib winch trims it) and never restarts (jib ${s0.jib.toFixed(2)} → ${s1.jib.toFixed(2)}; clock ${s0.clock.toFixed(1)} → ${s1.clock.toFixed(1)}, restarts ${s0.restarts} → ${s1.restarts})`);
    await page.waitForTimeout(2000);
    await page.click('#rg .watch .rst'); await page.waitForTimeout(400);
    const s2 = await page.evaluate(() => ({ clock: window.__velia.regatta.r.state().clock, restarts: window.__velia.regatta.r.session.restarts, status: window.__velia.regatta.r.state().me.status }));
    check(s2.restarts === s1.restarts + 1 && s2.clock < -43 && s2.status === 'prestart', `the clock's restart button: back in the box (${JSON.stringify(s2)})`);
    check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
