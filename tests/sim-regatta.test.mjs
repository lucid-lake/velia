// Regatta's session (both boats sailed by the AI, 120 s) and the pure Simulation's fleet on its inputs both reproduce
// main's run tick for tick, both boats (tests/helpers/cases-sim.mjs).
import { runRegatta, replayRegatta } from './helpers/sim-regatta.mjs';
import { liveCase, pureCase } from './helpers/cases-sim.mjs';

liveCase('regatta', 1, runRegatta);
pureCase('regatta', 1, runRegatta, replayRegatta);
