// The slow lane: Cruise's determinism record for the other seeds, the live path and the pure Simulation (the fast suite
// runs seed 1: tests/sim-cruise.test.mjs).
import { runCruise, replayCruise } from '../helpers/sim-cruise.mjs';
import { liveCase, pureCase } from '../helpers/cases-sim.mjs';

for (const seed of [2, 3]) { liveCase('cruise', seed, runCruise); pureCase('cruise', seed, runCruise, replayCruise); }
