// A phone's flat controls (option C and its art pass, owner 2026-11-16; v2/ui/flat.js), the pure parts: the layout at
// 844 × 390 and 844 × 340 (an iPhone's safe area and none; Sail, Sail with Sheets Split, Regatta, Cruise) puts every control inside the
// safe area, at 44 px or more, and no two share a pixel; the corner quarters are ≥ 60 px with the rings concentric round them, 8 px
// away; "⋯" is its own button, 24 px or more from either ring; the steer needle and helm; the sheet ring's angle ↔ sheet; the
// throttle ring's angle ↔ lever with N a detent; Auto: B.holdCourse holds the heading she has, and a steer hands the helm back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flatLayout, flatShapes, overlaps, inShape, shapeBox, arcHelm, knobDeg, sheetDeg, sheetAt, leverDeg, leverFromDeg, leverSnap, arcAngle, arcPt, smootherstep, inZone, zonePick, zoneBox, FLAT } from '../ui/flat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { HELM_IN } from '../../src/stations/sloop/helmInput.js';
import { NOTCHES } from '../../src/stations/sloop/throttleLever.js';

const DEG = Math.PI / 180;
const IPHONE = { l: 47, r: 47, b: 21 };
const CASES = [];
for (const h of [430, 390, 360, 340, 320]) for (const inset of [IPHONE, {}]) for (const [mode, split] of [['sail', false], ['sail', true], ['race', false], ['race', true], ['cruise', false]]) CASES.push({ w: 844, h, inset, mode, split });
const name = (c) => `${c.w}×${c.h} ${c.inset.l ? 'iPhone safe area' : 'no safe area'} ${c.mode}${c.split ? ' split' : ''}`;

test('the layout: every control inside the safe area, none sharing a pixel with another', () => {
  for (const c of CASES) {
    const L = flatLayout({ ...c, capTop: 62 }), S = L.shapes;
    const sl = Math.max(c.inset.l ?? 0, FLAT.edge), sr = Math.max(c.inset.r ?? 0, FLAT.edge), sb = Math.max(c.inset.b ?? 0, FLAT.foot);
    for (const [k, s] of Object.entries(S)) {
      const b = shapeBox(s);
      assert.ok(b.x >= sl - 0.01 && b.x + b.w <= c.w - sr + 0.01 && b.y >= 62 - 2 && b.y + b.h <= c.h - sb + 0.01, `${name(c)}: ${k} inside the safe area and under the bar (${JSON.stringify(b)})`);
    }
    assert.deepEqual(overlaps(S, 1), [], `${name(c)}: no overlaps`);
  }
});

test('every target is 44 px or more; the quarters ≥ 60 px, the rings concentric round them 8 px away; "⋯" 24 px or more from either ring', () => {
  for (const c of CASES) {
    const L = flatLayout({ ...c, capTop: 62 }), S = L.shapes;
    for (const [k, s] of Object.entries(S)) {
      if (s.kind === 'rect' && !['readout', 'coach'].includes(k)) assert.ok(s.h >= 44 && s.w >= 44, `${name(c)}: ${k} ${s.w} × ${s.h}`);
      if (s.kind === 'circle' && !k.startsWith('dial')) assert.ok(2 * s.r >= 44, `${name(c)}: ${k} ⌀ ${2 * s.r}`);
      if (s.kind === 'quarter') assert.ok(s.r >= 60, `${name(c)}: ${k} r ${s.r}`);
      if (s.kind === 'band') assert.ok(s.r1 - s.r0 >= 44 && (s.a1 - s.a0) * DEG * (s.r0 + s.r1) / 2 >= 88, `${name(c)}: ${k} ${s.r1 - s.r0} px wide, long enough for two ends`);
    }
    if (c.mode === 'cruise') continue;
    assert.equal(S.steer.r0, S.auto.r + L.g, `${name(c)}: the steer ring ${L.g} px round Auto`);
    assert.equal((S.jib ?? S.sheet).r0, S.tack.r + L.g, `${name(c)}: the inner right ring 8 px round Tack`);
    if (S.jib) assert.equal(S.sheet.r0, S.jib.r1 + L.g, `${name(c)}: Split: the main's ring 8 px round the jib's`);
    // "⋯": the least distance from its edge to either right ring, by sampling the rings' area
    let least = Infinity;
    for (const k of ['sheet', 'jib']) { const s = S[k]; if (!s) continue; for (let a = s.a0; a <= s.a1; a += 0.5) for (let r = s.r0; r <= s.r1; r += 2) { const p = arcPt(s.p, a, r); least = Math.min(least, Math.hypot(p.x - S.more.cx, p.y - S.more.cy) - S.more.r); } }
    assert.ok(least >= FLAT.moreClear, `${name(c)}: "⋯" ${least.toFixed(1)} px from the nearest ring (≥ ${FLAT.moreClear})`);
    // Recentre (round, 44 px, like "⋯"): 24 px past the left thumb zone, and 44 px or more across
    let rl = Infinity; const rs = S.recentre;
    for (let a = S.steer.a0; a <= S.steer.a1; a += 0.5) for (let r = S.steer.r0; r <= S.steer.r1; r += 2) { const p = arcPt(S.steer.p, a, r); rl = Math.min(rl, Math.hypot(p.x - rs.cx, p.y - rs.cy) - rs.r); }
    assert.ok(rs.kind === 'circle' && rs.r === 22 && rl >= FLAT.guard + FLAT.moreClear - 0.01, `${name(c)}: Recentre ${rl.toFixed(1)} px from the steer ring (≥ ${FLAT.guard + FLAT.moreClear}: the thumb zone plus ${FLAT.moreClear})`);
  }
});

test('the thumb zones (owner, 2026-11-17): FLAT.guard past each outer ring and the corner to the screen edges are the controls\', a near miss goes to the nearest ring or quarter, and no zone reaches another control', () => {
  for (const c of CASES) {
    if (c.mode === 'cruise') continue;
    const L = flatLayout({ ...c, capTop: 62 }), S = L.shapes, Z = L.zones;
    // every sampled point of each zone: never on a dial, "⋯", the chip, the picker, the helper, Recentre or the other zone (the readout
    // and the coach's line are words, not targets: a zone may run under their ends)
    for (const side of ['l', 'r']) {
      const z = Z[side], b = zoneBox(z, c.w, c.h);
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= c.w + 0.01 && b.y + b.h <= c.h + 0.01, `${name(c)}: zone ${side} inside the screen`);
      for (let y = b.y + 1; y < b.y + b.h; y += 3) for (let x = b.x + 1; x < b.x + b.w; x += 3) {
        if (!inZone(z, x, y)) continue;
        for (const k of ['more', 'dial-chart', 'dial-wind', 'chip', 'pick', 'helper', 'recentre']) if (S[k]) assert.ok(!inShape(S[k], x, y), `${name(c)}: zone ${side} reaches ${k} at ${x},${y}`);
        assert.ok(!inZone(Z[side === 'l' ? 'r' : 'l'], x, y), `${name(c)}: the zones share ${x},${y}`);
      }
    }
    assert.ok(Z.l.r >= L.steer.r1 + FLAT.guard - 0.01, `${name(c)}: the left zone ${FLAT.guard} px past the steer ring`);
    assert.ok(Z.r.r >= L.main.r1 + (c.h >= 340 ? FLAT.guard - 0.01 : 12), `${name(c)}: the right zone ${(Z.r.r - L.main.r1).toFixed(1)} px past the sheet ring (${FLAT.guard} from 340 px tall)`);
    // a press 1 to 28 px outside the steer ring's outer edge steers; between the quarter and the ring goes to the nearer; under the notch
    for (const a of [0, 20, 45, 70, 90]) for (const out of [1, 14, 28]) {
      const q = arcPt(L.pl, a, L.steer.r1 + out), k = zonePick(L, 'l', q.x, q.y);
      assert.equal(k?.ring, 'steer', `${name(c)}: ${out} px past the steer ring at ${a}°`);
      assert.ok(Math.abs(k.a - a) < 0.01, `${name(c)}: the angle ${a}° kept (${k.a})`);
      const r = arcPt(L.pr, a, L.main.r1 + Math.min(out, Z.r.r - L.main.r1 - 0.5)), m = zonePick(L, 'r', r.x, r.y);
      assert.equal(m?.ring, 'main', `${name(c)}: past the sheet ring at ${a}°`);
      assert.ok(m.a >= L.main.a0 && m.a <= L.main.a1, `${name(c)}: snapped onto the sheet ring (${m.a})`);
    }
    const gapIn = arcPt(L.pl, 45, L.q + L.g * 0.25), gapOut = arcPt(L.pl, 45, L.q + L.g * 0.75);
    assert.equal(zonePick(L, 'l', gapIn.x, gapIn.y)?.kind, 'quarter', `${name(c)}: the gap's inner half is Auto's`);
    assert.equal(zonePick(L, 'l', gapOut.x, gapOut.y)?.ring, 'steer', `${name(c)}: the gap's outer half is the ring's`);
    assert.equal(zonePick(L, 'l', 2, L.pl.y - L.steer.r)?.ring, 'steer', `${name(c)}: the strip between the screen edge and the ring is the ring's`);
    assert.equal(zonePick(L, 'r', c.w - 2, c.h - 2)?.kind, 'quarter', `${name(c)}: the very corner is the quarter's`);
    if (L.jib) {
      const j = arcPt(L.pr, 30, L.jib.r1 + 1), mm = arcPt(L.pr, 30, L.main.r0 - 1);
      assert.equal(zonePick(L, 'r', j.x, j.y)?.ring, 'jib', `${name(c)}: Split: the gap's inner half is the jib's`);
      assert.equal(zonePick(L, 'r', mm.x, mm.y)?.ring, 'main', `${name(c)}: Split: the outer half the main's`);
      assert.equal(zonePick(L, 'r', j.x, j.y, { motor: true })?.ring, 'main', `${name(c)}: under motor the throttle ring takes it`);
      const hi = arcPt(L.pr, 80, L.main.r);
      assert.equal(zonePick(L, 'r', hi.x, hi.y)?.a, L.main.a1, `${name(c)}: Split: above the ring's end snaps to its end`);
    }
    // the open water stays the camera's
    const far = arcPt(L.pl, 45, Z.l.r + 2), mid = { x: c.w / 2, y: c.h - 30 };
    assert.equal(zonePick(L, 'l', far.x, far.y), null, `${name(c)}: past the zone is the water`);
    assert.equal(zonePick(L, 'l', mid.x, mid.y) ?? zonePick(L, 'r', mid.x, mid.y), null, `${name(c)}: the foot's middle is the water`);
  }
});

test('Regatta: the race chip, the coach line, the picker and the readout have their own slots; Cruise has the hand-over alone', () => {
  const L = flatLayout({ w: 844, h: 340, inset: IPHONE, mode: 'race', capTop: 62 });
  for (const k of ['chip', 'coach', 'pick', 'readout', 'helper', 'recentre', 'more']) assert.ok(L.shapes[k], k);
  assert.ok(!flatLayout({ w: 844, h: 390, inset: IPHONE, mode: 'sail', capTop: 62 }).shapes.readout, 'Sail: no speed and heading readout (the chart dial has both)');
  assert.ok(L.coach.y > L.h / 2, 'the coach along the foot');
  assert.ok(L.chip.y + L.chip.h <= L.pick.y, 'the picker under the chip');
  assert.deepEqual(Object.keys(flatShapes({ ...L, mode: 'cruise' })), ['take'], 'Cruise: the hand-over alone');
});

test('the steer ring: a sweep of FLAT.steerDeg is full helm from amidships, clockwise to starboard; the needle shows the rudder', () => {
  assert.equal(arcHelm(0, 45, 45), 0);
  assert.equal(arcHelm(0, 45, 45 - FLAT.steerDeg), 1);
  assert.equal(arcHelm(0, 45, 45 + FLAT.steerDeg), -1);
  assert.equal(arcHelm(0.5, 45, 20), 1, 'clamped');
  assert.equal(knobDeg(0), 45); assert.equal(knobDeg(HELM_IN.rudderMax), 45 - FLAT.steerDeg); assert.equal(knobDeg(-HELM_IN.rudderMax), 45 + FLAT.steerDeg);
  const p = { x: 47, y: 369, side: 1 }, q = arcPt(p, 30, 100);
  assert.ok(Math.abs(arcAngle(p, q.x, q.y) - 30) < 1e-9, 'the angle round the corner');
  const pr = { x: 797, y: 369, side: -1 }, r = arcPt(pr, 60, 100);
  assert.ok(Math.abs(arcAngle(pr, r.x, r.y) - 60) < 1e-9 && r.x < pr.x, 'the right corner mirrors');
});

test('the sheet ring: the top end sheeted in, the bottom eased out, and back; the throttle ring: Ahead up, Astern down, N a detent', () => {
  assert.equal(sheetDeg(FLAT.sheet[0], 90), 90); assert.equal(sheetDeg(FLAT.sheet[1], 90), 0);
  assert.ok(Math.abs(sheetAt(sheetDeg(40 * DEG, 90), 90) - 40 * DEG) < 1e-9, 'a sheet and its angle round-trip');
  assert.equal(leverDeg(0, 90), 45); assert.equal(leverDeg(1, 90), 90); assert.equal(leverDeg(-1, 90), 0);
  assert.equal(leverFromDeg(46, 90), 0, 'N holds within the detent');
  assert.ok(leverFromDeg(80, 90) > 0.7 && leverFromDeg(10, 90) < -0.7);
  for (const n of NOTCHES) assert.equal(leverSnap(n.v + 0.02), n.v, `${n.id} snaps to itself`);
  assert.equal(smootherstep(0), 0); assert.equal(smootherstep(1), 1); assert.equal(smootherstep(0.5), 0.5);
});

test('Auto: B.holdCourse holds the heading she has now; a helm in the hand hands it back, and with the pilot off the helm eases amidships', () => {
  const steady = (ms, fromDeg) => ({ sample: (x, z, t) => { const v = steadyWind(ms, fromDeg)(x, z, t); return { vx: v.vx, vz: v.vz }; } });
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind: steady(6, 200) });
  B.settle(10);
  for (let i = 0; i < 120; i++) { B.station({ helm: 0.6 }); B.step(1 / 60, { steer: 0, pull: 0 }); }
  B.setPilot(false); B.station({ helm: null });
  const h0 = B.state.heading;
  B.holdCourse();
  assert.ok(Math.abs(B.holding - h0) < 1e-9 && B.assists.pilot, 'the pilot on, on this heading');
  for (let i = 0; i < 600; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  const off = Math.abs(Math.atan2(Math.sin(B.state.heading - h0), Math.cos(B.state.heading - h0))) / DEG;
  assert.ok(off < 4, `10 s on Auto: ${off.toFixed(2)}° off the held heading`);
  B.station({ helm: 0.4 }); B.step(1 / 60, { steer: 0, pull: 0 }); B.setPilot(false); B.station({ helm: null });
  assert.equal(B.holding, null, 'the steer handed it back');
  for (let i = 0; i < 240; i++) B.step(1 / 60, { steer: 0, pull: 0 });
  assert.ok(Math.abs(B.ctl.rudder) < 0.05, `the helm eased amidships (${B.ctl.rudder.toFixed(3)})`);
});
