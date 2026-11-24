// Regatta's page facts on v2 (BACKLOG-v2 #12): what main.js needs before the Regatta chunk is
// in (the mode the page opens in, its hour, its game speed, the fleet's cap, what a race cuts). Pure: v2/tests/regatta.test.mjs.
//   regattaAtBoot(flags)   → true: ?mode=regatta (or v1's aliases racing, race) opens the page in Regatta
//   RACE                   the race's constants: v1's 15:00, the pre-start at −0:45 (owner 2026-11-14: in the box, no card first),
//                          real time (v1: a race runs at 1 ×), 6 boats at most (owner 2026-11-14: you + 5 rivals on every device)
//   fleetSize(rivals)      → the boats a race sails (the player + the rivals asked for), never over RACE.maxBoats
//   RACE_CUTS              the scene's draws a race leaves out (owner 2026-11-14: kayaks, birds, fireworks, town detail; the
//                          weather and the wind stay)
import { MODE_NAMES } from '../../src/modes/rows.js';

const ROW = MODE_NAMES.find((r) => r.id === 'regatta');
export const isRegatta = (m) => !!m && (m === ROW.id || ROW.aliases.includes(String(m).toLowerCase()));
export const regattaAtBoot = (flags) => isRegatta(flags?.mode);

export const RACE = Object.freeze({ hour: 15, prestartS: 45, speed: 1, maxBoats: 6, maxRivals: 5, rivals: 5 });   // R4: the full fleet by default
export const fleetSize = (rivals = RACE.rivals) => 1 + Math.max(0, Math.min(RACE.maxRivals, Math.floor(Number(rivals) || 0)));
export const RACE_CUTS = Object.freeze(['kayaks', 'birds', 'fireworks', 'towns']);

// the mode switch's hooks (v2/engine/modes.js's row; ui/modeSwitch.js runs them). enter: the race in the box (opts { hub: false }:
// no hub, a chart pin's Race here sets the race itself). leave: the race left (the rivals, marks and lines gone); the boat stays
export const REGATTA_SWITCH = Object.freeze({
  needsBoat: true,
  async enter(_k, { load, opts }) { const r = await load(); await r.enter(opts); },
  leave(r) { r.leave(); },
});
