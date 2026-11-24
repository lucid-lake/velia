// The hull's buoyancy: natural periods of a 28 ft keelboat, a long swell lifts it, short chop is
// bridged, a beam sea rolls it, the lake spectrum moves it by readable amounts, deterministic.
//   node --test tests/float.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HullFloat } from '../src/sim/boat/float.js';
import { makeSurface } from '../src/sim/water-spectrum.js';

// one plane wave travelling along +x: η = a·sin(k x − ω t), with the Smith effect for a hull at depthM
const swell = (lambda, a) => {
  const k = 2 * Math.PI / lambda, w = Math.sqrt(9.81 * k);
  return { heightAt: (x, z, t, { depthM = 0 } = {}) => a * Math.sin(k * x - w * t) * Math.exp(-k * depthM) };
};
const run = (float, boat, T = 60, dt = 1 / 60) => {
  const out = [];
  for (let t = 0; t < T; t += dt) out.push(float.update(boat, t, dt));
  return out;
};
const range = (xs) => Math.max(...xs) - Math.min(...xs);
const DEG = 180 / Math.PI;

test('natural periods: heave 1.3–1.6 s, pitch 1.3–1.7 s, roll 2.5–3.6 s (strip-theory estimates for the Catalina 28)', () => {
  const f = new HullFloat({ surface: { heightAt: () => 0 } });
  const T = f.periods();
  assert.ok(T.heave > 1.3 && T.heave < 1.6, `heave ${T.heave.toFixed(2)} s`);
  assert.ok(T.pitch > 1.3 && T.pitch < 1.7, `pitch ${T.pitch.toFixed(2)} s`);
  assert.ok(T.roll > 2.5 && T.roll < 3.6, `roll ${T.roll.toFixed(2)} s`);
  assert.ok(f.area > 13 && f.area < 16, `waterplane ${f.area.toFixed(1)} m² (Cwp ≈ 0.72 × 7.26 × 2.71)`);
  // a free decay from a displaced pose rings at those periods and dies away
  f.update({ x: 0, z: 0, heading: 0 }, 0, 1 / 60);
  f.state.heave = 0.2; f.state.pitch = 0.1; f.state.roll = 0.1;
  const dec = run(f, { x: 0, z: 0, heading: 0 }, 12);
  const crossings = (q) => { const z = []; for (let i = 1; i < dec.length; i++) if (dec[i - 1][q] > 0 && dec[i][q] <= 0) z.push(i / 60); return z; };
  for (const q of ['heave', 'pitch', 'roll']) {
    const c = crossings(q);
    assert.ok(c.length >= 2, `${q} rings`);
    assert.ok(Math.abs(c[1] - c[0] - T[q]) < 0.12 * T[q], `${q} decay period ${(c[1] - c[0]).toFixed(2)} s vs ${T[q].toFixed(2)} s`);
  }
  const last = dec.at(-1);
  assert.ok(Math.abs(last.heave) < 0.005 && Math.abs(last.pitch) < 0.003 && Math.abs(last.roll) < 0.01, 'the decay dies away');
});

test('a long swell (60 m) lifts the hull nearly its full height and pitches it head-on; no roll', () => {
  const a = 0.5, f = new HullFloat({ surface: swell(60, a) });
  const out = run(f, { x: 0, z: 0, heading: Math.PI / 2 }).slice(1200);   // bow east, into the waves' direction
  assert.ok(range(out.map((o) => o.heave)) > 1.8 * a, `heave range ${range(out.map((o) => o.heave)).toFixed(3)} m`);
  assert.ok(range(out.map((o) => o.pitch)) > 0.08, 'it pitches');
  assert.ok(range(out.map((o) => o.roll)) < 1e-6, 'no roll with the swell head-on');
});

test('beam-on, a 20 m swell rolls it (the effective wave slope against Δ·GM) and does not pitch it', () => {
  const f = new HullFloat({ surface: swell(20, 0.3) });
  const out = run(f, { x: 0, z: 0, heading: 0 }).slice(1200);   // bow north, swell from the west: beam-on
  assert.ok(range(out.map((o) => o.roll)) > 0.1, `roll range ${range(out.map((o) => o.roll)).toFixed(4)} rad`);
  assert.ok(range(out.map((o) => o.pitch)) < 1e-6);
});

test('the hull bridges chop: 1.5 m waves move it under 3 % of their height, 4 m under 15 %, 10 m over 40 %', () => {
  const resp = (lam) => {
    const a = 0.1, f = new HullFloat({ surface: swell(lam, a) });
    const out = run(f, { x: 3, z: 0, heading: Math.PI / 2 }, 40).slice(900);
    return range(out.map((o) => o.heave)) / (2 * a);
  };
  assert.ok(resp(1.5) < 0.03, `λ 1.5 m: ${resp(1.5).toFixed(3)}`);
  assert.ok(resp(4) < 0.15, `λ 4 m: ${resp(4).toFixed(3)}`);
  assert.ok(resp(10) > 0.4, `λ 10 m: ${resp(10).toFixed(3)}`);
});

test('on the lake at 20 kn over 2 km (Hs 0.24 m): pitch 2–8°, heave 4–20 cm, roll 1–6°; at 650 m of fetch under 1°', () => {
  const sea = (F) => {
    const surf = makeSurface({ U: 10.3, dirDeg: 200, fetchAt: () => F });
    const out = run(new HullFloat({ surface: surf }), { x: 100, z: 200, heading: -0.7 }, 90).slice(1200);
    return { heave: range(out.map((o) => o.heave)), pitch: range(out.map((o) => o.pitch)) * DEG, roll: range(out.map((o) => o.roll)) * DEG };
  };
  const far = sea(2000), near = sea(650);
  assert.ok(far.pitch > 2 && far.pitch < 8, `pitch ${far.pitch.toFixed(2)}°`);
  assert.ok(far.heave > 0.04 && far.heave < 0.2, `heave ${far.heave.toFixed(3)} m`);
  assert.ok(far.roll > 1 && far.roll < 6, `roll ${far.roll.toFixed(2)}°`);
  assert.ok(near.pitch < 1, `short fetch pitch ${near.pitch.toFixed(2)}°`);
});

test('bounded, finite, deterministic; calm water stays level; the probes are the hull patches', () => {
  const surf = makeSurface({ U: 12, dirDeg: 315, fetchAt: () => 2000 });
  const a = run(new HullFloat({ surface: surf }), { x: 100, z: 200, heading: 0.7 }, 120);
  const b = run(new HullFloat({ surface: surf }), { x: 100, z: 200, heading: 0.7 }, 120);
  for (const o of a) {
    assert.ok(Number.isFinite(o.heave) && Math.abs(o.heave) < 0.5, `heave ${o.heave}`);
    assert.ok(Math.abs(o.pitch) < 0.2 && Math.abs(o.roll) < 0.2, `pitch ${o.pitch} roll ${o.roll}`);
  }
  assert.deepEqual(a.map((o) => o.heave), b.map((o) => o.heave));
  assert.equal(a[0].probes.length, 21);
  const calm = run(new HullFloat({ surface: makeSurface({ U: 0.5, fetchAt: () => 2000 }) }), { x: 0, z: 0, heading: 0 }, 30);
  assert.ok(Math.max(...calm.map((o) => Math.abs(o.heave))) < 0.01);
});

test('the CPU surface inverts the Gerstner shift: a displaced rest point reads its own height (within 2 mm)', async () => {
  const { bands, downwind, peakFrequency, significantHeight, bandWeight, tailGain, STEEP_MAX } = await import('../src/sim/water-spectrum.js');
  const U = 12, dirDeg = 315, F = 2000, surf = makeSurface({ U, dirDeg, fetchAt: () => F });
  // the vertex shader's forward map, written out independently
  const B = bands(1), geo = B.filter((b) => b.kind === 'geometry');
  const fp = peakFrequency(U, F), hs = significantHeight(U, F);
  const scale = (hs / 4) * Math.sqrt(2 / B.reduce((s, b) => s + bandWeight(b, fp), 0));
  const a = geo.map((b) => scale * Math.sqrt(bandWeight(b, fp)) * tailGain(b.f, fp, U));
  const [dx, dz] = downwind(dirDeg), base = Math.atan2(dz, dx);
  const steep = Math.min(STEEP_MAX / geo.reduce((s, b, i) => s + a[i] * b.k, 0), 1);
  let worst = 0;
  for (let n = 0; n < 200; n++) {
    const px = n * 13.7 - 900, pz = n * 7.3 - 400, t = n * 0.37;
    let x = px, z = pz, h = 0;
    geo.forEach((b, i) => {
      const ux = Math.cos(base + b.offsetRad), uz = Math.sin(base + b.offsetRad);
      const th = b.k * (ux * px + uz * pz) - b.omega * t + b.phase;
      x += steep * a[i] * ux * Math.cos(th); z += steep * a[i] * uz * Math.cos(th); h += a[i] * Math.sin(th);
    });
    worst = Math.max(worst, Math.abs(surf.heightAt(x, z, t) - h));
  }
  assert.ok(worst < 0.002, `worst ${(worst * 1000).toFixed(2)} mm`);
});
