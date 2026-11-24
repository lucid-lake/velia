// M3b: v1's boat models built for v2 (render/boat/models.js) from v1's own GLBs: every triangle placed (the per-file
// counts in models/boat/*.json), v1's sockets (hardware at the freeboard, the anchor at its pin, the wheel in its own
// frame, the traveller car on its node), v1's material rules (hullMaterials.js, cockpitLook.js, canvas.js), the LOD
// sets, and the packed copies giving the same boat within the quantization step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { parseGlb } from '../engine/gltf.js';
import { buildLifeRing, ORANGE } from '../render/boat/lifeRing.js';
import { buildBoatModels, v1Material, KIND, MAT_FLOATS, RANGES, faded, hexLinear, whiteData } from '../render/boat/models.js';
import { packGlb, BOAT_MODELS } from '../../tools/build/glb-pack.mjs';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import CANVAS from '../../src/boat/canvas.json' with { type: 'json' };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const raw = Object.fromEntries(BOAT_MODELS.map((n) => [n, readFileSync(resolve(ROOT, 'models/boat', `${n}.glb`))]));
const info = (n) => JSON.parse(readFileSync(resolve(ROOT, 'models/boat', `${n}.json`), 'utf8'));
const canvas = CANVAS.variants[CANVAS.default];
const build = (bufs) => buildBoatModels(Object.fromEntries(Object.entries(bufs).map(([k, v]) => [k, parseGlb(v)])), { dims: DEFAULT_DIMS, canvas });
const SET = build(raw);
const STAND_IN = 12 + 2 * 8 + 2 * 6 * 8;   // the throttle's pod (a box), lever (an 8-sided prism) and knob (8 × 6 sphere)
// the life ring (render/boat/lifeRing.js): hardware.glb's white ring (448 gelcoat triangles) and its 320 strip triangles are dropped, the orange one added
const RING_OLD = 448 + 320, RING_NEW = buildLifeRing(DEFAULT_DIMS.HULL.freeboard).reduce((a, o) => a + o.prim.indices.array.length / 3, 0);

test('every triangle of v1 four GLBs lands once (models/boat/*.json counts) plus the throttle stand-in, the life ring swapped', () => {
  const T = SET.triangles, sum = RANGES.reduce((a, r) => a + T[r], 0);
  const want = info('hull').triangles + info('hardware').triangles + info('cockpit').triangles.cockpit + info('cockpit').triangles.wheel;
  assert.equal(sum, want + STAND_IN - RING_OLD + RING_NEW);
  assert.equal(T.wheel, info('cockpit').triangles.wheel);
  assert.equal(T.far, info('cockpit').triangles.cockpit_far_only);
  assert.equal(T.near + T.cabin + T.portal, info('cockpit').triangles.cockpit_near_only);
  assert.ok(T.glass > 1000 && T.detail > 1000 && T.traveller > 100, JSON.stringify(T));
  assert.equal(SET.index.length, sum * 3);
  for (const a of [SET.position, SET.normal, SET.uv]) for (const v of a) assert.ok(Number.isFinite(v));
  for (const i of SET.index) assert.ok(i < SET.vertices);
  for (const m of SET.mat) assert.ok(m < SET.materials.length / MAT_FLOATS);
});

// the HULL-frame bounds of one range's vertices
function bounds(set, range) {
  const r = set.ranges[range], mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let k = r.first; k < r.first + r.count; k++) { const i = set.index[k]; for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], set.position[i * 3 + c]); mx[c] = Math.max(mx[c], set.position[i * 3 + c]); } }
  return { mn, mx };
}

test('placements: the hull at its socket, the hardware raised by the freeboard, the anchor at its pin, the wheel and car in their own frames', () => {
  const H = DEFAULT_DIMS.HULL, all = bounds(SET, 'always');
  assert.ok(Math.abs(all.mx[0] - info('hull').beam_m / 2) < 0.02, `half beam ${all.mx[0]}`);
  assert.ok(all.mn[2] < -4.2 && all.mx[2] > 4.6, 'bow to the stern platform');
  // the pulpit's top rail (hardware.glb's stainless, 0.74 m up in its own frame) stands on the deck: + the freeboard
  assert.ok(all.mx[1] > 0.74 + H.freeboard - 0.02, `the top of the rails ${all.mx[1]}`);
  // the stowed anchor: its shackle at HULL.anchorPin (body.js); its vertices within 0.7 m of it
  const pin = H.anchorPin; let near = 0;
  for (let i = 0; i < SET.vertices; i++) { const d = Math.hypot(SET.position[i * 3] - pin[0], SET.position[i * 3 + 1] - pin[1], SET.position[i * 3 + 2] - pin[2]); if (d < 0.02) near++; }
  assert.ok(near > 0, 'a vertex at the anchor pin');
  const w = bounds(SET, 'wheel');
  assert.ok(Math.abs(w.mx[0] - info('cockpit').wheel_diameter_m / 2) < 0.03 && Math.abs(w.mn[2]) < 0.1, `the wheel round its axle ${JSON.stringify(w)}`);
  const t = bounds(SET, 'traveller');
  assert.ok(Math.abs(t.mn[1]) < 0.01 && t.mx[1] < 0.2, 'the car relative to its node');
  assert.ok(Math.abs(SET.traveller.y0 - info('cockpit').traveller_hull_frame[1]) < 0.01 && Math.abs(SET.traveller.z0 - 0.7) < 1e-6);
});

test('v1 material rules: gelcoat, white-data copies scaled, stainless, the turned wheel, the canvas variant, clear vinyl, smoked side panels, the cabin', () => {
  const rec = (name) => SET.records.find((r) => r.name === name);
  assert.equal(rec('gelcoat').kind, KIND.gelcoat); assert.equal(rec('gelcoat').scale, 1);
  assert.equal(rec('gelcoat.001').kind, KIND.gelcoat); assert.equal(rec('gelcoat.001').scale, 0.68, 'the cockpit gelcoat (white COLOR_0) at the hull albedo');
  assert.equal(rec('nonskid').kind, KIND.nonskid); assert.equal(rec('antifouling').kind, KIND.antifouling); assert.equal(rec('teak_deck').kind, KIND.teak);
  assert.ok(SET.records.filter((r) => r.kind === KIND.stainless).length >= 1);
  assert.deepEqual(rec('stainless_turned').base.slice(0, 3), [0.800000011920929, 0.800000011920929, 0.8199999928474426]); assert.equal(rec('stainless_turned').rough, 0.16);
  assert.deepEqual(rec('canvas').base.slice(0, 3), faded(canvas.canvas)); assert.deepEqual(rec('dodger_trim').base.slice(0, 3), faded(canvas.trim));
  assert.equal(rec('dodger_vinyl').kind, KIND.glass); assert.equal(rec('dodger_vinyl').opacity, 0.10);
  assert.equal(rec('dodger_side_window').kind, KIND.glass); assert.equal(rec('dodger_side_window').opacity, 0.22);
  assert.equal(rec('interior').kind, KIND.cabin); assert.ok(rec('interior_teak').tex.base >= 0, 'the cabin teak keeps its texture');
  assert.ok(rec('canvas_cushion').tex.base >= 0 && rec('canvas_cushion').tex.normal >= 0, 'the cushions: weave colour + normal');
  assert.ok(rec('canvas').tex.mr >= 0, 'the dodger roughness map');
  assert.deepEqual(rec('acrylic').base.slice(0, 3), [0.010, 0.0135, 0.016]);
  assert.equal(SET.images.filter((i) => i.array === 'C').length, 4); assert.equal(SET.images.filter((i) => i.array === 'D').length, 3);
  // three's Color(hex) is sRGB → linear; canvas.js fades 14 % toward (0.62, 0.60, 0.56)
  const c = hexLinear('#B49C7E'); assert.ok(Math.abs(c[0] - 0.4564) < 0.001, `#B4 → ${c[0]}`);
  assert.equal(whiteData({ array: new Float32Array([1, 1, 1, 1]), size: 4, count: 1 }), true);
  assert.equal(v1Material({ name: 'rubber.007', base: [0.04, 0.04, 0.045, 1], metal: 0, rough: 0.75, clearcoat: [0, 0], tex: { base: null, normal: null, mr: null } }, { canvas: { canvas: [1, 1, 1], trim: [1, 1, 1], shade: [1, 1, 1] } }).kind, KIND.plain);
});

test('the packed copies (tools/v2-boat-pack.mjs) build the same boat within the quantization step', () => {
  const packed = Object.fromEntries(BOAT_MODELS.map((n) => [n, gunzipSync(packGlb(raw[n]).gz)]));
  const P = build(packed);
  // a dodger face or two on the side window's threshold may change sides (the split tests a face's normal and centre)
  for (const r of RANGES) assert.ok(Math.abs(P.triangles[r] - SET.triangles[r]) <= 2, `${r}: ${P.triangles[r]} vs ${SET.triangles[r]}`);
  assert.equal(RANGES.reduce((a, r) => a + P.triangles[r], 0), RANGES.reduce((a, r) => a + SET.triangles[r], 0));
  assert.deepEqual(P.materialNames, SET.materialNames);
  let worst = 0;
  for (const r of ['wheel', 'traveller', 'far', 'near', 'detail']) { const a = SET.ranges[r], b = P.ranges[r]; for (let k = 0; k < a.count; k++) { const i = SET.index[a.first + k], j = P.index[b.first + k]; for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(P.position[j * 3 + c] - SET.position[i * 3 + c])); } }
  assert.ok(worst < 0.0002, `max position error ${(worst * 1000).toFixed(3)} mm`);
});

test('the life ring: international orange vinyl, four tape bands, four grab-line bights, on the stern rail and the old white ring gone', () => {
  const ring = buildLifeRing(DEFAULT_DIMS.HULL.freeboard);
  const names = ring.map((o) => o.rec.name);
  assert.deepEqual(names.filter((n) => n === 'lifering_vinyl').length, 1);
  assert.equal(names.filter((n) => n === 'lifering_tape').length, 4);
  assert.equal(names.filter((n) => n === 'lifering_line').length, 4);
  const [r, g, b] = hexLinear(ORANGE);
  const body = ring.find((o) => o.rec.name === 'lifering_vinyl').rec;
  assert.ok(body.base[0] > 0.9 * r && body.base[1] < 0.5 * body.base[0] && body.base[2] === b, 'orange: red high, green low, no blue');
  assert.ok(body.rough >= 0.5 && body.coat === 0, 'low sheen vinyl');
  // the ring's box in the hull frame: 0.61 m outside diameter, on the starboard stern pulpit (x 1.34, z 3.98)
  const P = ring.find((o) => o.rec.name === 'lifering_vinyl').prim.attributes.POSITION.array;
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < P.length; i++) { mn[i % 3] = Math.min(mn[i % 3], P[i]); mx[i % 3] = Math.max(mx[i % 3], P[i]); }
  assert.ok(Math.abs(mx[1] - mn[1] - 0.61) < 0.01 && Math.abs(mx[2] - mn[2] - 0.61) < 0.01, `${mx.map((v, i) => (v - mn[i]).toFixed(3))}`);
  assert.ok(Math.abs((mx[0] + mn[0]) / 2 - 1.34) < 0.01 && Math.abs((mx[2] + mn[2]) / 2 - 3.983) < 0.01);
  // the built set carries the orange material and no strip of the old teak-coloured pad on the ring
  assert.ok(SET.materialNames.includes('lifering_vinyl') && SET.materialNames.includes('lifering_tape') && SET.materialNames.includes('lifering_line'));
});
