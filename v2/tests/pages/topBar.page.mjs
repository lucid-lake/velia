// The top bar on a live v2 page (v2/ui/topBar.js): the new bar by default (owner, 2026-11-15):
//   Sail     Menu · Full │ Cruise ⇄ │ Boat | Helm │ Conditions: no Chart (Menu and Esc open it: owner 2026-11-18), no Setup, no Music, no
//            Wind / Weather / clock buttons; Full right after Menu; the mode button reads where it goes (modeSwitch.page.mjs switches); the pill shows the time, the wind and the weather now; each control in the sheet
//            changes the world as the old buttons did (a time cut, the wind's level, the weather, the music's pause and next);
//            Escape closes the sheet; the music's ] key still skips
//   Cruise   Menu · Full │ Sail ⇄ │ Boat ▾ │ Conditions: no Take the helm, no Locker; Glasses and Photo in the View menu; the
//            sheet's VHF row toggles the radio
//   phones   upright (390 × 844) and sideways (844 × 390), Sail and Cruise: only Menu, the mode button, the view and Conditions; no dev label
//            and no key hints; no Glasses in Cruise's View menu; nothing with words or an icon drawn over or under the bar's box, with a 47 px notch too
//   the sheet (owner 2026-11-15): sky → water → ear in the pill (the time, the weather icon, the wind, the note only
//            while music plays; no caret, aria-expanded kept) and in the sheet (Time · Weather · Wind · Sound); one segmented bar for
//            the hours (Dawn · Midday · Golden · Night) and for the weather; every header shows its value; no mute button; no scroll at
//            1280 × 720, 1280 × 800 and 844 × 390, Sail and Cruise (Cruise's VHF in the sound row)
//   the ✳    the fireworks' marker on the sun strip: Tab reaches it, its tip says "Jump to the fireworks", Enter or a tap jumps: the
//            clock jumps under a short fade to 10 game s before the show, the sheet closes, no beacon (owner, 2026-11-18); the view, the
//            helm and Cruise's navigator stay as they were; a touch hit area of 44 px or more
//   ?bar=old the old bars, word for word (Sail: Setup, Music, Wind, Weather; Cruise: Take the helm, Locker), the fallback for one release
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/topBar.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const CHROME = process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run'] });
async function open(query, mode, { w = 1280, h = 800, phone = false, sat = 0 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, ...(phone ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  if (sat) await page.addInitScript((s) => document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = `:root{--lk-sat:${s}px!important}`; document.head.appendChild(st); }), sat);   // a notch (env() is 0 headless)
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch { /* blocked */ } }, SEEN);
  await page.goto(`${BASE}/?mode=${mode}&once=0&seed=1&kayaks=0&attract=0&noload=1&${query}`, { waitUntil: 'load' });
  await page.waitForFunction((m) => window.__velia?.ready && window.__velia.m4?.ui?.viewSwitch && window.__velia.boat?.sim?.t > 1 && (m !== 'cruise' || window.__velia.cruise?.c?.on), mode, { timeout: 240000 });
  await page.waitForTimeout(1500);
  return { page, errors };
}
const wake = async (page) => { await page.mouse.move(600, 400); await page.mouse.move(620, 410); await page.waitForTimeout(300); };
const frames = (page, n = 3) => page.evaluate((k) => new Promise((ok) => { let i = 0; const f = () => (++i >= k ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// the bar on screen: its visible buttons left to right, by data-x (the view pill is 'view', Menu 'menu'), and its words
const bar = (page) => page.evaluate(() => {
  const vis = (n) => !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0;
  const el = [...document.querySelectorAll('.lk-view')].find((v) => !v.classList.contains('off') && vis(v.querySelector('.isl')));
  if (!el) return null;
  const items = [...el.querySelector('.lay.full').children].filter(vis).filter((n) => n.matches('button,.pill,.mus'))
    .map((n) => n.classList.contains('mn') ? 'menu' : n.classList.contains('pill') ? 'view' : n.classList.contains('mus') ? 'sound' : n.classList.contains('clk') ? 'clock' : n.dataset.x);
  return { items, words: [...el.querySelectorAll('.lay.full .w')].filter(vis).map((w) => w.textContent), nb: el.classList.contains('nb'),
    pill: el.querySelector('.xt[data-x=cond]')?.getAttribute('aria-label') ?? null };
});
// what is drawn over or under the bar's box: visible elements with their own words or an icon, outside the bar and its menus (by
// boxes, so a pointer-events:none label counts; the dev label "… A/D helm · W/S sheets" sat under the bar on phones until 2026-11-15)
const overBar = (page) => page.evaluate(() => {
  const vis = (n) => !!n && getComputedStyle(n).display !== 'none' && n.getBoundingClientRect().width > 0;
  const bar = [...document.querySelectorAll('.lk-view')].find((v) => !v.classList.contains('off') && vis(v.querySelector('.isl')));
  if (!bar) return ['no bar'];
  const r = bar.querySelector('.isl').getBoundingClientRect(), hits = new Set();
  for (const el of document.body.querySelectorAll('*')) {
    if (bar.contains(el) || el.contains(bar) || el.closest('.lk-cond,.lk-timepick,.lk-sndpick,.lk-ntag')) continue;
    const own = [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) || (el.tagName === 'svg' && !el.parentElement?.closest('svg'));
    if (!own || !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    const b = el.getBoundingClientRect();
    if (b.width && b.height && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top) hits.add(el.id || el.closest('[id]')?.id || el.className?.baseVal || el.className || el.tagName);
  }
  return [...hits];
});
// the pill's parts left to right (sky → water → ear) and the sheet's sections, values and fit
const pillParts = (page) => page.evaluate(() => {
  const p = document.querySelector('.lk-view:not(.off) .xt[data-x=cond]');
  return { parts: [...p.children].filter((n) => n.checkVisibility()).map((n) => n.classList.contains('ct') ? 'time' : n.classList.contains('wx') ? 'weather' : n.classList.contains('w') ? 'wind' : n.classList.contains('ns') ? 'note' : n.tagName.toLowerCase()),
    caret: !!p.querySelector('.cv,.chev,[class*=chev]'), expanded: p.getAttribute('aria-expanded'), text: p.textContent.replace(/\s+/g, ' ').trim() };
});
const sheetRead = (page) => page.evaluate(() => {
  const s = document.querySelector('.lk-cond:not([hidden])'); if (!s) return null;
  const r = s.getBoundingClientRect();
  return { sections: [...s.querySelectorAll('section')].map((x) => x.dataset.s), heads: [...s.querySelectorAll('h3 b')].map((b) => b.textContent.trim()),
    hours: [...s.querySelectorAll('[data-s=time] .seg button')].map((b) => b.textContent.trim()), wx: [...s.querySelectorAll('[data-s=weather] .seg button')].map((b) => b.textContent.trim()),
    snd: [...s.querySelectorAll('[data-s=sound] .snd > *')].map((n) => n.classList.contains('mt') ? 'sound' : n.classList.contains('pp') ? 'play' : n.classList.contains('nx') ? 'next' : n.type === 'range' ? 'volume' : n.classList.contains('vhf') ? 'vhf' : n.tagName.toLowerCase()),
    mute: !!s.querySelector('.mu'), fw: s.querySelector('.fw')?.textContent.trim() ?? null, scroll: s.scrollHeight - s.clientHeight, bottom: r.bottom, vh: innerHeight, right: r.right, vw: innerWidth };
});
const click = async (page, sel) => { await wake(page); await page.locator(`.lk-view:not(.off) ${sel}`).filter({ visible: true }).first().click(); await frames(page, 4); };
const sheetClick = async (page, sel) => { await page.locator(`.lk-cond:not([hidden]) ${sel}`).first().click(); await frames(page, 4); };

try {
  // ---------------- Sail, the default bar ----------------
  {
    const { page, errors } = await open('hour=14.3', 'sail');
    await wake(page);
    const b = await bar(page);
    check(b?.nb && JSON.stringify(b.items) === JSON.stringify(['menu', 'fullscreen', 'mode', 'view', 'cond']), `Sail: Menu · Full · Cruise · Boat|Helm · Conditions (${b?.items.join(' · ')})`);
    check(!b.items.includes('settings') && !b.items.includes('sound') && !b.items.includes('wind') && !b.items.includes('weather') && !b.items.includes('clock'), 'Sail: no Setup, Music, Wind, Weather or clock button on the bar');
    check(/^Conditions · 14:1\d · \d+ kn [NESW]{1,2} · Fair/.test(b.pill ?? ''), `the pill reads the world now ("${b.pill}")`);
    {
      const playing = await page.evaluate(() => { const p = window.__velia.music?.player; return !!p && !p.paused && !p.off; });
      const pp = await pillParts(page);
      const want = ['time', 'weather', 'wind', ...(playing ? ['note'] : [])];
      check(JSON.stringify(pp.parts) === JSON.stringify(want) && !pp.caret && pp.expanded === 'false', `the pill: the time, the weather, the wind${playing ? ', the note' : ''}; no caret; aria-expanded false (${pp.parts.join(' · ')}, "${pp.text}")`);
      const m = await page.evaluate(() => { const p = window.__velia.music?.player; if (!p) return false; if (p.off) p.turnOn?.(); if (p.paused) p.toggle?.(); return true; });
      if (m) {
        await frames(page, 6); await page.waitForTimeout(400);
        const on = await pillParts(page);
        await page.evaluate(() => window.__velia.music.player.toggle()); await frames(page, 6); await page.waitForTimeout(400);
        const off = await pillParts(page);
        check(on.parts.at(-1) === 'note' && !off.parts.includes('note'), `the note only while music plays (playing: ${on.parts.join(' · ')}; paused: ${off.parts.join(' · ')})`);
      }
    }
    // the mode button reads where it goes (owner, 2026-11-18); no Chart button (Menu and Esc open the chart)
    check(b.words.includes('Cruise') && !b.words.includes('Chart') && !b.items.includes('chart'), `Sail: the button reads Cruise, no Chart button (${b.words.join(' · ')})`);
    // the sheet: open, each control, close
    await click(page, '.xt[data-x=cond]');
    check(await page.evaluate(() => !!document.querySelector('.lk-cond:not([hidden])') && document.querySelector('.lk-view:not(.off) .xt[data-x=cond]').getAttribute('aria-expanded') === 'true'), 'the pill opens the Conditions sheet');
    {
      const r = await sheetRead(page);
      check(JSON.stringify(r.sections) === JSON.stringify(['time', 'weather', 'wind', 'sound']), `the sheet: Time · Weather · Wind · Sound (${r.sections.join(' · ')})`);
      check(r.hours.join('|') === 'Dawn|Midday|Golden|Night' && r.wx.join('|') === 'Clear|Fair|Storm', `one segmented bar each: ${r.hours.join(' · ')} | ${r.wx.join(' · ')}`);
      check(r.heads.length === 4 && r.heads.slice(0, 3).every(Boolean) && /^14:1\d$/.test(r.heads[0]) && r.heads[1] === 'Fair' && /kn from/.test(r.heads[2]), `every header shows its value (${r.heads.join(' | ')})`);
      check(JSON.stringify(r.snd) === JSON.stringify(['sound', 'play', 'next', 'volume', 'vhf']) && !r.mute, `the sound row: the sound switch (M went), play, next, the volume, the VHF forecast (${r.snd.join(' · ')})`);
      check(r.fw === 'Fireworks 21:44', `the fireworks marker on the strip ("${r.fw}")`);
      const pp = await pillParts(page);
      check(pp.expanded === 'true', 'the open sheet: aria-expanded true');
    }
    const lv0 = await page.evaluate(() => window.__velia.m4.ui.viewSwitch.el && (window.__velia.wind?.level ?? null));
    await sheetClick(page, '[data-l="1"]');
    const lv = await page.evaluate(() => [...document.querySelectorAll('.lk-cond:not([hidden]) [data-l]')].find((x) => x.classList.contains('on'))?.dataset.l);
    check(lv === '1', `Wind: Light sets the level (lit row ${lv}, was ${lv0})`);
    await sheetClick(page, '[data-w="clear"]');
    check(await page.evaluate(() => window.__velia.weatherMenu?.current?.() === 'clear'), 'Weather: Clear sets the sky (weatherMenu.current() = clear)');
    const h0 = await page.evaluate(() => window.__velia.clock.hour);
    await sheetClick(page, '[data-t="night"]');
    const sw = await page.evaluate(() => window.__velia.m4.ui.dayClock.switching);
    await page.waitForFunction(() => !window.__velia.m4.ui.dayClock.switching, null, { timeout: 10000, polling: 'raf' }); await frames(page, 2);   // the pick's short fade (owner, 2026-11-18)
    const h1 = await page.evaluate(() => window.__velia.clock.hour);
    check(sw && h1 >= 22.5 && h1 < 22.7 && h1 !== h0, `Time: Night jumps the clock to 22:30 under a short fade (${h0.toFixed(2)} → ${h1.toFixed(2)}; fading ${sw})`);
    const m0 = await page.evaluate(() => { const p = window.__velia.music?.player; return p ? { paused: !!p.paused, id: p.songId ?? 0 } : null; });
    if (m0) {
      await sheetClick(page, '.pp');
      const m1 = await page.evaluate(() => !!window.__velia.music.player.paused);
      check(m1 !== m0.paused, `Sound: play / pause toggles the music (${m0.paused} → ${m1})`);
      await sheetClick(page, '.pp');
      await sheetClick(page, '.nx'); await page.waitForTimeout(400);
      const id2 = await page.evaluate(() => window.__velia.music.player.songId ?? 0);
      check(id2 !== m0.id, `Sound: next starts the next piece (song ${m0.id} → ${id2})`);
    } else check(true, 'no music on this page: the sound row is idle');
    await page.keyboard.press('Escape'); await frames(page);
    check(await page.evaluate(() => !document.querySelector('.lk-cond:not([hidden])') && !window.__velia.m4.ui.services.get('menu')?.isOpen), 'Escape closes the sheet (not the Menu)');
    // keyboard: the pill takes Enter, the sheet takes focus, arrows move in a group
    await page.focus('.lk-view:not(.off) .xt[data-x=cond]'); await page.keyboard.press('Enter'); await frames(page);
    const f = await page.evaluate(() => ({ open: !!document.querySelector('.lk-cond:not([hidden])'), inSheet: !!document.querySelector('.lk-cond:not([hidden])')?.contains(document.activeElement) }));
    check(f.open && f.inSheet, `keyboard: Enter on the pill opens the sheet with focus inside (${JSON.stringify(f)})`);
    await page.keyboard.press('Escape'); await frames(page);
    // the ✳: Tab reaches it, Enter jumps (a short fade, the clock set straight to the show, the sheet closes; no target, no beacon (owner, 2026-11-18); the view and the helm stay)
    {
      await page.focus('.lk-view:not(.off) .xt[data-x=cond]'); await page.keyboard.press('Enter'); await frames(page);
      let onFw = false;
      for (let i = 0; i < 12 && !onFw; i++) { onFw = await page.evaluate(() => document.activeElement?.classList.contains('fw')); if (!onFw) await page.keyboard.press('Shift+Tab'); }
      const tip = await page.evaluate(() => document.querySelector('.lk-cond .fw')?.dataset.tip);
      check(onFw && tip === 'Jump to the fireworks', `the ✳ takes the keyboard's focus; its tip "${tip}"`);
      const before = await page.evaluate(() => { const V = window.__velia; return { view: V.m4.views?.view ?? null, x: V.boat.state.x, z: V.boat.state.z, cuts: V.clock.cuts, hour: V.clock.hour, eye: [...V.camera.eye] }; });
      await page.keyboard.press('Enter');
      const just = await page.evaluate(() => ({ hour: window.__velia.clock.hour, open: !!document.querySelector('.lk-cond:not([hidden])') }));
      await page.waitForTimeout(1600); await frames(page, 4);
      const after = await page.evaluate(() => { const V = window.__velia, m = V.beacon?.mark?.mark ?? null, s = V.beacon?.state?.() ?? null; return { view: V.m4.views?.view ?? null, x: V.boat.state.x, z: V.boat.state.z, cuts: V.clock.cuts, hour: V.clock.hour, mark: m, kind: s?.kind ?? null, open: !!document.querySelector('.lk-cond:not([hidden])') }; });
      check(!just.open && !after.open, 'the jump closes the sheet');
      check(Math.abs(just.hour - before.hour) < 0.05 && after.cuts === before.cuts + 1 && after.hour > 21.7 && after.hour < 21.8, `the clock jumps under the fade: not at the tap, one cut (${before.hour.toFixed(3)} → ${just.hour.toFixed(3)} at the tap → ${after.hour.toFixed(4)}; cuts ${before.cuts} → ${after.cuts})`);
      check(!after.mark && after.kind == null, `no target, no beacon (owner, 2026-11-18) (${JSON.stringify(after.mark)}, kind ${after.kind})`);
      check(after.view === before.view && Math.hypot(after.x - before.x, after.z - before.z) < 15, `the view and the boat stay (${before.view} → ${after.view}; moved ${Math.hypot(after.x - before.x, after.z - before.z).toFixed(1)} m in 1.6 s)`);
      await page.evaluate(() => window.__velia.beacon?.mark?.clear());
    }
    check(errors.length === 0, `Sail: no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- Cruise, the default bar ----------------
  {
    const { page, errors } = await open('', 'cruise');
    await wake(page);
    const b = await bar(page);
    check(b?.nb && JSON.stringify(b.items) === JSON.stringify(['menu', 'fullscreen', 'mode', 'views', 'cond']), `Cruise: Menu · Full · Sail · the view · Conditions (${b?.items.join(' · ')})`);
    check(b.words.includes('Sail') && !b.words.includes('Cruise') && !b.words.includes('Chart'), `Cruise: the button reads Sail (${b.words.join(' · ')})`);
    check(b.words.includes('Boat') && !b.words.includes('Cinematic'), `Cruise: the view button reads Boat at the start (owner, 2026-11-15: Cinematic last) (${b.words.join(' · ')})`);
    check(!b.words.includes('Take the helm') && !b.items.includes('take') && !b.items.includes('locker'), `Cruise: no Take the helm, no Locker (${b.words.join(' · ')})`);
    await click(page, '.xt[data-x=views]');
    const rows = await page.evaluate(() => [...document.querySelectorAll('.lk-timepick')].filter((m) => !m.hidden).flatMap((m) => [...m.querySelectorAll('button')].map((x) => x.textContent.trim())));
    check(rows.includes('Glasses') && rows.includes('Photo') && rows.includes('Cinematic'), `Cruise: the View menu holds the cameras, Glasses and Photo (${rows.join(' | ')})`);
    check(rows[0] === 'Boat' && rows.indexOf('Cinematic') === 4, `Cruise: Boat first, Cinematic last of the five cameras (${rows.join(' | ')})`);
    await click(page, '.xt[data-x=views]');   // closed by its own button
    await click(page, '.xt[data-x=cond]');
    const r0 = await page.evaluate(() => window.__velia.m4.captain?.channel);
    await sheetClick(page, '.vhf');
    const r1 = await page.evaluate(() => window.__velia.m4.captain?.channel);
    check(r1 !== r0, `Cruise: the sheet's VHF button asks for the weather channel (${r0} → ${r1})`);
    await sheetClick(page, '[data-l="4"]');
    check(await page.evaluate(() => document.querySelector('.lk-cond:not([hidden]) [data-l="4"]')?.classList.contains('on') && window.__velia.cruise.c && true), 'Cruise: Wind Strong sets the level');
    {
      const r = await sheetRead(page);
      check(JSON.stringify(r.snd) === JSON.stringify(['sound', 'play', 'next', 'volume', 'vhf']), `Cruise: the sound switch first, the VHF at the sound row's end, no row of its own (${r.snd.join(' · ')})`);
      const before = await page.evaluate(() => { const V = window.__velia; return { dest: V.cruise.c?.voyage?.nav?.dest ?? null, view: V.cruise.c?.voyage?.rig?.view ?? V.m4?.ui?.services?.get?.("cruiseView")?.view?.() ?? null }; });
      await sheetClick(page, '.fw'); await page.waitForTimeout(2200); await frames(page, 4);
      const after = await page.evaluate(() => { const V = window.__velia, s = V.beacon?.state?.() ?? null; return { dest: V.cruise.c?.voyage?.nav?.dest ?? null, view: V.cruise.c?.voyage?.rig?.view ?? V.m4?.ui?.services?.get?.("cruiseView")?.view?.() ?? null, hour: V.clock.hour, mark: V.beacon?.mark?.mark ?? null, kind: s?.kind ?? null, x: s?.x, z: s?.z, open: !!document.querySelector('.lk-cond:not([hidden])') }; });
      check(!after.open && after.hour > 21.7 && after.hour < 21.8, `Cruise: the ✳ jumps to the show and closes the sheet (${after.hour.toFixed(4)})`);
      check(!after.mark && after.kind !== 'sail' && JSON.stringify(after.dest) === JSON.stringify(before.dest) && after.view === before.view, `Cruise: no mark for the show (owner, 2026-11-18), the navigator and the camera stay (kind ${after.kind}, dest ${JSON.stringify(before.dest)} → ${JSON.stringify(after.dest)}, view ${before.view} → ${after.view})`);
      await page.evaluate(() => window.__velia.beacon?.mark?.clear());
    }
    check(errors.length === 0, `Cruise: no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- phones: the fewest controls, nothing over or under the bar ----------------
  for (const [mode, w, h, sat] of [['sail', 390, 844, 0], ['cruise', 390, 844, 0], ['sail', 844, 390, 0], ['cruise', 844, 390, 0], ['sail', 375, 667, 0], ['sail', 390, 844, 47], ['sail', 844, 390, 47]]) {
    const { page, errors } = await open('', mode, { w, h, phone: true, sat });
    await page.evaluate(() => dispatchEvent(new Event('resize'))); await page.waitForTimeout(600);
    const b = await bar(page), view = mode === 'sail' ? 'view' : 'views';
    const at = `${mode} ${w}×${h}${sat ? `, a ${sat} px notch` : ''}`;
    check(b?.nb && JSON.stringify(b.items) === JSON.stringify(['menu', 'mode', view, 'cond']), `${at}: Menu · Cruise/Sail · the view · Conditions only (${b?.items.join(' · ')})`);
    check(b.items.includes('mode') && b.words.concat(b.items).length > 0, `${at}: the mode switch is on the phone's top bar, not in the ⋯ menu`);
    const label = await page.evaluate(() => { const l = document.getElementById('label'); return !!l && l.checkVisibility(); });
    const keys = await page.evaluate(() => /\b[AWSD]\/[AWSD]\b|\bW\/S\b|\bA\/D\b/.test(document.body.innerText));
    check(!label && !keys, `${at}: no dev label and no key hints on the screen (label ${label}, keys ${keys})`);
    const over = await overBar(page);
    check(over.length === 0, `${at}: nothing over or under the bar (${over.join(', ')})`);
    if (mode === 'cruise' && !sat) {   // owner 2026-11-15: no binoculars on phones (the View menu keeps the cameras and Photo)
      await page.locator('.lk-view:not(.off) .xt[data-x=views]').filter({ visible: true }).first().tap(); await page.waitForTimeout(300);
      const rows = await page.evaluate(() => [...document.querySelectorAll('.lk-timepick')].filter((m) => !m.hidden).flatMap((m) => [...m.querySelectorAll('button')].map((x) => x.textContent.trim())));
      check(!rows.includes('Glasses') && rows.includes('Photo'), `${at}: the View menu has no Glasses (${rows.join(' | ')})`);
    }
    check(errors.length === 0, `${at}: no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- the sheet fits with no scroll (desktop 1280 × 720 and 800, a sideways phone 844 × 390), Sail and Cruise ----------------
  for (const [mode, w, h, phone] of [['sail', 1280, 720, false], ['cruise', 1280, 720, false], ['sail', 1280, 800, false], ['sail', 844, 390, true], ['cruise', 844, 390, true]]) {
    const { page, errors } = await open('hour=18.84', mode, { w, h, phone });
    await page.evaluate(() => { const p = window.__velia.music?.player; if (p?.off) p.turnOn?.(); if (p?.paused) p.toggle?.(); });
    if (phone) await page.locator('.lk-view:not(.off) .xt[data-x=cond]').filter({ visible: true }).first().tap(); else await click(page, '.xt[data-x=cond]');
    await frames(page, 4);
    const r = await sheetRead(page), at = `${mode} ${w}×${h}`;
    check(!!r && r.scroll <= 0 && r.bottom <= r.vh && r.right <= r.vw, `${at}: the sheet fits, no scroll (scroll ${r?.scroll}, bottom ${Math.round(r?.bottom)} of ${r?.vh})`);
    const fwPick = await page.evaluate(() => ({ btn: !!document.querySelector('.lk-cond:not([hidden]) [data-t=fireworks], .lk-cond:not([hidden]) .fw'), text: document.querySelector('.lk-cond:not([hidden])')?.innerText ?? '', hours: [...document.querySelectorAll('.lk-cond:not([hidden]) .seg [data-t]')].map((b) => b.textContent.trim()).join('|') }));
    check(phone ? !fwPick.btn && !/fireworks/i.test(fwPick.text) && fwPick.hours === 'Dawn|Midday|Golden|Night' : fwPick.btn, `${at}: ${phone ? 'a phone has no Fireworks pick and no ✳ on the Conditions sheet (owner, 2026-11-19), the four cuts stay' : 'desktop keeps the ✳ Fireworks pick'} (${fwPick.hours})`);
    check(errors.length === 0, `${at}: no page errors (${errors.join(' | ')})`);
    await page.close();
  }
  // ---------------- ?bar=old: the old bars ----------------
  {
    const { page } = await open('bar=old', 'sail');
    await wake(page);
    const b = await bar(page);
    check(!b.nb && b.items.includes('settings') && b.items.includes('sound') && b.items.includes('wind') && !b.items.includes('cond') && !b.items.includes('chart'), `?bar=old: Sail's old bar (${b.items.join(' · ')})`);
    await page.close();
  }
  {
    const { page } = await open('bar=old', 'cruise');
    await wake(page);
    const b = await bar(page);
    check(!b.nb && b.words.includes('Take the helm') && b.items.includes('locker'), `?bar=old: Cruise's old bar (${b.words.join(' · ')})`);
    await page.close();
  }
} finally { await browser.close(); }
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
