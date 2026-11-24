// BACKLOG-v2 #21 (2026-11-14): the hull's wave motion is v1's. v1's recipe on its read-back surface
// (src/sim/waters/ultra/surface.js, src/water.js orbitAt, src/sim/boat/ride.js): the shallow-water calming (cascadeDamp: the
// long swell dies under 14 m, the chop under 2 m), the newest read carried forward along the last two reads' trend, and the
// waves' orbital velocity as a current on the hull; and v1's read-back carries no 12 m tile, so its hull never feels that chop. Here both engines' boats sail the same synthetic sea, fed to both read-back
// surfaces as the GPU would (one read every 1/30 s, a frame late) over a shelf from 22 m to 3 m and in deep water: v1's hull
// frame (src/sim/craft/hull.js) on v1's surface and water, v2's boat (v2/sim/boat.js) on v2's surface (v2/sim/surface.js) with the
// sea field's gains (v2/sim/seaField.js, before its first map: the depth's calm alone). The pitch, heave and roll RMS over 60 s
// must agree within ±15 % (the owner's tolerance); without the recipe v2's shallow-water motion falls outside it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createSurface, windowOrigin, LENGTHS, WINS, OFFSETS, WINDOW_FLOATS, N } from '../sim/surface.js';
import { createSeaField } from '../sim/seaField.js';
import { makeCpuSurface } from '../../src/sim/waters/ultra/surface.js';
import { parseFlags } from '../../src/sim/core/flags.js';
import { WindField } from '../../src/sim/wind.js';
import { sailWindOptions } from '../sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const DEG = Math.PI / 180, FS = 30;   // the reads' rate (Hz)
// the sea: a few long-crested trains per tile (the 600 m tile's swell, the 85 m tile's sea), choppy (λDx = −λ A cos along k)
const TRAINS = [
  [{ A: 0.22, L: 38, dir: 30 * DEG, ph: 0.3 }, { A: 0.12, L: 26, dir: 55 * DEG, ph: 1.9 }],
  [{ A: 0.10, L: 9.5, dir: 20 * DEG, ph: 2.2 }, { A: 0.07, L: 6.1, dir: 65 * DEG, ph: 4.1 }, { A: 0.05, L: 4.3, dir: 40 * DEG, ph: 0.7 }],
];
const LAMBDA = 0.85;
function texel(c, x, z, t, out, o) {
  let dx = 0, dy = 0, dz = 0;
  for (const w of TRAINS[c]) {
    const k = 2 * Math.PI / w.L, om = Math.sqrt(9.81 * k), kx = Math.cos(w.dir), kz = Math.sin(w.dir);
    const th = k * (kx * x + kz * z) - om * t + w.ph;
    dy += w.A * Math.sin(th); dx -= LAMBDA * w.A * Math.cos(th) * kx; dz -= LAMBDA * w.A * Math.cos(th) * kz;
  }
  out[o] = dx; out[o + 1] = dy; out[o + 2] = dz; out[o + 3] = 1;
}
// one read: v2's window layout (64² of the 600 and 85 m tiles round (cx, cz), the 12 m tile's chop) and v1's layered windows
// (the same 64² texels as layers 0 and 1), the field at each texel's world position
const v2buf = new Float32Array(WINDOW_FLOATS);
// the 12 m tile: short chop (tile-periodic, frozen: v1's read-back never carries it, so v1's hull cannot feel it; v2's hull must not)
{ const L = LENGTHS[2], base = OFFSETS[2] * 4;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = (i + 0.5) * L / N, z = (j + 0.5) * L / N, o = base + (j * N + i) * 4;
    const a = 2 * Math.PI * (2 * x + 1 * z) / L, b = 2 * Math.PI * (1 * x - 3 * z) / L;
    v2buf[o + 1] = 0.3 * Math.sin(a) + 0.2 * Math.sin(b); v2buf[o + 3] = 1;
  } }
function readAt(cx, cz, t) {
  const v1 = { layers: {} };
  for (let c = 0; c < 2; c++) {
    const L = LENGTHS[c], W = WINS[c], ox = windowOrigin(cx, L, N, W), oz = windowOrigin(cz, L, N, W), base = OFFSETS[c] * 4;
    for (let wz = 0; wz < W; wz++) for (let wx = 0; wx < W; wx++) texel(c, (ox + wx + 0.5) * L / N, (oz + wz + 0.5) * L / N, t, v2buf, base + (wz * W + wx) * 4);
    v1.layers[c] = { w: W, ox: ((ox % N) + N) % N, oz: ((oz % N) + N) % N, data: v2buf.slice(base, base + W * W * 4) };
  }
  return v1;
}

// the course: v1's Sail start heading over a shelf (depth falls from 22 m to 3 m along the first 200 m of the track), or deep
function run({ shelf, recipe = true, seconds = 60 }) {
  const START = { ...CURRENT_WATERS.start, x: 0, z: 0, headingDeg: 135, speed: 3 };
  const h0 = START.headingDeg * DEG, fx = Math.sin(h0), fz = -Math.cos(h0);
  const depthAt = (x, z) => (shelf ? Math.max(3, 22 - 19 * Math.max(0, (x * fx + z * fz) / 200)) : 400);
  const heightAt = (x, z) => -depthAt(x, z);
  const flags = parseFlags(new URLSearchParams('wind=3&air=0'));
  const wind = () => { const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions(flags, { hour: 13, rate: 1, start: START }) }); w.setTerrain(heightAt); return w; };
  // v1: its read-back surface with water.js's per-point opts (depth, m 1, the lake's feel 1: the trains carry the size)
  const s1 = makeCpuSurface();
  const o1 = (o, x, z) => ({ filterM: o?.filterM ?? 0, depthM: o?.depthM ?? 0, depth: depthAt(x, z), m: 1, bay: null, feel: 1 });
  const surf1 = { heightAt: (x, z, t, o) => s1.heightAt(x, z, t, o1(o, x, z)) };
  const water1 = { surface: surf1,
    waveAt: (x, z, t, { filterM = 0 } = {}) => { const d = 0.5, o = { filterM }, y = surf1.heightAt(x, z, t, o), gx = (surf1.heightAt(x + d, z, t, o) - surf1.heightAt(x - d, z, t, o)) / (2 * d), gz = (surf1.heightAt(x, z + d, t, o) - surf1.heightAt(x, z - d, t, o)) / (2 * d), inv = 1 / Math.sqrt(1 + gx * gx + gz * gz); return { y, nx: -gx * inv, nz: -gz * inv }; },
    orbitAt: (x, z, t, o = {}) => { const v = s1.velocityAt(x, z, t, o1(o, x, z)); return { vx: v[0], vz: v[1] }; } };
  // v2: its read-back surface, the sea field's gains (no map: the depth's calm), the wave clock
  const s2 = createSurface(), field = createSeaField({ heightAt });
  if (recipe) s2.setGains((x, z, out) => field.gainsAt(x, z, depthAt(x, z), out));
  let clockT = 0;
  const water2 = recipe ? waterFor((x, z, o) => s2.heightAt(x, z, o), { velocityAt: (x, z, o, out) => s2.velocityAt(x, z, o, out), now: () => clockT }) : waterFor((x, z, o) => s2.heightAt(x, z, o));
  return import('../../src/sim/craft/hull.js').then(async ({ createHull }) => {
    const { CRAFTS } = await import('../../src/sim/craft/index.js');
    const { vesselDims } = await import('../../src/sim/boat/dims.js');
    const { CURRENT_VESSEL } = await import('../../src/sim/vessels/current.js');
    const { Helm, CONTROLS } = await import('../../src/sim/boat.js');
    const core = { flags, headless: true, scene: null, camera: null, lum: 1, water: water1, wake: null, wind: wind(), audio: null, SEED: 1, terrain: { heightAt } };
    const hull = createHull(core, { craft: CRAFTS.sloop, vessel: CURRENT_VESSEL, start: START, dims: vesselDims(CURRENT_VESSEL) });
    const helm = new Helm({ rudderMaxDeg: hull.phys.P.rudder.maxDeg });
    const B = createBoatSim({ water: water2, heightAt, wind: wind(), start: START, flags: {} });
    const rows = { v1: [], v2: [] };
    let pending = null;   // the read in flight: submitted at one frame, adopted at the next (the GPU's lag)
    for (let k = 0; k < seconds * 60; k++) {
      const t = k / 60;
      if (k % 2 === 0) {   // a read every 1/30 s round the boat; the one before lands now
        if (pending) { s1.pushWindow(pending.v1, pending.t); s2.adopt(pending.v2, { cx: pending.cx, cz: pending.cz, t: pending.t }); }
        const st = B.state, v1 = readAt(st.x, st.z, t);
        pending = { v1, v2: v2buf.slice(), cx: st.x, cz: st.z, t };
      }
      clockT = t + 1 / 60;
      hull.phys.step(1 / 60, { ...CONTROLS, rudder: helm.toHeading(hull.phys.state, h0) }, hull.env(t)); hull.ride.step(null, hull.phys.state, t + 1 / 60, 1 / 60);
      B.filmStep(1 / 60);
      if (k >= 120) { const a = hull.ride.wave, b = B.ride.wave; rows.v1.push([a.pitch / DEG, a.heave, a.roll / DEG]); rows.v2.push([b.pitch / DEG, b.heave, b.roll / DEG]); }
    }
    const rms = (rs, i) => { const m = rs.reduce((s, r) => s + r[i], 0) / rs.length; return Math.sqrt(rs.reduce((s, r) => s + (r[i] - m) ** 2, 0) / rs.length); };
    const out = {};
    for (const [i, q] of ['pitch', 'heave', 'roll'].entries()) out[q] = { v1: rms(rows.v1, i), v2: rms(rows.v2, i), ratio: rms(rows.v2, i) / rms(rows.v1, i) };
    out.depthEnd = depthAt(B.state.x, B.state.z); out.sog = [hull.phys.state.sog, B.state.sog];
    return out;
  });
}

const show = (r) => ['pitch', 'heave', 'roll'].map((q) => `${q} ${r[q].ratio.toFixed(3)}`).join(', ');
test('the hull\'s wave motion: v2 within ±15 % of v1 (pitch, heave, roll RMS over 60 s) on a shallow approach and in deep water', async (t) => {
  for (const shelf of [true, false]) {
    const r = await run({ shelf });
    t.diagnostic(`${shelf ? 'shallow' : 'deep'}: ${show(r)}`);
    for (const q of ['pitch', 'heave', 'roll']) assert.ok(r[q].ratio > 0.85 && r[q].ratio < 1.15, `${shelf ? 'shallow' : 'deep'}: ${q} v2/v1 ${r[q].ratio.toFixed(3)} (${show(r)})`);
    assert.ok(r.sog[1] > 1.5, 'she sails');
    if (shelf) assert.ok(r.depthEnd < 6, `the course crosses the shelf (ends over ${r.depthEnd.toFixed(1)} m)`);
  }
});

test('the recipe matters: without the calming, the carry-forward and the orbital current, v2\'s shallow-water motion leaves the ±15 % band', async (t) => {
  const r = await run({ shelf: true, recipe: false });
  t.diagnostic(`before: ${show(r)}`);
  assert.ok(['pitch', 'heave', 'roll'].some((q) => r[q].ratio > 1.15), `before: ${show(r)}`);
});
