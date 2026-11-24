// The kayaks on the lake, step 3 (feat/kayaks-lake, § 10): a kayak against the sailboat's hull is shoved
// aside and spun, never left inside, and the boat feels only a small bump; the boat's wash rocks a kayak near it; a close
// call sends the paddler sprinting away or backing off, once; Cruise's navigator steers round a kayak crossing its bow and
// passes astern with 15 m kept. Behaviour only: the modules are called and their output read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kayakContact, kayakGap, drift, wakeRock } from '../src/sim/kayaks/contact.js';
import { createAgent, stepHull } from '../src/sim/kayaks/agent.js';
import { createMind, think, CLOSE } from '../src/sim/kayaks/mind.js';
import { kayakRoutes } from '../src/sim/kayaks/routes.js';
import { makeTerrain } from '../src/sim/terrain.js';
import { voyage, chillWorld } from '../src/modes/chill/sim.js';
import { TRAFFIC as TRAFFIC_MARGIN } from '../classic/src/kayaks/fleet.js';

const D = Math.PI / 180;
// a boat north at u m/s from the origin, its velocity integrated by hand (contact may change it); a kayak crossing ahead
function run({ u = 3, kx = 14, kz = -30, kh = -90 * D, kv = 1.3, yaw = 0, secs = 25, deaf = true } = {}) {
  const S = { x: 0, z: 0, heading: yaw, u, v: 0, yawRate: 0 };
  const a = { x: kx, z: kz, heading: kh, v: kv, r: 0, pvx: 0, pvz: 0 };
  const free = { ...a }, dt = 1 / 60, log = { contacts: 0, j: 0, minGap: Infinity, dvBoat: 0, u0: u };
  for (let i = 0; i < secs / dt; i++) {
    S.x += (Math.sin(S.heading) * S.u + Math.cos(S.heading) * S.v) * dt; S.z += (-Math.cos(S.heading) * S.u + Math.sin(S.heading) * S.v) * dt; S.heading += S.yawRate * dt;
    // the kayak's own hull: its drag and its paddler's cruise (who stops paddling and braces at a bump: fleet.js)
    for (const k of [a, free]) { k.heading += k.r * dt; k.r *= Math.exp(-dt * 140 / 120); k.v -= (7.5 * k.v * Math.abs(k.v) + 6 * k.v - (k === a && log.contacts ? 0 : 20.7)) / 108 * dt; k.x += Math.sin(k.heading) * k.v * dt; k.z -= Math.cos(k.heading) * k.v * dt; }
    drift(a, dt);
    const c = kayakContact(S, a);
    if (c && c.j > 0) { log.contacts++; log.j += c.j; log.dvBoat += c.dvBoat; }
    log.minGap = Math.min(log.minGap, kayakGap(S, a));
  }
  log.shove = Math.hypot(a.x - free.x, a.z - free.z); log.uEnd = S.u; log.spin = Math.abs(a.heading - free.heading);
  return log;
}

test('a kayak hit by the hull is shoved aside and spun, never left inside; the boat feels a small bump', () => {
  for (const [kx, kz, kh] of [[14, -30, -90 * D], [-14, -30, 90 * D], [10, -25, -60 * D], [0.6, -20, 0], [1, -40, 180 * D]]) {
    const r = run({ kx, kz, kh });
    assert.ok(r.contacts >= 1 && r.j > 50 && r.contacts < 40, `a contact (${r.contacts}, ${r.j.toFixed(0)} N·s) for ${kx}, ${kz}`);
    assert.ok(r.minGap > -0.05, `left ${(-r.minGap * 100).toFixed(1)} cm inside the hull`);
    assert.ok(r.shove > 1, `the kayak moved ${r.shove.toFixed(2)} m off its own path`);
    assert.ok(Math.abs(r.dvBoat) / r.u0 < 0.05, `the boat lost ${(100 * Math.abs(r.dvBoat) / r.u0).toFixed(2)} % of its speed`);
  }
});

test('the wash rocks a kayak near the boat, gently far off; it dies away after', () => {
  const S = { x: 0, z: 0, heading: 0, u: 3.5, v: 0, yawRate: 0 };
  const near = { x: 4, z: 8, heading: 0, slot: { seed: 1 } }, far = { x: 60, z: 30, heading: 0, slot: { seed: 2 } };
  for (let i = 0; i < 120; i++) { wakeRock(S, near, 1 / 60); wakeRock(S, far, 1 / 60); }
  assert.ok(near.rock > 3 * D, `near: ${(near.rock / D).toFixed(1)}°`);
  assert.ok(far.rock < 1 * D, `far: ${(far.rock / D).toFixed(2)}°`);
  const gone = { ...S, u: 0 };
  for (let i = 0; i < 60 * 10; i++) wakeRock(gone, near, 1 / 60);
  assert.ok(near.rock < 0.5 * D, `after 10 s still ${(near.rock / D).toFixed(2)}°`);
});

test('a close call: the paddler sprints away or backs off, once', () => {
  const T = makeTerrain(), r = kayakRoutes(T).routes.find((q) => q.kind === 'crossing');
  const p = r.path.at(300), dt = 1 / 30;
  for (const [ahead, want] of [[true, 'back'], [false, 'sprint']]) {
    const slot = { id: 'k', route: r, s0: 300, restLeft: 0, seed: 4, personality: 'casual' };
    const a = createAgent({ slot }), m = createMind(slot);
    // the boat 18 m off, heading at the kayak (ahead: aimed to pass just behind it, so the kayak is ahead of its centre)
    const h = Math.atan2(p.x - (p.x - 30), 0), off = ahead ? 4 : -11;
    let bx = p.x - 18, bz = p.z + off;
    let sawBack = false, sawSprint = false, closes = 0;
    for (let i = 0; i < 12 / dt; i++) {
      bx += 3.2 * dt;
      const b = { x: bx, z: bz, vx: 3.2, vz: 0 };
      const it = think(a, m, dt, { boat: b, others: [a], terrain: T });
      stepHull(a, dt, it);
      if (m.closeT > 0) { if (it.throttle < 0) sawBack = true; if (it.throttle >= 0.5 || it.turn) sawSprint = true; }
      closes += m.events.splice(0).filter((e) => e.type === 'close').length;
    }
    assert.equal(closes, 1, `${want}: ${closes} close calls`);
    assert.equal(m.closeMode, want, `the boat ${ahead ? 'astern of' : 'ahead of'} the kayak: ${m.closeMode}`);
    assert.ok(want === 'back' ? sawBack : sawSprint, `${want} seen`);
    assert.ok(CLOSE.r === 15 && h === h);
  }
});

test('Cruise steers round a kayak crossing its bow: ≥ 15 m kept, passing astern of it', () => {
  // the boat's track without a kayak, then a kayak put on a collision course with it 25 s ahead
  const seed = 3, hour = 16, T0 = 60, Tm = 25;
  const track = [];
  voyage({ seed, hour, rate: 0, minutes: 2.5, onTick: (t, s) => { track.push({ t, x: s.x, z: s.z, h: s.heading, u: s.sog }); } });
  const at = (t) => track.reduce((b, p) => (Math.abs(p.t - t) < Math.abs(b.t - t) ? p : b));
  const P = at(T0 + Tm), B0 = at(T0), kh = B0.h + Math.PI / 2;   // the kayak crosses from the boat's port side
  const kv = 1.3, kx0 = P.x - Math.sin(kh) * kv * Tm, kz0 = P.z + Math.cos(kh) * kv * Tm;
  let k = null, minD = Infinity, astern = null;
  const W = chillWorld({ seed, hour, rate: 0 });
  const base = W.traffic;
  W.traffic = Object.assign(Object.create(base), { agents: (t) => { const list = base.agents(t); if (!k) return list; const dt = t - k.t; const x = k.x + Math.sin(k.heading) * k.v * dt, z = k.z - Math.cos(k.heading) * k.v * dt; return [...list, { kind: 'kayak', x, z, margin: TRAFFIC_MARGIN.margin }, { kind: 'kayak-bow', x: x + Math.sin(k.heading) * TRAFFIC_MARGIN.bowM, z: z - Math.cos(k.heading) * TRAFFIC_MARGIN.bowM, margin: TRAFFIC_MARGIN.bowMargin }]; } });
  voyage({ seed, hour, rate: 0, minutes: 2.5, world: W, onTick: (t, s) => {
    if (!k && t >= T0) k = { x: kx0, z: kz0, heading: kh, v: kv, t };
    if (!k) return;
    const dt = t - k.t; k.x += Math.sin(k.heading) * k.v * dt; k.z -= Math.cos(k.heading) * k.v * dt; k.t = t;
    const d = Math.hypot(s.x - k.x, s.z - k.z);
    if (d < minD) { minD = d; astern = (s.x - k.x) * Math.sin(k.heading) - (s.z - k.z) * Math.cos(k.heading) < 0; }
  } });
  // (without steering round it, the two would have met: the kayak was put on the boat's own track)
  assert.ok(minD >= 13, `the boat came within ${minD.toFixed(1)} m of the kayak`);
  assert.ok(astern, 'the boat passed astern of the kayak');
});
