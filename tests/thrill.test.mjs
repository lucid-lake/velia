// The thrill build (owner, 2026-10-29): surfing on the lake's waves, heavy air (the rail, the round-up), the slam,
// the groove, and their sound. The physics is src/boat.js (§ 6b the waves' surge) on src/boat/float.js; the cues
// src/boat/thrill.js and src/boat/groove.js; the sound src/boatAudio.js and src/audio.js.
//   node --test tests/thrill.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, Helm, CONTROLS, steadyState, KN, DT, BOAT } from '../src/sim/boat.js';
import { HullFloat } from '../src/sim/boat/float.js';
import { railClearance, SLAM, ROUND } from '../src/sim/boat/thrill.js';
import { grooveScore, GrooveLock, GROOVE, polarKn, bestVmg } from '../src/sim/boat/groove.js';
import { CURRENT_VESSEL } from '../src/sim/vessels/current.js';
const { tws: POLAR_TWS, twa: POLAR_TWA, kn: POLAR_KN } = CURRENT_VESSEL.polar;   // the boat profile's polar
import { thrillMix, ThrillWatch, BoatMix, LEVEL, THRILL } from '../src/boatAudio.js';
import { BedScheduler, GROOVE_SWELL } from '../src/audio.js';
import { simSurf } from '../src/sim/boat/sim.js';

const DEG = Math.PI / 180, f = (x, d = 2) => x.toFixed(d);

test('the waves\' surge: a wave much longer than the hull pushes it with its weight down the slope; chop shorter than the hull cancels', () => {
  // a plane wave along +x, the hull heading east (+x, its bow into the waves' direction of travel... the slope it reads)
  const wave = (lambda, a) => { const k = 2 * Math.PI / lambda; return { heightAt: (x, z, t, { depthM = 0 } = {}) => a * Math.sin(k * x) * Math.exp(-k * depthM) }; };
  const read = (lambda, a, x) => { const fl = new HullFloat({ surface: wave(lambda, a) }); return fl.update({ x, z: 0, heading: Math.PI / 2 }, 0, 1 / 60).slopeX; };
  // 60 m wave, a = 0.3 m: at its zero crossing the slope is a·k = 0.0314; the hull reads it within 5 % (Smith ≈ 0.98)
  const long = read(60, 0.3, 0), ak = 0.3 * 2 * Math.PI / 60;
  assert.ok(Math.abs(long - ak) < 0.05 * ak, `slope ${f(long, 4)} vs a·k ${f(ak, 4)}`);
  // the force the physics applies: −Δ·g·slope (≈ −1160 N here: the surf-riding surge force, Umeda 1999)
  const b = new BoatPhysics({ heading: Math.PI / 2, speed: 3 });
  b.step(DT, CONTROLS, { windAt: () => ({ vx: 0, vz: 0 }), sea: () => ({ slopeX: long }) });
  assert.ok(Math.abs(b.state.waveSurge + BOAT.mass * 9.81 * long) < 1, `surge ${f(b.state.waveSurge, 0)} N`);
  // a 3.6 m chop (half the waterline) at the same steepness: the waterplane averages it to under 20 % of a·k
  const akS = 0.018 * 2 * Math.PI / 3.6, worst = Math.max(...[0, 0.45, 0.9, 1.35, 1.8, 2.25, 2.7, 3.15].map((x) => Math.abs(read(3.6, 0.018, x))));
  assert.ok(worst < 0.2 * akS, `chop slope ${f(worst, 4)} vs a·k ${f(akS, 4)}`);
});

// surfing (a 120 s beat and three 240 s reaches, about 11 s) runs in the slow lane: tests/slow/thrill.slow.mjs

test('slamming: upwind on the open lake the bow passes Ochi\'s threshold every few seconds; never on a broad reach', () => {
  const up = simSurf({ twaDeg: 42, fetchM: 4500, seconds: 90 }), dn = simSurf({ twaDeg: 135, fetchM: 4500, seconds: 90 });
  const count = (r) => r.rows.filter((q, i) => q.slam > 0.3 && !(r.rows[i - 1]?.slam > 0.3)).length;
  assert.ok(Math.abs(SLAM.v0 - 0.785) < 0.01, `Ochi's threshold ${f(SLAM.v0, 3)} m/s`);
  assert.ok(count(up) >= 10, `${count(up)} slams in 90 s upwind`);
  assert.equal(count(dn), 0, 'slams on a broad reach');
});

// a reach in a gust: TWA 75° (wind on the port side, from the north), 22 kn; at 30 s the wind rises by `gain` over
// 1.5 s and holds to 45 s. sheetDeg: the main's sheet held there from 20 s (null: the crew's trim). The helm: the pilot.
function gustRun({ gain = 0.4, sheetDeg = 14, seconds = 75 } = {}) {
  const twa = -75 * DEG, target = -twa, boat = new BoatPhysics({ heading: target, speed: 3 }), helm = new Helm();
  let k = 1, maxHeel = 0, maxUp = 0, jibLuffed = false, cue = 0, back = null;
  const env = { t: 0, windAt: () => ({ vx: 0, vz: 22 * KN * k }) };
  for (let i = 0; i < seconds * 60; i++) {
    env.t = i * DT;
    k = env.t > 30 ? 1 + gain * Math.min(1, (env.t - 30) / 1.5) * (env.t < 45 ? 1 : Math.max(0, 1 - (env.t - 45) / 3)) : 1;
    const s = boat.step(DT, { ...CONTROLS, rudder: helm.toHeading(boat.state, target), sheet: sheetDeg != null && env.t > 20 ? sheetDeg * DEG : null }, env);
    if (env.t > 30) {
      const up = -(s.heading - target) / DEG;   // wind from port: the bow comes up to port
      maxHeel = Math.max(maxHeel, Math.abs(s.heel) / DEG); maxUp = Math.max(maxUp, up); cue = Math.max(cue, s.roundUp);
      if (s.jibFill < 0.2) jibLuffed = true;
      if (maxUp > 25 && back == null && up < 10 && Math.abs(s.heel) < 20 * DEG && s.u > 2.5) back = env.t;
    }
  }
  return { maxHeel, maxUp, jibLuffed, cue, back, end: boat.state };
}

test('round-up: a level-4 gust (+40 %) over-sheeted heads the boat up hard, the jib spills, the heel passes 28°, then it recovers', () => {
  const r = gustRun();
  console.log(`round-up: heel ${f(r.maxHeel, 1)}°, headed up ${f(r.maxUp, 0)}°, the cue ${f(r.cue)}, back on course (< 10°, heel < 20°, > 2.5 m/s) at ${r.back?.toFixed(1)} s`);
  assert.ok(r.maxHeel >= 28 && r.maxHeel < 40, `heel ${f(r.maxHeel, 1)}°`);
  assert.ok(r.maxUp >= 25, `headed up only ${f(r.maxUp, 0)}°`);
  assert.ok(r.jibLuffed && r.cue > 0.9, `jib luffed ${r.jibLuffed}, cue ${f(r.cue)}`);
  assert.ok(r.back != null && r.back - 30 <= 25, `back on course ${r.back == null ? 'never' : `${f(r.back - 30, 1)} s after the gust`}`);
  assert.ok(Math.abs(r.end.heel) < 20 * DEG && r.end.u > 2.5, 'sailing again at the end');
  // the same gust with the crew's hands on the sheet: they ease, the rail goes near the water, no round-up
  const crew = gustRun({ sheetDeg: null });
  assert.ok(crew.maxUp < 10 && crew.cue < 0.1, `the crew rounded up ${f(crew.maxUp, 0)}° (cue ${f(crew.cue)})`);
  assert.ok(crew.maxHeel >= 24 && crew.maxHeel < 30, `the crew's heel ${f(crew.maxHeel, 1)}°`);
  // a level-4 gust that is merely strong (+25 %) does not round up even over-sheeted
  assert.ok(gustRun({ gain: 0.25 }).maxUp < 10, 'a +25 % gust rounded up');
  assert.ok(ROUND.heel === 26 * DEG);
});

test('the lee rail: 0.95 m of sheer over a 1.575 m half-beam is within 0.25 m of the water from ≈ 24°, awash at 31°', () => {
  assert.ok(Math.abs(railClearance(0) - 0.95) < 1e-9);
  assert.ok(railClearance(24 * DEG) > 0.2 && railClearance(25 * DEG) < 0.2, `25°: ${f(railClearance(25 * DEG), 3)} m`);
  assert.ok(Math.abs(railClearance(31.1 * DEG)) < 0.01, `31°: ${f(railClearance(31 * DEG), 3)} m`);
});

test('heavy air with the crew on: level 4 upwind still heels into the 20s and lays the rail near the water in the gusts', async () => {
  const { WindField } = await import('../src/sim/wind.js');
  const heel = [];
  for (const seed of [1, 4]) {
    const w = new WindField({ seed, day: { hour: 18.75, rate: 1 }, level: 4 }), k = 10.5 / w.base.speedMs;
    const from = w.base.dirDeg * DEG, env = { windAt: (x, z, t) => { const s = w.sample(x, z, t); return { vx: s.vx * k, vz: s.vz * k }; }, t: 0 };
    const b = new BoatPhysics({ heading: from - 60 * DEG, speed: 3 }), helm = new Helm();
    for (let i = 0; i < 240 * 60; i++) { env.t = i * DT; const s = b.step(DT, { ...CONTROLS, rudder: helm.toTWA(b.state, 60 * DEG, from) }, env); if (i > 1800) heel.push(Math.abs(s.heel) / DEG); }
  }
  heel.sort((a, b) => a - b);
  const p90 = heel[Math.floor(0.9 * heel.length)], max = heel.at(-1);
  console.log(`level 4, TWA 60°, the crew on: heel p90 ${f(p90, 1)}°, max ${f(max, 1)}°`);
  assert.ok(p90 >= 20 && max >= 25 && max < 30, `p90 ${f(p90, 1)}°, max ${f(max, 1)}°`);
});

test('the groove score: the crew\'s trim at the best VMG angle is in; an eased main, pinching or too much heel is out; the groove is faster', () => {
  const at = (tws, twa, controls) => steadyState({ twsKn: tws, twaDeg: twa, controls });
  const best = at(12, bestVmg(12, true).twa);
  const g = grooveScore(best.state);
  assert.ok(g.score > 0.9 && best.state.groove > 0.9 && best.state.grooveHeld > 100, `crew trim: score ${f(g.score)}, groove ${f(best.state.groove)}`);
  // the main eased 6° off the crew's sheet: luffing toward 10°, slower, out of the groove
  const eased = at(12, bestVmg(12, true).twa, { sheet: best.state.crewSheet + 6 * DEG });
  assert.ok(eased.state.grooveScore < 0.5 && eased.state.groove === 0, `eased: ${f(eased.state.grooveScore)}`);
  assert.ok(best.kn > eased.kn + 0.2, `the groove's lift is the physics': ${f(best.kn)} vs ${f(eased.kn)} kn`);
  // pinching (TWA 36°) loses VMG
  assert.ok(at(12, 36).state.grooveScore < 0.75, 'pinching is in the groove');
  // a broad reach and a run at the crew's trim are in (target speed; deep, the downwind VMG)
  for (const twa of [90, 135, 170]) assert.ok(at(12, twa).state.grooveScore > 0.9, `TWA ${twa}°`);
  // too much heel: the factor falls from 22° to 0 at 30°
  assert.equal(grooveScore({ ...best.state, heel: 30 * DEG }).heel, 0);
  assert.equal(grooveScore({ ...best.state, heel: 18 * DEG }).heel, 1);
  // no wind or no way: 0
  assert.equal(grooveScore({ ...best.state, u: 0.1 }).score, 0);
});

test('the groove lock: in after 1.5 s over 0.75, out under 0.55, held counts the seconds', () => {
  const L = new GrooveLock();
  let o;
  for (let i = 0; i < 60; i++) o = L.update(DT, 1);   // 1 s at full score: the smoothed score still climbing
  assert.equal(o.locked, false);
  for (let i = 0; i < 9 * 60; i++) o = L.update(DT, 0.95);
  assert.ok(o.locked && o.held > 7 && o.held < 9, `held ${f(o.held, 1)} s`);
  for (let i = 0; i < 60; i++) o = L.update(DT, 0.7);   // a dip to 0.7 keeps it
  assert.ok(o.locked);
  for (let i = 0; i < 3 * 60; i++) o = L.update(DT, 0.2);
  assert.ok(!o.locked && o.held === 0 && o.level === 0);
  assert.ok(GROOVE.in > GROOVE.out);
});

test('the polar table matches the physics (spot checks) and the best VMG angles are where a C28 sails', () => {
  for (const [i, j] of [[4, 6], [8, 14], [10, 22]]) {
    const r = steadyState({ twsKn: POLAR_TWS[i], twaDeg: POLAR_TWA[j] });
    assert.ok(Math.abs(r.kn - POLAR_KN[i][j]) < 0.05, `${POLAR_TWS[i]} kn at ${POLAR_TWA[j]}°: ${f(r.kn, 3)} vs table ${POLAR_KN[i][j]} (re-run tools/groove_polar.mjs)`);
  }
  const up = bestVmg(12, true), dn = bestVmg(12, false);
  assert.ok(up.twa >= 40 && up.twa <= 48, `best upwind ${up.twa}°`);
  assert.ok(dn.twa >= 150, `best downwind ${dn.twa}°`);
  assert.ok(Math.abs(polarKn(12, 44) - 5.55) < 0.05);
});

test('the sound: the surf roars, the rail hisses, a slam and a round-up are events, the groove silences the luff and sings one note', () => {
  const base = { sog: 3.6, u: 3.6, apparentWind: { speed: 8, angle: 1.2 }, mainFill: 0.6, jibFill: 0.6, heel: 0.2, drive: 900, side: 1200 };
  const m0 = thrillMix(base, 7, 8), surf = thrillMix({ ...base, surf: 1 }, 7.2, 8), rail = thrillMix({ ...base, rail: 1 }, 6, 8);
  assert.ok(m0.roar === 0 && surf.roar > 0.9 * LEVEL.roar, 'roar');
  assert.ok(m0.hiss === 0 && rail.hiss > 0.9 * LEVEL.hiss, 'hiss');
  const gr = thrillMix({ ...base, groove: 1 }, 6, 8);
  assert.ok(gr.note > 0.9 * LEVEL.note && Math.abs(gr.noteHz - 0.2 * 8 / THRILL.wireM) < 1, `note ${f(gr.noteHz, 0)} Hz`);
  // the slam fires once as the cue rises, not again within the gap; the round-up once at its onset; the swell at 8 s
  const w = new ThrillWatch();
  const ev = (t, s) => w.update(t, { ...base, ...s }).map((e) => e.kind);
  assert.deepEqual(ev(0, { slam: 0.1 }), []);
  assert.deepEqual(ev(0.1, { slam: 0.8 }), ['slam']);
  assert.deepEqual(ev(0.2, { slam: 0.1 }), []);
  assert.deepEqual(ev(0.3, { slam: 0.9 }), [], 'two slams within the gap');
  assert.deepEqual(ev(1.5, { slam: 0.1 }), []); assert.deepEqual(ev(1.6, { slam: 0.9 }), ['slam']);
  assert.deepEqual(ev(2, { roundUp: 0.7 }), ['roundup']); assert.deepEqual(ev(2.1, { roundUp: 0.9 }), []);
  assert.deepEqual(ev(3, { grooveHeld: 7.9 }), []); assert.deepEqual(ev(3.1, { grooveHeld: 8.05 }), ['swell']); assert.deepEqual(ev(3.2, { grooveHeld: 8.1 }), []);
  // the groove in the mixer: a luffing sail's flutter is silent, the hum holds steady
  const mix = (s) => { const m = new BoatMix({ seed: 1 }); let o; for (let i = 0; i < 30; i++) o = m.step(i / 30, { ...base, ...s }); return o; };
  const out = mix({}), inG = mix({ groove: 1 });
  assert.ok(out.gains.flutter > 0.1 && inG.gains.flutter === 0 && inG.gains.note > 0, `flutter ${f(out.gains.flutter)} → ${f(inG.gains.flutter)}`);
  // a round-up flogs whatever the apparent angle
  assert.ok(mix({ roundUp: 1 }).gains.flog > LEVEL.flog, 'the round-up flogs');
});

test('the groove swell: never in the first 90 s, never over a bed, at most once every 4 minutes', () => {
  const S = new BedScheduler({ seed: 1 });
  assert.equal(S.groove(60), null);
  assert.ok(S.groove(100));
  assert.equal(S.groove(100 + GROOVE_SWELL.gapS - 1), null);
  assert.ok(S.groove(100 + GROOVE_SWELL.gapS + 1));
  const T = new BedScheduler({ seed: 1, firstS: 0 });
  T.cue('golden', 500);   // a bed playing from 500 s to 620 s
  assert.equal(T.groove(550), null, 'over a bed');
  assert.equal(T.groove(630), null, 'within 30 s of a bed');
  assert.ok(T.groove(660));
  assert.ok(GROOVE_SWELL.durS <= 10 && GROOVE_SWELL.level < 0.1, 'a short, soft swell');
});
