// The sail lesson set (refactor round 2, Phase C step 10; src/lessons/index.js): the sloop's skills, the sailor's
// words (ui/words.js), the old skipper's notes and the quiet hint line. The modules stay where they
// are; this row only names them, so the sloop's lessons are exactly today's.
import { createSkills, SKILLS } from '../../../src/sail/skills.js';
import { createWords, TERMS } from '../../../src/ui/words.js';
import { NOTES } from '../../../src/ui/skipper.js';
import { createControlsHint } from '../../../src/ui/controlsHint.js';

export const sail = Object.freeze({ id: 'sail', skills: SKILLS, terms: TERMS, notes: NOTES, createSkills, createWords, createHint: createControlsHint });
