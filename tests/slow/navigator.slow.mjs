// The slow lane (npm run test:slow; kept out of the fast `node --test tests/`): the Cruise navigator's 30-minute voyages
// that tests/navigator.test.mjs leaves out (it runs 18:00 seed 1). Bodies: tests/helpers/cases-chill.mjs.
import { navigatorVoyage, NAV_HOURS, SEEDS } from '../helpers/cases-chill.mjs';

for (const hour of NAV_HOURS) for (const seed of SEEDS) if (!(hour === 18 && seed === 1)) navigatorVoyage(hour, seed);
