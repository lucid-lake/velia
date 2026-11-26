// The paddleboarder's meshes (v2/sim/supPose.js), all by code: a 3.35 m all-round board, the torso in a PFD, a head with a cap, a limb rod
// (the arms and legs: one unit rod, stretched between two joints by the instance's matrix) and a single-blade paddle. Pure: plain arrays,
// no GPU (the tests and render/sup.js build them once). Each part is its own mesh in one vertex set, drawn instanced:
//   board    board frame (x starboard, y up from the waterline, z aft): a lofted plank, a pointed bow with a rocker, a rounder tail
//   torso    y up the spine from the hips (0) to the shoulders (0.52), x across the shoulders
//   head     a ball at the origin (radius 0.11), the cap's visor forward (-z)
//   rod      along +z from 0 to 1, radius 1 (the matrix scales it)
//   paddle   +z from the grip (0) to the tip (2.05): the shaft, the T-grip, the blade
// A vertex: position (3), normal (3), the part (1): the part is the material's switch in render/sup.js.
import { builder, VF } from './tourBoatMesh.js';
import { BOARD, BODY } from '../sim/supPose.js';

export { VF };
export const PART = Object.freeze({ board: 0, torso: 1, head: 2, rod: 3, paddle: 4 });
export const ROD = Object.freeze({ upperArm: 0, foreArm: 1, thigh: 2, shin: 3 });

// the board's outline: half-width at u (0 bow tip, 1 tail), and the rocker's lift
const halfWidth = (u) => {
  const B = BOARD.B / 2;
  if (u < 0.34) return B * Math.pow(Math.sin((u / 0.34) * Math.PI / 2), 0.62);   // a pointed bow, round at the very tip
  if (u > 0.9) return B * (1 - 0.34 * ((u - 0.9) / 0.1) ** 2);                    // the tail drawn in to a round end
  return B;
};
const lift = (u) => (u < 0.3 ? BOARD.rocker * (1 - u / 0.3) ** 2 : u > 0.92 ? BOARD.rocker * 0.25 * ((u - 0.92) / 0.08) ** 2 : 0);
// a rounded-rectangle section of half-width w: the flat deck, the rails, the flat bottom (n points)
function section(w, y0, y1, zc, n = 12) {   // (w: the half-width, y0 the bottom, y1 the deck)
  const pts = [], hy = (y1 - y0) / 2, cy = (y0 + y1) / 2;
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    // a superellipse: flat top and bottom, round rails
    const ex = 4, px = Math.sign(c) * Math.abs(c) ** (2 / ex) * w, py = Math.sign(s) * Math.abs(s) ** (2 / ex) * hy;
    pts.push([px, cy + py, zc]);
  }
  return pts;
}

function geo() {
  const B = builder();
  const runs = [];
  const mark = (part, fn) => { const a = B.v.length / VF; fn(); runs.push({ part, first: a, count: B.v.length / VF - a }); };
  // ---- the board ----
  mark(PART.board, () => {
    const rings = [], N = 18, L = BOARD.L;
    for (let i = 0; i <= N; i++) {
      const u = i / N, z = -L / 2 + L * u, w = Math.max(0.012, halfWidth(u)), l = lift(u);
      const top = BOARD.top + l * 0.6, bot = BOARD.bottom + l;
      rings.push(section(w, bot, top, z, 12));
    }
    // loft from the bow (z -L/2) to the tail; the rings wound so the normals face out
    B.loft(rings.map((r) => r.slice().reverse()), PART.board, { capEnd: true });
    const f = rings[0].slice(), c0 = f.reduce((m, p) => [m[0] + p[0] / f.length, m[1] + p[1] / f.length, m[2] + p[2] / f.length], [0, 0, 0]);
    for (let j = 0; j < f.length; j++) B.tri(c0, f[j], f[(j + 1) % f.length], PART.board);
  });
  // ---- the torso: a tapered capsule from the hips to the shoulders (the PFD's bulk at the chest) ----
  mark(PART.torso, () => {
    const rings = [], T = BODY.torso, prof = [[0, 0.13, 0.085], [0.1, 0.15, 0.1], [0.3, 0.17, 0.115], [0.44, 0.185, 0.115], [0.5, 0.17, 0.09], [T + 0.02, 0.07, 0.06]];
    for (const [y, a, b] of prof) rings.push(Array.from({ length: 10 }, (_, i) => { const t = (i + 0.5) / 10 * Math.PI * 2; return [Math.cos(t) * a, y, Math.sin(t) * b]; }));
    B.loft(rings.map((r) => r.slice().reverse()), PART.torso, { capEnd: true });
    const f = rings[0], c0 = [0, 0, 0]; for (let j = 0; j < f.length; j++) B.tri(c0, f[(j + 1) % f.length], f[j], PART.torso);
  });
  // ---- the head: a ball, a cap's visor forward ----
  mark(PART.head, () => {
    B.ball([0, 0, 0], BODY.headR, PART.head, 10);
    B.box(-0.075, 0.0, -0.205, 0.075, 0.012, -0.07, PART.head);   // the visor (a thin slab forward, above the brow)
    B.box(-0.03, -0.14, -0.02, 0.03, -0.1, 0.03, PART.head);      // the neck's root
  });
  // ---- one limb rod along +z, radius 1 ----
  mark(PART.rod, () => { B.cyl([0, 0, 0], [0, 0, 1], 1, 7, PART.rod, { cap: true }); });
  // ---- the paddle: shaft, T-grip, blade (+z from the grip) ----
  mark(PART.paddle, () => {
    B.cyl([0, 0, 0], [0, 0, 1.62], 0.016, 6, PART.paddle, { cap: true });
    B.box(-0.075, -0.016, -0.018, 0.075, 0.016, 0.018, PART.paddle);
    const z0 = 1.58, z1 = BODY.paddle;   // the blade: a flat tear, wide at its middle
    const sec = (z, w) => [[-w, -0.011, z], [w, -0.011, z], [w, 0.011, z], [-w, 0.011, z]];
    const S = [sec(z0, 0.045), sec(z0 + 0.12, 0.1), sec(z0 + 0.32, 0.105), sec(z1, 0.06)];
    for (let i = 0; i < S.length - 1; i++) for (let j = 0; j < 4; j++) { const a = S[i][j], b = S[i][(j + 1) % 4], c = S[i + 1][(j + 1) % 4], d = S[i + 1][j]; B.quad(a, d, c, b, PART.paddle); }
    B.quad(S[S.length - 1][0], S[S.length - 1][1], S[S.length - 1][2], S[S.length - 1][3], PART.paddle);
  });
  return { data: new Float32Array(B.v), runs };
}

export function buildSupMeshes() {
  const g = geo(), by = {};
  for (const r of g.runs) by[r.part] = r;
  return { data: g.data, runs: by, triangles: g.data.length / VF / 3 };
}
