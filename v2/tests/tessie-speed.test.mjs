// Play as Tessie, phase 2d step 1 (§ 8.5): the speed by medium, the dash and its cooldown, the turn's ramp, the bank,
// the skills model. Behaviour only: her real sim and the controller are stepped and their state read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlay, PLAY, mediumU, mediumK, turnRate, bankFor, rampTurn } from '../sim/tessiePlay.js';
import { createSkills, SKILLS } from '../sim/tessieSkills.js';

const DT = 1 / 30, DEG = Math.PI / 180;
const make = () => { const depthAt = () => 40; const sim = createTessie({ seed: 3, depthAt }); const C = createTessiePlay({ sim, depthAt }); C.begin({ x: 0, z: 0, heading: 0 }); return { sim, C }; };
const run = (sim, C, secs, hands, each = null) => { for (let i = 0; i < Math.round(secs / DT); i++) { sim.step(DT, { playing: true }); C.step(DT, typeof hands === 'function' ? hands(i * DT) : hands, {}); each?.(i * DT); } };
const deep = (o) => { run(o.sim, o.C, 8, { move: [0, 1], sink: true }); run(o.sim, o.C, 2, (t) => ({ move: [0, 1], sink: o.C.state.nose < 8, rise: o.C.state.nose > 9 })); };

test('the blend by depth: the surface numbers above 1.2 m, the water\'s past 3.0 m, smooth between (no step)', () => {
  assert.equal(mediumU(0.75), 0); assert.equal(mediumU(1.2), 0); assert.equal(mediumU(3.0), 1); assert.equal(mediumU(12), 1);
  assert.equal(mediumK(0.5).cruise, 6); assert.equal(mediumK(5).cruise, 11); assert.equal(mediumK(5).dash, 19); assert.equal(mediumK(0.5).dash, 12);
  let worst = 0, prev = mediumK(1.0).cruise;
  for (let d = 1.0; d <= 3.2; d += 0.01) { const c = mediumK(d).cruise; worst = Math.max(worst, Math.abs(c - prev)); prev = c; }
  assert.ok(worst < 0.05, `the biggest change over 1 cm of depth: ${worst.toFixed(3)} m/s (no step)`);
  const mid = mediumK(2.1); assert.ok(mid.cruise > 7.5 && mid.cruise < 9.5, `half way down: ${mid.cruise.toFixed(2)} m/s`);
});

test('her speeds (§ 2.3): W 6 m/s at the surface and 11 m/s under the water; the dash 12 m/s at the surface and 19 m/s under', () => {
  const s = make();
  run(s.sim, s.C, 6, { move: [0, 1] });
  assert.ok(Math.abs(s.sim.state.nose.speed - 6) < 0.15 && s.C.state.nose < 1.2, `surface W: ${s.sim.state.nose.speed.toFixed(2)} m/s`);
  let topS = 0; run(s.sim, s.C, 1.8, (t) => ({ move: [0, 1], dash: t < DT }), () => { topS = Math.max(topS, s.sim.state.nose.speed); });
  assert.ok(Math.abs(topS - 12) < 0.2, `surface dash: ${topS.toFixed(2)} m/s`);
  const u = make(); deep(u);
  run(u.sim, u.C, 3, () => ({ move: [0, 1], sink: u.C.state.nose < 7.5, rise: u.C.state.nose > 9 }));
  assert.ok(Math.abs(u.sim.state.nose.speed - 11) < 0.2 && u.C.state.nose > 3, `under W: ${u.sim.state.nose.speed.toFixed(2)} m/s at ${u.C.state.nose.toFixed(1)} m`);
  let topU = 0, t19 = null;
  run(u.sim, u.C, 1.8, (t) => ({ move: [0, 1], dash: t < DT, sink: u.C.state.nose < 7.5, rise: u.C.state.nose > 9 }), (t) => { const v = u.sim.state.nose.speed; topU = Math.max(topU, v); if (t19 == null && v >= 18.8) t19 = t; });
  assert.ok(Math.abs(topU - 19) < 0.2, `under dash: ${topU.toFixed(2)} m/s`);
  assert.ok(t19 != null && t19 < 0.45, `ramped up, quick: 19 m/s after ${t19?.toFixed(2)} s`);
  // after the burst: back to her cruise at 8 m/s² (19 → 11 in about 1 s)
  run(u.sim, u.C, 1.2, () => ({ move: [0, 1], sink: u.C.state.nose < 7.5, rise: u.C.state.nose > 9 }));
  assert.ok(Math.abs(u.sim.state.nose.speed - 11) < 0.4 && !u.C.state.dash, `eased back to her cruise (${u.sim.state.nose.speed.toFixed(2)} m/s)`);
});

test('the dash: 1.8 s, then 4.5 s of cooldown; it cannot repeat inside 6.3 s; held Shift does nothing more; a press in the last 0.3 s is buffered', () => {
  const { sim, C } = make();
  run(sim, C, 3, { move: [0, 1] });
  const fires = []; let t = 0, activeS = 0;
  run(sim, C, 14, (tt) => ({ move: [0, 1], sprint: true, dash: Math.abs((tt % 1.0)) < DT / 2 }), () => { t += DT; for (const e of C.events) if (e.type === 'dash') fires.push(+t.toFixed(2)); if (C.state.dash) activeS += DT; });   // Shift held and a press every second
  assert.ok(fires.length >= 2, `fired ${fires.join(', ')}`);
  for (let i = 1; i < fires.length; i++) assert.ok(fires[i] - fires[i - 1] >= 6.3 - 0.05, `never inside 6.3 s (${fires.join(', ')})`);
  assert.ok(activeS > 1.8 * fires.length - 0.1 && activeS < 1.8 * fires.length + 0.1, `each burst 1.8 s (${activeS.toFixed(2)} s for ${fires.length})`);
  const H = make(); run(H.sim, H.C, 2, { move: [0, 1] });
  let n = 0; run(H.sim, H.C, 10, { move: [0, 1], sprint: true }, () => { for (const e of H.C.events) if (e.type === 'dash') n++; });
  assert.equal(n, 1, 'Shift held: one dash only');
  // the buffer, on the skill itself
  const S = createSkills(SKILLS);
  assert.equal(S.press('dash'), true); S.step(1.8 + 4.5 - 0.25);
  assert.equal(S.state('dash').phase, 'cool');
  assert.equal(S.press('dash'), true, 'in the last 0.3 s: buffered'); assert.equal(S.state('dash').buffered, true);
  const fired = S.step(0.3);
  assert.deepEqual(fired, ['dash']); assert.equal(S.state('dash').phase, 'active');
  const S2 = createSkills(); S2.press('dash'); S2.step(1.8 + 1.0);
  assert.equal(S2.press('dash'), false, 'too early in the cooldown: nothing');
});

test('the skill model: key, cooldown, level; its ring full when ready, emptying while active, refilling while it cools', () => {
  const S = createSkills();
  assert.deepEqual(S.list().map((r) => [r.id, r.key, r.activeS, r.cooldownS, r.level]), [['dash', 'Shift', 1.8, 4.5, 1]]);
  assert.deepEqual([S.state('dash').phase, S.state('dash').k], ['ready', 1]);
  S.press('dash'); S.step(0.9);
  assert.equal(S.state('dash').phase, 'active'); assert.ok(Math.abs(S.state('dash').k - 0.5) < 1e-6);
  S.step(0.9 + 2.25);
  assert.equal(S.state('dash').phase, 'cool'); assert.ok(Math.abs(S.state('dash').k - 0.5) < 1e-6);
  S.step(2.3);
  assert.deepEqual([S.state('dash').phase, S.state('dash').k], ['ready', 1]);
  const more = createSkills({ ...SKILLS, ping: { id: 'ping', key: 'R', activeS: 3, cooldownS: 10, bufferS: 0, level: 2 } });
  assert.deepEqual(more.list().map((r) => r.id), ['dash', 'ping'], 'a table row is a skill: the HUD draws one slot each');
  assert.equal(more.state('ping').level, 2);
});

test('the turn ramps (no bang-bang): the turn rate grows at most 90°/s² at the surface, and her turn at cruise reaches 30°/s', () => {
  const { sim, C } = make();
  run(sim, C, 5, { move: [0, 1] });
  const rates = []; let prev = sim.state.nose.psi;
  run(sim, C, 2, { move: [1, 0] }, () => { const p = sim.state.nose.psi; rates.push(Math.atan2(Math.sin(p - prev), Math.cos(p - prev)) / DT); prev = p; });
  let jerk = 0; for (let i = 1; i < rates.length; i++) jerk = Math.max(jerk, Math.abs(rates[i] - rates[i - 1]) / DT);
  assert.ok(rates[0] < 5 * DEG, `the first step turns gently (${(rates[0] / DEG).toFixed(1)}°/s)`);
  assert.ok(jerk <= 95 * DEG, `the ramp: ${(jerk / DEG).toFixed(0)}°/s² at most`);
  assert.ok(Math.max(...rates) > 28 * DEG && Math.max(...rates) <= 32 * DEG, `her cruise turn ${(Math.max(...rates) / DEG).toFixed(1)}°/s`);
  // the rates themselves, from the table
  const Ms = mediumK(0.5), Mu = mediumK(6);
  assert.ok(Math.abs(turnRate(Ms, 6) / DEG - 30) < 1e-9 && Math.abs(turnRate(Mu, 11) / DEG - 50) < 1e-9 && Math.abs(turnRate(Ms, 12) / DEG - 14) < 1e-9 && Math.abs(turnRate(Mu, 19) / DEG - 24) < 1e-9 && Math.abs(turnRate(Ms, 0.5) / DEG - 15) < 1e-9);
  // rolling out: no overshoot past the wanted heading
  let w = 30 * DEG, err = 10 * DEG, over = 0; for (let i = 0; i < 90; i++) { w = rampTurn(w, err, 30 * DEG, 90 * DEG, DT); err -= w * DT; over = Math.min(over, err); }
  assert.ok(over > -0.5 * DEG && Math.abs(err) < 0.2 * DEG, `rolled out onto the heading (overshoot ${(over / DEG).toFixed(2)}°)`);
});

test('the bank: into the turn, at most 12° at the surface and 30° under the water; her body rolls only while driven', () => {
  assert.ok(bankFor(6, 30 * DEG, 12) > 0 && bankFor(6, -30 * DEG, 12) < 0);
  assert.equal(bankFor(19, 3, 12), 12 * DEG); assert.equal(bankFor(19, 3, 30), 30 * DEG);
  const { sim, C } = make();
  run(sim, C, 5, { move: [0, 1] });
  run(sim, C, 2, { move: [1, 0] });   // a right turn
  assert.ok(C.state.bank > 4 * DEG && C.state.bank <= 12 * DEG + 1e-9, `the bank ${(C.state.bank / DEG).toFixed(1)}°`);
  // her up vectors at mid body lean to her right (the heading's right: (cos ψ, sin ψ) in x, z)
  // her right at frame i: horizontal, across the local spine (the spine runs nose → tail, so right = (−tz, tx) of the forward tangent)
  const leanAt = (sp, i) => { const fx = sp[(i - 1) * 8] - sp[(i + 1) * 8], fz = sp[(i - 1) * 8 + 2] - sp[(i + 1) * 8 + 2], l = Math.hypot(fx, fz) || 1; return sp[i * 8 + 4] * (-fz / l) + sp[i * 8 + 6] * (fx / l); };
  const i = 30, lean = leanAt(sim.state.spine, i);
  assert.ok(lean > 0.05, `mid body leans into the right turn (${lean.toFixed(3)})`);
  C.end();
  for (let k = 0; k < 10; k++) sim.step(DT, { playing: true });
  const lean2 = leanAt(sim.state.spine, i);
  assert.ok(Math.abs(lean2) < 0.03, `given back: no roll (${lean2.toFixed(3)})`);
});

test('the felt speed under the water: the specks stretch 1 + min(2.5, v · 0.15) × their disc: 2.65 at 11 m/s, 3.5 at 19 m/s', async () => {
  const { speckStretch, SPECK } = await import('../render/underLight.js');
  assert.equal(speckStretch(0), 1); assert.ok(Math.abs(speckStretch(11) - 2.65) < 1e-9); assert.equal(speckStretch(19), 3.5); assert.equal(speckStretch(40), 3.5);
  assert.deepEqual([...SPECK.stretch], [0.15, 3.5]);
});
