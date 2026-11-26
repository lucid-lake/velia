# v2 notes: Plan (the chart's routing)

## "Where to?" (2026-11-25: ui/chart/mapUx.js, ui/chart/liveChart.js `whereTo`, `closeCard`)

The map's top bar is the way to pick a destination, with no new element or words. Owner, 2026-11-25: "the bar only keeps these two ...
a sailor should always be able to find the birthplace to explore, and anchorages to rest"; "on the map you can show other stuff when zoomed
in; no need to remove them".

**Always visible:** birthplaces and anchorages draw at every zoom, the overview and the home card's chart too (`KINDS.anchorage` is zoom
class A like the pin: the glyph and its tap never drop; the anchorage's name stays class B and drops when the view is wide or crowded).
Every other point (named places, hunts' corners, buoys, channel, barges, Tessie's water) is unchanged: it appears as you zoom in.

**The bar is exactly Birthplaces · Anchorages** (Regatta adds Races; no All, no Marks, no Wildlife, no Your wake chip). A tap on a chip shows
that kind alone (it lights) AND opens the EXISTING card of the nearest point, **Sail here** first (`nearestOf`: nearest to the boat; on the
start screen the current start; else the map's centre; the point she is at and a pin past the paper are left out; a point out of view is
glided to). One more tap on Sail here sails there. A second tap on the same chip is the next nearest (wraps). **The normal view returns when
the card closes** (Esc, a tap on the water, the card's own close, Sail here): `closeCard` calls `uxApi.cardClosed()`. At the start screen
and in Cruise the card keeps its own first action (Set as target / Anchor here), as Sail here is Sail's only; Races opens a race pin's own
card (Race here). The phone keeps its round Layers button; it opens the same two chips (two chips do not fit inline beside the zoom buttons
and the Coach's tooltip).

The wake is always drawn; Setup › Sail › Your wake › Forget still clears it.
Tests: `v2/tests/map-ux.test.mjs` (the bar by mode, only three kinds in a chip, no point removed, pin and glyph shown and hit at every zoom,
`nearestOf`), `v2/tests/pages/mapUx.page.mjs` (the chips, the overview, the card, the cycle, the close by Esc and by the water, the wake,
the phone), `mapCard.page.mjs` (the Regatta bar; the view returns after the card).

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
