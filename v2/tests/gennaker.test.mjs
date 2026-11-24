// The gennaker (owner, 2026-11-21: "Flying downwind under a spinnaker … Impl this"): behaviour through the sloop's own
// physics (src/sim/boat.js with src/sim/sail/gennaker.js), its drawing's descriptor (v2/render/boat/gennaker.js), its key's rule
// (none since round 2: the crew flies it, v2/tests/gennakerCrew.test.mjs) and its device policy (src/core/features.js gennakerCloth). The numbers are's.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, Helm, steadyWind, KN, DT } from '../../src/sim/boat.js';
import { GENNAKER, createGennaker, stepGennaker, gkWindow, gkPhase } from '../../src/sim/sail/gennaker.js';
import { sailParams } from '../../src/boat/rig.js';
import { gkDesc, gennakerPoint, gkClew } from '../render/boat/gennaker.js';
import { POLICIES } from '../../src/core/features.js';
import { snapshotPhysics } from '../../src/sim/sail/simulation.js';

const DEG = Math.PI / 180, G = 9.81;
// sail a true wind angle (deg) in a wind (kn, from the north); each(st, t) per tick; gk: the gennaker asked for (bool or fn(t))
function sail({ tws, twa, secs, gk = false, gkHand, wind = null, sheet, params, sea = null, each = () => {} }) {
  const b = new BoatPhysics({ heading: -twa * DEG, speed: 3, params });
  const h = new Helm(), env = { windAt: wind ?? steadyWind(tws * KN, 0), t: 0 };
  for (let i = 0; i < secs * 60; i++) {
    env.t = i * DT; if (sea) env.sea = sea(b, env.t);
    const c = { ...CONTROLS, rudder: h.toTWA(b.state, twa * DEG, 0), ...(sheet != null ? { sheet } : {}), ...(gkHand != null ? { gkHand } : {}) };
    const want = typeof gk === 'function' ? gk(env.t) : gk;
    if (want !== undefined) c.gennaker = want;
    each(b.step(DT, c, env), env.t, b);
  }
  return b;
}
const meanKn = (o) => { let su = 0, n = 0; sail({ ...o, each: (st, t) => { if (t > o.secs - 20) { su += st.u; n++; } } }); return su / n / KN; };

test('a boat that never hoists it is untouched: no gennaker state, the same ticks as before', () => {
  const a = sail({ tws: 14, twa: 130, secs: 20 }), b = sail({ tws: 14, twa: 130, secs: 20, gk: false });
  assert.equal(a.state.gk, undefined); assert.equal(a.gk, undefined); assert.equal(b.gk, undefined);
  assert.equal(snapshotPhysics(a).gk, undefined, 'no gennaker in the snapshot');
  assert.deepEqual([a.state.x, a.state.z, a.state.u, a.state.heel], [b.state.x, b.state.z, b.state.u, b.state.heel]);
  assert.equal(sailParams(a.state).jib.furl, 0, 'the jib set');
});

test('the polar gain: +15 to +30 % at 135° true from 8 to 20 kn', () => {
  for (const tws of [8, 12, 16, 20]) {
    const base = meanKn({ tws, twa: 135, secs: 90 }), up = meanKn({ tws, twa: 135, secs: 90, gk: true });
    const gain = up / base - 1;
    assert.ok(gain >= 0.15 && gain <= 0.3, `${tws} kn: ${base.toFixed(2)} → ${up.toFixed(2)} kn (${(gain * 100).toFixed(0)} %)`);
  }
});

test('the window: it flies from about 90° to 160° true; dead downwind the main blankets it and it collapses', () => {
  assert.equal(gkWindow(40 * DEG), 0); assert.equal(gkWindow(100 * DEG), 1); assert.equal(gkWindow(165 * DEG), 0);
  const fillAt = (twa) => sail({ tws: 16, twa, secs: 40, gk: true }).state.gk.fill;
  assert.ok(fillAt(130) > 0.95, 'a broad reach: full');
  assert.ok(fillAt(165) < 0.2, 'nearly dead downwind: collapsed');
});

test('collapse and refill: it falls in fast, waits a beat of slack, then snaps full with one bang', () => {
  const G0 = createGennaker(), dt = 1 / 60;
  const run = (secs, awa) => { for (let i = 0; i < secs * 60; i++) stepGennaker(G0, { want: true, dt, awa, va: 6 }); };
  run(GENNAKER.hoistS + 2, 110 * DEG);
  assert.equal(G0.fill > 0.98 && G0.bangs, 1, 'hoisted: full, the first bang');
  run(0.6, 170 * DEG);
  assert.ok(G0.fill < 0.25, `collapsed in 0.6 s (fill ${G0.fill.toFixed(2)})`);
  run(GENNAKER.refillS * 0.8, 110 * DEG);
  assert.ok(G0.fill < 0.25, 'the beat of slack before it refills');
  run(0.5, 110 * DEG);
  assert.ok(G0.fill > 0.9, `refilled within 0.5 s (fill ${G0.fill.toFixed(2)})`);
  assert.equal(G0.bangs, 2, 'one bang for the refill');
  assert.ok(G0.bang > 0.3, 'the bang cue is live just after');
});

test('the bang: hoisted on a broad reach in 15 kn she leaps forward ≥ 0.8 kn within 6 s, never past 0.35 m/s² (cheat on timing, never on motion)', () => {
  let u0 = null, bangT = null, uAt = null, maxA = 0, prev = null;
  sail({ tws: 15, twa: 130, secs: 80, gk: (t) => t >= 60, each: (st, t) => {
    if (prev != null && t > 60) maxA = Math.max(maxA, (st.u - prev) / DT); prev = st.u;
    if (st.gk && st.gk.bangs === 1 && bangT == null) { bangT = t; u0 = st.u; }
    if (bangT != null && uAt == null && t >= bangT + 6) uAt = st.u;
  } });
  assert.ok(bangT > 60 + GENNAKER.hoistS - 0.1 && bangT < 60 + GENNAKER.hoistS + 1.5, `the bang ${(bangT - 60).toFixed(1)} s after G`);
  assert.ok((uAt - u0) / KN >= 0.8, `the jump ${((uAt - u0) / KN).toFixed(2)} kn`);
  assert.ok(maxA <= 0.35 && maxA >= 0.1, `peak surge ${maxA.toFixed(3)} m/s²`);
});

// a wave train running downwind (λ m; the face's slope as the hull's waterplane reads it, amp): env.sea's slopeX along the bow
const waves = (lam, amp) => { const k = 2 * Math.PI / lam, w = Math.sqrt(G * k); return (b, t) => () => ({ slopeX: -amp * Math.cos(k * b.state.z - w * t) * Math.cos(b.state.heading), bowRelVel: 0 }); };
const surfShare = (o) => { let on = 0, n = 0, maxKn = 0; sail({ ...o, each: (st, t) => { if (t > 20) { n++; if (st.surf > 0.5) on++; maxKn = Math.max(maxKn, st.u / KN); } } }); return { share: on / n, maxKn }; };
test('surfing: in 14 kn and more she catches the faces under the gennaker (bursts past 7 kn); never on flat water, never in light air', () => {
  const fresh = surfShare({ tws: 16, twa: 140, secs: 80, gk: true, sea: waves(16, 0.07) });
  assert.ok(fresh.share > 0.1 && fresh.maxKn > 7.2, `16 kn: ${(fresh.share * 100).toFixed(0)} % surfing, ${fresh.maxKn.toFixed(2)} kn`);
  assert.equal(surfShare({ tws: 16, twa: 140, secs: 50, gk: false, sea: waves(16, 0.07) }).share, 0, 'no gennaker: under hull speed, no surf');
  assert.equal(surfShare({ tws: 16, twa: 140, secs: 50, gk: true }).share, 0, 'flat water: no face, no surf');
  assert.equal(surfShare({ tws: 9, twa: 140, secs: 50, gk: true, sea: waves(16, 0.07) }).share, 0, '9 kn: too slow to catch them');
});

test('the swap is visible (round 2): the sock goes up with the jib drawing, the jib rolls away, the sock lifts and it fills; the douse in reverse', () => {
  const K = GENNAKER, at = {}, marks = [2, K.sockS + K.rollS / 2, K.hoistS + 1.5, 15 + K.snuffS + K.unrollS / 2, 15 + K.douseS + 0.5];
  // each mark: the phase, the jib's rolled share, the gennaker's fill and drive, the jib's own drive (its area left × its fill)
  sail({ tws: 12, twa: 120, secs: 15 + K.douseS + 1, gk: (t) => t < 15, each: (st, t) => {
    for (const m of marks) if (Math.abs(t - m) < DT / 2) at[m] = { ph: st.gk.phase, sock: st.gk.sock, roll: st.gk.roll, lift: st.gk.lift, fill: st.gk.fill, gkDrive: st.gk.drive, jib: sailParams(st).jib.furl };
  } });
  const [a, b, c, d, e] = marks.map((m) => at[m]);
  assert.ok(a.ph === 'sock' && a.sock > 0.4 && a.sock < 0.6 && a.roll === 0 && a.jib === 0 && a.fill === 0, `2 s: the sock half way up, the jib still set (${JSON.stringify(a)})`);
  assert.ok(Math.abs(a.gkDrive) < 30, `in its sock the sail drives nothing (${a.gkDrive.toFixed(0)} N)`);
  assert.ok(b.ph === 'roll' && b.roll > 0.4 && b.roll < 0.6 && b.jib > 0.4 && b.jib < 0.6 && b.fill === 0, `mid-roll: the jib half rolled, the sail still in its sock (${JSON.stringify(b)})`);
  assert.ok(c.ph === 'flying' && c.fill > 0.95 && c.jib > 0.99 && c.gkDrive > 200, `up: the sock lifted, full, the jib rolled away (${JSON.stringify(c)})`);
  assert.ok(d.ph === 'roll' && d.fill < 0.1 && d.jib > 0.3 && d.jib < 0.7, `the douse: snuffed first, then the jib unrolling (${JSON.stringify(d)})`);
  assert.ok(e === undefined || e.sock === 0, 'down and stowed');
});

test('the drive follows the visible state: the jib\'s force falls as it rolls; the gennaker\'s only once the sock lifts', () => {
  const rows = [];
  sail({ tws: 12, twa: 120, secs: 30, gk: (t) => t >= 15, each: (st, t) => { if (t >= 14 && (Math.round(t * 60) % 6) === 0) rows.push({ t, roll: st.gk?.roll ?? 0, lift: st.gk?.lift ?? 0, gk: st.gk?.drive ?? 0, u: st.u }); } });
  const before = rows.filter((r) => r.lift === 0);
  assert.ok(before.every((r) => Math.abs(r.gk) < 30), 'no gennaker drive before the sock lifts');
  const lifted = rows.find((r) => r.lift >= 1 && r.gk > 200);
  assert.ok(lifted && lifted.t >= 15 + GENNAKER.hoistS - 0.05, `its drive comes after the lift (${lifted?.t.toFixed(2)} s)`);
  // the jib rolled away and nothing flying yet: she slows (the jib's force gone), then the bang drives her on
  const uSock = rows.find((r) => Math.abs(r.t - (15 + GENNAKER.sockS)) < 0.06).u, uRolled = rows.find((r) => Math.abs(r.t - (15 + GENNAKER.sockS + GENNAKER.rollS)) < 0.06).u;
  assert.ok(uRolled < uSock, `the jib's drive goes as it rolls: ${(uSock / KN).toFixed(2)} → ${(uRolled / KN).toFixed(2)} kn`);
  assert.ok(rows.at(-1).u > uSock, 'then the gennaker drives her past where she was');
});

test('the phases run backwards from where they are: a change of mind mid-roll unrolls the jib, never a jump', () => {
  const G0 = createGennaker(), dt = 1 / 60; let jump = 0, prev = 0;
  for (let i = 0; i < 14 * 60; i++) { const want = i < (GENNAKER.sockS + 1.5) * 60; stepGennaker(G0, { want, dt, awa: 110 * DEG, va: 6 }); jump = Math.max(jump, Math.abs(G0.roll - prev)); prev = G0.roll; }
  assert.ok(jump <= dt / GENNAKER.rollS + 1e-9, 'the jib rolls at its own rate both ways');
  assert.equal(gkPhase(G0), 'stowed'); assert.equal(G0.bangs, 0, 'it never filled');
});

test('the gybe: the clew flies round the forestay, the sail collapses as it crosses and refills on the new side with a bang', () => {
  const b = new BoatPhysics({ heading: -150 * DEG, speed: 5 }), h = new Helm(), env = { windAt: steadyWind(14 * KN, 0), t: 0 };
  let crossed = false, bangs0 = null;
  for (let i = 0; i < 50 * 60; i++) {
    env.t = i * DT; const twa = env.t < 25 ? 150 : -150;
    const st = b.step(DT, { ...CONTROLS, gennaker: true, rudder: h.toTWA(b.state, twa * DEG, 0) }, env);
    if (env.t > 20 && bangs0 == null) bangs0 = st.gk.bangs;
    if (st.gk.gybing) { crossed = true; assert.ok(st.gk.fill < 0.6 || Math.abs(st.gk.side) > 0.5, 'collapsed while it crosses'); }
  }
  assert.ok(crossed, 'it crossed'); assert.equal(Math.sign(b.state.gk.side), Math.sign(-b.state.trueWind.angle) || 1, 'on the new leeward side');
  assert.ok(b.state.gk.fill > 0.9 && b.state.gk.bangs > bangs0, 'refilled with a bang');
});

test('too high in a strong gust with the sheet held: she broaches into the knockdown; without it she stands up', () => {
  const gust = (x, z, t) => ({ vx: 0, vz: (22 + 12 * (t > 30 && t < 38 ? 1 : t >= 38 && t < 40 ? (40 - t) / 2 : t > 28 && t <= 30 ? (t - 28) / 2 : 0)) * KN });
  const maxHeel = (gk, gkHand) => { let m = 0; sail({ tws: 22, twa: 110, secs: 45, gk, gkHand, wind: gust, sheet: 55 * DEG, params: { knockdown: true }, each: (st, t) => { if (t > 25) m = Math.max(m, Math.abs(st.heel)); } }); return m / DEG; };
  const up = maxHeel(true), down = maxHeel(false);
  assert.ok(up > 50, `with the gennaker: ${up.toFixed(1)}° (the knockdown watch fires at 55° held)`);
  const eased = maxHeel(true, 24 * DEG);
  assert.ok(eased < up - 15, `the hand's S eases its sheet first (W/S trim both sails): ${eased.toFixed(1)}°`);
  assert.ok(down < 25, `without: ${down.toFixed(1)}°`);
});

test('the crew on the sheets (New skill) eases it in a hard heel: the same gust only rounds her up', () => {
  const gust = (x, z, t) => ({ vx: 0, vz: (22 + 12 * (t > 30 && t < 38 ? 1 : 0)) * KN });
  let m = 0; sail({ tws: 22, twa: 130, secs: 45, gk: true, wind: gust, params: { knockdown: true }, each: (st, t) => { if (t > 25) m = Math.max(m, Math.abs(st.heel)); } });
  assert.ok(m / DEG < 40, `${(m / DEG).toFixed(1)}°`);
});

test('the drawing: nothing until hoisted; the clew on the leeward side, every point finite', () => {
  assert.equal(gkDesc({}), null); assert.equal(gkDesc({ gk: { deploy: 0 } }), null);
  for (const side of [-1, 1]) {
    const d = gkDesc({ gk: { deploy: 1, fill: 1, angle: side * 1.2, side, bang: 0 } });
    assert.ok(Math.sign(gkClew(d)[0]) === side, 'the clew to leeward');
    for (const u of [0, 0.4, 1]) for (const v of [0, 0.5, 1]) assert.ok(gennakerPoint(u, v, d, null).every(Number.isFinite));
    const mid = gennakerPoint(0.42, 0.4, d, null), chord = [gennakerPoint(0, 0.4, d, null), gennakerPoint(1, 0.4, d, null)];
    assert.ok(Math.sign(mid[0] - (chord[0][0] + chord[1][0]) / 2) === side, 'the camber bellies to leeward');
  }
});

test('the device policy: every device flies it; the full cloth on a desktop and a capture, the lite grid on a phone and at L2-L3', () => {
  const tier = (p, headless = false) => POLICIES.gennakerCloth.tier(p, { headless, flags: {} });
  assert.equal(tier({ form: 'desktop', gpu: 0 }), 'full');
  assert.equal(tier({ form: 'tablet', gpu: 1 }), 'full');
  assert.equal(tier({ form: 'desktop', gpu: 3 }), 'lite');
  assert.equal(tier({ form: 'phone', gpu: 0 }), 'lite');
  assert.equal(tier({ form: 'phone', gpu: 0 }, true), 'full', 'a capture');
});

// owner, 2026-11-21 (play on main): "W/S makes the main change" with the gennaker up. W/S trim both flying sails in every mode
test('W/S trim both flying sails: with a hand on the sheet the gennaker eases toward the curl (S) and over-trims toward the stall (W); the crew\'s trim as before', () => {
  // a hand on the sheet (c.sheet held at the main's best), and W/S's in/out on the gennaker's own sheet (c.gkHand, v2/sim/boat.js)
  const hand = (off) => {
    const b = new BoatPhysics({ heading: -125 * DEG, speed: 5 }), h = new Helm(), env = { windAt: steadyWind(12 * KN, 0), t: 0 };
    let st, best = null;
    for (let i = 0; i < 40 * 60; i++) {
      env.t = i * DT; if (i === 25 * 60) best = b.auto.main0;
      const o = best == null ? {} : { sheet: best, gkHand: off };
      st = b.step(DT, { ...CONTROLS, gennaker: true, rudder: h.toTWA(b.state, 125 * DEG, 0), ...o }, env);
    }
    return { err: st.gk.err, fill: st.gk.fill, drive: st.gk.drive };
  };
  const at = hand(0), eased = hand(22 * DEG), over = hand(-18 * DEG);
  assert.ok(Math.abs(at.err) < 3 * DEG, `held at the main's best: the gennaker at its best (${(at.err / DEG).toFixed(1)}°)`);
  assert.ok(eased.err > 18 * DEG && eased.fill < at.fill - 0.3, `S: eased ${(eased.err / DEG).toFixed(0)}°, the luff curls (fill ${eased.fill.toFixed(2)} vs ${at.fill.toFixed(2)})`);
  assert.ok(over.err < -14 * DEG && over.drive < at.drive * 0.9, `W: over-trimmed ${(over.err / DEG).toFixed(0)}°, stalled (drive ${over.drive.toFixed(0)} vs ${at.drive.toFixed(0)} N)`);
  // the crew on the sheets: W/S's sheetBias moves it one for one, as before
  let e0 = 0; sail({ tws: 12, twa: 125, secs: 30, gk: true, each: (st) => { e0 = st.gk?.err ?? 0; } });
  const b2 = new BoatPhysics({ heading: -125 * DEG, speed: 5 }), h2 = new Helm(), env2 = { windAt: steadyWind(12 * KN, 0), t: 0 }; let e5 = 0;
  for (let i = 0; i < 30 * 60; i++) { env2.t = i * DT; e5 = b2.step(DT, { ...CONTROLS, gennaker: true, sheetBias: 5 * DEG, rudder: h2.toTWA(b2.state, 125 * DEG, 0) }, env2).gk.err; }
  assert.ok(Math.abs(e5 - e0 - 5 * DEG) < 0.5 * DEG, `crew trim: W/S's bias one for one (${((e5 - e0) / DEG).toFixed(2)}°)`);
});
