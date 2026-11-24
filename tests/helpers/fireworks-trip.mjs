// The fireworks trip in Cruise (S5), headless: the real BoatPhysics on the real wind field and terrain, the
// navigator and the AI skipper (createCruiseHelm), the ground tackle, and the trip (src/fireworks/cruise.js) as the page
// wires it (src/modes/chill/index.js crewStep). No GPU. → the log of the trip's states and the boat's record.
import { chillWorld } from '../../src/modes/chill/sim.js';
import { Navigator, scenicRoute } from '../../src/sim/modes/chill/navigator.js';
import { CruisePilot } from '../../src/sim/modes/chill/pilot.js';
import { createCruiseHelm } from '../../classic/src/modes/chill/helm.js';
import { BoatPhysics, CONTROLS } from '../../src/sim/boat.js';
import { createTackle } from '../../src/sim/boat/tackle.js';
import { createCruiseTrip, CRUISE_SPOT, crewStep } from '../../classic/src/fireworks/cruise.js';

// extra: more fixed objects on the chart (the show's props, src/fireworks/solids.js chartObjects); onStep(state): each second
export function runTrip({ seed = 1, hour = 19.5, start = { x: 600, z: -400, headingDeg: 60, speed: 2.5 }, minutes = 12, afterAt = null, anchored = false, extra = [], onStep = null } = {}) {
  const W = chillWorld({ seed, hour, rate: 0, extra });
  const { terrain, wind, chart, traffic } = W;
  const DEG = Math.PI / 180;
  const phys = new BoatPhysics({ x: start.x, z: start.z, heading: start.headingDeg * DEG, speed: start.speed });
  const nav = new Navigator({ chart, route: scenicRoute(chart, { seed }), seed });
  nav.pickNearest(start.x, start.z);
  const env = (t) => ({ t, windAt: (x, z, tt) => { const w = wind.sample(x, z, tt); return { vx: w.vx, vz: w.vz }; } });
  const pilot = new CruisePilot({ nav, skill: 1, seed, windAt: (x, z, t) => env(t).windAt(x, z, t) });
  const ctl = { ...CONTROLS };
  const tackle = createTackle({ depthAt: (x, z) => -terrain.heightAt(x, z) });
  const trip = createCruiseTrip();
  trip.start({ anchored });
  if (anchored) phys.furlPos = 1;
  let phase = 'before';
  const log = [], rec = { minDepth: Infinity, maxSog: 0, states: [] };
  const crew = (dt) => crewStep({ trip, phase, phys, ctl, nav, tackle, dt }).hold;
  const helm = createCruiseHelm({ phys, pilot, nav, ctl, env, traffic, sunElevDeg: () => 5, t0: 0, tackle, crew });
  const n = Math.round(minutes * 60);
  for (let s = 0; s < n; s++) {
    if (afterAt != null && s >= afterAt && trip.state === 'anchored') phase = 'after';
    helm.advance(1);
    const st = phys.state;
    onStep?.(st);
    rec.minDepth = Math.min(rec.minDepth, -terrain.heightAt(st.x, st.z));
    if (rec.states.at(-1) !== trip.state) rec.states.push(trip.state);
    log.push({ t: s + 1, state: trip.state, x: st.x, z: st.z, sog: st.sog, tackle: tackle.mode, anchor: tackle.state.anchor.phase, furl: st.furl, d: Math.hypot(st.x - CRUISE_SPOT[0], st.z - CRUISE_SPOT[1]) });
  }
  return { log, rec, trip, tackle, phys, nav };
}
