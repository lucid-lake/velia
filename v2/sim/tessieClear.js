// Tessie M3: the boat's solid shape for her (owner, 2026-11-18: "when Tessie knocks down the boat, she can insert her body into
// the boat, pass through it; it is unreal"). A conservative proxy of the hull, the keel, the rudder, the mast, the boom and the
// two sails, posed as the boat is drawn (v2/render/boat.js: T(x, heave, z) · Ry(−heading) · Rx(pitch) · Rz(−heel)), and the hold
// that keeps every point of her spine outside it by her own radius and a margin, each frame. Pure: no GPU, no three, no
// Math.random, no wall clock.
//
// The parts, in the hull frame (origin on the waterline amidships, +y up, the bow at −z, +x to starboard; src/sim/boat/dims.js):
//   the hull    10 stations along the LOA, each two boxes: the topsides (the full half-beam of the station, from 0.30 m under
//               the waterline to 1.75 m over it: the deck, the cabin, the lifelines and pulpits inside) and the canoe body
//               (80 % of the half-beam, down to the station's draft); the half-beam is src/sim/boat/tackle.js hullOutline's,
//               the draft src/sim/boat/ground.js hullDraft's, each the larger of the station's two ends plus 3 cm
//   the keel    a box: 1.9 m of chord, 0.26 m thick, down to the fin's 1.60 m draft (GROUND.keel's points inside)
//   the rudder  a box round the spade (to 1.22 m), 0.60 m wide so it holds at any rudder angle
//   the rig     the mast (a capsule to the truck), the boom (a capsule to its end at the boom's angle), the main and the jib as
//               triangles 0.35 m thick (the belly), the jib's clew at its sheet's angle
// Every part is a little larger than the boat drawn: the clearance it reports is a lower bound (v2/tests/tessie-m3.test.mjs
// samples the hull's surface, the keel, the rudder and the rig and finds every sample inside it).
//
//   const C = createBoatClear({ dims })
//   C.pose({ x, z, heave, heading, heel, pitch, boomAngle, jibAngle })   the boat as drawn this frame
//   C.sdf(x, y, z) → m from the point to the boat's surface (< 0 inside)
//   C.normal(x, y, z, out) → the way out (unit, world)
//   C.near(x, z, reach) → the point within `reach` m (horizontal) of the boat's bounding circle
//   C.clearOf(spine, L, radius) → the least gap (m) of her body to the boat: min over the frames of sdf − her radius there
//   C.hold(P, N, ds, radius, margin) → pushes the points P (Float64Array x y z × N) out to `margin`, the push spread along her
//                                       (a smooth bulge, never a kink), then the hard rule once more; → the largest push (m)
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';

export const CLEAR = Object.freeze({
  margin: 0.15,     // m: her skin never closer than this to the boat's proxy (the owner's test)
  spread: 5,        // spine frames each side a push is carried along her (falloff (1 − k / spread)²)
  passes: 3,
  reach: 15,        // m: the boat's bounding circle (the mast laid to 90° reaches 12.3 m from the origin)
});

// the hull's half-beam (src/sim/boat/tackle.js hullOutline: x forward of amidships along the LOA) and its canoe body's draft
// (src/sim/boat/ground.js hullDraft), as there
const halfBeam = (x, L, B) => { const t = (x + L / 2) / L; return B / 2 * (t < 0.55 ? 0.82 + 0.18 * Math.sin(t / 0.55 * Math.PI / 2) : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2.2))); };
const hullDraft = (x) => 0.1 + 0.34 * Math.max(0, 1 - (x / 4.3) ** 2) ** 0.6;

// the proxy's parts in the hull frame for a boat's dims (memoised): boxes { c, h } (axis-aligned), the rig's fixed points
const memo = new WeakMap();
export function boatShape(dims = DEFAULT_DIMS) {
  let S = memo.get(dims);
  if (S) return S;
  const { HULL, RIG } = dims, L = HULL.loa, B = HULL.beam, boxes = [];
  const box = (x0, x1, y0, y1, z0, z1) => boxes.push({ c: [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], h: [(x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2] });
  const NS = 10;
  for (let i = 0; i < NS; i++) {
    const a = -L / 2 + L * i / NS, b = -L / 2 + L * (i + 1) / NS;   // forward x along the LOA
    let hb = 0, dr = 0;
    for (let k = 0; k <= 4; k++) { const x = a + (b - a) * k / 4; hb = Math.max(hb, halfBeam(x, L, B)); dr = Math.max(dr, hullDraft(x)); }
    hb = Math.max(0.15, hb) + 0.03; dr += 0.03;
    // hull z = −forward x
    box(-hb, hb, -0.30, 1.75, -b - 0.02, -a + 0.02);
    box(-0.8 * hb, 0.8 * hb, -dr, 0.01, -b - 0.02, -a + 0.02);
  }
  // the fin keel (GROUND.keel: forward x 1.2 at 1.1 m, 0.55 and −0.35 at the full draft; its chord round them)
  box(-0.13, 0.13, -HULL.draft - 0.03, 0.0, -1.45, 0.75);
  // the spade rudder on its stock (HULL.rudderZ), any angle
  box(-0.30, 0.30, -1.25, 0.0, HULL.rudderZ - 0.35, HULL.rudderZ + 0.40);
  // the rig in the hull frame: the mast step, the truck, the gooseneck, the jib's tack and head
  const sy = HULL.mastStepY, sz = HULL.mastStepZ;
  const rig = {
    foot: [0, sy, sz], truck: [0, sy + RIG.mastTop + 0.15, sz],
    goose: [0, sy + RIG.gooseneck, sz + 0.1], head: [0, sy + RIG.mainLuff + RIG.gooseneck, sz + 0.1], boom: RIG.boom + 0.15,
    jibTack: [RIG.tack[0], sy + RIG.tack[1], sz + RIG.tack[2]], jibHead: [RIG.head[0], sy + RIG.head[1], sz + RIG.head[2]], jibFoot: Math.hypot(RIG.jibLP, 1.2) + 0.2,
    mastR: 0.15, boomR: 0.14, sailT: 0.35,
  };
  S = { boxes, rig };
  memo.set(dims, S);
  return S;
}

// distances in the hull frame
function sdBox(px, py, pz, b) {
  const qx = Math.abs(px - b.c[0]) - b.h[0], qy = Math.abs(py - b.c[1]) - b.h[1], qz = Math.abs(pz - b.c[2]) - b.h[2];
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0), oz = Math.max(qz, 0);
  return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0);
}
function sdSeg(px, py, pz, a, b, r) {
  const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], l2 = ex * ex + ey * ey + ez * ez || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * ex + (py - a[1]) * ey + (pz - a[2]) * ez) / l2));
  return Math.hypot(px - a[0] - ex * t, py - a[1] - ey * t, pz - a[2] - ez * t) - r;
}
// the distance from a point to a triangle (Ericson, Real-Time Collision Detection § 5.1.5: the closest point by Voronoi region)
function dTri(px, py, pz, a, b, c) {
  const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
  const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
  const d1 = abx * apx + aby * apy + abz * apz, d2 = acx * apx + acy * apy + acz * apz;
  let qx, qy, qz;
  if (d1 <= 0 && d2 <= 0) { qx = a[0]; qy = a[1]; qz = a[2]; }
  else {
    const bpx = px - b[0], bpy = py - b[1], bpz = pz - b[2];
    const d3 = abx * bpx + aby * bpy + abz * bpz, d4 = acx * bpx + acy * bpy + acz * bpz;
    const cpx = px - c[0], cpy = py - c[1], cpz = pz - c[2];
    const d5 = abx * cpx + aby * cpy + abz * cpz, d6 = acx * cpx + acy * cpy + acz * cpz;
    const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
    if (d3 >= 0 && d4 <= d3) { qx = b[0]; qy = b[1]; qz = b[2]; }
    else if (d6 >= 0 && d5 <= d6) { qx = c[0]; qy = c[1]; qz = c[2]; }
    else if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); qx = a[0] + abx * v; qy = a[1] + aby * v; qz = a[2] + abz * v; }
    else if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); qx = a[0] + acx * w; qy = a[1] + acy * w; qz = a[2] + acz * w; }
    else if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); qx = b[0] + (c[0] - b[0]) * w; qy = b[1] + (c[1] - b[1]) * w; qz = b[2] + (c[2] - b[2]) * w; }
    else { const den = 1 / (va + vb + vc), v = vb * den, w = vc * den; qx = a[0] + abx * v + acx * w; qy = a[1] + aby * v + acy * w; qz = a[2] + abz * v + acz * w; }
  }
  return Math.hypot(px - qx, py - qy, pz - qz);
}

export function createBoatClear({ dims = DEFAULT_DIMS, C = CLEAR } = {}) {
  const S = boatShape(dims), R = S.rig;
  // the pose: the rotation hull → world (rows of M: world = M · local + T) and the posed rig points
  const M = new Float64Array(9), T = [0, 0, 0];
  const clew = [0, 0, 0], jibClew = [0, 0, 0];
  let posed = false, ox = 0, oz = 0;
  const loc = [0, 0, 0];
  function toLocal(x, y, z) {
    const dx = x - T[0], dy = y - T[1], dz = z - T[2];
    loc[0] = M[0] * dx + M[3] * dy + M[6] * dz; loc[1] = M[1] * dx + M[4] * dy + M[7] * dz; loc[2] = M[2] * dx + M[5] * dy + M[8] * dz;
    return loc;
  }
  function sdLocal(px, py, pz) {
    let d = Infinity;
    for (const b of S.boxes) { const v = sdBox(px, py, pz, b); if (v < d) d = v; }
    // the rig only where it can be (within its own height of the mast's foot)
    d = Math.min(d, sdSeg(px, py, pz, R.foot, R.truck, R.mastR), sdSeg(px, py, pz, R.goose, clew, R.boomR),
      dTri(px, py, pz, R.goose, R.head, clew) - R.sailT, dTri(px, py, pz, R.jibTack, R.jibHead, jibClew) - R.sailT);
    return d;
  }
  const self = {
    C, shape: S,
    pose(p) {
      const h = p.heading ?? 0, ph = p.pitch ?? 0, hl = p.heel ?? 0;
      // world = Ry(−h) · Rx(pitch) · Rz(−heel) · local (v2/render/boat.js), as a matrix: the columns are the local axes in the world
      const ch = Math.cos(-h), sh = Math.sin(-h), cp = Math.cos(ph), sp = Math.sin(ph), cz = Math.cos(-hl), sz = Math.sin(-hl);
      const col = (lx, ly, lz) => {
        let x = cz * lx - sz * ly, y = sz * lx + cz * ly, z = lz;              // Rz
        const y2 = cp * y - sp * z, z2 = sp * y + cp * z; y = y2; z = z2;       // Rx
        return [ch * x + sh * z, y, -sh * x + ch * z];                          // Ry
      };
      const ex = col(1, 0, 0), ey = col(0, 1, 0), ez = col(0, 0, 1);
      // M as rows-of-columns so toLocal reads the transpose: M[0..2] = ex, M[3..5] = ey, M[6..8] = ez (column vectors)
      M[0] = ex[0]; M[1] = ey[0]; M[2] = ez[0]; M[3] = ex[1]; M[4] = ey[1]; M[5] = ez[1]; M[6] = ex[2]; M[7] = ey[2]; M[8] = ez[2];
      T[0] = p.x; T[1] = p.heave ?? 0; T[2] = p.z; ox = p.x; oz = p.z;
      // the boom's end at its angle (render/boat.js: Ry(boomAngle) about the gooseneck: + to starboard), the jib's clew at its sheet's
      const ba = p.boomAngle ?? 0, ja = p.jibAngle ?? 0;
      clew[0] = R.goose[0] + Math.sin(ba) * R.boom; clew[1] = R.goose[1]; clew[2] = R.goose[2] + Math.cos(ba) * R.boom;
      jibClew[0] = R.jibTack[0] + Math.sin(ja) * R.jibFoot; jibClew[1] = R.jibTack[1] + 0.35; jibClew[2] = R.jibTack[2] + Math.cos(ja) * R.jibFoot;
      posed = true;
      return self;
    },
    get posed() { return posed; },
    sdf(x, y, z) { const l = toLocal(x, y, z); return sdLocal(l[0], l[1], l[2]); },
    normal(x, y, z, out = [0, 0, 0]) {
      const e = 0.02;
      const gx = self.sdf(x + e, y, z) - self.sdf(x - e, y, z), gy = self.sdf(x, y + e, z) - self.sdf(x, y - e, z), gz = self.sdf(x, y, z + e) - self.sdf(x, y, z - e);
      const l = Math.hypot(gx, gy, gz);
      if (l < 1e-9) { out[0] = 0; out[1] = -1; out[2] = 0; return out; }   // deep inside a box's middle: down (under the hull)
      out[0] = gx / l; out[1] = gy / l; out[2] = gz / l; return out;
    },
    // the push that takes a point (her reach r) out to the margin: along the surface's normal when it is near the surface; from deep
    // inside (where the union's normal can point into the next box) the shortest way out along the hull's six axes or straight down,
    // marched; → its length (0: already clear), the unit direction in out
    pushOf(x, y, z, r, margin, out) {
      const g = self.sdf(x, y, z) - r;
      if (g >= margin) return 0;
      if (g > -0.25) { self.normal(x, y, z, out); return margin - g + 0.005; }
      let best = Infinity;
      for (let k = 0; k < 7; k++) {
        const ax = k >> 1, sg = k & 1 ? -1 : 1;   // the hull's axis ax in the world: column ax of the pose (M[ax], M[3 + ax], M[6 + ax])
        const dx = k < 6 ? M[ax] * sg : 0, dy = k < 6 ? M[3 + ax] * sg : -1, dz = k < 6 ? M[6 + ax] * sg : 0;
        for (let u = 0.15; u < Math.min(best, 8); u += 0.15) {
          if (self.sdf(x + dx * u, y + dy * u, z + dz * u) - r >= margin) { if (u < best) { best = u; out[0] = dx; out[1] = dy; out[2] = dz; } break; }
        }
      }
      if (!Number.isFinite(best)) { out[0] = 0; out[1] = -1; out[2] = 0; return margin - g + 0.005; }
      return best + 0.005;
    },
    near(x, z, reach = 0) { return posed && Math.hypot(x - ox, z - oz) < C.reach + reach; },
    // the least gap of her body (the spine's frames: x y z at 8 floats each, her radius at arc s) to the boat
    clearOf(spine, L, radius) {
      if (!posed) return Infinity;
      const N = spine.length / 8, ds = L / (N - 1);
      let best = Infinity;
      for (let i = 0; i < N; i++) {
        const o = i * 8, r = radius(i * ds);
        if (!self.near(spine[o], spine[o + 2], r)) continue;
        best = Math.min(best, self.sdf(spine[o], spine[o + 1], spine[o + 2]) - r);
      }
      return best;
    },
    hold(P, N, ds, radius, margin = C.margin) {
      if (!posed) return 0;
      let any = false;
      for (let i = 0; i < N && !any; i++) any = self.near(P[i * 3], P[i * 3 + 2], radius(i * ds) + margin + 1);
      if (!any) return 0;
      const push = new Float64Array(N * 3), mag = new Float64Array(N), nrm = [0, 0, 0];
      let most = 0;
      for (let pass = 0; pass < C.passes; pass++) {
        // the pushes each point needs
        push.fill(0); mag.fill(0);
        let need = false;
        for (let i = 0; i < N; i++) {
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], r = radius(i * ds);
          if (!self.near(x, z, r + margin)) continue;
          const m = self.pushOf(x, y, z, r, margin, nrm);
          if (!m) continue;
          push[i * 3] = nrm[0] * m; push[i * 3 + 1] = nrm[1] * m; push[i * 3 + 2] = nrm[2] * m; mag[i] = m; need = true;
        }
        if (!need) break;
        // the push spread along her (the strongest within reach, by its falloff): her body bends round the hull, no kink
        const sp = pass === C.passes - 1 ? 0 : C.spread;
        const out = new Float64Array(N * 3);
        for (let i = 0; i < N; i++) {
          let bw = 0, bj = -1;
          for (let j = Math.max(0, i - sp); j <= Math.min(N - 1, i + sp); j++) {
            if (!mag[j]) continue;
            const k = Math.abs(i - j), w = mag[j] * (1 - k / (sp + 1)) ** 2;
            if (w > bw) { bw = w; bj = j; }
          }
          if (bj < 0) continue;
          const f = bw / mag[bj];
          out[i * 3] = push[bj * 3] * f; out[i * 3 + 1] = push[bj * 3 + 1] * f; out[i * 3 + 2] = push[bj * 3 + 2] * f;
        }
        for (let i = 0; i < N * 3; i++) P[i] += out[i];
        for (let i = 0; i < N; i++) most = Math.max(most, Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]));
      }
      // the hard rule (each point alone, as many rounds as it takes, at most 6)
      for (let round = 0; round < 6; round++) {
        let left = false;
        for (let i = 0; i < N; i++) {
          const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], r = radius(i * ds);
          if (!self.near(x, z, r + margin)) continue;
          const m = self.pushOf(x, y, z, r, margin, nrm);
          if (!m) continue;
          P[i * 3] += nrm[0] * m; P[i * 3 + 1] += nrm[1] * m; P[i * 3 + 2] += nrm[2] * m; most = Math.max(most, m); left = true;
        }
        if (!left) break;
      }
      return most;
    },
  };
  return self;
}
