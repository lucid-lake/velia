// The waves made to be felt (owner 2026-10-30): the sea-state gain on the surface (the CPU weights, the same as the shader's), the follow camera
// riding the heave and pitch, the hull's sound growing with the sea.
//   node --test tests/seafeel.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCpuSurface, N } from '../src/sim/waters/ultra/surface.js';
import { BoatMix } from '../src/boatAudio.js';
import { CAM_RIDE, CAM_RIDE_TAU } from '../classic/src/sail/controls.js';

test('the sea-state gain scales the heights the boat floats on, bay and lake alike (feel x2.5 in the bay, x1.3 on the lake)', () => {
  const s = makeCpuSurface(), buf = new Float32Array(N * N * 3 * 4);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) buf[(j * N + i) * 4 + 1] = 0.5 * Math.sin(2 * Math.PI * 6 * (i + 0.5) / N);
  s.push(buf, 0);
  const x = 600 / 6 / 4, h1 = s.heightAt(x, 0, 0), h25 = s.heightAt(x, 0, 0, { feel: 2.5 }), h13 = s.heightAt(x, 0, 0, { feel: 1.3 });
  assert.ok(Math.abs(h25 / h1 - 2.5) < 1e-6 && Math.abs(h13 / h1 - 1.3) < 1e-6, `${(h25 / h1).toFixed(3)} and ${(h13 / h1).toFixed(3)}`);
});
test('the follow camera takes a third of the swell: 35 % of the heave and pitch, smoothed over 0.3 s', () => {
  assert.ok(CAM_RIDE >= 0.3 && CAM_RIDE <= 0.4, `${CAM_RIDE}`);
  assert.ok(CAM_RIDE_TAU > 0.1 && CAM_RIDE_TAU < 0.6);
});
test('the hull sounds grow with the sea: wash (chuckle, rush) up 80 % and 45 %, the slaps more often and up to 4 x louder, in a rough sea', () => {
  const run = (rough) => { const m = new BoatMix(); let last, slaps = []; for (let i = 0; i < 3600; i++) { const t = i / 60, s = { sog: 3.2, u: 3.2, pitch: 0.05 * Math.sin(2 * Math.PI * t / 2.5), seaRough: rough, apparentWind: { speed: 8 }, heel: 0.2 }; last = m.step(t, s); for (const e of last.events) if (e.kind === 'slap') slaps.push(e.gain); } return { g: last.gains, slaps }; };
  const calm = run(0), rough = run(1);
  assert.ok(rough.g.chuckle > calm.g.chuckle * 1.7 && rough.g.rush > calm.g.rush * 1.3, 'wash grows');
  assert.ok(calm.slaps.length >= 1 && rough.slaps.length > calm.slaps.length && Math.max(...rough.slaps) > Math.max(...calm.slaps) * 1.3, `slaps ${calm.slaps.length} x ${Math.max(...calm.slaps).toFixed(2)} -> ${rough.slaps.length} x ${Math.max(...rough.slaps).toFixed(2)}`);
});
