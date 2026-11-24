// Fannette Island's tea house (owner, 2026-11-18: "build it, desktop only"): its real size, its spot on
// our island's summit, seated on our terrain (no wall on air, the floor over the knob's crown), its openings open, its cost, and the
// desktop-only policy (src/core/features.js teaHouse). Behaviour only: the modules are called, their output read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, LANDMARKS } from './helpers/ground.mjs';
import { TEA_HOUSE, teaHouseSeat, footprintPoints } from '../sim/teaHouse.js';
import { teaHouseParts, TEA_KIND } from '../render/teaHouse.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';

const T = makeTerrain({ seed: 1 });   // v2's CPU height field is v1's heightAt (v2/tests/terrain-data.test.mjs)
const { parts, stats } = teaHouseParts();
const box = (ps) => { const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; for (const p of ps) for (let i = 0; i < p.pos.length; i += 3) for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], p.pos[i + k]); b[k + 3] = Math.max(b[k + 3], p.pos[i + k]); } return b; };

test('real size: the nomination\'s 16 ft square, never enlarged; the walls about 2.5 m with the broken crown, the stack proud of them', () => {
  assert.ok(Math.abs(TEA_HOUSE.sizeM - 4.877) < 0.01, `${TEA_HOUSE.sizeM} m`);
  const B = box(parts), floor = TEA_HOUSE.seat.floor;
  // across: the square plus its plinth and the stones' relief (the steps run south from the door, so north, east and west)
  assert.ok(B[3] - B[0] > 4.87 && B[3] - B[0] < 5.2, `east-west (the square and its stones standing proud) ${(B[3] - B[0]).toFixed(2)} m`);
  assert.ok(Math.abs(B[2] - (TEA_HOUSE.z - TEA_HOUSE.sizeM / 2)) < 0.16, `the north face (its stones proud) at z ${B[2].toFixed(2)}`);
  assert.ok(B[5] - B[2] < TEA_HOUSE.sizeM + 1.8, 'the steps reach under 1.8 m past the south face');
  const top = B[4] - floor;
  assert.ok(top > 3.2 && top < 3.7, `the highest stone ${top.toFixed(2)} m over the floor (the stack's broken crown)`);
  // the walls' own crown: the slabs along the top stand 0.45–1.1 m over the wall's 2.45 m (the long-lens photo)
  const crown = parts.filter((p) => { const b = box([p]); return b[1] > floor + TEA_HOUSE.wallTopM - 0.15 && b[4] - b[1] < 1.25 && b[4] < floor + 3.65; });
  assert.ok(crown.length >= 20, `${crown.length} standing stones' parts`);
  for (const p of crown) assert.ok(box([p])[4] - floor <= TEA_HOUSE.wallTopM + 1.15, 'no crown stone over 1.1 m');
});

test('on the summit: our terrain\'s highest point (the lidar\'s 28 m) and the island\'s landmark spot inside its footprint', () => {
  let best = [-Infinity, 0, 0];
  for (let x = -150; x <= 150; x += 1) for (let z = -150; z <= 150; z += 1) { const h = T.heightAt(x, z); if (h > best[0]) best = [h, x, z]; }
  const inside = (x, z) => Math.abs(x - TEA_HOUSE.x) <= TEA_HOUSE.sizeM / 2 && Math.abs(z - TEA_HOUSE.z) <= TEA_HOUSE.sizeM / 2;
  assert.ok(inside(best[1], best[2]), `the summit (${best[1]}, ${best[2]}) under the walls`);
  assert.ok(inside(LANDMARKS.ruin.x, LANDMARKS.ruin.z), 'the lake profile\'s ruin spot under the walls');
  const B = box(parts.filter((p) => p.kind === TEA_KIND.stone));
  assert.ok(Math.abs((B[0] + B[3]) / 2 - TEA_HOUSE.x) < 0.3 && Math.abs(B[2] + TEA_HOUSE.sizeM / 2 - TEA_HOUSE.z) < 0.3, 'the walls round the spot');
  assert.ok(best[0] > 27.5 && best[0] < 29.5, `our summit ${best[0].toFixed(1)} m over the lake (the 2022 lidar: 28.6 m at its highest return)`);
});

test('seated on our terrain: the baked seat is the terrain\'s, no wall on air, the floor over the knob\'s crown', () => {
  const s = teaHouseSeat(T.heightAt);
  assert.ok(Math.abs(s.floor - TEA_HOUSE.seat.floor) < 0.02 && Math.abs(s.foot - TEA_HOUSE.seat.foot) < 0.02, `seat ${JSON.stringify(s)} vs baked ${JSON.stringify(TEA_HOUSE.seat)}`);
  const pts = footprintPoints(0.25);
  for (const [x, z] of pts) {
    const g = T.heightAt(x, z);
    assert.ok(TEA_HOUSE.seat.foot < g - 0.2, `the foundation under the ground at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    assert.ok(g - TEA_HOUSE.seat.floor < 0.1, `the crown ${(g - TEA_HOUSE.seat.floor).toFixed(2)} m through the floor at (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
  // the mesh's lowest stones reach the foundation's depth; every stone under the floor sits below the ground beside it or on a block
  const B = box(parts);
  assert.ok(B[1] <= TEA_HOUSE.seat.foot + 0.01, `the lowest stone at ${B[1].toFixed(2)} m`);
  // each step's bottom is under the ground at its four corners (no step on air)
  for (const p of parts.filter((q) => { const b = box([q]); return b[2] > TEA_HOUSE.z + TEA_HOUSE.sizeM / 2 - 0.1 && b[4] < TEA_HOUSE.seat.floor; })) {
    const b = box([p]);
    for (const [x, z] of [[b[0], b[2]], [b[3], b[2]], [b[0], b[5]], [b[3], b[5]]]) assert.ok(b[1] < T.heightAt(x, z), `a step's foot under the ground at (${x.toFixed(2)}, ${z.toFixed(2)})`);
  }
});

test('the openings are open (two windows north, one east, one west, the door south) and the fireplace is in the north-west corner', () => {
  const h = TEA_HOUSE.sizeM / 2, t = TEA_HOUSE.wallM, floor = TEA_HOUSE.seat.floor;
  const faces = TEA_HOUSE.openings.map((o) => o.face).sort().join('');
  assert.equal(faces, 'ENNSW');
  assert.equal(TEA_HOUSE.openings.find((o) => o.face === 'S').sill, 0, 'the door from the floor');
  const aabbs = parts.map((p) => box([p]));
  for (const o of TEA_HOUSE.openings) {
    const y = floor + (o.sill + o.head) / 2;
    const [x, z] = o.face === 'N' ? [o.at, -h + t / 2] : o.face === 'S' ? [o.at, h - t / 2] : o.face === 'E' ? [h - t / 2, o.at] : [-h + t / 2, o.at];
    const wx = TEA_HOUSE.x + x, wz = TEA_HOUSE.z + z;
    const hit = aabbs.findIndex((b) => wx > b[0] && wx < b[3] && y > b[1] && y < b[4] && wz > b[2] && wz < b[5]);
    assert.equal(hit, -1, `the ${o.face} opening at ${o.at} m is clear`);
  }
  // the stack: the tallest piece, in the north-west quarter
  const stack = aabbs.reduce((a, b) => (b[4] > a[4] ? b : a));
  assert.ok((stack[0] + stack[3]) / 2 < TEA_HOUSE.x - 1 && (stack[2] + stack[5]) / 2 < TEA_HOUSE.z - 1, 'the stack in the north-west corner');
  // the brick and the soot (kind 0) at the fireplace, the timber lintels over each opening
  assert.ok(parts.filter((p) => p.kind === TEA_KIND.plain).length >= TEA_HOUSE.openings.length + 2);
});

test('the cost: boxes and rounded stones, under 16,000 triangles in one draw, built the same every time', () => {
  assert.ok(stats.triangles <= 16000, `${stats.triangles} triangles`);
  assert.ok(stats.boxes >= 200, `${stats.boxes} pieces (the stones of the faces and the crown)`);
  // the long-lens photo's rubble: 4–5 courses, 6–8 big stones a course (fewer where the openings are)
  for (const f of ['N', 'S', 'E', 'W']) {
    assert.ok(stats.faceCourses[f] >= 4 && stats.faceCourses[f] <= 6, `${f}: ${stats.faceCourses[f]} courses`);
    assert.ok(stats.faceStones[f] >= 15 && stats.faceStones[f] <= 40, `${f}: ${stats.faceStones[f]} stones`);
  }
  assert.ok(stats.verts < 65536);
  assert.deepEqual(teaHouseParts().parts, parts, 'deterministic');
  for (const p of parts) { assert.ok(p.kind === TEA_KIND.stone || p.kind === TEA_KIND.plain, 'the tea kinds only (stone, plain: the landmarks\' opaque pass)'); assert.ok(p.idx.every((i) => i < p.pos.length / 3)); }
});

test('the binoculars\' rangefinder reads the walls from the water (a boat 270 m north), not the hill behind', async () => {
  const { rangeTo } = await import('../../src/ui/binocularsHud.js');
  const { teaHouseTop, RANGE_MARGIN_M } = await import('../sim/teaHouse.js');
  const at = (x, z) => Math.max(T.heightAt(x, z), teaHouseTop(x, z, RANGE_MARGIN_M));
  const o = { x: 53, y: 2.6, z: -265 }, tgt = [TEA_HOUSE.x, TEA_HOUSE.seat.floor + 1.5, TEA_HOUSE.z];
  for (const dy of [0, 0.6, -0.4]) {   // the wall's middle, near its top, near its foot
    const d = [tgt[0] - o.x, tgt[1] + dy - o.y, tgt[2] - o.z], l = Math.hypot(...d), dir = { x: d[0] / l, y: d[1] / l, z: d[2] / l };
    const r = rangeTo(o, dir, at);
    assert.ok(r != null && Math.abs(r - l) < 8, `${r?.toFixed(0)} m vs ${l.toFixed(0)} m`);
  }
  assert.equal(teaHouseTop(TEA_HOUSE.x + 9, TEA_HOUSE.z), -Infinity, 'nothing off the footprint');
});

// the policy (src/core/features.js teaHouse): a desktop only; a phone and a tablet never fetch the mesh; ?teahouse=0 off
const fake = (win, gpu = 0) => ({ get: () => profileOf(readFacts(win), forcedOf(win.location?.search ?? ''), { gpu }), on: () => () => {} });
const tier = (dev, ctx = {}, search = '', gpu = 0) => createFeatures({ profile: fake({ ...DEVICES[dev], location: { search } }, gpu), doc: null }).configure({ headless: false, flags: {}, ...ctx }).feature('teaHouse');
test('desktop only: on a desktop (a capture too, any level), off on a phone only (a tablet is a desktop, 2026-11-18), off with ?teahouse=0', () => {
  for (const d of ['desktop', 'smallDesktop', 'touchLaptop']) assert.equal(tier(d).tier, 'on', d);
  for (const d of ['iphoneTurned', 'androidSideways']) assert.equal(tier(d).tier, 'off', d);
  for (const d of ['ipadTrackpad', 'ipadPro', 'ipadOld', 'androidTablet']) assert.equal(tier(d).tier, 'on', d);
  assert.equal(tier('desktop', {}, '', 3).tier, 'on', 'a weak desktop GPU keeps it (one draw in an existing pipeline)');
  assert.equal(tier('desktop', { headless: true }).tier, 'on', 'a capture on a desktop');
  assert.equal(tier('desktop', { flags: { teahouse: '0' } }).tier, 'off', '?teahouse=0');
  assert.equal(tier('desktop', { headless: true }, '?profile=form:phone').tier, 'off', 'a capture forced to a phone');
  assert.equal(tier('desktop', {}, '?profile=form:tablet').tier, 'on', 'a desktop forced to a tablet: still a desktop for features');
  assert.equal(tier('desktop').fixed, true, 'fixed at build');
});
