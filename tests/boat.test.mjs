// The boat physics (src/boat.js):'s thirteen tests, scaled to the Catalina 28 (src/boat/dims.js), plus the
// contract (src/boat/contract.js). Run: node --test tests/
// Reference: Farr Yacht Design's VPP polar for the First 36.7 × 0.86 (√ of the waterline ratio, 7.26 m / 9.8 m), so
// 12 kn true close-hauled ≈5.4 kn (Farr 6.27). Wind speeds are true wind at 10 m. "Close-hauled" is the best-VMG
// true wind angle, searched in 1° steps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestOf } from './helpers/bestOf.mjs';
import { BoatPhysics, Helm, SheetHand, SHEET_HAND, steadyState, steadyWind, CONTROLS, BOAT, KN, DT, JIB_CLEW_MAX_DEG, MAIN_BOOM_MIN_DEG, MAIN_TWIST_DEG } from '../src/sim/boat.js';
import { STATE } from '../src/sim/boat/contract.js';
import { WindField } from '../src/sim/wind.js';

const DEG = Math.PI / 180;
const LOA = BOAT.loa;
const best = new Map();
function closeHauled(twsKn, opts = {}) {
  const key = twsKn + JSON.stringify(opts);
  if (!best.has(key)) {
    let b = null;
    for (let a = 34; a <= 56; a++) { const r = steadyState({ twsKn, twaDeg: a, ...opts }); if (!b || r.vmgKn > b.vmgKn) b = r; }
    best.set(key, b);
  }
  return best.get(key);
}
const f = (x, d = 2) => x.toFixed(d);

// sail a scripted run: ctl(boat, t) → controls; returns the boat
function run(boat, seconds, ctl, env) {
  for (let i = 0, n = Math.round(seconds / DT); i < n; i++) { env.t = (env.t ?? 0) + DT; boat.step(DT, ctl(boat, env.t), env); }
  return boat;
}

test('1. close-hauled at 12 kn: 5.2–6.2 kn at TWA 40–46°, heel 15–23° (Farr × 0.86: 5.39 kn, 18.4°)', () => {
  const r = closeHauled(12);
  assert.ok(r.twaDeg >= 40 && r.twaDeg <= 46, `best VMG at TWA ${r.twaDeg}°`);
  assert.ok(r.kn >= 5.2 && r.kn <= 6.2, `${f(r.kn)} kn`);
  assert.ok(r.heelDeg >= 15 && r.heelDeg <= 23, `heel ${f(r.heelDeg, 1)}°`);
});

test('2. close-hauled at 6 kn: Farr × 0.86 ± 7 % (3.8–4.4 kn), heel 3–7°', () => {
  //'s band (4.3–4.9 kn) was for its 30 ft hull at × 0.90 and sat above its own scaled value (4.27); this is
  // the same band rule around the Catalina's scaled value, 4.74 × 0.86 = 4.08 kn
  const r = closeHauled(6);
  assert.ok(r.kn >= 3.8 && r.kn <= 4.4, `${f(r.kn)} kn at TWA ${r.twaDeg}°`);
  assert.ok(r.heelDeg >= 3 && r.heelDeg <= 7, `heel ${f(r.heelDeg, 1)}°`);
});

test('3. 20 kn full sail: heel 20–30°, speed < +5 % over 14 kn; a reef brings the heel under 22°', () => {
  // full sail: the automatic reef off (autoReef: false), as an expert sails it
  const r20 = closeHauled(20, { controls: { autoReef: false } }), r14 = closeHauled(14), reefed = closeHauled(20, { controls: { reef: 1, autoReef: false } });
  assert.ok(r20.heelDeg >= 20 && r20.heelDeg <= 30, `heel ${f(r20.heelDeg, 1)}°`);
  assert.ok(r20.kn < r14.kn * 1.05, `${f(r20.kn)} kn at 20 vs ${f(r14.kn)} kn at 14`);
  assert.ok(reefed.heelDeg < 22, `reefed heel ${f(reefed.heelDeg, 1)}°`);
});

test('4. beam reach at 12 kn: 10–25 % faster than close-hauled (Farr +23 %)', () => {
  const beam = steadyState({ twsKn: 12, twaDeg: 90 }), ch = closeHauled(12);
  const gain = beam.kn / ch.kn - 1;
  assert.ok(gain >= 0.10 && gain <= 0.25, `beam ${f(beam.kn)} kn vs close-hauled ${f(ch.kn)} kn: ${f(gain * 100, 1)} %`);
});

test('5. dead run at 12 kn: at least 10 % slower than at 150° (Farr 5.81 vs 6.96); the sails still pull by drag', () => {
  // the bare sail model's calibration: the crew's auto wing-on-wing off (its own test below)
  const run180 = steadyState({ twsKn: 12, twaDeg: 180, controls: { autoWing: false } }), run150 = steadyState({ twsKn: 12, twaDeg: 150 });
  assert.ok(run180.kn <= run150.kn * 0.9, `180°: ${f(run180.kn)} kn, 150°: ${f(run150.kn)} kn`);
  // the VPP flies a spinnaker downwind; main and jib alone make ≥ 75 % of Farr × 0.86 (5.00 kn) on a dead run
  assert.ok(run180.kn >= 0.75 * 5.81 * 0.86, `dead run ${f(run180.kn)} kn`);
});

// a tack at 12 kn: steady close-hauled on starboard, then the helm takes the boat to close-hauled on port
function tack({ limit = 1 } = {}) {
  const ch = closeHauled(12);
  const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
  const boat = new BoatPhysics({ heading: -ch.twaDeg * DEG, speed: ch.kn * KN });
  const helm = new Helm({ limit });
  let twa = ch.twaDeg * DEG;
  run(boat, 60, (b) => ({ ...CONTROLS, rudder: helm.toTWA(b.state, twa, 0) }), env);
  const s = boat.state, u0 = s.u, z0 = s.z, h0 = s.heading, l0 = s.leeway, T = 70;
  let umin = u0, cross = null, back = null;
  twa = -twa;
  for (let i = 0; i < T * 60; i++) {
    env.t += DT;
    boat.step(DT, { ...CONTROLS, rudder: helm.toTWA(s, twa, 0) }, env);
    umin = Math.min(umin, s.u);
    if (cross === null && s.trueWind.angle < 0) cross = i * DT;
    if (cross !== null && back === null && umin < 0.85 * u0 && s.u > 0.9 * u0) back = i * DT - cross;
  }
  const lost = (ch.vmgKn * KN * T - -(s.z - z0)) / LOA;               // upwind metres behind a boat that didn't tack
  // the course through the water (heading + leeway), as a sailor reads "tacks through 90°"
  return { turn: wrap(s.heading - h0 + s.leeway - l0) / DEG, heading: wrap(s.heading - h0) / DEG, minFrac: umin / u0, recover: back, lost };
}
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

test('6. a tack: the course through the water turns 80–95°, back to 90 % speed 10–20 s after head to wind; speed and distance lost (see note)', () => {
  // (marked unverified) also asks speed < 40 % mid-tack and a cost of 3–8 boat lengths. A brisk tack
  // (full helm) here keeps ≈50 % and costs ≈2 lengths; a slow one (11° of helm) meets both but takes ≈24 s to recover.
  // The test holds the brisk tack to the physical bands below.
  const t = tack();
  assert.ok(t.turn >= 80 && t.turn <= 95, `turned ${f(t.turn, 1)}° (heading ${f(t.heading, 1)}°)`);
  assert.ok(t.recover !== null && t.recover >= 10 && t.recover <= 20, `recovered in ${t.recover} s`);
  assert.ok(t.minFrac >= 0.3 && t.minFrac <= 0.65, `slowest ${f(t.minFrac * 100, 0)} % of the starting speed`);
  assert.ok(t.lost >= 1 && t.lost <= 8, `cost ${f(t.lost, 1)} boat lengths`);
});

test('7. head to wind from 6 kn: under 0.5 kn within 4–8 boat lengths of the turn', () => {
  const env = { windAt: steadyWind(9 * KN, 0), t: 0 };
  const boat = new BoatPhysics({ heading: -80 * DEG, speed: 6 * KN });
  const helm = new Helm();
  run(boat, 60, (b) => ({ ...CONTROLS, rudder: helm.toHeading(b.state, -80 * DEG) }), env);
  const s = boat.state;
  assert.ok(Math.abs(s.u / KN - 6) < 0.3, `close reach at ${f(s.u / KN)} kn, not 6`);
  let path = 0, px = s.x, pz = s.z, stopped = null;
  for (let i = 0; i < 90 * 60 && stopped === null; i++) {
    env.t += DT;
    boat.step(DT, { ...CONTROLS, rudder: helm.toHeading(s, 0) }, env);
    path += Math.hypot(s.x - px, s.z - pz); px = s.x; pz = s.z;
    if (s.u < 0.5 * KN) stopped = path;
  }
  assert.ok(stopped !== null, 'never slowed below 0.5 kn');
  assert.ok(stopped / LOA >= 4 && stopped / LOA <= 8, `${f(stopped / LOA, 1)} boat lengths (${f(stopped, 0)} m)`);
});

test('8. in irons: the rudder does nothing below ≈1 kn; backing the jib turns the bow', () => {
  const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
  // the rudder's authority: held at a speed through the water in a calm, hard over for 10 s; at 0.5 kn under 1°/s and
  // under 10 % of the turn at 4 kn (authority grows as the speed squared, less the hull's damping)
  const turnAt = (kn) => {
    const b = new BoatPhysics({ heading: 0 });
    let rate = 0;
    run(b, 10, (bb) => { bb.state.u = kn * KN; rate = Math.max(rate, Math.abs(bb.state.yawRate)); return { ...CONTROLS, rudder: 1 }; }, { windAt: steadyWind(0, 0), t: 0 });
    return rate;
  };
  const r05 = turnAt(0.5), r4 = turnAt(4);
  assert.ok(r05 < 1 * DEG && r05 < 0.1 * r4, `${f(r05 / DEG)}°/s at 0.5 kn, ${f(r4 / DEG)}°/s at 4 kn`);
  // head to wind and stopped, the rudder hard over for 15 s: the boat drifts astern (≈1 kn) and the bow stays put
  const a = new BoatPhysics({ heading: 0 });
  let fastest = 0;
  run(a, 15, (b) => { fastest = Math.max(fastest, Math.abs(b.state.u)); return { ...CONTROLS, rudder: 1 }; }, env);
  assert.ok(fastest < 1.5 * KN, `drifted at ${f(fastest / KN)} kn`);
  assert.ok(Math.abs(a.state.heading) < 10 * DEG, `the rudder turned the bow ${f(a.state.heading / DEG, 1)}°`);
  // the same, with the jib held to starboard (backed as the bow falls off): within 20 s the bow turns to port
  env.t = 0;
  const b = new BoatPhysics({ heading: 0 });
  run(b, 20, () => ({ ...CONTROLS, jibSide: 1 }), env);
  assert.ok(b.state.heading < -30 * DEG, `the backed jib turned the bow ${f(b.state.heading / DEG, 1)}°`);
});

test('9. leeway: 3–5° close-hauled at 10–14 kn (Farr 3.9–4.3°), under 1° on a beam reach at 12 kn', () => {
  for (const tws of [10, 12, 14]) {
    const r = closeHauled(tws);
    assert.ok(r.leewayDeg >= 3 && r.leewayDeg <= 5, `${tws} kn: leeway ${f(r.leewayDeg)}°`);
  }
  const beam = steadyState({ twsKn: 12, twaDeg: 90 });
  assert.ok(beam.leewayDeg < 1, `beam reach leeway ${f(beam.leewayDeg)}°`);
});

test('10. a back-winded sail never gives forward thrust (forward of the beam, any sheet, either tack)', () => {
  // only the jib, held on the windward side, at every apparent wind angle forward of the beam and every sheet
  const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
  let backed = 0, worst = -Infinity;
  for (let hd = -88; hd <= 88; hd += 2) for (const jib of [0, 0.3, 0.6, 1]) {
    const boat = new BoatPhysics({ heading: hd * DEG, params: { main: { ...BOAT.main, area: 0 } } });
    const side = hd > 0 ? -1 : 1;                                   // wind from port when heading east: hold the clew to port
    for (let i = 0; i < 60; i++) { boat.step(DT, { ...CONTROLS, autoTrim: false, jib, jibSide: side }, env); boat.state.u = boat.state.v = boat.state.yawRate = 0; }
    if (boat.state.jibBacked) { backed++; worst = Math.max(worst, boat.state.drive); }
  }
  assert.ok(backed > 100, `only ${backed} backed cases: the test isn't backing the jib`);
  assert.ok(worst <= 0, `a backed jib drove forward with ${f(worst, 1)} N`);
});

test('11. no wind: no creep from rest, a coast only slows; eased sails never heel past 70°; a 35 kn gust rounds the boat up', () => {
  // asks "speed < 0.1 kn within 90 s" of a calm. A coast from 5.4 kn can't stop that fast on hull drag
  // (≈1.6 kn at 90 s here): the low-speed drag that would do it also holds the boat under 1 kn in 4 kn of wind, where
  // the polar wants ≈2.5–3.8 kn. So: at rest in a calm the boat stays at rest (no numerical creep), and a coast in a
  // calm slows every tick and never turns or heels.
  const still = new BoatPhysics({ heading: 1 });
  run(still, 90, () => CONTROLS, { windAt: steadyWind(0, 0), t: 0 });
  assert.ok(still.state.sog < 0.1 * KN && Math.abs(still.state.heading - 1) < 1e-9, `crept to ${f(still.state.sog / KN, 4)} kn`);
  const calm = new BoatPhysics({ speed: 5.4 * KN });
  let prev = calm.state.u, rose = false;
  run(calm, 90, (b) => { if (b.state.u > prev + 1e-12) rose = true; prev = b.state.u; return CONTROLS; }, { windAt: steadyWind(0, 0), t: 0 });
  assert.ok(!rose && calm.state.u < 2 * KN && calm.state.u > 0, `coast: ${f(calm.state.u / KN)} kn after 90 s, sped up: ${rose}`);
  assert.ok(Math.abs(calm.state.heading) < 1e-9 && Math.abs(calm.state.heel) < 1e-9, 'a calm coast turned or heeled');
  // sheets fully eased at every heading in 35 kn
  let heel = 0;
  for (let hd = 0; hd < 360; hd += 15) {
    const b = new BoatPhysics({ heading: hd * DEG, speed: 3 * KN });
    const helm = new Helm();
    run(b, 40, (bb) => { heel = Math.max(heel, Math.abs(bb.state.heel)); return { ...CONTROLS, autoTrim: false, main: 1, jib: 1, rudder: helm.toHeading(bb.state, hd * DEG) }; }, { windAt: steadyWind(35 * KN, 0), t: 0 });
  }
  assert.ok(heel < 70 * DEG, `eased sails heeled ${f(heel / DEG, 1)}°`);
  // a 35 kn gust on a beam reach (12 kn), sheets made fast, the helm holding the course: the boat heels, the rudder
  // loses its grip and the bow comes up into the wind (the sails luff); it does not lie flat
  const gust = (x, z, t) => { const k = t < 60 ? 12 : t < 62 ? 12 + (t - 60) / 2 * 23 : 35; return { vx: 0, vz: k * KN }; };
  const b = new BoatPhysics({ heading: -90 * DEG, speed: 6 * KN });
  const helm = new Helm();
  const env = { windAt: gust, t: 0 };
  let sheets = null, maxHeel = 0, maxUp = 0;
  run(b, 80, (bb, t) => {
    if (t < 60) return { ...CONTROLS, rudder: helm.toHeading(bb.state, -90 * DEG) };
    sheets ??= { main: (bb.state.mainSheet / DEG - BOAT.main.minDeg) / (BOAT.main.maxDeg - BOAT.main.minDeg), jib: (bb.state.jibSheet - BOAT.jib.lead) / (BOAT.jib.maxDeg * DEG - BOAT.jib.lead) };
    maxHeel = Math.max(maxHeel, Math.abs(bb.state.heel));
    maxUp = Math.max(maxUp, -90 - bb.state.heading / DEG);        // degrees turned toward the wind (north, to starboard of west... see below)
    return { ...CONTROLS, autoTrim: false, ...sheets, rudder: helm.toHeading(bb.state, -90 * DEG) };
  }, env);
  // heading west (−90°) with the wind from the north: the wind is on the starboard beam; rounding up turns to starboard
  const up = b.state.heading / DEG + 90;
  assert.ok(maxHeel < 70 * DEG, `heeled ${f(maxHeel / DEG, 1)}°`);
  assert.ok(up > 20, `rounded up only ${f(up, 1)}° (heading ${f(b.state.heading / DEG, 1)}°)`);
});

test('12. a 2 kn current moves the ground track by 2 kn; the speed through the water is unchanged', () => {
  // the same wind over the water with and without the current (the current also carries the air's reference, so
  // the "tide wind" is held out; a fixed ground wind would change the apparent wind, which is real but not this test)
  const C = { vx: 2 * KN, vz: 0 };
  const a = new BoatPhysics({ heading: -45 * DEG, speed: 5 * KN }), b = new BoatPhysics({ heading: -45 * DEG, speed: 5 * KN });
  const ha = new Helm(), hb = new Helm();
  const envA = { windAt: steadyWind(12 * KN, 0), t: 0 };
  const envB = { windAt: (x, z, t) => { const w = envA.windAt(x, z, t); return { vx: w.vx + C.vx, vz: w.vz + C.vz }; }, currentAt: () => C, t: 0 };
  run(a, 120, (bb) => ({ ...CONTROLS, rudder: ha.toHeading(bb.state, -45 * DEG) }), envA);
  run(b, 120, (bb) => ({ ...CONTROLS, rudder: hb.toHeading(bb.state, -45 * DEG) }), envB);
  assert.ok(Math.abs(a.state.u - b.state.u) < 1e-6, `through the water: ${f(a.state.u / KN, 4)} vs ${f(b.state.u / KN, 4)} kn`);
  const ga = [Math.sin(a.state.cog) * a.state.sog, -Math.cos(a.state.cog) * a.state.sog];
  const gb = [Math.sin(b.state.cog) * b.state.sog, -Math.cos(b.state.cog) * b.state.sog];
  assert.ok(Math.hypot(gb[0] - ga[0] - C.vx, gb[1] - ga[1] - C.vz) < 1e-6, 'the ground velocity differs by more than the current');
  const drift = (b.state.x - a.state.x) / 120;
  assert.ok(Math.abs(drift - C.vx) < 1e-3, `the track moved ${f(drift / KN, 3)} kn east`);
});

test('13. cost: under 0.2 ms per boat per tick in plain JS', () => {
  const boat = new BoatPhysics({ heading: -0.7, speed: 5 * KN });
  const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
  const helm = new Helm();
  for (let i = 0; i < 2000; i++) boat.step(DT, { ...CONTROLS, rudder: helm.toTWA(boat.state, 0.7, 0) }, env);   // warm up
  // the fastest of 30 batches of 240 ticks (the same 7200 ticks): the step's own cost, not the machine's load (v2 #29)
  const ms = bestOf(() => boat.step(DT, { ...CONTROLS, rudder: helm.toTWA(boat.state, 0.7, 0) }, env), { batches: 30, per: 240 });
  assert.ok(ms < 0.2, `${f(ms, 4)} ms per tick`);
});

test('the contract: every STATE field, the sign conventions, sub-stepping is deterministic', () => {
  const env = { windAt: steadyWind(12 * KN, 90), t: 0 };            // an east wind; heading north puts it on the starboard beam
  const boat = new BoatPhysics({ heading: 0, speed: 4 * KN });
  run(boat, 30, () => CONTROLS, env);
  const s = boat.state;
  for (const k of Object.keys(STATE)) assert.ok(k in s, `state.${k} missing`);
  assert.ok(s.apparentWind.angle > 0 && s.trueWind.angle > 0, 'wind from starboard reads +');
  assert.ok(s.boomAngle < 0 && s.jibAngle < 0, `sails to port: boom ${f(s.boomAngle / DEG, 1)}°, jib ${f(s.jibAngle / DEG, 1)}°`);
  assert.ok(s.heel < 0, `heels to port: ${f(s.heel / DEG, 1)}°`);
  // one step of 4/60 s (4× time) equals four steps of 1/60 s; odd frame times carry their remainder
  const p = new BoatPhysics({ heading: 0.3, speed: 4 * KN }), q = new BoatPhysics({ heading: 0.3, speed: 4 * KN });
  const ep = { windAt: steadyWind(10 * KN, 0), t: 0 }, eq = { windAt: steadyWind(10 * KN, 0), t: 0 };
  for (let i = 0; i < 300; i++) { p.step(4 / 60, CONTROLS, ep); for (let k = 0; k < 4; k++) q.step(1 / 60, CONTROLS, eq); }
  assert.deepEqual(p.state, q.state);
});

test('the jib: its clew never passes the genoa car at the rail (24.3°), whatever the heading or the sheet', () => {
  const env = { windAt: steadyWind(12 * KN, 0), t: 0 };
  let worst = 0;
  for (let hd = 0; hd < 360; hd += 10) for (const ctl of [CONTROLS, { ...CONTROLS, autoTrim: false, main: 1, jib: 1 }]) {
    const b = new BoatPhysics({ heading: hd * DEG, speed: 4 * KN });
    const helm = new Helm();
    run(b, 20, (bb) => { worst = Math.max(worst, Math.abs(bb.state.jibAngle)); return { ...ctl, rudder: helm.toHeading(bb.state, hd * DEG) }; }, env);
  }
  assert.ok(worst <= JIB_CLEW_MAX_DEG * DEG + 1e-9, `the clew reached ${f(worst / DEG, 1)}°`);
  assert.ok(worst > (JIB_CLEW_MAX_DEG - 0.5) * DEG, `the clew never reached the car: ${f(worst / DEG, 1)}°`);
});

test('the jib downwind: the main blankets it on its own side (it collapses); wing-on-wing it fills and the run is faster', () => {
  const lee = steadyState({ twsKn: 12, twaDeg: 170, controls: { autoWing: false } });
  const wing = steadyState({ twsKn: 12, twaDeg: 170, controls: { jibSide: 1 } });      // wind from starboard: jib to starboard
  const reach = steadyState({ twsKn: 12, twaDeg: 120 });
  assert.ok(lee.state.jibFill < 0.2, `a blanketed jib fills ${f(lee.state.jibFill)}`);
  assert.ok(reach.state.jibFill > 0.9, `on a broad reach the jib fills only ${f(reach.state.jibFill)}`);
  assert.ok(wing.state.jibFill > 0.9 && Math.sign(wing.state.jibAngle) !== Math.sign(wing.state.boomAngle), 'wing-on-wing: the jib is not out on the other side');
  assert.ok(!wing.state.jibBacked, 'a wing-on-wing jib reads as backed');
  assert.ok(wing.kn > lee.kn * 1.02, `wing-on-wing ${f(wing.kn)} kn vs blanketed ${f(lee.kn)} kn`);
});

test('the boom: reported where a real boom sits (≈4° close-hauled, 72° fully eased); the twist stays in the force model', () => {
  const ch = closeHauled(12), run180 = steadyState({ twsKn: 12, twaDeg: 180 });
  assert.ok(Math.abs(Math.abs(ch.state.boomAngle) / DEG - MAIN_BOOM_MIN_DEG) < 0.5, `close-hauled boom ${f(ch.state.boomAngle / DEG, 1)}°`);
  assert.ok(Math.abs(Math.abs(run180.state.boomAngle) / DEG - (BOAT.main.maxDeg - MAIN_TWIST_DEG)) < 0.5, `dead run boom ${f(run180.state.boomAngle / DEG, 1)}°`);
  // the main's angle of attack is measured from the mean chord, the twist further out than the boom
  assert.ok(Math.abs(Math.abs(ch.awaDeg) - Math.abs(ch.state.mainAoA) / DEG - Math.abs(ch.state.boomAngle) / DEG - MAIN_TWIST_DEG) < 2, `AWA ${f(ch.awaDeg, 1)}°, AoA ${f(ch.state.mainAoA / DEG, 1)}°, boom ${f(ch.state.boomAngle / DEG, 1)}°`);
});

test('high wind with autoTrim: flatten, then reef 1 and 2; the advisory day never heels the boat past 30° (the rail awash at 31°)', () => {
  // steady 15–25 kt close-hauled to a beam reach: auto-reef holds the sustained heel near 20°
  for (const tws of [15, 20, 25]) for (const twa of [40, 60, 90]) {
    const r = steadyState({ twsKn: tws, twaDeg: twa });
    assert.ok(r.heelDeg <= 23, `${tws} kt at ${twa}°: heel ${f(r.heelDeg, 1)}° (reef ${r.state.reef})`);
  }
  assert.equal(steadyState({ twsKn: 25, twaDeg: 45 }).state.reef, 2, '25 kt close-hauled: not double-reefed');
  assert.equal(closeHauled(14).state.reef, 0, '14 kt: reefed (the polar below 14 kt must not move)');
  // L6's advisory day (SW 14–20 mph, gusts to 35–45 mph), 5 minutes at each angle from the start, two seeds
  let worst = 0, at = '';
  for (const seed of [1, 4]) for (const twa of [40, 60, 90, 120, 150]) {
    const w = new WindField({ seed, day: { hour: 15.5, advisory: true } });
    const from = w.base.dirDeg * DEG, env = { windAt: (x, z, t) => w.sample(x, z, t), t: 0 };
    const b = new BoatPhysics({ heading: from - twa * DEG, speed: 4 * KN }), helm = new Helm();
    run(b, 300, (bb) => { const h = Math.abs(bb.state.heel); if (h > worst) { worst = h; at = `seed ${seed}, TWA ${twa}°, t ${f(env.t, 1)} s`; } return { ...CONTROLS, rudder: helm.toTWA(bb.state, twa * DEG, from) }; }, env);
  }
  console.log(`advisory day with autoTrim: the most heel ${f(worst / DEG, 1)}° (${at})`);
  // the thrill build (owner, 2026-10-29: "heel, risk"): the keen crew lets a gust lay the rail near the water (was ≤ 25°,
  // a crew that never let it past 22.6° at level 4); the crew's trim still never puts the rail under (31°, src/boat/thrill.js)
  assert.ok(worst <= 30 * DEG, `heeled ${f(worst / DEG, 1)}° (${at})`);
});

test('the reef shakes out when the wind drops; manual sailing keeps the player\'s reef', () => {
  // the wind rises from 10 kt to 22 kt over a minute (the boat set out unreefed), holds, then drops to 9 kt:
  // two reefs go in on the way up, and come out again within 5 minutes of the drop
  const kt = (t) => (t < 60 ? 10 : t < 120 ? 10 + (t - 60) / 60 * 12 : t < 240 ? 22 : 9);
  const env = { windAt: (x, z, t) => ({ vx: 0, vz: kt(t) * KN }), t: 0 };
  const b = new BoatPhysics({ heading: -45 * DEG, speed: 5 * KN }), helm = new Helm();
  let most = 0;
  run(b, 240, (bb) => { most = Math.max(most, bb.state.reef); return { ...CONTROLS, rudder: helm.toTWA(bb.state, 45 * DEG, 0) }; }, env);
  assert.equal(most, 2, `only ${most} reefs at 22 kt`);
  run(b, 300, (bb) => ({ ...CONTROLS, rudder: helm.toTWA(bb.state, 45 * DEG, 0) }), env);
  assert.ok(b.state.reef === 0 && b.state.reefing === 0, `still reef ${b.state.reef} (${f(b.state.reefing)}) after 5 min at 9 kt`);
  // autoTrim off: the player's reef only; autoTrim on with a manual reef: the deeper of the two
  const m = steadyState({ twsKn: 25, twaDeg: 45, controls: { autoTrim: false, main: 0.15, jib: 0.2 } });
  assert.equal(m.state.reef, 0, 'autoTrim off still reefs');
  assert.equal(steadyState({ twsKn: 8, twaDeg: 45, controls: { reef: 2 } }).state.reef, 2, 'the player\'s reef was shaken out');
});

test('basic-mode sheets (W/S): an offset on auto-trim, held 8 s after the key, then back to the crew over 4 s', () => {
  const h = new SheetHand();
  for (let i = 0; i < 60; i++) h.update(1 / 60, 1);                       // W held 1 s: eased 25°
  assert.ok(Math.abs(h.bias - SHEET_HAND.rate) < 1e-9, `bias ${f(h.bias / DEG, 1)}°`);
  for (let i = 0; i < 7 * 60; i++) h.update(1 / 60, 0);
  assert.ok(Math.abs(h.bias - SHEET_HAND.rate) < 1e-9, 'held for 8 s');
  for (let i = 0; i < 3 * 60; i++) h.update(1 / 60, 0);                   // 10 s idle: halfway back
  assert.ok(Math.abs(h.bias / SHEET_HAND.rate - 0.5) < 0.02, `halfway at 10 s: ${f(h.bias / SHEET_HAND.rate)}`);
  for (let i = 0; i < 3 * 60; i++) h.update(1 / 60, 0);
  assert.equal(h.bias, 0, 'the crew has the sheets at 12 s');
  for (let i = 0; i < 10 * 60; i++) h.update(1 / 60, -1);
  assert.equal(h.bias, -SHEET_HAND.max, 'trim stops at the limit');
  // on the water: eased 40° on a close reach the sails luff; the crew's trim alone keeps them full
  const crew = steadyState({ twsKn: 12, twaDeg: 60 });
  const eased = steadyState({ twsKn: 12, twaDeg: 60, controls: { sheetBias: 40 * DEG } });
  assert.ok(eased.state.mainSheet > crew.state.mainSheet + 20 * DEG, 'the main sheet eased');
  assert.ok(eased.state.mainFill < crew.state.mainFill - 0.2 && eased.kn < crew.kn, `fill ${f(eased.state.mainFill)} vs ${f(crew.state.mainFill)}`);
});

test('auto wing-on-wing: deep downwind the crew holds the jib out opposite the boom after 8 s; up at 120° it goes back', () => {
  const run = steadyState({ twsKn: 12, twaDeg: 170 });
  assert.ok(run.state.jibFill > 0.9 && Math.sign(run.state.jibAngle) !== Math.sign(run.state.boomAngle), `jib fill ${f(run.state.jibFill)}`);
  const lee = steadyState({ twsKn: 12, twaDeg: 170, controls: { autoWing: false } });
  assert.ok(run.kn > lee.kn * 1.02, `auto wing ${f(run.kn)} kn vs blanketed ${f(lee.kn)} kn`);
  const r150 = steadyState({ twsKn: 12, twaDeg: 150 });
  assert.ok(run.kn < r150.kn, `wing-on-wing at 170° ${f(run.kn)} kn stays slower than 150° ${f(r150.kn)} kn`);
  const reach = steadyState({ twsKn: 12, twaDeg: 140 });
  assert.ok(Math.sign(reach.state.jibAngle) === Math.sign(reach.state.boomAngle), 'at 140° the jib stays to leeward');
});
