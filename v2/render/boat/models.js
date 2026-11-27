// v1's boat models, built for v2's GPU (M3b): the four GLBs (models/boat/{hull,cockpit,hardware,wheel}.glb, or their
// packed copies) placed, coloured and grouped the way v1's page does it (src/boat/Boat.js sockets, src/craft/sloop/body.js,
// hullMaterials.js, cockpitLook.js, canvas.js), merged into one vertex set with a material table. Pure: the node tests
// build it from fixtures; the boat's worker runs it in the browser.
//   const set = buildBoatModels({ hull, cockpit, hardware, wheel }, { dims, wheelAt, canvas })   (each a parseGlb result)
//   → { position, normal, uv (Float32Array), color (Uint8Array, 4 a vertex), mat (Uint32Array), index (Uint32Array),
//       ranges: { cabin, portal, always, detail, near, far, wheel, traveller, glass } ({ first, count } in indices),
//       materials (Float32Array, MAT_FLOATS a record), materialNames, images [{ file, image, array: 'C'|'D', layer }],
//       traveller: { x0, y0, z0 }, triangles: { …per range }, vertices }
// Frames: every vertex is in the HULL frame (x starboard, y up from the waterline, z aft), except the wheel's (its own:
// the axle along z, the slot puts it at the profile's wheel socket and turns it) and the traveller car's (relative to the
// cockpit's traveller_car node: the slot slides it along the crowned track).
import { mul4 } from '../../engine/gltf.js';
import { sceneNodes, meshPrimitives, materialOf } from '../../engine/gltf.js';
import { oldRingDrop, buildLifeRing } from './lifeRing.js';
import { hexLinear } from './colour.js';
import { hullShape } from './hullShape.js';

export const MAT_FLOATS = 16;
// the material kinds the WGSL knows (render/boatModels.js): v1's procedural materials ported, the rest plain PBR;
// livery (the race look): the hull's own skin, boot top to sheer, the gelcoat under the boat's colour, boot and cove stripes
export const KIND = Object.freeze({ plain: 0, gelcoat: 1, nonskid: 2, antifouling: 3, stainless: 4, teak: 5, cabin: 6, glass: 7, livery: 8 });
// the race livery (the look round of 2026-11-25): the hull skin is its own material so the topsides can take the boat's colour
// (the player's navy, a rival's tint) without touching the deck, the trunk or the well; the skin's uv.x carries its depth under
// the sheer line (the Blender build's own sheer, hullShape.js), so the cove stripe follows the sheer exactly
export const LIVERY = Object.freeze({ sheerSlack: 0.03, sideNy: 0.62, sternZ: 3.5 });
// is this triangle (centroid c, unit face normal n, HULL frame) part of the hull's outer skin? Below the sheer (plus the slack), a
// side face, facing outward (or aft at the transom): the trunk sides sit over the sheer, the well walls face inward, the
// companionway face is aft-facing but forward of the stern
export function hullSkin(c, n, sheerAt, L = LIVERY) {
  if (c[1] > sheerAt(c[2]) + L.sheerSlack) return false;
  if (Math.abs(n[1]) > L.sideNy) return false;
  const outward = n[0] * c[0] > -0.02 * Math.abs(c[0]) - 1e-3;
  const aft = n[2] > 0.5;
  if (aft) return c[2] > L.sternZ;
  return outward && !(n[2] < -0.5 && c[2] > 0);   // a forward-facing face aft of amidships (the seats' fronts) is not the skin
}
// the sheer height at a HULL-frame z (the script's lines, hullShape.js: its station y runs forward)
export const sheerFn = (dims) => {
  const H = dims?.HULL ?? {};
  for (const k of ['loa', 'lwl', 'beam', 'freeboard']) if (!Number.isFinite(H[k])) throw new Error(`boat models: dims.HULL.${k} missing (the hull shape's sheer line needs loa, lwl, beam, freeboard)`);   // a partial dims made every face "skin" and the sheer NaN
  const S = hullShape(dims); return (z) => S.sheer(-z);
};
export const RANGES = Object.freeze(['cabin', 'portal', 'always', 'detail', 'near', 'far', 'wheel', 'traveller', 'anchor', 'glass']);   // #8: anchor (its own slot: it drops)

// --- v1's material rules ---------------------------------------------------------------------------------------------
export { hexLinear };   // three's Color(hex) as linear RGB (colour.js)
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
// canvas.js: Halcyon's canvas sun-faded 14 % toward a warm grey
const FADE = [0.62, 0.60, 0.56];
export const faded = (hex) => lerp3(hexLinear(hex), FADE, 0.14);
export function canvasColours(variant) {
  const shade = (() => { const c = hexLinear(variant.canvas), m = Math.max(...c); return lerp3(c.map((v) => v / m), [1, 1, 1], 0.4).map((v) => v * 0.10); })();
  return { canvas: faded(variant.canvas), trim: faded(variant.trim), shade };
}
// hullMaterials.js WHITE_DATA_ALBEDO: a suffixed copy whose vertex colours are pure white is scaled to the hull's own
const WHITE_DATA_ALBEDO = { gelcoat: 0.68, nonskid: 0.56 };
export function whiteData(color) {   // color: { array, size, count } (COLOR_0) | null; v1 averages the first 512
  if (!color) return false;
  const n = Math.min(color.count, 512); let s = 0;
  for (let i = 0; i < n; i++) s += (color.array[i * color.size] + color.array[i * color.size + 1] + color.array[i * color.size + 2]) / 3;
  return n > 0 && s / n > 0.97;
}
const SWAPPED = new Set(['gelcoat', 'nonskid', 'antifouling', 'teak_deck', 'gelcoat_plain', 'acrylic', 'stainless', 'near_chrome', 'aluminium']);

// a material record from v1's rules: m (materialOf), the primitive's COLOR_0, its node's name, the canvas colours
// → { name, kind, base: [r,g,b,a], metal, rough, coat, coatRough, vcol, scale, tex: { base, normal, mr } (image idx), key }
export function v1Material(m, { color = null, node = '', canvas, wheel = false } = {}) {
  const raw = m.name ?? '', name = raw.replace(/\.\d+$/, '');
  const vcol = !!color;
  const rec = { name: raw, kind: KIND.plain, base: [...m.base], metal: m.metal, rough: m.rough, coat: m.clearcoat[0], coatRough: m.clearcoat[1], vcol, scale: 1, tex: { ...m.tex }, opacity: 1 };
  const set = (o) => Object.assign(rec, o);
  // the wheel's stainless (cockpitLook.js applyWheelLook: turned, polished; the wheel is not swapped by applyHullMaterials)
  if (wheel && name === 'stainless') return set({ name: 'stainless_turned', metal: 1, rough: 0.16, coat: 0.3, coatRough: 0.08, vcol: false, base: [...m.base] });
  if (node.startsWith('companion_portal')) return set({ name: 'portal', kind: KIND.plain, vcol: false });
  if (node.startsWith('companion_interior')) return set({ kind: KIND.cabin, base: [1, 1, 1, 1], vcol: true, tex: { base: m.tex.base, normal: null, mr: null } });
  if (raw === 'dodger_vinyl') return set({ kind: KIND.glass, base: [0.80, 0.84, 0.84, 1], opacity: 0.10, rough: 0.04, metal: 0, coat: 0.6, coatRough: m.clearcoat[1], vcol: false });
  // the race livery: the transom name in gold leaf with a navy drop shadow (v1's navy vinyl on gold vanished on a navy hull)
  if (node === 'name_letters') return set({ base: [0.80, 0.60, 0.22, 1], metal: 0.9, rough: 0.32, vcol: false });
  if (node === 'name_shadow') return set({ base: [...hexLinear('#1C2340'), 1], metal: 0, rough: 0.3, vcol: false });
  if (SWAPPED.has(name)) {
    const white = WHITE_DATA_ALBEDO[name] != null && whiteData(color);
    const scale = white ? WHITE_DATA_ALBEDO[name] : 1;
    switch (name) {
      case 'gelcoat': return set({ kind: KIND.gelcoat, base: [1, 1, 1, 1], metal: 0, rough: 0.2, coat: 0.55, coatRough: 0.07, vcol: true, scale, tex: { base: null, normal: null, mr: null } });
      case 'nonskid': return set({ kind: KIND.nonskid, base: [1, 1, 1, 1], metal: 0, rough: 0.62, coat: 0, coatRough: 0, vcol: true, scale, tex: { base: null, normal: null, mr: null } });
      case 'antifouling': return set({ kind: KIND.antifouling, base: [1, 1, 1, 1], metal: 0, rough: 0.9, coat: 0, coatRough: 0, vcol: true, tex: { base: null, normal: null, mr: null } });
      case 'teak_deck': return set({ kind: KIND.teak, base: [1, 1, 1, 1], metal: 0, rough: 0.8, coat: 0, coatRough: 0, vcol: true, tex: { base: null, normal: null, mr: null } });
      case 'gelcoat_plain': return set({ base: [0.80, 0.79, 0.755, 1], metal: 0, rough: 0.2, coat: 0.55, coatRough: 0.07, vcol: false });
      case 'acrylic': return set({ base: [0.010, 0.0135, 0.016, 1], metal: 0, rough: 0.05, coat: 1, coatRough: 0.03, vcol: false });
      case 'stainless': return set({ kind: KIND.stainless, base: [0.58, 0.575, 0.56, 1], metal: 1, rough: 0.2, coat: 0, coatRough: 0, vcol: false });
      case 'near_chrome': return set({ base: [0.66, 0.66, 0.67, 1], metal: 1, rough: 0.07, coat: 0, coatRough: 0, vcol: false });
      case 'aluminium': return set({ base: [0.78, 0.79, 0.80, 1], metal: 1, rough: 0.36, coat: 0, coatRough: 0, vcol: false });
    }
  }
  // canvas.js: the canvas variant's colours on the dodger, its trim, the cushions (and the bimini's boot), the piping, the shade
  if (raw === 'canvas') set({ base: [...canvas.canvas, 1] });
  else if (raw === 'dodger_trim') set({ base: [...canvas.trim, 1] });
  else if (raw.startsWith('canvas_cushion')) set({ base: [...canvas.canvas, 1] });
  else if (raw.startsWith('canvas_piping')) set({ base: [...canvas.trim, 1] });
  else if (raw === 'dodger_shade') set({ base: [...canvas.shade, 1] });
  return rec;
}
// cockpitLook.js sideWindows: the dodger's side panels as smoked vinyl (owner 2026-11-08: a kayak 20–35° off the bow)
export const SIDE_WINDOW = Object.freeze({ nx: 0.55, y: [0.9, 2.22], z: [0.16, 1.3], opacity: 0.22 });
const SIDE_MAT = Object.freeze({ name: 'dodger_side_window', kind: KIND.glass, base: [0.18, 0.2, 0.21, 1], metal: 0, rough: 0.06, coat: 0, coatRough: 0, vcol: false, scale: 1, tex: { base: null, normal: null, mr: null }, opacity: SIDE_WINDOW.opacity });

const recKey = (r) => JSON.stringify([r.name.replace(/\.\d+$/, ''), r.kind, r.base, r.metal, r.rough, r.coat, r.coatRough, r.vcol, r.scale, r.tex, r.opacity]);

// v1's small parts' LOD (hullMaterials.js hullDetailLod): hidden past 24 m
export const DETAIL_NAMES = Object.freeze(['stainless_detail', 'anchor_chain', 'ladder_treads', 'hull_trim']);

// --- small geometry for v1's throttle stand-in (Boat.js placeholder 'throttle': a pod, a lever, a knob) ---------------
function boxPrim(sx, sy, sz, [cx, cy, cz]) {
  const P = [], N = [], I = [];
  const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
  const h = [sx / 2, sy / 2, sz / 2];
  for (const [n, u, v] of faces) {
    const b = P.length / 3;
    for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      for (let k = 0; k < 3; k++) P.push([cx, cy, cz][k] + (n[k] + a * u[k] + c * v[k]) * h[k]);
      N.push(...n);
    }
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { P, N, I };
}
// the king spoke's sleeve on the wheel's rim (its own frame: the rim in the x-y plane round the axle, z the axle): a tube of
// radius `tube` round the rim's centre line (radius R) from the top (90°) ± half deg
export const WHEEL_MARK = Object.freeze({ R: 0.391, tube: 0.023, half: 8, hex: '#EFE6D2' });
export function rimSleevePrim({ R, tube, half }, segA = 10, segT = 8) {
  const P = [], N = [], I = [];
  for (let i = 0; i <= segA; i++) {
    const a = (90 - half + 2 * half * i / segA) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= segT; j++) {
      const b = 2 * Math.PI * j / segT, nr = Math.cos(b), nz = Math.sin(b);   // round the tube: out along the radius, along the axle
      N.push(ca * nr, sa * nr, nz); P.push(ca * (R + tube * nr), sa * (R + tube * nr), tube * nz);
    }
  }
  for (let i = 0; i < segA; i++) for (let j = 0; j < segT; j++) { const a = i * (segT + 1) + j, b = a + 1, c = a + segT + 1, d = c + 1; I.push(a, c, b, b, c, d); }
  // the ends capped (a flat disc each), so the sleeve reads as a band, not a hollow tube
  for (const i of [0, segA]) {
    const a = (90 - half + 2 * half * i / segA) * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), t = [-sa, ca, 0], s = i ? 1 : -1, c0 = P.length / 3;
    P.push(ca * R, sa * R, 0); N.push(t[0] * s, t[1] * s, 0);
    for (let j = 0; j <= segT; j++) { const b = 2 * Math.PI * j / segT, nr = Math.cos(b), nz = Math.sin(b); P.push(ca * (R + tube * nr), sa * (R + tube * nr), tube * nz); N.push(t[0] * s, t[1] * s, 0); }
    for (let j = 0; j < segT; j++) I.push(c0, c0 + 1 + j, c0 + 2 + j);
  }
  return { P, N, I };
}
function roundPrim(r, h, [cx, cy, cz], { seg = 8, sphere = false } = {}) {   // an 8-sided prism along y, or a low sphere
  const P = [], N = [], I = [];
  const rings = sphere ? 6 : 1;
  for (let j = 0; j <= rings; j++) {
    const phi = sphere ? Math.PI * j / rings : 0, y = sphere ? -Math.cos(phi) * r : (j - 0.5) * h, rr = sphere ? Math.sin(phi) * r : r;
    for (let i = 0; i <= seg; i++) {
      const a = 2 * Math.PI * i / seg, x = Math.cos(a), z = Math.sin(a);
      P.push(cx + x * rr, cy + y, cz + z * rr);
      if (sphere) N.push(x * Math.sin(phi), -Math.cos(phi), z * Math.sin(phi)); else N.push(x, 0, z);
    }
  }
  for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1; I.push(a, c, b, b, c, d); }
  return { P, N, I };
}

// --- the build ---------------------------------------------------------------------------------------------------------
// glbs: { hull, cockpit, hardware, wheel } parsed (engine/gltf.js parseGlb); dims: src/sim/boat/dims.js (HULL: freeboard,
// anchorPin, throttle); canvas: { canvas, trim } hex (canvas.json's variant)
export function buildBoatModels(glbs, { dims, canvas }) {
  const H = dims.HULL;
  const cc = canvasColours(canvas);
  const records = [], recIndex = new Map();
  const images = [], imageIndex = new Map();
  const layerOf = (file, img, array) => {
    if (img == null) return -1;
    const k = `${file}:${img}:${array}`;
    if (!imageIndex.has(k)) images.push({ file, image: img, array, layer: images.filter((i) => i.array === array).length }), imageIndex.set(k, images[images.length - 1].layer);
    return imageIndex.get(k);
  };
  const matId = (rec, file) => {
    const k = recKey(rec);
    if (!recIndex.has(k)) { recIndex.set(k, records.length); records.push({ ...rec, file }); }
    return recIndex.get(k);
  };
  // gathered triangles per range: { P, N, UV, C, M, I } (plain arrays, flattened at the end)
  const bins = Object.fromEntries(RANGES.map((r) => [r, { P: [], N: [], UV: [], C: [], M: [], I: [], tris: 0 }]));
  const tmp = new Float32Array(16);
  // add a primitive's vertices (transformed by the 4 × 4 `m`) with its material, into a range (or split by a face test)
  // remat (the livery): a face test (centroid, unit normal) → true puts the triangle on remat.mat, its vertices' uv from remat.uv(p)
  function addPrim(range, prim, m, mid, split = null, drop = null, remat = null) {
    const P = prim.attributes.POSITION, Nn = prim.attributes.NORMAL, T = prim.attributes.TEXCOORD_0, C = prim.attributes.COLOR_0;
    const idx = prim.indices ? prim.indices.array : Uint32Array.from({ length: P.count }, (_, i) => i);
    // the normal matrix: the inverse transpose of the upper 3 × 3 (any node scale; a uniform one only rescales)
    const a = m[0], b = m[1], c = m[2], d = m[4], e = m[5], f = m[6], g = m[8], h = m[9], k = m[10];
    const A = e * k - f * h, B = -(d * k - f * g), Cc = d * h - e * g;
    const D = -(b * k - c * h), E = a * k - c * g, F = -(a * h - b * g);
    const G = b * f - c * e, Hh = -(a * f - c * d), K = a * e - b * d;
    const xf = (out, i) => {
      const x = P.array[i * 3], y = P.array[i * 3 + 1], z = P.array[i * 3 + 2];
      out.push(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]);
    };
    const target = (r) => bins[r];
    const map = new Map();   // per target range: source vertex → new index
    const vert = (bin, i, mm) => {
      const key = `${bin === bins[range] ? range : 'split'}:${i}:${mm}`;   // a vertex shared by two materials is written twice (the material is flat per triangle)
      if (map.has(key)) return map.get(key);
      const v = bin.P.length / 3;
      xf(bin.P, i);
      if (Nn) { const x = Nn.array[i * 3], y = Nn.array[i * 3 + 1], z = Nn.array[i * 3 + 2]; const nx = A * x + D * y + G * z, ny = B * x + E * y + Hh * z, nz = Cc * x + F * y + K * z, l = Math.hypot(nx, ny, nz) || 1; bin.N.push(nx / l, ny / l, nz / l); } else bin.N.push(0, 1, 0);
      if (remat && mm === remat.mat) { const n = bin.P.length; bin.UV.push(...remat.uv(bin.P[n - 3], bin.P[n - 2], bin.P[n - 1])); }
      else if (T) bin.UV.push(T.array[i * 2], T.array[i * 2 + 1]); else bin.UV.push(0, 0);
      if (C) { for (let q = 0; q < 4; q++) bin.C.push(Math.round(Math.max(0, Math.min(1, q < C.size ? C.array[i * C.size + q] : 1)) * 255)); } else bin.C.push(255, 255, 255, 255);
      bin.M.push(mm);
      map.set(key, v);
      return v;
    };
    for (let t = 0; t < idx.length; t += 3) {
      let bin = target(range), mm = mid;
      if (drop) { const p = []; for (let q = 0; q < 3; q++) xf(p, idx[t + q]); if (drop(p)) continue; }
      if (split) {
        const p = [], q = [idx[t], idx[t + 1], idx[t + 2]];
        for (const i of q) xf(p, i);
        const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
        const cy = (p[1] + p[4] + p[7]) / 3, cz = (p[2] + p[5] + p[8]) / 3;
        if (split(Math.abs(nx / l), cy, cz)) { bin = bins.glass; mm = split.mat; }
      }
      if (remat) {
        const p = []; for (let q = 0; q < 3; q++) xf(p, idx[t + q]);
        const ux = p[3] - p[0], uy = p[4] - p[1], uz = p[5] - p[2], vx = p[6] - p[0], vy = p[7] - p[1], vz = p[8] - p[2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
        const c = [(p[0] + p[3] + p[6]) / 3, (p[1] + p[4] + p[7]) / 3, (p[2] + p[5] + p[8]) / 3];
        // the face's outward direction: the mean of its vertex normals (the surface's, not a sliver's geometric normal; the winding
        // alone does not say which side is out); the geometric normal without them
        let fn = [nx / l, ny / l, nz / l];
        if (Nn) { let sx = 0, sy = 0, sz = 0; for (let q = 0; q < 3; q++) { const i = idx[t + q]; const x = Nn.array[i * 3], y = Nn.array[i * 3 + 1], z = Nn.array[i * 3 + 2]; sx += A * x + D * y + G * z; sy += B * x + E * y + Hh * z; sz += Cc * x + F * y + K * z; } const sl = Math.hypot(sx, sy, sz); if (sl > 1e-6) fn = [sx / sl, sy / sl, sz / sl]; }
        if (remat.test(c, fn)) mm = remat.mat;
      }
      const i0 = vert(bin, idx[t], mm), i1 = vert(bin, idx[t + 1], mm), i2 = vert(bin, idx[t + 2], mm);
      bin.I.push(i0, i1, i2); bin.tris++;
    }
    void tmp;
  }
  const offset = (x, y, z) => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; m[12] = x; m[13] = y; m[14] = z; return m; };
  const invRT = (w) => {   // the inverse of a rotation + translation (+ uniform scale) matrix
    const s2 = w[0] * w[0] + w[1] * w[1] + w[2] * w[2] || 1, o = new Float32Array(16);
    o[0] = w[0] / s2; o[1] = w[4] / s2; o[2] = w[8] / s2; o[4] = w[1] / s2; o[5] = w[5] / s2; o[6] = w[9] / s2; o[8] = w[2] / s2; o[9] = w[6] / s2; o[10] = w[10] / s2;
    o[12] = -(o[0] * w[12] + o[4] * w[13] + o[8] * w[14]); o[13] = -(o[1] * w[12] + o[5] * w[13] + o[9] * w[14]); o[14] = -(o[2] * w[12] + o[6] * w[13] + o[10] * w[14]); o[15] = 1;
    return o;
  };
  let traveller = null;
  // the race livery: the hull skin's own material (hullSkin), its uv.x the depth under the sheer (the cove stripe's datum)
  const sheerAt = sheerFn(dims);
  const liveryMat = () => matId({ name: 'hull_livery', kind: KIND.livery, base: [1, 1, 1, 1], metal: 0, rough: 0.2, coat: 0.55, coatRough: 0.07, vcol: true, scale: 1, opacity: 1, tex: { base: -1, normal: -1, mr: -1 } }, 'hull');
  const livery = { test: (c, n) => hullSkin(c, n, sheerAt), uv: (x, y, z) => [sheerAt(z) - y, 0], mat: -1 };
  // each file: its socket (Boat.js), then every mesh node by its v1 name (the packed copy's '#q' carrier is its parent's)
  const files = [
    ['hull', offset(0, 0, 0)],                     // socket 'hull' at the heel pivot
    ['cockpit', offset(0, 0, 0)],                  // socket 'cockpit'
    ['hardware', offset(0, H.freeboard, 0)],       // socket 'hardware' at [0, freeboard, 0]
    ['wheel', offset(0, 0, 0)],                    // its own frame (the wheel slot)
  ];
  for (const [file, socket] of files) {
    const g = glbs[file];
    if (!g) continue;
    const nodes = sceneNodes(g), byIndex = new Map(nodes.map((n) => [n.index, n]));
    const chain = (n) => { const names = []; for (let p = n; p; p = p.parent != null ? byIndex.get(p.parent) : null) names.push(p.name.replace(/#q$/, '')); return names; };
    const trav = file === 'cockpit' ? nodes.find((n) => n.name === 'traveller_car') : null;
    if (trav) traveller = { x0: trav.world[12], y0: trav.world[13], z0: trav.world[14] };
    for (const n of nodes) {
      if (n.mesh == null) continue;
      const names = chain(n), name = names[0];
      let range = 'always', m = mul4(socket, n.world);
      if (file === 'wheel') range = 'wheel';
      else if (names.includes('traveller_car')) { range = 'traveller'; m = mul4(invRT(trav.world), n.world); }
      else if (names.includes('lod_far')) range = 'far';
      else if (names.includes('lod_near')) range = name.startsWith('companion_interior') ? 'cabin' : name.startsWith('companion_portal') ? 'portal' : 'near';
      else if (DETAIL_NAMES.includes(name)) range = 'detail';
      // the stowed anchor rides its socket (body.js: hardware.glb's anchor moves to HULL.anchorPin, position 0)
      if (file === 'hardware' && name === 'anchor') { range = 'anchor'; const loc = invRT(byIndex.get(n.parent ?? -1)?.name === 'anchor' ? byIndex.get(n.parent).world : n.world); const local = mul4(loc, n.world); m = mul4(offset(...H.anchorPin), local); }
      for (const prim of meshPrimitives(g, n.mesh)) {
        if (prim.mode !== 4) continue;
        const mat = materialOf(g, prim.material);
        const rec = v1Material(mat, { color: prim.attributes.COLOR_0 ?? null, node: name, canvas: cc, wheel: file === 'wheel' });
        const tex = { base: layerOf(file, rec.tex.base, 'C'), normal: layerOf(file, rec.tex.normal, 'D'), mr: layerOf(file, rec.tex.mr, 'D') };
        let r = range;
        if (rec.kind === KIND.glass) r = 'glass';
        const mid = matId({ ...rec, tex }, file);
        let split = null;
        if (file === 'cockpit' && (name === 'dodger' || name === 'dodger_shade')) {
          const W = SIDE_WINDOW;
          split = (anx, cy, cz) => anx > W.nx && cy > W.y[0] && cy < W.y[1] && cz > W.z[0] && cz < W.z[1];
          split.mat = matId({ ...SIDE_MAT, tex: { base: -1, normal: -1, mr: -1 } }, 'cockpit');
        }
        let remat = null;
        if (file === 'hull' && rec.kind === KIND.gelcoat) { if (livery.mat < 0) livery.mat = liveryMat(); remat = livery; }
        addPrim(r, prim, m, mid, split, file === 'hardware' ? oldRingDrop(name, H.freeboard) : null, remat);
      }
    }
  }
  // v1's throttle stand-in at HULL.throttle (Boat.js placeholder: lever upright at throttle 0)
  if (H.throttle) {
    const [tx, ty, tz] = H.throttle;
    const parts = [
      [boxPrim(0.06, 0.12, 0.1, [tx, ty, tz]), { name: 'throttle_pod', base: [...hexLinear(0x26292b), 1], metal: 0, rough: 0.6 }],
      [roundPrim(0.008, 0.16, [tx + 0.03, ty + 0.09, tz]), { name: 'throttle_lever', base: [...hexLinear(0xb8bcc0), 1], metal: 1, rough: 0.25 }],
      [roundPrim(0.02, 0, [tx + 0.03, ty + 0.17, tz], { sphere: true }), { name: 'throttle_knob', base: [...hexLinear(0x1d1f20), 1], metal: 0, rough: 0.6 }],
    ];
    for (const [geo, o] of parts) {
      const rec = { kind: KIND.plain, coat: 0, coatRough: 0, vcol: false, scale: 1, opacity: 1, tex: { base: -1, normal: -1, mr: -1 }, ...o };
      const prim = { attributes: { POSITION: { array: Float32Array.from(geo.P), size: 3, count: geo.P.length / 3 }, NORMAL: { array: Float32Array.from(geo.N), size: 3, count: geo.N.length / 3 } }, indices: { array: Uint32Array.from(geo.I) }, mode: 4 };
      addPrim('always', prim, offset(0, 0, 0), matId(rec, 'stand-in'));
    }
  }
  // the wheel's turn read from the Boat view (research 101 item 4): the king spoke's cream sleeve over the black leather at the
  // rim's top (WHEEL_MARK: a turk's head grown to read at 36 m), in the wheel's own frame so it turns with it
  if (glbs.wheel) {
    const geo = rimSleevePrim(WHEEL_MARK);
    const prim = { attributes: { POSITION: { array: Float32Array.from(geo.P), size: 3, count: geo.P.length / 3 }, NORMAL: { array: Float32Array.from(geo.N), size: 3, count: geo.N.length / 3 } }, indices: { array: Uint32Array.from(geo.I) } };
    addPrim('wheel', prim, offset(0, 0, 0), matId({ name: 'wheel_king_spoke', kind: KIND.plain, base: [...hexLinear(WHEEL_MARK.hex), 1], metal: 0, rough: 0.55, coat: 0, coatRough: 0, vcol: false, scale: 1, opacity: 1, tex: { base: -1, normal: -1, mr: -1 } }, 'stand-in'));
  }
  // the life ring (render/boat/lifeRing.js): the GLB's white ring and its strips were dropped above; this one is orange
  for (const { prim, rec } of buildLifeRing(H.freeboard)) addPrim('always', prim, offset(0, 0, 0), matId(rec, 'life-ring'));
  // flatten: one vertex set, the ranges in RANGES order
  let nv = 0, ni = 0;
  for (const r of RANGES) { nv += bins[r].P.length / 3; ni += bins[r].I.length; }
  const position = new Float32Array(nv * 3), normal = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), color = new Uint8Array(nv * 4), mat = new Uint32Array(nv), index = new Uint32Array(ni);
  const ranges = {}, triangles = {};
  let v0 = 0, i0 = 0;
  for (const r of RANGES) {
    const b = bins[r], n = b.P.length / 3;
    position.set(b.P, v0 * 3); normal.set(b.N, v0 * 3); uv.set(b.UV, v0 * 2); color.set(b.C, v0 * 4); mat.set(b.M, v0);
    for (let k = 0; k < b.I.length; k++) index[i0 + k] = b.I[k] + v0;
    ranges[r] = { first: i0, count: b.I.length }; triangles[r] = b.tris;
    v0 += n; i0 += b.I.length;
  }
  const materials = new Float32Array(Math.max(1, records.length) * MAT_FLOATS);
  records.forEach((r, i) => {
    const o = i * MAT_FLOATS;
    materials.set([r.base[0], r.base[1], r.base[2], r.base[3] ?? 1, r.metal, r.rough, r.coat, r.coatRough, r.kind, r.tex.base, r.tex.normal, r.tex.mr, r.vcol ? 1 : 0, r.scale ?? 1, r.opacity ?? 1, 0], o);
  });
  return { position, normal, uv, color, mat, index, ranges, triangles, vertices: nv, materials, materialNames: records.map((r) => r.name), records, images, traveller: traveller ?? { x0: 0, y0: 1.5925, z0: 0.7 } };
}
