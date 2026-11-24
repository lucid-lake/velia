// Chill's skipper in steady hours (the light held, so the wind regime stays: real progress round the loop) and on a
// lake wind advisory day (gusts to ≈ 23 m/s with the terrain's speed-up; the crew's auto-reef). 30 min of sim time
// each, the same safety rules as tests/navigator.test.mjs.
import { heldVoyage } from './helpers/cases-chill.mjs';

// held seed 1 here; held seeds 2 and 3 and the three advisory days run in the slow lane (tests/slow/navigator-wind.slow.mjs)
heldVoyage(1);
