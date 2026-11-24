// Lakeshore boat M4: mast, boom, spreaders and standing rigging, as parametric geometry.
// Plain JS, no three.js: the node tests and the page share one set of formulas (src/boat/spars-mesh.js wraps them).
//
// Rig frame (as src/boat/rig.js, the sails): metres, +Y up, bow toward −Z, +X starboard; origin at the mast step on deck.
// A generic ≈30 ft fractional sloop (main 21 m², jib 18.6 m²), two sets of spreaders swept 20° aft, no
// runners, a single backstay. No maker's section or fittings: the shapes are generic.
//
//   import { SPARS, solveRig, buildSpars } from './spars.js';
//   const rig = solveRig(SPARS);           // fitting points: tangs, spreader tips, chainplates, the wire list
//   const g = buildSpars(rig);             // { mast, boom, wires }: typed arrays (see MeshData below)
//
// Points other modules read: rig.forestayAt(v) (v 0 stem pin → 1 hounds tang), SPARS.luffZ (the main's luff, in the
// mast track), SPARS.gooseneck / SPARS.goosenZ (the boom pivot), rig.points.boomEnd(boomDeg), rig.points.bails.

import { DEFAULT_DIMS } from '../sim/boat/dims.js';
import { canvasHex } from '../sim/boat/canvasHex.js';
import { masthead, spreaderFittings, rigScrew, RIGSCREW_LEN, furler, furlerFixed, boomFittings, lazyBag, vane, vaneTabs, turned, ring } from './spars-detail.js';

// The tack, extended down the forestay line to the stem pin at y `stemPinY`: the stay passes through RIG.tack exactly.
function stemPin(tack, tang, y) {
  const t = (y - tack[1]) / (tang[1] - tack[1]);
  return [0, y, tack[2] + (tang[2] - tack[2]) * t];
}

// the spars for a boat's dims (memoised); SPARS is this page's boat's
const sparsMemo = new WeakMap();
export function sparsFor(dims = DEFAULT_DIMS) {
  let S = sparsMemo.get(dims);
  if (S) return S;
  const { RIG, HULL } = dims;
  S = {
    mastTop: RIG.mastTop,        // masthead above the step, m
    masthead: RIG.mastTop - RIG.forestayTang < 0.3,   // a masthead rig: the forestay at the masthead fitting (the reference boat)
    hounds: RIG.forestayTang,    // forestay tang
    houndsZ: -HULL.mastFrontZ - 0.02,  // the tang's pin, just ahead of the mast's front face
    capTang: RIG.capTang,        // cap shroud tangs (mast sides)
    gooseneck: RIG.gooseneck,    // boom pivot height
    goosenZ: 0.12,               // boom pivot aft of the mast axis
    luffZ: 0.085,                // the sail track on the mast's aft face
    section: { depth: 2 * HULL.mastFrontZ, width: 0.10, topDepth: 2 * HULL.mastFrontZ, topWidth: 0.10 },   // fore-aft × athwart [est]; no taper on a masthead rig
    boom: { length: RIG.boom + 0.15, depth: 0.14, width: 0.085 },   // E plus the end fitting
    spreaders: RIG.spreaders.map((s) => ({ y: s.y, len: s.length, sweepDeg: s.sweepDeg ?? 0 })),   // height, length from the mast axis, sweep aft
    chainplate: RIG.chainplate,        // cap (V1) and intermediate (D2), starboard; port mirrors x
    lowerPlates: RIG.lowerChainplates, // lowers (D1): fore and aft on an in-line rig
    stem: stemPin(RIG.tack, [0, RIG.forestayTang, -HULL.mastFrontZ - 0.02], RIG.tack[1] - 0.10),   // forestay pin at the stem fitting, 0.10 m under the tack, on the stay's line
    backstayPlate: RIG.backstayPlate,  // transom
    drumTop: RIG.tack[1],              // the furler drum's top (the jib tack sits on it)
    wire: { forestay: 0.004, cap: 0.0035, inter: 0.003, lower: 0.003, backstay: 0.0035, antenna: 0.003 },  // radius, m
    stackPack: true,                   // an open lazy bag on the boom: the boom's direction reads from 50 m
  };
  sparsMemo.set(dims, S);
  return S;
}
export const SPARS = sparsFor(DEFAULT_DIMS);

const DEG = Math.PI / 180;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => mul(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => add(a, mul(sub(b, a), t));
export const vec = { add, sub, mul, dot, cross, len, norm, lerp };

// Mast half-section at height y: [half width (x), half depth (z)].
export function mastHalf(S, y) {
  const s = S.section;
  const t = Math.min(1, Math.max(0, (y - S.capTang) / (S.mastTop - S.capTang)));
  return [(s.width + (s.topWidth - s.width) * t) / 2, (s.depth + (s.topDepth - s.depth) * t) / 2];
}

// The spreader tip for an elevation angle: root on the mast axis at y, out by len, swept aft.
function tipAt(S, sp, side, el) {
  const sw = sp.sweepDeg * DEG;
  const h = [side * Math.cos(sw), 0, Math.sin(sw)];
  return add([0, sp.y, 0], add(mul(h, sp.len * Math.cos(el)), [0, sp.len * Math.sin(el), 0]));
}

// The angle (deg) between the spreader and the push of a continuous wire over its tip, in the spreader's vertical plane
// (0 = no bending up or down; the sweep is fixed, so the plan component is the sweep's, not the elevation's).
export function bisectError(root, tip, prev, next) {
  const d = sub(root, tip);                                             // the spreader pushes the tip outward: −d
  const h = norm([d[0], 0, d[2]]), up = [0, 1, 0];
  const push = add(norm(sub(prev, tip)), norm(sub(next, tip)));         // the wire's resultant on the tip
  const a1 = Math.atan2(dot(push, up), dot(push, h)), a2 = Math.atan2(dot(d, up), dot(d, h));
  return Math.abs(a1 - a2) / DEG;
}

// Fitting points and the wire list. Each spreader's elevation is solved so it bisects the cap shroud's angle over its
// tip in the vertical (the spreader carries compression only, no bending: the rigger's rule).
export function solveRig(S = SPARS) {
  const sides = [1, -1];
  const mir = (p, side) => [p[0] * side, p[1], p[2]];
  const els = S.spreaders.map(() => 3 * DEG);
  const capTang = (side) => [side * mastHalf(S, S.capTang)[0], S.capTang, 0];
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < S.spreaders.length; i++) {
      const side = 1;
      const chain = [mir(S.chainplate, side), ...S.spreaders.map((sp, k) => tipAt(S, sp, side, els[k])), capTang(side)];
      const prev = chain[i], next = chain[i + 2];
      // 1-D search on the elevation: the error is smooth and single-welled over −10°..25°
      let lo = -10 * DEG, hi = 25 * DEG;
      for (let k = 0; k < 60; k++) {
        const a = lo + (hi - lo) * 0.382, b = lo + (hi - lo) * 0.618;
        const ea = bisectError([0, S.spreaders[i].y, 0], tipAt(S, S.spreaders[i], side, a), prev, next);
        const eb = bisectError([0, S.spreaders[i].y, 0], tipAt(S, S.spreaders[i], side, b), prev, next);
        if (ea < eb) hi = b; else lo = a;
      }
      els[i] = (lo + hi) / 2;
    }
  }
  const tips = (side) => S.spreaders.map((sp, i) => tipAt(S, sp, side, els[i]));
  const r = S.wire;
  const wires = [];   // { name, pts: [[x,y,z]...], r, kind }
  for (const side of sides) {
    const n = side > 0 ? 'stbd' : 'port';
    const T = tips(side);
    wires.push({ name: `cap_${n}`, pts: [mir(S.chainplate, side), ...T, capTang(side)], r: r.cap, kind: 'steel', plate: true });
    if (T.length > 1) {
      const y2 = S.spreaders[1].y - 0.12;
      wires.push({ name: `inter_${n}`, pts: [add(mir(S.chainplate, side), [-side * 0.03, 0, 0]), T[0], [side * mastHalf(S, y2)[0], y2, 0]], r: r.inter, kind: 'steel', plate: true });
    }
    const y1 = S.spreaders[0].y - 0.12;
    S.lowerPlates.forEach((lp, k) => {
      wires.push({ name: `lower${k ? k + 1 : ''}_${n}`, pts: [mir(lp, side), [side * mastHalf(S, y1)[0], y1, Math.sign(lp[2]) * 0.01]], r: r.lower, kind: 'steel', plate: true });
    });
  }
  const houndsTang = [0, S.hounds, S.houndsZ];
  wires.push({ name: 'forestay', pts: [S.stem, houndsTang], r: r.forestay, kind: 'steel' });
  const crane = [0, S.mastTop + 0.07, S.masthead ? 0.22 : 0.30];
  wires.push({ name: 'backstay', pts: [S.backstayPlate, crane], r: r.backstay, kind: 'steel', plate: true });
  wires.push({ name: 'antenna', pts: [[0.045, S.mastTop + 0.12, -0.04], [0.045, S.mastTop + 1.02, -0.04]], r: r.antenna, kind: 'black' });
  const forestayAt = (v) => lerp(S.stem, houndsTang, v);
  const points = {
    houndsTang, crane, capTang: capTang(1), masthead: [0, S.mastTop, 0],
    tips: tips(1), spreaderElevDeg: els.map((e) => e / DEG),
    gooseneck: [0, S.gooseneck, S.goosenZ],
    boomEnd: (boomDeg = 0) => { const t = boomDeg * DEG; return [Math.sin(t) * S.boom.length, S.gooseneck, S.goosenZ + Math.cos(t) * S.boom.length]; },
    bails: { mainsheet: 1.32, vang: 0.95 },   // m aft of the pivot, under the boom: mid-boom sheeting over the cabin-top traveller (lines.js)
    burgee: [0, S.mastTop + 0.16, 0.10],
  };
  return { S, wires, forestayAt, points, els };
}

// ---- MeshData: a small accumulator of indexed triangles with per-vertex colour and (metalness, roughness) ----------
export class MeshData {
  constructor() { this.p = []; this.n = []; this.c = []; this.m = []; this.i = []; }
  get vertexCount() { return this.p.length / 3; }
  get triangleCount() { return this.i.length / 3; }
  vert(p, n, col, mr) { this.p.push(...p); this.n.push(...n); this.c.push(...col); this.m.push(...mr); return this.vertexCount - 1; }
  tri(a, b, c) { this.i.push(a, b, c); }
  arrays() {
    return { position: new Float32Array(this.p), normal: new Float32Array(this.n), color: new Float32Array(this.c),
      mr: new Float32Array(this.m), index: this.vertexCount > 65535 ? new Uint32Array(this.i) : new Uint16Array(this.i) };
  }
}

// An orthonormal frame around an axis.
export function frame(axis, hint = [0, 1, 0]) {
  const a = norm(axis);
  let u = cross(Math.abs(dot(a, hint)) > 0.95 ? [1, 0, 0] : hint, a);
  u = norm(u);
  return [a, u, cross(a, u)];
}

// A closed 2-D profile (points in the u, v plane) swept through rings. rings: [{ o: centre, a: axis, s: [su, sv] }].
// Smooth normals from the profile (an ellipse's normal is (u/su², v/sv²)); flat caps optional.
export function sweepRings(md, rings, profile, col, mr, { capStart = false, capEnd = false, hint } = {}) {
  const n = profile.length;
  const base = [];
  for (const r of rings) {
    const [, u, v] = frame(r.a, hint);
    const b0 = md.vertexCount;
    for (const [pu, pv] of profile) {
      const p = add(r.o, add(mul(u, pu * r.s[0]), mul(v, pv * r.s[1])));
      const nn = norm(add(mul(u, pu / r.s[0]), mul(v, pv / r.s[1])));
      md.vert(p, nn, col, mr);
    }
    base.push(b0);
  }
  for (let k = 0; k + 1 < rings.length; k++) {
    for (let j = 0; j < n; j++) {
      const a = base[k] + j, b = base[k] + (j + 1) % n, c = base[k + 1] + (j + 1) % n, d = base[k + 1] + j;
      md.tri(a, b, c); md.tri(a, c, d);
    }
  }
  const cap = (r, flip) => {
    const [ax, u, v] = frame(r.a, hint);
    const nn = mul(ax, flip ? -1 : 1);
    const c0 = md.vert(r.o, nn, col, mr);
    const b0 = md.vertexCount;
    for (const [pu, pv] of profile) md.vert(add(r.o, add(mul(u, pu * r.s[0]), mul(v, pv * r.s[1]))), nn, col, mr);
    for (let j = 0; j < n; j++) flip ? md.tri(c0, b0 + (j + 1) % n, b0 + j) : md.tri(c0, b0 + j, b0 + (j + 1) % n);
  };
  if (capStart) cap(rings[0], true);
  if (capEnd) cap(rings[rings.length - 1], false);
}

export const circle = (k) => Array.from({ length: k }, (_, j) => [Math.cos((j / k) * 2 * Math.PI), Math.sin((j / k) * 2 * Math.PI)]);
// A rounded oval (superellipse, exponent e < 1 squares it up): the mast and boom extrusions.
export const oval = (k, e) => Array.from({ length: k }, (_, j) => {
  const t = (j / k) * 2 * Math.PI, c = Math.cos(t), s = Math.sin(t);
  return [Math.sign(c) * Math.abs(c) ** e, Math.sign(s) * Math.abs(s) ** e];
});

// A straight member from a to b with an elliptic section (radii ru, rv), capped.
export function member(md, a, b, ru, rv, col, mr, k = 8, hint) {
  const ax = sub(b, a);
  sweepRings(md, [{ o: a, a: ax, s: [ru, rv] }, { o: b, a: ax, s: [ru, rv] }], circle(k), col, mr, { capStart: true, capEnd: true, hint });
}
// A box from a to b (section w × h).
export function box(md, a, b, w, h, col, mr, hint) {
  const sq = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const ax = sub(b, a);
  // flat-shaded: one ring pair per face would be exact; a 4-gon with smooth normals reads fine at this size
  sweepRings(md, [{ o: a, a: ax, s: [w / 2, h / 2] }, { o: b, a: ax, s: [w / 2, h / 2] }], sq, col, mr, { capStart: true, capEnd: true, hint });
}

// Colours (linear sRGB) and (metalness, roughness). Satin anodised aluminium, black fittings, polished stainless.
// Albedo).
export const srgb = (hex) => [16, 8, 0].map((s) => { const c = ((hex >> s) & 255) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
export const MAT = {
  alu: { c: srgb(0xB9BCC0), mr: [1.0, 0.40] },     // anodised aluminium
  dark: { c: srgb(0x232527), mr: [0.0, 0.55] },    // black fittings (cast nylon, powder coat)
  steel: { c: srgb(0xC8CACC), mr: [1.0, 0.22] },   // stainless
  boot: { c: srgb(0xE4E1D8), mr: [0.0, 0.6] },     // white PVC spreader boots
  canvas: { c: srgb(canvasHex()), mr: [0.0, 0.85] },  // the lazy bag, in the boat's canvas colour (canvas.json; owner picked toast)
};

// The geometry: three MeshData: the static mast group, the boom group (in the boom's own frame: origin at the pivot,
// +Z aft along the boom), and the wires (ribbons, see spars-mesh.js).
export function buildSpars(rig = solveRig()) {
  const S = rig.S;
  const mast = new MeshData(), boom = new MeshData();
  const A = MAT.alu, D = MAT.dark, St = MAT.steel;

  // Mast: rings up the extrusion; the taper above the tangs.
  const ys = [0.0, 0.5, S.capTang - 0.3, S.capTang, S.capTang + 0.25, S.mastTop];
  sweepRings(mast, ys.map((y) => { const [hx, hz] = mastHalf(S, y); return { o: [0, y, 0], a: [0, 1, 0], s: [hz, hx] }; }),
    oval(20, 0.85), A.c, A.mr, { capEnd: true, hint: [0, 0, 1] });
  // a dark sail-track strip down the aft face, gooseneck to the head
  box(mast, [0, S.gooseneck, mastHalf(S, 1)[1] - 0.004], [0, S.mastTop - 0.4, mastHalf(S, S.mastTop - 0.4)[1] - 0.004], 0.02, 0.012, D.c, D.mr, [0, 0, 1]);
  // deck collar and boot, gooseneck fitting, vang base
  member(mast, [0, -0.02, 0], [0, 0.07, 0], 0.13, 0.11, D.c, D.mr, 16, [0, 0, 1]);
  box(mast, [0, S.gooseneck - 0.07, 0.07], [0, S.gooseneck + 0.07, 0.07], 0.07, 0.06, D.c, D.mr, [0, 0, 1]);
  box(mast, [0, 0.08, 0.09], [0, 0.17, 0.09], 0.06, 0.05, D.c, D.mr, [0, 0, 1]);
  // masthead: the casting, its sheaves, the crane, the tangs, the light's base, the VHF bracket; the wind vane's stick
  masthead(mast, rig);
  const vaneAt = [0, S.mastTop + 0.42, -0.30];
  member(mast, [0, S.mastTop + 0.06, -0.07], vaneAt, 0.004, 0.004, D.c, D.mr, 6);
  // spreaders: an aero section from the mast side to the tip, a cast root socket, a taped white boot on the tip
  for (const side of [1, -1]) {
    for (let i = 0; i < S.spreaders.length; i++) {
      const sp = S.spreaders[i];
      const tip = rig.points.tips[i].map((v, k) => (k === 0 ? v * side : v));
      const root = [side * mastHalf(S, sp.y)[0] * 0.8, sp.y, 0];
      const ax = sub(tip, root);
      sweepRings(mast, [{ o: root, a: ax, s: [0.032, 0.012] }, { o: lerp(root, tip, 0.96), a: ax, s: [0.022, 0.009] }], oval(10, 0.9), A.c, A.mr,
        { capEnd: true, hint: [0, 1, 0] });
      spreaderFittings(mast, rig, side, i, root, tip);
    }
  }
  // at every plate: the chainplate, a toggle, an open-body rigging screw, the swage (the wire starts at its top)
  for (const w of rig.wires) {
    if (!w.plate) continue;
    rigScrew(mast, w.pts[0], norm(sub(w.pts[1], w.pts[0])));
  }
  // Forestay: the furler (its drum a separate node: spars-mesh.js), the foil up the stay (a 31 mm extrusion; the
  // jib's luff rides in it), the top swivel parked at the jib's head.
  const fu = furler(rig);
  fu.guide = furlerFixed(mast, rig, fu).guide;
  {
    const f = rig.forestayAt;
    const L = len(sub(f(1), f(0)));
    sweepRings(mast, [{ o: fu.p1, a: sub(f(1), f(0)), s: [0.0155, 0.0155] }, { o: f(1 - 0.35 / L), a: sub(f(1), f(0)), s: [0.0155, 0.0155] }],
      circle(10), A.c, A.mr, { capEnd: true });
    turned(mast, f(0.955), f(0.968), [[0, 0.026], [0.5, 0.030], [1, 0.026]], A.c, A.mr, 14);
    ring(mast, add(f(0.962), [0, -0.01, 0.03]), [1, 0, 0], 0.012, 0.0035, St.c, St.mr, 10, 5);   // the halyard's shackle
  }

  // Boom (its own frame): the extrusion, the gooseneck and end fittings, the bails and blocks, the rigid vang, the lazy bag.
  const B = S.boom;
  sweepRings(boom, [0.03, 1.0, B.length - 0.06].map((z) => ({ o: [0, 0, z], a: [0, 0, 1], s: [B.width / 2, B.depth / 2] })),
    oval(16, 0.7), A.c, A.mr, { hint: [0, 1, 0] });
  boomFittings(boom, rig, { sheetAt: rig.points.bails.mainsheet, vangAt: rig.points.bails.vang });
  {
    // vang: from the mast base fitting (on the mast axis, so the boom's swing keeps it in place) to the vang bail; a
    // gas-strut rigid vang: the outer tube, the stainless rod, cast end fittings with their pins
    const base = [0, 0.125 - S.gooseneck, 0.09 - S.goosenZ];
    const top = [0, -B.depth / 2 - 0.02, rig.points.bails.vang];
    turned(boom, base, lerp(base, top, 0.62), [[0, 0.026], [0.04, 0.024], [0.96, 0.024], [1, 0.027]], A.c, A.mr, 14);
    member(boom, lerp(base, top, 0.55), top, 0.012, 0.012, St.c, St.mr, 10);
    box(boom, sub(base, [0, 0.03, 0]), add(base, [0, 0.05, 0]), 0.05, 0.05, D.c, D.mr);
    turned(boom, lerp(base, top, 0.93), top, [[0, 0.014], [1, 0.018]], D.c, D.mr, 10);
    member(boom, add(top, [-0.025, 0, 0]), add(top, [0.025, 0, 0]), 0.005, 0.005, St.c, St.mr, 6);
  }
  if (S.stackPack) lazyBag(boom, rig);

  // Wires: ribbons, one quad per straight span (wires under tension are straight; the sag lives in M7's lines).
  const wires = [];
  for (const w of rig.wires) {
    for (let k = 0; k + 1 < w.pts.length; k++) {
      let a = w.pts[k], b = w.pts[k + 1];
      if (k === 0 && w.plate) a = add(a, mul(norm(sub(b, a)), RIGSCREW_LEN));   // starts at the rigging screw's swage
      wires.push({ a, b, r: w.r, kind: w.kind, name: w.name });
    }
  }
  return { mast, boom, wires, rig, vane: vane(), vaneTabs: vaneTabs(), vaneAt, furler: fu };
}

// Ribbon arrays for the wires: 4 vertices per span: centreline position, the span's direction, the side (−1, +1), the
// radius, the colour. The vertex shader widens each ribbon to a minimum on-screen width and fades it by coverage.
export function wireArrays(wires) {
  const n = wires.length;
  const position = new Float32Array(n * 12), tangent = new Float32Array(n * 12), side = new Float32Array(n * 4),
    radius = new Float32Array(n * 4), color = new Float32Array(n * 12), along = new Float32Array(n * 4);
  const index = new Uint16Array(n * 6);
  const col = { steel: MAT.steel.c, black: [0.02, 0.02, 0.02], alu: MAT.alu.c };
  wires.forEach((w, k) => {
    const t = norm(sub(w.b, w.a));
    const L = len(sub(w.b, w.a));
    [[w.a, -1, 0], [w.a, 1, 0], [w.b, 1, L], [w.b, -1, L]].forEach(([p, s, u], j) => {
      const v = k * 4 + j;
      position.set(p, v * 3); tangent.set(t, v * 3); side[v] = s; radius[v] = w.r; along[v] = u;
      color.set(col[w.kind] ?? col.steel, v * 3);
    });
    index.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
  });
  return { position, tangent, side, radius, color, along, index, triangles: n * 2 };
}
