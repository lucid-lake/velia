// Tessie's flag and her live level check. Whether she exists at all is a row of the feature registry
// (src/core/features.js: feature('tessie').on, fixed at load: a desktop at L0-L2, never in a capture unless ?tessie= asks).
//   tessieFlag(flag) -> { set, off?, now?, firstAt? }   flags.tessie: null | '0' | 'off' | '1' | 'on' | 'now' | seconds
//   tessieDraws(level) -> bool                          the live check: the ladder stepped to L3 hides her
const TESSIE_OFF_LEVEL = 3;   // GPU L3 (engine/quality.js LEVELS: the weak phone's path) is off

// the flag's parse lives with the stage (main.js reads it there without fetching this file on a phone)
export { tessieFlag } from '../stage/options.js';

export const tessieDraws = (level) => level < TESSIE_OFF_LEVEL;
