# v2 notes: Plan (the chart's routing)

## "Where to?" (2026-11-25: ui/chart/mapUx.js, ui/chart/liveChart.js `whereTo`)

The map's top bar is now the way to pick a destination, with no new element or words. Chips: **All · Places · Anchorages** (Regatta adds
Races and Marks: Places · Races · Anchorages · Marks). A chip shows its kind alone (single choice, no multi-toggle). A tap on **Places** or
**Anchorages** also opens the EXISTING card of the nearest point, **Sail here** first (`nearestOf`: nearest to the boat; on the start
screen the current start; else the map's centre; the point she is at, a pin past the paper, the hunts' corners and Tessie's water are left out; a point
out of view is glided to). One more tap on Sail here sails there. A second tap on the same chip is the next nearest (wraps). **All**
shows everything and closes the card. At the start screen and in Cruise the card keeps its own first action (Set as target / Anchor
here), as Sail here is Sail's only. The phone's round Layers button opens the same chips.

Removed: **Wildlife** (its chip; the only `area` point is Tessie's water, a dashed ring with a card and Be Tessie, so it stays drawn and
is a Place now) and the **Your wake** chip (the wake is always drawn; Setup › Sail › Your wake › Forget still clears it). Outside Regatta
Marks is not a chip: the buoys, the channel and the barges draw with All as before, and hide only when a chip shows its own kind.
Tests: `v2/tests/map-ux.test.mjs` (bar by mode, no Wildlife or wake chip, `nearestOf`), `v2/tests/pages/mapUx.page.mjs` (the chips, the
card, the cycle, All, the wake, the phone), `mapCard.page.mjs` (the Regatta bar).

## Sail here from the chart (2026-11-25: ui/chart/liveChart.js, ui/sail.js, ui/chart/mapBoat.js, ui/chart/panelDock.js)

Plan is not a mode and adds no UI: it is the live map's routing in Sail, in the chart page's own design (its base map and engraved
style, its card, its controls, the panel's navy, cream and amber). A click on open water, or on a place, opens the map's existing
one-action card with **Sail here** first (Set as target after it; on a finger device Sail here takes Set as target's place on the water's card, so the card fits the phone's box): it sets Sail's mark and puts NAV on it (`chartTarget.sailHere`:
the mark's 2 m rule, then `navToMark`), and the boat sails there under the open map, routed by NAV's own pilot (`sim/autoNav.js`:
the navigator on the whole-lake chart, off land and shoal). A double-click on the map's water is its shortcut. Esc or Resume returns
to the lake at once with NAV still on; a hand on the helm takes over, as NAV does. The chart's one-time hint now teaches it
("Click the water to sail there · scroll to zoom"; a finger: "Tap the water…"). Cruise keeps its one mark (Set as target only).

**The boat on the map** is the cockpit Coach's own drawing: `src/ui/captainView.js coachBoat({ svg, scale, coach, … })`, the group
the Coach dial draws inside its ring, laid on the map by `ui/chart/mapBoat.js` (turned to her heading on the map, words upright,
a small navy chip under her: point of sail, SPEED, WIND (no action words, no tack chip, no "feels N", owner 2026-11-25); 70–130 px by zoom, words at 11 px, the chip down to its first row
under 80 px; port and starboard muted for the map, `--lk-map-port` / `--lk-map-stbd`), in place of the chart's sloop glyph
(`chart.setOwnBoat(false)`). `setMapBoat(factory)` swaps the drawing in one place.

**The left panel** in the in-game menu hides like a dock (`ui/chart/panelDock.js`, desktop and tablet; the phone card unchanged):
it slides out past the left edge 3 s after the pointer went to the map (not before the pointer was on the map, not with a plate
open), the map takes the full width, and it slides back when the pointer touches the left edge, Tab moves into it, or a finger taps
the edge's 16 px. Its look is unchanged.

Not built (phase 1's first draft, removed on the owner's ruling: no new bars, plates, rails or panels; no extra step): multi-corner
passages, the ×4–×60 rate and its auto-slow, arrival-time labels, a Plan mode row, the lightened photo. They are in the branch's
history (56b5105) if ever asked for.

Tests: `v2/tests/sail-here.test.mjs` (the card's action through the services, no Plan row, the dock's rule, the boat's size and its
one drawing), `v2/tests/pages/sailHere.page.mjs` (one tap sails; Sail here engages NAV and she closes on the target under the open
map; the Coach's boat on the map; the dock out and back; the double-click; Esc keeps NAV; no Plan element exists).
