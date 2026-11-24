// Fannette Island's tea house, the mesh (owner, 2026-11-18: "build it, desktop only"; the numbers:
// sim/teaHouse.js). A low-poly granite ruin at its real 16 ft square: four rubble walls 2.45 m high with the broken crown of standing
// stones the photos show, square-headed openings under timber lintels (two windows north, one east, one west, the door south),
// the brick-lined fireplace in the north-west corner and its stack standing proud, the grey shale floor, a few fallen stones,
// rock steps down from the door, and the foundation run down the knob's slope to the rock. Every piece is a box (24 vertices,
// 12 triangles); the stone is render/landmarks.js's tea stone (kind 5: v1's stoneMaterial, the stones' noise and the mortar's
// courses, trimmed by night) in the pale granite of the photos, each stone its own shade; the lintels its tea plain (kind 6). Its own chunk: main.js imports it only where
// feature('teaHouse') is on (a desktop), after the first frame, and hands the parts to landmarks.addParts (no new pipeline).
//   teaHouseParts({ T = TEA_HOUSE, seed = 1 }) → { parts: [{ who, kind, a, b, rough, pos, nrm, idx }], stats: { boxes, verts, triangles } }
import { TEA_HOUSE } from '../sim/teaHouse.js';

// a deterministic 0..1 from an index and a salt (no Math.random: the scene is reproducible)
function rnd(i, s) {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) ^ Math.imul(s + 0x51ed27, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
import { lerp } from '../../src/sim/core/math.js';
// a colour (0xRRGGBB) shifted by k (−1..1) toward lighter or darker, and a touch warmer or cooler by w (−1..1)
function shade(hex, k, w = 0) {
  const c = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => v * (1 + 0.16 * k));
  c[0] *= 1 + 0.05 * w; c[2] *= 1 - 0.05 * w;
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v)))).reduce((a, v) => (a << 8) | v, 0);
}

// the palette (sRGB): the photos' pale granite (a light warm grey with tan stones), its darker grain, the foundation the island's
// own darker rock, the weathered timber of the lintels, the brick and the soot of the fireplace, the shale floor
// the landmarks shader's kinds for the tea house (render/landmarks.js: kind 1's stone and kind 0's plain colour, trimmed by night)
export const TEA_KIND = Object.freeze({ stone: 5, plain: 6 });
const TEA_PALETTE = Object.freeze({
  stone: 0xb8b6b0, grain: 0x8d8c87, tan: 0xc2ab8c, pale: 0xc8c7c2,   // round 3: the long-lens photo's neutral pale grey (b/r ≈ 0.96 lit), a few tan stones
  joint: 0x7a776f, jointGrain: 0x5e5c57,   // the wall's core between the stones: the mortar and the joints' shade
  foot: 0x96908a, footGrain: 0x6e6a64,
  timber: 0x4a3b2d, brick: 0x6e3f2f, soot: 0x1d1915,
  shale: 0x7a7872, shaleGrain: 0x5a5853,
});

export function teaHouseParts({ T = TEA_HOUSE, seed = 1 } = {}) {
  const P = TEA_PALETTE, parts = [], h = T.sizeM / 2, t = T.wallM, top = T.wallTopM;
  const floor = T.seat.floor, below = T.seat.foot - floor;   // the foundation's depth under the floor (negative)
  const cy = Math.cos(T.yaw), sy = Math.sin(T.yaw);
  let boxes = 0, salt = seed * 7919;
  const faceStones = {}, faceCourses = {};   // the outer faces' stones and courses (the long-lens photo's count, the tests)
  // the light the room's walls keep out (no shadow map reaches a 5 m ruin: the terrain's texel is over a metre), baked per face as
  // a linear factor: the inside faces see a quarter to two thirds of the sky (darker low down), the floor less, the openings'
  // reveals and sills between; the outside 1. From the face's centre (house frame, y over the floor) and its normal
  const IN = h - t + 0.03;
  function occlusion(x, y, z, n) {
    if (y > top + 0.02 || n[1] < -0.5) return 1;
    const m = Math.max(Math.abs(x), Math.abs(z));
    if (m < IN) {   // inside the room
      if (n[1] > 0.5) return 0.32;                                 // the floor, the tops of fallen stones, the shelf
      const toward = -(n[0] * x + n[2] * z) > 0;                    // faces turned to the room's middle (the inner walls)
      return toward ? +(0.22 + 0.33 * Math.min(1, Math.max(0, y / top))).toFixed(2) : 0.3;
    }
    if (m < h + 0.02) {   // in the wall's thickness: the openings' reveals and sills
      const along = Math.abs(x) > Math.abs(z) ? Math.abs(n[2]) : Math.abs(n[0]);   // a normal along the wall's run
      if (n[1] > 0.5) return 0.7;
      if (along > 0.7) return 0.48;
    }
    return 1;
  }
  const dim = (hex, k) => (k === 1 ? hex : [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map((v) => Math.round(v * k ** (1 / 2.2))).reduce((acc, v) => (acc << 8) | v, 0));
  // a box: centre (x, y, z) in the house's frame (y over the floor), size (sx, sy, sz), turned yaw about y (and tilt about its
  // own x), into world space; a part per occlusion level of its faces (kind, colours, roughness)
  // round > 0: a ragged rounded stone (the long-lens photo's crown and faces) in place of a box: a cube split div × div per face,
  // pulled toward an ellipsoid by round and jittered by jit (each shared corner the same way, from its id), flat-shaded facets
  function box(x, y, z, sx, syz, sz, { yaw = 0, tilt = 0, kind = 1, a = P.stone, b = P.grain, rough = 0.92, round = 0, div = 1, jit = 0, id = 0 } = {}) {
    if (round > 0) return stone(x, y, z, sx, syz, sz, { yaw, tilt, kind, a, b, rough, round, div, jit, id });
    const ca = Math.cos(yaw), sa = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const toWorld = (lx, ly, lz) => {   // tilt (about local x), yaw (about y), the house's yaw, then the spot and the floor
      const y1 = ly * ct - lz * st, z1 = ly * st + lz * ct;
      const x2 = lx * ca + z1 * sa, z2 = -lx * sa + z1 * ca;
      const hx = x + x2, hz = z + z2;
      return [T.x + hx * cy - hz * sy, floor + y + y1, T.z + hx * sy + hz * cy];
    };
    const dir = (lx, ly, lz) => { const y1 = ly * ct - lz * st, z1 = ly * st + lz * ct; const x2 = lx * ca + z1 * sa, z2 = -lx * sa + z1 * ca; return [x2 * cy - z2 * sy, y1, x2 * sy + z2 * cy]; };
    const X = sx / 2, Y = syz / 2, Z = sz / 2;
    const faces = [   // normal, then four corners counter-clockwise seen from outside
      [[1, 0, 0], [[X, -Y, Z], [X, -Y, -Z], [X, Y, -Z], [X, Y, Z]]],
      [[-1, 0, 0], [[-X, -Y, -Z], [-X, -Y, Z], [-X, Y, Z], [-X, Y, -Z]]],
      [[0, 1, 0], [[-X, Y, Z], [X, Y, Z], [X, Y, -Z], [-X, Y, -Z]]],
      [[0, -1, 0], [[-X, -Y, -Z], [X, -Y, -Z], [X, -Y, Z], [-X, -Y, Z]]],
      [[0, 0, 1], [[-X, -Y, Z], [X, -Y, Z], [X, Y, Z], [-X, Y, Z]]],
      [[0, 0, -1], [[X, -Y, -Z], [-X, -Y, -Z], [-X, Y, -Z], [X, Y, -Z]]],
    ];
    const groups = new Map();   // the faces by their occlusion (one part each)
    for (const [n, q] of faces) {
      const wn = dir(...n), ln = [wn[0] * cy + wn[2] * sy, wn[1], -wn[0] * sy + wn[2] * cy];   // the normal in the house's frame
      const W = q.map((c) => toWorld(...c)), c0 = [0, 1, 2].map((k) => (W[0][k] + W[1][k] + W[2][k] + W[3][k]) / 4);
      const lx = (c0[0] - T.x) * cy + (c0[2] - T.z) * sy, lz = -(c0[0] - T.x) * sy + (c0[2] - T.z) * cy;
      const k = occlusion(lx, c0[1] - floor, lz, ln);
      if (!groups.has(k)) groups.set(k, { pos: [], nrm: [], idx: [] });
      const g = groups.get(k), base = g.pos.length / 3;
      for (const w of W) { g.pos.push(...w); g.nrm.push(...wn); }
      g.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    for (const [k, g] of groups) parts.push({ who: 'teahouse', kind: kind === 1 ? TEA_KIND.stone : TEA_KIND.plain, a: dim(a, k), b: dim(b, k), rough, pos: g.pos.map((v) => +v.toFixed(4)), nrm: g.nrm, idx: g.idx });
    boxes++;
  }
  function stone(x, y, z, sx, syz, sz, { yaw, tilt, kind, a, b, rough, round, div, jit, id }) {
    const ca = Math.cos(yaw), sa = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
    const toWorld = (lx, ly, lz) => {
      const y1 = ly * ct - lz * st, z1 = ly * st + lz * ct;
      const x2 = lx * ca + z1 * sa, z2 = -lx * sa + z1 * ca;
      const hx = x + x2, hz = z + z2;
      return [T.x + hx * cy - hz * sy, floor + y + y1, T.z + hx * sy + hz * cy];
    };
    // a unit-cube point (−1..1) → the stone's local point: toward the ellipsoid, the corner jittered by its own hash
    const shape = (u, v, w) => {
      const l = Math.hypot(u, v, w) || 1, m = Math.max(Math.abs(u), Math.abs(v), Math.abs(w)) || 1;
      const key = Math.round((u + 1) * 7) * 361 + Math.round((v + 1) * 7) * 19 + Math.round((w + 1) * 7);
      const j = 1 + jit * (rnd(id * 977 + key, salt + 41) - 0.5) * 2;
      const r = [u, v, w].map((c) => lerp(c, (c / l) * m * 1.0, round) * j);
      return [r[0] * sx / 2, r[1] * syz / 2, r[2] * sz / 2];
    };
    const centre = toWorld(0, 0, 0);
    const axes = [[0, 1, 2, 1], [0, 1, 2, -1], [1, 2, 0, 1], [1, 2, 0, -1], [2, 0, 1, 1], [2, 0, 1, -1]];   // (u, v, normal axis, side)
    const groups = new Map();
    for (const [ua, va, na, sd] of axes) for (let i = 0; i < div; i++) for (let j = 0; j < div; j++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]].map(([pi, pj]) => {
        const c = [0, 0, 0]; c[ua] = -1 + 2 * pi / div; c[va] = -1 + 2 * pj / div; c[na] = sd; return c;
      });
      const W = q.map((c) => toWorld(...shape(...c)));
      const e1 = W[2].map((v, k) => v - W[0][k]), e2 = W[3].map((v, k) => v - W[1][k]);
      let wn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const L = Math.hypot(...wn) || 1; wn = wn.map((v) => v / L);
      const c0 = [0, 1, 2].map((k) => (W[0][k] + W[1][k] + W[2][k] + W[3][k]) / 4);
      const ln = [wn[0] * cy + wn[2] * sy, wn[1], -wn[0] * sy + wn[2] * cy];
      const lx = (c0[0] - T.x) * cy + (c0[2] - T.z) * sy, lz = -(c0[0] - T.x) * sy + (c0[2] - T.z) * cy;
      const k = occlusion(lx, c0[1] - floor, lz, ln);
      if (!groups.has(k)) groups.set(k, { pos: [], nrm: [], idx: [] });
      const g = groups.get(k);
      for (const [t0, t1, t2] of [[0, 1, 2], [0, 2, 3]]) {   // each triangle flat (the quad may bend: a facet each)
        let A = W[t0], Bv = W[t1], C = W[t2];
        const f1 = Bv.map((v, kk) => v - A[kk]), f2 = C.map((v, kk) => v - A[kk]);
        let tn = [f1[1] * f2[2] - f1[2] * f2[1], f1[2] * f2[0] - f1[0] * f2[2], f1[0] * f2[1] - f1[1] * f2[0]];
        const tl = Math.hypot(...tn); tn = tl > 1e-9 ? tn.map((v) => v / tl) : wn;
        // outward and front-facing (cross(B − A, C − A) out of the stone: the shader turns a back face's normal round)
        const out = [0, 1, 2].map((kk) => (A[kk] + Bv[kk] + C[kk]) / 3 - centre[kk]);
        if (tn[0] * out[0] + tn[1] * out[1] + tn[2] * out[2] < 0) { [Bv, C] = [C, Bv]; tn = tn.map((v) => -v); }
        const base = g.pos.length / 3;
        for (const P3 of [A, Bv, C]) { g.pos.push(...P3); g.nrm.push(...tn); }
        g.idx.push(base, base + 1, base + 2);
      }
    }
    for (const [k, g] of groups) parts.push({ who: 'teahouse', kind: kind === 1 ? TEA_KIND.stone : TEA_KIND.plain, a: dim(a, k), b: dim(b, k), rough, pos: g.pos.map((v) => +v.toFixed(4)), nrm: g.nrm, idx: g.idx });
    boxes++;
  }
  // a stone's shade: pale, tan or grey, by its index
  const stoneOf = (i) => { const r = rnd(i, salt + 1); const base = r < 0.2 ? P.tan : r < 0.55 ? P.pale : P.stone; return { a: shade(base, lerp(-0.55, 0.45, rnd(i, salt + 2)), lerp(-1, 1, rnd(i, salt + 3))), b: shade(P.grain, lerp(-0.4, 0.3, rnd(i, salt + 4))) }; };

  // the four faces: the wall's centre line, its run (along: a unit vector), its outward normal and its span along the run
  const FACES = {
    N: { o: [0, -h + t / 2], along: [1, 0], out: [0, -1], a0: -h, a1: h },
    S: { o: [0, h - t / 2], along: [1, 0], out: [0, 1], a0: -h, a1: h },
    E: { o: [h - t / 2, 0], along: [0, 1], out: [1, 0], a0: -h + t, a1: h - t },
    W: { o: [-h + t / 2, 0], along: [0, 1], out: [-1, 0], a0: -h + t, a1: h - t },
  };
  const yawOf = (F) => (F.along[0] ? 0 : Math.PI / 2);   // a box's x along the run
  const at = (F, u, off = 0) => [F.o[0] + F.along[0] * u + F.out[0] * off, F.o[1] + F.along[1] * u + F.out[1] * off];
  // a wall piece from u0 to u1 along the face, y0 to y1 over the floor: the lowest 0.6 m a shade darker (the weather's splash)
  let piece = 0;
  function wallPiece(F, u0, u1, y0, y1) {
    if (u1 - u0 < 0.02 || y1 - y0 < 0.02) return;
    const cut = Math.min(Math.max(0.6, y0), y1), [x, z] = at(F, (u0 + u1) / 2), yaw = yawOf(F);
    const k = lerp(-0.12, 0.12, rnd(piece++, salt + 9));
    if (cut > y0) box(x, (y0 + cut) / 2, z, u1 - u0, cut - y0, t, { yaw, a: shade(P.joint, k - 0.25), b: shade(P.jointGrain, -0.2) });
    if (y1 > cut) box(x, (cut + y1) / 2, z, u1 - u0, y1 - cut, t, { yaw, a: shade(P.joint, k), b: P.jointGrain });
  }
  const opens = (name) => T.openings.filter((o) => o.face === name).map((o) => ({ ...o, u0: o.at - o.w / 2, u1: o.at + o.w / 2 })).sort((p, q) => p.u0 - q.u0);
  const LINTEL = 0.16;
  for (const [name, F] of Object.entries(FACES)) {
    const yaw = yawOf(F);
    // the foundation: the wall run on down the knob's slope to its lowest point, flush, in the weathered granite of the base
    const [fx, fz] = at(F, (F.a0 + F.a1) / 2);
    box(fx, below / 2, fz, F.a1 - F.a0, -below, t, { yaw, a: P.foot, b: P.footGrain });
    // the wall: piers between the openings, the sills under them, the lintels and the courses over them
    let u = F.a0;
    for (const o of opens(name)) {
      wallPiece(F, u, o.u0, 0, top);
      wallPiece(F, o.u0, o.u1, 0, o.sill);
      wallPiece(F, o.u0, o.u1, o.head + LINTEL, top);
      const [lx, lz] = at(F, o.at);
      box(lx, o.head + LINTEL / 2, lz, o.w + 0.3, LINTEL, t + 0.02, { yaw, kind: 0, a: P.timber, b: P.timber, rough: 0.85 });
      u = o.u1;
    }
    wallPiece(F, u, F.a1, 0, top);
    // the crown (the long-lens photo): big rounded stones standing on the broken top, leaning, some fallen (gaps), the corners
    // taller; each a ragged rounded stone (2 × 2 facets a side)
    const run = F.a1 - F.a0, n = Math.round(run / 0.5);
    for (let i = 0; i <= n; i++) {
      const id = (name.charCodeAt(0) << 8) + i, corner = (i === 0 || i === n) && F.along[0];
      if (!corner && rnd(id, salt + 11) < 0.14) continue;
      const w = lerp(0.36, 0.6, rnd(id, salt + 12)), uC = F.a0 + Math.min(run - w / 2, Math.max(w / 2, (i / n) * run + lerp(-0.07, 0.07, rnd(id, salt + 13))));
      const hgt = corner ? lerp(0.9, T.crenelM[1] + 0.05, rnd(id, salt + 14)) : lerp(T.crenelM[0], T.crenelM[1], rnd(id, salt + 14) ** 0.9);
      const d = t * lerp(0.75, 1.02, rnd(id, salt + 15)), [x, z] = at(F, F.a0 + (uC - F.a0), lerp(-0.05, 0.05, rnd(id, salt + 16)));
      box(x, top + hgt / 2 - 0.08, z, w, hgt, d, { yaw: yaw + lerp(-0.2, 0.2, rnd(id, salt + 17)), tilt: lerp(-0.14, 0.14, rnd(id, salt + 18)), ...stoneOf(id), round: 0.55, div: 2, jit: 0.12, id });
    }
    // the rubble's faces (the long-lens photo): rounded pale stones in rough courses over the whole outer face, the mortar's joints
    // between them; clear of the openings and their lintels; the inner face too, smaller (the openings and the crown show it)
    const os = opens(name);
    for (const side of [1, -1]) {
      let row = 0;
      for (let yy = 0.12; yy < top - 0.1; row++) {
        const hh = lerp(T.stoneM.h[0], T.stoneM.h[1], rnd((name.charCodeAt(0) << 10) + row * 7 + (side > 0 ? 0 : 500), salt + 22));
        let uu = F.a0 + lerp(0.0, 0.25, rnd(row * 13 + (side > 0 ? 0 : 900), salt + 23));
        for (let i = 0; uu < F.a1 - 0.08; i++) {
          const id = (name.charCodeAt(0) << 14) + row * 64 + i + (side > 0 ? 0 : 8192);
          const w = lerp(T.stoneM.w[0], T.stoneM.w[1], rnd(id, salt + 21)), cu = Math.max(F.a0 + w * 0.61, Math.min(uu + w / 2, F.a1 - w * 0.61)), cyy = yy + hh / 2 + lerp(-0.03, 0.03, rnd(id, salt + 24));
          uu += w + lerp(0.015, 0.04, rnd(id, salt + 26));
          if (os.some((o) => cu + w / 2 > o.u0 - 0.04 && cu - w / 2 < o.u1 + 0.04 && cyy + hh / 2 > o.sill - 0.02 && cyy - hh / 2 < o.head + LINTEL + 0.02)) continue;
          if (side < 0 && rnd(id, salt + 27) < 0.35) continue;
          if (side > 0) faceStones[name] = (faceStones[name] ?? 0) + 1;
          const proud = side > 0 ? lerp(0.03, 0.08, rnd(id, salt + 25)) : 0.03, [x, z] = at(F, cu, side * (t / 2 + proud - 0.1));
          box(x, cyy, z, w * 1.32, hh * 1.34, 0.26, {   // the rounding pulls a stone's outline in by about a fifth: sized up so they close-pack
            yaw: yaw + lerp(-0.05, 0.05, rnd(id, salt + 28)), tilt: lerp(-0.06, 0.06, rnd(id, salt + 29)), ...stoneOf(id), round: 0.62, div: 2, jit: 0.12, id });
        }
        yy += hh + lerp(0.008, 0.025, rnd(row, salt + 30));
        if (side > 0) faceCourses[name] = row + 1;
      }
    }
  }
  // the fireplace in the north-west corner: a stone block across the corner (its face to the room on the diagonal), the brick
  // lining and the dark firebox in it, and the stack rising out of the corner past the walls' top, its crown broken
  const ci = -h + t, s2 = Math.SQRT1_2, diag = Math.PI / 4;   // the inside corner (x = z = ci); the block's x runs across the diagonal
  const fc = ci + 0.45 * s2, fd = 0.3, fH = 1.45;   // its back corners stay inside the walls (none pokes through outside)
  box(fc, fH / 2, fc, 1.3, fH, fd, { yaw: diag, a: shade(P.stone, -0.1), b: P.grain });
  const ff = ci + (0.45 + fd / 2) * s2;   // the block's face to the room
  box(ff + 0.006, 0.42, ff + 0.006, 0.78, 0.72, 0.04, { yaw: diag, kind: 0, a: P.brick, b: P.brick, rough: 0.9 });
  box(ff + 0.02, 0.38, ff + 0.02, 0.56, 0.56, 0.04, { yaw: diag, kind: 0, a: P.soot, b: P.soot, rough: 1 });
  box(ff + 0.03, fH + 0.04, ff + 0.03, 1.15, 0.09, 0.2, { yaw: diag, a: shade(P.stone, 0.15), b: P.grain });   // the stone shelf over it
  const sc = -h + 0.5;
  box(sc, top / 2, sc, 0.92, top, 0.92, { a: P.joint, b: P.jointGrain });   // the breast, from the floor to the walls' top (behind the block)
  // the stack over the walls: courses of rounded stones, two to a course, the top ones broken off
  for (let k = 0, yy = top - 0.05; yy < T.chimneyTopM - 0.05; k++) {
    const hh = lerp(0.3, 0.4, rnd(9100 + k, salt)), across = k % 2 === 0;
    for (const sd of [-1, 1]) {
      const id = 9100 + k * 2 + (sd > 0 ? 1 : 0), dx = across ? sd * 0.23 : 0, dz = across ? 0 : sd * 0.23;
      box(sc + dx, yy + hh / 2, sc + dz, across ? 0.56 : 1.05, hh * 1.2, across ? 1.05 : 0.56, { yaw: lerp(-0.08, 0.08, rnd(id, salt + 3)), ...stoneOf(id), round: 0.55, div: 2, jit: 0.1, id });
    }
    yy += hh;
  }
  box(sc - 0.18, T.chimneyTopM + 0.11, sc + 0.1, 0.42, 0.3, 0.38, { yaw: 0.2, ...stoneOf(9001), round: 0.6, div: 2, jit: 0.15, id: 9001 });
  box(sc + 0.2, T.chimneyTopM + 0.05, sc - 0.15, 0.36, 0.22, 0.32, { yaw: -0.3, ...stoneOf(9002), round: 0.6, div: 2, jit: 0.15, id: 9002 });
  // the floor: mortared grey shale, over the knob's crown
  box(0, -0.13, 0, T.sizeM - 2 * t + 0.02, 0.3, T.sizeM - 2 * t + 0.02, { a: P.shale, b: P.shaleGrain, rough: 0.95 });
  // fallen stones on the floor, along the walls
  for (let i = 0; i < 7; i++) {
    const id = 7000 + i, side = i % 4, w = lerp(0.24, 0.42, rnd(id, salt + 31)), hh = lerp(0.12, 0.24, rnd(id, salt + 32));
    const along = lerp(-h + t + 0.9, h - t - 0.4, rnd(id, salt + 33)), off = h - t - lerp(0.2, 0.45, rnd(id, salt + 34));
    const [x, z] = side === 0 ? [along, off] : side === 1 ? [off, along] : side === 2 ? [along, -off + 0.6] : [-off + 0.9, along];
    box(x, 0.02 + hh / 2, z, w, hh, w * lerp(0.6, 0.9, rnd(id, salt + 35)), { yaw: rnd(id, salt + 36) * Math.PI, tilt: lerp(-0.2, 0.2, rnd(id, salt + 37)), ...stoneOf(id) });
  }
  // the rock steps down from the door (the nomination's "natural-looking stairs of rock with some mortar"), each block run down
  // to the foundation's depth so none stands on air
  const door = T.openings.find((o) => o.face === 'S' && o.sill === 0);
  if (door) for (const [k, z0, z1, y] of [[0, h - 0.05, h + 0.55, -0.16], [1, h + 0.45, h + 1.05, -0.36], [2, h + 0.95, h + 1.6, -0.6]]) {
    const yb = below - 0.2;
    box(door.at + lerp(-0.08, 0.08, rnd(8000 + k, salt)), (y + yb) / 2, (z0 + z1) / 2, door.w + 0.35 - k * 0.08, y - yb, z1 - z0, { yaw: lerp(-0.06, 0.06, rnd(8100 + k, salt)), a: shade(P.foot, 0.25 - 0.1 * k), b: P.footGrain });
  }
  let verts = 0, tris = 0; for (const p of parts) { verts += p.pos.length / 3; tris += p.idx.length / 3; }
  return { parts, stats: { boxes, verts, triangles: tris, faceStones, faceCourses } };
}
