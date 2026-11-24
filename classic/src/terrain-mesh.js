// Lakeshore terrain mesh: a chunked quadtree LOD over src/terrain.js's heightAt (the real Tahoe grids), and its material.
//
//   import { makeTerrain } from '../../src/sim/terrain.js';
//   import { TerrainLOD } from './terrain-mesh.js';
//   const lod = new TerrainLOD(makeTerrain({ seed }));
//   scene.add(lod); lod.update(camera.position);   // again whenever the camera moves; cheap when nothing changes
//
// The root square is 81.92 km a side, centred on the island (src/terrain-lod.js). A node splits while the camera is
// within SPLIT × its size (and it is larger than the 160 m leaf; 40 m over the island), so every chunk spans about
// the same angle on screen: the far Sierra ring is a few big coarse chunks (the cheap far mesh), the aerial
// perspective and depthTint fade it. Each chunk is a 64 × 64-cell grid with a skirt that hides cracks between
// levels. Chunks are built on the CPU from heightAt once and cached; normals come from the same samples.
import * as THREE from 'three/webgpu';
import { makeTerrain } from '../../src/sim/terrain.js';   // the default: this page's lake, when no terrain is given (the demos)
import { color, float, mix, smoothstep, abs, positionWorld, normalWorld, mx_noise_float, vec2, vec3, vec4, cameraPosition, cameraViewMatrix, texture, uniform, step, normalize, Fn, If, dFdx, dFdy, struct, positionLocal, modelWorldMatrix } from 'three/tsl';
import { groundTextures, antiTile, cellNoise, top2, heightBlend, canopyTexture } from './ground.js';
import { GROUND_LAYERS } from './ground-layout.js';
import { span } from './profile.js';
import { NIGHT_LAND } from './core/night.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import { FAR_LOOK, farLookOn } from './core/farLook.js';
const FAR_ON = typeof location !== 'undefined' && farLookOn(FLAGS);   // S3 + S4 (node: the old look)
import { FARMAP, farMapOn, farMapFor } from './forest/far-map.js';
import { farMapTexture } from './forest/far-map-texture.js';
import { naipNodes } from './naip.js';
import { canopySurface, CANOPY_SURFACE } from './forest/canopy-surface.js';
import { fineHorizon } from './horizon-fine.js';
import { NAIP_LOOK, naipPick } from '../../src/naip-layout.js';

import { CELLS, ROOT, LOD, lodLeaves, lodSplits, chunkHeights } from './terrain-lod.js';
import { take } from './prebake.js';

export const TERRAIN_CACHE = Object.freeze({ max: 600 });   // chunks kept off screen (phones keep fewer: the tier's terrainCache, src/quality/apply.js)
let SHARED_INDEX = null;
const FOCUS_BUDGET = 4;   // chunks built per frame for the binoculars' focus without a stream (≈ 1–2 ms each)
const q40 = (c) => `${Math.round(c.x / 40)},${Math.round(c.y / 40)},${Math.round(c.z / 40)}`;

// Depth layers by colour, not only by the sky's haze: within ≈ 1 km a little darker and more saturated, from
// ≈ 2.5 km on toward a pale slate blue (half way by 12 km). The aerial perspective then adds the sky's own haze.
// Shared with the trees (src/trees.js) so forest and ground step back together.
// far: the slate colour (an albedo for the lit ground; a radiance for the unlit trees, which pass one dimmed by the
// daylight: a constant one glowed white on the far ridges at night under the night exposure)
export function depthTint(col, worldPos = positionWorld, far = color(FAR_ON ? FAR_LOOK.slate : 0x55697a)) {
  const d = worldPos.sub(cameraPosition).length();
  const near = float(1).sub(smoothstep(600.0, 2200.0, d));
  const farW = smoothstep(2500.0, 14000.0, d), farCol = far;
  const lum = col.dot(vec3(0.3, 0.55, 0.15));
  const rich = mix(vec3(lum), col, float(1.5)).mul(0.85);                   // saturation × 1.5, value × 0.85
  return mix(mix(col, rich, near), farCol, farW.mul(0.55));
}

// forest-floor teal-greens (target-04's near ridges sit at about 46,66,66 after light and grade)

// The cover texture for the shader: the lake level's NLCD classes (32 m) as RGBA8, R forest, G bare rock, B built
// ground (roads, roofs, lots; open developed land at a third), A shrub / grass / wetland. All zero = water or another
// lake (a pond above ours). Linear-filtered; the shader warps its lookup with noise so the 32 m texels never show.
function coverTexture(terrain) {
  const L = terrain.data.levels.find((l) => l.name === 'lake' && l.C);
  if (!L) return null;
  const w = L.cw, h = L.ch, px = new Uint8Array(w * h * 4);
  const RGBA = { 2: [0, 0, 255, 0], 3: [0, 0, 90, 170], 4: [0, 255, 0, 0], 5: [255, 0, 0, 0], 6: [0, 0, 0, 255], 7: [0, 0, 0, 200], 8: [0, 0, 0, 180], 9: [0, 200, 0, 0] };
  for (let k = 0; k < w * h; k++) { const v = RGBA[L.C[k]]; if (v) px.set(v, k * 4); }
  const tex = new THREE.DataTexture(px, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  const cs = L.cstep ?? L.step * L.ck, cx = L.cx0 ?? L.x0, cz = L.cz0 ?? L.z0;   // the phone set's own cover placement (src/terrain-data.js)
  return { tex, x0: cx - cs / 2, z0: cz - cs / 2, sx: w * cs, sz: h * cs };
}

// The season's snow line as a uniform (m, sea level): the terrain's climate.season (the lake profile's); set .value to
// change it live. terrainMaterial sets it to its terrain's.
export const snowLine = uniform(makeTerrain().climate.season.snowLine);

// The ground's look (art/ground): six CC0 PBR layers (src/ground-layout.js GROUND_LAYERS:
// granite, decomposed granite and talus, needle duff, sand, dry grass, snow) splatted by the land cover (NLCD via the
// cover texture), the slope, the elevation, the aspect, the forest's own canopy raster (duff and shade under the
// crowns, dry grass and granite in the gaps) and the shore. Per pixel the two heaviest layers are sampled (anti-tiled,
// two taps a map, src/ground.js antiTile) and blended by their heights; cliffs add the two side projections (triplanar);
// a 27 m macro tap of the same layer breaks the 3.5 m repeat and gives the slabs and benches their large pattern; the
// big noises vary lightness over 30–500 m. Past 700 m only the macro taps remain (their mips are the layers' means).
// The ridge's shadow on the ground comes through the sun light's colour node (src/core/world.js, the forest's skyline).
const TILE = 3.5, MACRO = 27;   // m, the detail and macro tile sizes
// tier: the quality tier as built (src/quality/apply.js tierFor): the photo's level, the canopy's texel, the far map's
// texel, the compressed set; none: High's numbers, all plain (the demos)
export function terrainMaterial(terrain = null, { shore = null, tier = null } = {}) {   // shore: (posWorld) → m to the shore (the water's maps)
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.95, metalness: 0, side: THREE.DoubleSide });   // double: the skirts face either way
  const G = groundTextures({ ktx2: tier?.ktx2 });
  const canopy = canopyTexture();
  const useNaip = true;                             // the NAIP photo ground (the NLCD cover and the procedural colour stay for node)
  const cov = terrain && !useNaip ? coverTexture(terrain) : null;   // (the photo's class index replaces it: the shader's sampler budget is 16)
  const lake = terrain ?? makeTerrain(), TAHOE = lake.climate, Y0 = lake.geo.Y0;   // the lake's numbers (its profile, its fitted island)
  const I = lake.lake.island, S = TAHOE.season;
  snowLine.value = FAR_ON ? Math.min(S.snowLine, FAR_LOOK.snowLine) : S.snowLine;   // S4: the spring snow line, the ground's paint only
  const FM = farMapOn() ? farMapTexture(farMapFor(tier)) : null;   // the far map (?farmap=0: none)
  const CS = useNaip ? canopySurface(tier?.canopy) : null;   // the lidar canopy surface
  const NP = useNaip ? naipNodes({ pick: naipPick(tier?.ground), ktx2: tier?.ktx2 }) : null, FH = fineHorizon();   // the NAIP photo ground and the sky visibility
  const Surface = struct({ color: 'vec3', normal: 'vec3', rough: 'float', relief: 'float', detail: 'float', ao: 'float' }, 'GroundSurface');

  const surface = Fn(() => {
    const P = positionWorld.toVar();
    const h = P.y, nrm = normalWorld;
    const slope = float(1).sub(nrm.y).toVar();                              // 0 flat, 1 vertical
    const p = vec2(P.x, P.z);
    const dist = P.sub(cameraPosition).length().toVar();
    // the texture coordinates and their derivatives first, in uniform control flow (explicit gradients below)
    const uvN = p.div(TILE).toVar(), uvM = p.div(MACRO).toVar();
    const uvX = vec2(P.z, P.y.negate()).div(TILE).toVar(), uvZ = vec2(P.x, P.y.negate()).div(TILE).toVar();   // the cliff projections
    const dxN = dFdx(uvN).toVar(), dyN = dFdy(uvN).toVar(), dxM = dFdx(uvM).toVar(), dyM = dFdy(uvM).toVar();
    const dxX = dFdx(uvX).toVar(), dyX = dFdy(uvX).toVar(), dxZ = dFdx(uvZ).toVar(), dyZ = dFdy(uvZ).toVar();
    const shoreD = shore ? shore(P).toVar() : null;                           // m to the shore (negative on the lake)
    const big = mx_noise_float(p.mul(0.0021)).toVar();                      // ≈ 500 m patches
    const mid = mx_noise_float(p.mul(0.011)).toVar();                       // ≈ 90 m
    const small = mx_noise_float(p.mul(0.031)).toVar();                     // ≈ 30 m patches
    const fine = mx_noise_float(p.mul(0.23)).toVar();                       // ≈ 4 m

    // the ground cover (NLCD 2021 via the cover texture), its lookup warped ± 20 m so 32 m texels read as natural edges
    let forestW, rockC, urbanW, lowW, inside;
    if (cov) {
      const warp = vec2(mx_noise_float(p.mul(0.02).add(3.1)), mx_noise_float(p.mul(0.02).sub(7.7))).mul(20.0);
      const uv = p.add(warp).sub(vec2(cov.x0, cov.z0)).div(vec2(cov.sx, cov.sz));
      const c = texture(cov.tex, uv);   // data row 0 (north, z0) at v = 0
      inside = step(0.0, uv.x).mul(step(uv.x, 1.0)).mul(step(0.0, uv.y)).mul(step(uv.y, 1.0));
      forestW = c.r; rockC = c.g; urbanW = c.b; lowW = c.a;
    }
    // past the cover grid (the far Sierra ring, ≥ 30 km): forest below the treeline, bare rock above it
    const elev = h.add(Y0).toVar();
    const treeline = smoothstep(float(TAHOE.treeline - 300), float(TAHOE.treeline), elev.add(big.mul(80.0)));
    const fForest = float(0.75).mul(treeline.oneMinus()), fLow = float(0.25).mul(treeline.oneMinus());
    if (cov) {
      forestW = mix(fForest, forestW, inside); lowW = mix(fLow, lowW, inside); rockC = mix(treeline, rockC, inside); urbanW = urbanW.mul(inside);
    } else { forestW = fForest; lowW = fLow; rockC = treeline; urbanW = float(0); }
    // the NAIP photo (src/naip.js): the base colour where it has landed, and its class index (forest, brush, bare) in place
    // of the 30 m NLCD cover, so the detail layers follow the real crowns, shrubs and rock
    const nS = NP ? NP.sample(p) : { rgb: vec3(0), w: float(0), mask: vec3(0), mw: float(0) };
    const naipTop = nS.w.mul(smoothstep(-0.5, 0.15, h));                       // the photo above the lake's edge; the bed below stays ours
    forestW = mix(forestW, nS.mask.r, nS.mw); lowW = mix(lowW, nS.mask.g, nS.mw); rockC = mix(rockC, nS.mask.b, nS.mw);
    // the forest's canopy raster (world.js paints it from the scatter): crowns and brush, 0 off its region
    // with the lidar canopy surface the crowns are the lidar's (cover) and the brush the photo's class: the scatter raster's sampler
    // is not bound (the fragment stage's budget is 16 textures); without it (?canopy=0, ?lidar=0) the raster is read as before
    const cs = CS ? CS.sample(p) : null;
    let crown, brush;
    if (cs) { crown = mix(cs.cover.mul(cs.w), float(0), float(0)).toVar(); brush = nS.mask.g.mul(nS.mw).mul(0.8).toVar(); }
    else {
      const cuv = canopy.uv(p);
      const cin = step(0.0, cuv.x).mul(step(cuv.x, 1.0)).mul(step(0.0, cuv.y)).mul(step(cuv.y, 1.0));
      const cp = texture(canopy.tex, cuv);
      crown = cp.r.mul(cin).toVar(); brush = cp.g.mul(cin).toVar();
    }
    // Fannette Island: granite and brush, no forest floor or meadow (the ellipse of the terrain's lake.island)
    const ic = Math.cos(I.rotDeg * Math.PI / 180), is = Math.sin(I.rotDeg * Math.PI / 180);
    const idx = P.x.sub(I.x), idz = P.z.sub(I.z);
    const ilx = idx.mul(ic).add(idz.mul(is)), ilz = idz.mul(ic).sub(idx.mul(is));
    const onIsland = smoothstep(1.3, 1.0, vec2(ilx.div(I.a), ilz.div(I.b)).length());
    forestW = forestW.mul(onIsland.oneMinus()).toVar(); lowW = lowW.mul(onIsland.oneMinus()).toVar();

    // --- the layer weights --------------------------------------------------------------------------------------
    // granite outcrops by slope: past ≈ 38°, in full by ≈ 50° (cliffs, the bay's walls, the knob of the island)
    const cliff = smoothstep(0.2, 0.36, slope.add(small.mul(0.04)).add(fine.mul(0.02))).toVar();
    const rockW = rockC.max(cliff).toVar();
    // the shore: granite boulders from the water to ≈ 4.5 m; sand on low, gentle ground within ≈ 2.5 m of the lake
    // (the beaches: within ≈ 30 m of the water by the water's shore maps; by height alone the bay's whole flat head read as sand)
    const nearShore = shoreD ? smoothstep(34.0, 12.0, shoreD) : float(1);
    const beach = smoothstep(0.08, 0.035, slope).mul(smoothstep(2.4, 1.4, h)).mul(nearShore).mul(float(1).sub(urbanW)).toVar();
    // (the boulders too: by height alone the bay's flat head, 2–5 m up for hundreds of metres inland, was all shore rock)
    const nearRock = shoreD ? smoothstep(45.0, 15.0, shoreD) : float(1);
    const shoreW = smoothstep(5.2, 4.2, h.add(small.mul(0.6))).max(beach.mul(smoothstep(7.0, 5.5, h))).mul(nearRock).toVar();
    // where the rock cover is slabs and boulders rather than decomposed granite: patches at 90 m and 4 m
    const slabs = smoothstep(-0.1, 0.6, mid.add(fine.mul(0.35)));
    const openFlat = smoothstep(0.16, 0.05, slope);                           // meadow ground
    const high = smoothstep(float(TAHOE.treeline - 250), float(TAHOE.treeline + 50), elev);   // talus above the treeline
    const south = nrm.z.mul(smoothstep(0.02, 0.3, slope)).mul(0.5).add(0.5);  // 1 on a south face (drier, more grass and DG)
    let granite = cliff.max(rockC.mul(slabs)).max(shoreW.mul(beach.oneMinus()).mul(0.9));
    let talus = rockC.mul(slabs.oneMinus()).mul(cliff.oneMinus())
      .add(smoothstep(0.12, 0.3, slope).mul(cliff.oneMinus()).mul(forestW.oneMinus()).mul(0.5))   // open slopes: DG
      .add(high.mul(cliff.oneMinus()))
      .add(lowW.mul(openFlat.oneMinus()).mul(0.6))                            // the brush's ground
      .add(onIsland.mul(0.5));
    // the forest floor: duff everywhere under a stand, deepest under the crowns, DG showing in patches (the 30 m noise)
    let duff = forestW.mul(crown.mul(0.5).add(0.6)).mul(cliff.oneMinus()).mul(small.mul(0.25).add(1.05));
    let grass = lowW.mul(openFlat).mul(1.4)                                    // flat low vegetation: a meadow outright
      .add(forestW.mul(crown.oneMinus()).mul(openFlat).mul(smoothstep(450.0, 100.0, h)).mul(south.mul(0.4).add(0.6)).mul(0.35))
      .add(forestW.oneMinus().mul(rockW.oneMinus()).mul(lowW.oneMinus()).mul(openFlat).mul(0.4));
    // normalise the four base layers (the rest is decomposed granite, Tahoe's default ground), then sand, then snow
    // the unclaimed ground: meadow on flat, low ground near the lake (the NLCD's developed texels round the house carry
    // no vegetation weight, yet the real grounds are grass under pines), decomposed granite on the slopes and high up
    const sum = granite.add(talus).add(duff).add(grass);
    const rest = float(1).sub(sum).max(0.0), restGrass = openFlat.mul(smoothstep(400.0, 80.0, h)).mul(rockW.oneMinus()).mul(onIsland.oneMinus());
    grass = grass.add(rest.mul(restGrass)); talus = talus.add(rest.mul(restGrass.oneMinus()));
    const inv = float(1).div(granite.add(talus).add(duff).add(grass).max(1e-3));
    const sandW = beach;
    const northness = nrm.z.negate().mul(smoothstep(0.02, 0.3, slope));                                // + on a north face
    const line = snowLine.sub(northness.mul(S.aspectM)).add(big.mul(70.0)).add(small.mul(25.0));
    const snowW = smoothstep(line, line.add(S.fullM), elev).mul(float(1).sub(smoothstep(0.32, 0.5, slope.add(fine.mul(0.05))))).toVar();
    const keep = sandW.oneMinus().mul(snowW.oneMinus()).mul(inv);
    const w = [granite.mul(keep), talus.mul(keep), duff.mul(keep), sandW.mul(snowW.oneMinus()), grass.mul(keep), snowW];
    const { w0, i0, w1, i1 } = top2(w);
    const b = w1.div(w0.add(w1).max(1e-4)).toVar();                          // the second layer's share

    // --- the taps: macro always (mips carry the distance), detail within 700 m, cliffs triplanar -----------------
    const near = float(1).sub(smoothstep(350.0, 700.0, dist)).toVar();
    const kM = cellNoise(uvM).toVar();
    const m0 = antiTile(G.albedo, uvM, i0, { k: kM, dx: dxM, dy: dyM }).rgb.toVar();
    const m1 = antiTile(G.albedo, uvM, i1, { k: kM, dx: dxM, dy: dyM }).rgb.toVar();
    const col = mix(m0, m1, b).toVar();
    const n = vec3(nrm).toVar();
    const detail = float(1).toVar();                                         // the near texture's grain over its mean (for paints laid over the ground)
    If(near.greaterThan(0.001), () => {
      const kN = cellNoise(uvN);
      const a0 = antiTile(G.albedo, uvN, i0, { k: kN, dx: dxN, dy: dyN }).rgb.toVar();
      const a1 = antiTile(G.albedo, uvN, i1, { k: kN, dx: dxN, dy: dyN }).rgb.toVar();
      const p0 = antiTile(G.pack, uvN, i0, { k: kN, dx: dxN, dy: dyN }), p1 = antiTile(G.pack, uvN, i1, { k: kN, dx: dxN, dy: dyN });
      // cliffs: the side projections (GPU Gems 3 ch. 1 § 1.5), weighted by the normal's x and z, over the top-down tap
      const tri = smoothstep(0.42, 0.62, slope).toVar();
      If(tri.greaterThan(0.01), () => {
        const ax = abs(nrm.x), az = abs(nrm.z), sx = ax.div(ax.add(az).max(1e-3));
        const side = (i) => mix(texture(G.albedo, uvZ).depth(i).grad(dxZ, dyZ).rgb, texture(G.albedo, uvX).depth(i).grad(dxX, dyX).rgb, sx);
        a0.assign(mix(a0, side(i0), tri)); a1.assign(mix(a1, side(i1), tri));
      });
      const hb = heightBlend(b, p0.b, p1.b);
      // the layer's macro tap over its own mean (a 4 × 4 mip): slabs, benches and drifts at 27 m, no new colour
      const mean0 = texture(G.albedo, uvM).depth(i0).level(7.0).rgb, mean1 = texture(G.albedo, uvM).depth(i1).level(7.0).rgb;
      const mac = mix(m0.div(mean0.max(0.02)), m1.div(mean1.max(0.02)), hb).min(1.6);
      const nearC = mix(a0, a1, hb).mul(mix(vec3(1.0), mac, 0.4));
      col.assign(mix(col, nearC, near));
      detail.assign(mix(float(1), nearC.dot(vec3(0.3, 0.55, 0.15)).div(mix(mean0, mean1, hb).dot(vec3(0.3, 0.55, 0.15)).max(0.02)).clamp(0.4, 1.8), near));
      // the texture normal (GL: +G toward −v = north), bent onto the geometric one
      const nt = mix(p0.rg, p1.rg, hb).mul(2.0).sub(1.0).mul(near.mul(0.9).mul(tri.oneMinus()));
      n.assign(normalize(vec3(nrm.x.add(nt.x), nrm.y, nrm.z.sub(nt.y))));
    });

    // --- colour: the forest's shade, the brush's mass, the macro variation, the towns, the far canopy, the shore ---
    col.mulAssign(float(1).sub(crown.mul(forestW).mul(0.35)));                                 // the floor under the crowns
    // the brush: greenleaf manzanita and huckleberry oak mat the open slopes (the cover's low vegetation off the flats,
    // the island's gentler ground, the scatter's domes): a dark olive mass from above, DG and granite through its gaps
    const brushMat = lowW.mul(openFlat.oneMinus()).mul(small.mul(0.2).add(0.6))
      .max(urbanW.mul(openFlat.oneMinus()).mul(small.mul(0.2).add(0.35)))       // the road cuts: manzanita colonises them
      .max(onIsland.mul(smoothstep(0.45, 0.2, slope)).mul(mid.mul(0.2).add(0.55)))
      .max(brush.mul(0.7)).mul(snowW.oneMinus()).mul(sandW.oneMinus()).mul(cliff.oneMinus());
    col.assign(mix(col, col.mul(vec3(0.36, 0.40, 0.24)).add(vec3(0.015, 0.025, 0.008)), brushMat.mul(0.85)));
    // granite's weathering: dark lichen and soil pockets in patches, water streaks down the steep faces
    const streak = mx_noise_float(vec2(P.x.add(P.z).mul(0.08), P.y.mul(0.6)));
    const dark = smoothstep(0.3, 0.75, fine.add(small.mul(0.5))).mul(0.35).add(smoothstep(0.35, 0.75, streak).mul(slope.mul(1.4).clamp(0, 1)).mul(0.3));
    col.mulAssign(float(1).sub(dark.mul(w[0].add(w[1].mul(0.4)))));
    // the season's grass (TAHOE.season.grassDry): the tile is June's fresh green; early July starts to cure (0.35), late in the year straw
    const dry = S.grassDry ?? 1;
    if (dry > 0) col.assign(mix(col, vec3(col.dot(vec3(0.3, 0.55, 0.15))).mul(vec3(1.3, 1.12, 0.76)), w[4].mul(dry)));
    // the bloom (TAHOE.season.bloom): wildflower clumps in the meadows within 700 m (yellow, purple, white on a 0.4 m
    // noise), and a pink-white lift on the manzanita mat
    const bloom = S.bloom ?? 0;
    if (bloom > 0) {
      const fl = mx_noise_float(p.mul(2.3)), fl2 = mx_noise_float(p.mul(1.9).add(vec2(41.7, -13.1)));
      const dots = smoothstep(0.5, 0.68, fl).mul(w[4]).mul(near).mul(bloom * 0.7);
      const petal = mix(mix(vec3(0.85, 0.72, 0.12), vec3(0.55, 0.32, 0.72), step(0.0, fl2)), vec3(0.9, 0.9, 0.85), smoothstep(0.3, 0.6, fl2));
      col.assign(mix(col, petal, dots));
      col.addAssign(vec3(0.028, 0.012, 0.02).mul(brushMat.mul(bloom * 0.6)));
    }
    col.mulAssign(float(1).add(big.mul(0.10)).add(mid.mul(0.07)).add(small.mul(0.05)));         // lightness over 30–500 m
    // the photo is the base colour: the NAIP albedo (de-lit, graded) with the CC0 layers' near grain on its luminance
    // (`detail`: 1 beyond 700 m, the layer's grain over its mean up close); the season's snow stays ours
    const naipBlend = naipTop.mul(float(1).sub(snowW)).toVar();
    col.assign(mix(col, nS.rgb.mul(detail.pow(NAIP_LOOK.detailNear)), naipBlend));
    // the lidar's low vegetation (brush) where the photo reads bare ground: the olive mat of manzanita and huckleberry oak under the shrub meshes
    if (cs) col.assign(mix(col, col.mul(vec3(0.55, 0.64, 0.40)), cs.low.mul(cs.w).mul(0.85).mul(snowW.oneMinus()).mul(float(1).sub(smoothstep(900.0, 2500.0, dist)))));
    // built ground: asphalt, roofs and lots, a mid grey-beige (the towns branch paints the real ones over this)
    const urbanC = mix(color(0x5e5b55), color(0x7c776c), small.mul(0.5).add(0.5));
    // only a light tint, on flat built ground (the towns paint the real lots and roads); a cut slope keeps the DG and
    // granite textures: at 85 % this flat grey-beige was the paper band under the overlook (2026-10-29, cam O)
    col.assign(mix(col, urbanC, urbanW.mul(0.3).mul(w[4].oneMinus()).mul(openFlat).mul(float(1).sub(naipBlend))));
    // the forest's canopy far off (the impostors thin past ≈ 3 km; past that the ground must read as the forest itself)
    const canopyC = mix(color(0x13261f), color(0x1d3326), mid.mul(0.5).add(0.5));
    col.assign(mix(col, canopyC, smoothstep(2500.0, 6000.0, dist).mul(forestW).mul(snowW.oneMinus()).mul(float(1).sub(naipBlend))));
    // the far map (src/forest/far-map.js): past FARMAP.near the rim's stands are this raster, not
    // cards: their crowns darken the ground to the stands' own shade (darker than the cover's canopy tint: a stand is
    // a crown mass with its shadowed side), the gaps between them keep the ground. ?farmap=0: the cards, as before.
    if (FM) {
      const fm = texture(FM.tex, FM.uv(p));
      const inFM = step(0.0, FM.uv(p).x).mul(step(FM.uv(p).x, 1.0)).mul(step(0.0, FM.uv(p).y)).mul(step(FM.uv(p).y, 1.0));
      const farW = smoothstep(float(FARMAP.near), float(FARMAP.far), dist).mul(inFM).mul(snowW.oneMinus()).mul(float(1).sub(naipBlend.mul(0.75)));   // the photo already holds the stands
      const standC = mix(color(0x0e1c16), color(0x172a20), small.mul(0.5).add(0.5));
      col.assign(mix(col, standC, fm.r.mul(farW).mul(0.9)));
    }
    // the lidar canopy surface (src/forest/canopy-surface.js): past the lift's ramp the ground IS the crowns. The photo gives the
    // colour; the relief shades the clumps (sunlit tops, dark gaps between crowns) and the top's slope bends the normal
    let canW = float(0), canN = null;
    if (cs) {
      canW = cs.w.mul(smoothstep(0.3, 0.7, cs.cover)).mul(smoothstep(float(CANOPY_SURFACE.liftNear), float(CANOPY_SURFACE.liftFar), dist)).mul(snowW.oneMinus()).toVar();
      const shade = float(1).add(cs.rel.mul(0.09)).clamp(0.4, 1.35);
      const sunTop = vec3(1.08, 1.06, 0.82);   // sunlit crown tops lean yellow-green; the gaps stay cool
      // the lifted surface IS the crowns, whatever the photo says under it (Fannette's crowns sit over rock in the NAIP): their own dark
      // blue-green, the photo's tone and grain kept at a third, shaded by the relief
      const crownC = vec3(0.0075, 0.0125, 0.0068);
      const base = mix(col, crownC, canW.mul(0.7));
      col.assign(mix(col, base.mul(shade).mul(mix(vec3(0.95, 1.0, 1.04), sunTop, shade.sub(0.7).clamp(0, 1))), canW));
      canN = vec3(cs.gx.negate(), 0, cs.gz.negate()).mul(0.4).mul(canW).mul(float(1).sub(smoothstep(900.0, 3500.0, dist)));
    }
    // S3: the far ground darker (its photo is summer-pale granite; at 20 km the crest read as a grey wall), never the snow
    if (FAR_ON) col.mulAssign(mix(float(1), float(FAR_LOOK.albedoK), smoothstep(float(FAR_LOOK.albedoNear), float(FAR_LOOK.albedoFar), dist).mul(snowW.oneMinus())));
    // the shore: darker and wet below 1 m, a dark wet line at y = 0; the bed under the clear water: pale granite sand
    // and cobbles in the shallows (the turquoise), darker silt deeper
    const boulders = mx_noise_float(p.mul(0.55));                             // ≈ 2 m boulders
    const damp = smoothstep(1.0, 0.0, h).mul(shoreW);
    const wetLine = float(1).sub(smoothstep(0.0, 0.35, abs(h)));
    const bed = mix(mix(color(0x8a8068), color(0x6f6a5c), boulders.mul(0.5).add(0.5)), color(0x3a3a33), smoothstep(-4.0, -25.0, h));
    col.assign(mix(col, col.mul(0.55), damp.mul(float(1).sub(naipBlend.mul(0.7)))));   // the photo's shore is already wet and dark
    col.assign(mix(col, color(0x1c1a16), wetLine.mul(0.9)));
    col.assign(mix(col, bed, smoothstep(-0.4, -1.5, h)));
    // roughness by the layers (wet stone shines a little); the rock relief's amplitude for the normal pass
    let rough = float(0);
    GROUND_LAYERS.forEach((L, k) => { rough = rough.add(w[k].mul(L.roughness)); });
    rough = mix(rough, float(0.35), damp.max(wetLine));
    const relief = rockW.max(shoreW.mul(0.6)).mul(float(1).sub(smoothstep(150.0, 500.0, dist)));
    // the sky left open: the bay's skyline (src/horizon-fine.js) and the crown's own foliage; the indirect light only, so the
    // blue sky stops lifting dark slopes and stands (the 'purple ground')
    const ao = FH.sky(P).mul(mix(float(1), float(NAIP_LOOK.forestAmbient), nS.mask.r.mul(nS.mw).mul(float(1).sub(snowW))));
    if (canN) n.assign(normalize(n.add(canN)));
    return Surface(col, n, rough, relief, detail, ao);
  })();

  m.colorNode = depthTint(surface.get('color'));
  // the starlit night's lift (round 5; src/core/night.js NIGHT_LAND, 0 until the night writes it): the albedo × a cool light,
  // more on the faces turned up to the sky (the slopes keep their shape), so the land reads blue-grey, never pure black
  m.emissiveNode = depthTint(surface.get('color')).mul(NIGHT_LAND).mul(float(0.45).add(normalWorld.y.max(0).mul(0.55)));
  // the far map's stands lift the far ground by their height × their cover (the ridgelines keep the forest's
  // thickness without cards); in the vertex stage, so an explicit level
  if (FM) {
    const wp = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const fuv = FM.uv(vec2(wp.x, wp.z)), fm = texture(FM.tex, fuv).level(0);
    const inFM = step(0.0, fuv.x).mul(step(fuv.x, 1.0)).mul(step(0.0, fuv.y)).mul(step(fuv.y, 1.0));
    const lift = fm.g.mul(FARMAP.topM).mul(fm.r.min(1)).mul(smoothstep(float(FARMAP.near), float(FARMAP.far), wp.sub(cameraPosition).length())).mul(inFM);
    m.positionNode = positionLocal.add(vec3(0, lift, 0));
  }
  if (CS) {   // the lidar canopy surface lifts the ground to the crowns (explicit level in the vertex stage)
    const wp = modelWorldMatrix.mul(vec4(positionLocal, 1)).xyz;
    const lift = CS.lift(vec2(wp.x, wp.z), wp.sub(cameraPosition).length(), wp.y);
    m.positionNode = (m.positionNode ?? positionLocal).add(vec3(0, lift, 0));
  }
  // granite relief on rock within ≈ 500 m: a 3-D noise's gradient bends the normal, so cliffs and the island's knob
  // read as broken, jointed stone, not a smooth skin (the 1 m lidar holds the shape, not the ledges). A branch: the
  // far ground and the forest skip the eight noise reads.
  m.normalNode = cameraViewMatrix.transformDirection(Fn(([n0, bumpAmp]) => {
    const n = n0.toVar();
    If(bumpAmp.greaterThan(0.02), () => {
      const q = positionWorld.mul(vec3(0.55, 0.9, 0.55)).toVar();   // flatter along y: the joints of sheeted granite
      const f = (v) => mx_noise_float(v).add(mx_noise_float(v.mul(3.3)).mul(0.4));
      const e = 0.06, f0 = f(q);
      const g = vec3(f(q.add(vec3(e, 0, 0))).sub(f0), f(q.add(vec3(0, e, 0))).sub(f0), f(q.add(vec3(0, 0, e))).sub(f0)).div(e);
      n.assign(normalize(n.sub(g.sub(n.mul(g.dot(n))).mul(bumpAmp.mul(0.32)))));
    });
    return n;
  })(surface.get('normal'), surface.get('relief')));
  m.roughnessNode = surface.get('rough');
  m.aoNode = surface.get('ao');
  // hooks for src/core/world.js: the canopy raster to paint from the forest's scatter, the textures' load
  // detail: the near texture's grain (0.4 .. 1.8, 1 past 700 m) for anything painted over the ground (the towns' runs,
  // lots and the Hwy 89 cut): multiply a flat paint by it so it keeps the ground's grain close up
  // refined: the photo ground and the canopy raster at the tier's own files, and the fine skyline (a slow link fetches it after the card) (a slow link loads coarse ones first and these
  // after the first live frame, perf/slow-loading; at once otherwise): the core captures the water's probe again then
  m.userData.ground = { textures: G, canopy, ready: G.ready, detail: surface.get('detail'),
    refined: Promise.all([NP?.refined, CS?.refined, FH?.ready]).then(() => true, () => false), coarseFirst: !!NP?.info?.().coarseFirst };
  return m;
}

// hs: the chunk's heights (chunkHeights), from the load-time bake (src/prebake.js) when it has them
function buildChunk(heightAt, x0, z0, size, hs = chunkHeights(heightAt, x0, z0, size)) {
  const n = CELLS, step = size / n, N = n + 1, B = n + 3;                  // B: the grid plus a one-sample border
  const skirt = Math.max(4, size * 0.02);
  const vCount = N * N + 4 * N;
  const pos = new Float32Array(vCount * 3), nor = new Float32Array(vCount * 3);
  const half = size / 2;
  let maxH = -Infinity, minH = Infinity;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const h = hs[(j + 1) * B + i + 1], k = (j * N + i) * 3;
    pos[k] = i * step - half; pos[k + 1] = h; pos[k + 2] = j * step - half;
    const dx = (hs[(j + 1) * B + i + 2] - hs[(j + 1) * B + i]) / (2 * step);
    const dz = (hs[(j + 2) * B + i + 1] - hs[j * B + i + 1]) / (2 * step);
    const l = Math.hypot(dx, 1, dz);
    nor[k] = -dx / l; nor[k + 1] = 1 / l; nor[k + 2] = -dz / l;
    maxH = Math.max(maxH, h); minH = Math.min(minH, h);
  }
  const idx = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // skirts: each edge's vertices copied `skirt` metres down, joined to the edge
  const edges = [
    Array.from({ length: N }, (_, i) => i),                               // north (j = 0)
    Array.from({ length: N }, (_, i) => n * N + i),                       // south
    Array.from({ length: N }, (_, j) => j * N),                           // west
    Array.from({ length: N }, (_, j) => j * N + n),                       // east
  ];
  let v = N * N;
  edges.forEach((edge, e) => {
    const start = v;
    for (const s of edge) {
      pos.set([pos[s * 3], pos[s * 3 + 1] - skirt, pos[s * 3 + 2]], v * 3);
      nor.set([nor[s * 3], nor[s * 3 + 1], nor[s * 3 + 2]], v * 3);
      v++;
    }
    for (let i = 0; i < n; i++) {
      const a = edge[i], b = edge[i + 1], c = start + i, d = start + i + 1;
      if (e === 0 || e === 3) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  // every chunk has the same topology: one index buffer for all of them (a third of the terrain's GPU bytes;
  // world streaming). A chunk's dispose must unset it first (TerrainLOD.drop), or three frees it for all.
  g.setIndex(SHARED_INDEX ??= new THREE.BufferAttribute(vCount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-half, minH - skirt, -half), new THREE.Vector3(half, maxH, half));
  g.boundingSphere = g.boundingBox.getBoundingSphere(new THREE.Sphere());
  return { geometry: g, minH, maxH };
}

export class TerrainLOD extends THREE.Group {
  // split: the tier's split distance factor (live: setSplit, the governor); cacheMax: chunks kept off screen (fewer on a phone)
  constructor(terrain, { material = terrainMaterial(), split = LOD.split, cacheMax = TERRAIN_CACHE.max } = {}) {
    super();
    this.name = 'terrain';
    this.terrain = terrain;
    this.material = material;
    this.split = split; this.cacheMax = cacheMax;
    this.cache = new Map();          // key → { mesh, used }
    this.frame = 0;
    this.stats = { chunks: 0, triangles: 0, built: 0, buildMs: 0 };
    this._last = null;
    this.stream = null;              // the streaming manager, once attached (attachStream)
  }

  // the leaves for a camera position: split while the camera is within SPLIT × the node size
  select(cam, focus = null) { return lodLeaves(cam, focus, this.split); }
  setSplit(split) { this.split = split; }

  _mesh(x0, z0, size, hs) {
    const { geometry } = buildChunk(this.terrain.heightAt, x0, z0, size, hs);
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(x0 + size / 2, 0, z0 + size / 2);
    mesh.matrixAutoUpdate = false; mesh.updateMatrix();
    return mesh;
  }
  _drop(e) { e.mesh.geometry.index = null; e.mesh.geometry.dispose(); }   // the shared index stays

  // focus: the binoculars' virtual eye (terrain-lod.js lodSplits), or null. Streamed, the focus's chunks are wanted
  // (not due: the stream's workers build them, a coarser chunk stands in until they are in). Without a stream they
  // are built at most FOCUS_BUDGET a frame and the drawn set swaps when all are ready (no holes, no stall).
  // (sticky: the core's own per-frame call passes none and keeps the mode's; null clears it)
  update(cam, focus) {
    if (focus !== undefined) this.focus = focus;
    focus = this.focus ?? null;
    if (this.stream) return this._updateStreamed(cam);
    // the selection only changes when the camera (or the focus) crosses a leaf-sized step
    const key = q40(cam) + (focus ? `|${q40(focus)}` : '');
    if (key === this._last && !this._pending) return false;
    this._last = key;
    this.frame++;
    const t0 = performance.now();
    const leaves = this.select(cam, focus);
    if (focus) {
      const missing = leaves.filter(([x0, z0, size]) => !this.cache.has(`${x0},${z0},${size}`));
      if (missing.length > FOCUS_BUDGET) {
        for (const [x0, z0, size] of missing.slice(0, FOCUS_BUDGET)) {
          const k = `${x0},${z0},${size}`, hs = this.terrain.seed != null ? take(`lod:${this.terrain.seed}:${k}`) : undefined;
          this.cache.set(k, { mesh: this._mesh(x0, z0, size, hs), used: this.frame });
        }
        this._pending = true;
        this.stats = { ...this.stats, built: FOCUS_BUDGET, pending: missing.length - FOCUS_BUDGET, buildMs: +(performance.now() - t0).toFixed(1) };
        return false;
      }
    }
    this._pending = false;
    this.clear();
    let tris = 0, built = 0;
    for (const [x0, z0, size] of leaves) {
      const k = `${x0},${z0},${size}`;
      let e = this.cache.get(k);
      if (!e) {
        const hs = this.terrain.seed != null ? take(`lod:${this.terrain.seed}:${k}`) : undefined;
        e = { mesh: this._mesh(x0, z0, size, hs) }; this.cache.set(k, e); built++;
      }
      e.used = this.frame;
      this.add(e.mesh);
      tris += e.mesh.geometry.index.count / 3;
    }
    // drop the least recently used chunks past the cache size
    if (this.cache.size > this.cacheMax) {
      const old = [...this.cache.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.cache.size - this.cacheMax);
      for (const [k, e] of old) { this._drop(e); this.cache.delete(k); }
    }
    this.stats = { chunks: leaves.length, triangles: tris, built, buildMs: +(performance.now() - t0).toFixed(1) };
    if (built) span(`terrain:lod ${built} chunks`, t0)();
    return true;
  }

  // --- streamed: the chunks' heights come from the stream's workers, each chunk's mesh is one upload
  // slice, and the drawn set falls back to the nearest resident ancestor where a leaf is not in yet (a coarser
  // chunk, never a hole). The coarse levels (≥ PERM m) are always resident: the fallback of last resort.
  attachStream(stream, { run = null } = {}) {
    const PERM = TerrainLOD.PERM, lod = this, seed = this.terrain.seed;
    this.stream = stream;
    this._dirty = true; this._wantKey = null; this._want = [];
    const perm = [];
    for (let s = ROOT; s >= PERM; s /= 2) for (let z = -ROOT / 2; z < ROOT / 2; z += s) for (let x = -ROOT / 2; x < ROOT / 2; x += s) perm.push(`${x},${z},${s}`);
    this._perm = new Set(perm);
    const parse = (k) => k.split(',').map(Number);
    stream.register({
      name: 'terrain',
      // the selection at the camera (due now) and at the predicted path's points (prefetch, by their time), plus
      // the permanent coarse levels; recomputed when the camera or the path crosses a 40 m step
      want(view) {
        const key = view.path.map((p) => `${Math.round(p.x / 40)},${Math.round(p.z / 40)}`).join(';') + `|${Math.round(view.y / 40)}` + (lod.focus ? `|${q40(lod.focus)}` : '');
        if (key !== lod._wantKey) {
          lod._wantKey = key;
          const out = new Map();
          for (const p of view.path) {
            for (const [x0, z0, size] of lodLeaves({ x: p.x, y: view.y, z: p.z }, null, lod.split)) {
              const k = `${x0},${z0},${size}`, o = out.get(k);
              if (!o || p.t < o.eta) out.set(k, { key: k, eta: p.t, due: p.t === 0 || (o?.due ?? false), need: p.t === 0 || (o?.need ?? false), c: [x0, z0, size] });
            }
          }
          // the binoculars' focus (update(cam, focus)): its extra leaves, wanted soon but never due (the fallback covers)
          if (lod.focus) for (const [x0, z0, size] of lodLeaves({ x: view.x, y: view.y, z: view.z }, lod.focus, lod.split)) {
            const k = `${x0},${z0},${size}`;
            if (!out.has(k)) out.set(k, { key: k, eta: 0.5, due: false, need: false, c: [x0, z0, size] });
          }
          for (const k of perm) if (!out.has(k)) out.set(k, { key: k, eta: 6, due: false });
          lod._want = [...out.values()];
        }
        // a leaf the camera needs now is late only if nothing finer covers it (a merge behind the camera shows the
        // children it had until the coarser chunk is in: more detail, not less)
        for (const w of lod._want) if (w.need) w.due = !lod.cache.has(w.key) && !lod._finer(w.c[0], w.c[1], w.c[2]);
        return lod._want;
      },
      // keep a chunk while the camera is within twice its split distance, under the cache size; the coarse ones always
      keep(k, view) {
        if (lod._perm.has(k)) return true;
        if (lod.cache.size > lod.cacheMax) return false;
        const [x0, z0, size] = parse(k);
        const dx = Math.max(x0 - view.x, 0, view.x - (x0 + size)), dz = Math.max(z0 - view.z, 0, view.z - (z0 + size));
        return Math.hypot(dx, dz) < 3.2 * size;
      },
      build(k) {
        const c = parse(k);
        const hs = seed != null ? take(`lod:${seed}:${k}`) : undefined;
        if (hs) return hs;
        if (stream.settling) return null;   // the start and captures: in place on upload, as before streaming
        return run ? run('lod', { seed, chunks: [c] }).then((r) => r[0], () => null) : null;
      },
      upload(k, hs) {
        if (!lod.cache.has(k)) { const [x0, z0, size] = parse(k); lod.cache.set(k, { mesh: lod._mesh(x0, z0, size, hs ?? undefined), used: lod.frame }); }
        lod._dirty = true;
        return true;
      },
      drop(k) { const e = lod.cache.get(k); if (e) { lod._drop(e); lod.cache.delete(k); lod._dirty = true; } },
    });
    // what is built already (the first update, from the load-time bake) is resident
    const s = stream.systems.get('terrain');
    for (const k of this.cache.keys()) s.resident.set(k, { t: 0 });
  }

  _finer(x0, z0, size) {
    if (this.cache.has(`${x0},${z0},${size}`) || size <= 40) return false;
    const h = size / 2;
    return [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]].every(([x, z]) => this.cache.has(`${x},${z},${h}`) || this._finer(x, z, h));
  }

  _updateStreamed(cam) {
    const key = q40(cam) + (this.focus ? `|${q40(this.focus)}` : '');
    if (key === this._last && !this._dirty) return false;
    this._last = key; this._dirty = false;
    this.frame++;
    // the quadtree as lodLeaves walks it; a selected leaf that is not in yet is covered by its resident children (or
    // grandchildren: what was drawn before a merge), else its nearest resident ancestor stands in for the whole
    // subtree (a coarser chunk, never a hole). Same set as lodLeaves when everything is in.
    const has = (x0, z0, size) => this.cache.has(`${x0},${z0},${size}`);
    let missing = 0, fallbacks = 0;
    const below = (x0, z0, size, depth) => {   // resident descendants that tile the node, or null
      if (has(x0, z0, size)) return [[x0, z0, size]];
      if (depth === 0 || size <= 40) return null;
      const h = size / 2, out = [];
      for (const [x, z] of [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]]) { const c = below(x, z, h, depth - 1); if (!c) return null; out.push(...c); }
      return out;
    };
    const visit = (x0, z0, size) => {
      if (!lodSplits(cam, x0, z0, size, this.focus, this.split)) { if (!has(x0, z0, size)) missing++; return below(x0, z0, size, 2); }
      const h = size / 2, out = [];
      let ok = true;
      for (const [x, z] of [[x0, z0], [x0 + h, z0], [x0, z0 + h], [x0 + h, z0 + h]]) { const c = visit(x, z, h); if (!c) { ok = false; break; } out.push(...c); }
      if (ok) return out;
      if (has(x0, z0, size)) { fallbacks++; return [[x0, z0, size]]; }
      return null;
    };
    const draw = visit(-ROOT / 2, -ROOT / 2, ROOT) ?? [];
    this.clear();
    let tris = 0;
    for (const c of draw) {
      const e = this.cache.get(`${c[0]},${c[1]},${c[2]}`); e.used = this.frame;
      this.add(e.mesh); tris += e.mesh.geometry.index.count / 3;
    }
    this.stats = { chunks: draw.length, triangles: tris, built: 0, buildMs: 0, missing, fallbacks, cached: this.cache.size };
    return true;
  }
}
TerrainLOD.PERM = 10240;   // m: chunks this size and up stay resident (64 + 16 + 4 + 1 of them)
