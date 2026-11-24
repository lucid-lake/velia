// Round 4 (owner, 2026-11-07: "This view is stunning. How can we make users see it?"): the night moment's pose and its
// gate, Cruise's stars camera on C at night, and the logbook's Milky Way find, driven by the band's real place.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { nightPose, nightReady, NIGHT_MOMENT } from '../classic/src/ui/nightMoment.js';
import { nextCamera, starsPose, CAMERAS, NIGHT_CAMERAS } from '../src/modes/chill/cameras.js';
import { createDiscoveries } from '../src/sail/discoveries.js';
import { bandAim } from '../src/core/milkyway-math.js';
import { getECIToECEFRotationMatrix } from '../classic/src/core/celestial.js';
import { worldToECEF } from '../classic/src/core/sky.js';
import { timeAt } from '../src/sim/place.js';
import { NOTABLE } from '../src/sail/findLine.js';

const PLACE = { latDeg: 38.954159, lonDeg: -120.100464, altM: 1897.9, date: '2026-07-04', utcOffsetH: -7 };
const aimAt = (hour) => {
  const m = getECIToECEFRotationMatrix(new Date(timeAt(hour, PLACE))), w = new THREE.Matrix4().copy(worldToECEF(PLACE).matrix).invert().setPosition(0, 0, 0);
  return bandAim((d) => { const v = new THREE.Vector3(...d).applyMatrix4(m).applyMatrix4(w).normalize(); return [v.x, v.y, v.z]; });
};
const elOf = (p) => Math.atan2(p.target[1] - p.pos[1], Math.hypot(p.target[0] - p.pos[0], p.target[2] - p.pos[2])) * 180 / Math.PI;
const azOf = (p) => (Math.atan2(p.target[0] - p.pos[0], -(p.target[2] - p.pos[2])) * 180 / Math.PI + 360) % 360;

test('the band\'s best point: the core at 22:30 on 4 July (19° up, SSE); a higher part of the band once the core is low', () => {
  const a = aimAt(22.5);
  assert.equal(a.l, 0, 'the core itself');
  assert.ok(Math.abs(a.altDeg - 19.3) < 1 && Math.abs(a.azDeg - 160.4) < 1, JSON.stringify(a));
  const early = aimAt(21.0);   // 21:00: the core 12° up and rising; still the core
  assert.ok(early && early.altDeg >= 10);
  const low = aimAt(28.0);    // 04:00: the core under 10°; the band higher up instead
  assert.ok(low && low.l !== 0 && low.altDeg >= 10, JSON.stringify(low));
});

test('the night moment\'s pose: low behind the boat, looking along the band\'s bearing, tilted up, the boat in the lower frame', () => {
  const a = aimAt(22.5), s = { x: 1687, z: -1270 };
  const p = nightPose(s, a);
  assert.ok(Math.abs(azOf(p) - a.azDeg) < 0.5, 'looks along the bearing');
  assert.ok(elOf(p) >= NIGHT_MOMENT.minPitchDeg - 1e-6 && elOf(p) < a.altDeg, `tilted up ${elOf(p).toFixed(1)}°, under the core`);
  const down = Math.atan2(p.pos[1] - 1, Math.hypot(s.x - p.pos[0], s.z - p.pos[2])) * 180 / Math.PI;   // the deck, ≈ 1 m up
  assert.ok(elOf(p) + down < NIGHT_MOMENT.fov / 2, 'the boat inside the frame, low');
  assert.ok(Math.abs(Math.hypot(p.pos[0] - s.x, p.pos[2] - s.z) - NIGHT_MOMENT.backM) < 1e-6 && p.pos[1] === NIGHT_MOMENT.eyeM);
});

test('the night moment waits for its night and its moment; once a session; off by the flag', () => {
  const ok = { enabled: true, done: false, dark: true, aim: aimAt(22.5), coverage: 0.6, storm: false, view: 'follow', bino: false, logbook: false, menuGone: true, stageBusy: false, introOn: false, urgent: false };
  assert.equal(nightReady(ok), true);
  for (const [k, v] of [['enabled', false], ['done', true], ['dark', false], ['aim', null], ['coverage', 0.9], ['storm', true], ['view', 'helm'], ['bino', true], ['logbook', true], ['menuGone', false], ['stageBusy', true], ['introOn', true], ['urgent', true]]) {
    assert.equal(nightReady({ ...ok, [k]: v }), false, k);
  }
});

test('Cruise: C cycles the stars camera only at night; the stars camera frames the band low and wide', () => {
  assert.ok(!CAMERAS.includes('stars') && NIGHT_CAMERAS.includes('stars'));
  assert.equal(nextCamera('island', 1), 'cinematic', 'by day: the five');
  assert.equal(nextCamera('island', 1, { night: true }), 'stars');
  assert.equal(nextCamera('stars', 1, { night: true }), 'cinematic');
  assert.equal(nextCamera('stars', 1), 'cinematic', 'the night ended on the stars camera: back to the five');
  const a = aimAt(22.5), p = starsPose({ x: 0, z: 0 }, a);
  assert.ok(p.pos[1] < 4 && p.fov >= 55 && elOf(p) > 0 && Math.abs(azOf(p) - a.azDeg) < 1);
});

test('the logbook\'s Milky Way: the view held on the band 4 s on a clear dark night, said quietly', () => {
  const a = aimAt(22.5), d = a.dir;
  const disc = createDiscoveries({ places: {} });
  const cam = (v) => ({ x: 0, y: 3, z: 0, fx: v[0], fy: v[1], fz: v[2], fovDeg: 50, aspect: 16 / 9 });
  const base = { x: 0, z: 0, heading: 0, sog: 1, tws: 4, twa: 1, sunElevDeg: -25 };
  let found = [];
  for (let i = 0; i <= 60; i++) found.push(...disc.update({ ...base, t: i * 0.1, rt: i * 0.1, cam: cam([0, 0, -1]), sky: { dir: d } }));
  assert.deepEqual(found, [], 'looking north, away from the band: nothing');
  for (let i = 0; i <= 30; i++) found.push(...disc.update({ ...base, t: 6 + i * 0.1, rt: 6 + i * 0.1, cam: cam(d), sky: null }));
  assert.deepEqual(found, [], 'the band, but not a clear dark night (sky null): nothing');
  for (let i = 0; i <= 45; i++) found.push(...disc.update({ ...base, t: 10 + i * 0.1, rt: 10 + i * 0.1, cam: cam(d), sky: { dir: d } }));
  assert.deepEqual(found, ['milkyway']);
  assert.ok(NOTABLE.has('milkyway'), 'a quiet subtitle line');
});
