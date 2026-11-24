// The ground tackle's meshes (pure: arrays only, built once on a desktop; v2/render/anchorGear.js uploads them). All three in
// the frames v2/sim/anchorGear.js places them in:
//   linkMesh()      one 10 mm short link: a stadium torus, x along the chain, y across in the link's plane, z through it
//   anchorMesh()    a 10 kg Delta-style plough, galvanised: the hull frame's axes with its origin at the shackle (as hardware.glb's
//                   anchor, so it sits on the roller where that one did): the shank runs forward (−z) over the roller, the fluke
//                   hangs below the crown, its weighted toe tucked back toward the stem; a bow shackle at the origin
//   windlassMesh()  a manual vertical windlass on the foredeck (base, body, gypsy with its whelps, the drum and the handle's
//                   socket, the chain stripper), its origin at the deck under its axis
// Each vertex carries a tag: 0 galvanised steel, 1 black (nylon, rubber, the socket), 2 the windlass's grey alloy.
import { GEAR } from '../sim/anchorGear.js';

function builder() {
  const P = [], N = [], T = [], I = [];
  const v = (p, n, t) => { P.push(p[0], p[1], p[2]); const l = Math.hypot(n[0], n[1], n[2]) || 1; N.push(n[0] / l, n[1] / l, n[2] / l); T.push(t); return P.length / 3 - 1; };
  const tri = (a, b, c) => I.push(a, b, c);
  const quad = (a, b, c, d) => { I.push(a, b, c, a, c, d); };
  const done = () => ({ position: new Float32Array(P), normal: new Float32Array(N), tag: new Float32Array(T), index: P.length / 3 > 65535 ? new Uint32Array(I) : new Uint16Array(I), triangles: I.length / 3 });
  return { v, tri, quad, done, get n() { return P.length / 3; } };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

// one short link: the centreline a stadium (two half circles joined by straights) in the x-y plane, a round tube of the wire
export function linkMesh({ ring = 6, arc = 7 } = {}) {
  const B = builder(), wr = GEAR.wire / 2;
  const R = (GEAR.linkW - GEAR.wire) / 2, half = (GEAR.linkL - GEAR.wire) / 2 - R;   // the bend's radius, the straight's half length
  const C = [];   // the centreline: points and their in-plane outward normals
  for (let e = 0; e < 2; e++) {
    const sx = e ? -1 : 1;
    for (let i = 0; i <= arc; i++) { const a = -Math.PI / 2 + Math.PI * i / arc, cx = Math.cos(a) * sx, cy = Math.sin(a) * sx; C.push([[sx * half + R * cx, R * cy, 0], [cx, cy, 0]]); }
  }
  const M = C.length;
  for (let i = 0; i < M; i++) {
    const [c, o] = C[i];
    for (let j = 0; j < ring; j++) { const a = 2 * Math.PI * j / ring, ca = Math.cos(a), sa = Math.sin(a); const n = [o[0] * ca, o[1] * ca, sa]; B.v(add(c, n, wr), n, 0); }
  }
  for (let i = 0; i < M; i++) { const i2 = (i + 1) % M; for (let j = 0; j < ring; j++) { const j2 = (j + 1) % ring; B.quad(i * ring + j, i2 * ring + j, i2 * ring + j2, i * ring + j2); } }
  return B.done();
}

// a flat plate of thickness t about the plane through p0 with normal nrm; outline: points in that plane (star-shaped about
// their centroid); both faces and the rim
function plate(B, outline, t, tag, bevel = 0.35) {
  const n = outline.length, c = outline.reduce((s, p) => add(s, p, 1 / n), [0, 0, 0]);
  let nrm = [0, 0, 0];
  for (let i = 0; i < n; i++) nrm = add(nrm, cross(sub(outline[i], c), sub(outline[(i + 1) % n], c)));
  const l = Math.hypot(...nrm) || 1; nrm = nrm.map((x) => x / l);
  const top = outline.map((p) => add(p, nrm, t / 2)), bot = outline.map((p) => add(p, nrm, -t / 2));
  const ct = B.v(add(c, nrm, t / 2), nrm, tag), cb = B.v(add(c, nrm, -t / 2), nrm.map((x) => -x), tag);
  const it = top.map((p) => B.v(p, nrm, tag)), ib = bot.map((p) => B.v(p, nrm.map((x) => -x), tag));
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; B.tri(ct, it[i], it[j]); B.tri(cb, ib[j], ib[i]); }
  for (let i = 0; i < n; i++) {   // the rim: its normal outward, leaning toward each face a little (a soft edge in the light)
    const j = (i + 1) % n, e = sub(outline[j], outline[i]), out = cross(e, nrm), ol = Math.hypot(...out) || 1, o = out.map((x) => x / ol);
    const nt = add(o, nrm, bevel), nb = add(o, nrm, -bevel);
    const a = B.v(top[i], nt, tag), b = B.v(top[j], nt, tag), c2 = B.v(bot[j], nb, tag), d = B.v(bot[i], nb, tag);
    B.quad(a, d, c2, b);
  }
}
// a plate between two edge curves (top and bottom, matching points) of thickness t across their plane
function strip(B, tops, bots, t, tag) {
  const n = tops.length;
  let nrm = cross(sub(tops[1], tops[0]), sub(bots[0], tops[0])); const l = Math.hypot(...nrm) || 1; nrm = nrm.map((x) => x / l);
  for (const sd of [1, -1]) {
    const nn = nrm.map((x) => x * sd), T = tops.map((p) => B.v(add(p, nrm, sd * t / 2), nn, tag)), D = bots.map((p) => B.v(add(p, nrm, sd * t / 2), nn, tag));
    for (let i = 0; i + 1 < n; i++) { if (sd > 0) B.quad(T[i], D[i], D[i + 1], T[i + 1]); else B.quad(T[i], T[i + 1], D[i + 1], D[i]); }
  }
  const edge = (P, up) => { for (let i = 0; i + 1 < n; i++) { const e = sub(P[i + 1], P[i]); let o = cross(e, nrm); if ((o[1] > 0) !== up) o = o.map((x) => -x);
    const a = B.v(add(P[i], nrm, t / 2), add(o, nrm, 0.3), tag), b = B.v(add(P[i + 1], nrm, t / 2), add(o, nrm, 0.3), tag), c = B.v(add(P[i + 1], nrm, -t / 2), add(o, nrm, -0.3), tag), d = B.v(add(P[i], nrm, -t / 2), add(o, nrm, -0.3), tag);
    B.quad(a, b, c, d); B.quad(a, d, c, b); } };
  edge(tops, true); edge(bots, false);
  for (const i of [0, n - 1]) { const o = sub(tops[i], tops[i === 0 ? 1 : n - 2]);
    const a = B.v(add(tops[i], nrm, t / 2), o, tag), b = B.v(add(bots[i], nrm, t / 2), o, tag), c = B.v(add(bots[i], nrm, -t / 2), o, tag), d = B.v(add(tops[i], nrm, -t / 2), o, tag);
    B.quad(a, b, c, d); B.quad(a, d, c, b); }
}
function cylinder(B, c, axis, r, h, tag, { seg = 18, r2 = r, caps = true, teeth = 0, tooth = 0 } = {}) {
  // axis: 'y' or 'x' or 'z'; c the base centre
  const ax = axis === 'y' ? [0, 1, 0] : axis === 'x' ? [1, 0, 0] : [0, 0, 1];
  const u = axis === 'y' ? [1, 0, 0] : [0, 1, 0], w = cross(ax, u);
  const rad = (k, rr) => rr + (teeth && (k % 2) ? tooth : 0);
  const n0 = B.n, ring = [];
  for (let k = 0; k < seg; k++) {
    const a = 2 * Math.PI * k / seg, d = add(u.map((x) => x * Math.cos(a)), w, Math.sin(a));
    const slope = (r - r2) / h, nrm = add(d, ax, slope);
    ring.push([B.v(add(c, d, rad(k, r)), nrm, tag), B.v(add(add(c, ax, h), d, rad(k, r2)), nrm, tag), d]);
  }
  for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; B.quad(ring[k][0], ring[k2][0], ring[k2][1], ring[k][1]); }
  if (caps) {
    const top = B.v(add(c, ax, h), ax, tag), bot = B.v(c, ax.map((x) => -x), tag);
    const tops = ring.map(([, , d], k) => B.v(add(add(c, ax, h), d, rad(k, r2)), ax, tag)), bots = ring.map(([, , d], k) => B.v(add(c, d, rad(k, r)), ax.map((x) => -x), tag));
    for (let k = 0; k < seg; k++) { const k2 = (k + 1) % seg; B.tri(top, tops[k], tops[k2]); B.tri(bot, bots[k2], bots[k]); }
  }
  return n0;
}
function torus(B, c, R, r, tag, { seg = 14, ring = 6, plane = 'xy' } = {}) {
  const A = plane === 'xy' ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : plane === 'yz' ? [[0, 1, 0], [0, 0, 1], [1, 0, 0]] : [[1, 0, 0], [0, 0, 1], [0, 1, 0]];
  const n0 = B.n;
  for (let i = 0; i < seg; i++) {
    const a = 2 * Math.PI * i / seg, o = add(A[0].map((x) => x * Math.cos(a)), A[1], Math.sin(a));
    for (let j = 0; j < ring; j++) { const b = 2 * Math.PI * j / ring, n = add(o.map((x) => x * Math.cos(b)), A[2], Math.sin(b)); B.v(add(add(c, o, R), n, r), n, tag); }
  }
  for (let i = 0; i < seg; i++) { const i2 = (i + 1) % seg; for (let j = 0; j < ring; j++) { const j2 = (j + 1) % ring; B.quad(n0 + i * ring + j, n0 + i2 * ring + j, n0 + i2 * ring + j2, n0 + i * ring + j2); } }
}

// the Delta-style plough (≈ 10 kg): a 16 mm shank plate curving down into the crown, a keel web down to the toe, two fluke plates
// meeting on the ridge, a lead-weighted toe, the bow shackle
export function anchorMesh() {
  const B = builder();
  // the shank: a 16 mm plate from the shackle's eye forward over the roller, curving down into the crown (top and bottom edges)
  const S = [[0.03, 0.025, -0.025], [-0.10, 0.03, -0.02], [-0.25, 0.03, -0.022], [-0.38, 0.018, -0.04], [-0.47, -0.01, -0.075], [-0.54, -0.045, -0.11], [-0.60, -0.085, -0.14]];
  strip(B, S.map(([z, y]) => [0, y, z]), S.map(([z, , y]) => [0, y, z]), 0.016, 0);
  // the keel web under the ridge, from the crown down to the toe (one casting with the shank)
  plate(B, [[0, -0.085, -0.6], [0, -0.12, -0.635], [0, -0.2, -0.605], [0, -0.3, -0.535], [0, -0.37, -0.47], [0, -0.3, -0.45], [0, -0.16, -0.46], [0, -0.1, -0.5]], 0.014, 0);
  // the fluke: two plates from the crown's back edge to the toe, the ridge on the centre, the wings swept back and up
  const crown = [0, -0.1, -0.645], toe = [0, -0.39, -0.455];
  for (const s of [1, -1]) {
    const wingBack = [s * 0.16, -0.135, -0.665], wingFront = [s * 0.1, -0.29, -0.53];
    const ridgeOff = [s * 0.006, 0, 0];
    plate(B, [add(crown, ridgeOff), wingBack, wingFront, add(toe, ridgeOff)].map((p) => p), 0.008, 0, 0.5);
  }
  // the weighted toe: a short four-sided point at the ridge's foot
  const t0 = add(toe, [0, 0.05, -0.03]);
  const tp = [[0.03, 0, 0], [0, 0, 0.03], [-0.03, 0, 0], [0, 0, -0.03]].map((d) => add(t0, d));
  const tip = add(toe, [0, -0.025, 0.012]);
  for (let i = 0; i < 4; i++) { const a = tp[i], b = tp[(i + 1) % 4], n = cross(sub(b, a), sub(tip, a)); B.tri(B.v(a, n, 0), B.v(b, n, 0), B.v(tip, n, 0)); const m = cross(sub(a, b), sub(t0, b)); B.tri(B.v(b, m.map((x) => -x), 0), B.v(a, m.map((x) => -x), 0), B.v(add(t0, [0, 0.03, 0]), m.map((x) => -x), 0)); }
  // the bow shackle through the shank's eye, its pin across
  torus(B, [0, 0, 0.035], 0.024, 0.0055, 0, { seg: 14, ring: 6, plane: 'yz' });
  cylinder(B, [-0.022, 0.0, 0.035], 'x', 0.006, 0.044, 0, { seg: 8 });
  return B.done();
}

// a manual vertical windlass (the class a 28–30 ft sloop carries): base plate, body, gypsy with whelps, drum, handle socket
export function windlassMesh() {
  const B = builder();
  cylinder(B, [0, 0, 0], 'y', 0.09, 0.012, 2, { seg: 24 });                        // the deck plate
  cylinder(B, [0, 0.012, 0], 'y', 0.068, 0.06, 2, { seg: 24, r2: 0.06 });           // the body
  cylinder(B, [0, 0.072, 0], 'y', 0.058, 0.032, 0, { seg: 14, teeth: 1, tooth: 0.008 });   // the gypsy, its whelps (galvanised by the chain's wear)
  cylinder(B, [0, 0.104, 0], 'y', 0.05, 0.006, 2, { seg: 24 });                     // the gypsy's top flange
  cylinder(B, [0, 0.11, 0], 'y', 0.042, 0.045, 2, { seg: 24, r2: 0.036 });          // the warping drum
  cylinder(B, [0, 0.155, 0], 'y', 0.02, 0.006, 1, { seg: 12 });                     // the handle's socket
  // the chain stripper and the navel pipe's lip aft of the gypsy (the chain goes down here)
  plate(B, [[0.05, 0.02, 0.05], [0.05, 0.02, 0.09], [0.05, 0.085, 0.09], [0.05, 0.085, 0.05]], 0.012, 2);
  cylinder(B, [0, 0, 0.11], 'y', 0.03, 0.02, 1, { seg: 14, caps: true });
  return B.done();
}
