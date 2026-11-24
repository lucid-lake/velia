// The features' clock-menu rows (the pure half of src/features/index.js, as setup.js is for the Setup rows; Velia v2's day
// clock, 2026-11-13): the rows a feature adds after the hours in the top bar's time menu (src/ui/timeMenu.js). index.js
// spreads each entry into its row (one source); timeMenu.js reads featureTimeRows from here, so it reaches no feature code
// and Velia v2 (v2/, no three.js) can mount the menu. A row: { id, name, lit(phase) → bool, pick(ctx) → what it did }.
import { shareSearch } from '../fireworks/share.js';

export const SHOW_START_HOUR = 21 + 44 / 60;   // the show's clock (src/fireworks/show.js SHOW_START_HOUR; tests/features.test.mjs keeps them equal)
export const FIREWORKS_LEAD_H = 10 / 3600;     // the clock menu's Fireworks lands this far before the first shell's clock (game s)

// in src/features/index.js's row order
export const FEATURE_TIME_ROWS = {
  fireworks: [{
    id: 'fireworks', name: 'Fireworks',
    lit: (phase) => phase === 'lapse' || phase === 'show',
    // Cruise: its own Fireworks button (the trip to the viewing spot); no show on this page (another day): the share link's
    // page; else the clock to 10 game s before the show and the evening invited
    pick({ cut, fireworks, fireworksGo, search, go }) {
      if (fireworksGo) return fireworksGo();
      const fw = fireworks();
      if (!fw) { go(shareSearch(search())); return 'share'; }
      cut(SHOW_START_HOUR - FIREWORKS_LEAD_H);
      fw.invite();
      return 'show';
    },
  }],
};

// the clock menu's rows after the hours; the same list as src/features/index.js featureTimeRows() (tests/features.test.mjs)
export const featureTimeRows = (list = Object.values(FEATURE_TIME_ROWS)) => list.flat();
