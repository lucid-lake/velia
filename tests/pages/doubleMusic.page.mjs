// Two songs at once (owner, 2026-11-06: "sometimes two songs play in the background at the same time, for example when
// switching between Sail and Cruise mode"): the real page, the real mode switches, the music sources watched. An init
// script tags every decoded piece of audio/music/ with its file, follows each AudioBufferSourceNode that plays one to its
// own GainNode and samples that gain every 100 ms; a piece is audible above 0.01. Each sequence must never have two
// audible pieces for longer than a hand-over's crossfade (MUSIC_XFADE_S, src/audio.js) plus a margin.
// The bus's model (one owner at a time) is checked fast in tests/musicBus.test.mjs.
// Run by `npm run test:pages` (LAKESHORE_BASE set; needs the GPU), or
//   node tests/pages/doubleMusic.page.mjs --base http://127.0.0.1:<port> [--only <name>,…]
import { chromium } from 'playwright-core';
import { MUSIC_XFADE_S } from '../../src/audio.js';

const argv = process.argv.slice(2);
const BASE = argv.includes('--base') ? argv[argv.indexOf('--base') + 1] : process.env.LAKESHORE_BASE;
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
if (!BASE) { console.error('no server: run `npm run test:pages`, or pass --base'); process.exit(2); }
let fails = 0;
const check = (ok, what) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`); if (!ok) fails++; };
const LIMIT_S = MUSIC_XFADE_S + 0.6;   // the crossfade plus the sampler's step and a render quantum or two

function instrument() {
  const M = (window.__mus = { srcs: [], samples: [] });
  const abUrl = new WeakMap(), bufUrl = new WeakMap();
  const F = window.fetch.bind(window);
  window.fetch = async (...a) => {
    const r = await F(...a), url = String(a[0]?.url ?? a[0]);
    if (url.includes('/audio/music/')) { const ab = r.arrayBuffer.bind(r); r.arrayBuffer = async () => { const b = await ab(); abUrl.set(b, url); return b; }; }
    return r;
  };
  const D = BaseAudioContext.prototype.decodeAudioData;
  BaseAudioContext.prototype.decodeAudioData = function (ab, ...rest) { const url = abUrl.get(ab); return D.call(this, ab, ...rest).then((b) => { if (url) bufUrl.set(b, url); return b; }); };
  const S = window.AudioBufferSourceNode;
  window.AudioBufferSourceNode = class extends S {
    constructor(ctx, o) {
      super(ctx, o);
      const url = o?.buffer ? bufUrl.get(o.buffer) : null;
      if (!url) return;
      const rec = { piece: url.split('/').pop(), gain: null, started: null, ended: false };
      M.srcs.push(rec);
      const C = this.connect.bind(this), st = this.start.bind(this);
      this.connect = (d, ...x) => { if (!rec.gain && d instanceof GainNode) rec.gain = d; return C(d, ...x); };
      this.start = (...x) => { rec.started = performance.now(); return st(...x); };
      this.addEventListener('ended', () => { rec.ended = true; });
    }
  };
  setInterval(() => {
    const on = M.srcs.filter((r) => r.started && !r.ended && r.gain && r.gain.gain.value > 0.01).map((r) => `${r.piece}#${M.srcs.indexOf(r)}`);
    M.samples.push({ t: performance.now() / 1000, on, mode: window.__lakeshore?.mode });
  }, 100);
  try { const k = 'lakeshore.settings.v1', o = JSON.parse(localStorage.getItem(k) ?? '{}'); Object.assign(o, { welcomed: true, introShown: true, goalDone: true, cruiseOffered: true, proOffered: true }); localStorage.setItem(k, JSON.stringify(o)); } catch { /* blocked */ }
}

// the longest run any two pieces are audible together, and which two (quick taps chain crossfades: each pair counts alone)
function overlaps(samples) {
  let best = { s: 0, pieces: [] };
  const runs = new Map();   // "a|b" → the sample that began their current run
  samples.forEach((x, i) => {
    const now = new Set();
    for (const a of x.on) for (const b of x.on) if (a < b) { const k = `${a}|${b}`; now.add(k); if (!runs.has(k)) runs.set(k, x); }
    for (const [k, x0] of runs) {
      if (now.has(k) && i < samples.length - 1) continue;
      const s = (now.has(k) ? x.t : samples[i - 1].t) - x0.t + 0.1;
      if (s > best.s) best = { s, pieces: k.split('|'), at: x0.mode };
      if (!now.has(k)) runs.delete(k);
    }
  });
  return best;
}

const QUIET = '&hour=6.5&seed=1&gate=0&attract=0&welcome=0&first=0&metrics=0';
async function open(browser, query, ready = (L) => L?.switchMode && L?.core?.audio && window.__veliaLoading?.state === 'gone') {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.addInitScript(instrument);
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`${BASE}/?${query}`, { waitUntil: 'load' });
  await page.waitForFunction(`(${ready})(window.__lakeshore)`, null, { timeout: 480000 });
  page.errors = errors;
  return page;
}
const wait = (page, s) => page.waitForTimeout(s * 1000);
const gesture = (page) => page.mouse.click(640, 120);   // the sky: no helm, no button
const music = (page) => page.evaluate(() => window.__mus.samples.at(-1)?.on ?? []);
async function until(page, fn, s = 30) { const t = Date.now(); while (Date.now() - t < s * 1000) { if (await fn()) return true; await wait(page, 0.25); } return false; }
const playing = (page) => until(page, async () => (await music(page)).length > 0, 40);
async function switchTo(page, id) {
  await page.evaluate((m) => { window.__lakeshore.switchMode(m); }, id);
  await page.waitForFunction((m) => window.__lakeshore.modeSwitchLog?.some((s) => s.to === m && !s.seen && (s.seen = true)), id, { timeout: 120000 });
}
const nextTap = (page) => page.evaluate(() => { const b = [...document.querySelectorAll('.lk-view .lk-sndpick .nx')].find((x) => !x.closest('.lk-view.off')); if (b) { b.click(); return 'button'; } return 'none'; });   // the Music menu's Next song (owner, 2026-11-11: ⏭ left the bar)

const SEQUENCES = {
  // Sail's bed plays; Cruise is picked from the menu; then back to Sail and a gesture (Sail's arrival piece)
  async 'sail-cruise-sail'(browser) {
    const p = await open(browser, `mode=sail${QUIET}`);
    await gesture(p); await playing(p); await wait(p, 6);
    await switchTo(p, 'cruise'); await wait(p, 14);
    await switchTo(p, 'sail'); await gesture(p); await wait(p, 14);
    return p;
  },
  async 'sail-regatta'(browser) {
    const p = await open(browser, `mode=sail${QUIET}`);
    await gesture(p); await playing(p); await wait(p, 6);
    await switchTo(p, 'regatta'); await wait(p, 20);
    return p;
  },
  async 'cruise-regatta'(browser) {
    const p = await open(browser, `mode=cruise${QUIET}`);
    await gesture(p); await playing(p); await wait(p, 6);
    await switchTo(p, 'regatta'); await wait(p, 20);
    return p;
  },
  // two picks within one switch (the shell runs the newest when the first ends)
  async 'double-switch'(browser) {
    const p = await open(browser, `mode=sail${QUIET}`);
    await gesture(p); await playing(p); await wait(p, 4);
    await p.evaluate(() => { window.__lakeshore.switchMode('cruise'); setTimeout(() => window.__lakeshore.switchMode('sail'), 300); });
    await p.waitForFunction(() => window.__lakeshore.modeSwitchLog?.filter((s) => s.to === 'sail').length >= 1, null, { timeout: 120000 });
    await gesture(p); await wait(p, 6);
    await p.evaluate(() => { window.__lakeshore.switchMode('cruise'); });
    await wait(p, 1.2);
    await p.evaluate(() => { window.__lakeshore.switchMode('sail'); });
    await p.waitForFunction(() => window.__lakeshore.modeSwitchLog?.filter((s) => s.to === 'sail').length >= 2, null, { timeout: 120000 });
    await gesture(p); await wait(p, 14);
    return p;
  },
  // a switch during Sail's ⏭ crossfade, and ⏭ during a switch
  async 'next-during-switch'(browser) {
    const p = await open(browser, `mode=sail${QUIET}`);
    await gesture(p); await playing(p); await wait(p, 4);
    await nextTap(p); await wait(p, 0.5);
    await p.evaluate(() => { window.__lakeshore.switchMode('cruise'); });
    await wait(p, 0.3); await nextTap(p);
    await p.waitForFunction(() => window.__lakeshore.modeSwitchLog?.some((s) => s.to === 'cruise'), null, { timeout: 120000 });
    await wait(p, 4); await nextTap(p); await wait(p, 0.4); await nextTap(p); await wait(p, 14);
    return p;
  },
  // ⏭ in Regatta, over the race score
  async 'regatta-next'(browser) {
    const p = await open(browser, `mode=regatta&hour=15&seed=1&gate=0&attract=0&welcome=0&first=0&metrics=0`, (L) => L?.regatta && L?.core?.audio && window.__veliaLoading?.state === 'gone');
    await gesture(p); await playing(p); await wait(p, 4);
    await nextTap(p); await wait(p, 14);
    return p;
  },
  // Cruise: take the helm (a steering key), ⏭ in Sail, hand the boat back (`), and a quick take-and-give
  async 'helm-handover'(browser) {
    const p = await open(browser, `mode=cruise${QUIET}`);
    await gesture(p); await playing(p); await wait(p, 6);
    await p.keyboard.down('ArrowLeft'); await wait(p, 0.3); await p.keyboard.up('ArrowLeft');
    await p.waitForFunction(() => window.__lakeshore.mode === 'sail', null, { timeout: 30000 });
    await wait(p, 4); await nextTap(p); await wait(p, 8);
    await p.keyboard.press('Backquote');
    await p.waitForFunction(() => window.__lakeshore.mode === 'cruise', null, { timeout: 30000 });
    await wait(p, 10);
    await p.keyboard.down('ArrowLeft'); await wait(p, 0.3); await p.keyboard.up('ArrowLeft');
    await p.waitForFunction(() => window.__lakeshore.mode === 'sail', null, { timeout: 30000 });
    await wait(p, 2); await p.keyboard.press('Backquote');
    await p.waitForFunction(() => window.__lakeshore.mode === 'cruise', null, { timeout: 30000 });
    await wait(p, 14);
    return p;
  },
  // the staged first visit: no home card, the music on the entry; then Cruise
  async 'first-visit'(browser) {
    const p = await open(browser, `mode=sail&hour=6.5&seed=1&gate=0&first=1&metrics=0`, (L) => L?.core?.audio && L?.switchMode);
    await wait(p, 3); await gesture(p); await wait(p, 1); await p.keyboard.press('Enter'); await playing(p); await wait(p, 8);
    await switchTo(p, 'cruise'); await wait(p, 14);
    return p;
  },
};

const browser = await chromium.launch({ executablePath: process.env.LAKESHORE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--enable-unsafe-webgpu', '--no-first-run', '--autoplay-policy=no-user-gesture-required'] });
try {
  for (const [name, run] of Object.entries(SEQUENCES)) {
    if (ONLY && !ONLY.includes(name)) continue;
    let p = null;
    try {
      p = await run(browser);
      const samples = await p.evaluate(() => window.__mus.samples);
      const heard = [...new Set(samples.flatMap((s) => s.on))];
      const o = overlaps(samples);
      if (process.env.MUS_TRACE) console.log(JSON.stringify(samples.filter((s, i) => i === 0 || s.on.join() !== samples[i - 1].on.join()).map((s) => [+(s.t - samples[0].t).toFixed(1), s.mode, ...s.on])));
      check(heard.length > 0, `${name}: music was heard (${heard.join(', ')})`);
      check(o.s <= LIMIT_S, `${name}: two pieces at once for ${o.s.toFixed(1)} s at most (limit ${LIMIT_S} s)${o.s ? `: ${o.pieces.join(' + ')} in ${o.at}` : ''}`);
      // known, not music (2026-11-06): Cruise's take-the-helm re-sends the key on window (src/modes/chill/index.js
      // takeHelm), and the loading card's language chip calls lang.contains(window) on it (src/ui/loading.js keydown)
      const known = (e) => /Failed to execute 'contains' on 'Node'/.test(e);
      if (p.errors.some(known)) console.log(`KNOWN ${name}: ${p.errors.filter(known).length} × the language chip's contains(window) TypeError on the re-sent key`);
      const errs = p.errors.filter((e) => !known(e));
      check(errs.length === 0, `${name}: no page errors (${errs.join(' | ').slice(0, 200)})`);
    } catch (e) { check(false, `${name}: ran (${String(e.message ?? e).split('\n')[0]})`); }
    finally { await p?.close(); }
  }
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
