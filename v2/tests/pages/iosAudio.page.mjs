// fix/v2-ios-audio: the owner's iPhone heard nothing on the live v2 page, not even after Next song. A touch-only phone (the
// owner's iPhone 16 Pro profile: isMobile, hasTouch, Safari's UA) under an emulation of Safari's iOS audio rules, injected before
// the page runs: an AudioContext runs only when resume() is called inside a touchend, pointerup, click or key (it starts
// suspended), and a media element's play() outside such an event is refused (NotAllowedError) unless that element has once
// played inside one. One tap on ENTER must get the page's context running and the first piece's element playing; the Sound
// menu's Next song must play the next piece.
// What only a real iPhone can confirm: Safari's own policy (this is an emulation in Chrome), the silent switch and
// navigator.audioSession, and that iOS loads a streamed piece's metadata before any gesture on that element.
// Run by `npm run test:pages:v2`, or node v2/tests/pages/iosAudio.page.mjs --base http://127.0.0.1:<port>
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
if (!BASE) { console.error('no server: run `npm run test:pages:v2`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const SEEN = { _v: 2, welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true };
const IPHONE = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  viewport: { width: 874, height: 402 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
};

// Safari's iOS audio rules, emulated (runs before the page's scripts)
function IOS_AUDIO() {
  const emu = window.__iosAudio = { activations: 0, refused: [], played: [], resumes: { ok: 0, refused: 0 } };
  let active = false;
  for (const k of ['touchend', 'pointerup', 'click', 'keydown']) {
    addEventListener(k, (e) => { if (!e.isTrusted) return; active = true; emu.activations++; setTimeout(() => { active = false; }, 0); }, true);
  }
  const AC = window.AudioContext, state = new WeakMap(), nativeResume = AC.prototype.resume, nativeSuspend = AC.prototype.suspend;
  window.AudioContext = class extends AC {
    constructor(...a) { super(...a); state.set(this, 'suspended'); nativeSuspend.call(this).catch(() => {}); }
    get state() { return state.get(this) ?? 'suspended'; }
    resume() {
      if (!active) { emu.resumes.refused++; return Promise.reject(new DOMException('not allowed by the user agent', 'NotAllowedError')); }
      emu.resumes.ok++;
      const was = state.get(this); state.set(this, 'running');
      return nativeResume.call(this).then(() => { if (was !== 'running') this.dispatchEvent(new Event('statechange')); });
    }
  };
  const unlocked = new WeakSet(), nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function play() {
    const src = String(this.currentSrc || this.src || '').split('/').pop().slice(0, 40);
    if (!active && !unlocked.has(this)) { emu.refused.push(src); return Promise.reject(new DOMException('not allowed by the user agent', 'NotAllowedError')); }
    if (active) unlocked.add(this);
    emu.played.push(src);
    return nativePlay.call(this);
  };
}

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });   // the emulation is the only gate
try {
  const ctx = await browser.newContext(IPHONE);
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }));
  await page.addInitScript((s) => { try { localStorage.setItem('lakeshore.settings.v1', JSON.stringify(s)); } catch {} }, SEEN);
  await page.addInitScript(IOS_AUDIO);
  await page.goto(`${BASE}/?mode=sail&hour=13&seed=3&attract=0`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__veliaLoading?.state === 'home' && window.__velia?.music, null, { timeout: 240000 });
  await page.evaluate(() => window.__velia.music.pace({ pieceS: 30, gapScale: 0.1 }));

  // one tap on ENTER (touch only: touchstart, touchend, then the click the browser makes from it)
  await page.tap('#lk-load .lk-pick[data-mode=sail]');
  await page.waitForFunction(() => window.__velia.music.stats().state === 'running', null, { timeout: 5000 }).catch(() => {});
  const a = await page.evaluate(() => ({ m: window.__velia.music.stats(), emu: window.__iosAudio }));
  console.log(`INFO  after one tap: context ${a.m.state}, resumes ${JSON.stringify(a.emu.resumes)}, activations ${a.emu.activations}`);
  check(a.m.started && a.m.state === 'running', `one tap: the page's AudioContext runs (${a.m.state})`);

  // the first piece streams and its element plays (its play() runs after the metadata loads, outside the tap)
  await page.waitForFunction(() => { const m = window.__velia.music.stats(); return m.song && window.__iosAudio.played.some((s) => /\.(opus|m4a)/.test(s)); }, null, { timeout: 20000 }).catch(() => {});
  const b = await page.evaluate(() => ({ m: window.__velia.music.stats(), emu: window.__iosAudio }));
  const pieces = (l) => l.filter((s) => /\.(opus|m4a)/.test(s));
  console.log(`INFO  played ${JSON.stringify(pieces(b.emu.played))}, refused ${JSON.stringify(pieces(b.emu.refused))}, song ${b.m.song?.title ?? 'none'}, loads ${JSON.stringify(b.m.loads)}`);
  check(!!b.m.song && pieces(b.emu.played).length >= 1, `the first piece plays after the tap (${b.m.song?.title ?? 'no song'})`);
  check(pieces(b.emu.refused).length === 0, `no piece's play() refused (${pieces(b.emu.refused).length})`);

  // Next song from the Conditions sheet's Sound row (the bar's pill), by touch
  const n0 = pieces(b.emu.played).length, id0 = b.m.song?.url ?? null;
  await page.tap('.lk-view:not(.off) .xt[data-x=cond]', { timeout: 5000 }).catch(() => {});
  const shown = await page.waitForSelector('.lk-cond:not([hidden]) .nx', { timeout: 5000 }).then(() => true, () => false);
  if (shown) await page.tap('.lk-cond:not([hidden]) .nx');
  console.log(`INFO  Next song ${shown ? 'tapped in the Conditions sheet' : 'not found from the phone bar'}`);
  check(shown, 'the Conditions sheet\'s Next song button is there on the phone');
  await page.waitForFunction((n) => window.__iosAudio.played.filter((s) => /\.(opus|m4a)/.test(s)).length > n, n0, { timeout: 20000 }).catch(() => {});
  const c = await page.evaluate(() => ({ m: window.__velia.music.stats(), emu: window.__iosAudio }));
  console.log(`INFO  after Next song: played ${JSON.stringify(pieces(c.emu.played))}, refused ${JSON.stringify(pieces(c.emu.refused))}, song ${c.m.song?.title ?? 'none'}`);
  check(pieces(c.emu.played).length > n0 && c.m.song && c.m.song.url !== id0, `Next song plays the next piece (${c.m.song?.title ?? 'none'})`);
  check(pieces(c.emu.refused).length === 0 && c.m.state === 'running', `still running, nothing refused (${c.m.state})`);
  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}
console.log(fails ? `\n${fails} failed` : '\nall passed');
process.exit(fails ? 1 : 0);
