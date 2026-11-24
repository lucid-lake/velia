// The anchorage cues (owner, 2026-11-18): the Boat Camp's mooring field (its data, the pick-up with
// the anchor key on v2's tackle, the ball's mesh on the channel buoys' pipeline), the quiet cue in and out of an anchorage (its
// hysteresis, the seamanship's state, the cockpit lamp's faint material), the boats at anchor (placed clear of the channel, every
// start and the Regatta courses; their swing to the wind; the soft bump) and their device policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { createSeamanship } from '../sim/seamanship.js';
import { steadyWind } from '../../src/sim/boat.js';
import { resolveMoorings, MOOR_V2, BALL_USE_M } from '../sim/moorings.js';
import { createMarkBodies, markPose } from '../sim/channelMarks.js';
import { anchorageCue, ballCue, CUE } from '../sim/anchorages.js';
import { createAnchoredBoats, ANCHORED_BOATS, ANCHORED, swingStep, swingRadius } from '../sim/anchoredBoats.js';
import { buildAidMeshes, AID_KINDS, AID_SPECS, RACE_KIND0, RACE_KINDS, MAX_AIDS } from '../render/navAids.js';
import { CHANNEL, channelAt } from '../terrain/channel.js';
import { courseFor, courseIds } from '../../src/sim/race/course.js';
import { racePoints } from '../regatta/geometry.js';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createCockpitRig, CUE_GLOW } from '../render/cockpit/rig.js';
import { parseCockpit } from '../render/cockpit/asset.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { birthplaceRows } from '../sim/regions.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MOORINGS = JSON.parse(readFileSync(resolve(ROOT, 'v2/sim/moorings.json'), 'utf8'));
const WATERS = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/tahoe-emerald.json'), 'utf8'));
const BIRTHPLACES = birthplaceRows(WATERS);   // the region table's birthplaces (v2/sim/regions.js)
const ANCH = JSON.parse(readFileSync(resolve(ROOT, 'v2/sim/anchorages.json'), 'utf8')).spots.map(([x, z, depth, shelter, name]) => ({ x, z, depth, shelter, name }));
let chartC = null;
const chart = () => (chartC ??= planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin'))))), chartInputs(JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8')))));

const steady = (ms, fromDeg) => ({ sample: (x, z, t) => steadyWind(ms, fromDeg)(x, z, t) });
const flat = waterFor(() => 0);
function boat({ depth = 8, heading = 90, speed = 0, balls = [], anchorages = [] } = {}) {
  const B = createBoatSim({ water: flat, heightAt: () => -depth, wind: steady(0.02 * KN, 0), start: { x: 0, z: 0, headingDeg: heading, speed } });
  const said = [];
  const sea = createSeamanship({ B, depthAt: () => depth, say: (id) => said.push(id), timeScale: 1, balls, M: MOOR_V2, anchorages });
  B.sea = sea;
  const run = (secs) => { for (let i = 0; i < Math.round(secs * 60); i++) B.step(1 / 60, { steer: 0, pull: 0 }); return B.state; };
  return { B, sea, said, run };
}

// ---- the mooring field ----
test('the Boat Camp field: 22 balls in two rows (odd shoreward, even lakeward), every one in 3.5 m of water or more and off the shore', () => {
  const balls = resolveMoorings(MOORINGS);
  assert.equal(balls.length, 22, 'the 1996 report\'s 22 buoys');
  const C = chart();
  for (const b of balls) {
    const d = C.depthAt(b.x, b.z), sh = C.shoreAt(b.x, b.z);
    assert.ok(d >= 3.5 && d <= 15, `${b.id} in ${d.toFixed(1)} m`);
    assert.ok(sh >= 30, `${b.id} ${sh.toFixed(0)} m off the shore`);
  }
  for (let i = 0; i < 22; i += 2) assert.ok(C.shoreAt(balls[i].x, balls[i].z) < C.shoreAt(balls[i + 1].x, balls[i + 1].z), `ball ${i + 1} (odd) shoreward of ${i + 2}`);
  // the camp's pier (v2/cruise/chartWorld.json: the pier at the camp) stands in a gap: a boat comes alongside it between the rows
  const W = JSON.parse(readFileSync(resolve(ROOT, 'v2/cruise/chartWorld.json'), 'utf8')).shoreline.piers.find((p) => Math.hypot(p.x - 342, p.z + 628) < 5);
  assert.ok(W, 'the Boat Camp pier is in the chart');
  for (const b of balls) { const ax = W.x, az = W.z, bx = ax + W.dirX * W.length, bz = az + W.dirZ * W.length, t = Math.max(0, Math.min(1, ((b.x - ax) * (bx - ax) + (b.z - az) * (bz - az)) / W.length ** 2)); assert.ok(Math.hypot(b.x - ax - t * (bx - ax), b.z - az - t * (bz - az)) >= 25, `${b.id} 25 m off the pier`); }
  for (let i = 0; i < 22; i++) for (let j = i + 1; j < 22; j++) assert.ok(Math.hypot(balls[i].x - balls[j].x, balls[i].z - balls[j].z) > 12, `balls ${i + 1} and ${j + 1} a swing apart`);
  // on the north shore, by the OSM camp (38.96016, -120.09656 → about (338, −666) on the lake's projection)
  const cx = balls.reduce((a, b) => a + b.x, 0) / 22, cz = balls.reduce((a, b) => a + b.z, 0) / 22;
  assert.ok(Math.hypot(cx - 338, cz - -666) < 200, `the field's middle (${cx.toFixed(0)}, ${cz.toFixed(0)}) off the camp`);
});

test('the mooring pickup: J beside a free ball picks it up (the tackle\'s ball, v2\'s reach), she lies to its pennant; J again lets it go', () => {
  const ball = { id: 'b1', x: 0, z: 0 };
  const { B, sea, said, run } = boat({ heading: 90, speed: 0, balls: [ball] });
  const bowX = sea.tackle.bow(B.state)[0] - B.state.x;
  // the ball 4.5 m ahead of the roller: past v1's 3 m reach, inside v2's 6
  ball.x = B.state.x + bowX + 4.5; ball.z = B.state.z;
  run(0.5);
  assert.ok(sea.cue.ball && sea.cue.on, 'the cue is on beside a free ball');
  assert.equal(sea.actions.anchor(), 'moored');
  assert.equal(sea.tackle.mode, 'moored');
  assert.equal(sea.tackle.state.anchor.phase === 'falling', false, 'no anchor went down');
  run(30);
  const d = Math.hypot(sea.tackle.bow(B.state)[0] - ball.x, sea.tackle.bow(B.state)[1] - ball.z);
  assert.ok(d < MOOR_V2.pennantM + 1.5, `she lies to the 4 m pennant: the bow ${d.toFixed(2)} m from the ball`);
  assert.ok(!sea.cue.on, 'no cue while she is made fast');
  assert.equal(sea.actions.anchor(), 'slipped');
  assert.equal(sea.tackle.mode, 'free');
  assert.equal(said.length, said.filter((x) => x !== 'deep').length, 'no depth refusal');
});

test('the mooring pickup refuses too fast (the skipper\'s ball line, no anchor) and never takes a ball with a boat on it', () => {
  const ball = { id: 'b1', x: 8, z: 0 };
  const { sea, said } = boat({ heading: 90, speed: 2.5, balls: [ball] });
  assert.ok(ball.x - sea.tackle.bow({ x: 0, z: 0, heading: Math.PI / 2 })[0] < BALL_USE_M);
  assert.equal(sea.actions.anchor(), 'ball');
  assert.ok(said.includes('ballFast'), said.join());
  assert.equal(sea.tackle.mode, 'free');
  const taken = { id: 'b2', x: 6, z: 0, boat: true };
  const t2 = boat({ heading: 90, speed: 0, balls: [taken] });
  assert.notEqual(t2.sea.actions.anchor(), 'moored', 'an occupied ball is not picked up');
});

test('the balls bob and swing back: a body on its short rode, posed on the drawn water', () => {
  const balls = resolveMoorings(MOORINGS), bodies = createMarkBodies(balls);
  assert.equal(bodies.bodies[0].r, 0.3); assert.equal(bodies.bodies[0].m, 45);
  const wave = (x, z, t) => 0.2 * Math.sin(0.5 * x + 1.3 * t);
  const p = markPose(bodies.bodies[0], wave, 1.0);
  assert.ok(Math.abs(p.y - wave(bodies.bodies[0].x, bodies.bodies[0].z, 1.0)) < 1e-9 && p.heel > 0, 'it rides and tilts with the water');
  const b = bodies.bodies[3]; b.x += 1.5;
  const far = { x: 1e5, z: 1e5, heading: 0, u: 0, v: 0, r: 0 };
  for (let i = 0; i < 60 * 30; i++) bodies.post(far, 1 / 60, i / 60);
  assert.ok(Math.hypot(b.x - b.x0, b.z - b.z0) < 0.05, 'back on its station after a shove');
});

test('the ball\'s mesh on the channel buoys\' pipeline: its own kind after the race marks (weathered as a buoy), the blue band above the water', () => {
  const M = buildAidMeshes();
  const k = AID_KINDS.indexOf('mooringBall');
  assert.ok(k >= RACE_KIND0 + RACE_KINDS, 'after the race kinds: not drawn as vinyl');
  assert.ok(MAX_AIDS >= 10 + 22 + 8, `room for the channel, the field and a race (${MAX_AIDS})`);
  const v = M.mooringBall, S = AID_SPECS.mooringBall;
  let band = 0, top = -9, white = 0;
  for (let i = 0; i < v.length; i += 7) { top = Math.max(top, v[i + 1]); if (v[i + 6] === 9) { band++; assert.ok(v[i + 1] > 0.05, 'the band is above the waterline'); } if (v[i + 6] === 0) white++; }
  assert.ok(band > 0 && white > band, 'a white ball with a blue band');
  assert.ok(Math.abs(top - (S.top + 0.045)) < 0.03, `the eye on top at ${top.toFixed(3)} m`);
  assert.ok(v.length / 7 / 3 < 2000, `cheap: ${v.length / 21} triangles`);
});

// ---- the cue ----
test('the anchorage cue: in at 120 m, out past 150 m (no flicker at the edge), the nearest spot; a free ball within 40 m, out past 60 m', () => {
  const s = ANCH.find((a) => a.name === 'Anchorage off Vikingsholm');
  assert.equal(anchorageCue(ANCH, s.x + 119, s.z, null), s);
  assert.equal(anchorageCue(ANCH, s.x + 135, s.z, null), null, 'not yet in at 135 m');
  assert.equal(anchorageCue(ANCH, s.x + 135, s.z, s), s, 'still in at 135 m once inside');
  assert.equal(anchorageCue(ANCH, s.x + 151, s.z, s), null, 'out past 150 m');
  assert.equal(anchorageCue(ANCH, 2300, -1400, null), null, 'the open lake off the mouth: none');
  assert.equal(ballCue(39, false), true); assert.equal(ballCue(50, false), false); assert.equal(ballCue(50, true), true); assert.equal(ballCue(61, true), false);
  assert.equal(ballCue(null, true), false);
  assert.deepEqual([CUE.inM, CUE.outM], [120, 150]);
});

test('the seamanship\'s cue: on while she sails inside a charted anchorage, off outside it and once the anchor is down', () => {
  const spot = { x: 0, z: -60, depth: 8, name: 'Test anchorage' };
  const { sea, run } = boat({ heading: 90, anchorages: [spot] });
  run(0.2);
  assert.equal(sea.cue.spot, spot); assert.ok(sea.cue.on);
  sea.setAnchorages([{ ...spot, z: -400 }]);
  run(0.2);
  assert.equal(sea.cue.on, false, 'outside every anchorage');
  sea.setAnchorages([spot]); run(0.2); assert.ok(sea.cue.on);
  assert.equal(sea.actions.anchor(), 'drop');
  run(1);
  assert.equal(sea.cue.on, false, 'the anchor is going down: the toggle is lit, the cue is quiet');
});

test('the cockpit lamp: ANCHOR\'s LED wears a faint copy of amberOn while the cue is on and the toggle off; the lit lamp wins', async () => {
  const a = await parseCockpit(gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/cockpit/desktop.ckb.gz'))));
  const rig = createCockpitRig(a.json, { coverFrames: a.coverFrames });
  const R = a.json.roles, led = R.toggles.anchor.led, mesh = a.json.meshes.findIndex((m) => m.node === led);
  assert.ok(R.amberFaint != null && a.json.materials.length - 1 === R.amberFaint, 'the faint material appended once');
  createCockpitRig(a.json, { coverFrames: a.coverFrames });
  assert.equal(a.json.materials.length - 1, R.amberFaint, 'a second rig on the same asset adds none');
  const base = { toggles: { sails: true, anchor: false, reef: 1 / 3 }, night: 0, exposure: 1 };
  rig.set(base, 0); assert.equal(rig.matOf[mesh], R.ledOff);
  rig.set({ ...base, cue: { anchor: true } }, 0.016); assert.equal(rig.matOf[mesh], R.amberFaint, 'faint');
  const S = rig.matState;
  assert.ok(Math.abs(S[R.amberFaint].emissive - S[R.amberOn].emissive * CUE_GLOW) < 1e-6, 'its glow a share of the lit lamp\'s');
  rig.set({ ...base, toggles: { ...base.toggles, anchor: true }, cue: { anchor: true } }, 0.016); assert.equal(rig.matOf[mesh], R.amberOn, 'lit wins');
  rig.set(base, 0.016); assert.equal(rig.matOf[mesh], R.ledOff, 'off again');
});

// ---- the boats at anchor ----
const depthAt = (x, z) => chart().depthAt(x, z);
const ballsAll = () => createMarkBodies(resolveMoorings(MOORINGS)).bodies;

test('the boats at anchor: one or two in each of the bay\'s anchorages and one on a Boat Camp ball, each in good water through her swing', () => {
  const AB = createAnchoredBoats(ANCHORED_BOATS, { depthAt, balls: ballsAll() });
  assert.equal(AB.boats.length, ANCHORED_BOATS.length);
  const bay = ANCH.filter((a) => Math.hypot(a.x, a.z) < 2000);   // the bay's two charted anchorages
  for (const a of bay) { const n = AB.boats.filter((b) => Math.hypot(b.ax - a.x, b.az - a.z) < 200).length; assert.ok(n >= 1 && n <= 2, `${a.name}: ${n} boats`); }
  for (const b of AB.boats) {
    if (b.ball) { assert.ok(b.ball.boat, `${b.id}: her ball is taken`); continue; }
    assert.ok(b.depth >= 4 && b.depth <= 18.3, `${b.id}: the anchor in ${b.depth.toFixed(1)} m (inside the 60 ft contour)`);
    for (let k = 0; k < 24; k++) { const a = k * Math.PI / 12; for (const rr of [b.r - 5, b.r + 5]) { const d = depthAt(b.ax + Math.sin(a) * rr, b.az - Math.cos(a) * rr); assert.ok(d >= 2.6, `${b.id}: ${d.toFixed(1)} m on her swing at ${(a * 180 / Math.PI).toFixed(0)}°`); } }
  }
});

test('the boats at anchor stand clear of the channel, every birthplace\'s start and the Sail start, the Regatta courses and the moorings', () => {
  const AB = createAnchoredBoats(ANCHORED_BOATS, { depthAt, balls: ballsAll() }), K = ANCHORED.clear, reach = (b) => b.r + 5;   // her swing circle and half a length
  const starts = [...BIRTHPLACES.map((r) => ({ id: r.id, x: r.x, z: r.z })), { id: 'start', x: WATERS.start.x, z: WATERS.start.z }];
  const courses = courseIds('tahoe-emerald').map((id) => { const c = courseFor('tahoe-emerald', id), up = [Math.sin(c.designWindFrom * Math.PI / 180), -Math.cos(c.designWindFrom * Math.PI / 180)]; return { id, pts: racePoints(c.lineSpec, c.marks.map((m) => ({ id: m.id, at: m.at })), c.legSpec.map((l) => l.to), up) }; });
  const moor = resolveMoorings(MOORINGS);
  for (const b of AB.boats) {
    const ch = channelAt(b.ax, b.az, CHANNEL);
    assert.ok(ch.d - reach(b) >= K.channelM, `${b.id}: ${(ch.d - reach(b)).toFixed(0)} m from the channel`);
    for (const s of starts) assert.ok(Math.hypot(s.x - b.ax, s.z - b.az) - reach(b) >= K.startM, `${b.id}: ${(Math.hypot(s.x - b.ax, s.z - b.az) - reach(b)).toFixed(0)} m from the ${s.id} start`);
    for (const c of courses) for (const p of c.pts) assert.ok(Math.hypot(p[0] - b.ax, p[1] - b.az) - reach(b) >= K.courseM, `${b.id}: ${(Math.hypot(p[0] - b.ax, p[1] - b.az) - reach(b)).toFixed(0)} m from ${c.id}`);
    if (!b.ball) for (const m of moor) assert.ok(Math.hypot(m.x - b.ax, m.z - b.az) - reach(b) >= K.mooringM, `${b.id}: clear of ${m.id}`);
  }
  // the mooring field itself stays off the courses' marks and line
  for (const c of courses) for (const p of c.pts) for (const m of moor) assert.ok(Math.hypot(p[0] - m.x, p[1] - m.z) >= 40, `${m.id} 40 m off ${c.id}`);
});

test('the swing: she lies downwind of her anchor, bow to the wind, sheering a little; a 90° shift brings her round in a couple of minutes', () => {
  const row = { id: 't', at: [0, 0], phase: 0.3 }, st = { theta: null };
  swingStep(st, row, 0, 0, 270);   // a west wind: she lies east of the anchor, her bow west
  const deg = (a) => ((a * 180 / Math.PI) % 360 + 360) % 360, off = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);
  assert.ok(off(deg(st.theta), 90) <= ANCHORED.sheerDeg + 0.01, `bearing ${deg(st.theta).toFixed(1)}°`);
  assert.ok(off(deg(st.heading), 270) <= ANCHORED.sheerDeg + ANCHORED.yawDeg + 0.01, `heading ${deg(st.heading).toFixed(1)}°`);
  let lo = 999, hi = -999;
  for (let i = 0; i < 60 * 200; i++) { swingStep(st, row, 1 / 60, i / 60, 270); const b = ((deg(st.theta) - 90 + 540) % 360) - 180; lo = Math.min(lo, b); hi = Math.max(hi, b); }
  assert.ok(hi - lo > 8 && hi - lo < 2 * ANCHORED.sheerDeg + 1, `the sheer swings her ${lo.toFixed(1)}° to ${hi.toFixed(1)}°`);
  let t = 200, settled = null;
  for (let i = 0; i < 60 * 240; i++) { t += 1 / 60; swingStep(st, row, 1 / 60, t, 0); if (settled == null && off(deg(st.theta), 180) < ANCHORED.sheerDeg + 3) settled = t - 200; }
  assert.ok(settled != null && settled > 20 && settled < 150, `lies to the north wind after ${settled?.toFixed(0)} s (no snap)`);
  assert.ok(off(deg(st.heading), 0) < ANCHORED.sheerDeg + ANCHORED.yawDeg + 3, 'bow to the new wind');
  assert.equal(swingRadius({ ball: 'x' }, 9), ANCHORED.ballR);
  assert.ok(swingRadius({}, 10) > 20 && swingRadius({}, 100) === ANCHORED.maxR);
});

test('the boats at anchor in the boat\'s tick: swung by the wind, deterministic, a soft bump that shoves her a little and lets go; none in a race', () => {
  const mk = () => createAnchoredBoats(ANCHORED_BOATS, { depthAt, balls: ballsAll() });
  const A1 = mk(), A2 = mk(), far = { x: 1e5, z: 1e5, heading: 0, u: 0, v: 0, r: 0 };
  for (let i = 0; i < 600; i++) { A1.post(far, 1 / 60, i / 60, () => 225); A2.post(far, 1 / 60, i / 60, () => 225); }
  assert.deepEqual(A1.boats.map((b) => [b.x, b.z, b.heading]), A2.boats.map((b) => [b.x, b.z, b.heading]), 'deterministic');
  const b0 = A1.boats[0];
  const brg = Math.atan2(b0.x - b0.ax, -(b0.z - b0.az)) * 180 / Math.PI;
  assert.ok(Math.abs(((brg - 45) % 360 + 540) % 360 - 180) <= ANCHORED.sheerDeg + 1, `downwind of the anchor in a SW wind (${brg.toFixed(0)}°)`);
  // the player's boat driven into her side at 1 m/s
  const sim = createBoatSim({ water: flat, heightAt: () => -10, wind: steady(0.02 * KN, 0), start: { x: b0.x - 12 * Math.cos(b0.heading), z: b0.z - 12 * Math.sin(b0.heading), headingDeg: (b0.heading * 180 / Math.PI + 90) % 360, speed: 1 } });
  let bumped = 0, maxOff = 0;
  const AB = createAnchoredBoats(ANCHORED_BOATS, { depthAt, balls: ballsAll(), onBump: () => bumped++ });
  for (let i = 0; i < 600; i++) AB.post(far, 1 / 60, i / 60, () => 225);
  const b = AB.boats[0];
  for (let i = 0; i < 60 * 25; i++) {   // she is driven at 1 m/s for 12 s (her velocity and place: the contact reads both), then left
    const S = sim.state, go = i < 60 * 12;
    if (go) { S.u = 1; S.v = 0; S.r = 0; S.x += Math.sin(S.heading) / 60; S.z -= Math.cos(S.heading) / 60; } else { S.u = 0; S.v = 0; S.r = 0; }
    AB.post(S, 1 / 60, 10 + i / 60, () => 225); maxOff = Math.max(maxOff, Math.hypot(b.ox, b.oz));
  }
  assert.ok(bumped >= 1, 'a bump');
  assert.ok(maxOff > 0.05 && maxOff <= ANCHORED.rode.maxOff + 1e-6, `she gives ${maxOff.toFixed(2)} m, no more`);
  AB.active = false;
  assert.equal(AB.near([b.x, 0, b.z]).length, 0, 'a race: none drawn');
  assert.equal(AB.lights(new Float32Array(64), 0, { sunElevDeg: -20 }), 0, 'a race: no riding lights');
  AB.active = true;
  const out = new Float32Array(64);
  assert.equal(AB.lights(out, 0, { sunElevDeg: 30 }), 0, 'by day: none');
  const n = AB.lights(out, 0, { sunElevDeg: -20, mastHead: [0, 13, 0.4] });
  assert.equal(n, Math.min(AB.boats.length, 8));
  assert.ok(out[1] > 12 && out[4] === 1 && out[7] > 0, 'white, on the masthead');
  assert.ok(out[3] < 0 && Math.abs(Math.abs(out[3]) - ANCHORED.light.size) < 1e-6, 'a far point light (negative size: small and faint past FAR_POINT.nearM, render/night.js)');
});

// the policy: a desktop and a tablet draw them, a phone never (src/core/features.js anchoredBoats)
const fakeProfile = (win) => ({ get: () => profileOf(readFacts(win), forcedOf(win.location?.search ?? ''), { gpu: 1 }), on: () => () => {} });
const tierOn = (dev, flags = {}, headless = false) => createFeatures({ profile: fakeProfile({ ...DEVICES[dev], location: { search: '' } }), doc: null }).configure({ headless, flags }).feature('anchoredBoats');
test('device policy: boats at anchor on a desktop and a tablet, none on a phone; ?anchored= overrides', () => {
  assert.equal(tierOn('desktop').tier, 'on'); assert.equal(tierOn('ipadTrackpad').tier, 'on'); assert.equal(tierOn('iphoneTurned').tier, 'off');
  assert.equal(tierOn('desktop', { anchored: '0' }).tier, 'off'); assert.equal(tierOn('iphoneTurned', { anchored: '1' }).tier, 'on');
  assert.equal(tierOn('desktop', {}, true).tier, 'on', 'a capture draws them');
});
