// The phone card's rotating line while the shaders build (owner, 2026-11-17: "while loading show more info on the phone to hold the
// user"; ui/buildCard.js): true facts about Emerald Bay and Lake Tahoe, each with its public source, and short tips for the
// phone's own controls (the steer and sheet rings, the NAV and Tack quarters, "⋯" and the Pro panel's Reef row).
// Each line 60 characters or fewer, English only, no internal names (v2/tests/build-card.test.mjs).
import { PILOT_LABEL } from './pilotLabel.js';   // the autopilot button's name (NAV)
export const LINE_MAX = 60;

export const FACTS = Object.freeze([
  // UC Davis Tahoe Environmental Research Center, "Tahoe: State of the Lake Report" (lake facts: maximum depth 1,645 ft = 501 m),
  // https://tahoe.ucdavis.edu/stateofthelake ; USGS, "Lake Tahoe Data Clearinghouse", https://tahoe.usgs.gov/facts.html
  'Lake Tahoe is 501 m deep at its deepest point.',
  // California State Parks, Emerald Bay State Park: "Fannette Island, the only island in Lake Tahoe",
  // https://www.parks.ca.gov/?page_id=506
  'Fannette Island is the only island in Lake Tahoe.',
  // California State Parks, Vikingsholm: Lora J. Knight had a small stone tea house built on top of Fannette Island,
  // https://www.parks.ca.gov/?page_id=506 (Vikingsholm, the Tea House)
  'Lora Knight had a stone tea house built on Fannette Island.',
  // California State Parks, Vikingsholm: the Scandinavian-style house at the head of Emerald Bay was built in 1929,
  // https://www.parks.ca.gov/?page_id=506 (Vikingsholm, the Tea House)
  'Vikingsholm, at the head of the bay, was finished in 1929.',
  // California State Parks, Emerald Bay State Park: the bay was carved by glaciers (a moraine nearly closes its mouth),
  // https://www.parks.ca.gov/?page_id=506
  'Glaciers helped carve Emerald Bay.',
  // UC Davis TERC, "Tahoe: State of the Lake Report", clarity: the Secchi disk's annual mean was 102.4 ft (31.2 m) in 1968,
  // https://tahoe.ucdavis.edu/stateofthelake
  'In 1968 a white disc could be seen 31 m down in Tahoe.',
  // USGS, Lake Tahoe facts: surface elevation about 6,225 ft (1,897 m), https://tahoe.usgs.gov/facts.html
  'Lake Tahoe\'s surface sits 1,897 m above the sea.',
  // UC Davis TERC, Tahoe facts: enough water to cover a flat area the size of California 14 in (36 cm) deep,
  // https://tahoe.ucdavis.edu/stateofthelake
  'Tahoe holds enough water to cover California 36 cm deep.',
]);

// the phone's controls (v2/ui/flat.js; "Phones use flat glass controls")
export const TIPS = Object.freeze([
  'Drag the left ring to steer. Its needle is the rudder.',
  'Drag the right ring to trim the main. Aim for the band.',
  `Tap ${PILOT_LABEL}, bottom left, and she holds her heading.`,
  'Tap Tack, bottom right, to turn through the wind.',
  'Sails shaking? Drag the sheet ring up to sheet in.',
  'Strong wind? Tap ⋯, then Pro, and set Reef to 1 or 2.',
  'Reef A lets the boat reef herself as the wind builds.',
  'Drag the open water to look round. Pinch to zoom.',
]);

// the lines in turn: a fact, then a tip
export const LINES = Object.freeze(FACTS.flatMap((f, i) => [f, TIPS[i % TIPS.length]]));
