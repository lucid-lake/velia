// The sloop's own sound (refactor round 2, Phase C step 10): the craft row's
// createAudio, which the hull frame (src/craft/hull.js) calls on a live page. The boat's sound (src/boatAudio.js: the hull's
// water, the rig and sheets under load, the sails, the wind in the rig) with the same banks and seed as before the seam.
//   createAudio(core) → { update(t, state, o), stats(), … } (src/boatAudio.js createBoatAudio), silent until audio.start();
//   the hull frame calls its dispose() when it has one
// A kayak's createAudio (paddle dips, drips, the hull's slap) slots in beside it; a craft without one is silent.
import { createBoatAudio } from '../../../boatAudio.js';

export const createAudio = (core) => createBoatAudio({ audio: core.audio, base: '/audio/boat/', windUrl: '/audio/wind_strong.opus', seed: core.SEED });
