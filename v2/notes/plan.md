# v2 notes: Plan mode

## Plan, phase 1 (2026-11-25: plan/*, a chunk of its own)

The long passage, sailed on the chart. `?mode=plan` opens the entrance as Sail's; Set sail lands in Plan: the chart page (the
in-game menu's live chart) with the boat under way. Not on the home card yet; not the default.

| File | What |
|---|---|
| `plan/plan.js` | pure facts: the rates (‖ ×1 ×4 ×16 ×60), the clock lock, the rate's 1 s ease, the auto-slow, the panel's fold, the legs (course, nm, point of sail, the polar's speed, the arrival time), the debounce, the mode table's hooks |
| `plan/index.js` | the controller: the pilot (Cruise's navigator and AI skipper on the whole-lake chart, `ui/planChart.js`), the corners (each checked by the navigator's `checkDestination`; the legs re-routed 120 ms after the last), the clock, the handover both ways |
| `plan/ui.js` | the card as Plan's bar: the 64 px rail and the passage panel (glass tokens defined locally under `#lk-load[data-plan]`, to unify with the glass rollout's), the plate |
| `plan/mapLayer.js` | on the live chart: the passage (solid legs on the planner's path, numbered corners with times), the boat, the small wind dial; a click on open water lays a corner |
| `plan/mapBoat.js` | the map's boat: the Coach's own drawing (`src/ui/captainView.js coachBoat`, the group the cockpit's Coach draws too, with `ui/dialsV2.js`'s cues) turned to the heading, words upright, a glass chip under her (point of sail, tack, SPEED, WIND; only the first row under 80 px), 70–130 px by zoom, words at 11 px, muted port and starboard; one replaceable factory (`setMapBoat`) |

- **One clock.** In Plan the day clock runs 1 game s per sim s (`lockClock`), and the rate is the sim seconds a real second runs
  (`modes.speed()`): ×1 is real time, ×60 is a game hour a real minute. The sim clock's step cap rises with the rate
  (`engine/clock.js setMaxSteps`, `stepCap`: the page's longest frame, 0.25 s, at the rate). A frozen clock (every capture and golden) and `?timerate`
  are never locked. Leaving Plan restores Sail's day clock and the page's step cap.
- **Auto-slow** to ×1 (eased over 1 s), each moment once: a corner ahead (within 3 real seconds at the rate plus 60 m), the arrival,
  a wind shift over 20° from the rate's last press, a gust lane 300 m ahead (the wind over its base at 1.24 or more, at most one
  each 10 game minutes: 1.16 was passed 10 % of an evening), Tessie within 300 m, the sun sinking under +10°.
- **The bar.** The panel is open with no passage (how to lay one), folds to the rail 6 s after the last press (never while the
  pointer is in it), opens on a rail press, Tab, or an auto-slow. ‹ or Esc folds it.
- **Handover.** Take the helm: the chart zooms into her (0.9 s), the rate eases to ×1, then the menu closes, the pilot lets go
  with the skipper's trim (Cruise's `handoverTrim`), and one plate names the leg for 9 s. Closing the chart any other way (Esc,
  Resume) is the same handover without the zoom. N, the Chart dial or the menu opens the chart again and the pilot takes her on
  the passage from where she is. No camera cut (Sail's follow camera is under the chart all along), no heading change, no clock reset.
- **The water card** steps back while Plan holds the chart (`chartTarget` without `setWater`): the chart's single tap on open water
  then sends `water` with its `{ x, z }` (`ui/chart/liveChart.js`), and Plan lays the corner.

Deferred to later phases: draggable corners and live re-timing, the laylines, the ghost and the forecast scrub, save and resume,
the logbook lines, Watch from the deck (Cruise folded in), the chart overhaul (the layer pill, the poster), arriving at anchor (the
pilot lets go at the last corner, the rudder centred), the phone's strip and sheet, the away voyage.

Tests: `v2/tests/plan-mode.test.mjs` (the row, a route off land and shoal, the clock lock and rates, each auto-slow trigger, a 3-corner
run at ×16 slowing at corner 1, the fold, the handover both ways), `v2/tests/pages/plan.page.mjs` (the live page: three corners,
×16, the slow at the first corner, the rail, Take the helm and N back).
