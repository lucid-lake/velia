// The masthead wind vane's response (pure JS). The vane reads the apparent wind AT THE MASTHEAD: the true wind there
// (a little stronger than at 10 m: the 1/7 power law, masthead ≈ 12 m above the water) less the boat's own velocity.
// It follows with a damped spring (ζ ≈ 0.7, natural frequency rising with the wind speed, as a real vane's does: a
// light-air vane is lazy, a strong-air one is brisk), so a gust or a puff shows as a small, quick swing, never a snap.
//   const v = new VaneDamper();  v.step(dt, mastheadWind(state))  → the vane's yaw about the stick (rad, + to starboard)
export const VANE = { mastM: 12, refM: 10, power: 0.14, zeta: 0.7, wMin: 3, wMax: 11, wPerMs: 0.9 };
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// state: the physics STATE (trueWind and apparentWind: { speed, angle }, angle from the bow, + to starboard).
// Returns { speed (m/s), angle (rad from the bow, + to starboard, the direction the wind comes FROM) }.
export function mastheadWind(state) {
  const tw = state.trueWind ?? { speed: 0, angle: 0 }, aw = state.apparentWind ?? { speed: 0, angle: 0 };
  // boat frame, x to starboard, y ahead: a wind from angle a (from the bow, + starboard) blows toward (−sin a, −cos a)
  const vec = (w) => [-Math.sin(w.angle) * w.speed, -Math.cos(w.angle) * w.speed];
  const T = vec(tw), A = vec(aw), g = Math.pow(VANE.mastM / VANE.refM, VANE.power);
  const B = [T[0] - A[0], T[1] - A[1]];            // the boat's velocity through the air-fixed frame
  const m = [T[0] * g - B[0], T[1] * g - B[1]];     // apparent at the masthead
  const speed = Math.hypot(m[0], m[1]);
  return { speed, angle: speed > 1e-6 ? Math.atan2(-m[0], -m[1]) : aw.angle };
}

export class VaneDamper {
  constructor() { this.yaw = null; this.rate = 0; }
  // target: mastheadWind(...). The vane's head points into the wind: the yaw is −angle (spars-mesh turns +y the other way).
  step(dt, wind) {
    const target = -wind.angle;
    if (this.yaw == null) { this.yaw = target; this.rate = 0; return this.yaw; }
    const w = Math.min(VANE.wMax, VANE.wMin + VANE.wPerMs * (wind.speed ?? 0));
    let left = Math.min(dt, 0.25);
    while (left > 1e-9) {   // sub-steps keep the spring stable at any frame time
      const h = Math.min(left, 1 / 120);
      const err = wrap(target - this.yaw);
      this.rate += (w * w * err - 2 * VANE.zeta * w * this.rate) * h;
      this.yaw += this.rate * h;
      left -= h;
    }
    this.yaw = wrap(this.yaw);
    return this.yaw;
  }
}
