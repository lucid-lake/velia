# v2 notes: The kayaks (the living lake)

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## The kayaks (the living lake: living/kayaks.js, sim/kayaks.js, sim/lake.js, render/kayaks.js, render/kayak/*)

v1's kayakers on v2's engine, the owner's hero feature (seen close and clear from the boat; cheat on where and when,
never on motion). Every decision is v1's own pure code; only the drawing is v2's.

- **Who, where, how** (`sim/kayaks.js`, a port of v1's `src/kayaks/fleet.js` without three): v1's `planFleet` (the
  day's slots, the meetings timed from Sail's start), `kayakCount` on the day's wind (v1's `dayWind` habits, level 4 counts
  1.6 ×), the routes, the agent's hull model (`stepHull`), the minds (they see the sloop, predict her closest approach and
  give way), the contact and the wash (`kayakContact`, `wakeRock`, `drift`), the levels (`pickTier`, `capFull`, `lodFor`:
  phones get v1's low tier, 1 full paddler and 3 out), appear and leave only past 250 / 400 m from the camera.
- **The first pair** (`src/sim/kayaks/first.js placePair`): laid in the camera's view ≈ 26 m off the boat, ahead and to
  port, when play starts (a capture: after the settle, before the first frame; a live page: once the terrain is whole,
  the shore grids and the asset are in, and v1's `#lk-load` card, if any, has gone); full from the first frame they show.
  The skipper's line "Kayakers off the bow." once, through Sail's hint; "Too close" and the bump line as v1's.
- **The lake terrain** (`sim/lake.js`): v1's own builder (`src/sim/lake.js buildLakeOn`, the v2 seam: moved out of
  `src/sim/terrain.js` unchanged) over v2's height field and v1's shore-distance grids for the island and the bay
  (`island-d.lsh`, `bay-d.lsh`, 318 kB, streamed after the first frame through `sim/shore-worker.js`; a build ships them).
  The test demands v1's `shoreDistance` to 1e-6 m over the bay and v1's island, mouth and places exactly.
- **The models** (`tools/v2-kayak-bake.mjs` → `assets/kayak/kayak.kyb.gz`, 1.5 MB gzip, committed; `render/kayak/asset.js`
  reads it): v1's kayak (a middle shell from v1's `buildShell` at rows 110, with v1's deck hardware and seat, 29 k
  triangles; v1's light shell past 90 m, 8 k), v1's mid-tier hull, torso, head and paddle, and the two UBC paddlers dressed
  as v1 dresses them (body with the painted clothes, PFD, hair, brows, eyes, cap, water shoes) with the held paddle: one
  24-byte vertex (snorm16 position, snorm8 normal, 4 slots, 4 weights, a material class and 3 class bytes). The bake runs
  v1's own three code in node (as `tests/kayaksLake.test.mjs` does); `--check` skins the asset against three's
  `applyBoneTransform`: within 0.7 mm.
- **The strokes** (`sim/kayak-clip.js`): v1's paddler run in node at 240 Hz per gait (rest, cruise, sprint, back, the two
  sweeps) to its steady state, its planted blade and its own pace, then one cycle at 96 phases (v1's own clip resolution):
  each of 67 slots (65 bones, the paddle, an identity) as a rotation, a translation and the figure's scale; per frame the
  phase rate and the hull's surge. Each cycle plays on a periodic C2 cubic spline through its frames (v1's `clipSpline`:
  the quaternion parts sign-aligned round the loop), so every joint's velocity and acceleration are continuous (32 frames
  played linearly judder: 19.5 hand zigzags a second in cruise, 39.8 in sprint). The bake also: makes
  each bone's roll continuous where v1's rig turned a forearm half a turn at a straight arm (a sprint's right forearm for
  4 samples, a back stroke's for 56–107: a candy-wrapper twist; no joint moves); smooths each cycle by a circular Gaussian
  (σ one frame, 2.5 for the neck and head: v1's sprint shook the head at ≈ 19 Hz) about each bone's own joint, the hands in
  the paddle's frame, each grip held at its own distance from the shaft. At run time the gaits are blended by the agent's
  weights at one phase (v1's `bakedAt` blend) about each bone's joint (a lerp of the translations blended about the kayak
  frame's origin), and in a blend each hand and its fingers are blended in the paddle's frame and put on the blended
  paddle, the arm reaching the hand by a two-bone turn (v1 solves the arms onto its blended paddle; blending the bones on
  their own let the hands leave the shaft by up to 49 cm in a cruise with a sweep). `createClips` solves the splines once
  (16 ms on the Mac).
- **The blade held** (`sim/kayak-stroke.js`): a full kayak's stroke runs at its real speed. In the
  air the phase runs at v1's pace (the clip's rate); in the water at the pace that carries the clip's blade aft through
  the kayak frame, on the stroke's mean, at the kayak's speed plus 10 % slip (dz/dt = v · 1.1: the blade stays put in the
  world and the hull slides up to it; never under 0.3 m/s past the hull, so a start from rest slips, as v1's). The two
  blend by the blade's depth (a smoothstep from 1 cm over to 2 cm under), so the rate has no step and no lag. v1's force
  (F_peak · hold · the low-speed gain 1 + 2 (1 − v/1.15)^1.2) replaces the gait's mean force in the hull model
  (`m dv/dt = F − 7.5 v|v| − 6 v`); F_peak per gait (cruise 37.9 N, sprint 70.1, back −23.5, a sweep 11.5) is fitted
  (`tools/v2-kayak-motion.mjs --fit`) so a full kayak keeps the hull model's speeds (1.31, 2.01, −1.11, 0.86 m/s) and hands
  over to the mid tier at the same speed and phase. Its moment −F · x_blade (forward and back strokes; a sweep keeps the
  hull model's mean turn) kicks the bow 2.1–2.3° away from the blade each stroke; the hull rolls toward the blade on a
  spring (ω 6 rad/s, ζ 0.5, 0.03 rad at the full force) and dips with the pull (v1's floatFull: 3 cm, 0.01 rad per unit).
  Measured (`tools/v2-kayak-motion.mjs`): slip −9.4 to −10.2 % at 0.3, 0.6, 1.0, 1.33 and 2.0 m/s (was −394 % to +26 %),
  surge 7.2 % a stroke (v1's 7.5 %), 90 % of cruise after 4 strokes from rest.
- **The blade's wobble** (BACKLOG-v2 #45, 2026-11-14): the lock carried the blade at the stroke's mean speed, so inside a
  stroke the clip's own blade ran ahead of and behind its hold: 1.6–2.4 cm of wobble in the world (the blade's centre, after
  the steady slip's straight line) in cruise, 2.3–3.9 cm in the sprint. A per-frame lock removed it but brought back the
  sprint's catch jerks. Now the speed the pace locks to is the mean blended toward the clip's local speed (its mean over ±0.02
  of phase, floored at 0.8 of the mean) by each gait's share (`STROKE.local`: cruise, back and sweeps 1, sprint 0.25).
  Measured (`tools/v2-kayak-motion.mjs --brief --centre`; male / female): cruise 2.1 / 1.6 → 0.3 / 0.2 cm, cruise at
  0.6 m/s 2.4 / 1.7 → 0.2 / 0.2, sprint 3.9 / 2.3 → 3.3 / 1.7; the tip (without `--centre`: it also pitches about the
  centre, which no pace can hold) cruise 1.6 / 2.3 → 1.5 / 1.6 cm, sprint 5.4 / 3.5 → 4.6 / 2.9. v1's judder rule as
  played: 0 a second in cruise and the blend, sprint 0.4 / 0 (as before; ≤ 1 allowed); the slip −9.4 to −10.9 %, the hull's
  speeds 1.314 / 1.278 m/s (were 1.317 / 1.281). Test: `v2/tests/kayaks.test.mjs` "the held blade stays put" (cruise
  ≤ 1 cm, sprint ≤ 4 cm, the judder rule on the played strokes in every gait and blend).
- **The head and each paddler's own manner**: the head takes back 90 % of the hull's roll (waves,
  wash and the stroke's roll: it keeps 10 %, at the neck) and turns to the sloop (the mind's glances, v1's `setLook`, and
  the sloop watched while it is within 25 m and not more than 110° round), up to 75° each side, 40 % in the neck and 60 %
  at the head, eased in two stages (0.25 s). Each paddler (its slot's seed) strokes at its own rate (±8 %, with v1's slow
  ±4 % wander), its own reach (the upper body leant ±2.5° at the waist) and rotation (±10 % of the shaft's turn), the
  hands and the paddle moved with the body so the grips stay on the shaft; the blade's hold reads that body. The first
  pair's strokes correlate under 0.5 over 60 s (a test).
- **The drawing** (`render/kayaks.js`): `kayak-skin` (the full kayaks: the shell and the figure, 2 draws each, a 67-slot
  palette per kayak; the mid tier in one instanced draw with v1's sine-swung paddle on the paddle slot), `kayak-far` (v1's
  two camera-facing quads, one draw). Lit as the boat beside them (fix/v2-boat-kayak-light, 2026-11-18: the sun through the
  transmittance LUT × the storm cell's shade, the boat's own `BOAT_LIGHT_WGSL` ambient and night light, GGX, the water's mirror
  sky, the aerial perspective, the clouds; no terrain shadow, as the boat and the water take none: a ridge's evening shadow
  left the pair dark beside a sunlit boat), the sky light by day drawn 60 % toward its grey as the land's (`LAND_SKY.desat`;
  it replaces v1's shade-side white balance), v1's sun-side compensation softened for ACES (sat 1.8, dark 0.7), nothing below
  the kayak's own waterline (v1's opaque water), the last 2 cm into the water column. +3 pipelines (with the splash's), 0
  after the first frame.
- **The water off the blades** (`living/kayaks-splash.js`, K4): v1's splash (`src/props/paddler/splash.js`).
  At each catch (the blade's centre 3 cm under, v1's hysteresis) a burst of 4 + 10 · min(1.5, s) droplets rises off the
  water at the blade's own point (the fleet's `splash` events, world: the blade read through the float's pose); after
  each exit drips fall off the tip, following it, every 0.07 s / s for 0.7 s; s is v1's strength from the blade's speed.
  Ballistic, gone when they fall back through the water; nothing is drawn on the surface (the owner, 2026-11-07: no ring).
  Drawn as v1's pale glossy drops: camera-facing discs, opaque (depth written, before the water), lit by the kayaks' own
  shading (the far tier's module with two entry points of its own), at least 0.9 px in radius; one draw, ≤ 320 drops.

| Flag | What |
|---|---|
| `kayaks=0` (or `off`) | no kayaks (v1's kill switch); on by default |
| `layers=…,kayaks` | the profiling row: the kayaks' draws run only when listed |

### Budgets (the kayaks, measured 2026-11-13 on the M5 Pro Mac, headless Chrome, 2560 × 1600, 60 frames, the scene pass's median, `?kayaks=0` interleaved; the GPU shared with other helpers)
In-page A/B (`renders/v2-kayaks/tmp/ab.mjs`): 24 alternating blocks of 8 frames with the kayaks' draws on and off on one
page (the harness's `__velia.kayaks.on`), the scene pass's per-frame median, 72 frames each side. The GPU was shared with
three other helpers' captures: the scene pass ran 6–13 ms where it runs ≈ 4.1 ms on a quiet GPU, so the deltas carry noise.

| Pose | Kayaks drawn | Triangles | Scene, on vs off | Cost |
|---|---|---|---|---|
| Sail start, follow camera, 15:00 (the pair at ≈ 57 m from the camera) | 2 full | 57 k | 13.35 vs 12.93 ms (an earlier run 8.18 vs 7.82) | +0.36 to +0.42 ms |
| The pair from 12 m (`v2-kayaks`'s pose, the worst case) | 2 full | 106 k | 6.20 vs 6.10 ms (earlier 5.21 vs 4.77) | +0.10 to +0.43 ms |
| 09:00 (the morning fleet) | 2 full, 2 mid, 1 far | 59 k | 8.89 vs 8.78 ms | +0.12 ms |
| A phone's shape (1170 × 2532, `terrain=phone`) | 2 full | 64 k | 3.95 vs 3.94 ms | +0.02 ms |

Before the size-on-screen LOD (`LOD_PX`: the middle shell over 260 px, the small parts over 120 px) the Sail start cost
+1.7 ms (106 k micro-triangles at 57 m). A phone's live page takes v1's low tier (1 full paddler, 3 out). The CPU: the
fleet's step ≈ 0.1 ms a frame (node, 6 kayaks), the plan 22–56 ms once when the fleet is made (after the first frame).

### What differs from v1
- The full tier's motion: v1 drives a full kayak by its live paddler (the rig's IK each step, the planted blade's drive);
  v2 plays v1's baked strokes at the kayak's real speed (the blade held on the clip's local speed in cruise, back and sweeps,
  a quarter of it in the sprint: its catch keeps 1.7–3.3 cm of wobble) and drives the hull by the stroke's own force,
  fitted to the hull model's speeds. The look at the sloop turns the neck and head only (v1 also turned the chest up to
  12°); a body's own reach and rotation turn the upper body at the waist, not the solved arms.
- Not ported yet: the bow ripple, the headlamps and the July 4th evening's resting
  kayakers (they read v1's three-bound spectators), the notice camera (off by default in v1: Settings `kayakCam`), the
  Cruise navigator's traffic and the chart marks (`fleet.marks()` is there for them).
- The kayak's hardware shows to 90 m (v1: 60 m); its shell is a middle one (v1's near shell is 76 k triangles).
