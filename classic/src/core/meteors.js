// Shooting stars (round 5, owner 2026-11-07): on a clear dark night, about one every 2–5 minutes of scene time, a quick faint
// streak (0.3–0.8 s, a short tail, mostly white with a faint green or orange tint), sporadic: any bearing, any slant, never
// two at once. Seeded and keyed on the scene clock, so a page replays the same sky. Off in captures and films. forced
// (the tests): a quick test rhythm, one every 5–7 s, so a short clip holds one.
//   const m = createMeteors({ seed, dark: () => mw.dark(0.8) && clear(), forced }); scene.add(m.mesh); daylight.add(m.daylight)
// One quad in the sky, 35 km out along its direction (the ridges draw over it; the clouds' post pass covers it), additive,
// its brightness held on screen against the exposure (radiance = METEORS.screen / frame.exposure).
import * as THREE from 'three/webgpu';
import { attribute, vec3, float, uv, smoothstep, mix, uniform, varying } from 'three/tsl';

const METEORS = {
  gapS: [120, 300],        // between two (scene s)
  testGapS: [5, 7],        // forced: the quick test rhythm
  durS: [0.3, 0.8],
  lenDeg: [5, 14],         // the path's length on the sky
  tailDeg: 3.5,            // the tail behind the head
  altDeg: [18, 70],        // where it starts (height above the horizon)
  distM: 35000,
  widthDeg: 0.09,
  screen: 0.9,             // the head's on-screen level (× the base exposure): faint, under the brightest stars' glow
  tints: [[1, 1, 1], [0.85, 1, 0.88], [1, 0.9, 0.78]],   // white, a faint green (magnesium), a faint orange (sodium)
};

// a deterministic unit number for (seed, i, k)
const hashU = (seed, i, k = 0) => { let h = Math.imul((seed | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(i + 1, 0xc2b2ae35) ^ Math.imul(k + 7, 0x27d4eb2f); h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; return ((h >>> 0) % 1000003) / 1000003; };
const lerp = (a, b, t) => a + (b - a) * t;

// The i-th shooting star of a seed (pure: tests/meteors.test.mjs): its start (scene s, from t0), length, path and tint.
// first: the delay of the first (s).
export function meteorAt(seed, i, { t0 = 0, first = null, M = METEORS } = {}) {
  let t = t0;
  for (let k = 0; k <= i; k++) t += k === 0 && first != null ? first : lerp(M.gapS[0], M.gapS[1], hashU(seed, k, 1));
  const az = hashU(seed, i, 2) * 360, alt = lerp(M.altDeg[0], M.altDeg[1], hashU(seed, i, 3));
  const dirDeg = hashU(seed, i, 4) * 360;   // its heading on the sky (0: up), sporadic: any way, slanting down more often
  const slant = dirDeg < 180 ? 90 + dirDeg / 2 : 180 + (dirDeg - 180) / 2;   // 90–270°: sideways to down, never straight up
  return { i, t, dur: lerp(M.durS[0], M.durS[1], hashU(seed, i, 5)), az, alt, slant, len: lerp(M.lenDeg[0], M.lenDeg[1], hashU(seed, i, 6)),
    tint: M.tints[Math.floor(hashU(seed, i, 7) * M.tints.length) % M.tints.length] };
}

// a sky direction (unit, world: x east, y up, z south) from bearing and height, degrees
const skyDir = (azDeg, altDeg) => { const a = azDeg * Math.PI / 180, e = altDeg * Math.PI / 180; return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]; };
// the head's place at u (0–1 of its life): along the great circle from (az, alt) heading `slant` on the sky (0 up, 90 right)
export function meteorPoint(m, u) {
  const d = m.len * u, s = m.slant * Math.PI / 180;
  const alt = m.alt + d * Math.cos(s), az = m.az + d * Math.sin(s) / Math.max(0.2, Math.cos(m.alt * Math.PI / 180));
  return { az, alt };
}

export function createMeteors({ seed = 1, dark = () => false, enabled = true, forced = false, M = METEORS } = {}) {
  const pos = new Float32Array(12), w = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
  const g = new THREE.BufferGeometry();
  const pa = new THREE.BufferAttribute(pos, 3); pa.setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('position', pa); g.setAttribute('uv', new THREE.BufferAttribute(w, 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  const uCol = uniform(new THREE.Color(0, 0, 0));
  const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  { const q = uv(); const along = q.x, across = q.y.mul(2).sub(1).abs();   // x: tail (0) → head (1)
    mat.colorNode = uCol.mul(along.pow(2.2)).mul(smoothstep(1, 0.15, across)); mat.opacityNode = float(1); }
  const mesh = new THREE.Mesh(g, mat); mesh.name = 'meteors'; mesh.frustumCulled = false; mesh.visible = false; mesh.renderOrder = 2;
  const S = { i: 0, cur: null, t0: null, shown: 0, log: [] };
  const camPos = new THREE.Vector3();

  function place(m, u, camera, k) {
    const head = meteorPoint(m, u), tail = meteorPoint(m, Math.max(0, u - M.tailDeg / m.len));
    const h = skyDir(head.az, head.alt), t = skyDir(tail.az, tail.alt);
    camera.getWorldPosition(camPos);
    const H = new THREE.Vector3(...h).multiplyScalar(M.distM).add(camPos), T = new THREE.Vector3(...t).multiplyScalar(M.distM).add(camPos);
    const along = new THREE.Vector3().subVectors(H, T), view = new THREE.Vector3().subVectors(H, camPos).normalize();
    const side = new THREE.Vector3().crossVectors(along, view).normalize().multiplyScalar(M.distM * M.widthDeg * Math.PI / 180);
    const v = [T.clone().sub(side), H.clone().sub(side), H.clone().add(side), T.clone().add(side)];
    v.forEach((p, j) => pos.set([p.x, p.y, p.z], j * 3));
    pa.needsUpdate = true;
    const life = Math.min(1, u / 0.15) * Math.min(1, (1 - u) / 0.35);   // flares in, fades out
    uCol.value.setRGB(...m.tint).multiplyScalar(M.screen * k * life);
  }

  // the daylight hook: frame.time (the scene clock), frame.exposureComp; the camera from the core (setCamera)
  let camera = null;
  function daylight(f) {
    if (!enabled || !camera || f.time == null) { mesh.visible = false; return; }
    const MM = forced ? { ...M, gapS: M.testGapS } : M;
    if (S.t0 == null) { S.t0 = f.time; S.cur = meteorAt(seed, 0, { t0: S.t0, M: MM }); }
    let m = S.cur;
    while (m && f.time > m.t + m.dur) { S.i++; m = S.cur = meteorAt(seed, S.i, { t0: S.t0, M: MM }); }
    // forced: in front of the camera (a capture's frame holds it): its bearing within ±25° of the view's, 20–40° up
    if (forced && m && !m.framed) {
      const e = camera.matrixWorld.elements, camAz = Math.atan2(-e[8], e[10]) * 180 / Math.PI;
      m.az = camAz + (m.az / 360 - 0.5) * 50; m.alt = 20 + (m.alt - M.altDeg[0]) / (M.altDeg[1] - M.altDeg[0]) * 20; m.framed = true;
    }
    const u = m ? (f.time - m.t) / m.dur : -1;
    const on = u >= 0 && u <= 1 && dark();
    mesh.visible = on;
    if (on) {
      if (S.log.at(-1)?.i !== m.i) { S.shown++; S.log.push({ i: m.i, t: +m.t.toFixed(2), az: +m.az.toFixed(0), alt: +m.alt.toFixed(0) }); }
      place(m, u, camera, 1 / (f.exposure ?? 6));   // radiance × the exposure = M.screen on screen at any exposure
    }
  }
  return { mesh, daylight, setCamera: (c) => { camera = c; }, state: S };
}
