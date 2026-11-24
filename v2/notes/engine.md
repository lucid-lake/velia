# v2 notes: Frame graph, depth, buffers, pipeline rules, determinism, governor, shared modules from src/

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

### Frame graph (M3)
| Pass | Kind | Work |
|---|---|---|
| `boat-shadow` | own render pass (depth only) | M3: the boat's depth from the sun into a 2048² `depth32float` map (an orthographic box ±10.5 m round the hull, 60 m deep along the sun): the hull, mast and boom, both sails with their flutter; cleared and left empty when the sun is down |
| `terrain-shadow` | own render pass (depth only) | M5c: the terrain's depth from the sun into a 2048² `depth32float` map over the bay (±2.5 km round a point 700 m before the eye, 7 km deep along the sun; the camera's CDLOD patches re-selected against the light's box); drawn on the first frame, then every 4th live frame or when the sun turned 0.1°, the box moved 400 m or a grid swapped; between draws an empty pass keeps the timestamps (`?tshadow=2` draws every frame, `=0` never) |
| `water-sim` | compute | M1's: evolve, the FFT (the speed pass: 2 dispatches, a line of a cascade a workgroup, its 8 Stockham stages in workgroup memory; was 16 dispatches of a stage each), assemble, 16 mip dispatches (20 dispatches); then the wake's Kelvin map and foam map (2 dispatches: § The wake and the spray) |
| `sky-lut` | compute | the sky-view LUT (256 × 128) for this frame's sun |
| `aerial` | compute | M2: the aerial-perspective froxels (32 × 32 × 32, two `rgba16float` 3D textures: in-scatter and transmittance) and the frame's light record (the sky's and the sun's irradiance on level ground, once for every shader); the water's mirror of the land (256 azimuths × 16 elevation bins) |
| `cloud-key` | compute | M5a: this frame's rows of the next cloud key (after `aerial`: it reads the frame's light record); the whole key on the first frame and after a camera cut; **the speed pass:** then the blend, `mix(prev, cur, fade)` once into the key's fourth layer, which every reader fetches (one fetch for two) |
| `forest` | compute | M5b: the one-offs due (a bake layer, the mips, the place and scatter after a grid swap), a reset of the indirect arguments, the cull in a fixed order (count, scan, write: a workgroup a picked tile); **M5c:** the boulders' scatter when a grid swapped (315 k cells → the placed list), then their reset and cull (an indirect dispatch over the placed list) |
| `scene` | render → HDR `rgba16float` + `depth32float` (reversed), MSAA 4 + resolve | the terrain (CDLOD quadrants, one instanced draw: the land, and the lake bed through its water column), **M3: then the boat** (M3b, once the models are in: the cabin and its depth-only portal when near, the keel, rudder, mast and boom, v1's models in 3 draws (always + the LOD's detail and near/far sets), the wheel, the traveller car, 2 sails, one ribbon draw: opaque, depth on), then the water surface blended over both (premultiplied: its Fresnel share over the hull below the waterline, as v1's render order hides the inside), then the sky only where nothing was drawn, then the bow spray when drops are in the air (blended, no depth: § The wake and the spray); **M5c:** the terrain's bed pixels now carry v1's clarity bed, its caustics and the refraction wobble, its land pixels the photo, the detail grain and the terrain shadow; then the boulders (one `drawIndexedIndirect`, opaque); **M5b:** the forest's cards right after them (one `drawIndirect`; they take the terrain shadow too); **M5a:** the sky, the water's mirror and the terrain each composite the cloud key with one fetch; **M3b:** then the dodger's clear vinyl and smoked side panels, blended (they write no depth: drawn last so nothing covers them); **M5e:** after the sky, the stars (additive, where the sky is), the towns' and the boat's lights (additive, depth-tested), the rain (blended, the sky behind it) and the bolt's glow and core (additive) |
| `composite` | render → the swap chain (the speed pass: the scene's multisampled depth is stored for it only while a storm is on; else the scene pass discards it) | tonemap: ACES fit × the exposure factor, sRGB encode; **M5e:** under a storm the grade first, in HDR (the rainbow on what lies past ≈ 900 m by the scene's depth, the steel, the vignette, the clearing's gold, the flash) |

Outside the frame (stream events, never in a frame's work): a grid's upload slices (≤ 1 MB a frame, `UPLOAD_BYTES`) and,
when it is whole, its swap: one bake dispatch (its normal and albedo maps), a new bind group, the level records rewritten.

### Depth (M2): reversed, float
`depth24plus` with a 0.5 m near plane resolved ≈ 3 m at 5 km: the water z-fought the shore there. The depth is now
reversed (near → 1, far → 0, cleared to 0, `greater`) in `depth32float`: millimetres at the shoreline at any range. The
sky's triangle sits at z = 0 with `greater-equal`.

## Buffers and bind groups
Group 0 on every pipeline: the `Frame` uniform (M5e: 512 B, 92 floats: M1's 64 and the moon, night and storm rows; one ring slot, dynamic offset). Group 1 on the scene's draws: the
sky's LUTs, the aerial perspective's two volumes and the frame's light record (a 32 B storage buffer the aerial pass
writes). Group 2 on the terrain: its level records (a 304 B uniform written only at a swap), the five height slots
(vertex), the five normal and five albedo maps (fragment) and the instance buffer (≤ 4,096 × 16 B, written once a frame:
the CDLOD selection; the only per-frame write beside the uniform ring). Group 2 on the water: its two array textures and
the mirror's horizon; group 3: the heights (the depth). Per stage the sampled textures stay under WebGPU's 16 (terrain
fragment 14, water fragment 12). Bind groups change only at stream events. **M3, group 2 on the boat's pipelines:** the
`Model` records (one 256 B slot per part: the model matrix, its normal matrix, two vec4 of per-part numbers: the focal
length in pixels for the ribbons, the sim time and the two luff amounts for the cloth's flutter, the hoist and the foot
chord for its layers; 5 slots, one writeBuffer a frame, a dynamic offset per draw), the shadow map and its comparison
sampler, and the `Shadow` uniform (the light's view-projection, the sun). The sails' vertex buffers are rewritten only
when the trim, fill, draft or reef move (v1's rule); the ribbon buffer (lines + wires, ≤ 1,536 points) every frame.

## Pipeline rules
Every pipeline is declared before the first frame and built async in `buildAll()`; after the first frame the registry
is sealed: a late `add()`, `buildAll()` or unknown `get()` throws, is pushed to `__velia.errors` and counted in
`stats().pipelines.afterFirstFrame`, which stays 0 (also while the terrain streams: the bake and the probe are built at
load). M3: 20 pipelines (11 compute: 3 sky LUTs + the aerial, 4 water, the terrain's bake, mirror and probe; 9 render:
terrain, water, sky, tonemap, the boat's solid, cloth and ribbon draws, its two shadow pipelines). M5a: 23 (+3 compute:
the clouds' noise and weather bakes, the key march). M3b: +4 render (the boat models' opaque, glass, cabin and portal draws): 27. M4: +1 render (the instruments' faces): 28. M5b's forest and M4's cockpit (+4 render on a live page: opaque, blended, blended with depth, blended with a depth bias): 41 on a live Sail page, 0 after the first frame. M5c: +9 (the terrain shadow's depth pipeline, the ground's mip bake, the boulders' scatter, scatter-done, reset, cull, draw and shadow pipelines): 50 on a live Sail page (`stats().pipelines.total`), 0 after the first frame. Birds: +4 render (the near and far bodies, the snag, the shadows on the water) when the birds are on: 53 on a live Sail page.
the clouds' noise and weather bakes, the key march). M3b: +4 render (the boat models' opaque, glass, cabin and portal draws): 27. M4: +1 render (the instruments' faces): 28. M5b's forest and M4's cockpit (+4 render on a live page: opaque, blended, blended with depth, blended with a depth bias): 41 on a live Sail page, 0 after the first frame. M5c: +9 (the terrain shadow's depth pipeline, the ground's mip bake, the boulders' scatter, scatter-done, reset, cull, draw and shadow pipelines): 50 on a live Sail page (`stats().pipelines.total`), 0 after the first frame. M5e: +4 render (the stars, the glows, the rain, the bolts): 54 on a live Sail page, 0 after the first frame. The wake: +3 (the Kelvin and foam maps' compute, the spray's draw), 0 after the first frame. The speed pass: +1 compute (`cloud-blend`), 0 after the first frame. The far water's shimmer fix: +1 compute (`cloud-key-mip`, the blended layer's mip chain), 0 after the first frame.

## Determinism
`?headless=1` freezes the clock and the governor, streams every grid before the first frame and runs the GPU probe;
a capture's `renderOnce()` steps the sim by one fixed step. No `Math.random()`, no wall clock in the scene (the value
noise is a hash of world position). **M3:** a capture then renders three frames to fill the water's readback ring, settles
the boat for `?settle=` s (20, v1's) of 1/60 s ticks with the pilot on the start heading, resets the foam's memory (so the
ring's frames leave no trace) and places the follow camera; each `renderOnce()` steps the clock by 1/120 s and the boat by
the same (the hands as the harness left them through `__velia.boat.input`). The dev label is hidden under `?headless`
(the goldens hold the scene). `npm run goldens:v2 -- --twice`: 12 frames, 0 px apart (2026-11-13); M5e: 19 frames, 0 px (the storm's strikes and flashes, the stars' twinkle and the moon all ride the seed and the scene clock).

**The film clock (`?filmui=1`, the live-UI goldens; fix(v2) 2026-11-13).** The hud frames drifted 0.3–4 % run to run, on the
water's glints only, by run order and machine load; each frame alone passed. Cause: `filmFrame` went up on the hook *before*
the page's first frame and its `graph.settle()`, so film frame 0's float read either the flat start (the first readback still
mapping) or the first frame's surface, by a race with the GPU map. That gave two boat states, ≈ 5 cm apart after 400 frames
(x 1151.14 vs 1151.09); since the parity merge (2 × game speed, the short bay chop) the shift shows in the glints. Now the
film path is a capture's: the terrain, the boat's models, the forest, the night, the ground photo (`ground.prime`, it streamed
on the wall clock before) and Sail's UI are in, the first frame is drawn and its readback adopted, the front door's chunk is
wired, and only then does `filmFrame` appear; each film frame awaits its own readback (`graph.settle`). Nothing in the film
path waits on the wall clock after that. Guard: `v2/tests/pages/filmClock.page.mjs` (the hook appears with the readback
adopted and none in flight, the ground primed, the UI and the front door wired; two 60-frame films, one under a 4 × CPU
throttle, end on the same boat state to the bit). `goldens -- --reverse` shoots the set in the opposite order. The living
lake on the film path: the kayaks and the flock are primed before the first frame and their real-time clock steps by the
film's dt; in a headless capture they and the fireworks ride the scene clock (`--twice` 0 px for all 24 frames, also under load).

## Governor, stats, anti-aliasing
As M1 (README history in git). Stats add `eye`, `fovDeg`, `gpuPassMsMedian` (per pass, the last ≤ 240 frames), `terrain`
(`variant`, `stage`, `firstBytes`, `bytes`, `files`, `swaps`, `queued`, `decodeMs`, `landMsMax`, `swapMsMax`, `grids`,
`instances`, `perLevel`, `triangles`, `probe {n, maxErrM}`, `heightAt0`) and `stream` (`frames`, `worstFrameMs`,
`worstCpuMs`, `uploadMsMax`, `doneMs`). `__velia.terrain.field.height(x, z)` is the CPU twin of the drawn ground.

## Shared modules (what v2 imports from src/)
**The world audit (L3, 2026-11-14):** `src/race/contact.js` (v1's hull-on-hull contact, three-free) under v2/sim/solids.js.
**Round 2 of the phone cuts (2026-11-17):** `src/ui/fontFaces.js` (one `@font-face` per family, style and weight in the sheets the logbook, the skipper's line and the home pages inject).
`src/sim/core/flags.js` (the URL table), `src/sim/day.js` (the map's day and its season), `src/sim/wind.js` (and what it
reaches: `wind-shifts`, `wind-modifiers`, `wind-cells`, `weather/stormWind`, `weather/stormArc`, `core/math`,
`waters/current`, `waters/index`, `settingsKey`), `src/sim/timeOfDay.js` and `src/sim/place.js`, `src/waters/*.json`; **M5a:** `src/sim/weather/state.js` (the storm cell's record the clouds read);
**M2:** `src/sim/core/presets.js` (v1's cameras) and `src/sim/water-spectrum.js` (WATER_K, WATER_B only; tree-shaken).
**M5c:** `src/waters/clarity-optics.js` (v1's bed, caustic and clarity numbers: BED, CAUSTIC_LINE, IMAGE_SCATTER, DIRECT_SHARE;
plain JS, it reaches `src/water-spectrum.js`, a re-export of the sim's) and `src/naip-layout.js` (the photo's extents and files).
**M3:** the sloop's sim, imported as it is: `src/sim/boat.js` (BoatPhysics, CONTROLS, Helm, DT) and what it reaches
(`boat/engine`, `boat/thrill`, `boat/groove`, `diagRegistry`, `vessels/*` + `src/vessels/halcyon.json`), `src/sim/boat/`
`float`, `ride`, `ground`, `groundTerrain`, `tackle`, `followCamera`, `helmCamera`, `dims`, `canvasHex`,
`src/sim/sail/` `feel`, `gennaker`, `sheets`, `stepper`, `tackCarry`, `src/sim/craft/sloop/cameras.js`, `src/sim/waterSurface.js`
(liveSurface; it re-exports `waters/ultra/surface.js`); and v1's pure boat geometry, which was already plain JS: `src/boat/`
`spars.js`, `spars-detail.js`, `rig.js`, `cockpitPoints.js` (+ `canvas.json`, `models/boat/cockpit.json`) and
`src/core/math.js`; **M4:** `src/boat/nightLight.js` (the instruments' night palette and gains). **M5e:** `src/core/milkyway-math.js` (the band's fades, the moon's share, the light domes), `src/boat/details.js` (the nav lights' sectors and level), `src/ui/theme.js` (the night switch), `src/sim/weather/stormSim.js` and `weatherMenu.js` (the storm and the Weather menu), `src/weather/stormAudio.js` (the thunder: Web Audio, no three). **The wake:** `src/sim/boat/wakePhysics.js` (the Kelvin laws, the trail's step and length, the CPU sum) and `src/sim/core/rng.js` (mulberry32, the spray's draws). **#5, #6:** `src/boat/binoculars.js` (+ `src/boat/helmCamera.js`), `src/ui/binocularsView.js`, `src/ui/binocularsHud.js`, `src/vhf/radio.js`, `forecast.js`, `harbourMaster.js` (+ `src/wind.js`, `src/timeOfDay.js`, re-exports of the sim's): § The binoculars and the VHF. v2 builds the physics with `new BoatPhysics(o)` and v1's stepper directly rather than through
`src/sim/craft/index.js` and the Simulation, so the craft registry (the kayak's chain, the sloop's Web Audio) stays out of
the bundle (Cruise's own chunk reaches the registry through v1's director, for the helm eye: § Cruise). The tests also reach `src/sim/terrain-data.js` and `src/sim/terrain.js` (v1's sampler and `heightAt`, the
reference) and `src/sail/keys.js` (the key table). `v2/tests/no-three.test.mjs` pins this list and walks every import
for three.
**The day clock and the key legend (2026-11-13):** `src/ui/timeMenu.js` (the time menu) with `src/features/timeRows.js` (the
features' clock rows, the pure half of `src/features/index.js`), `src/fireworks/evening.js` (v1's night-sky words only: v2 runs no evening), `src/ui/keyLegend.js`
and `src/ui/edgeStyle.js` (the edge pair); `src/sim/timeOfDay.js` was already in (now its `RateTable`, `dayClockSchedule`, `SAIL_HOUR`).
**The quiet skipper on phones (2026-11-16):** `src/ui/phoneQuiet.js` (the one rule for which skipper lines a flat phone keeps; pure).
**The nav column (2026-11-13):** `src/ui/navColumn.js` (the left edge); `src/ui/passage.js` and `src/ui/shipClock.js` were already in (the chart).
**The spume (2026-11-14):** `src/sim/windCues.js` (v1's wind-cue onsets and Monahan's whitecap coverage, the sim's half of
`src/wind-cues.js`); `src/sim/water-spectrum.js` (now also WHITECAP) and `src/sim/waters/current.js` were already in.
**The wind on the water (audit W1–W4, 2026-11-14):** `src/gustFx.js` (v1's gust payoff: GustWatch, CameraLean, the snap events),
`src/sim/wind-texture.js` (v1's wind texture: fillWindTexture, windState, applyWindState).
**Sail's wind shifts by experience (owner, 2026-11-17):** `src/sim/sail-shifts.js` (the profile's swings and big shifts with their
gust line, on the one WindField: `sailShifts` option, `dirAt`, `sample`, `toTexture`; the worker gets it through `windState`).
**The passage plan (2026-11-14):** `src/sail/passagePlan.js`, `src/sail/passageSheet.js`, and `src/sail/chart.js` for its `parseRoute` (§ The passage plan).
**Cruise (BACKLOG-v2 #11, its own chunk):** `src/sim/modes/chill/` `navigator.js`, `pilot.js`, `params.js` (and the re-export
`src/modes/chill/navigator.js`), `src/sim/ai/skipper.js`, `src/modes/chill/` `director.js` (with `src/camera.js`'s floor and the
craft registry `src/craft/index.js` → `src/sim/craft/{index,plain}.js`, `sloop/{index,physics,audio}.js`, `kayak/{index,physics}.js`
for the helm eye), `cameras.js`, `rig.js`, `intent.js`, `padCam.js` (+ `src/sail/keys.js`), `markTap.js`, `quietLine.js` (new seam),
`src/forest/crowns.js` (+ the seams `topsBox.js`, `rules.js`), `src/ui/modeLines.js`, `src/ui/photo.js`.
**Step 3 (the sound beds, hybrid):** `src/boatAudio.js` (createBoatAudio, BoatMix), `src/sfx.js` (createSfx, SfxMix), `src/audio.js` (mixAt) and `src/audioFormat.js` (decodeFile), three-free: v1's own sound engines play v1's recordings on v2's page.
**#4 (the first sail's lines):** `src/ui/firstSailGuide.js` (the three-free half of v1's `firstSail.js`: the rules and the chips; v1 keeps its beacon).
**#8, #14 (the engine and the ground tackle):** `src/engineAudio.js` (the engine and the chain, three-free), `src/sail/keys.js` (KEY), and three pure seams split out with v1 unchanged: `src/sail/seamanshipRules.js` (SEA, ICONS, EngineNudge, nextSunrise), `src/boat/exhaustSim.js` (the exhaust's flight; it reaches `src/core/rng.js`), `src/sim/sail/tackleEnv.js` (tackleEnv, so the Simulation's craft registry stays out); `src/sim/boat/tackle.js` and `src/stations/sloop/throttleLever.js` were already in.
**The UI audit's S2 fixes (2026-11-14, U12, U15):** `src/ui/statusLine.js` (v1's StatusWatch: the top bar's status line) and the practice marks' sim `src/sim/marks/` `field.js`, `body.js`, `hull.js` (`course.js` was already in for Regatta), in their own chunk with `v2/ui/course.js`.

**The hand (2026-11-15, fix/v2-phone-desktop-text):** `src/ui/hand.js` sets `data-hand="touch" | "keys"` on `<html>` from `isCoarse` and the input modality (`v2/ui/loading.js` calls it first); CSS and JS read it to word the card and the game for a finger (no keys, no binoculars), and its observer drops the bracketed key from labels while the hand is a finger.

**Copied, not imported (src/ is not v2's to edit):** `v2/terrain/decode.js` holds `inflate` and `unpredict` from
`src/sim/terrain-data.js` (not exported there; that module also owns v1's fetch, worker priming and variant rules, which
v2 does in its own worker). The test decodes every grid both ways and demands identical arrays. An export of the two
functions from `src/sim/terrain-data.js` would let v2 drop the copy (and the module's `node:zlib` fallback could go: node
≥ 18 has `DecompressionStream`).

### What M3 still owns that the sim should
- M1's notes stand (`sunInto`, `waterSurface` opts, the moon and stars).
- `v2/sim/boat.js waterFor(heightAt)`: v1's water for the ride from v2's `heightAt(x, z)` alone: the float's `t` and
  `opts` (the Smith depth filter, `filterM`) are ignored, `waveAt` is a central difference, there is no `orbitAt` (no
  orbital current) and no wake. A `src/sim/waterSurface.js` adapter that takes a plain `heightAt` would let both engines
  share it.
- The hands (`v2/sim/boat.js hands()`): v1's helm and sheet rules copied from `src/controllers/sail.js` (the pilot's
  course, `helmTau`, the winch's rate), not shared: a pure `src/sim/sail/hands.js` would serve both.
- The line set (`v2/render/boat/mesh.js lineSet`): a subset of v1's `src/boat/lines.js` (three-bound there): the main
  sheet tackle, the two jib sheets, the two halyards, the topping lift, the lazy jacks; not the coils, tails, reef lines,
  furling line or the near-camera rope tubes. Splitting v1's `lineSet` out of `lines.js` would give v2 the whole set.
- **The lazy jacks (#43, 2026-11-14, both apps):** the leeward jacks left the mast beside the luff (x ±0.06 m), outside
  the cloth, and ran into it 0.12–0.20 m aft (the belly leaves the luff steeper than a jack runs aft); pushing their mast
  ends out only moved the crossing aft. They also end inside the foot's belly at the bag, so the jack's natural side is
  inside. `src/boat/rig.js insideMain` holds each jack point `clear` (0.02 m) on the belly's windward face, after the
  cloth's own shroud hold (`bear`, so the order is kept), and `offMast` gives the first leg points 2, 5 and 12 cm off the
  mast: the one crossing is now at the luff groove (≤ 0.07 m from it, inside the mast's width), and the rest of each jack
  keeps its line. Tests: `tests/sailClearance.test.mjs` and `v2/tests/boat-mesh.test.mjs` (no crossing past 0.08 m, both
  tacks, boom 4–72°; the v1 test fails on the old lines with crossings at 0.13–0.20 m).
