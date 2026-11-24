// Cruise's helm on the shared simulation (src/sail/simulation.js): each 1/60 s tick the navigator plans and the AI
// skipper sails (pilot.js), the drawn pose's interpolation marks the state, then the physics steps. Plain JS, no DOM:
// the page (index.js sailFor) and the determinism record (tests/helpers/sim-cruise.mjs) both run it.
//   const helm = createCruiseHelm({ phys, pilot, nav, ctl, env, traffic, sunElevDeg: () => deg, t0, interp });
//   helm.advance(simDt)   // whole ticks; helm.sim.t (the sim clock), helm.sim.alpha (the drawn pose)
// tackle: the ground tackle (src/boat/tackle.js; the fireworks trip anchors with it, S5); hold(): true while the
// crew(dt, t): the crew's own work each tick (the fireworks trip: the sails, the engine, the anchor); true while they have the
// boat (stopping, at anchor): the pilot lets the helm go, the rudder amidships
import { createSimulation } from '../../../../src/sim/sail/simulation.js';

// pilot: a CruisePilot (null: the navigator's own helm and the crew's trim); ctl: the controls they write (the sim's inputs)
export function createCruiseHelm({ phys, pilot = null, nav, ctl, env, traffic, sunElevDeg, t0 = 0, interp = null, tackle = null, crew = null }) {
  const sim = createSimulation({ boat: { phys, env, tackle }, t0 });
  const before = (id, t) => {
    const ctx = { t, sunElevDeg: sunElevDeg(), traffic };
    if (crew?.(sim.dt, t)) ctl.rudder = 0;
    else if (pilot) pilot.update(sim.dt, phys.state, ctl, ctx);
    else { const out = nav.update(phys.state, ctx); ctl.rudder = out.rudder; ctl.jibSide = out.jibSide; }
    interp?.mark(phys.state);
  };
  return { sim, advance: (simDt) => sim.step(simDt, ctl, { before }) };
}
