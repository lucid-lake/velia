// Boat detail step 1): the rope tubes' switch by distance and tier, the near line
// set, the winch wraps and the budget. Plain JS, no GPU.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { lineSet, makeLines, DECKPTS } from '../classic/src/boat/lines.js';
import { winchWrap, ropeLod, ropeNearFor, ROPE_NEAR } from '../classic/src/boat/rope.js';
import { stubState } from '../src/boat/rig.js';

const DEG = Math.PI / 180;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const STATE = { mainSheet: 30 * DEG, boomAngle: -0.4, jibAngle: -0.3, mainFill: 1, jibFill: 1, apparentWind: { speed: 5, angle: 1 } };
// a stand-in camera and boat origin at a distance d (m) from each other
const at = (d) => { const o = new THREE.Object3D(); const c = new THREE.PerspectiveCamera(); c.position.set(d, 0, 0); o.updateMatrixWorld(); return { camera: c, origin: o }; };

test('the rope switch: near inside its distance, far past it, a band between (no flicker); Low switches closer', () => {
  const lod = ropeLod(15, 1);
  assert.equal(lod.update(30), false);
  assert.equal(lod.update(14.5), false, 'inside the band: still far');
  assert.equal(lod.update(13.9), true);
  assert.equal(lod.update(15.5), true, 'inside the band: still near');
  assert.equal(lod.update(16.1), false);
  assert.equal(ropeNearFor('high'), 15); assert.equal(ropeNearFor('balanced'), 15); assert.equal(ropeNearFor('low'), 6);
  assert.ok(ROPE_NEAR.low < 32 && ROPE_NEAR.high < 32, 'the follow camera (≈ 32 m) always sees the ribbons');
});

test('far, the line set is today\'s ribbons only; near, the sheets, tackle, tails and coils are tubes', () => {
  const far = lineSet(STATE), near = lineSet(STATE, 0, { near: true });
  assert.ok(far.every((l) => !l.tube), 'no tubes far');
  const tubes = near.filter((l) => l.tube).map((l) => l.name);
  for (const n of ['mainsheet-0', 'mainsheet-tail', 'jibsheet-working', 'jibsheet-tail', 'jibsheet-lazy', 'main-halyard-deck', 'main-halyard-coil', 'reef-1'])
    assert.ok(tubes.includes(n), n);
  // what stays a ribbon near: the halyards' runs up the mast, the topping lift, the lazy jacks
  for (const n of ['main-halyard', 'topping-lift', 'lazyjack-S-a']) assert.ok(near.find((l) => l.name === n && !l.tube), n);
  for (const l of near) assert.ok(l.points.every((p) => p.every(Number.isFinite)), `${l.name} finite`);
});

test('a winch wrap: on the drum\'s tangent from the car, three turns climbing, into the tailer, out at the stripper', () => {
  const c = [1.3, 0, 2.6], from = [1.2, -0.1, 0.5];
  const w = winchWrap(c, from, { r: 0.057, y0: -0.035, y1: 0.018, turns: 3, exit: Math.PI });
  const r0 = [w[0][0] - c[0], w[0][2] - c[2]], run = [w[0][0] - from[0], w[0][2] - from[2]];
  assert.ok(Math.abs(Math.hypot(...r0) - 0.057) < 1e-9, 'on the drum');
  assert.ok(Math.abs(r0[0] * run[0] + r0[1] * run[1]) / Math.hypot(...run) < 0.06 * 0.057, 'the rope meets the drum on its tangent');
  // the turns stay on the drum's surface and climb
  const turns = w.slice(0, 3 * 12 + 1);
  for (const p of turns) assert.ok(Math.abs(Math.hypot(p[0] - c[0], p[2] - c[2]) - 0.057) < 1e-9);
  for (let i = 1; i < turns.length; i++) assert.ok(turns[i][1] >= turns[i - 1][1]);
  const end = w[w.length - 1];
  assert.ok(Math.abs(end[1] - 0.052) < 1e-9, 'ends in the tailer');
  assert.ok(Math.abs(Math.atan2(end[2] - c[2], end[0] - c[0]) - Math.PI) < 1e-6 || Math.abs(Math.atan2(end[2] - c[2], end[0] - c[0]) + Math.PI) < 1e-6, 'leaves at the stripper');
  // on the boat: the working sheet's last point is in the tailer of its own winch
  const set = lineSet(STATE, 0, { near: true }), work = Math.sign(STATE.jibAngle) || -1;
  const sheet = set.find((l) => l.name === 'jibsheet-working').points, wc = DECKPTS.winch(work);
  assert.ok(dist(sheet[sheet.length - 1], wc) < 0.09, 'the sheet ends in its winch\'s tailer');
  const tail = set.find((l) => l.name === 'jibsheet-tail').points;
  assert.ok(dist(tail[0], sheet[sheet.length - 1]) < 0.06, 'the tail leaves where the sheet ends');
});

test('makeLines: the camera far draws only ribbons (today\'s); near draws the tubes inside the budget, the ribbons lose the tubed lines', () => {
  for (const q of [{ awaDeg: 40, awsMs: 7 }, { awaDeg: 150, awsMs: 7, main: 0.95 }, { awaDeg: 90, awsMs: 12, reef: 2 }, { awaDeg: 25, backed: true }]) {
    const s = stubState(q);
    const plain = makeLines(); plain.update(s, 0, { t: 1.3 });
    const far = makeLines({ ...at(32), nearM: 15 }); far.update(s, 0, { t: 1.3 });
    assert.equal(far.triangles(), plain.triangles(), 'far: the ribbons as without a camera');
    assert.equal(far.ropeTriangles(), 0);
    assert.ok(far.children.find((o) => o.name === 'running-rigging-rope').geometry.drawRange.count <= 3, 'far: the rope draws nothing (one degenerate triangle)');
    const near = makeLines({ ...at(4), nearM: 15 }); near.update(s, 0, { t: 1.3 });
    assert.ok(near.ropeTriangles() > 3000, `near: tubes drawn (${near.ropeTriangles()})`);
    // plan 41 § 6.1: the whole detail track adds ≤ 30 k near triangles; step 1's rope stays under a third of it
    assert.ok(near.ropeTriangles() <= 10000, `rope ${near.ropeTriangles()} ≤ 10 000 triangles`);
    assert.ok(near.triangles() < far.triangles(), 'near: fewer ribbons');
    // Low's 6 m: the follow camera and a close orbit at 10 m keep the ribbons
    const low = makeLines({ ...at(10), nearM: ropeNearFor('low') }); low.update(s, 0, { t: 1.3 });
    assert.equal(low.ropeTriangles(), 0);
  }
});
