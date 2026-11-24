// The day clock's glue on a live v2 page (v1's Sail, three-free modules as they are):
//   the time menu      src/ui/timeMenu.js: the top bar's clock opens it (Dawn · Midday · Golden hour · Night · Fireworks); a pick
//                      is a jump, always forward (hourJump), on v2's clock (engine/clock.js setHour), under a short fade (below)
//   the night sky      v1's night-sky sighting (src/ui/nightMoment.js: the band's level at 0.8 or more, held 6 s, a clear sky,
//                      no storm): "The stars come out…" once a night in the bar's event line, quietly. Sail's clock has no
//                      quick night (engine/clock.js sailSchedule), so "The night passes…" is gone (owner, 2026-11-15)
//   the fireworks      a time event (owner, 2026-11-15: "Fireworks is a time-based event independent of the boat and
//                      everything"): nothing here touches the clock, the boat, the camera or the words for the show; the
//                      show keeps its own clock (living/fireworksPlugin.js, sim/fireworks.js liveShowClock). No target either:
//                      the small chart's "Fireworks" destination at the viewing spot (from 20:15 until the show was over) is gone
//                      (owner, 2026-11-18: "it seems the code sets a target destination; no need to do that": the chart's
//                      destination was the passage's target, so it lit the beacon and AUTO's mark, and it cleared the player's own)
//   the jump           every pick (the four hours and Fireworks; owner, 2026-11-18: "jump straight there with a short fade"):
//                      the veil fades to dark over FADE.outS real s, the clock is set straight to the next occurrence of the
//                      hour (one cut, setHour: no hour in between is ever drawn, so no daylight flash when Fireworks is picked
//                      at night; it replaced the Fireworks glide, which ran a whole day through the sky in about 1.5 s), one
//                      frame is drawn dark on the new hour, then the veil lifts over FADE.inS real s. Reduced motion, or no
//                      veil on the page: an instant cut. Fireworks lands 10 game s before the first shell (the show clock reads
//                      the cut where it lands, so the show starts clean); a pick out of the show clears it at the cut. No
//                      target, no beacon (owner, 2026-11-18: "When I click Fireworks, I always see a huge beacon beam … no
//                      need to do that"); the player's own target stays as it was
//   const dc = createDayClock({ clock, fireworks, show, stars, say, veil, reduced });
//   dc.menu → viewSwitch's clockMenu ({ rows, current, pick })   dc.step(dt) each real frame in every mode (the fade)
//   dc.update(dt) each real Sail frame (the night-sky line)      dc.switching: a pick's fade is under way
// Pure apart from what it is handed (no DOM): the tests drive it with a fake clock and a fake veil.
import { timeMenu } from '../../src/ui/timeMenu.js';
import { LINES } from '../../src/fireworks/evening.js';
import { feature } from '../../src/core/features.js';

export const STARS_LINE = LINES.lapse;                           // v1's night-sky words: "The stars come out…"
// the pick's fade (real s): to dark, a hold on full dark before the cut (the veil's CSS transition done), back in
export const FADE = Object.freeze({ outS: 0.35, holdS: 0.05, inS: 0.45 });

// v1's night moment's numbers (src/ui/nightMoment.js NIGHT_MOMENT: minLevel, waitS, maxCoverage; not imported, it reaches the
// first visit's director and the metrics)
export const NIGHT_SKY = Object.freeze({ minLevel: 0.8, waitS: 6, maxCoverage: 0.6, rearm: 0.2 });
// v1's night-sky sighting as a cue (src/ui/nightMoment.js nightReady, the words only: no camera): on once the band's level
// has held at minLevel for waitS real s under a clear sky (deck coverage at most maxCoverage, no storm); once a night (it
// re-arms by day: the sun up, or without a sun the band under 0.2).
//   const cue = starsCue(); each frame: cue.step(dt, { band, coverage, storm, sun }) → true on the frame it fires
export function starsCue(o = {}) {
  const { minLevel, waitS, maxCoverage, rearm } = { ...NIGHT_SKY, ...o };
  let held = 0, done = false;
  return {
    get done() { return done; },
    step(dt, { band = 0, coverage = 0, storm = false, sun = null } = {}) {
      if (sun != null ? sun > 0 : band < rearm) { done = false; held = 0; return false; }   // the day (a full moon may dim the band under rearm: the sun says)
      if (band < rearm) { held = 0; return false; }
      if (done) return false;
      held = band >= minLevel && coverage <= maxCoverage && !storm ? held + Math.max(0, dt) : 0;
      if (held >= waitS) { done = true; return true; }
      return false;
    },
  };
}

// clock: engine/clock.js; fireworks: true when the page has the show (the July 4th day); show() the show's clock now (show s,
// or null outside its window: the plug-in's showT); stars() { band, coverage, storm, sun } (the night's levels) or null; cue: the
// night-sky line (not under an explicit ?timerate); say(text) the bar's event line; veil(opacity, secs): the page's dark veil
// (v2/ui/seamanship.js, the sunrise's), null: a pick cuts at once; reduced(): the OS asks for reduced motion (an instant cut);
// on(name): the feature registry's row (the Fireworks pick and its ✳ are there only where it is on; a phone has none)
export function createDayClock({ clock, fireworks = false, show = () => null, stars = () => null, cue = true, say = () => {}, veil = null, reduced = () => false, on = (name) => feature(name).on } = {}) {
  // the menu on v2's clock: v1's timeMenu reads unwrapped hours (hourJump keeps the day and the wind's history running forward);
  // under a fade the pick's target waits for the dark (held), then one cut
  let held = null;   // { h } while a pick is decided but not yet cut
  const menuClock = { hourAt: (t) => clock.hourUnwrappedAt(t), setHour: (h, t) => { if (held) held.h = h; else clock.setHour(h, t); } };
  // the Fireworks row: lit while the show plays; a pick is a cut to 10 game s before it (src/features/timeRows.js), nothing else
  const phase = () => { const t = show(); return t != null && t >= 0 ? 'show' : null; };
  const fwSvc = fireworks ? { get phase() { return phase(); }, invite: () => {} } : null;
  const menu0 = timeMenu({ clock: menuClock, simT: () => clock.t, hour: () => clock.hour, fireworks: () => fwSvc });
  // the fade: null, or { phase: 'out' | 'in', s: real s in the phase, h: the target (unwrapped hours), lift: the veil not yet lifted }
  let fade = null;
  const fading = () => !!veil && !reduced();
  // the cut, never back: a target the clock passed during the fade (a pick a few game s ahead) lands where the clock is
  const cutNow = (h) => { const now = clock.hourUnwrappedAt(clock.t); clock.setHour(Math.max(h, now), clock.t); };
  // a feature's row shows only where the feature is on (src/core/features.js: no Fireworks on a phone; owner, 2026-11-19), read through
  // the registry, never a device check; the picks of an off feature's row do nothing
  const rows = menu0.rows.filter((r) => r.id !== 'fireworks' || on('fireworks'));
  const menu = { ...menu0, rows, pick(id) {
    if (!rows.some((r) => r.id === id)) return null;
    if (!fading()) {   // an instant cut (a fade under way ends here: its target dropped, the veil off at once)
      if (fade) { if (fade.phase === 'out') cutNow(fade.h); veil?.(0, 0); fade = null; }
      return menu0.pick(id);
    }
    held = { h: null };
    let out, h = null;
    try { out = menu0.pick(id); } finally { h = held.h; held = null; }
    if (h != null) {
      if (fade?.phase === 'out') fade.h = h;   // a second pick in the fade-out: the new target, the same dark
      else { fade = { phase: 'out', s: 0, h, lift: false }; veil(1, FADE.outS); }   // a pick in the fade-in: dark again from where it is
    }
    return out;
  } };
  const sky = starsCue();
  const lines = [];
  return {
    menu, lines, sky,
    get switching() { return !!fade; },
    get fade() { return fade ? { phase: fade.phase, s: fade.s } : null; },
    // the pick's fade, each real frame in every mode, before the frame draws: the cut's frame draws the new hour under full dark
    step(dt) {
      if (!fade || !(dt >= 0)) return;
      fade.s += dt;
      if (fade.phase === 'out') {
        if (fade.s >= FADE.outS + FADE.holdS) { cutNow(fade.h); fade = { phase: 'in', s: 0, h: fade.h, lift: true }; }
        return;
      }
      if (fade.lift) { fade.lift = false; fade.s = 0; veil?.(0, FADE.inS); return; }   // one frame drawn dark on the new hour, then up
      if (fade.s >= FADE.inS) fade = null;
    },
    update(dt) {
      if (!(dt >= 0)) return;
      const s = cue ? stars() : null;
      if (s && sky.step(dt, s)) { say(STARS_LINE); lines.push({ text: STARS_LINE, hour: +clock.hour.toFixed(3) }); }
    },
  };
}
