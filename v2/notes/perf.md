# v2 notes: Budgets and MSAA

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.


## The performance stats panel (2026-11-25: ui/perfHud.js, main.js; ui/cockpitUp.js)

A small glass plate at the top-right (16 px in, at the top bar's 14 px top; 16.8 em wide, 15 px tabular type), desktop only
(`src/core/features.js` perfHud: not a tablet or a phone), while the cockpit is up in Sail and Regatta (`ui/cockpitUp.js`: not folded,
not Clear or Instruments, not Cruise, nothing played in the boat's place, no menu or page over it; the helm view keeps it). Lines: FPS
over the last ~1 s and the mean interval (amber under 30 fps, never red, never flashing); the worst interval of the last 5 s; the
level and the governor's scale ("L1 · 0.85×"); draws · triangles · pipelines built; the GPU memory tally (engine/device.js); the
adapter, short. GPU time is a seventh line only with `?diag` (the timer stays diag and bench only). The frame feeds a ring of twenty
250 ms buckets (typed arrays, no allocation); the text is rebuilt at 3 Hz and only while shown, each cell written only on a change.
Measured on the M5 Pro Mac, 1280 × 720, headless Chrome under load (load average ≈ 49): **0.009-0.015 ms a frame** all in (meter, rule
and the paints' share), 0.09-0.16 ms a paint. Setup › Screen › performance stats (on · off, its own key `lakeshore.v2.perfhud`);
`?perfhud=1` shows it for one load whatever Setup holds, `=0` never. Off in a capture, a `?filmui` film, a `?shot` and an automated
browser unless `?perfhud=1`, so the goldens are unchanged. The Pro nav column and the key legend follow the same cockpit-up rule on a
desktop cockpit (their own rules stay: Pro, key hints, the legend leaves in the helm view). Tests: `v2/tests/perf-hud.test.mjs`,
`v2/tests/pages/perfHud.page.mjs`.

## MSAA live (BACKLOG-v2 #31, 2026-11-14: engine/pipelines.js, frame.js, quality.js, diag.js; main.js, render/forest.js)

Before: MSAA sized every scene pipeline, so a ladder step across L1 ↔ L2 listed "MSAA" as pending until the next load
(a phone that settled from L1 to L2 kept MSAA 4 all session). Now the ladder moves MSAA live, both ways, with no hitch.

**The design: the second set built async in the background, the switch only once it is built.**
- **The registry holds each scene pipeline per sample count** (`createPipelineRegistry(device, { msaa, counts })`). A
  pipeline whose `multisample.count` is the start count is declared at every count (the descriptor copied, the count
  moved, alpha to coverage only above 1). The two whose shader or layout changes with the count are declared as a function
  of it: the forest's cards (alpha to coverage vs a plain cut) and the bow tonemap (it reads the multisampled depth or
  not; its bind group layout per count). Every shader module is made at load; only the pipelines wait.
- **The load builds the start count only** (`buildAll`): 82 pipelines as before (44 render, 38 compute). 35 are per count.
- **`buildCount(n)`** builds the other count's 35 with `createRenderPipelineAsync`, the one build allowed after the first
  frame. Nothing waits on it: the frame keeps drawing with the active set. A live page starts it once the ladder's settle
  is in (≈ 6 s); a step whose count is not built starts it at once (a pinned page, Setup's hold). A capture and a URL
  `?msaa=` declare one count (the goldens build exactly what they did).
- **The rule stands:** `use(n)` (the registry's active count) is refused, loud and counted as late, unless every scene
  pipeline at `n` is built; `get()` of an unbuilt set throws as before. No shader is built synchronously in play.
- **The switch** (`createMsaaSwitch` in quality.js, pure; `msaaSwitch` at the top of `drawFrame`): on every level step the
  level's count is wanted; once `ready(n)`, between two frames, the registry moves to `n` and the frame graph remakes its
  targets at `n` at the backing's size (`graph.setMsaa`, the composite's bind group with them). That frame's scene pass
  clears and draws every pixel, so no frame shows stale targets and none is skipped. The governor's windows restart (its
  scale kept); the ladder's own hysteresis (two slow windows at the floor down, 60 calm windows up, 10 s cooldown, twice
  the calm after a failed step up) decides the steps.
- Rejected: **both sets at load** (+35 pipelines before the first frame: +20 to +40 ms on a warm shader cache, ≈ +0.5 s on
  a cold one, for a switch most sessions never make); **building on demand only** (the switch would wait ≈ 0.5 s on a cold
  cache at the moment the ladder needs it, a struggling phone first).
- `__velia.quality.state.msaa`: `{ now, want, counts, ready, background, switches }`; each switch records `ms` (the targets
  remade), `cpuMs` (its whole frame), `dtMs` (its rAF interval), `gpuMs` (its GPU work, by its timestamps' tag) and
  `gpuBeforeMs`. `__velia.quality.prebuild()` builds the other set now. The panel's DPR line reads "MSAA 4 → 1 (building)"
  while a set builds; `stats().pipelines` adds `perCount`, `counts`, `background`.

**Costs (the M5 Pro Mac, headless Chrome; "Mac" 1440 × 900 at DPR 2, 2332 × 1458 = 3.4 Mpx, pinned L0; "phone" 390 × 844 at
DPR 3, 569 × 1231 = 0.70 Mpx, pinned L2; a fresh browser per load, 3 loads; the phone profile is the Mac's GPU at a phone's
size, not a phone):**

| | Mac | phone profile |
|---|---|---|
| Load: pipelines built before the first frame, before → after | 82 → 82 | 82 → 82 |
| Load: pipeline build ms, before (3 loads) | 868 / 2232 / 84 | 885 / 83 / 82 |
| Load: pipeline build ms, after | 87 / 121 / 131 | 120 / 90 / 127 |
| Load: first frame ms, before (3 loads) | 1712 / 3046 / 832 | 1661 / 837 / 807 |
| Load: first frame ms, after | 868 / 1061 / 1412 | 1367 / 832 / 1479 |
| Load: both sets at load (rejected), build ms | 729 / 157 / 146 | 109 / 103 / 93 |
| Background build of the other set (35 pipelines) | 496–505 ms first seen, 7–10 ms warm | 460 ms first seen, 7 ms warm |
| Worst frame interval while it builds | 16.8 ms (47 frames) | 16.8 ms |
| GPU memory (the tally), MSAA 4 → 1 | 700 → 558 MB | 274 → 244 MB |
| Steady GPU work, MSAA 4 (3 loads, median and range) | 7.03 (5.56–8.12) ms | 2.95 (2.14–3.58) ms |
| Steady GPU work, MSAA 1 | 5.67 (4.90–5.87) ms | 1.62 (1.22–1.95) ms |

The switch frame (`msaaLive.page.mjs`, 1280 × 720 at L0 ↔ L2): the targets remade in 0.0–0.2 ms, the whole frame 1.3–1.6 ms
of CPU, its interval 16.6–16.7 ms; its GPU work 4.56 ms going 4 → 1 (the frame before 5.37 ms at L0's pixels) and 3.42 ms
going 1 → 4 (the frame before 1.94 ms). Load times swing with Chrome's and Metal's shader caches (the first load that meets a
shader compiles it, 0.9–2.2 s; later loads read it back in ≈ 85 ms): the load is unchanged by this work within that noise
(the same 82 pipelines; 2 extra shader modules made, not compiled into pipelines). The tally counts textures and buffers,
not the driver's pipeline objects; the second set's pipelines are not in it.

Tests: `v2/tests/pipelines.test.mjs` (per-count declare, the start count at load, `buildCount` after seal, `use` refused
until built, a failed background build loud), `quality.test.mjs` (the ladder steps L1 → L2 → L1 across MSAA through the
switch, its hysteresis), `pages/msaaLive.page.mjs` (the live page: background build and two live switches with no frame
over 50 ms and none lost, a step before its set is built, the ladder's own prebuild, a capture with one count),
`pages/diagQuality.page.mjs` (a live step to L2 now lands MSAA 1).

## Budgets (the speed pass, measured 2026-11-13 evening on the M5 Pro Mac, headless Chrome)
Goal: 2560 × 1600 at or under 8.3 ms at every main pose, no visible look change; phone-shaped frames well
under 16.7 ms. **Met at every pose.** Method: `tools/v2-perf.mjs`, one page on main (7be7b754, served from an exported
copy) and one on this branch in the same browser, the same pose, 5 rounds of 240 frames each, the pages interleaved ABBA;
the per-pass medians of each round, then the median of the rounds and their range. The GPU was shared with other sessions
(load average 4–6, one other Chrome rendering): a single page drifted 15 → 45 ms within an hour, so the per-round
difference is the honest number. `?maxpx=5e6` so 2560 × 1600 is native.

| Pose (2560 × 1600, against main 7be7b754) | main | this branch | Δ per round (range) | this branch alone (one page) |
|---|---|---|---|---|
| Sail start (follow camera, 13:00, wind 3) | 15.55 ms (15.02–16.13) | **5.26 ms** (5.14–5.35) | −10.28 (−9.88 to −10.87) | 6.73 (5.76–7.40) |
| cam A, 13:00 | 10.77 (10.49–11.02) | **4.10** (4.05–4.22) | −6.66 | 5.08 |
| cam B, 13:00 | 8.98 (8.21–9.75) | **3.70** (3.23–3.84) | −5.18 | 4.16 |
| cam I, the island, 13:00 | 10.09 (8.28–10.35) | **4.02** (3.44–4.13) | −5.97 | 4.32 |
| follow camera, 18:45 | 17.33 (16.45–19.13) | **6.36** (5.87–6.56) | −11.42 | 6.63 |
| night, 21:36 | 12.25 (12.01–12.88) | **4.74** (4.58–5.12) | −7.56 | 5.22 |
| storm peak (150 s) | 14.12 (13.22–14.88) | **5.13** (4.83–5.43) | −8.70 | 8.03 before its own lever |
| rainbow (240 s: the bow shows, the depth is stored) | 13.54 (10.79–18.93) | **6.34** (6.22–11.2) | −6.98 | – |

**On the new trees (main f3a29fa9 merged in, 19:40, 3 rounds, the same method):** Sail start 17.51 → **6.16 ms**
(Δ −11.39, −10.95 to −11.63); cam A 12.44 → 4.37; cam B 8.88 → 3.40; cam I 9.17 → 3.59; 18:45 16.07 → 5.29; night 11.13
→ 4.09; storm peak 13.86 → 4.50; rainbow 12.26 → 5.86. This branch alone (one page, 5 rounds): 5.53 / 4.63 / 3.68 / 3.98 /
5.96 / 4.69 / 4.46 / 5.62 ms. The new forest by `--layers` on this branch: 0.35 ms at cam A, 0.50 at cam B, 0.29 at
18:45, under the noise at the Sail start (the old cards were ≈ 1.0 ms). 1280 × 720 against the new main: Sail start 11.12
→ 5.60 (a loaded run; 2.9 alone), cam A 5.75 → 2.38, cam B 4.66 → 2.31, cam I 4.13 → 2.11, 18:45 7.30 → 3.03, night 5.18
→ 2.37, storm 5.57 → 2.46, rainbow 5.31 → 3.45. Phone tier: 390 × 844 3.51 → **1.70 ms**; 780 × 1688 6.76 → **2.66 ms**.
Captures against the new main: 0.0004–0.18 % of pixels, ≤ 5 levels, 0 over the goldens' threshold.

| Pose (1280 × 720, before the merge) | main | this branch | Δ |
|---|---|---|---|
| Sail start | 6.56 (6.13–6.82) | **2.90** (2.69–2.94) | −3.67 |
| cam A / cam B / cam I | 4.79 / 4.33 / 4.58 | **2.43 / 3.51 / 3.53** | −2.35 / −1.02 / −1.15 |
| follow 18:45 / night / storm / rainbow | 7.50 / 5.68 / 6.27 / 4.82 | **3.33 / 2.89 / 3.76 / 3.48** | −4.18 / −2.85 / −3.25 / −1.35 |

Phone tier (`terrain=phone&touch=1`, the Sail start): 390 × 844 **3.42 ms** (2.79–3.87) against main's 5.12 (3.05–5.21);
780 × 1688 (a DPR-2 phone's backing) **2.92 ms** (2.63–3.16) against 6.57 (6.01–8.07). The Mac's GPU time; a phone's GPU
at 4–6 × slower puts these at ≈ 12–18 ms, so 16.7 ms holds at 390 × 844 and needs a phone measurement at full DPR.
Draw calls unchanged (38 at the Sail start); pipelines +1 compute (`cloud-blend`), 0 after the first frame.

**Where the time went (main, `--layers`: the scene's draws dropped one at a time in place, `__velia.setLayers`):** the
water's fragment was 60–70 % of the frame at every pose (Sail start: 12.2 of 18.0 ms), the terrain 0.2–1.9, the forest
≈ 1.0, the boat 0.2–0.8, everything else under the noise; the compute passes 1.4 ms in all (water-sim 0.9). Inside the
water (`?wx=` ablations on a scratch copy): the height lookup 37 %, the mirror's cloud taps 28 %, the anisotropic slope
sample 8 %, MSAA 4 12 %. And one cost no shader showed: the scene's multisampled depth written out of tile memory every
frame for the storm grade (it appeared as the composite pass's time: 6.9 of 15.6 ms).

| Lever (one commit each) | Saving (interleaved, the GPU's load at the time) | Look |
|---|---|---|
| `terrainHeight` unrolled: one bilinear function a slot, no switch inside the level loop (every user: the water, the terrain's vertex, the shadow, the mirror) | −24 % of the Sail start (41.5 → 31.4 ms under load) | 0.0008 % of pixels, 1 level (fma order) |
| the cloud key's cross-fade blended once a frame into a fourth layer (`cloud-blend`, after the march); every reader fetches one layer | −4.8 to −5.0 ms at the Sail start and 18:45 (−17 to −20 %); the blend itself ≈ 0.13 ms | ≤ 0.18 % of pixels (storm), 1 level: f16 rounding |
| the mirror's 5 cloud taps read by azimuth and elevation (`cloudAtUE`: no cos, sin, asin, atan2 a tap) | −0.8 ms | ≤ 0.008 %, ≤ 3 levels |
| the scene's depth stored only under a storm (`depthStore`: 'discard' otherwise) | −8.9 ms at the Sail start (21.9 → 10.6), −3.9 cam B | 0 px |
| the FFT's 8 stages an axis in workgroup memory (2 dispatches for 16) | water-sim 0.89 → 0.45 ms; −0.57 frame, −0.25 phone | 0 px (the readback too) |
| under a storm, the depth stored and read only while the bow shows (no bow: every bow term is 0) | −2.7 ms at the storm peak | 0 px (storm, rainbow) |

Tried and dropped (no saving, reverted): the terrain material's level loop unrolled the same way (0 px, no change); a
per-256 m-cell top-of-ground buffer to skip the water's height lookup where the lake is surely deeper than 60 m (the
Sail start, cam A and 18:45 look at Emerald Bay, shallower than that: no change); the height in the vertex stage (no
change, and 0.02–0.32 % of pixels moved).

**The goldens:** `npm run goldens:v2` passes against the blessed set with no re-bless (the largest, v2-morning 0.081 % and
v2-sail-13 0.077 %, are main's own drift against the references: this branch differs from main at those poses by ≤ 0.007 %
of pixels, ≤ 3 levels); `--twice` 0 px on all 23. **The flicker metric** (`tools/v2-flicker.mjs`, the M5c fixed pose,
main → this branch, tstd / jump): 13:00 1280 × 720 10.595 / 2.687 % → 10.594 / 2.686 %; 13:00 390 × 844 11.744 / 2.630 %
→ 11.743 / 2.628 %; 18:45 1280 × 720 27.482 / 6.452 % → 27.481 / 6.451 %; 18:45 390 × 844 19.378 / 5.735 % → 19.377 /
5.733 %: unchanged (the reflection's filtering was not touched).

**Hitches** (`tools/v2-hitch.mjs`: a live page at 2560 × 1600, `?gov=0`, a visitor's browser with the card up, the birds
on; 2 runs each; headless Chrome paces rAF on a timer, so the GPU and CPU columns carry the hitches):

| Moment | rAF worst | long tasks | CPU frame worst | GPU frame worst / median, this branch | main |
|---|---|---|---|---|---|
| ENTER, the first 300 frames | 16.8 ms | 0 | 2.5–2.8 ms | 7.0–10.2 / 6.2–6.9 ms | 15.9–19.2 / 14.0–16.5 |
| the cockpit folds (120 frames) | 16.8 | 0 | 1.1–1.2 | 7.2–8.6 / 6.4–7.6 | 15.5–19.5 / 14.7–18.3 |
| it unfolds | 16.8 | 0 | 1.2–1.3 | 7.1–8.7 / 6.3–7.3 | 15.3–19.5 / 14.0–16.0 |
| the view to the helm | 16.8 | 0 | 1.4 | 8.6–11.4 / 6.3–7.7 | 15.1–19.9 / 11.3–17.4 |
| back to the follow camera | 16.8 | 0 | 1.1 | 7.1–9.4 / 6.5–8.1 | 15.3–22.0 / 14.4–17.2 |

No frame over 33 ms, no long task, no pipeline built after the first frame. (The live page draws the cockpit too, which
the headless table does not.)

**The governor and the render scale (not used for the numbers above):** a retina MacBook's backing (e.g. 3024 × 1964 =
5.9 Mpx) is already capped at 3.4 Mpx by `?maxpx`'s default (≈ 0.76 of native a side), and the governor starts at scale 1
and cuts only on slow windows. Nothing was changed there. With the cuts above, native 2560 × 1600 (4.1 Mpx) fits the 120 Hz
budget, so the cap could rise toward native; the cost scales with pixels (≈ 0.75 ms a Mpx at the Sail start now: 2.90 ms at 0.92 Mpx, 5.26 at 4.1).

**Levers left, each a visible change (measured, not taken):** anisotropy 8 → 4 on the water's slopes −0.8 to −1.2 ms
(0.11–0.59 % of pixels over the goldens' threshold: grazing water), 8 → 2 −1.7 to −2.0 ms (0.4–2.2 %); MSAA 1 −0.8 to
−1.4 ms (0.25–0.42 %: edges and the rigging); the mirror's land taps 5 → 1 −0.7 ms and cloud taps 5 → 1 −2.2 ms (the
flicker returns: M5c's 1-tap 12.4 / 6.2 %); a coarser water mesh (K 110) −0.6 ms. The storm's bow frames still store the
multisampled depth (the rainbow pose 6.3 ms): a single-sample distance written beside the colour would take ≈ 1 ms more.

## Budgets (M3b, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians, two runs)
The boat's cost is v1's models (`?models=1`, the default) against M3's procedural hull (`?models=0`) at the same poses: the
follow camera at 13:00, v1's `cockpit-astern` close shot (the boat fills the frame: the worst case) and the 21 kn heeled
quarter view. Passes: boat-shadow, water-sim, sky-lut, aerial, scene, composite (the tile GPU books part of the scene's
fragments to composite: read scene + composite together). Run noise on the totals ≈ ±0.5 ms (the M3 note).

| Budget | M3b (models) | M3 (procedural hull, same night) | v1 (same pose) |
|---|---|---|---|
| GPU 1280 × 720, follow 13:00 | **2.56 / 2.61 ms** (shadow 0.10–0.11, scene + composite 1.60–1.62) | 2.29 / 2.74 ms (shadow 0.08–0.09, scene + composite 1.28–1.64) | 16.2 ms, 306 draws, 4.42 M tris |
| GPU 1280 × 720, close shot | **2.98 / 3.04 ms** (shadow 0.12–0.15, scene + composite 1.98–2.00) | 2.81 / 3.01 ms (1.55–1.71) | 13.0 ms, 315 draws, 4.43 M tris |
| GPU 1280 × 720, 21 kn quarter | **2.41 / 2.45 ms** | 2.64 / 3.36 ms | 20.6 ms, 211 draws |
| GPU 2560 × 1600 (`maxpx=5e6`), follow | **5.29 / 5.29 ms** | 4.98 / 5.37 ms | – |
| GPU 2560 × 1600, close shot | **6.17 / 6.46 ms** (scene + composite 5.17–5.26) | 3.86 / 4.94 ms | – |
| GPU 2560 × 1600, 21 kn quarter | **4.80 / 6.00 ms** | 4.21 / 4.80 ms | – |
| GPU phone 390 × 844 with the hands | **1.77 ms** | 2.13 ms (M3's table) | 8.8 ms |
| Boat triangles / draw calls (whole frame) | **76.5 k** follow (far LOD), **105.4 k** close (near LOD + cabin), 80.0 k quarter; frame draws 26 / 30 / 28 | 31.7 k; 19 draws | 4.4 M tris, 265–315 draws |
| Model bytes | **770,033 B** on the wire (gzip of the quantized copies; 1,801,844 B quantized; v1's 3,105,324 B raw: 24.8 %): hull 227,329, cockpit 421,277, hardware 80,136, wheel 41,291; max position error 0.068 mm | 0 (procedural) | 3.1 MB (+ KTX2 twins) |
| JS | `index-*.js` 292.0 kB raw, **109.8 kB gzip** (+8.4 kB: the loader, the material WGSL, the GPU side); the boat worker 15.5 kB raw / 6.4 kB gzip, fetched after the first frame | 101.4 kB gzip | 607 KB gzip |
| First load to a sailing boat | **1.51 MB** (1.40 MB terrain + 109.8 kB JS + 1 kB HTML): the models are not in it | 1.50 MB | ≈ 12 MB |
| Worst frame while the models stream (live, `tools/v2-stream.mjs`, 3 runs dev + 2 runs build) | **17.5–27.1 ms rAF interval**, worst CPU frame 1.8–2.9 ms, upload slice ≤ 1.3 ms, 12 upload frames, 0 long tasks, 0 pipelines after the first frame (24 at load; 27 with M5a's clouds) | ≤ 18.6 ms | – |
| First frame → the whole boat | **0.69–0.70 s** resident (worker: fetch, build 37–39 ms, image decode 43–46 ms; then 12 slices), + the 0.5 s dissolve | – (in the first frame) | the boat waits for its GLBs before ready |

## Budgets (M3, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians)
The boat's cost is read at one pose (the follow camera's eye at 13:00, pinned with `?campos/camlook`) with and without
the boat (`?boat=0`). Run-to-run noise on this GPU is ≈ ±0.5 ms on the totals (passes the boat never touches moved as
much between runs), so the per-pass deltas are the honest number: the shadow pass 0.07–0.12 ms, the scene's draws
+0.07 (2560 × 1600) to +0.5 ms (720p).

| Budget | Target | M3 measured | M2 (same night) | v1 (same pose) |
|---|---|---|---|---|
| GPU 1280 × 720, the follow camera 13:00 / 20:00 / 21 kn heeled | +1.5 ms over M2 | **2.74 / 3.03 / 3.46 ms** (boat-shadow 0.10, water-sim 0.72, sky-lut 0.05, aerial 0.18, scene 0.82, composite 0.71 at 13:00); the same pose with `?boat=0` 2.20 ms, with the boat 3.74 ms in another run (noise: its composite alone moved 0.63 → 1.08) | 1.81–1.90 ms (cam A/B) | 15.8 / – / 17.1 ms (4.4 M triangles, 265 draw calls) |
| GPU 2560 × 1600 (`?maxpx=5e6`), the same pose | +1.5 ms | **5.15 ms** with the boat, 4.81 without (+0.34: shadow 0.10, scene +0.00, the rest noise) | 3.51–3.85 ms | – |
| GPU phone-shaped 390 × 844 with the hands | – | **2.13 ms** (0.38 M triangles) | 1.34–1.38 ms | 8.8 ms |
| CPU sim a frame (the physics ticks, the float, the hands, the camera) | ≤ 2 ms on a phone | **0.1 ms p50, 0.2–0.3 ms max** on the Mac (the node test: 0.02 ms a frame on a flat sea; a 20 s settle 25 ms); a phone at 4–6× the Mac ≈ 0.5–1.5 ms | – | 3.4–3.7 ms whole-frame CPU p50 |
| CPU a frame, whole page | – | p50 0.7–0.8 ms, p95 1.0–1.2 ms (the sail refill ≈ 0.4 ms when the trim moves; the ribbons 0.05 ms; the model records) | p50 0.1 ms | p50 3.7 ms |
| First load to a sailing boat | ≤ 2 MB | **1.50 MB**: 1.40 MB terrain stage 0 (6 grids + 2 manifests) + 101 kB JS gzip + 1 kB HTML; the boat is in the first frame (no asset: procedural). The phone set's stage 1 (1.14 MB) streams after it | 1.40 + 45 kB | ≈ 12 MB desktop / 3.5 MB phone |
| JS | (M2 noted ≤ 80 KB) | `dist-v2/assets/index-*.js` 266.1 kB raw, **101.4 kB gzip** + the worker 1.8 kB: +56 kB gzip for v1's physics (src/sim/boat.js and its chain, the vessel profile), the spars and rig geometry, the wind field's full WindField, the hull builder | 122.8 / 44.8 kB | 1.98 MB / 607 KB |
| Worst frame in the first 300 after the boat appears (live page, `tools/v2-stream.mjs`, 3 runs full + 2 phone set) | ≤ 33 ms | **≤ 18.6 ms rAF interval** (16.7–18.6), worst CPU frame 1.4–1.7 ms, 0 long tasks after the first frame; first frame 110–113 ms from main.js's start, 156–162 ms from navigation | ≤ 28 ms | 120–280 ms stops (fixed earlier) |
| Pipelines after the first frame | 0 | **0** (20 built at load) | 0 (15) | 49 → 0 |
| Sailing parity, 60 s, v1's film contract on both (`tools/v2-sail-compare.mjs`: 16:00, 6 m/s from 200, the pilot on 251°) | – | max diff **heading 0.47°, speed 1.22 kn (mean 0.34), heel 1.2° (mean 0.25°), TWS 0.4 kn, position 5.3 m**; at 80 s v1 5.37 kn / 249.95° / 12.8° vs v2 5.47 kn / 250.24° / 13.1° | – | – |

## Budgets (M2, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 60 frames, per-pass medians)
The M1 baseline was re-measured the same night on the same machine (its code extracted at ebd9a3b), so the deltas compare
like with like. Apple's tile-based GPU attributes part of the scene's fragment work to the next pass's timestamps, so
read the totals; the per-pass split is indicative.

| Budget | Target | M2 measured | M1 (same night) | v1 (same pose) |
|---|---|---|---|---|
| GPU 1280 × 720 | +2 ms over M1 | **1.81–1.90 ms** (cam A 1.90: water-sim 0.63, sky-lut 0.07, aerial 0.12, scene 0.58, composite 0.50; cam B 1.81; cam B 20:00 1.84; 21 kn 1.77) | 1.10–1.20 ms | 10.8–15.4 ms (cam A/B 13:00 and 20:00) |
| GPU 2560 × 1600 (`?maxpx=5e6`) | +2 ms; total ≪ 8.3 ms | **3.51–3.85 ms** (cam B / cam A) | 1.92 ms | – |
| GPU phone-shaped 390 × 844 | – | **1.34–1.38 ms** (0.36 M triangles) | 0.95 ms | 6.65 ms (cam B) |
| Terrain bytes before the first frame | ≤ 1.5 MB | **1.40 MB** (6 grids + 2 manifests); the rest streams: 11.11 MB desktop, 2.54 MB phone | – | ≈ 12 MB desktop / 3.5 MB phone before ready |
| Worst frame while streaming (live page, `tools/v2-stream.mjs`, 3 runs dev + 3 runs build) | no frame over 33 ms | **≤ 28 ms rAF interval** (17–20 typical in headless Chrome's 60 Hz loop), worst CPU frame 0.6–1.0 ms, main thread per landing ≤ 10 ms, 0 long tasks after the first frame; the stream ends ≈ 0.6 s after the first frame on localhost | – | 120–280 ms stops (fixed earlier) |
| Pipelines after the first frame | 0 | **0** (15 built at load) | 0 (10) | 49 → 0 |
| First frame | – | 104–143 ms from navigation (build and dev, localhost), stage 0 decoded in the worker during the pipeline build | 76–130 ms | – |
| JS at first load | ≤ 80 KB gzip | `dist-v2/assets/index-*.js` 122.8 kB raw, **44.8 kB gzip** + the worker 1.8 kB (+ index.html 1.9 / 1.0 kB); 0 dependencies | 75.6 / 29.6 kB | 1.98 MB / 607 KB |
| `dist-v2/` | no v1 assets | 12 MB: 11.1 MB terrain grids (both sets' heights, the cover grids), 125 kB JS | 77 kB | 216.8 MB |
| CPU a frame | – | p50 0.1 ms, p95 0.2–0.3 ms (the CDLOD selection included) | p50 0.1 ms | p50 2.0–2.2 ms |
| GPU memory, terrain | – | ≈ 130 MB desktop (heights 26 MB, normal + albedo maps 104 MB), ≈ 28 MB on the phone set | – | – |
