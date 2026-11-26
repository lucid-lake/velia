// The stand-up paddleboarders (v2/living/sup.js, the region rows' `sups`): a few boards on slow closed lanes near a beach, each a standing
// paddler with a single-blade paddle (v2/sim/supPose.js). Pure: no DOM, no GPU, no Math.random, no wall clock (the caller's dt and hour).
//   const F = createSupFleet({ slots, hour, storm, heightAt })
//     slots: [{ id, path (src/sim/kayaks/routes.js polyline: at(s) → { x, z, heading }, length), s0, seed, board, pfd, cap, skin, region }]
//   F.step(dt)          the boards along their lanes (0.85 m/s, a stroke every 3.1 s, the blade's side alternating), the balance sway, the
//                       splashes' wobble; out only in the day (SUP.hours) and never in a storm
//   F.spook(x, z, r)    Tessie's splash (a breach or a surfacing within r m, default SUP.spookM): each board within r wobbles for SUP.wobbleS,
//                       drops to kneel on the deck, holds SUP.holdS, then stands again (SUP.riseS). The paddler never leaves the board:
//                       the body's roll is capped (supPose BODY.rollMax) and the feet, knees and hips are tied to the deck
//   F.marks()           [{ id, x, z, heading, kneel }] the boards out (the busy lake keeps clear of them; Tessie's target list: kind 'sup')
//   F.boards            every board's state: { slot, x, z, heading, v, u, side, k (kneel 0..1), roll, shift, pose, out }
//   F.splash, F.tips    the blade's catches and exits this step and its tip (the kayaks' splash, living/kayaks-splash.js, draws them)
import { supPose, newPose, BODY } from './supPose.js';

export const SUP = Object.freeze({
  speedMs: 0.85, strokeS: 3.1, hours: Object.freeze([8.5, 19]), spookM: 20,
  wobbleS: 1.0, dropS: 0.8, holdS: Object.freeze([3.5, 5.5]), riseS: 1.4,   // the splash: wobble, drop to kneel, hold, stand again
  swayS: 6.5, swayRad: 0.04, wobbleRad: 0.3, wobbleHz: 1.7, wobbleDecayS: 1.8, turnRate: 0.7,
  hull: Object.freeze({ L: 3.35, B: 0.76 }),
});
const TAU = 2 * Math.PI;
const wrap = (a) => { a %= TAU; return a > Math.PI ? a - TAU : a < -Math.PI ? a + TAU : a; };
const hash01 = (seed, k) => { let h = (Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul((k | 0) + 0x5bd1e995, 0x85ebca6b)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };

// a board-frame point in the world (the board at x, z heading h: x starboard, z aft)
export const toWorld = (b, px, pz) => [b.x + Math.cos(b.heading) * px - Math.sin(b.heading) * pz, b.z + Math.sin(b.heading) * px + Math.cos(b.heading) * pz];

export function createSupFleet({ slots = [], hour = () => 13, storm = () => false, heightAt = () => 0 } = {}) {
  let time = 0, spookCount = 0, catches = 0;
  const splash = [], tips = new Map();
  const boards = slots.map((slot, i) => {
    const p = slot.path.at(slot.s0), pr = hash01(slot.seed ?? 1, 11 + i);
    return { slot, i, s: slot.s0, x: p.x, z: p.z, heading: p.heading, v: SUP.speedMs, u: hash01(slot.seed ?? 1, 3), side: hash01(slot.seed ?? 1, 5) < 0.5 ? 1 : -1, k: 0, roll: 0, shift: 0, amp: 0,
      swayPh: pr * TAU, wobbleT: 0, wobbleUntil: -1, kneelUntil: -1, holdS: SUP.holdS[0] + (SUP.holdS[1] - SUP.holdS[0]) * hash01(slot.seed ?? 1, 17), pose: newPose(), out: false, caught: false };
  });
  const inDay = () => { const h = hour(); return !storm() && h >= SUP.hours[0] && h < SUP.hours[1]; };
  const sm = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
  const state = { spooks: 0 };

  function step(dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1); time += dt; splash.length = 0; tips.clear();
    const day = inDay();
    for (const b of boards) {
      b.out = day;
      if (!day) continue;
      // the splash's state: a wobble, then down on the knees, then up again (the kneel eases toward its target: no pop when a second splash lands)
      const target = time >= b.wobbleUntil && time < b.kneelUntil ? 1 : 0;
      b.k += Math.max(-dt / SUP.riseS, Math.min(dt / SUP.dropS, target - b.k));
      b.k = Math.min(1, Math.max(0, b.k));
      b.amp *= Math.exp(-dt / SUP.wobbleDecayS);
      if (b.amp < 1e-3) b.amp = 0;
      b.wobbleT += dt;
      // the lane: slower while kneeling (she drifts on, the paddle across her lap)
      b.v = SUP.speedMs * (1 - 0.75 * b.k) * (1 + 0.1 * Math.sin(Math.PI * Math.min(1, b.u / 0.55)) * (b.u < 0.55 ? 1 : 0));
      b.s += b.v * dt;
      const p = b.slot.path.at(b.s), la = b.slot.path.at(b.s + 4), want = Math.atan2(la.x - p.x, -(la.z - p.z));
      b.x = p.x; b.z = p.z;
      const turn = Math.max(-SUP.turnRate * dt, Math.min(SUP.turnRate * dt, wrap(want - b.heading)));
      b.heading = wrap(b.heading + turn);
      // the stroke: one every strokeS, the blade's side swapped at the end of each (frozen as she kneels)
      const du = dt / SUP.strokeS * (1 - b.k), u1 = b.u + du;
      if (u1 >= 1) { b.u = u1 - 1; b.side = -b.side; b.caught = false; } else b.u = u1;
      // the blade's catch and exit: the kayaks' splash (a catch lifts droplets at the blade, the exit drips)
      if (b.k < 0.3) {
        if (!b.caught && b.u >= 0.1 && b.u < 0.5) {
          b.caught = true; const q = b.pose.tip, w = toWorld(b, q[0], q[2]), y = heightAt(w[0], w[1]);
          splash.push({ type: 'catch', key: `${b.slot.id}:cap`, at: [w[0], y, w[1]], water: y, s: 0.35 }); catches++;
        } else if (b.caught && b.u >= 0.5) {
          b.caught = false; const q = b.pose.tip, w = toWorld(b, q[0], q[2]), y = heightAt(w[0], w[1]);
          splash.push({ type: 'exit', key: `${b.slot.id}:cap`, at: [w[0], y, w[1]], water: y, s: 0.4 });
        }
        if (b.u >= 0.5 && b.u < 0.62) { const q = b.pose.tip, w = toWorld(b, q[0], q[2]); tips.set(`${b.slot.id}:cap`, [w[0], heightAt(w[0], w[1]) + 0.1, w[1]]); }
      }
      // the body's balance: a slow sway, the lean into the pull, the splash's wobble (capped by the pose)
      const wob = b.amp * SUP.wobbleRad * Math.sin(TAU * SUP.wobbleHz * b.wobbleT + b.swayPh);
      b.roll = SUP.swayRad * Math.sin(TAU * time / SUP.swayS + b.swayPh) + -b.side * 0.025 * Math.sin(Math.PI * b.u) * (1 - b.k) + wob;
      b.shift = b.amp * 0.07 * Math.sin(TAU * SUP.wobbleHz * b.wobbleT + b.swayPh + 1.1);
      supPose({ kneel: b.k, u: b.u, side: b.side, roll: b.roll, shift: b.shift, reach: 1 }, b.pose);
    }
  }

  // Tessie's splash: every board out within r wobbles and drops to kneel (never into the water)
  function spook(x, z, r = SUP.spookM) {
    let n = 0;
    for (const b of boards) {
      if (!b.out || Math.hypot(b.x - x, b.z - z) > r) continue;
      n++; spookCount++;
      const active = time < b.kneelUntil || b.k > 0.02;
      if (!active) { b.wobbleT = 0; b.wobbleUntil = time + SUP.wobbleS; b.kneelUntil = time + SUP.wobbleS + SUP.dropS + b.holdS; b.amp = 1; }
      else { b.kneelUntil = Math.max(b.kneelUntil, time + SUP.dropS + b.holdS * 0.6); b.wobbleUntil = Math.min(b.wobbleUntil, time); b.amp = Math.max(b.amp, 0.6); }
    }
    state.spooks += n;
    return n;
  }

  return {
    boards, splash, tips, spook, step,
    marks() { const o = []; for (const b of boards) if (b.out) o.push({ id: b.slot.id, x: b.x, z: b.z, heading: b.heading, kneel: b.k }); return o; },
    stats() { let out = 0, kn = 0; for (const b of boards) { if (b.out) out++; if (b.k > 0.5) kn++; } return { boards: boards.length, out, kneeling: kn, spooks: spookCount, catches }; },
    get time() { return time; },
  };
}
export { BODY };
