// Readable wind shifts (src/wind-shifts.js through src/wind.js's hook): the statistics, the periods, the spatial
// coherence, the drift downwind, the texture, the level bands, the trend, and that playing them pays (tools/sim_shifts.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindField, WIND_LEVELS, LEVEL_REF_HOUR } from '../src/sim/wind.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
const BAY = CURRENT_WATERS.windBay;   // the open bay's box (the lake profile's)
import { WindShifts, SHIFTS, ShiftTrend } from '../src/sim/wind-shifts.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { compare } from '../tools/sim_shifts.mjs';

const KN = 0.514444;
// a still day clock (rate 0) at the level's hour: the base holds at the reference wind, so a fixed point sees the periods exactly
const still = (o = {}) => new WindField({ seed: 1, day: { hour: LEVEL_REF_HOUR, rate: 0 }, shifts: true, ...o });
const series = (w, x, z, t0, t1, dt) => { const a = []; for (let t = t0; t < t1; t += dt) a.push(w.shifts.deg(x, z, t)); return a; };
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const rms = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const corr = (a, b) => { const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0; for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; } return n / Math.sqrt(da * db); };

test('shifts: on when asked (Day Sail asks), off by default (Chill, the tools, a fixed wind); deterministic per seed', () => {
  assert.ok(still().shifts instanceof WindShifts);
  assert.equal(new WindField({ seed: 1, day: { hour: 16 } }).shifts, null);
  assert.equal(new WindField({ base: { dirDeg: 270, speedMs: 6 } }).shifts, null);
  assert.ok(new WindField({ base: { dirDeg: 270, speedMs: 6 }, shifts: {} }).shifts);
  assert.equal(still({ shifts: false }).shifts, null);
  const a = still(), b = still(), c = still({ seed: 2 });
  let d = 0;
  for (let t = 0; t < 1800; t += 30) { assert.equal(a.shifts.deg(100, -300, t), b.shifts.deg(100, -300, t)); d += Math.abs(a.shifts.deg(100, -300, t) - c.shifts.deg(100, -300, t)); }
  assert.ok(d / 60 > 1, 'seed 2 shifts like seed 1');
});

test('shifts: amplitude ±5–15° on open water, light air shifting most (levels 1–4)', () => {
  const out = [];
  for (let L = 1; L <= 4; L++) {
    const w = still({ level: L }), s = series(w, 0, 0, 0, 4 * 3600, 5);
    const peak = Math.max(...s.map(Math.abs)), r = rms(s);
    out.push({ L, rms: r, peak, mean: mean(s) });
    assert.ok(Math.abs(mean(s)) < 1, `level ${L}: mean ${mean(s).toFixed(2)}°`);
  }
  console.log('shift rms / peak by level: ' + out.map((o) => `L${o.L} ${o.rms.toFixed(1)}° / ${o.peak.toFixed(1)}°`).join(', '));
  for (const o of out) assert.ok(o.peak >= 5 && o.peak <= 18, `level ${o.L}: peak ${o.peak.toFixed(1)}°`);
  assert.ok(out[2].rms > 3.5 && out[2].rms < 5.5, `level 3 rms ${out[2].rms.toFixed(2)}°`);
  for (let i = 1; i < 4; i++) assert.ok(out[i].rms < out[i - 1].rms, 'a breeze is steadier than light air');
});

test('shifts: the periods at a fixed point are the components’ (4, 7 and 11 min ± 15 %)', () => {
  // a periodogram over 8 h at 5 s; the three strongest separated peaks between 2 and 20 min
  const w = still(), dt = 5, s = series(w, 0, 0, 0, 8 * 3600, dt), m = mean(s), N = s.length;
  const power = (T) => { let re = 0, im = 0; for (let i = 0; i < N; i++) { const a = 2 * Math.PI * i * dt / T; re += (s[i] - m) * Math.cos(a); im += (s[i] - m) * Math.sin(a); } return re * re + im * im; };
  const Ts = []; for (let T = 120; T <= 1200; T *= 1.02) Ts.push(T);
  const P = Ts.map(power), peaks = [];
  for (let i = 1; i < P.length - 1; i++) if (P[i] > P[i - 1] && P[i] >= P[i + 1]) peaks.push([Ts[i], P[i]]);
  peaks.sort((a, b) => b[1] - a[1]);
  const top = []; for (const p of peaks) { if (top.every((q) => Math.abs(Math.log(q[0] / p[0])) > 0.25)) top.push(p); if (top.length === 3) break; }
  const got = top.map((p) => p[0]).sort((a, b) => a - b);
  console.log(`periodogram peaks: ${got.map((T) => (T / 60).toFixed(1)).join(', ')} min`);
  SHIFTS.periodsS.forEach((T, i) => assert.ok(Math.abs(got[i] / T - 1) < 0.15, `peak ${i}: ${(got[i] / 60).toFixed(1)} min vs ${T / 60}`));
});

test('shifts: spatially coherent — the correlation length is ≈ 1–3 km across the wind (a shift line) and ≈ 0.3–3 km along it (a fraction of a wavelength)', () => {
  const w = still(), [ux, uz] = WindField.toward(w.base.dirDeg), nx = -uz, nz = ux;
  const at = (d, along) => {   // the correlation of the shift at points d metres apart (across or along), over many instants
    const a = [], b = [];
    for (let t = 0; t < 6 * 3600; t += 37) for (const o of [-3000, 0, 3000]) {
      const x0 = nx * o, z0 = nz * o;
      a.push(w.shifts.deg(x0, z0, t));
      b.push(w.shifts.deg(x0 + (along ? ux : nx) * d, z0 + (along ? uz : nz) * d, t));
    }
    return corr(a, b);
  };
  const L = (along) => { for (let d = 100; d <= 8000; d += 100) if (at(d, along) < 1 / Math.E) return d; return 8000; };
  const near = at(200, false), across = L(false), alongL = L(true);
  console.log(`correlation: 200 m across ${near.toFixed(3)}; 1/e length across ${across} m, along ${alongL} m`);
  assert.ok(near > 0.95, `200 m apart ${near.toFixed(3)}`);
  assert.ok(across >= 1000 && across <= 3000, `across the wind ${across} m`);
  assert.ok(alongL >= 300 && alongL <= 3000, `along the wind ${alongL} m`);
});

test('shifts: carried downwind at the wind speed (a shift seen upwind arrives later)', () => {
  // the pattern at x, t matches the pattern at x + k·U·τ downwind, τ later, best at k = 1
  const w = new WindField({ seed: 3, day: { hour: 16, rate: 1 }, shifts: true }), tau = 60;
  w.at(600); const U = w.base.speedMs, [ux, uz] = WindField.toward(w.base.dirDeg);
  const err = (k) => { let e = 0; for (let i = 0; i < 300; i++) { const x = (i % 20) * 300 - 3000, z = Math.floor(i / 20) * 300 - 2000, t = 600 + i * 7; e += Math.abs(w.shifts.deg(x + ux * U * k * tau, z + uz * U * k * tau, t + tau) - w.shifts.deg(x, z, t)); } return e / 300; };
  const errs = Object.fromEntries([0, 0.5, 0.75, 1, 1.25, 1.5, 2].map((k) => [k, err(k)]));
  const best = +Object.entries(errs).sort((p, q) => p[1] - q[1])[0][0];
  console.log(`drift: mean |Δshift| by speed factor ${JSON.stringify(errs, (k, v) => typeof v === 'number' ? +v.toFixed(3) : v)}`);
  assert.equal(best, 1);
  assert.ok(errs[1] < 0.15 * errs[0], 'following the air keeps the shift; standing still loses it');
});

test('shifts: every effect sees them — sample() and toTexture() agree, the direction moves, the speed barely', () => {
  const w = new WindField({ seed: 1, day: { hour: 16, rate: 1 }, shifts: true }), off = new WindField({ seed: 1, day: { hour: 16, rate: 1 } });
  const N = 64, E = 4096, t = 300, tex = w.toTexture(N, E, t);
  let worst = 0, dDir = 0, dSp = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -E / 2 + (i + 0.5) * E / N, z = -E / 2 + (j + 0.5) * E / N, s = w.sample(x, z, t), o = off.sample(x, z, t);
    worst = Math.max(worst, Math.hypot(tex[2 * (j * N + i)] - s.vx, tex[2 * (j * N + i) + 1] - s.vz));
    dDir = Math.max(dDir, Math.abs(((s.dirDeg - o.dirDeg + 540) % 360) - 180)); dSp = Math.max(dSp, Math.abs(s.speed - o.speed));
  }
  assert.ok(worst < 0.06, `texture vs sample |Δv| max ${worst.toFixed(4)} m/s (the texture reads the shift off a 128 m grid: ≈ 0.3°)`);
  assert.ok(dDir > 3, `the shifts turn the wind: max ${dDir.toFixed(1)}°`);
  assert.ok(dSp < 1e-9, 'without terrain the shift changes no speed');
});

test('shifts: bigger near the shore, the bay mouth and the valley outflows; a persistent bias there', () => {
  const T = makeTerrain({ seed: 1 }), w = still(); w.setTerrain(T.heightAt);
  const pts = [];
  for (let z = -3000; z <= 3000; z += 250) for (let x = -2500; x <= 2500; x += 250) if (T.heightAt(x, z) < -5) pts.push([x, z, w.roughAt(x, z), w.shifts.shoreAt(x, z)]);
  const open = pts.filter((p) => p[2] < 0.05 && p[3] < 0.05), edge = pts.filter((p) => p[2] > 0.4 || p[3] > 0.6);
  assert.ok(open.length > 5 && edge.length > 5, `${open.length} open and ${edge.length} edge points`);
  const g = (P) => mean(P.map(([x, z]) => w.shifts.placeAt(x, z)[0])), bias = (P) => mean(P.map(([x, z]) => Math.abs(w.shifts.placeAt(x, z)[1])));
  console.log(`place gain: open ${g(open).toFixed(2)}, edge ${g(edge).toFixed(2)}; |bias| open ${bias(open).toFixed(2)}°, edge ${bias(edge).toFixed(2)}°`);
  assert.ok(g(edge) > 1.3 * g(open), 'the edge shifts more');
  assert.ok(bias(edge) > 0.8 && bias(open) < 0.4, 'the bias sits by the land');
});

test('shifts: the level bands are unchanged — each level’s open-bay mean at 18:45 is in its band and matches the field without shifts', () => {
  const T = makeTerrain({ seed: 1 }), PTS = [];
  for (let z = BAY.z0; z <= BAY.z1; z += BAY.dz) for (let x = BAY.x0; x <= BAY.x1; x += BAY.dx) if (T.heightAt(x, z) < BAY.deep) PTS.push([x, z]);
  const bay = (w) => { let s = 0, n = 0; for (const [x, z] of PTS) for (let t = 0; t < 600; t += 30) { s += w.sample(x, z, t).speed; n++; } return s / n / KN; };
  const rows = [];
  for (let L = 1; L <= 4; L++) {
    const day = { hour: LEVEL_REF_HOUR, rate: 1 };
    const on = new WindField({ seed: 1, day, level: L, shifts: true }), off = new WindField({ seed: 1, day, level: L });
    on.setTerrain(T.heightAt); off.setTerrain(T.heightAt);
    assert.equal(on.levelScale(), off.levelScale(), 'the level’s scale ignores the shifts');
    const a = bay(on), b = bay(off), band = WIND_LEVELS[L - 1].kn;
    rows.push(`L${L} ${a.toFixed(2)} vs ${b.toFixed(2)} kn (${band.join('–')})`);
    assert.ok(Math.abs(a / b - 1) < 0.04, `level ${L}: ${a.toFixed(2)} kn with shifts, ${b.toFixed(2)} without`);
    if (b >= band[0] && b <= band[1]) assert.ok(a >= band[0] && a <= band[1], `level ${L}: in the band without shifts, out with them`);
  }
  console.log('the outer bay at 18:45 (' + PTS.length + ' points), shifts on vs off: ' + rows.join('; '));
});

test('trend: a veer on starboard is a lift, on port a header; a back the other way; it fades once the shift holds', () => {
  const run = (twaDeg, shift) => {
    const tr = new ShiftTrend(); let r;
    for (let t = 0; t < 300; t += 0.1) r = tr.update(0.1, 200, twaDeg * Math.PI / 180);
    for (let t = 0; t < 40; t += 0.1) r = tr.update(0.1, 200 + shift, twaDeg * Math.PI / 180);
    const at40 = r;
    for (let t = 0; t < 1200; t += 0.1) r = tr.update(0.1, 200 + shift, twaDeg * Math.PI / 180);
    return [at40, r];
  };
  assert.equal(run(42, 8)[0].kind, 'lift'); assert.equal(run(-42, 8)[0].kind, 'header');
  assert.equal(run(42, -8)[0].kind, 'header'); assert.equal(run(-42, -8)[0].kind, 'lift');
  assert.equal(run(42, 8)[1].kind, null, 'a steady new wind is the new mean');
  assert.equal(run(150, 8)[0].kind, null, 'downwind: not shown');
  assert.equal(run(42, 1.5)[0].kind, null, 'under the 3° threshold: nothing');
});

test('the skill pays: tacking on headers beats ignoring the shifts over a 20-minute beat (VMG, 3 seeds)', () => {
  const rows = [1, 2, 3].map((seed) => compare({ seed, level: 3, hour: 16.5, minutes: 20 }));
  const m = (k) => mean(rows.map((r) => r[k].vmgKn));
  console.log(`VMG kn: header ${m('header').toFixed(3)} · one tack ${m('one').toFixed(3)} · even ${m('even').toFixed(3)} · on lifts ${m('lift').toFixed(3)}`);
  assert.ok(m('header') > 1.03 * m('one'), 'header beats one tack by 3 %');
  assert.ok(m('header') > 1.02 * m('even'), 'header beats the same tacks, evenly spaced');
  assert.ok(m('lift') < m('one'), 'tacking on lifts loses');
});
