// The slow lane: Sail's snapshot gate for wind seeds 2 and 3 (the fast suite runs seed 1: tests/sim-snapshots.test.mjs).
import { runSail, replaySail } from '../helpers/sim-sail.mjs';
import { snapshotCase } from '../helpers/sim-snapshots.mjs';

for (const seed of [2, 3]) snapshotCase('sail', seed, runSail, replaySail);
