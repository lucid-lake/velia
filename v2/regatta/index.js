// Regatta on v2 (BACKLOG-v2 #12; R1 the box and the clock, R2 the course on the water, R3 the coach,
// the levels and the results card), its own chunk (main.js imports it when Regatta is asked for: nothing of it runs or loads in Sail
// or Cruise). Tap Regatta and you are in the box at −0:45, no card first (owner 2026-11-14); the start helper sails an untouched
// boat to a clean start (Beginner); the watch (the clock, the line's metres and seconds, the time to burn); the officer's calls and
// the committee boat's horns (v1's); the course laid to today's wind (v1's Island Sprint turned about its line) and moved, when it
// must, into fair wind (R3: geometry.js layFairCourse); on the water: the glowing line and its two ends, the 20 m line, the gold
// ghost, the cream laylines (the one to tack on amber), the zone and its turn arrow, the course line, the lit finish (render/raceLines.js), the
// committee boat, the pin, the marks and the computer boat (render/raceProps.js). R3: the coach's one line with its cue lit on the
// water (coach.js), Beginner / Club / Pro (levels.js: stored, picked on the first race or from the watch's chip or Setup), the
// results card (review.js: place, time, the gap, the medal, one tip; Race again, Home). R4 brings the fleet; the session takes up
// to 5 rivals already (6 boats at most, owner 2026-11-14).
//   const R = createRegatta({ B, windField, clock, terrain, water, flags, P, canvas, lines, props, audio, onMode, onHome })
//   await R.enter({ fresh })   the race at −0:45;  R.leave() Sail again (the boat stays where she is)
//   R.quit()                   Leave race (the watch's Leave, the results card's Leave, the Menu card's Leave race): onLeave() (the page's
//                              mode switch to Sail, in place), nothing recorded;  R.inProgress  the race sailed and not yet finished
//   main.js's frame while R.on: R.beforeStep(hands, helm) (a steer or the cockpit wheel in the hand hands the helm back), B.step,
//   R.afterStep(), R.camera(dt, pose), R.frame(viewProj, w, h) (the props, the lines, the tags at this frame's camera)
//   R.settle(seconds)          a capture: the race sailed on that long (the helper, then ?autoplay's pro, at the helm)
//   R.setLevel(id, laylines)   a level picked (a preset: both dials): stored, the race back in the box with that level's aids and rivals
// The front door (owner 2026-11-16: Regatta opens on a hub): enter() on a live page with no race-shaping URL flag
// deals today's hand (setup.js: the course's length, the wind's level, the time, the sky, the fleet), sets the page's wind, clock and
// sky to it, lays the box behind the hub (the race held at −0:45, the boat kept in her box) and shows the hub (hub.js);
//   R.go()          In the box: the race from −0:45 with the hand's settings     R.deal()   Another hand: a new hand, the box laid again
//   R.adjust(setup) the two dials (rivals' skill, your aids) or a preset          R.openHub() the hub again (the results card's New hand)
// Race again stays instant (restart: no hub). ?quick=1 deals a hand and goes straight in the box.
// The flying start (owner 2026-11-16: no long wait in the box): a dealt hand (and Custom's default) starts the fleet already sailing at
// the line with an 8.5 s countdown at the hand's pace (session.js FLY); the hub's button says To the line; the gun waits for the first
// bow at Beginner and Club. A Pro hand deals the box now and then; the URL's race keeps the box at −0:45.
// Step B: the hand names its course (Harbour Dash, the Island Sprint, Twice Round, Bay Tour), its laps, its shift
// pattern (shifts.js, set on the wind module while the race runs), its pre-start and its pace; Custom race (the hub's Custom sheet)
//   R.custom(patch)  a Custom pick stored     R.raceCustom()  Race ›: the Custom race in the box     R.dealForMe()  back to dealt hands
// The guidance pass (owner 2026-11-16: one thing at a time on the water; lines.js): the marks numbered 1, 2 … F (marks.js) on their tags,
// their buoys' plates and the watch ("Leg 1 of 3 · Mark 1 · round to port"); the course card for the pre-start's first CARD.openS (desktop);
// the fly-over (flyover.js) on the first race of a course in a session, the race held at −0:45 while it plays
//   R.flyover()      the course card's Show course     R.beaconView()  the beacon's race target (main.js: the fly-over's mark, the
//                    committee boat on the last leg, else the next mark)
// Step C (owner 2026-11-17): the hand's race type (events.js): a match race (one rival who covers; the race chip
// "Ahead 12 m" / "Behind 8 m"; a 1 v 1 results card), a time trial (alone; the best run per course and length kept with its path and
// splits, its ghost on the water, a split at each mark against the best), a pursuit (each boat at her own start, the slowest first; the
// hub, the coach and the chip give her order and her time); the Emerald Cup (cup.js: 4 races, low points, the standings after each,
// the podium at the end; the hub's Cup card)
//   R.cupGo()   the hub's Cup card: the Cup's next race (a new Cup when there is none or the last is done)
//   R.cupNext() the results card's Next race ›      R.cupNew()  Start a new Cup
// Place races (owner go 2026-11-19; places.js): a race pinned to its place, its hour setting the wind; the
// registry (places.js listCups) is what the hub lists. R.racePlace(id) sails one (the hub's race row; ?course=<id> from the URL);
// the course is never turned or moved (layCourse), the gates are the channel's own buoys (no race buoy drawn on them; the gate's
// line on the water), the finish its own line. Pass the Channel: the player's finish fires the barges' salute (onSalute(): the
// page's fireworks, desktop and tablet; a phone gets the committee horn). Tessie's Deep (tessie(): the page's Tessie plug-in, or
// null on a phone): she hunts the fleet the whole race, an attack every 20–35 s, each warned by natural cues only (tessieDeep.js; no ring on the water, owner 2026-11-20), her ring knocks a boat down; a knockdown in a place
// race (knocks.js) holds her 12 s, a second one is a DNF (R.placeKnock(e): the page's knockdown watch asks first).
//   R.racePlace(id)   the place race in the box at once     R.placeRace  the row in force (null: not a place race)
//   R.tessieRace      Tessie allowed now (the page lets her surface in this race)     R.salute  { at, shown } once fired
// Phase 2 (4.6, 4.7; owner go 2026-11-19): Glass Boat Chase (glassBoat(): the page's glass boat sim, or null on a
// phone: chase() starts her from her Fannette stop just before the countdown, her head start; her wash slows the boats in it:
// S.wash, glassChase.js), Storm Run (onStorm(plan): the page's storm started at the gun on stormRun.js's arc, onStorm(null) stops it;
// the race's gust band widened; a rival may be knocked down in a strong gust), Lights on the Lake (R.showRace: the page lets the
// fireworks draw in this race; its hour 21:42 puts the show at 21:44, two minutes after the gun). The camera turns toward Tessie during
// a strike near the player (tessieLook.js; reduced(): no look). "Sail the cup" (placeCup.js): R.cupSail(cupId) the cup's races back to
// back, the same fleet, low points; the results card's Next race › sails the next. The hub opens on the cup of the area the boat is in.
//   R.glassRace  R.showRace  R.stormRace   the race's hero feature in force     R.placeCup  the series in force (null: none)
// The parts (refactor round 3 C4): createRegatta assembles them over one shared state object R (inside the code: the inputs, every
// race variable as R.x, the constants, each part's functions; outside, the returned api above): raceLoop.js (enter, leave, build,
// fresh), raceStep.js (each step, the coach, quiet), hubGlue.js (the hub, deals, levels, the hub's camera), placeEvents.js (Tessie's
// Deep, knockdowns, Glass Boat Chase, Storm Run), raceCamera.js (race poses, fly-overs), racePicture.js (props, lines, tags),
// raceResult.js (the results card), tuning.js (the constants)
import { courseFor } from '../../src/sim/race/course.js';
import { isPlace, placeOf } from '../sim/racePlaces.js';
import { createWashTrail } from './glassChase.js';
import { createTessieLook } from './tessieLook.js';
import { loadPlaceCup } from './placeCup.js';
import { FLEET } from './session.js';
import { ZONE_M } from './geometry.js';
import { createSegmentWriter } from './lines.js';
import { RACE } from './plan.js';
import { lodState } from './lod.js';
import { rgbaOf } from '../render/raceProps.js';
import { MAX_NEAR_RIVALS, packTint } from '../render/boat.js';
import { packArt, rivalArt } from '../render/sailArt.js';
import { aidsFor, loadLevel } from '../sim/raceLevels.js';
import { loadCup } from './cup.js';
import { DEFAULT_SETUP, WATERS, loadSetup } from './setup.js';
import { GATE } from './marks.js';
import { createRivalFloats } from './rivalFloat.js';
import { RESULTS } from './tuning.js';
import { installCamera } from './raceCamera.js';
import { installPlaceEvents } from './placeEvents.js';
import { installHub } from './hubGlue.js';
import { installRaceLoop } from './raceLoop.js';
import { installRaceStep } from './raceStep.js';
import { installResults } from './raceResult.js';
import { installPicture } from './racePicture.js';
export { RACE_CAM, RESULTS, ROUND_FX, HUB_CAM, CAM_RATES, raceCamEase, SHORT, COURSE_SCALE, CARD, QUIET, SHIFT_COACH, compass } from './tuning.js';

export function createRegatta({ B, windField, clock, terrain, water = null, flags = {}, P = {}, canvas = null, lines, props, audio = null, onMode = () => {}, onHome = () => {}, rivals: rivals0 = RACE.rivals, store = globalThis.localStorage, boat = null, gpuLite = () => false, sailHud = null,
  sky = null, onLeave = () => {}, persist = !P.headless, hubUi = !P.headless, lean = () => null, onSalute = () => false, tessie = () => null,
  glassBoat = () => null, onStorm = () => false, reduced = () => false, has = null }) {   // phase 2: the glass boat's sim, the page's storm, Reduce Motion, the device's features (places.js hasFrom)   // lean(): Sail's lean skipper (v2/ui/leanSkipper.js), the card's one rule
  const R = { B, windField, clock, terrain, water, flags, P, canvas, lines, props, audio, onMode, onHome, rivals0, store, boat, gpuLite, sailHud, sky, onLeave, persist, hubUi, lean, onSalute, tessie, glassBoat, onStorm, reduced, has };   // the shared state: the inputs, every let below (R.x), the constants and each part's functions
  const live = !P.headless;
  const rivals = Number.isFinite(parseInt(flags.rivals, 10)) ? parseInt(flags.rivals, 10) : rivals0;   // R4: ?rivals= (fleetSize caps it at 5)
  const seed = Number.isFinite(parseInt(flags.seed, 10)) ? parseInt(flags.seed, 10) : 1;
  const depthAt = (x, z) => -terrain.field.height(x, z);
  const short = flags.course === 'short', full = flags.course === 'full';
  const course0 = courseFor(WATERS, short || full || isPlace(flags.course) ? undefined : flags.course);
  const courseOfHand = () => (R.hand && !R.hand.place ? courseFor(WATERS, R.hand.course) : course0);
  // a place race in force (places.js): its row, its Tessie director, the salute's once, the player's hold after a knockdown
  R.deep = null; R.salute = null; R.held = false;
  // phase 2: the glass boat in her chase and the catch, the storm started, the rivals the storm has knocked, the camera's Tessie look,
  // the cup series in force (Sail the cup)
  R.glass = null; R.chase = null; R.stormOn = null; R.washT = null; const stormKnocked = new Set(), look = createTessieLook(), washTrail = createWashTrail();
  R.placeCup = persist ? loadPlaceCup(store) : null;
  const hasF = (f) => (has ? !!has(f) : f === 'tessie' ? !!tessie() : f === 'glassBoat' ? !!glassBoat() : true);
  const placeRow = () => (R.hand?.place ? placeOf(R.hand.place) : null);
  const hooked = (k) => !!placeRow()?.hooks.includes(k);
  R.on = false; R.S = null; R.course = null; R.baseWind = null; R.pageWind = null; R.env = null; R.ui = null; R.officer = null; R.horn = null; R.chime = null; R.auto = null;
  // the rounding's moment (owner 2026-11-17): the watch's "Mark 1 ✓" until flashUntil (real seconds), the new leg lit until legLitUntil
  R.flash = null; R.flashUntil = -1; R.legLitUntil = -1;
  R.huntBare = false;   // the race's props and lines hidden while the hub previews a hunt's area
  R.hubSm = null;   // the hub's eased frame (pos, target, fov): follows hubPose when the selection moves the course
  R.hubK = 0;   // step D1: the hub's camera share (eased)
  R.linesT = 1; R.lastKey = ''; R.camK = 1; R.liftK = 0; R.camYaw = 0; R.coach = null; R.review = null; R.lastClock = null; R.finishAt = null; R.result = null; R.resultT = 0; R.lastSign = 0;
  R.knocked = null;   // K3: knocked down in this race: the end card's model ({ line, tip }); the results card says DNF
  R.pinned = null; R.moments = null; R.tickEvents = []; R.lastLine = null; R.lastLineAt = -45; R.pattern = null; R.shiftSaid = { intro: false, at: -1e9 };
  // the guidance pass: the fly-over (and the courses flown this session), the real clock (the dashes, the then leg's light), the gate's
  // bearing (frozen near the mark), the course card's clock
  R.fly = null; R.flyHold = false; R.raceStart = -45; R.flyPose = null; R.realT = 0; R.thenUntil = -1; R.gateA = null; R.gateLeg = -1; R.cardT = 0; R.cardAuto = false; R.cardSvg = '';
  // the front door: the settings the player keeps (setup.js), the hand in force (null: the URL's race, as before the hub), the hub
  R.setup = persist ? loadSetup(store) : { ...DEFAULT_SETUP, chosen: true }; R.hand = null; R.hubOpen = false; R.hub = null; R.hubT = 0; R.door = { hub: false, deal: false }; R.sel = null;   // sel: the hub's selected place race (select, then go)
  // step C: the Emerald Cup kept in the browser (a capture keeps it in memory), a time trial's run and best, the race chip's words
  R.cup = persist ? loadCup(store) : null; R.trial = null; R.chip = null;
  const NAMES = Object.fromEntries([['me', 'You'], ...FLEET.map((f) => [f.id, f.name])]), HULLS = Object.fromEntries(FLEET.map((f) => [f.id, f.hull]));
  const mctx = { progress: {}, me: null, rivals: [], order: null, view: null, inZone: false, finishLeg: false, windFrom: 0, events: null, windAt: (x, z) => R.baseWind(x, z, B.t) };   // the moments' context, reused   // the wind's day clock before the race pinned it (fair wind inside a race: shifts and gusts, no day change)
  // the level: the stored choice (a capture has none: Beginner)
  const stored = live ? loadLevel(store) : { level: 'beginner', laylines: false, chosen: true };
  R.level = stored.level; R.laylinesOpt = stored.laylines; R.aids = aidsFor(R.level, { laylines: R.laylinesOpt });
  const W = createSegmentWriter();
  const pic = { line: null, clock: -45, ocs: false, gunLitS: 4, ghost: null, ghostHeading: 0, legs: null, leg: 0, laylines: null, zone: null, finish: false, path: null, aids: R.aids, lit: new Set(), layTarget: null, layTargetM: Infinity,
    boat: [0, 0], march: 0, thenLit: false, compactScreen: false, markM: Infinity, gate: null };
  const gate = { at: [0, 0], r: GATE.zoneK * ZONE_M, rounding: 'port', a: 0, hot: false };
  const zone = { at: [0, 0], r: ZONE_M, inside: false, rounding: 'port', a0: 0 };
  const sit = { clock: -45, status: 'prestart', ocs: false, legKind: null, leg: 0, finishLeg: false, lay: null, inZone: false, rounding: 'port', next: null, target: null, tacked: false, wrongSide: false, cue: false };
  // R4: the fleet's level of detail (lod.js): near rivals on the boat renderer's full-detail slots, mid as the props' lite boat, far as
  // the silhouette; the colours once (FLEET's sRGB hulls)
  const markBody = { x: 0, z: 0, vx: 0, vz: 0 }, markProbe = (x, z) => { markBody.x = x; markBody.z = z; return markBody; };
  const lodOut = [], lodPts = [], lodSt = lodState(), nearPoses = Array.from({ length: MAX_NEAR_RIVALS }, () => ({})), lodN = { near: 0, mid: 0, far: 0 };
  // the rivals' hull floats (rivalFloat.js): the player's float on the same surface, one pose for every band; stepped each frame on the
  // boat's sim clock (B.t: the player's float steps on it too)
  const floats = createRivalFloats({ heightAt: water?.heightAt ? (x, z, o) => water.heightAt(x, z, o) : null, now: () => clock?.t ?? null });
  R.floatT = null;
  // the mainsail's graphics (owner 2026-11-18, render/sailArt.js; off under ?sailart=off): the fleet in white hulls, each rival told
  // apart by her sail (her number, cloth and insignia colour: FLEET's order + 1, the same sail every race), near and lite alike
  const artOn = !!boat?.sailArt, WHITE_HULL = '#F2EFE8';
  if (artOn) { const arts = FLEET.map((f, i) => rivalArt(f, i + 1)); boat.setRivalArt(arts); props?.setArt?.(arts.map(packArt)); }
  const hullRgba = new Map(FLEET.map((f) => [f.id, rgbaOf(artOn ? WHITE_HULL : f.hull)])), hullTint = new Map(FLEET.map((f) => [f.id, artOn ? 0 : packTint(f.hull)]));
  const artOf = new Map(FLEET.map((f, i) => [f.id, artOn ? i + 1 : 0]));
  const stats = { rounds: [], lod: lodN, lodBands: lodOut, on: false, ticks: 0, rebuilds: 0, segments: 0, helper: false, status: null, clock: null, events: 0, calls: [], start: null, level: R.level, coach: [], line: null, result: null, fair: null, wheel: 0 };
  const memTrial = new Map();   // a capture's (or a blocked store's) best runs, this page only
  R.raceN = 0;
  function windFromAt(x, z) { const w = R.baseWind(x, z, B.t); return Math.atan2(-w.vx, w.vz); }
  R.boatById = new Map();
  Object.assign(R, { live, rivals, seed, depthAt, short, full, course0, courseOfHand, stormKnocked, look, washTrail, hasF, placeRow,
    hooked, NAMES, HULLS, mctx, stored, W, pic, gate, zone, sit, markBody, markProbe, lodOut, lodPts, lodSt, nearPoses, lodN, floats,
    artOn, WHITE_HULL, hullRgba, hullTint, artOf, stats, memTrial, windFromAt });   // the assembler's constants, read by every part
  installCamera(R);
  installPlaceEvents(R);
  installHub(R);
  installRaceLoop(R);
  installRaceStep(R);
  installResults(R);
  installPicture(R);

  const api = {
    // K3: knocked down (the page's knockdown game, after its slow): this race is a DNF and its results card comes now; the Cup goes on
    knockdown(model = {}) { if (!R.S || R.result != null) return false; R.knocked = { line: model.line ?? '', tip: model.tip ?? '' }; if (R.finishAt == null) R.finishAt = R.S.t - RESULTS.afterS; stats.knocked = true; return true; },
    get knocked() { return !!R.knocked; },
    racePlace: R.racePlace, placeKnock: R.placeKnock, cupSail: R.cupSail, select: R.select, explore: R.explore, get selected() { return R.sel; },
    get glassRace() { return !!(R.on && !R.hubOpen && hooked('glass')); }, get showRace() { return !!(R.on && !R.hubOpen && hooked('show')); }, get stormRace() { return !!(R.on && !R.hubOpen && hooked('storm')); },
    get placeCup() { return R.placeCup; }, get glass() { return R.glass; }, get look() { return look; },
    get placeRace() { return placeRow(); }, get tessieRace() { return !!(R.on && R.deep && !R.hubOpen); }, get salute() { return R.salute; }, get deep() { return R.deep; }, get held() { return R.held; },
    enter: R.enter, leave: R.leave, quit: R.quit, restart: R.restart, helperOn: R.helperOn, get inProgress() { return R.inProgress(); }, setLevel: R.setLevel, beforeStep: R.beforeStep, afterStep: R.afterStep, camera: R.camera, frame: R.frame, settle: R.settle, stats, racing: R.racing, quiet: R.quiet, lights: R.lights, go: R.go, deal: R.deal, adjust: R.adjust, openHub: R.openHub, custom: R.custom, raceCustom: R.raceCustom, dealForMe: R.dealForMe, flyover: R.flyover, beaconView: R.beaconView, cupGo: R.cupGo, cupNext: R.cupNext, cupNew: R.cupNew,
    get cup() { return R.cup; }, get trial() { return R.trial; }, get chip() { return R.chip; }, get raceN() { return R.raceN; },
    get fly() { return R.fly; },
    get pattern() { return R.pattern; },
    get hubOpen() { return R.hubOpen; }, get hand() { return R.hand; }, get setup() { return R.setup; }, get hub() { return R.hub; },
    get floats() { return floats; },   // the rivals' floats (rivalFloat.js): floats.get(id) → { heave, pitch, roll } as drawn this frame
    get on() { return R.on; }, get session() { return R.S; }, get course() { return R.course; }, get coach() { return R.coach; }, get review() { return R.review; }, get aids() { return R.aids; }, get ui() { return R.ui; },
    speed: () => (Number.isFinite(parseFloat(flags.speed)) ? Math.min(8, Math.max(0.1, parseFloat(flags.speed))) : R.aids.pace ?? RACE.speed),   // R4: the level's pace (levels.js: 2 ×, Pro 1.5 ×); ?speed= for the tests
    state: () => (R.S ? { ...R.S.state(), ...stats, lines: lines.stats, props: props.stats } : { on: false }),
  };
  R.api = api;
  return api;
}
