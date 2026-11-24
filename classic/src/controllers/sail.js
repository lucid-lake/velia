// The sloop's sail controller (refactor round 2, Phase C step 8): Day Sail's
// live controls (the hints) on the deck (src/deck/index.js: the
// keys, the mouse, the dock, the views and the bar), the pilot, the hand on the sheets, the wind level, the captain's view,
// the quiet hints, the helm station and the physics tick; update(dt) steps the boat, the cameras (through the deck) and
// the boat's sound once per frame. Live pages only (not ?headless). src/sail/controls.js builds the deck and this.
//   const api = attachSailController(core, sail, deck, { handover, helmPick });
// The skills, the sailor's words, the hint line and the skipper's notes come from the craft's lesson set (src/lessons/,
// Phase C step 10: craftOf(phys.vessel).lessons); the boat's sound is the craft's own (sail.boatAudio, src/craft/hull.js).
// Two verbs: the helm and the sheets. A/D or ←/→ steer (let go and the pilot holds the course). W or ↑ pulls the
// sheets in, S or ↓ eases them out; the sheet stays where you leave it; the crew matches the jib to the main, and
// trims for you only after 12 s of wrong sails with your hands off (sheets.js). 1 2 3 4 set the wind (4–7, 8–12,
// 13–17, 18–24 kn; 3 by default) and it blows in over ≈ 25 s. Drag to look, wheel closer, C the helm view and back
// (a ≈ 1 s camera move, viewBlend.js; the view switch at the bottom centre does the same, viewSwitch.js; Shift+C the chase), V the boat from above (a plan-view glyph, on use by default; V pins it, V again hides it),
// hold H for the keys, L the logbook.
// The load feel (feel.js, rumble.js): the winch slows as the sheet loads up, easing stays quick; the
// helm is heavier bearing away against the weather helm; a gamepad rumbles for a gust, a wave's slam, flogging sails
// and a surf (?rumble=0 off).
// Time runs at 2×, no fast-forward. A gamepad (RT pull, LT ease, the stick the helm) and touch (left half the helm, a
// drag down on the right half pulls in) feed the same verbs (pads.js).
// Untaught: T hands the sheets to the crew and back, R/F the jib alone (with ?autotrim=0), G wing-on-wing, K reef,
// Shift+K auto-reef (B until 2026-10-29: B is the binoculars now; the crew reefs on its own).
// The captain's tools (captainTools.js): B the binoculars (up until B again; the mouse aims), O the VHF's
// weather channel; the dock's icons and the set in the helm view do the same. Every key: keys.js (tests/binoculars.test.mjs
// checks them for collisions).
// Pro mode (?pro=1, or P): the sail controls the crew keeps in basic mode are yours: Q/E the traveller
// (down to leeward / up to windward), Z/X the twist (open the leech / close it), Shift+Z / Shift+X the backstay (ease /
// on), R/F the jib's lead (the car forward / aft; Shift+R/F with ?autotrim=0, where R/F is the jib sheet). Each moves
// at PRO.rate and stays where you leave it. Gamepad: d-pad ←/→ the traveller, LB/RB the twist, A or B held with d-pad
// ←/→ the jib lead or the backstay. The pod shows the lift / header trend. H lists them under "pro".
// The mouse and touch (owner, 2026-10-29: "people won't remember all the keys"): every key stays.
// A click on the water (under 5 px and 250 ms) sets a course there (course.js; A/D, the stick, the glyph's rudder or
// the wheel cancel it) with a small ripple; a drag (left or right button) orbits, the wheel zooms. The glyph is a
// control: drag its sail line to trim, its rudder to steer. In the helm view the winch pulls while held, the sheet's
// tail eases while held, a drag on the wheel steers (helmPick.js). The tool dock (top-left, toolDock.js) fades in
// on a mouse move with an icon per tool, its key on hover. The input modality ('mouse' | 'keys' | 'pad', pointer.js)
// is the 'modality' service (core.services), for the hints.
// The skill model (skills.js): it watches the state and the inputs (keys, pad, the mouse's hand on the
// glyph and a clicked course), the hints speak only to a struggle with a skill not yet shown, a pro goes quiet in the
// first minute, the crew's net fades (12 s → 25 s → off) as trim and the groove are mastered unless set in H (K), and
// the pilot is a setting there too (O; ?pilot=0 starts it off). The pro rows join the H list once trim is mastered
// (or pro is on: P, ?pro=1). ?once=0 keeps the skills in memory only; ?skills=reset clears the save.
import { DEFAULT_SPEED } from '../../../src/sim/boat/contract.js';
import { DEFAULT_TIMERATE, SpeedCue, NIGHT_LINE } from '../../../src/sim/timeOfDay.js';
import { CONTROLS, Helm, KN, PRO } from '../../../src/sim/boat.js';
import { createSkipperVoice } from '../../../src/ui/skipperVoice.js';   // the old skipper speaks each hint line once
import { createCaptainView } from '../../../src/ui/captainView.js';
import { HandSheets } from '../../../src/sim/sail/sheets.js';
import { createPads } from '../../../src/sail/pads.js';
import { createTouchUi } from '../../../src/ui/touchUi.js';
import { winchRate, sailForce, weatherHelm, helmTau, WINCH, HELM } from '../../../src/sim/sail/feel.js';
import { createRumble } from '../sail/rumble.js';
import { createGustFx } from '../../../src/gustFx.js';
import { createShowNow } from '../sail/showNow.js';
import { LEVEL_BLOW } from '../../../src/sim/wind.js';
import { pullToward } from '../../../src/ui/captainView.js';
import { ICONS } from '../../../src/ui/toolDock.js';
import { CoursePilot, bearingFrom, rayToWater, rayHitsBoat } from '../sail/course.js';
import { TackCarry, pilotHeading } from '../../../src/sim/sail/tackCarry.js';
import { createCaptainTools } from '../sail/captainTools.js';
import { createSeamanship } from '../sail/seamanship.js';
import { attachGrounding } from '../../../src/sail/grounding.js';
import { KEY } from '../../../src/sail/keys.js';
import { createGloss } from '../ui/gloss.js';
import { linesStrength } from '../../../src/sim/air.js';
import { StateInterp } from '../../../src/sim/boat/interp.js';
import { touchDevice } from '../../../src/ui/device.js';   // phones: the first 3 skipper clips at once, the rest slowly (fix/ios-start-2)
import { StatusWatch } from '../../../src/ui/statusLine.js';
import { createBinocularsHud } from '../../../src/ui/binocularsHud.js';
import { HAND, trimBoost } from '../../../src/sim/sail/sheets.js';
import { LetFly, jibTrimRange } from '../../../src/sim/sail/letFly.js';
import { lessonsFor } from '../lessons/index.js';   // the craft's lesson set: skills, words, the hint line, the skipper's notes (step 10)
import { craftOf } from '../../../src/sim/craft/index.js';
import { stationFor } from '../stations/index.js';   // the craft's helm station (step 9: src/stations/<craft>/)
import { createSimulation } from '../../../src/sim/sail/simulation.js';
import { clampFrame } from '../../../src/sim/sail/stepper.js';
import { STEADY } from '../deck/index.js';

// The key codes this controller reads (beside KEY's, src/sail/keys.js): the steering, the sheets, the pro trim, the wind
// levels, wing-on-wing, the Above view, the reef and the logbook. Every one is bound in KEYMAP (tests/binoculars.test.mjs).
export const SAIL_KEYS = Object.freeze({
  A: 'KeyA', D: 'KeyD', LEFT: 'ArrowLeft', RIGHT: 'ArrowRight', W: 'KeyW', S: 'KeyS', UP: 'ArrowUp', DOWN: 'ArrowDown',
  R: 'KeyR', F: 'KeyF', Q: 'KeyQ', E: 'KeyE', Z: 'KeyZ', X: 'KeyX', G: 'KeyG', V: 'KeyV', K: 'KeyK', L: 'KeyL',
  WIND: Object.freeze(['Digit1', 'Digit2', 'Digit3', 'Digit4']),
});
const K = SAIL_KEYS;

// sail: the assembled boat (src/sail/assemble.js); deck: src/deck/index.js, built for this page; shared (Cruise's hand-over,
// src/modes/chill/index.js): helmPick is the passenger's own, so the helm view's parts carry over (its helmCam and view go
// to the deck)
export function attachSailController(core, { boat, phys, follow, ride, boatAudio, sfx, air: windAir, ground = null, groundTerrain = null }, deck, { handover = null, helmPick: sharedPick = null } = {}) {
  const { flags, renderer, camera, lod, msg, T0, wind, services } = core;
  // the lessons this craft teaches (src/lessons/index.js; the sloop's: the sail set): a craft with none is refused here
  const craft = craftOf(phys.vessel);
  const lessons = lessonsFor(craft), NOTES = lessons.notes;
  // the craft's station (src/stations/index.js; the sloop's: the helm station, the cockpit and their parts): a craft with none
  // is refused here, before anything is on the page
  const mountStation = stationFor(craft.id);
  // the boat (assemble.js provides it before the controls attach; Regatta swaps its env in place): read once, so the
  // physics tick has no lookup
  const boatSvc = services.get('boat');
  // the deck (src/deck/index.js): the held keys, the mouse, the dock, the views and the bar; this controller fills its hooks
  const { keys, signal, modality, ripple, rayAt, loadingUp, fireKey, vkey, keysList, helmCam, blend, setView, toggleView } = deck;
  const course = new CoursePilot();
  let jibHeldS = 0, jibHeldDir = 0;   // how long one jib direction has been held (its rate ramps as the main's)
  let wheelSteer = 0, holdPull = 0, courseAt = -9;
  const setCourseAt = (x, y) => {
    const r = rayAt(x, y), o = r.ray.origin, d = r.ray.direction;
    const s = phys.state;
    if (loadingUp() || rayHitsBoat([o.x, o.y, o.z], [d.x, d.y, d.z], s)) return null;   // the loading card's click, the boat itself
    const hit = rayToWater([o.x, o.y, o.z], [d.x, d.y, d.z]);
    if (!hit) return null;
    course.set(bearingFrom(s, hit), s); holdHeading = course.heading; courseAt = deck.t; deck.used();
    ripple.spawn(hit.x, hit.z, hit.dist);
    return hit;
  };
  // the deck's hooks: a press in the helm view on one of its parts (helmPick.js: the winch pulls while held, the sheet's tail
  // eases while held, a drag on the wheel steers, 140 px to the stop), a click on the water (a course), a press while the
  // glasses are up (a click lowers them, no course), the mouse aiming the binoculars (B down, or the dock's icon latched them)
  deck.setHooks({
    onPart: {
      down(r) {
        const p = S.helmPick.pick(r);
        if (p) {
          p.held = true;
          if (p.role === 'pull') holdPull = 1; else if (p.role === 'ease') holdPull = -1;
          else if (p.role === 'steer') wheelSteer = 0;
          else if (p.kind === 'hold') p.action?.(true);
        }
        return p;
      },
      move(pr, e) { if (pr.part.role === 'steer') wheelSteer = Math.max(-1, Math.min(1, (e.clientX - pr.x0) / 140)); },
      up(pr, kind) {
        pr.part.held = false;
        if (pr.part.role === 'pull' || pr.part.role === 'ease') holdPull = 0;
        else if (pr.part.role === 'steer') wheelSteer = 0;
        else if (pr.part.kind === 'hold') pr.part.action?.(false);
        else if (kind === 'click') pr.part.action?.();
      },
    },
    onClick: (x, y) => { setCourseAt(x, y); },
    clickBlocked: (kind) => { if (!(tools.latched || tools.k > 0)) return false; if (kind === 'click') tools.setLatch(false); return true; },
    aiming: () => !!tools?.latched,   // B and the dock's icon latch them (captainTools.js); a key up never lowers them
  });
  // assists are settings, not a lesser mode (Cairn/Jusant): ?pilot=0 (let go and the helm centres; the
  // boat rounds up as a real one does), ?autotrim=0 (the old pro path: W/S main, R/F jib, no crew at all),
  // ?hand=0 (the crew trims, the 2026-10-29 W/S nudge on top), ?wind=1..4 the wind level, ?captain=0 no boat-from-above glyph
  const ctl = { ...CONTROLS, autoTrim: flags.autotrim };
  const once = flags.once;
  let skillStore = null;
  try { skillStore = once ? globalThis.localStorage ?? null : null; if (flags.skills === 'reset') skillStore?.removeItem('lakeshore.skills.v1'); } catch { skillStore = null; }
  const skills = lessons.createSkills({ storage: skillStore });
  let windLinesMode = 'off';    // on | auto | off; off by default (owner, 2026-10-30) (the Settings row; src/air.js linesStrength)
  // the sailor's words (ui/words.js): the hints say it plain with the term beside it, fading as the skills are learned; a
  // hover or a long press glosses a term; the logbook lists the ones met. The menu's setting is 'words'.
  let wordStore = null;
  try { wordStore = once ? globalThis.localStorage ?? null : null; if (flags.skills === 'reset') wordStore?.removeItem('lakeshore.words.v1'); } catch { wordStore = null; }
  const words = lessons.createWords({ storage: wordStore, skills, mode: flags.words === 'sailor' ? 'sailor' : 'both' });
  const gloss = createGloss({ words });
  services.provide('words', words); services.provide('gloss', gloss);
  // doing a thing is meeting its word: a skill learned means its terms were used
  const offSkills = skills.onChange((ev) => { if (ev.type === 'mastered') for (const t of lessons.terms) if (t.skills[0] === ev.id) words.meet(t.id); });
  // the pilot: a setting (H, then O), saved; ?pilot=0 starts it off
  let pilotOn = flags.pilot != null ? flags.pilot !== '0' : skills.pilot ?? true;
  const pilot = new Helm(); let holdHeading = phys.state.heading;
  // a beginner's tack carries through (tackCarry.js): a turn into the wind with way on is kept through, the crew backs the jib
  // if it slows, and the hint line says which way to keep turning; Pro turns it off
  const carry = new TackCarry(); let carryJib = false;
  const hand = new HandSheets(); let handOn = flags.hand !== '0';
  // Cruise's hand-over (src/modes/chill/index.js): the AI skipper's pro trim stays as it is, so the sails do not jump
  if (handover && handOn) { hand.sheet = handover.sheet; hand.start = false; }
  // let fly (letFly.js): a click on a winch throws its sheet off; the ease held at the stop frees both
  let flyStore = null;
  try { flyStore = flags.once ? globalThis.localStorage ?? null : null; } catch { flyStore = null; }
  const fly = new LetFly({ storage: flyStore, once: flags.once });
  services.provide('skills', skills);   // the dock's pro button reads it (muted, proUnlocked)
  // the pro rows in H: once trim is mastered (the skill model) or pro is on (P, ?pro=1)
  // the harbour master's call on 16 wins over a hint: the radio is asked lazily (the tools are built after the hint)
  const voice = createSkipperVoice({ audio: core.audio, prefetch: true, ...(touchDevice() ? { prefetchFirst: 3, prefetchRestGapMs: 4000 } : {}), blocked: () => services.get('captainTools')?.radio?.state?.playing === true });
  services.provide('skipperVoice', voice);   // tools/probe_voice.mjs
  const hint = lessons.createHint({ services, state: () => phys.state, once, skills, words, proKeys: () => pro, voice,
    pilot: () => pilotOn, onPilot: (on) => { pilotOn = on; holdHeading = null; } });
  services.provide('hint', hint);
  const captain = !flags.captain ? null : createCaptainView({ state: () => phys.state, once: flags.once, always: flags.station });
  services.provide('captain', captain);
  let rateMul = 1;   // Regatta's photo finish runs the sim slower for a moment (setRate); 1 everywhere else
  const timeScale = parseFloat(flags.speed ?? DEFAULT_SPEED);   // 2×; no fast-forward in Day Sail (owner, 2026-10-29)
  const nightCue = new SpeedCue(); let nightSay = 0;
  let seaRough = 0;
  // the gust's payoff (src/gustFx.js, wow/gusts): the sail-fill snap and the rush, the bow spray, the camera's lean
  // (the steady-horizon setting: a smaller lean; reduced motion: none); ?gustfx=0 off
  const gustFx = createGustFx({ flags, steady: () => helmCam.steady > 0 });
  services.provide('gustFx', gustFx);   // the probes and the film tools
  let gustNow = { events: [], rushMul: 1, spray: 0 };
  const rumble = createRumble({ flags });
  const hullSpeed = 0.4 * Math.sqrt(9.81 * boat.dims.HULL.lwl);   // Fn 0.4: 3.4 m/s (6.6 kn); the boat's own waterline
  let loadN = 0, pullRate = winchRate(0), helmNeed = 0;
  // ---- pro mode (feat/pro-sailing): ?pro=1 or P; the four controls start where the crew had them ----
  let pro = flags.pro === '1', proEvents = false;   // proEvents: only the player's own toggles reach the Pro setting, not the start-up or Cruise's hand-over
  const instruments = () => boatSvc?.instruments;
  const setPro = (on) => {
    pro = !!on;
    if (!pro) { ctl.traveller = ctl.twist = ctl.backstay = ctl.jibLead = null; }
    else { ctl.traveller = 0; ctl.twist = 0; ctl.jibLead = 0; ctl.backstay = phys.t > 0 ? phys.state.backstay : null; }   // the crew's flattening as left (null until the first tick)
    if (instruments()) instruments().pro = pro;
    hint.setPro?.(pro);
    if (proEvents) dispatchEvent(new CustomEvent('lk-pro', { detail: { pro } }));   // the shell keeps the Pro setting in step (src/shell.js)
    return pro;
  };
  // ---- end pro ----

  // ---- the tool dock (toolDock.js): what exists on this build registers; the rest are hidden stubs that a feature
  // fills by registering the same id (the 'dock' service's register({ id: 'chart', key: 'N', … })) ----
  const dock = deck.mountDock({ hidden: () => hint.current === 'keys' });   // the deck's rows: chart, logbook, helm, cruise, keys
  // the binoculars (B) and the VHF radio (O) register themselves below (captainTools.js)
  dock.register({ id: 'wind', key: '1–4', name: 'wind', icon: ICONS.wind, order: 60, badge: () => wind?.level ?? '',
    action: () => { const n = (wind?.level ?? 3) % 4 + 1; fireKey('keydown', `Digit${n}`); fireKey('keyup', `Digit${n}`); } });   // the next level, as its key
  // the reef (K): the control panel's REEF button cycles it as the key does (a reef, a second, shaken out)
  dock.register({ id: 'reef', key: 'K', name: 'reef: in, a second, out', icon: ICONS.sails, order: 48, code: K.K, lit: () => (phys.state.reef ?? 0) > 0 });
  // pro: shown once it is unlocked (the skill model's pro, feat/mastery) or on; P, or a click, turns it on and off
  dock.register({ id: 'pro', key: '', name: 'pro trim', icon: ICONS.pro, order: 80, action: () => setPro(!pro), visible: () => true });   // the panel's TRIM button: the same switch as Settings → Sailing (basic | pro), always live
  // the craft's station (src/stations/sloop/index.js): the helm view's parts and the pro trim panel now (the trim panel's place
  // in the page), the rest below once the tools and the seamanship exist
  const S = mountStation(core, deck, { boat, phys, ctl, sfx, helmPick: sharedPick, live: { pro: () => pro, handOn: () => handOn } });
  const { helmPick, trimPanel } = S;

  // The wind level (1–4) lives in the WindField (src/wind.js setLevel): the level is set on the open bay (owner,
  // 2026-10-29), and a change blows in as a front from upwind, arriving at the boat over ≈ 25 s of play (real time;
  // the field runs on scene time, so × the time rate). ?wind= sets the starting level (coreOptions), ?windref=start
  // pins it to the start's spot instead.
  const blowS = LEVEL_BLOW.overS * timeScale;
  const setLevel = (n) => wind?.setLevel?.(n, { t: simT, at: { x: phys.state.x, z: phys.state.z }, overS: blowS });
  // the gamepad and touch (pads.js): the same two verbs, analog
  const pads = createPads({ canvas: renderer.domElement, flags, signal, on: {
    level: setLevel, levelNow: () => wind?.level ?? 3, glyph: () => captain?.toggle(), view: toggleView,
    look: (dx, dy) => deck.addLook(dx, dy), zoom: (f) => deck.addZoom(f), vhf: () => tools.listen() } });
  // the phone's helm strip and Tack plate (touchUi.js; a coarse pointer only), a third hand on the same helm
  const stationOn = S.on;   // the helm station (helmStation.js): ?station=0 the old row and strip
  const touchUi = createTouchUi({ strip: !stationOn, pads, state: () => phys.state, hidden: () => loadingUp() || !!services.get('menu')?.isOpen || !!services.get('logbook')?.logbook?.isOpen || !!services.get('chart')?.chart?.toggle?.big || deck.binoUp, onUse: () => { deck.used(); }, pinDial: () => { if (captain?.mode === 'auto') captain.toggle(); } });
  // the captain's tools: the binoculars and the VHF (captainTools.js)
  const tools = createCaptainTools(core, { boat, phys, hint, captain, dock, helmPick, icons: ICONS });
  // the engine and the ground tackle (seamanship.js): I, + − 0, J, U, Y; the dock's icons; the lever
  const sea = createSeamanship(core, { boat, phys, ctl, hint, dock, helmPick, sfx });
  // the bottom: the shallow-water assist, the sounder's alarm, R.'s words, the scrape and the thud (grounding.js)
  const grounding = ground ? attachGrounding(core, { phys, ground, groundTerrain }, { hint, sea, sfx }) : null;
  if (grounding) sea.hooks.kedge = grounding.kedge;
  // the rest of the station (src/stations/sloop/index.js): the helm station and its 3D cockpit, the control panel, the PRO recess,
  // the Tack pill, the turn-the-phone line and the throttle column, in that order, and their services
  S.mount({ pads, tools, sea, fly, hint, notes: NOTES, once });
  const { station, proRecess, tackBtn } = S;
  let showNow = null;   // the one-tap fireworks (showNow.js), built with the simulation below
  // the top bar (the deck's view switch, viewSwitch.js): always up in Day Sail, but under a page, the binoculars or the
  // loading card; its first-session glow waits for the hints and the skill model to be quiet
  const viewSwitch = deck.mountBar({
    subtitle: (text, o) => hint.flash(text, o),   // game events and statuses go to the subtitle line, not a pill under the bar
    windPick: { level: () => wind?.level ?? 3, set: (n) => { const was = wind?.level ?? 3; setLevel(n); sfx?.cue('wind', { from: was, to: n }); } },   // the top bar's Wind: a direct picker (same call as keys 1-4)
    quiet: () => (hint.current === 'none' || hint.current === 'whisper') && !(services.get('skills')?.needs?.()?.length > 0),
    // the top bar's Log: it left the bottom row
    // no Cruise button in Sail's bar (owner, 2026-11-06): modes are switched from the Menu (the card's Cruise · Sail · Regatta)
    log: stationOn ? () => { fireKey('keydown', K.L); fireKey('keyup', K.L); } : null,
    clockMenu: { simT: () => simT, fireworks: () => services.get('fireworks'), fireworksGo: () => showNow?.go() },   // the clock's time menu (Dawn … Fireworks)
  });
  // the sail keys, inside the deck's keydown listener (the deck has C, Shift+C and the Cruise key)
  deck.onKey((e) => {
    if (e.code === KEY.reef) ctl.reef = ((ctl.reef ?? 0) + 1) % 3;
    if (e.code === KEY.vhf && !e.repeat) tools.listen();          // the VHF: the weather channel, and back to 16
    if (e.code === KEY.tack && !e.repeat && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) { e.preventDefault(); (tackBtn ?? touchUi).press?.(); }   // Space: tack (or gybe), the Tack button's whole manoeuvre
    if (e.code === K.G) ctl.jibSide = ctl.jibSide ? 0 : -Math.sign(phys.state.boomAngle || 1);   // G: wing-on-wing (the jib held out opposite the boom)
    if (e.code === K.V) captain?.toggle();                       // auto (on use) → pinned → off → auto
    const i = K.WIND.indexOf(e.code);
    if (i >= 0) { const was = wind?.level ?? 3; setLevel(i + 1); if (!e.repeat) { sfx?.cue('wind', { from: was, to: i + 1 }); if (i + 1 !== was) viewSwitch?.say?.(`Wind level ${i + 1}`); } }   // the new wind heard blowing in
  });
  const interp = new StateInterp();
  // the boat's physics on the shared fixed step (src/sail/simulation.js): the controls are its inputs, the world (the boat
  // service's env: the wind, the waves, the bottom; the tackle's forces) its env; the drawn pose sits alpha between two ticks
  const sim = createSimulation({ boat: { phys, env: (tt) => sea.env(boatSvc.env(tt)) }, t0: T0 });
  const markTick = () => interp.mark(phys.state);
  showNow = createShowNow({ core, phys, follow, sea, services, simT: () => simT, interp, ground });
  const binoHud = createBinocularsHud({ terrain: core.terrain }); services.provide('binoHud', binoHud);
  const status = new StatusWatch(); let statusNow = null, camNear = 1, camNearWas = 1;
  let simT = T0;
  // the gust field around the boat, for "reading gusts" (4 Hz): at the boat and 150 m out at 45° either side of the bow
  let gust = null, gustAt = -9;
  const sampleGust = () => {
    if (!wind?.gustAt) return null;
    const s = phys.state, at = (da) => { const h = s.heading + da; return wind.gustAt(s.x + Math.sin(h) * 150, s.z - Math.cos(h) * 150, simT); };
    return { here: wind.gustAt(s.x, s.z, simT), left: at(-Math.PI / 4), right: at(Math.PI / 4) };
  };

  // ---- let fly (letFly.js): the clicks, Pro's ease past the stop, the squall reflex, a hand pulling a free
  // sheet back in (before the sheets' own paths); the free sheets held out, the winch's grind, the crew's hands (after) ----
  const flyIO = (jr, toggles = {}) => ({ ctl, hand, handOn, pro, state: phys.state, pullRate, jr, toggles });
  function letFlyIn(dt, inp) {
    const { flew } = fly.before(dt, flyIO(inp.jr, { main: !!station?.takeFly?.('main'), jib: !!station?.takeFly?.('jib') }), inp);
    if (flew) { sfx?.cue('click', { rate: 0.8 }); words.meet('let-fly'); deck.used(); }
  }
  function letFlyOut(dt, inp) {
    fly.after(dt, flyIO(inp.jr), inp);
    // the skill hints wait while a sheet flies (R.'s own line says what is happening); his word the first time each case happens
    hint.quiet?.(fly.any);
    const id = fly.says(words.level('let-fly'));
    if (id && NOTES[id]) hint.note?.(NOTES[id].text, '', NOTES[id].speak);
  }
  function update(dtRaw) {
    const dt = clampFrame(dtRaw); deck.begin(dt); const t = deck.t;
    touchUi.update(dt);
    S.begin(dt);   // the Tack pill
    const pad = pads.update(dt);
    const steer = Math.max(-1, Math.min(1, (keys.has(K.D) || keys.has(K.RIGHT) ? 1 : 0) - (keys.has(K.A) || keys.has(K.LEFT) ? 1 : 0) + pad.steer));
    // the mouse's hands: the glyph's rudder and sail line, the helm view's wheel and winch
    const gd = captain?.drag, glyphSteer = gd?.kind === 'rudder' ? gd.steer : 0;
    const hudSteer = station?.steer ?? null;   // the helm station's wheel in the hand (a rudder command; 0 is amidships, not "off")
    const handSteer = hudSteer ?? (glyphSteer || wheelSteer);
    const onHelm = hudSteer != null || !!handSteer;
    if ((steer || onHelm) && course.active) course.cancel();   // A/D, the stick, the glyph's rudder or the wheel
    if (onHelm) {
      // the mouse holds the helm where it is put (the glyph's line under the pointer, the wheel's turn)
      ctl.rudder += (handSteer - ctl.rudder) * Math.min(1, dt / helmTau(handSteer, phys.state.apparentWind?.angle ?? 0, weatherHelm(phys.state).need));
      holdHeading = null;
    }
    // Steering is yours while A/D is down; let go and a tiller pilot holds the heading you left it on
    // (the Catalina has real weather helm: unattended it rounds up into the wind).
    // A clicked course (course.js) is the pilot's target while it lasts.
    // the weather helm (feel.js): bearing away against it, the wheel is heavier (slower); heading up it is light
    helmNeed = weatherHelm(phys.state).need;
    // the shallow-water assist (grounding.js): bears away from a shoal, rocks or the shore; yours to override by steering
    const wf = phys.state.heading + (phys.state.trueWind?.angle ?? 0);
    const shoal = grounding ? grounding.update(dt, { steering: !!(steer || onHelm), pro, windFrom: wf }) : null;
    if (shoal?.engaged && course.active) course.cancel();
    if (shoal?.release && pilotOn) holdHeading = phys.state.heading;
    // the tack's carry: the player's helm in any hand (keys, stick, strip, the Tack button's assist, the wheel, the glyph)
    const co = carry.update(dt, { steer: steer || handSteer, twa: phys.state.trueWind?.angle ?? 0, sog: phys.state.sog ?? 0, yawRate: phys.state.yawRate ?? 0, enabled: !pro && !sea.held && ctl.autoTrim !== false });
    if (co.jibSide) { ctl.jibSide = co.jibSide; carryJib = true; } else if (carryJib) { ctl.jibSide = 0; carryJib = false; }   // the crew backs the jib, then lets it draw
    hint.keep?.(co.keep);
    if (onHelm) { /* above */ }
    else if (steer) { ctl.rudder += (steer - ctl.rudder) * Math.min(1, dt / helmTau(steer, phys.state.apparentWind?.angle ?? 0, helmNeed)); holdHeading = null; }
    else if (sea.held) { ctl.rudder += (0 - ctl.rudder) * Math.min(1, dt / 0.6); holdHeading = null; }
    else if (shoal?.engaged) { holdHeading = shoal.heading; ctl.rudder = pilot.toHeading(phys.state, shoal.heading, dt); }   // on the anchor, a ball or the lines: the helm amidships, the boat swings
    else if (co.helm != null) { ctl.rudder += (co.helm - ctl.rudder) * Math.min(1, dt / HELM.tau); holdHeading = null; }   // the tack let go mid-turn: kept through
    else if (fly.any) { ctl.rudder += (0 - ctl.rudder) * Math.min(1, dt / 0.4); holdHeading = null; }   // a sheet let fly: the helm let go, so she rounds up (or lies across the wind) and stops; the pilot takes her again once sheeted in
    else if (course.active) { holdHeading = course.update(phys.state); ctl.rudder = pilot.toHeading(phys.state, holdHeading, dt); }
    else if (pilotOn) { if (holdHeading == null) holdHeading = pro ? phys.state.heading : pilotHeading(phys.state.heading, phys.state.trueWind?.angle ?? 0, phys.state.trueWind?.speed ?? 0); ctl.rudder = pilot.toHeading(phys.state, holdHeading, dt); }
    else ctl.rudder += (0 - ctl.rudder) * Math.min(1, dt / 0.4);
    // the sheets: W/↑ pull in, S/↓ ease; the sheet stays; the crew's net after 12 s of wrong sails
    // the mouse: the glyph's sail line drags the sheet toward where it is put (pullToward), at the winch's rate; the
    // helm view's winch pulls while held, the tail eases while held
    const glyphPull = gd?.kind === 'sheet' ? pullToward(hand.sheet ?? phys.state.mainSheet, gd.sheet) : 0;
    // the helm station's winches: a crank, a drag, a scroll or a step moves the sheet at once; a held step is the key
    const mainNow = station ? station.take('main') : 0, jibNow = station ? station.take('jib') : 0;
    const mainHold = station ? station.hold('main') : 0, jibHold = station ? station.hold('jib') : 0;
    const mousePull = glyphPull || holdPull || mainHold;
    const pull = Math.max(-1, Math.min(1, (keys.has(K.W) || keys.has(K.UP) ? 1 : 0) - (keys.has(K.S) || keys.has(K.DOWN) ? 1 : 0) + pad.pull + mousePull));
    // the jib's own sheet: its winch, and R (in) / F (out) when R/F are free (basic, not pro); the crew still matches it to the main
    const jibKeys = ctl.autoTrim && !pro ? (keys.has(K.R) ? 1 : 0) - (keys.has(K.F) ? 1 : 0) : 0;
    const jibDir = Math.max(-1, Math.min(1, jibHold + jibKeys));
    const jr = jibTrimRange(phys.state);
    letFlyIn(dt, { pull, mainNow, mainHold, jibDir, jibNow, jibHold, jr });
    if (mainNow) { if (ctl.autoTrim && handOn) hand.nudge(mainNow); else if (!ctl.autoTrim) ctl.main = Math.min(1, Math.max(0, ctl.main - mainNow / ((HAND.max - HAND.min)))); }
    if (ctl.autoTrim) {
      jibHeldS = jibDir && Math.sign(jibDir) === jibHeldDir ? jibHeldS + dt : 0; jibHeldDir = Math.sign(jibDir);
      let dj = -jibNow - jibDir * (jibDir > 0 ? HAND.rate : HAND.easeRate) * trimBoost(jibHeldS, Math.sign(jibDir)) * dt;   // + = out (held: faster, as the main's)
      // never past a stop (no dead travel on the way back): the crew's match plus the trim stays inside the jib's range
      ctl.jibTrim = Math.max(jr.lower, Math.min(jr.upper, (ctl.jibTrim ?? 0) + dj));
    } else if (jibNow || jibHold) ctl.jib = Math.min(1, Math.max(0, ctl.jib - jibNow / (60 * Math.PI / 180) - jibHold * dt * 0.4));
    if (mainNow || jibNow || jibDir) deck.used();
    station?.trim('main', mainNow || (keys.has(K.W) || keys.has(K.UP) ? 1 : 0) - (keys.has(K.S) || keys.has(K.DOWN) ? 1 : 0) + pad.pull + mousePull); station?.trim('jib', jibNow || jibDir);
    vkey(K.W, mousePull > 0.05 || mainNow > 0); vkey(K.S, mousePull < -0.05 || mainNow < 0); vkey(K.D, handSteer > 0.1); vkey(K.A, handSteer < -0.1);   // the hints see the mouse's hand as the key's
    // the winch slows as the sheet loads up (feel.js): the sails' force, smoothed over WINCH.tau
    loadN += (sailForce(phys.state) - loadN) * (1 - Math.exp(-dt / WINCH.tau)); pullRate = winchRate(loadN);
    if (ctl.autoTrim && handOn) { ctl.sheet = hand.update(dt, pull, phys.state, { pullRate }); ctl.sheetBias = 0; }   // null until the physics has ticked once
    else { ctl.sheet = null; ctl.sheetBias = 0; }
    if (!ctl.autoTrim) {
      ctl.main = Math.min(1, Math.max(0, ctl.main - pull * dt * 0.4));
      if (!(pro && (keys.has('ShiftLeft') || keys.has('ShiftRight')))) ctl.jib = Math.min(1, Math.max(0, ctl.jib + ((keys.has(K.F) ? 1 : 0) - (keys.has(K.R) ? 1 : 0)) * dt * 0.4));
    }
    letFlyOut(dt, { pull, mainNow, jibDir, jibNow, jr });
    // ---- pro: the four controls at PRO.rate per second, held where left ----
    if (pro) {
      const k = (c) => (keys.has(c) ? 1 : 0), sh = keys.has('ShiftLeft') || keys.has('ShiftRight'), r = PRO.rate * dt, P = pad.pro ?? {};
      const leadKeys = ctl.autoTrim ? !sh : sh;                      // with ?autotrim=0, R/F is the jib sheet: the car on Shift+R/F
      const add = (v, d, lo = -1) => Math.max(lo, Math.min(1, (v ?? 0) + d * r));
      ctl.traveller = add(ctl.traveller, k(K.E) - k(K.Q) + (P.trav ?? 0));
      ctl.twist = add(ctl.twist, (sh ? 0 : k(K.Z) - k(K.X)) + (P.twist ?? 0));
      ctl.backstay = add(ctl.backstay, (sh ? k(K.X) - k(K.Z) : 0) + (P.backstay ?? 0), 0);
      ctl.jibLead = add(ctl.jibLead, (leadKeys ? k(K.F) - k(K.R) : 0) + (P.lead ?? 0));
    }
    // ---- end pro ----
    const inUse = steer !== 0 || pull !== 0 || onHelm || pad.active || (pro && [K.Q, K.E, K.Z, K.X, K.R, K.F].some((c) => keys.has(c))) || [...keys].some((k) => /^Digit[1-4]$/.test(k));   // the glyph shows while a finger is down
    if (inUse) deck.used();
    // the modality: the pad reports itself (pads.js sends no window event of its own)
    if (pad.kind === 'pad') modality.set('pad', null);
    // a mouse player told to trim sees the line to drag
    if (modality.kind === 'mouse' && (hint.current === 'pull' || hint.current === 'ease')) deck.lastUse = Math.max(deck.lastUse, t - 1);
    deck.update(dt); S.trimUpdate(dt);   // the deck: the keys list's timeout, the dock; the trim panel and the PRO recess
    // the skill model: the state and the player's own inputs (keys and pad; never the pilot's or the crew's)
    // the player's helm: A/D and the stick, the mouse's hand, a clicked course while the boat turns onto it
    const skSteer = steer || (hudSteer != null ? Math.sign(hudSteer) : handSteer) || (course.active && Math.abs(ctl.rudder) > 0.3 ? Math.sign(ctl.rudder) : 0);
    if (t - gustAt >= 0.25) { gustAt = t; gust = sampleGust(); }
    { const s = phys.state;
      skills.update(dt, { twa: s.trueWind.angle, tws: s.trueWind.speed, awa: s.apparentWind.angle, sog: s.sog, heading: s.heading, heel: s.heel,
        mainFill: s.mainFill, mainStall: s.mainStall, boomAngle: s.boomAngle, surf: s.surf, roundUp: s.roundUp, groove: s.groove,
        level: wind?.level ?? null, steer: skSteer, pull, crew: hand.crew, gust, x: s.x, z: s.z }); }
    hand.netAfter = skills.netAfter;   // the crew's net fades with the skill (or the player's setting)
    if (windAir) windAir.lines = linesStrength(windLinesMode, skills.windRead());   // the beginners' wind lines fade as the wind is read
    hint.update(dt);
    viewSwitch?.update(dt); showNow?.update(dt);
    { // the night's fast-forward: the top bar's event line says so while time is speeding (kept up every 2 s)
      const x = core.clock && !flags.timerate ? core.clock.rateAt(simT) / DEFAULT_TIMERATE : 0;
      if (nightCue.step(x) === 'on') nightSay = 0;
      if (nightCue.on && (nightSay -= dt) <= 0) { viewSwitch?.say?.(NIGHT_LINE); nightSay = 2; }
    }
    wind?.setListener?.(phys.state.x, phys.state.z);   // base.speedMs (the water's wave bands) reads the wind at the boat
    sea.pre(dt);   // the lever and the crew's furl into ctl
    // the status line: what every action is doing, in plain words, at once (statusLine.js), in the top bar's event line
    { const a = sea.tackle.state.anchor;
      const line = status.step({ furl: phys.state.furl ?? 0, furlWant: sea.furlWant ?? 0, engine: phys.engine?.state, lever: phys.engine?.lever ?? 0, anchor: { phase: a.phase, depth: a.depth },
        tackle: sea.tackle.mode, bino: !!tools.latched || tools.bino.k > 0.5, radio: tools.channel, reef: phys.state.reef ?? 0, reefing: phys.state.reefing ?? 0, view: deck.view }, t);
      if (line) { viewSwitch?.say?.(line); statusNow = { text: line, at: t }; }
      // the camera helps when the effect is far away: a little closer (≤ 8 %) while the crew works or the hand is on a sheet, then back
      const busy = !!status.busy || !!station?.trimming;
      camNear += ((busy ? 0.92 : 1) - camNear) * Math.min(1, dt / 0.9); }
    sim.step(dt * timeScale * rateMul, ctl, { before: markTick }); simT = sim.t;
    if (pro && ctl.backstay == null && phys.t > 0) ctl.backstay = phys.state.backstay;   // pro: from the crew's first trim
    // what is drawn: the state between the last two physics ticks (src/boat/interp.js), so the boat, its wake and the
    // camera move every display frame, not in 60 Hz steps; the physics, sounds and instruments keep phys.state
    gustNow = gustFx.update(dt * timeScale * rateMul, phys.state);   // the sim's own clock: the wind at the boat moves on it
    const rs = !flags.interp ? phys.state : interp.at(phys.state, sim.alpha);   // ?interp=0: the old look, for the A/B in tools/judder_probe.mjs
    const pose = ride.step(renderer, rs, simT, dt * timeScale * rateMul);
    boat.update(pose, dt, { t: simT - 1 / 60 + sim.acc });   // the sails' flutter on the drawn time, not the last tick's
    S.update(dt);   // the station, the panel, the turn line: the wheel and the drums draw the boat's own rudder and sheets, whatever moved them
    const look = deck.look();
    // the binoculars (latched by B or the dock, or the pad's stick click held): the look goes to their aim; the views underneath keep
    // running (with no look), so lowering them returns to the view as it was
    const binoHeld = !!pad.bino || tools.latched;
    deck.setBino(binoHeld || tools.bino.k > 0 || tools.latched);   // the view is the binoculars' alone: no chart circle over it
    const viewLook = binoHeld || tools.bino.k > 0 ? null : look;   // a drag mid-move looks round the view it goes to (the move follows)
    const zoomMul = camNear / camNearWas; camNearWas = camNear;   // the camera a little closer while the crew works
    // the deck's camera chain (follow, ride, intro, helm, blend), then the scene's and the tools' cameras, onto the camera
    deck.camera(dt, { rs, pose, look, viewLook, zoomMul,
      lean: (q) => gustFx.lean(dt, q, rs),   // a gust's heel: the view leans a little with it (src/gustFx.js)
      // the one-tap fireworks' camera (showNow.js) while its show runs, the player's own look, zoom or view winning at once
      scene: ({ interrupt }) => showNow?.camera({ x: rs.x, z: rs.z, heightAt: core.terrain?.heightAt, interrupt: interrupt || binoHeld, aspect: camera.aspect }),
      outer: (normal) => sea.camera(dt, pose, tools.camera(dt, pose, normal, { held: binoHeld, look: binoHeld ? look : null })),   // the anchoring's rise, over everything
    });
    binoHud.update(tools.k ?? 0, camera, core.sun?.direction, dt);   // the binoculars' compass, reticle and rangefinder
    tools.update(dt);
    deck.end();
    rumble.update(dt, phys.state, pose, { hullSpeed, simDt: dt * timeScale });
    seaRough += (Math.min(1, Math.abs(ride.wave.bowRelVel ?? 0) / 1.4) - seaRough) * (1 - Math.exp(-dt / 1.5));   // the sea the hull feels, for the sound
    boatAudio?.update(simT, { ...phys.state, seaRough }, { camDist: Math.hypot(camera.position.x - phys.state.x, camera.position.y, camera.position.z - phys.state.z), extra: gustNow.events, rushMul: gustNow.rushMul });
    sea.post(dt);   // the exhaust, the rode, the fenders, the engine's sound
    // the controls' sounds on the real clock (a key's sound follows the hand, not the 2× sim)
    sfx?.update(t, { pull: ctl.autoTrim && handOn ? pull : 0, sheet: ctl.sheet, rudder: ctl.rudder, steer, sog: phys.state.sog, load: Math.hypot(phys.state.drive ?? 0, phys.state.side ?? 0) / 2000 });
    lod.update(camera.position, tools.lodOn ? tools.lodFocus(dt) : null);   // the glasses' focus: more terrain detail where they look (?binolod=0 off)
    // the glyph backs the skill lines: the sails pulse with the sheet lines, the no-go wedge shows with the tack line
    const cue = hint.current === 'pull' || hint.current === 'ease' ? 'sails' : hint.current === 'tack' || hint.current === 'irons' ? 'wedge' : null;
    captain?.update(dt, { sinceUse: t - deck.lastUse, hands: hand.crew ? 'crew' : inUse ? 'you' : null, trend: pro ? instruments()?.trend : null, nogo: course.active && course.nogo && t - courseAt < 8, cue });
    // the helm view's parts: hover under a still mouse (one ray a frame at most), the glow, the working winch's side
    const exposure = core.sun?.exposure ?? 1;
    S.helmView(dt, exposure);
    ripple.update(dt, exposure);
    core.setTime(simT);
    if (flags.debug === 'sail') {
      const s = phys.state, kn = (v) => (v * 1.944).toFixed(1);
      msg.textContent = `wind ${wind?.level ?? '-'} ×${(wind?.levelScaleAt?.(s.x, s.z, simT) ?? 1).toFixed(2)} · sheet ${ctl.sheet != null ? (ctl.sheet * 57.3).toFixed(0) + '°' : 'crew'} (crew ${(s.crewSheet * 57.3).toFixed(0)}°) fill ${s.mainFill.toFixed(2)} stall ${s.mainStall.toFixed(2)}${hand.crew ? ' · the crew trims' : ''} · SOG ${kn(s.sog)} kn · TWA ${(s.trueWind.angle * 57.3).toFixed(0)}° TWS ${kn(s.trueWind.speed)} kn · AWA ${(s.apparentWind.angle * 57.3).toFixed(0)}° · heel ${(s.heel * 57.3).toFixed(0)}° · rudder ${ctl.rudder.toFixed(2)} (weather helm ${(helmNeed * 57.3).toFixed(1)}°) · load ${(loadN / 1000).toFixed(2)} kN winch ${(pullRate * 57.3).toFixed(1)}°/s · ${deck.view}`;
    }
  }
  function dispose() {
    deck.abort(); showNow?.dispose(); offSkills(); gloss.dispose();
    if (services.get('words') === words) { services.remove('words'); services.remove('gloss'); }
    hint.dispose(); voice.dispose(); services.remove('skipperVoice', voice); captain?.dispose(); touchUi.dispose(); tools.dispose(); sea.dispose(); S.dispose(); binoHud.dispose();   // S: the station's parts and names
    services.remove('gustFx');
    services.remove('skills', skills); services.remove('hint', hint); services.remove('captain', captain);
    if (services.get('controls')?.hint === hint) services.remove('controls');
    deck.dispose();   // the deck's parts last: the dock, the modality, the ripple, the bar
  }
  const api = { update, dispose, sim, setRate(m) { rateMul = m; }, get rate() { return rateMul; }, setIntro(fn) { deck.setIntro(fn); }, get introOn() { return deck.introOn; },   // a camera move over the follow view (the deck's)
    hint, captain, hand, setLevel, pads, rumble, helmCam, toggleView, setView, blend, viewSwitch, course, dock, modality, helmPick, ripple, setCourseAt, tools, sea, timeScale, skills,
    get pilotOn() { return pilotOn; }, grounding, get status() { return statusNow; }, get camNear() { return camNear; },
    get shoalAssist() { return grounding?.on ?? false; }, setShoalAssist(on) { return grounding?.setAssist(on) ?? false; },
    get view() { return deck.view; }, set view(v) { setView(v); }, deck,
    get feel() { return { loadN, pullRate, helmNeed, t: deck.t }; },
    get level() { return wind?.level ?? null; }, get simT() { return simT; }, get sheet() { return ctl.sheet; },
    get pro() { return pro; }, setPro, ctl, trimPanel, proRecess, fly,   // pro: tools/probe_pro.mjs; fly: the let fly's state (letFly.js; the page test, tools/let_fly_film.mjs)
    // the menu's assists: the pilot, the crew on the sheets (T), the hints shown or not
    get pilot() { return pilotOn; }, setPilot(on) { pilotOn = !!on; holdHeading = null; return pilotOn; },
    get crewTrim() { return !handOn; }, setCrewTrim(on) { handOn = !on; return !handOn; },
    get autoReef() { return ctl.autoReef !== false; }, setAutoReef(on) { ctl.autoReef = !!on; return ctl.autoReef; },
    setWindLines(mode) { windLinesMode = mode; return mode; }, get windLinesMode() { return windLinesMode; },
    voice, setVoice(on) { return voice.setEnabled(on); },
    setSteady(on) { helmCam.steady = on ? STEADY : 0; return helmCam.steady; },
    get hintsOn() { return hint.el.style.display !== 'none'; }, setHints(on) { hint.el.style.display = on ? '' : 'none'; return !!on; },
    words, gloss, setWords(mode) { words.mode = mode; return words.mode; } };
  if (pro) setPro(true);
  if (handover) { setPro(true); Object.assign(ctl, { traveller: handover.traveller, twist: handover.twist, backstay: handover.backstay, jibLead: handover.jibLead }); if (handover.rudder != null) ctl.rudder = handover.rudder; }
  services.provide('controls', api);   // tools/probe_windlevel.mjs
  proEvents = true;
  return api;
}
export { KN };
