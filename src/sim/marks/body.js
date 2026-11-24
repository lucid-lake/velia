// A floating body for the racing marks (feat/marks): a 6-degree-of-freedom rigid body that floats on the same wave
// field the boat does. Plain JS, no three.js; tests/marks.test.mjs drives it in node.
//
// Buoyancy is the real thing, not a spring: the body is a lattice of small volume cells (a few thousand, fixed in the
// body), and each cell that lies below the water at its own place pushes up with ρ·g·dV. The water under the body is
// the surface the GPU draws (water-spectrum.js makeSurface, read through surface.heightAt) sampled at 9 points over the
// footprint (the centre and two rings), fitted by a plane plus a curvature (a + b·x + c·z + k·(x² + z²)), so the sea
// has a slope, a height and a bend under the mark. A cell is "under" through a soft step as wide as a cell (no jitter
// as a crest moves through the lattice). The sum of the pushes gives heave; their moment about the centre of mass gives
// pitch and roll (the centre of buoyancy moves as the body tilts, the ballast lowers the centre of mass: the metacentric
// height comes out of the shape, not out of a constant). The waterplane area drops out of the same sum (the soft step's
// slope), and sets the heave damping and the added mass.
//
// Other loads: gravity at the centre of mass; the water's drag on the submerged part, relative to the water's own
// vertical motion (the surface fit's rate), so the body rides the wave; windage on the dry part (a quadratic drag at
// the dry centroid, so the wind heels a tall mark); the anchor rode (a catenary, makeRode) at the ring. Collisions
// (field.js) act on v and w between steps.
//
// Frames: world x east, y up, z south (the boat's), local y up; angles in radians; units SI. Quaternion q = [w, x, y, z].
import { catenaryX } from '../boat/tackle.js';

export const RHO = 1000, G = 9.81, RHO_AIR = 1.225;
const PI = Math.PI;

// ---- the mark types (sizes from the owner's brief; masses include the ballast pocket and the anchor line's pull) ----
// Local frame: the origin at the geometric centre, y up. cg: the centre of mass's y (ballast low). ring: the anchor ring.
// spheres: the collision spheres [x, y, z, r]. Aref: the frontal area for the wind (m²); cdAir, cdWater.
const tetraA = (H) => H * Math.sqrt(1.5);
export const MARK_TYPES = {
  sphere:   { shape: 'sphere', R: 0.6, mass: 55, cg: -0.15, Aref: PI * 0.36, cdAir: 0.5, cdWater: 0.5, label: 'sphere 1.2 m' },
  cylinder: { shape: 'cylinder', r: 0.40, H: 1.8, mass: 110, cg: -0.75, Aref: 2 * 0.40 * 1.8, cdAir: 1.0, cdWater: 0.9, label: 'tall cylinder 1.8 m' },
  tetra:    { shape: 'tetra', H: 1.5, mass: 180, cg: -0.25, zeta: { heave: 1.0, tilt: 0.7 }, Aref: 0.5 * tetraA(1.5) * 1.5, cdAir: 1.1, cdWater: 1.0, label: 'tetrahedron 1.5 m' },
  pin:      { shape: 'cylinder', r: 0.30, H: 1.3, mass: 60, cg: -0.53, Aref: 2 * 0.30 * 1.3, cdAir: 1.0, cdWater: 0.9, extra: { A: 0.45, y: 1.55 }, label: 'pin buoy' },
  committee: { shape: 'committee', L: 7.0, B: 2.5, mass: 1700, cg: -0.15, Aref: 5.5, cdAir: 1.0, cdWater: 0.8, extra: { A: 5.0, y: 1.6 }, label: 'committee boat' },
};
for (const [k, T] of Object.entries(MARK_TYPES)) {
  T.name = k;
  if (T.shape === 'sphere') { T.ring = [0, -T.R, 0]; T.top = [0, T.R, 0]; T.height = 2 * T.R; T.spheres = [[0, 0, 0, T.R]]; }
  if (T.shape === 'cylinder') {
    T.ring = [0, -T.H / 2, 0]; T.top = [0, T.H / 2, 0]; T.height = T.H; T.spheres = [];
    const n = Math.max(2, Math.ceil((T.H - 2 * T.r) / (0.9 * T.r)) + 1);
    for (let i = 0; i < n; i++) T.spheres.push([0, -T.H / 2 + T.r + (T.H - 2 * T.r) * i / (n - 1), 0, T.r]);
  }
  if (T.shape === 'tetra') {
    const a = tetraA(T.H), Rb = a / Math.sqrt(3), y0 = -T.H / 4;
    T.a = a; T.Rb = Rb; T.ring = [0, y0, 0]; T.top = [0, 3 * T.H / 4, 0]; T.height = T.H;
    T.spheres = [[0, y0 + 0.3, 0, 0.5], [0, y0 + 0.7, 0, 0.3], [0, y0 + 1.15, 0, 0.15]];
    for (let j = 0; j < 3; j++) { const al = PI / 2 + 2 * PI * j / 3, rr = Rb - 0.6; T.spheres.push([rr * Math.cos(al), y0 + 0.3, rr * Math.sin(al), 0.3]); }
  }
  if (T.shape === 'committee') {
    T.ring = [3.4, -0.7, 0]; T.top = [0, 0.55, 0]; T.height = 1.4; T.spheres = [];
    for (const x of [-2.6, -1.4, -0.2, 1.0, 2.0]) T.spheres.push([x, -0.15, 0, 1.1]);
    T.spheres.push([2.9, -0.15, 0, 0.7]);
  }
}

// the shape's interior in the local frame
function insideFn(T) {
  if (T.shape === 'sphere') return (x, y, z) => x * x + y * y + z * z <= T.R * T.R;
  if (T.shape === 'cylinder') return (x, y, z) => x * x + z * z <= T.r * T.r && Math.abs(y) <= T.H / 2;
  if (T.shape === 'tetra') {
    const rin0 = T.Rb / 2, y0 = -T.H / 4, nrm = [];
    for (let j = 0; j < 3; j++) { const al = PI / 2 + 2 * PI * j / 3 + PI / 3; nrm.push([Math.cos(al), Math.sin(al)]); }
    return (x, y, z) => {
      if (y < y0 || y > 3 * T.H / 4) return false;
      const rin = rin0 * (3 * T.H / 4 - y) / T.H;
      for (const [nx, nz] of nrm) if (x * nx + z * nz > rin) return false;
      return true;
    };
  }
  // committee: the hull from the keel to the deck; a pointed bow, a V bottom
  const half = (x) => 1.25 * (x < 1.6 ? 1 : Math.sqrt(Math.max(0, 1 - ((x - 1.6) / 1.9) ** 2)));
  return (x, y, z) => {
    if (x < -3.5 || x > 3.5) return false;
    const hw = half(x); if (hw <= 0 || Math.abs(z) > hw) return false;
    return y <= 0.55 && y >= -0.85 + 0.55 * Math.abs(z) / 1.25;
  };
}
export const extent = (T) => (T.shape === 'sphere' ? [T.R, T.R, T.R] : T.shape === 'cylinder' ? [T.r, T.H / 2, T.r] : T.shape === 'tetra' ? [T.Rb, 3 * T.H / 4, T.Rb] : [3.5, 0.85, 1.25]);
const spacing = (T) => (T.shape === 'committee' ? 0.17 : T.name === 'pin' ? 0.05 : 0.075);

// the exact volume of the shape, where there is a closed form (the lattice is scaled to it)
function shapeVolume(T) {
  if (T.shape === 'sphere') return 4 / 3 * PI * T.R ** 3;
  if (T.shape === 'cylinder') return PI * T.r * T.r * T.H;
  if (T.shape === 'tetra') return T.a ** 3 / (6 * Math.SQRT2);
  return null;
}
// the draft (m, the depth of the lowest point below the waterline) of the upright shape at rest in flat water: the
// closed forms the tests check the lattice against
export function designDraft(T, extraMass = 0) {
  const m = T.mass + extraMass, Vs = m / RHO;
  if (T.shape === 'cylinder') return Vs / (PI * T.r * T.r);
  if (T.shape === 'sphere') {   // the cap: V = π h² (3R − h) / 3
    let lo = 0, hi = 2 * T.R;
    for (let i = 0; i < 60; i++) { const h = (lo + hi) / 2; if (PI * h * h * (3 * T.R - h) / 3 < Vs) lo = h; else hi = h; }
    return (lo + hi) / 2;
  }
  if (T.shape === 'tetra') return T.H * (1 - Math.cbrt(1 - Vs / shapeVolume(T)));   // the apex up: the part above is a similar tetra
  return null;
}

// ---- small quaternion helpers ----
function qMat(q, m) {   // rotation matrix, row-major 9
  const [w, x, y, z] = q, xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy - wz); m[2] = 2 * (xz + wy);
  m[3] = 2 * (xy + wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz - wx);
  m[6] = 2 * (xz - wy); m[7] = 2 * (yz + wx); m[8] = 1 - 2 * (xx + yy);
  return m;
}
function qStep(q, w, h) {
  const [qw, qx, qy, qz] = q, hx = 0.5 * h * w[0], hy = 0.5 * h * w[1], hz = 0.5 * h * w[2];
  q[0] = qw + (-qx * hx - qy * hy - qz * hz); q[1] = qx + (qw * hx + qy * hz - qz * hy);
  q[2] = qy + (qw * hy + qz * hx - qx * hz); q[3] = qz + (qw * hz + qx * hy - qy * hx);
  const n = Math.hypot(q[0], q[1], q[2], q[3]); q[0] /= n; q[1] /= n; q[2] /= n; q[3] /= n;
}
const qFromAxisAngle = (ax, ay, az, a) => { const s = Math.sin(a / 2), n = Math.hypot(ax, ay, az) || 1; return [Math.cos(a / 2), ax / n * s, ay / n * s, az / n * s]; };

// the soft step: 0 at d = −1, 1 at d = 1, the cubic between (d is in cells)
const soft = (d) => (d <= -1 ? 0 : d >= 1 ? 1 : 0.5 + 0.75 * d - 0.25 * d * d * d);

// ---- the water under the body: a plane + curvature fitted to a ring of surface samples ----
// Samples at the centre, a ring of 4 at 0.5·ρ and a ring of 4 at ρ (the footprint's radius ρ); the fit has four unknowns
// (a, b, c, k), solved by the pre-computed least-squares matrix, since the layout is fixed.
export class WaterFit {
  constructor(radius) {
    this.rho = radius;
    this.pts = [[0, 0]];
    for (const [f, n, ph] of [[0.5, 4, 0], [1, 4, Math.PI / 4]]) for (let i = 0; i < n; i++) { const a = ph + 2 * PI * i / n; this.pts.push([f * radius * Math.cos(a), f * radius * Math.sin(a)]); }
    // normal equations for [1, x, z, x² + z²]
    const A = this.pts.map(([x, z]) => [1, x, z, x * x + z * z]);
    const N = Array.from({ length: 4 }, (_, i) => Array.from({ length: 4 }, (_, j) => A.reduce((s, r) => s + r[i] * r[j], 0)));
    this.inv = invert4(N); this.A = A;
    this.coef = { a: 0, b: 0, c: 0, k: 0, ox: 0, oz: 0 };
  }
  // sample the surface about (ox, oz) at time t
  sample(surface, ox, oz, t, out = {}) {
    const rhs = [0, 0, 0, 0];
    for (let i = 0; i < this.pts.length; i++) {
      const [x, z] = this.pts[i], h = surface.heightAt(ox + x, oz + z, t);
      for (let j = 0; j < 4; j++) rhs[j] += this.A[i][j] * h;
    }
    const c = this.inv.map((row) => row[0] * rhs[0] + row[1] * rhs[1] + row[2] * rhs[2] + row[3] * rhs[3]);
    out.a = c[0]; out.b = c[1]; out.c = c[2]; out.k = c[3]; out.ox = ox; out.oz = oz;
    return out;
  }
}
function invert4(M) {
  const n = 4, A = M.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
    [A[i], A[p]] = [A[p], A[i]];
    const d = A[i][i]; for (let j = 0; j < 2 * n; j++) A[i][j] /= d;
    for (let r = 0; r < n; r++) if (r !== i) { const f = A[r][i]; for (let j = 0; j < 2 * n; j++) A[r][j] -= f * A[i][j]; }
  }
  return A.map((r) => r.slice(n));
}

// ---- the anchor rode: a catenary between the anchor on the bed and the ring at the mark ----
// For the depth h (bed to ring) and L m of rode (scope × depth), a horizontal pull H gives the horizontal reach X(H) and
// the hanging length s(H) (its weight pulls the ring down). Tabulated once (the catenary of src/boat/tackle.js) with the
// rope's stretch added, then read by interpolation: pull(X) → { H, V }.
export function makeRode({ depth, scope = 3, w = 6, ea = 25000, ringUp = 0 }) {
  const h = Math.max(1, depth + ringUp), L = Math.max(scope * depth, h * 1.05);
  const Hs = [], Xs = [], Vs = [];
  let H = 0.5;
  for (let i = 0; i < 90; i++, H *= 1.12) {
    const c = catenaryX(H, h, L, w);
    Hs.push(H); Xs.push(c.X + L * H / ea); Vs.push(w * Math.min(c.s, L));
  }
  const X0 = L - h;   // under this reach the rode lies slack on the bed
  function pull(X) {
    if (X <= Xs[0]) return { H: 0, V: w * h };
    const n = Hs.length;
    if (X >= Xs[n - 1]) return { H: Hs[n - 1] * (1 + (X - Xs[n - 1]) * 40), V: Vs[n - 1] };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (Xs[m] < X) lo = m; else hi = m; }
    const f = (X - Xs[lo]) / (Xs[hi] - Xs[lo]);
    return { H: Hs[lo] + (Hs[hi] - Hs[lo]) * f, V: Vs[lo] + (Vs[hi] - Vs[lo]) * f };
  }
  return { pull, L, h, X0, w, scope };
}

const mul3 = (m, x, y, z, o) => { o[0] = m[0] * x + m[1] * y + m[2] * z; o[1] = m[3] * x + m[4] * y + m[5] * z; o[2] = m[6] * x + m[7] * y + m[8] * z; return o; };
const mulT3 = (m, x, y, z, o) => { o[0] = m[0] * x + m[3] * y + m[6] * z; o[1] = m[1] * x + m[4] * y + m[7] * z; o[2] = m[2] * x + m[5] * y + m[8] * z; return o; };

export class FloatBody {
  constructor(type, { zeta = null } = {}) {
    const T = typeof type === 'string' ? MARK_TYPES[type] : type;
    this.T = T; this.mass = T.mass; this.zeta = zeta ?? T.zeta ?? { heave: 0.5, tilt: 0.5 };
    const s = spacing(T), inside = insideFn(T), [ex, ey, ez] = extent(T);
    const xs = [], ys = [], zs = [];
    const cells = (e) => { const c = Math.ceil(2 * e / s); return Array.from({ length: c }, (_, i) => (i - (c - 1) / 2) * s); };   // a grid symmetric about 0
    for (const x of cells(ex)) for (const y of cells(ey)) for (const z of cells(ez)) if (inside(x, y, z)) { xs.push(x); ys.push(y); zs.push(z); }
    // the shapes are symmetric about the vertical axis (the committee boat about its keel line): centre the lattice's centroid on it
    { const mz = zs.reduce((a, b) => a + b, 0) / zs.length; for (let i = 0; i < zs.length; i++) zs[i] -= mz;
      if (T.shape !== 'committee') { const mx = xs.reduce((a, b) => a + b, 0) / xs.length; for (let i = 0; i < xs.length; i++) xs[i] -= mx; } }
    const n = xs.length, V0 = shapeVolume(T);
    this.n = n; this.dV = V0 ? V0 / n : s * s * s; this.volume = this.dV * n;
    this.delta = s;   // the soft step's half-width, m
    this.cg = T.cg;
    this.lx = Float64Array.from(xs); this.ly = Float64Array.from(ys, (y) => y - T.cg); this.lz = Float64Array.from(zs);
    // inertia about the centre of mass: the lattice at uniform density, × 1.5 for an inflated shell and its ballast
    let ix = 0, iy = 0, iz = 0;
    for (let i = 0; i < n; i++) { ix += this.ly[i] ** 2 + this.lz[i] ** 2; iy += this.lx[i] ** 2 + this.lz[i] ** 2; iz += this.lx[i] ** 2 + this.ly[i] ** 2; }
    const k = T.mass / n * 1.5;
    this.I = [ix * k, iy * k, iz * k];
    // added mass: heave from the waterplane disc (set once the design draft is known), the sway/surge from the hull's wet half
    this.q = [1, 0, 0, 0]; this.p = [0, 0, 0]; this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.R = new Float64Array(9);
    this.ringLocal = [T.ring[0], T.ring[1] - T.cg, T.ring[2]];
    this.extra = T.extra ?? null;
    this.out = { vsub: 0, awp: 0, fy: 0, cx: 0, cy: 0, cz: 0, dryN: 0, dx: 0, dy: 0, dz: 0, torque: [0, 0, 0], depth: 0 };
    this.fitPrev = null; this.fit = null;
    this.rode = null; this.anchor = null; this.ring = [0, 0, 0];
    this.touch = { cool: 0 };
    this._tmp = [0, 0, 0]; this._tmp2 = [0, 0, 0];
    // the design pose in flat water (also the added mass and the tilt stiffness)
    this.design = this.settleStatic();
    const rwp = Math.sqrt(Math.max(1e-4, this.design.awp / PI));
    this.mAddV = Math.max(0.3 * T.mass, 4 / 3 * RHO * rwp ** 3);   // a disc on the surface: half of (8/3) ρ r³
    this.mAddH = 0.5 * RHO * this.design.vsub;
    this.kTilt = this.tiltStiffness();
    this.reset(0, 0, 0);
  }

  // the loads of the pose in the plane: fills this.out (buoyancy, its moment about the CoM, waterplane, centroids)
  loads(plane) {
    const o = this.out, R = this.R, px = this.p[0], py = this.p[1], pz = this.p[2];
    let vs = 0, awp = 0, fy = 0, cx = 0, cy = 0, cz = 0, tx = 0, ty = 0, tz = 0, dn = 0, dx = 0, dy = 0, dz = 0, low = Infinity;
    const { a, b, c, k, ox, oz } = plane, inv = 1 / this.delta, rg = RHO * G * this.dV;
    for (let i = 0; i < this.n; i++) {
      const lx = this.lx[i], ly = this.ly[i], lz = this.lz[i];
      const rx = R[0] * lx + R[1] * ly + R[2] * lz, ry = R[3] * lx + R[4] * ly + R[5] * lz, rz = R[6] * lx + R[7] * ly + R[8] * lz;
      const wx = px + rx, wy = py + ry, wz = pz + rz, ex = wx - ox, ez = wz - oz;
      const eta = a + b * ex + c * ez + k * (ex * ex + ez * ez), d = (eta - wy) * inv;
      const S = soft(d);
      if (S > 0) {
        const f = rg * S;
        fy += f; vs += this.dV * S; cx += wx * S; cy += wy * S; cz += wz * S;
        // moment of an upward force f at r about the centre of mass: r × (0, f, 0) = (−rz f, 0, rx f)
        tx += -rz * f; tz += rx * f;
        if (d > -1 && d < 1) awp += rg * 0.75 * (1 - d * d) * inv;   // N per m of rise: ρ g A_wp
        if (wy - eta < low) low = wy - eta;
      }
      if (S < 1) { const dw = 1 - S; dn += dw; dx += wx * dw; dy += wy * dw; dz += wz * dw; }
    }
    o.vsub = vs; o.awp = awp / (RHO * G); o.fy = fy; o.torque[0] = tx; o.torque[1] = ty; o.torque[2] = tz;
    o.cx = vs > 0 ? cx / (vs / this.dV) : px; o.cy = vs > 0 ? cy / (vs / this.dV) : py; o.cz = vs > 0 ? cz / (vs / this.dV) : pz;
    o.dryN = dn; o.dx = dn > 0 ? dx / dn : px; o.dy = dn > 0 ? dy / dn : py; o.dz = dn > 0 ? dz / dn : pz;
    return o;
  }

  reset(x, z, t, { eta = 0, yaw = 0 } = {}) {
    this.q = qFromAxisAngle(0, 1, 0, yaw); qMat(this.q, this.R);
    this.p = [x, eta + this.design.cgHeight, z]; this.v = [0, 0, 0]; this.w = [0, 0, 0];
    this.fit = { a: eta, b: 0, c: 0, k: 0, ox: x, oz: z }; this.fitPrev = { ...this.fit }; this.fitT = t;
  }

  // flat water at 0, upright: the CoM height where the push equals the weight; returns { cgHeight, draft, awp, vsub }
  settleStatic() {
    const flat = { a: 0, b: 0, c: 0, k: 0, ox: 0, oz: 0 };
    this.q = [1, 0, 0, 0]; qMat(this.q, this.R); this.p = [0, 0, 0];
    let lo = -3, hi = 3;
    for (let i = 0; i < 60; i++) { this.p[1] = (lo + hi) / 2; this.loads(flat); if (this.out.fy > this.mass * G) lo = this.p[1]; else hi = this.p[1]; }
    this.loads(flat);
    const bottom = this.T.shape === 'sphere' ? -this.T.R : this.T.shape === 'cylinder' ? -this.T.H / 2 : this.T.shape === 'tetra' ? -this.T.H / 4 : -0.85;
    return { cgHeight: this.p[1], draft: -(this.p[1] + bottom - this.cg), awp: this.out.awp, vsub: this.out.vsub };
  }
  // the tilt stiffness K = restoring moment / angle about a horizontal axis, at the design draft (re-heaved to the same push)
  tiltStiffness(theta = 0.07) {
    const flat = { a: 0, b: 0, c: 0, k: 0, ox: 0, oz: 0 };
    this.q = qFromAxisAngle(1, 0, 0, theta); qMat(this.q, this.R);
    let lo = -3, hi = 3;
    for (let i = 0; i < 60; i++) { this.p[1] = (lo + hi) / 2; this.loads(flat); if (this.out.fy > this.mass * G) lo = this.p[1]; else hi = this.p[1]; }
    this.loads(flat);
    return Math.max(1, Math.abs(this.out.torque[0]) / theta);
  }

  // The state's pose for the renderer: the geometric centre, not the centre of mass
  centre(out = [0, 0, 0]) {
    qMat(this.q, this.R); const R = this.R, c = this.cg;   // CoM = centre + R·(0, cg, 0)  →  centre = CoM − R·(0, cg, 0)
    out[0] = this.p[0] - R[1] * c; out[1] = this.p[1] - R[4] * c; out[2] = this.p[2] - R[7] * c;
    return out;
  }
  worldPoint(local, out = [0, 0, 0]) {   // a local point (relative to the geometric centre) in the world
    const R = this.R, x = local[0], y = local[1] - this.cg, z = local[2];
    out[0] = this.p[0] + R[0] * x + R[1] * y + R[2] * z; out[1] = this.p[1] + R[3] * x + R[4] * y + R[5] * z; out[2] = this.p[2] + R[6] * x + R[7] * y + R[8] * z;
    return out;
  }
  velocityAt(wx, wy, wz, out = [0, 0, 0]) {
    const rx = wx - this.p[0], ry = wy - this.p[1], rz = wz - this.p[2], w = this.w;
    out[0] = this.v[0] + w[1] * rz - w[2] * ry; out[1] = this.v[1] + w[2] * rx - w[0] * rz; out[2] = this.v[2] + w[0] * ry - w[1] * rx;
    return out;
  }
  tiltDeg() { const R = this.R; return Math.acos(Math.max(-1, Math.min(1, R[4]))) * 180 / PI; }

  // advance h seconds. ctx: { fit (the water plane now), fitRate (its change per second: a, b, c, k), wind: [vx, vz] at 1 m, current: [vx, vz], extraForce(body, h) }
  step(h, ctx) {
    qMat(this.q, this.R);
    const T = this.T, plane = ctx.fit, o = this.loads(plane);
    const m = this.mass, p = this.p, v = this.v, w = this.w;
    let Fx = 0, Fy = o.fy - m * G, Fz = 0, Tx = o.torque[0], Ty = o.torque[1], Tz = o.torque[2];
    // the water's own motion at the body: the plane's rate at the centre (vertical), the current (horizontal)
    const rate = ctx.fitRate ?? ZERO_RATE, wetFrac = Math.min(1, o.vsub / Math.max(1e-6, this.design.vsub));
    const wv = rate.a + rate.b * 0 + rate.c * 0;   // the surface's vertical speed under the centre
    const cur = ctx.current ?? ZERO2;
    // heave radiation damping: a fraction of critical on the waterplane stiffness (applies to the motion relative to the water)
    const cH = 2 * this.zeta.heave * Math.sqrt(Math.max(0, o.awp) * RHO * G * (m + this.mAddV));
    Fy -= cH * (v[1] - wv);
    // drag on the submerged part (relative to the current), at the submerged centroid
    if (o.vsub > 1e-5) {
      const rx = o.cx - p[0], ry = o.cy - p[1], rz = o.cz - p[2];
      const ux = v[0] + w[1] * rz - w[2] * ry - cur[0], uz = v[2] + w[0] * ry - w[1] * rx - cur[1], sp = Math.hypot(ux, uz);
      const A = 1.6 * Math.pow(o.vsub, 2 / 3), k = 0.5 * RHO * T.cdWater * A;
      const dfx = -(k * sp + 12 * wetFrac) * ux, dfz = -(k * sp + 12 * wetFrac) * uz;
      Fx += dfx; Fz += dfz;
      Tx += ry * dfz - 0; Ty += rz * dfx - rx * dfz; Tz += -ry * dfx;   // r × F with F = (dfx, 0, dfz)
    }
    // windage on the dry part, at the dry centroid; the extra area (a pole and flag, a cabin) at its own height
    if (ctx.wind) {
      const frac = o.dryN / this.n;
      const ax = ctx.wind[0] - v[0], az = ctx.wind[1] - v[2], sp = Math.hypot(ax, az), q = 0.5 * RHO_AIR * T.cdAir * sp;
      const A = T.Aref * frac;
      const wfx = q * A * ax, wfz = q * A * az;
      Fx += wfx; Fz += wfz;
      const rx = o.dx - p[0], ry = o.dy - p[1], rz = o.dz - p[2];
      Tx += ry * wfz; Ty += rz * wfx - rx * wfz; Tz += -ry * wfx;
      if (this.extra) {
        const e = this.worldPoint([0, this.extra.y, 0], this._tmp);
        const efx = q * this.extra.A * ax, efz = q * this.extra.A * az, ey = e[1] - p[1], ex = e[0] - p[0], ez = e[2] - p[2];
        Fx += efx; Fz += efz; Tx += ey * efz; Ty += ez * efx - ex * efz; Tz += -ey * efx;
      }
    }
    // the rode, at the ring
    if (this.rode && this.anchor) {
      const r = this.worldPoint(T.ring, this.ring), dx = this.anchor.x - r[0], dz = this.anchor.z - r[2], X = Math.hypot(dx, dz) || 1e-6;
      const { H, V } = this.rode.pull(X);
      const ux = dx / X, uz = dz / X;
      const rv = this.velocityAt(r[0], r[1], r[2], this._tmp2);
      const along = rv[0] * ux + rv[2] * uz;   // + toward the anchor; a taut rode checks the motion either way (a damper)
      const dampF = -along * Math.min(1, H / 40) * 80;
      const gx = (H + dampF) * ux, gz = (H + dampF) * uz, fy = -V;
      Fx += gx; Fz += gz; Fy += fy;
      const rx = r[0] - p[0], ry = r[1] - p[1], rz = r[2] - p[2];
      Tx += ry * gz - rz * fy; Ty += rz * gx - rx * gz; Tz += rx * fy - ry * gx;
      this.rodePull = H;
    }
    if (ctx.extraForce) { const e = ctx.extraForce(this); if (e) { Fx += e[0]; Fy += e[1]; Fz += e[2]; } }
    // integrate: semi-implicit Euler; the added mass sits in the inertia of the motion, not of the weight
    const mh = m + this.mAddH, mv = m + this.mAddV;
    v[0] += Fx / mh * h; v[1] += Fy / mv * h; v[2] += Fz / mh * h;
    // angular: the body frame's principal axes
    mulT3(this.R, Tx, Ty, Tz, this._tmp);
    // tilt damping (a fraction of critical on the stiffness) and spin damping, in the body frame
    mulT3(this.R, w[0], w[1], w[2], this._tmp2);
    const Ix = this.I[0] * 1.3, Iy = this.I[1] * 1.1, Iz = this.I[2] * 1.3;
    const cT = 2 * this.zeta.tilt * Math.sqrt(this.kTilt * Math.max(Ix, Iz));
    const wet = Math.max(0.15, wetFrac);
    const tb0 = this._tmp[0] - cT * this._tmp2[0] * wet, tb1 = this._tmp[1] - 3 * Iy * wet * this._tmp2[1] - 0.05 * this._tmp2[1] * Math.abs(this._tmp2[1]) * Iy, tb2 = this._tmp[2] - cT * this._tmp2[2] * wet;
    this._tmp2[0] += tb0 / Ix * h; this._tmp2[1] += tb1 / Iy * h; this._tmp2[2] += tb2 / Iz * h;
    mul3(this.R, this._tmp2[0], this._tmp2[1], this._tmp2[2], w);
    p[0] += v[0] * h; p[1] += v[1] * h; p[2] += v[2] * h;
    qStep(this.q, w, h);
    qMat(this.q, this.R);
  }
}
const ZERO_RATE = { a: 0, b: 0, c: 0, k: 0 }, ZERO2 = [0, 0];
