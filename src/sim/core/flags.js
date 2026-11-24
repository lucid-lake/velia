// Every URL flag Velia reads, in one table (refactor Phase 2 step 1).
// No imports: src/ui/loading.js reads it before the game's module graph loads.
//
//   import { FLAGS } from './core/flags.js';     FLAGS.headless, FLAGS.gustfx …: the page's flags, typed, read-only
//   parseFlags('?hour=6.5&cam=A')                 a frozen flags object from a query string or a URLSearchParams
//   withFlags(flags, { settle: '0' })             a frozen copy with some values replaced (a mode's own copy)
//   toFlags(x)                                    x if it is a flags object, else parseFlags(x) (the tests pass strings)
//
// Each row: { name, kind, type, default, parse }. Each flag's one-line doc is in src/core/flags-docs.js (tests and
// notes only: it never ships, so the build carries no internal notes).
//   kind  'capture' (captures, goldens, the film and probe tools), 'debug' (an A/B, a kill switch, a cost check),
//         'setting' (what a player or the owner may put in a link)
//   type  'string': the raw value or null when absent (the reads compare it themselves, as before the table);
//         'bool': true / false (on: '0' turns it off; opt-in: only '1' turns it on; present: any value, even empty);
//         'number': parseFloat of the value, or the default when absent
// FLAGS parses location.search once per distinct value (a page's never changes but for ?mode= on a mode switch, which
// src/shell.js writes; the node tests install their own). A flag not in the table reads as undefined: tests/flags.test.mjs
// checks that every flag read in src/ is a row, and src/ui/loading-shell.html's inline reads too.

const str = (name, kind) => ({ name, kind, type: 'string', default: null, parse: (v) => v });
const on = (name, kind) => ({ name, kind, type: 'bool', default: true, parse: (v) => v !== '0' });   // ?name=0 turns it off
const opt = (name, kind) => ({ name, kind, type: 'bool', default: false, parse: (v) => v === '1' });   // ?name=1 turns it on
const present = (name, kind) => ({ name, kind, type: 'bool', default: false, parse: (v) => v != null });   // any value
const num = (name, kind, dflt) => ({ name, kind, type: 'number', default: dflt, parse: (v) => (v == null ? dflt : parseFloat(v)) });

export const FLAG_TABLE = Object.freeze([
  // --- the capture contract ("URL contract"; tools/capture.mjs, golden/frames.json, tools/film/) ---
  str('headless', 'capture'),
  opt('film', 'capture'),
  opt('filmui', 'capture'),
  str('hour', 'capture'),
  str('cam', 'capture'),
  str('seed', 'capture'),
  num('exposure', 'capture', 6),
  num('t', 'capture', 0),
  present('golden', 'capture'),
  str('noload', 'capture'),
  str('gate', 'capture'),
  str('shot', 'capture'),
  str('prodemo', 'capture'),
  str('campos', 'capture'),
  str('camlook', 'capture'),
  str('camfov', 'capture'),
  str('camyaw', 'capture'),
  str('campitch', 'capture'),
  str('camdist', 'capture'),
  str('camride', 'capture'),
  str('drive', 'capture'),
  str('settle', 'capture'),
  str('start', 'capture'),
  str('heading', 'capture'),
  str('twa', 'capture'),
  str('rudder', 'capture'),
  str('until', 'capture'),
  str('after', 'capture'),
  str('view', 'capture'),
  str('helmlook', 'capture'),
  str('windlines', 'capture'),
  str('airs', 'capture'),
  str('chillsettle', 'capture'),
  str('cruisecam', 'capture'),
  opt('coursecam', 'capture'),
  opt('autoplay', 'capture'),
  opt('brief', 'capture'),
  str('racet', 'capture'),
  str('racecam', 'capture'),
  str('weather', 'capture'),
  str('stormt', 'capture'),
  str('stormrate', 'capture'),
  str('stormref', 'capture'),
  str('birds', 'capture'),
  str('birddive', 'capture'),
  str('pixelratio', 'capture'),
  str('chart', 'capture'),
  str('route', 'capture'),
  str('welcome', 'capture'),
  str('kayak', 'capture'),
  str('kayakpos', 'capture'),
  str('kayakcam', 'capture'),
  str('kayakref', 'capture'),
  str('paddler', 'capture'),
  // --- what a player or the owner may put in a link ---
  str('mode', 'setting'),
  str('quality', 'setting'),
  str('boatshadow', 'debug'),
  str('water', 'setting'),
  str('waters', 'setting'),
  str('day', 'setting'),
  str('vessel', 'setting'),
  str('card', 'setting'),
  str('wind', 'setting'),
  str('winddir', 'setting'),
  str('windspeed', 'setting'),
  str('windref', 'setting'),
  opt('advisory', 'setting'),
  str('timerate', 'setting'),
  str('clock', 'setting'),
  str('speed', 'setting'),
  str('pro', 'setting'),
  str('pilot', 'setting'),
  str('hand', 'setting'),
  str('words', 'setting'),
  str('shoal', 'setting'),
  str('hud', 'setting'),
  str('keylegend', 'setting'),
  str('navcol', 'setting'),
  str('touch', 'setting'),
  str('first', 'setting'),
  str('attract', 'setting'),
  str('attractS', 'setting'),
  str('reel', 'setting'),
  opt('fv', 'setting'),
  on('menu', 'setting'),
  on('music', 'setting'),
  on('once', 'setting'),
  str('metrics', 'setting'),
  present('notrack', 'setting'),
  opt('playtest', 'setting'),
  str('subfont', 'setting'),
  str('trimpanel', 'setting'),
  str('panel', 'setting'),
  str('dials', 'setting'),
  str('cockpitlabels', 'setting'),
  opt('lefty', 'setting'),
  str('diff', 'setting'),
  str('tier', 'setting'),
  str('course', 'setting'),
  str('show', 'setting'),
  // --- A/B switches, kill switches, cost checks, debugging ---
  str('debug', 'debug'),
  str('intro', 'debug'),   // =old: the staged first visit's opening off the starboard bow (before R0)
  str('firstsky', 'debug'),
  str('far', 'debug'),   // =old: the far field before S3 + S4 (the full aerial haze, the pale slate, the mist, July's snow line)
  str('wmirror', 'debug'),
  str('wcolour', 'debug'),
  str('grade', 'debug'),   // =0: no grade (S1 + S2); =lut the LUT only; =sky the sky curve only   // =old: the water's body colour before S5 (no shelf or deep tint)   // =0: the water's old mirror (no twilight mirror, the probe fixed in the bay; M6)   // =0: no Clear hold in the staged first minute (R0)
  str('kayaks', 'debug'),   // on by default; =0 the kill switch (src/kayaks/on.js)
  str('kayakwarm', 'debug'),   // a full kayak's pipelines warmed before it shows: on with the frame-safe warm-up (default), 0 off, 1 forced (src/kayaks/fleet.js)
  str('diag', 'debug'),
  opt('gputime', 'debug'),   // =1 the GPU's timer queries on a live page (src/core/gpu.js gpuTiming; ?diag and captures have them)
  str('backend', 'debug'),
  str('sky', 'debug'),
  str('stream', 'debug'),
  str('aa', 'debug'),
  str('storms', 'debug'),
  str('terrain', 'debug'),
  str('ktx2', 'debug'),
  on('nightmoment', 'setting'),
  on('fireworks', 'debug'),
  str('fwt', 'capture'),
  str('fwlook', 'capture'),
  on('fwsound', 'debug'),
  str('canvas', 'debug'),
  str('fft', 'debug'),
  str('seafeel', 'debug'),
  str('umask', 'debug'),
  str('live', 'debug'),
  str('detailfar', 'debug'),
  str('skills', 'debug'),
  str('logbook', 'debug'),
  str('challenges', 'debug'),
  str('airboost', 'debug'),
  str('nowake', 'debug'),
  str('wake_amp', 'debug'),
  str('wake_rc', 'debug'),
  str('wake_r0', 'debug'),
  str('wake_bow', 'debug'),
  on('air', 'debug'),
  on('autotrim', 'debug'),
  on('binolod', 'debug'),
  on('boat', 'debug'),
  on('captain', 'debug'),
  on('chatter', 'debug'),
  on('clarity', 'debug'),
  on('cockpitlight', 'debug'),   // look/cockpit-light: the 3D cockpit lit by the world's light only; =0 the old deck lamp
  on('clouds', 'debug'),
  num('mist', 'debug', 1),   // a scale on the valley mist's density (0: none; S3's A/B)
  num('cloudcov', 'debug', null),   // the main cloud deck's four (src/core/params.js CLOUD_DECK holds their defaults)
  num('cloudtype', 'debug', null),
  num('cloudbase', 'debug', null),
  num('cloudthick', 'debug', null),
  opt('bank', 'debug'),
  on('farmap', 'debug'),
  on('flags', 'debug'),
  on('governor', 'debug'),
  on('gustfx', 'debug'),
  on('gustlook', 'debug'),
  on('hm', 'debug'),
  on('interp', 'debug'),
  opt('nocaps', 'debug'),
  opt('nogust', 'debug'),
  on('opus', 'debug'),
  on('prebake', 'debug'),
  str('slow', 'debug'),
  str('profile', 'debug'),   // =1: the load-time marks (src/profile.js); axis:value pairs: the device profile's forced axes (src/core/profile.js)
  on('rumble', 'debug'),
  on('shifts', 'debug'),
  on('station', 'debug'),
  on('warm', 'debug'),
  str('latewarm', 'debug'),   // =boot: every warm-up behind the card, as before perf/ready-first-frame (the A/B and the kill switch)
  str('latebudget', 'debug'),   // the live warm-ups' share of a frame in ms (src/core/lateWarm.js frameBudget; 0: off; default by device)
  num('warmlanes', 'debug', 0),   // the shader warm-up's parallel compileAsync calls (0: src/core/warmup.js's default; fix/first-visit-reel)
  on('watchdog', 'debug'),
  on('windworker', 'debug'),
]);

const ROWS = new Map(FLAG_TABLE.map((r) => [r.name, r]));
const made = new WeakSet();   // every flags object this module built
const seal = (o) => { Object.freeze(o); made.add(o); return o; };

// A frozen flags object from a query string ('?a=1&b' or 'a=1&b'), a URLSearchParams, or anything with get(name).
export function parseFlags(src = '') {
  const q = typeof src === 'string' ? new URLSearchParams(src) : src ?? new URLSearchParams();
  const o = {};
  for (const r of FLAG_TABLE) { const v = q.get(r.name); o[r.name] = r.parse(v ?? null); }
  return seal(o);
}

// A frozen copy of flags with some values replaced (typed as the table's rows; a name not in the table throws).
export function withFlags(base, over = {}) {
  for (const k of Object.keys(over)) if (!ROWS.has(k)) throw new Error(`flags: no flag "${k}" in src/sim/core/flags.js`);
  return seal({ ...snapshot(toFlags(base)), ...over });
}

const cache = new Map();   // query string → its flags (a page has one; the tests a few dozen)
export function toFlags(x) {
  if (x === FLAGS) return snapshot(x);
  if (x != null && made.has(x)) return x;
  if (x == null || typeof x === 'string') {
    const s = x ?? '';
    let f = cache.get(s);
    if (!f) { if (cache.size > 64) cache.clear(); f = parseFlags(s); cache.set(s, f); }
    return f;
  }
  return parseFlags(x);
}
export const isFlags = (x) => x === FLAGS || (x != null && made.has(x));

const pageSearch = () => { try { return globalThis.location?.search ?? ''; } catch { return ''; } };
const snapshot = (x) => (x === FLAGS ? toFlags(pageSearch()) : x);
const deny = () => { throw new TypeError('FLAGS is read-only (withFlags makes a copy)'); };
// The page's flags: reads go to the frozen parse of the current location.search.
export const FLAGS = new Proxy({}, {
  get: (_, k) => toFlags(pageSearch())[k],
  has: (_, k) => ROWS.has(k),
  ownKeys: () => [...ROWS.keys()],
  getOwnPropertyDescriptor: (_, k) => (ROWS.has(k) ? { value: toFlags(pageSearch())[k], enumerable: true, configurable: true, writable: false } : undefined),
  set: deny, defineProperty: deny, deleteProperty: deny,
});
