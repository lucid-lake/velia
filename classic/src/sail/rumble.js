// Day Sail's gamepad rumble (owner, 2026-10-29: the thrill through the body). Four cues, all subtle,
// all from the physics, none on a timer:
//   gust   a gust arriving: a soft rumble that rises with it (the true wind at the boat climbing ≥ 12 % and ≥ 0.8 m/s
//          over its 4 s mean: a puff in a near-calm is not felt), 1.6 s up, 1.4 s down, its size with the step; never two within 6 s;
//   slam   the bow slamming into a wave: one short thump (the bow's upward acceleration past 3.5 m/s², from the pose's
//          heave and pitch, the water the eye sees), 90 ms; never two within 0.6 s;
//   flog   the sails flogging: a fast, light flutter on the light motor (the main or the jib under half full with ≥ 4
//          m/s of apparent wind), 7 Hz pulses;
//   surf   a surf: a long swelling rumble while the boat rides a wave down (state.surf 0–1 if the physics sets it,
//          feat/thrill; else the surge's acceleration ≥ 0.18 m/s² held past 1 s with the wind abaft the beam and the
//          boat past 90 % of its hull speed), 2 s up, held, 1.2 s down.
// Magnitudes stay under RUMBLE.max (0.45 strong, 0.3 weak). ?rumble=0 turns it off.
//
// The mix (RumbleMix) is plain JS, no navigator: tests/feel.test.mjs. createRumble polls the pad and plays the mix as
// the standard 'dual-rumble' effect (Gamepad API vibrationActuator.playEffect), one short effect every RUMBLE.tickS
// while anything is felt, so a new cue never waits for an old effect to end.
import { toFlags } from '../../../src/sim/core/flags.js';
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const G = 9.81;

export const RUMBLE = {
  max: { strong: 0.45, weak: 0.3 },
  tickS: 0.05,                      // a new effect at most every 50 ms (20 Hz)
  gust: { rise: 0.12, minMs: 0.8, fastTau: 0.6, slowTau: 4, upS: 1.6, downS: 1.4, gap: 6, strong: 0.28, weak: 0.08 },
  slam: { accel: 3.5, durS: 0.09, gap: 0.6, strong: 0.45, weak: 0.2 },
  flog: { fill: 0.5, aws: 4, hz: 7, weak: 0.16, strong: 0 },
  surf: { accel: 0.18, holdS: 1, twaDeg: 100, hullFrac: 0.9, upS: 2, downS: 1.2, strong: 0.32, weak: 0.1 },
  bowArm: 3.8,                      // m from the centre to the bow's slam point (the forefoot)
};

export class RumbleMix {
  constructor() {
    this.tws = { fast: null, slow: null }; this.gust = { env: 0, peak: 0, phase: 0, t: -1e9, k: 0 };
    this.slamAt = -1e9; this.bow = null; this.bowV = null; this.surgeU = null; this.surfHeld = 0; this.surfEnv = 0; this.t = 0;
    this.fired = [];               // { t, kind } the cue onsets (tests and the probe)
  }
  // dt s (real); s the physics state; pose the drawn pose (heave, pitch) or null; hullSpeed m/s; simDt the scene's step
  step(dt, s, pose = null, { hullSpeed = 3.6, simDt = null } = {}) {
    const R = RUMBLE; this.t += dt;
    if (!(dt > 0) || !s) return { strong: 0, weak: 0 };
    let strong = 0, weak = 0;
    // gust: the true wind's fast mean climbing over its slow mean
    const tws = s.trueWind?.speed ?? 0;
    if (this.tws.fast == null) this.tws.fast = this.tws.slow = tws;
    this.tws.fast += (tws - this.tws.fast) * (1 - Math.exp(-dt / R.gust.fastTau));
    this.tws.slow += (tws - this.tws.slow) * (1 - Math.exp(-dt / R.gust.slowTau));
    const rise = this.tws.slow > 1 ? this.tws.fast / this.tws.slow - 1 : 0;
    const g = this.gust;
    if (rise > R.gust.rise && this.tws.fast - this.tws.slow > R.gust.minMs && this.t - g.t > R.gust.gap) { g.t = this.t; g.k = clamp01(0.6 + (rise - R.gust.rise) * 4); g.phase = 1; this.fire('gust'); }
    if (g.phase === 1) { g.env += dt / R.gust.upS; if (g.env >= 1) { g.env = 1; g.phase = 2; } }
    else if (g.phase === 2) { g.env -= dt / R.gust.downS; if (g.env <= 0) { g.env = 0; g.phase = 0; } }
    const ge = g.env * g.env * (3 - 2 * g.env) * g.k;
    strong = Math.max(strong, R.gust.strong * ge); weak = Math.max(weak, R.gust.weak * ge);
    // slam: the bow's vertical acceleration (heave + pitch × the arm), from the drawn pose
    if (pose) {
      // on the scene's clock (the sim runs at 2×: a real-time difference would read the wave's motion 4× too hard),
      // the velocity smoothed over 40 ms so one uneven frame is not a slam
      const h = simDt ?? dt, y = (pose.heave ?? 0) + Math.sin(pose.pitch ?? 0) * R.bowArm;
      if (this.bow != null && h > 0) {
        const v = (y - this.bow) / h;
        const vs = this.bowV == null ? v : this.bowV + (v - this.bowV) * (1 - Math.exp(-h / 0.04));
        if (this.bowV != null) {
          const a = (vs - this.bowV) / h;
          if (a > R.slam.accel && this.t - this.slamAt > R.slam.gap) { this.slamAt = this.t; this.slamK = clamp01(0.55 + (a - R.slam.accel) / (2 * G)); this.fire('slam'); }
        }
        this.bowV = vs;
      }
      this.bow = y;
    }
    if (this.t - this.slamAt < R.slam.durS) { strong = Math.max(strong, R.slam.strong * this.slamK); weak = Math.max(weak, R.slam.weak * this.slamK); }
    // flog: half-full sails in a real breeze, a 7 Hz flutter on the light motor
    const aws = s.apparentWind?.speed ?? 0, fill = Math.min(s.mainFill ?? 1, (s.jibFill ?? 1) + 0.25);
    const flog = aws > R.flog.aws ? clamp01((R.flog.fill - fill) / R.flog.fill * 2) * clamp01((aws - R.flog.aws) / 4) : 0;
    if (flog > 0 && !(this.flogOn)) this.fire('flog');
    this.flogOn = flog > 0;
    const pulse = Math.sin(2 * Math.PI * R.flog.hz * this.t) > 0 ? 1 : 0;
    weak = Math.max(weak, R.flog.weak * flog * pulse);
    // surf: the physics' own flag if it has one (feat/thrill), else the surge's acceleration downwind past hull speed
    let surfOn;
    if (typeof s.surf === 'number') surfOn = s.surf > 0.3;
    else {
      const u = s.u ?? 0, du = this.surgeU == null ? 0 : (u - this.surgeU) / dt;
      this.surgeU = u;
      this.surgeA = (this.surgeA ?? 0) + (du - (this.surgeA ?? 0)) * (1 - Math.exp(-dt / 0.4));
      const downwind = Math.abs(s.trueWind?.angle ?? 0) > R.surf.twaDeg * Math.PI / 180;
      this.surfHeld = downwind && u > R.surf.hullFrac * hullSpeed && this.surgeA > R.surf.accel ? this.surfHeld + dt : 0;
      surfOn = this.surfHeld > R.surf.holdS || (this.surfEnv > 0 && downwind && u > hullSpeed);
    }
    if (surfOn && this.surfEnv === 0) this.fire('surf');
    this.surfEnv = clamp01(this.surfEnv + (surfOn ? dt / R.surf.upS : -dt / R.surf.downS));
    const se = this.surfEnv * this.surfEnv;
    strong = Math.max(strong, R.surf.strong * se); weak = Math.max(weak, R.surf.weak * se);
    return { strong: Math.min(R.max.strong, strong), weak: Math.min(R.max.weak, weak) };
  }
  fire(kind) { this.fired.push({ t: +this.t.toFixed(3), kind }); if (this.fired.length > 100) this.fired.shift(); }
}

// the pad with a rumble motor: the standard mapping first (as pads.js picks the stick)
function padWithMotor(nav) {
  const pads = [...(nav?.getGamepads?.() ?? [])].filter((p) => p && p.connected);
  return pads.find((p) => p.mapping === 'standard' && p.vibrationActuator) ?? pads.find((p) => p.vibrationActuator) ?? null;
}

// The live rumble. nav: the navigator (a mock in tests). Returns { update(dt, state, pose, opts), mix, played }.
export function createRumble({ flags, nav = globalThis.navigator } = {}) {
  const off = !toFlags(flags).rumble;
  const mix = new RumbleMix();
  const played = [];
  let since = 1e9, wasOn = false;
  function update(dt, s, pose, opts) {
    const m = mix.step(dt, s, pose, opts);
    if (off) return m;
    since += dt;
    const on = m.strong > 0.01 || m.weak > 0.01;
    if (!on && !wasOn) return m;
    if (since < RUMBLE.tickS && on) return m;
    const gp = padWithMotor(nav);
    if (!gp) return m;
    const effect = { startDelay: 0, duration: on ? Math.round(RUMBLE.tickS * 1000 * 1.6) : 1, strongMagnitude: +m.strong.toFixed(3), weakMagnitude: +m.weak.toFixed(3) };
    try {
      const r = gp.vibrationActuator.playEffect?.('dual-rumble', effect);
      r?.catch?.(() => {});   // 'preempted' when the next tick replaces it: expected
      played.push(effect); if (played.length > 200) played.shift();
    } catch { /* a pad without dual-rumble */ }
    since = 0; wasOn = on;
    return m;
  }
  return { update, mix, played, get off() { return off; } };
}
