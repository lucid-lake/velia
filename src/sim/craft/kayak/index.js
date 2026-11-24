// The kayak (refactor round 2, Phase C step 5): the craft row src/craft/index.js lists. Step 5 gives it its physics (the
// fleet's hull model); its body, cameras, station, audio (createAudio, step 10's seam) and lessons (a `lessons` set) are later work.
import { createPhysics, restorePhysics, KAYAK_INPUTS } from './physics.js';

export const craft = Object.freeze({ id: 'kayak', kind: 'paddle', inputs: KAYAK_INPUTS, createPhysics, restorePhysics });
