// fix/v2-ios-audio: the owner's iPhone heard nothing on v2. Safari on iOS runs an AudioContext only from a touchend, pointerup,
// click or key (not the touchstart or pointerdown that made it), and plays a media element outside a gesture only once it has
// played inside one. These emulate that policy (a fake context, a fake <audio>, a window that marks its activating events) and
// check that one tap gets the page's context running and the music's streamed element playing.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// --- an iOS-like page: globals the modules read (addEventListener, AudioContext, GainNode, Audio)
let active = false;   // inside an activating event's dispatch (WebKit: touchend, pointerup, click, keydown)
const ACTIVATING = new Set(['touchend', 'pointerup', 'click', 'keydown']);
const win = new EventTarget();
function tap(kinds = ['touchstart', 'pointerdown', 'touchend', 'pointerup', 'click']) {
  for (const k of kinds) { active = ACTIVATING.has(k); win.dispatchEvent(new Event(k)); active = false; }
}
class FakeCtx {
  constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = { connect() {} }; this.l = []; FakeCtx.made.push(this); }
  addEventListener(k, f) { if (k === 'statechange') this.l.push(f); }
  resume() {
    if (!active) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' }));
    this.state = 'running'; for (const f of this.l) f(); return Promise.resolve();
  }
  createMediaElementSource(el) { if (el.bound) throw new Error('InvalidStateError: already bound'); el.bound = true; return { connect() {}, disconnect() {} }; }
}
FakeCtx.made = [];
class FakeGain { constructor(ctx, o) { this.gain = { value: o?.gain ?? 1 }; } connect() {} }
class FakeAudio {
  constructor() { this.attrs = {}; this.unlocked = false; this.playing = false; this.rejected = 0; FakeAudio.made.push(this); }
  setAttribute(k, v) { this.attrs[k] = v; } removeAttribute(k) { if (k === 'src') this.src = ''; }
  play() {
    if (!active && !this.unlocked) { this.rejected++; return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })); }
    if (active) this.unlocked = true;   // WebKit drops the element's gesture rule after one play() in a gesture
    this.playing = true; return Promise.resolve();
  }
  pause() { this.playing = false; } load() {}
}
FakeAudio.made = [];
const saved = {};
function install() {
  for (const k of ['addEventListener', 'removeEventListener', 'AudioContext', 'GainNode', 'Audio', 'btoa']) saved[k] = globalThis[k];
  globalThis.addEventListener = win.addEventListener.bind(win);
  globalThis.removeEventListener = win.removeEventListener.bind(win);
  globalThis.AudioContext = FakeCtx; globalThis.GainNode = FakeGain; globalThis.Audio = FakeAudio;
  globalThis.btoa ??= (s) => Buffer.from(s, 'binary').toString('base64');
}
function restore() { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete globalThis[k]; else globalThis[k] = v; } }
const flush = () => new Promise((r) => setTimeout(r, 0));

test('iOS: one tap gets the page context running, and a streamed piece plays after the tap', async () => {
  install();
  try {
    const { createAudio } = await import('../engine/audio.js');
    const { sourceFor } = await import('../../src/audioFormat.js');
    const audio = createAudio({ live: true });
    tap();
    await flush();
    assert.equal(FakeCtx.made.length, 1, 'one context');
    const ctx = audio.ctx;
    assert.equal(ctx.state, 'running', 'the context runs after one tap (touchend / click resumes it)');
    assert.equal(audio.running, true);
    const { ctx: readyCtx } = await audio.ready;
    assert.equal(readyCtx, ctx);

    // the music: its metadata loads later (outside the tap), then the element plays from a timer
    const timers = [];
    const src = sourceFor(ctx, { streamed: true, url: '/audio/music/a.m4a', duration: 180 }, { setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer() {} });
    src.connect({}); src.start(0, 0);
    timers.shift()();   // outside any gesture
    await flush();
    assert.equal(src.el.playing, true, `the piece's element plays outside the tap (rejected ${src.el.rejected}×)`);

    // the control: a fresh element (no pool, main's path) is refused outside the tap, so the piece never sounds
    const bare = sourceFor(ctx, { streamed: true, url: '/audio/music/c.m4a', duration: 180 }, { pool: null, setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer() {} });
    bare.start(0, 0); timers.shift()(); await flush();
    assert.equal(bare.el.playing, false, 'a fresh element is refused outside a gesture (the control)');

    // a second piece after the first ended reuses an unlocked element (each element keeps its one MediaElementSource)
    src.stop(0); timers.shift()();
    const src2 = sourceFor(ctx, { streamed: true, url: '/audio/music/b.m4a', duration: 180 }, { setTimer: (f) => { timers.push(f); return timers.length; }, clearTimer() {} });
    src2.start(0, 0); timers.shift()(); await flush();
    assert.equal(src2.el.playing, true, 'the next piece plays too');

    // a call or Siri: iOS interrupts the context; the next tap brings it back
    ctx.state = 'interrupted';
    tap(['touchstart', 'touchend']); await flush();
    assert.equal(ctx.state, 'running', 'an interrupted context resumes on the next tap');
  } finally { restore(); }
});

test('iOS: a touchstart alone (no touchend yet) makes the context; the touchend that follows runs it', async () => {
  install(); FakeCtx.made.length = 0;
  try {
    const { createAudio } = await import('../engine/audio.js?b');
    const audio = createAudio({ live: true });
    tap(['touchstart', 'pointerdown']); await flush();
    assert.equal(audio.ctx?.state, 'suspended');
    tap(['touchend']); await flush();
    assert.equal(audio.ctx.state, 'running');
  } finally { restore(); }
});

test('a headless page makes no context and no element pool', async () => {
  install(); FakeCtx.made.length = 0;
  try {
    const { createAudio } = await import('../engine/audio.js?c');
    const audio = createAudio({ live: false });
    tap(); await flush();
    assert.equal(FakeCtx.made.length, 0);
    assert.equal(audio.ctx, null);
  } finally { restore(); }
});

test('the element pool: an element whose unlock is still pending from a tap is lent (a busy phone: the piece before the promise)', async () => {
  install();
  try {
    const { createElementPool } = await import('../audio/elementPool.js');
    const pool = createElementPool({ size: 1 });
    const ctx = new FakeCtx();
    active = true; pool.bless(); active = false;   // the tap: the silence's play() called, its promise not settled yet
    const a = pool.take(ctx);
    assert.ok(a, 'lent before the unlock settles');
    await flush();
    assert.equal(pool.stats().busy, 1, 'still the piece\'s');
  } finally { restore(); }
});

test('the element pool: only unlocked, idle elements are lent; a failed unlock is not lent', async () => {
  install();
  try {
    const { createElementPool } = await import('../audio/elementPool.js');
    const pool = createElementPool({ size: 2 });
    const ctx = new FakeCtx();
    assert.equal(pool.take(ctx), null, 'nothing before a tap');
    pool.bless(); await flush();   // outside a gesture: refused
    assert.equal(pool.stats().blessed, 0);
    active = true; pool.bless(); active = false; await flush();
    assert.equal(pool.stats().blessed, 2);
    const a = pool.take(ctx), b = pool.take(ctx);
    assert.ok(a && b && a !== b); assert.equal(pool.take(ctx), null, 'both lent');
    pool.give(a); assert.equal(pool.take(ctx), a, 'given back, lent again with its own node');
  } finally { restore(); }
});
