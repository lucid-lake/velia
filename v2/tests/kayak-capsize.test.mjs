// The kayak capsize (feat/v2-kayak-capsize): the roll as a rigid body (v2/sim/kayak-roll.js), the sailboat's hull against a
// kayak in the fleet (v2/sim/kayaks.js), the swimmer's pose (v2/sim/kayak-clip.js), the rigid rows (rigid.js).
//   - a soft bump (under ≈ 1 m/s closing on the beam) rocks the kayak and it comes back upright; a hard one on the beam puts
//     it over; a glancing touch at speed only rocks it
//   - every capsize ends upright with the paddler back in (an Eskimo roll within 6 s, a swim within 16 s), the swimmer's
//     head out of the water while it waits; the kayaker does not paddle while over, and keeps clear of the boat after
//   - the skipper's line once; a breaking crest's slap only in a strong wind on steep water
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeTerrain } from './helpers/ground.mjs';
import { createKayakFleet, LINES } from '../sim/kayaks.js';
import { createRoll, rollImpulse, stepRoll, ROLL, barrier, righting } from '../sim/kayak-roll.js';
import { HULL } from '../../src/sim/kayaks/agent.js';
import { parseKayakAsset } from '../render/kayak/asset.js';
import { createClips } from '../sim/kayak-clip.js';
import { mulRows, invRigid, blendRows } from '../sim/kayak-rigid.js';
import { splashGain } from '../living/kayaks-sound.js';

const DEG = Math.PI / 180;
const T = makeTerrain();
const START = { x: 1200, z: -1050, heading: 251 * DEG };
const beamShove = (U) => 1.15 * HULL.M * 1.5 * U * ROLL.hitH;   // the fleet's first-touch shove for a closing speed U on the beam

function runRoll(R, secs, env = {}) {
  const log = [];
  for (let i = 0; i < secs * 60; i++) { stepRoll(R, 1 / 60, env); for (const e of R.events) log.push([+(i / 60).toFixed(2), e]); }
  return log;
}

test('the hull\'s roll: upright and upside down both rest; the paddler aboard has a barrier, the empty hull floats either way up', () => {
  assert.ok(Math.abs(righting(0, ROLL.occ)) < 1e-12);
  assert.ok(righting(20 * DEG, ROLL.occ) < 0 && righting(-20 * DEG, ROLL.occ) > 0, 'restoring near upright');
  assert.ok(righting(80 * DEG, ROLL.occ) > 0, 'past the vanishing angle it goes over');
  assert.ok(righting(160 * DEG, ROLL.empty) > 0 && righting(-160 * DEG, ROLL.empty) < 0, 'the empty hull rests upside down');
  const b = barrier();
  assert.ok(b > 90 && b < 170, `the barrier ${b.toFixed(0)} J`);
});

test('a soft shove rocks the kayak and it settles upright; a hard one on the beam puts it over', () => {
  for (const U of [0.5, 0.8, 1.0]) {
    const R = createRoll({ seed: 5, skill: 0 }); rollImpulse(R, -beamShove(U));
    let max = 0; for (let i = 0; i < 60 * 8; i++) { stepRoll(R, 1 / 60); max = Math.max(max, Math.abs(R.phi)); }
    assert.equal(R.capsizes, 0, `${U} m/s: no capsize`);
    assert.ok(max > 8 * DEG, `${U} m/s rocks it (${(max / DEG).toFixed(0)}°)`);
    assert.ok(Math.abs(R.phi) < 1 * DEG && R.mode === 'up', `${U} m/s: upright again`);
  }
  for (const U of [1.6, 2.5, 3.5]) {
    const R = createRoll({ seed: 5, skill: 0 }); rollImpulse(R, -beamShove(U));
    const log = runRoll(R, 3);
    assert.ok(log.some(([, e]) => e === 'capsize'), `${U} m/s: over`);
    assert.equal(R.side, -1, 'pushed to starboard above the roll centre: the starboard side goes down (φ −)');
  }
});

test('recovery: a skilled paddler rolls back up within 6 s; a swimmer is back in within 16 s, head out of the water while it waits', () => {
  const R = createRoll({ seed: 5, skill: 1 }); rollImpulse(R, -beamShove(2.5));
  const log = runRoll(R, 8);
  const done = log.find(([, e]) => e === 'done');
  assert.ok(done && done[0] < 6, `the Eskimo roll done at ${done?.[0]} s`);
  assert.ok(!log.some(([, e]) => e === 'exit'), 'no wet exit');
  assert.ok(Math.abs(R.phi) < 5 * DEG && R.aboard === 1 && R.mode === 'up');

  for (const seed of [5, 6, 7]) {
    const S = createRoll({ seed, skill: 0 }); rollImpulse(S, -beamShove(2.5));
    let t = 0, outAt = null, under = 0, minH = Infinity, held = false, freed = 0;
    for (let i = 0; i < 60 * 20 && S.mode !== 'done'; i++) {
      stepRoll(S, 1 / 60); t += 1 / 60;
      if (S.events.includes('exit')) outAt = t;
      // past the first 1.5 s of surfacing, the neck is above the water until the climb (no one stays under)
      if (outAt != null && t > outAt + 1.5 && S.sw.vis && S.mode !== 'climb') { minH = Math.min(minH, S.sw.h); if (S.sw.h < 0) under += 1 / 60; }
      if (S.pd.free > 0.9) freed++;
      if (S.sw.hold > 0.95) held = true;
      if (S.events.includes('done')) break;
    }
    assert.ok(S.mode === 'up' && t < 16, `seed ${seed}: back in at ${t.toFixed(1)} s`);
    assert.ok(Math.abs(S.phi) < 5 * DEG && S.aboard === 1 && S.sw.vis === 0, 'upright, the paddler aboard');
    assert.equal(under, 0, `seed ${seed}: the head under water ${under.toFixed(2)} s (lowest neck ${minH.toFixed(2)} m)`);
    assert.ok(freed > 30 && held, 'the paddle floated free, then was taken back');
  }
});

test('a breaking crest\'s slap: never in calm or on flat water; rare in a strong wind beam-on to steep water', () => {
  const calm = createRoll({ seed: 9 }); runRoll(calm, 600, { windMs: 4, slope: 0.2 });
  assert.equal(calm.slaps, 0);
  const flat = createRoll({ seed: 9 }); runRoll(flat, 600, { windMs: 12, slope: 0.01 });
  assert.equal(flat.slaps, 0);
  let slaps = 0, over = 0;
  for (const seed of [1, 2, 3, 4]) { const R = createRoll({ seed, skill: 0.5 }); runRoll(R, 900, { windMs: 12, slope: 0.15 }); slaps += R.slaps; over += R.capsizes; }
  assert.ok(slaps >= 4 && slaps <= 40, `${slaps} slaps in 4 × 15 min`);
  assert.ok(over >= 1, `${over} capsizes from them`);
});

// the fleet: the sailboat at U m/s, a kayak still across its course `angle` off, 7 m ahead of the bow
function bump({ U, angle = 90, secs = 25 }) {
  const boat = { ...START, u: U, v: 0, sog: U, yawRate: 0 }, said = [];
  const F = createKayakFleet({ terrain: T, seed: 1, start: START, boat: () => boat, heightAt: () => 0, hour: () => 9, wind: () => 1.5, say: (t) => { said.push(t); return true; } });
  const it = [...F.live.values()][0], a = it.a;
  a.x = boat.x + Math.sin(boat.heading) * 7; a.z = boat.z - Math.cos(boat.heading) * 7; a.heading = boat.heading + angle * DEG; a.v = 0; a.r = 0; a.restLeft = 30;
  const wantBefore = it.m.P.want;
  const rec = { max: 0, overT: null, doneT: null, paddledOver: false, wantAfter: null, maxWant: 0 };
  for (let i = 0; i < secs * 60; i++) {
    boat.x += Math.sin(boat.heading) * boat.u / 60; boat.z -= Math.cos(boat.heading) * boat.u / 60; boat.u = U;
    F.step(1 / 60, { x: boat.x, z: boat.z, fwdX: 0, fwdZ: -1, hHalf: 0.6 });
    rec.max = Math.max(rec.max, Math.abs(it.R.phi)); rec.maxWant = Math.max(rec.maxWant, it.m.P.want);
    // (the intent of a step that began capsized: the step the kayak goes over in was paddled)
    if (it.R.busy) { if (rec.overT != null && (a.intent.throttle !== 0 || a.intent.turn !== 0)) rec.paddledOver = true; rec.overT ??= i / 60; }
    else if (rec.overT != null && rec.doneT == null) { rec.doneT = i / 60; rec.wantAfter = it.m.P.want; }
  }
  return { F, it, said, rec, wantBefore, st: F.stats() };
}

test('the fleet: a soft bump rocks and pushes the kayak, a hard one on the beam capsizes it; it recovers, says one line, keeps clear', () => {
  const soft = bump({ U: 0.8 });
  assert.equal(soft.st.contacts.length, 1, 'the hull touched the kayak');
  assert.equal(soft.st.capsizes.length, 0, 'a soft bump: no capsize');
  assert.ok(soft.rec.max > 8 * DEG && soft.rec.max < 50 * DEG, `rocked ${(soft.rec.max / DEG).toFixed(0)}°`);
  assert.ok(soft.said.includes(LINES.bump) && !soft.said.includes(LINES.capsize));
  assert.ok(soft.rec.maxWant > soft.wantBefore, 'shaken: it wants a wider gap for a while');
  assert.equal(soft.it.m.P.want, soft.wantBefore, 'and then its own again');

  const hard = bump({ U: 2.5 });
  assert.equal(hard.st.capsizes.length, 1);
  assert.ok(hard.st.capsizes[0].byBoat);
  assert.ok(hard.rec.doneT != null && hard.rec.doneT - hard.rec.overT < 16, `recovered in ${(hard.rec.doneT - hard.rec.overT).toFixed(1)} s`);
  assert.ok(Math.abs(hard.it.R.phi) < 5 * DEG && hard.it.R.mode === 'up', 'upright at the end');
  assert.equal(hard.rec.paddledOver, false, 'no paddling while capsized');
  assert.ok(hard.rec.wantAfter >= 28, `after it keeps clear (wants ${hard.rec.wantAfter} m)`);
  assert.equal(hard.said.filter((t) => t === LINES.capsize).length, 1, 'the skipper\'s line once');
  assert.ok(!hard.said.includes(LINES.bump), 'no bump line on top of it');
  assert.ok(hard.F.draws.full.length + hard.F.draws.mid.length + hard.F.draws.far.length > 0);

  const glance = bump({ U: 3, angle: 10 });
  assert.equal(glance.st.capsizes.length, 0, 'a glancing touch along the kayak at 3 m/s only rocks it');
  // determinism: the same bump, the same roll
  assert.deepEqual(bump({ U: 2.5, secs: 6 }).st.kayaks, bump({ U: 2.5, secs: 6 }).st.kayaks);
});

test('the capsize\'s draw records: the hull rolled about its centre, the waterline at the world\'s water, the swimmer and the paddle placed', async () => {
  const A = await parseKayakAsset(readFileSync(new URL('../assets/kayak/kayak.kyb.gz', import.meta.url)));
  const clips = createClips(A);
  const boat = { ...START, u: 2.5, v: 0, sog: 2.5, yawRate: 0 };
  const F = createKayakFleet({ terrain: T, seed: 1, start: START, boat: () => boat, heightAt: () => 0, hour: () => 9, wind: () => 1.5, clips });
  const it = [...F.live.values()][0], a = it.a; it.R.kind = 'swim';
  const cam = () => ({ x: a.x + 8, z: a.z, fwdX: -1, fwdZ: 0, hHalf: 0.6 });
  a.x = boat.x + Math.sin(boat.heading) * 7; a.z = boat.z - Math.cos(boat.heading) * 7; a.heading = boat.heading + Math.PI / 2; a.v = 0; a.restLeft = 30;
  let sawSwim = false, sawPad = false, sawInverted = false;
  for (let i = 0; i < 60 * 14; i++) {
    boat.x += Math.sin(boat.heading) * boat.u / 60; boat.z -= Math.cos(boat.heading) * boat.u / 60;
    F.step(1 / 60, cam());
    const r = [...F.draws.full, ...F.draws.mid].find((q) => q.id === it.slot.id); if (!r) continue;
    if (it.R.mode === 'shake') {
      assert.ok(r.cut != null, 'a capsize cuts at the world\'s water');
      if (r.fig) { sawSwim = true; assert.ok(Math.abs(r.fig[7] - (0.06 - ROLL.yc * 0)) < 1.2, 'the swimmer at the water'); }
      if (Math.abs(Math.abs(r.roll) - Math.PI) < 0.3) { sawInverted = true; assert.ok(r.y > 0, `the hull upside down rides keel up (origin ${r.y.toFixed(2)} m)`); }
    }
    if (r.pad && r.pad.k > 0.9) { sawPad = true; assert.ok(Math.hypot(r.pad.x - a.x, r.pad.z - a.z) < 2, 'the paddle floats near (its leash)'); }
  }
  assert.ok(sawSwim && sawPad && sawInverted);
});

test('the swimmer\'s pose: arms out to the sides, the wave raises the right hand over the head; the rigid rows invert and blend', async () => {
  const A = await parseKayakAsset(readFileSync(new URL('../assets/kayak/kayak.kyb.gz', import.meta.url)));
  const C = createClips(A), bi = (n) => A.json.bones.indexOf(n), f = A.json.figures.male;
  const at = (out, n) => { const s = bi(n), p = f.joints[s], o = s * 12; return [0, 1, 2].map((k) => out[o + k * 4] * p[0] + out[o + k * 4 + 1] * p[1] + out[o + k * 4 + 2] * p[2] + out[o + k * 4 + 3]); };
  const rest = C.pose('male', { rest: 1 }, 0), out = C.pose('male', { rest: 1 }, 0, undefined, { arms: 1 }), wave = C.pose('male', { rest: 1 }, 0, undefined, { wave: 1, wavePh: 0 });
  assert.ok(Math.abs(at(out, 'hand_l')[0]) > Math.abs(at(rest, 'hand_l')[0]) + 0.12 && Math.abs(at(out, 'hand_r')[0]) > Math.abs(at(rest, 'hand_r')[0]) + 0.12, 'the hands out to the sides');
  assert.ok(at(out, 'hand_l')[1] < at(rest, 'neck_01')[1], 'low, at the water');
  assert.ok(at(wave, 'hand_r')[1] > at(wave, 'Head')[1], 'the waving hand over the head');
  assert.deepEqual(at(wave, 'hand_l').map((v) => +v.toFixed(4)), at(rest, 'hand_l').map((v) => +v.toFixed(4)), 'the other hand stays');
  const m = new Float32Array([0, -1, 0, 3, 1, 0, 0, -2, 0, 0, 1, 5]), inv = invRigid(m, new Float32Array(12)), id = mulRows(m, inv, new Float32Array(12));
  [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0].forEach((v, k) => assert.ok(Math.abs(id[k] - v) < 1e-6));
  const I = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  assert.deepEqual(Array.from(blendRows(I, m, 1, new Float32Array(12))), Array.from(m));
  const half = blendRows(I, m, 0.5, new Float32Array(12));
  assert.ok(Math.abs(half[3] - 1.5) < 1e-6 && Math.abs(Math.hypot(half[0], half[4], half[8]) - 1) < 1e-5, 'halfway: half the move, still rigid');
  assert.ok(splashGain(2) > splashGain(25) && splashGain(25) > splashGain(150) && splashGain(0) <= 1);
});
