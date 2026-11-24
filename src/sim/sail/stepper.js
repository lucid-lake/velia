// The fixed-step accumulator ("fix your timestep", Glenn Fiedler): the physics ticks at a fixed dt (1/60 s), a frame adds
// its sim seconds and runs the whole ticks they make; the remainder carries to the next frame, and alpha (the remainder in
// ticks, 0..1) is how far the drawn pose sits between the last two ticks (src/boat/interp.js: the judder fix). One copy for
// Sail, Cruise and Regatta (it was written out three times: in Sail's controls, Cruise's sailFor and the Regatta session) and
// for the pure Simulation (simulation.js). Plain JS, no DOM.
//   const st = createStepper();                    // dt 1/60 s, no cap
//   st.advance(clampFrame(dtRaw) * rate, (dt) => { … one tick … });
//   interp.at(state, st.alpha)
import { DT } from '../boat.js';

// the longest frame a live mode lets through (s): a stall (a tab switch, a GC pause) is not replayed as a burst of ticks
export const FRAME_MAX = 0.1;
export const clampFrame = (dtRaw, max = FRAME_MAX) => Math.min(max, dtRaw);

// dt: the tick (s); maxSteps: the most ticks one advance() runs (Infinity: every one owed, as the modes always have; a cap
// drops the rest of the backlog and keeps the remainder)
export function createStepper({ dt = DT, maxSteps = Infinity } = {}) {
  const inv = 1 / dt;   // 60 exactly for 1/60: alpha is acc × 60, bit for bit as the modes computed it
  let acc = 0;
  return {
    dt, maxSteps,
    get acc() { return acc; }, set acc(v) { acc = v; },
    get alpha() { return acc * inv; },
    // add simDt (s) and run tick(dt, i) for each whole tick; returns the ticks run
    advance(simDt, tick) {
      acc += simDt;
      let n = 0;
      while (acc >= dt) {
        if (n >= maxSteps) { acc %= dt; break; }
        tick(dt, n); acc -= dt; n++;
      }
      return n;
    },
  };
}
