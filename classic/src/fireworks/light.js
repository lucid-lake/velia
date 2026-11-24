// The fireworks' light, shared (S1 round 2): the flash bank's uniforms, written by the engine each frame and read by the
// post stage (src/fireworks/composite.js: the sky, the water and the land) and the smoke. Like src/core/night.js.
//   FW.bankPos[k]  vec4: the burst's world position, its intensity (a screen level, before the exposure)
//   FW.bankCol[k]  vec4: its colour, its glow (the slower burn after the flash, flash.js GLOW: the smoke and the air read it)
//   FW.active      1 while the show has stars or smoke in the air (the bloom's passes run only then), else 0
//   FW.flash       vec3: Σ colour × intensity (the frame's lift)
//   FW.gain        1 / the exposure (screen level → scene radiance)
//   FW.dist        the show's horizontal distance from the camera (m): the water's reflection looks this far
//   FW.night       0 by day … 1 after dusk (the sun 2° to 8° under the horizon; src/fireworks/world.js sets it each frame;
//                  1 on the demo): the far land's dark silhouette is a night look (S5: with the show on by default a
//                  daytime frame had its far ridges darkened, the goldens' overlook and clarity frames)
import * as THREE from 'three/webgpu';
import { uniform, uniformArray, vec3, float, Loop, Fn, dot, exp, max, normalize } from 'three/tsl';
import { FLASH_SLOTS } from '../../../src/fireworks/flash.js';

export const FW = {
  bankPos: uniformArray(Array.from({ length: FLASH_SLOTS }, () => new THREE.Vector4()), 'vec4'),
  bankCol: uniformArray(Array.from({ length: FLASH_SLOTS }, () => new THREE.Vector4()), 'vec4'),
  flash: uniform(new THREE.Vector3()),
  gain: uniform(1 / 2172),
  dist: uniform(750),
  time: uniform(0),   // the show clock (the water's fine ripples)
  night: uniform(1),
  active: uniform(1),
};
// the look of the flash (screen levels per unit of bank intensity)
// wow round (the close film's look as the game's): the burst glow cut (it read as fog discs at the finale), the hills' wash cut
// (it speckled the trees), the water's mirror steepened × 4 and brighter (the bursts overhead paint the water at the hull)
// look round 1 (F1 light): the stars bloom (bloom, bloomRadius: three's BloomNode on the fireworks' own target,
// in screen levels), their cores go white-hot above hotFrom..hotTo (hot: how far), the air round the bursts glows (skyCore,
// skyWide up, through the soft cap airCap), the water takes the bloomed layer as broad colour under the sharp glints
// (reflectBloom, with a floor waterFloor on the mirror's weight so the water at the hull is tinted too), and the boat and
// everything within nearTo m is washed in the burst's colour by its own lightness (nearWash, through nearCap)
export const FLASH_LOOK = { skyCore: 0.03, skyWide: 0.03, coreRad2: 0.02, wideRad2: 0.3, airCap: 0.4, wash: 0.004, washCap: 0.05, ripple: 0.2, washM: 650, farFrom: 3500, farTo: 9000, farDark: 0.3, water: 0.8, reflect: 2.2, wave: 1.6, limit: 1.4, lift: 4, sat: 1.8, horizonBlue: 0.85,
  bloom: 3, bloomRadius: 0.6, bloomRes: 0.5, bloomMips: 3, hotFrom: 0.9, hotTo: 2.6, hot: 0.45, reflectBloom: 5, waterFloor: 0.22, nearWash: 0.25, nearCap: 0.45, nearFrom: 60, nearTo: 240 };
// sat: the fireworks layer's chroma × this about its luminance (vivid overlaps); horizonBlue: how much of the lowest night
// sky's red haze band turns to the twilight's blue (0 by day: FW.night)
// lift: the water's mirrored ray steepened x lift before it looks for the bursts (1: the true mirror, the game; the close
// film, tools/fireworks/close_film.mjs, raises it so the bursts high overhead paint the water round the hull: a film's cheat)

// the bursts' light scattered in the night air, seen along a world direction from the camera (screen level)
export const skyFlash = (dir, camPos) => Fn(() => {
  const L = vec3(0).toVar();
  Loop(FLASH_SLOTS, ({ i }) => {
    const bp = FW.bankPos.element(i), bc = FW.bankCol.element(i);
    const bd = normalize(bp.xyz.sub(camPos));
    const th2 = float(2).mul(float(1).sub(dot(dir, bd)));   // ≈ the angle² (rad²)
    L.addAssign(bc.rgb.mul(bp.w.add(bc.w)).mul(exp(th2.div(-FLASH_LOOK.coreRad2)).mul(FLASH_LOOK.skyCore).add(exp(th2.div(-FLASH_LOOK.wideRad2)).mul(FLASH_LOOK.skyWide))));
  });
  // through a soft cap: a finale's eight slots at once glow, they do not fog the sky
  const m = max(L.r, max(L.g, L.b));
  return L.div(m.div(FLASH_LOOK.airCap).add(1));
})();
