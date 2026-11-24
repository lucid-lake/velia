// The sun's shadow for the player's boat (boat detail step 1)): one shadow map
// that only the boat draws into (its own layer), 12 × 12 m round the hull, following it, so a winch, the wheel, the
// boom, the dodger and the sails cast on the deck and the cockpit. High: 2048², Balanced: 1024², Low (phones): none
// (owner, 2026-11-11: "shadows on High and Balanced, never Low"). The boat's opaque parts receive it (src/boat/boatShadow.js),
// and the kayaks (they already ask for it); the world does not.
//
// The pass draws only SHADOW_LAYER; the scene's lights join that layer too (follow): three keeps one lights node per
// scene, and a pass that saw no light emptied it mid-frame, so every lit material's key moved and about 100 pipelines
// were rebuilt in the first frames (0.4–0.7 s, twice).
//
//   shadowSizeFor(tier, flag)   the map's size for a built tier (tiers.js boat.shadowMap) or ?boatshadow= (0 | 512 … 4096)
//   const sh = setupSunShadow({ renderer, scene, size })   at boot, before any shader is built (the sun's castShadow is in
//                                every lit material's key); null when size is 0 (Low: nothing changes)
//   sh.follow(pos)     each frame, after the boat moves: the light's box on pos, snapped to whole texels (no shimmer)
//   sh.setOn(on)       the governor's step to Low: the pass stops and the shadow's intensity goes to 0 (no rebuild)
//   SHADOW_LAYER       the layer a caster joins
import * as THREE from 'three/webgpu';

export const SHADOW_LAYER = 7;
const BOAT_SHADOW = Object.freeze({ extent: 12, depth: 40, bias: -0.0005, normalBias: 0.02, radius: 2 });
const SIZES = [512, 1024, 2048, 4096];

export function shadowSizeFor(tier, flag = null) {
  if (flag != null && flag !== '') {
    const n = parseInt(flag, 10);
    if (n === 0) return 0;
    if (SIZES.includes(n)) return n;
  }
  return tier?.boat?.shadowMap ?? 0;
}

// The light box's centre for a point, snapped to the map's texels in the light's own frame (its right and up, as the
// shadow camera's lookAt makes them), so the texels stay put on the boat while it moves: no crawl along edges.
// d: the unit direction to the sun. Plain math (the tests call it).
function snapToTexels(p, d, texel) {
  const up = Math.abs(d[1]) > 0.999 ? [0, 0, 1] : [0, 1, 0];
  let r = [up[1] * d[2] - up[2] * d[1], up[2] * d[0] - up[0] * d[2], up[0] * d[1] - up[1] * d[0]];
  const rl = Math.hypot(...r) || 1; r = r.map((v) => v / rl);
  const u = [d[1] * r[2] - d[2] * r[1], d[2] * r[0] - d[0] * r[2], d[0] * r[1] - d[1] * r[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const pr = Math.round(dot(p, r) / texel) * texel, pu = Math.round(dot(p, u) / texel) * texel, pd = dot(p, d);
  return [0, 1, 2].map((i) => r[i] * pr + u[i] * pu + d[i] * pd);
}

export function setupSunShadow({ renderer, scene, size }) {
  if (!size || !renderer || !scene) return null;
  const sun = scene.children.find((o) => o.isDirectionalLight && (o.body == null || o.body === 'sun'));
  if (!sun) return null;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  sun.castShadow = true;
  const sh = sun.shadow, e = BOAT_SHADOW.extent / 2;
  sh.mapSize.set(size, size);
  const cam = sh.camera;
  cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.near = -BOAT_SHADOW.depth; cam.far = BOAT_SHADOW.depth;
  cam.updateProjectionMatrix();
  cam.layers.set(SHADOW_LAYER);   // only the boat (three keeps an explicit mask: ShadowNode.updateShadow)
  sh.bias = BOAT_SHADOW.bias; sh.normalBias = BOAT_SHADOW.normalBias; sh.radius = BOAT_SHADOW.radius;
  // drawn once a frame when the boat asks (follow), not once per camera (the water probe's six faces would redraw it)
  sh.autoUpdate = false; sh.needsUpdate = true;
  let on = true;
  const texel = BOAT_SHADOW.extent / size;
  const d = new THREE.Vector3();
  return {
    sun, size, get on() { return on; },
    follow(pos) {
      if (!on) return;
      // the scene's lights join the layer too: three keeps one lights node per scene, and a shadow pass that saw no light
      // emptied it in the middle of the frame (every lit material's key moved: about 100 pipelines rebuilt, twice)
      for (const o of scene.children) if (o.isLight && !o.layers.isEnabled(SHADOW_LAYER)) o.layers.enable(SHADOW_LAYER);
      // the sun's direction as its node last set it (light.position = target + dir × distance; AtmosphereLightNode)
      d.subVectors(sun.position, sun.target.position);
      if (d.lengthSq() < 1e-12) d.set(0, 1, 0);
      d.normalize();
      const c = snapToTexels([pos.x, pos.y, pos.z], [d.x, d.y, d.z], texel);
      sun.target.position.set(c[0], c[1], c[2]); sun.target.updateMatrixWorld();
      sun.position.copy(sun.target.position).addScaledVector(d, sun.distance ?? 1); sun.updateMatrixWorld();
      if (d.y > -0.02) sh.needsUpdate = true;   // the sun down: its direct light is gone; the map keeps its last frame
    },
    setOn(v) {
      on = !!v;
      sh.intensity = on ? 1 : 0;
      if (on) sh.needsUpdate = true;
    },
  };
}
