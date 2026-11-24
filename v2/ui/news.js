// v2's What's new (Velia v2 at the root; v1 at /classic/ keeps src/ui/news.js, frozen): v2's releases, newest first, on
// top of v1's list, so the page reads the whole story. To add an entry, put one line at the TOP of NEWS_V2 (the same shape
// and voice as src/ui/news.js: text, see, and touchText / touchSee when it names a key). The v2 card's foot line at first paint:
// after a new date, run `python3 -I tools/loading_shell.py` (it reads NEWS_V2's dates for v2/index.html).
import { NEWS as NEWS_V1, newsMeta } from '../../src/ui/news.js';

export const NEWS_V2 = [
  { date: '2026-11-19', text: 'The map is the menu now: a live map of the lake, with a pin for each place to start.', see: 'Open Velia, tap a pin, then Sail from here. Or tap Surprise me.' },
  { date: '2026-11-19', text: 'Tap the water on the map to set a target, or add waypoints and sail the route.', see: 'Open the chart while you sail and click the water.', touchText: 'Tap the water on the map to set a target, or add waypoints and sail the route.', touchSee: 'Open the chart while you sail and tap the water.' },
  { date: '2026-11-19', text: 'The map has layers and shows your wake, every water you have sailed. A crosshair follows the mouse and reads bearing and distance.', see: 'Open the chart and look along its top edge.', touchText: 'The map has layers and shows your wake, every water you have sailed.', touchSee: 'Open the chart and tap Layers.' },
  { date: '2026-11-19', text: 'A Sail and Cruise switch sits on the top bar: same boat, same course, same clock.', see: 'Tap the switch on the top bar while you sail.' },
  { date: '2026-11-19', text: 'A new panel: set the waters, boat, start, time of day, weather and wind, then Set sail. Resume takes you back.', see: 'Open the menu.' },
  { date: '2026-11-19', text: 'Real tutorials: twelve short chapters for a newcomer, each with a Try it line.', see: 'Open Tutorial from the menu.' },
  { date: '2026-11-19', text: 'The lake is busy: sailboats cruise around each place you can start.', see: 'Start from a pin and look around.', touchText: 'A sailboat cruises near the place you start.', touchSee: 'Start from a pin and look around.' },
  { date: '2026-11-19', text: 'Kayakers paddle along the shores near each place you start. On a computer or tablet.', see: 'Start from a pin and look along the shore.', touchText: 'Kayakers paddle along the shores.', touchSee: 'Look along the shore while you sail.' },
  { date: '2026-11-19', text: 'Velia Travel, the glass-bottom tour boat, runs in from the open lake through the narrows, with clear LED kayaks. On a computer or tablet.', see: 'Start from any pin and look around in daylight.' },
  { date: '2026-11-19', text: 'Mossy granite boulders lie packed in the shallows, and close up they are real 3D stones. On a computer or a strong tablet.', see: 'Sail slowly over the rocky shallows.' },
  { date: '2026-11-19', text: 'In clear shallow water you see the keel and the rudder as a dark shape under the hull.', see: 'Sail over clear shallows and look down beside the hull.' },
  { date: '2026-11-19', text: 'New mainsail graphics: the rose, the Velia mark and sail numbers. In Regatta, rivals carry their own sails.', see: 'Look at the mainsail, or race in Regatta.' },
  { date: '2026-11-19', text: 'The night looks real: only the boat\'s lamps glow, and the kayaks carry lights.', see: 'Pick a night hour in Time of day.' },
  { date: '2026-11-19', text: 'The storm and the fireworks show are redone, with real fireworks barges. On a computer or tablet.', see: 'Pick Storm in Weather, or Fireworks in Time of day.' },
  { date: '2026-11-19', text: 'Tessie has new moves: she rolls alongside, swims under the keel, breaches at sunset and glows at night. On a computer.', see: 'Sail near her water and wait.' },
  { date: '2026-11-19', text: 'The first sail of a visit opens as a film, with letterbox bars. On a computer or tablet.', see: 'Choose Sail on a fresh visit.' },
  { date: '2026-11-19', text: 'Tablets get the full lake, scaled to the tablet. Phones load faster, with a clear sky and no clouds.', see: 'Open Velia on a tablet or a phone.' },
  { date: '2026-11-15', text: 'A beacon of light marks where you are heading: pick a spot and a cream pillar of light stands there.', see: 'Open the chart and pick a spot, or double-click the water.', touchSee: 'Open the chart and pick a spot, or double-tap the water.' },
  { date: '2026-11-15', text: 'Regatta laylines glow: the line to tack on lights amber.', see: 'Race in Regatta and watch the lines to the mark.' },
  { date: '2026-11-15', text: 'The trees along the shore sway in the wind.', see: 'Sail close to the shore in wind 3 or 4.' },
  { date: '2026-11-15', text: 'Cruise opens behind the boat. The wide cinematic view comes last.', see: 'Choose Cruise on the first card.' },
  { date: '2026-11-15', text: 'Waves on the hull sound like real water: a recording, not a synth.', see: 'Turn the sound on and sail in wind 3 or 4.' },
  { date: '2026-11-15', text: 'A cleaner top bar: one Conditions button shows the time and the wind, and opens the weather, time and sound.', see: 'Look at the top bar while you sail.' },
];
export const NEWS = [...NEWS_V2, ...NEWS_V1];
export const V2_NEWS = newsMeta(NEWS);   // { list, version, versionLine, newest, cardLine }: createHome({ news: V2_NEWS })
