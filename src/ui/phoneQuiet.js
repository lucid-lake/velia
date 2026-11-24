// A quiet skipper on a phone (owner ruling 2026-11-16): on the flat phone controls (html.lk-flat, v2/ui/flat.js)
// the skipper's lines and hints are cut to three kinds, and this file is the one rule that says which. Desktop, iPad and
// ?portrait=1 never set lk-flat, so they keep the full skipper.
//   1. the first sail, once per device: the intro line and at most two of the model's lines in its first minute
//   2. the boat really stuck: in irons or under 0.5 kn for 10 s while trying to sail, aground, the sails luffing for 15 s;
//      one line at a time, the same line never again within 3 minutes, 60 s between two stuck lines
//   3. the shore, shoal and rock warnings before she grounds, and Regatta's penalty and missed-mark lines: each once, fading
//   4. the crew's gennaker calls (v2/sim/gennakerCrew.js: "Gennaker up!", "Gennaker down."): each once a session (owner, 2026-11-21)
// Plus what answers the player's own tap (a status, a refusal): not coaching, it says why a press did or did not act.
// Everything else is dropped on a phone: routine coaching, the keep-turning line, scenery and kayak lines, logbook finds,
// the next suggestion, the look-round and helm nudges, the offers, any line naming a control a phone does not have. (v2 sets
// no island goal at all since 2026-11-16, desktop or phone, so there is no goal chip to keep.)
//   const q = createPhoneQuiet({ storage, trying: (s) => bool });   (controlsHint.js makes one; sail.js passes its own)
//   q.update(dt, s)   every frame (controlsHint.update): the stuck and luff clocks
//   q.allow(kind)     a note or flash of this kind may show (kinds below); the stuck ones also go through q.stuckLine
//   q.wants(needs)    the one skill line the phone may show now, as [{ hint }] or []; q.said(name) once it shows
//   keeps(kind)       a line outside the hint row (Cruise's own line, the first sail's offer chips)
//   raceLine(line)    Regatta's coach card on a phone: the start cues, "over early", penalties and a missed mark
import { feature } from '../core/features.js';
export const PHONE_QUIET = Object.freeze({
  stuckS: 10,          // in irons, or under stuckKn, this long while trying to sail
  stuckKn: 0.5,
  luffS: 15,           // the main luffing (fill under luffFill) this long
  luffFill: 0.5,
  repeatS: 180,        // the same stuck line never again within this
  gapS: 60,            // between two stuck lines
  firstS: 60,          // the first sail's window, from the intro line
  firstLines: 2,       // the model's lines it may show in that window (the intro is the first of the 2-3)
  storeKey: 'lakeshore.phone.firstSail.v1',
});
const KN = 0.514444;

// The one table: what a phone keeps. Lines through the hint row carry a kind; a kind not here is dropped.
export const PHONE_KEEP = Object.freeze({
  hint: Object.freeze(['first', 'stuck', 'status', 'reply']),
  // the skipper's notes (src/ui/skipper.js NOTES) by id, as 'sea.<id>': aground is stuck; the warnings once each (repeatS); the
  // rest answer the Anchor tap (the anchor seen, 2026-11-17: the crew rounding up, the nearest anchorage, holding, dragging)
  sea: Object.freeze(['aground', 'shoal', 'rocks', 'shore', 'shoalAuto', 'rocksAuto', 'shoreAuto', 'boxed', 'fast', 'deep', 'shallow', 'tied', 'ballFast', 'ball', 'pierFast', 'pier', 'kedge', 'noKedge', 'rounding', 'deepSpot', 'holding', 'dragging', 'up', 'anchorage']),
  // the bottom's warnings before aground (src/sail/grounding.js): the plain ones, the ones the shallow-water assist says as it bears
  // away (Setup's default), and the no-way-round one
  warn: Object.freeze(['shoal', 'rocks', 'shore', 'shoalAuto', 'rocksAuto', 'shoreAuto', 'boxed']),
  stuck: Object.freeze(['irons', 'pull', 'ease', 'tack', 'steer']),   // the model's lines a stuck boat may get
  crew: Object.freeze(['gk.up', 'gk.down', 'crew.sheets']),   // the crew's gennaker calls: once each a session (this object's life)
  race: Object.freeze(['prestart', 'flying', 'ocs', 'gun', 'penalty']),          // Regatta's coach steps (v2/regatta/coach.js)
  officer: Object.freeze(['rc_one_min', 'rc_thirty', 'rc_start', 'rc_ocs_me', 'rc_ocs_easy', 'rc_wrong', 'rc_pen_pst', 'rc_pen_wl', 'rc_pen_mark']),   // the committee's calls (src/sim/race/officer.js)
});

export const phoneQuietOn = () => feature('quietSkipper').on;   // the registry (src/core/features.js): the flat controls' layout is up (ui/flat.js reports it)

// a line outside the hint row: kept unless a phone is on and its kind is not in the table
export function keeps(kind, on = phoneQuietOn()) {
  if (!on) return true;
  if (!kind) return false;
  if (PHONE_KEEP.hint.includes(kind)) return true;
  if (kind.startsWith('sea.')) return PHONE_KEEP.sea.includes(kind.slice(4));
  return false;
}

// Regatta's card on a phone: a coach step needed to race, or a start, recall, penalty or missed-mark call; else nothing
export function raceLine(line, on = phoneQuietOn()) {
  if (!on || !line) return line;
  if (line.kind === 'coach') return PHONE_KEEP.race.includes(line.id) ? line : null;
  if (line.kind === 'officer') return PHONE_KEEP.officer.includes(line.call) ? line : null;
  return null;   // notes and moments (a clean start, a crossing, a place)
}

const defaultTrying = (s) => !!s && !s.held && (s.furl ?? 0) < 0.5;

export function createPhoneQuiet({ on = () => phoneQuietOn(), storage = globalThis.localStorage ?? null, trying = defaultTrying, P = PHONE_QUIET } = {}) {
  let t = 0, stuckFor = 0, luffFor = 0, lastStuck = -Infinity, firstAt = null, firstSaid = 0;
  const saidAt = new Map();
  let s = null;
  let firstDone = false;
  try { firstDone = storage?.getItem(P.storeKey) === '1'; } catch { /* private mode: a first sail each visit */ }
  const inFirst = () => firstAt != null && t - firstAt < P.firstS;
  const fresh = (name) => t - (saidAt.get(name) ?? -Infinity) >= P.repeatS;
  function update(dt, state) {
    t += dt; s = state;
    if (firstAt != null && !firstDone && t - firstAt >= P.firstS) { firstDone = true; try { storage?.setItem(P.storeKey, '1'); } catch { /* ignore */ } }
    const go = !!s && trying(s);
    const twa = Math.abs(s?.trueWind?.angle ?? Math.PI), sog = s?.sog ?? 0;
    const stuck = go && ((twa < 0.55 && sog < 0.8) || sog < P.stuckKn * KN);
    stuckFor = stuck ? stuckFor + dt : 0;
    luffFor = go && !stuck && (s?.mainFill ?? 1) < P.luffFill ? luffFor + dt : 0;   // luffing while she still moves (a stopped boat's luff is the stuck line's)
  }
  // the stuck line for the boat now, or null
  function stuckLine(needs) {
    if (t - lastStuck < P.gapS) return null;
    const twa = Math.abs(s?.trueWind?.angle ?? Math.PI);
    if (luffFor >= P.luffS) return fresh('pull') ? 'pull' : null;
    if (stuckFor < P.stuckS) return null;
    const asked = needs.map((n) => n.hint).find((h) => PHONE_KEEP.stuck.includes(h));
    const name = twa < 0.55 ? 'irons' : asked ?? ((s?.mainFill ?? 1) < 0.6 ? 'pull' : (s?.mainStall ?? 0) > 0.5 ? 'ease' : 'irons');
    return fresh(name) ? name : null;
  }
  return {
    get on() { return !!on(); },
    update,
    allow(kind) {
      if (!on()) return true;
      const id = kind?.startsWith('sea.') ? kind.slice(4) : null;
      if (PHONE_KEEP.warn.includes(id)) { if (!fresh(id)) return false; saidAt.set(id, t); return true; }   // once, then not within repeatS
      if (PHONE_KEEP.crew.includes(kind)) { if (saidAt.has(kind)) return false; saidAt.set(kind, t); return true; }
      if (kind === 'sea.aground') { if (!fresh('aground') || t - lastStuck < P.gapS) return false; saidAt.set('aground', t); lastStuck = t; stuckFor = 0; return true; }
      return keeps(kind, true);
    },
    // the model's needs ([{ hint }], its priority order) → the one line a phone may show now
    wants(needs = []) {
      const name = stuckLine(needs);
      if (name) return [{ hint: name, stuck: true }];
      if (inFirst() && !firstDone && firstSaid < P.firstLines) {
        const n = needs.find((x) => PHONE_KEEP.stuck.includes(x.hint) && !saidAt.has(x.hint));
        if (n) return [{ hint: n.hint }];
      }
      return [];
    },
    said(name, { stuck = false } = {}) {
      saidAt.set(name, t);
      if (stuck) { lastStuck = t; stuckFor = 0; luffFor = 0; } else if (inFirst()) firstSaid++;
    },
    firstShown() { if (firstAt == null && !firstDone) firstAt = t; },
    get state() { return { t, stuckFor, luffFor, lastStuck, firstAt, firstSaid, firstDone }; },
  };
}
