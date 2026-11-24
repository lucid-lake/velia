// The Cruise cameras' occlusion runs (tests/cruiseCameras.test.mjs runs the island and Above cameras on seed 1;
// the slow lane, tests/slow/cruiseCameras.slow.mjs, the cinematic and astern cameras, the other seeds and the 15-minute island run). One body for both lanes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCameraRig } from '../../src/modes/chill/rig.js';
import { Director, helmAt } from '../../src/modes/chill/director.js';
import { chillWorld, voyage } from '../../src/modes/chill/sim.js';
import { FollowCamera } from '../../src/sim/boat/followCamera.js';
import { analyticSun } from '../../src/sim/timeOfDay.js';
import { sightClear } from '../../src/forest/crowns.js';

const ridePose = (s) => ({ x: s.x, z: s.z, heading: s.heading, heel: s.heel ?? 0, pitch: 0, heave: 0 });
const hull = (s) => [s.x, 1.5, s.z];

export const OCCLUSION = [['island', 1], ['island', 2], ['island', 3, 15], ['above', 1], ['cinematic', 1], ['cinematic', 2], ['astern', 1]];
export const FAST_OCCLUSION = (c) => c[1] === 1 && (c[0] === 'island' || c[0] === 'above');   // the fast suite: the island and Above cameras, seed 1

// one seeded 5-minute Cruise (the AI skipper on the navigator, as the page sails it), the rig in each view
function cruiseRun(crowns, view, { seed = 1, minutes = 5 } = {}) {
  const Wd = chillWorld({ seed, hour: 19, rate: 0 });
  const rig = createCameraRig({ terrain: Wd.terrain, follow: { update: (dt, s) => follow.update(dt, s) }, view, solid: crowns });
  let follow = null, dir = new Director({ heightAt: Wd.terrain.heightAt, seed, solid: crowns.at });
  let blocked = 0, worst = 0, inTree = 0, frames = 0, worstAt = null, minHelm = Infinity;
  voyage({ seed, hour: 19, rate: 0, minutes, world: Wd, skipper: 1, onTick: (t, s, out, nav) => {
    if (Math.round(t * 60) % 2) return;   // 30 Hz
    const dt = 1 / 30;
    follow ??= new FollowCamera({ x: s.x, z: s.z, heading: s.heading });
    const fp = rig.followStep(dt, s);
    const dp = dir.update(dt, { t, boat: { x: s.x, z: s.z, heading: s.heading, sog: s.sog }, sun: analyticSun(19), look: nav.target.look, follow: fp, windSpeed: s.trueWind.speed });
    const p = rig.pose(dt, { ride: ridePose(s), state: s, fp, dp });
    frames++;
    const ok = sightClear(crowns.at, p.pos, hull(s));
    blocked = ok ? 0 : blocked + dt;
    if (blocked > worst) { worst = blocked; worstAt = { t: +t.toFixed(1), pos: p.pos.map((v) => +v.toFixed(0)), boat: [s.x | 0, s.z | 0] }; }
    if (p.pos[1] < crowns.at(p.pos[0], p.pos[2]) + 0.3) inTree++;
    if (view === 'cinematic' && dp.shot !== 'follow') minHelm = Math.min(minHelm, Math.hypot(...p.pos.map((v, i) => v - helmAt(s)[i])));
  } });
  return { worst, worstAt, inTree, frames, picks: rig.island.picks, glides: rig.island.glides, cuts: rig.island.cuts, minHelm };
}

export function occlusionCase(crowns, [view, seed, minutes]) {
  test(`occlusion: the ${view} camera never loses the boat for more than 0.5 s over a seeded ${minutes ?? 5}-minute Cruise (seed ${seed}), and never stands in a tree`, () => {
    const r = cruiseRun(crowns, view, { seed, minutes: minutes ?? 5 });
    console.log(`# ${view}: ${r.frames} frames, worst blocked ${r.worst.toFixed(2)} s ${JSON.stringify(r.worstAt)}, in a tree ${r.inTree} frames${view === 'island' ? `, picks ${r.picks} glides ${r.glides} cuts ${r.cuts}` : ''}`);
    assert.ok(r.worst <= 0.5, `${view}: blocked ${r.worst.toFixed(2)} s at ${JSON.stringify(r.worstAt)}`);
    assert.equal(r.inTree, 0, `${view}: ${r.inTree} frames inside a crown`);
  });
}

