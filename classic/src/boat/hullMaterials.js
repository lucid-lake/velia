// The hull and deck materials at load (hero hull, 2026-10-29, 4, 5).
// The GLBs (blender/m1_hull.py, m8_hardware.py) carry plain glTF materials by name; this swaps each for a physically
// based node material: procedural, so there are no textures to load, compress or alias.
//
//   gelcoat     polished off-white polyester: low roughness, a clear coat, faint "print-through" waviness in the
//               reflections (real topsides are never a perfect mirror) and very light roughness wear
//   nonskid     the moulded diamond pattern (≈ 10 mm pitch), raised flat-topped diamonds; the bump fades out as a cell
//               shrinks under ≈ 2 px (no shimmer at the follow camera) and the lost micro-normal goes into roughness
//   antifouling matte dark ablative paint under the boot band, slightly mottled
//   acrylic     dark smoked windows and ports: glossy, mirror-like
//   stainless   polished 316, bright (no tangents in the GLBs, so no anisotropy: a low roughness instead)
//   aluminium   anodised, satin
//   teak_deck   laid teak (the reference pass): planks with black caulked seams and
//               butt joints, honey-brown grain a few seasons grey; the GLB's UVs carry the plank coordinates (u across
//               in planks, a seam at each integer; v along, metres), the vertex colours the baked AO
// Each kept material is shared by every mesh that names it. Vertex colours (the baked AO, stripes) stay on.
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, abs, max, fract, fwidth, smoothstep, mix, positionLocal, normalLocal, transformNormalToView,
  mx_noise_float, vertexColor, min, exp, sqrt, uv, floor, sin,
} from 'three/tsl';

const PITCH = 0.010;   // m, the non-skid diamonds' pitch (≈ 3/8 in)

function nonskid() {
  const m = new THREE.MeshPhysicalNodeMaterial({ name: 'nonskid', vertexColors: true, roughness: 0.62, metalness: 0 });
  const k = float(1 / PITCH);
  const p = vec2(positionLocal.x.add(positionLocal.z), positionLocal.x.sub(positionLocal.z)).mul(k.mul(0.7071));
  const f = fract(p).sub(0.5);
  const ax = abs(f.x), ay = abs(f.y);
  const d = max(ax, ay);
  const h = smoothstep(0.42, 0.30, d);
  const slope = smoothstep(0.42, 0.30, d.sub(0.02)).sub(smoothstep(0.42, 0.30, d.add(0.02))).div(0.04);   // −dh/dd ≥ 0
  const xMajor = ax.greaterThan(ay);
  const gx = xMajor.select(f.x.sign(), float(0)), gy = xMajor.select(float(0), f.y.sign());
  const s = k.mul(0.7071).mul(slope).mul(-1);              // dh/dd < 0 outward
  const cells = max(fwidth(p.x), fwidth(p.y));
  const fade = smoothstep(0.85, 0.45, cells);             // 1 while a cell spans ≥ 2.2 px, 0 under ≈ 1.2 px
  const amp = float(0.0007).mul(fade);                     // the diamonds stand ≈ 0.7 mm proud
  const dhdx = gx.add(gy).mul(s).mul(amp), dhdz = gx.sub(gy).mul(s).mul(amp);
  // tilt the (near-horizontal) deck normal against the height gradient, in the object frame, then to view space
  const n = normalLocal.sub(vec3(dhdx, 0, dhdz).sub(normalLocal.mul(normalLocal.x.mul(dhdx).add(normalLocal.z.mul(dhdz))))).normalize();
  m.normalNode = transformNormalToView(n);
  // grooves hold a little grime, the tops catch the light; unresolved, the pattern only roughens
  const grime = mx_noise_float(positionLocal.mul(vec3(2.1, 2.1, 2.1))).mul(0.5).add(0.5);
  // used, not new (Halcyon, 15–20 years): grey grime sits in the grooves; foot traffic polishes a path down the side decks
  // (x ≈ ±1.05..1.32 m) and across the cockpit sole, where the tops go lighter and a little shinier and the grime thins
  const px = positionLocal.x.abs(), pz = positionLocal.z, py = positionLocal.y;
  const sideDeck = smoothstep(0.98, 1.10, px).mul(smoothstep(1.40, 1.26, px)).mul(smoothstep(-3.0, -2.4, pz)).mul(smoothstep(1.7, 1.2, pz));
  const sole = smoothstep(0.62, 0.50, px).mul(smoothstep(0.58, 0.45, py)).mul(smoothstep(0.9, 1.4, pz));
  const path = max(sideDeck, sole).mul(mx_noise_float(positionLocal.mul(vec3(2.3, 2.3, 1.1)).add(2.2)).mul(0.25).add(0.8));
  const groove = float(1).sub(h);                                                    // 1 in the groove between diamonds
  const dirt = mix(vec3(1, 1, 1), vec3(0.70, 0.70, 0.67), groove.mul(fade).mul(float(1).sub(path.mul(0.7))).mul(0.9));
  const trodden = mix(vec3(1, 1, 1), vec3(0.84, 0.81, 0.74), path.mul(0.9));
  m.colorNode = vertexColor().rgb.mul(mix(float(1), mix(0.90, 1.02, h), fade)).mul(mix(1.0, 0.84, grime.mul(grime))).mul(float(0.96).add(mx_noise_float(positionLocal.mul(vec3(0.7, 1.0, 0.5))).mul(0.06))).mul(dirt).mul(trodden);
  m.roughnessNode = mix(float(0.74), mix(0.80, 0.58, h), fade).sub(path.mul(0.1));
  return m;
}

// Halcyon is a well-kept 15–20 year old boat (owner, 2026-10-30: "a real used boat is not completely white"). All the
// wear is procedural in the hull frame (x starboard, y up from the waterline, z aft), subtle and cared-for:
//   ivory not white (albedo capped at 0.72), a very low-frequency tonal drift, faint chalking on the sun-facing flats,
//   yellowing toward the waterline and the transom, a brown scum line over the tide band, tannin streaks under the
//   stanchion bases and chainplates, black rubber scuffs at fender height, grey grime where the deck meets the rail.
// print-through (shared with the cockpit overlay, src/stations/sloop/cockpitMaterials.js): the gelcoat's normal tilted by a faint long-wave
// ripple (amp ≈ 0.018 rad over a metre), in view space
export function printThrough(amp = 0.018, pos = positionLocal) {
  const q = pos.mul(vec3(1.3, 2.6, 0.55));
  const w = vec3(mx_noise_float(q), mx_noise_float(q.add(17.3)), mx_noise_float(q.add(41.7))).mul(amp);
  return transformNormalToView(normalLocal.add(w).normalize());
}
export const GEL_IVORY = [0.97, 0.925, 0.84];   // the gelcoat's ivory tint (× the albedo, capped at ALBEDO_MAX)
const STANCHION_Z = [-3.5, -1.23, 1.05, 3.33, -0.74];   // the four stanchion bases a side (m8_hardware.py) and the chainplate
export const ALBEDO_MAX = 0.72;

function gelcoat(scale = 1) {
  const m = new THREE.MeshPhysicalNodeMaterial({ name: 'gelcoat', vertexColors: true, metalness: 0, roughness: 0.2,
    clearcoat: 0.55, clearcoatRoughness: 0.07, ior: 1.54 });
  // print-through: a faint long-wave ripple in the surface (a few mm over a metre), seen only in the reflections
  m.clearcoatNormalNode = printThrough();
  // very light wear: a slightly duller, warmer film in places (salt, sun), never stains
  const wear = smoothstep(0.25, 0.9, mx_noise_float(positionLocal.mul(0.9)).mul(0.5).add(0.5));
  const p = positionLocal, n = normalLocal;
  const y = p.y;
  const up = smoothstep(0.72, 0.95, n.y);                                     // faces the sky
  const side = smoothstep(0.45, 0.1, n.y.abs());                              // a vertical wall (topsides, transom)
  const drift = mx_noise_float(p.mul(vec3(0.55, 0.9, 0.42)).add(3.1));       // −1..1, metres-long patches
  const drift2 = mx_noise_float(p.mul(vec3(1.7, 2.2, 1.3)).add(9.7));
  const chalk = up.mul(smoothstep(-0.2, 0.7, drift2));                        // faint chalky oxidation on the flats
  const nearWater = smoothstep(0.80, 0.18, y).mul(side);                      // yellowed near the waterline
  const nearStern = smoothstep(3.2, 4.2, p.z).mul(side);                      // and at the transom
  const ivory = vec3(...GEL_IVORY);
  const yellow = vec3(0.96, 0.89, 0.70);
  let base = vertexColor().rgb.mul(scale).mul(mix(vec3(1, 1, 1), vec3(0.985, 0.975, 0.95), wear));
  base = base.mul(ivory).mul(float(1).add(drift.mul(0.06)));
  base = base.mul(mix(vec3(1, 1, 1), yellow, max(nearWater.mul(0.55), nearStern.mul(0.38)).mul(drift2.mul(0.25).add(0.8))));
  base = mix(base, base.mul(vec3(0.93, 0.92, 0.89)).add(0.012), chalk.mul(0.8));
  // the scum line over the tide band (hull faces only, uneven), brown
  const sc = smoothstep(0.160, 0.185, y).mul(smoothstep(0.272, 0.222, y)).mul(side);
  const scn = mx_noise_float(vec3(p.z.mul(2.4), y.mul(26.0), p.x.mul(1.1))).mul(0.5).add(0.5);
  base = mix(base, vec3(0.36, 0.29, 0.18).mul(0.8), sc.mul(smoothstep(0.1, 0.5, scn)).mul(0.7));
  // tannin and rust streaks under the stanchion bases and chainplates, fading down the topsides
  let st = float(0);
  for (const zk of STANCHION_Z) { const d = p.z.sub(zk).abs(); st = max(st, exp(d.mul(d).mul(-1.0 / (0.022 * 0.022)))); }
  const stn = mx_noise_float(vec3(p.z.mul(40.0), y.mul(2.2), p.x)).mul(0.5).add(0.5);
  const streak = st.mul(smoothstep(0.35, 0.8, stn.add(0.25))).mul(smoothstep(0.30, 0.62, y.add(stn.mul(0.3)))).mul(side);
  base = mix(base, vec3(0.42, 0.32, 0.20), streak.mul(0.5));
  // black rubber scuffs at fender height: short dark dashes along the topsides
  const sf = mx_noise_float(vec3(p.z.mul(2.6), y.mul(34.0), p.x.mul(1.3))).mul(0.5).add(0.5);
  const sparse = smoothstep(0.35, 0.65, mx_noise_float(vec3(p.z.mul(0.7), 0.0, p.x.mul(0.5)).add(5.5)).mul(0.5).add(0.5));
  const fender = smoothstep(0.40, 0.50, y).mul(smoothstep(0.70, 0.60, y)).mul(side);
  const scuff = smoothstep(0.66, 0.80, sf).mul(sparse).mul(fender);
  base = mix(base, vec3(0.20, 0.20, 0.20), scuff.mul(0.7));
  // grey grime along the hull-deck joint (just under the rail), heavier where the water doesn't wash it
  const joint = smoothstep(0.80, 0.93, y).mul(side).mul(mx_noise_float(p.mul(vec3(3.5, 8.0, 3.5))).mul(0.3).add(0.7));
  base = mix(base, base.mul(vec3(0.78, 0.79, 0.78)), joint.mul(0.8));
  m.colorNode = min(base, vec3(ALBEDO_MAX, ALBEDO_MAX, ALBEDO_MAX));
  m.roughnessNode = mix(float(0.16), float(0.3), wear).add(chalk.mul(0.18)).add(scuff.mul(0.1));
  m.clearcoatNode = float(0.55).mul(float(1).sub(chalk.mul(0.55)));
  return m;
}

// 316 stainless after a few seasons: slightly dull (a satin, not a mirror), with a few tea-stain spots. The cockpit overlay
// (src/stations/sloop/cockpitMaterials.js) takes a brushed variant: opts { rough: [lo, hi], name, extra(m, spot) }; the defaults are the boat's
export function stainless({ rough = [0.15, 0.27], name = 'stainless', extra = null } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial({ name, color: new THREE.Color().setRGB(0.58, 0.575, 0.56), metalness: 1, roughness: 0.2 });
  const q = positionLocal.mul(70.0);
  const spot = smoothstep(0.62, 0.78, mx_noise_float(q).mul(0.5).add(0.5)).mul(smoothstep(-0.1, 0.5, mx_noise_float(positionLocal.mul(4.0).add(8.0))));
  const haze = mx_noise_float(positionLocal.mul(9.0)).mul(0.5).add(0.5);
  m.colorNode = mix(vec3(0.58, 0.575, 0.56), vec3(0.42, 0.33, 0.24), spot.mul(0.55));
  m.roughnessNode = mix(float(rough[0]), float(rough[1]), haze).add(spot.mul(0.2));
  extra?.(m, { spot, haze });
  return m;
}

function antifouling() {
  const m = new THREE.MeshPhysicalNodeMaterial({ name: 'antifouling', vertexColors: true, metalness: 0, roughness: 0.9 });
  const mottle = mx_noise_float(positionLocal.mul(vec3(3.0, 6.0, 3.0))).mul(0.5).add(0.5);
  m.colorNode = vertexColor().rgb.mul(mix(0.85, 1.12, mottle));
  return m;
}

// Laid teak, a well-kept 15–20 year old cockpit: cleaned and oiled now and then, so honey-brown with a silver bloom,
// darker latewood streaks along each plank, a 7 mm black seam between planks and at each butt joint (≈ 2.2 m apart,
// staggered), paler where feet go. The seams fade to their average tone once they are under ≈ 1.5 px (no shimmer at
// the follow camera). No texture: everything from the UVs.
export const TEAK_W = 0.055;   // m, as blender/m3_hero.py TEAK_W
// opts (the cockpit overlay, src/stations/sloop/cockpitMaterials.js): ao (a vec3 node; default the baked vertex colours), weather (added
// silver bloom, 0..1), seams (false: one solid plank, the cap), trodden (a 0..1 node: where feet go; default the hull's sole),
// t (the uv node); the defaults are the boat's
export function teakDeck({ ao = null, weather = 0, seams = true, trodden: tr = null, t: tIn = null, name = 'teak_deck' } = {}) {
  const m = new THREE.MeshPhysicalNodeMaterial({ name, vertexColors: !ao, roughness: 0.8, metalness: 0, specularIntensity: 0.45 });   // dry oiled wood: a weak sheen (the sky's sheen turned it mauve)
  const t = tIn ?? uv();
  const u = t.x, v = t.y;                                  // u: planks across (a seam at each integer); v: metres along
  const idx = floor(u), f = fract(u);
  const rnd = (k) => fract(sin(idx.mul(12.9898).add(k * 78.233)).mul(43758.5453));   // per plank, 0..1
  const r1 = rnd(1), r2 = rnd(2), r3 = rnd(3);
  const S = float(0.0035 / TEAK_W);                        // the seam's half width, in planks (7 mm caulk)
  const fu = fwidth(u).max(1e-5);
  const du = min(f, float(1).sub(f));
  const seamU = smoothstep(S.add(fu), S.sub(fu), du);
  const L = float(2.2);                                     // the butt joints, staggered per plank
  const jv = fract(v.add(r2.mul(L)).div(L)).mul(L);
  const dv = min(jv, L.sub(jv));
  const fv = fwidth(v).max(1e-5);
  const seamV = smoothstep(fv.add(0.0035), float(0.0035).sub(fv), dv);
  const aaU = smoothstep(0.12, 0.45, fu), aaV = smoothstep(0.004, 0.02, fv);
  const seam = seams ? max(mix(seamU, S.mul(2), aaU), mix(seamV, float(0.0035 * 2 / 2.2), aaV)) : float(0);
  // the grain: fine streaks along the plank (fast across, slow along), latewood darker; each plank its own tone
  const g1 = mx_noise_float(vec3(f.mul(TEAK_W * 160), v.mul(1.6), idx.mul(1.37))).mul(0.5).add(0.5);
  const g2 = mx_noise_float(vec3(f.mul(TEAK_W * 45), v.mul(0.5), idx.mul(2.11).add(7.0))).mul(0.5).add(0.5);
  const late = smoothstep(0.55, 0.85, g1).mul(0.7).add(smoothstep(0.6, 0.9, g2).mul(0.4));
  const honey = vec3(0.125, 0.042, 0.008), dark = vec3(0.058, 0.018, 0.003), silver = vec3(0.13, 0.095, 0.060);
  let wood = mix(honey, dark, late.min(1)).mul(float(0.82).add(r1.mul(0.36)));
  // a silver bloom (sun and washing), stronger on some planks and in patches; paler where feet go (the sole's middle)
  const p = positionLocal;
  let bloom = float(0.08).add(r3.mul(0.10)).add(mx_noise_float(p.mul(vec3(1.4, 1.4, 0.8)).add(4.4)).mul(0.10));
  if (weather) bloom = bloom.add(weather);
  const trodden = tr ? tr.mul(0.12) : smoothstep(0.60, 0.45, p.y).mul(smoothstep(0.55, 0.25, p.x.abs())).mul(0.12);
  wood = mix(wood, silver, bloom.add(trodden).min(weather ? 0.6 + weather * 0.5 : 0.6));
  const caulk = vec3(0.022, 0.021, 0.020);
  m.colorNode = mix(wood, caulk, seam).mul(ao ?? vertexColor().rgb);
  m.roughnessNode = mix(float(0.82).sub(late.mul(0.06)), float(0.6), seam);
  m.userData.teak = { late, seam, idx, f, v };   // for a caller's own grain relief
  return m;
}

const make = {
  gelcoat, nonskid, antifouling, teak_deck: () => teakDeck(),
  gelcoat_plain: () => new THREE.MeshPhysicalNodeMaterial({ name: 'gelcoat_plain', color: new THREE.Color().setRGB(0.80, 0.79, 0.755),
    roughness: 0.2, clearcoat: 0.55, clearcoatRoughness: 0.07 }),
  acrylic: () => new THREE.MeshPhysicalNodeMaterial({ name: 'acrylic', color: new THREE.Color().setRGB(0.010, 0.0135, 0.016),
    roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.49 }),
  stainless: () => stainless(),
  near_chrome: () => new THREE.MeshPhysicalNodeMaterial({ name: 'near_chrome', color: new THREE.Color().setRGB(0.66, 0.66, 0.67), metalness: 1, roughness: 0.07 }),
  aluminium: () => new THREE.MeshPhysicalNodeMaterial({ name: 'aluminium', color: new THREE.Color().setRGB(0.78, 0.79, 0.80),
    metalness: 1, roughness: 0.36 }),
};

// Swap the named materials under `root` (a loaded GLB scene or a module root). Returns the count swapped.
// The cockpit GLB names its copies "gelcoat.001", "nonskid.001", "stainless.007" …: the suffix is Blender's, the material
// is the same. They were skipped by the swap (2026-10-29), so the deck, the coamings and the cockpit floor kept glTF
// stock materials with vertex colour 1.0: an albedo of 1.0, which no real surface has, and which clipped white in sun.
// Real white gelcoat reflects ≈ 0.75–0.8 and a pale non-skid ≈ 0.6; the hull GLB's own vertex colours already sit there
// (gelcoat median 0.70, p90 0.78; non-skid median 0.63); a few seasons old, not showroom. A suffixed copy whose vertex colours are pure white is scaled to them.
const WHITE_DATA_ALBEDO = { gelcoat: 0.68, nonskid: 0.56 };

function whiteData(geo) {
  const c = geo.attributes.color;
  if (!c) return false;
  let s = 0;
  const n = Math.min(c.count, 512);
  for (let i = 0; i < n; i++) s += (c.getX(i) + c.getY(i) + c.getZ(i)) / 3;
  return n > 0 && s / n > 0.97;
}

// Swap the named materials under `root` (a loaded GLB scene or a module root). Returns the count swapped.
export function applyHullMaterials(root, cache = new Map()) {
  let n = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const swap = (mat) => {
      const raw = mat?.name;
      const name = raw?.replace(/\.\d+$/, '');
      if (!name || !make[name]) return mat;
      const scale = WHITE_DATA_ALBEDO[name];
      const white = scale != null && whiteData(o.geometry);
      const key = white ? `${name}:white` : name;
      if (!cache.has(key)) {
        const m = name === 'gelcoat' ? make.gelcoat(white ? scale : 1) : make[name]();
        if (white && name !== 'gelcoat') m.colorNode = m.colorNode ? m.colorNode.mul(scale) : vertexColor().rgb.mul(scale);
        cache.set(key, m);
      }
      n++;
      return cache.get(key);
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return n;
}


// The small parts' LOD (hero hull): the hardware's and the hull's smallest parts (stanchion caps, pins, hinges, the
// chain, the ladder treads, the port and through-hull bezels) are all under ≈ 16 mm: past ≈ 24 m from the camera
// (1280×720, FOV 40: a pixel is ≈ 23 mm there) they are under 0.7 px, so hiding them is invisible and saves their
// draw calls. The follow camera sits at ≈ 32 m; the helm and the close orbits are well inside. Hysteresis ±1 m.
const DETAIL_NAMES = ['stainless_detail', 'anchor_chain', 'ladder_treads', 'hull_trim'];
export function hullDetailLod(boat, { far = 24, band = 1 } = {}) {
  const parts = [];
  boat.traverse((o) => { if (o.isMesh && DETAIL_NAMES.includes(o.name)) parts.push(o); });
  const p = new THREE.Vector3();
  let shown = true;
  return {
    parts,
    update(cameraPos) {
      boat.getWorldPosition(p);
      const d = p.distanceTo(cameraPos);
      const want = shown ? d < far + band : d < far - band;
      if (want !== shown) { shown = want; for (const o of parts) o.visible = shown; }
      return shown;
    },
  };
}
