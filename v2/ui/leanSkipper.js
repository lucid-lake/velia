// The lean skipper (owner, 2026-11-17: "There are too many skipper lines and it doesn't scale; players don't have attention to read
// them while handling events. OK to drop some."). v2's one rule for every
// line on the skipper's row (src/ui/controlsHint.js: the skill lines, note(), flash(), the bar's viewSwitch.say), Cruise's quiet
// line and Regatta's coach card. Each line has a kind; each kind has one of three classes:
//   MUST  the player must do something now (an overpowered boat, a shoal or the shore ahead, aground, a refusal that says what
//         to do instead, Regatta's wrong side, over early, a penalty): shown at once, it replaces any other line, even mid-manoeuvre
//   TIP   a first-time teaching line: shown once ever (remembered in the store), never mid-manoeuvre, never within gapS of another
//   CREW  the crew's own call on a change the player did not make (round 2: "Gennaker up!", "Gennaker down."): shown
//         when no MUST holds the row, quietly (it stamps no clock, so it never delays a tip or a MUST); a phone: once each a session
//   CHAT  narration, status, call-outs, repeats, flavour: never shown (a kind not in the table is CHAT)
// Between two lines at least gapS (20 s), MUST excepted; nothing but MUST while busy() (a tack, a gybe, FREE or REFLOAT running,
// the bow turning through the wind, the anchor or the sails working, a knockdown, a mark rounding). The phone's quiet skipper
// (src/ui/phoneQuiet.js) still applies on top: a line it drops stays dropped. The voice reads only what shows.
// v1 (/classic/) never builds this: its lines are unchanged.
//   const lean = createLeanSkipper({ phone, storage, busy });   // phone: createPhoneQuiet(...); busy(): a manoeuvre is under way
//   createControlsHint({ ..., phoneQuiet: lean })                // controlsHint asks it through the phone rule's interface
//   lean.gate(kind)                                              // another channel's line (Cruise's, Regatta's card): may it show now?
import { LINE as CALM_LINE } from '../../src/ui/calmHud.js';

export const LEAN = Object.freeze({
  gapS: 20,          // at most one line this often (MUST excepted)
  mustHoldS: 6,      // after a MUST line, no tip takes the row for this long
  storeKey: 'lakeshore.v2.tips.v1',   // the tips shown once ever (a JSON list of kinds)
});
export const MUST = 'must', TIP = 'tip', CREW = 'crew', CHAT = 'chat';

// The one table: kind → class. A kind not here is CHAT. Kinds: 'hint.<name>' the skill model's lines (controlsHint HINTS),
// 'sea.<id>' src/ui/skipper.js NOTES, 'refuse.*' a press refused with what to do instead, 'tip.*' a first-time line,
// 'race.<coach id>' Regatta's coach steps, 'officer.<call>' the committee's calls, 'cruise.*' Cruise's own line.
export const LEAN_CLASS = Object.freeze({
  // safety: the bottom and the shore (src/sail/grounding.js), aground
  'sea.shoal': MUST, 'sea.rocks': MUST, 'sea.shore': MUST, 'sea.shoalAuto': MUST, 'sea.rocksAuto': MUST, 'sea.shoreAuto': MUST, 'sea.boxed': MUST, 'sea.aground': MUST,
  'sea.noKedge': MUST,
  // the anchor and the lines refused, with what to do (v2/sim/seamanship.js; deepSpot and dragging: feat/v2-anchor-seen)
  'sea.fast': MUST, 'sea.deep': MUST, 'sea.shallow': MUST, 'sea.tied': MUST, 'sea.ballFast': MUST, 'sea.ball': MUST, 'sea.pierFast': MUST, 'sea.pier': MUST,
  'sea.deepSpot': MUST, 'sea.dragging': MUST,
  // feat/v2-anchor-seen's other lines: "Anchor's holding." teaches once (the anchor's held phase is not a manoeuvre, so it can show);
  // "Rounding up to anchor…", "Anchor's up." and the anchorage tap's "… the mark is set." are statuses
  'sea.holding': TIP, 'sea.rounding': CHAT, 'sea.up': CHAT, 'sea.anchorage': CHAT,
  // a knockdown on its way (v2/main.js kdSay, v2/sim/knockdownGame.js: "Overpowered — ease the sails or reef"); once she is over the
  // row is hushed (notes only) until Start again, and the end card is its own UI, not a line
  'knock.warn': MUST,
  // the crew flies the gennaker (v2/sim/gennakerCrew.js, owner 2026-11-21): one quiet line as it goes up and as it comes down
  'gk.up': CREW, 'gk.down': CREW,
  'crew.sheets': CREW,   // the player's first W/S or R/F with crew trim on: "You have the sheets." (v2/sim/boat.js take-over)
  // Tessie's revenge (v2/living/tessie.js sayNote): the chase must be acted on (sail away); her giving up teaches once ever
  'sea.tessieChase': MUST, 'sea.tessieClose': TIP,
  // play as Tessie (v2/living/tessiePlayer.js tip(); the UI audit, owner 2026-11-21: every line of hers is the skipper's line): her
  // first-time teaching lines, once ever, under the same 20 s gap and busy rule; no status lines ("Got them!", "Next time…" are gone)
  'tip.tessie.swim': TIP, 'tip.tessie.dive': TIP, 'tip.tessie.dash': TIP, 'tip.tessie.look': TIP,
  // a press or a tap refused, with the way out (the planner, the double-tap mark, the pilot)
  'mark.set': MUST,   // "Mark set. Click NAV to sail there.": the answer to a double-click; said at once
  'refuse.plan': MUST, 'refuse.mark': MUST, 'refuse.pilot': MUST, 'refuse.dest': MUST, 'refuse.course': MUST,
  // NAV's own beat (ui/autopilot.js tip 'beat', once per device by sail.js): it says why the boat tacks by itself, so it shows at once
  'nav.beat': MUST,
  'course.wrongSide': MUST,                                          // a practice mark rounded the wrong way: go round again
  // first-time teaching, once ever
  first: TIP,                                                        // the first sail's intro line (v2/ui/firstSail.js)
  'hint.pull': TIP, 'hint.ease': TIP, 'hint.irons': TIP, 'hint.tack': TIP, 'hint.gybe': TIP, 'hint.heavy': TIP, 'hint.gusts': TIP, 'hint.chart': TIP,
  'sea.motorKeys': TIP, 'sea.sailsDown': TIP, 'sea.engine': TIP, 'sea.ballNear': TIP, 'sea.dawn': TIP, 'sea.sheets': TIP,
  'sea.letFlyJib': TIP, 'sea.letFlyJibPlain': TIP, 'sea.letFlyBoth': TIP,
  'tip.plan': TIP,                                                   // the chart's first open: how to add a waypoint
  'tip.helm': TIP,                                                   // the bar's helm-view nudge
  'tip.logbook': TIP,                                                // the first find: "… added to your logbook" (no L cap on v2)
  'tip.calm': TIP,                                                   // the Calm HUD's first fade: "Move the mouse to show the helm"
  'cruise.look': TIP,                                                // Cruise: the look-round line
  // Regatta: the coach's steps the player must act on, the committee's calls about the player
  'race.prestart': MUST, 'race.gun': MUST, 'race.ocs': MUST, 'race.penalty': MUST, 'race.wrongSide': MUST, 'race.flying': MUST, 'race.layline': MUST,
  'race.beat': TIP, 'race.rounding': TIP, 'race.run': TIP,
  'moment.giveWay': MUST,                                            // a rival with right of way converging: duck or tack
  'officer.rc_one_min': MUST, 'officer.rc_thirty': MUST, 'officer.rc_start': MUST, 'officer.rc_ocs_me': MUST, 'officer.rc_ocs_easy': MUST,
  'officer.rc_wrong': MUST, 'officer.rc_pen_pst': MUST, 'officer.rc_pen_wl': MUST, 'officer.rc_pen_mark': MUST,
});
export const classOf = (kind) => LEAN_CLASS[kind] ?? CHAT;
// A line that arrives with no kind (the shared modules that never pass one: the bar's say, the Calm HUD's line, the logbook's find,
// the practice marks, the kayaks' and Tessie's call-outs): its kind by its text. The few that teach or must be acted on are named;
// every other is chatter. sail.js fills the kind in before the hint row sees the line.
const TEXT_KIND = new Map([
  ['the helm', 'tip.helm'], ['Tap Helm for the helm view', 'tip.helm'], ['hold Y · the helm', 'tip.helm'],   // the bar's helm-view nudge, each hand
  [CALM_LINE.mouse, 'tip.calm'], [CALM_LINE.touch, 'tip.calm'],                                             // the Calm HUD's first fade
  ['no room for a course here', 'refuse.course'],                                                          // the practice marks' Lay refused
]);
export function textKind(text) {
  const t = String(text ?? '').replace(/<[^>]*>/g, '').trim();
  if (TEXT_KIND.has(t)) return TEXT_KIND.get(t);
  if (/ — added to your logbook$/.test(t)) return 'tip.logbook';                                           // the first find (src/sail/findLine.js)
  if (/: wrong side, go round again$/.test(t)) return 'course.wrongSide';                                  // a practice mark missed
  return 'chat';
}
// the phone rule's word for a lean kind (src/ui/phoneQuiet.js PHONE_KEEP): a refusal answers the player's tap ('reply'), so a
// phone keeps what it kept before
const PHONE_KIND = { 'mark.set': 'reply', 'refuse.plan': 'reply', 'refuse.mark': 'reply', 'refuse.pilot': 'reply', 'tip.plan': 'reply', 'nav.beat': 'reply', 'knock.warn': 'stuck' };
const phoneKind = (kind) => PHONE_KIND[kind] ?? kind;

export function createLeanSkipper({ phone = null, storage = globalThis.localStorage ?? null, busy = () => false, P = LEAN } = {}) {
  let t = 0, lastAt = -Infinity, mustAt = -Infinity;
  const holds = new Set();   // a channel's own manoeuvre (Regatta's mark rounding): hold('rounding', on)
  let seen = new Set();
  try { const v = JSON.parse(storage?.getItem(P.storeKey) ?? '[]'); if (Array.isArray(v)) seen = new Set(v); } catch { /* blocked or bad: no memory this visit */ }
  const remember = (kind) => { if (seen.has(kind)) return; seen.add(kind); try { storage?.setItem(P.storeKey, JSON.stringify([...seen])); } catch { /* private mode: once a visit */ } };
  const isBusy = () => { if (holds.size) return true; try { return !!busy(); } catch { return false; } };
  const phoneOn = () => !!phone?.on;
  // may a TIP of this kind show now (no marks made)
  const tipOk = (kind) => !seen.has(kind) && !isBusy() && t - lastAt >= P.gapS && t - mustAt >= P.mustHoldS;
  // the one gate: MUST at once; TIP once ever into a quiet moment; CHAT never. mark: the line will show (stamp the clocks)
  function pass(kind, { mark = true } = {}) {
    const c = classOf(kind);
    if (c === MUST) { if (mark) { lastAt = t; mustAt = t; } return true; }
    if (c === TIP && tipOk(kind)) { if (mark) { lastAt = t; remember(kind); } return true; }
    if (c === CREW) return t - mustAt >= P.mustHoldS;
    return false;
  }
  return {
    get on() { return true; },   // controlsHint takes the phone rule's path: no keep-turning line, no look-round, breeze or whisper lines
    update(dt, s) { t += dt; phone?.update?.(dt, s); },
    // a note or a flash of this kind (controlsHint note/flash): false drops it
    allow(kind) {
      if (!pass(kind, { mark: false })) return false;
      if (phoneOn() && !phone.allow(phoneKind(kind))) return false;
      return pass(kind);
    },
    // the skill model's needs ([{ hint }], its order) → the one line that may show now, or []
    wants(needs = []) {
      if (t - mustAt < P.mustHoldS) return [];
      const from = phoneOn() ? phone.wants(needs) : needs;
      for (const n of from) { const k = `hint.${n.hint}`; if (classOf(k) === MUST || (classOf(k) === TIP && tipOk(k))) return [n]; }
      return [];
    },
    said(name, o = {}) { const k = `hint.${name}`; lastAt = t; if (classOf(k) === TIP) remember(k); if (phoneOn()) phone.said(name, o); },
    firstShown() { phone?.firstShown?.(); },
    // another channel's line (Cruise's quiet line, Regatta's card): the same classes and the same clock
    gate(kind) { return pass(kind); },
    hold(name, on) { if (on) holds.add(name); else holds.delete(name); },
    classOf,
    get busy() { return isBusy(); },
    get state() { return { t, lastAt, mustAt, seen: [...seen], phone: phone?.state ?? null }; },
  };
}
