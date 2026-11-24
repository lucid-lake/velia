// The slow lane: Sail's determinism record for the other wind seeds, the live path and the pure Simulation (the fast suite
// runs seed 1: tests/sim-sail.test.mjs).
import { runSail, replaySail } from '../helpers/sim-sail.mjs';
import { liveCase, pureCase } from '../helpers/cases-sim.mjs';

for (const seed of [2, 3]) { liveCase('sail', seed, runSail); pureCase('sail', seed, runSail, replaySail); }
