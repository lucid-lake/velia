// The reef in now, as the switches show it (owner, 2026-11-16: the REEF switch and the phone's Reef must say 1 or 2 reefs).
// The level is the physics' target (src/sim/boat.js reefTarget: the player's or the automatic reef, whichever is deeper),
// so a switch never says less than the boat carries. Pure: v2/tests/reef-down.test.mjs.
//   reefNow(state, ctl)   0 | 1 | 2
//   reefLever(sel)        the cockpit's REEF selector place (render/cockpit/rig.js): 0, 1, 2, then A at the top
//   reefWords(sel, level) REEF's tip and spoken label
export const reefNow = (state, ctl = null) => Math.max(0, Math.min(2, Math.round(state?.reef ?? ctl?.reef ?? 0)));
export { reefLever, reefWords } from './autoReef.js';   // the selector A · 0 · 1 · 2 (owner 2026-11-17)
