# v2 notes: The phone passes, landscape-only, flat and touch controls

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## The phone pass (2026-11-13: the quality ladder, the diag panel, Safari's WGSL, touch)
For the owner's first real-phone test (reference phone: an iPhone 16 Pro, A18 Pro, 2622 × 1206 at DPR 3, Safari; 402 × 874
CSS px). (Cold Smoke's phone path). BACKLOG-v2 P1 #1.

**The quality ladder (`engine/quality.js`).** Three levels above the governor; the governor moves the render scale inside a
level, the ladder moves the level.

| Level | DPR cap | Pixel cap | MSAA | Terrain shadow | Cloud key | Forest | Shallows | iPhone 16 Pro backing |
|---|---|---|---|---|---|---|---|---|
| L0 full | 2 | 3.4 Mpx | 4 | every 4th frame | 2048 × 512 (by size) | the terrain set's, shrubs | full | 804 × 1748 = 1.41 Mpx |
| L1 | 2 | 1.2 Mpx | 4 | every 8th | 1024 × 256 | no shrubs | full | ≈ 1.20 Mpx |
| L2 | 1.5 | 0.7 Mpx | 1 | every 12th | 1024 × 256 | reach × 0.6 (thin, fade and far), no shrubs | v1's phone path: one caustic net, no cobbles | ≈ 0.70 Mpx |
| L3 (perf(v2) phone) | 1.25 | 0.45 Mpx | 1 | every 24th | 1024 × 256 | reach × 0.4, no shrubs | as L2 | ≈ 0.45 Mpx |

L2 and L3 also take **the phone path** (§ The phone speed pass below): the coarse water grid, anisotropy 2, the lite water,
the FFT sim, the aerial pass and the cloud key every 2nd frame, and a 1024² boat shadow map.

- **What each level drops.** L1: about 15 % of the pixels on a DPR-3 phone (much more on a desktop), the shrubs (≤ 450 m),
  the larger cloud key (the 1024 × 256 key the 390 × 844 golden already uses), half the terrain shadow's redraws (it still
  redraws on a 0.1° sun turn, a 400 m move or a grid swap). L2 also: half the pixels of L0 on a phone, MSAA (the rigging
  keeps its own ≥ 1 px coverage fade), the far forest (its last trees at 4.8 km on the full set, 2.7 km on the phone set),
  the shallows' cobbles and second caustic net (v1's own phone path), the shadow at every 12th frame. The water, the sky,
  the navy, the reflections and the boat are the same shaders at every level.
- **Live vs at load.** The caps, the shadow's cadence (`tshadow.setEvery`), the forest's reach (`forest.setReach`) and the
  shallows (`terrain.setLook({ fine })`, the bed's `M.bed2.x`) change live. **MSAA is live too** (#31, § MSAA live: its
  set built in the background, then a switch between two frames). The cloud key and the boat's shadow size pipelines and
  textures, so a live step lists them as pending (the panel: "next load: cloud key …") and the stored level brings them
  next visit. Nothing is built synchronously after the first frame at L0, L1 and L2 (`v2/tests/pages/diagQuality.page.mjs`,
  `safariWgsl.page.mjs`).
- **The first level.** `?quality=0|1|2` (or v1's words high | balanced | low) pins it (the ladder off). Else a level settled
  on this GPU in the last 14 days (`localStorage` `velia.v2.quality`, keyed by vendor, architecture and phone/tablet/desk;
  every access in try/catch). Else the guess: a desktop L0 (a laptop's Intel/Arm/Qualcomm GPU L1, a software adapter
  L3); a tablet L1; a phone by GPU (perf(v2) phone, 2026-11-13 night; perf(v2) phone 30 fps, 2026-11-15): Apple (Safari
  usually hides the name: the iPhone UA counts) L1, Adreno 7xx+ L1, others L3; ≤ 4 GB one lower. Captures (`?headless`) take L0 unless pinned, so the goldens do not move.
- **The settle.** After a 2 s warm-up, 4 s of frame cost (the GPU's work with timestamps, else the rAF interval; fix(v2) 2026-11-14: § The governor on the GPU's work), the slowest
  10 % dropped, projected to each level by pixels (25 % fixed, 75 % pixel-bound): the best level that fits 1.1 × the
  budget, at most one up from the boot level and only with 0.8 × headroom. Stored. Then, in play: two 1 s windows over 1.3 ×
  the budget with the governor at its floor step one level down (10 s cooldown); 60 calm windows step one up. The ladder's
  budget is never under 16.7 ms: a 120 Hz Mac keeps its features, the governor's scale tunes inside.
- **Picture quality first: 30 fps (perf(v2) phone 30 fps, owner rulings 2026-11-15:** "phone should target at 30fps not
  60 and push for the picture quality"; "on macbook ... we should aim at high picture quality first"). Every page's
  governor and ladder cut against 30 fps's **33.3 ms** from the first frame, whatever the display's refresh
  (`engine/governor.js frameBudget`). **A phone or tablet** is held at 30 fps by the frame limiter (`engine/pacer.js`): it
  draws on every 2nd vsync at 60 Hz, every 3rd at 90 Hz, every 4th at 120 Hz, so the frames are even (no 16.7 / 33.3 ms
  judder); the skipped rAF callbacks do nothing, the sim reads the real time between drawn frames (the boat's speed is
  unchanged) and touch lands in its handlers and is read by the next drawn frame. Its ladder and the governor's raises aim
  at **78 % of the budget (26 ms)**, and the governor cuts work held over 1.05 × that (27.3 ms) even with the frames on the
  limiter's 33.3 ms: a phone heats under a sustained load, so about a fifth of each frame stays idle (the 30 fps cap already
  halves the frames). A strong phone (Apple GPU, Adreno 7xx+) boots at **L1** (MSAA 4, 1.2 Mpx, the full water path), and up
  to L0 (shrubs, the full cloud key) after the calm; the settle steps down one level at most (the pixel projection does not
  see L2's cheaper phone path), a level that still misses steps on in play; weak phones keep L3. The extra time buys pixels at
  the phone path's levels too (`MOBILE30_CAPS`, live phones and tablets only, never a capture): **L2 DPR 2, 0.95 Mpx** (was
  1.5, 0.7), **L3 DPR 1.5, 0.6 Mpx** (was 1.25, 0.45). On the iPhone model (`phone-governor.test.mjs`'s numbers) the owner's
  phone moves from L2 × 0.86 at 0.45 Mpx, 15.9 ms, 60 fps to L2 × 1.00 at 0.95 Mpx (2.1 × the pixels), 27 ms, 30 fps; L1
  (≈ 33 ms at 0.83 Mpx) does not fit it. A tablet is treated as a phone (the same thermal limits and the same GPUs). **A desk** has no limiter:
  it draws as fast as the display and the GPU allow at full quality, and gives up sharpness only below 30 fps (aim 1: no
  thermal headroom; a laptop on battery keeps the same 30 fps floor). Every stored record carries rule `q30`; a record
  without it (a phone's from the 60 fps rule, a desk's `desk60`) is stale and the page boots at the new guess. A step down
  is stored, so the next load builds the lower level's boat shadow (1024²) and cloud key; in the session a stepped-down
  phone keeps the boot level's map, drawn every 2nd frame at L2 and L3. `?pace=0` turns the limiter off (the A/B). The
  panel: `budget 33.3 ms: phone held at 30 fps (quality first)` and `pacing 30.0 fps: every 4th vsync of 120 Hz · frames
  p50 33.3 / p95 34.1 ms`; on a desk `budget 33.3 ms: quality first: cuts only below 30 fps (the 120 Hz display)`. Tests:
  `v2/tests/phone30.test.mjs`, `v2/tests/deskQuality.test.mjs`.
- **No GPU timer (BACKLOG-v2 #32, 2026-11-14).** Safari or iOS without timestamp-query, and every page without `?diag` or
  `?gputime=1`, feed the ladder the rAF interval: a 60 Hz phone reads 16.7 ms at every level that fits, so it stepped down
  but never up. Two ways back up: **the work-done probe** (`createBusyProbe`): after each submit, the time until
  `queue.onSubmittedWorkDone()` resolves (one in flight, the median of the last 30, read after 8), an upper bound on the busy
  span; the ladder's step-up tests (the settle's level above the boot, the 60 calm windows) read it in place of the interval,
  capped by the interval; the step-down tests keep the interval (a missed vsync is the real cost). On the Mac at L2 it read
  2.4 ms where the GPU timer reads 2.2 ms, so a phone-guessed page settles L2 → L1 (it stayed at L2 before). **The retry:**
  each decision made without a timer is stored with `vsync: true`; the next visit boots one level above it (`retry: …`) at
  most once every 3 days (`retryAt`), and the settle judges that level on its own frames (one that misses vsyncs steps back
  within the 6 s). `?timer=0` is the forced no-timer mode (no GPU timer even with `?diag`); the panel then shows
  `GPU ≈ 2.4 ms (work-done probe; no timestamp-query)`. Tests: `v2/tests/quality.test.mjs` (#32 rows),
  `v2/tests/pages/diagQuality.page.mjs` (the no-timer page steps up and stores `vsync`). Only a real iPhone can say how late
  Safari resolves the promise; a late one reads as less headroom, never more.
- **Flags.** `?quality=` (v1's shared row), `?gov=0` (the governor and the ladder off); `?maxpx=`, `?dpr=`, `?msaa=` still
  win over the level's rows.

**The diag panel (`engine/diag.js`, `?diag=1`).** A navy-glass plate (navy 86 %, 12 px blur, a cream hairline), cream text at
15 px, top-left under the bar, `pointer-events: none`. Lines: fps and frame ms (average and worst over 2 s); GPU ms (or
"no timestamp-query"); the level and why (the guess, the pin or the stored level, then the settle or the governor's step),
the pending rows; the backing size, Mpx and scale; DPR, its cap, the CSS size and MSAA; the GPU memory v2 asked for
(buffers and textures tallied at creation in `engine/device.js`, minus destroyed ones; the JS heap and the device's GB
where the browser tells: Chrome only); a failed pipeline's name and message; the crash log's line; the adapter (vendor,
architecture, description); the UA, short; the errors (the count and the last three, the page's uncaught errors and
rejections included). The frame writes two numbers into fixed rings; the text is built on a 250 ms timer outside the frame
(≤ 4 updates a second, measured < 0.1 ms each) and written only when it changed. `?diag` also asks for the GPU timer.
**The crash log:** iOS kills a tab that runs out of memory and reloads it with nothing to catch; the page keeps a small note
(`velia.v2.diag.last`: alive, the level, the GPU MB, the frames, the last errors) every 5 s and closes it on `pagehide`. A
visit that finds it still alive prints "last visit may have crashed (… s ago; L1, GPU 412 MB, 900 frames; <its last error>)".

**Never a black screen.** No WebGPU: the card ("needs WebGPU", the link to the current Velia). A pipeline that fails to build
(a module Safari refuses), a device lost before the first frame, or a throw in the boot: the same card with "could not start
its graphics on this device", the failing pipeline's name and message as its small print and in the panel
(`reg.failure`). Tested by rejecting the tonemap's pipeline in the page.

**Safari's WGSL (`engine/wgsl-lint.js`, `v2/tests/pages/safariWgsl.page.mjs`).** The page test collects every module the
real page builds (`__velia.wgsl()`: the registry's texts) on a live Sail page at L0, L1 and L2 (MSAA 1) with the birds and a
storm capture (69 distinct modules) and lints them. Rules and sources (read 2026-11-13): reversed smoothstep edges
(low > high, both known numbers: the WGSL group made it a module-creation error for const-expressions,
gpuweb/gpuweb#4561 and https://github.com/gpuweb/gpuweb/wiki/WGSL-2024%E2%80%9004%E2%80%9030-Minutes; Chrome's Tint later
relaxed it to low == high, https://dawn.googlesource.com/dawn/+/fedd80c74b5e614196c95843923db2a11ea49a03, so Chrome passes a
module Safari refuses whole: Cold Smoke's iPhone black screen, its `b735e8c`); equal edges; reversed const clamp bounds
(https://www.w3.org/TR/WGSL/#clamp-builtin); f16 without `enable f16`; f32 literal overflow (WGSL § 3.5.2). **Before: 46
hits (30 source sites: the terrain's beach and open-flat masks, the bake's and the scatters' shared beach rule, the water's
foam onset, v1's boat materials (14), the cockpit (5), the kayak skin (3), the birds' fringe, the stars' air band). After:
0.** Each was rewritten `1.0 - smoothstep(lo, hi, x)`, the same value (the Hermite curve is symmetric). The lint is our own
(Cold Smoke's `fixSmoothstep` rewrites at run time; nothing of its code is ported, so no ATTRIBUTION row).

**Touch (`v2/tests/pages/phoneTouch.page.mjs`).** iPhone 16 Pro (402 × 874 at DPR 3, Safari's UA), Playwright's iPhone 13 and
Pixel 7, each upright and sideways: the viewport meta, `touch-action: none` on the canvas (and no callout or selection),
`overscroll-behavior: none`, the canvas at `100dvh` (the visible height under Safari's bars), Safari's own pinch
(`gesturestart`) stopped; no overflow; a swipe and a pinch leave the page unscrolled and unzoomed; upright (#2), v1's slots
are up (no helm strip) and the slot's wheel turns the rudder; sideways, the cockpit's wheel turns the rudder, a finger reaches every winch step and 4 taps on the main's ▼ pull it in 8°
(▲ eases it 8°), every target ≥ 44 px. **#30:** helmStyle.js shows the cockpit's ▲ ▼ only under a hovering pointer; that rule hid
the touch row too (opacity 0, no pointer events), so a tap fell on the canvas and the sheet only drifted with the hand's start ease.
station.js's `TOUCH_STEPS_CSS` keeps the touch row up (`v2/tests/station-steps.test.mjs`: N taps of each step, crew trim off). Only a real phone can confirm Safari's WebGPU and WGSL compiler, its gestures (Chrome's emulation has
no Safari gesture engine), the bars' resize, the safe areas, memory pressure and the GPU's speed.

**Tools.** `node tools/v2-phone-shots.mjs --base <v2 url> [--sizes 390x844,844x390] [--rounds 3]`: each level pinned, the
panel on, `?gov=0`, DPR 3: the page's PNG, the backing and the Mac's GPU median → `renders/phone/`.

## The phone speed pass (perf(v2) phone, 2026-11-13 night: engine/quality.js, diag.js, sweep.js, frame.js; render/water.js, clouds.js, shadow.js, boat.js)
The owner's first iPhone 16 Pro results (Chrome 157 on iOS 26.7.1, and Safari 26.6 on iOS 18.7): **the follow camera at
L2 ran 42–66 ms of GPU** at 0.28–0.31 Mpx (the governor at scale 0.67–0.72), with MSAA 4 still on (the page booted at L1 and
settled to L2; MSAA 1 waited for the next load). In Safari the helm view cost the same as the follow view (39 vs 42 ms), so
most of the phone's time is **fixed per frame**, not water pixels. On the Mac at phone size the same holds: at 603 × 990
the frame is ≈ 2.0 ms, of it the compute passes ≈ 1.1 ms (water-sim 0.45, aerial 0.17, forest 0.16, cloud-key 0.10) and the
scene ≈ 0.9 ms. The phone is 15–25 × slower than the M5 Pro on the same work.

**What changed**
- **Phones boot at L2** (MSAA 1 from the first frame; a weak phone at L3). The guess: an iPhone or an Adreno 7xx L2, other
  phones L3, ≤ 4 GB one lower, a software adapter L3. MSAA, the cloud key and the boat's shadow map size pipelines and
  textures, so a live step still lists them as "next load" (making MSAA live would mean every scene pipeline twice at load:
  not taken). **Superseded by #31 (§ MSAA live):** MSAA now changes live, the second set built in the background.
- **L3** for weak phones: 0.45 Mpx, DPR cap 1.25, the forest's reach × 0.4, the terrain shadow every 24th frame; the phone path.
- **The phone path** (L2 and L3; live rows `waterGrid`, `waterAniso`, `waterLite`, `cloudEvery`, `simEvery`, `airEvery`; every
  pipeline, sampler and index buffer is built at load, so 0 pipelines after the first frame at every level):
  - *the coarse water grid*: every other vertex of the same 321² grid (a second index buffer, the same vertex shader): 51 k
    triangles for 205 k, a 0.33 m first cell growing 12 % a cell, the same 40 km edge;
  - *anisotropy 2* on the cascades (a second bind group with its own sampler; 8 on the full path);
  - *the lite water* (`water-lite`, `WATER_DRAW_WGSL(fs, wake, true)`): the mirror's land at 3 taps and the clouds' key at 2,
    each cloud tap filtered over twice the spacing from the key's mip chain (`LITE_TAPS`); the ground height read once a
    vertex and interpolated (the full water reads the nested grids once a pixel);
  - *half-rate compute*: the FFT sim (evolve, FFT, assemble, mips; the wake's maps still every frame), the aerial pass (the
    froxels and the land's mirror) and the cloud key's step (the march, the blend, the mip chain), each every 2nd frame;
  - *the boat's shadow map at 1024²* (4 MB cleared and stored a frame instead of 16 MB; the PCF reads the map's own size).
- **Tile-friendly pass ops** (every level): the terrain shadow's "keep" frames (11 of 12 at L2) encoded an empty render pass
  on its 2048² depth map with load and store; a tile GPU loads and stores the whole 16 MB with no draw. Now no pass at all
  (the encode returns false; the timer reads 0 ms). The composite clears the swap chain instead of loading it (its triangle
  covers every pixel). The scene's MSAA colour and its depth were already discarded (the depth stored only for the storm's
  bow). Tried and dropped: an empty compute pass in the keep pass's place (0.3 ms on the Mac between render passes).
- **The governor and the ladder read the busy span** (below), not the passes' sum. (fix(v2), 2026-11-14: they now read the GPU's work, the span less its idle: § The governor on the GPU's work.)
- **`?levers=none | all | grid,aniso,lite,clouds,sim,air`** pins the phone path's rows over the level's (the A/B on a phone or
  in `tools/v2-perf.mjs`); `?quality=3` pins L3.

**The diag panel's new lines** (an example)
```
frame 33.4 ms avg · 42.0 worst (2 s) · CPU 3.1
GPU 30.00 ms avg · 35.10 worst (busy span; passes sum 42.0)
passes scene 25.0 · water-sim 6.00 · cloud-key 3.00
  aerial 2.00 · forest 1.50 · boat-shadow 1.00
pace 60 Hz display (budget 16.7 ms) · scale 0.72 (floor 0.60, 3 cuts)
  GPU-bound: busy 30.0 ms > 16.7 ms of 60 Hz (frames pinned at 30 Hz: every 2nd vsync)
quality L2 · phone path: grid, aniso 2, lite, clouds 1/2, sim 1/2, air 1/2
```
- **GPU** is the frame's *busy span*: the first pass's start to the last pass's end, capped at the sum. A tile GPU overlaps one
  pass's vertex work with the last one's fragments, so the passes' sum runs past the frame (Safari: 42 ms of passes in
  33.4 ms frames). Trust the span; the sum stays beside it.
- **passes**: the top 6 passes by GPU ms, averaged over the last 2 s (each resolved frame once), compute passes included.
- **pace**: the measured refresh (the rAF median, snapped), the governor's scale, its floor and cuts; then the verdict:
  GPU-bound (the span over the budget), CPU-bound (script over 80 % of it), or "not GPU-bound" (the GPU fits: vsync pacing
  or the page), with "frames pinned at 30 Hz" when the frame is a whole number of vsyncs.
- **quality** names the phone path's levers that are on.
- **Loading**: "quality – (loading: terrain)"; no backing before the first frame and no "cap undefined" (was "Lundefined",
  the canvas's default 300×150).
- A tap folds the panel to four lines: fps, GPU, the level, the errors.

**`?diag=2`: the sweep (`engine/sweep.js`)**, so one screenshot says where the phone's time goes. Once the level has settled
(≈ 10 s), the page takes each case in turn: each scene draw dropped (water, terrain, forest, sky, boat, towns, kayaks+birds,
cockpit), each compute and shadow pass skipped (not encoded), each phone-path lever flipped. 0.4 s to settle and 1.2 s of
the busy span without and with each; ≈ 70 s for 21 cases; the governor and the ladder wait. The panel counts down
("sweep 5/21: forest · 52 s left"), then prints:
```
sweep parts ms: water 12.0 · terrain 3.1 · forest 1.0 · sky 0.4
  boat 0.3 · …
sweep passes ms: water-sim 4.0 · cloud-key 2.0 · aerial 1.1 · forest 0.9
  …
phone path saves ms: sim 2.0 · lite 1.5 · grid 1.1 · aniso 0.8
  air 0.6 · clouds 0.5
```
A part's number is what it costs; a lever's is what the phone path saves against the full path. On the Mac the sweep is
noise (a light load at 60 Hz runs the GPU at a low clock, so dropping work can even read slower); a phone that is GPU-bound
at 30 Hz keeps its GPU pegged, so the differences hold. `node tools/v2-phone-sweep.mjs --base <url> [--size 402x660 --dpr 3
--quality 2 --rounds 3]` runs it in headless Chrome.

**Measured on the M5 Pro Mac** (`tools/v2-perf.mjs`, `renderOnce` floods, 5 rounds × 120 frames ABBA, the per-round
difference; main b96cc3db served beside this branch, `?quality=2` on both; load average 13–20 from other sessions, so the
ranges are wide):

| Pose | 603 × 990 (the phone's L2 backing at scale 1): main → this branch | Δ median (range) | 1206 × 1980 (4 × the pixels: a pixel-bound proxy) | Δ median (range) |
|---|---|---|---|---|
| Sail start, 13:00 | 1.97 → 2.51 ms | −0.19 (−1.73 to +0.76) | 3.81 → 2.85 ms | **−0.74** (−1.91 to −0.50): −20 % |
| follow, 18:45 | 2.06 → 1.86 | **−0.16** (−0.39 to +0.33) | 4.79 → 3.64 | **−1.15** (−1.25 to −0.57): −24 % |
| cam A | 2.02 → 1.37 | **−0.69** (−3.8 to +0.34): −34 % | – | – |

Triangles at the Sail start: 596 k → 442 k. The phone path alone at 603 × 990 (`?levers=all` against `none`, the same
build): −0.08 to −0.10 ms of ≈ 2 ms; each lever alone was under the noise there. The terrain shadow's keep fix shows only in
a tile GPU's bandwidth (the Mac's numbers do not move); MSAA 4 → 1 was measured in the speed pass at −0.8 to −1.4 ms of
5.3 ms at 4.1 Mpx (−15 to −25 %).

**Look** (the phone viewport 402 × 660 @3, `?quality=2`, the Sail start at 13:00, `renderOnce` × 30; % of pixels over 8
levels against main's L2): the tile ops and the 1024² boat shadow alone 0.13 %; the coarse grid 9.5 % (the waves' crests sit
a little differently: a geometric resample, the same look); anisotropy 2 1.2 % (grazing water); the lite water 5.6 % (the
shallow band near the shore smoother, the far mirror's cloud and land edges softer); the three half-rate passes 0.19 % in a
still (their change is in time: the waves step at 30 Hz when the page runs at 60); all together 16.2 %, max 211 levels at
the waves' crests. The navy, the sun's path and the boat's reflection hold. **L0 and L1 do not change** (the levers are off
there; the tile ops are pixel-identical): the goldens run at L0 and pass with no re-bless.

**The phone's expected frame** (the Safari settle: 42.4 ms of passes at 0.31 Mpx with MSAA 4): MSAA 1 from the first frame
(−15 to −25 % on the Mac; likely more on a tile GPU, where 4 × rgba16float samples shrink the tiles), the phone path (−20 to
−24 % on the Mac's pixel-bound proxy, −8 to −34 % at phone size) and ≈ 40 MB a frame less of shadow-map traffic put the
follow camera at **about 22–28 ms**: inside the 33 ms first step, not yet the 16.7 ms goal. One `?diag=2` screenshot
confirms or refutes it (the GPU span) and names the next cut (the sweep). Next cuts in reach if the sweep points there: the
forest's cull every 2nd frame, the 2.1 m cascade dropped at L2, 128² FFT cascades, an `rg11b10ufloat` scene target where
the browser can render to it.

## The phone speed pass, round 2 (perf(v2), 2026-11-14 night: engine/frame.js, sweep.js, diag.js, governor.js, quality.js; render/shaders.js, water.js, boat.js, clouds.js)
The owner's `?diag=2` screenshot (2026-11-13 23:41, iPhone 16 Pro, Chrome 157 on iOS 26.7.1, L2 with the phone path, 603 ×
1026 = 0.62 Mpx at scale 1): **GPU 19.98 ms busy span (40.99 worst)**, frames pinned at 30 Hz; passes scene 5.70,
composite 5.10, water-sim 3.69, boat-shadow 1.78, forest 1.28, cloud-key 0.96; the sweep's numbers half negative. Then,
with Low Power Mode off, still 30 fps.

**1. The composite's 5.1 ms was never the composite.** On the Mac the same pass at 603 × 1026 is 0.017 ms. A pass's
timestamps on Apple's tile GPU are its vertex stage's start and its fragment stage's end; the composite's 3 vertices start
while the scene's fragments still run, and its fragments wait on the scene's colour, so its "time" was the scene's tail.
The Mac shows the same thing once the depth binding is gone (Chrome no longer serialises the passes for the depth's layout
change): the composite's raw time jumps to 0.6–1.1 ms while its own share stays 0.016 ms. The phone's sum of passes ≈ its
span, so the scene's real cost is ≈ 10.8 ms, not 5.7. **What changed:**
- **Each pass's own share** (`engine/frame.js` makeTimer): its end minus the later of its start and every earlier pass's end.
  The shares add up to the span less its idle time. The panel's line is now `passes (own ms) …`, and the GPU line adds
  `idle X` when the span holds gaps; `stats()` carries `gpuSpanMs`, `gpuSpanMedian`, `gpuSpanP90`, `gpuPassOwnMedian`.
- **Three composite variants** (`render/shaders.js` TONEMAP, picked a frame from the storm rows the frame writes): `plain`
  (no storm: the tonemap alone, no depth bound, no grade code), `storm` (the grade without the rainbow's terms, no depth),
  `bow` (round 1's full shader, depth read while the bow shows). The same pixels as before in every state (the storm pose
  0 px against main; the L0 goldens unchanged). Own time on the Mac: 0.025 → 0.016 ms clear, 0.107 → 0.028 ms in a storm.
  The tonemap is already minimal (one load, ACES, the sRGB curve): nothing more to take on a phone.

**2. water-sim.** The diag's average did include the half-rate frames: round 1 encoded the pass on every frame (only the
wake's maps on the off frames), so the 3.69 ms average is ≈ 7 ms on the step frame and ≈ 0.3 ms on the other. Round 2
(the phone path, L2 and L3; `?levers=` names in brackets):
- **split** (`simSplit`): the half-rate step spread over the two frames: the evolve and the rows' FFT on one, the columns'
  FFT, the assemble and the mips on the other (the P and Q buffers are read by nothing else between). The cloud key's step
  and the boat's shadow moved to the frames the aerial pass skips. No frame carries every half-rate pass, so the worst frame
  drops toward the average; the average does not change.
- **cascades 3** (`waterCascades`): the 2.1 m cascade (slopes only; the readback never carried it) runs one sim step in 64
  (`FULL_EVERY`); after it, its slope layer is flattened to its measured roughness (the top mip's moments at every texel of
  mips 0–7: `FLAT3_WGSL`), so the sun's path and the mirror keep their width; the near water loses the finest ripples'
  normals. 25 % of the evolve, FFT, assemble and mip work.
- **fused** (`waterFused`): the mip chain in 4 dispatches for 16 (`MIP4_WGSL`: four levels a dispatch from a 16 × 16 block
  in workgroup memory, each rounded to f16 as a store rounds it).
- **The readback fixed** (every level): the window is copied only on a frame whose assemble wrote it, labelled with that
  step's centre and the waves' own time. Round 1 copied every frame with the frame's centre while a half-rate window still
  held the last step's origin.
- **Not taken: 128² FFT grids.** The CPU's readback (`sim/surface.js`), the h0 tables (`sim/spectrum.js`) and every shader
  share N = 256; at 128² each cascade loses its top octave and gaps open between the cascades (a look change on every
  wave), for about the saving the three levers above give together.
- **Mac, per pass (603 × 1026, L2, 5 rounds ABBA against main; load average 6–30 from other sessions):** water-sim 0.373 →
  0.283 ms (Sail start) and 0.495 → 0.374 (18:45) in one run, 0.526 → 0.379, 0.486 → 0.410, 0.483 → 0.320 (storm) in a
  second: **−16 to −34 %, −24 % typical.** On the phone's 3.69 ms: **≈ −0.9 ms** on average, ≈ −1.8 ms on the step frame.
- **The boat's motion against L0** (`tools/v2-boat-motion.mjs`, 30 s of 120 Hz steps, wind 7 m/s, the start heading held):
  RMS heave 0.0328 m (L0 0.0330), RMS pitch 0.968° (0.964°), mean speed 5.099 kn (5.093); largest moment-to-moment
  difference from L0 5 mm of heave, 0.23° of pitch, 0.061 kn, 0.15 m of track. Round 1's L2 read 1 mm, 0.03°, 0 kn: the
  window now lands every 2nd step (a one-frame-older surface), not every step with a wrong label.

**3. boat-shadow** (`boatShadowEvery` 2): the map redrawn on every 2nd frame (the frames the aerial pass skips); between,
no pass at all (the encode returns false) and the light's matrix follows the boat's move since the draw (M · T(−d): the map's
boat sits where the boat was), so the shadow moves with the hull and only a turn or heel of one frame lags; the sun going
on or off always redraws. Mac: 0.065 → 0.026, 0.099 → 0.041, 0.106 → 0.040 ms (**−58 to −62 %**). On the phone's 1.78 ms:
**≈ −1.1 ms**. 512² was not taken (the 1024² map at L2 is already soft on the rigging's shadow).

**4. The scene.** The old sweep's towns 2.8 and sky 2.8 were its noise (the same run read water −2.2 and kayaks+birds
−3.0). Neither draw does work at the Sail start's view on the Mac (the towns' shore is frustum-culled to a few instances; the
sky's fullscreen triangle fails the depth test wherever anything was drawn). The composite finding moves ≈ 5 ms back into
the scene, which makes the scene ≈ 10.8 ms of the phone's 20: the next round's target, read from the new sweep's parts on
the phone (the water's fragment was 60–70 % of the scene in every Mac profile).

**5. The refresh, the verdict, the governor and the ladder** (the coordinator, 2026-11-13: Low Power Mode off, still 30 fps).
A 20 ms span on a 60 Hz display misses every vsync and presents on the next, so the frames land 33.3 ms apart, the same as
a display pinned at 30 Hz; round 1's probe read the rAF intervals alone and said "30 Hz display", and the ladder's budget
became 33.3 ms ("on budget").
- **The probe** (`engine/governor.js` createRefreshProbe, refreshEvidence, idleBudget): an interval is evidence of the
  refresh only when the frame could not have been quantized (no GPU timer, an interval under 22 ms, or a span under 45 % of
  it). The page also measures the refresh while it loads (`idleBudget`: the lowest third of the rAF intervals before the
  first frame; nothing is drawn yet). GPU-bound frames give the load's reading (else 60 Hz); a 30 Hz reading from frames
  never wins over a faster load reading. The panel says `budget 16.7 ms, measured at load` (or `assumed`).
- **The verdict:** `GPU-bound: misses 60 Hz by 3.3 ms (busy 20.0 of 16.7), quantized to 30 Hz`.
- **The ladder** settles a display slower than 40 Hz against 60 Hz's 16.7 ms too (a phone in Low Power Mode stores its real
  capacity), and stores the busy span it decided on with the level (`measured { spanMs, level, px, hz }`, in the `why` and
  the stored record: `stored: settled here before (2026-11-14; 18.1 ms busy at L2, 0.62 Mpx, 30 Hz)`).
- **The governor** on the GPU span cuts at 1.05 × the budget and raises under 0.85 × (`slowK`, `fastK`; the frame-time
  fallback keeps 1.2 / 1.05). Round 1's 1.2 × never cut a frame that missed every vsync (17.5–20 ms on 16.7).
- **What the phone does now** at the screenshot's 20 ms: the settle projects L2 at 20 ms (over 16.7 × 1.1) and steps to L3
  (0.45 Mpx, the forest × 0.4). With round 2's cuts (≈ 18 ms, below) it keeps L2 (≈ 18 ≤ 18.4) and the governor takes one
  10 % scale cut (603 × 1026 → 543 × 923; 18 × (0.25 + 0.75 × 0.81) ≈ 15.4 ms). The GPU cuts come first, then the scale.

**The sweep, rebuilt** (`engine/sweep.js`). Each case alternates short blocks with and without it, 8 pairs in ABBA order,
4 frames a block (the first dropped: a state change's own frame), and every frame carries a tag through the GPU timestamps
(the frame graph's `setTag`), so each busy span is booked to the state that drew it, never to the frame that read it back.
A block's median, a case's median of its pairs' differences, the spread (half the interquartile range) printed beside it.
26 cases (the round-2 levers and `composite`: the tonemap against a flat fill), ≈ 1660 frames: ≈ 28 s at 60 Hz, 55 s at 30.
```
sweep (busy span, 8 ABBA pairs a case, 3 frames a block; median ± half IQR)
parts ms: <part> <ms> ±<spread> · … (3 a line, the largest first)
passes ms: <pass> <ms> ±<spread> · …
phone path saves ms: <lever> <ms> ±<spread> · …
```
**Reliability on the Mac** (`tools/v2-phone-sweep.mjs`, 3 sweeps of each build at 603 × 1026, L2, load average ≈ 28):
the standard deviation of a case across the 3 sweeps, median over the 20 shared cases, **0.80 ms (old) → 0.17 ms (new)**,
worst 1.66 → 0.63 ms. The Mac's parts are mostly under 0.3 ms, so signs still flip there; a phone at 20 ms resolves them.

**Look at L2** (603 × 1026, 30 headless frames against main's L2): the round-1 lever set on this build is **0 px** against
main at 18:45 and in the storm (the composite variants, the readback fix and the timer change nothing on screen). Each new
lever alone at 18:45: split 7.2 % of pixels over 8 levels (a time shift: the boat's float reads a one-frame-older window,
so the follow camera sits millimetres off; no look change), cascades 3 6.9 % (max 101 levels: the finest ripples near the
boat softer; the navy, the sun's path and the reflections hold), fused 0.016 % (max 34: f16 rounding in a few texels),
boat shadow 0.035 %. All together 11.6 % over 8 levels at 18:45, 4.7 % at 13:00. **For the owner's eyes before merge.**
Captures: `renders/round2/shots/f1845-L2/{base,new,new-diff}.png`, `renders/round2/shots/f1845-levers/*.png`.
**Flicker** (`tools/v2-flicker.mjs` at 603 × 1026, L2, main → this branch, tstd / jump): 13:00 7.303 / 0.077 % → 7.049 /
0.056 %; 18:45 14.169 / 1.645 % → 13.621 / 1.346 %: a little steadier (fewer fine ripples to alias).

**The phone's expected span** (the owner's numbers, Low Power Mode on): 19.98 − 0.9 (water-sim) − 1.1 (boat shadow) ≈
**18 ms** at scale 1, then ≈ 15.4 ms after the governor's one cut: under 16.7 ms (60 Hz without quantization), **not yet the
14 ms target**. Low Power Mode also lowers the GPU's clock, so the same frame with it off should read lower; the next
`?diag=2` screenshot gives the own shares and the sweep's scene parts for the next cut (the water's fragment).
Tools: `tools/v2-ab-levers.mjs` (the levers in one page, ABBA, renderOnce), `tools/v2-boat-motion.mjs`; `tools/v2-perf.mjs`
now reports the span, its p90 and each pass's own share.

## The governor on the GPU's work (fix(v2), 2026-11-14 morning: engine/governor.js, quality.js, diag.js, sweep.js, frame.js)
The owner's iPhone 16 Pro (Safari, 2026-11-14 07:21, deployment a1f42146, `?diag=2`, upright): **59.7 fps, frames 16.7 ms**,
yet "GPU 22.50 ms avg (busy span; passes sum 23.1; idle 11.7)", "pace 56 Hz display (budget 18.0 ms)", "GPU-bound: misses
56 Hz by 4.5 ms", the scale at its floor (0.60, 4 cuts), L2 upright and L3 sideways. The picture was blocky: about 0.2 Mpx
on a 2622 × 1206 screen.

**The cause (confirmed from the screenshot's own numbers).** The busy span runs from the frame's first pass start to its
last pass end. On the phone it held 11.7 ms of idle gaps between passes (the GPU waited, or ran the neighbouring frames'
passes: a 22.5 ms span in 16.7 ms frames means frames overlap on the GPU). The passes' own shares add to 10.8 ms (scene
4.53, water-sim 3.78, boat-shadow 1.53, terrain-shadow 0.46, cloud-key 0.27, composite 0.22), 65 % of the 60 Hz budget.
The governor and the ladder read the span, so a page that held 60 fps read as 4.5 ms over budget and was cut to the floor;
the ladder's in-play step (two windows over 1.3 × the budget at the floor) took landscape to L3 and stored it. The 56 Hz
came from the probe's median of 60 intervals with load hitches in it (18.0 ms), kept as measured because it was more than
6 % from every known rate.

**What changed**
- **The cost is the GPU's work** (`frame.js` makeTimer: `work` = the passes' own shares summed = the span less its idle;
  `stats()` adds `gpuWorkMs`, `gpuWorkMedian`). The governor, the ladder, the refresh probe and the sweep read it.
- **The governor** (`GOV_WORK`, used whenever the GPU timer exists) also reads each frame's rAF interval and the pixel-bound
  part of the work (the scene's and the composite's own ms):
  - *frames on vsync are never cut* (their 1 s mean interval ≤ 1.1 × the budget: nothing to win);
  - a cut needs the work over the budget and the frames off vsync, two windows running; it goes straight to the scale whose
    projection fits 0.95 × the budget (the fixed part, the compute passes and the shadow maps, stays; the pixel part scales
    with the scale squared), 5 to 20 % a step;
  - a raise needs 5 windows in a row with room for at least a 3 % step inside 0.95 × the budget, 8 s after the last change,
    and goes to the largest scale that fits (at most 25 % a step). The projection treats the whole scene pass as
    pixel-bound, which over-states a raise's cost, so a raise it allows holds;
  - *hysteresis*: a raise cut again within 15 s sets a ceiling at that scale for 2 minutes;
  - `gov.state().why`: why it holds, cuts or raises (`cut 1 → 0.86: work 19.3 ms > 16.67, frames 33.33`; `raise 0.6 → 0.75:
    work 10.8 ms, 13.9 projected`; `hold: frames on vsync, raise in 3 s`); the panel prints it, short, so the panel stays
    under 420 px tall on a 390 px phone (`diagQuality.page.mjs`).
- **The ladder** reads the work and the frames' interval too: frames on vsync never step down. The settle keeps a level
  whose projection at the governor's good scale (0.85: 72 % of its pixels) fits the budget (or at full pixels 1.1 × it, as
  before); the step up still needs the full pixels inside 0.8 × the budget. 60 calm windows step up; a step up stepped down
  again within 60 s needs 120 calm windows the next time.
- **The refresh**: the lower quartile of the intervals (a late frame only lengthens an interval), always snapped to the
  nearest known rate (240, 165, 144, 120, 100, 90, 85, 75, 72, 60, 50, 48, 30 Hz): the owner's hitchy first second reads
  60 Hz. A ProMotion iPhone's Safari runs at 60 Hz by default and reads 60; a 120 Hz Mac reads 120. The probe's "is this
  interval evidence" rule reads the work, not the span.
- **The stored level** carries `measured { workMs, level, px, hz, metric: 'work' }`. A record without `metric: 'work'` (every
  record a1f42146 and earlier wrote, measured on the span) is stale: the page boots at the guess (an iPhone: L2), the panel
  says "stored L3 (2026-11-14) was measured on the busy span: re-measuring", and the settle stores a fresh record.
- **Without a GPU timer** (Safari or iOS without `?diag`, `?timer=0`; BACKLOG-v2 #32's work-done probe, reconciled here): the
  governor runs the same rules with the probe's span (submit → `onSubmittedWorkDone`, an upper bound on the GPU's busy time)
  as its cost, never over the frame's interval, and the interval alone until the probe has 8 samples; with no pixel split it
  takes 75 % as pixel-bound. So it never cuts frames on vsync and raises only when the probe shows room (an upper bound: a
  raise it allows holds). The ladder keeps the interval as its cost and reads the probe for its step ups (#32); its stored
  records carry `metric: 'vsync'` with `vsync: true`, which the next visit may retry one level up (once in 3 days).
- **The sweep** books the work, not the span (the span's idle moved with the pacing, not with the case), and prints a case
  only when its spread (half the IQR of its pair differences) is smaller than its value; the rest go on one line,
  `unclear (spread ≥ value): towns, sky, …`.
- **The panel**:
```
GPU work 10.80 ms avg · 13.10 worst (span 22.5, idle 11.7)
passes (own ms) scene 4.53 · water-sim 3.78 · boat-shadow 1.53
pace 60 Hz display (budget 16.7 ms) · scale 0.86 (floor 0.60, 1 cuts)
  on budget (60 Hz): frames on vsync
  governor hold: frames on vsync, no room up
```
  The verdict says "on budget" whenever the frames hold the refresh, whatever the GPU reads; "GPU-bound: misses 60 Hz by
  X ms (work Y of 16.7)" only when they miss it and the work is over 95 % of the budget.

**Simulated on the Mac** (`v2/tests/phone-governor.test.mjs`): the page's own loop (the governor, the ladder, a level step
resetting the scale) against a model of the phone built from the screenshot: 6.04 ms fixed (water-sim, both shadows, the
cloud key), 4.75 ms of scene and composite at 0.215 Mpx (L2 at scale 0.60 on Safari's 402 × 660 upright box), all of it
taken as pixel-bound (conservative), ± 5 % wobble, and a GPU queue that presents on the vsync after a frame finishes.
- *Before* (the span with its 11.7 ms idle, round 2's rule): the scale sinks to the floor, 0.60, at 60 fps.
- *After*, upright: L2 kept, **scale 0.863 (0.445 Mpx, 2.1 × the screenshot's pixels)**, work 15.9 ms, 60.0 fps, steady
  from 5 s to 300 s (one cut from 1.0, no oscillation). From the old floor (0.60) it climbs to ≥ 0.85 in under a minute.
- *After*, sideways (the 21:44 screenshot's own numbers: 8.3 ms of work at L3, scale 0.60): the stale L3 is re-measured
  from L2, which holds at **scale 1.00 (0.70 Mpx, 3.8 × the old 0.18)**, 15.1 ms, 60 fps. On the conservative upright model
  sideways it keeps L3 at scale 1.00 (0.45 Mpx), never the floor.
- The scene pass is not all pixel-bound on the phone (the two screenshots give 22 and 12 ms per Mpx), so the real phone
  should land at or above these scales. One `?diag=1` screenshot confirms: "GPU work", the scale, and the governor's line.

Goldens run at L0 with `?gov=0` and a fixed scale: unchanged (0 px).

## Phones are landscape-only (owner ruling 2026-11-15; ui/landscape.js, ui/landscapeBoot.js, index.html's turn rule)
A phone held upright shows the landscape page turned 90° on its side (the home indicator on the right); a phone held sideways
shows it as it is; a tablet and a desktop never turn. The technique is Abyssal Garden's (MIT, `ATTRIBUTION.md`). The pieces:
- **The rule.** `rotatedFor`: a coarse pointer, taller than wide, a short side under 500 px (`src/ui/device.js`'s phone), and
  no `?portrait=1`. `index.html`'s `data-lk-keep` style turns the body under `html.lk-rot` (`rotate(90deg) translateY(-100%)`
  about the top-left, sized `--lk-rw` × `--lk-rh`, the screen's height × width).
- **The first paint.** `earlyTurn` sets `html.lk-rot` and flips the stylesheets the page starts with before the first paint:
  `v2/vite.config.js` (`landscapeTurn`) writes `(earlyTurn)((turnKit)())` as an inline script at the end of `<head>` (the
  `<!-- lk-turn -->` marker), from the same functions the module uses (`turnKit` is self-contained for that). Its flips go to
  `window.__veliaTurnFlipped`, which the module carries on. (Fix 2026-11-15: the first version hid the body until the module
  ran; on a slow phone that was a navy page and a still loading bar for about 13 s.)
- **One frame for the page's JS.** While turned, `installLandscape` (imported first by `ui/loading.js`, so before any other
  module) makes the page's own JS see the landscape layout frame: `innerWidth`/`innerHeight` swapped; a pointer's `clientX`/`Y`,
  `x`/`y`, `pageX`/`Y` (and `Touch`'s) as `x = clientY, y = width − clientX`; `movementX`/`Y` turned; `getBoundingClientRect` and
  `getClientRects` in the layout frame; `elementFromPoint(s)` taking layout points; the root's `clientWidth`/`Height` and
  `scrollWidth`/`Height` swapped. No other module knows the page is turned, so every pointer maths keeps working unchanged: the
  drag to look and the pinch (`ui/touch.js`), the one-finger tiller and rope (left / right half), the double-tap marks
  (`ui/sailMark.js`, Cruise's `markAt`), the chart's taps and drags (`src/ui/chartplotter.js`), the cockpit's wheel, winches,
  rockers, lever, trim and Pro tracks (`ui/station.js`, `src/stations/sloop/*`), the fold button, the Conditions sheet's dial and
  sun strip and its placement (`ui/topBar.js`), the bar's menus (`src/ui/viewSwitch.js`), the sheet swipes and rails of
  `ui/thumb.js` under `?portrait=1`, the Regatta labels' placement (`regatta/ui.js`), the cockpit's bake and slot sizes
  (`render/cockpit.js`), `deviceKind` (so a turned phone is `phone-land`: `lk-phone-l`, the cockpit form). The getters are patched
  only on a coarse-pointer page without `?portrait=1`, and read the native values unless turned. The browser's own hit testing
  follows the CSS transform by itself. Tests and tools: `window.__veliaTurn` (`rotated()`, `toScreen(x, y)`, `toLayout(x, y)`,
  `screenRect(el)`): a page test plans in the layout frame and taps at `toScreen` (the identity unturned).
- **The stylesheets.** They were written for a viewport, so while turned every sheet is turned in place (`flipRules`): size
  media queries swap width and height (`(max-width: 640px)` → `(max-height: 640px)`, portrait ↔ landscape, min-aspect-ratio
  a/b ↔ max-aspect-ratio b/a), a viewport unit becomes a share of the body's own box (`Nvw` → `calc(var(--lk-rw) * N/100)`,
  `Nvh`/`dvh`/`svh`/`lvh` → `--lk-rh`: innerHeight × innerWidth, the frame the hit layer and the cockpit's projection use; not the
  other viewport unit: on an iPhone launched from the Home Screen 100vh is the whole screen while innerHeight stops under the
  status bar, 2026-11-16: the canvas 59–62 px longer than the frame, the cockpit cut off, every tap a control away; each
  rule's own text is kept and restored on the turn back), and the safe-area insets move a quarter turn (the layout's top is the
  screen's right, its left the screen's top: the notch on the left, the home indicator on the right). A `MutationObserver`
  (connected only while turned) flips `<style>` and `<link>` sheets as modules add them; turning back flips them back. JS
  `matchMedia` calls with size features are not flipped (v2 has none: only `pointer` and `prefers-reduced-motion`).
- **On entering a mode on an upright phone** (`front.js` onMode, a tap; a turned page only, a sideways phone is left alone): `enterLandscape` asks for full screen, then
  `screen.orientation.lock('landscape')` (Android Chrome); refusals are silent and the turned page stands (iPhone).
- **`?portrait=1`** (engine/flags.js): the upright layouts as before the ruling (the one-thumb controls, `?thumb=0`'s slots,
  the portrait cards), for one release; then they are deleted.
- Checks: `tests/pages/cockpitDrawn.page.mjs` (turned + standalone at 390 × 844, 393 × 852, 402 × 874 with innerHeight short by the
  status bar, turned + Safari, sideways + both: the canvas is the frame, the cockpit drawn inside it, a tap on each drawn switch
  reaches it), `tests/landscape.test.mjs` (the rule, the maths, the flips), `tests/pages/landscapeOnly.page.mjs` (an upright
  390 × 844 touch phone turned, its frame and canvas 844 × 390, the cockpit; a two-finger look, the one-finger tiller's halves, a
  double-tap mark, a chart tap and a wheel drag land under the finger and match the sideways phone; `?portrait=1` unturned).

## A phone's flat controls (option C, owner 2026-11-16: ui/flat.js)
A touch phone (a coarse pointer, short side under 500 px, not `?portrait=1`) has no 3D cockpit: `main.js` never
creates or fetches it there, so `ui/sail.js` mounts no station, panel, lever column or PRO recess and calls `mountFlat()` instead.
iPad and desktop keep the cockpit (a narrow mouse window too). Everything calls the code the cockpit used: the steer ring's drag is the
wheel in the hand (`B.station({ helm })`), the sheet rings' drags and taps the winches' direct hand (`B.station({ main, jib })`,
rad, + = in; `flat.take()`), the throttle ring and Stop the seamanship's lever, Tack `tackButton.js`'s TackAssist (its pill hidden), the drawer the dock and the seamanship, Pro `setPro` and `B.ctl`. Auto is the pilot holding the
heading she has now (`B.holdCourse`, new in `sim/boat.js`; any steer on the arc calls `B.setPilot(false)`). One finger on the
water looks (`createTouch({ oneLook })`, 6 px slop so a tap stays a tap); FLAT.returnS (3 s) after the last finger the follow
camera eases back over FLAT.easeS (0.8 s, smootherstep) by writing `B.follow`'s yaw, pitch, distance and look. The game's own
small chart and wind dial are shrunk into the top corners by CSS variables. Regatta: `world.race()` (main.js) gives the race's
view and plates; the clock and the readout lines are read from the race's watch, which is hidden; `regatta/ui.js` folds the
fleet to a chip and keeps its tags off `.fl-plate`. Cruise: `world.takeHelm()`.
- The art pass (owner, 2026-11-16): one material (the top bar's `.isl` glass, hairline, shadow, type); the rings are `clip-path: path()`
  divs (frosted, their own hit area) under an SVG of hairlines, ticks, needles and the ideal-trim band (`crewSheet` ± 4°); the SVG
  carries `z-index: 1` (Chrome drew it under a backdrop-filtered sibling otherwise); one ring is the sheet and, under motor, the throttle.
- `flatLayout()` (pure) places every piece at 844 × 390 and 844 × 340 with or without an iPhone's safe area; `tests/flat.test.mjs`
  holds it to no shared pixel (`overlaps()`), 44 px targets, quarters ≥ 60 px, the rings 8 px round them, "⋯" 24 px from either ring; `tests/pages/phoneButtons.page.mjs`
  drives it with real touches (sideways and the turned standalone page) and checks the Sail, Pro, Split + motor, Recentre,
  Regatta pre-start / racing / tower / results and Cruise (with the Conditions sheet) screens for overlaps on screen.
- Removed with it: the phone's cockpit hit hacks in `ui/station.js` (the spread finger cells, the left-thumb steering zone, the
  lever strip, the idle-fade live cells, `PHONE_TOUCH_CSS`), `cockpitTouch.page.mjs`. Kept: the cockpit's phone lens and bake
  (`render/cockpit*`, used by a narrow mouse window), `?portrait=1`'s upright layouts (they still load the cockpit).

## The phone's controls (BACKLOG-v2 #2, #52, 2026-11-14: ui/touch.js, ui/station.js, render/cockpit.js setSlots, render/cockpit/rig.js slotCam)
v2's phone now takes v1's hands. Measured on v1's own page under Playwright's touch emulation (402 × 874 and 390 × 844 at DPR 3,
`renders/v2-phone-controls/tmp/measure-v1.mjs`) and held to it by `tests/phone-controls.test.mjs` and
`tests/pages/phoneControls.page.mjs`.

- **One finger on the water (v1's `src/sail/pads.js`, its `TOUCH` and `TouchSheet` imported).** The left half of the canvas is
  the helm, a tiller: steer = the finger's offset from where it landed ÷ (0.12 × the width), held while the finger stays,
  clamped at ±1 (0.06 of the width is half helm: v1 turned its rudder −0.008 → +0.212 rad in 1.5 s, v2 the same within
  0.18–0.26 rad). The right half is the sheet, a rope: each move adds dy × 200 / (0.25 × the height) to v1's TouchSheet, hauled
  at most at the winch's full rate (a finger held still holds the sheet; down pulls in, up eases). A second finger turns both
  off until every finger is up: two fingers look and pinch (v1's `TwoFinger`). Dead zone: nothing starts within 24 px of the
  bottom edge (the phone's own swipe). One finger no longer looks (v1 never did). Not ported: v1's one-finger tap that sets a
  course, and the `?lefty=1` row (the option is in `createTouch`, no URL row yet).
- **An upright phone: the one-thumb controls (owner 2026-11-15; `v2/ui/thumb.js`).** `stationForm('phone-port')` is
  `'thumb'`: the station draws nothing and flat navy buttons take the bottom band: a steer zone in the lower third (a sideways
  drag is the water's tiller, `tillerFromDrag`; a vertical drag of 12 px first is v1's rope and turns Auto trim off), a thin
  rudder arc, one action button (Tack / Gybe through `tackButton.js`'s TackAssist, Sails up with the sails down), the Auto chip
  (`B.assists.crewTrim`, on by default there), and "⋯" for a drawer with every other function (the dock's actions, the chart,
  the logbook, the views, the Menu card). Under motor a throttle rail (▲ N ▼, a drag, the release on a notch) replaces the
  action button. `html.lk-one-thumb` hides the Tack pill and M3's strip. The grid form below is kept behind `?thumb=0`
  The drawer's pairs are 72 px wide (Trim reads Auto | Manual; every label whole at 375 and 390 px). The Calm HUD's one-time
  "Tap to show the helm" stays quiet on these controls (they never fade; `createCalmHud({ quiet })`); `?thumb=0` keeps it.
  The skipper's touch lines say their `thumb` wording here (`words.js` PHRASES `thumb`/`thumbSailor`, `skipper.js` NOTES
  `thumb`/`thumbSpeak`: "drag down low on the screen", "Slide the rail up", "Tap ⋯, then Sails: Down"), and Keys › Touch shows
  `THUMB_ROWS`; the cockpit and `?thumb=0` keep the wheel and winch words (`V2_TOUCH_ROWS`: no helm strip in v2).
- **An upright phone with `?thumb=0`: the grid form (v1's portrait layout).** `stationForm()`: a desktop and a phone sideways keep the cockpit;
  an upright phone (`phone-port`) draws the wheel and the two winches each in its own small slot at v1's rects
  (`helmLayout.js portraitLayout`, used as it is: 402 × 874 → wheel 10,759 103², JIB 139,700 80², MAIN 229,700 80²; 390 × 844 →
  10,732 100², 131,670, 221,670), with v1's pads (the wheel's at 0.88 of its slot, the winches' 8 px past), tapes, sail leaves
  and readouts, and v1's keys row (SAILS · ANCHOR · PANEL · CHART) and throttle lever under them (`controlPanel.js` and
  `throttleLever.js` in their keys form, as v1 places them). M3's helm strip and IN / EASE are hidden there (`html.lk-slots`); a
  tablet keeps them (v1's tablet grid is not ported).
- **The slots' pictures.** No new art and no new pass: the bake already holds v1's own items (`hud:wheel`, `hud:winch-jib`,
  `hud:winch-main`), so each slot draws that item's meshes in the scene pass (first, in the cockpit's near depth band) with
  `setViewport` and `setScissorRect` on the slot's rect, through v1's slot camera placed in the item's frame (`SLOT_CAMS`: the
  wheel at 2.5 m tilted back 12°, 22° lens; each winch from aft and above, 30° lens, the handle's sweep in frame; near and far
  scaled by the item's scale). The light turns by the heading plus the item's own turn, as v1's item turns by −heading alone.
  The gestures' screen points come from the same cameras: the hub and each drum's top land within 1.5 px of v1's
  (`tests/phone-controls.test.mjs`). The pipelines are the cockpit's own four (0 after the first frame); +3 small uniform
  buffers and bind groups. The look differs from v1 in the materials only: v1's slots wear the boat's glTF materials, v2's the
  cockpit's (the same steel and rope as the sideways cockpit).
- **#52.** The cockpit's winch step's pointerdown lost its `on` class, `used('winch')`, `preventDefault()` and
  `stopPropagation()` behind a comment (v1's slip fixed in 38ce01ed); restored. `phoneControls.page.mjs` fails on the old line
  (no `on`, no mark, the event not cancelled).
- **Devices checked** (`renders/v2-phone-controls/`, before | after with v1 beside, `contact-sheet.png`): iPhone 16 Pro upright
  (402 × 874, DPR 3) and sideways (874 × 402: the cockpit as before), 390 × 844 upright, and a 1280 × 800 desktop (unchanged).
