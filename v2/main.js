// Velia v2, M3: boot the engine, build every pipeline (compute and render), bake the sky's two fixed LUTs, load the
// terrain's first grids (≈ 1.4 MB), then run the frame: the boat's shadow map → the water's FFT (compute) → the sky-view
// LUT → the aerial perspective's froxels → the scene (the terrain and the lake bed through the water, the boat, then the
// water surface blended over both, then the sky where nothing is) → tonemap. The rest of the terrain streams after the
// first frame: a worker decodes, the frame uploads a slice. Order (Cold Smoke's staged start): flags → device → targets →
// pipelines (async, all) → the sky bake → the terrain's first stage → first frame → seal the registry → ready → stream.
// M3: the sloop (v1's physics on src/sim, v2/sim/boat.js) floats on the readback surface and sails on the shared wind
// (the WindField over v2's terrain heights); the follow camera is the page's unless ?cam= or ?campos= pins a viewpoint.
import { parseV2Flags, sceneParams } from './engine/flags.js';
import { createDevice, showNoGpu } from './engine/device.js';
import { track, sessionProps, displayOf } from './ui/metrics.js';
import { createSailClock } from './ui/engagement.js';   // v1's play counts (started in start.js): session_start, mode_change, gpu_lost, load_fail
import { LEVELS, LEVER_ROWS, LEVER_OFF, leverRows, pinnedLevel, readSignals, guessLevel, gpuKey, readStored, writeStored, startLevel, levelParams, levelCaps, cloudPixels, forestAt, pendingRows, createLadder, createRaceLadder, createBusyProbe, createMsaaSwitch, msaaOf } from './engine/quality.js';   // the phone pass: the quality ladder
import { createDiag, createCrashLog } from './engine/diag.js';
import { createSweep } from './engine/sweep.js';   // perf(v2) phone: ?diag=2, the sweep on the phone itself   // the phone pass: ?diag=1, the panel for phone screenshots
import { FOREST } from './forest/lod.js';
import { createCanvasSizer } from './engine/canvas.js';
import { createSimClock, sailSchedule } from './engine/clock.js';
import { DEFAULT_TIMERATE } from '../src/sim/timeOfDay.js';
import { createFrameUniforms } from './engine/uniforms.js';
import { createPipelineRegistry, createReleaseQueue } from './engine/pipelines.js';
import { createFrameGraph } from './engine/frame.js';
import { createGovernor, createRefreshProbe, idleBudget, GOV_WORK, frameBudget } from './engine/governor.js';
import { createPacer } from './engine/pacer.js';   // perf(v2) phone 30 fps: the frame limiter
import { createHook } from './engine/hook.js';
import { cameraPose } from './engine/camera.js';
import { exposureFactor, setLook, waterKeep, stormExposure } from './sim/exposure.js';
import { gradeLutData, gradeStrength, skyStrength, skyMatchStrength, GRADE } from './render/grade.js';   // fix(v2) frame look: v1's camera
import { mat4, perspectiveReversed, lookDir, multiply, invert, DEG } from './engine/math.js';
import { createSun } from './sim/sun.js';
import { windFor, travelRadOf, sailWindOptions, sailShiftProfile, relayGust } from './sim/wind.js';
import { resolveStart, listBirthplaces, birthPose, createBirthplaces, BIRTH } from './sim/birthplace.js';   // the birthplaces (73): where a sail starts, a reach off the live wind
import { DEFAULT_WIND_LEVEL } from '../src/sim/wind.js';
import { HEAD, FULLSCREEN, TONEMAP, TONEMAP_MODES, tonemapMode } from './render/shaders.js';
import { createPost, BLOOM, DITHER_LSB, bloomGain } from './render/bloom.js';   // the post chain (2026-11-18): the bloom's own pass, the composite's dither
import { createSky, SUN, nightFloor } from './render/sky.js';
import { createWater, LOOP } from './render/water.js';
import { createShore } from './render/shore.js';   // #56 M3: the breakers, the swash, the spray (Ultra-Water's shore, MIT)
import { createTerrain } from './render/terrain.js';
import { UNDER_STATE } from './render/underState.js';   // play as Tessie, phase 2a: the eye under the water
import { createUnderBack, LENS } from './render/underBack.js';
import { createUnderLight, createBubblePool, createBubbleEmitter, shaftStrength } from './render/underLight.js';   // phase 2b: the shafts, the specks, the bubbles
import { createCaustics } from './render/caustics.js';
import { createBoat } from './render/boat.js';
import { createForest } from './render/forest.js';
import { createClouds } from './render/clouds.js';
import { createTerrainShadow } from './render/shadow.js';   // M5c: the terrain's sun shadow
import { createGround } from './render/ground.js';          // M5c: the ground photo tiles and the detail set
import { createRocks, BED_REGION } from './render/rocks.js';            // M5c: the shore and island boulders;: the bed's stones by region
import { createNight } from './render/night.js';            // M5e: the stars, the Milky Way, the town and nav lights
import { nightLevels, NIGHT, nightLoadDue, nightCover, purkinjeAmount, purkinjeScale } from './sim/night.js';
// M5e: v1's thunderstorm on v2's frame (sim/storm.js), its rain and bolts (render/storm.js) and v1's thunder (src/weather/stormAudio.js):
// one chunk, fetched only where the registry's storm row is on (owner 2026-11-18: none on a phone; sim/stormOff.js stands in there)
import { createStormOff } from './sim/stormOff.js';
import { stormSea } from './sim/stormSea.js';   // storm round 2: the storm's sea (the cheat on its wind and fetch)
import { createAudio } from './engine/audio.js';
import { createGust } from './sim/gust.js';
import { createWindTex, windTexLive } from './sim/windTex.js';   // audit W1–W3: v1's wind texture for the water (the gusts, the caps' and the lanes' local wind)
import { BITS as WIND_BITS, createWindBlend } from './render/windWater.js';   // audit W4: v1's gust payoff (src/gustFx.js): the sail-fill snap, the rush, the camera's lean
import { createBedsLive } from './audio/bedsLive.js';   // step 3: the sound beds (hybrid: the wind in code; hull, water, sails, rain: v1's recordings; v2/audio/)
import { createReefStore } from './ui/autoReef.js';
import { pageSettings } from './ui/settingsStore.js';   // step 3: v1's sound and effects switches
import { createMusic, createLateCore } from './audio/music.js';   // music: v1's pieces, the groove, the bar's Music, Cruise's playlist (v2/audio/music.js)
import { arriveOnEntry } from '../src/audio.js';   // music: the gesture that enters Sail cues a piece (v1's daysail)
import { setStreamMusic } from '../src/audioFormat.js';   // music: every piece streams (no decoded PCM)
import { visitSeed } from '../src/visitSeed.js';   // music: a seed per visit for the pieces' order (v1's)
import { weatherMenu } from '../src/sim/weather/weatherMenu.js';
import { createWeatherWind } from './sim/weatherWind.js';   // the one wind every weather effect reads (the rain, the clouds' drift, the gulls' calls)
import { createWeatherLook, createLensWater, fillLookRecord } from './sim/weatherLook.js';   // a look per weather; the lens's water
import { createWeatherLookBuffer } from './render/weatherLook.js';
import { createBoatSim, waterFor, START, FOLLOW, DESK_TRIM } from './sim/boat.js';
import { keysToAxes, keysToTrim, sumHands, isPortrait, CODES, HELD_CODES } from './sim/controls.js';
import { createModeSwitch, proWanted } from './ui/modeSwitch.js';
import { bootMode, modeRow, modePipes, isRace, knockOf, homeId } from './engine/modes.js';   // the mode table (refactor round 3 C1)   // the mode switch's rules (Sail | Cruise | Regatta; ` )
import { createTouch, TOUCH_CSS } from './ui/touch.js';
import { profile } from '../src/core/profile.js';   // the device profile: input, form, screen, gpu, quirks (the only reader of device facts)
import { createStageDirector } from './stage/director.js';   // the opening stage and the showcase list: one director for every act
import { areaOf, distToArea } from './stage/areas.js';   // the stage's named areas (an act's nearby row: Tessie by her water)
import { stageOptions } from './stage/options.js';   // ?stage= and ?tessie=<s> (the opening's Tessie at that play time; a capture's pin)
import { features, feature } from '../src/core/features.js';   // (the phone's build gate below: engine/buildGate.js)
import { buildGate, PHONE_ORDER } from './engine/buildGate.js';   // owner 2026-11-17: a phone builds every pipeline, then presents the modes   // the feature registry: each device-dependent feature's policy, once
import { RETRY_SLOW_MS } from './engine/quality.js';
import { shotPose } from './sim/shots.js';
import { WindField } from '../src/sim/wind.js';
import { streamPlan, pickVariant } from './terrain/levels.js';
import { LENGTHS, SEA, fetchAt } from './sim/spectrum.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
import { pickDay, dayChoice } from '../src/sim/day.js';
import { CANVAS_VARIANTS, canvasVariant } from '../src/sim/boat/canvasHex.js';
import { DEFAULT_DIMS } from '../src/sim/boat/dims.js';
import { createM4 } from './ui/m4.js';   // M4: the views, Sail's UI and the cockpit (v2/ui/m4.js)
import { createCockpit } from './render/cockpit.js';
import { createPluginList, fetchChunks } from './engine/plugins.js';
import { createPlayer } from './engine/player.js';   // refactor round 3 C3: the played seam (the boat, or a played thing: Tessie)   // refactor round 3 C2: the plug-in list (one contract, one runner)
import { LAKE_PLUGINS, ORDER as PLUGIN_ORDER } from './living/lakePlugins.js';   // the living lake's plug-ins and their order per anchor
// Tessie (M1): v2/living/tessie.js is a dynamic import, only where feature('tessie').on (desktop; src/core/features.js)
// birds: render/birds.js (v1's flock), sim/birds.js (the storm's shelter), engine/birdAudio.js (their sound door) and src/birds/sound.js
// (v1's calls) are dynamic imports, only where feature('birds').on (not on a phone)
// the July 4th show: living/fireworksPlugin.js is a dynamic import (living/lakePlugins.js FIREWORKS fetch), only where feature('fireworks').on (not on a phone)
import { createWakeFx } from './render/wake.js';   // the wake plug-in (below)
import { feelQ, leeFoam } from './sim/speedFeel.js';   // the speed feel's lee foam and the level's share (owner, 2026-11-17)
import { kdMix, kdRoll, KD_Q, KD_LIFT } from './sim/knockdownFx.js';
import { createKnockdownGame } from './sim/knockdownGame.js';   // K3: the game end's timeline (the warning, the slow, the card, Start again)   // K2: the knockdown's look: the water's hull mask, the spray's share
import { stageOf } from './ui/frontPlan.js';   // the front door: the loading stages
import { createTowns, createShoreMirrorTarget } from './render/towns.js';   // 10a: the piers, the harbour, the ski runs and the Hwy 89 cut (render/towns.js)
import { createLandmarks } from './render/landmarks.js';   // G1, G2: v1's ruin, stone house and waterfall, and its five shore flags (render/landmarks.js)
import { createSeamanship, piersOf, hullToWorld } from './sim/seamanship.js';
import { createIntro, ndcYMax, bandShare } from './ui/cinematicIntro.js';   // the cinematic intro (owner, 2026-11-18): the first Sail or Cruise of a page load, desktop only
import CHANNEL_MARKS from './sim/channelMarks.json';   // channel markers (BACKLOG): the waters' aids to navigation, each row's public source
import { resolveMarks, createMarkBodies, markPose, markLights, AID_KIND, AID_RGBA } from './sim/channelMarks.js';
import { CHANNEL } from './terrain/channel.js';
import { createNavAids } from './render/navAids.js';
import { lonLatToWorld } from '../src/sim/geo.js';
import MOORINGS from './sim/moorings.json';   // the anchorage cues: the Boat Camp's mooring balls
import { resolveMoorings, MOOR_V2 } from './sim/moorings.js';
import { REGIONS, activeRegions, regionsWithBirthplaces } from './living/busyLake.js';   // the busy lake: cruising sailboats and the regions' kayakers (src/core/features.js busyLake, regionKayaks)
import { clearZones, createStoneRegion } from './sim/bedBoulders.js';   // feat/v2-boulders-3d: the zones the bed's 3D stones keep clear
import { ANCHORED_BOATS } from './sim/anchoredBoats.js';   // boats at anchor in the bay (desktop and tablet: src/core/features.js anchoredBoats)
import { segAt as tourSegAt } from './sim/tourBoat.js';   // the hunts: the glass boat out on her open-lake segments
import { createHunts } from './regatta/hunts.js';   // the cups' hunts: Chart the Bay, Chart the Mouth
import { hasFrom } from './sim/racePlaces.js';   // the place races' device needs (the hub, the chart's pins)   // the glass boat, "Velia Travel", and her clear kayaks (desktop and tablet: src/core/features.js glassBoat)
import ANCHORAGES from './sim/anchorages.json';   // the anchor seen (2026-11-17): the chart's anchorages (tools/v2-anchorage-bake.mjs)
import { createAnchorSplash } from './render/anchorSplash.js';
import { createAnchorGear } from './render/anchorGear.js';   // the ground tackle seen close (desktop and tablet: src/core/features.js anchorDetail)   // the anchor seen: the splash at the bow, the drips on the way up
import { createAnchorSound } from './audio/anchorSound.js';   // the anchor seen: the clunk, the chain's rattle, the splash   // #8, #14: the engine and the ground tackle (v1's seamanship, its pure half)
import { createExhaustFx } from './render/exhaust.js';             // #14: the wet exhaust's clots
import { createEngineSound } from './audio/engine.js';             // #14, #8: v1's engine and chain sound on the beds' boat bus
import { CRUISE_HOUR, cruiseWind, cruiseSchedule } from './cruise/plan.js';   // Cruise (BACKLOG-v2 #11): the page facts; the mode is its own chunk (cruise/index.js)
import { RACE } from './regatta/plan.js';   // Regatta (BACKLOG-v2 #12): the page facts; the mode is its own chunk (regatta/index.js)
// Regatta's on-water lines and props (render/raceLines.js, raceProps.js: the committee boat, the pin, the marks, the computer boats):
// dynamic imports, when a race or Sail's practice marks first ask (raceKit below)
import { createBeaconFx } from './render/waymark.js';   // the target beacon (files named waymark: ad blockers block "/beacon.js", ERR_BLOCKED_BY_CLIENT, 2026-11-15; owner 2026-11-15: the light pillar; ?beacon=0 off): one pipeline at load, one draw while a mark is in force
import { createBeacon, targetOf, draftTarget, createLatest } from './sim/waymark.js';
import { createSailMark, waterUnder } from './ui/sailMark.js';   // Sail's double-tap mark (owner 2026-11-15): lights the beacon, no autopilot
import { lmStart, lmEnd, lmPoint, lmFact, lmSpan, lmHas } from './engine/loadMarks.js';   // the load report's marks (ui/loadReportDoor.js; ?loadreport=1 shows them)
import { markCardLive } from './ui/loadReportDoor.js';
import { reducedNow } from './sim/steadyCamera.js';   // Reduce Motion: the one accessibility signal
import { createMenuDrift } from './ui/menuDrift.js';   // step D1: the Menu card's camera drift over the live lake

lmEnd('main');   // the engine's chunk and its imports are fetched and run (start.js began the span)
const errors = [];
const hook = createHook({ errors });
window.__velia = hook;
const t0 = performance.now();
// perf(v2) iOS pipelines: the deferred groups in the order they are built after the first frame (the boat's models first:
// the hero; then what the opening view shows; then what waits for a time, a weather or a mode); PIPE_SLOW_MS, the first
// frame's set slower than this marks a slow compiler (engine/pipelines.js); PIPE_STORE, the last load's build time
const PIPE_ORDER = ['boatModels', 'boatDetail', 'post', 'forest', 'rocks', 'water-alt', 'towns', 'ground', 'kayaks', 'tessie', 'under', 'boatfx', 'shore', 'probes', 'birds', 'night', 'storm', ...modePipes(), 'fireworks', 'sweep'];   // modePipes(): each mode's own groups (engine/modes.js)
const CRUISE = modeRow('cruise'), REGATTA = modeRow('regatta');   // the two chunk modes this page loads (cruiseLoad, regattaLoad)
const RACE_PIPE = REGATTA.pipes[0];   // the race's pipeline group (the props, lines and fleet: built behind the card)
const PIPE_SLOW_MS = 1500;
const PIPE_STORE = 'velia.v2.pipes';
const PIPE_WAIT_MS = 6000;   // a slow compiler's groups start at the card's hand-over, or this long after the first frame
const CK_FIRST_MS = 3000;   // perf/v2-phone-load: the longest the after-first-frame streams wait for the cockpit's asset (from its fetch)
// the phone pass: every uncaught error and rejection goes to the errors list (the diag panel, the crash log)
addEventListener('error', (e) => { errors.push(`page error: ${e.message ?? e.error ?? e}${e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno})` : ''}`); });
addEventListener('unhandledrejection', (e) => { errors.push(`unhandled: ${e.reason?.message ?? e.reason}`); });

// perf(v2) phone round 2: the display's refresh measured while the page loads (light frames: nothing drawn yet), so a
// GPU-bound first minute whose frames each miss a vsync (33.3 ms intervals on a 60 Hz phone) is not read as a 30 Hz display
const idleDts = [];
let idleStop = false;
{ let last = null; const step = (t) => { if (last != null) idleDts.push(t - last); last = t; if (!idleStop && idleDts.length < 240) requestAnimationFrame(step); }; requestAnimationFrame(step); }

async function boot() {
  const flags = parseV2Flags(location.search);
  features.configure({ headless: flags.headless != null, flags });   // the registry reads the page's flags (its aliases) and knows a capture
  // fix(v2) frame look: v1's camera by default (AgX, v1's noon LUT and sky polariser, v1's day exposure); ?look=v2 the M2 camera;
  // v1's ?grade=0 | lut | sky (src/core/grade.js gradeMode) drops the LUT, the polariser or both
  const look = setLook(flags.look);
  const gradeLut = look === 'v1' && flags.grade !== '0' && flags.grade !== 'sky', gradeSky = look === 'v1' && flags.grade !== '0' && flags.grade !== 'lut';
  // --- the front door: the loading stages (no staged first minute in v2, owner 2026-11-13: a first visit boots as any other) ---
  let diagStage = 'starting';   // perf(v2) phone: the panel's loading line
  const loadStage = (step) => { diagStage = step; window.__veliaLoading?.stage?.(stageOf(step)); };   // v1's loading bar and captions (v2/ui/loading.js)
  // --- end front door ---
  let P = sceneParams(flags);
  const canvas = document.getElementById('c');
  if (P.headless) document.body.classList.add('headless');   // the dev label hidden in captures (the goldens hold the scene, not the label)
  // --- the phone pass: the diag panel first (it shows a failed start too), then the device, then the quality level ---
  const storage = (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
  // the crash log: a note kept while the page runs, closed on pagehide; a reload after an iOS kill finds it still alive
  let gpuRef = null, levelRef = null;
  const crash = P.headless ? null : createCrashLog({ storage, errors, snapshot: () => ({ level: levelRef, mb: gpuRef?.mem?.mb ?? null, frames: hook.frames }) });
  if (crash) { addEventListener('pagehide', () => crash.close()); setInterval(() => crash.beat(true), 5000); }
  const memNow = () => { const pm = performance.memory; return { gpuMB: gpuRef?.mem?.mb ?? 0, buffers: gpuRef?.mem?.nBuffers ?? 0, textures: gpuRef?.mem?.nTextures ?? 0,
    heapMB: pm ? pm.usedJSHeapSize / 1048576 : null, heapLimitMB: pm ? pm.jsHeapSizeLimit / 1048576 : null, deviceGB: navigator.deviceMemory ?? null }; };
  const diag = createDiag({ on: flags.diag != null && flags.diag !== '0', errors, info: () => ({ stage: diagStage, crash: crash?.line(), ua: navigator.userAgent, dpr: devicePixelRatio, css: [canvas.clientWidth, canvas.clientHeight] }) });   // perf(v2) phone: no level, backing or cap until they exist (was "Lundefined", the canvas's default 300×150, "cap undefined")
  hook.diag = diag;
  lmStart('device');
  const gpu = await createDevice({ canvas, timing: P.timing, errors, onLost: (info) => { if (!hook.ready) showError(`device lost at load: ${info?.message ?? info?.reason ?? ''}`); else track('gpu_lost', { reason: info?.reason ?? info?.message ?? 'lost', backend: 'webgpu' }); } });   // the phone pass: a device lost before the first frame shows the card
  if (!gpu) { diag.setInfo(() => ({ why: 'no WebGPU: the card links the current Velia', crash: crash?.line(), ua: navigator.userAgent, dpr: devicePixelRatio })); window.__veliaLoading?.dispose?.(); return; }   // the plain card is up (v2's own: it links the WebGL Velia); the loading card steps aside
  gpuRef = gpu;
  lmEnd('device'); lmFact('gpu', gpu.info);
  const signals = readSignals({ adapterInfo: gpu.info, fallback: gpu.info.fallback, ua: navigator.userAgent, platform: navigator.platform ?? '', touch: navigator.maxTouchPoints ?? 0,
    deviceMemory: navigator.deviceMemory ?? null, form: profile.get().form, screen: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 } });   // the device profile's form (src/core/profile.js)
  const qKey = gpuKey(signals);
  const desk = !signals.phone && !signals.tablet;   // fix(v2) desktop quality: a desk page's budget is held at 60 fps (engine/governor.js frameBudget)
  const deskCaps = desk && !P.headless;   // and its L0 draws up to DESK_MAXPX (engine/quality.js levelCaps); never in a capture (the goldens)
  const capsOpts = { desk: deskCaps, mobile: !desk && !P.headless };   // perf(v2) phone 30 fps: a live phone's L2 and L3 draw more pixels (MOBILE30_CAPS)
  const qSetup = P.headless || (flags.quality ?? profile.forced().gpu) != null ? null : pinnedLevel(pageSettings().get('quality'));   // Setup's quality row, saved (high L0, balanced L1, low L2; auto: the ladder); the URL wins, as v1's flags
  // perf(v2) iOS pipelines: the last load's pipeline build on this GPU (a slow compiler is not sent on a retry)
  const lastBuildMs = (() => { try { const o = JSON.parse(storage?.getItem?.(PIPE_STORE) ?? 'null'); return o?.gpu === qKey && Number.isFinite(o.ms) ? o.ms : null; } catch { return null; } })();
  profile.setQuirk('slow-compiler', lastBuildMs > RETRY_SLOW_MS);   // the device profile's slow-compiler quirk (iPhone WebKit: one pipeline at a time)
  const qStart0 = startLevel({ pinned: pinnedLevel(flags.quality ?? profile.forced().gpu), headless: P.headless, stored: P.headless ? null : readStored(storage, qKey), guess: guessLevel(signals), lastBuildMs, slowCompiler: !feature('levelRetry').on });
  const qStart = qSetup != null ? { level: qSetup, source: 'setup', why: `Setup: quality held at L${qSetup}` } : qStart0;
  const qExplicit = new Set(new URLSearchParams(location.search).keys());
  P = Object.freeze(levelParams(P, qStart.level, qExplicit, capsOpts));
  levelRef = qStart.level;
  // --- Cruise: a page opened in Cruise (?mode=cruise) starts at v1 Cruise's hour (17:54) unless ?hour names one ---
  const bootId = bootMode(flags);   // the mode the URL opens in (engine/modes.js: ?mode= or an alias; else Sail)
  const cruiseBoot = bootId === CRUISE.id;
  if (cruiseBoot && (flags.hour == null || flags.hour === '')) P = Object.freeze({ ...P, hour: CRUISE_HOUR });
  // --- end Cruise ---
  const raceBoot = isRace(bootId);   // Regatta: ?mode=regatta opens the page in the race's box at v1's 15:00 unless ?hour names one
  if (raceBoot && (flags.hour == null || flags.hour === '')) P = Object.freeze({ ...P, hour: RACE.hour });
  // Cruise's and Regatta's sessions (their sections below fill them): declared here, before the passes, the stage director, Tessie
  // and the fireworks read them (race(), cruise(), !cruise?.on). Declared at their own sections, a stage step that ran before those
  // lines threw a TDZ ReferenceError on the built page (a phone's reload with a saved profile hung on the loading screen, 2026-11-18)
  let cruise = null, cruiseP = null, streamDone = null, navSailTg = null, autoNavP = null;
  let regatta = null, regattaP = null;
  const Q = { level: qStart.level, built: qStart.level, source: qStart.source, startWhy: qStart.why, why: qStart.why, pending: [], steps: [] };
  profile.setGpu(Q.level);   // the device profile's gpu axis follows the ladder (applyLevel below: every step, the race's too)
  lmFact('quality', { level: Q.level, name: LEVELS[Q.level]?.name ?? '', source: Q.source ?? '' });
  // Tessie: the registry row (a desktop at L0-L2, never in a capture unless the URL asks), read once the gpu axis is set; her chunk
  // is fetched now, in parallel with the load, and only where she is on (a phone downloads none of her code)
  const tessieOn = feature('tessie').on;
  // play as Tessie, phase 2a: the eye under the water; its pipelines are declared only where the row is on (full L0-L1, lite L2)
  const underTier = feature('tessieUnder').tier, underOn = underTier !== 'none';
  UNDER_STATE.tier = underTier;
  const tessieModP = tessieOn ? import('./living/tessie.js') : null;
  // the phone is for the sail sim (owner, 2026-11-17): the fireworks' chunk only where its row is on (a phone fetches none
  // of its code, sounds or data and builds none of its pipelines), the Milky Way's maps and the rainbow likewise. fetchChunks: the
  // plug-in rows that fetch their own chunk early (living/lakePlugins.js FIREWORKS), made later by the list
  const milkyWayOn = feature('milkyWay').on, rainbowOn = feature('rainbow').on;
  const chunks = fetchChunks(LAKE_PLUGINS, feature);
  // owner, 2026-11-18 ("Remove storm from phone"): the storm's chunk only where its row is on; a phone fetches none of it, builds
  // none of its pipelines (the rain, the bolt, the storm and bow composites) and loads no rain sound; its weather stays fair
  const stormOn = feature('storm').on;
  const stormModP = stormOn ? Promise.all([import('./sim/storm.js'), import('./render/storm.js'), import('../src/weather/stormAudio.js')]) : null;
  loadStage('device');
  const { device, context, format } = gpu;
  context.configure({ device, format, alphaMode: 'opaque' });
  lmStart('world');   // the world's objects and every pipeline declared (main thread), up to the pipelines' build

  // the terrain's manifests (v1's, unchanged) fetched while the device warms up
  const tBase = new URL(`${CURRENT_WATERS.terrain.dir}/`, document.baseURI);
  lmStart('manifests');
  const manifestsP = Promise.all([CURRENT_WATERS.terrain.full, CURRENT_WATERS.terrain.phone].map(async (f) => { const r = await fetch(new URL(f, tBase)); if (!r.ok) throw new Error(`terrain manifest ${f}: ${r.status}`); const t = await r.text(); return [JSON.parse(t), t.length]; }));

  manifestsP.then(() => lmEnd('manifests'), () => {});
  // --- the scene's shared state ---
  const sun = createSun();
  // the day clock (engine/clock.js, engine/flags.js clockParams): v1's Sail schedule on a live page with no ?hour (18:45, slow golden
  // hours, no quick night in Sail (engine/clock.js sailSchedule): DEFAULT_TIMERATE game s per sim s by day, 1 game hour per 3 real minutes at the 2 × game speed); a constant
  // rate under ?timerate (or ?clock=flat) and a headless film's ?filmrate; ?hour sets the start (v1); frozen in every capture,
  // ?timerate=0 and a ?filmui=1 film with ?hour
  const clock = createSimClock({ step: 1 / 120, t0: P.t0, hour0: P.hour, timerate: P.timerate, maxSteps: Math.ceil(10 * P.speed),   // the stall cap in real time at v1's game speed
    schedule: P.clockMode === 'day' ? (cruiseBoot ? cruiseSchedule(flags) : sailSchedule())
      : cruiseBoot && P.clockMode === 'rate' && (flags.timerate == null || flags.timerate === '') ? cruiseSchedule(flags) : null });   // Cruise: v1's own day clock (base 20 at 1 ×; ?clock=flat its quick night)
  hook.clock = clock;   // the page's clock for the harness and the tools (its API: engine/clock.js)
  const U = createFrameUniforms();
  const ubuf = device.createBuffer({ label: 'frame-uniforms', size: U.layout.stride * (U.slots + 1), usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });   // + 1: play as Tessie's split, the other side's copy of the block (its eye on that side of the surface)
  const SPLIT_OFF = U.layout.stride * U.slots, splitBlock = new Float32Array(U.layout.stride / 4);
  const ALL = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT | GPUShaderStage.COMPUTE;
  const frameBGL = device.createBindGroupLayout({ label: 'frame', entries: [{ binding: 0, visibility: ALL, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: U.layout.bytes } }] });
  const frameBG = device.createBindGroup({ layout: frameBGL, entries: [{ binding: 0, resource: { buffer: ubuf, size: U.layout.stride } }] });
  // BACKLOG-v2 #31, MSAA live: the sample counts this page may draw the scene at (the levels' 4 and 1), each count's scene
  // pipelines declared at load; the start count built at load, the other in the background after the first frame (below).
  // A capture (the goldens) and a URL ?msaa= keep one count
  const msaaCounts = P.headless || qExplicit.has('msaa') ? [P.msaa] : [...new Set([P.msaa, ...LEVELS.map((l) => l.msaa)])];
  const hdrBGLs = new Map(msaaCounts.map((n) => [n, device.createBindGroupLayout({ label: `hdr@${n}x`, entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', multisampled: n > 1 } }] })]));   // M5e: the scene's depth for the storm's grade
  // fix(v2) frame look: v1's noon grade as a 17³ 3D texture (render/grade.js gradeLutData: computed here, ≈ 1 ms, no fetch), group 2 of the composite
  const lutTex = device.createTexture({ label: 'grade-lut', size: [GRADE.size, GRADE.size, GRADE.size], dimension: '3d', format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
  device.queue.writeTexture({ texture: lutTex }, gradeLutData(), { bytesPerRow: GRADE.size * 4, rowsPerImage: GRADE.size }, [GRADE.size, GRADE.size, GRADE.size]);
  // the post chain (2026-11-18, render/bloom.js): the bloom's mip 0 (binding 2) and the post uniform (binding 3) ride the same group
  const lutBGL = device.createBindGroupLayout({ label: 'grade-lut', entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '3d' } }, { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } }, { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } }] });   // the weather's look and the lens (render/weatherLook.js)
  const wlookBuf = createWeatherLookBuffer(device);
  const lutView = lutTex.createView({ dimension: '3d' }), lutSampler = device.createSampler({ label: 'grade-lut', magFilter: 'linear', minFilter: 'linear' });
  let lutBG = null;   // made with the post chain below, again on each target change (the bloom's texture is sized with the frame)
  const compositeLayouts = new Map(msaaCounts.map((n) => [n, device.createPipelineLayout({ bindGroupLayouts: [frameBGL, hdrBGLs.get(n), lutBGL] })]));
  // perf(v2) phone round 2: the plain and storm tonemaps bind the scene's colour alone (no depth: render/shaders.js TONEMAP)
  const hdrOnlyBGL = device.createBindGroupLayout({ label: 'hdr-only', entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
  const compositeLiteLayout = device.createPipelineLayout({ bindGroupLayouts: [frameBGL, hdrOnlyBGL, lutBGL] });

  // --- targets and passes ---
  const graph = createFrameGraph({ device, context, format, msaa: P.msaa, timestamps: gpu.hasTimestamps, errors });
  const sizer = createCanvasSizer(canvas, { dprCap: P.dprCap, maxPx: P.maxPx, fixed: P.fixed, pixelRatio: P.pixelRatio });
  let hdrBG = null, hdrOnlyBG = null;
  graph.onResize((t) => { hdrBG = device.createBindGroup({ layout: hdrBGLs.get(graph.msaa), entries: [{ binding: 0, resource: t.resolveView }, { binding: 1, resource: t.depthView }] }); hdrOnlyBG = device.createBindGroup({ layout: hdrOnlyBGL, entries: [{ binding: 0, resource: t.resolveView }] }); });

  // --- every pipeline, declared now, built async, none later ---
  // perf(v2) iOS pipelines: a live page builds the first frame's pipelines ('core': the sky, clouds, terrain, water, wake,
  // caustics, the boat's hull and sails, the beacon, the plain tonemap) before it; each plug-in drawn later (or only on its
  // evening, storm, race) is a group built after it, one pipeline at a time (PIPE_ORDER; engine/pipelines.js). A capture,
  // a ?filmui=1 film and ?pipes=all build everything before the first frame, as before
  const pipesDefer = feature('pipelineDeferral').on;   // src/core/features.js: every live page (?pipes=all, captures and films: all before)
  // owner, 2026-11-17 ("For phones, the best experience is to build the shaders, then present"): a phone builds every group
  // behind the home card (PHONE_ORDER, from the first frame on, never waiting for the hand-over), the modes light once the gate
  // opens (engine/buildGate.js), and the scene's sample count holds for the session (no other count's set is built in play)
  const buildFirst = feature('buildAllFirst').on;
  buildGate.configure({ on: buildFirst });
  // Regatta's props and lines (raceKit below): a page that declares them with the load fetches their chunk now, in parallel; a phone
  // too (the build-first rule: no pipeline in play, so they are built behind the card, in group 'regatta', before the modes light)
  const raceKitBoot = (raceBoot || !pipesDefer || buildFirst) && flags.boat !== false;
  const raceKitModP = raceKitBoot ? Promise.all([import('./render/raceLines.js'), import('./render/raceProps.js')]) : null;
  const reg = createPipelineRegistry(device, { errors, msaa: P.msaa, counts: msaaCounts, defer: pipesDefer, delayMs: flags.pipedelay > 0 ? flags.pipedelay : 0 });   // ?pipedelay=: an emulated slow compiler   // #31: the scene's pipelines per sample count
  const inGroup = (g, make) => { const prev = reg.group(g); try { return make(); } finally { reg.group(prev); } };
  // --- the post chain (owner, 2026-11-18; render/bloom.js): the bloom where src/core/features.js 'bloom' is on (3 pipelines, group
  // 'post'; none on a phone), the dither everywhere (?dither=0 off). ?bloom=0|1 and ?bloomk= (its strength, 1 the default) ---
  const bloomOn = feature('bloom').on;
  const post = createPost({ device, reg, on: bloomOn });
  const postState = { bloom: true, k: Number.isFinite(flags.bloomk) && flags.bloomk >= 0 ? flags.bloomk : 1, dither: flags.dither !== false, ramp: pipesDefer ? 0 : 1, threshold: BLOOM.threshold, knee: BLOOM.knee };
  const makeLutBG = () => device.createBindGroup({ layout: lutBGL, entries: [{ binding: 0, resource: lutView }, { binding: 1, resource: lutSampler }, { binding: 2, resource: post.view }, { binding: 3, resource: { buffer: post.buffer } }, { binding: 4, resource: { buffer: wlookBuf.buffer } }] });
  lutBG = makeLutBG();
  graph.onResize((t) => { post.resize(t); lutBG = makeLutBG(); });
  if (graph.targets.hdr) { post.resize(graph.targets); lutBG = makeLutBG(); }
  // --- end post chain ---
  const liteFirst = !!(leverRows(flags.levers)?.waterLite ?? LEVELS[Q.level].waterLite);   // the water the start level draws (the other is a group)
  const hdrTarget = { format: graph.hdrFormat };
  const depthFormat = graph.depthFormat;
  const frameStruct = U.wgsl();
  const day = pickDay(CURRENT_WATERS, dayChoice());
  const [[fullM, fullLen], [phoneM, phoneLen]] = await manifestsP;
  // M5a: the clouds (render/clouds.js): v1's deck marched into a panoramic key a band of rows a frame; the sky-read group
  // every scene shader binds carries its params and key, so the sky, the water's mirror and the terrain composite it
  const deckRow = (k, n) => (flags[k] != null && Number.isFinite(flags[k]) ? { [n]: flags[k] } : {});
  const cloudMode = feature('phoneClouds').tier;   // ?phoneclouds=full | off (a phone: off; src/core/features.js phoneClouds)
  const clouds = createClouds({ device, reg, frameBGL, frameBG, U, frameStruct, seed: P.seed, on: flags.clouds !== false, errors, mode: cloudMode,
    pixels: cloudPixels(Q.level, P.fixed ? P.fixed[0] * P.fixed[1] : Math.min(P.maxPx, innerWidth * innerHeight * Math.min(devicePixelRatio || 1, P.dprCap) ** 2)),   // the phone pass: L1 and L2 take the 1024 × 256 key
    deck: { ...deckRow('cloudcov', 'coverage'), ...deckRow('cloudtype', 'type'), ...deckRow('cloudbase', 'base'), ...deckRow('cloudthick', 'thickness') } });
  // M5e: the night (render/night.js): the Milky Way's maps and the night record (the sky draw's group 2, the water's
  // mirror), the stars, the towns' lights and the boat's nav lights; its data streams after the first frame
  const night = createNight({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa: P.msaa, depthFormat, errors, milkyWay: milkyWayOn });   //: no Milky Way on a phone
  let nightOn = flags.night !== false;
  let spumeOn = true;   // the spume (render/spume.js); hook.setSpume, the in-page A/B
  const sky = createSky({ device, reg, frameBGL, frameBG, U, frameStruct, fullscreen: FULLSCREEN, hdrTarget, msaa: P.msaa, depthFormat, clouds, night });
  const underBack = underOn ? createUnderBack({ device, reg, frameBGL, sky, frameStruct, hdrTarget, msaa: P.msaa, depthFormat, hdrFormat: graph.hdrFormat }) : null;   // phase 2a: the background under the water, the waterline's lens
  clouds.attach(sky); inGroup('night', () => night.attach(sky));   // perf(v2) iOS pipelines: the night's two draws are a group
  const terrain = createTerrain({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat, H: fullM.height, season: day.season,
    treeline: CURRENT_WATERS.treeline, surfaceY0: fullM.y0, errors, granite: feature('islandGranite').tier, bedBoulders: feature('bedBoulders').tier, rock: feature('rockDetail').tier, under: underOn });   // the bed's big boulders; Fannette's granite: the detailed rock on a desktop, the colours on a phone (src/core/features.js)
  // perf/v2-phone-load: the terrain's first stage (1.36 MB on a phone) asked for now, and one yield so the requests and its
  // worker leave before the world build below holds the main thread (requests made inside it went out only at its end)
  const variant = pickVariant(flags);
  const stages = streamPlan(fullM, phoneM, variant);
  lmStart('terrain1');   // the terrain's first stage: the page fetches, the worker decodes (ended when it is in)
  terrain.prefetch(stages[0], tBase);
  await new Promise((r) => setTimeout(r, 0));
  // --- wake plug-in (render/wake.js): the boat's Kelvin waves, foam trail and bow spray. The water reads its maps (and runs
  // their two dispatches at the end of its compute pass), the shared ride steps its track and the spray (createBoatSim),
  // the scene draws the spray after the sky. ?nowake=1 drops the wake (v1's row; the spray stays); v1's knobs ?wake_amp=
  // ?wake_rc= ?wake_r0= ?wake_bow= tune it ---
  // birds (made below): on a live page unless ?birds=0 (captures: only with ?birds=1); the osprey's dive (desktop only:
  // src/core/features.js ospreyDive; BACKLOG #24) takes the wake's creature map for its rings where Tessie is off (64²)
  //: no birds on a phone (the registry's birds row): none of their code, calls or pipelines there
  const birdsOn = feature('birds').on && (flags.birds != null ? flags.birds !== '0' : !P.headless && !globalThis.navigator?.webdriver);
  const birdsModP = birdsOn ? Promise.all([import('./render/birds.js'), import('./sim/birds.js'), import('./engine/birdAudio.js'), import('../src/birds/sound.js')]) : null;
  const ospreyDiveOn = feature('ospreyDive').on;
  const wakeKnob = (k) => (flags[k] != null && Number.isFinite(parseFloat(flags[k])) ? parseFloat(flags[k]) : undefined);
  const wakeFx = flags.boat !== false ? createWakeFx({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat, variant: pickVariant(flags),
    on: !flags.nowake, creature: tessieOn ? 128 : birdsOn && ospreyDiveOn ? 64 : 0, vessel: feature('glassBoat').tier === 'full' ? 192 : 0,   // the glass boat's wake map (render/vesselWake.js)
    length: DEFAULT_DIMS.HULL.lwl, beam: DEFAULT_DIMS.HULL.beam, knobs: { amp: wakeKnob('wake_amp'), rc: wakeKnob('wake_rc'), r0: wakeKnob('wake_r0'), bowGain: wakeKnob('wake_bow') } }) : null;
  hook.wake = wakeFx;
  // the speed feel (sim/speedFeel.js): the water's lee foam and the spray's two kinds, each frame from the drawn pose, by the
  // quality level (FEEL_Q: L3 none); ?speedfeel=0 or hook.setSpeedFeel(false): none (the camera and the sound have their own switch)
  let feelOn = flags.speedfeel !== false;
  const leeNow = { strength: 0, wet: 0, side: 1, speed: 0 };
  let feelPin = null;   // the budget's worst case (tools/v2-ab-speedfeel.mjs): { strength, wet, speed } held whatever the pose, × the level's share
  const feelFrame = () => { if (!wakeFx || !B) return; const fq = feelQ(Q.level, feelOn); leeFoam(B.pose, fq, leeNow); if (feelPin) { leeNow.strength = fq.foam * feelPin.strength; leeNow.wet = fq.foam * feelPin.wet; leeNow.speed = feelPin.speed ?? leeNow.speed; } wakeFx.setLee(leeNow); const sp = wakeFx.spray; if (sp) { sp.gain.rail = fq.rail; sp.gain.bow = fq.bow; sp.gain.kd = B.knockdownOn ? KD_Q[Math.max(0, Math.min(3, Q.level | 0))] : 0; }
    // K2: past 34° of heel the water stays out of the hull and the cockpit (render/hullMask.js; nothing tested upright)
    const p = B.pose, mx = B.knockdownOn ? kdMix(p.heel) : 0; wakeFx.setHull({ heel: p.heel ?? 0, heave: p.heave ?? 0, pitch: p.pitch ?? 0, on: mx > 0 });
    wakeFx.setSprayLift(B.knockdownOn ? KD_LIFT * kdRoll(p.heel) : 0); };   // K2: the burst lit by the sky's whole light (0 upright)
  // --- end wake ---
  // #14: the wet exhaust's draw (its clots: v2/sim/seamanship.js), after the spray
  // channel markers (BACKLOG; v2/sim/channelMarks.js): the waters' buoys from one file; their one pipeline in the boat effects' group
  const aids = resolveMarks(CHANNEL_MARKS, { waters: 'tahoe-emerald', channel: CHANNEL, lonLatToWorld });
  const moorings = resolveMoorings(MOORINGS, { waters: 'tahoe-emerald' });   // the anchorage cues: the Boat Camp's 22 balls, every device
  const navAidsFx = flags.boat !== false && (aids.length || moorings.length) ? inGroup('boatfx', () => createNavAids({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat })) : null;
  const exhaustFx = flags.boat !== false ? inGroup('boatfx', () => createExhaustFx({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat })) : null;
  const shoreMirror = createShoreMirrorTarget(device);   // #41c: the shore's mirror (the towns fill it in the aerial pass; the water reads it)
  // #56 M3: the shore field (render/shore.js): its buffer and the spray's pipeline now, the baked field after the first frame
  const shore = flags.shore !== false ? inGroup('shore', () => createShore({ device, reg, frameBGL, frameBG, U, frameStruct, sky, terrainBGL: terrain.hbgl, hdrTarget, msaa: P.msaa, depthFormat })) : null;
  let shoreLoad = null;
  const water = createWater({ liteFirst, device, reg, graph, frameBGL, frameBG, U, frameStruct, sky, night, terrainBGL: terrain.hbgl, reflectView: terrain.reflectView, hdrTarget, msaa: P.msaa, depthFormat, seed: 1337 + P.seed, dt: clock.dt, wake: wakeFx, asyncSea: !P.headless && flags.filmui !== true, groundAt: (x, z) => terrain.field.height(x, z), shoreMirror, m1: flags.m1 !== false, shore, detail: feature('waterDetail').tier === 'on', under: underOn });   //: the variation layer and the persistent foam   // #56 M1: ?m1=0 the water before   // #21, #25: the sea field's land mask and the CPU surface's depth   // the day clock: a live page's sea tables built in a worker (a moving wind never stops a frame)
  const windBlend = createWindBlend({ device, reg, out: water.windTexture });   // fix(v2) shadow stepping: the wind texture's two newest fills cross-faded a frame (the gust patches drift, never step)
  const boatOn = flags.boat !== false;   // ?boat=0: the scene without it (the frame-time check)
  const boatR = boatOn ? createBoat({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat, errors, shadowSize: LEVELS[Q.level].boatShadow, telltales: flags.telltales, sailArt: flags.sailart, mirrors: feature('boatMirrors').tier === 'all', waterAt: (x, z, o) => water.heightAt(x, z, o), under: underOn, gkGrid: feature('gennakerCloth').tier }) : null;   // the water under her: the keel over or under the drawn surface (render/boat/waterline.js)
  // M3b: v1's boat models (the packed GLBs, tools/v2-boat-pack.mjs), streamed after the first frame (a capture: before it)
  const modelOn = boatR && flags.models !== false;
  const modelUrls = Object.fromEntries(['hull', 'cockpit', 'hardware', 'wheel'].map((n) => [n, new URL(`models/boat/${n}.glb.gz`, document.baseURI).href]));
  const { freeboard, anchorPin, throttle } = DEFAULT_DIMS.HULL;
  const modelOpts = { hull: { freeboard, anchorPin, throttle }, canvas: CANVAS_VARIANTS.variants[canvasVariant(location.search)] };
  // M5b: the forest (render/forest.js): lidar crowns + the rules' trees as baked cards, culled on the GPU; its data
  // streams after the first frame (a capture primes it all first); ?forest=0 leaves the terrain's canopy colour alone
  // --- M5c plug-in: the terrain shadow, the ground (photo tiles + detail), the boulders ---
  // the shadow map (render/shadow.js): the terrain's patches and the boulders from the sun; read by the terrain, the bed,
  // the forest cards and the boulders. ?tshadow=0 leaves the map empty (the A/B)
  const tshadow = createTerrainShadow({ device, reg, frameBGL, frameBG, U, frameStruct, terrain, every: flags.tshadow === 2 ? 1 : LEVELS[Q.level].shadowEvery });   // the phone pass: the level's cadence (4 / 8 / 12)
  const shadowOn = flags.tshadow !== 0;
  // the ground photo (v1's NAIP as 256² tiles, v2/terrain/photo.js) and v1's detail set, streamed after the first frame
  // (a capture: before it); ?photo=0 / ?detail=0 keep the baked class albedo / no grain (the A/B)
  const ground = inGroup('ground', () => createGround({ device, reg, terrain, variant: pickVariant(flags), photo: flags.photo !== false, detail: flags.detail !== false, rock: feature('rockDetail').tier === 'on', errors }));   // the close rock's two layers (render/rockDetail.js)
  // the boulders (render/rocks.js): v1's shore band and the slopes' rocks, scattered on the GPU, culled, one indirect draw
  const rocks = flags.rocks !== false ? inGroup('rocks', () => createRocks({ device, reg, frameBGL, frameBG, U, frameStruct, sky, terrain, shadow: tshadow, hdrTarget, msaa: P.msaa, depthFormat,
    bed: feature('bedBoulders').tier === 'full', zones: clearZones({ moorings, anchored: ANCHORED_BOATS, birthplaces: listBirthplaces(CURRENT_WATERS, { all: true }) }), under: underOn })) : null;
  const rocksOn = () => !!rocks && PG.rocks;   // perf(v2) iOS pipelines: scattered, culled and drawn once their group is built
  if (rocks) { let cp = false; graph.onBeforeSubmit((enc) => { cp = rocksOn() && rocks.copyCount(enc); }); graph.onAfterSubmit(() => { if (cp) rocks.afterSubmit(cp); }); }   // the boulders receive the shadow and do not cast (a 1 m rock in a 2.4 m texel map shadowed itself)
  if (flags.bed === false) terrain.setLook({ bed: 0, caustics: 0 });
  terrain.setLook({ fine: LEVELS[Q.level].bedFine });   // the phone pass: L2 takes v1's phone path in the shallows   // ?bed=0: the plain water column (the A/B)
  terrain.attach({ slope: water.slope.createView({ dimension: '2d-array' }), shadow: tshadow.view, sShadow: tshadow.sampler, shadowU: tshadow.buffer, photo: ground.photoView, detail: ground.detailView });
  // ultra M2: the sun's caustics on the bed (render/caustics.js: Ultra-Water's splat of the 12 m cascade), their own pass
  // after the water's sim; the bed reads their texture (?caustics=0: the stand-in, flat light)
  const caustics = flags.caustics !== false && flags.bed !== false ? createCaustics({ device, reg, slope: water.slope, onView: (v) => { terrain.attach({ caustic: v }); rocks?.attachCaustic(v); } }) : null;
  hook.caustics = caustics;
  hook.setCaustics = (on) => { caustics?.setLook({ on: !!on }); terrain.setLook({ caustics: on ? 1 : 0 }); };   // the in-page A/B (tools/v2-caustics.mjs ab): the splat and the bed's tap off and on
  const forest = flags.forest !== false ? inGroup('forest', () => createForest({ device, reg, graph, frameBGL, U, frameStruct, sky, terrain, hdrTarget, msaa: P.msaa, depthFormat, variant: pickVariant(flags), errors, shadow: tshadow, wind: water.windTexture,   // the trees sway in the water's wind texture (forest/sway.js)
    reach: forestAt(pickVariant(flags) === 'phone' ? FOREST.phone : FOREST.desktop, Q.level) })) : null;   // the phone pass: the level's reach
  terrain.setForest(forest?.L ?? { thin: 0, fade: 0, far: 0 }, !!forest);
  if (forest) terrain.attach({ canopy: forest.canopy });   // T3: the far forest's canopy grid on the terrain (render/canopy.js)
  let forestLoad = null, groundLoad = null, nightLoad = null, forestDone = !forest;   // forestDone: its data in (the phone's build gate)
  // --- towns plug-in (10a, trimmed by the owner 2026-11-13 to what Sail sees from the bay): v1's piers, boathouses, light
  // tower, harbour and breakwaters (one pipeline, instanced), and the ground's marks (the ski runs, Hwy 89's asphalt and
  // cut: the terrain's paint, the forest's keep-out); streamed after the first frame (a capture: before it). Buildings
  // wait for Sail to reach the open lake ---
  const towns = inGroup('towns', () => createTowns({ device, reg, graph, frameBGL, frameBG, U, frameStruct, sky, shadow: tshadow, hdrTarget, msaa: P.msaa, depthFormat, terrain, forest, mirror: shoreMirror, errors,
    phone: feature('townsTier').tier === 'lite',   // src/core/features.js: a phone, a tablet or L2–L3 (?terrain=phone)
    far: feature('farTowns').on }));   //: a phone loads the bay's set (no ski runs, no far towns' decks)
  tshadow.addCaster(towns.shadowCaster);   // #41: the decks, boathouses, tower and harbour cast into the terrain's sun shadow
  let townsLoad = null, townsDone = false;   // townsDone: its data in (the phone's build gate)
  // G1, G2: v1's landmarks (the ruin, the stone house, the waterfall) and the five shore flags flown from the local wind; two
  // pipelines declared now, the data after the first frame (a capture: before it); the flags stand on the towns' piers and
  // lawns, so a race cuts them with the towns (the landmarks stay)
  const landmarks = inGroup('towns', () => createLandmarks({ device, reg, frameBGL, frameStruct, sky, shadow: tshadow, hdrTarget, msaa: P.msaa, depthFormat, errors, seed: P.seed }));
  let landmarksLoad = null;
  // Fannette Island's tea house (owner, 2026-11-18: desktop only; src/core/features.js teaHouse): its mesh is its own chunk, fetched
  // after the landmarks (a live page: after the first frame, behind the home card; a capture: before its first frame) and drawn by
  // the landmarks' own pipeline in place of v1's ruin; a phone and a tablet never fetch it
  const teaOn = feature('teaHouse').on;
  if (!teaOn && !feature('oldRuin').on) landmarks.hideRuin();   // owner, 2026-11-18: no box-and-gable ruin on a phone or a tablet (?oldruin=1 keeps it)
  let teaLoad = null;
  const teaHouseLoad = () => (teaOn ? (teaLoad ??= import('./render/teaHouse.js').then(({ teaHouseParts }) => { hook.teaHouse = landmarks.addParts(teaHouseParts({ seed: 1 }).parts, { hide: 'ruin' }); })
    .catch((e) => { errors.push(`teaHouse: ${e?.message ?? e}`); })) : Promise.resolve());
  // --- end towns ---
  // --- the plug-in list (refactor round 3 C2; engine/plugins.js, living/lakePlugins.js): the living lake's features, each one row;
  // ctx is the bag they share (getters: what boot makes later). plugins.run(anchor) stands where a feature was called by hand ---
  // the played seam (engine/player.js): the boat, or a played thing added by its row (Tessie: living/lakePlugins.js TESSIE attach)
  const player = createPlayer({ boat: () => B?.state ?? null });
  const musicOn = !P.headless && flags.filmui !== true && flags.music !== '0' && flags.music !== false;   // music: live pages, not a ?filmui=1 film or ?music=0 (below)
  const musicDoor = createLateCore();   // music: the fireworks' pieces and the boat's radio on the page's music bus (bound below)
  const plugCtx = { device, reg, frameBGL, frameStruct, sky, shadow: tshadow, hdrTarget, depthFormat, msaaCounts, chunks, musicDoor: musicOn ? musicDoor : null, errors, flags, P, feature, inGroup, terrain, water, tBase, manifest: fullM, under: underOn, boatOn, wake: wakeFx,
    get B() { return B; }, get boatR() { return boatR; }, get clock() { return clock; }, get windField() { return windField; }, get m4() { return m4; }, get storm() { return storm; }, get weatherWind() { return weatherWind; },
    get cockpitIn() { return cockpitIn; }, get pipeQ() { return pipeQ; }, get regatta() { return regatta; }, get startPose() { return startPose; }, get sailBirth() { return sailBirth; },
    get birthRow() { return birthRow; }, get beds() { return beds; },
    birdsOn, birdsModP, ospreyDiveOn, pipesDefer, hook, simFrame, drawFrame, get graph() { return graph; }, get eye() { return eye; }, get fwd() { return fwd; }, get up() { return up; }, get sunNow() { return sunNow; },
    get fovDeg() { return fovDeg; }, set fovDeg(v) { fovDeg = v; }, get livingNow() { return livingNow; }, get stage() { return stage; }, get birdBeat() { return birdBeat; },
    get ballBodies() { return ballBodies; }, get raceProps() { return raceProps; }, raceKit: (...a) => raceKit(...a), player, tessieOn, tessieModP, canvas, get Q() { return Q; }, get cruise() { return cruise; }, get sea() { return sea; }, get kdGame() { return kdGame; }, get birthplaces() { return birthplaces; }, get viewProj() { return viewProj; }, get modeNow() { return modeNow; }, get kView() { return kView; }, get L() { return L; }, get PG() { return PG; } };
  const plugins = createPluginList(LAKE_PLUGINS, PLUGIN_ORDER, plugCtx), plug = plugins.get;
  // --- kayaks: living/lakePlugins.js KAYAKS (two pipelines declared now; the shore grids and the asset stream after the first
  // frame, a capture: before it) ---
  // the anchor seen: its splash and drips (the kayaks' droplets; all devices, nothing paid while nothing flies), with the boat's effects
  const anchorFx = boatOn ? inGroup('boatfx', () => createAnchorSplash({ device, reg, frameBGL, frameStruct, sky, shadow: tshadow, hdrTarget, msaa: P.msaa, depthFormat, seed: P.seed })) : null;
  hook.anchorFx = anchorFx;
  // the ground tackle seen close (owner, 2026-11-18: "These details are desktop only"): the anchor, the chain's links, the windlass; one
  // pipeline with the boat's effects. A phone keeps the glb's anchor and the line (src/core/features.js anchorDetail)
  const anchorGear = boatR && feature('anchorDetail').on ? inGroup('boatfx', () => createAnchorGear({ device, reg, frameBGL, frameStruct, sky, boat: boatR, hdrTarget, msaa: P.msaa, depthFormat })) : null;
  hook.anchorGear = anchorGear;
  const kView = () => ({ eye, fwd, fovDeg, aspect: canvas.width / Math.max(1, canvas.height) });
  // the glass boat (owner, 2026-11-18): a tour pontoon and her clear kayaks on a natural schedule through the bay; two
  // pipelines in the boat effects' group, her paddlers on the kayaks' skin pipeline; a phone never makes her (src/core/features.js glassBoat)
  plugins.create('living');   // kayaks, then the glass boat (living/lakePlugins.js: her paddlers on the kayaks' skin pipeline)
  // the play clock and the view the stage reads (v2/stage/director.js; the osprey's dive, sim/birds.js DIVE): play as Tessie counts
  // it (the home card's live lake counts), the view (right of the home card while it is up, as Tessie's)
  const cardNow = () => globalThis.document?.getElementById?.('lk-load')?.dataset?.state;
  const birdBeat = {
    get playing() { const st = cardNow(); return st == null || st === 'out' || st === 'gone' || st === 'menu' || st === 'attract' || st === 'home'; },
    get view() {
      const v = kView(), l = Math.hypot(v.fwd[0], v.fwd[2]) || 1, yaw = Math.atan2(v.fwd[0] / l, -v.fwd[2] / l), th = Math.tan(v.fovDeg * Math.PI / 360) * v.aspect, st = cardNow();
      const pitch = Math.atan2(v.fwd[1], l), vHalf = v.fovDeg * Math.PI / 360;   // up and down too (the attract camera looks well down)
      if ((st === 'home' || st === 'menu' || st === 'attract') && v.aspect > 1.2) { const a0 = Math.atan(-0.05 * th), a1 = Math.atan(0.92 * th); return { x: v.eye[0], z: v.eye[2], y: v.eye[1], yaw: yaw + (a0 + a1) / 2, hHalf: (a1 - a0) / 2, pitch, vHalf }; }
      return { x: v.eye[0], z: v.eye[2], y: v.eye[1], yaw, hHalf: Math.atan(th), pitch, vHalf };
    },
    get race() { return !!regatta?.on; },
  };
  // --- end kayaks ---
  // --- Tessie (M1): living/lakePlugins.js TESSIE, made only where the policy allows (a desktop at L0–L2); her three pipelines are
  // the deferred group 'tessie' (built after the first frame), her model fetched once play has started ---
  { const made = plugins.create('tessie'); if (made) await made; }
  const tessie = plug('tessie');   // her own features below (the stage's act, Cruise's cut, the sighting's assist, her revenge, the race, the hunts)
  // --- end Tessie ---
  // --- the fireworks: living/lakePlugins.js FIREWORKS, v1's July 4th show (src/fireworks/): built on the highlight day unless
  // ?fireworks=0 (its row's switch), its pipelines declared now; the shells, the smoke, the glow, the barges and their lamps draw only
  // in the show's window and the barges' evening; open world (owner, 2026-11-15): only Cruise's camera turns toward the show ---
  { const made = plugins.create('fireworks'); if (made) await made; }
  // --- M4: the cockpit's pipelines (declared now, built with the rest), the views and Sail's UI (attached with the boat) ---
  const filmUi = flags.filmui === true && !P.headless;   // ?filmui=1: a live page on the film clock (the goldens' hud frames)
  // a touch phone has no 3D cockpit (C, owner 2026-11-16): its flat controls (ui/flat.js) take the cockpit's place, and the
  // cockpit's asset is never fetched there; ?portrait=1 keeps the upright layouts (they draw from the cockpit's items)
  const phoneFlat = feature('flatControls').on;   // src/core/features.js: a finger-only, phone-sized frame, not ?portrait=1, never a capture
  const cockpitOn = boatOn && !P.headless && flags.panel !== 'dom' && !phoneFlat;
  lmFact('phoneFlat', !!phoneFlat);
  const cockpit = cockpitOn ? createCockpit({ device, reg, frameBGL, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat, errors, defer: true }) : null;
  const m4 = createM4({ flags, P, errors, cockpit });
  // the cinematic intro (owner, 2026-11-18; ui/cinematicIntro.js): once a page load, on the
  // home card's first entry into Sail or Cruise, desktop only (src/core/features.js 'cinematicIntro'); the bars, the HUD's entrance, the
  // camera's fit (placeCamera) and the lens look (the composite's Post.c)
  const intro = createIntro({ enabled: feature('cinematicIntro').on, reduced: () => reducedNow(), hint: () => m4.ui?.hint ?? null, calm: () => m4.ui?.calm ?? null });
  m4.cinema = intro;   // the first sail's line waits for it (m4.js)
  let introSeed = 0;
  // --- end M4 ---
  // --- birds: living/lakePlugins.js BIRDS (the switch and the early chunk fetch stay above: birdsOn, birdsModP; the flock made
  // once the terrain's heights are whole: plugins.prime('terrain')) ---
  { const pc = plugins.create('birds'); if (pc) await pc; }
  // M5e: the storm's draws (render/storm.js: the rain, the bolts), declared with the rest
  const [stormSim, stormRender, stormAudio] = stormOn ? await stormModP : [null, null, null];
  const stormDraw = stormRender && inGroup('storm', () => stormRender.createStormDraw({ device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat, pixels: P.fixed ? P.fixed[0] * P.fixed[1] : Math.min(P.maxPx, innerWidth * innerHeight * Math.min(devicePixelRatio || 1, P.dprCap) ** 2),
    bolts: feature('lightningBolts').on }));   //: a phone's storm keeps the rain, the flashes and the thunder, not the bolt's channel
  // --- Regatta plug-in: its lines and props (one pipeline each; they draw only in a race and under Sail's practice marks). Their
  // chunk is imported when a race or the practice marks first ask (owner 2026-11-17: "imported only when
  // Regatta starts; no pipelines before the first frame for them"; every device): after the first frame their pipelines are a late
  // group of their own ('raceKit', engine/pipelines.js), built paced, and the props and lines exist only once built. A capture, a
  // page opened in a race and a phone (the build-first rule: none in play; built behind the card before its modes light) declare them
  // with the load (group 'regatta', as before) ---
  let raceLines = null, raceProps = null, raceKitP = null;
  const raceKit = (boot = false) => (raceKitP ??= (flags.boat === false ? Promise.resolve(null) : (raceKitModP ?? Promise.all([import('./render/raceLines.js'), import('./render/raceProps.js')])).then(async ([{ createRaceLines }, { createRaceProps }]) => {
    const g = boot ? RACE_PIPE : 'raceKit', a = { device, reg, frameBGL, frameBG, U, frameStruct, sky, hdrTarget, msaa: P.msaa, depthFormat, sailArt: flags.sailart };
    const lines = inGroup(g, () => createRaceLines(a)), props = inGroup(g, () => createRaceProps(a));
    if (!boot) await reg.release(g);
    raceLines = lines; raceProps = props;
    props.setMarkSink?.(navAidsFx);   // the race marks on the channel buoys' pipeline (render/navAids.js; the race fixes round 2)
    return { lines, props };
  })).catch((e) => { errors.push(`race kit: ${e?.stack ?? e}`); return null; }));
  if (raceKitBoot) await raceKit(true);   // a capture, a page opened in a race, a phone (built before its modes light)
  // --- end Regatta ---
  // --- the target beacon (owner 2026-11-15: the light pillar; ?beacon=0: nothing made, built or drawn) ---
  const beaconFx = flags.beacon !== false && flags.boat !== false ? createBeaconFx({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa: P.msaa, depthFormat }) : null;
  const beacon = beaconFx ? { fx: beaconFx, sim: createBeacon(), pin: null, draw: true, mark: null, latest: createLatest() } : null;
  let compositeOff = false;   // perf(v2) phone round 2: the sweep's composite case draws 'tonemap-none' (a flat fill: the pass's fixed cost)
  inGroup('sweep', () => { const mod = reg.shader('tonemap-none', `${HEAD}${FULLSCREEN}\n@fragment fn fs(v: VOut) -> @location(0) vec4f { return vec4f(0.1, 0.12, 0.2, 1.0); }`);
    reg.add('tonemap-none', { layout: compositeLiteLayout, vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }); });
  for (const mode of TONEMAP_MODES) {   // perf(v2) phone round 2: the plain, storm and bow variants, each built at load
    if (mode !== 'plain' && !stormOn) continue;   // owner 2026-11-18: no storm on a phone, so neither storm composite
    if (mode === 'bow' && !rainbowOn) continue;   //: a phone's storm clears without the rainbow (no bow pipelines)
    const name = mode === 'bow' ? 'tonemap' : `tonemap-${mode}`;
    const desc = (n) => { const mod = reg.shader(n === P.msaa ? name : `${name}@${n}x`, TONEMAP(n, mode)); return { layout: mode === 'bow' ? compositeLayouts.get(n) : compositeLiteLayout, vertex: { module: mod, entryPoint: 'vs' }, fragment: { module: mod, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }; };
    inGroup(mode === 'plain' ? 'core' : 'storm', () => reg.add(name, mode === 'bow' ? desc : desc(P.msaa)));   // #31: the bow reads the scene's depth (multisampled or not): one per count
  }

  // phase 2b (§ 3.8): the light under the water (the shafts at the full tier, the specks, the bubbles); nothing above it
  const underLight = underOn ? createUnderLight({ device, reg, frameBGL, sky, frameStruct, hdrTarget, msaa: P.msaa, depthFormat, hdrFormat: graph.hdrFormat, tier: underTier, caustics, tshadow, boatShadow: boatR?.shadowRead ?? null }) : null;
  let specksEyeWas = null, specksVel = [0, 0, 0];   //: the eye's velocity for the specks' stretch
  const bubbles = underLight ? createBubblePool({ seed: 1 + P.seed }) : null, bubbleSrc = bubbles ? createBubbleEmitter(bubbles) : null;
  if (boatR) graph.addPass({ name: 'boat-shadow', kind: 'custom', encode(enc, ctx, c, ts) { return boatR.shadow(enc, c, ts); } });   // perf(v2) phone round 2: false when the map stands   // M3: the boat's own sun shadow, first
  graph.addPass({ name: 'terrain-shadow', kind: 'custom', encode(enc, ctx, c, ts) { return tshadow.encode(enc, c, ts, terrain.patch.index, terrain.patch.count); } });   // perf(v2) phone: false when the map stands (no pass)   // M5c: the terrain's depth from the sun
  // perf(v2) phone: the phone path's half-rate steps (levers.simEvery, airEvery: 1 at L0 and L1, 2 at L2 and L3); the first frames always run
  const due = (every) => !(every > 1) || hook.frames < 4 || hook.frames % every === 0;
  // round 2: simSplit spreads the half-rate step over both frames ('a' on the aerial's frames, 'b' on the others)
  const simStep = () => (!(levers.simEvery > 1) || hook.frames < 4 ? true : levers.simSplit ? (hook.frames % 2 === 0 ? 'a' : 'b') : due(levers.simEvery));
  const offAir = () => hook.frames % 2 === 1;   // perf(v2) phone round 2: the cloud key's step and the boat's shadow on the frames the aerial pass skips
  graph.addPass({ name: 'water-sim', kind: 'compute', run(pass, ctx, c) { windBlend.run(pass, c); water.run(pass, ctx, c, simStep()); plugins.run('compute.water', pass, c); } });   // Tessie: her creature map after the wake's; then the glass boat's (living/lakePlugins.js); #24: the osprey's rings when the map is the birds'
  if (caustics) graph.addPass({ name: 'caustics', kind: 'custom', encode(enc, ctx, c, ts) { const r = caustics.encode(enc, [sunNow.x, sunNow.y, sunNow.z], ts, hook.frames); if (r) { c.calls += 3; c.dispatches += caustics.sets[caustics.active].levels - 1; } return r; } });   // ultra M2: false with the sun down or between the phone path's steps (no pass)
  graph.addPass({ name: 'sky-lut', kind: 'compute', run(pass, ctx, c) { sky.runView(pass, c); } });
  graph.addPass({ name: 'aerial', kind: 'compute', run(pass, ctx, c) { if (!due(levers.airEvery)) return; sky.runAerial(pass, c); terrain.runReflect(pass, c); towns.runMirror(pass, c); } });   // the air's froxels and the water's mirror of the land (#41c: and of the shore)
  graph.addPass({ name: 'cloud-key', kind: 'compute', run(pass, ctx, c) { clouds.run(pass, c); } });   // M5a: this frame's rows of the next cloud key (it reads the light record)
  let layerList = flags.layers ? flags.layers.split(',') : null;
  const layer = (n) => !layerList || layerList.includes(n);   // ?layers= (profiling): which draws run
  const L = {};
  const setLayers = () => Object.assign(L, { terrain: layer('terrain'), water: layer('water'), sky: layer('sky'), boat: layer('boat') && !!boatR, forest: layer('forest') && !!forest, rocks: layer('rocks') && !!rocks, birds: layer('birds') && plugins.has('birds'), kayaks: layer('kayaks') && plugins.has('kayaks'), tessie: layer('tessie') && !!tessie, fireworks: layer('fireworks'), night: layer('night'), storm: layer('storm'), cockpit: layer('cockpit'), towns: layer('towns') });
  setLayers();
  // the in-page profile (tools/v2-perf.mjs): drop scene draws without a reload; null keeps them all
  hook.setLayers = (list) => { layerList = list ? String(list).split(',') : null; setLayers(); };
  // perf(v2) iOS pipelines: a deferred group runs and draws only once built (PG: the groups' state, read once a frame in fill)
  const PG = { post: !pipesDefer, rocks: !pipesDefer, forest: !pipesDefer, fireworks: !pipesDefer, night: !pipesDefer, storm: !pipesDefer, regatta: !pipesDefer, boatfx: !pipesDefer, kayaks: !pipesDefer, tessie: !pipesDefer, sweep: !pipesDefer };
  let pgAll = !pipesDefer;
  const readPG = () => { if (pgAll) return; let all = true; for (const g of Object.keys(PG)) { PG[g] = PG[g] || reg.ready(g); all &&= PG[g]; } pgAll = all; };
  graph.addPass({ name: 'forest', kind: 'compute', run(pass, ctx, c) { if (PG.forest) forest?.run(pass, c); if (rocksOn()) rocks.run(pass, c); plugins.run('compute.forest', pass, c); } });   // the fireworks: v1's star step   // M5b: its one-offs, then the cull; M5c: the boulders' scatter and cull
  graph.addPass({ name: 'scene', target: 'hdr', clear: [0, 0, 0, 1], depth: true, depthStore: () => ((storm.weather.on > 0.5 && bowNow() > 0) || plugins.some('scene.depth') || (UNDER_STATE.on && underLight?.wantsDepth()) ? 'store' : 'discard'), draw: sceneDraw });   // phase 2b: the shafts read the depth (only while the eye is under)
  const S = { race: false, uw: false };   // the plug-ins' draw slots: this pass's race and eye-under (living/lakePlugins.js)
  function sceneDraw(pass, ctx, c) {
    pass.setBindGroup(0, frameBG, [U.byteOffset]);
    if (L.cockpit && !cruise?.on) m4.drawOpaque(pass, c);    // M4: the cockpit first (its depth sits in front of the world: the world behind it is never shaded); Cruise has none (v1: Sail's station comes with the hand-over)
    pass.setBindGroup(0, frameBG, [U.byteOffset]);
    const uw = UNDER_STATE.on;                               // phase 2a: the eye under the water (each draw with a twin picks it itself: render/underState.js)
    if (L.terrain) terrain.draw(pass, c);                    // the land, and the lake bed through its water column
    if (L.rocks && rocksOn()) rocks.draw(pass, c);                        // M5c: the boulders, opaque, one indirect draw
    if (L.towns && !regatta?.on && !uw) towns.draw(pass, c);        // 10a: the piers, the boathouses, the harbour, the breakwaters (opaque, before the water)
    if (L.towns && !uw) landmarks.draw(pass, c, { flags: !regatta?.on });   // G1, G2: the ruin, the stone house; the flags' poles and cloth (not in a race)
    if (L.forest && PG.forest && !uw) forest.draw(pass, c);                      // M5b: the trees, opaque (alpha to coverage), one indirect draw
    if (L.boat) boatR.draw(pass, c);                         // the sloop, opaque: the water's blend then covers its hull below the waterline (v1's order)
    if (L.boat && PG.boatfx) anchorGear?.draw(pass, c);      // the anchor, the chain's links, the windlass (desktop and tablet)
    if (L.boat && PG.boatfx) anchorFx?.draw(pass, c);        // the anchor seen: the splash's droplets, opaque (nothing while none fly)
    const race = !!regatta?.on;                              // Regatta: the race cuts the kayaks, the birds, the fireworks and the town detail (owner 2026-11-14)
    S.race = race; S.uw = uw;
    plugins.run('scene.solid', pass, c, S);                  // kayaks, then Tessie: opaque, before the water (her shadow on the bed, her drops) (living/lakePlugins.js)
    plugins.run('scene.solid2', pass, c, S);                 // birds: the snag and the flock, opaque (a dithered fade); the fireworks' barges, tugs and patrol boats (their evening only)
    if (PG.boatfx) navAidsFx?.draw(pass, c);                               // channel markers: the buoys (opaque, before the water; nothing while none is near)
    if ((race || raceProps?.active || raceProps?.stats.lake) && PG.regatta) raceProps?.draw(pass, c); // Regatta: the committee boat, the pin, the marks, the computer boats (opaque, before the water); U15: Sail's practice marks
    plugins.run('scene.solid3', pass, c, S);                 // the glass boat: the pontoon, the kayaks' rims and seats, her paddlers (opaque, before the water)
    if (L.water) water.draw(pass, c, terrain.heightsBindGroup);     // the surface, blended over the bed (premultiplied: its Fresnel share)
    plugins.run('scene.water', pass, c, S);                  // birds: the low birds' soft shadows on the water; the glass boat's mirror in the surface (its Fresnel share: Tessie's way)
    if (boatR && L.boat && L.water && B && !uw) boatR.drawMirror(pass, c, { eye, helm: Math.hypot(eye[0] - B.state.x, eye[2] - B.state.z) < 7 });
    plugins.run('scene.mirror', pass, c, S);   // the kayakers' mirrors, then Tessie's (and the mist of her big splashes)   // the boats' mirrors: the player (her sails only from on board), the near rivals and the lake's boats
    if (L.sky) { if (uw && underBack?.drawBack(pass, c)) { /* phase 2a: the water's own light in the sky's place */ } else sky.draw(pass, c); }   // only where nothing was drawn (reversed depth still 0)
    if (uw && underLight) underLight.drawSprites(pass, c);   // phase 2b: the specks drifting round the eye, the bubbles (depth-tested, no depth written)
    plugins.run('scene.light', pass, c, S);                  // the fireworks: the stars and their reflection, the smoke, the glow, the lamps (additive)
    if (L.sky && L.night && nightOn && PG.night && !uw) night.draw(pass, c, sky);          // M5e: the stars where the sky is, then the towns' and the boat's lights (depth-tested)
    plugins.run('scene.clear', pass, c, S);                  // the glass boat: the clear hulls, her windows and glass panel, the LEDs' pools, her wake (premultiplied, no depth written)
    if (L.towns && !uw) landmarks.drawBlend(pass, c);               // G1: the waterfall's streaming ribbon and its plunge foam (blended, no depth written)
    if (L.storm && PG.storm && stormDraw && !uw) stormDraw.draw(pass, c, sky);               // M5e: the rain (the sky shows through it), the bolt's core and glow
    if (race && PG.regatta) raceLines?.draw(pass, c);                      // Regatta: the lines on the water, after the sky (depth-tested, no depth written: hulls pass in front)
    if (beacon?.draw) beaconFx.draw(pass, c);                // the target beacon: the light over the mark in force (additive, depth-tested, no depth written)
    if (L.boat && PG.boatfx && !uw) wakeFx?.drawSpray(pass, c);                  // wake: the bow spray, blended after the sky (no depth written)
    if (L.water && !uw) shore?.drawSpray(pass, c, terrain.heightsBindGroup);   // #56 M3: the breaking crests' spray in strong wind (nothing drawn otherwise)
    if (L.boat && PG.boatfx && !uw) exhaustFx?.draw(pass, c);                    // #14: the wet exhaust's clots, blended (no depth written)
    if (L.boat && !uw) boatR.drawGlass(pass, c);                    // M3b: the dodger's clear vinyl and smoked panels, blended last
    if (L.cockpit && !cruise?.on) m4.drawBlend(pass, c);     // M4: the cockpit's glass, dome and soft shadows, over everything
  }
  // phase 2a (owner, 2026-11-20: the crossing gradual, per pixel): while the surface is within LENS.band of the eye the scene is drawn again for
  // the other side of the surface into the split's targets (UNDER_STATE flipped: the air's pipelines or the twins; its own frame block, the
  // near plane at the lens), then merged over the frame per pixel by the side of the wavy surface each view ray starts on (render/underBack.js)
  if (underLight?.shafts) graph.addPass({ name: 'under-shaft', kind: 'custom', encode(enc, ctx, c, ts) {   // phase 2b: the shafts (half res, blurred, added onto the frame), before the split lays the other side over
    if (!UNDER_STATE.on) return false;
    const r = underLight.encode(enc, { targets: graph.targets, msaa: graph.msaa, ts, frameBG: { bg: frameBG, offset: U.byteOffset } });
    if (r) c.calls += 3;
    return r;
  } });
  if (underBack) graph.addPass({ name: 'under-split', kind: 'custom', encode(enc, ctx, c, ts) {
    if (!underSplitOn || !underBack.ready()) { underBack.skip(); return false; }   // refactor round 3 B4: the split's targets freed after a second unused
    const main = UNDER_STATE.on;
    return underBack.encode(enc, { targets: graph.targets, msaa: graph.msaa, frameBG, offset: U.byteOffset, ts,
      draw: (pass) => { UNDER_STATE.on = !main; UNDER_STATE.split = true; U.pin(SPLIT_OFF); try { sceneDraw(pass, ctx, c); } finally { UNDER_STATE.on = main; UNDER_STATE.split = false; U.pin(null); } } });
  } });
  plugins.run('graph.post', graph, { frameBG, offsets: () => [U.byteOffset] });   // the fireworks' own post after the scene (living/lakePlugins.js FIREWORKS: its pass 'fw-post', only while the show is in the air at night)
  // the post chain's bloom (render/bloom.js): its downs and ups on its own mip texture, after the scene, before the composite reads
  // its mip 0; no pass where the bloom is off, before its group is built, or while its strength is 0 (the timer reads 0 ms)
  if (bloomOn) graph.addPass({ name: 'bloom', kind: 'custom', encode(enc, ctx, c, ts) { if (!PG.post) return false; const r = post.encode(enc, ts); if (r) c.calls += post.passes; return r; } });
  graph.addPass({ name: 'composite', target: 'swap', clear: [0, 0, 0, 1], depth: false,   // perf(v2) phone: cleared, not loaded: its triangle covers every pixel, and a tile GPU reads a loaded swap chain image into tile memory first
   draw(pass, ctx, c) {
    if (compositeOff && PG.sweep) { pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, hdrOnlyBG); pass.setBindGroup(2, lutBG); pass.setPipeline(reg.get('tonemap-none')); pass.draw(3); c.calls++; return; }   // perf(v2) phone round 2: the sweep's composite case
    const mode = PG.storm && stormOn ? tonemapMode(storm.weather.on, bowNow()) : 'plain';   // perf(v2) phone round 2: the frame's own storm rows pick the variant (iOS pipelines: plain until the storm's group is built)
    pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, mode === 'bow' ? hdrBG : hdrOnlyBG); pass.setBindGroup(2, lutBG);
    pass.setPipeline(reg.get(mode === 'bow' ? 'tonemap' : `tonemap-${mode}`)); pass.draw(3); c.calls++; c.triangles += 1;
  } });

  const tBuild0 = performance.now();
  // the pipelines build while the terrain's first stage downloads and decodes (a worker)
  const tTerrain0 = performance.now();
  const firstStage = terrain.start(stages, tBase);
  firstStage.then(() => lmEnd('terrain1'), () => {});
  loadStage('terrain');
  lmEnd('world'); lmStart('pipelines');
  // perf(v2) iOS pipelines: the groups this boot draws in its first frames are built with the load (an evening page's night
  // and show, a storm page's rain, a page opened in a race); the rest after the first frame, hero first (pipeQ below)
  const eveningBoot = P.hour != null && (P.hour >= 19.5 || P.hour < 5.5);
  if (eveningBoot || plugins.some('boot.night')) reg.release('night');   // a pinned show time (?fwt) is a night page too
  plugins.run('boot.pipes', eveningBoot);   // the fireworks' group (an evening page's show)
  if (flags.weather === 'storm' && stormOn) reg.release('storm');
  if (raceBoot) reg.release(RACE_PIPE);
  if (flags.diag === '2') reg.release('sweep');
  const pipeQ = createReleaseQueue(reg, buildFirst ? PHONE_ORDER : PIPE_ORDER);
  try { await reg.buildAll(); } catch (e) {   // the phone pass: never a black screen: the card, and the failing pipeline's name and message in the diag panel
    console.error(e); const f = reg.failure;
    diag.setInfo(() => ({ why: f ? `pipeline "${f.name}" failed` : 'the pipelines failed', pipeline: f, mem: memNow(), crash: crash?.line(), ua: navigator.userAgent, adapter: gpu.info, dpr: devicePixelRatio, level: Q.level, levelName: LEVELS[Q.level].name }));
    crash?.beat(true);
    showError(f ? `pipeline "${f.name}": ${f.message}` : String(e.message ?? e)); return;
  }
  loadStage('pipelines');
  lmEnd('pipelines');
  const pipelineBuildMs = performance.now() - tBuild0;
  // a device that took over PIPE_SLOW_MS for the first frame's set compiles slowly (iPhone WebKit: one at a time on its GPU
  // queue): its other groups wait for the home card's hand-over, and it builds no speculative MSAA set. Phones and tablets
  // only: a desk compiles in parallel, and a busy desk (a long build under load) keeps the desk's timing (its streams at once)
  const pipesSlow = !desk && pipelineBuildMs > PIPE_SLOW_MS;
  { const tm = reg.timings(); lmFact('pipes', { n: tm.n, ms: Math.round(pipelineBuildMs), families: tm.families.slice(0, 6), top: tm.top.slice(0, 5), deferred: reg.size + reg.perCount - tm.n, slow: pipesSlow }); }
  try { if (storage && !P.headless) storage.setItem(PIPE_STORE, JSON.stringify({ gpu: qKey, ms: Math.round(pipelineBuildMs), n: reg.timings().n })); } catch { /* storage blocked */ }
  lmStart('sky');
  sky.bakeOnce();   // the transmittance and multi-scattering LUTs, once, before the first frame
  loadStage('sky');
  clouds.bakeOnce();   // M5a: the clouds' noise and weather tiles, once
  lmEnd('sky'); lmStart('terrain.wait');
  await firstStage;
  lmEnd('terrain.wait'); lmStart('boat');
  lmFact('terrain', { files: terrain.stats.files, firstKB: Math.round(terrain.stats.firstBytes / 1024), decodeMs: Math.round(terrain.stats.decodeMs) });
  if (cockpit) lmSpan('cockpit', cockpit.ready);
  cockpit?.load();   // perf/v2-phone-load: the cockpit's asset (1 MB on a phone) after the terrain's first stage, not sharing its link
  // ...and ahead of everything that streams after the first frame (the terrain's later stages, the boat's models, the
  // forest, the photo, the shore field, the kayak asset, the towns: several MB): they wait for it (at most CK_FIRST_MS), so
  // it lands while the loading card is still up, as it did before; they still start ≈ 2 s earlier than before this branch
  let cockpitIn = !cockpit;
  const cockpitGate = cockpit ? Promise.race([cockpit.ready, new Promise((r) => setTimeout(r, CK_FIRST_MS))]).then(() => { cockpitIn = true; }) : Promise.resolve();
  terrain.ready();   // the first grids' normal maps (the bake's pipeline exists now)
  terrain.stats.firstBytes += fullLen + phoneLen;   // the manifests ride the first load too
  const terrainFirstMs = performance.now() - tTerrain0;

  // --- the wind, the boat and the camera ---
  // the start pose's URL rows (v1's startPose: ?start=x,z, ?heading=)
  function startPose0() { return { ...(flags.start ? (() => { const a = String(flags.start).split(',').map(parseFloat); return a.length === 2 && a.every(Number.isFinite) ? { x: a[0], z: a[1] } : {}; })() : {}), ...(flags.heading != null && Number.isFinite(parseFloat(flags.heading)) ? { headingDeg: parseFloat(flags.heading) } : {}) }; }
  // the shared wind as the boat feels it: v1's WindField (gusts, the valley's steering, the lee: src/sim/wind.js) on the
  // day's base at the scene's hour (the water reads the same base through windFor), over v2's terrain heights
  // (setTerrain takes a heightAt; v1's shore-distance and cover are not needed by it). ?wind= sets v1's level,
  // ?windspeed/?winddir pin a steady base (v1's world.js)
  // Sail's wind shifts by the player's experience (owner, 2026-11-17; v2/sim/wind.js sailShiftProfile, src/sim/sail-shifts.js): the
  // profile at boot, then each frame (windNowAt) as the mode, Setup's profile or Pro change; 'off' in Cruise and Regatta
  // the birthplace (73 § 2; owner, 2026-11-18): a Sail page starts at the saved pick, ?birth=, or Tessie's water on
  // a first visit, on a reach off the live wind (below, once the field exists); ?start= / ?heading= alone pin today's pose (the
  // goldens, the page tests). Cruise and Regatta keep their own starts (Cruise takes a chosen pick: cruiseBirth below)
  let cruiseBirth = () => null;   // set with the birthplaces' service (below)
  const birthSeed = visitSeed(flags);
  const birthAt = resolveStart({ flags, settings: pageSettings(), waters: CURRENT_WATERS, seed: birthSeed });
  const birthRow = birthAt ? listBirthplaces(CURRENT_WATERS).find((r) => r.id === birthAt.id) : null;
  const sailBirth = !!birthRow && !cruiseBoot && !raceBoot;
  const startPin = sailBirth ? { x: birthRow.x, z: birthRow.z, headingDeg: START.headingDeg } : { ...START, ...startPose0() };   // the first gust's provisional pose (relaid below on the rule's heading)
  let modeNow = () => bootId, proNow = () => proWanted(flags, pageSettings());
  const shiftNow = () => sailShiftProfile({ flags, mode: modeNow(), settings: pageSettings(), pro: proNow() });
  const windField = P.windSpeed != null || P.windDir != null
    ? new WindField({ seed: P.seed, bay: CURRENT_WATERS.windBay, base: { ...(P.windDir != null ? { dirDeg: P.windDir } : {}), ...(P.windSpeed != null ? { speedMs: P.windSpeed } : {}) } })
    : cruiseBoot ? new WindField({ seed: P.seed, bay: CURRENT_WATERS.windBay, ...cruiseWind(flags, P.hour), sailShifts: 'off' })   // Cruise: v1's Cruise wind (Tahoe's day; ?wind= its level: src/modes/chill/index.js coreOptions)
    : new WindField({ seed: P.seed, bay: CURRENT_WATERS.windBay, ...sailWindOptions(flags, { hour: P.hour, rate: P.timerate, start: startPin }), sailShifts: shiftNow() ?? 'off' });   // v1's Sail wind (src/sail/options.js): the level (3 unless ?wind=), the first gust line, the shifts, the gust cells (v2/sim/wind.js sailWindOptions)
  windField.setTerrain((x, z) => terrain.field.height(x, z));
  windField.nightHold = !cruiseBoot;   // Sail's night holds the chosen level (owner, 2026-11-15: no dead-flat lake at night; src/sim/wind.js heldHour); Cruise keeps v1's calm night (v2/cruise sets it per mode)
  // audit W1–W3: the water's wind texture (sim/windTex.js): a worker's fills on a live page, in place on the sim's steps in a capture
  // (?headless=1 and a ?filmui=1 film: the worker's results land on the wall clock, a different film frame each run)
  const windTex = createWindTex({ field: windField, live: windTexLive({ headless: P.headless, filmui: flags.filmui }), makeWorker: () => { lmPoint('worker.wind'); return new Worker(new URL('./sim/wind-worker.js', import.meta.url), { type: 'module', name: 'velia-wind' }); }, terrain, seed: P.seed });
  const windFx = { tex: true, gust: true, lanes: true, caps: true };   // the in-page A/B (hook.setWindFx)
  // Tahoe's day follows the light while the clock runs on its own (v1's core: wind.setClock(clock.hourAt), unwrapped hours); a
  // frozen capture keeps the wind's own day, as before
  if (P.clockMode === 'day' || P.clockMode === 'rate') windField.setClock?.((tt) => clock.hourUnwrappedAt(tt));
  const birthDepth = (x, z) => -terrain.field.height(x, z);   // the land probe's water depth, m (the terrain's first stage is in)
  const birthWind = (x, z) => windField.sample(x, z, B?.t ?? 0).dirDeg;   // the live true wind's FROM there
  const birthShow = (x, z) => plugins.first('start.pose', clock?.hour ?? P.hour)?.facing(x, z) ?? null;   // the fireworks evening faces the show (the 50° guard: birthplace.js)
  const birthPose0 = sailBirth ? birthPose(birthRow, { windDeg: windField.sample(birthRow.x, birthRow.z, 0).dirDeg, depthAt: birthDepth, showDeg: plugins.first('start.pose', P.hour)?.facing(birthRow.x, birthRow.z) ?? null }) : null;
  if (birthPose0 && flags.heading != null && Number.isFinite(parseFloat(flags.heading))) { birthPose0.headingDeg = parseFloat(flags.heading); birthPose0.camYawDeg = 0; }   // ?birth= with ?heading=: the heading pinned
  if (birthPose0 && !cruiseBoot) relayGust(windField, birthPose0, { t: 0, flags });   // the first gust ahead of the rule's heading, as the constructor would have laid it
  const startPose = birthPose0 ? { x: birthPose0.x, z: birthPose0.z, headingDeg: birthPose0.headingDeg, speed: birthPose0.speed } : { ...START, ...startPose0() };
  // (owner, 2026-11-19: "Shall we load stones based on birthplace?"): the bed's 3D stones are placed round the
  // player's regions only (her region and its neighbours, of those with a birthplace: v2/living/busyLake.js REGIONS), re-placed
  // when she reaches a region whose set differs; outside every region the last set stays (v2/sim/bedBoulders.js createStoneRegion)
  const stoneRegion = createStoneRegion({ regions: regionsWithBirthplaces(REGIONS, listBirthplaces(CURRENT_WATERS, { all: true })), active: activeRegions, marginM: BED_REGION.marginM });
  { const d = stoneRegion.at(startPose.x ?? 0, startPose.z ?? 0); if (d) rocks?.setRegion(d); }
  // the fireworks scene faces the show (owner, 2026-11-18; sim/fireworksSite.js): a page opened in the show's window starts the
  // boat facing the barges (from the start: about 60°, the mouth dead ahead) unless the URL gives a heading; every other start as before.
  // The show beside the mast (fix/v2-fireworks-view-clouds): 18° off the show, the side clear of the wind (sim/fireworksSite.js SHOW_VIEW)
  // Round 2: the show's own start in deep water (sim/fireworksSite.js SHOW_START; the shoal assist bore her off the shelf). A page opened
  // in the show takes the show's start over the remembered birthplace; ?birth= or ?start= still win (the player's or the URL's choice)
  const showStart = !cruiseBoot && !raceBoot && flags.birth == null ? plugins.first('start.pose', P.hour) : null;   // the list's show start (living/lakePlugins.js FIREWORKS start.pose)
  if (showStart) {
    const at = flags.start ? null : showStart.at();
    if (at) Object.assign(startPose, at);
    if (flags.heading == null) startPose.headingDeg = showStart.facing(startPose.x, startPose.z, windField.dirAt(startPose.x, startPose.z, clock.t));
    if (birthPose0) birthPose0.camYawDeg = 0;   // the show is already beside the mast: no hero glance
  }
  loadStage('boat');
  const B = boatR ? createBoatSim({ water: waterFor(water.heightAt, { velocityAt: water.velocityAt, now: () => clock.t }), heightAt: (x, z) => terrain.field.height(x, z), wind: windField, start: startPose, flags, t0: P.t0, headless: P.headless, wake: wakeFx?.track, makeSpray: wakeFx?.makeSpray, trim: feature('deskTrim').on ? DESK_TRIM : null }) : null;   // wake: the ride steps them   // a desk page's faster held sheet (DESK_TRIM; a phone keeps v1's)
  if (B && feature('flatControls').on) B.setFlat(true);   // a phone's flat controls: the Boat view's flat pose (sim/camTilt.js BOAT_VIEW_FLAT: the masthead under the taller top bar)
  // the hero further than 35° off the bow: the camera starts turned to it, holds BIRTH.camHoldS of sim, then the chase brings it back
  let birthCamUntil = null;
  const birthCam = (pose) => { if (!B || !pose?.camYawDeg || flags.camyaw != null) return; B.follow.yaw = (pose.headingDeg + pose.camYawDeg) * DEG; B.follow.chase = false; birthCamUntil = B.t + BIRTH.camHoldS; };
  birthCam(birthPose0);
  // audit W4: v1's gust payoff (controllers/sail.js: createGustFx; ?gustfx=0 off, as the gust cells): Sail and Regatta, not Cruise
  const gust = B ? createGust({ on: flags.gustfx == null || (flags.gustfx !== false && flags.gustfx !== '0' && flags.gustfx !== 0), reduced: () => !P.headless && reducedNow() }) : null;
  let gustNow = gust ? gust.last : null;
  // --- #8, #14 plug-in: the engine and the ground tackle (v2/sim/seamanship.js: v1's seamanship.js without three): B.step runs its
  // pre and post; the piers v1 collides with and ties up to stream in after the first frame (v2/assets/towns/piers.json) ---
  const MAST_HEAD = [0, DEFAULT_DIMS.HULL.mastStepY + DEFAULT_DIMS.RIG.mastTop + 0.05, DEFAULT_DIMS.HULL.mastStepZ];   // the anchor light on the truck (hull frame)
  let anchorEvents = [];   // the anchor seen: the seamanship's events this frame (fill: the droplets and the sound)
  const anchorages = (ANCHORAGES.spots ?? []).map(([x, z, depth, shelter, name]) => ({ x, z, depth, shelter, name }));   // the anchor seen: the chart's anchorages
  // the mooring balls as bodies (they bob, a bump shoves them; the tackle picks one up: v2/sim/moorings.js MOOR_V2, J or U near one)
  const ballBodies = createMarkBodies(moorings, { onBump: (e) => beds?.cue('thud', { v: e.speed, mat: 'sand' }) });
  const sea = B ? createSeamanship({ B, depthAt: (x, z) => -terrain.field.height(x, z), clock, sun: () => sunNow.elevDeg, timeScale: P.headless ? 1 : P.speed, anchorages, balls: ballBodies.bodies, M: MOOR_V2 }) : null;   // the bow look runs with Calm camera too (owner 2026-11-18: "I did not see the camera move"; it is already a 6 s ease under 15°/s)
  if (sea && anchorGear) sea.hang = true;   // the gear drawn close: the anchor hangs under the roller (its splash there)
  if (sea) { B.sea = sea; import('./assets/towns/piers.json').then((m) => sea.setPiers(piersOf(m.default ?? m))).catch((e) => errors.push(`piers: ${e?.message ?? e}`)); }
  // --- end #8, #14 ---
  // --- channel markers (BACKLOG "Channel markers"; v2/sim/channelMarks.js): Emerald Bay's entrance buoys and the bay's no-wake buoys
  // from one file; each a light body on its rode in the boat's tick (a bump: an impulse, the thud, no damage); drawn (render/navAids.js:
  // one pipeline, the boat effects' group) while the eye is within AID_NEAR_M; the lit ones flash on the night's list ---
  const aidBodies = createMarkBodies(aids, { onBump: (e) => beds?.cue('thud', { v: e.speed, mat: 'sand' }) });
  if (B?.sea?.addPost && aids.length) B.sea.addPost((st, dt, t) => aidBodies.post(st, dt, t));
  if (B?.sea?.addPost && moorings.length) B.sea.addPost((st, dt, t) => ballBodies.post(st, dt, t));
  // the boats at anchor and the busy lake (living/lakePlugins.js ANCHORED, BUSY_LAKE): made here, in the boat's tick below (the posts in
  // their old order: the anchored boats, the glass boat, the busy lake), on the rival slots in fill.boats
  plugins.create('anchorage');
  // the glass boat: a first birth places her to be seen within a minute (sim/tourBoat.js birthPhase); a later move never re-places her
  plugins.run('boat');   // the glass boat in the boat's tick: her run, the yield, the bump (living/lakePlugins.js)
  const AID_NEAR_M = 2500, aidPoses = aids.map(() => null), aidWat = (x, z) => water.heightAt(x, z);
  let aidsNear = 0, ballsNear = 0;
  const fillAids = () => {
    aidsNear = 0;
    if (!navAidsFx) return;
    for (let i = 0; i < aids.length; i++) { const b = aidBodies.bodies[i]; aidPoses[i] = Math.hypot(b.x - eye[0], b.z - eye[2]) < AID_NEAR_M ? markPose(b, aidWat) : null; if (aidPoses[i]) aidsNear++; }
    navAidsFx.begin();
    for (let i = 0; i < aids.length; i++) {
      const p = aidPoses[i], m = aids[i];
      if (p) navAidsFx.put(AID_KIND[m.shape] ?? 'aidCan', p.x, p.y, p.z, m.face, p.heel * Math.cos(p.yaw), p.heel * Math.sin(p.yaw), AID_RGBA[m.colour] ?? AID_RGBA.white, parseInt(m.number, 10) || 0, m.phase);
    }
    ballsNear = 0;   // the mooring balls near the eye, bobbing on the drawn water
    for (let i = 0; i < moorings.length; i++) {
      const b = ballBodies.bodies[i];
      if (Math.hypot(b.x - eye[0], b.z - eye[2]) >= AID_NEAR_M) continue;
      const p = markPose(b, aidWat), m = moorings[i];
      if (navAidsFx.put('mooringBall', p.x, p.y, p.z, m.face, p.heel * Math.cos(p.yaw), p.heel * Math.sin(p.yaw), AID_RGBA.white, 0, m.phase)) ballsNear++;
    }
    navAidsFx.end();
  };
  // --- end channel markers ---
  plugins.run('attach');   // the fireworks: the show's wind, the solids in the boat's tick, a bump's thud; kayaks: the boat, the clocks, the launch, the residents; Tessie: the race and the stage's hold, then play as Tessie (living/lakePlugins.js)
  // --- the stage (v2/stage/director.js, v2/stage/acts.js): the kayak pair at the start, Tessie
  // about 25 s, the osprey's dive about 95 s, then random acts every 60–150 s, one at a time. Off in a race; in a capture only
  // when ?stage=<act> pins one (?tessie=<s> or =1 in a capture pins her, as before); ?stage=off none ---
  const stageOpt = stageOptions({ flags, headless: !!P.headless });
  let stageStore = null; try { stageStore = globalThis.sessionStorage ?? null; } catch { /* blocked: the opening plays each load */ }
  const stage = B ? createStageDirector({
    seed: P.seed, isOn: (f) => feature(f).on, enabled: !P.headless, pin: stageOpt.pin, storage: P.headless ? null : stageStore,
    overrides: stageOpt.overrides,
    race: () => !!regatta?.on, cruise: () => !!cruise?.on,
    near: (id, withinM = 0) => { const ar = areaOf(id), b = B.state; return !!ar && !!b && Number.isFinite(b.x) && distToArea(ar, b.x, b.z) <= withinM; },
    ctx: { kayaks: plug('kayaks'), tessie, birds: plug('birds'), boat: () => B.state, beat: () => birdBeat },
    // busy: the player's hands are full (a knockdown warning, the chart open, tacking, by a mooring or a pier) or a kayaker is by
    // the boat (the first pair laid when play starts): a due act waits up to 20 s, then is skipped
    busy: () => {
      const s = B.state;
      if (B.kdWarn?.()) return 'knockdown';
      if (tessie?.revenge?.active) return 'tessie';   // TK: her revenge holds the stage
      if (m4.ui?.chart?.chart?.toggle?.big) return 'chart';
      if (Math.abs(s.yawRate ?? 0) > 5 * DEG || B.carryKeep) return 'tacking';
      if (sea?.linesUp?.()) return 'docking';
      { const K = plug('kayaks'); if (K?.fleet && K.fleet.marks().some((m) => Math.hypot(m.x - s.x, m.z - s.z) < 45)) return 'kayaks'; }
      return null;
    },
  }) : null;
  // --- end stage ---
  // the hands: v1's keys (A/D ←/→ the helm, W/S ↑/↓ the sheets), the phone's strip and buttons, v1's one-finger tiller and rope on the water
  const keys = new Set();
  if (B && !P.headless) {
    addEventListener('keydown', (e) => { if (CODES.includes(e.code)) { keys.add(e.code); e.preventDefault(); } else if (HELD_CODES.includes(e.code) && !e.ctrlKey && !e.metaKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) keys.add(e.code); });   // DRV-1: the trim keys and Shift held too (not the page's own: no preventDefault)
    addEventListener('keyup', (e) => { keys.delete(e.code); });
    addEventListener('blur', () => keys.clear());
  }
  const touchOn = feature('touchHands').on;   // src/core/features.js: a finger's canvas hands (?touch=1|0)
  if (touchOn) { const st = document.createElement('style'); st.textContent = TOUCH_CSS; document.head.appendChild(st); document.body.classList.add('hands'); }
  // the phone pass: iOS Safari ignores the viewport's maximum-scale; its own pinch (gesturestart, Safari only) is stopped so a
  // two-finger look over a button never zooms the page (touch-action: none on the canvas covers the rest)
  if (!P.headless) for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  const hands = B ? createTouch({ canvas, show: touchOn, oneLook: () => document.documentElement.classList.contains('lk-flat') }) : null;   // a phone's flat controls: one finger on the water looks
  const handsNow = { steer: 0, pull: 0, orbit: null, zoom: 0, trim: null };
  function readHands(dt = 0) { const k = keysToAxes(keys), h = hands.read(dt), s = sumHands(k, h); handsNow.steer = s.steer; handsNow.pull = s.pull; handsNow.orbit = h.orbit; handsNow.zoom = h.zoom; handsNow.trim = keysToTrim(keys, { pro: !!B.pro }); return m4.takeLook(handsNow); }   // DRV-1, DRV-2: R/F and the Pro trim keys (the boat reads them with Pro)   // #5: the drag aims the binoculars while they are up
  // the camera: the follow camera on the boat unless the URL pins v1's preset or a viewpoint (?cam, ?campos: the goldens)
  const pose = cameraPose(flags);
  const followOn = !!B && flags.cam == null && flags.campos == null;
  const eye = pose.eye, fwd = pose.fwd, up = [0, 1, 0];   // M4: up (the helm view's horizon tilts with the boat)
  let fovDeg = pose.fovDeg;
  // M3b: v1's capture-only close shots (?shot=cockpit-astern …: v2/sim/shots.js) ride the drawn pose instead of the follow camera
  let near = pose.near;
  const menuDrift = createMenuDrift(); let menuEl = null;   // step D1 (ui/menuDrift.js)
  // the boat's points the intro keeps in the band: the truck, the bow and the stern at the waterline, the beam at the waterline, the wake's
  // first 3 m astern (hull frame: x starboard, y up from the waterline, z aft)
  const INTRO_PTS = [[0, DEFAULT_DIMS.HULL.mastStepY + DEFAULT_DIMS.RIG.mastTop + 0.05, DEFAULT_DIMS.HULL.mastStepZ], [0, 0, DEFAULT_DIMS.HULL.stemZ], [0, 0, DEFAULT_DIMS.HULL.transomZ],
    [DEFAULT_DIMS.HULL.beam / 2, 0, 0], [-DEFAULT_DIMS.HULL.beam / 2, 0, 0], [0, 0, DEFAULT_DIMS.HULL.transomZ + 3]];
  const introFit = (c) => ndcYMax(c, INTRO_PTS.map((p) => hullToWorld(B.pose, p)));
  function placeCamera(dt) {
    let cp = cruise?.on ? cruise.camera(dt) : null;   // Cruise: the rig's pose (v1's five cameras), the binoculars over it
    // Cruise in the show (owner, 2026-11-15): the rig's shot turned toward the bursts, eased in and out; a drag or the
    // binoculars (the player's own look) win; Above (the chart's view) does not turn
    if (cp) cp = plugins.reduce('camera.cruise', cp, dt, () => ({ simT: clock.t - P.t0, hour: clock.hour, input: !!(handsNow.orbit && (handsNow.orbit[0] || handsNow.orbit[1])) || !!m4?.captain?.binoUp, off: cruise.view?.() === 'above' }));
    // M3: Cruise's cut to Tessie (she appears: the shot turns to her at most 15°/s, eased, holds, returns; a drag, the binoculars
    // or the chart's Above view send it back)
    if (cp && tessie) cp = tessie.cruiseCamera(dt, cp, { input: !!(handsNow.orbit && (handsNow.orbit[0] || handsNow.orbit[1])) || !!m4?.captain?.binoUp || cruise.view?.() === 'above' });
    let c = cp ? m4.overlay(dt, cp) : (flags.shot && shotPose(flags.shot, B.pose)) || m4.camera(dt, regatta?.on ? regatta.camera(dt, B.camera(dt)) : (gust ? gust.lean(dt, B.camera(dt), B.state) : B.camera(dt)));   // Regatta: the race camera before the gun   // M4: the views (follow | helm, the move between)
    if (!cp && cruise) c = cruise.blendSail(dt, c);   // after Cruise's hand-over: Sail's pose eased in from the one on screen
    if (!P.headless) { menuEl ??= document.getElementById('lk-load'); c = menuDrift.step(dt, !!menuEl && menuEl.dataset.state === 'menu' && !menuEl.hasAttribute('data-off') && !menuEl.dataset.pg, c, { reduced: reducedNow() }); }   // step D1: the Menu card over the live lake: a gentle drift
    if (tessie && !cp && !B?.sea?.bowLook) c = tessie.camera(dt, c);
    if (regatta?.on) c = plugins.reduce('camera.race', c, dt, { input: !!(handsNow.orbit && (handsNow.orbit[0] || handsNow.orbit[1])) });   // Pass the Channel's salute in the frame
    if (intro.playing && B) c = intro.camera(c, introFit, bandShare(canvas.width, canvas.height));
    c = player.camera(dt, c, handsNow.orbit);   // the played seam (play as Tessie): behind her neck (and the swap's glide either way)   // the intro: the lens widened so the whole boat sits in the letterbox's band, a slow push-in   // not while the anchor's bow look holds (it turned the view up to 20° off the bow)   // Tessie: the first sighting's assist (no input for 3 s: the aim eases toward her, any input ends it)
    near = c.near ?? pose.near;
    const u = c.up ?? [0, 1, 0]; up[0] = u[0]; up[1] = u[1]; up[2] = u[2];
    eye[0] = c.pos[0]; eye[1] = c.pos[1]; eye[2] = c.pos[2];
    const dx = c.target[0] - c.pos[0], dy = c.target[1] - c.pos[1], dz = c.target[2] - c.pos[2], l = Math.hypot(dx, dy, dz) || 1;
    fwd[0] = dx / l; fwd[1] = dy / l; fwd[2] = dz / l; fovDeg = c.fov;
  }
  const view = mat4(), proj = mat4(), viewProj = mat4(), invVP = mat4(), splitProj = mat4(), splitVP = mat4(), splitInv = mat4();   // split*: play as Tessie's other side, its near plane at the lens
  const sunNow = { x: 0, y: 1, z: 0, elevDeg: 0, azDeg: 0 };
  const windNow = { speedMs: 0, dirDeg: 0, travelRad: 0, regime: '' };
  const windOpt = { hour: P.hour, seed: P.seed, level: P.windSpeed != null || P.windDir != null ? P.windLevel : P.windLevel ?? DEFAULT_WIND_LEVEL, speedMs: P.windSpeed, dirDeg: P.windDir };
  let bandNow = 0;   // the Milky Way's level this frame (v2/sim/night.js nightLevels band): the day clock's night-sky line
  let moonShareNow = 0;   // M5e: the moon's share of its full light this frame (the exposure comes down under it)
  let stormDarkNow = 0;   // fix(v2) frame look: the storm's dark this frame (the exposure never under M2's adaptation in a storm: sim/exposure.js stormExposure)
  const expNow = () => stormExposure(exposureFactor(P.exposure, sunNow.elevDeg, undefined, moonShareNow), P.exposure, sunNow.elevDeg, moonShareNow, stormDarkNow);
  // --- M5e plug-in: the storm (v2/sim/storm.js on src/sim/weather/stormSim.js): the arc on the scene clock, the outflow on
  // this wind field, the strikes; v1's URL rows start it (?weather=storm&stormt=…), ?storms=natural lets one come; the top
  // bar's Weather menu (Clear | Fair | Storm) eases the deck's coverage and starts or sends away the storm; the thunder on
  // the page's sound (v2/engine/audio.js: made in the first gesture; a capture is silent) ---
  const storm = !stormSim ? createStormOff() : stormSim.createStorm({ windField, seed: P.seed, now: () => clock.t, eye: () => eye, sunDir: () => sunNow, sunElev: () => sunNow.elevDeg, exposure: expNow, deck: clouds.deck });
  const bowNow = () => (rainbowOn ? storm.weather.bowAmt : 0);
  // the one wind for the weather (sim/weatherWind.js): read once a frame at the eye, after the storm's step; the rain's lean, the
  // deck's drift and (later) the gulls' calls read it; a look per weather (sim/weatherLook.js) and the lens's water, both on the scene clock
  const weatherWind = createWeatherWind({ field: windField });
  const wlook = createWeatherLook({ force: flags.wlook ?? null });
  const lensWater = createLensWater(), lensRec = { amount: 0, gx: 0, gy: 1, wet: 0 };
  const lensPolicy = feature('lensRain').on && stormOn;   //: no storm, no rain on the lens (a phone)
  const camVel = [0, 0, 0]; let camWas = null, camT = null;   //: the rainbow's amount the composite draws (0 on a phone)
  storm.begin({ natural: flags.storms === 'natural' });
  const stormUrl = stormSim ? stormSim.stormFromParams(flags) : null;   // a phone: ?weather=storm is skipped
  if (stormUrl) storm.start({ s0: stormUrl.s0, rate: stormUrl.rate, ref: stormUrl.ref, t0: clock.t });
  const deckCover = { value: clouds.deck.coverage };
  const wx = weatherMenu({ storm: stormSim ? storm : null, deck: deckCover, sky: cloudMode !== 'off' && flags.clouds !== false });   // a phone: no Storm row (the top bar's, Setup's, Cruise's)
  // the clear night (owner, 2026-11-18: "Maybe at night we don't need clouds?"; sim/night.js nightCover): under Clear and Fair the deck
  // thins away from the sunset to the sun's -5 deg, the show's sky is clear; a storm, Cloudy and a URL's ?cloudcov keep theirs. coverNow:
  // the deck drawn this frame (the night-sky line reads it too)
  const coverExplicit = flags.cloudcov != null && Number.isFinite(flags.cloudcov);
  let coverNow = deckCover.value;
  const coverAt = () => nightCover({ cover: deckCover.value, sunElevDeg: sunNow.elevDeg, sky: wx.current(), storm: !!storm.running, show: plugins.first('show.t') != null, explicit: coverExplicit });
  lmStart('audio');
  const audio = createAudio({ live: !P.headless });
  // refactor round 3 B6a: the page's and the birds' AudioContexts made after the first frame, at the first idle moment behind the home
  // card (suspended; the ENTER gesture only resumes them), not in the ENTER click (101 ms of a 167 ms frame in headless Chrome)
  const prepareAudio = () => { const go = () => { audio.prepare(); plugins.run('audio.prepare'); }; if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2000 }); else setTimeout(go, 500); };
  let thunder = null;
  if (stormAudio) audio.ready.then(({ ctx, master }) => { thunder = stormAudio.createThunder(ctx, master); });
  plugins.run('audio', audio); plugins.run('audio.late', audio);   // kayaks: a capsize's splash (v2/living/kayaks-sound.js); Tessie: her synthesised breath, water and splashes (v2/living/tessie-sound.js); the glass boat
  // step 3: the beds (v2/audio/bedsLive.js), live pages with a boat only; their input from the sim each frame (bedsInput, also the
  // harness's: tools/v2-beds-film.mjs records it and renders the sound offline)
  // --- music (v2/audio/music.js): v1's pieces at v1's times and moods, streamed; the groove's swell from v1's boat engine; the bar's
  // Music; Settings' sound, music and effects; M; Cruise's playlist by music.setMode('cruise'). Live pages only, not a ?filmui=1
  // film (v1's goldens film muted) or ?music=0; nothing loads before the first gesture and the first frame ---
  if (musicOn) setStreamMusic(true);
  const music = musicOn ? createMusic({ audio, settings: pageSettings(), seed: P.seed, musicSeed: visitSeed(flags), base: new URL('audio/', document.baseURI).href, race: () => !!regatta?.on }) : null;   // Shuffle by default (Setup › Sound › music); a race keeps the beds' scheduler
  if (music) {
    musicDoor.bind(music, pageSettings());
    plugins.run('music', music);   // the birds' own door: the sound switch and M mute it too
    arriveOnEntry(music, { cardUp: () => ['company', 'home', 'menu', 'attract'].includes(document.getElementById('lk-load')?.dataset.state) });
    // (M went with the lean key set,: the sound switch is Conditions › Sound)
  }
  // --- end music ---
  const beds = B && !P.headless ? createBedsLive({ audio, settings: pageSettings(), seed: P.seed, base: new URL('audio/', document.baseURI).href, groove: music ? (t) => music.groove(t) : null, waveHit: flags.wavehit, speedFeel: flags.speedfeel !== false, rain: stormOn }) : null;
  const engineSound = sea && (music || beds) ? createEngineSound({ core: music?.core ?? null, beds, base: new URL('audio/', document.baseURI).href }) : null;   // #14, #8: the engine and the chain (v1: audio.attach on the effects bus)
  const anchorSound = sea && (music || beds) ? createAnchorSound({ core: music?.core ?? null, beds, base: new URL('audio/', document.baseURI).href }) : null;   // the anchor seen: the clunk, the rattle, the splash (the engine's bus)
  if (sea && anchorSound) sea.hooks.onAnchor = () => anchorSound.prime();
  hook.anchorSound = () => anchorSound;
  lmEnd('audio');
  const bedsIn = { t: 0, wallT: 0, state: null, pitch: 0, heelDrawn: 0, bowRelVel: 0, earWind: 0, pan: 0, rain: 0, camDist: 20, shoreDist: 400, hour: 12, sheet: null, pull: 0, rudder: 0, steer: 0, kdRoll: 0 };
  function bedsInput() {
    const s = B.state, w = windField.sample(eye[0], eye[2], B.t), a = s.apparentWind ?? { speed: 0, angle: 0 };
    const th = s.heading + a.angle, rl = Math.hypot(fwd[0], fwd[2]) || 1;   // the air's travel angle (atan2(-x, z)); the camera's right (-fz, 0, fx)
    Object.assign(bedsIn, { t: B.t, wallT: livingNow(), state: s, pitch: B.pose.pitch ?? s.pitch ?? 0, heelDrawn: B.pose.heel ?? s.heel ?? 0, bowRelVel: B.ride.wave?.bowRelVel ?? 0, earWind: w.speed ?? a.speed,
      pan: (Math.sin(th) * -fwd[2] - Math.cos(th) * fwd[0]) / rl, rain: storm.weather.rain ?? 0, camDist: Math.hypot(eye[0] - s.x, eye[1], eye[2] - s.z), hour: clock.hour,
      sheet: B.ctl.sheet ?? null, pull: handsNow.pull, rudder: B.ctl.rudder ?? 0, steer: handsNow.steer,
      gustEvents: gustNow?.events ?? null, rushMul: gustNow?.rushMul ?? 1,   // audit W4: v1's sail-fill snap and the rising rush
      kdRoll: B.knockdownOn ? kdRoll(B.pose.heel ?? 0) : 0,
      dip: tessie ? tessie.dip() : 1 });   // TK: the wind and water dip under her drone (1: as they are)   // K2: the knockdown's sound (v2/audio/knockdownSound.js; 0 under 40°)
    return bedsIn;
  }
  const windStorm = { speedMs: 0, dirDeg: 0, travelRad: 0, gain: 1 };
  // --- end M5e plug-in ---
  // --- Cruise (BACKLOG-v2 #11: v2/cruise, its own chunk): the mode switch the card and the hand-over use; the autopilot's step and
  // the rig's camera take the frame while Cruise has the boat (simFrame, placeCamera) ---
  // (cruise, cruiseP, streamDone, navSailTg, autoNavP: declared at the top, after cruiseBoot: the passes and the stage read cruise)
  // the pilot head's AUTO to a target (v2/sim/autoNav.js): Cruise's navigator and skipper on the whole-lake chart, in Sail; its own chunk,
  // loaded when a target first shows (ui/autopilot.js)
  const autoNavLoad = () => (autoNavP ??= Promise.all([import('./sim/autoNav.js'), import('./ui/planChart.js')]).then(async ([{ createAutoNav }, { loadPlanChart }]) => {
    const chart = await loadPlanChart();   // the planner's whole-lake chart (baked: no wait for the heights), one load for the page
    return createAutoNav({ B, chart, sun: () => sunNow.elevDeg, seed: P.seed });
  }).catch((e) => { errors.push(`autoNav: ${e?.stack ?? e}`); autoNavP = null; return null; }));
  const streamWhole = new Promise((r) => { streamDone = r; });
  const cruiseLoad = () => (cruiseP ??= CRUISE.chunk().then(({ createCruise }) => {
    cruise = createCruise({ B, windField, clock, terrain, kayaks: plug('kayaks'), tBase, manifest: fullM, flags, P, m4, canvas,
      sun: () => ({ elevDeg: sunNow.elevDeg, x: sunNow.x, y: sunNow.y, z: sunNow.z }), aspect: () => canvas.width / Math.max(1, canvas.height),
      view: () => ({ pos: [...eye], target: [eye[0] + fwd[0] * 10, eye[1] + fwd[1] * 10, eye[2] + fwd[2] * 10], up: [...up], fov: fovDeg, near }),
      hands: () => handsNow, onMode: (m) => modes.landed(m), music, weather: wx, birth: () => cruiseBirth(), stars: () => ({ band: bandNow, coverage: coverNow, storm: !!storm.running, sun: sunNow.elevDeg }) });   // stars: v1's night-sky line in Cruise's quiet line   // music: Cruise's playlist (v2/audio/music.js setMode)
    if (!P.headless) Promise.all([cruise.ready, m4.uiReady]).then(([, u]) => { if (u) cruise.mountUi(u); }).catch((e) => errors.push(`cruise: ${e?.stack ?? e}`));
    return cruise;
  }));
  // --- Regatta (BACKLOG-v2 #12: v2/regatta, its own chunk, loaded only when a race is asked for): the session, the helper, the
  // race camera and the plates take the frame while a race is on (simFrame, placeCamera, fill); off, nothing of it runs ---
  // (regatta, regattaP: declared at the top, after raceBoot: the passes, the stage and Tessie read regatta)
  const raceLit = new Float32Array(24 * 8);   // step D: the lit marks' glow records (render/night.js CAPS.race × GLOW_FLOATS: a race's 12, then the channel's lamps)
  let raceLitOn = true;   // hook.raceLit(false): the lit marks off in place (tools' A/B of their cost)
  const regattaLoad = () => (regattaP ??= (pipeQ.now(RACE_PIPE), Promise.all([REGATTA.chunk(), raceKit()])).then(([{ createRegatta }]) => {   //: the props and lines with it   // perf(v2) iOS pipelines: the race's group first
    regatta = createRegatta({ B, windField, clock, terrain, water, flags, P, canvas, lines: raceLines, props: raceProps, audio, boat: boatR, gpuLite: () => feature('fleetDetail').tier === 'lite' || !!raceQ?.fleetLite, sailHud: { enter: () => m4.ui?.services?.get('chart')?.setMode?.('cruise'), leave: () => m4.ui?.services?.get('chart')?.setMode?.('sail') },   // R4: Sail's passage plan steps aside in a race   // R4: the near rivals on the boat's slots; the phone's LOD bands at L2 and L3
      onMode: (m) => modes.landed(m), onHome: () => (m4.front?.home ?? m4.ui?.services?.get('menu'))?.open?.(),   // R3: the results card's Home opens the home card
      sky: (id) => wx.pick(id), onLeave: () => modes.go(homeId()), lean: () => m4.ui?.services?.get('lean') ?? null,
      // place races: the barges' salute on the page's fireworks (none on a phone: false, the horn only), Tessie's plug-in
      onSalute: () => plugins.some('race.salute'), tessie: () => tessie ?? null,
      // phase 2: the glass boat's sim for Glass Boat Chase (none on a phone), the page's storm for Storm Run (started at the
      // gun on the race's arc; null sends it away), Reduce Motion for the camera's Tessie look, the device's needs
      glassBoat: () => plug('tour')?.sim ?? null, onStorm: (o) => { if (!feature('storm').on || !stormSim) return false; if (!o) { storm.stop(); return false; } storm.start({ s0: o.s0, rate: o.rate, ref: o.ref, t0: clock.t }); return true; },
      reduced: () => reducedNow(), has: hasFrom(feature) });   // the lean skipper rules the coach's card too (owner 2026-11-17)   // the front door: the hand's sky on the Weather menu's state; the hub's Esc back to the lake
    return regatta;
  }));
  // --- end Regatta ---
  // --- the cups' hunts (owner go 2026-11-19): Chart the Bay and Chart the Mouth, eight corners each, found by
  // sailing there in any mode (v2/regatta/hunts.js); a live page only (a capture keeps none: the goldens' charts are unchanged). Their
  // corners on the live chart (◇, filled once found: sail.js corners), the Logbook's corners page and the hub's count read the 'hunts'
  // service; the boat's state is read at 4 Hz ---
  let hunts = null, huntT = 0;
  if (B && !P.headless) {
    let ls = null; try { ls = globalThis.localStorage; } catch { /* blocked: this page only */ }
    const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };   // the find's day (the Logbook's date), not the scene's clock
    hunts = createHunts({ store: ls, day });
    hunts.onChange((found) => { for (const c of found) m4.ui?.hint?.flash?.(`${c.name}: a corner for your logbook`, { secs: 4, kind: 'hunt.found' }); });
    m4.uiReady.then((u) => u?.services?.provide?.('hunts', hunts)).catch(() => {});
  }
  const huntQ = { x: 0, z: 0, heading: 0, sog: 0, twaDeg: 0, windLevel: 0, depth: 0, sunElevDeg: 90, bino: null, moored: false, engine: false, tessie: null, glass: null }, huntTess = { x: 0, z: 0 }, huntGlass = { x: 0, z: 0, fast: false };
  function huntStep(dt) {
    if (!hunts || !B) return;
    huntT += dt; if (huntT < 0.25) return;
    const q = B.phys.state, st = sea?.state, ts = tessie?.sim?.state, T = plug('tour')?.sim;
    huntQ.x = q.x; huntQ.z = q.z; huntQ.heading = q.heading; huntQ.sog = q.sog ?? Math.hypot(q.u ?? 0, q.v ?? 0); huntQ.twaDeg = (q.trueWind?.angle ?? 0) / DEG;
    huntQ.windLevel = windField.level ?? 0; huntQ.depth = -terrain.field.height(q.x, q.z); huntQ.sunElevDeg = sunNow.elevDeg;
    huntQ.bino = m4.ui?.services?.get?.('captainTools')?.aim ?? null; huntQ.moored = st?.mode === 'moored'; huntQ.engine = st?.engine === 'running' || st?.engine === 'cranking';
    huntQ.tessie = ts?.visible && ts.centre ? (huntTess.x = ts.centre[0], huntTess.z = ts.centre[1], huntTess) : null;
    huntQ.glass = T?.active && T.boat ? (huntGlass.x = T.boat.x, huntGlass.z = T.boat.z, huntGlass.fast = !!tourSegAt(T.loop, T.boat.s)?.fast, huntGlass) : null;
    hunts.step(huntQ, huntT); huntT = 0;
  }
  // the card's picks (v2/ui/front.js) and `: the page's mode switch (v2/ui/modeSwitch.js): a switch keeps her where she is (MODE-6, v1's
  // start=x,z&heading=); Regatta from either: in the box at −0:45 (v2/regatta); the clock, Pro and the game speed per mode
  let metricMode = bootId;   // mode_change's from
  const sailClock = createSailClock({ track, visible: () => document.visibilityState !== 'hidden' });   // sailed_2min: visible play time since the card was left (v2/ui/engagement.js)
  addEventListener('lakeshore:entered', () => sailClock.enter(metricMode), { once: true });
  const modes = createModeSwitch({ initial: bootId, P, flags, clock, B, ready: streamWhole,
    chunks: { [CRUISE.id]: { load: cruiseLoad, get: () => cruise }, [REGATTA.id]: { load: regattaLoad, get: () => regatta } }, ui: () => m4.ui,
    settings: () => pageSettings(), onMode: (m) => { if (m !== metricMode) track('mode_change', { from: metricMode, to: m }); metricMode = m; sailClock.mode(m); m4.front?.home?.setMode?.(m); B?.setReef?.(reefStore.get(m), { silent: true }); }, target: B && !P.headless ? window : null });
  hook.mode = modes;
  // the fireworks scene faces the show (owner, 2026-11-18): a Sail cut landing in the show's window (the Fireworks pick, or a time
  // pick that lands in it) turns the boat where she is to face the barges, her speed kept (from the start: the mouth dead ahead)
  if (plugins.runs('start.pose') && B) clock.onCut(({ to }) => {
    if (modes.current !== homeId() || regatta?.on) return;
    const show = plugins.first('start.pose', to, { cut: true });
    if (!show) return;
    const s = B.state; B.place({ x: s.x, z: s.z, headingDeg: show.facing(s.x, s.z, windField.dirAt(s.x, s.z, clock.t)), speed: Math.max(0, s.u ?? 0) });
  });
  modeNow = () => modes.current; proNow = () => (m4.ui ? !!B?.pro : proWanted(flags, pageSettings()));   // Sail's shifts follow the live mode and Pro (Sail's UI holds it once it is in)
  // the reef selector, one state per mode (ui/autoReef.js): the mode's saved or default value on the boat; a change is saved for the mode on screen
  const reefStore = createReefStore();
  if (B) { B.setReef(reefStore.get(modes.now()), { silent: true }); B.onReef = (v) => reefStore.set(modes.now(), v); }
  // --- end Cruise ---
  // --- K3: the knockdown ends the sail. The warning (the skipper's line, REEF amber, the phone's sheet ring), then
  // at the knockdown the frame slows and the logbook card comes (ui/endCard.js), then the menu card; Start again puts her back at
  // the mode's start with the same weather. Regatta: a DNF in that race (the race's own results card); Cruise: never ---
  const kdGame = B?.knockdownOn ? createKnockdownGame() : null;
  let kdLook = true;   // the look's A/B switch (hook.setKnockdownLook)
  let kdMenuWas = false;   // the menu card was up over the end card last frame
  let endCard = null, endModP = null;   // ui/endCard.js: fetched at the first knockdown
  const kdSay = (line) => { if (line) m4.ui?.hint?.flash?.(line, { secs: 4, kind: 'knock.warn' }); };   // knock.warn: the lean skipper's MUST (v2/ui/leanSkipper.js): it always shows, over any line, mid-manoeuvre too; a phone keeps it
  function kdAgain() {   // Start again: the same mode at its start, the same weather (the wind field, the storm and the clock untouched)
    kdGame.again(); endCard?.hide(); m4.ui?.hint?.hush?.(false);
    const home = m4.front?.home; if (home?.isOpen) home.close();
    if (isRace(modes.current)) { regatta?.restart?.(); return; }
    B.place({ x: startPose.x, z: startPose.z, headingDeg: startPose.headingDeg ?? START.headingDeg ?? 0, speed: START.speed ?? 0 });
  }
  const kdModes = kdGame ? new Proxy(modes, { get: (t, k) => (k === 'go' ? (id) => { if (kdGame.state !== 'sailing') { if (id === t.current) { kdAgain(); return true; } kdGame.again(); endCard?.hide(); m4.ui?.hint?.hush?.(false); } return t.go(id); } : t[k]) }) : modes;   // the menu card after a knockdown: the current mode starts again
  if (kdGame && !P.headless) for (const ty of ['pointerdown', 'touchstart', 'mousedown', 'pointerup', 'mouseup', 'click']) addEventListener(ty, (e) => { if (endCard?.press(e)) e.stopImmediatePropagation(); }, true);   // the end card's own presses, before the menu card's outside-press closer (registered later) eats them
  if (kdGame) {
    B.kdWarn = () => kdGame.warnOn;
    B.onKnockdownWarn = (e) => { if (tessie?.revengeCause?.()) return; kdSay(kdGame.warn(e, modes.current)); };   // TK: her tail sweep gives no warning to act on
    B.onKnockdown = (e) => { if (player.played) return;   // a played thing (Tessie): the Halcyon knocked while you are it is play, no end card
      if (isRace(modes.current) && regatta?.placeKnock?.(e)) return;   // a place race: 12 s held, no game end; a second knock ends the race below
      if (tessie?.revengeCause?.()) { e = { ...e, cause: 'tessie' }; B.capsize?.(true); }   // TK: her tail sweep rolled her ("Tessie said no."); she stays capsized behind the card (owner, 2026-11-20) until Start again
      if (kdGame.knock(e, modes.current)) { endModP ??= import('./ui/endCard.js'); if (knockOf(kdGame.mode) !== 'race') m4.ui?.hint?.hush?.(true); } };   // the skipper says nothing more once she is over (no "steer", no "freeing her" under the card)
    B.onPlaced = () => { if (kdGame.state !== 'sailing') { kdGame.again(); endCard?.hide(); m4.ui?.hint?.hush?.(false); } };   // a race laid again, Cruise's place: sailing again
  }
  // --- the birthplaces' service (73 § 2): the UI's list, pick and "Sail from here" (hook.birthplaces; the UI's
  // 'birthplace' service once Sail's UI is in). A move: the time pick's veil out, B.place on the rule's pose (Cruise: its voyage
  // placed there), the fan-out (the kayaks' first pair, the first gust, the stage quiet 15 s, the passage's leg, the binoculars
  // down; the player's chart target stays), the veil in. Never in a race or while knocked down ---
  const birthplaces = B ? createBirthplaces({
    waters: CURRENT_WATERS, settings: pageSettings(), seed: birthSeed, current: sailBirth ? birthRow.id : null,
    windAt: birthWind, depthAt: birthDepth, showAt: birthShow,
    veil: (op, secs) => sea?.hooks?.veil?.(op, secs), hasVeil: () => !!sea?.hooks?.veil,
    reduced: () => !P.headless && reducedNow(),
    canMove: () => (regatta?.on ? 'race' : kdGame && kdGame.state !== 'sailing' ? 'knockdown' : null),
    place: (pose) => {
      const p = { x: pose.x, z: pose.z, headingDeg: pose.headingDeg, speed: pose.speed };
      if (cruise?.on && cruise.voyage) cruise.voyage.place({ ...p, speed: 2.5 }); else B.place(p);
      birthCam(pose);   // the hero on screen, then the chase eases back
      if (!cruise?.on) relayGust(windField, p, { t: B.t, flags });   // the first gust ahead of the new pose (Sail's wind has one; Cruise's none)
      plug('kayaks')?.relay(p);
      stage?.quiet(BIRTH.quietS);
      const svc = m4.ui?.services;
      svc?.get?.('passage')?.replan?.();   // the leg to the player's own target from here (the target itself stays)
      svc?.get?.('captainTools')?.setLatch?.(false);   // the binoculars down
      Object.assign(startPose, p);   // Start again (after a knockdown) goes back here
    },
  }) : null;
  // Cruise takes the player's own pick as the voyage's first pose; a first visit with no pick keeps Cruise's chooseStart
  cruiseBirth = () => (birthplaces && birthAt && birthAt.source !== 'first' ? birthplaces.pose(birthplaces.current ?? birthAt.id) : null);
  hook.birthplaces = birthplaces;
  if (birthplaces) {
    // the card's pins (Phase 1b): a pick on the first card (the loading shell still over the lake) moves her there at once, no
    // veil; a move in play (the card's pins, the chart's Sail from here) is the veiled moveTo and leaves one logbook line
    birthplaces.on('pick', (e) => { const st = m4.front?.home?.state; if (st === 'home' || st === 'company') birthplaces.moveTo(e.pick, { instant: true }); });
    birthplaces.on('moved', (e) => { const st = m4.front?.home?.state; if (st !== 'home' && st !== 'company') m4.ui?.services?.get?.('logbook')?.logbook?.note?.(`Moved to ${e.name}`); });
  }
  // Menu on the end card (its button, or Esc): the menu card opens and the end card goes (owner 2026-11-17: the card alone; the menu
  // card only when asked for)
  function kdMenu() { endCard?.hide(); m4.front?.home?.open?.(); }
  if (kdGame && !P.headless) addEventListener('keydown', (e) => { if ((e.code === 'Escape' || e.key === 'Escape') && !e.repeat && endCard?.isOpen) { e.stopImmediatePropagation(); e.preventDefault(); kdMenu(); } }, true);   // before the home card's own Esc (registered later)
  let cardGraceS = 0;   // seconds since the home card went (0 while it is up)
  function kdFrame(dt) {   // each frame before the boat's step: the time scale, the card and the menu when due
    // the first card up, and the first 10 s after it: the gennaker crew's clocks wait for the player, so the first sail's intro line (1.5 s in,
    // 7 s long) is not cut by "Gennaker up!" (the crew had been counting behind the card since the first frame)
    const homeSt = m4.front?.home?.state;
    cardGraceS = homeSt === 'home' ? 0 : cardGraceS + dt;
    B.gennakerCrew = { card: homeSt === 'home' || (homeSt != null && cardGraceS < 10) };
    if (!kdGame) return 1;
    const o = kdGame.frame(dt);
    if (o.card) {   // the card's module was asked for at the knockdown (never at boot: a chunk landing mid-film moves the goldens)
      const ev = kdGame.event ?? {}, log = { ...kdGame.log }, hour = clock.hour, mode = kdGame.mode;
      endModP.then((m) => {
        const model = m.endCardModel({ cause: ev.cause ?? 'knockdown', event: ev, log, hour });
        hook.knockdown.card = model;
        if (knockOf(mode) === 'race') regatta?.knockdown?.(model);
        else if (!P.headless && kdGame.state !== 'sailing') (endCard ??= m.createEndCard({ onAgain: () => kdAgain(), onMenu: () => kdMenu() })).show(model);
      }).catch((e) => errors.push(`end card: ${e?.message ?? e}`));
    }
    // the menu card (opened by the card's Menu or Esc, which close the card) closed again (Esc, ×, a tap outside) while the sail has
    // ended: she starts again in the same mode (a knocked-down boat has nothing to resume; never a stopped boat with no card)
    const menuOpen = !!m4.front?.home?.isOpen;
    if (kdGame.state === 'ended' && knockOf(kdGame.mode) !== 'race' && kdMenuWas && !menuOpen) kdAgain();
    kdMenuWas = menuOpen && kdGame.state === 'ended';
    return o.timeScale;
  }
  // the look's in-page A/B on one frozen frame (tools/v2-ab-knockdown.mjs): off = no flog, no wild vane, no hull mask, no droplets drawn
  hook.setKnockdownLook = (on) => { kdLook = !!on; if (wakeFx) { wakeFx.sprayDraw = kdLook; const p = B.pose; wakeFx.setHull({ heel: p.heel ?? 0, heave: p.heave ?? 0, pitch: p.pitch ?? 0, on: kdLook && kdMix(p.heel) > 0 }); } return kdLook; };
  hook.knockdown = { game: kdGame, card: null, get endCard() { return endCard; }, again: () => kdGame && kdAgain(), gust: (o) => B?.setGust(o) };
  // --- end K3 ---
  if (B) m4.attach({ B, windField, clock, terrain, canvas, exposure: expNow, sun: () => sunNow.elevDeg, weather: wx, audio, modes: kdModes,
    world: { props: () => raceProps, raceKit: () => raceKit(), water, raceOn: () => !!regatta?.on, racePlace: async (id) => { if (!regatta?.on) await modes.go(REGATTA.id, { hub: false, deal: false }); return regatta?.racePlace?.(id) ? true : false; },   // a race pin's Race here: into Regatta with no hub, then that place race
   race: () => (regatta?.on ? { view: regatta.session?.race?.view('me') ?? null, ui: regatta.ui, aids: regatta.aids } : null), takeHelm: () => cruise?.takeHelm({ button: true }), swapMode: () => (kdGame && kdGame.state !== 'sailing' ? null : modes.swap()), warmCruise: () => modes.warm(), navTarget: () => navSailTg, autoNav: () => autoNavLoad(), kayakMarks: () => plug('kayaks')?.fleet?.marks() ?? [], sailMark: () => beacon?.mark ?? null, navAids: () => aids },   // U10, U15: the chart's kayakers; Sail's practice marks on Regatta's props pipeline (v2/ui/course.js)   // M4; M5e: the theme's sun, the Weather menu; #6: the VHF on the page's sound; Cruise: the card's modes
    music, quality: { pin: (k) => hook.quality?.pin?.(k), state: () => hook.quality?.state ?? null },   // music: the bar's Music, the skipper's voice; Setup's rows (v2/ui/setup.js)
    day: { fireworks: plugins.runs('show.t'), show: () => plugins.first('show.t'), stars: () => ({ band: bandNow, coverage: coverNow, storm: !!storm.running, sun: sunNow.elevDeg }), cue: flags.timerate == null || flags.timerate === '' } });   // the day clock's glue (ui/dayClock.js): the time menu, v1's night-sky line (not under ?timerate); the show is a time event (no evening, no target)
  if (birthplaces && !P.headless) m4.uiReady.then((u) => { u?.services?.provide?.('birthplace', birthplaces); }).catch(() => {});   // the UI's 'birthplace' service (m4's promises are the live ones here, not the early placeholders)
  if (birthplaces && !P.headless) m4.frontReady.then((f) => f?.mountBirthplaces?.(birthplaces)).catch((e) => { errors.push(`birthplace card: ${e?.stack ?? e}`); console.error(e); });   // the card's pins and the voyage line's place (v2/ui/birthplaceCard.js)
  if (B && !P.headless) { lmSpan('controls', m4.uiReady); markCardLive(Promise.all([m4.frontReady, m4.uiReady])); }   // the load report: Sail's controls in, the home card live
  // fix(v2) governor (the owner's iPhone, 2026-11-14: 60 fps held at scale 0.60 and L3, the busy span 22.5 ms with 11.7 ms
  // idle in it): with the GPU timer the cost is the GPU's work (the passes' own shares), the frames' interval says whether
  // the page holds the refresh (frames on vsync are never cut), and the scene and composite's own ms are the pixel-bound
  // part a step projects (engine/governor.js GOV_WORK)
  const gov = createGovernor({ budgetMs: 1000 / 60, start: P.scale, enabled: P.gov, ...GOV_WORK });   // #32: the no-timer path too (its cost: the work-done probe)
  const pixPasses = graph.passes.filter((p) => p.name === 'scene' || p.name === 'composite').map((p) => p.index);
  // the phone pass: the ladder above the governor (engine/quality.js): it settles the level from the first seconds' frame
  // cost and steps it when the governor is at its floor; off when pinned (?quality=), under ?gov=0 and in captures
  // #32: without a GPU timer the cost is the rAF interval (the vsync's floor on a 60 Hz phone): the work-done probe's busy span
  // tells the ladder about headroom, each decision is stored as a no-timer one (vsync), and a retry visit's time rides along
  const ladder = createLadder({ level: Q.level, enabled: P.gov && Q.source !== 'pinned', vsync: !gpu.hasTimestamps, retryAt: qStart0.retryAt ?? null, pxAt: (k) => { const [cw, ch] = sizer.css; const c = levelCaps(k, capsOpts); return Math.min(cw * ch * Math.min(devicePixelRatio || 1, c.dprCap) ** 2, c.maxPx); } });
  const busyProbe = gpu.hasTimestamps ? null : createBusyProbe({ done: () => device.queue.onSubmittedWorkDone() });
  // step D2: the race's ladder, step-down only, on the p90 of the frames' intervals; while a race runs the
  // page's ladder is held (nothing steps up mid-race) and a step lands only in the race's quiet moments (regatta/index.js quiet)
  const raceQ = createRaceLadder({ level: Q.level });
  let raceSeen = -1;
  let refreshInfo = null;
  // perf(v2) phone 30 fps (owner rulings, 2026-11-15: picture quality first): every page cuts against 30 fps's 33.3 ms from
  // the first frame (engine/governor.js frameBudget); a phone or tablet (not a capture) is held at 30 fps by the limiter
  // and aims its work at 78 % of the frame (thermal headroom); a desk draws unthrottled
  const fbKind = signals.phone ? 'phone' : signals.tablet ? 'tablet' : 'desk';
  const setFb = (fb) => { gov.setBudget(fb.budgetMs); gov.setAim(fb.aimK); ladder.setBudget(fb.budgetMs, { held: fb.held, aimK: fb.aimK }); raceQ.setBudget(fb.budgetMs); return fb; };
  const fb0 = setFb(frameBudget(null, { kind: fbKind }));
  const pacer = fb0.limit && !P.headless ? createPacer({ targetMs: fb0.budgetMs, on: flags.pace !== false }) : null;
  const probe = createRefreshProbe((b, info) => { const fb = setFb(frameBudget(pacer?.vsyncMs ?? b, { kind: fbKind })); refreshInfo = { ...info, refreshMs: b, hz: fb.hz, held: fb.held, why: fb.why }; });   // perf(v2) phone round 2: GPU-bound frames are not evidence of the refresh (engine/governor.js)
  let scale = P.scale;
  // a level's live rows (the caps, the shadow's cadence, the forest's reach, the shallows, #31: MSAA once its set is built);
  // the cloud key and the boat's shadow map wait for the next load (pending); the URL's own ?maxpx= ?dpr= ?msaa= stay
  // perf(v2) phone: the phone path's rows (engine/quality.js LEVER_ROWS), live; the diag sweep turns each off and on
  const levers = {};
  let pinOff = false;
  function applyLevers(rows, fromSweep = false) {
    pinOff = fromSweep;
    for (const k of LEVER_ROWS) if (rows[k] != null) levers[k] = rows[k];
    if (leverPin && !pinOff) Object.assign(levers, leverPin);
    water.setLook({ grid: levers.waterGrid, aniso: levers.waterAniso, lite: levers.waterLite, cascades: levers.waterCascades, fused: levers.waterFused });
    shore?.setLite(fromSweep || leverPin ? !!levers.waterLite : feature('shoreSpray').tier === 'lite');   // #56 M3: the shore's lite train at L2-L3 (src/core/features.js; ?levers= and the diag sweep pin it)
    clouds.setEvery(levers.cloudEvery, levers.simSplit && levers.cloudEvery === 2 ? offAir : null);
    boatR?.setShadowEvery(levers.boatShadowEvery, levers.boatShadowEvery === 2 ? offAir : null);   // perf(v2) phone round 2
    caustics?.setLook({ phone: !!levers.waterLite, every: levers.simEvery, phase: levers.simSplit ? 1 : 0, fine: levers.waterCascades >= 4 });   // ultra M2: the phone path (the lite water) splats 256² at the sim's rate, after its step's second half; 3 cascades: no ripples' layer
  }
  const leverPin = leverRows(flags.levers);   // ?levers= pins the phone path's rows over every level's (the A/B)
  applyLevers(LEVELS[Q.level]);
  hook.levers = { get state() { return { ...levers }; }, set: (rows) => applyLevers(rows) };
  // --- #31: MSAA live. A level's MSAA is wanted at once; the switch waits for that count's pipelines (built async in the
  // background: after the ladder's settle, or at once on a step whose count is not built yet), then lands between two
  // frames (msaaSwitch at the top of drawFrame): the registry serves the new set, the targets are made again at the new
  // count, the next scene pass clears and draws them. Nothing is built synchronously; a get of an unbuilt set still throws ---
  const MS = { switches: [], prebuilt: false, failed: null, dtNext: false };
  const MSAA_TAG = -31;   // the switch frame's timestamps carry it back (the sweep's tags are ≥ 0)
  function msaaBuild(n) {
    if (!reg.counts.includes(n) || reg.ready(n)) return null;
    return reg.buildCount(n).catch((e) => { MS.failed = String(e?.message ?? e); return null; });
  }
  const msw = createMsaaSwitch({ start: graph.msaa, counts: reg.counts, ready: (n) => reg.ready(n), build: msaaBuild });
  function msaaPrebuild() { MS.prebuilt = true; return Promise.all(reg.counts.filter((n) => n !== graph.msaa).map(msaaBuild)); }
  function msaaSwitch(now) {
    const to = msw.due();
    if (to == null) return false;
    const from = graph.msaa, t = performance.now(), before = graph.gpuMs()?.work ?? null;
    reg.use(to);
    sizer.sizeNow(scale);
    graph.setMsaa(to, canvas.width, canvas.height);
    msw.done(to);
    const ms = performance.now() - t;
    if (hook.frames) { gov.reset(gov.scale, now); busyProbe?.reset(); }   // the new count's cost is a new reading (the scale kept)
    // the switch frame's numbers: ms (the targets remade), cpuMs (its whole drawFrame), dtMs (its rAF interval), gpuMs (its GPU
    // work, read back by its timestamps' tag) beside gpuBeforeMs (the frame before's)
    MS.switches.push({ from, to: graph.msaa, at: +(now - t0).toFixed(0), frame: hook.frames, ms: +ms.toFixed(2), cpuMs: null, dtMs: null, gpuMs: null, gpuBeforeMs: before == null ? null : +before.toFixed(3) });
    if (!sweep?.running) graph.setTag(MSAA_TAG);
    if (MS.switches.length > 20) MS.switches.shift();
    Q.pending = pendingRows(Q.built, Q.level);
    return true;
  }
  const msaaState = () => ({ now: graph.msaa, want: msw.wanted, counts: reg.counts, ready: Object.fromEntries(reg.counts.map((n) => [n, reg.ready(n)])), background: reg.background(), switches: MS.switches.slice(), failed: MS.failed });
  // --- end #31 ---
  function applyLevel(k, why, store, now = performance.now(), measured = null) {
    const Lv = LEVELS[k], Lc = levelCaps(k, capsOpts);
    profile.setGpu(k);   // first: the live features read the new level (src/core/features.js shoreSpray)
    sizer.setCaps({ dprCap: qExplicit.has('dpr') ? P.dprCap : Lc.dprCap, maxPx: qExplicit.has('maxpx') ? P.maxPx : Lc.maxPx });
    if (flags.tshadow !== 2) tshadow.setEvery(Lv.shadowEvery);
    forest?.setReach(forestAt(forest.base, k));
    terrain.setLook({ fine: Lv.bedFine });
    applyLevers(Lv);   // perf(v2) phone: the phone path's rows
    if (k !== Q.level) { gov.reset(1, now); scale = gov.scale; busyProbe?.reset(); }   // #32: the new level's pixels are a new span
    Q.steps.push({ from: Q.level, to: k, why, at: +(now - t0).toFixed(0) });
    Q.level = k; Q.why = why; levelRef = k; profile.setGpu(k); crash?.beat(true); Q.pending = pendingRows(Q.built, k);
    raceQ.setLevel(k);   // step D2: the race's ladder steps from the page's level
    msw.want(buildFirst ? P.msaa : msaaOf(k, qExplicit.has('msaa') ? P.msaa : null));   // #31: live once its set is built (a phone holds its start count: no build in play; the stored level's count comes with the next load)
    if (store) writeStored(storage, qKey, k, why, Date.now(), measured);   // perf(v2) phone round 2: with the busy span it was decided on
  }
  hook.quality = { get state() { return { ...Q, name: LEVELS[Q.level].name, msaa: msaaState(), ladder: ladder.state(), race: raceQ.state(), caps: sizer.caps, key: qKey, signals, hold: qHold, busy: busyProbe ? { span: busyProbe.span, count: busyProbe.count, failed: busyProbe.failed } : null }; }, set: (k) => applyLevel(Math.max(0, Math.min(LEVELS.length - 1, k | 0)), `set by the hook: L${k}`, false), levels: LEVELS,
    prebuild: () => msaaPrebuild() };   // #31: the other counts' pipelines now (the page tests; a live page builds them after the settle)
  // Setup's quality row (v2/ui/setup.js, v1's settings 'quality'): pin(k) holds level k (the ladder waits), pin(null) is auto: the
  // ladder's level again (it measures from there), or the start's own pick when the ladder is off (?gov=0); MSAA follows live (#31)
  let qHold = qSetup;
  hook.quality.pin = (k) => {
    if (k != null) { qHold = Math.max(0, Math.min(LEVELS.length - 1, k | 0)); applyLevel(qHold, `Setup: quality held at L${qHold}`, false); }
    else { qHold = null; const a = ladder.phase === 'off' ? (Q.source === 'pinned' ? Q.level : qStart0.level) : ladder.level; applyLevel(a, `Setup: auto (L${a})`, false); }
    return Q.level;
  };
  let sweep = null;   // perf(v2) phone: ?diag=2's sweep (below)
  diag.setPassNames(graph.passes.map((p) => p.name));
  diag.setInfo(() => ({ profile: profile.get(), features: features.lines(), timestamps: graph.hasTimestamps, busySpan: busyProbe?.span ?? null, level: Q.level, levelName: LEVELS[Q.level].name, why: Q.why, pending: Q.pending, backing: hook.frames ? [canvas.width, canvas.height] : null,
    stage: diagStage, css: sizer.css, dpr: devicePixelRatio || 1, dprCap: sizer.caps.dprCap, scale, msaa: graph.msaa, msaaWant: msw.wanted, adapter: gpu.info, ua: navigator.userAgent, mem: memNow(), crash: crash?.line(),
    budgetMs: gov.budgetMs, refreshMeasured: probe.done, refreshSource: refreshInfo?.source, refreshHz: refreshInfo?.hz ?? null, budgetWhy: refreshInfo?.why ?? fb0.why, pacing: pacer?.line() ?? null, gov: gov.state(), raceQ: raceQ.active || raceQ.steps.length ? raceQ.lines() : null, sweep: sweep?.lines() ?? (flags.diag === '2' ? ['sweep waits for the level to settle (≈ 10 s)'] : null),
    levers: LEVER_ROWS.filter((k) => levers[k] !== LEVER_OFF[k]).length ? `phone path: ${[levers.waterGrid === 'coarse' && 'grid', levers.waterAniso !== 8 && `aniso ${levers.waterAniso}`, levers.waterLite && 'lite', levers.cloudEvery > 1 && `clouds 1/${levers.cloudEvery}`, levers.simEvery > 1 && `sim 1/${levers.simEvery}`, levers.airEvery > 1 && `air 1/${levers.airEvery}`, levers.simSplit && 'split', levers.waterCascades < 4 && `${levers.waterCascades} cascades`, levers.waterFused && 'fused mips', levers.boatShadowEvery > 1 && `boat shadow 1/${levers.boatShadowEvery}`].filter(Boolean).join(', ')}` : null }));
  // perf(v2) phone: ?diag=2, the sweep (engine/sweep.js): each scene draw dropped, each compute pass skipped, each phone-path
  // lever flipped in turn, the GPU's busy span with and without; the governor and the ladder wait while it runs
  function makeSweep() {
    const ALL_LAYERS = ['terrain', 'rocks', 'forest', 'boat', 'kayaks', 'birds', 'water', 'sky', 'night', 'storm', 'fireworks', 'cockpit', 'towns'];
    const part = (name, drop) => ({ name, kind: 'part', flip: (on) => hook.setLayers(on ? ALL_LAYERS.filter((x) => !drop.includes(x)).join(',') : null) });
    const pass = (name) => ({ name, kind: 'pass', flip: (on) => { if (on) graph.skip.add(name); else graph.skip.delete(name); } });
    const lever = (name, k, phone) => { const phoneOn = levers[k] === phone; return { name, kind: 'lever', phoneOn, flip: (on) => applyLevers({ [k]: on !== phoneOn ? phone : LEVER_OFF[k] }, true) }; };
    const cases = [part('water', ['water']), part('terrain', ['terrain']), part('forest', ['forest', 'rocks']), part('sky', ['sky', 'night']), part('boat', ['boat']),
      part('towns', ['towns']), part('kayaks+birds', ['kayaks', 'birds']), part('cockpit', ['cockpit']),
      ...graph.passes.filter((p) => p.name !== 'scene' && p.name !== 'composite').map((p) => pass(p.name)),
      lever('grid', 'waterGrid', 'coarse'), lever('aniso', 'waterAniso', 2), lever('lite', 'waterLite', true), lever('clouds', 'cloudEvery', 2), lever('sim', 'simEvery', 2), lever('air', 'airEvery', 2),
      lever('split', 'simSplit', true), lever('cascades', 'waterCascades', 3), lever('fused', 'waterFused', true), lever('bshadow', 'boatShadowEvery', 2),
      { name: 'composite', kind: 'part', flip: (on) => { compositeOff = on; } }];   // round 2: the composite drawn with no tonemap (its own cost: the shader against the pass's fixed time)
    return createSweep({ cases });
  }
  // the water's wind: v1's meanWind (water.js), the WindField's base at the boat (live: its listener, as controllers/sail.js
  // sets it each frame), on the sim's clock; without a boat, M1's day wind at the scene's hour
  function windNowAt(hour) {
    if (B) {
      if (!P.headless) windField.setListener(B.state.x, B.state.z);
      if (windField.sailShifts) { const sp = shiftNow(); if (sp !== windField.sailShifts.profile) windField.sailShifts.setProfile(sp, B.t, { now: modeNow() !== homeId() }); }   // Sail's shifts: the profile now (a change in Sail eases over 20 s; Cruise and Regatta take their own wind at once)
      windField.at(B.t);
      const b = windField.base; windNow.speedMs = b.speedMs; windNow.dirDeg = b.dirDeg; windNow.travelRad = travelRadOf(b.dirDeg); windNow.regime = windField.regime ?? 'pinned';
      return windNow;
    }
    windOpt.hour = hour; const w = windFor(windOpt); windNow.speedMs = w.speedMs; windNow.dirDeg = w.dirDeg; windNow.travelRad = w.travelRad; windNow.regime = w.regime; return windNow;
  }
  // the fetch at the sea's point (the boat, else the eye): the distance upwind to the shore on v2's heights (spectrum.js fetchAt,
  // continuous in the point), traced on the first frame and every 30th after (a fixed cadence, never a distance threshold: the
  // boat's position carries the readback's sub-centimetre jitter, and a threshold crossed a frame early moved the foam's memory
  // in the film goldens)
  const seaAt = { n: 0, fetchM: 20000, wind: { speedMs: 0, travelRad: 0, fetchM: 20000, x: 0, z: 0 } };
  function seaNow(w) {
    const x = B ? B.state.x : eye[0], z = B ? B.state.z : eye[2];
    if (seaAt.n++ % 30 === 0) {
      seaAt.fetchM = fetchAt((px, pz) => terrain.field.height(px, pz), x, z, [Math.cos(w.travelRad), Math.sin(w.travelRad)]);
    }
    const o = seaAt.wind; o.speedMs = w.speedMs; o.travelRad = w.travelRad; o.fetchM = seaAt.fetchM; o.x = x; o.z = z;
    return stormSea(o, storm.weather);   // storm round 2 (owner 2026-11-18): under the outflow a storm's sea (0 with no storm)
  }
  // phase 2a (§ 3.9): the eye's depth under the drawn surface at the lens, from the CPU twin of the FFT surface (the whole
  // 600 and 85 m tiles: heightAt's coarse read is exact anywhere, so the boat's readback window stays on the boat); the surface's slopes by a
  // 0.5 m difference; only while you are Tessie and the row is on. The exposure: up at most +0.7 stop over 1.5 s after the crossing
  const underNow = { depth: 0, h: 0, sx: 0, sz: 0, bed: 0 }, UW_EXPO = Object.freeze({ stops: 0.25, s: 1.5 });   // stops: a small steady lift once under (0.7 fought the depth's own darkening: owner, 2026-11-20)
  let underSplitOn = false, underStops = 0;
  function underFill() {
    const on = underOn && player.dives && (player.played || eye[1] < 1.5);   // a played thing that dives (Tessie), or the swap's glide back still under the water
    if (!on) { underNow.depth = 0; underNow.h = 0; underNow.sx = 0; underNow.sz = 0; underNow.bed = 0; UNDER_STATE.on = false; underSplitOn = false; return; }
    const wAt = (x, z) => { const v = water.heightAt(x, z, { coarse: true }); return Number.isFinite(v) ? v : 0; };
    const h = wAt(eye[0], eye[2]), e = 0.5;
    underNow.h = h; underNow.sx = (wAt(eye[0] + e, eye[2]) - wAt(eye[0] - e, eye[2])) / (2 * e); underNow.sz = (wAt(eye[0], eye[2] + e) - wAt(eye[0], eye[2] - e)) / (2 * e);
    underNow.depth = h - eye[1];
    underNow.bed = Math.max(0, h - terrain.field.height(eye[0], eye[2]));   // the water's depth at the eye (m)
    UNDER_STATE.on = underNow.depth > (UNDER_STATE.on ? -0.02 : 0.02);   // the side the frame is drawn for (the split draws the other: a wave at the lens shows no switch)
    underSplitOn = player.played && Math.abs(underNow.depth) < LENS.band;   // the split only while you are it
  }
  function underExpo(dt) {
    if (!underOn) return 1;
    const want = UW_EXPO.stops * Math.min(1, Math.max(0, (underNow.depth + 0.3) / 1.3)) * Math.min(1, Math.max(0, (sunNow.elevDeg + 4) / 10));   // by the eye's depth (continuous through the surface), by day only: the night keeps the photographer's lens
    const r = UW_EXPO.stops / UW_EXPO.s * Math.max(0, Math.min(0.1, dt || 0));
    underStops = want > underStops ? Math.min(want, underStops + r) : Math.max(want, underStops - 2 * r);   // eased both ways
    return underStops > 0 ? 2 ** underStops : 1;
  }
  const F = { eye: null, focal: 0, race: false };   // the plug-ins' fills: this frame's eye, focal length (px) and race (living/lakePlugins.js)
  function fill() {
    const w = canvas.width, h = canvas.height;
    if (B) B.follow.lead = isPortrait(w, h) ? FOLLOW.leadPortrait : m4.phoneCockpit() ? FOLLOW.leadPhoneCockpit : FOLLOW.lead;   // an upright phone: the boat higher, clear of the hands; M4: a phone sideways with the cockpit, above the coaming (deck.js)
    lookDir(view, eye, fwd, up);
    perspectiveReversed(proj, fovDeg * DEG, w / h, near, pose.far);
    multiply(viewProj, proj, view); invert(invVP, viewProj);
    navAidsFx?.setView(viewProj);   // perf(v2) phone Regatta: buoys outside the view are not uploaded (render/navAids.js)
    if (regatta?.on) regatta.frame(viewProj, w, h, lastDt, eye);   // Regatta: the props, the lines and the tags at this frame's camera
    huntStep(lastDt);   // the cups' hunts: the corners found by sailing there
    sun.sunAt(clock.hour, sunNow);
    // M5e: the storm's step (the arc, the outflow on the wind field, the strikes), then the sea from the wind under the
    // outflow at the eye (v1's modifier: the lull, the line, the gusty veer behind it): the composed tables rebuild only when
    // the rounded wind moves, the cheap re-composition takes the rest; the Weather menu's ease of the deck
    storm.update(clock.hour);
    wx.update(clock.t);
    storm.waterWind(windNowAt(clock.hour), windStorm);   // the day's wind at the hour (windNow), then the outflow on it
    weatherWind.update({ eye, t: clock.t, windT: B ? B.t : clock.t, base: windNow, storm: { on: storm.weather.on, front: storm.weather.front[3] }, cut: clock.cuts });   // the one wind at the eye (the field has the outflow now)
    const lookNow = wlook.update({ cover: deckCover.value, on: storm.weather.on, dark: storm.weather.dark, rain: storm.weather.rain, gold: storm.weather.gold, t: clock.t, cut: clock.cuts });   // the weather's look, eased
    water.setWind(seaNow(windStorm));   // v1's sea at the boat (spectrum.js): the tables rebuilt only when the wind moves, re-weighted by the fetch
    coverNow = coverAt();
    clouds.update({ wind: windNow, t: clock.t, eye, night: nightFloor(sunNow.elevDeg), weather: storm.weather, deck: { coverage: coverNow }, drift: weatherWind.drift, sunElevDeg: sunNow.elevDeg, cut: clock.cuts + (clock.gliding ? 0.5 : 0) });   // a time cut re-bakes the key at once (fix 2026-11-18)   // M5a: the drift, the key schedule's step, its params (one writeBuffer); M5e: the storm cell, the menu's coverage
    // the readback window sits on the boat (its float reads it); without one, on the eye as M2
    const g = B ? water.centreFor(B.state.x, B.state.z, clock.t) : water.centreFor(eye[0], eye[2], clock.t);
    underFill();   // phase 2a: the eye's depth under the drawn surface at the lens (play as Tessie only; 0 otherwise)
    exhaustFx?.upload(sea?.exhaust);   // #14: the clots in the air this frame
    // the anchor seen: this frame's events (the clunk, the splash, the break-out) to the droplets and the sound
    anchorEvents = sea ? sea.drain() : anchorEvents;
    if (anchorFx && sea) { anchorFx.step(lastDt, anchorEvents, sea.anchorAt); anchorFx.fill(0.5 * h / Math.tan(0.5 * fovDeg * DEG)); }
    if (anchorGear && PG.boatfx && B) anchorGear.update(B.pose, sea, { eye, t: clock.t });   // before the boat: the glb's anchor hidden, the line's far part only
    F.eye = eye; F.focal = 0.5 * h / Math.tan(0.5 * fovDeg * DEG); F.race = !!regatta?.on; F.sun = sunNow;
    plugins.run('fill.boats', F);   // the lake's boats on the rival slots (no race on), then the glass boat's records (nothing in a race but Glass Boat Chase)
    if (boatR) boatR.update(B.pose, { t: clock.t, focalPx: 0.5 * h / Math.tan(0.5 * fovDeg * DEG), sun: [sunNow.x, sunNow.y, sunNow.z], debug: flags.boatdebug, eye, instant: P.headless, vhf: m4.captain?.lcd ?? null, pxScale: h / (canvas.clientHeight || h), viewH: canvas.clientHeight || h, kd: B.kdFx.state.mix > 0 && kdLook ? B.kdFx.state : null });   // K2: the knockdown's look (null upright)   // #35: the VHF set's LCD (ui/captain.js)
    terrain.select(eye, viewProj);          // the CDLOD node quadrants for this camera (one writeBuffer of their records)
    shore?.update({ eye, viewProj, wind: seaAt.wind });   // #56 M3: on only with a shore tile in view; the frame's waves, the spray's near tiles
    forest?.update(eye, viewProj, 0.5 * h / Math.tan(0.5 * fovDeg * DEG));   // M5b: the tiles in range and view, the cull's uniform
    // M5c: the light box and its patches (empty with the sun down or ?tshadow=0), the boulders' cull uniform
    tshadow.update(eye, fwd, shadowOn ? [sunNow.x, sunNow.y, sunNow.z] : [0, -1, 0]);
    if (rocks) { const d = B ? stoneRegion.at(B.state.x, B.state.z) : stoneRegion.at(eye[0], eye[2]); if (d) rocks.setRegion(d); }   //: a new region set re-places the bed's stones
    rocks?.update(eye, viewProj, 0.5 * h / Math.tan(0.5 * fovDeg * DEG));
    towns.update(eye, viewProj);   // 10a: the shore's chunks in range and view
    landmarks.update({ wind: windField, windT: clock.t, waveT: livingNow(), flagsOn: !regatta?.on });   // G1: the waterfall's clock; G2: the flags from the local wind on the scene's clock (v1's ctx.t: 5 Hz a flag, eased)
    // M5e: the moon (v2/sim/moon.js), the night's levels (v2/sim/night.js), the night record and the boat's lights
    const moonNow = night.moon.moonAt(clock.hour);
    const lv = nightLevels({ sunElevDeg: sunNow.elevDeg, moonAltDeg: moonNow.altDeg, moonLit: moonNow.lit });
    if (!nightOn) { lv.air = 0; lv.domes = 0; lv.band = 0; lv.moonShare = 0; moonNow.y = -1; moonNow.x = 0; moonNow.z = 0; }   // ?night=0: the old black night (the A/B)
    moonShareNow = lv.moonShare; bandNow = lv.band;
    stormDarkNow = storm.weather.on > 0.5 ? (storm.weather.dark ?? 0) : 0;   // fix(v2) frame look: the storm's exposure (sim/exposure.js stormExposure)
    fillAids();   // channel markers: the buoys near the eye on the drawn water
    let litN = regatta?.on && nightOn && raceLitOn ? regatta.lights(raceLit, sunNow.elevDeg) : 0;   // step D: a night race's lit marks (0 by day)
    if (nightOn && aidsNear) litN += markLights(raceLit, litN * 8, aids, { t: clock.t, sunElevDeg: sunNow.elevDeg, heightAt: aidWat, pose: (i) => aidPoses[i] });   // channel markers: the lamps flashing in their patterns (0 by day)
    litN = plugins.reduce('night.lights', litN, raceLit, { on: nightOn && raceLitOn, sunElevDeg: sunNow.elevDeg, heightAt: aidWat, mastHead: MAST_HEAD });   // boats at anchor: the riding light; the glass boat's nav lights (0 by day)
    night.setRace(raceLit, litN);
    night.update({ hour: clock.hour, levels: lv, t: clock.t, pose: B ? B.pose : null, eye, dims: B ? DEFAULT_DIMS.HULL : null, mastHead: B ? MAST_HEAD : null, sunElevDeg: sunNow.elevDeg, focalPx: 0.5 * h / Math.tan(0.5 * fovDeg * DEG) });
    m4.fill({ w, h, sun: sunNow, heading: B?.pose.heading ?? 0, exposure: expNow() });   // M4: the cockpit's camera and light
    const raceOn = !!regatta?.on;   // Regatta: the cut systems' CPU stops too
    F.eye = eye; F.focal = 0.5 * h / Math.tan(0.5 * fovDeg * DEG); F.race = raceOn;
    plugins.run('fill.living', F);   // kayaks: the palettes and the instance records; Tessie: the spine and her water's sources
    plugins.run('fill.birds', F);   // #24: the dive director on a live page; the splash's droplets   // birds: the flock on real time (v1's scene time, never Sail's 2 ×), its records up, its calls; in the storm's rain they go to shelter (L1)
    plugins.run('sim.show', raceOn, () => ({ simT: clock.t - P.t0, hour: clock.hour, dt: lastDt, eye, fwd, h, fovDeg, sunElevDeg: sunNow.elevDeg, exposure: expNow(), rate: clock.rate, speed: modes.speed(), cuts: clock.cuts, gliding: clock.gliding }));   // the fireworks; a race cuts the show but its salute (v2's night exposure; the live show clock's pace, cuts and glides)
    if (beacon) {   // the target beacon: the mark in force (a pin, Regatta's next mark, Cruise's mark, Sail's waypoint), the rules, the picture
      // Sail: the double-tap mark or the chart's (the course's active waypoint, else a drafted route's first: a tap on the chart lights
      // it before Set course; fix 2026-11-15), whichever the player set last
      const sailing = !raceOn && !cruise?.on, svc = sailing ? m4.ui?.services : null;
      const chartTg = svc ? (svc.get('passage')?.sync?.()?.target ?? draftTarget(svc.get('course'))) : null, sailTg = sailing || cruise?.on ? beacon.mark?.mark ?? null : null;   // Sail's mark, in Cruise too (the fireworks' jump sets none since 2026-11-18)
      const own = beacon.latest(sailTg, chartTg);
      // Cruise: Sail's mark and the navigator's, whichever was set last (a new Cruise target wins and the mark goes)
      const dest = cruise?.on ? cruise.voyage?.nav?.dest ?? null : null, destTg = dest?.at ? { x: dest.at[0], z: dest.at[1] } : null;
      const ownC = cruise?.on ? (beacon.latestC ??= createLatest())(sailTg, destTg) : null;
      if (cruise?.on && sailTg && ownC === destTg && destTg) beacon.mark.clear();
      const tg = targetOf({ pin: beacon.pin, race: raceOn ? (regatta.beaconView ? regatta.beaconView() : regatta.session?.race?.view('me')) : null, cruise: cruise?.on && (!sailTg || ownC === destTg) ? dest : null, sail: own === sailTg ? sailTg : null, passage: own === chartTg ? chartTg : null });
      navSailTg = sailing && tg ? { x: tg.x, z: tg.z, key: tg.key, name: (own === chartTg ? chartTg?.name : null) ?? null } : null;   // the pilot head's AUTO target (ui/autopilot.js)
      const snap = beacon.sim.update(tg, B ? B.state : { x: eye[0], z: eye[2] }, lastDt), wy = snap.visible ? water.heightAt(snap.x, snap.z) : 0;
      beaconFx.frame({ snap, y: Number.isFinite(wy) ? wy : 0, focalPx: 0.5 * h / Math.tan(0.5 * fovDeg * DEG), pxScale: h / Math.max(1, canvas.clientHeight || h), t: clock.t, nightK: lv.k, haze: storm.weather.on > 0.5 ? Math.max(storm.weather.rain ?? 0, storm.weather.haze ?? 0) : 0 });
      if (snap.phase === 'done' && snap.kind === 'sail') beacon.mark?.clear();   // Sail's mark reached: gone (a new double-tap sets the next)
    }
    U.begin();
    U.mat4('viewProj', viewProj); U.mat4('invViewProj', invVP);
    U.set4('sun', sunNow.x, sunNow.y, sunNow.z, sunNow.y);
    U.set4('cam', eye[0], eye[1], eye[2], clock.t);
    U.set4('res', w, h, 1 / w, 1 / h);
    const expo = expNow() * underExpo(lastDt);   // phase 2a: under the water the frame eases up at most +0.7 stop (1 above it: the same bytes)
    U.set4('params', expo, clock.hour, scale, SEA.choppiness);
    // the post chain: the bloom's exposure and factor (eased in over 30 frames once its group is built on a live page), the dither
    if (PG.post && postState.ramp < 1) postState.ramp = Math.min(1, postState.ramp + 1 / 30);
    post.write(device.queue, { exposure: expo, gain: PG.post && postState.bloom ? bloomGain(post.levels, BLOOM.scatter, BLOOM.strength * postState.k) * postState.ramp * plugins.reduce('post.bloom', 1) : 0, dither: postState.dither ? DITHER_LSB : 0, threshold: postState.threshold, knee: postState.knee,
      purkinje: nightOn ? purkinjeAmount(lv) : 0, pkScale: purkinjeScale(),   // feat/v2-look-ponlai: the night's Purkinje shift (v2/sim/night.js; 0 by day)
      ...(intro.playing ? { lens: intro.lens.amount, lensFx: intro.lens.fx, seed: P.headless ? 1 : (introSeed = (introSeed + 1) % 65536) } : {}) });   // the cinematic intro's lens look (0 outside it)
    U.set4('wind', windStorm.speedMs, windNow.travelRad, water.gain, ((clock.t % LOOP) + LOOP) % LOOP);   // M5e: the speed under the outflow (the foam, the glint's floor)
    U.set4('water', LENGTHS[0], LENGTHS[1], LENGTHS[2], LENGTHS[3]);
    U.set4('sky', SUN.illuminance, 0, SUN.lakeAltKm + eye[1] / 1000, SUN.discCos);   // M5e: the flat night floor (y) is 0: the airglow sky lights the night (render/sky.js NIGHT_SKY_WGSL)
    U.set4('grid', g.x, g.z, water.grid.a, water.grid.b);
    U.set4('moon', moonNow.x, moonNow.y, moonNow.z, moonNow.lit);
    U.set4('night', lv.air, lv.domes, lv.band, lv.k);
    U.set4('look', look === 'v1' ? waterKeep(P.exposure, sunNow.elevDeg, moonShareNow, expNow()) : 0, gradeLut ? gradeStrength(sunNow.elevDeg) : 0, gradeSky ? skyStrength(sunNow.elevDeg) : 0, look === 'v1' ? skyMatchStrength(sunNow.elevDeg) : 0);   // fix(v2) frame look: AgX (> 0) with the water's keep, the LUT's, the polariser's and the sky match's strengths by the sun
    const shadeNow = storm.fillFrame(U, eye, lookNow.haze);   // M5e: the storm rows (storm, rain, cell, front, bow); the look's share of the storm's mist
    { // the camera's own velocity on the scene clock (the rain's streaks lie along the drops' motion past it; the air on the lens)
      const dtc = camT == null ? 0 : clock.t - camT; camT = clock.t;
      if (camWas && dtc > 0 && dtc < 0.25) { for (let i = 0; i < 3; i++) camVel[i] = (eye[i] - camWas[i]) / dtc; if (Math.hypot(camVel[0], camVel[1], camVel[2]) > 40) camVel.fill(0); }
      else if (!(dtc > 0)) { /* a frozen clock keeps the last */ } else camVel.fill(0);
      camWas = [eye[0], eye[1], eye[2]];
      const rx = -fwd[2], rz = fwd[0], rl = Math.hypot(rx, rz) || 1;   // the camera's right on the water
      const lensOn = lensPolicy && flags.lensrain !== false && !UNDER_STATE.on && !(!P.headless && reducedNow());   // Reduced Motion: no lens
      const L = lensWater.update({ rain: storm.weather.on > 0.5 ? storm.weather.rain : 0, on: lensOn, air: { x: weatherWind.eye.vx - camVel[0], z: weatherWind.eye.vz - camVel[2] }, right: [rx / rl, 0, rz / rl], fwd, t: clock.t, cut: clock.cuts });
      const viewK = 1 - (m4?.views?.k ?? 0);   // the helm view's eye takes none (the skipper's eye is not a lens); the follow and chase cameras do
      lensRec.amount = L.amount * viewK; lensRec.gx = L.gx; lensRec.gy = L.gy; lensRec.wet = L.wet;
      fillLookRecord(wlookBuf.data, lookNow, { aspect: w / h, tanHalf: Math.tan(0.5 * fovDeg * DEG), shade: shadeNow, lens: lensRec, t: clock.t });
      wlookBuf.write(device.queue);
    }
    const windT = B ? B.t : clock.t;
    windTex.update(windT, eye[0], eye[2]); windTex.upload(device.queue, windBlend.slots); windBlend.set(windTex.blend(windT));   // audit W1–W3; fix(v2) shadow stepping: the fill into its slot, this frame's cross-fade
    U.set4('windfx', windTex.centre[0], windTex.centre[1], (windTex.fills > 0 && windFx.tex ? WIND_BITS.tex : 0) | (windFx.gust ? WIND_BITS.gust : 0) | (windFx.lanes ? WIND_BITS.lanes : 0) | (windFx.caps ? WIND_BITS.caps : 0), water.significantHeight);
    U.set4('spume', 0, spumeOn ? 1 : 0);   // v1's fold threshold for the spume (render/spume.js), from the water's readback; on
    U.set4('under', underNow.depth, underNow.h, underNow.sx, underNow.sz);   // phase 2a: the eye under the water (0 in the air: the frame's bytes as before)
    U.set4('underK', UNDER_STATE.on ? 1 : 0, underSplitOn ? 1 : 0, UNDER_STATE.on ? (underTier === 'full' ? 2 : 1) : 0, underNow.bed);   // w: the water's depth at the eye (the bed's light back up)
    U.upload(device.queue, ubuf);
    if (underLight) {   // phase 2b: the shafts' strength (by day, less in chop, almost none in a storm, eased in under the surface), the sprites' camera, the bubbles
      const uwOn = UNDER_STATE.on || underSplitOn;
      const rx = fwd[1] * up[2] - fwd[2] * up[1], ry = fwd[2] * up[0] - fwd[0] * up[2], rz = fwd[0] * up[1] - fwd[1] * up[0], rl = Math.hypot(rx, ry, rz) || 1;
      const R = [rx / rl, ry / rl, rz / rl], Up = [R[1] * fwd[2] - R[2] * fwd[1], R[2] * fwd[0] - R[0] * fwd[2], R[0] * fwd[1] - R[1] * fwd[0]];
      //: the eye's velocity (the specks stream past it, stretched with her pace); a cut (over 40 m/s) reads as rest
      const ldt = Math.max(1e-3, lastDt || 1 / 60), ev3 = specksEyeWas ? [(eye[0] - specksEyeWas[0]) / ldt, (eye[1] - specksEyeWas[1]) / ldt, (eye[2] - specksEyeWas[2]) / ldt] : [0, 0, 0];
      specksVel = Math.hypot(...ev3) > 40 ? [0, 0, 0] : specksVel.map((v, i) => v + (ev3[i] - v) * Math.min(1, ldt / 0.15)); specksEyeWas = [eye[0], eye[1], eye[2]];
      underLight.update({ on: uwOn, level: Q.level, right: R, up: Up, focalPx: 0.5 * h / Math.tan(0.5 * fovDeg * DEG), bubbles, eyeVel: specksVel,
        strength: shaftStrength({ sunY: sunNow.y, wind: windStorm.speedMs, storm: storm.weather.on > 0.5 ? Math.max(0.5, storm.weather.dark ?? 0) : 0, eyeDepth: underNow.depth }) });
    }
    if (underSplitOn) {   // phase 2a: the split's copy of the block, its eye just on the other side of the surface (the twins' placement and light read it)
      splitBlock.set(U.view);
      const o = U.layout.offsets, other = !UNDER_STATE.on, surf = underNow.h;
      splitBlock[o.cam + 1] = other ? Math.min(eye[1], surf - 0.06) : Math.max(eye[1], surf + 0.06);
      splitBlock[o.under] = surf - splitBlock[o.cam + 1]; splitBlock[o.underK] = other ? 1 : 0;
      // its near plane at the virtual lens: the surface crossed within it (at the lens) is not drawn on that side, the water beyond it is
      perspectiveReversed(splitProj, fovDeg * DEG, w / h, LENS.m, pose.far); multiply(splitVP, splitProj, view); invert(splitInv, splitVP);
      splitBlock.set(splitVP, o.viewProj); splitBlock.set(splitInv, o.invViewProj);
      device.queue.writeBuffer(ubuf, SPLIT_OFF, splitBlock);
    }
    // M5e: the rain and the bolt for this frame, the thunder of the new strikes at the distance's delay (live pages)
    { const Fr = storm.frame, W = storm.weather;
      if (Fr.ran && stormDraw) {
        stormDraw.update({ rain: W.rain, vx: weatherWind.rain.vx, vz: weatherWind.rain.vz, cvx: camVel[0], cvy: camVel[1], cvz: camVel[2], t: clock.t, dark: W.dark, strike: Fr.bolt, flash: Fr.boltGlow * Fr.k, groundY: Fr.bolt ? Math.max(0, terrain.field.height(Fr.bolt.x, Fr.bolt.z)) : 0 });
        if (thunder && audio.running && storm.state) for (const s of Fr.strikes) { const th = stormSim.thunderOf(s, Fr.L), dueT = stormSim.sceneTimeOf(storm.state, s.s) + th.delayS; thunder.play(thunder.bus.context.currentTime + Math.max(0, dueT - clock.t), { ...th, seed: s.seed }); }
      } else if (stormDraw && (stormDraw.stats.drops || stormDraw.stats.boltGlow)) stormDraw.update({});
    }
    beds?.update(bedsInput);   // step 3: the beds' targets (live, once the sound has started; ≤ 0.1 ms)
    if (engineSound) { const s = B.state; engineSound.update(s, { camDist: Math.hypot(eye[0] - s.x, eye[1], eye[2] - s.z), chainMs: Math.abs(sea.chainMs) }); }   // #14, #8: v1's engineAudio
    if (anchorSound) { const a = sea.anchorAt; anchorSound.update(anchorEvents, sea.chainMs, Math.hypot(eye[0] - a[0], eye[1] - a[1], eye[2] - a[2])); }   // the anchor seen
    if (music) music.update(clock.t, { hour: clock.hour, windSpeed: beds && bedsIn.state ? bedsIn.earWind : (windField.sample(eye[0], eye[2], clock.t).speed ?? 0) });   // music: v1's worldState at the listener
  }

  // the stream's frames: the worst wall interval and the worst CPU frame while grids are still coming or uploading
  const stream = { active: false, frames: 0, worstFrameMs: 0, worstCpuMs: 0, uploadMsMax: 0, doneMs: null, startMs: null, modelsMs: null };
  let firstFrameMs = null, firstFrameFromNavMs = null, lateBuilds = 0, probeResult = null;   // from main.js's start; from the navigation start
  let simMs = 0, simMsMax = 0, filmOn = false;   // the boat's CPU: the physics ticks, the float, the hands (per frame); filmOn: v1's film contract (the harness)
  // the sim's part of a frame: `n` fixed clock steps → the boat steps that much sim time with this frame's hands, then the camera
  let lastDt = 1 / 60;   // fireworks: the frame's real dt (the sound's scheduler)
  // the living lake's own clock: real time on a live page (v1: the kayaks paddle on the wall clock, owner 2026-11-09, and the
  // birds fly on the scene's time, which Sail's 2 × never scales: src/modes/daysail/index.js, src/core/world.js); a capture's
  // is the scene clock (it ignores the game speed)
  let livingT = clock.t;
  const livingNow = () => (P.headless ? clock.t : livingT);
  // phase 2b: the bubbles' sources this step: her run, a sharp turn, a fast dive, the breach and its fall (as you play
  // her), the motoring boats' and the glass boat's propellers near the eye; all of them rise and go at the surface
  function bubbleStep(dt) {
    const her = player.bubbles(dt), on = !!her;   // the played thing's sources (Tessie: living/lakePlugins.js TESSIE)
    let src = { dt, eye };
    if (her) src = { ...src, ...her };
    if (underNow.depth > -2 || on) {   // the propellers only while the eye is near or under the water
      const props = [];
      const BL = plug('busy'); if (BL?.active) for (const b of BL.liveBoats) if (b.motoring && (b.phys.state.u ?? 0) > 0.5) props.push({ x: b.phys.state.x, z: b.phys.state.z, heading: b.phys.state.heading, back: 4 });
      const T = plug('tour')?.sim, g = T?.active ? T.boat : null; if (g && Number.isFinite(g.x) && (g.v ?? 0) > 0.3) props.push({ x: g.x, z: g.z, heading: g.heading, back: 6 });
      src.props = props;
    }
    bubbleSrc.step(src);
    bubbles.step(dt, () => underNow.h - 0.05);
  }
  function simFrame(n, dt) {
    lastDt = dt;
    if (dt > 0) livingT += dt;   // the living lake: real time
    if (!B) return;
    const t = performance.now();
    // the hands first, then Sail's screen with them (root cause 2 of the v1-vs-v2 audit: the screen stepped before the keys were
    // read and never got them; DRV-9, U13: the skill model sees the keys and fingers)
    const h = P.headless ? handsNow : readHands(dt);
    intro.step(P.headless ? n * clock.dt : dt);   // the cinematic intro's clock (before the UI: its holds read this frame's state)
    if (!P.headless) m4.beforeStep(dt, h);   // M4: the station's hands go in (the wheel, the winches, the Tack assist)
    if (birthCamUntil != null && B.t >= birthCamUntil) { birthCamUntil = null; B.follow.chase = true; }   // the hero shown: the camera's chase on again
    birthplaces?.step(P.headless ? n * clock.dt : dt);   // a birthplace move's veil and its place, before the boat's step
    const kts = kdFrame(P.headless ? n * clock.dt : dt);   // K3: the knockdown's slow (1 while she sails)
    if (n > 0) {
      if (filmOn) B.filmStep(n * clock.dt);
      else { if (regatta?.on) regatta.beforeStep(h, m4.ui?.station?.steer ?? m4.ui?.flat?.helm ?? null); if (!(cruise?.on && cruise.step(n * clock.dt, P.headless ? n * clock.dt : dt))) { B.step(n * clock.dt * kts, h, P.headless ? n * clock.dt : dt); kdGame?.sail(n * clock.dt * kts, B.state.sog); } if (regatta?.on) regatta.afterStep(); if (gust && !cruise?.on) gustNow = gust.update(n * clock.dt, B.state); }   // audit W4: the gust's onset on the sim's clock (v1: gustFx.update(dt × timeScale))   // Regatta: a steer (keys, strip, the cockpit wheel in the hand: R3) hands the helm back; the fleet and the rules to the boat's time   // the hands on the frame's real dt (v1: the sim at timeScale ×, the hands at dt); Cruise: its autopilot each tick
    }
    feelFrame();   // the speed feel
    if (!P.headless) m4.afterStep(dt, handsNow);   // M4: the station draws the rudder and the sheets
    if (followOn) placeCamera(dt);
    if (cruise && !P.headless) cruise.update(dt);   // Cruise: its bar, dock, mark ring and lines
    const kdt = P.headless ? n * clock.dt : dt; if (kdt > 0) plugins.run('sim.living', kdt);   // kayaks: v1 paddles on the wall clock (not Sail's 2 ×), after the camera
    if (kdt > 0) stage?.step(kdt, { playing: P.headless || birdBeat.playing });   // the stage: the director cues the next act (one at a time)
    if (kdt > 0) plugins.run('sim.tessie', kdt);   // Tessie: the living clock too (her director holds her during a race)
    if (kdt > 0) player.step(kdt);   // the played seam: the played thing's hands, the hits, the swap's pill, its HUD
    if (kdt > 0 && bubbles) bubbleStep(kdt);   // phase 2b: her bubbles and the propellers', on the sim's clock
    simMs = performance.now() - t; simMsMax = Math.max(simMsMax, simMs);
  }
  function drawFrame() {
    const t = performance.now();
    readPG();   // perf(v2) iOS pipelines: which deferred groups draw this frame
    const switched = msaaSwitch(t);
    if (!switched && sizer.sizeNow(scale)) graph.resize(canvas.width, canvas.height);   // #31: a due MSAA switch remakes the targets at the backing's size
    if (terrain.queued) { const tu = performance.now(); terrain.pump(); stream.uploadMsMax = Math.max(stream.uploadMsMax, performance.now() - tu); if (!terrain.queued) water.seaField.invalidate(); }   // #25: the full grids are in: the sea field's land mask again
    else if (boatR?.models.queued) { const tu = performance.now(); boatR.models.pump(); stream.uploadMsMax = Math.max(stream.uploadMsMax, performance.now() - tu); if (!boatR.models.queued) stream.modelsMs = performance.now() - t0; }   // M3b: a slice of the boat's models (after the terrain's, never in the same frame)
    else if (forest?.queued) { const tu = performance.now(); forest.pump(); stream.uploadMsMax = Math.max(stream.uploadMsMax, performance.now() - tu); }   // M5b: after the terrain's slices
    else if (ground.queued) { const tu = performance.now(); ground.pump(); stream.uploadMsMax = Math.max(stream.uploadMsMax, performance.now() - tu); }   // M5c: the photo tiles and the detail set, after the forest's
    fill();
    graph.render({ clock });
    m4.afterFrame(canvas);   // the logbook: a find's picture, grabbed in the render's own task (ui/logbook.js)
    hook.frames++;
    const cpu = performance.now() - t;
    hook.cpuSample(cpu);
    if (switched) { MS.switches.at(-1).cpuMs = +cpu.toFixed(2); MS.dtNext = true; }   // #31
    if (stream.active && hook.frames > 2) { stream.worstCpuMs = Math.max(stream.worstCpuMs, cpu); }   // the first frame (the wave table's 25 ms build) is the first frame's number
    if (firstFrameMs == null && !P.headless) prepareAudio();   // refactor round 3 B6a
    if (firstFrameMs == null) { lmPoint('frame1'); lmEnd('boat'); if (B && !P.headless) { lmStart('card'); lmStart('handover'); } if (buildFirst && !P.headless) lmStart('modes'); firstFrameMs = performance.now() - t0; firstFrameFromNavMs = performance.now(); reg.seal(); hook.ready = true; if (!P.headless) track('session_start', sessionProps({ mode: metricMode, signals, level: Q.level, firstVisit: !pageSettings().get('welcomed'), lang: pageSettings().get('lang'), display: displayOf() })); document.getElementById('veil')?.remove(); window.__veliaLoading?.ready?.(); }   // front door: the loading card's ready (v1: the first live frame)
    if (pipesDefer && hook.frames > 0) pipesTick();   // perf(v2) iOS pipelines: the deferred groups (start, first use)
    if (!buildGate.ready) gateTick();   // the phone's build gate: its numbers, once a frame until it opens
    if (forest && !forestLoad && !P.headless && cockpitIn && pipeQ.has('forest')) forestLoad = forest.load().catch((e) => errors.push(`forest: ${e?.message ?? e}`)).finally(() => { forestDone = true; });   // M5b: after the first frame
    if (!groundLoad && !P.headless && cockpitIn && pipeQ.has('ground')) groundLoad = ground.load(eye).catch((e) => errors.push(`ground: ${e?.message ?? e}`));   // M5c: the tiles nearest the eye first, after the first frame
    if (!nightLoad && !P.headless && cockpitIn && nightLoadDue(sunNow.elevDeg)) nightLoad = night.load();   // M5e: the night's data once the sun is low (never in the first frame's way);: only then (a day page fetched it after the terrain's stream)
    if (!townsLoad && !P.headless && cockpitIn && pipeQ.has('towns')) { townsLoad = towns.load(); Promise.resolve(townsLoad).catch(() => {}).finally(() => { townsDone = true; }); }   // 10a: after the first frame
    if (shore && !shoreLoad && !P.headless && cockpitIn && pipeQ.has('shore')) shoreLoad = shore.load().catch((e) => errors.push(`shore: ${e?.message ?? e}`));   // #56 M3: the baked field after the first frame
    if (!landmarksLoad && !P.headless && cockpitIn && pipeQ.has('towns')) { landmarksLoad = landmarks.load(); landmarksLoad.then(teaHouseLoad); }   // G1, G2: after the first frame; the tea house after them (a desktop)
    lateBuilds = reg.late;
    if (diag.on) { const nowD = performance.now(); diag.frame(lastDrawAt == null ? null : nowD - lastDrawAt, graph.gpuMs(), nowD, cpu); lastDrawAt = nowD; }   // the phone pass: the frame's numbers into the panel's rings (perf(v2): the span, the passes, the CPU)
    label();
  }
  let lastDrawAt = null;
  // perf(v2) iOS pipelines: the deferred groups start after the first frame (a slow compiler: at the home card's hand-over, or
  // PIPE_WAIT_MS after the first frame), one group at a time; a group the frame needs now (the sun low, the storm in, a race
  // or the practice marks on) jumps the queue. The span 'pipes.late' times the whole background build (the load report)
  let pipesLateMarked = false;
  function pipesTick() {
    if (!pipeQ.started) {
      const handed = !B || lmHas('handover:e');
      if (!pipesSlow || buildFirst || handed || performance.now() - firstFrameFromNavMs > PIPE_WAIT_MS) {   // a phone: at once (its modes wait for the build)
        pipeQ.start();
        if (pipeQ.pending.length) { lmStart('pipes.late'); pipesLateMarked = true; }
      }
    }
    if (!PG.night && nightOn && sunNow.elevDeg < 2) pipeQ.now('night');
    if (!PG.storm && storm.weather.on > 0.01) pipeQ.now('storm');
    if (!PG.regatta && (regatta?.on || raceProps?.active || raceProps?.stats.lake)) pipeQ.now(RACE_PIPE);
    if (pipesLateMarked && !pipeQ.pending.length && PIPE_ORDER.every((g) => pipeQ.has(g))) { lmEnd('pipes.late'); pipesLateMarked = false; lmFact('pipesLate', reg.groups()); }
  }
  // the phone's build gate (engine/buildGate.js): every pipeline at the active count, the group building now, the first view's
  // assets (the lake's grids and the boat's models: the stream's end; the forest's and the towns' data); the span 'modes' (the
  // load report: first frame to the modes lit) and the fact 'build'
  const gateNames = reg.names().filter((n) => reg.groupOf(n) === 'core' || PHONE_ORDER.includes(reg.groupOf(n)));   // every group the queue builds (all of them)
  let gateBuiltAtReady = null;
  function gateTick() {
    let built = 0; for (const n of gateNames) if (reg.has(n)) built++;
    const group = PHONE_ORDER.find((g) => !reg.ready(g)) ?? null;   // the first group in the phone's order not built yet
    if (buildGate.update({ built, total: gateNames.length, group, assets: { lake: stream.doneMs != null, forest: forestDone && !forest?.queued, towns: townsDone } })) {
      gateBuiltAtReady = reg.built;
      lmEnd('modes');
      lmFact('build', { first: true, n: gateNames.length, built, ms: Math.round(performance.now() - firstFrameFromNavMs), atMs: Math.round(performance.now()) });
    }
  }
  let builtAtPlay = null;
  if (buildFirst && !P.headless) addEventListener('lakeshore:entered', () => { builtAtPlay ??= reg.built; }, { once: true });   // the player starts: no pipeline after this (stats pipelines.afterPlay)
  const labelEl = document.getElementById('label-hour'), windEl = document.getElementById('label-wind');
  const hh = () => { const h = clock.hour, m = Math.floor((h % 1) * 60); return `${String(Math.floor(h)).padStart(2, '0')}:${String(m).padStart(2, '0')}`; };
  let lastLabel = '';
  const boatEl = document.getElementById('label-boat');
  function label() {
    const st = B?.state, bs = st ? `${(st.sog / 0.514444).toFixed(1)}|${Math.round(st.heading * 57.2958)}|${Math.round(st.heel * 57.2958)}` : '';
    const s = `${hh()}|${windNow.speedMs.toFixed(1)}|${Math.round(windNow.dirDeg)}|${bs}`;
    if (s === lastLabel) return;
    lastLabel = s;
    if (labelEl) labelEl.textContent = hh();
    if (windEl) windEl.textContent = `${(windNow.speedMs / 0.514444).toFixed(0)} kn from ${String(Math.round(windNow.dirDeg)).padStart(3, '0')}°`;
    if (boatEl && st) boatEl.textContent = `${(st.sog / 0.514444).toFixed(1)} kn · ${String(((Math.round(st.heading * 57.2958) % 360) + 360) % 360).padStart(3, '0')}° · heel ${Math.round(Math.abs(st.heel * 57.2958))}°`;
  }

  hook._stats = () => {
    const g = graph.gpuMs();
    const tail = graph.gpuTail();
    const ts = terrain.stats;
    return {
      hour: +clock.hour.toFixed(4), cam: followOn ? 'follow' : pose.cam, eye: eye.map((x) => +x.toFixed(2)), look: eye.map((x, i) => +(x + fwd[i] * 50).toFixed(2)), fovDeg: +fovDeg.toFixed(2), seed: P.seed, exposure: P.exposure, sunElevationDeg: +sunNow.elevDeg.toFixed(2), sunAzimuthDeg: +sunNow.azDeg.toFixed(1),
      boat: B ? { ...B.row(), simMs: +simMs.toFixed(3), simMsMax: +simMsMax.toFixed(3), wind: windField.regime ?? (windField.day ? 'day' : 'steady'), render: boatR.stats, triangles: boatR.triangles, camera: followOn ? 'follow' : 'fixed' } : null,
      wind: { speedMs: +windNow.speedMs.toFixed(2), dirDeg: +windNow.dirDeg.toFixed(1), regime: windNow.regime, hsM: +water.significantHeight.toFixed(3) },
      gpuMs: g ? +g.total.toFixed(3) : null, gpuSpanMs: g ? +g.span.toFixed(3) : null, gpuPassOwnMs: g?.own ? g.own.map((x) => +x.toFixed(3)) : null, gpuPassMs: g ? g.passes.map((x) => +x.toFixed(3)) : null, gpuPassNames: graph.passes.map((p) => p.name),
      gpuMsMedian: tail.length ? +tail.slice().sort((a, b) => a - b)[tail.length >> 1].toFixed(3) : null,
      gpuMsP90: tail.length ? +tail.slice().sort((a, b) => a - b)[Math.floor(tail.length * 0.9)].toFixed(3) : null,   // perf(v2) phone round 2: the heavy frames (a half-rate pass lands on every 2nd)
      gpuWorkMs: g?.work != null ? +g.work.toFixed(3) : null,   // fix(v2) governor: what the governor reads
      ...(() => { const s = graph.gpuWorkTail().slice().sort((a, b) => a - b); return s.length ? { gpuWorkMedian: +s[s.length >> 1].toFixed(3) } : {}; })(),
      ...(() => { const s = graph.gpuSpanTail().slice().sort((a, b) => a - b); return s.length ? { gpuSpanMedian: +s[s.length >> 1].toFixed(3), gpuSpanP90: +s[Math.floor(s.length * 0.9)].toFixed(3) } : {}; })(),   // perf(v2) phone round 2: the busy span (what the governor reads)
      gpuPassOwnMedian: graph.gpuOwnMedians().map((x) => +x.toFixed(3)),   // perf(v2) phone round 2: each pass's own share of the span
      gpuPassMsMedian: graph.gpuPassMedians().map((x) => +x.toFixed(3)),
      calls: graph.counters.calls, triangles: graph.counters.triangles, dispatches: graph.counters.dispatches,
      pixelRatio: +(canvas.width / (sizer.css[0] || canvas.width)).toFixed(3), size: [canvas.width, canvas.height], scale: +scale.toFixed(3),
      pipelines: { total: reg.built, compute: reg.computeCount, afterFirstFrame: lateBuilds, buildFirst, declared: gateNames.length, atReady: gateBuiltAtReady, afterPlay: builtAtPlay == null ? null : reg.built - builtAtPlay, gate: buildGate.state(), perCount: reg.perCount, counts: reg.counts, background: reg.background(), deferred: pipesDefer, slow: pipesSlow, groups: reg.groups(), timings: reg.timings() }, pipelineBuildMs: +pipelineBuildMs.toFixed(1), firstFrameMs: firstFrameMs == null ? null : +firstFrameMs.toFixed(1), firstFrameFromNavMs: firstFrameFromNavMs == null ? null : +firstFrameFromNavMs.toFixed(1),
      terrain: { variant, stage: ts.stage, streamed: !!ts.streamed, firstBytes: ts.firstBytes, bytes: ts.bytes, files: ts.files, swaps: ts.swaps, queued: terrain.queued, decodeMs: +ts.decodeMs.toFixed(1), landMsMax: +ts.landMsMax.toFixed(2), swapMsMax: +ts.swapMsMax.toFixed(2), firstMs: +terrainFirstMs.toFixed(1),
        grids: terrain.grids, instances: terrain.selector.count, perLevel: Array.from(terrain.selector.perLevel), overflow: terrain.selector.overflow, triangles: terrain.triangles, probe: probeResult, heightAt0: +terrain.field.height(eye[0], eye[2]).toFixed(3), log: ts.log },
      stream: { ...stream, worstFrameMs: +stream.worstFrameMs.toFixed(2), worstCpuMs: +stream.worstCpuMs.toFixed(2), uploadMsMax: +stream.uploadMsMax.toFixed(2) },
      forest: forest ? { ...forest.stats, log: undefined, variant: pickVariant(flags), atlas: forest.atlas } : null,
      clouds: clouds.stats,
      ground: ground.stats, rocks: rocks?.stats ?? null, tshadow: tshadow.stats,   // M5c
      mirrors: feature('boatMirrors').tier === 'all' ? { boats: boatR?.mirrorStats ?? null, kayaks: plug('kayaks')?.stats()?.render ? { calls: plug('kayaks').stats().render.mirrorCalls ?? 0, triangles: plug('kayaks').stats().render.mirrorTris ?? 0 } : null } : null,   // the boats' mirrors in the water
      ...plugins.stats('living'),   // kayaks (living/lakePlugins.js)
      ...plugins.stats('tessie'),   // Tessie (off: the policy's reason)
      stage: stage ? { ...stage.state, budget: stage.budget(), timeline: stage.timeline.slice(-40) } : null,   // the stage director (v2/stage/director.js)
      ...plugins.stats('birds'),   // birds; #24: the dive director and its splash
      ...plugins.stats('show'),   // the fireworks
      towns: { ...towns.stats, log: undefined },   // 10a
      shore: shore ? { ...shore.stats } : null,   // #56 M3
      landmarks: { ...landmarks.stats },   // G1, G2
      night: { ...night.stats, moonAltDeg: +night.moon.moonAt(clock.hour).altDeg.toFixed(2), moonLit: +night.moon.moonAt(clock.hour).lit.toFixed(3) },   // M5e
      storm: { ...storm.info, running: storm.running, draw: stormDraw?.stats ?? null, on: stormOn, windGain: +windStorm.gain.toFixed(3), weather: wx.current(), audio: audio.state.state },   // M5e
      beds: beds?.stats() ?? null,   // step 3: the beds (nodes, the main-thread ms a frame)
      music: music?.stats() ?? null,   // music: the cues, the bus's holder, the loads
      readback: { reads: water.ring.reads, skipped: water.ring.skipped, bytes: water.ring.bytes, slots: water.ring.slots, adopted: water.surface.adopted, heightAt0: +water.heightAt(0, 0).toFixed(4) },
      governor: { ...gov.state(), refresh: refreshInfo, aim: gov.aim }, pacing: pacer?.state() ?? null, quality: { level: Q.level, name: LEVELS[Q.level].name, source: Q.source, why: Q.why, pending: Q.pending, built: Q.built, ladder: ladder.state(), race: raceQ.state(), caps: sizer.caps, msaa: msaaState() }, msaa: graph.msaa, timestamps: graph.hasTimestamps, adapter: gpu.info, simT: +clock.t.toFixed(4), steps: clock.steps,
      clock: { mode: clock.mode, rate: +clock.rate.toFixed(4), running: clock.running, cuts: clock.cuts, hourUnwrapped: +clock.hourUnwrapped.toFixed(5) },   // the day clock (engine/clock.js)
      mode: modes.now(), cruise: cruise?.stats() ?? null,   // Cruise (v2/cruise)
      regatta: regatta?.on ? regatta.state() : null, race: { loaded: !!regatta, on: !!regatta?.on, lines: raceLines ? { ...raceLines.stats } : null, props: raceProps ? { ...raceProps.stats } : null },   // Regatta: the guard reads the draws (0 outside a race)
      aids: { marks: aids.length, near: aidsNear, drawn: navAidsFx?.stats.instances ?? 0, draws: navAidsFx?.stats.draws ?? 0, lit: night.stats.race, bumps: aidBodies.stats.bumps, contacts: aidBodies.stats.contacts },   // channel markers
      moorings: { balls: moorings.length, near: ballsNear, bumps: ballBodies.stats.bumps }, ...plugins.stats('lake'),   // the boats at anchor, the busy lake, the glass boat (living/lakePlugins.js)   // the anchorage cues
    };
  };
  hook.wgsl = () => reg.modules();   // the phone pass: every module's text (the Safari scan)
  hook.settings = () => pageSettings();   // the page's settings store (the page tests write proMode through it)
  hook.m4 = m4;             // M4: the views, the UI (its services: station, calm, hint, viewSwitch …) and the cockpit
  hook.aids = { marks: aids, bodies: aidBodies, poses: aidPoses, get near() { return aidsNear; }, get fx() { return navAidsFx?.stats ?? null; } };   // channel markers: the harness's read
  hook.moorings = { balls: moorings, bodies: ballBodies, get near() { return ballsNear; } };   // the anchorage cues: the Boat Camp's balls
  hook.regatta = { get r() { return regatta; }, load: () => regattaLoad(), state: () => regatta?.state() ?? null, get lines() { return raceLines; }, get props() { return raceProps; }, kit: () => raceKit() };   // Regatta
  if (beacon && B) {   // Sail's double-tap mark: Sail only (Cruise's own double-tap sets its navigator's mark; a race has its marks)
    beacon.mark = createSailMark({ waterAt: (x, y) => waterUnder(invVP, canvas.getBoundingClientRect(), x, y), depthAt: (x, z) => -terrain.field.height(x, z), boat: () => B.state,
      active: () => !cruise?.on && !regatta?.on, say: (text, kind = 'reply') => m4.ui?.services?.get('hint')?.flash?.(text, { secs: 4, kind }),
      nav: () => ({ on: !!m4.ui?.services?.get('pilot')?.engaged, touch: !!m4.ui?.services?.get('modality')?.touch }), onSet: (navOn) => { if (!navOn) m4.ui?.services?.get('navPulse')?.(); } });   // the line names NAV ("Mark set. Click NAV to sail there.") and NAV pulses once   // reply: the double-tap's answer (a phone keeps it); refuse.mark: a refusal (the lean skipper's MUST)
    beacon.mark.attach(canvas);
  }
  hook.beacon = beacon ? { fx: beaconFx, sim: beacon.sim, pin: (x, z) => { beacon.pin = x == null ? null : { x, z }; }, get mark() { return beacon.mark; }, setDraw: (on) => { beacon.draw = !!on; }, state: () => ({ ...beacon.sim.state(), fx: { ...beaconFx.stats } }) } : null;   // the target beacon (captures, the A/B)
  hook.cruise = { get c() { return cruise; }, load: () => cruiseLoad(), stats: () => cruise?.stats() ?? null };   // Cruise: the controller (voyage, takeHelm, handBack, markAt …)
  hook.water = water;       // water.heightAt(x, z) for the harness and M3
  hook.terrain = terrain;   // terrain.field.height(x, z): the CPU twin of the drawn ground (v1's heightAt once the full grids are in)
  hook.forest = forest;     // M5b: the forest's stats and tile picker
  hook.setForestDraw = (on) => { L.forest = !!on && !!forest && layer('forest'); };   // T5: the in-page A/B (the cards' draw off and on, the same frame)
  hook.ground = ground; hook.rocks = rocks; hook.tshadow = tshadow;   // M5c: the photo stream, the boulders, the shadow (the harness and the A/B)
  Object.assign(hook, plugins.hooks());   // the plug-ins' handles (living/lakePlugins.js): kayaks, Tessie (and her player, tessiePose), the fireworks
  hook.stage = stage;       // the stage director: its state and timeline (the tests, films)
  hook.played = player;   // the played seam (engine/player.js); Tessie's handles (tessie, tessiePlay, tessiePose) are her row's hooks
  // play as Tessie, phase 2a: the eye under the water (the page tests and the evidence): the flag, the frame rows, which twins are built
  hook.under = () => ({ tier: underTier, on: UNDER_STATE.on, split: underSplitOn, depth: +underNow.depth.toFixed(3), surface: +underNow.h.toFixed(3), stops: +underStops.toFixed(3),
    built: Object.fromEntries(['water-under', 'terrain-under', 'rocks-draw-under', 'rocks-bed-draw-under', 'tessie-body-under', 'boat-solid-under', 'boat-glb-under', 'kayak-skin-under', 'under-back', 'under-merge', 'under-speck', 'under-bubble', 'under-shaft', 'under-shaft-up'].map((n) => [n, !!reg.has?.(n)])), back: underBack?.stats ?? null,
    light: underLight ? { ...underLight.stats, pool: bubbles.count, emitted: bubbles.emitted } : null });
  hook.bubbles = bubbles;   // phase 2b: the bubbles' pool (the tests and the evidence)
  hook.hunts = () => hunts;   // the cups' hunts: the page tests' and the evidence's corners     // Tessie: the director, the body and the renderer (null where the policy keeps her off)
  hook.intro = intro;   // the cinematic intro's state (the page tests)
  // the boat's points in the frame drawn now: each |ndc y| (0 the centre, 1 the frame's edge) and the band's share (the page tests: the
  // whole boat inside the letterbox)
  hook.introProbe = () => { if (!B) return null; const c = { pos: [...eye], target: [eye[0] + fwd[0], eye[1] + fwd[1], eye[2] + fwd[2]], up: [...up], fov: fovDeg }; return { band: bandShare(canvas.width, canvas.height), fov: fovDeg, y: INTRO_PTS.map((p) => +ndcYMax(c, [hullToWorld(B.pose, p)]).toFixed(4)) }; };
  if (B && !P.headless) m4.uiReady.then((u) => u?.services?.provide?.('intro', intro)).catch(() => {});
  if (B) m4.uiReady.then((u) => u?.services?.provide?.('played', player)).catch(() => {});   // the played seam for the UI (the Calm HUD, Sail's dash)   // the station's cockpit hold (sail.js)
  if (B && !P.headless) addEventListener('lakeshore:entered', () => { const m = m4.front?.home?.mode ?? modeNow(); intro.start(m); }, { once: true });   // the home card's first entry (src/ui/home.js); later entries are mode switches
  hook.camera = { eye, fwd, get fov() { return fovDeg; }, set fov(v) { fovDeg = v; } };   // kayaks: a pinned view's eye and aim, for the paddlers' tracking film (tools/v2-kayak-film.mjs)
  hook.night = night;   // M5e: the night's stats, its moon and loader
  hook.landmarks = landmarks;   // G1, G2: the landmarks' stats, the flags' sim (flight(i), sites)
  hook.shore = shore;   // #56 M3: the shore's stats, the field, on (the in-page A/B: tools/v2-ab-shore.mjs)
  hook.towns = towns;   // 10a: the shore's stats and arrays; setTownsDraw: the in-page A/B (the shore's draw and the ground's marks off and on)
  hook.setTownsDraw = (on) => { L.towns = !!on && layer('towns'); towns.setMarks(!!on); };
  hook.setTownsShadow = (on) => towns.setShadow(on);
  hook.setTownsMirror = (on) => towns.setMirror(on);   // #41c: the shore's mirror off and on in place (the A/B)   // #41: the shore's shadow caster off and on in place (the A/B)
  hook.setSpume = (on) => { spumeOn = !!on; };
  // the post chain's in-page A/B (tools/v2-bloom-dither.mjs): the bloom (where built) and the dither off and on, the strength
  hook.setPost = (o = {}) => { if (o.bloom != null) postState.bloom = !!o.bloom; if (o.dither != null) postState.dither = !!o.dither; if (Number.isFinite(o.k) && o.k >= 0) postState.k = o.k; for (const n of ['threshold', 'knee']) if (Number.isFinite(o[n]) && o[n] >= 0) postState[n] = o[n]; return hook.post(); };
  hook.post = () => ({ bloomBuilt: bloomOn, bloom: bloomOn && postState.bloom, k: postState.k, threshold: postState.threshold, knee: postState.knee, dither: postState.dither, levels: post.levels, sizes: post.sizes, passes: post.passes, ramp: postState.ramp });
  hook.setSpeedFeel = (on, parts = { fx: true, cam: true, sound: true }) => { if ('pin' in parts) feelPin = parts.pin ?? null; if (parts.fx) feelOn = !!on; if (parts.cam && B) B.speedFeel = !!on; if (parts.sound) beds?.setSpeedFeel(on); feelFrame(); return { fx: feelOn, cam: !!B?.speedFeel, lee: { ...leeNow }, cam_k: B?.speedCam ?? 0 }; };   // the speed feel's in-page A/B   // the spume's in-page A/B (tools/v2-ab-m5e.mjs --what spume)
  hook.setWindFx = (o = {}) => { for (const k of ['tex', 'gust', 'lanes', 'caps']) if (o[k] != null) windFx[k] = !!o[k]; return { ...windFx }; };   // audit W1–W3's in-page A/B
  hook.windTex = windTex; hook.windBlend = windBlend; hook.windField = windField;   // refactor round 3 B6b: the probes read its texture caches
  hook.gust = gust;   // audit W4: the payoff's state (stats.onsets, last) for the films and probes
  hook.setNight = (on) => { nightOn = !!on; };   // the in-page A/B (tools/v2-ab-m5e.mjs): the night's draws and levels off and on without a reload
  hook.raceLit = (on) => { raceLitOn = !!on; return night.stats.race; };   // step D: the lit marks' A/B
  // step 3: the beds' input now, as plain data (the state's fields the mixers read), for the offline film
  const BEDS_STATE = ['sog', 'heading', 'heel', 'pitch', 'x', 'z', 'apparentWind', 'trueWind', 'mainFill', 'jibFill', 'mainTopFill', 'jibTopFill', 'drive', 'side', 'mainStall', 'surf', 'slam', 'rail', 'roundUp', 'groove', 'grooveHeld'];
  hook.music = music;   // music: stats(), the core, setMode (v2/audio/music.js)
  hook.beds = B ? { input: () => { const i = bedsInput(); return JSON.parse(JSON.stringify({ ...i, state: Object.fromEntries(BEDS_STATE.map((k) => [k, i.state[k] ?? null])) })); }, live: beds } : null;
  hook.storm = storm; hook.weatherMenu = wx; hook.weatherWind = weatherWind; hook.weatherLook = wlook; hook.lens = lensRec;   // M5e: the storm (start, stop, choose, strikesFrom) and the Weather menu
  // M3: the boat for the harness: the hands (held until the next call), a trace row, the sim and the render module
  hook.sea = sea; hook.exhaust = exhaustFx; hook.engineSound = () => engineSound;   // #8, #14: the engine, the tackle, the exhaust, the sound
  hook.hands = hands ? { get now() { return { steer: handsNow.steer, pull: handsNow.pull }; }, get fingers() { return hands.fingers; }, get multi() { return hands.multi; } } : null;   // BACKLOG-v2 #2: the page tests read the one-finger hands
  hook.boat = B ? { sim: B, render: boatR, wind: windField, input: (o) => { handsNow.steer = o.steer ?? 0; handsNow.pull = o.pull ?? 0; handsNow.orbit = o.orbit ?? null; handsNow.zoom = o.zoom ?? 0; }, row: () => B.row(), get state() { return B.state; },
    film: (on = true) => { filmOn = !!on; } } : null;   // film(true): v1's film contract (the capture's helm on the start heading, the crew's trim) for the trace comparison

  if (P.headless) {
    // a capture: the whole set in before the first frame (deterministic), the GPU probe against the CPU twin, then the
    // capture drives every frame itself
    await terrain.stream(stages, tBase, { budget: Infinity });
    probeResult = await terrain.runProbe();
    await towns.prime();                // 10a: the shore and the ground's marks in first (the forest's place and scatter read the marks)
    await landmarks.prime();            // G1, G2: the landmarks and the flags before the first frame
    await teaHouseLoad();               // the tea house (a desktop's) before the first frame
    if (shore) await shore.prime();     // #56 M3: the shore field before the first frame (deterministic)
    if (forest) await forest.prime();   // M5b: the forest's files, atlas, place and scatter before the first frame
    await ground.prime(eye);            // M5c: every photo tile and the detail set in before the first frame (deterministic)
    if (rocks) await rocks.prime();     // M5c: the boulders scattered before the first frame
    await plugins.prime('terrain', 'capture');   // birds: the flock on the whole terrain (a capture with ?birds=1)
    if (modelOn) await boatR.models.loadAll(modelUrls, modelOpts);   // M3b: the boat's models in before the first frame (deterministic)
    await plugins.prime('show', 'capture', clock.t - P.t0);   // the fireworks: the show seeked to its pinned time before the first frame
    await night.load();                 // M5e: the Milky Way, the stars and the lights in before the first frame (deterministic)
    if (B) {
      // the boat's settle (v1's settleCapture: ?settle= s of sim at 1/60 on the start heading, 20 by default): the water's
      // readback first (three frames fill the ring), so the float reads the drawn surface
      for (let i = 0; i < 3; i++) { drawFrame(); await graph.settle(); }
      // Cruise (v1's capture: the boat at Cruise's start, settled on her heading, then ?chillsettle= s sailed and directed)
      if (cruiseBoot) { const c = await cruiseLoad(); await c.ready; const sp = c.voyage.place(); Object.assign(startPose, { x: sp.x, z: sp.z, headingDeg: sp.headingDeg }); }
      if (raceBoot) { const r = await regattaLoad(); await r.enter(); r.settle(Number.isFinite(parseFloat(flags.racet)) ? parseFloat(flags.racet) : 0); }   // Regatta: in the box, then ?racet= s of the race sailed (the helper, ?autoplay's pro)
      else B.settle(Number.isFinite(parseFloat(flags.settle)) ? parseFloat(flags.settle) : 20);
      if (cruise) { cruise.start(); cruise.settle(); }
      if (followOn) placeCamera(1);
      await plugins.prime('boat', 'capture');   // kayaks: the shore grids and the asset in, the fleet made, the first pair laid in view (v1's capture start)
      feelFrame();   // the speed feel's lee foam for the first frame (the settled pose)
      await plugins.prime('tessie', 'capture');   // Tessie (a capture only with ?tessie=): the model in; ?tessie=now places a sighting now
      water.resetFoam(); hook.frames = 0; hook.resetCounters();   // the ring's frames leave no trace: the first counted frame is M2's first frame
    }
    drawFrame(); await graph.settle();
    hook.renderOnce = async () => { const n = clock.step(); simFrame(n, clock.dt); drawFrame(); await graph.settle(); };
    hook.drawOnce = async () => { drawFrame(); await graph.settle(); };   // the same frame again, no step (an in-page A/B on one frozen frame)
    return;
  }
  hook.renderOnce = async () => { const n = clock.step(); simFrame(n, clock.dt); drawFrame(); await graph.settle(); };
  if (B && followOn) placeCamera(1);
  // --- M4: ?filmui=1, the live UI on the film clock (tools/goldens.mjs steps filmFrame(dt) under Playwright's paused clock):
  // everything streamed in first (as a capture), then no loop of its own ---
  if (filmUi) {
    await terrain.stream(stages, tBase, { budget: Infinity });
    if (modelOn) await boatR.models.loadAll(modelUrls, modelOpts);
    townsLoad = towns.prime(); await townsLoad;   // 10a: before the forest (its keep-out)
    landmarksLoad = landmarks.prime(); await landmarksLoad; await teaHouseLoad();   // G1, G2; the tea house (a desktop's)
    if (shore) { shoreLoad = shore.prime(); await shoreLoad; }   // #56 M3
    if (forest) { await forest.prime(); forestLoad = Promise.resolve(); }   // M5b's capture path: the whole forest in first
    await plugins.prime('terrain', 'filmui');   // birds: the film's flock on the whole terrain
    nightLoad = night.load(); await nightLoad;   // M5e
    groundLoad = ground.prime(eye); await groundLoad;   // M5c's capture path: every photo tile and the detail set in first (a live load lands them on the wall clock, a different film frame each run)
    await cockpit?.ready; await m4.uiReady;
    await plugins.prime('boat', 'filmui');   // kayaks: in before the film's first frame (deterministic), as a capture

    await plugins.prime('tessie', 'filmui');   // Tessie: as a capture
    await m4.mountChart();   // the passage plan's chart in before the film (never landing on a film frame of its own)
    if (raceBoot) { const r = await regattaLoad(); await r.enter(); if (followOn) placeCamera(1); }   // Regatta: in the box before the film's first frame
    const filmFrame = async (dt) => { const n = clock.advance(dt * (regatta?.on ? regatta.speed() : P.speed)); simFrame(n, dt); drawFrame(); if (dt > 0) await graph.settle(); };   // v1's game speed (P.speed)
    // the first frame (the loading card's ready) and its water readback adopted BEFORE the hook appears: the hook went up
    // first, so film frame 0's float read either the flat start or the first frame's surface, by a race with the GPU map
    // (two boat states, ≈ 5 cm apart after 400 frames: the hud frames' glint drift, fix(v2) 2026-11-13)
    drawFrame(); await graph.settle();
    await m4.captainReady;   // #5: the binoculars' chunk (?bino=1: the golden v2-binoculars) in before the film
    await m4.frontReady;   // the front door's chunk (it wires Sail's UI: Pro, the menu) in before the film too, never on a film frame of its own
    hook.filmFrame = filmFrame;
    return;
  }
  // --- end M4 ---

  // --- the live loop: wall dt → fixed steps; the governor fed with the GPU time when it exists, else the frame time ---
  let prev = performance.now();
  stream.active = true; stream.startMs = performance.now() - t0;
  // M3b: the boat's models start after the first frame, beside the terrain's stream (a worker fetches, builds, decodes)
  // perf/v2-phone-load: both after the cockpit's asset (cockpitGate above)
  const modelsP = modelOn ? cockpitGate.then(() => pipeQ.ready('boatModels')).then(() => boatR.models.start(modelUrls, modelOpts)) : Promise.resolve();   // perf(v2) iOS pipelines: once their pipelines are built
  cockpitGate.then(() => terrain.stream(stages, tBase)).then(async () => {
    await modelsP;
    while (terrain.queued || boatR?.models.queued) await new Promise((r) => setTimeout(r, 16));
    stream.doneMs = performance.now() - t0; stream.active = false;
    plugins.prime('terrain', 'live');   // birds: the flock once the heights are whole
    streamDone();   // Cruise: its chart reads the whole terrain
    if (cruiseBoot) cruiseLoad().then((c) => c.enter({ fresh: true })).catch((e) => errors.push(`cruise: ${e?.stack ?? e}`));   // a page opened in Cruise: it sails from Cruise's start
    m4.mountChart({ plan: false });   // M4: the small chart's depth grid reads the whole terrain; the planner and its chart on the chart's first opening
    probeResult = await terrain.runProbe();
  }, (e) => { errors.push(`terrain stream: ${e?.message ?? e}`); stream.active = false; });
  let sweepSeq = -1;
  hook.sweep = { start() { sweep = makeSweep(); sweep.start(performance.now()); }, get running() { return !!sweep?.running; }, get done() { return !!sweep?.done; }, results: () => sweep?.results() ?? null, lines: () => sweep?.lines() ?? [] };   // perf(v2) phone: tools/v2-phone-sweep.mjs
  if (raceBoot) modes.go(bootId).catch((e) => errors.push(`regatta: ${e?.stack ?? e}`));   // a page opened in Regatta: in the box at −0:45 from the first frames
  idleStop = true; probe.setIdle(idleBudget(idleDts));   // perf(v2) phone round 2: the refresh as measured during the load
  const tick = (ts) => {
    if (pacer && !pacer.due(ts ?? performance.now())) { requestAnimationFrame(tick); return; }   // perf(v2) phone 30 fps: an even 33.3 ms (the sim reads the real time between drawn frames)
    const now = performance.now(), dtMs = now - prev, dt = Math.min(0.25, dtMs / 1000); prev = now;
    if (MS.dtNext) { MS.dtNext = false; MS.switches.at(-1).dtMs = +dtMs.toFixed(2); }   // #31: the switch frame's interval
    if (stream.active && hook.frames > 2) { stream.frames++; stream.worstFrameMs = Math.max(stream.worstFrameMs, dtMs); }
    const n = clock.advance(dt * modes.speed());   // Regatta: real time (v1)   // v1's game speed: the sim, the wind, the water and the scene clock at 2 × real time (Cruise: 1 ×)
    simFrame(n, dt); sailClock.tick(dt);
    graph.setTag(sweep?.running ? sweep.next(now) : 0);   // perf(v2) phone round 2: the sweep's case and state ride this frame's timestamps
    if (document.documentElement.hasAttribute('data-lake-paused')) { requestAnimationFrame(tick); return; }   // a phone's menu map is opaque over the lake: the lake sleeps under it, the sim runs on (ui/chart/mapScreen.js)
    drawFrame();
    busyProbe?.sample();   // #32: no GPU timer: submit → the queue's work done (one in flight)
    const g = graph.gpuMs();
    if (MS.switches.length) { const s = MS.switches.at(-1); if (g?.tag === MSAA_TAG && s.gpuMs == null) s.gpuMs = +g.work.toFixed(3); }   // #31: the switch frame's GPU work
    // fix(v2) governor: the GPU's work (the passes' own shares: the busy span less its idle gaps), not the span
    const work = g ? g.work ?? g.span ?? g.total : null;
    probe.sample(now, work);   // perf(v2) phone round 2: a GPU-bound frame's interval is not the display's
    const cost = g ? work : dt * 1000;
    let pixMs = null; if (g?.own) { pixMs = 0; for (const i of pixPasses) pixMs += g.own[i] ?? 0; }   // the pixel-bound part (the scene, the composite)
    if (flags.diag === '2' && !sweep && now - t0 > 10000 && ladder.phase !== 'warm' && ladder.phase !== 'settling') { sweep = makeSweep(); sweep.start(now); }
    if (sweep?.running) { if (g && g.seq !== sweepSeq) { sweepSeq = g.seq; sweep.feed(g.tag, cost); } requestAnimationFrame(tick); return; }   // perf(v2) phone: the governor and the ladder wait
    // fix(v2) governor + #32: without a GPU timer the governor's cost is the work-done probe's span (an upper bound on the GPU's
    // busy time), never over the frame's interval, and the interval until the probe has its samples; the ladder keeps the
    // interval as its cost and reads the probe for its step ups
    const busy = g ? null : busyProbe?.span ?? null;
    scale = gov.feed(g ? cost : busy != null ? Math.min(busy, dtMs) : dtMs, now, dtMs, pixMs);
    // perf(v2) phone 30 fps: under the limiter the interval is the limiter's 33.3 ms, not the GPU's: without a timer the
    // ladder reads the probe's span (the frames' own interval still says when they miss), nothing until it has samples
    const lcost = pacer?.on && !g ? (busy != null ? Math.min(busy, dtMs) : -1) : cost;
    // step D2: a race running holds the page's ladder; the race's ladder steps down in its quiet moments (not when the level is
    // pinned: ?quality=, Setup's row, ?gov=0)
    const racing = !!regatta?.racing?.();
    if (racing && (!raceQ.active || regatta.raceN !== raceSeen)) { raceSeen = regatta.raceN; raceQ.start(now, Q.level); }
    else if (!racing && raceQ.active) raceQ.stop(now);
    ladder.hold(racing);
    const rq = racing && qHold == null && P.gov && Q.source !== 'pinned' ? raceQ.feed(dtMs, now, regatta.quiet()) : null;
    if (rq) {
      if (rq.rung === 'level') { applyLevel(rq.level, `${Q.startWhy} · ${rq.why}`, false, now); ladder.force(rq.level, now); }
      else Q.steps.push({ from: Q.level, to: Q.level, why: rq.why, at: +(now - t0).toFixed(0) });
      lmFact('raceQuality', { steps: raceQ.steps, why: rq.why });   // the load report's line
    }
    const st = qHold == null ? ladder.feed(lcost, now, canvas.width * canvas.height, gov.atFloor, { dt: dtMs, pixMs, busyMs: busy }) : null;   // the phone pass: the level (Setup's pin holds it)
    if (st) applyLevel(st.level, `${Q.startWhy} · ${st.why}`, st.store, now, st.measured);
    if (!MS.prebuilt && ladder.phase === 'settled' && !pipesSlow && !buildFirst) msaaPrebuild();   // #31: the other count's scene pipelines, in the background, once the settle has its numbers
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function showError(msg) {
  lmPoint('fail');
  track('load_fail', { stage: 'start', why: 'error', backend: 'webgpu', ms: performance.now() });   // v1's event: a failed start (the gate's 'failed' page)
  showNoGpu(msg, 'failed');   // the phone pass: the card says v2 could not start (not "no WebGPU"); the diag panel has the full message
  window.__veliaLoading?.dispose?.();   // front door: the loading card steps aside for the plain card
}

boot().catch((e) => { errors.push(String(e?.stack ?? e)); console.error(e); showError(String(e?.message ?? e)); });
