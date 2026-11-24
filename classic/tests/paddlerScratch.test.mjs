// Refactor round 2 B2: the paddler's rig works on shared scratch (no garbage a frame). Behaviour only: two paddlers
// stepped in turn give exactly the bones each gives alone (no scratch leaks from one solve into the next), the exported
// clearance queries still hand out their own objects, and a refilled body equals a fresh one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createKayak } from '../src/props/kayak/index.js';
import { createPaddler, parsePaddlerGltf } from '../src/props/paddler/index.js';
import { bodySolids, paddlePoints, penetrations } from '../src/props/paddler/rig.js';

const ld = (f) => { const b = readFileSync(new URL(`../../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
const gltf = { male: await ld('ubc-male.glb'), female: await ld('ubc-female.glb') };
const make = (seed) => { const k = createKayak({ paddle: 'held' }); return { k, p: createPaddler({ gltf, kayak: k, seed }) }; };
const bones = (p) => { const v = []; p.figure.root.traverse((b) => { if (b.isBone) v.push(...b.position.toArray(), ...b.quaternion.toArray()); }); return v; };
const run = (p, i) => { if (i % 40 === 0) p.setMode(['cruise', 'sprint', 'back', 'turnLeft'][(i / 40) % 4]); return p.update(1 / 60); };

test('paddler scratch: two paddlers stepped in turn match each stepped alone, bit for bit', () => {
  const A = make(1), B = make(2), A2 = make(1), B2 = make(2);
  for (let i = 0; i < 160; i++) { run(A.p, i); run(B.p, i); }
  for (let i = 0; i < 160; i++) run(A2.p, i);
  for (let i = 0; i < 160; i++) run(B2.p, i);
  assert.deepEqual(bones(A.p), bones(A2.p));
  assert.deepEqual(bones(B.p), bones(B2.p));
  assert.deepEqual(A.k.paddle.group.quaternion.toArray(), A2.k.paddle.group.quaternion.toArray());
});

test('paddler scratch: penetrations hands out its own objects; a refilled body equals a fresh one', () => {
  const { k, p } = make(3);
  p.setPose('cruise_catchR');
  const body = bodySolids(p.figure, k), pts = paddlePoints(k);
  // the paddle pushed into the body's chest: hits exist
  k.paddle.group.position.copy(body[0].a); k.paddle.group.updateMatrix();
  const h1 = penetrations(pts, k, k.shape, body);
  assert.ok(h1.length > 0, 'the paddle in the chest has hits');
  const keep = h1.map((h) => [h.depth, ...h.push.toArray()]);
  k.paddle.group.position.set(0, 5, 0); k.paddle.group.updateMatrix();
  const h2 = penetrations(pts, k, k.shape, body);
  assert.equal(h2.length, 0);
  assert.deepEqual(h1.map((h) => [h.depth, ...h.push.toArray()]), keep, 'an earlier answer is not changed by a later call');
  const reused = bodySolids(p.figure, k, bodySolids(p.figure, k));
  const fresh = bodySolids(p.figure, k);
  assert.deepEqual(reused.map((c) => [...c.a.toArray(), ...c.b.toArray(), c.r, !!c.leg]), fresh.map((c) => [...c.a.toArray(), ...c.b.toArray(), c.r, !!c.leg]));
});
