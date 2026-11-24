// The bottom's matrices shared by tests/ground.test.mjs (the assist on a beam wind; Cruise seed 1) and the slow lane
// (tests/slow/ground.slow.mjs: the assist with the wind astern and ahead; Cruise seeds 2 and 3). One body for both lanes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shorePoints, pick, approach, depthAt, rockAt } from './ground-sim.mjs';
import { createGround } from '../../src/sim/boat/ground.js';
import { Sounder } from '../../src/sim/boat/sounder.js';

export const sp = shorePoints();
export const SETS = { beach: pick(sp.beach, 3), rock: pick(sp.rock, 2), island: pick(sp.island, 3) };
export const ANGLES = [0, -35, 35, -70, 70], SPEEDS = [3, 6, 8];
// the approaches are pure (the same options give the same runs), so a matrix two tests share is sailed once
const memo = new Map();
export const runs = (opts, kinds = Object.keys(SETS), angles = ANGLES, speeds = SPEEDS) => {
  const key = JSON.stringify([opts, kinds, angles, speeds]);
  if (memo.has(key)) return memo.get(key);
  const out = [];
  memo.set(key, out);
  for (const k of kinds) for (const T of SETS[k]) for (const a of angles) for (const kn of speeds) {
    const r = approach({ target: T, angleDeg: a, kn, ...opts });
    if (r) out.push({ k, T, a, kn, r });
  }
  return out;
};
export const tag = (x) => `${x.k} ${x.T.x | 0},${x.T.z | 0} ${x.a}° ${x.kn} kn`;

// the run count scales the old bar (250 runs over the three winds) to the winds asked for
export const ASSIST_WINDS = { 180: 'astern', 90: 'abeam', 40: 'ahead' };
export function assistCase(winds) {
  test(`with the assist (default, not Pro): the boat bears away and never grounds, at 3, 6 and 8 kn from five angles, wind ${winds.map((w) => ASSIST_WINDS[w]).join(' and ')}`, () => {
  let n = 0, engaged = 0;
  for (const w of winds) for (const x of runs({ assist: true, windRelDeg: w })) {
    n++;
    assert.ok(!x.r.grounded && x.r.final.mode !== 'aground', `${tag(x)} wind ${w}: aground`);
    assert.ok(x.r.minKeel >= 0, `${tag(x)} wind ${w}: keel clearance ${x.r.minKeel.toFixed(2)} m`);
    assert.ok(x.r.minHull >= 0.1, `${tag(x)} wind ${w}: hull ${x.r.minHull.toFixed(2)} m`);
    if (x.r.assistEvents.some((e) => e.ev === 'engage')) engaged++;
  }
  assert.ok(n >= Math.ceil(250 * winds.length / 3), `${n} runs`);
  assert.ok(engaged >= n * 0.9, `the assist engaged in ${engaged} of ${n}`);
});
}

export function cruiseGroundCase(seed) {
  test(`Cruise and the AI skipper use the same depth and never ground: 15 minutes, seed ${seed}, the bottom live`, async () => {
  const { voyage } = await import('../../src/modes/chill/sim.js');
  {
    const ground = createGround({ depthAt, rockAt }), so = new Sounder();
    let level = 0, t = 0;
    const res = voyage({ seed, minutes: 15, ground, onTick: (tt, s) => { t = tt; const r = so.update(1 / 60, { under: ground.state.under, depth: ground.state.depth, sog: s.sog }, tt); level = Math.max(level, r.level); } });
    assert.equal(ground.state.mode, 'afloat', `seed ${seed}`);
    assert.ok(ground.state.minKeelClear >= 1.0 && ground.state.minHullClear >= 1.0, `seed ${seed}: least keel clearance ${ground.state.minKeelClear.toFixed(2)} m`);
    assert.equal(ground.take().filter((e) => e.type !== 'refloat').length, 0, `seed ${seed}: no touch, no thud`);
    assert.equal(level, 0, `seed ${seed}: the sounder never alarms in Cruise's water (least depth ${res.rec.minDepth.toFixed(1)} m)`);
  }
});
}
