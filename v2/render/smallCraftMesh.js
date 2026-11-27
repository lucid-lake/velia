// South Lake's small power craft (v2/living/powerTraffic.js), all by code: a generic 6.6 m bowrider runabout and a 3.2 m sit-down jet
// ski, each with its seated figure. Pure: plain arrays, no GPU (the tests and render/smallCraft.js build them once). Two LODs each in
// one vertex set (near: the lofted hull (a raked stem, a flared bow, the sheer rising forward, a deep V forward carried aft at 19°,
// rounded chines, a crowned deck, a rubrail), the wrap-around windscreen, the console, the seats, the outboard or the
// jet's hood, the figure; far: a few dozen triangles of hull, deck block and figure), each LOD drawn in one call for every craft of
// its kind (instanced). No names, no lettering, no liveries: the hull's colour and its one stripe are the instance's (the region row's
// hull and stripe). The figures' slots (>= SLOT.rider) duck in the vertex shader when Tessie splashes them (nobody goes in the water).
// Frame (every boat's): x starboard, y up from her waterline, z aft (the bow at −z), metres. A vertex: position (3), normal (3), the
// material slot (1) (the glass boat's layout: render/tourBoatMesh.js VF).
import { builder, VF } from './tourBoatMesh.js';
import { POWER } from '../living/powerTraffic.js';

export { VF };
export const SLOT = Object.freeze({ hull: 0, deck: 1, glass: 2, seat: 3, seatDark: 4, dark: 5, metal: 6, mat: 7, hood: 8, liner: 9, rider: 10, skin: 11, vest: 12, hair: 13, trunks: 14, helmet: 15, glove: 16 });
export const LOD_M = Object.freeze({ power: 300, jetski: 200, hyst: 0.08 });       // m: the near LOD within these
export const DRAW_M = Object.freeze({ full: Object.freeze({ power: 4000, jetski: 2500 }), lite: Object.freeze({ power: 2000, jetski: 1200 }) });
export const KINDS = Object.freeze(['power', 'jetski']);

// a hull's shape: length L, beam B, its sheer (ys) rising to the bow (sheerBow over sheerRun), the keel with its forefoot rising
// forward, the deadrise (deg) from the transom's to the entry's, the chine's half-width (a share of the sheer's) and its own fuller-
// aft entry (the topsides flare out above it at the bow), the stem's rake (m aft per m down at the stem), the chine's round (m), the
// deck's crown (m) (u 0 at the stem, 1 at the transom)
export const HULLS = Object.freeze({
  power: Object.freeze({ L: POWER.power.length, B: POWER.power.beam, sheer: 0.84, sheerBow: 0.38, sheerRun: 0.62, keel: -0.34, forefoot: 0.52, footRun: 0.34, deadrise: 19, deadriseBow: 52, chine: 0.88, entry: 0.44, chineEntry: 0.6, rake: 0.8, round: 0.11, crown: 0.07, stripe: Object.freeze([0.42, 0.6]), well: Object.freeze({ u0: 0.3, u1: 0.84, depth: 0.5, cap: 0.13 }) }),
  jetski: Object.freeze({ L: POWER.jetski.length, B: POWER.jetski.beam, sheer: 0.5, sheerBow: 0.12, keel: -0.2, forefoot: 0.3, deadrise: 0.16, chine: 0.86, entry: 0.4, stripe: Object.freeze([0.3, 0.42]) }),
});
export function hullAt(H, u) {
  u = Math.max(0, Math.min(1, u));
  const half = H.B / 2;
  // the deck's plan: a fine point at the stem opening to a full bow, then a hint of taper to the transom
  const hb = half * (u < H.entry ? Math.sin((u / H.entry) * Math.PI / 2) ** 0.85 : 1 - 0.05 * ((u - H.entry) / (1 - H.entry)));
  const ys = H.sheer + (u < H.sheerRun ? H.sheerBow * (1 - u / H.sheerRun) ** 1.8 : -0.05 * (u - H.sheerRun) / (1 - H.sheerRun));
  const yk = H.keel + (u < H.footRun ? H.forefoot * (1 - u / H.footRun) ** 2 : 0);
  // the chine's plan runs finer than the deck's at the bow (the flare), its V deep forward and carried aft at the transom's deadrise
  const xc = half * H.chine * (u < H.chineEntry ? Math.sin((u / H.chineEntry) * Math.PI / 2) ** 1.1 : 1 - 0.05 * ((u - H.chineEntry) / (1 - H.chineEntry)));
  const dr = (H.deadrise + (H.deadriseBow - H.deadrise) * Math.max(0, 1 - u / 0.65) ** 1.5) * Math.PI / 180;
  return { hb, ys, yk, yc: Math.min(ys - 0.12 * (hb / half), yk + xc * Math.tan(dr)), xc };
}

// a side's section at u (sx −1 port, +1 starboard): sheer, the chine's round (above, on, below), keel; the stem raked (the lower points
// drawn aft near the bow, so her sheer keeps the 6.6 m and the stem leans forward from the forefoot)
function section(H, u, sx, round) {
  const s = hullAt(H, u), z0 = -H.L / 2 + u * H.L, w = Math.max(0, 1 - u / 0.3) ** 2;
  const P = (x, y) => [sx * x, y, z0 + H.rake * (s.ys - y) * w];
  if (!round) return [P(s.hb, s.ys), P(s.xc, s.yc), P(0, s.yk)];
  const C = [s.xc, s.yc], toS = [s.hb - s.xc, s.ys - s.yc], toK = [-s.xc, s.yk - s.yc];
  const lS = Math.hypot(...toS) || 1, lK = Math.hypot(...toK) || 1, r = Math.min(H.round, 0.3 * lS, 0.3 * lK);
  const cu = [C[0] + toS[0] / lS * r, C[1] + toS[1] / lS * r], cl = [C[0] + toK[0] / lK * r, C[1] + toK[1] / lK * r];
  const cm = [C[0] * 0.45 + (cu[0] + cl[0]) / 2 * 0.55, C[1] * 0.45 + (cu[1] + cl[1]) / 2 * 0.55];
  return [P(s.hb, s.ys), P(cu[0], cu[1]), P(cm[0], cm[1]), P(cl[0], cl[1]), P(0, s.yk)];
}

function hull(B, H, n, near) {
  const us = []; for (let i = 0; i <= n; i++) us.push((i / n) ** 1.15);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // each side its own sheet (sheer to keel; smooth across the chine's round, a sharp crease at the keel and at the sheer)
  const sides = [-1, 1].map((sx) => us.map((u) => section(H, u, sx, near)));
  for (const rows of sides) {
    const R = rows.length, N = rows[0].length;
    const nrm = (i, j) => B.norm(cross(sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]), sub(rows[i][Math.min(N - 1, j + 1)], rows[i][Math.max(0, j - 1)])));
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < N - 1; j++) B.squad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j], nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), SLOT.hull);
  }
  const [port, stbd] = sides, R = port.length, N = port[0].length;
  // the deck: a crowned foredeck and aft deck between the sheers (port sheer, the crown, starboard sheer); near, the cockpit between
  // them is a well (H.well): a gunwale cap along each side, the liner's inner walls down to the sole, a bulkhead at each end
  const W = near ? H.well : null, i0 = W ? us.findIndex((u) => u >= W.u0) : -1, i1 = W ? us.findIndex((u) => u >= W.u1) : -1;
  // the liner's wall stands inside the hull's skin all the way down to the sole (the topsides tuck in below the sheer, more so forward)
  const skinX = (pts, y) => { for (let j = 0; j < pts.length - 1; j++) { const a = pts[j], b = pts[j + 1]; if ((a[1] - y) * (b[1] - y) <= 0) { const t = (y - a[1]) / ((b[1] - a[1]) || 1e-6); return Math.abs(a[0] + (b[0] - a[0]) * t); } } return Math.abs(pts[pts.length - 1][0]); };
  const insetAt = (i) => W ? Math.max(W.cap, Math.abs(port[i][0][0]) - skinX(port[i], port[i][0][1] - W.depth) + 0.05) : 0;
  let rowI = 0;
  const inner = (p, sx) => { const k = Math.abs(p[2] - port[rowI][0][2]) < 1e-6 ? rowI : rowI + 1, c = insetAt(Math.min(R - 1, k)); return [p[0] - sx * c, p[1], p[2]]; };
  const floor = (p) => [p[0], p[1] - W.depth, p[2]];
  const crownY = (p) => p[1] + H.crown * Math.abs(p[0]) / (H.B / 2);
  for (let i = 0; i < R - 1; i++) {
    const a0 = port[i][0], a1 = stbd[i][0], b0 = port[i + 1][0], b1 = stbd[i + 1][0];
    rowI = i;
    if (W && i >= i0 && i < i1) {
      const pa = inner(a0, -1), pb = inner(b0, -1), sa = inner(a1, 1), sb = inner(b1, 1);
      B.quad(a0, pa, pb, b0, SLOT.deck); B.quad(sa, a1, b1, sb, SLOT.deck);   // the gunwale caps
      B.quad(pa, floor(pa), floor(pb), pb, SLOT.liner); B.quad(sa, sb, floor(sb), floor(sa), SLOT.liner);   // the liner's walls
      B.quad(floor(pa), floor(sa), floor(sb), floor(pb), SLOT.liner);   // the sole
      continue;
    }
    const ca = [0, crownY(a0), a0[2]], cb = [0, crownY(b0), b0[2]];
    if (near) { B.quad(a0, ca, cb, b0, SLOT.deck); B.quad(ca, a1, b1, cb, SLOT.deck); } else B.quad(a1, a0, b0, b1, SLOT.deck);
  }
  if (W) for (const i of [i0, i1]) {   // the bulkheads: from the crowned deck's edge down to the sole
    rowI = i;
    const pa = inner(port[i][0], -1), sa = inner(stbd[i][0], 1), c = [0, crownY(port[i][0]), pa[2]];
    const pt = [pa[0], pa[1] + H.crown * (1 - Math.abs(pa[0]) / (H.B / 2)) * 0, pa[2]];
    B.quad(pt, c, [0, pa[1] - W.depth, pa[2]], floor(pa), SLOT.liner); B.quad(c, sa, floor(sa), [0, pa[1] - W.depth, pa[2]], SLOT.liner);
  }
  // the rubrail: a dark band along each sheer, a hand deep
  if (near) for (const rows of sides) for (let i = 0; i < R - 1; i++) {
    const a = rows[i][0], b = rows[i + 1][0], o = Math.sign(a[0] || b[0] || 1) * 0.025;
    B.quad([a[0] + o, a[1] + 0.01, a[2]], [b[0] + o, b[1] + 0.01, b[2]], [b[0] + o, b[1] - 0.07, b[2]], [a[0] + o, a[1] - 0.07, a[2]], SLOT.dark);
  }
  // the transom: a fan from its middle
  const tp = port[R - 1], ts = stbd[R - 1], ring = [...tp, ...ts.slice(0, N - 1).reverse()], c = [0, (tp[0][1] + tp[N - 1][1]) / 2, tp[0][2]];
  for (let j = 0; j < ring.length - 1; j++) B.tri(c, ring[j], ring[j + 1], SLOT.hull);
  B.tri(c, ring[ring.length - 1], ring[0], SLOT.hull);
}

// a seated figure: hips at (x, y, z) facing the bow; lean (rad forward); vest: a buoyancy aid (the jet ski's rider); hands to (hx, hy, hz)
function figure(B, { x, y, z, lean = 0.15, vest = false, hands = null, near = true, floorY = null }) {
  const seg = near ? 8 : 4, up = [0, Math.cos(lean), -Math.sin(lean)];
  const P = (h) => [x + up[0] * h, y + up[1] * h, z + up[2] * h];
  const torso = vest ? SLOT.vest : SLOT.rider;
  // the thighs forward along the seat, the shins down
  for (const sx of [-0.11, 0.11]) { B.cyl([x + sx, y + 0.06, z], [x + sx, y + 0.08, z - 0.42], 0.075, seg, SLOT.trunks); B.cyl([x + sx, y + 0.08, z - 0.42], [x + sx, floorY ?? y - 0.32, z - 0.5], 0.06, seg, SLOT.skin); }
  B.cyl(P(0.02), P(0.5), 0.17, seg, torso, { cap: true, r1: 0.19 });
  B.cyl(P(0.5), P(0.6), 0.07, seg, SLOT.skin);
  B.ball(P(0.72), 0.115, SLOT.skin, near ? 8 : 4);
  B.ball([P(0.75)[0], P(0.75)[1] + 0.03, P(0.75)[2] + 0.01], 0.118, SLOT.hair, near ? 6 : 3);   // hair (a cap's crown)
  const sh = P(0.46);
  for (const sx of [-1, 1]) {
    const s0 = [sh[0] + sx * 0.2, sh[1], sh[2]], h = hands ? [hands[0] + sx * hands[3], hands[1], hands[2]] : [s0[0], s0[1] - 0.25, s0[2] - 0.3];
    const el = [(s0[0] + h[0]) / 2 + sx * 0.06, (s0[1] + h[1]) / 2 - 0.08, (s0[2] + h[2]) / 2 + 0.05];
    B.cyl(s0, el, 0.05, seg, vest ? SLOT.skin : SLOT.rider); B.cyl(el, h, 0.045, seg, SLOT.skin);
  }
}

// a superellipse ring of half sizes (a, b) in the x-z plane at height y (the hull's rings, the outboard's leg)
const sring = (cx, y, cz, a, b, e = 2.6, n = 16) => Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); return [cx + a * Math.sign(c) * Math.abs(c) ** (2 / e), y, cz + b * Math.sign(s) * Math.abs(s) ** (2 / e)]; });
// a cushion or a moulding: a rounded box (half sizes h) about c, its sections superellipses (e: 2 round, larger squarer), lofted along
// z with rounded ends; tilt turns it about x (a backrest); pipe: a welt round its top edge in that slot
function pillow(B, c, h, slot, { e = 4, n = 16, m = 6, tilt = 0, pipe = null } = {}) {
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  const P = (x, y, z) => [c[0] + x, c[1] + y * ct - z * st, c[2] + y * st + z * ct];
  const se = (t) => Math.sign(t) * Math.abs(t) ** (2 / e);
  const rings = [];
  for (let k = 0; k <= m; k++) {
    const t = -1 + 2 * k / m, f = Math.max(0.02, (1 - Math.abs(t) ** e) ** (1 / e)), z = h[2] * se(Math.sin(t * Math.PI / 2));
    rings.push(Array.from({ length: n }, (_, i) => { const a = (i + 0.5) / n * Math.PI * 2; return P(h[0] * se(Math.cos(a)) * (0.55 + 0.45 * f), h[1] * se(Math.sin(a)) * (0.5 + 0.5 * f), z); }));
  }
  B.loft(rings, slot, { capEnd: true });
  const r0 = rings[0], cc = r0.reduce((m0, p) => [m0[0] + p[0] / n, m0[1] + p[1] / n, m0[2] + p[2] / n], [0, 0, 0]);
  for (let j = 0; j < n; j++) B.tri(cc, r0[(j + 1) % n], r0[j], slot);
  if (pipe != null) B.tube([...Array.from({ length: 13 }, (_, i) => { const a = i / 12 * Math.PI * 2; return P(h[0] * se(Math.cos(a)) * 0.98, h[1] * 0.35, h[2] * se(Math.sin(a)) * 0.98); })], 0.008, 4, pipe);
}

export function buildCraft(kind, { lod = 'near' } = {}) {
  const B = builder(), H = HULLS[kind], near = lod === 'near';
  if (kind === 'power') {
    hull(B, H, near ? 30 : 6, near);
    const s = hullAt(H, 0.42), y0 = s.ys;
    if (near) {
      const W = H.well, sole = (u) => hullAt(H, u).ys - W.depth;   // the cockpit's sole under the sheer at u
      // the windscreen: a wrap-around in two halves either side of the walk-through, raked aft about 40°, each half three panes (the
      // front, the corner swept aft, the wing back along the gunwale), lower toward the sides; a bright frame along the top, a dark gasket at its foot
      for (const sx of [-1, 1]) {
        const base = [[0.14, -0.86], [0.55, -0.8], [0.9, -0.62], [0.97, -0.22]], hs = [0.4, 0.38, 0.32, 0.2];
        const bot = base.map(([f, z]) => { const q = hullAt(H, (z + H.L / 2) / H.L); return [sx * Math.min(f * q.hb, q.hb - 0.05), q.ys + 0.01, z]; });
        const top = bot.map((p, k) => [p[0] - sx * 0.05 * k / 3, p[1] + hs[k], p[2] + hs[k] * (0.85 - 0.35 * k / 3)]);
        for (let k = 0; k < 3; k++) B.quad(bot[k], bot[k + 1], top[k + 1], top[k], SLOT.glass);
        B.tube(top, 0.016, 6, SLOT.metal); B.tube(bot, 0.022, 4, SLOT.dark);
      }
      // the helm console (starboard) and the companion's (port): moulded, rounded, rising from the sole to a sloped dash under the screen
      const zc = -0.42, ys0 = hullAt(H, (zc + H.L / 2) / H.L).ys, s0 = ys0 - W.depth;
      for (const sx of [-1, 1]) {
        const cx = sx * 0.58, w = 0.3;
        pillow(B, [cx, (s0 + ys0 + 0.2) / 2, zc + 0.02], [w, (ys0 + 0.2 - s0) / 2, 0.3], SLOT.hull, { e: 7, n: 16, m: 8 });
        // the dash: a dark sloped panel with two gauges' bezels (starboard), a glovebox lid (port)
        const dz0 = zc - 0.18, dz1 = zc + 0.26, dy0 = ys0 + 0.24, dy1 = ys0 + 0.06;
        const dzm = sx > 0 ? dz0 + (dz1 - dz0) * 0.55 : dz1, dym = sx > 0 ? dy0 + (dy1 - dy0) * 0.55 : dy1;
        B.quad([cx - w + 0.05, dy0 + 0.002, dz0 + 0.02], [cx + w - 0.05, dy0 + 0.002, dz0 + 0.02], [cx + w - 0.05, dym + 0.002, dzm], [cx - w + 0.05, dym + 0.002, dzm], sx > 0 ? SLOT.dark : SLOT.liner);   // the helm's dark dash; the companion's glovebox lid
        if (sx > 0) for (const gx of [-0.1, 0.1]) B.cyl([cx + gx, dy0 - 0.06, dz0 + 0.14], [cx + gx, dy0 - 0.045, dz0 + 0.155], 0.05, 12, SLOT.metal, { cap: true });
      }
      // the wheel: a rim (a tube ring), three spokes and its hub on the tilted column; the throttle's lever at her right hand
      const wc = [0.58, ys0 + 0.34, zc + 0.3], tilt = 0.55, ring = [];
      for (let k = 0; k <= 20; k++) { const t = k / 20 * Math.PI * 2; ring.push([wc[0] + Math.cos(t) * 0.17, wc[1] + Math.sin(t) * 0.17 * Math.cos(tilt), wc[2] + Math.sin(t) * 0.17 * Math.sin(tilt)]); }
      B.tube(ring, 0.014, 6, SLOT.seatDark);
      for (const t of [Math.PI / 2, Math.PI * 7 / 6, Math.PI * 11 / 6]) B.cyl(wc, [wc[0] + Math.cos(t) * 0.16, wc[1] + Math.sin(t) * 0.16 * Math.cos(tilt), wc[2] + Math.sin(t) * 0.16 * Math.sin(tilt)], 0.01, 4, SLOT.metal);
      B.cyl([wc[0], wc[1] - 0.06, wc[2] - 0.1], wc, 0.03, 8, SLOT.dark, { cap: true });
      B.box(0.86, ys0 + 0.02, zc + 0.05, 0.92, ys0 + 0.1, zc + 0.2, SLOT.dark); B.cyl([0.89, ys0 + 0.1, zc + 0.12], [0.89, ys0 + 0.26, zc + 0.18], 0.012, 6, SLOT.metal); B.ball([0.89, ys0 + 0.27, zc + 0.185], 0.028, SLOT.seatDark, 6);
      // the seats: the helm and the companion's bucket seats on pedestals, the stern bench with its backrest against the transom, the
      // bow's sun pad; cream vinyl with a dark piping round each cushion
      const zs = 0.5, ss = sole((zs + H.L / 2) / H.L);
      for (const sx of [-0.58, 0.58]) {
        B.cyl([sx, ss, zs + 0.02], [sx, ss + 0.3, zs + 0.02], 0.05, 10, SLOT.metal);
        B.cyl([sx, ss, zs + 0.02], [sx, ss + 0.02, zs + 0.02], 0.16, 12, SLOT.dark, { cap: true });
        pillow(B, [sx, ss + 0.36, zs], [0.24, 0.06, 0.23], SLOT.seat, { e: 4, n: 16, m: 7, pipe: SLOT.seatDark });
        pillow(B, [sx, ss + 0.66, zs + 0.25], [0.23, 0.26, 0.06], SLOT.seat, { e: 4, n: 16, m: 6, tilt: -0.22, pipe: SLOT.seatDark });
      }
      const zb = 2.42, sb2 = sole((zb + H.L / 2) / H.L), hb = hullAt(H, (zb + H.L / 2) / H.L).hb - W.cap - 0.02;
      B.box(-hb, sb2, zb - 0.3, hb, sb2 + 0.3, zb + 0.32, SLOT.liner);   // the bench's moulded base
      pillow(B, [0, sb2 + 0.36, zb], [hb, 0.065, 0.3], SLOT.seat, { e: 4, n: 20, m: 7, pipe: SLOT.seatDark });
      pillow(B, [0, sb2 + 0.68, zb + 0.32], [hb - 0.04, 0.24, 0.07], SLOT.seat, { e: 4, n: 20, m: 6, tilt: -0.18, pipe: SLOT.seatDark });
      const sp = hullAt(H, 0.2); pillow(B, [0, sp.ys + H.crown * 0.6 + 0.07, -2.0], [sp.hb * 0.62, 0.06, 0.45], SLOT.seat, { e: 4, n: 16, m: 7, pipe: SLOT.seatDark });
      // the bow's stainless grab rails on their bases; a cleat each side at the bow and the stern
      for (const sx of [-1, 1]) {
        const pts = [0.06, 0.12, 0.19, 0.26].map((u) => { const q = hullAt(H, u); return [sx * (q.hb - 0.06), q.ys + 0.18, -H.L / 2 + u * H.L + H.rake * 0.0]; });
        B.tube(pts, 0.012, 6, SLOT.metal);
        for (const p of [pts[0], pts[3]]) B.cyl([p[0], p[1] - 0.18, p[2]], p, 0.011, 6, SLOT.metal);
        for (const u of [0.1, 0.93]) { const q = hullAt(H, u), c = [sx * (q.hb - 0.07), q.ys + 0.01, -H.L / 2 + u * H.L]; B.box(c[0] - 0.015, c[1], c[2] - 0.08, c[0] + 0.015, c[1] + 0.04, c[2] + 0.08, SLOT.metal); }
      }
      // the outboard on the transom: the cowling (rounded, a grey band at its split line), the lower cowl, the leg into the water, its
      // anti-ventilation plate, the clamp bracket; the stern's swim step either side
      const yo = y0 + 0.05, zo = H.L / 2 + 0.36;
      pillow(B, [0, yo + 0.5, zo + 0.02], [0.26, 0.23, 0.36], SLOT.dark, { e: 2.8, n: 16, m: 8 });
      pillow(B, [0, yo + 0.25, zo], [0.22, 0.06, 0.33], SLOT.metal, { e: 3, n: 16, m: 6 });
      pillow(B, [0, yo + 0.06, zo - 0.04], [0.18, 0.16, 0.28], SLOT.dark, { e: 2.6, n: 14, m: 6 });
      B.loft([0.0, -0.25, -0.5].map((y, k) => sring(0, yo - 0.08 + y, zo + 0.02, 0.07 - 0.012 * k, 0.17 - 0.02 * k, 2.2, 12)), SLOT.dark);
      B.box(-0.2, -0.08, zo - 0.16, 0.2, -0.06, zo + 0.26, SLOT.dark);
      B.box(-0.12, y0 - 0.25, H.L / 2, 0.12, y0 + 0.12, H.L / 2 + 0.12, SLOT.metal);
      for (const sx of [-1, 1]) B.box(sx * 0.45, 0.08, H.L / 2, sx * 0.95, 0.12, H.L / 2 + 0.38, SLOT.deck);
      // the skipper at the helm, hands on the wheel (the procedural figure; the kayakers' figure replaces it where it is drawn: render/smallCraft.js)
      figure(B, { x: 0.58, y: ss + 0.42, z: zs, lean: 0.1, hands: [0.58, wc[1] + 0.02, wc[2] + 0.04, 0.15], near: true, floorY: ss });
    } else {
      B.box(-0.9, y0, -0.6, 0.9, y0 + 0.32, -0.45, SLOT.glass);
      B.box(-1.0, y0, 2.15, 1.0, y0 + 0.5, 2.8, SLOT.seat);
      B.box(-0.25, y0, H.L / 2, 0.25, y0 + 0.8, H.L / 2 + 0.6, SLOT.dark);
      figure(B, { x: 0.6, y: y0 + 0.36, z: 0.5, lean: 0.1, near: false });
    }
  } else {
    jetSki(B, near);
  }
  return new Float32Array(B.v);
}

// the jet ski (JET, her frame: the bow at −z): a shaped hull (a pointed bow, a chine, a sponson ledge, the gunwale's tumblehome), the
// two-tone deck (the hood and the seat's pedestal in the row's colour, the footwells' black mat, a grey rear deck), the steering
// column and raised bars with grips and a mirror pair, the cushion with piping, a grab handle, the pump's nozzle, and the rider:
// seated, knees bent, feet in the footwells, hands on the grips, a buoyancy aid and a helmet. near ≈ 2.1 k triangles, far ≈ 300.
export const JET = Object.freeze({ L: POWER.jetski.length, B: POWER.jetski.beam, sponsonY: 0.16, footY: 0.3, seatTop: 0.74, seatZ: 0.32, barY: 1.02, barZ: -0.52, nozzleY: 0.08 });
export function jetAt(u) {
  u = Math.max(0, Math.min(1, u));
  // the plan: a full rounded nose, widest just aft of it, the stern drawn in (a tapered stern); w0: the old plan's share, which sets the
  // V's heights (render/smallCraft.js draws the colour line from the same w0)
  const w0 = u < 0.45 ? Math.sin((u / 0.45) * Math.PI / 2) ** 0.62 : 1 - 0.1 * ((u - 0.45) / 0.55) ** 2;
  const hb = JET.B / 2 * (u < 0.42 ? Math.sin((u / 0.42) * Math.PI / 2) ** 0.55 : 1 - 0.15 * ((u - 0.42) / 0.58) ** 1.6);
  // the sheer sweeping up to the nose, a touch of rise toward the stern deck
  const ys = 0.42 + (u < 0.38 ? 0.24 * (1 - u / 0.38) ** 2 : 0) + 0.035 * Math.min(1, Math.max(0, (u - 0.62) / 0.38)) ** 2;
  const yk = -0.18 + (u < 0.42 ? 0.55 * (1 - u / 0.42) ** 2 : 0.03 * (u - 0.42));   // a long raked forefoot (the stem out of the water)
  const yc = yk + 0.19 * w0;   // a deep V (about 22° at the transom)
  const sp = 0.035 * Math.min(1, Math.max(0, (u - 0.45) / 0.25)) * (1 - Math.min(1, Math.max(0, (u - 0.96) / 0.04)));   // the sponsons, aft
  return { hb, ys, yk, yc, xc: hb * 0.74, ysp: yc + JET.sponsonY * w0, sp };
}
const jz = (u) => -JET.L / 2 + u * JET.L;
function jetSki(B, near) {
  const n = near ? 30 : 6;
  // the hull, each side in three sheets with a crease between them: the topsides (a rounded lip under the gunwale, a slight tumblehome
  // out to the spray rail), the rail's ledge (out over the sponson aft, then back in), the bottom (a chine, a lifting strake, the keel)
  const side = (u, sx) => {
    const q = jetAt(u), z = jz(u), X = (x) => sx * x;
    const P0 = [X(q.hb * 0.9), q.ys + 0.012, z], P1 = [X(q.hb * 0.975), q.ys - 0.014, z], P2 = [X(q.hb + 0.4 * q.sp), (q.ys + q.ysp) / 2 + 0.03, z], P3 = [X(q.hb + q.sp), q.ysp + 0.05, z];
    const P4 = [X(q.hb + q.sp), q.ysp + 0.02, z], P5 = [X(q.hb * 0.95), q.ysp, z];
    const P6 = [X(q.xc), q.yc, z], P7 = [X(q.xc * 0.55), q.yk + (q.yc - q.yk) * 0.5 - 0.012, z], P8 = [0, q.yk, z];
    return [[P0, P1, P2, P3], [P3, P4, P5], [P5, P6, P7, P8]];
  };
  const us = []; for (let i = 0; i <= n; i++) us.push((i / n) ** 1.1);
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sheet = (rows) => {
    const R = rows.length, N = rows[0].length;
    const nrm = (i, j) => B.norm(cross(sub(rows[Math.min(R - 1, i + 1)][j], rows[Math.max(0, i - 1)][j]), sub(rows[i][Math.min(N - 1, j + 1)], rows[i][Math.max(0, j - 1)])));
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < N - 1; j++) B.squad(rows[i][j], rows[i][j + 1], rows[i + 1][j + 1], rows[i + 1][j], nrm(i, j), nrm(i, j + 1), nrm(i + 1, j + 1), nrm(i + 1, j), SLOT.hull);
  };
  for (const sx of [-1, 1]) { const S = us.map((u) => side(u, sx)); for (let k = 0; k < 3; k++) sheet(S.map((r) => r[k])); }
  // the transom: a fan from its middle over both sides' outline
  const tp = side(1, -1), ts = side(1, 1), outline = [...tp[0], ...tp[1].slice(1), ...tp[2].slice(1), ...[...ts[2]].reverse().slice(1), ...[...ts[1]].reverse().slice(1), ...[...ts[0]].reverse().slice(1)];
  const tc = [0, (jetAt(1).ys + jetAt(1).yk) / 2, jz(1)];
  for (let j = 0; j < outline.length - 1; j++) B.tri(tc, outline[j], outline[j + 1], SLOT.hull);
  B.tri(tc, outline[outline.length - 1], outline[0], SLOT.hull);
  // the hood: lofted over the bow from the gunwales to a rounded crown that peaks ahead of the bars
  const hood = [], hn = near ? 14 : 3;
  for (let i = 0; i <= hn; i++) {
    const u = 0.02 + 0.36 * i / hn, q = jetAt(u), z = jz(u), top = q.ys + 0.06 + 0.34 * Math.sin(Math.min(1, (i / hn) * 1.15) * Math.PI / 2);
    hood.push([[-q.hb * 0.95, q.ys, z], [-q.hb * 0.8, top - 0.09, z], [-q.hb * 0.45, top - 0.022, z], [0, top, z], [q.hb * 0.45, top - 0.022, z], [q.hb * 0.8, top - 0.09, z], [q.hb * 0.95, q.ys, z]]);
  }
  {   // smooth across the crown (a moulded hood, not panels): each vertex's normal from its neighbours in the grid
    const HR = hood.length, HN = 7, nh = (i, j) => B.norm(cross(sub(hood[i][Math.min(HN - 1, j + 1)], hood[i][Math.max(0, j - 1)]), sub(hood[Math.min(HR - 1, i + 1)][j], hood[Math.max(0, i - 1)][j])));
    for (let i = 0; i < HR - 1; i++) for (let j = 0; j < HN - 1; j++) B.squad(hood[i][j], hood[i + 1][j], hood[i + 1][j + 1], hood[i][j + 1], nh(i, j), nh(i + 1, j), nh(i + 1, j + 1), nh(i, j + 1), SLOT.hood);
  }
  // the hood's back face down to the pedestal and the footwells' floor
  const hb0 = hood[hood.length - 1], zb = hb0[0][2], zp = zb + 0.1, py = JET.seatTop - 0.14;
  B.quad(hb0[2], hb0[4], [0.21, py, zp], [-0.21, py, zp], SLOT.hood);
  B.quad(hb0[1], hb0[2], [-0.21, py, zp], [-0.5, JET.footY, zp], SLOT.hood); B.quad(hb0[4], hb0[5], [0.5, JET.footY, zp], [0.21, py, zp], SLOT.hood);
  // the pedestal under the seat (the row's colour) between the footwells; the footwells' mat; their outer walls up to the gunwale
  const z1 = jz(0.86), zr = jz(1.0);
  if (near) pillow(B, [0, (JET.footY + py) / 2 + 0.01, (zp + z1) / 2], [0.22, (py - JET.footY) / 2 + 0.01, (z1 - zp) / 2], SLOT.hood, { e: 6, n: 16, m: 6 });   // moulded, its edges rounded
  else B.box(-0.21, JET.footY, zp, 0.21, py, z1, SLOT.hood, { bottom: false });
  for (const sx of [-1, 1]) {
    const a = sx < 0 ? -0.5 : 0.21, b = sx < 0 ? -0.21 : 0.5;
    B.quad([a, JET.footY, zp], [a, JET.footY, z1], [b, JET.footY, z1], [b, JET.footY, zp], SLOT.mat);
    const qf = jetAt(0.5), qr = jetAt(0.86), xf = sx * qf.hb * 0.93, xr = sx * qr.hb * 0.93;
    B.quad([sx * 0.5, JET.footY, zp], [xf, qf.ys, zp], [xr, qr.ys, z1], [sx * 0.5, JET.footY, z1], SLOT.hood);
    B.quad([xf, qf.ys, zp], [sx * jetAt(0.4).hb * 0.95, jetAt(0.4).ys, zb], [sx * 0.5, JET.footY, zp], [xf, qf.ys, zp], SLOT.hood);
  }
  // the rear deck (grey non-skid) and its step face down to the footwells
  const qr = jetAt(0.86), qt = jetAt(1.0);
  B.quad([-qr.hb * 0.95, qr.ys, z1], [qr.hb * 0.95, qr.ys, z1], [qt.hb * 0.95, qt.ys, zr], [-qt.hb * 0.95, qt.ys, zr], SLOT.deck);
  B.quad([-0.5, JET.footY, z1], [0.5, JET.footY, z1], [qr.hb * 0.95, qr.ys, z1], [-qr.hb * 0.95, qr.ys, z1], SLOT.hood);
  // the cushion: rounded rings along the pedestal, a pale piping at its foot
  const cs = [], cn = near ? 7 : 2, cm = near ? 8 : 4;
  for (let i = 0; i <= cn; i++) {
    const u = i / cn, z = zp + 0.03 + (z1 - zp - 0.1) * u, end = Math.sin(Math.max(0.2, Math.min(1, Math.min(u, 1 - u) * 6)) * Math.PI / 2);
    const w = 0.2 * end, h = 0.14 * (0.6 + 0.4 * end) + (u < 0.3 ? 0.03 * (1 - u / 0.3) : 0) + 0.06 * Math.min(1, Math.max(0, (u - 0.52) / 0.1)) ** 2 * (0.6 + 0.4 * end);   // a stepped seat: the passenger's part raised
    cs.push(Array.from({ length: cm }, (_, k) => { const a = Math.PI * k / (cm - 1); return [-Math.cos(a) * w, py + Math.sin(a) * h, z]; }));
  }
  for (let i = 0; i < cs.length - 1; i++) for (let k = 0; k < cm - 1; k++) B.quad(cs[i][k], cs[i + 1][k], cs[i + 1][k + 1], cs[i][k + 1], SLOT.seatDark);
  for (const ring of [cs[0], cs[cs.length - 1]]) for (let k = 1; k < cm - 1; k++) B.tri(ring[0], ring[k], ring[k + 1], SLOT.seatDark);
  if (near) for (const sx of [-1, 1]) B.tube(cs.map((r) => [sx * 0.205, py + 0.01, r[0][2]]), 0.012, 4, SLOT.seat);
  const seg = near ? 8 : 3;
  // the grab handle behind the seat; the steering column and the raised bars, the grips, the mirrors on the hood
  B.tube([[-0.16, py, z1 - 0.02], [-0.16, py + 0.16, z1 + 0.04], [0.16, py + 0.16, z1 + 0.04], [0.16, py, z1 - 0.02]], 0.016, near ? 6 : 3, SLOT.dark);
  const colA = [0, jetAt(0.3).ys + 0.36, jz(0.3)], colB = [0, JET.barY - 0.04, JET.barZ + 0.06];
  B.cyl(colA, colB, 0.045, seg, SLOT.dark, { cap: true, r1: 0.04 });
  B.box(-0.07, JET.barY - 0.07, JET.barZ - 0.02, 0.07, JET.barY + 0.01, JET.barZ + 0.1, SLOT.hood);   // the column's cowl over the clamp
  B.tube([[-0.36, JET.barY + 0.03, JET.barZ + 0.02], [-0.16, JET.barY, JET.barZ], [0.16, JET.barY, JET.barZ], [0.36, JET.barY + 0.03, JET.barZ + 0.02]], 0.014, near ? 6 : 3, SLOT.metal);
  for (const sx of [-1, 1]) {
    B.cyl([sx * 0.25, JET.barY + 0.02, JET.barZ + 0.01], [sx * 0.37, JET.barY + 0.03, JET.barZ + 0.02], 0.022, seg, SLOT.seatDark, { cap: true });
    if (near) {
      const m0 = [sx * 0.3, jetAt(0.22).ys + 0.27, jz(0.22)], m1 = [sx * 0.4, m0[1] + 0.1, m0[2] + 0.02];
      B.cyl(m0, m1, 0.008, 4, SLOT.dark);
      B.box(m1[0] - 0.05, m1[1] - 0.03, m1[2] - 0.012, m1[0] + 0.05, m1[1] + 0.03, m1[2] + 0.012, SLOT.dark);
      B.quad([m1[0] - 0.045, m1[1] - 0.025, m1[2] + 0.013], [m1[0] + 0.045, m1[1] - 0.025, m1[2] + 0.013], [m1[0] + 0.045, m1[1] + 0.025, m1[2] + 0.013], [m1[0] - 0.045, m1[1] + 0.025, m1[2] + 0.013], SLOT.glass);
    }
  }
  // the pump's nozzle and its ride plate at the stern
  B.cyl([0, JET.nozzleY, zr - 0.08], [0, JET.nozzleY, zr + 0.16], 0.08, seg, SLOT.metal, { cap: true, r1: 0.065 });
  if (near) B.box(-0.2, -0.02, zr - 0.25, 0.2, 0.0, zr + 0.06, SLOT.metal);
  // the rider: hips on the cushion, knees bent up and out, feet on the mat, the torso leaning to the bars, a buoyancy aid and a helmet
  const hipY = JET.seatTop + 0.04, hipZ = JET.seatZ, lean = 0.42, up = [0, Math.cos(lean), -Math.sin(lean)];
  const T = (h) => [0, hipY + up[1] * h, hipZ + up[2] * h];
  for (const sx of [-1, 1]) {
    const hip = [sx * 0.11, hipY + 0.02, hipZ], knee = [sx * 0.24, hipY + 0.08, hipZ - 0.44], foot = [sx * 0.33, JET.footY + 0.05, hipZ - 0.22];
    B.cyl(hip, knee, 0.088, seg, SLOT.trunks, { r1: 0.07 }); if (near) B.ball(knee, 0.07, SLOT.trunks, 6);
    B.cyl(knee, foot, 0.064, seg, SLOT.skin, { r1: 0.05 });
    if (near) B.box(foot[0] - 0.05, JET.footY, foot[2] - 0.12, foot[0] + 0.05, JET.footY + 0.07, foot[2] + 0.06, SLOT.dark);   // water shoes
  }
  B.cyl(T(0.0), T(0.22), 0.15, seg, SLOT.trunks, { r1: 0.15 });
  B.cyl(T(0.18), T(0.52), 0.185, seg, SLOT.vest, { cap: true, r1: 0.2 });   // the buoyancy aid over the chest
  if (near) for (const h of [0.27, 0.4]) B.tube(Array.from({ length: 9 }, (_, k) => { const a = Math.PI * 2 * k / 8; const c = T(h); return [c[0] + Math.cos(a) * 0.192, c[1], c[2] + Math.sin(a) * 0.192]; }), 0.012, 3, SLOT.dark);   // its straps
  B.cyl(T(0.52), T(0.62), 0.06, seg, SLOT.skin);
  const head = T(0.74); if (near) B.ball(head, 0.1, SLOT.skin, 8);
  B.ball([head[0], head[1] + 0.035, head[2] + 0.01], 0.125, SLOT.helmet, near ? 10 : 3);   // the helmet's shell
  if (near) B.box(-0.09, head[1] - 0.02, head[2] - 0.13, 0.09, head[1] + 0.04, head[2] - 0.09, SLOT.glass);   // its visor
  const sh = T(0.48);
  for (const sx of [-1, 1]) {
    const s0 = [sx * 0.21, sh[1], sh[2]], hand = [sx * 0.33, JET.barY + 0.03, JET.barZ + 0.02], el = [sx * 0.3, (s0[1] + hand[1]) / 2 - 0.06, (s0[2] + hand[2]) / 2 + 0.06];
    if (near) B.ball(s0, 0.075, SLOT.vest, 6);
    B.cyl(s0, el, 0.05, seg, SLOT.skin, { r1: 0.045 }); B.cyl(el, hand, 0.042, seg, SLOT.skin, { r1: 0.038 });
    if (near) B.ball(hand, 0.045, SLOT.glove, 6);
  }
}

// the helm's places (the runabout's frame): the skipper's seat, the wheel and the sole under her feet, for the kayakers' figure there
// (render/smallCraft.js, render/figureRig.js); the same numbers the near mesh is built from
export const HELM = (() => {
  const H = HULLS.power, W = H.well, zs = 0.5, zc = -0.42, ys0 = hullAt(H, (zc + H.L / 2) / H.L).ys, ss = hullAt(H, (zs + H.L / 2) / H.L).ys - W.depth;
  return Object.freeze({ seat: Object.freeze([0.58, ss + 0.42, zs]), sole: ss, wheel: Object.freeze([0.58, ys0 + 0.34, zc + 0.3]), tilt: 0.55, rim: 0.17 });
})();

export function buildCraftMeshes() {
  const parts = {}; for (const k of KINDS) for (const lod of ['near', 'far']) parts[`${k}-${lod}`] = buildCraft(k, { lod });
  const total = Object.values(parts).reduce((n, a) => n + a.length, 0), data = new Float32Array(total), runs = {};
  let o = 0;
  for (const [k, a] of Object.entries(parts)) { data.set(a, o); runs[k] = { first: o / VF, count: a.length / VF }; o += a.length; }
  return { data, runs };
}

// the LOD for a distance (m), with hysteresis about the last one
export function lodFor(kind, d, last = null) {
  const b = LOD_M[kind], k = last === 'near' ? b * (1 + LOD_M.hyst) : last == null ? b : b * (1 - LOD_M.hyst);
  return d < k ? 'near' : 'far';
}
