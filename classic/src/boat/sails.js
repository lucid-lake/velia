// Lakeshore sails (M5 mainsail, M6 jib): meshes driven by the physics state each frame, and the cloth material.
//
//   boat.attach('main', makeMainsail({ atmosphere }));   // atmosphere: the AtmosphereContext (the sun behind the cloth)
//   boat.attach('jib', makeJib({ atmosphere }));
//   // Boat.update calls module.update(state, dt, env) each frame: state = contract.js STATE, env.t = seconds (flutter)
// Both sit in the RIG frame (dims.js: origin at the mast step) and place themselves from boomAngle / jibAngle.
//
// The steady surfaces are rig.js's mainPoint / jibPoint, evaluated on the CPU (≈ 4.2 k vertices, ≈ 0.5 ms) only when
// trim, fill, draft or reef change; the luff flutter is a vertex-shader deform (the same wave as rig.js):
// one set of formulas for the render, the lines (M7) and the area tests. The cloth shader draws what the camera
// reads from 40–60 m: crosscut panel seams, luff / leech / foot tapes, corner patches, batten pockets, the reef bands,
// and the sun through the cloth from behind (seams, tapes and patches are more layers, so they show darker).
import * as THREE from 'three/webgpu';
import {
  Fn, positionLocal, normalLocal, sin, cos, transformNormalToView, faceDirection, attribute, float, vec3, vec4, uniform, mix, max, min, abs, fract, fwidth, smoothstep, saturate, dot, normalize, cross,
  positionWorld, normalWorld, cameraPosition, frontFacing, select, texture, vec2,
} from 'three/tsl';
import { getSplitScalarIlluminance } from '@takram/three-atmosphere/webgpu';
import { canvasHex } from './canvas.js';
import { RIG, mainPoint, jibPoint, sailParams, jibTack, jibHeadPt } from '../../../src/boat/rig.js';

const CLOTH = {
  color: new THREE.Color('#EFE6D2'),
  albedo: 0.80,                                // × the cream: the lit sail sits under AgX's shoulder (≈ 190–200 luma at exposure 6), so the
                                               // shading, seams and battens survive the tone map (Design lead, 2026-10-29)
  camberShade: 0.6,                            // the shading normal's deviation from the flat chord, amplified by 1 + this           // cream Dacron; layers one step darker, #E2D7BF
  roughness: 0.72,
  transmit: 0.22,                              // single-ply Dacron: share of the sun that comes through (0.2–0.3 measured; 0.34 made a backlit sail out-glow the sky)
  panelM: { main: 1.05, jib: 0.95 },           // crosscut panel width along the luff, m
  uvStrip: new THREE.Color(canvasHex(0.78)),   // the furling jib's UV strip on the leech and foot, the boat's canvas a shade darker (sun-side acrylic)
  uvWidth: { leech: 0.16, foot: 0.12 },        // m
};

// A grid of (u, v) on [0,1]²; positions and the metric attribute (metres: along the chord, up the luff) fill per frame.
function grid(nu, nv) {
  const g = new THREE.BufferGeometry();
  const n = (nu + 1) * (nv + 1);
  const uv = new Float32Array(n * 2);
  for (let j = 0, k = 0; j <= nv; j++) for (let i = 0; i <= nu; i++, k++) { uv[2 * k] = i / nu; uv[2 * k + 1] = j / nv; }
  const idx = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 1, d = c + 1;
    idx.push(a, b, d, a, d, c);
  }
  g.setIndex(idx);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('metric', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  g.setAttribute('tangentU', new THREE.BufferAttribute(new Float32Array(n * 3), 3));   // along the chord (the flutter's slope)
  g.setAttribute('flatN', new THREE.BufferAttribute(new Float32Array(n * 3), 3));      // the flat chord's normal, per row
  g.userData = { nu, nv };
  return g;
}

// Write the surface into the geometry: positions, the metric coordinates, normals.
const PA = [0, 0, 0], PB = [0, 0, 0];   // fill's scratch points
function fill(g, pointFn, state, t) {
  const { nu, nv } = g.userData;
  const pos = g.attributes.position.array, met = g.attributes.metric.array;
  const tackP = pointFn(0, 0, state, t, PA), headP = pointFn(0, 1, state, t, PB);
  const luffLen = Math.hypot(headP[0] - tackP[0], headP[1] - tackP[1], headP[2] - tackP[2]);
  for (let j = 0, k = 0; j <= nv; j++) {
    const v = j / nv;
    let along = 0, px = 0, py = 0, pz = 0;   // the previous point (scalars: one scratch array, no array per vertex)
    for (let i = 0; i <= nu; i++, k++) {
      const p = pointFn(i / nu, v, state, t, PA);
      if (i > 0) along += Math.hypot(p[0] - px, p[1] - py, p[2] - pz);
      px = p[0]; py = p[1]; pz = p[2];
      pos[3 * k] = p[0]; pos[3 * k + 1] = p[1]; pos[3 * k + 2] = p[2];
      met[2 * k] = along;
      met[2 * k + 1] = v * luffLen;
    }
  }
  // Normals by central differences on the grid (three's computeVertexNormals took 1.2 ms for the main alone).
  const nrm = g.attributes.normal.array, tan = g.attributes.tangentU.array, fln = g.attributes.flatN.array, W = nu + 1;
  // The flat chord's normal per row: chord (luff → leech) × the luff's direction, the same order as the normals below.
  for (let j = 0; j <= nv; j++) {
    const a = 3 * (j * W), b = 3 * (j * W + nu), c = 3 * (Math.min(j + 1, nv) * W), d = 3 * (Math.max(j - 1, 0) * W);
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[d], vy = pos[c + 1] - pos[d + 1], vz = pos[c + 2] - pos[d + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    for (let i = 0; i <= nu; i++) { const k = 3 * (j * W + i); fln[k] = nx / l; fln[k + 1] = ny / l; fln[k + 2] = nz / l; }
  }
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const k = j * W + i;
    const a = 3 * (j * W + Math.min(i + 1, nu)), b = 3 * (j * W + Math.max(i - 1, 0));
    const c = 3 * (Math.min(j + 1, nv) * W + i), d = 3 * (Math.max(j - 1, 0) * W + i);
    const ux = pos[a] - pos[b], uy = pos[a + 1] - pos[b + 1], uz = pos[a + 2] - pos[b + 2];
    const vx = pos[c] - pos[d], vy = pos[c + 1] - pos[d + 1], vz = pos[c + 2] - pos[d + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nrm[3 * k] = nx / l; nrm[3 * k + 1] = ny / l; nrm[3 * k + 2] = nz / l;
    const lu = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    tan[3 * k] = ux / lu; tan[3 * k + 1] = uy / lu; tan[3 * k + 2] = uz / lu;
  }
  g.attributes.position.needsUpdate = true;
  g.attributes.normal.needsUpdate = true;
  g.attributes.tangentU.needsUpdate = true;
  g.attributes.flatN.needsUpdate = true;
  g.attributes.metric.needsUpdate = true;
  return luffLen;
}

// The cloth material. kind: 'main' | 'jib'. Uniforms: the hoisted luff length, the battens on/off, the reef bands.
function clothMaterial(kind, { atmosphere, sunDir, sunColor, transmit = CLOTH.transmit, decal = null }) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, roughness: CLOTH.roughness, metalness: 0 });
  const hoist = uniform(RIG.mainLuff), chordFoot = uniform(kind === 'main' ? RIG.boom : RIG.jibLP);
  const met = attribute('metric', 'vec2');          // x: metres along the chord from the luff, y: metres up the luff
  const uvA = attribute('uv', 'vec2');
  // An antialiased line at the zero crossings of a periodic coordinate (width in metres).
  const line = (x, period, width) => {
    const d = abs(fract(x.div(period).add(0.5)).sub(0.5)).mul(period);
    const fw = fwidth(x).max(1e-4);
    return float(1).sub(smoothstep(width.mul(0.5), width.mul(0.5).add(fw), d));
  };
  const band = (x, w) => float(1).sub(smoothstep(w, w.add(fwidth(x).max(1e-4)), x));   // 1 for x < w
  // Batten pockets (main): a darker line each, so the four battens read from the game camera (≈ 7 cm ≈ 4 px at 30 m).
  const pocketsOut = kind === 'main' ? Fn(() => {
    let pk = float(0);
    for (const b of RIG.battens) pk = max(pk, band(abs(met.y.sub(hoist.mul(b))), float(0.035)).mul(smoothstep(0.0, 0.03, uvA.x)));
    return pk;
  })() : float(0);
  const layers = Fn(() => {
    const s = met.x, h = met.y;
    const chordHere = s.div(uvA.x.max(1e-3));                                   // the chord's length at this height
    // Crosscut panels run roughly at right angles to the leech: lines of constant (height − k · chord position).
    const tilt = kind === 'main' ? 0.08 : 0.32;
    const seam = line(h.sub(s.mul(tilt)), float(CLOTH.panelM[kind]), float(0.025));
    const luffTape = band(s, float(0.07));
    const leechTape = band(chordHere.sub(s), float(0.045));
    const footTape = band(h, float(0.05));
    // Corner patches: radial reinforcements at the tack, the clew and the head (≈ 0.7 m, 0.8 m, 0.5 m).
    const tack = float(1).sub(smoothstep(0.55, 0.75, s.mul(s).add(h.mul(h)).sqrt()));
    const clewD = chordFoot.sub(s).mul(chordFoot.sub(s)).add(h.mul(h)).sqrt();
    const clew = float(1).sub(smoothstep(0.65, 0.85, clewD));
    const headD = hoist.sub(h).abs();
    const head = float(1).sub(smoothstep(0.4, 0.55, headD));
    let pockets = float(0), reefBand = float(0);
    if (kind === 'main') {
      for (const b of RIG.battens) {   // full-batten main (reference §15): the pockets run luff to leech
        const at = abs(h.sub(hoist.mul(b)));
        pockets = max(pockets, band(at, float(0.035)).mul(smoothstep(0.0, 0.03, uvA.x)));
      }
      for (const r of RIG.reefs.slice(1)) {
        const at = abs(h.sub(float(RIG.mainLuff * r)));
        reefBand = max(reefBand, band(at, float(0.03)).mul(0.6));
      }
    }
    const tapes = max(max(luffTape, leechTape), footTape);
    const patch = max(max(tack, clew), head);
    // Extra layers: seam 0.35 (a stitched overlap, faint: at a full layer the crosscut seams dipped ≈ 22 luma backlit, every
    // metre, and read as stripes), tapes 1, patches 2, pockets 1 (cloth + the pocket: ≈ 20–25 luma, read as battens), reef
    // band 0.5. Measured as the column median across the belly (2026-10-29).
    return seam.mul(0.35).add(tapes).add(patch.mul(2)).add(pockets).add(reefBand);
  })();
  // The jib's navy UV strip along the leech and the foot: what shows when it is furled (an opaque acrylic canvas).
  const uvStrip = kind === 'jib'
    ? max(band(met.x.div(uvA.x.max(1e-3)).sub(met.x), float(CLOTH.uvWidth.leech)), band(met.y, float(CLOTH.uvWidth.foot)))
    : float(0);
  // Front-lit tone: extra layers read a touch darker (stitching, a whiter tape); the cloth itself is cream.
  // A value step across the chord (Design lead, whole-boat critique): the luff a step darker, the belly lit, the leech
  // dipping a little; the shading of the camber alone left the main a flat plate from astern.
  // Reef points: short ties every 0.30 m along each reef band, darker dots; a cringle at the luff and the leech ends.
  const reefPts = kind === 'main' ? Fn(() => {
    let d = float(0);
    for (const r of RIG.reefs.slice(1)) {
      const dy = abs(met.y.sub(float(RIG.mainLuff * r)));
      const dx = abs(fract(met.x.div(0.30)).sub(0.5)).mul(0.30);
      const tie = float(1).sub(smoothstep(0.012, 0.012 + 0.004, dx.mul(dx).add(dy.mul(dy)).sqrt()));
      const chord = met.x.div(uvA.x.max(1e-3));
      const endD = min(met.x, chord.sub(met.x));
      const cr = float(1).sub(smoothstep(0.022, 0.028, endD.mul(endD).add(dy.mul(dy)).sqrt().sub(0.07).abs().add(0.02)));
      d = max(d, max(tie, cr));
    }
    return d;
  })() : float(0);
  const across = float(0.92).add(smoothstep(0.0, 0.45, uvA.x).mul(0.08)).sub(smoothstep(0.8, 1.0, uvA.x).mul(0.04));
  m.colorNode = mix(vec3(CLOTH.color.r, CLOTH.color.g, CLOTH.color.b).mul(CLOTH.albedo).mul(across).mul(float(1).sub(min(layers, 2.0).mul(0.06))).mul(float(1).sub(pocketsOut.mul(0.10))),
    vec3(CLOTH.uvStrip.r, CLOTH.uvStrip.g, CLOTH.uvStrip.b), uvStrip).mul(float(1).sub(reefPts.mul(0.45)));
  // an optional decal (a sail number and class insignia on the main; Regatta's rival): a texture over the cloth's own uv,
  // off by default. The cloth stays lit by the same emissive; only the colour changes.
  if (decal) { const dt = texture(decal, vec2(uvA.x, uvA.y)); m.colorNode = mix(m.colorNode, dt.rgb.mul(CLOTH.albedo), dt.a); }
  // The sun through the cloth from behind: each layer passes ≈ τ of what reaches it.
  const sunD = sunDir ?? uniform(new THREE.Vector3(0.3, 0.4, -0.85).normalize());   // D2: setSun() moves it (sailModule)
  m.emissiveNode = Fn(() => {
    const toCam = normalize(cameraPosition.sub(positionWorld));
    const n = normalWorld.mul(select(frontFacing, 1.0, -1.0));          // the normal on the camera's side
    const nc = select(dot(n, toCam).lessThan(0.0), n.negate(), n);
    const back = max(dot(nc.negate(), normalize(sunD)), 0.0);          // the sun on the far side of the cloth
    let E;
    if (atmosphere) {
      let pE = atmosphere.matrixWorldToECEF.mul(vec4(positionWorld, 1)).xyz;
      if (atmosphere.correctAltitude) pE = pE.add(atmosphere.altitudeCorrectionECEF);
      E = getSplitScalarIlluminance(pE.mul(atmosphere.parametersNode.worldToUnit), atmosphere.sunDirectionECEF).get('direct');
    } else {
      E = sunColor ?? uniform(new THREE.Color(3, 2.8, 2.5));
    }
    const tau = float(transmit).mul(float(0.45).pow(layers)).mul(float(1).sub(uvStrip));   // the canvas strip blocks the sun
    return vec3(E).mul(1 / Math.PI).mul(tau).mul(back).mul(vec3(CLOTH.color.r, CLOTH.color.g, CLOTH.color.b));
  })();
  // Luff flutter on the GPU (rig.js flutter(), the same wave, keep in step): a displacement along the normal from the
  // luff amount and the time, and the normal tilted by the wave's slope along the chord so the ripples catch the light.
  const luff = uniform(0), luffTop = uniform(0), time = uniform(0);   // pro: luff (the low band) and luffTop (the head) by height
  const FLUTTER = 0.06;   // amplitude per metre of chord at a full flog (rig.js uses the same)
  const wavePair = (u, v) => {
    const TAU = 2 * Math.PI;
    const a1 = u.mul(2.2).sub(time.mul(3.1)).mul(TAU).add(v.mul(5.0)), a2 = u.mul(3.7).sub(time.mul(4.3)).mul(TAU).add(v.mul(2.0)).add(1.3);
    return { w: sin(a1).mul(0.6).add(sin(a2).mul(0.4)), dw: cos(a1).mul(0.6 * 2.2 * TAU).add(cos(a2).mul(0.4 * 3.7 * TAU)) };   // dw = ∂w/∂u
  };
  const luffV = mix(luff, luffTop, smoothstep(0.3, 0.75, uvA.y));   // rig.js bandFill's heights
  const ampAt = (u) => luffV.mul(float(1).sub(smoothstep(0.0, 0.35, u))).mul(0.6).add(smoothstep(0.4, 1.0, luffV).mul(u.mul(0.7).add(0.3)));
  const chordAt = () => met.x.div(uvA.x.max(1e-3)).max(0.05);
  m.positionNode = Fn(() => {
    const { w } = wavePair(uvA.x, uvA.y);
    return positionLocal.add(normalLocal.mul(ampAt(uvA.x).mul(FLUTTER).mul(chordAt()).mul(w)));
  })();
  m.normalNode = Fn(() => {
    const { w, dw } = wavePair(uvA.x, uvA.y);
    // d(offset)/d(arc length) = (amp · dw + amp' · w) · FLUTTER (chord cancels: offset ∝ chord, s = u · chord); amp' small, dropped.
    const slope = ampAt(uvA.x).mul(dw).mul(FLUTTER);
    // The camber in the shading: the normal's deviation from the flat chord, amplified, so the sun grades the chord.
    const nc = normalLocal.add(normalLocal.sub(attribute('flatN', 'vec3')).mul(CLOTH.camberShade));
    // Dacron up close: a plain weave (≈ 1.6 mm, faded once a thread is under a pixel) and soft crinkles (≈ 0.2–0.5 m,
    // the cloth's memory of being flaked), tilting the normal a little along the chord and up the luff
    const tU = attribute('tangentU', 'vec3'), tV = normalize(cross(nc, tU));
    const fw = fwidth(met.x).add(fwidth(met.y)).max(1e-5);
    const fine = float(1).sub(smoothstep(0.0006, 0.0016, fw));
    const wx = sin(met.x.mul(2 * Math.PI / 0.0016)), wy = sin(met.y.mul(2 * Math.PI / 0.0016));
    const crx = sin(met.x.mul(13.1).add(sin(met.y.mul(4.3)).mul(2.0))).mul(sin(met.y.mul(9.7).add(met.x.mul(2.1))));
    const cry = sin(met.y.mul(15.7).add(sin(met.x.mul(5.9)).mul(1.7))).mul(sin(met.x.mul(7.3).sub(met.y.mul(1.3))));
    const tilt = tU.mul(wx.mul(fine).mul(0.06).add(crx.mul(0.035))).add(tV.mul(wy.mul(fine).mul(0.06).add(cry.mul(0.035))));
    const n = normalize(nc.add(tilt).sub(tU.mul(slope)));
    return transformNormalToView(n).mul(faceDirection);
  })();
  m.userData.uniforms = { hoist, chordFoot, luff, luffTop, time, sunDir: sunD };
  return m;
}

// A sail module: a Group with the cloth mesh (and its roll), update(state, dt, env), triangles(), cpuMs().
function sailModule(kind, { atmosphere, sunDir, sunColor, transmit, decal = null, grid: [nu, nv] }) {
  const group = new THREE.Group();
  group.name = kind === 'main' ? 'mainsail' : 'jib';
  const geo = grid(nu, nv);
  const mat = clothMaterial(kind, { atmosphere, sunDir, sunColor, transmit, decal });
  const cloth = new THREE.Mesh(geo, mat);
  cloth.name = `${group.name}-cloth`;
  cloth.frustumCulled = false;
  cloth.castShadow = true;
  group.add(cloth);
  // The reefed cloth flaked on the boom (main) or the jib rolled on the furler: a cloth-coloured roll.
  const rollMat = new THREE.MeshStandardNodeMaterial({ roughness: CLOTH.roughness, metalness: 0 });
  // Furled, the jib shows its navy UV strip; the main's reefed cloth stays cream.
  rollMat.colorNode = kind === 'jib' ? vec3(CLOTH.uvStrip.r, CLOTH.uvStrip.g, CLOTH.uvStrip.b) : vec3(CLOTH.color.r, CLOTH.color.g, CLOTH.color.b).mul(0.94);
  const roll = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1), rollMat);
  roll.name = kind === 'main' ? 'reef-bundle' : 'furled-jib';
  roll.visible = false;
  group.add(roll);
  // The corner rings (tack, clew, head): pressed stainless rings in the corner patches, one instanced draw.
  const ringGeo = new THREE.TorusGeometry(kind === 'main' ? 0.020 : 0.018, 0.0055, 6, 16);
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshStandardNodeMaterial({ color: 0xc8cacc, metalness: 1, roughness: 0.25 }), 3);
  rings.name = `${group.name}-rings`; rings.frustumCulled = false;
  group.add(rings);
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _n = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _z = new THREE.Vector3(0, 0, 1);
  function placeRings() {
    const { nu, nv } = geo.userData, W = nu + 1, pos = geo.attributes.position.array, nrm = geo.attributes.normal.array;
    // each corner, a touch in toward the sail's centre (the ring sits ≈ 8 cm in from the corner)
    [[0, 0, 1, 1], [nu, 0, nu - 1, 1], [0, nv, 1, nv - 1]].forEach(([i, j, i2, j2], k) => {
      const a = 3 * (j * W + i), b = 3 * (j2 * W + i2);
      _p.set(pos[a] * 0.6 + pos[b] * 0.4, pos[a + 1] * 0.6 + pos[b + 1] * 0.4, pos[a + 2] * 0.6 + pos[b + 2] * 0.4);
      _n.set(nrm[a], nrm[a + 1], nrm[a + 2]).normalize();
      _q.setFromUnitVectors(_z, _n);
      rings.setMatrixAt(k, _m.compose(_p, _q, _s));
    });
    rings.instanceMatrix.needsUpdate = true;
  }
  const T = new THREE.Vector3(...jibTack), H = new THREE.Vector3(...jibHeadPt);
  const Y = new THREE.Vector3(0, 1, 0);
  let clock = 0, cpuMs = 0, lastKey = '';

  function update(state, dt = 0, env = {}) {
    const t0 = performance.now();
    clock += dt;
    const t = env.t ?? clock;
    const p = sailParams(state);
    // The flutter runs on the GPU; the CPU rebuilds the steady shape only when trim, fill, draft or reef change.
    const sp = kind === 'main' ? p.main : p.jib;
    mat.userData.uniforms.luff.value = 1 - Math.min(1, Math.max(0, sp.fillLow ?? sp.fill));
    mat.userData.uniforms.luffTop.value = 1 - Math.min(1, Math.max(0, sp.fillTop ?? sp.fill));
    mat.userData.uniforms.time.value = t;
    const key = JSON.stringify(sp);
    if (key === lastKey) { cpuMs = performance.now() - t0; return; }
    lastKey = key;
    if (kind === 'main') {
      mat.userData.uniforms.hoist.value = fill(geo, mainPoint, p.main, null);
      placeRings();
      const reef = p.main.reef, drop = p.main.drop ?? 0;   // continuous while reefing; drop: the sail down on the boom
      roll.visible = reef > 0.02 || drop > 0.02;
      if (roll.visible) {   // along the boom's top, from the gooseneck pin
        const a = p.main.boomRad, r = 0.05 + 0.035 * reef + 0.07 * drop, L = RIG.boom * 0.92;
        roll.scale.set(r, L, r * 0.7);
        roll.position.set(Math.sin(a) * L / 2, RIG.gooseneck + r * 0.7, 0.12 + Math.cos(a) * L / 2);
        roll.quaternion.setFromUnitVectors(Y, new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
      }
    } else {
      mat.userData.uniforms.hoist.value = fill(geo, jibPoint, p.jib, null);
      placeRings();
      mat.userData.uniforms.chordFoot.value = RIG.jibLP * (1 - p.jib.furl);
      roll.visible = p.jib.furl > 0.02;
      if (roll.visible) {   // around the furler foil, tack to head
        const r = 0.025 + 0.075 * Math.sqrt(p.jib.furl);
        roll.scale.set(r, H.distanceTo(T), r);
        roll.position.copy(T).add(H).multiplyScalar(0.5);
        roll.quaternion.setFromUnitVectors(Y, H.clone().sub(T).normalize());
      }
    }
    cpuMs = performance.now() - t0;
  }
  group.update = update;
  // D2 (time of day): the sun's direction for the light through the cloth (its strength already follows the sky
  // model's sun). Before D2 the cloth used a fixed direction at every hour unless the caller passed sunDir.
  group.setSun = (dir) => { const u = mat.userData.uniforms.sunDir; if (u?.value?.isVector3) u.value.set(dir.x, dir.y, dir.z).normalize(); };
  group.userData.daylight = (f) => group.setSun(f.sunDir);
  group.triangles = () => geo.index.count / 3 + (roll.visible ? 40 : 0);
  group.cpuMs = () => cpuMs;
  return group;
}

export const makeMainsail = (opts = {}) => sailModule('main', { grid: [40, 64], ...opts });
export const makeJib = (opts = {}) => sailModule('jib', { grid: [32, 56], ...opts });
