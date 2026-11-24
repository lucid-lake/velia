// The slow lane (npm run test:slow; kept out of the fast `node --test tests/`): the AI skipper's Cruise run on a real sea
// state (the hull float and the waves' surge and slam in the physics), 20 min at 16:00, seeds 1 to 3 (seed 2 ran in the
// fast suite until 2026-11-12: about 20 s, the fast suite's longest test), and the sea-state order (Hs 0 / 0.3 / 1 / 2 m).
// The surface is a sum of plane waves with a lake spectrum's periods (src/modes/chill/sim.js takes it as `surface`).
// Bodies: tests/helpers/cases-chill.mjs.
import { seaStateVoyage, seaStateOrder } from '../helpers/cases-chill.mjs';

for (const seed of [1, 2, 3]) seaStateVoyage(seed);
seaStateOrder();
