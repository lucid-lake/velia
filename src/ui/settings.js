// The menu's settings, kept per browser (localStorage 'lakeshore.settings.v1'; a private window keeps
// them in memory). The shell (src/shell.js) applies them to the running mode; the URL's own flags (?pilot=0, ?hand=0)
// still win at the start of a page, as before.
//   const s = createSettings();  s.get('music'); s.set('music', false); s.on((key, value) => …);
export const SETTINGS = {
  sound: true,        // everything (the master)
  music: true,        // the beds, the groove, Cruise's pieces
  effects: true,      // the boat and the controls' sounds
  boatRadio: false,   // the boat's radio: the Sousa marches, quiet, from the cockpit speaker (the fireworks evening, ?fireworks=1; src/fireworks/music.js); off by default
  pilot: true,        // let go of the helm and the pilot holds the course
  autoReef: true,     // the crew reefs for you when the boat heels too far (Settings; was Shift+K)
  gennaker: 'auto',   // the crew flies the gennaker (v2/sim/gennakerCrew.js; Setup › Aids › gennaker): auto | off (round 2, owner 2026-11-21)
  crewTrim: false,    // the crew trims the sheets (Settings; was T); off: your hands on them, the crew's net after 12 s
  vhf: true,          // the VHF radio (owner, 2026-10-30): on by default in Sail and Regatta (the forecast, the harbour master, the race hails); the Pro trim panel's VHF button turns it off and on
  hints: true,        // the quiet controls hints
  shoalAssist: true,  // the shallow-water assist (src/boat/shoalAssist.js): the helm bears away from a shoal, rocks or the shore the boat would hit; only this switch turns it off (not Pro)
  skipperVoice: true, // the old skipper speaks each hint line once (src/ui/skipperVoice.js); off: text only
  words: 'both',      // the sailor's words (ui/words.js): both = plain + sailor's (fading with skill), sailor = sailor's only
  windLines: 'off',   // the beginners' wind lines (src/air.js): on | auto (fade as the player reads the wind) | off; off by default (owner, 2026-10-30)
  quality: 'auto',    // auto | high | balanced | low (QUALITY; src/quality/tiers.js): auto reads the device and measures at start
  display: 'auto',    // auto | day | night: the instruments' palette (auto: red after sunset, src/ui/theme.js)
  kayakCam: false,    // the follow camera swings to frame a kayak passing close (src/kayaks/notice.js; the row shows unless ?kayaks=0); off by default (owner, 2026-11-11: stay on the sailing camera)
  steadyHorizon: true, // the helm view's horizon is steadied a little (the camera cancels 40 % of the heel and pitch)
  largeText: false,   // the UI's type at 1.25× (the --lk-text token)
  keyHints: true,     // the key legend on the right edge (src/ui/keyLegend.js; Settings, Screen, key hints)
  edgeInstruments: 'auto',   // the nav column on the left edge (src/ui/navColumn.js; Setup › Aids › edge instruments): auto (the passage block with a mark, the instruments with Pro and in Regatta) | always | off
  tips: true,         // button tips: an icon button's name and key on a hover or a long-press (src/ui/tips.js; Settings › Screen)
  hud: 'auto',        // auto | full | calm | instruments | clear: the HUD (src/ui/calmHud.js); auto: Calm in Sail and Cruise, Full in Regatta and School ('off' was renamed clear)
  proMode: false,     // Pro mode on at start (the profile "I race", or the pro prompt's one tap; the P key and the Settings row follow it)
  profile: 'new',     // the first-visit profile (src/ui/profile.js): new | sail | race
  welcomed: false,    // the first-visit welcome was answered (or skipped); "show the welcome again" clears it
  introShown: false, mapHintSeen: false, sailHereSeen: false, goalDone: false, proOffered: false, cruiseOffered: false,   // first-visit lines, each once
  waters: 'tahoe-emerald',   // the chosen waters (src/waters/); ?waters= wins at the start of a page
  lang: 'en',                // the language (LANGS; the picker is the chip on the loading card, src/ui/loading.js setLang; P2: Chinese)
  vessel: 'halcyon',         // the chosen vessel (src/vessels/); ?vessel= wins
  lastMode: '',              // v2's panel (modeSelects): the mode last entered (cruise | sail | regatta), lit first on the entrance; '' none yet (Sail)
  birthplace: '',            // where a sail starts (v2/sim/birthplace.js): '' none picked yet (the first visit's row, Tessie's water), or a row id of the waters' birthplaces (an old 'random' reads as the first); ?birth= wins for one load
};
const PROFILE_IDS = ['new', 'sail', 'race'];
export const LANGS = ['en'];   // 'zh' joins when the P2 Chinese work lands
export const DISPLAY = ['auto', 'day', 'night'];
export const HUD = ['auto', 'full', 'calm', 'instruments', 'clear'];
export const WORDS = ['both', 'sailor'];
const GENNAKER_MODES = ['auto', 'off'];
export const EDGE_INSTRUMENTS = ['auto', 'always', 'off'];
export const WIND_LINES = ['on', 'auto', 'off'];
// the quality choices: auto picks a tier at start (and a slow governor steps it down); the others pin one
export const QUALITY = ['auto', 'high', 'balanced', 'low'];
const KEY = 'lakeshore.settings.v1';
// The store keeps only the keys the player chose (format 2, `_v: 2`), so a later change of a default reaches them. Format 1
// (before 2026-11-12) saved every value at each change, which froze the defaults of the day: a player who touched any
// setting between 11-08 and 11-11 kept kayakCam on after it went off by default (the notice shot at load, live only, since
// the dev origin's store was newer). A format-1 copy counts as chosen only where it differs from today's default, and not
// where it holds a since-changed default (LEGACY_DEFAULTS: that value was the old default, not a choice).
const FORMAT = 2;
const LEGACY_DEFAULTS = { kayakCam: true };

export function createSettings({ storage = globalThis.localStorage } = {}) {
  let saved = {};
  try { saved = JSON.parse(storage?.getItem(KEY) ?? '{}') ?? {}; } catch { saved = {}; }
  const legacy = saved._v !== FORMAT;
  const v = { ...SETTINGS }, chosen = new Set();
  for (const k of Object.keys(SETTINGS)) {
    if (typeof saved[k] !== typeof SETTINGS[k]) continue;
    if (legacy && (saved[k] === SETTINGS[k] || LEGACY_DEFAULTS[k] === saved[k])) continue;
    v[k] = saved[k]; chosen.add(k);
  }
  if (!QUALITY.includes(v.quality)) v.quality = 'auto';
  if (!WORDS.includes(v.words)) v.words = 'both';
  if (!GENNAKER_MODES.includes(v.gennaker)) v.gennaker = 'auto';
  if (!WIND_LINES.includes(v.windLines)) v.windLines = 'off';
  if (!DISPLAY.includes(v.display)) v.display = 'auto';
  if (!EDGE_INSTRUMENTS.includes(v.edgeInstruments)) v.edgeInstruments = 'auto';
  if (v.hud === 'off') v.hud = 'clear';   // stage 2 of the cockpit (2026-11-06): Off is now Clear
  if (!HUD.includes(v.hud)) v.hud = 'auto';
  if (!PROFILE_IDS.includes(v.profile)) v.profile = 'new';
  if (!LANGS.includes(v.lang)) v.lang = 'en';
  const fns = new Set();
  return {
    get: (k) => v[k],
    all: () => ({ ...v }),
    set(k, value) {
      if (k === 'hud' && value === 'off') value = 'clear';
      if (!(k in SETTINGS) || typeof value !== typeof SETTINGS[k] || (k === 'quality' && !QUALITY.includes(value)) || (k === 'words' && !WORDS.includes(value)) || (k === 'gennaker' && !GENNAKER_MODES.includes(value)) || (k === 'windLines' && !WIND_LINES.includes(value)) || (k === 'display' && !DISPLAY.includes(value)) || (k === 'edgeInstruments' && !EDGE_INSTRUMENTS.includes(value)) || (k === 'hud' && !HUD.includes(value)) || (k === 'profile' && !PROFILE_IDS.includes(value)) || (k === 'lang' && !LANGS.includes(value))) return v[k];
      v[k] = value; chosen.add(k);
      const out = { _v: FORMAT }; for (const c of chosen) out[c] = v[c];
      try { storage?.setItem(KEY, JSON.stringify(out)); } catch { /* private mode: memory only */ }
      for (const f of fns) f(k, value);
      return value;
    },
    on(f) { fns.add(f); return () => fns.delete(f); },
  };
}

// The settings as they stand now: the shell's one shared copy once it is up (src/shell.js provides 'settings' a moment after
// the first frame), and before that the saved ones, read from storage at each call (fix/regatta-watchdog-vhf: a race started
// within ≈ 1 s of load played the officer's first call with the VHF off, the shell's copy not up yet).
export function settingsNow(services, { storage } = {}) {
  const shared = services?.get?.('settings');
  if (shared) return shared;
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }   // blocked: the defaults
  return createSettings({ storage });
}
