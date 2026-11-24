// The evening (stage S3, § 3 minute by minute): plain JS, so node tests drive it. One step a real frame; it says
// what the game's clock should do and which quiet line the skipper says.
//   const ev = createEvening(); const out = ev.step(dtReal, { hour, sunDeg, x, z, sog })
//   out.rate   game s per real s to hold the clock at, or null (leave the mode's own day clock)
//   out.phase  'before' (the day, the pacing hints) | 'lapse' (the time-lapse to 21:44) | 'show' | 'after' (released)
//   out.lines  the skipper's lines this step (src/ui/controlsHint.js note(): the subtitle, never a pop-up)
//   out.atSpot the boat at the viewing spot (inside SPOT_RADIUS of stage.js VIEW, the anchorage inside the mouth; it was the
//              sill until the realism round, 2026-11-08: no keel of ours crosses the bar)
// The rules (owner, 2026-11-07 round 2: "before the sky is completely dark, the boat needs to already be near the best view
// location; when it is dark, we should quickly time-elapse to the fireworks start time"):
//   - the hints: 20:15 "Fireworks off the bay's mouth at 21:45."; 20:40, if not at the spot, "Anchor at the mouth for the
//     show."; 21:20, if still inside the bay, "You'll see it best from the mouth."
//   - the time-lapse starts once the sun is below −6° and the boat is settled at the spot (under 0.5 m/s for 6 s), or at
//     21:35 wherever it is (the show is a real event: it does not wait). The rate eases up from 12 to at most 360 game s per
//     real s over 1.5 s, then follows the gap to 21:44 down (gap / 0.6 s), so it lands on 21:44:00: about 8 s from 21:01.
//   - from 21:44 the clock runs at SHOW_RATE (4): the show's 5-minute script plays in real time and its clock and the game's
//     agree (show s = game s since 21:44 / 4: src/fireworks/world.js showTimeAt); from 22:10 the day clock takes over again.
//   - after the show, if the boat was not at the spot during it: "Next time, anchor at the mouth for the show."
// S5 (owner 2026-11-08): `also` lists more viewing spots (Cruise's anchorage inside the mouth, cruise.js
// CRUISE_SPOT: its keel cannot cross the bar to the sill); invite() is the Cruise button: the time-lapse waits for no dark
// sky, only for the boat settled at a spot (or the 21:35 cap), and a new evening starts if the last one is over;
// phase: 'show' starts in the show (the share link, a minute before 21:44); held(): the clock stands still (rate 0) while
// it is true (the share link's home card).
import { VIEW } from './stage.js';

export const SHOW_START = 21 + 44 / 60;
export const EVENING = {
  hintAfternoon: 20.25, hintDusk: 20 + 40 / 60, hintBay: 21 + 20 / 60, capHour: 21 + 35 / 60, endHour: 22 + 10 / 60,
  settleSog: 0.5, settleS: 6, spotRadius: 400, bayRadius: 400,
  lapseFrom: 12, lapseMax: 360, lapseRampS: 1.5, lapseTau: 0.6, showRate: 4,
  inviteRate: 8,   // invited (the Cruise button), the clock holds the golden hour at this pace while the boat makes for the spot
};
export const LINES = {
  afternoon: "Fireworks off the bay's mouth at 21:45.",
  dusk: 'Anchor at the mouth for the show.',
  bay: "You'll see it best from the mouth.",
  lapse: 'The stars come out…',
  nextTime: 'Next time, anchor at the mouth for the show.',
};
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// the evening's rates are game s per real s; the scene clock counts scene seconds, which run timeScale per real s in Sail (2) and 1 in Cruise
export const perScene = (rate, timeScale = 1) => rate / Math.max(1e-3, timeScale);
export function createEvening({ spot = VIEW, also = [], E = EVENING, phase = 'before', held = () => false } = {}) {
  const fresh = (p = 'before') => ({ phase: p, settled: 0, lapseT: 0, said: new Set(), sawShowAtSpot: false, wasInShow: false, invited: false });
  const S = fresh(phase);
  function say(out, key) { if (!S.said.has(key)) { S.said.add(key); out.lines.push(LINES[key]); } }
  // the Cruise button: this evening's lapse waits only for the boat at a spot; an evening already over starts again
  function invite() { if (S.phase === 'after') Object.assign(S, fresh()); S.invited = true; S.settled = 0; }
  function step(dt, { hour, sunDeg, x, z, sog = 0 }) {
    const out = { rate: null, phase: S.phase, lines: [], atSpot: false };
    const d = Math.hypot(x - spot[0], z - spot[1]);
    out.atSpot = d < E.spotRadius || also.some((p) => Math.hypot(x - p[0], z - p[1]) < E.spotRadius);
    S.settled = out.atSpot && sog < E.settleSog ? S.settled + dt : 0;
    if (S.phase === 'before') {
      if (hour >= E.hintAfternoon && hour < SHOW_START) say(out, 'afternoon');
      if (hour >= E.hintDusk && hour < SHOW_START && !out.atSpot) say(out, 'dusk');
      if (hour >= E.hintBay && hour < SHOW_START && !out.atSpot && d > E.bayRadius && x < spot[0]) say(out, 'bay');
      const dark = sunDeg < -6 || S.invited, settled = S.settled >= E.settleS;
      if (hour >= SHOW_START && hour < E.endHour) S.phase = 'show';
      else if (hour < SHOW_START && hour > 20 && ((dark && settled) || hour >= E.capHour)) { S.phase = 'lapse'; S.lapseT = 0; say(out, 'lapse'); }
      else if (S.invited && hour < E.capHour) out.rate = E.inviteRate;
    }
    if (S.phase === 'lapse') {
      S.lapseT += dt;
      const gap = (SHOW_START - hour) * 3600;   // game s to 21:44
      if (gap <= 0.05) S.phase = 'show';
      else {
        const follow = Math.min(E.lapseMax, Math.max(E.showRate, gap / E.lapseTau));
        const ramp = E.lapseFrom + (E.lapseMax - E.lapseFrom) * ss(0, E.lapseRampS, S.lapseT);
        out.rate = Math.min(follow, ramp);
        // never past 21:44 in one step
        out.rate = Math.min(out.rate, Math.max(E.showRate, gap / Math.max(dt, 1e-3)));
      }
    }
    if (S.phase === 'show') {
      if (hour >= E.endHour) {
        S.phase = 'after';
        if (!S.sawShowAtSpot) say(out, 'nextTime');
      } else {
        out.rate = E.showRate;
        if (out.atSpot) S.sawShowAtSpot = true;
      }
    }
    if (held() && out.rate != null) out.rate = 0;   // the share link's card is up: the evening waits for its Enter
    out.phase = S.phase;
    return out;
  }
  return { step, invite, state: S };
}
