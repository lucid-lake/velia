// M4: the skipper's instruments (v2/render/boat/instruments.js, the pure half of render/boatInstruments.js) against v1's
// behaviour (src/boat/instruments.js, three-bound, so its numbers are restated here; the night palette and gains are
// v1's own module, src/boat/nightLight.js, imported): the card holds north on the boat's pose, the bow mark reads the
// heading, the redraw rule (≤ 10 Hz, only on a move, at once on a palette switch), the speed's damping, the night set.
import test from 'node:test';
import assert from 'node:assert/strict';
import { INSTRUMENTS, KNOT, instrumentLogic, cardLocal, podLocal, cardMarkAt, drawDisplay, drawCard } from '../render/boat/instruments.js';
import { faceMesh, solidMesh, exposureComp } from '../render/boatInstruments.js';
import { FACE_PALETTE, faceGain, nightK, NIGHT_FACE } from '../../src/boat/nightLight.js';
import { multiply } from '../engine/math.js';

const DEG = Math.PI / 180;
const near = (a, b, e = 1e-9, m = '') => assert.ok(Math.abs(a - b) <= e, `${m} ${a} vs ${b}`);
const angDiff = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
// the boat's root as render/boat.js builds it for a level hull at the origin: Ry(−heading) (column-major)
const rootFor = (h) => { const c = Math.cos(-h), s = Math.sin(-h); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const dirOf = (m, v) => [0, 1, 2].map((r) => m[r] * v[0] + m[4 + r] * v[1] + m[8 + r] * v[2]);
const state = (o = {}) => ({ heading: 0, sog: 3, groove: 0, apparentWind: { angle: 30 * DEG }, trueWind: { angle: 45 * DEG }, ...o });

test('v1\'s spots and numbers: the card under the dome on the pedestal, the pod on the guard rail facing the helm', () => {
  assert.deepEqual([...INSTRUMENTS.card.at], [0, 1.305, 2.45]); assert.equal(INSTRUMENTS.card.r, 0.072);
  assert.deepEqual([...INSTRUMENTS.display.at], [0, 1.335, 2.33]);
  assert.deepEqual([INSTRUMENTS.display.w, INSTRUMENTS.display.h, INSTRUMENTS.display.tiltDeg], [0.12, 0.06, 25]);
  assert.equal(INSTRUMENTS.hz, 10); assert.deepEqual([...INSTRUMENTS.dampS], [1, 2.5]);
  // the card sits inside the dome (blender/m3_cockpit.py: the axle 1.20 m up, the dome 0.10–0.16 m above it, r 0.10 → 0.04)
  const above = INSTRUMENTS.card.at[1] - 1.20; assert.ok(above > 0.10 && above < 0.16);
  assert.ok(INSTRUMENTS.card.r < 0.10 - (0.06 * (above - 0.10)) / 0.06);
});

test('the card holds north: its canvas north points to world north (−z) at every heading; the card turns by the heading', () => {
  const m = new Float32Array(16), w = new Float32Array(16);
  for (let hd = -180; hd <= 360; hd += 15) {
    const L = instrumentLogic(); const r = L.update(state({ heading: hd * DEG }), 0);
    near(r.cardAngle, hd * DEG, 1e-12, 'v1: rotation.z = heading');
    multiply(w, rootFor(hd * DEG), cardLocal(m, r.cardAngle));
    const n = dirOf(w, [0, 1, 0]);   // the canvas's top (N) in the card's local frame
    near(n[0], 0, 1e-6, `north x at ${hd}`); near(n[1], 0, 1e-6, `north y at ${hd}`); near(n[2], -1, 1e-6, `north z at ${hd}`);
    const up = dirOf(w, [0, 0, 1]); near(up[1], 1, 1e-6, 'the face looks up');
  }
  // the sign: a boat turning to starboard (heading up) turns its card counter-clockwise seen from above, relative to the hull
  const a = new Float32Array(16), b = new Float32Array(16);
  const ya = dirOf(cardLocal(a, 0), [0, 1, 0]), yb = dirOf(cardLocal(b, 10 * DEG), [0, 1, 0]);
  const cross = ya[2] * yb[0] - ya[0] * yb[2];   // (a × b)·up, x east-like (starboard), z aft
  assert.ok(cross > 0, 'counter-clockwise seen from above');
});

test('the bow mark reads the heading; v1\'s lubber line (the aft edge) sits over the reciprocal', () => {
  for (let hd = 0; hd < 360; hd += 7) {
    const L = instrumentLogic(); const r = L.update(state({ heading: hd * DEG }), 0);
    near(angDiff(cardMarkAt(r.cardAngle, 0, -1), hd), 0, 1e-6, `bow at ${hd}`);
    const lub = INSTRUMENTS.lubber, lz = INSTRUMENTS.card.r * lub.rK;   // the lubber's offset from the card's centre (HULL frame, +z aft)
    near(angDiff(cardMarkAt(r.cardAngle, 0, Math.sign(lz)), hd + 180), 0, 1e-6, `lubber at ${hd}`);
  }
});

test('the redraw rule: the first update draws; then at most 10 a second, and only when the needle moves 1.5° or the numeral 0.08 kn', () => {
  const L = instrumentLogic().light({ elevDeg: 60 });
  let t = 0; const s = state();
  assert.equal(L.update(s, t).redraw, true, 'the first update');
  t += 0.05; assert.equal(L.update(state({ apparentWind: { angle: 60 * DEG } }), t).redraw, false, 'inside 1/10 s: never');
  t += 0.06; assert.equal(L.update(state({ apparentWind: { angle: 60 * DEG } }), t).redraw, true, 'after 1/10 s: the needle moved');
  t += 0.2; assert.equal(L.update(state({ apparentWind: { angle: 61 * DEG } }), t).redraw, false, '1° is under the move');
  t += 0.2; assert.equal(L.update(state({ apparentWind: { angle: 61.6 * DEG } }), t).redraw, true, '1.6° from the last drawn');
  // a steady boat: no redraws at all once the damping has settled
  let n = 0; for (let i = 0; i < 600; i++) { t += 1 / 60; if (L.update(state({ apparentWind: { angle: 61.6 * DEG } }), t).redraw) n++; }
  assert.ok(n <= 3, `steady: ${n} redraws in 10 s (the damped speed settles from the start value only)`);
  for (let i = 0; i < 30; i++) { t += 1 / 60; L.update(state({ apparentWind: { angle: 61.6 * DEG } }), t); }
  const s2 = state({ apparentWind: { angle: 61.6 * DEG }, sog: 3 + 0.1 * KNOT });
  let drew = false; for (let i = 0; i < 300 && !drew; i++) { t += 1 / 60; drew = L.update(s2, t).redraw; }
  assert.ok(drew, 'a 0.1 kn change redraws once the damped value has moved 0.08 kn');
  // ≤ 10 Hz whatever moves: a needle swinging every frame for 2 s
  n = 0; for (let i = 0; i < 120; i++) { t += 1 / 60; if (L.update(state({ apparentWind: { angle: (i * 5) * DEG } }), t).redraw) n++; }
  assert.ok(n <= 21 && n >= 18, `swinging: ${n} redraws in 2 s`);
});

test('the night switch redraws at once in the night set; the face\'s gain and the card\'s red light are v1\'s (nightLight.js)', () => {
  const L = instrumentLogic().light({ elevDeg: 30 });
  let r = L.update(state(), 0); assert.equal(r.redraw, true); assert.equal(r.palette, FACE_PALETTE.day);
  r = L.update(state(), 0.01); assert.equal(r.redraw, false);
  L.light({ elevDeg: -10, exposureComp: 0.3 });
  r = L.update(state(), 0.02); assert.equal(r.redraw, true, 'the palette switch forces a redraw inside the 1/10 s'); assert.equal(r.palette, FACE_PALETTE.night);
  near(L.gain, faceGain({ elevDeg: -10, exposureComp: 0.3 }), 1e-12); near(L.gain, 0.3 * NIGHT_FACE.gain, 1e-12);
  near(L.cardEmissive, 0.1 * nightK(-10) * 0.3, 1e-12);
  L.light({ elevDeg: 45, exposureComp: 1 }); near(L.gain, 1, 1e-12); assert.equal(L.cardEmissive, 0);
  assert.equal(L.update(state(), 0.03).palette, FACE_PALETTE.day);
  // v2's exposure compensation: 1 under a high sun, under 1 toward dusk (the exposure factor rises), never above 1
  near(exposureComp(70), 1, 1e-12); assert.ok(exposureComp(2) < 0.5); for (let e = -20; e <= 90; e += 5) assert.ok(exposureComp(e) <= 1 + 1e-12);
});

test('the speed\'s damping: a first-order lag of 1 s out of the groove, 2.5 s locked in (v1\'s groove term)', () => {
  for (const [groove, tau] of [[0, 1], [1, 2.5], [0.5, 1.75]]) {
    const L = instrumentLogic(); let t = 0;
    L.update(state({ sog: 0, groove }), t);   // starts on the raw value
    assert.equal(L.kn, 0);
    for (let i = 0; i < 60; i++) { t += 1 / 60; L.update(state({ sog: 4 * KNOT, groove }), t); }
    near(L.kn, 4 * (1 - Math.exp(-1 / tau)), 1e-9, `groove ${groove}`);
  }
  // a pause (dt > 1 s) moves at most one second's worth
  const L = instrumentLogic(); L.update(state({ sog: 0 }), 0); L.update(state({ sog: 2 * KNOT }), 5);
  near(L.kn, 2 * (1 - Math.exp(-1)), 1e-9);
});

test('the pod\'s face draws the damped speed to a tenth in the palette\'s inks; the card draws its 12 numerals and letters', () => {
  const calls = [];
  const g = new Proxy({}, { get: (o, k) => (k in o ? o[k] : (...a) => calls.push([k, ...a])), set: (o, k, v) => { o[k] = v; calls.push(['set', k, v]); return true; } });
  drawDisplay(g, 256, 128, { awaDeg: 30, kn: 5.96 }, FACE_PALETTE.night);
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.deepEqual(texts, ['6.0', 'kn']);
  assert.ok(calls.some((c) => c[0] === 'set' && c[1] === 'fillStyle' && c[2] === FACE_PALETTE.night.bg));
  calls.length = 0; drawDisplay(g, 256, 128, { kn: 5, trend: { kind: 'lift', level: 1 } });
  assert.deepEqual(calls.filter((c) => c[0] === 'fillText').map((c) => c[1]), ['5.0', 'kn', 'LIFT']);
  calls.length = 0; drawCard(g, 256);
  assert.deepEqual(calls.filter((c) => c[0] === 'fillText').map((c) => c[1]), ['N', '3', '6', 'E', '12', '15', 'S', '21', '24', 'W', '30', '33']);
});

test('the meshes: the card disc and the pod quad face +z (counter-clockwise), canvas north on the disc\'s +y; the boxes wind outward', () => {
  const f = faceMesh();
  const tri = (P, I, k) => [0, 1, 2].map((j) => [P[I[k + j] * 3], P[I[k + j] * 3 + 1], P[I[k + j] * 3 + 2]]);
  const nrmOf = ([a, b, c]) => { const u = b.map((v, i) => v - a[i]), w = c.map((v, i) => v - a[i]); return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; };
  for (let k = 0; k < f.index.length; k += 3) assert.ok(nrmOf(tri(f.position, f.index, k))[2] > 0, `face tri ${k / 3}`);
  // the disc's top vertex (local +y) samples the canvas's top row (v = 0: WebGPU's texel row 0), the centre the middle
  let top = 0; for (let i = 0; i < f.position.length / 3; i++) if (f.position[i * 3 + 1] > f.position[top * 3 + 1]) top = i;
  near(f.uv[top * 2], 0.5, 1e-6); near(f.uv[top * 2 + 1], 0, 1e-6);
  assert.equal(f.ranges.card.count + f.ranges.face.count + f.ranges.vhf.count, f.index.length);   // #35: + the VHF set's face
  const s = solidMesh();
  for (const [name, r] of Object.entries(s.ranges)) {
    let cx = 0, cy = 0, cz = 0; const ids = [...s.index.slice(r.first, r.first + r.count)];
    for (const i of ids) { cx += s.position[i * 3]; cy += s.position[i * 3 + 1]; cz += s.position[i * 3 + 2]; }
    cx /= ids.length; cy /= ids.length; cz /= ids.length;
    for (let k = r.first; k < r.first + r.count; k += 3) {
      const t = tri(s.position, s.index, k), n = nrmOf(t), m = t[0].map((v, i) => (v + t[1][i] + t[2][i]) / 3);
      assert.ok(n[0] * (m[0] - cx) + n[1] * (m[1] - cy) + n[2] * (m[2] - cz) > 0, `${name} tri ${k} winds outward`);
    }
  }
  // the pod's face sits just proud of its bezel; the pod's frame leans as v1's rotation.x = +25°
  assert.ok(INSTRUMENTS.display.faceZ > INSTRUMENTS.display.depth / 2);
  const p = podLocal(new Float32Array(16)); near(p[9], -Math.sin(25 * DEG), 1e-6); near(p[10], Math.cos(25 * DEG), 1e-6);
});
