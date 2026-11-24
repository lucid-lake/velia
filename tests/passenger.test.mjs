// Cruise as a passenger mode (owner, 2026-10-30): which inputs take the helm and which never
// do, the five cameras and their 1 s moves, the hand-over's camera continuity, the destination pick, the music controls.
// Headless: the pure tables and classes, the real terrain and the real navigator. The page itself (the switch, the plates,
// the hand-over end to end) is tools/probe_passenger.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYMAP, CRUISE_KEYMAP, CRUISE_PADMAP, PADMAP, KEY, collisions, padCollisions, cruiseKind } from '../src/sail/keys.js';
import { keyClass, padIntent, partIntent } from '../src/modes/chill/intent.js';
import { CAMERAS, nextCamera, easePose, CameraMove, LookOffset, pickIsland, IslandCam, ISLAND, GLIDE, MOVE_S, pathClear } from '../src/modes/chill/cameras.js';
import { PadCam } from '../src/modes/chill/padCam.js';
import { createCameraRig } from '../src/modes/chill/rig.js';
import { chillWorld, voyage } from '../src/modes/chill/sim.js';
import { checkDestination, DEST_SAY, snapToClear, findPath, Navigator, scenicRoute } from '../src/sim/modes/chill/navigator.js';
import { createMusic, pieceTitle, BEDS } from '../src/modes/chill/music.js';
import { assertSafe } from './helpers/chill-safety.mjs';

const ev = (code, o = {}) => ({ code, key: code.replace(/^Key|^Digit/, ''), shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...o });

// ---- the keys ------------------------------------------------------------------------------------------------------
test('keys: the Cruise table has no collisions, and C is the camera there while it is the helm view in Sail', () => {
  assert.deepEqual(collisions(CRUISE_KEYMAP).map(([a, b]) => `${a.code}: ${a.action} / ${b.action}`), []);
  assert.deepEqual(collisions([...CRUISE_KEYMAP, { code: 'KeyC', shift: false, modes: ['cruise'], kind: 'passenger', action: 'x' }]).length, 1, 'the check can fail');
  assert.equal(cruiseKind('KeyC', false), 'passenger'); assert.equal(cruiseKind('KeyC', true), 'passenger');
  assert.ok(KEYMAP.find((k) => k.code === 'KeyC' && k.shift === false).action.includes('helm view'), 'Sail keeps C = the helm view');
  // the two tables never share a mode, so a Sail binding can not collide with a Cruise one
  const sail = new Set(KEYMAP.flatMap((k) => k.modes ?? ['basic', 'raw', 'pro-basic', 'pro-raw']));
  assert.ok(CRUISE_KEYMAP.every((k) => k.modes.length === 1 && k.modes[0] === 'cruise' && !sail.has('cruise')));
});

test('keys: every boat-operating Sail key is an intent key in Cruise; the passenger keys never are', () => {
  const op = /steer|sheets|trim|jib|traveller|twist|backstay|engine|throttle|anchor|lines|sails: down|reef|wing on wing|crew/i;
  const sailOps = KEYMAP.filter((k) => op.test(k.action) && !/^H held|logbook|chart|binoc|VHF|sound|wind level|mode|menu|boat from above/i.test(k.action));
  assert.ok(sailOps.length >= 25, `${sailOps.length} operating keys found`);
  const missing = sailOps.filter((k) => cruiseKind(k.code, !!k.shift) !== 'intent').map((k) => `${k.code}: ${k.action}`);
  assert.deepEqual([...new Set(missing)], [], 'a Sail operating key that does not take the helm in Cruise');
  for (const code of ['KeyC', 'KeyV', 'KeyN', 'KeyL', 'KeyB', 'KeyO', 'KeyM', 'BracketLeft', 'BracketRight', 'Escape', 'Backquote']) {
    assert.equal(keyClass(ev(code)), 'passenger', code);
    assert.notEqual(keyClass(ev(code, { shiftKey: true })), 'intent', `Shift+${code}`);
  }
  for (const code of ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'KeyQ', 'KeyE', 'KeyZ', 'KeyX', 'KeyR', 'KeyF', 'KeyI', 'Equal', 'Minus', 'Digit0', 'KeyJ', 'KeyU', 'KeyY', 'KeyK', 'KeyG']) {
    assert.equal(keyClass(ev(code)), 'intent', code);
  }
});

test('keys: modifiers alone, browser chords and unbound keys do nothing', () => {
  for (const key of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab']) assert.equal(keyClass({ code: key + 'Left', key }), 'none', key);
  assert.equal(keyClass(ev('KeyA', { metaKey: true })), 'none', 'Cmd+A');
  assert.equal(keyClass(ev('KeyD', { ctrlKey: true })), 'none');
  assert.equal(keyClass(ev('KeyW', { altKey: true })), 'none');
  for (const code of ['Space', 'Digit1', 'Digit3', 'KeyH', 'KeyP', 'KeyX0', 'F5']) assert.equal(keyClass(ev(code)), 'none', `${code} is not the helm`);
});

test('gamepad: sticks, triggers, bumpers and the d-pad up / down are intent; resting, Y, the d-pad left / right, R3 and the right stick are not', () => {
  const pad = (axes = [0, 0, 0, 0], buttons = {}) => ({ axes, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: !!buttons[i], value: buttons[i] ?? 0 })) });
  assert.equal(padIntent(null), false);
  assert.equal(padIntent(pad()), false);
  assert.equal(padIntent(pad([0.1, -0.1, 0.9, 0.9])), false, 'a resting left stick; the right stick looks');
  assert.equal(padIntent(pad([0.6, 0, 0, 0])), true, 'steer');
  assert.equal(padIntent(pad([0, 0.5, 0, 0])), true);
  assert.equal(padIntent(pad([0, 0, 0, 0], { 7: 0.8 })), true, 'RT pulls');
  assert.equal(padIntent(pad([0, 0, 0, 0], { 6: 0.5 })), true, 'LT eases');
  assert.equal(padIntent(pad([0, 0, 0, 0], { 4: 1 })), true, 'LB twist'); assert.equal(padIntent(pad([0, 0, 0, 0], { 13: 1 })), true, 'd-pad down');
  assert.equal(padIntent(pad([0, 0, 0, 0], { 14: 1 })), false, 'the d-pad left is the previous camera now');
  assert.equal(padIntent(pad([0, 0, 0, 0], { 15: 1 })), false, 'the d-pad right is the next camera now');
  assert.equal(padIntent(pad([0, 0, 0, 0], { 3: 1, 2: 1, 8: 1, 9: 1, 10: 1, 11: 1, 14: 1, 15: 1 })), false, 'view, logbook, keys, glasses, chart, cameras');
});

test('the helm view: the wheel and the winches are intent, the radio set is not', () => {
  assert.equal(partIntent({ role: 'steer' }), true); assert.equal(partIntent({ role: 'pull' }), true); assert.equal(partIntent({ role: 'ease' }), true);
  assert.equal(partIntent({ id: 'radio', kind: 'click' }), false); assert.equal(partIntent(null), false);
});

test('gamepad: the Cruise pad table has no collisions, matches padIntent, and Sail keeps Y and R3', () => {
  assert.deepEqual(padCollisions().map(([a, b]) => `${a.button}: ${a.action} / ${b.action}`), []);
  assert.equal(padCollisions([...CRUISE_PADMAP, { button: 3, gesture: 'tap', kind: 'passenger', action: 'x' }]).length, 1, 'the check can fail');
  assert.equal(padCollisions([...CRUISE_PADMAP, { button: 7, gesture: 'tap', kind: 'passenger', action: 'x' }]).length, 1, 'a press covers a tap');
  const pad = (buttons) => ({ axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i in buttons, value: buttons[i] ?? 0 })) });
  for (const m of CRUISE_PADMAP) assert.equal(padIntent(pad({ [m.button]: 1 })), m.kind === 'intent', `button ${m.button}: ${m.action}`);
  // the stick and the triggers count as helm intent (a resting stick does not)
  assert.equal(padIntent({ axes: [0.41, 0, 0, 0], buttons: [] }), true); assert.equal(padIntent({ axes: [0.25, 0.25, 0, 0], buttons: [] }), false, 'inside 0.4');
  assert.equal(padIntent({ axes: [0, -0.9, 0, 0], buttons: [] }), true);
  assert.equal(padIntent(pad({ 7: 0.31 })), true); assert.equal(padIntent(pad({ 6: 0.31 })), true);
  // Sail's table still has Y on the view and R3 on the chart: the camera meaning is Cruise's only
  assert.ok(PADMAP.find((m) => m.button === 3).action.includes('helm view')); assert.ok(PADMAP.find((m) => m.button === 11).action.includes('chart'));
  assert.ok(CRUISE_PADMAP.find((m) => m.button === 11).action.includes('chart'), 'R3 is the chart in both');
});

test('gamepad: Y taps the next camera, held 0.5 s the helm camera; the d-pad left / right step back and forward; no repeats', () => {
  const pc = new PadCam(), btn = (...on) => { const a = []; for (const i of on) a[i] = true; return a; }, dt = 1 / 60;
  const run = (secs, ...on) => { const out = []; for (let i = 0; i < Math.round(secs * 60); i++) out.push(...pc.update(dt, btn(...on))); return out; };
  assert.deepEqual([...run(0.1, 3), ...run(0.1)], ['next'], 'a tap acts on release');
  assert.deepEqual([...run(1.2, 3), ...run(0.1)], ['helm'], 'a hold acts once, not again on release');
  assert.deepEqual([...run(0.3, 14), ...run(0.1)], ['prev']); assert.deepEqual([...run(2, 15)], ['next'], 'held d-pad does not repeat');
  assert.deepEqual(run(1, 4, 6, 7), [], 'trim buttons are not cameras');
  let v = 'cinematic'; for (const a of ['next', 'next', 'prev']) v = nextCamera(v, a === 'prev' ? -1 : 1); assert.equal(v, 'astern');
});

// ---- the cameras ----------------------------------------------------------------------------------------------------
test('cameras: C steps round the five, Shift+C back, and the default is the director', () => {
  assert.deepEqual(CAMERAS, ['cinematic', 'astern', 'above', 'helm', 'island']);
  let v = 'cinematic'; const seen = [];
  for (let i = 0; i < 5; i++) { v = nextCamera(v); seen.push(v); }
  assert.deepEqual(seen, ['astern', 'above', 'helm', 'island', 'cinematic']);
  assert.equal(nextCamera('cinematic', -1), 'island');
  assert.equal(nextCamera('nonsense'), 'cinematic');
});

const pose = (x, y, z, tx, ty, tz, fov = 50) => ({ pos: [x, y, z], target: [tx, ty, tz], fov, near: 0.5 });
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('cameras: a switch is a 1 s eased move that starts on the pose on screen and lands on the live one, never a jump', () => {
  const A = pose(0, 10, 40, 0, 2, 0, 50), B = pose(30, 3, -10, 0, 2, 0, 62);
  assert.deepEqual(easePose(A, B, 0).pos, A.pos); assert.deepEqual(easePose(A, B, 1).pos, B.pos);
  const mv = new CameraMove(); mv.begin(A);
  assert.equal(MOVE_S, 1);
  const dt = 1 / 60, total = dist(A.pos, B.pos); let prev = A.pos, worst = 0, n = 0;
  while (mv.moving) { mv.step(dt); const p = mv.pose(B); worst = Math.max(worst, dist(p.pos, prev)); prev = p.pos; n++; }
  assert.ok(Math.abs(n - 60) <= 1, `${n} frames`);
  assert.ok(worst <= total * 0.035, `worst step ${worst.toFixed(3)} of ${total.toFixed(1)} m`);   // smootherstep peaks at 1.875× the mean step
  assert.deepEqual(prev, B.pos);
});

test('cameras: the look about the lens clamps, eases back after a pause, and a zoom keeps the lens in range', () => {
  const o = new LookOffset(), P = pose(0, 5, 0, 0, 5, -10, 50);
  o.update(1 / 60, { look: [0.5, 0] }); o.update(1 / 60, { look: [5, 0] });
  assert.ok(o.yaw <= o.yawMax + 1e-9, 'yaw clamps');
  assert.ok(o.apply(P).target[0] !== P.target[0], 'the lens turns');
  for (let i = 0; i < 60 * 20; i++) o.update(1 / 60);
  assert.ok(Math.abs(o.yaw) < 0.01, `back to the shot (${o.yaw.toFixed(3)})`);
  for (let i = 0; i < 400; i++) o.update(1 / 60, { zoom: 0.97 });
  assert.ok(o.apply(P).fov >= 12 && o.zoom >= 0.45 - 1e-9);
});

// the real bay: a rig on the real terrain with a boat afloat
const W = chillWorld({ seed: 1, hour: 16, rate: 0 });
const fakeFollow = { update: (dt, s) => ({ pos: [s.x - Math.sin(s.heading) * 30, 12, s.z + Math.cos(s.heading) * 30], target: [s.x, 1.5, s.z], fov: 50, near: 0.5 }) };
const ridePose = (s) => ({ x: s.x, z: s.z, heading: s.heading, heel: 0.1, pitch: 0, heave: 0 });

test('rig: every switch between the five views moves at most 3.5 % of its path per frame, and C round the ring lands each view', () => {
  const s = { x: 270, z: 30, heading: 1.2, sog: 2.5 };
  const rig = createCameraRig({ terrain: W.terrain, follow: fakeFollow });
  const dp = pose(s.x - 80, 14, s.z + 60, s.x, 2.5, s.z, 28);
  const frame = (dt = 1 / 60) => rig.pose(dt, { ride: ridePose(s), state: s, fp: fakeFollow.update(dt, s), dp, look: null, zoom: 1 });
  for (let i = 0; i < 30; i++) frame();
  for (const to of [...CAMERAS.slice(1), 'cinematic', 'helm', 'astern', 'island', 'above']) {
    const from = rig.last; rig.set(to);
    assert.equal(rig.view, to);
    let prev = from.pos, steps = 0, worst = 0, first = null;
    while (rig.move.moving || steps < 3) { const p = frame(); first ??= p; worst = Math.max(worst, dist(p.pos, prev)); prev = p.pos; steps++; if (steps > 200) break; }
    assert.ok(dist(first.pos, from.pos) <= Math.max(0.05, dist(from.pos, prev) * 0.035), `${to}: the first frame stays on the pose on screen`);
    assert.ok(worst <= Math.max(0.06, dist(from.pos, prev) * 0.04), `${to}: worst step ${worst.toFixed(3)} m over ${dist(from.pos, prev).toFixed(1)} m`);
    assert.ok(steps >= 58 && steps <= 70, `${to}: ${steps} frames`);
  }
});

test('rig: a switch mid-move turns from the pose on screen, not from the old one', () => {
  const s = { x: 270, z: 30, heading: 1.2, sog: 2.5 };
  const rig = createCameraRig({ terrain: W.terrain, follow: fakeFollow });
  const dp = pose(s.x - 80, 14, s.z + 60, s.x, 2.5, s.z, 28);
  const frame = () => rig.pose(1 / 60, { ride: ridePose(s), state: s, fp: fakeFollow.update(0, s), dp, look: null, zoom: 1 });
  for (let i = 0; i < 20; i++) frame();
  rig.set('helm'); for (let i = 0; i < 25; i++) frame();
  const mid = rig.last; rig.set('above');
  const p = frame();
  assert.ok(dist(p.pos, mid.pos) < 0.5, `${dist(p.pos, mid.pos).toFixed(2)} m from where it was`);
});

test('the island camera: a shore point on land with a clear line to the boat, the same every time, kept while it stays good', () => {
  const g = { ground: W.terrain.heightAt, shore: W.terrain.shoreDistance };
  const boat = { x: 270, z: 30 };
  const a = pickIsland(g, boat), b = pickIsland(g, boat);
  assert.ok(a, 'a shore point in reach');
  assert.deepEqual(a, b);
  const ground = W.terrain.heightAt(a[0], a[2]);
  assert.ok(ground >= ISLAND.riseMin && ground <= ISLAND.riseMax && g.shore(a[0], a[2]) > 0, `ground ${ground.toFixed(1)} m, shore ${g.shore(a[0], a[2]).toFixed(0)}`);
  const d = Math.hypot(a[0] - boat.x, a[2] - boat.z);
  assert.ok(d >= 150 && d <= 900, `${d.toFixed(0)} m`);
  const cam = new IslandCam(g);
  const p0 = cam.update(0.1, boat);
  for (let i = 0; i < 100; i++) cam.update(0.1, { x: boat.x + i, z: boat.z + i * 0.3 });
  assert.deepEqual(cam.update(0.1, { x: boat.x + 100, z: boat.z + 30 }), p0, 'a boat 100 m on keeps the same eye');
  assert.equal(cam.picks, 1);
});

test('the island camera on the real bay: a long sail never hops (no frame-to-frame jump, every hand-off eased over >= 2 s)', () => {
  const s = { x: 270, z: 30, heading: 1.57, sog: 4 };
  const rig = createCameraRig({ terrain: W.terrain, follow: fakeFollow });
  const dp = pose(s.x - 80, 14, s.z + 60, s.x, 2.5, s.z, 28);
  const frame = () => rig.pose(1 / 60, { ride: ridePose(s), state: s, fp: fakeFollow.update(1 / 60, s), dp, look: null, zoom: 1 });
  for (let i = 0; i < 30; i++) frame();
  rig.set('island', { instant: true });
  let p0 = frame().pos, v0 = [0, 0, 0], worstAcc = 0, big = 0, picks0 = rig.island.picks;
  for (let i = 0; i < 60 * 600; i++) {
    s.x = 270 + 4 * (i / 60);
    const p = frame().pos, v = [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]];
    worstAcc = Math.max(worstAcc, dist(v, v0)); if (Math.hypot(...v) > 3) big++;
    p0 = p; v0 = v;
  }
  assert.ok(rig.island.picks - picks0 >= 1, `${rig.island.picks - picks0} new vantages`);
  assert.ok(worstAcc <= 2, `worst change of velocity ${worstAcc.toFixed(2)} m/frame (a hop is hundreds)`);
  assert.ok(big === 0 || big >= 2 * 60 * (rig.island.glides + rig.island.cuts) * 0.5, `${big} fast frames (hand-offs are >= 2 s)`);
});

test('the island camera: a flight through terrain is a cut, an open flight is eased from the eye on screen', () => {
  const hill = (x) => (x > 40 && x < 60 ? 50 : 0), ground = (x) => hill(x);
  assert.equal(pathClear(ground, [0, 3, 0], [100, 3, 0]), false, 'a hill across the path');
  assert.equal(pathClear(ground, [0, 3, 0], [30, 3, 0]), true);
  const cam = new IslandCam({ ground: () => 0, shore: () => 10 });
  cam.pos = [0, 3, 0]; cam.goal = [0, 3, 0];
  cam.setGoal([300, 3, 0]);
  assert.ok(cam.gliding && cam.cuts === 0 && cam.glide.dur >= GLIDE.minS);
  const steps = []; let prev = cam.pos;
  for (let i = 0; i < 300 && cam.gliding; i++) { const p = cam.update(1 / 60, { x: 150, z: 400 }); steps.push(dist(p, prev)); prev = p; }
  assert.ok(Math.max(...steps) < 300 * 0.035 * Math.max(1, GLIDE.minS / cam.glide?.dur || 1) + 1, 'smooth steps');
  assert.deepEqual(prev.map((v) => Math.round(v)), [300, 3, 0]);
  const ridge = new IslandCam({ ground, shore: () => 10 });
  ridge.pos = [0, 3, 0]; ridge.goal = [0, 3, 0]; ridge.setGoal([100, 3, 0]);
  assert.ok(ridge.gliding && ridge.cuts === 0 && ridge.glide.lift >= 75, 'a 50 m ridge: the flight rises over it');
  let top = 0; for (let i = 0; i < 600 && ridge.gliding; i++) { const p = ridge.update(1 / 60, { x: 50, z: 300 }); if (p[0] > 40 && p[0] < 60) assert.ok(p[1] > 50 + 1.5, `over the ridge at ${p[1].toFixed(1)} m`); top = Math.max(top, p[1]); }
  assert.ok(top >= 70);
  const mount = new IslandCam({ ground: (x) => (x > 40 && x < 60 ? 400 : 0), shore: () => 10 });
  mount.pos = [0, 3, 0]; mount.goal = [0, 3, 0]; mount.setGoal([100, 3, 0]);
  assert.ok(!mount.gliding && mount.cuts === 1 && mount.justCut && mount.pos[0] === 100, 'a cut only when even a lifted flight cannot clear');
});

test('rig: the island view eases (never hops) when a shore is first found or lost', () => {
  const s = { x: 270, z: 30, heading: 1.2, sog: 2.5 };
  let shoreOn = false;
  const rig = createCameraRig({ terrain: { heightAt: W.terrain.heightAt, shoreDistance: (x, z) => (shoreOn ? W.terrain.shoreDistance(x, z) : -50) }, follow: fakeFollow });
  const dp = pose(s.x - 80, 14, s.z + 60, s.x, 2.5, s.z, 28);
  const frame = () => rig.pose(1 / 60, { ride: ridePose(s), state: s, fp: fakeFollow.update(1 / 60, s), dp, look: null, zoom: 1 });
  for (let i = 0; i < 30; i++) frame();
  rig.set('island'); for (let i = 0; i < 90; i++) frame();   // no shore: the boat's own view
  const before = rig.last; shoreOn = true;
  let prev = before.pos, worst = 0, n = 0;
  for (let i = 0; i < 60 * 4; i++) { const p = frame(); worst = Math.max(worst, dist(p.pos, prev)); prev = p.pos; n++; }
  const total = dist(before.pos, prev);
  assert.ok(total > 50, `it flew ${total.toFixed(0)} m to a shore`);
  assert.ok(worst <= total * 0.02, `worst step ${worst.toFixed(2)} of ${total.toFixed(0)} m`);
});

// ---- the destination ---------------------------------------------------------------------------------------------
test('destination: land, shallows, the shore and off-chart are refused politely; open water and a snapped name are taken', () => {
  const C = W.chart, from = [270, 30];
  const open = snapToClear(C, [520, -560]);
  assert.equal(checkDestination(C, open[0], open[1], { from }).ok, true);
  const land = checkDestination(C, -900, 200);   // the waterfall's side: land
  assert.equal(land.ok, false); assert.equal(land.reason, 'land'); assert.equal(land.say, DEST_SAY.land);
  const off = checkDestination(C, 99999, 0);
  assert.equal(off.reason, 'off');
  // a point just off the shore is refused as too close, not as land
  let near = null;
  for (let x = 600; x < 1500 && !near; x += 10) for (let z = -1000; z < -200 && !near; z += 10) if (C.shoreAt(x, z) > 5 && C.shoreAt(x, z) < 60 && C.depthAt(x, z) > 0) near = [x, z];
  if (near) { const r = checkDestination(C, near[0], near[1]); assert.equal(r.ok, false); assert.ok(['shore', 'shallow', 'objects'].includes(r.reason), r.reason); }
  for (const say of Object.values(DEST_SAY)) assert.ok(/^[A-Z]/.test(say) && /[.?]$/.test(say) && say.length < 60, say);
  // a name on land snaps to the clearest water near it
  const wf = checkDestination(C, -856, 171, { from, snapM: 260 });
  assert.ok(wf.ok === true || wf.reason, 'answers either way'); if (wf.ok) assert.ok(C.marginAt(...wf.at) >= 0);
});

test('destination: the navigator sails to a chosen mark, arrives within 70 m, then resumes the scenic round, safely', () => {
  const world = chillWorld({ seed: 2, hour: 16, rate: 0 });
  const mark = snapToClear(world.chart, [520, -560]);
  let set = false, reachedAt = null, nearest = Infinity, afterDest = null;
  const out = voyage({ seed: 2, hour: 16, rate: 0, minutes: 14, skipper: 1, world, onTick: (t, s, o, nav) => {
    if (!set) {
      const ok = checkDestination(world.chart, mark[0], mark[1], { from: [s.x, s.z] });
      assert.equal(ok.ok, true); nav.setDestination(ok.at, { name: 'the north shore' }); set = true;
      assert.equal(nav.target.key, 'dest');
    }
    if (nav.dest) nearest = Math.min(nearest, Math.hypot(s.x - mark[0], s.z - mark[1]));
    if (nav.arrived && reachedAt == null) { reachedAt = t; assert.equal(nav.dest, null); }
    if (reachedAt != null && afterDest == null && t > reachedAt + 5) afterDest = nav.target.key;
  } });
  assert.ok(reachedAt != null, `arrived (the nearest it came ${nearest.toFixed(0)} m)`);
  assert.ok(out.reached.some((r) => r.key === 'dest' && r.name === 'the north shore'));
  assert.notEqual(afterDest, 'dest', 'the scenic route resumes');
  assertSafe('destination seed 2', out);
});

test('destination: clearing it returns to the route; a mark chosen again replaces the last', () => {
  const nav = new Navigator({ chart: W.chart, route: scenicRoute(W.chart, { seed: 1 }), seed: 1 });
  const key0 = nav.target.key;
  nav.setDestination([100, 100], { name: 'a' }); assert.equal(nav.target.name, 'a');
  nav.setDestination([200, 100], { name: 'b' }); assert.equal(nav.target.name, 'b');
  assert.equal(nav.clearDestination(), true); assert.equal(nav.clearDestination(), false);
  assert.equal(nav.target.key, key0);
});

// ---- the music ----------------------------------------------------------------------------------------------------
class Gain { constructor() { this.value = 1; this.log = []; } setValueAtTime(v) { this.value = v; this.log.push(['set', v]); } linearRampToValueAtTime(v) { this.log.push(['ramp', v]); } setTargetAtTime(v) { this.value = v; this.log.push(['target', v]); } cancelScheduledValues() {} }
class Node { constructor(ctx, o = {}) { this.o = o; this.gain = new Gain(); this.starts = []; } connect() {} start(at, off) { this.starts.push([at, off ?? 0]); Node.all.push(this); } stop() { this.stopped = true; } }
Node.all = [];
function rig() {
  globalThis.GainNode = Node; globalThis.AudioBufferSourceNode = Node; Node.all = [];
  const ctx = { currentTime: 10, decodeAudioData: async () => ({ duration: 120 }) };
  const timers = [];
  const audio = { attach(fn) { this.fn = fn; }, start() { this.fn({ ctx, master: new Node() }); } };
  const music = createMusic({ audio, seed: 1, fetchFn: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }), setTimer: (f, ms) => { timers.push([f, ms]); } });
  return { ctx, music, timers, audio };
}
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
const sources = () => Node.all.filter((n) => n.starts.length);

test('music: next fades the piece out and starts a different one; pause keeps the place; play resumes from it; volume is a gain', async () => {
  const { ctx, music, timers } = rig();
  music.start(); await settle();
  assert.equal(music.stats().playing, true); const first = music.stats().piece;
  assert.ok(music.title.length > 2 && music.title[0] === music.title[0].toUpperCase(), music.title);
  // pause 30 s in: the place is kept
  ctx.currentTime = 40;
  assert.equal(music.pause(), true); assert.equal(music.paused, true);
  assert.equal(music.stats().playing, false);
  assert.equal(music.pause(), false, 'a second pause does nothing');
  assert.ok(music.title, 'the plate still names the piece');
  ctx.currentTime = 90;   // time passes while paused
  assert.equal(music.resume(), true); await settle();
  const src = sources().at(-1);
  assert.ok(Math.abs(src.starts[0][1] - 30) < 0.5, `resumed ${src.starts[0][1]} s in (30 s kept)`);
  assert.equal(music.paused, false); assert.equal(music.stats().playing, true);
  assert.equal(music.toggle(), true); assert.equal(music.paused, true); music.toggle(); await settle();
  // next: the piece fades and the next one plays after the fade
  const n0 = sources().length;
  assert.equal(music.next(), true);
  assert.ok(timers.at(-1)[1] >= 1200, 'after the fade');
  timers.at(-1)[0](); await settle();
  assert.equal(sources().length, n0 + 1);
  assert.notEqual(music.stats().piece, first);
  // volume
  assert.equal(music.setVolume(0.4), 0.4); assert.equal(music.volume, 0.4);
  assert.equal(music.setVolume(7), 1); assert.equal(music.setVolume(-1), 0);
  // before start and after finish they do nothing, quietly
  const idle = rig().music;
  assert.equal(idle.next(), false); assert.equal(idle.pause(), false); assert.equal(idle.resume(), false);
  assert.equal(idle.setVolume(0.5), 0.5);
});

test('music: a piece ending after a skip does not start a second one on top', async () => {
  const { ctx, music, timers } = rig();
  music.start(); await settle();
  const before = sources().length;
  music.next(); music.next(); music.next();
  for (const [f] of timers.splice(0)) f(); await settle();
  assert.equal(sources().length, before + 1, 'one new piece, not three');
  void ctx;
});

test('music: piece titles read plainly', () => {
  assert.equal(pieceTitle('/audio/music/over_the_ridge_a.opus'), 'Over the ridge')   // a piece with no entry: a short name from its file
  assert.equal(pieceTitle('/audio/music/new_piece_b.opus'), 'New piece');
  assert.equal(pieceTitle(BEDS[6]), 'Golden hour on the lake');
});
