// Regatta's props on the water (BACKLOG-v2 #12): the committee boat, the pin, the marks (W an orange inflatable cylinder, I a yellow inflatable pyramid, smooth; 2026-11-18;
// was a faceted sphere and a cylinder) and the computer boats' lite draw (a hull, a mast, a main and a jib that swing with the boom: R4 brings
// the LOD boat of § 8.4). ONE pipeline ('race-props': lit, solid, instanced), declared at load. The meshes are made once at load
// (flat-shaded triangle lists in one vertex buffer); a frame writes the instances (≤ MAX_PROPS × 64 B, one writeBuffer from a
// Float32Array made at load) and draws each mesh's run (≤ 6 draws). Opaque, before the water (the water's blend covers a hull's
// part below the waterline, as the player's boat). Outside a race nothing is recorded (stats.draws: the guard test).
//   const RP = createRaceProps({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa, depthFormat });
//   RP.setActive(on); RP.begin(); RP.put(kind, x, y, z, yaw, heel, boom, colour[, label, seed, pitch]); RP.end()   once a frame in a race
//   (pitch: rad, bow up; a rival's float, regatta/rivalFloat.js, as the near boats' Rx(pitch) in render/boat.js)
//   RP.draw(pass, c)
import { ATMO_WGSL, SKY_READ } from './sky.js';
import { sailArtAtlas, sailArtOn, SAIL_ART_WGSL, CLOTH_LIN } from './sailArt.js';

export const MAX_PROPS = 32;
// the busy lake's layer (v2/living/busyLake.js): its mid and far sailboats, written with lakeBegin/lakePut/lakeEnd beside a race's or Sail's
// practice marks (their own begin/put/end), uploaded together, drawn while either has instances
export const MAX_LAKE_PROPS = 8;
// R4: 'sloop' is the fleet's MID band (the lite boat: no cloth, no shadow, a cheaper mesh, the hull in the rival's colour); 'far' its
// impostor-grade silhouette (12 triangles: a thin hull wedge and two sail triangles), past 250 m (v2/regatta/lod.js)
// 'finishFlag' (owner 2026-11-16, the guidance pass): a cream-and-navy banded flag on a staff over the committee boat's signal mast, put
// with the committee boat's pose on the race's last leg only (the finish is there)
export const PROP_KINDS = Object.freeze(['sloop', 'committee', 'pin', 'markW', 'markI', 'far', 'finishFlag']);
// an sRGB hex ('#1f2c4a') as the instance colour put() takes (rgba8, r in the low byte)
export const rgbaOf = (hex) => { const h = parseInt(String(hex).replace('#', ''), 16); return (0xff000000 | ((h & 255) << 16) | (h & 0xff00) | ((h >> 16) & 255)) >>> 0; };
// the marks forwarded to render/navAids.js (setMarkSink) and their default colours (the photos: a yellow cylinder, an orange
// tetrahedron, the dan buoy's orange float)
const MARK_KIND = Object.freeze({ markW: 'raceCyl', markI: 'raceTetra', pin: 'danBuoy' });
export const MARK_RGBA = Object.freeze({ markW: rgbaOf('#f2c21b'), markI: rgbaOf('#f2601a'), pin: rgbaOf('#f05a14') });
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128, VERTEX: 32 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
const VF = 8;   // a vertex: position, normal, the colour slot, the part (0 fixed, 1 the main on the mast, 2 the jib on the forestay, 3 a flag: cloth, fixed)

// ---- the meshes (local frame: x starboard, y up, z toward the bow; metres) ----
export function buildPropMeshes() {
  const out = {};
  for (const k of PROP_KINDS) {
    const v = [];
    const tri = (a, b, c, slot, part = 0, two = false) => {
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const l = Math.hypot(...n) || 1; n = n.map((x) => x / l);
      for (const p of [a, b, c]) v.push(p[0], p[1], p[2], n[0], n[1], n[2], slot, part);
      if (two) for (const p of [a, c, b]) v.push(p[0], p[1], p[2], -n[0], -n[1], -n[2], slot, part);
    };
    const quad = (a, b, c, d, slot, part = 0) => { tri(a, b, c, slot, part); tri(a, c, d, slot, part); };
    const box = (cx, cy, cz, sx, sy, sz, slot, part = 0) => {
      const x0 = cx - sx / 2, x1 = cx + sx / 2, y0 = cy - sy / 2, y1 = cy + sy / 2, z0 = cz - sz / 2, z1 = cz + sz / 2;
      quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], slot, part); quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], slot, part);
      quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], slot, part); quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], slot, part);
      quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], slot, part); quad([x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], slot, part);
    };
    // a hull lofted through stations (z, half beam, sheer height, keel depth); the deck closes it
    const hull = (st, slot, deckSlot) => {
      for (let i = 1; i < st.length; i++) {
        const [za, ba, ha, ka] = st[i - 1], [zb, bb, hb, kb] = st[i];
        for (const s of [1, -1]) {
          const A = [s * ba, ha, za], B = [s * bb, hb, zb], C = [s * bb * 0.55, -kb, zb], D = [s * ba * 0.55, -ka, za], K0 = [0, -ka * 1.15, za], K1 = [0, -kb * 1.15, zb];
          if (s > 0) { quad(A, D, C, B, slot); quad(D, K0, K1, C, slot); tri(A, B, [0, hb, zb], deckSlot); tri(A, [0, hb, zb], [0, ha, za], deckSlot); }
          else { quad(A, B, C, D, slot); quad(D, C, K1, K0, slot); tri(A, [0, ha, za], [0, hb, zb], deckSlot); tri(A, [0, hb, zb], B, deckSlot); }
        }
      }
      const [z0, b0, h0, k0] = st[0];   // the transom
      quad([b0, h0, z0], [-b0, h0, z0], [-b0 * 0.55, -k0, z0], [b0 * 0.55, -k0, z0], slot);
    };
    // smooth shading (the 2026-11-18 marks): a lathe about the y axis through a profile [[r, y], …] bottom to top, its normals from the
    // profile's slope, n segments round; a band [y0, y1] of the profile may take another slot
    const lathe = (cx, cz, prof, n, slot, band = null) => {
      const N = prof.map((q, i) => { const a = prof[Math.max(0, i - 1)], b = prof[Math.min(prof.length - 1, i + 1)], tr = b[0] - a[0], ty = b[1] - a[1], l = Math.hypot(tr, ty) || 1; return [ty / l, -tr / l]; });
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * 2 * Math.PI, a1 = ((i + 1) / n) * 2 * Math.PI;
        for (let j = 0; j + 1 < prof.length; j++) {
          const P = (a, k) => [cx + Math.cos(a) * prof[k][0], prof[k][1], cz + Math.sin(a) * prof[k][0]], Nn = (a, k) => [Math.cos(a) * N[k][0], N[k][1], Math.sin(a) * N[k][0]];
          const sl = band && (prof[j][1] + prof[j + 1][1]) / 2 > band[0] && (prof[j][1] + prof[j + 1][1]) / 2 < band[1] ? band[2] : slot;
          const q = [[a0, j], [a0, j + 1], [a1, j + 1], [a1, j]];
          for (const [x, y, z] of [[0, 1, 2], [0, 2, 3]]) for (const k of [x, y, z]) { const pp = P(q[k][0], q[k][1]), nn = Nn(q[k][0], q[k][1]); v.push(pp[0], pp[1], pp[2], nn[0], nn[1], nn[2], sl, 0); }
        }
      }
    };
    const flag = (x, y, z, w, h, slot) => tri([x, y, z], [x, y - h, z], [x, y - h / 2, z - w], slot, 3, true);   // part 3: cloth (lit through), fixed
    if (k === 'sloop') {   // 8.6 m: v1's sloop's length overall; slots 0 the hull's colour, 1 sail cloth, 2 spars, 4 the deck
      hull([[-4.3, 1.25, 0.75, 0.45], [-2.4, 1.42, 0.78, 0.6], [0, 1.45, 0.8, 0.7], [2.2, 1.2, 0.88, 0.55], [3.6, 0.6, 0.98, 0.35], [4.3, 0.02, 1.05, 0.15]], 0, 4);
      box(0, 0.4, -0.2, 0.18, 1.6, 2.2, 2);   // the keel's fin below the water
      box(0, 6.4, 0.9, 0.14, 11.2, 0.14, 2);  // the mast, 0.9 m forward of amidships
      box(0, 1.55, -0.7, 0.1, 0.1, 3.2, 2, 1);  // the boom
      tri([0, 1.6, 0.85], [0, 11.7, 0.85], [0, 1.6, -2.3], 1, 1, true);   // the main, on the boom's part
      tri([0, 1.15, 4.1], [0, 10.4, 0.95], [0, 1.25, 1.2], 1, 2, true);   // the jib, on the forestay's part
    } else if (k === 'committee') {   // R4: a 10.5 m race-committee launch, cheapest first (≈ 300 triangles, one draw in the props' run)
      // the hull: a motor launch's flared topsides (the hull() loft: the sheer's half beam over a 0.55 chine), a fine entry, a flat run aft
      hull([[-5.2, 1.70, 1.15, 0.35], [-3.6, 1.82, 1.18, 0.42], [-1.2, 1.86, 1.22, 0.48], [1.4, 1.72, 1.30, 0.46], [3.4, 1.20, 1.45, 0.36], [4.7, 0.42, 1.62, 0.22], [5.3, 0.04, 1.70, 0.12]], 0, 4);
      box(0, 1.24, -5.55, 3.0, 0.08, 0.75, 4);          // the swim platform at the transom
      box(0, 1.20, 1.6, 3.2, 0.07, 6.6, 4);             // the deck's sheer strake (a lighter band at the gunwale)
      // the wheelhouse: a white house, dark windows all round (slot 5), a hard top with its rail
      box(0, 2.15, -0.9, 2.5, 1.85, 3.4, 4);
      box(0, 2.45, 0.83, 2.2, 0.75, 0.04, 5);           // the windscreen
      box(1.26, 2.45, -0.9, 0.04, 0.7, 2.8, 5); box(-1.26, 2.45, -0.9, 0.04, 0.7, 2.8, 5);   // the side windows
      box(0, 2.45, -2.62, 2.0, 0.6, 0.04, 5);           // the aft window
      box(0, 3.13, -0.9, 2.8, 0.1, 3.9, 4);             // the hard top
      for (const x of [-1.3, 1.3]) box(x, 3.45, -0.9, 0.05, 0.05, 3.6, 2);   // the top's rails
      for (const [x, z] of [[-1.3, 0.85], [1.3, 0.85], [-1.3, -2.65], [1.3, -2.65]]) box(x, 3.3, z, 0.05, 0.34, 0.05, 2);
      // the signal mast on the top: the orange committee flag and a blue one (the race's class flag) on a yard
      box(0, 4.6, -1.4, 0.09, 3.0, 0.09, 2);
      box(0, 5.6, -1.4, 1.9, 0.06, 0.06, 2);
      flag(0.85, 5.55, -1.4, 1.0, 0.7, 3); flag(-0.85, 5.55, -1.4, 1.0, 0.7, 6);
      flag(0, 6.05, -1.4, 0.9, 0.55, 3);
      // the bow rail and the anchor's roller
      for (const sx of [-1, 1]) box(sx * 0.95, 1.85, 3.2, 0.04, 0.04, 2.6, 2);
      box(0, 1.75, 5.1, 0.18, 0.12, 0.5, 2);
    } else if (k === 'far') {   // R4: the far band's silhouette: 12 triangles (slot 0 the hull's colour, 1 the cloth, parts 1 and 2 swing)
      const h0 = 0.9, k0 = -0.3, b = 1.3;
      quad([b, h0, -4.3], [0, h0, 4.3], [0, k0, 4.0], [b * 0.6, k0, -4.0], 0); quad([-b, h0, -4.3], [-b * 0.6, k0, -4.0], [0, k0, 4.0], [0, h0, 4.3], 0);
      quad([b, h0, -4.3], [b * 0.6, k0, -4.0], [-b * 0.6, k0, -4.0], [-b, h0, -4.3], 0);
      tri([b, h0, -4.3], [-b, h0, -4.3], [0, h0, 4.3], 4);
      tri([0, 1.6, 0.85], [0, 11.7, 0.85], [0, 1.6, -2.3], 1, 1, true);
      tri([0, 1.15, 4.1], [0, 10.4, 0.95], [0, 1.25, 1.2], 1, 2, true);
    } else if (k === 'pin') {   // the pin (2026-11-18): a round orange float with a dark collar, its pole and flag (smooth, 24 round)
      const fl = []; for (let i = 0; i <= 10; i++) { const a = -Math.PI / 2 + (i / 10) * Math.PI; fl.push([Math.max(0.0, Math.cos(a) * 0.62), 0.25 + Math.sin(a) * 0.55]); }
      fl[0][0] = 0; fl[10][0] = 0;
      lathe(0, 0, fl, 24, 3, [0.05, 0.3, 5]);
      lathe(0, 0, [[0.07, 0.75], [0.06, 3.8], [0, 3.85]], 8, 2);
      flag(0, 3.8, 0, 1.1, 0.75, 3);
    } else if (k === 'finishFlag') {   // the staff from the signal mast's top, a 1.8 × 1.2 m flag in four bands (cream, navy, cream, navy)
      box(0, 7.0, -1.4, 0.07, 2.4, 0.07, 2);
      const top = 8.1, bh = 0.3, w = 1.8;
      for (let i = 0; i < 4; i++) { const y0 = top - i * bh, y1 = y0 - bh, sl = i % 2 ? 8 : 7; tri([0, y0, -1.4], [0, y1, -1.4], [0, y1, -1.4 - w], sl, 3, true); tri([0, y0, -1.4], [0, y1, -1.4 - w], [0, y0, -1.4 - w], sl, 3, true); }
    } else if (k === 'markW') {   // 2026-11-18: an inflatable racing mark, a tall orange cylinder with rounded ends and a cream band (top 1.95 m: the lantern)
      const r = 0.72, top = 1.95, sh = 0.22, pr = [[0, -0.45], [r * 0.9, -0.42], [r, -0.3], [r, top - sh]];
      for (let i = 1; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pr.push([r - sh + Math.cos(a) * sh, top - sh + Math.sin(a) * sh]); }
      pr.push([0, top]);
      lathe(0, 0, pr.flatMap((q, i) => (i === 3 ? [[r, 1.05], [r, 1.15], [r, 1.4], [r, 1.5], q] : [q])), 32, 3, [1.15, 1.4, 7]);
    } else if (k === 'markI') {   // 2026-11-18: an inflatable racing pyramid, yellow, tall and rounded (top 2.25 m: the lantern)
      const pr = [[0, -0.4], [0.95, -0.35], [1.0, -0.1], [0.98, 0.1]];
      for (let i = 1; i <= 8; i++) { const f = i / 8; pr.push([0.98 * (1 - f) + 0.08 * f, 0.1 + 2.0 * f]); }
      pr.push([0.04, 2.23], [0, 2.25]);
      lathe(0, 0, pr, 32, 9);
    }
    out[k] = new Float32Array(v);
  }
  return out;
}

export const RACE_PROPS_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
@group(2) @binding(0) var<storage, read> I: array<vec4f>;   // per instance: (x, y, z, yaw), (heel, boom, pitch, 0), (rgba8 bits, 0, 0, 0), the main's print (render/sailArt.js packArt; 0: none)
// the mainsail's graphics on the lite boats (2026-11-18): the near boats' print, the same atlas and composer, read at its small mips
@group(2) @binding(1) var tArt: texture_2d<f32>;
@group(2) @binding(2) var sArt: sampler;
${SAIL_ART_WGSL}
const CLOTHS = array<vec3f, 6>(${CLOTH_LIN.map((c) => `vec3f(${c.join(', ')})`).join(', ')});
struct PV { @builtin(position) pos: vec4f, @location(0) n: vec3f, @location(1) @interpolate(flat) col: vec3f, @location(2) @interpolate(flat) cloth: f32, @location(3) wp: vec3f, @location(4) yl: f32, @location(5) @interpolate(flat) hull: f32, @location(6) sm: vec2f, @location(7) @interpolate(flat) art: vec4f, @location(8) @interpolate(flat) pn: vec3f }
fn unpackCol(u: u32) -> vec3f { return vec3f(f32(u & 255u), f32((u >> 8u) & 255u), f32((u >> 16u) & 255u)) / 255.0; }
fn spin(p: vec3f, a: f32, pivotZ: f32) -> vec3f { let q = vec3f(p.x, p.y, p.z - pivotZ); let c = cos(a); let s = sin(a); return vec3f(q.x * c + q.z * s, q.y, -q.x * s + q.z * c + pivotZ); }
@vertex fn vs(@location(0) p0: vec3f, @location(1) n0: vec3f, @location(2) slot: f32, @location(3) part: f32, @builtin(instance_index) ii: u32) -> PV {
  var o: PV;
  let a = I[4u * ii]; let b = I[4u * ii + 1u]; let c = I[4u * ii + 2u];
  var pn = vec3f(-1.0, 0.0, 0.0);   // the main's port normal (the side seen picks the face's print; both coincident faces agree)
  var p = p0; var n = n0;
  if (part > 0.5 && part < 1.5) { p = spin(p, b.y, 0.85); n = spin(n, b.y, 0.0); pn = spin(pn, b.y, 0.0); }
  else if (part > 1.5 && part < 2.5) { p = spin(p, b.y * 0.8, 4.1); n = spin(n, b.y * 0.8, 0.0); }
  // the heel: a roll about the bow-stern axis (+: the starboard side goes down)
  let ch = cos(b.x); let sh = sin(b.x);
  p = vec3f(p.x * ch + p.y * sh, -p.x * sh + p.y * ch, p.z); n = vec3f(n.x * ch + n.y * sh, -n.x * sh + n.y * ch, n.z); pn = vec3f(pn.x * ch + pn.y * sh, -pn.x * sh + pn.y * ch, pn.z);
  // the pitch after the heel (render/boat.js: Ry(-heading) Rx(pitch) Rz(-heel)): + the bow (local +z) up
  let cp = cos(b.z); let sp = sin(b.z);
  p = vec3f(p.x, p.y * cp + p.z * sp, -p.y * sp + p.z * cp); n = vec3f(n.x, n.y * cp + n.z * sp, -n.y * sp + n.z * cp); pn = vec3f(pn.x, pn.y * cp + pn.z * sp, -pn.y * sp + pn.z * cp);
  // the heading: local +z to (sin h, −cos h), local +x to (cos h, sin h)
  let cy = cos(a.w); let sy = sin(a.w);
  let w = vec3f(p.x * cy + p.z * sy, p.y, p.x * sy - p.z * cy) + a.xyz;
  o.n = vec3f(n.x * cy + n.z * sy, n.y, n.x * sy - n.z * cy);
  o.pn = vec3f(pn.x * cy + pn.z * sy, pn.y, pn.x * sy - pn.z * cy);
  // the main's own metres (the near boats' frame: along the chord from the luff, up the luff), its 10.1 m luff on the near sail's 9.45 m
  let isMain = part > 0.5 && part < 1.5 && slot > 0.5 && slot < 1.5;
  o.sm = vec2f(0.85 - p0.z, (p0.y - 1.6) * ${(9.4488 / 10.1).toFixed(5)});
  o.art = select(vec4f(0.0), I[4u * ii + 3u], isMain);
  o.pos = F.viewProj * vec4f(w, 1.0);
  o.wp = w; o.yl = p0.y; o.hull = select(0.0, 1.0, slot < 0.5);
  var col = unpackCol(bitcast<u32>(c.x));
  if (slot > 0.5 && slot < 1.5) { col = vec3f(0.86, 0.85, 0.80); }        // sail cloth
  else if (slot > 1.5 && slot < 2.5) { col = vec3f(0.18, 0.18, 0.20); }   // spars
  else if (slot > 2.5 && slot < 3.5) { col = vec3f(0.95, 0.30, 0.03); }   // v1's orange (the marks, the pin, the flag)
  else if (slot > 3.5 && slot < 4.5) { col = vec3f(0.72, 0.70, 0.66); }   // the deck and the cabin
  else if (slot > 4.5 && slot < 5.5) { col = vec3f(0.035, 0.045, 0.06); }  // R4: the wheelhouse's dark glass
  else if (slot > 5.5 && slot < 6.5) { col = vec3f(0.06, 0.22, 0.62); }    // R4: the blue flag
  else if (slot > 6.5 && slot < 7.5) { col = vec3f(0.93, 0.88, 0.74); }    // the finish flag's cream
  else if (slot > 7.5 && slot < 8.5) { col = vec3f(0.035, 0.055, 0.16); }  // the finish flag's navy
  else if (slot > 8.5) { col = vec3f(0.98, 0.72, 0.04); }                   // 2026-11-18: the yellow inflatable mark
  o.col = col;
  o.cloth = select(0.0, 1.0, (slot > 0.5 && slot < 1.5) || part > 2.5);   // the sails and the flags (part 3)
  return o;
}
@fragment fn fs(v: PV) -> @location(0) vec4f {
  // the side seen (2026-11-18): the normal turned toward the eye (front_facing's winding read the decks, the sails' backs and the
  // buoys' tops from above as their undersides: black)
  var n = normalize(v.n); if (dot(n, F.cam.xyz - v.wp) < 0.0) { n = -n; }
  // a hull's colour on its topsides only, white above and below (the near boats' tint band, render/boat.js topsides): the colour
  // stays with the boat when she changes detail
  var col = v.col;
  // the mainsail's graphics: the cloth, the near face's print (one face: at this size the show-through is under a pixel)
  let gr = vec4f(dpdx(v.sm.x), dpdy(v.sm.x), dpdx(v.sm.y), dpdy(v.sm.y));
  if (v.art.x > 0.5) {
    let code = u32(v.art.x + 0.5) - 1u;
    col = CLOTHS[min(code % 16u, 5u)];
    var ink = artInk(v.sm.x, v.sm.y, dot(v.pn, F.cam.xyz - v.wp) < 0.0, v.art.w, gr);
    ink.y *= f32(code / 16u) * 0.01;
    col = mix(col, artInkC(vec3f(v.art.z, 0.0, 0.0)), ink.y);
    col = mix(col, artInkC(vec3f(v.art.y, 0.0, 0.0)), ink.x);
  }
  if (v.hull > 0.5) { col = mix(vec3f(0.80, 0.77, 0.70), v.col, smoothstep(0.112, 0.124, v.yl)); }   // the race livery: a cream boot top, the colour from it to the sheer (boat.js topsides)
  let d = dot(n, normalize(F.sun.xyz));
  // R4: the cloth lets the sun through from behind (v1's sails: the panel is bright, not black, on its shade side) and takes the sky on
  // both faces: the lite boats' backlit sails read cream like the near boats', not dark
  // 2026-11-18: the solids' shade side keeps a soft wrap of the sun and more of the sky (with the normal turned to the eye, a backlit
  // hull or a buoy's far half read black under plain Lambert)
  let sun = mix((max(d + 0.35, 0.0)) / 1.35, max(d, 0.0) + 0.9 * max(-d, 0.0), v.cloth);
  let sky = mix(0.72 + 0.28 * n.y, 1.1, v.cloth);
  let light = LIGHT.sky.rgb * sky + LIGHT.sun.rgb * sun;
  return vec4f(col * light / PI, 1.0);
}`;

export function createRaceProps({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa = 1, depthFormat = 'depth32float', sailArt = null }) {
  const meshes = buildPropMeshes();
  const runs = {}; let total = 0;
  for (const k of PROP_KINDS) { runs[k] = { first: total, count: meshes[k].length / VF }; total += meshes[k].length / VF; }
  const all = new Float32Array(total * VF); for (const k of PROP_KINDS) all.set(meshes[k], runs[k].first * VF);
  const vbuf = device.createBuffer({ label: 'race-props-mesh', size: all.byteLength, usage: BUF.VERTEX | BUF.COPY_DST });
  device.queue.writeBuffer(vbuf, 0, all);
  const inst = new Float32Array(MAX_PROPS * 16), instU = new Uint32Array(inst.buffer);
  const atlas = sailArtAtlas(device, sailArtOn(sailArt)), artOf = new Float32Array((MAX_PROPS + MAX_LAKE_PROPS) * 4), artTable = [];   // the lite mains' print (setArt)
  const ibuf = device.createBuffer({ label: 'race-props', size: inst.byteLength, usage: BUF.STORAGE | BUF.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'race-props', entries: [{ binding: 0, visibility: STAGE.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: STAGE.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } }, { binding: 2, visibility: STAGE.FRAGMENT, sampler: { type: 'filtering' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ibuf } }, { binding: 1, resource: atlas.view }, { binding: 2, resource: atlas.sampler }] });
  const m = reg.shader('race-props', RACE_PROPS_WGSL(frameStruct));
  reg.add('race-props', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }),
    vertex: { module: m, entryPoint: 'vs', buffers: [{ arrayStride: VF * 4, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }, { shaderLocation: 2, offset: 24, format: 'float32' }, { shaderLocation: 3, offset: 28, format: 'float32' }] }] },
    fragment: { module: m, entryPoint: 'fs', targets: [hdrTarget] }, primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: depthFormat, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: msaa } });
  // this frame's instances, grouped by kind (each kind's run drawn with its firstInstance)
  const byKind = Object.fromEntries(PROP_KINDS.map((k) => [k, { first: 0, n: 0 }]));
  const NQ = MAX_PROPS + MAX_LAKE_PROPS, scratch = new Float32Array(NQ * 7), kindOf = new Uint8Array(NQ), colours = new Uint32Array(NQ); let nq = 0, nl = 0, sink = null;   // made once (the lake's entries from MAX_PROPS)
  const stats = { active: false, lake: 0, instances: 0, total: 0, draws: 0, lakeDraws: 0, uploads: 0, vertices: total, meshBytes: all.byteLength, instBytes: inst.byteLength };
  return {
    stats, meshes, runs,
    get active() { return stats.active; },
    setActive(on) { stats.active = !!on; if (!on) { nq = 0; sink?.raceClear(); upload(); } },
    // the race marks on the channel buoys' pipeline (render/navAids.js: the inflatable cylinder, the tetrahedron, the dan buoy; the
    // race fixes round 2, owner 2026-11-18); without one (no channel marks on these waters) the meshes above
    setMarkSink(na) { sink = na ?? null; },
    get markSink() { return sink; },
    // the lite mains' print: list[i] the packed record (render/sailArt.js packArt) a 'sloop' or 'far' put with label i + 1 draws
    setArt(list) { artTable.length = 0; if (atlas.on) for (const a of list ?? []) artTable.push(a); },
    get artOn() { return atlas.on; },
    begin() { nq = 0; sink?.raceBegin(); },
    // marks (markW, markI, pin) with a sink: yaw the face (the dan buoy's flag downwind), heel and boom the tilt (rad, x and z), label
    // the mark's number (+ 100 left to starboard), seed the flutter's phase
    put(kind, x, y, z, yaw = 0, heel = 0, boom = 0, rgba = 0xffffffff, label = 0, seed = 0, pitch = 0) {
      if (sink && MARK_KIND[kind]) return stats.active && sink.racePut(MARK_KIND[kind], x, y, z, yaw, heel, boom, rgba === 0xffffffff ? MARK_RGBA[kind] : rgba, label, seed);
      if (nq >= MAX_PROPS) return false;
      const art = (kind === 'sloop' || kind === 'far') && label > 0 ? artTable[label - 1] : null;
      return queue(nq++, kind, x, y, z, yaw, heel, boom, rgba, pitch, art);
    },
    // the busy lake's layer: its own entries (sloop, far), kept until its next lakeBegin; art: the main's packed print (render/sailArt.js
    // packArt) or null (plain cloth)
    lakeBegin() { nl = 0; },
    lakePut(kind, x, y, z, yaw = 0, heel = 0, boom = 0, rgba = 0xffffffff, pitch = 0, art = null) { if (nl >= MAX_LAKE_PROPS) return false; return queue(MAX_PROPS + nl++, kind, x, y, z, yaw, heel, boom, rgba, pitch, atlas.on ? art : null); },
    lakeEnd() { stats.lake = nl; upload(); },
    end() {
      if (!stats.active) return;
      sink?.raceEnd();
      upload();
    },
    draw(pass, c) {
      if (!(stats.active || stats.lake) || !stats.total) return;   // outside a race and with no lake boats: nothing recorded
      pass.setPipeline(reg.get('race-props'));
      pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
      pass.setVertexBuffer(0, vbuf);
      for (const k of PROP_KINDS) { const r = byKind[k]; if (!r.n) continue; pass.draw(runs[k].count, r.n, runs[k].first, r.first); c.calls++; c.triangles += (runs[k].count / 3) * r.n; }
      if (stats.active) stats.draws++; else stats.lakeDraws++;   // draws: a race's or the marks' passes (the guard tests); lakeDraws: the lake's alone
    },
  };
  function queue(i, kind, x, y, z, yaw, heel, boom, rgba, pitch, art = null) {
      const o = i * 7; scratch[o] = x; scratch[o + 1] = y; scratch[o + 2] = z; scratch[o + 3] = yaw; scratch[o + 4] = heel; scratch[o + 5] = boom; scratch[o + 6] = pitch;
      kindOf[i] = PROP_KINDS.indexOf(kind); colours[i] = rgba >>> 0;
      for (let j = 0; j < 4; j++) artOf[i * 4 + j] = art ? art[j] : 0;
      return true;
  }
  // the instances: a race's or the marks' (while active), then the lake's, grouped by kind
  function upload() {
      let w = 0;
      const nMain = stats.active ? nq : 0; let nm = 0;
      for (let k = 0; k < PROP_KINDS.length; k++) {
        const r = byKind[PROP_KINDS[k]]; r.first = w; r.n = 0;
        for (let j = 0; j < nMain + nl; j++) {
          const i = j < nMain ? j : MAX_PROPS + (j - nMain);
          if (kindOf[i] !== k || w >= MAX_PROPS) continue;
          const s = i * 7, o = w * 16;
          inst[o] = scratch[s]; inst[o + 1] = scratch[s + 1]; inst[o + 2] = scratch[s + 2]; inst[o + 3] = scratch[s + 3];
          inst[o + 4] = scratch[s + 4]; inst[o + 5] = scratch[s + 5]; inst[o + 6] = scratch[s + 6]; inst[o + 7] = 0;
          instU[o + 8] = colours[i]; inst[o + 9] = 0; inst[o + 10] = 0; inst[o + 11] = 0;
          inst[o + 12] = artOf[i * 4]; inst[o + 13] = artOf[i * 4 + 1]; inst[o + 14] = artOf[i * 4 + 2]; inst[o + 15] = artOf[i * 4 + 3];
          w++; r.n++; if (j < nMain) nm++;
        }
      }
      if (w) device.queue.writeBuffer(ibuf, 0, inst.buffer, 0, w * 64);
      stats.instances = nm; stats.total = w; stats.uploads++;   // instances: a race's or the marks' (the lake's: stats.lake)
  }
}
