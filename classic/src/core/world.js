// The world every mode shares: terrain, the wind field, the lake, trees, landmarks, the shoreline, the harbour,
// traffic, the sound beds, the clouds and the thunderstorm. Built once, in this order (the load stages and the node graph
// depend on it). It returns its per-frame systems (src/core/systems.js: { id, phase, update(ctx), dispose }) and the
// frame's env they share; the core registers them with its own and runs them every frame (src/core/loop.js).
import { SAIL_BEDS } from '../../../src/core/sailMusic.js';
import { visitSeed } from '../../../src/visitSeed.js';
import * as THREE from 'three/webgpu';
import { float, mix, positionWorld, vec3 } from 'three/tsl';
import { clouds } from '../clouds.js';
import { WindField } from '../../../src/sim/wind.js';
import { gustFxOn } from '../../../src/gustFx.js';
import { gustWater } from '../gustFx-water.js';
import { lakeTerrain } from '../../../src/sim/terrain.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { TerrainLOD, terrainMaterial } from '../terrain-mesh.js';
import { createWater } from '../water.js';
import { createClarity, clarityWater } from '../waters/clarity.js';
import { createTrees } from '../trees.js';
import { createAudio, startOnFirstGesture, worldState } from '../../../src/audio.js';
import { createShoreline } from '../shoreline.js';
import { createLandmarks } from '../landmarks.js';
import { createHarbour } from '../harbour.js';
import { createTraffic } from '../../../src/sim/traffic.js';
import { createTowns } from '../towns.js';
import { TOWN_RULES } from '../towns-layout.js';
import { layoutShoreline } from '../../../src/shoreline-layout.js';
import { flagSites, createShoreFlags } from '../shoreFlags.js';
import { flags, SEED, EXPOSURE, T0, LOW_BANK, COVERAGE, CLOUD_TYPE, CLOUD_BASE, CLOUD_THICK } from '../../../src/sim/core/params.js';
import { span } from '../profile.js';
import { importRetry } from './importRetry.js';
import { createWeatherBus } from '../weather/uniforms.js';
import { weatherMenu } from '../../../src/sim/weather/weatherMenu.js';   // the chosen weather (the top bar, Setup, Cruise's Mood): clear | fair | storm   // wow/storm: the thunderstorm's hooks (off: the same pixels)
import { birdMarks } from '../birds/water.js';   // fix/bird-splash: the birds' marks on the water (added only with the birds on)
import { createStorm, stormSystem } from '../weather/storm.js';
import { createEnv } from './systems.js';

// waters: the lake's profile (src/waters/<id>.json; the core passes the chosen one, src/waters/current.js): its
// terrain, origin, bay and landmarks reach every system through the terrain object (terrain.waters, .lake, .landmarks,
// .climate, .place, .geo) and the wind's bay box (waters.windBay).
// mode: the mode's coreOptions() (src/modes/README.md): wind(hour) → WindField options, createWake() → the wake.
// now(): the scene clock (the storm's); tierName(): the quality tier's name now (the storm's rain); env: the frame's
// shared values (src/core/systems.js createEnv; one is made when absent).
export async function createWorld({ waters = CURRENT_WATERS, scene, camera, atmosphere, sunWorld, elev, hour, mode = {}, stage, renderer = null, tier = null, classicWater = false, services = null,
  env = createEnv(), now = () => T0, tierName = () => String(tier?.label ?? 'High').toLowerCase() }) {
  // --- Terrain: the lake's basin (Tahoe: USGS 3DEP + the 1998 multibeam; src/terrain.js), the profile's origin at 0, 0
  stage('terrain', 0.04);
  const terrain = await lakeTerrain(waters, { seed: SEED });
  // --- The weather bus (src/weather/uniforms.js): the storm owns it and writes it (below); the water, the sun's light,
  // the clouds and the post grade read it through this handle
  const weather = createWeatherBus();

  // --- Wind: one field, every effect reads it (T1) ----------------------------------
  // A mode may give the day's wind (Day Sail: Tahoe's day on the scene clock, src/modes/daysail/index.js); otherwise
  // a steady base wind. ?winddir= / ?windspeed= give a fixed wind.
  const dayWind = mode.wind?.(hour);
  const windCache = tier?.wind ?? null;   // a phone keeps fewer texture centres, in Float32 (src/quality/apply.js)
  const wind = dayWind
    ? new WindField({ seed: SEED, ...dayWind, cache: windCache, bay: waters.windBay })
    : new WindField({ seed: SEED, cache: windCache, bay: waters.windBay, base: {
        ...(flags.winddir ? { dirDeg: parseFloat(flags.winddir) } : {}),
        ...(flags.windspeed ? { speedMs: parseFloat(flags.windspeed) } : {}) } });
  wind.setTerrain(terrain.heightAt);   // L6: a local lee and the valley channel (the old long lee shaded the whole lake)

  // --- Lake (T3): wind-driven Gerstner bands by wind speed and fetch, cat's paws from the wind texture ------
  // Its sky and sun are uniforms in scene luminance units (the AgX exposure scales them back); a PMREM sample later.
  const lum = 0.6 / EXPOSURE;
  stage('water', 0.12);
  const wake = mode.createWake ? mode.createWake() : null;   // M10: before the water, which reads it
  // Ultra-Water's FFT cascades drive the surface. DEFAULT since the owner's OK of the beauty pass (2026-10-30); ?water=classic keeps the old Gerstner water for one release. The compute FFT needs the WebGPU backend.
  // the FFT runs as WebGPU compute (gpuBridge.js); ?fft=gl keeps the WebGL2 sim and its read-back (bridge.js) for comparisons
  const ULTRA_DEFAULT = true;
  const ultraOn = (flags.water ?? (ULTRA_DEFAULT && !classicWater ? 'ultra' : 'classic')) === 'ultra';   // classicWater: a phone whose last two loads did not finish (src/core/index.js)
  const ultra = !ultraOn || !renderer?.backend?.isWebGPUBackend ? null : flags.fft === 'gl' ? (await import('../waters/ultra/bridge.js')).createUltraBridge() : (await importRetry(() => import('../waters/ultra/gpuBridge.js'))).createUltraGpu({ renderer });   // a failed import: once more (src/core/importRetry.js)
  ultra?.attachMips(renderer);
  if (ultra) ultra.gpuCheck = (...a) => import('../waters/ultra/check.js').then((m) => m.gpuDisplacement(renderer, ultra, ...a));
  // the birds (below): decided here, so the water's shader carries their marks only when they fly
  const birdsOn = flags.birds != null ? flags.birds !== '0' : flags.headless == null && !globalThis.navigator?.webdriver;
  const water = createWater({
    ultra, seaFeel: flags.seafeel ? flags.seafeel.split(',').map(parseFloat) : null, ultraMask: flags.umask != null ? parseInt(flags.umask, 10) : (tier?.water?.ultraMask ?? 15), live: flags.live != null ? parseFloat(flags.live) : 1, wind, seed: SEED, wake, debug: null, whitecaps: !flags.nocaps,
    // the water's feature modules (src/waters/features.js), folded into its slots in this order:
    features: [
      gustFxOn(flags) && flags.gustlook ? gustWater() : null,   // wow/gusts: the gust line on the water (?gustlook=0: the cells without it, for an A/B)
      weather.water(),   // wow/storm: rain rings, the grey mirror and the cell's shadow on the glint (gated on the storm)
      birdsOn ? birdMarks() : null,   // fix/bird-splash: the birds' rings, holes and foam, only when the birds are on (no bird, the same shader: the goldens)
      flags.clarity ? clarityWater(createClarity({ level: String(tier?.label ?? 'High').toLowerCase(), debug: null })) : null,   // wow/clarity: the lake bed, caustics, the boat's shadow; ?clarity=0 the earlier bed
    ],
    tier: tier?.water,   // the quality tier's water knobs (src/quality/tiers.js); absent = High
    terrain,   // T3b: the real shore (shoreDistance) and fetch traced upwind to it
    atmosphere, sunScale: lum,   // T3c: the glint takes the sky model's transmitted sun
    sky: { horizon: new THREE.Color(0xd9cfc2).multiplyScalar(lum).getHex(), zenith: new THREE.Color(0x6f8296).multiplyScalar(lum).getHex() },
    deep: new THREE.Color(0x0e1a20).multiplyScalar(lum).getHex(),
    ...(flags.wmirror === '0' ? { mirror: null } : {}),
    ...(flags.wcolour === 'old' ? { colour: null } : {}),   // S5: ?wcolour=old the body's colour as before   // M6: ?wmirror=0 the old mirror (no twilight mirror, the fixed probe)
    sun: { dir: [sunWorld.x, sunWorld.y, sunWorld.z], color: [1.0, 0.82, 0.62], intensity: 6.0 * lum * Math.max(0, elev) * 4 },
  });
  scene.add(water.mesh);
  // the terrain's material after the water (the ground's beaches read the water's shore-distance maps), then its LOD
  const tmat = terrainMaterial(terrain, { shore: water.shoreDistanceNode, tier });   // the tier's photo level, canopy and far map texels, KTX2 set
  const lod = new TerrainLOD(terrain, { material: tmat, ...(tier ? { split: tier.terrain.split } : {}), ...(tier?.terrainCache ? { cacheMax: tier.terrainCache } : {}) });
  lod.update(camera.position);
  scene.add(lod);
  // --- Towns (art/towns): the shore towns, the ski runs, the roads, the marinas and the night lights,
  // from OpenStreetMap (ODbL). Their ground (runs, lawns, lots, the Hwy 89 cut) joins the terrain's colour here,
  // before the water's wet line.
  const { season } = terrain.climate, { Y0 } = terrain.geo;
  const towns = await createTowns({ terrain, lonLatToWorld: terrain.geo.lonLatToWorld,
    rules: { ...TOWN_RULES, snowLineY: season.snowLine - Y0, snowAspectM: season.aspectM ?? 300 } });
  if (towns) {
    scene.add(towns.group);
    tmat.colorNode = towns.ground(tmat.colorNode, { detail: tmat.userData.ground?.detail });   // the ground's grain in the paints
    if (tmat.roughnessNode) tmat.roughnessNode = towns.roughness(tmat.roughnessNode);
  }
  tmat.colorNode = tmat.colorNode.mul(mix(float(1), float(0.5), water.wetness(positionWorld)));   // the wet line on the shore

  // --- Trees (T4b): a scattered conifer treeline below 700 m, hero pines on the points; they sway with the wind.
  stage('trees', 0.26);
  const trees = await createTrees({ terrain, wind, windTexture: water.windTexture, seed: SEED, sunDir: sunWorld, renderer, atmosphere, lum, tier,
    towns: towns ? { keepOut: towns.keepOut, treeDensity: towns.treeDensity } : null });
  scene.add(trees.group);
  // the ground reads the forest (art/ground): the canopy raster (duff and shade under the crowns), and the ridges'
  // skyline shadow on the sun's direct light for every lit material (the ground, the boats, the buildings): the
  // atmosphere light's colour node multiplies its direct term only, so the sky's light stays in a ridge's shadow
  const endCanopy = span('ground:canopy');
  trees.group.userData.canopy = tmat.userData.ground?.canopy ? trees.attachCanopy(tmat.userData.ground.canopy) : null;   // painted by tile as the forest streams in
  endCanopy();
  const sunLight = scene.children.find((o) => o.isLight && o.body === 'sun');
  if (sunLight && trees.horizon) sunLight.colorNode = vec3(trees.horizon.lit(positionWorld));
  // wow/storm: the thunderstorm's shadow on the sun's direct light, with its gaps in the clearing (1 with no storm)
  if (sunLight?.colorNode) sunLight.colorNode = vec3(sunLight.colorNode).mul(weather.sunShade(positionWorld));

  // --- Landmarks (L2, 4e): the island and its stone ruin, the stone house with a sod roof, the waterfall, boulders.
  stage('shore', 0.42);
  const landmarks = createLandmarks({ terrain, seed: SEED });
  scene.add(landmarks.group);

  // --- Shoreline (L4): piers and boathouses and a disused light tower. Generic, no real names. The owner's rule
  // (2026-11-05): a prop that is not good enough does not ship; the low-poly floats and craft were deleted.
  // the piers are the real ones (OpenStreetMap, via the towns) where the towns loaded
  const shoreline = createShoreline({ terrain, seed: SEED,
    ...(towns ? { layout: layoutShoreline(terrain, { seed: SEED, realPiers: towns.layout.osmPiers }) } : {}) });
  scene.add(shoreline.group);

  // --- Harbour (L3, the Product lead): breakwaters, 72 slips (empty), the pier, fuel dock, ramp, yacht club. No names.
  const harbour = createHarbour({ terrain, seed: SEED });
  // the day wind's state at t = 0 (its base direction and speed), which the clouds' drift below reads: the harbour's
  // boats used to set it with their first wind sample (deleted with the props); kept so the sky drifts as before
  wind.at(0);
  scene.add(harbour.group);

  // --- Flags on shore (feat/instruments): a few poles where a skipper reads the wind ashore, each flying from the
  // local wind (src/shoreFlags.js). ?flags=0 leaves them out.
  const shoreFlags = !flags.flags ? null
    : createShoreFlags({ sites: flagSites({ terrain, harbour: harbour.layout, shore: shoreline.layout }), wind, seed: SEED });
  if (shoreFlags) scene.add(shoreFlags.group);

  // --- Traffic: none ships today (the low-poly craft were deleted); the chart, the logbook and Cruise read
  // its empty schedule.
  const traffic = createTraffic();

  // --- Birds (wow/birds): ospreys, bald eagles, California gulls and Canada geese, flown on the
  // scene clock (src/birds/). ?birds=0 leaves them out; captures (?headless) and automated browsers (the goldens' live home
  // frame, the probes: navigator.webdriver, as the home card's attract) leave them out unless ?birds=1, so the goldens never
  // see one. The storm's hook: world.birds.setShelter(0..1).
  const birds = birdsOn ? (await importRetry(() => import('../birds/index.js'))).createBirds({ terrain, water, wind, seed: SEED, tier: tier?.label?.toLowerCase() ?? 'high',
    boat: () => services?.get('player')?.phys?.state ?? null, dive: flags.birddive != null ? flags.birddive !== '0' : undefined }) : null;   // boat: the running mode's (the 'player' service: src/core/player.js), or none
  if (birds) scene.add(birds.group);

  // --- Sound (T6b): CC0 field-recording loops mixed by world state; the music (audio/music/, MusicAPI, ATTRIBUTION.md)
  // on a silence-first scheduler: first light and the golden hour, the wind, a swell on arrival (a logbook find).
  // Sound is on by default: it starts on the very first gesture of any kind (the browser's rule; startOnFirstGesture).
  // M mutes, for courtesy (headless pages never start it).
  // each state a pool of pieces (src/core/sailMusic.js), picked by a per-visit seed (src/visitSeed.js; ?seed, headless and
  // goldens keep the URL's): fix/regressions 2026-10-30, the owner heard one fixed piece per state
  const audio = createAudio({ base: '/audio/', seed: SEED, musicSeed: visitSeed(flags), beds: SAIL_BEDS });
  if (flags.headless == null) {
    startOnFirstGesture(audio);
    // the loading screen's ♪ chip (src/ui/attractReel.js): pressed before the world was up, or now
    if (window.__veliaLoading?.soundWanted) audio.start();
    window.addEventListener('lakeshore:sound', () => audio.start());
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyM' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) audio.toggleMute(); });
  }

  // --- Clouds (T2b): two Nubis-style layers lit from the sky model (sun transmittance + sky light at the
  // layer): a low stratus bank at ridge mid-slope (target-04's inversion) and the main deck.
  const [wx, wz] = WindField.toward(wind.base.dirDeg);
  const cl = clouds({
    camera, sunDir: sunWorld, wind: [wx * wind.base.speedMs * 1.5, wz * wind.base.speedMs * 1.5], atmosphere, time: T0, seed: SEED, weather,
    ...(tier ? { lightSteps: tier.clouds.lightSteps, temporalScale: tier.clouds.temporalScale } : {}),
    nearSky: birds ? 600 : 0,   // wow/birds: no cloud trail behind a moving bird (src/clouds.js nearSky; 0 without birds: the goldens)
    temporal: true,   // T2c: half-res march accumulated over frames; captures render ≥ 30 frames, so it converges
    layers: [
      ...(LOW_BANK ? [{ coverage: 0.55, type: 0.05, density: 0.025, base: 150, thickness: 110, weatherOffset: [7300, -4100], steps: 64, terrain: { heightAt: terrain.heightAt } }] : []),
      { coverage: COVERAGE, type: CLOUD_TYPE, base: CLOUD_BASE, thickness: CLOUD_THICK, storm: true, ...(tier ? { steps: tier.clouds.steps } : {}) },   // storm: the thunderstorm's cell rides on this deck (wow/storm)
    ],
  });

  water.setCloudDeck?.(cl.layers?.at?.(-1)?.coverage ?? null);   // M6: the deck's mean in the twilight mirror

  // the ground's textures (≈ 0.4 MB, fetched since the water stage, decoded off the main thread): in before the first frame
  const endGround = span('ground:textures');
  await tmat.userData.ground?.ready;
  endGround();

  if (birds && flags.headless == null) import('../../../src/birds/sound.js').then((m) => { birds.sound = m.createBirdSound({ audio, base: '/audio/birds/' }); }).catch(() => {});

  // --- The thunderstorm (wow/storm, src/weather/storm.js): made with the world, idle until the core begins it once the
  // mode has started (src/core/index.js); Settings → Weather, ?weather=storm, ?storms=natural
  const storm = createStorm({ scene, camera, wind, weather, terrain, audio, clouds: cl, lum, seed: SEED, sunWorld, env, now, tierName });

  // the weather the player chose (one state for the top bar's Weather, Setup and Cruise's Mood): the deck's coverage and the storm
  const sky = weatherMenu({ storm, deck: cl.layers?.at?.(-1)?.coverage ?? null });

  const systems = worldSystems({ storm, sky, env, water, trees, landmarks, towns, shoreFlags, birds, audio, wind, terrain, camera, renderer });

  return { terrain, lod, towns, wind, lum, wake, water, trees, landmarks, shoreline, harbour, shoreFlags, traffic, audio, clouds: cl, birds, storm, sky, weather, env, systems };
}

// The world's per-frame systems (src/core/systems.js), in the frame's order within each phase. ctx: { t (the scene
// clock), headless }. The core adds its own round them (src/core/loop.js): the stream and the daylight (pre, before the
// storm), the GPU counters' reset (sim, before the water), the helm's objects and the draw (post).
export function worldSystems({ storm, sky = null, env, water, trees, landmarks, towns = null, shoreFlags = null, birds = null, audio, wind, terrain, camera, renderer }) {
  return [
    stormSystem(storm, env, sky),   // pre: after the daylight (it greys the mist), before the water reads the wind
    { id: 'water', phase: 'sim', update(ctx) {   // + the look map pass (whitecaps with age, the wind lanes)
      water.update(ctx.t, camera, renderer);
      if (water.ultra && !globalThis.__ultraLive && (ctx.headless || !water.ultra.reads)) return water.ultra.settle();   // ?water=ultra: captures wait for this frame's read
    } },
    { id: 'trees', phase: 'scene', update(ctx) { trees.update(ctx.t, camera); } },
    { id: 'landmarks', phase: 'scene', update(ctx) { landmarks.update(ctx.t); } },
    ...(towns ? [{ id: 'towns', phase: 'scene', update() { towns.update(camera, renderer.domElement.height); } }] : []),
    ...(shoreFlags ? [{ id: 'shoreFlags', phase: 'scene', update(ctx) { shoreFlags.update(ctx.t); } }] : []),
    // src/birds/ (null with ?birds=0 and in captures); in the storm's rain they go to shelter (env.shelter, the storm's)
    ...(birds ? [{ id: 'birds', phase: 'scene', update(ctx) { birds.setShelter(env.shelter); birds.update(ctx.t, camera); }, dispose: () => birds.dispose() }] : []),
    { id: 'audio', phase: 'audio', update(ctx) { audio.update(ctx.t, worldState({ t: ctx.t, hour: env.hour, camera, wind, terrain, rain: env.rain })); } },
  ];
}
