// The weather bus (wow/storm; refactor Phase 2 step 4): the storm's shader side, one set of uniforms and the small TSL
// hooks the shared shaders call (the clouds' density, the sun's direct light, the water's rain and sun, the post grade).
// The storm owns it: src/weather/storm.js is its only writer (each frame, from the arc: stormArc.js). The clouds, the
// water, the sun's light and the post grade read it through the handle they are given at creation, not a module import:
//   const weather = createWeatherBus();                  // src/core/world.js, handed to createStorm({ weather })
//   clouds({ weather, … })    createWater({ features: [ …, weather.water(), … ] })    createPost({ weather, … })
// Every hook is gated on SU.on: with no storm the branch is not taken and the hook returns its input exactly (x + 0,
// x × 1), so the default look is the same pixels (the goldens).
import * as THREE from 'three/webgpu';
import { getViewPosition, vec4, normalize } from 'three/tsl';
import { rainbowLight } from './rainbow.js';
import { texture3D } from 'three/tsl';
import { Fn, If, float, vec2, vec3, uniform, smoothstep, mix, max, min, clamp, length, dot, fract, floor, sin, cos, sqrt, exp, mx_noise_float, positionWorld, screenUV } from 'three/tsl';
import { addSlope } from '../../../src/sim/waters/features.js';
import { STORM_TOP_M, WEATHER_SCALARS, WEATHER_VECTORS } from '../../../src/sim/weather/state.js';

export { STORM_TOP_M };   // the towers' top above the lake (m): the shared sim's (src/sim/weather/state.js)

// The bus's uniforms from the shared sim's plain weather state (src/sim/weather/state.js; src/weather/storm.js calls it
// after each sim step and stop): the same fields, one for one; the camera's matrices (camWorld, projInv) are set by the storm
export function writeWeatherUniforms(SU, W) {
  for (const k of WEATHER_SCALARS) SU[k].value = W[k];
  for (const k in WEATHER_VECTORS) SU[k].value.fromArray(W[k]);
}
const DIRX = Math.sin(70 * Math.PI / 180), DIRZ = -Math.cos(70 * Math.PI / 180);   // the drift (stormArc.js DIR)
const LUMA = vec3(0.2126, 0.7152, 0.0722);
const DX = Math.sin(70 * Math.PI / 180), DZ = -Math.cos(70 * Math.PI / 180);   // the drift (stormArc.js DIR)

// --- the water's rain rings (src/water.js, before its normal) ----------------------------------------------------
// Rings: each 0.6 m cell holds one drop every ≈ 0.9 s (its own phase), an expanding ring 0–0.35 m that fades as it
// grows; two offset layers. Past ≈ 4 footprints the rings go into the unresolved slope (roughness).
const hash2 = (q) => fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453));
function ringsAt(p, t, cellM, salt) {
  const g = p.div(cellM).add(salt), id = floor(g), f = fract(g).sub(0.5);
  const h = hash2(id.add(salt * 7.3)), h2 = hash2(id.add(salt * 3.1 + 11.0));
  const ph = fract(t.mul(1.1).add(h));                    // 0..1 over a drop's life
  const c = vec2(h.sub(0.5), h2.sub(0.5)).mul(0.5);       // the drop's place in its cell
  const d = f.sub(c), r = length(d).mul(cellM);
  const R = ph.mul(0.35);                                  // the ring's radius (m)
  const x = r.sub(R).mul(40);                              // across the ring
  const prof = cos(x.mul(3.0)).mul(exp(x.mul(x).negate())).mul(float(1).sub(ph)).mul(float(1).sub(ph));
  const dir = d.div(max(length(d), 1e-4));
  return dir.mul(prof.mul(0.07));
}

export function createWeatherBus() {
  const SU = {
    on: uniform(0),                              // 1 while a storm runs: every hook below is off at 0
    cell: uniform(new THREE.Vector3(0, 0, 1)),   // the cell's centre x, z and radius (m)
    cover: uniform(0),                           // its coverage 0–1
    tall: uniform(0),                            // its towers' growth 0–1 (into an anvil)
    slab: uniform(0),                            // metres added to the deck's slab top (the towers' height)
    shelfDrop: uniform(0),                       // metres the shelf cloud hangs below the deck's base (0: none)
    under: uniform(0),                           // metres the clouds' march reaches below the deck's base (the shelf, the curtains)
    rainCore: uniform(0),                        // the rain falling from the cell's core (0–1): the curtains under it
    shade: uniform(0),                           // how much of the sun the cell takes (0–1)
    gaps: uniform(0),                            // the clearing's gaps in the shade (0–1): sun breaking through
    rain: uniform(0),                            // the rain at the listener (0–1): the water's rings and roughness
    dark: uniform(0), gold: uniform(0), flash: uniform(0), flashAdd: uniform(0), haze: uniform(0),
    time: uniform(0),                            // the arc's seconds (the gaps and the rings move on it)
    front: uniform(new THREE.Vector4(0, 0, 0, 0)),   // the outflow line: the reference x, z, its place along the drift (m), its strength
    sun: uniform(new THREE.Vector3(0, 1, 0)),    // the sun (world, unit)
    bow: uniform(0),                             // the rainbow's strength (scene luminance units)
    bowAmt: uniform(0),                          // the same, 0–1 (the dark band between the bows)
    toRain: uniform(new THREE.Vector2(1, 0)),    // toward the departing rain (horizontal)
    camWorld: uniform(new THREE.Matrix4()),      // the scene camera's (the post quad has its own camera)
    projInv: uniform(new THREE.Matrix4()),
    drift: uniform(new THREE.Vector2(0, 0)),     // the shade's noise offset (m): carried with the cell
  };

  // a float or vec3 hook: build() when the storm is on, else the fallback node, untouched
  const gate = (fallback, build) => Fn(() => {
    const v = fallback.toVar();
    If(SU.on.greaterThan(0.5), () => { v.assign(build()); });
    return v;
  })();

  // the cell's coverage at a world point (xz) and height y: 1 in its core, 0 past its radius; the anvil spreads it aloft
  const cellMask = (xz, y = float(0)) => {
    const anvil = smoothstep(4500, 7200, y).mul(smoothstep(0.6, 1.0, SU.tall)).mul(0.35);   // the anvil spreads only once the tower is up
    // the trailing side (upwind, behind the core) stretched: the rain's grey stratiform tail follows the towers
    const rel = xz.sub(vec2(SU.cell.x, SU.cell.y)), a = rel.x.mul(DX).add(rel.y.mul(DZ));
    const rel2 = rel.add(vec2(DX, DZ).mul(min(a, 0).mul(-0.45)));
    const d = length(rel2).div(SU.cell.z.mul(anvil.add(1)));
    return float(1).sub(smoothstep(0.38, 1.0, d)).mul(SU.cover);
  };

  // the clouds' transmittance under a storm: below ≈ 3 % it is 0 (the march stops at 1 %, and the sun's disc is bright
  // enough to show through that last 1 % of a thunderhead)
  const cloudSeal = (T) => gate(float(T), () => float(T).mul(mix(float(1), smoothstep(0.015, 0.05, T), SU.cover)));
  // --- clouds (src/clouds.js baseDensity): the cell's towers in the deck layer -----------------------------------
  // returns { m } (0 off): the caller raises the coverage to m, the type toward towers, the layer's height by the slab and
  // the density inside the cell (darker bases)
  const cloudCell = (p) => gate(float(0), () => cellMask(p.xz, p.y));

  // the shelf (arcus) cloud over the outflow line: a low, dark wedge along the gust front, its nose lowest just behind the
  // line and rising back into the deck; ragged like the line (frontBand); shaped by the deck's own shape noise
  const shelfCloud = (p, base, shape) => gate(float(0), () => {
    const d0 = p.xz.sub(vec2(SU.front.x, SU.front.y));
    const a = d0.x.mul(DIRX).add(d0.y.mul(DIRZ)), c = d0.x.mul(-DIRZ).add(d0.y.mul(DIRX));
    const dx = a.sub(SU.front.z).add(sin(c.div(310).add(1.3)).mul(60)).add(sin(c.div(130).sub(0.4)).mul(35));
    const bottom = base.sub(SU.shelfDrop.mul(smoothstep(-900, -60, dx)));
    const inY = smoothstep(bottom, bottom.add(90), p.y).mul(float(1).sub(smoothstep(base.add(150), base.add(320), p.y)));
    const inX = float(1).sub(smoothstep(40, 260, dx)).mul(smoothstep(-1100, -600, dx));   // ≈ 1 km deep
    // as long as the storm is wide, not the whole line: it trails off on both flanks
    const near = float(1).sub(smoothstep(0.7, 1.3, length(p.xz.sub(vec2(SU.cell.x, SU.cell.y))).div(SU.cell.z.mul(1.6))));
    return inY.mul(inX).mul(near).mul(smoothstep(0.3, 0.6, shape)).mul(1.5).mul(SU.front.w);
  });

  // the rain's curtains: grey veils hanging from the cell's base to the water under its core, streaked (the detail noise
  // stretched 7× in height) and leaning downwind, moving with the cell. Thin: ≈ 0.6 optical depth per km.
  const rainShaft = (p, base, detailTex, wind, time) => gate(float(0), () => {
    const d = length(p.xz.sub(vec2(SU.cell.x, SU.cell.y))).div(SU.cell.z);
    const core = float(1).sub(smoothstep(0.3, 0.85, d)).mul(SU.rainCore);
    const lean = p.xz.sub(vec2(wind.x, wind.y).mul(time)).add(vec2(wind.x, wind.y).mul(base.sub(p.y).mul(0.08)));
    const streak = texture3D(detailTex, vec3(lean.x.div(420), p.y.div(2900), lean.y.div(420))).r;
    const fall = float(1).sub(smoothstep(base.sub(150), base, p.y)).mul(smoothstep(-20, 120, p.y).mul(0.5).add(0.5));
    return core.mul(fall).mul(smoothstep(0.3, 0.7, streak)).mul(0.17);
  });

  // the deck layer's storm hooks (src/clouds.js, a layer with storm: true; a fair layer's are the identity there). Each
  // takes the fair value and returns the stormy one; m: the cell's coverage at the point (cloudCell)
  const clouds = {
    slabTop: (top) => top.add(SU.slab),                    // the towers raise the slab's top
    slabBottom: (base) => base.sub(SU.under),              // the shelf cloud and the rain's curtains hang below the deck
    cell: (p) => cloudCell(p),
    thickness: (thickness, m, base) => thickness.add(m.mul(SU.tall).mul(max(float(STORM_TOP_M).sub(base).sub(thickness), 0))),
    type: (t, m) => mix(t, float(0.97), m),                // toward towers
    baseFade: (fade, m) => mix(fade, float(0.015), m),     // a thunderhead's base is flat (a 1.5 % fade, ≈ 100 m, not 10 %)
    coverage: (cov, m) => max(cov, m.mul(0.82)),           // under 1: the shape keeps hard, sunlit edges (at 1 the cell went soft and smoky)
    density: (d, { p, m, base, shape, detail, wind, time }) => {
      d = d.mul(m.mul(1.6).add(1));   // dense: hard cauliflower edges, a dark base in the towers' own shadow
      d = max(d.mul(p.y.greaterThan(base).select(1.0, 0.0)), shelfCloud(p, base, shape));   // the shelf over the outflow line
      return max(d, rainShaft(p, base, detail, wind, time));   // the rain's grey curtains under the cell
    },
    height: (h, m) => max(h, m),                           // billowy erosion in the cell
    lightThickness: (thickness) => thickness.add(SU.slab.mul(0.35)),   // in a thunderhead the sun's ray reaches further
    sunFloor: (sun) => max(sun, SU.cover.mul(0.06)),       // inside a thunderhead the light scatters on
    skyFloor: (sky) => max(sky, SU.cover.mul(0.3)),        // no black voids in a dense cell (the sky's light gets in sideways)
    seal: (T) => cloudSeal(T),                             // a storm's thick deck seals the sun's disc
  };

  // --- the sun's direct light (the atmosphere light's colour node; src/core/world.js): the cell's shadow, cast along
  // the sun to the cloud base, with gaps in the clearing (crepuscular patches on the water) -------------------------
  const shadowAt = (p) => {
    const s = SU.sun, base = float(1000);   // the dark base (the deck layer sits at 700–1600 m)
    // a low sun is still behind the cell: the shadow is cast as if the sun stood ≥ 15° up (round 2, owner 2026-11-05: at
    // 19:00+ the sun is 5–10° up, its shadow point fell 6–12 km off, past the cell, and the glint stayed lit in the rain)
    const q = p.xz.add(vec2(s.x, s.z).div(max(s.y, 0.26)).mul(base.sub(p.y)));
    const m = cellMask(q);
    const n = mx_noise_float(q.add(SU.drift).mul(1 / 1400)).mul(0.6).add(mx_noise_float(q.add(SU.drift).mul(1 / 430)).mul(0.4));
    const hole = smoothstep(0.05, 0.3, n).mul(SU.gaps);
    return float(1).sub(m.mul(SU.shade).mul(float(1).sub(hole)).mul(0.92));
  };
  const sunShade = (p = positionWorld) => gate(float(1), () => shadowAt(p));

  // --- the water (src/water.js): rain rings near the eye and a matte, roughened surface beyond ----------------------
  // the outflow line on the water (stormWind.js mirrored: the same ragged edge), 1 on the band, 0.35 behind it, 0 ahead
  const frontBand = (xz) => {
    const d0 = xz.sub(vec2(SU.front.x, SU.front.y));
    const a = d0.x.mul(DIRX).add(d0.y.mul(DIRZ)), c = d0.x.mul(-DIRZ).add(d0.y.mul(DIRX));
    const dx = a.sub(SU.front.z).add(sin(c.div(310).add(1.3)).mul(60)).add(sin(c.div(130).sub(0.4)).mul(35));
    const edge = exp(dx.div(130).mul(dx.div(130)).negate());
    const behind = float(1).sub(smoothstep(-40, 80, dx)).mul(0.4);
    return max(edge, behind).mul(SU.front.w);
  };
  const waterRain = ({ rest, time, footprint }) => {
    const s = gate(vec3(0), () => {
      const near = float(1).sub(smoothstep(0.008, 0.025, footprint));   // rings only where a ring spans many pixels (the near water)
      const a = ringsAt(rest, SU.time, 0.6, 0.0), b = ringsAt(rest, SU.time.add(0.47), 0.75, 0.37);
      const sl = a.add(b).mul(near).mul(SU.rain);
      // far: a matte grey hiss (the splashes' slope variance); the outflow line: a rough, dark band, rougher behind it
      return vec3(sl.x, sl.y, SU.rain.mul(0.05).mul(float(1).sub(near.mul(0.5))).add(frontBand(rest).mul(0.07)));
    });
    return { sx: s.x, sz: s.y, rough: s.z };
  };
  // the water's mirror under the storm: the probe was captured under a fair sky; the storm's sky is a dark grey lid
  const waterSky = (sky) => gate(vec3(sky), () => {
    const l = dot(sky, LUMA);
    return mix(sky, vec3(l).mul(vec3(0.82, 0.9, 1.0)).mul(0.42), SU.dark.mul(0.85));
  });
  // the water's glint under the cell's shadow (a per-pixel factor, 1 off)
  const waterSun = (pWorld) => sunShade(pWorld);
  // the rain as a water feature (src/waters/features.js slots): its rings and hiss in the slope, the grey lid in the
  // mirror, the cell's shadow on the sun before the glint's roll-off
  const water = () => ({
    id: 'rain',
    slope: { add: (acc, c) => addSlope(acc, waterRain({ rest: c.rest, time: c.time, footprint: c.footprint })) },
    sky: { mirror: (sky) => waterSky(sky) },
    glint: { sun: (g, c) => g.mul(waterSun(c.world)) },
  });

  // --- the post grade (src/core/post.js, before the tone mapping): the storm's steel, the flash, the gold ----------
  // depth: the scene pass's depth (the rainbow stands only where the scene is past ≈ 900 m: the far water, the sky)
  const stormGrade = (colorNode, depth = null) => gate(vec3(colorNode.rgb), () => {
    const c = vec3(colorNode.rgb).toVar();
    if (depth) {
      const d = depth.sample ? depth.sample(screenUV).r : depth.r ?? depth;
      const vp = getViewPosition(screenUV, d, SU.projInv);
      const dir = normalize(SU.camWorld.mul(vec4(vp, 0)).xyz);
      const far = smoothstep(700, 1100, vp.length()).max(d.greaterThanEqual(0.999999).select(1.0, 0.0));
      const bow = rainbowLight(dir, SU.sun, SU.toRain);
      c.mulAssign(float(1).sub(bow.alex.mul(SU.bowAmt).mul(0.18).mul(far)));   // Alexander's dark band between the bows
      c.addAssign(bow.light.mul(SU.bow).mul(far));
    }
    const l = dot(c, LUMA);
    // the storm: flattened, cooler, darker (desaturated toward its own luminance, the blacks kept)
    const steel = mix(c, vec3(l).mul(vec3(0.84, 0.94, 1.08)), SU.dark.mul(0.7)).mul(float(1).sub(SU.dark.mul(0.5)));
    // a vignette that closes in with the storm
    const uvc = screenUV.sub(0.5), vig = float(1).sub(dot(uvc, uvc).mul(SU.dark.mul(1.2)));
    // the clearing: a warm lift, a little more colour
    const warm = mix(steel, steel.mul(vec3(1.2, 1.02, 0.74)), SU.gold.mul(0.85));
    const sat = mix(vec3(dot(warm, LUMA)), warm, SU.gold.mul(0.18).add(1));
    // the lightning: the whole scene lit blue-white for a moment
    const fl = SU.flash;
    // the flash lights everything at once: the dark storm lifted toward the blue-white of the bolt, the shadows too
    // (the lift is SU.flashAdd: the flash held at its daytime screen level, or a night's long exposure turns it into a white frame)
    return sat.mul(vig).mul(vec3(0.85, 0.92, 1.12).mul(fl.mul(3.0)).add(1)).add(vec3(0.6, 0.68, 0.9).mul(SU.flashAdd.mul(0.03)));
  });

  return {
    uniforms: SU,   // the storm writes these (src/weather/storm.js); nothing else does
    gate, cellMask, cloudSeal, cloudCell, shelfCloud, rainShaft, shadowAt, sunShade, frontBand,
    waterRain, waterSky, waterSun, stormGrade, clouds, water,
  };
}
