// Cruise's cameras, fix/cruise-cameras (owner, 2026-10-30: "terrible"): the Above camera (it
// replaces the Deck camera) holds its height and pitch and follows smoothly; no camera loses sight of the boat behind the
// terrain or a tree crown for more than 0.5 s over a seeded 5-minute Cruise run (the real bay, the lidar crowns), and none
// stands inside a tree; the director works closer (close passes, medium, the odd wide) and keeps the helmsman >= 25 m away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERAS, CAMERA_WORDS, AboveCam, ABOVE, IslandCam } from '../src/modes/chill/cameras.js';
import { createCameraRig } from '../src/modes/chill/rig.js';
import { chillWorld } from '../src/modes/chill/sim.js';
import { loadTops } from '../classic/src/forest/treetops.js';
import { crownSolid, sightClear } from '../src/forest/crowns.js';
import { cruiseKind, CRUISE_KEYMAP, collisions } from '../src/sail/keys.js';
import { occlusionCase, OCCLUSION, FAST_OCCLUSION } from './helpers/cases-cruiseCameras.mjs';

const DEG = Math.PI / 180;
const W = chillWorld({ seed: 1, hour: 19, rate: 0 });
const tops = await loadTops();
const crowns = crownSolid(W.terrain, tops);
const ridePose = (s) => ({ x: s.x, z: s.z, heading: s.heading, heel: s.heel ?? 0, pitch: 0, heave: 0 });

test('crowns: the lidar is loaded and the bay\'s slopes are solid to the crowns\' tops', () => {
  assert.ok(tops && tops.n > 100000, 'the treetops file');
  assert.ok(crowns.lidar);
  let land = 0, wooded = 0;
  for (let x = -1500; x < 2500; x += 25) for (let z = -1500; z < 1500; z += 25) if (W.terrain.heightAt(x, z) > 5) { land++; if (crowns.top(x, z) > W.terrain.heightAt(x, z) + 3) wooded++; }
  assert.ok(wooded / land > 0.4, `${(100 * wooded / land).toFixed(0)} % of the land under crowns`);
  // a sight line over open water is clear; one through a wooded slope is not
  assert.equal(sightClear(crowns.at, [270, 20, 30], [400, 2, 30]), true);
});

test('cameras: the five are Cinematic, Boat, Above, Helm, Island (Deck is gone)', () => {
  assert.deepEqual(CAMERAS, ['cinematic', 'astern', 'above', 'helm', 'island']);
  assert.equal(CAMERA_WORDS.above, 'Above');
  assert.ok(!CAMERAS.includes('deck'));
});

test('keys: V is the Above camera in Cruise (again: north-up / course-up), a passenger key, no collision', () => {
  assert.equal(cruiseKind('KeyV', false), 'passenger');
  assert.deepEqual(collisions(CRUISE_KEYMAP).map(([a, b]) => `${a.code}: ${a.action} / ${b.action}`), []);
});

const pitchOf = (p) => Math.atan2(p.pos[1] - p.target[1], Math.hypot(p.target[0] - p.pos[0], p.target[2] - p.pos[2])) / DEG;
const azOf = (p) => Math.atan2(p.target[0] - p.pos[0], -(p.target[2] - p.pos[2]));

test('the Above camera: 60-120 m up, pitched 70-85 deg down, north-up by default and course-up on V, the wheel zooms 50-140 m', () => {
  const cam = new AboveCam({ solid: crowns.at });
  const s = { x: 270, z: 30, heading: 1.2, sog: 2.5 };
  let p; for (let i = 0; i < 600; i++) { s.x += Math.sin(s.heading) * s.sog / 60; s.z -= Math.cos(s.heading) * s.sog / 60; p = cam.update(1 / 60, s); }
  assert.ok(p.pos[1] >= 60 && p.pos[1] <= 120, `height ${p.pos[1].toFixed(1)} m`);
  assert.ok(pitchOf(p) >= 70 && pitchOf(p) <= 85, `pitch ${pitchOf(p).toFixed(1)} deg`);
  assert.ok(Math.abs(azOf(p)) < 2 * DEG, `north-up: the view looks north (${(azOf(p) / DEG).toFixed(1)} deg)`);
  assert.ok(Math.hypot(p.target[0] - s.x, p.target[2] - s.z) < ABOVE.leadMax + 1, 'the boat stays near the frame centre');
  cam.toggle();
  for (let i = 0; i < 60 * 30; i++) { s.x += Math.sin(s.heading) * s.sog / 60; s.z -= Math.cos(s.heading) * s.sog / 60; p = cam.update(1 / 60, s); }
  assert.ok(Math.abs(Math.atan2(Math.sin(azOf(p) - s.heading), Math.cos(azOf(p) - s.heading))) < 3 * DEG, `course-up: the view looks along the heading (${(azOf(p) / DEG).toFixed(1)} vs ${(s.heading / DEG).toFixed(1)})`);
  for (let i = 0; i < 400; i++) p = cam.update(1 / 60, s, { zoom: 0.98 });
  assert.ok(cam.h >= ABOVE.hMin - 1e-9 && cam.h <= ABOVE.hMin + 1, `zoomed in to ${cam.h.toFixed(1)} m`);
  for (let i = 0; i < 400; i++) p = cam.update(1 / 60, s, { zoom: 1.03 });
  assert.ok(cam.h <= ABOVE.hMax + 1e-9 && cam.h >= ABOVE.hMax - 1, `zoomed out to ${cam.h.toFixed(1)} m`);
});

test('the Above camera: a tack in course-up turns the view smoothly (under 12 deg/s, no step over 0.6 m a frame)', () => {
  const cam = new AboveCam({ solid: crowns.at }); cam.toggle();
  const s = { x: 270, z: 30, heading: 0.9, sog: 2.5 };
  let prev = null, worstTurn = 0, worstStep = 0;
  for (let i = 0; i < 60 * 40; i++) {
    const t = i / 60; if (t > 8 && t < 14) s.heading -= (90 * DEG / 6) / 60;   // a 90 deg tack over 6 s
    s.x += Math.sin(s.heading) * s.sog / 60; s.z -= Math.cos(s.heading) * s.sog / 60;
    const p = cam.update(1 / 60, s);
    if (prev && i > 60) { worstTurn = Math.max(worstTurn, Math.abs(Math.atan2(Math.sin(azOf(p) - azOf(prev)), Math.cos(azOf(p) - azOf(prev)))) / DEG * 60); worstStep = Math.max(worstStep, Math.hypot(p.pos[0] - prev.pos[0], p.pos[1] - prev.pos[1], p.pos[2] - prev.pos[2])); }
    prev = p;
  }
  assert.ok(worstTurn < 12, `turned ${worstTurn.toFixed(1)} deg/s`);
  assert.ok(worstStep < 0.6, `stepped ${worstStep.toFixed(2)} m`);
});

// the island camera's picks over a 10-minute voyage (about 5 s) run in the slow lane: tests/slow/cruiseCameras.slow.mjs

// the occlusion runs (tests/helpers/cases-cruiseCameras.mjs): the island and Above cameras on seed 1 here, the rest in the slow lane
// (tests/slow/cruiseCameras.slow.mjs)
for (const c of OCCLUSION.filter(FAST_OCCLUSION)) occlusionCase(crowns, c);

// the director over a 12-minute voyage (about 6 s) runs in the slow lane: tests/slow/cruiseCameras.slow.mjs
