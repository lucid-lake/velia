// The starlit night's shared uniforms (owner, 2026-11-07: "a photographer's lens, not the naked eye"):
// written by src/core/milkyway.js each frame, read by the systems the sky model leaves black at night.
//   NIGHT_CLOUD  the night sky's light on the clouds (vec3, in the band's units before the sky library's luminance
//                scale; src/clouds.js adds it to the layer's sky light), so a cloud deck reads grey-blue, never black
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';

export const NIGHT_CLOUD = uniform(new THREE.Color(0, 0, 0));
//   NIGHT_LAND   the starlit night's lift on the land (vec3, scene radiance per unit albedo; round 5, owner 2026-11-07: "land
//                not pure black"): the terrain's emissive (× its albedo × a slope term, src/terrain-mesh.js) and the trees'
//                sky term (src/trees.js); a cool blue-grey, brighter with the moon; ≈ 362 × dimmer on screen by day
export const NIGHT_LAND = uniform(new THREE.Color(0, 0, 0));
