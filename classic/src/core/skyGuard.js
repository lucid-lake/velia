// The sky's load guard (fix/sky-load): the atmosphere's scattering LUTs must never stop the game from loading.
// Pure helpers (no three.js), so tests/skyGuard.test.mjs runs them in node; src/core/index.js wires them and
// src/core/skyFallback.js draws the plain sky when they say so.
//
//   guardLut(lut, onError)   the LUT build's own errors land in onError. @takram/three-atmosphere 0.19.1 starts the
//                            build from updateBefore() and rethrows its error inside a detached promise: an unhandled
//                            rejection nothing could catch, and the wait below would end with a black sky.
//   waitForLut(lut, opts)    waits until the build ends, for at most budgetMs of *visible* time (a hidden tab throttles
//                            timers to 1 s and idle callbacks, so its time does not count). The old wait was 600 × 20 ms
//                            by count, ten minutes in a hidden tab. Returns { ok: true } or { ok: false, reason }.
//   skyStepOf(step)          the load_fail detail inside the sky stage ('sky:probe', 'sky:compile', ...).

export const SKY_BUDGET_MS = 12000;   // the old wait's 600 × 20 ms
const SKY_STEPS = ['warm', 'probe', 'compile', 'lut', 'frame', 'mode', 'modewarm', 'latewarm'];   // the sky stage, in order (src/core/index.js; warm, modewarm, latewarm: the shader warm-up, src/core/warmup.js)

export const lutBusy = (lut) => !!lut && (lut.updating === true || lut.currentVersion === undefined);

export function guardLut(lut, onError) {
  if (!lut || typeof lut.updateTextures !== 'function' || lut.__skyGuard) return lut;
  const build = lut.updateTextures.bind(lut);
  lut.updateTextures = (renderer) => {
    let p;
    try { p = build(renderer); } catch (e) { onError(e); return Promise.resolve(); }
    return Promise.resolve(p).catch((e) => { onError(e); });
  };
  lut.__skyGuard = true;
  return lut;
}

export async function waitForLut(lut, {
  budgetMs = SKY_BUDGET_MS,
  failed = () => null,                    // the guard's error, once it has one
  hidden = () => false,                   // document.visibilityState === 'hidden'
  now = () => performance.now(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  step = 20,
} = {}) {
  let visible = 0, last = now();
  while (true) {
    const err = failed();
    if (err) return { ok: false, reason: `error: ${err?.message ?? err}` };
    if (!lutBusy(lut)) {   // a build that threw ends 'updating' a few microtasks before its error reaches the guard
      await sleep(0);
      const late = failed();
      return late ? { ok: false, reason: `error: ${late?.message ?? late}` } : { ok: true };
    }
    if (visible >= budgetMs) return { ok: false, reason: 'timeout' };
    await sleep(step);
    const t = now();
    if (!hidden()) visible += Math.min(t - last, 1000);   // one throttled tick counts at most 1 s
    last = t;
  }
}

export const skyStepOf = (step) => (SKY_STEPS.includes(step) ? `sky:${step}` : 'sky');
