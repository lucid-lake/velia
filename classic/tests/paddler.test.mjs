// The kayak's paddler (feat/kayak-paddler), the blocking stage: the figure builds from its GLB
// and sits on the kayak, every key pose puts both hands on the paddle's grips, the stroke poses put the working blade in
// the water and the rest pose keeps both out, a seed gives one look and one pose, and nothing changes without the flag.
// Behaviour only: the modules are called and their output read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three/webgpu';
import { createKayak, GRIP_HALF } from '../src/props/kayak/index.js';
import { parseKayakFlag, parsePaddlerFlag } from '../src/props/kayak/stage.js';
import { createPaddler, parsePaddlerGltf, KEY_POSES } from '../src/props/paddler/index.js';
import { pickLook, PFD_COLOURS } from '../src/props/paddler/look.js';

const ld = async (f) => { const b = readFileSync(new URL(`../../models/paddler/${f}`, import.meta.url)); return parsePaddlerGltf(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), { textures: false }); };
const gltf = { male: await ld('ubc-male.glb'), female: await ld('ubc-female.glb') };   // the UBC figures (Node: no images)
const man = await ld('paddler.glb');   // the first round's figure, still supported
const make = (seed = 1, pose) => { const k = createKayak({ paddle: 'held' }); return { k, p: createPaddler({ gltf, kayak: k, seed, pose }) }; };
const wp = (o) => o.getWorldPosition(new THREE.Vector3());

test('the figure builds and sits in the kayak: a person-sized body on the seat, a PFD and a cap, a calm face', () => {
  const { k, p } = make(1, 'rest');
  assert.equal(p.group.parent, k.group);
  const box = new THREE.Box3().setFromObject(p.group, true);
  assert.ok(box.max.y > 0.95 && box.max.y < 1.4, `head height over the keel ${box.max.y}`);   // seated: the hat ≈ 1.1–1.3 m
  assert.ok(Math.abs(box.max.x + box.min.x) < 0.25, 'centred on the kayak');
  const hips = wp(p.figure.bones.UpperLegL).add(wp(p.figure.bones.UpperLegR)).multiplyScalar(0.5);
  const seat = k.anchors.seat.position;
  assert.ok(Math.abs(hips.y - seat.y - 0.13) < 0.01 && Math.abs(hips.z - seat.z - 0.07) < 0.01, `hips on the seat ${hips.toArray()}`);
  assert.ok(p.figure.pfd.isSkinnedMesh && p.figure.pfd.geometry.attributes.position.count > 500, 'a fitted, skinned PFD');
  assert.ok(p.figure.hat.isMesh, 'a hat');
  assert.equal(p.figure.profileName, 'ubc');
  assert.ok(p.figure.meshes.Hair && p.figure.meshes.Brows, 'a short haircut and brows');
  assert.ok(p.figure.meshes.Body.geometry.attributes.garment, 'clothes painted on the body');
  // the first round's figure still builds (no eyes there)
  const k2 = createKayak({ paddle: 'held' }), q = createPaddler({ gltf: man, kayak: k2, seed: 1, pose: 'rest' });
  assert.equal(q.figure.profileName, 'man'); assert.equal(q.figure.meshes.Eyes.visible, false);
  assert.ok(q.setPose('cruise_pullR') < 0.03);
});

test('every key pose puts both hands on the grips (within 3 cm), the grips ride the shaft 0.62 m apart', () => {
  const { k, p } = make(2);
  for (const name of Object.keys(KEY_POSES)) {
    const err = p.setPose(name);
    assert.ok(err < 0.03, `${name}: a hand ${err.toFixed(3)} m off its grip`);
    assert.ok(Math.abs(wp(k.anchors.gripL).distanceTo(wp(k.anchors.gripR)) - 2 * GRIP_HALF) < 1e-6);
  }
});

test('the stroke poses put the working blade in the water by the hull, the rest pose keeps both blades out', () => {
  const { k, p } = make(3);
  const water = k.draft(k.dims.mass.empty + k.dims.mass.paddle + k.dims.mass.paddler);
  const blade = (side) => k.paddle.group.localToWorld(new THREE.Vector3(k.paddle.blades[side].centre, 0, 0));
  for (const name of Object.keys(KEY_POSES)) {
    p.setPose(name);
    const s = blade('stbd'), q = blade('port');
    if (name === 'rest') { assert.ok(s.y > water && q.y > water, 'rest: both blades out'); continue; }
    const [wet, dry] = name.endsWith('R') ? [s, q] : [q, s];
    assert.ok(wet.y < water + (name.includes('exit') ? 0.03 : 0.01), `${name}: the working blade's centre ${wet.y.toFixed(3)} at or under the water ${water.toFixed(3)}`);   // an exit is at the surface
    assert.ok(dry.y > water + 0.4, `${name}: the other blade up in the air`);
    const side = name.endsWith('R') ? 1 : -1;
    assert.ok(side * wet.x > k.shape.halfBeam(k.shape.sOf(wet.z)) + 0.02, `${name}: the working blade outside the hull`);
  }
  // the catch is forward of the pull, the pull forward of the exit (the blade goes in by the feet and out at the hip)
  const z = (n) => { p.setPose(n); return blade('stbd').z; };
  assert.ok(z('cruise_catchR') < z('cruise_pullR') && z('cruise_pullR') < z('cruise_exitR'));
  assert.ok(z('back_midR') > z('cruise_pullR'), 'the back stroke works behind the hip');
});

test('deterministic: a seed gives one look and one set of bones; seeds vary the look', () => {
  const a = make(5, 'cruise_pullR'), b = make(5, 'cruise_pullR');
  assert.deepEqual(a.p.look, b.p.look);
  const pa = a.p.figure.bones.MiddleHandR, pb = b.p.figure.bones.MiddleHandR;
  assert.ok(wp(pa).distanceTo(wp(pb)) < 1e-9);
  const looks = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((s) => JSON.stringify([pickLook(s).pfd, pickLook(s).skin, pickLook(s).sex])));
  const sexes = new Set(Array.from({ length: 20 }, (_, i) => pickLook(i + 1).sex));
  assert.deepEqual([...sexes].sort(), ['female', 'male'], 'both figures by seed');
  assert.ok(looks.size >= 5, `8 seeds gave ${looks.size} looks`);
  for (let s = 1; s <= 20; s++) assert.ok(Object.values(PFD_COLOURS).includes(pickLook(s).pfd));
  // an override changes only its own field
  const o = pickLook(7, { pfd: 'blue' }), n = pickLook(7);
  assert.equal(o.pfd, PFD_COLOURS.blue); assert.equal(o.skin, n.skin); assert.equal(o.hat, n.hat);
});

test('nothing without the flag: the kayak alone keeps its stowed paddle; the flag parses', () => {
  const k = createKayak();
  assert.equal(k.paddle, null);
  assert.ok(k.group.getObjectByName('kayak_paddle_blades'), 'the stowed paddle is there');
  assert.equal(k.group.getObjectByName('paddler'), undefined);
  assert.throws(() => createPaddler({ gltf, kayak: k }), /held/);
  assert.equal(parsePaddlerFlag('0'), null);
  assert.deepEqual(parsePaddlerFlag(null), { seed: 1, what: 'cruise', phase: null, pfd: undefined });
  assert.deepEqual(parsePaddlerFlag('4,rest,blue'), { seed: 4, what: 'rest', phase: null, pfd: 'blue' });
  assert.deepEqual(parsePaddlerFlag('2,cruise@0.25'), { seed: 2, what: 'cruise', phase: 0.25, pfd: undefined });
  assert.equal(parseKayakFlag('red,0.6').colour, 'red');
});
