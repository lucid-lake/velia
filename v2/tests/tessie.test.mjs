// Tessie (M1; owner, 2026-11-17): the device policy (desktop only, off at L3, never in a capture unless asked)
// and the director (the first sighting about 25 s into play with no input, in the camera's view, off the boat's track,
// never in a race, never back to back with the kayak pair's beat, 2–4 min apart, deterministic), and the body (a smooth
// spine, a shy dive that keeps her 15 m off the hull). Behaviour only: the modules are called, their output read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tessieDraws, tessieFlag } from '../living/tessie-policy.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createStageDirector, STAGE } from '../stage/director.js';
import { ACTS, actById } from '../stage/acts.js';

const TACT = actById('tessie');

// the registry row (src/core/features.js 'tessie'): the six devices are in v2/tests/features.test.mjs; here the rule's corners
const on = (dev, gpu, ctx = {}) => {
  const win = { ...DEVICES[dev], location: { search: '' } };
  const pr = { get: () => profileOf(readFacts(win), {}, { gpu }), on: () => {} };
  return createFeatures({ profile: pr, doc: null }).configure({ headless: false, flags: {}, ...ctx }).feature('tessie').on;
};

test('registry: a desktop or a tablet (a phone never loads her), off at L3', () => {
  for (const lv of [0, 1, 2]) assert.equal(on('desktop', lv), true, `a desktop at L${lv}`);
  assert.equal(on('desktop', 3), false, 'a desktop at L3');
  assert.equal(on('touchLaptop', 1), true, 'a touch-screen Windows laptop');
  for (const d of ['iphoneTurned', 'androidSideways']) assert.equal(on(d, 1), false, d);
  for (const d of ['ipadTrackpad', 'ipadPro', 'androidTablet']) assert.equal(on(d, 1), true, `${d} (a tablet is a desktop)`);
  assert.equal(on('ipadOld', 3), false, 'a tablet at L3');
  // the live check: the ladder at L3 hides her
  assert.deepEqual([0, 1, 2, 3].map(tessieDraws), [true, true, true, false]);
});

test('registry: never in a capture (a golden) unless the URL asks; ?tessie=0 is off everywhere', () => {
  assert.equal(on('desktop', 0, { headless: true }), false, 'a capture without ?tessie=');
  for (const f of ['1', 'now', '30']) assert.equal(on('desktop', 0, { headless: true, flags: { tessie: f } }), true, `a capture with ?tessie=${f}`);
  for (const f of ['0', 'off']) assert.equal(on('desktop', 0, { flags: { tessie: f } }), false, `?tessie=${f}`);
  assert.equal(on('iphoneTurned', 1, { flags: { tessie: '1' } }), false, 'a phone stays off even with ?tessie=1');
  assert.deepEqual(tessieFlag('now'), { set: true, now: true });
  assert.deepEqual(tessieFlag('40'), { set: true, firstAt: 40 });
  assert.deepEqual(tessieFlag(null), { set: false });
});

// a lake for the director: deep water everywhere but a shore on one side (x < −300) and an island
const lake = (x, z) => (x < -300 ? -5 : Math.hypot(x - 260, z + 120) < 40 ? -2 : 30);
const view = (b) => ({ x: b.x - Math.sin(b.heading) * 32, z: b.z + Math.cos(b.heading) * 32, yaw: b.heading, hHalf: Math.atan(Math.tan(20.6 * Math.PI / 180) * 16 / 9) });
// a boat sailing straight at u m/s from (x, z) on heading h (rad, forward = (sin h, −cos h)); no input from the player. When she
// rises is the stage director's (v2/stage/director.js) with her act alone (her opening, then her cooldown)
function run({ seed = 1, secs = 60, dt = 1 / 30, u = 2.6, h = 0.4, x = 0, z = 0, race = () => false, busy = () => false, steerAt = false, depthAt = lake } = {}) {
  const t = createTessie({ seed, depthAt });
  let T = 0;
  const stage = createStageDirector({ acts: ACTS.filter((a) => a.id === 'tessie'), seed, ctx: { tessie: { sim: t } }, race: () => race(T), busy: () => (busy(T) ? 'kayaks' : null) });
  const b = { x, z, heading: h, speed: u };
  const log = [];
  for (let k = 0, n = Math.round(secs / dt); k < n; k++) {
    T = k * dt;
    stage.step(dt, { playing: true });
    if (steerAt && t.state.visible) { const c = t.state.centre; b.heading = Math.atan2(c[0] - b.x, -(c[1] - b.z)); }
    b.x += Math.sin(b.heading) * u * dt; b.z -= Math.cos(b.heading) * u * dt;
    t.step(dt, { playing: true, boat: { ...b }, view: view(b), race: race(T) });
    log.push({ T, visible: t.state.visible, phase: t.state.phase, boat: { ...b } });
  }
  return { t, log, b, stage };
}

test('the first sighting (the stage\'s opening act): the humps break about 25 s into play, with no input', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { t, log } = run({ seed, secs: 45 });
    const s = t.sightings[0];
    assert.ok(s, `seed ${seed}: a sighting`);
    assert.ok(Math.abs(s.breakAt - TACT.opening.atS) <= TACT.opening.jitterS + 0.1, `seed ${seed}: the break at ${s.breakAt} s`);
    const firstVisible = log.find((r) => r.visible).T;
    assert.ok(firstVisible > 20 && firstVisible < 25, `seed ${seed}: her shape under the water from ${firstVisible.toFixed(1)} s`);
  }
  // the same seed, the same sighting
  assert.deepEqual(run({ seed: 7, secs: 40 }).t.sightings, run({ seed: 7, secs: 40 }).t.sightings);
});

test('placement: in the camera\'s view, 25–40° off the bow, 50–90 m off, deep water, off the boat\'s track', () => {
  for (const [seed, h] of [[1, 0.4], [2, 2.0], [3, -1.2], [4, 3.0], [5, 0.0]]) {
    const { t, log } = run({ seed, h, secs: 32 });
    const s = t.sightings[0];
    assert.ok(s, `seed ${seed}: placed`);
    assert.ok(s.R >= 50 && s.R <= 90 && s.bear >= 25 && s.bear <= 40, `seed ${seed}: ${s.R} m, ${s.bear}°`);
    assert.ok(s.depth >= 8, `seed ${seed}: ${s.depth} m deep`);
    assert.equal(s.inView, true, `seed ${seed}: in view at the break`);
    // her body at the break: every point at least 35 m off the boat's line ahead (the boat sails on, straight)
    const at = log.find((r) => r.T >= s.breakAt);
    assert.ok(at.visible, 'visible at the break');
    assert.ok(s.minBoatM >= 30, `seed ${seed}: she stays ${s.minBoatM} m off the boat`);
  }
  // a shore on her side: the port spot is refused, the starboard side used (or a spot in deep water)
  const { t } = run({ seed: 1, h: 0, x: -255, z: 0, secs: 32 });
  const s = t.sightings[0];
  assert.ok(s && s.depth >= 8 && s.side === 1, `by the shore to port: placed to starboard in deep water (${JSON.stringify(s)})`);
});

test('never during a race, and a gap after it; never back to back with the kayak pair\'s beat', () => {
  const race = run({ secs: 90, race: (T) => T < 40 });
  assert.ok(race.t.sightings.length === 1 && race.t.sightings[0].at >= 40 + STAGE.RACE_GAP_S - 0.1, `after the race + ${STAGE.RACE_GAP_S} s: ${race.t.sightings[0]?.at}`);
  assert.ok(race.log.filter((r) => r.T < 40).every((r) => !r.visible), 'nothing during the race');
  // a race starting while she is up: she dives at once and is gone within ~16 s
  const mid = run({ secs: 70, race: (T) => T > 30 });
  const goneAt = mid.log.find((r) => r.T > 30 && !r.visible)?.T;
  assert.ok(goneAt != null && goneAt < 30 + 17, `gone ${goneAt?.toFixed(1)} s after a race starts`);
  // the kayak pair near the boat until 30 s: she waits for the beat to end (the stage's busy wait), then rises
  const busy = run({ secs: 70, busy: (T) => T < 30 });
  assert.ok(busy.t.sightings[0].at >= 30 - 0.1 && busy.t.sightings[0].at < 31, `after the beat: ${busy.t.sightings[0].at}`);
  // a beat longer than the stage's wait: her opening is skipped (to the random pool), nothing over the beat
  const long = run({ secs: 70, busy: (T) => T < 60 });
  assert.ok(long.t.sightings.length === 0 && long.stage.timeline.some((e) => e.id === 'tessie' && e.ev === 'skip'), 'skipped after the wait');
});

test('cadence: the next one after her cooldown (the stage\'s random pool), seeded', () => {
  const { t } = run({ seed: 3, secs: 420, dt: 1 / 10, u: 2.0 });
  assert.ok(t.sightings.length >= 2, `${t.sightings.length} sightings in 420 s`);
  const gap = t.sightings[1].breakAt - t.sightings[0].breakAt;
  assert.ok(gap >= TACT.random.cooldownS + 20 && gap <= TACT.random.cooldownS + STAGE.RANDOM_S[1] + 60, `${gap.toFixed(0)} s between breaks`);
});

test('the body: a smooth spine, humps and a raised neck above the water, gone after the dive', () => {
  const t = createTessie({ seed: 2, depthAt: () => 30 }); t.cue();   // a sighting due now (the stage director's cue)
  const b = { x: 0, z: 0, heading: 0, speed: 2.5 };
  let prev = null, maxJump = 0, maxNeck = -9, humpsUp = 0;
  for (let k = 0; k < 75 * 60; k++) {
    b.z -= 2.5 / 60;
    t.step(1 / 60, { playing: true, boat: { ...b }, view: view(b) });
    if (!t.state.visible) { prev = null; continue; }
    const sp = t.state.spine;
    if (prev) for (let i = 0; i < 64; i++) maxJump = Math.max(maxJump, Math.hypot(sp[i * 8] - prev[i * 8], sp[i * 8 + 1] - prev[i * 8 + 1], sp[i * 8 + 2] - prev[i * 8 + 2]));
    prev = sp.slice();
    if (t.state.phase === 'swim') { maxNeck = Math.max(maxNeck, sp[1]); let up = 0; for (let i = 20; i < 60; i++) if (sp[i * 8 + 1] > -0.4 && (i === 20 || sp[(i - 1) * 8 + 1] <= -0.4)) up++; humpsUp = Math.max(humpsUp, up); }
    // her frames stay one spine length long (follow the leader, the neck's arc keeps its length): ±12 %
    let len = 0; for (let i = 1; i < 64; i++) len += Math.hypot(sp[i * 8] - sp[(i - 1) * 8], sp[i * 8 + 1] - sp[(i - 1) * 8 + 1], sp[i * 8 + 2] - sp[(i - 1) * 8 + 2]);
    assert.ok(Math.abs(len / t.L - 1) < 0.12, `spine length ${len.toFixed(2)} m of ${t.L}`);
  }
  assert.ok(maxJump < 0.2, `no frame jumps more than 20 cm in 1/60 s (${maxJump.toFixed(3)} m)`);
  assert.ok(maxNeck > 1.2, `the head rises ${maxNeck.toFixed(2)} m above the water`);
  assert.ok(humpsUp >= 2, `${humpsUp} humps break the surface at once`);
  assert.equal(t.stats().count, 1);
  assert.equal(t.state.visible, false, 'gone after the dive');
});

test('a boat steering at her: she sinks and dives; nothing of her above the keel within 15 m of the hull', () => {
  for (const seed of [1, 2, 3]) {
    const { t } = run({ seed, secs: 70, steerAt: true, u: 6 });   // motoring at 12 kn straight at her
    const s = t.sightings[0];
    assert.ok(s, `seed ${seed}: a sighting`);
    assert.ok(s.shy, `seed ${seed}: shy`);
    assert.ok(s.minHullM >= 15, `seed ${seed}: her parts above 2.5 m down come no closer than ${s.minHullM} m (the boat passes over at ${s.minBoatM} m)`);
  }
});

test('the water: rings where she breaks the surface, her V while at the surface, foam at her waterline', () => {
  const t = createTessie({ seed: 1, depthAt: () => 30 }); t.cue();   // a sighting due now (the stage director's cue)
  const b = { x: 0, z: 0, heading: 0, speed: 2.5 };
  let rings = 0, kel = 0, con = 0;
  for (let k = 0; k < 45 * 30; k++) {
    b.z -= 2.5 / 30;
    t.step(1 / 30, { playing: true, boat: { ...b }, view: view(b) });
    if (t.state.visible) { rings = Math.max(rings, t.state.water.rings.length); kel = Math.max(kel, t.state.water.kelvin.length); con = Math.max(con, t.state.water.contacts.length); }
  }
  assert.ok(rings >= 3 && rings <= 16, `rings ${rings}`);
  assert.ok(kel >= 10 && kel <= 24, `V impulses ${kel}`);
  assert.ok(con >= 4 && con <= 24, `waterline contacts ${con}`);
});

// ---- M2: the clips, the events, the motion API (for a chase later), the rare line, the effects ----
import { createTessieFx } from '../living/tessie-fx.js';
import { tessieGain, tessiePan } from '../living/tessie-sound.js';

test('M2 clips: a sighting plays surface, swim, arc, flick and dive, and its moments in order', () => {
  const t = createTessie({ seed: 2, depthAt: () => 30 }); t.cue();   // a sighting due now (the stage director's cue)
  const b = { x: 0, z: 0, heading: 0, speed: 2.5 };
  const seen = new Set(), order = [];
  for (let k = 0; k < 75 * 30; k++) {
    b.z -= 2.5 / 30;
    t.step(1 / 30, { playing: true, boat: { ...b }, view: view(b) });
    for (const c of t.state.clips) seen.add(c);
    for (const e of t.state.events) if (!order.includes(e.type)) order.push(e.type);
  }
  for (const c of ['swim', 'surface', 'arc', 'flick', 'dive']) assert.ok(seen.has(c), `clip ${c} played (${[...seen]})`);
  for (const e of ['break', 'breath', 'flick', 'slap', 'dive', 'under']) assert.ok(order.includes(e), `event ${e} (${order})`);
  assert.ok(order.indexOf('break') < order.indexOf('breath') && order.indexOf('breath') < order.indexOf('flick') && order.indexOf('slap') < order.indexOf('dive') + 1, `in order: ${order}`);
});

test('M2 motion API: swimTo steers like an animal (turn and speed limits); riseUnder breaches under the point', () => {
  const t = createTessie({ seed: 1, depthAt: () => 40 });
  const b = { x: 0, z: 0, heading: 0, speed: 0 };
  t.riseUnder(0, -200, { speed: 3.5, from: 120, heading: Math.PI / 2 });   // she comes from the west, the point ahead of her
  let breachAt = null, maxV = 0, maxTurn = 0, prev = null, prevPsi = null;
  for (let k = 0; k < 60 * 30; k++) {
    t.step(1 / 30, { playing: true, boat: b, view: view(b) });
    const nx = t.state.nose?.x ?? 0, nz = t.state.nose?.z ?? 0;
    if (prev && t.state.visible) {
      const v = Math.hypot(nx - prev[0], nz - prev[1]) * 30; maxV = Math.max(maxV, v);
      const psi = Math.atan2(nx - prev[0], -(nz - prev[1]));
      if (prevPsi != null && v > 1) { let d = psi - prevPsi; d = Math.atan2(Math.sin(d), Math.cos(d)); maxTurn = Math.max(maxTurn, Math.abs(d) * 30 * 180 / Math.PI); }
      prevPsi = psi;
    }
    prev = [nx, nz];
    for (const e of t.state.events) if (e.type === 'breach' && breachAt == null) breachAt = { x: e.x, z: e.z };
  }
  assert.ok(breachAt, 'she breached');
  assert.ok(Math.hypot(breachAt.x - 0, breachAt.z + 200) < 8, `under the point (${breachAt.x.toFixed(1)}, ${breachAt.z.toFixed(1)})`);
  assert.ok(maxV < TESSIE.speedMax + 1.5, `nose speed ${maxV.toFixed(2)} m/s`);
  assert.ok(maxTurn < TESSIE.turnMax * 1.6 + 5, `turn ${maxTurn.toFixed(1)} °/s`);
  // swimTo: she reaches a point at the speed asked, then dives when told
  const u = createTessie({ seed: 3, depthAt: () => 40 });
  u.riseUnder(50, 0, { from: 30, heading: Math.PI / 2, breach: false });
  for (let k = 0; k < 20 * 30; k++) u.step(1 / 30, { playing: true, boat: b, view: view(b) });
  u.swimTo(50, -80, 2.0);
  for (let k = 0; k < 45 * 30; k++) u.step(1 / 30, { playing: true, boat: b, view: view(b) });
  const nn = u.state.nose;
  assert.ok(Math.hypot(nn.x - 50, nn.z + 80) < 6, `swimTo reached (${nn.x.toFixed(1)}, ${nn.z.toFixed(1)})`);
  assert.equal(u.play('dive'), true);
});

test('M2 rare line: once a session, never on the first sighting, light', () => {
  let said = 0, firstRare = false;
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const { t } = run({ seed, secs: 700, dt: 1 / 10, u: 2.0 });
    const r = t.sightings.filter((s) => s.rare);
    assert.ok(r.length <= 1, `seed ${seed}: at most once`);
    if (r.length) said++;
    if (t.sightings[0]?.rare) firstRare = true;
  }
  assert.ok(said >= 1, `said in ${said} of 6 sessions`);
  assert.equal(firstRare, false, 'never on the first sighting');
  assert.ok(TESSIE.rareLine.length < 90 && !/!/.test(TESSIE.rareLine), 'short, no exclamation');
});

test('M2 effects: drops at the break and off her back, gone once they land; her shadow on a shallow sunlit bed only', () => {
  for (const [bed, wantShadow] of [[-9, true], [-40, false]]) {
    const t = createTessie({ seed: 2, depthAt: () => -bed }); t.cue();   // a sighting due now (the stage director's cue)
    const fx = createTessieFx({ seed: 2, bedAt: () => bed });
    const b = { x: 0, z: 0, heading: 0, speed: 2.5 };
    let maxDrops = 0, shadow = 0;
    for (let k = 0; k < 60 * 30; k++) {
      b.z -= 2.5 / 30;
      t.step(1 / 30, { playing: true, boat: { ...b }, view: view(b) });
      fx.step(1 / 30, t.state, [0.3, 0.8, 0.2]);
      maxDrops = Math.max(maxDrops, fx.drops.length); if (fx.nShadow) shadow++;
      for (const d of fx.drops) assert.ok(d.y > -0.5, 'no drop under the water');
    }
    assert.ok(maxDrops > 50, `drops ${maxDrops}`);
    assert.equal(shadow > 0, wantShadow, `bed ${bed} m: shadow frames ${shadow}`);
    assert.ok(fx.stats.events.break > 0 && fx.stats.events.dive > 0, JSON.stringify(fx.stats.events));
  }
  assert.ok(tessieGain(5) > tessieGain(40) && tessieGain(40) > tessieGain(300), 'her sound fades with distance');
  assert.ok(tessiePan({ x: 10, z: 0 }, { x: 0, z: 0, yaw: 0 }) > 0.9 && tessiePan({ x: -10, z: 0 }, { x: 0, z: 0, yaw: 0 }) < -0.9, 'and comes from her side');
});
