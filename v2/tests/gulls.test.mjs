// The gulls at the boat (v2/sim/gulls.js, feat/gulls): they come in visits and circle the boat, crossing in front of the follow
// camera at 15–25 m (60–100 px across), glide in the M between flaps, bank into their turns, cry sparingly (thinner in wind),
// never come within 15 m of the camera (owner, 2026-11-24: "allow closer birds"; other birds keep 40 m) or through the rig, and fly the same way every time on the same seed. The phone's light tier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBirdSim, KEEP_M } from '../sim/birds.js';
const FLOOR = 15;   // a circling gull's floor (GULLS.keepM)
import { GULLS, circuitOffset, centreDistance, bankOf } from '../sim/gulls.js';
import { createFeatures } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';

const terrain = { heightAt: () => -30, shoreDistance: () => -500 };
const MAST = GULLS.mastTop;
// a boat sailing on (a slow weave) and a camera: 'follow' (36 m astern, 5.7 m up: the Boat view as measured live), 'helm' (on her, 2 m up), 'far' (110 m abeam),
// 'orbit' (the player dragging the follow camera round her, 34 m off, a lap a minute)
function sail({ seconds = 600, seed = 1, cam = 'follow', wind = [3, 0], shelter = 0, tier = 'high', sog = 2.7, each = null } = {}) {
  const boat = { x: 1000, z: -1000, heading: 0.3, sog };
  const B = createBirdSim({ terrain, seed, tier, start: [1000, -1000], boat: () => boat, wind: { sample: () => ({ vx: wind[0], vz: wind[1] }) } });
  B.setDaylight(35, [0.3, 0.8, 0.2]);
  B.setShelter(shelter);
  const dt = 1 / 30;
  for (let t = 0; t <= seconds; t += dt) {
    boat.heading += 0.05 * Math.sin(t * 0.04) * dt;
    boat.x += Math.sin(boat.heading) * boat.sog * dt; boat.z -= Math.cos(boat.heading) * boat.sog * dt;
    const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
    const c = cam === 'helm' ? [boat.x, 2, boat.z]
      : cam === 'far' ? [boat.x - fz * 110, 4, boat.z + fx * 110]
        : cam === 'orbit' ? [boat.x + Math.sin(t * 0.105) * 34, 6, boat.z + Math.cos(t * 0.105) * 34]
          : [boat.x - fx * 36, 5.7, boat.z - fz * 36];
    B.update(t, c);
    each?.(t, B, boat, c);
  }
  return B;
}
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(p * (s.length - 1))]; };

test('they come in visits and circle the boat, crossing in front of the follow camera at 15–25 m and 60–100 px across, then leave', () => {
  const dCam = [], dBoat = [], steady = [], front = [];
  const th = Math.tan((45 / 2) * Math.PI / 180);   // the Boat view's 45° vertical field
  const since = new Map();
  let circlingSeen = 0, flockBetween = 0;
  const B = sail({ seconds: 900, each: (t, B, boat, c) => {
    const st = B.circle.state;
    for (const g of B.find('gulls')) {
      if (g.mode !== 'circle') { since.delete(g.id); continue; }
      if (!since.has(g.id)) since.set(g.id, t);
      const d = Math.hypot(g.pos[0] - c[0], g.pos[1] - c[1], g.pos[2] - c[2]);
      dCam.push(d); dBoat.push(Math.hypot(g.pos[0] - boat.x, g.pos[2] - boat.z));
      if (t - since.get(g.id) > 30) steady.push(d);
      const fx = Math.sin(boat.heading), fz = -Math.cos(boat.heading);
      if ((g.pos[0] - c[0]) * fx + (g.pos[2] - c[2]) * fz > 0) front.push({ d, px: (1.32 * g.scale * 720) / (2 * d * th) });
    }
    if (st.circling) circlingSeen++;
    if (!st.visiting && B.find('gulls').every((g) => g.mode === 'flock')) flockBetween++;
  } });
  const v = B.circle.state.visits.filter((x) => x.start < 900);
  assert.ok(v.length >= 3, `at least 3 visits in 15 min (${v.length})`);
  assert.ok(v[0].start <= 15, 'the first visit within 15 s of play (seen in seconds)');
  assert.ok(circlingSeen > 0 && flockBetween > 0, 'circling during a visit, v1\'s far flock between');
  assert.ok(Math.min(...dCam) >= FLOOR - 1e-6, `never within ${FLOOR} m of the camera (${Math.min(...dCam).toFixed(2)})`);
  assert.ok(pct(steady, 0.02) >= FLOOR + 0.5, `settled on the circuit they keep off the floor (p2 ${pct(steady, 0.02).toFixed(1)} m)`);
  const near = front.filter((x) => x.d <= 25);
  assert.ok(near.length > front.length * 0.08, `they cross in front of the camera within 25 m (${((100 * near.length) / front.length).toFixed(0)} % of the frames ahead)`);
  const pxMax = Math.max(...front.map((x) => x.px));
  assert.ok(pxMax >= 60 && pxMax <= 110, `the near pass ${pxMax.toFixed(0)} px across at 1280 × 720 (60–100 wanted)`);
  assert.ok(pct(near.map((x) => x.px), 0.5) >= 50, `inside 25 m a median ${pct(near.map((x) => x.px), 0.5).toFixed(0)} px`);
  assert.ok(pct(dBoat, 0.5) < 32 && pct(dBoat, 0.1) > 10, `round the boat (p10 ${pct(dBoat, 0.1).toFixed(1)}, median ${pct(dBoat, 0.5).toFixed(1)} m)`);
  assert.ok(KEEP_M === 40, 'every other bird keeps 40 m');
});

test('the circuit: its radius and harmonics, the centre far enough that its near edge is the planned distance', () => {
  const B = createBirdSim({ terrain, seed: 4, start: [1000, -1000], boat: () => ({ x: 1000, z: -1000, heading: 0, sog: 0 }) });
  for (const p of B.circle.params) {
    assert.ok(p.R >= GULLS.radius[0] && p.R <= GULLS.radius[1], 'radius in range');
    let lo = Infinity, hi = 0;
    for (let k = 0; k < 360; k++) { const [x, z] = circuitOffset(p, (k / 360) * Math.PI * 2); const r = Math.hypot(x, z); lo = Math.min(lo, r); hi = Math.max(hi, r); }
    assert.ok(lo > p.R * 0.75 && hi < p.R * 1.25, `a circle with harmonics, not a star (${lo.toFixed(1)}–${hi.toFixed(1)} on ${p.R.toFixed(1)})`);
    // the nearest point of the squashed circuit to a camera on its axis, at the centre's distance: the planned edge
    for (const dy of [4, 12, 20]) {
      const Hc = centreDistance(p, dy);
      let near = Infinity;
      for (let k = 0; k < 720; k++) { const [x, z, up] = circuitOffset(p, (k / 720) * Math.PI * 2); near = Math.min(near, Math.hypot(x, Hc + z * GULLS.squash, dy + up)); }
      assert.ok(near >= GULLS.camPlan - 1e-6, `dy ${dy}: the near edge ${near.toFixed(2)} m ≥ ${GULLS.camPlan}`);
    }
  }
});

test('they bank into their turns (the over-banked coordinated turn, capped) and glide in the M between flaps', () => {
  const roll = [], agree = [0, 0];
  let glide = 0, flap = 0, mOk = 0;
  sail({ seconds: 300, each: (t, B) => {
    for (const g of B.find('gulls')) {
      if (g.mode !== 'circle') continue;
      roll.push(Math.abs(g.roll));
      assert.ok(Math.abs(g.roll) <= GULLS.maxRoll + 1e-9, 'the roll capped at 0.95 rad');
      if (Math.abs(g.turn) > 0.2) { agree[1]++; if (g.roll * g.turn < 0) agree[0]++; }   // + roll is the right wing down; yaw grows to the left
      if (g.amp < 0.02) { glide++; if (Math.abs(g.pose.flap - GULLS.arm) < 0.02 && Math.abs(g.pose.hand - GULLS.hand) < 0.02) mOk++; } else flap++;
    }
  } });
  const deg = (r) => (r * 180) / Math.PI;
  assert.ok(deg(pct(roll, 0.5)) > 20 && deg(pct(roll, 0.5)) < 45, `a visible bank round the circuit (median ${deg(pct(roll, 0.5)).toFixed(1)}°)`);
  assert.ok(agree[0] / agree[1] > 0.9, `banked into the turn, not out of it (${((100 * agree[0]) / agree[1]).toFixed(1)} %)`);
  assert.equal(mOk, glide, 'every gliding frame is the M: arm +0.26, hand −0.48');
  const share = glide / (glide + flap);
  assert.ok(share > 0.25 && share < 0.85, `glides between flaps (${(100 * share).toFixed(0)} % gliding)`);
  // the bank law itself: 10 m/s on a 25 m circle is a coordinated 22°; the gull shows ≈ 31°, the same side
  const b = bankOf(10, 0.4);
  assert.ok(b < 0 && Math.abs((b * 180) / Math.PI - -31.4) < 1, `bankOf ${((b * 180) / Math.PI).toFixed(1)}°`);
});

test('never through the boat, its rig or the camera: the follow, helm, far and orbiting cameras; a fast boat (Sail\'s 2× clock)', () => {
  for (const [cam, sog] of [['follow', 2.7], ['helm', 2.7], ['far', 2.7], ['orbit', 2.7], ['follow', 5.6]]) {
    let minRig = Infinity, minCam = Infinity, n = 0;
    sail({ seconds: 420, cam, sog, seed: 2, each: (t, B, boat, c) => {
      for (const g of B.find('gulls')) {
        if (g.mode !== 'circle') continue;
        n++;
        const h = Math.hypot(g.pos[0] - boat.x, g.pos[2] - boat.z);
        const rig = g.pos[1] > MAST ? Math.hypot(h, g.pos[1] - MAST) : h;   // the distance to the mast (0–11.5 m over her)
        minRig = Math.min(minRig, rig);
        if (h < GULLS.boatR) assert.ok(g.pos[1] >= MAST + GULLS.clearM - 1e-9, `${cam}: over the boat at ${g.pos[1].toFixed(1)} m`);
        minCam = Math.min(minCam, Math.hypot(g.pos[0] - c[0], g.pos[1] - c[1], g.pos[2] - c[2]));
      }
    } });
    assert.ok(n > 1000, `${cam}: circling seen`);
    assert.ok(minRig >= GULLS.clearM - 1e-6, `${cam}: ${minRig.toFixed(1)} m from the rig at the nearest`);
    assert.ok(minCam >= FLOOR - 1e-6, `${cam}: ${minCam.toFixed(2)} m from the camera at the nearest`);
  }
});

test('the cries: sparing flurries on a circling gull, none in the first 6 s, thinner in strong wind, none in the storm', () => {
  const B = sail({ seconds: 900 });
  const c = B.circle.calls;
  const visitS = B.circle.state.visits.filter((v) => v.start < 900).reduce((a, v) => a + Math.min(900, v.end) - v.start, 0);
  const perMin = c.length / (visitS / 60);
  assert.ok(perMin >= 2 && perMin <= 8, `${perMin.toFixed(1)} cries a minute while they visit`);
  assert.ok(c.every((e) => e.t >= GULLS.calls.firstS), 'none in the first 6 s');
  assert.ok(c.every((e) => e.d < GULLS.calls.range), 'each on a gull within the cries\' range');
  assert.ok(c.every((e) => e.gain === 1), 'full voice in a light breeze (3 m/s)');
  // a new flurry waits the floor; answers come 0.6–2 s after a cry (W's flurries)
  const gaps = c.slice(1).map((e, i) => e.t - c[i].t);
  assert.ok(gaps.every((g) => g >= GULLS.calls.answerS[0] - 0.05), 'no two cries closer than an answer');
  const strong = sail({ seconds: 400, wind: [12, 0] }).circle.calls;
  assert.ok(strong.length > 0 && strong.every((e) => Math.abs(e.gain - GULLS.calls.windFloor) < 1e-9), 'at 12 m/s each cry at the wind\'s floor (0.3)');
  const mid = sail({ seconds: 400, wind: [9, 0] }).circle.calls;
  assert.ok(mid.every((e) => e.gain > 0.3 && e.gain < 1), 'at 9 m/s thinner, not silent');
  const storm = sail({ seconds: 200, shelter: 0.6 });
  assert.equal(storm.circle.calls.length, 0, 'no cries in the storm');
  assert.equal(storm.find('gulls').filter((g) => g.mode === 'circle').length, 0, 'and no visit: the gulls are sheltering');
});

test('deterministic: the same seed flies the same gulls and cries; another seed differs', () => {
  const run = (seed) => { const B = sail({ seconds: 200, seed }); return { pos: B.find('gulls').map((g) => [...g.pos, g.roll]), calls: B.circle.calls.map((e) => [e.t, e.id]) }; };
  const a = run(3), b = run(3), c = run(4);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.pos, c.pos);
});

test('the phone tier: 3 gulls that come to the boat, drawn and heard alone, no shadows', () => {
  let maxDrawn = 0, other = 0, circled = 0;
  const B = sail({ seconds: 200, tier: 'phone', each: (t, B) => {
    const d = B.draw;
    for (const n of ['osprey', 'eagle', 'goose']) other += d.near[n].n + d.far[n].n;
    maxDrawn = Math.max(maxDrawn, d.near.gull.n + d.far.gull.n);
    if (d.shadows.n) other++;
    for (const e of B.events) if (e.species !== 'gull') other++;
    circled = Math.max(circled, B.circle.state.circling);
  } });
  assert.equal(B.find('gulls').length, 3);
  assert.equal(other, 0, 'nothing but gulls drawn or heard');
  assert.ok(maxDrawn <= 6 && circled >= 2, `${circled} circling, ${maxDrawn} records at most (a bird is in both levels while it crossfades)`);
});

test('the policy row: birds stay off on a phone by default; ?birds=gulls turns the light tier on; a desktop is unchanged', () => {
  const make = (dev, flags = {}) => {
    const win = { ...DEVICES[dev], location: { search: '' } };
    const pr = { get: () => profileOf(readFacts(win), forcedOf(''), { gpu: 1 }), on: () => () => {} };
    return createFeatures({ profile: pr, doc: null }).configure({ headless: false, flags });
  };
  assert.equal(make('iphoneTurned').feature('birds').tier, 'off');
  assert.equal(make('iphoneTurned', { birds: 'gulls' }).feature('birds').tier, 'gulls');
  assert.equal(make('desktop').feature('birds').tier, 'on');
  assert.equal(make('desktop', { birds: 'gulls' }).feature('birds').tier, 'on', 'a desktop keeps every bird');
});
