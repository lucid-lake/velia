// feat/instruments: the bulkhead's heel meter, barometer and clock (src/boat/bulkhead.js) and the flags on shore
// (src/shoreFlags.js). Plain JS parts only; the three.js side is checked by the captures (renders/instr/).
// Run: node --test tests/instruments-shore.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HeelPendulum, pressureHPa, clockHands, baroAngle, BULKHEAD, faceZ } from '../classic/src/boat/bulkhead.js';
import { flagSites, flagFlight, flagVertex, flagShape, SHORE_FLAGS as FLAGS } from '../classic/src/shoreFlags.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { WindField } from '../src/sim/wind.js';
import { layoutShoreline } from '../src/shoreline-layout.js';
import { harbourLayout } from '../src/harbour-layout.js';
import { BoatPhysics, CONTROLS } from '../src/sim/boat.js';

const DEG = Math.PI / 180;
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b} (± ${tol})`);

test('the heel meter settles on the boat\'s heel, both sides, and swings through a roll', () => {
  for (const deg of [0, 7.5, -12, 22, -31]) {
    const p = new HeelPendulum(); p.step(0, 0);
    for (let i = 0; i < 300; i++) p.step(deg * DEG, 1 / 60);   // 5 s
    near(p.a / DEG, deg, 0.05, `steady heel ${deg}°`);
  }
  // a step from 0 to 20°: overshoots a little (a damped pendulum), never past the card's stop, settles inside 3 s
  const p = new HeelPendulum(); p.step(0, 0);
  let peak = 0, settled = null;
  for (let i = 1; i <= 360; i++) { const a = p.step(20 * DEG, 1 / 60) / DEG; peak = Math.max(peak, a); if (settled == null && i > 30 && Math.abs(a - 20) < 0.5) settled = i / 60; }
  assert.ok(peak > 20.5 && peak < 23.5, `overshoot to ${peak.toFixed(2)}°`);
  assert.ok(settled != null && settled < 3, `settled at ${settled} s`);
  // the stop at 45°
  const q = new HeelPendulum(); q.step(0, 0); for (let i = 0; i < 120; i++) q.step(80 * DEG, 1 / 60);
  assert.ok(q.a <= BULKHEAD.pendulum.maxDeg * DEG + 1e-9);
});

test('the heel meter reads the physics: a boat sailing heeled shows its phys.state.heel', () => {
  const phys = new BoatPhysics({ x: 1200, z: -1050, heading: 251 * DEG, speed: 2.75 });
  const wind = new WindField({ seed: 1, base: { dirDeg: 200, speedMs: 8 } });
  const env = (t) => ({ t, windAt: (x, z, tt) => wind.sample(x, z, tt) });
  const p = new HeelPendulum();
  for (let i = 0; i < 60 * 20; i++) { phys.step(1 / 60, { ...CONTROLS, rudder: 0, sheet: 14 * DEG }, env(i / 60)); p.step(phys.state.heel, 1 / 60); }
  assert.ok(Math.abs(phys.state.heel) > 3 * DEG, `the boat heels (${(phys.state.heel / DEG).toFixed(1)}°)`);
  near(p.a / DEG, phys.state.heel / DEG, 1.0, 'the needle on the heel');
});

test('the clock reads the scene hour (PDT)', () => {
  const h = clockHands(18.75);                         // 18:45
  near(h.hour / DEG, (6.75 / 12) * 360, 1e-9, 'hour hand');
  near(h.minute / DEG, 270, 1e-9, 'minute hand');
  const n = clockHands(12); near(n.hour, 0, 1e-9, 'noon'); near(n.minute, 0, 1e-9, 'noon');
  near(clockHands(6.5).minute / DEG, 180, 1e-9, '06:30');
});

test('the barometer: ≈ 811 hPa at 1,898 m, a slow drift, falling before an advisory day', () => {
  for (let h = 0; h < 24; h += 0.25) {
    const p = pressureHPa(h);
    assert.ok(p > 804 && p < 816, `${p} at ${h}`);
    assert.ok(Math.abs(pressureHPa(h + 1 / 60) - p) < 0.05, 'no jumps (≤ 0.05 hPa a minute)');
  }
  const fall = pressureHPa(12, { advisory: true }) - pressureHPa(4, { advisory: true });
  const calm = pressureHPa(12) - pressureHPa(4);
  assert.ok(fall < calm - 3.5, `advisory falls ${fall.toFixed(2)} hPa (a calm day ${calm.toFixed(2)})`);
  near(baroAngle(810), 0, 1e-9, '810 at the top');
  near(baroAngle(BULKHEAD.dial.lo) / DEG, -135, 1e-9, 'lo'); near(baroAngle(900) / DEG, 135, 1e-9, 'clamped');
});

test('the bulkhead props sit on the companionway face, clear of the opening', () => {
  for (const k of ['heel', 'clock', 'baro']) {
    const s = BULKHEAD[k], half = (s.w ?? 2 * s.r) / 2 + 0.01;
    assert.ok(Math.abs(s.x) - half > 0.19, `${k} clear of the ± 0.19 m opening`);
    assert.ok(Math.abs(s.x) + half < 0.62, `${k} inside the well's forward wall`);
    near(faceZ(s.y), 1.40 - 0.185 * (s.y - 0.48) + 0.012, 1e-9, `${k} on the face`);
  }
});

const terrain = makeTerrain({ seed: 1 });
const sites = flagSites({ terrain, harbour: harbourLayout({ terrain, seed: 1 }), shore: layoutShoreline(terrain, { seed: 1 }) });

test('flag sites: the stone house lawn, a bay pier, the yacht club, the harbour pier; on land or a deck', () => {
  const names = sites.map((s) => s.name);
  for (const n of ['stone-house-lawn', 'camp-pier', 'club-lawn', 'harbour-pier']) assert.ok(names.includes(n), `${n} in ${names}`);
  const lawn = sites.find((s) => s.name === 'stone-house-lawn');
  assert.ok(Math.hypot(lawn.x + 549, lawn.z - 217) < 50, 'near the stone house');
  assert.ok(Math.hypot(lawn.x + 547, lawn.z - 218) > 25, 'clear of the house (30 × 11 m)');
  assert.ok(terrain.heightAt(lawn.x, lawn.z) > 1 && terrain.shoreDistance(lawn.x, lawn.z) > 5, 'on the lawn, not the beach or the water');
  for (const s of sites) {
    if (s.name.endsWith('-pier')) assert.ok(terrain.heightAt(s.x, s.z) < 0, `${s.name} over water (a pier head)`);
    else assert.ok(terrain.heightAt(s.x, s.z) > 0.5, `${s.name} on land`);
    assert.ok(s.h >= 4 && s.h <= 10 && s.L <= 3 && s.H <= 2, `${s.name}: a plain pole and a modest cloth`);
  }
  assert.deepEqual(flagSites({ terrain, harbour: harbourLayout({ terrain, seed: 1 }), shore: layoutShoreline(terrain, { seed: 1 }) }), sites, 'deterministic');
});

test('each flag flies downwind of the wind sampled at its own pole', () => {
  const wind = new WindField({ seed: 1, day: { hour: 18.75, rate: 1 }, shifts: true });
  wind.setTerrain(terrain.heightAt);
  for (const t of [0, 90, 400]) for (const s of sites) {
    const w = wind.sample(s.x, s.z, t), fl = flagFlight(w, s.L);
    // the fly's horizontal direction is the wind's own (toward), so the flag points away from where it blows FROM
    const flyDeg = Math.atan2(fl.fx, -fl.fz) / DEG, fromDeg = (w.dirDeg + 180) % 360;
    const d = ((flyDeg - fromDeg + 540) % 360) - 180;
    near(d, 0, 0.01, `${s.name} at t ${t}: fly ${flyDeg.toFixed(1)}° vs downwind ${fromDeg.toFixed(1)}°`);
    // and the drawn cloth's tip is downwind of the hoist
    const hoist = flagVertex(s, fl, 0, 0.5, t), tip = flagVertex(s, fl, 1, 0.5, t);
    const dx = tip[0] - hoist[0], dz = tip[2] - hoist[2], along = (dx * w.vx + dz * w.vz) / w.speed;
    assert.ok(along > 0, `${s.name}: the tip lies downwind (${along.toFixed(2)} m)`);
  }
  // the sites see different winds (local, not one global vector)
  const dirs = sites.map((s) => wind.sample(s.x, s.z, 0).dirDeg);
  assert.ok(Math.max(...dirs) - Math.min(...dirs) > 2, `local directions differ: ${dirs.map((d) => d.toFixed(1))}`);
});

test('the flutter scales with the speed: limp in a calm, streaming level and flapping faster in a breeze', () => {
  const calm = flagFlight({ vx: 0.3, vz: 0, speed: 0.3 }, 2), light = flagFlight({ vx: 2, vz: 0, speed: 2 }, 2), fresh = flagFlight({ vx: 8, vz: 0, speed: 8 }, 2);
  assert.ok(calm.droop > 70 * DEG && fresh.droop < 6 * DEG, `droop ${calm.droop / DEG}° calm, ${fresh.droop / DEG}° fresh`);
  assert.ok(calm.droop > light.droop && light.droop > fresh.droop, 'the droop falls with the speed');
  assert.ok(calm.amp < light.amp && light.amp <= fresh.amp + 1e-9, 'the flap grows with the speed');
  assert.ok(calm.freq < light.freq && light.freq < fresh.freq, 'and quickens');
  // shapes: a pennant tapers to a point, a rectangle keeps its depth
  const pen = { L: 3, H: 1.3, shape: 'pennant' }, rect = { L: 1.8, H: 1.2, shape: 'flag' };
  assert.ok(flagShape(pen, 1, 1)[1] - flagShape(pen, 1, 0)[1] < 0.05, 'the pennant\'s point');
  near(flagShape(rect, 1, 1)[1] - flagShape(rect, 1, 0)[1], 1.2, 1e-9, 'the flag\'s fly');
  assert.ok(FLAGS.segU * FLAGS.segV <= 16, 'cheap cloth');
});
