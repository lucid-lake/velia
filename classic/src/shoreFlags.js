// Flags on shore (owner, 2026-10-29: cheap captain's information sources): a few flagpoles at real-looking spots, each
// flag flying from the LOCAL wind (src/wind.js sample at its pole, the shifts included), its flutter scaled by the
// speed. A skipper reads the wind ashore before it reaches the boat, and reads a lee by a limp flag.
// Generic flags only: plain muted pennants, a burgee-like triangle and one plain rectangle; no national or brand flags.
//
//   import { flagSites, flagShape, createShoreFlags } from './shoreFlags.js';
//   const sites = flagSites({ terrain, harbour: harbour.layout, shore: shoreline.layout });   // plain JS (tests)
//   const shore = createShoreFlags({ sites, wind }); scene.add(shore.group); shore.update(t) each frame
//
// The cloth is a vertex-animated strip (9 × 3 vertices a flag), all flags in ONE mesh, its positions written on the
// CPU (5 flags ≈ 135 vertices: nothing); the poles one InstancedMesh. Two draw calls. The wind is sampled at 5 Hz a
// flag and eased (τ 0.6 s), so the frame costs a few dozen multiplies.
//
// World frame (src/geo.js): x east, y up, z south, metres; the lake at y = 0.
import * as THREE from 'three/webgpu';

// the art bible's muted family (src/shoreline.js COL, src/harbour-layout.js hulls): no loud colour
const FLAG_COL = { red: 0x8a2f2a, navy: 0x2d3a48, green: 0x3f5a46, ochre: 0xa8843e, cream: 0xd8d2c4, pole: 0xd8d2c4 };

export const SHORE_FLAGS = {
  sampleHz: 5,          // wind samples a flag per second (the frame eases between them)
  tauS: 0.6,            // s: the flag's swing to a new direction
  limpMs: 0.6,          // m/s: under this the flag hangs (θ = droopMax)
  fullMs: 5.5,          // m/s: over this it streams out level (≈ 11 kn, as a real bunting flag)
  droopMax: 78,         // deg below level when limp
  segU: 8, segV: 2,     // the cloth's strip
  // anchors for the pier flags: the pier nearest each (within maxM), its head
  anchors: [
    { name: 'stone-house-pier', x: -535, z: 132, maxM: 120 },   // the pier below the stone house at the bay's head (OSM)
    { name: 'camp-pier', x: 342, z: -628, maxM: 120 },          // the boat camp's pier on the bay's north shore (OSM)
  ],
};

const DEG = Math.PI / 180;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The sites: [{ name, x, z, y (the pole's foot), h (its height), shape, col, L, H (the cloth, m) }]
//   terrain: heightAt, shoreDistance (src/terrain.js); harbour: harbourLayout(); shore: layoutShoreline()
export function flagSites({ terrain, harbour = null, shore = null } = {}) {
  const sites = [];
  const ground = (x, z) => Math.max(0.3, terrain.heightAt(x, z));
  // 1. the stone house's lawn: 35 m in front of the house (≈ (−547, 218)), toward the beach, a tall white mast with a
  //    long pennant, as a summer estate's lawn has
  {
    const hx = -547, hz = 218, bx = -497, bz = 95, l = Math.hypot(bx - hx, bz - hz);
    const x = hx + (bx - hx) / l * 35, z = hz + (bz - hz) / l * 35;
    sites.push({ name: 'stone-house-lawn', x, z, y: ground(x, z), h: 9, shape: 'pennant', col: FLAG_COL.green, L: 3.0, H: 1.3 });
  }
  // 2–3. the bay's piers: the head of the pier nearest each anchor, a short pole at its corner
  for (const a of SHORE_FLAGS.anchors) {
    let best = null, bd = a.maxM;
    for (const p of shore?.piers ?? []) { const d = Math.hypot(p.x - a.x, p.z - a.z); if (d < bd) { bd = d; best = p; } }
    if (!best) continue;
    // at the head; a pier with a boathouse over its end (src/shoreline.js: the last 11.5 m, its ridge 6.5 m up) has the
    // pole just landward of it, tall enough to fly over the roof
    const bh = !!best.boathouse, off = (best.width ?? 2.4) / 2 - 0.15, L0 = best.length - (bh ? 12.5 : 0.6);
    const x = best.x + best.dirX * L0 + best.dirZ * off, z = best.z + best.dirZ * L0 - best.dirX * off;
    sites.push({ name: a.name, x, z, y: best.deckY ?? 1.4, h: bh ? 8 : 4.5, shape: 'burgee', col: a.name === 'camp-pier' ? FLAG_COL.ochre : FLAG_COL.red, L: 1.5, H: 1.0 });
  }
  // 4–5. the harbour: the yacht club's mast on its lawn, 4 m in front of the club (a burgee), and the public pier's
  //    T-head (a plain rectangle)
  if (harbour) {
    const club = harbour.buildings.find((b) => b.kind === 'club');
    if (club) {
      const [nx, nz] = harbour.frame.n, x = club.x + nx * (club.d / 2 + 4), z = club.z + nz * (club.d / 2 + 4);
      sites.push({ name: 'club-lawn', x, z, y: ground(x, z), h: 10, shape: 'burgee', col: FLAG_COL.navy, L: 3.0, H: 2.0 });
    }
    const head = harbour.docks.find((d) => d.kind === 'pier' && d.head);
    if (head) {
      const x = head.b[0], z = head.b[1];
      sites.push({ name: 'harbour-pier', x, z, y: head.deckY ?? 1.4, h: 5, shape: 'flag', col: FLAG_COL.cream, L: 1.8, H: 1.2 });
    }
  }
  return sites;
}

// The cloth's rest shape at (u, v) ∈ [0, 1]²: u along the fly from the hoist, v down the hoist from the top. Returns
// the hoist-relative [s (along the fly, m), d (down, m)].
export function flagShape(site, u, v) {
  const { L, H, shape } = site;
  if (shape === 'flag') return [u * L, v * H];
  // a pennant or a burgee: the depth tapers to the fly; a pennant to a point, a burgee to a blunt 12 % tip
  const tip = shape === 'burgee' ? 0.12 : 0.02, k = 1 - (1 - tip) * u;
  return [u * L, (0.5 + (v - 0.5) * k) * H];   // centred on the hoist's middle
}

// How a flag flies in a wind sample ({ vx, vz, speed } m/s): the fly's horizontal direction [fx, fz] (DOWNWIND), its
// droop below level (rad), the flutter's amplitude (× L) and frequency (Hz)
export function flagFlight(w, L = 2) {
  const sp = Math.max(1e-6, w.speed ?? Math.hypot(w.vx, w.vz));
  const fx = w.vx / sp, fz = w.vz / sp;
  const lift = smooth(SHORE_FLAGS.limpMs, SHORE_FLAGS.fullMs, sp);
  return {
    fx, fz, speed: sp,
    droop: (SHORE_FLAGS.droopMax * (1 - lift) + 4) * DEG,
    amp: 0.025 + 0.085 * smooth(0.5, 4, sp) - 0.03 * smooth(9, 16, sp),   // a limp twitch, a full flap, taut in a gale
    freq: Math.min(4, 0.55 * sp / L + 0.15),                               // ≈ 2.3 Hz for a 1.8 m flag in 7 m/s
  };
}

// one vertex of the flown cloth, world space: the hoist fixed on the pole, the fly turned downwind and drooped, a wave
// running from the hoist to the fly
export function flagVertex(site, fl, u, v, t, phase = 0) {
  const [s, d] = flagShape(site, u, v);
  const c = Math.cos(fl.droop), sn = Math.sin(fl.droop);
  const ex = fl.fx * c, ey = -sn, ez = fl.fz * c;              // the fly, drooped
  const nx = -fl.fz, nz = fl.fx;                                // across it (horizontal)
  const lam = 0.85 * site.L;
  const w = fl.amp * site.L * Math.pow(u, 1.3) * Math.sin(2 * Math.PI * (s / lam - fl.freq * t) + phase + 0.6 * v);
  const top = site.y + site.h - 0.05;
  return [site.x + ex * s + nx * w, top - d + ey * s, site.z + ez * s + nz * w];
}

export function createShoreFlags({ sites, wind, seed = 1 } = {}) {
  const group = new THREE.Group(); group.name = 'shore-flags';
  const F = SHORE_FLAGS, nu = F.segU + 1, nv = F.segV + 1, per = nu * nv;
  // the poles: a tapered white mast and a small ball, one instanced mesh
  const pole = new THREE.CylinderGeometry(0.035, 0.06, 1, 8, 1); pole.translate(0, 0.5, 0);
  const poles = new THREE.InstancedMesh(pole, new THREE.MeshStandardNodeMaterial({ color: FLAG_COL.pole, roughness: 0.55, metalness: 0 }), sites.length);
  const m = new THREE.Matrix4();
  sites.forEach((s, i) => poles.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion(), new THREE.Vector3(s.h / 6, s.h, s.h / 6))));
  poles.instanceMatrix.needsUpdate = true; poles.name = 'flag-poles'; poles.frustumCulled = false;
  group.add(poles);
  // the cloth: one geometry, all flags
  const pos = new Float32Array(sites.length * per * 3), col = new Float32Array(sites.length * per * 3), idx = [];
  sites.forEach((s, k) => {
    const c = new THREE.Color(s.col);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const o = (k * per + j * nu + i) * 3; col[o] = c.r; col[o + 1] = c.g; col[o + 2] = c.b; }
    for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
      const a = k * per + j * nu + i, b = a + 1, cc = a + nu, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardNodeMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, side: THREE.DoubleSide }));
  cloth.name = 'flag-cloth'; cloth.frustumCulled = false;
  group.add(cloth);

  // each flag's eased flight; the wind sampled at F.sampleHz, staggered
  const state = sites.map((s, k) => ({ fl: null, target: null, next: -1, phase: (k * 2.39 + seed * 0.7) % (2 * Math.PI) }));
  let prevT = null;
  function sampleAt(s, t) {
    return flagFlight(wind.sample(s.x, s.z, t), s.L);   // { vx, vz } blow toward: the fly streams that way
  }
  function update(t) {
    const dt = prevT == null ? 1e3 : Math.max(0, Math.min(1, t - prevT)); prevT = t;
    const k = 1 - Math.exp(-dt / F.tauS);
    sites.forEach((s, i) => {
      const st = state[i];
      if (st.target == null || t >= st.next || t < st.next - 2 / F.sampleHz) { st.target = sampleAt(s, t); st.next = t + 1 / F.sampleHz + i * 0.031; }
      if (!st.fl) st.fl = { ...st.target };
      else {
        const T = st.target, f = st.fl;
        // ease the direction as a vector (no wrap at ±180°), the rest as numbers
        let fx = f.fx + (T.fx - f.fx) * k, fz = f.fz + (T.fz - f.fz) * k; const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        st.fl = { fx, fz, speed: f.speed + (T.speed - f.speed) * k, droop: f.droop + (T.droop - f.droop) * k, amp: f.amp + (T.amp - f.amp) * k, freq: f.freq + (T.freq - f.freq) * k };
      }
      for (let j = 0; j < nv; j++) for (let u = 0; u < nu; u++) {
        const p = flagVertex(s, st.fl, u / F.segU, j / F.segV, t, st.phase), o = (i * per + j * nu + u) * 3;
        pos[o] = p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
      }
    });
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  // the flown direction of flag i (for tests and probes): { fx, fz, speed, droop }
  const flight = (i) => state[i]?.fl;
  return { group, update, sites, flight, poles, cloth };
}
