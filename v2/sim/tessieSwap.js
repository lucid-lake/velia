// Play as Tessie, the swap's state and its rules (§ 3.6 and § 7 phase 1d). Pure: no DOM, no wall clock.
// One state: as 'boat' | 'tessie', with how it was entered ('menu' | 'swap' | 'chart'). The swap's window (W.pill: T works, and the
// skipper's line "Tessie's up." may show; v2/living/tessiePlayer.js createBeLine):
//   shows   when she has shown herself (any part of her above the water) within showM, or at once during her revenge
//   stays   while she is within showM, and lingerS after she dives out of sight; and readS after the line says so (W.hold): the
//           line can wait in the skipper's queue until she is nearly gone, and a press read off it must still swap (a slow machine)
//   never   in a race, while knocked down, on a phone (no playTessie), while a card or the map is open, or while you are her
//   const W = createSwap()
//   W.step(dt, { on, mode, race, knocked, card, shown, distM, revenge }) → { pill }   on: feature('playTessie').on; shown: she shows
//                                                                                  herself now; distM: from the boat to her nearest part
//   W.can(entry, ctx) → null | the reason a swap in is refused ('off' | 'race' | 'knocked' | 'unseen' | 'card')
//   W.hold(s) keeps the window open s more seconds (the line shown: readS)
//   W.become(entry) / W.back() → the state change ({ as, entry, from }) or null;  W.as, W.entry, W.pill
import { isRace } from '../engine/modes.js';   // a race: the mode table's race rows
export const SWAP = Object.freeze({ showM: 300, lingerS: 5, readS: 6, fadeS: 0.6 });

export function createSwap({ K = SWAP } = {}) {
  let as = 'boat', entry = null, pill = false, linger = 0, count = 0;
  const why = (e, c = {}) => {
    if (!c.on) return 'off';
    if (c.race || isRace(c.mode)) return 'race';
    if (c.knocked) return 'knocked';
    if (e === 'swap' && c.card) return 'card';
    if (e === 'swap' && !pill) return 'unseen';
    return null;
  };
  const self = {
    K,
    get as() { return as; }, get entry() { return entry; }, get pill() { return pill; }, get count() { return count; },
    step(dt, c = {}) {
      const near = !!c.shown && c.distM <= K.showM;
      if (near || c.revenge) linger = K.lingerS;
      else linger = Math.max(0, linger - Math.max(0, dt || 0));
      pill = as === 'boat' && !!c.on && !c.race && !isRace(c.mode) && !c.knocked && !c.card && (near || !!c.revenge || linger > 0);
      return { pill };
    },
    can: (e, c) => why(e, c),
    hold(s = K.readS) { if (as === 'boat' && pill) linger = Math.max(linger, s); },
    become(e = 'swap') { if (as === 'tessie') return null; as = 'tessie'; entry = e; pill = false; count++; return { as, entry, from: 'boat' }; },
    back() { if (as === 'boat') return null; const was = entry; as = 'boat'; entry = null; linger = 0; return { as, entry: null, from: was }; },
  };
  return self;
}
