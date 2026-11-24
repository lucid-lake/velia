// The slow lane: Regatta's determinism record for the other seeds and tiers, the session and the pure Simulation's fleet
// (the fast suite runs seed 1: tests/sim-regatta.test.mjs).
import { runRegatta, replayRegatta } from '../helpers/sim-regatta.mjs';
import { liveCase, pureCase } from '../helpers/cases-sim.mjs';

for (const seed of [2, 3]) { liveCase('regatta', seed, runRegatta); pureCase('regatta', seed, runRegatta, replayRegatta); }
