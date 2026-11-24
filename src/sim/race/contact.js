// Two hulls against each other (fix/no-poor-props, 2026-11-05): in Regatta the rival's boat was a ghost, our boat sailed
// through it. Each hull is its waterline outline (src/boat/tackle.js hullOutline, the dock's 30 points, as a polygon);
// every outline point of one boat inside the other's polygon is a contact. Per contact: an impulse along the other hull's
// outward normal with the two boats' masses (surge and sway added mass, yaw inertia: src/boat.js BOAT, the same sums as a
// mark's contact in src/marks/field.js), little restitution (0.1: fendered gelcoat, a rub, not a bounce), Coulomb friction
// (0.3), then both poses moved apart along the normal so the gap is closed (no hull is ever left inside the other).
// Plain JS on the physics states ({ x, z, heading, u, v, yawRate }); body frame x forward, y starboard; heading clockwise from
// north; world x east, z south.
//   const c = hullContact(stateA, stateB);   // after both boats stepped: null, or { pen, j, x, z } (the deepest point)
import { hullOutline } from '../boat/tackle.js';
import { BOAT } from '../boat.js';
import { DEFAULT_DIMS } from '../boat/dims.js';

const HULL_CONTACT = { e: 0.1, mu: 0.3, slop: 0.005 };
// the hulls' shape: this page's boat's (its dims; both boats in a race are one class today)
const { HULL } = DEFAULT_DIMS;
export const OUT = hullOutline(15, HULL);
// the outline as a closed polygon: starboard side stern → bow, then port bow → stern
const POLY = [...OUT.filter(([, y]) => y >= 0).sort((a, b) => a[0] - b[0]), ...OUT.filter(([, y]) => y < 0).sort((a, b) => b[0] - a[0])];
export const OUTLINE_POLY = POLY;   // (the kayaks' contact, src/kayaks/contact.js)
const CX = POLY.reduce((s, p) => s + p[0], 0) / POLY.length;   // the polygon's centre (x; y is 0 by symmetry)
const REACH = HULL.loa + 0.5;   // centres farther apart than this cannot touch

export const toWorld = (s, bx, by) => [s.x + bx * Math.sin(s.heading) + by * Math.cos(s.heading), s.z - bx * Math.cos(s.heading) + by * Math.sin(s.heading)];
export const toBody = (s, wx, wz) => { const dx = wx - s.x, dz = wz - s.z, sh = Math.sin(s.heading), ch = Math.cos(s.heading); return [dx * sh - dz * ch, dx * ch + dz * sh]; };
const vecToWorld = (h, bx, by) => [bx * Math.sin(h) + by * Math.cos(h), -bx * Math.cos(h) + by * Math.sin(h)];

// signed distance from a body-frame point to the polygon (< 0 inside) and the outward normal (body frame) at the nearest edge
export function outlineDistance(px, py) {
  let best = Infinity, nx = 0, ny = 0, inside = false;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [ax, ay] = POLY[j], [bx, by] = POLY[i];
    if ((ay > py) !== (by > py) && px < (bx - ax) * (py - ay) / (by - ay) + ax) inside = !inside;
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L2));
    const cx = ax + ex * t, cy = ay + ey * t, d = Math.hypot(px - cx, py - cy);
    if (d < best) {   // the edge's outward normal: away from the centre (the outline is convex)
      best = d; const l = Math.hypot(ey, ex) || 1; nx = ey / l; ny = -ex / l;
      if (nx * ((ax + bx) / 2 - CX) + ny * (ay + by) / 2 < 0) { nx = -nx; ny = -ny; }
    }
  }
  return { d: inside ? -best : best, nx, ny };
}

// the inverse effective mass of a boat along a world direction (ax, az) at body offset (px forward, py starboard)
export function invMass(s, ax, az, px, py) {
  const sh = Math.sin(s.heading), ch = Math.cos(s.heading), af = ax * sh - az * ch, as = ax * ch + az * sh, arm = px * as - py * af;
  return af * af / (BOAT.mass * BOAT.m11) + as * as / (BOAT.mass * BOAT.m22) + arm * arm / BOAT.izz;
}
// apply a world impulse (jx, jz) at body offset (px, py)
export function push(s, jx, jz, px, py) {
  const sh = Math.sin(s.heading), ch = Math.cos(s.heading), jf = jx * sh - jz * ch, js = jx * ch + jz * sh;
  s.u += jf / (BOAT.mass * BOAT.m11); s.v += js / (BOAT.mass * BOAT.m22); s.yawRate += (px * js - py * jf) / BOAT.izz;
}
export const pointVel = (s, px, py) => vecToWorld(s.heading, s.u - s.yawRate * py, s.v + s.yawRate * px);

// the deepest point of A's outline inside B: { pen, px, pz (world), nx, nz (world, out of B toward A) } or null
function deepest(A, B) {
  let worst = null;
  for (const [bx, by] of OUT) {
    const [wx, wz] = toWorld(A, bx, by), [qx, qy] = toBody(B, wx, wz), q = outlineDistance(qx, qy);
    if (q.d < 0 && (!worst || q.d < -worst.pen)) { const [nx, nz] = vecToWorld(B.heading, q.nx, q.ny); worst = { pen: -q.d, wx, wz, nx, nz }; }
  }
  return worst;
}

export function hullContact(A, B, C = HULL_CONTACT) {
  if (Math.hypot(A.x - B.x, A.z - B.z) > REACH) return null;
  let out = null;
  for (let pass = 0; pass < 4; pass++) {
    // A's points in B (normal out of B, toward A), or B's points in A (flip it so it still points from B to A)
    const a = deepest(A, B), b = deepest(B, A);
    const c = a && (!b || a.pen >= b.pen) ? a : b ? { ...b, nx: -b.nx, nz: -b.nz } : null;
    if (!c) break;
    const { wx, wz, nx, nz, pen } = c;
    const [ax, ay] = toBody(A, wx, wz), [bx, by] = toBody(B, wx, wz);
    const [vax, vaz] = pointVel(A, ax, ay), [vbx, vbz] = pointVel(B, bx, by), rvx = vax - vbx, rvz = vaz - vbz, vn = rvx * nx + rvz * nz;
    let j = 0;
    if (vn < 0) {   // closing: the normal impulse, then friction along the slide
      j = -(1 + C.e) * vn / (invMass(A, nx, nz, ax, ay) + invMass(B, nx, nz, bx, by));
      push(A, nx * j, nz * j, ax, ay); push(B, -nx * j, -nz * j, bx, by);
      const tx = rvx - vn * nx, tz = rvz - vn * nz, tl = Math.hypot(tx, tz);
      if (tl > 1e-4) {
        const ux = tx / tl, uz = tz / tl, jt = Math.min(C.mu * j, tl / (invMass(A, ux, uz, ax, ay) + invMass(B, ux, uz, bx, by)));
        push(A, -ux * jt, -uz * jt, ax, ay); push(B, ux * jt, uz * jt, bx, by);
      }
    }
    // never left inside: each moves half the overlap apart
    const d = (pen + C.slop) / 2;
    A.x += nx * d; A.z += nz * d; B.x -= nx * d; B.z -= nz * d;
    out = { pen: Math.max(out?.pen ?? 0, pen), j: (out?.j ?? 0) + j, x: wx, z: wz };
  }
  return out;
}

// the smallest gap between the two outlines (m; < 0 overlapping): the tests' check
export function hullGap(A, B) {
  let m = Infinity;
  for (const [bx, by] of OUT) { const [wx, wz] = toWorld(A, bx, by), [qx, qy] = toBody(B, wx, wz); m = Math.min(m, outlineDistance(qx, qy).d); }
  for (const [bx, by] of OUT) { const [wx, wz] = toWorld(B, bx, by), [qx, qy] = toBody(A, wx, wz); m = Math.min(m, outlineDistance(qx, qy).d); }
  return m;
}
