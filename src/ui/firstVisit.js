// The staged first visit (owner, 2026-11-05; BACKLOG P1 3 "The first minute"): a true first visit goes straight onto
// the lake, no home card and no "How do you sail?". Pure: no DOM, no storage of its own (src/main.js reads the stored
// settings and passes them in), so tests/firstStage.test.mjs drives it.
//
//   decideFirstVisit({ flags, stored, webdriver }) → { stage, why }    once, in src/main.js before the core boots
//   stageParams(flags) → flags                                         the staged start into the URL contract (start, heading, fv): a copy
//
// The staged course (round 2, owner 2026-11-05: start on the clear water): under way over the north shore's granite
// shelf (5–7 m, boulders on the bed, ≈ 300 m north of Fannette), heading 080° across the bay on a broad reach with
// the low sun astern (the bed lit, the camera's back to the glare); the shelf falls away into deep water at ≈ 0:25 of
// play and the course stays in deep water (≥ 10 m) with no shallow-water assist for the first 2:30. In the storm's
// westerly she runs before it. Picked on the real terrain, wind (18:45, level 3, shifts and gust cells) and physics, the
// pilot holding the heading (a search over the bay's 5–8 m water, kept out of git); ±5° of heading keeps it (on the
// shelf ≥ 0:17, deep by ≤ 0:30, least ≈ 4.9 m). The first gust is laid during play (src/ui/firstStage.js).
import { modeId } from '../modeNames.js';
import { toFlags, withFlags } from '../sim/core/flags.js';
export const STAGE_START = { x: 61, z: -406, headingDeg: 80, speed: 2.1 };   // m, m, compass °, m/s (≈ 4 kn, sails full)
export { SETTINGS_KEY } from '../sim/settingsKey.js';   // src/ui/settings.js: any stored settings mean a returning visitor


// Does this page load get the staged first visit? `stored`: the raw stored settings (null when there are none).
// ?first=1 forces it (a test of the flow in any browser), ?first=0 turns it off. Never on a capture, a film, a page
// without the loading card or the menu, an explicit other mode, a pinned start, or an automated browser (the goldens,
// the probes) unless forced.
export function decideFirstVisit({ flags = '', search = flags, stored = null, webdriver = false } = {}) {   // flags: the page's flags (or search: a query string, the tests)
  flags = toFlags(search);
  const first = flags.first;
  if (flags.headless != null || flags.film || flags.noload != null || flags.shot != null || flags.gate != null || !flags.menu) return { stage: false, why: 'capture' };
  if (first === '0') return { stage: false, why: 'off' };
  if (flags.show === 'fireworks') return { stage: false, why: 'show' };   // the share link lands in Cruise at the show (S5)
  const m = flags.mode;
  if (m != null && modeId(m) !== 'sail') return { stage: false, why: 'mode' };
  if (flags.start != null || flags.heading != null) return { stage: false, why: 'pinned' };
  if (first === '1') return { stage: true, why: 'forced' };
  if (flags.welcome != null) return { stage: false, why: 'welcome' };
  if (webdriver) return { stage: false, why: 'automated' };
  if (stored != null && stored !== '') return { stage: false, why: 'returning' };
  return { stage: true, why: 'new' };
}

// the staged start, through the parameters every part already reads (the boat, the stream's start bubble, the bake)
export function stageParams(flags, S = STAGE_START) {
  return withFlags(toFlags(flags), { start: `${S.x},${S.z}`, heading: String(S.headingDeg), fv: true });
}
export const isStaged = (flags) => flags.fv;
