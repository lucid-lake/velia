// Play as Tessie, phase 2c (owner, 2026-11-20): the small 2c. Behaviour only: the sim, the controller and the camera are called and read.
//   a dive in place: at a drift her body follows her nose down within about two seconds (the camera goes properly under)
//   the strike from below: rings on the surface over her for 1.5 s before the breach (the 'warn' events), the breach never sooner
//   the camera through it: under the water it glides in short of the hull and looks up at it; out of it, up with her, never a jump
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlay, PLAY } from '../sim/tessiePlay.js';
import { createTessieCam, TCAM } from '../ui/tessieCam.js';

const DT = 1 / 30;
const make = () => { const depthAt = () => 40; const sim = createTessie({ seed: 3, depthAt }); const C = createTessiePlay({ sim, depthAt }); C.begin({ x: 0, z: 0, heading: 0 }); return { sim, C }; };
const step = (sim, C, secs, hands, ctx = {}, each = null) => { for (let i = 0; i < Math.round(secs / DT); i++) { sim.step(DT, { playing: true }); C.step(DT, typeof hands === 'function' ? hands() : hands, typeof ctx === 'function' ? ctx() : ctx); each?.(); } };

test('a dive in place: at a drift her body follows her nose down within about two seconds', () => {
  const { sim, C } = make();
  step(sim, C, 4, {});   // at the surface, a drift
  step(sim, C, 2.5, { sink: true });
  const sp = sim.state.spine, N = sp.length / 8, nose = -sp[1], back = -sp[Math.round(N * 0.4) * 8 + 1];
  assert.ok(nose > 4, `she dove (${nose.toFixed(1)} m)`);
  step(sim, C, 2, {});
  const sp2 = sim.state.spine, nose2 = -sp2[1], back2 = -sp2[Math.round(N * 0.4) * 8 + 1];
  assert.ok(back2 > nose2 - 1.5, `her body 7.6 m back follows (${back2.toFixed(1)} m vs her nose ${nose2.toFixed(1)} m; ${back.toFixed(1)} m 2 s earlier)`);
});

test('the strike from below: rings over her for 1.5 s, the breach never sooner; the boats see them (warn)', () => {
  const { sim, C } = make();
  step(sim, C, 6, { move: [0, 1], sink: true });
  assert.ok(C.state.nose > PLAY.strikeFrom + 1, `deep first (${C.state.nose.toFixed(1)} m)`);
  const n = sim.state.nose, tg = { id: 'b', kind: 'sail', x: n.x + Math.sin(n.psi) * 8, z: n.z - Math.cos(n.psi) * 8, heading: 0, u: 0, d: 8, inReach: true, L: 8.5, B: 3 };
  const lock = { ...tg, k: 1, ix: tg.x, iz: tg.z, under: true };   //: the rising strike starts from the lock
  const warns = []; let t = 0, breachAt = null;
  step(sim, C, 4, () => ({ bite: t < 0.1 }), { target: tg, lock }, () => { t += DT; for (const e of C.events) if (e.type === 'warn') warns.push(t); if (breachAt == null && C.state.lunge?.phase === 'breach') breachAt = t; });
  assert.ok(warns.length >= 4 && warns[0] < 0.1 && warns[warns.length - 1] <= PLAY.warn.s + 0.05, `rings over the warning's ${PLAY.warn.s} s (${warns.length}, last at ${warns.at(-1)?.toFixed(2)} s)`);
  assert.ok(breachAt != null && breachAt >= PLAY.warn.s - 0.05, `the breach after the warning (${breachAt?.toFixed(2)} s)`);
  assert.ok((sim.state.water?.rings?.length ?? 0) > 0, 'real rings in her water');
});

test('the camera through the strike: in short of the hull, looking up at it; then up with her, never a jump', () => {
  const { sim, C } = make();
  step(sim, C, 6, { move: [0, 1], sink: true });
  const cam = createTessieCam();
  const n = sim.state.nose, strike = { phase: 'rise', rise: true, x: n.x + Math.sin(n.psi) * 14, z: n.z - Math.cos(n.psi) * 14 };
  const base = { L: sim.L, waterAt: () => 0, floorAt: () => -40, underOn: true };
  for (let i = 0; i < 60; i++) { sim.step(DT, { playing: true }); C.step(DT, {}); cam.step(DT, { ...base, spine: sim.state.spine, psi: sim.state.nose.psi, nose: C.state.nose, speed: sim.state.nose.speed }); }
  let last = null, worst = 0, out = null;
  for (let i = 0; i < 45; i++) { out = cam.step(DT, { ...base, spine: sim.state.spine, psi: sim.state.nose.psi, nose: C.state.nose, speed: sim.state.nose.speed, strike }); if (last) worst = Math.max(worst, Math.hypot(out.pos[0] - last[0], out.pos[1] - last[1], out.pos[2] - last[2]) / DT); last = [...out.pos]; }
  const toHull = Math.hypot(out.pos[0] - strike.x, out.pos[2] - strike.z);
  assert.ok(toHull < TCAM.under.strikeBack + 2, `in short of the hull (${toHull.toFixed(1)} m)`);
  assert.ok(cam.pitch < -10 * Math.PI / 180, `looking up at it (${(cam.pitch * 180 / Math.PI).toFixed(1)}°)`);
  assert.ok(worst <= sim.state.nose.speed + TCAM.spring.vOver + TCAM.under.vMax + 0.5, `never a jump (${worst.toFixed(1)} m/s at most: her pace + 6 over the ground, 5 up or down)`);
});
