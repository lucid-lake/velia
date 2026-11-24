// The storm's rain (wow/storm): thin grey streaks falling round the camera in depth layers, slanted by the wind field
// at the camera, semi-transparent. One mesh of thin camera-facing quads, all placed in the vertex stage (no per-frame upload): each drop has a
// hashed place in a 44 × 30 × 44 m box that wraps round the camera, falls at ≈ 9 m/s and drifts with the wind. The
// drawn count follows the rain (the draw range), up to the tier's cap (RAIN_DROPS), so a light shower costs little.
// The rings on the water are a water feature (the weather bus's water(): src/weather/uniforms.js waterRain).
import * as THREE from 'three/webgpu';
import { attribute, uniform, vec3, float, fract, normalize, cross, cameraPosition, smoothstep, length, max, mix } from 'three/tsl';
import { hash } from '../../../src/sim/weather/stormArc.js';

// the most drops per tier (quality tiers, src/quality/tiers.js names): phones run Low
export const RAIN_DROPS = { high: 16000, balanced: 10000, low: 4000 };
const RAIN_BOX = [44, 30, 44];   // m round the camera (x, y, z)
const FALL_MS = 9;               // a raindrop's terminal speed (2–3 mm drops: 7–9 m/s)
export const dropsFor = (tierName, rain) => Math.round((RAIN_DROPS[tierName] ?? RAIN_DROPS.high) * Math.min(1, Math.max(0, rain)));

export function createRain({ tierName = 'high', lum = 0.1 } = {}) {
  const max0 = RAIN_DROPS[tierName] ?? RAIN_DROPS.high;
  const drop = new Float32Array(max0 * 4 * 4), corner = new Float32Array(max0 * 4 * 2), index = new Uint32Array(max0 * 6);
  for (let i = 0; i < max0; i++) {
    const d = [hash(7, i, 1), hash(7, i, 2), hash(7, i, 3), hash(7, i, 4)];
    for (let v = 0; v < 4; v++) {
      drop.set(d, (i * 4 + v) * 4);
      corner.set([v & 1 ? 1 : -1, v >> 1], (i * 4 + v) * 2);
    }
    index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max0 * 4 * 3), 3));   // placed in the shader
  geo.setAttribute('drop', new THREE.BufferAttribute(drop, 4));
  geo.setAttribute('corner', new THREE.BufferAttribute(corner, 2));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);

  const U = { t: uniform(0), wind: uniform(new THREE.Vector2()), amount: uniform(0), light: uniform(lum) };
  const box = vec3(...RAIN_BOX);
  const d = attribute('drop', 'vec4'), c = attribute('corner', 'vec2');
  // the drop's place: hashed, falling, drifting with the wind; wrapped into the box round the camera
  const fall = vec3(U.wind.x, -FALL_MS, U.wind.y);
  const p0 = d.xyz.mul(box).add(fall.mul(U.t.add(d.w.mul(3))));
  const rel = fract(p0.sub(cameraPosition).div(box)).sub(0.5).mul(box);
  const p = cameraPosition.add(rel);
  // a motion-blurred streak along the fall (a 1/15 s eye: ≈ 0.6 m), in depth layers: the near ones longer, wider and
  // fainter (out of focus), the far ones fine (about a pixel wide at any distance), all of it thin grey, not white
  const dist = length(rel);
  const axis = normalize(fall), toCam = normalize(cameraPosition.sub(p));
  const side = normalize(cross(axis, toCam));
  const near = float(1).sub(smoothstep(2, 7, dist));
  const len = mix(float(0.45), float(1.0), near).mul(d.w.mul(0.4).add(0.8));
  const wid = max(dist.mul(0.0009), float(0.0035)).add(near.mul(0.008));
  const pos = p.add(axis.mul(c.y.sub(0.5).mul(len))).add(side.mul(c.x.mul(wid)));
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.NormalBlending });
  mat.fog = false;
  mat.positionNode = pos;
  // none inside 1 m (no drop in the lens), gone by the box's edge (no wrap pop); soft ends and a soft cross-section
  const across = float(1).sub(c.x.abs()), along = float(1).sub(c.y.sub(0.5).abs().mul(2)).clamp(0, 1);
  const a = smoothstep(1.0, 2.5, dist).mul(float(1).sub(smoothstep(14, 21, dist))).mul(across).mul(along.sqrt())
    .mul(mix(float(0.24), float(0.09), near)).mul(mix(float(0.6), float(1.0), d.x)).mul(U.amount.mul(0.5).add(0.5));
  const tint = vec3(0.62, 0.66, 0.72);   // grey: the drops show the overcast sky behind them, never brighter
  mat.colorNode = tint.mul(U.light).mul(1.6);
  mat.opacityNode = a;
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  mesh.visible = false;
  mesh.name = 'storm-rain';

  return {
    mesh, uniforms: U, max: max0,
    // rain 0–1 at the camera, the wind there (m/s, x and z), the scene time (s), the hand-set light level
    update({ rain, vx = 0, vz = 0, t, light = lum }) {
      const n = Math.round(max0 * Math.min(1, Math.max(0, rain)));
      mesh.visible = n > 0;
      geo.setDrawRange(0, n * 6);
      U.t.value = t; U.wind.value.set(vx, vz); U.amount.value = rain; U.light.value = light;
      return n;
    },
    dispose() { geo.dispose(); mat.dispose(); },
  };
}
