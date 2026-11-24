// Glass Boat Chase (owner go 2026-11-19 with every default): Velia Travel, the glass boat, leaves her stop
// off Fannette on her own route (v2/sim/tourBoat.js chase(): from the stop at rest a little before the countdown, her own speed law: her head start)
// and the fleet races her to the Boat Camp's no-wake buoy. Her wash slows a boat sitting in it: the wash is a strip along her own
// track (her stern every 0.5 s with her speed then, as her wake's record for the wake map on the water, render/vesselWake.js, but kept
// for a minute), widening with age and fading out over WASH.keepS. A boat in it loses way (session.js:
// u × (1 − dragK · k · dt) each tick): pass her to windward, clear of the strip. Pure: no DOM, no GPU (v2/tests/regatta-places-2.test.mjs).
//   washAt(trail, x, z) → k in [0, 1]: how deep in her wash the point is (0 clear of it)
//   createWashTrail()   .step(boat, dt) her stern's record for the wash (the race steps it on her sim time), .pts, .reset()
//   createChaseWatch()  .step({ me, glass, finish, clock }) → 'caught' once, the first time the player is nearer the finish than she is
//                       (she was ahead at the gun);  .caughtAt (race clock s) | null;  .ahead (she is ahead now)
// keepS: the strip's memory (her wake's own record keeps 29 s for the picture; the wash a boat feels lingers longer: a tour pontoon's
// wash rolls on about a minute behind her), halfW0 + spread × age × v its half-width, fading as 1 − (age / keepS)²
export const WASH = Object.freeze({ keepS: 60, halfW0: 4, spread: 0.12, minV: 0.4, dragK: 0.12, fullV: 2, everyS: 0.5, sternM: 6 });

export function washAt(wake, x, z, K = WASH) {
  let k = 0;
  if (!wake?.length) return 0;
  for (const p of wake) {
    if (p.age >= K.keepS || !(p.v > K.minV)) continue;
    const w = K.halfW0 + K.spread * p.age * p.v, d = Math.hypot(x - p.x, z - p.z);
    if (d >= w) continue;
    const a = p.age / K.keepS, ki = (1 - d / w) * Math.min(1, p.v / K.fullV) * (1 - a * a);
    if (ki > k) k = ki;
  }
  return Math.min(1, k);
}
// the wash's own record: her stern every everyS s of her sim (the boat's { x, z, heading, v }), kept keepS (newest first)
export function createWashTrail(K = WASH) {
  const pts = []; let acc = K.everyS;
  return {
    pts,
    reset() { pts.length = 0; acc = K.everyS; },
    step(boat, dt) {
      if (!boat || !(dt > 0)) return pts;
      for (const p of pts) p.age += dt;
      while (pts.length && pts[pts.length - 1].age > K.keepS) pts.pop();
      acc += dt;
      if (acc >= K.everyS) { acc = 0; const fx = Math.sin(boat.heading ?? 0), fz = -Math.cos(boat.heading ?? 0); pts.unshift({ x: boat.x - fx * K.sternM, z: boat.z - fz * K.sternM, v: boat.v ?? 0, age: 0 }); }
      return pts;
    },
  };
}

export function createChaseWatch() {
  const st = { caughtAt: null, ahead: true, started: false };
  return {
    get caughtAt() { return st.caughtAt; }, get ahead() { return st.ahead; },
    step({ me, glass, finish, clock = 0 }) {
      if (!me || !glass || !finish || st.caughtAt != null) return null;
      const dMe = Math.hypot(finish[0] - me.x, finish[1] - me.z), dG = Math.hypot(finish[0] - glass.x, finish[1] - glass.z);
      st.ahead = dG < dMe;
      if (!st.started) { st.started = clock >= 0; return null; }
      if (!st.ahead) { st.caughtAt = clock; return 'caught'; }
      return null;
    },
  };
}
