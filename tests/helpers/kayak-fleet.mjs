// The kayak fleet against a sailboat on a straight leg (tests/kayaksMind.test.mjs and its slow lane,
// tests/slow/kayaksMind.slow.mjs): the terrain, the start, the boat's path and the fleet's run.
import { makeTerrain } from '../../src/sim/terrain.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { planFleet, kayakCount } from '../../src/sim/kayaks/plan.js';
import { createAgent, stepHull } from '../../src/sim/kayaks/agent.js';
import { createMind, think } from '../../src/sim/kayaks/mind.js';
import { dayWind } from '../../src/sim/wind.js';

export const T = makeTerrain(), D = Math.PI / 180, I = T.lake.island;
const S0 = CURRENT_WATERS.start;
export const START = { x: S0.x, z: S0.z, heading: S0.headingDeg * D };
// water a kayak may be in while it gives way: over 1.2 m deep (it draws 10 cm; the routes keep 2 m) and 8 m off the shore
export const kayakWater = (x, z) => -T.heightAt(x, z) >= 1.2 && -T.shoreDistance(x, z) >= 8;

// a sailboat on a straight leg (or two: the start's heading, then bearing away for Fannette after t1 s), at U m/s
export function sail(kind, U = 3.0, t1 = 20) {
  const at = (t) => {
    if (kind === 'hold' || t < t1) return { x: START.x + Math.sin(START.heading) * U * t, z: START.z - Math.cos(START.heading) * U * t };
    const x1 = START.x + Math.sin(START.heading) * U * t1, z1 = START.z - Math.cos(START.heading) * U * t1, h = Math.atan2(I.x - x1, -(I.z - z1));
    return { x: x1 + Math.sin(h) * U * (t - t1), z: z1 - Math.cos(h) * U * (t - t1) };
  };
  return (t, dt) => { const p = at(t), q = at(t + dt); return { x: p.x, z: p.z, vx: (q.x - p.x) / dt, vz: (q.z - p.z) / dt }; };
}
// a fleet out at an hour, its minds stepped against a boat for secs; per kayak: the closest approach, the worst time in the
// boat's path ahead of its bow, the worst water, the actions taken; and the closest two kayaks came
export function runFleet({ seed, hour = 9, boat, secs = 240, slots = null }) {
  const n = kayakCount({ hour, windMs: dayWind(hour, { seed }).speedMs, seed });
  const ss = slots ?? planFleet({ seed, terrain: T, start: START }).slice(0, n);
  const ks = ss.map((s) => ({ a: createAgent({ slot: s }), m: createMind(s), s, min: Infinity, ahead: 0, wet: true, actions: new Set(), looked: 0 }));
  const dt = 1 / 30; let pair = Infinity;
  for (let i = 0; i < secs / dt; i++) {
    const b = boat(i * dt, dt), others = ks.map((k) => k.a);
    for (const k of ks) {
      stepHull(k.a, dt, think(k.a, k.m, dt, { boat: b, others, terrain: T }));
      const rx = k.a.x - b.x, rz = k.a.z - b.z, bs = Math.hypot(b.vx, b.vz), along = (rx * b.vx + rz * b.vz) / bs, across = Math.abs(rx * b.vz - rz * b.vx) / bs;
      k.min = Math.min(k.min, Math.hypot(rx, rz));
      if (along > 0 && along < 30 && across < 6) k.ahead += dt;   // right under the bow
      if (i % 15 === 0 && !kayakWater(k.a.x, k.a.z)) k.wet = false;
      k.actions.add(k.m.action); if (k.a.look != null) k.looked += dt;
    }
    for (let p = 0; p < ks.length; p++) for (let q = p + 1; q < ks.length; q++) pair = Math.min(pair, Math.hypot(ks[p].a.x - ks[q].a.x, ks[p].a.z - ks[q].a.z));
  }
  return { n, ks, pair };
}
