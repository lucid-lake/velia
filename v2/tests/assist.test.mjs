// The one assist key (v2/ui/assist.js; owner, 2026-11-16): its word by the boat's state (TACK, GYBE, FREE, REFLOAT, dim); FREE gets an
// irons boat out within 15 s on v2's boat (both tacks, light and fresh wind); astern the helm steers the reversed way; REFLOAT kedges;
// a hand on the helm or a second press cancels; with AUTO holding, the pilot holds the new heading after FREE; a beginner's auto-FREE
// once per 3 min and only for beginners; the soft brighten once per appearance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { assistState, stuckNow, FreeAssist, createAssist, ASSIST, AUTO_FREE, CUE, FREE, LINES, WORDS } from '../ui/assist.js';
import { createPilot } from '../ui/autopilot.js';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';

const DEG = Math.PI / 180;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });
const st = (twaDeg, kn, o = {}) => ({ trueWind: { angle: twaDeg * DEG, speed: 5 }, sog: kn * KN, u: o.u ?? kn * KN, furl: o.furl ?? 0 });
// a boat in irons: heading `off`° off a wind from 200°, stopped, settled `s` seconds with no hands (the pilot can do nothing at 0 kn)
function ironsBoat(ms, off, s = 6) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(ms, 200), start: { x: 0, z: 0, headingDeg: 200 - off, speed: 0 } });
  for (let i = 0; i < 60 * s; i++) B.step(1 / 60, { steer: 0, pull: 0 }, 1 / 60);
  return B;
}
const frame = (B, A, o = {}) => { A.update(1 / 60, o); B.station({ free: A.hands }); B.step(1 / 60, { steer: o.steer ?? 0, pull: 0 }, 1 / 60); };

test('the decision table: TACK upwind with way on, GYBE downwind, FREE in irons or drifting astern, REFLOAT aground, dim on a reach, stopped, anchored, sails down; lit only while one runs', () => {
  assert.deepEqual(assistState(st(40, 4)), { word: 'TACK', kind: 'tack', lit: false, dim: false });
  assert.deepEqual(assistState(st(-150, 4)), { word: 'GYBE', kind: 'gybe', lit: false, dim: false });
  assert.deepEqual(assistState(st(100, 4)), { word: 'TACK', kind: null, lit: false, dim: true }, 'a beam reach: dim');
  assert.deepEqual(assistState(st(120, 4)), { word: 'GYBE', kind: null, lit: false, dim: true }, 'a broad reach: dim, its nearer end\'s word');
  assert.deepEqual(assistState(st(40, 0.5)), { word: 'TACK', kind: null, lit: false, dim: true }, 'stopped (under 0.6 m/s): dim');
  assert.deepEqual(assistState(st(10, 0.3), { stuckS: 3 }), { word: 'FREE', kind: 'free', lit: false, dim: false }, 'in irons 3 s: FREE');
  assert.equal(assistState(st(10, 0.3), { stuckS: 2.9 }).word, 'TACK', 'not yet 3 s: not FREE');
  assert.equal(assistState(st(10, 0.3), { stuckS: 5, engine: true }).dim, true, 'under motor: no FREE (the phone shows STOP)');
  assert.deepEqual(assistState(st(10, 0.3), { stuckS: 5, held: true }), { word: 'TACK', kind: null, lit: false, dim: true }, 'anchored or moored: dim');
  assert.deepEqual(assistState(st(40, 4, { furl: 1 })), { word: 'TACK', kind: null, lit: false, dim: true }, 'sails down: dim');
  assert.deepEqual(assistState(st(40, 0), { aground: true }), { word: 'REFLOAT', kind: 'refloat', lit: false, dim: false });
  for (const r of ['tack', 'gybe', 'free', 'refloat']) assert.deepEqual(assistState(st(100, 4), { running: r }), { word: r.toUpperCase(), kind: r, lit: true, dim: false }, `${r} running: lit`);
  assert.deepEqual(WORDS, ['TACK', 'GYBE', 'FREE', 'REFLOAT']);
  // the irons clock's conditions
  assert.ok(stuckNow(st(20, 1)), 'head to wind, slow'); assert.ok(!stuckNow(st(40, 1)), 'off the no-go zone');
  assert.ok(!stuckNow(st(20, 2)), '1.5 kn or more'); assert.ok(stuckNow(st(90, 0.6, { u: -0.4 })), 'drifting astern');
  assert.ok(!stuckNow(st(20, 1), { held: true }) && !stuckNow(st(20, 1), { engine: true }) && !stuckNow(st(20, 1), { aground: true }) && !stuckNow(st(20, 1, { furl: 1 })), 'not anchored, under motor, aground or with the sails down');
  assert.equal(ASSIST.ironsDeg, 32); assert.equal(ASSIST.ironsKn, 1.5); assert.equal(ASSIST.ironsS, 3);
});

test('FREE frees a boat in irons within 15 s on v2\'s boat: both tacks, light and fresh wind; she ends off the wind on the side she leaned to, the sails drawing again', () => {
  for (const ms of [3, 9]) for (const off of [10, -10, 2]) {
    const B = ironsBoat(ms, off);
    const s0 = B.state;
    assert.ok(stuckNow(s0), `${ms} m/s, ${off}°: in irons (TWA ${(s0.trueWind.angle / DEG).toFixed(1)}°, ${(s0.sog / KN).toFixed(2)} kn)`);
    const F = new FreeAssist(); F.start(s0.trueWind.angle);
    const side = F.side;
    let t = 0, out = null;
    for (; t < 20 && F.active; t += 1 / 60) {
      const o = F.step(1 / 60, B.state); B.station({ free: o }); B.step(1 / 60, { steer: 0, pull: 0 }, 1 / 60);
      if (out == null && Math.sign(B.state.trueWind.angle) === side && Math.abs(B.state.trueWind.angle) >= FREE.outDeg * DEG) out = t;
    }
    B.station({ free: null });
    assert.ok(out != null && out < 15, `${ms} m/s, ${off}°: round to ${FREE.outDeg}° in ${out?.toFixed(1)} s`);
    assert.ok(!F.active && t < 15.5, `${ms} m/s, ${off}°: the manoeuvre done in ${t.toFixed(1)} s`);
    if (off !== 2) assert.equal(side, Math.sign(off), 'the new tack is the side the bow leaned to');
    for (let i = 0; i < 60 * 8; i++) B.step(1 / 60, { steer: 0, pull: 0 }, 1 / 60);
    const a = Math.abs(B.state.trueWind.angle) / DEG;
    assert.ok(a > ASSIST.ironsDeg && !stuckNow(B.state) && B.state.u > 0, `${ms} m/s, ${off}°: 8 s on she sails (TWA ${a.toFixed(0)}°, u ${B.state.u.toFixed(2)} m/s)`);
    assert.equal(B.ctl.jibBack, 0); assert.equal(B.ctl.mainBack, 0); assert.equal(B.ctl.pivot, 0);
  }
});

test('a dead heading takes the side with the deeper water ahead', () => {
  const F = new FreeAssist();
  F.start(0.5 * DEG, { deeper: (side) => (side > 0 ? 3 : 20) }); assert.equal(F.side, -1);
  F.start(-0.5 * DEG, { deeper: (side) => (side > 0 ? 30 : 4) }); assert.equal(F.side, 1);
  F.start(12 * DEG, { deeper: (side) => (side > 0 ? 3 : 20) }); assert.equal(F.side, 1, 'a clear lean wins over depth');
});

test('sternway: the helm steers the reversed way (the stern goes where the blade\'s trailing edge points), and FREE puts it over that way', () => {
  for (const helm of [1, -1]) {
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(0.01, 200), start: { x: 0, z: 0, headingDeg: 0, speed: -1.5 } });
    B.ctl.furl = 1;
    for (let i = 0; i < 60 * 3; i++) B.step(1 / 60, { steer: helm, pull: 0 }, 1 / 60);
    assert.ok(B.state.u < -0.3, `going astern (${B.state.u.toFixed(2)} m/s)`);
    assert.ok(Math.sign(B.state.yawRate) === -helm && Math.abs(B.state.yawRate) > 0.5 * DEG, `helm ${helm > 0 ? 'starboard' : 'port'} astern turns the bow ${helm > 0 ? 'to port' : 'to starboard'} (${(B.state.yawRate / DEG).toFixed(2)}°/s)`);
  }
  const F = new FreeAssist(); F.start(10 * DEG);   // wind from starboard: she falls off to port onto starboard tack
  F.step(1.2, { trueWind: { angle: 10 * DEG }, u: 0.2, yawRate: 0 });
  const ahead = F.step(1 / 60, { trueWind: { angle: 10 * DEG }, u: 0.2, yawRate: 0 }), astern = F.step(1 / 60, { trueWind: { angle: 10 * DEG }, u: -0.3, yawRate: 0 });
  assert.equal(ahead.helm, -1, 'ahead: helm to port turns her to port'); assert.equal(astern.helm, 1, 'astern: the reversed helm');
  assert.equal(astern.jibSide, 1, 'the jib backed to the wind\'s side'); assert.ok(astern.jibBack > 0 && astern.mainBack > 0);
});

test('REFLOAT runs the kedge and lights while it hauls; a press with nothing to do does nothing', () => {
  const ground = { state: { mode: 'aground', kedging: false } }, calls = [];
  const B = { phys: { state: st(20, 0), engine: { on: false } }, ground, sea: { held: false } };
  const A = createAssist({ B, grounding: { kedge: () => { calls.push('kedge'); ground.state.kedging = true; } } });
  A.update(1 / 60);
  assert.equal(A.word, 'REFLOAT'); assert.ok(!A.lit && !A.dim);
  assert.equal(A.press(), true); assert.deepEqual(calls, ['kedge']);
  A.update(1 / 60); assert.ok(A.lit, 'lit while the kedge hauls');
  ground.state.mode = 'afloat'; ground.state.kedging = false; B.phys.state = st(100, 0); A.update(1 / 60);
  assert.ok(A.dim && !A.lit); assert.equal(A.press(), false, 'dim: nothing');
});

test('a hand on the helm cancels FREE; so does a second press; TACK goes through the tack button', () => {
  const B = ironsBoat(5, 12);
  const A = createAssist({ B });
  for (let i = 0; i < 60 * 3.5; i++) frame(B, A);
  assert.equal(A.word, 'FREE');
  assert.ok(A.press()); frame(B, A); assert.ok(A.lit && A.free.active && A.hands, 'running, lit');
  frame(B, A, { handHeld: true }); assert.ok(!A.free.active && A.hands == null, 'the wheel in the hand cancels it');
  for (let i = 0; i < 30; i++) frame(B, A);
  assert.ok(A.press()); frame(B, A); assert.ok(A.free.active);
  assert.equal(A.press(), false); frame(B, A); assert.ok(!A.free.active && !A.lit, 'a second press cancels it');
  let tackPressed = 0; const tack = { press: () => { tackPressed++; return true; }, active: false };
  const A2 = createAssist({ B: { phys: { state: st(40, 4), engine: { on: false } } }, tack });
  A2.update(1 / 60); assert.equal(A2.word, 'TACK'); assert.ok(A2.press()); assert.equal(tackPressed, 1);
});

test('AUTO holding and FREE: AUTO stays on through it and holds the heading she has after; AUTO to a target goes to HOLD first', () => {
  const B = ironsBoat(5, 12);
  const A = createAssist({ B });
  const P = createPilot({ B, tack: A });
  for (let i = 0; i < 60 * 3.5; i++) frame(B, A);
  assert.equal(P.auto(), 'hold');
  assert.ok(P.tack(), 'the key runs FREE');
  for (let i = 0; i < 60 * 16 && A.active; i++) { frame(B, A); P.update(); }
  assert.ok(!A.active, 'done'); P.update();
  assert.equal(P.mode, 'hold', 'AUTO still on');
  assert.ok(Math.abs(Math.atan2(Math.sin(P.held - B.state.heading), Math.cos(P.held - B.state.heading))) < 1e-9, 'holding the heading she has after it');
  assert.ok(Math.abs(B.state.trueWind.angle) > 40 * DEG, `off the wind (${(B.state.trueWind.angle / DEG).toFixed(0)}°)`);
  // AUTO to a target: the key hands the course back to HOLD first (the navigator stub releases)
  let released = 0; const nav = { engage: () => ({ ok: true }), release: () => { released++; }, on: true, dest: null, distance: () => 100 };
  const B2 = ironsBoat(5, 12), A2 = createAssist({ B: B2 }), P2 = createPilot({ B: B2, tack: A2, target: () => ({ x: 500, z: 500, key: 't' }), nav: () => nav });
  P2.load(); return Promise.resolve().then(() => {   // the navigator now (in play: at the first AUTO with a target)
    P2.update(); assert.equal(P2.auto(), 'to');
    for (let i = 0; i < 60 * 3.5; i++) A2.update(1 / 60);
    assert.ok(P2.tack()); assert.equal(P2.mode, 'hold'); assert.ok(released >= 1, 'the navigator let go');
  });
});

test('a beginner stuck with no input: FREE on its own after 6 s with one line, at most once per 3 min; never for Club or Pro; any input waits', () => {
  for (const beginner of [true, false]) {
    const B = ironsBoat(5, 12), said = [];
    const A = createAssist({ B, beginner: () => beginner, say: (t, k) => said.push([t, k]) });
    let started = null;
    for (let t = 0; t < 12; t += 1 / 60) { frame(B, A); if (A.free.active && started == null) started = t; }
    if (!beginner) { assert.equal(started, null, 'Club or Pro: no auto-free'); assert.deepEqual(said, []); continue; }
    assert.ok(started != null && Math.abs(started - AUTO_FREE.afterS) < 0.2, `auto-free at ${started?.toFixed(2)} s stuck`);
    assert.deepEqual(said, [[LINES.auto, 'reply']], 'one line');
    for (let t = 0; t < 15 && A.free.active; t += 1 / 60) frame(B, A);
    // in irons again inside 3 minutes: no second auto-free
    B.place({ x: B.state.x, z: B.state.z, headingDeg: 200 - 12, speed: 0 });
    for (let t = 0; t < 40; t += 1 / 60) frame(B, A);
    assert.ok(A.word === 'FREE' && !A.free.active, 'stuck again within 3 min: FREE offered, not run');
    assert.equal(said.length, 1);
    // a held key resets the idle clock
    const B2 = ironsBoat(5, 12), A2 = createAssist({ B: B2, beginner: () => true });
    for (let t = 0; t < 12; t += 1 / 60) frame(B2, A2, { input: Math.floor(t) % 4 === 0 });
    assert.ok(!A2.free.active, 'input inside every 6 s: it waits');
  }
  assert.equal(AUTO_FREE.afterS, 6); assert.equal(AUTO_FREE.everyS, 180);
});

test('the cue: one soft brighten of about 1.5 s when FREE appears, no loop; the word changing is the rest', () => {
  const B = ironsBoat(5, 12), A = createAssist({ B });
  let maxCue = 0, endCue = 1;
  for (let t = 0; t < 20; t += 1 / 60) { frame(B, A); if (A.word === 'FREE') maxCue = Math.max(maxCue, A.cue); if (t > 10) endCue = Math.min(endCue, A.cue); }
  assert.equal(A.word, 'FREE'); assert.equal(A.cues, 1, 'one brighten in 20 s stuck');
  assert.ok(maxCue > 0.9, `it brightens (${maxCue.toFixed(2)})`); assert.equal(endCue, 0, 'then rests');
  assert.equal(CUE.brightenS, 1.5);
});
