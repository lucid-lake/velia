// Night races (step B's leftover, built in step D; owner 2026-11-17): the course lit. A small steady light on top of each mark, on
// the pin's pole and at the committee boat's signal mast (its masthead light), so the course reads at night; the next mark keeps
// its pillar (the beacon) as by day. The lights ride the night's glow list (render/night.js setRace: the nav lights' halo, their
// minimum size on screen, their image in the water) and are lit only when the night is: the sun under NIGHT_MARKS.onDeg, faded
// in over the night's own nav-light ramp (sim/night.js navLevel), so a day race writes none. Steady, never flashing (
// principle 8: nothing flashes). Pure: v2/tests/regatta-night.test.mjs.
//   raceLights(out, { course, heightAt, windFrom, sunElevDeg, finish }) → n (the lights written, GLOW_FLOATS each: x, y, z, size,
//   r, g, b, radiance); 0 by day
import { GLOW_FLOATS, navLevel } from '../sim/night.js';

export const NIGHT_MARKS = Object.freeze({
  max: 12,                 // the lights a race writes at most (marks ≤ 8, the pin, the committee boat's two)
  size: 0.32,              // m: the lens' glow, as a nav light's (0.35)
  radiance: 260,           // the core's HDR peak (a nav light's 400: a mark's lantern is smaller and further)
  warm: Object.freeze([1.0, 0.88, 0.62]),    // a mark's lantern: warm white (amber is the UI's lit state; red/green port and starboard)
  white: Object.freeze([1.0, 0.96, 0.9]),    // the committee boat's masthead and the pin
  // the lamp's height over the water at each prop (render/raceProps.js meshes): W's sphere top, I's can top, the pin's pole, the mast
  y: Object.freeze({ markW: 1.95, markI: 2.25, pin: 3.9, mast: 6.25, deck: 3.55 }),
  mastZ: -1.4,             // the signal mast's place along the launch (its local z, toward the bow +)
});
// the lights' level from the sun: 0 by day, 1 at night (the boat's nav lights' ramp: on under 0.7°, full by −1.8°)
const nightMarksLevel = (sunElevDeg) => navLevel(sunElevDeg);
export const nightLit = (sunElevDeg) => nightMarksLevel(sunElevDeg) > 0;

export function raceLights(out, { course, heightAt = () => 0, windFrom = 0, sunElevDeg = 90, finish = false } = {}) {
  const level = nightMarksLevel(sunElevDeg);
  if (!(level > 0) || !course?.line) return 0;
  const M = NIGHT_MARKS, cap = Math.min(M.max, Math.floor(out.length / GLOW_FLOATS));
  let n = 0;
  const put = (x, y, z, c, k = 1) => {
    if (n >= cap) return;
    const o = n * GLOW_FLOATS;
    out[o] = x; out[o + 1] = y; out[o + 2] = z; out[o + 3] = M.size; out[o + 4] = c[0]; out[o + 5] = c[1]; out[o + 6] = c[2]; out[o + 7] = M.radiance * level * k;
    n++;
  };
  for (const m of course.marks ?? []) { const [x, z] = m.at; put(x, heightAt(x, z) + (m.kind === 'cylinder' ? M.y.markI : M.y.markW), z, M.warm); }
  const [px, pz] = course.line.pin; put(px, heightAt(px, pz) + M.y.pin, pz, M.white, 0.8);
  // the committee boat (put with the wind's heading, render/raceProps.js: local +z to (sin h, −cos h)): the masthead at the signal
  // mast; on the last leg a second, lower light on its hard top beside the finish's flag
  const [cx, cz] = course.line.committee, sy = Math.sin(windFrom), cy = Math.cos(windFrom), wy = heightAt(cx, cz);
  put(cx + M.mastZ * sy, wy + M.y.mast, cz - M.mastZ * cy, M.white);
  if (finish) put(cx + (M.mastZ + 1.6) * sy, wy + M.y.deck, cz - (M.mastZ + 1.6) * cy, M.warm, 0.7);
  return n;
}
