// node --test tests/binoculars.test.mjs — the binoculars (src/boat/binoculars.js), their sight rule
// (src/sail/discoveries.js SIGHT) and Day Sail's key table (src/sail/keys.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Binoculars, BINO, blendPose, yawPitchOf, dirOf, swayAt } from '../src/boat/binoculars.js';
import { HELM_CAM } from '../src/sim/boat/helmCamera.js';
import { makeTerrain, LANDMARKS } from '../src/sim/terrain.js';
import { layoutShoreline } from '../src/shoreline-layout.js';
import { harbourLayout } from '../src/harbour-layout.js';
import { createDiscoveries, placesFrom, terrainLos, SIGHT, aimOff } from '../src/sail/discoveries.js';
import { KEYMAP, PADMAP, KEY, collisions } from '../src/sail/keys.js';
import { SAIL_KEYS } from '../classic/src/controllers/sail.js';
import { HINTS } from '../src/ui/controlsHint.js';

const DEG = Math.PI / 180;
const terrain = makeTerrain({ seed: 1 });
const places = placesFrom({ terrain, shoreline: layoutShoreline(terrain, { seed: 1 }), harbour: harbourLayout({ terrain, seed: 1 }) });
const pose = (t = 0, o = {}) => ({ x: 1200, z: -1050, heading: 251 * DEG, heel: 0.12 * Math.sin(t), pitch: 0.03 * Math.sin(1.3 * t), heave: 0.2 * Math.sin(0.8 * t), ...o });
const normal = { pos: [1200, 6, -1040], target: [1190, 5, -1050], fov: 50, near: 0.5 };

test('raise: 6.5° at the helm’s eye, eased in over the raise; lowered, back to nothing', () => {
  const b = new Binoculars();
  let r = b.update(0.1, pose(), { held: true, from: normal });
  assert.ok(r.k > 0 && r.k < 1 && r.pose, 'coming up');
  for (let i = 0; i < 10; i++) r = b.update(0.1, pose(), { held: true, from: normal });
  assert.equal(r.k, 1); assert.equal(r.pose.fov, BINO.fov);
  assert.ok(Math.abs(r.pose.pos[1] - HELM_CAM.eye[1]) < 0.5, 'the helm’s eye height');
  // the aim starts where the normal view looked
  const [y0] = yawPitchOf(normal.target.map((v, i) => v - normal.pos[i]));
  assert.ok(Math.abs(b.yaw - y0) < 1e-9);
  for (let i = 0; i < 5; i++) r = b.update(0.1, pose(), { held: false });
  assert.equal(r.k, 0); assert.equal(r.pose, null);
  // the blend: the fov on a log scale between the two
  const m = blendPose({ ...normal, up: [0, 1, 0] }, { pos: [0, 2, 0], target: [0, 2, -100], up: [0, 1, 0], fov: 6.5 }, 0.5);
  assert.ok(Math.abs(m.fov - Math.sqrt(50 * 6.5)) < 1e-6);
});

test('steadied: the aim holds in the world through a tack and the waves; only the sway and a share of the roll reach it', () => {
  const b = new Binoculars();
  for (let i = 0; i < 20; i++) b.update(0.05, pose(i * 0.05), { held: true, from: normal });
  const aim = [];
  for (let i = 0; i < 400; i++) {
    const t = 1 + i * 0.05, r = b.update(0.05, pose(t, { heading: (251 - 90 * i / 400) * DEG }), { held: true });   // a 90° turn under the glasses
    aim.push(yawPitchOf(r.pose.target.map((v, k) => v - r.pose.pos[k])));
  }
  const yaws = aim.map((a) => a[0]), spread = Math.max(...yaws) - Math.min(...yaws);
  assert.ok(spread < 0.2 * DEG && spread > 0.01 * DEG, `the aim wandered ${(spread / DEG).toFixed(3)}° (sway only)`);
  const s = swayAt(3.7);
  assert.ok(Math.abs(s[0]) < 0.08 * DEG && Math.abs(s[1]) < 0.06 * DEG);
  // the look: the mouse's helm-view rate divided by the magnification
  const y0 = b.yaw; b.update(0.05, pose(), { held: true, look: [0.07, 0] });
  assert.ok(Math.abs(b.yaw - y0 - 0.07 * BINO.look) < 1e-9);
});

test('the focus pull: blurred as they come up, sharp after focusS', () => {
  const b = new Binoculars();
  let r, blurs = [];
  for (let i = 0; i < 40; i++) { r = b.update(0.05, pose(), { held: true, from: normal }); blurs.push(r.blurPx); }
  assert.ok(Math.max(...blurs) > BINO.focusPx * 0.8, 'a blur at the raise');
  assert.equal(blurs.at(-1), 0, 'sharp once raised and focused');
  assert.equal(blurs[0], 0, 'not before the glasses reach the eye');
});

// a sight stream: the glasses at the eye, aimed `off` rad from the target, for dur real s
function sight(p, { off = 0, dur = 1.5, raised = true, dt = 1 / 30, eye = { x: 1200, y: 2, z: -1050 }, disc = createDiscoveries({ places, los: terrainLos(terrain.heightAt) }), boats = null } = {}) {
  const [yaw, pitch] = yawPitchOf([p.x - eye.x, p.y - eye.y, p.z - eye.z]);
  const d = dirOf(yaw + off, pitch);
  const found = {};
  for (let t = 0; t <= dur; t += dt) {
    const s = { t: t * 2, rt: t, x: eye.x, z: eye.z, heading: 0, sog: 2, tws: 6, twa: -2, cam: null, sunElevDeg: 17, wheeler: null,
      bino: raised ? { ...eye, fx: d[0], fy: d[1], fz: d[2] } : null, boats };
    for (const id of disc.update(s)) found[id] = +t.toFixed(2);
  }
  return found;
}

test('sight: the ruin found only when the glasses are up, on it, for over 1 s of real time', () => {
  const ruin = places.ruin;
  assert.ok(Math.abs(ruin.x - LANDMARKS.ruin.x) < 1e-9);
  const ok = sight(ruin, { dur: 1.5 });
  assert.ok(ok.ruin >= SIGHT.holdS - 0.05 && ok.ruin <= SIGHT.holdS + 0.1, `found at ${ok.ruin} s`);
  assert.deepEqual(sight(ruin, { dur: 0.8 }), {}, 'under 1 s: not yet');
  assert.deepEqual(sight(ruin, { dur: 3, raised: false }), {}, 'not raised: never');
  assert.deepEqual(sight(ruin, { dur: 3, off: 3 * DEG }), {}, 'aimed 3° off: never');
  assert.ok(aimOff({ x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: -1 }, { x: 0, y: 0, z: 10 }) === Infinity, 'behind');
  // a glance away resets the dwell: 0.7 s on, 0.3 s off, 0.7 s on → not found
  const disc = createDiscoveries({ places, los: terrainLos(terrain.heightAt) });
  const f1 = sight(ruin, { dur: 0.7, disc }), f2 = sight(ruin, { dur: 0.3, off: 5 * DEG, disc }), f3 = sight(ruin, { dur: 0.7, disc });
  assert.deepEqual({ ...f1, ...f2, ...f3 }, {}, 'the dwell starts over after a look away');
  // too far: past SIGHT.maxM
  assert.equal(sight(ruin, { eye: { x: 4500, y: 2, z: -3000 }, dur: 2 }).ruin, undefined, `beyond ${SIGHT.maxM.ruin} m`);
});

test('sight: the terrain must be clear (the waterfall behind the island from the start); clear inside the bay it is found', () => {
  assert.deepEqual(sight(places.waterfall, { dur: 2 }), {}, 'hidden from the start');
  const f = sight(places.waterfall, { eye: { x: 100, y: 2, z: 400 }, dur: 1.5 });
  assert.ok(f.waterfall, 'found from inside the bay (983 m)');
});

test('sight: a far sail at 300 m – 5 km, not a near one', () => {
  const far = { x: 1200 + 1500, z: -1050 - 800, y: 5 }, near = { x: 1300, z: -1100, y: 5 };
  assert.ok(sight(far, { boats: [far], dur: 1.5 }).sail);
  assert.deepEqual(sight(near, { boats: [near], dur: 1.5 }), {});
});

test('keys: no collisions; B is the binoculars, reef moved to K; every key the Day Sail sources read is in the table', () => {
  assert.deepEqual(collisions().map(([a, b]) => `${a.code}: ${a.action} / ${b.action}`), []);
  assert.deepEqual(KEYMAP.filter((k) => k.code === 'KeyB').map((k) => k.action), ['the binoculars: up, and again down']);
  assert.ok(!KEYMAP.find((k) => k.code === 'KeyB').hold, 'B is a toggle, not held (owner, 2026-11-12)');
  assert.equal(KEY.reef, 'KeyK'); assert.equal(KEY.vhf, 'KeyO');
  // a planted clash is caught
  assert.equal(collisions([...KEYMAP, { code: 'KeyB', action: 'reef' }]).length, 1);
  assert.equal(collisions([...KEYMAP, { code: 'KeyQ', modes: ['pro-basic'], action: 'x' }]).length, 1);
  assert.equal(collisions([...KEYMAP, { code: 'KeyR', shift: true, modes: ['raw'], action: 'x' }]).length, 0, 'Shift+R in raw without pro is free');
  // the keys Sail reads must be bound: the sail controller's table (src/controllers/sail.js SAIL_KEYS), KEY's, and the keys
  // the hints watch (src/ui/controlsHint.js HINTS)
  const bound = new Set(KEYMAP.map((k) => k.code));
  const read = [...Object.values(SAIL_KEYS).flat(), ...Object.values(KEY), ...Object.values(HINTS).flatMap((h) => h.keys)]
    .filter((c) => /^(Key[A-Z]|Digit\d|Arrow(Left|Right|Up|Down))$/.test(c));
  assert.ok(read.length >= 30, `${read.length} codes read`);
  for (const c of read) assert.ok(bound.has(c), `Sail reads ${c}, not in keys.js`);
  // the pad: one action per button
  assert.equal(new Set(PADMAP.map((p) => p.button)).size, PADMAP.length);
});
