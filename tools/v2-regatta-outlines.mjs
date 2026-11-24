// Bakes the Regatta course cards' art: each shipped course's outline, drawn from its JSON (one lap, at
// its design wind: the first beat up the card) by the hub's own drawing (v2/regatta/hub.js courseSvg), into
// v2/regatta/outlines.json. The Custom sheet's course cards and its preview read the file, so no card is drawn from the course
// at run time. Re-run after a course JSON changes; v2/tests/regatta-custom.test.mjs fails while the file is stale.
//   node tools/v2-regatta-outlines.mjs          write v2/regatta/outlines.json
//   node tools/v2-regatta-outlines.mjs --check  exit 1 when the file differs from a fresh bake
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { courseFor, courseIds } from '../src/sim/race/course.js';
import { courseSvg } from '../v2/regatta/hub.js';

export const OUT = fileURLToPath(new URL('../v2/regatta/outlines.json', import.meta.url));
export const CARD = Object.freeze({ w: 240, h: 150, pad: 18 });   // the card's art (letters 15 px at this size)
export const MINI = Object.freeze({ w: 96, h: 64, pad: 7 });      // a phone row's thumbnail: no letters

export function bake(waters = ['tahoe-emerald']) {
  const out = {};
  for (const w of waters) {
    out[w] = {};
    for (const id of courseIds(w)) {
      const c = courseFor(w, id, { laps: 1 });
      out[w][id] = { name: c.name, card: courseSvg(c, { ...CARD, labels: true, stroke: 1.5 }), mini: courseSvg(c, { ...MINI, labels: false, stroke: 1.3 }) };
    }
  }
  return out;
}
export const bakeText = () => `${JSON.stringify(bake(), null, 1)}\n`;

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const text = bakeText();
  if (process.argv.includes('--check')) {
    let now = ''; try { now = readFileSync(OUT, 'utf8'); } catch { /* none yet */ }
    if (now !== text) { console.error('outlines.json is stale: run node tools/v2-regatta-outlines.mjs'); process.exit(1); }
    console.log('outlines.json is current');
  } else { writeFileSync(OUT, text); console.log(`wrote ${OUT}`); }
}
