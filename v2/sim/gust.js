// The gust's payoff on v2 (audit W4, 2026-11-14): v1's src/gustFx.js as it is (GustWatch, CameraLean, the snap events and
// the numbers), with one result record reused every frame (v1's createGustFx.update returns a new object a frame; the
// maths here are its, line for line: v2/tests/gust.test.mjs holds the two together over a gust's trace).
//   const g = createGust({ on, reduced, steady });
//   each sim frame: const r = g.update(dt, B.state)   → { onset, punch, rushMul, spray, events, ratio } (the same record)
//     r.events, r.rushMul → v1's boat audio (v2/audio/recorded.js: createBoatAudio's update opts extra / rushMul)
//     r.spray: v1 computes it and never draws it (its ride's spray has no gust input); kept for parity, not drawn
//   the follow camera: g.lean(dt, pose, B.state) sets pose.up (a reused array) to lean a share of the heel, lagging it
import { GustWatch, CameraLean, gustSnapEvents, GUSTFX } from '../../src/gustFx.js';

const KN = 0.514444;
import { clamp01 } from '../../src/sim/core/math.js';
import { smooth as smoothstep } from '../../src/sim/core/math.js';
const NONE = Object.freeze([]);

export function createGust({ on: on0 = true, reduced = () => false, steady = () => true, o = GUSTFX } = {}) {
  let on = on0;
  const watch = new GustWatch(o), camLean = new CameraLean(o);
  const r = { onset: null, punch: 0, rushMul: 1, spray: 0, events: NONE, ratio: 1 };
  const stats = { onsets: 0, last: null };
  let punch = 0;
  const up = [0, 1, 0];
  function update(dt, s) {
    if (!on || dt <= 0) { r.onset = null; r.punch = 0; r.rushMul = 1; r.spray = 0; r.events = NONE; return r; }
    const ev = watch.update(dt, s.trueWind?.speed ?? 0);
    punch *= Math.exp(-dt / o.punchTau);
    r.events = NONE;
    if (ev) {
      punch = Math.max(punch, 0.35 + 0.65 * ev.strength);
      r.events = gustSnapEvents(ev.strength, o);
      stats.onsets++; stats.last = { t: watch.t, strength: ev.strength };
    }
    const speed = smoothstep(o.sprayKn[0] * KN, o.sprayKn[1] * KN, s.u ?? s.sog ?? 0);
    r.onset = ev; r.punch = punch; r.rushMul = 1 + o.rushMul * punch; r.spray = Math.min(1, punch * o.sprayGain) * speed; r.ratio = watch.ratio ?? 1;
    return r;
  }
  // v1's leanPose: the roll from the heel (as seen from the camera's azimuth), into pose.up; pose: { pos, target, up? }
  function lean(dt, pose, s) {
    if (!on) return pose;
    camLean.share = reduced() ? 0 : steady() ? o.lean : o.leanFree;
    const yaw = Math.atan2(pose.target[0] - pose.pos[0], -(pose.target[2] - pose.pos[2]));
    const roll = camLean.update(dt, s.heel ?? 0, yaw, s.heading ?? 0);
    // v1's leanUp(yaw, roll), into the reused array (v1 leaves the pose's up alone under 1e-5 rad: world up)
    if (Math.abs(roll) < 1e-5) { up[0] = 0; up[1] = 1; up[2] = 0; } else {
      const x = Math.sin(roll), y = Math.cos(roll), c = Math.cos(-yaw), sn = Math.sin(-yaw);
      up[0] = x * c; up[1] = y; up[2] = -x * sn;
    }
    pose.up = up;
    return pose;
  }
  return { get on() { return on; }, setOn(v) { on = !!v; }, update, lean, watch, stats, get last() { return r; }, get roll() { return camLean.roll; } };   // setOn: the in-page A/B
}
