// M10: bow spray: small bright droplets (not puffs), only at speed (> 15 kn) or when the bow slams into chop. A pool of 384 instanced sprites run on the CPU (deterministic: a seeded generator, no
// Math.random()). Spray leaves both sides of the bow near the waterline, out, up and a little aft, and falls under
// gravity in 0.35–0.65 s. How much: nothing under 15 kn (7.7 m/s), more with speed, and a burst when the bow drops
// into a wave (the pitch rate from the float), which is when real spray flies. Colour: set it sunlit (bright).
// The thrill build (2026-10-29) adds two honest sources and the wind:
//   a slam: the bow meeting a face faster than Ochi's 0.093·√(gL) (state.slam, src/boat/thrill.js; the float's
//     bowRelVel) throws a sheet of spray up from the bow (3–6 m/s up, out to the sides, with the boat's own speed);
//   a surf: riding a wave past hull speed (state.surf) the bow wave turns to a low white sheet off both bows;
//   the wind: each droplet's drag pulls it toward the air's velocity (the true wind at deck height, (1.5 / 10)^0.14 of
//     the 10 m wind) over DRAG_S, so upwind the slam's sheet blows aft over the deck, as it does on a real boat.
//
//   const spray = createSpray();  scene.add(spray.mesh);   // defaults: the Catalina 28 (dims.js)
//   each frame: spray.update(state, wave, dt)   (state: the physics STATE; wave: HullFloat's { heave, pitch })
import * as THREE from 'three/webgpu';
import { instancedBufferAttribute, uniform, vec2, vec3, vec4, float, uv, smoothstep, atan, min, max, pow, dot, normalize, varying, modelViewMatrix, cameraPosition } from 'three/tsl';

import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';
import { mulberry32 } from '../../../src/sim/core/rng.js';

// droplet drag time toward the air's velocity (s) [est: a 1–2 mm drop reaches the wind's speed in ≈ 0.2–0.4 s]; the
// wind at deck height over the 10 m wind (the 1/7 power law the physics uses); the slam and surf droplets' life
// a slam's sheet reaches the cabin top (≈ 2.2 m: √(2·g·2.2) ≈ 6.6 m/s up at the most), as a thrown sheet does in a
// short steep chop; its droplets read larger (0.15–0.3 m sprites: clots of a broken sheet, seen from ≈ 20 m)
const SPRAY = { dragS: 0.3, deckWind: Math.pow(1.5 / 10, 0.14), slamRate: 700, surfRate: 90, slamLife: [0.8, 0.5], surfLife: [0.45, 0.3], slamUp: [4, 2.6], slamSize: 1.6 };

// How a droplet is drawn (fix/helm-spray, owner 2026-11-06: from the helm the slam's spray flew past the wheel as big
// white balls). It was a round 0.10–0.32 m sprite at alpha 0.8 in a flat HDR white: 1.8 m from the helm's eye that is a
// 119 px disc (tools/probe_helm_spray.mjs). Now each droplet is a thin streak stretched along its motion relative to the boat (the
// camera rides the boat) over blurS, a camera's exposure, like real spray seen from the cockpit:
//   width: m, a droplet's (a clot's) width; a slam's sheet starts sheetGrow× wider and breaks up over sheetT of its life
//   capW / capL: rad, the most a streak may subtend across / along (≈ 5.5 px / 170 px at the helm's 55° on 720 px), so a
//     drop near the lens is a thin fast streak, never a disc
//   near: m from the eye: no drop nearer than near[0], fully drawn from near[1] (a drop that close is a blur)
//   alpha: a streak's peak opacity; its energy spread along the streak (≥ minSpread of it kept): a fast streak is faint
//   amb / glint / glintPow: lit, not emissive: the scene's droplet colour × (amb + glint × the sun behind the drop^glintPow)
export const SPRAY_LOOK = { width: [0.02, 0.055], slamWidth: [0.03, 0.065], sheetGrow: 2.2, sheetT: 0.3, blurS: 0.025,
  capW: 0.008, capL: 0.25, near: [0.6, 1.6], alpha: 0.9, minSpread: 0.45, spread: 4, amb: 0.85, glint: 1.6, glintPow: 6 };


export function createSpray({ dims = DEFAULT_DIMS, length = dims.HULL.lwl, beam = dims.HULL.beam, count = 640, seed = 1, color = 0xf2f0ea, look = SPRAY_LOOK } = {}) {   // sunlit white (Design lead)
  const rand = mulberry32(seed * 7919 + 13), rLook = mulberry32(seed * 104729 + 7);   // rLook: the look's own draws, so the flight stays the same draw for draw
  // pos: world; rel: the velocity relative to the boat (the streak's motion as the riding camera sees it); size: the
  // drawn width (m, 0 = not drawn); alpha: the opacity before the view's own terms
  const pos = new Float32Array(count * 3), size = new Float32Array(count), alpha = new Float32Array(count), rel = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3), age = new Float32Array(count).fill(1e9), life = new Float32Array(count).fill(1), big = new Float32Array(count).fill(1);
  const kindOf = new Uint8Array(count), w0 = new Float32Array(count), a0 = new Float32Array(count).fill(1);
  const posAttr = new THREE.InstancedBufferAttribute(pos, 3), sizeAttr = new THREE.InstancedBufferAttribute(size, 1);
  const alphaAttr = new THREE.InstancedBufferAttribute(alpha, 1), relAttr = new THREE.InstancedBufferAttribute(rel, 3);
  for (const a of [posAttr, sizeAttr, alphaAttr, relAttr]) a.setUsage(THREE.DynamicDrawUsage);

  const uColor = uniform(new THREE.Color(color)), uSun = uniform(new THREE.Vector3(0, 1, 0));
  const mat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  const P = instancedBufferAttribute(posAttr), V = instancedBufferAttribute(relAttr), W = instancedBufferAttribute(sizeAttr);
  // the streak in view space: the drop now and blurS later, each put on the screen (x / depth), the difference taken
  // back to the drop's depth: the view-plane vector the drop sweeps over the exposure (a drop flying at the lens
  // sweeps outward, as on film)
  const p0 = modelViewMatrix.mul(vec4(P, 1)).xyz, p1 = modelViewMatrix.mul(vec4(P.add(V.mul(look.blurS)), 1)).xyz;
  const z0 = max(p0.z.negate(), 0.05), z1 = max(p1.z.negate(), 0.05);
  const d = p1.xy.div(z1).sub(p0.xy.div(z0)).mul(z0);
  const wDraw = min(W, z0.mul(look.capW));                                   // never wider than capW rad
  const sweep = min(d.length(), z0.mul(look.capL));                          // never longer than capL rad
  const len = sweep.add(wDraw);
  mat.positionNode = P;
  mat.scaleNode = vec2(len, wDraw);                                          // the sprite's x: along the motion
  mat.rotationNode = atan(d.y, d.x.add(1e-6));
  // the view's terms, per drop (vertex -> fragment): the near fade, the energy spread along the streak, the backlit glint
  const near = smoothstep(look.near[0], look.near[1], z0);
  const spread = min(1, max(look.minSpread, wDraw.mul(look.spread).div(len)));
  const fade = varying(near.mul(spread).mul(instancedBufferAttribute(alphaAttr)));
  const glint = varying(pow(max(dot(normalize(P.sub(cameraPosition)), uSun), 0), look.glintPow));
  // soft across the streak (a round falloff) and tapered at its ends: no hard edge anywhere
  const q = uv().sub(0.5).abs().mul(2);
  const across = float(1).sub(smoothstep(0, 1, q.y)), along = float(1).sub(smoothstep(0.35, 1, q.x));
  mat.colorNode = vec3(uColor).mul(float(look.amb).add(glint.mul(look.glint)));
  mat.opacityNode = across.mul(across).mul(along).mul(fade);
  const mesh = new THREE.Sprite(mat);
  mesh.count = count;
  mesh.frustumCulled = false;

  let next = 0, carry = 0, carrySlam = 0, carrySurf = 0, lastPitch = null;
  function update(state, wave = { heave: 0, pitch: 0 }, dt = 1 / 60) {
    const u = Math.max(state.u ?? 0, 0), h = state.heading;
    const fx = Math.sin(h), fz = -Math.cos(h), sx = -fz, sz = fx;
    const pitchRate = lastPitch === null ? 0 : (wave.pitch - lastPitch) / Math.max(dt, 1e-4);
    lastPitch = wave.pitch;
    const slam = Math.max(0, -pitchRate) * 6;                                // the bow dropping, rad/s → a boost
    // a 28 ft cruiser throws no visible spray in a breeze: droplets only from ~15 kn (7.7 m/s, more than it can sail),
    // or when the bow slams into chop (Design lead, whole-boat critique)
    const rate = 90 * Math.min(1, Math.max(0, (u - 7.7) / 1.5)) + 120 * Math.min(1, Math.max(0, slam - 2) / 4);   // per second
    const slamL = state.slam ?? 0, surfL = state.surf ?? 0;
    carry += rate * dt; carrySlam += SPRAY.slamRate * slamL * dt; carrySurf += SPRAY.surfRate * surfL * dt;
    const bowY = (wave.heave ?? 0) + Math.sin(wave.pitch ?? 0) * length * 0.42;
    // kind 0: the speed and pitch spray (as before); 1: a slam's sheet; 2: the surf's bow-wave sheet
    const emit = (kind) => {
      const i = next; next = (next + 1) % count;
      const side = rand() < 0.5 ? -1 : 1, f = length * (kind === 1 ? 0.40 + 0.06 * rand() : 0.36 + 0.08 * rand());
      const halfB = beam * 0.5 * 0.86 * Math.sqrt(1 - f / (length * 0.5)) + 0.1;   // the waterline half-breadth near the bow [est 0.86 × beam]
      pos[3 * i] = state.x + fx * f + sx * side * halfB;
      pos[3 * i + 1] = bowY + 0.1;
      pos[3 * i + 2] = state.z + fz * f + sz * side * halfB;
      let out, up, carryU;
      if (kind === 1) { out = (0.8 + 1.6 * rand()) * (0.6 + 0.4 * slamL); up = (SPRAY.slamUp[0] + SPRAY.slamUp[1] * rand()) * (0.7 + 0.3 * slamL); carryU = u; }   // a sheet thrown up off the bow, with the boat's own speed
      else if (kind === 2) { out = (1.5 + 1.5 * rand()) * Math.min(1.5, u / 3); up = (0.8 + 1.2 * rand()) * surfL; carryU = u * 0.6; }   // the bow wave's low white sheet
      else { out = (1.2 + 1.8 * rand()) * Math.min(1.5, u / 2.5); up = (1.5 + 2.0 * rand()) * Math.min(1.5, u / 2.5) * (1 + 0.5 * slam); carryU = u * 0.35; }
      vel[3 * i] = sx * side * out + fx * carryU;
      vel[3 * i + 1] = up;
      vel[3 * i + 2] = sz * side * out + fz * carryU;
      const L = kind === 1 ? SPRAY.slamLife : kind === 2 ? SPRAY.surfLife : [0.35, 0.3];
      age[i] = 0; life[i] = L[0] + L[1] * rand(); big[i] = kind === 1 ? SPRAY.slamSize : 1; kindOf[i] = kind;
      const wr = kind === 1 ? look.slamWidth : look.width; w0[i] = wr[0] + (wr[1] - wr[0]) * rLook(); a0[i] = 0.45 + 0.55 * rLook();
    };
    while (carry >= 1) { carry -= 1; emit(0); }
    while (carrySlam >= 1) { carrySlam -= 1; emit(1); }
    while (carrySurf >= 1) { carrySurf -= 1; emit(2); }
    // the air at deck height (world, m/s): the true wind blows FROM heading + trueWind.angle
    const tw = state.trueWind ?? { speed: 0, angle: 0 }, toDir = h + tw.angle + Math.PI, ws = tw.speed * SPRAY.deckWind;
    const wx = Math.sin(toDir) * ws, wz = -Math.cos(toDir) * ws, kd = 1 - Math.exp(-dt / SPRAY.dragS);
    const bvx = Math.sin(h) * u, bvz = -Math.cos(h) * u;   // the boat's own velocity (the camera rides it)
    for (let i = 0; i < count; i++) {
      age[i] += dt;
      const t = age[i] / life[i];
      if (t >= 1) { alpha[i] = 0; size[i] = 0; continue; }
      vel[3 * i + 1] -= 9.81 * dt;
      vel[3 * i] += (wx - vel[3 * i]) * kd; vel[3 * i + 2] += (wz - vel[3 * i + 2]) * kd; vel[3 * i + 1] *= 1 - 0.6 * dt;   // drag toward the wind
      for (let k = 0; k < 3; k++) pos[3 * i + k] += vel[3 * i + k] * dt;
      if (pos[3 * i + 1] < -0.05) { age[i] = life[i]; alpha[i] = 0; size[i] = 0; continue; }   // back in the water
      // a slam's sheet leaves the bow wide and breaks into fine drops over sheetT of its life; then thin streaks
      const sheet = kindOf[i] === 1 ? 1 + (look.sheetGrow - 1) * Math.max(0, 1 - t / look.sheetT) : 1;
      size[i] = w0[i] * sheet;
      alpha[i] = look.alpha * a0[i] * (1 - t) * Math.min(1, t * 10) / Math.sqrt(sheet);   // fading over the droplet's life; a sheet is thinner water
      rel[3 * i] = vel[3 * i] - bvx; rel[3 * i + 1] = vel[3 * i + 1]; rel[3 * i + 2] = vel[3 * i + 2] - bvz;
    }
    posAttr.needsUpdate = sizeAttr.needsUpdate = alphaAttr.needsUpdate = relAttr.needsUpdate = true;
  }

  // D2 (time of day): the droplets' colour × the light level (1 by day), from the colour the scene set (main.js sets
  // uColor after creating the spray, so the base is taken on the first call)
  let colorBase = null;
  const setLight = (light) => { colorBase ??= uColor.value.clone(); uColor.value.copy(colorBase).multiplyScalar(light); };
  mesh.userData.daylight = (f) => { setLight(f.light); if (f.sunDir) uSun.value.copy(f.sunDir).normalize(); };
  // the droplets in the air now, and their spread (for the probes and the thrill captures)
  const stats = () => { let n = 0, top = -Infinity; for (let i = 0; i < count; i++) if (alpha[i] > 0) { n++; top = Math.max(top, pos[3 * i + 1]); } return { alive: n, topY: n ? top : null }; };
  return { mesh, update, setLight, stats, uniforms: { uColor, uSun }, core: { pos, rel, size, alpha, age, life, big, count } };   // core: for the probes (tools/probe_helm_spray.mjs)
}
