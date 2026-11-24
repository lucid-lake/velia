// The home card's idle "attract": after ATTRACT_S seconds with nothing touched on the
// home card, it eases aside and the world plays Cruise; any key, click or touch brings the card back. Pure: no DOM, no
// clock. The card feeds it time (tick) and input (poke while watching, wake while away) and acts on its two callbacks.
//   const idle = createIdle({ idleS: 45, onAway: () => …, onBack: () => … });
//   idle.arm();            // the card is up, live and on its main page: start counting
//   idle.tick(dt);         // seconds since the last tick
//   idle.poke();           // the player did something while watching: count again from 0
//   idle.wake();           // the player did something while away: back (onBack)
//   idle.disarm();         // the card went (Enter, a page opened): stop counting; if away, come back without a callback
import { toFlags } from '../sim/core/flags.js';
export const ATTRACT_S = 45;

export function createIdle({ idleS = ATTRACT_S, onAway = () => {}, onBack = () => {} } = {}) {
  let armed = false, away = false, t = 0;
  return {
    arm() { armed = true; t = 0; },
    disarm() { armed = false; away = false; t = 0; },
    poke() { if (armed && !away) t = 0; },
    tick(dt) {
      if (!armed || away) return;
      t += dt;
      if (t >= idleS) { away = true; onAway(); }
    },
    wake() { if (!armed || !away) return false; away = false; t = 0; onBack(); return true; },
    get armed() { return armed; }, get away() { return away; }, get idleFor() { return t; }, idleS,
  };
}

// ?attract=0 turns it off; an automated browser (probes, tests) skips it unless ?attract=1; ?attractS=3 shortens the wait (probes)
export function attractSettings(flags = '', webdriver = false) {   // flags: a flags object (or a query string: the tests)
  flags = toFlags(flags); const a = flags.attract;
  const on = a === '1' || (a !== '0' && !webdriver && flags.show == null);   // the share link (?show=fireworks) waits on its card for Enter
  const s = parseFloat(flags.attractS);
  return { on, idleS: s > 0 ? s : ATTRACT_S };
}
