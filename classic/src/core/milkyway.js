// The Milky Way in the night sky (stage S0). NASA SVS "Deep Star Maps 2020", its
// Milky Way layer without the bright stars (the sky library draws those as points), in J2000 coordinates like the
// library's star catalogue: sampled by the view direction through the same ECI → ECEF matrix, so it turns with the
// stars and stands at its real place on any date and hour (src/daylight.js sets the matrix). Textures: data/sky/
// (tools/milkyway/build.mjs; ATTRIBUTION.md).
//
//   const mw = createMilkyWay({ atmosphere, sky: scene.backgroundNode, place, matrixWorldToECEF, size: 4096 })
//   daylight.add(mw.daylight)     every frame: the level from the sun and the moon; the first night frame starts the load
//   mw.arm()                      live pages: after the first frame (the load never competes with the first visit)
//   await mw.load()               captures: before the first frame
//
// How it draws: added to the sky node's stars term (SkyNode: (stars + sun + moon) × transmittance + inscattering), so
// the atmosphere's own transmittance dims it into the horizon haze, the moon disc covers it, the terrain and the
// boat draw over it (it is the background), the clouds' post pass covers it, and the water's probe reflects it.
// Brightness in the stars' units (cd/m² × the library's luminance scale × the stars' intensity), so a star stays
// brighter than the band at any exposure. Mostly grey (the eye's rod vision); the map's colour at 30 %.
// Light pollution: soft domes low over South Lake Tahoe, Reno and Tahoe City (src/core/milkyway-math.js LIGHT_DOMES).
// Not on the WebGL2 plain sky (src/core/skyFallback.js replaces the sky node).
//
// The starlit night (owner, 2026-11-07: "brighter … as if it has light, so that we are able to see the boat clearly"):
// the sky model has no light of its own once the sun is 18° down (no airglow, no starlight), so under the night exposure
// (src/timeOfDay.js: 6 × 362) the scene was black. Two constant physical sources fill that gap, and the exposure's own
// night adaptation reveals them; by day they are 362 × dimmer on screen than by night, so nothing pops at dusk:
//   airglow   a deep blue sky glow in the stars term, lighter and greener toward the horizon (√ of the van Rhijn path
//             through the 90 km glow layer: up to 2.45 ×), dimmed and reddened there by the haze; brighter with the moon
//   nightLight a cool hemisphere light (blue-silver sky, dark ground) for the boat, the shore and the water's body,
//             brighter with the moon. A film's day-for-night, not a dark-adapted eye's real night.
import * as THREE from 'three/webgpu';
import { Fn, uniform, texture, uv, vec2, vec3, vec4, float, atan, asin, fract, exp2, exp, abs, max, mix, min, smoothstep, sin, dot, instancedBufferAttribute } from 'three/tsl';
import { equirectToDirectionWorld } from '@takram/three-geospatial/webgpu';
import { Body, Illumination } from 'astronomy-engine';
import { MW_LOG_K, MW_REF_MAG, surfaceLuminance, milkyWayLevel, nightFade, LIGHT_DOMES, moonLightShare, bandAim } from '../../../src/core/milkyway-math.js';
import { NIGHT_CLOUD, NIGHT_LAND } from './night.js';
import { timeAt } from '../../../src/sim/place.js';

export const MW_URL = { 4096: '/data/sky/milkyway-4k.webp', 2048: '/data/sky/milkyway-2k.webp', tint: '/data/sky/milkyway-tint.png' };
// the band's scale over the physical: the stars' own (StarsNode.intensity, 1000) × a look gain the owner judges (3:
// at 1 the band read as a smudge on the Mac's screen under our night exposure, at 8 as an astrophoto; the gain
// option multiplies it)
const STARS_INTENSITY = 1000;
// Round 2 (owner, 2026-11-07: brighter; "a photographer's lens, not the naked eye"): an astro landscape
// photo's band: rich, a warm golden-brown core, a blue-violet outer band, dark lanes.
const MW_GAIN = 9;              // 3 → 9
const MW_SATURATION = 0.7;      // the map's own colour at 70 % (round 1: 12 %, the eye's grey)
const MW_CONTRAST = 1.25;       // x^1.25 over the map's range (x ≤ 1): the core and the lanes stand out from the glow
const MW_OUTER = [0.8, 0.86, 1.18];   // the faint outer band's blue-violet (an astrophoto's white balance), × the map's colour where x < 0.3
// The starlit night (see above). Luminance in the band's units (K: the band's x = 1).
export const AIRGLOW = 0.065;          // the zenith's glow over K (round 3: 0.04 → 0.065, a sky bright enough to mirror); × up to 2.45 to the horizon
const AIRGLOW_COLOUR = [0.36, 0.52, 1.0];   // deep blue at the zenith
const AIRGLOW_HORIZON = [0.26, 0.62, 1.0];  // the airglow band low over the horizon: blue-green here, the haze's reddening turns it green-amber on screen
const MOON_SKY = 4;             // a full moon high: the glow and the night light × (1 + 4)
export const NIGHT_LIGHT = { sky: 0x9fb6dc, ground: 0x10161f, intensity: 1e-3 };   // three's hemisphere light units (× the night exposure 2172 ≈ 2.2)
// Round 5 (owner, 2026-11-07: "land not pure black"): the land's own lift (src/core/night.js NIGHT_LAND), a cool blue-grey,
// in scene radiance per unit albedo; the trees take half of it (src/trees.js). SSE at 22:30 (tools/milkyway/ridge_ratio.mjs):
// the forested ridge from 30 × darker than the sky beside it to 4.9 ×, its open slope 1.5 ×; the tree line stays a silhouette
const NIGHT_LAND_COLOUR = [0.62, 0.72, 0.9];
const NIGHT_LAND_LEVEL = 1.0e-4;
// The stars' twinkle (round 5): their brightness flickers by a seeded sum of two sines per star on the scene clock (so a
// capture's frozen clock gives the same frame), ± TWINKLE.amp at the zenith, up to ± TWINKLE.horizon low down (more air),
// with a touch of colour; the sky library's catalogue points (StarsNode) carry it, nothing else changes.
const TWINKLE = { amp: 0.22, horizon: 0.6, hz: [2.1, 3.7], colour: 0.2 };
// The long-exposure twilight (fireworks S1 round 2, the show's evening only; owner 2026-11-08: "deep blue twilight, as a long
// exposure at 21:44 shows"): a deep blue sky glow, lighter toward the horizon, full from sun −13.5° to −8°, gone by −18.5°
// (≈ 22:30 on 4 July), so the approved galaxy night is unchanged after it. Off on other evenings: the game's look is as approved.
// Round 3 (owner, 2026-11-08: "deeper … dark blue, not grey-blue … darker toward the zenith, a thin warm band low in the
// west only"): saturated deep blue, brightest 10–30° up, darker toward the zenith, faded out in the lowest 8° (the haze's
// transmittance turned it orange there); the light domes dimmed under it; no extra land light (it lit the far ridge pale).
const TWILIGHT = { level: 0.2, zenith: [0.03, 0.08, 1.0], horizon: [0.08, 0.2, 1.0], fullDeg: [-13.5, -12], goneDeg: [-18.5, -5], light: 0, domes: 0.85 };   // S2: rises from 21:00 (sun −5°) to the show (−12°), gone by ≈ 22:30 (−18.5°)
export const twilightLevel = (sunDeg) => {
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return ss(TWILIGHT.goneDeg[0], TWILIGHT.fullDeg[0], sunDeg) * (1 - ss(TWILIGHT.fullDeg[1], TWILIGHT.goneDeg[1], sunDeg));
};
const LP_SCALE = 3 / MW_GAIN;          // the domes keep round 1's level (they were tuned at MW_GAIN 3; at 9 they read as a sunset)
const LP_COLOUR = [0.9, 0.86, 0.8];    // warm LED and sodium; the haze's transmittance reddens it further near the horizon

function placeholder(r, g = r, b = r) {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
  t.needsUpdate = true;
  return t;
}

async function bitmap(url, fetchImpl) {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

// starlit: the night look (the airglow, the night light, the clouds' night light); false keeps round 1's dark night
export function createMilkyWay({ atmosphere, sky, place, matrixWorldToECEF, size = 4096, gain = 1, starlit = true, twilight = false, fetchImpl = (u) => fetch(u) } = {}) {
  const ecefToWorld = new THREE.Matrix4().copy(matrixWorldToECEF).invert().setPosition(0, 0, 0);
  const uScale = uniform(0);    // level × gain × K (cd/m² at x = 1 × the stars' intensity × MW_GAIN)
  const uLight = uniform(0);    // the light domes' level
  const uAir = uniform(starlit ? AIRGLOW : 0);   // the airglow's level (× the moon)
  const uTw = uniform(0);       // the long-exposure twilight's level (the show's evening)
  const lumTex = placeholder(0), tintTex = placeholder(128);
  const lumNode = texture(lumTex), tintNode = texture(tintTex);
  const LOG1K = Math.log2(1 + MW_LOG_K);
  const K = surfaceLuminance(MW_REF_MAG) * STARS_INTENSITY * MW_GAIN;

  const node = Fn(() => {
    const dirWorld = equirectToDirectionWorld(uv()).normalize().toConst();   // the background sphere's direction, as the sky's
    const dirECEF = atmosphere.matrixWorldToECEF.mul(vec4(dirWorld, 0)).xyz;
    const dirECI = vec4(dirECEF, 0).mul(atmosphere.matrixECIToECEF).xyz.toConst();   // v · M = Mᵀ v: ECEF → J2000
    const u = fract(float(0.5).sub(atan(dirECI.y, dirECI.x).div(2 * Math.PI)));
    const v = float(0.5).sub(asin(dirECI.z.clamp(-1, 1)).div(Math.PI));
    const st = vec2(u, v).toConst();
    const e = lumNode.sample(st).r;
    const x0 = exp2(e.mul(LOG1K)).sub(1).div(MW_LOG_K).toConst();
    const x = x0.pow(MW_CONTRAST);
    const tint = tintNode.sample(st).rgb.mul(255 / 127.5);
    const hue = mix(tint.mul(vec3(...MW_OUTER)), tint, smoothstep(0.03, 0.3, x0));   // blue-violet where faint, the map's warm core where bright
    const band = mix(vec3(1), hue, MW_SATURATION).mul(x).mul(uScale);
    // the light domes, by the direction's true bearing and height
    const az = atan(dirWorld.x, dirWorld.z.negate()).mul(180 / Math.PI);   // x east, z south
    const alt = max(asin(dirWorld.y.clamp(-1, 1)).mul(180 / Math.PI), 0);
    let dome = float(0);
    for (const d of LIGHT_DOMES) {
      const da0 = abs(az.sub(d.az));
      const da = min(da0, float(360).sub(da0));
      dome = dome.add(exp(da.div(d.w).pow2().negate()).mul(exp(alt.div(-d.h))).mul(d.a));
    }
    const glow = vec3(...LP_COLOUR).mul(dome).mul(uLight).mul(K * LP_SCALE);
    // the airglow: the slant path through a thin layer 90 km up (van Rhijn), 1 at the zenith, 6 at the horizon
    const cosZ = max(dirWorld.y, 0);
    const vanRhijn = float(1).div(float(1).sub(float(0.9724).mul(float(1).sub(cosZ.mul(cosZ)))).sqrt());
    const airHue = mix(vec3(...AIRGLOW_COLOUR), vec3(...AIRGLOW_HORIZON), smoothstep(2.5, 5.5, vanRhijn));
    // brightness × √(van Rhijn) (1 → 2.45): a lighter horizon without the full 6 × band, which read as a sunset glow
    const air = airHue.mul(vanRhijn.sqrt()).mul(uAir).mul(K);
    const twShape = smoothstep(0.0, 0.14, dirWorld.y).mul(float(1).sub(smoothstep(0.35, 1.0, dirWorld.y).mul(0.55)));
    const tw = mix(vec3(...TWILIGHT.zenith), vec3(...TWILIGHT.horizon), smoothstep(1.5, 5, vanRhijn)).mul(twShape).mul(uTw).mul(K);
    return band.add(glow).add(air).add(tw).mul(atmosphere.parametersNode.luminanceScale);
  })();

  // the stars' twinkle: the catalogue's own points (StarsNode builds its material once its data has loaded), patched there
  const uTime = uniform(0);
  const stars = sky?.starsNode;
  if (starlit && stars && typeof stars.setupMaterial === 'function') {
    const setup = stars.setupMaterial.bind(stars);
    stars.setupMaterial = (builder) => {
      setup(builder);
      const m = stars.material, base = m.colorNode;
      if (!base || !stars.positionBuffer) return;
      const pos = instancedBufferAttribute(stars.positionBuffer, 'vec3');
      const up = atmosphere.matrixECEFToWorld.mul(vec4(atmosphere.matrixECIToECEF.mul(vec4(pos, 0)).xyz, 0)).y;   // the star's height (sin of)
      const seed = fract(sin(dot(pos, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
      const s1 = sin(uTime.mul(TWINKLE.hz[0] * 2 * Math.PI).mul(seed.mul(0.6).add(0.7)).add(seed.mul(61.7)));
      const s2 = sin(uTime.mul(TWINKLE.hz[1] * 2 * Math.PI).mul(seed.mul(0.5).add(0.75)).add(seed.mul(17.3)));
      const air = smoothstep(0.5, 0.05, up);   // 0 high up, 1 near the horizon
      const amp = mix(float(TWINKLE.amp), float(TWINKLE.horizon), air);
      const k = float(1).add(s1.mul(0.6).add(s2.mul(0.4)).mul(amp));
      const tint = vec3(float(1).add(s2.mul(TWINKLE.colour).mul(air)), 1, float(1).sub(s2.mul(TWINKLE.colour).mul(air)));
      m.colorNode = base.mul(k).mul(tint).toVertexStage();
      m.needsUpdate = true;
    };
  }
  // into the sky's stars term (built at the sky's first setup: call before the first frame)
  if (sky?.starsNode) sky.starsNode = sky.starsNode.add(node);

  // the night light (added to the scene by the core): constant, the exposure reveals it (see above)
  const nightLight = new THREE.HemisphereLight(NIGHT_LIGHT.sky, NIGHT_LIGHT.ground, starlit ? NIGHT_LIGHT.intensity : 0);
  nightLight.name = 'nightLight';
  const state = { size, gain, moonLight: 0, loaded: false, loading: null, armed: false, error: null, level: 0, light: 0, moonAltDeg: -90, moonLit: 0, wantsLoad: false };
  const scratch = new THREE.Vector3();
  let litHour = null;

  async function load() {
    if (state.loaded) return true;
    state.loading ??= (async () => {
      const [lum, tint] = await Promise.all([bitmap(MW_URL[size] ?? MW_URL[4096], fetchImpl), bitmap(MW_URL.tint, fetchImpl)]);
      const make = (img, format) => {
        const t = new THREE.Texture(img);
        t.format = format; t.flipY = false; t.generateMipmaps = false;   // magnified at every view: 5.3′ a texel at 4K, ≈ 2.6′ a pixel on screen
        t.minFilter = t.magFilter = THREE.LinearFilter;
        t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
        t.colorSpace = THREE.NoColorSpace; t.name = 'MilkyWay';
        t.needsUpdate = true;
        return t;
      };
      lumNode.value = make(lum, THREE.RedFormat);
      tintNode.value = make(tint, THREE.RGBAFormat);
      state.loaded = true;
      apply();
      return true;
    })().catch((e) => { state.error = String(e?.message ?? e); state.loading = null; return false; });
    return state.loading;
  }

  function apply() {
    uScale.value = state.loaded ? state.level * state.gain * K : 0;
    uLight.value = state.light * (1 - TWILIGHT.domes * (state.twilight ?? 0));
    if (!starlit) return;
    const moon = 1 + MOON_SKY * state.moonLight;
    uAir.value = AIRGLOW * moon;
    uTw.value = TWILIGHT.level * (state.twilight ?? 0);
    nightLight.intensity = NIGHT_LIGHT.intensity * moon * (1 + TWILIGHT.light * (state.twilight ?? 0));
    // the clouds' night light: the airglow sky's mean (≈ 2.5 × the zenith's), the clouds' own units before the luminance scale
    NIGHT_CLOUD.value.setRGB(...AIRGLOW_COLOUR).multiplyScalar(AIRGLOW * 2.5 * K * moon);
    NIGHT_LAND.value.setRGB(...NIGHT_LAND_COLOUR).multiplyScalar(NIGHT_LAND_LEVEL * moon);
  }

  // the daylight hook (src/daylight.js): frame.elevDeg, frame.hour
  function daylight(f) {
    if (f.time != null) uTime.value = f.time;   // the scene clock (the core's): the twinkle
    scratch.copy(atmosphere.moonDirectionECEF.value).applyMatrix4(ecefToWorld).normalize();
    state.moonAltDeg = Math.asin(Math.max(-1, Math.min(1, scratch.y))) * 180 / Math.PI;
    if (litHour == null || Math.abs(f.hour - litHour) > 0.25) {
      litHour = f.hour;
      state.moonLit = Illumination(Body.Moon, new Date(timeAt(f.hour, place))).phase_fraction;
    }
    state.moonLight = moonLightShare(state.moonAltDeg, state.moonLit);
    state.level = milkyWayLevel({ sunDeg: f.elevDeg, moonAltDeg: state.moonAltDeg, moonLit: state.moonLit });
    // the domes: night only; a bright moon lifts the sky round them, so they fade by half of the band's dimming
    const fade = nightFade(f.elevDeg);
    state.light = fade > 0 ? fade * (0.5 + 0.5 * (state.level / fade)) : 0;
    state.twilight = twilight ? twilightLevel(f.elevDeg) : 0;
    state.wantsLoad = f.elevDeg < -6;
    if (state.gain > 0 && state.wantsLoad && state.armed && !state.loaded && !state.loading && !state.error) load();
    apply();
  }

  function arm() { state.armed = true; }
  const setGain = (g) => { state.gain = g; apply(); };
  // the band's best point in the sky at the clock's hour (milkyway-math.js bandAim), through the stars' own matrix
  const v3 = new THREE.Vector3();
  const toWorld = (d) => { v3.set(d[0], d[1], d[2]).applyMatrix4(atmosphere.matrixECIToECEF.value).applyMatrix4(ecefToWorld).normalize(); return [v3.x, v3.y, v3.z]; };
  const aim = (o) => bandAim(toWorld, o);
  // a clear dark night for the band: the sun's fade × the moon's dimming (state.level) near full, the band drawn
  const dark = (min = 0.8) => state.loaded && state.gain > 0 && state.level >= min;

  return { node, stars, daylight, load, arm, setGain, aim, dark, state, nightLight, uniforms: { scale: uScale, light: uLight, air: uAir, time: uTime }, textures: { lum: lumNode, tint: tintNode } };
}
