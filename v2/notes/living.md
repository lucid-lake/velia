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
  `src/sim/terrain.js` unchanged) over v2's height field and v1's shore-distance grids, finest first: the island and the
  bay (`island-d.lsh`, `bay-d.lsh`, 318 kB), then the lake-wide fallbacks, the basin (20 m) and the lake (64 m)
  (`basin-d.lsh`, `lake-d.lsh`, 516 kB): `terrain/levels.js SHORE_LEVELS`, streamed after the first frame, beside the
  terrain's stage 2, through `sim/shore-worker.js`; a build ships them. So the lake answers anywhere on the water, each
  grid blending into the next over 12 texels. The basin's grid was baked in its own 20 km box and reads up to 8.3 km too
  far where the nearest shore lies outside it (the north-east of the basin); `shoreSampler` eases those texels to the lake
  grid once, at build (`SHORE_REPAIR`, ≈ 87 k texels, ≈ 10 ms), so the blend never steps (v1 steps 7.4 km there). The
  tests: `kayaks.test.mjs` demands v1's `shoreDistance` to 1e-6 m over the bay and v1's island, mouth and places exactly;
  `shore-lake.test.mjs` v1's within 60 m lake-wide (0 m within 1 km of the shore), the bay unchanged and no step at a
  grid's edge.
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

## The paddle-wheeler (living/paddleWheeler.js, sim/paddleWheeler.js, render/paddleWheeler.js, render/paddleWheelerMesh.js)

- One generic, unnamed 46 m stern-wheeler for every paddle-wheeler on the lake, built by code (no asset): a white hull with a sheer and
  a dark-red boot top, guards, three decks with cabins and window bands, railings, a pilothouse with wings, twin stacks, a mast, a plain
  navy-and-cream stern flag and a dark-red stern wheel turned in the vertex shader by her speed (about 15.7 rpm at 8 kn).
- One pipeline (`paddle-solid`, boat effects' group) and one draw a frame. LODs by distance: near within 330 m (10,368 triangles), mid to
  1.5 km (2,104), far to 7 km (592). The lite tier (L2-L3, a phone) never takes near and stops at 3.5 km.
- Her route (phase C) is the south-lake region's `traffic` row of kind `paddle` (src/waters/tahoe-emerald.json; sim/regions.js
  trafficOf): Ski Run's pier → north-east round the deep water off Stateline → west along the shore 275 m north of the Off Ski Run pin →
  a slow 4 kn turn 2 km off Emerald Bay's mouth (she does not enter: the entrance channel is 2–4 m on our chart and its lane is 36 m
  for a 46 m hull) → east 400–550 m south of the pin → a 90 s stop 75 m off the pier head. 21.3 km, about 99 minutes a round (8 kn in
  open water). Every leg in 4 m and 80 m off the shore (busy-lake.test.mjs), 25 m or more off every pier over a whole round.
- Where she is: the glass boat's timetable maths (sim/tourBoat.js tourPhase) on the clock of day and the seed, so ?hour and ?seed lay
  her the same. A first birth in her region (Ski Run) shifts her timetable once (paddleBirthTau): she starts 300 m off or more and comes
  within 400 m of the player's reach at 2, 3.25 and 4.5 m/s inside 120 s (cheat on when, never on motion). Moves as a 300 t boat:
  0.055 m/s² up, 0.05 down (0.15 with the wheel backed), 2.6°/s at most, braking into the stop.
- Right of way: the lake's sailboats keep clear of her (busyLake BUSY.avoid.paddleM 70 m from her middle), the glass boat yields to
  her, the runabouts and the jet ski give way (powerTraffic POWER.avoid.paddleM 75 m). She keeps clear of the player only: the glass
  boat's yield scaled to her size (a 230 m box ahead, a stop 58 m from her middle, her course bent 45–110 m away, never into water under
  3.7 m or within 35 m of a pier), and the player meets a solid hull (seven 45 t circles, channelMarks createMarkBodies).
- On every start where her route lies within the draw distance (the far LOD from 1.5 km, 592 triangles; built by code, nothing fetched),
  so a bay start sees her off the mouth when her timetable brings her (the busy bay's paddle-wheeler item, one model). `?paddle=0` off;
  `?paddle=x,z,heading[,kn]` still places her straight for review.
- She rides the drawn water (the mean of four points, a share of its slope), her nav lights are glow records, and the vessels' map
  (render/vesselWake.js, full tier) follows the nearest vessel to the eye: her, or a South Lake runabout nearer; it yields to the glass
  boat while the glass boat's is live.
- Tessie: kind `paddle` (sim/tessieHits.js HIT_RULE): a target, splashed only (a 46 m hull is never knocked down).

## South Lake's power traffic (living/powerTraffic.js, living/powerBoats.js, living/powerBoats-sound.js, render/smallCraft.js, render/smallCraftMesh.js)

- Two runabouts out of the Tahoe Keys and a jet ski off Ski Run, the south-lake region's `traffic` rows of kind `power` and `jetski`.
  Generic, by code: a 6.6 m bowrider (hull colour and one stripe from the row, a windscreen, console, seats, outboard, a skipper at the
  helm) and a 3.2 m sit-down ski (render/smallCraftMesh.js jetSki: a raked pointed bow, a chine and a sponson ledge, two-tone topsides,
  the hood and pedestal in the row's colour, black footwell mats, a grey rear deck, a raised bar on a steering column with grips and a
  mirror pair, a piped cushion, a grab handle, the pump's nozzle; the rider seated with bent knees, hands on the grips, an orange
  buoyancy aid and a helmet). No names or liveries.
- The runabouts idle out of the Keys' no-wake water at 5 kn (a `slow` leg), open up, rise over the hump (bow up about 7° near 11 kn)
  and plane at the lap's seeded speed (15–25 kn), banking into turns (11° at most), slowing to 12 kn for a corner sharper than 55°.
  The jet ski cruises 12–18 kn (row.kn, per lap) with a burst to 23–25 kn on a seeded quarter of her 250 m stretches (row.burst), the
  throttle eased over 2.5 s; wide S-curves ±20 m every 240 m (yaw 16°/s at most, about 7°/s in the weave), bow up about 3.5° at
  speed, rolled up to 14° into the curves, her rider leaning 0.6 × that more (the vertex shader); a rooster tail off the pump (up to
  240 droplets a second through the splash system, living/kayaks-splash.js, its own `craft-spray` pipeline; none on a phone). Her loop
  with the weave stays 80 m off the shore in 4 m of water (busy-lake.test.mjs). The runabouts: 16–23 kn and 15–22 kn.
- Made only for a start in South Lake (ctx.levelKey 'south-lake'): a bay start makes no sim, no pipeline. Where each is: a seeded
  offset run at her mean speed since midnight (?hour and ?seed). A first birth at Ski Run shifts the jet ski and the runabout past
  Ski Run once so each passes within 450 m in the first 90 s.
- Power gives way: to the player (60 m), the paddle-wheeler (75 m), the sailboats (40 m; rule 18), the kayakers (45 m) and the boat
  earlier in the list: busyLake.js evadeHeading with no no-go cone (starboard first), plus a slow-down when a pass would still be close;
  never into water under 3 m or within 30 m of a pier. A soft hull for the player (two circles each). Out in the day (BUSY.day), none
  in a race.
- Drawn: one pipeline (`craft-solid`, boat effects' group), an instanced draw per kind and LOD in use (at most 4). Near within 300 m
  (runabout, 1,057 triangles) and 200 m (jet ski, 2,127); far (239 and 375) to 4 km and 2.5 km (lite: half). Their wakes in the vessels'
  map (prop wash, the V, its arms heavier over the hump), their own map only when the paddle-wheeler has none. One engine voice on the
  nearest boat (synthesised, as the glass boat's outboards), silent past 600 m.
- Tiers (`src/core/features.js` powerBoats, `?power=`): full 3 (desktop, tablet L0-L1), lite 2 (the jet ski and the runabout past Ski
  Run; L2-L3), phone 1 (the jet ski), no wake map off the full tier.
- Tessie: kinds `power` (a knockdown: heeled to 38°, the engine cut, righted in 3.5 s, idling 6 s) and `jetski` (splashed only: the
  rider ducks, she slows; nobody goes in the water). With `?tessierpg=1` each counts in her bounty (`sim/tessieBounty.js`): a runabout
  knocked down 3 XP (type `runabout`), the jet ski's rider splashed 2 XP (type `jetski`), both in the South Lake set.

## South Lake's paddlers (the region rows' `kayaks` and `sups`; living/sup.js, sim/sup.js, sim/supPose.js, render/sup.js, render/supMesh.js)

- **The region rule.** A region row with a `level` of its own (South Lake) owns its kayakers, put-ins and paddleboards only on a page started
  in it (`busyLake.js regionLoaded(row, loaded)`; `loaded` is main.js's `levelKey`: `'bay'` or the region's id, passed through the plug-in
  context). A start in the bay makes no South Lake kayaker, no board, no pipeline and no launch spot; a row without a level lives always.
  The south region's circle is 4,800 m (it was 2,500) so Pope Beach's put-in lies in it.
- **The kayaks.** Three pairs, the existing system unchanged: `kayak-ski-run-timber` (Ski Run to Timber Cove, 1.2 km loop, 90 m or more off
  the beach, 95 m off the piers), `kayak-el-dorado` (along El Dorado Beach) and `kayak-pope` (off Pope Beach), with put-ins `timber-cove`,
  `lakeview-commons` and `pope-beach` (`launchSpots`, 7 to 15 m off the chart's shore). Lanes are checked against the south level's bed
  (4 m or more of water, 80 m off the beach, 50 m off every OSM pier, 150 m off the Ski Run start) and, past its edge (Pope), the lake chart:
  `tests/south-paddlers.test.mjs`. The bay's life rules (glass boat, boats round the start, the first pair in a minute) skip a region with a
  level of its own (`tests/busy-lake.test.mjs LIFE`).
- **The boards.** Two lanes of two off the Ski Run beach (`sups`: `sup-ski-run-beach`, 65 m or more off the beach; `sup-ski-run-marina`,
  clear of the marina pier by 50 m), `residentSups` places them by the day's clock like the kayakers (a row's `mate` a second board 9 m behind).
  Out 08:30 to 19:00, home in a storm. `sim/sup.js` walks each board along its lane at 0.85 m/s (a stroke every 3.1 s, the blade's side
  swapped each stroke, a balance sway of 2.3 degrees, the heading smoothed) and `sim/supPose.js` is the figure: hips, a leaning torso, legs and
  arms by two-bone IK (the hands stay on the 2.05 m paddle to 4 cm), the blade in the water at the pull and carried forward over it at the
  recovery. Tier (`features paddleboards`, `?sup=0|1|lite`): 4 boards on a desktop or a tablet at L0-L1, 2 at L2-L3, none on a phone.
- **The drawing.** `render/sup.js`: one pipeline `sup-solid` (the kayaks' lighting), five instanced draws (board, torsos, heads, 8 limb rods
  a board, paddles), each part a 3 x 4 world matrix built on the CPU from the joints on the board's pose on the drawn water; about 1.1 k
  triangles a board. Nothing under the waterline for the board and the blade. The blades splash through the kayaks' droplets: the system
  pushes its catches and exits into the kayak fleet's `splash` and `tips` lists before `kayaks-splash.js` steps.
- **The busy lake** keeps clear of the boards as of the kayakers (`lakePlugins.js` BUSY_LAKE: the boards' marks join `others`, `kayakM`).
- **Tessie.** A board is splashed only: `tessieHits.js` kind `'sup'` (like a kayak: `splash`, `fall` and `contact` list its id in `spooked`,
  never a target, never a hit; `holdOff` keeps her spine out of it; `SPOOKABLE` names the kinds) so the coming bounty can count it. A
  breach, a surfacing or a fall within 20 m (`HITS.spookM`; her sim's events or the played Tessie's, `tessiePlayer.js spookAt`) makes a board's
  paddler wobble for 1 s (roll up to 0.3 rad, capped at 0.42), drop to kneel over 0.8 s with the paddle across the lap, hold 3.5 to 5.5 s
  and stand over 1.4 s. Nobody falls in: the feet, knees and hips stay on the deck (`tests/south-paddlers.test.mjs`). The sonar blip and the
  hull sound treat it as a kayak (no new UI).
- **Budget** (2026-11-25, M5 Pro Mac, headless Chrome, load average about 3 from other helpers, `__velia.kayaks.sup.on` A/B, 32
  alternating blocks of 8 frames, the scene pass's median over 96 frames each side). Desktop 1280 x 720, 4 boards drawn at 20 to 150 m:
  scene 2.255 ms on, 2.240 ms off (+0.015 ms; a second run 2.248 against 2.238, +0.010), the whole frame 7.11 against 7.07 (inside the
  noise); the CPU (the fleet's step and the records' fill, 4 boards) 0.017 ms a frame; 4,344 triangles, 5 draws. The phone's shape
  (1170 x 2532, `terrain=phone`, boards forced on with `?sup=1`): scene 3.227 on, 3.222 off (+0.005 ms). The phone's policy makes no board,
  no pipeline: 0 ms. The budget is 0.2 ms on a desktop.

## Tessie's Lure and Sonar (`?tessierpg=1`; sim/tessieLure.js, sim/tessieSonar.js, living/tessiePlayer.js)

- **Lure: the `curious` kind**, the opposite sign of the evade. `busyLake.lure(id, { x, z, s })`: the sailboat steers toward the ring
  for s seconds (`curiousHeading`: never inside the 50° no-go cone, never at shoal water), eases her sheets inside 60 m and luffs 25 m
  off. Order of advice: the channel, then an evade (she has seen Tessie), then curious, then the held course. A knock clears it; a
  boat that sees Tessie forgets it. `kayaks.lure(x, z, r, s)`: a kayaker who has not seen her (no watch, back strokes, paddling
  away or wariness) paddles to the ring at the cruise and stops 10 m off; her surfacing within 40 m still wins (the watch).
  `tourBoat.lure(x, z, s, r)`: underway the glass boat turns off her route at the bay's 4 kn and stops 25 m off; at a stop she holds and
  her free paddlers paddle over. Rank 4: the Halcyon's flee (`sim/tessieFlee.js` `lure`).
- **Sonar** marks every boat within the ping's range (no paddleboards): rings projected onto the water under the hulls (a pooled SVG
  layer in the play's own DOM, `.tp-world`), ticks on the SONAR dial's rim, the dial's word the range. Ranks: `sim/tessieSkills.js`.

## Tessie's Tail Surge (`?tessierpg=1`; sim/tessieSurge.js, sim/waveRoll.js, living/tessiePlayer.js)

- **The press:** a 1.2 s wind-up (her tail's flick, rings on her water), then the slap (her `slap` splash, the creature map's rings at
  full amplitude, a solid cream ring on the water, `.tp-world .sr`, running out to the rank's ring over 2 s). Ranks: ring 40/48/56/64 m,
  knock radius 12/14/16/18 m, heel 35/38/41/45°, every 30 s (`sim/tessieSkills.js` `SURGE_RANKS`).
- **The wave** reaches each boat by its distance from her middle and heels it away from her: the full angle inside the knock radius,
  easing to 30 % of it at the ring. `busyLake.wave(id, { heel })` and the Halcyon's `B.wave({ heel })` carry the hull to that heel over
  0.5 s, hold 0.6 s and let it go over 0.9 s (`sim/waveRoll.js`: a stiff spring on the path plus the righting arm's moment; a hull
  already leaning that far gets nothing). The glass boat: her scripted roll (`tourBoat.knock(side, peakDeg)`).
- **The knock rule:** one boat (the nearest) inside the knock radius already heeled past 20° by its own wind goes over (her knockdown,
  scored as wrecked); under 7.5 kn at the boat (the Light band) nothing goes over. Measured on the busy lake (seed 1, 30 s settled): the
  boats' own heel peaks at 5° in 5 kn, 14° in 10 kn, 18° in 12 kn, 20° in 15 kn, 22–23° in 18–24 kn, so knocks come in a strong wind.
- **The kayakers** within 20 m of her middle are splashed (one bounty splash a slap, a breach's rule) and spooked.

## Tessie's Breach (`?tessierpg=1`, phase 5; sim/tessieBreach.js, sim/tessiePlay.js `skillBreach`, living/tessiePlayer.js)

- **The hold** (key 5, or a press held on the slot; `onSlotUp` reports the lift): the target is the locked boat, else the nearest
  within 60 m in ±35° of her heading (a kayak too: she lands off it); from HIDDEN never one over water under 20 m. No target: a quiet
  no-op, nothing spent. She dives to 6 m and runs at 12 m/s at the strike spot by its near rail (the breach family's kind `skill`:
  run → climb → breach → recover). The corners sit on it and turn amber once a release lands the arc on it (`lunge.near`).
- **The launch:** the release, the spot itself reached while held (`BREACH.atK` of the release's reach), 60 m of run or 8 s. A climb at
  7 m/s, then the arc: `sim.breach({ roll: 70°, lean, B: BREACH.arc })`, 1.6 s (0.75 / 0.25 / 0.6), never faster than her run. The
  eye's knockdown ease (back 10 m, up 4 m) from the launch.
- **The fall** (`fall` with `skill: true`): within the rank's window of the hull (3/4/5/6 m, `tessieHits.fall`'s footprint) a
  knockdown, scored with skill `breach`; else within 12 m a wave heeling it to 35° away from her (`busyLake.wave`, `B.wave`, the glass
  boat's roll); rank 4: a boat already heeled past `SURGE.overDeg` (12°) goes over. Never on a kayak: the landing moves 4 m off its hull
  (`breachLanding`), a splash only. Rank 3+: the kayakers within 30 m of the splash are spooked and scored (20 m below).
- **The V:** through the run the threat's sight is 25 m (`warn`); a target that sees the run before the launch is no longer tracked:
  she runs at where it was (it bears away). A release on the amber (about 27 m out) beats it.
- **The slow clock:** 0.5x for 0.8 s (real) about the apex: `breachSlowK` scales the controller's dt and `plugin.playK` her body's
  step (living/tessie.js); never in a race, never under `?slowbreach=0`. Cooldown 60/52/45/40 s from the press.

## The lake grows wary, more targets, the sets (`?tessierpg=1`, phase 6a; sim/tessieWary.js, living/tessiePlayer.js)

- **By her level** (`waryOf(level)`): levels 1–5 keep today's sight (60 m at the surface); from 6 the threat's `seeM` is 90 m (the busy
  lake's evade reads it), `kayaks.berth(100)` turns the watch into paddling away within 100 m of her parts at the surface (only while
  she is played; 0 otherwise), and a boat's first sighting asks one of two chatter lines once ever (not under `?chatter=0`). From 13
  her Lure never turns the Halcyon (he flees at the first ring). No rival berth (phase 6b): rivals sail only in races, where she is
  never played.
- **Targets:** the boats at anchor list as kind `anchored` (`anchoredBoats.targets()`, `knock(id, side)`: over to 62°, held, righted
  on her rode; `kheel` adds to the drawn heel, 0 unless knocked) and score as `still`; a Regatta rival scores whenever a `rivals()`
  source lists it (none: rivals sail only in races); the paddle-wheeler's splash scores as `paddle` (splashed, 10 XP).
- **Sets:** the Logbook's Tessie tab groups the bounty by set (Emerald Bay: Halcyon, sailboat, glass boat, kayak pair, with no rival row since phase 6b; South Lake), each with its set row; a set completed pays
  +25 XP once and asks its legend line once on the skipper's line (`tip.tessie.legend.*`).

## Tessie's Deep carries your ranks (`?tessierpg=1` with a bounty save, phase 6b; regatta/tessieDeep.js, regatta/placeEvents.js)

- `readRanks(storage)` reads the save's ranks without writing; no save, or no flag: today's race (the same draws and events).
- `actsOf(ranks)`: Dash rank 2 a dash, Tail Surge unlocked a surge (its rank's ring), Breach unlocked a breach. Her attacks take
  turns over the acts, then today's strike; an act is aimed at the player and waits (today's strike on a pick) while the player is out
  of her reach. Each act is warned for `DEEP.warnS` with the race's cues (the drone, her shape or V, the coach's line), and its spot is
  fixed at the warning, so a steer escapes it. An act waits up to 2 × `DEEP.waitS` for her last sighting to end; still far (over
  30 m) in its dive, she rises fresh 17.5 m short of the spot under the water. A wave runs out from the warned spot.
- Dash: she rises 60 m off the spot, ahead and to one side of the bow, and runs across it at the surface; then today's strike (the
  race's own catch). Surge: she surfaces 0.65 × her ring off the bow, 35° to one side; her slap's ring wave heels each racing boat it
  reaches away from her. Breach: 24 m beside the course and 10 m ahead; a heel wave to 40 m. A wave's heel is capped at 22° (`B.wave`,
  sim/waveRoll.js; the knockdown watch needs 55°) and never knocks a boat down. Only the player's hull rolls; a rival's heel is logged
  (`stats.heels`) and its sailor steers round the wave's ring.
