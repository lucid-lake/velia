// Tapping Cruise, Sail or Regatta on the home card enters that mode (fix/card-enter). Pure; tests/cardEnter.test.mjs.
//   const E = createEnter({ ready, enter, queued });
//   E.pick(mode)    // ready: enter(mode) now. Loading: remember the pick and call queued(mode) (the card lights it and says so).
//   E.flush(due)    // the card went live: enter the remembered pick, unless `due` (the first-visit welcome comes first: the pick is dropped).
//   E.mode          // the queued mode, or null
// One entry per page load: once enter() has run, later picks and flushes do nothing.
export function createEnter({ ready, enter, queued = () => {}, dropped = () => {} }) {
  let want = null, entered = false;
  return {
    get mode() { return want; },
    get entered() { return entered; },
    pick(mode) {
      if (entered) return false;
      if (ready()) { entered = true; want = null; enter(mode); return true; }
      want = mode; queued(mode); return false;
    },
    flush(due = false) {
      if (entered || !want) return false;
      const m = want; want = null;
      if (due) { dropped(m); return false; }
      entered = true; enter(m); return true;
    },
  };
}
