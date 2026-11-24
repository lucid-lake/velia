// The photo ground's plain-JS side (no three.js): where each NAIP level sits in the world frame, which file the quality
// tier loads, the horizon grid. src/naip.js and src/horizon-fine.js build the textures and the shader nodes from these;
// tests/naip.test.mjs checks them against terrain/naip/naip.json and horizon.json (the build tools' own record).
// Build: tools/ground/fetch_naip.py, build_naip.py, build_horizon.py. Source: USDA FSA NAIP 2022 (public domain), ATTRIBUTION.md.
//
// Extents are texel EDGES in world metres (x east, z south; src/geo.js). The bay is terrain/tahoe.json's bay level (2 m
// texels); the region is its lake level's box (the whole lake and its rim: Desolation, the Sierra crest, the east shore).
// Row 0 of every image is the north edge (z0). Two photos, not three: the shader's sampler budget is 16 a stage.
export const NAIP_DIR = '/terrain/naip/';
export const NAIP_EXTENT = {
  bay:    { x0: -2304, z0: -1792, x1: 3328, z1: 1792 },
  region: { x0: -14000, z0: -46000, x1: 26960, z1: 15440 },
};
// the phone texture set's texels (plain WebP only, never packed to KTX2: src/quality/apply.js tierFor picks them on a phone)
export const NAIP_PHONE = { bay: 8, region: 128 };
// texel metres -> [file, pixel width, pixel height], per level
export const NAIP_FILES = {
  bay:    { 1: ['albedo-bay-1m.webp', 5632, 3584], 2: ['albedo-bay-2m.webp', 2816, 1792], 4: ['albedo-bay-4m.webp', 1408, 896], 8: ['albedo-bay-8m.webp', 704, 448] },   // 8: phones (tools/terrain/phone_textures.py)
  region: { 16: ['albedo-region-16m.webp', 2560, 3840], 32: ['albedo-region-32m.webp', 1280, 1920], 64: ['albedo-region-64m.webp', 640, 960], 128: ['albedo-region-128m.webp', 320, 480] },
};
// the bay files carry a class index in alpha: 64 + 191 * (forest + brush / 2); decode it with naipClass()
export const NAIP_ALPHA = { base: 64, span: 191 };
export function naipClass(a255) {   // 0..255 alpha -> { forest, brush, bare } (plain JS twin of the shader's decode, for the tests)
  const s = Math.min(1, Math.max(0, (a255 - NAIP_ALPHA.base) / NAIP_ALPHA.span));
  const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
  const forest = sm(0.62, 0.88, s), bare = 1 - sm(0.12, 0.38, s);
  return { forest, bare, brush: Math.max(0, 1 - forest - bare) };
}
// the level High loads (each quality tier passes its own: src/quality/tiers.js `ground`); a level's finer neighbour takes over inside it
export const NAIP = Object.freeze({ pick: Object.freeze({ bay: 1, region: 16 }), fadeM: Object.freeze({ bay: 260, region: 1 }) });
export const naipPick = (g = null) => ({ bay: g?.bay ?? NAIP.pick.bay, region: g?.region ?? NAIP.pick.region });
export const naipFile = (level, pick = NAIP.pick) => NAIP_FILES[level][pick[level]];

// The sun's direct light under the terrain's skyline, and the sky left open: the horizon grid (tools/ground/build_horizon.py),
// over the box of the older 8-direction map (src/forest/horizon.js) at 16 m
export const HORIZON_FINE = { file: 'horizon-bay.hzg', x0: -4512, z0: -6016, texel: 16, w: 657, h: 751, dirs: 16, planes: 17, fadeM: 400 };
// the colour/ambient constants the shader uses (one place to tune)
export const NAIP_LOOK = {
  detailNear: 0.85,       // how much of the CC0 layers' near grain (relative luminance) rides on the photo within 350 m
  forestAmbient: 0.5,     // the share of the sky's light that reaches a crown surface under its own foliage (1 = open)
  skyPow: 3.0,            // sky visibility exponent: the sky is brighter near the horizon than the cosine weight says
};
