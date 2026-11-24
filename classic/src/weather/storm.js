// The Tahoe afternoon thunderstorm (wow/storm): the event that runs the arc (stormArc.js) on the world every frame.
// Its sim half is in the shared sim (src/sim/weather/stormSim.js: the arc into the plain weather state, the outflow on the
// one wind field, the strikes, the rainbow's amount, the info). This half is the engine's: it owns the weather bus
// (uniforms.js createWeatherBus: the cell in the clouds, its shadow on the sun's light and the glint, the rain on the
// water, the grade, the flash and the rainbow) and copies the sim's state into it each frame (its only writer); raises the
// haze, draws the rain and the bolts, and plays the thunder at its distance's delay. No storm: none of it runs and every
// hook is off (the default look is unchanged).
//
//   const weather = createWeatherBus();                 // src/core/world.js, before the water, the clouds and the post
//   const storm = createStorm({ scene, camera, wind, weather, … });   // a system of the world (phase 'pre'); storm.weather
//   storm.begin({ natural })                            // src/core/index.js, once the mode has started: from here it runs
//   storm.start({ s0: 0 });                             // the arc from its start, here and now
//   storm.start({ s0: 97, easeS: 1.5 });                // the weather menu's Storm (weatherMenu.js): just ahead of the gust front, eased in
//   storm.update(t)                                     // every frame, before the water reads the wind (stormSystem)
// URL (captures, films): ?weather=storm&stormt=<s into the arc>&stormrate=<×, films compress it>&stormref=x,z. A capture
// is deterministic: the arc, the strikes and the bolts come from the seed and the scene clock, never the wall clock.
// ?storms=natural: now and then a storm on a summer afternoon in Sail (off by default: NATURAL.on).
import { createWeatherBus, writeWeatherUniforms } from './uniforms.js';
import { sceneTimeOf, thunderOf } from '../../../src/sim/weather/stormArc.js';
import { createRain } from './rain.js';
import { createLightning } from './lightning.js';
import { createThunder } from '../../../src/weather/stormAudio.js';
import { createStormSim, NATURAL, naturalPlan, stormFromParams } from '../../../src/sim/weather/stormSim.js';

export { NATURAL, naturalPlan, stormFromParams };

// scene, camera, wind, terrain, audio, clouds: the world's; weather: the bus the clouds, the water and the post read
// (a new one when absent); env: the frame's (src/core/systems.js: the sun as of this frame,
// written by the daylight); now(): the scene clock; tierName(): the quality tier's name now (the rain's drop count)
export function createStorm({ scene, camera, wind, weather = createWeatherBus(), terrain = null, audio = null, clouds = null, lum = 0.1, seed: SEED = 1, sunWorld = null, env = {}, now = () => 0, tierName = () => 'high' }) {
  const SU = weather.uniforms;
  const deck = clouds?.layers?.at(-1) ?? null;   // the deck layer carries the cell (src/clouds.js, storm: true)
  const fogDensity = scene.userData.fogDensity ?? null, fogColor = scene.userData.fogColor ?? null;
  let parts = null, thunder = null, fog0 = null;

  const ensureParts = () => {
    if (parts) return parts;
    parts = { rain: createRain({ tierName: tierName(), lum }), bolt: createLightning({ lum }) };
    scene.add(parts.rain.mesh, parts.bolt.group);
    return parts;
  };
  const sim = createStormSim({
    wind, seed: SEED, now, lum, env, sunWorld,
    eye: () => camera.position,
    deck: deck ? { base: () => deck.base.value, thickness: () => deck.thickness.value } : null,
    // every start (the URL's, the menu's, a natural one): the fog's fair value kept, the rain and the bolts made
    onStart: () => { if (fogDensity && fog0 == null) fog0 = fogDensity.value; ensureParts(); },
    // every stop: the bus back to fair, the fog put back, the rain and the bolts off, the thunder quiet
    onStop: () => {
      writeWeatherUniforms(SU, sim.weather);
      if (fogDensity && fog0 != null) fogDensity.value = fog0;
      if (parts) { parts.rain.update({ rain: 0, t: 0 }); parts.bolt.update({ strike: null, flash: 0 }); }
      thunder?.stop?.();
    },
  });
  const info = sim.info;
  // once the mode has started (src/core/index.js): the natural storm's clock starts here, and the thunder joins the
  // game's own sound (src/audio.js attach: built in the first gesture, with the master)
  function begin({ natural } = {}) {
    if (!sim.begin({ natural })) return;
    audio?.attach?.(({ ctx, master }) => { thunder = createThunder(ctx, master); }, 'effects');
  }

  function update(t, o = {}) {
    sim.update(t, o);
    const F = sim.frame;
    if (!F.ran) return info;
    const { A, k, L, w } = F, state = sim.state;
    // the thunder of the new strikes, at the distance's delay (real seconds)
    for (const s of F.strikes) {
      if (thunder && audio?.state === 'running' && !audio.muted) {
        const th = thunderOf(s, L), dueT = sceneTimeOf(state, s.s) + th.delayS;
        const ctx = thunder.bus.context;
        thunder.play(ctx.currentTime + Math.max(0, dueT - t) / 1, { ...th, seed: s.seed });
        info.thunders.push({ s: s.s, delayS: +th.delayS.toFixed(2), distM: Math.round(th.distM) });
        if (info.thunders.length > 20) info.thunders.shift();
      }
    }
    // the haze: denser, steel grey in the rain
    if (fogDensity && fog0 != null) fogDensity.value = fog0 * (1 + 22 * A.haze);   // the rain's haze rises and softens the far shore
    if (fogColor) {
      const g = lum * (env.sun?.light ?? 1) * 0.62, k = 0.85 * A.haze;
      fogColor.value.r += (g * 0.86 - fogColor.value.r) * k; fogColor.value.g += (g * 0.92 - fogColor.value.g) * k; fogColor.value.b += (g * 1.0 - fogColor.value.b) * k;
    }
    const light = env.sun?.light ?? 1;
    info.drops = parts.rain.update({ rain: A.rain, vx: w.vx, vz: w.vz, t, light: lum * light * (1 - 0.4 * A.dark) });
    parts.bolt.update({ strike: F.bolt, flash: F.boltGlow * k, groundY: F.bolt ? Math.max(0, terrain?.heightAt?.(F.bolt.x, F.bolt.z) ?? 0) : 0, light: lum });
    writeWeatherUniforms(SU, sim.weather);
    SU.camWorld.value.copy(camera.matrixWorld); SU.projInv.value.copy(camera.projectionMatrixInverse);
    return info;
  }

  return {
    begin, start: sim.start, stop: sim.stop, choose: sim.choose, update, info, weather, weatherState: sim.weather,
    // the rain and the bolts made ahead, hidden (fix/first-visit-hitches: the boot's warm-up builds their pipelines,
    // which the first rain and the first strike built in play); null with nothing to show
    prepare: () => { const p = ensureParts(); return [p.rain.mesh, p.bolt.group]; },
    get running() { return sim.running; }, get leaving() { return sim.leaving; }, get choice() { return sim.choice; }, get state() { return sim.state; },
    get rain() { return sim.rain; },
    strikesFrom: sim.strikesFrom,
    dispose() { sim.stop(); if (parts) { scene.remove(parts.rain.mesh, parts.bolt.group); parts.rain.dispose(); parts.bolt.dispose(); parts = null; } },
  };
}

// The storm as a system of the world (src/core/systems.js): phase 'pre', after the daylight (it greys the mist) and
// before the water reads the wind. It owns env.rain and env.shelter (the birds go to shelter in the rain; the sound
// beds hear it): 0 with no storm, and before the mode has started.
export function stormSystem(storm, env, sky = null) {
  return {
    id: 'storm', phase: 'pre', order: 0,
    update(ctx) {
      sky?.update(ctx.t);   // the chosen sky (weatherMenu.js): the deck's coverage eases to it
      storm.update(ctx.t, { hour: env.hour });
      const rain = storm.rain;
      env.rain = rain; env.shelter = Math.min(1, rain * 1.5);
    },
    dispose: () => storm.dispose(),
  };
}
