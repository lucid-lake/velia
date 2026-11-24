// The page's sound (M5e: the thunder; v1's sloop sound stays v1's). Web Audio starts only in a user gesture, so the
// context is made on the first pointer or key and resumed; `ready` resolves then with { ctx, master }. A headless page
// never makes one (captures are silent and deterministic). No file is played here: the thunder is synthesised
// (src/weather/stormAudio.js).
//   const audio = createAudio({ live: !P.headless });   audio.ready.then(({ ctx, master }) => …)   audio.gain = 0.6
//
// iPhone (fix/v2-ios-audio, v1's rule in src/audio.js): Safari on iOS lets a context run only from a touchend, a pointerup, a
// click or a key, never from the touchstart or pointerdown that makes it, so the context made on the first touch stays
// suspended until one of those (UNLOCKERS) resumes it; every one re-tries until it runs, and an 'interrupted' context (a call,
// Siri) resumes. The same taps unlock the music's media elements (v2/audio/elementPool.js: iOS lets an element play outside a
// gesture only once it has played inside one) and ask iOS for the 'playback' session, so the silent switch does not mute the
// game (playbackSession).
import { GESTURES, UNLOCKERS, playbackSession } from '../../src/audio.js';
import { setElementPool } from '../../src/audioFormat.js';
import { createElementPool } from '../audio/elementPool.js';

// target: where the gestures are heard (the window); Ctx: the AudioContext class; pool: the music's media elements (null: none)
export function createAudio({ live = true, gain = 0.8, target = globalThis, Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext, pool = undefined } = {}) {
  let ctx = null, master = null, resolve = null;
  const ready = new Promise((r) => { resolve = r; });
  const state = { started: false, state: 'none' };
  const elements = live ? (pool === undefined ? (typeof globalThis.Audio === 'function' ? createElementPool() : null) : pool) : null;
  if (elements) setElementPool(elements);
  const canResume = () => ctx && ctx.state !== 'running' && ctx.state !== 'closed';
  function unlock() {
    if (!live) return;
    playbackSession();
    elements?.bless?.();
    if (!ctx) { start(); return; }
    if (canResume()) ctx.resume().catch(() => {});
  }
  // refactor round 3 B6a: the context made early (prepare(), after the first frame, off any gesture: suspended) and handed over in the
  // first gesture, which only resumes it; `ctx`, `ready` and the gesture's path stay as before. new AudioContext took 101 ms of the
  // 167 ms ENTER frame in headless Chrome. No prepare(): made in the gesture as before
  let pre = null;
  function prepare() {
    if (!live || ctx || pre || typeof Ctx !== 'function') return;
    try {
      if (globalThis.navigator?.audioSession) playbackSession();   // iOS: the playback session before the context exists (the silent-element fallback needs the gesture: start())
      pre = new Ctx();
    } catch { pre = null; }
  }
  function start() {
    if (!live || typeof Ctx !== 'function') return;
    if (ctx) { if (canResume()) ctx.resume().catch(() => {}); return; }
    try {
      playbackSession();   // iOS: before the context exists
      ctx = pre ?? new Ctx(); pre = null;
      master = new GainNode(ctx, { gain });
      master.connect(ctx.destination);
      state.started = true; state.state = ctx.state;
      ctx.addEventListener?.('statechange', () => { state.state = ctx.state; if (ctx.state === 'interrupted') ctx.resume().catch(() => {}); });
      const done = () => { state.state = ctx.state; resolve({ ctx, master }); };
      if (ctx.state === 'running') done(); else ctx.resume().then(done, done);
    } catch { ctx = null; master = null; }
  }
  if (live && typeof target?.addEventListener === 'function') {
    // the capture phase (v1's startOnFirstGesture): the home card's ENTER, which stops its event, starts the sound too
    const opts = { passive: true, capture: true };
    for (const k of GESTURES) target.addEventListener(k, start, opts);
    for (const k of UNLOCKERS) target.addEventListener(k, unlock, opts);
  }
  return {
    ready, state,
    get ctx() { return ctx; }, get master() { return master; },
    get running() { return !!ctx && ctx.state === 'running'; },
    get pool() { return elements; },
    set gain(g) { if (master) master.gain.value = g; },
    start, unlock, prepare,
  };
}
