// D2: applies the time-of-day clock (src/timeOfDay.js) to the scene each frame.
//   const daylight = createDaylight({ atmosphere, matrixWorldToECEF: m, originECEF, place, baseExposure: EXPOSURE,
//                                      lum: 0.6 / EXPOSURE, fogColor: scene.userData.fogColor });
//   const clock = new TimeOfDay({ hour: HOUR, rate, sunAt: daylight.sunAt, baseExposure: EXPOSURE });
//   post.outputNode = toneMapping(AgX, daylight.exposure, …)      // a uniform, not the number
//   … once the scene is built: daylight.collect(scene); daylight.add(cl.daylight); daylight.probe(water, renderer, scene)
//   every frame, before the render: daylight.update(clock.tick(simT))
// Each module carries its own hook as object.userData.daylight = (frame) => …; collect() finds them once. The frame
// is the clock's ({ hour, sun, elevDeg, exposure, light, probe, cut }) plus sunDir (a THREE.Vector3, world),
// sunShare (the sun disc above the horizon, 0–1) and waterSunIntensity (main.js's formula).
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { getSunDirectionECEF, getMoonDirectionECEF, getECIToECEFRotationMatrix } from './core/celestial.js';   // not the sky library's root: its WebGL build
import { timeAt } from '../../src/sim/place.js';
import { clamp } from '../../src/sim/core/math.js';


// main.js's mist colour by sun height (sin of the elevation), before the light level: warm grey at dawn, pale blue-grey
// by day, slate at night. Kept equal to main.js's block so the start frame is unchanged.
function mistColor(elev, out = new THREE.Color()) {
  const night = MIST.night, dawn = MIST.dawn, dayC = MIST.day;
  return elev < 0.08
    ? out.copy(night).lerp(dawn, clamp((elev + 0.05) / 0.13, 0, 1))
    : out.copy(dawn).lerp(dayC, clamp((elev - 0.08) / 0.3, 0, 1));
}
const MIST = { night: new THREE.Color(0x3a4452), dawn: new THREE.Color(0xd9cfc2), day: new THREE.Color(0xc8d3dc) };

export function createDaylight({
  atmosphere,                 // the AtmosphereContext (its sun, moon and ECI→ECEF uniforms are written here)
  matrixWorldToECEF,          // main.js's worldToECEF().matrix
  originECEF,                 // main.js's worldToECEF().originECEF (the observer, for the sun's parallax)
  place,                      // the day and the clock (src/place.js makePlace: the lake profile's): hour = local clock time (PDT) on place.date (the map's day, src/day.js)
  baseExposure = 6,           // ?exposure
  lum = 0.6 / baseExposure,   // main.js's scene-luminance scale for hand-set colours
  fogColor = null,            // scene.userData.fogColor (a uniform), or null
  exposure = null,            // a uniform to drive (else a new one: pass daylight.exposure to toneMapping)
  sunDir = new THREE.Vector3(0, 1, 0),   // the vector to keep live (the core passes its sunWorld)
  mistGain = 1,               // S3 (src/core/farLook.js): the mist's colour at the sky's horizon level
  nightFloor = 0,             // the starlit night (src/core/milkyway-math.js NIGHT_LIGHT_FLOOR): frame.light never under it
} = {}) {
  const ecefToWorld = new THREE.Matrix4().copy(matrixWorldToECEF).invert().setPosition(0, 0, 0);
  exposure ??= uniform(baseExposure);
  const scratch = new THREE.Vector3();
  const targets = new Set();
  let probeJob = null;
  let lastHour = null;

  // the clock's sun: the sky model's own direction (astronomy-engine), world frame. Also writes the atmosphere, so a
  // frame's sky, light, aerial perspective, clouds' light, water glint and sails see the same sun.
  function setHour(hour) {
    if (hour === lastHour) return;
    lastHour = hour;
    const date = timeAt(hour, place);
    if (atmosphere) {
      getSunDirectionECEF(date, atmosphere.sunDirectionECEF.value, originECEF);
      getMoonDirectionECEF(date, atmosphere.moonDirectionECEF.value, originECEF);
      getECIToECEFRotationMatrix(date, atmosphere.matrixECIToECEF.value);   // the stars turn with the hour
      sunDir.copy(atmosphere.sunDirectionECEF.value).applyMatrix4(ecefToWorld).normalize();
    } else {
      getSunDirectionECEF(date, scratch, originECEF);
      sunDir.copy(scratch).applyMatrix4(ecefToWorld).normalize();
    }
  }
  const sunAt = (hour) => { setHour(hour); return { x: sunDir.x, y: sunDir.y, z: sunDir.z }; };

  // every userData.daylight hook under root; with a renderer, also the water's probe (userData.daylightProbe)
  function collect(root, { renderer = null, probeOpts } = {}) {
    root.traverse((o) => {
      if (typeof o.userData?.daylight === 'function') targets.add(o.userData.daylight);
      if (renderer && !probeJob && typeof o.userData?.daylightProbe === 'function') probeJob = o.userData.daylightProbe(renderer, root, probeOpts);
    });
    return targets.size;
  }
  const add = (fn) => { if (typeof fn === 'function') targets.add(fn); };
  // the water's probe, recaptured over frames when the clock says the sun has moved (src/water.js probeUpdater)
  function probe(water, renderer, scene, opts) { probeJob = water?.probeUpdater?.(renderer, scene, opts) ?? null; return probeJob; }

  const fogTmp = new THREE.Color();
  function update(frame) {
    setHour(frame.hour);
    const elev = clamp(sunDir.y, -1, 1);
    frame.sunDir = sunDir;
    frame.sunShare = clamp((frame.elevDeg + 0.8) / 2.0, 0, 1);    // the disc sets over ≈ 2° (−0.8° is its last limb)
    frame.waterSunIntensity = 6.0 * lum * Math.max(0, elev) * 4;  // main.js's water sun (no-atmosphere path, skyNode)
    // the starlit night (owner, 2026-11-07: a photographer's lens): the hand-set colours (the water's tints, the mist,
    // the trees' sky light, the spray) keep a floor of light, so the night exposure shows them as a long exposure would
    frame.lightRaw = frame.light;          // the sky's own light: for what only sunlight shows (the air's motes and lines)
    frame.starlit = nightFloor > 0;        // the starlit night is on (the water's night sheen reads it)
    if (frame.light < nightFloor) frame.light = nightFloor;
    exposure.value = frame.exposure;
    frame.exposureComp = baseExposure / frame.exposure;   // for light sources that should hold their on-screen level
    if (fogColor) fogColor.value.copy(mistColor(elev, fogTmp)).multiplyScalar(lum * frame.light * mistGain);
    for (const fn of targets) fn(frame);
    if (probeJob) {
      if (frame.probe) probeJob.start();
      probeJob.step();
    }
    return frame;
  }

  return { exposure, sunDir, sunAt, setHour, collect, add, probe, update, get probeJob() { return probeJob; }, targets };
}
