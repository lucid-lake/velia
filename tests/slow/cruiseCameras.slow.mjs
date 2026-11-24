// The slow lane (npm run test:slow): the Cruise cameras' occlusion runs that tests/cruiseCameras.test.mjs leaves out (island
// seeds 2 and 3 (15 min), cinematic seeds 1 and 2, astern seed 1), and two voyages that ran in the fast suite until
// 2026-11-12: the island camera's picks (10 min) and the director (12 min). Bodies: tests/helpers/cases-cruiseCameras.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickIsland } from '../../src/modes/chill/cameras.js';
import { Director, DIRECTOR, helmAt } from '../../src/modes/chill/director.js';
import { chillWorld, voyage } from '../../src/modes/chill/sim.js';
import { FollowCamera } from '../../src/sim/boat/followCamera.js';
import { analyticSun } from '../../src/sim/timeOfDay.js';
import { loadTops } from '../../classic/src/forest/treetops.js';
import { crownSolid, sightClear } from '../../src/forest/crowns.js';
import { occlusionCase, OCCLUSION, FAST_OCCLUSION } from '../helpers/cases-cruiseCameras.mjs';

const DEG = Math.PI / 180;
const W = chillWorld({ seed: 1, hour: 19, rate: 0 });
const crowns = crownSolid(W.terrain, await loadTops());
const hull = (s) => [s.x, 1.5, s.z];
for (const c of OCCLUSION.filter((c) => !FAST_OCCLUSION(c))) occlusionCase(crowns, c);

test('the island camera: every pick stands clear of the crowns with a clear line to the hull, over the trees as well as the ground', () => {
  const g = { ground: W.terrain.heightAt, shore: W.terrain.shoreDistance, solid: crowns.at, open: crowns.open };
  // the boat where Cruise sails it: a 10-minute seeded voyage, a place every 30 s
  const places = [];
  voyage({ seed: 1, hour: 19, rate: 0, minutes: 10, world: W, skipper: 1, onTick: (t, s) => { if (Math.round(t * 60) % 1800 === 0) places.push({ x: s.x, z: s.z, heading: s.heading, sog: s.sog }); } });
  let found = 0;
  for (const boat of places) {
    const p = pickIsland(g, boat);
    if (!p) continue;
    found++;
    assert.ok(p[1] > crowns.at(p[0], p[2]) + 0.5, `the eye at ${p.map((v) => v | 0)} stands in a tree`);
    assert.ok(sightClear(crowns.at, p, hull(boat)), `the eye at ${p.map((v) => v | 0)} cannot see the hull at ${boat.x},${boat.z}`);
  }
  assert.ok(found >= places.length * 0.8, `${found} of ${places.length} places have a shore vantage`);
});


test('the director: close passes, medium and the odd wide shot (a median of 70-90 m); the helmsman never nearer than 25 m; the boat on a third', () => {
  const seed = 1, Wd = chillWorld({ seed, hour: 17, rate: 20 });
  const dir = new Director({ heightAt: Wd.terrain.heightAt, seed, solid: crowns.at });
  let follow = null, n = 0, close = 0, medium = 0, wide = 0, minHelm = Infinity, minBoat = Infinity, thirds = 0, framed = 0;
  const dists = [];
  voyage({ seed, hour: 17, minutes: 12, world: Wd, skipper: 1, onTick: (t, s, out, nav) => {
    if (Math.round(t * 60) % 2) return;
    const dt = 1 / 30;
    follow ??= new FollowCamera({ x: s.x, z: s.z, heading: s.heading });
    const fp = follow.update(dt, s);
    const p = dir.update(dt, { t, boat: { x: s.x, z: s.z, heading: s.heading, sog: s.sog }, sun: analyticSun(Wd.clock(t) % 24), look: nav.target.look, follow: fp, windSpeed: s.trueWind.speed, aspect: 16 / 9 });
    const d = Math.hypot(p.pos[0] - s.x, p.pos[1] - 1.5, p.pos[2] - s.z);
    dists.push(d); n++;
    if (d <= 60) close++; else if (d <= 150) medium++; else wide++;
    if (p.shot !== 'follow') { minHelm = Math.min(minHelm, Math.hypot(...p.pos.map((v, i) => v - helmAt(s)[i]))); minBoat = Math.min(minBoat, d); }
    // where the boat sits across the frame (NDC x): on a third is |x| 0.15-0.5 (the line is 1/3; the aim's spring lags the hull)
    if (p.shot !== 'follow') {
      const f = [p.target[0] - p.pos[0], p.target[2] - p.pos[2]], L = Math.hypot(...f), r = [-f[1] / L, f[0] / L];
      const bx = s.x - p.pos[0], bz = s.z - p.pos[2], along = (bx * f[0] + bz * f[1]) / L, across = bx * r[0] + bz * r[1];
      const ndc = across / along / (Math.tan(p.fov * DEG / 2) * 16 / 9);
      framed++; if (Math.abs(ndc) >= 0.15 && Math.abs(ndc) <= 0.5) thirds++;
    }
  } });
  dists.sort((a, b) => a - b);
  const med = dists[dists.length >> 1];
  console.log(`# director: ${n} frames; close (<= 60 m) ${(100 * close / n).toFixed(0)} %, medium ${(100 * medium / n).toFixed(0)} %, wide ${(100 * wide / n).toFixed(0)} %; median ${med.toFixed(0)} m; nearest boat ${minBoat.toFixed(1)} m, helmsman ${minHelm.toFixed(1)} m; on a third ${(100 * thirds / framed).toFixed(0)} %; cuts ${dir.cuts.map((c) => c.to).join(' ')}`);
  assert.ok(minHelm >= DIRECTOR.helmM - 1e-6, `the helmsman ${minHelm.toFixed(1)} m from the lens`);
  // owner, 2026-10-30: the middle between the old (median 250+ m) and the first fix (35 m): a median of 70–90 m
  assert.ok(close / n >= 0.2 && close / n <= 0.55, `close shots ${(100 * close / n).toFixed(0)} % of the time`);
  assert.ok(medium / n >= 0.25, `medium shots ${(100 * medium / n).toFixed(0)} % of the time`);
  assert.ok(med >= 65 && med <= 95, `median distance ${med.toFixed(0)} m`);
  assert.ok(wide / n > 0 && wide / n <= 0.25, `wide ${(100 * wide / n).toFixed(0)} % of the time`);
  assert.ok(thirds / framed >= 0.5, `the boat on a third ${(100 * thirds / framed).toFixed(0)} % of the directed frames`);
});
