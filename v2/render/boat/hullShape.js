// The sloop's hull and deck shape (M3), ported from v1's Blender build (blender/m1_hull.py: the lines, the sections,
// the deck surface) so v2's procedural hull reads as the same boat as v1's hull.glb. Pure maths: node tests it.
// Frames: the Blender script works in (x starboard, y FORWARD, z up); the game's HULL frame (src/sim/boat/dims.js) is
// (x starboard, y up, z AFT). The functions below keep the script's station coordinate `y` (forward +) so each line is
// a transliteration; `toHull([x, y, z])` turns a point into the HULL frame: [x, z, -y].
//   const S = hullShape(dims);  S.sheer(y), S.halfBeamSheer(y), S.keel(y), S.section(y, 18), S.deck(y, s), S.stations()
import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (t) => t * t * (3 - 2 * t);

// the shape parameters: dims.js where it has a number, the script's own where it has not (m1_hull.py P)
export function hullParams(dims = DEFAULT_DIMS) {
  const { HULL } = dims;
  const LOA = HULL.loa, LWL = HULL.lwl, BEAM = HULL.beam, FB = HULL.freeboard;
  const yStem = LWL / 2 + 0.66;
  return Object.freeze({
    LOA, LWL, BEAM,
    yStem, yTransom: yStem - LOA,           // the bow overhang 0.66 m; the stern takes the rest
    beamSheer: BEAM, beamWl: BEAM * 0.86,
    yMaxBeam: -1.0, depth: 0.50, yForefoot: 2.0, yWlBow: LWL / 2,
    sheerMin: FB - 0.02, ySheerMin: -0.9, sheerBow: FB + 0.12, sheerStern: FB + 0.02,
    sternWidth: 0.92, transomRake: 0.30, camber: 0.05, bilgeN: 2.5, planK: 1.6,
    cockpit: [-HULL.transomZ + 0.20, -1.40], cockpitT: -1.95, wellAft: 0.66, wellFwd: 0.46, wellWall: 0.04,
    sole: 0.48, walkthrough: 0.20, walkSlope: 0.22, seatH: 0.40,
    trunk: [-1.40, 2.60], trunkFront: 0.90, trunkH: 0.40, trunkS: [0.40, 0.57], trunkCrown: 1.8, aftFaceRun: 0.17,
    corner: 0.42, cornerIn: 0.20,
    bands: { boot: 0.11, tide: 0.16, stripes: [[0.180, 0.202], [0.238, 0.260]] },
    stations: 56,
  });
}

export function hullShape(dims = DEFAULT_DIMS) {
  const P = hullParams(dims);
  const sheer = (y) => {
    if (y < P.ySheerMin) { const u = (P.ySheerMin - y) / (P.ySheerMin - P.yTransom); return P.sheerMin + (P.sheerStern - P.sheerMin) * u * u; }
    const u = (y - P.ySheerMin) / (P.yStem - P.ySheerMin);
    return P.sheerMin + (P.sheerBow - P.sheerMin) * u * u;
  };
  // the rounded stern quarter in plan: 0 forward of the corner, up to cornerIn at the transom (a quarter ellipse)
  const cornerInset = (y) => { const u = (P.yTransom + P.corner - y) / P.corner; return u <= 0 ? 0 : P.cornerIn * (1 - Math.sqrt(Math.max(0, 1 - Math.min(u, 1) ** 2))); };
  const halfBeamSheer = (y) => {
    const B = P.beamSheer / 2, y0 = P.yMaxBeam;
    if (y >= y0) { const u = (y - y0) / (P.yStem - y0); return Math.max(0.004, B * Math.max(0, 1 - u ** P.planK) ** 0.95); }
    const u = (y0 - y) / (y0 - P.yTransom);
    return B * (1 - (1 - P.sternWidth) * u * u) - cornerInset(y);
  };
  const halfBeamWl = (y) => {
    const B = P.beamWl / 2, y0 = P.yMaxBeam + 0.25;
    if (y >= y0) { const u = (y - y0) / (P.yWlBow - y0); return B * Math.max(0, 1 - u ** P.planK) ** 0.9; }
    const u = (y0 - y) / (y0 - P.yTransom);
    return B * (1 - 0.30 * u * u) - 0.8 * cornerInset(y);
  };
  // the canoe body's centreline: a round forefoot into the raked stem; the run lifts to clear the water aft
  const keel = (y) => {
    const D = P.depth, yf = P.yForefoot, ys = P.yStem, yw = P.yWlBow;
    if (y > yw) return sheer(ys) * (y - yw) / (ys - yw);
    if (y > yf) { const u = (y - yf) / (yw - yf); return -D * Math.sqrt(Math.max(0, 1 - u * u)); }
    const y0 = -0.6, yWa = -P.LWL / 2;
    if (y < y0) { const k = 1.5, lift = D / (((y0 - yWa) / (y0 - P.yTransom)) ** k) - D; return -D + (D + lift) * ((y0 - y) / (y0 - P.yTransom)) ** k; }
    return -D + 0.03 * ((y - y0) / (yf - y0)) ** 2;
  };
  // section heights from z0 up to the sheer, with rows at the band and stripe edges (so colours change on edges)
  const upperHeights = (zs, z0) => {
    const [[a1, a2], [c1, c2]] = P.bands.stripes;
    const hs = [zs - c2, zs - c1, zs - a2, zs - a1, zs];
    const mids = [P.bands.boot, P.bands.tide, 0.30, 0.50].filter((h) => z0 + 0.01 < h && h < hs[0] - 0.02);
    return [...mids, ...hs];
  };
  // half-section points [x ≥ 0, z up] from the centreline to the sheer; always n points
  const section = (y, n = 18) => {
    const zb = keel(y), zs = sheer(y), bs = halfBeamSheer(y), bw = halfBeamWl(y), sn = P.bilgeN;
    const flare = (z) => bw + (bs - bw) * (Math.max(z, 0) / zs) ** 0.7;
    if (zb < 0 && bw > 0.01) {
      const up = upperHeights(zs, 0), nLow = n - up.length, pts = [];
      for (let i = 0; i < nLow; i++) { const th = (i / (nLow - 1)) * Math.PI / 2; pts.push([bw * Math.sin(th) ** (2 / sn), zb * Math.cos(th) ** (2 / sn)]); }
      for (const z of up) pts.push([flare(z), z]);
      return pts;
    }
    // above the waterline only (the stem, the lifted run): a superellipse from the centreline to the sheer
    let up = upperHeights(zs, zb).filter((h) => h > zb + 0.02); if (!up.length) up = [zs];
    const nLow = n - up.length, zl = [];
    for (let i = 0; i < nLow; i++) zl.push(zb + (up[0] - zb) * (i / nLow));
    const pts = [];
    for (const z of [...zl, ...up]) {
      const t = clamp01((z - zb) / Math.max(zs - zb, 1e-4)), c = (1 - t) ** (sn / 2), th = Math.acos(Math.min(1, c));
      pts.push([bs * Math.sin(th) ** (2 / sn), z]);
    }
    return pts;
  };
  const wellIn = (y) => (y < P.cockpitT ? P.wellAft : P.wellFwd);
  // deck height at station y and fraction s of the half-beam (0 centreline, 1 sheer)
  const deck = (y, s) => {
    const bs = halfBeamSheer(y);
    let z = sheer(y) + P.camber * (1 - s * s) * bs;
    const [c0, c1] = P.cockpit, [t0, t1] = P.trunk;
    if (y < c0) {   // aft of the well: corner seats either side of the walk-through, at seat height, its edges sloped
      z = Math.min(z, P.sole + P.seatH);
      const side = clamp01((P.walkthrough + P.walkSlope - s) / P.walkSlope);
      return z + (P.sole - z) * smooth(side);
    }
    if (y < c1) { const w = wellIn(y), side = clamp01((w + P.wellWall - s) / P.wellWall); return z + (P.sole - z) * side; }   // the T-shaped well
    const [sIn, sOut] = P.trunkS;
    if (y <= t1) {   // the trunk, sloping down into the foredeck
      const side = clamp01((sOut - s) / (sOut - sIn)), f = clamp01((t1 - y) / (t1 - P.trunkFront)), front = smooth(f);
      const top = sheer(y) + P.trunkH + P.camber * P.trunkCrown * (s < sIn ? 1 - (s / sIn) ** 2 : 0) * bs;
      z = z + (top - z) * side * front;
      const run = P.aftFaceRun;
      if (y < t0 + run && s < P.wellFwd + P.wellWall) z = P.sole + (z - P.sole) * (y - t0) / run;   // the companionway face, sloped ≈ 10°
      return z;
    }
    return z;
  };
  // the stations: cosine-spaced plus the breakpoints (the cockpit, the trunk, the quarters), sorted, 1.5 mm apart at least
  const stations = (n = P.stations) => {
    const e = 0.005, [c0, c1] = P.cockpit, [t0, t1] = P.trunk;
    const ys = new Set([P.yTransom, P.yStem, c0 - e, c0, c1 - e, c1, c1 + P.aftFaceRun / 2, c1 + P.aftFaceRun, P.cockpitT - e, P.cockpitT, P.trunkFront, t1, t0 + P.aftFaceRun]);
    for (const f of [0.04, 0.12, 0.25, 0.45, 0.7]) ys.add(P.yTransom + P.corner * f);
    for (let i = 0; i < n; i++) { const t = i / (n - 1); ys.add(P.yTransom + (P.yStem - P.yTransom) * (0.5 - 0.5 * Math.cos(Math.PI * t))); }
    const out = [];
    for (const y of [...ys].sort((a, b) => a - b)) if (!out.length || y - out[out.length - 1] > 0.0015) out.push(y);
    return out;
  };
  // the deck columns (fractions of the half-beam), the script's set thinned
  const columns = () => {
    const [sIn, sOut] = P.trunkS, ww = P.wellWall, w = P.walkthrough;
    const cs = new Set([0, 0.08, w, ...[0.15, 0.32, 0.5, 0.68, 0.85, 1.0].map((f) => w + P.walkSlope * f), 0.32, 0.40, P.wellFwd, P.wellFwd + ww, sIn, sIn + 0.25 * (sOut - sIn), sIn + 0.75 * (sOut - sIn), sOut, 0.62, P.wellAft, P.wellAft + ww, 0.76, 0.84, 0.90, 0.94, 0.97, 1.0]);
    const out = [];
    for (const c of [...cs].sort((a, b) => a - b)) if (!out.length || c - out[out.length - 1] > 0.003) out.push(c);
    return out;
  };
  // the transom's reverse rake: a point's station moves aft by rake × (the stern sheer − its height) over the last 0.6 m
  const raked = (y, z, length = 0.6) => { const u = clamp01((P.yTransom + length - y) / length); return y - P.transomRake * Math.max(0, sheer(y) - z) * smooth(u); };
  return { P, sheer, halfBeamSheer, halfBeamWl, keel, section, deck, stations, columns, raked, cornerInset };
}

// a Blender-frame point [x, y forward, z up] → the HULL frame [x, y up, z aft]
export const toHull = (p) => [p[0], p[2], -p[1]];
