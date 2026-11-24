// The kayaks in v2 (the living lake): v1's fleet on v2's own pieces, checked against v1 itself.
//   - the lake terrain: v2's shore sampler on v1's grids gives v1's shoreDistance; buildLakeOn over it gives v1's island,
//     mouth and places (the seam src/sim/lake.js is v1's own builder, so terrain.js's object is unchanged)
//   - the fleet: v1's plan (the same slots), the first pair laid in the follow camera's view ≈ 26 m off the boat, in good
//     water for 30 s, the tiers by distance with the full tier only once the clips are in; deterministic
//   - the asset: every vertex's weights sum to 1 on known slots and classes; the clips play at v1's pace (one cycle in the
//     baked period), the surge averages 1, the poses are rigid (a rotation × the figure's scale)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTerrain } from './helpers/ground.mjs';   // the fleet on v2's own lake (v2/sim/lake.js over v2/terrain/sample.js), as the page's
import { makeTerrain as v1Terrain } from '../../src/sim/terrain.js';   // the parity reference for the lake terrain test only
import { planFleet } from '../../src/sim/kayaks/plan.js';
import { okWater } from '../../src/sim/kayaks/routes.js';
import { inflate, unpredict } from '../terrain/decode.js';
import { shoreSampler, lakeTerrain, shoreGrid, SHORE_LEVELS } from '../sim/lake.js';
import { createKayakFleet, kayakColours } from '../sim/kayaks.js';
import { parseKayakAsset, CLASSES, GAIT_NAMES } from '../render/kayak/asset.js';
import { createClips, poseRows } from '../sim/kayak-clip.js';
import { createStroke, strokeStep, lookAt } from '../sim/kayak-stroke.js';
import { HULL } from '../../src/sim/kayaks/agent.js';
import { createSplashSim } from '../living/kayaks-splash.js';

const T = makeTerrain();
const ROOT = new URL('../../', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('terrain/tahoe.json', ROOT), 'utf8'));
const DEG = Math.PI / 180;
const START = { x: 1200, z: -1050, heading: 251 * DEG };
let assetP = null;
const asset = () => (assetP ??= parseKayakAsset(readFileSync(new URL('v2/assets/kayak/kayak.kyb.gz', ROOT))));
let shoreP = null;
const shore = () => (shoreP ??= Promise.all(manifest.levels.filter((L) => SHORE_LEVELS.includes(L.name)).map(shoreGrid).map(async (g) => ({ ...g, D: unpredict(await inflate(readFileSync(new URL(`terrain/${g.file}`, ROOT))), g.dw, g.dh) }))));

test('the lake terrain: v2\'s shore sampler on v1\'s island and bay grids is v1\'s shoreDistance; buildLakeOn over it is v1\'s lake', async () => {
  const S = shoreSampler(await shore()), V1 = v1Terrain();
  let worst = 0, n = 0;
  // the bay's water and shores, clear of the bay grid's own edge (there v1 blends into the basin's grid)
  for (let z = -1700; z <= 400; z += 37) for (let x = -2200; x <= 3200; x += 41) { worst = Math.max(worst, Math.abs(S.distance(x, z) - V1.shoreDistance(x, z))); n++; }
  assert.ok(worst < 1e-6, `${n} points, the worst ${worst} m off v1's`);
  const L = lakeTerrain({ height: V1.heightAt, distance: S.distance });
  assert.deepEqual(L.lake.island, V1.lake.island, 'the fitted island');
  assert.deepEqual(L.lake.mouth, V1.lake.mouth, 'the bay\'s mouth');
  assert.deepEqual(L.places().mouth, V1.places().mouth);
  assert.deepEqual(L.lake.bay, V1.lake.bay);
});

function boatAlong(boat, dt) { boat.x += Math.sin(boat.heading) * boat.u * dt; boat.z -= Math.cos(boat.heading) * boat.u * dt; }
const followCam = (b) => { const back = 32; return { x: b.x - Math.sin(b.heading) * back, z: b.z + Math.cos(b.heading) * back, fwdX: Math.sin(b.heading), fwdZ: -Math.cos(b.heading), hHalf: Math.atan(Math.tan(20 * DEG) * 16 / 9) }; };
async function runFleet({ seconds = 30, clips = null, hour = 9, wind = 1.5 } = {}) {
  const boat = { ...START, u: 2.75, v: 0, sog: 2.75, yawRate: 0 };
  const F = createKayakFleet({ terrain: T, seed: 1, start: START, boat: () => boat, heightAt: () => 0, hour: () => hour, wind: () => wind, clips });
  const c = followCam(boat);
  const place = F.lay({ x: c.x, z: c.z, yaw: Math.atan2(c.fwdX, -c.fwdZ), hHalf: c.hHalf });
  const trace = [];
  for (let i = 0; i < seconds * 60; i++) { boatAlong(boat, 1 / 60); F.step(1 / 60, followCam(boat)); if (i % 60 === 0) trace.push(F.stats().kayaks.map((k) => [k.id, k.x, k.z, k.tier])); }
  return { F, place, trace, boat };
}

test('the fleet: v1\'s slots; the first pair laid in view ≈ 26 m off the boat, paddling in good water; the tiers wait for the clips', async () => {
  const slots = planFleet({ seed: 1, terrain: T, start: START });
  const { F, place, trace } = await runFleet({ seconds: 30 });
  assert.deepEqual(F.slots.map((s) => [s.id, s.route.id, s.s0, s.colour, s.sex, s.pfd]), slots.map((s) => [s.id, s.route.id, s.s0, s.colour, s.sex, s.pfd]), 'v1\'s plan');
  assert.ok(place && place.R >= 22 && place.R <= 38, `the pair ${place?.R} m off the boat (v1's 20–40 m)`);
  const st = F.stats();
  assert.equal(st.first.out, 2);
  for (const k of st.first.kayaks) assert.ok(k.startD >= 20 && k.startD <= 40, `${k.id} starts ${k.startD} m off`);
  for (const it of F.live.values()) assert.ok(okWater(T, it.a.x, it.a.z, 5), `${it.slot.id} in good water at (${it.a.x.toFixed(0)}, ${it.a.z.toFixed(0)})`);
  assert.ok(st.out >= 2 && st.out <= 6, `${st.out} out at 09:00`);
  assert.equal(st.tiers.full, 0, 'no full tier before the clips are in (v1: mid until the figures load)');
  assert.ok(trace.length === 30 && trace.at(-1).some(([id]) => id === 'kayak-first-0'), 'the pair stays out while the boat is near');
  // determinism: the same inputs, the same fleet to the centimetre
  const again = await runFleet({ seconds: 30 });
  assert.deepEqual(again.trace, trace);
});

test('the full tier: the pair full near the boat once the clips are in, v1\'s pace and surge move the kayak at the gait\'s speed', async () => {
  const A = await asset(), clips = createClips(A);
  const { F } = await runFleet({ seconds: 20, clips });
  const st = F.stats();
  assert.ok(st.tiers.full >= 2 && st.tiers.full <= F.LOD.maxFull, `full ${st.tiers.full}`);
  const near = F.draws.full.find((r) => r.id.startsWith('kayak-first'));
  assert.ok(near && near.phase >= 0 && near.phase < 1 && (near.sex === 'male' || near.sex === 'female'));
  const k = st.kayaks.find((q) => q.id === near.id);
  assert.ok(k.v > 0.8 && k.v < 2.2, `${k.id} at ${k.v} m/s (v1's cruise 1.31, sprint 2.01)`);
  const c = kayakColours(near);
  for (const v of Object.values(c)) assert.ok(v.length === 3 && v.every((x) => x >= 0 && x <= 1));
});

test('the asset: v1\'s kayak and paddlers, every weight sums to 1 on a known slot, every class known; the parts in range', async () => {
  const A = await asset(), J = A.json;
  assert.deepEqual(J.parts.map((p) => p.name), ['kayakNear', 'kayakFar', 'mid', 'male', 'female']);
  assert.deepEqual(J.gaits, [...GAIT_NAMES]);
  const known = new Set(Object.values(CLASSES));
  for (const p of J.parts) {
    assert.ok(p.firstVertex + p.vertexCount <= A.vertices.count && p.firstIndex + p.indexCount <= A.indices.length);
    let maxI = 0; for (let k = 0; k < p.indexCount; k++) maxI = Math.max(maxI, A.indices[p.firstIndex + k]);
    assert.ok(maxI < p.vertexCount, `${p.name}: its indices stay inside the part`);
    for (let i = 0; i < p.vertexCount; i += 17) {
      const v = A.vertices.vertex(p.firstVertex + i);
      assert.ok(Math.abs(v.w.reduce((a, b) => a + b, 0) - 1) < 2 / 255, `${p.name}#${i}: weights ${v.w}`);
      assert.ok(v.j.every((j, k) => v.w[k] === 0 || j < J.slots), `${p.name}#${i}: slot ${v.j}`);
      assert.ok(known.has(v.cls), `${p.name}#${i}: class ${v.cls}`);
    }
  }
  const tris = J.parts.reduce((a, p) => a + p.indexCount / 3, 0);
  assert.ok(tris < 100000, `${tris} triangles in all`);
});

test('the clips: one cycle takes v1\'s period, the surge averages 1, every pose is rigid at the figure\'s scale', async () => {
  const A = await asset(), C = createClips(A), J = A.json;
  for (const sex of J.sexes) for (const g of GAIT_NAMES) {
    // the time to run the phase once round at the baked rates
    let t = 0, ph = 0; const dt = 1 / 240;
    while (ph < 1 && t < 20) { ph += C.rate(sex, { [g]: 1 }, ph) * dt; t += dt; }
    assert.ok(Math.abs(t - J.periods[sex][g]) / J.periods[sex][g] < 0.03, `${sex} ${g}: ${t.toFixed(2)} s against v1's ${J.periods[sex][g]} s`);
    let s = 0; for (let j = 0; j < 64; j++) s += C.surge(sex, { [g]: 1 }, j / 64);
    assert.ok(Math.abs(s / 64 - 1) < 0.02, `${sex} ${g}: the surge's mean ${(s / 64).toFixed(3)}`);
  }
  const out = C.pose('female', { cruise: 0.6, sweepR: 0.4 }, 0.37);
  for (let sl = 0; sl < J.slots; sl++) {
    const r = (i) => [out[sl * 12 + i * 4], out[sl * 12 + i * 4 + 1], out[sl * 12 + i * 4 + 2]];
    const a = r(0), b = r(1), c = r(2), dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2], la = Math.sqrt(dot(a, a));
    assert.ok(la > 0.3 && la < 1.5, `slot ${sl}: scale ${la}`);
    assert.ok(Math.abs(Math.sqrt(dot(b, b)) - la) < 1e-3 && Math.abs(Math.sqrt(dot(c, c)) - la) < 1e-3 && Math.abs(dot(a, b)) < 1e-3 * la * la && Math.abs(dot(a, c)) < 1e-3 * la * la, `slot ${sl}: not rigid`);
  }
  // the identity slot stays the identity at every gait and phase (the kayak's own parts)
  const id = J.identitySlot * 12;
  assert.deepEqual(Array.from(out.slice(id, id + 12)).map((x) => Math.round(x * 1e4) / 1e4), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  // the pose rows of a kayak's float are three's Euler YXZ: a yaw of 90° sends the kayak's ahead (−z) to −x
  const m = poseRows({ x: 0, y: 0, z: 0, yaw: 90 * DEG, pitch: 0, roll: 0 });
  assert.ok(Math.abs(m[2] - 1) < 1e-9 && Math.abs(m[8] + 1) < 1e-9 && Math.abs(m[10]) < 1e-9, "R · (0, 0, −1) = (−1, 0, 0)");
});

// ---- the strokes' motion (fix/v2-kayak-paddlers; tools/v2-kayak-motion.mjs prints the full table) ----
// points on a figure: the centroid of the body's vertices by their main slot (bind frame), carried by that slot's rows
function figurePoints(A, sex) {
  const J = A.json, part = J.parts.find((p) => p.name === sex), acc = new Map();
  for (let i = part.firstVertex; i < part.firstVertex + part.vertexCount; i++) {
    const v = A.vertices.vertex(i); if (v.cls !== CLASSES.paddler_body) continue;
    const s = v.j[v.w.indexOf(Math.max(...v.w))], a = acc.get(s) ?? [0, 0, 0, 0];
    a[0] += v.p[0]; a[1] += v.p[1]; a[2] += v.p[2]; a[3]++; acc.set(s, a);
  }
  const c = (n) => { const s = J.bones.indexOf(n), a = acc.get(s); return { slot: s, p: [a[0] / a[3], a[1] / a[3], a[2] / a[3]] }; };
  return { handL: c('hand_l'), handR: c('hand_r'), elbowL: c('lowerarm_l'), elbowR: c('lowerarm_r'), head: c('Head'), shaft: { slot: J.paddleSlot, p: [0, 0, 0] } };
}
const at3 = (R, s, p) => { const o = s * 12; return [0, 1, 2].map((r) => R[o + r * 4] * p[0] + R[o + r * 4 + 1] * p[1] + R[o + r * 4 + 2] * p[2] + R[o + r * 4 + 3]); };
// v1's judder rule (tests/paddlerBoat.test.mjs): an acceleration reversal reversed again the next frame, each over 5 m/s²
function zigzagsPerSecond(track, dt) {
  const A2 = []; for (let i = 2; i < track.length; i++) A2.push([0, 1, 2].map((c) => (track[i][c] - 2 * track[i - 1][c] + track[i - 2][c]) / (dt * dt)));
  const L = (v) => Math.hypot(...v), dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let z = 0; for (let i = 2; i < A2.length; i++) if (dot(A2[i], A2[i - 1]) < 0 && dot(A2[i - 1], A2[i - 2]) < 0 && Math.min(L(A2[i]), L(A2[i - 1]), L(A2[i - 2])) > 5) z++;
  return z / (track.length * dt);
}

test('the strokes play smooth: v1\'s judder test at 60 Hz (at most 1 zigzag a second) in every gait and blend; the grips stay on the shaft; no roll flips', async () => {
  const A = await asset(), C = createClips(A), J = A.json, dt = 1 / 60;
  assert.equal(J.frames, 96, 'baked at 96 phases (v1\'s own clip resolution)');
  const bad = [];
  for (const sex of J.sexes) {
    const P = figurePoints(A, sex);
    for (const w of [{ cruise: 1 }, { sprint: 1 }, { back: 1 }, { sweepR: 1 }, { sweepL: 1 }, { cruise: 0.55, sweepR: 0.45 }, { cruise: 0.4, sprint: 0.6 }]) {
      const frames = []; let ph = 0.13;
      for (let i = 0; i < 300; i++) { frames.push(C.pose(sex, w, ph).slice()); ph = C.advance(sex, w, ph, dt); }
      for (const [n, q] of Object.entries(P)) {
        const z = zigzagsPerSecond(frames.map((R) => at3(R, q.slot, q.p)), dt);
        if (z > 1) bad.push(`${sex} ${JSON.stringify(w)} ${n}: ${z.toFixed(1)} zigzags a second`);
      }
      // each grip's distance from the shaft's axis (the paddle's x) moves under 4 mm (v1's grip tolerance is 5 mm; the shaft
      // turns in the fingers; cruise and sprint stay under 0.5 mm, a back stroke's fastest swing reaches 3 mm)
      for (const h of [P.handL, P.handR]) {
        const d = frames.map((R) => { const p = at3(R, h.slot, h.p), o = J.paddleSlot * 12, sc = Math.hypot(R[o], R[o + 4], R[o + 8]), q = [p[0] - R[o + 3], p[1] - R[o + 7], p[2] - R[o + 11]];
          const y = (R[o + 1] * q[0] + R[o + 5] * q[1] + R[o + 9] * q[2]) / (sc * sc), z = (R[o + 2] * q[0] + R[o + 6] * q[1] + R[o + 10] * q[2]) / (sc * sc); return Math.hypot(y, z); });
        const range = Math.max(...d) - Math.min(...d);
        if (range > 0.004) bad.push(`${sex} ${JSON.stringify(w)}: a grip moves ${(range * 1000).toFixed(1)} mm off the shaft`);
      }
      // no bone turns over 60° between two frames (v1's arm rolls flipped half a turn at a straight arm: the bake unflips them)
      for (let s = 0; s < J.bones.length; s++) for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1], b = frames[i], o = s * 12, sa = Math.hypot(a[o], a[o + 4], a[o + 8]), sb = Math.hypot(b[o], b[o + 4], b[o + 8]);
        let tr = 0; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) tr += a[o + r * 4 + c] * b[o + r * 4 + c] / (sa * sb);
        const ang = Math.acos(Math.max(-1, Math.min(1, (tr - 1) / 2))) * 180 / Math.PI;
        if (ang > 60) { bad.push(`${sex} ${JSON.stringify(w)} ${J.bones[s]}: ${ang.toFixed(0)}° in one frame`); break; }
      }
    }
  }
  assert.deepEqual(bad, []);
});

// ---- the blade held in the water (sim/kayak-stroke.js) ----
test('the blade holds: at every speed from 0.3 to 2 m/s it slips back 0–20 % of the kayak\'s travel (it was −394 % to +26 %)', async () => {
  const A = await asset(), C = createClips(A), J = A.json, dt = 1 / 60, WATER = J.kayak.draft;
  const bad = [];
  for (const sex of J.sexes) for (const [w, speeds] of [[{ cruise: 1 }, [0.3, 0.6, 1.0, 1.33, 2.0]], [{ sprint: 1 }, [1.0, 1.5, 2.0]], [{ cruise: 0.55, sweepR: 0.45 }, [0.6, 0.97]]]) for (const V of speeds) {
    const st = createStroke({ clips: C, sex, seed: 5, phase: 0.1 }), a = { v: V, w, look: null };
    let s = 0, bt = 0, kt = 0, n = 0; const wet = [false, false], s0 = [null, null];
    for (let i = 0; i < 14 * 60; i++) {
      strokeStep(st, a, dt); s += V * dt;
      if (i < 60) continue;
      const b = C.blade(sex, w, st.ph, st.body);
      for (let k = 0; k < 2; k++) {
        const isWet = b[3 * k + 1] < WATER - 0.02, xw = s - b[3 * k + 2];   // (ahead is −z: the blade's place along the track)
        if (isWet && !wet[k]) s0[k] = { xw, s };
        if (!isWet && wet[k] && s0[k]) { bt += xw - s0[k].xw; kt += s - s0[k].s; n++; }
        wet[k] = isWet;
      }
    }
    const slip = 100 * bt / kt;
    if (!(n >= 3 && slip <= 0 && slip >= -20)) bad.push(`${sex} ${JSON.stringify(w)} at ${V} m/s: ${n} strokes, slip ${slip.toFixed(1)} %`);
  }
  assert.deepEqual(bad, []);
});

// BACKLOG-v2 #45: the held blade's centre in the world, along the track, inside each wet window (centre ≥ 2 cm under): what is
// left after a straight line (the steady slip) is the lock's wobble. Was 1.6–2.4 cm in cruise (the lock on the stroke's mean);
// the sprint keeps most of the mean (its catch), so it only must not get worse. And the strokes as played (the lock's pace,
// the paddler's own manner) still pass v1's judder rule in every gait and blend
test('the held blade stays put: under 1 cm of wobble a cruise stroke, the sprint no worse than 4 cm; v1\'s judder rule on the played strokes', async () => {
  const A = await asset(), C = createClips(A), J = A.json, dt = 1 / 60, WATER = J.kayak.draft;
  const bad = [], fit = (q) => { const n = q.length, mx = (n - 1) / 2, my = q.reduce((a, y) => a + y, 0) / n; let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (i - mx) * (q[i] - my); sxx += (i - mx) ** 2; } const r = q.map((y, i) => y - my - (sxy / sxx) * (i - mx)); return Math.max(...r) - Math.min(...r); };
  for (const sex of J.sexes) for (const [w, V, limit] of [[{ cruise: 1 }, 1.31, 0.01], [{ cruise: 1 }, 0.6, 0.01], [{ sprint: 1 }, 2.01, 0.04]]) {
    const st = createStroke({ clips: C, sex, seed: 7, phase: 0.1 }), a = { v: V, w, look: null };
    let s = 0; const wet = [false, false], seg = [[], []], wob = [];
    for (let i = 0; i < 14 * 60; i++) {
      strokeStep(st, a, dt); s += V * dt;
      if (i < 60) continue;
      const b = C.blade(sex, w, st.ph, st.body);
      for (let k = 0; k < 2; k++) { const isWet = b[3 * k + 1] < WATER - 0.02; if (isWet) seg[k].push(s - b[3 * k + 2]); if (!isWet && wet[k]) { if (seg[k].length >= 4) wob.push(fit(seg[k])); seg[k] = []; } wet[k] = isWet; }
    }
    const mean = wob.reduce((x, y) => x + y, 0) / wob.length;
    if (!(wob.length >= 5 && mean <= limit)) bad.push(`${sex} ${JSON.stringify(w)} at ${V} m/s: ${(100 * mean).toFixed(1)} cm of wobble over ${wob.length} strokes (limit ${100 * limit})`);
  }
  const P = figurePoints(A, 'male');
  for (const sex of J.sexes) for (const [w, V] of [[{ cruise: 1 }, 1.31], [{ sprint: 1 }, 2.01], [{ back: 1 }, -1.11], [{ sweepR: 1 }, 0.86], [{ sweepL: 1 }, 0.86], [{ cruise: 0.55, sweepR: 0.45 }, 0.97], [{ cruise: 0.4, sprint: 0.6 }, 1.73]]) {
    const st = createStroke({ clips: C, sex, seed: 7, phase: 0.1 }), a = { v: V, w, look: null }, frames = [];
    for (let i = 0; i < 360; i++) { strokeStep(st, a, dt); if (i >= 60) frames.push(C.pose(sex, w, st.ph, new Float32Array(J.slots * 12), st.body)); }
    for (const [n, q] of Object.entries(sex === 'male' ? P : figurePoints(A, sex))) {
      const z = zigzagsPerSecond(frames.map((R) => at3(R, q.slot, q.p)), dt);
      if (z > 1) bad.push(`${sex} ${JSON.stringify(w)} ${n}: ${z.toFixed(1)} zigzags a second as played`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the stroke drives the hull: the hull model\'s speeds, 90 % of cruise within 5 strokes, a 6–9 % surge, the bow kicked 1–3° a stroke', async () => {
  const A = await asset(), C = createClips(A), dt = 1 / 60;
  const run = (sex, w, secs, v0 = 0) => {
    const st = createStroke({ clips: C, sex, seed: 5, phase: 0.1 }), a = { v: v0, w, look: null }, log = [];
    let r = 0, h = 0;
    for (let i = 0; i < secs * 60; i++) {
      const o = strokeStep(st, a, dt);
      const acc = (v) => (o.F - HULL.K * v * Math.abs(v) - HULL.C * v) / HULL.M;
      a.v += acc(a.v + 0.5 * dt * acc(a.v)) * dt; r += (o.M - HULL.D * r) / HULL.I * dt; h += r * dt;
      log.push({ t: i * dt, v: a.v, h, catch: o.events.some((e) => e.type === 'catch') });
    }
    return log;
  };
  for (const sex of ['male', 'female']) {
    const L = run(sex, { cruise: 1 }, 30), steady = L.filter((q) => q.t > 15), mean = steady.reduce((x, q) => x + q.v, 0) / steady.length;
    assert.ok(Math.abs(mean - 1.31) < 0.07, `${sex}: cruise ${mean.toFixed(3)} m/s (the hull model's 1.31)`);
    const ripple = (Math.max(...steady.map((q) => q.v)) - Math.min(...steady.map((q) => q.v))) / mean;
    assert.ok(ripple > 0.06 && ripple < 0.09, `${sex}: a ${(100 * ripple).toFixed(1)} % surge a stroke (v1's 7.5 %)`);
    const reach = L.find((q) => q.v > 0.9 * mean).t, strokes = L.filter((q) => q.catch && q.t < reach).length;
    assert.ok(strokes <= 5, `${sex}: 90 % of cruise after ${strokes} strokes`);
    const catches = L.filter((q) => q.catch && q.t > 15).map((q) => q.t), swings = [];
    for (let i = 1; i < catches.length; i++) { const seg = L.filter((q) => q.t >= catches[i - 1] && q.t < catches[i]).map((q) => q.h); swings.push((Math.max(...seg) - Math.min(...seg)) * 180 / Math.PI); }
    const sw = swings.reduce((x, y) => x + y, 0) / swings.length;
    assert.ok(sw >= 1 && sw <= 3, `${sex}: the bow swings ${sw.toFixed(2)}° a stroke`);
    const sp = run(sex, { sprint: 1 }, 30, 1.3).filter((q) => q.t > 15), spMean = sp.reduce((x, q) => x + q.v, 0) / sp.length;
    assert.ok(Math.abs(spMean - 2.01) < 0.1, `${sex}: sprint ${spMean.toFixed(3)} m/s (the hull model's 2.01)`);
  }
});

test('the strokes are deterministic: the same fleet, the same steps, the same stroke and pose at every time', async () => {
  const A = await asset(), clips = createClips(A);
  const once = async () => { const { F } = await runFleet({ seconds: 15, clips }); return F.draws.full.map((r) => [r.id, r.phase, r.x, r.z, r.y, r.yaw, r.pitch, r.roll, JSON.stringify(r.body)]); };
  const a = await once(), b = await once();
  assert.ok(a.length >= 2);
  assert.deepEqual(a, b);
  // and the pose at that state is a pure function of it
  const r = a[0], st = { w: { cruise: 1 } };
  assert.deepEqual(Array.from(clips.pose('male', st.w, r[1], undefined, JSON.parse(r[8]))), Array.from(clips.pose('male', st.w, r[1], undefined, JSON.parse(r[8]))));
});

// ---- the head and each paddler's own manner ----
test('the head keeps 10 % of the hull\'s roll and turns to the sloop within ±75°; each paddler strokes at its own rate, the pair never in step', async () => {
  const A = await asset(), C = createClips(A), J = A.json, head = J.bones.indexOf('Head');
  // the head's tilt in the world (its up vector about the kayak's long axis) under a 0.1 rad hull roll, held back by 90 %
  const tilt = (rows, roll) => { const o = head * 12, ux = rows[o + 1], uy = rows[o + 5], c = Math.cos(roll), s = Math.sin(roll); return Math.atan2(c * ux - s * uy, s * ux + c * uy); };
  for (const sex of J.sexes) for (const ph of [0.05, 0.3, 0.55, 0.8]) {
    const free = tilt(C.pose(sex, { cruise: 1 }, ph, undefined, null), 0), rolled = tilt(C.pose(sex, { cruise: 1 }, ph, undefined, { roll: -0.09 }), 0.1);
    const kept = (free - rolled) / 0.1;   // (a roll to starboard-up tilts the up vector toward port: a negative tilt here)
    assert.ok(kept > 0.05 && kept < 0.3, `${sex} at ${ph}: the head keeps ${(100 * kept).toFixed(0)} % of the hull's roll`);
  }
  // the look: the sloop near and ahead to port is watched, one behind is not; the head turns no further than 75°
  assert.equal(lookAt({ x: 0, z: 0, heading: 0, look: null }, { x: -10, z: -10 }).toFixed(0), '-45');
  assert.equal(lookAt({ x: 0, z: 0, heading: 0, look: null }, { x: 0, z: 20 }), null, 'behind: not watched');
  assert.equal(lookAt({ x: 0, z: 0, heading: 0, look: null }, { x: 0, z: -40 }), null, 'far: the mind\'s glances only');
  const st = createStroke({ clips: C, sex: 'male', seed: 3 }), a = { v: 1.3, w: { cruise: 1 }, look: null, lookDeg: 120 };
  for (let i = 0; i < 180; i++) strokeStep(st, a, 1 / 60);
  assert.ok(Math.abs(st.body.yaw - 75 * Math.PI / 180) < 1e-3, `the head's look ${(st.body.yaw * 180 / Math.PI).toFixed(1)}° (its range 75°)`);
  const fwd = (rows) => { const o = head * 12; return Math.atan2(rows[o + 2], rows[o + 10]); };
  const t0 = fwd(C.pose('male', { cruise: 1 }, 0.3, undefined, { yaw: st.body.yaw })) - fwd(C.pose('male', { cruise: 1 }, 0.3, undefined, null)), turn = Math.atan2(Math.sin(t0), Math.cos(t0));
  assert.ok(Math.abs(Math.abs(turn) - 75 * Math.PI / 180) < 0.05, `the head turned ${(turn * 180 / Math.PI).toFixed(1)}°`);
  // each paddler's own rate, reach and rotation; the first pair's strokes drift apart (their phases correlate under 0.5 over 60 s)
  const { F } = await runFleet({ seconds: 1, clips: C });
  const pair = [...F.live.values()].filter((it) => it.slot.group === 'first').map((it) => it.st);
  assert.equal(pair.length, 2);
  assert.notEqual(pair[0].rateK, pair[1].rateK);
  const P0 = [], P1 = [];
  for (let i = 0; i < 60 * 60; i++) { F.step(1 / 60); P0.push(Math.cos(2 * Math.PI * pair[0].ph)); P1.push(Math.cos(2 * Math.PI * pair[1].ph)); }
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length, m0 = mean(P0), m1 = mean(P1);
  let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < P0.length; i++) { sxy += (P0[i] - m0) * (P1[i] - m1); sxx += (P0[i] - m0) ** 2; syy += (P1[i] - m1) ** 2; }
  const corr = sxy / Math.sqrt(sxx * syy);
  assert.ok(Math.abs(corr) < 0.5, `the pair's strokes correlate ${corr.toFixed(2)}`);
});

// ---- the water off the blades (living/kayaks-splash.js) ----
test('the splash: a burst at each catch at the blade\'s own point, drips off the tip after each exit, nothing on or under the water', async () => {
  const A = await asset(), clips = createClips(A);
  const { F } = await runFleet({ seconds: 2, clips });
  const S = createSplashSim({ seed: 1 }), ev = [];
  let lowest = Infinity, maxDrops = 0;
  for (let i = 0; i < 12 * 60; i++) {
    F.step(1 / 60);
    for (const e of F.splash) {
      ev.push(e);
      const n0 = S.count;
      if (e.type === 'catch') {
        S.catch(e.at, e.water, e.s);
        // the burst rises off the water where the blade went in (within 5 cm of its point across the water)
        for (const d of S.P.slice(n0)) assert.ok(Math.hypot(d.x - e.at[0], d.z - e.at[2]) < 0.05 && Math.abs(d.y - e.water - 0.01) < 1e-9);
        // the blade's point is at the surface as it goes in
        assert.ok(e.at[1] - e.water < 0.05 && e.at[1] - e.water > -0.2, `a catch ${(e.at[1] - e.water).toFixed(3)} m off the water`);
      } else S.exit(e.key, e.water, e.s);
    }
    S.update(1 / 60, (k) => F.tips.get(k));
    for (const d of S.P) lowest = Math.min(lowest, d.y - d.water);
    maxDrops = Math.max(maxDrops, S.count);
  }
  const catches = ev.filter((e) => e.type === 'catch').length, exits = ev.filter((e) => e.type === 'exit').length;
  assert.ok(catches >= 12 && exits >= 12, `${catches} catches, ${exits} exits in 12 s (two paddlers at ≈ 30 strokes a side a minute)`);
  assert.ok(lowest > -0.15, `a droplet ${lowest.toFixed(3)} m under the water (they go when they fall back through it)`);
  assert.ok(maxDrops > 10 && maxDrops <= 320, `${maxDrops} droplets at most`);
  // the drips follow the blade's tip for v1's 0.7 s after the exit
  const S2 = createSplashSim({ seed: 2 }); let tip = [0, 0.5, 0]; S2.exit('k', 0, 1);
  let alive = 0; for (let i = 0; i < 60; i++) { tip = [0, 0.5 + i * 0.01, 0]; S2.update(1 / 60, () => tip); if (S2.drips) alive = (i + 1) / 60; }
  assert.ok(alive > 0.6 && alive < 0.75, `drips for ${alive.toFixed(2)} s`);
});
