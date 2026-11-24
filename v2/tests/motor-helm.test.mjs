// The owner's report (2026-11-14): "When I lower the sail, then turn on the engine at full speed, and press W or S, this often
// makes the boat spin in place for a very long time." v2's boat (v2/sim/boat.js) under v1's engine and seamanship
// (v2/sim/seamanship.js) on the shared physics (src/sim/boat.js), stepped as the page steps it: the sails down (Y), the engine
// (I), the lever to full, then the sheet keys (W pulls, S eases; v1's KEYMAP: they never touch the throttle or the helm).
// The cause was in the shared physics: the keel's downwash turned the inflow of the rudder's share in the prop's slipstream by
// 0.35 × the keel's raw angle of attack, which is ±180° with any sternway (and ±90° stopped and sliding sideways), so an
// amidships rudder in the jet acted as ≈ 63° of helm: from a standstill head to wind (the sails coming down drift her astern)
// full ahead spun her at ≈ 17°/s and held her making sternway. S held at the stop let both sheets fly (the helm amidships, the
// pilot off until A/D), which is how the keys set it off.
// A spin here: |yaw rate| over 5°/s for more than 2 s with no hand on the helm. Motoring hands-off the pilot's corrections stay
// under 1°/s; full lock ahead turns her at ≈ 16°/s, so 5°/s sits well clear of both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor, KN } from '../sim/boat.js';
import { createSeamanship } from '../sim/seamanship.js';
import { steadyWind } from '../../src/sim/boat.js';

const DEG = Math.PI / 180;
const SPIN = { rate: 5, s: 2 };
function boat({ windKn = 12, windFrom = 0, heading = 0, speed = 0 } = {}) {
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: { sample: (x, z, t) => steadyWind(windKn * KN, windFrom)(x, z, t) }, start: { x: 0, z: 0, headingDeg: heading, speed } });
  const sea = createSeamanship({ B, depthAt: () => 40, timeScale: 2 });
  B.sea = sea;
  return { B, sea };
}
// the page's cadence (v2/main.js simFrame): the hands once a frame at the real dt, the sim at v1's 2 × game speed
function frames(B, secs, hands = {}, { fps = 60, each = null } = {}) {
  const dt = 1 / fps;
  for (let i = 0; i < Math.round(secs * fps); i++) { B.step(2 * dt, { steer: 0, pull: 0, ...hands }, dt); each?.(B.state, i * dt); }
}
// the longest run of hands-off |yaw| over SPIN.rate (s of real time) and the largest |yaw|
function spinMeter() {
  const m = { run: 0, longest: 0, max: 0 };
  m.each = (s, _t, dt = 1 / 60) => { const y = Math.abs(s.yawRate / DEG); m.max = Math.max(m.max, y); m.run = y > SPIN.rate ? m.run + dt : 0; m.longest = Math.max(m.longest, m.run); };
  return m;
}
function motorUp(B, sea) {
  sea.actions.sails(); frames(B, 4);   // Y: the crew takes the sails down (she slows; head to wind she drifts astern)
  sea.actions.engine(); frames(B, 2);  // I: the starter, the catch
  sea.actions.lever(1);                // the lever to full ahead
}

test('the owner\'s keys: sails down, full ahead, then S held, W held, taps: no spin, the pilot keeps her, she makes way', () => {
  for (const [windKn, heading] of [[12, 0], [20, 0], [25, 20], [15, 90], [25, 0]]) {
    const { B, sea } = boat({ windKn, heading });
    motorUp(B, sea);
    const m = spinMeter(), each = m.each;
    frames(B, 3, {}, { each });
    frames(B, 3, { pull: -1 }, { each });   // S held past the stop (it used to let both sheets fly: the helm amidships, the pilot off)
    frames(B, 2, {}, { each });
    frames(B, 2, { pull: 1 }, { each });    // W held
    for (let k = 0; k < 4; k++) { frames(B, 0.2, { pull: 1 }, { each }); frames(B, 0.2, {}, { each }); frames(B, 0.2, { pull: -1 }, { each }); frames(B, 0.2, {}, { each }); }
    frames(B, 20, {}, { each });
    const tag = `${windKn} kn, ${heading}° off the wind`;
    assert.ok(m.longest <= SPIN.s, `${tag}: no spin (|yaw| over ${SPIN.rate}°/s for ${m.longest.toFixed(1)} s, peak ${m.max.toFixed(1)}°/s)`);
    assert.ok(!B.fly.any, `${tag}: the sails down, the ease key lets nothing fly`);
    assert.ok(B.holdHeading != null, `${tag}: the pilot holds a course`);
    assert.ok(B.state.u > 2.5 * KN, `${tag}: under way ahead (${(B.state.u / KN).toFixed(2)} kn)`);
  }
});

test('full ahead from rest, head to wind, the helm held amidships: she goes straight ahead, not round and astern', () => {
  for (const windKn of [10, 20, 30]) {
    const { B, sea } = boat({ windKn, heading: 0 });
    sea.actions.sails(); sea.actions.engine();
    const m = spinMeter();
    for (let i = 0; i < 40 * 60; i++) {
      if (i === 120) sea.actions.lever(1);
      B.station({ helm: 0 });   // the wheel in the hand, amidships (the old let fly's helm)
      B.step(2 / 60, { steer: 0, pull: 0 }, 1 / 60); m.each(B.state);
    }
    assert.ok(m.longest <= SPIN.s, `${windKn} kn: no spin (|yaw| over ${SPIN.rate}°/s for ${m.longest.toFixed(1)} s, peak ${m.max.toFixed(1)}°/s)`);
    assert.ok(B.state.u > 2 * KN, `${windKn} kn: making way ahead (${(B.state.u / KN).toFixed(2)} kn; it was ≈ −3 kn astern)`);
  }
});

test('under engine the yaw follows the helm within 1 s of A or D, and settles once let go', () => {
  for (const heading of [0, 90]) for (const [steer, sign] of [[-1, -1], [1, 1]]) {
    const { B, sea } = boat({ windKn: 18, heading });
    motorUp(B, sea); frames(B, 4);   // just under way
    let at = null;
    frames(B, 1.5, { steer }, { each: (s, t) => { if (at == null && Math.sign(s.yawRate) === sign && Math.abs(s.yawRate / DEG) > 3) at = t; } });
    assert.ok(at != null && at <= 1, `${heading}°, steer ${steer}: the yaw follows the helm (${at?.toFixed(2)} s)`);
    const m = spinMeter();
    frames(B, 3, {}); frames(B, 10, {}, { each: m.each });
    assert.ok(m.max < 2, `${heading}°, steer ${steer}: let go, the pilot holds her (|yaw| ≤ ${m.max.toFixed(2)}°/s 3 s on)`);
  }
});

test('the neighbours: neutral, and the engine with the sails up, keep a steady course hands-off', () => {
  { const { B, sea } = boat({ windKn: 15, heading: 0 }); motorUp(B, sea); frames(B, 10); sea.actions.neutral(); const m = spinMeter(); frames(B, 20, {}, { each: m.each });
    assert.ok(m.longest <= SPIN.s, `neutral: no spin (peak ${m.max.toFixed(1)}°/s)`); }
  { const { B, sea } = boat({ windKn: 15, heading: 60, speed: 2.5 }); sea.actions.engine(); frames(B, 2); sea.actions.lever(1); const m = spinMeter();
    frames(B, 3, { pull: -1 }, { each: m.each }); frames(B, 25, {}, { each: m.each });
    assert.ok(m.longest <= SPIN.s, `sails up under engine: no spin (peak ${m.max.toFixed(1)}°/s)`); }
});

// Astern (fix/sim-astern-rudder, 2026-11-14): the free-stream rudder took the keel's raw ±180° downwash in sternway, ≈ 63° of
// phantom helm whose side flipped with any sway, so at full astern hands-off she circled at ≈ 7°/s and the pilot could not
// hold her. Now the rudder works reversed and weaker astern, and the pilot reverses the wheel: hands-off at full astern the
// pilot keeps her within a few degrees of the course she had, and A turns her stern to port (the bow to starboard).
test('full astern hands-off: the pilot holds her course astern; A turns her the reversed way', () => {
  for (const [windKn, heading] of [[0, 0], [12, 0], [15, 90], [20, 180]]) {
    const { B, sea } = boat({ windKn, heading });
    sea.actions.sails(); frames(B, 4); sea.actions.engine(); frames(B, 2);
    const h0 = B.state.heading;
    sea.actions.lever(-1);
    const m = spinMeter();
    frames(B, 30, {}, { each: m.each });
    const off = Math.abs(((B.state.heading - h0) / DEG + 540) % 360 - 180);
    const tag = `${windKn} kn, ${heading}° off the wind`;
    assert.ok(B.state.u < -1.5 * KN, `${tag}: making sternway (${(B.state.u / KN).toFixed(2)} kn)`);
    assert.ok(m.longest <= SPIN.s, `${tag}: no spin astern (peak ${m.max.toFixed(1)}°/s)`);
    assert.ok(off < 10, `${tag}: the pilot holds her within ${off.toFixed(1)}° of her course`);
    let yaw = 0; frames(B, 3, { steer: -1 }, { each: (s) => { yaw = s.yawRate; } });
    assert.ok(yaw > 0, `${tag}: A astern swings the bow to starboard (${(yaw / DEG).toFixed(2)}°/s)`);
  }
});
