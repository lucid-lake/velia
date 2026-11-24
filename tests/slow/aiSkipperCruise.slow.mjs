// The slow lane (npm run test:slow; kept out of the fast `node --test tests/`): the AI skipper's 20-minute Cruise, seeds 1 and 2
// and the 0.2 skipper (tests/aiSkipperCruise.test.mjs runs seed 3 at skill 1). Bodies: tests/helpers/cases-chill.mjs.
import { skipperVoyage, SKIPPER } from '../helpers/cases-chill.mjs';

for (const c of SKIPPER) if (!(c[0] === 3 && c[1] === 1)) skipperVoyage(c);
