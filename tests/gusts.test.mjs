// D1 gust legibility and the first gust line (src/wind.js firstGustFor, src/water-spectrum.js gustVisual).
// Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindField, firstGustFor } from '../src/sim/wind.js';
import { gustVisual, GUST_EDGE } from '../src/sim/water-spectrum.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { START, FIRST_GUST } from '../classic/src/modes/daysail/index.js';

const DEG = Math.PI / 180;
const day18 = (firstGust) => new WindField({ seed: 1, day: { hour: 18, rate: 1 }, firstGust });

test('first gust: placed ahead of the start pose, slightly off the bow, deterministic', () => {
  for (const hd of [10, 345]) {
    const fg = firstGustFor({ x: 0, z: 1100, headingDeg: hd });
    const fx = Math.sin(hd * DEG), fz = -Math.cos(hd * DEG);
    const dx = fg.x, dz = fg.z - 1100;
    const ahead = dx * fx + dz * fz, side = dx * -fz + dz * fx;     // side > 0: starboard
    assert.ok(ahead >= 140 && ahead <= 200, `centre ${ahead.toFixed(0)} m ahead`);
    const bearing = Math.atan2(side, ahead) / DEG;
    assert.ok(bearing > 5 && bearing < 25, `centre ${bearing.toFixed(1)}° off the bow (starboard)`);
    assert.deepEqual(firstGustFor({ x: 0, z: 1100, headingDeg: hd }), fg);
  }
  assert.ok(firstGustFor({ headingDeg: 10, side: -1 }).x < firstGustFor({ headingDeg: 10 }).x, 'side −1 puts it to port');
});

test('first gust: a real gust in the field (sample and toTexture agree), ≈ +30 % at its core, none far away, gone after its life', () => {
  const fg = firstGustFor({ x: 0, z: 1100, headingDeg: 10 });
  const a = day18(fg), b = day18(null);
  const core = a.sample(fg.x, fg.z, 0).speed / b.sample(fg.x, fg.z, 0).speed;
  assert.ok(Math.abs(core - (1 + fg.gain)) < 1e-9, `core × ${core.toFixed(3)}`);
  assert.equal(a.sample(fg.x + 600, fg.z - 600, 0).speed, b.sample(fg.x + 600, fg.z - 600, 0).speed);
  assert.equal(a.sample(fg.x, fg.z, fg.holdS + fg.fadeS + 1).speed, b.sample(fg.x, fg.z, fg.holdS + fg.fadeS + 1).speed);
  // the visible edge is a line, not a blur: from 90 % to 10 % of the gain within ≈ 2.5 edge widths
  const prof = [];
  for (let d = 0; d <= 300; d += 5) prof.push([d, a.firstGustAt(fg.x, fg.z + d, 0) - 1]);   // across ≈ along the wind (south)
  const at = (f) => prof.find(([, v]) => v < f * fg.gain)[0];
  assert.ok(at(0.1) - at(0.9) <= 2.5 * fg.edgeM, `edge ${at(0.9)}–${at(0.1)} m`);
  // the texture the water reads has it too: compare the texel at the core with sample()
  const N = 64, E = 2048, cx = 0, cz = 1024, tex = a.toTexture(N, E, 0, cx, cz), cell = E / N;
  const i = Math.floor((fg.x - (cx - E / 2)) / cell), j = Math.floor((fg.z - (cz - E / 2)) / cell);
  const x = cx - E / 2 + (i + 0.5) * cell, z = cz - E / 2 + (j + 0.5) * cell, p = j * N + i;
  assert.ok(Math.abs(Math.hypot(tex[2 * p], tex[2 * p + 1]) - a.sample(x, z, 0).speed) < 1e-3);
});

test('first gust: the boat sailing the default start meets it at 20–40 s of scene time (10–20 s at 2×)', async () => {
  const { BoatPhysics, CONTROLS, Helm } = await import('../src/sim/boat.js');
  // the default start pose (START in src/modes/daysail/index.js) and its gust line, on the real terrain's wind
  const fg = firstGustFor({ x: START.x, z: START.z, headingDeg: START.headingDeg, ...FIRST_GUST }), w = day18(fg);
  w.setTerrain(makeTerrain({ seed: 1 }).heightAt);
  const H = START.headingDeg * DEG, p = new BoatPhysics({ x: START.x, z: START.z, heading: H, speed: START.speed }), helm = new Helm();
  const env = (t) => ({ t, windAt: (x, z, tt) => { const s = w.sample(x, z, tt); return { vx: s.vx, vz: s.vz }; } });
  let met = null;
  for (let i = 0; i < 80 * 60 && met == null; i++) {
    const t = i / 60;
    if (w.firstGustAt(p.state.x, p.state.z, t) - 1 > 0.5 * fg.gain) met = t;
    p.step(1 / 60, { ...CONTROLS, rudder: helm.toHeading(p.state, H) }, env(t));
  }
  // met (half the gain) a few seconds before the surge peaks (tests/discoveries: found at 25–50 s)
  assert.ok(met != null && met >= 20 && met <= 40, `met at ${met?.toFixed(1)} s`);
});

test('gust look: maps the local wind over the mean, monotonic, a definite edge, true at dusk', () => {
  for (const U of [1.3, 3.7, 8.8]) {
    assert.equal(gustVisual(U, U), 0, `the mean wind reads as plain water at ${U} m/s`);
    assert.equal(gustVisual(0.7 * U, U), 0, 'a lull never reads as a gust');
    let prev = -1;
    for (let r = 0.8; r <= 1.8; r += 0.01) { const v = gustVisual(r * U, U); assert.ok(v >= prev - 1e-12, `monotonic at ${r.toFixed(2)}`); prev = v; }
    // the edge: most of the look arrives between +3 % and +18 %
    assert.ok(gustVisual(GUST_EDGE[1] * U, U) >= 0.69 * gustVisual(1.6 * U, U), 'the step carries most of it');
    assert.ok(gustVisual(1.6 * U, U) > gustVisual(1.3 * U, U), 'a harder gust reads darker');
  }
  // dusk: a cat's paw of 1.7 m/s on a 1.3 m/s mean still reads; under the capillary onset nothing does
  assert.ok(gustVisual(1.7, 1.3) > 0.6);
  assert.equal(gustVisual(0.55, 0.4), 0);
});
