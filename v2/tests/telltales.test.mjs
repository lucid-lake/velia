// BACKLOG-v2 #20, the boat's own wind instruments (v2/render/boat/telltales.js), read from the physics: the jib's luff
// telltales (good trim: both streaming; eased or pinching: the windward yarn lifts; sheeted too hard or bearing away: the
// leeward yarn stalls), the main's leech ribbons (streaming; curled behind the sail when stalled), the masthead vane on
// the apparent wind. Behaviour only: the states, the drawn points' directions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { jibTell, leechTell, telltaleStates, createBoatDetails, TELL } from '../render/boat/telltales.js';
import { buildRigParts, sailGrid, fillSail, mainPoint, jibPoint, sailParams, SAIL_GRIDS } from '../render/boat/mesh.js';

const DEG = Math.PI / 180;
const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });
const sim = () => { const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(6, 200) }); B.settle(20); return B; };
const run = (B, s, hands) => { let p = B.pose; for (let i = 0; i < Math.round(s * 60); i++) p = B.step(1 / 60, hands); return p; };
const rig = buildRigParts();
// the drawn sails' grids for a pose, as boat.js fills them
function sailsFor(p) {
  const sp = sailParams(p), gj = sailGrid(...SAIL_GRIDS.jib), gm = sailGrid(...SAIL_GRIDS.main);
  fillSail(gj, jibPoint, sp.jib); fillSail(gm, mainPoint, sp.main);
  return { jib: { g: gj, luff: 0, luffTop: 0, shown: true }, main: { g: gm, luff: 0, luffTop: 0, shown: true } };
}
const chordAt = (g, v) => { const j = Math.round(v * g.nv); return g.metric[2 * (j * (g.nu + 1) + g.nu)]; };   // the sail's chord at a height (m)
const angleOf = (dx, dz) => Math.atan2(dx, -dz);   // the boat frame's angle of a horizontal direction (+ toward starboard)
const wrapDeg = (a) => ((a / DEG + 540) % 360) - 180;

test('the trim → the jib yarns: in the groove both stream; too small an angle lifts the windward one; past the stall the leeward one goes', () => {
  const good = jibTell(10 * DEG), eased = jibTell(2 * DEG), hard = jibTell(22 * DEG);
  assert.ok(good.windward < 0.05 && good.leeward < 0.05, `good trim streams both: ${JSON.stringify(good)}`);
  assert.ok(eased.windward > 0.8 && eased.leeward < 0.05, `eased or pinching lifts the windward yarn only: ${JSON.stringify(eased)}`);
  assert.ok(hard.leeward > 0.9 && hard.windward < 0.05, `sheeted too hard stalls the leeward yarn only: ${JSON.stringify(hard)}`);
  const lc = leechTell(22 * DEG), ls = leechTell(10 * DEG), lf = leechTell(0, 0.1);
  assert.ok(lc.curl > 0.9 && ls.curl < 0.05, `the leech curls only when stalled: ${lc.curl}, ${ls.curl}`);
  assert.ok(lf.flap > 0.9 && lf.curl < 0.05, 'a luffing main flaps its leech ribbons, never curls them');
});

test('on the water: crew trim streams every yarn; the sheet hard in and bearing away curls the leech and stalls the leeward jib yarns; eased and pinching lifts the windward ones', () => {
  const B = sim();
  let s = telltaleStates(B.pose);
  assert.ok(s.jib.every((j) => j.windward < 0.1 && j.leeward < 0.1) && s.leech.every((l) => l.curl < 0.2 && l.flap < 0.1), `the crew's trim streams them all: ${JSON.stringify(s)}`);
  s = telltaleStates(run(B, 3, { steer: 0.6, pull: 1 }));   // overtrimmed: sheet in, bearing away
  assert.ok(s.leech.every((l) => l.curl > 0.8), `overtrimmed: the leech ribbons curl (${s.leech.map((l) => l.curl.toFixed(2))})`);
  assert.ok(s.jib.every((j) => j.leeward > 0.5 && j.windward < 0.05), `overtrimmed: the jib's leeward yarns stall (${s.jib.map((j) => j.leeward.toFixed(2))})`);
  run(B, 1, { steer: 0, pull: 0 }); run(B, 0.25, { steer: -0.6, pull: -1 }); run(B, 0.45, { steer: -0.6, pull: 0 });
  s = telltaleStates(run(B, 2.3, { steer: 0, pull: 0 }));   // eased back to the groove
  assert.ok(s.jib.every((j) => j.windward < 0.1 && j.leeward < 0.1) && s.leech.every((l) => l.curl < 0.1), `back in the groove they stream: ${JSON.stringify(s)}`);
  run(B, 0.6, { steer: -0.8, pull: -1 }); run(B, 0.7, { steer: -0.8, pull: 0 });
  s = telltaleStates(run(B, 1.2, { steer: 0, pull: 0 }));   // undertrimmed and pinching
  assert.ok(s.jib.every((j) => j.windward > 0.6 && j.leeward < 0.05), `undertrimmed: the windward yarns lift (${s.jib.map((j) => j.windward.toFixed(2))})`);
  assert.ok(s.leech.every((l) => l.flap > 0.5 && l.curl < 0.05), 'the luffing main flaps its leech ribbons');
});

test('the drawn yarns: streaming aft along the cloth in the groove; the stalled leech ribbons curl round to leeward; the lifted windward yarn stands off its face', () => {
  const B = sim(), d = createBoatDetails(rig.rig);
  const tipDir = (ln) => { const p = ln.points, a = p[0], b = p[p.length - 1]; return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; };
  let p = B.pose, lines = d.update(p, 20, sailsFor(p), { instant: true });
  assert.equal(d.jibLines, 6, 'three pairs on the jib');
  const lee0 = Math.sign(p.jibAngle), offOf = (ln) => { const v = tipDir(ln); return -lee0 * v[0] / Math.hypot(...v); };   // the tip's lean to windward
  const off0 = lines.slice(0, 6).filter((ln) => ln.face !== lee0).map(offOf);
  for (const ln of lines.slice(0, 9)) { const v = tipDir(ln), L = Math.hypot(...v); assert.ok(v[2] / L > 0.6, `a streaming yarn points aft (z ${(v[2] / L).toFixed(2)})`); }
  const lee = Math.sign(p.jibAngle);
  p = run(B, 3, { steer: 0.6, pull: 1 });
  lines = d.update(p, 23, sailsFor(p));
  const leech = lines.slice(d.jibLines, d.jibLines + 3);
  for (const ln of leech) { const v = tipDir(ln), L = Math.hypot(...v); assert.ok(v[0] * lee / L > 0.5 && v[2] / L < 0.5, `a stalled leech ribbon curls to leeward, not aft (x ${(v[0] / L).toFixed(2)}, z ${(v[2] / L).toFixed(2)})`); }
  run(B, 1, { steer: 0, pull: 0 }); run(B, 0.25, { steer: -0.6, pull: -1 }); run(B, 0.45, { steer: -0.6, pull: 0 }); run(B, 2.3, { steer: 0, pull: 0 });
  run(B, 0.6, { steer: -0.8, pull: -1 }); run(B, 0.7, { steer: -0.8, pull: 0 });
  p = run(B, 1.2, { steer: 0, pull: 0 });
  assert.equal(Math.sign(p.jibAngle), lee0, 'still on the same tack');
  lines = d.update(p, 31, sailsFor(p));
  const off = lines.slice(0, 6).filter((ln) => ln.face !== lee0).map(offOf);
  assert.equal(off.length, 3);
  assert.ok(off.every((o, i) => o > off0[i] + 0.3), `the lifted windward yarns stand off to windward (${off.map((o) => o.toFixed(2))} vs streaming ${off0.map((o) => o.toFixed(2))})`);
});

test('the masthead vane points into the apparent wind, damped', () => {
  const B = sim(), d = createBoatDetails(rig.rig);
  let p = B.pose, t = 20;
  d.update(p, t, sailsFor(p), { instant: true });
  for (let i = 0; i < 240; i++) { p = B.step(1 / 60, { steer: 0, pull: 0 }); t += 1 / 60; d.update(p, t, { jib: { shown: false }, main: { shown: false } }); }
  const lines = d.lines, shaft = lines[lines.length - 3];   // spindle, tabs ×2, shaft, head, fin
  const [h, tl] = shaft.points;
  const vane = angleOf(h[0] - tl[0], h[2] - tl[2]);
  assert.ok(Math.abs(wrapDeg(vane - p.apparentWind.angle)) < 3, `the arrow on the apparent wind: ${wrapDeg(vane).toFixed(1)}° vs ${wrapDeg(p.apparentWind.angle).toFixed(1)}°`);
  // damped: a 40° step in the apparent wind is not followed at once, and is followed within 2 s, with no wild overshoot
  const q = { ...p, apparentWind: { ...p.apparentWind, angle: p.apparentWind.angle + 40 * DEG } };
  const a0 = d.vaneAngle; d.update(q, t + 1 / 60, { jib: { shown: false }, main: { shown: false } });
  assert.ok(Math.abs(wrapDeg(d.vaneAngle - a0)) < 5, 'one frame turns it only a little');
  let peak = 0;
  for (let i = 2; i <= 120; i++) { d.update(q, t + i / 60, { jib: { shown: false }, main: { shown: false } }); peak = Math.max(peak, wrapDeg(d.vaneAngle - a0)); }
  assert.ok(Math.abs(wrapDeg(d.vaneAngle - q.apparentWind.angle)) < 3, `settled on the new wind in 2 s (${wrapDeg(d.vaneAngle - q.apparentWind.angle).toFixed(1)}° off)`);
  assert.ok(peak < 40 * 1.25, `overshoot under 25 % (${peak.toFixed(1)}°)`);
});

test('cheap: one update allocates no new line or point (the same objects every frame); sails down hide their yarns', () => {
  const B = sim(), d = createBoatDetails(rig.rig), s = sailsFor(B.pose);
  const a = d.update(B.pose, 20, s).slice(), pts = a.map((l) => l.points[1]);
  const b = d.update(B.pose, 20.1, s);
  assert.ok(b.every((l, i) => l === a[i] && l.points[1] === pts[i]), 'the same lines and points, refilled');
  const none = d.update(B.pose, 20.2, { jib: { ...s.jib, shown: false }, main: { ...s.main, shown: false } });
  assert.equal(none.length, 6, 'with both sails down only the vane (6 lines) remains');
  assert.ok(TELL.jib.L < 0.6 && TELL.leech.L < 0.6, 'the yarns stay yarn-sized');
});

test('bigger on screen: far off the yarns and the vane grow to their floor in CSS px (a phone smaller, a tall view larger), up to the cap; close up nothing grows', () => {
  const B = sim(), d = createBoatDetails(rig.rig), S = sailsFor(B.pose), SC = TELL.screen;
  const len = (ln) => { let L = 0; for (let i = 1; i < ln.points.length; i++) { const a = ln.points[i - 1], b = ln.points[i]; L += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); } return L; };
  d.update(B.pose, 20, S, { ppm: 300 });   // a close-up: 300 px a metre
  assert.ok(Object.values(d.grow).every((g) => g === 1), `close up nothing grows: ${JSON.stringify(d.grow)}`);
  for (const [ppm, viewH] of [[14, 390], [30, 720], [45, 1080]]) {   // the follow camera's distance: a phone, a 720 p desk, a 1080 p desk
    const lines = d.update(B.pose, 20, S, { ppm, viewH }), vs = Math.min(1.5, Math.max(0.75, viewH / 720));
    for (const [k, ln] of lines.slice(0, 9).entries()) {
      const px = len(ln) * ppm, w = -ln.diameterM * ppm;
      // a jib yarn also ends on its cloth: at most 60 % of the chord aft of its root
      const room = k < 6 ? 0.6 * (1 - TELL.jib.u) * chordAt(S.jib.g, TELL.jib.v[ln.h]) * ppm : Infinity;
      assert.ok(px >= Math.min(SC.yarnPx * vs, TELL.leech.L * SC.cap * ppm, room) * 0.97, `a yarn ${px.toFixed(1)} px long at ${ppm} px/m (floor ${(SC.yarnPx * vs).toFixed(1)})`);
      assert.ok(w >= SC.minWPx * 0.99, `and at least ${SC.minWPx} px wide (${w.toFixed(1)})`);
    }
    assert.ok((TELL.vane.head + TELL.vane.tail) * d.grow.vane * ppm >= Math.min(SC.vanePx * vs, 0.78 * SC.cap * ppm) * 0.99, 'the vane meets its floor');
  }
  d.update(B.pose, 20, S, { ppm: 1, viewH: 720 });   // very far: capped
  assert.ok(Object.values(d.grow).every((g) => g <= SC.capW), 'never past the cap');
  assert.ok(d.grow.yarn <= SC.cap && d.grow.vane <= SC.cap);
});

test('attached under heel and turn, at any size: each yarn starts at its spot on the cloth, a jib yarn ends on its jib; the vane on its stick', () => {
  const d = createBoatDetails(rig.rig), B = sim();
  const node = (g, u, v) => { const k = Math.round(v * g.nv) * (g.nu + 1) + Math.round(u * g.nu); return [g.position[3 * k], g.position[3 * k + 1], g.position[3 * k + 2]]; };
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let p = B.pose;
  for (const [heelDeg, steer, ppm] of [[0, 0, 0], [25, 1, 14], [-25, -1, 14], [15, 0.5, 30], [30, -0.6, 5]]) {
    p = run(B, 1.5, { steer, pull: 0 });
    const q = { ...p, heel: heelDeg * DEG, pitch: 4 * DEG }, S = sailsFor(q);
    const lines = d.update(q, 30, S, { ppm, viewH: 390 });
    lines.slice(0, 6).forEach((ln) => {
      const root = node(S.jib.g, TELL.jib.u, TELL.jib.v[ln.h]), ch = chordAt(S.jib.g, TELL.jib.v[ln.h]);
      assert.ok(dist(ln.points[0], root) < 0.15, `a jib yarn starts on its spot (${dist(ln.points[0], root).toFixed(3)} m off; heel ${heelDeg}°, ${ppm} px/m)`);
      const tipOff = dist(ln.points[ln.points.length - 1], root);
      assert.ok(tipOff < 0.8 * (1 - TELL.jib.u) * ch || tipOff <= TELL.jib.L + 0.05, `and ends on its jib, short of the leech (${tipOff.toFixed(2)} m from its root, ${((1 - TELL.jib.u) * ch).toFixed(2)} m of cloth aft of it)`);
    });
    lines.slice(6, 9).forEach((ln) => {
      const root = node(S.main.g, 1, TELL.leech.v[ln.h]);
      assert.ok(dist(ln.points[0], root) < 0.15, `a leech ribbon starts on the leech (${dist(ln.points[0], root).toFixed(3)} m off; heel ${heelDeg}°, grown ${d.grow.leech.toFixed(2)} x)`);
    });
    const spindle = lines[lines.length - 6];
    assert.ok(dist(spindle.points[0], d.vaneAt) < 1e-9, 'the vane stands on its stick');
  }
});
