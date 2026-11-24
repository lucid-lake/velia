// The slow lane (npm run test:slow; kept out of the fast `node --test tests/`): Chill's 60-minute quick night, seeds 1 and 2
// (tests/navigator-night.test.mjs runs seed 3). Bodies: tests/helpers/cases-chill.mjs.
import { nightVoyage } from '../helpers/cases-chill.mjs';

for (const seed of [1, 2]) nightVoyage(seed);
