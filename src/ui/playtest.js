// The play-test session log. Opt-in (?playtest=1), local only, no network: a privacy-safe event
// timeline in localStorage that the player can export from the About page and email. It records what the game did, never
// what the player typed: no key codes, no text, no pointer positions, no clock time, no ids. Positions are not kept.
//
//   const rec = createRecorder({ storage: localStorage });          // starts a new session
//   const w = createWatcher(rec, { island: { x, z, r } });          // turns frames into events
//   w.frame({ mode, hint, twa, depth, anchored, x, z, ui: 'gone'|'home'|'menu'|…, page, logbook, chart })   // each tick
//   w.skill('trim')                                                  // a skill learned
//   rec.export()  →  { schema, events, summary }
import { FLAGS, toFlags } from '../sim/core/flags.js';
export const SCHEMA = 'velia-playtest-1';
export const KEY = 'lakeshore.playtest.v1';
export const MAX_EVENTS = 3000;
const GROUND_DEPTH_M = 1.5;   // the keel's draft: less water than this under the boat is a grounding

// what an event may carry. Anything else is dropped; a string is cut to 24 characters, letters, digits and _ - : only.
export const TYPES = {
  start: ['browser', 'viewport'], play: [], mode: ['from', 'to'], hint: ['name'], skill: ['id'], tack: ['n'], gybe: [],
  grounding: [], anchor: ['down'], island: [], menu_open: [], menu_close: [], page: ['name'], logbook_open: [], chart_open: [],
  press: ['control', 'via'],   // a control used (the panel, the throttle, the wheel, a winch): the order's data (owner, 2026-10-30)
};

export const playtestOn = (flags = FLAGS) => toFlags(flags).playtest;   // a flags object (or a query string: the tests)

const clean = (v) => (typeof v === 'number' ? (Number.isFinite(v) ? +v.toFixed(2) : null) : typeof v === 'boolean' ? v
  : typeof v === 'string' ? v.replace(/[^A-Za-z0-9_:× .-]/g, '').slice(0, 24) : null);

export function createRecorder({ storage = null, key = KEY, now = () => performance.now() / 1000 } = {}) {
  const t0 = now();
  let events = [];
  const save = () => { try { storage?.setItem(key, JSON.stringify({ schema: SCHEMA, events })); } catch { /* memory only */ } };
  function log(type, data = {}) {
    const allowed = TYPES[type]; if (!allowed || events.length >= MAX_EVENTS) return null;
    const ev = { t: +(now() - t0).toFixed(1), type };
    for (const k of allowed) { const v = clean(data[k]); if (v !== null) ev[k] = v; }
    events.push(ev); save(); return ev;
  }
  function summary() {
    const first = (type) => events.find((e) => e.type === type);
    const play = first('play')?.t ?? 0;
    const since = (e) => (e ? +(e.t - play).toFixed(1) : null);
    const n = (type) => events.filter((e) => e.type === type).length;
    return {
      durationS: events.length ? events.at(-1).t : 0, playStartS: first('play')?.t ?? null,
      timeToFirstTackS: since(first('tack')), timeToIslandS: since(first('island')),
      tacks: n('tack'), gybes: n('gybe'), groundings: n('grounding'), anchorDowns: events.filter((e) => e.type === 'anchor' && e.down === true).length,
      hintsShown: n('hint'), skillsLearned: n('skill'), modeSwitches: n('mode'), menuOpens: n('menu_open'),
      logbookOpens: n('logbook_open'), chartOpens: n('chart_open'),
      presses: events.filter((e) => e.type === 'press').reduce((o, e) => { o[e.control] = (o[e.control] ?? 0) + 1; return o; }, {}),
    };
  }
  return { log, summary, get events() { return events.slice(); }, export: () => ({ schema: SCHEMA, events: events.slice(), summary: summary() }),
    clear() { events = []; save(); } };
}

// Turns what the shell sees each tick into events. Pure: the caller passes plain values.
export function createWatcher(rec, { island = null, groundM = GROUND_DEPTH_M } = {}) {
  let mode = null, hint = 'none', ui = null, page = 'home', side = 0, tacks = 0, grounded = false, anchored = false, atIsland = false;
  let logbook = false, chart = false, lastTurn = -Infinity, t = 0;
  return {
    frame(f = {}) {
      t = f.t ?? t;
      if (f.mode && f.mode !== mode) { if (mode) rec.log('mode', { from: mode, to: f.mode }); mode = f.mode; }
      if (f.ui && f.ui !== ui) {   // the home card: 'gone' is play, 'menu' is the Esc card
        if (f.ui === 'gone' && (ui === 'home' || ui === 'out' || ui == null)) rec.log('play');
        if (f.ui === 'gone' && ui === 'menu') rec.log('menu_close');
        if (f.ui === 'menu') { rec.log('menu_open'); page = 'home'; }
        ui = f.ui;
      }
      if ((ui === 'menu' || ui === 'home') && f.page && f.page !== page) { page = f.page; if (page !== 'home') rec.log('page', { name: page }); }
      if (f.hint && f.hint !== hint) { hint = f.hint; if (hint !== 'none') rec.log('hint', { name: hint }); }
      if (!!f.logbook !== logbook) { logbook = !!f.logbook; if (logbook) rec.log('logbook_open'); }
      if (!!f.chart !== chart) { chart = !!f.chart; if (chart) rec.log('chart_open'); }
      if (!ui || ui === 'company' || ui === 'home' || ui === 'attract') return;   // the boat's events count only in play (the Esc card keeps the world running)
      if (Number.isFinite(f.twa)) {   // radians, signed: a flip of sign through the wind is a tack, through the stern a gybe
        const s = Math.abs(f.twa) < 0.17 || Math.abs(f.twa) > 3.0 ? side : Math.sign(f.twa);   // near head-to-wind or dead run: hold the side (no flicker)
        if (side && s && s !== side && t - lastTurn > 4) {
          lastTurn = t;
          if (Math.abs(f.twa) < Math.PI / 2) rec.log('tack', { n: ++tacks }); else rec.log('gybe');
        }
        if (s) side = s;
      }
      if (Number.isFinite(f.depth)) { const g = f.depth < groundM; if (g && !grounded) rec.log('grounding'); grounded = g; }
      if (typeof f.anchored === 'boolean' && f.anchored !== anchored) { anchored = f.anchored; rec.log('anchor', { down: anchored }); }
      const isl = typeof island === 'function' ? island() : island;   // island: { x, z, r } or a function of it (the shell's: the world's lake, once built)
      if (isl && Number.isFinite(f.x) && !atIsland && Math.hypot(f.x - isl.x, f.z - isl.z) <= isl.r) { atIsland = true; rec.log('island'); }
    },
    skill: (id) => rec.log('skill', { id }),
  };
}

// The About page's download: the session as a JSON file, from the player's own browser to their own disk.
export function downloadSession(rec, { doc = globalThis.document, URLApi = globalThis.URL, Blob = globalThis.Blob, name = 'velia-session.json' } = {}) {
  const blob = new Blob([JSON.stringify(rec.export(), null, 2)], { type: 'application/json' });
  const url = URLApi.createObjectURL(blob);
  const a = doc.createElement('a'); a.href = url; a.download = name; a.style.display = 'none';
  doc.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URLApi.revokeObjectURL(url), 4000);
  return url;
}

export const EXPORT_NOTE = 'Play-test recording is on. It lists what the game did (modes, hints, tacks, groundings), with times. It never records what you type. It stays in this browser until you press export; then email the file to the person who invited you.';
