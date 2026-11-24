// No storm (owner, 2026-11-18: "Remove storm from phone"; src/core/features.js storm): the storm's interface with nothing
// behind it, so a phone's page never fetches the storm's chunk (sim/storm.js, render/storm.js, the thunder) and never runs
// one. The weather stays fair: every start is refused, the rows the frame writes are the fair ones (the same numbers
// sim/storm.js writes with no storm running), the water's wind is the base wind.
//   const storm = createStormOff();   // in place of createStorm(...) where feature('storm') is off
import { createWeatherState } from '../../src/sim/weather/state.js';

export function createStormOff() {
  const W = createWeatherState();
  const info = Object.freeze({ s: null, phase: 'none', rain: 0, dark: 0, gold: 0, flash: 0, rainbow: 0, drops: 0, strikes: 0, thunders: [], off: true });
  const frame = Object.freeze({ ran: false, s: 0, A: null, k: 1, L: null, w: null, strikes: Object.freeze([]), bolt: null, boltGlow: 0 });
  return {
    off: true, weather: W, info, frame,
    get running() { return false; }, get leaving() { return false; }, get choice() { return 'fair'; }, get state() { return null; }, get rain() { return 0; },
    begin() { return false; },
    start() { return null; },          // ?weather=storm, ?storms=natural, a menu or a stage asking: refused
    stop() {}, choose() { return 'fair'; }, strikesFrom() { return []; },
    update() { return info; },
    waterWind(base, out) { out.speedMs = base.speedMs; out.dirDeg = base.dirDeg; out.travelRad = base.travelRad; out.gain = 1; return out; },
    // the fair rows of the shared uniform (uniforms.js): storm off, the sun unshaded
    fillFrame(U) {
      U.set4('storm', 0, 1, 0, 0);
      U.set4('rain', 0, 0, 0, 0);
      U.set4('cell', W.cell[0], W.cell[1], W.cell[2], 0);
      U.set4('front', 0, 0, 0, 0);
      U.set4('bow', W.toRain[0], W.toRain[1], 0, 0);
      return 1;
    },
  };
}
