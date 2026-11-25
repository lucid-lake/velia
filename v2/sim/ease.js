// Frame-rate-independent easing: every camera rate is a rate per second, compounded for the
// frame's real dt, so a 30 fps phone and a 120 Hz Mac frame the boat the same and settle in the same time. Pure.
//   ease(x, target, rate, dt)        one exponential step toward target: x + (target − x) · (1 − e^(−rate·dt))
//   easeK(rate, dt)                  the step's share alone (0 at dt 0, → 1 for a long frame; never over 1)
//   easeAngle(a, target, rate, dt)   the same on an angle, the shorter way round (rad)
//   const hf = createHeaveFilter({ tau: 2.5, keep: 0 });  hf.step(heave, dt) → the heave the camera follows
//   const lp = createLowPass({ tau: 3 });  lp.step(x, dt) → x's slow part (the cameras' speed: the waves' surge taken out)
// The heave filter: the boat's heave split into its slow part (a critically damped low-pass, time constant tau: a swell, a
// settle after a gust) and its fast part (the waves' bob: the heave less the slow part). The camera follows the slow part and
// `keep` of the fast part (0: the camera never bobs with a wave; the boat still rides them on screen). The fast part is capped
// at ± capM so a large sea moves the camera at most that far from the slow line. The low-pass is solved exactly per step
// (no dt in a linear factor), so 30, 60 and 120 Hz give the same curve.
export const easeK = (rate, dt) => (dt > 0 && rate > 0 ? 1 - Math.exp(-rate * dt) : 0);
export const ease = (x, target, rate, dt) => x + (target - x) * easeK(rate, dt);

// The low-pass: critically damped (x'' = −w² (x − h) − 2 w x', w = 2 / tau), solved exactly over each step for a held input. A
// sine of period P passes at 1 / (1 + (π · tau / P)²): tau 3 s lets a 2.7 s wave's tenth through, a 20 s swell's three quarters.
// The first sample (or one after reset()) is taken as it is.
export function createLowPass({ tau }) {
  let x = null, v = 0;
  return {
    step(h, dt) {
      if (!Number.isFinite(h)) return x ?? 0;
      if (x == null || !(dt >= 0)) { x = h; v = 0; return h; }
      if (dt > 0) { const w = 2 / tau, e = Math.exp(-w * dt), d = x - h, t = (v + w * d) * dt; x = h + (d + t) * e; v = (v - w * t) * e; }
      return x;
    },
    reset(h = null) { x = Number.isFinite(h) ? h : null; v = 0; },
    get value() { return x; },
  };
}

const HEAVE = Object.freeze({ tau: 2.5, keep: 0, capM: 0.18 });   // tau 2.5 s: a 2.5 s lake wave reaches the camera at about 9 % of its height
export function createHeaveFilter({ tau = HEAVE.tau, keep = HEAVE.keep, capM = HEAVE.capM } = {}) {
  const lp = createLowPass({ tau });
  let last = 0, hp = 0;
  return {
    step(h, dt) {
      if (!Number.isFinite(h)) return lp.value ?? 0;
      const x = lp.step(h, dt);
      last = h; hp = Math.max(-capM, Math.min(capM, h - x));
      return x + keep * hp;
    },
    reset(h = null) { lp.reset(h); hp = 0; },
    get slow() { return lp.value; }, get fast() { return hp; }, get raw() { return last; },
  };
}
