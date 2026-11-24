// Pro mode's sail controls (src/boat.js PRO): each control's effect points the way the trim guides say,
// the pro defaults are basic's exactly, and the sail's cloth shows it (src/boat/rig.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, Helm, steadyState, steadyWind, KN, DT } from '../src/sim/boat.js';
import { sailParams, mainPoint, jibPoint, bandFill } from '../src/boat/rig.js';
import { sailMix } from '../src/boatAudio.js';

const DEG = Math.PI / 180;
const SHEET = 14 * DEG;   // a close-hauled main held by the player (the mean chord, src/boat.js)
const beat = (kn, controls, o = {}) => steadyState({ twsKn: kn, twaDeg: 42, controls: { autoReef: false, ...controls }, ...o });

test('pro defaults equal basic: the neutral values (and the backstay where the crew had it) give the same boat bit for bit', () => {
  const run = (kn, extra) => {
    const b = new BoatPhysics({ heading: -42 * DEG, speed: 2 }), h = new Helm(), env = { windAt: steadyWind(kn * KN, 0), t: 0 };
    for (let i = 0; i < 60 * 60; i++) { env.t = i * DT; b.step(DT, { ...CONTROLS, ...extra, rudder: h.toTWA(b.state, 42 * DEG, 0) }, env); }
    return b.state;
  };
  const keys = ['x', 'z', 'heading', 'u', 'heel', 'boomAngle', 'jibAngle', 'drive', 'mainFill', 'jibFill', 'mainDraft'];
  // the traveller, twist and lead at their marks, the backstay left to the crew (pro mode before the first tick)
  for (const kn of [8, 15, 22]) {
    const a = run(kn, {}), p = run(kn, { traveller: 0, twist: 0, jibLead: 0 });
    for (const k of keys) assert.equal(p[k], a[k], `${kn} kn: ${k}`);
  }
  // in light air the crew never flattens: the player's backstay at 0 is the crew's
  const a = run(8, {}), p = run(8, { traveller: 0, twist: 0, jibLead: 0, backstay: 0 });
  assert.equal(a.flatten, 0);
  for (const k of keys) assert.equal(p[k], a[k], `8 kn, backstay 0: ${k}`);
});

test('traveller: down reduces the heel at the same sheet; up brings the boom toward the centreline', () => {
  const mid = beat(12, { sheet: SHEET }), down = beat(12, { sheet: SHEET, traveller: -1 }), up = beat(12, { sheet: SHEET, traveller: 1 });
  console.log(`12 kn, sheet 14°: heel ${mid.heelDeg.toFixed(1)}° mid, ${down.heelDeg.toFixed(1)}° down, ${up.heelDeg.toFixed(1)}° up; boom ${(mid.state.boomAngle / DEG).toFixed(1)} / ${(down.state.boomAngle / DEG).toFixed(1)} / ${(up.state.boomAngle / DEG).toFixed(1)}°`);
  assert.ok(down.heelDeg < mid.heelDeg - 2, 'the traveller down depowers');
  assert.ok(Math.abs(down.state.boomAngle) > Math.abs(mid.state.boomAngle) + 5 * DEG, 'the boom goes out');
  assert.ok(Math.abs(up.state.boomAngle) < Math.abs(mid.state.boomAngle) - 3 * DEG, 'the boom comes in');
  assert.equal(down.state.mainSheet, mid.state.mainSheet, 'the sheet itself is unchanged');
  // eased to a reach the traveller does little (the sheet pulls the boom out, not down)
  const r0 = steadyState({ twsKn: 12, twaDeg: 100, controls: { sheet: 50 * DEG } }), r1 = steadyState({ twsKn: 12, twaDeg: 100, controls: { sheet: 50 * DEG, traveller: -1 } });
  assert.ok(Math.abs(r1.state.boomAngle - r0.state.boomAngle) < 0.5 * DEG, 'no traveller effect on a reach');
});

test('twist: opens the head (lower angle of attack up top), cuts the heel in a gust; less twist powers the top', () => {
  const gust = (twist) => {
    // settle at 12 kn, then a 20 kn gust for 4 s; the sheet held (the player's), the helm on the wind angle
    const b = new BoatPhysics({ heading: -42 * DEG, speed: 2.5 }), h = new Helm(), c = { ...CONTROLS, autoReef: false, sheet: SHEET, twist };
    let tws = 12 * KN, peak = 0;
    const env = { windAt: (x, z, t) => ({ vx: 0, vz: tws }), t: 0 };
    for (let i = 0; i < 64 * 60; i++) {
      env.t = i * DT; tws = i < 60 * 60 ? 12 * KN : 20 * KN;
      b.step(DT, { ...c, rudder: h.toTWA(b.state, 42 * DEG, 0) }, env);
      if (i >= 60 * 60) peak = Math.max(peak, Math.abs(b.state.heel));
    }
    return { peak: peak / DEG, st: b.state };
  };
  const g0 = gust(0), g1 = gust(1), gm = gust(-1);
  console.log(`gust 12 → 20 kn: peak heel ${gm.peak.toFixed(1)}° (twist −1), ${g0.peak.toFixed(1)}° (0), ${g1.peak.toFixed(1)}° (+1)`);
  assert.ok(g1.peak < g0.peak - 0.5 && g0.peak < gm.peak + 0.2, 'more twist, less heel in the gust');
  const s1 = beat(12, { sheet: SHEET, twist: 1 }).state, s0 = beat(12, { sheet: SHEET, twist: 0 }).state;
  assert.ok(s1.mainTopAoA < s1.mainLowAoA - 2 * DEG, 'the head opens more than the foot');
  assert.ok(s1.mainTopAoA < s0.mainTopAoA, 'the head sees less angle of attack');
  assert.ok(Math.abs(s1.mainTwistX - 6) < 1e-9, 'twist +1 is 6° past neutral');
  // over-twisted the head luffs first: the top band's fill drops before the low band's
  const over = beat(10, { sheet: 22 * DEG, twist: 1 }).state;
  assert.ok(over.mainTopFill < over.mainLowFill - 0.1, `the head luffs first: top ${over.mainTopFill.toFixed(2)}, low ${over.mainLowFill.toFixed(2)}`);
  // the sound: a head luffing on its own flutters thinner and faster than a whole sail luffing
  const headOnly = sailMix({ ...over, mainFill: 0.6 * 1 + 0.4 * 0.3, mainLowFill: 1, mainTopFill: 0.3, jibFill: 1, jibTopFill: 1, apparentWind: { speed: 6, angle: 0.8 } });
  const whole = sailMix({ ...over, mainFill: 0.72, mainLowFill: 0.72, mainTopFill: 0.72, jibFill: 1, jibTopFill: 1, apparentWind: { speed: 6, angle: 0.8 } });
  assert.ok(headOnly.head > 0.9 && whole.head < 0.05 && headOnly.flutterHz > whole.flutterHz + 300, `head ${headOnly.head.toFixed(2)} vs ${whole.head.toFixed(2)}`);
});

test('backstay: flattens and costs drive in light air; helps in a breeze (VMG)', () => {
  const l0 = beat(6, { backstay: 0 }), l1 = beat(6, { backstay: 1 });
  const h0 = beat(24, { backstay: 0 }), h1 = beat(24, { backstay: 1 });
  console.log(`6 kn: VMG ${l0.vmgKn.toFixed(2)} → ${l1.vmgKn.toFixed(2)} kn with the backstay; 24 kn: ${h0.vmgKn.toFixed(2)} → ${h1.vmgKn.toFixed(2)} kn, heel ${h0.heelDeg.toFixed(1)}° → ${h1.heelDeg.toFixed(1)}°`);
  assert.ok(l1.state.mainDraft < l0.state.mainDraft && l1.state.jibDraft < l0.state.jibDraft, 'both sails flatter (the forestay too)');
  assert.ok(l1.state.drive < 0.85 * l0.state.drive && l1.vmgKn < l0.vmgKn, 'light air: less drive, slower');
  assert.ok(h1.vmgKn > h0.vmgKn && h1.heelDeg < h0.heelDeg, 'heavy air: flatter is faster and more upright');
  assert.ok(l1.state.mainTwistX > 1.9, 'the mast bend opens the leech');
});

test('jib lead: aft opens the jib’s head (top luffs first), forward closes it (bottom luffs first); forward is power in light air, aft depowers in a breeze', () => {
  const aft = beat(12, { sheet: SHEET, jibLead: 1 }).state, fwd = beat(12, { sheet: SHEET, jibLead: -1 }).state;
  assert.ok(aft.jibTopAoA < aft.jibLowAoA, 'aft: the head at a lower angle than the foot');
  assert.ok(fwd.jibTopAoA > fwd.jibLowAoA, 'forward: the head at a higher angle than the foot');
  const lf = beat(8, { jibLead: -1 }), la = beat(8, { jibLead: 1 }), hf = beat(22, { jibLead: -1 }), ha = beat(22, { jibLead: 1 });
  console.log(`jib lead fwd / aft: 8 kn VMG ${lf.vmgKn.toFixed(2)} / ${la.vmgKn.toFixed(2)}; 22 kn ${hf.vmgKn.toFixed(2)} / ${ha.vmgKn.toFixed(2)}, heel ${hf.heelDeg.toFixed(1)}° / ${ha.heelDeg.toFixed(1)}°`);
  assert.ok(lf.vmgKn > 1.05 * la.vmgKn, 'light air: forward (a fuller foot) is faster');
  assert.ok(ha.heelDeg < hf.heelDeg - 0.5 && ha.state.drive < hf.state.drive, 'a breeze: aft depowers (less heel)');
});

test('the cloth shows it: the twist opens the head, the backstay flattens, the lead moves the jib’s head, the bands luff by height', () => {
  const st = (c) => beat(12, { sheet: SHEET, ...c }).state;
  const head = (s) => { const p = sailParams(s).main, a = mainPoint(1, 0.95, p, null), f = mainPoint(1, 0.05, p, null); return Math.atan2(a[0], a[2] - 0) - Math.atan2(f[0], f[2]); };
  const s0 = st({}), s1 = st({ twist: 1 }), sm = st({ twist: -1 });
  assert.ok(Math.abs(head(s1)) > Math.abs(head(s0)) + 4 * DEG && Math.abs(head(sm)) < Math.abs(head(s0)) - 4 * DEG, 'the leech opens and closes');
  const depth = (s) => { const p = sailParams(s).main, a = mainPoint(0.42, 0.5, p, null), l = mainPoint(0, 0.5, p, null), e = mainPoint(1, 0.5, p, null);
    const cx = e[0] - l[0], cz = e[2] - l[2], c = Math.hypot(cx, cz); return Math.abs((a[0] - l[0]) * cz - (a[2] - l[2]) * cx) / c / c; };
  assert.ok(depth(st({ backstay: 1 })) < 0.8 * depth(st({ backstay: 0 })), 'the backstay flattens the main');
  const jh = (s) => { const p = sailParams(s).jib, a = jibPoint(1, 0.95, p, null); return Math.atan2(Math.abs(a[0]), 1); };
  assert.ok(jh(st({ jibLead: 1 })) > jh(st({ jibLead: -1 })), 'the lead aft lets the jib’s head fall off');
  const over = beat(10, { sheet: 22 * DEG, twist: 1 }).state, p = sailParams(over).main;
  assert.ok(bandFill(p, 0.95) < bandFill(p, 0.1) - 0.1, 'the cloth luffs at the head first');
  // a basic state: the same descriptor as before pro (no band fields), so the mesh cache holds
  assert.deepEqual(Object.keys(sailParams(beat(12, {}).state).main).sort(), ['boomRad', 'draft', 'fill', 'reef']);
});
