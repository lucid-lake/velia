// The sloop's physics factory (refactor round 2, Phase C step 5): src/boat.js BoatPhysics, built and restored exactly as
// the Simulation built it before the craft seam, so a sloop's ticks and snapshots keep every byte.
import { BoatPhysics } from '../../boat.js';
import { assign } from '../plain.js';

export const createPhysics = (o) => new BoatPhysics(o);
// into a fresh BoatPhysics: the snapshot's plain fields set, the cues and the engine keep their classes
export const restorePhysics = (data, params, vessel) => assign(new BoatPhysics({ params, vessel }), data);
