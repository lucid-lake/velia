# v2 notes: Clouds, the whole frame's look, night and storm, birds, fireworks

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## The clouds (M5a: render/clouds.js, sim/clouds.js, cloud-read.js)

**The look is v1's deck** (`src/clouds.js`, owner-approved in the v1 goldens: big sunlit cumulus over the Sierra, soft
dusk-lit undersides): the same Nubis density (a Perlin-Worley shape at a 5 km tile eroded by a Worley detail at 700 m,
a 24 km weather map for coverage and type, the height gradient per type, wispy under and billowy above), the same light
(Beer-Lambert with a soft multiple-scattering floor and the powder term toward the sun, 3 light samples; the sky's mean
radiance at the top and a third of it below, dimmed by two cheap samples up; the two-lobe Henyey-Greenstein phase) and
v1's deck numbers (`DECK` = v1's `CLOUD_DECK`: coverage 0.6, type 0.35, base 700 m, thickness 900 m, density 0.04 /m;
`?cloudcov= ?cloudtype= ?cloudbase= ?cloudthick=` as v1's rows, `?clouds=0` none). The noise is baked on the GPU at load
(one 64³ `rgba8unorm` tile, shape in R and detail in G, and a 256² weather tile; the JS twins in `sim/clouds.js` are the
same formulas, and the tests hold the fixed stretch bounds to the sample's percentiles, since the GPU has no `toBytes`).

**What is different is where the march runs.** v1 marches every screen pixel (half-res, 96 steps, temporal history:
5.2 ms of its 720p frame, and ghosts on cuts, sails and birds). v2 marches **once per direction into a panoramic key
from the eye** (Cold Smoke's "keys",: there the clouds never get nearer; here the boat moves 2–3 m/s under a
deck 700 m up, so the parallax between two keys is a fraction of a texel): 2048 × 512 texels (1024 × 256 under 0.6 Mpx of
backing: phones), azimuth across, `v = sqrt(elevation / 90°)` down so the texels pack at the horizon where cumulus sides
are seen from a boat; rgb the cloud's light toward the eye (premultiplied, HDR scale, the air between eye and cloud by
its mean distance: the medium at the deck's height, the horizon's sky in that azimuth as the in-scattered colour), a its
transmittance, and a second `r32float` texture its opacity-weighted mean distance (km). Each frame bakes a band of rows
of the *next* key (9 rows × 2048 at 60 Hz: a whole key a second; 5 × 1024 on the phone key), and the readers cross-fade
between the last two complete keys (three layers rotate: `createKeySchedule`, the test walks three cycles). The sun, the
weather or the wind's drift therefore never cost a whole march in a frame, and there is no screen-space history: no
ghosting, no depth-aware upsample, nothing to reset on a cut. The first frame bakes the whole key (so the first picture
has clouds), and so does an eye jump past 100 m (a camera cut); in a capture the first frame does the same, then the
amortised rows run as live (the goldens: `--twice` 0 px).

**Compositing (one fetch each):** the sky draw `c × T + L` (the sun's disc under the same T); the water's mirror reads
`skyWithClouds(R)` where it read the sky, so the deck is in the lake as v1's is; the terrain lays the cloud over ground
farther than the key's mean distance along the view ray (a cumulus nearer than a far ridge). The key and its params ride
in the sky-read group every scene shader already binds (bindings 7–9; the terrain fragment now samples 16 textures, the
limit; ultra M2 moved the bay's heights to a storage buffer and gave the 16th to the caustics). Chosen over a low-res screen-space march with temporal reprojection (v1's path at lower settings would have met
the budget too, at ≈ 0.6–0.8 ms at 2560 × 1600, but with v1's history artefacts and two more passes) and over a 2.5D
plane (the cumulus sides at the horizon collapse to a line).

**Not in M5a:** the storm's own look (the shared weather state's cell lifts the coverage and the slab top inside the
cell and dims the sky light by its shade: `fillParams` reads `src/sim/weather/state.js`; v2 has no storm sim yet, so
`on` stays 0), the slope-hugging stratus bank (v1's `?bank`, off by default there too), cloud shadows on the land (the
plan: a world-anchored 512² column-integral map over 24 km from the same density, re-baked a few rows a frame in the
cloud-key pass, read by the terrain and the water at the sun-projected xz; ≈ 4 k columns × 16 samples a frame), the
fine erosion octave near the camera (v1's `FINE_M` with temporal), and per-pixel detail: a key texel spans 0.18° in
azimuth (4.5 px at 720p, 9 px at 2560 wide), so edges are a little softer than v1's half-res march.

### Budgets (M5a, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians; `?clouds=0` is the same build with no march)
| Frame | Budget | cloud-key pass | scene with clouds / without | total with / without | v1's clouds |
|---|---|---|---|---|---|
| 1280 × 720, the follow camera 13:00 | – | **0.086 ms** | 0.893 / 0.825 (+0.07) | 2.84 / 2.66 ms | 5.2 ms at 640 × 360 |
| 2560 × 1600 (`?maxpx=5e6`), the same pose | ≤ 1.2 ms | **0.068 ms** | 2.313 / 2.164 (+0.15) | 6.22 / 5.31 ms (the composite pass moved 2.26 / 2.10: noise, it does not read the key) | – |
| 390 × 844 with the hands, 16:00 | ≤ 0.6 ms | **0.065 ms** (the 1024 × 256 key) | 0.417 / 0.438 | 1.69 / 1.94 ms (noise) | – |
| Pipelines after the first frame | 0 | 0 (23 at load: +3) | | | |
| JS | | 287.7 kB raw, **108.7 kB gzip** (+7.3 kB gzip) | | | |
| GPU memory | | key 12.6 MB + distances 12.6 MB + noise 1 MB (desktop); 3.1 + 3.1 + 1 MB on the phone key | | | |

The clouds cost ≈ 0.15–0.25 ms at 2560 × 1600 (the march 0.07 ms + the scene's extra fetches); the first frame's full
key costs about 5 ms once, behind the veil. Run-to-run noise on this GPU is ≈ ±0.5 ms on the totals (M3's note).

### The clouds' colour (fix(v2), 2026-11-14: sim/clouds.js cloudLightMatch, render/clouds.js, tools/v2-cloud-colour.mjs)

The owner (2026-11-14), v1 | v2 at noon: "Our cloud color … do not match V1": v2's clouds read grey with dark undersides
against v1's white tops and light grey undersides. **Measured, not eyeballed** (`tools/v2-cloud-colour.mjs`: each pose rendered
with the deck and with `?clouds=0` in both apps; the difference is the cloud mask; medians of the core's brightest quarter
(tops), darkest quarter (undersides), the rim, and the clear sky within 30 px; `tools/cloud-colour-measure.mjs`). Noon, cam E,
sRGB: tops v1 206, 209, 216 / v2 174, 175, 183; undersides 163, 176, 193 / 109, 116, 132.

**The cause, by switching terms off in both apps** (noon cam E): the sun alone (sky light 0) gave tops 200, 193, 191 in v1 and
172, 171, 176 in v2; the sky light alone (sun 0) gave undersides 89, 134, 171 in v1 and **10, 28, 65** in v2. v2's haze on the
clouds moved nothing over 3 levels; the phase, the powder and the occlusion are the same formulas in both. Two causes:
1. **The sky light was π too small.** v1 lights the deck with takram's indirect scalar illuminance over 2π, which is the sky's
   irradiance E (the irradiance LUT × 2π / 2π); the port read it as a mean radiance and divided the light record's E by π.
2. **The camera.** v1 keeps a fixed exposure by day and darkens only the true sky (its polariser curve, `src/core/grade.js`
   SKY × 0.53), so the clouds stay bright under AgX's soft shoulder and the LUT's; v2's one exposure puts a grey card at 0.24
   into ACES (the navy water with no grade) and adapts up toward dusk, which leaves the clouds ≈ 3 × darker in the mids and
   1.4 × at the sunlit tops. ACES also keeps the blue of the sky light that AgX desaturates.

**The fix, in the cloud recipe** (no post tint): the march's sun × 1.4, its sky light × 10 (π for E, × 3.2 for the camera)
with the sky light's chroma × 0.5 (`LIGHT_MATCH`), each scaled by the ratio of v1's exposure to v2's at the sun's height
(never above noon's) and faded out below the sun's −2…10° (v1's 20:00 undersides; the night keeps its look) and under a storm's dark or cover: the night and the storm keep their
looks (their samples are unchanged to the level). The gains ride a new seventh row of the params record (`CloudU.g`,
`PARAM_FLOATS` 28). The key, its schedule, the blend and the mip chain are unchanged; the cloud-key pass's own GPU time at
2560 × 1600: 0.131 → 0.132 ms (sail13 and cam A), on the phone path (390 × 844) 0.081 → 0.077 ms (`tools/v2-perf.mjs`, 5
interleaved rounds). The water mirrors `skyWithClouds`, so the reflected clouds brighten too; the deep water's navy is unchanged.

**The sky behind the clouds is a separate cause, not changed here (matched since: § The whole frame's look):** v2's clear sky is deeper and darker than v1's at every day
pose (noon cam E beside the clouds: v1 45, 137, 184 / v2 48, 90, 151; the horizon 170, 199, 212 / 133, 170, 192; 30° up 7, 114,
166 / 32, 66, 125). It comes from the camera alone (v2's exposure and ACES against v1's AgX + LUT + polariser), not from the
cloud light; matching it means changing v2's exposure or tone curve for the whole frame, which would move the water.

| pose (1280 × 720) | region | v1 | v2 before | v2 after |
|---|---|---|---|---|
| noon cam E | tops / undersides | 206, 209, 216 / 163, 176, 193 | 174, 175, 183 / 109, 116, 132 | 206, 208, 215 / 163, 173, 192 |
| noon cam A | tops / undersides | 222, 221, 224 / 179, 188, 202 | 208, 207, 208 / 136, 139, 152 | 227, 227, 229 / 179, 185, 199 |
| noon follow, wind 3 | tops / undersides | 214, 214, 219 / 171, 181, 196 | 182, 183, 189 / 126, 130, 145 | 211, 213, 219 / 175, 182, 196 |
| noon follow, wind 4, turned | tops / undersides | 215, 216, 222 / 164, 176, 194 | 204, 203, 204 / 113, 120, 139 | 224, 224, 226 / 165, 175, 193 |
| 09:00 cam E | tops / undersides | 219, 214, 215 / 173, 177, 188 | 207, 204, 203 / 138, 140, 152 | 219, 218, 220 / 171, 177, 191 |
| 18:45 cam A | tops / undersides | 219, 210, 206 / 148, 151, 164 | 220, 214, 208 / 138, 137, 145 | 218, 214, 214 / 151, 157, 175 |
| 18:45 cam E | tops / undersides | 184, 180, 184 / 119, 131, 151 | 177, 172, 175 / 92, 97, 115 | 185, 185, 195 / 123, 136, 163 |
| 20:00 cam B (the sun 4° up) | tops / undersides | 194, 166, 154 / 112, 102, 111 | 201, 169, 130 / 114, 91, 79 | 196, 169, 148 / 120, 108, 113 |
| overcast (cov 0.9) cam E | tops / undersides | 183, 189, 201 / 159, 174, 193 | 131, 134, 148 / 84, 92, 114 | 179, 185, 199 / 151, 164, 188 |
| storm (150 s) | tops / undersides | 178, 180, 183 / 77, 87, 99 | 181, 185, 192 / 90, 95, 107 | unchanged |
| night (21:36) | tops / undersides | (v1's deck nearly black) | 41, 65, 115 / 38, 61, 108 | unchanged |

The full table (the rims, the sky beside, the horizon, 30° up) and the stacks: `renders/v2-cloud-colour/` (`samples.md`,
`<pose>.png` v1 / v2 before / v2 after at 960 wide, `contact-sheet.png`). The lock: `v2/tests/pages/cloudColour.page.mjs`
(noon cam E's tops and undersides within 8 levels a channel of v1's; it fails on the code before the fix by 34 and 61).
**Since the frame look (below)** the sky is matched too and the deck's gains were re-fitted under v1's camera (`LIGHT_MATCH`
sun 1.85, sky 7.7, chroma 1.05; the ACES-era numbers stay as `LIGHT_MATCH_V2` for `?look=v2`); the lock still passes (tops
205, 210, 217, undersides 157, 176, 195).

### The whole frame's look (fix(v2), 2026-11-14: render/grade.js, shaders.js, sky.js, water.js, bed.js; sim/exposure.js; sim/clouds.js; tools/v2-frame-look.mjs)

v2's clear sky read deeper and duller blue than v1's, toward dusk v2 exposed up to 2 × brighter than v1, and its water
mirrored less at grazing angles. **Measured first, switching terms off in both apps** (`?clouds=0`, v1's `?grade=0`, the tone
curves inverted per pixel; scripts in `renders/v2-frame-look/scr/`):
1. **The tone curve and the grade.** v1 draws the scene → a sky-only polariser on the true sky (Y × 0.53, chroma × 1.6, by
   day) → the deck → AgX at its exposure → a 3D LUT (one noon grade: an S curve on L*, blues × 1.25 turned 10° toward cyan,
   subtractive chroma, a soft shoulder). v2 had ACES and no grade. Without the LUT no sky curve fits v1's sky (rms 16.5
   levels on noon cam E's three sky samples); with it, 3.6. AgX's shoulder also takes whites further in than ACES: at M2's
   noon factor the sail read 189 and the boathouse roof 151 (v1 225 and 171; ACES 208 and 169).
2. **The sky's own level.** With both curves inverted, v1's cloudless noon sky comes into its tone curve at 4.0–4.4 × v2's
   luminance (red 5.2 ×, blue 3.5 ×): takram's sky stands brighter and paler against v1's hand-lit ground than v2's
   Hillaire sky against its sunlit ground. v1's polariser then takes 0.53 of it back.
3. **The dusk exposure.** M2 adapted as √(the light on the ground): × 1.96 at 18:45 (the sun 12.5° up); v1 holds one
   exposure down to the sun's +8.5° (`src/sim/timeOfDay.js exposureAt`).
4. **The grazing mirror.** v2's mirror read v2's own (dimmer) sky; v1's reads v1's sky without the polariser. Near the
   vertical v1's water is as dark as v2's own-sky mirror (noon cam E's near water 1, 30, 79 in v1, 0, 26, 77 in v2); 15–25°
   below the horizon v1's is brighter (61, 105, 144 against 4, 61, 113). The Fresnel formulas were already the same
   (Schlick, F0 0.02, the rough average at 0.9 √σ²).

**The changes** (v1's numbers where v1 has them; one 17³ LUT texture and a `look` row on the frame record; no pipeline added):
- **v1's camera** (`render/grade.js`): three.js r184's AgX in WGSL, then v1's GRADE LUT built at load from the same maths
  (`gradeLutData`, byte-identical to v1's in the test), its strength by the sun (night 0.35); in the composite (group 2).
- **The exposure** (`sim/exposure.js`): v1's day schedule at 0.34 (M2's noon 0.26 × 1.3: whites and greys back to v1's
  level under AgX: the roof 167, the sail 201), v2's own night (M2's adaptation × the night gain) at 0.2, the lower of the
  two, never under the day's base; they cross a little over the horizon. 18:45 is now exposed as noon (M2: 2 ×).
- **The sky match** (`SKY_MATCH`): v2's sky radiance × 3.06 in luminance, chroma × 0.75 round it, then v1's polariser in
  the sky draw (the whole curve lum 1.62, sat 1.2, fitted through AgX and the LUT on noon cam E's samples at the day
  exposure), full with the sun over 8°, none under −2° (the night's airglow sky is v2's own).
- **The navy kept** (`waterKeep`, F.look.x): the water's surface and its column past the shelf (render/bed.js, over the
  shelf tint's 6–16 m) are never exposed brighter than M2 exposed them: × min(1, M2's factor / v1's) = 0.765 at noon, 0.91
  at 09:00, 1 from the afternoon on and at night. The shelf, the land and the boat take the new exposure. A tint on the
  body's backscatter was tried first and dropped: the near deep water is mostly the mirror, the body moved it < 1 level.
- **The mirror** (`render/water.js mirrorBlur`, `MIRROR_SKY`, `MIRROR_DECK`): the reflected sky takes the match at grazing
  rays (full under a reflected elevation sine of 0.15, none over 0.5; ÷ the keep, so the mirror shows the drawn sky at the
  frame's exposure), so the far water brightens toward v1's and the near water keeps its navy; the deck in the mirror keeps
  its light from before the camera change (the screen's extra cloud gain for AgX's shoulder is not the light's). A full
  match everywhere lifted the follow camera's whole near sea toward the rejected bright mid-water blue.
- **The clouds** re-fitted under the new camera (above); `?look=v2` keeps the old camera whole (ACES, no grade, M2's
  exposure, the old cloud gains, v2's own sky in the mirror, no keep), `?grade=0 | lut | sky` as v1's.
- **The navy, checked:** the follow camera's near deep water at noon 1, 44, 89 against 29, 39, 88 before: L* 18.0 (17.5),
  chroma 31 (33.8), the hue −79° (−67°), turned by v1's LUT onto the brand's sampled noon lake (#183461, −77°), not toward
  v1's brighter blue.

**#40, the off-screen land mirror: v2's true mirror kept.** v1's land mirror is screen-space (sky where the reflected point
leaves the frame). Tried as a fade of the land's share where the reflected ray projects off screen: at the calm lane the
rays still land on the on-screen bay wall, so the lane moved < 1 level (its near water 2, 45, 88 either way; v1 0, 15, 70);
it only brightened patches along the frame's sides, which would shift as the camera turns. That trades a steady reflection
for a framing-dependent one, against the owner's ruling (broad and steady), for no gain at the lane.

**Samples** (sRGB medians at 1280 × 720; the full table `renders/v2-frame-look/samples.md`):

| pose | region | v1 | v2 before | v2 after |
|---|---|---|---|---|
| noon cam E | sky beside the clouds | 45, 137, 184 | 48, 90, 151 | 53, 136, 184 |
| noon cam E | horizon | 170, 199, 212 | 133, 170, 192 | 161, 196, 212 |
| noon cam E pitched up | sky 30° up | 7, 114, 166 | 32, 66, 125 | 10, 110, 163 |
| noon cam E | cloud tops / undersides | 206, 209, 216 / 163, 176, 193 | 206, 208, 215 / 163, 173, 192 | 205, 210, 217 / 157, 176, 195 |
| noon cam A | sky / cloud undersides | 49, 139, 186 / 179, 188, 202 | 50, 93, 153 / 179, 185, 199 | 58, 138, 186 / 176, 188, 202 |
| 09:00 cam E | sky / cloud undersides | 28, 125, 172 / 173, 177, 188 | 62, 108, 166 / 171, 177, 191 | 63, 138, 184 / 169, 179, 193 |
| 18:45 cam E | sky / cloud undersides | 11, 98, 144 / 119, 131, 151 | 66, 111, 167 / 123, 136, 163 | 41, 122, 166 / 115, 138, 162 |
| 20:00 cam B | sky / cloud tops | 96, 112, 136 / 194, 166, 154 | 88, 115, 155 / 196, 169, 148 | 103, 129, 152 / 180, 157, 144 |
| overcast cam E | cloud undersides | 159, 174, 193 | 151, 164, 188 | 139, 165, 191 |
| noon follow | the sail (97th percentile) | 225, 211, 200 | 208, 207, 206 | 201, 200, 198 |
| noon follow | near deep water | 1, 31, 80 | 29, 39, 88 | 1, 44, 89 |
| noon cam E | deep water | 7, 53, 98 | 29, 39, 85 | 1, 43, 86 |
| noon cam E | open water 15–25° down (column) | 61, 105, 144 | 60, 75, 136 | 22, 81, 126 |
| pier 13:00 | boathouse wall / roof | 35, 43, 52 / 171, 170, 164 | 37, 42, 45 / 169, 171, 165 | 40, 50, 55 / 167, 168, 163 |
| pier 13:00 | the mirror under the boathouse | 32, 102, 94 | 52, 91, 105 | 44, 94, 108 |
| pier 18:45 | boathouse wall | 27, 27, 32 | 62, 62, 57 | 46, 47, 46 |
| 18:45 follow | near water | 8, 14, 46 | 17, 23, 54 | 3, 27, 58 |
| night 21:36 | near water | 4, 24, 74 | 6, 18, 90 | 0, 26, 85 |
| storm 150 s | near water | 3, 4, 12 | 35, 39, 48 | 24, 35, 46 |

Left: the overcast undersides 20 levels under v1's; the 18:45 sky less deep than v1's (v1's polariser at full strength on
a paler sky); the sunset's cloud tops 14 under; the 18:45 boathouse wall still 19 over v1's (its sky light; the exposure is
v1's now). Stacks (v1 / v2 before / v2 after, 960 wide) and the contact sheet: `renders/v2-frame-look/`.

**The storm under v1's camera (after #18 round 2 merged; the owner on the storm cam E stack: "why does v2 have such a gap?").**
Measured at #18's poses (`tools/v2-storm.mjs`: the follow camera, cam E under the cell, dusk at 20:00, cam L toward the cell;
147 s into the arc) and in this item's stacks (`storm`, `storm-E`, `storm-dusk`, `storm-cell`; "before" is main with round 2).
Why each gap, and what changed:
- **The black band across the bay's mouth (cam E): a bug, fixed.** The scene is rasterised without refraction, so a grazing ray
  over the mouth's shallow sill reaches the floor past it, where the terrain draws no node (wholly under 60 m: the deep lake
  costs nothing). The water there was still part see-through (its depth under the pixel is the sill's), so the cleared,
  black background showed through. The water now tests its straight view ray at six depths down to 60 m (three height reads
  became six a vertex, `WV.hole`) and is its own opaque body where the ray passes the floor cut clear; the sky draw keeps the
  deck off directions under the horizon and gives them the storm's mist. The band reads 58, 67, 76 against v1's 62, 70, 78
  (main 15, 17, 20); `v2/tests/pages/stormMouth.page.mjs` locks it (it fails on main). The land's and the shore's mirror marches take the storm's mist at
  their hits as the land does (`STORM_FOG_WGSL`, moved out of `AP_READ`), so a ridge fogged out above is fogged out in the water too.
- **The storm is darker toward dusk: the camera, fixed.** Round 2 tuned the storm's light under M2's camera, which brightens
  toward dusk; v1's schedule holds the day's exposure to +8.5°, so 20:00 read 0.64 × main. Under a storm's dark the exposure
  is now never under M2's adaptation (`stormExposure`; at noon v1's is the higher and holds). Dusk: the deck's undersides
  82, 86, 94 against v1's 83, 81, 85 (61, 64, 72 before this), the sky 120 against 132.
- **The boat and sail read dark grey: a missing light, fixed.** Under the cell the sun is shaded to 0.08 and the overcast
  deck scatters its light down as sky light (the storm water's own reasoning); the boat had no such term. Its sky light ×
  3 at the storm's full dark, in a neutral grey (`STORM_BOAT_SKY`, render/boat.js ambientAt; the cockpit shares it): the sail
  and hull read a light grey as v1's.
- **The storm water's navy: re-fitted for the camera.** v1's LUT lifts a dark blue's chroma, so round 2's body light (× 45)
  read a bright blue (1, 10, 34); × 15 under v1's camera (`STORM_WATER.bodyV1`; `?look=v2` keeps 45): the follow camera's
  water 3, 8, 22 against v1's 5, 8, 17 (`stormWater.page.mjs` passes), dusk 3, 6, 20 against 5, 7, 13.
- **The sky between the clouds read navy: partly reachable.** v1's cell goes overcast round the eye: at coverage 0.82 its
  deck turns soft and continuous, where v2's same coverage keeps hard-edged clouds with clear gaps. Under the storm's dark the
  clear sky now takes 0.6 of the storm's steel mist (`STORM_SKY`, render/sky.js): steel-grey gaps, not navy. The deck's
  shape (v1's soft, streaky, continuous overcast; the cloud wrapping the hills) is the deck's own (render/clouds.js), not the
  camera's, and stays.
- **Not reachable from the camera:** the trees read flat light grey with white trunks (the fog lies evenly over every card,
  and the trunks' own material); the far ridges mostly vanish (v2's height fog is v1's valley mist over the full distance,
  where v1's far look keeps layered ridges); the shallows' teal under the mist and the waves' texture on the open water (the
  water's later wave job). These are the storm's and the water's own terms.

**Cost** (`tools/v2-perf.mjs`, base = main served beside, 6 ABBA rounds × 240 frames, per-pass own GPU time, the GPU
shared). The camera alone, measured at a quiet hour (before the storm work): the composite +0.029 ms (Sail start) and +0.035 ms (cam A) at 2560 × 1600, +0.008 ms on the phone path (390 × 844 at 3×, L2), the scene pass +0.001 / +0.018 / −0.005, the frame totals inside the noise (10.33 → 10.25, 7.86 → 7.89, 2.00 → 2.01 ms). The final code against main with storm round 2, at a load average of 10–25: the composite +0.024 / +0.035 ms at 2560 × 1600 and +0.010 to +0.012 ms on the phone path; the scene pass −0.18 / +0.16 at 2560 × 1600 (inside the run spread, −2.9 to +7.0 ms on the totals) and +0.10 ms on the phone path, of which +0.04 is there under `?look=v2` too (the water's sill test: one height read a vertex, six more only for grazing water over a bed shallower than 60 m; the lite water reuses its own read), the rest the camera's sky and mirror curves; the phone's frame total +0.08 to +0.11 ms (median of the rounds, spread ±0.2). Pipelines unchanged (the tonemaps gain a group, not a variant); GPU memory +20 kB (the LUT); nothing
allocated a frame.
**Locks:** `v2/tests/pages/frameLook.page.mjs` (the noon sky beside the clouds and 30° up within 10 levels of v1's; the
navy; `?look=v2` unchanged), `cloudColour.page.mjs` and `towns.page.mjs` (the boathouse wall and roof within 10 of v1's)
still pass, `v2/tests/frame-look.test.mjs` (the LUT and the strengths byte- and value-identical to v1's, AgX's curve),
`camera-exposure.test.mjs` (v1's schedule by day, v2's night, smooth; the water keep).

### The land's sky light and the mountains (fix(v2) terrain shadow, 2026-11-14: render/sky.js, terrain.js, forest.js, rocks.js)

The owner's reports: the shore in a ridge's shadow and the slopes turned from the sun read pure black (0,1,18 in their
frame); then, from the stacks, "in v1 we can see the snow mountain's details; v2 is ugly": v2's mountains green, flat and
muddy, no snow, little relief. Each cause was found by switching terms at matched poses (the W slopes at 13:00 and 18:30,
Sail's start, cam E, 09:00, 15:56) against v1, and v1's recipe ported at the source.
- **Black shade.** The shadow map was right; v2 lit the land out of the sun with the level sky alone (LIGHT.sky, four 45°
  samples × π) by the face's tilt, a deep blue a fifth of v1's on green needles (`?look=v2` kept it black: not AgX or the
  grade). v1 has two sky terms (the atmosphere light's and the environment's diffuse). The aerial pass's first workgroup now
  projects the whole sky (the sky-view LUT, a ray under the horizon reading the horizon's haze, as v1's environment cube)
  onto L1 harmonics once a frame (8 equal-area bands × 8 azimuths, one sample a thread, summed by halves; LIGHT.irrR/G/B, the
  record 32 → 80 B); `skyIrrN(n)` is three dot products (`skySH`, its JS mirror, is tested). `landSky(n, k, desat)` =
  (skyIrrN(n) + the tilted level sky) × k, 60 % to its grey, back to the level sky alone as the sun sets from +2° to −6°
  (the night unchanged). k: the ground and the boulders 1.1, the cards 0.75 (`LAND_SKY`); the cards' old bounce left.
- **No snow.** v2 painted the day's 3,000 m line (no peak round the bay reaches it). v1's ground paints the far look's spring
  line, 2,500 m (src/core/farLook.js; the trees and towns keep the day's), north faces aspectM lower, patchy by a 500 m and a
  30 m noise (± 70 m, ± 25 m), none past 1 − n.y ≈ 0.32–0.5. Ported as is (terrain.js; `LAND_LOOK.snowLine`).
- **Olive, not granite.** The photo is the same (the tiles match v1's file); the light was not. v1's terrain is a
  MeshStandardMaterial (F0 0.04, roughness ≈ 0.9): its sun lobe and its sky reflection grey and lift a slope seen at a
  glance. v2 had the diffuse alone. `landSpec` (sky.js): the GGX sun lobe and the rough sky reflection (skyIrrN about the bent
  reflected ray / π, three's DFGApprox). The sunlit rock 98,104,98 → 133,136,126 (v1 123,122,116).
- **Muddy distance.** v1 keeps 15 % of the aerial haze on surfaces, a thin valley mist in its place (src/core/post.js,
 S3), the ground's depth tint (richer within 0.6–2.2 km, toward a deep slate past 2.5–14 km) and the far albedo
  × 0.35 past 6–18 km. v2 had the full air and none of it. `aerialLand`, `fairMist`, `depthTint` (AP_READ) on the terrain, the
  cards (toward v1's far colour × the day's light) and the boulders; the bed under the water keeps the full air.
- **Flat shade.** v1's sky light on the ground is occluded by its skyline (horizon-fine's sky visibility³): gullies darker.
  v2 has no horizon map; the bake's cavity (−1 gully … +1 ridge) scales the ground's sky (× 1 + 0.8 · cavity, 0.35–1.5).
- **Checked, not the cause:** the photo tiles (the same pixels as v1's file); the tree placement on the bay's walls (v1's
  lidar crowns in both); the edges (the map's 4-tap PCF ≈ 2 texels, 4.9 m: hard only against a black shade).
- **Left:** v1's far trees read darker than v2's lit cards (sunlit forest at 13:00 35,57,45 vs v1 11,41,41: v1's impostors and
  far map); the water's mirror of the land keeps its own light (terrain.js REFLECT).
- **Samples:** renders/v2-terrain-shadow/samples.md; stacks and crops (v1 / before / after) there.
- **Cost** (`tools/v2-ab-terrain-shadow.mjs`, main and this branch served side by side, ABBA, medians of the rounds; the GPU
  shared): 2560 × 1600 at the shaded shore the frame −0.07 ms, the aerial +0.013, the scene −0.016; Sail's start inside the spread (the
  aerial +0.011, the forest +0.04); the phone path (585 × 1266, L2, 15 × 150 frames) the aerial +0.004, the scene +0.026, the
  frame +0.06. No new pipeline, no new texture; nothing allocated a frame.
- **Locks:** `v2/tests/pages/terrainShadow.page.mjs` (the two shaded regions within 12 of v1's and not black, the sunlit
  granite within 16 and the snow cap within 30 of v1's, the night within 3 of before), `v2/tests/terrain-shadow.test.mjs`
  (the projection's behaviour; LAND_LOOK is v1's FAR_LOOK).

## The birds (render/birds.js, sim/birds.js, engine/birdAudio.js)

v1's birds (`src/birds/`) on v2: the osprey pair (one hunts round the boat: patrol, hover, plunge,
carry; one soars high), the bald eagle on the thermals over the walls, a second eagle on v1's snag at Emerald Point, the
California gulls' flock round the boat, the Canada geese's raft that runs and lifts off when the boat comes close.

- **The flight is v1's.** `v2/sim/birds.js` is v1's `createBirds` cast and step without three.js: the same birds in the
  same order (the ids and seeds follow it), v1's `keepAway` (40 m from the camera, the owner's rule), v1's places
  (`bayPlaces`: the thermals, the snag, the nest, the raft) and v1's snag mesh as plain arrays, the director's cues
  (`place`, `flock`, `plunge`, `lowpass`, `takeoff`, `raft`), the storm's shelter, none in the air at night. It flies them
  with v1's own `src/birds/flight.js` (Bird, stepSoar, stepHunt, stepFlock, stepRaft, stepPerch, stepLowPass; three-free).
  `v2/tests/birds.test.mjs` runs v1's `createBirds` beside it for 30 s with cues and demands the same positions, quaternions,
  fades, levels of detail and events, and v1's snag and perch.
- **The draw ports v1's mesh.js.** v1's bodies (`src/birds/build.js`, plain JS: the lofted body, every feather a vane, the
  emarginated primaries, the tail's fan, the legs, the osprey's trout) are the vertex buffers as they are (4 species × near
  and far: 1.5 MB of floats, uploaded at boot). v1's TSL deform is WGSL: the tail's spread and pitch, the legs, the fish,
  the head's turn, the wing's fold, splay, curl, arm and hand sweep and dihedral, blended over the body, arm and hand bones;
  the per-pixel feather outline, v1's plumage (the bars, the rachis, the contour feathers, the coverts' fringes, the eye), the
  dithered near/far fade, v1's translucent vanes (the shading normal bent toward the sun through a back-lit feather). Lit
  as the world: the sun through the transmittance LUT, the frame's sky light, the terrain's sun shadow, the aerial
  perspective and the clouds; a ground bounce (the level ground's sun and sky × 0.2) stands in for v1's environment light
  under the wings. One storage buffer holds every bird's 24-float record (v1's layout; one `writeBuffer` a frame); one
  indexed instanced draw per species and level (≤ 8), the snag (one draw), the low birds' soft shadows (one blended
  instanced draw after the water).
- **The sound is v1's.** `src/birds/sound.js` (three-free) plays the flight model's events (the calls, the honks, the
  splash) on a live page, after the first gesture: `v2/engine/birdAudio.js` (renamed beside M5e's page audio) is a minimal audio service (one AudioContext and
  a master gain, v1's `attach` contract). The calls (`audio/birds/`, 316 KB, both formats) are served by the dev server
  and copied into `dist-v2/audio/birds/` by a build.
- **When.** `?birds=0` off. As v1: captures (`?headless`) and automated browsers leave them out unless `?birds=1`, so the
  scene goldens see none. The flock is made once the terrain's heights are whole (a capture: before the first frame; a live
  page: when the stream is done, ≈ 1.2 s; v1 places the thermals and the snag on the full terrain). A phone (a coarse
  pointer) or `?terrain=phone` takes v1's `low` tier (6 gulls, 5 geese, nearer LOD switches, no shadows).
  `?birddive=0|1` as v1. The terrain passed in is v1-shaped (`{ heightAt, shoreDistance? }`): without a shore distance v1's
  own fallbacks place the snag and the raft (a v1-shaped lake terrain with v1's shore grids can be passed to `birds.make`).
- **Harness.** `__velia.birds.sim` (cues, `find`), `__velia.birds.frame(dt, aim)`: a film step on the scene clock, then the
  camera aimed by `aim(sim) → { pos, target, fov }` (the goldens' `birds-v2` recipe: v1's `birds` recipe on v2's hook).
  `stats().birds`: draws, birds, triangles, the sim's near/far/shadows and its CPU ms.
- **Not ported (v1 differences).** The dive's water (v1's `spray.js` crown, spout and foot slaps, and `water.js`'s rings and
  marks in the water shader): the osprey still plunges and the geese still run and lift, but leave no splash or ring. v1's
  phone-deferred fetch (`cardFetch`) for the calls: v2 fetches them when the sound starts. The cloud deck's `nearSky` trail
  fix (v1 clouds) has no v2 counterpart (v2's clouds are a key, not a temporal march).
- **Golden.** `v2-birds`: v1's `birds` golden pose (17:00, the boat's start settled 20 s, the eagle and the osprey placed
  by v1's cues 80–160 m off the bow, the flock behind, an 11° lens from the foredeck).

### Budgets (birds, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 2560 × 1600, 60 frames, the scene pass's median, 3 interleaved runs each; the GPU was shared with other helpers' jobs)
| Pose | With birds | Without (`?layers=` minus birds) | Cost |
|---|---|---|---|
| v1's birds golden pose (23 birds, 14.1 k triangles) | 0.226 ms | 0.203 ms | +0.023 ms |
| the follow camera at 13:00 (23 birds far, 11.7 k triangles) | 4.386 ms | 4.381 ms | +0.005 ms |

The budget is +0.2 ms (phones about half: the `low` tier draws 17 birds and no shadows). The sim's CPU is ≈ 0.1–0.2 ms a
frame (v1's). Pipelines: +4 render (near, far, snag, shadow): 53 on a live Sail page with the birds, 0 after the first frame.
## The fireworks (render/fireworks.js, living/fireworksPlugin.js, sim/fireworks.js, audio/fireworks.js)

v1's July 4th show (src/fireworks/) on v2's GPU. **When:** v1's rule (src/fireworks/share.js `showOn`): built on
the map's highlight day (2026-07-04, the default) unless `?fireworks=0`; the show's clock is v1's (show s 0 at 21:44,
4 game s a show s, `showTimeAt`) only to place a page that opens (or a cut that lands) in the show's window. **A time
event (owner, 2026-11-15: "Fireworks is a time-based event independent of the boat and everything"):** on a live page
whose day clock runs, the show keeps its own clock (`sim/fireworks.js liveShowClock`): it starts when the day clock passes
21:44 and counts real seconds from there, so its 300 s play at real pace whatever the day clock's rate; nothing slows,
holds or lapses the day clock for it, and no hint or line is said. Captures and films keep `showClock` (from the hour
they opened at); `?fwt=` pins the show time (captures, the golden, the film). **Open world (owner, 2026-11-15; replaced the 2026-11-08 "boat close" staging):**
"fireworks on means fireworks on, the boat is independent". The show plays at its own launch site over the lake; in Sail
nothing moves the boat or the camera (no start at the viewing spot, no show framing: the player sails toward it and
drags the view up). In Cruise the autopilot keeps its route and only the camera turns toward the show
(`sim/showFrame.js`, the plug-in's `cruiseCamera`, main.js placeCamera): from the rig's own position, eased in over 2 s
from 2 s before the first riser, held, eased out over 2 s after the finale (300 s); its rate is bounded, so a cut of the
clock never snaps it; a drag or the binoculars (the player's look) let it go for the rest of that show; Above (the chart
view) does not turn; a capture is framed at once on its first frame (or under `?fwt`), a headless film eases on its fixed
steps. `stats().fireworks.showFrame` is the weight, `showYield` the player's take-over. Cruise keeps its own day clock
through the show (no pace hold since 2026-11-15: the show's own clock plays it in real time). The show is v1's game show (stage.js `wowShow` over `makeShow`: two scripts joined, the frame law, the
designer's spread; the tall layout on an upright screen), at v1's 2.2× scale.

**Reused as they are (three-free):** show.js, shells.js, physics.js (`fly`, `RISER_K`), stage.js, smoke.js, flash.js,
drawSpan.js, share.js, cruise.js (`SHOW_CENTRE`), sound.js and music.js (and audioFormat.js). **Copied** (three-bound in v1):
engine.js's TIERS and LOOK, world.js's `showTimeAt`. **Ported, the drawing only:**
- `sim/fireworks.js createShowState`: engine.js's CPU side line for line (the ring of slots, the shells written when their
  launch is 0.5 s off, the riser from the barge's deck, each burst's flash record and smoke puffs, the seek's replay window,
  the draw span) into one staging array (v1's seven vec4 a star, interleaved); the GPU gets the dirty slot ranges.
- `render/fireworks.js`: the stars in one storage buffer and the streaks in a history ring (9 points a star); v1's kernel in
  WGSL (`stepStars`: physics.js starStep, the kick, the history), one dispatch a frame over the slots still drawing (v1 ran
  all 65,536), inside the frame's `forest` compute pass (the graph's 10 passes are full); a seek clears the slots on the GPU
  and replays the last ≤ 26 s on v1's 1/60 s step (a `tick` dispatch advances a GPU clock between steps; a submit before
  each step that uploads a new shell, so a reused slot is never written before its earlier star ran). v1's star material
  vertex for vertex (the tapered ribbon with v1's long-exposure dwell, the round head and halo, glitter, strobe, the dying
  sputter and ember, the colour changers, the crossette's hidden passengers), additive into the HDR scene at screen levels
  / the exposure factor, its colours graded × 1.8 chroma (v1's FLASH_LOOK.sat, per star here). The streak is drawn through
  every other point of v1's 9 (`RIB_STEP`: the streaks were 80 % of the show's cost; the stills cannot tell them apart), a
  point under 0.002 screen levels with no width, and a dead star off screen (v1 drew their zero-colour quads).
- **The water:** the heads again, mirrored in the lake's plane (dimmed to 0.32, smeared 2× down the waves), each mirror's
  depth where its ray meets the water, so the boat and the land stand in front of it; and v1's "bursts in the waves" as
  glints: the bank's 4 brightest slots off the FFT surface's own slope cascades (a Beckmann lobe and Schlick, the sun
  glint's maths) on a plane 0.35 m over the mean surface, depth-tested so only water takes it.
- **The smoke:** v1's puffs (smoke.js) lit by the flash bank only, the bank's light at the quad's corners (v1: per pixel);
  v1's puffs cover each other in its fireworks target, v2 adds them into the scene, so only the brightest 16 lit ones are
  drawn (phones 8), each at 0.45, on quads 0.85 of the radius (the fill: v1's 160 full-size puffs cost ≈ 4 ms at 2560 × 1600).
- **The air's glow** round the bursts (v1's light.js `skyFlash`, through its soft cap; the bank's 4 brightest) on the sky
  only (a fullscreen triangle at the far plane).
- **The barges** (v1's barges.js as lit boxes, `bargeProps`): two 60 × 18 m deck barges with mortar racks, a shed and two
  containers, a pusher tug each, two patrol boats each on the 110 m zone; lit by the night sky, the sun and the bursts,
  through the air; drawn before the water (it covers their hulls). Their lamps (work lights dimmed 70 % once the show runs,
  the tugs' masthead and side lights, the patrols' blinking blue bars) as soft fixed-size points after dusk. Out on their
  spots 20:30–23:30 (v1's presence window).
- **Sound and music** (`audio/fireworks.js`): v1's sound.js and music.js on the least audio core (`attach`, `claimMusic`,
  `yieldMusic`: one AudioContext on the player's first gesture, a master and a music gain). Every shell heard at its time
  and place (the launch thump, the bang after its flight at 343 m/s, the echo, the finale's wall, the cheer), "Over The
  Clouds" as the echoes die (Sail's music). A capture and `?fwsound=0` have none. `vite.config.js` serves and ships
  `audio/fireworks/` (the banks and Sail's piece, Opus and AAC: 4.3 MB; Cruise's score and the radio stay out).

**Pipelines:** +9 on a show page (compute: tick, clear, step; render: stars, the reflection's stars, the reflection, smoke, glow, lamps, props), all built
before the first frame; none on another day or with `?fireworks=0`. `?layers=` without `fireworks` keeps the show's
clock (and Cruise's camera turn) but draws nothing (the budget's A/B); `__velia.fireworks.gpu.parts` (a Set of stars, reflect,
reflect-streaks, smoke, glow, lamps) toggles the parts on a live page, for an in-page A/B. `stats().fireworks`: the show time, the live and
drawn slots, the puffs, the dispatch. The tier is v1's: a phone (a coarse pointer) or `?touch=1` takes the phone tier
(32 k slots, no streaks, 8 puffs).

**What differs from v1 (since the v1-grade round, 2026-11-18, `feat/v2-fireworks-v1-grade`):** v1's post stage is ported
as its own pass after the scene (`fw-post`, `render/fireworks.js` POST, only while the show is up at night): the stars drawn
and the lit smoke into their own full-size target (tested by hand against the scene's depth), graded on the sum as v1's composite does (the
white-hot core, the soft shoulder, the vivid push); a bloom on the stars and the lit smoke (their quarter-size target, a dual
filter of 5 small passes, not three's BloomNode); the water's reflection on the water's own pixels found by the depth (v1's
streaks and its broad colour off a calmer normal; the fine ripples fade past about 100 m); the far land's silhouette and the
bursts' wash on the land and the boat (v1's FLASH_LOOK); the show's night (sky × 0.5, land × 0.25 while it is up). The post
copies the picture first (it reads the colour under it); the cost measured in-page (ABBA) is under 0.1 ms on the Mac. Still
different: the smoke is its brightest 32 lit puffs, added into the stars' target (graded with them; v1: all 160 in its own
target, covering each other); the glow
from the bank's brightest 4 slots; no far shows (South Lake, Tahoe City) on the horizon; no evening (the hints, the chart's mark, the time-lapse to 21:44), no spectators' sailboats or kayakers, no barges' tow
or solidity, no anchor light; the show runs in real time from the page's hour, not on v1's evening clock.

### Budgets (measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 2560 × 1600 backing, 60 frames, the GPU shared with other helpers' jobs; A/B by `?layers=` with and without `fireworks`, the same camera)
| Show time | Without (ms) | With (ms) | Fireworks (ms) | What is in the air |
|---|---|---|---|---|
| 100 s (the build) | 9.75 / 9.56 | 10.27 / 10.35 | **+0.53 / +0.79** | 4.4 k slots drawn, 2.2 k live, 16 puffs |
| 260 s (the finale's start) | 9.89 | 11.15 | **+1.26** | 9.5 k drawn, 5.9 k live |
| 288 s (the finale's densest second) | 6.51 / 10.63 / 7.34 | 7.75 / 11.83 / 8.93 | **+1.24 / +1.21 / +1.58** (one sample +3.9 under load) | 43.6 k drawn, 30.6 k live |
| outside the show (any other hour) | | | **0** (no dispatch, no draw) | |

The star step's dispatch (the `forest` pass) adds under 0.1 ms. The finale's densest second sits at the +1.5 ms line; the
rest of the show well under it. Phones (the phone tier on this Mac at 780 × 1688, `?touch=1`): +0.0 ms at 100 s, +0.4 ms
at 288 s. Measured before the cuts (all streak points, 32 then 160 puffs, the mirror's streaks): +2.9 ms at 288 s.
## The night and the storm (M5e, 2026-11-13: render/night.js, night-read.js, storm.js, shaders.js; sim/moon.js, night.js, storm.js)

**The night is v1's photographer's night** (owner 2026-11-07: "a photographer's lens, not the naked eye";
`src/core/milkyway.js`): not the dark-adapted eye, a long exposure. Three things make it:
- **The exposure adapts on** (`sim/exposure.js nightGain`): v2's dusk gain stopped at 5 × at the horizon, and under
  that the LUT sky is black past the sun's −8° (the whole air stands in the planet's shadow); v1's exposure rises to 362 ×
  its base by −12°. v2's now multiplies the whole factor by up to `NIGHT_GAIN` 24 along `NIGHT_KNOTS` (look/v2-night-look,
  2026-11-15: from the sun's +3.5° to −5.8°, log-linear between knots measured on the follow camera, so the frame holds
  22–37 / 255 from 19:30 to 23:00; it was × 12 between −2° and −14°, and 20:30–21:15 fell to 0.4 / 255 while the LUT sky
  went black past −8°; monotone, at most 1.055 × per 0.1° of sun), and comes down by 1 + the moon's share under a moon (a
  photographer exposes a moonlit night down; its sky still comes out brighter). The airglow (`NIGHT.airFade`) comes in from
  the sunset to −8°.
- **The night sky's own light** (`render/sky.js NIGHT_SKY_WGSL`, the same text in every sky reader: SKY_READ, the aerial
  pass, the clouds' key, the water's mirror bake): v1's airglow (a layer 90 km up along the van Rhijn slant path, its √ as the
  brightness: 1 at the zenith, 2.45 at the horizon; deep blue at the zenith, blue-green low down: `NIGHT.airColour`,
  `airHorizon`), in from the sun's −4° and full by −12° (v1's −10° / −18° left v2 black at 21:36, where v1's residual
  twilight still showed under its exposure), × (1 + 2.5 × the moon's share); v1's light domes over South Lake Tahoe, Reno
  and Tahoe City by true bearing and height (`src/core/milkyway-math.js LIGHT_DOMES`); a soft glow round the moon. It is
  `nightSky(d)`, so **everything the old flat floor fed now takes the airglow:** the sky, the aerial froxels and the frame's
  light record (the terrain, the forest, the boulders, the water's body and foam, the boat's ambient), the clouds' key
  (grey-blue against the band, never black) and the water's mirror of the land. HDR level `NIGHT.airglow` 9e-3 at the
  zenith (a noon zenith is 1): under the night exposure the zenith reads deep blue, the water the sky's blue, the boat's cream
  deck lit, the forested ridges dark against a lighter sky; the old `F.sky.y` floor is 0.
- **The point sources** (render/night.js): the **stars**, v1's catalogue (`@takram`'s `stars.bin`: the Yale Bright Star
  Catalog's 9,096 stars, J2000 directions, magnitudes, black-body colours; copied to `v2/assets/night/`, ATTRIBUTION.md), one
  instanced draw of pin-points (feat/v2-sky-v1-grade: a small gaussian, sigma `NIGHT.starPx` 0.55 px up to `NIGHT.starPxMax` 1.0 px for the brightest, the light kept) placed in the vertex stage through the hour's J2000 → world rotation (`sim/moon.js
  skyMatrix`: the sidereal time and the latitude), 10^(−0.4 m) × `NIGHT.starScale`, the air's transmittance along the
  direction (the LUT: they fade into the horizon's haze), the clouds' transmittance from the key, v1's twinkle (a seeded sum
  of two sines on the scene clock, more near the horizon, a touch of colour), additive at the far plane; the **Milky Way**,
  v1's maps (NASA SVS's log-encoded luminance, `data/sky/milkyway-4k.webp` as r8unorm since feat/v2-sky-v1-grade (v1's desktop map), and its tint; served from the repo's data/sky in
  dev, copied into dist-v2 in a build) sampled in J2000 in the sky draw and once per ray in the water's mirror (`milkyWay(d)`
  in night-read.js: v1's decode, contrast 1.25, the blue-violet outer band, saturation 0.7; its x = 1 at `NIGHT.band` 11 × `NIGHT.bandShow` 0.11 ×
  the zenith airglow: about 15 × the shown sky, v1's ratio), under the air's transmittance; the **moon's disc** (`MOON_WGSL` in the sky draw): a sphere of 0.26°
  lit by the sun (the phase comes out of the geometry: the near side's normal against the sun's direction, an earthshine
  floor), at v1's real ratio to the sun's disc (`NIGHT.moonDisc` 0.4 HDR: white at night, a pale disc by day), dimmed by the
  air, sealed by the clouds like the sun's disc; its place and lit fraction from a compact Meeus ephemeris (`sim/moon.js`:
  the leading lunar terms, the Sun's low-precision longitude, GMST, the topocentric parallax; the test holds it within 1° of
  astronomy-engine's topocentric altitude and azimuth across the map's day, its nights and a year of first-of-month nights,
  the lit fraction within 0.02; astronomy-engine itself stays out of the bundle: 330 kB for two directions). The band, the
  stars and the domes fade in with v1's `nightFade` (−10° → −18°) and dim under the moon (v1's `moonDim`: a full moon high
  leaves 10 %).
- **The lights** (render/night.js, the `night-glows` pipeline): camera-facing soft quads from a storage list, a least size of
  3 px on screen and a far light's energy spread over it (so a window at 15 km is a faint warm point, not a 3 px lamp);
  additive, depth-tested against the world. **The towns:** v1's own layout (`src/towns-layout.js` on the full terrain set and
  the shared projection: the houses' warm windows, the shops' and hotels' LED and white, the high-rise crowns, the street
  lights, the lots, the pier heads, 24,866 in all, each with v1's switch-on sun elevation), packed once by
  `tools/v2-lights-pack.mjs` (298 kB) and streamed after the first frame; each switches on across ±1° of its own elevation
  in the vertex stage. **The boat's nav lights** (v1's `src/boat/details.js`, pure): the green and red sidelights on the bow
  pulpit and the white sternlight (`DEFAULT_DIMS.HULL.navBow`, `navStern`, carried by the pose as render/boat.js carries the
  hull), lit from sunset (COLREGs rule 20: the sun's −0.83°), their sector cut-offs toward the eye (112.5° arcs, the stern's
  135°) and the vertical fall-off, written each frame (3 records, one writeBuffer). **They light the boat** (fix/v2-boat-kayak-light,
  2026-11-18; render/boat.js `NAV_LIGHT`, `navLightsInto`): the lenses ride in the boat's Shadow record (`nav[4]`: bow, stern,
  anchor, the hull's forward), each an inverse square to 6 m in its own COLREGs sector (the bow's red to port, green to
  starboard, the stern's white astern, the anchor light all round, alone at anchor), k 0.12 at 1 m. **The boat's night light
  is the world's** (`BOAT_LIGHT`, `BOAT_LIGHT_WGSL`, shared by the hull, the cloth, v1's models, the cockpit, the gear and
  the kayaks): over the land's fade (`LAND_SKY.nightDeg`, −6° to +2°) the side face's horizon band and the cloth's v1 lift
  (`CLOTH_AMB`) go, and the night is the level sky by the tilt plus NIGHT_LAND × 0.5 (`BOAT_LIGHT.night`), its moonlit share
  from the moon's side (0.35 wrap + 1.3 cos); the reflections mirror the sky as the water does (`skyRadianceMirror`, the
  airglow at `NIGHT.airMirror`). Before, the sail took 2.3 × the hull's light and the gelcoat mirrored the whole airglow
  (sail 177, water 45 at v1's night pose; v1 97 and 28). **The cabin** keeps v1's red night light
  (`src/boat/nightLight.js NIGHT_FACE.cabin`: 5 % of the day's level on screen, so its value is divided by the exposure
  factor), and the instruments' faces go to v1's night set as M4 built them (`nightK`). **The UI's night palette:** v1's
  `createTheme` (`src/ui/theme.js`) now runs in v2/ui/sail.js on the frame's sun elevation (night under −1°, day back over
  +1°), so `data-lk-theme=night` sets the DOM's red set and the cockpit rig's night ink.
- **The front door** (v2/ui/front.js): Setup's Weather row works on the Weather menu's state (Clear | Fair | Storm, the same as
  the top bar's). (The staged first visit's storm beat went with the stage, owner 2026-11-13.)
- **Streaming:** the maps, the catalogue and the lights (≈ 1.1 MB) load after the first frame once the sun is under +8°
  (`NIGHT.loadBelowDeg`; a capture: before it); every texture and buffer is made at load at its full size or cap, so nothing
  is created later and the record's `band` stays 0 until the maps are in. `?night=0` is the old black night (the A/B).

**The storm is v1's** (`src/sim/weather/stormSim.js` runs the arc, the strikes, the outflow on the one wind field and the
rainbow's amount; `src/sim/weather/weatherMenu.js` the Weather menu), wrapped for v2's clock, eye and sun in
`sim/storm.js`; what v2 ports is the drawing (v1's `src/weather/storm.js`, `rain.js`, `lightning.js`, `uniforms.js`,
`rainbow.js`, three-bound), through the shared uniform's five storm rows (uniforms.js `storm`, `rain`, `cell`, `front`,
`bow`; the Frame block grows to 512 B: one slot of two 256 B alignments) and the shaders that read them:
- **The clouds** (render/clouds.js, the key march): the cell was wired in M5a (the coverage, the slab's height, the sky light's
  shade); M5e adds v1's tower hooks inside it: the type toward towers (the whole slab's height), a flat thunderhead base,
  the coverage held at 0.82 (hard sunlit edges), the density × (1 + 1.6 m) (dark bases) and the sky light's floor (no black
  voids). The cell builds out west as a bright tower over the crest (`?cloudcov=0&stormt=90&camyaw=280` shows it alone) and
  darkens the sky as it comes overhead, all through the amortised key (a whole key a second: the arc moves over minutes).
- **The light:** the cell's shade of the sun at the eye (v1's `shadowAt`, in JS for one point a frame: the eye projected
  along the sun up to the dark base, the cell's mask there with its stretched trailing side, the clearing's gaps from a value
  noise carried with the drift) is `F.storm.y`; it multiplies the frame's sun irradiance (the aerial pass's light record:
  the terrain, the forest, the boulders), `sunRadiance()` and `sunIrradiance()` (the sky's disc), the boat's `sunPerp()` and
  the water's glint. The haze (v1: the fog's density × (1 + 22 × haze), steel grey; #18 round 2 replaced this with v1's height fog itself, § The storm's water, deck, haze and rain) was extra Mie in the two air marches that
  have the frame (the sky view and the aerial froxels: `mediumHaze`, ≈ 0.36 /km at the lake in the rain, decaying over 0.8 km
  of height; the LUT bakes have no frame), so the far shore goes grey and the sky's horizon with it.
- **The water** (render/water.js, its own block): v1's rain rings near the eye (each 0.6 and 0.75 m cell a drop every ≈ 0.9 s,
  an expanding ring in the slope, only where a ring spans many pixels), the far matte hiss and the outflow's ragged band
  (stormWind.js's edge) in the roughness, the grey lid on the mirror (the sky's LUT and the key are the fair sky's; the dark
  base is overhead), the shaded glint. **The sea rises with the outflow:** the wind field's own storm modifier at the eye
  (`stormWindFrameInto`: the lull ahead, × 1.55 on the line, × 1.45 gusty behind, veered toward 250°) is applied to the
  boat's wind before it reaches the composed sea (main's `seaNow` → `water.setWind`, 2026-11-13: v1's two sims' tables rebuilt
  only when the rounded wind moves 0.5 m/s, the cheap re-composition between), and the storm-raised speed goes to `F.wind.x`
  for the foam and the glint's floor; the boat feels the same outflow through the field's `sample()` (v1's wiring:
  `wind.setStorm`). (The first round's amplitude gain, `setGainMul`, went with the old h0 path in the merge.)
- **The rain** (render/storm.js `storm-rain`): v1's maths one for one: 16,000 drops (4,000 under 0.6 Mpx, v1's Low tier) hashed
  into a 44 × 30 × 44 m box that wraps round the camera, falling at 9 m/s and drifting with the wind at the camera, each a
  camera-facing streak ≈ 0.6 m long in depth layers (the near ones longer, wider and fainter), none inside 1 m, gone by the
  box's edge, the drawn count the rain's share; grey at an overcast sky's level (v1's hand-set light: as bright as a sunlit
  white), blended, depth-tested, after the sky.
- **The lightning** (render/storm.js `storm-bolt`): v1's channel (`boltPaths`, copied into sim/storm.js: midpoint
  displacement from the cloud base to the ground, branches from a third of the joints, the strike's own seed) as camera-facing
  ribbons rewritten on a new strike (one writeBuffer, ≤ 2,400 vertices), drawn twice: a 170 m soft glow and a 16 m core at
  60 × a sunlit white (the tonemap rolls it to white), additive, its brightness the strike's flash. **The flash** lights the
  whole scene in the composite's grade; its lift is held at the daytime screen level through v1's `flashAdd` (the flash
  scaled by the exposure's ratio to its base), so a night flash lights the scene instead of whiting it out. **The thunder:**
  v1's synthesis (`src/weather/stormAudio.js createThunder`: the crack, the roll, the bay's echoes, in a worker) on the
  page's AudioContext (engine/audio.js: made in the first pointer or key; a capture is silent), each new strike played at its
  distance's delay (343 m/s).
- **The grade and the rainbow** (render/shaders.js TONEMAP, before the exposure): v1's post grade: the rainbow where the
  scene lies past ≈ 900 m (the scene's own depth, one load a pixel; the multisampled depth target is now sampled): the
  primary bow 40.7–42.4° from the antisolar point, the faint secondary at 50.2–53.5° with its colours reversed, the light
  inside the primary, Alexander's dark band between, only toward the departing rain and above the horizon
  (`RAINBOW_WGSL`); the storm's steel (flattened toward its luminance, cooler, darker), a vignette that closes in, the
  clearing's warm lift and a little more colour, the flash's blue-white. Off at `F.storm.x` = 0: the fair pixels are the
  same.

**What differs from v1 (on purpose):** the cell's shade of the sun is one number a frame at the eye, not per pixel (the
cell is 2–4 km wide; the crepuscular patches on the water are not here; v1's shelf cloud and curtains are not ported: #18
round 2 dropped them, § The storm's water, deck, haze and rain); the arc runs on the scene clock (since main's parity merge of 2026-11-13 Sail's clock runs at 2 ×
as v1's, so the arc does too; a capture's frozen clock steps it 1/120 s a frame); the rainbow sits in the composite as
v1's, so it stands over the clouds and the far water alike; v1's `NIGHT_LAND` lift and the long-exposure twilight of the
fireworks evening are not ported (the airglow lights the land through the light record instead). The look was set against
v1's night and storm goldens by eye in v2's HDR scale, not by v1's cd/m² numbers.


### Brighter night and storm (owner, 2026-11-13, after the first stacks: "brighten night and storm")
**What v1 does by night** (read for this round): its exposure rises from 6 to 2172 (× 362) by the sun's −12°
(`src/sim/timeOfDay.js exposureAt`, 0.7 of the lost stops given back); the hand-set colours (the terrain's, the trees',
the snow's) never fall under `NIGHT_LIGHT_FLOOR` 5e-4 (`src/core/milkyway-math.js`: ≈ 0.18 of their daylight level on
screen under that exposure); the land gets `NIGHT_LAND` (`src/core/night.js`, round 5: the albedo × a cool (0.62, 0.72, 0.9)
light × a slope term, as the terrain's emissive; the trees half of it); a hemisphere night light (`NIGHT_LIGHT`, 1e-3 ×
the exposure) lights the boat, the shore and the water's body; the airglow at 0.065 of the band's unit (× 1 + 4 × the
moon's share); and AgX's tone curve lifts the shadows where ACES keeps them dark. **Ported as local terms, no grade:**
- the airglow up to `NIGHT.airglow` 1.4e-2 (from 9e-3): the sky, the far water and the clouds;
- v1's NIGHT_LAND as `nightLand()` (render/sky.js SKY_READ: `NIGHT.landLift` 0.075 × (0.62, 0.72, 0.9) × the night's
  level), an irradiance added to the sky's on the terrain, the boulders, the forest (0.37 + 0.18 n.y of it: the tree line
  stays a silhouette), the lake's body (× 0.3, `NIGHT_WATER.body` in render/water.js, and its sky light × `NIGHT_WATER.sky`
  0.3 by night, with v1's night Fresnel floor 0.15) and the bed through the column (once, with the land's: look/v2-night-look
  removed its extra × 3.5 and fades the shelf's emerald tint by night; the bed's light × `NIGHT.bedLight` 0.5 by night: the
  shallows had glowed teal, the water 4.5 × the land at 22:00);
- the airglow's three shares (look/v2-night-look, 2026-11-15): the sky as drawn and as the water mirrors it takes
  `NIGHT.airSky` 0.08 through the air's transmittance since feat/v2-sky-v1-grade (was 0.06 without it) (`skyRadianceShown`: v1's dark zenith, so the band and the stars read; the zenith 92 → 30 / 255 at
  22:30), the light it casts on the world and on the mirrored land `NIGHT.airLight` 0.7, the clouds' own top light
  `NIGHT.cloudAir` 0.12 and their sky light × `NIGHT.cloudNight` 0.2 by night (grey-blue, not lit white; 0.2 and 0.3 before
  feat/v2-night-clouds);
- the night deck toward v1's (feat/v2-night-clouds, owner 2026-11-18): the air between the eye and the deck takes the
  airglow at `NIGHT.cloudHaze` 0.08 (the drawn sky's share; the whole glow made the far deck glow blue over the clear sky),
  the moon's glow whole, the town domes at `NIGHT.cloudDomes` 0.3 at the cloud's own height (render/clouds.js `cloudHazeSky`;
  fix/v2-fireworks-view-clouds: whole and at the horizon's height before, the far deck over the towns read orange); the clear
  night (owner 2026-11-18): under Clear and Fair the deck's coverage goes to `NIGHT_CLEAR.cover` −0.4 (no cloud) from the sun
  at 0° to −5°, and in the fireworks show (`nightCover`, v2/sim/night.js; a storm, Cloudy and `?cloudcov` keep theirs); once the sun is under −4° the deck's light is
  the moon's (`MOON_DECK`: the night land light × moonSky × `NIGHT.cloudMoon` 0.06 × moonShare); the water mirrors the
  night deck at `NIGHT.deckMirror` 4 × its light (render/water.js, as airMirror over airSky for the clear sky);
  the crowns and the far canopy take `NIGHT.treeNight` 0.75 of their light by night (render/forest.js, terrain.js): the
  tree line a silhouette against the darker sky (terrainShadow: luma ≤ 0.7 × the sky's);
- the night's water (look/v2-night-look): the moon's glitter path (`MOON_GLINT` in render/water.js: the glint's lobe off the
  moon, each facet cell on its own clock, only with the moon up), and the town and nav lights' images in the water
  (`GLOW_REFLECT` in render/night.js: a soft column under each light's mirror image, broken by drifting ripples);
- the exposure's night gain: × 24 (look/v2-night-look; × 12 before).

**What v1 does in the storm:** the same post grade (steel, vignette, flash, gold) over a sky whose deck keeps lit
undersides (its `skyFloor` 0.3 × cover, `sunFloor`), a uniform steel-grey fog (its density × (1 + 22 × haze), colour 0.62
of the sunlit level: the slopes go into mist), and rain streaks as bright as a sunlit white. **Ported:** the key's
undersides take more of the sky's light in the rain (`ambBot` 0.33 → 0.93 × ambTop at full rain) and the cell takes less
of it (0.15); the haze was 360 × Mie at the lake (#18 round 2: v1's height fog now) over 1.6 km of height, lit by the sky's mean radiance (v1's fog colour),
not only by the shaded sun; the rain's streaks at 3.4 × the overcast level (v1's level on screen), 1.5 × wider (v2 has no
post anti-aliasing to spread a sub-pixel line) and 1.8 × the alpha. (#18 round 2 put the rain, the haze and the deck's light back on v1's
numbers, below.)

**Pixel samples at v1's golden poses** (region means, sRGB 0–255; `v2/golden/*.png` after this round vs `golden/*.png`):

| night, 21:36 | v1 | v2 before | v2 now |
|---|---|---|---|
| sky, top centre | (10, 19, 33) | (1, 3, 3) | (9, 16, 13)* |
| snow ridge, top left | (6, 13, 22) | (1, 2, 4) | (9, 14, 17) |
| mountain, left | (8, 16, 26) | (2, 3, 4) | (11, 18, 18) |
| forest, right | (2, 6, 4) | (1, 2, 3) | (5, 11, 11) |
| water, far | (16, 36, 73) | (11, 23, 44) | (21, 42, 87) |
| water, near | (6, 28, 73) | (3, 5, 16) | (6, 14, 63) |
| water, right | (2, 15, 40) | (6, 15, 34) | (4, 21, 77) |
| sail | (52, 67, 89) | (61, 76, 93) | (89, 107, 134) |

\* v2's framing puts the ridge where v1's frame shows sky at the top centre; the open sky in v2's frame reads (25, 40,
70)-class in the `v2-night-sky` golden. The land is at v1's level or a little over and greyer (v2's photo albedo under the
cool light; v1's is bluer); the water at v1's level (the right water over it); the sail 1.7 × v1's. (The "now" column is the blessed golden on main's
parity sea of 2026-11-13.)

| storm, 150 s | v1 | v2 before | v2 now |
|---|---|---|---|
| sky, top | (117, 125, 134) | (105, 106, 110) | (112, 114, 119) |
| cloud band | (130, 136, 144) | (89, 90, 95) | (97, 100, 105) |
| far shore (the mist) | (85, 92, 99) | (27, 30, 37) | (62, 69, 84) |
| water, left | (9, 19, 36) | (24, 25, 27) | (33, 36, 42) |
| water, right | (7, 18, 35) | (2, 3, 4) | (14, 17, 23) |
| rain streak peak | 164 | 66 | 144 |

The deck's undersides stay under v1's (101 vs 136): the lever left is M5a's own underside light (`ambBot` 0.33 of the top,
owner-approved by day), not a storm term. The water read grey where v1's keeps navy: fixed in #18 (below; these samples
are at 150 s, where the hero bolt at 150.27 s flashes the frame).

### The storm's water, deck, haze and rain (#18, 2026-11-14: render/water.js, clouds.js, sky.js, storm.js; sim/clouds.js)

v1 against v2 at four storm poses, measured (`tools/v2-storm.mjs`: each pose in both apps, 147 s into the arc, between two
strikes: the hero bolt at 150.27 s flashes every v2 frame of the 150 s pose). Round 1 (sealed glint, v1's storm cloud hooks, a
storm light gain, a shelf cloud and rain curtains in the key) was rejected by the owner (2026-11-14): "the v2 storm and rain are
not like v1 at all, very fake": a dense uniform field of white streaks, a hard bright band at the horizon (the sunlit curtains),
a blotchy bright-and-black deck, the shore a flat black silhouette. Round 2 ports v1's recipes as they are:

- **The water** (round 1, kept): why it read grey, by switching its terms off one at a time at the follow camera: the glint 11
  levels (never sealed by the deck), the rain's haze 8 (M5e's extra Mie, lit by the fair sky and the sun's forward lobe), the
  rain's roughness 5, the mirror 2; under them the body had lost the sun to the cell's shade (0.08) and the steel grade takes half
  of what is left and 70 % of its colour. The glint × the key's transmittance toward the sun under v1's `cloudSeal`, read at
  least 15° up (v1's low-sun rule); the sky draw seals the sun's disc the same way; the body's sky light × 45 at the storm's
  full dark (`STORM_WATER.body`: the overcast's light and v1's camera; refitted after the haze changed).
- **The rain** (render/storm.js): v1's `src/weather/rain.js` numbers exactly: 16,000 drops (4,000 on the phone path, v1's Low)
  in the 44 × 30 × 44 m box, 9 m/s with the wind's slant at the camera, streaks 0.45–1 m, width max(0.0009 × d, 0.0035) m +
  0.008 near, alpha 0.24 far to 0.09 near × 0.6–1 × (0.5 + rain / 2), none inside 1 m, gone by 21 m; the colour v1's hand-set
  light (the tint × 1.6 × a sunlit white × the daylight × (1 − 0.4 × dark)). M5e's round had them 1.5 × wider, 2 × the alpha and
  3.4 × an overcast sky's light. v1's rings and hiss on the water were already v1's.
- **The haze and the horizon** (render/sky.js `stormFog`, in every surface's aerial read): v1's valley mist under the storm,
  an exponential height fog A·exp(−y / 20 m) integrated along the view ray, A = FOG_A × 0.35 (v1's far look) × 22 × haze (the
  storm's share of v1's FOG_A × 0.35 × (1 + 22 × haze)); its colour v1's mist by the sun's height × 2, moved 0.85 × haze toward
  the steel grey (0.62 of a sunlit white × (0.86, 0.92, 1)), no phase. It replaces M5e's 360 × Mie haze (dropped from the sky
  view and the froxels, and with it the dusk glare round the low sun). The far water and the hills' foot now fade into a grey
  haze; the shore no longer a flat black silhouette.
- **The deck:** v1's storm hooks kept (the trailing cell and the anvil, `lightThickness`, `sunFloor`, `skyFloor`, the billowy
  erosion; M5e's 0.8 floor only in the rain), and v1's camera (`cloudLightMatch`: sun × 1.4, sky × 10 at chroma 0.5) now holds in
  the storm too, where it faded out (round 1's own 2.5 × storm gain is gone): cam L under the anvil reads 109, 120, 142 against
  v1's 109, 125, 142. **The shelf cloud and the rain curtains are dropped**: in the key they read as a hard, bright band; v1's
  are barely visible in its own frames. None is better than fake ones.

**Samples** (sRGB medians, 1280 × 720, 147 s; water: open water clear of the boat; undersides: the darkest quarter of the deck's
mask, tools/cloud-colour-measure.mjs; sky: the top band; streaks: a fixed crop of open water left of the boat, x 4–34 %, y 45–95 %,
a streak pixel > 8 levels over its 15 × 15 mean, a streak 4 or more connected such pixels; the excess histogram in % of the crop):

| pose | region | v1 | v2 before | v2 r2 |
|---|---|---|---|---|
| follow | water | 5, 8, 17 | 17, 19, 23 | 9, 10, 24 |
| follow | cloud undersides | 74, 85, 96 | 61, 64, 68 | 53, 58, 69 |
| follow | sky | 110, 116, 125 | 91, 93, 98 | 90, 94, 105 |
| follow | streaks: count / % px / peak | 186 / 2.35 / 143 | 416 / 9.21 / 113 | 114 / 1.23 / 82 |
| follow | streak excess 8–16 / 16–32 / 32–64 / 64–128 / 128+ (% px) | 1.07 / 0.59 / 0.3 / 0.4 / 0 | 4.14 / 3.11 / 1.72 / 0.24 / 0 | 0.86 / 0.35 / 0.01 / 0 / 0 |
| camE | water | 17, 25, 34 | 27, 32, 42 | 37, 41, 46 |
| camE | cloud undersides | 63, 74, 86 | 45, 48, 55 | 43, 48, 60 |
| camE | sky | 69, 80, 92 | 36, 39, 45 | 49, 55, 68 |
| camE | streaks: count / % px / peak | 120 / 5.33 / 167 | 173 / 7.09 / 131 | 306 / 7.97 / 185 |
| camE | streak excess 8–16 / 16–32 / 32–64 / 64–128 / 128+ (% px) | 2.46 / 1.86 / 0.99 / 0.02 / 0 | 3.31 / 2.27 / 1.44 / 0.07 / 0 | 3.01 / 2.47 / 1.95 / 0.54 / 0 |
| dusk | water | 5, 7, 13 | 149, 136, 131 | 7, 9, 27 |
| dusk | cloud undersides | 83, 81, 85 | 70, 63, 62 | 25, 26, 28 |
| dusk | sky | 132, 126, 128 | 129, 119, 117 | 102, 98, 102 |
| dusk | streaks: count / % px / peak | 1101 / 15.07 / 122 | 639 / 30.67 / 239 | 57 / 0.42 / 54 |
| dusk | streak excess 8–16 / 16–32 / 32–64 / 64–128 / 128+ (% px) | 9.35 / 4.78 / 0.54 / 0.4 / 0.01 | 13.89 / 12.18 / 4.21 / 0.39 / 0 | 0.38 / 0.03 / 0 / 0 / 0 |
| cellL | water | 3, 10, 29 | 28, 32, 52 | 18, 25, 77 |
| cellL | cloud undersides | 109, 125, 142 | 147, 145, 145 | 109, 120, 142 |
| cellL | sky | 116, 129, 146 | 156, 154, 154 | 113, 123, 144 |
| cellL | streaks: count / % px / peak | 698 / 21.82 / 173 | 489 / 16.26 / 226 | 510 / 11.61 / 217 |
| cellL | streak excess 8–16 / 16–32 / 32–64 / 64–128 / 128+ (% px) | 11.98 / 8.88 / 0.94 / 0.03 / 0 | 11.03 / 4.06 / 0.91 / 0.25 / 0 | 8.14 / 2.3 / 1.16 / 0.01 / 0 |

What still differs:
- **v1's long bright streaks in its follow and dusk frames are not rain:** they are v1's beginners' wind lines, thin strokes in
  the air near the boat (`src/sim/air.js` LINES; `?windlines`, on by default in a capture, off on a live page since 2026-10-30).
  v2 has no wind lines. (Round 2 took them for v1's spume; § The spume shows v1's spume adds nothing at this pose: the wind
  there is under 12 m/s in both apps.) With `windlines=0`, v1's crop holds 193 streaks at 1.45 % with its 64–128 bin at 0.02 %.
- **Cam E's water** reads 37, 41, 46 against 17, 25, 34: the storm fog over the bay's shallows; v1's teal shallows show through
  its mist. **Cam L's water** is bluer (18, 25, 77 against 3, 10, 29): the near water mirrors the band under the anvil at a
  grazing Fresnel.
- **The deck by the follow camera and cam E** stays under v1's (undersides 53, 58, 69 against 74, 85, 96; 43, 48, 60 against 63,
  74, 86) with v2's darker sky in the gaps (the camera difference noted in § The clouds' colour); at dusk the undersides are 25
  against 83. The deck's soft streaks and v1's cloud wrapping the hills (its per-pixel march reaches the ridges) are not in the key.

The lock: `v2/tests/pages/stormWater.page.mjs` (the follow camera's storm water within 10 levels a channel of v1's, blue over red
by more than 6; main's water, 17, 19, 23, fails it). Stacks (v1 / v2 before / v2 r2, 960 wide): `renders/v2-storm/follow-r2.png`,
`camE-r2.png`, `dusk-r2.png`, `cellL-r2.png`; v1 | v2 rain clips (10 s, 1280 × 360, H.264): `renders/v2-storm/rain-follow-v1-v2-r2.mp4`,
`rain-helm-v1-v2-r2.mp4` (`tools/v2-storm-film.mjs`). Round 1's stacks stay beside them (`follow.png` …).

**Budgets** (2026-11-14 afternoon, the M5 Pro Mac, headless Chrome, `tools/v2-perf.mjs`: main at b2db5dc2 served beside this
branch, interleaved ABBA, 5 rounds × 240 frames, per-pass medians; the storm pose is the golden's). No new pass, no new pipeline,
nothing per frame: the fog is a few ALU in each surface's aerial read, behind a uniform branch; the curtains' march is gone.

| Frame | cloud-key | aerial | scene | composite | total (median of rounds) |
|---|---|---|---|---|---|
| 2560 × 1600, storm, main / branch | 0.184 / 0.182 | 0.196 / 0.195 | 4.181 / 4.230 (+0.05) | 0.137 / 0.125 | 10.12 / 10.06 |
| 390 × 844 with the hands (phone set), storm | 0.107 / 0.088 | 0.149 / 0.127 | 0.934 / 0.618 (the thinner rain) | 0.015 / 0.011 | 3.00 / 2.40 |
| 2560 × 1600, no storm (13:00, the follow camera): idle | 0.157 / 0.164 | 0.163 / 0.164 | 4.902 / 5.025 (rounds 10.8–15.0 / 10.8–13.6: noise) | 0.134 / 0.132 | 11.38 / 11.85 |
| 390 × 844 with the hands, no storm: idle | 0.088 / 0.093 | 0.142 / 0.139 | 0.886 / 0.890 | 0.009 / 0.008 | 3.14 / 3.02 |

Every pass stays inside +0.3 ms at 2560 × 1600 and +0.4 ms on the phone path; with no storm the new code is skipped on
`F.storm.x` and the frame is the same within the rounds' noise (the 23 fair goldens are 0 px).

### One wind and a look per weather (2026-11-24: sim/weatherWind.js, sim/weatherLook.js, render/weatherLook.js, render/storm.js, render/clouds.js)
The storm read flat and nearly grey; the owner asked for one wind driving the whole storm and a look per weather.
- **One wind** (`sim/weatherWind.js`): read once a frame at the eye from the shared field (the outflow is the field's own 'flow'
  modifier), after the storm's step. The rain drifts with it, a gust leaning it more (the wind over its 8 s mean × 1.6 extra,
  capped at × 2); the streaks lie along the drop's motion past the camera. The deck's drift is integrated on the scene clock
  (it was the wind's speed × t, so any change of speed slid the whole deck); on a time cut it is re-placed at speed × t, so a
  steady wind draws the same deck as before. Aloft, a storm's steering flow (250°, 14 m/s) takes the deck by the front's
  envelope, so the deck and the cells move together. `ww.eye` and `ww.at(x, z)` are the gulls' getter (`hook.weatherWind`,
  the plug-in context's `weatherWind`). The cells' track itself stays the arc's 70° (stormArc.js DIR, also baked into
  render/water.js and v1's code): re-steering it to the day's wind is a follow-up once the water work merges.
- **A look per weather** (`sim/weatherLook.js` WEATHER_LOOKS): clear, fair (the identity: the composite skips the grade),
  overcast, storm, rain, clearing; weights from the deck's chosen coverage and the storm's dark, rain and gold, eased over
  2.5 s on the scene clock (snapped on a cut). The grade runs after the exposure in the composite: stops (in the grade, since
  the storm's mist and rain are divided by the exposure), the ASC CDL about mid grey, saturation, split-tone, a warm rim
  toward the sun scaled by the cell's shade, a graduated filter (a heavy sky, darker water, a bright horizon band), the cos^4
  vignette; `haze` scales the storm's mist. It replaces the old steel (70 % desaturation, −1 stop) and the clearing's warmth;
  the flash and the rainbow stay. `?wlook=<row>|off` pins a row.
- **Rain on the lens** (`render/weatherLook.js`, ported from web-ocean-3d's LensRain, MIT): two screen-space lattices of drops
  (runners and beads), each refracting the frame through its cap, in the storm composites only, one extra texel read a pixel,
  no blur. The glass wets in 1.1 s and dries over 7.5 s; the drops run downwind across the screen with the air past the lens;
  a lens looking downwind takes 30 %. On the follow and chase cameras; none in the helm view (the skipper's eye is not a lens:
  drops on it read as a broken screen), under the water, or under Reduced Motion. Policy row `lensRain` (off on a phone,
  which has no storm); `?lensrain=0` the A/B.
- **Cost** (2560 × 1600, M5 Pro, headless, ABBA against main, load 5.6–5.9): the composite +0.07 ms for the grade, +0.21 ms
  more for the lens in the rain (0.16 → 0.44 ms); Clear +0.08 ms; Fair unchanged within the noise.

### The spume (2026-11-14: render/spume.js, render/water.js; owner: "port it. It's a wind effect, so it shows in any strong wind, storm or fair")
v1's recipe (`src/wind-cues.js` whitecapAt, its numbers in `src/sim/windCues.js`), unchanged:
`spume = smoothstep(12, 17, U) × max(lane, 0) × smoothstep(0.3, 0.8, breaking) × 0.6`, added to the whitecaps' foam and clamped
to 1. v1's spume is not a separate streak mesh: it is the folding crests' foam made heavier along the wind lanes, so the caps
string out downwind once the wind passes 12 m/s (23 kn), fully by 17 m/s (33 kn).
- **The lanes** (v1's `streakAt`): two octaves of MaterialX 2-D Perlin noise (ported bit for bit to WGSL: `spNoise`), stretched
  along the wind, 2.2 m across × 30 m along and a finer set at half that; the coordinates warped by a 70 m noise (± 6 m) so a
  lane meanders; drifting downwind at 3 % of the wind (in the meander's frame), re-forming over ≈ 20 s; gated in from 3 to
  8 m/s; relative to v1's bay centre (700, −600). v1 draws them into its look map; v2 evaluates the same function per pixel, only
  where the spume can show, with v1's look map's reach (a 256 m square round a point 77 m ahead of the camera, faded from 78 to
  96 % of its half side) and v1's `laneVisibility` (the footprint dist × the pixel's angle / √vy from 0.3 to 0.9 m; grazing views
  under vy 0.025–0.09). The lanes run along `F.wind.y` (the waves' travel).
- **The breaking measure** is v1's Ultra one: the folds' sum J = Σ mix(1, J_c, damp_c) − 2 over the first three cascades (the
  same J the whitecaps read, summed as v1 sums it), breaking = 1 − smoothstep(J0 − 0.06, J0, J) × smoothstep(4, 8, U), with J0
  the quantile of J at Monahan's cover W(U) = 3.84e-6 U^3.41 (4 % at 15 m/s), as v1's bridge takes it: here from the readback
  window (64 × 64 samples of J0 + J1 + J2 − 2, sorted in place; eased by half a read) into the frame's new `spume` row (x = J0,
  y = on). The spume rides v1's folds (since audit W2 v1's whitecaps ride them too: § The wind on the water).
- **The colour** is v1's foam: albedo 0.9 under the sky and the sun, shaded a little by the normal (as the wake's, WAKE_FOAM).
- **U** was the frame's wind (`F.wind.x`) in the spume's first commit; since audit W1–W3 it is the local wind from v1's wind
  texture, as v1's: gusts and the terrain lift spots past 12 m/s on a level-4 day. The counts below are the first commit's.
- **Cost:** under 12 m/s one smoothstep on a uniform and a return (the frame is bit-identical: every golden 0 px). Past it, the
  noise runs only on the folds inside the look square. The CPU's quantile (4,096 floats) runs only past 12 m/s. No pass, no
  pipeline, no allocation a frame. `__velia.setSpume(false)` switches it off in place (the A/B).

The counts (1280 × 720, the spume's own pixels: on minus off, luminance up more than 8 levels, 4-connected runs of ≥ 3 px,
in the bottom 70 % of the frame; v1 on minus v1 with its spume zeroed, v2 after minus before; `tools/v2-spume.mjs`,
`renders/v2-spume/tmp/spumecount.mjs`):

| pose | wind at the boat | v1: streaks / % px / lift / length px | v2: streaks / % px / lift / length px |
|---|---|---|---|
| fair, pinned 15 m/s | 15 | 179 / 0.43 / 72 / 7.3 | 310 / 0.57 / 88 / 6.2 |
| fair, level 4 (16:00) | v2 12.6 | 89 / 0.28 / 49 / 7.6 (gusts past 12) | 66 / 0.11 / 14 / 6.5 (just past the onset) |
| fair, pinned 11.5 m/s | 11.5 | 67 / 0.20 / 30 / 7.8 (its local wind past 12) | 0 |
| storm golden pose (level 2) | v2 8.8 | 0 | 0 |
| storm, level 4 | v2 17.6 | 0 | 154 / 0.25 / 11 / 5.9 (dark light) |
| helm, storm level 2 / level 4 | | 0 / 0 | 0 / 8 |

Stacks (v1 with `windlines=0`, the live look / v2 before / v2 after, 960 wide): `renders/v2-spume/storm.png`, `fair4.png`,
`fair15.png` (+ `fair15-crop.png`, 1.5 ×), `under.png`, `storm4.png`, `helm.png`, `helm4.png`; v1 | v2 film (10 s, H.264):
`renders/v2-spume/spume-fair15-follow-v1-v2.mp4` (`tools/v2-spume-film.mjs`). Tests: `v2/tests/spume.test.mjs` (the onset, the
lanes along the wind within 4° at six headings, steady from frame to frame, the threshold from a window),
`v2/tests/pages/spume.page.mjs` (the WGSL against the JS at 512 points; on at 17 m/s, the same frame on and off at 11.5).

**Budgets** (2026-11-14 afternoon, the M5 Pro Mac, headless Chrome, in place: `node tools/v2-ab-m5e.mjs --what spume`, the spume
off and on in one page at a pinned 17 m/s (full spume), ABBA, 8 rounds × 120 frames, run twice, per-pass medians of the rounds'
differences; the water draws in the scene pass). The scene pass: **2560 × 1600 +0.029 / +0.030 ms** (budget 0.15); **390 × 844 on
the phone path (`terrain=phone&touch=1&levers=all`) +0.051 / +0.009 ms** (budget 0.2). The totals (+0.075 / +0.043 and +0.118 /
−0.050 ms) move with the composite's noise, which the spume does not touch. Under 12 m/s the shader returns on a uniform: all 25
v2 goldens are 0 px against main's references (`goldens:v2 --twice`), so no frame was re-blessed (none is past 12 m/s).

### The wind on the water (audit W1–W4, 2026-11-14: render/windWater.js, sim/windTex.js, sim/wind-worker.js, sim/gust.js)
The audit's S1 and S2 rows on the wind (W1–W4), each v1's recipe:
- **The wind texture** (v1's `src/sim/wind-texture.js`): the WindField's local wind over 4,096 m round the camera (snapped to
  512 m), 256² texels of 16 m, with the speed's ≈ 800 m box mean; half floats in a storage buffer (the water's fragment stage
  is at the 16 sampled textures' limit), read bilinear by hand, faded to the frame's wind over its outer 15 % (v1's windEdge).
  A fill costs 100–200 ms of CPU, so a live page fills it in a worker (`sim/wind-worker.js`: its own WindField on a copy of the
  terrain's height grids, set to the page's state each request, v1's windState) and uses the latest; a capture fills in place
  at the first frame and every 30 frames, or at once on a cut (a centre two snaps away): deterministic. The frame's `windfx`
  row: the centre, the switches, the sea's Hs. **Cross-faded (fix(v2) shadow stepping, 2026-11-18):** a week-3 viewer saw the
  lake's "shadows stutter": the gust patches' dark water jumped a texel (16 m) on each fill and held (every 30th film frame;
  every worker round trip, ≈ 1 s, live). Now the two newest fills sit in two buffers (`createWindBlend`, render/windWater.js)
  and one compute dispatch a frame (65,536 texels; in the water-sim pass) writes their cross-fade into the buffer every reader
  binds; a fill starts a segment from the previous fill's state to its own over the time between their states (the picture one
  fill behind), the next fill waits until the segment ends (a late one holds, never jumps), a one-snap move waits for the
  cadence (the old fill read 32 texels over). Locks: `v2/tests/windblend.test.mjs`; the measure: `tools/v2-shadow-steps.mjs`.
- **W1, the gust patches** (v1's `src/gustFx-water.js` and water.js's gust look): the weight from the local wind over its mean
  (v1's gustVisual × 1.45, the crisp 1.05–1.075 contour ragged by a 9 m noise, the fresh front where the wind 28 m downwind is
  still the old air); the patch's fine ripples (13 and 8.3 cm, crossed, slope² 0.04 at full weight, broken up by a 7 m and a
  23 m noise) as roughness in the rough Fresnel (v1's lostG); the mirror × (1 − 0.3 w), the mirrored sky's luminance toward the
  open sky above (−10 % / +9 %, the hue kept), the glitter × (1 − 0.8 w); v1's body tint in a patch (GUST_LOOK.body, × 0.42,
  0.55, 0.8) is not ported: the water's body colour stays (the brief's rule; the deep water stays navy); the short cascades follow the local wind
  (v1's rippleFactor against the mean's, on each cascade's gust response). One deviation: v1 also bends the near normal with the
  two fine cosines; on v2's smoother short cascades they drew a regular glinting lattice over the near water (seen at cam B and
  the noon golden; v1's own note calls it "the regular stipple"), so here they stay unresolved (roughness only).
- **W2, the whitecaps** (v1's whitecapAt and the Ultra billow): v1's breaking measure (render/spume.js) gated 4–8 m/s on the
  LOCAL wind, the crest-aligned cells, wave groups and lace gated 6–10 m/s on the local wind, the swell's share, the
  cauliflower billow (Worley and fractal noise; the Worley feature point from one hash a cell, not three: the same statistics,
  a third of the cost), in v1's foam colour; the spume rides them on the local wind. They replace v2's subtle grey caps (FOAM,
  kept as the A/B's off state). The fold threshold J0 is now taken from 3 m/s up.
- **Since #56 M1 (Ultra-Water's surface, merged 2026-11-14)** the whitecaps are M1's (Ultra's foam on v1's coverage rule, its
  own J0 from the readback); W2 is now M1's onset read on the local wind, and the spume adds to M1's foam (the fold's depth
  under M1's J0 as v1's breaking measure), in M1's foam look. This branch's own v1 whitecaps and J0 were removed in the
  merge. Stacks over M1: `renders/v2-spume/gustA.png`, `caps11.png`, `lanes3.png`, `fair15.png` (v1 / v2 main / v2 after).
- **W3, the wind lanes** (v1's streakAt, wind-cues.js lanes): spLane along the local wind, faded as v1's look map and
  laneVisibility; a lane darkens like a gust (+0.12 to the weight), roughens (slope² +0.006) and scales the short ripples
  (× 1 + 0.55 lane: rough lanes, smooth slicks).
- **W4, the gust's payoff** (v1's `src/gustFx.js`, `sim/gust.js`): GustWatch on the boat's true wind (the sim's clock) fires the
  sail-fill snap (main, then the jib 0.14 s later) and the rising rush (× 1 + 0.7 punch) into v1's boat audio, and the follow
  camera leans 16 % of the heel, lagging 0.8 s, at most 6° (none with reduced motion). v1 also computes a gust spray value
  but never draws it (its spray has no gust input), so v2 does not draw one either.
- The switches: `__velia.setWindFx({ tex, gust, lanes, caps })` and `__velia.gust.setOn()` (the A/B), `?gustfx=0` turns the gust
  cells and the payoff off. The frame look's navy lock (`v2/tests/pages/frameLook.page.mjs`) measures the water's own colour
  with all of them off: the Sail start's first gust line lies over its box at 20 s (a darker matte patch by design, L* 10.9
  against 17.5) and the lean's roll moves the box; with them off it reads main's 29, 39, 88 exactly.

Evidence (2026-11-14, `tools/v2-spume.mjs` poses gustA, caps11, lanes3; v1 with `windlines=0` / v2 with the parts off / v2
after, 960 wide): `renders/v2-spume/gustA.png` (cam A 14:00 level 3: v1's dark matte patches; v2's now drawn, crisp-edged,
riding the gust cells), `caps11.png` (cam B, a pinned 11 m/s: v1's scattered caps; v2 showed none, now a few), `lanes3.png`
(cam B, level 3); the clip `renders/v2-spume/gust-follow-v1-v2.mp4` (10 s, the Sail start at level 3: the first gust line ahead
of the start, the boat sailing into it between 30 and 40 s; its true wind 3.6 → 6.7 m/s). Tests: `v2/tests/windwater.test.mjs`
(v1's gust weight, the caps' local gates, the lanes' gate, the texture as v1 fills it and its capture cadence), `gust.test.mjs`
(the payoff frame for frame against v1's createGustFx), `v2/tests/pages/windWater.page.mjs` (each part off and on at the audit's
poses: the patches darken, v1's caps show at 11 m/s, the lanes move the water both ways).

**Budgets** (in place, `node tools/v2-ab-m5e.mjs --what windfx`: the texture's reads, the gust look, the lanes and v1's caps all
off | on, ABBA, the follow camera at level 4, 14:00; the M5 Pro shared with other helpers' suites, load 9–17). Long rounds
(12 × 120 frames) read +0.43 / +0.75 ms on the scene pass, but the composite pass, which the change does not touch, moved by the
same +0.46 / +0.76 ms: the GPU's drift between rounds, not the water. Many short rounds (40 × 40 frames, the drift averaged out)
read the scene pass at **+0.000 / +0.018 ms at 2560 × 1600** and **+0.001 / +0.002 ms on the phone path (390 × 844)**, inside
the 0.2 / 0.25 ms budgets; re-measure on an idle GPU before holding them to it. CPU: the fill runs in the worker (100–200 ms
a fill off the main thread; a capture pays it every 30 steps); the main thread copies a result into its buffer (128 K words)
and uploads 512 kB when one lands. No new pass or pipeline; one storage buffer and one worker made at load.

### Budgets (M5e, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 120 frames, per-pass medians; the GPU was shared with other helpers' jobs that afternoon)
The GPU was busy with other helpers' jobs the whole afternoon: the same frame ran 14–43 ms from one run to the next and
the composite pass read 5–7 ms where it reads under 1 ms on a quiet GPU, so the desktop pairs below are **best of three
interleaved runs** and carry that noise; the phone pairs were quiet. Re-measure on an idle GPU before holding these to the
budget (the commands: `node tools/capture.mjs --app v2 --w 2560 --h 1600 --frames 120 --url "…&maxpx=5e6"`, on and off
interleaved, three times).

| Frame (on / off, best of 3) | total | scene | composite | sky-lut + aerial + key |
|---|---|---|---|---|
| 2560 × 1600, the follow camera at 21:36 (`?night=0` off) | 14.38 / 16.61 | 6.38 / 7.31 | 6.58 / 7.35 | 0.28 / 0.30 |
| 2560 × 1600, cam B at 22:30 toward the band (the stars and the Milky Way on screen) | 3.28 / 3.28 | 0.97 / 0.87 | 0.82 / 0.72 | 0.28 / 0.30 |
| 2560 × 1600, v1's storm pose at 150 s (no `?weather` off) | 15.07 / 12.32 | 6.48 / 5.40 | 6.87 / 5.35 | 0.29 / 0.30 |
| 2560 × 1600, the first hero bolt at 128 s with the rain | 16.47 / 13.47 | 7.29 / 5.78 | 7.36 / 5.71 | 0.22 / 0.27 |
| 390 × 844 with the hands, 21:36 | 2.66 / 2.61 (**+0.06 ms**) | 0.83 / 0.79 | 0.68 / 0.69 | 0.27 / 0.28 |
| 390 × 844 with the hands, the storm at 150 s | 2.58 / 2.51 (**+0.07 ms**) | 0.70 / 0.66 | 0.62 / 0.57 | 0.27 / 0.29 |

**In-page A/B (2026-11-13 15:00, `tools/v2-ab-m5e.mjs`: off and on in one page, 90 frames each, 3 rounds, the median of
the rounds' differences; the GPU still shared, so the rounds' totals ran 11–22 ms; measured before main's parity sea was
merged under it, which changes the water's cost on both sides of each pair alike):**

| Pair | Δ total | Δ scene | Δ composite | the rounds' totals off / on |
|---|---|---|---|---|
| night, 2560 × 1600, the follow camera at 21:36 | −0.46 ms | −0.21 | −0.30 | 14.3, 21.9, 17.8 / 18.7, 21.4, 15.5 |
| night, 390 × 844 with the hands | **+0.03 ms** | +0.02 | +0.01 | 2.69, 3.04, 2.96 / 2.71, 3.09, 2.99 |
| storm, 2560 × 1600, 150 s into the arc | −0.13 ms | −0.05 | −0.04 | 11.1, 15.3, 15.0 / 14.7, 15.1, 14.6 |
| storm, 390 × 844 with the hands | **+0.03 ms** | +0.01 | +0.02 | 2.72, 2.67, 2.88 / 2.74, 2.74, 2.78 |

The phone pairs are clean and far inside their halves; the desktop pairs sit inside the +0.5 and +1.0 ms targets but
within a noise of ± 3 ms on the totals, so they are not a clean read: re-run the tool on an idle GPU.

What the night adds where the GPU was quiet (the cam B pair): ≈ +0.1 ms in the scene (the stars' 9,096 points, the
Milky Way's two samples in the sky and one per ray in the water) and ≈ +0.1 ms in the composite (noise: it does not read
the night), inside the +0.5 ms. The storm's real cost is the rain (16,000 blended quads at 4 Mpx with MSAA 4) and the
composite's grade (one depth load and the bow's maths a pixel): the pairs read +2.8 to +3.0 ms under the noise, so the
+1.0 ms peak budget is **not shown met on the desktop**; the phone pairs are inside their halves. If a quiet measure holds
the desktop over 1 ms, the first levers are the rain's count under 2 Mpx of backing (v1's tiers), its streak alpha test, and
the grade's branch on `F.storm.x` moved before the depth load. Pipelines: 54 on a live Sail page (+4), 0 after the first
frame. JS: 540.6 kB raw, 201.3 kB gzip (the main chunk; the night's data and the thunder's worker are files beside it).
