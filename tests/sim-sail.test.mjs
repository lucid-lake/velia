// Sail's live path (the real controls in node, a scripted 120 s) and the pure Simulation on its inputs both reproduce
// main's run tick for tick (tests/helpers/cases-sim.mjs).
import { runSail, replaySail } from './helpers/sim-sail.mjs';
import { liveCase, pureCase } from './helpers/cases-sim.mjs';

liveCase('sail', 1, runSail);
pureCase('sail', 1, runSail, replaySail);
