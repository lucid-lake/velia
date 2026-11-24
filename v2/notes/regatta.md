# v2 notes: Regatta mode

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## Regatta (BACKLOG-v2 #12, R1 + R2 + R3 + R4, 2026-11-14: regatta/*, a chunk of its own; render/raceLines.js, render/raceProps.js)
is the design; § 10.5 the owner's calls (6 boats at most, in the box at −0:45 with no card,
red/green laylines, the race cuts, v1 frozen, no cost to the other modes). **R1, the box and the clock:** tap Regatta (the home
card's pick, `?mode=regatta`, v1's `racing`, `race`) and the boat is in the box at −0:45; the start helper sails an untouched
boat to a clean start; the watch (the countdown, "Line 48 m · 16 s away", "Time to burn 19 s" / "Late by 3 s: go now"); the gold
ghost "Be here at 0:00"; OCS (the line amber, "Over early: dip back below the line", the officer's call); v1's officer and the
committee boat's horns. **R2, the course on the water:** the glowing start line with posts at the pin and the committee boat,
the 20 m line, the course line (the next leg amber), the laylines to W on the beat (cream, the one to tack on amber, since 2026-11-15; R1–R4 drew them red for port and green for starboard), the zone
ring (26 m, amber inside it) and its turn arrow, the lit, chequered finish; the committee boat, the pin, W and I, and v1's rival
Osprey as props; DOM tags (the ends, the ghost, Osprey, the mark) and an edge tag for a mark off the screen.

| File | What |
|---|---|
| `regatta/plan.js` | pure, in the entry: `regattaAtBoot` (v1's aliases), `RACE` (15:00, −0:45, 1 ×, 6 boats), `fleetSize` (the cap), `RACE_CUTS` |
| `regatta/session.js` | pure: v1's race (`src/sim/race/rules.js`, `rival.js`, `dirtyAir.js`) over the player's boat and up to 5 rivals (`FLEET`: Osprey 17 first, then Tern 4, Kestrel 9, Heron 21, Plover 12); `helperTick`, `takeHelm`, `helperOn`, `advanceTo(t)` (the rivals and the rules tick by tick to the player's sim time), `restart` (the clock pill's ↺ and the results card's Race again; R4: no key) |
| `regatta/helper.js` | pure: the start helper (below) |
| `regatta/geometry.js` | pure: `tackAngle` (the polar's best-VMG angle + 3° leeway), `laylines`, `laylineAhead`, `ghostSpot`, `lineReadout`, `courseToWind` (v1's Island Sprint turned about its line to today's wind, then v1's snap) |
| `regatta/lines.js` | pure: the race's picture as segments (`buildRaceLines` per phase into one Float32Array made once), the brand's inks |
| `regatta/index.js` | the chunk's assembler (refactor round 3 C4: `createRegatta` installs the parts over one shared state `R`: `raceLoop.js`, `raceStep.js`, `hubGlue.js`, `placeEvents.js`, `raceCamera.js`, `racePicture.js`, `raceResult.js`, `tuning.js`): enter/leave, the helper on `B.drive`, the race camera before the gun (behind the boat toward the line's middle: both ends, the ghost and the boat in frame; eased out over 3 s after the gun; on the beat the follow eye rises 5 m), the officer and the horns, the props and the lines each frame, the tags; `settle(s)` for captures |
| `regatta/ui.js` | the plates (DOM, navy and cream, amber for lit): the coach line under the bar with the officer's call, the watch, the fleet, the tags, the edge tag; the phone layouts (§ 10.2) |
| `regatta/horn.js` | v1's synthesised committee-boat horn on v2's page sound |
| `regatta/coach.js` | pure (R3): the coach's step machine (`STEPS`, `createCoach`, `legKind`): one line on the card, its cue lit on the water, the officer's hails on the same card |
| `sim/raceLevels.js` | pure (R3), tiny: `LEVELS` (Beginner, Club, Pro: the plan's table), `aidsFor`, the stored choice (`lakeshore.regatta.level.v1`) |
| `regatta/review.js` | pure (R3): the race's faults while she sails, `tipFor` (one tip), `medalFor`, `resultCard` (the card's model) |
| `regatta/fleet.js` | pure (R4): the fleet's minds, `FleetRival` (v1's `Rival` with no rubber band, the right of way, the windward mark, the penalty spin), `giveWay`, `cpa`, `skillFor`, `startLate` |
| `regatta/moments.js` | pure (R4): the fleet's moments for the coach's card (a crossing, an overlap, a place, the leader, the last leg, a gust, a quiet board's status) |
| `regatta/lod.js` | pure (R4; the race fixes 2026-11-18): `fleetLod` (near, mid, far by the camera's distance, with state: a band changes only past 150 m; every rival near on a desktop, 1 on a phone), `LOD_BANDS`, `lodState` |
| `ui/raceLevelRow.js` | R3, tiny: Setup's fifth tab, Race, with the "race level" row (ui/front.js mounts it without the race's chunk) |
| `render/raceLines.js` | **pipeline 1, `race-lines`**: screen-space quads on world segments, one instanced draw (`MAX_SEGMENTS` 1,024 × 48 B storage made at load), after the sky, depth-tested without depth write, premultiplied, the glow a falloff across the quad, the dash in metres along it; the exposure divided out (a cream line reads cream at noon and dusk) |
| `render/raceProps.js` | **pipeline 2, `race-props`**: lit solid meshes made at load (the committee boat, the pin, W, I, the lite sloop: 1,386 vertices, 44 kB), ≤ 32 instances in a 1.5 kB buffer, one draw per kind present (≤ 5), opaque before the water |

**The start helper.** v1's pro `startPlan` is over early from the box at −0:45 on 4 seeds of 5 (it commits on v1's 60 s sequence;
measured 2026-11-14), so the helper is v2's: the box is on the close-hauled starboard lay of the ghost's spot (0.62 along the
line), the boat steers for that spot while it is sailable (close-hauled on starboard when a header puts it in the no-go), and
burns the spare time by easing the sheets (a luff), trimming in when the time left matches the time she needs (her speed toward
the line once up to speed, else 90 % of the polar's, plus the speed to gain); she aims to cross 0.5–1.5 s after the gun. The
helper writes only the controls a player has (rudder, sheet) through an AISkipper at skill 1. Any steer hands the helm back
("You have the helm. The helper is off."; the watch's Helper button turns it on again until the gun); 4 s after a clean start
it hands the helm back by itself and Sail's pilot holds her course. Clean on seeds 1–5 × winds 190°/230°/250° × 3–8 m/s with 1
and 5 rivals in node (started 0.5–4.1 s after the gun, never OCS), and in the live loop (page test).

**Off a race, nothing.** The chunk is imported only when Regatta is asked for (a Sail page never loads it: the page test reads
`race.loaded`). The two pipelines are declared at load with the rest (none after the first frame); outside a race `draw()`
returns before `setPipeline` and `write()` uploads nothing (`stats.draws` stays 0: `v2/tests/regatta.test.mjs` "the guard",
`pages/regatta.page.mjs`). In a race the cut systems' draws and CPU stop too (kayaks, birds, fireworks, towns: main.js's
`race` flag).

**Hooks outside regatta/ (marked "Regatta"):** `main.js` (the boot's hour; the two pipelines; the scene's draws and the race cuts;
the mode switch; the helm hand-back and the session's step around `B.step`; the race camera; `regatta.frame` after the view
matrix; the race's 1 × speed; the capture and film paths; `stats().race` and `stats().regatta`; `hook.regatta`),
`engine/flags.js` (v1's rows `autoplay`, `racet`, `course`), `ui/frontPlan.js` (Regatta is a pick v2 plays: no "soon").

**Tools:** `tools/v2-regatta-shots.mjs` (mockups 1–4 at 1280 × 720 and 390 × 844 beside the mockups), `tools/v2-regatta-film.mjs`
(`--clip start`, `--clip tack`), `tools/v2-regatta-perf.mjs` (`--race`, `--ab`, `--load`); R3: `tools/v2-regatta-r3-shots.mjs`
(the coach at 4 steps, the level picker, the results card, the laylines; desktop and phone), `tools/v2-regatta-r3-film.mjs`
(`--clip race`: a Beginner race at ×4 from the box through the first rounding; `--clip results`: the finish, the card, Race again). Golden: `v2-regatta` (−0:35, the race
camera, the lines and props).

**R3, the coach, the levels, the results card (2026-11-14).**
- **The coach** (`coach.js`): one line on the card under the top bar, with the cue it names lit on the water (the segment's pulse flag:
  render/raceLines.js breathes its glow on the frame clock, 1.2 s a breath). Steps: the box ("Stay below the white line. Be at the gold
  boat when the clock hits 0:00." with the line and the ghost lit), over early, the gun, the beat ("Tack at the glowing line",
  the one to tack on lit amber; R3 said "the red line"), the layline ("Tack now", that layline lit), the rounding (the zone and the next leg
  lit), the reach or run, the finish (the finish line lit), a penalty. One line at a time; a teaching line waits 8 s after the last
  started, an urgent one 2.5 s; each is cleared by its action (she starts, tacks, rounds, finishes) or after its time (6–12 s). v1's
  race officer shares the card: a hail takes it for 4.5 s and the coach waits under it; the officer waits while a coach line is
  under 3 s old (the gun's line holds 0:00, "The race is started." follows), so the two never overlap. The helper's hand-back note
  answers the player at once.
- **The levels** (`levels.js`, the plan's § 6.5 with the owner's R3 brief): Beginner every aid (the helper, the ghost and its path,
  the laylines, the zone, the turn arrow, the full coach, no penalties, easy rivals); Club no helper, no ghost path, no turn arrow,
  the coach for mistakes only (over early, the layline, a penalty), penalties on, medium rivals; Pro no helper, no ghost, no coach,
  the line, the zone and the marks, the laylines an option (off), hard rivals. The rivals' tier (v1's TIERS) follows the level for
  every rival (R4's fleet). Picked on the first race (a picker under the card, never blocking: Beginner meanwhile; it goes at the
  gun), from the watch's level chip, or in Setup's new Race tab ("race level", `setupRow.js`; the Sail and Aids tabs are full); stored; a new level puts the race back in
  the box at −0:45 (the same level again, or Pro's laylines, changes nothing else).
- **The results card** (`review.js`, `ui.js`): 2.5 s after she finishes: the place ("2nd of 2"), the time, the gap to the winner
  ("+12.4 s behind Osprey", "Won by 4.2 s"), the medal (gold the win, silver second, bronze third; second of two more than 30 s
  behind is bronze; none for a DNF), the best time on that course and level (v1's `recordBest`), ONE tip from the biggest measured
  loss (over early; a late start, > 4 s; the layline overstood, > 25 m outside the cone; a slow tack, > 9 s back to 85 % of her
  speed; a wide rounding, > 18 m from the mark), Race again and Home (the home card; R4: no key, R is the jib). Phone upright: under the instruments;
  sideways: two columns; the watch, fleet, coach and tags step aside under it.
- **R2's fixes.** The laylines read on the beat: 5 px wide with a 14 px glow (was 3 + 6), wider with distance (×1.9 at 400 m: the
  far flag), drawn from the mark back past the start line (R2's 420 m ended ahead of a boat starting the beat); the beat camera
  turns toward the mark (0.6 of the angle, up to 40°), stands 8 m further back and looks 15 m further up the course (a higher eye
  hid the boat behind the cockpit). The cockpit wheel in the hand (the station's helm command) hands the helm back, as the keys and
  the strip do. **The race's wind is fair:** turned to a SSW wind, v1's Island Sprint put W in Emerald Bay's lee (17 kn at the line,
  8 kn at W on the real terrain; one run read 22 kn at the start and 7 kn by 2:30), so the committee now lays the course in clean
  wind (`geometry.js layFairCourse`: the whole course moved, nearest first, until every point she sails sees ≥ 0.88 of the course's
  best terrain factor, in water ≥ 5 m deep, the zones clear of the shore and the camera's water behind the line ≥ 4 m: 20–35 ms at
  entry); the wind's day clock holds inside a race (the day clock's 10 × would carry an afternoon breeze into its evening fade);
  and the gusts a racing boat feels (the player's and the rivals' alike) stay within 0.72–1.38 of the base (`fairGust`; v1's gust
  cells dip to 0.5). Shifts, gusts, the storm and the weather menu all stay. At the new place the valley turns the wind 15–25° at
  the line, so the start helper now reads her close-hauled heading against the line's square (not `cos(twa)`), and the box is no
  deeper than 0.4 × the pre-start at her close-hauled speed along the lane (36–60 m, `session.js BOX`): untouched starts 0.4–3.3 s
  after the gun on the real terrain (seeds 1–3, levels 2–3, both terrain sets, both courses), never OCS. `?course=short` (R3): the
  Island Sprint's marks at 0.4 of their distance, the page test's whole race.

**R4, the fleet, the pace, the entry (2026-11-14; awaiting the owner's look).**
- **Five rivals by default** (`plan.js RACE.rivals` 5; `?rivals=0–5`, capped at 6 boats): Osprey 17, Tern 4, Kestrel 9, Heron 21,
  Plover 12, each with its hull colour (`session.js FLEET`: the topsides, the tag's and the ladder's chip) and its own lane in the box.
- **The minds** (`fleet.js FleetRival`, v1's `Rival` extended): each rival's skill is fixed for the race, a small step round its
  level's tier (`FLEET_TIER` easy 0.45, medium 0.62, hard 0.82; steps −0.05 … +0.05): **no rubber band** (`band()` is a no-op: no
  rival sharpens when behind, nothing catches up on the last leg). v1's easy tier (0.2) sailed 11° free with an 8 s lag in its sense
  of the wind and spread a five-boat fleet over minutes, so the fleet's tiers are lifted, in v1's order. v1's cover is off in a fleet.
  **The start:** each rival sails v2's timed run (`helper.js`, its own skill-1 skipper) to its own place on the line, late by its skill
  (`startLate`: 1.5–2.5 s at skill 1, 3.2–4.7 s at 0.45); a rival nearer the line than it drifts in the time left bears away along
  the line until the time to go (`guard`); an over-early rival dips 25 m, not 60. **The right of way** (`giveWay`): port keeps clear of
  starboard (a duck under her stern), windward of leeward (heads up, then eases the sheets to drop back), each when the closest
  point is under 16 m within 12 s or the hulls are within 3 m; the stand-on boat holds on until 3 s from a touch (rule 14); an advice
  never blocks the skipper's own irons recovery. **The windward mark:** within 90 m of an upwind mark a rival sails a point on the lay
  35 m below it, then a point a length beside and past it, then v1's exit (v1's route to a point straight upwind of the mark missed
  the rounding for minutes on 4 boats of 5). **Contacts** (`src/race/contact.js` between every pair): a touch after the gun gives the
  boat at fault a turn at Club and Pro (`rules.js touch`; Beginner forgives); v1's 8 m meeting distance is off for the fleet
  (`createRace({ meetM: 0 })`: two lanes 8 m apart gave a turn every start) and a 360 has 120 s (`turnS`: this keelboat's turn takes
  55–90 s; v1's 60 s never closed). A rival owing a turn first sails clear of the nearest boat (≤ 8 s), then spins on its own helm.
  Two rivals pressed together (25 touches in about 8 s) slip apart for 8 s.
- **The level of detail** (`lod.js`; the race fixes, 2026-11-18): from the camera, near (entered crossing 150 m,
  left past 175 m; every rival on a desktop, 1 on a phone, tablet or at L2-L3: `features.js fleetDetail`) on the boat renderer's
  full-detail slots, each bound to its boat (`render/boat.js setRivals`, `pose.key`: v1's models without the cabin, the sails with their flutter, the topsides
  tinted, its shadow into the player's map within 20 m of her; at most one sail refill a frame, on a quantised trim); mid (< 250 m;
  phone 200 m; ± 15 m) the props' lite sloop (no cloth, no shadow, 102 triangles; white, the boat's colour on the topsides band); far the props' 11-triangle silhouette. No new pipeline,
  all buffers made at load, nothing allocated a frame; off a race `setRivals(0)` draws nothing. The committee boat is a proper
  launch now (308 triangles: a flared hull, the wheelhouse and its windows, the hard top, the signal mast with the orange and blue
  flags) in the same props pipeline.
- **The ladder** (`ui.js`): place, chip, name, sail number and the gap to the leader (metres on a beat, seconds after it: `ladderGap`),
  the player's row amber; folded on an upright phone to "2nd of 6 · +38 m" (a tap opens it). **The tags** on the rivals: name, sail
  number, chip, the gap along the course ("12 m ahead"); placed once a frame so none lies over a plate (the watch and its level chip,
  the ladder, the coach's card, the top bar) or over another tag (R3's start tags over the level chip). Setup's five tabs fit the
  title's line on a phone (`setupRow.js RACE_TAB_CSS`).
- **The pace** (the owner, 2026-11-14: a race took several real minutes): the race runs at the level's game speed (`levels.js pace`:
  Beginner and Club 2 ×, Pro 1.5 ×; the clock, the rivals, the wind and the physics together, as Cruise's), on the Island Sprint at
  0.35 of its distance (`index.js COURSE_SCALE`: a 179 m beat to W, the rounding, a 92 m reach to I, a 128 m run home; `?course=full`
  is v1's whole course); the pre-start stays −0:45 of race time (22.5 s of real time at 2 ×: the box's depth and the helper are tuned
  on it). **The moments** (`moments.js`, on the coach's quiet path): a crossing (who keeps clear, what to do), an overlap at a mark,
  a place won or lost, the leader's rounding, the last leg with her place, a gust coming down the course, and on a long quiet board
  the mark's distance and her place; Pro hears only its places, the leader and the last leg.
- **The entry** (the owner: "the boat has to sail in irons to get to the start point"): the box and the lanes are laid on the wind
  the line has now (the valley turns it 15–25° off the course's design wind; a lane on the design wind pointed her within 25° of the
  real one), and every boat enters on her lane 4° freer than close-hauled at 0.6 of the polar's speed there (1.8 m/s at least),
  sheets trimmed.

**R4's costs (2026-11-14, `tools/v2-regatta-fleet-perf.mjs`, 1 / 3 / 6 boats ABBA, the GPU shared, load 12.8–21.9):** the frame's
GPU ms, Mac 2560 × 1600 at −0:35 11.0 / 12.7 / 10.7 (6 vs 1: −0.35, −1.94…+2.32), on the beat 14.1 / 13.5 / 16.6 (+3.16, +0.19…+5.74; the
scene pass 5.47 → 7.15 ms with 2 near rivals); phone path L2 570 × 1234 −0:35 2.68 / 2.40 / 1.97, beat 1.88 / 2.27 / 2.71 (+0.91,
−2.18…+3.81); L3 456 × 988 2.70 / 2.93 / 3.39 (+0.74, −0.75…+2.40). 0 pipelines after the first frame. A phone is predicted at the
phone path × 5–10 (not measured: no upload approved): 6 boats 10–27 ms at L2, 17–34 ms at L3. The pace (node, seeds 1–3, v1's pro at
her helm): a Beginner race 143–154 s of real time (R3: 708–823 s), the card's median gap 2.3–2.9 s (R3: 8–13.5 s).

- **The HUD (the owner's note, 2026-11-14: "large navy colour blocks"):** a broadcast package: the clock pill
  top-left, the timing tower top-right (top 3 and her row on an upright phone), the coach and the officer as a lower third, labels on
  leader lines for the boats and the marks; one row height, one radius, one margin, translucent strips, solid only for the accents;
  the level chip gone from the clock (Setup, and the first race's picker). An upright phone's race graphics cover 10–14 % of the screen
  (the page test's budget: 15 %; R4's first HUD covered 19 % on the beat).

- **Sail's HUD in a race, and the keys (the owner, 2026-11-14):** each Sail and Pro piece has a race state: the nav column (COG, TWS,
  TWA, VMG, heel and the passage's WP, DTW, BTW, TTG, XTE) hidden (the clock pill and the tower carry the race's mark and readings;
  it sat under the clock); the passage plan's route and waypoints step aside (the chart's plan suspended, `sailHud`, restored on
  leaving); the practice marks off (R3); the skipper's hint line hidden (R1); kept: the top bar and its status line, the chart and wind
  dials, the key legend (the tags keep off them), the Pro trim panel and recess, the binoculars and the VHF. **No race key:** R was
  "Race again" and also v1's jib sheet; R is the jib in every mode now, and restart is the clock pill's ↺ button and the results card's
  Race again (Enter on the focused button). Regatta binds no other key. Page tests: a plan laid, then the race, at the 4 sizes: the nav
  column hidden, no Sail piece under a race one, the plan back after; R in a race trims the jib and never restarts; ↺ restarts in the box.

**Not yet (R5):** the ladder rung and the crossing rings on the water, the rivals' wakes, the wind streaks, the daily seed and the
ghost of your best run, "How to race", Next.

**Costs (2026-11-14, M5 Pro, headless Chrome, `tools/v2-regatta-perf.mjs`; the GPU shared with other helpers, load 10–27: the
honest numbers are the per-round ABBA differences and their ranges).** The race's draws, toggled in place in a race page
(6 rounds × 4 cases, the scene pass's own ms):

| Pose | Mac 2560 × 1600: lines | props | both | Phone path 570 × 1234 (L2, phone terrain): lines | props | both |
|---|---|---|---|---|---|---|
| −0:35 (14 segments, 5 props) | +0.14 (−0.11…+0.26) | +0.09 (−0.05…+0.30) | +0.09 (−0.07…+0.15) | 0.00 (−0.09…+0.02) | +0.02 (−0.11…+0.04) | −0.01 (−0.09…+0.03) |
| the beat (56 segments, laylines on) | +0.05 (−0.30…+0.44) | +0.06 (−0.25…+0.46) | −0.02 (−0.11…+0.22) | −0.01 (−0.01…+0.04) | 0.00 (−0.03…+0.06) | 0.00 (−0.05…+0.07) |

Inside's rows (lines +0.15 Mac / +0.2–0.3 phone; props +0.05 / +0.1) and below this GPU's noise floor; a
second run at load 20–27 read ±1–4 ms either way (noise). Calls: +1 (the lines) and +1 to +5 (the props' kinds) in a race.

**R3's costs (2026-11-14, the same tool, `--race` at the beat, 80 s in, 56 segments with the wider, far-scaled laylines; the GPU
shared, load 9–13):** the lines' scene-pass cost Mac 2560 × 1600 +0.05 ms (−1.02…+0.25), phone path 570 × 1234 +0.02 ms
(−0.01…+0.07): R2's numbers, inside's 0.15 / 0.03 ms budget (the pulse is a few ALU ops in the same draw; no new
pipeline, no new buffer). The coach, the levels and the card are DOM written only when their text changes; off a race nothing of
them runs (the chunk is not loaded; Setup's Race tab is one static row built with the card; the guard tests stand). The fair
course costs 20–35 ms once at entry (node, M5 Pro).

**Off a race (Sail, Cruise), main (135882ee) against the branch, ABBA, the frame's GPU ms (median of the per-round b − a):**

| Pose | Mac 2560 × 1600 | Phone path 570 × 1234 | drawFrame CPU p50 |
|---|---|---|---|
| Sail 13:00, wind 3 | +0.03 (−0.99…+1.41), 12 rounds; −0.05 (−1.72…+0.92), 6 rounds | −0.01 (−0.31…+0.26); +0.03 (−0.29…+0.35) | 0.0 ms |
| Cruise 17:54 | +0.64 (−3.38…+2.05), 12 rounds, load 10–15; +0.08 (−2.27…+1.13), 6 rounds | −0.07 (−1.43…+0.65), 12 rounds; +0.19 (+0.06…+0.31), 6 rounds | 0.0 ms |

Every delta within its own range of noise (the main pages' own spread: 7.7–13.5 ms Mac, 2.1–4.0 ms phone); the race's draws
stay 0 on the branch (`stats().race`). **Load:** 78 → 80 pipelines; their build 73.7 → 75.4 ms (median of 8 loads; ranges
70.7–92.6 and 72.7–81.0); the first frame 1,441 → 1,450 ms (noise); 94 kB of buffers made at load (the lines' 48 kB, the props'
mesh 44 kB and instances 1.5 kB).
