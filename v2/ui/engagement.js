// Two engagement counts (owner, 2026-11-19; they replace the funnel's dead goal_reached): sailed_2min and race_finished.
// Pure: no DOM, no timers; v2/tests/engagement.test.mjs. Both go through v2/ui/metrics.js's track() (the same /api/e path and rules).
//   createSailClock({ track, visible, thresholdS }) → { enter(mode), mode(m), tick(dtS), seconds, reached }
//     enter: the player left the home card (the page's 'lakeshore:entered'); mode: Sail | Cruise | Regatta now; tick: called every
//     frame with the real seconds since the last frame. Only visible-tab time counts (a hidden tab adds nothing; a long gap on
//     return is clamped), and sailed_2min fires once a page load: once per session. Field: mode, where the 2 minutes were reached.
//   raceFinished(track, { finished, place, event }) → one race_finished for a finish line crossed (a DNF or a knockdown sends nothing).
//     race: the place race's id (tea-house-run) or the course's event kind (fleet, match, pursuit, trial).
export const SAIL_MIN_S = 120;
const STEP_MAX_S = 0.5;   // one frame's longest step: a tab coming back from the background adds a frame, not the time away

export function createSailClock({ track, visible = () => true, thresholdS = SAIL_MIN_S } = {}) {
  let playing = false, m = 'sail', s = 0, sent = false;
  return {
    enter(mode) { playing = true; if (mode) m = mode; },
    mode(mode) { if (mode) m = mode; },
    tick(dtS) {
      if (!playing || sent || !(dtS > 0) || !visible()) return;
      s += Math.min(dtS, STEP_MAX_S);
      if (s >= thresholdS) { sent = true; track?.('sailed_2min', { mode: m }); }
    },
    get seconds() { return s; },
    get reached() { return sent; },
  };
}

export function raceFinished(track, { finished = false, place = null, event = '' } = {}) {
  const race = String(place || event || '').toLowerCase();
  if (!finished || !/^[a-z0-9-]{1,24}$/.test(race)) return false;
  track?.('race_finished', { race });
  return true;
}
