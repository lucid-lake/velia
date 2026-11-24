// The sloop (refactor round 2, Phase C step 5): the craft row src/craft/index.js lists. Step 5 gives it its physics,
// step 7 its camera settings (cameras.js), step 10 its own sound (audio.js: createAudio(core), called by the hull frame on
// a live page) and its lesson set (lessons: 'sail', src/lessons/index.js: the skills, words, hints and skipper's notes the
// sail controller builds); the station (step 9) joins it later.
import { CONTROLS } from '../../boat.js';
import { createPhysics, restorePhysics } from './physics.js';
import { cameras } from './cameras.js';
import { createAudio } from './audio.js';

export const craft = Object.freeze({ id: 'sloop', kind: 'sail', inputs: CONTROLS, createPhysics, restorePhysics, cameras, createAudio, lessons: 'sail' });
