// The slow lane (npm run test:slow): the hull RAO on the Ultra surface in 0.3 and 2 m waves (tests/ultra-surface.test.mjs
// runs 1 m). Body: tests/helpers/cases-ultraSurface.mjs.
import { raoCase } from '../helpers/cases-ultraSurface.mjs';

for (const H of [0.3, 2]) raoCase(H);
