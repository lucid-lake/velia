// The page's mode switch (Sail | Cruise | Regatta), out of main.js so its rules are tested (v2/tests/mode-switch.test.mjs). What
// v1's shell does on a switch (src/shell.js switchMode: a new mode from the boat's pose, the controls re-applied from the
// settings, the day clock to the mode's), on v2's one boat:
//   go('cruise')    Cruise sails from where she is (MODE-6, owner 2026-11-14: v1 passes start=x,z&heading=); after a hand-over
//                   (handed) it is the hand-back in place (MODE-8); a race is left first
//   go('sail')      the race left (the boat stays), Cruise left quietly with a fresh boat where she is (MODE-6), Pro from the
//                   setting (MODE-5), Sail's day clock again
//   go('regatta')   Cruise left quietly with no hand-over (MODE-2, -4: no line, no Pro, ` does not hand back), the race at real
//                   time (MODE-3: v1's timeRate 1 unless ?timerate), Pro from the setting
//   swap()          the top bar's Sail ⇄ Cruise button (owner, 2026-11-18; its ` key went on 2026-11-20): in place, the same boat (no place, no reset of
//                   her speed, no fade): Sail → Cruise is the hand-back's path (Cruise's skipper picks the trim up as it is, the camera
//                   eases from the view on screen); Cruise → Sail is the hand-over. A race is left through go('cruise') as before
//   race(), leaveRace()  the Menu card's Leave race: a race on the water ({ live }) or null; leaving it is go('sail')
//   speed()         the sim seconds a live second runs: Cruise's while it sails, the race's while it runs, else Sail's (MODE-1)
//   backquote()     what the ` key did (no key now; the buttons call it): in Cruise the helm; after a hand-over the hand-back; else Cruise
//   const M = createModeSwitch({ initial, P, flags, clock, ready, chunks: { <id>: { load, get } } (each chunk mode's controller),
//     ui: () => sailUi, settings: () => store, onMode, target: window })
import { DEFAULT_TIMERATE } from '../../src/sim/timeOfDay.js';
import { sailSchedule } from '../engine/clock.js';
import { modeRow, chunkRows, swapRow, homeId } from '../engine/modes.js';   // the mode table: enter, leave, clock, Pro per row   // Sail's day clock: no quick night (owner, 2026-11-15)

const has = (v) => v != null && v !== '';

// Sail's day clock again (v1's daysail coreOptions: its schedule at base DEFAULT_TIMERATE, or a constant rate under ?clock=flat);
// ?timerate holds the URL's rate in every mode, and a frozen clock stays frozen
export function sailClock(clock, flags = {}) {
  if (!clock || clock.mode === 'frozen' || has(flags.timerate)) return false;
  if (clock.mode === 'rate') clock.setRate(DEFAULT_TIMERATE, clock.t); else clock.setSchedule?.(sailSchedule(), clock.t);
  return true;
}
// the race's: real time (v1's regatta coreOptions timeRate 1: a 5-minute race moves the sun 5 minutes)
export function raceClock(clock, flags = {}) {
  if (!clock || clock.mode === 'frozen' || has(flags.timerate)) return false;
  clock.setRate(1, clock.t);
  return true;
}
// Pro as a fresh Sail takes it (v1's shell applyControls): ?pro wins, else Setup's proMode
export function proWanted(flags = {}, settings = null) {
  if (flags.pro != null) return flags.pro === '1' || flags.pro === true;
  return !!settings?.get?.('proMode');
}

export function createModeSwitch({ initial = homeId(), P = {}, flags = {}, clock = null, B = null, ready = Promise.resolve(), chunks = {},
  ui: getUi = () => null, settings: getSettings = () => null, onMode = () => {}, target = null } = {}) {
  let mode = initial;
  const set = (m) => { mode = m; onMode(m); };
  const pose = () => { const s = B?.state; return s ? { x: s.x, z: s.z, headingDeg: s.heading * 180 / Math.PI } : null; };
  const pro = () => { const u = getUi(); if (u?.setPro) u.setPro(proWanted(flags, getSettings())); };
  // each chunk mode's controller: the page's loader and getter (chunks[id]: { load, get }), else the row's own chunk (a stub's)
  const own = {};
  const getK = (R) => (chunks[R.id]?.get ? chunks[R.id].get() : own[R.id] ?? null);
  const loadK = (R) => (chunks[R.id]?.load ? chunks[R.id].load() : Promise.resolve(R.chunk()).then((k) => (own[R.id] ??= k)));
  const liveRace = () => { for (const R of chunkRows()) if (R.race) { const k = getK(R); if (k?.on) return k; } return null; };
  const S = () => swapRow();
  const M = {
    get current() { return mode; }, now: () => mode,
    landed(m) { set(m); },   // a mode tells the page it has the boat (Cruise's setMode, the race's enter, the hand-over)
    // a race on the water is left first (the boat stays, Sail's day clock again); then every other loaded mode leaves (its row's
    // leave: Cruise's quiet one for a race, a fresh one otherwise); then the row's enter, its clock, Pro from the setting
    async go(id, opts) {
      const to = modeRow(id);
      let wasRace = false;
      for (const R of chunkRows()) if (R.race) {
        const k = getK(R); if (!k?.on) continue;
        wasRace = true;
        if (R.id !== id) { R.leave(k, to); sailClock(clock, flags); mode = homeId(); }
      }
      if (!to || (to.needsBoat && !B)) return true;
      for (const R of chunkRows()) if (R.id !== id && !R.race) { const k = getK(R); if (k) R.leave(k, to); }
      if (to.enter) await to.enter(getK(to), { get: () => getK(to), load: () => loadK(to), ready, wasRace, pose, opts });
      if (to.clock === 'race') raceClock(clock, flags);   // MODE-3
      if (to.pro) pro();   // MODE-5
      if (!to.chunk) set(id);   // a chunk mode says it has the boat itself (landed)
      return true;
    },
    // Leave race (owner, 2026-11-20): the Menu card's row. race() → null (no race on the water: Sail, Cruise, Regatta's hub) or
    // { live } (live: the race is in progress, not yet finished: the row asks first); leaveRace() → home (Sail) where she is (the
    // race left: the rivals, marks and lines gone, nothing recorded)
    race() { const r = liveRace(); return r && !r.hubOpen ? { live: !!r.inProgress } : null; },
    leaveRace() { if (!liveRace()) return false; M.go(homeId()); return true; },
    // MODE-1: a mode's speed only while it sails (Cruise's was asked whenever its chunk was in, so a race after Cruise ran at 2 ×)
    speed() {
      for (const R of chunkRows()) { const k = getK(R); if (k?.on) return k.speed(); }
      return P.speed;
    },
    // the in-place switch with the swap row (Cruise): 'helm' (Cruise → Sail), its id (Sail → Cruise), null in a race (no button there)
    swap() {
      const c = getK(S());
      if (liveRace()) return null;
      if (c?.on) return c.takeHelm({}) ? 'helm' : null;
      if (c?.handed && c.handBack?.()) return 'handback';
      (async () => { await ready; const k = await loadK(S()); if (!k.on) await k.enter({ fresh: false }); })().catch((e) => console.error(e));
      return S().id;
    },
    // the chunk and its lake load before the first press (a hover, a focus, a touch on the button)
    warm() { chunks[S().id]?.load?.()?.catch?.(() => {}); },
    backquote() {
      const c = getK(S()), r = liveRace();
      if (c?.on) return c.takeHelm({}) ? 'helm' : null;
      if (c?.handed && !r) return c.handBack() ? 'handback' : null;
      if (r) { M.go(S().id); return S().id; }
      return M.swap();
    },
  };
  // (no ` key on the page since the lean key set,: the top bar's Cruise ⇄ Sail button is the way)
  return M;
}
