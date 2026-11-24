// A kayak against the sailboat (feat/kayaks-lake step 3, § 10): two bodies, never one through the other, and
// the sailboat's wash rocking a kayak near it. Plain JS on the boat's physics state ({ x, z, heading, u, v, yawRate }:
// src/boat.js) and a kayak agent (src/kayaks/agent.js: x, z, heading, v, r and its drift pvx, pvz).
//
//   const c = kayakContact(boatState, agent)   // after both moved: null, or { pen, j (N·s), x, z, dvBoat (m/s) }
//   wakeRock(boat, agent, dt)                  // the wash: agent.rock (roll amplitude, rad) eased up near the boat, decaying
//
// The kayak is its waterline: an ellipse 3.4 × 0.78 m sampled at 16 points, and the boat's 30-point outline (the race's,
// src/race/contact.js). Every kayak point inside the hull, or hull point inside the kayak, is a contact: an impulse along the
// hull's outward normal with both masses (the kayak 108 kg, 1.5 × in sway for its added mass, 120 kg·m² in yaw; the boat's
// surge, sway and yaw: src/boat.js BOAT), little restitution (0.15: soft plastic on gelcoat), little friction (0.08: wet plastic slides along wet gelcoat, so a kayak caught on the bow slides off it rather than being carried); then the kayak
// alone moves out of the hull (the boat is 40 × heavier), so nothing is ever left inside. A gentle shove: at 3 m/s the kayak
// is pushed aside at ≈ 1–2 m/s and spun; the boat loses a few centimetres a second.
import { OUTLINE_POLY, outlineDistance, toBody, invMass, push } from '../race/contact.js';
import { HULL } from './agent.js';

const KAYAK_BODY = Object.freeze({ L: 3.4, B: 0.78, sway: 1.5, e: 0.15, mu: 0.08, slop: 0.02, n: 16 });
const DEG = Math.PI / 180;

// the kayak's waterline points (world) and a point's place in the kayak's ellipse (< 1 inside)
function kayakPoints(a, K = KAYAK_BODY) {
  const out = [], fx = Math.sin(a.heading), fz = -Math.cos(a.heading), sx = Math.cos(a.heading), sz = Math.sin(a.heading);
  for (let i = 0; i < K.n; i++) {
    const t = i / K.n * Math.PI * 2, lf = Math.cos(t) * K.L / 2, ls = Math.sin(t) * K.B / 2;
    out.push([a.x + fx * lf + sx * ls, a.z + fz * lf + sz * ls, lf, ls]);
  }
  return out;
}
function inKayak(a, wx, wz, K = KAYAK_BODY) {
  const dx = wx - a.x, dz = wz - a.z, lf = dx * Math.sin(a.heading) - dz * Math.cos(a.heading), ls = dx * Math.cos(a.heading) + dz * Math.sin(a.heading);
  return { e: (lf / (K.L / 2)) ** 2 + (ls / (K.B / 2)) ** 2, lf, ls };
}
const toWorldB = (s, bx, by) => [s.x + bx * Math.sin(s.heading) + by * Math.cos(s.heading), s.z - bx * Math.cos(s.heading) + by * Math.sin(s.heading)];
const vecW = (h, bx, by) => [bx * Math.sin(h) + by * Math.cos(h), -bx * Math.cos(h) + by * Math.sin(h)];

// the kayak's velocity at a point (lf ahead, ls to starboard of its centre): its surge, its drift and its yaw
function kayakPointVel(a, lf, ls) {
  const fx = Math.sin(a.heading), fz = -Math.cos(a.heading), sx = Math.cos(a.heading), sz = Math.sin(a.heading);
  const r = a.r ?? 0;   // + to starboard: a point ahead moves to starboard
  return [fx * a.v + (a.pvx ?? 0) + sx * r * lf - fx * r * ls, fz * a.v + (a.pvz ?? 0) + sz * r * lf - fz * r * ls];
}
// the kayak's inverse mass along a world direction at a point
function kayakInvMass(a, nx, nz, lf, ls, K = KAYAK_BODY) {
  const nf = nx * Math.sin(a.heading) - nz * Math.cos(a.heading), ns = nx * Math.cos(a.heading) + nz * Math.sin(a.heading), arm = lf * ns - ls * nf;
  return nf * nf / HULL.M + ns * ns / (HULL.M * K.sway) + arm * arm / HULL.I;
}
// a world impulse on the kayak: its surge, its drift (sideways, world) and its spin
function kayakPush(a, jx, jz, lf, ls, K = KAYAK_BODY) {
  const fx = Math.sin(a.heading), fz = -Math.cos(a.heading), sx = Math.cos(a.heading), sz = Math.sin(a.heading);
  const jf = jx * fx + jz * fz, js = jx * sx + jz * sz;
  a.v += jf / HULL.M;
  a.pvx = (a.pvx ?? 0) + sx * js / (HULL.M * K.sway); a.pvz = (a.pvz ?? 0) + sz * js / (HULL.M * K.sway);
  a.r = (a.r ?? 0) + (lf * js - ls * jf) / HULL.I;
}

export function kayakContact(S, a, K = KAYAK_BODY) {
  if (Math.hypot(a.x - S.x, a.z - S.z) > 9) return null;
  let out = null;
  for (let pass = 0; pass < 8; pass++) {
    // the deepest kayak point in the hull, or hull point in the kayak (its normal then from the kayak's ellipse, flipped)
    let c = null;
    for (const [wx, wz, lf, ls] of kayakPoints(a, K)) {
      const [qx, qy] = toBody(S, wx, wz), q = outlineDistance(qx, qy);
      if (q.d < 0 && (!c || -q.d > c.pen)) { const [nx, nz] = vecW(S.heading, q.nx, q.ny); c = { pen: -q.d, wx, wz, nx, nz, lf, ls }; }
    }
    for (const [bx, by] of OUTLINE_POLY) {
      const [wx, wz] = toWorldB(S, bx, by), k = inKayak(a, wx, wz, K);
      if (k.e < 1) {
        const pen = (1 - Math.sqrt(k.e)) * K.B / 2;
        if (!c || pen > c.pen) {
          // the stem (or a quarter) in the kayak's side: pushed off sideways, to the side of the boat the kayak lies on, a
          // little ahead (a push straight ahead would carry a kayak draped over the stem along with the boat)
          const [, kby] = toBody(S, a.x, a.z), side = kby >= by ? 1 : -1;
          const [nx, nz] = vecW(S.heading, 0.35, side), nl = Math.hypot(nx, nz);
          c = { pen, wx, wz, nx: nx / nl, nz: nz / nl, lf: k.lf, ls: k.ls };
        }
      }
    }
    if (!c) break;
    const [bx, by] = toBody(S, c.wx, c.wz);
    const bvx = vecW(S.heading, S.u - S.yawRate * by, S.v + S.yawRate * bx);
    const [kvx, kvz] = kayakPointVel(a, c.lf, c.ls), rvx = kvx - bvx[0], rvz = kvz - bvx[1], vn = rvx * c.nx + rvz * c.nz;
    let j = 0, du = 0;
    if (vn < 0) {
      const im = kayakInvMass(a, c.nx, c.nz, c.lf, c.ls, K) + invMass(S, c.nx, c.nz, bx, by);
      j = -(1 + K.e) * vn / im;
      const u0 = S.u;
      kayakPush(a, c.nx * j, c.nz * j, c.lf, c.ls, K); push(S, -c.nx * j, -c.nz * j, bx, by);
      const tx = rvx - vn * c.nx, tz = rvz - vn * c.nz, tl = Math.hypot(tx, tz);
      if (tl > 1e-4) {
        const ux = tx / tl, uz = tz / tl, jt = Math.min(K.mu * j, tl / (kayakInvMass(a, ux, uz, c.lf, c.ls, K) + invMass(S, ux, uz, bx, by)));
        kayakPush(a, -ux * jt, -uz * jt, c.lf, c.ls, K); push(S, ux * jt, uz * jt, bx, by);
      }
      du = S.u - u0;
    }
    // the kayak alone out of the hull (the boat is ≈ 40 × heavier): never left inside
    a.x += c.nx * (c.pen + K.slop); a.z += c.nz * (c.pen + K.slop);
    out = { pen: Math.max(out?.pen ?? 0, c.pen), j: (out?.j ?? 0) + j, x: c.wx, z: c.wz, dvBoat: (out?.dvBoat ?? 0) + du };
  }
  return out;
}

// the smallest gap between the hull and the kayak (m; < 0 overlapping): the tests' check
export function kayakGap(S, a, K = KAYAK_BODY) {
  let m = Infinity;
  for (const [wx, wz] of kayakPoints(a, K)) { const [qx, qy] = toBody(S, wx, wz); m = Math.min(m, outlineDistance(qx, qy).d); }
  for (const [bx, by] of OUTLINE_POLY) { const [wx, wz] = toWorldB(S, bx, by), k = inKayak(a, wx, wz, K); if (k.e < 1) m = Math.min(m, -(1 - Math.sqrt(k.e)) * K.B / 2); }
  return m;
}

// the drift a shove left (sideways, world): it dies in the water's grip on the hull (≈ 1.2 s); the spin the hull model's own
export function drift(a, dt) {
  if (!a.pvx && !a.pvz) return;
  a.x += a.pvx * dt; a.z += a.pvz * dt;
  const k = Math.exp(-dt / 1.2); a.pvx *= k; a.pvz *= k;
  if (Math.hypot(a.pvx, a.pvz) < 0.005) a.pvx = a.pvz = 0;
}

// The wash ("rocks in the boat's waves"): the boat's diverging waves trail back from its bow at ≈ 19° (the
// Kelvin angle) and spread; a kayak near that wedge, close behind or beside the boat, is rocked: the amplitude rises with
// the boat's speed and falls with the distance (about 6° at 5 m beside a boat at 3.5 m/s, a gentle 2° at 20 m), eased in
// over ≈ 0.4 s, dying over ≈ 3 s. The roll's period is the kayak's own (≈ 1.1 s); a contact adds a bigger wobble.
const WAKE = Object.freeze({ maxDeg: 8, speedRef: 3.5, scale: 9, rise: 0.4, fall: 3.0, hz: 1.1 });
export function wakeRock(S, a, dt, W = WAKE) {
  const sog = Math.hypot(S.u ?? 0, S.v ?? 0), dx = a.x - S.x, dz = a.z - S.z;
  const along = dx * Math.sin(S.heading) - dz * Math.cos(S.heading), across = Math.abs(dx * Math.cos(S.heading) + dz * Math.sin(S.heading));
  let want = 0;
  if (along < 5 && along > -80 && sog > 0.5) {
    const wedge = Math.max(0, -along + 5) * Math.tan(19 * DEG);   // the wave's lateral reach at that distance behind the bow
    const off = Math.abs(across - wedge);                          // how far the kayak is from the wave line
    want = W.maxDeg * DEG * Math.min(1, sog / W.speedRef) * Math.exp(-off / W.scale) * Math.exp(-Math.hypot(along, across) / 40);
  }
  const k = want > (a.rock ?? 0) ? 1 - Math.exp(-dt / W.rise) : 1 - Math.exp(-dt / W.fall);
  a.rock = (a.rock ?? 0) + (want - (a.rock ?? 0)) * k;
  a.rockPh = ((a.rockPh ?? (a.slot?.seed ?? 1) * 0.37) + dt * W.hz * Math.PI * 2) % (Math.PI * 2);
  return a.rock * Math.sin(a.rockPh);   // the roll now (rad)
}
