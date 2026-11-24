// A tier as the world is built with it (refactor Phase 2 step 3): tiers.js TIERS plus this device's own cuts, passed
// into each create* (createWorld → the wind field, the terrain material and LOD, the forest, the stream; the modes
// read core.tier for the air and the boat's textures). No module's constants are patched: High is each module's own
// numbers, so a High page is the page it was.
//
//   const tier = tierFor('low', { phone: true });   // src/core/quality-boot.js, once the tier is picked
//   tier.forest, tier.stream, tier.terrain, tier.ground, tier.canopy, tier.ktx2, tier.air   (tiers.js)
//   tier.wind      the wind field's texture caches (WindField cache: a phone keeps 3 centres, in Float32)
//   tier.terrainCache  the terrain chunks kept off screen (TerrainLOD cacheMax: 250 on a phone)
//   tier.bark      the bark atlas (loadBarkAtlas: a phone draws its own bark, no photos)
//
// The live knobs (the stream's radii and upload budget, the terrain's split) move in play through the stream manager's
// setTier and the terrain's setSplit (src/core/index.js, from the governor and Settings).
import { TIERS, tierOf, pixelRatioFor } from './tiers.js';
import { NAIP_PHONE } from '../../../src/naip-layout.js';

// phone: a phone or tablet's live page (src/core/quality-boot.js: touch and not headless)
export function tierFor(name, { phone = false } = {}) {
  const t = tierOf(name);
  const out = { ...t, name: TIERS[name] ? name : 'high', phone: !!phone };   // phone: the kayaks' rule reads it (src/kayaks/lod.js lodFor)
  if (phone) {
    // fix/ios-start: the wind's per-centre caches and the terrain's off-screen chunks: fewer kept on a phone; the bark drawn
    out.wind = { tex: 3, f32: true };
    out.terrainCache = 250;
    out.bark = { slot: 256, photos: false };
    // a phone or tablet on Low (fix/ios-start-2): the phone texture set: the photo ground and the canopy at half Low's
    // resolution, as plain WebP (fewer bytes than their KTX2 twins, and a quarter of the texels); the boat's textures as
    // authored (the KTX2 transcoder is 0.5 MB to fetch: no KTX2 at all on a phone before the card). The tier table (and
    // every desktop) is untouched.
    if (out.name === 'low') {
      out.ground = { ...NAIP_PHONE };
      out.canopy = { cell: 16 };
      out.ktx2 = { naip: false, ground: false, boat: false };
    }
  }
  return out;
}

// The renderer's pixel ratio for a tier on this screen (CSS px), times the governor's extra factor. The canvas keeps
// its CSS size, so the browser stretches it (bilinear); the UI is DOM and stays at native resolution.
export const ratioFor = (name, screen, factor = 1, retinaMax = Infinity) => +(pixelRatioFor(name, screen, retinaMax) * factor).toFixed(4);
export { TIERS };
