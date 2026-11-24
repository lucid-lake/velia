// The water the birds throw (fix/bird-splash, owner 2026-11-05: the round-2 puffs read as cotton balls). Real impacts
// at 50–120 m are small, fast and mostly clear water: an osprey's plunge throws a thin crown sheet that breaks into
// droplets and, a beat later, a narrow spout (the Worthington jet); everything is back in the lake within ≈ 1 s. What
// stays is on the water: a dark disturbed hole, a small foam patch that fades, rings that spread. A goose's run leaves
// a line of small foot slaps and a fading wake. So:
//   in the air: many tiny drops, stretched along their motion (a 1/60 s shutter), lit by the scene's sun and sky
//     (MeshStandardNodeMaterial, brighter when backlit, as a drop forward-scatters), faded where they meet the water;
//     a few soft translucent sheet fragments (the crown, a foot's slap) that live ≈ 0.3 s. No emissive, no puffs.
//   on the water: no geometry. Ring, hole and foam sources and the geese's wake trails go to the water's own shader
//     (src/birds/water.js: normal and roughness perturbations, foam in the water's foam term).
// Ballistic and deterministic (a seeded stream). One instanced draw for the water in the air.
//   const spray = createSpray({ max, seed }); scene.add(spray.group); spray.emit(event); spray.update(dt, waterAt)
import * as THREE from 'three/webgpu';
import { attribute, vec3, vec4, float, Fn, uv, length, smoothstep, uniform, normalize, dot, cross, max as vmax, mix, select, cameraPosition, cameraViewMatrix, positionGeometry, pow, fract, sin } from 'three/tsl';
import { rng, hashSeed } from '../../../src/birds/flight.js';
import { BIRD_SUN } from './mesh.js';
import { birdWaterSources } from './water.js';

const P = 9;   // floats per particle: x y z size, vx vy vz life, kind (0 a drop, 1 the spout's water, 2 a sheet fragment, 3 a foot's slap)
const DRAG = [0.15, 0.6, 5, 6];  // per kind: how fast the air slows it (1/s); a sheet's thin film is caught by the air
const SHUTTER_S = 1 / 60; // the streak: a drop's motion over a 180° shutter at 30 fps

// plain JS: the pool, the emitters and the step (tests/birds.test.mjs)
//   density: the share of the particles a tier draws (1 = High); the water's sources are the same on every tier
export function sprayPool(max, seed = 1, { density = 1 } = {}) {
  const a = new Float32Array(max * P), age = new Float32Array(max), wl = new Float32Array(max);
  let n = 0, now = 0;
  const water = birdWaterSources();   // rings, holes, foam and the geese's trails, for the water's shader
  const r = rng(hashSeed(seed, 7177));
  const R = (lo, hi) => lo + (hi - lo) * r();
  const N = (k) => Math.max(1, Math.round(k * density));
  // delay: the particle waits (invisible, still) before it flies: the spout rises a beat after the crown
  function puff(x, y, z, vx, vy, vz, size, life, kind, delay = 0) {
    if (n >= max) return;
    const o = n * P; a[o] = x; a[o + 1] = y; a[o + 2] = z; a[o + 3] = size; a[o + 4] = vx; a[o + 5] = vy; a[o + 6] = vz; a[o + 7] = life; a[o + 8] = kind; age[n] = -delay; wl[n] = y; n++;
  }
  function emit(e) {
    const [x, y, z] = e.pos, g = e.gain ?? 1;
    const fx = Math.sin(e.yaw ?? 0), fz = Math.cos(e.yaw ?? 0);
    // the water's part first: it is the same with or without the dive's spray
    switch (e.kind) {
      case 'plunge': water.ring(now, x, z, 'plunge'); break;
      case 'lift': water.ring(now, x, z, 'lift'); break;
      case 'wingslap': if (e.species === 'osprey' && y < 1.2) water.ring(now, x, z, 'slap', g); break;
      case 'patter': water.trail(now, e.id ?? 0, x, z, g); break;
      case 'land': water.ring(now, x, z, 'land'); water.trail(now, 100 + (e.id ?? 0), x, z, 1); water.trail(now, 100 + (e.id ?? 0), x + fx * 1.8, z + fz * 1.8, 0.6); break;
    }
    if (e.ringsOnly) return;   // the dive off (BIRDS.diveDefault false, ?birddive=0): the water's marks only, nothing in the air
    switch (e.kind) {
      case 'plunge': {
        // the crown: a thin sheet flung out and up round the bird (translucent fragments that live ≈ 0.3 s) ...
        for (let i = 0; i < N(34) * g; i++) { const t = R(0, 6.283), s = R(1.0, 2.0); puff(x + Math.cos(t) * 0.3, y + 0.05, z + Math.sin(t) * 0.3, Math.cos(t) * s, R(1.6, 2.8), Math.sin(t) * s, R(0.07, 0.13), R(0.2, 0.32), 2); }
        // ... its rim breaking into droplets that fly on: out 1–3 m/s, up to ≈ 0.6 m, back in the lake in 0.6–0.9 s
        for (let i = 0; i < N(170) * g; i++) { const t = R(0, 6.283), s = R(0.8, 3.0); puff(x + Math.cos(t) * R(0.3, 0.45), y + 0.05, z + Math.sin(t) * R(0.3, 0.45), Math.cos(t) * s, R(1.2, 3.6), Math.sin(t) * s, R(0.016, 0.034), 1.6, 0); }
        // the spout: a narrow jet that rises a beat later (the cavity closing) and falls back
        for (let i = 0; i < N(130) * g; i++) { const t = R(0, 6.283), rr = R(0, 0.05), s = R(0, 0.25); puff(x + Math.cos(t) * rr, y, z + Math.sin(t) * rr, Math.cos(t) * s, R(1.6, 4.0), Math.sin(t) * s, R(0.014, 0.03), 1.6, 1, R(0.16, 0.34)); }
        for (let i = 0; i < N(4) * g; i++) puff(x + R(-0.04, 0.04), y, z + R(-0.04, 0.04), R(-0.1, 0.1), R(1.6, 2.6), R(-0.1, 0.1), R(0.08, 0.12), R(0.22, 0.32), 2, R(0.18, 0.26));
        break;
      }
      case 'lift': {   // the bird bursting out: water pouring off the body and the wings as they clear the surface
        for (let i = 0; i < N(70); i++) { const sd = R(-0.85, 0.85); puff(x + fz * sd, y + R(-0.1, 0.25), z - fx * sd, fz * sd * R(0.2, 1.2), R(-0.2, 1.8), -fx * sd * R(0.2, 1.2), R(0.016, 0.032), 1.4, 0); }
        for (let i = 0; i < N(10); i++) { const sd = R(-0.7, 0.7); puff(x + fz * sd, y, z - fx * sd, fz * sd, R(0.6, 1.6), -fx * sd, R(0.1, 0.16), R(0.2, 0.32), 2); }
        break;
      }
      case 'wingslap': {   // the wingtips on the water, then streaming off them on each stroke as the bird climbs
        const sp = e.species === 'goose' ? 0.8 : 0.8, k = e.species === 'goose' ? 7 : 22;
        for (let i = 0; i < N(k) * g; i++) { const s = r() < 0.5 ? -1 : 1, rr = R(0.3, 1) * sp; puff(x + s * fz * rr, Math.max(y - 0.1, 0), z - s * fx * rr, s * fz * R(0.2, 1.2), R(-0.8, 1.6), -s * fx * R(0.2, 1.2), R(0.014, 0.028), 1.4, 0); }
        break;
      }
      case 'shake': for (let i = 0; i < N(14); i++) { const t = R(0, 6.283), s = R(2, 4); puff(x, y, z, Math.cos(t) * s, R(-1, 1.5), Math.sin(t) * s, R(0.012, 0.024), 1.8, 0); } break;
      case 'patter': {   // a goose's foot slapping the water: a small white slap and a few drops kicked back
        puff(x, y + 0.04, z, -fx * 0.5, R(0.9, 1.4), -fz * 0.5, R(0.12, 0.17) * (0.6 + 0.4 * g), R(0.22, 0.32), 3);
        for (let i = 0; i < N(12) * g; i++) puff(x + R(-0.08, 0.08), y + 0.03, z + R(-0.08, 0.08), -fx * R(0.4, 1.6) + R(-0.5, 0.5), R(0.8, 2.2), -fz * R(0.4, 1.6) + R(-0.5, 0.5), R(0.016, 0.03), 1.0, 0);
        break;
      }
      case 'land': {   // the skid: a low sheet thrown forward and out to both sides
        for (let i = 0; i < N(40); i++) { const s = R(1, 3), sd = R(-1, 1); puff(x + fx * R(0, 1), y + 0.04, z + fz * R(0, 1), fx * s + fz * sd * 1.4, R(0.4, 1.6), fz * s - fx * sd * 1.4, R(0.014, 0.03), 1.2, 0); }
        for (let i = 0; i < N(6); i++) { const sd = R(-1, 1); puff(x + fx * R(0, 1), y + 0.03, z + fz * R(0, 1), fx * 1.5 + fz * sd, R(0.4, 0.8), fz * 1.5 - fx * sd, R(0.1, 0.16), R(0.2, 0.3), 2); }
        break;
      }
    }
  }
  function step(dt, waterAt = () => 0) {
    now += dt;
    for (let i = 0; i < n; i++) {
      const o = i * P, kind = a[o + 8];
      age[i] += dt;
      if (age[i] < 0) continue;   // still waiting
      const k = Math.exp(-dt * DRAG[kind]);
      a[o + 4] *= k; a[o + 6] *= k;
      a[o + 5] = a[o + 5] * (kind >= 2 ? k : 1) - 9.81 * dt;
      a[o] += a[o + 4] * dt; a[o + 1] += a[o + 5] * dt; a[o + 2] += a[o + 6] * dt;
      const w = waterAt(a[o], a[o + 2]); wl[i] = w;
      if (age[i] > a[o + 7] || (a[o + 5] < 0 && a[o + 1] < w - 0.03)) {   // gone: back in the lake
        n--; if (i !== n) { a.copyWithin(o, n * P, n * P + P); age[i] = age[n]; wl[i] = wl[n]; } i--;
      }
    }
    water.step(now);
  }
  return { emit, step, get count() { return n; }, get now() { return now; }, data: a, age, wl, water, max, P };
}

export function createSpray({ max = 700, seed = 1, density = 1 } = {}) {
  const pool = sprayPool(max, seed, { density });
  const group = new THREE.Group(); group.name = 'bird-spray';
  // each particle a quad facing the camera, stretched along its motion on the screen (the shutter's streak)
  const iA = new Float32Array(max * 4), iB = new Float32Array(max * 4);   // (x, y, z, size), (vx, vy, vz, alpha); alpha < 0: a sheet
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  geo.setIndex([0, 1, 2, 0, 2, 3]);
  const aA = new THREE.InstancedBufferAttribute(iA, 4), aB = new THREE.InstancedBufferAttribute(iB, 4);
  aA.setUsage(THREE.DynamicDrawUsage); aB.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iA', aA); geo.setAttribute('iB', aB);
  geo.instanceCount = 0; geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  const uShutter = uniform(SHUTTER_S);
  const mat = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const A = attribute('iA', 'vec4'), B = attribute('iB', 'vec4');
  const toCam = normalize(A.xyz.sub(cameraPosition));   // from the camera to the particle
  mat.positionNode = Fn(() => {
    const v = B.xyz, vp = v.sub(toCam.mul(dot(v, toCam))), vl = length(vp);
    const side = normalize(cross(toCam, vec3(0, 1, 0)));
    const ax = select(vl.greaterThan(1e-3), vp.div(vmax(vl, 1e-3)), side);
    const bx = normalize(cross(toCam, ax));
    const L = A.w.add(vl.mul(uShutter));
    return A.xyz.add(ax.mul(positionGeometry.x.mul(L))).add(bx.mul(positionGeometry.y.mul(A.w)));
  })();
  // a drop is clear water: it shows the light it bends toward the eye. Lit by the scene's sun and sky like any surface,
  // its normal faces the camera and turns toward the sun as the sun moves behind it (forward scatter: backlit spray
  // sparkles, front-lit spray is a faint grey-white); a per-drop glint varies them
  const behind = pow(vmax(dot(toCam, BIRD_SUN), 0), 2);
  const nW = normalize(toCam.negate().mul(float(1).sub(behind.mul(0.85))).add(BIRD_SUN.mul(behind.mul(1.2))));
  mat.normalNode = cameraViewMatrix.mul(vec4(nW, 0)).xyz.normalize();
  const sheet = B.w.lessThan(0);
  const glint = fract(sin(A.x.mul(12.9898).add(A.z.mul(78.233)).add(A.w.mul(311.7))).mul(43758.5));
  mat.colorNode = vec3(select(sheet, float(0.78), mix(float(0.62), float(0.95), glint)));
  mat.roughnessNode = float(0.3);
  mat.metalnessNode = float(0);
  mat.opacityNode = Fn(() => {
    const q = uv().sub(0.5).mul(2), d = length(q);
    const drop = float(1).sub(smoothstep(0.45, 1.0, d));                                // a small soft-edged bead or streak
    const film = float(1).sub(smoothstep(0.1, 1.0, d)).mul(float(0.55).add(q.y.mul(0.45)));   // a sheet: thin, brighter at its top edge
    return select(sheet, film, drop).mul(B.w.abs());
  })();
  const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.name = 'bird-spray-water';
  group.add(mesh);

  function update(dt, waterAt) {
    pool.step(dt, waterAt);
    const n = pool.count, s = pool.data;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const q = i * P, age = pool.age[i];
      if (age < 0) continue;
      const life = s[q + 7], t = age / life, kind = s[q + 8];
      const above = s[q + 1] - pool.wl[i];
      const meet = Math.min(1, Math.max(0, (above + 0.02) / 0.1));   // the depth fade: a drop thins out as it meets the water
      const o = m * 4;
      iA[o] = s[q]; iA[o + 1] = s[q + 1]; iA[o + 2] = s[q + 2];
      iB[o] = s[q + 4]; iB[o + 1] = s[q + 5]; iB[o + 2] = s[q + 6];
      let al;
      if (kind >= 2) { iA[o + 3] = s[q + 3] * (1 + (kind === 2 ? 1.2 : 1.0) * t); al = -(kind === 2 ? 0.13 : 0.5) * (1 - t) * (1 - t) * Math.min(1, t * 10 + 0.4) * meet; }
      else { iA[o + 3] = s[q + 3]; al = (kind === 1 ? 0.36 : 0.62) * Math.min(1, (1 - t) * 6) * meet; }
      iB[o + 3] = kind >= 2 ? Math.min(al, -1e-4) : al;
      m++;
    }
    geo.instanceCount = m; mesh.visible = m > 0;
    if (m) { for (const x of [aA, aB]) { x.addUpdateRange(0, m * 4); x.needsUpdate = true; } }
    pool.water.upload(waterAt);
  }
  const setLight = () => {};   // lit by the scene's own sun and sky (the daylight hook kept for the caller)
  return { group, emit: pool.emit, update, pool, setLight };
}
