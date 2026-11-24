// The lesson sets by craft (refactor round 2, Phase C step 10): what a
// craft teaches and how its hint line speaks. A craft row names its set (src/craft/<id>/index.js `lessons: 'sail'`); the
// craft's controller builds its skill model, its sailor's words, its hint line and its skipper's notes from the set, never
// from the sail modules by name, so a kayak brings its own set (its skills, terms and three lines) beside the sail one.
//   lessonsFor(craft)  the set the craft names; throws when it names none or an unknown one (the message a new craft meets)
//   lessonsById(id)    the set by its id
// A set: { id, skills, terms, notes, createSkills({ storage }), createWords({ storage, skills, mode }), createHint(o) }
//   skills  the skill rows (src/sail/skills.js SKILLS)       terms  the sailor's words (src/ui/words.js TERMS)
//   notes   the skipper's one-off lines by id (src/ui/skipper.js NOTES: { text, speak })
//   createHint  the quiet hint line (src/ui/controlsHint.js createControlsHint: the same options)
import { sail } from './sail.js';

export const LESSONS = Object.freeze({ sail });

export function lessonsById(id) {
  const set = typeof id === 'string' && Object.hasOwn(LESSONS, id) ? LESSONS[id] : null;
  if (!set) throw new Error(`lessons: no lesson set '${id}' (one of ${Object.keys(LESSONS).join(', ')})`);
  return set;
}

export function lessonsFor(craft) {
  if (!craft?.lessons) throw new Error(`lessons: no lesson set for craft '${craft?.id}'`);
  return lessonsById(craft.lessons);
}
