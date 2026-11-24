// Setup's rows on the real v2 page (BACKLOG-v2 #9) and the music (#7): v1's home card Setup page (src/ui/homePages.js) mounted by
// v2/ui/front.js, each tab opened, each row pressed, and the system it names read back from the page (v2/ui/setup.js SETUP_ROWS):
// crew trim, shallow water, the steady horizon, the pilot, hints, the profile, words, key hints, button tips, sound,
// music, effects, the boat's radio (the fireworks evening, ?fireworks=1 as v1), the skipper's voice, display, HUD, larger text, the
// language and the quality ladder; no row is disabled "(soon)" except the language chip's Chinese. The rows with another on-screen path are
// gone (owner, 2026-11-17; setup.js REMOVED_ROWS): wind, weather (the Conditions sheet), Pro (the cockpit's PRO), auto-reef (the
// REEF selector), edge instruments (the column follows Pro), and Aids' duplicate "show the welcome again" (Help › Tutorials).
// Every tab fits with no scroll at 1280 x 720 and 844 x 390.
// The sound and effects switches show on the Sound tab. The music: ENTER (the gesture into Sail) starts the page's sound and cues
// a piece of the hour's bed (20:30: the golden hour), streamed through a media element (nothing decoded); the bar's Music menu
// holds Next song, pause and the volume; M mutes.
// Run by `npm run test:pages:v2` (LAKESHORE_BASE set), or node v2/tests/pages/setup.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';
import { pickMode } from './pick.mjs';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const PERSON = () => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false });
const WELCOMED = () => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify({ _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true })); localStorage.setItem('velia.musicPick.v1', 'time'); } catch {} };   // By time of day: the beds' entry piece (Shuffle: shuffle.page.mjs)

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(PERSON); await page.addInitScript(WELCOMED);
  await page.goto(`${BASE}/?mode=sail&hour=20.5&seed=1&attract=0&fireworks=1&cinema=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.ui && window.__velia.m4.front, null, { timeout: 240000 });
  const pre = await page.evaluate(() => ({ music: window.__velia.music.stats() }));
  check(!pre.music.started && pre.music.cues.length === 0 && pre.music.loads.streamed === 0, `before the gesture: no context, no cue, nothing loaded (${JSON.stringify({ s: pre.music.started, c: pre.music.cues.length })})`);
  const res0 = await page.evaluate(() => performance.getEntriesByType('resource').filter((r) => /\/audio\/music\//.test(r.name)).length);
  check(res0 === 0, 'no music file fetched before the first gesture');

  // ENTER: the gesture that enters Sail; the golden hour's piece starts, streamed
  await pickMode(page, 'sail');
  await page.waitForFunction(() => window.__velia.music.stats().song, null, { timeout: 30000 }).catch(() => {});
  const m1 = await page.evaluate(() => window.__velia.music.stats());
  check(m1.started && m1.state === 'running', `the page's sound runs after ENTER (${m1.state})`);
  check(m1.cues[0]?.bed === 'golden' && /golden_hour|dusk_water_a|first_light_b/.test(m1.cues[0]?.piece ?? ''), `the entry piece is the golden hour's (${JSON.stringify(m1.cues[0])})`);
  check(m1.loads.streamed === 1 && m1.loads.decoded === 0 && m1.streaming, `streamed through a media element, nothing decoded (${JSON.stringify(m1.loads)})`);
  check(m1.song?.title === 'Golden hour on the lake' || m1.song?.title === 'Dusk over the water' || m1.song?.title === 'Lake at first light', `the bar's title: ${m1.song?.title}`);
  const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
  console.log(`INFO  JS heap after the piece starts: ${heap ? (heap / 1048576).toFixed(1) : '?'} MB`);

  // the music lives in the bar's Conditions sheet (its Sound row: Next song, pause, volume); next plays another piece; M mutes
  await page.mouse.move(600, 400); await page.mouse.move(620, 410); await page.waitForTimeout(200);
  await page.click('.lk-view:not(.off) .xt[data-x=cond]');
  const menu = await page.evaluate(() => { const p = document.querySelector('.lk-cond:not([hidden])'); return p ? { next: !!p.querySelector('.nx'), pp: !!p.querySelector('.pp'), vol: !!p.querySelector('input[type=range]') } : null; });
  check(menu?.next && menu.pp && menu.vol, `the Conditions sheet's Sound row has Next song, pause and the volume (${JSON.stringify(menu)})`);
  await page.click('.lk-cond:not([hidden]) .nx'); await page.waitForTimeout(800);
  const m2 = await page.evaluate(() => window.__velia.music.stats());
  check(m2.cues.length === 2 && m2.cues[1].piece !== m2.cues[0].piece, `Next song: a different piece now (${m2.cues.map((c) => c.piece).join(' → ')})`);
  await page.click('.lk-cond:not([hidden]) .pp'); await page.waitForTimeout(100);
  check(await page.evaluate(() => window.__velia.music.stats().held), 'pause holds the music');
  // the sheet's sound switch (M went): off, then on
  check(await page.evaluate(() => !!document.querySelector('.lk-cond:not([hidden]) .mt')), 'the Conditions sheet has a sound on/off switch');
  await page.click('.lk-cond:not([hidden]) .mt');
  check(await page.waitForFunction(() => window.__velia.music.stats().muted === true, null, { timeout: 5000, polling: 20 }).then(() => true, () => false), 'the sound switch mutes');
  await page.click('.lk-cond:not([hidden]) .mt');
  check(await page.waitForFunction(() => window.__velia.music.stats().muted === false, null, { timeout: 5000, polling: 20 }).then(() => true, () => false), 'and unmutes');
  // #54: a press outside closes the picker (Escape never did: it opened the in-play card, which takes every key, so M was
  // swallowed whenever the card was still up; under load it often was). Then M, waiting for each state rather than 80 ms
  await page.click('.lk-cond:not([hidden]) .pp'); await page.mouse.click(160, 420);   // a press on the world, left of the sheet (it hangs under the pill, mid-screen at 1280 × 720)
  const clear = await page.waitForFunction(() => !document.querySelector('.lk-cond:not([hidden])') && window.__veliaLoading.state === 'gone', null, { timeout: 5000 }).then(() => true, () => false);
  const mutedIs = (want) => page.waitForFunction((w) => window.__velia.music.stats().muted === w, want, { timeout: 5000, polling: 20 }).then(() => true, () => false);
  await page.keyboard.press('KeyM'); await page.waitForTimeout(400);
  check(await page.evaluate(() => window.__velia.music.stats().muted === false), 'M is no key any more: the sound stays on');
  check(clear, `the picker closed and no card (${clear})`);

  // Setup: open it from the Menu card's Setup row (Setup left the bar, owner 2026-11-15), each tab
  // #54: a card still closing (data-off, 480 ms: navOn's close below, or a stray Escape) read as open, so the bar's button
  // was skipped and the tab click hit a fading card. Wait out a closing card, open Setup, wait until its page shows settled
  const openSetup = async () => {
    await page.waitForFunction(() => !document.getElementById('lk-load').hasAttribute('data-off'), null, { timeout: 5000 }).catch(() => {});
    if (await page.evaluate(() => window.__veliaLoading.state !== 'menu')) { await page.mouse.move(600, 400); await page.mouse.move(620, 410); await page.click('.lk-view:not(.off) .mn'); await page.waitForTimeout(300); }
    await page.click('#lk-load .lk-link[data-go=settings]');
    const shown = () => page.waitForFunction(() => { const r = document.getElementById('lk-load'); return r.hasAttribute('data-on') && !r.hasAttribute('data-off') && !!r.querySelector('.pg[data-page=settings]:not([hidden])'); }, null, { timeout: 5000 }).then(() => true, () => false);
    check(await shown(), 'Setup opens from the Menu card on a settled card');
  };
  await openSetup();
  const tab = async (k) => { await page.click(`#lk-load .pg[data-page=settings] .tab[data-tab=${k}]`); await page.waitForTimeout(80); };
  const v = (fn) => page.evaluate(fn);
  const press = async (sel) => { await page.click(`#lk-load .pg[data-page=settings] ${sel}`); await page.waitForTimeout(120); };
  const row = async (sel, fn, what) => { await press(sel); check(await v(fn), what); };

  await tab('sail');
  { const gone = await v(() => ['wind', 'weather', 'sailing', 'autoReef', 'edgeInstruments'].filter((k) => document.querySelector(`#lk-load .pg[data-page=settings] .set[data-set="${k}"]`))
      .concat(document.querySelector('#lk-load .pg[data-page=settings] [data-act=welcome-again]') ? ['welcome-again'] : []));
    check(gone.length === 0, `no wind, weather, Pro, auto-reef or edge instruments row, no second welcome button: each has another on-screen path (owner 2026-11-17) (left: ${gone.join(', ') || 'none'})`); }
  await row('[data-r="crewTrim:on"]', () => window.__velia.boat.sim.assists.crewTrim === true, 'crew trims on: the crew has the sheet');
  await row('[data-r="crewTrim:off"]', () => window.__velia.boat.sim.assists.crewTrim === false, 'crew trims off: your hands');
  await row('[data-r="shoal:off"]', () => window.__velia.m4.ui.grounding.on === false, 'shallow water off: v1\'s assist off');
  await row('[data-r="shoal:on"]', () => window.__velia.m4.ui.grounding.on === true, 'shallow water on');
  check(await v(() => !document.querySelector('#lk-load [data-set=calmCamera], #lk-load [data-calm]')), 'no calm camera row on Setup (the Helm view steadies itself)');
  check(await v(() => !document.querySelector('#lk-load [data-set=steady], #lk-load [data-set=kayakCam], #lk-load [data-r^="steady:"], #lk-load [data-r^="kayakCam:"]')), 'no steady horizon and no camera-to-kayaks row on Setup (owner 2026-11-19)');

  await tab('aids');
  check(await v(() => !document.querySelector('#lk-load .pg[data-page=settings] [data-t="pilot"]')), 'no pilot toggle on Aids: the steady-hands switch is the let-go hold (owner 2026-11-17)');
  check(await v(() => document.querySelector('#lk-load #tp-set-aids [data-set=assists] .v')?.firstElementChild?.dataset.sh === 'toggle'), 'steady hands first in the assists row');
  // round 2 (owner, 2026-11-21): Setup › Aids › gennaker: auto | off, default auto; the crew's mode follows it
  check(await v(() => [...document.querySelectorAll('#lk-load #tp-set-aids [data-set=gennaker] [data-gk]')].map((b) => `${b.dataset.gk}:${b.getAttribute('aria-checked')}`).join(' ') === 'auto:true off:false'), 'Aids: the gennaker row, auto | off, auto lit');
  await row('[data-gk="off"]', () => window.__velia.boat.sim.gennakerCrew.mode === 'off' || JSON.parse(localStorage.getItem('lakeshore.settings.v1') ?? '{}').gennaker === 'off', 'gennaker off: the crew never flies it');
  await row('[data-gk="auto"]', () => document.querySelector('#lk-load [data-gk="auto"]').getAttribute('aria-checked') === 'true', 'gennaker auto again');
  // the UI audit (owner, 2026-11-21): Tessie's switches are their own row, "tessie", out of assists (only where she is playable)
  { const ts = await v(() => ({ row: [...document.querySelectorAll('#lk-load #tp-set-aids [data-set=tessie] [data-ts]')].map((b) => b.textContent), key: document.querySelector('#lk-load #tp-set-aids [data-set=tessie] .k')?.textContent, inAssists: !!document.querySelector('#lk-load [data-set=assists] [data-ts]') }));
    check(ts.key === 'tessie' && ts.row.join('|') === 'invert up/down|camera follows her' && !ts.inAssists, `Setup › Aids: a "tessie" row with her two switches, none in assists (${JSON.stringify(ts)})`); }
  await row('[data-sh=toggle]', () => window.__velia.boat.sim.assists.pilot === false, 'steady hands off (the new sailor\'s on by default): let go, the helm eases amidships');
  await row('[data-sh=toggle]', () => window.__velia.boat.sim.assists.pilot === true, 'steady hands on: let go, she holds her heading');
  await row('[data-t="hints"]', () => window.__velia.m4.ui.hint.el.style.display === 'none', 'hints off: the skipper\'s line hidden');
  await row('[data-t="hints"]', () => window.__velia.m4.ui.hint.el.style.display !== 'none', 'hints on');
  await row('[data-r="profile:sail"]', () => window.__velia.m4.ui.skills.iSail === true, 'your sailing "I sail": the skill model\'s iSail');
  await row('[data-r="profile:new"]', () => window.__velia.m4.ui.skills.iSail === false, 'your sailing "new"');
  await row('[data-r="words:sailor"]', () => window.__velia.m4.ui.words.mode === 'sailor', 'words: sailor\'s only');
  await row('[data-r="words:both"]', () => window.__velia.m4.ui.words.mode === 'both', 'words: plain + sailor\'s');
  check(await v(() => !document.querySelector('#lk-load [data-set=windlines], #lk-load [data-r^="windLines:"]')), 'no wind lines row on Setup (owner 2026-11-19)');
  await row('[data-r="keyHints:off"]', () => !window.__velia.m4.ui.keyLegend.el.classList.contains('on') || window.__velia.m4.ui.keyLegend.el.offsetParent === null, 'key hints off: the legend goes');
  await press('[data-r="keyHints:on"]');
  await row('[data-r="tips:off"]', () => document.documentElement.dataset.lkTips === 'off', 'button tips off');
  await row('[data-r="tips:on"]', () => document.documentElement.dataset.lkTips !== 'off', 'button tips on');

  await tab('sound');
  const shown = await v(() => ['sound', 'music', 'effects', 'boatRadio'].map((k) => { const b = document.querySelector(`#lk-load .opt[data-t="${k}"]`); const r = b?.getBoundingClientRect(); return [k, !!r && r.width > 0 && r.height > 0]; }));
  check(shown.every(([, ok]) => ok), `the Sound tab shows sound, music, effects and radio (${JSON.stringify(shown)})`);
  await row('[data-t="sound"]', () => window.__velia.music.stats().muted === true, 'sound off: the master muted');
  await row('[data-t="sound"]', () => window.__velia.music.stats().muted === false, 'sound on');
  await row('[data-t="music"]', () => window.__velia.music.stats().buses.music === false, 'music off: the music bus');
  await row('[data-t="music"]', () => window.__velia.music.stats().buses.music === true, 'music on');
  await row('[data-t="effects"]', () => window.__velia.music.stats().buses.effects === false && window.__velia.beds?.live?.stats?.() != null, 'effects off: the effects bus and the beds\' boat');
  await row('[data-t="effects"]', () => window.__velia.music.stats().buses.effects === true, 'effects on');
  await press('[data-t="boatRadio"]');
  await page.waitForFunction(() => window.__velia.fireworks?.audio?.music?.playing?.want === 'radio', null, { timeout: 20000 }).catch(() => {});
  check(await v(() => window.__velia.fireworks?.audio?.music?.playing?.want === 'radio' && window.__velia.music.stats().holder === 'fireworks'), `radio on: a Sousa march on the music bus (${await v(() => JSON.stringify({ p: window.__velia.fireworks?.audio?.music?.playing, h: window.__velia.music.stats().holder }))})`);
  await press('[data-t="boatRadio"]'); await page.waitForTimeout(300);
  check(await v(() => window.__velia.fireworks?.audio?.music?.playing?.want !== 'radio'), 'radio off: the march stops');
  await row('[data-r="voice:off"]', () => window.__velia.m4.ui.voice.enabled === false, 'skipper\'s voice off');
  await row('[data-r="voice:on"]', () => window.__velia.m4.ui.voice.enabled === true, 'skipper\'s voice on');

  await tab('screen');
  await row('[data-r="display:day"]', () => document.documentElement.dataset.lkTheme === 'day', 'display day: the day palette');
  await row('[data-r="display:night"]', () => document.documentElement.dataset.lkTheme === 'night', 'display night: the red palette');
  await press('[data-r="display:auto"]');
  await row('[data-r="hud:clear"]', () => window.__velia.m4.ui.calm.mode === 'clear', 'HUD clear');
  await row('[data-r="hud:calm"]', () => window.__velia.m4.ui.calm.mode === 'calm', 'HUD calm');
  await row('[data-t="largeText"]', () => document.documentElement.dataset.lkText === 'large', 'larger text on');
  await row('[data-t="largeText"]', () => document.documentElement.dataset.lkText !== 'large', 'larger text off');
  await row('[data-r="lang:en"]', () => document.querySelector('#lk-load [data-r="lang:en"]').getAttribute('aria-checked') === 'true' && document.querySelector('#lk-load .opt[lang=zh]').disabled, 'language English; Chinese disabled (soon), as v1');
  await row('[data-r="quality:high"]', () => window.__velia.quality.state.level === 0 && window.__velia.quality.state.hold === 0, 'quality High: L0 held');
  await row('[data-r="quality:low"]', () => window.__velia.quality.state.level === 2 && window.__velia.quality.state.hold === 2, 'quality Battery: L2 held');
  check(/Now: Light\b/.test(await v(() => document.querySelector('#lk-load [data-qnow]').textContent)), 'the "Now:" line names the level in plain words');
  await row('[data-r="quality:auto"]', () => window.__velia.quality.state.hold === null, 'quality Auto: the ladder again');

  // every tab fits with no scroll, here and on a sideways phone (844 x 390: one line a row, setup.js SETUP_FIT_CSS)
  const over = async (pg) => { const o = {}; for (const k of ['sail', 'aids', 'sound', 'screen', 'race']) {
    if (!(await pg.evaluate((k) => { const t = document.querySelector(`#lk-load .pg[data-page=settings] .tab[data-tab=${k}]`); if (t) t.click(); return !!t; }, k))) continue;
    await pg.waitForTimeout(150); o[k] = await pg.evaluate(() => { const b = document.querySelector('#lk-load .pg.on .pg-b') ?? document.querySelector('#lk-load .pg.on'); return b ? b.scrollHeight - b.clientHeight : -1; }); } return o; };
  { const o = await over(page); check(Object.values(o).length >= 4 && Object.values(o).every((x) => x >= 0 && x <= 1), `1280 x 720: no Setup tab scrolls (${JSON.stringify(o)})`); }
  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
  {
    const ph = await browser.newPage({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
    const errs = []; ph.on('pageerror', (e) => errs.push(String(e)));
    await ph.addInitScript(PERSON); await ph.addInitScript(WELCOMED);
    await ph.goto(`${BASE}/?mode=sail&hour=15&seed=1&attract=0`, { waitUntil: 'load' });
    await ph.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.m4?.front, null, { timeout: 240000 });
    await ph.evaluate(() => document.querySelector('#lk-load .lk-link[data-go=settings]').click()); await ph.waitForTimeout(400);
    const o = await over(ph);
    check(Object.values(o).length >= 4 && Object.values(o).every((x) => x >= 0 && x <= 1), `844 x 390: no Setup tab scrolls (${JSON.stringify(o)})`);
    check(errs.length === 0, `no page errors at 844 x 390 (${errs.slice(0, 3).join(' | ')})`);
    await ph.close();
  }
} finally {
  await browser.close();
}
console.log(fails ? `${fails} failed` : 'all passed');
process.exit(fails ? 1 : 0);
