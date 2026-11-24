// The paddler's look (feat/kayak-paddler): seeded picks of the PFD, the top, the shorts,
// the skin, the hair and the hat, and the procedural TSL materials they wear. Deterministic: a seed gives one look.
//
//   pickLook(seed, overrides) → { pfd, pfdTrim, top, shorts, shoes, skin, hair, hat, hatColour }
//   createPaddlerMaterials(look, kayakUniforms) → { skin, top, shorts, shoes, hair, pfd, hat, webbing }
//
// Colours are real gear colours (sRGB): PFDs in rental red, orange, yellow and blue (never neon), dark tops and shorts.
// The bright ones share the kayak's sun-side compensation (materials.js COMP): AgX turns a bright saturated face pastel,
// so on sunlit faces the albedo is darkened and its chroma raised by the same uniforms the kayak's stage sets.
import * as THREE from 'three/webgpu';
import { uniform, vec3, float, mix, smoothstep, max, min, dot, luminance, saturate, mx_noise_float, positionLocal, normalWorld, attribute, abs, sin, texture, uv, clamp } from 'three/tsl';

import { PFD_COLOURS, SKIN, skinLook, rng, pickLook } from '../../../../src/sim/props/paddler/look.js';
export { PFD_COLOURS, SKIN, skinLook, rng, pickLook };

// the kayak's sun-side compensation on a fabric (materials.js: darken + saturate where the sun lights, a partial white
// balance in shade), scaled by the colour's own chroma so a white cap stays white
function compensated(base, u, strength = 1) {
  if (!u) return base;
  const ndl = saturate(dot(normalWorld, u.sunDir)).mul(u.sunK).mul(u.comp);
  const lit = ndl.add(normalWorld.y.mul(0.5).add(0.5).mul(0.35).mul(u.sunK).mul(u.comp));
  const tl = smoothstep(0.05, 0.80, lit).mul(strength);
  const lum0 = vec3(luminance(base));
  const cmax = max(base.x, max(base.y, base.z)), cmin = min(base.x, min(base.y, base.z));
  const chroma = saturate(cmax.sub(cmin).div(cmax.max(1e-3)));
  const rich = max(lum0.add(base.sub(lum0).mul(mix(float(1), u.compSat, chroma))), vec3(-0.5, -0.5, -0.5)).mul(mix(float(1), u.compDark, chroma));
  let b = mix(base, rich, tl);
  // the shade side's partial white balance, as the kayak's (materials.js)
  b = mix(b, b.mul(vec3(1.22, 0.68, 0.45)), float(1).sub(tl).mul(chroma).mul(u.sunK).mul(u.comp).mul(strength));
  return b;
}

function skinLift(base, u) {
  if (!u) return base;
  const lit = saturate(dot(normalWorld, u.sunDir)).mul(u.sunK).mul(u.comp);
  // AgX lifts a sunlit light skin toward white and grey: on lit faces the albedo is darkened a little and its chroma raised
  // (the lighter the tone, the more), so a fair skin stays a warm pink-beige and a deep skin a rich brown
  const lum0 = vec3(luminance(base)), light = smoothstep(0.15, 0.6, luminance(base));
  const rich = max(lum0.add(base.sub(lum0).mul(mix(float(1.4), float(1.9), light))), vec3(0, 0, 0)).mul(mix(float(0.92), float(0.7), light));
  const lift = smoothstep(0.05, 0.75, lit.add(normalWorld.y.mul(0.5).add(0.5).mul(0.3).mul(u.sunK)));
  // the shade side is lit by the blue sky: a warm white balance there keeps a fair skin from going grey
  // AgX and the blue sky grey a skin in shade: more chroma and a warmer balance, the most for the fairest tones (I, II
  // went pale grey in a side light)
  const shade = max(lum0.add(base.sub(lum0).mul(mix(float(1.45), float(2.1), light))), vec3(0, 0, 0)).mul(mix(vec3(1.12, 0.96, 0.87), vec3(1.2, 0.93, 0.8), light)).mul(mix(float(1), float(0.88), light));
  return mix(shade, rich, lift);
}

export function createPaddlerMaterials(look, u = null) {
  const C = (hex) => new THREE.Color(hex);
  const uni = {
    skin: uniform(C(look.skin)), top: uniform(C(look.top)), shorts: uniform(C(look.shorts)), pfd: uniform(C(look.pfd)),
    hair: uniform(C(look.hair)), hat: uniform(C(look.hatColour)), shoes: uniform(C(look.shoes)),
  };
  const n = (q) => mx_noise_float(q).mul(0.5).add(0.5);
  // skin: matte, a soft sheen, a faint warm variation (no pores, no face: a stylised figure)
  const skin = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_skin', roughness: 0.62, metalness: 0, specularIntensity: 0.35, sheen: 0.25, sheenRoughness: 0.6 });
  skin.colorNode = vec3(uni.skin).mul(float(0.97).add(n(positionLocal.mul(6.0)).mul(0.05)));
  skin.sheenColor = C('#FFD8C0');
  // cotton / polyester knit: a dull top and quick-dry shorts
  const knit = (name, col, rough) => {
    const m = new THREE.MeshPhysicalNodeMaterial({ name, roughness: rough, metalness: 0, specularIntensity: 0.25, sheen: 0.4, sheenRoughness: 0.8 });
    m.colorNode = vec3(col).mul(float(0.95).add(n(positionLocal.mul(40.0)).mul(0.08)));
    m.sheenColor = C('#9AA3B0');
    return m;
  };
  const top = knit('paddler_top', uni.top, 0.9);
  const shorts = knit('paddler_shorts', uni.shorts, 0.8);
  const shoes = knit('paddler_shoes', uni.shoes, 0.75);
  const hair = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_hair', roughness: 0.7, metalness: 0, specularIntensity: 0.4 });
  hair.colorNode = vec3(uni.hair);
  // the PFD: nylon shell over foam panels (attribute 'pfd': x the angle round the body 0..1 from the front, y the height
  // 0..1 hem to collar). Quilted channels darken a little in the seams, a dark zip down the front, a reflective-ish
  // trim band near the hem; the sun-side compensation keeps the colour real (red, not salmon)
  const pfd = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_pfd', roughness: 0.62, metalness: 0, specularIntensity: 0.45, sheen: 0.5, sheenRoughness: 0.5, side: THREE.DoubleSide });
  const pa = attribute('pfd', 'vec2');
  const around = pa.x, up = pa.y;
  const zip = smoothstep(0.012, 0.004, min(around, float(1).sub(around)));            // the front zip (angle 0)
  const channels = smoothstep(0.18, 0.02, abs(sin(up.mul(Math.PI * 6.0))));            // the seams between horizontal foam panels
  const hem = smoothstep(0.06, 0.03, up);                                             // the hem binding
  let pc = vec3(uni.pfd).mul(float(1).sub(channels.mul(0.22)));
  pc = compensated(pc, u, 1);
  pc = mix(pc, vec3(0.03, 0.03, 0.035), max(zip, hem.mul(0.9)));
  pc = mix(pc, vec3(0.025, 0.025, 0.03), smoothstep(1.5, 1.6, around));   // the side straps: black webbing
  pfd.colorNode = pc.mul(float(0.97).add(n(positionLocal.mul(30.0)).mul(0.05)));
  pfd.roughnessNode = float(0.6).add(channels.mul(0.15));
  pfd.sheenColor = C('#FFFFFF');
  const webbing = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_webbing', color: C('#151517'), roughness: 0.7, metalness: 0, specularIntensity: 0.3 });
  const hat = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_hat', roughness: 0.85, metalness: 0, specularIntensity: 0.25, sheen: 0.3, sheenRoughness: 0.8, side: THREE.DoubleSide });
  hat.colorNode = compensated(vec3(uni.hat).mul(float(0.96).add(n(positionLocal.mul(60.0)).mul(0.06))), u, 0.7);
  // the UBC body: one material, the clothes painted by the body's 'garment' weights (top, shorts, booties); the skin
  // keeps the kit's colour map as detail (the face's lips and shading), tinted to the seeded tone
  const makeBody = (map) => {
    const m = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_body', roughness: 0.6, metalness: 0, specularIntensity: 0.35, sheen: 0.3, sheenRoughness: 0.7 });
    const g = attribute('garment', 'vec3');
    const detail = map ? clamp(luminance(texture(map, uv()).rgb).div(0.25), 0.78, 1.18) : float(1);   // the kit skin map averages ≈ 0.25 linear: shading around 1
    // the tone as it is, kept alive in sun: AgX greys a lit skin, so lit faces get a little more chroma (the kayak's
    // sun-side treatment at a third of its strength, no darkening)
    let c = skinLift(vec3(uni.skin).mul(0.82), u).mul(detail);   // a skin's diffuse albedo sits under its photo swatch (the swatch includes the sheen)
    const knit = (col) => vec3(col).mul(float(0.95).add(n(positionLocal.mul(400.0)).mul(0.08)));
    c = mix(c, knit(uni.top), g.x);
    c = mix(c, knit(uni.shorts), g.y);
    c = mix(c, vec3(uni.shoes), g.z);
    m.colorNode = c;
    m.roughnessNode = mix(float(0.58), float(0.88), max(g.x, max(g.y, g.z)));
    m.sheenColor = C('#C8B0A0');
    return m;
  };
  const makeEyes = (map) => {
    const m = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_eyes', roughness: 0.5, metalness: 0, specularIntensity: 0.3 });
    if (map) m.colorNode = texture(map, uv()).rgb.mul(0.62); else m.color = C('#B8B2A8');   // softened: the whites dimmed (no stare)
    return m;
  };
  const brows = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_brows', roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  brows.colorNode = vec3(uni.hair).mul(0.75);
  hair.side = THREE.DoubleSide;
  const waterShoe = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_watershoe', roughness: 0.8, metalness: 0, specularIntensity: 0.3, sheen: 0.3, sheenRoughness: 0.8 });
  waterShoe.colorNode = mix(vec3(uni.shoes).mul(0.6).mul(float(0.95).add(n(positionLocal.mul(900.0)).mul(0.1))), vec3(0.22, 0.22, 0.21), attribute('shoe', 'float'));
  return { uni, skin, top, shorts, shoes, hair, pfd, hat, webbing, makeBody, makeEyes, brows, waterShoe };
}
