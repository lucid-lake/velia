// The fireworks share link, ?show=fireworks (S5, owner 2026-11-08). No imports: src/main.js stages these flags
// before the core boots (as the first visit's start), so the page's first chunk stays small. The rest of the Cruise trip
// lives in ./cruise.js, which re-exports these.
//   Cruise on the highlight day (src/day.js), the fireworks on, the boat at anchor on CRUISE_SPOT heading for the show, the
//   clock at 21:43:00 (60 game s, 15 real s, before the show's first riser at 21:44). The URL's own hour wins (a capture).
export const SHOW_PARAM = 'fireworks';
// Cruise's anchorage inside the mouth (the reachable water nearest the sill: ./cruise.js says why); every mode's viewing
// spot since the realism round (stage.js VIEW, tested equal)
export const CRUISE_SPOT = [1350, -960];
// the bearing from CRUISE_SPOT to the show's middle (deg clockwise from north; tests/fireworksCruise.test.mjs checks it)
export const SHARE_HEADING = 243.0;
export const SHARE = { leadGameS: 60 };
const SHOW_START = 21 + 44 / 60;   // src/fireworks/evening.js SHOW_START (tested equal)
export const shareHour = () => SHOW_START - SHARE.leadGameS / 3600;
export const isShare = (flags) => flags?.show === SHOW_PARAM;
// Is the show built on this page? On by default on the highlight day (owner 2026-11-08: the default day is July 4, so the
// normal game has the show at 21:45), ?fireworks=0 off; the share link always (its day is the highlight day). Another
// day has none: the Cruise button opens the share link there. highlight: src/day.js isHighlightDay(waters).
export const showOn = (flags, highlight) => !!highlight && (flags?.fireworks !== false || isShare(flags));

// The share link's flags over the page's (withFlags overrides; src/core/flags.js)
export function shareOverrides(flags) {
  return {
    mode: 'cruise', fireworks: true, start: `${CRUISE_SPOT[0]},${CRUISE_SPOT[1]}`, heading: String(SHARE_HEADING),
    ...(flags.hour == null ? { hour: shareHour().toFixed(5) } : {}),
  };
}

// The Cruise button on a page with no show built (another day, ?fireworks=0): the share link from this page's address,
// its day, hour, start and fireworks pins dropped (the link sets its own), the rest kept (a quality, a seed)
export function shareSearch(search = '') {
  const q = new URLSearchParams(search);
  for (const k of ['day', 'hour', 'start', 'heading', 'fireworks', 'fwt', 'show', 'mode']) q.delete(k);
  q.set('mode', 'cruise'); q.set('show', SHOW_PARAM);
  return `?${q.toString()}`;
}
