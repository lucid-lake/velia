// The Ultra surface on the CPU (src/waters/ultra/surface.js) and the boat on it: the CPU reads the bytes the GPU samples,
// carries the read-back's lag forward in time, inverts the choppy map, breaks the tile lattice, and the hull's heave and
// pitch on it match the same hull on an analytic wave (RAO check against the plane wave, waves 0.3 / 1 / 2 m high).
//   node --test tests/ultra-surface.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCpuSurface, N, LENGTHS, warpAt, cascadeDamp } from '../src/sim/waters/ultra/surface.js';
import { HullFloat } from '../src/sim/boat/float.js';
import { planeBuf, wave, response, raoCase } from './helpers/cases-ultraSurface.mjs';

const G = 9.81;

test('a plane wave read back from bytes: the CPU height matches the analytic wave to 2 mm (bilinear) in deep water', () => {
  const { k, w } = wave(6), a = 0.5, s = makeCpuSurface();
  s.push(planeBuf({ m: 6, a, phase: w * 2.0 }), 2.0);
  for (const x of [0, 13.7, 41.3, 99.9, 250.2, -80.4]) {
    const h = s.heightAt(x, 7, 2.0), want = a * Math.sin(k * x - w * 2.0);
    assert.ok(Math.abs(h - want) < 0.002 + 0.002 * a, `x ${x}: ${h.toFixed(4)} vs ${want.toFixed(4)}`);
  }
});

test('no lag: carried forward along the last two reads, a read-back 1 to 3 frames behind still gives the wave at t (< 2 % of the wave)', () => {
  const { k, w } = wave(8), a = 1.0, s = makeCpuSurface(), dt = 1 / 30;
  s.push(planeBuf({ m: 8, a, phase: w * 5.0 }), 5.0);
  s.push(planeBuf({ m: 8, a, phase: w * (5.0 + dt) }), 5.0 + dt);
  let worstExt = 0, worstRaw = 0;
  for (const lag of [0.01, 0.02, 0.033, 0.05, 0.066, 0.1]) {
    const t = 5.0 + dt + lag;
    for (const x of [3.3, 27.1, 61.9, 140.4]) {
      worstExt = Math.max(worstExt, Math.abs(s.heightAt(x, 0, t) - a * Math.sin(k * x - w * t)));
      worstRaw = Math.max(worstRaw, Math.abs(s.heightAt(x, 0, 5.0 + dt) - a * Math.sin(k * x - w * t)));
    }
  }
  assert.ok(worstExt < 0.02 * a + 0.004, `extrapolated worst error ${(worstExt * 1000).toFixed(1)} mm`);
  assert.ok(worstRaw > 3 * worstExt, `without the trend the error is ${(worstRaw * 1000).toFixed(0)} mm: the extrapolation is what removes the lag`);
  // a frozen clock (a capture's settle) or a far-future query never runs away
  assert.ok(Math.abs(s.heightAt(3.3, 0, 500)) <= 1.2 * a, 'bounded far ahead');
  assert.equal(s.heightAt(3.3, 0, 5.0 + dt), s.heightAt(3.3, 0, 5.0 + dt));
});

test('the choppy map is inverted: the height at a displaced world point is the height of the point that moved there', () => {
  const a = 0.8, chop = 0.7, s = makeCpuSurface();
  s.push(planeBuf({ m: 10, a, chop }), 0);
  const { k } = wave(10);
  for (const p of [5, 20.2, 31.7, 47.9]) {
    const th = k * p, dx = -chop * a * Math.cos(th), dy = a * Math.sin(th);
    assert.ok(Math.abs(s.heightAt(p + dx, 0, 0) - dy) < 0.01, `rest ${p}: ${s.heightAt(p + dx, 0, 0).toFixed(3)} vs ${dy.toFixed(3)}`);
  }
});

test('fetch scale and depth: the 600 m cascade follows m cubed and dies in the shallows; filterM fades the 12 m cascade', () => {
  const s = makeCpuSurface(), a = 0.5;
  s.push(planeBuf({ m: 6, a }), 0);
  const x = 100 / 4;   // a crest of the 100 m wave
  const full = s.heightAt(x, 0, 0), half = s.heightAt(x, 0, 0, { m: 0.5 }), shallow = s.heightAt(x, 0, 0, { depth: 1 });
  assert.ok(Math.abs(half - full * 0.125) < 0.01, `m 0.5 gives ${half.toFixed(3)} of ${full.toFixed(3)} (x 0.125 = m^3)`);
  assert.ok(Math.abs(shallow) < 0.2 * Math.abs(full), `depth 1 m: ${shallow.toFixed(3)}`);
  const c = cascadeDamp(30); assert.deepEqual(c.map((v) => +v.toFixed(3)), [1, 1, 1]);
  const s2 = makeCpuSurface(); s2.push(planeBuf({ c: 2, m: 4, a: 0.1 }), 0);
  const peak = (o) => { let m = 0; for (let x = 0; x < 12; x += 0.1) m = Math.max(m, Math.abs(s2.heightAt(x, 0, 0, o))); return m; };
  assert.ok(peak({ filterM: 3.6 }) < 0.02 * peak({}) + 1e-6, 'a 3.6 m filter removes the 12 m cascade');
});

test('the tile break: the warp is smooth (gradient under 0.25) and the 12 m tile no longer repeats on a lattice', () => {
  let gmax = 0;
  for (let x = -500; x < 500; x += 3.7) for (let z = -500; z < 500; z += 5.3) {
    const [a, b] = warpAt(x, z), [c] = warpAt(x + 0.5, z), [, d] = warpAt(x, z + 0.5);
    gmax = Math.max(gmax, Math.abs(c - a) / 0.5, Math.abs(d - b) / 0.5);
  }
  assert.ok(gmax < 0.25, `warp gradient ${gmax.toFixed(3)}`);
  const s = makeCpuSurface(); s.push(planeBuf({ c: 2, m: 3, a: 0.1, zcycles: 1 }), 0);
  let diff = 0, n = 0;
  for (let x = 0; x < 200; x += 7.3) { diff += Math.abs(s.heightAt(x, 11, 0) - s.heightAt(x + 12, 11, 0)); n++; }
  assert.ok(diff / n > 0.015, `heights 12 m apart differ by ${(diff / n * 1000).toFixed(1)} mm on average (a lattice gives 0)`);
});

// the hull RAO on the Ultra surface (tests/helpers/cases-ultraSurface.mjs): 1 m waves here, 0.3 and 2 m in the slow lane
raoCase(1);

test('motion by wave size (hull LWL 7.26 m): chop is bridged, waves near the hull length pitch it most, a long swell lifts it; a beam sea rolls it', () => {
  const a = 0.25, swell = (lam) => { const k = 2 * Math.PI / lam, w = Math.sqrt(G * k); return { heightAt: (x, z, t, { depthM = 0 } = {}) => a * Math.sin(k * x - w * t) * Math.exp(-k * depthM) }; };
  const R = {};
  for (const lam of [1.5, 4, 8.5, 15, 30, 100]) { const r = response(swell(lam)); const k = 2 * Math.PI / lam; R[lam] = { heave: r.heave / a, pitchPerSlope: r.pitch / (a * k) }; }
  console.log('# RAO by wavelength (m): ' + Object.entries(R).map(([l, v]) => `${l}: heave ${v.heave.toFixed(2)} pitch/slope ${v.pitchPerSlope.toFixed(2)}`).join(' | '));
  assert.ok(R[1.5].heave < 0.06 && R[1.5].pitchPerSlope < 0.12, `1.5 m chop: near level, a shudder (heave ${R[1.5].heave.toFixed(3)})`);
  assert.ok(R[4].heave < 0.35, `4 m: mostly cancelled across the hull (${R[4].heave.toFixed(2)})`);
  assert.ok(R[100].heave > 0.9, `100 m swell lifts it fully (${R[100].heave.toFixed(2)})`);
  const pitchAbs = (lam) => R[lam].pitchPerSlope * (2 * Math.PI / lam);   // rad of pitch per metre of wave amplitude
  const peak = Object.keys(R).map(Number).sort((p, q) => pitchAbs(q) - pitchAbs(p))[0];
  assert.ok(peak >= 4 && peak <= 30, `the strongest pitch per metre of wave is at ${peak} m, about the hull length`);
  assert.ok(pitchAbs(8.5) > 2 * pitchAbs(1.5) && pitchAbs(8.5) > pitchAbs(100) * 0.8, 'hull-length waves pitch it more than chop or a long swell does per metre of amplitude');
  // a beam sea (swell from the side) rolls it far more than a head sea
  const roll = (heading) => { const f = new HullFloat({ surface: swell(20) }), o = []; for (let t = 0; t < 36; t += 1 / 60) o.push(f.update({ x: 0, z: 0, heading }, t, 1 / 60)); const q = o.slice(o.length >> 1).map((r) => r.roll); return Math.max(...q) - Math.min(...q); };
  assert.ok(roll(0) > 10 * (roll(Math.PI / 2) + 1e-4), `beam sea rolls ${(roll(0) * 57.3).toFixed(1)} deg range, head sea ${(roll(Math.PI / 2) * 57.3).toFixed(2)}`);
});

test('marks and buoys float on the Ultra surface: a mark follows the footprint-averaged read-back surface (correlation > 0.85, heave 0.8 to 1.5 x the wave)', async () => {
  const { MarkField } = await import('../src/sim/marks/field.js');
  const { DT } = await import('../src/sim/boat.js');
  const FAR = { x: 150, z: 0, heading: 0, u: 0, v: 0, yawRate: 0, rudderAngle: 0, heel: 0, pitch: 0, heave: 0 };
  const m8 = 8, { k, w } = wave(m8), a = 0.4, s = makeCpuSurface(), rd = 1 / 30; let last = -1;
  const surface = { heightAt: (x, z, t, o = {}) => {
    const n = Math.floor(t / rd) - 2;   // a read-back two frames behind
    if (n > last) { for (let q = Math.max(last + 1, n - 1); q <= n; q++) s.push(planeBuf({ m: m8, a, phase: w * q * rd }), q * rd); last = n; }
    return s.heightAt(x, z, t, { filterM: o.filterM ?? 0 });
  } };
  const f = new MarkField({ surface }), mk = f.add({ type: 'sphere', x: 40, z: 60 }); mk.body.rode = null;
  let t = 0; for (; t < 20; t += DT) f.step(DT, FAR, t);
  const ys = [], eta = []; const base = mk.body.design.cgHeight;
  for (let i = 0; i < 60 * 20; i++, t += DT) { f.step(DT, FAR, t); ys.push(mk.body.p[1] - base); eta.push(a * Math.sin(k * mk.body.p[0] - w * t)); }
  const mean = (v) => v.reduce((p, q) => p + q, 0) / v.length, my = mean(ys), me = mean(eta);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < ys.length; i++) { sxy += (ys[i] - my) * (eta[i] - me); sxx += (ys[i] - my) ** 2; syy += (eta[i] - me) ** 2; }
  const r = sxy / Math.sqrt(sxx * syy), gain = Math.sqrt(sxx / syy);
  assert.ok(r > 0.85, `correlation with the analytic wave ${r.toFixed(2)}`);
  assert.ok(gain > 0.8 && gain < 1.5, `heave ${gain.toFixed(2)} x the wave`);
});

test('the Smith effect: a hull of draft 0.31 m feels the 12 m cascade (1 m ripples) at 14 %, the 85 m one (6 m) at 72 %, a long swell at 95 %', () => {
  for (const [c, want] of [[2, 0.14], [1, 0.72], [0, 0.95]]) {
    const s = makeCpuSurface(), buf = planeBuf({ c, m: c === 0 ? 8 : 6, a: 0.3 }); s.push(buf, 0);
    let a0 = 0, a1 = 0;
    for (let x = 0; x < 600; x += 1.3) { a0 = Math.max(a0, Math.abs(s.heightAt(x, 0, 0))); a1 = Math.max(a1, Math.abs(s.heightAt(x, 0, 0, { depthM: 0.31 }))); }
    assert.ok(Math.abs(a1 / a0 - want) < 0.08, `cascade ${c}: ${(a1 / a0).toFixed(2)} of the wave (about ${want})`);
  }
});

test('roll in a beam sea follows the second-order theory: |H| = 1 / sqrt((1 - r^2)^2 + (2 zeta r)^2), peak near the 3.4 s roll period; 1.45 m seas (rms slope 4 to 5 deg) roll a keelboat 6 to 8 deg sd', () => {
  const f0 = new HullFloat({ surface: { heightAt: () => 0 } }), Tn = f0.periods().roll, zeta = 0.25, a = 0.2;
  const seen = [];
  for (const T of [2.5, 3.4, 4.5, 6, 9]) {
    const w = 2 * Math.PI / T, k = w * w / G, surf = { heightAt: (x, z, t, { depthM = 0 } = {}) => a * Math.sin(k * x - w * t) * Math.exp(-k * depthM) };
    const f = new HullFloat({ surface: surf }), o = [];
    for (let t = 0; t < 60; t += 1 / 120) o.push(f.update({ x: 0, z: 0, heading: 0 }, t, 1 / 120));   // bow north, the wave from the west: beam-on
    const q = o.slice(o.length >> 1).map((r) => r.roll), amp = (Math.max(...q) - Math.min(...q)) / 2;
    const r = Tn / T, H = 1 / Math.sqrt((1 - r * r) ** 2 + (2 * zeta * r) ** 2), slopeAmp = a * k * Math.exp(-k * f.depthM);
    seen.push({ T, gain: amp / slopeAmp, H });
    assert.ok(Math.abs(amp / slopeAmp - H) < 0.15 * H + 0.05, `T ${T} s: roll/slope ${(amp / slopeAmp).toFixed(2)} vs theory ${H.toFixed(2)}`);
  }
  console.log('# beam-sea roll RAO (roll / wave slope): ' + seen.map((s) => `${s.T} s ${s.gain.toFixed(2)} (theory ${s.H.toFixed(2)})`).join(' | '));
  // a 1.45 m Hs lake sea at 4.5 s with 4.2 deg rms slope: sd roll = slope x RAO
  const gain45 = seen.find((s) => s.T === 4.5).gain;
  assert.ok(4.2 * gain45 > 5 && 4.2 * gain45 < 9, `4.2 deg rms slope x ${gain45.toFixed(2)} = ${(4.2 * gain45).toFixed(1)} deg sd`);
});

test('roll damping follows the sails: 0.25 with no sail state, up to 0.45 with the full rig drawing in a breeze, less reefed, back to 0.25 furled or in no wind; resonant roll falls by the theory', () => {
  const f = new HullFloat({ surface: { heightAt: () => 0 } });
  const rig = (o = {}) => ({ x: 0, z: 0, heading: 0, apparentWind: { speed: 8 }, mainFill: 1, jibFill: 1, reef: 0, furl: 0, engineOn: false, ...o });
  assert.ok(Math.abs(f.rollZeta({ x: 0, z: 0, heading: 0 }) - 0.25) < 1e-9, 'no sail state: the hull\'s 0.25');
  const full = f.rollZeta(rig()), reefed = f.rollZeta(rig({ reef: 2 })), calm = f.rollZeta(rig({ apparentWind: { speed: 0.5 } })), down = f.rollZeta(rig({ furl: 1, engineOn: true })), luff = f.rollZeta(rig({ mainFill: 0, jibFill: 0 }));
  assert.ok(Math.abs(full - 0.45) < 1e-9, `full rig ${full.toFixed(3)}`);
  assert.ok(reefed > 0.25 && reefed < full, `reefed ${reefed.toFixed(3)}`);
  assert.ok(luff > 0.25 && luff < full, `luffing ${luff.toFixed(3)}`);
  assert.ok(calm < 0.31, `no wind ${calm.toFixed(3)}`);
  assert.ok(Math.abs(down - 0.25) < 1e-9, `furled and motoring ${down.toFixed(3)}`);
  const T = f.periods().roll, w = 2 * Math.PI / T, k = w * w / G, a = 0.2;
  const roll = (boat) => { const fl = new HullFloat({ surface: { heightAt: (x, z, t, { depthM = 0 } = {}) => a * Math.sin(k * x - w * t) * Math.exp(-k * depthM) } }); const o = []; for (let t = 0; t < 70; t += 1 / 120) o.push(fl.update({ x: 0, z: 0, heading: 0, ...boat }, t, 1 / 120)); const q = o.slice(o.length >> 1).map((r) => r.roll); return (Math.max(...q) - Math.min(...q)) / 2; };
  const bare = roll({}), sailing = roll(rig());
  assert.ok(sailing < 0.65 * bare && sailing > 0.4 * bare, `resonant roll ${(bare * 57.3).toFixed(2)} deg bare, ${(sailing * 57.3).toFixed(2)} deg with the rig (theory ratio ${(0.25 / 0.45).toFixed(2)})`);
});
