// Surfing on a lake sea (the owner's ask, 2026-10-30): a 28 ft keelboat near hull speed running downwind (TWA 135) at level 4 on the open lake
// (Hs 1.45 m, T 3.5 s, c = 5.5 m/s) catches waves and surfs in bursts: speed through the water at least 1.5 kn over the flat-water speed for
// at least 2 s within 90 s; no bursts on the bay's chop (T 1.7 s: faster than the waves it is on) or on flat water; the waves' orbital motion
// carries the boat (surface velocityAt). The page's own FFT sea: tools/ultra-surf.mjs and `?start=4700,-15200&twa=135&until=surf`.
//   node --test tests/ultra-surf.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simSurf } from '../src/sim/boat/sim.js';
import { makeCpuSurface, N } from '../src/sim/waters/ultra/surface.js';

const G = 9.81;
// Hs (m), Tp (s): 9 plane waves round the peak, a +-0.45 rad spread, JONSWAP-shaped energies; heightAt with the Smith effect, velocityAt the orbital velocity
function sea(Hs, Tp, toRad, seed = 1) {
  const waves = []; let sum = 0, rng = seed * 9301 + 49297; const rnd = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };
  for (let i = 0; i < 9; i++) {
    const r = 0.55 + i * 0.12, f = r / Tp, w = 2 * Math.PI * f, e = Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(1 / r, 4)), dir = toRad + (rnd() - 0.5) * 0.9;
    waves.push({ k: w * w / G, w, dx: Math.sin(dir), dz: -Math.cos(dir), ph: rnd() * 6.283, e }); sum += e;
  }
  for (const v of waves) v.a = (Hs / 4) * Math.sqrt(2 * v.e / sum);
  return {
    heightAt: (x, z, t, { depthM = 0 } = {}) => waves.reduce((s, v) => s + v.a * Math.sin(v.k * (v.dx * x + v.dz * z) - v.w * t + v.ph) * Math.exp(-v.k * depthM), 0),
    velocityAt: (x, z, t, { depthM = 0, filterM = 0 } = {}) => {
      let vx = 0, vz = 0;
      for (const v of waves) { const lam = 2 * Math.PI / v.k, f = lam < 3 ? Math.max(0, 1 - Math.max(0, filterM - 0.5) / 1.5) : 1; const o = v.a * v.w * Math.cos(v.k * (v.dx * x + v.dz * z) - v.w * t + v.ph) * Math.exp(-v.k * depthM) * f; vx += o * v.dx; vz += o * v.dz; }
      return [vx, vz];
    },
  };
}
const run = (Hs, Tp, noSea = false, twaDeg = 135) => simSurf({ level: 4, twaDeg, seconds: 90, baseMs: 16.3, noSea, surface: (dirDeg) => sea(Hs, Tp, (dirDeg + 180) * Math.PI / 180) });
const mean = (rows, k) => rows.reduce((a, r) => a + r[k], 0) / rows.length;
const runs = (rows, k, th) => { const o = []; let c = null; for (const r of rows) { if (r[k] >= th) { if (!c) c = { t0: r.t, pk: r[k] }; c.pk = Math.max(c.pk, r[k]); c.t1 = r.t; } else if (c) { o.push(c); c = null; } } if (c) o.push(c); return o.map((x) => ({ t0: x.t0, len: +(x.t1 - x.t0).toFixed(2), pk: +x.pk.toFixed(2) })); };

test('surf bursts: the lake sea (Hs 1.45 m, T 3.5 s) lifts the boat 1.5 kn over its flat-water speed for 2 s or more, within 90 s, and it still averages no faster than flat', () => {
  const flat = run(1.45, 3.5, true), sea35 = run(1.45, 3.5);
  const fm = mean(flat.rows, 'kn'), bursts = runs(sea35.rows, 'kn', fm + 1.5).filter((b) => b.len >= 2);
  console.log(`# flat ${fm.toFixed(2)} kn, sea mean ${mean(sea35.rows, 'kn').toFixed(2)} kn, max ${Math.max(...sea35.rows.map((r) => r.kn)).toFixed(2)} kn, bursts over +1.5 kn for 2 s: ${JSON.stringify(bursts)}`);
  assert.ok(bursts.length >= 1, 'a burst of at least +1.5 kn for 2 s');
  assert.ok(mean(sea35.rows, 'kn') < fm + 0.3, 'on average the sea does not speed the boat up');
  assert.ok(Math.max(...sea35.rows.map((r) => r.surf)) > 0.9, 'the surf cue fires');
});
test('no surfing where it is not physical: flat water, the bay\'s chop (T 1.7 s, faster than the waves), and a beat', () => {
  const flat = run(1.45, 3.5, true), fm = mean(flat.rows, 'kn');
  assert.equal(Math.max(...flat.rows.map((r) => r.surf)), 0, 'flat water: no surf cue');
  const bay = run(0.2, 1.7);
  assert.equal(runs(bay.rows, 'kn', fm + 1.5).filter((b) => b.len >= 1).length, 0, 'the bay\'s chop does not lift the boat');
  const beat = run(1.45, 3.5, false, 42);
  assert.equal(runs(beat.rows, 'surf', 0.5).filter((b) => b.len >= 0.5).length, 0, 'a beat: no surf burst lasts half a second (head seas pass in blips)');
});
test('the waves\' orbital motion (surface velocityAt): a plane wave carries the water round at a omega, forward on the crest, back in the trough', () => {
  const s = makeCpuSurface(), a = 0.5, w = 2 * Math.PI / 4, k = w * w / G, L = 600;
  // the field at two reads 1/30 s apart: Dy = a sin(th), th = k x - w t, Dx = +a cos(th) (toward the crest: Gerstner's orbit)
  const m = Math.round(k * L / (2 * Math.PI)), kk = 2 * Math.PI * m / L, ww = Math.sqrt(G * kk);
  const field = (t) => { const buf = new Float32Array(N * N * 4 * 3); for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const x = (i + 0.5) * L / N, th = kk * x - ww * t, o = (j * N + i) * 4; buf[o] = a * Math.cos(th); buf[o + 1] = a * Math.sin(th); buf[o + 3] = 1; } return buf; };
  s.push(field(10), 10); s.push(field(10 + 1 / 30), 10 + 1 / 30);
  let vmax = 0; for (let x = 0; x < L / m; x += 1.3) { const v = s.velocityAt(x, 0, 10); vmax = Math.max(vmax, Math.abs(v[0])); }
  assert.ok(Math.abs(vmax - a * ww) < 0.15 * a * ww, `peak orbital speed ${vmax.toFixed(3)} m/s vs a w = ${(a * ww).toFixed(3)}`);
  // the sign: on a crest (Dy max, th = pi / 2) the water moves in the wave's direction (+x)
  const xc = (Math.PI / 2 + ww * 10) / kk, vc = s.velocityAt(xc, 0, 10)[0], xt = (3 * Math.PI / 2 + ww * 10) / kk, vt = s.velocityAt(xt, 0, 10)[0];
  assert.ok(vc > 0.8 * a * ww && vt < -0.8 * a * ww, `crest ${vc.toFixed(2)}, trough ${vt.toFixed(2)} m/s`);
});
