// Water off the blades (feat/kayak-paddler stage 7): a small burst at each catch (more
// and faster at a sprint) and a string of drips off the blade's tip after each exit. Droplets are tiny instanced spheres in
// the kayak frame, ballistic, gone when they fall back through the water. Deterministic (a seeded RNG per paddler).
//
//   const sp = createSplash({ seed, waterY }); scene.add(sp.mesh, sp.rings);   (world space)
//   sp.catch(at, strength)   sp.exit(tip | () => tip, strength)   sp.ring(at)   sp.setWater(y)   sp.update(dt)
//   ring: an expanding ring on the water (a debug marker for the catch, never drawn by the stage: the owner, 2026-11-07,
//         asked for no ring at the catch)
import * as THREE from 'three/webgpu';
import { rng } from './look.js';

const MAX = 160, G = 9.81;

export function createSplash({ seed = 1, waterY: water0 = 0.11 } = {}) {
  let waterY = water0;
  const r = rng(seed * 97 + 31);
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const mat = new THREE.MeshPhysicalNodeMaterial({ name: 'paddler_droplet', color: new THREE.Color(0.82, 0.86, 0.88), roughness: 0.15, metalness: 0, transmission: 0, specularIntensity: 0.9 });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = 'paddler_splash'; mesh.frustumCulled = false; mesh.count = 0;
  const P = [];   // { p, v, life, size }
  const drips = [];   // pending drips: { tip, left, every, acc, s }
  // the catch rings: flat tori on the water that grow and fade (a pool of 8)
  const rings = new THREE.Group(); rings.name = 'paddler_rings';
  const ringPool = Array.from({ length: 8 }, () => {
    const m = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0.92, 0.95, 0.96), transparent: true, opacity: 0, depthWrite: false });
    const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.06, 6, 40), m); r.rotation.x = Math.PI / 2; r.visible = false; r.renderOrder = 3;
    rings.add(r); return { mesh: r, age: 9 };
  });
  let ringNext = 0;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  function spawn(at, v, size, life) {
    if (P.length >= MAX) P.shift();
    P.push({ p: at.clone(), v, size, life });
  }
  return {
    mesh, rings,
    setWater(y) { waterY = y; },
    ring(at) { const r = ringPool[ringNext++ % ringPool.length]; r.mesh.position.set(at.x, waterY + 0.004, at.z); r.age = 0; r.mesh.visible = true; },
    catch(at, strength = 1) {
      const n = Math.round(4 + 10 * Math.min(1.5, strength));
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, up = 0.8 + 1.4 * r() * strength;
        spawn(new THREE.Vector3(at.x, waterY + 0.01, at.z), new THREE.Vector3(Math.cos(a) * 0.35 * r(), up, Math.sin(a) * 0.35 * r() - 0.15), 0.006 + 0.008 * r(), 1.2);
      }
    },
    exit(tip, strength = 1) { drips.push({ tip, left: 0.7, every: 0.07 / Math.max(0.5, strength), acc: 0, s: strength }); },
    update(dt, tipOf = null) {
      for (const d of drips) {
        d.left -= dt; d.acc += dt;
        const at = typeof d.tip === 'function' ? d.tip() : d.tip;
        while (d.acc >= d.every) { d.acc -= d.every; spawn(at.clone(), new THREE.Vector3((r() - 0.5) * 0.1, -0.2 * r(), (r() - 0.5) * 0.1), 0.004 + 0.004 * r(), 1.5); }
      }
      for (let i = drips.length - 1; i >= 0; i--) if (drips[i].left <= 0) drips.splice(i, 1);
      for (const r of ringPool) {
        if (!r.mesh.visible) continue;
        r.age += dt; const t = r.age / 1.6;
        if (t >= 1) { r.mesh.visible = false; continue; }
        const rad = 0.08 + 0.55 * Math.sqrt(t); r.mesh.scale.set(rad, rad, 1 + 0 * rad); r.mesh.material.opacity = 0.55 * (1 - t) ** 1.5;
      }
      for (const d of P) { d.v.y -= G * dt; d.p.addScaledVector(d.v, dt); d.life -= dt; }
      for (let i = P.length - 1; i >= 0; i--) if (P[i].life <= 0 || (P[i].p.y < waterY && P[i].v.y < 0)) P.splice(i, 1);
      mesh.count = P.length;
      P.forEach((d, i) => { m.compose(d.p, q, sc.setScalar(d.size)); mesh.setMatrixAt(i, m); });
      mesh.instanceMatrix.needsUpdate = true;
    },
    count: () => P.length,
    dispose() { geo.dispose(); mat.dispose(); for (const r of ringPool) { r.mesh.geometry.dispose(); r.mesh.material.dispose(); } },
  };
}
