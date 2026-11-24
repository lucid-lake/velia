// The auxiliary (src/boat/engine.js) in the physics (src/boat.js § 9): thrust, top speed under power, the idle creep,
// prop walk astern, steerage at low speed, the start and the stop. Run: node --test tests/engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, KN, DT, steadyWind, Helm } from '../src/sim/boat.js';
import { Engine, ENGINE, propThrust, propWalk, leverToGear, washAtRudder } from '../src/sim/boat/engine.js';

const DEG = Math.PI / 180;
// motor in a calm with the sails down: lever after 2 s (the engine warmed to idle), seconds of sim time
function motor(lever, { secs = 120, u0 = 0, rudder = 0, wind = 0, start = true, every = null } = {}) {
  const b = new BoatPhysics({ heading: 0, speed: u0 });
  if (start) b.engine.start();
  b.furlPos = 1;
  const env = { windAt: steadyWind(wind, 180), t: 0 }, rows = [];
  for (let i = 0; i <= secs / DT; i++) {
    env.t = i * DT;
    b.step(DT, { ...CONTROLS, furl: 1, rudder, throttle: i * DT < 2 ? 0 : lever }, env);
    if (every && i % Math.round(every / DT) === 0) rows.push({ t: i * DT, u: b.state.u, heading: b.state.heading, yawRate: b.state.yawRate });
  }
  return { s: b.state, rows, b };
}

test('the prop: 1.2–1.5 kN of bollard pull at full ahead, none in neutral, astern weaker', () => {
  const T = propThrust(ENGINE.rpmMax, 1, 0);
  assert.ok(T >= 1200 && T <= 1500, `bollard ${T.toFixed(0)} N`);
  assert.equal(propThrust(ENGINE.rpmMax, 0, 0), 0);
  const Ta = propThrust(ENGINE.rpmMax, -1, 0);
  assert.ok(Ta < 0 && -Ta < 0.7 * T, `astern ${Ta.toFixed(0)} N`);
  // thrust falls with the speed of advance
  assert.ok(propThrust(ENGINE.rpmMax, 1, 3) < 0.7 * T);
  assert.deepEqual(leverToGear(0.05), { gear: 0, throttle: 0 });
  assert.equal(leverToGear(-0.5).gear, -1);
});

test('top speed under power ≈ 6 kn (5.6–6.4), the idle in gear creeps at 1.5–3 kn', () => {
  const full = motor(1).s.u / KN, idle = motor(0.1).s.u / KN, half = motor(0.5).s.u / KN;
  assert.ok(full > 5.6 && full < 6.4, `full ahead ${full.toFixed(2)} kn`);
  assert.ok(idle > 1.5 && idle < 3, `idle in gear ${idle.toFixed(2)} kn`);
  assert.ok(half > idle && half < full, `half ${half.toFixed(2)} kn`);
  const astern = motor(-1).s.u / KN;
  assert.ok(astern < -2 && astern > -4.5, `full astern ${astern.toFixed(2)} kn`);
});

test('prop walk: a right-hand prop astern kicks the stern to port (the bow to starboard); ahead a little the other way', () => {
  const back = motor(-0.6, { secs: 10, every: 1 }), fwd = motor(0.6, { secs: 10, every: 1 });
  const dBack = back.s.heading / DEG, dFwd = fwd.s.heading / DEG;
  assert.ok(dBack > 2, `astern: the bow swings to starboard ${dBack.toFixed(1)}° in 8 s`);
  assert.ok(dFwd < 0 && Math.abs(dFwd) < dBack, `ahead: a smaller swing to port ${dFwd.toFixed(1)}°`);
  assert.ok(propWalk(-1000, 0) < 0 && Math.abs(propWalk(-1000, -2)) < Math.abs(propWalk(-1000, 0)), 'the walk fades with sternway');
});

test('steerage: weak drifting slowly, strong at speed, and the prop wash helps at low speed', () => {
  const maxYaw = (u0, lever, start) => Math.max(...motor(lever, { secs: 6, u0, rudder: 1, start, every: 0.1 }).rows.map((r) => r.yawRate)) / DEG;
  // hold the speed: lever 0 means neutral; the boat coasts
  const slow = maxYaw(0.5, 0, false), fast = maxYaw(2.5, 0, false), wash = maxYaw(0.5, 0.35, true);
  assert.ok(slow < 0.3 * fast, `drifting at 0.5 m/s ${slow.toFixed(2)}°/s vs 2.5 m/s ${fast.toFixed(2)}°/s`);
  assert.ok(wash > 2 * slow, `a burst ahead at 0.5 m/s ${wash.toFixed(2)}°/s`);
  assert.ok(washAtRudder(1000, 0) > 3, 'the slipstream at the rudder at bollard pull');
});

test('full ahead from a little sternway, the helm amidships: she stops, makes way ahead and goes straight (no phantom helm in the slipstream)', () => {
  // the sails coming down head to wind drift her astern; the keel's raw ±180° there once turned the slipstream's rudder share by
  // 63°, so she spun at ≈ 17°/s and stayed making sternway under full ahead (the owner's report, 2026-11-14)
  for (const u0 of [-0.1, -0.3, -0.6]) {
    const { rows, s } = motor(1, { secs: 40, u0, rudder: 0, every: 0.1 });
    const spin = rows.filter((r) => r.t > 3 && Math.abs(r.yawRate / DEG) > 5).length * 0.1;
    assert.ok(spin <= 1, `from ${u0} m/s: |yaw| over 5°/s for ${spin.toFixed(1)} s`);
    assert.ok(s.u / KN > 5.5, `from ${u0} m/s: full ahead ${(s.u / KN).toFixed(2)} kn`);
  }
});

// Astern (fix/sim-astern-rudder, 2026-11-14). The free-stream rudder once took the keel's downwash from the keel's raw angle of
// attack, ±180° in sternway: a phantom ≈ 63° of helm whose side flipped with the slightest sway, so at full astern with the
// helm amidships she circled at ≈ 7°/s, any helm turned her the same way, and the pilot could not hold a course astern.
// A rudder astern works reversed (the stern goes where the blade's trailing edge points), weaker and stalling earlier
// (Molland & Turnock 2007, p. 99: the slope 75–85 % of ahead, the stall 5–10° earlier, CLmax 45–75 %).
// Prop walk: a fixed prop's side thrust at full astern is ≈ 14 % of its astern thrust (Yachting Monthly prop test, May 2009:
// 13.9 % for the standard fixed three-blade, 9–16 % across 15 props), here 18 % at rest for the two-blade fading to 5 % with
// sternway (src/boat/engine.js). That kick swings her ≈ 2°/s at most while she gathers way, and once the rudder has flow
// ("the rudder takes over once the boat starts moving backward") ≈ 0.5°/s: 2.5°/s from 5 s on, and 1°/s once she makes her
// speed, bound it with margin.
test('full astern, the helm amidships: straight astern but for a modest prop walk (under 2.5°/s from 5 s, under 1°/s at speed)', () => {
  const { rows, s } = motor(-1, { secs: 60, rudder: 0, every: 0.1 });
  const after5 = rows.filter((r) => r.t >= 2 + 5), late = rows.filter((r) => r.t >= 30);
  const peak = Math.max(...after5.map((r) => Math.abs(r.yawRate / DEG))), lateMax = Math.max(...late.map((r) => Math.abs(r.yawRate / DEG)));
  assert.ok(peak < 2.5, `|yaw| from 5 s after the lever: ${peak.toFixed(2)}°/s (it circled at ≈ 7°/s)`);
  assert.ok(lateMax < 1, `|yaw| at speed (30–60 s): ${lateMax.toFixed(2)}°/s`);
  assert.ok(late.every((r) => r.yawRate > 0), 'the walk turns her bow to starboard (the stern to port) throughout');
  assert.ok(s.u / KN < -3.5, `full astern ${(s.u / KN).toFixed(2)} kn`);
});

test('full astern, the helm over: she turns the reversed way, weaker than ahead', () => {
  const steady = (lever, rudder) => { const { rows } = motor(lever, { secs: 40, rudder, every: 0.1 }); const r = rows.filter((x) => x.t >= 30); return r.reduce((a, x) => a + x.yawRate / DEG, 0) / r.length; };
  const stbd = steady(-1, 1), port = steady(-1, -1), ahead = steady(1, 1);
  // the stern goes to starboard (the bow to port) with the helm to starboard; the walk adds to port's turn
  assert.ok(stbd < -3, `astern, the helm to starboard: ${stbd.toFixed(2)}°/s (the bow to port)`);
  assert.ok(port > 3, `astern, the helm to port: ${port.toFixed(2)}°/s (the bow to starboard)`);
  assert.ok(ahead > 0 && Math.abs(stbd) < 0.7 * ahead && Math.abs(port) < 0.7 * ahead, `weaker than ahead's ${ahead.toFixed(2)}°/s`);
});

// The pilot (Helm: v1's and v2's autopilot, the AI skipper's helm) holds a course whenever no hand is on the helm, so it
// holds one astern too: making sternway with no thrust ahead it reverses the wheel (helmSense).
test('the pilot holds a course astern: within 8° from 20 s, within 2° from 40 s, calm or in 12 kn from any side', () => {
  for (const [kn, from] of [[0, 0], [12, 0], [12, 90], [12, 180], [12, 270]]) {
    const b = new BoatPhysics({ heading: 0 }), h = new Helm(); b.engine.start(); b.furlPos = 1;
    const env = { windAt: steadyWind(kn * KN, from), t: 0 }; let e20 = 0, e40 = 0;
    for (let i = 0; i <= 60 / DT; i++) {
      env.t = i * DT;
      b.step(DT, { ...CONTROLS, furl: 1, rudder: h.toHeading(b.state, 0, DT), throttle: i * DT < 2 ? 0 : -1 }, env);
      const e = Math.abs(b.state.heading / DEG);
      if (i * DT >= 20) e20 = Math.max(e20, e);
      if (i * DT >= 40) e40 = Math.max(e40, e);
    }
    assert.ok(b.state.u < -1.5, `${kn} kn from ${from}°: making sternway (${(b.state.u / KN).toFixed(2)} kn)`);
    assert.ok(e20 < 8 && e40 < 2, `${kn} kn from ${from}°: off course ${e20.toFixed(1)}° from 20 s, ${e40.toFixed(1)}° from 40 s`);
  }
});

// Windage: a sloop's bare-pole windage centre lies forward of the keel's pivot (the mast, the rolled jib, the high bow) and
// moves toward the windward end, so a boat stopped head to wind with her sails down falls off toward beam-on, as a boat
// left to herself lies. Start 10° off the wind in 15 kn: past 60° off within 30 s, and lying 90–135° off after 2 min.
test('windage: a stopped boat, sails down, in 15 kn falls off toward beam-on within 30 s', () => {
  for (const side of [1, -1]) {
    const b = new BoatPhysics({ heading: side * 10 * DEG, speed: 0 }); b.furlPos = 1;
    const env = { windAt: steadyWind(15 * KN, 0), t: 0 }; let at = null;
    for (let i = 0; i <= 120 / DT; i++) {
      env.t = i * DT; b.step(DT, { ...CONTROLS, furl: 1, rudder: 0 }, env);
      if (at == null && Math.abs(b.state.trueWind.angle) > 60 * DEG) at = i * DT;
    }
    const lie = Math.abs(b.state.trueWind.angle / DEG);
    assert.ok(at != null && at <= 30, `${side > 0 ? 'starboard' : 'port'}: 60° off the wind at ${at?.toFixed(1)} s`);
    assert.ok(lie > 90 && lie < 135, `${side > 0 ? 'starboard' : 'port'}: lying ${lie.toFixed(0)}° off the wind after 2 min`);
  }
});

test('the engine: cranks, catches to idle, runs down when stopped; no thrust while off', () => {
  const e = new Engine();
  assert.equal(e.state, 'off');
  e.start();
  for (let i = 0; i < 30; i++) e.step(DT, 0);
  assert.equal(e.state, 'cranking');
  for (let i = 0; i < 240; i++) e.step(DT, 0);
  assert.equal(e.state, 'running');
  assert.ok(Math.abs(e.rpm - ENGINE.rpmIdle) < 30, `idle ${e.rpm.toFixed(0)} rpm`);
  for (let i = 0; i < 240; i++) e.step(DT, 1);
  assert.ok(e.rpm > 2800, `full throttle ${e.rpm.toFixed(0)} rpm`);
  e.stop();
  for (let i = 0; i < 300; i++) e.step(DT, 1);
  assert.equal(e.rpm, 0); assert.equal(e.state, 'off');
  const off = motor(1, { secs: 20, start: false }).s;
  assert.equal(off.thrust, 0); assert.ok(Math.abs(off.u) < 0.01);
});

test('motor-sailing: the engine adds to the sails; switched off the boat sails as before', () => {
  const sail = (on) => {
    const b = new BoatPhysics({ heading: 90 * DEG, speed: 2 });
    if (on) b.engine.start();
    const env = { windAt: steadyWind(4 * KN, 0), t: 0 };
    for (let i = 0; i < 90 / DT; i++) { env.t = i * DT; b.step(DT, { ...CONTROLS, throttle: on ? 0.5 : 0, rudder: 0 }, env); }
    return b.state.u / KN;
  };
  const a = sail(false), b = sail(true);
  assert.ok(b > a + 1, `4 kn of wind: sailing ${a.toFixed(2)} kn, motor-sailing ${b.toFixed(2)} kn`);
});
