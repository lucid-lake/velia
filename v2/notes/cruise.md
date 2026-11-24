# v2 notes: Cruise mode

Moved verbatim from `v2/README.md` on 2026-11-23 (refactor round 3 D1). The map is `v2/README.md`; the section list is `INDEX.md`.

## Cruise (BACKLOG-v2 #11, 2026-11-14: cruise/*, a chunk of its own)
: "Sail on a safe autopilot, music on, a background experience". **v1's Cruise on v2's shared sim, v1's three-free
modules as they are** (src/modes/chill/: the navigator, the AI skipper, the director, the five cameras, the passenger's rules,
the mark;: one bar, the Locker, the lake sets the mark). The home card's Cruise pick, the welcome's "Just enjoy
the view", `?mode=cruise` (or v1's `?mode=chill`) and the idle attract enter it.

| File | What |
|---|---|
| `cruise/plan.js` | pure, in the entry: `cruiseAtBoot` (v1's aliases from `src/modes/rows.js`), `CRUISE_HOUR` (17:54), `cruiseWind` (v1's coreOptions: Tahoe's day, `?wind=` its level; a pinned wind the steady base), `cruiseSchedule` (v1's `chillClock`: the day clock at base 20 per sim s), `cruiseSpeed` (1 ×, `?speed=`) |
| `cruise/voyage.js` | pure: v1's voyage.js on v2's boat. `buildChart` on v1's lake terrain (`sim/lake.js`: v2's heights + v1's shore grids) and v1's page objects, `chooseStart`, `Navigator` + `scenicRoute`, `CruisePilot` (skill 1), `Director`, `createCameraRig` on v2's follow camera; the autopilot runs inside `B.step` through `B.drive(fn)` (v1's helm.js before-hook on the same clock) |
| `cruise/index.js` | the chunk: the lake, the chart, the crowns; the passenger's UI (the bar, the Locker, the quiet line, the keys and the pad, the double-tap mark, the photo); the hand-over and back; the capture's settle |
| `cruise/world.js` | the lake (the kayaks' when the page has them), the forest's crowns from v2's `forest/data/*.vft` in v1's treetops shape, the chart objects |
| `cruise/chartWorld.json`, `chartRows.js` | v1's page chart objects (the 33 OpenStreetMap piers, the harbour's breakwaters and basin), baked by `tools/v2-cruise-bake.mjs` (`--check`) |
| `cruise/music.js` | the music hook (below) |

**Hooks outside cruise/ (small, marked "Cruise"):** `sim/boat.js` `drive(fn)` (the autopilot on each tick; the hands skipped) and
`place(pose)` (v1's fresh boat at the mode's start: the same objects, the settle and the film helm on the new heading);
`engine/clock.js` `setSchedule(s, t)` (Cruise's day clock from now; a frozen capture ignores it); `engine/flags.js` (v1's rows
`mode`, `cruisecam`, `coursecam`, `chillsettle`, `music`); `main.js` (the boot's hour, wind and clock under `?mode=cruise`; the
mode switch the card uses; the autopilot's step, the rig's camera and its hand-over ease in the frame; Cruise's 1 × game speed;
no cockpit draw in Cruise; the capture's place, settle and `?chillsettle`; `__velia.cruise`, `__velia.mode`, `stats().cruise`);
`ui/m4.js` (`overlay`: the binoculars over Cruise's camera; `onAfterFrame`: the photo); `ui/sail.js` (`setMode`: Sail's bar,
keys, station, hints, legend and dial step aside in Cruise, the nav column and the key legend take the mode); `ui/front.js`,
`ui/frontPlan.js` (Cruise plays; the attract).

**The voyage on v2.** v1's sequence: the chart (a 10 m grid, the shore and depth from the lake terrain, v1's piers and harbour),
the start (`?start=x,z&heading=` or `chooseStart` upwind of v1's reference start), the boat placed and its first stop, then every
1/60 s tick the navigator plans and the skipper sails (sheet, traveller, twist, backstay, jib lead, rudder on `B.ctl`). A capture
settles 20 s on her heading (v1's), then sails and directs `?chillsettle` s at 30 Hz (v1's `settleCapture`). Live: the sim at 1 ×
(Sail: 2 ×), the day clock at Cruise's base 20 (its 4 × night kept), v1's night-sky line "The stars come out…" once a night in the quiet line (no "The night passes…" since 2026-11-15). The kayaks lay their first pair
from Cruise's view when play starts.

**The cameras:** v1's rig through v2's chain (main.js `placeCamera`: the rig's pose, then the binoculars, `m4.overlay`):
Boat (v1's astern: Sail's follow camera; Cruise opens in it), Above (V: north-up / course-up), Helm, Island, Cinematic (the
director's shots: wide, follow, low, pace, orbit, drone; sight lines over the terrain and the lidar crowns; last since the owner's
2026-11-15 ruling, v2's own order in `v2/cruise/cameras.js`, v1 keeps Cinematic first; `?cruisecam=cinematic` opens on it);
C and Shift+C, the bar's menu, the pad's Y and d-pad; each switch v1's 1 s eased move; a drag looks and the wheel or a pinch zooms (v2's `ui/touch.js` hands).

**The UI:** one bar, v1's `viewSwitch` with Cruise's slots: Menu | Boat ▾ (the camera on screen) · Take the helm | Locker ▾ (Chart ·
Glasses · VHF · Logbook │ Photo, lit rows) | Music Full Setup | Wind Weather | clock (the same Wind, Weather and clock menus as
Sail's); nothing at rest (the Calm HUD's fade). The quiet line (`src/modes/chill/quietLine.js`) at the edge gap: the first
gesture's "look round · C the camera · A D to take the helm", the mark's lines, the arrivals, the night. Keys: C, V, N, B, O, L,
P, `]`, `[`. A double-click (a double-tap) on the water sets your mark through the chart's checks ("Aye. Setting a course for your
mark."), the amber ring on its spot, a double-tap on the ring clears it; the nav column shows MARK · DTW · TTG with the bar.

**The hand-over (v1's handover.js):** a steering key (A D ← → W S …, v1's `keyClass`), the phone's steering strip, the pad's
stick or trigger, or Take the helm: the autopilot lets go, Sail's hands take the skipper's trim (the sheet, Pro on with its four
controls, the rudder), the clock goes back to Sail's (base 10 at 2 ×), Sail's view (Helm from the helm camera, else Boat) with
the camera eased in from the pose on screen (0.35 s from Boat or Helm, 1 s from the others), Sail's bar, cockpit, hints and legend,
"You have the helm"; the key that did it acts in Sail. The ` key hands her back ("She sails herself. Sit back."): the skipper
picks up the trim as the player left it, the camera eases into the rig's, the navigator picks the nearest stop. The ` key in a
fresh Sail (no Cruise loaded yet) or a race goes to Cruise. A switch keeps the boat where she is, as v1 passes `start=x,z&heading=`
(owner 2026-11-14, MODE-6): the card's Cruise from Sail starts Cruise from her pose (v1's 2.5 m/s), the card's Sail from Cruise (and
the first sail's "Take the helm" chip) is a fresh Sail in place, quietly, with Pro from Setup's proMode; a page opened in Cruise still
starts at Cruise's own start. The mode switch's rules live in `ui/modeSwitch.js` (v2/tests/mode-switch.test.mjs): Regatta from
Cruise is no hand-over (no line, no Pro, not handed), the race runs at real time with the day clock at rate 1, and Sail's clock and
2 × come back after it.

**Music on (v2/audio/music.js, § The music: the API for Cruise).** `cruise/music.js` is the one place Cruise calls it: Cruise's
start and the hand-back `music.setMode('cruise')` (the beds hold, v1's seeded playlist claims the music bus; it sounds from the first
gesture, when the page's context exists), the hand-over `music.setMode('sail', { finish: true })` (the piece plays out, the beds wait
240 s, v1's), a switch to Sail from the card `setMode('sail')` (a 1.5 s fade); `]` and `[` next and pause on the playlist; the bar's
Music is `music.player` (the playlist in Cruise). No music on a capture, a `?filmui=1` film or `?music=0` (every call a no-op).

**The shallow-water assist** (on by default, v1's `src/sail/grounding.js`) lives in Sail's hands (`sim/boat.js hands()`), which the
autopilot skips, as v1's Cruise mounts it only with Sail's controls: in Cruise the navigator's own margins keep her off (3 m under the
keel hard, 6 m planned); after the hand-over the assist is Sail's again.

**Seams in src/ (v1's behaviour byte for byte, v1's goldens unchanged):** `src/modes/chill/quietLine.js` (new: the quiet line
and `LANE`, moved unchanged out of passenger.js, which imports and re-exports them; `tests/design.test.mjs`'s token check reads the
CSS where it now lives); `src/forest/topsBox.js` (new: `TOPS`, out of `treetops.js`, which re-exports it) and `src/forest/rules.js`
(new: `LIDAR_LAND`, `TREE_RULES`, out of `trees-scatter.js`, which re-exports the same objects), so `src/forest/crowns.js` (now
importing them) reaches neither v1's terrain loader nor node's fs.

**Proof** (2026-11-14, the M5 Pro Mac, headless Chrome; `tools/v2-cruise-compare.mjs`, `tools/v2-cruise-shots.mjs`):
- the trace, v1's Cruise vs v2's, 60 s from the same start and seed (`?mode=cruise&hour=17.9&seed=1&windspeed=5&winddir=200`,
  no kayaks, no show; both settle 20 s, then sail): the same start (v1 238.80, 231.80, 131.20° · v2 238.97, 231.95, 131.22°),
  largest |Δ| 0.60 m in position, 1.66° in heading (both in the tack at 29–30 s), 0.15 kn, 0.11° heel; the navigator's target the
  same every second (61/61); the end 0.22 m apart (`renders/cruise/compare.json`). In node, on v1's own world and wall clock, the
  first 281 ticks are bit for bit v1's, then v2's sea in the env (the float's heave) moves them by millimetres (`v2/tests/cruise.test.mjs`);
- v1 over v2 at v1's poses (`?cruisecam=` each start camera, `?chillsettle=4`): `renders/cruise/cruise-{cinematic,boat,above,helm,island}-v1-over-v2.jpg`;
  the cameras within 0.2–2.4 m of v1's (the director's first wide shot and the island's vantage the same);
- `renders/cruise/v2-cruise-film.mp4` (15 s, 960 × 540: the director's wide shot, then Boat, Above, Helm, Island, each a 1 s move).

**Tests:** `v2/tests/cruise.test.mjs` (the page facts against v1's; the start; the voyage against v1's headless voyage; the hook,
place, the five cameras, the mark, the chart objects' bake, the clock's schedule, the music hook), `v2/tests/pages/cruise.page.mjs`
(live: the autopilot at 1 ×, Cruise's hour, one bar, C, the Locker, the double-click mark and its ring, the hand-over at 2 × and
back, the card's pick, the welcome's "Just enjoy the view"), `front-door.test.mjs` and `home.page.mjs` (Cruise no longer "soon").
Golden: `v2-cruise` (v1's Cruise capture, the Boat camera at 17:54).

**Budgets:** the `cruise` chunk 80.8 kB (32.2 kB gzip) plus `chartWorld` 5.1 kB gzip, fetched only when Cruise starts; the entry gains
`cruise/plan.js` (a few hundred bytes). Cruise's start on a live page: the chart (≈ 115 k cells) and the crowns (v1's ≈ 1 s
raster) once, after the terrain's stream; per frame the navigator decides once a sim second and plans every 15 s, as v1's.

**What differs from v1:**
- Not ported yet: the fireworks trip (the clock menu's Fireworks row and the 20:15 auto-trip: the crew, the anchor, the show's
  shots, the evening's lapse; v2's Cruise leaves the show to the hour), the show's barges on the chart (`?fireworks=0` charts the
  same as v1), the kayaks as the navigator's traffic (v2's fleet has no `agents` yet; v1 passes astern of them) and v1's rule
  that Cruise lays the first pair once the autopilot has settled, the passage plan's routes on the big chart and a click on it
  as a mark (the double-tap on the water sets it), the helm view's wheel and winch presses as intent (keys, the strip, the pad and
  the button hand over), the stars camera on a dark night.
- The crowns are v2's forest files (0.25 m lattice; a shrub's radius from its height) in v1's raster: a sight line can differ by a
  fraction of its 2 m cell. The cockpit is not drawn in Cruise (v1 mounts Sail's station only at the hand-over).
- A switch from the card's Sail to Cruise keeps the wind field the page booted with (v1 rebuilds the world's wind per mode);
  a page opened in Cruise has v1's Cruise wind and clock.
