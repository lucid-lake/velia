// Lakeshore boat M9 on screen: the burgee, the telltales and the nav lights (formulas in src/boat/details.js).
//
//   import { createDetails } from './boat/details-mesh.js';
//   const details = createDetails({ rig: rigging.rig });   // a Group named 'details' in the RIG frame (mast socket)
//   boat.sockets.mast.add(details.group);
//   details.update(t, {
//     apparentWind,                 // the contract's { speed, angle }: the boat-frame wind (or windWorld: [x, y, z] m/s,
//                                   //   the air's world velocity minus the boat's, turned into this group's frame)
//     sunElevDeg,                   // switches the nav lights (sunset → sunrise)
//     camera,                       // the view: each light shows only inside its COLREGs sector
//     sails,                        // optional: { main: (u, v) → [x,y,z], jib: (u, v) → [x,y,z], mainFill, jibFill,
//                                   //   lee: −1 | 1 (the side the main sits on), jibLee?, mainStall?, jibStall? (0..1, the
//                                   //   physics'), mainAlphaDeg?, jibAlphaDeg? }
//   });
//   details.setNavMode('sailing' | 'tricolour' | 'motoring' | 'anchor');
//
// Draw calls: 3 (the cloth: burgee + every telltale, one dynamic mesh; the fixtures; the light halos).
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, varying, vec2, vec3, vec4, float, uniform, normalize, max, min, abs, clamp, smoothstep, exp, dot,
  atan, asin, degrees, length, modelWorldMatrix, modelWorldMatrixInverse, cameraViewMatrix, cameraProjectionMatrix,
  cameraPosition, screenSize, uv,
} from 'three/tsl';
import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';
import { streamer, windVector, navLevel, navSector, navVertical, NAV_MODES, SAIL_TELLTALES, sailFlow } from '../../../src/boat/details.js';
import { srgb, solveRig, vec as V } from '../../../src/boat/spars.js';

const BURGEE = { L: 0.45, hoist: 0.28, n: 8, color: srgb(0x8E3B32) };
const YARN = { L: 0.24, w: 0.012, n: 6 };
const RED = srgb(0x7A2E2A), GREEN = srgb(0x2E5E3A);
const toRig = (p, HULL) => [p[0], p[1] - HULL.mastStepY, p[2] - HULL.mastStepZ];

// A point on a polyline at height y (the shroud telltales tie on at a height, wherever the wire runs).
function onWireAtY(pts, y) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k], b = pts[k + 1];
    if ((y - a[1]) * (y - b[1]) <= 0) return V.lerp(a, b, (y - a[1]) / (b[1] - a[1]));
  }
  return pts[0];
}

// dims: the boat's (src/boat/dims.js; this page's boat by default): the nav lights' places
export function createDetails({ rig = solveRig(), dims = DEFAULT_DIMS, clay = false, minPx = 22, navMode = 'sailing' } = {}) {
  const { HULL } = dims;
  const group = new THREE.Group(); group.name = 'details';

  // ---- cloth: the burgee (rows × cols grid) and yarns (2-vertex-wide strips), one buffer ---------------------------
  const yarns = [];
  for (const w of rig.wires.filter((w) => w.name.startsWith('cap_'))) {
    const side = w.name.endsWith('stbd') ? 1 : -1;
    const y = rig.S.chainplate[1] + 1.8;
    yarns.push({ root: onWireAtY(w.pts, y), color: side > 0 ? GREEN : RED, phase: side > 0 ? 0.3 : 1.7, kind: 'shroud' });
    yarns.push({ root: onWireAtY(w.pts, y + 0.35), color: side > 0 ? GREEN : RED, phase: side > 0 ? 2.2 : 0.9, kind: 'shroud' });
  }
  SAIL_TELLTALES.forEach((s, i) => yarns.push({ ...s, color: s.sail === 'main' ? RED : (s.face > 0 ? GREEN : RED), phase: i * 0.77, kind: 'sail' }));
  const bRows = 3, bCols = BURGEE.n + 1;
  const nVerts = bRows * bCols + yarns.length * (YARN.n + 1) * 2;
  const pos = new Float32Array(nVerts * 3), col = new Float32Array(nVerts * 3);
  const idx = [];
  for (let c = 0; c + 1 < bCols; c++) for (let r = 0; r + 1 < bRows; r++) {
    const a = r * bCols + c, b = a + 1, d = a + bCols, e = d + 1;
    idx.push(a, b, e, a, e, d);
  }
  for (let i = 0; i < bRows * bCols; i++) col.set(BURGEE.color, i * 3);
  let base = bRows * bCols;
  const yarnBase = [];
  for (const y of yarns) {
    yarnBase.push(base);
    for (let j = 0; j < (YARN.n + 1) * 2; j++) col.set(y.color, (base + j) * 3);
    for (let j = 0; j < YARN.n; j++) { const a = base + j * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    base += (YARN.n + 1) * 2;
  }
  const clothGeo = new THREE.BufferGeometry();
  clothGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  clothGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  clothGeo.setIndex(idx);
  const clothMat = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: 0.9 });
  clothMat.colorNode = clay ? vec3(0.5) : attribute('color', 'vec3');
  const cloth = new THREE.Mesh(clothGeo, clothMat); cloth.name = 'cloth'; cloth.frustumCulled = false;

  // ---- fixtures: the burgee stick, the light housings with their lenses (emissive by the light level) --------------
  const level = uniform(0);
  const fx = { p: [], n: [], c: [], e: [], i: [] };
  const boxAt = (centre, size, c, e = [0, 0, 0]) => {
    const [sx, sy, sz] = size.map((s) => s / 2);
    const faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]], [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
      [[0, -1, 0], [0, 0, -1], [1, 0, 0]], [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]]];
    for (const [n, u, v] of faces) {
      const b0 = fx.p.length / 3;
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const q = [0, 1, 2].map((k) => centre[k] + n[k] * [sx, sy, sz][k] + u[k] * a * [sx, sy, sz][k] + v[k] * b * [sx, sy, sz][k]);
        fx.p.push(...q); fx.n.push(...n); fx.c.push(...c); fx.e.push(...e);
      }
      fx.i.push(b0, b0 + 1, b0 + 2, b0, b0 + 2, b0 + 3);
    }
  };
  // a vertical cylinder (the masthead light's lens and cap): n sides, outward normals, capped
  const cylAt = (centre, r, h, c, e = [0, 0, 0], n = 16) => {
    const b0 = fx.p.length / 3;
    for (let k = 0; k <= n; k++) {
      const t = (k / n) * 2 * Math.PI, nx = Math.cos(t), nz = Math.sin(t);
      for (const dy of [-h / 2, h / 2]) { fx.p.push(centre[0] + r * nx, centre[1] + dy, centre[2] + r * nz); fx.n.push(nx, 0, nz); fx.c.push(...c); fx.e.push(...e); }
    }
    for (let k = 0; k < n; k++) { const a = b0 + 2 * k; fx.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    for (const sy of [-1, 1]) {
      const c0 = fx.p.length / 3;
      fx.p.push(centre[0], centre[1] + sy * h / 2, centre[2]); fx.n.push(0, sy, 0); fx.c.push(...c); fx.e.push(...e);
      for (let k = 0; k <= n; k++) { const t = (k / n) * 2 * Math.PI; fx.p.push(centre[0] + r * Math.cos(t), centre[1] + sy * h / 2, centre[2] + r * Math.sin(t)); fx.n.push(0, sy, 0); fx.c.push(...c); fx.e.push(...e); }
      for (let k = 0; k < n; k++) sy > 0 ? fx.i.push(c0, c0 + 2 + k, c0 + 1 + k) : fx.i.push(c0, c0 + 1 + k, c0 + 2 + k);
    }
  };
  const dark = srgb(0x232527);
  const P = rig.points;
  const stickTop = V.add(P.burgee, [0, 0.55, 0]);
  boxAt(V.lerp(P.burgee, stickTop, 0.5), [0.012, 0.55, 0.012], dark);
  const navBow = toRig(HULL.navBow, HULL), navStern = toRig(HULL.navStern, HULL);
  const mastTop = [0, rig.S.mastTop + 0.13, 0.0];
  const steaming = [0, 7.0, -0.105];
  const lensR = [1.0, 0.08, 0.06], lensG = [0.06, 1.0, 0.25], lensW = [1.0, 0.92, 0.75];
  boxAt(navBow, [0.12, 0.06, 0.08], dark); boxAt(V.add(navBow, [0.035, 0, -0.03]), [0.05, 0.04, 0.03], GREEN, lensG); boxAt(V.add(navBow, [-0.035, 0, -0.03]), [0.05, 0.04, 0.03], RED, lensR);
  boxAt(navStern, [0.08, 0.06, 0.05], dark); boxAt(V.add(navStern, [0, 0, 0.03]), [0.05, 0.04, 0.02], [0.8, 0.8, 0.8], lensW);
  // the masthead tricolour / all-round light: a clear lens on the rig's base (spars-detail.js masthead), a black cap
  cylAt(V.add(mastTop, [0, 0.006, 0]), 0.028, 0.05, [0.8, 0.8, 0.8], lensW);
  cylAt(V.add(mastTop, [0, 0.036, 0]), 0.031, 0.01, dark);
  boxAt(steaming, [0.07, 0.05, 0.04], [0.8, 0.8, 0.8], lensW);
  const fxGeo = new THREE.BufferGeometry();
  fxGeo.setAttribute('position', new THREE.Float32BufferAttribute(fx.p, 3));
  fxGeo.setAttribute('normal', new THREE.Float32BufferAttribute(fx.n, 3));
  fxGeo.setAttribute('color', new THREE.Float32BufferAttribute(fx.c, 3));
  fxGeo.setAttribute('emit', new THREE.Float32BufferAttribute(fx.e, 3));
  fxGeo.setIndex(fx.i);
  const fxMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.4 });
  fxMat.colorNode = clay ? vec3(0.5) : attribute('color', 'vec3');
  fxMat.emissiveNode = attribute('emit', 'vec3').mul(level).mul(clay ? 0 : 2.0);
  const fixtures = new THREE.Mesh(fxGeo, fxMat); fixtures.name = 'fixtures';

  // ---- halos: camera-facing glows, sized ≥ minPx, lit by sector, elevation and the light level -------------------
  // kind: 0 green, 1 red, 2 stern, 3 steaming, 4 all-round. Each light names its group for setNavMode.
  const lights = [
    { at: V.add(navBow, [0.035, 0, -0.05]), kind: 0, c: lensG, grp: 'bow', size: 0.35 },
    { at: V.add(navBow, [-0.035, 0, -0.05]), kind: 1, c: lensR, grp: 'bow', size: 0.35 },
    { at: V.add(navStern, [0, 0, 0.05]), kind: 2, c: lensW, grp: 'stern', size: 0.35 },
    { at: mastTop, kind: 0, c: lensG, grp: 'tricolour', size: 0.45 },
    { at: mastTop, kind: 1, c: lensR, grp: 'tricolour', size: 0.45 },
    { at: mastTop, kind: 2, c: lensW, grp: 'tricolour', size: 0.45 },
    { at: mastTop, kind: 4, c: lensW, grp: 'anchor', size: 0.45 },
    { at: steaming, kind: 3, c: lensW, grp: 'steaming', size: 0.4 },
  ];
  const hp = new Float32Array(lights.length * 12), hc = new Float32Array(lights.length * 12), hk = new Float32Array(lights.length * 4),
    hs = new Float32Array(lights.length * 4), hcorner = new Float32Array(lights.length * 8), hon = new Float32Array(lights.length * 4);
  const hi = [];
  lights.forEach((l, k) => {
    [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach((cn, j) => {
      const v = k * 4 + j;
      hp.set(l.at, v * 3); hc.set(l.c, v * 3); hk[v] = l.kind; hs[v] = l.size; hcorner.set(cn, v * 2);
    });
    hi.push(k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3);
  });
  const haloGeo = new THREE.BufferGeometry();
  haloGeo.setAttribute('position', new THREE.BufferAttribute(hp, 3));
  haloGeo.setAttribute('hcolor', new THREE.BufferAttribute(hc, 3));
  haloGeo.setAttribute('hkind', new THREE.BufferAttribute(hk, 1));
  haloGeo.setAttribute('hsize', new THREE.BufferAttribute(hs, 1));
  haloGeo.setAttribute('hcorner', new THREE.BufferAttribute(hcorner, 2));
  haloGeo.setAttribute('uv', new THREE.BufferAttribute(hcorner.map((c) => (c + 1) / 2), 2));
  const onAttr = new THREE.BufferAttribute(hon, 1); haloGeo.setAttribute('hon', onAttr);
  haloGeo.setIndex(hi);
  const haloMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const uMinPx = uniform(minPx);
  {
    const centre = attribute('position', 'vec3'), corner = attribute('hcorner', 'vec2');
    const world = modelWorldMatrix.mul(vec4(centre, 1)).xyz;
    const view = cameraViewMatrix.mul(vec4(world, 1));
    const depth = view.z.negate();
    const px = depth.mul(2).div(cameraProjectionMatrix.element(1).y.mul(screenSize.y));
    const size = max(attribute('hsize', 'float'), px.mul(uMinPx));
    haloMat.vertexNode = Fn(() => cameraProjectionMatrix.mul(vec4(view.xy.add(corner.mul(size.mul(0.5))), view.z, 1)))();
    const vI = varying(attribute('hon', 'float'));   // sector × vertical × on, set per light on the CPU (navSector, tested)
    const vCol = varying(attribute('hcolor', 'vec3'));
    haloMat.colorNode = Fn(() => {
      const q = uv().mul(2).sub(1), r2 = dot(q, q);
      // a hot core (≈ 3 px across on the 22 px quad) and a modest round bloom (≈ 12 px) that is gone well inside the quad.
      // Round 3 (owner, 2026-11-07): the bloom was 0.35 · exp(−7 r²); AgX lifts its faint tail (0.18 → mid grey), so on
      // screen it reached the quad's edge: a 22 px white rounded square on the transom
      const glow = exp(r2.mul(-12.0)).mul(0.006).add(exp(r2.mul(-200.0)).mul(0.6));
      return vCol.mul(glow.mul(vI).mul(level).mul(2.0));
    })();
    haloMat.opacityNode = float(1);
  }
  const halos = new THREE.Mesh(haloGeo, haloMat); halos.name = 'halos'; halos.frustumCulled = false; halos.renderOrder = 3;
  if (clay) halos.visible = false;

  group.add(cloth, fixtures, halos);

  // Each light's intensity toward the camera: its mode switch × its COLREGs sector × the vertical fall-off.
  let lit = new Set(NAV_MODES[navMode] ?? NAV_MODES.sailing);
  const KIND = ['green', 'red', 'stern', 'steaming', 'allround'];
  const camLocal = new THREE.Vector3();
  function aimLights(camera) {
    if (camera) { group.updateWorldMatrix(true, false); camLocal.copy(camera.getWorldPosition(new THREE.Vector3())); group.worldToLocal(camLocal); }
    lights.forEach((l, k) => {
      let v = lit.has(l.grp) ? 1 : 0;
      if (v && camera) {
        const d = [camLocal.x - l.at[0], camLocal.y - l.at[1], camLocal.z - l.at[2]];
        const bearing = Math.atan2(d[0], -d[2]) * 180 / Math.PI, elev = Math.atan2(d[1], Math.hypot(d[0], d[2])) * 180 / Math.PI;
        v *= navSector(KIND[l.kind], bearing) * navVertical(elev);
      }
      for (let j = 0; j < 4; j++) hon[k * 4 + j] = v;
    });
    onAttr.needsUpdate = true;
  }
  function setNavMode(mode) { lit = new Set(NAV_MODES[mode] ?? NAV_MODES.sailing); aimLights(null); }
  setNavMode(navMode);

  const inv = new THREE.Matrix4(), w3 = new THREE.Vector3();
  function localWind(o) {
    if (o.windWorld) {
      group.updateWorldMatrix(true, false);
      inv.copy(group.matrixWorld).invert();
      w3.set(...o.windWorld).transformDirection(inv).multiplyScalar(Math.hypot(...o.windWorld));
      return [w3.x, w3.y, w3.z];
    }
    return windVector(o.apparentWind);
  }

  // D2 (time of day): the live sun's elevation; once set it wins over update()'s sunElevDeg (main.js passes the
  // start hour's, fixed)
  // expComp: base exposure / the frame's exposure, so the lamps keep their on-screen brightness while the auto-exposure
  // lifts the dusk (else they bloom ×10–300 at night)
  let liveElevDeg = null, expComp = 1;
  const setSunElev = (deg, comp = 1) => { liveElevDeg = deg; expComp = comp; };
  group.userData.daylight = (f) => setSunElev(f.elevDeg, f.exposureComp ?? 1);
  function update(t = 0, o = {}) {
    const wind = localWind(o);
    level.value = (o.lightsOn ?? navLevel(liveElevDeg ?? o.sunElevDeg ?? 30)) * expComp;
    // dark lamps draw nothing: the halo quads (≥ 22 px) otherwise blank the water's reflection under them, pale
    // squares round the boat in long-lens shots (Chill, 2026-10-29; the cause in the MRT is still open)
    halos.visible = !clay && level.value > 0;
    aimLights(o.camera);
    // burgee: the luff on the stick top, the fly streaming off; the hoist narrows to the tip
    const line = streamer(BURGEE.L, BURGEE.n, [wind[0] * 1.15, 0, wind[2] * 1.15], t, { phase: 0.4 });   // ≈ 15 % more wind aloft
    for (let c = 0; c < bCols; c++) {
      const s = c / BURGEE.n, h = BURGEE.hoist * (1 - s);
      for (let r = 0; r < bRows; r++) {
        const y = (0.5 - r / (bRows - 1)) * h - BURGEE.hoist / 2;
        const p = line[c];
        pos.set([stickTop[0] + p[0], stickTop[1] + p[1] + y, stickTop[2] + p[2]], (r * bCols + c) * 3);
      }
    }
    // yarns: shroud yarns read the wind; sail yarns sit on a0's sail surface and read the flow
    yarns.forEach((y, k) => {
      let root = y.root, flow = wind, stall = 0, normal = null, calm = 0;
      if (y.kind === 'sail') {
        const f = o.sails?.[y.sail];
        if (!f) { root = [0, -50, 0]; }   // no sail yet: parked out of sight
        else {
          root = f(y.u, y.v);
          const fwd = f(Math.max(0, y.u - 0.02), y.v), up = f(y.u, Math.min(1, y.v + 0.02));
          const chord = V.norm(V.sub(root, fwd));
          normal = V.norm(V.cross(chord, V.sub(up, root)));
          // pro: fillAt / stallAt read the sail's two bands at the yarn's height (the head luffs first when over-twisted)
          const fill = o.sails.fillAt?.(y.sail, y.v) ?? (y.sail === 'main' ? o.sails.mainFill : o.sails.jibFill);
          const alpha = y.sail === 'main' ? o.sails.mainAlphaDeg : o.sails.jibAlphaDeg;
          const st = o.sails.stallAt?.(y.sail, y.v) ?? (y.sail === 'main' ? o.sails.mainStall : o.sails.jibStall);
          const lee = y.sail === 'jib' ? (o.sails.jibLee ?? o.sails.lee ?? 1) : (o.sails.lee ?? 1);
          const fl = sailFlow(y.face, lee, fill, alpha, st);
          stall = fl.stall; calm = o.sails.groove ?? 0;   // the groove: the yarns stream straight
          // the stall cue: separated flow on the lee side, the yarn droops, then streams back forward
          flow = V.mul(chord, Math.max(2, Math.hypot(...wind)) * (1 - 1.5 * fl.reverse));
          if (y.face) root = V.add(root, V.mul(normal, 0.01 * y.face * (normal[0] * (o.sails.lee ?? 1) >= 0 ? 1 : -1)));
        }
      }
      const line2 = streamer(YARN.L, YARN.n, flow, t, { phase: y.phase, stall, calm });
      const b0 = yarnBase[k];
      line2.forEach((p, j) => {
        const q = V.add(root, p);
        pos.set([q[0], q[1] + YARN.w / 2, q[2]], (b0 + j * 2) * 3);
        pos.set([q[0], q[1] - YARN.w / 2, q[2]], (b0 + j * 2 + 1) * 3);
      });
    });
    clothGeo.attributes.position.needsUpdate = true;
    clothGeo.computeVertexNormals();
  }
  update(0, {});
  const triangles = idx.length / 3 + fx.i.length / 3 + hi.length / 3;
  return { group, cloth, fixtures, halos, update, setNavMode, setSunElev, level, stats: { triangles, drawCalls: 3, yarns: yarns.length } };
}
