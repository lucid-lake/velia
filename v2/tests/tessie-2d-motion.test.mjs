// Play as Tessie, phase 2d step 6: her body's motion on her rig. Behaviour only: her real sim and the controller
// are stepped and her spine read.
//   no stretching: her whole spine and her neck keep their length within 1 % through every gait, bite and breach
//   the swim:      the humps grow with her gait (drift → dash), the sway travels down her body and tail while her head stays on her line,
//                  the flippers' stroke quickens with her pace; her sightings send no paddle and no gape (they look as before)
//   the bite:      the wind-up draws her head back and up and coils her trunk; the strike carries her head past where it was; a hit rolls
//                  her into it (the dash bite 40°); the jaw opens 15° at most
//   the breaches:  every other free breach rolls her 70° in the air (seeded by the count, no Math.random)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie, GAIT, BITE2, TESSIE } from '../sim/tessie.js';
import { createTessiePlay } from '../sim/tessiePlay.js';

const DT = 1 / 60, DEG = Math.PI / 180;
const make = () => { const depthAt = () => 40; const sim = createTessie({ seed: 3, depthAt }); const C = createTessiePlay({ sim, depthAt }); C.begin({ x: 0, z: 0, heading: 0 }); return { sim, C }; };
const run = (o, secs, hands = {}, ctx = {}, each = null) => { for (let i = 0; i < Math.round(secs / DT); i++) { o.sim.step(DT, { playing: true }); o.C.step(DT, typeof hands === 'function' ? hands(i * DT) : hands, typeof ctx === 'function' ? ctx(i * DT) : ctx); each?.(i * DT); } };
const lens = (sp, from = 0, to = sp.length / 8 - 1) => { let l = 0; for (let i = from; i < to; i++) { const a = i * 8, b = a + 8; l += Math.hypot(sp[b] - sp[a], sp[b + 1] - sp[a + 1], sp[b + 2] - sp[a + 2]); } return l; };
const ahead = (o, m) => { const n = o.sim.state.nose; return { id: 'b', kind: 'sail', x: n.x + Math.sin(n.psi) * m, z: n.z - Math.cos(n.psi) * m, heading: n.psi + Math.PI / 2, u: 0, L: 8.5, B: 3 }; };
const lockOf = (b, under = false) => ({ ...b, k: 1, ix: b.x, iz: b.z, under });
// the roll of frame i: its up vector's lean out of the vertical plane through the spine (rad, sign by her left)
const rollAt = (sp, i) => { const o = i * 8, a = Math.max(0, i - 1) * 8, b = Math.min(sp.length / 8 - 1, i + 1) * 8; const tx = sp[b] - sp[a], tz = sp[b + 2] - sp[a + 2], tl = Math.hypot(tx, tz) || 1; const lx = -tz / tl, lz = tx / tl; return Math.asin(Math.max(-1, Math.min(1, sp[o + 4] * lx + sp[o + 6] * lz))); };

test('no stretching: her spine and her neck keep their length within 1 % through every gait, bite and breach', () => {
  const o = make(), L = o.sim.L, N = 64, ib = Math.round(TESSIE.neckS / (L / (N - 1)));
  const neck0 = ib * L / (N - 1);
  let worst = 0, worstNeck = 0;
  const check = () => { const sp = o.sim.state.spine; worst = Math.max(worst, Math.abs(lens(sp) - L) / L); worstNeck = Math.max(worstNeck, Math.abs(lens(sp, 0, ib) - neck0) / neck0); };
  run(o, 4, {}, {}, check);                                    // a drift
  run(o, 4, { move: [0, 1] }, {}, check);                      // the surface cruise
  run(o, 1.2, { move: [0, 1], bite: true }, {}, check);        // the snap
  let b = ahead(o, 6);
  run(o, 2.2, (t) => ({ move: [0, 1], bite: t < 0.02 }), { target: { ...b, d: 4.5 }, lock: lockOf(b) }, check);   // the rail bite (a miss)
  run(o, 0.5, { move: [0, 1] }, {}, check);
  run(o, 2.0, (t) => ({ move: [0, 1], dash: t < 0.02, bite: t > 0.3 && t < 0.33 }), {}, check);   // the dash and the dash bite
  run(o, 6, (t) => ({ move: [0, 1], dash: t < 0.02, look: -15 * DEG }), {}, check);   // the free breach
  run(o, 8, () => ({ move: [0, 1], sink: o.C.state.nose < 8 }), {}, check);   // the dive, the cruise under the water
  b = ahead(o, 8);
  run(o, 6, (t) => ({ move: [0, 1], bite: t < 0.02 }), { target: { ...b, d: 6 }, lock: lockOf(b, true) }, check);   // the rising strike
  assert.ok(worst <= 0.01, `her length within ${(worst * 100).toFixed(2)} % (at most 1 %)`);
  assert.ok(worstNeck <= 0.01, `her neck within ${(worstNeck * 100).toFixed(2)} % (at most 1 %; the old bite stretched it 30 %)`);
});

test('the swim: the humps grow from a drift to the dash; the sway travels down her body and tail while her head holds her line; the stroke quickens', () => {
  const swing = (hands, secs = 6) => {
    const o = make(); run(o, 6, hands);
    let lo = Infinity, hi = -Infinity, tail = 0, head = 0, ph = [];
    run(o, secs, hands, {}, () => {
      const sp = o.sim.state.spine, i = 36;
      const y = sp[i * 8 + 1] - sp[1]; lo = Math.min(lo, y); hi = Math.max(hi, y);
      // her line: the straight from her nose back along her heading (she swims straight north here: x is the side)
      tail = Math.max(tail, Math.abs(sp[60 * 8] - sp[20 * 8])); head = Math.max(head, Math.abs(sp[0] - sp[12 * 8]));
      ph.push(o.sim.state.paddle?.phase ?? 0);
    });
    let turns = 0; for (let k = 1; k < ph.length; k++) if (ph[k] < ph[k - 1]) turns++;
    return { hump: hi - lo, tail, head, hz: turns / secs, paddle: o.sim.state.paddle };
  };
  const drift = swing({}), cruise = swing({ move: [0, 1] }), dash = swing((t) => ({ move: [0, 1], dash: true }), 1.6);
  assert.ok(dash.hump > drift.hump * 1.5, `the humps: a drift ${drift.hump.toFixed(2)} m, the dash ${dash.hump.toFixed(2)} m`);
  assert.ok(cruise.tail > 0.15 && cruise.tail > cruise.head * 3, `the sway down her tail (${cruise.tail.toFixed(2)} m) while her head holds her line (${cruise.head.toFixed(2)} m)`);
  assert.ok(drift.hz < 0.6 && cruise.hz > 0.6 && cruise.hz < 1.1, `the stroke: a drift ${drift.hz.toFixed(2)} Hz, her cruise ${cruise.hz.toFixed(2)} Hz`);
  assert.ok(cruise.paddle.amp > 15 * DEG && cruise.paddle.amp < 24 * DEG, `the stroke's angle at her cruise ${(cruise.paddle.amp / DEG).toFixed(1)}°`);
});

test('her sightings: no paddle, no gape, no bite pose (they look as before)', () => {
  const sim = createTessie({ seed: 3, depthAt: () => 40 });
  sim.now(11, { boat: { x: 0, z: 0, heading: 0, speed: 3 } });
  for (let i = 0; i < 120; i++) sim.step(DT, { playing: true, boat: { x: 0, z: 0, heading: 0, speed: 3 } });
  assert.equal(sim.state.paddle, null); assert.equal(sim.state.gape ?? 0, 0);
  assert.equal(sim.state.played, false);
});

test('the bite\'s beats on her rig: the wind-up draws her head back and up and coils her trunk; the strike carries it on; a hit rolls her into it; the jaw at most 15°', () => {
  const o = make();
  run(o, 4, { move: [0, 1] });
  const b = ahead(o, 6);
  const sp = o.sim.state.spine, rel = () => { const s = o.sim.state.spine, n = o.sim.state.nose; return (s[0] - n.x) * Math.sin(n.psi) - (s[2] - n.z) * Math.cos(n.psi); };   // her head ahead of her nose (m)
  const side = () => { const s = o.sim.state.spine, n = o.sim.state.nose, i = Math.round(14 / (o.sim.L / 63)); return (s[i * 8] - n.x) * Math.cos(n.psi) + (s[i * 8 + 2] - n.z) * Math.sin(n.psi); };
  const rel0 = rel(), side0 = side(), y0 = sp[1];
  let windRel = Infinity, windY = -Infinity, windSide = 0, strikeRel = -Infinity, roll = 0, gape = 0;
  run(o, 1.6, (t) => ({ move: [0, 1], bite: t < 0.02 }), { target: { ...b, d: 4.5 }, lock: lockOf(b) }, () => {
    for (const e of o.C.events) if (e.type === 'contact') o.C.result(true);
    const ph = o.C.state.phase, s = o.sim.state.spine;
    if (ph === 'windup') { windRel = Math.min(windRel, rel()); windY = Math.max(windY, s[1]); windSide = Math.max(windSide, Math.abs(side() - side0)); }
    if (ph === 'strike' || ph === 'follow') strikeRel = Math.max(strikeRel, rel());
    if (ph === 'follow') roll = Math.max(roll, Math.abs(rollAt(s, 26)));
    gape = Math.max(gape, o.sim.state.gape ?? 0);
  });
  assert.ok(windRel < rel0 - 0.3, `the wind-up draws her head back (${rel0.toFixed(2)} → ${windRel.toFixed(2)} m ahead of her nose)`);
  assert.ok(windSide > 0.3, `her trunk coils (${windSide.toFixed(2)} m aside at 14 m)`);
  assert.ok(strikeRel > rel0 + 1.0, `the strike carries her head on (${strikeRel.toFixed(2)} m ahead of her nose)`);
  assert.ok(roll > 18 * DEG && roll <= BITE2.rail.roll * DEG + 6 * DEG, `a hit rolls her into it (${(roll / DEG).toFixed(1)}°)`);
  assert.ok(gape > 12 * DEG && gape <= 15 * DEG + 1e-9, `the jaw opens ${(gape / DEG).toFixed(1)}° (at most 15°)`);
  assert.ok(windY > y0 - 0.5, 'her head stays up through the wind-up');
});

test('the dash bite rolls her 40° into a hit; every other free breach rolls her 70° in the air', () => {
  const o = make();
  run(o, 4, { move: [0, 1] });
  let roll = 0;
  run(o, 1.6, (t) => ({ move: [0, 1], dash: t < 0.02, bite: t > 0.2 && t < 0.22 }), {}, () => { for (const e of o.C.events) if (e.type === 'contact') o.C.result(true); if (o.C.state.phase === 'follow') roll = Math.max(roll, Math.abs(rollAt(o.sim.state.spine, 26))); });
  assert.ok(roll > 30 * DEG && roll <= 42 * DEG, `the dash bite's roll ${(roll / DEG).toFixed(1)}°`);
  const rolls = [];
  for (let k = 0; k < 2; k++) {
    run(o, 7, { move: [0, 1] });
    let most = 0; run(o, 3.2, (t) => ({ move: [0, 1], dash: t < 0.02, look: -15 * DEG }), {}, () => { if (o.C.state.lunge?.phase === 'breach') most = Math.max(most, Math.abs(rollAt(o.sim.state.spine, 38))); });
    rolls.push(most);
  }
  assert.ok(Math.min(...rolls) < 15 * DEG && Math.max(...rolls) > 55 * DEG, `the two free breaches: ${rolls.map((r) => (r / DEG).toFixed(0)).join('° and ')}°`);
});
