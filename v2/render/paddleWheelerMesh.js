// The paddle-wheeler's meshes (v2/sim/paddleWheeler.js), all by code: a generic, unnamed 46 m stern-wheel excursion boat. Pure: plain
// arrays, no GPU (the tests and render/paddleWheeler.js build them once). Three LODs in one vertex set, each drawn in one call:
//   near  (a desktop within LOD_M.near): the hull lofted through 40 stations with her sheer, the guards, three decks with their cabins and
//         window bands, every railing as posts and two rails, the pilothouse and its wings, twin stacks with flared crowns, the mast,
//         the stern flag on its staff, the wheel's beams and bearings, and the wheel itself (16 buckets, three rims and spoke rings)
//   mid   the same massing coarser; the railings as one band each (the posts and rails cut by the shader), the wheel's buckets and rims
//   far   a few hundred triangles: the hull, the deck blocks with their window bands, the stacks and a drum for the wheel
// No name, no livery, no marks: white with a dark-red boot top and wheel, navy rub strakes, a plain navy-and-cream flag.
// Frame (every boat's): x starboard, y up from her waterline, z aft (the bow at −z), metres. The wheel's vertices are built where they
// sit; their slots (>= SLOT.wheel) turn them about the axle (PADDLE.wheel: x through (y, z)) in the vertex shader by her wheel angle.
// A vertex: position (3), normal (3), the material slot (1) (the glass boat's layout: render/tourBoatMesh.js VF).
import { builder, VF } from './tourBoatMesh.js';
import { PADDLE } from '../sim/paddleWheeler.js';

export { VF };
export const SLOT = Object.freeze({ hull: 0, deck: 1, cabin: 2, window: 3, rail: 4, railBand: 5, dark: 6, stack: 7, under: 8, flag: 9,
  lensW: 10, lensR: 11, lensG: 12, guard: 13, wheel: 20, wheelDark: 21 });
export const LOD_M = Object.freeze({ near: 330, mid: 1500, hyst: 0.06 });   // m: the near LOD within near, mid within mid, far beyond
export const DRAW_M = Object.freeze({ full: 7000, lite: 3500 });            // m: drawn this far (lite: a phone or a weak GPU)

// her massing (m, her frame)
const W = PADDLE.wheel;
export const SHAPE = Object.freeze({
  sheerMid: 1.72, sheerBow: 2.75, sheerStern: 1.95,
  guard: Object.freeze({ a: 5.0, b: 15.4, zc: 0.6, e: 5, y0: 1.6, y1: 1.9 }),
  cabin1: Object.freeze({ a: 4.55, b: 13.6, zc: 0.9, e: 6, y0: 1.9, y1: 4.45, win: Object.freeze([2.55, 3.65]) }),
  deck2: Object.freeze({ a: 4.95, b: 14.4, zc: 0.4, e: 5, y0: 4.45, y1: 4.65 }),
  cabin2: Object.freeze({ a: 3.85, b: 10.4, zc: 0.6, e: 6, y0: 4.65, y1: 7.05, win: Object.freeze([5.2, 6.3]) }),
  deck3: Object.freeze({ a: 4.25, b: 11.4, zc: 0.4, e: 5, y0: 7.05, y1: 7.25 }),
  pilot: Object.freeze({ a: 2.3, b: 1.85, zc: -8.6, e: 4, y0: 7.25, y1: 9.5, win: Object.freeze([8.05, 9.15]) }),
  pilotRoof: Object.freeze({ a: 2.65, b: 2.2, zc: -8.6, e: 4, y0: 9.5, y1: 9.7 }),
  stacks: Object.freeze({ x: 1.55, z: -3.2, y0: 7.25, y1: 12.35, r: 0.48, crown: 0.66, crownH: 0.45 }),
  mast: Object.freeze({ z: -8.1, y0: 9.7, y1: 13.45, r: 0.07 }),
  flag: Object.freeze({ z: 13.9, y0: 4.65, y1: 8.7, w: 1.7, h: 1.05 }),
  railH: 1.0,
});
export const WINDOW_BANDS = Object.freeze([SHAPE.cabin1.win, SHAPE.cabin2.win, SHAPE.pilot.win]);
export const RAIL_DECKS = Object.freeze([SHAPE.guard.y1, SHAPE.deck2.y1, SHAPE.deck3.y1]);

// the hull's half-beam and sheer along her (z: her frame)
const U = (z) => (z - PADDLE.bowZ) / (PADDLE.transomZ - PADDLE.bowZ);
export function hullHalfBeam(z) {
  const u = Math.max(0, Math.min(1, U(z))), B = PADDLE.hullBeam / 2;
  if (u < 0.3) return B * Math.sin((u / 0.3) * Math.PI / 2) ** 0.75;   // a fine entry, full by a third of her length
  if (u > 0.88) return B * (1 - 0.07 * ((u - 0.88) / 0.12) ** 2);       // the stern drawn in a little to the transom
  return B;
}
export function hullSheer(z) {
  const u = Math.max(0, Math.min(1, U(z)));
  let s = SHAPE.sheerMid;
  if (u < 0.38) s += (SHAPE.sheerBow - SHAPE.sheerMid) * (1 - u / 0.38) ** 2;
  if (u > 0.62) s += (SHAPE.sheerStern - SHAPE.sheerMid) * ((u - 0.62) / 0.38) ** 2;
  return s;
}
// a superellipse ring in the xz plane at height y (half-widths a across, b along, exponent e), n points
const sring = (cx, y, cz, a, b, e = 4, n = 16) => Array.from({ length: n }, (_, i) => { const t = (i + 0.5) / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); return [cx + a * Math.sign(c) * Math.abs(c) ** (2 / e), y, cz + b * Math.sign(s) * Math.abs(s) ** (2 / e)]; });

function geo() {
  const B = builder();
  const { norm } = B;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // an open sheet through rows of points (rows[i][j]); smooth normals by the neighbours (the view turns them in the shader)
  const sheet = (rows, s) => {
    const R = rows.length, N = rows[0].length;
    const nrm = (i, j) => norm(cross(sub(rows[i][Math.min(N - 1, j + 1)], rows[i][Math.max(0, j - 1)]), sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j])));
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < N - 1; j++) B.squad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j], nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), s);
  };
  // a flat polygon (a fan from its centre)
  const fan = (ring, s) => { const N = ring.length, c = ring.reduce((m, p) => [m[0] + p[0] / N, m[1] + p[1] / N, m[2] + p[2] / N], [0, 0, 0]); for (let j = 0; j < N; j++) B.tri(c, ring[j], ring[(j + 1) % N], s); };
  // a wall between two heights of one outline (a superellipse), flat-shaded at the corners only where the outline turns sharply
  const wall = (o, y0, y1, n, s) => B.loft([sring(o.zcx ?? 0, y0, o.zc, o.a, o.b, o.e, n), sring(o.zcx ?? 0, y1, o.zc, o.a, o.b, o.e, n)], s);
  // a slab: its edge, its top and its underside
  const slab = (o, n, sTop, sEdge, sUnder) => { wall(o, o.y0, o.y1, n, sEdge); fan(sring(0, o.y1, o.zc, o.a, o.b, o.e, n), sTop); fan(sring(0, o.y0, o.zc, o.a, o.b, o.e, n), sUnder); };
  // an oriented box: centre c, half-axes u, v, w (vectors)
  const obox = (c, u, v, w, s) => {
    const P = (a, b, d) => [c[0] + u[0] * a + v[0] * b + w[0] * d, c[1] + u[1] * a + v[1] * b + w[1] * d, c[2] + u[2] * a + v[2] * b + w[2] * d];
    B.quad(P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1), s); B.quad(P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1), s);
    B.quad(P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), s); B.quad(P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1), s);
    B.quad(P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1), s); B.quad(P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1), s);
  };
  return { B, sheet, fan, wall, slab, obox };
}

// the railing along an outline (closed or open polyline at deck height y): near: posts and two rails; mid: one band the shader cuts
function railing(G, pts, { lod, closed = true, step = 1.6 }) {
  const { B } = G, H = SHAPE.railH;
  const P = closed ? [...pts, pts[0]] : pts;
  if (lod === 'mid') {
    const lo = P.map((p) => p), hi = P.map((p) => [p[0], p[1] + H, p[2]]);
    G.sheet([lo, hi].map((r) => r), SLOT.railBand);
    return;
  }
  // posts every step m along the line (thin boxes: four sides), a top rail and a mid rail (four-sided tubes)
  let carry = 0;
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1], L = Math.hypot(b[0] - a[0], b[2] - a[2]);
    for (let d = carry; d < L; d += step) {
      const t = d / L, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t, z = a[2] + (b[2] - a[2]) * t;
      B.box(x - 0.025, y, z - 0.025, x + 0.025, y + H, z + 0.025, SLOT.rail, { top: false, bottom: false });
    }
    carry = ((carry - L) % step + step) % step;
  }
  B.tube(P.map((p) => [p[0], p[1] + H, p[2]]), 0.035, 4, SLOT.rail);
  B.tube(P.map((p) => [p[0], p[1] + H * 0.5, p[2]]), 0.018, 4, SLOT.rail);
}

// one LOD's mesh (Float32Array of VF-float vertices)
export function buildPaddle({ lod = 'near' } = {}) {
  const G = geo(), { B } = G;
  const near = lod === 'near', far = lod === 'far';
  const S = SHAPE;
  // --- the hull: two sheets (starboard and port) from her deck edge to just under the waterline (nothing under it is drawn), lofted
  // through stations from the stem to the transom; the bow deck at her sheer to the guards; the transom
  const NS = near ? 40 : far ? 8 : 16;
  const zs = Array.from({ length: NS + 1 }, (_, i) => PADDLE.bowZ + (PADDLE.transomZ - PADDLE.bowZ) * (1 - Math.cos(i / NS * Math.PI / 2)) ** 0.8);
  // stations closer at the bow (the entry curves there)
  const prof = near ? [1, 0.6, 0.3, 0.12, 0, -0.3] : far ? [1, 0, -0.3] : [1, 0.5, 0, -0.3];   // heights as a share of the sheer (≤ 0: m)
  const sideRows = (sgn) => zs.map((z) => { const b = hullHalfBeam(z), s = hullSheer(z); return prof.map((k) => { const y = k > 0 ? s * k : k; const flare = y > 0 ? 1 : 1 - 0.06 * (-y / 0.3); return [sgn * b * flare, y, z]; }); });
  G.sheet(sideRows(1), SLOT.hull); G.sheet(sideRows(-1), SLOT.hull);
  // the bow deck (forward of the guards) and its bulwark cap: a strip across her at the sheer
  const gz0 = S.guard.zc - S.guard.b * 0.93;
  const bowZs = zs.filter((z) => z <= gz0 + 0.5);
  G.sheet(bowZs.map((z) => { const b = hullHalfBeam(z), s = hullSheer(z); return [[-b, s, z], [0, s + 0.06, z], [b, s, z]]; }), SLOT.deck);
  { const b = hullHalfBeam(PADDLE.transomZ), s = hullSheer(PADDLE.transomZ), z = PADDLE.transomZ; G.fan([[-b, s, z], [b, s, z], [b * 0.98, -0.3, z], [-b * 0.98, -0.3, z]], SLOT.hull); }
  // --- the guards (the main deck's overhang round the hull), the cabins with their window bands, the decks over them
  const n = near ? 56 : far ? 12 : 24, nC = near ? 48 : far ? 12 : 20;
  G.slab(S.guard, n, SLOT.deck, SLOT.guard, SLOT.under);
  const cabin = (o, nn) => { G.wall(o, o.y0, o.win[0], nn, SLOT.cabin); G.wall(o, o.win[0], o.win[1], nn, SLOT.window); G.wall(o, o.win[1], o.y1, nn, SLOT.cabin); };
  cabin(S.cabin1, nC);
  G.slab(S.deck2, n, SLOT.deck, SLOT.guard, SLOT.under);
  cabin(S.cabin2, nC);
  G.slab(S.deck3, n, SLOT.deck, SLOT.guard, SLOT.under);
  cabin(S.pilot, near ? 24 : far ? 8 : 12);
  G.slab(S.pilotRoof, near ? 24 : far ? 8 : 12, SLOT.under, SLOT.guard, SLOT.under);
  // --- the stacks (white, their crowns black; flared at the top), the mast on the pilothouse
  const sseg = near ? 16 : far ? 6 : 10;
  for (const sx of [-1, 1]) {
    const x = sx * S.stacks.x;
    B.cyl([x, S.stacks.y0, S.stacks.z], [x, S.stacks.y1, S.stacks.z], S.stacks.r, sseg, SLOT.stack, { cap: far });
    if (!far) B.cyl([x, S.stacks.y1, S.stacks.z], [x, S.stacks.y1 + S.stacks.crownH, S.stacks.z], S.stacks.r, sseg, SLOT.dark, { cap: true, r1: S.stacks.crown });
  }
  if (!far) B.cyl([0, S.mast.y0, S.mast.z], [0, S.mast.y1, S.mast.z], S.mast.r, near ? 8 : 4, SLOT.rail, { r1: S.mast.r * 0.6 });
  // --- the wheel's frame: the side beams from her transom to the bearings, the posts and the beam over the wheel (the stern light)
  const bx = W.halfW + 0.38;
  for (const sx of [-1, 1]) {
    G.obox([sx * bx, W.y, (PADDLE.transomZ - 0.5 + W.z + 0.6) / 2], [0.16, 0, 0], [0, 0.32, 0], [0, 0, (W.z + 0.6 - PADDLE.transomZ + 0.5) / 2], SLOT.guard);
    G.obox([sx * bx, (W.y + W.y + W.r + 0.7) / 2, W.z], [0.12, 0, 0], [0, (W.r + 0.7) / 2, 0], [0, 0, 0.12], SLOT.guard);
    if (!far) G.obox([sx * bx, W.y, W.z], [0.24, 0, 0], [0, 0.3, 0], [0, 0, 0.3], SLOT.dark);   // the bearing blocks (fixed)
  }
  G.obox([0, W.y + W.r + 0.75, W.z], [bx + 0.12, 0, 0], [0, 0.12, 0], [0, 0, 0.35], SLOT.guard);
  // --- the wheel (turned about its axle in the vertex shader): buckets across the width at the rim, rims, spoke rings, the shaft
  const R = W.r, ax = (r, t) => [0, W.y + r * Math.sin(t), W.z + r * Math.cos(t)];
  if (far) {
    B.cyl([-W.halfW, W.y, W.z], [W.halfW, W.y, W.z], R * 0.96, 10, SLOT.wheel, { cap: true });
  } else {
    const NB = W.buckets;
    for (let i = 0; i < NB; i++) {
      const t = i / NB * Math.PI * 2, rd = [0, Math.sin(t), Math.cos(t)], tg = [0, Math.cos(t), -Math.sin(t)], r = R - 0.36;
      G.obox([0, W.y + rd[1] * r, W.z + rd[2] * r], [W.halfW, 0, 0], [rd[0] * 0.36, rd[1] * 0.36, rd[2] * 0.36], [tg[0] * 0.045, tg[1] * 0.045, tg[2] * 0.045], SLOT.wheel);
    }
    const rims = near ? [-W.halfW + 0.15, -1.2, 1.2, W.halfW - 0.15] : [-W.halfW + 0.15, W.halfW - 0.15];
    const rseg = near ? 32 : 16;
    for (const x of rims) {
      for (const rr of near ? [R - 0.72, R * 0.55] : [R - 0.72]) {
        const ring = Array.from({ length: rseg + 1 }, (_, i) => { const p = ax(rr, i / rseg * Math.PI * 2); return [x, p[1], p[2]]; });
        B.tube(ring, near ? 0.07 : 0.1, 4, SLOT.wheel);
      }
      const ns = near ? NB : NB / 2;
      for (let i = 0; i < ns; i++) {
        const t = (i + 0.5) / ns * Math.PI * 2, rd = [0, Math.sin(t), Math.cos(t)], tg = [0, Math.cos(t), -Math.sin(t)], r0 = 0.3, r1 = R - 0.4;
        G.obox([x, W.y + rd[1] * (r0 + r1) / 2, W.z + rd[2] * (r0 + r1) / 2], [0.05, 0, 0], [rd[0] * (r1 - r0) / 2, rd[1] * (r1 - r0) / 2, rd[2] * (r1 - r0) / 2], [tg[0] * 0.05, tg[1] * 0.05, tg[2] * 0.05], SLOT.wheel);
      }
    }
    B.cyl([-W.halfW - 0.4, W.y, W.z], [W.halfW + 0.4, W.y, W.z], 0.2, near ? 12 : 6, SLOT.wheelDark, { cap: true });
  }
  if (!far) {
    // --- the railings: the guards (aft of the bow deck), the bow deck's bulwark rail, the second deck and the sun deck
    const rn = near ? 64 : 28;
    railing(G, sring(0, S.guard.y1, S.guard.zc, S.guard.a - 0.06, S.guard.b - 0.06, S.guard.e, rn).filter((p) => p[2] > gz0 + 0.4), { lod, closed: false });
    for (const sx of [-1, 1]) railing(G, bowZs.filter((z) => z < gz0 + 0.6).map((z) => [sx * (hullHalfBeam(z) - 0.06), hullSheer(z), z]), { lod, closed: false });
    railing(G, sring(0, S.deck2.y1, S.deck2.zc, S.deck2.a - 0.06, S.deck2.b - 0.06, S.deck2.e, rn), { lod });
    railing(G, sring(0, S.deck3.y1, S.deck3.zc, S.deck3.a - 0.06, S.deck3.b - 0.06, S.deck3.e, rn), { lod });
    // --- the pilothouse's wings with the sidelights' boards and lenses; the masthead and stern lenses
    for (const sx of [-1, 1]) {
      B.box(sx > 0 ? 2.25 : -2.95, 8.0, -7.4, sx > 0 ? 2.95 : -2.25, 8.1, -6.6, SLOT.guard);
      B.box(sx > 0 ? 2.7 : -2.8, 8.1, -7.25, sx > 0 ? 2.8 : -2.7, 8.55, -6.75, SLOT.dark);
      B.ball([sx * 2.75, 8.3, -7.0], 0.09, sx > 0 ? SLOT.lensG : SLOT.lensR, near ? 6 : 4);
    }
    B.ball([0, 13.0, -8.1 - 0.08], 0.1, SLOT.lensW, near ? 6 : 4);
    B.ball([0, W.y + W.r + 0.9, W.z - 0.2], 0.1, SLOT.lensW, near ? 6 : 4);
    // --- the stern flag on its staff: a plain navy field with a cream stripe, set in a still ripple (no ensign, no marks)
    const F = S.flag;
    B.cyl([0, F.y0, F.z], [0, F.y1, F.z], 0.045, near ? 6 : 4, SLOT.rail, { r1: 0.03 });
    const NF = near ? 8 : 3, fl = [];
    for (let i = 0; i <= NF; i++) { const t = i / NF, z = F.z + 0.05 + t * F.w, x = Math.sin(t * 5.5) * 0.12 * t; fl.push([[x, F.y1 - 0.08 - F.h, z], [x, F.y1 - 0.08, z]]); }
    G.sheet(fl, SLOT.flag);
  }
  return new Float32Array(B.v);
}

// every LOD, one vertex set: { data, runs: { near, mid, far: { first, count } } }
export function buildPaddleMeshes() {
  const parts = { near: buildPaddle({ lod: 'near' }), mid: buildPaddle({ lod: 'mid' }), far: buildPaddle({ lod: 'far' }) };
  const total = Object.values(parts).reduce((k, a) => k + a.length, 0), data = new Float32Array(total), runs = {};
  let o = 0;
  for (const [k, a] of Object.entries(parts)) { data.set(a, o); runs[k] = { first: o / VF, count: a.length / VF }; o += a.length; }
  return { data, runs };
}

// the LOD for a distance (m), with hysteresis about the last one; lite (a phone, a weak GPU): never the near LOD
export function lodFor(d, last = null, { lite = false } = {}) {
  const h = LOD_M.hyst, nearM = lite ? -1 : LOD_M.near;
  const k = (b, lo) => (last === lo ? b * (1 + h) : last == null ? b : b * (1 - h));
  if (d < k(nearM, 'near')) return 'near';
  if (d < k(LOD_M.mid, 'mid')) return 'mid';
  return 'far';
}
