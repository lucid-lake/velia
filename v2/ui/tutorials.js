// Help › Tutorials on v2 (owner, 2026-11-18: "Rewrite the tutorial. It needs to be a true tutorial … the NAV button is very
// important, the cockpit is very important, the story about Tessie, capsizing. Put yourself in a newcomer's shoes."). Twelve short
// chapters a newcomer reads in a few minutes and comes back to: a title, 3 to 6 short lines, a "Try it" line with the exact key or
// tap, and where it helps a small drawing or a labelled picture of our own cockpit. v1 (/classic/) keeps its own list
// (src/ui/homePages.js TUTORIALS): this page replaces only v2's body of the shared Tutorials section.
//   CHAPTERS                       the chapters: { id, title, lines, try, fig?, figFirst? }; a line is a string or { k, t, f } (below)
//   tutorialsHtml()                the page's body: the chapter list and the chapter view (every chapter, one shown)
//   capsIn(html)                   [{ row, k }] for every key cap the markup names (the tests check each against keyMap.js)
//   const T = mountTutorials(root) on the card (front.js): T.show(i), T.current, T.dispose()
// Words by the hand and the controls (§ 7.5): a line { k, t, f } carries the keyboard's words (k), a finger's on
// the 3D cockpit (t: an iPad) and the phone's flat controls (f; t when absent). All three are in the markup; CSS shows one by
// <html data-hand> (src/ui/hand.js) and data-f-flat-controls (src/core/features.js). Every key cap is drawn from v2/ui/keyMap.js's
// rows by id ({key:steer}, {key:sheets:S}), so a cap that is not in the key map cannot be written: tutorialsHtml throws.
import { KEY_ROWS } from './keyMap.js';
import { PILOT_LABEL } from './pilotLabel.js';
import { feature } from '../../src/core/features.js';

const COCKPIT_L = new URL('../assets/tutorials/cockpit-left.webp', import.meta.url).href;   // our own capture (1280 × 720 at 2×), the cockpit's band: its left half
const COCKPIT_R = new URL('../assets/tutorials/cockpit-right.webp', import.meta.url).href;   // and its right half
const PHONE_IMG = new URL('../assets/tutorials/controls-phone.webp', import.meta.url).href;   // our own capture, a phone at 844 × 390

const ROWS = new Map(KEY_ROWS.map((r) => [r.id, r]));
// {key:id} draws every cap of that key-map row; {key:id:A} or {key:id:A,D} only those (each must be one of the row's caps)
function caps(id, pick) {
  const r = ROWS.get(id);
  if (!r) throw new Error(`tutorials: no key-map row "${id}"`);
  const ks = pick ? pick.split(',') : r.k;
  for (const k of ks) if (!r.k.includes(k)) throw new Error(`tutorials: "${k}" is not a cap of key-map row "${id}" (${r.k.join(' ')})`);
  return ks.map((k) => `<kbd class="kc" data-row="${id}" data-k="${k}">${k}</kbd>`).join(' ');
}
const fill = (s) => s.replace(/\{key:([a-z-]+)(?::([^}]+))?\}([.,:;)]?)/g, (_, id, pick, p) => (p ? `<span class="tu-nw">${caps(id, pick)}${p}</span>` : caps(id, pick))).replace(/\{nav\}/g, PILOT_LABEL);
// a line by the hand: the keyboard's words, a finger's on the cockpit, the phone's flat controls'
const line = (l) => (typeof l === 'string' ? fill(l)
  : `<span class="hk-k">${fill(l.k)}</span><span class="hk-t tw-t">${fill(l.t)}</span><span class="tw-f">${fill(l.f ?? l.t)}</span>`);

// ---- the drawings: cream ink on the sheet's navy, a chart's hand (currentColor) ----
// the points of sail: the wind from the top, the boat in the middle, the no-go wedge, close-hauled, beam reach, broad reach, run
const POINTS_SVG = `<svg class="tu-svg" viewBox="0 0 300 190" role="img" aria-label="Points of sail: the wind from ahead is the no-go zone; about 45 degrees off is close-hauled; the wind on the side is a beam reach; behind the side a broad reach; from behind a run">
<defs><pattern id="tu-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5" stroke="currentColor" stroke-width="1" opacity=".45"/></pattern></defs>
<path d="M150 18v30" stroke="currentColor" stroke-width="2" fill="none"/><path d="M144 40l6 10 6-10" fill="currentColor"/><text x="150" y="13" class="tl" text-anchor="middle">wind</text>
<path d="M150 104L118 60A55 55 0 0 1 182 60Z" fill="url(#tu-hatch)" stroke="currentColor" stroke-width=".8" opacity=".9"/><text x="150" y="76" class="ts" text-anchor="middle">no-go</text>
<g stroke="currentColor" stroke-width=".8" stroke-dasharray="3 3" fill="none" opacity=".7"><path d="M150 104L92 46"/><path d="M150 104L208 46"/><path d="M150 104H62"/><path d="M150 104H238"/><path d="M150 104L92 162"/><path d="M150 104L208 162"/><path d="M150 104V178"/></g>
<path d="M150 92c5 6 6 14 5 24h-10c-1-10 0-18 5-24Z" fill="currentColor"/>
<text x="86" y="40" class="ts" text-anchor="end">close-hauled</text><text x="214" y="40" class="ts">close-hauled</text>
<text x="56" y="100" class="ts" text-anchor="end">beam</text><text x="56" y="114" class="ts" text-anchor="end">reach</text><text x="244" y="100" class="ts">beam</text><text x="244" y="114" class="ts">reach</text>
<text x="86" y="176" class="ts" text-anchor="end">broad reach</text><text x="214" y="176" class="ts">broad reach</text><text x="150" y="189" class="ts" text-anchor="middle">run</text></svg>`;
// NAV beats to an upwind mark: the zig-zag, the tacks at the laylines
const BEAT_SVG = `<svg class="tu-svg" viewBox="0 0 300 170" role="img" aria-label="NAV beats to an upwind mark: it sails close-hauled on one side, tacks, and reaches the mark in a zig-zag">
<path d="M40 16v26" stroke="currentColor" stroke-width="2" fill="none"/><path d="M34 34l6 10 6-10" fill="currentColor"/><text x="40" y="12" class="ts" text-anchor="middle">wind</text>
<g stroke="currentColor" stroke-width=".8" stroke-dasharray="3 3" fill="none" opacity=".6"><path d="M160 24L80 104"/><path d="M160 24L240 104"/></g>
<circle cx="160" cy="24" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="160" cy="24" r="1.6" fill="currentColor"/><text x="172" y="20" class="ts">your mark</text>
<path d="M150 158L104 112L190 54L160 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
<g fill="currentColor"><circle cx="104" cy="112" r="3"/><circle cx="190" cy="54" r="3"/></g>
<text x="96" y="116" class="ts" text-anchor="end">tack</text><text x="198" y="58" class="ts">tack at the layline</text>
<path d="M150 150c4 5 5 11 4 18h-8c-1-7 0-13 4-18Z" fill="currentColor"/><text x="162" y="166" class="ts">you</text></svg>`;

// the cockpit's two halves and the phone's screen: each picture's numbered points [x, y] as fractions of it, then the legend's line;
// the numbers run on across the halves
export const COCKPIT_PARTS = [
  { src: COCKPIT_L, w: 1000, h: 237, alt: 'The cockpit, left half: the Chart, the jib winch, the wheel with the round key and NAV', pins: [
    [0.165, 0.30, 'Chart: heading, depth, the nearest place; opens the chart'],
    [0.539, 0.25, 'JIB winch: drag round it to trim the front sail'],
    [0.845, 0.84, 'Round key: TACK, GYBE, FREE or REFLOAT'],
    [0.978, 0.70, `${PILOT_LABEL}: the autopilot`],
  ] },
  { src: COCKPIT_R, w: 1000, h: 295, alt: 'The cockpit, right half: the throttle, the switches, the main winch, the Coach and a hide tab', pins: [
    [0.116, 0.19, 'Throttle lever: the engine, ahead or astern'],
    [0.284, 0.40, 'SAILS: up or down'],
    [0.367, 0.40, 'ANCHOR: down or up'],
    [0.464, 0.40, 'REEF: A · 0 · 1 · 2'],
    [0.324, 0.25, 'MAIN winch: trims the mainsail'],
    [0.655, 0.32, 'Coach: your boat, the wind and what to do; opens the logbook'],
    [0.909, 0.90, 'Hide tab (one in each corner): fold the cockpit away'],
  ] },
];
export const PHONE_PARTS = [
  { src: PHONE_IMG, w: 1012, h: 468, alt: 'A phone in Sail: the flat controls at the edges of the screen', pins: [
    [0.074, 0.25, 'Chart. Tap: the big chart'],
    [0.118, 0.77, 'Steer ring: drag to steer'],
    [0.055, 0.90, `${PILOT_LABEL}: the autopilot`],
    [0.883, 0.77, 'Sheet ring: drag In or Ease to trim'],
    [0.946, 0.90, 'Tack, Gybe, Free or Refloat'],
    [0.955, 0.43, '⋯: sails, engine, anchor, Pro (the reef)'],
    [0.927, 0.25, 'Coach. Tap: raise it'],
  ] },
];
function pinFig(cls, parts) {
  let n = 0;
  const pics = parts.map((p) => `<div class="tu-pw"><img data-src="${p.src}" width="${p.w}" height="${p.h}" alt="${p.alt}" decoding="async">${p.pins.map(([x, y]) =>
    `<span class="tu-pin" style="left:${(x * 100).toFixed(1)}%;top:${(y * 100).toFixed(1)}%" aria-hidden="true">${++n}</span>`).join('')}</div>`).join('');
  return `<figure class="tu-pic ${cls}">${pics}<ol class="tu-leg">${parts.flatMap((p) => p.pins).map(([, , t]) => `<li>${t}</li>`).join('')}</ol></figure>`;
}
const COCKPIT_FIG = pinFig('tu-fig-d', COCKPIT_PARTS) + pinFig('tu-fig-f', PHONE_PARTS);
const TESSIE_IMG = new URL('../assets/tutorials/tessie.webp', import.meta.url).href;   // our own capture: Tessie up off the bow, 15:09, the first sighting
const TESSIE_FIG = `<figure class="tu-pic tu-tpic"><div class="tu-pw"><img data-src="${TESSIE_IMG}" width="1000" height="335" alt="Tessie’s neck and two humps break the water off the boat’s bow" decoding="async"></div></figure><figure class="tu-tessie"><span class="tu-tmark" aria-hidden="true"></span><figcaption>Her mark on the chart: Tessie’s water</figcaption></figure>`;

// ---- the chapters (every key and behaviour checked against the code on main, 2026-11-18) ----
export const CHAPTERS = [
  { id: 'first', title: 'Your first minute', lines: [
    'Velia is a real sailboat on a real lake: Emerald Bay, on Lake Tahoe. The wind, the water and the light are live.',
    'Three ways to play. <b>Sail</b>: you steer. <b>Cruise</b>: she sails herself, with music. <b>Regatta</b>: race other boats.',
    { k: 'On the first screen, pick Sail, Cruise or Regatta, then <b>Set sail</b>. In play the same button reads <b>Resume</b>.', t: 'On the first screen, tap Sail, Cruise or Regatta, then <b>Set sail</b>. In play the same button reads <b>Resume</b>.', f: 'On the first screen, tap Sail, Cruise or Regatta to start.' },
    { k: 'Switch between Sail and Cruise any time: click <b>Cruise ⇄</b> on the top bar. In Cruise the button reads Sail and takes the helm back.', t: 'Switch between Sail and Cruise any time: tap <b>Cruise ⇄</b> on the top bar. In Cruise the button reads Sail and gives you the helm back.' },
    { k: 'The menu and the chart are one screen: press {key:menu} or {key:chart}, or click Menu on the top bar.', t: 'The menu and the chart are one screen: tap Menu on the top bar.' },
    { k: 'Forgot a key? The main ones stand on the right edge of the screen while you sail; every key is under <b>Menu › Keys</b>.', t: 'Every touch is listed under Controls, in this sheet.' },
  ], try: { k: 'Click Cruise ⇄ on the top bar and watch her sail herself. Click Sail there to take the helm back.', t: 'Tap Cruise ⇄ on the top bar and watch her sail herself. Tap Sail there to take the helm back.' } },

  { id: 'cockpit', title: 'The cockpit', fig: COCKPIT_FIG, figFirst: true, lines: [
    { k: 'The cockpit along the bottom of the screen is your control panel. Click its controls, or use their keys.', t: 'The cockpit along the bottom of the screen is your control panel. Tap its controls.', f: 'On a phone the controls are flat glass at the edges of the screen. Drag the rings, tap the corners.' },
    'The Coach shows your boat from above. Its arrow points from where the wind comes, as she feels it; the shaded wedge is the no-go zone. When something needs doing, it says so on the boat: pull in, ease out, bear away.',
    'The Chart is your compass and map: the heading on top, a line to the nearest place, amber on the ring where the shore is close.',
    { k: 'The round key and {nav} sit on the wheel’s hub. Chapters 4 and 5 put them to work.', t: 'The round key and {nav} sit on the wheel’s hub. Chapters 4 and 5 put them to work.', f: '{nav} and the turn key sit in the bottom corners. Chapters 4 and 5 put them to work.' },
    { k: 'Fold the cockpit away for the view: a hide tab, or {key:fold}. Again brings it back.', t: 'Fold the cockpit away for the view: tap a hide tab. Tap it again to bring it back.', f: 'Drag the open water to look round. The view comes back behind her by itself.' },
  ], try: { k: 'Click the Chart: the chart opens. Click Resume to close it.', t: 'Tap the Chart: the chart opens. Tap Resume to close it.', f: 'Tap ⋯ and look at the Boat rows. Tap ⋯ again to close.' } },

  { id: 'wind', title: 'Steering and the wind', fig: POINTS_SVG, lines: [
    { k: 'Steer with {key:steer} (or the arrow keys).', t: 'Steer: drag the wheel.', f: 'Steer: drag the left ring. Clockwise turns right (to starboard).' },
    { k: 'Trim with {key:sheets}: pull the sails in (sheet in) or let them out (ease).', t: 'Trim: drag a winch to pull the sails in (sheet in) or let them out (ease).', f: 'Trim: drag the right ring to In (sheet in) or Ease.' },
    'Sails shaking at their front edge (luffing)? Pull them in, or turn away from the wind (bear away).',
    'Wind from ahead and to the side: sails in tight (close-hauled). Wind on the side: sails half out (a beam reach). Wind from behind: sails right out (a run).',
    { k: 'Point straight into the wind and she stops (in irons). The round key reads FREE: press {key:tack} and the crew backs her out.', t: 'Point straight into the wind and she stops (in irons). The round key reads FREE: tap it and the crew backs her out.', f: 'Point straight into the wind and she stops (in irons). Tap Free, bottom right, and the crew backs her out.' },
    'New to it? The crew trims the mainsail for you (Setup › Sail › crew trims).',
  ], try: { k: 'Turn toward the wind with {key:steer} until the sails shake, then turn back until they fill.', t: 'Turn toward the wind until the sails shake, then turn back until they fill.' } },

  { id: 'nav', title: `${PILOT_LABEL}, your autopilot`, fig: BEAT_SVG, lines: [
    { k: '<b>{nav}</b> steers for you. It is the crescent beside the round key on the wheel. It has no key: click it.', t: '<b>{nav}</b> steers for you. It is the crescent beside the round key on the wheel: tap it.', f: '<b>{nav}</b> steers for you. It is the bottom-left corner: tap it.' },
    'With no mark set, {nav} holds the course she is on.',
    { k: 'To sail to a mark, two steps. <b>1.</b> Set the mark: double-click open water (or open the chart, {key:chart}, click water or a place, then <b>Set as target</b>). <b>2.</b> Click {nav}. A mark does not start {nav} by itself: the line says “Mark set. Click {nav} to sail there.” and {nav} glows once.', t: 'To sail to a mark, two steps. <b>1.</b> Set the mark: double-tap open water (or open the chart with Menu, tap water or a place, then <b>Set as target</b>). <b>2.</b> Tap {nav}. A mark does not start {nav} by itself: the line says “Mark set. Tap {nav} to sail there.” and {nav} glows once.' },
    'A beam of light stands over your mark. If it is upwind, {nav} zig-zags like a sailor (beating) and tacks at the layline. At the mark the light lifts away and she holds her heading.',
    { k: 'A longer trip: click the water, <b>Add waypoint</b>, again for each stop, then <b>Set course</b>. {nav} sails the route leg by leg. <b>Clear route</b> drops it.', t: 'A longer trip: tap the water, <b>Add waypoint</b>, again for each stop, then <b>Set course</b>. {nav} sails the route leg by leg. <b>Clear route</b> drops it.' },
    { k: 'Steer ({key:steer}) and the helm is yours again. Click {nav} again to let go.', t: 'Steer and the helm is yours again. Tap {nav} again to let go.' },
  ], try: { k: 'Press {key:chart}, click open water ahead, then Set as target. Close the chart ({key:menu}), then click {nav}.', t: 'Tap Menu, tap open water ahead, then Set as target. Tap Resume, then tap {nav}.', f: 'Tap Menu, tap open water ahead, then Set as target. Tap × to close, then tap {nav}.' } },

  { id: 'tack', title: 'Tacking and gybing', lines: [
    { k: 'To turn through the wind, press {key:tack}. The round key on the wheel says what it will do.', t: 'To turn through the wind, tap the round key on the wheel. Its word says what it will do.', f: 'To turn through the wind, tap the bottom-right corner. Its word says what it will do.' },
    '<b>Tack</b>: the bow turns through the wind. The sails swing across and fill on the other side.',
    '<b>Gybe</b>: the stern turns through the wind, when the wind is behind you. The boom swings across.',
    { k: 'The crew works the ropes. The key glows amber while the turn runs; press {key:tack} again to cancel.', t: 'The crew works the ropes. The key glows amber while the turn runs; tap it again to cancel.' },
    '<b>Free</b> gets her out of irons. <b>Refloat</b> gets her off the bottom when she runs aground.',
  ], try: { k: 'Sail with the wind ahead and to the side, then press {key:tack}.', t: 'Sail with the wind ahead and to the side, then tap Tack.' } },

  { id: 'gusts', title: 'Gusts, reefing and capsizing', lines: [
    'A gust is a dark, matte patch moving across the water. It hits harder than the breeze round it.',
    'Too much wind and she leans over hard (heels). The skipper says “Overpowered — ease the sails or reef”, and REEF glows amber.',
    { k: 'Ease the sails ({key:sheets:S}), or reef: a smaller mainsail. Click REEF: A (the boat picks) · 0 (full sail) · 1 · 2.', t: 'Ease the sails (drag a winch out), or reef: a smaller mainsail. Tap REEF: A (the boat picks) · 0 (full sail) · 1 · 2.', f: 'Ease the sails (the right ring to Ease), or reef: a smaller mainsail. Tap ⋯, Pro, then Reef: A (the boat picks) · 0 · 1 · 2.' },
    'On a reach, ease in a gust. Don’t turn into the wind.',
    'Lean past 55° for half a second and she is knocked down: the sails go in the water. Her logbook card opens. <b>Start again</b> puts you back where this sail began; <b>Menu</b> opens the menu.',
    'Cruise never knocks down. In a race a knockdown is a DNF (did not finish).',
  ], try: { k: 'Click the clock on the top bar and pick the strongest wind. Sail across it with the sails in, then ease at the warning.', t: 'Tap the clock on the top bar and pick the strongest wind. Sail across it with the sails in, then ease at the warning.' } },

  { id: 'anchor', title: 'Anchoring and moorings', lines: [
    { k: 'Press {key:anchor} to drop the anchor. Press {key:anchor} again to bring it up (weigh anchor).', t: 'Tap ANCHOR to drop the anchor. Tap it again to bring it up (weigh anchor).', f: 'Tap ⋯, then Anchor: Down. Anchor: Up brings it back (weigh anchor).' },
    'It holds in 3 to 20 m of water. Still moving? The crew drops the sails and rounds her up first. Too deep, and the skipper names the nearest anchorage.',
    'Anchorages are small anchors on the chart. Within 120 m of one, the anchor control glows a faint amber: your cue.',
    'As the anchor goes down, the view turns to the bow to watch it go.',
    { k: 'Mooring balls: the Boat Camp on the bay’s north shore has 22 white balls with a blue band. Bow to a ball, slowly, then press {key:anchor} or click <b>MOOR</b>. {key:anchor} again lets it go.', t: 'Mooring balls: the Boat Camp on the bay’s north shore has 22 white balls with a blue band. Bow to a ball, slowly, then tap ANCHOR. Tap it again to let go.', f: 'Mooring balls: the Boat Camp on the bay’s north shore has 22 white balls with a blue band. Bow to a ball, slowly, then Anchor: Down. Anchor: Up lets go.' },
    'A ball catches within 6 m of the bow, under 1.6 kn.',
  ], try: { k: 'Press {key:chart}, click Anchorage off Vikingsholm, then Anchor here: {nav} sails her there. When she arrives, press {key:anchor}.', t: 'Tap Menu, tap Anchorage off Vikingsholm, then Anchor here: {nav} sails her there. When she arrives, drop the anchor.' } },

  { id: 'start', title: 'Where to start', lines: [
    'Every sail starts at a named place, a pin on the map: Off Fannette, Vikingsholm, The narrows and Open lake.',
    'Your first sail starts Off Fannette, the tea house 200 m off the bow, over the deep water Tessie calls home (the pin carries her name).',
    { k: 'On the first screen, click a pin, then <b>Sail from here</b>: she starts there.', t: 'On the first screen, tap a pin, then <b>Sail from here</b>: she starts there.' },
    { k: 'While you sail, open the menu ({key:menu}), click a pin, then Sail from here. A short fade, and she is there.', t: 'While you sail, tap Menu, tap a pin, then Sail from here. A short fade, and she is there.' },
    'She always starts with the wind on her side (a reach), never stuck head to wind. Velia remembers your pick.',
    'Not during a race, and not while she is knocked down.',
  ], try: { k: 'Press {key:menu}, click The narrows, then Sail from here.', t: 'Tap Menu, tap The narrows, then Sail from here.' } },

  { id: 'time', title: 'Time and weather', lines: [
    'The clock on the top bar opens Conditions: the time of day, the weather and the wind.',
    'Time of day: Dawn 05:36 · Midday 13:00 · Golden 19:15 · Night 22:30. The screen fades for a moment and the hour changes. Time only moves forward.',
    { k: 'Weather: Clear, Fair or Storm. A storm brings rain, lightning and thunder, then a rainbow as it clears. Wind: four levels, on the same sheet.', t: 'Weather: Clear, Fair or Storm. A storm brings rain, lightning and thunder, then a rainbow as it clears. Wind: four levels.', f: 'Weather: Clear or Fair (a phone has no storm and no clouds). Wind: four levels, light to strong.' },
    { k: 'A clear night shows the stars and the Milky Way.', t: 'A clear night shows the stars and the Milky Way.', f: 'A clear night shows the stars and the moon.' },
    { k: 'Fireworks: the July 4th show at 21:44, 1 km outside the mouth of Emerald Bay. <b>Fireworks</b> on the time strip jumps to just before it and turns her to face it.', t: 'Fireworks: the July 4th show at 21:44, 1 km outside the mouth of Emerald Bay. <b>Fireworks</b> on the time strip jumps to just before it and turns her to face it.', f: 'The July 4th fireworks show on a computer or a tablet.' },
  ], try: { k: 'Click the clock on the top bar, then Golden.', t: 'Tap the clock on the top bar, then Golden.' } },

  { id: 'tessie', title: 'The lake’s legend: Tessie', fig: TESSIE_FIG, figFirst: true, lines: [
    'For years people at Lake Tahoe have told of something big in its deep, cold water. Nobody has proved it. Locals call her Tessie.',
    'In Velia she lives in Tessie’s water: the deep water between Fannette Island and the bay’s north wall, about 60 m down.',
    'She is shy. She comes up when she likes, most often near her water. Sunset (19:00 to 20:45) and storms bring her rarest moments.',
    'Come within about 22 m and she dives. Give her room and she may swim beside you.',
    '<b>Never charge her.</b> Head straight at her, fast, inside 40 m, and she dives… then comes after you. Keep 25 m away for 30 s, or leave her water. If she catches you, she rolls you over: “Tessie said no.”',
    'On a computer or a tablet you can <b>be her</b>: pick Tessie in the Boat row, or answer the skipper’s “Tessie’s up.” when she shows herself. Look where she should go: look down and she dives, look up and she rises, run upward at the surface and she leaps. Her controls show on the screen while you are her. Not on a phone.',
  ], try: { k: 'Press {key:menu}, click Off Fannette, Sail from here. Sail slowly and watch the water off the bow.', t: 'On a computer: Menu, Off Fannette, Sail from here. Then sail slowly and watch the water off the bow.' } },

  { id: 'race', title: 'Racing', lines: [
    { k: 'Pick <b>Regatta</b> on the menu (on the first screen, then <b>Set sail</b>). Choose a race, or <b>Race now</b>.', t: 'Pick <b>Regatta</b> on the menu (on the first screen, then <b>Set sail</b>). Choose a race, or <b>Race now</b>.', f: 'Tap <b>Regatta</b> on the menu. Choose a race, or <b>Race now</b>.' },
    'Most races start flying: the fleet sails at the line and a short countdown runs. Cross after the gun. Over early? Turn back below the line and cross again.',
    'Round each mark in order, keeping it on your left (to port). The marks are numbered 1, 2 … and F, the finish.',
    'Right of way: wind over your right side (starboard tack) beats wind over your left (port). The boat upwind keeps clear. Touch the wrong way and you owe a turn (Club and Pro).',
    'Your rivals: Osprey 17, Tern 4, Kestrel 9, Heron 21 and Plover 12, each with her sail number on her sail and her own hull colour.',
    'At the finish a card shows your place and time: <b>Race again</b> or <b>Home</b>.',
  ], try: { k: 'Press {key:menu}, click Regatta, then Race now.', t: 'Tap Menu, tap Regatta, then Race now.' } },

  { id: 'keys', title: 'Every key', lines: [
    { k: 'Every key and every mouse move, in one list: <b>Keys</b>, in this sheet.', t: 'Every touch, in one list: <b>Controls</b>, in this sheet.' },
    { k: 'The ones you use most stand on the right edge of the screen while you sail.', t: 'Long-press a button to see its name.' },
  ], try: { k: 'Open the Keys page below.', t: 'Open the Controls page below.' } },
];

// the end of the last chapter: the Setup rows that help, one line (no "show the welcome again": v2 asks no skill question, owner
// 2026-11-21; your sailing is Setup's own row)
const SETTINGS_LINE = '<p class="tu-set"><b>Settings that help</b> (Setup › Aids): your sailing, hints, sailor’s words, steady hands.</p>';
const KEYS_BTN = '<p class="tu-go"><button class="pbtn" type="button" data-go="keys"><span class="hk-k">Keys ›</span><span class="hk-t">Controls ›</span></button></p>';

const chapterHtml = (c, i, n) => `<article class="tu-c" data-ch="${i}" aria-labelledby="tu-h-${c.id}"${i ? ' hidden' : ''}>
<h3 class="tu-h" id="tu-h-${c.id}"><span class="tu-n">${i + 1}</span>${c.title}</h3>
${c.figFirst ? c.fig : ''}<ul class="tu-ls">${c.lines.map((l) => `<li>${line(l)}</li>`).join('')}</ul>${c.figFirst ? '' : c.fig ?? ''}
<p class="tu-try"><b>Try it</b>${line(c.try)}</p>${c.id === 'keys' ? KEYS_BTN + SETTINGS_LINE : ''}
<p class="tu-pn">${i ? `<button class="tu-prev" type="button" data-to="${i - 1}">‹ ${CHAPTERS[i - 1].title}</button>` : '<span></span>'}${i < n - 1 ? `<button class="tu-next" type="button" data-to="${i + 1}">${CHAPTERS[i + 1].title} ›</button>` : ''}</p></article>`;

export function tutorialsHtml(list = CHAPTERS) {
  return `<div class="tu"><ol class="tu-list" aria-label="Chapters">${list.map((c, i) =>
    `<li><button class="tu-li" type="button" data-to="${i}" aria-current="${i ? 'false' : 'true'}"><span class="tu-n">${i + 1}</span><span class="tu-lt">${c.title}</span></button></li>`).join('')}</ol>
<div class="tu-view" tabindex="-1">${list.map((c, i) => chapterHtml(c, i, list.length)).join('')}</div></div>`;
}

// every key cap a markup names: [{ row, k }]
export const capsIn = (html) => [...html.matchAll(/<kbd class="kc" data-row="([^"]+)" data-k="([^"]*)">/g)].map((m) => ({ row: m[1], k: m[2] }));

// The sheet: on a wide screen the card grows (the chapter list beside the chapter); the page body never scrolls, only the chapter
// view does. A narrow screen (a phone) shows the list as a strip of numbered 44 px chips over the chapter.
const TUTORIALS_CSS = `
/* the shell never scrolls: its loading still overflows it (2437 px wide), and a focused button low in a chapter (Tab, a click) scrolled
   the whole overflow: hidden card layer sideways by 80 px; clip keeps the look and is no scroll container */
#lk-load{overflow:clip}
#lk-load[data-pg=tutorials] .lk-card{width:min(calc(var(--cw) + var(--hnw) + var(--F) * 22),calc(100vw - 2 * clamp(24px,5vw,84px)))}
#lk-load .pg[data-page=tutorials].on > .pg-b{overflow:hidden;display:flex;flex-direction:column;padding-right:0}
#lk-load .tu{flex:1 1 auto;min-height:0;display:grid;grid-template-columns:minmax(11em,14em) minmax(0,1fr);column-gap:1.3em}
#lk-load .tu-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:.1em;min-height:0;overflow:hidden auto;scrollbar-width:none}
#lk-load .tu-li{display:flex;align-items:center;gap:.6em;width:100%;min-height:30px;padding:.12em .6em;border:1px solid transparent;border-radius:16px;font-size:max(.92em,15px);line-height:1.2;color:var(--ink2);transition:background-color .12s cubic-bezier(.2,0,0,1),color .12s}
#lk-load .tu-li:hover{background:rgb(var(--lk-cream) / .08);color:var(--navy)}
#lk-load .tu-li[aria-current=true]{background:rgb(var(--lk-cream) / .13);border-color:var(--navy);color:var(--navy)}
#lk-load .tu-n{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:1.55em;height:1.55em;border:1px solid rgb(var(--lk-cream) / .55);border-radius:50%;font-size:.8em;font-variant-numeric:tabular-nums;letter-spacing:0}
#lk-load .tu-view{min-height:0;overflow:hidden auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:rgb(var(--lk-cream) / .35) transparent;padding-right:.5em;outline:none}
#lk-load .tu-c[hidden]{display:none}
#lk-load .tu-h{all:unset;display:flex;align-items:center;gap:.55em;font-family:var(--lk-font);font-weight:var(--lk-medium,500);font-size:1.15em;letter-spacing:.04em;margin:0 0 .45em}
#lk-load .tu-h .tu-n{font-size:.72em}
#lk-load .tu-ls{margin:0 0 .6em;padding:0;list-style:none}
#lk-load .tu-ls li{position:relative;padding:0 0 0 1.1em;margin:0 0 .42em;font-size:max(.95em,15px);line-height:1.45}
#lk-load .tu-ls li::before{content:'';position:absolute;left:.15em;top:.68em;width:.45em;border-top:1px solid rgb(var(--lk-cream) / .6)}
#lk-load .tu b{font-weight:var(--lk-medium,500);color:var(--navy)}
#lk-load .tu .kc{padding:.02em .42em;margin:0 .05em;font-size:max(.8em,13px);line-height:1.2;vertical-align:.06em;font-family:inherit}
#lk-load .tu-nw{white-space:nowrap}
#lk-load .tu-try{margin:.7em 0 .5em;padding:.45em .75em .5em;border-left:2px solid var(--lk-lit);background:rgb(var(--lk-cream) / .06);font-size:max(.95em,15px);line-height:1.45}
#lk-load .tu-try > b{display:block;font-size:.78em;letter-spacing:.16em;text-transform:uppercase;color:var(--ink2);margin-bottom:.1em}
#lk-load .tu .tw-f{display:none}
:root[data-f-flat-controls=on] #lk-load .tu :is(.hk-k,.hk-t){display:none}
:root[data-f-flat-controls=on] #lk-load .tu .tw-f{display:inline}
#lk-load .tu-svg{display:block;width:100%;max-width:21em;height:auto;margin:.2em auto .4em;color:rgb(var(--lk-cream) / .92)}
#lk-load .tu-svg .ts{font:max(10px,.7em) var(--lk-font);fill:currentColor;letter-spacing:.04em}
#lk-load .tu-svg .tl{font:max(11px,.78em) var(--lk-font);fill:currentColor;letter-spacing:.14em;text-transform:uppercase}
#lk-load .tu-pic{margin:.3em 0 .5em}
#lk-load .tu-fig-f{display:none}
:root[data-f-flat-controls=on] #lk-load .tu-fig-d{display:none}
:root[data-f-flat-controls=on] #lk-load .tu-fig-f{display:block}
#lk-load .tu-pw + .tu-pw{margin-top:.4em}
#lk-load .tu-pw{position:relative;border-radius:6px;overflow:hidden;box-shadow:0 0 0 1px rgb(var(--lk-cream) / .4)}
#lk-load .tu-pw img{display:block;width:100%;height:auto;background:rgb(var(--lk-cream) / .08)}
#lk-load .tu-pin{position:absolute;transform:translate(-50%,-50%);display:inline-flex;align-items:center;justify-content:center;min-width:1.5em;height:1.5em;padding:0 .2em;box-sizing:border-box;border-radius:999px;background:rgb(var(--lk-brand-navy) / .9);box-shadow:0 0 0 1px rgb(var(--lk-cream) / .9);color:var(--navy);font-size:max(.72em,12px);font-variant-numeric:tabular-nums;line-height:1}
#lk-load .tu-leg{margin:.5em 0 0;padding:0 0 0 1.6em;columns:2;column-gap:1.4em;font-size:max(.86em,15px);line-height:1.35}
#lk-load .tu-leg li{break-inside:avoid;margin:0 0 .22em;padding-left:.15em}
#lk-load .tu-leg li::marker{font-variant-numeric:tabular-nums;color:var(--ink2)}
#lk-load .tu-tessie{display:flex;align-items:center;gap:.9em;margin:.2em 0 .6em}
#lk-load .tu-tmark{flex:none;width:6.5em}
#lk-load .tu-tmark svg{display:block;width:100%;height:auto}
#lk-load .tu-tessie figcaption{font-family:var(--lk-font);font-style:italic;font-size:max(.88em,15px);color:var(--ink2)}
#lk-load .tu-go{margin:.4em 0}
#lk-load .tu-set{margin:.7em 0 .3em;padding-top:.55em;border-top:1px solid rgb(var(--lk-cream) / .25);font-size:max(.9em,15px);line-height:1.5}
#lk-load .tu-set .pbtn{margin:.35em 0 0}
#lk-load .tu-pn{display:flex;justify-content:space-between;gap:1em;margin:.9em 0 .2em;padding-top:.5em;border-top:1px solid rgb(var(--lk-cream) / .18)}
#lk-load .tu-pn button{min-height:32px;display:inline-flex;align-items:center;padding:0 .7em;border-radius:16px;border:1px solid rgb(var(--lk-cream) / .4);font-size:max(.86em,15px);color:var(--ink2)}
#lk-load .tu-pn button:hover{background:rgb(var(--lk-cream) / .1);color:var(--navy)}
#lk-load .tu-next{margin-left:auto}
:where(:root[data-f-finger-targets=on]) #lk-load :is(.tu-li,.tu-pn button){min-height:44px}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);row-gap:.5em}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-list{flex-direction:row;flex-wrap:nowrap;gap:.25em;overflow:auto hidden}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-li{width:auto;min-width:44px;min-height:44px;justify-content:center;padding:0}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-li .tu-lt{display:none}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-li .tu-n{border:0;font-size:1em}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-leg{columns:2}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-pic .tu-pw{max-width:19em}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-list{scrollbar-width:none;scroll-padding:0 2em}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-list[data-more~=r]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 2.2em),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 2.2em),transparent)}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-list[data-more~=l]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 2.2em);mask-image:linear-gradient(90deg,transparent,#000 2.2em)}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-list[data-more~=l][data-more~=r]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 2.2em,#000 calc(100% - 2.2em),transparent);mask-image:linear-gradient(90deg,transparent,#000 2.2em,#000 calc(100% - 2.2em),transparent)}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-c:not([hidden]){display:flex;flex-direction:column}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-c > .tu-h{order:-2}
:where(:root[data-screen~=compact],:root[data-screen~=narrow],:root[data-screen~=upright]) #lk-load .tu-c > .tu-try{order:-1;margin:0 0 .6em}
`;

export function mountTutorials(root, { doc = globalThis.document } = {}) {
  const pg = root?.querySelector?.('.pg[data-page=tutorials]');
  const body = pg?.querySelector('.pg-b');
  if (!body) return null;
  try { feature('flatControls'); } catch { /* no registry (a test's DOM): the keyboard's and the finger's words stay */ }
  if (!doc.getElementById('lk-tutorials-css')) { const st = doc.createElement('style'); st.id = 'lk-tutorials-css'; st.textContent = TUTORIALS_CSS; doc.head.appendChild(st); }
  body.innerHTML = tutorialsHtml();
  // Tessie's mark: her code (tessieMark.js) only where she lives (feature tessieArt: a desktop or a tablet); a phone drops the mark's figure
  { let art = false; try { art = feature('tessieArt').on; } catch { /* no registry (a test's DOM): no mark */ }
    const fig = body.querySelector('.tu-tessie');
    if (!art) fig?.remove();
    else if (fig) import('./tessieMark.js').then(({ tessieMarkSvg }) => { const m = fig.querySelector('.tu-tmark'); if (m) m.innerHTML = tessieMarkSvg(); }).catch((e) => console.error(e)); }
  const view = body.querySelector('.tu-view');
  let current = 0;
  const list = body.querySelector('.tu-list');
  // a strip wider than its box (a small phone): the edge with chips out of view fades (data-more="l r"), so the rest is found by a drag
  const edges = () => { const m = []; if (list.scrollLeft > 2) m.push('l'); if (list.scrollLeft + list.clientWidth < list.scrollWidth - 2) m.push('r'); if (m.join(' ') !== (list.dataset.more ?? '')) { if (m.length) list.dataset.more = m.join(' '); else delete list.dataset.more; } };
  list.addEventListener('scroll', edges, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(edges) : null; ro?.observe(list);
  function show(i, { focus = false } = {}) {
    const n = CHAPTERS.length; i = Math.max(0, Math.min(n - 1, i | 0)); current = i;
    for (const a of body.querySelectorAll('.tu-c')) a.hidden = +a.dataset.ch !== i;
    for (const b of body.querySelectorAll('.tu-li')) b.setAttribute('aria-current', String(+b.dataset.to === i));
    for (const img of body.querySelectorAll(`.tu-c[data-ch="${i}"] img[data-src]`)) if (!img.getAttribute('src')) img.src = img.dataset.src;   // a picture loads when its chapter opens
    view.scrollTop = 0;
    { const b = body.querySelector(`.tu-li[data-to="${i}"]`); if (b?.getBoundingClientRect) {   // the lit chip into the list's view, the list alone scrolled (never the page)
      const r = b.getBoundingClientRect(), L = list.getBoundingClientRect(), pad = 28;
      if (r.left < L.left) list.scrollLeft -= L.left - r.left + pad; else if (r.right > L.right) list.scrollLeft += r.right - L.right + pad;
      if (r.top < L.top) list.scrollTop -= L.top - r.top; else if (r.bottom > L.bottom) list.scrollTop += r.bottom - L.bottom;
    } }
    if (focus) view.focus({ preventScroll: true });
    edges();
  }
  const onClick = (e) => {
    const b = e.target.closest?.('button[data-to]'); if (!b || !body.contains(b)) return;
    show(+b.dataset.to, { focus: !b.classList.contains('tu-li') });
    if (b.classList.contains('tu-li')) b.focus({ preventScroll: true });
  };
  body.addEventListener('click', onClick);
  // the keys: the card's own (src/ui/home.js: the arrows walk the focus, Enter or Space presses the chapter's button)
  return { show, get current() { return current; }, dispose() { body.removeEventListener('click', onClick); list.removeEventListener('scroll', edges); ro?.disconnect(); } };
}
