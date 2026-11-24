// The multi-seed Cruise (Chill) voyages, shared by the fast suite (one representative seed each) and the slow lane
// (tests/slow/*.slow.mjs, `npm run test:slow`: every other seed). One body per check, so the two lanes never drift apart.
//   import { navigatorVoyage } from './helpers/cases-chill.mjs';  navigatorVoyage(14, 1);   // registers one node:test test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voyage, chillWorld } from '../../src/modes/chill/sim.js';
import { chillSchedule, CHILL } from '../../src/sim/modes/chill/params.js';
import { analyticSun } from '../../src/sim/timeOfDay.js';
import { assertSafe } from './chill-safety.mjs';

const DEG = Math.PI / 180;

// tests/navigator.test.mjs: the light running at Chill's pace, from three start hours: the 14:00 lull into the afternoon
// breeze and the dusk; 18:00 golden hour into the night drainage; 19.5 the evening fade into the night
export const NAV_HOURS = [14, 18, 19.5], SEEDS = [1, 2, 3];
export function navigatorVoyage(hour, seed) {
  test(`30 min from ${hour}:00 (time running), seed ${seed}: safe, never in irons, under way`, () => {
    const out = voyage({ seed, hour, minutes: 30 });
    assertSafe(`h${hour} s${seed}`, out);
    // progress: the afternoon breeze reaches stops; after dusk the night drainage (0.6 m/s) only ghosts
    const want = hour === 14 ? 2 : hour === 18 ? 1 : 0;
    assert.ok(out.reached.length >= want, `h${hour} s${seed}: ${out.reached.length} stops (want ${want})`);
    assert.ok(out.rec.dist >= (hour === 19.5 ? 200 : hour === 18 ? 500 : 1000), `h${hour} s${seed}: sailed ${out.rec.dist.toFixed(0)} m`);
  });
}

// tests/navigator-wind.test.mjs: steady hours (the light held: real progress round the loop) and a lake wind advisory day
export function heldVoyage(seed) {
  test(`30 min at 16:00 held (the afternoon breeze), seed ${seed}: safe and round the loop`, () => {
    const out = voyage({ seed, hour: 16, rate: 0, minutes: 30 });
    assertSafe(`h16 held s${seed}`, out);
    assert.ok(out.reached.length >= 3, `seed ${seed}: ${out.reached.length} stops in 30 min`);
    assert.ok(new Set(out.reached.map((r) => r.key)).size >= 3);
  });
}
export const ADVISORY = [[1, 16, 0], [2, 16, 0], [3, 14, undefined]];
export function advisoryVoyage([seed, hour, rate]) {
  test(`30 min on an advisory day from ${hour}:00${rate === 0 ? ' held' : ''}, seed ${seed}: safe, reefed, round the loop`, () => {
    const out = voyage({ seed, hour, rate, advisory: true, minutes: 30 });
    assertSafe(`advisory h${hour} s${seed}`, out);
    assert.ok(out.rec.reefMax >= 1, 'the crew reefs');
    assert.ok(out.reached.length >= 2, `seed ${seed}: ${out.reached.length} stops`);
  });
}

// tests/navigator-night.test.mjs: Chill's quick night, 60 min from CHILL.hour on the page's schedule
export function nightVoyage(seed) {
  test(`60 min of Chill from 17:54 PDT through the quick night into the morning, seed ${seed}: safe, smooth, under way`, () => {
    let prevE = null, maxDe = 0, below = 0, nightS = 0, nightShore = Infinity, dawnDist = 0, px = null, pz = null, dayAgain = null;
    let maxTwsJump = 0, prevTws = null;
    const hour = Number(CHILL.hour);
    const world = chillWorld({ seed, hour, schedule: chillSchedule() });
    const out = voyage({
      seed, hour, world, minutes: 60,
      onTick(t, s, o, nav) {
        const e = Math.asin(analyticSun(((world.clock(t) % 24) + 24) % 24).y) / DEG;
        if (prevE !== null) maxDe = Math.max(maxDe, Math.abs(e - prevE));
        prevE = e;
        if (e < -8 && world.clock(t) < 36) below += 1 / 60;   // the first night
        if (nav.isNight) { nightS += 1 / 60; nightShore = Math.min(nightShore, nav.chart.shoreAt(s.x, s.z)); }
        if (nightS > 0 && !nav.isNight && dayAgain === null) dayAgain = t;
        if (dayAgain !== null && px !== null) dawnDist += Math.hypot(s.x - px, s.z - pz);
        px = s.x; pz = s.z;
        if (prevTws !== null) maxTwsJump = Math.max(maxTwsJump, Math.abs(s.trueWind.speed - prevTws));
        prevTws = s.trueWind.speed;
      },
    });
    assertSafe(`chill60 s${seed}`, out);
    console.log(`# chill60 s${seed}: under −8° ${below.toFixed(1)} s, night mode ${(nightS / 60).toFixed(1)} min (shore ≥ ${nightShore.toFixed(0)} m), day again at ${(dayAgain / 60).toFixed(1)} min, ${dawnDist.toFixed(0)} m sailed after, ${out.reached.length} stops, ends ${(out.hourEnd % 24).toFixed(2)} h; max |Δelev| per tick ${maxDe.toFixed(4)}°, max |ΔTWS| per tick ${maxTwsJump.toFixed(3)} m/s`);
    assert.ok(out.hourEnd > 24 + 12, `ends at ${out.hourEnd} (through the night into the next day)`);
    assert.ok(below <= 150, `${below.toFixed(1)} s under −8°`);
    assert.ok(maxDe < 0.01, `the sun jumped ${maxDe}° in a tick`);
    assert.ok(nightS > 0 && dayAgain !== null, 'the navigator kept its night water and handed back to the day route');
    assert.ok(dawnDist >= 1000, `${dawnDist.toFixed(0)} m sailed after dawn`);
    assert.ok(out.reached.some((r) => r.t > dayAgain), 'a stop reached after dawn');
  });
}

// tests/aiSkipperCruise.test.mjs: Cruise with the AI skipper, 20 min on the real bay
export const SKIPPER = [[1, 1], [2, 1], [3, 1], [1, 0.2]];
export function skipperVoyage([seed, skill]) {
  test(`20 min at 16:00 held, seed ${seed}, skill ${skill}: never grounds, keeps the margins, trims with the pro controls`, () => {
    const used = { trav: 0, twist: 0, back: 0, sides: new Set() };
    const out = voyage({ seed, hour: 16, rate: 0, minutes: 20, skipper: skill, onTick: (t, s) => {
      used.trav = Math.min(used.trav, s.traveller); used.twist = Math.max(used.twist, s.twist); used.back = Math.max(used.back, s.backstay);
    } });
    assertSafe(`skipper h16 s${seed} k${skill}`, out);
    console.log(`# skipper s${seed} k${skill}: stops ${out.reached.length}, maxHeel ${out.rec.maxHeelDeg.toFixed(1)}°, tacks ${out.nav.tacks} gybes ${out.nav.gybes}, traveller ${used.trav.toFixed(2)} twist ${used.twist.toFixed(2)} backstay ${used.back.toFixed(2)}`);
    assert.ok(out.reached.length >= 2, `${out.reached.length} stops in 20 min`);
    if (skill === 1) assert.ok(used.trav < -0.1 || used.back > 0.2, 'the pro controls are used');
  });
}

// tests/slow/ultra-seastate.slow.mjs: the AI skipper's Cruise run on a real sea state (a sum of plane waves with a lake
// spectrum's periods), 20 min at 16:00
const G = 9.81;
// Hs (m): 7 plane waves, periods 0.55 to 1.6 Tp, a cos^2 spread of directions round the wind's (towards 40 deg), energies by JONSWAP's shape
function sea(Hs, seed = 1) {
  if (Hs <= 0) return null;
  const Tp = 2.2 + 2.4 * Math.sqrt(Hs), waves = [];
  let sum = 0, rng = seed * 9301 + 49297;
  const rnd = () => { rng = (rng * 9301 + 49297) % 233280; return rng / 233280; };
  for (let i = 0; i < 7; i++) {
    const f = (0.7 + i * 0.12) / Tp, w = 2 * Math.PI * f, e = Math.pow(f, -5) * Math.exp(-1.25 * Math.pow(0.9 / (0.7 + i * 0.12), 4));
    const dir = (40 + (rnd() - 0.5) * 70) * Math.PI / 180;
    waves.push({ k: w * w / G, w, dx: Math.sin(dir), dz: -Math.cos(dir), ph: rnd() * 6.283, e }); sum += e;
  }
  for (const v of waves) v.a = (Hs / 4) * Math.sqrt(2 * v.e / sum);   // sum of a^2 / 2 = (Hs / 4)^2
  return { heightAt: (x, z, t, { depthM = 0 } = {}) => waves.reduce((s, v) => s + v.a * Math.sin(v.k * (v.dx * x + v.dz * z) - v.w * t + v.ph) * Math.exp(-v.k * depthM), 0) };
}
const seaRun = (seed, Hs) => voyage({ seed, hour: 16, rate: 0, minutes: 20, skipper: 1, surface: sea(Hs, seed) });
export function seaStateVoyage(seed) {
  test(`Cruise on a sea state, seed ${seed}: calm (Hs 0.1 m) within 5 % of flat water, 2 m seas degrade sensibly, never grounds`, () => {
    const flat = seaRun(seed, 0), calm = seaRun(seed, 0.1), big = seaRun(seed, 2);
    assertSafe(`flat s${seed}`, flat); assertSafe(`calm s${seed}`, calm); assertSafe(`2 m s${seed}`, big);
    const d = (o) => o.rec.dist, rc = d(calm) / d(flat), rb = d(big) / d(flat);
    console.log(`# seed ${seed}: sailed flat ${d(flat).toFixed(0)} m, Hs 0.1 ${d(calm).toFixed(0)} m (${(rc * 100).toFixed(1)} %), Hs 2 ${d(big).toFixed(0)} m (${(rb * 100).toFixed(1)} %); stops ${flat.reached.length}/${calm.reached.length}/${big.reached.length}; maxHeel ${flat.rec.maxHeelDeg.toFixed(0)}/${calm.rec.maxHeelDeg.toFixed(0)}/${big.rec.maxHeelDeg.toFixed(0)} deg`);
    assert.ok(rc > 0.95 && rc < 1.05, `calm water: ${(rc * 100).toFixed(1)} % of flat`);
    assert.ok(rb > 0.55 && rb < 1.05, `2 m seas: ${(rb * 100).toFixed(1)} % of flat (slower, not stalled)`);
    assert.ok(big.reached.length >= 1, 'it still reaches a stop');
  });
}
export function seaStateOrder() {
  test('1 m and 0.3 m seas sit between calm and 2 m (seed 1): the speed falls with the sea, in order', () => {
    const r = [0, 0.3, 1, 2].map((h) => seaRun(1, h).rec.dist);
    console.log(`# seed 1 distance in 20 min by Hs 0 / 0.3 / 1 / 2 m: ${r.map((x) => x.toFixed(0)).join(' / ')} m`);
    assert.ok(r[3] <= r[1] * 1.03 && r[2] <= r[0] * 1.03, 'rougher is not faster');
    for (const x of r) assert.ok(x > 0.5 * r[0], 'no stall');
  });
}
