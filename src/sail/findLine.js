// What a logbook find says in play (owner, 2026-11-07: no navy toast; a notice is the subtitle line or the watermark, and the
// book is mostly silent). The policy and its queue, pure so a node test can drive it:
//   - the first announced find of a session teaches the book: "The island — added to your logbook (L)" (no cap on touch);
//   - a NOTABLE find (rare or beautiful) gets a quiet line "The waterfall — in the logbook"; every other find is saved
//     silently (the warm wood note the find already plays is its only sound);
//   - at most MAX_LINES lines a session (the target is 2 to 3), GAP_S apart;
//   - never at a bad moment: a line waits while busy() (a note, status or keep line, mid-tack or gybe) or while show() refuses
//     (the staged first minutes' hush); a line that found no moment in MAX_WAIT_S is dropped, never said late.
//   const q = createFindLine({ show, busy, now }); q.push({ id, name, first }); q.tick();  // tick each frame
export const NOTABLE = new Set(['waterfall', 'ruin', 'house', 'light', 'narrows', 'sunset', 'milkyway']);   // said quietly
export const ROUTINE = new Set(['island', 'harbour', 'gust', 'tack', 'round', 'sail', 'anchor', 'aground']);   // saved silently (the island is said only as a session's first find)
export const GAP_S = 7;          // between two lines (the staged first visit's STAGE.lineGapS)
export const MAX_WAIT_S = 20;    // a find said later than this is stale
export const MAX_LINES = 3;      // per session
export const KEY = 'L';

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const findText = (name, { teach = false } = {}) => `${cap(name)} — ${teach ? 'added to your logbook' : 'in the logbook'}`;

export function createFindLine({ show, busy = () => false, now = () => performance.now() / 1000, key = () => KEY } = {}) {
  const queue = [];
  let lastAt = -Infinity, spoken = 0, taught = false;
  return {
    push(find) {
      // the first find of the session always speaks (it teaches the book); later ones only if notable
      if (!find.hold && taught && !NOTABLE.has(find.id)) return false;   // hold: a probe's pinned line
      if (!find.hold && spoken + queue.length >= MAX_LINES) return false;
      queue.push({ ...find, at: now(), teach: !taught && !queue.some((q) => q.teach) });
      return true;
    },
    tick() {
      const t = now();
      while (queue.length && t - queue[0].at > MAX_WAIT_S) queue.shift();
      if (!queue.length || t - lastAt < GAP_S || busy()) return false;
      const f = queue[0];
      if (show(findText(f.name, { teach: f.teach }), { key: key(), secs: f.hold ? 3600 : f.teach ? 8 : 5 })) {
        queue.shift(); lastAt = t; spoken++; if (f.teach) taught = true; return true;
      }
      return false;
    },
    clear() { queue.length = 0; },
    get pending() { return queue.length; },
    get spoken() { return spoken; },
  };
}
