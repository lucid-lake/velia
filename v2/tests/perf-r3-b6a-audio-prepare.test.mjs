// Refactor round 3 B6a: the page's and the birds' AudioContexts are made early by prepare() (after the first frame, off any gesture:
// suspended, nothing handed out), and the first gesture only resumes that same context: no new AudioContext in the ENTER click. Under an
// iOS-like policy (resume() only inside touchend, pointerup, click or key) one tap still gets each context running, and the attached
// callbacks and `ready` still come in the gesture, not at prepare().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudio } from '../engine/audio.js';
import { createAudio as createBirdAudio } from '../engine/birdAudio.js';

let active = false;
const ACTIVATING = new Set(['touchend', 'pointerup', 'click', 'keydown']);
function page() {
  const win = new EventTarget();
  const made = [];
  class Ctx {
    constructor() { this.state = 'suspended'; this.destination = { connect() {} }; this.resumedIn = []; made.push(this); this.madeIn = active ? 'gesture' : 'idle'; }
    addEventListener() {}
    createGain() { return { gain: { value: 1 }, connect() {} }; }
    resume() { if (!active) return Promise.reject(Object.assign(new Error('not allowed'), { name: 'NotAllowedError' })); this.resumedIn.push(cur); this.state = 'running'; return Promise.resolve(); }
  }
  let cur = null;
  const tap = (kinds = ['touchstart', 'pointerdown', 'touchend', 'pointerup', 'click']) => { for (const k of kinds) { cur = k; active = ACTIVATING.has(k); win.dispatchEvent(new Event(k)); active = false; } cur = null; };
  return { win, made, Ctx, tap };
}
const flush = () => new Promise((r) => setTimeout(r, 0));

test('the page context: made by prepare(), handed out and resumed only in the gesture', async () => {
  const G = globalThis.GainNode;
  globalThis.GainNode = class { constructor(ctx, o) { this.gain = { value: o?.gain ?? 1 }; } connect() {} };
  try {
    const { win, made, Ctx, tap } = page();
    const audio = createAudio({ live: true, target: win, Ctx, pool: null });
    let readyAt = null; audio.ready.then(() => { readyAt = 'resolved'; });
    audio.prepare();
    await flush();
    assert.equal(made.length, 1, 'prepare() makes the context');
    assert.equal(made[0].madeIn, 'idle');
    assert.equal(audio.ctx, null, 'not handed out before the gesture');
    assert.equal(readyAt, null, 'ready waits for the gesture');
    audio.prepare(); assert.equal(made.length, 1, 'prepare() twice makes one');
    tap();
    await flush();
    assert.equal(made.length, 1, 'the gesture makes no new context');
    assert.equal(audio.ctx, made[0]);
    assert.equal(audio.ctx.state, 'running', 'resumed inside the tap (touchend / pointerup / click)');
    assert.ok(audio.ctx.resumedIn.every((k) => ACTIVATING.has(k)) && audio.ctx.resumedIn.length > 0);
    assert.equal(readyAt, 'resolved');
    // without prepare(): made in the gesture, as before
    const p2 = page(); const a2 = createAudio({ live: true, target: p2.win, Ctx: p2.Ctx, pool: null });
    p2.tap(); await flush();
    assert.equal(p2.made.length, 1, 'made in the first gesture'); assert.equal(a2.ctx.state, 'running');
    // a headless page: prepare() makes nothing
    const p3 = page(); const a3 = createAudio({ live: false, target: p3.win, Ctx: p3.Ctx, pool: null });
    a3.prepare(); p3.tap(); await flush();
    assert.equal(p3.made.length, 0);
  } finally { globalThis.GainNode = G; }
});

test("the birds' context: made by prepare(), attached callbacks and the resume in the gesture", async () => {
  const { win, made, Ctx, tap } = page();
  const g = { AudioContext: Ctx, addEventListener: win.addEventListener.bind(win) };
  const birds = createBirdAudio({ on: true, g });
  const got = [];
  birds.attach(({ ctx }) => got.push(ctx));
  birds.prepare();
  assert.equal(made.length, 1);
  assert.equal(birds.ctx, null, 'not handed out before the gesture');
  assert.equal(got.length, 0, 'attached callbacks wait for the gesture');
  tap();
  await flush();
  assert.equal(made.length, 1, 'the gesture makes no new context');
  assert.equal(birds.ctx, made[0]);
  assert.deepEqual(got, [made[0]]);
  assert.equal(birds.running, true);
  assert.ok(made[0].resumedIn.length > 0 && made[0].resumedIn.every((k) => ACTIVATING.has(k)));
  // off (headless): nothing
  const p2 = page(); const b2 = createBirdAudio({ on: false, g: { AudioContext: p2.Ctx, addEventListener: p2.win.addEventListener.bind(p2.win) } });
  b2.prepare(); p2.tap(); assert.equal(p2.made.length, 0);
});
