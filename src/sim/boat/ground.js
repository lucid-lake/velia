// The bottom (feat/grounding, 2026-10-30): the keel, rudder and hull meet the real lake bed and
// shore. Plain JS, no three.js and no DOM: the physics (src/boat.js) calls env.ext(state, dt) every tick for the outside
// force and env.post(state, dt, t, boat) after it, exactly as it does for the dock (src/boat/tackle.js);
// tests/ground.test.mjs drives it in node on the real terrain.
//
//   const gr = createGround({ depthAt: (x, z) => −terrain.heightAt(x, z) });     // depth: m of water, < 0 on land
//   env.ext = gr.ext; env.post = gr.post;         // (src/sail/assemble.js composes it with the tackle's)
//   gr.state → { mode: 'afloat' | 'touch' | 'aground', depth, under, keelPen, hullPen, mat, scrape, … }
//   gr.take() → the events since the last call: [{ type: 'touch' | 'thud' | 'aground' | 'refloat', … }]
//   gr.kedge() / gr.reset()
//
// The model. Probe points on the boat, each with its draft: the fin keel's tips and leading edge (1.6 m), the spade
// rudder (1.2 m) and the hull's sheer line (a canoe body, 0.1 m at the stems, 0.44 m amidships). A heeled boat's lee
// side and its keel move (draft·cos φ + y·sin φ, y·cos φ − draft·sin φ). The clearance of a point is the water's depth
// under it (the same depth the navigator and the chart read: −terrain.heightAt) minus its draft; < 0 is a touch.
//  - Soft bed (sand, silt, gravel; a bed slope under 0.25): the keel PLOWS. Its drag rises with the penetration
//    (K0 + K1·speed share, N per m) and opposes the point's motion, so a boat at 3 kn stops in 3 to 4 m and at 6 kn in 5
//    to 7 m; a gentle push toward deeper water; a plow of up to PLOW_MAX (0.4 m) is allowed, then the bed is a wall.
//  - Hard bed (rock, a bank steeper than 0.40 m/m) and the hull (always): a stiff, damped spring, with Coulomb friction
//    so a boat slides along a steep shore; no plowing.
//  - post(): the hard rule. The hull and the rock/bank keel never pass 0.04 m into the terrain, the sand keel never
//    past PLOW_MAX. A tick that would go further is bisected back to the boundary, the rest of its step slid along the
//    wall, and an impulse at the touching point (restitution 0.05 sand … 0.30 rock) takes the speed into the bed away:
//    it yaws and heels the boat as it does a real one (an off-centre point; a keel below the roll axis).
//  - The sounder's numbers (depth, under the keel) and a lookahead for the assist: predict().
//  - Frames: world x east, z south, m; heading rad clockwise from north (−z); the body frame x forward, y starboard
//    (src/boat.js); roll K > 0 puts the starboard rail down.
import { DEFAULT_DIMS } from './dims.js';
import { hullOutline } from './tackle.js';

import { clampT as clamp } from '../core/math.js';
import { smooth } from '../core/math.js';

// the table for a boat's dims (its keel, rudder and draft; memoised); GROUND is this page's boat's
const groundMemo = new WeakMap();
export function groundFor(dims = DEFAULT_DIMS) {
  let G = groundMemo.get(dims);
  if (G) return G;
  const { HULL } = dims;
  G = {
    gradM: 1.5,                    // m: the bed slope is read over ±1.5 m (the terrain's cells are 1 to 2 m)
    plowMax: 0.40,                 // m: how far a keel plows into soft bed before it is a wall
    hardMax: 0.04,                 // m: how far the hull, or a keel on rock, may pass into the terrain (the test's -0.05 limit)
    slopeSoft: 0.45, slopeHard: 0.75,   // the bed's slope (m/m, 24° and 37°): a sand bank is soft under the first, a hard bank (angle of repose and over) past the second
    // soft bed: plow drag N per m of penetration, at rest (K0) and at speed (K0 + K1 above vRef m/s); a push to deeper water
    sand: { K0: 2200, K1: 85000, K2: 6000, vRef: 0.6, Ks: 3000, mu: 0.5, e: 0.05 },   // K2: across the keel (a plate slid sideways through sand)
    // hard bed and the hull: spring N/m, damper N per m/s, friction, restitution
    rock: { k: 400000, c: 60000, mu: 0.5, e: 0.30 },
    hull: { k: 250000, c: 50000, mu: 0.35, eSand: 0.10, eRock: 0.25 },
    maxRollNm: 20000,              // N·m: the most the bottom can heel the boat while it holds her (≈ 28°; the righting moment is 42 kN·m per rad)
    maxRollRate: 0.25,             // rad/s: the most one impact adds to the roll rate
    maxForce: 150000,              // N: a cap on one contact (a stable integration at 60 Hz)
    // the points: x forward of the centre of the waterline, y to starboard, d the draft (m), w the soft-bed weight
    keel: [{ x: 0.55, y: 0, d: HULL.draft, w: 0.4 }, { x: -0.35, y: 0, d: HULL.draft, w: 0.4 }, { x: 1.2, y: 0, d: 1.1, w: 0.2 }],
    rudder: { x: -HULL.rudderZ, y: 0, d: 1.2, w: 0.25 },
    aground: { speed: 0.3, s: 1.0 },       // m/s and s: touching and slower than this for this long is aground
    refloat: { clear: 0.15, s: 1.5 },      // m of clearance everywhere for this long: afloat again
    kedge: { N: 1500, rampS: 3, maxS: 45 },
  };
  groundMemo.set(dims, G);
  return G;
}
export const GROUND = groundFor(DEFAULT_DIMS);

// the hull's draft along its length (x forward, m): a canoe body with fine ends
const hullDraft = (x) => 0.1 + 0.34 * Math.max(0, 1 - (x / 4.3) ** 2) ** 0.6;

export function groundPoints(G = GROUND, dims = DEFAULT_DIMS) {
  const pts = [], { HULL } = dims;
  for (const k of G.keel) pts.push({ kind: 'keel', ...k });
  pts.push({ kind: 'keel', ...G.rudder });
  for (const [x, y] of hullOutline(8, HULL)) pts.push({ kind: 'hull', x, y, d: hullDraft(x), w: 0 });
  pts.push({ kind: 'hull', x: HULL.loa / 2, y: 0, d: 0.1, w: 0 }, { kind: 'hull', x: -HULL.loa / 2, y: 0, d: 0.25, w: 0 });
  return pts;
}

// dims: the boat's (its keel, rudder and hull: src/boat/dims.js; this page's boat by default)
export function createGround({ depthAt, rockAt = null, dims = DEFAULT_DIMS, G = groundFor(dims) } = {}) {
  const pts = groundPoints(G, dims), n = pts.length;
  const wx = new Float64Array(n), wz = new Float64Array(n), cl = new Float64Array(n), dEff = new Float64Array(n), yEff = new Float64Array(n);
  const st = {
    mode: 'afloat',            // 'afloat' | 'touch' (bottom touched in the last 0.5 s) | 'aground' (stuck: touching and nearly stopped)
    depth: 99, under: 99,      // m of water under the boat's middle; m under the keel (the lowest of its points; < 0 touching)
    keelPen: 0, hullPen: 0,    // m into the bed now
    mat: 'sand',               // 'sand' | 'rock': what the boat touches
    scrape: 0,                 // 0..1: how hard it is grinding along the bed now (the sound)
    thud: 0,                   // 0..1: the last impact (decays over 0.6 s)
    groundedS: 0, kedging: false, kedgeS: 0,
    maxKeelPen: 0, maxHullPen: 0, minHullClear: 99, minKeelClear: 99, peakDecel: 0,   // for the tests
  };
  let events = [], ok = null, touchedAt = -9, slowS = 0, clearS = 0, tNow = 0, kedgeDir = null;
  const D = (x, z) => depthAt(x, z);
  const gradAt = (x, z, out) => {
    const e = G.gradM, gx = (D(x + e, z) - D(x - e, z)) / (2 * e), gz = (D(x, z + e) - D(x, z - e)) / (2 * e), m = Math.hypot(gx, gz);
    out.gx = gx; out.gz = gz; out.slope = m;
    return out;
  };
  const g1 = { gx: 0, gz: 0, slope: 0 };
  const isRock = (slope, x, z) => slope >= G.slopeHard * 0.9 || (rockAt ? rockAt(x, z, slope) : false);

  // the points' world positions, depths and clearances for a pose
  function scan(x, z, h, heel) {
    const sh = Math.sin(h), ch = Math.cos(h), cphi = Math.cos(heel), sphi = Math.sin(heel);
    let hull = 99, keel = 99;
    for (let i = 0; i < n; i++) {
      const p = pts[i], d = p.d * cphi + p.y * sphi, y = p.y * cphi - p.d * sphi;
      dEff[i] = d; yEff[i] = y;
      wx[i] = x + p.x * sh + y * ch; wz[i] = z - p.x * ch + y * sh;
      cl[i] = D(wx[i], wz[i]) - d;
      if (p.kind === 'hull') hull = Math.min(hull, cl[i]); else keel = Math.min(keel, cl[i]);
    }
    return { hull, keel };
  }
  // a keel is on hard bed on rock (rockAt: the island, a rocky shore) or a bank past the angle of repose
  const hardKeel = (slope, x, z) => slope >= G.slopeHard || (rockAt ? rockAt(x, z, slope) : false);
  // how far point i is past its limit (> 0: a violation), with the bed's gradient at it (g1)
  function violation(i) {
    if (cl[i] >= 0) return -1;
    const p = pts[i], pen = -cl[i];
    if (p.kind === 'hull') { gradAt(wx[i], wz[i], g1); return pen - G.hardMax; }
    if (pen <= G.hardMax) return -1;
    gradAt(wx[i], wz[i], g1);
    return pen - (hardKeel(g1.slope, wx[i], wz[i]) ? G.hardMax : G.plowMax);
  }
  // the worst violating point of the pose now scanned → index or -1 (g1 set for it)
  const gW = { gx: 0, gz: 0, slope: 0 };
  function worst() {
    let bi = -1, bv = 0;
    for (let i = 0; i < n; i++) {
      const v = violation(i);
      if (v > bv) { bv = v; bi = i; gW.gx = g1.gx; gW.gz = g1.gz; gW.slope = g1.slope; }
    }
    return bi < 0 ? null : { i: bi, v: bv };
  }
  const feasibleAt = (x, z, h, heel) => { scan(x, z, h, heel); return worst() === null; };

  // the unit normal toward deeper water at a point (a flat bed: back the way the boat faces)
  function normal(gr, h) {
    if (gr.slope > 0.02) return [gr.gx / gr.slope, gr.gz / gr.slope];
    return [-Math.sin(h), Math.cos(h)];
  }
  const pointVel = (s, px, py) => {
    const vb = s.u - s.yawRate * py, vs = s.v + s.yawRate * px, sh = Math.sin(s.heading), ch = Math.cos(s.heading);
    return [vb * sh + vs * ch, -vb * ch + vs * sh];
  };
  const toBody = (h, fx, fz, px, py) => {
    const X = fx * Math.sin(h) - fz * Math.cos(h), Y = fx * Math.cos(h) + fz * Math.sin(h);
    return { X, Y, N: px * Y - py * X };
  };

  // ---- the soft forces ----
  function ext(s, dt) {
    tNow += dt;
    scan(s.x, s.z, s.heading, s.heel);
    let X = 0, Y = 0, N = 0, K = 0, sc = 0;
    const cphi = Math.cos(s.heel), sphi = Math.sin(s.heel);
    for (let i = 0; i < n; i++) {
      if (cl[i] >= 0) continue;
      const p = pts[i], pen = -cl[i];
      gradAt(wx[i], wz[i], g1);
      const nn = normal(g1, s.heading), px = p.x, py = p.y * cphi - p.d * sphi;
      const [vx, vz] = pointVel(s, px, py), vn = vx * nn[0] + vz * nn[1], vtx = vx - vn * nn[0], vtz = vz - vn * nn[1];
      const vmag = Math.hypot(vx, vz), vt = Math.hypot(vtx, vtz);
      let fx, fz;
      const soft = p.kind === 'keel' && !hardKeel(g1.slope, wx[i], wz[i]);
      if (soft) {
        // friction against the slide (K0) and the plow's resistance to going on into the bank (K1, only for the motion into
        // it: a boat backing out of its own furrow meets friction alone); a gentle push toward deeper water
        const S = G.sand, fr = p.w * pen * S.K0 * tanhS(vmag / 0.05), plow = p.w * pen * S.K1 * Math.min(1, Math.max(0, -vn) / S.vRef);
        const push = p.w * S.Ks * pen * Math.min(1, g1.slope / 0.15);
        const ux = vmag > 1e-6 ? vx / vmag : 0, uz = vmag > 1e-6 ? vz / vmag : 0;
        const yx = Math.cos(s.heading), yz = Math.sin(s.heading), vlat = vx * yx + vz * yz, lat = p.w * pen * S.K2 * Math.min(1, Math.abs(vlat) / S.vRef) * Math.sign(vlat);   // sideways through the sand
        fx = -fr * ux + (plow + push) * nn[0] - lat * yx; fz = -fr * uz + (plow + push) * nn[1] - lat * yz;
        sc = Math.max(sc, clamp((fr + plow) / 6000, 0, 1));
      } else {
        const M = p.kind === 'hull' ? G.hull : G.rock;
        const Fn = clamp(M.k * pen - M.c * Math.min(vn, 0), 0, G.maxForce);
        const Ft = M.mu * Fn * tanhS(vt / 0.05), tx = vt > 1e-6 ? vtx / vt : 0, tz = vt > 1e-6 ? vtz / vt : 0;
        fx = Fn * nn[0] - Ft * tx; fz = Fn * nn[1] - Ft * tz;
        sc = Math.max(sc, clamp(Ft / 8000, 0, 1));
      }
      const f = toBody(s.heading, fx, fz, px, py);
      X += f.X; Y += f.Y; N += f.N;
      K -= f.Y * dEff[i];       // a sideways push below the roll axis: a starboard push at the keel rolls the boat to port
    }
    st.scrape += (sc - st.scrape) * Math.min(1, dt / 0.08);
    if (st.kedging) {
      st.kedgeS += dt;
      if (st.kedgeS > G.kedge.maxS || st.mode === 'afloat' && st.kedgeS > 4) st.kedging = false;
      else if (kedgeDir) {
        const F = G.kedge.N * Math.min(1, st.kedgeS / G.kedge.rampS), f = toBody(s.heading, kedgeDir[0] * F, kedgeDir[1] * F, 0, 0);
        X += f.X; Y += f.Y; N += f.N;
      }
    }
    return { X, Y, N, K: clamp(K, -G.maxRollNm, G.maxRollNm) };
  }
  const tanhS = (x) => { const e = Math.exp(-2 * Math.min(x, 20)); return (1 - e) / (1 + e); };

  // ---- the hard rule ----
  // an impulse at point i (body coords) along the unit world normal nn; restitution e, friction mu
  function impulse(s, boat, i, nn, e, mu) {
    const P = boat.P, M11 = P.mass * P.m11, M22 = P.mass * P.m22, Izz = P.izz, h = s.heading;
    const p = pts[i], px = p.x, py = yEff[i];
    const [vx, vz] = pointVel(s, px, py), vn = vx * nn[0] + vz * nn[1];
    if (vn >= 0) return 0;
    const b = toBody(h, nn[0], nn[1], px, py);              // X, Y: the normal in the body frame; N: its moment
    const inv = b.X * b.X / M11 + b.Y * b.Y / M22 + b.N * b.N / Izz;
    const J = -(1 + e) * vn / inv;
    s.u += J * b.X / M11; s.v += J * b.Y / M22; s.yawRate += J * b.N / Izz;
    if (boat.p != null) boat.p += clamp(-J * b.Y * dEff[i] / P.ixx, -G.maxRollRate, G.maxRollRate);
    // friction: along the tangent, no more than takes the slide away
    const [vx2, vz2] = pointVel(s, px, py), vn2 = vx2 * nn[0] + vz2 * nn[1], tx = vx2 - vn2 * nn[0], tz = vz2 - vn2 * nn[1], vt = Math.hypot(tx, tz);
    if (vt > 1e-4 && mu > 0) {
      const ux = tx / vt, uz = tz / vt, t = toBody(h, ux, uz, px, py);
      const invT = t.X * t.X / M11 + t.Y * t.Y / M22 + t.N * t.N / Izz, Jt = Math.min(mu * J, vt / invT);
      s.u -= Jt * t.X / M11; s.v -= Jt * t.Y / M22; s.yawRate -= Jt * t.N / Izz;
    }
    return -vn;
  }

  function post(s, dt, t, boat) {
    if (boat) tNow = t ?? tNow;
    const jump = ok ? Math.hypot(s.x - ok.x, s.z - ok.z) : 0;
    if (!ok || jump > 8) ok = { x: s.x, z: s.z, h: s.heading, heel: s.heel };   // the first tick, or a teleport (the pier, the dawn wait): a new baseline
    scan(s.x, s.z, s.heading, s.heel);
    let w = worst(), hitV = 0, hitMat = 'sand', hitKind = 'keel', hit = false;
    for (let pass = 0; w && pass < 4; pass++) {
      hit = true;
      const gr = { gx: gW.gx, gz: gW.gz, slope: gW.slope }, nn = normal(gr, s.heading), i = w.i, p = pts[i];
      const hardK = p.kind === 'hull' || hardKeel(gr.slope, wx[i], wz[i]), rock = isRock(gr.slope, wx[i], wz[i]);
      // 1. back to the boundary along the step, then slide the rest of the step along the wall
      const p1x = s.x, p1z = s.z;
      if (feasibleAt(ok.x, ok.z, s.heading, s.heel)) {
        let lo = 0, hi = 1;
        for (let k = 0; k < 7; k++) { const m = (lo + hi) / 2; if (feasibleAt(ok.x + (p1x - ok.x) * m, ok.z + (p1z - ok.z) * m, s.heading, s.heel)) lo = m; else hi = m; }
        let bx = ok.x + (p1x - ok.x) * lo, bz = ok.z + (p1z - ok.z) * lo;
        const rx = p1x - bx, rz = p1z - bz, rn = rx * nn[0] + rz * nn[1], qx = bx + (rx - rn * nn[0]), qz = bz + (rz - rn * nn[1]);
        if (Math.hypot(qx - bx, qz - bz) > 1e-6 && feasibleAt(qx, qz, s.heading, s.heel)) { bx = qx; bz = qz; }
        s.x = bx; s.z = bz;
      } else {
        // no good baseline (the heading swung a corner in): move out along the normal
        const dist = Math.min(1, w.v / Math.max(gr.slope, 0.05));
        s.x += nn[0] * dist; s.z += nn[1] * dist;
      }
      scan(s.x, s.z, s.heading, s.heel);
      // 2. the impulse: restitution by what it is
      if (boat) {
        const e = p.kind === 'hull' ? (rock ? G.hull.eRock : G.hull.eSand) : hardK ? G.rock.e : G.sand.e;
        const mu = p.kind === 'hull' ? G.hull.mu : hardK ? G.rock.mu : G.sand.mu;
        const v = impulse(s, boat, i, nn, e, mu);
        if (v > hitV) { hitV = v; hitMat = rock ? 'rock' : 'sand'; hitKind = p.kind; }
      }
      scan(s.x, s.z, s.heading, s.heel);
      w = worst();
    }
    if (w) {
      // still inside after four passes: back to the last good pose, stopped
      s.x = ok.x; s.z = ok.z; s.heading = ok.h; s.heel = ok.heel; s.u = 0; s.v = 0; s.yawRate = 0; if (boat) boat.p = 0;
      scan(s.x, s.z, s.heading, s.heel);
    } else {
      ok.x = s.x; ok.z = s.z; ok.h = s.heading; ok.heel = s.heel;
    }
    // ---- the state, the events ----
    let keelPen = 0, hullPen = 0, kHard = false, soft = false;
    for (let i = 0; i < n; i++) {
      const pen = -cl[i];
      if (pts[i].kind === 'hull') hullPen = Math.max(hullPen, pen); else keelPen = Math.max(keelPen, pen);
    }
    const hullClear = Math.min(...Array.from(cl.subarray(0, n)).filter((_, i) => pts[i].kind === 'hull'));
    const keelClear = Math.min(...Array.from(cl.subarray(0, n)).filter((_, i) => pts[i].kind === 'keel'));
    st.hullPen = Math.max(0, hullPen); st.keelPen = Math.max(0, keelPen);
    st.maxKeelPen = Math.max(st.maxKeelPen, st.keelPen); st.maxHullPen = Math.max(st.maxHullPen, st.hullPen);
    st.minHullClear = Math.min(st.minHullClear, hullClear); st.minKeelClear = Math.min(st.minKeelClear, keelClear);
    st.depth = D(s.x, s.z); st.under = keelClear;
    const touching = keelClear < 0.02 || hullClear < 0.02;
    if (touching) {
      const iw = cl.indexOf(Math.min(...Array.from(cl.subarray(0, n))));
      gradAt(wx[iw], wz[iw], g1);
      st.mat = isRock(g1.slope, wx[iw], wz[iw]) ? 'rock' : 'sand';
    }
    if (hit && hitV > 0.15) {
      st.thud = Math.max(st.thud, clamp(hitV / 3, 0.15, 1));
      st.peakDecel = Math.max(st.peakDecel, hitV);
      push({ type: 'thud', v: hitV, mat: hitMat, kind: hitKind, t: tNow });
    }
    st.thud = Math.max(0, st.thud - dt / 0.6);
    const sog = Math.hypot(s.u, s.v);
    if (touching) {
      if (tNow - touchedAt > 1) {
        push({ type: 'touch', mat: st.mat, v: sog, t: tNow });
        if (sog > 0.6 && !(hit && hitV > 0.15)) push({ type: 'thud', v: sog * 0.45, mat: st.mat, kind: 'keel', t: tNow });   // the keel biting into the sand: a soft thump
      }
      touchedAt = tNow; clearS = 0;
      slowS = sog < G.aground.speed ? slowS + dt : 0;
      if (st.mode !== 'aground' && slowS >= G.aground.s) { st.mode = 'aground'; push({ type: 'aground', mat: st.mat, depth: st.depth, x: s.x, z: s.z, t: tNow }); }
      else if (st.mode === 'afloat') st.mode = 'touch';
    } else {
      slowS = 0;
      if (hullClear > G.refloat.clear && keelClear > G.refloat.clear) clearS += dt; else clearS = 0;
      if (st.mode === 'aground' && clearS >= G.refloat.s) { st.mode = 'afloat'; st.kedging = false; push({ type: 'refloat', t: tNow }); }
      else if (st.mode === 'touch' && tNow - touchedAt > 0.5) st.mode = 'afloat';
    }
    st.groundedS = st.mode === 'aground' ? st.groundedS + dt : 0;
    if (!touching) st.scrape *= 0.9;
  }

  // kedge off: the crew rows the anchor out toward the deepest water within 45 m and hauls on it
  function kedge(s) {
    if (st.mode !== 'aground') return { ok: false, why: 'afloat' };
    let best = null;
    for (const r of [25, 45]) for (let a = 0; a < 16; a++) {
      const th = a * Math.PI / 8, x = s.x + Math.cos(th) * r, z = s.z + Math.sin(th) * r, d = D(x, z);
      if (!best || d > best.d) best = { d, th };
    }
    if (!(best.d > 2.4)) return { ok: false, why: 'shallow' };
    kedgeDir = [Math.cos(best.th), Math.sin(best.th)];
    st.kedging = true; st.kedgeS = 0;
    return { ok: true };
  }
  function reset() { ok = null; slowS = 0; clearS = 0; events = []; Object.assign(st, { mode: 'afloat', scrape: 0, thud: 0, groundedS: 0, kedging: false }); }
  function take() { const e = events; events = []; return e; }
  const push = (ev) => { events.push(ev); if (events.length > 40) events.shift(); };

  return { ext, post, state: st, take, kedge, reset, scan, pts, depthAt: D, grad: (x, z) => gradAt(x, z, { gx: 0, gz: 0, slope: 0 }),
    clearance(s) { const r = scan(s.x, s.z, s.heading, s.heel); return r; } };
}

// The bed's material at a point, from its slope: rock/bank over 0.40 m/m, else sand/gravel.
export function bedMaterial(depthAt, x, z, e = GROUND.gradM, rockAt = null) {
  const gx = (depthAt(x + e, z) - depthAt(x - e, z)) / (2 * e), gz = (depthAt(x, z + e) - depthAt(x, z - e)) / (2 * e);
  const m = Math.hypot(gx, gz);
  return m >= GROUND.slopeHard * 0.9 || (rockAt ? rockAt(x, z, m) : false) ? 'rock' : 'sand';
}

// ---- the lookahead (the assist's and the warnings') ----
// The track of the boat for `horizonS` seconds at its speed over ground, optionally turning from its heading to `turnTo`
// (rad) at `rate` rad/s; the keel, the bow and the sides checked against the depth with `margin` m to spare. Returns
// { tHit, x, z, mat, depth, minClear } (tHit: s to the first point with no clearance, null if none). A boat nearly
// stopped predicts nothing.
const LOOK_PTS = [[0.55, 0, 1.6], [-0.35, 0, 1.6], [-3.25, 0, 1.2], [4.3, 0, 0.1], [0, 1.6, 0.44], [0, -1.6, 0.44]];
export function predict(depthAt, s, { horizonS = 8, step = 0.25, turnTo = null, rate = 0.3, margin = 0.5, speed = null, rockAt = null, standoff = 0 } = {}) {
  const sog = speed ?? Math.hypot(s.u ?? 0, s.v ?? 0);
  if (sog < 0.25) return { tHit: null, minClear: 99 };
  let x = s.x, z = s.z, h = s.heading, minClear = 99;
  // the track direction: the course over ground until the turn takes over
  // feelers: with a standoff the boat also keeps that many metres off the bottom's edge, abeam and ahead
  const pts = standoff > 0 ? [...LOOK_PTS, [0.5, standoff, 1.6], [0.5, -standoff, 1.6], [4.3 + standoff, 0, 1.6]] : LOOK_PTS;
  const cog = s.cog ?? h, drift = Math.atan2(Math.sin(cog - h), Math.cos(cog - h));
  for (let t = 0; t <= horizonS + 1e-9; t += step) {
    for (const [px, py, d] of pts) {
      const sh = Math.sin(h), ch = Math.cos(h), qx = x + px * sh + py * ch, qz = z - px * ch + py * sh;
      const c = depthAt(qx, qz) - (d + (d > 1 ? margin : margin * 0.5));
      if (c < minClear) minClear = c;
      if (c < 0) return { tHit: t, x: qx, z: qz, mat: bedMaterial(depthAt, qx, qz, GROUND.gradM, rockAt), depth: depthAt(qx, qz), minClear };
    }
    if (turnTo != null) { const dh = Math.atan2(Math.sin(turnTo - h), Math.cos(turnTo - h)); h += clamp(dh, -rate * step, rate * step); }
    const dir = h + (turnTo != null ? 0 : drift);
    x += Math.sin(dir) * sog * step; z -= Math.cos(dir) * sog * step;
  }
  return { tHit: null, minClear };
}
