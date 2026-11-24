// The features' Setup rows (the pure half of src/features/index.js; Velia v2's front door, 2026-11-13): what each feature
// adds to the home card's Setup page, and on which pages it shows. src/features/index.js spreads each entry into its row
// (one source); the home card (src/ui/home.js) reads featureSettings from here, so it reaches no feature code and Velia v2
// (v2/, no three.js) can mount the card. Same rules as index.js's rows:
//   shown     (flags) → bool: its Setup rows show on this page
//   settings  [{ tab, key, label, radio: [[value, word], …] } | { tab, toggleIn, key, label }] Setup rows (homePages.js)
import { kayaksOn } from '../sim/kayaks/on.js';
import { feature } from '../core/features.js';   // the registry: no radio row where the show is off (a phone; owner, 2026-11-19)

// in src/features/index.js's row order (the Setup page lists them in this order)
export const FEATURE_SETUP = {
  // the kayaks on the lake: the camera notice's switch, with the kayaks on (the default; not with ?kayaks=0:, § 11)
  kayakFleet: {
    shown: (flags) => kayaksOn(flags.kayaks),
    settings: [{ tab: 'sail', key: 'kayakCam', label: 'camera to kayaks', radio: [['kayakCam:on', 'on'], ['kayakCam:off', 'off']] }] },
  // the boat's radio: the Sousa marches on the fireworks evening (src/fireworks/music.js)
  fireworks: {
    shown: (flags, on = () => feature('fireworks').on) => !!flags.fireworks && on(),
    settings: [{ tab: 'sound', toggleIn: 'sound', key: 'boatRadio', label: 'radio' }] },
};

// the Setup rows the features contribute on this page (src/ui/homePages.js pagesHtml rows); the same list as
// src/features/index.js featureSettings(flags) (tests/features.test.mjs)
export const featureSettings = (flags, list = Object.values(FEATURE_SETUP)) => list.filter((f) => f.settings && (!f.shown || f.shown(flags))).flatMap((f) => f.settings);
