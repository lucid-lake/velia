// The show's props are solid (fix/barge-collision, owner 2026-11-09: "the boat just sails through it like a ghost"): the
// two barges with their pusher tugs, the four patrol boats and the two anchored spectator sailboats stop our boat. Each prop
// is a rigid body of simple convex plan outlines matched to its mesh (src/fireworks/barges.js, spectators.js): the barge
// a 60 × 18 m box, the tug an 8.2 × 22 m box behind it (its push knees closing the gap), the patrol boat its own pointed
// plan, a spectator sailboat our own hull's waterline (it is a clone of Halcyon). Plain JS, no three.js: tests drive it.
//
//   const solids = createSolids({ barges: bargesWorld(), toward: VIEW, wet, sailboats: [{ x, z, heading }] })
//   per boat tick (the physics' env.post, 60 Hz): solids.post(state, dt, t)   // moves the light props, bumps the boat
//   solids.setOn({ barges, crowd })        what is in the world now (world.js: only shown props are solid)
//   solids.setBargePose(i, { x, z, yaw })  a barge's tow (src/fireworks/presence.js): its tug and patrol boats with it
//   solids.bodies                          [{ kind, x, z, heading, dx, dz, dh, … }]: the drawn props read their pose here
//   solids.gap(state)                      the smallest gap to any solid (m, < 0 overlapping): the tests' check
//   chartObjects(showBodies(heightAt)) → [[x, z, r]]   the fixed objects for Cruise's chart (navigator.js buildChart extra)
//   blocked(x, z, margin)                  inside a solid's keep-out circle (the computer boats' clear(): src/race/rival.js)
//
// The contact (the race's hull against a hull, src/race/contact.js, with a fixed or a light second body): every point of
// our boat's 29-point waterline inside a prop's outline, or a prop's outline point (every 1.5 m) inside our hull, is a
// contact; the deepest takes an impulse along the outward normal with both masses (a barge or tug: none, it does not
// move; a patrol boat 4 t holding station on its engines; a spectator 3.8 t on its anchor), a little restitution (0.25:
// gelcoat on the tyre fenders and the steel rub rails: a bump, not a bounce), Coulomb friction (0.25: it slides along),
// then the overlap is closed (a fixed prop: all on our boat; a light one: shared by the masses). Nothing is ever left inside.
// A light prop then swings back to its station (a patrol boat in ≈ 12 s, a spectator on its rode in ≈ 14 s; shoved at most
// 6 m and 2.5 m).
// Frames as src/boat.js: body x forward, y starboard; heading clockwise from north; world x east, z south. A three.js
// group's rotation.y is −heading.
import { OUTLINE_POLY, outlineDistance, toBody, toWorld, invMass, push, pointVel } from '../../../src/sim/race/contact.js';
import { BARGE, PATROL, patrolAngle } from './barges.js';
import { bargesWorld, VIEW } from '../../../src/fireworks/stage.js';
import { sailboatSpots } from './spectators.js';

const SOLID = { e: 0.25, mu: 0.25, slop: 0.01, spacing: 1.5, passes: 6 };
// the light props: mass (kg, with the added mass), yaw inertia (kg·m²), the station's spring period and damping time (s),
// the farthest they are shoved off their station (m) and turned (rad)
const LIGHT = {
  patrol: { m: 4000, I: 4000 * (8.5 ** 2 + 2.7 ** 2) / 12 * 1.3, period: 12, tau: 2.5, maxOff: 6, maxTurn: 0.6 },
  sail: { m: 3765 * 1.4, I: 22000 * 1.2, period: 14, tau: 4, maxOff: 2.5, maxTurn: 0.35 },
};
const OUR_REACH = 4.6;   // our hull's farthest point from its origin (m)

// the props' plan outlines in their body frame (x forward, y starboard)
const rect = (x0, x1, y0, y1) => [[x1, y0], [x1, y1], [x0, y1], [x0, y0]];
// the barge (60 × 18 m deck, its bow at local −z: body +x) and the tug pushing at its stern (local z 31–51 m, 8 m beam with
// the 8.2 m sheer strake; the outline runs from the barge's stern at −30 m so the push knees' gap is closed)
export const BARGE_POLYS = [rect(-BARGE.length / 2, BARGE.length / 2, -BARGE.beam / 2, BARGE.beam / 2), rect(-(BARGE.length / 2 + 21), -(BARGE.length / 2 - 1), -4.1, 4.1)];
// the patrol boat's plan (barges.js: a square transom at local +z, straight sides to 2.6 m from the bow, a pointed bow at
// local −z), its rub rail 4 % wider
const PATROL_POLY = (() => {
  const L = PATROL.length / 2, B = PATROL.beam / 2 * 1.04;
  return [[L, 0], [L - 0.9, B * 0.72], [L - 2.6, B], [-L, B], [-L, -B], [L - 2.6, -B], [L - 0.9, -B * 0.72]];
})();
const SAIL_POLY = OUTLINE_POLY;

// signed distance from a body-frame point to a convex polygon (< 0 inside) and the outward normal there
function polyDistance(poly, px, py) {
  let best = Infinity, nx = 0, ny = 0, inside = true, cx = 0, cy = 0;
  for (const [x, y] of poly) { cx += x; cy += y; }
  cx /= poly.length; cy /= poly.length;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ax, ay] = poly[j], [bx, by] = poly[i];
    const ex = bx - ax, ey = by - ay, L2 = ex * ex + ey * ey || 1, t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / L2));
    const l = Math.sqrt(L2);
    let ox = ey / l, oy = -ex / l;   // the edge's outward normal: away from the centre (the outline is convex)
    if (ox * ((ax + bx) / 2 - cx) + oy * ((ay + by) / 2 - cy) < 0) { ox = -ox; oy = -oy; }
    if ((px - ax) * ox + (py - ay) * oy > 0) inside = false;
    const qx = ax + ex * t, qy = ay + ey * t, d = Math.hypot(px - qx, py - qy);
    if (d < best) { best = d; nx = ox; ny = oy; }
  }
  return { d: inside ? -best : best, nx, ny };
}
// a polygon's outline sampled every `step` m (its corners kept)
function densify(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
  }
  return out;
}
const radius = (polys) => Math.max(...polys.flat().map(([x, y]) => Math.hypot(x, y)));
const vecW = (h, bx, by) => [bx * Math.sin(h) + by * Math.cos(h), -bx * Math.cos(h) + by * Math.sin(h)];
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// the props as bodies: home pose (x0, z0, h0), the pose now (x, z, heading), the light ones' velocities (vx, vz, r)
function propBodies({ barges = [], toward = [0, 0], wet = null, sailboats = [] } = {}) {
  const bodies = [];
  const body = (o) => {
    const b = { vx: 0, vz: 0, r: 0, dh: 0, swing: null, on: true, armed: true, ...o };
    b.x0 = b.x; b.z0 = b.z; b.h0 = b.heading; b.R = radius(b.polys); b.pts = b.polys.flatMap((p) => densify(p, SOLID.spacing));
    bodies.push(b); return b;
  };
  barges.forEach((B, i) => {
    const ax = B.axis ?? [0, 1], yaw = Math.atan2(ax[0], ax[1]);
    body({ kind: 'barge', group: 'barges', barge: i, x: B.x, z: B.z, heading: -yaw, polys: BARGE_POLYS, light: null });
    // the patrol boats: their spot on the zone (barges.js), their group's rotation.y a + π/2 (heading −a − π/2)
    const base = Math.atan2(toward[0] - B.x, toward[1] - B.z);
    for (const s of [-1, 1]) {
      const a = patrolAngle(base, s, B, wet);
      body({ kind: 'patrol', group: 'barges', barge: i, side: s < 0 ? 0 : 1, x: B.x + Math.sin(a) * BARGE.zone, z: B.z + Math.cos(a) * BARGE.zone, heading: -a - Math.PI / 2, polys: [PATROL_POLY], light: LIGHT.patrol });
    }
  });
  // the spectators' sailboats swing round their anchors (spectators.js: heading h0 + 0.21 sin(0.07 t + ph))
  for (const s of sailboats) body({ kind: 'sail', group: 'crowd', x: s.x, z: s.z, heading: s.heading, swing: s.swing ?? null, polys: [SAIL_POLY], light: LIGHT.sail });
  return bodies;
}

// the deepest contact of our boat S with body P: { pen, wx, wz, nx, nz (world, out of P toward S) } or null
function deepest(S, P) {
  let c = null;
  for (const [bx, by] of OUTLINE_POLY) {   // our hull's points in the prop
    const [wx, wz] = toWorld(S, bx, by), [qx, qy] = toBody(P, wx, wz);
    for (const poly of P.polys) {
      const q = polyDistance(poly, qx, qy);
      if (q.d < 0 && (!c || -q.d > c.pen)) { const [nx, nz] = vecW(P.heading, q.nx, q.ny); c = { pen: -q.d, wx, wz, nx, nz }; }
    }
  }
  for (const [px, py] of P.pts) {          // the prop's outline in our hull (normal out of our hull, flipped)
    const [wx, wz] = toWorld(P, px, py), [qx, qy] = toBody(S, wx, wz);
    if (Math.abs(qx) > OUR_REACH || Math.abs(qy) > OUR_REACH) continue;
    const q = outlineDistance(qx, qy);
    if (q.d < 0 && (!c || -q.d > c.pen)) { const [nx, nz] = vecW(S.heading, q.nx, q.ny); c = { pen: -q.d, wx, wz, nx: -nx, nz: -nz }; }
  }
  return c;
}
// a light prop's inverse mass along a world direction at a world point, an impulse on it (its point velocity: solidContact)
function propInvMass(P, nx, nz, wx, wz) {
  if (!P.light) return 0;
  const rx = wx - P.x, rz = wz - P.z, arm = rx * nz - rz * nx;
  return 1 / P.light.m + arm * arm / P.light.I;
}
function propPush(P, jx, jz, wx, wz) {
  if (!P.light) return;
  P.vx += jx / P.light.m; P.vz += jz / P.light.m;
  P.r += ((wx - P.x) * jz - (wz - P.z) * jx) / P.light.I;   // + turns x toward z: clockwise from above, as the heading
}

// our boat S against one prop: impulses, then the overlap closed. → null or { pen, j, x, z }
function solidContact(S, P, C = SOLID) {
  if (!P.on || Math.hypot(P.x - S.x, P.z - S.z) > P.R + OUR_REACH + 0.5) return null;
  let out = null;
  for (let pass = 0; pass < C.passes; pass++) {
    const c = deepest(S, P);
    if (!c) break;
    const { wx, wz, nx, nz, pen } = c;
    const [ax, ay] = toBody(S, wx, wz), [vax, vaz] = pointVel(S, ax, ay);
    const pv = P.light ? [P.vx - P.r * (wz - P.z), P.vz + P.r * (wx - P.x)] : [0, 0];
    const rvx = vax - pv[0], rvz = vaz - pv[1], vn = rvx * nx + rvz * nz;
    let j = 0;
    if (vn < 0) {   // closing: the normal impulse, then friction along the slide
      j = -(1 + C.e) * vn / (invMass(S, nx, nz, ax, ay) + propInvMass(P, nx, nz, wx, wz));
      push(S, nx * j, nz * j, ax, ay); propPush(P, -nx * j, -nz * j, wx, wz);
      const tx = rvx - vn * nx, tz = rvz - vn * nz, tl = Math.hypot(tx, tz);
      if (tl > 1e-4) {
        const ux = tx / tl, uz = tz / tl, jt = Math.min(C.mu * j, tl / (invMass(S, ux, uz, ax, ay) + propInvMass(P, ux, uz, wx, wz)));
        push(S, -ux * jt, -uz * jt, ax, ay); propPush(P, ux * jt, uz * jt, wx, wz);
      }
    }
    // never left inside: a fixed prop moves our boat the whole overlap; a light one takes its share by the masses
    const share = P.light ? 3765 / (3765 + P.light.m) : 0, d = pen + C.slop;
    S.x += nx * d * (1 - share); S.z += nz * d * (1 - share);
    if (share) { P.x -= nx * d * share; P.z -= nz * d * share; }
    out = { pen: Math.max(out?.pen ?? 0, pen), j: (out?.j ?? 0) + j, x: wx, z: wz };
  }
  return out;
}
// the gap between our hull and a prop (m, < 0 overlapping)
export function solidGap(S, P) {
  let m = Infinity;
  for (const [bx, by] of OUTLINE_POLY) { const [wx, wz] = toWorld(S, bx, by), [qx, qy] = toBody(P, wx, wz); for (const poly of P.polys) m = Math.min(m, polyDistance(poly, qx, qy).d); }
  for (const [px, py] of P.pts) { const [wx, wz] = toWorld(P, px, py), [qx, qy] = toBody(S, wx, wz); m = Math.min(m, outlineDistance(qx, qy).d); }
  return m;
}

// a light prop back to its station: a damped spring (its engines, or its rode), the shove capped
function stepLight(P, dt, t) {
  const L = P.light, w = 2 * Math.PI / L.period, k = Math.exp(-dt / L.tau);
  const hHome = P.h0 + (P.swing ? P.swing.amp * Math.sin(t * P.swing.w + P.swing.ph) : 0);
  P.vx = (P.vx - w * w * (P.x - P.x0) * dt) * k; P.vz = (P.vz - w * w * (P.z - P.z0) * dt) * k;
  P.r = (P.r - w * w * wrap(P.heading - hHome) * dt) * k;
  P.x += P.vx * dt; P.z += P.vz * dt; P.dh = Math.max(-L.maxTurn, Math.min(L.maxTurn, wrap(P.heading + P.r * dt - hHome))); P.heading = hHome + P.dh;
  const ox = P.x - P.x0, oz = P.z - P.z0, o = Math.hypot(ox, oz);
  if (o > L.maxOff) { P.x = P.x0 + ox * L.maxOff / o; P.z = P.z0 + oz * L.maxOff / o; }
}

export function createSolids(opts = {}) {
  const bodies = propBodies(opts);
  const on = { barges: true, crowd: true };
  const stats = { contacts: 0, maxPen: 0, minGap: Infinity, lastJ: 0, lastT: -1e9 };
  let onBump = opts.onBump ?? null;
  // a prop that comes into the world over our boat stays a ghost until the boat is clear of it (no shove across the deck)
  const setOn = (o) => {
    for (const k of Object.keys(o)) on[k] = !!o[k];
    for (const b of bodies) { const want = on[b.group]; if (want && !b.on) b.armed = false; b.on = want; }
  };
  // the tow: a barge's pose; its patrol boats keep their station relative to it (translated with it, their own heading
  // turned with it), so the escort comes in with the barge
  // (tow: 0 at the spot … 1 under way, the patrol boats then heading as the barge does)
  const setBargePose = (i, { x, z, yaw, tow = 0 }) => {
    const barge = bodies.find((b) => b.kind === 'barge' && b.barge === i);
    if (!barge) return;
    barge.home ??= { x: barge.x0, z: barge.z0, h: barge.h0 };
    barge.x = barge.x0 = x; barge.z = barge.z0 = z; barge.heading = barge.h0 = -yaw;
    for (const b of bodies) if (b.kind === 'patrol' && b.barge === i) {
      b.home ??= { x: b.x0, z: b.z0, h: b.h0 };
      const dx = b.x - b.x0, dz = b.z - b.z0, dh = wrap(b.heading - b.h0);
      b.x0 = b.home.x + (x - barge.home.x); b.z0 = b.home.z + (z - barge.home.z);
      b.h0 = b.home.h + wrap(-yaw - b.home.h) * Math.max(0, Math.min(1, tow));
      b.x = b.x0 + dx; b.z = b.z0 + dz; b.heading = b.h0 + dh;
    }
  };
  function post(S, dt, t = 0) {
    for (const b of bodies) {
      if (!b.on) continue;
      if (b.light) stepLight(b, dt, t);
      if (!b.armed) { if (solidGap(S, b) > 0.5) b.armed = true; else continue; }
      const c = solidContact(S, b);
      if (c) {
        stats.contacts++; stats.maxPen = Math.max(stats.maxPen, c.pen);
        if (c.j > 300 && t - stats.lastT > 1.5) { stats.lastJ = c.j; stats.lastT = t; onBump?.({ kind: b.kind, j: c.j, x: c.x, z: c.z, t }); }
      }
    }
  }
  const gap = (S) => { let m = Infinity; for (const b of bodies) if (b.on && b.armed) m = Math.min(m, solidGap(S, b)); return m; };
  return { bodies, on, setOn, setBargePose, post, gap, stats, set onBump(f) { onBump = f; } };
}

// Cruise's chart (navigator.js buildChart extra: [x, z, r], the navigator keeps NAV.plan.obj (62 m) past r, NAV.hard.obj
// (40 m) at the least): each barge and tug as three circles along its length (the barge's bow to the tug's stern, 51 m past
// the barge's middle), each patrol boat and spectator a point with a NEGATIVE radius (SMALL_R): a small lit boat is passed
// at 37 m (plan) and 15 m (hard), not the 62 m a pier or a moored field needs (with the full margin the four small boats
// walled the anchorage off from the bay: Cruise circled 250–350 m off it for 9 minutes)
const SMALL_R = -25;
export function chartObjects(bodies) {
  const out = [];
  for (const b of bodies) {
    if (b.kind === 'barge') {
      const fx = Math.sin(b.h0), fz = -Math.cos(b.h0);
      for (const s of [20, -10, -40]) out.push([b.x0 + fx * s, b.z0 + fz * s, 16]);   // 20…−40 m along: the barge's bow to the tug's stern
    } else out.push([b.x0, b.z0, SMALL_R]);
  }
  return out;
}
// the show's props as the game places them (heightAt: the terrain's, for the patrol boats' spots): the bodies for the chart
export const showBodies = (heightAt = null) => propBodies({ barges: bargesWorld(), toward: VIEW, wet: heightAt ? (x, z) => heightAt(x, z) < -0.5 : null, sailboats: sailboatSpots(VIEW) });
// inside a keep-out circle (a solid's own circle + margin): the computer boats' clear() treats it as shoal water
export function blocked(bodies, x, z, margin = 25) {
  for (const b of bodies) {
    if (!b.on) continue;
    if (b.kind === 'barge') {
      const fx = Math.sin(b.heading), fz = -Math.cos(b.heading);
      for (const s of [20, -10, -40]) if (Math.hypot(x - (b.x + fx * s), z - (b.z + fz * s)) < 16 + margin) return true;
    } else if (Math.hypot(x - b.x, z - b.z) < 6 + margin) return true;
  }
  return false;
}
