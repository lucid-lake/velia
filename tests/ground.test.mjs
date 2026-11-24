// The bottom (feat/grounding): the keel and the hull meet the real terrain; the sounder's alarm; the
// shallow-water assist; Cruise never grounds. Headless physics on the real terrain (tests/helpers/ground-sim.mjs); no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain } from '../src/sim/terrain.js';
import { shorePoints, pick, approach, depthAt, rockAt, DEG } from './helpers/ground-sim.mjs';
import { createGround, predict, GROUND } from '../src/sim/boat/ground.js';
import { groundTerrain } from '../src/sim/boat/groundTerrain.js';
import { ShoalAssist, ASSIST } from '../src/sim/boat/shoalAssist.js';
import { Sounder, SOUNDER, GroundTalk } from '../src/sim/boat/sounder.js';
import { BoatPhysics, CONTROLS, Helm, DT, KN } from '../src/sim/boat.js';
import { SETTINGS } from '../src/ui/settings.js';
import { NOTES } from '../src/ui/skipper.js';

import { sp, SETS, ANGLES, SPEEDS, runs, tag, assistCase, cruiseGroundCase } from './helpers/cases-ground.mjs';

test('the scenarios exist: beaches, rocks and the island, each with a clear approach', () => {
  assert.ok(sp.beach.length >= 3 && sp.rock.length >= 2 && sp.island.length >= 3, JSON.stringify(Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, v.length]))));
  assert.ok(runs({ assist: false }).length >= 80, 'at least 80 approaches');
});

test('without the assist: the boat runs aground, stops, and never passes into the terrain (hull ≥ −0.05 m, keel on rock ≥ −0.05 m, a keel plows sand ≤ 0.41 m)', () => {
  let grounded = 0, n = 0;
  for (const x of runs({ assist: false })) {
    n++;
    assert.ok(x.r.minHull >= -0.05, `${tag(x)}: hull clearance ${x.r.minHull.toFixed(3)} m`);
    assert.ok(x.r.maxKeelPen <= 0.41, `${tag(x)}: keel ${x.r.maxKeelPen.toFixed(3)} m into the bed`);
    if (x.k === 'island') assert.ok(x.r.minKeel >= -0.05, `${tag(x)}: keel on rock ${x.r.minKeel.toFixed(3)} m`);
    assert.ok(x.r.maxHeel < 35 * DEG, `${tag(x)}: heel ${(x.r.maxHeel / DEG).toFixed(0)}°`);
    assert.ok(Math.abs(x.r.state.heel) < 60 * DEG && Number.isFinite(x.r.state.x), `${tag(x)}: state sane`);
    if (x.r.grounded) grounded++;
  }
  assert.ok(grounded >= n * 0.5, `${grounded} of ${n} grounded: the shore is a hard stop`);
});

test('head on, at 3, 6 and 8 kn: a sharp deceleration to a stop within a believable distance (≤ 4 m at 3 kn, ≤ 6 m at 8 kn; a long shoal ≤ 20 m), then aground', () => {
  for (const k of ['beach', 'rock', 'island']) for (const T of SETS[k]) for (const kn of SPEEDS) {
    const r = approach({ target: T, angleDeg: 0, kn, assist: false });
    if (!r) continue;
    const id = `${k} ${T.x | 0},${T.z | 0} ${kn} kn`;
    assert.ok(r.firstTouchT != null, `${id}: touched`);
    const gentle = T.slope < 0.2;   // a long shoal (1 in 7): the keel plows a long way before the bed is deep enough to hold her
    assert.ok(r.stopDist != null && r.stopDist <= (gentle ? 20 : kn <= 3 ? 4 : 6), `${id}: stopped in ${r.stopDist?.toFixed(1)} m`);
    assert.ok(gentle || k === 'rock' || r.stopT - r.firstTouchT <= 8, `${id}: stopped within ${(r.stopT - r.firstTouchT).toFixed(1)} s`);
    // a steep rock wall throws her back (restitution 0.3) and she may come off; a beach and the island hold her
    if (k !== 'rock') { assert.equal(r.final.mode, 'aground', `${id}: ${r.final.mode}`); assert.ok(r.events.some((e) => e.type === 'aground'), `${id}: the grounding is logged`); }
    assert.ok(r.events.some((e) => e.type === 'touch'), `${id}: the touch is logged`);
  }
});

test('the keel catching yaws and heels the boat (an oblique approach)', () => {
  let yawed = 0, n = 0;
  for (const T of SETS.beach) for (const a of [-35, 35]) {
    const r = approach({ target: T, angleDeg: a, kn: 6, assist: false });
    if (!r) continue;
    n++;
    const dh = Math.abs(Math.atan2(Math.sin(r.state.heading - r.heading), Math.cos(r.state.heading - r.heading)));
    if (dh > 8 * DEG && r.maxHeel > 4 * DEG) yawed++;
  }
  assert.ok(n >= 3 && yawed >= n * 0.5, `${yawed} of ${n} turned over 8° and heeled over 4°`);
});

test('rock is harder than sand: a thud at the touch, a rock thud on the island, a sand one on the beach', () => {
  const rock = approach({ target: SETS.island[0], angleDeg: 0, kn: 6, assist: false }), sand = approach({ target: SETS.beach[1], angleDeg: 0, kn: 6, assist: false });
  const tr = rock.events.find((e) => e.type === 'thud'), ts = sand.events.find((e) => e.type === 'thud');
  assert.ok(tr && tr.mat === 'rock', `island thud ${JSON.stringify(tr)}`);
  assert.ok(ts && ts.mat === 'sand', `beach thud ${JSON.stringify(ts)}`);
  assert.ok(rock.final.mat === 'rock' && sand.final.mat === 'sand');
  // the rock stops her inside the beach's plow
  assert.ok(rock.stopDist <= sand.stopDist + 1.5, `rock ${rock.stopDist.toFixed(1)} m, sand ${sand.stopDist.toFixed(1)} m`);
  // the sand's plow is visible, the rock's is not
  assert.ok(sand.maxKeelPen > 0.15 && rock.maxKeelPen <= 0.05, `plow ${sand.maxKeelPen.toFixed(2)} m on sand, ${rock.maxKeelPen.toFixed(2)} m on rock`);
});

test('the tow held on (a runaway boat pinned to the shore): still never into the terrain, state finite', () => {
  for (const [k, i, kn] of [['beach', 1, 8], ['island', 0, 8], ['rock', 1, 8], ['beach', 2, 6]]) {
    const r = approach({ target: SETS[k][i], angleDeg: 0, kn, assist: false, towMode: 'hold', seconds: 120 });
    if (!r) continue;
    assert.ok(r.minHull >= -0.05, `${k}: hull ${r.minHull.toFixed(3)}`);
    assert.ok(r.maxKeelPen <= 0.41, `${k}: keel ${r.maxKeelPen.toFixed(3)}`);
    assert.ok(Number.isFinite(r.state.x) && Number.isFinite(r.state.heading) && Math.abs(r.state.heel) < 60 * DEG, `${k}: finite, upright`);
  }
});

// the assist on the beam (tests/helpers/cases-ground.mjs); astern and ahead run in the slow lane (tests/slow/ground.slow.mjs)
assistCase([90]);

// the assist on a beam breeze on the other tack (about 6 s) runs in the slow lane: tests/slow/ground.slow.mjs

test('the assist says why (rocks at the island, shoal at the beach), once, and the player steering stands it down', () => {
  const isl = approach({ target: SETS.island[0], angleDeg: 0, kn: 6, assist: true }), bch = approach({ target: SETS.beach[1], angleDeg: 0, kn: 6, assist: true });
  assert.equal(isl.assistEvents.find((e) => e.ev === 'engage')?.reason, 'rocks');
  assert.equal(bch.assistEvents.find((e) => e.ev === 'engage')?.reason, 'shoal');
  // steering: the assist is off while the player steers, then waits graceS
  const as = new ShoalAssist({ depthAt, predict: (d, s, o) => predict(d, s, { ...o, rockAt }) });
  const T = SETS.beach[1], base = Math.atan2(-T.n[0], T.n[1]), st = { x: T.x - Math.sin(base) * 40, z: T.z + Math.cos(base) * 40, heading: base, u: 3, v: 0, yawRate: 0, heel: 0, cog: base };
  let engagedAt = null;
  for (let i = 0; i < 20; i++) { const o = as.update(st, 0.2, { enabled: true, steering: false, windFrom: base + Math.PI }); if (o.engaged) { engagedAt = i; break; } }
  assert.ok(engagedAt != null, 'engages 40 m off the shore at 6 kn');
  const o2 = as.update(st, 0.2, { enabled: true, steering: true, windFrom: base + Math.PI });
  assert.equal(o2.engaged, false); assert.equal(o2.event, 'release');
  const o3 = as.update(st, 0.3, { enabled: true, steering: false, windFrom: base + Math.PI });
  assert.equal(o3.engaged, false, 'a grace after the hands leave the helm');
  const o4 = new ShoalAssist({ depthAt, predict }).update(st, 1, { enabled: false, steering: false, windFrom: 0 });
  assert.equal(o4.engaged, false, 'off: never');
  assert.equal(SETTINGS.shoalAssist, true, 'on by default');
});

test('the lookahead: hits the shore within 8 s ahead of the boat; nothing in the open bay; the same depth the chart reads', () => {
  const T = SETS.beach[1], base = Math.atan2(-T.n[0], T.n[1]);
  const near = { x: T.x - Math.sin(base) * 25, z: T.z + Math.cos(base) * 25, heading: base, u: 3, v: 0, cog: base };
  const r = predict(depthAt, near, { horizonS: 12 });
  assert.ok(r.tHit != null && r.tHit < 12, `hit in ${r.tHit}`);
  const bay = { x: 1200, z: -1050, heading: 251 * DEG, u: 2.75, v: 0, cog: 251 * DEG };
  assert.equal(predict(depthAt, bay, { horizonS: 8 }).tHit, null);
  const terrain = makeTerrain({ seed: 1 }), gt = groundTerrain(terrain);
  for (const [x, z] of [[1200, -1050], [400, -500], [-158, -316], [0, 0]]) assert.equal(gt.depthAt(x, z), -terrain.heightAt(x, z));
});

test('the sounder: amber under 3 m below the keel with soft beeps, red under 1 m; hysteresis; silent at anchor, aground and under 0.5 m/s; no false alarm in the open bay', () => {
  const so = new Sounder();
  let t = 0, beeps = [];
  const feed = (under, o = {}) => { t += 0.1; const r = so.update(0.1, { under, depth: under + 1.6, sog: 2, ...o }, t); if (r.beep) beeps.push(r.beep); return r; };
  for (let i = 0; i < 50; i++) assert.equal(feed(8).level, 0);
  assert.equal(beeps.length, 0, 'no beep in deep water');
  assert.equal(feed(2.9).level, 1); assert.equal(feed(3.1).level, 1, 'hysteresis: held until 3.3 m'); assert.equal(feed(3.4).level, 0);
  beeps = []; for (let i = 0; i < 200; i++) feed(2.0);
  assert.ok(beeps.length >= 3 && beeps.length <= SOUNDER.amberBeeps && beeps.every((b) => b === 'amber'), `amber beeps ${beeps.length}`);
  beeps = []; for (let i = 0; i < 50; i++) feed(0.5);
  assert.ok(beeps.length >= 6 && beeps.every((b) => b === 'red'), `red beeps ${beeps.length} in 5 s`);
  beeps = []; for (let i = 0; i < 100; i++) feed(0.5, { held: true }); for (let i = 0; i < 100; i++) feed(0.5, { mode: 'aground' }); for (let i = 0; i < 100; i++) feed(0.5, { sog: 0.2 });
  assert.equal(beeps.length, 0, 'quiet at anchor, aground, drifting');
  // on the real approach to the beach: amber, then red, before the keel touches
  const bch = approach({ target: SETS.beach[1], angleDeg: 0, kn: 6, assist: false });
  const so2 = new Sounder(); let firstAmber = null, firstRed = null, tt = 0;
  for (const [x, z, v, under] of bch.track) { tt += 0.5; const r = so2.update(0.5, { under, depth: under + 1.6, sog: v }, tt); if (r.level >= 1 && firstAmber == null) firstAmber = tt; if (r.level === 2 && firstRed == null) firstRed = tt; }
  assert.ok(firstAmber != null && firstRed != null && firstAmber < firstRed, `amber ${firstAmber} s, red ${firstRed} s`);
  assert.ok(bch.firstTouchT - firstAmber >= 3 && bch.firstTouchT - firstRed >= 0, `amber ${(bch.firstTouchT - firstAmber).toFixed(1)} s before the touch, red ${(bch.firstTouchT - firstRed).toFixed(1)} s`);
});

test('R.\'s words: each warning once, never over another within 6 s; the assist\'s own line says "bearing away"', () => {
  const g = new GroundTalk();
  assert.equal(g.warn(10, { reason: 'shoal' }), 'shoal');
  assert.equal(g.warn(12, { reason: 'rocks' }), null, 'not within 6 s of another line');
  assert.equal(g.warn(20, { reason: 'rocks' }), 'rocks');
  assert.equal(g.warn(30, { reason: 'rocks' }), null, 'the same line waits');
  assert.equal(g.warn(80, { reason: 'rocks', engaged: true }), 'rocksAuto');
  for (const id of ['shoal', 'rocks', 'shore', 'shoalAuto', 'rocksAuto', 'shoreAuto', 'aground', 'floating', 'kedge']) assert.ok(NOTES[id], id);
  assert.match(NOTES.rocksAuto.text, /bearing away/); assert.match(NOTES.shoal.text, /Shoaling/); assert.match(NOTES.rocks.text, /Rocks ahead/);
});

test('getting off: reverse the engine (sand, rock), or kedge; a grounded boat refloats and the log says so', () => {
  let n = 0, off = 0;
  for (const k of ['beach', 'rock', 'island']) for (const T of SETS[k]) for (const kn of [3, 6]) {
    const r = approach({ target: T, angleDeg: 0, kn, assist: false, reverseAfterS: 4, seconds: 330 });
    if (!r || !r.grounded) continue;
    n++; if (r.refloat) off++;
  }
  assert.ok(n >= 12 && off >= n * 0.8, `${off} of ${n} backed off with the engine`);
  // the rest by kedging: the beach the engine cannot back off (the wind and sails press her on)
  const r = approach({ target: SETS.beach[0], angleDeg: 0, kn: 6, assist: false, kedgeAfterS: 4, seconds: 200 });
  assert.ok(r.grounded && r.kedge?.ok && r.refloat, `kedge ${JSON.stringify(r.kedge)} refloat ${r.refloat}`);
  const ev = r.events.map((e) => e.type);
  assert.ok(ev.indexOf('aground') >= 0 && ev.indexOf('refloat') > ev.indexOf('aground'), ev.join());
  // afloat: no kedge
  const g = createGround({ depthAt });
  assert.equal(g.kedge({ x: 0, z: 0 }).ok, false);
});

// Cruise on the bottom, seed 1 (tests/helpers/cases-ground.mjs); seeds 2 and 3 in the slow lane
cruiseGroundCase(1);

test('no false alarms or touches in the open bay: the opening minutes of Sail on the pilot, the bottom live', () => {
  const ground = createGround({ depthAt, rockAt }), so = new Sounder(), as = new ShoalAssist({ depthAt, predict: (d, s, o) => predict(d, s, { ...o, rockAt }) });
  const phys = new BoatPhysics({ x: 1200, z: -1050, heading: 251 * DEG, speed: 2.75 }), helm = new Helm(), ctl = { ...CONTROLS };
  const windFrom = 196 * DEG, wv = 4.6;
  const env = { t: 0, windAt: () => ({ vx: -Math.sin(windFrom) * wv, vz: Math.cos(windFrom) * wv }), ext: ground.ext, post: ground.post };
  let level = 0, warns = 0, engages = 0;
  for (let i = 0; i < 60 * 150; i++) {
    env.t = i * DT;
    const s = phys.state, o = as.update(s, DT, { enabled: true, steering: false, windFrom });
    if (o.warn) warns++; if (o.event === 'engage') engages++;
    ctl.rudder = helm.toHeading(s, o.engaged ? o.heading : 251 * DEG, DT);
    phys.step(DT, ctl, env);
    level = Math.max(level, so.update(DT, { under: ground.state.under, depth: ground.state.depth, sog: s.sog }, i * DT).level);
  }
  assert.equal(level, 0, 'no alarm'); assert.equal(engages, 0, 'no assist'); assert.equal(warns, 0, 'no warning');
  assert.equal(ground.state.mode, 'afloat'); assert.ok(ground.state.minKeelClear > 3);
  // the physics is untouched by the bottom's hooks while afloat
  const b0 = new BoatPhysics({ x: 1200, z: -1050, heading: 251 * DEG, speed: 2.75 }), b1 = new BoatPhysics({ x: 1200, z: -1050, heading: 251 * DEG, speed: 2.75 });
  const g2 = createGround({ depthAt, rockAt }), e0 = { t: 0, windAt: env.windAt }, e1 = { t: 0, windAt: env.windAt, ext: g2.ext, post: g2.post };
  for (let i = 0; i < 600; i++) { e0.t = e1.t = i * DT; b0.step(DT, ctl, e0); b1.step(DT, ctl, e1); }
  assert.equal(b0.state.x, b1.state.x); assert.equal(b0.state.u, b1.state.u); assert.equal(b0.state.heel, b1.state.heel);
});

test('the numbers the notes quote', () => {
  assert.ok(Math.abs(GROUND.keel[0].d - 1.6) < 0.01); assert.equal(GROUND.plowMax, 0.4); assert.equal(GROUND.hardMax, 0.04);
  assert.equal(ASSIST.engageS, 7); assert.equal(SOUNDER.amberM, 3);
});
