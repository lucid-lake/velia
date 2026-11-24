// The wet exhaust at the transom (feat/engine-anchor): a small inboard diesel's cooling water spurting from its
// outlet on the starboard quarter, in chuffs at the firing rate, more and farther with the rpm. A pool of instanced
// sprites on the CPU, seeded (no Math.random()), like spray.js. The outlet is the Boat's 'exhaust' socket (Boat.js).
//
//   const ex = createExhaust();  scene.add(ex.mesh);
//   each frame: ex.update(state, { at: [x, y, z] (the outlet, world), aft, stbd: [x, z] (unit, world: astern, to starboard) }, dt)
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, uniform, float, uv, length as vlen, smoothstep } from 'three/tsl';
import { createExhaustSim, EXHAUST } from '../../../src/boat/exhaustSim.js';   // the flight (a pure seam: v2 steps the same clots)

export { EXHAUST };


export function createExhaust({ count = 220, seed = 3, color = 0xe9ede9 } = {}) {
  const sim = createExhaustSim({ count, seed });
  const { pos, size, alpha } = sim;
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3), sizeAttr = new THREE.InstancedBufferAttribute(size, 1), alphaAttr = new THREE.InstancedBufferAttribute(alpha, 1);
  for (const a of [posAttr, sizeAttr, alphaAttr]) a.setUsage(THREE.DynamicDrawUsage);
  const uColor = uniform(new THREE.Color(color));
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  mat.positionNode = instancedBufferAttribute(posAttr);
  mat.scaleNode = instancedBufferAttribute(sizeAttr);
  mat.colorNode = uColor;
  mat.opacityNode = float(1).sub(smoothstep(0.2, 0.5, vlen(uv().sub(0.5)))).mul(instancedBufferAttribute(alphaAttr));
  const mesh = new THREE.Sprite(mat); mesh.count = count; mesh.frustumCulled = false; mesh.name = 'exhaust';
  function update(state, at, dt = 1 / 60) {
    sim.update(state, at, dt);
    posAttr.needsUpdate = sizeAttr.needsUpdate = alphaAttr.needsUpdate = true;
  }
  let colorBase = null;
  const setLight = (light) => { colorBase ??= uColor.value.clone(); uColor.value.copy(colorBase).multiplyScalar(light); };
  mesh.userData.daylight = (f) => setLight(f.light);
  const stats = sim.stats;
  return { mesh, update, setLight, stats, uniforms: { uColor } };
}
