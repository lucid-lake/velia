// The pilot's rules (v2/ui/autopilot.js, v2/sim/autoNav.js; owner, 2026-11-16) on v2's boat and v1's own lake and chart: AUTO holds
// the heading she has with no target; with a target she sails there (Cruise's navigator and skipper through B.drive); a hand on the
// helm lets AUTO go; TACK with AUTO holding: the pilot holds the new heading after the turn; the buttons' rings and TACK's word; the fold
// tab's place.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPilot, hudState, deg3, HUD_HIT, PILOT_SAY, padGeometry, inPad, inDrawn, padLayers, moonOutline, moonInset } from '../ui/autopilot.js';
import { createAutoNav } from '../sim/autoNav.js';
import { foldTabX, FOLD_TAB } from '../ui/foldTab.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { chooseStart, scenicRoute } from '../../src/sim/modes/chill/navigator.js';

const DEG = Math.PI / 180;
const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
function boatAt(chart, { headingDeg = null } = {}) {
  const s = chooseStart(chart, { seed: 1 });
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: W.wind, start: { x: s.x, z: s.z, headingDeg: headingDeg ?? s.headingDeg, speed: 2.5 } });
  return B;
}
const steps = (B, P, n, inp = null) => { for (let i = 0; i < n; i++) { B.step(1 / 60, inp, 1 / 60); P?.update(); } };

test('the pilot pad: AUTO lit while on; the key\'s word, lit and dim from the assist; a press with nothing to do does nothing, AUTO keeps its course', () => {
  assert.deepEqual(hudState({ mode: 'hold', assist: { word: 'TACK', lit: false, dim: false, cue: 0 } }), { auto: true, word: 'TACK', lit: false, dim: false, cue: 0 });
  assert.deepEqual(hudState({ mode: 'off', assist: { word: 'FREE', lit: true, dim: false, cue: 0.4 } }), { auto: false, word: 'FREE', lit: true, dim: false, cue: 0.4 });
  assert.equal(HUD_HIT, 44); assert.equal(deg3(251 * Math.PI / 180), '251°');
  let pressed = 0; const B = { assists: { pilot: true }, holdCourse: () => 1, holdHeading: 1, setPilot() {}, handInput: { steer: 0, helm: null } };
  const P = createPilot({ B, tack: { press: () => { pressed++; return false; }, offer: null, active: false } });
  P.auto(); assert.equal(P.tack(), false); assert.equal(pressed, 0); assert.equal(P.mode, 'hold');
});

test('the pilot pad\'s shapes: the round key the hero, AUTO a slim crescent hugging its right side (room for a left one), all inside the wheel\'s hub area; hits ≥ 44 px, none overlapping, none on the rim', () => {
  for (const R of [89.4, 134, 68.6]) {   // the rim's radius at 1280 × 720, 1920 × 1080, 1024 × 768
    const G = padGeometry(R), D = 2 * G.r;
    assert.ok(G.moon >= 0.35 * D - 0.5 && G.moon <= 0.4 * D + 0.5, `R ${R}: the crescent ${G.moon} px thick at its middle, 35–40 % of the key's ${D} px`);
    assert.ok(Math.abs(G.spanDeg - 130) <= 10 && G.gap <= 2, `R ${R}: a ${G.spanDeg}° arc, a ${G.gap} px hairline gap`);
    assert.ok(2 * G.hitK >= 44, `R ${R}: the key's hit ${2 * G.hitK} px across`);
    assert.ok(2 * G.hitO * Math.sin(G.half) >= 44, `R ${R}: the crescent's hit ${(2 * G.hitO * Math.sin(G.half)).toFixed(0)} px tall`);
    assert.ok(G.hitO < 0.6 * R && G.ri + G.moon < 0.5 * R, `R ${R}: drawn and hit inside the hub area (hit ${G.hitO.toFixed(0)}, drawn ${G.ri + G.moon} px of the rim's ${R})`);
    assert.equal(inPad(G, 0, 0), 'key'); assert.equal(inPad(G, G.ri + G.moon / 2, 0), 'right'); assert.equal(inPad(G, -(G.ri + G.moon / 2), 0), 'left', 'the left crescent\'s place is kept');
    assert.equal(inDrawn(G, G.ri + G.moon / 2, 0), 'right'); assert.equal(inDrawn(G, G.r + G.gap / 2, 0), null, 'the hairline gap is nobody\'s');
    assert.equal(inPad(G, 0, -(G.hitK + 3)), null, 'above the key, outside its hit, the wheel takes it');
  }
});

test('the on-rings trace their own keys: AUTO\'s follows the crescent\'s two arcs and end caps 1.25 px inside its cap\'s edge, never on the round key or the gap; the key\'s is a circle inside its cap', () => {
  for (const R of [89.4, 134, 68.6]) {
    const G = padGeometry(R), L = padLayers(G), ring = moonOutline(moonInset(G, L.mRing), 60), cap = moonOutline(moonInset(G, L.mCap), 60);
    const edge = (x, y) => Math.min(Math.abs(Math.hypot(x, y) - G.ri), Math.abs(G.ro - Math.hypot(x - G.dx, y)));   // distance to the crescent's outline
    let worst = 0, inside = true, nearKey = Infinity;
    for (const [x, y] of ring) { worst = Math.max(worst, Math.abs(edge(x, y) - L.mRing)); if (inDrawn(G, x, y) !== 'right') inside = false; nearKey = Math.min(nearKey, Math.hypot(x, y)); }
    assert.ok(inside, `R ${R}: every point of AUTO's ring is on the crescent`);
    assert.ok(worst < 0.05, `R ${R}: the ring keeps ${L.mRing.toFixed(2)} px from the crescent's arcs all round (worst off by ${worst.toFixed(3)} px)`);
    assert.ok(nearKey - L.ringW / 2 > G.ri, `R ${R}: its stroke stays off the gap and the key (${(nearKey - L.ringW / 2).toFixed(2)} > ${G.ri})`);
    assert.ok(Math.abs(L.mRing - L.mCap - 1.25) < 1e-9 && cap.every(([x, y]) => inDrawn(G, x, y) === 'right'), `R ${R}: 1.25 px inside the cap's edge`);
    // the outline runs the outer arc then the inner arc: its rightmost point is the outer arc's, its leftmost the tips'
    const xs = ring.map((p) => p[0]); assert.ok(Math.max(...xs) > G.dx && Math.min(...xs) >= moonInset(G, L.mRing).xt - 1e-6, `R ${R}: the right arcs, not the long way round`);
    assert.ok(L.keyRing + L.ringW / 2 < L.cap && L.keyRing > 0, `R ${R}: the key's ring inside its cap`);
  }
});

test('AUTO with no target holds the heading she has; a hand on the helm (a steering key) gives it back; AUTO again lets go', () => {
  const nav = createAutoNav({ B: null, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const B = boatAt(nav.chart);
  const P = createPilot({ B, target: () => null });
  steps(B, null, 120);
  const h0 = B.phys.state.heading;
  assert.equal(P.auto(), 'hold'); assert.ok(Math.abs(wrap(P.held - h0)) < 1e-9, 'it holds the heading she has now');
  steps(B, P, 60 * 20);
  assert.equal(P.mode, 'hold');
  assert.ok(Math.abs(wrap(B.phys.state.heading - h0)) < 6 * DEG, `20 s on: within 6° of the held course (${(wrap(B.phys.state.heading - h0) / DEG).toFixed(1)}°)`);
  steps(B, P, 30, { steer: 1, pull: 0 });
  assert.equal(P.mode, 'off', 'a steering key hands the helm back');
  assert.equal(P.auto(), 'hold'); assert.equal(P.auto(), 'off', 'AUTO again lets go');
});

test('AUTO with a target sails there through Cruise\'s navigator (B.drive), nearer each minute; the wheel lets it go and the hands are back', () => {
  const A0 = createAutoNav({ B: null, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const B = boatAt(A0.chart);
  const A = createAutoNav({ B, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const stop = scenicRoute(A.chart, { seed: 1 }).map((s) => ({ x: s.at[0], z: s.at[1] })).find((p) => { const d = Math.hypot(p.x - B.phys.state.x, p.z - B.phys.state.z); return d > 500 && d < 2500; });
  assert.ok(stop, 'a stop 0.5 to 2.5 km off');
  const tg = { ...stop, key: 'sail|t', name: 'Test Mark' };
  const P = createPilot({ B, target: () => tg, nav: () => A });
  P.load();   // the navigator now (in play it loads at the first AUTO with a target)
  return Promise.resolve().then(() => {
    P.update();
    assert.equal(P.auto(), 'to'); assert.ok(B.driven && A.on, 'Cruise\'s autopilot drives her');
    const d0 = P.distance();
    steps(B, P, 60 * 60);
    const d1 = P.distance();
    assert.equal(P.mode, 'to'); assert.ok(d1 < d0 - 60, `a minute on she is nearer (${d0.toFixed(0)} → ${d1.toFixed(0)} m)`);
    assert.equal(P.dest?.name, 'Test Mark');
    B.station({ helm: 0.3 }); P.update();
    assert.equal(P.mode, 'off', 'the wheel in the hand lets AUTO go'); assert.ok(!B.driven && !A.on, 'the hands are back');
  });
});

test('TACK with AUTO holding: the turn runs and the pilot holds her new heading after it', () => {
  const nav = createAutoNav({ B: null, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const B = boatAt(nav.chart);
  let active = false;
  const tack = { press: () => { active = true; return true; }, get active() { return active; }, offer: 'tack', kind: 'tack' };
  const P = createPilot({ B, target: () => null, tack });
  steps(B, null, 60);
  P.auto();
  assert.ok(P.tack(), 'TACK runs the assist');
  B.station({ ext: -1 }); steps(B, null, 30); B.station({ ext: null }); P.update();   // the assist's turn (its own steer, the hands clear the held heading)
  assert.equal(P.mode, 'hold', 'AUTO stays on through the turn');
  active = false; P.update();
  assert.equal(P.mode, 'hold'); assert.ok(Math.abs(wrap(P.held - B.phys.state.heading)) < 1e-9, 'it holds the heading she has after the turn');
});

test('AUTO takes a target up when it can: set after AUTO, the navigator still loading at the press, a new target live; off its chart: hold and say it once', async () => {
  const A0 = createAutoNav({ B: null, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const B = boatAt(A0.chart);
  const A = createAutoNav({ B, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const stops = scenicRoute(A.chart, { seed: 1 }).map((s) => ({ x: s.at[0], z: s.at[1] })).filter((p) => { const d = Math.hypot(p.x - B.phys.state.x, p.z - B.phys.state.z); return d > 400 && d < 3000; });
  assert.ok(stops.length >= 2, 'two stops to sail to');
  let tg = null, release = null; const lines = [];
  const navP = new Promise((r) => { release = () => r(A); });   // the navigator's load, still running
  const P = createPilot({ B, target: () => tg, nav: () => navP, say: (t) => lines.push(t) });
  assert.equal(P.auto(), 'hold', 'AUTO with no target: hold');
  tg = { ...stops[0], key: 'sail|a', name: 'A' };
  steps(B, P, 30);
  assert.equal(P.mode, 'hold', 'the navigator still loading: hold for now'); assert.deepEqual(lines, [PILOT_SAY.plotting], 'and say so, once');
  release(); await navP; await Promise.resolve();
  steps(B, P, 2);
  assert.equal(P.mode, 'to', 'the navigator in: she sails to the target set after AUTO'); assert.ok(B.driven);
  tg = { ...stops[1], key: 'sail|b', name: 'B' };
  steps(B, P, 2);
  assert.equal(P.mode, 'to'); assert.equal(P.dest?.name, 'B', 'a new target: re-targeted live');
  tg = { x: 1e5, z: 1e5, key: 'sail|off', name: 'Off' };
  steps(B, P, 5);
  assert.equal(P.mode, 'hold', 'off the navigator\'s chart: hold'); assert.ok(!B.driven);
  steps(B, P, 60);
  assert.equal(lines.filter((l) => /off my chart/i.test(l)).length, 1, `its line once (${JSON.stringify(lines)})`);
});

test('AUTO under engine (desktop and the phone\'s Auto: one pilot): it steers to the target with no tacks, the throttle the player\'s, and holds at the mark', () => {
  const A0 = createAutoNav({ B: null, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const B = boatAt(A0.chart);
  const A = createAutoNav({ B, lake: W.terrain, chartIn: { shoreline: W.shoreline, harbour: W.harbour } });
  const s0 = B.phys.state;
  // a mark dead upwind, 400 to 900 m off in clear water: under sail it would be a beat; motoring it is straight
  const from = s0.heading + s0.trueWind.angle;
  let tg = null;
  for (const d of [600, 450, 800]) for (const da of [0, 0.3, -0.3, 0.6, -0.6]) { if (tg) break; const x = s0.x + Math.sin(from + da) * d, z = s0.z - Math.cos(from + da) * d; if (A.chart.marginAt(x, z) > 30) tg = { x, z, key: 'm', name: 'Upwind' }; }
  assert.ok(tg, 'a mark upwind in clear water');
  B.phys.engine.start(); B.phys.engine.setLever(0.7);
  const P = createPilot({ B, target: () => tg, nav: () => A });
  P.load();
  return Promise.resolve().then(() => {
    P.update(); assert.equal(P.auto(), 'to'); assert.ok(A.motoring, 'motoring: the straight course, no beat');
    const d0 = P.distance();
    steps(B, P, 60 * 20);
    assert.ok(P.mode === 'to' && P.distance() < d0 - 40, `20 s on she is nearer under engine (${d0.toFixed(0)} → ${P.distance().toFixed(0)} m)`);
    assert.equal(A.tacks, 0, 'no tacks');
    assert.ok(B.phys.engine.lever > 0.6, 'the throttle stays where the player put it');
    B.phys.engine.setLever(0.4); steps(B, P, 10);
    assert.ok(Math.abs(B.phys.state.throttle - 0.4) < 0.05 || Math.abs((B.ctl.throttle ?? B.phys.engine.lever) - 0.4) < 0.05, 'a new lever is taken');
    B.phys.engine.setLever(0.9);
    for (let i = 0; i < 60 * 240 && P.mode === 'to'; i++) steps(B, P, 1);
    assert.equal(P.mode, 'hold', 'at the mark: AUTO holds');
    assert.ok(Math.hypot(B.phys.state.x - tg.x, B.phys.state.z - tg.z) < 140, `she got there (${Math.hypot(B.phys.state.x - tg.x, B.phys.state.z - tg.z).toFixed(0)} m)`);
    assert.ok(!B.driven, 'the hands are back');
  });
});

test('the fold tab: left of the chart instrument, never off the screen\'s edge or past the middle', () => {
  assert.equal(foldTabX({ chartLeft: 175, w: 1280 }), Math.round(175 - 0.75 * FOLD_TAB.w));
  assert.equal(foldTabX({ chartLeft: 20, w: 1280 }), FOLD_TAB.edge + FOLD_TAB.w / 2);
  assert.equal(foldTabX({ chartLeft: 2000, w: 1280 }), 640 - FOLD_TAB.w);
  assert.ok(FOLD_TAB.w >= 44 && FOLD_TAB.h >= 44);
});

test('the right fold tab mirrors the left: right of the wind instrument, never off the edge or past the middle (owner 2026-11-18)', () => {
  assert.equal(foldTabX({ windRight: 1280 - 175, w: 1280, side: 'r' }), 1280 - foldTabX({ chartLeft: 175, w: 1280 }));
  assert.equal(foldTabX({ windRight: 1260, w: 1280, side: 'r' }), 1280 - FOLD_TAB.edge - FOLD_TAB.w / 2);
  assert.equal(foldTabX({ windRight: -500, w: 1280, side: 'r' }), 640 + FOLD_TAB.w);
});

//, 2026-11-17: the plan chart on first use; every device): a target alone loads nothing; the first AUTO does
test('the navigator (its whole-lake chart) loads at the first AUTO with a target, never because a target showed', async () => {
  const B = { holdCourse: () => 0, holdHeading: null, assists: { pilot: false }, setPilot() {}, handInput: {} };
  let asked = 0;
  const P = createPilot({ B, target: () => ({ x: 100, z: 100, key: 't' }), nav: () => { asked++; return null; }, say: () => {} });
  for (let i = 0; i < 120; i++) P.update();
  assert.equal(asked, 0, 'a target in force, AUTO off: no load');
  P.auto();
  assert.equal(asked, 1, 'the first AUTO: the navigator asked for');
});
