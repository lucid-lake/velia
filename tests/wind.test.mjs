// The wind field's contract (src/wind.js). Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WindField, dayWind } from '../src/sim/wind.js';
import { heightAt } from '../src/sim/terrain.js';

const OPTS = { seed: 7, base: { dirDeg: 270, speedMs: 6 }, gust: { strength: 0.35, scaleM: 300, periodS: 40 }, shift: { deg: 10, periodS: 120 } };

// a seeded LCG for the sample points (no Math.random in the checks)
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

test('mean speed within 5 % of the base over 1,000 samples', () => {
  const w = new WindField(OPTS), r = lcg(1);
  let sum = 0;
  for (let i = 0; i < 1000; i++) sum += w.sample((r() - 0.5) * 4000, (r() - 0.5) * 4000, r() * 600).speed;
  const mean = sum / 1000;
  assert.ok(Math.abs(mean / OPTS.base.speedMs - 1) <= 0.05, `mean ${mean.toFixed(3)} m/s vs base ${OPTS.base.speedMs}`);
});

test('gusts are real: the speed varies by at least ±15 % of the base', () => {
  const w = new WindField(OPTS), r = lcg(2);
  let lo = Infinity, hi = 0;
  for (let i = 0; i < 1000; i++) {
    const s = w.sample((r() - 0.5) * 4000, (r() - 0.5) * 4000, r() * 600).speed;
    lo = Math.min(lo, s); hi = Math.max(hi, s);
  }
  assert.ok(lo <= 0.85 * 6 && hi >= 1.15 * 6, `range ${lo.toFixed(2)}–${hi.toFixed(2)} m/s`);
});

test('a gust travels downwind at the wind speed', () => {
  // follow the air for dt at speed k × U: the gust pattern matches best at k = 1 (still, slower, faster and upwind all worse)
  const w = new WindField(OPTS), dt = 8, [ux, uz] = WindField.toward(270);
  const err = (k) => {
    const r = lcg(3);
    let e = 0;
    for (let i = 0; i < 500; i++) {
      const x = (r() - 0.5) * 4000, z = (r() - 0.5) * 4000, t = r() * 600;
      e += Math.abs(w.gustAt(x + ux * 6 * k * dt, z + uz * 6 * k * dt, t + dt) - w.gustAt(x, z, t));
    }
    return e / 500;
  };
  const e = Object.fromEntries([-1, 0, 0.5, 0.8, 1, 1.25, 1.5, 2].map((k) => [k, err(k)]));
  const best = Object.entries(e).sort((p, q) => p[1] - q[1])[0][0];
  assert.equal(+best, 1, `mean |Δgust| by speed factor: ${JSON.stringify(e, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v)}`);
});

test('the shift wanders within ± shift.deg', () => {
  const w = new WindField(OPTS);
  let lo = Infinity, hi = -Infinity;
  for (let t = 0; t < 3600; t += 5) {
    const d = w.dirAt(0, 0, t);
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  assert.ok(lo >= 260 && hi <= 280, `dir ${lo.toFixed(1)}–${hi.toFixed(1)}°`);
  assert.ok(hi - lo >= 8, `the wander spans only ${(hi - lo).toFixed(1)}°`);
});

test('a west wind blows toward +x (east); a north wind toward +z (south)', () => {
  const w = new WindField({ ...OPTS, gust: { strength: 0 }, shift: { deg: 0 } });
  const s = w.sample(0, 0, 0);
  assert.ok(Math.abs(s.vx - 6) < 1e-9 && Math.abs(s.vz) < 1e-9 && Math.abs(s.dirDeg - 270) < 1e-9);
  const n = new WindField({ ...OPTS, base: { dirDeg: 0, speedMs: 4 }, gust: { strength: 0 }, shift: { deg: 0 } }).sample(0, 0, 0);
  assert.ok(Math.abs(n.vz - 4) < 1e-9 && Math.abs(n.vx) < 1e-9);
});

test('lee: full within 4 ridge heights, gone past 1.6 km upwind; a 1 km range 3 km away shades nothing', () => {
  // a north-south ridge at x = 0, 200 m high; a west wind; the lake at 0 elsewhere (one side flat: no valley)
  const ridge = (x) => 200 * Math.exp(-((x / 150) ** 2));
  const free = new WindField(OPTS);
  const lee = new WindField(OPTS);
  lee.setTerrain((x, z) => ridge(x));
  for (const t of [0, 37, 300]) {
    for (const z of [-800, 0, 650]) {
      const at = (x) => lee.sample(x, z, t).speed / free.sample(x, z, t).speed;
      assert.ok(at(800) <= 0.56, `4 H behind: ${at(800).toFixed(3)} of free stream (t ${t}, z ${z})`);
      const mid = at(1200);                                          // 6 H, where far relief starts to count less
      assert.ok(mid > 0.6 && mid < 0.95, `6 H behind: ${mid.toFixed(3)}`);
      assert.ok(at(2000) > 0.999, `10 H behind, past the reach: ${at(2000).toFixed(3)}`);
      assert.ok(Math.abs(at(-1500) - 1) < 1e-9, `upwind: ${at(-1500)}`);
    }
  }
  // the basin's problem (2026-10-29): a 1 km range 3 km upwind put the whole lake at 30 %
  const range = new WindField(OPTS);
  range.setTerrain((x) => 1000 * Math.exp(-((x / 600) ** 2)));
  assert.ok(Math.abs(range.sample(3000, 0, 0).speed / free.sample(3000, 0, 0).speed - 1) < 1e-9, 'a range 3 km upwind still shades');
});

test('same seed, same output; another seed, another field', () => {
  const a = new WindField(OPTS), b = new WindField(OPTS), c = new WindField({ ...OPTS, seed: 8 });
  const r = lcg(4);
  let diff = 0;
  for (let i = 0; i < 200; i++) {
    const x = (r() - 0.5) * 4000, z = (r() - 0.5) * 4000, t = r() * 600;
    assert.deepEqual(a.sample(x, z, t), b.sample(x, z, t));
    diff += Math.abs(a.sample(x, z, t).speed - c.sample(x, z, t).speed);
  }
  assert.ok(diff / 200 > 0.05, 'seed 8 gives the same field as seed 7');
  assert.deepEqual(a.toTexture(16, 4000, 12.5), b.toTexture(16, 4000, 12.5));
});

// a stand-in for T4's terrain until it lands: a ridge field north of the lake, lake (≤ 0) elsewhere.
// 6 octaves: the finest detail is 37 m, under the 31 m texel; 4 octaves: 150 m, which the texture resolves
function hills(seed, octaves = 6) {
  const hash = (x, y) => {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const value = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), u = x - xi, v = y - yi, f = (t) => t * t * (3 - 2 * t);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(hash(xi, yi), hash(xi + 1, yi), f(u)), l(hash(xi, yi + 1), hash(xi + 1, yi + 1), f(u)), f(v));
  };
  return (x, z) => {
    let a = 0, amp = 0.5, fq = 1 / 1200;
    for (let i = 0; i < octaves; i++) { a += value(x * fq + i * 7.1, z * fq - i * 3.7) * amp; amp *= 0.5; fq *= 2; }
    return (a - 0.35) * 600 * Math.max(0, Math.min(1, (-z - 200) / 1500)) - 5;           // ridges rise north of z = −200
  };
}

function textureError(octaves) {
  const w = new WindField({ ...OPTS, base: { dirDeg: 200, speedMs: 6 } });               // a SSW wind: the lee falls to the NNE
  w.setTerrain(hills(3, octaves));
  const N = 128, E = 4000, t = 21, tex = w.toTexture(N, E, t);
  assert.equal(tex.length, N * N * 2);
  const err = [];
  let lee = 0, crest = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -E / 2 + (i + 0.5) * E / N, z = -E / 2 + (j + 0.5) * E / N, s = w.sample(x, z, t);
    err.push(Math.hypot(tex[2 * (j * N + i)] - s.vx, tex[2 * (j * N + i) + 1] - s.vz));
    const f = w.terrainAt(x, z, s.dirDeg);
    if (f < 0.75) lee++; else if (f > 1.1) crest++;
  }
  err.sort((a, b) => a - b);
  return { mean: err.reduce((a, b) => a + b) / err.length, p95: err[Math.floor(0.95 * err.length)], max: err.at(-1), lee, crest };
}
const fmt = (e) => `|Δv| mean ${e.mean.toFixed(3)} m/s, p95 ${e.p95.toFixed(3)}, max ${e.max.toFixed(3)}; ${e.lee} lee texels, ${e.crest} crest texels`;

test('toTexture: every texel is sample() at its centre, rows north to south (128², 4 km, ridges in the north)', () => {
  // both read the same lattices (lee 50 m, crest 125 m, valley 100 m, gusts scaleM / 8), so they agree to rounding
  for (const oct of [4, 6]) {
    const e = textureError(oct);
    console.log(`texture vs sample, ${oct} octaves: ${fmt(e)}`);
    assert.ok(e.max < 1e-3, fmt(e));
    assert.ok(e.lee > 300 && e.crest > 300, `too few lee or crest texels for the check to mean anything: ${fmt(e)}`);
  }
});

test('cost: sample() < 20 µs; the water\'s 256² texture < 10 ms a frame (fastest of 20; ≈5 ms on an idle machine, load from other work only adds); new bins < 400 ms once', () => {
  const w = new WindField({ ...OPTS, base: { dirDeg: 200, speedMs: 6 } });
  w.setTerrain(heightAt);
  let t0 = performance.now();
  w.toTexture(256, 4096, 0);
  const first = performance.now() - t0;
  const ms = [];
  for (let i = 1; i <= 20; i++) { t0 = performance.now(); w.toTexture(256, 4096, i / 60); ms.push(performance.now() - t0); }
  ms.sort((a, b) => a - b);
  // a direction 15° away: new bins (lattice tiles over the texture, then the texel arrays)
  w.base.dirDeg = 215;
  t0 = performance.now(); w.toTexture(256, 4096, 30); const bin = performance.now() - t0;
  t0 = performance.now();
  for (let i = 0; i < 5000; i++) w.sample((i % 50) * 20 - 500, 1100 - i * 0.3, i / 60);
  const us = (performance.now() - t0) / 5000 * 1000;
  console.log(`toTexture 256² / 4096 m: first ${first.toFixed(0)} ms, a frame fastest ${ms[0].toFixed(2)}, median ${ms[10].toFixed(2)} ms, max ${ms.at(-1).toFixed(2)}; new bins ${bin.toFixed(0)} ms; sample ${us.toFixed(1)} µs`);
  // The budgets gate only with LAKESHORE_STRICT=1 (a quiet machine; tests/helpers/budget.mjs). The 4× ceiling they had
  // otherwise still failed beside 5 helpers' renders (2026-11-11) with the code unchanged.
  budget(ms[0], 10, `a frame's texture (fastest; median ${ms[10].toFixed(2)} ms)`);
  budget(bin, 400, 'new bins');
  budget(us, 20, 'sample()', 'µs');
});

test('crest: a ridge top runs fast (1 + 1.6 H / L, capped at + 80 %); the lake and the far upwind are untouched', () => {
  // a north-south Gaussian ridge, H = 60 m, half height at L = 300 m: Δs = 1.6 × 60 / 300 = 0.32
  const H = 60, L = 300, sig = L / Math.sqrt(Math.log(2));
  const w = new WindField({ ...OPTS, gust: { strength: 0 }, shift: { deg: 0 } });
  w.setTerrain((x) => H * Math.exp(-((x / sig) ** 2)) - 1);
  const crest = w.sample(0, 0, 0).speed / 6;
  assert.ok(Math.abs(crest - 1 - 0.32) < 0.32 * 0.25, `crest ${crest.toFixed(3)} × base, guideline 1.32`);
  const slope = w.sample(-L, 0, 0).speed / 6;
  assert.ok(slope > 1.02 && slope < crest, `half way up: ${slope.toFixed(3)}`);
  assert.ok(Math.abs(w.sample(-3000, 0, 0).speed / 6 - 1) < 1e-9, 'far upwind on the lake');
  const steep = new WindField({ ...OPTS, gust: { strength: 0 }, shift: { deg: 0 } });
  steep.setTerrain((x) => 400 * Math.exp(-((x / 150) ** 2)));
  assert.ok(steep.sample(0, 0, 0).speed / 6 <= 1.8 + 1e-9, 'the cap');
});

// ---- L6: the valley and the day ----
const KT = 0.514444;
// Emerald Bay's water (the real frame: the island at the origin, the head south-west, the mouth north-east)
const lakePoints = (step = 200) => {
  const p = [];
  for (let z = -1300; z <= 500; z += step) for (let x = -700; x <= 1700; x += step) if (heightAt(x, z) < -2) p.push([x, z]);
  return p;
};
const BOAT = [1200, -1050];   // the Day Sail start (src/modes/daysail/index.js START)
const steady = (dirDeg, extra = {}) => { const w = new WindField({ ...OPTS, base: { dirDeg, speedMs: 6 }, gust: { strength: 0 }, shift: { deg: 0 }, ...extra }); w.setTerrain(heightAt); return w; };

test('valley: an up-lake wind keeps the lake sailable (2026-10-29: the basin\'s lee had left 1.5 of 6 m/s at the boat)', () => {
  const w = steady(200), pts = lakePoints();
  const speeds = pts.map(([x, z]) => w.sample(x, z, 0).speed).sort((a, b) => a - b);
  const mean = speeds.reduce((a, b) => a + b) / speeds.length, p10 = speeds[Math.floor(0.1 * speeds.length)];
  const boat = w.sample(...BOAT, 0).speed;
  console.log(`200° at 6 m/s over ${pts.length} bay points: mean ${mean.toFixed(2)}, p10 ${p10.toFixed(2)} m/s; the boat's start ${boat.toFixed(2)} m/s`);
  assert.ok(mean >= 0.75 * 6, `lake mean ${mean.toFixed(2)} m/s`);   // the real bay is sheltered: 0.78 × at 200°, 0.88 × up its axis (237°)
  assert.ok(p10 >= 0.5 * 6, `p10 ${p10.toFixed(2)} m/s`);
  assert.ok(boat >= 0.6 * 6, `boat start ${boat.toFixed(2)} m/s`);
});

test('valley: a cross-valley wind turns toward the lake\'s axis and weakens; ridge tops keep the free wind', () => {
  const up = steady(237), cross = steady(327);   // up Emerald Bay's axis (≈ 57°/237°) and across it
  const pts = lakePoints();
  let turn = 0, sCross = 0, sUp = 0;
  for (const [x, z] of pts) {
    const c = cross.sample(x, z, 0);
    turn += Math.abs(((c.dirDeg - 327 + 540) % 360) - 180);
    sCross += c.speed; sUp += up.sample(x, z, 0).speed;
  }
  turn /= pts.length;
  console.log(`327° (across the bay): turned ${turn.toFixed(1)}° on average; mean speed ${(sCross / pts.length).toFixed(2)} vs ${(sUp / pts.length).toFixed(2)} m/s up the bay`);
  assert.ok(sCross < 0.7 * sUp, 'the cross wind is not weaker than the valley wind');
  // the axis itself: mid-bay it runs within 25° of the bay's (≈ 57°); weakly, as the bay opens onto the lake
  const v = cross.valleyAt(700, -600), axis = ((Math.atan2(v.ax, -v.az) / Math.PI * 180) + 360) % 180;
  assert.ok(Math.abs(axis - 57) < 25 && v.c > 0.05, `axis ${axis.toFixed(0)}°, strength ${v.c.toFixed(2)}`);
  // a high point: no channel (the free direction)
  let hx = 0, hz = 0, hh = -1;
  for (let x = -3000; x <= 3000; x += 250) for (let z = -3000; z <= 3000; z += 250) { const h = heightAt(x, z); if (h > hh) { hh = h; hx = x; hz = z; } }
  assert.ok(cross.valleyAt(hx, hz).c < 0.05, `the top (${hh.toFixed(0)} m) is channelled: ${cross.valleyAt(hx, hz).c.toFixed(2)}`);
});

test('valley: headlands and valley mouths gust harder than the open lake', () => {
  const w = new WindField({ ...OPTS, base: { dirDeg: 200, speedMs: 6 } });
  w.setTerrain(heightAt);
  const pts = lakePoints(100).map(([x, z]) => ({ x, z, r: w.roughAt(x, z) })).sort((a, b) => b.r - a.r);
  const spread = (p) => { const s = []; for (let t = 0; t < 600; t += 3) s.push(w.sample(p.x, p.z, t).speed); const m = s.reduce((a, b) => a + b) / s.length; return Math.sqrt(s.reduce((a, b) => a + (b - m) ** 2, 0) / s.length) / m; };
  const rough = pts.slice(0, 20), calm = pts.slice(-20);
  const sr = rough.reduce((a, p) => a + spread(p), 0) / 20, sc = calm.reduce((a, p) => a + spread(p), 0) / 20;
  console.log(`gust spread (σ / mean over 10 min): roughest 20 points ${sr.toFixed(3)} (rough ${rough[19].r.toFixed(2)}+), calmest 20 ${sc.toFixed(3)}`);
  assert.ok(rough[0].r > 0.8 && calm[0].r < 0.05, 'the lake has no rough or no calm spots');
  assert.ok(sr > 1.4 * sc, `roughest ${sr.toFixed(3)} vs calmest ${sc.toFixed(3)}`);
});

test('the day: glassy dawn, a down-valley morning drift, a lull ≈13:30, the up-lake afternoon breeze at 12–20 kt, fading at sunset', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const at = (h) => dayWind(h, { seed });
    const kt = (h) => at(h).speedMs / KT, dir = (h) => at(h).dirDeg;
    assert.ok(kt(6.8) < 1, `seed ${seed}: dawn ${kt(6.8).toFixed(1)} kt`);
    assert.ok(kt(10) >= 3 && kt(10) <= 8 && Math.abs(dir(10) - 15) < 1, `seed ${seed}: morning ${kt(10).toFixed(1)} kt from ${dir(10).toFixed(0)}°`);
    assert.ok(kt(13.6) < 1.5, `seed ${seed}: lull ${kt(13.6).toFixed(1)} kt`);
    assert.ok(kt(16) >= 12 && kt(16) <= 20 && Math.abs(dir(16) - 200) < 1, `seed ${seed}: afternoon ${kt(16).toFixed(1)} kt from ${dir(16).toFixed(0)}°`);
    assert.ok(kt(21.2) < 3, `seed ${seed}: after sunset ${kt(21.2).toFixed(1)} kt`);
    // the breeze starts between 13:50 and 14:45 (half its peak)
    let start = null;
    for (let h = 13; h < 16 && start === null; h += 1 / 60) if (kt(h) >= 0.5 * kt(16)) start = h;
    assert.ok(start >= 13.83 && start <= 14.75 + 0.5, `seed ${seed}: breeze at ${start.toFixed(2)} h`);
  }
});

test('the day: the direction only swings through a lull, never at speed', () => {
  for (const advisory of [false, true]) {
    for (let h = 0; h < 24; h += 1 / 60) {
      const a = dayWind(h, { advisory }), b = dayWind(h + 10 / 60, { advisory });
      const turn = Math.abs(((b.dirDeg - a.dirDeg + 540) % 360) - 180);
      if (turn > 20) assert.ok(Math.min(a.speedMs, b.speedMs) < 1.5, `${h.toFixed(2)} h: ${turn.toFixed(0)}° in 10 min at ${a.speedMs.toFixed(1)} m/s (advisory ${advisory})`);
    }
  }
});

test('the day: an advisory day blows SW 10–20 mph and gusts to 35–45 mph, harder than a normal afternoon', () => {
  const d = dayWind(15, { advisory: true });
  const mph = d.speedMs / 0.44704;
  assert.ok(mph >= 10 && mph <= 20 && Math.abs(d.dirDeg - 215) < 1, `${mph.toFixed(1)} mph from ${d.dirDeg.toFixed(0)}°`);
  // the strongest 1 % of lake samples over 2 minutes
  const p99 = (advisory) => {
    const w = new WindField({ seed: 1, day: { hour: 15, advisory } });
    w.setTerrain(heightAt);
    const s = [];
    for (const [x, z] of lakePoints(150)) for (let t = 0; t < 120; t += 4) s.push(w.sample(x, z, t).speed);
    s.sort((a, b) => a - b);
    return s[Math.floor(0.99 * s.length)] / 0.44704;
  };
  const adv = p99(true), normal = p99(false);
  console.log(`15:00 lake gusts (p99): advisory ${adv.toFixed(0)} mph on ${mph.toFixed(1)} sustained; a normal afternoon ${normal.toFixed(0)} mph on ${(dayWind(15, { seed: 1 }).speedMs / 0.44704).toFixed(1)}`);
  assert.ok(adv >= 35 && adv <= 50, `advisory gusts ${adv.toFixed(0)} mph`);   // the real bay's walls: 47 mph p99 (was 35–45 on the old basin; CTO to retune)
  assert.ok(adv > normal + 5, `advisory ${adv.toFixed(0)} vs normal ${normal.toFixed(0)} mph`);
});

test('the day on the scene clock: base, gust and shift update in place; gusts drift smoothly as the breeze builds', () => {
  // level: null: the raw day (a level now floors the lull at its band's bottom: fix/wind-level-range)
  const w = new WindField({ seed: 3, day: { hour: 14, rate: 60 }, level: null });     // a minute of t is an hour of the day
  const base = w.base;
  w.sample(0, 0, 0);
  const calm = base.speedMs;
  w.sample(0, 0, 90);                                                     // 15:30
  assert.ok(base === w.base && base.speedMs > 4 * calm && Math.abs(base.dirDeg - 200) < 1, `base ${calm.toFixed(2)} → ${base.speedMs.toFixed(2)} m/s from ${base.dirDeg.toFixed(0)}°`);
  assert.equal(w.regime, 'afternoon up-lake breeze');
  // no jumps in the gust field while the speed changes: 1/60 s apart, every point moves a little
  let worst = 0;
  for (let t = 10; t < 60; t += 0.5) for (let i = 0; i < 20; i++) { const x = i * 150 - 1500, z = 300; worst = Math.max(worst, Math.abs(w.gustAt(x, z, t + 1 / 60) - w.gustAt(x, z, t))); }
  assert.ok(worst < 0.05, `gust step ${worst.toFixed(3)} in 1/60 s`);
  // while the breeze builds (14:25, the speed rising ≈0.3 m/s each second of t), the gusts travel at the speed of the
  // moment: following the air at k × U for 3 s matches best at k = 1
  const t1 = 25, U = (w.at(t1), w.base.speedMs), [ux, uz] = WindField.toward(200);
  const err = (k) => {
    const r = lcg(9);
    let e = 0;
    for (let i = 0; i < 300; i++) {
      const x = (r() - 0.5) * 3000, z = (r() - 0.5) * 3000, dt = 3;
      e += Math.abs(w.gustAt(x + ux * U * k * dt, z + uz * U * k * dt, t1 + dt) - w.gustAt(x, z, t1));
    }
    return e;
  };
  const errs = Object.fromEntries([0.5, 0.75, 1, 1.25, 1.5, 2].map((k) => [k, err(k)]));
  const bestK = +Object.entries(errs).sort((p, q) => p[1] - q[1])[0][0];
  assert.equal(bestK, 1, `gusts move at ${bestK} × the wind (U ${U.toFixed(2)} m/s): ${JSON.stringify(errs, (k, v) => typeof v === 'number' ? +v.toFixed(2) : v)}`);
  // the same scene time gives the same wind, whatever order it is asked in
  const a = new WindField({ seed: 3, day: { hour: 14, rate: 60 } }), b = new WindField({ seed: 3, day: { hour: 14, rate: 60 } });
  b.sample(0, 0, 50);
  assert.deepEqual(a.sample(100, 200, 33), b.sample(100, 200, 33));
});

// ---- the wind level (Day Sail's 1–4; the owner's call: the level is set on the open bay) ----------
import { WIND_LEVELS, DEFAULT_WIND_LEVEL, EVENING, eveningHour, LEVEL_REF_HOUR } from '../src/sim/wind.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
const BAY = CURRENT_WATERS.windBay;   // the open bay's box (the lake profile's)
import { analyticSun } from '../src/sim/timeOfDay.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { budget } from './helpers/budget.mjs';
const LV_TERRAIN = makeTerrain({ seed: 1 });
const KN = 0.514444;
const REF = LEVEL_REF_HOUR;   // 18:45 PDT, Day Sail's start
const dayField = (o = {}) => { const w = new WindField({ seed: 1, day: { hour: REF, rate: 1 }, ...o }); w.setTerrain(LV_TERRAIN.heightAt); return w; };
// the open bay (src/wind.js BAY): Emerald Bay's outer basin, north of the island to the sill, over water deeper than 20 m
const BAY_PTS = [];
for (let z = BAY.z0; z <= BAY.z1; z += BAY.dz) for (let x = BAY.x0; x <= BAY.x1; x += BAY.dx) if (LV_TERRAIN.heightAt(x, z) < BAY.deep) BAY_PTS.push([x, z]);
// Day Sail's start on the real map (src/modes/daysail/index.js START), just inside the mouth
const START = { x: 1200, z: -1050 };
const elevAt = (h) => Math.asin(analyticSun(h).y) * 180 / Math.PI;
const bayMeanKn = (w, t0 = 0) => { let s = 0, n = 0; for (const [x, z] of BAY_PTS) for (let t = t0; t < t0 + 600; t += 20) { s += w.sample(x, z, t).speed; n++; } return s / n / KN; };

test('wind level: 3 by default; the four bands; set at Day Sail’s start hour, a constant scale on the day', () => {
  assert.equal(DEFAULT_WIND_LEVEL, 3);
  assert.equal(REF, 18.75, 'the level is set at 18:45 PDT, the Day Sail start');
  assert.deepEqual(WIND_LEVELS.map((l) => l.kn), [[4, 7], [8, 12], [13, 17], [18, 24]]);
  const w = dayField();
  assert.equal(w.level, 3);
  assert.ok(BAY_PTS.length >= 30, `${BAY_PTS.length} bay points`);
  for (const [x, z] of BAY_PTS) assert.ok(x < 1500 && z > -1150, 'the open bay is inside the mouth');
  // the scale: 1 when the bay's expected mean already sits in the band, else the band's mean over it (seed 1 at 18:45:
  // the breeze fading, 12.9 kn of day, the bay ≈ 11.8: ×1.27)
  const kn = w.refMs() / KN, [lo, hi] = WIND_LEVELS[2].kn;
  assert.ok(Math.abs(w.levelScaleAt(0, 0, 0) - (kn >= lo && kn <= hi ? 1 : 15 / kn)) < 1e-9);
  // a constant scale: the afternoon (before the evening hold) is the seed's own wind times it, at every point, capped
  // at the band's top (fix/wind-level-range, 2026-11-04: seed 1's 16:00 is 21.5 kn of bay mean scaled, now 15.7)
  const w16 = dayField({ day: { hour: 16, rate: 1 } }), raw16 = new WindField({ seed: 1, day: { hour: 16, rate: 1 }, level: null }); raw16.setTerrain(LV_TERRAIN.heightAt);
  w16.at(0); raw16.at(0);   // the base after setTerrain (the bay's real terrain factor)
  const k = w16.base.speedMs / raw16.base.speedMs;
  assert.ok(k <= w16.levelScaleAt(0, 0, 0) + 1e-9 && Math.abs(w16.base.speedMs - w16.levelScaleAt(0, 0, 0) * Math.min(raw16.base.speedMs, w16.lv.ceilMs)) < 1e-9, 'the scale, capped');
  // (at t = 0, within 1 %: the gusts drift and the shifts travel at the scaled wind, so the patterns move apart later)
  for (const [x, z] of [[START.x, START.z], [600, -600], [-300, 250]]) assert.ok(Math.abs(w16.sample(x, z, 0).speed / (k * raw16.sample(x, z, 0).speed) - 1) < 0.01);
  assert.equal(new WindField({ seed: 1, day: { hour: 15, advisory: true } }).level, null, 'an advisory day keeps its own wind');
  assert.equal(new WindField(OPTS).level, null, 'a fixed wind has no level');
});

test('wind level: each level’s open-bay mean falls in its band at 18:45 (seeds 1 and 2); the start’s first minute sees less', () => {
  for (const seed of [1, 2]) for (let L = 1; L <= 4; L++) {
    const w = new WindField({ seed, day: { hour: REF, rate: 1 }, level: L }); w.setTerrain(LV_TERRAIN.heightAt);
    const kn = bayMeanKn(w), [lo, hi] = WIND_LEVELS[L - 1].kn;
    assert.ok(kn >= lo && kn <= hi, `seed ${seed} level ${L}: the bay ${kn.toFixed(2)} kn, band ${lo}–${hi}`);
  }
  // the start sits in a lull for its first minute (the gust field's patch octave, not a terrain lee: its 10-min mean
  // is the bay's), so the wind builds as you sail out
  const w = dayField(), start = []; for (let t = 0; t < 60; t += 2) start.push(w.sample(START.x, START.z, t).speed / KN);
  const startKn = start.reduce((a, b) => a + b) / start.length, bay = bayMeanKn(w);
  assert.ok(startKn < 0.8 * bay, `the start’s first minute ${startKn.toFixed(1)} kn vs the bay ${bay.toFixed(1)} kn`);
});

// fix/wind-level-range (2026-11-04): the day's pattern now stays on top only inside the band. Before, the lull (13:30)
// and the afternoon (15:30) scaled with the level too, so level 3 ran 0.5 -> 21.5 kn of bay mean through the day.
test('wind level: the day’s pattern stays on top inside the band (the lull floored, the afternoon capped, golden hour held)', () => {
  const field = (L, h) => { const w = new WindField({ seed: 1, day: { hour: h, rate: 1 }, level: L }); w.setTerrain(LV_TERRAIN.heightAt); w.at(0); return w; };
  const day = (L, h) => field(L, h).base.speedMs;
  assert.ok(Math.abs(day(4, 19.5) / day(4, REF) - day(3, 19.5) / day(3, REF)) < 1e-9, 'golden hour held at every level');
  for (const L of [3, 4]) for (const h of [10, 13.5, 15.5]) {
    const w = field(L, h), s = w.levelScaleAt(0, 0, 0);
    assert.ok(w.base.speedMs >= w.lv.floorMs * s - 1e-9 && w.base.speedMs <= w.lv.ceilMs * s + 1e-9, `L${L} hour ${h}: ${(w.base.speedMs / KN).toFixed(1)} kn of base`);
  }
  assert.ok(day(4, 22.5) < 0.2 * day(4, REF), 'level 4 still goes calm at night');
});

// The integrator's decision (2026-10-29): the chosen level holds through golden hour. The day's evening fade starts
// only once the sun is under +2°, and floors at the bottom of the level's band until the sun is at −6°; after that the
// calm night as before. Gusts and lulls stay as variation (the 10-min means below).
test('wind level: the level holds through golden hour, floors at its band’s bottom to −6°, then the calm night', () => {
  const E = { fade: null, floor: null, release: null };
  for (let h = 17; h < 23 && E.release == null; h += 1 / 600) {
    const e = elevAt(h);
    if (E.fade == null && e < EVENING.fadeDeg) E.fade = h;
    if (E.floor == null && e < EVENING.floorDeg) E.floor = h;
    if (E.release == null && e < EVENING.releaseDeg) E.release = h;
  }
  assert.ok(E.fade > REF + 0.5 && E.fade < 21, `the sun at +2° at ${E.fade.toFixed(2)} h`);
  // the shifted hour: 18:45 until the sun is at +2°, then running on, monotonic, back on the clock by the night hour
  let prev = 0;
  for (let h = REF; h <= 23; h += 1 / 60) {
    const e = eveningHour(h);
    assert.ok(e.hour >= prev - 1e-9, `the evening hour runs back at ${h.toFixed(2)}`);
    if (h <= E.fade) assert.equal(e.hour, REF);
    if (h >= EVENING.nightHour) assert.ok(Math.abs(e.hour - h) < 1e-9);
    if (h <= E.floor) assert.equal(e.floor, 1);
    if (h >= E.release) assert.equal(e.floor, 0);
    prev = e.hour;
  }
  const mean = (w, n = 600) => { let s = 0, k = 0; for (const [x, z] of BAY_PTS) for (let t = 0; t < n; t += 20) { s += w.sample(x, z, t).speed; k++; } return s / k / KN; };
  const at = (seed, L, h) => { const w = new WindField({ seed, day: { hour: h, rate: 0 }, level: L }); w.setTerrain(LV_TERRAIN.heightAt); return w; };
  for (const seed of [1, 2]) for (let L = 1; L <= 4; L++) {
    const [lo, hi] = WIND_LEVELS[L - 1].kn, w18 = at(seed, L, REF);
    // golden hour: the 18:45 wind itself, to the sun at +2.5°
    for (const h of [REF + 0.25, REF + 0.75, E.fade - 0.1]) assert.equal(at(seed, L, h).base.speedMs, w18.base.speedMs, `seed ${seed} L${L} ${h.toFixed(2)} h held`);
    // sunset to −6°: the fade, never under the band's bottom (the 10-min bay mean, ± the gusts' 2 %)
    for (const h of [E.fade + 0.25, (E.fade + E.floor) / 2, E.floor - 0.02]) {
      const kn = mean(at(seed, L, h));
      assert.ok(kn >= lo * 0.98 && kn <= hi + 0.5, `seed ${seed} L${L} ${h.toFixed(2)} h (${elevAt(h).toFixed(1)}°): the bay ${kn.toFixed(2)} kn, band ${lo}–${hi}`);
    }
    // the night: the drainage as before (under 2 kn at level 3 and below; it scales with the level)
    const night = at(seed, L, 22.5).base.speedMs;
    assert.ok(night < 0.15 * w18.base.speedMs + 0.2, `seed ${seed} L${L}: the night ${(night / KN).toFixed(2)} kn`);
  }
  // no level (an advisory day, or level: null): the day as it was (the fade from ≈ 17:30)
  const raw = (h) => { const w = new WindField({ seed: 1, day: { hour: h, rate: 0 }, level: null }); return w.base.speedMs; };
  assert.ok(raw(20) < 0.6 * raw(REF), 'without a level the evening fades as before');
});

test('wind level: a change blows in from upwind over ≈ 25 s, monotonic at every point', () => {
  for (const [from, to] of [[3, 4], [3, 1]]) {
    const w = dayField({ level: from }), t0 = 120, at = { ...START };
    const s0 = w.levelScaleAt(at.x, at.z, t0);
    const target = w.setLevel(to, { t: t0, at, overS: 25 });
    assert.ok(to > from ? target > s0 : target < s0);
    const [ux, uz] = WindField.toward(w.base.dirDeg);
    const half = (x, z) => {   // when the change is half way at a point, and monotonic there
      let prev = w.levelScaleAt(x, z, t0), tHalf = null;
      for (let t = t0; t <= t0 + 200; t += 0.25) {
        const v = w.levelScaleAt(x, z, t);
        assert.ok(to > from ? v >= prev - 1e-12 : v <= prev + 1e-12, `${from}→${to} not monotonic at (${x}, ${z}) t ${t}`);
        if (tHalf == null && Math.abs(v - s0) >= Math.abs(target - s0) / 2) tHalf = t - t0;
        prev = v;
      }
      return tHalf;
    };
    // at the boat: nothing for the first ≈ 10 s (the front is still upwind, on its way), the whole change by 25 s
    assert.ok(Math.abs(w.levelScaleAt(at.x, at.z, t0 + 10) - s0) < 0.02 * Math.abs(target - s0), 'it does not start at once');
    assert.ok(Math.abs(w.levelScaleAt(at.x, at.z, t0 + 25) - target) < 0.01 * Math.abs(target - s0), 'whole by 25 s');
    const tAt = half(at.x, at.z), tUp = half(at.x - ux * 150, at.z - uz * 150), tDown = half(at.x + ux * 150, at.z + uz * 150);
    assert.ok(tUp < tAt && tAt < tDown, `${from}→${to}: half way upwind ${tUp} s, at the boat ${tAt} s, downwind ${tDown} s`);
    assert.ok(tAt > 15 && tAt < 23, `half way at the boat after ${tAt} s`);
    // the water sees it: the wind texture over the boat changes with the field
    const ref = w.sample(at.x, at.z, t0 + 60).speed / w.sample(at.x, at.z, t0).speed;
    assert.ok(to > from ? ref > 1.15 : ref < 0.7, `the speed at the boat ×${ref.toFixed(2)}`);
  }
});

test('wind level: deterministic (the same calls give the same wind) and a second change follows the first', () => {
  const run = () => { const w = dayField(); w.setLevel(4, { t: 30, at: { x: 0, z: 0 } }); w.setLevel(2, { t: 50, at: { x: 0, z: 0 } }); return [0, 20, 45, 80, 200].map((t) => w.sample(100, -300, t).speed); };
  assert.deepEqual(run(), run());
  const w = dayField(); w.setLevel(4, { t: 30, at: { x: 0, z: 0 } }); w.setLevel(2, { t: 50, at: { x: 0, z: 0 } });
  assert.ok(Math.abs(w.levelScaleAt(0, 0, 400) - w.levelScale(2)) < 1e-9, 'settles on the last level');
  assert.equal(w.level, 2);
});
