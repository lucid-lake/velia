// Shuffle on the real v2 page (owner, 2026-11-14: "play songs randomly so users don't get bored"; v2/audio/shuffle.js, music.js,
// ui/musicRow.js): ENTER starts the page's sound and the deck's first card; at a fast clock (music.pace: each piece cut at 9 s, the
// gaps × 0.1, so 2–4.5 s) the page plays through three songs on its own, each a different song, each streamed, with the lake alone
// between them, and logs the titles. Next song skips to the next card. Setup › Sound › music shows Shuffle checked; By time of day
// switches the music to the beds' scheduler and is stored; Shuffle again.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/shuffle.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); } catch {} };
const songOf = (p) => String(p ?? '').replace(/\.[a-z0-9]+$/i, '').replace(/_[ab]$/, '');

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/?mode=sail&hour=7&seed=3&attract=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front && window.__velia.music, null, { timeout: 240000 });
  check(await page.evaluate(() => window.__velia.music.pick === 'shuffle'), 'Shuffle by default');
  await page.evaluate(() => window.__velia.music.pace({ pieceS: 9, gapScale: 0.1 }));   // the fast clock

  // ENTER: the first card at once; then the page plays on by itself
  await pickMode(page, 'sail');
  const t0 = Date.now(), seen = [];   // seen[i]: the i-th card and the bar's title while it played (a card's t is set when it starts)
  while (Date.now() - t0 < 60000) {
    const s = await page.evaluate(() => { const m = window.__velia.music.stats(); return { title: m.song?.title ?? null, url: m.song?.url ?? null, cues: m.cues, now: m.shuffle.now }; });
    s.cues.forEach((c, i) => { seen[i] = { ...c, title: seen[i]?.title ?? null }; });
    const i = s.cues.length - 1;
    if (i >= 0 && s.title && s.url?.endsWith(s.cues[i].piece)) seen[i].title = s.title;
    if (seen.length >= 3 && seen[2].title && s.now > seen[2].t + 1) break;
    await page.waitForTimeout(250);
  }
  const titles = seen.slice(0, 3).map((c) => `${c.title} (${c.piece})`);
  console.log(`INFO  three songs at the fast clock: ${titles.join(' → ')}`);
  const fin = await page.evaluate(() => window.__velia.music.stats());
  const cues = fin.cues;
  check(cues.length >= 3 && cues.every((c) => c.bed === 'shuffle' && c.clock === 'audio'), `three shuffled cards played by themselves (${cues.length})`);
  check(seen.slice(0, 3).every((c) => c.title), `the bar's title for each: ${titles.join(' | ')}`);
  const songs = cues.slice(0, 3).map((c) => songOf(c.piece));
  check(new Set(songs).size === 3, `three different songs (${songs.join(', ')})`);
  const gaps = [cues[1].t - cues[0].end, cues[2].t - cues[1].end];
  check(gaps.every((g) => g >= 1.8 && g <= 5), `the lake alone between them, the 20–45 s gaps × 0.1 (${gaps.map((g) => g.toFixed(2)).join(', ')} s)`);
  check(cues.slice(0, 2).every((c) => Math.abs(c.end - c.t - 9) < 0.6), `each cut at the fast clock's 9 s (${cues.slice(0, 2).map((c) => (c.end - c.t).toFixed(2)).join(', ')} s)`);
  check(fin.loads.streamed >= 3 && fin.loads.decoded === 0 && fin.loads.errors === 0, `streamed, nothing decoded (${JSON.stringify(fin.loads)})`);

  // Next song: the next card at once
  const n0 = fin.cues.length;
  await page.mouse.move(640, 20); await page.mouse.move(600, 30); await page.waitForTimeout(400);   // the idle top bar wakes on a move
  await page.click('.lk-view:not(.off) .xt[data-x=cond]', { timeout: 5000 }).catch(() => {});   // the music is in the Conditions sheet
  const viaBar = await page.evaluate(() => { const b = document.querySelector('.lk-cond:not([hidden]) .nx'); if (b) b.click(); return !!b; });
  if (!viaBar) await page.evaluate(() => window.__velia.music.player.next());   // the bar's own call (setup.page.mjs presses the button)
  await page.waitForTimeout(600);
  console.log(`INFO  Next song via ${viaBar ? 'the bar\'s button' : 'music.player.next()'}`);
  const m2 = await page.evaluate(() => window.__velia.music.stats());
  check(m2.cues.length === n0 + 1 && songOf(m2.cues.at(-1).piece) !== songOf(m2.cues.at(-2).piece), `Next song: the next card (${m2.cues.slice(-2).map((c) => c.piece).join(' → ')})`);
  await page.keyboard.press('Escape').catch(() => {}); await page.mouse.click(640, 400); await page.waitForTimeout(200);

  // Setup › Sound › music
  await page.mouse.move(640, 20); await page.mouse.move(600, 30); await page.waitForTimeout(400);
  if (await page.evaluate(() => window.__veliaLoading.state !== 'menu')) await page.click('.lk-view:not(.off) .mn', { timeout: 5000 }).catch(() => {});   // Setup is on the Menu card
  await page.click('#lk-load .lk-link[data-go=settings]', { timeout: 5000 }).catch(() => {});
  if (!(await page.evaluate(() => !!document.querySelector('#lk-load .pg[data-page=settings]:not([hidden])')))) await page.evaluate(() => { const h = window.__velia.m4.front.home; h.open(); h.show('settings'); });   // the card's own call, if the idle bar hid
  await page.waitForFunction(() => document.querySelector('#lk-load .pg[data-page=settings]:not([hidden])'), null, { timeout: 5000 }).catch(() => {});
  await page.click('#lk-load .pg[data-page=settings] .tab[data-tab=sound]'); await page.waitForTimeout(100);
  const row = await page.evaluate(() => { const b = [...document.querySelectorAll('#lk-load [data-set=musicPick] [data-mp]')]; return b.map((x) => { const r = x.getBoundingClientRect(); return { mp: x.dataset.mp, text: x.textContent, on: x.getAttribute('aria-checked'), shown: r.width > 0 && r.height > 0 }; }); });
  check(row.length === 2 && row.every((b) => b.shown) && row[0].on === 'true' && row[1].text === 'by time of day', `the Sound tab's music row: ${JSON.stringify(row)}`);
  const fits = await page.evaluate(() => { const p = document.querySelector('#tp-set-sound'); return p ? p.scrollHeight <= p.clientHeight + 1 : false; });
  check(fits, 'the Sound tab still fits with no scroll');
  await page.click('#lk-load [data-mp=time]'); await page.waitForTimeout(100);
  const t = await page.evaluate(() => ({ pick: window.__velia.music.pick, shuffling: window.__velia.music.shuffling, stored: localStorage.getItem('velia.musicPick.v1'), on: document.querySelector('#lk-load [data-mp=time]').getAttribute('aria-checked') }));
  check(t.pick === 'time' && !t.shuffling && t.stored === 'time' && t.on === 'true', `By time of day: the beds' scheduler, stored (${JSON.stringify(t)})`);
  await page.click('#lk-load [data-mp=shuffle]'); await page.waitForTimeout(100);
  const s2 = await page.evaluate(() => ({ pick: window.__velia.music.pick, stored: localStorage.getItem('velia.musicPick.v1') }));
  check(s2.pick === 'shuffle' && s2.stored === 'shuffle', `Shuffle again (${JSON.stringify(s2)})`);
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
