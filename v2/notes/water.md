# v2 notes: Water colour, surface, reflection, caustics, breakers, wake

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## The caustics on the bed (ultra M2, BACKLOG-v2 #56, 2026-11-14: render/caustics.js, bed.js, terrain.js; tools/v2-caustics.mjs)

The second of the four Ultra-Water milestones: the sun's caustics, ported from Ultra-Water's
`src/water/Caustics.js` (Humpalumps/Ultra-Water@ce9248f, MIT, notice in `src/waters/ultra/LICENSE`), in place of M5c's
two drifting Worley nets.

**Step 1, the texture room (0 px).** The terrain's fragment stage sampled 16 textures, WebGPU's limit (6 sky, 5 baked maps,
the photo, the detail set, the water's slopes, the shadow map, and the bay's heights for the bed's refracted depth). The
bay slot's r16uint codes now reach the fragment as a storage buffer: at the slot's swap the GPU copies its texture into it
(`copyTextureToBuffer`, rows padded to 256 bytes, two codes a word; the bay grids' rows are 22 and 11 × 256 bytes, so no
padding), and `bedHeightAt` reads it term for term as it read the texture (`BED_HEIGHT_WGSL`). The texture reaches the
vertex stage only; the fragment samples 15, and the 16th is the caustics' array. Proof: `runBedProbe` compares every texel
of the live buffer with the texture on the GPU and the bilinear heights at 256 probe points bit for bit
(`v2/tests/pages/bedPack.page.mjs`); `v2/tests/terrain-pack.test.mjs` packs both real bay grids as the copy lays them out
and reads every code back; the goldens at the packing commit: 25 of 26 at 0 px, `--twice` 26 at 0 px (v2-hud-calm fails
the same 36,970 px on main 187b08a5 itself: the cockpit change's reference, re-blessed on another branch).

**Step 2, the splat.** Each frame with the sun up, a grid over one tile of a slope cascade is refracted through the drawn
slopes (a cubic B-spline of the slope mip, Ultra's) onto planes at three depths; each landed triangle adds its undisturbed
area over its landed area (the fragment's |det| of the old position's derivatives, clamped at 16) to that depth's channel,
4× multisampled so the fold slivers add by coverage, then resolved, and a compute pass makes the mip chain. Mean 1 by
construction (the tile's energy is its area): it multiplies the sun's share of the bed's light and adds none. The flat
water's landing is taken off, so the bed looks it up at the sun's entry point (the bed point moved back up the refracted
sun) through the cascades' warp, as the surface reads them. **Two cascades, not Ultra's one:** Ultra's ocean has 2–14 m
waves steep enough to focus a crisp net in a few metres; the lake's 12 m tile at wind 2–3 focuses 10–40 m down, so alone
it drew broad, soft bands on the 1–6 m shelf (`renders/ultra-m2/q-dg.jpg`). The net a Tahoe shallow shows is the ripples',
so layer 0 is the 12 m cascade at Ultra's 1.5 / 4 / 10 m (the bands, the deep light) and layer 1 the 2.1 m cascade at
0.6 / 1.5 / 4 m (the fine net), multiplied on the bed (independent patterns: the product keeps the mean 1). One rgba16float
array, 512² a layer (2.3 cm and 4 mm texels), margins sized for slopes to 0.25 with the sun 20° up (Ultra's 6–8 cells were
for its own demo; `caustics.test.mjs` checks them).

**On the bed (bed.js):** `causticStrength` eases them in over the first 1.5 m (none at the waterline, Ultra's), keeps
them to 10 m, eases them out by 22 m; the ripples' layer fades over 4–9 m; the sun's height scales them (none below 1°,
`smoothstep(0.02, 0.4, sin elevation)`: about an eighth at 6°, full from 24°), and nothing is splatted or read with the sun
down. Each layer is read at the pixel's blur (its footprint plus the rough surface's) or the sun disc's at that depth
(0.0068 m a metre), whichever is wider, so far water reads the mean and nothing aliases. The contrast fades with the bed
image's own scatter (IMAGE_SCATTER), and it applies to the plain column's sun share as well as the detailed bed, blended by
the same wNear, so no contour marks where the detail ends. Rocks take them as the sand does (the Worley nets were halved
on rocks and on a rough surface; the splat already knows the roughness).

**Which look:** v1's caustics are the same Worley nets v2 drew (src/waters/clarity.js, cell 1.3 m, gain 0.3: a polygon
net, even, like a pool's); Ultra's are physical, thin filaments. On our bed the physical ones read better and more real:
they gather into bright lines and dark cells that move with the waves, broken by the 12 m bands, where v1's net is one
even mesh. So v2 matches Ultra's method at its physical contrast (gain 1), not v1's net.

**Phone path** (the water's lite row, L2 and L3): layer 0 alone (its 2.1 m cascade holds no ripples there) into a 256²
array, at the sim's half rate (after the split step's second half); the bed skips the ripples' tap (bed2.x 0).

**Budgets** (`tools/v2-caustics.mjs ab`: the splat and the bed's taps off and on in place, A B B A rounds of 90 frames,
median of the rounds' differences; the M5 Pro Mac, headless Chrome, the GPU shared with other helpers): cam I at
2560 × 1600: the caustics pass 0.118 ms, the scene +0.043 ms, the frame +0.137 ms (budget 0.2). Phone L2 (569 × 1231): the
pass 0.043 ms an update, 0.022 ms a frame at the half rate, the scene +0.063 ms (noise ± 0.07), about 0.09 ms a frame
(budget 0.15). The old Worley nets on main measured +0.006 ms (noise). Pipelines: 2 more, built at load; 0 after the first
frame; nothing allocated in the frame.

**Not in M2:** the caustics on the boat's hull and the rocks' sides (the bed only), the boat's shadow on the bed (the
texture slot it needs is now the caustics'; a later item can pack the photo and detail arrays to free another), the sea
field's per-point gain (the bed reads the boat's sea, as its slopes already did).

## The water's colour and the shore (render/water.js)

The owner on M1 (2026-11-12): "the water looks pretty good (ignore the color)". The motion and detail are M1's,
untouched (the FFT, the cascades, the mesh, the roughness, the glint, the foam). The colour now comes from depth:
- **The bed through the water column** is drawn by the terrain pass (it knows the bed): its sand lit by the sun and the
  sky that reach it, attenuated per channel along the refracted view up and the refracted sun down, plus the water's own
  backscatter: `L = 0.54 · E/π · (A·T + R∞·(1 − T))`, `T = exp(−K·path)`, Tahoe's K = (0.33, 0.089, 0.032) /m and
  backscatter b (`src/sim/water-spectrum.js` WATER_K, WATER_B: Secchi 19 m), R∞ = b / 2K = (0.0009, 0.0084, 0.0625): v1's
  clarity optics. Over 1–5 m of sand that is the turquoise / emerald of Emerald Bay's shelves (cam I), over depth the navy.
- **The surface** is blended premultiplied over that bed: it adds its Fresnel share of the sky (or the land: below), the
  glint and the foam, and lets 1 − F of the bed through; the air's transmittance and in-scatter apply to both.
- **Deep water:** past 40 m the water's own body (the bed's limit at depth, the same numbers, so no seam) takes over, opaque
  by 60 m; the terrain draws no node wholly below 60 m.
- **The soft shore:** the surface fades in over its first 0.35 m of water (its depth from the terrain heights), so the
  waterline is soft and moves with the waves; reversed float depth keeps it free of z-fighting at any range.
- **The land in the water:** a flat mirror shows the scene from the camera's mirror point under the surface; one march per
  azimuth from that point (a ray at elevation e crosses the surface at t = eye / tan e; the first ground above it after
  that is its hit) gives the reflected skyline exactly, at any distance. 256 azimuths × 16 bins, re-made every frame in
  the aerial pass (one workgroup an azimuth, one thread a step: 0.5 ms as a serial march, ≈ 0.08 ms parallel). The bay's
  dark walls in the water are most of why Emerald Bay reads navy, not sky-blue, from cam A. A rough sea scatters it (to
  60 % past a slope variance of 0.03).

**Why the noon water read pale sky-blue, and the lever (decided):** not the grade, the exposure, plus the body colour.
M1's body albedo (0.010, 0.040, 0.095) was cyan; Tahoe's measured optics give R∞ above, a dark ultramarine. And M1 set
exposure 6 = factor 1 on a sky-and-water frame: with sunlit ground in it, an 18 % grey card under the noon sun hit the
tonemap at 0.92 (sRGB 0.80), so everything was ≈ 4× over, the sky pale and the lake sky-blue. `sim/exposure.js` now
exposes for sunlit ground ("sunny 16": that grey card at 0.24, sRGB ≈ 0.53), which turns the sky deep blue and the deep
lake navy with no grade at all, and adapts partially toward dusk (×√(light ratio), 3× at the sun's +3°, at most 5×). The
check against the brand's sampled lake (#183461 noon, #101F3B evening): v2's noon water near the camera reads
(23, 50, 106) against (24, 52, 97) (golden `v2-noon`), its 20:00 water (14, 23, 43) against (16, 31, 59) (`v2-cam-b-dusk`). A
colour grade would shift the sky and the land with the water; it stays a later, taste-only step (v1's AgX look), never
the lever for the lake's hue. (Since the frame look the day follows v1's camera and exposure, the water past the shelf held at this exposure: § The whole frame's look.)

## The water's reflection and its filtering (M5c, 2026-11-13: render/water.js, render/water-aa.js)

The owner on M4's water (2026-11-13): "small white dots like pattern constantly flashing and ppl will get dizzy", against
v1's broad, soft patches of sky; the same day, binding: "I like the new deep water color, I think it is more real than
v1." The deep body colour, the bed and the exposure are untouched; only the surface's normals, roughness, mirror and glint
changed.

**The cause (measured, not assumed):** a pixel of mid-distance water covers many ripples, and M1–M4 shaded it with one
normal and one reflected ray. The ray's elevation moved by ±2√σ² (≈ ±11° at a slope variance of 0.01) from pixel to pixel
and frame to frame, and the two things it read are hard-edged: the land's ridge line in the mirror (`terrain.js` REFLECT,
0 or 1 per bin) and the clouds' key. A `land.a` debug still was a binary black-and-white speckle over the whole mid
distance. Ablations at the fixed follow pose, 13:00, 1280 × 720 (`tools/v2-flicker.mjs`, the metric below): the glint off
changed nothing (tstd 13.6 vs 13.5: the sun glint was not it at noon); a constant mirror colour took tstd to 4.8 and the
jump share from 9 % to 0.06 %; the sky LUT alone (no clouds, the land blurred) 4.2 and 0.007 %. So the flicker was the
mirror's lookup, not the body, the Fresnel or the foam. The mips' slope variance (M2) did exist but fed only the sky's lift
and the GGX α²: with one ray per pixel it could not help.

**The fix (LEAN / Toksvig style, v1's rules where v1 had them; the maths in `render/water-aa.js`, tested):**
- **The roughness is the footprint's.** The anisotropic slope sample picks its mip from the footprint's minor axis (the
  detail); at grazing ratios past 8 : 1 its second moments miss most of the spread along the view. The moments are read
  again at the level whose texel covers the footprint's major axis (`footprintLod`), plus a screen-space term from the
  slope's finite differences (Kaplanyan 2016, halved, capped at 0.02), plus M1's floor.
- **The mirror's ray leaves the footprint's mean normal** (that coarse level's first moments); the facets' spread goes into
  the roughness, not into the ray, so the mirror no longer re-rolls each frame. The glint keeps the pixel's own normal, so
  the glitter path still glitters.
- **The mirror is averaged over the facets' spread:** the clouds' key and the land's ridge line read at 5 taps up and down
  the reflected elevation (offsets ±1.6, ±0.8, 0 × 2√σ², weights 0.1 / 0.25 / 0.3 / 0.25 / 0.1; the sky LUT is smooth and
  reads once). Where a ray straddled the ridge, the pixel now shows the mean of land and sky: a soft patch.
- **The Fresnel is averaged over the unresolved facets** (v1's rough Fresnel: Schlick at `nv + 0.9 √σ²`). A rough pixel at
  grazing mirrors less than its mean normal says; near water, facing the eye, barely moves (< 0.003 at nv 0.9).
- **The glint is v1's:** a Beckmann lobe (its tails fall off exponentially; GGX's long tails, tried first, washed the whole
  sea round the path into a milky gradient) over a total mean-square slope never under half the clean sea's Cox–Munk
  value for the wind (0.5 × (0.003 + 0.00512 U), U ≥ 1.5 m/s: a glitter path stays broad from the sub-pixel ripples),
  Schlick on the half vector, capped at 40, then rolled off softly toward 4 × the sky's luminance round the sun
  (L' = L / (1 + L / 2 cap): identity when dim, never above 2 cap). No one facet blows a pixel to white.

**The flicker metric** (`tools/v2-flicker.mjs`: 30 consecutive frames 1/60 s apart at one pose on a private Vite, the water
band 26–98 % of the height less the hull's box; `tstd` the mean per-pixel temporal standard deviation of luminance in 8-bit
levels, `jump` the share of pixels whose frame-to-frame change exceeds 20 levels, averaged over the 29 pairs; v1 stepped by
`core.setTime` with a rAF between renders). The fixed pose is the follow camera's at 13:00 (`campos=1183.55,12.09,-1047.06&
camlook=1137.46,2.16,-1030.41&camfov=41.35`, `wind=2`), the same on v1 (`mode=sail&settle=20&birds=0&hud=0`) and v2:

| Pose | v1 tstd / jump | v2 before | v2 after |
|---|---|---|---|
| 13:00, 1280 × 720 | 7.9 / 2.25 % | 14.0 / 7.46 % | 8.4 / 2.49 % |
| 13:00, 390 × 844 | 9.0 / 3.34 % | 14.7 / 7.71 % | 10.3 / 3.15 % |
| 18:45, 1280 × 720 | 17.4 / 4.00 % | 20.3 / 6.30 % | 14.7 / 3.44 % |
| 18:45, 390 × 844 | 8.0 / 1.50 % | 21.9 / 9.84 % | 14.5 / 5.11 % |

What remains is the waves' own motion over 1/60 s and the glitter path's twinkle (v1 has both; v1's 18:45 portrait frame
shows less of the path). Pipelines: none added. The goldens were re-blessed (every frame has water in it), `--twice` 0 px
on every scene frame. Stills and the before/after film: 2026-11-13 11:10.

### Budgets (M5c, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, the follow camera at 13:00, `?maxpx=5e6`, 60 frames, frame-total medians, before and after interleaved)
| Frame | Before (M4 + forest) | After | Δ |
|---|---|---|---|
| 2560 × 1600 total GPU, 6 interleaved pairs | 8.87–9.59 ms (median 9.37) | 9.90–11.1 ms (median 10.17) | **+0.6 to +1.0 ms** (the +0.3 ms target missed; the integrator's soft ceiling of ≈ +0.6 met at the low end only) |
| the cost's source (one pair each) | 1 cloud tap: 9.28 · 3 taps: 9.24 · 5 taps: 9.90 (same run's before 8.87) | | the clouds' key (2048 × 512 × 3 layers rgba16float) read 2 × 5 times: cache misses up the elevation axis |
| flicker by cloud taps, 13:00 1280 × 720 | 1 tap 12.4 / 6.2 % · 3 taps 9.5 / 3.9 % · **5 taps 8.4 / 2.5 %** (v1 7.9 / 2.25 %) | | 5 taps kept: no flicker comes first (the integrator, 2026-11-13); 3 taps is the one-line fallback (`MIRROR_TAPS.cloud`) at ≈ +0.4 ms |
| 1280 × 720 total GPU | 3.3 ms | 3.6–4.4 ms | per-pass timestamps on this GPU move the untouched composite pass with the scene (+0.3–0.5): the frame total is the honest number |

**The speed pass (2026-11-13) took most of this cost back with no look change:** the cross-fade is blended once a frame into the key's fourth layer (one fetch a tap, not two) and the taps read by azimuth and elevation (no trig a tap): § Budgets (the speed pass). A cheaper road still, if more must go: a mip chain (or an elevation-blurred copy) of the clouds' key,
re-made when a layer's bake completes, read once at the level of the spread (two fetches for ten); one pipeline at load.

### The far water's shimmer (fix(v2), 2026-11-13: render/water.js mirrorBlur, water-aa.js cloudTapGrad, clouds.js KEY_MIP_WGSL)

The owner, 2026-11-13, on the follow camera over open water: "it seems we have two types of water. Above this boundary,
the upper part water, the reflection is bouncing." Calm broad patches near the boat, a shimmer past a line in the middle
distance.

**The cause (measured, not assumed).** `tools/v2-flicker.mjs --bands n` reports the metric per band of screen rows (the
far water at the top). At the follow camera at 13:00 (1280 × 720) the share of > 20-level jumps was 0.3–0.6 % at the
horizon, 2.3 % at 34–38 % of the height, 4.6–5.4 % over 42–58 %, then falling to 0.7 % at the bottom: the "two types".
Ablations at the same pose, one term at a time (temporary switches, removed): the glint off, the Fresnel or the whole
shading off the footprint's mean normal, the screen-space term off, the land off in the mirror: each left the far bands at
4–5 %. A constant mirror took them to 0.0 %; **the clouds off in the mirror alone took every band to 0.0–0.4 %.** The clouds'
key packs v = sqrt(e / 90°) toward the horizon, and M5c's five taps read it at level 0, spaced 0.8 × 2√σ² apart. Far
water mirrors the sky a few degrees up, where the key holds 15 rows a degree and the spread is wide: the taps sat tens of
rows apart, five point samples of cloud edges finer than their spacing, each flipping between cloud and gap as the waves
moved the ray. Near the boat the ray looks high (8 rows a degree) and the spread is small, so the taps sat within a row
or two: calm. The line is where the spacing outgrew a row. A 33-tap Gaussian over the same spread (a debug run) took the
far bands to 0.0–0.4 % with the band means unchanged: the taps' undersampling, not the mirror's content, was the shimmer.

**The fix.** The key's blended layer (the speed pass's fourth layer, the frame's cross-fade) gets a mip chain
(`render/clouds.js` KEY_MIP_WGSL: 2 × 2 means of the premultiplied light and the transmittance, down to one row: 10 levels
at 2048 × 512, 9 on a phone), re-made every frame in the cloud-key pass right after the blend (the blend changes each
frame). Each mirror tap reads it by gradient over its share of the spread (`water-aa.js` cloudTapGrad, `cloud-read.js`
cloudAtUEGrad, on the speed pass's direct azimuth and elevation reads): dv the key rows the tap's interval
[e − 0.4 dE, e + 0.4 dE] covers, du the same angle in azimuth; the view sampler is now `mipmapFilter: 'linear'` and
`maxAnisotropy: 4` (`render/sky.js`; every other read through it is an explicit level 0 of a one-level texture, so
nothing else changes), so the azimuth stays sharper than the elevation where the packing stretches the rows. Near the
eye the spread is under a texel: level 0, the same reading as before. The level rises smoothly with distance (tested: no
step of half a level along a view line), so there is no new seam. The deep navy, the bed, the glint, the land's taps and
M5c's ray and roughness are untouched; the band means move by at most 1 level.

**Per band, before → after** (on main at f19f40d3, the speed pass; "before" is main's level-0 taps, the same pixels as
main; the follow camera, `hour=…&wind=2`, 30 frames 1/60 s apart, the water band 26–98 % of the height less the hull's
box; tstd levels / jump share). Before the speed pass the same table read the same to 0.1 level:

| Band (top = far) | 13:00 1280×720 before | after | 13:00 2560×1600 before | after | 18:45 1280×720 before | after | 18:45 2560×1600 before | after |
|---|---|---|---|---|---|---|---|---|
| 26–30 % | 4.7 / 0.34 % | 2.8 / 0.34 % | 5.8 / 0.40 % | 3.3 / 0.36 % | 4.7 / 0.20 % | 3.0 / 0.15 % | 7.2 / 0.38 % | 4.8 / 0.16 % |
| 30–34 % | 7.7 / 0.60 % | 4.0 / 0.31 % | 9.0 / 1.04 % | 5.4 / 0.34 % | 10.4 / 1.11 % | 7.2 / 0.14 % | 12.6 / 1.65 % | 9.6 / 0.18 % |
| 34–38 % | 11.2 / 2.29 % | 6.4 / 0.36 % | 10.7 / 2.22 % | 7.7 / 0.38 % | 14.3 / 2.96 % | 10.9 / 0.23 % | 15.7 / 3.18 % | 13.2 / 0.35 % |
| 38–42 % | 11.4 / 3.46 % | 7.1 / 0.25 % | 10.9 / 2.60 % | 8.5 / 0.24 % | 16.3 / 4.46 % | 13.5 / 0.53 % | 18.0 / 4.63 % | 16.0 / 0.80 % |
| 42–46 % | 11.6 / 4.63 % | 8.0 / 0.00 % | 11.1 / 2.54 % | 9.3 / 0.00 % | 18.3 / 5.59 % | 16.0 / 0.98 % | 20.1 / 5.81 % | 18.6 / 1.54 % |
| 46–50 % | 12.1 / 5.27 % | 9.0 / 0.35 % | 11.7 / 2.84 % | 10.3 / 0.30 % | 19.7 / 7.03 % | 17.8 / 2.18 % | 21.5 / 6.73 % | 20.3 / 2.64 % |
| 50–54 % | 12.0 / 5.38 % | 9.3 / 0.36 % | 11.8 / 2.70 % | 10.5 / 0.33 % | 21.4 / 8.14 % | 19.5 / 2.71 % | 22.5 / 6.83 % | 21.4 / 2.98 % |
| 54–58 % | 11.6 / 4.90 % | 9.2 / 0.02 % | 11.3 / 2.24 % | 10.2 / 0.08 % | 22.0 / 8.34 % | 20.4 / 2.86 % | 23.4 / 6.31 % | 22.4 / 3.19 % |
| 58–62 % | 11.0 / 4.47 % | 8.8 / 0.04 % | 10.4 / 1.71 % | 9.5 / 0.07 % | 21.9 / 7.34 % | 20.5 / 2.93 % | 22.9 / 5.24 % | 22.2 / 3.18 % |
| 62–66 % | 10.8 / 4.20 % | 8.9 / 0.07 % | 10.2 / 1.43 % | 9.4 / 0.07 % | 20.7 / 6.87 % | 19.5 / 2.76 % | 21.7 / 4.75 % | 21.1 / 3.14 % |
| 66–70 % | 9.8 / 3.18 % | 8.1 / 0.05 % | 9.2 / 1.02 % | 8.4 / 0.05 % | 21.4 / 6.85 % | 20.4 / 3.72 % | 21.8 / 5.17 % | 21.4 / 3.99 % |
| 70–74 % | 9.2 / 2.64 % | 7.7 / 0.03 % | 8.9 / 0.73 % | 8.2 / 0.02 % | 24.4 / 7.04 % | 23.5 / 4.38 % | 24.6 / 5.60 % | 24.1 / 4.61 % |
| 74–78 % | 8.6 / 2.17 % | 7.3 / 0.14 % | 8.3 / 0.57 % | 7.7 / 0.10 % | 23.5 / 6.42 % | 22.7 / 4.21 % | 23.6 / 5.13 % | 23.1 / 4.39 % |
| 78–82 % | 7.6 / 1.63 % | 6.4 / 0.02 % | 7.3 / 0.35 % | 6.7 / 0.01 % | 23.3 / 6.37 % | 22.7 / 5.09 % | 23.3 / 5.52 % | 23.1 / 5.00 % |
| 82–86 % | 7.0 / 1.26 % | 6.0 / 0.03 % | 6.9 / 0.26 % | 6.4 / 0.04 % | 24.0 / 6.54 % | 23.5 / 5.49 % | 24.3 / 6.10 % | 24.0 / 5.68 % |
| 86–90 % | 7.0 / 1.21 % | 6.0 / 0.08 % | 6.8 / 0.26 % | 6.3 / 0.04 % | 24.9 / 6.80 % | 24.5 / 6.01 % | 24.7 / 6.14 % | 24.5 / 5.90 % |
| 90–94 % | 6.7 / 0.83 % | 5.8 / 0.08 % | 6.8 / 0.21 % | 6.3 / 0.08 % | 24.9 / 6.74 % | 24.6 / 6.01 % | 25.8 / 6.42 % | 25.5 / 6.08 % |
| 94–98 % | 6.3 / 0.67 % | 5.7 / 0.17 % | 6.1 / 0.26 % | 5.7 / 0.18 % | 24.2 / 6.49 % | 23.9 / 6.23 % | 24.6 / 6.26 % | 24.4 / 6.16 % |
| **all** | **9.2 / 2.68 %** | **6.9 / 0.16 %** | **9.1 / 1.30 %** | **7.7 / 0.16 %** | **19.7 / 5.69 %** | **18.1 / 3.03 %** | **20.7 / 4.98 %** | **19.6 / 3.21 %** |
| mean luma | 55.22 | 55.17 | 56.66 | 56.8 | 95.44 | 96.57 | 90.91 | 91.89 |

The fixed open-water pose (`campos=3204.22,12.31,-4611.49&camlook=3220.95,1.99,-4657.47&camfov=40.78&boat=0&kayaks=0`,
19 bands over 22–98 %, measured before the speed pass): all bands 13:00 1280 × 720 17.0 / 5.62 % → 15.5 / 0.80 %; 13:00 2560 × 1600 19.8 / 4.00 % → 18.8 /
0.93 %; 18:45 1280 × 720 19.2 / 3.41 % → 18.5 / 1.45 %; 18:45 2560 × 1600 22.8 / 3.09 % → 22.2 / 1.80 %; no band rose. What
remains is the waves' own motion (large, slow patches near the eye) and the dusk glitter path (the 18:45 near bands, 5–6 %,
as before; v1 has it too).

**Budget** (in-page A/B on the speed pass: one headless page at 2560 × 1600, `?maxpx=5e6`, main's level-0 taps without
the chain and the filtered taps with it switched in place by a temporary uniform, 90 frames each, 6 alternated rounds,
medians): 13:00 frame total +0.03 ms (scene −0.03, the cloud-key pass +0.02: the chain); 18:45 −0.12 ms (scene −0.17,
cloud-key +0.01). Frames of about 5 ms; within the +0.2 ms budget. Before the speed pass the filtered taps saved 0.5–0.9 ms
of scene time, because the old 5 taps × 2 layers missed the cache up the key's elevation axis; the speed pass's single
blended layer took most of that saving itself. Pipelines: +1 compute at load
(`cloud-key-mip`), 0 after the first frame (`stats().pipelines.afterFirstFrame` 0).

## The water's surface (#56 M1, 2026-11-14: render/water-surface.js, render/water.js, sim/spectrum.js FADES, sim/seaField.js)

The owner, 2026-11-14: "our water wave for v2 is not at Ultra-Water level"; "even in the deep water area, v1's wave pattern
looks more real. No need to change the water colour." Widened the same day to port the rest of Ultra-Water (MIT) in four
milestones; M1 is the surface. The plan and its measurements:. The body colour, the
navy past the shelf and the absorption are untouched; the reflections stay broad and steady; v1's short-wave fades are the
owner's accepted shimmer. `?m1=0` is the water before (M5c's fades, recovery and shading), the A/B. Live, `water.m1 = false`
turns the shading off and `water.m1bits = n` keeps only the parts in n (`render/water-surface.js` SURF_BITS).

**What changed:**
1. **v1's short-wave fades** (`sim/spectrum.js` FADES.v1: 0.012 m on the 600 / 85 / 12 m tiles, 0.015 m on the 2.1 m tile, for
   M5c's 0.025 / 0.05). The h0 table only: nothing a frame; the Hs gain keeps the sea's height (tested).
2. **v1's slope gain** (`src/water.js` BAY_SLOPE = 2). v2's one FFT sums the lake's and the bay's sims, so the gain is the same
   energy: √(1 + (k² − 1) × the bay's share of the tile here) (`sim/seaField.js` seaGainsShare, per vertex): on the 85 m tile
   k = 2 (v1's), on the 12 m tile k = 1.5 (v1's 2 there added a quarter to the follow camera's jumps: 60 frames, the fades
   alone 3.45 %, 2 / 2 4.33 %, 2 / 1.5 3.73 %; `water.m1reach = [1e9, 1e9, 2, 2]` draws v1's). 1 on the open lake. Shading only: the pixel's normal (the Fresnel and the glint) and the roughness;
   heights, the CPU surface and the boat are untouched. **Not on the mirror's mean ray** (bit `boostMirror`, off by default):
   with it the reflection's lookups swung with the doubled slope and the jumps at the 12 m start pose rose 0.53 % → 1.86 %;
   without it 0.54 %. The broad, steady mirror keeps its ray; the faces still turn light and dark through the Fresnel.
3. **Dark troughs, bright faces:** v1's modulation transfer (the long waves pile the 12 m and 2.1 m tiles' ripples on their
   crests: × clamp(1 + 2.2 η / Hs, 0.35, 2.2), η from the displacement reads the foam already made, Hs each tile's at the boat
   × its gain here); v1's Smith masking on the mirror (Beckmann Λ, floored at 0.45); the mirror's ray off the pixel's own
   normal where the footprint resolves the ripples (under 2–12 cm; a facet whose own ray dips under the horizon keeps the mean
   ray, or it mirrored the far beach's sand as a tan fleck).
4. **Gust patches and v1's two fine gust ripples: not here.** The spume and wind helper is porting the gust patches (W1); it
   had not merged to main when M1 was built, so they stay with it (v1's two fine ripples are part of its gust look).
5. **Ultra's whitecap foam** (its `bakeTextures.js` FOAM and `OceanSurface.js` foam block, GLSL to WGSL): the lace / billow
   texture baked by a compute pass on the first frame into one more layer of the slope array (256²: the water's fragment stage
   is at WebGPU's 16 sampled textures; a 17th texture failed the pipeline), Ultra's erosion (cover = smoothstep(1.05 − d,
   1.3 − d, pattern) √d: young foam solid, ageing foam thinning to lace), the billows' bump and crease shade, thin foam tinted
   by the water under it, the sun through thin foam, the bubble sheen. The whitecaps keep their own light (under the frame
   look's water keep the old flat foam read tan). **Coverage is v1's rule:** v2's fixed onset (J < 0.45) was never reached on
   the lake (the 12 m tile's turbulence stays over 0.6 at wind 4: no whitecaps at any wind). M1 takes v1's: the fold threshold
   J0 is the turbulence's quantile at 0.4 × Monahan & O'Muircheartaigh's W = 3.84e-6 U^3.41 (the CPU's readback of the 12 m
   tile, every 30th read, eased by half), none under 4 m/s of wind, all from 8 (v1's onset). The density is
   (J0 − turbulence) / 0.05, and under M1 the turbulence recovers at 0.1 / s (Ultra's 0.7 suits an ocean whose folds run 0.8
   deep; the lake's run 0.1), so a cap erodes from solid to lace in about half a second. At wind 4 (the follow camera, 13:00)
   0.6 % of the open water's pixels read white (v1 0.1 %: thin streaks; 1.0 × W drew 3.2 %).
6. **Ultra's crest subsurface** (its k1): 1.6 × the crest's height × (sun · −view)^4 × ((1 − n · sun) / 2)^3, the height as
   η / Hs × 3 m (a lake's crest is a tenth of Ultra's ocean's), × (1 + 2.2 where the crest folds: v1's thin-crest gain), in the
   body's own colour per unit light, against the sun only.
7. **Ultra's glint:** its height-correlated Smith visibility and Schlick over the same slope variance (the mips' moments, the
   screen-space spread, the Cox–Munk floor), α floored at 0.015, rolled off toward 4 × the sky as before; the distribution
   stays v1's Beckmann: Ultra's GGX tails greyed the whole noon sea round the path (the follow camera's near deep water left the
   navy, hue −79° → −84°, `frameLook.page.mjs` failed). Its facet glitter
   (Poisson counts per cell, mean 1) with **the twinkle smoothed**: 0.4 draws a second (Ultra 3), crossfaded, the count's ratio
   capped at 3 (Ultra 300), cells of 4 footprints and up (Ultra 2), weight 0.35 (Ultra 0.6), from 4 m to 30 m out.

**The phone path** (L2, L3: the lite water) takes all of it but the glitter (its cells are under a pixel at 0.6 Mpx) and the
foam pattern's coarse tap (one tap for two).

**Spectra** ('s method, `node tools/v2-water-m1.mjs spectra`; 1280 × 720, the same crops; v1 / before / after):

| Pose, band | finest octave share | rows share, two finest octaves | patchiness |
|---|---|---|---|
| deep water, 1.6 m eye (cam B), near | 24.3 / 3.0 / 5.4 % (fades alone 9.9 %, all but the slope gain 11.9 %) | 0.67–0.85 / 0.98–0.97 / 0.96–0.97 | 0.28 / 0.82 / 0.65 |
| the same, far | 14.3 / 18.2 / 21.1 % | 0.68–0.67 / 1.00–0.99 / 0.98–0.98 | 0.36 / 0.34 / 0.28 |
| deep bay, 4 m eye, near | 14.2 / 12.1 / 14.7 % | 0.91–0.90 / 0.99–0.99 / 0.93–0.95 | 0.63 / 0.55 / 0.38 |
| deep bay, 12 m eye, near | 16.2 / 16.5 / 18.9 % | 0.91–0.93 / 0.97–0.99 / 0.92–0.95 | 0.61 / 0.72 / 0.57 |
| deep bay, 12 m eye, mid | 23.0 / 32.5 / 27.3 % | 0.85–0.95 / 0.95–0.98 / 0.94–0.96 | 0.37 / 0.50 / 0.55 |

Read: the fades bring back the fine ripples (the 1.6 m eye's finest share 3.0 → 9.9 % with the fades alone); the slope gain
then adds the long waves' light and dark, whose energy sits in the coarse octaves, so the fine share there falls back to 5.4 %
while the fine energy itself stays. The rows share (streaks) falls everywhere (0.97–1.00 → 0.92–0.98), not to v1's 0.67–0.85.

**Flicker** (`tools/v2-flicker.mjs`, 3 s: 180 frames at 60 Hz, 1280 × 720; tstd levels / the share of > 20-level jumps):

| Pose | v1 | before (?m1=0) | after |
|---|---|---|---|
| start-fixed (12 m eye, deep bay) | 17.6 / 4.54 % | 19.4 / 0.53 % | 19.5 / 0.73 % |
| start-low-b (4 m eye, deep bay) | 24.1 / 5.93 % | 23.8 / 1.47 % | 21.6 / 2.39 % |
| the follow camera, 13:00 | 10.5 / 1.62 % | 18.9 / 3.49 % | 19.6 / 5.90 % |
| the follow camera, 18:45 | 8.2 / 0.52 % | 38.9 / 9.14 % | 45.4 / 13.29 % |

Most of the rise is the fades the owner accepted (60-frame runs, before → the fades alone → all of M1: start-low-b 1.45 →
1.99 → 2.31 %, the follow camera at 13:00 ≈ 3.5 → 3.45 → 4.63 %, at 18:45 8.28 → 11.23 → 12.05 %): the shading parts add 7–34 %
over the fades alone. Against before, M1 as a whole: +37 %, +62 %, +69 %, +45 % (measured the fades' own rise at
+50 % and +60 % on the frame before the frame look); at the deep-bay poses it stays far under v1's. At the follow camera v2 was already over v1 before M1
(the frame look's exposure; v1's dusk follow camera is calm at 0.52 %): M1 does not cause that and does not fix it. Ablations (60 frames, jumps; measured with Ultra's GGX lobe before the Beckmann switch where marked *): at start-fixed every
part but the mirror gain 0.54 %*, the fades alone 0.53 %, v1's gain on the mirror's ray too 1.86 %*, the masking off 2.83 %*;
at the follow camera the masking off 7.2 %* (it halves the grazing glints' jumps), the glitter or the foam off no change; at
start-low-b the glint, glitter, slope gain or MTF off each within 0.3 points. Ultra's GGX tails had flattered the metric
(start-low-b 1.61 %, the follow camera 4.84 %) by greying the whole sea; they broke the navy and are out.

**The water's colour.** Where the eye sees the water's body (the deep bay from 12 m, the follow camera at noon) the median
open-water sRGB moves by at most 3 levels a channel (0, 55, 111 vs 0, 58, 111; 0, 55, 113 vs 0, 57, 112; the frame look's navy box 1, 44, 88 vs 1, 44, 89: tested,
`v2/tests/pages/waterSurface.page.mjs`). At a sailor's eye height the water is mostly mirror and M1 changes the mirror on
purpose: at a 1.6 m eye the water reads 7–17 levels darker (median 33, 64, 94 vs 50, 75, 101; at 4 m 32, 73, 111 vs 40, 79, 115; v1
8, 26, 52 and 15, 68, 114), toward v1's darker grazing water: v1's masking and the darker troughs. The bit `mask` is the
switch if the owner wants the old tone there.

**Budget** (`tools/v2-ab-m1.mjs`: one headless page, M1's shading off and on in place, 6 A B B A rounds of 90 frames, medians of
the rounds' differences; the GPU shared with other helpers' goldens and page suites): the Sail start's follow camera at
2560 × 1600 scene +0.024 ms (10 rounds; +0.038 in an earlier 6-round run); wind 4 there (foam on screen) scene +0.11 to
+0.14 ms in two runs (−0.04 in a third: the composite pass, which M1 does not touch, moved as much, so the GPU's sharing is in
these numbers); the phone path L2 (569 × 1231) scene +0.008 ms and −0.011 ms in two runs. Budget 0.25 ms
Mac, 0.2 ms phone. The fades cost nothing a frame. Pipelines: +1 compute at load (`water-foam-bake`), 0 after the first frame;
no allocation a frame (the uniform is 48 B, the threshold's 4096 samples a preallocated array sorted in place).

**Pictures** (git-ignored, `renders/ultra-m1/`): `stacks/*.jpg` (v1 / Ultra's demo / before / after, 960 wide: deep-1m6,
deep-12m, deep-4m, shore (the owner's helm pose), golden-crests, golden-helm, whitecaps-w4, whitecaps-w4-fixed, noon-follow),
`clip-deep-v1-vs-m1.mp4` (10 s, the deep water at a 1.6 m eye, v1 | after). Tools: `tools/v2-water-m1.mjs` (shots, stacks,
spectra), `tools/v2-ab-m1.mjs`, `tools/v2-flicker.mjs --m1bits / --m1reach`.

## The crest glow and the wave body (2026-11-24: render/water-surface.js SURF.crest, SURF.jelly; render/water.js)

Ported from web-ocean-3d (https://github.com/2600th/web-ocean-3d @ 9a165f2, MIT, `LICENSES/web-ocean-3d-MIT.txt`): its
`src/ocean/OceanMaterial.ts` constants (lines 1020-1097), its scattering (2709-2851) and its body and crest blend (3405-3478),
TSL to WGSL. Their crest glow is their own rewrite (Noniv/web-ocean's crest term is a pow-4 lobe, the same as Ultra's k1).
`?crest=0` puts Ultra's k1 back; `?jelly=0` the body before. Bits `crest` and `jelly` in SURF_BITS.

**What the "jelly" is in their water.** Not their spectrum (JONSWAP, as ours) and not their refraction. It is four body terms:
the body's light follows the swell's facing to the sun (`SWELL_RELIEF` 4, centred on the sun's height, on the swell cascade
only, so the body has the big waves' shape and none of the ripples'); troughs darker and faces lighter by height over Hs
(`BODY_TROUGH_CONTRAST` 0.3); the thin upper water carries skylight sideways whatever the sun does (`crestGlow` 0.55 × height²);
and a crest blend after Sea of Thieves (SIGGRAPH 2018) that takes a crest seen toward the light to the scatter hue at the sky's
brightness, over the mirror as well as the body (`CREST_BLEND` 0.6). Together they read as a lit, translucent volume.

**The crest glow.** A Henyey-Greenstein lobe (g 0.72, normalised to peak 1) × a wrapped away-from-sun term (0.45) × Beer-Lambert
through the water the light crossed (0.22 m at the crest to 4.2 m down the face, by the wave's height over the sea's Hs here) ×
the crest's share of the wave × v1's thin-crest gain, in the sun's light (`sunPerp`: none at night, shaded by a storm cell).
Tahoe's own K, and a blue-cyan scatter hue (0.16, 0.64, 0.95), not their teal; the deep navy stays the trough's colour.

**Steady by construction.** Every input is smooth: the long tiles' height (eta), the footprint's mean normal (the mirror's own
steady `slC`), the view and the sun. Wind-driven: none under 1.5 m/s of local wind, full from 7. The lobe puts the glow on low sun
behind the crests at dawn and dusk; at noon the sun sits 70° off the view and the face turns toward it, so the glow is gone and
only the body terms remain (soft).

**Checks** (the M5 Pro Mac, headless Chrome; `?crest=0&jelly=0` as before):
- Flicker (60 frames, 1280 × 720): dusk into the sun (19:36, cam B, 8 m/s) tstd 13.25 → 13.72 levels, jumps 4.16 → 4.09 %; the
  noon follow camera 11.54 → 11.45, 0.47 → 0.46 %.
- Cost (interleaved ABBA, 120 frames a round, GPU timer medians, main 29bdca6 vs the branch): 2560 × 1600 at 19:36 wind 8,
  6 rounds, 18.67 → 18.90 ms (+0.22); at 13:00 wind level 2, 4 rounds, +0.23; phone L2 (844 × 390 at DPR 3, the lite water),
  6 rounds, 2.82 → 2.86 ms (+0.03). Pipelines 0 added. A first build that carried its own long-wave slope through the
  shader and read the sky LUT again cost +0.7 to +0.9 ms at 2560: register pressure, not the terms' work.
- The phone takes the same terms (all ALU, no texture read).

## The wind lanes held in the water (2026-11-24: render/spume.js laneAt, spLane, laneDrift; render/water.js foam streaks)

**The fault:** fine streaks slid across the water much faster than the waves, "like another plane under the boat", now and then.
They were v1's wind lanes (2.2 m across, 30 m along: they roughen the short ripples and the mirror), and, on aged foam, the
foam map's streaks. Both laid their pattern along the wind by turning world coordinates to it about a fixed point (the lanes
the bay centre, the streaks the world's origin), so when the wind turned by dθ a lane at the boat moved sideways by its
distance from that point × dθ; and the lanes' drift was t × U, so a gust (dU) slid them by t × dU, t being seconds since
load. Measured on the JS twin with the page's own wind at the boat (`windField.sample`, a 0.6°/s shift at wind 9, the
Sail start 565 m from the anchor, 0.1 s pairs): the lanes moved 5.5–6 m/s across the wind and 20–50 m/s along it; 5 km
out, 45–60 and over 100 m/s. Their own drift is 0.03 × U = 0.38 m/s; the sea's peak waves run 4–6 m/s.
**The fix:** each lane set lies along a fixed direction, 10° apart (`SPUME.binDeg`), and the local wind cross-fades the
nearest two (the blend keeps the variance), so a turn fades one set into the next in place; the drift is the frame's own
integral of 0.03 × the wind (`laneDrift`, `F.spume.zw`), shared by the foam streaks (the foam map drifts at the same 3 %).
After: 0 m/s across, ≤ 0.5 m/s along (the measure's step), at the start and 5 km out. The lanes still lie within 4° of the
wind and stay 30 : 1 stretched (`v2/tests/spume.test.mjs`); the new test fails on the old lanes.

## The sea state: a bigger, longer sea (2026-11-24: v2/sim/spectrum.js SEA_STATES, seaRows; ?sea=)

**The ask:** waves as big as web-ocean-3d's, at least on the open lake, bigger in the bay too, and a boat that clearly rides up
and down. v1's sea is a lake's physical fetch-limited sea (the fetch law × 1.3, its JONSWAP peak from the fetch), short and
low for a 7.3 m waterline: at 7 m/s Hs 0.73 m, Tp 3.3 s on the open lake, 0.41 m and 2.1 s in Emerald Bay. The competitor's
default sea (web-ocean-3d `DEFAULT_UI_STATE` 11 m/s, `peakWavelength` 40 m, gamma 3; its JONSWAP with `youngSeaGain`,
integrated) is Hs 1.49 m, Tp 5.1 s; its 9 m/s, 34 m preset 1.22 m, 4.7 s. The owner's goal wins over the lake's physics here.

**What changed (the row `big`, the default; `?sea=v1` is the sea before, byte for byte):** v1's place weights stay (the fetch
map, the bay's share, SEA_FEEL, the shallows' calm), so the sea still differs by place; only the two sims' tables change.
- The lake's wind sea takes the spectrum shape of a 60 km fetch (Tp × 1.33) and 1.4 × its Hs; a long-crested swell rides on
  the lake's table along the wind, Hs = clamp(0.18 + 0.055 U, 0.25, 0.9) m, peak 40 m (5.1 s), gamma 3.3. It lives in the
  600 m tile, so the open lake gets all of it, a bay's lee little (v1's m³ on that tile) and the shallows none (v1's damping
  under 14 m).
- The bay's wind sea takes a 20 km shape (Tp × 1.5) and 1.6 × its Hs, with its own shorter swell (clamp(0.1 + 0.03 U, 0.15,
  0.45) m, peak 30 m, inside the bay sim's 85 m band): waves the hull rides over rather than bridges.
- The two rows of each table are one build (power spectra add: buildH0 sums the rows on the same draws, no extra cost); the
  swell's scale makes the rows' variances stand as their Hs², and each table's gain takes the pair to its combined target.
- The shore's trains take the bay sea's period (shoreParams `shapeKm`: the 20 km shape) and the spray its Hs, so the shore
  break grows with the sea; their amplitude already reads the drawn sea's Hs.

Hs and Tp of the composed table at the boat (4σ over the displacement tiles; Tp the energy peak of its 1-D spectrum), v1 → big:

| Wind | Emerald Bay (fetch 1.5 km) | Bay mouth (4 km) | Open lake (20 km) |
|---|---|---|---|
| 3 m/s | 0.17 m, 1.6 s → **0.35 m, 2.4 s** | 0.19 m, 1.6 s → **0.38 m, 2.4 s** | 0.33 m, 2.6 s → **0.64 m, 4.9 s** |
| 5 m/s | 0.29 m, 1.8 s → **0.54 m, 2.7 s** | 0.45 m, 1.8 s → **0.85 m, 2.7 s** | 0.54 m, 3.0 s → **0.83 m, 4.0 s** |
| 7 m/s | 0.41 m, 2.1 s → **0.74 m, 3.1 s** | 0.63 m, 2.1 s → **1.15 m, 3.2 s** | 0.73 m, 3.3 s → **1.12 m, 4.5 s** |
| 9 m/s | 0.52 m, 2.4 s → **0.93 m, 3.4 s** | 0.82 m, 2.4 s → **1.46 m, 3.4 s** | 0.93 m, 3.6 s → **1.41 m, 4.9 s** |
| 11 m/s | 0.64 m, 2.4 s → **1.13 m, 3.6 s** | 1.00 m, 2.4 s → **1.76 m, 3.6 s** | 1.12 m, 4.0 s → **1.70 m, 5.2 s** |

## The shore: breakers, swash, wet sand, spray (#56 M3, 2026-11-14: sim/shoreField.js, render/shore.js, render/water.js; tools/v2-shore-bake.mjs)

Ultra-Water's shore (MIT, Humpalumps; `src/water/shoreMap.js`, `OceanSurface.js` SHORE_GLSL / shoreWaves / SWASH_GLSL, `Spray.js`),
ported to v2 on a lake's numbers. `?shore=0` is the water before (the A/B); `__velia.shore.on` switches it in place.

**The bake (offline, deterministic).** `node tools/v2-shore-bake.mjs` samples v1's heights (= v2's `terrainHeight`) at 2 m over the
bay's 2 m box (x −2304…3328, z −1792…1792 m: 2816 × 1792 texels), then Ultra's steps on that grid: the exact distance transform
(Felzenszwalb), islets under 256 m² flooded, the travel time τ from the waterline by fast sweeping (first-order Godunov, seeded at
the bilinear waterline, signed on land), two box blurs, the front's direction −∇τ, its coherence and curvature, and the ray tube's
amplitude exp(G/2) marched offshore. Two differences from Ultra's ocean: **two travel times**, for fronts of speed √(g min(d, D))
with D = 0.35 m and 2.5 m (a lake's wind waves, Tp 1.2–3 s, feel the bed only in the last metres; the shader mixes the two by the
wave's own period so the offshore wavelength is the deep-water one); and the bed's slope β (over ≈ 6 m) for the breaker's type
and the run-up. Kept only in 32 m tiles that hold ground between −3.6 and +1.25 m: 1,362 tiles of 19,712 (1.39 km²). The file
`v2/assets/shore/shore.vsf.gz` (every plane 2-D predicted in its tile, gzip 9): **650 kB**; streamed after the first frame (a capture
primes it), one storage buffer on the GPU (2.94 MB: the water's fragment stage is at 16 sampled textures). Re-run the bake after any
change to the bed; `--check` compares a re-bake with the committed file byte for byte.

**The breakers (the water's vertex and fragment stages).** Two trains (Ultra's: the second at 0.45 of the amplitude, 1.28 × the
frequency) at phase ω(τ + t) plus a noise along the coast, the local wavenumber ω / √(g min(d, g/ω²)); Tp from the wind's fetch
(JONSWAP), the amplitude the significant wave of the drawn sea here (the FFT tiles' Hs at the boat × the sea field's gain, before
the depth's calm, × 0.5) × the coast's exposure to the wind (a lee shore keeps 0.12: a lake's lee shore laps) × slow sets (0.55–1) ×
the ray tube × Green's law from 0.06 L0. Capped at **a ≤ 0.42 d**; breaking where the free wave reaches 0.85–1.25 of that limit
(the sections early or late each cycle: peeling), the breaker's type by the surf similarity ξ = β / √(H / L0) (Battjes 1974):
spilling on a flat beach, Ultra's plunging lean for 0.5 < ξ < 3.3, surging on rock (no whitewater). Ultra's Gerstner push with its
pinch budget (no fold), the lip's glow against the sun. The FFT's chop still dies under 2 m (v1's calm); the trains fade in shoreward
of 3.5 m. Vertices take the displacement where a cell resolves the wave; past that the fragment's slopes carry it and an
unresolved slope becomes roughness (steady, no flicker). **A calm day laps:** the whitewater fades in over 3.2–5.2 m/s of wind and
needs a 5–10 cm amplitude, so wind 1 gives none anywhere (tested); wind 4 on an exposed beach gives a shore break.

**The foam** is M1's: the breakers' whitewater riding shoreward with the bore (Ultra's two-phase flow map), the lace left in the
surf zone drifting in, the swash's bore line and the waterline's edge, all on M1's baked foam pattern and its shading, so the shore's
foam and the whitecaps match. **The swash and the wet sand:** the water's mesh is lifted onto the sand where the run-up reaches
(Stockdon et al. 2006 eq. 19 × 0.75: a typical swash, 2–60 cm), the film runs up in 30 % of the period and drains in 70 % (Ultra's
profile, its bore line on the way up); behind it the sand darkens (× 0.58, a film of water; glossy just after the backwash) and dries
over 5 s. The terrain pass is untouched: the darkening is the water's premultiplied alpha over the drawn sand. **The spray:**
Ultra's stateless breaker spray from emitters baked in the surf zone of gentle, clean beaches (25,039; the loader jitters one a
marked texel), only from 8.5 m/s of wind (full at 12) on breaking crests over 9 cm, within 160 m, the nearest 32 tiles (≤ 12,288
billboards; ≈ 200–330 at the head beach at wind 4); one pipeline, built at load, not drawn otherwise.

**Cost.** The CPU picks the kept tiles in range (1.4 km) and in the frustum each frame (≈ 0.05 ms, no allocation) and writes the
params (640 B); with none, the on word is 0 and both stages skip the whole shore in one uniform branch: **0 ms off-shore**. A pixel
off the band (deeper than 3.5 m, or land over 1.2 m) skips it on its depth. The phone's lite water draws one train, no lean, lace or
spray. The numbers: § Budgets below. New pipelines: 1 (the spray), at load; nothing built after the first frame.

**Not done (M4 or later):** the boat does not feel the trains (the keel draws 1.6 m; the breakers stand in 0.1–0.6 m of water); the
terrain's own wet-sand albedo (the water's alpha darkens it instead); the open lake's shores outside the bay's box.

### Budgets (#56 M3, measured 2026-11-14 on the M5 Pro Mac, headless Chrome, `tools/v2-ab-shore.mjs`: the shore off and on in place, 6 A B B A rounds of 90 frames, the median difference; the GPU shared, ≈ ±0.2 ms of noise: the composite, which the shore never touches, moved by as much)
| Pose | Size | off → on (frame) | scene pass Δ | Budget |
|---|---|---|---|---|
| the head beach, wind 4 onshore, 45 m off (spray on) | 2560 × 1600 | 13.44 → 13.99 ms | **+0.21 ms** | ≤ 0.9 ms |
| the Sail start (follow camera, shores far) | 2560 × 1600 | 15.38 → 15.14 ms | +0.17 ms | ≤ 0.9 ms |
| phone L2 (lite), the head beach | 569 × 1231 | 2.24 → 2.25 ms | **+0.016 ms** | ≤ 0.3 ms |
| phone L2, the Sail start | 569 × 1231 | 5.09 → 5.54 ms | +0.09 ms (noise: the composite +0.06) | ≤ 0.3 ms |
| the open lake (no kept tile within 1.4 km in view) | any | the on word 0 | 0 (one uniform branch) | 0 |

The field's buffer: 4 MiB made at load (2.94 MB of it filled when the file lands); the CPU's tile pick ≤ 0.05 ms a frame.

## The wake and the spray (render/wake.js, sim/wake.js, sim/spray.js)

v1's wake (`src/boat/wake.js`, `src/water.js` § M10) and bow spray (`src/boat/spray.js`) on v2's engine. The physics is
the shared sim's as it is (`src/sim/boat/wakePhysics.js`: the Kelvin laws, `TRAIL_DT` 0.25 s, `TRAIL_N` 96, the CPU
impulse sum the test compares with); the drawing is ported to WGSL.
- **The track** (`sim/wake.js createWakeTrack`): v1's `update` and `pushImpulse`: every 0.25 s of sim time the transom's
  point, its time, its speed and heading and the impulse's strength (v1's `amp · (U/3)²`, nothing under 0.6 m/s). The shared
  ride steps it (`src/sim/boat/ride.js` calls `wake.update` as v1's does: `createBoatSim({ wake, makeSpray })`), so a
  capture's 20 s settle fills it on the sim clock. `pack()` writes the transom now and the impulses newest first, relative
  to the boat (f32 keeps millimetres), into a buffer made once.
- **The Kelvin map**: as v1's, a boat-centred f16 map (height, ∂h/∂x, ∂h/∂z) recomputed every frame from the
  track: each impulse a stern trough and a bow crest one waterline length ahead, `η = ±amp·τ·dt/r² · exp(−k·rc) · cos(k·r)`,
  `k = gτ²/4r²` (rc 0.8 m, r0 0.6 m). Its stationary phase is the Kelvin pattern: the transverse waves at 2πU²/g, the
  divergent crests, the 19.47° arms, bent on a turning track. 256² over 128 m (0.5 m: v1's 512² was 0.25 m; the hull's
  cutoff leaves nothing under ≈ 2.5 m, so 5 texels a wave), 192² on the phone set. One compute dispatch; the 97 points
  read once a workgroup into shared memory.
- **The foam map**, made from the same track instead of v1's feedback map: v1 stamps the transom's swept segment and a bow
  band each frame, decays (foam 6 s, the disturbed water 14 s) and blurs (5 taps: σ² grows 0.09 m²/s). v2 evaluates that
  history directly: at each texel the nearest segment of the transom's path, its age, and a band across it blurred by a
  Gaussian (σ² = 0.2² + 0.09 × age m²), decayed at v1's 6 s (foam) and 14 s (the slick). The band was fitted to v1's own
  foam map, read back from its GPU at the Sail start (2.95 m/s): along the track 1.00 / 0.92 / 0.81 / 0.73 / 0.51 at
  0.5 / 2 / 4 / 6 / 10 m, across it 5 m aft 0.75 / 0.59 / 0.25 / 0.055 at 0 / 0.5 / 1 / 1.5 m; the fit is a foam band
  0.27 of the beam each side (0.85 m), the slick 0.35 (1.1 m), and nothing beside it (v1's bow band leaves none behind
  the transom in that map); the test holds the twin to v1's numbers within 0.07 along and 0.1 across. No history, so
  no 1,200 GPU passes in a capture's settle, no smear as the map scrolls, the same frame at any frame rate. 512² over
  256 m (0.5 m, v1's), 384² on the phone; texels outside the strip's box (from the CPU) write 0 at once.
- **Snapped**: both maps sit on whole texels of a world grid (a field recomputed on a moving grid crawled).
- **The water's read** (`render/water.js`, its wake block; group 2, bindings 8–9, after the night's 4–7: the two maps in one storage buffer, four f16 a texel, read with a bilinear tap by hand, because the water's fragment stage already samples 16 textures, WebGPU's limit): the Kelvin slope bends the normal and
  the mirror's ray (the slope fades out between a 0.6 and 2 m footprint, before it aliases); the slick (v1's `slickAt`,
  its edge torn by noise along the track) damps the short cascades' ripples by v1's share (`gustResponse` of 5, 0.9, 0.2 m;
  none on the 600 m swell), so the trail reads as a calm lane; the strip as v1's `foamVisible` (lanes 0.6 × 7 m, a speckle,
  thresholded by the strength: churned white at the transom, lanes, then specks, ragged edges; MaterialX's 2-D Perlin
  noise, which v1's TSL `mx_noise_float` is); the bow wave's white roll analytic from the boat's pose
  (v1's `kelvinAt`). The slick is read only where the trail is (v1 read its noise everywhere: with no rough water its torn
  edge alone lifted calm patches up to 14 % over the whole lake). The wake's foam is v1's albedo 0.9 under the sky and the sun, shaded by the normal (the
  whitecaps keep v2's 0.55). Without a wake (`?boat=0`) the same functions return nothing; with `?nowake=1` the maps run
  and read as off.
- **The spray** (`sim/spray.js`, v1's flight line for line, v1's seeded generator: nothing under 15 kn, a burst when the
  bow drops, a slam's sheet and a surf's low sheet from v1's thrill cues, the drops dragged toward the deck wind): 640
  drops, uploaded only when the flight changed, drawn only when some are in the air: thin streaks along the motion relative
  to the boat (v1's `SPRAY_LOOK`: never wider than 0.008 rad, never longer than 0.25 rad, faded near the eye), lit by the
  frame's sky and sun with the backlit glint, blended after the sky (they write no depth).
- **What differs from v1**: the foam map computed rather than accumulated (the test checks the decays and the widths);
  the slick only on the trail; the prop wash drawn along the prop point's history (§ The engine and the ground tackle); the Kelvin
  map at 0.5 m instead of 0.25 m; the height is not drawn into the mesh (v1 neither: slope only); the boat is not in the
  water's mirror (M3's limit, as before). Heel moves nothing in v1's wake either; speed scales every part (the impulses
  with U², the transom's stamp from 0.6 to 3 m/s, the roll from 1.3 to 3 m/s, the spray from 15 kn).
- **URL rows**: v1's `?nowake=1` and its knobs `?wake_amp= ?wake_rc= ?wake_r0= ?wake_bow=` (v1's table, read through
  `SHARED`). `__velia.wake` exposes the track, the spray and the stats (points, map sizes, drops in the air, uploads).
- **Pipelines**: +3 (the two maps' compute pipelines, the spray's draw), built at load; 0 after the first frame. The two
  dispatches run at the end of the `water-sim` pass (nine of the frame graph's ten timed passes are used; the tenth stays free).

### Budgets and checks (the wake, measured 2026-11-13 on the M5 Pro Mac, headless Chrome)
The GPU was shared with three other helpers' captures all afternoon (frame totals 12–30 ms where M5d read 5–9 ms), so
the A/B runs in one page: the wake on and off (`__velia.wake.set`, off = `?nowake=1`'s frame) in alternating 40-frame
blocks, 16 pairs, the median of the paired differences of the per-frame GPU times.

| Budget | Target | Measured |
|---|---|---|
| GPU 2560 × 1600 (`maxpx=5e6`), the Sail start at 13:00 | ≤ +0.6 ms | **+0.36 ms** frame total (water-sim +0.19: the two maps); on main's parity sea, night and storm; the run before them read +0.30 |
| GPU 390 × 844, the phone set (192² / 384² maps) with the hands | ≤ +0.3 ms | **+0.03 ms** frame total (water-sim +0.09); the run before read +0.19 |
| Pipelines | 0 after the first frame | +3 at load, **0** after the first frame |
| Sampled textures | WebGPU's 16 a stage | **0** added: the water's fragment stage was full with the night's maps, so the two maps live in one storage buffer (four f16 a texel) read with a bilinear tap by hand |
| Allocation a frame | none | the points, the uniform and the spray's drops packed into arrays made once; `writeBuffer` with offsets |
| CPU | – | the track's step and pack: 97 points; the spray's flight: 640 drops (v1's loop) only while any are in the air |
| Flicker (`tools/v2-flicker.mjs`, the follow pose, the water band outside the boat's column) | no regression | on the parity sea, 13:00 **9.33 / 3.02 %** vs 9.32 / 3.02 % with `?nowake=1` (before it: 7.39 / 2.23 % vs 7.41 / 2.23 %; 18:45 15.17 / 4.18 % vs 15.20 / 4.18 %) |
| Determinism | `--twice` 0 px | **0 px** on all 24 frames (after main's film-clock fix) |
| Bundle | – | `index-*.js` 513.2 kB raw / 188.4 kB gzip with the front door's chunk (the wake's modules ≈ 25 kB source) |

Goldens re-blessed on the wake branch over main's (the boat's frames, for the owner to judge): `v2-sail-13`,
`v2-sail-20`, `v2-sail-wind`, `v2-sail-phone` (the Kelvin crests move the mirror's cloud patches round the boat: 13 % of
its pixels), `v2-hud-full`, `v2-hud-calm`, `v2-home`, `v2-storm`, `v2-rainbow` (the strip behind the boat); the other
15 unchanged.

**The strip's visible length** (after the sailing parity, both boats 5.7 kn at the 13:00 start): with v1's map and
v1's `foamVisible` exactly, v2's white strip ended ≈ 3 m behind the transom where v1's reads white for ≈ 10 m. v1's foam
colour sits far above white in its HDR, so its thin partial foam reads as solid. A bias of 0.6 on the threshold
(`WAKE_FOAM.bias`, fitted on the above-stern and 21 kn frames) gives v2's strip v1's length; past ≈ 10 m v1's trail is
its slick reflecting bright cloud, not foam.
