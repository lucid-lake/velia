// The boat on the shared sim (M3, v2/sim/boat.js): v1's physics wired to a water (heightAt), a terrain height and a
// wind; it starts where v1's Sail starts, sails (speed, heel, the sails drawing), holds its course when the helm is let
// go, answers the helm and the sheet, follows the waves' heave and roll through the float, and runs under 2 ms a frame;
// two runs with the same inputs are identical (the fixed step).
import test from 'node:test';
import assert from 'node:assert/strict';
import { budget } from '../../tests/helpers/budget.mjs';
import { createBoatSim, waterFor, START, KN } from '../sim/boat.js';
import { WindField } from '../../src/sim/wind.js';
import { steadyWind } from '../../src/sim/boat.js';
import { listBirthplaces, birthPose, BIRTH } from '../sim/birthplace.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const DEG = Math.PI / 180;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });
const flat = waterFor(() => 0);
const deep = () => -40;

test('starts at the first visit\'s birthplace on the reach rule and sails: under way, heeled, the sails drawing, the pilot holding the reach', () => {
  // the page's default start (v2/sim/birthplace.js): Tessie's water, 105° off the live wind, the island on the bow
  // side; the wind from 200° (the afternoon's). The waters file's `start` (1200, −1050, 251°) stays the URL pin and v1's
  const row = listBirthplaces(CURRENT_WATERS).find((r) => r.id === BIRTH.first);
  const pose = birthPose(row, { windDeg: 200 });
  const B = createBoatSim({ water: flat, heightAt: deep, wind: steady(6, 200), start: pose });
  assert.equal(B.state.x, row.x); assert.equal(B.state.z, row.z); assert.ok(Math.abs(B.state.heading - pose.headingDeg * DEG) < 1e-9);
  const off = Math.abs(((pose.headingDeg - 200 + 540) % 360) - 180);
  assert.ok(Math.abs(off - 105) < 5, `105° ± 5° off the wind: ${off.toFixed(1)}°`);
  B.settle(20);
  const r = B.row(), err = (h) => Math.abs(((h - pose.headingDeg + 540) % 360) - 180);
  assert.ok(r.sogKn > 4 && r.sogKn < 8.5, `speed ${r.sogKn} kn in 12 kn of wind on a reach`);
  assert.ok(err(r.headingDeg) < 3, `heading held: ${r.headingDeg}`);
  assert.ok(Math.abs(r.twaDeg) > 90, `on a reach (TWA ${r.twaDeg})`);
  assert.ok(r.fill > 0.8, 'the sails draw');
  // 10 s of hands off: the pilot keeps the course, the sheet is the crew's at first
  for (let i = 0; i < 600; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok(err(B.row().headingDeg) < 3, `still on course: ${B.row().headingDeg}`);
});

test('the URL pin\'s start (?start=1200,-1050&heading=251, the waters file\'s start): createBoatSim\'s default, close-hauled in 200°', () => {
  const B = createBoatSim({ water: flat, heightAt: deep, wind: steady(6, 200) });
  assert.equal(B.state.x, START.x); assert.equal(B.state.z, START.z); assert.ok(Math.abs(B.state.heading - START.headingDeg * DEG) < 1e-9);
  B.settle(20);
  const r = B.row();
  assert.ok(r.sogKn > 4 && r.sogKn < 7.5, `speed ${r.sogKn} kn in 12 kn of wind`);
  assert.ok(Math.abs(r.headingDeg - START.headingDeg) < 3, `heading held: ${r.headingDeg}`);
  assert.ok(r.twaDeg < 0 && r.physHeelDeg > 2, `wind on the port side (TWA ${r.twaDeg}), heeled to starboard ${r.physHeelDeg}°`);
});

test('the helm: steering to starboard turns the boat right; let go, the pilot holds the new course; the sheet pulls in and eases', () => {
  const B = createBoatSim({ water: flat, heightAt: deep, wind: steady(6, 200) });
  B.settle(20);
  const h0 = B.row().headingDeg;
  for (let i = 0; i < 300; i++) B.step(1 / 60, { steer: 1, pull: 0 });
  const h1 = B.row().headingDeg;
  const turned = ((h1 - h0 + 540) % 360) - 180;
  assert.ok(turned > 10, `turned ${turned.toFixed(1)}° to starboard in 5 s`);
  for (let i = 0; i < 600; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  const h2 = B.row().headingDeg, drift = ((h2 - h1 + 540) % 360) - 180;
  assert.ok(Math.abs(drift) < 6, `the pilot holds within 6° (${drift.toFixed(1)})`);
  // the sheet: the first pull takes the hand off the crew's; in, then out
  for (let i = 0; i < 120; i++) B.step(1 / 60, { steer: 0, pull: 1 });
  const s1 = B.row().sheetDeg; assert.ok(s1 != null);
  for (let i = 0; i < 120; i++) B.step(1 / 60, { steer: 0, pull: 1 });
  const s2 = B.row().sheetDeg; assert.ok(s2 < s1, `pulled in: ${s1}° → ${s2}°`);
  for (let i = 0; i < 120; i++) B.step(1 / 60, { steer: 0, pull: -1 });
  assert.ok(B.row().sheetDeg > s2, 'eased out');
});

test('the float: on a long swell the hull heaves and rolls with the water; on a flat sea it stays level', () => {
  const swell = waterFor((x, z, ) => 0.4 * Math.sin(0.08 * x + 0.05 * z));
  const B = createBoatSim({ water: swell, heightAt: deep, wind: steady(5, 200) });
  B.settle(10);
  let hMin = Infinity, hMax = -Infinity, rollMax = 0;
  for (let i = 0; i < 1200; i++) { const p = B.step(1 / 60, { steer: 0, pull: 0 }); hMin = Math.min(hMin, p.heave); hMax = Math.max(hMax, p.heave); rollMax = Math.max(rollMax, Math.abs(p.heel - B.state.heel)); }
  assert.ok(hMax - hMin > 0.3 && hMax - hMin < 1.0, `heave range ${(hMax - hMin).toFixed(2)} m on a 0.8 m swell`);
  assert.ok(rollMax > 0.5 * DEG, `the waves roll the hull (${(rollMax / DEG).toFixed(1)}°)`);
  const F = createBoatSim({ water: flat, heightAt: deep, wind: steady(5, 200) });
  F.settle(10);
  for (let i = 0; i < 300; i++) F.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok(Math.abs(F.pose.heave) < 0.02 && Math.abs(F.pose.pitch) < 0.5 * DEG, 'level on a flat sea');
});

test('the shared wind: a WindField (the day\'s base, a terrain height) drives it; the camera follows; two runs are identical; a frame costs under 2 ms', () => {
  const run = () => {
    const wind = new WindField({ seed: 1, day: { hour: 16, rate: 0 } });
    wind.setTerrain(() => -40);
    const B = createBoatSim({ water: flat, heightAt: deep, wind });
    B.settle(20);
    const rows = [];
    // the cost: the fastest of 20 batches of 30 frames, the code's own time, not the machine's load (v2 #29)
    let cpu = 0, best = Infinity;
    for (let i = 0; i < 600; i++) {
      const t0 = performance.now();
      B.step(1 / 60, { steer: i < 120 ? -0.6 : 0, pull: i > 300 ? 1 : 0 });
      const c = B.camera(1 / 60);
      cpu += performance.now() - t0;
      if (i % 30 === 29) { best = Math.min(best, cpu / 30); cpu = 0; }
      if (i % 60 === 0) rows.push([B.row(), c.pos.map((v) => +v.toFixed(3))]);
    }
    return { rows, ms: best, cam: B.camera(1 / 60) };
  };
  const a = run(), b = run();
  assert.deepEqual(a.rows, b.rows, 'deterministic');
  assert.ok(a.rows.at(-1)[0].sogKn > 1, 'moving on the day\'s wind');
  const c = a.cam, s = a.rows.at(-1)[0];
  assert.ok(Math.hypot(c.pos[0] - s.x, c.pos[2] - s.z) > 15 && Math.hypot(c.pos[0] - s.x, c.pos[2] - s.z) < 60, 'the follow camera stands 15–60 m off the boat');
  assert.ok(c.pos[1] > 3 && c.fov > 38 && c.fov < 46, 'above the water, v1\'s lens');
  budget(Math.min(a.ms, b.ms), 2, 'a boat-sim frame (the fastest batch)');
});
