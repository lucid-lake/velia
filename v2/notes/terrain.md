# v2 notes: Terrain, forest, shallows, island ground, lake-bed edges, shore, towns

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## The terrain (render/terrain.js, terrain/*)

**Data:** v1's grids unchanged (`terrain/tahoe.json`, `tahoe-phone.json`, the `.lsh` files): the same world frame (x east,
y up, z south, metres, Fannette Island's summit at the origin, y = 0 the lake surface at 1,897.89 m NAVD88) and the same
codes, so the boat, the marks and the cameras line up with v1. Five nested, world-anchored grids round Emerald Bay, each a
GPU "slot" (`r16uint` codes): island 1 m, bay 2 m, basin 10 m, lake 32 m, ring 96 m (to ±49.1 km); three NLCD cover grids
(`r8uint`): bay 4 m, basin 10 m, lake 32 m. The shore-distance grids are not in the stream: the living lake fetches four
of them (island, bay, basin, lake: `SHORE_LEVELS`, 835 kB) after the first frame (`v2/notes/living.md`).

**Streaming (a level clipmap, not tiles):** the data are already a clipmap: five nested grids, finest round the bay where
every camera starts. Re-cutting them into tiles would need a new build step and a second 12 MB copy, for no gain at
Tahoe's size (10.1 MB in all). So each slot streams whole, coarse to fine, from the phone set's grids to the full set's:

| Stage | Grids | Bytes |
|---|---|---|
| 0 · before the first frame | ring 384 m, lake 128 m, bay 4 m, island 1 m (heights); bay and lake cover; the two manifests | **1.40 MB** (1,396,762 B) |
| 1 · after the first frame | basin 20 m + its 10 m cover (Tallac, the walls round the bay) | 1.14 MB (the phone set ends here: 2.54 MB) |
| 2 · desktop | bay 2 m, basin 10 m, lake 32 m, ring 96 m | 8.58 MB (11.11 MB in all) |

A worker fetches, inflates, unpredicts and bounds each grid (bay-h's 5 M texels take ≈ 30 ms: never on the main thread).
The page makes a new texture, uploads ≤ 1 MB a frame into it, and swaps it in only when whole (the old one keeps
drawing until then); landing a grid costs the main thread ≤ 10 ms (the bounds merge), a swap ≤ 0.4 ms. Captures
(`?headless`) take every stage before the first frame, so goldens are deterministic.

**Heights on the GPU = v1's `heightAt`:** the WGSL `terrainHeight` walks the held slots finest first with v1's clamped
bilinear on the raw codes and v1's 12-texel smoothstep blend into the next level (`src/sim/terrain-data.js` makeSampler).
`terrain/sample.js` is its JS twin; the tests hold the twin to v1's `heightAt` (≤ 1e-6 m at 4,000+ points, both sets);
in the browser a compute probe samples 256 fixed points on the GPU after the stream and compares: **max 1.4 mm** (f32).

**Mesh: CDLOD** (Strugar 2009, from the paper): a quadtree over 131,072 m, 128 m leaves, every node a 64 × 64-cell grid
(a level-l cell is 2 · 2^l m: 2 m at the leaf); level l covers out to 256 · 2^l m from the eye. The CPU picks node
quadrants per frame (frustum + distance, ≈ 80–160 quadrants, ≤ 0.1 ms, no allocation) and writes their (x0, z0, level,
cell) into one storage buffer; the GPU builds every vertex (one 33 × 33 patch, one instanced draw, ≈ 0.3 M terrain
triangles at 1280 × 720). The far 14 % of each level's range morphs odd vertices onto the next level's grid. Distances
are horizontal in the selection and the morph alike, which makes the seams provable: a shared edge lies in [R_l,
R_l + √2·S_l], so morph ≥ 0.854 keeps the fine side fully morphed and the coarse side unmorphed there (0.86; the LOD test
checks it on every seam of real selections and fails at 0.75). Picked over M1's exponential grid (its isotropic density
spends the same vertices behind the camera as in front, and cannot follow the data's levels) and over geometry
clipmaps (per-ring index buffers, seam stitching, no frustum culling per block). Nodes wholly deeper than 60 m are not
drawn: the water's own body is opaque there (below), so Tahoe's deep floor costs nothing. Back faces are culled.

**Shading:** baked per grid on the GPU when it lands (`BAKE_WGSL`, one dispatch; again for every held grid when a cover
grid lands): the normal and a cavity term (`rgba8snorm`) and the ground's albedo (`rgba8unorm`, stored as its square root
so the dark canopy keeps fine steps) from v1's coverAt rules (`src/sim/terrain.js`): NLCD classes (their 4–32 m edges
warped by value noise so a boundary reads as a stand's edge, not a staircase), granite past ≈ 40°, the season's snow for
the map's day (2026-07-04: the line at 3,000 m, north faces 300 m lower, none on slopes past 45°: Tallac's north bowls),
beaches on low gentle ground at the water, the bed's sand and silt; developed classes mostly kept canopy (NLCD's 30 m
cells draw a road 30–60 m wide). The fragment reads the two maps from the finest level whose texel is at least a third of
its footprint (the five levels are the maps' mip chain: far ground never sparkles), and lights them with the M1 sun
through the transmittance LUT at the point's altitude (the peaks keep the sun longer) plus the sky's hemisphere, then
the aerial perspective. Per-pixel cover and snow logic cost 2.8 ms at 2560 × 1600 under MSAA 4; the bake moved it out
of the frame. The albedos are v1's material families without its photo (canopy 0.022 / 0.036 / 0.021, granite 0.20,
manzanita, meadow fresh → straw by the season, decomposed-granite sand, snow 0.8).

**The aerial perspective** (Hillaire 2020 § 5.4, `render/sky.js` AERIAL_WGSL): 32 × 32 view rays × 32 slices, quadratic in
distance to 64 km, the same medium, sun and multiple-scattering term as the sky-view; terrain and water read in-scatter
and transmittance at their screen position and distance. It replaces M1's exponential fog.

**Shadows and the ground photo:** built in M5c (§ The clear shallows and the island ground): a sun shadow map over the bay
(the plan's heightfield horizon march was dropped for a depth map the terrain's own patches draw: one pipeline, the same
geometry as the scene's, amortised) and v1's NAIP as 256² tiles, as proposed, with the region level at 32 m in place of
a basin level.

## The forest (M5b: render/forest.js, forest/*)

Tahoe's forest as v1 shows it, at a fraction of its cost: v1's real lidar crowns round Emerald Bay, the rules' trees
round them out to v1's rule region (≈ 5–6 km from the bay), and past that the terrain's canopy colour (v1's far map).

**Data (`forest/format.js`, `tools/v2-forest-pack.mjs`):** the placement is v1's own: the pack tool runs
`src/trees-scatter.js scatterTrees()` over the bay box with v1's treetops (USGS 3DEP CA_SierraNevada_5_2022, public
domain) and keeps what v1 draws: 99,818 trees (a crown on land ≥ 1 m above the lake and ≥ 2 m from the shore, never on
snow, a beach or water, ≥ 3.5 m; the species from the spot and the crown's slimness; 5 % snags) and 581,292 shrubs (the
NAIP brush class at v1's drawn height). Re-packed per 64 m tile: positions on a 0.25 m lattice, sorted and delta-coded,
stored as planes (key hi, key lo, height, radius, layer), gzip. **trees 313 kB (3.1 B a tree), shrubs 966 kB**, from v1's
5.65 MB (3.2 MB gzip; 20.1 MB with the canopy rasters, which v2 does not need). The phone set takes the trees only. The
files stream after the first frame (a worker inflates and decodes; ≤ 1 MB of slices a frame after the terrain's).
Cut against v1: the canopy rasters (the terrain's cover grids carry the far forest), the shrubs on a phone, positions
quantised from 0.1 to 0.25 m, logs and boulders (v1's scatter lists).

**The rules' trees (`forest/scatter.js`, on the GPU):** round the box, one candidate per 12.8 m cell (20 × 20 cells a
256 m tile, 41 × 47 tiles over v1's TREE_RULES.region, a fixed slot a cell), from the same cover grids and heights the
terrain's bake reads: the cover's forest share (developed classes partly canopy, as the terrain's albedo), a grove field,
none on cliffs (the terrain's granite ramp), snow (the season's line), beaches, water, under 2.5 m or past a ragged
treeline; heights from the lidar's spread (median ≈ 13 m), species by elevation (v1's bands). Re-run at every height or
cover swap. `scatterSlot()` is its JS twin for the tests.

**The cards (T5, 2026-11-13: Cold Smoke's trees in summer):** 7 trees (Jeffrey pine, lodgepole, white
fir, red fir, incense cedar, a snag, a manzanita) built as meshes on the CPU at load (`forest/trees.js`, ported from Cold
Smoke's `14_trees.js`, MIT): a tree is put together, not carved: a leaning stem and its boughs in tiers (the red fir 115,
the white fir 101, the cedar 89, the Jeffrey pine 80, the lodgepole 66), each bough a parabolic spine that rises and
droops (Cold Smoke's droop d0 → d1 per species; the pine's upper boughs turn up). On each bough a sheet whose needles
are cut out per pixel in the bake: the firs a flat spray (branchlets every 0.115 m with wavy sides and a second, finer
set across them) and a hanging curtain of strands; the cedar two sprays rolled up on edge (fans); the Jeffrey pine bare
boughs (bark) with 5–8 tufts of long needles (five sheets through a point, needles radiating, a dense core) from 0.4 L to
the tip; the lodgepole a brushy spray on the outer 60 % and a tuft; the snag a bleached stem with broken stubs; the
manzanita 110 cupped leaf sheets (small ovals cut per pixel) on 15 red stems. No snow: it is July. The meshes: 0.7–7.8 k
triangles a tree, 29.3 k in all, 2.2 MB of buffers (destroyed after the bake), 12–18 ms on the CPU.
**The bake (`TREE_BAKE_WGSL`, `CARD_DOWN_WGSL`, `CARD_DILATE_WGSL`):** each tree drawn into its atlas layer, a row of 12
frames a render pass, at 2 × (3072 × 512, two colour targets + depth), then each texel the share of its 2 × 2 the tree
fills, then the outline grown 6 texels with an alpha that falls 0.07 a texel (Cold Smoke's dilation: the outline moves
from one frame to the next instead of doubling), then the mips (alpha a mean, the channels weighted by it). 12 azimuths ×
3 elevations (0°, 30°, 60°) at 128 × 256 (64 × 128 on the phone set), as before. **The atlas keeps what the tree is, not
how it was lit:** A = the true normal (the sheet's own normal, turned to the viewer through its face, plus Cold Smoke's
needle facets; no crown-ball bend) + the alpha; B = the depth toward the viewer from the card's plane, the crown's own
ao × open sky (it scales the sky's light only), the needles' tone, bark. No colour is baked. On a live page a layer a
frame (7 frames) on the frame's encoder after its passes, then the mips; a capture primes it all. Desktop atlas 1536 ×
768 × 7, 2 × rgba8 with mips ≈ 88 MB (phone ≈ 22 MB), unchanged; the bake's own textures (≈ 28 MB) and the meshes'
buffers live only until the mips are submitted. v1's SDF bake (`CARD_BAKE_WGSL`) is gone.

**A card:** faces the camera in the tree's own unit frame (scaled by the lidar's height and 1.35 × its crown radius, the
segmentation runs small against the canopy-height model's 71 % cover; yawed by a hash of its position, tinted ± 10 % by
another), sized to the crown cylinder's projection; each pixel samples the baked frames round the view (2 azimuths × 2
elevations; the raised row only when the view is raised, so a boat view reads 4 texels, not 8), mixes their alphas and
cuts at 0.6 (alpha to coverage under MSAA 4), then lights the pixel here, Cold Smoke's needle light in M1's units: the
species' albedo by the tone (or its bark); the sun wrapped (N·L + 0.45)/1.45 through the transmittance LUT at the
pixel's height; the crown's own shade worked out from where the pixel stands (the depth puts it back on the tree: the
far side of the crown from the sun in shade, less so at its thin top, Cold Smoke's `ownS`); the terrain's sun shadow
read at that point, not the card's plane; the sky's irradiance by the crown's ao (never on the sun: v1's two sky terms
since the terrain shadow fix, § The land's sky light); a rim of a low sun behind; the light through the needles (a warm green, toward a sun behind the tree); then
the aerial perspective and M5a's clouds in front of it (the terrain's rule).
**Wind sway: not done.** The plan (T6): Cold Smoke's stem bend on the card's top vertices from the one wind
module (gust bands ≈ 140 m apart moving downwind, `0.075 · amp · q²` along and across the wind), a few vertex ops; it
needs the wind field in the forest's uniform and a pinned clock so the goldens stay deterministic.

**LOD and culling (`forest/lod.js`):** per frame the CPU picks the tiles in range and in the frustum (lidar 64 m tiles,
region 256 m tiles; ≈ 4.6 k box tests, ≤ 0.15 ms; the boxes from the terrain's bounds grid) and writes their (first,
count, source) records. The `forest` compute pass: the one-offs due (bake, mips, place, scatter), a reset of the indirect
arguments, the cull (a workgroup a tile; distance thinning: past `thin` a tree is kept when its hash < (thin / d)² and
drawn up to 2 × wider, faded to nothing from `fade` to `far`; shrubs to `shrubFar`; a card under 0.8 px is dropped; the
frustum; the guard) in a fixed order: count (a workgroup a tile) → scan (one workgroup: each tile's first slot, the total,
the clamp to the visible cap) → write (each survivor at its tile's first slot + its rank), so the draw order and the
image never depend on which workgroup ran first (an atomic append left 2–6 px between runs).
Desktop: thin 2.5 km, fade 6 km, far 8 km, shrubs 450 m, cap 262,144; phone: 1.2 / 3.5 / 4.5 km, no shrubs, 65,536.
The scene draws them after the terrain with one `drawIndirect` (4 vertices a card, the count never leaves the GPU).

**The ground under them (render/terrain.js):** the bake stores the forest's share of each texel's albedo in the albedo
map's alpha; the draw swaps that share from the canopy's far colour to the forest floor by `forestNear(d)`, the share of
ground the cards still cover at that distance (the same curve as the cull's), so the slopes keep their tone from the boat
to the far shore and no green stands where the cover says rock.

**Placement and the guard:** a lidar crown's ground is the drawn height (the place pass, at every height swap); one
under 1 m (v1's LIDAR_LAND.minY) is dropped, so a shore crown on the phone set's coarser heights never stands in the
lake. The cull counts any drawn tree under 1 m in `stats().forest.guard` (0 in every capture). The node tests hold the
packed crowns to v1's heightAt (none in the lake), the rules' twin to the real grids (none in the lake, on snow, past
the treeline, on cliffs; < 1 % on bare-rock cover), the tile pick to completeness (every crown in view and range).

**Determinism:** u32 hashes of positions and cells, no Math.random; the cull writes in a fixed order (above);
`goldens:v2 -- --twice` 12 frames 0 px (2026-11-13).

### Budgets (M5b, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians, 2 runs each; `?forest=0` is the same build without it)
First pass 2 runs with an atomic append; the fixed-order cull (count, scan, write) re-measured once after it: forest pass
0.11–0.14 ms, Sail 2560 × 1600 +0.9 ms that run, cam A +1.3 ms, phone +0.05 ms. Apple's tile GPU books part of the scene's fragment work under the next pass (composite), so the honest forest cost is
the change in scene + composite + the forest pass. Run noise on the totals ≈ ±0.5 ms.

| View | Size | forest pass | scene + composite, off → on | forest's cost | visible cards | GPU total off → on |
|---|---|---|---|---|---|---|
| Sail start 13:00 (follow camera) | 2560 × 1600 | 0.05–0.07 ms | 5.38–5.51 → 5.39–5.77 ms | **≈ +0.2 ms** | 23.6 k | 6.84–7.39 → 6.74–7.48 ms |
| v1's cam A 13:00 (the bay from above, the worst) | 2560 × 1600 | 0.07 | 3.83–4.08 → 5.01–5.06 | **≈ +1.2 ms** | 43.3 k | 5.20–5.64 → 6.42–6.92 |
| v1's cam B 13:00 | 2560 × 1600 | 0.03–0.07 | 3.20–3.43 → 4.04–4.07 | **≈ +0.8 ms** | 39.0 k | 5.13–5.19 → 5.27–5.34 |
| Sail start 13:00 | 1280 × 720 | 0.05 | 1.53–1.62 → 1.86–2.02 | ≈ +0.4 ms | 24.6 k | 2.65–2.79 → 3.40–3.99 |
| phone set, 16:00 with the hands | 390 × 844 | 0.01–0.04 | 0.59 → 0.68–0.74 | **≈ +0.15 ms** | 3.4 k | 1.69 → 1.72–1.98 |

Targets: ≤ 1.5 ms at 2560 × 1600, ≤ 0.8 ms at 390 × 844 for a Sail view. v1's forest: 1.8 ms at 720p (shared GPU),
its whole frame 12–16 ms at the same poses (4.0–4.6 M triangles, 166–198 draws); v2's forest is one dispatch set and one
draw, ≤ 87 k triangles. CPU: the tile pick ≤ 0.15 ms (the node test: ≤ 0.5 ms with margin). Pipelines: 9 more (36 at load
with the clouds and M3b's models), 0 after the first frame. Bytes: 0 at first load (the files stream after the first frame: 313 kB trees +
966 kB shrubs; the phone set the trees only); JS +14.7 kB gzip (108.7 → 123.4 kB, mostly WGSL text) + the forest worker 1.9 kB; first load ≈ 1.53 MB (≤ 2 MB); the one-offs
on a live page: a bake layer a frame for 7 frames, then the mips, the place and the scatter on swap frames.

### Budgets (T5 trees, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, the GPU shared with other helpers)
`node tools/v2-ab-forest.mjs`: one page per build (main 416bd807 served from an exported copy, and this branch), the
cards' draw switched off and on in place (`__velia.setForestDraw`), 40 frames each, each frame's own GPU total, the
builds interleaved round by round; the forest's cost = the median of on − off; the change = the median of the rounds'
after − before.

| View | Size | forest before | forest after | change | cards |
|---|---|---|---|---|---|
| Sail start 13:00 (follow camera), 5 rounds | 2560 × 1600 | 0.93 ms | 0.78 ms | **−0.08 ms** | 23.1 k |
| v1's cam A 13:00 (the worst), 7 rounds | 2560 × 1600 | 1.28 | 1.22 | **−0.03** | 43.3 k |
| phone set 16:00, 7 rounds | 390 × 844 | 0.11 | 0.20 | **+0.09** (limit +0.1) | 3.3 k |

The raised row's 4 reads are skipped in every boat view (its weight is 0); the lighting adds ALU (≈ the same as the
reads saved). A first cam A run before that skip read +0.69 ms (4 rounds, noisy). Atlas memory unchanged (88 MB
desktop, 22 MB phone); the bake's transient ≈ 28 MB + 2.2 MB of mesh buffers, freed after the mips' submit. Pipelines:
+2 at load (the bake is a render pipeline plus the down and dilate passes, the SDF compute bake gone), 0 after the first
frame. JS: `index-*.js` 794.1 → 812.0 kB (300.4 → 307.2 kB gzip, +6.9 kB: the tree builder and the WGSL). The bake on
a live page: 3 render passes + 4 small dispatches a frame for 7 frames.

## The clear shallows and the island ground (M5c: render/bed.js, ground.js, shadow.js, rocks.js; terrain/photo.js, rocks-rules.js)

The owner on the island comparison (v1's cam I at 13:00, 2026-11-13): "the clear water transition part, the clear water
stone part, the island texture get worse a lot." v1 is the reference for the shallows, the bed, the stones and the island
ground; **v2's deep water and exposure stay as they are** (owner, 2026-11-13: "I like the new deep water color, I think it
is more real than v1"), so every M5c term eases to v2's own numbers past the shelf.

**The bed through the water (render/bed.js, in the terrain pass):** v1's clarity bed (`src/waters/clarity.js`), ported to
WGSL on the bed geometry the terrain already draws, with v1's numbers imported from `src/waters/clarity-optics.js` (BED,
CAUSTIC_LINE, IMAGE_SCATTER, DIRECT_SHARE): pale decomposed-granite sand with two sets of small wave ripples on a domain
warp in patches of the wave-washed shallows; rounded granite boulders (6.5 m cells, 0.9–2.6 m, to 7–13 m deep) and
cobbles (1.7 m cells, to 1.5–6 m), one jittered candidate a cell a layer, each lit by the refracted sun on its own normal
with a contact shade and a cast shadow, about one in five lichen-dark, a brown-green film on their tops in the shallows;
two drifting Worley caustic nets on a moving warp, read through a flat surface (per-pixel slope jitters them into speckle),
sharp in 1–4 m and gone by 8 m, with a mean of exactly 1 (`causticMean`: no light added), at 0.2 of their full contrast
(v1's 0.3 under v1's AgX); the sun's direct share (0.75) carries the stones' shading and the caustics, the sky's part the
contact shade. **The refraction wobble:** the detail is read at the bed point the view reaches through a calmed surface
normal (the four FFT slope cascades, sampled where the eye ray crosses the surface, × WOBBLE 0.06) against the flat one,
so the stones sway with the waves as v1's do; the same slopes give the surface's roughness (the mips' second moments),
which blurs the detail away (NEAR_BLUR 0.6 m of footprint + blur) and dims the caustics. The image fades with the path up
to the eye (IMAGE_SCATTER 0.1 /m; a boulder at half the rate); the mean light still comes through (T), so the hue runs
sand → turquoise → navy by depth as before. The terrain's shadow map darkens the sun's share on the bed (the island's lee
on the shelf at a low sun).

**The transition from the shelf to the deep (round 2, owner 2026-11-13: "still below the bar, especially the transition
from deep to clear"):** v1's column is `src/water.js` L1: the view refracted through the rippled surface, the bed's
depth read where that ray lands (one fixed-point step), the path down the refracted sun and up the refracted view,
Beer–Lambert per channel, `E · (A · T + R∞ · (1 − T))` with A the constant sand (BED.mean) at every depth, the depth map
clamped at 60 m, then × WATER_LOOK (shelf (0.62, 1.85, 1.12) → deep (0.5, 2.6, 3.2) over 6–16 m of bed depth) and
× (1 − F). Three things made v2's band switch instead of glow: (1) M2's bed albedo went sand → silt (0.46 → 0.20) over
4–25 m, so the light still coming off a 10–25 m bed was a third of v1's; v1's luminous band over the drop-off is that
transmitted sand light (A · T, blue T ≈ 0.28 at 16 m), lifted by its deep tint; (2) the first round's SHELF tint darkened
the shallows and ended at 20 m, flattening the band further; (3) the bed is geometry, so the depth the optics used was
exact at every pixel, while v1's sways with the waves. Now: the bed's albedo under the column is v1's sand everywhere
(the bake's noise shade kept); the depth the column uses, `depOpt`, is the bed's depth where the view refracted through
the full rippled normal lands, from the bed's own slope (the baked normal) along that shift (one slope tap where the
pixel cannot resolve the bed, the four cascades where it can), clamped at 60 m as v1's; and v1's WATER_LOOK applied
relative to its deep value (TINT_SHELF = shelf / deep, 1 from 16 m down), so the shelf and the drop-off take v1's turn
and **the deep body stays v2's own** (the owner's navy): the blend to v2's deep is WATER_LOOK's own 6–16 m band, with
nothing changed past 16 m, and the surface's Fresnel, glint and foam untouched. One constant is fitted, not ported:
v1's light entering the water is its horizon sky's colour (`E = horizon × 0.9 + sun × 0.08`, blue-white, in v1's HDR
scale under v1's AgX) and v2's is the physical sun + sky irradiance (white; the deep body is calibrated on it), so v1's
ratio under v2's light turned the shelf sand-yellow (cam I's near shore (125, 140, 96) against v1's (15, 102, 98));
`ENTER` (0.032, 0.54, 1.04) is that balance, set on cam I's samples (the hue first, then × 0.8 for the level): the
shelf then reads near v1's (4, 83, 105), the near shore near (15, 102, 98) (the sampled rows are).
The cost of the port is kept inside the budget by reach, not by the model: the bed's detail resolves to 0.4 m of blur
(v1's 0.6; past it the stones are under a pixel at 2560 × 1600), the cobbles only under 0.12 m, the second caustic net
only under 0.25 m (v1's phone path), and the depth's wave sway only where the bed slopes, within 30 m of depth and 2 m
of footprint; `?bed=0` draws the plain column (the A/B).
**Round 3 (owner: "from this view [cam I] you can clearly see the sharp lines in the water").** Two lines, two causes,
found by switching layers: (1) straight lines across the shallows were the detail's own edge: v1 blends the detailed bed
into the plain column by wNear (`mix(legacy, nearCol, wNear)`); the port had gated the branch by wNear but not blended by
it, so the footprint's contour (a straight line on screen) drew where the detail switched off; now blended, and the
second caustic net fades in over 0.18–0.25 m of blur instead of switching. (2) The hard diagonal turquoise/navy edge on
the left is the shelf's lip seen at grazing: the rays past it clear the shelf (−5 m) and meet the bed again 230–450 m
away in the bay's channel at 21–49 m (traced with the CPU twin: `renders/m5c/selcheck3.mjs`), so the line is a true
horizon of the bathymetry, not a data seam (the lidar shelf and the 1998 bathymetry join there in a 2 m step, but the
step is behind the lip). It reads hard in v2 and soft in v1 because of the water past it: at that grazing angle the
surface is mostly reflection and the little bed share is the water's own body; v1's channel there is (18, 99, 126)
(its body × its deep tint (0.5, 2.6, 3.2)), v2's (17, 32, 85) (the owner's navy, under the far shore's dark mirror).
The shelf and the lip now match v1 (shelf v1 (47, 118, 136) / v2 (24, 83, 95); lip (16, 99, 110) / (30, 75, 90)); the
mid water 16–35 m keeps v1's luminous blue in the bed term (TINT_MID (0.9, 1.35, 2.1), eased to 1 over 35–55 m inside
the surface's own 40–60 m hand-over, so the open lake is untouched), which softens the plateaus in the looking-down
view but moves the channel pixel by only 3 levels: at grazing the pixel is the surface's, not the bed's. Softening the
lip further means a brighter mid-deep body or mirror in the surface (render/water.js), which is outside the bed and
would move the deep-water look the owner kept; left as a decision for the owner (the edge transect:
`renders/m5c/transect-camI-edge.png`, the crops: `stack2-camI-edge-crop.jpg`).
**The island slope (owner: "is that real and close to the real island?").** The mauve, mottled slope was the detail's
grain applied per channel (the granite tile's pink veins tinted the photo); v1 rides the layers' grain on the photo as
a luminance ratio only (`detail` in terrain-mesh.js, clamped 0.4–1.8). Ported, with v1's triplanar side projections on
cliffs (slope past 23–32°: the x and z projections replace the top-down tap, weighted by the normal), so a steep face
shows granite grain at its own scale rather than the stretched top-down texels; the dark blotches that remain are the
photo's own crown shadows, which v1 shows too (`stack2-island-slope-crop.jpg`). The photo's colour is v1's file (the 2 m
level is the 1 m file's downsample, checked texel for texel at six island points); the warmer cast against v1 is v2's
lighting (the physical sun on the west face at 13:00, no AgX), not a decode error (the same cubic sRGB decode as the
tiles' encoder's inverse within 0.3 %).
**Round 4 (owner, 2026-11-13: "brighter mid water"; reverted the same day in M5d, below: seen on v2 the owner found the
colour "not real and uncomfortable to the eye", and the navy ruling now covers all water past the shelf).** Water 20–50 m deep near the shelves and drop-offs now takes
v1's luminous blue in both places it is drawn: the bed pass's column (render/bed.js) and the surface's own body
(render/water.js, the one term touched there: `body = … × RINF × mix(1, TINT_MID, smoothstep(8, 26, depth)) × mix(1,
1 / TINT_MID, smoothstep(45, 60, depth))`; its normals, mirror taps, Fresnel and glint are main's). The tint, TINT_MID
(0.9, 4.0, 3.0), is v1's body over v2's at the looking-down pose's mid water (v1 (0, 32–48, 109–133) against v2 before
(8, 17–26, 64–74)); it rises over 8–26 m of bed depth, overlapping the shelf tint's 6–16 m ease (a first cut that
started at 12 m left a dark trough between the two), holds to 45 m and eases to 1 by 60 m, where the terrain stops
drawing and the body stands alone. **Where the hand-over lands:** 45–60 m of depth, inside the surface's own 40–60 m
bed → body blend, so the two curves meet without a seam; past 60 m nothing changed: the open-lake frames (cam L and cam
M, before against after) are identical pixel for pixel over the near and mid water (rows 60–100 % of the frame: 0 px
differ; the differing band at 45–60 % is the far shore's land and shallows). At cam I the channel past the lip reads
(17, 42, 114) against v1's (18, 99, 126) and v2 before's (17, 32, 85) (the looking-down mid water (3, 35, 138) against
v1's (0, 32, 109)): the blue is v1's; the green that remains short is
the mirror, not the body (v1's channel reflects its pale horizon sky, v2's the far shore's dark forest at that grazing
angle), and a body tint that closed it (green × 20) turned the looking-down mid water cyan (4, 112, 158 against v1's
0, 32, 109), so the body follows v1 from above and the lip at cam I is left as soft as the body can make it.
The transects (`renders/m5c/transect-camI.png`, `transect-down.png`: RGB along a line from the sand to the deep, v1 thick,
v2 after thin, v2 before dotted, the sampled colours as three swatch rows) show v1's blue hump over the drop-off, v2
after following it, and v2 before dropping to the navy in a step. **The hard edge** was never the 1998 bathymetry:
Fannette's shelf really drops from −6 to −58 m in 40 m (`terrain.field.height` along cam I's line), and v1's 4 m depth
map draws the same cliff; the edge was the column's light, above. (Later the same day, § The lake bed's straight edges: the drop is the survey's and stays; its two
creases, 5 m and 40 m off the shore, were the build's ramp, now rounded; and the hard line a low eye saw was v2 drawing the
bed along the straight ray, now refracted.)

**The ground photo (terrain/photo.js, render/ground.js, tools/v2-photo-tiles.mjs):** v1's NAIP albedo (de-lit and graded by
v1's build, public domain) as 256² WebP tiles: the full set is the bay at 2 m (2816 × 1792 px: 77 tiles, 2.18 MB) and the
region at 32 m (1280 × 1920: 40 tiles, 1.42 MB), **3.60 MB in all**; the phone set the bay at 4 m (24 tiles, 0.71 MB) and
the region at 64 m (12, 0.41 MB), 1.13 MB. Chrome cuts and encodes them (quality 0.84, no new dependency); the manifest
holds every tile's bytes (the photo test demands them). **Never in the first load:** a live page starts the stream after
the first frame, the bay's tiles nearest the eye first, then the region's nearest first (`streamOrder`; six fetches in
flight; a worker decodes; the frame uploads ≤ 1 MB, four tiles, after the terrain's and the forest's slices); a capture
primes every tile before its first frame. On the GPU one rgba8 array texture with a full mip chain (the bay on layer 0,
the region on layer 1; 2816 × 1920 × 2: 29 MB with mips; the phone set 7 MB); each tile lands with `writeTexture` and
re-bakes its mips over its own 256-aligned footprint (an aligned box filter never reads across a tile, so an unlanded
neighbour cannot darken it; the top mips that mix tiles re-bake as each lands). An unlanded texel is 0: the shader reads
the alpha as the landed flag (v1's class alpha is ≥ 64 everywhere) and as v1's class index on the bay level (forest,
brush, bare: `naipClass`), which steers the detail layers. The photo is the albedo above the water's edge where it has
landed, the finer level over the coarser (a 200 m soft edge), at the pixel's footprint's mip, never on snow; the class
albedo stays under it and past the region's box (the far ring). Under the forest's cards the floor swap (M5b) now uses
the photo's forest class where it has landed.

**The detail set (render/ground.js, DETAIL_READ in terrain.js):** v1's two strips as they are (`terrain/ground/albedo.webp`
512² × 6 sRGB, `pack.webp` 256² × 6: the normal in R, G and the height in B; ambientCG CC0, 0.47 MB, fetched after the
first frame, the pack drawn at 2×) in one 512² × 12 array texture with mips; the terrain's draw turns the grain on only once
both strips and their mips are in. v1's layer rules cut to what the pixel knows: cliffs (slope past ≈ 20°) and the photo's
bare rock → granite slabs (a 90 m noise picks slabs over decomposed granite); gentle bare ground and brush → decomposed
granite; the forest's share → needle duff; low gentle ground at the water → sand; brush on gentle ground → grass; the
season's snow. The two heaviest layers blend by height (Mishkinis); each is anti-tiled with two taps on a 3-tile cell noise
(Quilez); the grain rides on the photo's colour as the albedo over the layer's mean (its last mip: no manifest), so the
photo keeps its tone and the ground gains its grit within 350–700 m; the pack's normal bends the baked normal within
150–350 m. Not ported from v1: the triplanar cliffs, the 27 m macro tap, the canopy raster's duff.

**The boulders (terrain/rocks-rules.js, render/rocks.js):** v1's shore boulders (`src/landmarks.js`: a jittered grid over
the bay kept on the shore band, never on a beach, about half the band, 0.25–1.25 m, sunk 0.35 r) and the rules' rocks on
the slopes (`src/trees-scatter.js`: granite among the brush on steeper open ground), as one GPU scatter over the bay's 2 m
grid box (one candidate per 8 m cell: 315 k cells, from the same heights and cover the terrain bakes, re-run at every
grid swap; the placed rocks packed into one list, ≈ 6.5 k). Without v1's shore-distance grid the band is by height and
slope: −1.5 to +3 m, above 0.8 m only where the ground climbs (the bay's flat head is not shore rock), no beach, 55 % of
the band, 0.3–1.2 m; the slope rocks on 20–50° ground under 60 % forest, not snow, 8 %, 0.5–1.6 m. A rock's centre sits
(0.35 + 0.4 · slope) r under the ground, so a rock on a steep face never floats downhill (the test holds the ground above
the rock's bottom under its centre and its footprint, on the real grids). Per frame a cull (the frustum, 2.5 km, ≥ 0.7 px)
appends the visible into one `drawIndexedIndirect` of v1's lumped icosahedron (42 vertices, 80 faces, squashed 1.15 ×
0.7 × 1), lit as the terrain (the M1 sun through the transmittance LUT, the sky, the terrain shadow, the aerial
perspective, the clouds), v1's two granite tones by a noise lifted to the clarity bed's weathered granite, wet and dark in
the wash; below the waterline the rock is seen through the water column with the bed's own K, R∞ and up-share (no seam at
the surface). The rocks receive the shadow and do not cast: a 1 m rock in a 2.4 m texel map shadowed itself.

**The terrain's sun shadow (render/shadow.js, shadow-read.js):** one 2048² `depth32float` map from the sun over ±2.5 km
round a point 700 m before the eye (2.4 m texels), 7 km deep along the sun, snapped to texels in the light's frame; the
terrain's own CDLOD patches drawn by a second selection against the light's box (so a ridge outside the view still casts
into it; the camera's LOD and morph, so the geometry is the drawn one); a 4-tap PCF read with a slope-scaled bias (3 m
at the vertical, more on a glancing face) in the terrain (land and bed), the forest cards (the card's centre) and the
boulders. Drawn on the first frame, then every 4th live frame or when the sun turned 0.1°, the box's centre moved 400 m
or a grid swapped; the record the readers use is written only with the map, so the two always agree. `?tshadow=0` leaves
the map empty (the A/B), `=2` draws it every frame (the budget's measure). Not read by the water's mirror of the land yet
(the reflected walls stay sunlit at dusk).

**Determinism:** the scatter and the cull append with atomics (the forest's fixed order was not needed: the boulders are
opaque and depth-tested, so their order never changes a pixel); the bed's detail and the tiles' content are hashes and
files; `goldens:v2 -- --twice` 0 px (below).

**The Emerald Bay photos (2026-11-18; awaiting the owner's eyes).** The bed's look moved from v1's to the
owner's photos of the bay: `PHOTO_LOOK` in `render/bed.js` greens the shelf tint (× 1.12 on green), holds it to 9 m
(the ease to v2's navy now 9–16 m, was WATER_LOOK's 6–16 m) and makes the boulders mossy green-teal granite
(`SILT` and the navy past 16 m unchanged). `BIG` is the desktop's big-boulder bed (`src/core/features.js` bedBoulders: a
desktop and a tablet at L0–L1 'full', a phone and L2–L3 'lite'; `?boulders=`): two packed layers on the rocky
(sloping) shallows, drawn to a 1.1 m footprint (the sand's small detail still ends at NEAR_BLUR), compiled into the
terrain's draw (`bedWgsl({ big })`, no new pipeline or texture). Both paths carry the boulders' mean tone past their
detail (`bedMeanAlbedo`, its JS twin `bedMean`), so the rocky shallows keep a darker green band from afar.

### Budgets (M5c, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians; "before" is main at f8426e3 served beside it, the same poses)
Run noise on the totals ≈ ±0.3 ms. The shadow map is drawn on the first frame and every 4th after (its pass reads 0.08 ms
in these captures; 0.46–0.52 ms on the frames that draw it, `?tshadow=2`); a live page pays ≈ 0.12 ms a frame for it.

| View | Size | GPU before → after | M5c's cost | v1 at the same pose | notes |
|---|---|---|---|---|---|
| v1's cam I 13:00 (the island, the shelf) | 2560 × 1600 | 4.07 → 5.41 ms (paired, round 4 on main 35b4b692; the GPU shared with another helper all afternoon) | **+1.35 ms** | 32.7 ms | the shelf's detail and caustics over a third of the frame, 396 boulders |
| Sail start 13:00 (follow camera) | 2560 × 1600 | 7.30 → 8.91–9.00 ms (two paired runs, round 4, shared GPU; 6.35 → 7.62–7.75, +1.2–1.4, on the quiet machine in round 2) | **+1.6–1.7 ms** | 52.2 ms | the whole bay's bed under the surface: the slope read is gated to where the bed resolves (2.2 ms without the gate); round 2's column port first read +1.8, then the reach trims above |
| v1's cam A 13:00 | 2560 × 1600 | 6.61 → 7.01 ms (paired, round 4) | +0.4 ms | 38.8 ms | 766 boulders |
| Sail start 18:45 (the shadows) | 2560 × 1600 | 7.41–7.47 → 9.22–9.45 ms (two paired runs, round 4) | +1.8–2.0 ms | 18.2 ms at 1280 × 720 | the north shore and the island's lee in the map's shadow |
| phone set, 16:00 with the hands | 390 × 844 | 2.25 → 2.61 ms (paired, round 4) | **+0.36 ms** | | the phone tile set (1.1 MB), 117 boulders |

Targets: ≤ +1.5 ms at 2560 × 1600 in cam I and the Sail start (met, the Sail start at the limit), ≤ +0.6 ms at 390 × 844
(met). Pipelines: +9 (45 in a capture, 50 on a live Sail page with M4's cockpit), 0 after the first frame. Bytes: the first
load unchanged (1,396,762 B of grids + the manifests ≈ 1.40 MB; no tile, strip or rock data in it); after the first frame
the full photo set 3.60 MB (117 tiles) + the detail strips 0.47 MB, the phone set 1.13 MB + 0.47 MB; the boulders are
scattered on the GPU (0 bytes). The build: `dist-v2/assets/index-*.js` 474.8 kB (175.9 kB gzip, with M4's UI; M5c's part
is WGSL text) + the Sail chunk 285.5 kB (98.3 kB gzip), the ground worker 0.6 kB; `dist-v2/photo/` 5.0 MB on disk (both
sets, streamed per set), `dist-v2/terrain/ground/` 0.47 MB; 23 MB in all with the grids. No frame over 33 ms while the tiles stream (the frame uploads ≤ 1 MB: four tiles and
their mip bakes). CPU: the shadow's second selection ≤ 0.1 ms on its draw frames; the boulders' and the photo's per-frame
work is one small uniform write each. v1's frame at these poses is 32–52 ms at 2560 × 1600 (its full page).

## The lake bed's straight edges (fix(terrain) + fix(v2), 2026-11-13: tools/terrain/build_tahoe.py, render/bed.js, terrain.js)

The owner, 2026-11-13: "For the underwater part, is the terrain the same for v1 vs v2? I feel the lake bed is not real.
From the shore I can see some sharp lines where it suddenly goes deep, like a straight-line edge."

**Same data: yes.** v1 and v2 read the same grids (`terrain/*.lsh`), the same sampler (v2's `terrainHeight` is v1's
`heightAt`, held to it at 4,000+ points by `terrain-data.test.mjs`, 1.4 mm on the GPU), the same frame. The lines were two
things: a v2 optics fault (most of what a player sees) and three survey artefacts in the shared bed (both engines).

**The edges, found on the bed (top-down depth map of the bay from the grids, a Hough search for straight creases in water
under 30 m: `renders/bedseams/edges.py`, the marked map `renders/bedseams/depth-marked.png`):**

| Edge | Class | Length (m of detected segments) | Before → after | What was done |
|---|---|---|---|---|
| v2's lip horizon: the straight eye ray runs on under the surface past a shelf's lip and draws the deep floor hundreds of metres on, a hard navy line along every lip in view (Fannette's shelves, the north shore, the start) | (d) optics, v2 only | every lip in view (screen lines 300–900 px long at 1280 × 720) | hard line → v1's soft turn | the column's depth and the detail are read where the refracted ray lands (below) |
| The 1998 survey's coverage edge 40–60 m off the north shore and north-west of Fannette: the gap filled with the edge's depth held flat, then the shelf ramp met it in a step | (b) survey | 3,107 → 0 | steps of 4.7 m between 2 m neighbours → 1.24 m | the edge's depths carried smoothly across the gap (Laplace) under the 1:6 shelf, the join feathered |
| Voronoi fans on the bay mouth's sill (the survey missed it: each gap cell took its nearest surveyed depth) | (b) survey | 468 → 0 | bends, 99th percentile 0.375 → 0.175 m per 2 m | the same smooth carry, a 4 m smoothing over the gap |
| The shore ramp's two creases, 5 m and 40 m off every shore (a straight mix of the 1:6 shelf into the survey): each lip an offset copy of the shoreline | (b) survey + shore merge | 1,897 → 1,419 | what is left: rounded bends at 20–30 m of depth, under the navy | the ramp's ends rounded (C1), its outer end wandering 48–64 m along the shore, never steeper than before |
| Fannette's flanks (from the shelf to the 55 m floor in about 40 m), the bay's south-east wall, the survey's own slopes | (a) real | 2,760 → 2,539 | kept; steepest slope 2.0 → 1.9 | none (the island's steepest part stays the first build's) |
| Nested grids: island 1 m / bay 2 m at the island box (±191.5 m) | (c) | 0 | ≤ 0.10 m across the box edge, both builds | none needed |
| Nested grids: bay 2 m / basin 10 m at the bay box's north edge (z = −1,791 m, the lake shore 500 m north of the mouth) | (c) | (outside the bay) | 2.88 → 2.49 m, inside the 24 m blend | none (outside the playable shallows) |
| CDLOD level seams, the 60 m clamp, the shelf tint's 6–16 m band, the depth sway | (c)/(d) | none found | smooth by construction (the LOD test proves the morph) | none |

**The v2 fix (render/bed.js `bedRadiance`, render/terrain.js `bedHeightAt`):** the terrain pass rasterises the bed along
the straight eye ray, but the water bends that ray down (49° from the vertical at grazing). From a low eye the straight ray
crossed a 1–4 m shelf and met the bed far beyond its lip, so the pixel took the deep floor's colour: a hard navy line
exactly where the lip is, straight where the lip is straight. v1 reads the bed where the refracted ray lands (src/water.js
dBed). Now so does v2: the depth under the surface crossing, then at the refracted landing (one fixed-point step, two
height reads of the bay level, the one height slot the fragment stage reads: one more sampled texture there, 14 of 16;
ultra M2: a storage buffer now, § The caustics on the bed);
the detail and the caustics are read at that landing, and the pixel's footprint is taken along the refracted path (the
detail fades with the distance to the bed the eye sees, not along the lip the straight ray passes). Outside the bay level
(the open lake) it keeps the drawn point. The deep body, the reflections and the shelf tint are untouched: the navy past
the shelf stays, no mid water is brighter, the reflections are the surface's own.

**The shared data fix (tools/terrain/build_tahoe.py `seamless_bed`; `--legacy-bed` rebuilds the first build's bed):** the
same sources and the same 1:6 shelf, joined smoothly. In a coverage gap the survey's edge depths are carried across by the
harmonic surface (Laplace's equation, solved exactly on each level's grid, level into the shore) in place of the nearest
one, never deeper than the shelf (a soft maximum), smoothed by 4 m; the join of the survey and a gap is feathered (a 6 m
Gaussian eased out over 24 m); the shore ramp's two ends are rounded and its outer end wanders 48–64 m along the shore, so
it is never steeper than before. The wash (under 8 m off the shore, eased in by 16 m) keeps the first build's bed: the
beaches, rocks and shoals the grounding, the sounder and the assist were tuned on. Only in a box round Emerald Bay (x
−1,400 to 2,700 m, z −2,100 to 1,000 m), eased out over 400 m: the rest of the lake is the first build's to the bit (the
harbour's piers and moorings were laid out on it). Only water cells change (land, the shore-distance and the cover grids
are byte-identical); a rebuild with the old rules reproduces the committed grids byte for byte. The phone set is re-made
by `tools/terrain/phone_terrain.mjs`, the towns' piers on their pilings by `tools/v2-towns-pack.mjs`.
`v2/tests/bed-seams.test.mjs` holds it: across 67 transects of the old seams no step over 1.6 m between neighbours 2 m
apart (the first build: 4.7 m), the sill's bends under 0.2 m at the 99th percentile (0.375), and Fannette's east flank still
falling from the shelf to the floor within 50 m.

**What else moved with the bed:** v1's wind reads the bed's gradient in its valley analysis (src/sim/wind.js
valleyPoint), so the wind over the bay changes slightly with any bed change, and with it Cruise's voyages: the pinned
fixtures were re-recorded on this branch (`tests/fixtures/wind-modifiers.json`, the terrain case only; `sim-cruise.json`;
`sim-snapshots.json`, Cruise only; the other modes are unchanged to the bit), and the chart card's map
(`brand/chart-bay.svg`) re-drawn. One moved Cruise voyage sent the island camera's glide through a pine's crown between
two 10 m path samples (a latent sampling gap): `src/modes/chill/cameras.js` now samples flights every 4 m.

**Cost** (`tools/v2-perf.mjs`, main against this branch, interleaved, 4 rounds, the GPU shared with other helpers):
the scene pass +0.3–0.6 ms at 2560 × 1600 (the Sail start, cam I; two height reads per bed pixel, the detail where the
refracted bed resolves it), +0.03 ms on the 390 × 844 phone frame. Pipelines and bytes unchanged.

**Open (slow lane):** `tests/slow/ground.slow.mjs` fails 2 cases of the assist at one beach on the north-west shore
(−158, −316), the old survey seam's corner: at −35° 6 kn wind ahead and −70° 8 kn the boat touches. The beach is the same
one main picks; its approach is now 0.6 m shallower 24 m out (5.0 against 5.6 m), where the seam's step was smoothed. A
standalone re-run of the same 45 approaches with the target's normal rounded to two decimals passes all on both grids, so
these are marginal runs of the assist on a gentle shoal. The fast suite's grounding, sounder and assist tests pass. Left
for the integrator: accept, or tune the assist's lookahead on gentle shoals (outside this item's files).

The proof: `renders/bedseams/final/stack-*.jpg` (v1 | v2 before | v2 after, 960 wide: Fannette south-west, north and east,
the start west and north-east, the edges marked), `renders/bedseams/depth-marked.png`.

## The island and the shore, round 5 (M5d, 2026-11-13: render/water.js, terrain.js, forest.js, bed.js)

**The owner's ruling first (2026-11-13, on round 4's "brighter mid water", seen on v2: "it is now close to v1 version,
but I do not like that color, it is not real and uncomfortable to the eye").** Most of Emerald Bay is under 60 m deep,
so round 4's TINT_MID had turned the whole bay toward v1's bright blue, not only the shelf edge. **The navy ruling now
covers all water deeper than the shelf (past about 16 m, where the shelf tint ends), in the bay as in the open lake**
. TINT_MID is removed from the bed pass's column and the surface's body, and the plain
column's bed albedo goes back to M2's silt past the shelf (`bed.js` SILT: v1's sand to 12 m, silt by 25 m; round 2's
constant sand had lifted a 20–40 m bed's transmitted light into that blue). Proof against 35b4b692 (the last sha before
round 4; both captures 1280 × 720, sRGB means over 13 × 13 px): the Sail start's mid water 26,33,79 against 22,30,77,
near 3,13,70 against 3,13,69, left 19,28,74 against 17,27,74; cam M mid 70,81,110 against 76,85,113, near 46,55,90
against 49,56,90; cam B mid 77,91,117 against 85,97,121; cam I past the lip 42,58,101 against 36,52,97 (round 4 had it
at 36,65,140). The shelf keeps round 2's approved look (cam I shelf 40,108,116, the near shore 18,105,102: both as main).
The cam I edge may now be softened only through the surface's reflection and the shelf's own 0–16 m band.

**1. The shelf edge at cam I: what the mirror holds there, measured.** A temporary debug switch (gone again) wrote the
water shader's terms as pictures: the mirror alone, the land's share in it, the sky alone, the Fresnel, √σ², n·v
(read back through the inverse of the tonemap, with a constant 0.1 frame as the calibration). At the water past the
lip (40–70 m off, a 9–15° depression, n·v 0.16–0.27, rms slope 0.06–0.09) **the mirror is the sky, not the far shore:
the land's share is 0** there in v2 as in v1 (the far shore at that azimuth is low; v1's trace finds sky and keeps its
probe), and the Fresnel is v1's own rule to three decimals (0.17–0.29). So the edge was never the mirror's land, and
the mirror of v2's deeper, physical sky at 10–15° over the navy body is what the owner now asks for. What the round
changed in the reflection, as a port of v1's softness: (a) **the horizon lift only within the horizon band:** the
sparkle fix lifted every reflected ray by 1.5√σ² (≈ 8° at the lip), which pushed rays that a true mirror sends into the
bay's walls up into the sky; now the lift fades to nothing by 3√σ² of elevation, so the land stands in the mirror where
v1's trace shows it; (b) **the mirrored land's haze is v1's:** the march's hit colour takes v2's own air over the
mirrored path (the medium's extinction at the lake's altitude, the horizon sky as the in-scattered light, the same
medium as the terrain's aerial perspective) and then v1's `hazeM` 9 km (`water-aa.js` MIRROR_HAZE_M, tested: 2 km
20 % sky, 10 km 67 %, 30 km 96 %), in place of M2's ad-hoc 30 km mix, so a far shore mirrors broad, soft and pale and
the ridge line in the water is never darker than the land above it. The body and the shelf band are unchanged by this
item. The flicker metric after (below) is at or under M5c's.

**2. The island slope.** v1's slope reads as pale, cool lichen-grey granite with 1–2 m knobs; v2's read browner and
smooth. Two causes, measured on the same photo texels: (a) **v1's granite relief was never ported:** `terrain-mesh.js`
normalNode bends the rock's normal within 500 m by the gradient of a 3-D noise (flatter along y: the joints of sheeted
granite), which is the knobbly, jointed look; now in the terrain fragment on the rock share (cliffs and the photo's bare
class), `RELIEF` 150–500 m, gain 0.2 (v1's 0.32 on a Perlin gradient; the value noise's gradient runs steeper); a branch,
so forest and far ground pay nothing. (b) **The tone map:** over the rock pixels of cam I's slope crop (43 k px) v1's
mean is (100, 101, 89) sRGB at saturation 0.34, v2's was (88, 84, 68) at 0.51: the same NAIP texels, darker, redder and
more saturated under v2's physical sun and ACES fit than under v1's AgX. As the sail cloth's `CLOTH_AMB`, this is a
local material match, not a grade: `ROCK_LOOK` (1.35, 1.56, 1.76) lifts the photo's bare rock toward v1's samples
(fitted twice: the first ratio, then re-measured with the relief in: 98,98,88 at 0.33), on the rock share only, never
the forest floor, the beaches or the snow. After: the slope's rock mean (98, 98, 88) at saturation 0.33 against v1's
(100, 101, 89) at 0.34 (`renders/m5d/crop-slope-r2.jpg`). Still v1's and not ours: the lidar brush's olive mat on the
island's gentler ground and the crown shadows the photo carries read greener in v1; a mauve shoulder at the knob's left
is the photo's own veins.

**3. The shrubs.** v2's manzanita was a smooth dome at half v1's leaf colour (0.050, 0.068, 0.030 against species.js
0.105, 0.138, 0.066), lit flat. Ported from v1's `tree-gen.js` shape 'shrub' and `textures.js` leafCard: the mound is a
flattened ellipsoid with 7 branch clumps round it and a flat skirt at the ground (its rim dips under the ground, so no
flat edge shows on a slope), smooth-joined, the surface ragged at three leaf-clump scales so the sun rakes it and the
hollows show the dark inside; v1's leaf rule for the colour (grey-olive, value 0.55–1.3 per clump, a dusty grey that
lifts red and blue), the shade from the field itself (an SDF occlusion at two radii, and dark at the skirt: v1 bakes its
mound dark at the root so it sits in its own shade), more of its own normal than a tree's (the clumps shade one by one);
the shrub's card is sunk 0.08 m, not a trunk's 0.25 m, so the skirt lies on the ground; the size variety is the lidar's
(heights 0.7–1.6 m, radii 0.7–1.9 m over the pack). The leaf albedo is set at the level v1's shaded cards read on screen
(0.046, 0.064, 0.028: cam I's v1 shrubs 46,56,34; v1's full value read 96,113,85 under v2's light). All of it is in the
one-off bake (then `CARD_BAKE_WGSL`; since T5 the shrub is 110 leaf sheets on red stems, § The forest): the per-frame cost, the card count and the LOD are M5b's. Still v1's: the ragged
leaf-card silhouette (ours is a smooth-edged mound at the frame's resolution).

**4. The boat's shadow on the bed:** not done. The terrain's fragment already samples 16 textures (the limit; ultra M2's freed slot went to the caustics), so the
boat's 2048² shadow map cannot join it; drawing the hull into the terrain's own shadow map (2.4 m texels, every 4th
frame) would give a blocky blob that jumps at 15 Hz. The honest road is a second, small map round the boat read in the
bed pass in place of one of the detail strips' bindings, which is a later item.

### Flicker and budgets (M5d, measured 2026-11-13 on the M5 Pro Mac, headless Chrome; the GPU was shared with other helpers' jobs that afternoon, so the pairs are back to back and the totals carry noise)
**The flicker metric** (`tools/v2-flicker.mjs`, the M5c pose and settings; "main" is 79839dc0 measured the same hour from a
copy of it, since M5c's table was taken before rounds 2–4 moved the water band):

| Pose | v1 tstd / jump | main (79839dc0) | M5d after | the same without the horizon-band lift |
|---|---|---|---|---|
| 13:00, 1280 × 720 | 7.9 / 2.25 % | 7.59 / 2.14 % | **7.87 / 1.87 %** | 9.00 / 2.78 % |
| 18:45, 1280 × 720 | 17.4 / 4.00 % | 16.41 / 3.89 % | **16.62 / 3.38 %** | 17.17 / 3.72 % |
| 13:00, 390 × 844 | 9.0 / 3.34 % | (M5c: 10.3 / 3.15 %) | **8.59 / 2.22 %** | – |
| 18:45, 390 × 844 | 8.0 / 1.50 % | (M5c: 14.5 / 5.11 %) | **13.88 / 4.09 %** | – |

The share of > 20-level jumps falls at every pose; the mean temporal std is within 0.3 of main's at 1280 × 720 (the
hazed, paler mirror of the far shore moves with the waves a little more than the dark one did) and well under M5c's
on the phone frame. The lift change is kept on these numbers.

**The budgets** (paired captures, before = main 79839dc0 served beside this branch, after = this branch, back to back,
two rounds; frame-total medians over 60 frames; `?maxpx=5e6` at 2560 × 1600; the totals are ≈ 3 ms over the README's
earlier figures because the GPU was shared that hour, the pairs are what count):

| View | Size | run 1 before → after | run 2 before → after | M5d's cost |
|---|---|---|---|---|
| Sail start 13:00 (follow camera) | 2560 × 1600 | 12.21 → 12.04 (−0.17) | 12.84 → 11.43 (−1.41) | **≤ 0: cost-neutral or better** (the mid tint's two smoothsteps and its 1/tint gone from the bed and the body; the relief is a branch the bay's bed and far ground never take) |
| v1's cam I 13:00 | 2560 × 1600 | 6.97 → 6.74 (−0.23) | 6.77 → 7.02 (+0.25) | 0 ± 0.25 (the relief's 8 noise reads on the island's rock within 500 m) |
| v1's cam A 13:00 | 2560 × 1600 | 8.18 → 8.93 (+0.75) | 8.97 → 8.11 (−0.86) | noise (the two runs disagree in sign) |
| Sail start 18:45 | 2560 × 1600 | 10.61 → 10.73 (+0.11) | 10.46 → 10.26 (−0.20) | 0 ± 0.2 |
| phone set 16:00 with the hands | 390 × 844 | 2.54 → 2.56 (+0.02) | 2.56 → 2.51 (−0.05) | **≤ +0.05** (the +0.2 ms limit) |

Pipelines: none added (the relief and the rock look are in the terrain draw, the shrub in the card bake, the haze in the
mirror march); 0 after the first frame. Bytes: none (no asset; the shrub is baked). The build: `index-*.js` 489.1 kB
(181.4 kB gzip, +5.5 kB: the relief's noise and the comments in the WGSL), the Sail chunk unchanged, the scrub clean.
Gates: v1 `node --test tests/` 1580/1580, v1 goldens 16/16 (nothing blessed); `npm run test:v2` 168/168 (+3 suites'
worth: the mirror haze, the silt ease, the ground look and the shrub shape); the 15 v2 goldens re-blessed on the
branch for the owner (every frame has water or the island in it), `--twice` 0 px on every frame.

## The towns (10a, trimmed by the owner 2026-11-13: render/towns.js, towns/format.js, towns/wgsl.js)

**Scope (owner, 2026-11-13: "trim towns and add the pier"):** what Sail sees from Emerald Bay and its mouth. The piers and
breakwaters near the shore as simple meshes in v1's places (the priority); Hwy 89's cut on the bay's walls and the ski runs
on the far slopes as colour in the terrain's shading, the forest kept off them. **The towns' buildings wait for Sail to
reach the open lake**; the night lights (§ The night) already show the towns.

**Data (`tools/v2-towns-pack.mjs` → `v2/assets/towns/`, 193.5 kB + 150.6 kB gzip, streamed after the first frame):** v1's
own layouts on v1's terrain (`makeTerrain`: the heights v2 draws). Inside the shoreline module's region (the bay and its
mouth to 6 km east) v1 draws its OSM piers through `src/shoreline.js`: a 0.3 m deck at 1.4 m on pilings every 3 m both
sides, from the bed to the deck, a boathouse (timber walls, a dark green gable, a pale lake door) on 10 of the 33, and the
disused light tower on the headland; outside it the towns' deck segments (`src/towns.js` dMat: piers, marina outlines,
breakwaters); the harbour (`src/harbour.js`, run by three in node: its merged static mesh, 6,396 triangles with their
colours, and its breakwater's 1,554 granite rocks with their tints). The pack writes six meshes (v1's box, its 6-sided
piling, its gable prism, the tower, the harbour, the rock) and 5,745 instances (a 3 × 4 affine and an sRGB tint each,
sorted by 1 km chunk). The marks: v1's `L.fine` (2.5 m over the bay's walls: the asphalt and the cut's scar) and the
coarse mask's ski channel (25 m: the runs and the lift lines), each cropped to its marked cells, with their 2 × 2 mean
pyramids: 9.51 MB, one storage buffer on the GPU.

**The shore's draw (`render/towns.js`):** one pipeline (`towns-shore`), the six meshes in one vertex buffer, the instances
as a second (per-instance) buffer. Per frame the CPU picks each mesh's chunks in its range and the frustum and merges
neighbours (desktop: decks 16 km, pilings 1.5 km, roofs and the tower 9 km, the harbour 25 km, its rocks 5 km; the phone
about half): 2–5 draws from the bay, a few hundred instances. Lit as the boulders: the sun through the transmittance LUT
at the point's height, the terrain's shadow, the sky's hemisphere, the night's land light, the aerial perspective, the
clouds in front; under the waterline through the water column with the bed's numbers (the pilings and the breakwaters'
toes go down into the clear water). **The material (#41b, 2026-11-14):** v1's `MeshStandardMaterial` under v1's light,
with v1's roughness per instance (the pack's material byte, `towns/format.js matByte`: decks 0.9, walls, doors and
pilings 0.85, roofs 0.7, the towns' decks and breakwaters 0.75 with metalness 0.1, the harbour 0.85, its rocks 0.9; the
tower's five parts per vertex): the sun (diffuse and its GGX lobe), the sky's image-based diffuse (five sky-LUT taps round
the normal, v1's environment map) plus the atmosphere light's sky irradiance ((1 + n·up) / 2 of the level ground's, v1's
`AtmosphereLight`), and the sky's reflection through three's split sum (`DFGApprox`). `LOOK` scales them to v1's as
measured by switching v1's terms (its walls and roofs black: the reflection alone reads 1,9,26 and 153,146,142 at the pier
pose, where v2's GGX on its LUT gives 3,4,7 and 109,105,101): the sky's diffuse × 1.5, its reflection × 2, the sun's lobe
× 2. The 2026-11-13 lift (the sky × 1.6 and a warm bounce 0.18) read the walls brown where v1's are a sky-lit blue grey.
At the pier pose (`campos=398,3,-622`, 13:00) the shaded wall reads 37,42,45 (v1 35,43,52; was 19,12,10), the roof
168,170,164 (v1 170,169,163; was 39,59,45); the same wall from the north-west at 1.5 m 70,65,61 (v1 87,73,72). Toward dusk
v2's camera exposes up to 2× v1's (`sim/exposure.js` against v1's flat exposure above the sun's 8.5°), so a sky-lit
wall reads lighter than v1's there (18:45 at the pier pose: 62,62,57 against v1's 27,27,32; was 11,7,7).

**The marks (`towns/wgsl.js`):** the terrain's draw binds the buffer as a read-only storage buffer (binding `B.towns`: no
sampled texture, so the fragment stage's 15 of 16 stay as they were). `townsPaint` runs after the photo and before the
detail's grain and the forest floor: v1's ski-run summer meadow (grass and wildflowers, thin soil over decomposed granite
from 600 m up, the last snow near the season's line, longer on north faces), the asphalt's grey, the cut as a shift of the
ground's own colour toward weathered DG; each mark takes its share of the forest floor. The reader blends two levels of
the pyramid by the pixel's footprint (the far runs never sparkle); a pixel outside every raster pays one bounds test.
**The forest's keep-out (render/forest.js):** the place pass (the lidar crowns and shrubs) and the rules' scatter read the
same buffer: v1's `keepOut` (a run over 0.6, the road or the cut over 0.3) and the runs' thinning (`treeDensity`). v2's
cards draw a crown at 1.35 × its radius, so the road and the cut are also tested at four points 1.1 × the crown's radius
out (`KEEP.reach`): a crown whose edge would close v1's corridor stands back. The page test reads the forest's buffer back:
411 lidar trees and 5,384 shrubs dropped along Hwy 89 at cam A, none kept on a mark.

**The night:** v1's pier-head lights (lights.bin, the same layout) stand on the shipped decks (the node test: all of them
within 2 m).

### Budgets (10a, measured 2026-11-13 on the M5 Pro Mac, headless Chrome; `tools/v2-ab-towns.mjs`, in-page A/B: the shore's draw, the paint and the keep-out off and on in place, 5 rounds × 90 frames, median of the rounds' differences; the GPU shared with other helpers)

| View | Size | frame total, change | scene | shore | cards off → on |
|---|---|---|---|---|---|
| Sail start 13:00 (follow camera) | 2560 × 1600 | **+0.00 ms** (5.3–6.3 ms frames) | −0.02 | 5 draws, 42 instances | 21,991 → 21,729 |
| v1's cam A 13:00 | 2560 × 1600 | **+0.05 ms** | +0.08 | 5 draws, 42 | 43,295 → 43,150 |
| v1's far-shore pose (cam B 10:00) | 2560 × 1600 | **+0.05 ms** | +0.05 | 5 draws, 68 | 38,960 → 38,852 |
| phone set 16:00 with the hands | 780 × 1688 | **+0.05 ms** (limit +0.15) | +0.04 | 2 draws, 4 | 3,197 → 3,164 |

Pipelines: +1 at load (69 in all), 0 after the first frame. Bytes: 0 before the first frame; 344 kB after it (193.5 kB
shore + 150.6 kB mask, gzip; a host that sends them with Content-Encoding gzip is read as it is). GPU memory: the mask
9.51 MB, the shore 0.7 MB. JS: render/towns.js, towns/format.js and towns/wgsl.js.

### What differs from v1
- No buildings, no coarse roads, lawns or lots (the owner's trim); the forest's keep-out has no footprints (v1's +3 m round
  each building) and no towns' thinning of built ground.
- A breakwater's toe goes down to the bed (v1's box floats 0.9 m over the water: through Tahoe's clear water from the boat
  it read as a hovering slab); 90 deck segments that OSM tags as piers on ground over 8 m above the lake (inland
  boardwalks) are left out (v1 floats a deck 1.2 m over the hillside there).
- **The shore's shadow (#41, 2026-11-14):** the decks, the boathouses, the light tower and the harbour cast into the
  terrain's sun shadow map (`towns.shadowCaster`, a depth-only pipeline drawn only when that map re-draws: every 4th frame
  live, once in a capture; the chunks in the light's 5 km box). The pilings (0.25 m) and the breakwater's rocks (≈ 1 m,
  which would shadow themselves in the map's 2.4 m texel, as the boulders) do not cast. Read where the map is already
  read: the bed through the clear water (a boathouse's shadow on the shelf at 13:00 takes the bed from 64,113,124 to
  62,83,98) and the shore's own faces. Limits: the map's 2.4 m texel and 3 m bias keep a 2 m deck's shadow soft, and a
  deck less than about 3 m (along the sun) over the bed casts none; the water's surface reads no shadow (as before). The
  boathouse walls were unchanged by it (their colour: #41b above, The shore's draw).
  Cost (in-page A/B, `hook.setTownsShadow`, the map forced to re-draw every frame, 5 rounds × 90 frames, the GPU shared):
  the shadow pass +0.01 ms at 2560 × 1600 (the Sail start and the pier pose, 5 draws) and +0.009 ms on the phone set;
  live it re-draws every 4th frame. Pipelines +1 at load, none after the first frame.
- **In the water's mirror (#41c, 2026-11-14; `render/towns.js` MIRROR, SHORE_MIRROR_WGSL, MIRROR_READ_WGSL):** the land's
  mirror (256 azimuths × 16 bins) puts a 1.4 m deck 100 m off under one bin, so the shore has a mirror of its own, made
  the same way (the scene from the camera's mirror point under the surface, by azimuth and elevation: exact for calm water
  at any distance) but finer and analytic: 1024 azimuths × 128 bins packed toward the horizon up to 60°, one compute
  dispatch in the aerial pass after the land's (`towns-mirror`: a workgroup a column, a thread a bin). The shore as
  boxes and gables: every deck, wall, door, roof and piling of the pack, the tower as its shaft and lantern, the harbour's
  merged mesh split into its 357 parts (`harbourParts`: triangles sharing a corner, each part's box along its own walls,
  its mean colour); 4,548 proxies, the 256 nearest (pilings within 300 m, the rest within 2.5 km of their edge) re-picked
  after 20 m of travel into one storage buffer (`pickMirror`: arrays made at load, one writeBuffer; nothing allocated a
  frame). A column keeps the ≤ 32 boxes whose footprint it sees (each with its share of the column's azimuth, unless the
  terrain stands over the line from the water to its top); each bin casts 4 rays over its elevation span against them,
  the nearest 3 hits composited front to back by those shares: an edge fades as the camera moves, never flips a texel.
  Each hit is lit as the draw (`SHORE_LIGHT_WGSL`, the terrain shadow map's level read) seen along the mirrored ray and
  hazed as the land's mirror. The map is a storage buffer (the water's fragment stage already binds WebGPU's 16 sampled
  textures): a count word, one head a column (its top bin + 1), two words a texel (rgba16f premultiplied). The water
  reads it after the land at the land's taps, bilinear by hand, over the land by its alpha (the same rough-sea share);
  a pixel whose two columns are empty reads three words; the count 0 (nothing near, or `hook.setTownsMirror(false)`)
  skips it, and those frames are unchanged to the pixel. **Clear and steady:** the shore's ray leaves the footprint's
  normal with its slope × 0.12 (`MIRROR.damp`, as v1's reflections damp the waves' bend) and its taps spread 0.35 of the
  land's (`MIRROR.spread`): a boathouse mirrors as one soft shape that sways with the swell. In the 6 s film past the
  boathouse (`renders/v2-pier-mirror/`) the reflection's pixels change 3.7 levels a frame against the open water's 4.9.
  **Different from v1:** v1's mirror is screen-space (only what the frame shows, faded at its edges); v2's shows the
  undersides and what stands off screen, as a mirror does. Where the reflected background is the bay's dark wall the
  boathouse's reflection is low in contrast (a grey wall against a dark forest), and v2's navy water reflects less sky at
  a grazing angle than v1's, so the reflection reads quieter than v1's against open sky.
  **Cost** (`tools/v2-ab-mirror.mjs`: the mirror off and on in place, ABBA, 90 frames a run, GPU timestamps, the median
  of the rounds; the GPU shared): the aerial pass +0.012 ms at the pier pose at 2560 × 1600 (+0.006 to +0.029 over runs;
  68 proxies), +0.006 to +0.026 at the Sail start (32); the water's read in the scene pass +0.014 ms at the pier pose, at
  the Sail start inside the pass's run-to-run noise (−0.06 to +0.15). Phone set (390 × 844 at 1.5×, L2, the lite water):
  aerial +0.015, scene +0.009. Pipelines +1 at load (78), none after the first frame; GPU memory 1.05 MB (the map) +
  16 kB (the proxies).
- The harbour's boats stay deleted, as in v1.
- The cut reads thinner than v1's at the bay's walls: v2's slopes carry the photo and denser cards; the corridor is v1's.

## The buildings (Phase B of the South Lake birthplace: render/buildings.js, towns/buildings.js, tools/v2-buildings-pack.mjs)

OpenStreetMap's footprints (`data/geo/tahoe-towns.json`, ODbL: each an oriented box with its eaves' height from
`building:levels` or `height`, else a default by type, a ridge height, a kind, and a facade on the Stateline high-rises,
whose towers' floors come from public sources) drawn as boxes with gables, plus the south shore's landmarks as boxes in the
same records. Desktop and tablet only: `src/core/features.js` `buildings` (off on a phone; `?buildings=0|1`).

- **One draw.** One unit mesh (a box with a ridge along its length: 18 triangles), one pipeline, one `drawIndexed` a frame.
  The records sit in 1 km chunks in two classes: the buildings draw within 4 km of the eye, the landmarks (the high-rises,
  anything 40 m or taller, the gondola's terminals, pylons and cables) within 16 km, so a 60 m tower never pops in at 4 km.
  The chunks in range and in the frustum are kept; their records' indices go to a list (rewritten only when the kept set
  changes) and the vertex stage reads each instance through it.
- **Grounded on the drawn terrain.** A compute pass (in the forest pass, one thread a kept box) samples the terrain's own
  height function (`TERRAIN_HEIGHT`: the finest held level, so the coarse levels today and the south level once it is in)
  at the box's four corners and gives its foot and eaves by v1's rule: the walls from below the low corner (at most 6 m under
  the mean ground, 0.5 m under) to `h` over the mean, up to 4 m more uphill. `groundBox` is the CPU's twin; the page test
  reads the GPU's numbers back and matches them to 0.000 m on the page's drawn ground. A pylon's foot is grounded and its
  head absolute; a cable span, a cabin and a boat are absolute.
- **The look.** Lit as the piers are (`SHORE_LIGHT_WGSL`: the sun through the transmittance, the terrain's shadow, the sky's
  diffuse and reflection, roughness 0.85; the aerial perspective; the clouds in front). No texture: v1's earth-tone walls and
  roofs (the basin's design standards), the high-rises' four facades, a window grid on the low, mid- and high-rise boxes
  (3 m × 3.2 m cells, dark glass by day, filtered to its mean under a few pixels). At night a share of the windows is lit
  (low 0.3, mid 0.4, high-rise 0.7 at three times the radiance: the brighter facades), and `v2/assets/night/lights-south.bin`
  (871 glows: the towers' facades and a lamp every 10 m along the marina's docks) joins the lake's lights in the same draw.
- **The landmarks.** The Stateline high-rises are OSM's footprints with the data's towers (18 and 19 floors: 59.5 m and 63 m;
  two more at 50 m; no names, no signs). The gondola follows OSM's aerialway from the shore at Stateline to the summit (3.7
  km): 16 pylons every ~220 m, raised until both cables clear the ground by 10 m (18–36 m over their feet), two 0.5 m cables
  6 m apart (one sheared box a span), a cabin every 110 m under each, a terminal at each end. The marina's boats lie bow-on in
  the slips along OSM's docks inside the marina's ring, where the water is 1.2 m deep and no other dock or boat is in the way
  (39 boats: hull, cabin, a mast on 40 %).
- **Load: two sets, per region.** `lake` (25.7 kB gzip, 2,036 records: Emerald Bay's own buildings within 4 km of its
  regions, every big building round the lake, footprint ≥ 600 m² or a mid- or high-rise, and the gondola) loads after the
  first frame on every desktop start; `south` (61.9 kB gzip, 5,852 records: the south shore's other buildings and the marina's
  boats) and its lights (10.5 kB) load only for a start or a birthplace move inside the south box (x 6,000–19,000, z −6,000–4,500).
  The whole lake's footprints in one set would be about 220 kB for every start; the other shores' 12,909 small houses are
  left out until their regions get birthplaces.
- **Budgets** (2026-11-24, M5 Pro Mac, headless Chrome, 2560 × 1600, in-page ABBA: `?buildings` off and on in place, 10 rounds
  × 150 frames, the median of the rounds' differences; the GPU shared with other helpers, load average 12.6–20.4): at the
  Ski Run pin (1,496 boxes kept, 36 chunks) the scene pass +0.02 to +0.03 ms and the grounding +0.007 to +0.009 ms; in
  Emerald Bay (17 boxes) within the noise. Pipelines +2 at load, none after the first frame.
