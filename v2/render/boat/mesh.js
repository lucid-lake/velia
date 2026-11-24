// The boat's meshes as plain typed arrays (M3): the hull and deck from v1's hull shape (hullShape.js, the Blender
// build's maths), the keel and rudder, the sail grids filled from v1's rig.js surfaces, the running rigging as a line
// set (a subset of v1's src/boat/lines.js: the main sheet tackle, the jib sheets, the halyards, the topping lift, the
// lazy jacks), and the standing rigging's wires (v1's spars.js). Pure: node tests build and measure them.
// Every solid comes out in one vertex format: { position, normal, color, mr, index } (v1's MeshData.arrays()).
// Frames: the hull and keel in the HULL frame (x starboard, y up from the waterline, z aft); the rig parts in the RIG
// frame (origin at the mast step: src/sim/boat/dims.js); the boom in its own frame (spars.js buildSpars).
import { gkDesc, gkClew, GK_DRAW } from './gennaker.js';   //: the gennaker's sheet and tack line
import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';
import { MeshData, solveRig, buildSpars, sparsFor, wireArrays, srgb } from '../../../src/boat/spars.js';
import { mainPoint, jibPoint, sailParams, boomPoint, jibClew, insideMain, offMast, LUFF_Z, RIG as RIG_DEFAULT } from '../../../src/boat/rig.js';
import { COCKPIT as CK, toRig } from '../../../src/boat/cockpitPoints.js';
import { hullShape, toHull } from './hullShape.js';

// the art bible's colours (blender/m1_hull.py P.colours, linear RGB) and the materials (metalness, roughness)
export const HULL_COL = Object.freeze({
  bottom: [0.0137, 0.0232, 0.0409], boot: [0.0137, 0.0307, 0.0497], topsides: [0.80, 0.785, 0.745], tide: [0.74, 0.715, 0.655],
  stripe: [0.024, 0.034, 0.109], deck: [0.80, 0.79, 0.755], nonskid: [0.672, 0.655, 0.610], window: [0.0103, 0.0152, 0.0185],
  keel: [0.0137, 0.0232, 0.0409],
});
const MR = { gelcoat: [0, 0.35], antifouling: [0, 0.7], deck: [0, 0.6], nonskid: [0, 0.85] };

// --- the hull and deck ---------------------------------------------------------------------------------------------
// Rows of the section are at the band edges, so each strip between two rows lies in one band; the strips get their own
// vertices (crisp bands) but share the smooth normals of the underlying grid (no crease at a stripe).
export function buildHull(dims = DEFAULT_DIMS, { n = 18, foils = true } = {}) {
  const S = hullShape(dims), P = S.P;
  const ys = S.stations(), cols = S.columns();
  const md = new MeshData();
  // the grid: station i, side ±1, row j → a Blender-frame point (raked at the stern)
  const grid = ys.map((y) => S.section(y, n).map(([x, z]) => [x, S.raked(y, z), z]));
  const nS = ys.length;
  // smooth normals on the shared half-grid (the mirror gives the port side)
  const N = grid.map((row) => row.map(() => [0, 0, 0]));
  const acc = (i, j, nrm) => { const a = N[i][j]; a[0] += nrm[0]; a[1] += nrm[1]; a[2] += nrm[2]; };
  for (let i = 0; i + 1 < nS; i++) for (let j = 0; j + 1 < n; j++) {
    const a = grid[i][j], b = grid[i][j + 1], c = grid[i + 1][j + 1], d = grid[i + 1][j];
    const nrm = quadNormal(a, b, c, d);
    acc(i, j, nrm); acc(i, j + 1, nrm); acc(i + 1, j + 1, nrm); acc(i + 1, j, nrm);
  }
  // (the quad's cross product points inward on this grid: negated to face out)
  for (const row of N) for (const v of row) { const l = -(Math.hypot(v[0], v[1], v[2]) || 1); v[0] /= l; v[1] /= l; v[2] /= l; }
  // the centreline's normal has no sideways part (the two halves meet there)
  for (let i = 0; i < nS; i++) N[i][0][0] = 0;
  // the band of a strip whose rows span z0..z1 under a sheer zs
  const bandOf = (z0, z1, zs) => {
    const zm = 0.5 * (z0 + z1), under = zs - zm;
    if (zm < 0.0005) return ['bottom', MR.antifouling];
    if (zm < P.bands.boot) return ['boot', MR.gelcoat];
    if (zm < P.bands.tide) return ['tide', MR.gelcoat];
    for (const [a, b] of P.bands.stripes) if (under > a - 1e-4 && under < b + 1e-4) return ['stripe', MR.gelcoat];
    return ['topsides', MR.gelcoat];
  };
  for (let i = 0; i + 1 < nS; i++) {
    for (let j = 0; j + 1 < n; j++) {
      const zs = Math.min(S.sheer(ys[i]), S.sheer(ys[i + 1]));
      const [band, mr] = bandOf(Math.min(grid[i][j][2], grid[i + 1][j][2]), Math.max(grid[i][j + 1][2], grid[i + 1][j + 1][2]), zs);
      const col = HULL_COL[band];
      for (const side of [1, -1]) {
        const V = (ii, jj) => { const p = grid[ii][jj], nn = N[ii][jj]; return md.vert(toHull([side * p[0], p[1], p[2]]), toHull([side * nn[0], nn[1], nn[2]]), col, mr); };
        const a = V(i, j), b = V(i, j + 1), c = V(i + 1, j + 1), d = V(i + 1, j);
        // Blender's quad order (a, b, c, d) is outward for side 1 in its frame; the HULL frame flips z, so the winding
        // flips once; the port mirror flips it again
        if (side === 1) { md.tri(a, c, b); md.tri(a, d, c); } else { md.tri(a, b, c); md.tri(a, c, d); }
      }
    }
  }
  const hullTriangles = md.triangleCount;
  // the deck: stations × columns; non-skid on the side decks and the sole, the trunk top and seats smooth gelcoat
  const [sIn, sOut] = P.trunkS, [c0, c1] = P.cockpit;
  const dgrid = ys.map((y) => cols.map((s) => [s * S.halfBeamSheer(y), S.raked(y, S.deck(y, s)), S.deck(y, s)]));
  const DN = dgrid.map((row) => row.map(() => [0, 0, 0]));
  const dacc = (i, k, nrm) => { const a = DN[i][k]; a[0] += nrm[0]; a[1] += nrm[1]; a[2] += nrm[2]; };
  for (let i = 0; i + 1 < nS; i++) for (let k = 0; k + 1 < cols.length; k++) {
    const nrm = quadNormal(dgrid[i][k], dgrid[i][k + 1], dgrid[i + 1][k + 1], dgrid[i + 1][k]);
    dacc(i, k, nrm); dacc(i, k + 1, nrm); dacc(i + 1, k + 1, nrm); dacc(i + 1, k, nrm);
  }
  for (const row of DN) for (const v of row) { const l = Math.hypot(v[0], v[1], v[2]) || 1; v[0] /= l; v[1] /= l; v[2] /= l; }
  for (let i = 0; i < nS; i++) DN[i][0][0] = 0;
  const deckMat = (y, s) => {
    const sole = y < c1 && s < (y < P.cockpitT ? P.wellAft : P.wellFwd) - 0.01;
    const sideDeck = y >= c1 && s > sOut + 0.03 && s < 0.93;
    const foredeck = y > P.trunk[1] && s < 0.93;
    return sole || sideDeck || foredeck ? [HULL_COL.nonskid, MR.nonskid] : [HULL_COL.deck, MR.deck];
  };
  for (let i = 0; i + 1 < nS; i++) for (let k = 0; k + 1 < cols.length; k++) {
    const [col, mr] = deckMat(0.5 * (ys[i] + ys[i + 1]), 0.5 * (cols[k] + cols[k + 1]));
    for (const side of [1, -1]) {
      const V = (ii, kk) => { const p = dgrid[ii][kk], nn = DN[ii][kk]; return md.vert(toHull([side * p[0], p[1], p[2]]), toHull([side * nn[0], nn[1], nn[2]]), col, mr); };
      const a = V(i, k), b = V(i, k + 1), c = V(i + 1, k + 1), d = V(i + 1, k);
      if (side === 1) { md.tri(a, b, c); md.tri(a, c, d); } else { md.tri(a, c, b); md.tri(a, d, c); }
    }
  }
  // the transom: the aft station's loop (hull section up, deck row across, the other side down), fanned from its centroid
  {
    const i = 0, hull = grid[i], deck = dgrid[i];
    const loop = [];
    for (let j = 0; j < n; j++) loop.push([hull[j][0], hull[j][1], hull[j][2]]);
    for (let k = cols.length - 2; k >= 0; k--) loop.push([deck[k][0], deck[k][1], deck[k][2]]);
    for (let k = 1; k < cols.length; k++) loop.push([-deck[k][0], deck[k][1], deck[k][2]]);
    for (let j = n - 1; j >= 1; j--) loop.push([-hull[j][0], hull[j][1], hull[j][2]]);
    const cen = [0, 0, 0]; for (const p of loop) { cen[0] += p[0] / loop.length; cen[1] += p[1] / loop.length; cen[2] += p[2] / loop.length; }
    const nrm = toHull([0, -1, 0.3]); const l = Math.hypot(...nrm); nrm[0] /= l; nrm[1] /= l; nrm[2] /= l;   // aft, tilted up a little with the rake
    const c0i = md.vert(toHull(cen), nrm, HULL_COL.topsides, MR.gelcoat);
    const ids = loop.map((p) => md.vert(toHull(p), nrm, p[2] < 0.0005 ? HULL_COL.bottom : p[2] < P.bands.boot ? HULL_COL.boot : HULL_COL.topsides, MR.gelcoat));
    for (let k = 0; k < ids.length; k++) md.tri(c0i, ids[(k + 1) % ids.length], ids[k]);
  }
  const deckTriangles = md.triangleCount - hullTriangles;
  // the fin keel and the spade rudder (dims.js: draft 1.60 m; the keel root at the canoe body under the mast, the rudder at rudderZ)
  if (foils) { keelFoil(md, dims); rudderFoil(md, dims); }
  const a = md.arrays();
  return { ...a, triangles: md.triangleCount, parts: { hull: hullTriangles, deck: deckTriangles, foils: md.triangleCount - hullTriangles - deckTriangles } };
}

const keelFoil = (md, dims) => foil(md, { x: 0, zc: -0.44 + 0.2, y0: -0.42, y1: -dims.HULL.draft, chord0: 1.45, chord1: 1.05, thick: 0.13, rake: 0.35 }, HULL_COL.keel, MR.antifouling);
const rudderFoil = (md, dims) => foil(md, { x: 0, zc: dims.HULL.rudderZ, y0: -0.08, y1: -1.30, chord0: 0.46, chord1: 0.36, thick: 0.07, rake: 0.08 }, HULL_COL.keel, MR.antifouling);
// M3b: the fin keel and the spade rudder on their own (v1's hull GLB is the canoe body only; v1 draws its keel and rudder
// as stand-ins under the water): the keel stays with the hull, the rudder turns about its stock (HULL rudderZ)
export function buildFoils(dims = DEFAULT_DIMS) {
  const k = new MeshData(); keelFoil(k, dims);
  const r = new MeshData(); rudderFoil(r, dims);
  return { keel: { ...k.arrays(), triangles: k.triangleCount }, rudder: { ...r.arrays(), triangles: r.triangleCount } };
}

const quadNormal = (a, b, c, d) => {
  const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - b[0], vy = d[1] - b[1], vz = d[2] - b[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
};

// an aerofoil (a NACA-like section) swept from the root at y0 to the tip at y1, the tip raked aft by `rake` m
function foil(md, { x, zc, y0, y1, chord0, chord1, thick, rake }, col, mr, k = 14) {
  const prof = [];   // the section round the chord: [u along the chord 0..1, v thickness ±], a closed loop
  for (let i = 0; i < k; i++) { const t = (i / k) * 2 * Math.PI, u = 0.5 - 0.5 * Math.cos(t), s = Math.sin(t); prof.push([u, s * 0.5 * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1015 * u ** 4) / 0.1]); }
  const rings = [[y0, chord0, 0], [0.5 * (y0 + y1), 0.5 * (chord0 + chord1), rake * 0.5], [y1, chord1, rake]];
  const base = [];
  for (const [y, ch, dz] of rings) {
    const b0 = md.vertexCount;
    for (const [u, v] of prof) {
      const px = x + v * thick, pz = zc + dz + (u - 0.5) * ch;
      const nx = v >= 0 ? 1 : -1;   // a flat-sided normal: the thin foil reads as a dark plate under the water
      md.vert([px, y, pz], [nx * 0.9, 0, (u - 0.5) * 0.4], col, mr);
    }
    base.push(b0);
  }
  for (let r = 0; r + 1 < rings.length; r++) for (let j = 0; j < k; j++) {
    const a = base[r] + j, b = base[r] + (j + 1) % k, c = base[r + 1] + (j + 1) % k, d = base[r + 1] + j;
    md.tri(a, b, c); md.tri(a, c, d);
  }
  // the tip cap
  const c = md.vert([x, y1, zc + rake], [0, -1, 0], col, mr), b0 = base[rings.length - 1];
  for (let j = 0; j < k; j++) md.tri(c, b0 + (j + 1) % k, b0 + j);
}

// --- the spars (v1's, as they are) ------------------------------------------------------------------------------------
export function buildRigParts(dims = DEFAULT_DIMS) {
  const rig = solveRig(sparsFor(dims)), g = buildSpars(rig);
  return { rig, mast: { ...g.mast.arrays(), triangles: g.mast.triangleCount }, boom: { ...g.boom.arrays(), triangles: g.boom.triangleCount }, wires: g.wires, furler: g.furler };
}

// --- the sails: a (nu + 1) × (nv + 1) grid, its steady shape from rig.js, filled when the trim changes ---------------
export function sailGrid(nu, nv) {
  const n = (nu + 1) * (nv + 1);
  const uv = new Float32Array(n * 2);
  for (let j = 0, k = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) { uv[2 * k] = i / nu; uv[2 * k + 1] = j / nv; }
  const index = new Uint16Array(nu * nv * 6);
  for (let j = 0, o = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    index[o++] = a; index[o++] = b; index[o++] = d; index[o++] = a; index[o++] = d; index[o++] = c;
  }
  return { nu, nv, n, uv, index, position: new Float32Array(n * 3), normal: new Float32Array(n * 3), metric: new Float32Array(n * 2), flatN: new Float32Array(n * 3), tanU: new Float32Array(n * 3), triangles: nu * nv * 2 };
}

const PA = [0, 0, 0], PB = [0, 0, 0];
// v1's sails.js fill(): positions, the metric coordinates (metres along the chord, up the luff), normals by central
// differences, the flat chord's normal per row; → the hoisted luff length (m)
export function fillSail(g, pointFn, s) {
  const { nu, nv, position: pos, metric: met, normal: nrm, flatN: fln, tanU: tan } = g, W = nu + 1;
  const tackP = pointFn(0, 0, s, null, PA), headP = pointFn(0, 1, s, null, PB);
  const luffLen = Math.hypot(headP[0] - tackP[0], headP[1] - tackP[1], headP[2] - tackP[2]);
  for (let j = 0, k = 0; j <= nv; j++) {
    const v = j / nv;
    let along = 0, px = 0, py = 0, pz = 0;
    for (let i = 0; i <= nu; i++, k++) {
      const p = pointFn(i / nu, v, s, null, PA);
      if (i > 0) along += Math.hypot(p[0] - px, p[1] - py, p[2] - pz);
      px = p[0]; py = p[1]; pz = p[2];
      pos[3 * k] = p[0]; pos[3 * k + 1] = p[1]; pos[3 * k + 2] = p[2];
      met[2 * k] = along; met[2 * k + 1] = v * luffLen;
    }
  }
  for (let j = 0; j <= nv; j++) {
    const a = 3 * (j * W), b = 3 * (j * W + nu), c = 3 * (Math.min(j + 1, nv) * W), d = 3 * (Math.max(j - 1, 0) * W);
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[d], vy = pos[c + 1] - pos[d + 1], vz = pos[c + 2] - pos[d + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    for (let i = 0; i <= nu; i++) { const k = 3 * (j * W + i); fln[k] = nx / l; fln[k + 1] = ny / l; fln[k + 2] = nz / l; }
  }
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const k = j * W + i;
    const a = 3 * (j * W + Math.min(i + 1, nu)), b = 3 * (j * W + Math.max(i - 1, 0));
    const c = 3 * (Math.min(j + 1, nv) * W + i), d = 3 * (Math.max(j - 1, 0) * W + i);
    const ux = pos[a] - pos[b], uy = pos[a + 1] - pos[b + 1], uz = pos[a + 2] - pos[b + 2];
    const vx = pos[c] - pos[d], vy = pos[c + 1] - pos[d + 1], vz = pos[c + 2] - pos[d + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nrm[3 * k] = nx / l; nrm[3 * k + 1] = ny / l; nrm[3 * k + 2] = nz / l;
    // M3b: v1's tangentU (sails.js fill): along the chord, for the weave, the crinkles and the flutter's slope
    const lu = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    if (tan) { tan[3 * k] = ux / lu; tan[3 * k + 1] = uy / lu; tan[3 * k + 2] = uz / lu; }
  }
  return luffLen;
}
export const SAIL_GRIDS = Object.freeze({ main: [40, 64], jib: [32, 56] });   // v1's
export { mainPoint, jibPoint, sailParams };

// --- the running rigging: a subset of v1's lineSet (lines.js), RIG frame --------------------------------------------
const SEGS = 24;
const HULL = DEFAULT_DIMS.HULL, RIG = RIG_DEFAULT;
const CABIN = 0, SIDE = HULL.sideDeckY - HULL.mastStepY;
const DECKPTS = {
  traveller: (x) => toRig([x, HULL.mastStepY + 0.04 + 0.10, CK.traveller[2]]),
  jibCar: (sx, lead = 0) => [sx * 1.22, SIDE + 0.04, 0.55 + 0.3 * lead],   // pro: the lead's car, ± 0.3 m along the track (+ aft; v1's lines.js)
  winch: (sx) => toRig(CK.winch(sx)),
  halyardWinch: (sx) => toRig(CK.halyardWinch(sx)),
  clutch: (sx, k) => toRig(CK.clutches(sx)[k]),
  organiser: (sx, k) => toRig(CK.organiser(sx)[k]),
  mastBlock: (sx, k) => toRig(CK.mastBlocks(sx)[k]),
};
const RIGPTS = solveRig(sparsFor(DEFAULT_DIMS));
export function sag(a, b, slack, n = SEGS, floor = SIDE + 0.02) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), d = L * Math.sqrt(3 * Math.max(slack, 0) / 8), out = [];
  for (let i = 0; i < n; i++) { const f = i / (n - 1), y = a[1] + (b[1] - a[1]) * f - 4 * d * f * (1 - f); out.push([a[0] + (b[0] - a[0]) * f, Math.max(y, floor), a[2] + (b[2] - a[2]) * f]); }
  return out;
}
const legs = (pts, slacks, floor) => pts.slice(1).flatMap((p, i) => sag(pts[i], p, slacks[i] ?? 0, Math.max(4, Math.round(SEGS / (pts.length - 1))), floor).slice(i ? 1 : 0));
// pro: trav −1 … +1 (state.traveller; + up to windward) moves the car up to 0.35 m off the boom's block, to windward or leeward (v1's lines.js)
export const travellerCarX = (boomRad, trav = 0) => Math.max(-0.58, Math.min(0.58, boomPoint(boomRad, DECKPTS.traveller(0)[2] - 0.12)[0] * 0.6 - (Math.sign(boomRad) || 1) * 0.35 * trav));
const ROPE = { sheet: srgb(0xe8e4da), mainHal: srgb(0x4a5a70), jibHal: srgb(0x6b7a5a), jack: srgb(0x3a3f45) };

// the line set for one physics state: [{ name, points, diameterM, color }], RIG frame
export function lineSet(state, t = 0) {
  const p = sailParams(state), out = [];
  const blk = boomPoint(p.main.boomRad, RIGPTS.points.bails.mainsheet); blk[1] -= 0.16;
  const car = DECKPTS.traveller(travellerCarX(p.main.boomRad, p.main.trav ?? 0));
  const eased = Math.min(1, Math.abs(p.main.boomRad) / 1.1);
  for (let k = 0; k < 4; k++) {
    const o = (k - 1.5) * 0.018;
    out.push({ name: `mainsheet-${k}`, points: sag([blk[0] + o, blk[1], blk[2]], [car[0] + o, car[1], car[2]], 0.002 + 0.012 * eased + 0.006 * (1 - p.main.fill), 10, CABIN), diameterM: 0.010, color: ROPE.sheet });
  }
  const clew = jibClew(p.jib, t), work = Math.sign(p.jib.sheetRad) || -1;
  out.push({ name: 'jibsheet-working', points: legs([clew, DECKPTS.jibCar(work, p.jib.lead ?? 0), DECKPTS.winch(work)], [0.003 + 0.012 * (1 - p.jib.fill), 0.01]), diameterM: 0.010, color: ROPE.sheet });
  const lazy = legs([clew, [0, CABIN + 0.04, -0.3], [-work * 0.45, CABIN + 0.03, 0.4], DECKPTS.jibCar(-work), DECKPTS.winch(-work)], [0.04, 0.02, 0.03, 0.02], CABIN)
    .map((q, i, arr) => (i === 0 || i === arr.length - 1 ? q : [q[0], Math.max(q[1], Math.abs(q[0]) > 0.9 ? SIDE + 0.02 : CABIN + 0.02), q[2]]));
  out.push({ name: 'jibsheet-lazy', points: lazy, diameterM: 0.010, color: ROPE.sheet });
  const mh = mainPoint(0, 1, p.main);
  const halyard = (name, top, sx, k, color) => {
    const exit = [sx * 0.03, CABIN + 0.32, LUFF_Z + 0.01], w = DECKPTS.halyardWinch(sx), wIn = [w[0] - sx * 0.07, w[1] + 0.02, w[2] - 0.02];
    out.push({ name, points: [...sag(top, exit, 0.0005, SEGS, -0.25), ...legs([exit, DECKPTS.mastBlock(sx, k), DECKPTS.organiser(sx, k), DECKPTS.clutch(sx, k), wIn], [0.005, 0.004, 0.003, 0.004], -0.25).slice(1)], diameterM: 0.009, color });
  };
  halyard('main-halyard', [0.03, mh[1] + 0.15, LUFF_Z + 0.01], 1, 0, ROPE.mainHal);
  halyard('jib-halyard', [-0.03, RIG.head[1] + 0.1, LUFF_Z + 0.01], -1, 0, ROPE.jibHal);
  //: the gennaker's sheet (the clew → a block on the quarter → the cockpit winch on its side) and its tack line, while it is up
  const gd = gkDesc(state);
  if (gd && gd.deploy > 0.05) {
    const gc = gkClew(gd), gs = Math.sign(gd.side) || 1, blkQ = [gs * 1.42, SIDE + 0.12, 3.95];
    out.push({ name: 'gennaker-sheet', points: legs([gc, blkQ, DECKPTS.winch(gs)], [0.004 + 0.03 * (1 - gd.fill), 0.01]), diameterM: 0.010, color: ROPE.sheet });
    out.push({ name: 'gennaker-tack', points: sag(GK_DRAW.tack, [0, GK_DRAW.tack[1] - 0.2, GK_DRAW.tack[2] + 0.35], 0.002, 6, -1), diameterM: 0.010, color: ROPE.jack });
  }
  out.push({ name: 'topping-lift', points: sag([0, RIG.mastTop - 0.05, LUFF_Z + 0.05], boomPoint(p.main.boomRad, RIG.boom - 0.05), 0.004, SEGS, CABIN), diameterM: 0.006, color: ROPE.sheet });
  // held inside the main's belly off the mast (rig.js insideMain: the leeward ones ran into the cloth ≈ 0.2 m aft of it)
  // (the first leg gets points 2–12 cm off the mast, so the one crossing stays at the luff groove, inside the mast's width)
  const jack = (pts) => offMast(pts).map((q, i) => (i < 1 ? q : insideMain(q.slice(), p.main, 0.02)));
  for (const sx of [1, -1]) {   // the lazy jacks: from the mast under the lower spreaders down to the boom (the bag's top edge)
    const m0 = [sx * 0.06, RIG.spreaders[0].y - 0.15, 0.04], m1 = [sx * 0.06, RIG.spreaders[0].y - 0.65, 0.05];
    const bag = [0.95, 1.95, 2.80].map((zj) => boomPointSide(p.main.boomRad, zj, sx * 0.14, 0.12));
    out.push({ name: `lazyjack-${sx > 0 ? 'S' : 'P'}-a`, points: jack(legs([m0, bag[1], bag[2]], [0.002, 0.004], CABIN)), diameterM: 0.005, color: ROPE.jack });
    out.push({ name: `lazyjack-${sx > 0 ? 'S' : 'P'}-c`, points: jack(legs([m1, bag[0]], [0.004], CABIN)), diameterM: 0.005, color: ROPE.jack });
  }
  out.push(...reefBundle(p.main));
  return out;
}
// The tied-in reef (owner, 2026-11-16: the reef must read on the boom, the main up or down): the reefed cloth flaked along the
// boom as a cream roll cresting the lazy bag's open top (inside the bag it would never show), its girth by the reefs (0.15 m with one, 0.20 m with two; thicker than v1's
// sails.js reef-bundle so it reads from the cockpit), with the reef points tied round it, the bag and the boom every 0.40 m; the same with the main up or down.
// Nothing without a reef. RIG frame, ribbons.
export const REEF_ROLL = Object.freeze({ from: 0.45, end: 0.9, base: 0.1, perReef: 0.05, tieEvery: 0.4, tie: 0.014, y: 0.27 });   // y: the roll's axis over the boom's, m: cresting the open lazy bag's top edge (src/boat/spars-detail.js BAG: up to 0.30 m over the boom's top)
export function reefBundle(main) {
  const rf = main.reef ?? 0; if (rf <= 0.02) return [];
  const R = REEF_ROLL, d = R.base + R.perReef * Math.min(2, rf), a = main.boomRad ?? 0, L = RIG.boom * R.end, y = R.y + d * 0.25;
  // the roll as two strands either side of the cloth's plane (a ribbon faces the camera: one strand centred on the plane
  // would sit in the lowered cloth seen from the beam and vanish)
  const rolls = [-1, 1].map(() => []), ties = [];
  for (let z = R.from; z <= L + 1e-6; z += (L - R.from) / 10) [-1, 1].forEach((sx, i) => rolls[i].push(boomPointSide(a, z, sx * d * 0.3, y)));
  // the reef points: a tie round the bundle, the bag and the boom every 0.40 m (seen from the cockpit below the boom, where the
  // bag hides the roll): a cream line over the navy bag. The ring's points: over the roll, down the bag's sides, under the boom
  const ring = [[-0.02, y + d * 0.5], [-0.12, R.y - 0.02], [-0.2, 0.17], [-0.07, -0.05], [0, -0.085], [0.07, -0.05], [0.2, 0.17], [0.12, R.y - 0.02], [0.02, y + d * 0.5]];
  for (let z = R.from + R.tieEvery / 2, k = 0; z < L; z += R.tieEvery, k++)
    ties.push({ name: `reef-tie-${k}`, points: [...ring, ring[0]].map(([dx, dy]) => boomPointSide(a, z, dx, dy)), diameterM: R.tie, color: ROPE.sheet });
  return [...rolls.map((points, i) => ({ name: `reef-bundle-${i ? 'S' : 'P'}`, points, diameterM: d * 0.8, color: REEF_CLOTH })), ...ties];
}
const REEF_CLOTH = srgb(0xe9e3d3);   // the cloth's cream, a shade under the hoisted panel in the sun
const boomPointSide = (rad, along, dx, dy) => { const b = boomPoint(rad, along); return [b[0] + dx * Math.cos(rad), b[1] + dy, b[2] - dx * Math.sin(rad)]; };

// --- ribbons: lines and wires in one vertex format ------------------------------------------------------------------
// per point two vertices: position, the neighbour along the line (other), side ±1, the diameter (m), the colour.
// The vertex shader widens each ribbon to at least one pixel and fades it by its true coverage (v1's lines.js).
export function ribbonArrays(maxPoints) {
  const n = maxPoints * 2;
  return { max: maxPoints, position: new Float32Array(n * 3), other: new Float32Array(n * 3), side: new Float32Array(n), diam: new Float32Array(n), color: new Float32Array(n * 3), index: new Uint32Array(maxPoints * 6), points: 0, indices: 0 };
}
// fill from a line set; → the index count to draw
export function fillRibbons(R, lines) {
  const { position: pos, other: oth, side, diam, color: col, index: idx } = R;
  let v = 0, ii = 0;
  for (const line of lines) {
    const pts = line.points;
    if (v / 2 + pts.length > R.max) break;
    for (let i = 0; i < pts.length; i++) {
      const last = i === pts.length - 1, q = last ? pts[i - 1] : pts[i + 1];
      for (const s of [1, -1]) {
        pos[v * 3] = pts[i][0]; pos[v * 3 + 1] = pts[i][1]; pos[v * 3 + 2] = pts[i][2];
        oth[v * 3] = q[0]; oth[v * 3 + 1] = q[1]; oth[v * 3 + 2] = q[2];
        side[v] = last ? -s : s; diam[v] = line.diams ? line.diams[i] : line.diameterM;   // #20: a line may taper (diams: one a point)
        col[v * 3] = line.color[0]; col[v * 3 + 1] = line.color[1]; col[v * 3 + 2] = line.color[2];
        v++;
      }
      if (i < pts.length - 1) { const a = v - 2, b = v - 1, c = v, d = v + 1; idx[ii++] = a; idx[ii++] = b; idx[ii++] = d; idx[ii++] = a; idx[ii++] = d; idx[ii++] = c; }
    }
  }
  R.points = v / 2; R.indices = ii;
  return ii;
}
// the standing rigging as two-point lines (the wire list from spars.js: steel, the antenna black)
export function wireLines(wires) {
  const col = { steel: srgb(0xC8CACC), black: [0.02, 0.02, 0.02] };
  return wires.map((w) => ({ name: w.name, points: [w.a, w.b], diameterM: 2 * w.r, color: col[w.kind] ?? col.steel }));
}
export { wireArrays };
