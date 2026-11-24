# v2 notes: UI, clock, nav, plan, front door, launch gate, logbook, first sail, binoculars

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## Setup's rows (#9, 2026-11-14: ui/setup.js; hooks in front.js, sail.js, sim/boat.js assists, main.js quality.pin)

Every row of v1's Setup page acts on v2's systems, as v1's shell applies it (`src/shell.js` applyAudio, applyControls,
applyQuality), or is disabled with v1's quiet italic "soon". The URL's own rows still win at the start (`?pilot=`, `?hand=`,
`?shoal=`, `?words=`, `?quality=`). `v2/ui/setup.js` SETUP_ROWS is the table; `v2/tests/music.test.mjs` checks it covers every
button on v1's page; `v2/tests/pages/setup.page.mjs` presses each row on the real page and reads its system back.

| Tab | Row | v2 |
|---|---|---|
| Sail | wind, weather, sailing (Pro) | no rows on v2 (owner 2026-11-17: Setup holds no duplicates; `REMOVED_ROWS`): the top bar's Conditions sheet, the cockpit's PRO |
| Sail | crew trims | acts: the crew trims the main (`assists.crewTrim`: ctl.sheet null, the winch's nudge off), as v1's handOn |
| Sail | auto-reef | no row on v2 (owner 2026-11-17): the reef selector A · 0 · 1 · 2 (`ui/autoReef.js`), per mode: Sail and Regatta 0, Cruise A |
| Sail | shallow water | acts: v1's `src/sail/grounding.js` on v2's bottom (the assist bears away, the sounder, R.'s words); `setAssist` |
| Aids | pilot | acts: off, the helm eases amidships when let go (v1's) |
| Aids | hints | acts: the skipper's line hidden |
| Aids | your sailing | acts: v1's applyProfile and the skill model's "I sail" |
| Aids | words | acts: `words.mode` |
| Aids | key hints, button tips | act (the legend reads the store each frame; tips as before) |
| Aids | edge instruments | no row on v2 (2026-11-17): the nav column follows Pro; a stored `edgeInstruments` reads `auto` (`v2Settings`, `RETIRED_KEYS`), v1's value left in place |
| Sound | sound, music, effects | act (§ The music); now shown on v2's Setup page |
| Sound | music: shuffle, by time of day | v2's own row (`ui/musicRow.js`, under the sound switches): § The music, Shuffle |
| Sound | radio | acts on the fireworks evening (shows with `?fireworks=1`, as v1) |
| Sound | skipper's voice | acts: v1's spoken lines (three-free), `setEnabled` |
| Screen | display | acts: `theme.set` (auto, day, night) |
| Screen | HUD | acts (as before) |
| Screen | text | acts: larger text (`theme.setLargeText`, the card too) |
| Screen | language | acts: English; Chinese disabled "(soon)", as v1 |
| Screen | quality | acts: auto (the ladder), High L0, Battery L2 (a saved Balanced: L1), held by `quality.pin(k)` in main.js (the ladder's public level and `applyLevel`; quality.js untouched); MSAA follows live (#31: § MSAA live); the cloud key and the boat's shadow wait for a reload; a saved pin starts the page at its level |

**Captures:** `renders/music/setup-{sail,aids,sound,screen}-v1-over-v2.jpg` (`node tools/v2-setup-stack.mjs --v1 … --v2 …`):
the same card, rows and order; v2 adds only the two "soon" marks.

## The UI (M4: ui/*, render/cockpit.js, render/cockpit/*)
v2 plays like v1's Sail with v1's UI: the same top bar, the same cream 3D cockpit with its dials and controls, the same
skipper's line and hints, the same helm view, the same keys. **v1's DOM UI runs as it is** (three-free modules imported from
`src/`; the guard pins them, § Shared modules): `ui/viewSwitch.js` (the bar: Menu, Boat | Helm, Music, Full, Setup, the wind
picker, the ship's clock), `ui/calmHud.js` (Full, Calm, Instruments, Clear, the fold, H), `ui/controlsHint.js` with the sloop's
skills and words (the skipper's line under the bar), `ui/captainView.js` (the wind dial) and `ui/chartplotter.js` (the small
chart; mounted once the terrain is whole), the station's `controlPanel.js`, `throttleLever.js`, `tackButton.js`, `proRecess.js`,
`trimPanel.js`, `foldButton.js`, `dialFaces.js`, `helmInput.js`, `helmLayout.js`, `helmStyle.js`.

| File | What |
|---|---|
| `ui/m4.js` | main.js's plug-in (marked M4 blocks): the cockpit's pipelines before the first frame, the views (also for a headless `?view=helm`), the UI chunk loaded beside the first frame (`import('./sail.js')`), the station's hands around the boat's step, `?filmui=1` |
| `ui/sail.js` | what v1's deck, controllers/sail.js, stations/sloop/index.js and shell.js mount on a Sail page, wired to v2's sim and the shared WindField (services registry: `src/sim/core/services.js`) |
| `ui/station.js` | v1's `helmStation.js` in its cockpit form, without three: the same DOM, gestures, let fly, readouts, instruments' raised views, fold mark; `cockpitRects()` the hit layer from the rig (pure; within 2 px of v1's rects, `tests/station.test.mjs`) |
| `ui/views.js` | the follow and helm views and v1's ≈ 1 s move (`HelmCamera`, `ViewBlend`, `blendPose`); `main.js` now takes the pose's `up` (the helm view's horizon tilts) |
| `ui/keys.js` | the UI's keys (1–4 the wind, C the view, Shift+C the chase, K reef, Space tack; H is calmHud's), held to v1's KEYMAP |
| `ui/nav.js` | the nav column on the left edge: v1's `navColumn.js` and its `passage` service as v1's shell wires them (§ The nav column) |
| `ui/plan.js`, `ui/planChart.js`, `ui/lakeBox.js` | the passage plan on the enlarged chart: v1's planner and course as v1's attachChart wires them, on the whole-lake chart from the baked grid `ui/planChart.bin` (the bay level v1's navigator chart; § The passage plan) |
| `render/cockpit.js` | the cockpit on the GPU (below) |
| `render/cockpit/asset.js` | the CKB1 reader (gzip, the JSON, the planar vertex streams, the atlas PNG, the PRO cover's frames), `composeNodes` |
| `render/cockpit/rig.js` | v1's cockpit3d.js `set()` on the baked nodes (toggles, key, needle, lever, TACK, MOOR, BINOS / VHF, PRO cover and cars, the fold's tip and sink, the faces' backlight, the night labels), the wheel and the winches as helmStation turns them, the compass card, the camera (v1's `cockpitView`), the projections |
| `tools/v2-cockpit-bake.mjs` | the bake: v1's own Sail page in headless Chrome, its cockpit serialized (237 nodes, 146 draws, 58,627 triangles, 60 materials, a 2048² atlas of the engraved words, the compass card, the blob shadows and the sole's AO) → `assets/cockpit/{desktop,phone}.ckb.gz` (1.13 MB, 1.06 MB; committed; re-run after any change to v1's cockpit) |
| `tools/v2-ui-film.mjs` | a film of the live UI with scripted hands on the film clock |

**The cockpit's drawing.** No pass and no target of its own: it draws first in the scene pass with its own camera (v1's
full-frame 50° lens, the `cockpitView` solve that lands the hub at 99.6 % and the cap's lip at 89 % of the height) and its depth
squeezed into the reversed-depth band [0.99, 1] (nearer than anything the world draws past 0.505 m), so the terrain, the water,
the forest and the sky behind it fail the depth test and are never shaded; its glass, dome, engraved words and soft shadows go
last in the same pass, blended. Lit as v1's look/cockpit-light: the world's sun and sky only (`BOAT_HEAD`'s `sunPerp`,
`ambientAt`, `skyRadiance`, `ggxSpec`), the light turned by the heading as v1's root turns, no lamp of its own; the backlit parts
(the faces, the lit amber, the words' floor) in screen terms (÷ the exposure). v1's cockpit materials (`cockpitMaterials.js`) in
WGSL: the satin gelcoat with the shell's own occlusion from its `sh` attribute, the teak cap and the caulked sole with its baked
AO map, brushed stainless, powder coat, the smoked glass's salt haze, the braided sheets; the glTF wheel's materials as they are.
The two dial faces are v1's `dialFaces.js` canvases (drawn from the wind dial's SVG and the small chart's canvas), uploaded only
when redrawn (≈ 4 Hz, ≤ 10 Hz while trimming). Pipelines: +4 (opaque, blended, blended with depth, blended with a depth bias),
41 in all, 0 after the first frame.

**Seams in src/ (v1's behaviour byte for byte):** one. `src/stations/sloop/cockpitView.js` holds cockpit3d.js's pure head
unchanged (`COCKPIT`, `COCKPIT_PHONE`, `cockpitConsts`, `LABEL_MODES`, `labelConsts`, `cockpitView`); cockpit3d.js imports
and re-exports it (`tests/cockpit-rig.test.mjs` checks the objects are the same). Copied, not imported (their modules import
three): helmStation.js's `WHEEL_PAD` and `WINCHES` and its cockpit-form logic (`ui/station.js`), deck.js's camera chain
(`ui/views.js`), cockpitMaterials.js's shading (WGSL), v1's helm rules for the wheel, the winches and the Tack assist
(`sim/boat.js station()`, with v1's `LetFly` for a click on a winch: the sheet thrown off, a second click grinds it in).

**The hands:** the wheel (a drag about the hub, a scroll, ← → when focused), each winch (crank, drag, scroll, the ▲ ▼ steps;
the main's sheet through `HandSheets.nudge`, the jib's on `ctl.jibTrim` inside `jibTrimRange`), TACK and Space (v1's
`TackAssist` through `pads.ext`), the throttle lever and the key (v1's notches and auto-start on `phys.engine`), SAILS (the
crew's furl) and REEF, PRO and its four sliders (the traveller, the jib lead, the vang, the backstay onto `ctl`), the fold
mark, the bottom strip and H, the instruments' raised views, C and the bar's Boat | Helm, 1–4 and the bar's wind picker
(`WindField.setLevel`, blown in over 25 s). A phone held sideways gets the phone bake and v1's thumb-slide steering zone.

**Budgets (2026-11-13, M5 Pro, headless Chrome, 2560 × 1600, live page, `?gputime=1&gov=0`):** the cockpit's GPU cost,
interleaved A/B in one page (shown | hidden every 2 s, 3 windows each, per-frame totals): +0.13 ms total, +0.05 ms in the scene
pass (its 146 draws cost about what the world it hides would have). Worst frame while the cockpit folds and rises and the view
switches there and back: 19.8 ms. Pipelines after the first frame: 0. JS gzip: the first-load chunk 133.9 → 156.5 kB (+22.6 kB:
the cockpit's renderer, rig and reader, the views, the pedestal instruments, v1's LetFly); v1's UI is its own chunk loaded after the first
frame (98.3 kB gzip + 5.4 kB CSS); the cockpit asset 1.13 MB (desktop) or 1.06 MB (phone), fetched beside the first frame.
Layout reads: none in v2's own code; v1's calmHud reads the bar's box each frame while a pointer is over the page, so v2 runs
`calm.update` first in the frame, before any DOM write (a read on a clean layout forces none).

**Still different from v1's UI:** (the home card, the loading reel, the first visit, the Menu card and Setup: § The front door
below) the Music menu drives v1's beds (§ The music) (the binoculars and the VHF: § The binoculars and the VHF; the clock menu: § The day clock and the key legend); the anchor and MOOR need v1's ground tackle (the switch is drawn, a press says
so); an upright phone draws v1's grid form since #2 (§ The phone's controls);
the cockpit is
drawn at the scene's resolution (v1's crisp second canvas on dense phones is not ported: left, #46).
**#46 (2026-11-14):** the night words switch on: v2/ui/sail.js runs v1's theme (`src/ui/theme.js`, since M5e) on the running
clock; checked on live pages (21:36 frozen, and 18:45 run at `?timerate=300` into 22:05: `data-lk-theme=night`, the cockpit's
label materials on their night maps, SAILS / ANCHOR / REEF / PRO in the night red); the note here was stale. **An ultrawide's
coaming:** v1 rebuilds the shell at hw = 3.3 × aspect / (16:9); v2 now ships a third bake, `wide.ckb.gz` (1920 × 720, hw 4.95,
1.13 MB, `tools/v2-cockpit-bake.mjs --only wide`; the desktop and phone bakes re-run byte for byte), loaded for a desktop wider
than `WIDE_AT` = 2.05:1 (`render/cockpit.js cockpitBake`, at load). Its ends leave the frame at 2.1:1, 21:9 (2560 × 1080) and
8:3; 32:9 still shows them (a bake at 32:9 would cover it), and from 16:9 to 2.05:1 the desktop bake still shows its ends a
little (the wide bake there pushes the dials onto the screen's edges).

**Deliberately unlike v1 (owner, 2026-11-14; BACKLOG-v2 #60, #61):**
- **The throttle's word only when touched** ("This ugly FULL AHEAD yellow text should not always be on; the moment it is touched
  is enough"). v1 keeps the lever's one lit word (SLOW AHEAD … FULL ASTERN, NEUTRAL) on beside the knob for as long as the engine
  runs, with no timer. v2 (`ui/throttleWord.js`, wired in `ui/sail.js`) lights it on the player's own touch only: + − (held: while
  held), 0, a drag, tap, scroll or arrow key on the lever. It holds 1.5 s after the last touch, then fades in 0.4 s. Cruise's
  driver, the anchor and the engine's auto-start and auto-stop never wake it. v1's word, text and colour are untouched.
- **The cockpit shown whole or gone whole** ("completely show or completely disappear"). v1's Calm HUD left it half dropped: a
  winch peek (a luffing or stalled sail, a flying sheet, the ease hint) sank it only to the cap with the wheel faded, and a phone
  kept a faint wheel at 0.35. v2's `ui/station.js` (`cockpitTarget`) drives the 3D cockpit from one value, 1 while the dashboard
  is up and the cockpit not folded, else 0, eased over the fold's 0.4 s (the slide and the fade together). The peeks' DOM pieces
  (a winch's leaf, readout and steps; the throttle column) hide with it (`COCKPIT_WHOLE_CSS`). The idle, the fold, H, the helm
  view and the presets still hide it as before. Tests: `v2/tests/throttleWord.test.mjs`, `v2/tests/pages/throttleWord.page.mjs`
  (fails on the old code), `v2/tests/pages/calmHud.page.mjs` (now expects no peek).

## The day clock and the key legend (2026-11-13: engine/clock.js, engine/flags.js clockParams, ui/dayClock.js, ui/sail.js)
The owner, 2026-11-13: "clock + legend" (v1's first-sail hint lines are not wanted in v2). BACKLOG-v2 #10 and #3.

**The day clock runs as v1's Sail.** A live page starts at `?hour` (v1 Sail's 18:45, `SAIL_HOUR`, when absent) and runs v1's day clock
(`src/sim/timeOfDay.js dayClockSchedule`, integrated into v1's `RateTable`): `DEFAULT_TIMERATE` = 10 game s per sim s by day, so
1 game hour per 3 real minutes at the 2 × game speed; golden hour and twilight at 0.6 × (the sun between −6° and +10°); the
deep night (under −12°) at the day's rate in Sail (owner, 2026-11-15: `engine/clock.js sailSchedule`, v1's table with
`nightMult` 1; about 19 real minutes under −12°, not 5), so Sail never says "The night passes…". Cruise keeps v1's 4 × night
(`cruise/plan.js cruiseSchedule`), without that line. The one night line is v1's night-sky sighting, "The stars come out…"
(`ui/dayClock.js starsCue`: v1's night-moment rule, the Milky Way's level at 0.8 or more for 6 s, deck coverage at most 0.6, no
storm; once a night), in Sail's bar line and Cruise's quiet line. The hour on v2's clock equals v1's `TimeOfDay` on that
table to 1e-9 h over two game days (`v2/tests/day-clock.test.mjs`). **The night wind (owner, 2026-11-15):** Sail sets
`WindField.nightHold` (`src/sim/wind.js heldHour`; v1 never sets it): the level's floor stays whole all evening and night
and the evening's own wind holds (about 195°), so the lake never goes flat while the player sails; at dawn (sun −12° to −6°)
it veers into the morning's wind; Cruise clears it (v1's calm night drainage).

| URL | clockMode | the hour |
|---|---|---|
| live, no `?timerate` | `day` | v1's schedule from `?hour` (18:45 when absent) |
| live, `?clock=flat` | `rate` | v1's constant 10 game s per sim s, from `?hour` |
| live, `?timerate=r` | `rate` | constant r (v1: an explicit rate has no schedule); with `?hour` it starts there |
| live, `?timerate=0` | `frozen` | stays at `?hour` |
| `?filmui=1&hour=h` | `frozen` | the film clock steps a pinned scene: the goldens' live hud frames keep 15:00 (no `?hour`: the day clock on the film clock) |
| `?headless=1` | `frozen` | every capture and golden; `?filmrate=r` (a film) runs it at constant r |

The `?hour` row matches v1 (owner, 2026-11-14, BACKLOG-v2 #36: "match v1: the clock runs from that hour"; v1's `timeParams`:
`?mode=sail&hour=13` reads 13:10 after 30 real s). It runs on the sim clock, never the wall clock: the URL contract's "no wall
clock in the scene" holds, and every capture, golden and film stays deterministic.

**The clock's API** (`engine/clock.js`; the VHF, the logbook, the fireworks and the wind's day read the time only through it;
`__velia.clock` on the page): `t`, `dt`, `steps`; `hour` and `hourAt(t)` in [0, 24); `hourUnwrapped` and `hourUnwrappedAt(t)`
(monotonic across midnight: the wind's day); `rate` and `rateAt(t)` (game s per sim s); `running`; `mode` (`day` | `rate` |
`frozen`); `cuts`; `setHour(h, t)` (a cut, the schedule runs on from it; `onCut(fn)` → unsubscribe); `setRate(r, t)` (a
constant pace from t); `resume(t)` (back to the clock's own pace). The hour is a pure function of sim time
and that history, so a capture stays deterministic. `stats().clock` carries `{ mode, rate, running, cuts, hourUnwrapped }`.

**What follows the hour, every frame:** the sun (`sim/sun.js`), the sky-view LUT and the aerial froxels (re-made every frame),
the cloud key (a band of rows a frame, cross-faded over 1 s), the terrain's sun shadow (re-drawn every 4th frame or on a 0.1°
turn), the exposure, the night's levels (airglow, stars, the Milky Way, the moon, the towns' and the boat's lights; the night's
data now fetched once the terrain's stream is done when the clock runs, so dusk never waits on a load), the theme
(`data-lk-theme`, v1's −1° / +1° switch), the storm's arc, the kayaks' evening and the fireworks (their show starts at 21:44).
The wind's day follows the clock (`WindField.setClock(clock.hourUnwrappedAt)`, as v1's core); a frozen capture keeps its own.

**The top bar's clock and time menu** (`ui/dayClock.js`): v1's `timeMenu.js` as it is on v2's clock: Dawn 05:36 · Midday 13:00 ·
Golden hour 19:15 · Night 22:30 · Fireworks, each a forward cut (`hourJump`) under a short fade (owner, 2026-11-18: 0.35 s to
dark on the sunrise's veil, the cut, one dark frame, 0.45 s back; `dc.step(dt)` each frame in every mode; an instant cut under
reduced motion). Its feature row (Fireworks) comes from
`src/features/timeRows.js`, the features list's new pure half (the one `src/` seam: `src/features/index.js` spreads it into its
row, `tests/features.test.mjs` holds the two lists to the same objects; v1's behaviour is unchanged). v2 does not run v1's
fireworks evening (`src/fireworks/evening.js`: no hints, no time-lapse, no show pace; owner, 2026-11-15): the Fireworks row is
a cut to 10 game s before the show, and the chart keeps its "Fireworks" mark at the viewing spot from 20:15 until the show is over.

**A sunset flash, fixed at its source** (`render/sky.js` TRANSMITTANCE_WGSL). With the sun moving, the boat, the cockpit and the
forest flashed warm for 1–2 film frames at ≈ 20:33 (the sun at −1.39°, 0.01° over the dip at the lake's 1.9 km). The
transmittance bake stopped each ray at the ground, and the tangent column (x = 1) met the ground or not by f32 rounding: half
the air, twice the light just before the sun set. The table's rays never meet the ground (every reader has its own planet
test), so the bake now marches each one to the top of the air. Only the last column changes; the light now falls monotonically to
the dip (`renders/clock/hours-quad.jpg` before, `hours-quad-fixed.jpg` after: 20:32:17, 20:32:32, 20:32:47, 20:33:01).
**The shadows to −2°** (`render/shadow.js` SHADOW_OFF_Y, `render/boat.js`). The terrain's sun shadow and the boat's own map turned off
under +0.57° (the sun's y 0.01), but the sun lights a surface down to the dip (−1.4° at the lake, −1.8° from the bay's highest
ground). On a setting sun every ridge and wall lit at once at 20:21 and the cockpit lost its shade: both maps now stay on until the
sun is 2° down, when no surface sees it (`renders/clock/hours-shadow.jpg`: +1.1°, +0.3°, −0.5°, −1.2°). No golden sits in that
band (the frames at those hours are 0 px moved).

**The key legend** (`src/ui/keyLegend.js` as it is, three-free with `src/ui/edgeStyle.js`; wired in `ui/sail.js` as v1's
`shell.js`): the edge pair's right block, the sailor's few keys in cream with no plate. v1's rules: desktop
only (a fine pointer, ≥ 1100 px), Sail, the cockpit up (off in the helm view, under the menu, the logbook or the keys list); the
always lines W S · R F · Space · C; the moments (K reef, G wing on wing, J anchor and I engine near the shore, B binoculars with a
landmark ahead: v1's landmarks from the logbook's baked world, `ui/logbookWorld.json`); a line dims after 3 uses, "?" recalls it
for 8 s; Setup › Screen › key hints turns it off; `?keylegend=0|1`. v1 over v2 at the same pose: `renders/clock/legend-v1-over-v2.jpg`
(the same five lines, the same box: 1041, 428, 198 × 173 px).

**Proof** (2026-11-13, the M5 Pro Mac, headless Chrome): `renders/clock/v2-clock-golden-dusk-helm.mp4` (15 s, 960 × 540, the
helm view, `tools/v2-film.mjs --timerate 440`: 19:06 → 20:56, golden hour into dusk), `renders/clock/v2-clock-golden-dusk.mp4`
(the follow camera, 19:00 → 21:00). The frame-time trace (`tools/v2-clock-trace.mjs`, a live page at 1920 × 1080, `?gov=0`,
every frame for 120 s; `renders/clock/trace/trace.png`, `trace.json`):

| run | hours (sun) | frames | worst rAF interval | worst CPU frame | worst GPU frame | frames over 33 ms | long tasks |
|---|---|---|---|---|---|---|---|
| `?hour=20&timerate=25`, the sea built in the frame (before) | 20:03 → 21:43 (+3.6° → −12.3°) | 7,139 | 133.3 ms | 91.7 ms | 40.3 ms | 23 | 20 (≤ 95 ms) |
| the same, the sea built in a worker (after) | 20:03 → 21:43 (+3.6° → −12.3°) | 7,201 | 16.8 ms | 9.4 ms | 13.9 ms | **0** | 0 |
| the same, final (the shadows kept to −2°), run 1 | 20:03 → 21:43 | 7,196 | 33.4 ms | 7.8 ms | 42.7 ms | 2 (GPU) | 0 |
| the same, final, run 2 | 20:03 → 21:43 | 7,197 | 66.7 ms | 63.3 ms | 23.8 ms | 1 (CPU) | 1 (66 ms) |
| the same page with the clock frozen (`?timerate=0`), the machine's floor | 20:00 | 7,200 | 16.8 ms | 5.9 ms | 15.5 ms | 0 | 0 |
| v1's day clock from 21:00 on July 4th (the evening's lapse to 21:44), after | 21:01 → 21:45 (−5.9° → −12.6°) | 7,201 | 16.8 ms | 6.1 ms | 17.1 ms | **0** | 0 |

The final runs' few frames are not the clock's: run 1's two are inside one second (16.4–17.5 s) when every GPU frame rose from 5 to
15–25 ms (other sessions' Chrome and renders shared the GPU at 525 % CPU); run 2's is one 66 ms long task at 2.3 s that no other
run shows, and `water.setWind` timed in place over 40 s never took over 7 ms (`renders/clock/trace/trace-run1.json`, `-run2.json`).
The hitches were the sea: with the wind's day on the clock, the evening's fade moves the wind past the sea's table key
(0.5 m/s or 0.6°) every few seconds, and each new pair of v1's lake and bay tables took 60–90 ms on the main thread. A live page
now builds them in a worker (`sim/sea-worker.js`, one job at a time, the newest key wins) and re-composes the old pair meanwhile
(scaled by the tables' own speed); the first build, every capture and the film clock stay in the frame (deterministic). The theme
flips to night at 20:31 (the sun at −1.06°). The sky-view and aerial LUTs (every frame), the cloud key (a band of rows a frame)
and the terrain shadow (every 4th frame or 0.1°) showed no cost above the noise on a sun moving 50 game s per real s.
Tests: `v2/tests/day-clock.test.mjs` (v1's schedule and rate, the start hour, fixed time under `?hour` and in captures, the cuts,
the menu, the night-sky line, the fireworks as a time event, Sail's night clock and wind), `v2/tests/pages/dayClock.page.mjs` (the running clock, the bar, a menu pick, the
sun and the theme, `?hour` frozen, the legend's lines, learning, the helm view and Setup's switch).

## The nav column (2026-11-13: ui/nav.js, ui/sail.js)
The owner, 2026-11-13: "In v1 desktop on the left side screen we have the pro data, on the right side we have the keys info, can
we bring them back in v2?" The right side is the key legend (above); this is the left. **v1's `src/ui/navColumn.js` and
`src/ui/passage.js` run as they are** (three-free with `edgeStyle.js`; no `src/` edit), wired by `ui/nav.js` as v1's `shell.js`
wires them: the `passage` service first, then the column; `ui/sail.js` calls `update()` each frame after the key legend.
v1's rules: **empty for a regular player** (Pro off, no mark); Pro on (the PRO recess, the trim panel, `?pro=1`)
brings COG · TWS · TWA | VMG · HEEL · RUD; a mark brings the passage block (MARK, DTW, BTW, TTG, XTE); Setup › Aids › edge
instruments (auto | always | off, the page's one store) and `?navcol=0|1`; kept in the helm view and Instruments, gone under Clear,
the menu, the logbook, the big chart, the keys list and the binoculars; fades with the Calm dashboard (calmHud.js's CSS). The
numbers are v2's boat state (`B.phys.state`: v1's BoatPhysics, so the same fields: `cog`, `sog`, `trueWind`, `heel`,
`rudderAngle`). Two hooks in `ui/sail.js`: the chart service gets v1's `state` getter (the passage reads Sail Pro's waypoint
from it), and `setPro` reaches the chart (`cp.setPro`, as v1's `attachChart`), so a Pro click on the enlarged chart sets a waypoint.

**Proof** (headless Chrome, the film clock): `renders/navcol/navcol-v1-over-v2.jpg` (v1's hud-full pose with `pro=1`, v1 over v2:
the column at the same box, 41, 372, 117 × 228 px; COG 254°, TWS 5.7 kn, HEEL 2° S, RUD 2° P on both; TWA 66° / 65° and VMG
1.3 / 1.4 kn differ by one step: the two engines' seas move the boat a little differently in 13 s), `renders/navcol/navcol-v2-sailing.mp4`
(8 s, 960 × 540: the column through a tack, COG 224° → 177°, TWA 23° P → 16° S). `tools/v2-navcol-shots.mjs` makes both.
Tests: `v2/tests/nav-column.test.mjs` (v2's boat sailed 20 s, then the same state through v2's wiring and v1's shell wiring: the
same rows and strings, row for row, through 10 s of a tack; the strings are the state's own numbers and `passageTo`'s; the show and
hide rules), `v2/tests/pages/navColumn.page.mjs` (live: empty by default, Pro, COG against the boat's course while it turns, the
helm view, Clear, a chart waypoint, always, off, `?navcol=0|1`).

**The passage plan** (2026-11-14): v2's enlarged chart now plans routes as v1's does, so the passage block shows "WP 1 · 3"
for a route (§ The passage plan); the older Pro waypoint click gives way to the plan's taps, as on v1. Cruise's rows (MARK, DTW, TTG with your mark, coming and going with the bar) are v1's (§ Cruise); School
and Regatta (their rows and the Regatta right edge) wait for those modes on v2.

## The passage plan (2026-11-14: ui/plan.js, ui/planChart.js, ui/planChart.bin, ui/sail.js)
, every default): the enlarged chart is the planner, with no mode to enter.
**v1's three-free modules run as they are**, wired as v1's `src/sail/chart.js` attachChart wires them for Sail (`plan: true`):
`src/sail/passagePlan.js` (the `course` service: the route, Set course, the legs, arrival within 40 m; the planner: each tap
checked by the navigator's own rules, the route layer, the skipper's lines, the first-time line under `lakeshore.passage.v1`),
`src/sail/passageSheet.js` (the sheet beside the chart), `src/ui/passage.js` (the nav column's passage block, fed by the course),
the chartplotter's plan layer (rings, legs, the A* bends, laylines, barbs, Set course · Clear) and `?route=x,z;x,z` (v1's row).
A click on the water appends a waypoint; a ring click removes it, a drag moves it, a leg's dot inserts one; Set course (or Enter)
starts the guidance: the column shows MARK "WP 1 · 3", DTW, BTW, TTG, XTE (with Pro off too), the skipper calls each leg and
"Waypoint 1 astern", the last arrival clears it. The column steps aside under the enlarged chart (v1's cover) and returns when it
closes.

**The chart the planner reads.** v1 builds the navigator's chart (`buildChart`, `src/sim/modes/chill/navigator.js`) from
`terrain.shoreDistance` and `terrain.heightAt` at the nodes of its 10 m grid (301 × 381 over the bay and the water off its mouth).
`tools/v2-plan-bake.mjs` samples v1's own terrain there once, in node, into `ui/planChart.bin` (91,038 bytes: gzip of the two
float32 fields as byte planes; `--check`). The shore field is clamped to −40 … +240 m, where no chart function a plan reads changes
(the margins saturate at 183 m of shore, comfort at 170 m; on land only the sign is read; the field moves at most 14.2 m between
nodes); the depth is exact. `ui/planChart.js` builds `buildChart` as it is from that grid and v1's page chart objects (the piers,
moorings, buoys and harbour: `cruise/chartWorld.json`, the rows Cruise charts), no lanes (v1's game has no paddlewheeler). It loads
with the planner's chunk when the small chart mounts (after the first frame; a `?filmui=1` page waits for it before its film);
a tap before it lands is kept and played in order.

**The whole lake (2026-11-16, the whole-lake chart).** The chart now covers all of Lake Tahoe. `tools/v2-plan-bake.mjs` bakes two
levels into `ui/planChart.bin` (172,523 bytes, 2.84 MB inflated): the bay level above, unchanged (so every plan inside the bay is
v1's, cell for cell), and a lake level over `ui/lakeBox.js` (x −5800 … 15400, z −33000 … 3200) at 40 m (531 × 906 nodes; int16:
the shore in 0.1 m steps, the depth in 0.05 m steps clamped at 25 m, where fixedAt and comfort have saturated). `planChart()`
returns one chart in buildChart's shape: the bay level's numbers inside the bay's region, the lake level's outside it, the fixed
objects stamped on both (the harbour, 5 km east of the bay, is on the chart now), and the lake's box as its region, so
checkDestination says "off my chart" only past the box and "dry land" for a shore inside it. The navigator's `findPath` calls the
chart's own `route(a, b)` (one line in v1's navigator; v1's charts have none): both ends in the bay, v1's 20 m A*; else A* on the
lake's 40 m grid (the same block and cost rule, heuristic weight 1.5), its open-water runs pulled straight, then any bay part
re-planned on the bay level; two ends in separate water (the bay inside its bar and the open lake) are refused at once by the
grid's water pieces. **The entrance channel (owner decision 2026-11-16).** The 1998 survey leaves the bar at the mouth 0.3–1.5 m deep (its deepest
crossing 1.15 m) and the keel draws 1.6 m, so the boat grounded on it under full power. `terrain/channel.js` (`v2/terrain/`) is the
one source: the widest line through the mouth (118 m off the shore at its narrowest), 509 m from the bay's basin to the lake's
drop-off, a 36 m floor 4 m under the July surface (y = 0), 22 m smoothstep sides (at most 17°) into the bar; the bed is the deeper
of the trough and the survey. `tools/terrain/carve_channel.mjs` carves it into `terrain/bay-h.lsh` (2 m; 5,668 texels) and
`basin-h.lsh` (10 m; 227 texels), idempotent with `--check`; `tools/terrain/phone_terrain.mjs` remakes the phone grids from them; the
lake (32 m) and ring grids keep the survey (coarser than the trough; the bay's grid covers the mouth at every stream stage). So the
physics bottom, the water's shading and caustics, the shore field (`tools/v2-shore-bake.mjs`, re-baked) and the chart
(`tools/v2-plan-bake.mjs`, re-baked) all read the same bed. On the chart the channel is a lane: on its floor the depth rule is the
keel's (draft + 1 m = 2.6 m) instead of open water's 6 m, its nodes are passable on the lake grid, and a route through it is laid
on its line; the navigator's beat and gybes have no room in 36 m, so AUTO and Cruise steer down the line while in it
(`sim/channelHelm.js`) and hand back to the navigator at its end. Sail's start to the east shore: out of the bay in about 5 min.
One chart a page
(`loadPlanChart()`, memoised): the planner, AUTO (`sim/autoNav.js` `{ chart }`, no wait for the heights any more) and Cruise
(`cruise/voyage.js` `{ chart }`) share it. Timings (Chrome on the M-series Mac, a private Vite): fetch + inflate + decode 9 ms, build 16 ms, the
lake grid and its water pieces 14 ms (once, on the first route), a 28 km route to the north shore 0.6 ms (median of 5); at a 4× CPU
throttle 32, 49 and 47 ms and a route 2–5 ms; at 6× 49, 73 and 71 ms and a route 3–9 ms; a sweep of 150 random cross-lake pairs found 149 (one end in cut-off water), none nearer the shore than 103 m or over
water shallower than 8 m, at most 4 % longer than the straight line.
**The enlarged chart over the lake** (`src/ui/chartplotter.js` `{ lake, mark }`, v2 only): two more zooms (9.6 and 19.2 km
half-heights; the wheel, or a two-finger pinch on a finger) over a coarse base of the terrain (`LAKE_CHART`, 40 m grid, 30 m per
px), built after the bay's base; their view stays on the lake's box (the widest shows the whole lake). Sail's double-tap mark is
drawn on the chart (an amber ring and dot, a dotted line from the boat) while no Cruise mark is set. Tests: `tests/lakeChart.test.mjs`
(routes to the south, east and north shores; the checks; AUTO 4 min to the east shore; a beat upwind; Cruise's far mark), the page
tests `chartUi` (the lake zooms, a far waypoint, Sail's mark on the chart, Cruise's far mark) and `autoTarget` (a far mark on a
desktop and on a phone; past the bar: "no safe way", once).

**Cruise:** the course steps aside (suspended: the column shows Cruise's mark), the route leaves the chart, and a tap on the chart
does nothing; Sail brings the course back.

**Proof** (headless Chrome, the film clock): `renders/plan/plan-v1-over-v2.jpg` (v1 over v2, the same three clicks on the
enlarged chart and Set course, the boat at the same start: the same legs on both, 230° 0.64 nm beat · 2 tacks, 050° 0.42 nm run, 217° 0.28 nm beat · 1 tack, the same notes and the bend south off the shore; the minutes differ by 0.2–0.4 min because the leg's wind is each page's own 60 s mean at its boat), `renders/plan/plan-v2-film.mp4` (10 s, 960 × 540: the chart opens, three clicks,
Set course at 3.0 s, the chart closes at 3.7 s; the column shows WP 1 · 3 with DTW 0.03 nm, then WP 2 · 3 at 9.0 s as the boat passes waypoint 1, 70 m ahead of her at the start; `renders/plan/film-sheet.jpg`). `tools/v2-plan-shots.mjs` makes both.
Tests: `v2/tests/plan.test.mjs` (the bake current; the chart's A* grid equal to v1's cell for cell, the margins, comfort, depth
and the shore's sign at 30,000 points; v1's createPlanner on v1's terrain and v2's on the bake: the same three taps give the same
route, legs (bearings, distances, the bend round the island, point of sail, tacks, minutes), notes, sheet rows and lines; refusals;
Set course, WP 1 · 3, the leg advancing within 40 m, the last arrival, Clear; the first-time line once; an early tap; Cruise),
`v2/tests/pages/passagePlan.page.mjs` (live: the first-time line, three real clicks, the sheet, the tools row, dry land refused,
Set course, the column after the chart closes, arrival WP 2 · 3, Clear).

**src/ edits:** none. The guard's shared list gains `src/sail/chart.js` (its `parseRoute`), `src/sail/passagePlan.js` and
`src/sail/passageSheet.js`. **Different from v1:** v2's chart still draws no place names, piers or harbour (it never had them), so
a click on a name is a plain waypoint (v1 snaps it to the place and names the leg); v1's Cruise sails a route with its navigator
(Cruise on v2 keeps its one double-tap mark); the barbs read v2's wind field as v1's read its own.

## The front door (2026-11-13: ui/loading.js, ui/noReel.js, ui/frontPlan.js, ui/front.js, ui/settingsStore.js)
v2 opens as v1 does, without v1's attract reel (owner, 2026-11-13: "merge front door, no reel"; v1 keeps its own): v1's loading
screen (the Lucid Lake mark, the voyage bar with the sailor's status line, the stage captions), the mark thinning onto v1's first
still (the golden still, the shell's first paint) in the first fraction of a second so the screen is never blank, then the live
lake: v1's navy N3 home card over the live lake for a returning visitor and every page of its Help sheet (Setup, Keys, What's new, Credits, Contact, Support, About,
feedback), the welcome, the in-play Menu card (Esc, the bar's Menu, Resume) and the bar's Setup; then Sail. **No staged first
minute** (owner, 2026-11-13: "in v1 we have a first min feature, it is very computing heavy, in v2 we do not need that"; v1 keeps
`src/ui/firstVisit.js` and `firstStage.js` unchanged): a first visit gets the same door as a returning one (§ The first visit).
**v1's DOM modules run as they are**; the loading shell is v1's markup and CSS, written into `v2/index.html` between the
`lk-load` markers by `tools/loading_shell.py` (the same source as `index.html`; `--check` covers all three pages).

| File | What |
|---|---|
| `ui/loading.js` | the first module (before main.js, as v1's): `installLoading` with v1's gate rule, `home: true`, no v1 boat prefetch, and `noReel.js` as its reel |
| `ui/noReel.js` | stands in for attractReel's api: no video element, no film fetch, no Skip, sound chip or caption (removed from the DOM), the mark thinned at 150 ms (0.6 s fade), `data-reel-end=live` when the card goes live (v1's cross-fade into the live lake), for a first visit too (no `data-first` dissolve) |
| `ui/frontPlan.js` | pure: `frontGate` (v1's auto-install gate), `BOOT_STAGES` (v2's boot → v1's loading stages), `pickStates`, `SOON` |
| `ui/front.js` | its own chunk after the first frame: `createHome` wired to v2 (the settings, the wind level, Pro, the HUD, the keys page, the feedback scene), the "soon" picks, the desktop note |
| `ui/settingsStore.js` | the page's one v1 settings store (format 2), shared by the card and Sail's Calm HUD |

**Boot.** main.js (marked "front door") tells the loading screen v2's steps as v1's stages (the same boot for a first visit:
no first-visit decision, no pinned start): `gpu` (the
device), `terrain` (the first grids asked for), `water` (every pipeline built), `sky` (the LUTs baked),
`boat`, then `ready()` at the first frame. No WebGPU: the launch gate's page (§ The launch gate: it links the classic Velia,
`/classic/`) and the loading card steps aside (v1 shows its fail state, as v1 falls back to WebGL2). `ui/m4.js` loads `front.js` and the settings store beside `sail.js`
(the card never waits for Sail's UI) and makes the card Sail's `menu` service; the camera is the views' chain alone (no opening
camera).

**The modes:** the mode pill keeps its three equal cells; Sail and Cruise play (Cruise since
BACKLOG-v2 #11: § Cruise; the card's pick, the welcome's "Just enjoy the view" and a page opened with `?mode=cruise` enter it);
Regatta stays in its cell, disabled, with v1's own quiet italic "soon" (the shell's `.lk-pick small` style,'s "Regatta
soon", like the lake and boat pages' "Soon" tiles and the language row's "(soon)"); with no film there is never a strip, the card
itself stands over the lake. School has no pick in v1: hidden. The idle attract is v1's (45 s untouched on the card: the card
slides aside and Cruise plays; a touch brings the card and the plan back; off in automated browsers and under `?attract=0`).

**The settings v2 applies:** every Setup row acts (no disabled "soon" rows since 2026-11-19: the steady horizon, camera to kayaks and wind lines rows are off v2's page, `REMOVED_ROWS`): § Setup's rows. LOG
opens v1's logbook (§ The logbook).

**The first visit (owner, 2026-11-13: no staged minute in v2):** a new visitor (no stored settings) gets the returning visit's
door: the mark over the golden still, then the home card over the live lake, then Sail on ENTER. What v1 shows a new visitor
outside its stage stays: v1's welcome on the card ("How do you sail?", then for New "How would you like to start?", where Cruise
is "soon"; Esc takes New and Sail), decided by `home.js` from the store's `welcomed`. Removed from v2's bundle: `firstStage.js`
(the director, the opening camera, the HUD hold, the hint hush, the shallows moment, the osprey and eagle beats, the VHF advisory,
the storm beat), `stagedStart` and its pinned start (the granite shelf, 080°, 2.1 m/s), m4's `setIntro` camera hook, the birds' and
the storm's hand-off to the stage (main.js's camera shim, front.js's `core` registry), the loading's `data-first` dissolve and the
film clock's wait for the stage, and the kayaks' 20 s placement retries (they were for the intro camera; the first pair is laid
once at the start of play, as v1's `layFirst`). Kept: v2's kayak first pair, the birds and the storm, which never needed the
stage. `?first=1` (v1's force) is just the card in v2. JS gzip (`npm run build:v2`, gzip -9, the same build before and after): 489.5 → 483.2 kB in all
(−6.3 kB); the entry chunk 286.7 → 285.9 kB (−0.8), the `front` chunk 28.6 → 24.2 kB (−4.4), and Sail's lazy chunks re-split
(`services` + `skipper` 11.1 kB → `keysContent` + `words` 9.2 kB; `sail` and `skills` +0.9 kB).

**Timing with no reel:** v2's first frame lands ≈ 0.5–1.1 s after navigation (warm, M5 Pro, a loaded machine); the card
goes live ≈ 1.4 s after it (v1's 1 s minimum after the first paint and the bar's last ease); nothing waits on a film clock. A first
visit is the same (no staged minute in v2).

**Seams in src/ (v1's behaviour byte for byte, v1's tests and goldens unchanged):** `src/modes/rows.js` (new: the registry's rows
without their chunks; `registry.js` builds each row as rows.js's row plus its `load`, the same keys in the same order;
`modeNames.js`, `home.js`'s picks and `loading.js`'s card looks read rows.js; `tools/loading_shell.py` reads it);
`src/features/setup.js` (new: the features' Setup rows and `shown`; `features/index.js` spreads each into its row; `home.js` reads
`featureSettings` from it); `src/ui/loading.js` `installLoading({ prefetch })` (default true, v1 unchanged; v2 passes false: its
boat models are its own packed files). `v2/tests/front-door.test.mjs` checks each seam against the old objects.

**Assets:** the vite config serves and copies `brand/favicon.svg`, `brand/stills/reel-golden-*.webp` (the one still),
`brand/card/*.webp` and `brand/lucidlake/lucidlake-g1-*.webp`; no mp4. `dist-v2/` is 24 MB.

**Budgets (2026-11-13, M5 Pro, the same build before and after):** first-load JS (the entry chunk) 181.5 → 191.4 kB gzip
(+9.9 kB: v1's loading.js, attractReel.js, attractStrip.js, deferLoad.js, frontPlan.js, firstVisit.js, the mode names);
`index.html` 1.05 → 16.65 kB gzip (+15.6 kB: v1's inline shell, its CSS, tokens and SVGs, as v1's index.html carries it): the card
and loading on the first load **25.5 kB gzip** (target ≤ 40). Lazy, after the first frame: `front` 28.9 kB gzip, `settingsStore`
0.95 kB, and a shared `services` chunk 10.5 kB that Sail's UI chunk gave up (sail 98.3 → 90.1 kB). v1's attractReel.js and attractStrip.js still ride in the entry chunk
(loading.js imports them; unused on v2, no fetch). Pipelines after the first
frame: 0 (the front door draws nothing on the GPU).

**Tests:** `v2/tests/front-door.test.mjs` (the seams, the boot stages, the gate, no staged start, the card's soon picks, m4's
camera as the views' chain alone, the settings store); `v2/tests/pages/home.page.mjs` (v1's menu.page.mjs and solaria.page.mjs on
the real v2 page, plus a first visit forced as v1's `?first=1`: the welcome, Esc, ENTER) and `loading.page.mjs` (the stages, the
bar, the mark thinning onto the still, no video, no film fetch, no Skip or sound chip, the card over the live lake, the card live
within 3 s of the first frame, automation, a new visitor's first visit: the card with the welcome, no dissolve, no stage, Sail's
own start, the welcome's picks then ENTER; no WebGPU). Golden: `v2-home` (v1's home pose: a fresh browser's welcome on the card
over the live lake, 90 frames of the film clock); `v2-first-visit` (the staged minute) is gone.

**The source link (2026-11-24: ui/source.js).** v2's card has no language chip (the language stays a Setup › Screen row; v1's card
keeps its chip). The card's foot carries one GitHub link to the repo instead, written into v2/index.html by tools/loading_shell.py:
the GitHub mark (an inline SVG in the text's ink) and the word "GitHub", label "Velia on GitHub", a new tab. Its place in each layout:
the desktop and tablet panel's foot reads Support Velia | GitHub | v0.8 | About (14 px type and mark, hairline dividers, 40 px rows,
44 px on touch: ui/chart/panelPlan.js); the desktop card before the panel mounts puts it first in the right group, 28 px with a 44 px
hit; the phone card lists it in the ⋯ menu between Support Velia and About (44 px rows, the 14 px mark where Support has its brass
dot: ui/phoneCard.js). Help › About adds "Velia is open source (MIT)." and the repo's address under the studio line (ui/aboutPage.js).
Tests: v2/tests/source-link.test.mjs; the panel's foot in pages/mapCard.page.mjs.

## The launch gate (2026-11-14: start.js, engine/gpuCheck.js, engine/device.js, sim/steadyCamera.js, ui/seaText.js; tools/build/base-path.mjs, site.mjs)

Once this merges, v2 is the public Velia (velia.lucidlakelabs.com) and v1, frozen, is the classic page at `/classic/`.
Screens for the owner: `renders/launch-gate/` (desktop 1280 × 720 and phone 390 × 844 upright).

**The WebGPU check.** `index.html` loads v1's loading screen, then `start.js` (not `main.js`). `start.js` runs
`engine/gpuCheck.js checkGpu`: `navigator.gpu`, then `requestAdapter` (the device's options) against a 5 s timeout. A pass hands
the adapter to `main.js` (`globalThis.__veliaGate`, read once by `device.js`) and imports it; `main.js` is a lazy chunk now
(323 kB gzip), so a browser without WebGPU fetches only the page and the loading screen's JS (17.7 + 19.3 kB gzip), never the
engine or an asset. No API, no adapter, a throw or the timeout show the page as "nogpu"; a device lost at load, a
`requestDevice` throw or a refused pipeline show it as "failed" (`device.js GATE_TEXT`). The page (`#nogpu`): the golden still
under a navy veil, the navy card's double rule, VELIA in Jost, "This browser can't draw the lake", one line, **Play the classic
version** (`/classic/`, a plain link: no redirect), "Or open Velia in" (Chrome or Edge; Chrome on Android 12+; Safari 26 on Mac,
iPhone, iPad; Firefox 141+ Windows, 147+ Mac; sources) and the reason in small print.

**The sea-sickness watermark** (owner, 2026-11-14: "add it to the loading page as a watermark"): `#lk-sea` in `index.html`, after
v1's shell markers, "Velia moves like a real boat. If you feel sea-sick, take a break." (words also
in `ui/seaText.js SEA_TEXT`). Every load, from the first paint, while the loading screen is up (`data-state=company`); 13 px,
cream at 62 %, no box, no tap; at the foot centred on a wide screen, at the head under 1000 px (the brand block fills a phone's
foot); hidden on captures and the WebGPU page. The home card has no plate.

**The helm camera's steadiness** (owner, 2026-11-19: no Calm camera setting; `sim/steadyCamera.js`, `ui/views.js`). The Helm view
blends from the game's own camera in calm water (heel and pitch cancel 0.4, smoothing 0.1 s, all the heave) to a steadier one in
rough water (0.7, 0.35 s, half the heave). The signal is the boat's measured heel + pitch RATE (RMS of the drawn pose's roll and
pitch speed over about 4 s, deg/s; 3 is calm, 9 is rough, a smoothstep between): a steady heel from the wind has no rate, and the
rate tracks what shakes the horizon, not the wind or a wave height the hull does not follow. The blend eases in over 2.5 s and out
over 6 s, so it never pops. The Boat view is untouched. The steady-horizon switch is gone: this is the steady horizon, always on. **Reduce Motion**
(the OS's `prefers-reduced-motion`, `reducedNow()`, read live) holds the old Calm values in both views: heel and pitch cancel 0.85
over 0.5 s, 35 % of the heave, no surf breath in the Boat view; it is the one accessibility signal (the speed camera, the trim
nudge, the menu drift, the fly-over, the cockpit's glide and the cinematic intro read it). No setting, no stored key (an old
`velia.calmcam.v1` is ignored), no flag, no `B.calm`. Tests: `v2/tests/launch-gate.test.mjs`; evidence: `tools/v2-steady-helm.mjs`.

**No classic row on the cards** (owner, 2026-11-15: drop the classic row unless needed; supersedes 2026-11-14's row on the
home card and the in-play Menu card). The classic Velia is linked only where it is needed: the no-WebGPU page's button
(`start.js`) and About's line.

**The in-play Menu card has no Resume step** (owner, 2026-11-15; `ui/menuCard.js`): a tap on Cruise, Sail or Regatta enters
that mode and closes the card; a tap on the current mode, Esc, the × at the card's top-right or a tap on the world outside the
card go back to the game. The ENTER pill (it read Resume in play) is hidden there; the keyboard starts on the lit mode. The
home card keeps ENTER: a tap on a mode already enters it there (home.js createEnter), and ENTER is the keyboard's first stop.

**About** gets one line: "Velia draws the lake with WebGPU. For other browsers there is the classic Velia." and the link.

**The share card.** `index.html` carries v1's description, og and twitter tags; the build ships `brand/social/velia-share.jpg`.
The robots noindex meta stays in v2's own source and `dist-v2/`; the switch build drops it (below).

## The logbook (fix(v2): LOG, 2026-11-13: ui/logbook.js, ui/logbookWorld.json)
Owner, 2026-11-13: "click Log button nothing happen". The cause: v2 had no logbook, so the front door passed v1's home card
`can.logbook: () => false` and no `go.logbook`; v1's card then paints LOG italic with its own "in Sail" title and a click returns.
Now **v1's Sail logbook runs as it is**: `src/sail/logbook.js` (attachLogbook: the page `src/ui/logbook.js`, its chart, the finds'
rules `discoveries.js`, the find line, the challenges) is three-free, so `ui/logbook.js` hands it a core made of v2's parts and it
records on v2 exactly what it records on v1: today's line (the boat's position and speed every 1.5 s of sim time; the chart page's
"today · n nm"; kept as the faint last sail on pagehide), the places and moments (the narrows, the island, the waterfall, the house,
the harbour, the light, the ruin by the camera's middle band; the first gust, the first tack, round the island, past sunset;
aground from the ground's mode turning 'aground'), each with its picture (the frame just drawn, grabbed in the render's own task:
main.js calls `m4.afterFrame(canvas)` after `graph.render`; v1's worker treats it), the first find said in the skipper's line,
the seamanship page (the skills' margin notes, signed; the challenges' bests), the sailor's words. **The same store** as v1
(`lakeshore.logbook.v1`, `lakeshore.challenges.v1`; the skills and words keep theirs), so one origin's log is one log;
`?logbook=reset`, `?challenges=reset`, `?once=0` as v1's. Live pages only: a headless capture and a `?filmui=1` page (the goldens' hud frames) never build it (its chunk landing mid-film moved the boat's readback timing: `v2-hud-calm` 0.29 %).

**Where LOG is:** the home card's LOG (the card closes first, then the logbook opens at 700 ms, v1's shell), the in-play Menu
card's LOG (60 ms), L (the logbook's own key) toggles; Esc or a press outside closes it and the Menu card stays down (`escFirst`).
The top bar and the cockpit step aside under it (v1's `switchShown` and the station's `dashHidden`; the 3D cockpit's draw follows
the station's hidden state, `rig.show(shown)`, so it is not drawn under the logbook, the Menu card or the keys list, as v1's hud
slot); the Calm HUD already read it.
`front.js logLinks(getUi)` holds the card's `go`, `can` and `escFirst`; LOG is lit once the logbook's chunk is up (≈ the UI's
chunk, after the first frame), until then v1's italic "in Sail".

**The world it reads:** v1 builds the lake's landmarks, the traced shoreline and the harbour's plan at boot from its terrain module
(a top-level fetch of v1's grids that v2 never loads). `tools/v2-logbook-bake.mjs` bakes v1's own results once into
`ui/logbookWorld.json` (46 kB, 794 shore points at the chart's 20 m step; re-run after a terrain, shoreline or harbour change;
`--check`); the heights and the line of sight read v2's terrain (`terrain.field.height`). The camera is m4's last pose (its
quaternion from the forward; v1 turns it back). The binoculars' sight finds read `captainTools.aim` as v1's (§ The binoculars
and the VHF). **Not on v2 yet** (each is v1's and checks for its system): the far sails (no traffic), the Milky Way (no milkyway aim), the
postcards' sounds and the page turn (no audio); the July 4th show's and a kayak bump's tiles show on v1's rules and fill when
v2's fireworks and kayaks provide v1's services. **The small chart draws today's track (#44, 2026-11-14):** `ui/sail.js` hands the
chartplotter v1's `attachChart` track (`src/sail/chart.js`): the logbook's line (`services.get('logbook').track`: a point every 1.5 s of
sim time, `{ x, z, v, t }`, thinned to one per 20 m once past 1,200 points, v1's `TRACK_S`, `TRACK_MAX`, `THIN_M`) plus the boat now;
`src/ui/chartplotter.js` draws it as on v1 (a hairline, 1.1 px on the small chart and 1.3 px on the big one, cream at 0.36 where the
boat was slow and 0.62 where it was faster than 2.4 m/s; no fade on the chart: the logbook page's own chart draws the same line
with its speed glow and its fade-in as it opens, already v1's).
None on a `?filmui=1` film (no logbook there), so the hud goldens hold.

**src/ edits:** none. The guard's shared list gains `src/sail/logbook.js` and what it reaches (`src/ui/logbook.js`,
`logbookChart.js`, `src/sail/discoveries.js`, `findLine.js`, `challenges.js`, `src/day.js`, `src/fireworks/share.js`,
`src/shoreline-layout.js`, `src/harbour-layout.js`). **Tests:** `v2/tests/logbook.test.mjs` (the bake is current; v1's chart and
places from it equal v1's; the quaternion; aground; a scripted sail on a small DOM records the narrows, the first tack and
aground with hour, place and picture in v1's key and format, the line, the first find said, the last sail on pagehide),
`v2/tests/logbook-card.test.mjs` (LOG on v1's real card: "in Sail" until the logbook is up, then lit; from home and from the
in-play Menu it closes the card and opens the logbook; Esc first), `v2/tests/pages/logbook.page.mjs` (the real page: LOG lit,
a click opens the card over the live lake, Esc, L, the Menu's LOG, the line after a short sail, the save, headless has none).

## The first sail's lines and the island goal (#4, 2026-11-14: ui/firstSail.js, src/ui/firstSailGuide.js)
v1's first-sail layer, not a staged first minute (the owner ruled out the stage and a reel for v2, 2026-11-13). v1's
`src/ui/firstSail.js` reached three (its island beacon, a three sprite, fetched with a dynamic `import('three/webgpu')`), so its
three-free half moved to `src/ui/firstSailGuide.js` with v1's behaviour unchanged: the rules (`createFirstSail`, `TIMING`), the
chips' DOM and CSS, the update; v1's `firstSail.js` keeps the beacon and the staged visit's timing and passes them in through a
`beacon` hook. `ui/firstSail.js` mounts the same guide on v2's Sail UI (m4.js: once the UI and the settings are in; updated in
`beforeStep`; not on a `?filmui=1` film).
- **The lines** (v1's `profile.js LINES`, once per welcome: `introShown`): New "Drag the wheel to steer — the crew handles the
  sails.", I sail "Scroll or drag the winches to trim.", I race "The Regatta is on the home card — try it on Hard." It goes through
  the hint row (`controlsHint.note`, no key) 1.5 s into the first quiet sail (the card gone, no logbook open) and clears on the
  hint row's own rule: 7 s, or sooner if another status line takes the row (on a phone the Calm HUD's one-time "Tap to show the
  helm" does at its first fade, 5 s idle: on v1 too). The pro offer.
- **No goal** (owner ruling 2026-11-16): v1's "Sail to Fannette Island" chip, its arrow and distance, and the
  arrival line and next suggestion that follow the island are not set on v2, desktop or phone: `ui/firstSail.js` passes
  `goal: false` to the guide. v1 keeps its goal. The waymark beacon, chart marks and Cruise destinations are separate.
- **Setup's hints row** hides the hint row (`setup.js`, v1's `setHints`), so no line shows; as on v1 the line still counts as said.
- **Cruise**: a New player is offered "Take the helm" after 60 s; its press switches to Sail through the page's modes
  (`switchMode` → `main.js modes.go`).
- Placement matches v1 to the pixel at 1280 × 720 (line 387, 62, 506 × 26; chip 517, 98, 247 × 26), 844 × 390 and 390 × 844:
  `renders/v2-hints-track/` (`v1-*.png`, `v2-*.png`).
**Tests:** `v2/tests/pages/firstSail.page.mjs` (the line after ENTER, its place, `introShown`, no goal chip, the
7 s clear, hints off in Setup, none on a film; with #44's track); `tests/firstVisit.test.mjs` (v1's rules, unchanged). The guard's
shared list gains `src/ui/firstSailGuide.js`.

## The binoculars and the VHF (#5, #6, 2026-11-13: ui/captain.js)
v1's captain's two tools on v2, as `src/sail/captainTools.js` runs them on v1 (that module reaches three through the VHF set's
3D model and the craft registry, so `ui/captain.js` is its logic on v1's own three-free modules, imported as they are).

**The binoculars:** v1's `Binoculars` (`src/boat/binoculars.js`: the 6.5° field of 7 × 50 glasses at the sloop's helm eye, the
0.45 s raise and 0.3 s lowering, the aim held in the world, 12 % of the boat's roll and pitch, the hand sway, the skipper's step to
the side, the 14 m near plane, the 0.7 s focus pull) and `blendPose` (the field on a log scale), v1's lens mask
(`src/ui/binocularsView.js`: the figure-eight, the darkened rim and its colour fringe, the CSS blur on the page's canvas for the
focus pull) and v1's HUD (`src/ui/binocularsHud.js`: the compass, the mil reticle, the rangefinder on v2's heights, 7×50 and the
focus, the sun's glare; it reads a three camera, so `cameraShim` turns v2's pose into `matrixWorld` and `position`). **Driven by
v2's camera chain:** `m4.camera` runs the views (follow | helm | the move) and hands their pose to `captain.camera` as the
"normal" the glasses rise from; main.js draws the result at its field and near plane (no pass, no pipeline of its own). **The
hands, v1's rules:** B or the PRO recess's BINOS (the dock's `binoculars`) latches them up and again lowers them; a click on the
water lowers them; the mouse aims with no drag (0.005 / 0.004 rad a pixel ÷ 7), a drag or one finger aims too (`m4.takeLook` in
main.js's readHands: the views get no look or zoom while they are up); Escape lowers them and leaves the Menu card down (#34, v1's shell:
front.js `logLinks` escFirst names the raised glasses, so v1's card lets that press through); the Menu card (by its button) or the
logbook coming up lowers them too. While up: the top bar and the 3D cockpit step aside
(sail.js `dashHidden`, the station's hidden state: the cockpit is not drawn), the skipper's line and the wind dial hide,
`<html>.lk-bino-up`. BINOS lights while they are up. **Sightings:** the logbook (ui/logbook.js) reads `captainTools.aim` and a
real clock (`controls.feel.t`), so v1's sight finds record on v2 as on v1 (§ The logbook). v1's binocular sightings are the
landmarks and the far sails; v2 has no traffic yet, so no far sails; v1 records no kayak or bird by the glasses (the kayak's
entry is a bump), so neither does v2. `?bino=1` raises them from the start, `?bino=228.4,1` aims them at a bearing and pitch
(degrees), `?bino=0` builds them lowered on a `?filmui=1` page (the film tool).

**The VHF:** v1's radio (`src/vhf/radio.js`: the clips laid end to end, band-passed 350–2,800 Hz with the presence lift, the soft
clip, the hiss and the squelch's open and tail, the wordless chatter), forecast (`src/vhf/forecast.js`) and harbour master
(`src/vhf/harbourMaster.js`), on captainTools' schedule: on by default (Settings `vhf`, saved); the forecast by itself 20 s into
a sail (one time step of the bay's wind a frame, ≈ 10 frames, then played); O asks for it now, O again returns to 16; the harbour
master's calls on v2's true wind (the gust warning after the 40 s warm-up, an advisory day; never over the forecast, 60 s apart);
the harbour's chatter within 700 m of the entrance (the logbook's baked harbour); the Pro panel's VHF (the recess's dome in the
cockpit form, the trim panel's push-button otherwise) turns the radio off and on and lights while on. `?hm=0`, `?chatter=0`, `?fv`
as v1's. **The forecast reads v2's state:** the WindField the boat sails in (its day, level, gusts, shifts, advisory) at `B.t`; the
waves' fetch from v2's heights (`shoreFromHeights`: v1's `fetchTrace` within 30 m of v1's shore-distance grid every 45°). v2's live
day clock is frozen today (timerate 0): forecast.js's `timeAtHour` then bisected out to ≈ 10^13 s and the gust cells there crashed
the page on O; `forecastWind` gives it the same field on a 1 h / h clock from now (the field itself once the day clock runs). **The
sound:** v2's page AudioContext (engine/audio.js, made in the first gesture), the radio on its own gain node into the page's
master (`radioAudio`: eased in over 30 ms when the context comes; a stop eases the bus out over ≈ 60 ms before v1's stop, so a
second O or the VHF button never clicks; the other sounds keep their own nodes). **Loading:** `captain.js` is its own chunk after
Sail's UI (after the first frame); the radio is made only while it is on (the clip table `forecast.json`, 3.4 kB); the sprite
(`forecast.opus` 238 kB, or `forecast.m4a` 864 kB where Opus will not decode) is fetched and decoded on the first play only. A
headless capture builds none of it.

**For the audio-compression item (#7a):** the VHF ships 1,105,118 B on disk (`forecast.opus` 238,170 B: Opus 16 kb/s mono 48 kHz,
118.3 s; `forecast.m4a` 863,540 B: AAC-LC 57 kb/s mono, the twin for Safari before 18.4; `forecast.json` 3,408 B); a browser fetches
one sprite. Decoded, the sprite is 118.3 s × 48 kHz × 4 B = 22.7 MB of PCM for the session. Options, not done (each is a re-encode or
a re-render, not trivial or lossless): the m4a at HE-AAC ≈ 24 kb/s mono (≈ 0.36 MB) or AAC-LC 32 kb/s (≈ 0.48 MB), best from
`tools/vhf_voice.py`'s own render rather than from the Opus; the sprite at 24 kHz (the radio's filter ends at 2.8 kHz: half the PCM,
11.4 MB); or split by clip family so a session decodes only what it plays. The skipper's voice (`audio/skipper/`, 49 lines: 0.82 MB
Opus + 1.1 MB AAC ≈ 1.9 MB) is not played on v2 yet.

**Seams in src/:** one since #35: `src/boat/vhfFace.js`, the VHF set's pure half (its numbers, `lcdView`, `drawFace`), moved out of `src/boat/vhf.js` unchanged and re-exported there. The guard's shared list gains `src/boat/binoculars.js`, `src/boat/helmCamera.js` (a re-export of the
sim's), `src/ui/binocularsView.js`, `src/ui/binocularsHud.js`, `src/vhf/radio.js`, `forecast.js`, `harbourMaster.js`, and what the
forecast reaches: `src/wind.js`, `src/timeOfDay.js` (re-exports of the sim's). Copied, not imported: captainTools.js's schedule and
its two constants (`AUTO_FORECAST_S`, `CHATTER`; the test holds them to v1's).

**Budgets (2026-11-13, M5 Pro, headless Chrome, the GPU shared with other helpers; `tools/v2-bino-bench.mjs`, 2332 × 1458
backing, 5 rounds alternated in one page, 120 frames each):** the glasses raised toward the island and the ruin (the forest and
the terrain at 2.4 km through 6.5°) 3.38 ms GPU median against the follow view's 4.79 ms (the scene pass 1.84 vs 3.32 ms: the
cockpit is not drawn and the narrow field culls most of the world); CPU frame p50 0.7 vs 0.8 ms. Pipelines after the first frame: 0.
The radio's frame with no job: under 50 µs (the test); a forecast step: the test's median under 8 ms. JS (`npm run build:v2`): before the first frame only the hooks in m4.js and
main.js and the `bino` row (under 1.6 kB gzip even as source with its comments); the `captain` chunk 26.8 kB (12.0 kB gzip) after
Sail's UI; the logbook's baked world (19.0 kB gzip) is now a chunk shared by the logbook and the captain (the harbour's entrance),
not new bytes.

**Tests:** `v2/tests/captain.test.mjs` (v1's numbers; v1's binocular tests on v2's chain: the raise to 6.5° at the sloop's helm
eye, the lowering back to the views' own pose, the aim held through a 90° tack and the waves, the focus pull; the drag routed to
the aim only while up; the HUD's camera shim; v1's sight finds from `captain.aim` on v2's world; the keys; the radio's schedule on
v2's state: the forecast by itself at 20 s over ≈ 10 frames, the same words as v1's forecast, back to 16, off, a capture, the
VHF saved off (no radio, no fetch); the harbour master's gust call waiting for the forecast; the chatter near the entrance only;
Settings `vhf`; the frozen clock; every token's clip in the shipped sprite; the bus's eases; the CPU), `v2/tests/pages/captain.page.mjs`
(the real page: nothing from audio/vhf/ before the first frame; B, the mask and HUD, the cockpit and bar aside, the mouse's aim, a
click lowers, BINOS and its light, the Menu card; 0 pipelines after the first frame; O plays the forecast through the page's sound,
the sprite fetched then; the Pro panel's VHF off (saved) and on; headless builds none). Golden `v2-binoculars` (a `?filmui=1` page,
4 s, `?bino=228.4,1`: raised toward Fannette Island).

**What differs from v1:** the VHF set on the pedestal came with #35 (§ The instruments: v1's set and its LCD, driven by
`captain.lcd`), but not v1's click on it in the helm view (no helm pick on v2); no terrain detail where the glasses look (v1's `lodFocus`; v2's CDLOD has no focus input); no far sails (no traffic); the gamepad's
stick click is not wired (v2 has no gamepad yet); with the day clock
frozen, the forecast's trend reads the field on a 1 h / h clock. **The near plane over the water (#33, both apps: `src/boat/binoculars.js` `nearOverWater`):** a raise from a view that looks down
(the follow camera, the helm view) used to cut the near water with the 14 m near plane and show the lake bed. The near plane now
comes in to 0.7 of where the frame's bottom edge meets the water (0.4 m under the eye for a crest; never under 1 m), in the raised
pose and in the blend once it passes focusAt; a level aim (down less than ≈ 3°) keeps v1's 14 m, so the rig stays clear and the
golden `v2-binoculars` (aimed 1° up) is unchanged.
