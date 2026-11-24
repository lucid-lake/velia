// The rival (commit 3): the start, the course, the shadow, the rubber band, determinism. Headless, 60 Hz, the
// real BoatPhysics on a steady wind (tests/helpers/skipper-sim.mjs windFn).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseFor } from '../src/sim/race/course.js';
import { runRace } from '../src/sim/race/sim.js';
import { Rival, BAND, TIERS } from '../src/sim/race/rival.js';
import { shadowAt, shadowed, SHADOW } from '../src/sim/race/dirtyAir.js';
import { windFn } from './helpers/skipper-sim.mjs';
import { makeTerrain } from '../src/sim/terrain.js';

const course = courseFor('tahoe-emerald', 'island-sprint');
const T = makeTerrain({ seed: 1 }), depthAt = (x, z) => -T.heightAt(x, z);

test('start at skill 1 on a steady 12 kn: over the line 0-4 s after the gun, never OCS (10 seeds)', () => {
  let worst = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const r = runRace({ course, windAt: windFn({ kn: 12, fromDeg: 210 }), tiers: { me: 'pro', wren: 'pro' }, seed, maxS: 12 });
    const st = r.events.filter((e) => e.type === 'started');
    assert.equal(st.length, 2, `seed ${seed}: both start`);
    assert.equal(r.events.some((e) => e.type === 'ocs' && !e.early), false, `seed ${seed}: no OCS`);
    assert.equal(r.events.some((e) => e.type === 'ocs'), false, `seed ${seed}: not early either`);
    assert.ok(Math.min(...st.map((e) => e.delayS)) >= 0 && Math.min(...st.map((e) => e.delayS)) <= 4, `seed ${seed}: first over at ${st.map((e) => e.delayS.toFixed(1))}`);
    worst = Math.max(worst, ...st.map((e) => e.delayS));
  }
  assert.ok(worst < 7, `the later boat is over by ${worst.toFixed(1)} s`);
});

test('at skill 0.5 the OCS rate is at most 15 % over 10 seeds', () => {
  let ocs = 0, boats = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const r = runRace({ course, windAt: windFn({ kn: 12, fromDeg: 210 }), tiers: { me: 'medium', wren: 'medium' }, seed, maxS: 8 });
    boats += 2; ocs += new Set(r.events.filter((e) => e.type === 'ocs').map((e) => e.id + seed)).size;
  }
  assert.ok(ocs / boats <= 0.15, `OCS ${ocs}/${boats}`);
});

test('the Island Sprint start to finish in under 10 min at skill 0.5 and 1 (steady 16 kn, the real bay depths)', () => {
  const r = runRace({ course, windAt: windFn({ kn: 16, fromDeg: 210 }), depthAt, tiers: { me: 'pro', wren: 'medium' }, seed: 1, maxS: 900 });
  assert.equal(Object.keys(r.finish).length, 2, 'both finish');
  for (const [id, t] of Object.entries(r.finish)) assert.ok(t > 300 && t < 600, `${id} ${t.toFixed(0)} s`);
  assert.equal(r.events.filter((e) => e.type === 'rounded').length, 4);
});

test('the shadow cuts the wind at least 10 % 30 m dead astern and 0 at 100 m; it is symmetric and 1.5 lengths wide at the boat', () => {
  const t = [0, 1];   // wind blowing toward +z
  assert.ok(shadowAt(0, 0, ...t, 0, 30) >= 0.10, `${shadowAt(0, 0, ...t, 0, 30)}`);
  assert.equal(shadowAt(0, 0, ...t, 0, 100), 0);
  assert.equal(shadowAt(0, 0, ...t, 0, -10), 0, 'nothing upwind');
  assert.equal(shadowAt(0, 0, ...t, 40, 30), 0, 'nothing outside the cone');
  assert.equal(shadowAt(0, 0, ...t, 5, 30), shadowAt(0, 0, ...t, -5, 30), 'symmetric');
  assert.equal(shadowAt(0, 0, ...t, SHADOW.w0 / 2 + 0.5, 0.5), 0);
  const w = shadowed(() => ({ vx: 0, vz: 6 }), () => [{ x: 0, z: 0 }]);
  assert.ok(w(0, 30, 0).vz < 6 * 0.9 && w(0, 100, 0).vz === 6 && w(50, 30, 0).vz === 6);
});

test('the rubber band moves only the rival\'s hands, inside [tier - 0.15, tier + 0.10]; the same seed gives the same finish time', () => {
  const rv = new Rival({ course, tier: 'medium', seed: 1, windAt: windFn({ kn: 12, fromDeg: 210 }) });
  let lo = 9, hi = -9;
  for (let i = 0; i < 6000; i++) { rv.band(0.1, i < 3000 ? 80 : -80); lo = Math.min(lo, rv.skill); hi = Math.max(hi, rv.skill); }
  assert.ok(lo >= TIERS.medium - BAND.down - 1e-9 && hi <= TIERS.medium + BAND.up + 1e-9, `${lo} ${hi}`);
  assert.ok(lo < 0.4 && hi > 0.58, 'it does move');
  const a = runRace({ course, windAt: windFn({ kn: 16, fromDeg: 210 }), depthAt, tiers: { me: 'pro', wren: 'medium' }, seed: 5, maxS: 700 });
  const b = runRace({ course, windAt: windFn({ kn: 16, fromDeg: 210 }), depthAt, tiers: { me: 'pro', wren: 'medium' }, seed: 5, maxS: 700 });
  assert.equal(a.finish.wren, b.finish.wren);
  for (const s of a.skills.wren) assert.ok(s >= TIERS.medium - BAND.down - 1e-9 && s <= TIERS.medium + BAND.up + 1e-9);
});
