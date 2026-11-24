// The top bar's words in a real browser (owner, 2026-11-10; src/ui/viewSwitch.js, wordFit): every button shows its icon and its
// word while the worded bar fits the window, and every word goes at once when it does not. One measured rule: no mix of worded and
// wordless buttons at any width, nothing cut by the capsule, nothing overlapping, one flip on the way down. Measured on
// feat/cruise-locker (2026-11-11: the chevrons on the menu buttons, no ⏭ on the bar): Sail switches at about 834 to 844 px under
// Fair and 856 to 868 px under Storm (was 803 and 816); the test holds a margin either side: words at 900 px and up, icons at
// 790 px and under. Cruise's one bar (the camera button, Take the helm, the Locker, Wind, Weather) is longer: it switches
// between CRUISE_ICONS_TO and CRUISE_WORDS_FROM; an upright phone (412 and 390 px) is icons, every chevron a corner badge.
// The same rule on a stand-in DOM (the .ico class): tests/viewSwitch.test.mjs.
// Run by `npm run test:pages` (LAKESHORE_BASE set), or
//   node tests/pages/barWords.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const URL_ = '/?once=0&attract=0&mute=1&metrics=0&first=0&welcome=0&seed=1';
const quiet = () => { try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } catch {} };
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const WORDS_FROM = 900, ICONS_TO = 790;   // the margin either side of the measured switch (about 834 to 868 px in Sail)
const CRUISE_WORDS_FROM = 1240, CRUISE_ICONS_TO = 1000;   // Cruise's switch, measured between 1060 and 1080 px (2026-11-11)

// the bar as the player sees it: each shown item, whether its word shows, its name, and whether anything is cut or overlaps
const bar = (page) => page.evaluate(() => {
  const el = document.querySelector('.lk-view'), isl = el.querySelector('.isl'), lay = el.querySelector('.lay.full'), R = isl.getBoundingClientRect();
  const shown = (x) => { const s = getComputedStyle(x), r = x.getBoundingClientRect(); return s.display !== 'none' && r.width > 0; };
  const items = [...lay.querySelectorAll(':scope > button, :scope > .pill > button, :scope > .mus > button, :scope > .clk')].filter(shown);
  const rs = items.map((x) => { const r = x.getBoundingClientRect(), wd = x.querySelector('.w');
    return { id: x.dataset.x ?? x.dataset.view ?? x.className.split(' ')[0], l: r.left, r: r.right, t: r.top, b: r.bottom, word: wd ? shown(wd) : null, text: wd?.textContent ?? '', name: x.getAttribute('aria-label') ?? '', btn: x.tagName === 'BUTTON' }; });
  let overlap = 0; for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (Math.min(rs[i].r, rs[j].r) - Math.max(rs[i].l, rs[j].l) > 1) overlap++;
  const worded = rs.filter((r) => r.word !== null);
  return { vw: innerWidth, cls: el.className.replace('lk-view', '').trim(), isl: [Math.round(R.left), Math.round(R.right)], ico: el.classList.contains('ico'), ids: rs.map((r) => r.id), with: worded.filter((r) => r.word).map((r) => `${r.id}:${r.text}`), without: worded.filter((r) => !r.word).map((r) => r.id),
    noName: rs.filter((r) => r.btn && !r.name).map((r) => r.id), noWord: rs.filter((r) => r.btn && r.word === null).map((r) => r.id),
    cut: rs.filter((r) => r.l < R.left - 0.5 || r.r > R.right + 0.5).map((r) => r.id), overlap, rows: new Set(rs.map((r) => Math.round((r.t + r.b) / 12))).size,
    inWin: R.left >= 0 && R.right <= innerWidth + 0.5, clockGlyph: !!lay.querySelector('.clk svg') && shown(lay.querySelector('.clk svg')) };
});
const whole = (b) => b.cut.length === 0 && b.overlap === 0 && b.rows === 1 && b.inWin;
const allWords = (b) => !b.ico && b.without.length === 0 && b.with.length >= 3;
const allIcons = (b) => b.ico && b.with.length === 0 && b.without.length >= 3;
const say = (b) => `${b.vw} px: ${b.ico ? 'icons' : 'words'}; with ${b.with.join(' ') || '-'}; without ${b.without.join(' ') || '-'}; cut ${b.cut.join(' ') || '-'}; overlap ${b.overlap}; rows ${b.rows}; capsule ${b.isl.join(' to ')}${/song|tight/.test(b.cls) ? '; a song title has the bar' : ''}`;

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-webgpu', '--no-first-run', '--mute-audio'] });
try {
  const open = async (opt, q = '') => {
    const ctx = await browser.newContext(opt); const page = await ctx.newPage(); const perr = []; page.on('pageerror', (e) => perr.push(String(e).slice(0, 200)));
    await page.addInitScript(quiet);
    await page.goto(BASE + URL_ + q, { waitUntil: 'load' });
    await page.waitForFunction(() => !!window.__lakeshore?.core?.sky && !!window.__lakeshore?.menu && !!document.querySelector('.lk-view .lay.full'), null, { timeout: 400000 });
    await page.waitForTimeout(4000);
    if (await page.evaluate(() => !!window.__lakeshore.menu.isOpen)) { await page.keyboard.press('Escape'); await page.waitForTimeout(1200); }
    return { ctx, page, perr };
  };
  const at = async (page, w, h = 720) => { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(700); await page.mouse.move(w / 2, 300);
    // a song title has the bar for 4 s and the capsule eases to its width: read the bar at rest
    await page.waitForFunction(() => !/\b(song|tight)\b/.test(document.querySelector('.lk-view').className), null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(500); return bar(page); };

  // ---- Sail on a desktop window: words above the switch, icons below, one flip, nothing cut ----
  {
    const { ctx, page, perr } = await open({ viewport: { width: 1440, height: 720 } });
    for (const w of [1440, 1024, WORDS_FROM]) { const b = await at(page, w); check(allWords(b) && whole(b), `Sail, ${w} px: every button has its word, the bar whole (${say(b)})`); }
    const b0 = await at(page, 1440);
    check(['mn', 'follow', 'helm', 'wind', 'weather', 'sound', 'fullscreen', 'settings'].every((id) => b0.with.some((x) => x.startsWith(id + ':'))), `the worded buttons: menu, both views, wind, weather, music, full screen, setup (${b0.with.join(' ')})`);
    check(b0.with.includes('weather:Fair') && b0.clockGlyph, `Weather says the weather (Fair), as Wind says its level; the clock has its glyph (${b0.with.join(' ')})`);
    check(b0.noName.length === 0, `every button has an aria-label (${b0.noName.join(' ') || 'all'})`);
    for (const w of [ICONS_TO, 720, 560]) { const b = await at(page, w); check(allIcons(b) && whole(b) && b.noName.length === 0 && !b.clockGlyph, `Sail, ${w} px: icons only, every one named, the bar whole (${say(b)})`); }
    // the way down, Fair then Storm (the longer word): all or none at every width, one flip, and the same width on the way up
    for (const sky of ['fair', 'storm']) {
      if (sky === 'storm') { await at(page, 1440); await page.evaluate(() => window.__lakeshore.core.sky.pick('storm')); await page.waitForTimeout(1500); }
      let flips = 0, last = false, bad = [], sw = null;
      for (let w = 1000; w >= 700; w -= 12) { const b = await at(page, w); if (!(allWords(b) || allIcons(b)) || !whole(b)) bad.push(say(b)); if (b.ico !== last) { flips++; last = b.ico; sw = w; } }
      check(bad.length === 0 && flips === 1 && sw < WORDS_FROM && sw > ICONS_TO, `Sail under ${sky}, 1000 to 700 px: never a mix, never cut, one flip, between ${ICONS_TO} and ${WORDS_FROM} px (at ${sw} px; ${bad[0] ?? 'clean'})`);
      const up = await at(page, WORDS_FROM); check(allWords(up) && whole(up), `the words come back at ${WORDS_FROM} px (${say(up)})`);
    }
    // a word that grows without a resize: Storm picked just above Fair's switch
    await page.evaluate(() => window.__lakeshore.core.sky.pick('fair')); await page.waitForTimeout(1200);
    let edge = null; for (let w = 880; w >= 820; w -= 2) { const b = await at(page, w); if (b.ico) break; edge = w; }
    if (edge) { await at(page, edge); await page.evaluate(() => window.__lakeshore.core.sky.pick('storm')); await page.waitForTimeout(1500); const b = await bar(page);
      check((allWords(b) || allIcons(b)) && whole(b), `Storm picked at the last worded width (${edge} px), no resize: still all or none, nothing cut (${say(b)})`); }
    else check(false, 'no worded width found between 820 and 880 px');
    await page.evaluate(() => window.__lakeshore.core.sky.pick('fair')); await page.waitForTimeout(800);
    // Helm view keeps the rule
    await at(page, 1024); await page.click('.lk-view [data-view=helm]'); await page.waitForTimeout(2500);
    const h1 = await at(page, 1024), h2 = await at(page, ICONS_TO);
    check(allWords(h1) && whole(h1) && allIcons(h2) && whole(h2), `Helm view: words at 1024 px, icons at ${ICONS_TO} px (${say(h1)} | ${say(h2)})`);
    check(perr.length === 0, `no page error in Sail (${perr.join(' | ') || 'none'})`);
    await ctx.close();
  }
  // ---- Cruise: the same rule on its one bar (2026-11-11: Menu | camera ▾ · Take the helm | Locker ▾ | Music Full Setup | Wind Weather | clock) ----
  {
    const { ctx, page, perr } = await open({ viewport: { width: 1440, height: 720 } }, '&mode=cruise');
    const a = await at(page, 1440), a2 = await at(page, CRUISE_WORDS_FROM);
    check(allWords(a) && whole(a) && allWords(a2) && whole(a2) && ['views', 'take', 'locker', 'wind', 'weather'].every((id) => a.with.some((x) => x.startsWith(id + ':'))),
      `Cruise, 1440 and ${CRUISE_WORDS_FROM} px: every button has its word, the camera, Take the helm, the Locker, Wind and Weather among them (${say(a)})`);
    let bad = [], n = 0, flips = 0, last = false, sw = null;
    for (let w = 1300; w >= 360; w -= 20) { const x = await at(page, w); n++; if (!(allWords(x) || allIcons(x)) || !whole(x) || x.noName.length) bad.push(say(x)); if (x.ico !== last) { flips++; last = x.ico; sw = w; } }
    check(bad.length === 0 && flips === 1 && sw < CRUISE_WORDS_FROM && sw > CRUISE_ICONS_TO, `Cruise, 1300 to 360 px (${n} widths): never a mix, never cut, every button named, one flip between ${CRUISE_ICONS_TO} and ${CRUISE_WORDS_FROM} px (at ${sw} px; ${bad[0] ?? 'clean'})`);
    const c = await at(page, 412); check(allIcons(c) && whole(c), `Cruise, 412 px: icons only, the bar whole (${say(c)})`);
    const badges = await page.evaluate(() => [...document.querySelectorAll('.lk-view .lay.full .cv')].filter((v) => v.getBoundingClientRect().width > 0).map((v) => getComputedStyle(v).position));
    check(badges.length >= 3 && badges.every((p) => p === 'absolute'), `Cruise, 412 px: every shown chevron (the camera, the Locker, Music at least) is a corner badge (${badges.length}: ${badges.join(' ')})`);
    check(perr.length === 0, `no page error in Cruise (${perr.join(' | ') || 'none'})`);
    await ctx.close();
  }
  // ---- a phone: icons only, every one named ----
  {
    const { ctx, page, perr } = await open({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true, userAgent: UA }, '&touch=1');
    await page.waitForTimeout(800); const b = await bar(page);
    check(allIcons(b) && whole(b) && b.noName.length === 0, `phone, 390 x 844: icons only, every one named, the bar whole (${say(b)})`);
    check(perr.length === 0, `no page error on the phone (${perr.join(' | ') || 'none'})`);
    await ctx.close();
  }
} finally { await browser.close(); }
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
