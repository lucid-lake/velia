// The ground's plain-JS side (no three.js): the layer list the textures are packed in, the texture manifest, and the
// canopy raster the forest's scatter paints for the material (needle duff and shade under the crowns, dry grass and
// decomposed granite in the gaps). src/ground.js samples these on the GPU; node tests read them here.
//
//   import { GROUND_LAYERS, GROUND_TEXTURES, canopyRaster } from './ground-layout.js';
//   const c = canopyRaster(scatter, species);   // → { data: Uint8Array (RG: R crowns, G brush), w, h, x0, z0, cell }
import { TREE_RULES, TREE_STRIDE } from './trees-scatter.js';
import { SPECIES } from './forest/species.js';

// the layers, in the order of the strips (terrain/ground/*.webp, top to bottom); CC0 ambientCG sets, ATTRIBUTION.md
export const GROUND_LAYERS = [
  { id: 'granite', name: 'granite slabs and cliffs, lichen', tileM: 4.0, roughness: 0.82, source: 'Rock051' },
  { id: 'talus', name: 'decomposed granite, talus and scree', tileM: 3.0, roughness: 0.9, source: 'Ground110' },
  { id: 'duff', name: 'pine-needle duff and litter', tileM: 3.0, roughness: 0.95, source: 'Ground077' },
  { id: 'sand', name: 'beach sand (coarse granitic grit)', tileM: 2.5, roughness: 0.9, source: 'Ground079S' },
  { id: 'grass', name: 'meadow grass (green in June; TAHOE.season.grassDry dries it)', tileM: 3.0, roughness: 0.95, source: 'Grass004' },
  { id: 'snow', name: 'snow', tileM: 4.0, roughness: 0.5, source: 'Snow004' },
];
export const GROUND_TEXTURES = {
  albedo: { url: '/terrain/ground/albedo.webp', size: 512, layers: GROUND_LAYERS.length },   // sRGB colour, graded to aerial means
  pack: { url: '/terrain/ground/pack.webp', size: 256, layers: GROUND_LAYERS.length },       // R, G: normal (GL +Y up); B: height
};

// The canopy raster over the scatter's region: per CELL-metre texel, R the crown cover (0–255), G the brush (manzanita)
// cover. Each tree splats a disc of its crown radius (≈ 0.22 × the height, 1.5–7 m) so the floor under the crowns reads
// duff and shade, the gaps between stands dry grass and granite. Deterministic: the scatter is.
export const CANOPY = { cell: 8, region: TREE_RULES.region, crownK: 0.22, crownMin: 1.5, crownMax: 7, brushR: 2.0 };
export function canopyRaster(scatter, species = scatter?.species, rules = CANOPY) {
  const { x0, x1, z0, z1 } = rules.region, cell = rules.cell;
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell);
  const acc = new Float32Array(w * h * 2);
  const n = scatter ? scatter.count : 0, d = scatter?.data;
  for (let i = 0; i < n; i++) {
    const k = i * TREE_STRIDE, x = d[k], z = d[k + 2], height = d[k + 3];
    const shrub = species ? SPECIES[species[i]]?.kind === 'shrub' : false;
    const r = shrub ? rules.brushR : Math.min(rules.crownMax, Math.max(rules.crownMin, height * rules.crownK));
    const ch = shrub ? 1 : 0;
    const ci = (x - x0) / cell, cj = (z - z0) / cell, rc = r / cell;
    const i0 = Math.max(0, Math.floor(ci - rc)), i1 = Math.min(w - 1, Math.ceil(ci + rc));
    const j0 = Math.max(0, Math.floor(cj - rc)), j1 = Math.min(h - 1, Math.ceil(cj + rc));
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
      // the disc's cover of the texel: a soft edge one texel wide; a disc under a texel still fills the texel it is in
      const dx = ii + 0.5 - ci, dz = j + 0.5 - cj, q = Math.hypot(dx, dz) / Math.max(rc, 1.0);
      const cov = q < 0.7 ? 1 : q < 1.3 ? (1.3 - q) / 0.6 : 0;
      if (cov > 0) acc[(j * w + ii) * 2 + ch] += cov;
    }
  }
  const data = new Uint8Array(w * h * 2);
  for (let k = 0; k < w * h * 2; k++) data[k] = Math.min(255, Math.round(255 * Math.min(1, acc[k])));
  return { data, w, h, x0, z0, cell };
}

