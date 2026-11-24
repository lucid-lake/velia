// M10 (rebuilt 2026-10-29): the wake, in two GPU maps the water samples.
//
// 1. The KELVIN MAP: a boat-centred RGBA16F texture (512² over 128 m, 0.25 m a texel) holding the wave height (r, m)
//    and its slope (g, b: ∂h/∂x, ∂h/∂z, world axes). It is recomputed from scratch every frame as the sum of
//    Cauchy–Poisson impulses along the boat's recorded track: every TRAIL_DT s the boat leaves one impulse at the
//    bow (a pressure crest, +) and one at the stern (a trough, −); each spreads as the deep-water point impulse
//    does, η ∝ (τ/r²)·cos(gτ²/4r) with local wavenumber k = gτ²/4r² (Lamb §255; Lighthill, Waves in Fluids §3.8).
//    The stationary phase of that sum IS the Kelvin pattern: the transverse waves at λ = 2πU²/g, the divergent crests,
//    the 19.47° arms where the two meet, bow–stern interference (the hull-speed humps), all from a straight track;
//    and a curved or slowing track gives the bent, chirped wake a real boat leaves. The hull's finite width is a
//    short-wave cutoff exp(−k·rc) (rc ≈ 0.8 m): a pressure patch, not a point.
// 2. The FOAM MAP: world space, following the boat in whole texels (512² over 256 m, 0.5 m a texel): r = foam
//    strength 0..1 (set to 1 by the transom's swept segment, a bow band along the hull; decays with age over
//    FOAM_S), g = disturbed water (rougher, darker; lasts ROUGH_S). foamVisible() breaks the strip up as it ages:
//    streaky noise along the track thresholded by the strength, so it is a solid white strip at the transom, lanes
//    by 20 m and specks by 40 m, as a real transom wake does.
//
//   const wake = createWake();                     // defaults: the Catalina 28 (dims.js)
//   createWater({ ..., wake })                    // the water samples: kelvinAt(xz) {height, slope, foam}, mapAt(xz)
//   each frame, before rendering: wake.update(renderer, state, dt)   (the physics STATE: x, z, heading rad, u m/s)
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, uniformArray, texture, uv, vec2, vec3, vec4, float, max, min, clamp, exp, smoothstep, length as vlen, dot,
  abs, sin, cos, sqrt, select, Loop, mx_noise_float,
} from 'three/tsl';

import { DEFAULT_DIMS } from '../../../src/sim/boat/dims.js';
import { G, KELVIN_DEG, TRAIL_DT, TRAIL_N, transverseWavelength, kelvinDirections, impulseK, impulsePhase, wakeHeightCPU } from '../../../src/sim/boat/wakePhysics.js';

// the Kelvin laws and the impulse sum (plain functions, for tests and the CPU) are the shared sim's
export { G, KELVIN_DEG, TRAIL_DT, TRAIL_N, transverseWavelength, kelvinDirections, impulseK, impulsePhase, wakeHeightCPU };

const KELVIN_SIZE = 512, KELVIN_EXTENT = 128;   // the Kelvin map: px, m
const FOAM_S = 6, ROUGH_S = 14;                 // s: foam e-folding (white for ≈ 4 m, streaks to ≈ 12 m; the slick lasts 14 s)
const BWL = 0.86;   // waterline beam / max beam [est: unpublished for the C28; typical for a cruiser of this shape]

export function createWake({ dims = DEFAULT_DIMS, length = dims.HULL.lwl, beam = dims.HULL.beam,   // the boat's dims; the waterline length: the transom and bow at ±LWL/2
   size = 512, extentM = 256, foamS = FOAM_S, roughS = ROUGH_S, trailN = TRAIL_N, kelvinSize = KELVIN_SIZE } = {}) {
  const make = (s) => new THREE.RenderTarget(s, s, { type: THREE.HalfFloatType, depthBuffer: false });
  let src = make(size), dst = make(size);
  const kelvinRT = make(kelvinSize);

  // --- the track: a ring of impulses (x, z, t_emit, amplitude) and the heading at each (fx, fz, U, 0) -----------
  const trail = Array.from({ length: trailN }, () => new THREE.Vector4(0, 0, -1e9, 0));
  const trailDir = Array.from({ length: trailN }, () => new THREE.Vector4(0, -1, 0, 0));
  const uTrail = uniformArray(trail, 'vec4'), uTrailDir = uniformArray(trailDir, 'vec4');
  const uT = uniform(0), uKCentre = uniform(new THREE.Vector2());
  // amp 1.0: the transverse crests ≈ 16 cm high one length behind the transom at 3 m/s (wakeHeightCPU), the upper
  // end of what a 28-footer at 6 kn leaves (no published figure); the shading shows little under that
  const uRc = uniform(0.8), uAmp = uniform(1.0), uR0 = uniform(0.6), uBowGain = uniform(1.0);
  let trailHead = 0, trailClock = 0, tNow = 0;

  // the Kelvin pass: every texel sums the impulses within reach (kelvinSize², 2·trailN sources a texel)
  const kelvinStep = Fn(() => {
    const w = uKCentre.add(uv().sub(0.5).mul(KELVIN_EXTENT));
    const h = float(0).toVar(), sx = float(0).toVar(), sz = float(0).toVar();
    Loop(trailN, ({ i }) => {
      const e = uTrail.element(i), d = uTrailDir.element(i);
      const tau = uT.sub(e.z);
      const live = tau.greaterThan(0.02).and(e.w.greaterThan(0));
      const base = select(live, e.w.mul(tau).mul(TRAIL_DT), float(0));
      // two sources per impulse: the stern (a trough, −) at the recorded point, the bow (a crest, +) one hull ahead
      const stern = e.xy, bow = e.xy.add(d.xy.mul(length));
      const g4 = tau.mul(tau).mul(G * 0.25);
      for (const [pos, sgn] of [[stern, -1], [bow, 1]]) {
        const rv = w.sub(pos), r2 = dot(rv, rv).add(uR0.mul(uR0)), r = sqrt(r2);
        const k = g4.div(r2), ph = k.mul(r);
        const env = base.mul(sgn > 0 ? uBowGain : float(1)).mul(sgn).div(r2).mul(exp(k.negate().mul(uRc)));
        h.addAssign(env.mul(cos(ph)));
        // ∂/∂r of env·cos(gτ²/4r): the phase term dominates (dφ/dr = −k); the envelope's own slope is dropped
        const ds = env.mul(sin(ph)).mul(k).div(r);
        sx.addAssign(ds.mul(rv.x)); sz.addAssign(ds.mul(rv.y));
      }
    });
    return vec4(h, sx, sz, 1);
  });
  const kelvinMat = new THREE.NodeMaterial();
  kelvinMat.fragmentNode = kelvinStep();
  const kelvinQuad = new THREE.QuadMesh(kelvinMat);
  const kelvinRead = texture(kelvinRT.texture);

  // --- the foam map pass ------------------------------------------------------------------------------------
  const uCentre = uniform(new THREE.Vector2()), uPrevCentre = uniform(new THREE.Vector2());
  const uStern0 = uniform(new THREE.Vector2()), uStern1 = uniform(new THREE.Vector2());
  const uBow = uniform(new THREE.Vector2()), uFwd = uniform(new THREE.Vector2(0, -1));
  const uSpeed = uniform(0), uDt = uniform(1 / 60);
  // the prop's wash (feat/engine-anchor): the churn behind the transom under power (|thrust| / bollard pull, 0..1)
  // and where it boils: a disc aft of the transom going ahead, under the quarter going astern (the wash runs forward)
  const uProp = uniform(0), uPropAt = uniform(new THREE.Vector2());
  const prev = texture(src.texture);

  // distance from p to the segment a–b
  const segDist = (p, a, b) => {
    const ab = b.sub(a), t = clamp(dot(p.sub(a), ab).div(max(dot(ab, ab), 1e-6)), 0, 1);
    return vlen(p.sub(a.add(ab.mul(t))));
  };

  const step = Fn(() => {
    const w = uCentre.add(uv().sub(0.5).mul(extentM));                     // this texel's world xz
    const puv = w.sub(uPrevCentre).div(extentM).add(0.5);                 // where it was last frame
    const inside = puv.x.greaterThan(0).and(puv.x.lessThan(1)).and(puv.y.greaterThan(0)).and(puv.y.lessThan(1));
    const d = float(1 / size);
    // a light 5-tap spread: the strip widens a little with age (σ ≈ 1 m over its life), its edge goes soft
    const old = prev.sample(puv).mul(0.988)
      .add(prev.sample(puv.add(vec2(d, 0))).mul(0.003)).add(prev.sample(puv.sub(vec2(d, 0))).mul(0.003))
      .add(prev.sample(puv.add(vec2(0, d))).mul(0.003)).add(prev.sample(puv.sub(vec2(0, d))).mul(0.003));
    const kept = select(inside, old, vec4(0));
    const foam = kept.r.mul(exp(uDt.negate().div(foamS))), rough = kept.g.mul(exp(uDt.negate().div(roughS)));

    // stamps, scaled by speed (nothing at rest, full by ~3 m/s ≈ 6 kn) and by the time step (frame-rate independent)
    const go = smoothstep(0.6, 3.0, uSpeed), rate = uDt.mul(1.2);
    const ds = segDist(w, uStern0, uStern1);                               // the transom's swept segment
    const stern = float(1).sub(smoothstep(beam * 0.28, beam * 0.40, ds));  // ≈ the transom's width (0.8 beam)
    // the bow wave along the hull: from the bow aft to mid-length, a band just off each side
    const rel = w.sub(uBow), along = dot(rel, uFwd).negate(), side = abs(dot(rel, vec2(uFwd.y.negate(), uFwd.x)));
    const hullHalf = clamp(along.div(length * 0.5), 0, 1).sqrt().mul(beam * 0.5 * BWL);   // the waterline half-breadth
    const bowBand = smoothstep(-0.1, 0.2, side.sub(hullHalf)).mul(float(1).sub(smoothstep(0.3, 0.8, side.sub(hullHalf))))
      .mul(smoothstep(-0.5, 0.5, along)).mul(float(1).sub(smoothstep(length * 0.4, length * 0.7, along)));
    const prop = float(1).sub(smoothstep(0.5, 1.4, vlen(w.sub(uPropAt)))).mul(uProp);
    const sternFoam = max(stern.mul(go), prop.mul(0.55)), sternRough = max(stern.mul(go), prop);
    const bowFoam = foam.add(bowBand.mul(0.5).mul(go).mul(rate)), bowRough = rough.add(bowBand.mul(go).mul(rate).mul(1.5));
    return vec4(min(max(bowFoam, sternFoam), 1), min(max(bowRough, sternRough), 1), 0, 1);
  });

  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = step();
  const quad = new THREE.QuadMesh(mat);
  const read = texture(dst.texture);   // what the water samples (swapped to the newest each frame)

  let last = null;
  function pushImpulse(x, z, fx, fz, speed) {
    // the impulse's strength: the hull's pressure field scales with U² (and so does its wake); nothing under 0.6 m/s
    const amp = uAmp.value * Math.pow(Math.max(speed, 0) / 3, 2) * (speed > 0.6 ? 1 : 0);
    trail[trailHead].set(x - fx * length * 0.5, z - fz * length * 0.5, tNow, amp);   // the stern
    trailDir[trailHead].set(fx, fz, speed, 0);
    trailHead = (trailHead + 1) % trailN;
  }
  function update(renderer, state, dt) {
    const { x, z, heading, u } = state;
    const speed = Math.max(u ?? 0, 0), fx = Math.sin(heading), fz = -Math.cos(heading);
    dt = Math.max(dt, 1e-4);
    tNow += dt; trailClock += dt;
    if (trailClock >= TRAIL_DT) { trailClock -= TRAIL_DT; pushImpulse(x, z, fx, fz, speed); }
    uT.value = tNow; uKCentre.value.set(x, z);
    const stern = [x - fx * length * 0.5, z - fz * length * 0.5], bow = [x + fx * length * 0.5, z + fz * length * 0.5];
    // the foam map moves in whole texels: a fractional scroll made every frame's resample a small bilinear blur,
    // which over the trail's lifetime smeared it ≈ 7 m sideways into a filled cone
    const cell = extentM / size, centre = new THREE.Vector2(Math.round(x / cell) * cell, Math.round(z / cell) * cell);
    uPrevCentre.value.copy(last ? last.centre : centre);
    uCentre.value.copy(centre);
    uStern0.value.set(...(last ? last.stern : stern)); uStern1.value.set(...stern);
    uBow.value.set(...bow); uFwd.value.set(fx, fz);
    uSpeed.value = speed; uDt.value = dt;
    // the prop's wash: 1.2 m aft of the transom ahead, 1.5 m forward of it astern
    const churn = Math.min(1, Math.abs(state.thrust ?? 0) / 1450) * ((state.engineRpm ?? 0) > 0 ? 1 : 0), aft = (state.thrust ?? 0) >= 0 ? 1.2 : -1.5;
    uProp.value = churn > 0.02 ? 0.25 + 0.75 * churn : 0; uPropAt.value.set(stern[0] - fx * aft, stern[1] - fz * aft);
    prev.value = src.texture;
    const was = renderer.getRenderTarget(), mrt = renderer.getMRT();
    renderer.setMRT(null);
    try {   // a GPU call that throws (a dead device, fix/first-load) leaves the renderer's target as it was
      renderer.setRenderTarget(kelvinRT);
      kelvinQuad.render(renderer);
      renderer.setRenderTarget(dst);
      quad.render(renderer);
    } finally { renderer.setRenderTarget(was); renderer.setMRT(mrt); }
    read.value = dst.texture;
    [src, dst] = [dst, src];
    last = { centre, stern };
    boat.x = x; boat.z = z; boat.fx = fx; boat.fz = fz; boat.speed = speed;
    uBoat.value.set(x, z); uBoatFwd.value.set(fx, fz); uBoatSpeed.value = speed;
  }
  const boat = { x: 0, z: 0, fx: 0, fz: -1, speed: 0 };
  const uBoat = uniform(new THREE.Vector2()), uBoatFwd = uniform(new THREE.Vector2(0, -1)), uBoatSpeed = uniform(0);

  // the foam map at a world point: { foam, rough } (0 outside the map)
  const mapAt = (xz) => {
    const m = read.sample(xz.sub(uCentre).div(extentM).add(0.5));
    const edge = clamp(float(1).sub(vlen(xz.sub(uCentre)).div(extentM * 0.5)), 0, 1).mul(8).min(1);   // fade at the rim
    return { foam: m.r.mul(edge), rough: m.g.mul(edge) };
  };

  // the strip as the eye sees it: foam gathers in lanes along the track and breaks into specks as it ages. Streaky
  // noise (0.6 m across, 4 m along) plus a fine speckle, thresholded by the strength: solid at 1, ≈ 60 % lanes at
  // 0.6, ≈ 10 % specks at 0.3, nothing under 0.15. `churn` (the water's own small slopes, 0..1) gathers it a little.
  const foamVisible = (xz, foam, t, churn = float(0.5)) => {
    const fwd = uBoatFwd, along = dot(xz, fwd), across = dot(xz, vec2(fwd.y.negate(), fwd.x));
    // 2-D gradient noise (one octave each; 3-D fractal noise per water pixel blew the budget, 2026-10-29)
    const lanes = mx_noise_float(vec2(across.mul(1.6).add(t.mul(0.05)), along.mul(0.14)));   // ≈ 0.6 m × 7 m streaks
    const speck = mx_noise_float(vec2(xz.x.mul(3.0).add(t.mul(0.2)), xz.y.mul(3.0)));
    const n = lanes.mul(1.3).add(speck.mul(0.4)).add(churn.sub(0.5).mul(0.3));
    // white only in the first metres (strength > 0.8 ≈ 2 s ≈ 6 m at 6 kn), streaks to ≈ 0.55 (≈ 15 m), then nothing:
    // past that the trail is a slick, not foam (integrator, 2026-10-29: the painted tongue)
    // the noise bites from the transom on: ≈ 75 % cover at strength 1 (churned foam with dark water between), 50 %
    // at 0.85, 25 % at 0.7, lace by 0.6; the edges are ragged everywhere, never a straight-sided tongue
    // the churn between the bubbles reuses the speckle tap (no second noise: the bench allowance is +0.5 ms)
    return smoothstep(0.1, 0.6, n.mul(1.6).add(foam.mul(3.0)).sub(2.6)).mul(smoothstep(0.45, 0.6, foam))
      .mul(smoothstep(-0.6, 0.6, speck).mul(0.5).add(0.5));
  };

  // the slick: where the trail's disturbed water damps the wind ripples (0..1), its edge torn by noise along the track
  // so it is a ragged calm band the following waves cross, never a straight-edged tongue
  const slickAt = (xz, rough, t) => {
    const fwd = uBoatFwd, along = dot(xz, fwd), across = dot(xz, vec2(fwd.y.negate(), fwd.x));
    const edge = mx_noise_float(vec2(across.mul(0.9).add(t.mul(0.03)), along.mul(0.3)));
    return smoothstep(0.12, 0.6, rough.add(edge.mul(0.25)));
  };

  // the Kelvin map at a world point: height (m), slope (∂h/∂x, ∂h/∂z), and the bow wave's white roll
  const kelvinAt = (xz) => {
    const kuv = xz.sub(uKCentre).div(KELVIN_EXTENT).add(0.5);
    const edge = clamp(float(1).sub(vlen(xz.sub(uKCentre)).div(KELVIN_EXTENT * 0.5)), 0, 1).mul(6).min(1);   // fade at the rim
    const m = kelvinRead.sample(kuv).mul(edge);
    // the bow wave's break: a low white roll hugging the waterline from the stem to ≈ 35 % of the length, thickest
    // forward; from ≈ 2.5 kn, full by ≈ 6 kn (a 28-footer throws a small, clean bow wave in a breeze)
    const rel = xz.sub(uBoat.add(uBoatFwd.mul(length * 0.5)));             // from the bow
    const a = dot(rel, uBoatFwd).negate();                                 // distance aft of the bow, m
    const c = dot(rel, vec2(uBoatFwd.y.negate(), uBoatFwd.x));            // to starboard, m
    const hb = clamp(a.div(length * 0.5), 0, 1).sqrt().mul(beam * 0.5 * BWL);         // waterline half-breadth here
    const off = abs(c).sub(hb);
    const roll = smoothstep(-0.2, 0.05, off).mul(float(1).sub(smoothstep(0.1, float(0.6).sub(a.div(length)).max(0.2), off)));
    const bowWave = roll.mul(smoothstep(-0.3, 0.3, a)).mul(float(1).sub(smoothstep(length * 0.2, length * 0.4, a)))
      .mul(smoothstep(1.3, 3.0, uBoatSpeed)).mul(0.6);
    return { height: m.r, slope: m.gb, foam: bowWave, debug: abs(m.r).mul(4) };
  };

  return {
    update, mapAt, kelvinAt, foamVisible, slickAt, extentM, size, kelvinSize, trailN, textures: () => [src, dst, kelvinRT],
    uniforms: { uRc, uAmp, uR0, uBowGain },   // tuning knobs (?wake_rc=, ?wake_amp= in the daysail mode)
    trail: () => ({ trail, trailDir, head: trailHead, t: tNow }),
  };
}
