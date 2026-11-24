// #8, #14: the engine and the ground tackle on v2 (v2/sim/seamanship.js on v2/sim/boat.js) against v1's: the motor's speed and
// heading against v1's BoatPhysics stepped v1's way, prop walk, the lever's notches and its start and stop (v1's
// throttleLever rules through the seamanship's actions), the anchor's drop rules, its hold and the swing against v1's tackle on
// v1's physics, the "at anchor" state the logbook reads, what the renderer gets (the anchor's drop, the rode, the exhaust), the
// prop wash in the wake's history, v1's engine sound mix, the keys against v1's table, and the piers file against its bake.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { createSeamanship, hullToWorld, piersOf } from '../sim/seamanship.js';
import { seaKey } from '../ui/seamanship.js';
import { createWakeTrack, foamAtCPU, POINT_FLOATS, propChurn } from '../sim/wake.js';
import { BoatPhysics, CONTROLS, DT, Helm, steadyWind } from '../../src/sim/boat.js';
import { createTackle, ANCHOR } from '../../src/sim/boat/tackle.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import { KEY } from '../../src/sail/keys.js';
import { createEngineAudio } from '../../src/engineAudio.js';
import { readFileSync } from 'node:fs';

const DEG = Math.PI / 180;
const wrap = (d) => ((d % 360) + 540) % 360 - 180;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => steadyWind(ms, fromDeg)(x, z, t) });
const flat = waterFor(() => 0);
function boat({ depth = 40, windKn = 0.02, windFrom = 0, heading = 90, speed = 0, say = null, A = null } = {}) {
  const B = createBoatSim({ water: flat, heightAt: () => -depth, wind: steady(windKn * KN, windFrom), start: { x: 0, z: 0, headingDeg: heading, speed } });
  const said = [];
  const sea = createSeamanship({ B, depthAt: () => depth, say: say ?? ((id) => said.push(id)), timeScale: 1, A });
  B.sea = sea;
  const run = (secs, each = null) => { for (let i = 0; i < Math.round(secs * 60); i++) { B.step(1 / 60, { steer: 0, pull: 0 }); each?.(i / 60); } return B.state; };
  return { B, sea, said, run };
}

test('motoring: v2\'s boat under v1\'s engine makes v1\'s speed and heading (60 s full ahead, then 20 s full astern, in a calm)', () => {
  // v1: BoatPhysics with the engine started, the lever on the throttle, its film helm (src/craft/sloop/capture.js) on the start heading
  const v1 = new BoatPhysics({ x: 0, z: 0, heading: 90 * DEG, speed: 0 }); v1.engine.start();
  const helm1 = new Helm({ rudderMaxDeg: v1.P.rudder.maxDeg }), env1 = { windAt: steadyWind(0.02 * KN, 0), t: 0 };
  // v2: the same through the seamanship's actions (the key, three notches ahead; five astern) and v2's film helm
  const { B, sea } = boat();
  sea.actions.engine();
  const rows = [];
  let lever = 0;
  for (let i = 0; i < 80 * 60; i++) {
    const t = i / 60;
    if (i === 120) { for (let k = 0; k < 3; k++) sea.actions.step(1); lever = 1; }
    if (i === 60 * 60) { for (let k = 0; k < 5; k++) sea.actions.step(-1); lever = -1; }
    env1.t = t; v1.step(DT, { ...CONTROLS, throttle: lever, rudder: helm1.toHeading(v1.state, 90 * DEG) }, env1);
    B.filmStep(1 / 60);   // v1's film contract on v2 (the same helm; the inputs' throttle null: the engine's own lever, set by the actions)
    if (i % 60 === 59) rows.push({ t: t + DT, a: v1.state.u / KN, b: B.state.u / KN, ha: v1.state.heading / DEG, hb: B.state.heading / DEG });
  }
  const at = (s) => rows.find((r) => Math.abs(r.t - s) < 0.01);
  assert.ok(at(60).a > 5.5 && at(60).a < 6.5, `v1 full ahead ${at(60).a.toFixed(2)} kn`);
  for (const r of rows) {
    assert.ok(Math.abs(r.a - r.b) < 0.15, `speed at ${r.t.toFixed(0)} s: v1 ${r.a.toFixed(3)} kn, v2 ${r.b.toFixed(3)} kn`);
    assert.ok(Math.abs(wrap(r.ha - r.hb)) < 1, `heading at ${r.t.toFixed(0)} s: v1 ${r.ha.toFixed(2)}°, v2 ${r.hb.toFixed(2)}°`);
  }
  assert.ok(at(80).b < -1, `astern: sternway ${at(80).b.toFixed(2)} kn`);
});

test('prop walk: astern from rest the stern kicks to port (the bow to starboard), as v1\'s right-hand prop', () => {
  const { B, sea, run } = boat();
  sea.actions.sails();
  sea.actions.engine(); run(2);
  B.ctl.rudder = 0;
  for (let k = 0; k < 5; k++) sea.actions.step(-1);
  const h0 = B.state.heading;
  // the pilot off: the helm held amidships (as v1's engine test: rudder 0)
  for (let i = 0; i < 15 * 60; i++) { B.station({ helm: 0 }); B.step(1 / 60, { steer: 0, pull: 0 }); }
  const turned = wrap((B.state.heading - h0) / DEG);
  assert.ok(turned > 3, `the bow went ${turned.toFixed(1)}° to starboard`);
});

test('the lever: out of N the engine starts; the notches; held + repeats every 0.3 s; 0 is N; at N it stops by state', () => {
  const { B, sea, said, run } = boat({ windKn: 12, windFrom: 0, heading: 90, speed: 2.5 });
  const eng = B.phys.engine;
  assert.equal(eng.state, 'off');
  assert.equal(sea.actions.step(1), 0.3); assert.equal(eng.state, 'cranking', 'out of STOP it cranks');
  run(0.2); assert.equal(B.ctl.throttle, 0.3, 'the lever reaches the physics through ctl.throttle');
  assert.equal(sea.actions.step(1), 0.6); assert.equal(sea.actions.step(1), 1); assert.equal(sea.actions.step(1), 1, 'stops at full ahead');
  sea.actions.neutral(); assert.equal(eng.lever, 0);
  sea.hold(-1); run(1.0); sea.release();
  assert.equal(eng.lever, -1, 'held: slow astern, then a notch 0.3 s later full astern');
  sea.actions.neutral(); run(1.5);
  assert.equal(eng.state, 'running');
  // the sails up and drawing on a reach in 12 kn: after 3 s at N the engine stops and the skipper says why
  run(10);
  assert.equal(eng.on, false, 'stopped by state (the sails drawing)');
  assert.ok(said.includes('engineOffSails'), said.join(','));
  assert.ok(said.includes('motorKeys'), 'the engine\'s first words');
});

test('dropping: too fast the crew stops her first (v2/tests/anchor-seen.test.mjs), refused too deep, and not while the anchor is out', () => {
  const fast = boat({ depth: 8, speed: 2.5 });
  assert.equal(fast.sea.actions.anchor(), 'stopping'); assert.deepEqual(fast.said, ['rounding']);
  const deep = boat({ depth: 40 });
  assert.equal(deep.sea.actions.anchor(), 'deep'); assert.deepEqual(deep.said, ['deep']);
  const ok = boat({ depth: 8 });
  assert.equal(ok.sea.actions.anchor(), 'drop');
  assert.equal(ok.sea.actions.anchor(), 'weigh', 'J again weighs it');
});

test('at anchor: the rode pays out to 5 : 1, the anchor holds in 15 kn, the boat swings head to wind, as v1\'s tackle on v1\'s physics', () => {
  // v1: tests/tackle.test.mjs's rig (BoatPhysics + createTackle, the sails down)
  const tk1 = createTackle({ depthAt: () => 8 });
  const b1 = new BoatPhysics({ x: 0, z: 0, heading: 90 * DEG, speed: 0 }); b1.furlPos = 1;
  const env1 = { windAt: steadyWind(15 * KN, 0), t: 0, ext: tk1.ext, post: tk1.post };
  tk1.drop(b1.state);
  // v2: the seamanship's J (the crew takes the sails down while it holds)
  const { B, sea, run } = boat({ depth: 8, windKn: 15, windFrom: 0, heading: 90, A: ANCHOR });   // v1's numbers (v2's crew runs it faster: v2/tests/anchor-seen.test.mjs)
  B.phys.furlPos = 1; sea.actions.sails();   // the sails down first (Y), as v1's rig has them
  assert.equal(sea.actions.anchor(), 'drop');
  const ax = sea.tackle.state.anchor;
  let t = 0;
  for (let i = 0; i < 240 * 60; i++) { env1.t = t; b1.step(DT, { ...CONTROLS, furl: 1 }, env1); t += DT; B.step(1 / 60, { steer: 0, pull: 0 }); }
  const a1 = tk1.state.anchor, s1 = b1.state, s2 = B.state;
  assert.equal(ax.phase, 'held'); assert.equal(a1.phase, 'held');
  assert.ok(Math.abs(ax.out - Math.min(ANCHOR.rodeM, 5 * (8 + ANCHOR.bowY))) < 0.01, `scope: ${ax.out.toFixed(2)} m out`);
  // the set: v1's anchor creeps as it digs in on the first snatch (it holds at 30 % before it has set); then it holds
  assert.ok(ax.dragged < 3 && a1.dragged < 3, `dragged while setting (v2's crew backs down on it, v1's lets it drift): v1 ${a1.dragged.toFixed(2)} m, v2 ${ax.dragged.toFixed(2)} m`);
  // v1 steps on beside v2 for these 2 min, so the heading and the lie below compare the same moment: with the windage's yaw
  // moment (fix/sim-astern-rudder) she swings up head to wind over 3–4 min in 15 kn instead of overshooting it in 2
  const dragAt = ax.dragged; run(120, () => { env1.t = t; b1.step(DT, { ...CONTROLS, furl: 1 }, env1); t += DT; });
  assert.ok(ax.dragged - dragAt < 0.01, `set and holding: ${(ax.dragged - dragAt).toFixed(3)} m more in 2 min`);
  assert.ok(Math.abs(wrap(s2.heading / DEG)) < 25, `head to wind: ${(s2.heading / DEG).toFixed(1)}°`);
  const d1 = Math.hypot(s1.x - a1.x, s1.z - a1.z), d2 = Math.hypot(s2.x - ax.x, s2.z - ax.z);
  assert.ok(Math.abs(d1 - d2) < 2, `the lie off the anchor: v1 ${d1.toFixed(1)} m, v2 ${d2.toFixed(1)} m`);
  assert.ok(Math.abs(wrap(s1.heading / DEG - s2.heading / DEG)) < 15, `the heading: v1 ${(s1.heading / DEG).toFixed(1)}°, v2 ${(s2.heading / DEG).toFixed(1)}°`);
  assert.equal(B.state.held, true, 'the state says held (the hints read it)');
  assert.equal(sea.anchoredNow, true, 'the logbook\'s anchoredNow');
  assert.equal(sea.holding, true, 'still for 10 s: v1\'s "at anchor"');
  assert.ok(sea.bowLook && !sea.arrival, 'the camera stays at the bow (owner 2026-11-17: "then stay there"), no wide arrival shot');
  // weighing: hauled in, it breaks out at short stay and stows
  sea.actions.anchor(); run(200);
  assert.equal(sea.tackle.state.anchor.phase, 'stowed'); assert.equal(sea.tackle.mode, 'free');
});

test('what the renderer gets: the anchor lowered on its socket and hidden 1 m under, the rode to the water, the exhaust\'s clots', () => {
  const { B, sea, run } = boat({ depth: 8 });
  run(1);
  assert.equal(B.pose.anchorDrop, 0); assert.equal(B.pose.anchorShown, true); assert.equal(B.pose.rode, null);
  assert.equal(sea.exhaust.stats().alive, 0, 'no exhaust with the engine off');
  sea.actions.anchor(); run(0.4);
  assert.ok(B.pose.anchorDrop > 0.3 && B.pose.anchorShown, `lowering: ${B.pose.anchorDrop.toFixed(2)} m`);
  assert.ok(B.pose.rode.length >= 2, 'the rode drawn');
  const roller = hullToWorld(B.pose, DEFAULT_DIMS.HULL.anchorRoller);
  assert.ok(Math.hypot(B.pose.rode[0][0] - roller[0], B.pose.rode[0][1] - roller[1], B.pose.rode[0][2] - roller[2]) < 1e-9, 'from the roller');
  assert.ok(B.pose.rode.at(-1)[1] <= 1.2 && B.pose.rode.at(-1)[1] >= -8, 'down toward the anchor (the whole chain: v2\'s water is clear)');
  run(30);
  const r = B.pose.rode, last = r.at(-1);
  assert.ok(Math.abs(last[1] + 8) < 1e-6, 'at anchor: it reaches the bottom');
  for (let i = 1; i < r.length; i++) assert.ok(r[i][1] <= r[i - 1][1] + 1e-9, 'a catenary: it only falls from the roller to the bottom');
  run(5);
  assert.equal(B.pose.anchorShown, false, 'under the surface: hidden');
  if (!sea.engine.on) sea.actions.engine();   // v2's crew may have started it for the drop
  sea.actions.step(1); run(3);
  assert.ok(sea.exhaust.stats().alive > 10, `the exhaust: ${sea.exhaust.stats().alive} clots in the air`);
  // the hull frame: heading 0, level, the roller is forward (−z) of the centre
  const p = hullToWorld({ x: 10, z: 20, heading: 0, heave: 0.1 }, [0.12, 1.133, -4.492]);
  assert.deepEqual(p.map((v) => +v.toFixed(6)), [10.12, 1.233, 15.508]);
  const q = hullToWorld({ x: 0, z: 0, heading: Math.PI / 2 }, [0, 0, -1]);   // east: the bow at +x
  assert.ok(Math.abs(q[0] - 1) < 1e-12 && Math.abs(q[2]) < 1e-12);
});

test('the prop wash in the wake: the churn under power (v1\'s |thrust| / bollard pull), a boil at the prop astern, none with the engine off', () => {
  assert.deepEqual(propChurn({ thrust: 0, engineRpm: 0 }), { prop: 0, aft: 1.2 });
  assert.deepEqual(propChurn({ thrust: 1450, engineRpm: 3000 }), { prop: 1, aft: 1.2 });
  assert.deepEqual(propChurn({ thrust: -725, engineRpm: 3000 }), { prop: 0.625, aft: -1.5 });
  const T = createWakeTrack({ length: DEFAULT_DIMS.HULL.lwl, beam: DEFAULT_DIMS.HULL.beam });
  const pts = new Float32Array((T.trailN + 1) * POINT_FLOATS), box = new Float64Array(4);
  // a boat at rest, astern at full: the stern's churn sits 1.5 m forward of the transom
  for (let i = 0; i < 240; i++) T.update(null, { x: 0, z: 0, heading: 0, u: 0, thrust: -870, engineRpm: 3000 }, 1 / 60);
  const n = T.pack(pts, 0, 0, box);
  const sz = T.length / 2, at = (z) => foamAtCPU(pts, n, 0, z, { length: T.length, beam: T.beam });
  assert.ok(at(sz - 1.5)[1] > 0.5 && at(sz - 1.5)[0] > 0.3, `the boil: ${at(sz - 1.5)}`);
  assert.ok(at(sz + 4)[1] < 0.01, 'nothing 5.5 m from it');
  assert.ok(box[1] <= sz - 1.5 - 1.4 && box[3] >= sz - 1.5 + 1.4, 'the box holds the boil');
  const T0 = createWakeTrack({ length: T.length, beam: T.beam });
  for (let i = 0; i < 240; i++) T0.update(null, { x: 0, z: 0, heading: 0, u: 0, thrust: 0, engineRpm: 0 }, 1 / 60);
  const n0 = T0.pack(pts, 0, 0, box);
  assert.deepEqual(foamAtCPU(pts, n0, 0, sz - 1.5, { length: T.length, beam: T.beam }), [0, 0], 'no engine: no wash');
});

test('v1\'s engine sound (src/engineAudio.js) mixes from v2\'s state: the starter, idle, the run, the load, the chain', () => {
  const ea = createEngineAudio({ audio: null });
  const m = (s, o) => ea.update(s, o);
  assert.ok(m({ engineRpm: 220, engineState: 'cranking' }).gains.crank > 0.3, 'the starter');
  const idle = m({ engineRpm: 850, engineState: 'running', thrust: 0 }), full = m({ engineRpm: 3000, engineState: 'running', thrust: 1400 });
  assert.ok(idle.gains.idle > 0.3 && idle.gains.run < 0.01, 'idle');
  assert.ok(full.gains.run > 0.8 && full.gains.idle === 0 && full.lowpassHz > idle.lowpassHz, 'the run under load');
  assert.equal(m({ engineRpm: 0, engineState: 'off' }).gains.run, 0);
  assert.ok(m({ engineRpm: 0, engineState: 'off' }, { chainMs: 0.8 }).gains.chain > 2, 'the chain running out');
  // v2's live chain speed: the anchor falls at 1.6 m/s, then the rode pays at 1.2 m/s of sim time (v1: 0.8 both)
  const { B, sea, run } = boat({ depth: 8 });
  assert.ok(sea.A.fallMs > ANCHOR.payMs && sea.A.payMs > ANCHOR.payMs, 'v2\'s crew lets it run faster than v1\'s');
  sea.actions.anchor(); run(3);
  assert.ok(Math.abs(sea.chainMs - sea.A.fallMs) < 0.05, `falling: chain ${sea.chainMs.toFixed(3)} m/s`);
  run(5);
  assert.ok(Math.abs(sea.chainMs - sea.A.payMs) < 0.05, `paying out: chain ${sea.chainMs.toFixed(3)} m/s`);
  assert.ok(B);
});

test('the keys are v1\'s (src/sail/keys.js KEY): I, + −, 0, J, Y; U (the lines) is the MOOR button\'s alone; a repeat or a typing field does nothing', () => {
  assert.deepEqual(seaKey({ code: KEY.engine }), { engine: true });
  assert.deepEqual(seaKey({ code: KEY.ahead }), { lever: 1 }); assert.deepEqual(seaKey({ code: 'NumpadAdd' }), { lever: 1 });
  assert.deepEqual(seaKey({ code: KEY.astern }), { lever: -1 }); assert.deepEqual(seaKey({ code: 'NumpadSubtract' }), { lever: -1 });
  assert.deepEqual(seaKey({ code: KEY.neutral }), { neutral: true });
  assert.deepEqual(seaKey({ code: KEY.anchor }), { anchor: true }); assert.equal(seaKey({ code: KEY.lines }), null, 'U: no key'); assert.deepEqual(seaKey({ code: KEY.sails }), { sails: true });
  assert.equal(seaKey({ code: KEY.anchor, repeat: true }), null); assert.equal(seaKey({ code: KEY.anchor, typing: true }), null); assert.equal(seaKey({ code: KEY.engine, metaKey: true }), null);
  assert.equal(seaKey({ code: 'KeyA' }), null);
});

test('MOOR: a pier within 15 m wakes the lines switch; alongside and stopped the crew ties up; the piers file is v1\'s bake', async () => {
  const shipped = readFileSync(new URL('../assets/towns/piers.json', import.meta.url), 'utf8');
  const { bakePiers } = await import('../../tools/v2-tackle-bake.mjs');
  assert.equal(shipped, await bakePiers(), 'v2/assets/towns/piers.json is tools/v2-tackle-bake.mjs\'s output');
  const all = piersOf(JSON.parse(shipped));
  assert.ok(all.length > 1000 && all.every((p) => p.a.length === 2 && p.half > 0 && p.kind));
  // a pier along x at z = 5 (half-width 1): the boat beside it, heading east, stopped
  const { B, sea, run } = boat({ depth: 6, heading: 90 });
  assert.equal(sea.linesUp(), false);
  sea.setPiers([{ a: [-20, 3.1], b: [20, 3.1], half: 1, kind: 'pier' }]);   // its edge 0.5 m off the starboard side (beam / 2 ≈ 1.6 m)
  run(0.5);
  assert.equal(sea.linesUp(), true, 'MOOR shows near a pier');
  assert.equal(sea.actions.lines(), 'docked');
  run(20);
  assert.equal(sea.tackle.mode, 'docked'); assert.equal(B.state.held, true);
  assert.equal(sea.actions.lines(), 'lines', 'U again lets go');
});
