// Ground tackle and the dock (src/boat/tackle.js) with the physics (src/boat.js): the anchor's rule for dropping, its
// holding against the scope and the wind (it drags past the limit), the swing to the wind, weighing; the mooring's
// pickup tolerance and its hold; the dock's contact (the hull never inside a pier) and tying up.
// Run: node --test tests/tackle.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoatPhysics, CONTROLS, KN, DT, steadyWind } from '../src/sim/boat.js';
import { createTackle, catenaryX, rodePull, dragWindMs, pierDistance, hullOutline, ANCHOR, MOORING, DOCK } from '../src/sim/boat/tackle.js';
import { DEFAULT_DIMS } from '../src/sim/boat/dims.js';
const { HULL } = DEFAULT_DIMS;   // this page's boat (its profile)

const DEG = Math.PI / 180;
const wrap = (a) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

// a boat with the sails down, a tackle, a steady wind FROM windFrom (deg); run(secs, ctl) steps it
function rig({ depth = 8, windKn = 10, windFrom = 0, heading = 90, speed = 0, x = 0, z = 0, balls = [], piers = [], furl = 1 } = {}) {
  const tk = createTackle({ depthAt: typeof depth === 'function' ? depth : () => depth, balls, piers });
  const b = new BoatPhysics({ x, z, heading: heading * DEG, speed });
  b.furlPos = furl;
  const env = { windAt: steadyWind(windKn * KN, windFrom), t: 0, ext: tk.ext, post: tk.post };
  let t = 0;
  const run = (secs, ctl = {}, each = null) => { for (let i = 0; i < secs / DT; i++) { env.t = t; b.step(DT, { ...CONTROLS, furl, ...ctl }, env); t += DT; each?.(b.state, tk); } return b.state; };
  return { tk, b, s: b.state, run };
}

test('the rode: the distance grows with the pull; the pull inverts it; more lift at short scope', () => {
  const w = ANCHOR.chainKgM * 9.81 * ANCHOR.chainSub;
  let last = 0;
  for (const H of [10, 50, 200, 800, 3000]) { const X = catenaryX(H, 9, 40, w).X; assert.ok(X > last); last = X; }
  const X = catenaryX(300, 9, 40, w).X + (40 - ANCHOR.chainM) * 300 / ANCHOR.nylonEA;
  assert.ok(Math.abs(rodePull(X, 9, 40).H - 300) < 3);
  const lift = (L, H) => Math.atan2(catenaryX(H, 9, L, w).V, H);
  assert.ok(lift(27, 400) > lift(45, 400) && lift(27, 400) > 0, `400 N: short scope lifts the shank ${(lift(27, 400) / DEG).toFixed(1)}° vs ${(lift(45, 400) / DEG).toFixed(1)}°`);
  assert.ok(dragWindMs(8, 3) < dragWindMs(8, 5), `the drag wind at 3:1 ${(dragWindMs(8, 3) / KN).toFixed(1)} kn < at 5:1 ${(dragWindMs(8, 5) / KN).toFixed(1)} kn`);
});

test('dropping: only slow (under 1 kn) and in 3–20 m of water', () => {
  const at = (depth, speed) => rig({ depth, speed }).tk.canDrop({ ...rig({ speed }).s, sog: speed });
  assert.equal(at(8, 0.3).ok, true);
  assert.equal(at(8, 0.8).why, 'fast');
  assert.equal(at(2, 0.2).why, 'shallow');
  assert.equal(at(35, 0.2).why, 'deep');
  const r = rig({ depth: 8 });
  assert.equal(r.tk.drop(r.s).ok, true);
  r.run(80);
  assert.equal(r.tk.state.anchor.phase, 'held');
  assert.ok(Math.abs(r.tk.state.anchor.out - ANCHOR.scope * (8 + ANCHOR.bowY)) < 0.5, `rode out ${r.tk.state.anchor.out.toFixed(1)} m (5:1)`);
});

test('the anchor drags when the wind is over the limit for its scope, and holds under it', () => {
  for (const scope of [3, 5]) {
    const lim = dragWindMs(8, scope) / KN;
    const trial = (kn) => { const r = rig({ depth: 8, windKn: kn }); r.tk.drop(r.s, { scope }); r.run(400); return r.tk.state.anchor.dragged; };
    const under = trial(lim - 6), over = trial(lim + 4);
    assert.ok(under < 5, `scope ${scope}: ${(lim - 6).toFixed(1)} kn (under ${lim.toFixed(1)}) dragged ${under.toFixed(1)} m`);
    assert.ok(over > 20, `scope ${scope}: ${(lim + 4).toFixed(1)} kn (over) dragged ${over.toFixed(1)} m`);
  }
  // the same wind: holds at 5:1, drags at 3:1
  const kn = (dragWindMs(8, 3) / KN + dragWindMs(8, 5) / KN) / 2;
  const at = (scope) => { const r = rig({ depth: 8, windKn: kn }); r.tk.drop(r.s, { scope }); r.run(400); return r.tk.state.anchor.dragged; };
  assert.ok(at(5) < 5 && at(3) > 20, `${kn.toFixed(1)} kn: 5:1 holds, 3:1 drags`);
});

test('the mooring: picked up within 3 m under 0.6 m/s; refused too fast or too far; it holds the boat head to wind', () => {
  const ball = { x: 0, z: -ANCHOR.bowX - 2.0, boat: false };   // 2 m ahead of the bow (heading north)
  const near = rig({ heading: 0, speed: 0.4, balls: [ball] });
  assert.equal(near.tk.canMoor({ ...near.s, sog: 0.4 }).ok, true);
  assert.equal(near.tk.canMoor({ ...near.s, sog: 0.8 }).why, 'fast');
  const far = rig({ heading: 0, balls: [{ x: 0, z: -ANCHOR.bowX - MOORING.pickM - 0.6, boat: false }] });
  assert.equal(far.tk.canMoor({ ...far.s, sog: 0.2 }).why, 'far');
  const taken = rig({ heading: 0, balls: [{ ...ball, boat: true }] });
  assert.notEqual(taken.tk.canMoor({ ...taken.s, sog: 0.2 }).ok, true, 'a ball with a boat on it is not free');
  // moored in 15 kn from the east, starting beam-on: it swings to the wind and stays on its pennant
  const r = rig({ heading: 0, windKn: 15, windFrom: 90, balls: [ball] });
  assert.equal(r.tk.moor({ ...r.s, sog: 0 }).ok, true);
  let worst = 0;
  r.run(300, {}, (s, tk) => { const [bx, bz] = tk.bow(s); worst = Math.max(worst, Math.hypot(bx - ball.x, bz - ball.z)); });
  assert.ok(worst < MOORING.pennantM + 1.5, `the bow stays within ${worst.toFixed(2)} m of the ball`);
  assert.ok(Math.abs(wrap(r.s.heading - 90 * DEG)) < 25 * DEG, `heading ${(r.s.heading / DEG).toFixed(0)}° vs the wind from 90°`);
  assert.equal(r.tk.release(), 'mooring'); assert.equal(r.tk.mode, 'free');
});

// a pier running north from (10, 0): x 10 ± 1, z −40 … 0; the boat east of it
const PIER = { a: [10, 0], b: [10, -40], half: 1 };

test('docking: under power into a pier at 1.5 and 3 m/s at 20° and 90°, the hull never goes inside it', () => {
  for (const [deg, lever] of [[20, 0.4], [90, 0.4], [20, 1], [90, 1]]) {
    // aim at the pier's east face from 25 m out: heading west-ish (270°), turned `deg` off parallel
    const heading = 360 - deg;   // deg 90: straight at it (west); 20: a glancing approach
    const r = rig({ windKn: 0, heading, x: 11 + 25 * Math.sin(deg * DEG) + HULL.beam, z: -20 + 25 * Math.cos(deg * DEG), piers: [PIER] });
    r.b.engine.start();
    let minGap = Infinity, hit = false, maxU = 0;
    r.run(60, { throttle: lever, rudder: 0 }, (s, tk) => { const g = tk.hullGap(s); minGap = Math.min(minGap, g); if (tk.state.contact) hit = true; maxU = Math.max(maxU, s.sog); });
    assert.ok(hit, `${deg}° lever ${lever}: it reached the pier`);
    assert.ok(minGap >= 0, `${deg}° at ${maxU.toFixed(2)} m/s: the smallest hull–pier gap ${minGap.toFixed(3)} m`);
  }
  assert.ok(pierDistance(PIER, 10, -20).d < 0 && pierDistance(PIER, 13, -20).d > 1.9, 'the pier distance');
});

test('tying up: alongside within 1 m and stopped, the lines hold it in a 15 kn offshore wind', () => {
  // alongside the pier's east face, heading north, 0.6 m off
  const x = 11 + HULL.beam / 2 + 0.6;
  const r = rig({ windKn: 15, windFrom: 270, heading: 0, x, z: -20, piers: [PIER] });   // wind from the west: blowing it off the pier
  assert.equal(r.tk.canTie({ ...r.s, sog: 1 }).why, 'fast');
  assert.equal(r.tk.tieUp({ ...r.s, sog: 0.1 }).ok, true);
  assert.equal(r.tk.state.fenders, true);
  let maxGap = 0, minGap = Infinity;
  r.run(240, {}, (s, tk) => { if (tk.state.mode !== 'docked') return; const g = tk.hullGap(s); maxGap = Math.max(maxGap, g); minGap = Math.min(minGap, g); });
  assert.ok(maxGap < 1.6, `the lines hold it within ${maxGap.toFixed(2)} m`);
  assert.ok(minGap >= 0, 'never inside the pier');
  const far = rig({ heading: 0, x: x + 3, z: -20, piers: [PIER] });
  assert.equal(far.tk.canTie({ ...far.s, sog: 0 }).why, 'far');
  assert.equal(r.tk.release(), 'lines');
});

test('the hull outline spans the boat', () => {
  const o = hullOutline();
  const xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
  assert.ok(Math.max(...xs) - Math.min(...xs) > HULL.loa - 0.01 && Math.max(...ys) * 2 > HULL.beam * 0.95);
  assert.ok(DOCK.fenderM > DOCK.rubM);
});
