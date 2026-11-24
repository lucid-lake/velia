// #56 M1, the water's surface (render/water-surface.js, sim/spectrum.js FADES): v1's short-wave fades and slope gain,
// v1's modulation transfer, Ultra-Water's foam erosion with age. Behaviour only: the modules' outputs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FADES, seaTables, buildH0, spectrumFor, LENGTHS, N } from '../sim/spectrum.js';
import { SURF, slopeBoost, modulate, nearRay, foamCover, foamDensity, foamWind, capCover, turbStep, foamLace, monahan, whitecapJ0, foldCell, whitecapJ0Field, capShare, J0_HIST, j0Glide, foldGate, crestPhase, crestBacklit } from '../render/water-surface.js';

const NN = N * N;
const tileEnergy = (h0, c) => { let v = 0; for (let i = c * NN * 4, e = i + NN * 4; i < e; i++) v += h0[i] * h0[i]; return v; };

test('the short-wave fades are v1\'s (src/waters/ultra/gpuBridge.js: 0.012 on the displacement tiles, 0.015 on the 2.1 m tile)', () => {
  assert.deepEqual({ ...FADES.v1 }, { short: 0.012, capillary: 0.015 });
  assert.deepEqual({ ...FADES.m5c }, { short: 0.025, capillary: 0.05 });
  // the default table is the one built with v1's pair, bit for bit
  const a = seaTables({ speedMs: 4, travelRad: 0.3 }), b = seaTables({ speedMs: 4, travelRad: 0.3, fades: { short: 0.012, capillary: 0.015 } });
  assert.deepEqual(a.hL, b.hL); assert.deepEqual(a.hB, b.hB);
  // and the 2.1 m tile's table is buildH0's with lastFade 0.015
  const sp = spectrumFor({ speedMs: 4, travelRad: 0.3, fetchKm: 25 });
  const h = buildH0({ A: sp.A, B: sp.B, seed: 1337, lastFade: 0.015 });
  for (let i = 3 * NN * 4; i < 3 * NN * 4 + 4096; i++) assert.equal(a.hL[i], h[i]);
});

test('v1\'s fades keep more of the short waves; the sea\'s height (the gain to the Hs law) is unchanged', () => {
  const v1 = seaTables({ speedMs: 4, travelRad: 0 }), old = seaTables({ speedMs: 4, travelRad: 0, fades: FADES.m5c });
  // the 2.1 m tile (ripples, slopes only): more energy under the gentler fade
  assert.ok(tileEnergy(v1.hL, 3) > 1.5 * tileEnergy(old.hL, 3), `${tileEnergy(v1.hL, 3)} vs ${tileEnergy(old.hL, 3)}`);
  // Hs over the displacement tiles after the gain: the law's, whichever fade
  const hs = (T) => { let v = 0; for (let c = 0; c < 3; c++) v += tileEnergy(T.hL, c); return 4 * Math.sqrt(v) * T.gL; };
  assert.ok(Math.abs(hs(v1) - hs(old)) < 1e-3 * hs(old), `${hs(v1)} vs ${hs(old)}`);
  assert.equal(LENGTHS.length, 4);
});

test('the slope gain is v1\'s BAY_SLOPE (2) on the bay sim\'s share of the tile, the same energy', () => {
  assert.equal(SURF.baySlope, 2);
  assert.equal(slopeBoost(1), 2);
  assert.equal(slopeBoost(0), 1);
  // a tile holding lake energy eL and bay energy eB: v1 draws lake + 2 × bay, so its slope energy is eL + 4 eB
  for (const [eL, eB] of [[1, 0], [0, 1], [3, 1], [1, 3], [0.2, 0.05]]) {
    const s = eB / (eL + eB), want = Math.sqrt((eL + 4 * eB) / (eL + eB));
    assert.ok(Math.abs(slopeBoost(s) - want) < 1e-12, `${eL}, ${eB}: ${slopeBoost(s)} vs ${want}`);
  }
  assert.equal(slopeBoost(-1), 1); assert.equal(slopeBoost(2), 2);   // shares clamp to 0–1
  // the 85 m tile drawn at v1's gain; the 12 m tile's at 1.5 (the flicker gate, v2/notes/water.md), never above v1's
  assert.equal(SURF.tileSlope[0], SURF.baySlope);
  assert.ok(SURF.tileSlope[1] > 1 && SURF.tileSlope[1] <= SURF.baySlope);
  assert.equal(slopeBoost(1, SURF.tileSlope[1]), SURF.tileSlope[1]);
});

test('the modulation transfer is v1\'s: 1 + 2.2 η / Hs, clamped to 0.35–2.2', () => {
  assert.equal(modulate(0, 0.4), 1);
  assert.ok(Math.abs(modulate(0.1, 0.4) - 1.55) < 1e-12);
  assert.equal(modulate(1, 0.4), 2.2);
  assert.equal(modulate(-1, 0.4), 0.35);
  assert.equal(modulate(0.01, 0), modulate(0.01, 0.03));   // Hs floored at 3 cm
});

test('the mirror follows the pixel\'s own normal only where the footprint resolves the ripples', () => {
  assert.equal(nearRay(0.005), 1);
  assert.equal(nearRay(0.5), 0);
  assert.ok(nearRay(0.05) > 0 && nearRay(0.05) < 1);
});

// the foam's pattern: the JS twin of the bake's lace channel over a grid of one tile
const PAT = (() => { const n = 64, p = new Float64Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) p[j * n + i] = foamLace((i + 0.5) / n, (j + 0.5) / n); return p; })();
test('the erosion: cover grows with the density, and a texel\'s cover is never above √density', () => {
  for (const p of [0.1, 0.4, 0.7, 0.95]) { let last = 0; for (let d = 0; d <= 1.0001; d += 0.05) { const c = foamCover(d, p); assert.ok(c >= last - 1e-12 && c <= Math.sqrt(d) + 1e-12); last = c; } }
  assert.equal(foamCover(0, 0.9), 0);
});

test('the foam pattern is a tileable lace (0–1, every value used)', () => {
  let lo = 1, hi = 0, m = 0; for (const p of PAT) { lo = Math.min(lo, p); hi = Math.max(hi, p); m += p; }
  assert.ok(lo >= 0 && hi <= 1 && hi - lo > 0.5, `${lo}–${hi}`);
  m /= PAT.length; assert.ok(m > 0.2 && m < 0.7, `mean ${m}`);
  // tileable: the edges meet (u = 0 and u = 1 are the same texel)
  for (const v of [0.13, 0.5, 0.91]) assert.ok(Math.abs(foamLace(0, v) - foamLace(1, v)) < 1e-9);
});

test('the foam ages and erodes: young foam nearly solid, then a thinning lace, then gone; each older cover inside the younger', () => {
  // one fold at a wind of 11 m/s (the turbulence down to 0.62, a lake's deepest at wind 4, under J0 = 0.70), then the crest
  // passes (J = 1): the turbulence recovers at M1's rate
  const dt = 1 / 120, rec = SURF.foamRec, j0 = 0.70;
  let turb = turbStep(1, 0.62, dt, rec);
  const covers = [], dens = [];
  for (let s = 0; s <= 240; s++) {
    if (s % 12 === 0) { const d = foamDensity(turb, j0); dens.push(d); covers.push(PAT.map((p) => capCover(turb, j0, 11, p))); }
    turb = turbStep(turb, 1, dt, rec);
  }
  const area = covers.map((c) => c.reduce((s, x) => s + x, 0) / c.length);
  for (let i = 1; i < area.length; i++) assert.ok(area[i] <= area[i - 1] + 1e-12, `area ${area.map((x) => x.toFixed(3)).join(' ')}`);
  for (let i = 1; i < dens.length; i++) assert.ok(dens[i] <= dens[i - 1]);
  assert.ok(area[0] > 0.45, `young foam covers ${area[0].toFixed(3)}`);
  assert.equal(area.at(-1), 0, 'gone after 2 s');
  // erosion, not fading: every texel's cover only falls with age (the holes open where the pattern is low)
  for (let i = 1; i < covers.length; i++) for (let k = 0; k < PAT.length; k++) assert.ok(covers[i][k] <= covers[i - 1][k] + 1e-12);
  // mid-life foam is lace: what stays covered is the pattern's high part
  const mid = covers.findIndex((c, i) => area[i] < 0.5 * area[0] && area[i] > 0);
  assert.ok(mid > 0, 'a mid-life frame');
  let pc = 0, wc = 0; covers[mid].forEach((c, k) => { pc += c * PAT[k]; wc += c; });
  const meanP = PAT.reduce((s, p) => s + p, 0) / PAT.length;
  assert.ok(pc / wc > meanP + 0.1, `covered pattern ${(pc / wc).toFixed(3)} vs mean ${meanP.toFixed(3)}`);
});

test('whitecap coverage stays driven by the local wind (v1\'s rule): Monahan\'s share sets the fold threshold, none under 4 m/s', () => {
  // Monahan & O'Muircheartaigh 1980: ≈ 0.4 % at 15 kn, ≈ 1.1 % at 20 kn
  assert.ok(Math.abs(monahan(15 * 0.5144) - 0.0042) < 0.0005, `${monahan(7.7)}`);
  assert.ok(Math.abs(monahan(20 * 0.5144) - 0.011) < 0.001, `${monahan(10.3)}`);
  // J0 is the quantile: that share of the turbulence falls under it
  const vals = Float32Array.from({ length: 4096 }, (_, i) => 0.6 + 0.4 * ((i * 2654435761) % 4096) / 4096);
  for (const U of [6, 8, 11]) { const v = vals.slice(), j = whitecapJ0(v, U, 1); const under = vals.filter((x) => x < j).length / vals.length; assert.ok(Math.abs(under - monahan(U)) < 1 / 2048, `${U}: ${under}`); }
  { const j = whitecapJ0(vals.slice(), 11); const under = vals.filter((x) => x < j).length / vals.length; assert.ok(Math.abs(under - SURF.coverK * monahan(11)) < 1 / 2048); }
  // stronger wind, higher threshold, more foam
  assert.ok(whitecapJ0(vals.slice(), 11) > whitecapJ0(vals.slice(), 6));
  // the onset: none under 4 m/s, all from 8
  assert.equal(foamWind(3.9), 0); assert.equal(foamWind(8), 1); assert.ok(foamWind(6) > 0 && foamWind(6) < 1);
  // no foam without a fold under J0
  assert.equal(capCover(0.8, 0.7, 11, 0.9), 0);
  assert.ok(capCover(0.6, 0.7, 11, 0.9) > 0.5);
});

test('the turbulence follows a fold down at once and recovers at its rate (the foam\'s age)', () => {
  assert.equal(turbStep(0.2, 0.1, 1, 0.7), 0.1);
  assert.ok(Math.abs(turbStep(0.2, 1, 0.1, 0.7) - (0.2 + 0.07)) < 1e-12);
});

test('the whitecaps read the 12 m tile through world cells: its copies no longer fold in step on a 12 m lattice', () => {
  // points one tile apart read the same tile texel on the plain tile; through the cells, almost never
  let same = 0, n = 0, inside = 0;
  for (let i = 0; i < 400; i++) {
    const x = 37.3 * i - 4000, z = 23.9 * ((i * 7) % 113) - 1300;
    for (const [dx, dz] of [[12, 0], [0, 12], [24, 12], [-36, 48]]) {
      const a = foldCell(x, z), b = foldCell(x + dx, z + dz);
      n++; if (Math.hypot(a.u - b.u, a.v - b.v) < 0.5) same++;
    }
    if (foldCell(x, z).weight === 1) inside++;
  }
  assert.ok(same / n < 0.03, `${same} of ${n} lattice neighbours read the same place`);
  // the edge fade leaves most of each cell at full weight, and a cell's edge at none
  assert.ok(inside / 400 > 0.6, `${inside} of 400 inside`);
  const a = foldCell(0, 0), c = SURF.foldCell, cr = Math.cos(SURF.foldRot), sr = Math.sin(SURF.foldRot);
  // inside one cell the place moves with the point (the fold keeps its shape), and a cell edge weighs 0
  const q = (u, v) => [c * (cr * u + sr * v), c * (-sr * u + cr * v)];   // the cells' frame back to the world
  const [x1, z1] = q(0.3, 0.4), [x2, z2] = q(0.6, 0.55), [xe, ze] = q(1, 0.5);
  const p1 = foldCell(x1, z1), p2 = foldCell(x2, z2);
  assert.equal(p1.cell, p2.cell);
  const du = ((p2.u - p1.u - (x2 - x1)) % 12 + 18) % 12 - 6, dv = ((p2.v - p1.v - (z2 - z1)) % 12 + 18) % 12 - 6;
  assert.ok(Math.abs(du) < 1e-9 && Math.abs(dv) < 1e-9);
  assert.ok(foldCell(xe, ze).weight < 1e-6);
  void a;
});

test('the whitecaps\' J0 is the whole tile\'s own quantile at the caps\' share, read in one pass, glided to', () => {
  // a 256² tile in channel 3 of RGBA texels after an offset; the share under the J0 it returns is the share asked
  const o = 40, f = new Float32Array(o + 65536 * 4), hist = new Uint32Array(J0_HIST.bins);
  for (let i = 0; i < 65536; i++) f[o + i * 4 + 3] = 0.55 + 0.6 * (((i * 2654435761) >>> 0) % 65536) / 65536;
  for (const share of [0.001, 0.004, 0.02]) {
    const j = whitecapJ0Field(f, o, 65536, 4, share, hist);
    let under = 0; for (let i = 0; i < 65536; i++) if (f[o + i * 4 + 3] < j) under++;
    assert.ok(Math.abs(under / 65536 - share) < 0.15 * share + 2e-4, `${share}: ${under / 65536}`);
  }
  // the share rises with the wind, as tuned at 7.7 m/s
  assert.ok(capShare(10) > capShare(7.7) && capShare(7.7) > capShare(5.5));
  assert.ok(Math.abs(capShare(7.7) - SURF.coverK / SURF.foldShare * monahan(7.7)) < 1e-12);
  // the glide: part of the way each read, all the way in the end, never past the aim
  const g1 = j0Glide(0.7, 0.8, 1), g9 = j0Glide(0.7, 0.8, 60);
  assert.ok(g1 > 0.7 && g1 < 0.8 && Math.abs(g9 - 0.8) < 1e-6);
});

test('each world cell lets its fold through on its own clock: faded in and out, never all cells at once', () => {
  // over a minute, each cell opens and closes (0 and 1 both reached) with soft edges; at any moment only part of them is open
  const cells = Array.from({ length: 200 }, (_, i) => [i % 20 - 10, Math.floor(i / 20) - 5]);
  let minOpen = 1, maxOpen = 0, steps = 0, soft = 0;
  for (let t = 0; t < 60; t += 0.1) {
    let open = 0; for (const [x, z] of cells) { const g = foldGate(x, z, t); open += g; if (g > 0.05 && g < 0.95) soft++; }
    open /= cells.length; minOpen = Math.min(minOpen, open); maxOpen = Math.max(maxOpen, open); steps++;
  }
  assert.ok(minOpen > 0.25 && maxOpen < 0.75, `the open share stays between ${minOpen} and ${maxOpen}`);
  assert.ok(soft / (steps * cells.length) > 0.15, 'part of the time a cell is fading, not on or off');
  // no step: a cell's gate moves little in 1/60 s
  for (const [x, z] of cells.slice(0, 20)) for (let t = 0; t < 10; t += 0.05) assert.ok(Math.abs(foldGate(x, z, t + 1 / 60) - foldGate(x, z, t)) < 0.06);
});

test('the backlit crest glow: a lobe peaking at 1 into the sun, none on glassy water, more in more wind, thin crests over the body, low sun over noon', () => {
  assert.ok(Math.abs(crestPhase(1) - 1) < 1e-9);
  assert.ok(crestPhase(0.9) < 1 && crestPhase(0) < crestPhase(0.5) && crestPhase(-1) > 0);   // a tail off-axis: never snaps off
  const dusk = { hRel: 0.6, cosT: 0.97, nDotS: -0.1 };
  assert.equal(crestBacklit({ ...dusk, U: 1 }), 0);   // glassy water: no crests to light
  assert.ok(crestBacklit({ ...dusk, U: 4 }) < crestBacklit({ ...dusk, U: 8 }));
  assert.ok(crestBacklit({ ...dusk, U: 8, hRel: 0 }) === 0 && crestBacklit({ ...dusk, U: 8, hRel: 0.3 }) < crestBacklit({ ...dusk, U: 8, hRel: 0.9 }));
  // noon: the sun 70 deg up, a level eye looking along the water: cos 0.34 off the view, the face's normal toward the sun
  assert.ok(crestBacklit({ hRel: 0.6, U: 8, cosT: 0.34, nDotS: 0.94 }) < 0.05 * crestBacklit({ ...dusk, U: 8 }));
});
