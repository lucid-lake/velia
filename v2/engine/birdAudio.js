// The birds' sound door (was v2/engine/audio.js on the birds' branch; renamed beside M5e's page audio): one AudioContext and a
// browser's rule; v1's startOnFirstGesture), never under ?headless. v1's three-free sound modules take it as v1's audio
// service: audio.attach(({ ctx, master }) => …) runs once the context exists (at once if it already does).
//   const audio = createAudio({ on: !P.headless });   audio.attach(cb); audio.start(); audio.ctx
import { GESTURES, UNLOCKERS } from '../../src/audio.js';

export function createAudio({ on = true, g = globalThis } = {}) {
  const waiting = [];
  let ctx = null, master = null, pre = null;
  const api = {
    get ctx() { return ctx; },
    get running() { return ctx?.state === 'running'; },
    attach(cb) { if (ctx) cb({ ctx, master }); else waiting.push(cb); },
    // refactor round 3 B6a: the context made early (after the first frame, off any gesture: suspended); the first gesture hands it over
    // (ctx, the attached callbacks) and resumes it, as before. The ENTER frame lost the 101 ms of new AudioContext (headless Chrome)
    prepare() {
      const AC = g.AudioContext ?? g.webkitAudioContext;
      if (!on || ctx || pre || !AC) return;
      try { pre = new AC(); } catch { pre = null; }
    },
    start() {
      if (!on) return;
      const AC = g.AudioContext ?? g.webkitAudioContext;
      if (!ctx && (pre || AC)) {
        ctx = pre ?? new AC(); pre = null; master = ctx.createGain(); master.gain.value = 1; master.connect(ctx.destination);
        for (const cb of waiting.splice(0)) cb({ ctx, master });
      }
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {});   // 'suspended', or iOS's 'interrupted'
    },
  };
  if (on && g.addEventListener) {
    // the first gesture makes the context; iOS lets it run only from a touchend, pointerup, click or key (v1's UNLOCKERS,
    // src/audio.js), so those re-try resume() until it runs (fix/v2-ios-audio: a touchstart-made context stayed suspended)
    for (const e of [...GESTURES, ...UNLOCKERS]) g.addEventListener(e, api.start, { passive: true, capture: true });
  }
  return api;
}

// a camera-shaped object for v1's sound modules (they read camera.matrixWorld.elements: the position in 12–14, the view
// direction as −(8–10), up in 4–6), filled from v2's eye, forward and up
export function listenerCamera() {
  const e = new Float32Array(16);
  return { matrixWorld: { elements: e }, set(eye, fwd, up) { e[12] = eye[0]; e[13] = eye[1]; e[14] = eye[2]; e[8] = -fwd[0]; e[9] = -fwd[1]; e[10] = -fwd[2]; e[4] = up[0]; e[5] = up[1]; e[6] = up[2]; return this; } };
}
