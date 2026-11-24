// Regatta's race loop (refactor round 3 C4: cut out of index.js createRegatta; one shared state R).
// The race's life: enter and leave the mode, quit, the course laid to the wind (prepare, layCourse), the wind pinned while
// racing, a new session (build) and what every new race starts with (fresh), restart, the helper's drive.
import { loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { isPlace, placeCourse, placeHand } from '../sim/racePlaces.js';
import { STORM_RUN } from './stormRun.js';
import { createTessieDeep } from './tessieDeep.js';
import { areaOf } from '../stage/areas.js';
import { createOfficer } from '../../src/sim/race/officer.js';
import { Rival } from '../../src/sim/race/rival.js';
import { DT } from '../../src/sim/boat.js';
import { createRegattaSession } from './session.js';
import { GUST_BAND, courseToWind, fairGust, layFairCourse } from './geometry.js';
import { createChime, createHorn } from './horn.js';
import { RACE } from './plan.js';
import { createRaceUi } from './ui.js';
import { LEVELS, aidsFor, loadLevel } from '../sim/raceLevels.js';
import { createCoach } from './coach.js';
import { createReview } from './review.js';
import { createMoments } from './moments.js';
import { FLEET_TIER, FleetRival, skillFor } from './fleet.js';
import { fromFrame, loadTrial, pursuitOrder, thin, trialKey } from './events.js';
import { PRESETS, hubAtEnter, isFlying, minutesFor } from './setup.js';
import { makePattern } from './shifts.js';
import { courseSvg } from './hub.js';
import { COURSE_SCALE, DEG, SHORT } from './tuning.js';

/** @param {object} R the Regatta's shared state (index.js createRegatta) */
export function installRaceLoop(R) {
  const { B, NAMES, audio, boat, canvas, course0, courseOfHand, depthAt, flags, floats, full, hooked, hubUi, lean, lines, live, lodN,
    lodSt, look, memTrial, onHome, onLeave, onMode, onStorm, persist, pic, props, rivals, sailHud, seed, short, stats, store, tessie,
    windField } = R;
  // the race's wind as the boat feels it (the boat's own env: v2/sim/boat.js), with the rivals' dirty air in it while racing
  const driveHelper = (t) => { if (R.S?.helper) R.S.helperTick(B.ctl, t); else if (R.auto) driveAuto(t); };
  function driveAuto(t) {
    const r = R.S.race, v = r.view('me');
    R.auto.update(DT, B.phys.state, B.ctl, { t, clock: r.clock, view: v, line: R.course.line });
  }
  // the wind field's terrain factor for today's wind (the course's fair test): its two direction bins blended, as sample() does
  function factorAtFor(dirDeg) {
    if (!windField.heightAt || !windField.binAt) return null;
    const bins = windField.constructor.bins ?? ((d) => { const f = d / 10, k = Math.floor(f); return [k, f - k]; });
    const [k, w] = bins(dirDeg);
    return (x, z) => windField.binAt(k, x, z)[2] * (1 - w) + windField.binAt(k + 1, x, z)[2] * w;
  }
  function layCourse(dir) {
    if (R.hand?.place) { stats.fair = null; return placeCourse(R.hand.place, dir); }   // pinned: no turn, no move, no snap
    const factorAt = factorAtFor(dir), scale = R.hand ? R.hand.scale : short ? SHORT.scale : full ? COURSE_SCALE.full : COURSE_SCALE.race;
    const c0 = courseOfHand(), laps = R.hand?.laps ?? c0.laps;
    if (!factorAt) return courseToWind(c0, dir, { loadCourse, snapCourse, depthAt, scale, laps });
    const r = layFairCourse(c0, dir, { loadCourse, snapCourse, depthAt, factorAt, scale, laps });
    stats.fair = { offset: r.offset, fair: r.fair, ratio: r.ratio != null ? +r.ratio.toFixed(3) : null, ratio0: r.ratio0 != null ? +r.ratio0.toFixed(3) : null };
    return r.course;
  }
  // inside a race the day's clock holds for the wind (the shifts, the gusts and the storm still move): a long race at the day clock's
  // 10 × would otherwise carry the afternoon breeze into its evening fade (R3; the owner: weather stays, no collapse)
  function pinWind() {
    if (!windField.day || !windField.setClock) return;
    if (R.pinned == null) R.pinned = { clock: windField.day.clock };
    const h = windField.hourAt(B.t);
    windField.setClock(() => h);
  }
  function unpinWind() { if (R.pinned && windField.setClock) windField.setClock(R.pinned.clock); R.pinned = null; }

  // the session for the level in force: the helper (Beginner), the rivals' tier, the penalties
  function build() {
    R.endFly(false);
    // a hand's flying start (setup.js: prestartS 0): the fleet already sailing at the line, the countdown in real seconds at the hand's
    // pace; the gun waits for the first bow at Beginner and Club (no over early), Pro judges early as OCS. The URL's race keeps the box
    const flying = isFlying(R.hand);
    floats.reset(); R.floatT = null;   // the new fleet's floats start on the water
    R.S = createRegattaSession({ course: R.course, me: { phys: B.phys, name: 'You' }, rivals: R.hand?.rivals ?? rivals, windAt: R.baseWind, depthAt, seed: R.hand?.raceSeed ?? seed, prestartS: R.hand?.prestartS || RACE.prestartS, t0: B.t, tier: R.aids.tier, forgiving: R.aids.forgiving, helper: R.aids.helper,
      flying, pace: R.aids.pace ?? R.hand?.pace ?? 2, gunWaits: flying && R.aids.level !== 'pro', event: R.hand?.event ?? 'fleet', meSkill: FLEET_TIER[PRESETS[R.aids.level]?.skill] ?? FLEET_TIER.medium, round: R.aids.level,
      onPlace: (p) => { B.place({ x: p.x, z: p.z, headingDeg: p.heading / DEG, speed: p.speed }); R.S && (R.S.t = B.t); } });
    B.place({ x: R.S.me0.x, z: R.S.me0.z, headingDeg: R.S.me0.heading / DEG, speed: R.S.me0.speed });
    R.S.t = B.t;
    R.env.windAt = R.S.meWind;
    // ?autoplay=1: v1's pro sails her after the start; R4: &autotier=easy|medium|hard puts her in the pack for the stills and the film
    const autoOn = flags.autoplay === '1' || flags.autoplay === true, autoTier = autoOn ? (['easy', 'medium', 'hard'].includes(flags.autotier) ? flags.autotier : 'pro') : null;
    // (=1: v1's pro Rival, as R3; a named tier: the fleet's own mind at that tier, which rounds the windward mark: v1's medium did not)
    R.auto = autoTier === 'pro' ? new Rival({ course: R.course, tier: 'pro', seed: seed + 11, windAt: R.S.meWind, vessel: B.phys.vessel })
      : autoTier ? new FleetRival({ course: R.course, tier: autoTier, skill: skillFor(autoTier, 'tern'), seed: seed + 11, windAt: R.S.meWind, vessel: B.phys.vessel }) : null;
    B.drive(!R.hubOpen && (R.aids.helper || R.auto) ? driveHelper : null);
    R.officer = createOfficer({ forgiving: R.aids.forgiving });
    armPattern();
    fresh();
  }
  // the hand's shift pattern on the wind module, timed from this race's gun (the URL's race keeps the lake's own shifts)
  function armPattern(tGun = B.t + (R.S?.prestartS ?? R.hand?.prestartS ?? RACE.prestartS)) {
    R.pattern = R.hand ? makePattern(R.hand.shifts, { tGun, raceS: minutesFor(R.hand) * 60 * (R.hand.pace || 2) }) : null;
    if ('pattern' in windField || R.pattern) windField.pattern = R.pattern;
    stats.shifts = R.pattern?.id ?? null;
  }
  // what every new race starts with (R and a level change too)
  function fresh() {
    R.stopDeep();   // a hunt in progress does not carry into the new race (Restart, Next race, a level change)
    R.raceN++;   // step D2: a new race (the race ladder's guard times start again)
    lodSt.reset();   // the fleet's bands afresh (lod.js)
    R.coach = createCoach({ coach: R.aids.coach }); R.review = createReview();
    R.boatById = new Map(R.S.boats.map((b) => [b.id, b]));
    R.moments = createMoments({ names: Object.fromEntries(R.S.boats.map((b) => [b.id, b.name])) }); stats.moments = [];
    R.lastClock = null; R.finishAt = null; R.result = null; R.resultT = 0; R.lastSign = 0; R.knocked = null;
    R.salute = null; stats.salute = null; stats.knocks = []; stats.deep = null; R.endHold();
    R.phase2Fresh();
    R.deep = hooked('tessie') && tessie() ? createTessieDeep({ area: areaOf('tessieWaters'), depthAt, pace: R.aids.pace ?? R.hand?.pace ?? 2, seed: R.hand?.raceSeed ?? seed }) : null; stats.attacks = []; R.camK = 1; R.linesT = 1; R.lastKey = ''; R.shiftSaid = { intro: false, at: -1e9 }; stats.shiftLines = [];
    stats.start = null; stats.result = null; stats.calls.length = 0; stats.coach = R.coach.log; stats.clock = R.S.race.clock; stats.status = 'prestart'; stats.helper = R.S.helper; stats.line = null;
    pic.ghost = R.S.ghost; pic.ghostHeading = R.S.me0.heading; pic.aids = R.aids;
    R.ui?.results(null); R.ui?.level(R.aids); R.ui?.helperButton(false); R.ui?.line(null);
    R.thenUntil = -1; R.gateA = null; R.gateLeg = -1; R.flash = null; R.flashUntil = -1; R.legLitUntil = -1;
    // the course card: the hub's board art, the marks numbered, open for the pre-start's first CARD.openS (desktop; a phone has none)
    R.cardT = 0; R.cardAuto = true; R.raceStart = R.S.race.clock;   // the race's first clock (−0:45 in the box; a flying start's few seconds)
    if (R.ui) { R.cardSvg = courseSvg(R.course, { w: 200, h: 150, pad: 14, labels: true, stroke: 1.4, size: 13 }); R.ui.card(R.cardSvg, { open: !R.fly, show: true }); }
    // step C: the race type's own start (a time trial's best run on today's course; a pursuit's start order said once)
    stats.event = R.hand?.event ?? 'fleet'; stats.slots = R.S.slots ? { ...R.S.slots } : null; stats.splits = []; stats.rounds = []; R.chip = null; stats.chip = null;
    R.trial = null;
    if (R.hand?.event === 'trial') {
      const key = trialKey(R.hand), best = persist ? loadTrial(store, key) : memTrial.get(key) ?? null;
      const pts = best ? best.path.map((p) => [...fromFrame(R.course.line, p[0], p[1]), p[2]]) : [];
      R.trial = { key, best, pts, draw: thin(pts).map((p) => [p[0], p[1]]), rec: [], next: 0, splits: [], lastSplit: null };
      stats.trial = { key, best: best?.t ?? null, pts: pts.length };
    }
    const po = R.S.slots ? pursuitOrder(R.S.slots, NAMES) : null; stats.pursuit = po;
    if (po) R.coach.note(po.text, 6, 'pursuitOrder', true);
  }
  // the race's ground: the course laid to the wind blowing now (the hand's wind and hour already set), the race's wind, the box
  function prepare() {
    windField.at?.(B.t);
    const dir = Math.round(windField.base?.dirDeg ?? course0.designWindFrom);
    R.course = layCourse(dir);
    R.env = B.env(B.t); R.pageWind = R.env.windAt;
    const band = hooked('storm') ? STORM_RUN.band : GUST_BAND;   // Storm Run: the squall's gusts let through
    R.baseWind = (x, z, t) => fairGust(R.pageWind(x, z, t), windField.base?.speedMs ?? 0, band);   // the race's gusts held in their band (geometry.js)
    pinWind();
    pic.line = R.course.line; pic.legs = R.course.legs;
  }
  // the race laid again for a new hand (the wind's clock let go first: the hour moved)
  function relay() {
    if (R.stormOn) { try { onStorm(null); } catch { /* the page's storm */ } R.stormOn = null; }
    if (B.driven) B.drive(null);
    if (R.env && R.pageWind) R.env.windAt = R.pageWind;
    unpinWind();
    prepare();
    build();
  }
  function startUi() {
    if (live && canvas && !R.ui) R.ui = createRaceUi({ canvas, onHelper: () => helperOn(), onRestart: () => restart(), onLeave: () => quit(), inProgress, onLevel: (id, ll) => R.setLevel(id, ll), onHome: () => onHome(), onHub: R.door.hub ? () => R.openHub() : null, onShowCourse: () => R.flyover(), onCupNext: () => R.cupNext(), onCupNew: () => R.cupNew() });
  }

  async function enter(opts = {}) {
    if (R.on) { if (R.door.hub && !R.hubOpen) R.openHub(); return R.api; }   // the card's Regatta during a race: the hub, a new hand
    R.door = { ...hubAtEnter(flags, live), ...opts };
    if (isPlace(flags.course) && !opts.hub) { R.door = { hub: false, deal: false }; R.dealNow(placeHand(flags.course, R.setup, { seed: R.urlSeedFor(0), levels: LEVELS })); }
    else if (R.door.deal && R.door.hub) R.dealSel(R.startSel());   // the hub opens on the first race of the area's cup, laid behind it
    else if (R.door.deal) R.dealNow();
    else if (live) { const o = loadLevel(store); R.level = o.level; R.laylinesOpt = o.laylines; R.aids = aidsFor(R.level, { laylines: R.laylinesOpt }); stats.level = R.level; }   // a level picked since (Setup, an earlier race)
    R.hubOpen = !!R.door.hub; stats.hub = R.hubOpen; R.hubT = 0; R.hubSm = null; R.hubK = R.hubOpen ? 1 : 0;   // step D1: the mode's entry cuts to the hub's frame (the race's camera cuts in too)
    prepare();
    R.horn = live && audio ? createHorn({ audio, at: { x: R.course.line.committee[0], z: R.course.line.committee[1] } }) : null;
    R.chime = live && audio ? createChime({ audio }) : null;
    lines.setActive(true); props.setActive(true);
    sailHud?.enter?.();   // R4: Sail's passage plan steps aside (its route and waypoints; restored on leave)
    if (!R.hubOpen) startUi();
    build();
    R.on = true; stats.on = true;
    if (R.hubOpen) { if (hubUi) { R.hub ??= R.makeHub(); R.hub.show(R.hubModel()); } }
    else {
      R.ui?.watch && paintClock();
      if (live && !R.hand && !loadLevel(store).chosen) R.ui?.picker(true);   // the URL's first race: the level, never blocking (Beginner meanwhile)
      R.maybeFly();
    }
    if (live) globalThis.addEventListener?.('velia:regatta-level', R.heard);   // Setup's race level row
    onMode('regatta');
    return R.api;
  }
  function leave() {
    if (!R.on) return;
    R.endFly(false);
    // Tessie's Deep left mid-attack: she stops hunting and goes down (her sim keeps its own clock); the player's hold ends
    R.stopDeep();
    R.held = false;
    if (R.stormOn) { try { onStorm(null); } catch { /* the page's storm */ } R.stormOn = null; }   // Storm Run left: the squall sent away
    R.glass = null; R.chase = null; look.reset();
    if (B.driven) B.drive(null);
    if (R.env && R.pageWind) R.env.windAt = R.pageWind;
    unpinWind();
    globalThis.removeEventListener?.('velia:regatta-level', R.heard);
    if (windField.pattern) windField.pattern = null; R.pattern = null;   // the lake's own shifts again
    lines.setActive(false); props.setActive(false); boat?.setRivals(0); sailHud?.leave?.(); if (B.ctl) B.ctl.jibFree = false; lodN.near = lodN.mid = lodN.far = 0;
    R.ui?.dispose(); R.ui = null; R.hub?.dispose(); R.hub = null; R.hubOpen = false; stats.hub = false;
    R.on = false; stats.on = false; R.S = null; R.auto = null; R.coach = null; R.review = null; lean()?.hold('rounding', false);
  }
  // Leave race (owner, 2026-11-20: "We need a way to quit the current game; I can only restart or refresh the page"): free Sail where
  // she is (the page's mode switch: onLeave → Sail, which calls leave(); no reload), the rivals, the marks and the lines gone, nothing
  // recorded (a time and a medal are kept only at a finish). The race's own controls ask "Leave race?" while it is in progress
  // (inProgress); the results card and the menu card's row after a finish leave at once
  function quit() {
    if (!R.on) return false;
    try { onLeave(); } catch (e) { console.error(e); }
    if (R.on) leave();   // no page mode switch (a test, a capture): the race is left here
    return true;
  }
  const inProgress = () => !!(R.on && !R.hubOpen && R.S && R.result == null && R.finishAt == null);
  function restart() {
    if (!R.S || R.hubOpen) return;
    R.endFly(false);
    R.S.restart(); R.officer = createOfficer({ forgiving: R.aids.forgiving }); floats.reset(); R.floatT = null;
    B.drive(R.aids.helper || R.auto ? driveHelper : null);
    unpinWind(); pinWind();
    armPattern();
    fresh();
  }
  function helperOn() { if (R.aids.helper && R.S?.helperOn()) { B.drive(driveHelper); R.coach?.note('The helper has her until the gun.', 4, 'helperOn'); } }
  function paintClock() { R.ui?.watch({ clock: R.S.race.clock, status: 'prestart', ocs: false, line: { distM: 0, timeS: null, burnS: null }, wind: null, next: null, layline: null, helper: R.S.helper, finish: null }); }
  Object.assign(R, { driveHelper, build, armPattern, relay, startUi, enter, leave, quit, inProgress, restart, helperOn, paintClock });
}
