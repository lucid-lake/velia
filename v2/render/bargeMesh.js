// The July 4th barges as meshes (owner, 2026-11-18, round 2: "built from boxes and look blocky up close: bring them to the
// channel buoys' bar"). Pure: plain arrays, no GPU (the tests and render/fireworks.js build them once).
// Local frame: x along the barge (the pushboat at −x), y up from the waterline, z across (+z the far side); metres.
// A vertex: position (3), normal (3), the material slot (1) — navAids' layout. Two levels of detail:
//   high  (the camera within LOD_M): the raked hull lofted with bevelled chines, two half-round rubbing strakes, the deck,
//         bitts and cleats, sand berms as soft mounds and sandbags as pillows, the mortar racks as wooden frames holding rows
//         of real black tubes (open mouths), boxed cakes, a corrugated container with its doors, a shed, a generator, pipe
//         rails on round stanchions, tyre fenders as tori on their chains, life rings, and the pushboat: its lofted hull, push
//         knees faced in rubber, deckhouse, wheelhouse with its window band, roof, stacks, mast and light boxes, tyres
//   low   (farther): the same hull and the big shapes as plain solids (the racks' mouths drawn in the shader)
// The patrol boat: a small lofted hull with a pointed bow, its console and light bar.
export const SLOT = Object.freeze({ hull: 0, deck: 1, sand: 2, wood: 3, tube: 4, mouth: 5, container: 6, galv: 7, rubber: 8, ring: 9, white: 10, glass: 11, tugHull: 12, black: 13, cake: 14, grey: 15, rackLow: 16 });
export const VF = 7;
export const LOD_M = 420;   // the high mesh within this distance of the camera (m)
export const HULL = Object.freeze({ length: 36.6, beam: 9.1, depth: 2.1, freeboard: 1.0, rake: 2.6, chine: 0.28, endY: 0.45 });
export const TUG = Object.freeze({ length: 12, beam: 5, x: -(36.6 / 2 + 6.2) });

function builder() {
  const v = [];
  const push = (p, n, s) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], s);
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const tri = (a, b, c, s) => { const n = norm(cross(sub(b, a), sub(c, a))); push(a, n, s); push(b, n, s); push(c, n, s); };
  const quad = (a, b, c, d, s) => { tri(a, b, c, s); tri(a, c, d, s); };
  // a smooth quad (its four normals given)
  const squad = (a, b, c, d, na, nb, nc, nd, s) => { push(a, na, s); push(b, nb, s); push(c, nc, s); push(a, na, s); push(c, nc, s); push(d, nd, s); };
  const box = (cx, cy, cz, sx, sy, sz, s, { top = true, bottom = false } = {}) => {
    const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
    if (top) quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], s);
    if (bottom) quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], s);
    quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], s); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], s);
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], s); quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], s);
  };
  // a cylinder along an axis ('x', 'y', 'z') from c (its start's centre) over len, radius r; smooth sides; caps optional
  const cyl = (c, axis, r, len, seg, s, { cap0 = false, cap1 = true, capSlot = s, r1 = r } = {}) => {
    const P = (u, w, t) => (axis === 'y' ? [c[0] + u, c[1] + t, c[2] + w] : axis === 'x' ? [c[0] + t, c[1] + u, c[2] + w] : [c[0] + u, c[1] + w, c[2] + t]);
    const N = (u, w) => (axis === 'y' ? [u, 0, w] : axis === 'x' ? [0, u, w] : [u, w, 0]);
    const A = axis === 'y' ? [0, 1, 0] : axis === 'x' ? [1, 0, 0] : [0, 0, 1];
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI, c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      squad(P(c0 * r, s0 * r, 0), P(c1 * r, s1 * r, 0), P(c1 * r1, s1 * r1, len), P(c0 * r1, s0 * r1, len), N(c0, s0), N(c1, s1), N(c1, s1), N(c0, s0), s);
      if (cap1) { const ctr = P(0, 0, len); push(ctr, A, capSlot); push(P(c0 * r1, s0 * r1, len), A, capSlot); push(P(c1 * r1, s1 * r1, len), A, capSlot); }
      if (cap0) { const ctr = P(0, 0, 0), B = A.map((x) => -x); push(ctr, B, capSlot); push(P(c1 * r, s1 * r, 0), B, capSlot); push(P(c0 * r, s0 * r, 0), B, capSlot); }
    }
  };
  // a torus round centre c, its axis along 'x' | 'y' | 'z': ring radius R, tube radius r
  const torus = (c, axis, R, r, su, sv, s) => {
    const P = (u, w, h) => (axis === 'z' ? [c[0] + u, c[1] + w, c[2] + h] : axis === 'x' ? [c[0] + h, c[1] + w, c[2] + u] : [c[0] + u, c[1] + h, c[2] + w]);
    const pt = (i, j) => { const a = (i / su) * 2 * Math.PI, b = (j / sv) * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
      const p = P((R + r * cb) * ca, (R + r * cb) * sa, r * sb), n = P(cb * ca, cb * sa, sb).map((x, k) => x - [c[0], c[1], c[2]][k]); return [p, n]; };
    for (let i = 0; i < su; i++) for (let j = 0; j < sv; j++) { const [a, na] = pt(i, j), [b, nb] = pt(i + 1, j), [cc, nc] = pt(i + 1, j + 1), [d, nd] = pt(i, j + 1); squad(a, b, cc, d, na, nb, nc, nd, s); }
  };
  // a profile in the (y, z) plane swept along x from x0 to x1; prof: [[y, z, ny, nz], …] (smooth normals)
  const sweepX = (prof, x0, x1, s) => {
    for (let i = 1; i < prof.length; i++) {
      const [y0, z0, ny0, nz0] = prof[i - 1], [y1, z1, ny1, nz1] = prof[i];
      squad([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], [0, ny0, nz0], [0, ny0, nz0], [0, ny1, nz1], [0, ny1, nz1], s);
    }
  };
  // a soft mound (sand): length L along x, width W, height h, centred at (cx, y0, cz); a cosine across, the ends rounded
  const mound = (cx, y0, cz, L, W, h, s, nx = 36, nz = 9) => {
    const H = (x, z) => { const u = Math.abs(x) / (L / 2), w = Math.abs(z) / (W / 2); const e = u > 0.88 ? Math.cos(((u - 0.88) / 0.12) * Math.PI / 2) : 1; return w >= 1 ? 0 : h * Math.cos(w * Math.PI / 2) ** 1.4 * Math.max(0, e) * (1 + 0.06 * Math.sin(x * 2.1 + z * 3.7)); };
    const P = (i, j) => { const x = -L / 2 + (L * i) / nx, z = -W / 2 + (W * j) / nz; return [cx + x, y0 + H(x, z), cz + z]; };
    const Nn = (i, j) => { const x = -L / 2 + (L * i) / nx, z = -W / 2 + (W * j) / nz, e = 0.05; return norm([-(H(x + e, z) - H(x - e, z)) / (2 * e), 1, -(H(x, z + e) - H(x, z - e)) / (2 * e)]); };
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) squad(P(i, j), P(i, j + 1), P(i + 1, j + 1), P(i + 1, j), Nn(i, j), Nn(i, j + 1), Nn(i + 1, j + 1), Nn(i + 1, j), s);
  };
  // a pillow (a sandbag): a squashed sphere of half sizes (a, b, c)
  const pillow = (cx, cy, cz, a, b, c, s, nu = 8, nv = 5) => {
    const P = (i, j) => { const th = (i / nu) * 2 * Math.PI, ph = -Math.PI / 2 + (j / nv) * Math.PI, sq = (t) => Math.sign(t) * Math.abs(t) ** 0.7;
      const x = sq(Math.cos(ph)) * sq(Math.cos(th)), y = Math.sin(ph) ** 1, z = sq(Math.cos(ph)) * sq(Math.sin(th)); return [[cx + a * x, cy + b * y, cz + c * z], norm([x / a, y / b, z / c])]; };
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const [p0, n0] = P(i, j), [p1, n1] = P(i + 1, j), [p2, n2] = P(i + 1, j + 1), [p3, n3] = P(i, j + 1); squad(p0, p1, p2, p3, n0, n1, n2, n3, s); }
  };
  // a disc facing up at c, radius r
  const disc = (c, r, seg, s) => { for (let i = 0; i < seg; i++) { const a0 = (i / seg) * 2 * Math.PI, a1 = ((i + 1) / seg) * 2 * Math.PI; push(c, [0, 1, 0], s); push([c[0] + r * Math.cos(a0), c[1], c[2] + r * Math.sin(a0)], [0, 1, 0], s); push([c[0] + r * Math.cos(a1), c[1], c[2] + r * Math.sin(a1)], [0, 1, 0], s); } };
  return { v, tri, quad, squad, box, cyl, torus, sweepX, mound, pillow, push, disc };
}

// a raked, chine-bevelled hull lofted along x: half length Hx, half beam Bz, bottom −D, deck F, rake length R at each end
// (rakeAft / rakeFwd: 0 a square end), the chine bevel c; bow end (+x) and stern (−x)
function hull(g, { x0 = 0, Hx, Bz, D, F, R0, R1, c, endY, s, ends = true }) {
  const stations = [];
  const raked = (x) => { const a = x - x0; if (R1 > 0 && a > Hx - R1) return (a - (Hx - R1)) / R1; if (R0 > 0 && a < -Hx + R0) return (-Hx + R0 - a) / R0; return 0; };
  const yb = (x) => { const t = raked(x); return -D + (D + F - endY) * (1 - Math.cos(t * Math.PI / 2)); };   // the rake curves up (a swim end)
  for (let k = 0; k <= 8; k++) if (R0 > 0) stations.push(x0 - Hx + (R0 * k) / 8);
  stations.push(x0 - Hx + R0, x0 + Hx - R1);
  for (let k = 0; k <= 8; k++) if (R1 > 0) stations.push(x0 + Hx - R1 + (R1 * k) / 8);
  if (!R0) stations.unshift(x0 - Hx); if (!R1) stations.push(x0 + Hx);
  const xs = [...new Set(stations.map((x) => +x.toFixed(4)))].sort((a, b) => a - b);
  const sec = (x) => { const y = yb(x), cc = Math.min(c, (F - y) * 0.4); return [[y, 0], [y, Bz - cc], [y + cc, Bz], [F, Bz]]; };
  for (let i = 1; i < xs.length; i++) {
    const a = sec(xs[i - 1]), b = sec(xs[i]);
    for (const sz of [-1, 1]) for (let k = 1; k < a.length; k++) {
      const A = (p, x) => [x, p[0], p[1] * sz];
      g.quad(A(a[k - 1], xs[i - 1]), A(b[k - 1], xs[i]), A(b[k], xs[i]), A(a[k], xs[i - 1]), s);
    }
  }
  if (ends) for (const x of [xs[0], xs[xs.length - 1]]) { const y = yb(x); g.quad([x, y, -Bz], [x, y, Bz], [x, F, Bz], [x, F, -Bz], s); }
  return { yb };
}

export function buildBarge({ lod = 'high', seed = 1 } = {}) {
  const g = builder(), S = SLOT, hi = lod === 'high';
  const Hx = HULL.length / 2, Bz = HULL.beam / 2, F = HULL.freeboard, D = HULL.depth - F;
  hull(g, { Hx, Bz, D, F, R0: HULL.rake, R1: HULL.rake, c: HULL.chine, endY: HULL.endY, s: S.hull });
  g.quad([-Hx, F, -Bz], [-Hx, F, Bz], [Hx, F, Bz], [Hx, F, -Bz], S.deck);
  // the low steel coaming (an angle iron) round the deck edge
  for (const z of [-1, 1]) g.box(0, F + 0.09, z * (Bz - 0.05), HULL.length - 0.1, 0.18, 0.1, S.hull);
  for (const x of [-1, 1]) g.box(x * (Hx - 0.05), F + 0.09, 0, 0.1, 0.18, HULL.beam - 0.2, S.hull);
  if (hi) {
    // two half-round rubbing strakes down each side (heavy pipe, welded on)
    const r = 0.1, half = (yc, sz) => Array.from({ length: 7 }, (_, k) => { const a = -Math.PI / 2 + (k / 6) * Math.PI; return [yc + r * Math.sin(a), sz * (Bz + r * Math.cos(a)), Math.sin(a), sz * Math.cos(a)]; });
    for (const sz of [-1, 1]) for (const yc of [F - 0.22, 0.42]) g.sweepX(half(yc, sz), -Hx + HULL.rake * 0.7, Hx - HULL.rake * 0.7, S.hull);
    // bitts (double bollards on a base plate) at the four corners; cleats midships
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      g.box(x * (Hx - 1.3), F + 0.03, z * (Bz - 0.7), 0.9, 0.06, 0.45, S.black);
      for (const dx of [-0.25, 0.25]) g.cyl([x * (Hx - 1.3) + dx, F + 0.05, z * (Bz - 0.7)], 'y', 0.12, 0.55, 12, S.black, { r1: 0.12 });
      for (const dx of [-0.25, 0.25]) g.cyl([x * (Hx - 1.3) + dx, F + 0.6, z * (Bz - 0.7)], 'y', 0.16, 0.05, 12, S.black);
    }
    for (const z of [-1, 1]) for (const x of [-6, 6]) { g.box(x, F + 0.08, z * (Bz - 0.35), 0.5, 0.08, 0.12, S.black); g.cyl([x - 0.3, F + 0.16, z * (Bz - 0.35)], 'x', 0.05, 0.6, 8, S.black, { cap0: true }); }
  }
  // the firing deck: two rows of six racks in soft sand berms; sandbags between; boxed cakes along the far side
  const rows = [-2.1, 1.3];
  rows.forEach((rz, ri) => {
    if (hi) g.mound(-4, F, rz, 27, 3.4, 0.42, S.sand); else g.box(-4, F + 0.18, rz, 26, 0.36, 3.0, S.sand);
    for (let k = 0; k < 6; k++) {
      const cx = -15 + k * 4.4, h = 1.0 + 0.12 * ((k + ri + seed) % 2), y0 = F + 0.3;
      if (!hi) { g.box(cx, y0 + h / 2, rz, 2.4, h, 1.2, S.rackLow); continue; }
      // the wooden frame: four posts, rails at the foot, the middle and the top, both ways
      for (const px of [-1.17, 1.17]) for (const pz of [-0.57, 0.57]) g.box(cx + px, y0 + h / 2, rz + pz, 0.08, h, 0.08, S.wood);
      for (const yy of [0.06, h * 0.55, h - 0.05]) { for (const pz of [-0.57, 0.57]) g.box(cx, y0 + yy, rz + pz, 2.4, 0.09, 0.05, S.wood); for (const px of [-1.17, 1.17]) g.box(cx + px, y0 + yy, rz, 0.05, 0.09, 1.2, S.wood); }
      // the tubes: one size a rack (3" to 6" shells), in rows filling the frame, standing a little proud of it
      const size = [0.05, 0.065, 0.08, 0.095][(k * 3 + ri + seed) % 4], pitch = size * 2 + 0.03;
      const nx = Math.floor(2.2 / pitch), nz = Math.floor(1.05 / pitch);
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const tx = cx - ((nx - 1) * pitch) / 2 + i * pitch, tz = rz - ((nz - 1) * pitch) / 2 + j * pitch, th = h + 0.05 - 0.04 * ((i * 7 + j * 3) % 3);
        const seg = size < 0.07 ? 6 : 8;
        g.cyl([tx, y0, tz], 'y', size, th, seg, S.tube, { cap1: false });
        g.disc([tx, y0 + th - 0.025, tz], size * 0.97, seg, S.mouth);   // the bore: a dark mouth just under the rim
      }
    }
  });
  if (hi) { for (let k = 0; k < 9; k++) g.pillow(-16 + k * 3.0, F + 0.14, -0.4, 0.32, 0.14, 0.2, S.sand); }
  for (let k = 0; k < 4; k++) g.box(-13 + k * 6.5, F + 0.2, 3.35, 0.7, 0.4, 0.55, S.cake);
  // the 20 ft container (corrugated sides, its doors and corner castings), the shed, the generator, the firing cabinet
  const cx = Hx - 5.4, cz = 1.4, cw = 6.06, ch = 2.59, cd = 2.44, cy = F;
  if (hi) {
    g.quad([cx - cw / 2, cy + ch, cz - cd / 2], [cx - cw / 2, cy + ch, cz + cd / 2], [cx + cw / 2, cy + ch, cz + cd / 2], [cx + cw / 2, cy + ch, cz - cd / 2], S.container);
    const ribs = Math.round(cw / 0.28);
    for (const sz of [-1, 1]) for (let i = 0; i < ribs; i++) {
      const xa = cx - cw / 2 + i * 0.28, xs = [xa, xa + 0.07, xa + 0.14, xa + 0.21, xa + 0.28], dz = [0, 0.04, 0.04, 0, 0];
      for (let k = 1; k < xs.length; k++) { const z0 = cz + sz * (cd / 2 + dz[k - 1]), z1 = cz + sz * (cd / 2 + dz[k]); g.quad([xs[k - 1], cy, z0], [xs[k], cy, z1], [xs[k], cy + ch, z1], [xs[k - 1], cy + ch, z0], S.container); }
    }
    for (const sx of [-1, 1]) { const x = cx + sx * cw / 2; g.quad([x, cy, cz - cd / 2], [x, cy, cz + cd / 2], [x, cy + ch, cz + cd / 2], [x, cy + ch, cz - cd / 2], S.container); }
    for (const dz of [-0.75, -0.35, 0.35, 0.75]) g.cyl([cx + cw / 2 + 0.04, cy + 0.15, cz + dz], 'y', 0.02, ch - 0.3, 6, S.galv);   // the door bars
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const yy of [0.09, ch - 0.09]) g.box(cx + sx * (cw / 2 - 0.09), cy + yy, cz + sz * (cd / 2 - 0.09), 0.18, 0.18, 0.18, S.container);
  } else g.box(cx, cy + ch / 2, cz, cw, ch, cd, S.container);
  g.box(Hx - 5.0, F + 1.05, -2.6, 2.4, 2.1, 2.0, S.grey); g.box(Hx - 5.0, F + 2.15, -2.6, 2.7, 0.08, 2.3, S.grey);
  if (hi) g.box(Hx - 3.78, F + 0.95, -2.6, 0.04, 1.9, 0.85, S.black);   // the shed's door
  g.box(Hx - 9.6, F + 0.45, -2.9, 1.6, 0.9, 1.2, S.grey);
  if (hi) g.cyl([Hx - 9.1, F + 0.9, -2.6], 'y', 0.06, 0.6, 8, S.black);
  g.box(Hx - 9.6, F + 0.6, 3.25, 0.8, 1.2, 0.5, S.black);
  if (hi) {
    // pipe rails on round stanchions round the deck (open at the pushboat's end), tyre fenders on chains, life rings
    for (const sz of [-1, 1]) {
      for (let x = -Hx + 0.8; x <= Hx - 0.7; x += 2.0) g.cyl([x, F + 0.18, sz * (Bz - 0.15)], 'y', 0.025, 0.95, 6, S.galv);
      for (const yy of [1.1, 0.62]) g.cyl([-Hx + 0.8, F + yy, sz * (Bz - 0.15)], 'x', 0.025, HULL.length - 1.5, 6, S.galv);
      for (let k = 0; k < 6; k++) { const x = -14 + k * 5.6; g.torus([x, F - 0.6, sz * (Bz + 0.15)], 'z', 0.36, 0.13, 14, 7, S.rubber); g.cyl([x, F - 0.25, sz * (Bz + 0.12)], 'y', 0.015, 0.45, 4, S.galv); }
      g.torus([-Hx + 6, F + 0.85, sz * (Bz - 0.12)], 'z', 0.3, 0.06, 16, 6, S.ring);
    }
    for (let z = -Bz + 0.8; z <= Bz - 0.7; z += 2.0) g.cyl([Hx - 0.15, F + 0.18, z], 'y', 0.025, 0.95, 6, S.galv);
    g.cyl([Hx - 0.15, F + 1.1, -Bz + 0.15], 'z', 0.025, HULL.beam - 0.3, 6, S.galv);
    // the light posts: the anchor lights at both ends, three work lights along the far side
    for (const [x, z, h] of [[Hx - 0.8, 0, 2.4], [-Hx + 0.8, 0, 2.0], [-12, Bz - 0.6, 2.5], [0, Bz - 0.6, 2.5], [12, Bz - 0.6, 2.5]]) { g.cyl([x, F, z], 'y', 0.04, h, 6, S.galv); g.box(x, F + h + 0.08, z, 0.18, 0.16, 0.18, S.black); }
  }
  buildTug(g, hi);
  return new Float32Array(g.v);
}

// the pushboat at the barge's stern: its bow (+x) square against the barge with the push knees, the stern raked
function buildTug(g, hi) {
  const S = SLOT, T = TUG.x, Hx = TUG.length / 2, Bz = TUG.beam / 2, F = 0.95, D = 1.25;
  hull(g, { x0: T, Hx, Bz, D, F, R0: 3.0, R1: 0, c: 0.45, endY: 0.35, s: S.tugHull });
  g.quad([T - Hx, F, -Bz], [T - Hx, F, Bz], [T + Hx, F, Bz], [T + Hx, F, -Bz], S.deck);
  // the bulwark round the deck and the bow's rubber
  for (const z of [-1, 1]) g.box(T, F + 0.3, z * (Bz - 0.06), TUG.length, 0.6, 0.12, S.tugHull);
  g.box(T + Hx + 0.12, 0.9, 0, 0.24, 1.0, TUG.beam, S.rubber);
  // the push knees: two tall plates at the bow, their faces rubber
  for (const z of [-1.55, 1.55]) { g.box(T + Hx - 0.3, 2.2, z, 0.5, 3.2, 0.3, S.tugHull); if (hi) g.box(T + Hx + 0.02, 2.2, z, 0.16, 3.0, 0.34, S.rubber); }
  // the deckhouse, the wheelhouse (its window band all round), the roof's overhang, the stacks, the mast and its lights
  g.box(T - 1.0, F + 0.9, 0, 5.6, 1.8, 3.6, S.white);
  g.box(T + 0.2, F + 2.85, 0, 2.6, 2.1, 3.2, S.white);
  if (hi) {
    g.box(T + 1.51, F + 3.25, 0, 0.02, 0.9, 2.9, S.glass); g.box(T - 1.11, F + 3.25, 0, 0.02, 0.9, 2.9, S.glass);
    for (const z of [-1, 1]) g.box(T + 0.2, F + 3.25, z * 1.61, 2.3, 0.9, 0.02, S.glass);
    for (const z of [-1, 1]) g.cyl([T - 2.6, F + 1.8, z * 0.8], 'y', 0.18, 1.6, 10, S.black);
    for (const z of [-1, 1]) for (let k = 0; k < 3; k++) g.torus([T - 3 + k * 2.6, F - 0.3, z * (Bz + 0.13)], 'z', 0.34, 0.12, 12, 6, S.rubber);
    for (const z of [-1, 1]) g.cyl([T - Hx + 0.4, F + 0.62, z * (Bz - 0.06)], 'x', 0.03, TUG.length - 0.8, 6, S.galv);
  } else g.box(T + 0.2, F + 3.25, 0, 2.64, 0.9, 3.24, S.glass);
  g.box(T + 0.2, F + 3.95, 0, 3.0, 0.1, 3.6, S.white);
  g.cyl([T - 0.4, F + 4.0, 0], 'y', 0.06, 2.4, 8, S.galv);
  g.box(T - 0.4, F + 5.35, 0, 0.2, 0.18, 0.2, S.black); g.box(T - 0.4, F + 4.65, 0, 0.2, 0.18, 0.2, S.black);
  for (const z of [-1, 1]) g.box(T + 1.0, F + 3.1, z * 1.75, 0.3, 0.22, 0.12, S.black);   // the sidelight boards
}

export function buildPatrol() {
  const g = builder(), S = SLOT;
  // an 8.5 × 2.7 m centre-console boat: a lofted hull with a pointed bow (+z in its own frame, as v1's patrol), the console, the light bar
  const L = 4.25, B = 1.35;
  const sec = (z) => { const t = Math.max(0, (z - (L - 2.6)) / 2.6), w = B * (1 - t * t * 0.95); return [[-0.45, 0], [-0.3, w * 0.75], [0.15, w], [0.75 + 0.15 * t, w]]; };
  const zs = [-L, -L + 0.4, 0, L - 2.6, L - 1.8, L - 1.0, L - 0.4, L];
  for (let i = 1; i < zs.length; i++) for (const sx of [-1, 1]) {
    const a = sec(zs[i - 1]), b = sec(zs[i]);
    for (let k = 1; k < a.length; k++) g.quad([a[k - 1][1] * sx, a[k - 1][0], zs[i - 1]], [b[k - 1][1] * sx, b[k - 1][0], zs[i]], [b[k][1] * sx, b[k][0], zs[i]], [a[k][1] * sx, a[k][0], zs[i - 1]], S.white);
  }
  const t = sec(-L); g.quad([-t[3][1], -0.45, -L], [t[3][1], -0.45, -L], [t[3][1], 0.75, -L], [-t[3][1], 0.75, -L], S.white);
  g.quad([-B + 0.08, 0.7, -L + 0.1], [B - 0.08, 0.7, -L + 0.1], [B * 0.3, 0.7, L - 0.6], [-B * 0.3, 0.7, L - 0.6], S.grey);
  g.box(0, 1.25, 0.5, 1.0, 1.1, 1.2, S.grey); g.box(0, 2.0, 0.5, 1.1, 0.06, 1.4, S.white); g.box(0, 2.55, 0.5, 1.1, 0.12, 0.2, S.black);
  return new Float32Array(g.v);
}

// the meshes' runs in one vertex buffer: { all, runs: { bargeHigh, bargeLow, patrol } (first vertex, count) }
export function buildPropMeshes() {
  const parts = { bargeHigh: buildBarge({ lod: 'high' }), bargeLow: buildBarge({ lod: 'low' }), patrol: buildPatrol() };
  let n = 0; const runs = {};
  for (const [k, a] of Object.entries(parts)) { runs[k] = { first: n, count: a.length / VF }; n += a.length / VF; }
  const all = new Float32Array(n * VF); for (const [k, a] of Object.entries(parts)) all.set(a, runs[k].first * VF);
  return { all, runs };
}
