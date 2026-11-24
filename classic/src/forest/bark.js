// Bark (art/bark): CC0 bark photos from ambientCG (ATTRIBUTION.md) packed into one albedo
// atlas and one normal atlas at load (2048 × 1024, 4 × 2 slots of 512 px), the species' own colour as a tint over
// the texture's structure, and along the trunk: a dark, dusty base, the plated mid-trunk, a greyer and smoother top,
// the crown's shadow (baked per vertex, src/forest/tree-gen.js), a fire scar on some trees, wolf lichen on the firs.
// Muted overall: real bark reads brown-grey at any distance, never orange.
//
//   import { loadBarkAtlas, barkAlbedo, barkNormal } from './forest/bark.js';
//   const bark = await loadBarkAtlas();            // → { albedo, normal, ready } (textures; ready false → the drawn fallback)
//   const { albedo, nTex } = barkAlbedo({ bark, uv, bk, ex, phase, local })   // TSL, unlit colour + the sampled normal
// The geometry's `bark` attribute: vec4(tintR, tintG, tintB, slot) on trunk vertices (zeros on the cards); `extra`:
// (aoAlongTrunk, lichenWeight, isBark = 1, 0).
import * as THREE from 'three/webgpu';
import { vec2, vec3, float, mix, smoothstep, fract, dot, max, floor, step, mx_noise_float, cross, normalize, texture } from 'three/tsl';

// slot → ambientCG set; the species → slot map lives in src/forest/species.js (bark.slot)
const BARK_SETS = ['Bark006', 'Bark007', 'Bark014', 'Bark012', 'Bark015', 'Bark009'];
const COLS = 4, ROWS = 2;
// the slot's size: 512 px (2048 x 1024 atlases, 10.7 MB each with mips); phones draw 256 (a quarter: the trees go first)
export const BARK = Object.freeze({ slot: 512, photos: true });   // photos: false (phones: the tier's bark, src/quality/apply.js) leaves the bark photos out: the drawn bark, no 1.6 MB fetch

function loadImage(src) {
  return new Promise((resolve) => { const im = new Image(); im.onload = () => resolve(im); im.onerror = () => resolve(null); im.src = src; });
}

// the two atlases; a missing file leaves its slot flat (mid grey albedo, a flat normal), so the page never waits on it
export async function loadBarkAtlas({ base = '/models/bark/', slot = BARK.slot, photos = BARK.photos } = {}) {
  if (!photos) return null;   // a phone: no atlas; barkAlbedo's null path (the species' colour and the drawn grain), nothing fetched
  const SLOT = slot;
  const mk = (fill) => { const c = document.createElement('canvas'); c.width = COLS * SLOT; c.height = ROWS * SLOT; const ctx = c.getContext('2d'); ctx.fillStyle = fill; ctx.fillRect(0, 0, c.width, c.height); return [c, ctx]; };
  const [ca, ctxA] = mk('#6e675c'), [cn, ctxN] = mk('#8080ff');
  let ready = 0;
  const jobs = BARK_SETS.map(async (id, i) => {
    const [col, nrm] = await Promise.all([loadImage(`${base}${id}_color.jpg`), loadImage(`${base}${id}_normal.jpg`)]);
    const x = (i % COLS) * SLOT, y = Math.floor(i / COLS) * SLOT;
    if (col) { ctxA.drawImage(col, x, y, SLOT, SLOT); ready++; }
    if (nrm) ctxN.drawImage(nrm, x, y, SLOT, SLOT);
  });
  await Promise.all(jobs);
  const tex = (c, srgb) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;   // slots are addressed by fract() in the shader
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.anisotropy = 4;
    return t;
  };
  return { albedo: tex(ca, true), normal: tex(cn, false), ready: ready === BARK_SETS.length, loaded: ready };
}

// the slot's uv from the trunk's unwrapped uv: u around the trunk (0 .. wraps), v the height in 6 m units; a per-tree
// offset breaks the tiling between neighbours; the mips keep the seams at fract() soft enough at a trunk's scale
export function barkUV(uv, slot, phase) {
  const u0 = slot.mod(COLS).div(COLS), v0 = floor(slot.div(COLS)).div(ROWS);
  const off = phase.mul(0.15915);
  return vec2(u0.add(fract(uv.x.add(off)).mul(0.98 / COLS).add(0.01 / COLS)), v0.add(fract(uv.y.add(off.mul(3.1))).mul(0.98 / ROWS).add(0.01 / ROWS)));
}

// the unlit bark colour at a trunk vertex (shared by the near meshes and the impostor bake) and the sampled normal
//   bark: the atlas; uv: the trunk's uv; bk: the `bark` attribute; ex: the `extra` attribute; phase: per tree;
//   local: the vertex in the unit tree (y 0 .. 1 = the trunk's height); nW: the geometric normal (world)
export function barkAlbedo({ bark, uv, bk, ex, phase, local, nW = null, lit = float(1) }) {
  const tint = bk.rgb, slot = bk.w, aoTrunk = ex.x, lichenW = ex.y;
  const buv = barkUV(uv, slot, phase);
  const tex = bark ? vec3(texture(bark.albedo, buv).rgb) : vec3(0.5);
  const lum = dot(tex, vec3(0.3, 0.59, 0.11));
  // the species' colour carries the texture's light and dark; a third of the photo's own hue stays
  let col = mix(tint.mul(lum.div(0.42)), tex, 0.33);
  col = mix(vec3(dot(col, vec3(0.3, 0.59, 0.11))), col, 0.72);                   // muted: never orange
  const t = local.y;
  const base = mix(float(0.5), float(1), smoothstep(0.0, 0.12, t));                // the base darker
  col = mix(col, col.mul(vec3(0.85, 0.8, 0.74)), smoothstep(0.1, 0.0, t));        // soil and dust at the foot
  const top = smoothstep(0.5, 0.95, t);
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))).mul(1.08), top.mul(0.55));   // the upper trunk thinner, greyer
  // per-tree variation: ± 8 % value, from the phase
  col = col.mul(float(0.92).add(fract(phase.mul(2.39)).mul(0.16)));
  // a fire scar: char on one side of the base of about a third of the trees
  const charTree = step(fract(phase.mul(0.7351)), 0.35);
  const dir = vec2(fract(phase.mul(0.37)).mul(6.2832).cos(), fract(phase.mul(0.37)).mul(6.2832).sin());
  const side = nW ? dot(normalize(vec2(nW.x, nW.z)), dir).mul(0.5).add(0.5) : float(0.5);
  const charN = mx_noise_float(vec2(uv.x.mul(6), uv.y.mul(3).add(phase))).mul(0.5).add(0.5);
  const char = smoothstep(0.2, 0.04, t.add(charN.mul(0.08))).mul(smoothstep(0.35, 0.75, side)).mul(charTree);
  col = mix(col, vec3(0.04, 0.035, 0.03), char.mul(0.9));
  // wolf lichen: chartreuse patches on the firs' trunks (sparing: half the firs, the mid trunk, the shade side)
  const lichenN = mx_noise_float(vec2(uv.x.mul(14).add(phase), uv.y.mul(5)));
  const lichen = smoothstep(0.42, 0.6, lichenN).mul(smoothstep(0.15, 0.3, t)).mul(smoothstep(0.95, 0.7, t)).mul(lichenW).mul(step(fract(phase.mul(1.731)), 0.5));
  col = mix(col, vec3(0.55, 0.62, 0.08).mul(0.55), lichen.mul(0.85));
  const albedo = col.mul(base).mul(aoTrunk);
  const nTex = bark ? texture(bark.normal, buv).rgb.mul(2).sub(1) : vec3(0, 0, 1);
  const strength = mix(float(0.7), float(0.3), top);                                 // smoother up the trunk
  return { albedo, nTex: vec3(nTex.xy.mul(strength), nTex.z), charMask: char, lichen };
}

// the shading normal from the sampled one: the cylinder's frame (around, up, out)
export function barkNormal(nW, nTex) {
  const up = vec3(0, 1, 0);
  const tangent = normalize(cross(up, nW));
  return normalize(tangent.mul(nTex.x).add(up.mul(nTex.y)).add(nW.mul(max(nTex.z, 0.2))));
}

