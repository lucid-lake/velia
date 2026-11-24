// Chill's quick night (src/modes/chill/params.js CHILL.night): a 60-minute session from CHILL.hour (17:54 PDT) on the
// page's clock (the schedule: 20 game s per sim s by day, up to 220 through the night), sailed by the real navigator on the real
// physics, wind and traffic (src/modes/chill/sim.js). The same safety rules as tests/navigator.test.mjs; the light
// continuous; at most 2.5 real minutes with the sun under −8° in the first night (Tahoe's day loops in ≈ 49 min, so
// the 60 min reach the start of the next night); the boat back under way in the morning breeze.
import { nightVoyage } from './helpers/cases-chill.mjs';

// seed 3 here; seeds 1 and 2 run in the slow lane (tests/slow/navigator-night.slow.mjs)
nightVoyage(3);
