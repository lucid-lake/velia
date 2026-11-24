// The fireworks engine (stage S1 and round 2): our own TSL compute fireworks on the three.js
// compute-particle pattern (MIT: instancedArray buffers, one compute node). No code from any fireworks simulator.
//
//   const fw = createFireworks({ renderer, camera, show: makeShow(seed), barges: [{ x, z, axis: [ax, az] }, …], scale: 2,
//                                wind: () => [vx, 0, vz], mrt: true })
//   scene.add(fw.group)
//   fw.seek(t)          the show at t s: cleared on the GPU, then the last seconds replayed on the fixed 1/60 s step
//   fw.update(dt)       live: one compute dispatch of dt (clamped), the shells due written, the smoke and the flash bank
//   fw.step(dt)         captures and films: fixed 1/60 s steps up to dt
//   fw.setExposure(e)   the frame's exposure: every light here is a screen level / exposure (it holds at any exposure)
//   fw.setShow(show)    another script (then seek)
//   fw.stats()          { t, live, peak, capacity, spawned, overflow, tier }
//
// The stars: one storage buffer set of `capacity` slots (7 vec4 a star, and HISTORY points with trails), one compute
// pass over all of them a frame (src/fireworks/physics.js starStep, line for line), one instanced draw: each star is a
// tapered ribbon through its last HISTORY points (the long exposure's streak) plus a round head with a drawn halo.
// Additive and HDR. With mrt (the post stage, the show's evening) the stars draw only into the scene pass's 'fireworks' target, and
// src/fireworks/composite.js adds them through a hue-keeping shoulder and reflects them through the water's waves; the
// flash bank (src/fireworks/light.js FW) lights the sky, the water, the land and the smoke. The CPU writes each shell's
// stars once, into a ring of slots, when its launch is near (birth times in the future wait on the GPU).
// Tiers: desktop; phone (half the stars, no trails); far (the horizon shows: a small pool, no trails, no smoke, no
// flash, drawn straight into the picture: no reflection).
import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, instancedArray, instanceIndex, uniform, attribute, varying, float, uint, vec3, vec4, mrt,
  cameraPosition, positionWorld, max, min, floor, fract, sin, dot, exp, smoothstep, mix, normalize, cross, length, select,
  mod, clamp, step, pow, vec2,
} from 'three/tsl';
import { STEP, G, fly, RISER_K } from '../../../src/fireworks/physics.js';
import { buildShell, riserStar, HISTORY, PALETTE, burstRadius, thinStars } from '../../../src/fireworks/shells.js';
import { shellLife } from '../../../src/fireworks/show.js';
import { flashSlots, flashOf, FLASH_SLOTS, GLOW } from '../../../src/fireworks/flash.js';
import { puffsFor, puffAt, SMOKE } from '../../../src/fireworks/smoke.js';
import { FW } from './light.js';
import { createDrawSpan, starEnd } from '../../../src/fireworks/drawSpan.js';

export const TIERS = {
  desktop: { capacity: 65536, trails: true, smoke: SMOKE.max, flash: true },
  phone: { capacity: 32768, trails: false, smoke: 96, flash: true },
  far: { capacity: 2048, trails: false, smoke: 0, flash: false },
};
// screen levels (× 1 / exposure in the scene): the photographer's look. smokeCover (fix/fireworks-sky-rect): how far out a
// puff covers the smoke drawn before it in the fireworks' target (its coverage: its own density profile × smokeCover, at most 1)
export const LOOK = { dying: 0.22, ember: 0.5, head: 1.15, trail: 0.85, vRef: 18, smoke: 6, smokeBase: 0.002, smokeM: 90, smokeCover: 30, headPx: 1.3, trailPx: 1.3, far: 2.6, farPx: 1.8 };
const PREROLL = 26;                     // s: the longest (a Niagara's 12 s drip + its life; a 12-inch willow)
const LOOKAHEAD = 0.5;                  // s: shells are written this far ahead of their launch
const DECK_Y = 2.5;                     // m: the barge's deck above the water

export function createFireworks({ renderer, camera, tier = 'desktop', show: show0, barges = [{ x: 0, z: 0, axis: [0, 1] }], waterY = 0, scale = 1,
  wind = () => [0, 0, 0], smoke = true, mrt: toTarget = false, bank: driveBank = true } = {}) {
  let show = show0;
  const T = TIERS[tier] ?? TIERS.desktop, N = T.capacity, trails = T.trails, H8 = HISTORY;
  const useSmoke = smoke && T.smoke > 0, useFlash = driveBank && T.flash;
  const P = instancedArray(N, 'vec4'), V = instancedArray(N, 'vec4'), C = instancedArray(N, 'vec4');
  const TR = instancedArray(N, 'vec4'), F = instancedArray(N, 'vec4'), K = instancedArray(N, 'vec4'), X = instancedArray(N, 'vec4');
  const H = trails ? instancedArray(N * H8, 'vec4') : null;
  const bufs = [P, V, C, TR, F, K, X];
  const arr = bufs.map((b) => b.value.array);
  for (let j = 0; j < N; j++) arr[0][j * 4 + 3] = 1e9;   // every slot dead (born far in the future)

  const uTime = uniform(0), uDt = uniform(STEP), uWind = uniform(new THREE.Vector3()), uG = uniform(G * scale);
  const uGain = uniform(1 / 2172), uPix = uniform(0.001);
  const uHead = uniform(LOOK.head * (tier === 'far' ? LOOK.far : 1)), uTrail = uniform(LOOK.trail);

  // --- the step: physics.js starStep, plus the kick and the history ring
  const kernel = Fn(() => {
    const i = instanceIndex;
    const p = P.element(i), v = V.element(i), c = C.element(i), f = F.element(i), kk = K.element(i);
    const born = p.w, burn = c.w, age = uTime.sub(born), dt = uDt;
    If(age.greaterThan(0).and(age.sub(dt).lessThan(burn)), () => {
      const h = min(dt, age).toVar();
      if (trails) {
        If(age.sub(dt).lessThanEqual(0), () => {
          Loop(H8, ({ i: j }) => { H.element(i.mul(H8).add(uint(j))).assign(vec4(p.xyz, born)); });
        });
      }
      const vel = v.xyz.toVar();
      const kickAge = kk.w;
      If(kickAge.greaterThan(0).and(age.greaterThanEqual(kickAge)).and(age.sub(h).lessThan(kickAge)), () => { vel.addAssign(kk.xyz); });
      const rel = vel.sub(uWind).toVar();
      rel.divAssign(float(1).add(v.w.mul(length(rel)).mul(h)));
      vel.assign(rel.add(uWind));
      vel.y.subAssign(uG.mul(h));
      const pos = p.xyz.add(vel.mul(h)).toVar();
      p.assign(vec4(pos, born));
      v.assign(vec4(vel, v.w));
      if (trails) {
        const I = f.y;
        const a0 = floor(age.sub(h).div(I)), a1 = floor(min(age, burn).div(I));
        If(a1.greaterThan(a0), () => { H.element(i.mul(H8).add(uint(mod(a1, H8)))).assign(vec4(pos, uTime)); });
      }
    });
  })().compute(N, [64]);
  // a seek's clear: every slot dead, on the GPU (a CPU upload of the whole buffer would race the shells' ranges)
  const clearKernel = Fn(() => { const p = P.element(instanceIndex); p.assign(vec4(p.xyz, 1e9)); })().compute(N, [64]);

  // --- the draw: one instanced mesh; per star a ribbon of HISTORY + 1 points (2 vertices each) and a 4-vertex head
  function geometry() {
    const g = new THREE.InstancedBufferGeometry();
    const info = [], idx = [];
    if (trails) {
      for (let j = 0; j <= H8; j++) info.push(j, -1, 0, j, 1, 0);
      for (let j = 0; j < H8; j++) { const a = 2 * j; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    const s0 = info.length / 3;
    info.push(-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1);
    idx.push(s0, s0 + 1, s0 + 2, s0, s0 + 2, s0 + 3);
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(info.length), 3));
    g.setAttribute('info', new THREE.Float32BufferAttribute(info, 3));
    g.setIndex(idx);
    g.instanceCount = 0;   // every slot dead: no draw till a spawn (B1: drawSpan.js; the warm-up still builds its pipeline)
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    return g;
  }
  const hash2 = (a, b) => fract(sin(dot(vec2(a, b), vec2(12.9898, 78.233))).mul(43758.5453));

  function starMaterial() {
    const i = instanceIndex, info = attribute('info', 'vec3');
    const j = info.x, side = info.y, kind = info.z;
    const p = P.element(i), c = C.element(i), tr = TR.element(i), f = F.element(i), kk = K.element(i), x = X.element(i);
    const born = p.w, burn = c.w, tau = tr.w, age = uTime.sub(born);
    const flick = f.x, interval = f.y, width = f.z, headPx = f.w, kickAge = kk.w, change = x.w;
    const bit = (b) => mod(floor(flick.div(b)), 2);
    const hiddenNow = bit(16).mul(step(age, kickAge));
    const live = step(0, age).mul(step(age, burn.add(tau.mul(3))));
    const headOn = step(0, age).mul(step(age, burn)).mul(float(1).sub(hiddenNow));
    const seed = fract(sin(float(i).mul(12.9898)).mul(43758.5453));
    const glit = mix(float(1), float(0.2).add(pow(hash2(float(i), floor(uTime.mul(24))), 3).mul(2.2)), bit(1));
    const strobe = mix(float(1), step(0.55, fract(uTime.mul(seed.mul(5).add(7)).add(seed))).mul(1.7), bit(2));
    const ramp = clamp(age.div(0.03), 0, 1), fade = float(1).sub(smoothstep(burn.mul(0.7), burn, age).mul(0.75));
    const pop = clamp(float(1).sub(age.sub(kickAge).div(max(burn.sub(kickAge), 0.01))), 0, 1).mul(3);
    // the burn-out (realism round): over the last DYING of its burn a star sputters (an uneven flicker at 30 Hz, its own
    // phase) and its flame warms toward an ember (a little of its colour turns orange), then goes out; never a flash
    const dying = smoothstep(burn.mul(1 - LOOK.dying), burn, age).mul(float(1).sub(bit(8)));
    const sputter = mix(float(1), float(0.25).add(hash2(float(i).mul(7.31), floor(uTime.mul(30)).add(seed.mul(11))).mul(1.3)), dying);
    const headI = headOn.mul(ramp).mul(mix(fade, pop, bit(8))).mul(glit).mul(strobe).mul(sputter);
    // a colour-changing star: col, then col2 from `change` s of its age
    const changed = (a) => step(0.001, change).mul(step(change, a));
    const flame = mix(c.rgb, x.rgb, changed(age));
    const ember = vec3(1.0, 0.42, 0.12).mul(max(flame.r, max(flame.g, flame.b)).mul(0.7));
    const headCol = mix(flame, ember, dying.mul(LOOK.ember));

    const centre = p.xyz;
    const toC = centre.sub(cameraPosition), dist = length(toC), vd = toC.div(dist);
    const right = normalize(cross(vd, vec3(0, 1, 0))), up = cross(right, vd);
    const half = headPx.mul(LOOK.headPx * 2).mul(uPix).mul(dist).mul(headOn);
    const headPos = centre.add(right.mul(j.mul(half))).add(up.mul(side.mul(half)));

    let pos = headPos, colour = headCol.mul(headI).mul(uHead);
    if (trails) {
      const lastIdx = floor(min(max(age, 0), burn).div(interval));
      const pt = (jj) => {
        const k = clamp(lastIdx.sub(jj).add(1), 0, lastIdx), hk = H.element(i.mul(H8).add(uint(mod(k, H8))));
        return select(jj.lessThan(0.5).and(headOn.greaterThan(0.5)), vec4(p.xyz, uTime), hk);
      };
      const q0 = pt(j), qb = pt(min(j.add(1), H8)), qa = q0;   // two reads a vertex (round 3: the budget)
      const p0 = q0.xyz, tan = normalize(qa.xyz.sub(qb.xyz).add(vec3(0, 1e-4, 0)));
      const d0 = length(p0.sub(cameraPosition)), view = p0.sub(cameraPosition).div(d0);
      const sideV = normalize(cross(tan, view));
      const u = j.div(H8);
      const w = max(width.mul(scale).mul(mix(float(1), float(0.35), u)), uPix.mul(d0).mul(LOOK.trailPx));
      const ribPos = p0.add(sideV.mul(w.mul(side)));
      const shown = select(bit(16).greaterThan(0.5), step(born.add(kickAge), q0.w), float(1));
      const sparkle = mix(float(1), float(0.3).add(hash2(float(i).mul(13).add(j), floor(uTime.mul(20))).mul(1.4)), bit(4));
      // a long exposure: a streak is as bright as the time the star spent on it (1 / its speed there)
      const speed = length(qa.xyz.sub(qb.xyz)).div(max(qa.w.sub(qb.w), 1e-3));
      const dwell = clamp(float(LOOK.vRef * scale).div(max(speed, 0.1)), 0.06, 2);
      const trailI = live.mul(shown).mul(exp(uTime.sub(q0.w).div(tau).negate())).mul(mix(float(1), float(0.35), u)).mul(sparkle).mul(dwell);
      const ptCol = mix(tr.rgb, x.rgb.mul(0.75), changed(q0.w.sub(born)));
      const isHead = kind.greaterThan(0.5);
      pos = select(isHead, headPos, ribPos);
      colour = select(isHead, colour, ptCol.mul(trailI).mul(uTrail));
    }
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
    // one pass for both faces (additive: the sum is the same in any order): a transparent double-sided material drew twice,
    // and the shader warm-up built its two side twins without the 'fireworks' target, a WGSL error ("structures must have
    // at least one member") on every live page once the show was on by default (S5; src/core/warmup.js sideTwins)
    m.forceSinglePass = true;
    m.positionNode = pos;
    const vCol = varying(colour.mul(uGain), 'vFwCol');
    const vInfo = varying(vec3(kind, j, side), 'vFwInfo');
    const r2 = vInfo.y.mul(vInfo.y).add(vInfo.z.mul(vInfo.z));
    const headProfile = exp(r2.mul(-14)).add(exp(r2.mul(-3)).mul(0.07)).mul(float(1).sub(smoothstep(0.75, 1, r2)));
    const ribProfile = float(1).sub(vInfo.z.mul(vInfo.z));
    const prof = select(vInfo.x.greaterThan(0.5), headProfile, ribProfile);
    const out = vec4(vCol.mul(prof), 1);
    m.colorNode = out;
    // the fireworks' own target (src/fireworks/composite.js adds it with a shoulder and reflects it); nothing in 'output'
    // fix/fireworks-sky-rect: the target blends by each material's own blending (src/core/post.js); normal blending with
    // alpha 1 keeps a star replacing what is under it there, as approved, and its 'output' (alpha 0) untouched
    if (toTarget) { m.mrtNode = mrt({ output: vec4(0), fireworks: out }); m.blending = THREE.NormalBlending; }
    return m;
  }

  const group = new THREE.Group(); group.name = `fireworks-${tier}`;
  // out of the water's reflection probe (src/water.js): with the 'fireworks' target the stars draw nothing in 'output', and
  // in the probe's plain target their shader had no output at all (a WGSL error on live pages; the post stage reflects them)
  if (toTarget) group.userData.probe = false;
  const geo = geometry();
  const mesh = new THREE.Mesh(geo, starMaterial());
  mesh.frustumCulled = false; mesh.renderOrder = 3; mesh.name = 'fireworks-stars';
  group.add(mesh);

  // --- the smoke: soft puffs (src/fireworks/smoke.js), one instanced draw, lit by the bank
  let smokeMesh = null, puffAttr = null, puffAttr2 = null;
  const puffs = [];
  if (useSmoke) {
    const M = T.smoke;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    puffAttr = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4); puffAttr.setUsage(THREE.DynamicDrawUsage);
    puffAttr2 = new THREE.InstancedBufferAttribute(new Float32Array(M * 4), 4); puffAttr2.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('puff', puffAttr); g.setAttribute('puff2', puffAttr2);
    g.instanceCount = 0;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    const pf = attribute('puff', 'vec4'), pf2 = attribute('puff2', 'vec4'), corner = attribute('position', 'vec3');
    const toC = pf.xyz.sub(cameraPosition), vd = normalize(toC);
    const right = normalize(cross(vd, vec3(0, 1, 0))), up = cross(right, vd);
    // additive: the smoke only glows where the bursts light it (a twilight sky through it is not darkened)
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, depthTest: true, fog: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    m.forceSinglePass = true;   // one pass, as the stars (additive)
    m.positionNode = pf.xyz.add(right.mul(corner.x.mul(pf.w))).add(up.mul(corner.y.mul(pf.w)));
    const vc = varying(vec4(corner.xy, pf2.x, pf2.y), 'vFwPuff');
    const r2 = vc.x.mul(vc.x).add(vc.y.mul(vc.y));
    const n = sin(vc.x.mul(5.1).add(vc.w.mul(40))).mul(sin(vc.y.mul(4.3).sub(vc.w.mul(23)))).mul(0.1).add(0.9);   // look round 1: 0.25 → 0.1 (lit, the sines showed as bands)
    const lit = Fn(() => {
      const L = vec3(0).toVar();
      Loop(FLASH_SLOTS, ({ i: k }) => {
        const bp = FW.bankPos.element(k), bc = FW.bankCol.element(k);
        const d = length(positionWorld.sub(bp.xyz)).div(LOOK.smokeM * scale);
        L.addAssign(bc.rgb.mul(bp.w.add(bc.w)).div(d.mul(d).add(1)));   // the flash and the burn after it (flash.js GLOW)
      });
      return L;
    })().mul(LOOK.smoke).add(LOOK.smokeBase);
    const dens = vc.z.mul(exp(r2.mul(-2.6))).mul(n).mul(max(float(1).sub(r2), 0).pow2());   // look round 1: to zero with no edge (lit, the 12 % rim drew rings and curtains)
    const smokeOut = vec4(lit.mul(uGain).mul(vec3(0.85, 0.88, 0.95)).mul(dens).mul(1.0), 1);
    m.colorNode = smokeOut;
    // look round 1: with the stars, in the fireworks' own target: over the clouds, bloomed, and mirrored in the water
    // fix/fireworks-sky-rect (owner: "a dark big rectangle in the sky behind the fireworks"): the target took no blending, so
    // each puff's whole quad replaced the smoke and glow under it and its edges cut straight dark lines through them. Now a
    // puff covers what is under it by its coverage (full in its core, as approved; to 0 at its rim), so no edge shows
    const cover = min(exp(r2.mul(-2.6)).mul(max(float(1).sub(r2), 0).pow2()).mul(LOOK.smokeCover), 1);
    if (toTarget) { m.mrtNode = mrt({ output: vec4(0), fireworks: vec4(smokeOut.rgb.div(max(cover, 1e-4)), cover) }); m.blending = THREE.NormalBlending; }
    smokeMesh = new THREE.Mesh(g, m);
    smokeMesh.frustumCulled = false; smokeMesh.renderOrder = 2; smokeMesh.name = 'fireworks-smoke';
    group.add(smokeMesh);
  }

  // --- the CPU side: the schedule, the ring of slots, the bursts' records
  const S = { t: 0, next: 0, cursor: 0, ranges: [], bursts: [], spawned: 0, overflow: 0, peak: 0, live: 0 };
  const burstCache = new Map();
  const span = createDrawSpan();   // the slots the draw covers (B1)
  const windNow = () => { const w = wind() ?? [0, 0, 0]; return [w[0], w[1] ?? 0, w[2]]; };
  const bargeOf = (e) => barges[e.barge % barges.length];
  // the mortar: on the barge's deck, jittered along its length (axis) and across it
  const mortarOf = (e) => {
    const b = bargeOf(e), ax = b.axis ?? [0, 1];
    return [b.x + (ax[0] * e.jitter[0] - ax[1] * e.jitter[1]) * scale, waterY + DECK_Y, b.z + (ax[1] * e.jitter[0] + ax[0] * e.jitter[1]) * scale];
  };
  const riserV = (e, v0) => [v0 * e.tilt[0] * scale, v0 * scale, v0 * e.tilt[1] * scale];
  function burstOf(e) {
    let b = burstCache.get(e.i);
    if (!b) {
      const m = mortarOf(e), col = PALETTE[e.colour] ?? PALETTE.gold;
      const r = e.ground ? { p: m, v: [0, 0, 0] } : fly(m, riserV(e, e.v0), RISER_K, e.rise, { wind: windNow(), scale });
      const fl = flashOf(e.type, e.inches);
      // round 3: the flash is the burst's own colour (no white)
      b = { pos: r.p, vel: r.v, burst: e.burst, colour: col.slice(), peak: fl.peak * (e.ground ? 0.4 : 1), tau: fl.tau };
      burstCache.set(e.i, b);
    }
    return b;
  }

  function alloc(n) {
    if (n > N) n = N;
    if (S.cursor + n > N) S.cursor = 0;
    const start = S.cursor, end = start + n;
    S.ranges = S.ranges.filter((r) => { const hit = r.start < end && r.end > start; if (hit && r.expiry > S.t) S.overflow++; return !hit; });
    S.cursor = end;
    return start;
  }
  function write(slot, s, born) {
    const o = slot * 4, [a0, a1, a2, a3, a4, a5, a6] = arr;
    a0[o] = s.p[0]; a0[o + 1] = s.p[1]; a0[o + 2] = s.p[2]; a0[o + 3] = born + (s.delay ?? 0);
    a1[o] = s.v[0]; a1[o + 1] = s.v[1]; a1[o + 2] = s.v[2]; a1[o + 3] = s.k;
    const br = s.bright ?? 1;   // the star's own brightness (realism round: no two stars alike)
    a2[o] = s.col[0] * br; a2[o + 1] = s.col[1] * br; a2[o + 2] = s.col[2] * br; a2[o + 3] = s.burn;
    a3[o] = s.trail[0] * br; a3[o + 1] = s.trail[1] * br; a3[o + 2] = s.trail[2] * br; a3[o + 3] = s.tau;
    a4[o] = s.flick + (s.hidden ? 16 : 0); a4[o + 1] = s.interval; a4[o + 2] = s.width; a4[o + 3] = s.headPx;
    a5[o] = s.kick[0]; a5[o + 1] = s.kick[1]; a5[o + 2] = s.kick[2]; a5[o + 3] = s.kickAge;
    const c2 = s.col2 ?? [0, 0, 0]; a6[o] = c2[0] * br; a6[o + 1] = c2[1] * br; a6[o + 2] = c2[2] * br; a6[o + 3] = s.change ?? 0;
    return starEnd(s, born);   // the last show time it draws anything
  }
  function spawn(e) {
    const b = bargeOf(e), ax = b.axis ?? [0, 1];
    const shell = buildShell(e.type, { inches: e.inches, colour: e.colour, colour2: e.colour2, seed: e.seed, tier: tier === 'far' ? 'phone' : tier, plane: [ax[0], 0, ax[1]], spread: e.spread ?? 1 });
    const bo = burstOf(e), m = mortarOf(e);
    const stars = tier === 'far' ? thinStars(shell.stars) : shell.stars;   // the horizon: a few dozen points, never a disc
    const n = stars.length + (e.ground ? 0 : 1), start = alloc(n);
    let k0 = start, until = -Infinity;
    if (!e.ground) until = write(k0++, { ...riserStar({ v0: 1, t: e.rise, k: RISER_K / scale, trunk: e.type === 'palm' }), p: m, v: riserV(e, bo.v0 ?? e.v0) }, e.t);
    let life = 0;
    stars.forEach((s, k) => {
      until = Math.max(until, write(k0 + k, {
        ...s, p: [bo.pos[0] + s.p[0] * scale, bo.pos[1] + s.p[1] * scale, bo.pos[2] + s.p[2] * scale],
        v: [bo.vel[0] + s.v[0] * scale, bo.vel[1] + s.v[1] * scale, bo.vel[2] + s.v[2] * scale],
        k: s.k / scale, kick: s.kick.map((x) => x * scale), headPx: s.headPx * (tier === 'far' ? LOOK.farPx : 1),
      }, e.burst));
      life = Math.max(life, s.delay + Math.max(s.burn, s.kickAge) + 3 * s.tau);
    });
    for (const buf of bufs) { buf.value.addUpdateRange(start * 4, n * 4); buf.value.needsUpdate = true; }
    S.ranges.push({ start, end: start + n, expiry: e.burst + life + 0.5, n, from: e.t });
    span.add(start, start + n, until);
    if (useFlash) S.bursts.push(bo);
    if (useSmoke && !e.ground && e.inches >= SMOKE.minInches) for (const pf of puffsFor(bo, { seed: e.seed, scale, tier, radius: burstRadius(e.inches) * (e.spread ?? 1) })) puffs.push(pf);
    S.spawned++;
  }
  function spawnDue(tEnd) {
    const ev = show.events;
    while (S.next < ev.length && ev[S.next].t <= tEnd) spawn(ev[S.next++]);
  }
  function setWind() { const w = windNow(); uWind.value.set(w[0] * scale, w[1] * scale, w[2] * scale); }
  function dispatch(dt) {
    S.t += dt;
    uTime.value = S.t; uDt.value = dt;
    renderer.compute(kernel);
  }
  const flashV = new THREE.Vector3();
  function after() {
    S.ranges = S.ranges.filter((r) => r.expiry > S.t - 1);
    S.live = 0; for (const r of S.ranges) if (S.t >= r.from && S.t <= r.expiry) S.live += r.n;
    S.peak = Math.max(S.peak, S.live);
    geo.instanceCount = span.count(S.t);   // B1: only the slots still drawing (0 between shows)
    if (useFlash) {
      S.bursts = S.bursts.filter((b) => S.t - b.burst < GLOW.maxS + 1);
      const slots = flashSlots(S.bursts, S.t);
      flashV.set(0, 0, 0);
      slots.forEach((s, k) => {
        FW.bankPos.array[k].set(s.pos[0], s.pos[1], s.pos[2], s.intensity); FW.bankCol.array[k].set(s.colour[0], s.colour[1], s.colour[2], s.glow);
        flashV.x += s.colour[0] * s.intensity; flashV.y += s.colour[1] * s.intensity; flashV.z += s.colour[2] * s.intensity;
      });
      FW.flash.value.copy(flashV);
      FW.time.value = S.t;
      const b0 = barges[0], cp = camera.position;
      FW.dist.value = Math.max(100, Math.hypot(b0.x - cp.x, b0.z - cp.z));
    }
    if (smokeMesh) {
      const w = windNow().map((x) => x * scale), a = puffAttr.array, b = puffAttr2.array, M = T.smoke;
      let n = 0;
      for (let k = puffs.length - 1; k >= 0 && n < M; k--) {
        const q = puffAt(puffs[k], S.t, w);
        if (!q) { if (S.t - puffs[k].born > SMOKE.life) puffs.splice(k, 1); continue; }
        a.set([q.pos[0], q.pos[1], q.pos[2], q.radius], n * 4); b.set([q.alpha, puffs[k].seed, 0, 0], n * 4); n++;
      }
      smokeMesh.geometry.instanceCount = n;
      puffAttr.needsUpdate = puffAttr2.needsUpdate = true;
    }
  }
  function updateView() {
    const h = renderer.domElement?.height || 720;
    uPix.value = (camera.fov * Math.PI / 180) / h;
  }
  // many dispatches in one go (a seek's replay): no GPU timestamps for them (the query pool holds 2048 a frame)
  function quiet(fn, on = true) {
    const be = renderer.backend, was = be?.trackTimestamp;
    if (on && be) be.trackTimestamp = false;
    try { fn(); } finally { if (on && be) be.trackTimestamp = was; }
  }

  function seek(t) {
    Object.assign(S, { cursor: 0, ranges: [], bursts: [], next: 0, peak: 0, live: 0 });
    span.reset();   // the clear below kills every slot
    puffs.length = 0;
    setWind();
    const ev = show.events;
    let t0 = t;
    for (const e of ev) if (e.t <= t && e.burst + shellLife(e.type, e.inches) > t) t0 = Math.min(t0, e.t);
    t0 = Math.floor(Math.max(t0, t - PREROLL) / STEP) * STEP - STEP;
    while (S.next < ev.length && ev[S.next].t < t0) S.next++;
    if (useSmoke) for (const e of ev) if (!e.ground && e.inches >= SMOKE.minInches && e.t < t0 && e.burst > t - SMOKE.life && e.burst <= t) for (const pf of puffsFor(burstOf(e), { seed: e.seed, scale, tier, radius: burstRadius(e.inches) * (e.spread ?? 1) })) puffs.push(pf);
    S.t = t0;
    const n = Math.round((t - t0) / STEP);
    quiet(() => {
      renderer.compute(clearKernel);
      for (let k = 0; k < n; k++) { spawnDue(S.t + STEP + LOOKAHEAD); dispatch(STEP); }
    });
    S.t = t; uTime.value = t;
    after(); updateView();
  }
  function update(dt) {
    dt = Math.min(Math.max(dt, 0), 1 / 20);
    setWind();
    spawnDue(S.t + dt + LOOKAHEAD);
    if (dt > 0) dispatch(dt);
    after(); updateView();
  }
  function stepFixed(dt) {
    setWind();
    const n = Math.max(1, Math.round(dt / STEP));
    quiet(() => { for (let k = 0; k < n; k++) { spawnDue(S.t + STEP + LOOKAHEAD); dispatch(STEP); } }, n > 1);
    after(); updateView();
  }
  return {
    group, mesh, smokeMesh, kernel, seek, update, step: stepFixed,
    setShow(s) { show = s; burstCache.clear(); },
    get show() { return show; },
    setExposure(e) { uGain.value = 1 / Math.max(e, 1e-6); if (useFlash) FW.gain.value = uGain.value; },
    uniforms: { time: uTime, gain: uGain, head: uHead, trail: uTrail, pix: uPix, wind: uWind },
    get time() { return S.t; },
    get active() { return S.live > 0 || puffs.length > 0; },   // stars or smoke in the air (the bloom runs only then)
    stats: () => ({ t: +S.t.toFixed(3), live: S.live, peak: S.peak, capacity: N, spawned: S.spawned, overflow: S.overflow, tier, trails, puffs: smokeMesh?.geometry.instanceCount ?? 0, drawn: geo.instanceCount }),
    dispose() { geo.dispose(); mesh.material.dispose(); smokeMesh?.geometry.dispose(); },
  };
}
