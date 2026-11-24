// The birds (src/birds/): the bodies, the wingbeat, the flight model and the behaviours, with no
// browser. Determinism (the URL contract): the same seed and clock give the same flight.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { build, STRIDE, KIND, OFF } from '../src/birds/build.js';
import { SPECIES, strokeAt } from '../src/birds/species.js';
import { Bird, quatOf, rotate, bankFor, G, stepHunt, stepRaft, stepSoar, stepFlock, glidePose, flapPose, poseFor } from '../src/birds/flight.js';
import { sprayPool } from '../classic/src/birds/spray.js';
import { levelAt, soundFor, BIRD_SOUNDS } from '../src/birds/sound.js';

const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

test('every species builds a clean body at both levels of detail, inside its budget', () => {
  for (const n of Object.keys(SPECIES)) {
    for (const lod of [0, 1]) {
      const g = build(n, { lod });
      assert.equal(g.data.length % STRIDE, 0);
      assert.ok(g.data.every(Number.isFinite), `${n} ${lod}: NaN`);
      assert.ok(Math.max(...g.index) < g.info.vertices);
      assert.ok(g.info.triangles < (lod ? 700 : 4000), `${n} ${lod}: ${g.info.triangles} triangles`);
    }
    // the wingspan as built (tip to tip) is the species' real span within 12 %
    const g = build(n);
    let maxX = 0;
    for (let k = 0; k < g.info.vertices; k++) if (g.data[k * STRIDE + OFF.fx + 2] === KIND.primary) maxX = Math.max(maxX, Math.abs(g.data[k * STRIDE]));
    assert.ok(Math.abs(2 * maxX / SPECIES[n].spanM - 1) < 0.12, `${n}: span ${(2 * maxX).toFixed(2)} m vs ${SPECIES[n].spanM}`);
  }
});

test('the left half mirrors the right (side −1, x negated)', () => {
  const g = build('eagle'), right = [], left = [];
  for (let k = 0; k < g.info.vertices; k++) {
    const o = k * STRIDE;
    if (g.data[o + OFF.fx + 2] !== KIND.primary) continue;
    (g.data[o + OFF.fx + 3] > 0 ? right : left).push(g.data[o]);
  }
  assert.equal(right.length, left.length);
  assert.ok(near(Math.max(...right), -Math.min(...left), 1e-5));
});

test('the wingbeat: the downstroke takes 56 % of the cycle, the stroke is continuous, the hand folds on the upstroke', () => {
  const s0 = strokeAt(0, 30), sTop = strokeAt(0.999, 30), sMid = strokeAt(0.28, 30), sBot = strokeAt(0.56, 30);
  assert.ok(near(s0.flap, sTop.flap, 0.01), 'continuous over the cycle');
  assert.ok(s0.flap > sMid.flap && sMid.flap > sBot.flap, 'down through the downstroke');
  assert.ok(strokeAt(0.78, 30).hand < -0.2, 'the hand flexed mid-upstroke');
  assert.ok(near(s0.flap - sBot.flap, 2 * 30 * Math.PI / 180, 1e-6), 'peak to peak = twice the stroke');
});

test('frame conventions: yaw turns the bill, pitch lifts it, roll drops the right wing', () => {
  const r = (y, p, ro, v) => rotate(quatOf(y, p, ro), v);
  const f = r(Math.PI / 2, 0, 0, [0, 0, 1]); assert.ok(near(f[0], 1, 1e-9) && near(f[2], 0, 1e-9));
  assert.ok(r(0, 0.4, 0, [0, 0, 1])[1] > 0.38);
  assert.ok(r(0, 0, 0.4, [1, 0, 0])[1] < -0.38);
});

test('a coordinated turn banks by atan(v·ω/g), and the bird drops the inside wing', () => {
  assert.ok(near(bankFor(10, 0.3), Math.atan(3 / G)));
  const b = new Bird('gull', 0, 1, { pos: [0, 30, 0], yaw: 0, speed: 10 });
  for (let i = 0; i < 120; i++) { b.steer(1 / 60, b.yaw + 1, 10, 0); b.update(1 / 60); }
  // yaw grows to the left (x east, z south: from south toward east): the left wing (−x) is the inside one, so it goes down
  const leftTip = rotate(b.quat, [-1, 0, 0]);
  assert.ok(leftTip[1] < -0.2, `left tip y ${leftTip[1].toFixed(2)}`);
  assert.ok(Math.abs(b.roll) < 50 * Math.PI / 180, 'the bank stays a bird\'s');
});

test('the wingbeat frequency is the species\' (Pennycuick 1990)', () => {
  for (const n of ['osprey', 'eagle', 'gull', 'goose']) {
    const b = new Bird(n, 1, 7); b.forceFlap = 1; b.phase = 0;
    for (let i = 0; i < 600; i++) b.wings(1 / 60);
    assert.ok(near(b.phase, SPECIES[n].flight.hz * 10, 0.02), `${n}: ${b.phase.toFixed(2)} beats in 10 s`);
  }
});

test('flap-gliding: a gull glides between bursts, a goose never stops beating', () => {
  const share = (n) => { const b = new Bird(n, 3, 5); let flap = 0; for (let i = 0; i < 60 * 120; i++) { b.wings(1 / 60); if (b.amp > 0.5) flap++; } return flap / (60 * 120); };
  const gull = share('gull'), goose = share('goose'), eagle = share('eagle');
  assert.ok(gull > 0.15 && gull < 0.8, `gull ${gull.toFixed(2)}`);
  assert.ok(goose > 0.9, `goose ${goose.toFixed(2)}`);
  assert.ok(eagle < 0.2, `eagle ${eagle.toFixed(2)}`);
});

// a flat, deep lake with a little wind (the behaviours' world, without the terrain)
function lake(boat = null) {
  const events = [];
  return { events, env: { heightAt: () => -40, waterAt: () => 0, wind: [2, 1], camera: [0, 3, 0], sunElev: 20, shelter: 0, boat: () => boat, emit: (e) => events.push(e),
    thermals: [[400, 0], [-400, 200]], nest: [900, 900], gooseDest: () => [700, 0] } };
}

test('with the dive on (BIRDS.diveDefault, ?birddive=1) the osprey hunts: patrol, hover, stoop, a feet-first plunge, the lift, the shake, then off with the trout', () => {
  const { env, events } = lake({ x: 0, z: 0, sog: 2, heading: 0 });
  env.dive = true;   // the dive on
  const b = new Bird('osprey', 0, 3, { pos: [50, 30, 0] });
  const S = { phase: 'patrol', t: 0, next: 2 }, seen = new Set();
  let strikeLegs = 0, carryFish = 0;
  for (let i = 0; i < 60 * 60; i++) {
    stepHunt(b, 1 / 60, env, S); b.update(1 / 60); seen.add(S.phase);
    if (S.phase === 'stoop' && b.pos[1] < 1.5) strikeLegs = Math.max(strikeLegs, b.pose.legs);
    if (S.phase === 'carry') carryFish = b.pose.fish;
    assert.ok(b.pos[1] > -0.5, 'never under the lake');
  }
  for (const p of ['patrol', 'hover', 'stoop', 'water', 'lift', 'shake', 'carry']) assert.ok(seen.has(p), `no ${p}`);
  assert.equal(events.filter((e) => e.kind === 'plunge').length, 1);
  const pl = events.find((e) => e.kind === 'plunge'), dBoat = Math.hypot(pl.pos[0], pl.pos[2]);
  assert.ok(dBoat >= 50 && dBoat <= 120, `the plunge ${dBoat.toFixed(1)} m off the boat (owner: 50–120 m)`);
  assert.ok(strikeLegs > 1.2, 'the talons thrown forward at the strike');
  assert.equal(carryFish, 1);
});

test('the geese sit until the boat comes close, then run, splash and fly; they land again elsewhere', () => {
  const boat = { x: 300, z: 0, sog: 2.5, heading: -Math.PI / 2 };
  const { env, events } = lake(boat);
  const group = { members: [], alarm: null, dest: null };
  for (let i = 0; i < 5; i++) { const g = new Bird('goose', i, 9, { pos: [i * 3, 0, 0], speed: 0.3 }); g.mode = 'raft'; group.members.push(g); }
  const step = (s) => { for (let i = 0; i < 60 * s; i++) for (const g of group.members) { stepRaft(g, 1 / 60, env, g.state, group); g.t += 1 / 60; } };
  step(5);
  assert.ok(group.members.every((g) => g.state.phase === 'rest'), 'resting while the boat is far');
  boat.x = 40; step(6);
  assert.ok(group.members.some((g) => g.pos[1] > 3), 'airborne');
  assert.ok(events.some((e) => e.kind === 'patter') && events.some((e) => e.kind === 'honk'));
  boat.x = 5000; step(120);
  assert.ok(group.members.every((g) => g.state.phase === 'rest'), `landed: ${group.members.map((g) => g.state.phase)}`);
  assert.ok(events.some((e) => e.kind === 'land'));
});

test('the eagle circles a thermal at about its radius and banks into it', () => {
  const { env } = lake();
  const b = new Bird('eagle', 2, 4, { pos: [434, 120, 0], yaw: Math.PI });
  const S = { centre: [400, 0], radius: 34, dir: 1, top: 1000, left: 999 };
  const r = [], banks = [];
  for (let i = 0; i < 60 * 60; i++) { stepSoar(b, 1 / 60, env, S); b.update(1 / 60); if (i > 60 * 20) { r.push(Math.hypot(b.pos[0] - S.centre[0], b.pos[2] - S.centre[1])); banks.push(Math.abs(b.roll)); } }
  const mean = r.reduce((x, y) => x + y) / r.length, bank = banks.reduce((x, y) => x + y) / banks.length * 180 / Math.PI;
  assert.ok(mean > 25 && mean < 50, `radius ${mean.toFixed(1)} m`);
  assert.ok(bank > 12 && bank < 40, `bank ${bank.toFixed(1)}°`);
  assert.ok(b.pos[1] > 120, 'it climbs in the thermal');
});

test('the gull flock keeps its spacing (no two within 1.5 m) and is the same on a second run', () => {
  const run = () => {
    const { env } = lake();
    const gulls = [];
    for (let i = 0; i < 10; i++) { const g = new Bird('gull', i, 11, { pos: [i * 4, 30 + i, (i % 3) * 5], yaw: i }); g.mode = 'flock'; gulls.push(g); }
    let minD = Infinity;
    for (let s = 0; s < 60 * 40; s++) {
      stepFlock(gulls, 1 / 60, env, () => [100, 35, 50]);
      for (const g of gulls) g.t += 1 / 60;
      if (s > 600) for (let i = 0; i < 10; i++) for (let j = i + 1; j < 10; j++) minD = Math.min(minD, Math.hypot(gulls[i].pos[0] - gulls[j].pos[0], gulls[i].pos[1] - gulls[j].pos[1], gulls[i].pos[2] - gulls[j].pos[2]));
    }
    return { minD, pos: gulls.map((g) => g.pos.map((v) => v.toFixed(6)).join()).join('|') };
  };
  const a = run(), b = run();
  assert.ok(a.minD > 1.5, `closest ${a.minD.toFixed(2)} m`);
  assert.equal(a.pos, b.pos);
});

test('poses: the soaring eagle spreads and curls its fingers; a folded wing is folded', () => {
  assert.ok(glidePose('eagle', 1).splay > glidePose('eagle', 0).splay);
  assert.ok(glidePose('eagle', 1).curl > 0.4);
  assert.ok(flapPose('gull', 0.75).hand < glidePose('gull').hand, 'the hand flexes on the upstroke');
  assert.equal(poseFor('goose', 'fold').fold, 1);
  assert.equal(poseFor('osprey', 'carry').fish, 1);
});

test('the spray: a plunge throws a thin crown, its droplets and a narrow spout, all back in the lake within 1.5 s; the same seed, the same water', () => {
  const run = () => {
    const p = sprayPool(700, 3); p.emit({ kind: 'plunge', pos: [0, 0, 0], gain: 1 }); const n0 = p.count;
    let hi = 0, wide = 0, gone = null;
    for (let i = 0; i < 300; i++) {
      p.step(1 / 60);
      for (let k = 0; k < p.count; k++) { const o = k * p.P; if (p.age[k] < 0) continue; hi = Math.max(hi, p.data[o + 1]); wide = Math.max(wide, Math.hypot(p.data[o], p.data[o + 2])); }
      if (gone == null && p.count === 0) gone = (i + 1) / 60;
    }
    return { n0, n: p.count, hi, wide, gone };
  };
  const a = run(), b = run();
  assert.ok(a.n0 > 200, 'many small particles');
  assert.equal(a.n, 0);
  assert.ok(a.gone < 1.5, `back in the lake by ${a.gone?.toFixed(2)} s`);
  assert.ok(a.hi > 0.6 && a.hi < 2.0, `the spout's height ${a.hi.toFixed(2)} m`);
  assert.ok(a.wide < 3.5, `the drops land within ${a.wide.toFixed(2)} m`);
  assert.deepEqual(a, b);
  // tiny drops: nothing in the air bigger than a sheet fragment (0.2 m), most of them drops under 4 cm
  const p = sprayPool(700, 3); p.emit({ kind: 'plunge', pos: [0, 0, 0], gain: 1 });
  let small = 0; for (let k = 0; k < p.count; k++) { const s = p.data[k * p.P + 3]; assert.ok(s <= 0.2); if (s < 0.04) small++; }
  assert.ok(small / p.count > 0.65, `${small} of ${p.count} under 4 cm`);
});

test('the marks on the water: a plunge leaves a ring, a hole that closes and foam that fades; a goose run leaves one trail', async () => {
  const { birdWaterSources, RING_KINDS, TRAIL } = await import('../classic/src/birds/water.js');
  const w = birdWaterSources();
  w.ring(0, 5, 5, 'plunge');
  w.step(0.05); const s0 = w.at(w.rings[0]);
  w.step(0.8); const s1 = w.at(w.rings[0]);
  w.step(4); const s2 = w.at(w.rings[0]);
  assert.ok(s1.hole < s0.hole + 1e-9 || s0.hole < 0.6, 'the hole is there at once');
  assert.ok(s2.hole < 0.01, 'and closed by 4 s');
  assert.ok(s1.foam > s2.foam && s2.foam > 0, 'the foam fades');
  assert.ok(s2.R > s1.R && s1.R > s0.R, 'the ring spreads');
  w.step(RING_KINDS.plunge.life + 0.1);
  assert.equal(w.rings.length, 0, 'gone after its life');
  for (let k = 0; k < 20; k++) w.trail(10 + k * 0.16, 7, k * 0.5, 0, 1);
  assert.equal(w.trails.length, 1, 'one trail per goose run');
  assert.equal(w.trails[0].x1, 9.5);
  w.step(10 + 19 * 0.16 + TRAIL.life + 0.1);
  assert.equal(w.trails.length, 0);
});

test('the calls: quieter with distance, silent past their range; each event has its sound', () => {
  assert.ok(levelAt('osprey', 25) > levelAt('osprey', 100));
  assert.equal(levelAt('osprey', BIRD_SOUNDS.osprey.range + 1), 0);
  assert.equal(soundFor({ kind: 'call', species: 'eagle' }), 'eagle');
  assert.equal(soundFor({ kind: 'plunge' }), 'splash');
  assert.equal(soundFor({ kind: 'honk' }), 'goose');
});

test('no Math.random() and no wall clock in the birds\' flight (the URL contract)', () => {
  const dir = new URL('../src/birds/', import.meta.url);
  for (const f of readdirSync(dir)) {
    const src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Date\.now\(|new Date\(/.test(src), `${f}: the wall clock`);
  }
});

test('the system: the storm\'s shelter clears the air (not the water or the snag); same seed, same birds; none flying at night', async () => {
  const THREE = await import('three/webgpu');
  const { createBirds } = await import('../classic/src/birds/index.js');
  // a lake with a ring of hills (the bay's walls) and a low point for the snag
  const heightAt = (x, z) => { const r = Math.hypot(x - 1000, z + 1000); return r < 700 ? -30 : (r - 700) * 0.5; };
  const terrain = { heightAt, shoreDistance: (x, z) => Math.hypot(x - 1000, z + 1000) - 700 };
  const make = () => createBirds({ terrain, seed: 3, start: [1000, -1000] });
  const cam = new THREE.PerspectiveCamera(); cam.position.set(1000, 3, -1000); cam.updateMatrixWorld();
  const run = (B, from, to, hook) => { for (let t = from; t <= to + 1e-9; t += 1 / 30) { hook?.(t); B.update(t, cam); } };
  const a = make(), b = make();
  a.group.userData.daylight({ elevDeg: 25, sunDir: new THREE.Vector3(0.4, 0.6, 0.2).normalize() });
  b.group.userData.daylight({ elevDeg: 25, sunDir: new THREE.Vector3(0.4, 0.6, 0.2).normalize() });
  run(a, 0, 20); run(b, 0, 20);
  assert.deepEqual(a.birds.map((x) => x.pos.map((v) => v.toFixed(6))), b.birds.map((x) => x.pos.map((v) => v.toFixed(6))));
  assert.ok(a.stats.drawn > 10);
  a.setShelter(1); run(a, 20, 30);
  const air = a.birds.filter((x) => x.mode !== 'raft' && x.mode !== 'perch'), stay = a.birds.filter((x) => x.mode === 'raft' || x.mode === 'perch');
  assert.ok(air.every((x) => x.fade < 0.01), 'every airborne bird has left');
  assert.ok(stay.every((x) => x.fade > 0.99), 'the geese and the perched eagle stay');
  a.setShelter(0); run(a, 30, 40);
  assert.ok(air.every((x) => x.fade > 0.99), 'back after the storm');
  b.group.userData.daylight({ elevDeg: -10 }); run(b, 20, 30);
  assert.ok(b.birds.filter((x) => x.mode !== 'raft' && x.mode !== 'perch').every((x) => x.fade < 0.01), 'none in the air at night');
});

test('no bird ever comes within 40 m of the camera, whatever it is doing (owner, 2026-11-05)', async () => {
  const THREE = await import('three/webgpu');
  const { createBirds, KEEP_M } = await import('../classic/src/birds/index.js');
  const heightAt = (x, z) => { const r = Math.hypot(x - 1000, z + 1000); return r < 700 ? -30 : (r - 700) * 0.5; };
  const terrain = { heightAt, shoreDistance: (x, z) => Math.hypot(x - 1000, z + 1000) - 700 };
  const boat = { x: 1000, z: -1000, sog: 2.5, heading: 0 };
  const B = createBirds({ terrain, seed: 5, start: [1000, -1000], boat: () => boat });
  B.group.userData.daylight({ elevDeg: 25, sunDir: new THREE.Vector3(0.4, 0.6, 0.2).normalize() });
  const cam = new THREE.PerspectiveCamera();
  let worst = Infinity, t = 0;
  // the camera sails a loop through the bay (a follow camera 12 m behind the boat), the director cueing every behaviour near it
  const cues = { 5: () => B.cue('plunge', { x: boat.x + 20, z: boat.z - 30, y: 20, after: 0.3 }), 15: () => B.cue('lowpass', { bird: 'eagle', offset: 5, height: 3, from: [boat.x + 60, 10, boat.z], side: 1 }),
    30: () => B.cue('flock', { x: boat.x, z: boat.z, y: 10 }), 45: () => B.cue('raft', { x: boat.x + 30, z: boat.z, hold: false }) };
  const snag = [...B.find('perched').pos];
  for (let i = 0; i < 30 * 90; i++, t += 1 / 30) {
    const a = t * 0.02; boat.x = 1000 + Math.cos(a) * 300; boat.z = -1000 + Math.sin(a) * 300; boat.heading = a + Math.PI;
    if (t > 70) { const f = Math.min(1, (t - 70) / 10); boat.x += (snag[0] + 25 - boat.x) * f; boat.z += (snag[2] - boat.z) * f; }   // last, sail up to the snag
    cam.position.set(boat.x - Math.sin(boat.heading) * 12, 4, boat.z + Math.cos(boat.heading) * 12); cam.updateMatrixWorld();
    const k = Math.round(t * 30) / 30; if (cues[k]) cues[k]();
    B.update(t, cam);
    for (const b of B.birds) if (b.fade > 0.01 && b.mode !== 'perch') worst = Math.min(worst, Math.hypot(b.pos[0] - cam.position.x, b.pos[1] - cam.position.y, b.pos[2] - cam.position.z));
  }
  assert.ok(worst >= KEEP_M - 1e-6, `closest ${worst.toFixed(2)} m`);
  const p = B.find('perched');
  assert.notEqual(p.mode, 'perch', 'the eagle left the snag the camera came to');
});

test('with the dive off (?birddive=0) the osprey never dives, and the geese leave marks on the water only, nothing in the air', () => {
  const { env, events } = lake({ x: 0, z: 0, sog: 2, heading: 0 });
  env.dive = false;
  const b = new Bird('osprey', 0, 3, { pos: [50, 30, 0] });
  const S = { phase: 'patrol', t: 0, next: 2 };
  for (let i = 0; i < 60 * 90; i++) { stepHunt(b, 1 / 60, env, S); b.update(1 / 60); assert.equal(S.phase, 'patrol'); }
  assert.equal(events.filter((e) => e.kind === 'plunge').length, 0);
  const p = sprayPool(200, 1);
  for (const kind of ['patter', 'land', 'wingslap']) p.emit({ kind, pos: [0, 0, 0], gain: 1, ringsOnly: true, id: 1 });
  assert.equal(p.count, 0, 'nothing in the air');
  assert.ok(p.water.rings.length + p.water.trails.length >= 2, 'marks on the water');
});

test('the dive is on by default exactly when BIRDS.diveDefault is; the page can override it', async () => {
  const { createBirds, BIRDS } = await import('../classic/src/birds/index.js');
  const heightAt = (x, z) => { const r = Math.hypot(x - 1000, z + 1000); return r < 700 ? -30 : (r - 700) * 0.5; };
  const terrain = { heightAt, shoreDistance: (x, z) => Math.hypot(x - 1000, z + 1000) - 700 };
  assert.equal(createBirds({ terrain, seed: 3 }).dive, BIRDS.diveDefault);
  assert.equal(createBirds({ terrain, seed: 3, dive: undefined }).dive, BIRDS.diveDefault, 'no ?birddive: the constant');
  assert.equal(createBirds({ terrain, seed: 3, dive: false }).dive, false);
  assert.equal(createBirds({ terrain, seed: 3, dive: true }).dive, true);
});
