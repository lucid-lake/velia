// M4 rig + M9 details: the geometry contract and the wind/light formulas. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPARS, solveRig, buildSpars, wireArrays, bisectError, vec } from '../src/boat/spars.js';
import { DEFAULT_DIMS } from '../src/sim/boat/dims.js';
const { RIG } = DEFAULT_DIMS;   // this page's boat (its profile)
import { streamer, windVector, navSector, navLevel, sailFlow } from '../src/boat/details.js';

const rig = solveRig(SPARS);
const close = (a, b, tol, what) => assert.ok(vec.len(vec.sub(a, b)) <= tol, `${what}: ${a.map((v) => v.toFixed(3))} vs ${b.map((v) => v.toFixed(3))}`);

test('the forestay passes through the jib tack (dims RIG.tack) within 5 mm and ends at the hounds tang', () => {
  const a = rig.forestayAt(0), b = rig.forestayAt(1);
  const d = vec.norm(vec.sub(b, a));
  const off = vec.sub(RIG.tack, a);
  const miss = vec.len(vec.sub(off, vec.mul(d, vec.dot(off, d))));
  assert.ok(miss < 0.005, `tack ${(miss * 1000).toFixed(1)} mm off the stay`);
  close(b, rig.points.houndsTang, 1e-9, 'hounds');
});

test('every spreader bisects the cap shroud over its tip within 1° (compression only)', () => {
  const cap = rig.wires.find((w) => w.name === 'cap_stbd').pts;
  rig.points.tips.forEach((tip, i) => {
    const e = bisectError([0, SPARS.spreaders[i].y, 0], tip, cap[i], cap[i + 2]);
    assert.ok(e < 1, `spreader ${i}: ${e.toFixed(2)}°`);
  });
  for (const e of rig.points.spreaderElevDeg) assert.ok(e > 0 && e < 15, `elevation ${e.toFixed(2)}°: spreaders tilt up, a few degrees`);
});

test('wires end on their plates and tangs; port mirrors starboard', () => {
  const s = rig.wires.find((w) => w.name === 'cap_stbd'), p = rig.wires.find((w) => w.name === 'cap_port');
  close(s.pts[0], RIG.chainplate, 1e-9, 'cap plate');
  s.pts.forEach((q, k) => close(p.pts[k], [-q[0], q[1], q[2]], 1e-9, `mirror ${k}`));
  close(rig.wires.find((w) => w.name === 'backstay').pts[0], RIG.backstayPlate, 1e-9, 'backstay plate');
  const top = rig.wires.find((w) => w.name === 'cap_stbd').pts.at(-1);
  // a masthead rig: the forestay tang and the cap tangs sit in the top 0.3 m of the mast; fractional: within 1.5 m
  const span = SPARS.masthead ? 0.3 : 1.5;
  for (const y of [top[1], SPARS.hounds]) assert.ok(y <= SPARS.mastTop && y > SPARS.mastTop - span, `tang at ${y.toFixed(2)} m, masthead ${SPARS.mastTop} m`);
});

test('the boom swings with three\'s rotation.y = +boomAngle: + puts the end to starboard (+x)', () => {
  const e = rig.points.boomEnd(30);
  assert.ok(e[0] > 1.5 && e[2] > 0, `${e}`);
  close(rig.points.boomEnd(0), [0, SPARS.gooseneck, SPARS.goosenZ + SPARS.boom.length], 1e-9, 'boom end at 0°');
});

test('triangle budget: M4 ≤ 12 k (10 k + the hero pass\'s fittings), wires ≤ 64 spans; geometry is finite', () => {
  const g = buildSpars(rig);
  const w = wireArrays(g.wires);
  const tris = g.mast.triangleCount + g.boom.triangleCount + w.triangles;
  assert.ok(tris <= 12000, `${tris} triangles`);
  assert.ok(g.wires.length <= 64);
  for (const md of [g.mast, g.boom]) {
    const a = md.arrays();
    assert.ok(a.position.every(Number.isFinite) && a.normal.every(Number.isFinite), 'NaN in the geometry');
    assert.ok(a.index.every((i) => i < md.vertexCount));
  }
});

test('wind vector: the contract angle + from starboard blows toward port', () => {
  const w = windVector({ speed: 5, angle: Math.PI / 2 });
  assert.ok(w[0] < -4.99 && Math.abs(w[2]) < 1e-9);
  const h = windVector({ speed: 5, angle: 0 });   // head to wind: the air runs aft (+z)
  assert.ok(h[2] > 4.99);
});

test('the burgee hangs in no wind, streams downwind within 10° at 8 m/s, and is the same at the same t', () => {
  const L = 0.45;
  const hang = streamer(L, 8, [0, 0, 0], 0);
  assert.ok(hang.at(-1)[1] < -0.8 * L, `tip at ${hang.at(-1)[1].toFixed(3)} m`);
  for (const t of [0, 0.37, 1.9]) {
    const fly = streamer(L, 8, [6, 0, 5.3], t);
    const tip = fly.at(-1);
    const dir = vec.norm([tip[0], 0, tip[2]]), wind = vec.norm([6, 0, 5.3]);
    const ang = Math.acos(vec.dot(dir, wind)) * 180 / Math.PI;
    assert.ok(ang < 10, `${ang.toFixed(1)}° off downwind at t ${t}`);
    assert.ok(Math.atan2(-tip[1], Math.hypot(tip[0], tip[2])) * 180 / Math.PI < 10, 'flies near level at 8 m/s');
  }
  assert.deepEqual(streamer(L, 8, [3, 0, 1], 1.234), streamer(L, 8, [3, 0, 1], 1.234));
  // the length holds (the wave displaces sideways only, a little)
  const fly = streamer(L, 8, [6, 0, 0], 0.5);
  let s = 0; for (let k = 1; k < fly.length; k++) s += vec.len(vec.sub(fly[k], fly[k - 1]));
  assert.ok(s > L * 0.98 && s < L * 1.25, `length ${s.toFixed(3)}`);
});

test('nav light sectors follow COLREGs: green 0–112.5° starboard, red to port, stern the 135° aft, 2° fades', () => {
  assert.equal(navSector('green', 60), 1); assert.equal(navSector('green', -60), 0);
  assert.equal(navSector('red', -60), 1); assert.equal(navSector('red', 60), 0);
  assert.equal(navSector('green', 115), 0); assert.equal(navSector('stern', 115), 1);
  assert.equal(navSector('stern', 110), 0); assert.equal(navSector('stern', 180), 1);
  assert.ok(Math.abs(navSector('green', 112.5) - 0.5) < 1e-9);
  assert.equal(navSector('steaming', 0), 1); assert.equal(navSector('steaming', 150), 0);
  assert.equal(navSector('allround', 77), 1);
  // the sectors add up: from any bearing a sailing boat shows exactly one of side or stern (outside the fades)
  for (let b = -180; b < 180; b += 1) {
    if ([0, 112.5, -112.5].some((c) => Math.abs(b - c) <= 1)) continue;
    assert.equal(navSector('green', b) + navSector('red', b) + navSector('stern', b), 1, `bearing ${b}`);
  }
});

test('lights: off by day, on after sunset (sun centre −0.83°)', () => {
  assert.equal(navLevel(10), 0); assert.equal(navLevel(-5), 1);
  assert.ok(navLevel(-0.83) > 0.2 && navLevel(-0.83) < 0.8);
});

test('sail telltales: luffing lifts the windward yarn; over-sheeting stalls the leeward one', () => {
  assert.ok(sailFlow(1, -1, 0.2).stall > 0.8);    // windward (face +1, sails to port), luffing
  assert.equal(sailFlow(-1, -1, 0.2).stall, 0);   // leeward yarn still streams
  assert.equal(sailFlow(1, -1, 1).stall, 0);
  assert.ok(sailFlow(-1, -1, 1, 30).reverse > 0.9); // leeward stalls at 30° of attack: the flow separates
  // the physics' own stall (state.mainStall / jibStall) wins over the angle: the leeward yarn and the leech ribbons
  assert.equal(sailFlow(-1, -1, 1, 30, 0).reverse, 0);
  assert.ok(sailFlow(-1, -1, 1, null, 1).reverse > 0.99 && sailFlow(0, -1, 1, null, 1).reverse > 0.99);
  assert.equal(sailFlow(1, -1, 1, null, 1).reverse, 0, 'the windward yarn still streams');
  // the separated yarn droops (≈ 0.65), then streams back toward the luff (1): its flow along the chord changes sign
  const tip = (rev) => streamer(0.24, 6, [0, 0, 6 * (1 - 1.5 * rev)], 0, { stall: 0.35 * rev }).at(-1);
  assert.ok(tip(0)[2] > 0.15 && tip(0.66)[1] < -0.1 && tip(1)[2] < 0, `tips ${[0, 0.66, 1].map((r) => tip(r).map((v) => v.toFixed(2)).join(',')).join(' | ')}`);
});
