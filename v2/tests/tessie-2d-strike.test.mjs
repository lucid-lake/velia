// Play as Tessie, phase 2d step 5: the strike as one state machine, the lock-on and one continuous camera. Behaviour
// only: her real sim, the controller, the hits and the camera are stepped and their state read.
//   the timings: the rail bite 1.67 s (0.30 / 0.22 / 0.70 / 0.45), its contact 0.52 s after the press; the snap 0.68 s; the dash bite's
//                contact at 0.25 s; the rising strike's breach 2.35 s
//   steering:    never under 30 % through any bite or breach; full again by 1.40 s after a rail bite's press; no sulk (a miss never
//                takes the heading); her pace never braked harder than 6 m/s²
//   the lock:    acquired within 10 m at the surface (13 m under the water, a tablet + 2) and ±35°, eased in over 0.35 s; held to 16 m,
//                ±50° (hysteresis); broken by 60° of the player's way for 0.3 s; that boat not again for 1.0 s; the corners kept too
//   the camera:  never faster than her pace + 6 m/s over the ground, its aim's yaw at most 60°/s, never 30 m behind
//   the choice:  the snap, the rail bite, the dash bite and the rising strike by what she is doing; the press buffered 0.25 s
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, biteBeats, biteDur, biteContact, BITE2 } from '../sim/tessie.js';
import { createTessiePlay, PLAY, BREACH_S, contactPoint, CONTACT } from '../sim/tessiePlay.js';
import { createTessieHits, HITS, hullDist } from '../sim/tessieHits.js';
import { createTessieCam, TCAM } from '../ui/tessieCam.js';

const DT = 1 / 60, DEG = Math.PI / 180;
const make = () => { const depthAt = () => 40; const sim = createTessie({ seed: 3, depthAt }); const C = createTessiePlay({ sim, depthAt }); C.begin({ x: 0, z: 0, heading: 0 }); return { sim, C }; };
const run = (o, secs, hands = {}, ctx = {}, each = null) => { for (let i = 0; i < Math.round(secs / DT); i++) { o.sim.step(DT, { playing: true }); o.C.step(DT, typeof hands === 'function' ? hands(i * DT) : hands, typeof ctx === 'function' ? ctx(i * DT) : ctx); each?.(i * DT); } };
// a boat ahead of her, locked (the lock as tessieHits gives it)
const ahead = (o, m, extra = {}) => { const n = o.sim.state.nose; const b = { id: 'b', kind: 'sail', x: n.x + Math.sin(n.psi) * m, z: n.z - Math.cos(n.psi) * m, heading: n.psi + Math.PI / 2, u: 0, L: 8.5, B: 3, ...extra }; return b; };
const lockOf = (b, under = false) => ({ ...b, k: 1, ix: b.x, iz: b.z, under });

test('the beats: the rail bite 1.67 s with its contact at 0.52 s; the snap 0.68 s; the dash bite\'s contact at 0.25 s', () => {
  assert.ok(Math.abs(biteDur('rail') - 1.67) < 1e-9 && Math.abs(biteContact('rail') - 0.52) < 1e-9);
  assert.ok(Math.abs(biteDur('snap') - 0.68) < 1e-9 && Math.abs(biteContact('dash') - 0.25) < 1e-9 && Math.abs(biteDur('dash') - 1.40) < 1e-9);
  assert.deepEqual([0.1, 0.4, 0.9, 1.5, 1.7].map((t) => biteBeats('rail', t).phase), ['windup', 'strike', 'follow', 'recover', 'done']);
  assert.equal(BITE2.dash.knock, 1.15);
  assert.ok(Math.abs(BREACH_S - 2.35) < 1e-9, `the rising strike's breach 2.35 s (${BREACH_S})`);
  for (const k of ['snap', 'rail', 'dash']) for (let t = 0; t <= biteDur(k) + 0.1; t += 0.01) { const b = biteBeats(k, t, t > 0.6); assert.ok(b.steer >= 0.3 - 1e-9 && b.steer <= 1, `${k} steering ${b.steer} at ${t.toFixed(2)} s`); }
  assert.equal(biteBeats('rail', 1.40).steer, 1, 'full steering by 1.40 s');
});

test('a locked rail bite at the surface: its contact 0.52 s after the press (in reach), steering never under 30 %, full by 1.40 s, never braked past 6 m/s²', () => {
  const o = make();
  run(o, 4, { move: [0, 1] });
  const b = ahead(o, 6), lock = lockOf(b);
  let t = 0, press = null, contact = null, minSteer = 1, steerAt14 = null, worstBrake = 0, prev = o.sim.state.nose.speed;
  run(o, 2, (tt) => ({ move: [0, 1], bite: tt < 0.01 }), { target: { ...b, d: 4.5 }, lock }, () => {
    t += DT; if (press == null && o.C.state.bite) press = t - DT;
    for (const e of o.C.events) if (e.type === 'contact') contact = t;
    if (press != null) { minSteer = Math.min(minSteer, o.C.state.steer); if (steerAt14 == null && t - press >= 1.40 + DT) steerAt14 = o.C.state.steer; }
    const v = o.sim.state.nose.speed; worstBrake = Math.min(worstBrake, (v - prev) / DT); prev = v;
  });
  assert.ok(contact != null && Math.abs(contact - press - 0.52) <= DT + 1e-9, `contact ${(contact - press).toFixed(3)} s after the press`);
  assert.ok(minSteer >= 0.3 - 1e-9, `steering never under 30 % (${minSteer.toFixed(2)})`);
  assert.ok(steerAt14 > 0.999, `full steering by 1.40 s (${steerAt14})`);
  assert.ok(worstBrake >= -PLAY.strikeStop - 0.05, `never braked harder than 6 m/s² (${worstBrake.toFixed(1)})`);
});

test('a miss never sulks: through the follow-through a held turn still turns her; she swims on the player\'s way at once after', () => {
  const o = make();
  run(o, 4, { move: [0, 1] });
  const b = ahead(o, 6);
  run(o, 0.6, (t) => ({ move: [0, 1], bite: t < 0.01 }), { target: { ...b, d: 4.5 }, lock: lockOf(b) });
  assert.equal(o.C.state.phase, 'follow');
  const psi0 = o.sim.state.nose.psi;
  run(o, 0.6, { move: [1, 0], camYaw: 0 });
  const turned = Math.abs(Math.atan2(Math.sin(o.sim.state.nose.psi - psi0), Math.cos(o.sim.state.nose.psi - psi0)));
  assert.ok(turned > 4 * DEG, `the follow-through still steers (${(turned / DEG).toFixed(1)}° in 0.6 s)`);
  run(o, 1, { move: [1, 0], camYaw: 0 });
  assert.equal(o.C.state.lunge, null); assert.equal(o.C.state.steer, 1);
});

test('the choice: nothing near, the snap; locked at the surface, the rail bite; on the dash, the dash bite (its knock × 1.15); locked from depth, the rising strike', () => {
  const kindOf = (setup, ctx) => { const o = make(); setup(o); const ev = []; run(o, 0.4, (t) => ({ move: [0, 1], bite: t < 0.01 }), typeof ctx === 'function' ? ctx(o) : ctx, () => { for (const e of o.C.events) ev.push(e); }); return { ev, o }; };
  assert.equal(kindOf((o) => run(o, 4, { move: [0, 1] }), {}).ev.find((e) => e.type === 'bite')?.kind, 'snap');
  let b = null;
  assert.equal(kindOf((o) => { run(o, 4, { move: [0, 1] }); b = ahead(o, 6); }, () => ({ target: { ...b, d: 4.5 }, lock: lockOf(b) })).ev.find((e) => e.type === 'bite')?.kind, 'rail');
  const d = kindOf((o) => { run(o, 4, { move: [0, 1] }); run(o, 0.2, (t) => ({ move: [0, 1], dash: t < 0.01 })); }, {});
  assert.equal(d.ev.find((e) => e.type === 'bite')?.kind, 'dash');
  assert.equal(d.ev.find((e) => e.type === 'contact')?.knock, 1.15, 'the dash bite knocks × 1.15');
  const r = kindOf((o) => { run(o, 6, () => ({ move: [0, 1], sink: o.C.state.nose < 8 })); b = ahead(o, 6); }, () => ({ target: { ...b, d: 4 }, lock: lockOf(b, true) }));
  assert.ok(r.ev.some((e) => e.type === 'lunge') && r.o.C.state.lunge?.phase === 'rise', 'locked from depth: the rising strike');
});

test('the rising strike: the rise, then the breach of 2.35 s; its fall once; steering 60 % then 30 %, never less', () => {
  const o = make();
  run(o, 6, () => ({ move: [0, 1], sink: o.C.state.nose < 8 }));   // 8 m down (the lock needs the hull within 15 m over her nose)
  const b = ahead(o, 8);
  const ev = []; let minSteer = 1, breachAt = null, recoverAt = null, t = 0;
  run(o, 6, (tt) => ({ move: [0, 1], bite: tt < 0.01 }), { target: { ...b, d: 6 }, lock: lockOf(b, true) }, () => { t += DT; for (const e of o.C.events) ev.push(e.type); if (o.C.state.lunge) minSteer = Math.min(minSteer, o.C.state.steer); if (breachAt == null && o.C.state.lunge?.phase === 'breach') breachAt = t; if (recoverAt == null && o.C.state.lunge?.phase === 'recover') recoverAt = t; });
  assert.equal(ev.filter((e) => e === 'fall').length, 1, 'one fall');
  assert.ok(breachAt >= PLAY.warn.s - 0.05 && breachAt < PLAY.warn.s + 1.0, `the rise: the warning's 1.5 s, then up (${breachAt?.toFixed(2)} s)`);
  assert.ok(breachAt != null && recoverAt != null && Math.abs(recoverAt - breachAt - 2.35) < 2 * DT, `the breach ${(recoverAt - breachAt).toFixed(2)} s`);
  assert.ok(minSteer >= 0.3 - 1e-9, `steering never under 30 % (${minSteer.toFixed(2)})`);
  assert.equal(o.C.state.lunge, null, `over: no sulk, no rest phase (${JSON.stringify(o.C.state.lunge && { phase: o.C.state.lunge.phase, t: o.C.state.lunge.t })})`);
});

test('the lock: 10 m at the surface, 13 m under the water, a tablet + 2; ±35°; eased in over 0.35 s', () => {
  const n = { x: 0, z: 0, psi: 0 };
  const boatAt = (m, deg = 0) => [{ id: 'b', kind: 'sail', x: Math.sin(deg * DEG) * (m + 1.5), z: -Math.cos(deg * DEG) * (m + 1.5), heading: Math.PI / 2 + deg * DEG, L: 8.5, B: 3 }];   // m from her nose to its near side
  const at = (m, o = {}, deg = 0) => { const H = createTessieHits(); return H.lock(n, boatAt(m, deg), 0, { dt: 0.5, ...o })?.id ?? null; };
  assert.equal(at(9.8), 'b'); assert.equal(at(10.5), null, 'over 10 m at the surface: no lock');
  assert.equal(at(11.5, { tablet: true }), 'b'); assert.equal(at(12.5, { tablet: true }), null);
  const H = createTessieHits();
  const d3 = (across, nose) => Math.hypot(across, nose + HITS.lock.keelY);
  assert.ok(d3(10, 8) <= 13 && d3(11, 8) > 13);
  assert.equal(createTessieHits().lock(n, boatAt(10), 0, { nose: 8, dt: 0.5 })?.id ?? null, 'b');
  assert.equal(createTessieHits().lock(n, boatAt(11), 0, { nose: 8, dt: 0.5 })?.id ?? null, null, '13 m in 3-D under the water');
  assert.equal(at(8, {}, 30), 'b'); assert.equal(at(8, {}, 40), null, 'outside ±35°: no lock');
  // eased in over 0.35 s (smoothstep): half way at 0.175 s
  let k = null; for (let i = 1; i <= 21; i++) { const L = H.lock(n, boatAt(8), i / 60, { dt: 1 / 60 }); if (i === 10 || i === 11) k = k ?? L.k; }
  assert.ok(k > 0.35 && k < 0.65, `half in at about 0.175 s (${k.toFixed(2)})`);
});

test('the lock\'s hysteresis: held to 16 m and ±50°, broken past them or by 60° of the player\'s way for 0.3 s; that boat not again for 1.0 s', () => {
  const n = { x: 0, z: 0, psi: 0 };
  const boat = (m, deg = 0) => [{ id: 'b', kind: 'sail', x: Math.sin(deg * DEG) * (m + 1.5), z: -Math.cos(deg * DEG) * (m + 1.5), heading: Math.PI / 2 + deg * DEG, L: 8.5, B: 3 }];
  const H = createTessieHits(); let t = 0;
  const step = (list, o = {}) => { t += 0.05; return H.lock(n, list, t, { dt: 0.05, ...o }); };
  assert.equal(step(boat(9)).id, 'b');
  assert.equal(step(boat(15)).id, 'b', '15 m: still locked (hysteresis)');
  assert.equal(step(boat(9, 45)).id, 'b', '45°: still locked');
  assert.equal(step(boat(16.5)).id, null, 'past 16 m: broken');
  assert.equal(step(boat(9)).id, null, 'that boat: not again within 1.0 s');
  t += 1.0; assert.equal(step(boat(9)).id, 'b', 'after 1.0 s: locked again');
  for (let i = 0; i < 5; i++) assert.equal(step(boat(9), { way: 70 * DEG }).id, 'b', `steering 70° away for ${((i + 1) * 0.05).toFixed(2)} s: still locked`);
  assert.equal(step(boat(9), { way: 70 * DEG }).id, null, 'steering away for 0.3 s: broken');
  t += 1.1; assert.equal(step(boat(9)).id, 'b');
  assert.equal(step(boat(9, 55)).id, null, 'past ±50°: broken');
});

test('the corners keep their boat (hysteresis): kept to 70 m and ±30°, and 0.5 s after it leaves', () => {
  const n = { x: 0, z: 0, psi: 0 }, H = createTessieHits();
  const at = (m, deg) => [{ id: 'b', kind: 'sail', x: Math.sin(deg * DEG) * m, z: -Math.cos(deg * DEG) * m, heading: 0, L: 8.5, B: 3 }];
  assert.equal(H.aim(n, at(40, 10), 0)?.id, 'b');
  assert.equal(H.aim(n, at(40, 25), 0.1)?.id, 'b', '25°: kept (acquired only inside 20°)');
  assert.equal(H.aim(n, at(65, 10), 0.2)?.id, 'b', '65 m: kept');
  assert.equal(H.aim(n, at(40, 40), 0.3)?.id, 'b', 'out of the keep cone: still kept for 0.5 s');
  assert.equal(H.aim(n, at(40, 40), 0.9) ?? null, null, 'gone 0.6 s after it left');
  assert.equal(createTessieHits().aim(n, at(40, 25), 0) ?? null, null, 'never acquired at 25°');
});

test('the lock\'s assist: at most 20°/s on top of her own turn, toward the boat\'s intercept; never with no way held', () => {
  const o = make();
  run(o, 4, { move: [0, 1] });
  const n = o.sim.state.nose, b = { id: 'b', kind: 'sail', x: n.x + 6, z: n.z - 8, heading: 0, u: 0, L: 8.5, B: 3 };
  let most = 0;
  run(o, 1, { move: [0, 1], camYaw: n.psi }, { target: { ...b, d: 6 }, lock: lockOf(b) }, () => { most = Math.max(most, Math.abs(o.C.state.assist)); });
  assert.ok(most > 5 * DEG && most <= HITS.lock.assistMax * DEG + 1e-9, `the assist ${(most / DEG).toFixed(1)}°/s`);
  run(o, 0.5, {}, { target: { ...b, d: 6 }, lock: lockOf(b) });
  assert.equal(o.C.state.assist, 0, 'no way held: no assist');
});

test('the press buffered 0.25 s: pressed just before the lock, the rail bite fires on it', () => {
  const o = make();
  run(o, 4, { move: [0, 1] });
  const b = ahead(o, 13);
  const ev = [];
  run(o, 0.4, (t) => ({ move: [0, 1], bite: t < 0.01 }), (t) => ({ target: { ...b, d: 11.5 }, lock: t >= 0.15 ? lockOf(b) : null }), () => { for (const e of o.C.events) ev.push(e); });
  assert.equal(ev.find((e) => e.type === 'bite')?.kind, 'rail', 'the press waited for the lock');
  assert.equal(ev.find((e) => e.type === 'bite')?.locked, true);
});

test('fair: the bot presses the moment she is locked at the surface, W toward the boat; at least 3 bites in 4 land (boats crossing, head-on, overtaken, 3 and 4.5 m/s)', () => {
  let hits = 0, tries = 0;
  for (const u of [3, 4.5]) for (const [x, z, h] of [[-40, -75, Math.PI / 2], [40, -75, -Math.PI / 2], [0, -90, Math.PI], [0, -40, 0], [-30, -60, Math.PI * 0.75], [30, -60, -Math.PI * 0.75]]) {
    const o = make(), H = createTessieHits(), boat = { id: 'b', kind: 'sail', x, z, heading: h, u, L: 8.5, B: 3 };
    let t = 0, pressed = false, hit = null;
    for (let i = 0; i < 22 / DT && hit == null; i++) {
      t += DT; boat.x += Math.sin(h) * u * DT; boat.z -= Math.cos(h) * u * DT;
      o.sim.step(DT, { playing: true });
      const n = o.sim.state.nose, list = [{ ...boat }];
      const tg = H.aim(n, list, t), lock = H.lock(n, list, t, { nose: o.C.state.nose, way: o.C.state.way, dt: DT });
      const toward = Math.atan2(boat.x - n.x, -(boat.z - n.z)), drag = o.C.state.way == null ? 0 : Math.atan2(Math.sin(toward - o.C.state.way), Math.cos(toward - o.C.state.way));
      const bite = t > 4 && !pressed && !!lock?.id && lock.k >= 0.5; if (bite) pressed = true;
      o.C.step(DT, { move: [0, 1], camYaw: toward, drag, bite }, { target: tg, lock });
      for (const e of o.C.events) if (e.type === 'contact') { hit = !!H.contact(e, list, t).hit; o.C.result(hit); }
    }
    if (pressed) { tries++; if (hit) hits++; }
  }
  assert.ok(tries >= 10 && hits / tries >= 0.75, `${hits} of ${tries} bites landed`);
});

test('one continuous camera through a locked bite and a rising strike: never faster than her pace + 6 m/s over the ground, its aim at most 60°/s, never far behind', () => {
  for (const deepCase of [false, true]) {
    const o = make(), cam = createTessieCam(), H = createTessieHits();
    const boat = { id: 'b', kind: 'sail', x: -40, z: -75, heading: Math.PI / 2, u: 4, L: 8.5, B: 3 };
    let press = false, worstOver = 0, worstAim = 0, worstGap = 0, prev = null, prevAim = null, t = 0;
    for (let i = 0; i < 16 / DT; i++) {
      t += DT; boat.x += boat.u * DT;
      o.sim.step(DT, { playing: true });
      const n = o.sim.state.nose, list = [{ ...boat }];
      const tg = H.aim(n, list, t), lock = H.lock(n, list, t, { nose: o.C.state.nose, way: o.C.state.way, dt: DT });
      const toward = Math.atan2(boat.x - n.x, -(boat.z - n.z)), drag = o.C.state.way == null ? 0 : Math.atan2(Math.sin(toward - o.C.state.way), Math.cos(toward - o.C.state.way));
      const bite = t > 4 && !press && !!lock?.id && lock.k >= 0.5; if (bite) press = true;
      o.C.step(DT, { move: [0, 1], camYaw: toward, drag, bite, sink: deepCase && !press && o.C.state.nose < 8 }, { target: tg, lock });
      const c = cam.step(DT, { spine: o.sim.state.spine, L: o.sim.L, psi: n.psi, nose: o.C.state.nose, speed: n.speed, strike: o.C.state.strike, lock, waterAt: () => 0, floorAt: () => -40 });
      if (t > 4.5) {
        if (prev) worstOver = Math.max(worstOver, Math.hypot(c.pos[0] - prev[0], c.pos[2] - prev[2]) / DT - n.speed);
        const ay = Math.atan2(c.target[0] - c.pos[0], -(c.target[2] - c.pos[2]));
        if (prevAim != null) worstAim = Math.max(worstAim, Math.abs(Math.atan2(Math.sin(ay - prevAim), Math.cos(ay - prevAim))) / DT);
        prevAim = ay; worstGap = Math.max(worstGap, Math.hypot(c.pos[0] - o.sim.state.spine[0], c.pos[2] - o.sim.state.spine[2]));
      }
      prev = [...c.pos];
    }
    assert.ok(press, `${deepCase ? 'deep' : 'surface'}: she pressed`);
    assert.ok(worstOver <= TCAM.spring.vOver + 0.05, `${deepCase ? 'deep' : 'surface'}: the eye at most her pace + ${worstOver.toFixed(2)} m/s`);
    assert.ok(worstAim <= TCAM.aim.max * DEG + 1e-6, `${deepCase ? 'deep' : 'surface'}: the aim ${(worstAim / DEG).toFixed(1)}°/s`);
    assert.ok(worstGap < 22, `${deepCase ? 'deep' : 'surface'}: never far behind (${worstGap.toFixed(1)} m)`);
  }
});

test('her jaw meets the boat (the owner\'s son, 2026-11-21): the contact point by her approach (the transom from astern, else the gunwale on her side, inside the skin); the rising strike touches the bottom', () => {
  const b = { x: 0, z: 0, heading: 0, L: 8.5, B: 3 };   // bow to −z, starboard +x
  const astern = contactPoint(b, 0, 7, 'rail'), beside = contactPoint(b, 6, -1, 'rail'), dash = contactPoint(b, -6, 1, 'dash');
  assert.equal(astern[3], 'stern'); assert.ok(astern[2] > 3.5 && astern[2] < 4.25, `the transom (${astern[2].toFixed(2)})`);
  assert.equal(beside[3], 'rail'); assert.equal(beside[4], 1); assert.ok(Math.abs(beside[0] - (1.5 - CONTACT.inM)) < 1e-9 && beside[1] === CONTACT.railY, `the starboard gunwale, inside its skin (${beside.map((v) => typeof v === 'number' ? v.toFixed(2) : v).join(', ')})`);
  assert.equal(dash[3], 'side'); assert.ok(dash[0] < 0 && dash[1] === CONTACT.sideY);
  assert.equal(contactPoint(b, 0, 7, 'rail', CONTACT, 'rail')[3], 'rail', 'kept once chosen');
  // the rising strike: a contact under the hull as she comes up (kind rising, at its bottom)
  const o = make();
  run(o, 6, () => ({ move: [0, 1], sink: o.C.state.nose < 8 }));
  const t = ahead(o, 8), ev = [];
  run(o, 4.5, (tt) => ({ move: [0, 1], bite: tt < 0.01 }), { target: { ...t, d: 6 }, lock: lockOf(t, true) }, () => { for (const e of o.C.events) ev.push(e); });
  const c = ev.find((e) => e.type === 'contact');
  assert.ok(c && c.kind === 'rising' && c.where === 'bottom', `the rising strike's touch under the hull (${JSON.stringify(c && { kind: c.kind, where: c.where })})`);
});

test('no gap, never through: a locked rail bite on a real hull (the sim\'s proxy posed) sets her head flush on its side through the follow-through', () => {
  const depthAt = () => 40, sim = createTessie({ seed: 3, depthAt }), C = createTessiePlay({ sim, depthAt });
  C.begin({ x: 0, z: 0, heading: 0 });
  let boat = null;
  const step = (secs, hands, ctx = {}, each = null) => { for (let i = 0; i < Math.round(secs / DT); i++) { sim.step(DT, { playing: true, boat }); C.step(DT, typeof hands === 'function' ? hands(i * DT) : hands, typeof ctx === 'function' ? ctx() : ctx); each?.(); } };
  step(4, { move: [0, 1] });
  const n = sim.state.nose;
  boat = { x: n.x + 4.2, z: n.z - 9, heading: 0, speed: 0 };   // a hull just off her bow, to starboard, bow the way she swims
  const b = { id: 'b', kind: 'sail', x: boat.x, z: boat.z, heading: 0, u: 0, L: 8.5, B: 3 };
  let gapMin = Infinity, gapMax = -Infinity, hit = null;
  step(1.3, (t) => ({ move: [0, 1], bite: t < 0.01 }), () => ({ target: { ...b, d: 3 }, lock: lockOf(b) }), () => {
    for (const e of C.events) if (e.type === 'contact') { hit = createTessieHits().contact(e, [b], 0).hit != null; C.result(hit); }
    if (C.state.phase === 'follow' && C.state.bite?.t > 0.65) { const s = sim.state.spine, g = hullDist(s[0], s[2], b); gapMin = Math.min(gapMin, g); gapMax = Math.max(gapMax, g); }
  });
  assert.equal(hit, true, 'the bite lands');
  assert.ok(gapMax < 0.6, `her snout on its side through the follow-through (at most ${gapMax.toFixed(2)} m off the hull's box)`);
  assert.ok(gapMin > -0.45, `never through it (${gapMin.toFixed(2)} m: the box is wider than the hull's skin at the ends)`);
});

test('the boat reacts where her jaw meets it: a kick of the float that rings down within 2.5 s (a lift from below), the hull shoved away from her', async () => {
  const { bumpAt, BUMP } = await import('../living/busyLake.js');
  const b = { bump: { ...BUMP, roll: 0.14, pitch: 0.05, heave: 0.55, t0: 10 } };
  const early = bumpAt(b, 10.07), late = bumpAt(b, 11.5);
  assert.ok(Math.abs(early.roll) > 0.08 && early.heave > 0.25, `a jolt at once (${JSON.stringify(early)})`);
  assert.ok(Math.abs(late.roll) < 0.02, `rung down (${late.roll.toFixed(3)})`);
  assert.equal(bumpAt(b, 13), null); assert.equal(b.bump, null, 'gone after 2.5 s');
});
