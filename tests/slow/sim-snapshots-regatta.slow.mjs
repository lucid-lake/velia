// The slow lane: Regatta's snapshot gate, seeds 1–3 with their tiers (tests/helpers/sim-snapshots.mjs).
import { runRegatta, replayRegatta } from '../helpers/sim-regatta.mjs';
import { snapshotCase } from '../helpers/sim-snapshots.mjs';

for (const seed of [1, 2, 3]) snapshotCase('regatta', seed, runRegatta, replayRegatta);
