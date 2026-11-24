// The core every mode shares, loaded once: the renderer, the sky, the world, the post chain, the render loop and the
// capture contract (ready, renderOnce(), stats(), camera, provided to the services registry and mirrored on window.__lakeshore
// for tools/capture.mjs; the demos keep their own window.__lakeshore).
// boot(modeModule) builds it, then starts the mode (src/modes/README.md) and runs the loop with the mode's update(dt).
// Its parts: src/core/gpu.js (the device and its recovery), quality-boot.js (the tier and the governor), world.js (the
// world and its systems), post.js (the post chain), systems.js (the per-frame registry), loop.js (the frame and the loop).
import * as THREE from 'three/webgpu';
import { flags, hourFor, CAM, SEED, EXPOSURE, T0, FOG_A, FOG_B } from '../../../src/sim/core/params.js';
import { FAR_LOOK, farLookOn } from './farLook.js';
import { CAMERAS } from '../../../src/sim/core/presets.js';
import { createSky } from './sky.js';
import { createMilkyWay } from './milkyway.js';
import { createMeteors } from './meteors.js';
import { NIGHT_LIGHT_FLOOR } from '../../../src/core/milkyway-math.js';
import { guardLut, waitForLut } from './skyGuard.js';
import { applySkyFallback } from './skyFallback.js';
import { track } from '../../../src/metrics.js';
import { createWorld } from './world.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { CURRENT_VESSEL } from '../../../src/sim/vessels/current.js';
import { makePlace } from '../../../src/sim/place.js';
import { TimeOfDay, timeParams, FLY_HOUR } from '../../../src/sim/timeOfDay.js';
import { createDaylight } from '../daylight.js';
import { StreamManager } from '../stream/manager.js';
import { streamConfig } from '../stream/config.js';
import { workerPool } from '../stream/workers.js';
import { createServices } from '../../../src/sim/core/services.js';
import { topGpu, bootDone } from '../ui/diag.js';
import { isGpuError } from '../ui/gpuRecover.js';
import { warmScene, warmOn, fastYield, drawables, liveHooks, LATE } from './warmup.js';
import { setupSunShadow, shadowSizeFor } from './sunShadow.js';
import { lateOn as lateWanted, createLateQueue, frameBudget, budgetMs, BUDGET } from './lateWarm.js';
import { NATURAL, stormFromParams } from '../weather/storm.js';
import { toFlags } from '../../../src/sim/core/flags.js';
import { startGpu } from './gpu.js';
import { pickQuality } from './quality-boot.js';
import { createPost } from './post.js';
import { createSystems } from './systems.js';
import { checkModeOptions } from '../modes/options.js';   // the mode options schema
import { createFrame, startLoop } from './loop.js';
import { isHighlightDay } from '../../../src/sim/day.js';
import { showOn } from '../../../src/fireworks/share.js';

const msg = document.getElementById('msg');

// The loading screen's hooks (index.html's stub, then src/ui/loading.js); absent on pages without the card.
const stage = (name, f) => window.__veliaLoading?.stage(name, f);

// modeModule: a promise of the mode's module (the dynamic import() in src/main.js); fetched while the GPU starts.
export async function boot(modeModule, { services = createServices() } = {}) {   // services: the page's registry (src/core/services.js; src/main.js)
  const endFastYield = fastYield();   // the load's yields without waiting for display frames (Safari; src/core/warmup.js); undone at the first live frame
  const gpu = await startGpu({ flags, msg, stage });
  if (!gpu) return;   // the plain card: this browser cannot draw the lake
  const { renderer, D, touch, recover, gpuDead } = gpu;

  // --- Quality tiers (src/core/quality-boot.js): fixed before the world is built
  const { quality, safe, storage, applyRatio, setQuality, resetAuto, startGovernor, onLive } = await pickQuality({ renderer, D, touch, flags, stage });

  const mode = await modeModule;
  const options = checkModeOptions(mode.coreOptions?.(flags) ?? {}, { mode: flags.mode });   // the checked table (src/modes/options.js)
  services.provide('modeOptions', options);   // the mode in force's options, for the shared UI (src/modes/README.md): the shell keeps it in step
  const HOUR = hourFor(options.defaultHour ?? FLY_HOUR);
  // the lake this page sails (src/waters/current.js: ?waters=, the saved choice, the default): its profile goes to the
  // sky (its place and day) and the world (its terrain, bay and landmarks); the shared UI reads it as the 'waters' service
  const waters = services.provide('waters', CURRENT_WATERS);
  // the boat this page sails (src/vessels/current.js): assembleBoat and the Regatta rival take it from core.vessel
  const vessel = services.provide('vessel', CURRENT_VESSEL);

  const scene = new THREE.Scene();
  // far: 90 km, the real lake's far shore (≈ 33 km), the Sierra ring round it (the terrain's root reaches ± 41 km)
  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 90000);
  const preset = CAMERAS[CAM] ?? CAMERAS.A;
  camera.position.set(...preset.pos);
  camera.lookAt(...preset.look);
  if (preset.fov) { camera.fov = preset.fov; camera.updateProjectionMatrix(); }
  if (flags.drive != null) {   // ?drive=<t>: the fly autopilot's pose at time t (captures of the drift)
    const { cameraAt: at } = await import('../../../src/camera.js');
    const { makeTerrain } = await import('../../../src/sim/terrain.js');
    const p = at(parseFloat(flags.drive), makeTerrain().heightAt);
    camera.position.set(...p.pos); const c = Math.cos(p.pitch);
    camera.lookAt(p.pos[0] + Math.sin(p.yaw) * c, p.pos[1] + Math.sin(p.pitch), p.pos[2] - Math.cos(p.yaw) * c);
  }
  if (flags.campos != null) {   // ?campos=x,y,z&camlook=x,y,z: any viewpoint (proof captures)
    camera.position.set(...flags.campos.split(',').map(Number));
    camera.lookAt(...(flags.camlook ?? '0,0,0').split(',').map(Number));
    if (flags.camfov != null) { camera.fov = parseFloat(flags.camfov); camera.updateProjectionMatrix(); }   // a zoomed proof (feat/instruments: the shore flags)
  }
  camera.updateMatrixWorld();

  const { atmosphere, sunWorld, elev, matrixWorldToECEF, originECEF, place } = createSky({ renderer, scene, camera, hour: HOUR, exposure: EXPOSURE, fogA: FOG_A * flags.mist * (farLookOn(flags) ? FAR_LOOK.mistK : 1), fogB: FOG_B, mistGain: farLookOn(flags) ? FAR_LOOK.mistGain : 1, place: makePlace(waters) });
  // fix/sky-load: the LUT build's own errors are caught here (the library rethrew them into an unhandled rejection);
  // ?sky=fallback fails it on purpose (the plain sky's captures and the page test)
  // the boat's shadow map (High 2048, Balanced 1024, Low none; ?boatshadow=): set before any shader is
  // built, since the sun's castShadow is part of every lit material's key (src/core/sunShadow.js)
  const sunShadow = setupSunShadow({ renderer, scene, size: shadowSizeFor(quality.build, flags.boatshadow) });
  D.boatShadow = sunShadow?.size ?? 0;
  let lutError = null;
  guardLut(atmosphere.lutNode, (e) => { lutError ??= e ?? new Error('LUT build failed'); D.error('sky', `LUT build: ${lutError?.message ?? lutError}`); });
  if (flags.sky === 'fallback') lutError = new Error('forced (?sky=fallback)');
  // The Milky Way: in the sky's stars term; 4K, 2K on the Low tier (phones). Its textures load after the
  // first live frame, once the sun is below −6° (captures: before the probe).
  // The starlit night (owner, 2026-11-07: "a photographer's lens, not the naked eye"): the airglow, the
  // night light and the hand-set colours' light floor.
  // the July 4th show (S2; on by default since S5, ?fireworks=0 off): only on the map's highlight day
  // (src/fireworks/share.js showOn); it brings the evening's blue twilight and the post chain's fireworks stage
  const fireworksOn = showOn(flags, isHighlightDay(waters));
  const milkyway = createMilkyWay({ atmosphere, sky: scene.backgroundNode, place, matrixWorldToECEF, size: quality.name === 'low' ? 2048 : 4096, twilight: fireworksOn });
  scene.add(milkyway.nightLight);
  let sceneTime = T0;   // the scene clock: wind, water, clouds (core.setTime)
  const world = await createWorld({ waters, scene, camera, atmosphere, sunWorld, elev, hour: HOUR, mode: options, stage, renderer, tier: quality.build, classicWater: safe.level >= 2, services,
    now: () => sceneTime, tierName: () => quality.name });
  const { lod, wind, water, trees, clouds: cl, storm, env } = world;
  services.provide('terrain', world.terrain);   // the lake's terrain object (its lake, landmarks, place): the shared UI reads the lake from it

  // --- World streaming: one manager for the streamed systems. It follows the camera's
  // observed ground speed (prefetch along the predicted path, the near radius growing with speed) and time-slices the
  // uploads. Live pages run it every frame; captures (?headless) settle it before each frame, so a capture never shows
  // a tile in flight (tools/probe_stream.mjs turns that off to measure the hitches). ?stream=0: the old in-place builds.
  const headlessPage = flags.headless != null;
  const stream = flags.stream === '0' ? null : new StreamManager({ config: streamConfig(quality.build) });   // the tier's radii and upload budget
  if (stream) {
    stream.syncCaptures = headlessPage;
    const pool = workerPool(3);
    lod.attachStream(stream, { run: pool.run });
    trees.attachStream?.(stream, camera, { run: pool.run });
    water.attachStream?.(stream, pool.run);
    world.stream = stream;
  }
  if (!stream) { await trees.loadAll?.(); trees.holdAll?.(); }   // the whole forest and every far card, as before streaming
  // the governor's step down and Settings move the live knobs in play: the stream's radii and upload budget, the terrain's split
  onLive((tier) => { stream?.setTier(tier); lod.setSplit(tier.terrain.split); sunShadow?.setOn((tier.boat?.shadowMap ?? 0) > 0); });   // a step to Low stops the boat's shadow pass (no rebuild)
  let lastWall = null, forestDone = false, groundRefined = false;
  // a slow link draws the coarse photo ground and canopy first and the tier's after the first live frame (src/naip.js,
  // perf/slow-loading): when they land, the water's probe is captured again, as for the forest
  if (lod.material?.userData?.ground?.coarseFirst) lod.material.userData.ground.refined.then(() => { groundRefined = true; });
  async function streamFrame() {
    if (!stream) return;
    const now = performance.now(), dt = lastWall == null ? 0 : Math.min(0.25, (now - lastWall) / 1000); lastWall = now;
    if (stream.syncCaptures) { stream.update(camera, 0); if (!stream.idle({ due: true })) await stream.settleNow(camera); }
    else if (!headlessPage) stream.update(camera, dt);
    // the forest streamed in after the first frame: the water's probe is captured again, over frames, with all of it
    if (!forestDone && trees.forest?.complete()) { forestDone = true; if (!headlessPage) daylight.probeJob?.start(); }
    if (groundRefined) { groundRefined = false; if (!headlessPage) daylight.probeJob?.start(); }   // the fine photo ground landed (a slow link's coarse first): the reflections see it
    lod.update(camera.position);
  }

  // --- Time of day (D2): the clock owns the hour; the daylight applies it every frame (the
  // sky model's sun, the exposure, the hand-set light levels, the water's probe). Time follows the scene clock (Day Sail:
  // sim time, so 2×/4× runs the day too); frozen in captures and in fly mode unless ?timerate= is given.
  const { rate: TIMERATE } = timeParams(flags, { defaultHour: options.defaultHour ?? FLY_HOUR, defaultRate: options.timeRate ?? 0 });
  const daylight = createDaylight({ atmosphere, matrixWorldToECEF, originECEF, place, baseExposure: EXPOSURE, lum: 0.6 / EXPOSURE,
    fogColor: scene.userData.fogColor, sunDir: sunWorld, nightFloor: NIGHT_LIGHT_FLOOR, mistGain: farLookOn(flags) ? FAR_LOOK.mistGain : 1 });
  // a mode's rate schedule (Chill's quick night) runs only at the mode's own pace: not frozen, not under ?timerate=
  const schedule = TIMERATE > 0 && !flags.timerate ? options.timeSchedule ?? null : null;
  const clock = new TimeOfDay({ hour: HOUR, rate: TIMERATE, t0: T0, sunAt: daylight.sunAt, baseExposure: EXPOSURE, schedule });
  // Tahoe's day follows the light while time runs (a no-op for a steady wind). Frozen (captures, ?timerate=0) the wind
  // keeps its own real-time day, as before D2, so the goldens' 40 s settle is unchanged.
  if (TIMERATE > 0) wind.setClock?.((t) => clock.hourAt(t));
  daylight.collect(scene, { renderer });       // the world's hooks and the water's probe
  daylight.add(cl.daylight);
  daylight.add(milkyway.daylight);
  // shooting stars (src/core/meteors.js): live pages on a clear dark night, never in captures and films
  {
    const capture = headlessPage || !!flags.filmui || !!flags.film;
    const meteors = createMeteors({ seed: Number(SEED) || 1, enabled: !capture,
      dark: () => milkyway.dark(0.8) && (cl.layers?.at?.(-1)?.coverage?.value ?? 0) <= 0.6 && !storm?.running });
    meteors.setCamera(camera); scene.add(meteors.mesh); daylight.add(meteors.daylight);
    milkyway.meteors = meteors;
  }
  // the sun as of the last frame, for the modes (a logbook "sunset" entry reads core.sun.elevationDeg)
  const sun = { hour: HOUR, elevationDeg: Math.asin(elev) * 180 / Math.PI, direction: sunWorld, exposure: EXPOSURE, light: 1 };
  function applyDaylight() {
    const f = daylight.update(Object.assign(clock.tick(sceneTime), { time: sceneTime }));   // time: the scene clock (the stars' twinkle)
    sun.hour = f.hour; sun.elevationDeg = f.elevDeg; sun.exposure = f.exposure; sun.light = f.light;
    return f;
  }
  applyDaylight();   // the start light, before the probe capture below sees the scene
  // captures and films: the Milky Way's textures before the probe and the first frame when the night may need them
  if ((headlessPage || flags.filmui) && sun.elevationDeg < -3) { D.bootStep = 'milkyway'; await milkyway.load(); }

  // --- Post (src/core/post.js): aerial perspective, clouds, the storm's grade, the helm's objects, AgX and the AA finish
  const pc = await createPost({ renderer, scene, camera, quality, water, daylight, clouds: cl, weather: world.weather, flags, fireworks: fireworksOn });
  const { post, hud, scenePass } = pc;

  // --- The frame's systems (src/core/systems.js): the world's (the storm, the water, the trees …, the sound), and the
  // core's round them: the stream and the daylight first, the GPU counters, the helm's objects and the draw (loop.js)
  const systems = createSystems();
  for (const s of world.systems) systems.add(s);
  const frame = createFrame({ systems, renderer, pc, water, trees, quality, sun, env, streamFrame, applyDaylight, CAM, SEED, D, time: () => sceneTime, headless: headlessPage });
  const { renderOnce, stats } = frame;

  // iOS reports the new size a beat after a rotation: tell everything that listens to resize once more
  window.addEventListener('orientationchange', () => { setTimeout(() => window.dispatchEvent(new Event('resize')), 350); });
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    applyRatio();
  });

  stage('sky', 0.72);
  // fix/sky-load: the sky stage never fails the load. Its steps are told in load_fail ('sky:compile' …, src/main.js):
  // live, the stage is the probe and the first frame's shader compile (2.3 s on the Mac, 73 s on SwiftShader), not the
  // LUTs. A LUT build that throws or overruns its budget gives the plain sky (src/core/skyFallback.js) and a
  // non-fatal sky_fallback event instead of a black sky.
  let skyFallback = null;
  const useSkyFallback = (reason) => {
    if (skyFallback) return;
    skyFallback = String(reason).slice(0, 100); D.skyFallback = skyFallback; D.error('sky', `fallback: ${skyFallback}`);
    applySkyFallback({ scene, sunWorld, elev, lum: 0.6 / EXPOSURE });
    pc.plainSky();
    track('sky_fallback', { reason: skyFallback });
  };
  if (lutError) useSkyFallback(lutError.message);
  // captures: the whole forest before the probe sees the scene (live pages re-capture it when the forest completes)
  if (stream?.syncCaptures) { D.bootStep = 'probe'; await stream.settleNow(camera); }
  // perf/shader-warmup: the first frame's pipelines (the scene pass: its MSAA target and
  // MRT) built behind the card, an object per task, several at once, instead of inside the first draw (one block of
  // 0.7 s on this Mac, 16 s on WebGL2, 38 s on SwiftShader). Its sky object also starts the LUT build, so the probe
  // skips its plain first render (a whole frame drawn to the canvas only to start the LUTs). ?warm=0: off.
  // WebGL2's parallel compile is polled from requestAnimationFrame, which a hidden tab never runs: a page loading in a
  // background tab builds as before (in the draws), so it never waits for the tab to be shown
  const warm = warmOn(flags) && !(D.backend === 'webgl2' && document.visibilityState === 'hidden') ? pc.traaWarm((root, cam, o) => warmScene(renderer, root, cam, { scene, lanes: flags.warmlanes > 0 ? flags.warmlanes : undefined, passDepth: pc.passDepth, ...o })) : null;
  D.warm = [];
  // perf/ready-first-frame: a live page is ready at its first frame; what that view does not draw is
  // built after, between live frames (the late queue below): the objects out of the start view, the HUD's, the birds' and the
  // storm's hidden parts, the probe's re-capture. Captures (?headless) and films (?filmui) build as before (their draws
  // wait for every build, so no picture changes); ?latewarm=boot builds everything behind the card, as before.
  const lateOn = lateWanted({ warm, headless: headlessPage, filmui: !!flags.filmui, latewarm: flags.latewarm });
  const lateOut = [];   // the objects out of the start view (warmed later, nearest first); two-pass ones built through their twins
  const outOfView = () => { const two = []; const l = drawables(scene, camera, { cull: false, view: 'out', twoPassOut: two }); return [...l, ...two]; };
  if (warm) {
    D.bootStep = 'warm';
    await water.prepare?.(renderer);   // the probe's placeholder first (captureProbe would make it next): the water's shader depends on it
    D.warm.push(['frame', await warm(scene, camera, { pass: scenePass, cull: false, view: lateOn ? 'in' : null })]);
    if (lateOn) lateOut.push(...outOfView());
  }
  D.bootStep = 'probe';
  try { await water.captureProbe(renderer, scene, camera, { warm: warm && (async (cam, target) => { D.warm.push(['probe', await warm(scene, cam, { target, mrt: null })]); }) }); }   // T3c: the reflection probe (no pale edge bands)
  catch (e) { if (isGpuError(e)) throw e; D.error('sky', `probe: ${e?.message ?? e}`); track('sky_fallback', { reason: `probe: ${e?.message ?? e}` }); }   // no probe: the water's sky term only
  if (lutError) useSkyFallback(lutError.message);

  // The sky's scattering LUTs are built asynchronously from the first frame (the library notes the race).
  // Render once to start it, then wait until the build ends, else early frames (and captures) have a black sky.
  D.bootStep = 'compile';
  try { await renderOnce(); }
  catch (e) {   // a first frame that throws (a sky shader on a weak driver): once more on the plain sky
    if (isGpuError(e) || skyFallback) throw e;
    useSkyFallback(`render: ${e?.message ?? e}`);
    await renderOnce();
  }
  D.bootStep = 'lut';
  if (!skyFallback) {
    const lutWait = await waitForLut(atmosphere.lutNode, { failed: () => lutError, hidden: () => document.visibilityState === 'hidden' });
    if (!lutWait.ok) useSkyFallback(lutWait.reason);
  }
  D.bootStep = 'frame';
  frame.resetCounters();
  await renderOnce();
  D.bootStep = 'mode';
  let readyAt = null;
  let startLate = null;   // set below, once the mode is up: the late warm-up's start (perf/ready-first-frame)
  const firstFrame = () => { milkyway?.arm(); endFastYield(); window.__veliaLoading?.ready(); if (readyAt == null) readyAt = performance.now(); startLate?.(); if (safe.mark) { bootDone(storage); safe.mark = false; } };   // idempotent: the card dissolves once the first live frame is drawn
  const headless = flags.headless != null;

  // --- The mode: what the modes may use (src/modes/README.md) ---
  // core.services: the registry as the running mode sees it (a scope: what the mode provides goes when it is disposed)
  let modeScope = services.scope();
  const core = {
    flags, headless, msg, stage, T0, SEED, HOUR, services: modeScope,
    waters,   // the lake's profile (src/waters/current.js); its terrain object is world.terrain
    vessel,   // the boat's profile (src/vessels/current.js)
    tier: quality.build,   // the quality tier the world was built with (src/quality/apply.js): the air's pools, the boat's textures
    renderer, scene, camera, atmosphere, sunWorld, elev, hud, milkyway, sunShadow,   // sunShadow: the boat's shadow map (src/core/sunShadow.js), null on Low   // milkyway: src/core/milkyway.js
    ...world,   // stream: the streaming manager, or undefined with ?stream=0; storm: the thunderstorm (wow/storm)
    clock, daylight, sun,   // D2: the time of day; sun = { hour, elevationDeg, direction, exposure, light }, per frame
    renderOnce,
    // a mode's object built in play, its pipelines built before it is shown (src/core/warmup.js, compileAsync: no block in
    // the draw); null with ?warm=0. The kayaks' full paddler (src/kayaks/fleet.js) waits on it at mid
    warm: warm ? async (root, { live: liveWant = null } = {}) => {
      // live: the caller's choice (the one-tap show, src/sail/showNow.js: frame-safe in play on every page, films too), else
      // in play on a live page with the late warm-up
      const live = liveWant != null ? liveWant && readyAt != null : lateOn && readyAt != null;
      const r = await warm(root, camera, { pass: scenePass, cull: false, hidden: true, live, priority: true }); D.warm.push(['core', r]);
      // in play also its draws into the water's probe (the next re-capture shows it: a full kayak built 17 pipelines there),
      // after: the object shows once its scene draws are built
      if (live) {
        const probe = Promise.resolve(water.warmProbe?.(renderer, scene, warm, [root].flat(), { live: true, only: true, priority: true })).then((ws) => { for (const w of ws ?? []) D.warm.push(['core-probe', w]); }, () => {});
        if (r && typeof r === 'object') Object.defineProperty(r, 'probe', { value: probe });   // r.probe: its probe draws built (the kayaks stay out of the probe till then)
      }
      return r;
    } : null,   // in play: between frames, ahead of the late queue (src/core/warmup.js liveHooks)
    warmLive: lateOn,   // core.warm is frame-safe in play (perf/ready-first-frame; the kayaks' full models use it)
    afterFrame: frame.afterFrame,
    get time() { return sceneTime; },
    setTime(t) { sceneTime = t; cl.uniforms.time.value = sceneTime; },   // the scene clock: wind, water, clouds
  };
  const before = new Set(scene.children);   // the mode's own top-level objects: what start() adds (fix/first-visit-hitches)
  let running = await mode.start(core);
  // the core's features (src/features/index.js, scope 'core'): the fireworks in the world after the mode (they read the
  // player for the camera) as a frame system, or the bench's ?fwlook= camera; the list loads with import() (the first chunk
  // stays without it)
  { const { attachFeatures } = await import('../features/index.js'); await attachFeatures(core, modeScope.get('player') ?? null, { scope: 'core', ctx: { fireworksOn, options, systems } }); }
  const modeRoots = scene.children.filter((o) => !before.has(o));
  // wow/storm: the afternoon thunderstorm (a world system, src/weather/storm.js) runs from the mode's start (Settings →
  // Weather; ?weather=storm&stormt=&stormrate= for captures; ?storms=natural)
  storm.begin({ natural: NATURAL.on || flags.storms === 'natural' });
  { const u = stormFromParams(flags); if (u) storm.start({ ...u, t0: sceneTime }); }
  // live: only what the camera needs now (the near band); the rest streams in after the first frame. Captures settle
  // everything the picture needs before each frame (renderOnce).
  if (stream) { await stream.settleNow(camera, { exact: headlessPage }); lod.update(camera.position); stream.resetLog(); }   // the mode's start view, complete before the first live frame
  daylight.collect(scene);   // the mode's own hooks (Day Sail: the sails, the wires, the nav lights, the spray)
  applyDaylight();
  // the mode's own objects (the boat, its sails and wires) and the start view's streamed tiles: built here, not in the
  // first live frame (33 programs, a 28 s block on SwiftShader before perf/shader-warmup)
  if (warm) {
    D.bootStep = 'modewarm'; D.warm.push(['mode', await warm(scene, camera, { pass: scenePass, cull: false, view: lateOn ? 'in' : null })]);
    if (lateOn) {
      lateOut.length = 0; lateOut.push(...outOfView());   // the whole scene's, mode included (the boot's list superseded)
      // the HUD's shown parts (the cockpit, or the wheel and the winches: on screen ≈ 2 s into play), in their own targets;
      // their hidden parts after ready
      for (const w of (await hud.warm?.(warm, { shown: true })) ?? []) D.warm.push(['hud', w]);
    }
  }
  // fix/first-visit-hitches: what the first minutes show later, built here too, so no
  // build waits in play (each froze the camera on a cold shader cache): the hidden objects that appear later (the
  // birds' splash, the storm's rain and bolts), the HUD's wheel and winches in their own targets, and the water probe's
  // re-capture (the forest complete, ≈ 3 s in; then as the sun moves) with the mode's objects in it. Live pages only.
  // perf/ready-first-frame: on a live page these run after ready, between frames (runLate); captures skip them; films and
  // ?latewarm=boot run them here, behind the card
  const lateJobs = [];
  if (warm && !headless) {
    // the birds: the splash, the snag's eagle; the evening's hidden objects on the highlight day (the barges, the spectators,
    // the night lights: fireworks world.js warmRoots; refactor round 2 B4: they built 35 pipelines at the one-tap show's first burst)
    const later = [world.birds?.group, ...(storm.prepare?.() ?? []), ...(services.get?.('fireworks')?.warmRoots?.() ?? [])].filter(Boolean);
    const out = lateOut.slice();
    // in play: more calls at once than behind the card (each build yields 7 times and a yield in play can wait for a frame;
    //: behind the card more lanes gained nothing), each slice of objects its own turn (src/core/warmup.js)
    const live = lateOn ? { live: true, lanes: flags.warmlanes > 0 ? flags.warmlanes : LATE.playLanes, slice: LATE.slice } : { live: false };
    // in the order they first matter: what a turn of the camera shows, the snag's eagle (≈ 5 s on a phone), the probe's
    // re-capture (the forest complete, ≈ 3 s in: it waits for this job), the HUD's hidden parts (the helm view, the night)
    const inScene = (o) => { while (o && o !== scene) o = o.parent; return o === scene; };   // still in the world (a streamed tile may have gone)
    if (out.length) lateJobs.push(['out', async () => [await warm(out.filter(inScene), camera, { pass: scenePass, cull: false, ...live })]]);
    if (later.length) lateJobs.push(['later', async () => [await warm(later, camera, { pass: scenePass, cull: false, hidden: true, ...live })]]);   // one call (perf/phone-load)
    lateJobs.push(['reprobe', async () => (await water.warmProbe?.(renderer, scene, warm, [...modeRoots, ...later], live)) ?? []]);
    lateJobs.push(['hud', async () => (await hud.warm?.((r, c, o) => warm(r, c, { ...o, ...live }))) ?? []]);
  }
  if (lateJobs.length && !lateOn) {
    D.bootStep = 'latewarm';
    const was = ['later', 'hud', 'reprobe'];   // behind the card: the order before perf/ready-first-frame
    for (const [name, job] of [...lateJobs].sort((p, q) => was.indexOf(p[0]) - was.indexOf(q[0]))) for (const w of await job()) D.warm.push([name, w]);
    lateJobs.length = 0;
  }
  // the late queue (src/core/lateWarm.js): started at the first live frame, one job after another; the probe's
  // re-captures wait for theirs (the water keeps the load's probe till then)
  const late = createLateQueue(lateJobs, { D, probeJob: daylight.probeJob });
  // perf/enter-freeze (src/core/lateWarm.js frameBudget): the queue yields on the frame budget, so no frame waits for a
  // run of builds; a priority call (a kayak about to go full) at 3× the share: the pair is a hero feature, never shown
  // later (unpaced, its warm-up made 100–250 ms frames in a desktop's first 5 s)
  Object.defineProperty(D, 'passDepth', { get: () => pc.passDepth, configurable: true });   // the bench reads it (tools/perf-r2/opendelay.mjs)
  startLate = () => {
    if (late.started) return;
    const ms = lateOn ? budgetMs({ phone: !!quality.build?.phone, latebudget: flags.latebudget }) : 0;
    const hooks = liveHooks(renderer);
    if (ms > 0) { const b = frameBudget({ ms: () => (hooks.session?.priority ? ms * BUDGET.priority : ms) }); b.install(); D.budget = Object.assign(b.stats, { ms }); }
    late.start();
  };
  core.late = late;   // core.late.done: the queue drained (tools, tests)

  // A mode switch in play: the old mode is disposed, the new one starts on this same core
  // (the renderer, the world, the wind, the clock: nothing reloads). nextModule: a promise of the mode's module;
  // params: what the new mode reads instead of the page's URL (the shell passes the boat's pose, so the boat stays
  // where it is). The new mode's time rate (and Chill's schedule) takes over from now unless ?timerate= pins it. The
  // caller hides the swap (src/shell.js: the loading card's horizon line).
  async function switchMode(nextModule, { params = null } = {}) {
    const p = params == null ? flags : toFlags(params);   // a flags object, or a URLSearchParams / query string (the shell, the tests)
    const next = await nextModule;
    if (typeof next?.start !== 'function') throw new TypeError("core.switchMode takes a mode module; the switch by id is the shell's switchMode service");
    const opts = checkModeOptions(next.coreOptions?.(p) ?? {}, { mode: p.mode });
    services.provide('modeOptions', opts);
    running?.dispose?.();
    running = null;
    modeScope.dispose();   // what the old mode provided (its boat, controls, chart …) leaves the registry with it
    modeScope = services.scope();
    if (!flags.timerate) {
      if (opts.timeSchedule) clock.setSchedule(opts.timeSchedule, sceneTime);
      else clock.setRate(opts.timeRate ?? 0, sceneTime);
    }
    const here = Object.create(core, { T0: { value: sceneTime }, flags: { value: p }, switched: { value: true }, services: { value: modeScope } });   // switched: started by a switch in play (a gesture already happened)
    running = await next.start(here);
    daylight.collect(scene);
    applyDaylight();
    return running;
  }
  core.switchMode = switchMode;

  // --- The loop (src/core/loop.js): live pages only; captures (?headless) call renderOnce() themselves ---
  // ?filmui=1 (tools/film/run.mjs UI shots): a live page with its UI (the helm station, the panel,
  // the skipper's line) but no wall-clock loop: the film runner calls filmFrame(dt) for every frame at a fixed dt.
  const filmUi = !headless && flags.filmui;
  // the film's own clock (ms), for UI that times itself by the wall clock (the first-sail lines: src/ui/firstSail.js)
  let filmT = 0;
  if (filmUi) { core.filmFrame = async (dt) => { filmT += dt; running?.update(dt); await renderOnce(); firstFrame(); }; core.filmNow = () => filmT * 1000; }
  if (!headless && !filmUi) {
    startLoop({ renderer, D, frame, startGovernor, update: (dt) => running?.update(dt), firstFrame, readyAt: () => readyAt, gpuDead, recover, audio: world.audio, core });
  }
  msg.textContent = headless || flags.debug == null ? '' : `Velia · ${sun.hour.toFixed(1)} h · sun ${sun.elevationDeg.toFixed(1)}° · cam ${CAM}`;
  if (headless || filmUi) endFastYield();   // no live loop: the boot ends here
  if (headless || filmUi) milkyway?.arm();   // a capture whose clock runs into the night loads it then
  D.bootStep = 'live';
  return { quality, setQuality, resetAuto, renderOnce, stats, camera, clock, daylight, sun, wind, setTime: core.setTime, core, storm, switchMode, kick: () => core.kick?.(), diag: D, topGpu: (n) => topGpu(D, n), filmFrame: core.filmFrame, filmNow: core.filmNow, systems };   // D2: clock … for tools and demos; core: for the probes (tools/probe_water.mjs); systems: the frame's registry (its trace)
}
