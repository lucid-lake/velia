// v2's sea and sailing against v1's (owner, 2026-11-13: "under the same wind, I feel the speed is slower and the tide is not big
// enough as v1"). v1 is the reference for the waves' size and motion: its two FFT sims (the lake's 25 km sea, the bay's 6 km sea),
// their Hs gain (1.3 × the fetch law), SEA_FEEL (× 1.3 lake, × 2.5 bay) and the per-point fetch mix (src/water.js,
// src/waters/ultra/gpuBridge.js, src/sim/waters/ultra/surface.js), here as v2/sim/spectrum.js composes them; the fetch traced on
// the same heights as v1's; the Sail wind's options (src/sail/options.js); and the sailing trace: v1's hull frame and film
// contract against v2's boat on the same wind, start and helm.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LENGTHS, N, CPU_CASCADES, hsLaw, seaWeights, seaTables, composeSea, bayShares, fetchAt, significantHeight, jonswapParams, omega, V1_SEA } from '../sim/spectrum.js';
import { sailWindOptions } from '../sim/wind.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createSurface, WINDOW_FLOATS } from '../sim/surface.js';
import { significantHeight as v1Law, fetchTrace, downwind } from '../../src/sim/water-spectrum.js';
import { sailCoreOptions } from '../../classic/src/sail/options.js';
import { parseFlags } from '../../src/sim/core/flags.js';
import { WindField } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const G = 9.81, rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-9);

test('the fetch law is v1\'s (water.js hsAt = water-spectrum.js significantHeight: 0.0016 U √(F/g), capped at 0.21 U²/g)', () => {
  for (const U of [0.5, 2, 5, 8, 12, 20]) for (const F of [50, 1000, 6000, 25000, 200000]) assert.ok(rel(hsLaw(U, F), v1Law(U, F)) < 1e-12, `${U} m/s, ${F} m`);
});

test('the point\'s weights: the open lake (m 1: the lake sim × 1.3) and the bay (m small: the bay sim × 2.5 × 0.9 sB)', () => {
  const lake = seaWeights({ U: 8, fetchM: 25000, x: 5000, z: -5000 });
  assert.ok(Math.abs(lake.m - 1) < 1e-9 && lake.beta === 0 && Math.abs(lake.feel - 1.3) < 1e-12);
  assert.deepEqual(lake.lake.map((v) => +v.toFixed(9)), [1.3, 1.3, 1.3, 1]); assert.equal(lake.bay, 0);
  const bay = seaWeights({ U: 8, fetchM: 1000, x: 1200, z: -1050 });
  assert.ok(Math.abs(bay.m - Math.sqrt(1 / 25)) < 1e-9 && bay.beta === 1 && bay.feel === 2.5);
  assert.ok(Math.abs(bay.bay - 2.5 * 0.9 * Math.sqrt(1 / 6)) < 1e-9, `bay weight ${bay.bay}`);
  assert.ok(bay.lake[1] === 0 && bay.lake[2] === 0 && bay.lake[3] === 1 && Math.abs(bay.lake[0] - 0.008 * 2.5) < 1e-9);
  // the open lake's swell through the mouth on a rough day (none under 9 m/s): beyond the mouth line it is the open lake's
  const calm = seaWeights({ U: 8, fetchM: 1000, x: 0, z: -2500 }), rough = seaWeights({ U: 14, fetchM: 1000, x: 0, z: -2500 });
  assert.ok(rough.m > calm.m + 0.3, `the swell lifts m on a rough day (${calm.m.toFixed(2)} → ${rough.m.toFixed(2)})`);
});

test('the composed sea: v1\'s Hs (the lake: 1.3 × 1.3 × the law at 25 km; the bay: 2.5 × 0.9 × 1.3 × the law at the point) and v1\'s wavelengths', () => {
  const T = seaTables({ speedMs: 8, travelRad: 0.4, seed: 1338 });
  const hsOf = (w) => significantHeight(composeSea(T, w), LENGTHS, CPU_CASCADES);
  const open = hsOf(seaWeights({ U: 8, fetchM: 25000, x: 5000, z: -5000 }));
  assert.ok(rel(open, 1.69 * hsLaw(8, 25000)) < 1e-4, `open lake Hs ${open.toFixed(3)} m vs v1's ${(1.69 * hsLaw(8, 25000)).toFixed(3)}`);
  for (const F of [500, 1370, 3000]) {
    const w = seaWeights({ U: 8, fetchM: F, x: 1200, z: -1050 }), want = Math.hypot(w.bay * T.gB * significantHeight(T.hB, LENGTHS, CPU_CASCADES), w.lake[0] * T.gL * significantHeight(T.hL, LENGTHS, 1));
    assert.ok(rel(hsOf(w), want) < 0.01, `bay ${F} m: Hs ${hsOf(w).toFixed(3)} vs ${want.toFixed(3)}`);
    assert.ok(rel(hsOf(w), 2.5 * 0.9 * 1.3 * hsLaw(8, F)) < 0.08, `bay ${F} m: ≈ 2.925 × the law (${(2.925 * hsLaw(8, F)).toFixed(3)})`);
  }
  // the bay's energy peaks at the 6 km JONSWAP's period, the open lake's at 25 km's
  const peakT = (h) => { const bins = new Map(); for (let c = 0; c < CPU_CASCADES; c++) { const dk = 2 * Math.PI / LENGTHS[c]; for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const o = ((c * N + y) * N + x) * 4, e = h[o] ** 2 + h[o + 1] ** 2; if (!e) continue; const b = Math.round(20 * 2 * Math.PI / omega(Math.hypot(x - 128, y - 128) * dk)) / 20; bins.set(b, (bins.get(b) ?? 0) + e); } } let bt = 0, be = 0; for (const [t, e] of bins) if (e > be) { be = e; bt = t; } return bt; };
  const tBay = peakT(composeSea(T, seaWeights({ U: 8, fetchM: 1000, x: 1200, z: -1050 }))), tLake = peakT(composeSea(T, seaWeights({ U: 8, fetchM: 25000, x: 5000, z: -5000 })));
  assert.ok(Math.abs(tBay - 2 * Math.PI / jonswapParams(8, 6).peakOmega) < 0.25, `bay peak ${tBay} s`);
  assert.ok(Math.abs(tLake - 2 * Math.PI / jonswapParams(8, 25).peakOmega) < 0.35, `lake peak ${tLake} s`);
  // the bay's energy share per tile, for the float's filters
  const sh = bayShares(T, seaWeights({ U: 8, fetchM: 1000, x: 1200, z: -1050 }));
  assert.ok(sh[1] > 0.99 && sh[2] > 0.99, `in the bay the 85 and 12 m tiles are the bay sim's (${sh.map((v) => v.toFixed(2))})`);
});

test('the hull\'s filters (v1\'s surface weights): the Smith effect per tile, no 12 m tile (v1\'s read-back), the bay\'s share', () => {
  const S = createSurface();
  // a window whose every texel lifts 1 m in each displacement tile: the height is the sum of the weights
  const f = new Float32Array(WINDOW_FLOATS); for (let i = 1; i < f.length; i += 4) f[i] = 1; S.adopt(f, { cx: 0, cz: 0, t: 0 });
  assert.ok(Math.abs(S.heightAt(0, 0) - 3) < 1e-6, 'no filters: the drawn surface');
  // #21: the hull never feels the 12 m tile (v1's read-back carries the 600 and 85 m tiles only)
  const d = 1.0, lake = Math.exp(-2 * Math.PI / 40 * d) + Math.exp(-2 * Math.PI / 6 * d);
  assert.ok(Math.abs(S.heightAt(0, 0, { depthM: d }) - lake) < 1e-6, 'the Smith effect, the lake\'s k per tile, no 12 m tile');
  assert.ok(Math.abs(S.heightAt(0, 0, { filterM: 2 }) - 2) < 1e-6, 'filterM 2 m: the 12 m tile is gone');
  S.setBayShares([0, 1, 1]);
  assert.ok(Math.abs(S.heightAt(0, 0, { depthM: d }) - (Math.exp(-2 * Math.PI / 40 * d) + Math.exp(-2 * Math.PI / 4 * d))) < 1e-6, 'the bay sim: its 4 m k, its 12 m tile never read on the CPU');
});

test('the fetch on v2\'s heights is v1\'s fetch on its shore map (the Sail start, the bay, the mouth, the open lake)', async () => {
  const { heightAt, shoreDistance } = await import('../../src/sim/terrain.js');
  for (const dirDeg of [200, 315]) {
    const dw = downwind(dirDeg);
    for (const [x, z] of [[1200, -1050], [600, -650], [1500, -800], [2500, -1500], [4000, -3000]]) {
      const v1 = fetchTrace(shoreDistance, x, z, dirDeg), v2 = fetchAt(heightAt, x, z, dw);
      assert.ok(Math.abs(v2 - v1) < Math.max(30, 0.03 * v1), `(${x}, ${z}) from ${dirDeg}°: v2 ${v2.toFixed(0)} m, v1 ${v1.toFixed(0)} m`);
    }
  }
});

test('the Sail wind\'s options are v1\'s (src/sail/options.js): the level, its reference, the first gust, the shifts, the cells', () => {
  for (const q of ['', 'wind=1', 'wind=4', 'nogust=1', 'windref=start', 'shifts=0', 'gustfx=0', 'start=900,-900&heading=200', 'fv=1', 'advisory=1&wind=2']) {
    const flags = parseFlags(new URLSearchParams(q));
    const want = sailCoreOptions(flags).wind(16);
    const S = { ...CURRENT_WATERS.start, ...(flags.start ? { x: +flags.start.split(',')[0], z: +flags.start.split(',')[1] } : {}), ...(flags.heading != null ? { headingDeg: +flags.heading } : {}) };
    assert.deepEqual(sailWindOptions(flags, { hour: 16, rate: 1, start: S }), want, q || '(default)');
  }
});

test('the sailing trace: v2\'s boat on v1\'s wind, start and film helm sails v1\'s hull frame\'s trace (40 s, the real terrain)', async () => {
  const { heightAt } = await import('../../src/sim/terrain.js');
  const { createHull } = await import('../../src/sim/craft/hull.js');
  const { CRAFTS } = await import('../../src/sim/craft/index.js');
  const { vesselDims } = await import('../../src/sim/boat/dims.js');
  const { CURRENT_VESSEL } = await import('../../src/sim/vessels/current.js');
  const { Helm, CONTROLS } = await import('../../src/sim/boat.js');
  const flags = parseFlags(new URLSearchParams('wind=3&air=0'));
  const START = CURRENT_WATERS.start;
  const wind = () => { const w = new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions(flags, { hour: 16, rate: 1, start: START }) }); w.setTerrain(heightAt); return w; };
  // a swell both read the same way (v1's water interface): 0.4 m, 18 m long, from the wind's side
  const sea = (x, z, t) => 0.2 * Math.sin(0.35 * (0.6 * x + 0.8 * z) - 1.85 * t);
  const water = { surface: { heightAt: (x, z, t) => sea(x, z, t) }, waveAt: (x, z, t) => { const e = 0.5, y = sea(x, z, t), gx = (sea(x + e, z, t) - sea(x - e, z, t)) / (2 * e), gz = (sea(x, z + e, t) - sea(x, z - e, t)) / (2 * e), inv = 1 / Math.sqrt(1 + gx * gx + gz * gz); return { y, nx: -gx * inv, nz: -gz * inv }; }, orbitAt: () => null };
  // v1: the hull frame (src/sim/craft/hull.js) and the capture's film step (src/craft/sloop/capture.js): the helm on the start heading each tick
  const core = { flags, headless: true, scene: null, camera: null, lum: 1, water, wake: null, wind: wind(), audio: null, SEED: 1, terrain: { heightAt } };
  const hull = createHull(core, { craft: CRAFTS.sloop, vessel: CURRENT_VESSEL, start: START, dims: vesselDims(CURRENT_VESSEL) });
  const helm = new Helm({ rudderMaxDeg: hull.phys.P.rudder.maxDeg }), h0 = START.headingDeg * Math.PI / 180;
  // v2: the boat sim on its own WindField (the same options) and the same water, the film contract
  let tt = 0;
  const B = createBoatSim({ water: waterFor((x, z) => sea(x, z, tt)), heightAt, wind: wind(), start: START, flags: {} });
  const rows = [];
  for (let k = 0; k < 40 * 60; k++) {
    const t = k / 60;
    hull.phys.step(1 / 60, { ...CONTROLS, rudder: helm.toHeading(hull.phys.state, h0) }, hull.env(t)); hull.ride.step(null, hull.phys.state, t + 1 / 60, 1 / 60);
    tt = t + 1 / 60; B.filmStep(1 / 60);
    if (k % 60 === 59) { const a = hull.phys.state, b = B.state; rows.push({ t: t + 1 / 60, sog: [a.sog, b.sog], heel: [a.heel, b.heel], hdg: [a.heading, b.heading], tws: [a.trueWind.speed, b.trueWind.speed], pitch: [hull.ride.wave.pitch, B.ride.wave.pitch], heave: [hull.ride.wave.heave, B.ride.wave.heave] }); }
  }
  const max = (k) => Math.max(...rows.map((r) => Math.abs(r[k][0] - r[k][1])));
  const KN = 0.514444, DEG = Math.PI / 180;
  assert.ok(max('tws') / KN < 0.05, `the true wind the boat feels: ${(max('tws') / KN).toFixed(3)} kn apart at most`);
  assert.ok(max('sog') / KN < 0.05, `SOG: ${(max('sog') / KN).toFixed(3)} kn apart at most (v1 ends ${(rows.at(-1).sog[0] / KN).toFixed(2)} kn)`);
  assert.ok(max('heel') / DEG < 0.2 && max('hdg') / DEG < 0.2, `heel ${(max('heel') / DEG).toFixed(3)}°, heading ${(max('hdg') / DEG).toFixed(3)}°`);
  assert.ok(max('pitch') / DEG < 0.2 && max('heave') < 0.01, `pitch ${(max('pitch') / DEG).toFixed(3)}°, heave ${max('heave').toFixed(4)} m`);
  assert.ok(rows.at(-1).sog[0] / KN > 3, 'she sails');
});
