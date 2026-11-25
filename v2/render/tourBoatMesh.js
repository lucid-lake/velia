// The glass boat's meshes (v2/sim/tourBoat.js): "Velia Travel", a 10.7 m clear-view tour pontoon, and its two-seat clear
// kayaks. Pure: plain arrays, no GPU (the tests and render/tourBoat.js build them once).
// Detail round 2 (owner, 2026-11-18: "they look like toys … think about my past requirements for the other kayaks and the sailboat"):
// real proportions and thin members (25 in logs, 2 in aluminium posts and rails, a 6 cm roof with a rolled edge), the enclosed sides of
// the owner's photos (a tall navy band panel with the name, smoked windows between the posts, a white header under the roof), the small
// parts that sell scale (lofted outboard cowlings on their brackets, cleats, fenders on their lines, the bow rail and gate, the swim
// platform's teak and its ladder, nav lights in housings, the helm's windscreen and wheel, the glass panel's frame and rail); the clear
// kayak's thin white rim and aluminium gunwale bar, moulded seats with backrests, the deck bungees in an X fore and aft, the end toggles,
// the LED strip along the keel, a two-blade paddle lying in each empty one.
// Frames (as the kayak's, src/props/kayak/dims.js): x starboard, y up, z aft (the bow at −z), metres. The pontoon's y 0 is her
// waterline; the kayak's y 0 is its keel (its waterline is the draft), so the paddlers' baked clips (seat at y 0.126, z 0.2) sit in it.
// A vertex: position (3), normal (3), the material slot (1) (navAids' layout). Slots (render/tourBoat.js's shader):
//   0 white gelcoat (the header, the console, the roof's top)   1 the navy band panels (the cream "VELIA TRAVEL" drawn on them)   2 cream
//   trim   3 the deck's grey non-skid   4 brushed aluminium (the logs, the posts' bases, the cap rail)   5 dark rubber and metal   6 navy
//   vinyl (the benches, seams drawn)   7 stainless (rails, cleats, the ladder)   8 the roof's underside (its LED strip glows at night)
//   9 the kayaks' white rims   10 the kayaks' seats   11 the outboards' charcoal cowlings   12 the all-round white lens   13 the red lens
//   14 the green lens   15 teak (the swim platform)   16 white vinyl fenders   17 the kayak's LED strip   18 black cord (bungees, lines)
//   19 the paddles' blades   20 clear polycarbonate (the kayaks' hulls)   21 the smoked side windows and the windscreen   22 the deck's
//   glass viewing panel   23 navy canvas (the roof's valance, the helm chair's back)   24 the courtesy LED strips under the cap rail
//   (cool white at night)   30 a spot on the water (a quad)
// Look round 3 (owner, 2026-11-25: "the glass boat and the pontoon", more appealing): the pontoon's navy canvas valance round the roof's
// edge with its cream piping (a tour pontoon's canopy skirt), a helm chair, courtesy LED strips along the inside of the band under the cap
// rail, a weld seam along each log's crown and a stainless keel guard under each nose; the clear kayak's second (inner) skin 5 mm in (two
// Fresnel surfaces: the shell reads as a thickness, denser where it turns edge-on), its aluminium keel bar under the LED strip and three
// cross ribs on the bilge (the frame a clear kayak shows through its floor), a bonded flange outside the rim
export const SLOT = Object.freeze({ white: 0, band: 1, cream: 2, deck: 3, tube: 4, dark: 5, vinyl: 6, steel: 7, roofUnder: 8, rim: 9, seat: 10, cowl: 11, lensW: 12, lensR: 13, lensG: 14,
  teak: 15, fender: 16, led: 17, cord: 18, blade: 19, clear: 20, window: 21, floor: 22, canvas: 23, courtesy: 24, spot: 30 });
export const SKIN_T = 0.005;   // m: the clear kayak's polycarbonate, the inner skin this far in
export const VALANCE = Object.freeze({ drop: 0.16, pipe: 0.018 });   // m: the roof's canvas skirt hangs this far; the cream piping's height at its foot
export const VF = 7;
// the pontoon's numbers (the photos: a tall band, windows to the header, the roof the boat's length)
// the drawn design (a 35 ft hull, 10.7 × 3.7 m): every part is built in this frame, then scaled to her real size (SIZE, below)
const BASE = Object.freeze({
  length: 10.7, beam: 3.7, deckY: 0.62, deckZ: Object.freeze([-5.0, 4.55]), tubeR: 0.32, tubeX: 1.12, tubeY: 0.04, chamfer: 0.55,
  band: Object.freeze([0.24, 1.06]), winTop: 2.42, headerTop: 2.62, roofY: 2.62, roofT: 0.06, roofZ: Object.freeze([-4.55, 4.5]), roofHalfW: 1.95,
  posts: Object.freeze([-4.25, -2.85, -1.42, 0, 1.42, 2.85, 4.25]), postX: 1.81, postR: 0.026, railR: 0.019,
  glass: Object.freeze({ halfW: 0.6, z: Object.freeze([-1.2, 1.2]) }),
  swim: Object.freeze({ z: Object.freeze([4.55, 5.3]), y: 0.36, x: Object.freeze([-1.75, -0.05]) }), outX: Object.freeze([0.42, 1.18]), outZ: 4.6,
  text: Object.freeze({ zc: -0.6, h: 0.28, yc: 0.68, adv: 5.6 }),   // the name's centre along her side, its cap height, its centre height, the advance (letter units)
});
// her real size (owner, 2026-11-19: "the glass boat looks smaller than our sailboat"; the 40 ft tour class): 12.2 m × 3.8 m, the roof
// 2.8 m over the water. The built design is stretched along and across; heights up to the band's cap rail stay (the tubes, the deck,
// the name), the cabin above it is raised to the new roof. The name keeps its 0.28 m letters (the shader draws them in metres)
export const SIZE = Object.freeze({ length: 12.2, beam: 3.8, roofY: 2.8, knee: 1.06 });
const KZ = SIZE.length / BASE.length, KX = SIZE.beam / BASE.beam, KY = (SIZE.roofY - SIZE.knee) / (BASE.roofY - SIZE.knee);
const mapY = (y) => (y <= SIZE.knee ? y : SIZE.knee + (y - SIZE.knee) * KY);
// the vertices (VF floats: position, normal, slot) from the design's frame to hers; normals by the inverse scale, renormalised
function toSize(v) {
  for (let i = 0; i < v.length; i += 7) {
    const above = v[i + 1] > SIZE.knee;
    v[i] *= KX; v[i + 2] *= KZ; v[i + 1] = mapY(v[i + 1]);
    let nx = v[i + 3] / KX, ny = v[i + 4] / (above ? KY : 1), nz = v[i + 5] / KZ; const l = Math.hypot(nx, ny, nz) || 1;
    v[i + 3] = nx / l; v[i + 4] = ny / l; v[i + 5] = nz / l;
  }
  return v;
}
const sz = (a) => Object.freeze(a.map((z) => +(z * KZ).toFixed(4))), sx = (a) => Object.freeze(a.map((x) => +(x * KX).toFixed(4)));
// her dimensions in her own frame (the shader, the sim and the tests read these)
export const PONTOON = Object.freeze({
  ...BASE, length: SIZE.length, beam: SIZE.beam, deckZ: sz(BASE.deckZ), tubeX: +(BASE.tubeX * KX).toFixed(4), chamfer: +(BASE.chamfer * KZ).toFixed(4),
  winTop: +mapY(BASE.winTop).toFixed(4), headerTop: +mapY(BASE.headerTop).toFixed(4), roofY: SIZE.roofY, roofT: +(BASE.roofT * KY).toFixed(4),
  roofZ: sz(BASE.roofZ), roofHalfW: +(BASE.roofHalfW * KX).toFixed(4), posts: sz(BASE.posts), postX: +(BASE.postX * KX).toFixed(4),
  glass: Object.freeze({ halfW: +(BASE.glass.halfW * KX).toFixed(4), z: sz(BASE.glass.z) }),
  swim: Object.freeze({ z: sz(BASE.swim.z), y: BASE.swim.y, x: sx(BASE.swim.x) }), outX: sx(BASE.outX), outZ: +(BASE.outZ * KZ).toFixed(4),
  text: Object.freeze({ ...BASE.text, zc: +(BASE.text.zc * KZ).toFixed(4) }),
});
// the clear kayak (3.4 m × 0.85 m, two seats; ours as deep as the paddlers' seat needs)
export const CLEAR_KAYAK = Object.freeze({ length: 3.4, beam: 0.85, z0: -1.75, z1: 1.65, sheer: 0.31, sheerEnd: 0.37, rocker: 0.08, seats: Object.freeze([0.2, -0.65]), seatTop: 0.105, cockpit: Object.freeze([-1.15, 0.78]) });
export const LOD_M = 260;   // the high pontoon within this of the eye
// the name's strokes in letter units (a cap 7 tall, 4 wide; a stroke STROKE wide), for the shader's distance-field lettering
export const STROKE = 0.95;
export const GLYPH_SEGS = Object.freeze({
  V: [[0, 7, 2, 0], [2, 0, 4, 7]], E: [[0, 0, 0, 7], [0, 7, 3.8, 7], [0, 3.6, 3.2, 3.6], [0, 0, 3.8, 0]], L: [[0, 7, 0, 0], [0, 0, 3.8, 0]], I: [[2, 0, 2, 7]],
  A: [[0, 0, 2, 7], [2, 7, 4, 0], [0.75, 2.6, 3.25, 2.6]], T: [[0, 7, 4, 7], [2, 7, 2, 0]],
  R: [[0, 0, 0, 7], [0, 7, 2.8, 7], [2.8, 7, 3.8, 6.1], [3.8, 6.1, 3.8, 4.5], [3.8, 4.5, 2.8, 3.6], [2.8, 3.6, 0, 3.6], [1.7, 3.6, 4, 0]], ' ': [],
});

export function builder() {
  const v = [];
  const push = (p, n, s) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], s);
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const tri = (a, b, c, s) => { const n = norm(cross(sub(b, a), sub(c, a))); push(a, n, s); push(b, n, s); push(c, n, s); };
  const quad = (a, b, c, d, s) => { tri(a, b, c, s); tri(a, c, d, s); };
  const squad = (a, b, c, d, na, nb, nc, nd, s) => { push(a, na, s); push(b, nb, s); push(c, nc, s); push(a, na, s); push(c, nc, s); push(d, nd, s); };
  // an axis-aligned box from (x0, y0, z0) to (x1, y1, z1); faces outward
  const box = (x0, y0, z0, x1, y1, z1, s, { top = true, bottom = true, sides = true } = {}) => {
    if (top) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], s);
    if (bottom) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], s);
    if (sides) {
      quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], s); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], s);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], s); quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], s);
    }
  };
  // a cylinder from a to b (any axis), radius r (r1 at b), seg sides, smooth; caps optional
  const cyl = (a, b, r, seg, s, { cap = false, r1 = r } = {}) => {
    const ax = norm(sub(b, a)), ref = Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], u = norm(cross(ax, ref)), w = cross(ax, u);
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg * Math.PI * 2, t1 = (i + 1) / seg * Math.PI * 2;
      const d0 = [u[0] * Math.cos(t0) + w[0] * Math.sin(t0), u[1] * Math.cos(t0) + w[1] * Math.sin(t0), u[2] * Math.cos(t0) + w[2] * Math.sin(t0)];
      const d1 = [u[0] * Math.cos(t1) + w[0] * Math.sin(t1), u[1] * Math.cos(t1) + w[1] * Math.sin(t1), u[2] * Math.cos(t1) + w[2] * Math.sin(t1)];
      const p = (o, d, rr) => [o[0] + d[0] * rr, o[1] + d[1] * rr, o[2] + d[2] * rr];
      squad(p(a, d0, r), p(a, d1, r), p(b, d1, r1), p(b, d0, r1), d0, d1, d1, d0, s);
      if (cap) { tri(b, p(b, d0, r1), p(b, d1, r1), s); tri(a, p(a, d1, r), p(a, d0, r), s); }
    }
  };
  // a tube along a polyline (rails, cords), radius r
  const tube = (pts, r, seg, s) => { for (let i = 0; i < pts.length - 1; i++) cyl(pts[i], pts[i + 1], r, seg, s); };
  // a sphere (lamp lenses, the rail's ball ends)
  const ball = (c, r, s, seg = 8) => {
    for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
      const P = (a, b) => [Math.sin(a) * Math.cos(b), Math.cos(a), Math.sin(a) * Math.sin(b)];
      const a0 = i / seg * Math.PI, a1 = (i + 1) / seg * Math.PI, b0 = j / seg * 2 * Math.PI, b1 = (j + 1) / seg * 2 * Math.PI;
      const n = [P(a0, b0), P(a1, b0), P(a1, b1), P(a0, b1)], q = n.map((d) => [c[0] + d[0] * r, c[1] + d[1] * r, c[2] + d[2] * r]);
      squad(q[0], q[1], q[2], q[3], n[0], n[1], n[2], n[3], s);
    }
  };
  // a loft through rings (each an array of points, the same count, closed), smooth normals from the neighbours
  const loft = (rings, s, { capEnd = false } = {}) => {
    const R = rings.length, N = rings[0].length;
    const nrm = (i, j) => {
      const a = rings[Math.min(R - 1, i + 1)][j], b = rings[Math.max(0, i - 1)][j], c = rings[i][(j + 1) % N], d = rings[i][(j + N - 1) % N];
      const n = norm(cross(sub(c, d), sub(a, b)));
      return n;
    };
    for (let i = 0; i < R - 1; i++) for (let j = 0; j < N; j++) {
      const j1 = (j + 1) % N;
      squad(rings[i][j], rings[i][j1], rings[i + 1][j1], rings[i + 1][j], nrm(i, j), nrm(i, j1), nrm(i + 1, j1), nrm(i + 1, j), s);
    }
    if (capEnd) { const L = rings[R - 1], c = L.reduce((m, p) => [m[0] + p[0] / N, m[1] + p[1] / N, m[2] + p[2] / N], [0, 0, 0]); for (let j = 0; j < N; j++) tri(c, L[j], L[(j + 1) % N], s); }
  };
  return { v, push, tri, quad, squad, box, cyl, tube, ball, loft, norm };
}
// a superellipse ring in the xz plane at height y: half-widths a (x) and b (z), exponent e, centred at (cx, cz), n points
const sring = (cx, y, cz, a, b, e = 2.6, n = 16) => Array.from({ length: n }, (_, i) => { const t = i / n * Math.PI * 2, c = Math.cos(t), s = Math.sin(t); return [cx + a * Math.sign(c) * Math.abs(c) ** (2 / e), y, cz + b * Math.sign(s) * Math.abs(s) ** (2 / e)]; });

// an outboard on her transom (charcoal: the common modern cowling), a 90–150 hp four-stroke's proportions: the cowling lofted through
// superellipse rings (wider at its waist, a domed top, the front squared to the transom), the midsection and its shroud, the clamp
// bracket and the steering tube, the lower unit's leg into the water (its gearcase under the waterline is the water's)
function outboard(B, x, z, S) {
  const rings = [];
  const prof = [[0.92, 0.17, 0.30], [1.0, 0.205, 0.34], [1.18, 0.225, 0.37], [1.36, 0.22, 0.36], [1.47, 0.195, 0.32], [1.53, 0.15, 0.25], [1.56, 0.08, 0.14]];
  for (const [y, a, b] of prof) rings.push(sring(x, y, z + 0.32, a, b, 2.8, 20));
  B.loft(rings, S.cowl, { capEnd: true });
  B.loft([sring(x, 0.9, z + 0.32, 0.172, 0.302, 2.8, 20), sring(x, 0.84, z + 0.30, 0.13, 0.24, 2.4, 20), sring(x, 0.55, z + 0.28, 0.105, 0.2, 2.4, 20), sring(x, 0.3, z + 0.27, 0.085, 0.17, 2.2, 20), sring(x, -0.25, z + 0.29, 0.055, 0.15, 2.0, 20)], S.cowl);
  B.cyl([x - 0.24, 1.18, z + 0.32], [x + 0.24, 1.18, z + 0.32], 0.004, 4, S.steel);   // the cowling's parting line (a thin bright trim)
  B.box(x - 0.1, 0.52, z - 0.02, x + 0.1, 0.82, z + 0.12, S.dark);                    // the clamp bracket on the transom
  B.cyl([x, 0.86, z + 0.02], [x, 0.86, z - 0.28], 0.025, 8, S.steel);                // the steering tube and its link
  B.box(x - 0.17, -0.2, z + 0.1, x + 0.17, -0.18, z + 0.52, S.dark);                 // the anti-ventilation plate (just under the surface)
}

// the pontoon: high (everything) and low (the big shapes, posts and the roof)
export function buildPontoon({ lod = 'high' } = {}) {
  const B = builder(), P = BASE, hi = lod === 'high', S = SLOT;
  const hw = P.beam / 2, [dz0, dz1] = P.deckZ, seg = hi ? 20 : 8, c = P.chamfer;
  // the logs: 25 in aluminium tubes with lofted nose cones that rise to the deck, capped tails, a lifting strake each side
  for (const sx of [-1, 1]) {
    const x = sx * P.tubeX, y = P.tubeY, r = P.tubeR;
    B.cyl([x, y, dz0 + 0.9], [x, y, dz1 + 0.25], r, seg, S.tube);
    const nose = []; const nk = hi ? 6 : 3;
    for (let k = 0; k <= nk; k++) { const t = k / nk, zz = dz0 + 0.9 - t * 1.1, rr = r * Math.sqrt(1 - t * t * 0.92), yy = y + (r - rr) * 0.9; nose.push(sring(x, 0, zz, 1, 1, 2, seg).map(([px, , pz], i) => { const th = i / seg * 2 * Math.PI; return [x + Math.cos(th) * rr, yy + Math.sin(th) * rr, zz]; })); }
    B.loft(nose, S.tube, { capEnd: true });
    B.cyl([x, y, dz1 + 0.25], [x, y, dz1 + 0.32], r, seg, S.tube, { cap: true, r1: r * 0.9 });
    if (hi) for (const ss of [-1, 1]) B.cyl([x + ss * r * 0.82, y + 0.1, dz0 + 0.5], [x + ss * r * 0.82, y + 0.1, dz1], 0.022, 6, S.tube);
    if (hi) {
      B.cyl([x, y + r - 0.004, dz0 + 0.9], [x, y + r - 0.004, dz1 + 0.25], 0.009, 4, S.dark);   // the weld seam along the log's crown
      // the stainless keel guard under the nose cone (the beaching strip), following the cone's curve to the log's belly
      const g = []; for (let k = 0; k <= 5; k++) { const t = k / 5, zz = dz0 + 0.9 - t * 1.0, rr = r * Math.sqrt(1 - t * t * 0.92 * 0.83), yy = y + (r - rr) * 0.9; g.push([x, yy - rr + 0.01, zz]); }
      B.tube(g.reverse(), 0.014, 5, S.steel);
    }
  }
  // the brackets and cross-members under the deck, seen between the logs
  for (let z = dz0 + 0.5; z < dz1; z += hi ? 0.8 : 2.4) B.box(-hw + 0.15, P.tubeY + P.tubeR - 0.03, z - 0.035, hw - 0.15, P.deckY - 0.1, z + 0.035, S.dark, { top: false });
  // the deck: a slab with the chamfered bow and the glass panel's hole; the aluminium fascia round its edge
  const G = P.glass, dy0 = P.deckY - 0.08, dy1 = P.deckY;
  const slab = (x0, z0, x1, z1) => B.box(x0, dy0, z0, x1, dy1, z1, S.deck, { sides: false });
  slab(-hw, dz0 + c, hw, G.z[0]); slab(-hw, G.z[1], hw, dz1); slab(-hw, G.z[0], -G.halfW, G.z[1]); slab(G.halfW, G.z[0], hw, G.z[1]);
  B.quad([-hw + c, dy1, dz0], [-hw, dy1, dz0 + c], [hw, dy1, dz0 + c], [hw - c, dy1, dz0], S.deck);
  // the fascia where no band panel stands: the bow's gate and the stern between the platform and the outboards
  B.quad([-hw + c, dy0 - 0.04, dz0], [hw - c, dy0 - 0.04, dz0], [hw - c, dy1 + 0.02, dz0], [-hw + c, dy1 + 0.02, dz0], S.tube);
  B.quad([0.95, dy0 - 0.04, dz1], [-0.05, dy0 - 0.04, dz1], [-0.05, dy1 + 0.02, dz1], [0.95, dy1 + 0.02, dz1], S.tube);
  // the band panels: her enclosed lower sides (navy outside, the name on them; white inside), from the fascia to the cap rail; the
  // bow's open gate between the chamfers
  const [b0, b1] = P.band, t = 0.03;
  const wall = (ax, az, bx, bz) => {
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz), nx = dz / L, nz = -dx / L;   // outward (clockwise outline)
    B.quad([ax, b0, az], [ax, b1, az], [bx, b1, bz], [bx, b0, bz], S.band);
    B.quad([bx - nx * t, b0, bz - nz * t], [bx - nx * t, b1, bz - nz * t], [ax - nx * t, b1, az - nz * t], [ax - nx * t, b0, az - nz * t], S.white);
  };
  wall(hw, dz0 + c, hw, dz1 - 0.5); wall(-hw, dz1 - 0.5, -hw, dz0 + c); wall(hw - c, dz0, hw, dz0 + c); wall(-hw, dz0 + c, -hw + c, dz0);
  wall(hw, dz1 - 0.5, 0.95, dz1); wall(-0.05, dz1, -hw, dz1 - 0.5);   // the stern's corners, the platform's opening to port of the outboards
  // the cap rail along the band's top (brushed aluminium) and the cream pinstripe under it
  const capPts = [[hw - c, dz0], [hw, dz0 + c], [hw, dz1 - 0.5], [0.95, dz1]], capP = [[-hw + c, dz0], [-hw, dz0 + c], [-hw, dz1 - 0.5], [-0.05, dz1]];
  B.tube(capPts.map(([x, z]) => [x, b1 + 0.012, z]), 0.028, hi ? 8 : 4, S.tube); B.tube(capP.map(([x, z]) => [x, b1 + 0.012, z]), 0.028, hi ? 8 : 4, S.tube);
  if (hi) for (const pts of [capPts, capP]) B.tube(pts.map(([x, z]) => [x * 1.003, b1 - 0.09, z]), 0.008, 4, S.cream);
  // the posts (2 in aluminium) to the header; the smoked windows go between them (buildPontoonGlass)
  for (const z of P.posts) for (const sx of [-1, 1]) B.cyl([sx * P.postX, b1, z], [sx * P.postX, P.winTop, z], P.postR, hi ? 10 : 4, S.tube);
  if (hi) for (const sx of [-1, 1]) B.tube([[sx * P.postX, P.winTop, P.posts[0]], [sx * P.postX, P.winTop, P.posts[P.posts.length - 1]]], P.postR * 0.9, 8, S.tube);   // the window head rail
  // the header: a white panel from the window head to the roof, all round her cabin (her sides and its front and back)
  const [rz0, rz1] = P.roofZ, hx = P.postX + 0.01;
  B.quad([hx, P.winTop, rz0 + 0.3], [hx, P.headerTop, rz0 + 0.3], [hx, P.headerTop, rz1 - 0.05], [hx, P.winTop, rz1 - 0.05], S.white);
  B.quad([-hx, P.winTop, rz1 - 0.05], [-hx, P.headerTop, rz1 - 0.05], [-hx, P.headerTop, rz0 + 0.3], [-hx, P.winTop, rz0 + 0.3], S.white);
  // the roof: a thin white slab (6 cm) a hand's width over the header, its rolled edge; the underside (its LED strip at the edge)
  const rw = P.roofHalfW, ry = P.roofY + 0.005, rt = P.roofT;
  B.box(-rw, ry, rz0, rw, ry + rt, rz1, S.white, { bottom: false });
  B.quad([-rw, ry, rz0], [rw, ry, rz0], [rw, ry, rz1], [-rw, ry, rz1], S.roofUnder);
  if (hi) {
    const e = [[-rw, rz0], [rw, rz0], [rw, rz1], [-rw, rz1], [-rw, rz0]].map(([x, z]) => [x, ry + rt * 0.5, z]);
    B.tube(e, rt * 0.55, 8, S.white);
    B.box(-rw + 0.02, ry + rt, rz0 + 0.4, rw - 0.02, ry + rt + 0.012, rz1 - 0.4, S.white, { bottom: false });   // the roof's crowned top skin
    // the canvas valance: a navy skirt hanging from the roof's edge all round (the cream piping at its foot is the shader's), 2 cm out
    // from the rolled edge so it reads as cloth over the roof, not a painted band; both faces (seen from inside the cabin too)
    { const vx = rw + 0.02, vz0 = rz0 - 0.02, vz1 = rz1 + 0.02, vy0 = ry - VALANCE.drop, vy1 = ry + rt * 0.5;
      const ring = [[-vx, vz0], [vx, vz0], [vx, vz1], [-vx, vz1], [-vx, vz0]];
      for (let i = 0; i < 4; i++) { const [ax, az] = ring[i], [bx, bz] = ring[i + 1]; B.quad([ax, vy0, az], [bx, vy0, bz], [bx, vy1, bz], [ax, vy1, az], S.canvas); B.quad([ax, vy1, az], [bx, vy1, bz], [bx, vy0, bz], [ax, vy0, az], S.canvas); } }
    // the helm chair: a stainless pedestal, a white moulded bucket with navy vinyl, a short navy canvas back
    { const cx = 1.15, cz = -2.95, sy = P.deckY + 0.62;
      B.cyl([cx, P.deckY, cz], [cx, sy - 0.08, cz], 0.03, 8, S.steel); B.cyl([cx, P.deckY, cz], [cx, P.deckY + 0.02, cz], 0.16, 10, S.steel, { cap: true });
      B.box(cx - 0.24, sy - 0.08, cz - 0.22, cx + 0.24, sy, cz + 0.22, S.white); B.box(cx - 0.22, sy, cz - 0.2, cx + 0.22, sy + 0.06, cz + 0.2, S.vinyl, { bottom: false });
      B.box(cx - 0.23, sy, cz + 0.17, cx + 0.23, sy + 0.5, cz + 0.23, S.white); B.box(cx - 0.21, sy + 0.06, cz + 0.14, cx + 0.21, sy + 0.48, cz + 0.17, S.vinyl, { bottom: false }); }
    // the courtesy LED strips: a thin bar along the inside of each band panel under the cap rail (cool white at night, the deck's edge lit)
    for (const sx of [-1, 1]) B.box(sx * (hw - 0.044) - 0.008, b1 - 0.05, dz0 + c + 0.2, sx * (hw - 0.044) + 0.008, b1 - 0.035, dz1 - 0.7, S.courtesy, { top: false, bottom: false });
    // the benches along each side, facing in: white bases, navy vinyl cushions and backs (seams in the shader)
    for (const sx of [-1, 1]) {
      const z0 = sx > 0 ? -2.45 : -3.7;   // the starboard bench ends short of the helm (its chair stands there)
      B.box(sx * 1.33 - 0.22, P.deckY, z0, sx * 1.33 + 0.22, P.deckY + 0.33, 3.6, S.white, { bottom: false });
      B.box(sx * 1.33 - 0.24, P.deckY + 0.33, z0 - 0.02, sx * 1.33 + 0.24, P.deckY + 0.44, 3.62, S.vinyl, { bottom: false });
      B.box(sx * 1.62 - 0.05, P.deckY + 0.46, z0 - 0.02, sx * 1.62 + 0.05, P.deckY + 0.92, 3.62, S.vinyl, { bottom: false });
    }
    // the helm forward to starboard: the console, its dark dash, the tinted windscreen (glass), the wheel on its hub, the throttle
    B.box(0.8, P.deckY, -4.15, 1.5, P.deckY + 0.95, -3.6, S.white, { bottom: false });
    B.box(0.8, P.deckY + 0.95, -4.15, 1.5, P.deckY + 0.99, -3.75, S.dark, { bottom: false });
    B.cyl([1.15, P.deckY + 1.1, -3.64], [1.15, P.deckY + 1.05, -3.5], 0.012, 6, S.steel);
    for (let i = 0; i < 24; i++) { const a0 = i / 24 * 2 * Math.PI, a1 = (i + 1) / 24 * 2 * Math.PI, R = 0.18, cy = P.deckY + 1.1, cz = -3.58; B.cyl([1.15 + Math.cos(a0) * R, cy + Math.sin(a0) * R, cz], [1.15 + Math.cos(a1) * R, cy + Math.sin(a1) * R, cz], 0.016, 5, S.dark); }
    for (let i = 0; i < 3; i++) { const a = i / 3 * 2 * Math.PI + 0.5; B.cyl([1.15, P.deckY + 1.1, -3.58], [1.15 + Math.cos(a) * 0.17, P.deckY + 1.1 + Math.sin(a) * 0.17, -3.58], 0.009, 4, S.steel); }
    B.cyl([1.42, P.deckY + 0.99, -3.8], [1.42, P.deckY + 1.18, -3.86], 0.012, 5, S.steel); B.ball([1.42, P.deckY + 1.19, -3.86], 0.025, S.dark, 6);
    // the glass panel's frame (brushed aluminium) and its waist-high rail with ball ends
    const fy = P.deckY + 0.015;
    B.box(-G.halfW - 0.05, P.deckY, G.z[0] - 0.05, G.halfW + 0.05, fy, G.z[0], S.tube, { bottom: false });
    B.box(-G.halfW - 0.05, P.deckY, G.z[1], G.halfW + 0.05, fy, G.z[1] + 0.05, S.tube, { bottom: false });
    B.box(-G.halfW - 0.05, P.deckY, G.z[0], -G.halfW, fy, G.z[1], S.tube, { bottom: false });
    B.box(G.halfW, P.deckY, G.z[0], G.halfW + 0.05, fy, G.z[1], S.tube, { bottom: false });
    const ry1 = P.deckY + 0.86, cx = G.halfW + 0.22, cz0 = G.z[0] - 0.22, cz1 = G.z[1] + 0.22, rr = P.railR;
    for (const [x, z] of [[-cx, cz0], [cx, cz0], [-cx, cz1], [cx, cz1], [-cx, 0], [cx, 0]]) B.cyl([x, P.deckY, z], [x, ry1, z], rr, 8, S.steel);
    B.tube([[-cx, ry1, cz0], [cx, ry1, cz0], [cx, ry1, cz1], [-cx, ry1, cz1], [-cx, ry1, cz0]], rr, 8, S.steel);
    B.tube([[-cx, P.deckY + 0.45, cz0], [cx, P.deckY + 0.45, cz0]], rr * 0.8, 6, S.steel); B.tube([[-cx, P.deckY + 0.45, cz1], [cx, P.deckY + 0.45, cz1]], rr * 0.8, 6, S.steel);
    // the bow rail round the open foredeck (on stanchions over the band, the gate's two short rails swing in) and its ball ends
    const by = P.deckY + 0.85, bowPts = [[-0.55, dz0 + 0.02], [-hw + c, dz0 + 0.02], [-hw + 0.02, dz0 + c], [-hw + 0.02, rz0 + 0.3]], bowS = bowPts.map(([x, z]) => [-x, z]);
    for (const pts of [bowPts, bowS]) { B.tube(pts.map(([x, z]) => [x, by, z]), rr, 8, S.steel); for (const [x, z] of pts) B.cyl([x, b1 + 0.02, z], [x, by, z], rr, 6, S.steel); B.ball([pts[0][0], by, pts[0][1]], 0.03, S.steel, 6); }
    B.tube([[-0.5, by - 0.02, dz0 + 0.05], [-0.05, by - 0.02, dz0 + 0.18]], rr * 0.9, 6, S.steel); B.tube([[0.5, by - 0.02, dz0 + 0.05], [0.05, by - 0.02, dz0 + 0.18]], rr * 0.9, 6, S.steel);
    // the swim and viewing platform astern (teak slats on an aluminium frame), its stainless ladder down into the water, its grab rails
    const [sx0, sx1] = P.swim.x, [sz0, sz1] = P.swim.z, sy = P.swim.y;
    B.box(sx0, sy - 0.07, sz0, sx1, sy - 0.02, sz1, S.tube, { top: false });
    for (let x = sx0 + 0.02; x < sx1 - 0.05; x += 0.1) B.box(x, sy - 0.02, sz0 + 0.02, x + 0.085, sy, sz1 - 0.02, S.teak, { bottom: false });
    for (const lx of [-1.15, -0.75]) { B.cyl([lx, sy, sz1 - 0.04], [lx, -0.75, sz1 + 0.12], 0.016, 6, S.steel); B.tube([[lx, sy, sz1 - 0.04], [lx, sy + 0.55, sz1 - 0.12], [lx, sy + 0.55, sz0 + 0.05]], 0.016, 6, S.steel); }
    for (let k = 0; k < 4; k++) { const y = 0.15 - k * 0.27, zz = sz1 + 0.04 + k * 0.035; B.box(-1.15, y - 0.012, zz - 0.03, -0.75, y + 0.012, zz + 0.03, S.steel); }
    // cleats (stainless, two horns) on the fascia at the quarters and the bow, and white vinyl fenders on their lines over the side
    const cleat = (x, z, sgn) => { B.box(x - 0.02, P.deckY, z - 0.02, x + 0.02, P.deckY + 0.04, z + 0.02, S.steel); B.cyl([x, P.deckY + 0.05, z - 0.11], [x, P.deckY + 0.05, z + 0.11], 0.012, 6, S.steel, { cap: true }); };
    for (const [x, z] of [[hw - 0.12, -4.0], [-hw + 0.12, -4.0], [hw - 0.12, 4.2], [-hw + 0.12, 4.2], [hw - 0.12, 0.6], [-hw + 0.12, 0.6]]) cleat(x, z, Math.sign(x));
    for (const [sx, z] of [[1, -2.3], [1, 2.1], [-1, -2.3], [-1, 2.1]]) {
      const x = sx * (hw + 0.11);
      B.tube([[sx * hw, b1 + 0.01, z], [x, b1 - 0.05, z], [x, 0.66, z]], 0.005, 4, S.cord);
      B.loft([0, 1, 2, 3, 4, 5, 6].map((k) => { const yy = 0.66 - k * 0.075, rr2 = 0.09 * Math.sqrt(Math.max(0.05, 1 - ((k - 3) / 3.3) ** 4)); return Array.from({ length: 12 }, (_, i) => { const th = i / 12 * 2 * Math.PI; return [x + Math.cos(th) * rr2, yy, z + Math.sin(th) * rr2]; }); }), S.fender, { capEnd: true });
    }
    // her lights: the sidelights in their black housings on the bow rail's corners (red to port, green to starboard), the all-round
    // white on its pole over the roof's after edge
    for (const sx of [-1, 1]) { const x = sx * (hw - 0.05), z = dz0 + c + 0.08; B.box(x - 0.05, by + 0.01, z - 0.07, x + 0.05, by + 0.1, z + 0.07, S.dark); B.box(x - 0.051, by + 0.025, z - 0.065, x + 0.051, by + 0.085, z + 0.02, sx < 0 ? S.lensR : S.lensG); }
    B.cyl([0, ry + rt, 4.3], [0, ry + rt + 0.75, 4.3], 0.018, 6, S.steel); B.cyl([0, ry + rt + 0.75, 4.3], [0, ry + rt + 0.86, 4.3], 0.04, 10, S.lensW, { cap: true }); B.cyl([0, ry + rt + 0.86, 4.3], [0, ry + rt + 0.9, 4.3], 0.045, 10, S.dark, { cap: true });
  }
  // the outboards on her transom (to starboard of the swim platform)
  for (const x of P.outX) {
    if (hi) outboard(B, x, P.outZ, S);
    else { B.box(x - 0.2, 0.9, P.outZ + 0.0, x + 0.2, 1.52, P.outZ + 0.66, S.cowl); B.box(x - 0.08, -0.2, P.outZ + 0.12, x + 0.08, 0.9, P.outZ + 0.45, S.cowl, { top: false }); }
  }
  return toSize(new Float32Array(B.v));
}

// the smoked windows (between the posts, the band's cap to the header; her cabin's front and back too), the windscreen and the deck's
// glass panel
export function buildPontoonGlass() {
  const B = builder(), P = BASE, S = SLOT, x = P.postX, y0 = P.band[1] + 0.03, y1 = P.winTop;
  const zs = P.posts;
  for (const sx of [-1, 1]) for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i] + P.postR, z1 = zs[i + 1] - P.postR, xx = sx * x;
    if (sx < 0) B.quad([xx, y0, z1], [xx, y1, z1], [xx, y1, z0], [xx, y0, z0], S.window); else B.quad([xx, y0, z0], [xx, y1, z0], [xx, y1, z1], [xx, y0, z1], S.window);
  }
  B.quad([0.82, P.deckY + 0.99, -3.75], [1.48, P.deckY + 0.99, -3.75], [1.48, P.deckY + 1.32, -3.9], [0.82, P.deckY + 1.32, -3.9], S.window);   // the windscreen
  const G = P.glass, gy = P.deckY - 0.02;
  B.quad([-G.halfW, gy, G.z[0]], [-G.halfW, gy, G.z[1]], [G.halfW, gy, G.z[1]], [G.halfW, gy, G.z[0]], S.floor);
  return toSize(new Float32Array(B.v));
}

// the clear kayak's shell (lofted: a round-bilge two-seater with rocker, its ends rising; open cockpit, clear decks at the ends)
const K = CLEAR_KAYAK;
const kayakHalfBeam = (z) => { const u = Math.max(-1, Math.min(1, (z - (K.z0 + K.z1) / 2) / ((K.z1 - K.z0) / 2))); return (K.beam / 2) * Math.max(0, 1 - Math.abs(u) ** 2.2) ** 0.55; };
const kayakSheer = (z) => { const u = (z - (K.z0 + K.z1) / 2) / ((K.z1 - K.z0) / 2); return K.sheer + (K.sheerEnd - K.sheer) * u * u; };
const kayakKeel = (z) => { const u = (z - (K.z0 + K.z1) / 2) / ((K.z1 - K.z0) / 2); return K.rocker * u ** 4 + 0.02 * u * u; };
const deckY = (z, x) => { const b = kayakHalfBeam(z) || 1e-3; return kayakSheer(z) + 0.045 * (1 - (x / b) ** 2); };
export function buildKayakShell() {
  const B = builder(), N = 34, M = 16, S = SLOT;
  const at = (i, j) => { const z = K.z0 + (K.z1 - K.z0) * i / N, b = kayakHalfBeam(z), sh = kayakSheer(z), kl = kayakKeel(z), ph = -Math.PI / 2 + Math.PI * j / M;
    return [b * Math.sin(ph), sh - (sh - kl) * Math.max(0, Math.cos(ph)) ** 0.65, z]; };
  const nAt = (i, j) => { const ph = -Math.PI / 2 + Math.PI * j / M; return B.norm([Math.sin(ph), -Math.cos(ph) * 1.4, 0]); };
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) B.squad(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j), nAt(i, j), nAt(i, j + 1), nAt(i + 1, j + 1), nAt(i + 1, j), S.clear);
  // the inner skin (SKIN_T in along the normal, facing in): the shell's second Fresnel surface, so it reads as a sheet with a thickness,
  // densest where it turns edge-on (the rim's roll, the chines seen from above), and the paddler's legs sit inside a real wall
  const inA = (i, j) => { const p = at(i, j), n = nAt(i, j); return [p[0] - n[0] * SKIN_T, p[1] - n[1] * SKIN_T, p[2] - n[2] * SKIN_T]; };
  const inN = (i, j) => { const n = nAt(i, j); return [-n[0], -n[1], -n[2]]; };
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) B.squad(inA(i, j + 1), inA(i, j), inA(i + 1, j), inA(i + 1, j + 1), inN(i, j + 1), inN(i, j), inN(i + 1, j), inN(i + 1, j + 1), S.clear);
  // the clear decks fore and aft of the cockpit (a gentle camber)
  const deck = (za, zb) => { const n = 10, m = 6; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const z0 = za + (zb - za) * i / n, z1 = za + (zb - za) * (i + 1) / n, P = (z, f) => { const b = kayakHalfBeam(z); return [b * f, deckY(z, b * f), z]; };
    const f0 = -1 + 2 * j / m, f1 = -1 + 2 * (j + 1) / m, nn = (f) => B.norm([f * 0.25, 1, 0]);
    B.squad(P(z0, f0), P(z0, f1), P(z1, f1), P(z1, f0), nn(f0), nn(f1), nn(f1), nn(f0), S.clear); } };
  deck(K.z0, K.cockpit[0]); deck(K.cockpit[1], K.z1);
  return new Float32Array(B.v);
}
// the opaque parts: the white rim along the sheer and the aluminium gunwale bar under it, the coaming's ends, the two moulded seats
// with their backrests, the deck bungees in an X fore and aft with their pads, the end toggles, the LED strip along the keel; and (paddle:
// true, the empty kayaks) a two-blade paddle lying in the cockpit
export function buildKayakFrame({ paddle = false } = {}) {
  const B = builder(), S = SLOT, n = 30;
  for (const sx of [-1, 1]) for (let i = 0; i < n; i++) {
    const z0 = K.z0 + 0.03 + (K.z1 - K.z0 - 0.06) * i / n, z1 = K.z0 + 0.03 + (K.z1 - K.z0 - 0.06) * (i + 1) / n;
    B.cyl([sx * kayakHalfBeam(z0), kayakSheer(z0), z0], [sx * kayakHalfBeam(z1), kayakSheer(z1), z1], 0.013, 6, S.rim);
    if (z0 > K.cockpit[0] && z1 < K.cockpit[1]) B.cyl([sx * (kayakHalfBeam(z0) - 0.02), kayakSheer(z0) - 0.035, z0], [sx * (kayakHalfBeam(z1) - 0.02), kayakSheer(z1) - 0.035, z1], 0.008, 5, S.tube);
  }
  for (const z of K.cockpit) { const b = kayakHalfBeam(z); B.tube([-1, -0.5, 0, 0.5, 1].map((f) => [b * f, deckY(z, b * f) + 0.008, z]), 0.011, 5, S.rim); }
  // the bonded flange: the two half-shells' lip, 2.2 cm out from the rim (white; from above the outline a clear kayak really shows)
  for (const sx of [-1, 1]) for (let i = 0; i < n; i++) {
    const z0 = K.z0 + 0.05 + (K.z1 - K.z0 - 0.1) * i / n, z1 = K.z0 + 0.05 + (K.z1 - K.z0 - 0.1) * (i + 1) / n, b0 = kayakHalfBeam(z0), b1 = kayakHalfBeam(z1), y0 = kayakSheer(z0) - 0.006, y1 = kayakSheer(z1) - 0.006;
    const a = [sx * b0, y0, z0], b = [sx * (b0 + 0.022), y0, z0], c2 = [sx * (b1 + 0.022), y1, z1], d = [sx * b1, y1, z1];
    B.squad(a, b, c2, d, [0, 1, 0], [0, 1, 0], [0, 1, 0], [0, 1, 0], S.rim); B.squad(d, c2, b, a, [0, -1, 0], [0, -1, 0], [0, -1, 0], [0, -1, 0], S.rim);
  }
  // the frame seen through the floor: the aluminium keel bar along the bilge (the LED strip rides on it) and three cross ribs, each a
  // thin bar lying on the inner skin from gunwale to gunwale (clear of the seats)
  for (let i = 0; i < 12; i++) { const z0 = -1.35 + 2.65 * i / 12, z1 = -1.35 + 2.65 * (i + 1) / 12, k0 = kayakKeel((z0 + z1) / 2); B.box(-0.02, k0 + 0.001, z0, 0.02, k0 + 0.012, z1, S.tube, { bottom: false }); }
  for (const z of [-1.3, -0.25, 1.2]) {
    const b = kayakHalfBeam(z), sh = kayakSheer(z), kl = kayakKeel(z), pts = [];
    for (let j = 1; j < 16; j++) { const ph = -Math.PI / 2 + Math.PI * j / 16; pts.push([(b - 0.014) * Math.sin(ph), sh - (sh - kl) * Math.max(0, Math.cos(ph)) ** 0.65 + 0.012, z]); }
    B.tube(pts, 0.008, 4, S.tube);
  }
  // the seats: a contoured pad (two slabs) on its pedestal, a backrest on two thin struts
  for (const z of K.seats) {
    const w = 0.2, y = K.seatTop;
    B.box(-w, y - 0.025, z - 0.2, w, y, z + 0.1, S.seat); B.box(-w + 0.03, y, z - 0.18, w - 0.03, y + 0.012, z - 0.05, S.seat);
    B.box(-w + 0.01, y + 0.06, z + 0.13, w - 0.01, y + 0.27, z + 0.165, S.seat);
    for (const sx of [-1, 1]) B.cyl([sx * (w - 0.04), y, z + 0.1], [sx * (w - 0.04), y + 0.2, z + 0.16], 0.007, 5, S.tube);
    B.box(-0.04, 0.025, z - 0.1, 0.04, y - 0.025, z + 0.05, S.seat, { top: false });
  }
  // the deck bungees: an X of black shock cord over each clear deck, from four pads on the rim
  for (const [za, zb] of [[K.z0 + 0.38, K.cockpit[0] - 0.06], [K.cockpit[1] + 0.08, K.z1 - 0.4]]) {
    const ba = kayakHalfBeam(za) - 0.03, bb = kayakHalfBeam(zb) - 0.03, ya = deckY(za, ba) + 0.012, yb = deckY(zb, bb) + 0.012, ym = deckY((za + zb) / 2, 0) + 0.014;
    B.tube([[-ba, ya, za], [0, ym, (za + zb) / 2], [bb, yb, zb]], 0.0045, 4, S.cord); B.tube([[ba, ya, za], [0, ym, (za + zb) / 2], [-bb, yb, zb]], 0.0045, 4, S.cord);
    for (const [x, y, z] of [[-ba, ya, za], [ba, ya, za], [-bb, yb, zb], [bb, yb, zb]]) B.box(x - 0.012, y - 0.008, z - 0.012, x + 0.012, y + 0.002, z + 0.012, S.cord);
  }
  // the end toggles: a black handle on a short loop of cord at the bow and the stern
  for (const [z, s] of [[K.z0 + 0.08, 1], [K.z1 - 0.08, -1]]) { const y = kayakSheer(z) + 0.03; B.tube([[0, y, z], [0, y + 0.01, z - s * 0.08]], 0.004, 4, S.cord); B.cyl([-0.055, y + 0.012, z - s * 0.09], [0.055, y + 0.012, z - s * 0.09], 0.011, 6, S.cord, { cap: true }); }
  // the LED strip along the keel inside the hull (a thin flat bar; it glows at night)
  for (let i = 0; i < 12; i++) { const z0 = -1.2 + 2.2 * i / 12, z1 = -1.2 + 2.2 * (i + 1) / 12; B.box(-0.012, kayakKeel(z0) + 0.012, z0, 0.012, kayakKeel(z0) + 0.02, z1, S.led, { bottom: false }); }
  // the paddle lying in an empty one: the shaft across the cockpit, two feathered blades (lofted thin ovals)
  if (paddle) {
    const y = K.seatTop + 0.04, a = [-0.32, y, -1.0], b = [0.3, y + 0.04, 1.05];
    B.cyl(a, b, 0.015, 8, S.cord);
    const blade = (c, dir) => { const rings = [0, 0.25, 0.5, 0.75, 1].map((t) => { const w = 0.085 * Math.sin(Math.PI * (0.15 + 0.7 * t)) + 0.02, L = 0.46; const cz = c[2] + dir * (t * L); return Array.from({ length: 8 }, (_, i) => { const th = i / 8 * 2 * Math.PI; return [c[0] + Math.cos(th) * w, c[1] + Math.sin(th) * 0.008, cz]; }); }); B.loft(rings, S.blade, { capEnd: true }); };
    blade([a[0], a[1], a[2]], -1); blade([b[0], b[1], b[2]], 1);
  }
  return new Float32Array(B.v);
}
// a spot on the water: a unit quad (x, z in −1..1) facing up
function buildSpot() {
  const B = builder();
  B.quad([-1, 0, -1], [-1, 0, 1], [1, 0, 1], [1, 0, -1], SLOT.spot);
  return new Float32Array(B.v);
}
// every mesh, one vertex set: { data, runs: { name: { first, count } } }
export function buildTourMeshes() {
  const parts = { hi: buildPontoon({ lod: 'high' }), lo: buildPontoon({ lod: 'low' }), glass: buildPontoonGlass(), shell: buildKayakShell(), frame: buildKayakFrame(), framePaddle: buildKayakFrame({ paddle: true }), spot: buildSpot() };
  const total = Object.values(parts).reduce((n, a) => n + a.length, 0), data = new Float32Array(total), runs = {};
  let o = 0;
  for (const [k, a] of Object.entries(parts)) { data.set(a, o); runs[k] = { first: o / VF, count: a.length / VF }; o += a.length; }
  return { data, runs };
}
