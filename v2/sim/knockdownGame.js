// K3, the game end's timeline, pure: what the page does from the warning to the card, on the frame's real time.
//   warning     (B.onKnockdownWarn) the skipper's line and the REEF selector's amber for WARN.holdS (the phone's sheet ring pulses)
//   knockdown   (B.onKnockdown) the roll plays on; END.slowAtS after the event the frame slows (the sim's time × timeScale, eased
//               from 1 to END.slow over END.slowS, then under the card to END.still over END.stillS), the card at END.cardAtS (2–3 s after the roll began: the event comes at 55° held
//               0.5 s); the card alone (owner 2026-11-17: no menu card unless its Menu is pressed)
//   Start again (again()) the same mode, the same weather: the page puts her back at the mode's start; the time runs at 1 again
// Cruise never (owner 2026-11-17): a knockdown event in Cruise is ignored. Regatta: the same slow, then the race's own results card
// with DNF (cause.regatta) instead of the logbook card.
// The session's line in the log: the sailing time (s), the distance (m) and the top speed (m/s) since the last start, from the sim.
//   const G = createKnockdownGame();  G.warn(e, mode) → line | null;  G.knock(e, mode) → bool;  G.frame(dt) → { timeScale, card }
//   G.sail(simDt, sog);  G.log;  G.again();  G.state ('sailing' | 'rolling' | 'ended')
import { knockOf, homeId } from '../engine/modes.js';   // the knockdown's end per mode: the mode table's knockdown ('logbook' | 'race' | null)
export const WARN = Object.freeze({ line: 'Overpowered — ease the sails or reef', holdS: 4, repeatS: 8 });
export const END = Object.freeze({ slowAtS: 0.9, slowS: 1.3, slow: 0.2, cardAtS: 2.2, stillS: 3, still: 0.03 });

const smooth = (x) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };

export function createKnockdownGame({ end = END, warn = WARN } = {}) {
  let state = 'sailing', since = 0, warnLeft = 0, lastWarn = -Infinity, wall = 0, event = null, mode = homeId(), cardShown = false;
  const log = { seconds: 0, metres: 0, topMs: 0 };
  const out = { timeScale: 1, card: false, warn: false };
  return {
    get state() { return state; }, get event() { return event; }, get mode() { return mode; }, get log() { return log; },
    get warnOn() { return warnLeft > 0 && state === 'sailing'; },
    // the warning: the line to say (or null: Cruise, already over, or said within repeatS)
    warn(e, m = homeId()) {
      if (knockOf(m) === null || state !== 'sailing') return null;
      warnLeft = warn.holdS;
      if (wall - lastWarn < warn.repeatS) return null;
      lastWarn = wall; return warn.line;
    },
    // the knockdown: true when the game ends (not in Cruise, not twice)
    knock(e, m = homeId()) {
      if (knockOf(m) === null || state !== 'sailing') return false;
      state = 'rolling'; since = 0; event = e ?? {}; mode = m; cardShown = false; warnLeft = 0;
      return true;
    },
    // the sim's time and speed while she sails (the session's log); nothing counted once the sail has ended
    sail(simDt, sogMs) {
      if (state !== 'sailing' || !(simDt > 0)) return;
      log.seconds += simDt; log.metres += Math.max(0, sogMs ?? 0) * simDt; log.topMs = Math.max(log.topMs, sogMs ?? 0);
    },
    // each frame (real dt): the time scale, and true on the one frame the card is due
    frame(dt) {
      wall += dt; out.card = false;
      if (warnLeft > 0) warnLeft = Math.max(0, warnLeft - dt);
      out.warn = warnLeft > 0 && state === 'sailing';
      if (state === 'sailing') { out.timeScale = 1; return out; }
      since += dt;
      out.timeScale = 1 - (1 - end.slow) * smooth((since - end.slowAtS) / end.slowS);
      if (since > end.cardAtS) out.timeScale = Math.max(end.still, out.timeScale * (1 - smooth((since - end.cardAtS) / end.stillS)));   // under the card she settles to a near stop (she starts to come up; she never rolls on through)
      if (!cardShown && since >= end.cardAtS) { cardShown = true; state = 'ended'; out.card = true; }
      if (knockOf(mode) === 'race' && cardShown) out.timeScale = 1;   // the race's results card is up: the fleet sails home at full time
      return out;
    },
    // Start again (or a new mode): sailing again at full time, a fresh log
    again() { state = 'sailing'; since = 0; event = null; warnLeft = 0; out.timeScale = 1; log.seconds = 0; log.metres = 0; log.topMs = 0; cardShown = false; },
  };
}
