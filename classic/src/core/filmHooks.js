// The film contract's step hooks (?film=1: tools/film/run.mjs). A mode provides the 'film'
// service { state, pose, step(dt) }; a feature that must move with each film frame (the kayak fleet, src/kayaks/fleet.js)
// adds itself to its onStep list instead of replacing step.
//
//   services.provide('film', withStepHooks({ state, pose, step(dt) { … } }))   the modes (Sail's capture, Cruise, Regatta)
//   const off = film.onStep((dt) => …)                                         after each film step, in the order added
export function withStepHooks(film) {
  const hooks = [], step = film.step;
  film.step = (dt) => { const s = step(dt); for (const f of hooks) f(dt); return s; };
  film.onStep = (fn) => { hooks.push(fn); return () => { const i = hooks.indexOf(fn); if (i >= 0) hooks.splice(i, 1); }; };
  return film;
}
