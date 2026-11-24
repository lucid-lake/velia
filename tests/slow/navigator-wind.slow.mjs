// The slow lane (npm run test:slow; kept out of the fast `node --test tests/`): held seeds 2 and 3 and the three advisory days
// (tests/navigator-wind.test.mjs runs held seed 1). Bodies: tests/helpers/cases-chill.mjs.
import { heldVoyage, advisoryVoyage, ADVISORY } from '../helpers/cases-chill.mjs';

for (const seed of [2, 3]) heldVoyage(seed);
for (const c of ADVISORY) advisoryVoyage(c);
