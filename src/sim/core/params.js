// The URL contract the core reads (?hour&cam&seed&exposure&headless …). Deterministic by URL: the capture tool relies on it.
// The modes read their own flags from core.flags (src/modes/README.md); every flag is a row of src/core/flags.js.
import { FLAGS, withFlags } from './flags.js';
import { clamp } from './math.js';

// flags: the page's flags as the core and the modes see them. ?film=1 (tools/film/): a film page is
// a capture page. No HUD, no loop, no menu, no metrics; the film runner steps it frame by frame (Cruise's 'film' service).
// A frozen copy taken at load (FLAGS itself follows the address bar); the modules that read the URL directly (FLAGS) see
// ?film=1 without the implied ?headless.
export let flags = withFlags(FLAGS, FLAGS.film && FLAGS.headless == null ? { headless: '1' } : {});
// the staged first visit (src/main.js, src/ui/firstVisit.js stageParams): its start, heading and fv, before the core boots
export function stageFlags(next) { flags = next; return flags; }

export { clamp };   // src/core/math.js (sky.js and skyFallback.js read it from here)

// ?hour= in local clock hours at Tahoe (PDT, src/place.js); the default is the mode's (fly: 06:30, sun +8.8°; Day Sail: 18:45)
export const hourFor = (defaultHour) => clamp(parseFloat(flags.hour ?? defaultHour), 0, 24);
export const CAM = flags.cam ?? 'A';
export const SEED = parseInt(flags.seed ?? '1', 10);
export const EXPOSURE = flags.exposure;
export const CLOUDS = flags.clouds;
export const LOW_BANK = flags.bank;   // the slope-hugging stratus bank: off by default (crisp and clear), on with weather
// The main cloud deck's look (src/clouds.js): its defaults here, not as URL-flag defaults; ?cloudcov= ?cloudtype=
// ?cloudbase= ?cloudthick= override them (debug and captures)
export const CLOUD_DECK = Object.freeze({ coverage: 0.6, type: 0.35, base: 700, thickness: 900 });
export const COVERAGE = flags.cloudcov ?? CLOUD_DECK.coverage;
export const CLOUD_TYPE = flags.cloudtype ?? CLOUD_DECK.type;
export const CLOUD_BASE = flags.cloudbase ?? CLOUD_DECK.base;
export const CLOUD_THICK = flags.cloudthick ?? CLOUD_DECK.thickness;
export const T0 = flags.t;   // scene time in s (wind and cloud drift); fixed in a capture
// Owner 2026-10-29: the default view is crisp and clear; mist comes with weather (density at y = 0, e-fold height in m).
export const FOG_A = 0.00015, FOG_B = 20;
