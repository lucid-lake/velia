// The slow lane: Cruise's snapshot gate, seeds 1–3 (tests/helpers/sim-snapshots.mjs; its own process: the real lake).
import { runCruise, replayCruise } from '../helpers/sim-cruise.mjs';
import { snapshotCase } from '../helpers/sim-snapshots.mjs';

for (const seed of [1, 2, 3]) snapshotCase('cruise', seed, runCruise, replayCruise);
