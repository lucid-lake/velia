// v2's birds (v2/sim/birds.js): v1's cast flown by v1's flight model, without three.js. The parity test runs v1's own
// createBirds (src/birds/index.js, with three, as v1's tests do) beside v2's sim on the same terrain, seed and camera and
// demands the same birds in the same places, the same fades and levels of detail, and the same instance records.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBirdSim, bayPlaces, snagMesh, KEEP_M, ISTRIDE, NAMES, BIRD_TIERS } from '../sim/birds.js';
import { build, STRIDE, OFF } from '../../src/birds/build.js';
import { birdGeometry, speciesConsts } from '../render/birds.js';

// a lake with a ring of hills (the bay's walls) and a low point for the snag (v1's test world)
const heightAt = (x, z) => { const r = Math.hypot(x - 1000, z + 1000); return r < 700 ? -30 : (r - 700) * 0.5; };
const terrain = { heightAt, shoreDistance: (x, z) => Math.hypot(x - 1000, z + 1000) - 700 };

test('parity: v2\'s sim flies v1\'s birds (positions, quaternions, fades, LOD, events) over 30 s with cues', async () => {
  const THREE = await import('three/webgpu');
  const { createBirds } = await import('../../classic/src/birds/index.js');
  const v1 = createBirds({ terrain, seed: 3, start: [1000, -1000] });
  const v2 = createBirdSim({ terrain, seed: 3, start: [1000, -1000] });
  const cam = new THREE.PerspectiveCamera(); cam.position.set(1000, 3, -1000); cam.updateMatrixWorld();
  const sun = new THREE.Vector3(0.4, 0.6, 0.2).normalize();
  v1.group.userData.daylight({ elevDeg: 25, sunDir: sun });
  v2.setDaylight(25, [sun.x, sun.y, sun.z]);
  assert.deepEqual(v2.places, v1.places);
  for (let t = 0; t <= 30 + 1e-9; t += 1 / 30) {
    if (Math.abs(t - 10) < 1e-6) { v1.cue('takeoff'); v2.cue('takeoff'); v1.cue('plunge', { x: 1050, z: -1000 }); v2.cue('plunge', { x: 1050, z: -1000 }); }
    cam.position.x = 1000 + t * 2; cam.updateMatrixWorld();
    v1.update(t, cam); v2.update(t, [cam.position.x, cam.position.y, cam.position.z]);
  }
  assert.equal(v2.birds.length, v1.birds.length);
  v1.birds.forEach((b, i) => {
    const c = v2.birds[i];
    assert.equal(c.name, b.name); assert.equal(c.mode, b.mode);
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(c.pos[k] - b.pos[k]) < 1e-9, `${b.name} ${i} pos`);
    for (let k = 0; k < 4; k++) assert.ok(Math.abs(c.quat[k] - b.quat[k]) < 1e-9, `${b.name} ${i} quat`);
    assert.ok(Math.abs(c.fade - b.fade) < 1e-12 && c.lod === b.lod);
  });
  assert.equal(v2.stats.drawn, v1.stats.drawn);
  assert.equal(v2.stats.near, v1.stats.near);
  assert.ok(v2.log.length > 0 && v2.log.length === v1.log.length, 'the same events (the calls the sound plays)');
});

test('the snag: v1\'s perch and its mesh; the places on a terrain without a shore distance take v1\'s fallback', async () => {
  const { createSnag } = await import('../../classic/src/birds/snag.js');
  const p = bayPlaces(terrain, 1);
  const a = createSnag({ terrain, at: p.snag, seed: 1 }), b = snagMesh({ terrain, at: p.snag, seed: 1 });
  assert.deepEqual(b.perch, a.perch); assert.equal(b.perchYaw, a.perchYaw);
  const g = a.group.children[0].geometry;
  assert.equal(b.idx.length, g.index.count);
  assert.equal(b.pos.length, g.attributes.position.array.length);
  const q = bayPlaces({ heightAt }, 1);
  assert.deepEqual(q.raft, [1020, -1240], 'no shore distance: v1\'s raft fallback');
});

test('the keep-away floor holds (40 m) and the night empties the air; the tiers set the counts', () => {
  const B = createBirdSim({ terrain, seed: 5, start: [1000, -1000], boat: () => ({ x: 1000, z: -1000, sog: 3, heading: 0 }) });
  B.setDaylight(25, [0.4, 0.8, 0.2]);
  for (let t = 0; t <= 40; t += 1 / 30) {
    const cam = [1000 + Math.sin(t * 0.2) * 100, 4, -1000 + Math.cos(t * 0.2) * 100];
    B.update(t, cam);
    for (const b of B.birds) if (b.mode !== 'perch') assert.ok(Math.hypot(b.pos[0] - cam[0], b.pos[1] - cam[1], b.pos[2] - cam[2]) >= KEEP_M - 1e-6);
  }
  B.setDaylight(-10, [0.4, -0.2, 0.2]);
  for (let t = 40; t <= 60; t += 1 / 30) B.update(t, [1000, 4, -1000]);
  assert.ok(B.birds.filter((x) => x.mode !== 'raft' && x.mode !== 'perch').every((x) => x.fade < 0.01));
  const L = createBirdSim({ terrain, seed: 5, tier: 'low' });
  assert.equal(L.find('gulls').length, BIRD_TIERS.low.gulls);
  assert.equal(L.find('geese').length, BIRD_TIERS.low.geese);
});

test('the GPU side: v1\'s body as the vertex buffer (the same floats), the species constants, the records 24 floats', () => {
  for (const n of NAMES) for (const lod of [0, 1]) {
    const g = birdGeometry(n, lod), v = build(n, { lod });
    assert.equal(g.stride, STRIDE * 4);
    assert.deepEqual(Array.from(g.data.slice(0, STRIDE * 3)), Array.from(v.data.slice(0, STRIDE * 3)));
    assert.equal(g.indexCount, v.index.length);
    assert.equal(g.attributes.length, Object.keys(OFF).length);
  }
  const k = speciesConsts();
  assert.equal(k.length, NAMES.length * 16);
  assert.deepEqual(Array.from(k.slice(0, 3)), Array.from(new Float32Array(build('osprey').info.shoulder)), 'the osprey\'s shoulder first');
  const B = createBirdSim({ terrain, seed: 1 });
  B.setDaylight(30, [0.3, 0.8, 0.2]);
  B.update(0, [1200, 3, -1050]); B.update(0.5, [1200, 3, -1050]);
  const rec = B.draw.near.gull.n ? B.draw.near.gull : B.draw.far.gull;
  assert.ok(rec.n > 0 && rec.data.length >= rec.n * ISTRIDE);
  const o = 0; assert.ok(Math.abs(Math.hypot(rec.data[o + 4], rec.data[o + 5], rec.data[o + 6], rec.data[o + 7]) - 1) < 1e-6, 'a unit quaternion');
});
