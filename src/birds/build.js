// A bird's body, built from its species numbers (src/birds/species.js): a lofted body and head, a hooked or flat bill,
// eyes, wings of real feathers (coverts as a thin aerofoil, each secondary and primary its own tapered vane, the outer
// primaries' "fingers" emarginated), a fan of tail feathers, legs with talons and (the osprey) a trout in its feet.
// Plain JS, no three.js: it returns one interleaved Float32Array and an index, and tests/birds.test.mjs reads it.
//
// Every vertex carries what the shader (src/birds/mesh.js) needs to pose it: its weights on the three bones (body,
// arm, hand), the feather's base point and fan factor (the primaries splay, the tail spreads about them), the curl
// lever (outer primaries bend up under load), the leg / fish / head weights, and the feather's (u, v) for its outline
// and plumage. The left half is the right half mirrored (x → −x, the winding flipped); the shader poses the right
// half and mirrors back.
import { SPECIES } from './species.js';
import { clamp01 } from '../sim/core/math.js';

// the interleaved vertex layout (floats): see mesh.js for the attribute names
export const STRIDE = 32;
export const OFF = { position: 0, normal: 3, colTop: 6, colBot: 9, bw: 12, fx: 15, fb: 19, fc: 23, shp: 27, ao: 31 };
export const KIND = { body: 0, secondary: 1, primary: 2, tail: 3, bill: 4, eye: 5, foot: 6, fish: 7, covert: 8 };

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const mix = (a, b, t) => a + (b - a) * t;
const mixc = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
import { smooth } from '../sim/core/math.js';
// a small deterministic hash (plumage mottling): no Math.random() anywhere in the scene
const h01 = (i) => { let x = (i * 0x9E3779B1) >>> 0; x ^= x >>> 15; x = Math.imul(x, 0x85EBCA77) >>> 0; x ^= x >>> 13; return (x >>> 0) / 4294967296; };

class Builder {
  constructor() { this.v = []; this.i = []; }
  get count() { return this.v.length / STRIDE; }
  // one vertex: p, n, top and under colours, bone weights [body, arm, hand], fx [u, v, kind, side], fb [base xyz, fan],
  // fc [curl, leg, fish, head], shp [emarg, barFreq, barStrength, detail], ao
  vert(p, n, ct, cb, bw, fx, fb = [0, 0, 0, 0], fc = [0, 0, 0, 0], shp = [0, 0, 0, 1], ao = 1) {
    this.v.push(...p, ...n, ...ct, ...cb, ...bw, ...fx, ...fb, ...fc, ...shp, ao);
    return this.count - 1;
  }
  tri(a, b, c) { this.i.push(a, b, c); }
  quad(a, b, c, d) { this.i.push(a, b, c, a, c, d); }
  // the vertices [k0, k1) mirrored to the left: x, the normal's x, the base's x negated, side −1, the winding flipped
  mirror(k0, k1, i0, i1) {
    const map = new Map();
    for (let k = k0; k < k1; k++) {
      const s = this.v.slice(k * STRIDE, (k + 1) * STRIDE);
      s[OFF.position] = -s[OFF.position]; s[OFF.normal] = -s[OFF.normal]; s[OFF.fb] = -s[OFF.fb]; s[OFF.fx + 3] = -s[OFF.fx + 3];
      this.v.push(...s); map.set(k, this.count - 1);
    }
    for (let j = i0; j < i1; j += 3) this.i.push(map.get(this.i[j]), map.get(this.i[j + 2]), map.get(this.i[j + 1]));
  }
  // a closed part: its normals point away from its centroid (flip the winding if they did not), then smooth
  closed(k0, k1, i0, i1) {
    this.smoothNormals(k0, k1, i0, i1);
    const c = [0, 0, 0];
    for (let k = k0; k < k1; k++) for (let q = 0; q < 3; q++) c[q] += this.v[k * STRIDE + q] / (k1 - k0);
    let s = 0;
    for (let k = k0; k < k1; k++) { const o = k * STRIDE; s += (this.v[o] - c[0]) * this.v[o + 3] + (this.v[o + 1] - c[1]) * this.v[o + 4] + (this.v[o + 2] - c[2]) * this.v[o + 5]; }
    if (s < 0) { for (let j = i0; j < i1; j += 3) { const t = this.i[j + 1]; this.i[j + 1] = this.i[j + 2]; this.i[j + 2] = t; } this.smoothNormals(k0, k1, i0, i1); }
  }
  // a thin part (a vane, a disc): each triangle wound so its face normal agrees with its vertices' normals, so the
  // front face is the side the normal names (feathers: the top), and a two-sided material lights both sides right
  align(i0, i1) {
    for (let j = i0; j < i1; j += 3) {
      const [a, b, c] = [this.i[j], this.i[j + 1], this.i[j + 2]];
      const P = (k) => this.v.slice(k * STRIDE, k * STRIDE + 3), N = (k) => this.v.slice(k * STRIDE + 3, k * STRIDE + 6);
      const g = cross(sub(P(b), P(a)), sub(P(c), P(a))), n = add(add(N(a), N(b)), N(c));
      if (g[0] * n[0] + g[1] * n[1] + g[2] * n[2] < 0) { this.i[j + 1] = c; this.i[j + 2] = b; }
    }
  }
  // fix the normals of a range by the triangles' area-weighted average (smooth parts only)
  smoothNormals(k0, k1, i0, i1) {
    const acc = new Float64Array((k1 - k0) * 3);
    for (let j = i0; j < i1; j += 3) {
      const [a, b, c] = [this.i[j], this.i[j + 1], this.i[j + 2]];
      const P = (k) => this.v.slice(k * STRIDE, k * STRIDE + 3);
      const n = cross(sub(P(b), P(a)), sub(P(c), P(a)));
      for (const k of [a, b, c]) if (k >= k0 && k < k1) for (let q = 0; q < 3; q++) acc[(k - k0) * 3 + q] += n[q];
    }
    for (let k = k0; k < k1; k++) {
      const n = norm([acc[(k - k0) * 3], acc[(k - k0) * 3 + 1], acc[(k - k0) * 3 + 2]]);
      for (let q = 0; q < 3; q++) this.v[k * STRIDE + OFF.normal + q] = n[q];
    }
  }
}

// Catmull-Rom through the body stations, sub steps per span
function stations(body, sub) {
  const out = [];
  const P = (k) => body[Math.min(body.length - 1, Math.max(0, k))];
  for (let k = 0; k < body.length - 1; k++) {
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push(P(k).map((_, q) => 0.5 * ((2 * P(k)[q]) + (-P(k - 1)[q] + P(k + 1)[q]) * t + (2 * P(k - 1)[q] - 5 * P(k)[q] + 4 * P(k + 1)[q] - P(k + 2)[q]) * t2 + (-P(k - 1)[q] + 3 * P(k)[q] - 3 * P(k + 1)[q] + P(k + 2)[q]) * t3)));
    }
  }
  out.push(body.at(-1));
  return out;
}

// the body's plumage at a point: z along, a = angle round the body (0 = right side, π/2 = top), y relative to the axis
function bodyColour(sp, z, a, yRel, x) {
  const C = sp.colours, top = Math.sin(a);
  const zs = sp.body.map((s) => s[0]), z0 = zs[0], z1 = zs.at(-1), t = (z - z0) / (z1 - z0);
  const side = Math.abs(Math.cos(a));
  const mott = (h01(Math.round(z * 400) * 131 + Math.round(a * 30)) - 0.5) * 0.12;
  const tint = (c, k = mott) => c.map((v) => v * (1 + k));
  switch (sp.name) {
    case 'osprey': {
      const head = smooth(0.66, 0.74, t);
      let c = mixc(C.belly, C.back, smooth(-0.15, 0.25, top));
      if (t > 0.42 && t < 0.62 && top < -0.1) c = mixc(c, C.breastBand, 0.55 * smooth(-0.1, -0.5, top) * (h01(Math.round(z * 900) + Math.round(a * 50)) > 0.4 ? 1 : 0.4));
      let hc = mixc(C.head, C.crown, smooth(0.55, 0.9, top) * 0.85);
      // the dark mask: from the bill through the eye to the nape, on each side
      const eyeBand = smooth(0.24, 0.08, Math.abs(top - Math.sin(sp.eye.a) * 0.9));
      hc = mixc(hc, C.stripe, Math.min(1, eyeBand * 1.4) * side);
      c = mixc(c, hc, head);
      return tint(c);
    }
    case 'bald eagle': {
      const head = smooth(0.6, 0.66, t);
      return tint(mixc(mixc(C.belly, C.back, smooth(-0.3, 0.3, top)), C.head, head), head > 0.5 ? mott * 0.3 : mott);
    }
    case 'California gull': {
      const mantle = smooth(0.35, 0.7, top) * smooth(0.82, 0.6, t);
      return tint(mixc(C.belly, C.back, mantle), mott * 0.3);
    }
    case 'Canada goose': {
      const neck = smooth(0.38, 0.44, t);
      let c = mixc(C.breastBand, C.back, smooth(-0.2, 0.4, top));
      if (t < 0.12 && top < 0.2) c = mixc(c, C.vent, smooth(0.12, 0.04, t));
      // the pale fringes on the back's feathers (the goose's barred look)
      const bar = 0.5 + 0.5 * Math.sin(z * 260);
      if (top > -0.2) c = mixc(c, mixc(c, C.belly, 0.45), smooth(0.7, 0.95, bar) * smooth(-0.2, 0.3, top));
      c = mixc(c, C.neck, neck);
      // the white chinstrap: the cheeks and the throat behind the bill
      const chin = smooth(0.84, 0.86, t) * smooth(0.97, 0.94, t) * smooth(0.2, -0.3, top);
      c = mixc(c, C.chin, chin);
      return tint(c, mott * 0.5);
    }
  }
  return C.back;
}

// build(name, { lod: 0 near | 1 far }) → { data: Float32Array (STRIDE per vertex), index: Uint32Array, info }
export function build(name, { lod = 0 } = {}) {
  const sp = SPECIES[name];
  if (!sp) throw new Error(`no species ${name}`);
  const B = new Builder();
  const near = lod === 0;
  const C = sp.colours;
  const zs = sp.body.map((s) => s[0]), zTail = zs[0], zFace = zs.at(-1);
  const neckZ = mix(zTail, zFace, sp.name === 'Canada goose' ? 0.42 : 0.68);
  const headW = (z) => smooth(neckZ - 0.03, neckZ + 0.03, z);

  // --- the body: a loft of rings round the stations ---------------------------------------------------------------
  {
    const st = stations(sp.body, near ? 3 : 1), R = near ? 18 : 8;
    const k0 = B.count, i0 = B.i.length;
    for (let s = 0; s < st.length; s++) {
      const [z, hw, hh, yc] = st[s];
      for (let r = 0; r <= R; r++) {
        const a = -Math.PI / 2 + r / R * 2 * Math.PI;   // r = 0 at the belly's centre line, round by the right side
        // a soft superellipse: rounder at the back, flatter under the belly
        const ca = Math.cos(a), sa = Math.sin(a), e = 0.85;
        const x = hw * Math.sign(ca) * Math.abs(ca) ** e, y = yc + hh * Math.sign(sa) * Math.abs(sa) ** e * (sa < 0 ? 0.95 : 1);
        const col = bodyColour(sp, z, a, y - yc, x);
        const tt = (z - zTail) / (zFace - zTail);
        const ao = mix(0.78, 1, smooth(-0.9, 0.2, sa)) * mix(0.85, 1, smooth(0.0, 0.12, tt));
        B.vert([x, y, z], [ca, sa, 0], col, col, [1, 0, 0], [r / R, tt, KIND.body, x >= 0 ? 1 : -1], [0, 0, 0, 0], [0, 0, 0, headW(z)], [0, 0, 0, 1], ao);
      }
    }
    for (let s = 0; s + 1 < st.length; s++) for (let r = 0; r < R; r++) {
      const a = k0 + s * (R + 1) + r, b = a + R + 1;
      B.quad(a, a + 1, b + 1, b);
    }
    // the vent's cap (under the tail)
    const tail = B.vert([0, st[0][3], st[0][0] - 0.01], [0, 0, -1], C.belly, C.belly, [1, 0, 0], [0, 0, KIND.body, 1]);
    for (let r = 0; r < R; r++) B.tri(tail, k0 + r + 1, k0 + r);
    B.closed(k0, B.count, i0, B.i.length);
  }

  // --- the bill: a loft along a curved centre line, hooked for the raptors, flat and broad for the goose ----------
  {
    const [zF, hwF, hhF, yF] = sp.body.at(-1), bl = sp.bill, n = near ? 7 : 3, R = near ? 8 : 4;
    const k0 = B.count, i0 = B.i.length;
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      const z = zF - 0.004 + bl.len * t;
      const drop = bl.hook * bl.depth * 0.9 * t ** 3;   // the hook curls down at the tip
      const yc = yF - hhF * 0.15 - drop - (bl.flat ? 0.004 * t : 0);
      const w = mix(hwF * 0.75, bl.flat ? hwF * 0.45 : 0.0015, bl.flat ? t * 0.5 : t ** 1.2);
      const h = mix(bl.depth * 0.5, 0.0012, t ** (bl.hook ? 0.8 : 1.3)) * (bl.flat ? 0.55 : 1);
      for (let r = 0; r <= R; r++) {
        const a = r / R * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
        let col = t < 0.25 ? bl.cere : bl.colour;
        if (bl.spot && t > 0.7 && t < 0.9 && sa < -0.2) col = [0.55, 0.05, 0.03];   // the gull's red gonys spot
        if (bl.spot && t > 0.6 && t < 0.72 && sa < -0.1) col = [0.03, 0.03, 0.03];   // and the black ring by it
        B.vert([w * ca, yc + h * sa, z], [ca, sa, 0], col, col, [1, 0, 0], [r / R, t, KIND.bill, ca >= 0 ? 1 : -1], [0, 0, 0, 0], [0, 0, 0, 1]);
      }
    }
    for (let s = 0; s < n; s++) for (let r = 0; r < R; r++) { const a = k0 + s * (R + 1) + r, b = a + R + 1; B.quad(a, b, b + 1, a + 1); }
    B.closed(k0, B.count, i0, B.i.length);
  }

  // --- the eyes: a slightly domed disc each side (pupil, iris, a dark rim; the shader reads the radius) -----------
  if (near) {
    const e = sp.eye, st = stations(sp.body, 6);
    const at = st.reduce((b, s) => (Math.abs(s[0] - e.z) < Math.abs(b[0] - e.z) ? s : b));
    const [, hw, hh, yc] = at;
    // on the head's surface, a little above its side, facing out and (the raptors) forward
    const a0 = e.a ?? 0.35, ca = Math.cos(a0), sa = Math.sin(a0);
    const ex = hw * ca ** 0.85, ey = yc + hh * sa ** 0.85;
    const nrm = norm([ca, sa * 0.6, e.fwd ?? 0.3]);
    const u = norm(cross(nrm, [0, 1, 0])), v = cross(u, nrm);
    const k0 = B.count, i0 = B.i.length, R = 12;
    const ctr = add([ex, ey, e.z], mul(nrm, 0.0012 + e.r * 0.3));
    const c = B.vert(ctr, nrm, e.iris, e.iris, [1, 0, 0], [0, 0, KIND.eye, 1], [0, 0, 0, 0], [0, 0, 0, 1]);
    for (let r = 0; r <= R; r++) {
      const t = r / R * 2 * Math.PI, o = add(mul(u, Math.cos(t) * e.r), mul(v, Math.sin(t) * e.r));
      B.vert(add(add([ex, ey, e.z], mul(nrm, 0.0008)), o), norm(add(nrm, mul(o, 0.6 / e.r))), e.iris, e.iris, [1, 0, 0], [1, 0, KIND.eye, 1], [0, 0, 0, 0], [0, 0, 0, 1]);
    }
    for (let r = 0; r < R; r++) B.tri(c, c + 1 + r, c + 2 + r);
    B.align(i0, B.i.length);
    B.mirror(k0, B.count, i0, B.i.length);
  }

  // --- the wings (the right one; mirrored after) ------------------------------------------------------------------
  const W = sp.wing, b = W.semispan;
  const S = W.shoulder;
  const wrist = [b * W.arm, S[1], S[2] + W.wristForward];
  const tip = [b, S[1] - 0.01 * W.crook, S[2] - W.tipBack];
  const chordAt = (x) => mix(W.rootChord, W.wristChord, clamp01((x - S[0]) / (wrist[0] - S[0])));
  const leAt = (x) => { const t = clamp01((x - S[0]) / (wrist[0] - S[0])); return [x, S[1] + 0.012 * W.crook * Math.sin(Math.PI * t), mix(S[2], wrist[2], Math.sin(t * Math.PI / 2))]; };
  const armW = (x) => { const t = clamp01((x - S[0]) / 0.06); return [1 - t, t, 0]; };   // the shoulder's skin blends into the body
  const wingK0 = B.count, wingI0 = B.i.length;
  {
    // coverts: a thin cambered aerofoil from the shoulder to the hand's coverts (the leading edge's thickness)
    const nsA = near ? 8 : 3, nsH = near ? 5 : 2;
    const handEnd = lerp3(wrist, tip, 0.42);
    const ring = near ? [0, 0.03, 0.1, 0.22, 0.38, 0.55] : [0, 0.12, 0.5];
    const k0 = B.count, i0 = B.i.length;
    const rows = [];
    for (let s = 0; s <= nsA + nsH; s++) {
      let le, chord, bw, hand = 0;
      if (s <= nsA) { const t = s / nsA, x = mix(S[0] - 0.01, wrist[0], t); le = leAt(x); chord = chordAt(x) * 0.62; bw = s === nsA ? [0, 0.5, 0.5] : armW(x); }
      else { const t = (s - nsA) / nsH; le = lerp3(wrist, handEnd, t); le[2] += 0.01 * Math.sin(Math.PI * t); chord = mix(W.wristChord * 0.62, W.wristChord * 0.32, t); bw = [0, 0, 1]; hand = 1; }
      const thick = mix(0.034, 0.012, clamp01((le[0] - S[0]) / (b * 0.6))) * (sp.massKg > 3 ? 1.2 : 1);
      const row = [];
      // round the aerofoil: the upper surface back, then the lower surface forward
      const pts = [];
      for (const f of ring) pts.push([f, 1]);
      for (const f of [...ring].reverse().slice(1, -1)) pts.push([f, -1]);
      for (let q = 0; q < pts.length; q++) {
        const [f, up] = pts[q];
        const camber = 0.35 * thick * Math.sin(Math.PI * Math.min(1, f / 0.6));
        const half = thick * 0.5 * Math.sqrt(Math.max(0, f / 0.04 < 1 ? f / 0.04 : 1)) * (1 - f * 0.9);
        const y = le[1] + camber + up * Math.max(half, f === 0 ? 0 : 0.0015);
        const p = [le[0], y, le[2] - f * chord];
        const t = (s <= nsA) ? 0 : (s - nsA) / nsH;
        let ct = mixc(C.wingTop, C.back, smooth(0.15, 0, (le[0] - S[0]) / b) * 0.6);
        let cb = C.wingUnder;
        if (C.carpal && sp.name === 'osprey') cb = mixc(cb, C.carpal, smooth(0.08, 0.02, Math.hypot(le[0] - wrist[0], le[2] - f * chord - (wrist[2] - 0.05))) * (hand || s > nsA - 2 ? 1 : 0));
        if (sp.name === 'California gull' && hand) ct = mixc(ct, C.tip, smooth(0.5, 1, t) * 0.5);
        const ao = mix(0.82, 1, smooth(0, 0.12, le[0] - S[0]));
        row.push(B.vert(p, [0, up, 0], up > 0 ? ct : cb, up > 0 ? ct : cb, bw, [f, s / (nsA + nsH), KIND.covert, 1], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 1], ao));
      }
      rows.push(row);
    }
    for (let s = 0; s + 1 < rows.length; s++) {
      const A = rows[s], Bq = rows[s + 1], n = A.length;
      for (let q = 0; q < n; q++) { const q1 = (q + 1) % n; B.quad(A[q], A[q1], Bq[q1], Bq[q]); }
    }
    B.closed(k0, B.count, i0, B.i.length);
  }

  // one feather: a tapered vane from base to tip, a raised rachis, nl segments along; its outline is cut in the shader
  const feather = (base, tipP, width, { kind, bw, ct, cb, fan = 0, curl = 0, emarg = 0, bar = [0, 0], ctTip = null, cbTip = null, tipFrom = 0.7, lift = 0, aoBase = 0.8 }) => {
    const nl = near ? 5 : 2, fi0 = B.i.length;
    const dir = sub(tipP, base), len = Math.hypot(...dir), d = norm(dir);
    let side = norm(cross([0, 1, 0], d));   // across the vane, in the wing plane
    if (!Number.isFinite(side[0])) side = [1, 0, 0];
    const up = norm(cross(d, side));
    const k = [];
    for (let s = 0; s <= nl; s++) {
      const v = s / nl;
      const c = add(base, mul(dir, v));
      const w = width * (kind === KIND.primary ? mix(0.8, 1, smooth(0, 0.3, v)) : 1) * 0.5;
      const row = [];
      for (const u of [-1, 0, 1]) {
        const p = add(add(c, mul(side, u * w)), mul(up, (u === 0 ? 0.0025 : -0.0005 * Math.abs(u)) * (near ? 1 : 0) + lift * v * v));
        const t = smooth(tipFrom, Math.min(1, tipFrom + 0.12), v);
        const top = ctTip ? mixc(ct, ctTip, t) : ct, bot = cbTip ? mixc(cb, cbTip, t) : cb;
        row.push(B.vert(p, up, top, bot, bw, [u, v, kind, 1], [...base, fan], [curl * v * v * len, 0, 0, 0], [emarg, bar[0], bar[1], 1], mix(aoBase, 1, smooth(0, 0.5, v))));
      }
      k.push(row);
    }
    for (let s = 0; s < nl; s++) for (let u = 0; u < 2; u++) B.quad(k[s][u], k[s][u + 1], k[s + 1][u + 1], k[s + 1][u]);
    B.align(fi0, B.i.length);
  };

  {
    // secondaries: along the arm, under the coverts, out to the trailing edge
    const ns = near ? W.secondaries : 5;
    for (let j = 0; j < ns; j++) {
      const t = (j + 0.5) / ns;
      const x = mix(S[0] + 0.01, wrist[0], t);
      const le = leAt(x), chord = chordAt(x);
      const base = [x, le[1] - 0.002, le[2] - chord * 0.3];
      const tipP = [x + 0.012, le[1] - 0.004, le[2] - chord * (1.0 + 0.03 * Math.sin(t * 9))];
      const width = (wrist[0] - S[0]) / ns * 1.9;
      const gullEdge = sp.name === 'California gull' ? C.mirror : null;
      feather(base, tipP, width, { kind: KIND.secondary, bw: t < 0.12 ? [0.5, 0.5, 0] : [0, 1, 0], ct: C.wingTop, cb: C.flightUnder,
        bar: sp.name === 'osprey' ? [5.5, 0.55] : [0, 0], ctTip: gullEdge ?? (sp.name === 'Canada goose' ? C.tip : null), cbTip: gullEdge, tipFrom: gullEdge ? 0.82 : 0.6, fan: 0 });
    }
    // primaries: from the hand, fanned to the tip's outline (raptors: a broad rounded hand of slotted fingers)
    const np = near ? W.primaries : 5;
    const teWrist = [wrist[0] + 0.01, wrist[1], wrist[2] - W.wristChord];
    const ctrl = [mix(tip[0], teWrist[0], 0.25 * (1 - W.crook * 0.3)), tip[1], mix(teWrist[2], tip[2], W.fingers > 3 ? 0.35 : 0.75)];
    const outline = (s) => { const a = (1 - s) ** 2, m = 2 * s * (1 - s), c = s * s; return [a * teWrist[0] + m * ctrl[0] + c * tip[0], a * teWrist[1] + m * ctrl[1] + c * tip[1], a * teWrist[2] + m * ctrl[2] + c * tip[2]]; };
    const handLine = (t) => lerp3(lerp3(wrist, tip, 0.04), lerp3(wrist, tip, 0.5), t);
    for (let j = 0; j < np; j++) {
      const t = j / (np - 1);
      const base = add(handLine(t), [0, -0.003, -0.03]);
      // raptors: the outermost primary is shorter than the fingers before it (the rounded hand)
      let s = mix(0.08, 1, t ** 0.9);
      if (W.fingers > 3 && j === np - 1) s = 0.9;
      const tipP = outline(s);
      if (W.fingers > 3 && j === np - 1) { tipP[0] -= 0.06 * b; tipP[2] += 0.02; }
      const finger = j >= np - Math.max(W.fingers, 0) && W.fingers > 0;
      const width = (finger ? 0.085 : 0.12) * b * (near ? 1 : 1.6) * mix(1, 0.8, t);
      const gull = sp.name === 'California gull';
      const ctTip = gull ? (j >= np - 2 ? C.tip : j >= np - 6 ? C.tip : null) : (sp.name === 'osprey' ? mixc(C.wingTop, [0.01, 0.01, 0.01], 0.6) : sp.name === 'Canada goose' ? C.tip : null);
      const cbTip = gull ? (j >= np - 6 ? C.tip : null) : sp.name === 'osprey' ? C.carpal : null;
      const tipFrom = gull ? mix(0.75, 0.35, smooth(np - 7, np - 1, j)) : 0.72;
      feather(base, tipP, width, { kind: KIND.primary, bw: [0, 0, 1], ct: gull && j < np - 6 ? C.wingTop : C.wingTop, cb: C.flightUnder,
        fan: t, curl: finger ? 1 : 0.35 * t, emarg: finger ? W.emarg : 0, bar: sp.name === 'osprey' ? [6, 0.5] : [0, 0], ctTip, cbTip, tipFrom, lift: finger ? 0.004 : 0 });
      // the gull's white "mirror" on the outer primaries: drawn as a small spot near the tip
      if (gull && j >= np - 2 && near) {
        const mp = lerp3(base, tipP, 0.86);
        feather(add(mp, [0, 0.0015, 0]), add(lerp3(base, tipP, 0.95), [0, 0.0015, 0]), width * 0.6, { kind: KIND.primary, bw: [0, 0, 1], ct: C.mirror, cb: C.mirror, fan: t, curl: 0.35 * t });
      }
    }
  }
  B.mirror(wingK0, B.count, wingI0, B.i.length);

  // --- the tail: a fan of rectrices about the tail's root ---------------------------------------------------------
  {
    const T = sp.tail, n = near ? T.feathers : 4, k0 = B.count;
    const rootZ = zTail + 0.03, rootY = sp.body[0][3] + 0.004;
    for (let j = 0; j < n; j++) {
      const f = (j - (n - 1) / 2) / ((n - 1) / 2);
      const bx = f * T.width * 0.28;
      const ang = f * 0.16;
      const len = T.len * (T.shape === 'wedge' ? 1 - 0.14 * f * f : T.shape === 'round' ? 1 - 0.25 * f * f : 1 - 0.02 * f * f);
      const base = [bx, rootY - 0.002 * Math.abs(f), rootZ];
      const tipP = [bx + Math.sin(ang) * len, rootY - 0.01, rootZ - Math.cos(ang) * len];
      const width = T.width / n * 2.3 * (near ? 1 : 1.5);
      feather(base, tipP, width, { kind: KIND.tail, bw: [1, 0, 0], ct: C.tailTop, cb: C.tailUnder, fan: f, bar: T.bars ? [T.bars, 0.45] : [0, 0],
        ctTip: sp.name === 'osprey' ? C.tailUnder.map((v) => v * 0.7) : null, tipFrom: 0.9 });
    }
    void k0;
  }

  // --- legs and feet: the hip, a tarsus, four toes with talons (folded back under the tail in flight) -------------
  {
    const L = sp.legs, k0 = B.count, i0 = B.i.length;
    const hip = [sp.body[2][1] * 0.45, sp.body[2][3] - sp.body[2][2] * 0.55, 0.0];
    const knee = add(hip, [0.005, -L.len * 0.3, 0.01]);
    const foot = add(knee, [0, -L.len * 0.6, 0.02]);
    const rod = (a, c, r, col, k = near ? 6 : 3) => {
      const ax = norm(sub(c, a)), u = norm(cross(Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], ax)), v = cross(ax, u);
      const kk = B.count;
      for (const [p, rr] of [[a, r], [c, r * 0.7]]) for (let j = 0; j <= k; j++) {
        const th = j / k * 2 * Math.PI, o = add(mul(u, Math.cos(th)), mul(v, Math.sin(th)));
        B.vert(add(p, mul(o, rr)), o, col, col, [1, 0, 0], [j / k, 0, KIND.foot, 1], [...hip, 0], [0, 1, 0, 0], [0, 0, 0, 1], 0.9);
      }
      const ii = B.i.length;
      for (let j = 0; j < k; j++) B.quad(kk + j, kk + j + 1, kk + k + 2 + j, kk + k + 1 + j);
      B.closed(kk, B.count, ii, B.i.length);
    };
    const feathered = sp.name !== 'Canada goose' && sp.name !== 'California gull';
    rod(hip, knee, sp.massKg > 3 ? 0.026 : 0.019, feathered ? (sp.name === 'osprey' ? C.belly : C.belly) : L.colour);   // the "trousers"
    rod(knee, foot, sp.massKg > 3 ? 0.011 : 0.008, L.colour);
    const toes = sp.name === 'Canada goose' || sp.name === 'California gull' ? [[-0.4, 1], [0, 1.1], [0.4, 1]] : [[-0.5, 1], [0, 1.1], [0.5, 0.95], [Math.PI, 0.7]];
    for (const [a, l] of toes) {
      const d = [Math.sin(a) * 0.6, -0.08, Math.cos(a)], tl = L.len * 0.32 * l;
      const tp = add(foot, mul(norm(d), tl));
      rod(foot, tp, 0.006, L.colour, near ? 4 : 3);
      if (feathered && near) rod(tp, add(tp, [d[0] * 0.012, -0.018, d[2] * 0.01]), 0.004, L.talon, 3);
    }

    B.mirror(k0, B.count, i0, B.i.length);
  }

  // --- the osprey's trout, head forward, held under the body (shown only while carried) ---------------------------
  if (sp.name === 'osprey') {
    const k0 = B.count, i0 = B.i.length, n = near ? 10 : 4, R = near ? 8 : 4;
    const cy = -0.165, len = 0.28;
    const olive = [0.03, 0.06, 0.06], silver = [0.42, 0.44, 0.43], pink = [0.3, 0.24, 0.22];
    for (let s = 0; s <= n; s++) {
      const t = s / n, z = -len * 0.55 + len * t;
      const r = Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.04)) ** 0.7;
      const hw = 0.022 * r, hh = 0.04 * r;
      for (let q = 0; q <= R; q++) {
        const a = q / R * 2 * Math.PI, ca = Math.cos(a), sa = Math.sin(a);
        const spot = h01(s * 31 + q * 7) > 0.8 && sa > 0 ? 0.4 : 1;
        const col = sa > 0.3 ? olive.map((v) => v * spot) : sa > -0.2 ? pink : silver;
        B.vert([hw * ca, cy + hh * sa, z], [ca, sa * 0.7, 0], col, col, [1, 0, 0], [q / R, t, KIND.fish, 1], [0, cy, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]);
      }
    }
    for (let s = 0; s < n; s++) for (let q = 0; q < R; q++) { const a = k0 + s * (R + 1) + q, b2 = a + R + 1; B.quad(a, b2, b2 + 1, a + 1); }
    // the tail fin
    const tf = B.count;
    for (const [y, z] of [[0, -len * 0.55], [0.035, -len * 0.7], [-0.035, -len * 0.7]]) B.vert([0, cy + y, z], [1, 0, 0], olive, olive, [1, 0, 0], [0.5, 0, KIND.fish, 1], [0, cy, 0, 0], [0, 0, 1, 0]);
    B.tri(tf, tf + 1, tf + 2);
    B.closed(k0, B.count, i0, B.i.length);
  }

  const data = new Float32Array(B.v), index = new Uint32Array(B.i);
  return { data, index, info: { species: name, lod, vertices: B.count, triangles: B.i.length / 3, wrist, tip, shoulder: S, neckZ, hip: [sp.body[2][1] * 0.45, sp.body[2][3] - sp.body[2][2] * 0.55, 0] } };
}
