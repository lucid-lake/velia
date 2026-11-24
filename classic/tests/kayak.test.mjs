// The kayak (feat/kayak): the geometry builds to the reference sheet's numbers, floats at a
// sane draft, a colour or wear change is a uniform write (no new geometry), the paddler's anchors exist, it is
// deterministic, and the demo flag parses. Behaviour only: the module is called and its output read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createKayak, KAYAK, KAYAK_COLOURS, KAYAK_SCHEMES } from '../src/props/kayak/index.js';
import { kayakShape, buildShell, waterlineFor, waterlinePlan } from '../src/props/kayak/shape.js';
import { parseKayakFlag } from '../src/props/kayak/stage.js';

const box = (o) => new THREE.Box3().setFromObject(o, true);

test('the shell builds to the sheet: length, beam, depth', () => {
  const k = createKayak();
  const shell = k.group.getObjectByName('kayak_shell');
  shell.geometry.computeBoundingBox();
  const b = shell.geometry.boundingBox, size = b.getSize(new THREE.Vector3());
  assert.ok(Math.abs(size.z - KAYAK.length) < 0.02, `length ${size.z}`);
  assert.ok(Math.abs(size.x - KAYAK.beam) < 0.01, `beam ${size.x}`);
  assert.ok(Math.abs(b.min.y) < 0.002, `keel datum ${b.min.y}`);
  assert.ok(size.y > 0.40 && size.y < 0.52, `height ${size.y}`);   // the bow's deck over the keel: the gunwale 0.31 m + the bow rise 0.14 m + crown
  // the gunwale at the seat sits at the sheet's height
  const S = k.shape;
  assert.ok(Math.abs(S.deck(S.halfBeam(S.sOf(0)) - 0.001, 0).y - (KAYAK.sheerMid - S.rollR(S.sOf(0))) ) < 0.02);
  // widest station where the sheet says
  let best = 0, at = 0;
  for (let i = 0; i <= 200; i++) { const s = i / 200, w = S.halfBeam(s); if (w > best) { best = w; at = s; } }
  assert.ok(Math.abs(at - KAYAK.beamAt) < 0.02, `max beam at ${at}`);
});

test('the shell is closed and faces out: finite normals, the keel looks down, the deck up', () => {
  const S = kayakShape(), g = buildShell(S);
  const p = g.attributes.position, n = g.attributes.normal;
  let keel = -1, deck = -1, dk = Infinity, dd = Infinity;
  for (let i = 0; i < p.count; i++) {
    assert.ok(Number.isFinite(n.getX(i) + n.getY(i) + n.getZ(i)), `normal ${i}`);
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const a = x * x + y * y + (z - 0.1) ** 2; if (a < dk) { dk = a; keel = i; }
    const d = x * x + (z - 1.35) ** 2 - y; if (d < dd) { dd = d; deck = i; }
  }
  assert.ok(n.getY(keel) < -0.9, `keel normal ${n.getY(keel)}`);
  assert.ok(n.getY(deck) > 0.8, `stern deck normal ${n.getY(deck)}`);
  assert.equal(g.attributes.kwear.count, p.count);
});

test('it floats: the empty and loaded drafts, the seat just clear of the loaded waterline', () => {
  const S = kayakShape();
  const empty = waterlineFor(S, KAYAK.mass.empty + KAYAK.mass.paddle), loaded = waterlineFor(S, KAYAK.mass.empty + KAYAK.mass.paddle + KAYAK.mass.paddler);
  assert.ok(empty > 0.03 && empty < 0.08, `empty draft ${empty}`);
  assert.ok(loaded > 0.08 && loaded < 0.14, `loaded draft ${loaded}`);
  assert.ok(loaded > empty);
  assert.ok(S.deck(0, KAYAK.seatZ).y > empty + 0.04, 'the seat is well above the empty waterline');
  // the waterline's outline closes round the hull and stays inside the beam
  const loop = waterlinePlan(S, empty);
  assert.ok(loop.length > 20);
  for (const [x] of loop) assert.ok(Math.abs(x) <= KAYAK.beam / 2 + 1e-6);
});

test('colour and wear are uniforms: no geometry is rebuilt', () => {
  const k = createKayak({ colour: 'yellow', wear: 0 });
  const geos = new Map(); k.group.traverse((o) => { if (o.isMesh) geos.set(o.name, o.geometry); });
  const before = k.materials.u.colour.value.clone();
  k.setColour('red'); k.setWear(1);
  assert.notDeepEqual(k.materials.u.colour.value.toArray(), before.toArray());
  assert.deepEqual(k.materials.u.colour.value.toArray(), new THREE.Color(KAYAK_COLOURS.red).toArray());
  assert.equal(k.materials.u.wear.value, 1);
  k.setColour('#2C69A8'); k.setWear(2);
  assert.equal(k.materials.u.wear.value, 1, 'wear clamps to 0..1');
  // the schemes (owner round 2: P1's swirl, P2's two-tone) are uniforms too
  k.setColour('sunset');
  assert.equal(k.materials.u.mode.value, 2);
  assert.deepEqual(k.materials.u.colour2.value.toArray(), new THREE.Color(KAYAK_SCHEMES.sunset.b).toArray());
  k.setColour('orange-white');
  assert.equal(k.materials.u.mode.value, 1);
  k.setColour('yellow');
  assert.equal(k.materials.u.mode.value, 0);
  k.group.traverse((o) => { if (o.isMesh && geos.has(o.name)) assert.equal(o.geometry, geos.get(o.name), `${o.name} kept its geometry`); });
  // every preset is a real rotomould shade: no channel at full, no pure primary, the albedo cap holds
  for (const [name, hex] of Object.entries(KAYAK_COLOURS)) {
    const c = new THREE.Color(hex);
    assert.ok(Math.max(c.r, c.g, c.b) <= 0.82, `${name} albedo ${c.r},${c.g},${c.b}`);
  }
  for (const want of ['yellow', 'red']) assert.ok(KAYAK_COLOURS[want]);
  for (const sc of Object.values(KAYAK_SCHEMES)) for (const hex of [sc.a, sc.b]) { const c = new THREE.Color(hex); assert.ok(Math.max(c.r, c.g, c.b) <= 0.82, hex); }
});

test('the paddler anchors: hips on the seat, hands over the cockpit, all on the kayak', () => {
  const k = createKayak();
  const { seat, gripL, gripR } = k.anchors;
  for (const a of [seat, gripL, gripR]) assert.equal(a.parent, k.group);
  const S = k.shape;
  assert.ok(Math.abs(seat.position.y - S.deck(0, KAYAK.seatZ).y) < 1e-6);
  assert.ok(seat.position.z > KAYAK.cockpit.front && seat.position.z < KAYAK.cockpit.back);
  assert.ok(gripL.position.x < 0 && gripR.position.x > 0 && Math.abs(gripL.position.x + gripR.position.x) < 1e-9);
  assert.ok(gripL.position.y > seat.position.y + 0.3 && gripL.position.z < seat.position.z);
  // the stowed paddle rests on the kayak: both ends inside the length, over the deck
  const [a, b] = k.parts.paddleLine;
  assert.ok(Math.abs(b.distanceTo(a) - KAYAK.paddle.length) < 0.01);
  for (const e of [a, b]) { assert.ok(Math.abs(e.z) < KAYAK.length / 2); assert.ok(e.y > S.deck(e.x, e.z).y); }
});

test('the hardware stays on the hull: every part inside the kayak bounds (plus the toggles off the tips)', () => {
  const k = createKayak();
  const hull = box(k.group.getObjectByName('kayak_shell'));
  const out = hull.clone().expandByVector(new THREE.Vector3(0.06, 0.25, 0.07));
  for (const n of ['kayak_nylon', 'kayak_cord', 'kayak_holes', 'kayak_seatback', 'kayak_paddle_blades']) {
    const b = box(k.group.getObjectByName(n));
    assert.ok(out.containsBox(b), `${n} ${JSON.stringify(b)}`);
  }
});

test('deterministic: the same build twice gives the same shell and parts', () => {
  // (three's own uuids use Math.random; the shape, the parts and the materials' noise use none: the seed is a uniform)
  const a = createKayak({ seed: 3 }), b = createKayak({ seed: 3 });
  for (const n of ['kayak_shell', 'kayak_nylon', 'kayak_cord', 'kayak_paddle_blades']) {
    assert.deepEqual(a.group.getObjectByName(n).geometry.attributes.position.array, b.group.getObjectByName(n).geometry.attributes.position.array, n);
  }
  assert.deepEqual(a.materials.u.seed.value.toArray(), b.materials.u.seed.value.toArray());
  assert.notDeepEqual(createKayak({ seed: 4 }).materials.u.seed.value.toArray(), a.materials.u.seed.value.toArray());
});

test('the demo flag parses: preset, hex, wear, seed, lift', () => {
  assert.deepEqual(parseKayakFlag('red,0.8,3'), { colour: 'red', wear: 0.8, seed: 3, lift: 0, bag: false });
  assert.deepEqual(parseKayakFlag('E2B12C'), { colour: '#E2B12C', wear: 0.35, seed: 1, lift: 0, bag: false });
  assert.deepEqual(parseKayakFlag('nope,9,x,0.5'), { colour: 'yellow', wear: 1, seed: 1, lift: 0.5, bag: false });
  assert.deepEqual(parseKayakFlag('sunset,0.4,2,0,bag'), { colour: 'sunset', wear: 0.4, seed: 2, lift: 0, bag: true });
});
