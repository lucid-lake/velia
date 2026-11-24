// node --test tests/discoveries.test.mjs — the logbook's trigger rules (src/sail/discoveries.js) on scripted
// state streams, positives and negatives, and one on the real physics: the default start sails into the first gust.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTerrain, LAKE, LANDMARKS } from '../src/sim/terrain.js';
import { layoutShoreline } from '../src/shoreline-layout.js';
import { harbourLayout } from '../src/harbour-layout.js';
import { WindField, firstGustFor } from '../src/sim/wind.js';
import { BoatPhysics, CONTROLS, Helm } from '../src/sim/boat.js';
import { createDiscoveries, placesFrom, inBand, RULES, IDS } from '../src/sail/discoveries.js';
import { ENTRIES } from '../src/ui/logbook.js';
import { startPose, FIRST_GUST } from '../classic/src/modes/daysail/index.js';
import { SAIL_HOUR } from '../src/sim/timeOfDay.js';
import { parseFlags } from '../src/sim/core/flags.js';

const terrain = makeTerrain({ seed: 1 });
const shoreline = layoutShoreline(terrain, { seed: 1 });
const harbour = harbourLayout({ terrain, seed: 1 });
const places = placesFrom({ terrain, shoreline, harbour });
const DEG = Math.PI / 180;

// a camera 8 m up, 12 m behind the boat, looking along `yaw` (rad, clockwise from north), slightly down
const camAt = (x, z, yaw, { pitch = -4 * DEG } = {}) => ({
  x: x - Math.sin(yaw) * 12, y: 8, z: z + Math.cos(yaw) * 12,
  fx: Math.sin(yaw) * Math.cos(pitch), fy: Math.sin(pitch), fz: -Math.cos(yaw) * Math.cos(pitch), fovDeg: 50, aspect: 16 / 9,
});
const bearing = (from, to) => Math.atan2(to.x - from.x, -(to.z - from.z));
const base = { tws: 6, twa: -2.2, sog: 2.8, sunElevDeg: 17 };
// a stream: f(t) → partial sample; every 1/30 s for `dur` s. Returns { id: first t }.
function run(f, dur, { dt = 1 / 30, disc = createDiscoveries({ places }) } = {}) {
  const found = {};
  for (let t = 0; t <= dur; t += dt) {
    const s = { ...base, t, ...f(t) };
    s.cam ??= camAt(s.x, s.z, s.heading);
    for (const id of disc.update(s)) found[id] = +t.toFixed(2);
  }
  return found;
}

test('the rules cover every logbook entry', () => {
  assert.deepEqual([...IDS].sort(), ENTRIES.map((e) => e.id).sort());
});

test('at anchor (D3): the anchor holding and the boat still for 10 s; not while dragging or moving', () => {
  const d = createDiscoveries({ places: {} });
  let got = [];
  for (let i = 0; i <= 60; i++) got.push(...d.update({ t: i * 0.25, x: 0, z: 0, heading: 0, sog: 0.5, anchored: true }));   // swinging fast
  assert.deepEqual(got, []);
  for (let i = 0; i <= 30; i++) got.push(...d.update({ t: 20 + i * 0.25, x: 0, z: 0, heading: 0, sog: 0.1, anchored: i < 20 ? false : true }));
  assert.deepEqual(got, []);
  for (let i = 0; i <= 44; i++) got.push(...d.update({ t: 30 + i * 0.25, x: 0, z: 0, heading: 0, sog: 0.1, anchored: true }));
  assert.deepEqual(got, ['anchor']);
});

test('the places sit where the world puts them (terrain, shoreline, harbour data)', () => {
  assert.deepEqual([places.island.x, places.island.z], [LAKE.island.x, LAKE.island.z]);
  assert.deepEqual([places.house.x, places.house.z], [LANDMARKS.house.x, LANDMARKS.house.z]);
  const fall = terrain.waterfall();
  assert.ok(Math.hypot(places.waterfall.x - fall.x, places.waterfall.z - fall.z) < 1, `waterfall at ${places.waterfall.x}, ${places.waterfall.z}`);
  assert.deepEqual([places.harbour.x, places.harbour.z], harbour.entrance.centre, 'harbour entrance');
  assert.deepEqual([places.light.x, places.light.z], [shoreline.tower.x, shoreline.tower.z], 'the light');
  assert.ok(!('moorings' in places), 'no mooring entry (the balls were deleted)');
  const n = places.narrows; assert.ok(Math.abs(Math.hypot(n.b.x - n.a.x, n.b.z - n.a.z) - LAKE.mouth.length) < 2, `the mouth channel is ${LAKE.mouth.length} m`);
});

test('inBand: the middle third of the frame, in front, on screen', () => {
  const cam = camAt(0, 0, 0);   // looking north (−z)
  assert.ok(inBand(cam, { x: 0, y: 0, z: -300 }));
  assert.ok(inBand(cam, { x: 60, y: 0, z: -300 }), '≈ 11° off: inside the middle third (±15.5° at 16:9, fov 50)');
  assert.ok(!inBand(cam, { x: 120, y: 0, z: -300 }), '≈ 22° off: outside the middle third, still on screen');
  assert.ok(!inBand(cam, { x: 0, y: 0, z: 300 }), 'behind the camera');
  assert.ok(!inBand(cam, { x: 0, y: 400, z: -300 }), 'above the frame');
  assert.ok(!inBand(null, { x: 0, z: -1 }));
});

test('the island: within 220 m and in view fires; within 220 m looking away does not; far away never', () => {
  const I = places.island;
  // straight at it from 400 m to 150 m south-east
  const p0 = { x: I.x + 280, z: I.z + 280 }, h = bearing(p0, I);
  const at = (t) => { const k = Math.min(1, t / 60); return { x: p0.x + (I.x - p0.x) * 0.55 * k, z: p0.z + (I.z - p0.z) * 0.55 * k, heading: h }; };
  const f = run(at, 60);
  assert.ok('island' in f, 'fires');
  const d = Math.hypot(at(f.island).x - I.x, at(f.island).z - I.z);
  assert.ok(d < 220 && d > 150, `at ${d.toFixed(0)} m`);
  // the same track, the camera looking the other way
  assert.ok(!('island' in run((t) => ({ ...at(t), cam: camAt(at(t).x, at(t).z, h + Math.PI) }), 60)), 'looking away');
  // passing 300 m off, looking at it
  assert.ok(!('island' in run((t) => ({ x: I.x + 300, z: I.z - 400 + t * 10, heading: bearing({ x: I.x + 300, z: I.z - 400 + t * 10 }, I) }), 80)), '300 m off');
});

test('the waterfall, the house, the harbour, the light: radius and view; just outside the radius never', () => {
  for (const id of ['waterfall', 'house', 'harbour', 'light']) {
    const P = places[id], V = P.view ?? P, r = RULES[id].r;
    // hold 20 m inside / 20 m outside the radius, south-east of it over the water side, looking at it
    for (const [dr, want] of [[-20, true], [20, false]]) {
      const ang = id === 'harbour' ? 200 * DEG : id === 'light' ? 160 * DEG : 0;   // approach from the water
      const x = P.x + Math.sin(ang) * (r + dr), z = P.z - Math.cos(ang) * (r + dr);
      const f = run(() => ({ x, z, heading: bearing({ x, z }, V) }), 2);
      assert.equal(id in f, want, `${id} at r ${dr > 0 ? '+' : ''}${dr} m`);
    }
  }
});

test('the narrows: inside the mouth channel fires; beside it or short of it does not', () => {
  const { a, b } = places.narrows, L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L;
  const pt = (s, off) => ({ x: a.x + ux * s - uz * off, z: a.z + uz * s + ux * off, heading: 40 * DEG });
  assert.ok('narrows' in run(() => pt(L / 2, 0), 1), 'mid-channel');
  assert.ok('narrows' in run(() => pt(100, 150), 1), 'near the side, inside 190 m');
  assert.ok(!('narrows' in run(() => pt(L / 2, 230), 1)), '230 m off the axis');
  assert.ok(!('narrows' in run(() => pt(-60, 0), 1)), 'short of the mouth');
});

// the boat sails north at 2.8 m/s in open water (well clear of every place); the wind and speed follow `w(t)`, `v(t)`
const open = (t) => ({ x: 350, z: 300 - t * 2.8, heading: 0 });
const ramp = (t, t0, len, gain) => 1 + gain * Math.min(1, Math.max(0, (t - t0) / len));

test('first gust: +40 % wind with a +18 % surge fires near the peak; a 20 % gust never; wind without a surge never', () => {
  const peakAt = 40;
  const w = (t) => 6 * (t < peakAt ? ramp(t, 32, 8, 0.4) : 1.4 - 0.2 * Math.min(1, (t - peakAt) / 10));
  const f = run((t) => ({ ...open(t), tws: w(t), sog: 2.8 * ramp(t, 33, 9, 0.18) }), 70);
  assert.ok('gust' in f, 'fires');
  assert.ok(f.gust >= peakAt && f.gust < peakAt + 3, `at the peak (${f.gust} s)`);
  assert.ok(!('gust' in run((t) => ({ ...open(t), tws: 6 * ramp(t, 30, 6, 0.20), sog: 2.8 * ramp(t, 30, 6, 0.18) }), 70)), 'a 20 % gust');
  assert.ok(!('gust' in run((t) => ({ ...open(t), tws: 6 * ramp(t, 30, 6, 0.24), sog: 2.8 * ramp(t, 30, 6, 0.3) }), 70)), 'a 24 % gust');
  assert.ok(!('gust' in run((t) => ({ ...open(t), tws: 6 * ramp(t, 30, 6, 0.5), sog: 2.8 * ramp(t, 30, 6, 0.05) }), 70)), 'no surge (luffing)');
  assert.ok(!('gust' in run((t) => ({ ...open(t), tws: 6, sog: 2.0 * ramp(t, 1, 10, 0.5) }), 70)), 'gathering way in a steady wind');
});

test('first gust on the real physics: the default start sails into the placed gust line, surges and records it', () => {
  const START = startPose(parseFlags());
  // at Day Sail's own start hour (18:45 PDT, SAIL_HOUR: the wind level is set there)
  const wind = new WindField({ seed: 1, day: { hour: Number(SAIL_HOUR), rate: 1 }, firstGust: firstGustFor({ x: START.x, z: START.z, headingDeg: START.headingDeg, ...FIRST_GUST }) });
  wind.setTerrain(terrain.heightAt);
  const env = (t) => ({ t, windAt: (x, z, tt) => { const s = wind.sample(x, z, tt); return { vx: s.vx, vz: s.vz }; } });
  const h0 = START.headingDeg * DEG, phys = new BoatPhysics({ x: START.x, z: START.z, heading: h0, speed: START.speed });
  const helm = new Helm(), disc = createDiscoveries({ places });
  let gustAt = null;
  const at = [];   // [t, tws, sog, |heel|] once a second
  for (let i = 0; i < 90 * 60 && gustAt == null; i++) {
    phys.step(1 / 60, { ...CONTROLS, rudder: helm.toHeading(phys.state, h0) }, env(i / 60));
    const s = phys.state;
    if (i % 60 === 0) at.push([i / 60, s.trueWind.speed, s.sog, Math.abs(s.heel)]);
    const ids = disc.update({ t: i / 60, x: s.x, z: s.z, heading: s.heading, sog: s.sog, tws: s.trueWind.speed, twa: s.trueWind.angle, cam: null, sunElevDeg: 17 });
    if (ids.includes('gust')) gustAt = i / 60;
  }
  // D1: felt at 15–25 s of real time at the default 2× (≈ 30–50 s of scene time); found as the surge peaks
  assert.ok(gustAt != null && gustAt >= 25 && gustAt <= 50, `the first gust at ${gustAt?.toFixed(1)} s of sim time`);
  // the surge itself, against the 10 s before the gust: SOG ≥ +10 %, heel ≥ +5°
  const before = at.filter(([t]) => t >= gustAt - 16 && t < gustAt - 6), mean = (k) => before.reduce((a, r) => a + r[k], 0) / before.length;
  const s = phys.state;
  assert.ok(s.sog >= 1.1 * mean(2), `SOG ${mean(2).toFixed(2)} → ${s.sog.toFixed(2)} m/s`);
  assert.ok(Math.abs(s.heel) - mean(3) >= 5 * DEG, `heel ${(mean(3) / DEG).toFixed(1)}° → ${(Math.abs(s.heel) / DEG).toFixed(1)}°`);
});

// a scripted tack: close-hauled on port (twa +45°), turn through the wind at `rate` °/s to starboard (twa −45°)
function tackStream({ rate = 6, sogAfter = 2.4, swing = 90 } = {}) {
  const t0 = 20, dur = swing / rate, from = 0, h0 = 300 * DEG;   // wind from 300°+45° = 345°
  return (t) => {
    const k = Math.min(1, Math.max(0, (t - t0) / dur));
    const heading = h0 + k * swing * DEG;                           // turning to starboard
    const twa = (45 - k * swing) * DEG;                             // +45° → −45° through 0
    const sog = t < t0 ? 2.6 : t < t0 + dur + 2 ? 1.2 : sogAfter;
    return { ...open(t), heading, twa, sog, x: 350 + from, z: 300 - t * 2 };
  };
}

test('first tack: through head to wind, > 60° in 20 s, under way 15 s later; irons, a slow turn or a gybe never', () => {
  const f = run(tackStream(), 80);
  assert.ok('tack' in f, 'fires');
  assert.ok(f.tack > 20 + 7.5 + 14 && f.tack < 20 + 7.5 + 16, `15 s after the crossing (${f.tack} s)`);
  assert.ok(!('tack' in run(tackStream({ sogAfter: 0.4 }), 80)), 'in irons after (0.4 m/s)');
  assert.ok(!('tack' in run(tackStream({ rate: 2 }), 120)), 'a 90° turn over 45 s');
  // a gybe: twa from +150° to −150° through 180°
  const gybe = (t) => { const k = Math.min(1, Math.max(0, (t - 20) / 10)); let a = 150 + k * 60; a = a > 180 ? a - 360 : a; return { ...open(t), heading: k * 60 * DEG, twa: a * DEG, sog: 3 }; };
  assert.ok(!('tack' in run(gybe, 80)), 'a gybe');
});

test('round the island: a 300° sweep within 260 m fires; a 250° arc, a wide circle or a slow one never', () => {
  const I = places.island;
  const circle = (r, degPerS, startDeg = 0) => (t) => {
    const a = (startDeg + degPerS * t) * DEG;
    return { x: I.x + Math.sin(a) * r, z: I.z - Math.cos(a) * r, heading: a + Math.PI / 2, cam: null };
  };
  const f = run(circle(150, 1.2), 300);
  assert.ok('round' in f, 'fires');
  assert.ok(Math.abs(f.round - 250) < 2, `after 300° (${f.round} s)`);
  assert.ok('round' in run(circle(150, -1.2), 300), 'either way');
  assert.ok(!('round' in run(circle(150, 1.2), 205)), 'a 246° arc');
  assert.ok(!('round' in run(circle(300, 1.2), 400)), '300 m out: passing far from the island');
  assert.ok(!('round' in run(circle(150, 0.75), 560)), '300° in 400 s: over 6 min');
  // a pass by: straight past at 120 m sweeps ≈ 130° only
  assert.ok(!('round' in run((t) => ({ x: I.x + 120, z: I.z + 600 - t * 3, heading: 0, cam: null }), 400)), 'a straight pass by');
  // back and forth across the same side never adds up
  assert.ok(!('round' in run((t) => { const a = Math.sin(t / 20) * 120 * DEG; return { x: I.x + Math.sin(a) * 150, z: I.z - Math.cos(a) * 150, heading: 0, cam: null }; }, 600)), 'to and fro over 240°');
});

test('past sunset: reads the elevation every sample; fires on the down-crossing under way, not at rest, not at dawn', () => {
  const sun = (t) => 2 - t * 0.05;   // crosses 0 at 40 s
  const f = run((t) => ({ ...open(t), sunElevDeg: sun(t) }), 60);
  assert.ok(Math.abs(f.sunset - 40) < 0.1, `at the crossing (${f.sunset} s)`);
  assert.ok(!('sunset' in run((t) => ({ ...open(t), sunElevDeg: sun(t), sog: 0.5 }), 60)), 'at rest');
  assert.ok(!('sunset' in run((t) => ({ ...open(t), sunElevDeg: -2 + t * 0.05 }), 60)), 'sunrise');
  assert.ok(!('sunset' in run((t) => ({ ...open(t), sunElevDeg: 17 }), 60)), 'a fixed 18:00 sun (D2 off)');
});

test('each rule fires once, and never for an entry the save already has', () => {
  const n = places.narrows, mid = { x: (n.a.x + n.b.x) / 2, z: (n.a.z + n.b.z) / 2 };
  const disc = createDiscoveries({ places });
  const s = { ...base, t: 0, x: mid.x, z: mid.z, heading: 0, cam: null };
  assert.deepEqual(disc.update(s), ['narrows']);
  assert.deepEqual(disc.update({ ...s, t: 1 }), []);
  const d2 = createDiscoveries({ places, isFound: (id) => id === 'narrows' });
  assert.deepEqual(d2.update(s), []);
  // open water, an ordinary minute: nothing
  assert.deepEqual(run(open, 60), {});
});
