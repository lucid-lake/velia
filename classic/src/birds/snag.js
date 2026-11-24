// A snag on Emerald Point: a dead Jeffrey pine, bark long gone, the wood weathered silver, its top broken off and a few
// stubs of branches left. Bald eagles and ospreys at Emerald Bay perch and nest on snags like it.
// The eagle stands on its highest branch. Plain geometry, one draw, the scene's light.
import * as THREE from 'three/webgpu';
import { attribute, float, vec3, positionWorld, sin, mix } from 'three/tsl';
import { rng, hashSeed } from '../../../src/birds/flight.js';

export function createSnag({ terrain, at, seed = 1, height = 15 } = {}) {
  const r = rng(hashSeed(seed, 5150));
  const P = [], N = [], C = [], I = [];
  const wood = [0.42, 0.4, 0.37], dark = [0.16, 0.15, 0.14];
  // a tapered, gently bending limb from a to b, k sides, s segments
  function limb(a, dir, len, r0, r1, k = 10, s = 8, bend = [0, 0, 0]) {
    const base = P.length / 3;
    for (let j = 0; j <= s; j++) {
      const t = j / s;
      const c = [a[0] + dir[0] * len * t + bend[0] * t * t, a[1] + dir[1] * len * t + bend[1] * t * t, a[2] + dir[2] * len * t + bend[2] * t * t];
      const ax = dir, u = norm(cross(Math.abs(ax[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], ax)), v = cross(ax, u);
      const rad = r0 + (r1 - r0) * t;
      for (let q = 0; q <= k; q++) {
        const th = q / k * Math.PI * 2, o = [u[0] * Math.cos(th) + v[0] * Math.sin(th), u[1] * Math.cos(th) + v[1] * Math.sin(th), u[2] * Math.cos(th) + v[2] * Math.sin(th)];
        const jag = 1 + 0.06 * Math.sin(th * 7 + t * 9) + 0.04 * (r() - 0.5);
        P.push(c[0] + o[0] * rad * jag, c[1] + o[1] * rad * jag, c[2] + o[2] * rad * jag); N.push(...o);
        const crack = Math.sin(th * 13 + t * len * 0.8) > 0.92 ? 1 : 0;   // the dark checks in the weathered grain
        const w = 0.85 + 0.25 * r();
        C.push(...(crack ? dark : wood.map((x) => x * w)));
      }
    }
    for (let j = 0; j < s; j++) for (let q = 0; q < k; q++) { const p0 = base + j * (k + 1) + q, p1 = p0 + k + 1; I.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1); }
    return (t) => [a[0] + dir[0] * len * t + bend[0] * t * t, a[1] + dir[1] * len * t + bend[1] * t * t, a[2] + dir[2] * len * t + bend[2] * t * t];
  }
  const lean = [0.05, 1, -0.03], up = norm(lean);
  const trunk = limb([0, -0.5, 0], up, height + 0.5, 0.42, 0.11, 12, 10, [0.2, 0, 0.1]);
  // the stubs: short, broken, mostly down-angled (a pine's lower limbs), and one long sound branch near the top
  for (let i = 0; i < 7; i++) {
    const t = 0.35 + 0.08 * i + 0.02 * r(), a = r() * Math.PI * 2;
    limb(trunk(t), norm([Math.cos(a), -0.15 - 0.2 * r(), Math.sin(a)]), 0.5 + r() * 1.3, 0.09 * (1 - t * 0.5), 0.03, 6, 3);
  }
  const perchYaw = 2.2;
  const bdir = norm([Math.sin(perchYaw) * 0.95, 0.12, Math.cos(perchYaw) * 0.95]);
  const branchAt = trunk(0.84);
  const branch = limb(branchAt, bdir, 2.2, 0.1, 0.035, 8, 5, [0, -0.15, 0]);
  limb(trunk(1), norm([0.3, 1, 0.1]), 0.5, 0.11, 0.06, 8, 2);   // the broken top
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(I);
  g.computeBoundingSphere();
  const m = new THREE.MeshStandardNodeMaterial();
  // the grain: long streaks along the wood
  m.colorNode = attribute('color', 'vec3').mul(mix(float(0.86), float(1.08), sin(positionWorld.y.mul(23).add(positionWorld.x.mul(41))).mul(0.5).add(0.5)));
  m.roughnessNode = float(0.92);
  const mesh = new THREE.Mesh(g, m); mesh.name = 'snag';
  const y0 = terrain.heightAt(at[0], at[1]);
  const group = new THREE.Group(); group.name = 'snag'; group.add(mesh);
  group.position.set(at[0], y0, at[1]);
  group.updateMatrixWorld(true);
  // the perch: on the branch, 1.5 m out, the eagle's feet on top of it (the bird's origin ≈ 0.27 m above its feet)
  const bp = branch(0.68);
  const perch = [at[0] + bp[0], y0 + bp[1] + 0.33, at[1] + bp[2]];
  return { group, perch, perchYaw: perchYaw + Math.PI / 2, update() {} };
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
void vec3;
