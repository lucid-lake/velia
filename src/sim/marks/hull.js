// The boat as a solid for the marks (feat/marks): a signed-distance model of the Catalina 28 built from its real lines
// (src/boat/dims.js): the canoe body as 21 stations (a convex section each, from the keel line to the sheer, its
// waterline half-breadth the same plan the seakeeping float uses), a bow and a stern overhang above the waterline,
// the fin keel and the spade rudder (turning with the helm). Plain JS, no three.js.
//
//   const hull = makeHull();
//   hull.sdf(xb, yb, hb, rudderRad) → m, < 0 inside; the body frame: x forward, y starboard, h up from the design waterline.
//   hull.normal(xb, yb, hb, rudder, out) → the outward unit normal (central differences)
//   toBody(boat, wx, wh, wz, out) / fromBodyVec(boat, bx, by, bh, out): the world <-> body maps for a boat state
//   { x, z, heading, heel, pitch, heave } (heel: starboard down +; pitch: bow up +; wave motions added by the caller).
//
// Frames: world x east, z south, h up; heading clockwise from north (−z): forward = (sin h, −cos h), starboard = (cos h, sin h).
import { DEFAULT_DIMS } from '../boat/dims.js';

const BWL = 0.86;          // waterline beam / max beam (src/boat/float.js)
const DRAFT = 0.45;        // the canoe body's depth below the waterline (float.js)
const FLARE = 1.14;        // sheer half-breadth over the waterline's (the topsides flare out)

// the convex hull of 2D points (monotone chain), CCW
function convexHull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

// signed distance from (px, py) to a convex CCW polygon (negative inside)
function polySdf(px, py, P) {
  let inside = true, best = Infinity;
  for (let i = 0, n = P.length; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1], wx = px - a[0], wy = py - a[1];
    if (ex * wy - ey * wx < 0) inside = false;
    const t = Math.max(0, Math.min(1, (wx * ex + wy * ey) / (ex * ex + ey * ey)));
    const dx = wx - ex * t, dy = wy - ey * t, d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return inside ? -Math.sqrt(best) : Math.sqrt(best);
}

// a prism: a convex section P (in two of the body axes) extruded between lo and hi on the third; rounded by `round`
// axis 0: slab along x, section in (y, h); axis 1: slab along y, section in (x, h)
const _poly = Array.from({ length: 8 }, () => [0, 0]);
function prismSdf(a, b, c, S) {
  const [u, v, w] = S.axis === 0 ? [b, c, a] : [a, c, b];   // section coords (u, v), slab coordinate w
  const dw = Math.max(S.lo - w, w - S.hi);
  let ds;
  if (S.loft) {   // blend the two sections at the point's place along the slab; the taper shortens the true distance a little
    const f = Math.max(0, Math.min(1, (w - S.lo) / (S.hi - S.lo)));
    for (let k = 0; k < 8; k++) { _poly[k][0] = S.P0[k][0] + (S.P1[k][0] - S.P0[k][0]) * f; _poly[k][1] = S.P0[k][1] + (S.P1[k][1] - S.P0[k][1]) * f; }
    ds = polySdf(u, v, _poly) * (polySdf(u, v, _poly) > 0 ? S.taper : 1);
  } else ds = polySdf(u, v, S.poly);
  const d = dw > 0 && ds > 0 ? Math.hypot(dw, ds) : Math.max(dw, ds);
  return d - S.round;
}

// dims: the boat's (src/boat/dims.js; this page's boat by default)
export function makeHull({ stations = 21, dims = DEFAULT_DIMS } = {}) {
  const { HULL } = dims;
  const L = HULL.lwl, fb = HULL.freeboard, solids = [];
  // the plan: a rounded bow closing to the stem (as float.js); aft, a transom 68 % of the beam (a Catalina 28's walk-through stern)
  const half = (x) => {
    const xi = Math.min(1, Math.abs(2 * x / L)), W = 0.5 * HULL.beam * BWL;
    return x >= 0 ? W * Math.pow(Math.max(0, 1 - xi * xi), 0.6) : W * (1 - 0.32 * Math.pow(xi, 2.5));
  };
  const depth = (x) => { const xi = Math.min(1, Math.abs(2 * x / L)); return x >= 0 ? DRAFT * Math.pow(Math.max(0, 1 - xi * xi), 0.8) : Math.max(0.12, DRAFT * (1 - Math.pow(xi, 3))); };
  const section = (x) => {   // the section's eight corners, CCW, at station x
    const b = Math.max(0.015, half(x)), d = Math.max(0.03, depth(x)), bd = Math.min(HULL.beam / 2, b * FLARE);
    return [[-0.4 * b, -d], [0.4 * b, -d], [0.92 * b, -0.45 * d], [b, 0], [bd, fb], [-bd, fb], [-b, 0], [-0.92 * b, -0.45 * d]].map(([y, h]) => [y, h]);
  };
  const dx = L / stations;
  for (let i = 0; i < stations; i++) {
    const x0 = -L / 2 + i * dx, x1 = x0 + dx;
    // a loft: the section at x0 and at x1, blended along the slab (so the plan is a smooth line, not a stair)
    const P0 = section(x0), P1 = section(x1), slope = Math.max(0, ...P0.map((p, k) => Math.abs(P1[k][0] - p[0]) / dx));
    solids.push({ axis: 0, lo: x0, hi: x1, P0, P1, taper: 1 / Math.sqrt(1 + slope * slope), round: 0.04, loft: true });
  }
  // the overhangs: the stem and the counter reach past the waterline above it (the bow's rake, the stern's sit); both close
  // to a narrow tip, so a mark meeting the stem slides to one side
  const bowX = HULL.loa / 2;
  const over = (k) => [[-0.6 * k, 0.30], [0.6 * k, 0.30], [0.9 * k, 0.5], [1.0 * k, 0.7], [1.0 * k, fb], [-1.0 * k, fb], [-1.0 * k, 0.7], [-0.9 * k, 0.5]];
  solids.push({ axis: 0, lo: L / 2, hi: bowX, P0: over(0.30), P1: over(0.015), taper: 0.85, round: 0.05, loft: true });
  solids.push({ axis: 0, lo: -bowX, hi: -L / 2, P0: over(0.9), P1: over(0.9), taper: 1, round: 0.05, loft: true });
  // the fin keel: a trapezoid in (x, h) from the hull's keel line to the tip at the draft, 0.14 m thick, forward-swept
  const keel = { axis: 1, lo: -0.07, hi: 0.07, poly: [[-0.55, -DRAFT + 0.05], [0.95, -DRAFT + 0.05], [0.45, -HULL.draft], [-0.2, -HULL.draft]], round: 0.03 };
  keel.poly = convexHull(keel.poly);
  solids.push(keel);
  // the spade rudder about its stock (HULL.rudderZ aft), 0.07 m thick; the section is built in the rudder's frame
  const rudderPoly = convexHull([[-0.15, -0.20], [0.30, -0.20], [0.22, -1.05], [-0.10, -1.05]]);   // x from the stock; h
  const stockX = -HULL.rudderZ, rudder = { axis: 1, lo: -0.035, hi: 0.035, poly: rudderPoly, round: 0.02, stockX };

  function sdf(x, y, h, rud = 0) {
    let m = Infinity;
    for (const S of solids) {
      // cheap reject: a slab far from the point along x cannot be the nearest
      if (S.axis === 0) { const dxo = Math.max(S.lo - x, x - S.hi); if (dxo > m + 0.5) continue; }
      const d = prismSdf(x, y, h, S);
      if (d < m) m = d;
    }
    // the rudder: turn the point about the vertical stock into the rudder's frame (its slab is thin in the rudder's own y)
    const c = Math.cos(rud), s = Math.sin(rud), rx = x - stockX;
    const lx = rx * c + y * s, ly = -rx * s + y * c;
    const dr = prismSdf(lx, ly, h, rudder);
    return dr < m ? dr : m;
  }
  const E = 0.01;
  function normal(x, y, h, rud = 0, out = [0, 0, 1]) {
    const gx = sdf(x + E, y, h, rud) - sdf(x - E, y, h, rud), gy = sdf(x, y + E, h, rud) - sdf(x, y - E, h, rud), gh = sdf(x, y, h + E, rud) - sdf(x, y, h - E, rud);
    const n = Math.hypot(gx, gy, gh) || 1;
    out[0] = gx / n; out[1] = gy / n; out[2] = gh / n;
    return out;
  }
  // which part of the boat is nearest: 'keel', 'rudder' or 'hull'
  function partAt(x, y, h, rud = 0) {
    const c = Math.cos(rud), s = Math.sin(rud), rx = x - stockX;
    const dr = prismSdf(rx * c + y * s, -rx * s + y * c, h, rudder), dk = prismSdf(x, y, h, keel);
    let dh = Infinity; for (const S of solids) if (S !== keel) dh = Math.min(dh, prismSdf(x, y, h, S));
    return dr < dh && dr <= dk ? 'rudder' : dk < dh ? 'keel' : 'hull';
  }
  return { sdf, normal, partAt, solids, rudder, length: HULL.loa, draft: HULL.draft };
}

// world (wx east, wz south, wh up) → the boat's body frame (x forward, y starboard, h up). boat: { x, z, heading, heel, pitch, heave }
export function toBody(b, wx, wh, wz, out = [0, 0, 0]) {
  const sh = Math.sin(b.heading), ch = Math.cos(b.heading);
  const dx = wx - b.x, dz = wz - b.z, hh = wh - (b.heave ?? 0);
  const xb = dx * sh - dz * ch, yb = dx * ch + dz * sh;
  const cr = Math.cos(b.heel ?? 0), sr = Math.sin(b.heel ?? 0), cp = Math.cos(b.pitch ?? 0), sp = Math.sin(b.pitch ?? 0);
  const y1 = yb * cr - hh * sr, h1 = yb * sr + hh * cr;          // roll: starboard down
  out[0] = xb * cp + h1 * sp; out[1] = y1; out[2] = -xb * sp + h1 * cp;   // pitch: bow up
  return out;
}
// a body-frame vector → world (x east, h up, z south), no translation
export function fromBodyVec(b, bx, by, bh, out = [0, 0, 0]) {
  const cr = Math.cos(b.heel ?? 0), sr = Math.sin(b.heel ?? 0), cp = Math.cos(b.pitch ?? 0), sp = Math.sin(b.pitch ?? 0);
  const x1 = bx * cp - bh * sp, h1 = bx * sp + bh * cp;           // undo pitch
  const y1 = by * cr + h1 * sr, hh = -by * sr + h1 * cr;          // undo roll
  const sh = Math.sin(b.heading), ch = Math.cos(b.heading);
  out[0] = x1 * sh + y1 * ch; out[1] = hh; out[2] = -x1 * ch + y1 * sh;
  return out;
}
