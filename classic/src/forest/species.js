// The species of Tahoe's west-shore forest. Plain JS: the scatter (node tests, the bake
// workers) and the geometry generator both read it.
//
// Each species: its silhouette (for src/forest/tree-gen.js), its colours, a height range (m), and where it stands:
//   elev   [low, high] metres above the lake where it is at home (a trapezoid: full inside, fading 120 m past each end)
//   aspect −1 .. 1 preference for north-facing (+1) or south-facing (−1) slopes; 0 none
//   shore  weight near the water (0 .. 2; 1 neutral); wet: lodgepole likes flats near water
//   slope  the max slope (°) it tolerates
//   weight the base share in the mix
// The kinds: 'tree' (a conifer), 'snag' (a dead, barkless trunk), 'shrub' (manzanita, a low dome).
// Heights above the lake: the current hand-shaped basin's treeline is 700 m; the real basin's is ≈ 1,000 m above the
// water (red fir and hemlock to ≈ 2,900 m ASL). ELEV_SCALE maps the species bands onto the terrain's treeline.

export const SPECIES = [
  { id: 'jeffrey', name: 'Jeffrey pine', kind: 'tree', weight: 1.0, heightM: [18, 38], elev: [0, 450], aspect: -0.5, shore: 1.3, slope: 36,
    crown: { shape: 'pine', radius: 0.20, taper: 0.55, droop: 0.12, gap: 0.30, tiers: 11, apex: 0.08, open: 0.55, skirt: 0.30 },
    needle: [0.075, 0.125, 0.095], needleVar: 0.10, bark: [0.36, 0.24, 0.13], barkStyle: 'plates', barkSlot: 0, lichen: 0.0, trunkR: 0.022 },
  { id: 'whitefir', name: 'white fir', kind: 'tree', weight: 0.9, heightM: [16, 40], elev: [0, 500], aspect: 0.6, shore: 0.9, slope: 34,
    crown: { shape: 'fir', radius: 0.17, taper: 0.85, droop: 0.22, gap: 0.0, tiers: 18, apex: 0.03, open: 0.15, skirt: 0.06 },
    needle: [0.05, 0.11, 0.10], needleVar: 0.08, bark: [0.30, 0.29, 0.26], barkStyle: 'grey', barkSlot: 1, lichen: 1.0, trunkR: 0.020 },
  { id: 'redfir', name: 'red fir', kind: 'tree', weight: 0.9, heightM: [18, 45], elev: [380, 1100], aspect: 0.4, shore: 0.6, slope: 34,
    crown: { shape: 'fir', radius: 0.14, taper: 0.9, droop: 0.18, gap: 0.0, tiers: 20, apex: 0.02, open: 0.12, skirt: 0.10 },
    needle: [0.04, 0.09, 0.09], needleVar: 0.07, bark: [0.27, 0.15, 0.12], barkStyle: 'fissured', barkSlot: 2, lichen: 1.0, trunkR: 0.020 },
  { id: 'cedar', name: 'incense cedar', kind: 'tree', weight: 0.45, heightM: [15, 35], elev: [0, 400], aspect: 0.2, shore: 1.0, slope: 32,
    crown: { shape: 'cedar', radius: 0.19, taper: 0.8, droop: -0.05, gap: 0.0, tiers: 16, apex: 0.04, open: 0.20, skirt: 0.04 },
    needle: [0.09, 0.15, 0.07], needleVar: 0.06, bark: [0.34, 0.20, 0.12], barkStyle: 'fissured', barkSlot: 3, lichen: 0.2, trunkR: 0.026 },
  { id: 'lodgepole', name: 'lodgepole pine', kind: 'tree', weight: 0.5, heightM: [12, 26], elev: [0, 900], aspect: 0.0, shore: 2.8, slope: 26,
    crown: { shape: 'pine', radius: 0.12, taper: 0.7, droop: 0.05, gap: 0.25, tiers: 12, apex: 0.06, open: 0.45, skirt: 0.35 },
    needle: [0.08, 0.14, 0.08], needleVar: 0.08, bark: [0.30, 0.26, 0.20], barkStyle: 'grey', barkSlot: 4, lichen: 0.3, trunkR: 0.016 },
  { id: 'sugar', name: 'sugar pine', kind: 'tree', weight: 0.35, heightM: [30, 52], elev: [0, 420], aspect: 0.3, shore: 0.8, slope: 30,
    crown: { shape: 'sugar', radius: 0.19, taper: 0.35, droop: 0.02, gap: 0.35, tiers: 8, apex: 0.00, open: 0.6, skirt: 0.45 },
    needle: [0.065, 0.12, 0.09], needleVar: 0.08, bark: [0.30, 0.24, 0.20], barkStyle: 'plates', barkSlot: 0, lichen: 0.2, trunkR: 0.026 },
  { id: 'hemlock', name: 'mountain hemlock', kind: 'tree', weight: 0.6, heightM: [10, 28], elev: [700, 1300], aspect: 0.5, shore: 0.5, slope: 38,
    crown: { shape: 'fir', radius: 0.15, taper: 0.8, droop: 0.30, gap: 0.0, tiers: 16, apex: 0.10, open: 0.15, skirt: 0.08 },
    needle: [0.045, 0.10, 0.09], needleVar: 0.07, bark: [0.25, 0.19, 0.15], barkStyle: 'fissured', barkSlot: 2, lichen: 0.8, trunkR: 0.020 },
  { id: 'snag', name: 'snag', kind: 'snag', weight: 0, heightM: [10, 30], elev: [0, 1300], aspect: 0, shore: 1, slope: 40,
    crown: { shape: 'snag', radius: 0.10, taper: 0.6, droop: 0.1, gap: 0.5, tiers: 7, apex: 0.0, open: 1, skirt: 0.3 },
    needle: [0.50, 0.48, 0.44], needleVar: 0.05, bark: [0.50, 0.49, 0.46], barkStyle: 'bleached', barkSlot: 5, lichen: 0.0, trunkR: 0.022 },
  { id: 'manzanita', name: 'greenleaf manzanita', kind: 'shrub', weight: 0, heightM: [1.2, 2.6], elev: [0, 900], aspect: -0.6, shore: 1, slope: 60,
    crown: { shape: 'shrub', radius: 1.7, taper: 0.4, droop: 0, gap: 0, tiers: 4, apex: 0, open: 0.3, skirt: 0 },
    needle: [0.105, 0.138, 0.066], needleVar: 0.16, bark: [0.17, 0.12, 0.09], barkStyle: 'smooth', barkSlot: 3, lichen: 0.0, trunkR: 0.06 },
];
export const SPECIES_INDEX = Object.fromEntries(SPECIES.map((s, i) => [s.id, i]));
export const VARIANTS = 4;                       // geometry variants per species, from the seed
export const TREE_SPECIES = SPECIES.filter((s) => s.kind === 'tree');
export const SNAG = SPECIES_INDEX.snag, SHRUB = SPECIES_INDEX.manzanita;

// the species' weight at a spot: elevation (scaled to the terrain's treeline), aspect (nz: the ground normal's south
// component, −1 north-facing .. +1 south-facing), slope (°), and the distance to the shore (m)
export function speciesWeight(s, { elevM, elevScale = 1, aspect = 0, slopeDeg = 0, shoreM = 1e9 }) {
  if (slopeDeg > s.slope) return 0;
  const [lo, hi] = s.elev, e = elevM / elevScale, fade = 120;
  const band = Math.min(1, Math.max(0, (e - (lo - fade)) / fade)) * Math.min(1, Math.max(0, ((hi + fade) - e) / fade));
  if (band <= 0) return 0;
  const asp = 1 + 0.6 * s.aspect * -aspect;                  // north-facing (aspect < 0) favours s.aspect > 0
  const near = Math.min(1, Math.max(0, 1 - shoreM / 90));
  const shore = 1 + (s.shore - 1) * near;
  return s.weight * band * Math.max(0.2, asp) * shore;
}
