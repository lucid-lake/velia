// Frame-rate-independent easing: every camera rate is a rate per second, compounded for the
// frame's real dt, so a 30 fps phone and a 120 Hz Mac frame the boat the same and settle in the same time. Pure.
//   ease(x, target, rate, dt)        one exponential step toward target: x + (target − x) · (1 − e^(−rate·dt))
//   easeK(rate, dt)                  the step's share alone (0 at dt 0, → 1 for a long frame; never over 1)
//   easeAngle(a, target, rate, dt)   the same on an angle, the shorter way round (rad)
//   const hf = createHeaveFilter({ tau: 2.5, keep: 0 });  hf.step(heave, dt) → the heave the camera follows
// The heave filter: the boat's heave split into its slow part (a critically damped low-pass, time constant tau: a swell, a
// settle after a gust) and its fast part (the waves' bob: the heave less the slow part). The camera follows the slow part and
// `keep` of the fast part (0: the camera never bobs with a wave; the boat still rides them on screen). The fast part is capped
// at ± capM so a large sea moves the camera at most that far from the slow line. The low-pass is solved exactly per step
// (no dt in a linear factor), so 30, 60 and 120 Hz give the same curve.
export const easeK = (rate, dt) => (dt > 0 && rate > 0 ? 1 - Math.exp(-rate * dt) : 0);
export const ease = (x, target, rate, dt) => x + (target - x) * easeK(rate, dt);

const HEAVE = Object.freeze({ tau: 2.5, keep: 0, capM: 0.18 });   // tau 2.5 s: a 2.5 s lake wave reaches the camera at about 9 % of its height
export function createHeaveFilter({ tau = HEAVE.tau, keep = HEAVE.keep, capM = HEAVE.capM } = {}) {
  let x = null, v = 0, last = 0, hp = 0;
  return {
    step(h, dt) {
      if (!Number.isFinite(h)) return x ?? 0;
      if (x == null || !(dt >= 0)) { x = h; v = 0; hp = 0; last = h; return h; }
      if (dt > 0) {   // critically damped: x'' = −w² (x − h) − 2 w x', solved over dt for a held input
        const w = 2 / tau, e = Math.exp(-w * dt), d = x - h, t = (v + w * d) * dt;
        x = h + (d + t) * e; v = (v - w * t) * e;
      }
      last = h; hp = Math.max(-capM, Math.min(capM, h - x));
      return x + keep * hp;
    },
    reset(h = null) { x = h; v = 0; hp = 0; },
    get slow() { return x; }, get fast() { return hp; }, get raw() { return last; },
  };
}
