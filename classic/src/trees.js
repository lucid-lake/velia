// Lakeshore's forest: Tahoe's west-shore conifers on the basin's slopes, swaying in the one wind field.
//
//   import { createTrees } from './trees.js';
//   const trees = await createTrees({ terrain, wind, windTexture: water.windTexture, seed, sunDir, renderer, atmosphere, lum });
//   scene.add(trees.group);
//   each frame: trees.update(t, camera)
//
//. Seven conifer species, a snag and a shrub (src/forest/species.js), four geometry variants
// each from the seed (src/forest/tree-gen.js), their needle cards and bark drawn at load (src/forest/textures.js).
// Three bands by distance from the camera:
//   full   the full mesh (≈ 1,000–2,500 triangles), instanced per variant, inside FULL m;
//   lite   the lighter mesh (≈ 400), FULL .. NEAR m;
//   far    a hemi-octahedral impostor (src/forest/impostor.js): one quad, the three frames round the view blended,
//          the baked normal lit per pixel by the scene's sun; past THIN m a share (THIN / d)² is kept, each up to
//          1.5 × wider, so the cover holds while the overdraw falls. Every tree sits in one static instance buffer;
//          the GPU drops the near ones and the thinned ones, so a camera move costs no rebuild.
// Each tree swaps mesh ↔ impostor at its own distance (NEAR .. NEAR + 40 m), so a band never pops as one.
// Shadow masses: the terrain's skyline (src/forest/horizon.js) says whether the sun is up for a tree; a shadowed
// tree loses its direct light (its normal is bent off the sun) and cools a little; the sky light stays.
// Needles are lit two-sided with a backlit glow toward the sun (the sky model's direct illuminance). Then depthTint
// (src/terrain-mesh.js), the same depth steps as the ground.
// Placement: src/trees-scatter.js (species by elevation, aspect, slope and shore; groves and gaps; snags; logs and
// boulders on granite). Wind: every tree samples the wind texture at its own root (the texture WindField.toTexture
// writes; pass water.windTexture to share it, or the module makes a 128 px one over 8 km and refreshes it each
// update): the trunk leans downwind by about 1.5 % of its height at 10 m/s and sways at 0.25–0.4 Hz with a phase per
// tree (Crysis's main bending); the branches bob on their own phase (detail bending).
import * as THREE from 'three/webgpu';
import {
  attribute, uniform, texture, vec2, vec3, vec4, float, mix, smoothstep, abs, sin, max, min, select,
  positionGeometry, cameraPosition, normalize, cross, color, dot, faceDirection, positionWorld, cos, floor, fract, step, Fn, If, varying,
} from 'three/tsl';
import { getSplitScalarIlluminance } from '@takram/three-atmosphere/webgpu';
import { scatterTrees, scatterIsland, RIM_RULES, TREE_STRIDE, LOG_STRIDE, ROCK_STRIDE } from './trees-scatter.js';
import { ForestStore, allScatterTiles, GROUPS } from './forest/scatter-tiles.js';
import { maskBundle } from './towns-layout.js';
import { CANOPY } from './ground-layout.js';
import { FARMAP, farMapOn, farMapFor } from './forest/far-map.js';
import { farMapTexture } from './forest/far-map-texture.js';
import { SPECIES, VARIANTS, SNAG, SHRUB } from './forest/species.js';
import { treeGeometry, logGeometry, rockGeometry } from './forest/tree-gen.js';
import { forestAtlas } from './forest/textures.js';
import { loadBarkAtlas, barkAlbedo, barkNormal } from './forest/bark.js';
import { bakeImpostors, octFrames, impostorQuad } from './forest/impostor.js';
import { fineHorizon } from './horizon-fine.js';
import { loadTops, setTops } from './forest/treetops.js';
import { depthTint } from './terrain-mesh.js';
import { NIGHT_LAND } from './core/night.js';
import { farTileOf, tileTarget, Slots } from './forest/far-tiles.js';
import { rectDist } from './stream/grid.js';
import { span } from './profile.js';
import { take, takeLater, startBubbleReady } from './prebake.js';
import { mark } from './profile.js';

// the far map takes the rim's stands past FARMAP.far (?farmap=0: the cards to BANDS.RIMFAR, as before)
const FARMAP_ON = farMapOn();
export const BANDS = Object.freeze({ FULL: 90, NEAR: 220, SWAP: 40, BLEND: 600, FAR: 9000, RIMFAR: 24000, THIN: 3000, DENSITY: 1, MOVE: 25, ROCKS: 900, LOGS: 500, SHRUBS: 700 });   // High's
const CAP = { full: 1500, lite: 4000, rocks: 8000, logs: 2000 };
const RIMFAR = FARMAP_ON ? FARMAP.far : BANDS.RIMFAR;
// a quality tier's bands (src/quality/tiers.js forest: the keys BANDS has; RIMFAR stays the far map's), and TB: the bands
// the far tiles hold for
export function forestBands(over = null) {
  const B = { ...BANDS };
  if (over) for (const k of Object.keys(over)) if (k in B) B[k] = over[k];
  return { BANDS: B, TB: { ...B, RIMFAR } };
}
const DEG = Math.PI / 180;

// the sway shared by every band: lean downwind ∝ wind speed², plus an oscillation; `h01` is the height up the tree
function sway({ windTex, windExtent, uTime, root, phase, height, h01 }) {
  const w = texture(windTex, root.xz.div(windExtent).add(0.5)).xy;           // m/s at the tree's root
  const speed = w.length();
  const lean = speed.mul(speed).mul(0.00015).add(sin(uTime.mul(float(1.6).add(phase.mul(0.15))).add(phase)).mul(speed).mul(0.0012));
  const bend = h01.mul(h01).mul(height).mul(lean);                           // metres at this point of the tree
  return { offset: vec3(w.x, 0, w.y).div(max(speed, 0.01)).mul(bend), speed };
}
const rotY = (v, yaw) => { const c = cos(yaw), s = sin(yaw); return vec3(v.x.mul(c).add(v.z.mul(s)), v.y, v.z.mul(c).sub(v.x.mul(s))); };

// the terrain's skyline (src/horizon-fine.js: 16 m texels, 16 azimuths, from the game's own DEM): `lit(root)` → 0 in a
// ridge's shadow .. 1 in the sun, `sky(root)` → the sky left open. One array texture, the only one the lit materials bind
// for it (the sampler budget is 16 a stage). Past its box (the rim) it is 1.
function makeHorizon(sunAz, sunEl) {
  const F = fineHorizon();
  const lit = (root) => mix(float(1), F.lit(root, sunAz, sunEl), F.weight(root));
  const sky = (root) => F.sky(root);
  return { lit, sky };
}

// towns: { keepOut, treeDensity } (src/towns.js), for the scatter when it was not prebaked (the bake worker builds its own)
// tier: the quality tier as built (src/quality/apply.js tierFor): its forest bands, the trees kept, the impostor atlas,
// the far map's texel and the bark; none: High's
export async function createTrees({ terrain, wind, windTexture = null, windExtent = 4096, seed = 1, sunDir = null, renderer = null, atmosphere = null, lum = 0.1, towns = null, tier = null } = {}) {
  const { BANDS, TB } = forestBands(tier?.forest);
  const group = new THREE.Group();
  group.name = 'trees';
  const uTime = uniform(0);
  const uLodBias = uniform(0);   // log2(720 / viewport height): the impostor mip level is set for 720 px
  const sun = uniform((sunDir ? new THREE.Vector3().copy(sunDir) : new THREE.Vector3(0.8, 0.2, -0.55)).normalize());
  const sunAz = uniform(0), sunEl = uniform(10);
  let own = null;
  if (!windTexture) { own = makeWindTexture(wind, 128, 8192); windTexture = own.tex; windExtent = 8192; own.refresh(0); }
  const uExtent = uniform(windExtent);
  const windArgs = { windTex: windTexture, windExtent: uExtent, uTime };

  // --- the scatter, by tile (src/forest/scatter-tiles.js), and the skyline ---------------------------
  // The load-time bake gives the start bubble's tiles; the rest arrive from its background jobs or the stream's
  // workers (attachStream), or are scattered here when there is no bake at all (node, the demos, ?prebake=0).
  const endScatter = span('trees:scatter');
  const t0 = performance.now();
  setTops(await loadTops());   // the bay box's real crowns (src/forest/treetops.js); the workers load their own
  const forest = new ForestStore(allScatterTiles(), { keep: tier?.forest?.KEEP ?? 1 });
  const first = terrain.seed != null ? take(`scatter:tiles:${terrain.seed}`) : undefined;
  if (first) await startBubbleReady();   // a live page went on before the start bubble's scatter was done (perf/slow-loading-2): its tiles, from the bake
  if (first) for (const [k, r] of first) if (forest.defs.has(k)) forest.add(k, r);
  const scatterHere = (def) => scatterTrees(terrain, { seed, rules: GROUPS[def.group], rows: def.rows, cols: def.cols, towns });
  if (!first) for (const def of forest.defs.values()) forest.add(def.key, scatterHere(def));
  { const isl = scatterIsland(terrain, { seed }); let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < isl.count; i++) { const x = isl.data[i * TREE_STRIDE], z = isl.data[i * TREE_STRIDE + 2]; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    forest.add('isl:0', isl, { key: 'isl:0', group: 'isl', rect: isl.count ? { x0: x0 - 1, x1: x1 + 1, z0: z0 - 1, z1: z1 + 1 } : { x0: 0, x1: 0, z0: 0, z1: 0 } }); }
  const scatterMs = performance.now() - t0;
  endScatter();
  const horizon = makeHorizon(sunAz, sunEl);

  // --- the species' geometry and textures, the impostor bake ------------------------------------------------------
  const endBuild = span('trees:build');
  const atlas = forestAtlas(seed);
  const atlasTex = atlas.texture;
  const sampleAtlas = (uv) => texture(atlasTex, uv);
  const bark = typeof document !== 'undefined' ? await loadBarkAtlas(tier?.bark ?? {}) : null;   // the CC0 bark photos (ATTRIBUTION.md)
  // the unlit colour of a vertex for the impostor bake: a needle card, or the trunk's bark with its gradient
  const bakeSample = (uv, ex, bk) => {
    const card = sampleAtlas(uv);
    const trunk = barkAlbedo({ bark, uv, bk, ex, phase: float(0), local: positionGeometry, nW: attribute('normal', 'vec3') });
    return vec4(mix(card.rgb, trunk.albedo, ex.z), mix(card.a, float(1), ex.z));
  };
  const variants = [];   // index s * VARIANTS + v
  SPECIES.forEach((sp, s) => { for (let v = 0; v < VARIANTS; v++) variants.push({ sp: { ...sp, index: s }, s, v }); });
  for (const V of variants) {
    V.full = treeGeometry(V.sp, { variant: V.v, seed, detail: 'full' });
    V.lite = V.sp.kind === 'shrub' ? V.full : treeGeometry(V.sp, { variant: V.v, seed, detail: 'lite' });
  }
  const buildMs = performance.now() - t0 - scatterMs;
  endBuild();
  const endBake = span('trees:bake');
  const tb = performance.now();
  const bake = renderer ? await bakeImpostors(renderer, variants.filter((V) => V.sp.kind !== 'shrub').map((V) => ({ geometry: V.full })), { atlas: { sample: bakeSample },
    ...(tier?.forest ? { frames: tier.forest.frames ?? 6, framePx: tier.forest.framePx } : {}) }) : null;
  const bakeMs = performance.now() - tb;
  endBake();

  // --- lighting: one model for every band ---------------------------------------------------------------------------
  // the sky model's direct sun (its illuminance at the camera's foot, so it goes orange at golden hour) × the ridge's
  // skyline (shadow masses) × a wrapped Lambert on the crown's volume normal; a hemisphere ambient (the sky above,
  // the forest floor below) from the daylight; the backlit glow of thin needles toward the sun. Scene luminance units.
  let sunLight = color(0xffe0b0).mul(lum * 40);
  if (atmosphere) {
    const A = atmosphere;
    let pE = A.matrixWorldToECEF.mul(vec4(cameraPosition.x, 1, cameraPosition.z, 1)).xyz;
    if (A.correctAltitude) pE = pE.add(A.altitudeCorrectionECEF);
    sunLight = varying(getSplitScalarIlluminance(pE.mul(A.parametersNode.worldToUnit), A.sunDirectionECEF).get('direct').mul(lum));   // once per vertex
  }
  const uSkyUp = uniform(new THREE.Color(0x6f8296).multiplyScalar(lum)), uSkyDown = uniform(new THREE.Color(0x1c2a22).multiplyScalar(lum));
  const uFar = uniform(new THREE.Color(0x55697a));   // depthTint's far slate as a radiance: × the daylight's light (fix: it glowed white at night)
  const WRAP = 0.3;
  const lightOf = ({ albedo, n, lit, toCam, thin, skyDesat = 0, sky = float(1) }) => {
    const direct = dot(n, sun).add(WRAP).div(1 + WRAP).clamp(0, 1).mul(lit);
    const back = max(dot(toCam, sun.negate()), 0).pow(5).mul(lit).mul(thin).mul(0.4);
    const hemi0 = mix(uSkyDown, uSkyUp, n.y.mul(0.5).add(0.5)).add(NIGHT_LAND.mul(n.y.mul(0.18).add(0.37)));   // + the starlit night's lift (round 5; 0 by day), half the ground's: the tree line stays a silhouette
    const hemi = skyDesat ? mix(hemi0, vec3(dot(hemi0, vec3(0.299, 0.587, 0.114))), skyDesat) : hemi0;   // a boulder keeps its granite colour under a blue dusk sky
    return albedo.mul(sunLight.mul(direct.add(back)).mul(1 / Math.PI).add(hemi.mul(sky)));   // sky: the terrain's open sky at the root (src/horizon-fine.js)
  };
  const treeTint = (phase) => {   // per-tree colour variation: value ± 12 %, a yellow ↔ blue shift
    const f = phase.mul(0.15915).fract();
    return mix(vec3(0.92, 1.0, 0.86), vec3(0.88, 0.98, 1.08), f.mul(7.3).fract()).mul(float(0.88).add(f.mul(0.24)));
  };

  // --- the mesh material (full and lite bands): bark and needle cards from the atlas ------------------------------
  function meshMaterial() {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const r = attribute('iRoot', 'vec4'), p = attribute('iPrm', 'vec4');   // by name: one shader for every variant
    const root = r.xyz, height = r.w, phase = p.x, yaw = p.y;
    const ex = attribute('extra', 'vec4'), ao = ex.x, bPhase = ex.y, isBark = ex.z, tip = ex.w;
    const local = positionGeometry;
    const turned = rotY(local, yaw);
    const sw = sway({ ...windArgs, root, phase, height, h01: local.y });
    // detail bending: each branch bobs on its own phase, more at its tip, with the wind
    const bob = sin(uTime.mul(2.3).add(bPhase.mul(6.2832)).add(phase)).mul(tip).mul(sw.speed).mul(0.004).mul(height);
    m.positionNode = root.add(turned.mul(height)).add(sw.offset).add(vec3(0, bob, bob.mul(0.3)));
    const uv0 = attribute('uv', 'vec2'), bk = attribute('bark', 'vec4');
    const tex = sampleAtlas(uv0);
    m.opacityNode = mix(tex.a, float(1), isBark);
    m.alphaTest = 0.5;
    const lit = varying(horizon.lit(root));                                 // per tree: the vertex stage
    const nW = rotY(attribute('normal', 'vec3'), yaw);
    // the trunk: the bark photo's structure under the species' colour, a gradient along the trunk, char and lichen,
    // the bark normal in the cylinder's frame (src/forest/bark.js)
    const trunk = barkAlbedo({ bark, uv: uv0, bk, ex, phase, local, nW });
    const nBark = barkNormal(nW.mul(faceDirection), trunk.nTex);
    const n = normalize(mix(nBark, nW, float(1).sub(isBark)));              // cards keep the crown's volume normal on both faces
    const albedo = mix(tex.rgb.mul(ao).mul(treeTint(phase)), trunk.albedo, isBark);
    const toCam = normalize(cameraPosition.sub(positionWorld));
    m.colorNode = depthTint(lightOf({ albedo, n, lit, toCam, thin: float(1).sub(isBark), sky: varying(horizon.sky(root)) }), root, uFar);
    return m;
  }

  // --- the impostor material (far band) -----------------------------------------------------------------------------
  function impostorMaterial() {
    const m = new THREE.MeshBasicNodeMaterial();
    const r = attribute('iRoot', 'vec4'), p = attribute('iPrm', 'vec4');
    const root = r.xyz, height = r.w, phase = p.x, yaw = p.y, kind = floor(p.z.div(100)), vi = p.z.sub(kind.mul(100)), hw = p.w;   // kind 0 tree, 1 snag, 2 shrub
    const corner = positionGeometry.xy;                                       // −0.5 .. 0.5
    const centre = root.add(vec3(0, height.mul(0.5), 0));
    const toCam = cameraPosition.sub(centre), dist = toCam.xz.length();
    const v = normalize(toCam);
    // which band: the swap distance per tree; the far thinning; shrubs end at SHRUBS m
    const swapAt = float(BANDS.NEAR).add(phase.mul(0.15915).mul(BANDS.SWAP));
    const rimCard = kind.greaterThan(2.5), dead = abs(kind.sub(1)).lessThan(0.5);   // a rim stand: no thinning, seen to RIMFAR
    // DENSITY: the tier's canopy density for the bay's crowns past the swap (Low keeps half of them as cards; the canopy surface fills the rest)
    const dens = mix(float(1), float(BANDS.DENSITY), smoothstep(float(BANDS.NEAR + BANDS.SWAP), float(BANDS.NEAR + BANDS.SWAP + 300), dist));
    const keep = select(rimCard, float(1), select(dist.greaterThan(BANDS.THIN), float(BANDS.THIN).div(dist).pow(2), float(1)).mul(dens));
    // with the far map (src/forest/far-map.js) the rim's stands fade out over FARMAP.near .. far, one stand at a time
    // (its phase as a dither), where the map's crowns take over on the ground
    const farFade = FARMAP_ON ? select(rimCard, smoothstep(float(FARMAP.near), float(FARMAP.far), dist), float(0)) : float(0);
    const hidden = dist.lessThan(swapAt).or(dist.greaterThan(select(rimCard, float(RIMFAR), float(BANDS.FAR)))).or(phase.mul(0.15915).greaterThan(keep))
      .or(phase.mul(0.15915).greaterThanEqual(float(1).sub(farFade)).and(farFade.greaterThan(0)))
      .or(abs(kind.sub(2)).lessThan(0.5).and(dist.greaterThan(BANDS.SHRUBS)));   // kind 2 (a shrub) ends at SHRUBS m
    // far cards widen (the mips thin a narrow crown to nothing; a distant forest is a continuous cover), more past THIN
    const widen = min(float(1.5), float(1).div(keep.sqrt())).mul(float(1).add(smoothstep(800.0, 3000.0, dist).mul(0.3))).mul(float(1).add(smoothstep(8000.0, 20000.0, dist).mul(0.6)));
    // the card: a billboard of the tree's height, trimmed to the crown's width, facing the camera (the frames were
    // baked along their view)
    const upW = select(abs(v.y).greaterThan(0.995), vec3(0, 0, -1), vec3(0, 1, 0));
    const right = normalize(cross(upW, v)), up = normalize(cross(v, right));
    const cx = corner.x.mul(hw.mul(2));                                       // −hw .. hw of the unit frame
    const sw = sway({ ...windArgs, root, phase, height, h01: corner.y.add(0.5) });
    const wideF = select(rimCard, float(RIM_RULES.stand.wide), float(1));   // a rim stand: the frame stretched wide (the uv stays inside it)
    const pos = centre.add(right.mul(cx.mul(height).mul(widen).mul(wideF))).add(up.mul(corner.y.mul(height))).add(sw.offset);
    m.positionNode = select(hidden, vec3(0, -1e5, 0), pos);
    // the three frames round the view, in the tree's own frame (the yaw undone); one frame past BLEND m
    const vL = rotY(v, yaw.negate());
    const vH = normalize(vec3(vL.x, max(vL.y, 0.0), vL.z));
    const { a, b, c, wa, wb, wc } = octFrames(vH, bake.frames);
    const tile = vec2(vi.mod(bake.cols).floor().mul(bake.tileSize[0]), floor(vi.div(bake.cols)).mul(bake.tileSize[1]));
    const fsz = vec2(bake.tileSize[0] / bake.frames, bake.tileSize[1] / bake.frames);
    const q = vec2(cx.add(0.5), corner.y.add(0.5));
    const uvOf = (cell) => { const u = tile.add(cell.add(q).mul(fsz)); return vec2(u.x, float(1).sub(u.y)); };   // the target's rows run top-down
    const near3 = dist.lessThan(BANDS.BLEND);
    // far: one sharper mip (bias −1), so a 4 px spire keeps its point instead of blurring to a blob
    // the mip level from the card's size on screen, explicit: a sample inside the If/Else below has no usable
    // derivatives (the far cards of the south shore came out at the coarsest mip, alpha 0, 2026-10-29); the frame is
    // 96 px for the tree's height, so level = log2(dist / height) − 3 at 720 px; the far path one level sharper
    const lod = dist.div(height.mul(widen)).log2().sub(3.0).add(uLodBias).clamp(0, 7);
    const tap = (cell, w, bias) => { const l = lod.add(bias).max(0); const cc = texture(bake.albedo, uvOf(cell)).level(l), nn = texture(bake.normal, uvOf(cell)).level(l); const aw = cc.a.mul(w); return { c: cc.rgb.mul(aw), n: nn.rgb.mul(aw), a: aw }; };
    // colour and alpha from ONE node: a var assigned inside the colour function and read by the opacity was read
    // before its assignment in some builds (the fly/preset views: every card discarded, 2026-10-29), so both come
    // out of the same vec4
    // no control flow here: the three taps always run, the far path just puts all the weight on the nearest frame
    // (an If/Else with vars assigned inside it lost the alpha in the fly/preset views, 2026-10-29)
    const best = select(wa.greaterThan(wb).and(wa.greaterThan(wc)), float(0), select(wb.greaterThan(wc), float(1), float(2)));
    const one = (k) => select(best.equal(k), float(1), float(0));
    const WA = select(near3, wa, one(0)), WB = select(near3, wb, one(1)), WC = select(near3, wc, one(2));
    const sharp = select(near3, float(0), float(-1));
    const A = tap(a, WA, sharp), B = tap(b, WB, sharp), C = tap(c, WC, sharp);
    const col = A.c.add(B.c).add(C.c), nrm = A.n.add(B.n).add(C.n), alpha = A.a.add(B.a).add(C.a);
    const albedo = col.div(max(alpha, 1e-4)).pow(2.2).mul(mix(treeTint(phase), vec3(1), select(dead, float(1), float(0))));
    const nL = nrm.div(max(alpha, 1e-4)).mul(2).sub(1);
    const n = rotY(normalize(nL), yaw);
    const lit = varying(horizon.lit(root));
    const shaded = vec4(depthTint(lightOf({ albedo, n, lit, toCam: v, thin: select(dead, float(0), float(0.8)), sky: varying(horizon.sky(root)) }), root, uFar), alpha);
    // the alpha cut relaxes with distance (the mips thin the silhouettes)
    const cut = mix(float(0.5), float(0.2), smoothstep(300.0, 1500.0, dist));
    m.colorNode = shaded.rgb;
    m.opacityNode = shaded.a.sub(cut).add(0.5);
    m.alphaTest = 0.5;
    return m;
  }

  // --- the far band: every tree a card, in the scatter's tiles (src/forest/far-tiles.js) --------------------
  // shrubs are near meshes only (a 2 m dome is nothing past NEAR), so the far band holds the trees and the snags. The
  // shader still decides every card (the bands, the thinning); each tile keeps in the drawn buffer only a superset of
  // what it can show from near the camera (its thinning prefix, its rim stands in or out), streamed as the camera
  // moves (attachStream). Without a stream every card is drawn, as before.
  const halfW = variants.map((V) => { V.full.computeBoundingBox(); const bb = V.full.boundingBox; return Math.min(0.5, Math.max(Math.abs(bb.min.x), bb.max.x, Math.abs(bb.min.z), bb.max.z) * 1.08 + 0.01); });
  const farList = [], tileByKey = new Map();
  let farTotal = 0, farAdded = 0;   // farAdded: bumps when a far tile arrives (the far system recomputes its wants)
  function addFar(t) {
    if (t.group === 'isl' || tileByKey.has(t.key)) return;
    const { data, species, variant } = t, rimCard = t.group === 'rim';
    let n = 0; for (let i = 0; i < t.count; i++) if (species[i] !== SHRUB) n++;
    const root = new Float32Array(n * 4), prm = new Float32Array(n * 4);
    for (let i = 0, k = 0; i < t.count; i++) {
      const o = i * TREE_STRIDE, sp = species[i], vi = sp * VARIANTS + variant[i];
      if (sp === SHRUB) continue;
      root[k * 4] = data[o]; root[k * 4 + 1] = data[o + 1] - 0.3; root[k * 4 + 2] = data[o + 2]; root[k * 4 + 3] = data[o + 3];
      prm[k * 4] = data[o + 4]; prm[k * 4 + 1] = data[o + 5]; prm[k * 4 + 2] = vi + (rimCard ? 3 : sp === SNAG ? 1 : 0) * 100; prm[k * 4 + 3] = halfW[vi];   // z: variant + kind × 100 (0 tree, 1 snag, 3 a rim stand); w: the card's half width
      k++;
    }
    const ft = farTileOf(root, prm, () => rimCard, t.rect, t.key);
    farList.push(ft); tileByKey.set(t.key, ft); farTotal += n; farAdded++;
  }
  for (const t of forest.tiles.values()) addFar(t);
  // the drawn buffer: sized to what is held, grown when a hold does not fit (rare: a full re-upload)
  let farCap = forest.complete() ? Math.max(1, farTotal) : Math.max(1 << 18, Math.ceil(farTotal * 1.6));
  let farRoot = new THREE.InstancedBufferAttribute(new Float32Array(farCap * 4), 4);
  let farPrm = new THREE.InstancedBufferAttribute(new Float32Array(farCap * 4), 4);
  // static usage: three 0.184 re-uploads a DynamicDrawUsage attribute on every render (4 MB each, every frame); these
  // change only through markRange/fullUpload (needsUpdate + update ranges), so the upload happens only then
  const slots = new Slots(farCap), held = new Map();   // tile key → { key (the stream's), start, n, nB, rim }
  let farMesh = null, farGeo = null;
  if (bake) {
    const g = farGeo = impostorQuad();
    g.setAttribute('iRoot', farRoot); g.setAttribute('iPrm', farPrm);
    g.instanceCount = 0;
    farMesh = new THREE.Mesh(g, impostorMaterial());
    farMesh.frustumCulled = false;
    farMesh.name = 'trees-far';
    group.add(farMesh);
  }
  // one tile's cards into the drawn buffer (its bay prefix, then its rim stands); a freed range is parked far away
  // (x = 1e7: past every band, so the shader drops it)
  const DEAD = 1e7;
  const markRange = (s, n) => { if (n) { farRoot.addUpdateRange(s * 4, n * 4); farPrm.addUpdateRange(s * 4, n * 4); farRoot.needsUpdate = farPrm.needsUpdate = true; } };
  function holdTile(t, nB, rim, key) {
    const n = nB + (rim ? t.nR : 0);
    let s = slots.alloc(n);
    if (s < 0) { compact(); s = slots.alloc(n); }
    if (s < 0) { grow(slots.live + n); s = slots.alloc(n); }
    const R = farRoot.array, P = farPrm.array;
    R.set(t.root.subarray(0, nB * 4), s * 4); P.set(t.prm.subarray(0, nB * 4), s * 4);
    if (rim) { R.set(t.root.subarray(t.nB * 4, (t.nB + t.nR) * 4), (s + nB) * 4); P.set(t.prm.subarray(t.nB * 4, (t.nB + t.nR) * 4), (s + nB) * 4); }
    markRange(s, n);
    const old = held.get(t.key);
    held.set(t.key, { key, start: s, n, nB, rim });
    if (old) releaseRange(old);
    if (farGeo) farGeo.instanceCount = slots.top;
    return true;
  }
  function releaseRange(h) {
    const R = farRoot.array; for (let k = h.start; k < h.start + h.n; k++) R[k * 4] = DEAD;
    markRange(h.start, h.n); slots.release(h.start, h.n);
    if (farGeo) farGeo.instanceCount = slots.top;
  }
  // one whole write, not thousands of ranges: the ranges so far replaced by one range over the whole buffer (not none: a
  // markRange before the upload, e.g. holdTile after a compact, would then shrink the write to its own range)
  const fullUpload = () => {
    for (const a of [farRoot, farPrm]) { a.clearUpdateRanges(); a.addUpdateRange(0, a.array.length); a.needsUpdate = true; }
  };
  // a bigger buffer (the held set outgrew it): new attributes, the held ranges copied, one upload
  function grow(need) {
    const cap = Math.max(need, Math.ceil(farCap * 1.5));
    const R = new Float32Array(cap * 4), P = new Float32Array(cap * 4);
    R.set(farRoot.array.subarray(0, slots.top * 4)); P.set(farPrm.array.subarray(0, slots.top * 4));
    farRoot = new THREE.InstancedBufferAttribute(R, 4); farPrm = new THREE.InstancedBufferAttribute(P, 4);
    if (farGeo) { farGeo.setAttribute('iRoot', farRoot); farGeo.setAttribute('iPrm', farPrm); }
    farCap = cap; slots.capacity = cap; stats.farGrows = (stats.farGrows ?? 0) + 1;
  }
  // every scatter tile, now: the bake's background results, else scattered here (no stream: ?stream=0)
  async function loadAll() {
    for (const def of forest.defs.values()) if (!forest.has(def.key)) addTile(def.key, (await takeLater(def.key)) ?? scatterHere(def));
    paintCanopy(Infinity);
  }
  // the far map: the rim's stands painted as their tiles arrive (the terrain reads it past FARMAP.near)
  const FMT = FARMAP_ON ? farMapTexture(farMapFor(tier)) : null;
  let farMapDirty = false;
  const paintFarMap = (t) => { if (FMT && t.group === 'rim' && FMT.painter.paint(t)) farMapDirty = true; };
  for (const t of forest.tiles.values()) paintFarMap(t);
  function addTile(key, payload) {
    const t = forest.add(key, payload); addFar(t); paintFarMap(t);
    Object.assign(stats, { scattered: forest.counts.trees, bay: forest.counts.bay, island: forest.counts.island, rim: forest.counts.rim, logs: forest.counts.logs, rocks: forest.counts.rocks, far: farTotal, scatterTiles: forest.tiles.size });
    if (forest.complete()) mark('forest-complete');
    return t;
  }
  function holdAll() { farInit = true; held.clear(); slots.top = 0; slots.free = []; slots.live = 0; if (farTotal > farCap) grow(farTotal); for (const t of farList) holdTile(t, t.nB, t.nR > 0, `${t.key}|${t.nB}|1`); fullUpload(); }
  // the canopy raster (the ground's, src/ground.js canopyTexture) painted by block as the tiles arrive (identical bytes)
  let canopy = null, canopyDirty = false, canopyFlushAt = 0;
  function attachCanopy(c) {
    canopy = c; forest.canopyBlocks();
    if (forest.canopyW !== c.w || forest.canopyH !== c.h) throw new Error(`canopy raster ${forest.canopyW}×${forest.canopyH} ≠ ${c.w}×${c.h}`);
    paintCanopy(Infinity);
    return { data: c.tex.image.data, w: c.w, h: c.h, x0: CANOPY.region.x0, z0: CANOPY.region.z0, cell: CANOPY.cell };
  }
  // paint up to `max` blocks whose tiles are all in; true when none is left ready
  function paintCanopy(max = 1) {
    if (!canopy) return true;
    let n = 0;
    for (const b of forest.blocks) if (forest.blockReady(b)) { if (n >= max) return false; forest.paintBlock(b, canopy.tex.image.data); n++; canopyDirty = true; }
    return true;
  }
  // the stream: `margin` m round the camera are covered (the recompute step, the prefetch's reach at the
  // observed speed, and a quarter-octave), so the tiles change a few times a minute at sailing speed
  // without a stream every card is held: the core calls holdAll() (?stream=0), the demos get it on their first update
  let farInit = false;
  function attachStream(stream, camera, { run = null } = {}) {
    farInit = true;
    held.clear(); slots.top = 0; slots.free = []; slots.live = 0;
    const STEP = 60;
    const marginOf = (v) => stream.cfg.hysteresis + STEP + v.speed * v.lead;
    const cam = camera.position;
    for (const t of farList) { const g = tileTarget(t, cam.x, cam.z, marginOf({ speed: 0, lead: 0 }), TB); if (g.nB || g.rim) holdTile(t, g.nB, g.rim, `${t.key}|${g.nB}|${g.rim ? 1 : 0}`); }
    fullUpload();
    let at = null, list = [], want = new Map(), pend = [], seen = farAdded;   // want: tile → its wanted key; pend: items not held yet
    const sys = stream.register({
      name: 'trees-far',
      want(view) {
        const m = marginOf(view);
        if (at && seen === farAdded && Math.hypot(view.x - at.x, view.z - at.z) < STEP && m <= at.m * 1.25 && m >= at.m * 0.6) {
          // between recomputes: only the arrival check moves (is a tile's held set still a superset here?)
          if (pend.length) { pend = pend.filter((w) => { const h = held.get(w.tile); w.due = !h || h.key !== w.key ? due(w.t, view, h) : false; return !h || h.key !== w.key; }); }
          return list;
        }
        at = { x: view.x, z: view.z, m }; seen = farAdded;
        list = []; want = new Map(); pend = [];
        for (const t of farList) {
          const g = tileTarget(t, view.x, view.z, m, TB), h = held.get(t.key);
          let nB = g.nB, rim = g.rim;
          // a shrink that keeps most of the tile waits (no churn); a held superset stays as it is
          if (h && h.nB >= nB && (h.rim || !rim) && nB + (rim ? t.nR : 0) >= 0.6 * h.n) { nB = h.nB; rim = h.rim; }
          if (!nB && !rim) continue;
          const key = `${t.key}|${nB}|${rim ? 1 : 0}`;
          want.set(t.key, key);
          const w = { key, eta: Math.max(0, rectDist(view.x, view.z, t.rect) - 250) / Math.max(view.speed, 5), due: h?.key === key ? false : due(t, view, h), tile: t.key, t };
          list.push(w); if (h?.key !== key) pend.push(w);
        }
        return list;
      },
      // a held tile stays until its replacement is in (no gap), or until nothing of it is wanted
      keep(key) { const tk = key.slice(0, key.lastIndexOf('|', key.lastIndexOf('|') - 1)), w = want.get(tk); return w !== undefined && w !== key && !sys.resident.has(w); },
      build(key) { return key; },
      upload(key) {
        const [tk, nB, rim] = splitKey(key);
        holdTile(tileByKey.get(tk), nB, rim, key);
        return true;
      },
      drop(key) { const [tk] = splitKey(key), h = held.get(tk); if (h && h.key === key) { releaseRange(h); held.delete(tk); } },
    });
    for (const [, h] of held) sys.resident.set(h.key, { t: 0 });
    // the exact need now (no margin): does the held set cover it?
    function due(t, view, h) {
      const g = tileTarget(t, view.x, view.z, 0, TB);
      if (!g.nB && !g.rim) return false;
      return !h || h.nB < g.nB || (g.rim && !h.rim);
    }

    // the scatter's tiles past the start bubble: the bake's background jobs, else the stream's workers. All of them
    // are wanted (the picture needs every card in reach and the whole canopy raster; captures wait for them); the
    // ones within the near band are due (a late one is logged)
    let masks;   // the towns' masks, for a tile the stream's workers scatter (src/prebake.js keeps a copy)
    const mask = () => (masks ??= (terrain.seed != null ? take(`towns:masks:scatter:${terrain.seed}`) : null) ?? null);
    let sAt = null, sList = [], sSeen = -1;
    const pendingPaint = new Set();
    stream.register({
      name: 'trees-scatter',
      want(view) {
        if (sAt && sSeen === forest.tiles.size && Math.hypot(view.x - sAt.x, view.z - sAt.z) < 250) {
          for (const w of sList) w.due = rectDist(view.x, view.z, w.def.rect) <= stream.cfg.bands.near;   // the manager's own radii (the tier's, live)
          return sList;
        }
        sAt = { x: view.x, z: view.z }; sSeen = forest.tiles.size;
        sList = [];
        for (const def of forest.defs.values()) if (!forest.has(def.key) || pendingPaint.has(def.key)) {
          const d = rectDist(view.x, view.z, def.rect);
          sList.push({ key: def.key, eta: d / Math.max(view.speed, 5), due: d <= stream.cfg.bands.near, need: true, def });
        }
        return sList;
      },
      keep: () => true,
      build(key) {
        const p = takeLater(key), def = forest.defs.get(key);
        const viaWorkers = () => {
          if (!run) return scatterHere(def);
          const R = GROUPS[def.group], m = mask();
          return run('tiles', { seed: terrain.seed, treeSeed: seed, lidar: true, group: def.group, rows: def.rows, tiles: [[key, def.cols[0], def.cols[1]]],
            towns: m && towns ? maskBundle(m, R.region.z0 + def.rows[0] * R.cell, R.region.z0 + def.rows[1] * R.cell) : null }).then((r) => r[0][1], () => scatterHere(def));
        };
        // the bake's result, or the stream's workers if it gave up or is slow (4 s: a stuck job never holds a tile)
        return p ? Promise.race([p, new Promise((r) => setTimeout(r, 4000))]).then((r) => r ?? viaWorkers()) : viaWorkers();
      },
      // slice 1: the tile into the store and the far band; then one canopy block a slice, until none is ready
      upload(key, payload) {
        if (!forest.has(key)) { addTile(key, payload); pendingPaint.add(key); return false; }
        if (!paintCanopy(1)) return false;
        pendingPaint.delete(key); return true;
      },
      drop() {},
    });
  }
  const splitKey = (key) => { const b = key.lastIndexOf('|'), a = key.lastIndexOf('|', b - 1); return [key.slice(0, a), +key.slice(a + 1, b), key.slice(b + 1) === '1']; };
  // the buffer is fragmented past its end: pack every held tile again (rare; one full upload)
  function compact() {
    const keep = [...held.entries()];
    held.clear(); slots.top = 0; slots.free = []; slots.live = 0;
    farRoot.array.fill(0); for (let k = 0; k < farCap; k++) farRoot.array[k * 4] = DEAD;
    for (const [tk, h] of keep) {
      const t = tileByKey.get(tk), n = h.nB + (h.rim ? t.nR : 0), s = slots.alloc(n);
      if (s < 0) { held.set(tk, h); continue; }   // cannot happen: the same set packed tighter
      farRoot.array.set(t.root.subarray(0, h.nB * 4), s * 4); farPrm.array.set(t.prm.subarray(0, h.nB * 4), s * 4);
      if (h.rim) { farRoot.array.set(t.root.subarray(t.nB * 4, (t.nB + t.nR) * 4), (s + h.nB) * 4); farPrm.array.set(t.prm.subarray(t.nB * 4, (t.nB + t.nR) * 4), (s + h.nB) * 4); }
      held.set(tk, { ...h, start: s, n });
    }
    if (farGeo) farGeo.instanceCount = slots.top;
    fullUpload();
    stats.farCompactions = (stats.farCompactions ?? 0) + 1;
  }

  // --- the near bands: per variant, an instanced full mesh and a lite mesh, refilled when the camera moves --------
  const nearMat = meshMaterial();   // shared: one pipeline for the 72 near meshes
  const near = variants.map((V) => {
    const mk = (geo, cap) => {
      const g = new THREE.InstancedBufferGeometry().copy(geo);
      g.instanceCount = 0;
      const root = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4), prm = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
      // static usage: uploaded only on gather (needsUpdate + the 0..n range), not on every render
      g.setAttribute('iRoot', root); g.setAttribute('iPrm', prm);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      const mesh = new THREE.Mesh(g, nearMat);
      mesh.frustumCulled = false;
      mesh.name = `trees-${V.sp.id}-${V.v}`;
      group.add(mesh);
      return { mesh, g, root, prm, cap, n: 0 };
    };
    return { full: mk(V.full, V.sp.kind === 'shrub' ? CAP.lite : CAP.full), lite: V.sp.kind === 'shrub' ? null : mk(V.lite, CAP.lite) };
  });

  // --- logs and boulders near the camera ---------------------------------------------------------------------------
  const rockGeo = new THREE.InstancedBufferGeometry().copy(rockGeometry(seed, 1));
  const rockRoot = new THREE.InstancedBufferAttribute(new Float32Array(CAP.rocks * 4), 4), rockPrm = new THREE.InstancedBufferAttribute(new Float32Array(CAP.rocks * 4), 4);
  rockGeo.setAttribute('iRoot', rockRoot); rockGeo.setAttribute('iPrm', rockPrm); rockGeo.instanceCount = 0;
  rockGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const rockMat = new THREE.MeshBasicNodeMaterial();
  {
    const r = attribute('iRoot', 'vec4'), p = attribute('iPrm', 'vec4');
    const root = r.xyz, rad = r.w, yaw = p.x, squash = p.y;
    const local = positionGeometry;
    const turned = rotY(vec3(local.x, local.y.mul(squash), local.z), yaw);
    rockMat.positionNode = root.add(turned.mul(rad)).add(vec3(0, rad.mul(squash).mul(-0.4), 0));   // sunk to the shoulders: a boulder sits in the slope, not on it
    const n = normalize(rotY(attribute('normal', 'vec3'), yaw));
    const lit = horizon.lit(root);
    const tone = float(0.95).add(fract(yaw.mul(3.7)).mul(0.35));   // the slope's own granite (warm, 0.95–1.3), not a neutral grey: at dusk the grey read navy against the pink ground
    const toCam = normalize(cameraPosition.sub(positionWorld));
    rockMat.colorNode = depthTint(lightOf({ albedo: vec3(0.48, 0.43, 0.39).mul(tone), n, lit, toCam, thin: float(0), skyDesat: 0.7, sky: horizon.sky(root) }), root, uFar);
  }
  const rockMesh = new THREE.Mesh(rockGeo, rockMat); rockMesh.frustumCulled = false; rockMesh.name = 'boulders'; group.add(rockMesh);
  const logGeo = new THREE.InstancedBufferGeometry().copy(logGeometry([0, 0, 1, 1]));
  const logRoot = new THREE.InstancedBufferAttribute(new Float32Array(CAP.logs * 4), 4), logPrm = new THREE.InstancedBufferAttribute(new Float32Array(CAP.logs * 4), 4);
  logGeo.setAttribute('iRoot', logRoot); logGeo.setAttribute('iPrm', logPrm); logGeo.instanceCount = 0;
  logGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const logMat = new THREE.MeshBasicNodeMaterial();
  {
    const r = attribute('iRoot', 'vec4'), p = attribute('iPrm', 'vec4');
    const root = r.xyz, len = r.w, yaw = p.x, rad = p.y;
    const local = positionGeometry;
    const turned = rotY(vec3(local.x.mul(len), local.y.mul(rad), local.z.mul(rad)), yaw);
    logMat.positionNode = root.add(turned).add(vec3(0, rad.mul(0.6), 0));
    const n = normalize(rotY(attribute('normal', 'vec3'), yaw));
    const lit = horizon.lit(root);
    const luv = attribute('uv', 'vec2');
    const toCam = normalize(cameraPosition.sub(positionWorld));
    const trunk = barkAlbedo({ bark, uv: luv, bk: attribute('bark', 'vec4'), ex: attribute('extra', 'vec4'), phase: yaw, local: vec3(0, 0.3, 0), nW: n });
    logMat.colorNode = depthTint(lightOf({ albedo: trunk.albedo, n: barkNormal(n, trunk.nTex), lit, toCam, thin: float(0), sky: horizon.sky(root) }), root, uFar);
  }
  const logMesh = new THREE.Mesh(logGeo, logMat); logMesh.frustumCulled = false; logMesh.name = 'logs'; group.add(logMesh);

  let last = null;
  const stats = { scattered: forest.counts.trees, bay: forest.counts.bay, island: forest.counts.island, rim: forest.counts.rim, logs: forest.counts.logs, rocks: forest.counts.rocks, scatterTiles: forest.tiles.size,
    near: 0, full: 0, lite: 0, far: bake ? farTotal : 0, farDrawn: 0, farTiles: 0, rocksNear: 0, logsNear: 0,
    variants: variants.length, scatterMs: +scatterMs.toFixed(0), buildMs: +buildMs.toFixed(0), bakeMs: +bakeMs.toFixed(0), sortMs: 0, atlas: bake ? [bake.W, bake.H] : null };
  function gather(cam) {
    const ts = performance.now();
    for (const v of near) { v.full.n = 0; if (v.lite) v.lite.n = 0; }
    let nFull = 0, nLite = 0;
    for (const t of forest.within(cam.x, cam.z, BANDS.NEAR + BANDS.SWAP)) {
      const { data, species, variant } = t;
      for (let i = 0; i < t.count; i++) {
        const o = i * TREE_STRIDE, x = data[o], z = data[o + 2];
        const d = Math.hypot(x - cam.x, z - cam.z), ph = data[o + 4];
        const swapAt = BANDS.NEAR + (ph / (2 * Math.PI)) * BANDS.SWAP;
        if (d >= swapAt) continue;
        const V = near[species[i] * VARIANTS + variant[i]];
        const slot = (d < BANDS.FULL || !V.lite) ? V.full : V.lite;
        if (slot.n >= slot.cap) continue;
        slot.root.setXYZW(slot.n, x, data[o + 1] - 0.3, z, data[o + 3]); slot.prm.setXYZW(slot.n, ph, data[o + 5], 0, 0); slot.n++;
        if (slot === V.full) nFull++; else nLite++;
      }
    }
    for (const v of near) for (const s of [v.full, v.lite]) {
      if (!s) continue;
      s.g.instanceCount = s.n; s.root.needsUpdate = true; s.prm.needsUpdate = true;
      s.root.addUpdateRange?.(0, s.n * 4); s.prm.addUpdateRange?.(0, s.n * 4);
    }
    let nr = 0;
    for (const t of forest.within(cam.x, cam.z, BANDS.ROCKS)) for (let i = 0; i < (t.nRocks ?? 0); i++) {
      const o = i * ROCK_STRIDE, r = t.rocks; if (nr >= CAP.rocks) break;
      if (Math.hypot(r[o] - cam.x, r[o + 2] - cam.z) > BANDS.ROCKS) continue;
      rockRoot.setXYZW(nr, r[o], r[o + 1], r[o + 2], r[o + 3]); rockPrm.setXYZW(nr, r[o + 4], r[o + 5], 0, 0); nr++;
    }
    rockGeo.instanceCount = nr; rockRoot.needsUpdate = true; rockPrm.needsUpdate = true;
    let nl = 0;
    for (const t of forest.within(cam.x, cam.z, BANDS.LOGS)) for (let i = 0; i < (t.nLogs ?? 0); i++) {
      const o = i * LOG_STRIDE, l = t.logs; if (nl >= CAP.logs) break;
      if (Math.hypot(l[o] - cam.x, l[o + 2] - cam.z) > BANDS.LOGS) continue;
      logRoot.setXYZW(nl, l[o], l[o + 1], l[o + 2], l[o + 3]); logPrm.setXYZW(nl, l[o + 4], l[o + 5], 0, 0); nl++;
    }
    logGeo.instanceCount = nl; logRoot.needsUpdate = true; logPrm.needsUpdate = true;
    Object.assign(stats, { near: nFull + nLite, full: nFull, lite: nLite, rocksNear: nr, logsNear: nl, sortMs: +(performance.now() - ts).toFixed(1) });
  }

  let nearSeen = 0, nearCount = -1;
  const GATHER_R = Math.max(BANDS.NEAR + BANDS.SWAP, BANDS.ROCKS, BANDS.LOGS);
  const countNear = (p) => { let n = 0; for (const _ of forest.within(p.x, p.z, GATHER_R)) n++; return n; };
  function update(t, camera) {
    if (!farInit) { if (!forest.complete()) for (const def of forest.defs.values()) if (!forest.has(def.key)) addTile(def.key, scatterHere(def)); paintCanopy(Infinity); holdAll(); }
    stats.farDrawn = slots.top;
    // the canopy texture: re-sent at most every 30 frames while blocks stream in, at once when none is left to paint
    canopyFlushAt++;
    if ((canopyDirty || farMapDirty) && (canopyFlushAt >= 30 || forest.complete())) {
      if (canopyDirty) canopy.tex.needsUpdate = true;
      if (farMapDirty) FMT.tex.needsUpdate = true;
      canopyDirty = farMapDirty = false; canopyFlushAt = 0;
    }
    // a tile that arrived near the camera: gather again. Tiles are only ever added, and gather reads only the tiles within
    // GATHER_R of where it last ran, so a new tile farther out leaves its result unchanged: no re-gather (it ran every frame
    // while the rim streamed in, 0.3 ms and 0.2 MB of garbage a frame)
    if (forest.tiles.size !== nearSeen) {
      nearSeen = forest.tiles.size;
      if (last && countNear(last) !== nearCount) last = null;
    }
    uTime.value = t;
    uLodBias.value = Math.log2(720 / Math.max(1, (typeof innerHeight === 'number' ? innerHeight : 720)));
    if (own) own.refresh(t);
    const p = camera.position;
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > BANDS.MOVE) { last = p.clone(); gather(p); nearCount = countNear(last); }
  }

  // D2 (time of day): the sun's direction for the sun-side shading and the skyline shadows, per frame (src/daylight.js)
  const setSun = (dir) => {
    sun.value.set(dir.x, dir.y, dir.z).normalize();
    sunAz.value = ((Math.atan2(dir.x, -dir.z) / DEG) % 360 + 360) % 360;
    sunEl.value = Math.asin(Math.max(-1, Math.min(1, dir.y))) / DEG;
  };
  setSun(sun.value);
  group.userData.daylight = (f) => {
    setSun(f.sunDir);
    const l = lum * (f.light ?? 1);
    uSkyUp.value.setHex(0x6f8296).multiplyScalar(l * 1.6);     // the zenith's blue, as the water's sky tint
    uSkyDown.value.setHex(0x1c2a22).multiplyScalar(l * 1.6);   // the forest floor's bounce
    uFar.value.setHex(0x55697a).multiplyScalar(f.light ?? 1);    // 1 by day: the look as before
  };
  // horizon: the skyline's `lit(worldPos)` and its textures, for the ground (the sun light's colour node, world.js);
  // scatter: the trees' positions, for the ground's canopy raster (src/ground-layout.js)
  return { group, update, stats, setSun, attachStream, attachCanopy, holdAll, loadAll, forest, farHeld: () => slots.live, uniforms: { uTime, sun, sunAz, sunEl, uSkyUp, uSkyDown }, bake, atlas: atlas.canvas, bands: BANDS, horizon };
}

function makeWindTexture(wind, size, extent) {
  const data = new Uint16Array(size * size * 2);
  const tex = new THREE.DataTexture(data, size, size, THREE.RGFormat, THREE.HalfFloatType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  const refresh = (t) => {
    const f = wind.toTexture(size, extent, t);
    for (let k = 0; k < f.length; k++) data[k] = THREE.DataUtils.toHalfFloat(f[k]);
    tex.needsUpdate = true;
  };
  return { tex, refresh };
}
