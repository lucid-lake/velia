// Sail's screen on v2 (M4): v1's Sail UI mounted on v2's page. What src/deck/index.js, src/controllers/sail.js,
// src/stations/sloop/index.js and src/shell.js put on a v1 Sail page, wired here to v2's sim (v2/sim/boat.js) and the shared
// WindField, with v1's own three-free modules as they are:
//   the top bar          src/ui/viewSwitch.js (Menu, Boat | Helm, Music, Full, Setup, Wind, the ship's clock)
//   the Calm HUD         src/ui/calmHud.js (the presets, the fade, the fold, H)
//   the skipper's line   src/ui/controlsHint.js with the sloop's skills and words (src/lessons/sail.js)
//   the dials            src/ui/captainView.js (the wind dial) and src/ui/chartplotter.js (the small chart): their DOM is the
//                        raised view over each coaming-end instrument and the source of its face (dialFaces.js)
//   the helm station     v2/ui/station.js (helmStation's cockpit form on v2/render/cockpit.js), src/stations/sloop/
//                        controlPanel.js (SAILS · ANCHOR · REEF · the key), throttleLever.js, tackButton.js, proRecess.js
//                        (the PRO sliders, BINOS, VHF: ui/captain.js), trimPanel.js
//   the views            v2/ui/views.js (the follow view, the helm view, v1's ≈ 1 s move), C and the bar's switch
//   the wind             keys 1–4 and the bar's Wind picker → WindField.setLevel, as controllers/sail.js
//   the day clock        v2/ui/dayClock.js: the bar's clock opens v1's time menu (src/ui/timeMenu.js), v1's night-sky line
//                        ("The stars come out…" once a night); no fireworks evening (a time event), no target for it
//   the key legend       src/ui/keyLegend.js as it is (the edge pair's right block: desktop, Sail, the cockpit up; Setup's key
//                        hints row; ?keylegend=0|1), v1's shell.js wiring
//   the Pro panel        ui/proHud.js top-left (COG, TWA, VMG, AWA, HEEL, RUD; Setup › Screen › Pro instruments, off by default;
//                        the cockpit up); it replaced the nav column (src/ui/navColumn.js stays v1's); the passage service stays
// Live pages only (a headless capture has no UI; ?filmui=1 is a live page on the film clock).
//   const ui = createSailUi({ B, windField, clock, rig, terrain, flags, canvas });
//   each frame: ui.update(dt, hands) (before the boat steps: the station's hands go in; hands: main.js's keys and fingers this
//   frame, { steer, pull }, read before it: the skill model sees them, v1's controllers/sail.js), ui.camera(dt, follow) → the pose
import { createServices } from '../../src/sim/core/services.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import { createViewSwitch, barClock, WIND_LEVELS } from '../../src/ui/viewSwitch.js';
import { reducedNow } from '../sim/steadyCamera.js';   // Reduce Motion: the one accessibility signal
import { createCalmHud } from '../../src/ui/calmHud.js';
import { createControlsHint } from '../../src/ui/controlsHint.js';
import { reefNow, reefLever, reefWords } from './reefState.js';
import { nextReef } from './autoReef.js';   // the reef selector A · 0 · 1 · 2 (owner 2026-11-17)
import { createSkills } from '../../src/sail/skills.js';
import { createWords } from '../../src/ui/words.js';
import { createCaptainView } from '../../src/ui/captainView.js';
import { createChartplotter } from '../../src/ui/chartplotter.js';
import { cockpitUp } from './cockpitUp.js';   // the cockpit up: the performance stats and the Pro instruments panels follow it
import { createDialModules } from './dials.js';   // the two dials as 2D modules (?dials=cockpit: the old dials in the cockpit, one release)
import { trimCue, heelCue, nearestPoi, poiRow, shoreArcs, mountDialsLayout, DIALS_V2 } from './dialsV2.js';   // the dials' north star: the Chart and the Coach
import { createProHud, proHudAllowed, proHudShown, proHudSettings } from './proHud.js';   // the Pro instruments panel, top-left (Setup › Screen; replaced the nav column)
import { showsDials, homeId } from '../engine/modes.js';
import { luffAwaDeg, BOAT as BOAT_P } from '../../src/sim/boat.js';
import { nightOf } from '../../src/ui/chartplotterData.js';   // the live chart's night palette weight (?livechart=1)
import { REFUSALS } from './birthplaceCard.js';   // the birthplace move's refusals, in plain words
import { createToolDock, ICONS } from '../../src/ui/toolDock.js';
import { createModality } from '../../src/ui/pointer.js';
import { isCoarse } from '../../src/ui/touchMap.js';
import { touchInit } from '../../src/ui/touchUi.js';
import { deviceKindNow, deviceClasses, ALL_DEVICE_CLASSES } from '../../src/ui/device.js';
import { createControlPanel } from '../../src/stations/sloop/controlPanel.js';
import { steadyOn, steadyUrl, steadyChoice } from './steadyHands.js';   // steady hands: the let-go heading hold by profile (owner 2026-11-17)
import { createPilot, createHelmHud } from './autopilot.js';   // the pilot pad in the cockpit's rudder-readout spot: the round assist key and AUTO's half-moon
import { createAssist } from './assist.js';   // the one assist key: TACK, GYBE, FREE, REFLOAT by the boat's state (owner 2026-11-16)
import { createThrottleColumn } from '../../src/stations/sloop/throttleLever.js';
import { createTackButton } from '../../src/stations/sloop/tackButton.js';
import { createProRecess, demoAllowed, DEMO } from '../../src/stations/sloop/proRecess.js';
import { createTrimPanel, STEP as TP_STEP } from '../../src/stations/sloop/trimPanel.js';
import { LEVEL_BLOW } from '../../src/sim/wind.js';
import { createStation } from './station.js';
import { createViews } from './views.js';
import { keyAction } from './keys.js';
import { createTheme } from '../../src/ui/theme.js';   // M5e: the instruments' night palette after sunset (auto: −1° / +1° hysteresis)
import { GAME_SPEED, parseV2Flags, liveChartOn as liveChartFlag } from '../engine/flags.js';
import { createDayClock } from './dayClock.js';
import { createKeyLegend } from '../../src/ui/keyLegend.js';
import { createPassage } from '../../src/ui/passage.js';   // the 'passage' service: the mark in force and the leg to it (main.js's beacon reads it)
import { mountSeamanship, seaKey, isLeverKey, SEA_NOTES } from './seamanship.js';   // #8, #14: the engine's and the tackle's keys, switches and lines (v1's seamanship.js)
import { createSkipperVoice } from '../../src/ui/skipperVoice.js';   // music: the old skipper speaks each hint line once (v1's controllers/sail.js)
import { touchDevice } from '../../src/ui/device.js';
import { attachGrounding } from '../../src/sail/grounding.js';   // Setup's shallow water: v1's assist, sounder and words (three-free)
import { groundTerrain } from '../../src/sim/boat/groundTerrain.js';
import { mountTopBar, newBarOn } from './topBar.js';   // the new top bar, the default (?bar=old: the old one)
import { PLACE } from '../../src/sim/place.js';
import { StatusWatch } from '../../src/ui/statusLine.js';   // U12: v1's status line in the top bar's event line ("Sails coming down…", "Reefing…", "Stop", "Engine off")
import { createThrottleWord } from './throttleWord.js';   // the lever's lit word only while it is touched (owner, 2026-11-14)
import { createThumb } from './thumb.js';   // an upright phone's one-thumb controls (owner 2026-11-15)
import { createFlat } from './flat.js';
import { markLine } from './sailMark.js';   // what a set mark says: "Mark set. Click NAV to sail there."
import { feature } from '../../src/core/features.js';
import { TEA_HOUSE } from '../sim/teaHouse.js';   // the tea house's spot and name: the enlarged chart's label on a desktop (owner 2026-11-18)
import { setTouchLine } from '../../src/ui/controlsHint.js';   // a phone's flat controls in place of the 3D cockpit (C, owner 2026-11-16)
import { createPhoneQuiet } from '../../src/ui/phoneQuiet.js';   // a phone's quiet skipper (owner 2026-11-16)
import { createLeanSkipper, textKind } from './leanSkipper.js';   // the lean skipper (owner 2026-11-17): MUST at once, a tip once ever, no chatter, one line per 20 s
import { PILOT_SAY } from './autopilot.js';
import { COURSE_KINDS } from '../../src/sim/marks/course.js';   // U15: the course tool's two kinds (the marks' sim is its own chunk: ui/course.js)
import { LAKE_BOX, LAKE_CHART } from './lakeBox.js';   // the whole lake's box and its chart square: the enlarged chart's lake zooms

const tabStore = () => { try { return globalThis.sessionStorage ?? null; } catch { return null; } };

export function createSailUi({ B, windField, clock, cockpit = null, terrain, canvas, views: viewsIn = null, exposure = () => 1, settings = null, sun = () => 20, weather = null, day = {}, music = null, world = {} }) {   // world also: race() (Regatta's view and plates), takeHelm() (Cruise's hand-over): the phone's flat controls   // world: the page's pieces the chart and the marks read (main.js): { props (render/raceProps.js), water, raceOn(), kayakMarks() }   // music: the page's (v2/audio/music.js): the bar's Music, the voice's bus   // day: the day clock's page facts ({ fireworks, show, stars, cue }: main.js, v2/ui/dayClock.js)   // settings: the page's store (settingsStore.js; the Calm HUD's preset); M5e: sun() the frame's sun elevation (the theme), weather the Weather menu's state (src/sim/weather/weatherMenu.js)
  const flags = FLAGS;
  const GAME_SPEED_NOW = Number.isFinite(parseFloat(flags.speed)) ? Math.min(8, Math.max(0.1, parseFloat(flags.speed))) : GAME_SPEED;   // engine/flags.js sceneParams' speed
  const services = createServices();
  const once = flags.once !== '0' && flags.once !== false;
  const phys = B.phys, ctl = B.ctl;
  const H = document.documentElement;
  touchInit();
  // the device classes (src/ui/device.js; v1's shell): lk-phone, lk-phone-l, lk-tablet, for the JS that reads them (CSS reads the profile's data-*)
  const deviceNow = () => { const kind = deviceKindNow(); for (const c of ALL_DEVICE_CLASSES) H.classList.toggle(c, deviceClasses(kind).includes(c)); return kind; };
  deviceNow(); addEventListener('resize', deviceNow);
  const modality = createModality({ coarse: () => isCoarse() }); services.provide('modality', modality);
  services.provide('player', { phys });
  services.provide('modeOptions', { hud: 'calm' });   // Sail's default (calmHud.js: Calm in Sail and Cruise)

  // the views (deck.js): follow and helm; C, the bar's switch
  const views = viewsIn ?? createViews({ vessel: B.vessel, view: flags.view === 'helm' ? 'helm' : 'follow', followYaw: () => B.follow.yaw });
  let lastUse = 0, t = 0;
  const used = () => { lastUse = t; };
  // the mode on screen (v2/cruise: Cruise's passenger UI takes the page while its autopilot sails; Sail's bar, keys, station,
  // hints and legend step aside, as v1's Cruise mounts none of them until the hand-over)
  let mode = 'sail';
  // an anchorage picked on a chart: NAV sails her to the mark just set (Sail only: not a race, not Cruise, whose own autopilot sails);
  // NAV already on takes the new mark up by itself (ui/autopilot.js update)
  // the mark's nudge (owner 2026-11-20: NAV does not start itself): the line says what comes next and NAV pulses once, calm,
  // when it is off; a pulse waits while the menu or the chart covers the cockpit
  const navNow = () => ({ on: !!services.get('pilot')?.engaged, touch: !!services.get('modality')?.touch });
  let navPulseWait = false;
  const pulseNav = () => { navPulseWait = true; };
  services.provide('navPulse', pulseNav);
  const navToMark = () => { const pl = services.get('pilot'); if (mode === 'sail' && !world.raceOn?.() && pl && pl.mode === 'off') pl.auto(); };
  const sailing = () => mode === 'sail';

  // the wind level (controllers/sail.js setLevel): set on the open bay, blown in over ≈ 25 s
  const setLevel = (n) => windField?.setLevel?.(n, { t: B.t, at: { x: phys.state.x, z: phys.state.z }, overS: LEVEL_BLOW.overS * GAME_SPEED_NOW });   // v1: LEVEL_BLOW.overS × timeScale (≈ 25 s of play on the sim's clock)
  const windPick = { level: () => windField?.level ?? 3, set: (n) => setLevel(n) };

  // the sloop's lessons: the skills and the words (src/lessons/sail.js), the quiet hint line under the bar
  let store = null; try { store = once ? globalThis.localStorage ?? null : null; } catch { store = null; }
  const skills = createSkills({ storage: store });
  const words = createWords({ storage: store, skills, mode: flags.words === 'sailor' ? 'sailor' : 'both' });
  services.provide('skills', skills); services.provide('words', words);
  // the skipper's voice (v1's controllers/sail.js): on the music's voice bus, ducking the music; Setup's row turns it off. Not without
  // the page's music (a ?filmui=1 film, ?music=0): text only
  const voice = music ? createSkipperVoice({ audio: music.core, prefetch: true, base: new URL('audio/skipper/', document.baseURI).href, enabled: settings?.get('skipperVoice') !== false,
    ...(touchDevice() ? { prefetchFirst: 3, prefetchRestGapMs: 4000 } : {}), blocked: () => services.get('captainTools')?.radio?.state?.playing === true }) : null;
  // the anchor's own lines (v2/ui/seamanship.js SEA_NOTES, voiced by tools/v2-sea-voice.py into audio/skipper-v2/): the same voice
  // rules on their own folder; Setup's row turns both off; one never talks over the other
  const seaVoice = music ? createSkipperVoice({ audio: music.core, base: new URL('audio/skipper-v2/', document.baseURI).href, enabled: settings?.get('skipperVoice') !== false,
    blocked: () => services.get('captainTools')?.radio?.state?.playing === true }) : null;
  if (voice && seaVoice) { const set = voice.setEnabled.bind(voice); voice.setEnabled = (on) => { seaVoice.setEnabled(on); return set(on); }; }
  // a phone's quiet skipper (src/ui/phoneQuiet.js, owner 2026-11-16): trying to sail = sails up, not made fast, no engine, not aground
  const phoneQuiet = createPhoneQuiet({ storage: store, trying: (s) => !s.held && !B.sea?.held && (s.furl ?? 0) < 0.5 && !phys.engine?.on && B.ground?.state?.mode !== 'aground' });
  // the lean skipper (v2/ui/leanSkipper.js, owner 2026-11-17) on top of the phone's rule: every line on the row by its kind; nothing
  // but a MUST line during a manoeuvre: a tack, gybe, FREE or REFLOAT running, the bow turning through the wind (the tack carry), the
  // sails going up or down, the anchor going down or coming up
  const ANCHOR_WORK = new Set(['falling', 'down', 'weighing', 'up']);   // not 'held' (nor 'stowed'): at anchor is quiet water, so "Anchor's holding." (a tip) can show
  const leanBusy = () => !!assist?.active || !!B.carryKeep || Math.abs((phys.state.furl ?? 0) - furlWantNow()) > 0.03 || ANCHOR_WORK.has(B.sea?.tackle?.state?.anchor?.phase);
  // the first sail's intro is due (v2/ui/firstSail.js: Sail, welcomed, not yet said; never on a ?filmui=1 film, which builds no first sail)
  const firstDue = () => mode === homeId() && flags.filmui !== true && !!settings?.get && settings.get('welcomed') === true && settings.get('introShown') === false;
  const lean = createLeanSkipper({ phone: phoneQuiet, storage: store, busy: leanBusy, firstDue });
  services.provide('lean', lean);
  const hint = createControlsHint({ services, state: () => phys.state, once, skills, words, proKeys: () => pro, pilot: () => B.assists?.pilot !== false, voice, phoneQuiet: lean,
    lean: true });   // the lean key set (owner 2026-11-20): no H list (the key legend always shows the keys; Menu › Keys has them all), no H+5/6/7 (Setup › Aids has them), no "hold H" whisper
  // a line with no kind (the shared modules: the bar, the Calm HUD, the logbook's find, the marks, the kayaks, Tessie) gets one from
  // its text before the row sees it (leanSkipper.js textKind: a few tips and refusals, else chatter)
  { const note0 = hint.note, flash0 = hint.flash;
    hint.note = (text, key, speak = null, o = {}) => note0(text, key, speak, o?.kind ? o : { ...o, kind: textKind(text) });
    hint.flash = (text, o = {}) => flash0(text, o?.kind ? o : { ...o, kind: textKind(text) }); }
  services.provide('hint', hint);

  // the dock (toolDock.js): the station's switches read their specs from it (controlPanel.js); its own icons stay hidden in Sail
  const dock = createToolDock({ ready: () => true, hidden: () => true }); services.provide('dock', dock);
  let pro = flags.pro === '1';
  let sailCourse = null;   // U15: the practice marks (ui/course.js), once the chart has fetched them
  let chart = null;   // the small chart (mountChart, below): Pro's switch reaches it (v1's attachChart: cp.setPro on a change)
  // Pro on and off (v1's controllers/sail.js setPro): the boat knows it (DRV-3: the let-fly hand-off, the pilot's course); off hands
  // the four controls back to the crew (DRV-4, U5: null); the H list redraws (hint.setPro); a player's own switch (the dock's pro,
  // the PRO recess, the TRIM button: user) tells the page, which saves Setup's proMode (lk-pro, front.js; CAP-2, U6)
  const TRIMS = ['traveller', 'twist', 'backstay', 'jibLead'];
  const setPro = (on, { user = false } = {}) => {
    pro = !!on; B.pro = pro; chart?.chart?.setPro?.(pro); hint.setPro?.(pro);
    if (pro) { for (const k of TRIMS) ctl[k] ??= phys.state[k] ?? 0; } else { for (const k of TRIMS) ctl[k] = null; }
    if (user) dispatchEvent(new CustomEvent('lk-pro', { detail: { pro } }));
    return pro;
  };
  if (pro) setPro(true); else B.pro = false;
  // the switches (seamanship.js's rows): #8, #14: the sails, the anchor, the engine, MOOR and DAWN are v1's seamanship on v2's
  // sim (v2/sim/seamanship.js: B.sea; its keys, dock rows and lines: ui/seamanship.js); the reef here
  const sea = B.sea;
  const seaUi = sea ? mountSeamanship({ sea, services, dock, hint, icons: ICONS, used, statusLine: true, speak: seaVoice ? (text) => { voice?.stop?.(); return seaVoice.say(text); } : null }) : null;
  // the reef now (the physics' target: the player's or the automatic one, whichever is deeper); REEF's tip and the lever say it
  const reefLevel = () => reefNow(phys.state, ctl);
  dock.register({ id: 'reef', key: '', name: 'reef', label: () => reefWords(B.reefSel, reefLevel()), icon: ICONS.reef ?? ICONS.pro, order: 32, action: () => { B.setReef(nextReef(B.reefSel)); used(); }, lit: () => B.reefSel === 'A' || !!B.kdWarn?.(), badge: () => (reefLevel() ? String(reefLevel()) : '') });   // a click steps A → 0 → 1 → 2 → A
  const eng = phys.engine;
  const furlWantNow = () => sea?.furlWant ?? ctl.furl ?? 0;
  dock.register({ id: 'pro', key: '', name: 'pro trim', icon: ICONS.pro, order: 80, action: () => setPro(!pro, { user: true }), visible: () => true });
  // #5, #6: the binoculars and the VHF (ui/captain.js, its own chunk after this one: 'captainTools', v1's service name); until it is
  // in, a press does nothing
  const tools = () => services.get('captainTools') ?? null;
  const binoLit = () => !!tools() && (tools().latched || tools().k > 0.5);
  const radioLit = () => !!tools()?.on;
  dock.register({ id: 'binoculars', key: 'B', name: 'binoculars', icon: ICONS.binoculars ?? ICONS.pro, order: 40, action: () => { const T = tools(); T?.setLatch(!T.latched); } });
  dock.register({ id: 'radio', key: '', name: 'VHF radio', icon: ICONS.radio ?? ICONS.pro, order: 41, action: () => { tools()?.toggle(); } });   // the panel's VHF button: the radio on / off
  dock.register({ id: 'logbook', key: '', name: 'logbook', icon: ICONS.logbook, order: 20, action: () => { services.get('logbook')?.logbook?.toggle?.(); } });   // no key (L went): Menu › Logbook

  // the dials: the wind dial (captainView) and the small chart (chartplotter): the raised views over the instruments
  const dialMods = flags.dials !== 'cockpit' && flags.dials !== 'top';
  const dialsV2 = dialMods;   // the Chart and the Coach (owner, 2026-11-25): the modules' one design; ?dials=cockpit keeps the old dials
  if (dialsV2) mountDialsLayout();
  let heelS = 0;   // the heel, smoothed (about 0.3 s at 60 fps), for the overpowered amber
  const coach = dialsV2 ? { pro: () => pro, race: () => !!world.raceOn?.(), cues: (s, posId) => {
    heelS += ((s.heel ?? 0) * 180 / Math.PI - heelS) * 0.05;
    return { main: trimCue(s, 'main'), jib: trimCue(s, 'jib'), heel: heelCue(heelS) };
  } } : null;
  const captain = createCaptainView({ state: () => phys.state, once, always: true,
    ...(dialMods ? { wedge: 'apparent', luffDeg: (s) => Math.round(luffAwaDeg(BOAT_P, s.leeway ?? 0)), pos: !dialsV2, coach } : {}) });
  // the Pro instruments panel (ui/proHud.js): a desktop, Setup's row (off by default) or ?prohud=1, the cockpit up, not the intro
  const proPolicy = feature('proHud').on, proStore = proHudSettings(), proFlag = parseV2Flags(globalThis.location?.search ?? '').prohud ?? null;
  let proClosed = false;   // the ×: Setup's off, and closed for this load even under ?prohud=1
  if (proPolicy) proStore.listen((on) => { proClosed = !on; });
  const proHud = proPolicy ? createProHud({ state: () => phys.state, onClose: () => { proClosed = true; proStore.set(false); },
    shown: () => proHudShown({ allowed: proHudAllowed({ policy: proPolicy, flag: proFlag, stored: proStore.on }), closed: proClosed, cockpitUp: ckUp, intro: document.documentElement.classList.contains('lk-intro-on') }) }) : null;
  services.provide('captain', captain);
  const terrainShim = { heightAt: (x, z) => terrain.field.height(x, z) };
  // Setup's shallow water (v1's src/sail/grounding.js: the assist bears away from a shoal, the sounder, R.'s words), on the boat's
  // own bottom; the boat's hands ask it each frame (v2/sim/boat.js assists.shoal); ?shoal=0 starts it off (v1's row). Not on a ?filmui=1
  // film (the goldens' hud frames: its sounder would change the chart face's DPT reading; v1's rule, captures build no extras)
  const grounding = B.ground && B.assists && flags.filmui !== true && flags.filmui !== '1' ? attachGrounding({ flags }, { phys, ground: B.ground, groundTerrain: (B.groundTerrain ?? groundTerrain({ heightAt: terrainShim.heightAt })) }, { hint, sea: B.sea ?? null }) : null;   // #8: sea as v1's: the assist stands down at anchor, on the lines and coming alongside
  if (grounding) B.assists.shoal = (dt, o) => grounding.update(dt, o);
  if (grounding && B.sea) B.sea.hooks.kedge = () => grounding.kedge();   // #8: J aground kedges off (v1's seamanship hooks.kedge)
  const mountChart = () => {
    if (chart) return chart;
    // the passage plan (feat(v2); v1's attachChart with plan: true): the enlarged chart is the planner. v1's planner
    // and course (ui/plan.js) on v1's navigator chart from the baked grid (ui/planChart.js): both their own chunk, from here
    //, 2026-11-17: "the plan chart loads on first open"; every device): the planner and its whole-lake
    // chart (planChart.bin, 169 KB) come on the enlarged chart's first opening (or its first pick, or planReady: a film, a probe)
    let plan = null, planP = null;
    const planLoad = () => (planP ??= Promise.all([import('./plan.js'), import('./planChart.js')]).then(([{ mountPlan }, { loadPlanChart }]) => {
      plan = mountPlan({ services, cp, flags, clock, chartP: loadPlanChart(), isTouch: () => document.documentElement.dataset.input === 'touch',
        cruisePick: (p) => services.get('cruisePick')?.(p) ?? null,   // Cruise's mark from the chart (v2/cruise/index.js)
        offChart: (p, why) => world.sailMark?.()?.place(p, { line: why === 'route' ? 'No safe course there, so no route. The mark is lit.' : 'Past my chart, so no course. The mark is lit: sail to the light.' }) ?? null });   // Sail's mark (main.js: the beacon on it; drawn on the chart)
      plan.setMode(mode);
      return plan.ready;
    }).catch((e) => { console.error(e); return null; }));
    // today's track (#44): the logbook's line (v1's src/sail/logbook.js on v2, ui/logbook.js: a point every 1.5 s of sim time, thinned
    // to one per 20 m past 1,200), plus the boat now, as v1's attachChart (src/sail/chart.js); the chartplotter draws it as v1's
    const nowPt = { x: 0, z: 0, v: 0 };
    const track = () => { const tr = services.get('logbook')?.track ?? [], s = phys.state; nowPt.x = s.x; nowPt.z = s.z; nowPt.v = s.sog; return tr.length ? [...tr, nowPt] : tr; };
    // U15: the practice marks (v1's src/marks/scene.js course tool on the enlarged chart): the marks' sim and their props, their own
    // chunk (ui/course.js), fetched with the chart; a Lay pressed before it lands waits for it
    const courseP = import('./course.js').then(({ createSailCourse }) => {
      const water = world.water ?? null, wat = (x, z) => (water?.heightAt ? water.heightAt(x, z) : 0);
      sailCourse = createSailCourse({ B, windAt: (x, z, tt) => B.env(tt).windAt(x, z, tt), depthAt: (x, z) => -terrain.field.height(x, z), surface: { heightAt: (x, z) => wat(x, z) },
        note: (text) => hint.note?.(text), time: () => B.t, props: typeof world.props === 'function' ? world.props : world.props ?? null, wantProps: () => world.raceKit?.(), raceOn: () => !!world.raceOn?.() });   //: the props' chunk on the first laid course
      services.provide('marks', sailCourse);
      return sailCourse;
    }).catch((e) => { console.error(e); return null; });
    const courseTool = {
      kinds: Object.values(COURSE_KINDS).map((k) => ({ id: k.name, label: k.name === 'triangle' ? 'Triangle' : 'Windward-leeward' })),
      lay: (kind) => courseP.then((c) => c?.chart.lay(kind) ?? null), clear: () => { sailCourse?.chart.clear(); },
      get laid() { return !!sailCourse?.chart.laid; }, marks: () => sailCourse?.chart.marks() ?? [],
      get next() { return sailCourse?.chart.next ?? null; }, get sequence() { return sailCourse?.chart.sequence ?? []; },
      get label() { return sailCourse?.chart.label ?? null; }, get done() { return !!sailCourse?.chart.done; },
    };
    // U10: v1's night palette (the sun's elevation, src/sail/chart.js), hidden under the logbook and the menu (cards over its
    // corner), the kayakers' marks
    // no Tessie mark on the cockpit's chart dial: Off Fannette's pin carries her tiny logo on the map (ui/chart/tessieGlyph.js)
    // the tea house's name on the enlarged chart (owner, 2026-11-18: desktop only, as the ruin itself: feature('teaHouse'))
    const places = feature('teaHouse').on ? { teahouse: { x: TEA_HOUSE.x, z: TEA_HOUSE.z, name: TEA_HOUSE.chartName } } : {};
    const cp = createChartplotter({ terrain: terrainShim, places, boat: () => phys.state, track, targets: () => [], kayaks: () => world.kayakMarks?.() ?? [], areas: () => [],
      sunElevDeg: () => sun(), hidden: () => logOpen() || !!services.get('menu')?.isOpen, pro, course: courseTool,
      onPick: (p) => { planLoad().then(() => { return plan?.pick(p); }); }, plan: true,   // v1's: every tap and button of the plan to the planner (the planner loads on the first pick or opening)
      windAt: windField?.sample ? (x, z, t) => windField.sample(x, z, t) : null, time: () => clock?.t ?? 0,   // the barbs: the wind field's 60 s mean
      lake: { bounds: LAKE_CHART, keep: LAKE_BOX, gridM: 40, baseM: 30 },   // the whole lake: two far zooms over its coarse base (the planner charts it all)
      mark: () => world.sailMark?.()?.mark ?? null,   // Sail's double-tap mark on the chart (main.js: the beacon's)
      aids: () => world.navAids?.() ?? [],   // channel markers (v2/sim/channelMarks.js): the buoys' chart symbols
      // the anchor seen (2026-11-17): the good anchoring spots (v2/sim/anchorages.js); a tap on one sets it as Sail's mark, the
      // beacon and AUTO's target (main.js navTarget), so AUTO can take her there
      // the anchorage cue: the one she is inside is drawn lifted (lit)
      anchorages: () => { if (world.raceOn?.()) return []; const L = sea?.anchorages ?? [], c = sea?.cue?.spot; return c ? L.map((a) => (a === c ? { ...a, lit: true } : a)) : L; },
      // the birthplaces (Phase 1b): the pins on the enlarged chart, "Sail from here" the veiled move (main.js's service)
      pins: () => { const svc = services.get('birthplace'); if (!svc || world.raceOn?.()) return []; const cur = svc.current; return svc.list().map((r) => ({ id: r.id, name: r.name, x: r.x, z: r.z, why: r.why, lit: r.id === cur })); },
      onPin: async (p) => { const r = await services.get('birthplace')?.moveTo(p.id); return r?.ok ? { ok: true } : { ok: false, text: REFUSALS[r?.why] ?? REFUSALS.unknown }; },
      onAnchorage: (a) => { const m = world.sailMark?.(); if (!m) return; m.set(a.x, a.z); hint.flash?.(`${a.name}: the mark is set. NAV takes her there.`, { secs: 5, kind: 'sea.anchorage' }); used(); navToMark(); },
      ...(dialsV2 ? { shoreWarn: Object.assign((h, x, z) => shoreArcs(h, x, z), { reach: DIALS_V2.shoreReachM }), cogOn: () => pro, poi: () => {   // the mini map: the nearest place
        const s = phys.state; if (!s) return null;
        const list = [], tg = world.navTarget?.(), mk = world.sailMark?.()?.mark;
        if (tg && !tg.arrived) list.push({ kind: tg.kind === 'race' ? 'race' : 'mark', name: tg.name ?? '', x: tg.x, z: tg.z });   // the beacon's target: a pin, the race's next mark, the set mark
        else if (mk) list.push({ kind: 'mark', name: '', x: mk.x, z: mk.z });
        if (!world.raceOn?.()) {
          for (const r of services.get('birthplace')?.list?.() ?? []) list.push({ kind: 'birthplace', name: r.name, x: r.x, z: r.z });
          for (const a of sea?.anchorages ?? []) list.push({ kind: 'anchorage', name: '', x: a.x, z: a.z });
        }
        return poiRow(nearestPoi(s, list), pro);
      } } : {}) });
    // the live chart (Phase 2b; on by default, ?livechart=0 keeps today's card and enlarged chart for one release): the map
    // behind the card at the voyage start and in the menu (v2/ui/chart/mapScreen.js). N and the bar's Chart open the menu, the same screen
    const liveSync = liveChartOn() ? mountLiveChart({ cp, track, courseTool, planLoad, getPlan: () => plan }) : null;
    chart = { chart: cp, update: (dt) => { if (!planP && cp.toggle?.big && !liveSync) planLoad(); plan?.update(dt); cp.update(dt); liveSync?.(); }, course: courseTool, courseReady: courseP, get state() { return cp.state; },   // state: v1's chart service's (src/sail/chart.js), the passage's mark (Sail Pro's waypoint)
      get plan() { return cp.plan; }, get planner() { return plan?.planner ?? null; }, get course() { return plan?.course ?? null; }, get planReady() { return planLoad(); }, get planLoaded() { return !!planP; }, setMode: (m) => plan?.setMode(m) };   // v1's chart service's plan and planner (tools/probe_chart.mjs)
    services.provide('chart', chart);
    // U15: the course tool is Sail's (v1's Cruise chart has none): hidden while Cruise has the page (cruise/index.js sets lk-m-cruise)
    if (!document.getElementById('lk-course-v2-css')) { const st = document.createElement('style'); st.id = 'lk-course-v2-css';
      st.textContent = 'html.lk-m-cruise .lk-chart .tools button[data-key="windward-leeward"],html.lk-m-cruise .lk-chart .tools button[data-key="triangle"],html.lk-m-cruise .lk-chart .tools button[data-key="clear"],html.lk-m-cruise .lk-chart .tools .say{display:none}';
      document.head.appendChild(st); }
    return chart;
  };

  // the live chart (Phase 2b): its own chunk; the map screen (ui/chart/mapScreen.js) mounts it in the shell under the card and
  // shows it with the card (the entrance, the menu). Returns the per-frame sync: the enlarged chart's own openers (N, the bar's Chart) open the menu
  function liveChartOn() {
    return liveChartFlag(location.search, !!document.getElementById('lk-load'));
  }
  // the map's crosshair, layers and wake (on by default, ?mapux=0 none): your wake kept per device, sampled each step below
  let wakeStore = null, wakeRow = null;
  function mountLiveChart({ cp, track, courseTool, planLoad = () => Promise.resolve(null), getPlan = () => null }) {
    const mapUx = parseV2Flags(location.search).mapux !== false;
    // line: a string, or null for the mark's own (markLine: "Mark set. Click NAV to sail there."), then NAV pulses once if it is off
    const markAt = (p, line, { name = '' } = {}) => {
      const m = world.sailMark?.(); if (!m) return { ok: false, why: 'unknown' };
      const was = !!m.mark, n = navNow(); m.set(p.x, p.z);
      hint.flash?.(line ?? `${name}${markLine(was, n)}`, { secs: 5, kind: line ? 'chart.target' : 'mark.set' }); if (!line && !n.on) pulseNav(); used(); return { ok: true };
    };
    // the open water's card on the live chart (owner, 2026-11-18: "I can no longer set a target on the map"): the depth from the terrain;
    // Set as target is Sail's mark (the beacon, NAV) after the mark's own rule (2 m of water); Add waypoint, Set course and Clear route
    // are the passage plan's (ui/plan.js: the navigator's checks, its route on both charts)
    const depthAt = (x, z) => -terrain.field.height(x, z);
    const LAND = 'That is dry land. Pick open water.', SHOAL = 'Too shallow there. Pick deeper water.';
    const waterCheck = (p) => { const d = depthAt(p.x, p.z); return !Number.isFinite(d) ? null : d <= 0 ? LAND : d < 2 ? SHOAL : null; };
    // Cruise: the navigator's one mark (cruisePick: its own checks, its own line); the chartplotter's setDestination is wrapped so the
    // live chart can draw it too
    let cruiseDest = null;
    const cpSet = cp.setDestination;
    if (cpSet) cp.setDestination = (d) => { cruiseDest = d && Number.isFinite(d.x) ? { x: d.x, z: d.z } : null; return cpSet(d); };
    const setWater = (p, line = null) => {   // a double-click on the water: "Mark set. Click NAV to sail there." (NAV does not start itself: owner 2026-11-15)
      const no = waterCheck(p); if (no) return { ok: false, text: no };
      if (mode === 'cruise') { const r = services.get('cruisePick')?.({ op: 'add', x: p.x, z: p.z }); return r === 'set' ? { ok: true } : { ok: false, text: 'No safe way there for her. Pick another spot.' }; }
      return markAt(p, line);
    };
    services.provide('chartTarget', {
      set: (p) => markAt(p, null, { name: `${p.name}: ` }),
      // Anchor here: the mark, and NAV sails her there (the line said so while nothing engaged it; fix 2026-11-18)
      anchor: (p) => {
        const r = markAt(p, `${p.name}: the mark is set. NAV takes her there.`);
        if (r.ok) navToMark();
        return r;
      },
      depth: depthAt, setWater,
      // Sail here (the chart's routing, 2026-11-25): the target, then NAV takes her there at once; the chart stays open and the boat
      // sails under it (the pilot's own routing off land and shoal: sim/autoNav.js); a hand on the helm takes over as with NAV
      sailHere(p) {
        if (mode === 'cruise') return setWater(p);
        const no = waterCheck(p); if (no) return { ok: false, text: no };
        const r = markAt(p, p.name ? `${p.name}: NAV takes her there.` : 'NAV takes her there.', { name: p.name ?? '' });
        if (r.ok) navToMark();
        return r;
      },
      async addWaypoint(p) {
        const no = waterCheck(p); if (no) return { ok: false, text: no };
        await planLoad();
        const pl = getPlan(); if (pl) await pl.ready;
        const c = pl?.check(p.x, p.z);
        if (!c) return { ok: false, text: 'The chart is still loading. Try again in a moment.' };
        if (!c.ok && (c.reason === 'route' || c.reason === 'off')) return setWater(p, c.reason === 'route' ? 'No safe course there, so no route. The mark is lit.' : 'Past my chart, so no course. The mark is lit: sail to the light.');   // as the old chart: the mark instead
        if (!c.ok) return { ok: false, text: c.say };
        pl.pick({ op: 'add', x: c.at[0], z: c.at[1] }); used();
        return { ok: true };
      },
      mode: () => mode,
      clearTarget() { if (mode === 'cruise') { services.get('cruisePick')?.({ op: 'clear' }); return { ok: true }; } world.sailMark?.()?.clear?.(); hint.flash?.('Mark cleared.', { secs: 4, kind: 'chart.target' }); return { ok: true }; },
      canWaypoint(p) { const c = getPlan()?.check(p.x, p.z); return c ? c.ok : null; },   // the navigator's verdict now (null: its chart not in yet)
      setCourse() { const pl = getPlan(); if (!pl?.course?.route.length) return { ok: false, text: 'Add a waypoint first.' }; pl.pick({ op: 'set' }); used(); return { ok: true }; },
      clearRoute() { const pl = getPlan(); if (!pl) return { ok: false, text: 'No route to clear.' }; pl.pick({ op: 'clear' }); return { ok: true }; },
    });
    const host = document.createElement('div'); host.className = 'lk-livechart'; host.hidden = true;
    document.body.appendChild(host);   // the map screen moves it into the shell
    let screen = null, mapBoatLayer = null;
    document.documentElement.classList.add('lk-livechart-on');
    if (!document.getElementById('lk-livechart-host-css')) { const st = document.createElement('style'); st.id = 'lk-livechart-host-css';
      st.textContent = 'html.lk-livechart-on .lk-chart .big{display:none!important}.lk-livechart[hidden]{display:none}'; document.head.appendChild(st); }
    Promise.all([import('./chart/mapScreen.js'), import('../stage/areas.js'), import('../terrain/channel.js'), mapUx ? import('./chart/mapUx.js') : null, import('../sim/racePlaces.js'), import('./chart/chartModel.js')]).then(([{ mountMapScreen }, { areaOf }, { CHANNEL }, uxMod, placesMod, modelMod]) => {
      if (uxMod) {
        let ls = null; try { ls = globalThis.localStorage; } catch { /* blocked */ }
        wakeStore = uxMod.createWakeStore({ storage: ls }); services.provide('mapWake', wakeStore);
        import('./wakeRow.js').then(({ mountWakeRow }) => { wakeRow = mountWakeRow(document.getElementById('lk-load'), { wake: wakeStore }); }).catch((e) => console.error(e));   // Setup › Sail › your wake: Forget
      }
      const places = [
        { id: 'fannette', name: 'Fannette Island', x: 0, z: 0, line: 'The only island in Lake Tahoe. A stone tea house on its summit.' },
        { id: 'vikingsholm', name: 'Vikingsholm', x: -549, z: 217, line: 'A 1929 house in the old Scandinavian style, at the head of the bay.' },
        { id: 'falls', name: 'Eagle Falls', x: -896, z: 173, line: 'The creek from Eagle Lake falls into the head of the bay.' },
        ...(feature('teaHouse').on ? [{ id: 'teahouse', name: 'Tea house', x: TEA_HOUSE.x, z: TEA_HOUSE.z, zoomClass: 'C', line: 'A 16 ft square stone ruin from 1929.' }] : []),
      ];
      screen = mountMapScreen({ host, services, ux: wakeStore ? { wake: wakeStore, layers: true, cursor: true } : null, mapHint: { seen: () => !!settings?.get('mapHintSeen'), done: () => settings?.set('mapHintSeen', true), sailSeen: () => !!settings?.get('sailHereSeen'), sailDone: () => settings?.set('sailHereSeen', true) }, box: feature('phoneCard').on, glass: feature('chartGlass').on,
        sources: { boat: () => phys.state, track, night: () => nightOf(sun()), mark: () => (mode === 'cruise' ? cruiseDest : world.sailMark?.()?.mark ?? null),
          navLine: () => { const pl = services.get('pilot'), m = world.sailMark?.()?.mark; return m && pl?.engaged ? pl.nav?.line ?? null : null; },   // the pilot's routed line to the target (NAV on): the planner's legs round land
          route: () => { const c = mode === 'cruise' ? null : getPlan()?.course; return c && c.route.length ? { pts: c.route, active: !!c.active, leg: c.leg ?? 0 } : null; },
          anchorages: () => { if (world.raceOn?.()) return []; const L = sea?.anchorages ?? [], c = sea?.cue?.spot; return c ? L.map((a) => (a === c ? { ...a, lit: true } : a)) : L; }, aids: () => world.navAids?.() ?? [], places: () => places,
          beTessie: () => feature('playTessie').on && !world.raceOn?.(),   // Be Tessie on Off Fannette's card (her water's pin): desktop and tablet, never in a race
          channel: () => ({ pts: CHANNEL.pts }), raceMarks: () => (courseTool.laid ? courseTool.marks() : []),
          racePins: () => { if (!world.raceOn?.()) return []; let st = null; try { st = globalThis.localStorage; } catch { /* blocked */ } return modelMod.racePins(placesMod.listCups({ store: st, has: placesMod.hasFrom(feature) })); },
          corners: () => services.get('hunts')?.chart?.() ?? [] },   //: the cups' hunts' corners (◇, filled once found), in every mode   //: the place races' pins (Races layer), only while Regatta is the mode (owner 2026-11-19); Tessie's Deep only where she can go
        ground: { live: feature('chartGround').tier === 'live', heightAt: terrainShim.heightAt, ready: () => terrain.field?.slot?.(1)?.variant === 'full' },
        touch: () => feature('fingerTargets').on, reduced: () => reducedNow(),
        showTessie: () => feature('playTessie').on, deepAt: (x, z) => -terrainShim.heightAt(x, z),   // the Boat plate's Tessie and her deep pins
        factDate: () => (flags.hour == null ? new Date() : null) });   // the chart's lake fact: the day's; ?hour (a deterministic page): the first
      if (!screen) return;
      screen.chart.on('mark', (p) => { const ct = services.get('chartTarget'), r = ct?.sailHere ? ct.sailHere(p) : setWater(p); if (!r.ok && r.text) hint.flash?.(r.text, { secs: 5, kind: 'refuse.mark' }); });   // a double-click (a double-tap) on the map's water: Sail here's shortcut (the target, NAV on it)
      // the Coach's boat on the map in play (mapBoat.js: the cockpit Coach's own drawing, turned to her heading), in place of the sloop glyph
      import('./chart/mapBoat.js').then(({ mountMapBoatLayer }) => { mapBoatLayer = mountMapBoatLayer({ chart: screen.chart, host, state: () => phys.state, shown: () => !screen.entrance && !host.hidden }); }).catch((e) => console.error(e));
      services.provide('liveChart', screen.chart);
      services.provide('raceHere', async (id) => { const r = await world.racePlace?.(id); if (!r) return { ok: false, why: 'unknown' }; services.get('menu')?.close?.(); return { ok: true }; });   // a race pin's Race here
      services.provide('mapScreen', screen);
    }).catch((e) => console.error(e));
    // N and the bar's Chart pin the enlarged chart (v1's toggle); with the map screen they open the menu instead: the same screen
    return () => {
      if (!cp.toggle?.big) return;
      cp.toggle.unpin?.();
      const m = services.get('menu');
      if (screen && m && !m.isOpen && m.state === 'gone') m.open?.();
    };
  }

  const pads = { ext: { steer: 0, on: false } };   // the Tack assist's hand (pads.js ext)
  // the pro trim panel shows only once the station has placed it for the layout in force (fix/v2-pro-slider, 2026-11-14: an upright
  // phone's layout has no trim rect, so the panel, never placed, drew at 0,0 over the top bar; v1 leaves it unplaced below the
  // screen there, so v1 hides it on an upright phone and v2 now does the same; the cockpit's PRO recess is its own layer)
  let trimLay = null;
  const trimPlaced = () => { const r = station?.rects; return !!r && r === trimLay && r.form !== 'cockpit' && !!r.trim; };
  const trimPanel = createTrimPanel({ get: () => ({ traveller: ctl.traveller, twist: ctl.twist, backstay: ctl.backstay, jibLead: ctl.jibLead, wing: !!ctl.jibSide }),
    set: (k, v) => { ctl[k] = v; used(); }, wing: () => { B.wing(); used(); }, vhf: () => radioLit(), onVhf: () => { tools()?.toggle(); dispatchEvent(new Event('lk-click')); }, shown: () => pro && trimPlaced(), step: 2 * TP_STEP });   // Pro's steps twice v1's (owner 2026-11-16)
  const logOpen = () => !!services.get('logbook')?.logbook?.isOpen;   // the logbook's card (ui/logbook.js): v1's stations and bar step aside under it
  const binoUp = () => !!tools()?.binoUp;   // v1's deck.binoUp: the bar and the station step aside under the glasses
  const chartBig = () => !!chart?.chart?.toggle?.big;   // U9: the enlarged chart takes the screen: the bar and the cockpit fade out and go inert (v1's deck switchShown, station dashHidden)
  const hubUp = () => document.documentElement.classList.contains('v2-rg-hub');   // Regatta's hub (v2/regatta/hub.js) holds the screen as a menu does
  // The chart page (the enlarged chart, pinned: left) and the logbook (its mirror on the right, v2's side card below) are one page at a
  // time (owner 2026-11-17: "make sure the chart page and the log page can't overlap awkwardly"): opening one closes the other,
  // whichever path opened it (the dials, N, L, the bar's Chart, the card's CHART or LOG); pageWatch() settles it each frame
  const logApi = () => services.get('logbook')?.logbook ?? null;
  // the live map (Phase 2b): the chart dial opens the same screen as Menu, Esc and N (owner, 2026-11-18): the live
  // chart centred on the boat with the panel, never the old enlarged chart
  // the map screen's module loads a beat after the dial does: until it does, the class lk-livechart-on (set at mount) says it is coming,
  // and the card opens now (the map follows the shell's state when it mounts); the old pin would draw nothing (its pane is hidden then)
  function openMapScreen() { const m = services.get('menu'); if (!m || !(services.get('mapScreen') || document.documentElement.classList.contains('lk-livechart-on'))) return false; if (logOpen()) logApi()?.close?.(); if (!m.isOpen) m.open?.(); return true; }
  function openChartPage() { if (openMapScreen()) return; if (logOpen()) logApi()?.close?.(); const tg = chart?.chart?.toggle; if (!tg) return; tg.shown = true; if (!tg.pinned) tg.pin(); pageWas.pin = true; pageWas.log = false; }
  function openLogPage() { const tg = chart?.chart?.toggle; if (tg?.pinned) tg.unpin(); logApi()?.open?.(); pageWas.pin = false; pageWas.log = true; }
  const pageWas = { pin: false, log: false };
  function pageWatch() {
    const tg = chart?.chart?.toggle, pin = !!tg?.pinned, lg = logOpen();
    if (pin && lg) { if (!pageWas.pin) logApi()?.close?.(); else tg.unpin(); }   // the one that just opened stays
    pageWas.pin = !!tg?.pinned; pageWas.log = logOpen();
  }
  let dialModules = null;   // made below, once calm is
  let ckUp = false;   // the cockpit up this frame (ui/cockpitUp.js; ui.cockpitUp)
  const dashHidden = () => !sailing() || !!services.get('played')?.played || !!services.get('menu')?.isOpen || logOpen() || hint.current === 'keys' || binoUp() || chartBig() || hubUp();
  // quiet: the one-thumb controls (thumb.js) never fade, so "Tap to show the helm" is stale there; ?thumb=0's grid still fades and keeps it
  const calm = createCalmHud({ services, settings, getOptions: () => services.get('modeOptions') ?? {}, quiet: () => document.documentElement.classList.contains('lk-one-thumb') || document.documentElement.classList.contains('lk-flat'), foldOnDown: true });   // H only folds, on key-down
  if (dialMods) dialModules = createDialModules({ calm, inMode: () => showsDials(world.modeId?.() ?? homeId()), played: () => !!services.get('played')?.played, open: { chart: () => openChartPage(), log: () => openLogPage() } });
  services.provide('calm', calm);
  services.provide('controls', { hint, get tools() { return { bino: { k: binoUp() ? 1 : 0 } }; }, ctl, get pro() { return pro; }, proKeys: 'pro-sheet' });   // proKeys: v2's Pro keys (R/F the jib sheet, the lead on the PRO panel; src/ui/keyLegend.js)   // tools.bino.k: v1's shape the key legend reads (it steps aside under the glasses)
  // the key legend's moments read v1's terrain object (keyLegend.js sailFacts: the shore's distance, the depth; the landmarks for
  // the binoculars' line): v2's heights and v1's baked lake and landmarks (the logbook's world, its own small chunk)
  import('./logbookWorld.json').then((m) => {   // (no import attribute: Vite serves JSON as a JS module and refuses a json-typed dynamic import)
    const T = (m.default ?? m).terrain;
    services.provide('terrain', { heightAt: terrainShim.heightAt, lake: T.lake, landmarks: T.landmarks, mouth: T.mouth, waterfall: () => T.waterfall });
    if (T.lake?.island) B.setIsland?.(T.lake.island); })   // ENG-2: the island grounds as rock (v1's islandR)
    .catch(() => services.provide('terrain', terrainShim));
  // AUTO's once-only tips (ui/autopilot.js tip; owner 2026-11-17: the beat's first tack): once per device (once per page with ?once=0); a
  // reply to the player's own NAV press, so a phone's quiet skipper keeps it
  const tipSeen = new Set();
  const pilotTip = (id, text) => {
    const k = `lakeshore.v2.tip.${id}`;
    try { if (tipSeen.has(k) || store?.getItem?.(k)) return; store?.setItem?.(k, '1'); } catch { /* blocked: this page only */ }
    tipSeen.add(k); services.get('hint')?.flash?.(text, { secs: 4, kind: `nav.${id}` });
  };
  let pilot = null, apHead = null, assist = null;   // apHead: the pilot pad (createHelmHud); assist: the one assist key's rules (ui/assist.js)
  // the assist's beginner: auto-FREE for the New profile in Sail, and for Beginner aids in a race (owner 2026-11-16)
  const beginner = () => { const r = world.race?.(); return r ? r.aids?.level === 'beginner' : settings?.get?.('profile') === 'new'; };
  const makeAssist = () => createAssist({ B, tack: tackBtn, grounding, beginner, depthAt: (x, z) => B.ground?.depthAt?.(x, z) ?? 10, pilotTurn: () => pilot?.turning ?? null,
    say: (text, kind) => services.get('hint')?.flash?.(text, { secs: 4, kind }) });
  // the pilot's lines: "Plotting a course" is a status (the lean skipper drops it); anything else is a refusal that says why (MUST)
  const pilotSay = (t) => services.get('hint')?.flash?.(t, { secs: 4, kind: t === PILOT_SAY.plotting ? 'pilot.plotting' : 'refuse.pilot' });
  let station = null, panel = null, proRecess = null, tackBtn = null, throttle = null, thrWord = null, thumb = null, flat = null;
  // the station waits for the cockpit's asset (streamed beside the first frame); the rig's GPU half is the cockpit's
  function mountStation(rigIn) {
    const fns = { show: (v) => cockpit.show(v), setOpacity: (v) => cockpit.setOpacity(v), setFaces: (c) => cockpit.setFaces(c), faceDrawn: (sd) => cockpit.faceDrawn(sd), setMaxPx: () => {}, setSlots: (l) => cockpit.setSlots?.(l) };
    const rig = new Proxy(rigIn, { get: (t, k) => (k in fns ? fns[k] : t[k]) });
  const proLit = { binoculars: binoLit, radio: radioLit };
  proRecess = rig ? createProRecess({ get: () => ({ traveller: ctl.traveller, twist: ctl.twist, backstay: ctl.backstay ?? phys.state.backstay, jibLead: ctl.jibLead }),
    set: (k, v) => { if (!pro) return; ctl[k] = v; used(); }, open: () => pro, onPro: () => dock.run('pro'),
    onTool: (id) => { if (id === 'radio') { tools()?.toggle(); dispatchEvent(new Event('lk-click')); } else dock.run(id); }, lit: proLit, onUse: () => used(),
    demo: demoAllowed({ flags, webdriver: !!globalThis.navigator?.webdriver, reduced: reducedNow(), storage: tabStore() }),
    onDemo: () => tabStore()?.setItem(DEMO.key, '1'), step: 0.1 }) : null;   // a scroll notch or an arrow: a tenth of the track (v1 a twentieth; owner 2026-11-16)
  // the panel's switches: in the cockpit, and on an upright phone in v1's keys row under the winches (BACKLOG-v2 #2: the grid form);
  // a station with no form (a tablet) keeps M3's helm strip and no panel
  panel = rig ? createControlPanel({ dock, hidden: () => dashHidden() || !['cockpit', 'grid'].includes(station?.form), onPress: () => {},
    lit: { sails: () => furlWantNow() >= 0.5, anchor: () => !!seaUi?.toggles().anchor, binoculars: binoLit, pro: () => pro },
    progress: { sails: () => { const f = phys.state.furl ?? 0, w = furlWantNow(); return Math.abs(f - w) > 0.03 ? (w >= 0.5 ? f : 1 - f) : null; }, anchor: () => seaUi?.anchorProgress() ?? null,
      reef: () => { const s = phys.state, d = Math.abs((s.reefing ?? 0) - (s.reef ?? 0)); return d > 0.03 ? 1 - d : null; } } }) : null;
  const cockpitStates = () => ({
    pro: { open: pro, f: proRecess?.shownF, lit: { pro, binoculars: binoLit(), radio: radioLit() } },
    hover: proRecess?.hover ?? null,
    hideTool: { binoculars: !feature('binoculars').on },   // a finger-only device has no binoculars (owner 2026-11-15; src/core/features.js): BINOS's button leaves the 3D cockpit too
    toggles: { sails: furlWantNow() < 0.5, anchor: !!seaUi?.toggles().anchor, reef: reefLever(B.reefSel) },
    cue: { anchor: !!seaUi?.cue?.() && !world.raceOn?.() },   // the anchorage cue: ANCHOR's lamp faintly amber inside an anchorage or by a free ball (render/cockpit/rig.js CUE_GLOW)   // REEF: the selector, 0 · 1 · 2 then A at the top, its lamp amber on A (render/cockpit/rig.js)
    reefWarn: !!B.kdWarn?.(),   // K2: the knockdown's warning lights REEF's lamp amber (ease the sails or reef)
    moor: seaUi?.moor() ?? null,   // #8: MOOR near a pier (lines), DAWN at anchor after dark
    engine: eng?.state ?? 'off', rpm: eng?.rpm ?? 0, lever: eng?.lever ?? 0,
    tack: { offer: !!tackBtn?.offer, active: !!tackBtn?.active, kind: tackBtn?.kind },
  });
  // the cinematic intro (ui/cinematicIntro.js): while it holds the cockpit, the station sees the Calm HUD's view with the dashboard down,
  // so the cockpit stays sunk and rises on the fold's own glide when the hold ends (the fold and its API unchanged)
  let heldProxy = null;
  const heldCalm = () => (heldProxy ??= Object.create(calm, { view: { get: () => ({ ...calm.view, dash: false }) } }));
  station = rig ? createStation({ rig, state: () => phys.state, furl: () => ctl.furl ?? 0, hidden: dashHidden, helmView: () => views.view === 'helm' || views.k > 0.5,
    onUse: used, coarse: isCoarse(), once, flags, thumb: parseV2Flags(location.search).thumb,   // ?thumb=0: v1's portrait slots on an upright phone
    panelRect: (lay) => { panel?.place(lay.panel, lay.form, lay); throttle?.place(lay.thr, { word: lay.word, knob: lay.knob, eng: lay.eng, steps: lay.steps, litAt: lay.litAt, form: lay.form === 'cockpit' ? 'cockpit' : null }); trimPanel.place(lay.trim); trimLay = lay; },
    jibOn: () => true, fade: () => calm.slotTargets ?? null, free: () => B.free, cockpit: cockpitStates, calm: () => (services.get('intro')?.cockpitHeld ? heldCalm() : calm), pro: proRecess, exposure,
    open: { chart: openChartPage, log: openLogPage } }) : null;   // the cockpit's dials open their pages (owner 2026-11-17): the chart dial the chart, the wind dial the logbook
  services.provide('station', station); services.provide('panel', panel);
  tackBtn = station ? createTackButton({ pads, state: () => phys.state, rects: () => station.rects, shown: () => station.shown && station.form !== 'cockpit' && views.view !== 'helm' && views.k < 0.5, onUse: used }) : null;   // the cockpit: TACK is the pilot head's key (ui/autopilot.js), the pill stands down
  services.provide('tackBtn', tackBtn);
  // the pilot pad (ui/autopilot.js) in the cockpit's rudder-readout spot (station.apHud): AUTO holds her course or sails to the beacon's
  // target (world.autoNav: sim/autoNav.js); the round key is the assist (ui/assist.js: the auto-tack or gybe, FREE out of irons, REFLOAT
  // aground; the coaming's TACK button is gone: the bake's tackOff)
  assist = makeAssist(); services.provide('assist', assist);
  pilot = createPilot({ B, target: () => world.navTarget?.() ?? null, nav: () => world.autoNav?.() ?? null, tack: assist, say: pilotSay, tip: pilotTip });
  apHead = station ? createHelmHud({ el: station.apHud, pilot, assist, onUse: () => used() }) : null;
  // (the navigator loads at the first AUTO with a target:; pilot.load() still asks for it at once, for a probe)
  services.provide('pilot', pilot); services.provide('apHud', apHead);
  // the throttle (v1's stations/sloop/index.js: sea.actions, the lever's notches, an auto start out of neutral; #14: the engine's own
  // lever, which the seamanship's pre puts into ctl.throttle each step)
  if (panel && eng && sea) {
    // the word wakes on the player's own touch only (throttleWord.js): the column's drag, tap, scroll and arrows here, the + − 0
    // keys below; Cruise's driver and the engine's own rules move the lever without waking it
    const touch = () => thrWord?.wake();
    throttle = createThrottleColumn({ lever: () => eng.lever, engineState: () => eng.state, step: (d) => { sea.actions.step(d); touch(); }, set: (v, o) => { sea.actions.lever(v, o); touch(); }, onUse: () => { used(); touch(); } });
    thrWord = createThrottleWord({ el: throttle.el });
    addEventListener('keydown', (e) => {
      if (e.lkVirtual) return;
      const a = seaKey({ code: e.code, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, typing: /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '') });
      if (a?.lever) thrWord.hold(true); else if (a?.neutral) thrWord.wake();
    });
    addEventListener('keyup', (e) => { if (isLeverKey(e.code)) thrWord.hold(false); });
    addEventListener('blur', () => thrWord.hold(false));
    panel.attach(throttle); station?.relayout();
  }
  services.provide('throttle', throttle);

    // an upright phone (A + D's rail): the station draws nothing ('thumb' form) and these flat controls take the band;
    // every function is the old cluster's own call (the dock, the seamanship, the Tack assist, the chart, the logbook, the views)
    if (station) {
      thumb = createThumb({ active: () => station.form === 'thumb', hidden: dashHidden, state: () => phys.state, tack: tackBtn, sea, eng, assists: B.assists, urlTrim: flags.hand != null,
        run: (id) => dock.run(id), settings, onUse: used,
        lit: { sails: () => furlWantNow() < 0.5, anchor: () => !!seaUi?.toggles().anchor, binoculars: binoLit, radio: radioLit, reef: () => B.reefSel === 'A' },
        cue: { anchor: () => !!seaUi?.cue?.() && !world.raceOn?.() },   // the anchorage cue: the anchor control (and More) glow faintly
        moor: () => seaUi?.moor() ?? null,
        chart: () => { const tg = chart?.chart?.toggle;   // mounted once the terrain has streamed (as the old CHART key)
           if (tg) { tg.shown = true; tg.pin(); } },
        log: () => { const l = services.get('logbook')?.logbook; if (l) (l.isOpen ? l.close?.() : l.open?.()); },
        view: () => views.toggle(), menu: () => services.get('menu')?.open?.() });
    }
    ui.station = station; ui.panel = panel; ui.tackBtn = tackBtn; ui.throttle = throttle; ui.proRecess = proRecess; ui.throttleWord = thrWord; ui.thumb = thumb;
    ui.cockpitStates = cockpitStates;   // #8, #14: what the 3D cockpit draws (the key, the lever, ANCHOR, MOOR): the page test reads it
  }
  // a phone (C, owner 2026-11-16): no 3D cockpit (main.js never loads it on a touch phone), so no station, panel, lever or
  // PRO recess; the flat controls (ui/flat.js) call the same code: the dock, the seamanship, the Tack assist (its pill hidden), Pro
  function mountFlat() {
    tackBtn = createTackButton({ pads, state: () => phys.state, rects: () => null, shown: () => false, onUse: used });
    services.provide('tackBtn', tackBtn);
    assist = makeAssist(); services.provide('assist', assist);
    // the phone's Auto is the desktop's AUTO (owner 2026-11-16): the same pilot, so a double-tap mark or a chart target is sailed to
    pilot = createPilot({ B, target: () => world.navTarget?.() ?? null, nav: () => world.autoNav?.() ?? null, tack: assist, say: pilotSay, tip: pilotTip });
    services.provide('pilot', pilot);   // the navigator at the first Auto with a target
    const overlay = () => !!services.get('menu')?.isOpen || logOpen() || hint.current === 'keys' || binoUp() || chartBig() || hubUp();
    flat = createFlat({ active: () => deviceKindNow() === 'phone-land', hidden: overlay, mode: () => mode, race: () => world.race?.() ?? null, state: () => phys.state, B, views,
      tack: tackBtn, assist, pilot, sea, eng, run: (id) => dock.run(id), onUse: used, ctl, canvas, warn: () => !!B.kdWarn?.(),
      lit: { sails: () => furlWantNow() < 0.5, anchor: () => !!seaUi?.toggles().anchor },
      cue: { anchor: () => !!seaUi?.cue?.() && !world.raceOn?.() },   // the anchorage cue: the anchor control (and More) glow faintly
      pro: { on: () => pro, set: (v) => setPro(v, { user: true }) },
      chart: () => { const tg = chart?.chart?.toggle; if (tg) { tg.shown = true; tg.pin(); } },
      takeHelm: () => world.takeHelm?.() });
    services.provide('flat', flat);
    setTouchLine('look', 'Have a look round: drag the water, pinch to come closer');   // one finger looks on the flat controls (ui/touch.js oneLook)
    ui.tackBtn = tackBtn; ui.flat = flat;
  }
  // the day clock's glue (v2/ui/dayClock.js): the time menu, v1's night-sky line (the show is a time
  // event: nothing here touches the clock, the boat or the camera for it)
  const dayClock = createDayClock({ clock, fireworks: !!day.fireworks, show: day.show ?? (() => null), stars: day.stars ?? (() => null), cue: day.cue !== false,
    say: (text) => viewSwitch?.say?.(text),   // no target for the show: no chart destination, no beacon on the jump (owner, 2026-11-18)
    veil: sea?.hooks?.veil ? (op, s) => sea.hooks.veil(op, s) : null,   // a pick jumps under a short fade (owner, 2026-11-18): the sunrise's veil (ui/seamanship.js)
    reduced: () => reducedNow() });   // reduced motion: an instant cut
  // the top bar (deck.mountBar)
  const viewSwitch = createViewSwitch({
    services, view: () => views.view, set: (v) => { const r = views.set(v); used(); return r; }, moveS: views.dur,
    subtitle: (text, o) => hint.flash?.(text, o), windPick, hidden: () => !sailing() || !!services.get('menu')?.isOpen || logOpen() || binoUp() || chartBig(),
    clock: barClock({ get sun() { return { hour: clock.hour }; } }), clockMenu: dayClock.menu, weatherMenu: weather,
    quiet: () => (hint.current === 'none' || hint.current === 'whisper'), modality: () => modality.hand ?? 'mouse', once,
    music: music ? () => music.player : null,   // the ♪ Music menu: the beds in Sail (v1's createBedMusic), Cruise's playlist in Cruise
    fullKey: false,   // v2 has no Shift+F: the bar's Full button is full screen
  });
  services.provide('viewSwitch', viewSwitch);
  // the top bar (owner, 2026-11-15): Menu · Full │ Chart │ Boat | Helm │ Conditions by default; ?bar=old the old bar for one release
  if (newBarOn()) mountTopBar(viewSwitch, { mode: 'sail', hour: () => clock.hour, date: () => PLACE.date, windPick, weather, clockMenu: dayClock.menu,
    music: music ? () => music.player : () => null,
    radio: { on: () => (tools()?.channel ?? '16') !== '16', toggle: () => { tools()?.listen(); dispatchEvent(new Event('lk-click')); } },   // the sheet's VHF: the weather channel now, again back to 16 (what O did; O went)
    sound: music?.core ? { muted: () => !!music.core.muted, toggle: () => music.core.toggleMute() } : null,   // the sheet's sound on/off (M went)
    swap: { to: () => 'cruise', go: () => world.swapMode?.(), warm: () => world.warmCruise?.(), show: () => !!world.swapMode && !world.raceOn?.() },   // Sail ⇄ Cruise (owner, 2026-11-18): in place; dropped in a race
    wind: () => { const b = windField?.base; return b ? { kn: b.speedMs / 0.514444, fromDeg: b.dirDeg } : null; } });   // the bay's wind, the levels' own reference (the debug line's)
  // the conditions the panel's float plan reads and sets (ui/chart/panelPlan.js): the ship's clock, the weather and the wind, the
  // top bar's own quick picks (the time menu's cut under its fade, the Weather menu, the wind's level)
  services.provide('conditions', { hour: () => clock.hour, date: () => PLACE.date, time: dayClock.menu, weather, levels: WIND_LEVELS,
    level: () => windPick.level(), setLevel: (n) => windPick.set(n),
    wind: () => { const b = windField?.base; return b ? { kn: b.speedMs / 0.514444, fromDeg: b.dirDeg } : null; } });
  views.onChange(() => viewSwitch.used?.());
  // the key legend (v1's shell.js): the sailor's few keys on the right edge while the cockpit is up, desktop only
  const keyLegend = createKeyLegend({ services, settings, getMode: () => mode, words: { tack: 'tack · gybe · free' }, six: true, always: true });   // owner, 2026-11-20: learned rows dim, never all hidden   // Space is the assist key (ui/assist.js) services.provide('keyLegend', keyLegend);
  if (!services.get('passage')) services.provide('passage', createPassage({ services }));   // the nav column went (the Pro instruments panel, ui/proHud.js); the passage service stays

  // the keys this page owns beside the boat's (main.js: A/D ←/→, W/S ↑/↓): C and Space (H is the Calm HUD's own; the lean set)
  addEventListener('keydown', (e) => {
    if (e.lkVirtual || !sailing()) return;
    const a = keyAction({ code: e.code, shiftKey: e.shiftKey, repeat: e.repeat, ctrlKey: e.ctrlKey, metaKey: e.metaKey, typing: /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '') });
    if (!a) return;
    if (a.view) views.toggle();
    else if (a.tack) { e.preventDefault(); if (assist) assist.press(); else tackBtn?.press?.(); }   // Space: the assist key's press (TACK, GYBE, FREE, REFLOAT)
    used();
  });

  // round 2 (owner, 2026-11-21: "this UX of G should not exist"): no key, no pill, no drawer row; the crew flies the gennaker
  // (v2/sim/gennakerCrew.js) and says one quiet line as it goes up or comes down (leanSkipper.js 'gk.*': a phone once each a session)
  // the take-over (v2/sim/boat.js owned): the first W/S or R/F with crew trim on says it once a page
  let sheetsSaid = false;
  B.onTakeOver = () => { if (sheetsSaid) return; sheetsSaid = true; hint.note?.('You have the sheets.', null, null, { kind: 'crew.sheets' }); };
  B.onGennaker = (up, said) => { if (said?.said) hint.note?.(said.said === 'up' ? 'Gennaker up!' : 'Gennaker down.', null, null, { kind: `gk.${said.said}` }); };
  // the gust field around the boat for the skill model (v1's sampleGust: at the boat and 150 m out at 45° either side of the bow)
  let gust = null, gustAt = -9;
  const sampleGust = () => {
    if (!windField?.gustAt) return null;
    const s = phys.state, at = (da) => { const h = s.heading + da; return windField.gustAt(s.x + Math.sin(h) * 150, s.z - Math.cos(h) * 150, B.t); };
    return { here: windField.gustAt(s.x, s.z, B.t), left: at(-Math.PI / 4), right: at(Math.PI / 4) };
  };
  // U12: the status line (v1's controllers/sail.js, src/ui/statusLine.js): every action on the boat in plain words in the top bar's
  // event line, at once, with a multi-second job said again each second until it ends. After the boat's step (v1 reads it after
  // sea.pre, before the sim: the same frame's furl, lever and anchor)
  const status = new StatusWatch();
  let crewSaidAt = -9; let upSaidAt = -9, holdTry = null;
  const HOLD_TRY_S = 60;
  let statusNow = null;
  function sayStatus() {
    const a = sea?.tackle?.state?.anchor ?? {}, T = tools(), s = phys.state;
    // the anchor seen: while the crew works the lever or the engine it started, no notch or engine lines (the skipper said
    // "Rounding up to anchor"); "Anchor going down" stays up until the skipper's "Anchor's holding." (v1's "Anchor holding" came
    // at the end of the chain, before it bit)
    const crew = !!sea && (sea.crewHands || sea.crewEngine), crewHeld = a.phase === 'held' && !sea?.holdSaid;
    const line = status.step({ furl: s.furl ?? 0, furlWant: furlWantNow(), engine: crew ? 'off' : eng?.state, lever: crew ? 0 : eng?.lever ?? 0, anchor: { phase: crewHeld ? 'down' : a.phase, depth: a.depth },
      tackle: sea?.tackle?.mode ?? 'free', bino: !!T && (!!T.latched || T.k > 0.5), radio: T?.channel, reef: s.reef ?? 0, reefing: s.reefing ?? 0, view: views.view }, t);
    // the crew's own work on the same line: "Rounding up to anchor" while they stop her (said again each second, over the sails'
    // and the lever's lines), and the skipper's "Anchor's holding." in place of v1's "Anchor holding"
    if (sea?.stopping) { if (t - crewSaidAt >= 1) { crewSaidAt = t; viewSwitch?.say?.(SEA_NOTES.rounding.speak.replace(/\.$/, '…'), { kind: 'sea.rounding' }); statusNow = { text: 'Rounding up to anchor…', at: t }; } return; }
    crewSaidAt = -9;
    if (line && t - upSaidAt < 2.2) return;   // "Anchor's up." stays up 2 s before the sails' own line
    const out = line === 'Anchor holding' && sea?.holdSaid ? 'Anchor’s holding.' : line === 'Anchor up' ? 'Anchor’s up.' : line;
    if (out === 'Anchor’s up.') upSaidAt = t;
    if (out === 'Anchor’s holding.') holdTry = { until: t + HOLD_TRY_S, at: -9 };
    if (out !== line) { viewSwitch?.say?.(out, { kind: out === 'Anchor’s up.' ? 'sea.up' : 'sea.holding' }); statusNow = { text: out, at: t }; seaUi?.armVoice?.(out === 'Anchor’s up.' ? 'up' : 'holding'); if (holdTry) holdTry.at = t; return; }   // the anchor's kinds (ui/seamanship.js SEA_KINDS)
    // "Anchor's holding." is a tip (the lean skipper: once ever, never within 20 s of another line): dropped for the gap, it is offered
    // again each second while she still lies to it (up to HOLD_TRY_S), until the row shows it or the tip is spent
    if (holdTry) {
      const lean = services.get('lean'), spent = !!lean?.state?.seen?.includes?.('sea.holding'), shown = (hint.el?.textContent ?? '').includes('Anchor’s holding');
      if (spent || shown || t > holdTry.until || a.phase !== 'held' || !sea?.holdSaid) holdTry = null;
      else if (!line && t - holdTry.at >= 1) { holdTry.at = t; viewSwitch?.say?.('Anchor’s holding.', { kind: 'sea.holding' }); seaUi?.armVoice?.('holding'); }
    }
    if (line) { viewSwitch?.say?.(line, { kind: status.kind ?? 'status' }); statusNow = { text: line, at: t }; }   // 'reply': the reef set with the sails down   // status: a phone keeps it (it answers the player's own tap)
  }
  // the chart's grid needs the whole terrain: mounted when the stream is done (a capture: at once)
  const ui = {
    services, views, station, calm, hint, viewSwitch, captain, panel, throttle, tackBtn, proRecess, trimPanel, skills, words, pads, dayClock, keyLegend, proHud, voice, grounding, music, seaUi,
    get cockpitUp() { return ckUp; },   // ui/cockpitUp.js: the performance stats panel's rule (main.js), the Pro instruments panel's (ui/proHud.js)
    get chart() { return chart; }, get course() { return sailCourse; }, get assist() { return assist; }, get status() { return statusNow; }, chartEsc: () => !!chart?.chart?.toggle?.pinned,   // U8: the card's Esc waits while the enlarged chart is pinned (the card listens in the capture phase, the chart's own Esc unpins after it)
    mountChart, setLevel, setPro, get pro() { return pro; }, weather,
    get mode() { return mode; }, setMode(m) { mode = m === 'cruise' ? 'cruise' : 'sail'; if (mode === 'cruise') { assist?.cancel(); B.station({ free: null }); } H.dataset.lkPlay = mode; /* data-lk-play: Cruise's autopilot sails, so the Tack pill stands down (tackButton.js CSS; owner 2026-11-15) */ services.provide('modeOptions', { hud: 'calm' }); chart?.setMode(mode); if (mode === 'cruise' && sailCourse) { sailCourse.clear(); sailCourse.update(0); } },   // U15: Cruise has no practice marks (v1's Cruise chart has no course tool)   // v2/cruise
    // before the boat steps: the station's hands into the sim (B.station), the Tack pill's frame
    update(dt, hands = null) {
      t += dt;
      theme.update(dt);   // M5e: data-lk-theme=night under the sun's −1° (the station's night ink, the DOM's red set)
      // first in the frame, before any DOM write: the Calm HUD's hover tests read the bar's box (v1's calmHud.js), and a read on a
      // clean layout never forces one
      calm.update(Math.min(0.1, dt));
      dialModules?.update();
      // the cockpit up (ui/cockpitUp.js): the performance stats panel reads it (main.js), the Pro instruments panel (ui/proHud.js) and
      // the key legend follow it while a desktop cockpit sails (2026-11-25: folded, Clear, Instruments, Tessie take them; the helm view
      // keeps the panels, the legend's own rule takes it there). Cruise, a tablet and a phone (no drawn cockpit) keep their own rules
      ckUp = cockpitUp({ form: station?.form ?? null, stationShown: !!station?.shown, fold: !!calm.fold, preset: calm.mode, modeDials: showsDials(world.modeId?.() ?? homeId()), played: !!services.get('played')?.played });
      keyLegend.hidden = station?.form === 'cockpit' && sailing() && !ckUp;   // the key legend too (its own rules stay: key hints, the helm view)
      dayClock.step(dt);   // a time pick's fade and its cut, in every mode (Cruise's sheet picks too), before the frame draws
      if (!sailing()) { thumb?.update(dt, null); flat?.update(dt); keyLegend.update(); proHud?.update(dt); chart?.update(dt); return; }   // Cruise: the Calm HUD, the edges (they hide by mode), the chart
      thumb?.update(dt, hands);   // the upright phone's steer zone and rope into this frame's hands (before the boat's step)
      flat?.update(dt);   // a phone's flat controls: the arcs' helm and holds go in below
      const helmHeld = station?.steer != null || !!thumb?.steering || !!flat?.steering;
      // steady hands (ui/steadyHands.js): the let-go heading hold as the profile, its choice and Pro say; AUTO keeps its own while on,
      // a race its aids
      if (!world.race?.() && !pilot?.engaged) { const sh = steadyOn({ profile: settings?.get?.('profile') ?? 'new', pro, choice: steadyChoice(), url: steadyUrl(flags) }); if (!!B.assists.pilot !== sh) B.setPilot(sh); }
      tackBtn?.update(dt, { handHeld: helmHeld });
      assist?.update(dt, { handHeld: helmHeld || !!hands?.steer, input: helmHeld || !!hands?.steer || !!hands?.pull });   // FREE's hands; a hand on the helm or a steering key cancels it
      if (assist) B.station({ free: assist.hands });
      if (flat?.on) B.station({ helm: flat.helm, ext: pads.ext.on ? pads.ext.steer : null, main: flat.take('main'), jib: flat.take('jib'), mainHold: 0, jibHold: 0, fly: { main: false, jib: false } });   // the rings' drags and taps (rad, + = in)
      else if (station) B.station({ helm: station.steer, ext: pads.ext.on ? pads.ext.steer : null, main: station.take('main'), jib: station.take('jib'), mainHold: station.hold('main'), jibHold: station.hold('jib'), fly: { main: station.takeFly('main'), jib: station.takeFly('jib') } });
      trimPanel.update(dt); proRecess?.update(dt);
      B.gennakerCrew = { mode: settings?.get?.('gennaker') ?? 'auto', race: !!world.race?.() };   // round 2: Setup › Aids › Gennaker, no flight in a race
      const s = phys.state;
      // DRV-9, U13: the skill model sees the player's own hands, as v1's: the keys and fingers (main.js reads them before this
      // frame's UI), the wheel in the hand, the winches; and the gusts around the boat at 4 Hz (here and 150 m out either bow)
      const hSteer = hands?.steer ?? 0, hPull = hands?.pull ?? 0;
      const skSteer = hSteer ? Math.sign(hSteer) : station?.steer != null ? Math.sign(station.steer) : flat?.helm != null ? Math.sign(flat.helm) : 0;
      const skPull = Math.max(-1, Math.min(1, hPull + (station ? station.hold('main') : 0)));
      if (hSteer || hPull) used();
      if (t - gustAt >= 0.25) { gustAt = t; gust = sampleGust(); }
      skills.update(dt, { twa: s.trueWind.angle, tws: s.trueWind.speed, awa: s.apparentWind.angle, sog: s.sog, heading: s.heading, heel: s.heel,
        mainFill: s.mainFill, mainStall: s.mainStall, boomAngle: s.boomAngle, surf: s.surf, roundUp: s.roundUp, groove: s.groove,
        level: windField?.level ?? null, steer: skSteer, pull: skPull, crew: B.hand.crew, gust, x: s.x, z: s.z });
      B.hand.netAfter = skills.netAfter;
      hint.keep?.(B.carryKeep ?? 0);   // DRV-5: the tack carry's keep-turning line
      hint.quiet?.(!!B.fly?.any);      // the skill hints wait while a sheet flies (v1's letFlyOut)
      hint.update(dt);
      viewSwitch.update(dt);
      dayClock.update(dt);   // v1's night-sky line in the bar
      keyLegend.update();    // v1's shell.js: each frame (it writes the DOM only when its lines change)
      if (navPulseWait && !dashHidden()) { navPulseWait = false; apHead?.pulse?.(); flat?.pulse?.(); }   // NAV's one calm pulse once the cockpit is in view
      proHud?.update(dt);
      captain?.update(dt, { sinceUse: t - lastUse, hands: B.hand.crew ? 'crew' : null, trend: null, nogo: false, cue: hint.current === 'pull' || hint.current === 'ease' ? 'sails' : null });
      pageWatch();   // the chart page and the logbook: one at a time
      chart?.update(dt);
      wakeStore?.sample(phys.state.x, phys.state.z);   // your wake (a point each 12 m; ?mapux=0 none)
      sailCourse?.update(dt);   // U15: the tracker, the marks' props
    },
    // after the boat stepped: the station draws the boat's own rudder and sheets, the panel its lit states
    after(dt, hands = null) {
      if (!sailing()) { station?.update(dt); panel?.update(dt); thrWord?.update(dt); apHead?.update(); return; }   // Cruise: the station and its panel fade out (dashHidden), no hands
      if (station) { station.trim('main', hands?.pull ?? 0); station.trim('jib', 0); }
      station?.update(dt); panel?.update(dt); thrWord?.update(dt); apHead?.update();
      if (!apHead) pilot?.update();   // the phone's Auto: the same pilot rules each frame (the desktop's pad runs them in its update)
      sayStatus();
    },
    camera(dt, follow) { return views.pose(dt, follow, B.pose, B.helmLook); },
  };
  const theme = createTheme({ sunElev: sun, setting: settings?.get('display') ?? 'auto', largeText: !!settings?.get('largeText') });   // Setup's display and text rows (v2/ui/setup.js)
  ui.theme = theme;
  if (cockpit) cockpit.ready.then((r) => { if (r) { try { mountStation(r); } catch (e) { console.error(e); } } });
  else if (feature('flatControls').on) { try { mountFlat(); } catch (e) { console.error(e); } }
  return ui;
}

