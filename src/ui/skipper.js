// The old skipper: the voice of the hints, the logbook's margin notes and the harbour master's
// calls. R. is an old Tahoe sailor: warm, dry, never condescending. No avatar, no portrait: words, in quotes, in a softer
// italic on the glass hint row, and (later) the same words spoken.
//
// A hint line is  lead + the phrase of words.js:  "Sails shaking — pull the sails in · trim". The lead is the reason, in
// the skipper's voice; the phrase is the imperative and keeps its plain-first, term-beside-it fading (words.js PHRASES),
// so the sailor's words logic and its tests are untouched. A line is at most 12 words, plain words first, no "!".
//
//   say('pull')          → '<span class="say">Sails shaking — §pull§</span>' (a words.js string: W.expand() fills §pull§)
//   spoken('pull', words) → 'Sails shaking. Pull the sails in.' (the text a voice reads; plain level or sailor level)
//   MARGIN[skillId]       → the pencilled note for the logbook's seamanship page, signed SIGN
import { stripMarkup } from './words.js';

// the reason before the imperative (the phrase key is the hint's name)
export const LEADS = {
  pull:   'Sails shaking —',
  ease:   'She’s overpowered —',
  irons:  'Nothing’s pulling —',
  steer:  'She needs a hand —',
  tack:   'Keep her moving —',
  gybe:   'Boom swings hard —',
  heavy:  'She’s had enough —',
  gusts:  'Look up the lake —',
  groove: 'Feel her settle —',
};
// lines with no phrase of their own: the whole sentence (mouse wording in MOUSE_TEXT)
export const TEXT = {
  chart:   'Lost? The chart shows where you are',
  wind:    'Want a different breeze? Try these',
  look:    'Have a look round',
  closer:  'Come closer',
  whisper: 'Forgot a key? Hold it down',
};
export const MOUSE_TEXT = { chart: 'Lost? Click the chart, top right' };

const q = (s) => `<span class="say">${s}</span>`;   // no quote marks: a film subtitle
export const say = (name) => q(`${LEADS[name]} §${name}§`);
export const sayText = (s) => q(s);

// What a voice reads: the lead's dash becomes a stop, the first letter of the phrase a capital. level 'plain' reads the
// plain phrase; 'sailor' the sailor's form (words.js decides through createWords). The term tag ("· trim") is not spoken.
export function spoken(name, words) {
  const lead = LEADS[name];
  if (!lead) return TEXT[name] ? `${TEXT[name]}.` : null;
  const phrase = stripMarkup(words.expand(`§${name}§`).replace(/<span class="tag">[\s\S]*?<\/span>(?=$)/, '')).replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  return `${lead.replace(/\s*—$/, '.')} ${phrase[0].toUpperCase()}${phrase.slice(1)}.`;
}

// The notes the engine and the anchor say (src/sail/seamanship.js): one line each, shown once into a quiet moment.
// text: what the glass row shows ({d} = the depth, "18 m"; {term|text} words.js markup); speak: what the voice reads
// (numbers and abbreviations spelt out; the depth is not read, so one clip serves every depth).
export const NOTES = {
  fast:    { text: 'Easy now — under 1 {knot|kn} to {anchor}', speak: 'Easy now. Under one knot to anchor.' },
  deep:    { text: '{d} here — I’d {anchor} in 3 to 20 m', speak: 'Too deep here. I’d anchor in three to twenty metres.' },
  shallow: { text: '{d} here — too shallow to hold', speak: 'Too shallow to hold here.' },
  tied:    { text: 'Let go of the mooring or the pier first', speak: 'Let go of the mooring or the pier first.' },
  ballFast: { text: 'Easy now — slower to pick up the ball', speak: 'Easy now. Slower to pick up the ball.' },
  ball:    { text: 'Bow to the ball, nice and easy', speak: 'Bow to the ball, nice and easy.' },
  pierFast: { text: 'Stop alongside, then tie up', speak: 'Stop alongside, then tie up.' },
  pier:    { text: 'Within a metre of the pier, then tie up', speak: 'Within a metre of the pier, then tie up.' },
  dawn:    { text: 'She’s at {anchor} — the Dawn button waits for the morning', speak: 'She’s at anchor. The dawn button waits for the morning.' },
  engine:  { text: 'The sails can carry her now — stop the engine', speak: 'The sails can carry her now. Stop the engine.' },
  // the engine stops by itself at N (seamanship.js autoStop)
  engineOffSails:  { text: 'Engine off — the sails have her', speak: 'Engine off. The sails have her.' },
  engineOffAnchor: { text: 'Engine off — {anchor} holding', speak: 'Engine off. Anchor holding.' },
  engineOffFast:   { text: 'Engine off — she’s made fast', speak: 'Engine off. She’s made fast.' },
  motorKeys: { text: '+ for more power, − to slow — she holds the setting', speak: 'Plus for more power. Minus to slow. She holds the setting.',
    touch: 'Push the throttle for more power — she holds the setting', touchSpeak: 'Push the throttle for more power. She holds the setting.',
    thumb: 'Slide the rail up for more power — she holds the setting', thumbSpeak: 'Slide the rail up for more power. She holds the setting.',
    flat: 'Drag the throttle ring up for more power — she holds the setting', flatSpeak: 'Drag the throttle ring up for more power. She holds the setting.' },   // flat: v2's phone flat controls (v2/ui/flat.js)   // thumb: v2's one-thumb controls (v2/ui/thumb.js: the ▲ N ▼ rail)   // a finger has no keys (fix/first-load)
  sailsDown: { text: 'Sails down? Press Y', speak: 'Sails down? Press Y.', touch: 'Sails down? Tap Sails', touchSpeak: 'Sails down? Tap Sails.',
    thumb: 'Sails down? Tap ⋯, then Sails: Down', thumbSpeak: 'Sails down? Tap the three dots, then Sails, Down.',
    flat: 'Sails down? Tap ⋯, then Sails: Down', flatSpeak: 'Sails down? Tap the three dots, then Sails, Down.' },
  ballNear: { text: 'There’s a mooring ball — pick it up?', speak: 'There’s a mooring ball. Pick it up?' },
  // the bottom (feat/grounding): R. warns of shoaling and rocks, says why when the assist takes the helm, and talks the boat off
  shoal:     { text: 'Shoaling — {bear-away|bear away}', speak: 'Shoaling. Bear away.' },
  rocks:     { text: 'Rocks ahead — {bear-away|bear away}', speak: 'Rocks ahead. Bear away.' },
  shore:     { text: 'The shore ahead — {bear-away|bear away}', speak: 'The shore is ahead. Bear away.' },
  shoalAuto: { text: 'Shoal ahead — {bear-away|bearing away}', speak: 'Shoal water ahead. Bearing away.' },
  rocksAuto: { text: 'Rocks ahead — {bear-away|bearing away}', speak: 'Rocks ahead. Bearing away.' },
  shoreAuto: { text: 'The shore ahead — {bear-away|bearing away}', speak: 'The shore is ahead. Bearing away.' },
  boxed:     { text: 'No way round — {luff|luff} up and stop her', speak: 'No way round. Luff up, and stop her.' },
  aground:   { text: 'Aground — reverse the engine, or back the {jib|jib}', speak: 'We are aground. Reverse the engine, or back the jib.' },
  kedge:     { text: 'Kedging off — hauling on the {anchor|anchor}', speak: 'Kedging off. Hauling on the anchor.' },
  noKedge:   { text: 'No deep water near enough to kedge — try the engine', speak: 'No deep water near enough to kedge. Try the engine.' },
  floating:  { text: 'She floats — easy now', speak: 'She floats. Easy now.' },
  helm:    { text: 'You have the {helm}', speak: 'You have the helm.' },
  // an upright phone, the first time it sails (feat/cockpit-phone, src/ui/turnPhone.js): once per browser, never a blocking screen
  turnPhone: { text: 'Turn your phone for the full cockpit', speak: 'Turn your phone for the full cockpit.' },
  // let fly (src/sail/letFly.js): once each, the first time the jib alone or both sheets fly; the jib's by the words' level
  letFlyJib:      { text: '{jib|Jib}’s {let-fly|let fly} — she’ll round up and stop. {sheet|Sheet} in to sail on', speak: 'Jib’s let fly. She’ll round up and stop. Sheet in to sail on.' },
  letFlyJibPlain: { text: '{jib|Jib} let go — she’ll turn into the wind and stop. Pull it in to sail on', speak: 'Jib let go. She’ll turn into the wind and stop. Pull it in to sail on.' },
  letFlyBoth:     { text: '{sheet|Sheets} {let-fly|let fly} — she’ll slow down. {sheet|Sheet} in to sail on', speak: 'Sheets let fly. She’ll slow down. Sheet in to sail on.' },
  // the staged first visit (src/ui/firstStage.js): once each, first session only
  gustAhead: { text: 'Dark water ahead — here comes a {gust}', speak: 'Dark water ahead. Here comes a gust.' },
  bottom:    { text: 'Look down — you can see the bottom', speak: 'Look down. You can see the bottom.' },
  sheets:    { text: 'Want the {sheet|sheets} yourself? Setup → crew {trim|trims}', speak: 'Want the sheets yourself? Try Settings.' },   // Cruise → Sail, on the first steering or trim input (src/modes/chill/index.js)
  // Tessie's revenge (v2 only: v2/sim/tessieRevenge.js): she comes back after a charge (MUST), and the escape (once a session)
  tessieChase: { text: 'She’s coming back. Sail!', speak: 'She’s coming back. Sail!' },
  tessieClose: { text: 'That was close.', speak: 'That was close.' },
};

export const SIGN = '— R.';
// One pencilled note per skill, written when the skill is learned (a margin note: short, dry, kind). Never a score.
export const MARGIN = {
  steering: 'Light hands. She likes that.',
  trim:     'Telltales streaming. That is the whole secret.',
  nogo:     'Everyone tries to sail through the wind once. You turned away.',
  tacking:  'Good tack. You kept the speed. Most do not.',
  gybing:   'Sheet in first. You will thank yourself at fifty.',
  gusts:    'Dark water means wind. You saw it coming.',
  groove:   'That hum is the boat saying thank you.',
  heavy:    'You eased before she asked. Good sailor.',
  shifts:   'Tacked on the header. I had to be told.',
  surfing:  'Enjoy it. That ride is free.',
};
