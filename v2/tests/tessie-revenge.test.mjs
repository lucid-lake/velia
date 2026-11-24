// TK, Tessie's revenge (owner, 2026-11-17: "charge her once and she takes revenge; she tries to knock you down;
// you can try to escape; fail and you're knocked down"). Behaviour only: her sim, the revenge, the boat's physics, the end card's
// model and the stage director are called and their state read.
//   the trigger's three thresholds (15°, 2 m/s, 40 m); never in Regatta or Cruise, in a race, or on a phone (no Tessie there)
//   the chase: 11 kn at most, an animal's turn, from astern or abeam, the MUST line; never longer than 30 s
//   escape by distance and by leaving her water ("That was close." once); a boat that kept its distance is never chased
//   fail: the strike under the lee side rolls the real boat past 55° (the knockdown), cause 'tessie': "Tessie said no." / "Give her room."
//   the stage holds every other act during the chase; reduced motion turns the gloom off (the drone stays)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createRevenge, REVENGE } from '../sim/tessieRevenge.js';
import { createBoatSim, waterFor, START, KN } from '../sim/boat.js';
import { endCardModel } from '../ui/endCard.js';
import { createStageDirector } from '../stage/director.js';
import { ACTS } from '../stage/acts.js';
import { makeHandle } from '../stage/handle.js';
import { start as tessieStart } from '../stage/act-tessie.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { NOTES } from '../../src/ui/skipper.js';

const DEG = Math.PI / 180, DT = 1 / 30;
const deep = () => 40;
const view = (b) => ({ x: b.x - Math.sin(b.heading) * 32, z: b.z + Math.cos(b.heading) * 32, yaw: b.heading, hHalf: 0.6 });

// her up and swimming straight (a bare sighting, not hunting), 7 s in: the humps and her back at the surface
function upTessie({ seed = 1, depthAt = deep, x = 0, z = -200, heading = Math.PI / 2 } = {}) {
  const t = createTessie({ seed, depthAt });
  const far = { x: 0, z: 300, heading: 0, speed: 0 };
  t.step(DT, { playing: true, boat: far, view: view(far) });
  t.ambush(x, z, heading, TESSIE.U); t.hunt(false);
  for (let k = 0; k < 7 / DT; k++) t.step(DT, { playing: true, boat: far, view: view(far) });
  return t;
}
// a boat abeam her middle, D m off, heading `off` rad away from her centre, at u m/s: the revenge's one step reads the charge
function charge({ D = 35, offDeg = 0, u = 3, mode = 'sail', race = false } = {}) {
  const t = upTessie(), R = createRevenge({ sim: t, depthAt: deep, mode: () => mode });
  const c = t.state.centre, psi = t.state.nose.psi;
  const bx = c[0] + Math.cos(psi) * D, bz = c[1] + Math.sin(psi) * D;
  const toHer = Math.atan2(c[0] - bx, -(c[1] - bz));
  const b = { x: bx, z: bz, heading: toHer + offDeg * DEG, speed: u, heel: -0.1 };
  t.step(DT, { playing: true, boat: b, view: view(b) });
  R.step(DT, { boat: b, playing: true, race });
  return { t, R, b };
}

test('the trigger: one charge (heading within 15° of her, closing over 2 m/s, inside 40 m) and nothing short of it', () => {
  assert.equal(charge({}).R.state.phase, 'dive', 'a charge: she dives at once');
  assert.equal(charge({}).R.events[0].type, 'trigger');
  assert.equal(charge({ offDeg: 12 }).R.state.phase, 'dive', '12° off her bearing');
  assert.equal(charge({ offDeg: 18 }).R.state.phase, 'idle', '18° off: no charge');
  assert.equal(charge({ offDeg: -18 }).R.state.phase, 'idle', '18° the other way');
  assert.equal(charge({ u: 2.3 }).R.state.phase, 'dive', 'closing at 2.3 m/s');
  assert.equal(charge({ u: 1.7 }).R.state.phase, 'idle', 'closing at 1.7 m/s: no charge');
  assert.equal(charge({ u: 2.3, offDeg: 10 }).R.state.phase, 'dive', '2.3 m/s at 10°: 2.27 m/s toward her');
  assert.equal(charge({ u: 2.02, offDeg: 10 }).R.state.phase, 'idle', '2.02 m/s at 10°: 1.99 m/s toward her, under 2');
  assert.equal(charge({ D: 37 }).R.state.phase, 'dive', '37 m off');
  assert.equal(charge({ D: 44 }).R.state.phase, 'idle', '44 m off: outside 40 m');
});

test('the trigger is off in Regatta, in Cruise and in a race; a phone never has her (feature tessie off)', () => {
  assert.equal(charge({ mode: 'regatta' }).R.state.phase, 'idle');
  assert.equal(charge({ mode: 'cruise' }).R.state.phase, 'idle');
  assert.equal(charge({ race: true }).R.state.phase, 'idle');
  const on = (dev) => { const win = { ...DEVICES[dev], location: { search: '' } }; const pr = { get: () => profileOf(readFacts(win), {}, { gpu: 1 }), on: () => {} }; return createFeatures({ profile: pr, doc: null }).configure({ headless: false, flags: {} }).feature('tessie').on; };
  assert.equal(on('desktop'), true);
  for (const d of ['iphoneTurned', 'androidSideways']) assert.equal(on(d), false, `${d}: no Tessie, so no revenge`);
});

// GOOD: a good sailor's getaway on screen, 6 kn on the log at Sail's 2 x sim clock (GAME_SPEED), 6.2 m/s, faster than her 11 kn (5.7 m/s)
const GOOD = 6 * 2 * 1852 / 3600;

// the whole revenge on a scripted boat: it charges her at 4.5 m/s from 50 m abeam, then sails on at `after` m/s (turning by `turn`
// rad/s once she comes); stats of her nose while she chases
function revengeRun({ after = 3, turn = 0, area = null, depthAt = deep, reduced = false, secs = 70, boat0 = null } = {}) {
  const t = upTessie({ depthAt }), R = createRevenge({ sim: t, area: typeof area === 'function' ? area(t.state.centre) : area, depthAt, reduced: () => reduced });
  const c = t.state.centre, psi = t.state.nose.psi;
  const b = boat0 ?? { x: c[0] + Math.cos(psi) * 50, z: c[1] + Math.sin(psi) * 50, heading: 0, speed: 4.5, heel: -0.15 };
  const S = { log: [], maxV: 0, maxTurn: 0, from: null, chaseS: 0, gloomMax: 0, droneMax: 0, clips: new Set(), minChaseStartM: Infinity };
  let prev = null, prevPsi = null;
  for (let k = 0; k < secs / DT; k++) {
    if (!R.state.count) { const cc = t.state.centre; b.heading = Math.atan2(cc[0] - b.x, -(cc[1] - b.z)); b.speed = 4.5; }
    else { b.speed = after; if (R.state.phase === 'chase') b.heading += turn * DT; }
    b.x += Math.sin(b.heading) * b.speed * DT; b.z -= Math.cos(b.heading) * b.speed * DT;
    t.step(DT, { playing: true, boat: { ...b }, view: view(b) });
    R.step(DT, { boat: { ...b }, playing: true });
    for (const e of R.events) S.log.push({ T: k * DT, ...e, dist: R.state.dist, chaseT: R.state.chaseT });
    if (R.state.phase === 'chase') {
      S.chaseS += DT;
      for (const cl of t.state.clips) S.clips.add(cl);
      const n = t.state.nose;
      if (prev && R.state.chaseT > 0.2) {
        const v = Math.hypot(n.x - prev[0], n.z - prev[1]) / DT; S.maxV = Math.max(S.maxV, v);
        const p = Math.atan2(n.x - prev[0], -(n.z - prev[1]));
        if (prevPsi != null && v > 0.5) { const d = Math.atan2(Math.sin(p - prevPsi), Math.cos(p - prevPsi)); S.maxTurn = Math.max(S.maxTurn, Math.abs(d) / DT / DEG); }
        prevPsi = p;
      }
      prev = [n.x, n.z];
    }
    S.gloomMax = Math.max(S.gloomMax, R.state.gloom); S.droneMax = Math.max(S.droneMax, R.state.drone);
    if (R.state.phase === 'done' && !t.state.visible) break;
  }
  return { t, R, b, S, ev: (type) => S.log.find((e) => e.type === type) };
}

test('the chase: she comes from astern or abeam, at 11 kn at most, turning as an animal; the MUST line; never over 30 s', () => {
  const { S, ev } = revengeRun({ after: 3, turn: 0.25 });
  const c = ev('chase');
  assert.ok(c, 'she comes back');
  assert.equal(c.line, 'She’s coming back. Sail!');
  assert.ok(Math.abs(c.from) >= 90, `from ${c.from}° off the bow (astern or abeam)`);
  assert.ok(ev('quiet').T - ev('trigger').T <= REVENGE.diveMaxS + 0.05, 'the dive: at most 3.5 s');
  assert.ok(Math.abs(c.T - ev('quiet').T - REVENGE.quietS) < 0.05, 'then 2 s of quiet');
  assert.ok(S.maxV <= REVENGE.chaseMs * 1.2 + 0.3 && S.maxV <= TESSIE.speedMax + 0.3, `her nose at most ${S.maxV.toFixed(2)} m/s (11 kn = ${REVENGE.chaseMs.toFixed(2)})`);
  assert.ok(S.maxTurn <= TESSIE.turnMax * 1.6 + 5, `her turn at most ${S.maxTurn.toFixed(1)} °/s`);
  assert.ok(!S.clips.has('breach'), 'no breach (no jump-scare)');
  assert.ok(S.chaseS <= REVENGE.chaseMaxS + 0.1, `the chase ran ${S.chaseS.toFixed(1)} s`);
  // the MUST line is the skipper's spoken note
  assert.equal(NOTES.tessieChase.text, c.line); assert.equal(NOTES.tessieChase.speak, c.line);
});

test('escape by distance: sailing fast keeps her past 25 m; she gives up with a tail slap, "That was close." once a session', () => {
  const { R, t, ev, S } = revengeRun({ after: GOOD });
  const e = ev('escape');
  assert.ok(e, 'escaped'); assert.equal(e.why, 'distance'); assert.equal(R.state.result, 'escape');
  assert.equal(e.line, 'That was close.'); assert.equal(NOTES.tessieClose.text, e.line);
  assert.ok(e.dist > REVENGE.escapeM, `she was ${e.dist} m off`);
  assert.ok(S.log.every((x) => x.type !== 'strike'));
  assert.ok(t.sightings.at(-1).minBoatM > REVENGE.catchM, 'she never reached the boat');
  // the drone fades after
  assert.ok(R.state.drone < 0.05 && R.state.gloom < 0.05, `the drone ${R.state.drone.toFixed(3)} after`);
});

test('"That was close." once a session: the second escape is silent', () => {
  const t = upTessie(), R = createRevenge({ sim: t, depthAt: deep });
  const lines = [];
  for (let round = 0; round < 2; round++) {
    // a fresh sighting each round, a charge, then a fast getaway
    if (round) { const far = { x: 0, z: 300, heading: 0, speed: 0 }; const n = t.state.nose ?? { x: 0, z: -200 }; t.ambush(n.x + 300, n.z, Math.PI / 2); t.hunt(false); for (let k = 0; k < 7 / DT; k++) { t.step(DT, { playing: true, boat: far, view: view(far) }); R.step(DT, { boat: far, playing: true }); } }
    const c = t.state.centre, psi = t.state.nose.psi;
    const b = { x: c[0] + Math.cos(psi) * 38, z: c[1] + Math.sin(psi) * 38, heading: 0, speed: 4.5, heel: -0.1 };
    for (let k = 0; k < 60 / DT; k++) {
      if (!R.active && R.state.phase !== 'done') { const cc = t.state.centre; b.heading = Math.atan2(cc[0] - b.x, -(cc[1] - b.z)); }
      b.x += Math.sin(b.heading) * b.speed * DT; b.z -= Math.cos(b.heading) * b.speed * DT;
      t.step(DT, { playing: true, boat: { ...b }, view: view(b) }); R.step(DT, { boat: { ...b }, playing: true });
      for (const e of R.events) if (e.type === 'escape') lines.push(e.line);
      if (R.state.phase === 'done' && !t.state.visible) break;
    }
    R.reset();
  }
  assert.equal(lines.length, 2, `two escapes (${lines})`);
  assert.deepEqual(lines, ['That was close.', null]);
});

test('escape by leaving her water: out past her area and its margin, she gives up at once', () => {
  // her water: a 100 m disc south of her (the boat charges from the south, inside it, and sails on north: out past its edge + 30 m)
  const area = (c) => ({ x: c[0], z: c[1] + 100, r: 100 });
  const { ev, R } = revengeRun({ after: GOOD, area });
  const e = ev('escape');
  assert.ok(e, 'escaped'); assert.equal(e.why, 'water', `why ${e?.why}`);
  assert.ok(e.chaseT < REVENGE.chaseMaxS, `out of her water ${e.chaseT.toFixed(1)} s into the chase`);
  assert.equal(R.state.result, 'escape');
});

test('never chases a boat that kept its distance: passing her 45 m off, or sailing past her abeam, is no charge', () => {
  for (const [D, off] of [[45, 0], [30, 60], [20, 90]]) {
    const t = upTessie(), R = createRevenge({ sim: t, depthAt: deep });
    const c = t.state.centre, psi = t.state.nose.psi;
    const b = { x: c[0] + Math.cos(psi) * D, z: c[1] + Math.sin(psi) * D, heading: Math.atan2(-Math.cos(psi), -Math.sin(psi)) + off * DEG, speed: 4, heel: 0 };
    if (off) b.heading = Math.atan2(c[0] - b.x, -(c[1] - b.z)) + off * DEG;
    const D0 = D;
    for (let k = 0; k < 20 / DT; k++) {
      if (D0 === 45) { const cc = t.state.centre; const away = Math.hypot(cc[0] - b.x, cc[1] - b.z); b.speed = away > 46 ? 4 : 0.5; b.heading = Math.atan2(cc[0] - b.x, -(cc[1] - b.z)) + (away < 46 ? 90 * DEG : 0); }
      b.x += Math.sin(b.heading) * b.speed * DT; b.z -= Math.cos(b.heading) * b.speed * DT;
      t.step(DT, { playing: true, boat: { ...b }, view: view(b) }); R.step(DT, { boat: { ...b }, playing: true });
    }
    assert.equal(R.state.count, 0, `${D} m, ${off}° off: no revenge`);
  }
});

test('fail: she reaches the boat, rises under the lee side, her tail sweep rolls the real boat past 55°: the knockdown, "Tessie said no."', () => {
  // the real boat in a light breeze, nearly stopped (dithering): the revenge reads it, the strike shoves it (as living/tessie.js does)
  const wind = { sample: () => ({ vx: 0, vz: 7 * KN }) };
  const B = createBoatSim({ water: waterFor(() => 0), wind, start: { x: START.x, z: START.z, headingDeg: -80, speed: 1 }, flags: { knockdown: true } });
  const kd = [];
  B.onKnockdown = (e) => kd.push(e);
  const t = createTessie({ seed: 2, depthAt: deep });
  const R = createRevenge({ sim: t, depthAt: deep });
  // her up 36 m ahead of the boat, crossing its bow
  const s0 = B.state, fx = Math.sin(s0.heading), fz = -Math.cos(s0.heading);
  t.step(DT, { playing: true, boat: { x: s0.x, z: s0.z + 500, heading: 0, speed: 0 }, view: view({ x: s0.x, z: s0.z + 500, heading: 0 }) });
  t.ambush(s0.x + fx * 36 - fz * 20, s0.z + fz * 36 + fx * 20, s0.heading + Math.PI / 2); t.hunt(false);
  let strike = null, struckAt = null, heelMax = 0, T = 0, chaseAt = null;
  const boatOf = () => ({ x: B.state.x, z: B.state.z, heading: B.state.heading, speed: B.state.sog ?? 0, heel: B.state.heel });
  for (let k = 0; k < 70 / DT; k++) {
    T = k * DT;
    // she rises (7 s), then the "charge": the boat given 3 m/s straight at her for the one step that counts (a scripted charge)
    const pre = T < 7;
    B.step(DT, { steer: 0, pull: 0 });
    if (!pre && !R.state.count) { const h = t.state.centre; B.state.heading = Math.atan2(h[0] - B.state.x, -(h[1] - B.state.z)); }
    const bo = boatOf(); if (!pre && !R.state.count) bo.speed = 3;
    t.step(DT, { playing: true, boat: bo, view: view(bo) });
    if (!pre) R.step(DT, { boat: bo, playing: true });
    for (const e of R.events) {
      if (e.type === 'chase') chaseAt = T;
      if (e.type === 'strike') { strike = e; struckAt = T; const P = B.phys.P; B.shove({ K: e.K * P.mass * 9.81 * P.gm }); }
    }
    heelMax = Math.max(heelMax, Math.abs(B.state.heel) / DEG);
    if (struckAt != null && T > struckAt + 4) break;
  }
  assert.ok(chaseAt != null, 'she came back');
  assert.ok(strike, 'she reached the boat (a boat that dithers is caught)');
  assert.ok(struckAt - chaseAt <= REVENGE.chaseMaxS, `caught ${(struckAt - chaseAt).toFixed(1)} s into the chase`);
  assert.equal(R.state.result, 'strike');
  // the lee side: the side she heels to (B's heel < 0: to port); the sweep rolls her the same way
  assert.equal(Math.sign(strike.K), strike.lee);
  assert.ok(heelMax > 55, `heeled to ${heelMax.toFixed(1)}°`);
  assert.equal(kd.length, 1, 'one knockdown (the physics: past 55° for 0.5 s)');
  // the page tags it (main.js: the strike within 6 s) and the card reads hers
  const m = endCardModel({ cause: 'tessie', event: { ...kd[0], cause: 'tessie' }, log: { seconds: 300, metres: 800, topMs: 3 }, hour: 15 });
  assert.equal(m.title, 'Tessie said no.'); assert.equal(m.tip, 'Give her room.'); assert.equal(m.cause, 'tessie');
  // her splash and a deep breath at the strike, the tail's flick and slap after
  assert.ok(t.state.clips.includes('flick') || t.state.phase === 'dive' || !t.state.visible);
});

test('the strike\'s sound moments: her splash and a deep breath at once, the tail\'s slap after', () => {
  const { t, R, ev } = revengeRun({ after: 0.5, secs: 60 });
  assert.ok(ev('strike'), 'caught');
  assert.equal(R.state.result, 'strike');
  // replay: the moments are her sim's events on the strike's step (the plug-in hears them after the revenge's step)
  const t2 = upTessie(), R2 = createRevenge({ sim: t2, depthAt: deep });
  const c = t2.state.centre, psi = t2.state.nose.psi;
  const b = { x: c[0] + Math.cos(psi) * 38, z: c[1] + Math.sin(psi) * 38, heading: 0, speed: 4.5, heel: -0.15 };
  const heard = new Set();
  for (let k = 0; k < 70 / DT; k++) {
    if (!R2.state.count) { const cc = t2.state.centre; b.heading = Math.atan2(cc[0] - b.x, -(cc[1] - b.z)); } else b.speed = 0.5;
    b.x += Math.sin(b.heading) * b.speed * DT; b.z -= Math.cos(b.heading) * b.speed * DT;
    t2.step(DT, { playing: true, boat: { ...b }, view: view(b) });
    R2.step(DT, { boat: { ...b }, playing: true });
    if (R2.state.result === 'strike') for (const e of t2.state.events) heard.add(e.type);
    if (R2.state.phase === 'done' && !t2.state.visible) break;
  }
  for (const k of ['break', 'breath', 'slap']) assert.ok(heard.has(k), `${k} heard (${[...heard]})`);
  assert.ok(t.sightings.length >= 2);
});

test('the stage holds every other act while the revenge runs; her cooldown counts from its end', () => {
  const t = upTessie();
  const R = createRevenge({ sim: t, depthAt: deep });
  const T = { sim: t, revenge: R };
  // the director with Tessie on stage now (pinned) and the kayaks due right after; a stand-in kayak act
  const kay = { ...ACTS.find((a) => a.id === 'kayaks'), load: null, start: () => { let s = 0; return makeHandle({ step(dt, h) { s += dt; if (s > 10) h.finish('played'); } }); } };
  const tes = { ...ACTS.find((a) => a.id === 'tessie'), load: null, start: tessieStart, opening: { order: 0, atS: 0 } };
  const d = createStageDirector({ acts: [tes, { ...kay, opening: { order: 1, atS: 1, gapAfterS: 0 } }], seed: 1, ctx: { tessie: T }, busy: () => (R.active ? 'tessie' : null) });
  // the director cues her (a sighting is placed by the sim): here she is already up, so cue() refuses; a new one is placed at once
  d.step(DT, { playing: true });
  const c = t.state.centre, psi = t.state.nose?.psi ?? 0;
  const b = { x: c[0] + Math.cos(psi) * 38, z: c[1] + Math.sin(psi) * 38, heading: 0, speed: 4.5, heel: -0.1 };
  let duringOthers = 0, active = null, revengeT = 0;
  for (let k = 0; k < 120 / DT; k++) {
    if (!R.state.count) { const cc = t.state.visible ? t.state.centre : c; b.heading = Math.atan2(cc[0] - b.x, -(cc[1] - b.z)); } else b.speed = GOOD;
    b.x += Math.sin(b.heading) * b.speed * DT; b.z -= Math.cos(b.heading) * b.speed * DT;
    d.step(DT, { playing: true });
    t.step(DT, { playing: true, boat: { ...b }, view: view(b) }); R.step(DT, { boat: { ...b }, playing: true });
    if (R.active) { revengeT += DT; if (d.state.active && d.state.active !== 'tessie') duringOthers++; if (d.state.active === 'tessie') active = 'tessie'; }
  }
  assert.ok(R.state.count === 1 && revengeT > 10, `a revenge ran ${revengeT.toFixed(1)} s`);
  assert.equal(active, 'tessie', 'her act was on stage through it');
  assert.equal(duringOthers, 0, 'no other act during the revenge');
  const tEnd = d.timeline.find((e) => e.id === 'tessie' && e.ev === 'end');
  assert.match(tEnd.why, /^revenge: escape/);
  const kStart = d.timeline.find((e) => e.id === 'kayaks' && e.ev === 'start');
  assert.ok(!kStart || kStart.t >= tEnd.t, `the kayaks after her act (${kStart?.t} ≥ ${tEnd.t})`);
});

test('reduced motion turns the gloom off; the drone and the dip still rise', () => {
  const a = revengeRun({ after: GOOD }), b = revengeRun({ after: GOOD, reduced: true });
  assert.ok(a.S.gloomMax > 0.9, `gloom ${a.S.gloomMax.toFixed(2)}`);
  assert.equal(b.S.gloomMax, 0);
  assert.ok(b.S.droneMax > 0.9, `drone ${b.S.droneMax.toFixed(2)}`);
});

test('a mode change mid-chase cancels it: she dives, the drone fades', () => {
  const t = upTessie();
  let mode = 'sail';
  const R = createRevenge({ sim: t, depthAt: deep, mode: () => mode });
  const c = t.state.centre, psi = t.state.nose.psi;
  const b = { x: c[0] + Math.cos(psi) * 38, z: c[1] + Math.sin(psi) * 38, heading: 0, speed: 4.5, heel: -0.1 };
  for (let k = 0; k < 40 / DT; k++) {
    if (!R.state.count) { const cc = t.state.centre; b.heading = Math.atan2(cc[0] - b.x, -(cc[1] - b.z)); }
    if (R.state.phase === 'chase' && R.state.chaseT > 3) mode = 'cruise';
    b.x += Math.sin(b.heading) * b.speed * DT; b.z -= Math.cos(b.heading) * b.speed * DT;
    t.step(DT, { playing: true, boat: { ...b }, view: view(b) }); R.step(DT, { boat: { ...b }, playing: true });
  }
  assert.equal(R.state.result, 'cancel'); assert.equal(R.state.why, 'cruise');
  assert.ok(R.state.drone < 0.01);
});

test('11 kn (owner 2026-11-18): she catches a dithering beginner at 3 kn on the log, not a good sailor at 6 kn', () => {
  const slow = revengeRun({ after: 3 * 2 * 1852 / 3600 }), good = revengeRun({ after: GOOD });
  assert.ok(slow.S.log.some((e) => e.type === 'strike'), `the beginner caught (${slow.S.log.map((e) => e.type).join(', ')})`);
  assert.ok(good.S.log.every((e) => e.type !== 'strike') && good.ev('escape'), 'the good sailor escapes');
});
