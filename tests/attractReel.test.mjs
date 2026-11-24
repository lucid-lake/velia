// The attract loading's film (src/ui/attractReel.js): what plays for whom, when it starts,
// the captions, Skip and its memory, the mark's hand-over. Behaviour only: the pure rules, then the DOM half on the stub DOM.
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideReel, captionAt, SHOTS, REEL, STILLS, readSkip, rememberSkip, STORE_KEY, installReel, stillSrc } from '../src/ui/attractReel.js';
import { installDom, shellBody } from './helpers/dom-card.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = (reel) => ({ reel });

test('who gets the film: a desktop at once, a phone at the sky stage; stills for Save-Data, reduced motion, a slow link, no H.264, a remembered skip, ?reel=0', () => {
  assert.deepEqual(decideReel({ flags: flags(null) }), { mode: 'video', startAt: 'now', why: 'ok' });
  assert.equal(decideReel({ flags: flags(null), coarse: true }).startAt, 'sky');
  for (const [k, v, why] of [['saveData', true, 'save-data'], ['reduced', true, 'reduced-motion'], ['effectiveType', '3g', 'slow-link'], ['effectiveType', 'slow-2g', 'slow-link'], ['canPlay', false, 'codec'], ['stored', 'skip', 'skipped']]) {
    const d = decideReel({ flags: flags(null), [k]: v });
    assert.equal(d.mode, 'stills', k); assert.equal(d.why, why); assert.equal(d.startAt, null);
  }
  assert.equal(decideReel({ flags: flags(null), effectiveType: '4g' }).mode, 'video');
  assert.equal(decideReel({ flags: flags('0') }).mode, 'stills');
  assert.deepEqual(decideReel({ flags: flags(null), webdriver: true }), { mode: 'stills', startAt: null, why: 'automated' }, 'an automated browser (the goldens) gets the still');
  assert.equal(decideReel({ flags: flags('1'), webdriver: true }).mode, 'video');
  // ?reel=1 forces the film past reduced motion and a remembered skip (a probe), never past a missing codec? no: the flag wins everywhere but the page then falls back on error
  assert.deepEqual(decideReel({ flags: flags('1'), reduced: true, stored: 'skip' }), { mode: 'video', startAt: 'now', why: 'flag' });
});

test('the shots: in order, overlapping only by the dissolve, the opening pose last; every caption has a place and a fact', () => {
  assert.ok(SHOTS.length >= 6);
  for (let i = 0; i < SHOTS.length; i++) {
    const s = SHOTS[i];
    assert.ok(s.out > s.in + 2, `${s.id}: at least 2 s`);
    assert.ok(s.place.length > 2 && s.facts.length > 2, `${s.id}: a caption`);
    if (i) { assert.ok(s.in > SHOTS[i - 1].in, `${s.id}: after ${SHOTS[i - 1].id}`); assert.ok(SHOTS[i - 1].out - s.in <= 1.01 && SHOTS[i - 1].out - s.in >= 0, `${s.id}: a 1 s dissolve`); }
  }
  assert.deepEqual(SHOTS.map((s) => s.id), ['fireworks', 'hover', 'kayak', 'storm', 'rainbow', 'golden', 'night', 'clear', 'open'],
    'the July 4th finale opens, then the osprey, the kayaks, the storm, the rainbow, golden hour, the night, the clear water, the live game\'s opening pose (owner, 2026-11-09)');
  for (const gone of ['dawn', 'surf']) assert.ok(!SHOTS.some((s) => s.id === gone), `${gone}: retired`);
  // the mark thins 0.7-2.4 s into a desktop's film (it holds logoS from the page's start, the film moves from playAt): the
  // fireworks shot is on screen through all of it, and its caption waits until the mark has nearly gone
  assert.ok(SHOTS[0].out - 1 > REEL.logoS + REEL.logoFadeS - REEL.playAt, 'the mark thins onto the fireworks, not a dissolve');
  assert.ok(REEL.liveS >= 0.6 && REEL.liveS <= 1.5, 'the end cross-fades into the live lake: the scene fade at least, 1.5 s at most');
  assert.ok(REEL.logoS >= 1.5 && REEL.logoFadeS >= 1.5 && REEL.logoMaxS >= REEL.logoS + 1, 'the mark holds, then thins; a cap on the wait');
});

test('captionAt: nothing during a dissolve, the shot\'s own words in between', () => {
  const s0 = SHOTS[0], s1 = SHOTS[1];
  assert.equal(captionAt(0), null, 'the first frames: the mark is still thinning');
  assert.equal(captionAt(s0.in + 1.5)?.id, s0.id);
  assert.equal(captionAt(s1.in), null, 'the dissolve\'s first frame');
  assert.equal(captionAt(s1.in + 0.5), null, 'the dissolve itself');
  assert.equal(captionAt(s1.in + 1.5)?.id, s1.id);
  assert.equal(captionAt(999), null);
});

test('the memory: a skip is kept per visitor, playing again clears it; no storage, or a storage that throws, never breaks', () => {
  const m = new Map(), store = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  assert.equal(readSkip(store), null);
  assert.equal(rememberSkip(true, store), true); assert.equal(m.get(STORE_KEY), 'skip'); assert.equal(readSkip(store), 'skip');
  assert.equal(rememberSkip(false, store), true); assert.equal(readSkip(store), null);
  const bad = { getItem() { throw new Error('private'); }, setItem() { throw new Error('private'); }, removeItem() { throw new Error('private'); } };
  assert.equal(readSkip(bad), null); assert.equal(rememberSkip(true, bad), false);
  assert.equal(readSkip(null), null); assert.equal(rememberSkip(true, undefined), true);
});

test('the shipped files exist and are under the host\'s limit; the stills come in three widths', { skip: "not in the public tree: the loading reel videos" }, () => {
  const { statSync } = require_fs();
  for (const f of [REEL.desktop, REEL.phone]) { const n = statSync(resolve(ROOT, 'public' + f)).size; assert.ok(n > 1e6 && n < 25e6, `${f}: ${n} B (Pages: 25 MB a file)`); }
  assert.ok(statSync(resolve(ROOT, 'public' + REEL.phone)).size < 7e6, 'the phone file stays small (the first 10 s about 2 MB)');
  for (const n of STILLS) for (const w of [960, 1280, 1920]) assert.ok(statSync(resolve(ROOT, stillSrc(n, w).slice(1))).size > 2e3, `${n} ${w}`);
});
function require_fs() { return { statSync: (p) => ({ size: readFileSync(p).length }) }; }

// ---- the DOM half -----------------------------------------------------------------------------------------------
function page(t, { decision, stored = null, first = false, link = null } = {}) {
  const D = installDom({ body: shellBody() });
  t.mock.timers.reset(); t.mock.timers.enable({ apis: ['setTimeout'] });
  const root = D.document.getElementById('lk-load');
  const m = new Map(stored ? [[STORE_KEY, stored]] : []);
  const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
  const facts = { reduced: false, saveData: false, effectiveType: '4g', canPlay: true, coarse: false, phone: false };
  const events = [];
  globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
  window.addEventListener('lakeshore:sound', () => events.push('sound'));
  let now = 0;
  const api = installReel({ root, decision, facts, storage, doc: D.document, win: window, now: () => now, clock: (f, ms) => setTimeout(f, ms), unclock: clearTimeout, first, link });
  return { D, root, api, storage: m, events, tick: (ms) => { now += ms; t.mock.timers.tick(ms); } };
}

test('the film on a desktop: created at once, muted, inline, low priority; the mark waits for the first moving frame, then thins', (t) => {
  const { root, api, tick } = page(t);
  const v = api.video;
  assert.ok(v && v.tagName.toLowerCase() === 'video');
  assert.equal(v.getAttribute('playsinline'), ''); assert.equal(v.getAttribute('fetchpriority'), 'low'); assert.equal(v.muted, true);
  assert.equal(v.getAttribute('src') ?? v.src, REEL.desktop);
  assert.equal(root.dataset.reel, 'video');
  tick(REEL.logoS * 1000 + 10);
  assert.equal(api.logoDone, false, 'no frame yet: the mark holds');
  v.dispatchEvent(new (makeEv())('playing'));
  assert.equal(api.logoDone, true, 'the frame moves: the mark thins');
  assert.ok(root.querySelector('.lk-company').classList.contains('off'));
});
const makeEv = () => class { constructor(type) { this.type = type; this.bubbles = false; } };

test('a slow link: the mark thins onto the still at the cap, the film stays wanted and fades in when it plays; an error falls back to the stills', (t) => {
  const { root, api, tick } = page(t);
  tick(REEL.logoMaxS * 1000 + 10);
  assert.equal(api.logoDone, true); assert.equal(api.mode, 'video'); assert.equal(root.dataset.reelLate, '');
  api.video.dispatchEvent(new (makeEv())('error'));
  assert.equal(api.mode, 'stills'); assert.equal(api.video, null);
  assert.ok(root.querySelector('.lk-bg').classList.contains('lk-kb'), 'the stills breathe');
  assert.equal(root.querySelectorAll('.lk-kb2').length, STILLS.length - 1);
});

test('stills: the caption turns with the clock for a visitor, and holds the first still for an automated browser (the goldens)', (t) => {
  const cap = (root) => root.querySelector('.lk-fcap')?.textContent ?? '';
  const run = (why) => { const p = page(t, { decision: { mode: 'stills', startAt: null, why } }); p.tick(6000); const before = cap(p.root); p.tick(10000); return [before, cap(p.root)]; };
  const [b1, a1] = run('slow-link');
  assert.notEqual(b1, a1, 'a visitor: the caption follows the breathing stills');
  const [b2, a2] = run('automated');
  assert.equal(b2, a2, 'an automated browser: the first still\'s caption holds, whatever the load time');
});

test('perf/slow-loading: a desktop\'s film waits for a measured link: fast at once, mid at the sky stage, slow never', (t) => {
  const fast = page(t, { link: () => 'fast' });
  assert.equal(fast.api.video, null, 'not before the measure');
  fast.tick(700); assert.ok(fast.api.video, 'a fast link: the film');
  const mid = page(t, { link: () => 'mid' });
  mid.tick(700); assert.equal(mid.api.video, null);
  mid.api.stage('gpu'); assert.equal(mid.api.video, null);
  mid.api.stage('sky'); assert.ok(mid.api.video, 'a mid link: after the downloads');
  const slow = page(t, { link: () => 'slow' });
  slow.tick(700); assert.equal(slow.api.video, null); assert.equal(slow.root.dataset.reel, 'stills'); assert.equal(slow.root.dataset.reelWhy, 'slow-link');
  let v = null; const unknown = page(t, { link: () => v });
  unknown.tick(700); assert.equal(unknown.api.video, null, 'nothing measured yet: wait');
  v = 'slow'; unknown.api.stage('sky'); assert.equal(unknown.root.dataset.reel, 'stills', 'slow by the sky stage: the stills');
});

test('a phone waits for the sky stage; the captions follow the film\'s clock', (t) => {
  const { root, api } = page(t, { decision: { mode: 'video', startAt: 'sky', why: 'ok' } });
  assert.equal(api.video, null);
  api.stage('gpu'); assert.equal(api.video, null);
  api.stage('sky'); assert.ok(api.video);
  const v = api.video, cap = root.querySelector('.lk-fcap');
  v.currentTime = SHOTS[1].in + 1.5; v.dispatchEvent(new (makeEv())('timeupdate'));
  assert.ok(cap.classList.contains('on')); assert.equal(cap.querySelector('b').textContent, SHOTS[1].place);
  v.currentTime = SHOTS[2].in + 0.5; v.dispatchEvent(new (makeEv())('timeupdate'));
  assert.ok(!cap.classList.contains('on'), 'no caption through the dissolve');
});

test('Skip: the button, Esc, a tap on the footage; the film stops on the still, the choice is remembered; the button then offers the film again', (t) => {
  const { D, root, api, storage } = page(t);
  root.dataset.state = 'company';
  D.key('Escape');
  assert.equal(api.mode, 'stills'); assert.equal(storage.get(STORE_KEY), 'skip');
  const skip = root.querySelector('.lk-skip');
  assert.equal(skip.dataset.on, ''); assert.equal(skip.querySelector('.t').textContent, 'Reel');
  D.fire(skip, 'click');
  assert.equal(api.mode, 'video'); assert.equal(storage.has(STORE_KEY), false); assert.ok(api.video);
  D.fire(root.querySelector('.lk-bg'), 'click');
  assert.equal(api.mode, 'stills', 'a tap on the footage skips');
  root.dataset.state = 'home';
  D.fire(skip, 'click'); assert.equal(api.mode, 'video');
  D.fire(root.querySelector('.lk-bg'), 'click');
  assert.equal(api.mode, 'video', 'once the card is up a tap on the picture is not a skip');
});

test('a remembered skip: no film, the stills, the button says Reel; the ♪ chip asks the world for sound once pressed', (t) => {
  const { D, root, api, events } = page(t, { decision: decideReel({ flags: flags(null), stored: 'skip' }), stored: 'skip' });
  assert.equal(api.mode, 'stills'); assert.equal(api.video, null);
  assert.equal(root.querySelector('.lk-skip').dataset.on, '');
  assert.equal(api.soundWanted, false);
  D.fire(root.querySelector('.lk-sound'), 'click');
  assert.equal(api.soundWanted, true); assert.deepEqual(events, ['sound']); assert.equal(root.dataset.sound, 'on');
});

test('gone: the decoder is released', (t) => {
  const { root, api } = page(t);
  assert.ok(api.video);
  api.gone();
  assert.equal(api.video, null); assert.equal(root.querySelector('.lk-reelv'), null);
});

// ---- the film's end (owner, 2026-11-07: "the last clip will go again and again"): it plays once, then the live lake ----
const home = (root) => { root.dataset.state = 'home'; window.dispatchEvent(new CustomEvent('lakeshore:home')); };

test('the end with the world ready: no loop; the picture hands over to the live lake, the decoder goes after the fade, the pill offers the film again', (t) => {
  const { root, api, tick } = page(t);
  const v = api.video;
  v.dispatchEvent(new (makeEv())('playing'));
  home(root);
  assert.equal(root.dataset.reelEnd, undefined, 'the film plays on under the card');
  let seeks = 0, plays = 0;
  v.play = () => { plays++; return Promise.resolve(); };
  Object.defineProperty(v, 'currentTime', { set: () => { seeks++; }, get: () => 33.5, configurable: true });
  v.dispatchEvent(new (makeEv())('ended'));
  assert.equal(seeks + plays, 0, 'no seek back, no replay');
  assert.equal(api.ended, true); assert.equal(api.live, true);
  assert.equal(root.dataset.reelEnd, 'live');
  assert.equal(root.querySelector('.lk-fcap').classList.contains('on'), false, 'no caption over the live lake');
  const skip = root.querySelector('.lk-skip');
  assert.equal(skip.dataset.on, ''); assert.equal(skip.querySelector('.t').textContent, 'Reel');
  assert.ok(api.video, 'the last frame stays through the fade');
  tick(REEL.liveS * 1000 + 250);
  assert.equal(api.video, null, 'then the decoder is released');
  assert.equal(root.dataset.state, 'home', 'nothing enters by itself');
});

// owner, 2026-11-09: still loading at the end, the film loops back to the fireworks with a dissolve, never a frozen last frame
const clockTo = (v, x) => { v.currentTime = x; v.dispatchEvent(new (makeEv())('timeupdate')); };
test('the end before the world is ready: a second copy from the fireworks dissolves in over the last second (no frozen frame); then the live lake at the end after ready', (t) => {
  const { root, api, tick } = page(t);
  root.dataset.state = 'company';
  const bg = root.querySelector('.lk-bg');
  const v1 = api.video;
  v1.dispatchEvent(new (makeEv())('playing'));
  const loops = []; api.on((k) => { if (k === 'loop') loops.push(k); });
  clockTo(v1, 20); assert.equal(bg.querySelectorAll('video').length, 1, 'mid-film: one copy');
  clockTo(v1, REEL.durS - REEL.loopS - REEL.loopPrepS + 0.1);
  const vids = bg.querySelectorAll('video');
  assert.equal(vids.length, 2, 'the next copy is made and buffered before the dissolve');
  const v2 = vids[1];
  assert.notEqual(v2, v1); assert.equal(v2.getAttribute('src') ?? v2.src, REEL.desktop, 'the same film, from its start (the fireworks)');
  assert.equal(api.video, v1, 'the first copy still plays');
  let played = 0; v2.play = () => { played++; return Promise.resolve(); };
  clockTo(v1, REEL.durS - REEL.loopS + 0.05);
  assert.equal(played, 1, 'the second copy moves'); assert.equal(api.video, v2); assert.deepEqual(loops, ['loop']);
  assert.equal(v2.style.transitionDuration, `${REEL.loopS}s`, 'the reel\'s own 1 s dissolve');
  v2.dispatchEvent(new (makeEv())('playing'));
  assert.ok(v2.classList.contains('on'), 'it fades in over the first copy');
  v1.dispatchEvent(new (makeEv())('ended'));
  assert.equal(root.dataset.reelEnd, undefined, 'no hold'); assert.equal(api.ended, false);
  tick(REEL.loopS * 1000 + 450);
  assert.equal(bg.querySelectorAll('video').length, 1, 'the first copy\'s decoder goes after the dissolve');
  // captions follow the new copy's clock: the fireworks again
  clockTo(v2, 3); assert.equal(root.querySelector('.lk-fcap b').textContent, SHOTS[0].place);
  // ready during the second pass: no further loop; its end hands over to the live lake
  home(root);
  clockTo(v2, REEL.durS - 0.5); assert.equal(bg.querySelectorAll('video').length, 1, 'no loop behind the card');
  v2.dispatchEvent(new (makeEv())('ended'));
  assert.equal(root.dataset.reelEnd, 'live'); assert.equal(api.live, true);
});

test('a stalled clock that never reached the dissolve: the end itself loops while loading; Skip mid-dissolve releases both copies', (t) => {
  const { root, api } = page(t);
  root.dataset.state = 'company';
  const bg = root.querySelector('.lk-bg');
  const v1 = api.video;
  v1.dispatchEvent(new (makeEv())('playing'));
  v1.dispatchEvent(new (makeEv())('ended'));
  assert.notEqual(api.video, v1, 'a new copy took over'); assert.equal(bg.querySelectorAll('video').length, 2);
  assert.equal(root.dataset.reelEnd, undefined);
  api.skip();
  assert.equal(api.mode, 'stills'); assert.equal(bg.querySelectorAll('video').length, 0, 'every decoder released');
});

test('Skip ends the same way: while loading the stills hold, then the live lake at ready; with the card up, the live lake at once; Reel plays the film again', (t) => {
  const a = page(t);
  a.root.dataset.state = 'company';
  a.api.video.dispatchEvent(new (makeEv())('playing'));
  a.D.key('Escape');
  assert.equal(a.api.mode, 'stills'); assert.equal(a.root.dataset.reelEnd, undefined, 'the stills while loading, as before');
  assert.equal(a.storage.get(STORE_KEY), 'skip');
  home(a.root);
  assert.equal(a.root.dataset.reelEnd, 'live', 'then the live lake at ready');

  const b = page(t);
  b.api.video.dispatchEvent(new (makeEv())('playing'));
  home(b.root);
  b.D.fire(b.root.querySelector('.lk-skip'), 'click');
  assert.equal(b.root.dataset.reelEnd, 'live', 'the card is up: the live lake at once');
  assert.equal(b.storage.get(STORE_KEY), 'skip');
  b.D.fire(b.root.querySelector('.lk-skip'), 'click');   // "Reel"
  assert.equal(b.root.dataset.reelEnd, undefined); assert.equal(b.api.live, false); assert.equal(b.api.mode, 'video');
  assert.ok(b.api.video, 'the film again'); assert.equal(b.storage.has(STORE_KEY), false);
});

test('no film from the start (a remembered skip, automation, ?reel=0): the stills stay behind the card at ready, as before', (t) => {
  for (const decision of [decideReel({ flags: flags(null), stored: 'skip' }), decideReel({ flags: flags(null), webdriver: true }), decideReel({ flags: flags('0') })]) {
    const { root } = page(t, { decision });
    home(root);
    assert.equal(root.dataset.reelEnd, undefined, decision.why);
  }
});


test('a true first visit sees the reel in order (owner, 2026-11-09): no cut after the fireworks, the same loop while loading; the dissolve is the hand-over fade', (t) => {
  const { root, api } = page(t, { first: true });
  assert.equal(api.first, true); assert.equal(root.dataset.first, '');
  const v = api.video;
  assert.equal(v.getAttribute('src') ?? v.src, REEL.desktop, 'the film from its start: the fireworks');
  root.dataset.state = 'company';
  v.dispatchEvent(new (makeEv())('playing'));
  // every shot plays where it lies in the file: the clock is never moved, each caption comes in turn
  const seen = [];
  for (let x = 0; x < REEL.durS - REEL.loopS - REEL.loopPrepS; x += 0.25) {
    clockTo(v, x);
    assert.equal(v.currentTime, x, `no seek at ${x} s`);
    const b = root.querySelector('.lk-fcap').classList.contains('on') ? root.querySelector('.lk-fcap b').textContent : null;
    if (b && seen.at(-1) !== b) seen.push(b);
  }
  assert.deepEqual(seen, SHOTS.map((s) => s.place), 'the fireworks, the osprey, ... the opening pose, in order');
  // still loading at the end: the loop, as for a returning visitor
  clockTo(v, REEL.durS - REEL.loopS - REEL.loopPrepS + 0.1);
  clockTo(v, REEL.durS - REEL.loopS + 0.05);
  assert.notEqual(api.video, v, 'loops back to the fireworks');
  // at ready the staged visit enters (state out): the film runs on under the 1.2 s fade, no loop and no seek
  const c = page(t, { first: true }); c.root.dataset.state = 'out';
  const cv = c.api.video;
  clockTo(cv, REEL.durS - REEL.loopS + 0.05);
  assert.equal(c.api.video, cv, 'no loop inside the hand-over'); assert.equal(cv.currentTime, REEL.durS - REEL.loopS + 0.05);
  const b = page(t, { first: false });
  assert.equal(b.api.video.getAttribute('src') ?? b.api.video.src, REEL.desktop, 'a returning visitor: the same film');
  assert.equal(b.root.dataset.first, undefined);
});
