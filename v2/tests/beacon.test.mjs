// The target beacon: the rules (sim/waymark.js: one beacon at a time, the arrival radius, a new target lights again),
// the target in force (targetOf), Sail's double-tap mark (ui/sailMark.js: the beacon, no autopilot, the helm untouched; clear of the
// helm band, the drag and the pinch) beside Cruise's (its navigator sails to it), and the flag row (on by default, ?beacon=0 off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBeacon, targetOf, BEACON, draftTarget, createLatest } from '../sim/waymark.js';
import { createSailMark, waterUnder, SAIL_MARK, pushOut } from '../ui/sailMark.js';
import { mountPlan } from '../ui/plan.js';
import { BEACON_LOOK, BEACON_COLOUR, BEACON_WGSL, BEACON_ARRIVE, createBeaconFx } from '../render/waymark.js';
import { parseV2Flags } from '../engine/flags.js';
import { createBoatSim, waterFor, START } from '../sim/boat.js';
import { createCruiseVoyage } from '../cruise/voyage.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { perspectiveReversed, lookDir, multiply, invert, mat4, DEG } from '../engine/math.js';

const run = (S, tg, boat, s, dt = 1 / 60) => { let snap; for (let t = 0; t < s; t += dt) snap = S.update(tg, boat, dt); return snap; };
const T1 = { x: 1000, z: 0, kind: 'route' }, T2 = { x: -800, z: 300, kind: 'route' };

test('arrival: the beacon fades in, stays lit outside the radius, plays the arrival inside it, then is gone', () => {
  const S = createBeacon();
  let s = S.update(T1, { x: 0, z: 0 }, 0);
  assert.equal(s.phase, 'in'); assert.ok(s.visible);
  s = run(S, T1, { x: 0, z: 0 }, BEACON.fadeInS + 0.1);
  assert.equal(s.phase, 'on'); assert.equal(s.alpha, 1);
  s = run(S, T1, { x: T1.x - BEACON.arriveM - 1, z: 0 }, 1);
  assert.equal(s.phase, 'on', `still lit ${BEACON.arriveM + 1} m off`);
  assert.ok(s.near < 1 && s.near >= BEACON.nearFloor, 'softer near');
  s = S.update(T1, { x: T1.x - BEACON.arriveM + 1, z: 0 }, 1 / 60);
  assert.equal(s.phase, 'arrive'); assert.ok(s.visible && s.arriveT >= 0);
  s = run(S, T1, { x: T1.x, z: 0 }, BEACON.arriveS + 0.05);
  assert.equal(s.phase, 'done'); assert.equal(s.visible, false);
  s = run(S, T1, { x: 0, z: 0 }, 3);   // sailing away from the same target: it stays dark
  assert.equal(s.visible, false, 'the same target never lights again');
  assert.equal(s.arrivals, 1);
});

test('a new target lights a new beacon; one beacon at a time', () => {
  const S = createBeacon();
  run(S, T1, { x: 0, z: 0 }, 1);
  run(S, T1, { x: T1.x, z: 0 }, BEACON.arriveS + 0.1);
  assert.equal(S.snapshot.visible, false);
  let s = S.update(T2, { x: T1.x, z: 0 }, 1 / 60);
  assert.equal(s.phase, 'in'); assert.ok(s.visible); assert.equal(s.x, T2.x); assert.equal(s.z, T2.z);
  // a far switch replaces the lit beacon at once (the snapshot holds one position)
  s = run(S, T2, { x: 0, z: 0 }, 1);
  s = S.update(T1, { x: 0, z: 0 }, 1 / 60);
  assert.equal(s.x, T1.x); assert.equal(s.phase, 'in');
});

test('a target cleared far away fades; cleared close (Cruise\'s 70 m mark) is an arrival', () => {
  const S = createBeacon();
  run(S, T1, { x: 0, z: 0 }, 1);
  let s = S.update(null, { x: 0, z: 0 }, 1 / 60);
  assert.equal(s.phase, 'clear');
  s = run(S, null, { x: 0, z: 0 }, BEACON.clearS + 0.05);
  assert.equal(s.phase, 'off'); assert.equal(s.visible, false);
  const C = createBeacon();
  run(C, { x: 70, z: 0, kind: 'cruise' }, { x: 0, z: -200 }, 1);
  run(C, { x: 70, z: 0, kind: 'cruise' }, { x: 0, z: -60 }, 0.5);   // 92 m: lit
  s = C.update(null, { x: 0, z: -40 }, 1 / 60);   // the navigator cleared it at its own radius
  assert.equal(s.phase, 'arrive');
});

test('the arrival radius: 50 m in Sail, 70 m in Cruise (owner 2026-11-15); none in Regatta (2026-11-16)', () => {
  assert.equal(BEACON.arriveM, 50);
  const race = targetOf({ race: { status: 'racing', leg: 0, target: { at: { x: 0, z: 0 }, mark: 'W' } } });
  const cruise = targetOf({ cruise: { at: [0, 0] } }), sail = targetOf({ sail: { x: 0, z: 0 } });
  assert.equal(sail.arriveM ?? BEACON.arriveM, 50); assert.equal(cruise.arriveM, 70); assert.equal(race.arriveM, 0);
  for (const [tg, r] of [[sail, 50], [cruise, 70]]) {
    const S = createBeacon();
    run(S, tg, { x: 0, z: 300 }, 1);
    let s = run(S, tg, { x: 0, z: r + 2 }, 0.5);
    assert.equal(s.phase, 'on', `${tg.kind}: lit ${r + 2} m off`);
    s = S.update(tg, { x: 0, z: r - 2 }, 1 / 60);
    assert.equal(s.phase, 'arrive', `${tg.kind}: the arrival inside ${r} m`);
    assert.equal(s.ring, true, `${tg.kind}: the arrival's ring on the water`);
  }
});

// a race's view as the regatta gives it (index.js beaconView: the leg's number as seq)
const rv = (leg, mark, x, z, status = 'racing') => ({ status, leg: typeof leg === 'number' ? leg : String(leg), seq: typeof leg === 'number' ? leg : null, target: { at: { x, z }, mark } });

test('Regatta: inside 50 m without the rounding the beam stays lit, no ring; the rounding plays the arrival at the mark, then lights the next', () => {
  const S = createBeacon();
  const W = targetOf({ race: rv(0, 'W', 0, 0) }), I = targetOf({ race: rv(1, 'I', 400, 300) });
  assert.equal(W.ring, false, 'a race target draws no ring');
  run(S, W, { x: 0, z: 200 }, 1);
  // she sails right up to the mark, inside the zone, and round its far side: still lit, never an arrival
  let s;
  for (const p of [{ x: 0, z: 60 }, { x: 0, z: 40 }, { x: 0, z: 15 }, { x: 8, z: 0 }, { x: 0, z: -10 }]) {
    s = run(S, W, p, 0.6);
    assert.equal(s.phase, 'on', `lit at ${Math.hypot(p.x, p.z).toFixed(0)} m before the rounding`);
    assert.equal(s.arriveT, -1); assert.equal(s.arrivals, 0);
  }
  // the session's rounding moves the race on one leg: the arrival plays at the rounded mark (no ring), then the next lights
  s = S.update(I, { x: -5, z: -12 }, 1 / 60);
  assert.equal(s.phase, 'arrive'); assert.equal(s.x, 0, 'the effect at the rounded mark'); assert.equal(s.ring, false, 'no ring');
  s = run(S, I, { x: -5, z: -12 }, BEACON.liftS);
  assert.ok(s.lift > 0.95 && s.alpha < 0.05, 'the beam lifts and fades: done');
  s = run(S, I, { x: -5, z: -12 }, BEACON.arriveS - BEACON.liftS + 0.05);
  assert.ok(s.visible && s.x === 400 && (s.phase === 'in' || s.phase === 'on'), 'then the next mark lights, only it');
  assert.equal(s.arrivals, 1);
  // a rounding far from the mark (the target moves on whatever the distance) is still the arrival
  const F = createBeacon();
  run(F, W, { x: 0, z: 200 }, 1);
  assert.equal(F.update(I, { x: 0, z: 200 }, 1 / 60).phase, 'arrive');
});

test('Regatta: the finish plays the arrival on the crossing; a restart, the fly-over, a DNF or leaving the race never do', () => {
  const S = createBeacon();
  const last = targetOf({ race: rv(2, 'finish', 100, 0) }), done = targetOf({ race: rv(2, 'finish', 100, 0, 'finished') });
  assert.equal(done.arrived, true); assert.equal(done.key, last.key, 'the same target, now crossed');
  run(S, last, { x: 100, z: 300 }, 1);
  let s = run(S, last, { x: 100, z: 20 }, 1);
  assert.equal(s.phase, 'on', 'lit near the committee boat until the line is crossed');
  s = S.update(done, { x: 100, z: -5 }, 1 / 60);
  assert.equal(s.phase, 'arrive'); assert.equal(s.ring, false);
  s = run(S, done, { x: 100, z: -5 }, BEACON.arriveS + 0.05);
  assert.equal(s.phase, 'done'); assert.equal(s.visible, false);
  s = run(S, done, { x: 100, z: -50 }, 2); assert.equal(s.visible, false, 'stays dark after the finish'); assert.equal(s.arrivals, 1);
  // a restart (leg 2 → 0), close to the mark: a plain swap, no arrival
  const R = createBeacon(), W = targetOf({ race: rv(0, 'W', 0, 0) }), I = targetOf({ race: rv(1, 'I', 10, 10) });
  run(R, I, { x: 0, z: 0 }, 1);
  s = R.update(W, { x: 0, z: 0 }, 1 / 60); assert.equal(s.phase, 'in', 'a restart: the first mark lights again, no arrival'); assert.equal(s.arrivals, 0);
  // the fly-over's stops (no seq) swap plainly
  const Y = createBeacon();
  run(Y, targetOf({ race: rv('fly0', 'W', 0, 0) }), { x: 0, z: 10 }, 1);
  s = Y.update(targetOf({ race: rv('fly1', 'I', 10, 10) }), { x: 0, z: 10 }, 1 / 60); assert.equal(s.phase, 'in'); assert.equal(s.arrivals, 0);
  // leaving the race (no target) or a DNF beside the mark: a plain fade
  const L = createBeacon();
  run(L, W, { x: 0, z: 5 }, 1);
  assert.equal(L.update(null, { x: 0, z: 5 }, 1 / 60).phase, 'clear');
  assert.equal(targetOf({ race: { ...rv(0, 'W', 0, 0), status: 'dnf' } }), null);
  // a finished race this beacon was not showing: nothing lights
  const N = createBeacon();
  assert.equal(N.update(done, { x: 0, z: 0 }, 1 / 60).visible, false);
});

test('the arrival ring is small and short in Sail and Cruise (owner 2026-11-16) and absent in Regatta', () => {
  const writes = [];
  const device = { createBuffer: () => ({}), createBindGroupLayout: () => ({}), createBindGroup: () => ({}), createPipelineLayout: () => ({}), queue: { writeBuffer: (b, o, d) => writes.push(Float32Array.from(d)) } };
  const fx = createBeaconFx({ device, reg: { shader: () => ({}), add() {}, get: () => ({}) }, frameBGL: {}, frameBG: {}, U: { byteOffset: 0 }, frameStruct: '', hdrTarget: {} });
  const ringAt = (tg, boatEnd) => {
    const S = createBeacon(); run(S, tg, { x: 0, z: 300 }, 1);
    let maxR = 0, lastA = 0, ringS = 0;
    for (let t = 0; t < BEACON.arriveS; t += 1 / 60) {
      const s = S.update(tg, boatEnd, 1 / 60); fx.frame({ snap: s });
      const d = writes.at(-1), r = d[7], a = fx.stats.ringA; if (a > 0.01) { maxR = Math.max(maxR, r); ringS = s.arriveT; } lastA = a;
    }
    return { maxR, ringS, lastA };
  };
  for (const tg of [targetOf({ sail: { x: 0, z: 0 } }), targetOf({ cruise: { at: [0, 0] } })]) {
    const o = ringAt(tg, { x: 0, z: 10 });
    assert.ok(o.maxR > 8 && o.maxR <= 18, `${tg.kind}: the ring a splash at the mark (${o.maxR.toFixed(1)} m), not the 50–70 m arrival radius`);
    assert.ok(o.ringS <= 1.0, `${tg.kind}: short (${o.ringS.toFixed(2)} s)`);
  }
  assert.ok(BEACON_ARRIVE.ringToM <= 18 && BEACON_ARRIVE.ringS < BEACON.arriveS);
  const race = targetOf({ race: rv(0, 'W', 0, 0) }), S = createBeacon(); run(S, race, { x: 0, z: 300 }, 1);
  S.update(targetOf({ race: rv(1, 'I', 400, 0) }), { x: 0, z: 10 }, 1 / 60);
  let maxA = 0; for (let t = 0; t < 1; t += 1 / 60) { fx.frame({ snap: S.update(targetOf({ race: rv(1, 'I', 400, 0) }), { x: 0, z: 10 }, 1 / 60) }); maxA = Math.max(maxA, fx.stats.ringA, writes.at(-1)[7]); }
  assert.equal(maxA, 0, 'Regatta: no beacon ring (alpha and radius 0) during the rounding\'s arrival');
});

test('targetOf: a pin, then the race, then Cruise\'s mark, then Sail\'s mark, then the passage', () => {
  const race = { status: 'racing', leg: 0, target: { at: { x: 1, z: 2 }, mark: 'W' } }, cruise = { at: [3, 4] }, sail = { x: 5, z: 6 }, passage = { x: 7, z: 8, kind: 'route' };
  assert.equal(targetOf({ pin: { x: 9, z: 9 }, race, cruise, sail, passage }).kind, 'pin');
  assert.equal(targetOf({ race, cruise, sail, passage }).kind, 'race');
  assert.equal(targetOf({ cruise, sail, passage }).kind, 'cruise');
  assert.equal(targetOf({ sail, passage }).kind, 'sail');
  assert.equal(targetOf({ passage }).kind, 'route');
  assert.equal(targetOf({}), null);
});

// a camera over the water: the boat at the origin, the eye 12 m up and 25 m astern, looking north
function cam(w = 1280, h = 720) {
  const view = mat4(), proj = mat4(), vp = mat4(), inv = mat4();
  lookDir(view, [0, 12, 25], [0, -0.2, -1], [0, 1, 0]); perspectiveReversed(proj, 50 * DEG, w / h, 0.5, 120000); multiply(vp, proj, view); invert(inv, vp);
  return { inv, rect: { left: 0, top: 0, width: w, height: h } };
}
const tapAt = (M, x, y, t, o = {}) => { const e = { pointerId: o.id ?? 1, pointerType: o.type ?? 'mouse', clientX: x, clientY: y, button: 0, timeStamp: t }; M.down(e); if (o.drag) M.move({ ...e, clientX: x + 20 }); return M.up({ ...e, clientX: x + (o.drag ? 20 : 0) }); };
const dbl = (M, x, y, o = {}) => { tapAt(M, x, y, o.t ?? 1000, o); return tapAt(M, x, y, (o.t ?? 1000) + 180, o); };

test('waterUnder: the water under a screen point, null for the sky', () => {
  const { inv, rect } = cam();
  const p = waterUnder(inv, rect, 640, 500);
  assert.ok(p && p.z < 25 && Math.abs(p.x) < 1, `ahead on the centre line (${JSON.stringify(p)})`);
  assert.equal(waterUnder(inv, rect, 640, 20), null);
});

test('Sail: a double-tap on the water sets the mark and lights the beacon; no autopilot, the helm and the sheets untouched', () => {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -50, start: START });
  const { inv, rect } = cam();
  const lines = [];
  const ctl0 = JSON.stringify(B.ctl), hand0 = JSON.stringify(B.hand);
  const boat = () => ({ x: 0, z: 0 });
  const M = createSailMark({ waterAt: (x, y) => waterUnder(inv, rect, x, y), depthAt: () => 30, boat, say: (t) => lines.push(t), viewport: () => ({ w: 1280, h: 720 }) });
  assert.equal(tapAt(M, 640, 300, 0), null, 'one tap is no mark');
  assert.equal(M.mark, null);
  assert.equal(dbl(M, 640, 300, { t: 2000 }), 'set');
  assert.ok(M.mark && M.mark.z < -40);
  const S = createBeacon();
  const s = S.update(targetOf({ sail: M.mark }), boat(), 1 / 60);
  assert.ok(s.visible && s.kind === 'sail', 'the beacon is on the mark');
  assert.equal(B.driven, false, 'no autopilot');
  assert.equal(JSON.stringify(B.ctl), ctl0, 'the helm and trim untouched'); assert.equal(JSON.stringify(B.hand), hand0);
  assert.equal(lines.at(-1), 'Mark set. Click NAV to sail there.', 'the line names what comes next');
  // a new double-tap moves it; a double-tap on it clears it
  assert.equal(dbl(M, 200, 250, { t: 4000 }), 'moved');
  const m = M.mark;
  const sp = { x: 200, y: 250 };
  assert.equal(dbl(M, sp.x, sp.y, { t: 6000 }), 'cleared'); assert.equal(M.mark, null);
  assert.ok(m);
});

test('Sail\'s double-tap keeps clear of the other gestures: the drag, the pinch, the helm band, the sky, the shallows, Cruise', () => {
  const { inv, rect } = cam(390, 844);
  let active = true;
  const M = createSailMark({ waterAt: (x, y) => waterUnder(inv, rect, x, y), depthAt: (x) => (x > 30 ? 0.5 : 30), boat: () => ({ x: 0, z: 0 }), active: () => active, viewport: () => ({ w: 390, h: 844 }) });
  assert.equal(dbl(M, 195, 420, { drag: true }), null, 'a drag is the look');
  // the pinch: a second finger down between the taps
  M.down({ pointerId: 1, pointerType: 'touch', clientX: 195, clientY: 420 }); M.down({ pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 470 });
  assert.equal(M.up({ pointerId: 1, pointerType: 'touch', clientX: 195, clientY: 420, timeStamp: 10 }), null);
  assert.equal(M.up({ pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 470, timeStamp: 20 }), null);
  assert.equal(dbl(M, 195, 844 * (1 - SAIL_MARK.lowBand) + 20, { type: 'touch', t: 3000 }), null, 'an upright phone\'s helm band');
  assert.equal(M.mark, null);
  assert.equal(dbl(M, 195, 60, { type: 'touch', t: 5000 }), null, 'the sky');
  active = false;
  assert.equal(dbl(M, 195, 420, { type: 'touch', t: 7000 }), null, 'Cruise (or a race) owns the double-tap');
  active = true;
  assert.equal(dbl(M, 195, 350, { type: 'touch', t: 9000 }), 'set', 'a plain double-tap on the water, above the band');
  const shallow = createSailMark({ waterAt: () => ({ x: 100, z: -200 }), depthAt: () => 0.5, boat: () => ({ x: 0, z: 0 }) });
  assert.equal(shallow.at(0, 0), 'refused');
});

test('Cruise: its double-tap mark still sets the navigator\'s mark and the skipper sails to it (the beacon on it)', () => {
  const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start: START });
  const V = createCruiseVoyage({ B, lake: W.terrain, wind: W.wind, seed: 1, chartIn: { shoreline: W.shoreline, harbour: W.harbour }, sun: () => 20 });
  V.place(V.startPose(0)); V.attach();
  const s0 = B.state, at = [s0.x + Math.sin(s0.heading) * 600, s0.z - Math.cos(s0.heading) * 600];
  V.nav.setDestination(at, { name: 'your mark' });   // what Cruise's pickDestination does after the chart's check (cruise/index.js)
  const S = createBeacon();
  const snap = S.update(targetOf({ cruise: V.nav.dest, sail: { x: 1, z: 1 } }), B.state, 1 / 60);
  assert.equal(snap.kind, 'cruise', 'Cruise\'s mark wins');
  assert.ok(B.driven && V.attached, 'the autopilot sails');
  const d0 = Math.hypot(at[0] - B.state.x, at[1] - B.state.z);
  for (let i = 0; i < 60 * 40; i++) B.step(1 / 60, null, 1 / 60);
  const d1 = V.nav.dest ? Math.hypot(at[0] - B.state.x, at[1] - B.state.z) : 0;
  assert.ok(d1 < d0 - 40, `she closes the mark (${d0.toFixed(0)} → ${d1.toFixed(0)} m)`);
});

test('Sail\'s double-tap near the boat (fix 2026-11-15): the mark goes nearM out on the tap\'s bearing, never inside the arrival radius', () => {
  assert.ok(SAIL_MARK.nearM > BEACON.arriveM * 2 && SAIL_MARK.nearM > BEACON.cruiseArriveM * 2, 'well outside both arrival radii');
  const b = { x: 100, z: 50 };
  const p = pushOut(b, { x: 100 + 30, z: 50 - 40 });   // 50 m off, bearing (0.6, −0.8)
  assert.ok(Math.abs(Math.hypot(p.x - b.x, p.z - b.z) - SAIL_MARK.nearM) < 1e-9 && Math.abs((p.x - b.x) / SAIL_MARK.nearM - 0.6) < 1e-9, `out on the bearing (${JSON.stringify(p)})`);
  assert.deepEqual(pushOut(b, { x: 100, z: 50 - 400 }), { x: 100, z: -350 }, 'far taps unchanged');
  assert.equal(pushOut(b, { x: 102, z: 51 }), null, 'a tap on the boat: no bearing, no mark');
  // through the mark: a double-tap 20 m off sets the mark 150 m out, the beacon stays lit (no arrival at once); the same spot clears it
  let pt = { x: 0, z: -20 };
  const M = createSailMark({ waterAt: () => pt, depthAt: () => 30, boat: () => ({ x: 0, z: 0 }) });
  assert.equal(M.at(0, 0), 'set');
  assert.ok(Math.abs(M.mark.z + SAIL_MARK.nearM) < 1e-9, `150 m ahead (${JSON.stringify(M.mark)})`);
  const S = createBeacon();
  const s = run(S, targetOf({ sail: M.mark }), { x: 0, z: 0 }, 2);
  assert.equal(s.phase, 'on', 'lit, not arrived');
  assert.equal(M.at(0, 0), 'cleared', 'the same spot again clears it');
  pt = { x: 0, z: -2 };
  assert.equal(M.at(0, 0), null, 'on the boat');
  // place(): a world point (the chart past the planner's chart), the same checks and its own line
  const lines = [];
  const P = createSailMark({ waterAt: () => null, depthAt: (x) => (x > 5000 ? 0.5 : 40), boat: () => ({ x: 0, z: 0 }), say: (t) => lines.push(t) });
  assert.equal(P.place({ x: 1500, z: -2500 }, { line: 'past' }), 'set'); assert.deepEqual(P.mark, { x: 1500, z: -2500 }); assert.equal(lines.at(-1), 'past');
  assert.equal(P.place({ x: 5500, z: 0 }), 'refused', 'the shallows');
});

test('Sail\'s chart target before Set course (fix 2026-11-15): the drafted route\'s first waypoint lights the beacon, Set course keeps its key', () => {
  const route = [{ x: 300, z: -300, name: null }, { x: 900, z: -800, name: null }];
  const draft = { active: false, route }, set = { active: true, route };
  const t = draftTarget(draft);
  assert.deepEqual([t.x, t.z, t.kind], [300, -300, 'route']);
  assert.equal(draftTarget(set), null, 'an active course: the passage service has it');
  assert.equal(draftTarget({ active: false, route: [] }), null); assert.equal(draftTarget(null), null);
  const S = createBeacon();
  const k0 = S.update(targetOf({ passage: t }), { x: 0, z: 0 }, 1 / 60).key;
  const s = run(S, targetOf({ passage: { x: 300, z: -300, name: 'WP 1 · 2', kind: 'route' } }), { x: 0, z: 0 }, 1);   // what the passage service gives after Set course
  assert.equal(s.key, k0); assert.equal(s.phase, 'on', 'no second fade');
});

test('the later target wins (fix 2026-11-15): Sail\'s double-tap mark or the chart\'s, whichever was set last; the other shows when it goes', () => {
  const pick = createLatest(), A = { x: 10, z: 10 }, B = { x: 500, z: -500 };
  assert.equal(pick(null, null), null);
  assert.equal(pick(null, B), B, 'the chart');
  assert.equal(pick(A, B), A, 'then a double-tap: the mark');
  assert.equal(pick(A, { x: 700, z: -500 }).x, 700, 'then a new chart waypoint');
  assert.equal(pick(A, { x: 700, z: -500 }).x, 700, 'held');
  assert.equal(pick(A, null), A, 'the chart cleared: the mark shows');
});

test('the chart in Cruise (fix 2026-11-15): each tap goes to Cruise\'s mark; Sail\'s tap past the planner\'s chart goes to Sail\'s mark', async () => {
  const made = new Map(), services = { get: (k) => made.get(k), provide: (k, v) => made.set(k, v) };
  const cp = { setRoute() {}, el: { querySelector: () => null } };
  const picks = [], offs = [];
  const chart = { region: { x0: -1300, x1: 1700, z0: -2000, z1: 1800 } };
  const plan = mountPlan({ services, cp, chartP: new Promise(() => {}), cruisePick: (p) => { picks.push(p); return 'set'; }, offChart: (p) => { offs.push(p); return 'set'; } });
  plan.setMode('cruise');
  assert.equal(plan.pick({ op: 'add', x: 10, z: 20, name: null }), 'set');
  assert.deepEqual(picks.map((p) => p.op), ['add'], 'Cruise: the tap reaches the mark');
  // Sail, a tap past the chart's region (the open lake): Sail's mark, not the planner's "That is off my chart."
  const err = console.error; console.error = () => {};   // the planner itself needs the page (its sheet's DOM): only the chart's region is read here
  const plan2 = mountPlan({ services, cp, chartP: Promise.resolve(chart), offChart: (p) => { offs.push(p); return 'set'; } });
  try { await plan2.ready; } finally { console.error = err; }
  assert.equal(plan2.pick({ op: 'add', append: true, index: 0, x: 1500, z: -2500, name: null }), 'set');
  assert.deepEqual(offs.map((p) => [p.x, p.z]), [[1500, -2500]], 'Sail: past the chart, Sail\'s mark');
});

test('the flag: the beacon on by default, ?beacon=0 off (the A/B); no option, colour or HUD rows left', () => {
  assert.equal(parseV2Flags('?hour=13').beacon, true);
  assert.equal(parseV2Flags('?beacon=0').beacon, false);
  const f = parseV2Flags('?beaconcol=blue&beaconhud=1');
  assert.equal(f.beaconcol, undefined); assert.equal(f.beaconhud, undefined);
});

test('the look: the light pillar in cream, no red or green (port and starboard), bolder far than near, the shader text builds', () => {
  for (const k of ['core', 'glow']) {
    const [r, g, b] = BEACON_COLOUR[k];
    assert.ok(r >= g && g >= b && g > 0.6, `${k} is cream or warm (${BEACON_COLOUR[k]})`);
  }
  assert.ok(BEACON_LOOK.H > 400 && BEACON_LOOK.glowPx > 0);
  assert.ok(BEACON_LOOK.farI > 0 && BEACON_LOOK.farGlowI > 0 && BEACON_LOOK.farPx > 0 && BEACON_LOOK.farFromM >= 500, 'the far boost starts well outside the near range');
  assert.match(BEACON_WGSL('struct Frame { x: f32 }'), /@vertex fn vs/);
});
