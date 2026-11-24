// Cruise's page facts on v2 (BACKLOG-v2 #11): what main.js needs before the Cruise chunk is in (the mode the page opens in,
// its hour, its wind, its clock and its game speed). Pure: v2/tests/cruise.test.mjs holds each to v1's own
// (src/modes/chill/index.js coreOptions, src/sim/modes/chill/params.js, src/core/world.js's wind).
//   cruiseAtBoot(flags)        → true: ?mode=cruise (or v1's alias ?mode=chill) opens the page in Cruise
//   CRUISE_HOUR                v1's Cruise start hour on a live page with no ?hour (17:54)
//   cruiseWind(flags, hour)    → v1's Cruise WindField options (Tahoe's day; ?wind= its level), null under ?windspeed/?winddir
//   cruiseSchedule(flags)      → v1's Cruise day clock (src/sim/modes/chill/params.js chillClock): base 20 game s per sim s
//   cruiseSpeed(flags)         → the sim seconds a live second runs in Cruise (v1: 1, ?speed= sets it)
import { MODE_NAMES } from '../../src/modes/rows.js';
import { CHILL, chillClock } from '../../src/sim/modes/chill/params.js';

const ROW = MODE_NAMES.find((r) => r.id === 'cruise');
export const isCruise = (m) => !!m && (m === ROW.id || ROW.aliases.includes(String(m).toLowerCase()));
export const cruiseAtBoot = (flags) => isCruise(flags?.mode);
export const CRUISE_HOUR = parseFloat(CHILL.hour);

// v1's coreOptions(flags).wind (src/modes/chill/index.js): Tahoe's day on the scene clock and the level when ?wind= names one;
// a pinned wind (?windspeed or ?winddir) is the steady base instead (src/core/world.js), as Sail's is in v2's main.js
export function cruiseWind(flags, hour) {
  if (flags.winddir != null || flags.windspeed != null) return null;
  return { day: { hour, rate: 1, advisory: flags.advisory }, ...(flags.wind ? { level: Math.min(4, Math.max(1, parseInt(flags.wind, 10) || 3)) } : {}) };
}

// the clock: v1's day clock at Cruise's base (slow golden hours, the quick night); ?clock=flat the old quick night
export const cruiseSchedule = (flags) => chillClock(flags);
export const cruiseSpeed = (flags) => { const v = parseFloat(flags?.speed ?? CHILL.simSpeed); return Number.isFinite(v) ? Math.min(8, Math.max(0.1, v)) : CHILL.simSpeed; };
export { CHILL };

// the mode switch's hooks (v2/engine/modes.js's row; ui/modeSwitch.js runs them). enter: Cruise sails from where she is (MODE-6), or
// after the hand-over (handed) it is the hand-back in place (MODE-8); already sailing: nothing. leave: for a race, a quiet, fading
// leave with no hand-over (MODE-2, -4); for any other mode a fresh one (she stays where she is)
export const CRUISE_SWITCH = Object.freeze({
  async enter(_k, { get, load, ready, wasRace, pose }) {
    if (get()?.on) return;
    await ready;
    const c = await load();
    const handBack = !!c.handed && !wasRace;
    await c.enter(handBack ? { fresh: false } : { fresh: true, at: pose() });
  },
  leave(c, to) { c.leave(to?.race ? { race: true } : { fresh: true }); },
});
