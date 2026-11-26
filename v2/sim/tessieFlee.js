// Play as Tessie: the skipper sails your Halcyon away from her while you are her. Pure (no DOM).
// He bears away to her fastest point of sail, a broad reach FLEE.twaDeg off the true wind, on the side away from her, re-chosen every
// FLEE.everyS; a heading that runs into shoal water within FLEE.lookS of sailing is not taken (the busy lake's clear look). The helm is
// v1's pilot (Helm.toHeading); the crew trims (ctl.sheet null). Nobody fights back: he never steers at her.
//   fleeHeading({ x, z, heading }, windFrom, her { x, z } | null, clear(h) → bool) → rad
//   const F = createFlee({ B, depthAt, her, lure })   her() → { x, z } | null; lure() → { x, z } | null: Tessie's Lure at rank 4 (the RPG):
//                                        the skipper turns curious toward it while it lasts (out of the no-go cone, clear water), then flees again;  B.drive(F.drive) ... B.drive(null);  F.state { heading, n }
import { Helm } from '../../src/sim/boat.js';
import { clearLook } from './clearLook.js';
import { curiousHeading } from './tessieLure.js';

export const FLEE = Object.freeze({ twaDeg: 130, everyS: 10, lookS: 30, tries: 14, stepDeg: 12 });
const DEG = Math.PI / 180;
import { wrap } from '../../src/sim/core/math.js';

export function fleeHeading(s, windFrom, her, clear = () => true, K = FLEE) {
  // the two broad reaches; the one pointing away from her first
  const a = wrap(windFrom + Math.PI - (180 - K.twaDeg) * DEG), b = wrap(windFrom + Math.PI + (180 - K.twaDeg) * DEG);
  const away = her ? Math.atan2(s.x - her.x, -(s.z - her.z)) : s.heading;
  const order = Math.abs(wrap(a - away)) <= Math.abs(wrap(b - away)) ? [a, b] : [b, a];
  for (const h0 of order) for (let k = 0; k < K.tries; k++) {
    const h = wrap(h0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * K.stepDeg * DEG);
    if (Math.abs(wrap(h - windFrom)) < 50 * DEG) continue;   // never into the no-go cone
    if (clear(h)) return h;
  }
  return s.heading;
}

export function createFlee({ B, depthAt = () => 30, her = () => null, lure = () => null, K = FLEE } = {}) {
  const helm = new Helm({ rudderMaxDeg: B.phys.P.rudder.maxDeg });
  const look = clearLook(depthAt);
  const st = { heading: null, n: 0, nextT: -Infinity };
  return {
    state: st,
    drive(t, dt) {
      const s = B.phys.state, ctl = B.ctl;
      const lu = lure();
      if (lu) {
        const w = s.trueWind, h = curiousHeading(s, lu, wrap(s.heading + (w?.angle ?? 0)));
        if (look(h, K.lookS, s)) { st.curious = true; ctl.rudder = helm.toHeading(s, h, dt); ctl.sheet = null; ctl.throttle = null; return; }
      }
      if (st.curious) { st.curious = false; st.nextT = -Infinity; }   // the lure over: a fresh flee heading at once
      if (t >= st.nextT || st.heading == null) {
        const w = s.trueWind, windFrom = wrap(s.heading + (w?.angle ?? 0));
        st.heading = fleeHeading(s, windFrom, her(), (h) => look(h, K.lookS, s), K); st.nextT = t + (st.n === 0 ? 1 : K.everyS); st.n++;   // the first pick again after 1 s (the true wind is read after the first tick)
      }
      ctl.rudder = helm.toHeading(s, st.heading, dt);
      ctl.sheet = null; ctl.throttle = null;
    },
  };
}
