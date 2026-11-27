// The player's sloop crewed (v2/render/boat/crew.js): the helmsman's hands stay on the turning wheel (a hand
// that has followed it far lets go and grips again, one at a time); the crew sits on the windward side and, after a tack (the
// boom across), sits on the new windward side, crossing under the boom with stepped feet; nobody passes through the boom, the
// wheel, the coaming, the hull or the other; in a knockdown both hold on; the Helm view hides them; the same inputs give the
// same pose. Joints are read from the kayakers' own figure posed by render/figureRig.js (the bones the skin draws).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseKayakAsset } from '../render/kayak/asset.js';
import { createClips } from '../sim/kayak-clip.js';
import { createFigureRig } from '../render/figureRig.js';
import { createBoatCrew, crewShown, HALCYON, CREW, boomAxis, rimPoint, worldUpInHull } from '../render/boat/crew.js';
import { CREW_LOOKS } from '../render/boatCrew.js';
import { GOOSENECK_PIN, RIG } from '../../src/boat/rig.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';
import INFO from '../../models/boat/cockpit.json' with { type: 'json' };

const asset = await parseKayakAsset(readFileSync(new URL('../assets/kayak/kayak.kyb.gz', import.meta.url)));
const clips = createClips(asset), rig = createFigureRig(asset.json, clips), J = asset.json;
const bi = (n) => J.bones.indexOf(n);
const at = (pal, s, p) => { const o = s * 12; return [0, 1, 2].map((r) => pal[o + r * 4] * p[0] + pal[o + r * 4 + 1] * p[1] + pal[o + r * 4 + 2] * p[2] + pal[o + r * 4 + 3]); };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const DEG = Math.PI / 180;
const SEX = { helm: CREW_LOOKS.helm.o.sex, crew: CREW_LOOKS.crew.o.sex };
const pal = { helm: new Float32Array(J.slots * 12), crew: new Float32Array(J.slots * 12) };
// every bone's joint (the paddle's slots excluded), named
const BONES = J.bones.map((n, i) => [n, i]).filter(([n, i]) => i < J.paddleSlot && n !== 'root');   // root: the rig's ground point, not a body part
function joints(C, who) {
  const sex = SEX[who], sc = rig.scale(sex), Jt = J.figures[sex].joints;
  rig.pose(sex, C.targets(who, sc), pal[who]);
  return BONES.map(([n, i]) => [n, at(pal[who], i, Jt[i])]);
}
// the distance from p to the segment a-b
function segDist(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2)));
  return dist(p, [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t]);
}
// the distance from p to the wheel's rim (a circle in the x-y plane at the axle's z)
function rimDist(p) {
  const W = HALCYON.wheel.at, dx = p[0] - W[0], dy = p[1] - W[1], rr = Math.hypot(dx, dy) || 1e-9;
  const q = [W[0] + dx / rr * HALCYON.wheel.r, W[1] + dy / rr * HALCYON.wheel.r, W[2]];
  return dist(p, q);
}
// a tack (port to starboard tack or back): the boom swings across over swingS, the heel rolls through with it, the helm put over
function tackRun({ fromBoom = 0.42, heelDeg = 14, t0 = 1, swingS = 1.6, total = 9, dt = 1 / 60, rudder = 0.3, each = null } = {}) {
  const C = createBoatCrew();
  for (let t = 0; t <= total; t += dt) {
    const k = Math.min(1, Math.max(0, (t - t0) / swingS)), sweep = Math.cos(Math.PI * k);
    const boom = fromBoom * sweep, heel = Math.sign(fromBoom) * heelDeg * DEG * sweep;
    C.step(dt, { heel, pitch: 0, boom, rudder: t > t0 - 0.5 && t < t0 + swingS ? rudder : 0 });
    each?.(C, { t, boom, heel });
  }
  return C;
}

test('the deck numbers match the boat they stand on (the wheel, the gooseneck, the boom)', () => {
  assert.deepEqual(HALCYON.wheel.at, INFO.wheel_axle_hull_frame);
  assert.ok(Math.abs(HALCYON.wheel.r * 2 - INFO.wheel_diameter_m) < 0.05, 'the rim');
  const H = DEFAULT_DIMS.HULL;
  assert.ok(Math.abs(HALCYON.boom.pin[1] - (GOOSENECK_PIN[1] + H.mastStepY)) < 1e-3 && Math.abs(HALCYON.boom.pin[2] - (GOOSENECK_PIN[2] + H.mastStepZ)) < 1e-3, 'the gooseneck');
  assert.ok(Math.abs(HALCYON.boom.len - RIG.boom) < 1e-3, 'the boom');
});

test('after a tack the crew sits on the new windward side; after the tack back, on the first', () => {
  for (const fromBoom of [0.42, -0.42]) {
    const C = tackRun({ fromBoom });
    assert.equal(C.state.side, Math.sign(fromBoom), `boom from ${fromBoom}: the crew on the new windward side (away from the boom)`);
    assert.equal(C.state.cross, -1, 'the cross done');
  }
  // before the tack the crew is to windward (the boom's other side)
  const C0 = createBoatCrew(); C0.step(1 / 60, { heel: 0.2, pitch: 0, boom: 0.4, rudder: 0 });
  assert.equal(C0.state.side, -1);
  // a gybe the same way (the boom across from one quarter to the other, fast)
  const G = tackRun({ fromBoom: 1.2, swingS: 0.5, heelDeg: 6 });
  assert.equal(G.state.side, 1, 'after a gybe');
});

test('no clipping through a tack: the boom, the wheel, the coaming, the hull and each other', () => {
  let minBoom = Infinity, minWheel = Infinity, minEach = Infinity, minHelmBody = Infinity, crossFrames = 0, duckMax = 0;
  const run = (fromBoom, heelDeg) => tackRun({ fromBoom, heelDeg, each: (C, { boom }) => {
    const H = joints(C, 'helm'), K = joints(C, 'crew'), st = C.state;
    if (st.cross >= 0) crossFrames++;
    duckMax = Math.max(duckMax, st.duck);
    const b0 = boomAxis(boom, 0.3), b1 = boomAxis(boom, HALCYON.boom.len);
    for (const [n, p] of [...H, ...K]) {
      // the boom: its axis at least its own half-depth and a head's radius off every joint
      const d = segDist(p, b0, b1); minBoom = Math.min(minBoom, d);
      // no joint inside the coaming's wall (inboard of its top), below the sole, or outboard of the hull under the side deck
      const ax = Math.abs(p[0]);
      assert.ok(!(ax > HALCYON.coamingX[0] && ax < HALCYON.coamingX[1] && p[1] < HALCYON.coamingTop - 0.02 && p[1] > HALCYON.seat), `${n} inside the coaming (${p.map((v) => v.toFixed(2))})`);
      assert.ok(p[1] > HALCYON.sole - 0.03, `${n} under the sole (${p[1].toFixed(3)})`);
      assert.ok(!(p[1] < HALCYON.sideDeck && ax > HALCYON.beam - 0.05), `${n} through the hull`);
    }
    // the crew never near the wheel; the helmsman's body (all but his hands and forearms) clear of the rim
    for (const [, p] of K) minWheel = Math.min(minWheel, rimDist(p));
    for (const [n, p] of H) if (!/hand|lowerarm|thumb|index|middle|ring|pinky/.test(n)) minHelmBody = Math.min(minHelmBody, rimDist(p));
    for (const [, p] of H) for (const [, q] of K) minEach = Math.min(minEach, dist(p, q));
  } });
  run(0.42, 14); run(-0.42, 14); run(0.5, 22); run(1.2, 6);
  assert.ok(crossFrames > 100, `the crew crossed (${crossFrames} frames)`);
  assert.ok(duckMax > 0.5, `the crew ducked under the swinging boom (duck ${duckMax.toFixed(2)})`);
  assert.ok(minBoom > HALCYON.boom.bottom + 0.15, `the boom ${minBoom.toFixed(3)} m from the nearest joint`);
  assert.ok(minWheel > 0.3, `the crew ${minWheel.toFixed(3)} m from the wheel's rim`);
  assert.ok(minHelmBody > 0.08, `the helmsman's body ${minHelmBody.toFixed(3)} m from the rim`);
  assert.ok(minEach > 0.25, `the two ${minEach.toFixed(3)} m apart at the nearest`);
});

test('the feet step across the sole (planted, then lifted), never dragged', () => {
  // while a foot moves along the sole it is lifted; a foot on the sole does not slide
  let prev = null, slides = 0, lifted = 0;
  tackRun({ each: (C) => {
    if (C.state.cross < 0) { prev = null; return; }
    const K = joints(C, 'crew'), f = ['foot_l', 'foot_r'].map((n) => K.find(([m]) => m === n)[1]);
    if (prev) for (let i = 0; i < 2; i++) {
      const moved = Math.hypot(f[i][0] - prev[i][0], f[i][2] - prev[i][2]), low = f[i][1] < HALCYON.sole + 0.12;
      if (moved > 0.004 && low && f[i][1] - prev[i][1] <= 0 && Math.abs(f[i][1] - (HALCYON.sole + 0.085)) < 0.01) slides++;
      if (f[i][1] > HALCYON.sole + 0.13) lifted++;
    }
    prev = f.map((p) => [...p]);
  } });
  assert.ok(lifted > 10, `the feet lifted (${lifted} frames)`);
  assert.equal(slides, 0, 'no foot slid along the sole');
});

test('the helmsman\'s hands stay on the turning wheel; a far turn regrips one hand at a time', () => {
  const C = createBoatCrew(), sc = rig.scale(SEX.helm), Jt = J.figures[SEX.helm].joints;
  let regrips = 0, both = 0, worst = 0, last = [false, false];
  for (let t = 0; t < 8; t += 1 / 60) {
    const rudder = 25 * DEG * Math.sin(t * 1.2);   // the helm swung to both stops (the wheel 4 x: ±100°)
    C.step(1 / 60, { heel: 0.1, pitch: 0, boom: 0.4, rudder });
    const g = C.state.grips, on = g.map((x) => x.q >= 0);
    if (on[0] && on[1]) both++;
    on.forEach((v, i) => { if (v && !last[i]) regrips++; }); last = on;
    rig.pose(SEX.helm, C.targets('helm', sc), pal.helm);
    for (const [h, s] of [[0, 'l'], [1, 'r']]) {
      if (g[h].q >= 0) continue;
      const wrist = at(pal.helm, bi(`hand_${s}`), Jt[bi(`hand_${s}`)]), want = rimPoint(-4 * rudder + g[h].off, HALCYON.wheel.r + 0.03);
      worst = Math.max(worst, Math.hypot(wrist[0] - want[0], wrist[1] - want[1]));
    }
  }
  assert.ok(regrips >= 2, `hand over hand (${regrips} regrips)`);
  assert.equal(both, 0, 'never both hands off the wheel');
  assert.ok(worst < 0.06, `a holding wrist within ${worst.toFixed(3)} m of its place on the turning rim`);
});

test('a knockdown or a sudden roll: both hold on (the crew\'s hands on the coaming) and let go once she is up', () => {
  const C = createBoatCrew();
  for (let t = 0; t < 2; t += 1 / 60) C.step(1 / 60, { heel: 0.15, pitch: 0, boom: 0.5, rudder: 0 });
  assert.equal(C.state.hold, 0);
  for (let t = 0; t < 1.5; t += 1 / 60) C.step(1 / 60, { heel: Math.min(55 * DEG, 0.15 + t * 0.9), pitch: 0, boom: 0.5, rudder: 0 });
  assert.equal(C.state.hold, 1, 'holding at 55°');
  const T = C.targets('crew', 1), s = C.state.side;
  for (const h of T.hands) assert.ok(Math.abs(h[0] - s * (HALCYON.coamingX[0] + 0.05)) < 0.02 && Math.abs(h[1] - (HALCYON.coamingTop + 0.05)) < 0.02, `a hand on the coaming (${h.map((v) => v.toFixed(2))})`);
  // the body rides with the boat: the torso's up nearer the boat's than the world's
  const wu = worldUpInHull(55 * DEG, 0), up = T.up;
  assert.ok(up[1] > Math.abs(wu[1]), 'the torso with the boat, not the world');
  // a strike's sudden roll at small heel holds too
  const S = createBoatCrew();
  for (let t = 0; t < 2; t += 1 / 60) S.step(1 / 60, { heel: 0.05, pitch: 0, boom: 0.5, rudder: 0 });
  for (let t = 0; t < 0.6; t += 1 / 60) S.step(1 / 60, { heel: 0.05 + t * 0.7, pitch: 0, boom: 0.5, rudder: 0 });
  assert.ok(S.state.hold > 0.9, `a 40°/s roll to 27° holds (${S.state.hold.toFixed(2)})`);
  // upright again: they let go within a few seconds
  for (let t = 0; t < 3; t += 1 / 60) C.step(1 / 60, { heel: 0.15, pitch: 0, boom: 0.5, rudder: 0 });
  assert.equal(C.state.hold, 0, 'let go once she is up');
});

test('the hike: past the band the crew leans out over the coaming; the helmsman braces against the heel', () => {
  const C = createBoatCrew();
  for (let t = 0; t < 4; t += 1 / 60) C.step(1 / 60, { heel: 4 * DEG, pitch: 0, boom: 0.4, rudder: 0 });
  const calm = [...C.targets('crew', 1).up];
  for (let t = 0; t < 4; t += 1 / 60) C.step(1 / 60, { heel: 24 * DEG, pitch: 0, boom: 0.4, rudder: 0 });
  assert.ok(C.state.hike > 0.95, `hiking at 24° (${C.state.hike.toFixed(2)})`);
  const s = C.state.side, out = C.targets('crew', 1).up;
  assert.ok(out[0] * s > calm[0] * s + 0.25, `the torso leans outboard (${calm[0].toFixed(2)} → ${out[0].toFixed(2)})`);
  const H = C.targets('helm', 1);
  assert.ok(H.hip[0] * s > 0.05, 'the helmsman\'s hips to windward');
});

test('hidden in the Helm view and from an eye on board; shown in the Boat view at 36 m; gone far off', () => {
  assert.equal(crewShown({ helmK: 1, distM: 3 }), 'helm view');
  assert.equal(crewShown({ helmK: 0.6, distM: 30 }), 'helm view');
  assert.equal(crewShown({ helmK: 0, distM: 2 }), 'on board');
  assert.equal(crewShown({ helmK: 0, distM: 36 }), '');
  assert.equal(crewShown({ helmK: 0, distM: 200, maxM: 160 }), 'far');
});

test('the same inputs give the same pose (no randomness, no clock)', () => {
  const a = [], b = [];
  tackRun({ each: (C) => a.push(joints(C, 'crew')[5][1].join(',')) });
  tackRun({ each: (C) => b.push(joints(C, 'crew')[5][1].join(',')) });
  assert.deepEqual(a, b);
  assert.ok(CREW.crossS >= 2 && CREW.crossS <= 4, 'a cross a person makes (2-4 s)');
});
