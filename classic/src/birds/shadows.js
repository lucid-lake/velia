// A low bird's shadow on the water: a soft dark cross (the wings and the body) laid where the sun's ray through the
// bird meets the surface, stretched along the ray when the sun is low, faded with height (the penumbra grows and the
// water scatters it away). One instanced draw of flat quads; no shadow map.
import * as THREE from 'three/webgpu';
import { attribute, vec3, vec4, float, Fn, positionLocal, uv, smoothstep, abs, max } from 'three/tsl';

export function createBirdShadows({ max: M = 12 } = {}) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(M * 12), 12, 1); buf.setUsage(THREE.DynamicDrawUsage);
  const A = (k, o) => g.setAttribute(k, new THREE.InterleavedBufferAttribute(buf, 4, o));
  A('sA', 0); A('sB', 4); A('sC', 8);
  g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  // sA: centre xyz + opacity; sB: the span axis (xz) and the span's half-length, the stretch; sC: the body axis (xz), half-length
  m.positionNode = Fn(() => {
    const sA = attribute('sA', 'vec4'), sB = attribute('sB', 'vec4'), sC = attribute('sC', 'vec4'), p = attribute('position', 'vec3');
    const span = vec3(sB.x, 0, sB.y).mul(sB.z).mul(p.x), body = vec3(sC.x, 0, sC.y).mul(sC.z).mul(p.z);
    return sA.xyz.add(span).add(body);
  })();
  m.colorNode = vec4(0, 0, 0, 1);
  m.opacityNode = Fn(() => {
    const sA = attribute('sA', 'vec4'), sB = attribute('sB', 'vec4'), sC = attribute('sC', 'vec4'), q = uv().sub(0.5).mul(2);
    // a cross: the wings' bar (thin across the body axis) and the body (thin across the span); soft-edged
    const wingBar = float(1).sub(smoothstep(0.6, 1, abs(q.x))).mul(float(1).sub(smoothstep(0.0, sB.w, abs(q.y.add(0.1)))));
    const body = float(1).sub(smoothstep(0.08, sC.w, abs(q.x))).mul(float(1).sub(smoothstep(0.7, 1, abs(q.y))));
    return max(wingBar, body).mul(sA.w);
  })();
  const mesh = new THREE.Mesh(g, m); mesh.frustumCulled = false; mesh.name = 'bird-shadows'; mesh.renderOrder = 1;
  const arr = buf.array;
  let n = 0;
  return {
    mesh,
    begin() { n = 0; },
    push(b, sun, waterY, opacity) {
      if (n >= M || opacity < 0.01) return;
      const h = b.pos[1] - waterY, k = h / Math.max(0.05, sun.y);
      const x = b.pos[0] - sun.x * k, z = b.pos[2] - sun.z * k;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw), sp = b.sp;
      // the soft edge grows with the height (the sun's disc is 0.53°: ≈ 1 cm of penumbra per metre), plus the water's blur
      const blur = Math.min(0.9, 0.25 + h * 0.03);
      const span = sp.spanM * 0.5 * Math.cos(b.roll) * (b.pose.fold > 0.5 ? 0.25 : 1) * (1 + blur * 0.3);
      const len = sp.lengthM * 0.5 / Math.max(0.35, sun.y) ** 0.5;
      const o = n * 12;
      arr[o] = x; arr[o + 1] = waterY + 0.06; arr[o + 2] = z; arr[o + 3] = opacity * 0.38;
      arr[o + 4] = fz; arr[o + 5] = -fx; arr[o + 6] = span; arr[o + 7] = 0.25 + blur * 0.6;
      arr[o + 8] = fx; arr[o + 9] = fz; arr[o + 10] = len * (1 + blur * 0.4); arr[o + 11] = 0.3 + blur * 0.5;
      n++;
    },
    commit() { g.instanceCount = n; mesh.visible = n > 0; if (n) { buf.addUpdateRange(0, n * 12); buf.needsUpdate = true; } },
  };
}
