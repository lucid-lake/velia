// The player's boat's life ring, drawn the way a real one is (owner, 2026-11-18: "make the life-saving ring on the boat
// orange, or the real colour, pattern and material a boat uses"). hardware.glb's ring is a faceted white torus with thin
// teak-coloured strips (blender/m8_hardware.py life_ring); v2 drops those triangles when it builds the boat (models.js) and
// draws this one in the same place instead, so v1's GLB, goldens and page are untouched.
// The real look (a 24 in ring buoy on a 28-30 ft cruiser's stern rail: SOLAS/USCG Type IV, 610 mm outside, ≈ 400 mm hole):
//   International orange closed-cell foam under a smooth PVC / vinyl cover (low sheen, a little sun-faded and scuffed),
//   four bands of silver-white retro-reflective tape at 45° between the quarters, and a grab line (white polypropylene,
//   a 13 mm rope) lashed round the outside in four bights, one between each pair of bands.
// Pure: returns plain primitives that models.js's addPrim takes. Frame: the HULL frame (x starboard, y up, z aft).
import { hexLinear } from './colour.js';

export const RING = Object.freeze({
  c: Object.freeze([1.34, 0.29, 3.983]),   // the old ring's centre: x, y above the freeboard (hardware frame), z aft (hardware.glb; the rail's outside face)
  R: 0.247, a: 0.058, b: 0.036,            // major radius; the section's radial and axial half-widths: OD 0.610 m, hole 0.378 m, 72 mm thick
  bandHalf: 0.040,                          // m along the rim: a 80 mm band
  lineR: 0.0065,                            // the grab line's radius (13 mm rope, a little heavy for the eye)
});
export const ALBEDO = [1.0, 0.42, 1];   // × orange: the albedo the tone curve needs to show it as #FF4F00 in full sun (white gelcoat's albedo is 0.7)
export const ORANGE = '#FF4F00';            // international orange (aerospace "Safety orange" ≈ #FF4F00 in sRGB), before the tone curve

// what the old ring's triangles were, so models.js can drop them (hull frame, `fb` = HULL.freeboard): the gelcoat torus fills
// a box; the teak-coloured strips are small tori on the rim, told from the perch's slats by being on the rim shell
export function oldRingDrop(node, fb) {
  const [cx, cy, cz] = RING.c, y0 = cy + fb;
  if (node === 'gelcoat_parts') return (p) => { const x = (p[0] + p[3] + p[6]) / 3, z = (p[2] + p[5] + p[8]) / 3, y = (p[1] + p[4] + p[7]) / 3; return Math.abs(x - cx) < 0.06 && Math.abs(z - cz) < 0.32 && Math.abs(y - y0) < 0.32; };
  if (node === 'perch_pads') {   // the old strips: four small tori (0.048 m round, on the rim at 45° + k 90°); the seat slats are elsewhere
    const bands = [0, 1, 2, 3].map((k) => { const th = Math.PI / 4 + k * Math.PI / 2; return [cx, y0 + 0.26 * Math.cos(th), cz + 0.26 * Math.sin(th)]; });
    const near = (x, y, z) => bands.some((b) => Math.hypot(x - b[0], y - b[1], z - b[2]) < 0.058);
    return (p) => near(p[0], p[1], p[2]) && near(p[3], p[4], p[5]) && near(p[6], p[7], p[8]);
  }
  return null;
}

const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

function grid(nu, nv, at) {   // a (nu+1) × (nv+1) lattice of { p, n } → positions, normals, indices (winding as the GLB's: the shader takes the normal on the camera's side by front_facing)
  const P = [], N = [], I = [];
  for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) { const { p, n } = at(i / nu, j / nv); P.push(...p); N.push(...n); }
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const q = i * (nv + 1) + j, r = q + nv + 1; I.push(q, r, q + 1, q + 1, r, r + 1); }
  return { P, N, I };
}

// an elliptical-section torus (or a part of it, θ0..θ1) about the axis x; `grow` thickens the section (a band over the body)
function torusSeg(c, th0, th1, nu, nv, grow = 0) {
  const { R, a, b } = RING;
  return grid(nu, nv, (u, v) => {
    const th = th0 + (th1 - th0) * u, ph = 2 * Math.PI * v, d = [0, Math.cos(th), Math.sin(th)];
    const cp = Math.cos(ph), sp = Math.sin(ph), A = a + grow, B = b + grow;
    const p = [c[0] + B * sp, c[1] + (R + A * cp) * d[1], c[2] + (R + A * cp) * d[2]];
    const n = [sp / B, cp / A * d[1], cp / A * d[2]], l = Math.hypot(...n);
    return { p, n: n.map((x) => x / l) };
  });
}

// the grab line: a tube along a path, a parallel-transported frame (no twist), `seg` sides
function tube(path, r, seg = 6) {
  const P = [], N = [], I = [];
  let nrm = [1, 0, 0];
  for (let k = 0; k < path.length; k++) {
    const a = path[Math.max(0, k - 1)], b = path[Math.min(path.length - 1, k + 1)];
    let t = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const tl = Math.hypot(...t); t = t.map((x) => x / tl);
    const dp = nrm[0] * t[0] + nrm[1] * t[1] + nrm[2] * t[2];
    nrm = nrm.map((x, i) => x - dp * t[i]); const nl = Math.hypot(...nrm); nrm = nrm.map((x) => x / nl);
    const bn = [t[1] * nrm[2] - t[2] * nrm[1], t[2] * nrm[0] - t[0] * nrm[2], t[0] * nrm[1] - t[1] * nrm[0]];
    for (let s = 0; s <= seg; s++) {
      const q = 2 * Math.PI * s / seg, cq = Math.cos(q), sq = Math.sin(q);
      const n = [nrm[0] * cq + bn[0] * sq, nrm[1] * cq + bn[1] * sq, nrm[2] * cq + bn[2] * sq];
      P.push(path[k][0] + n[0] * r, path[k][1] + n[1] * r, path[k][2] + n[2] * r); N.push(...n);
    }
  }
  for (let k = 0; k < path.length - 1; k++) for (let s = 0; s < seg; s++) { const q = k * (seg + 1) + s, r2 = q + seg + 1; I.push(q, r2, q + 1, q + 1, r2, r2 + 1); }
  return { P, N, I };
}

const toPrim = (g, colour = null) => ({
  attributes: {
    POSITION: { array: Float32Array.from(g.P), size: 3, count: g.P.length / 3 },
    NORMAL: { array: Float32Array.from(g.N), size: 3, count: g.N.length / 3 },
    ...(colour ? { COLOR_0: { array: Float32Array.from(colour), size: 3, count: colour.length / 3 } } : {}),
  },
  indices: { array: Uint32Array.from(g.I) }, mode: 4,
});

// → [{ prim, rec }]: the body (orange vinyl, sun-faded on top, scuffed low), four tape bands, four grab-line bights.
// `fb` is HULL.freeboard (the hardware sits that far up in the hull frame)
export function buildLifeRing(fb) {
  const c = [RING.c[0], RING.c[1] + fb, RING.c[2]];
  const plain = { kind: 0, coat: 0, coatRough: 0, scale: 1, opacity: 1, tex: { base: -1, normal: -1, mr: -1 } };
  const out = [];
  // the body: a 64 × 20 torus; the vertex colour is the wear (× the orange): the top faded ≈ 12 % toward warm grey, a slow
  // blotchy scuff, the lower rim (where it rests in the holder) a little darker, the hole's inside shaded
  const body = torusSeg(c, 0, 2 * Math.PI, 64, 20);
  const col = [];
  for (let i = 0; i < body.P.length / 3; i++) {
    const y = body.P[i * 3 + 1] - c[1], z = body.P[i * 3 + 2] - c[2], th = Math.atan2(z, y);
    const top = Math.max(0, Math.cos(th)), low = Math.max(0, -Math.cos(th));
    const w = 0.93 + 0.07 * hash(Math.floor((th + Math.PI) * 5) + 7 * Math.floor((body.P[i * 3] - c[0]) * 30)) - 0.07 * low;
    col.push(w * (1 - 0.0 * top), w * (1 + 0.35 * top), w);   // the fade lifts green and blue a little (washes the orange toward cream)
  }
  out.push({ prim: toPrim(body, col.map((v) => Math.min(1, v))), rec: { ...plain, name: 'lifering_vinyl', base: [...hexLinear(ORANGE).map((v, i) => v * ALBEDO[i]), 1], metal: 0, rough: 0.6, vcol: true } });
  // the bands: a 80 mm wrap of tape on each diagonal, a hair proud of the vinyl
  for (let k = 0; k < 4; k++) {
    const th = Math.PI / 4 + k * Math.PI / 2, h = RING.bandHalf / RING.R;
    out.push({ prim: toPrim(torusSeg(c, th - h, th + h, 6, 20, 0.0016)), rec: { ...plain, name: 'lifering_tape', base: [0.74, 0.75, 0.76, 1], metal: 0, rough: 0.28, coat: 0.45, coatRough: 0.2, vcol: false } });
  }
  // the grab line: from each band's edge, out over the outer rim in a bight that sags 2 cm clear of the ring and back
  const Ro = RING.R + RING.a + RING.lineR + 0.002;
  for (let k = 0; k < 4; k++) {
    const t0 = Math.PI / 4 + k * Math.PI / 2, path = [];
    for (let s = 0; s <= 28; s++) {
      const u = s / 28, th = t0 + u * Math.PI / 2, sag = 0.020 * Math.pow(Math.sin(Math.PI * u), 0.9), wob = 0.012 * Math.sin(2 * Math.PI * u + k) * Math.sin(Math.PI * u);
      const r = Ro + sag;
      path.push([c[0] + wob, c[1] + r * Math.cos(th), c[2] + r * Math.sin(th)]);
    }
    out.push({ prim: toPrim(tube(path, RING.lineR, 6)), rec: { ...plain, name: 'lifering_line', base: [...hexLinear('#D8D2BE'), 1], metal: 0, rough: 0.85, vcol: false } });
  }
  return out;
}
