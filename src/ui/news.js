// What's new: the changelog page, opened from About. Newest first. This is v1's list (/classic/, frozen): v2 has its own,
// v2/ui/news.js (its new releases on top of these), passed to the card as createHome({ news }).
// To add an entry, put one line at the TOP of NEWS:
//   { date: '2026-11-06', text: 'What changed, in a sailor\'s words.', see: 'Where to look: the button, the key.' },
// An entry that names a key gives a finger its own words (owner 2026-11-15): touchText and touchSee (the page shows them when
// data-hand="touch", src/ui/hand.js).
// Entries with the same date are one release on the page: a date heading, the newest open, the older ones folded under
// their date (a tap opens one); the page scrolls (src/ui/homePages.js). Keep it player-facing: no internal names, file
// paths, ids or numbers about how the game is run (tests/news.test.mjs rejects them). The home card's foot prints the
// version and the newest date at first paint: after a new date, run `python3 -I tools/loading_shell.py` (tests/loading
// .test.mjs says when it is stale).
export const NEWS = [
  { date: '2026-11-06', text: 'An afternoon thunderstorm can roll in over the ridge: rain, lightning, then a rainbow.', see: 'Setup, Under way, storm.' },
  { date: '2026-11-06', text: 'Tahoe’s clear water: in the shallows you can see the granite bottom.', see: 'Sail close to a beach and look down.' },
  { date: '2026-11-06', text: 'You can see a gust coming as a dark patch on the water before it hits.', see: 'Sail in wind 3 or 4 and watch upwind.' },
  { date: '2026-11-06', text: 'Ospreys and bald eagles over the bay. An osprey dives for trout.', see: 'Look up while you sail.' },
  { date: '2026-11-06', text: 'Your first visit starts on the water, already sailing.', see: 'Open Velia in a new browser.' },
  { date: '2026-11-06', text: 'Smoother on phones, steadier on a first visit, and waves that sound like water.', see: 'Open Velia on your phone.' },
  { date: '2026-11-05', text: 'Quieter screens: fewer labels, and short messages take the subtitle line instead of a pill under the top bar.', see: 'Sail, then reef or change the wind level.' },
  { date: '2026-11-04', text: 'A music note in the top bar. Tap it to play the next song.', see: 'Open the top bar’s ♪ and tap ⏭.' },
  { date: '2026-11-04', text: 'Each wind level now holds its own band of wind.', see: 'Setup, Under way, wind 1 to 4.' },
  { date: '2026-11-04', text: 'Tacking carries through the turn, and Space tacks.', see: 'Sail into the wind and press Space.', touchText: 'Tacking carries through the turn.', touchSee: 'Sail into the wind and tap Tack.' },
  { date: '2026-11-04', text: 'N opens the chart. The chart dial fits a wide screen.', see: 'Press N while sailing.', touchText: 'The chart dial fits a wide screen.', touchSee: 'Tap the chart while sailing.' },
  { date: '2026-11-04', text: 'A plain first line, and a quick check that your browser can run the game.', see: 'The first page you open.' },
  { date: '2026-10-31', text: 'An upright iPhone gets its own helm: wheel, winches and keys, throttle.', see: 'Hold your phone upright in Sail.' },
  { date: '2026-10-31', text: 'Phones start more steadily, with sound under the silent switch and lighter downloads.', see: 'Open Velia on an iPhone or an iPad.' },
  { date: '2026-10-31', text: 'The menu is a small chart card over the live lake. Esc opens it again.', see: 'Press Esc while sailing.', touchText: 'The menu is a small chart card over the live lake.', touchSee: 'Tap Menu while sailing.' },
  { date: '2026-10-31', text: 'Cruise has one row of buttons: Chart, Binoculars, Radio and Take the helm.', see: 'Choose Cruise on the first card.', touchText: 'Cruise has one row of buttons: Chart, Radio and Take the helm.' },
  { date: '2026-10-30', text: 'Regatta: the Island Sprint against Wren on Osprey.', see: 'Choose Regatta on the first card.' },
  { date: '2026-10-30', text: 'The boat can run aground. A depth alarm warns you first.', see: 'Sail toward the shallows near the shore.' },
  { date: '2026-10-30', text: 'Bigger waves that run with the wind.', see: 'Setup, Under way, wind 4.' },
  { date: '2026-10-30', text: 'The skipper speaks the hints aloud.', see: 'Setup, Aids, skipper’s voice.' },
  { date: '2026-10-30', text: 'Real tree crowns line the shore, taken from the lake’s own survey.', see: 'Sail close to the shore and look up.' },
  { date: '2026-10-29', text: 'Velia opens: sail Halcyon on Emerald Bay, with real wind and real water.', see: 'Choose Sail on the first card.' },
];
// the build stamp, small at the bottom of the page: the short id of the build (set when the site is built)
export const BUILD_ID = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';
// the version a player can read out: 0.N, where N counts the release days in a list (it moves up with each new date)
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const prettyDate = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${MONTHS[m - 1]}`; };
// a list's version words: the page stamp, and the home card's foot (Solaria stage 1: the version and the newest entry's date,
// under "What's new ›"; tools/loading_shell.py writes the same line into the card at first paint)
export function newsMeta(list) {
  const version = `0.${new Set(list.map((n) => n.date)).size}`;
  return { list, version, versionLine: `Version ${version} · ${BUILD_ID}`, newest: list[0].date, cardLine: `Version ${version} · ${prettyDate(list[0].date)}` };
}
const V1 = newsMeta(NEWS);
export const VERSION = V1.version;
export const VERSION_LINE = V1.versionLine;
export const CARD_VERSION_LINE = V1.cardLine;

// the releases, newest first: one per date, its entries in NEWS's order (the page's date headings; the newest opens unfolded)
export function newsReleases(list = NEWS) {
  const out = [];
  for (const n of list) { const last = out.at(-1); if (last && last.date === n.date) last.items.push(n); else out.push({ date: n.date, items: [n] }); }
  return out;
}
