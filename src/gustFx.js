// The gust's payoff (wow/gusts, 2026-11-05): what the player feels when a gust they saw coming lands. Plain JS, no
// three.js and no Web Audio: node tests drive it (tests/gustFx.test.mjs). The gust itself is the wind module's (the
// cells of src/wind-cells.js in the one WindField); this only reads the boat's state, which reads the wind.
//
//   const fx = createGustFx({ flags });                 // ?gustfx=0: everything off (the A/B switch)
//   each frame: const g = fx.update(dt, phys.state);     // { onset, punch, rushMul, spray, events }
//     g.events → boatAudio.update(…, { extra: g.events, rushMul: g.rushMul })   (the sail-fill snap, the rush rising)
//     g.spray  → ride.spray.setGust(g.spray)              (bow spray, × the gust's strength and the boat's speed)
//   the follow camera: pose = fx.lean(dt, pose, state)   (it leans a share of the heel, lagging it; never shakes)
//
// The onset: the true wind at the boat, a fast (0.5 s), a mid (3 s) and a slow (16 s) average. When the fast passes
// 1.06 × the slow while it runs 1.04 × over the mid, that quick rise begun under riseS ago (a slow swell of the day's
// wind never fires, nor a gust already blowing when the gap ends), a gust is landing; the event fires at its first peak (or 0.4 s on), sized by how far over the slow it
// got (full at +22 %). Re-armed once the ratio falls back under 1.03; never two within 7 s.
import { toFlags } from './sim/core/flags.js';
import { clamp01 } from './sim/core/math.js';
export const GUSTFX = {
  fastTau: 0.5, midTau: 3, slowTau: 16, on: 1.06, rise: 1.04, riseS: 1.2, rearm: 1.03, gapS: 7, waitS: 0.4, full: 0.22,
  punchTau: 2.2,                    // s: the hit's envelope (the rush, the spray burst) decays over this
  rushMul: 0.7,                     // the hull's rush × (1 + 0.7 × punch)
  snap: 0.55, jibDelayS: 0.14,      // the sail-fill snap's gain at full strength; the jib fills a beat after the main
  sprayKn: [2, 5], sprayGain: 2.5,  // kn: the gust's bow spray fades in with the boat's speed; × punch, capped at 1
  // the camera's lean: a share of the heel (the steady-horizon setting: on → lean, off → leanFree), lagging it by
  // leanTau, at most leanMaxDeg; reduced motion: none
  lean: 0.16, leanFree: 0.28, leanTau: 0.8, leanMaxDeg: 6,
};
const KN = 0.514444, DEG = Math.PI / 180;
import { smooth as smoothstep } from './sim/core/math.js';

// ?gustfx=0 turns the whole feature off: the gust cells in the wind, the water's gust line, the payoff
export const gustFxOn = (flags) => toFlags(flags).gustfx;   // flags: the page's or a mode's (null: the defaults)

export class GustWatch {
  constructor(o = GUSTFX) { this.o = o; this.fast = null; this.mid = null; this.slow = null; this.armed = true; this.wait = null; this.peak = 0; this.last = -Infinity; this.t = 0; this.prevR = 1; this.qUp = null; }
  // dt s, tws m/s → an onset { strength 0..1 } on the frame the gust lands, else null; ratio: fast / slow
  update(dt, tws) {
    const o = this.o;
    this.t += dt;
    if (this.fast == null) { this.fast = this.mid = this.slow = Math.max(tws, 0.1); return null; }
    this.fast += (tws - this.fast) * (1 - Math.exp(-dt / o.fastTau));
    this.mid += (tws - this.mid) * (1 - Math.exp(-dt / o.midTau));
    this.slow += (tws - this.slow) * (1 - Math.exp(-dt / o.slowTau));
    const r = this.fast / Math.max(this.slow, 0.1), quick = this.fast >= o.rise * this.mid;
    this.qUp = quick ? (this.qUp ?? this.t) : null;
    this.ratio = r;
    let ev = null;
    if (this.wait != null) {
      this.peak = Math.max(this.peak, r);
      if (r < this.prevR || this.t - this.wait >= o.waitS) { ev = { strength: clamp01((this.peak - 1) / o.full) }; this.wait = null; this.last = this.t; }
    } else if (this.armed && r >= o.on && quick && this.t - this.qUp <= o.riseS && this.t - this.last >= o.gapS && tws > 2) {
      this.armed = false; this.wait = this.t; this.peak = r;
    }
    if (!this.armed && this.wait == null && r < o.rearm) this.armed = true;
    this.prevR = r;
    return ev;
  }
}

// The follow camera's lean: roll the view a share of the boat's heel (as seen from astern: × cos of the camera's
// angle off the bow), critically damped so it trails the heel and settles; never faster than the boat.
export class CameraLean {
  constructor(o = GUSTFX) { this.o = o; this.roll = 0; this.v = 0; this.share = o.lean; }
  // heel rad (the physics' sign); camYaw, boatHeading rad (compass); returns the roll (rad)
  update(dt, heel, camYaw, boatHeading) {
    const o = this.o, w = 2 / o.leanTau;
    const goal = Math.max(-o.leanMaxDeg * DEG, Math.min(o.leanMaxDeg * DEG, heel * this.share * Math.cos(camYaw - boatHeading)));
    const e = Math.exp(-w * dt), d = this.roll - goal, tmp = (this.v + w * d) * dt;
    this.roll = goal + (d + tmp) * e; this.v = (this.v - w * tmp) * e;
    return this.roll;
  }
}

// the up vector for a camera looking along azimuth yaw (compass rad) rolled by roll (the helm camera's frame:
// src/boat/helmCamera.js toWorldDir with heel = roll, pitch 0)
export function leanUp(yaw, roll) {
  const x = Math.sin(roll), y = Math.cos(roll);   // rotZ([0, 1, 0], -roll) = [sin roll, cos roll, 0]
  const c = Math.cos(-yaw), s = Math.sin(-yaw);   // rotY(·, −yaw)
  return [x * c, y, -x * s];
}

// the boat audio's events for an onset (src/boatAudio.js fire(): 'snap' plays the sail_snap bank on the sails group)
export function gustSnapEvents(strength, o = GUSTFX) {
  if (strength <= 0.05) return [];
  const g = o.snap * (0.45 + 0.55 * strength);
  return [{ kind: 'snap', sail: 'main', gain: g, rate: 0.9, gust: true }, { kind: 'snap', sail: 'jib', gain: g * 0.7, rate: 1.06, delay: o.jibDelayS, gust: true }];
}

// The whole payoff, per frame. opts: { on (false: inert), reduced () → prefers-reduced-motion, steady () → the
// steady-horizon setting }
export function createGustFx({ flags = null, on = gustFxOn(flags), reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches, steady = () => true, o = GUSTFX } = {}) {
  const watch = new GustWatch(o), lean = new CameraLean(o);
  let punch = 0, onsets = 0;
  const stats = { onsets: 0, last: null };
  function update(dt, s) {
    if (!on || dt <= 0) return { onset: null, punch: 0, rushMul: 1, spray: 0, events: [] };
    const ev = watch.update(dt, s.trueWind?.speed ?? 0);
    punch *= Math.exp(-dt / o.punchTau);
    let events = [];
    if (ev) {
      punch = Math.max(punch, 0.35 + 0.65 * ev.strength);
      events = gustSnapEvents(ev.strength, o);
      stats.onsets = ++onsets; stats.last = { t: watch.t, strength: ev.strength };
    }
    const speed = smoothstep(o.sprayKn[0] * KN, o.sprayKn[1] * KN, s.u ?? s.sog ?? 0);
    return (fx.last = { onset: ev, punch, rushMul: 1 + o.rushMul * punch, spray: Math.min(1, punch * o.sprayGain) * speed, events, ratio: watch.ratio ?? 1 });
  }
  // the follow pose ({ pos, target, fov }) with an up that leans with the heel
  function leanPose(dt, pose, s) {
    if (!on) return pose;
    lean.share = reduced() ? 0 : steady() ? o.lean : o.leanFree;
    const yaw = Math.atan2(pose.target[0] - pose.pos[0], -(pose.target[2] - pose.pos[2]));
    const roll = lean.update(dt, s.heel ?? 0, yaw, s.heading ?? 0);
    return Math.abs(roll) < 1e-5 ? pose : { ...pose, up: leanUp(yaw, roll) };
  }
  const fx = { on, update, lean: leanPose, watch, stats, last: null, get roll() { return lean.roll; } };   // last: the frame's result (the film tools)
  return fx;
}
