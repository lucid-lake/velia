// The fireworks show off the boot path (perf/v2-phone-load, owner OK 2026-11-15). The show script (src/fireworks/show.js
// makeShow, stage.js wowShow) cost ≈ 2 s of v2's 2.6 s world build on a phone (4× CPU), on every load, though it plays
// only on its evening. Now it is made when a page needs it:
//   'now'   the show clock runs (the page is in the show's window, or ?fwt pins it): made at once, before the frame that
//           uses it (a capture's prime too, so captures stay deterministic: the same script whenever it is made)
//   'soon'  the evening is near (the day clock may reach the window): made in an idle slice, before it is due
//   null    any other hour: not made
// The script is pure (seeded, no clock), so a show made late is the same show, event for event.
//   showNeed({ t, hour }) → 'now' | 'soon' | null
//   const L = createLazy(build, { idle }); L.get() (made once), L.soon() (made in an idle slice), L.built
export const PREP_HOURS = Object.freeze([20, 23.5]);   // the evening: from 20:00 (the barges are out at 20:30, the window opens 21:04) to the barges' last hour

export function showNeed({ t = null, hour = 12 } = {}) {
  if (t != null) return 'now';
  return hour >= PREP_HOURS[0] && hour < PREP_HOURS[1] ? 'soon' : null;
}

const defaultIdle = (fn) => (typeof globalThis.requestIdleCallback === 'function' ? globalThis.requestIdleCallback(() => fn(), { timeout: 2000 }) : setTimeout(fn, 0));

export function createLazy(build, { idle = defaultIdle } = {}) {
  let value, done = false, queued = false;
  const get = () => { if (!done) { value = build(); done = true; } return value; };
  return {
    get,
    soon() { if (done || queued) return; queued = true; idle(() => { queued = false; get(); }); },
    get built() { return done; },
    get queued() { return queued; },
  };
}
