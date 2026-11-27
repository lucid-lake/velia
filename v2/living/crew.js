// The player's sloop's crew, the plug-in for v2/main.js (living/lakePlugins.js CREW; src/core/features.js crew): the helmsman and
// the crew (v2/render/boat/crew.js: the choreography; v2/render/boatCrew.js: the draw) on the kayaks' figure and skin pipeline,
// in every mode the player's boat sails (Sail, Cruise, Regatta). The figure's asset is the kayaks' own (living/kayaks.js loadAsset):
// a live page asks for it after the first frame; a capture primes it before.
//   const W = createCrewPlugin({ device, reg, sky, shadow, kayaks, tier, errors })
//   W.step(dt)   the living clock (main.js sim.living: the wall clock live, the sim's in a capture): people move in real time, as the
//                kayakers paddle (not at Sail's 2 x), while the boom, the heel and the wheel they answer are the boat's own
//   W.fill({ frame, eye, focal, helmK })   once a frame, after the boat's update (frame: render/boat.js crewFrame)
//   W.draw(pass, c)   W.prime()   W.stats()
import { createBoatCrewRender } from '../render/boatCrew.js';

export function createCrewPlugin({ device, reg, sky, shadow, kayaks, tier = 'full', errors = [], headless = false }) {
  if (!kayaks?.render || !kayaks.loadAsset) return null;   // ?kayaks=0: no figure to draw them with
  const R = createBoatCrewRender({ device, reg, sky, shadow, kayakRender: kayaks.render, tier });
  let asking = null, due = 0;
  const ask = () => (asking ??= kayaks.loadAsset().catch((e) => { errors.push(`crew: ${e?.message ?? e}`); return null; }));
  const self = {
    on: true, render: R,
    rate: 1,   // the living clock's share (a film at the game's 2 x pace sets 0.5 so the people keep real time, as live)
    step(dt) { due += dt * self.rate; },
    fill({ frame, eye, focal, helmK = 0 }) {
      if (!headless) ask();
      const dt = Math.min(0.1, due); due = 0;
      R.update(self.on ? frame : null, { dt, eye, focal, helmK });
    },
    draw(pass, c) { if (self.on) R.draw(pass, c); },
    prime: () => ask(),
    stats: () => ({ ...R.stats }),
  };
  return self;
}
