// The storm's lightning bolts (wow/storm): a jagged channel from the cloud base to the ground (a ridge, the shore, the
// water), with a few branches, drawn as camera-facing ribbons: a white-violet core and a wide soft glow round it (a
// bloom without a bloom pass). Its brightness follows the strike's flash (stormArc.js flashOf: a return stroke and two
// restrikes over ≈ 0.25 s). The scene flash (the sky, the water, everything at once) is the post grade's (SU.flash).
// Deterministic: the channel's shape comes from the strike's own seed.
import * as THREE from 'three/webgpu';
import { attribute, uniform, vec3, vec4, float, smoothstep, abs, cameraPosition, normalize, cross, mix } from 'three/tsl';
import { hash, CELL } from '../../../src/sim/weather/stormArc.js';

const BOLT = { maxVerts: 2400, coreM: 16, glowM: 170, segM: 70 };

// the channel as polylines (world points), from (x, top, z) down to (x, ground, z): midpoint displacement, then
// branches from a third of the joints, each a shorter, thinner fork downward
export function boltPaths(strike, groundY, { topY = CELL.baseM + 500 } = {}) {
  const r = (k) => hash(strike.seed, k, 9);
  let k = 0;
  const jag = (a, b, depth, rough) => {
    if (depth === 0) return [a];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    m[0] += (r(k++) - 0.5) * len * rough; m[2] += (r(k++) - 0.5) * len * rough; m[1] += (r(k++) - 0.5) * len * rough * 0.3;
    return [...jag(a, m, depth - 1, rough), ...jag(m, b, depth - 1, rough)];
  };
  const top = [strike.x + (r(900) - 0.5) * 600, topY, strike.z + (r(901) - 0.5) * 600];
  const end = [strike.x, groundY, strike.z];
  const main = [...jag(top, end, 6, 0.55), end];
  const paths = [{ pts: main, w: 1 }];
  for (let i = 4; i < main.length - 8; i += 5) {
    if (r(1000 + i) > 0.45) continue;
    const a = main[i], L = (main.length - i) * 0.4 * (Math.hypot(main[1][0] - main[0][0], main[1][1] - main[0][1]) || 30);
    const ang = r(1100 + i) * Math.PI * 2;
    const b = [a[0] + Math.cos(ang) * L * 0.5, a[1] - L * (0.5 + r(1200 + i) * 0.4), a[2] + Math.sin(ang) * L * 0.5];
    paths.push({ pts: [...jag(a, b, 4, 0.6), b], w: 0.45 });
  }
  return paths;
}

export function createLightning({ lum = 0.1 } = {}) {
  const N = BOLT.maxVerts;
  const geo = new THREE.BufferGeometry();
  const posA = new Float32Array(N * 3), dirA = new Float32Array(N * 3), side = new Float32Array(N * 2);
  geo.setAttribute('position', new THREE.BufferAttribute(posA, 3));
  geo.setAttribute('along', new THREE.BufferAttribute(dirA, 3));
  geo.setAttribute('side', new THREE.BufferAttribute(side, 2));   // x: −1 | +1 across, y: the path's width scale
  const index = new Uint32Array(N * 3);
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.setDrawRange(0, 0);
  const U = { glow: uniform(0), light: uniform(lum) };
  const mk = (width, core) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.fog = false;
    const s = attribute('side', 'vec2'), al = attribute('along', 'vec3'), p = attribute('position', 'vec3');
    const across = normalize(cross(normalize(al), normalize(cameraPosition.sub(p))));
    m.positionNode = p.add(across.mul(s.x.mul(s.y).mul(width)));
    const x = abs(s.x);
    const prof = core ? float(1).sub(smoothstep(0.35, 1.0, x)) : float(1).sub(x).pow(2.2);
    const col = core ? mix(vec3(1.0, 0.98, 1.0), vec3(0.85, 0.82, 1.0), x) : vec3(0.55, 0.6, 1.0);
    // the core at ≈ 60× a sunlit wall's luminance: AgX rolls it to white; the glow at ≈ 2×
    m.colorNode = vec4(col.mul(prof).mul(U.glow).mul(U.light).mul(core ? 60 : 2.2).mul(s.y.mul(0.6).add(0.4)), 1);
    return m;
  };
  const group = new THREE.Group();
  group.name = 'storm-lightning';
  const core = new THREE.Mesh(geo, mk(BOLT.coreM, true)), glow = new THREE.Mesh(geo, mk(BOLT.glowM, false));
  for (const m of [core, glow]) { m.frustumCulled = false; m.renderOrder = 11; group.add(m); }
  group.visible = false;
  let current = null;

  function build(strike, groundY) {
    const paths = boltPaths(strike, groundY);
    let v = 0, t = 0;
    for (const { pts, w } of paths) {
      if (v + pts.length * 2 > N) break;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        const dir = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const taper = w * (1 - 0.6 * i / pts.length);
        for (const sx of [-1, 1]) {
          posA.set(pts[i], v * 3); dirA.set(dir, v * 3); side.set([sx, taper], v * 2); v++;
        }
        if (i > 0) { const q = v - 4; index.set([q, q + 1, q + 2, q + 2, q + 1, q + 3], t); t += 6; }
      }
    }
    for (const n of ['position', 'along', 'side']) geo.attributes[n].needsUpdate = true;
    geo.index.needsUpdate = true;
    geo.setDrawRange(0, t);
    current = strike.id;
  }
  return {
    group, uniforms: U,
    // strike: the one to show (or null), its flash 0–1.5, the ground's height there (m), the hand-set light level
    update({ strike, flash, groundY = 0, light = lum }) {
      if (!strike || flash <= 0.002 || !strike.bolt) { group.visible = false; return; }
      if (strike.id !== current) build(strike, groundY);
      group.visible = true; U.glow.value = Math.min(1.5, flash); U.light.value = light;
    },
    dispose() { geo.dispose(); core.material.dispose(); glow.material.dispose(); },
  };
}
