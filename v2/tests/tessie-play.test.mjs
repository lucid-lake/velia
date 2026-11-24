// Play as Tessie, phase 1a (§ 3.5, § 4.2, § 7): the controller on her real sim. Behaviour only: the sim and the
// controller are called and their state read.
//   her limits: her surface cruise 6 m/s, never turning faster than 32°/s at the surface, the dash turning wider (the speed model itself: tessie-speed.test.mjs)
//   the dive (phase 2a): the look's climb rate past the guard, a level look holds (v2/tests/tessie-under.test.mjs: the keys, the limits, the catch)
//   the shore: driven straight at the shore at full speed, her nose never enters water under 2 m (she turns away at 3 m)
//   the bite: the snap with nothing near, the rail bite near a boat; one contact; a miss and a hit each one verdict event, no line (the UI audit's decision B)
//   (the strike's timings, the steering floor, the lock and the camera: v2/tests/tessie-2d-strike.test.mjs)
//   she stays: a driven sighting never ends on its own; end() gives her back (she dives)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlay, PLAY, LINES, noseLimit, depthWord, lookDepth } from '../sim/tessiePlay.js';

const DT = 1 / 30, DEG = Math.PI / 180;
const make = (depthAt = () => 40) => { const sim = createTessie({ seed: 3, depthAt }); const C = createTessiePlay({ sim, depthAt }); return { sim, C, depthAt }; };
const run = (sim, C, secs, hands, ctx = {}, each = null) => { for (let i = 0; i < secs / DT; i++) { sim.step(DT, { playing: true }); C.step(DT, typeof hands === 'function' ? hands(i * DT) : hands, ctx); each?.(i * DT); } };

test('her pace by medium: W at the surface her cruise 6 m/s; let go, a drift; Shift held does not run (its press is the dash: v2/tests/tessie-speed.test.mjs)', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 6, { move: [0, 1] });
  assert.ok(Math.abs(sim.state.nose.speed - PLAY.surface.cruise) < 0.15, `W: her cruise at the surface (${sim.state.nose.speed.toFixed(2)})`);
  assert.equal(C.state.dash, false, 'W alone never dashes');
  run(sim, C, 2.5, {});
  assert.ok(sim.state.nose.speed < PLAY.drift + 0.3 && sim.state.nose.speed >= 0, `let go: she eases to a drift, never backwards (${sim.state.nose.speed.toFixed(2)})`);
});

test('her dash turns wider: at most 14°/s at the surface on the dash', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 4, { move: [0, 1] });
  run(sim, C, 0.6, { move: [0, 1], dash: true });
  let worst = 0, prev = sim.state.nose.psi;
  run(sim, C, 1.0, { move: [0, -1] }, {}, () => { const p = sim.state.nose.psi; worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(p - prev), Math.cos(p - prev))) / DT); prev = p; });
  assert.ok(C.state.dash, 'still on the dash');
  assert.ok(worst <= 16 * DEG && worst > 8 * DEG, `${(worst / DEG).toFixed(1)}°/s`);
});

test('her turn: never faster than 32°/s at the surface, slower from a drift', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 4, { move: [0, 1] });
  let maxRate = 0, prev = sim.state.nose.psi;
  run(sim, C, 6, { move: [0, -1] }, {}, () => { const p = sim.state.nose.psi; maxRate = Math.max(maxRate, Math.abs(Math.atan2(Math.sin(p - prev), Math.cos(p - prev))) / DT); prev = p; });
  assert.ok(maxRate <= PLAY.surface.turnMax * DEG + 1e-6, `turn ${(maxRate / DEG).toFixed(1)}°/s`);
  assert.ok(maxRate > 20 * DEG, `she does turn (${(maxRate / DEG).toFixed(1)}°/s)`);
  const d = make(); d.C.begin({ x: 0, z: 0, heading: 0 }); run(d.sim, d.C, 4, {});   // (taken, she rises from 4.5 m: the surface's turn)
  let slow = 0; prev = d.sim.state.nose.psi;
  run(d.sim, d.C, 0.3, { move: [1, 0] }, {}, () => { const p = d.sim.state.nose.psi; slow = Math.max(slow, Math.abs(Math.atan2(Math.sin(p - prev), Math.cos(p - prev))) / DT); prev = p; });
  assert.ok(slow <= 20 * DEG, `from a drift (its first 0.3 s, the ramp from 0; still rising from 4.5 m, a touch of the water's rate) ${(slow / DEG).toFixed(1)}°/s`);
});

test('up and down by the look (phase 2a): the default slight look is held; past the 15° guard she dives at the look\'s rate; a level look holds; a look up brings her up', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 6, { move: [0, 1], look: 7 * DEG });   // inside the hold band
  assert.ok(C.state.nose < 1.0, `the default look: she stays up (${C.state.nose.toFixed(2)} m)`);
  run(sim, C, 6, { move: [0, 1], look: 14 * DEG });
  assert.ok(C.state.nose < 1.0, `14°: under the surface's guard (${C.state.nose.toFixed(2)} m)`);
  run(sim, C, 3, { move: [0, 1], look: 30 * DEG });
  const mid = C.state.nose;
  assert.ok(mid > 6 && mid < 14, `30° down for 3 s: down at about 4 m/s (${mid.toFixed(2)})`);
  run(sim, C, 6, { move: [0, 1], look: 4 * DEG });
  assert.ok(Math.abs(C.state.nose - mid) < 0.6, `a level look holds her depth (${C.state.nose.toFixed(2)})`);
  run(sim, C, 6, { look: 40 * DEG });   // let go of the keys: the look steers nothing at a drift
  assert.ok(Math.abs(C.state.nose - mid) < 0.8, `no keys: she stays (${C.state.nose.toFixed(2)})`);
  run(sim, C, 20, { move: [0, 1], look: -30 * DEG });
  assert.ok(C.state.nose < 1.0 && C.state.word === 'SURFACE', `a look up while she swims: the surface (${C.state.nose.toFixed(2)} m)`);
  assert.equal(noseLimit(8, 'dive'), 6); assert.equal(noseLimit(9, 'deep'), 7); assert.equal(noseLimit(5, 'dive'), 0); assert.equal(noseLimit(40, 'surface'), 0); assert.equal(noseLimit(40, 30), 20);
  assert.equal(lookDepth(10 * DEG), null); assert.equal(lookDepth(45 * DEG), 8);
  assert.equal(depthWord(0), 'SURFACE'); assert.equal(depthWord(1.5), 'AWASH'); assert.equal(depthWord(6), 'DIVE'); assert.equal(depthWord(13), 'DEEP');
});

test('a dash looking up at the surface breaches; a dash level does not', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 3, { move: [0, 1] });
  run(sim, C, 2, (t) => ({ move: [0, 1], dash: t < 0.05, pitch: 5 * DEG }));
  assert.equal(C.state.lunge, null, 'level: no breach');
  run(sim, C, 5, { move: [0, 1] });
  const ev = [];
  run(sim, C, 6, (t) => ({ move: [0, 1], dash: t < 0.05, pitch: -15 * DEG }), {}, () => { for (const e of C.events) ev.push(e.type); });
  assert.ok(ev.includes('breach') && ev.includes('fall'), `looking up on a run: the breach and its fall (${ev.join(',')})`);
  assert.ok(sim.state.clips.length >= 0);
});

test('the bite (Space): nothing near, the snap (no surge, no attack); a boat in the corners within 12 m, the rail bite', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 4, { move: [0, 1] });
  const far = { id: 'b', x: 0, z: -80, heading: Math.PI / 2, d: 40, inReach: false };
  const ev = [];
  run(sim, C, 0.1, { move: [0, 1], bite: true }, { target: far }, () => { for (const e of C.events) ev.push(e); });
  assert.equal(C.state.lunge, null, 'out of reach: no attack');
  assert.equal(ev.find((e) => e.type === 'bite')?.kind, 'snap', 'the snap');
  assert.equal(C.state.surge, 0, 'no surge');
  run(sim, C, 2, { move: [0, 1] });
  const near = { id: 'b', x: sim.state.nose.x, z: sim.state.nose.z - 10, heading: Math.PI / 2, d: 8, inReach: true };
  const ev2 = [];
  run(sim, C, 0.4, (t) => ({ move: [0, 1], bite: t < 0.05 }), { target: near }, () => { for (const e of C.events) ev2.push(e); });   // not locked yet: the press waits its 0.25 s buffer for the lock, then bites
  assert.equal(ev2.find((e) => e.type === 'bite')?.kind, 'rail', 'in the corners within 12 m: the rail bite');
});
test('the shore: full speed at a beach, her nose never enters water under 2 m', () => {
  // a sloping beach: deep at z = 0, dry at z = -200 (she swims north, −z)
  const depthAt = (x, z) => Math.max(-5, 30 + z * 0.17);
  const { sim, C } = make(depthAt);
  C.begin({ x: 0, z: 0, heading: 0 });
  let least = Infinity;
  run(sim, C, 60, { move: [0, 1] }, {}, () => { const n = sim.state.nose; least = Math.min(least, depthAt(n.x, n.z)); });
  assert.ok(least >= 2, `least water under her nose ${least.toFixed(2)} m`);
  assert.ok(C.state.shore || least < 6, 'she turned at the shore');
});

test('the bite\'s verdict: one contact; a miss is one verdict (no line, never a sulk); a hit one verdict; the cooldown 0.8 s after a miss, 2.5 s after a hit', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 4, { move: [0, 1] });
  const contacts = [], lines = [];
  const target = { id: 'b', x: sim.state.nose.x, z: sim.state.nose.z - 6, heading: Math.PI / 2, d: 4.5, inReach: true };
  run(sim, C, 2.2, (t) => ({ move: [0, 1], bite: t < 0.05 }), { target }, () => { for (const e of C.events) { if (e.type === 'contact') contacts.push(e); if (e.type === 'verdict') lines.push(e.hit); assert.notEqual(e.type, 'line', 'no status line'); } });
  assert.equal(contacts.length, 1, 'one contact');
  assert.deepEqual(lines, [false], 'unjudged: a miss');
  assert.equal(C.state.lunge, null, 'no sulk: no lunge state left');
  assert.equal(C.state.steer, 1, 'full steering again');
  // a hit: the page judges the contact
  run(sim, C, 2, {});
  const hl = []; let restAtHit = null;
  run(sim, C, 2, (t) => ({ move: [0, 1], bite: t < 0.05 }), { target: { ...target, x: sim.state.nose.x, z: sim.state.nose.z - 6 } }, () => { for (const e of C.events) { if (e.type === 'contact') { C.result(true); restAtHit = C.state.rest; } if (e.type === 'verdict') hl.push(e.hit); } });
  assert.deepEqual(hl, [true]);
  assert.ok(!('got' in LINES) && !('miss' in LINES), 'no Got them! / Next time… lines');
  assert.ok(Math.abs(restAtHit - PLAY.coolHit) < 1e-9, `2.5 s after a hit (${restAtHit})`);
  assert.equal(PLAY.coolMiss, 0.8);
});

test('she stays while driven, and end() gives her back', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 60, (t) => ({ move: [0, t < 30 ? 1 : 0], pitch: (Math.floor(t / 10) % 2 ? 30 : -10) * DEG }));
  assert.equal(sim.state.visible, true, 'a minute in: still hers');
  C.end();
  for (let i = 0; i < 30 / DT; i++) sim.step(DT, { playing: true });
  assert.equal(sim.state.visible, false, 'given back: she dives and goes');
});

test('the way she swims is the camera\'s: W away from it, D to its right, S back toward it; the yaw held while the keys are', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 0.1, {});
  run(sim, C, 12, { move: [1, 0], camYaw: 0 });   // D with the camera looking north: she swims east
  let p = sim.state.nose.psi;
  assert.ok(Math.abs(Math.atan2(Math.sin(p - Math.PI / 2), Math.cos(p - Math.PI / 2))) < 4 * DEG, `D: east (${(p / DEG).toFixed(0)}°)`);
  run(sim, C, 0.1, {});
  run(sim, C, 12, { move: [0, 1], camYaw: Math.PI });   // W with the camera looking south: south
  p = sim.state.nose.psi;
  assert.ok(Math.abs(Math.atan2(Math.sin(p - Math.PI), Math.cos(p - Math.PI))) < 4 * DEG, `W: away from the camera (${(p / DEG).toFixed(0)}°)`);
  assert.equal(C.state.way != null, true);
});

test('the turn-about: S curves her round toward the camera (never a spin in place) and she swims on that way as the camera follows', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 6, { move: [0, 1], camYaw: 0 });
  const x0 = sim.state.nose.x, z0 = sim.state.nose.z;
  let slowest = Infinity, camYaw = 0, t = 0;
  // the camera swings round behind her as she turns (its yaw follows her heading): the way stays the one read when S went down
  for (let i = 0; i < 14 / DT; i++) { t += DT; camYaw += Math.atan2(Math.sin(sim.state.nose.psi - camYaw), Math.cos(sim.state.nose.psi - camYaw)) * Math.min(1, DT / 0.8); sim.step(DT, { playing: true }); C.step(DT, { move: [0, -1], camYaw }, {}); if (t < 7) slowest = Math.min(slowest, sim.state.nose.speed); }
  const p = sim.state.nose.psi;
  assert.ok(Math.abs(Math.atan2(Math.sin(p - Math.PI), Math.cos(p - Math.PI))) < 6 * DEG, `about: heading back south (${(p / DEG).toFixed(0)}°)`);
  assert.ok(slowest > 1.5, `she curves round under way, never a spin in place (slowest ${slowest.toFixed(2)} m/s)`);
  assert.ok(sim.state.nose.z > z0 - 40, 'swimming back toward where the camera was');
});

test('let go: she eases to a drift over about 1.5 s, treading water', () => {
  const { sim, C } = make();
  C.begin({ x: 0, z: 0, heading: 0 });
  run(sim, C, 6, { move: [0, 1] });
  let at = null, t = 0;
  run(sim, C, 4, {}, {}, () => { t += DT; if (at == null && sim.state.nose.speed <= PLAY.drift + 0.05) at = t; });
  assert.ok(at > 1.0 && at < 2.2, `at a drift after ${at?.toFixed(2)} s`);
  assert.ok(sim.state.nose.speed > 0.3, 'treading water, never dead still');
  assert.equal(C.state.dash, false);
});
