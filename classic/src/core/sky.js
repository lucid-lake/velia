// The sky and atmosphere: a physical sky (Bruneton scattering via @takram/three-atmosphere, TSL) for the lake's place
// and hour, and the valley mist (height fog) coloured by the sun's height.
import * as THREE from 'three/webgpu';
import { float, smoothstep, context, positionWorld, cameraPosition, fog, exp, abs, select, Fn, uniform } from 'three/tsl';
import { getSunDirectionECEF, getMoonDirectionECEF, getECIToECEFRotationMatrix } from './celestial.js';   // not the sky library's root: its WebGL build
import { AtmosphereContext, AtmosphereLight, AtmosphereLightNode, skyBackground } from '@takram/three-atmosphere/webgpu';
import { skyEnvironmentOnce } from './skyEnvironment.js';   // the library's node minus its listener leak (B6)
import { Ellipsoid, Geodetic, radians } from '@takram/three-geospatial';
import { clamp } from '../../../src/sim/core/params.js';
import { pointStbn } from './stbn.js';
pointStbn();   // the atmosphere's blue noise from our own host, before any shader is built (perf/slow-loading-2)
import { timeAt } from '../../../src/sim/place.js';

// The lake's place on Earth (owner, 2026-10-29: real Tahoe): Fannette Island's summit, 38.954° N 120.100° W, on the
// lake surface (1,897.9 m), on the map's day (owner, 2026-11-07: the highlight day, Tahoe 2026-07-04; ?day=normal
// 2026-06-15; src/day.js); the hour is local clock time, PDT (src/place.js). The sun, the moon (its phase and place)
// and the stars follow the real date (astronomy-engine, src/core/celestial.js). The core passes it in: the chosen
// lake's place (makePlace(waters), the lake profile).
// Before 2026-10-29: 47° N on the Greenwich meridian, 2026-06-21, hour = UTC.

// World frame: x east, y up, z south, origin at the lake surface over Fannette Island (src/geo.js, true north). The
// sky model works in ECEF, so the context gets one orthogonal matrix from our world to ECEF: east-north-up at the
// origin, with our axes swapped in. The origin sits at the lake's real altitude, so world y = 0 is 1,898 m up (the
// air above it is thinner: a bluer sky and less aerial haze than the sea-level frame had).
export function worldToECEF(place) {
  const originECEF = new Geodetic(radians(place.lonDeg), radians(place.latDeg), place.altM).toECEF();
  const enu = Ellipsoid.WGS84.getEastNorthUpFrame(originECEF);           // (e, n, u) → ECEF
  const swap = new THREE.Matrix4().set(                                   // (x, y, z) → (e, n, u) = (x, −z, y)
    1, 0, 0, 0,
    0, 0, -1, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
  );
  return { matrix: enu.multiply(swap), originECEF };
}

// Returns { atmosphere, sunWorld (unit vector; src/daylight.js keeps it live), elev (sunWorld.y at the start hour),
// matrixWorldToECEF, originECEF, date }.
export function createSky({ renderer, scene, camera, hour, exposure, fogA: FOG_A, fogB: FOG_B, place, mistGain = 1 }) {
  // --- Atmosphere ----------------------------------------------------------------
  const atmosphere = new AtmosphereContext();
  atmosphere.camera = camera;
  const { matrix: m, originECEF } = worldToECEF(place);
  atmosphere.matrixWorldToECEF.value.copy(m);
  const date = timeAt(hour, place);
  getSunDirectionECEF(date, atmosphere.sunDirectionECEF.value, originECEF);
  getMoonDirectionECEF(date, atmosphere.moonDirectionECEF.value, originECEF);
  getECIToECEFRotationMatrix(date, atmosphere.matrixECIToECEF.value);
  renderer.contextNode = context({ ...renderer.contextNode.value, getAtmosphere: () => atmosphere });

  scene.backgroundNode = skyBackground();
  scene.environmentNode = skyEnvironmentOnce();
  renderer.library.addLight(AtmosphereLightNode, AtmosphereLight);
  scene.add(new AtmosphereLight());

  // --- Valley mist: exponential height fog, integrated analytically along the view ray (Quílez) -------
  // density(y) = A · exp(−y / B). Mist lies on the water and thins with height; the camera sees it from above.
  {
    const fogA = uniform(FOG_A), fogInvB = uniform(1 / FOG_B);
    const fogColor = uniform(new THREE.Color());
    const factor = Fn(() => {
      const ray = positionWorld.sub(cameraPosition);
      const dist = ray.length();
      const dy = ray.y.div(dist);
      const safeDy = select(abs(dy).lessThan(1e-3), float(1e-3), dy);   // a level ray: the limit A·exp(−cy/B)·dist
      const integral = fogA.div(fogInvB).mul(exp(fogInvB.negate().mul(cameraPosition.y)))
        .mul(float(1).sub(exp(fogInvB.negate().mul(safeDy).mul(dist)))).div(safeDy);
      return float(1).sub(exp(integral.negate())).clamp(0, 1);
    })();
    scene.fogNode = fog(fogColor, factor);
    scene.userData.fogColor = fogColor;   // set once the sun is known, below
    scene.userData.fogDensity = fogA;      // wow/storm: the rain's haze raises it (src/weather/storm.js) and puts it back
  }

  // The sun in world space, for the shader ramps (dusk warmth on the water).
  const sunWorld = atmosphere.sunDirectionECEF.value.clone().applyMatrix4(new THREE.Matrix4().copy(m).invert().setPosition(0, 0, 0)).normalize();
  const elev = clamp(sunWorld.y, -1, 1);
  // day, dusk and t below are read by nothing today (carried over from main.js unchanged, so the node graph is built as before).
  const day = smoothstep(-0.05, 0.25, float(elev));
  const dusk = float(1).sub(smoothstep(0.0, 0.35, float(Math.abs(elev))));
  // Mist colour by sun height: warm grey at dawn, pale blue-grey by day, slate at night. A PMREM sample later.
  {
    const t = clamp((elev + 0.05) / 0.35, 0, 1);
    const night = new THREE.Color(0x3a4452), dawn = new THREE.Color(0xd9cfc2), dayC = new THREE.Color(0xc8d3dc);
    const c = elev < 0.08 ? night.clone().lerp(dawn, clamp((elev + 0.05) / 0.13, 0, 1)) : dawn.clone().lerp(dayC, clamp((elev - 0.08) / 0.3, 0, 1));
    // Scene colours are physical luminance before the AgX exposure; put the mist in the same units.
    scene.userData.fogColor.value.copy(c).multiplyScalar(0.6 / exposure * mistGain);   // mistGain: S3 (src/core/farLook.js)
  }
  // D2: the daylight (src/daylight.js) moves the sun from here on: it needs the frame, the observer and the day
  return { atmosphere, sunWorld, elev, matrixWorldToECEF: m, originECEF, place };
}
