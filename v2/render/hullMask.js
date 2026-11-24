// K2 ("no water drawn inside the hull or the cockpit, at any angle to 90°"): the water's fragment asks whether
// its point lies inside the hull's envelope (the deck's outline in plan, from the keel up to the sheer and the coaming), in the
// boat's own frame with the drawn heel, pitch and heave, and draws nothing there. On only while she is past 34° of heel (the
// knockdown's look, v2/sim/knockdownFx.js kdMix): upright the water never reaches the deck and nothing is tested.
// The envelope is v2's own hull shape (render/boat/hullShape.js: at each station the half-beam at the sheer and at the waterline, the
// sheer and the canoe body's depth; the section between: straight from the waterline up to the sheer, a rounded bilge below to the
// canoe body, so no water goes missing beside the curved hull), baked into a small
// table the WGSL reads; the frame is the drawing's (render/boat.js: T(x, heave, z) · Ry(−heading) · Rx(pitch) · Rz(−heel); the
// hull frame x starboard, y up, z aft).
//   hullLocal(p, pose)            world → hull frame [x, y, z] (pose: { x, z, heave, heading, pitch, heel })
//   inHull(p, pose, table)        true inside the envelope (JS, the tests)
//   HULL_MASK_WGSL(table)         fn hullLocal(p, hull) and fn inHullEnv(l) for the water (render/wake.js wakeInHull)
import { hullShape } from './boat/hullShape.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';

export const MASK = Object.freeze({ n: 24, inset: 0.97, coaming: 0.14, keelY: -2.0 });

// the envelope table: n stations from the transom to the stem, each [z in the hull frame, the half-beam at the sheer, the sheer,
// the half-beam at the waterline, the canoe body's depth (y < 0)]
export function hullTable(dims = DEFAULT_DIMS, n = MASK.n) {
  const S = hullShape(dims), P = S.P, out = [];
  for (let i = 0; i < n; i++) {
    const y = P.yTransom + (P.yStem - P.yTransom) * (i / (n - 1));
    out.push([-y, Math.max(0, S.halfBeamSheer(y)), S.sheer(y), Math.max(0, S.halfBeamWl(y)), Math.min(-0.05, S.keel(y))]);
  }
  return { z0: -P.yStem, z1: -P.yTransom, rows: out.reverse() };   // z ascending: the stem (most negative z) first
}

export function hullLocal(p, pose) {
  const qx = p[0] - pose.x, qy = p[1] - (pose.heave ?? 0), qz = p[2] - pose.z;
  const h = pose.heading ?? 0, fx = Math.sin(h), fz = -Math.cos(h);
  const x1 = qx * -fz + qz * fx, z1 = -(qx * fx + qz * fz), y1 = qy;   // the yaw undone: starboard, up, aft
  const cp = Math.cos(pose.pitch ?? 0), sp = Math.sin(pose.pitch ?? 0);
  const y2 = y1 * cp + z1 * sp, z2 = -y1 * sp + z1 * cp;                // Rx(pitch) undone
  const ch = Math.cos(pose.heel ?? 0), sh = Math.sin(pose.heel ?? 0);
  return [x1 * ch - y2 * sh, x1 * sh + y2 * ch, z2];                    // Rz(−heel) undone
}

function rowAt(T, z) {
  const R = T.rows, n = R.length;
  if (z <= R[0][0]) return R[0];
  if (z >= R[n - 1][0]) return R[n - 1];
  const u = (z - T.z0) / (T.z1 - T.z0) * (n - 1), i = Math.min(n - 2, Math.floor(u)), f = u - i;
  return R[i].map((v, k) => (k === 0 ? z : v + (R[i + 1][k] - v) * f));
}
// the section's half-width at height y: the waterline's to the sheer's above 0, a rounded bilge to the canoe body below
function halfAt(r, y) {
  if (y >= 0) return r[3] + (r[1] - r[3]) * Math.min(1, y / Math.max(r[2], 1e-3));
  const q = y / r[4]; return q >= 1 ? 0 : r[3] * Math.sqrt(1 - q * q);
}
export function inHullEnv(l, T) {
  if (l[2] < T.z0 || l[2] > T.z1 || l[1] < MASK.keelY) return false;
  const r = rowAt(T, l[2]);
  return l[1] < r[2] + MASK.coaming && Math.abs(l[0]) < halfAt(r, Math.min(l[1], r[2])) * MASK.inset;
}
export const inHull = (p, pose, T = hullTable()) => inHullEnv(hullLocal(p, pose), T);

// the WGSL: hull = (heel, heave, pitch, on), boat = (x, z, fx, fz) (the wake's own uniform rows)
export function HULL_MASK_WGSL(T = hullTable()) {
  const n = T.rows.length;
  return `const HM_N = ${n}u; const HM_Z0 = ${T.z0.toFixed(4)}; const HM_Z1 = ${T.z1.toFixed(4)};
const HM_B = array<f32, ${n}>(${T.rows.map((r) => r[1].toFixed(4)).join(', ')});
const HM_S = array<f32, ${n}>(${T.rows.map((r) => r[2].toFixed(4)).join(', ')});
const HM_W = array<f32, ${n}>(${T.rows.map((r) => r[3].toFixed(4)).join(', ')});
const HM_K = array<f32, ${n}>(${T.rows.map((r) => r[4].toFixed(4)).join(', ')});
fn hullLocal(p: vec3f, boat: vec4f, hull: vec4f) -> vec3f {
  let q = vec3f(p.x - boat.x, p.y - hull.y, p.z - boat.y);
  let x1 = q.x * -boat.w + q.z * boat.z; let z1 = -(q.x * boat.z + q.z * boat.w); let y1 = q.y;
  let cp = cos(hull.z); let sp = sin(hull.z); let y2 = y1 * cp + z1 * sp; let z2 = -y1 * sp + z1 * cp;
  let ch = cos(hull.x); let sh = sin(hull.x);
  return vec3f(x1 * ch - y2 * sh, x1 * sh + y2 * ch, z2);
}
fn inHullEnv(l: vec3f) -> bool {
  if (l.z < HM_Z0 || l.z > HM_Z1 || l.y < ${MASK.keelY.toFixed(2)}) { return false; }
  let u = clamp((l.z - HM_Z0) / (HM_Z1 - HM_Z0), 0.0, 1.0) * f32(HM_N - 1u);
  let i = min(u32(floor(u)), HM_N - 2u); let f = u - f32(i);
  var tb = HM_B; var ts = HM_S; var tw = HM_W; var tk = HM_K;   // function-scope copies: indexed at run time
  let hb = mix(tb[i], tb[i + 1u], f); let sh = mix(ts[i], ts[i + 1u], f); let hw = mix(tw[i], tw[i + 1u], f); let kd = mix(tk[i], tk[i + 1u], f);
  if (l.y >= sh + ${MASK.coaming.toFixed(3)}) { return false; }
  let y = min(l.y, sh); let q = y / kd;
  let half = select(hw * sqrt(max(0.0, 1.0 - q * q)), hw + (hb - hw) * min(1.0, y / max(sh, 1e-3)), y >= 0.0);
  return abs(l.x) < half * ${MASK.inset.toFixed(3)};
}`;
}
