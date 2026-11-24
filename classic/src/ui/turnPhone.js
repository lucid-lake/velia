// "Turn your phone for the full cockpit" (feat/cockpit-phone, stage 3; owner 2026-11-06: phones, landscape-first, never a blocking
// rotate screen). An upright phone keeps its compact helm; the first time someone sails upright, the skipper's line says once that
// the phone held sideways has the whole cockpit (skipper.js NOTES.turnPhone). Remembered in this browser once it was really on the
// line, never said again; nothing on a desktop, a tablet or a phone already sideways.
//   const tl = createTurnLine({ storage, say: (note) => hint.note(…), shown: () => hint.el.textContent });
//   tl.update(dt, { kind, sailing, able });   // each frame: kind (device.js), sailing (the helm is up), able (the cockpit exists sideways)
// Pure parts: turnLineDue (tests/cockpitPhone.test.mjs).
export const TURN_KEY = 'lakeshore.turnphone.v1';
export const TURN = { afterS: 2.5, retryS: 8 };   // a breath after the helm shows; said again if another line took its place unseen

// is the line due now: an upright phone, sailing, the cockpit there to turn to, not yet seen
export const turnLineDue = ({ kind, sailing = false, able = true, seen = false } = {}) => kind === 'phone-port' && !!sailing && !!able && !seen;

export function createTurnLine({ storage = globalThis.localStorage ?? null, say = () => false, shown = () => '', text = '' } = {}) {
  let seen = false;
  try { seen = storage?.getItem(TURN_KEY) === '1'; } catch { /* no storage: once this page */ }
  let upFor = 0, saidAt = null, t = 0;
  const words = String(text).replace(/\{(?:[^|}]*\|)*([^}|]*)\}/g, '$1').slice(0, 24);   // the line's start, as the subtitle shows it
  const mark = () => { seen = true; try { storage?.setItem(TURN_KEY, '1'); } catch { /* this page only */ } };
  function update(dt, { kind, sailing, able = true } = {}) {
    t += dt;
    if (seen) return false;
    if (saidAt != null && words && String(shown() ?? '').includes(words)) { mark(); return true; }   // it is on the line: remembered
    if (!turnLineDue({ kind, sailing, able, seen })) { upFor = 0; return false; }
    upFor += dt;
    if (upFor < TURN.afterS || (saidAt != null && t - saidAt < TURN.retryS)) return false;
    if (say()) saidAt = t;
    return false;
  }
  return { update, get seen() { return seen; }, get said() { return saidAt != null; } };
}
