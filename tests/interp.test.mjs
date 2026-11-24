// Render-state interpolation (src/boat/interp.js): the boat moves every display frame at any refresh rate.
// v1 only (/classic/): trimmed to its representative check(s).
import test from 'node:test';
import assert from 'node:assert/strict';
import { StateInterp } from '../src/sim/boat/interp.js';

const STEP = 1 / 60;
// a boat at 4 m/s due east, turning 0.5 rad/s; the "physics" is stepped in whole ticks, the display at its own rate
function run(hz, seconds, jitter = 0, interpolate = true) {
  const st = { x: 0, z: 0, heading: Math.PI - 0.1, trueWind: { speed: 5, angle: 3.1 }, flag: false };
  const ip = new StateInterp(); const out = [];
  let acc = 0, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let f = 0; f < seconds * hz; f++) {
    acc += (1 / hz) * (1 + (rnd() - 0.5) * 2 * jitter);
    while (acc >= STEP) { ip.mark(st); st.x += 4 * STEP; st.heading += 0.5 * STEP; st.trueWind.angle += 0.5 * STEP; st.flag = !st.flag; acc -= STEP; }
    out.push(interpolate ? ip.at(st, acc / STEP) : { ...st });
  }
  return out;
}
const steps = (frames) => frames.slice(10).map((s, i) => s.x - frames[9 + i].x);
const ratio = (d) => Math.max(...d) / Math.min(...d);

test('120 Hz: the raw physics state moves in alternating zero and double steps, the interpolated one evenly', () => {
  const raw = steps(run(120, 2, 0, false)), smooth = steps(run(120, 2));
  assert.equal(Math.min(...raw), 0, 'raw: frames with no movement');
  assert.ok(ratio(smooth) < 1.05, `interpolated max/min step ${ratio(smooth).toFixed(3)}`);
});
