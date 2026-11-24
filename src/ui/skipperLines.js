// Every line the old skipper can say aloud, derived from the code that shows it, so a new hint without
// a clip fails tests/skipperVoice.test.mjs. Used by the render tool (tools/skipper_lines.mjs) and the tests, not the page.
//
//   allLines()  → [{ hash, text, ids }]: every distinct spoken text, in table order; ids name where it comes from
//                 ('pull.keys.plain', 'pull.pointer.sailor', 'note.fast', …). The mouse and the touch share the
//                 pointer's wording; a gamepad reads the keys'. Equal texts are one clip.
import { NOTES } from './skipper.js';
import { LEADS } from './skipper.js';
import { createWords } from './words.js';
import { MOUSE } from './controlsHint.js';
import { hashText, lineText } from './skipperText.js';
export { hashText, lineText };

export const LEVELS = {
  plain: () => createWords({ skills: { mastered: () => false, pro: false } }),
  sailor: () => createWords({ skills: { mastered: () => true, pro: false } }),
};
// the hints the box can show (controlsHint.js HINTS; 'closer' is the second half of 'look')
export const HINT_NAMES = [...Object.keys(LEADS), 'chart', 'wind', 'look', 'whisper'];

export function allLines() {
  const byHash = new Map();
  const add = (id, text) => {
    if (!text) return;
    const h = hashText(text);
    if (!byHash.has(h)) byHash.set(h, { hash: h, text, ids: [] });
    byHash.get(h).ids.push(id);
  };
  for (const [lvl, make] of Object.entries(LEVELS)) {
    const w = make();
    for (const n of HINT_NAMES) for (const mouse of [false, true]) add(`${n}.${mouse ? 'pointer' : 'keys'}.${lvl}`, lineText(n, w, { mouse, mouseHtml: MOUSE[n] }));
  }
  for (const [id, n] of Object.entries(NOTES)) add(`note.${id}`, n.speak);
  return [...byHash.values()];
}
