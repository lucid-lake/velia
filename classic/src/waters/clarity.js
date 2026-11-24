// Tahoe's clear water (wow/clarity, 2026-11-05): the lake bed seen down through the surface. The water shader
// (src/water.js, L1) already refracts the view at the surface, finds the bed on the depth map and absorbs the light per
// colour channel (red first: turquoise over sand, cobalt over depth). This file draws what it finds there:
//   - a bed that reads as Tahoe: pale granite sand with wave ripples, rounded granite boulders and cobbles (one jittered
//     candidate a cell per layer, so each pixel reads one cell: cheap), each lit by the refracted sun on its own normal,
//     with a contact shade on the sand and a cast shadow; a brown-green film on the rocks in the shallows;
//   - sun caustics: two drifting Worley nets (the light the wave lenses focus) on a moving warp (the per-pixel surface
//     slope scrambled their thin lines into speckle, so they do not read it), sharp in 1–4 m and fading by 16 m, with a mean of exactly 1 (no light is added, only gathered);
//   - the boat's shadow: the hull and both sails projected along the sun onto the water plane each frame (CPU,
//     clarity-optics.js boatShadow), then each bed point follows the refracted sun up and is tested against them.
// It is drawn only where the pixel resolves the bed (its footprint plus a rough surface's blur under NEAR_BLUR) and blends
// into water.js's L1 body past that, so the far water and the overlook keep their approved look to the pixel. The bed's
// image (not its mean light) dims with depth (clarity-optics.js IMAGE_SCATTER). ?clarity=0 draws L1 everywhere (the A/B).
//
//   const clarity = createClarity({ level })               // level: 'high' | 'balanced' | 'low' (the quality tier)
//   createWater({ features: [..., clarityWater(clarity)] })   // water.js calls clarity.body(...) in its body slot
//   clarity.track(() => phys.state)                        // the boat whose shadow falls on the bed (x, z, heading, boomAngle, jibAngle, heel)
import * as THREE from 'three/webgpu';
import { refract, Fn, If, uniform, vec2, vec3, float, exp, sqrt, max, min, clamp, mix, smoothstep, normalize, dot, fract, floor, sin, cos, step, length, dFdx, dFdy, mx_worley_noise_vec2, mx_noise_float, mx_noise_vec3 } from 'three/tsl';
import { BED, HULL, SAIL_SHADE, N_WATER, IMAGE_SCATTER, CAUSTIC_LINE, DIRECT_SHARE, boatShadow } from '../../../src/waters/clarity-optics.js';

export { DIRECT_SHARE };   // clarity-optics.js: the sun's direct share of the light on a level bed
// how much of the surface's slope the bed's detail is read through (1: all of it)
const WOBBLE = 0.06;
// the blur (m: the pixel's footprint plus a rough surface's) past which the bed is the L1 bed: the overlook and the far
// shallows keep their approved look (a boulder field's mean is darker than the L1 sand)
const NEAR_BLUR = 0.6;
// the caustic net's cell (m): the light the 0.5–2 m wavelets focus on a bed a few metres down
const CAUSTIC_CELL = 1.3;   // round 2: finer (was 1.8)
const CAUSTIC_GAIN = 0.3;   // round 2: half (0.6 read as a swimming pool)   // how far the net departs from its mean (1: the dark cells go black)

export function createClarity({ level = 'high', debug = null } = {}) {
  const FAR = 1e6, LOW = level === 'low';
  const uOn = uniform(0);
  const uHullC = uniform(new THREE.Vector2(FAR, FAR)), uHullF = uniform(new THREE.Vector2(0, -1));
  // each sail: three edge lines (nx, nz, c), the inside where nx·x + nz·z + c > 0 on all three
  const edges = () => [0, 1, 2].map(() => uniform(new THREE.Vector3(0, 0, -1)));
  const uMain = edges(), uJib = edges();
  let source = null;

  function setTri(U, tri) {
    const [a, b, c] = tri;
    const ccw = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0 ? 1 : -1;
    const pts = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const p = pts[i], q = pts[(i + 1) % 3], ex = q[0] - p[0], ez = q[1] - p[1], l = Math.hypot(ex, ez) || 1;
      // inward normal: for a counter-clockwise (in x, z) triangle, (−ez, ex)
      const nx = -ez / l * ccw, nz = ex / l * ccw;
      U[i].value.set(nx, nz, -(nx * p[0] + nz * p[1]));
    }
  }
  // each frame (water.update): the tracked boat's pose and the sun
  function update(sun) {
    const pose = source?.();
    if (!pose || !Number.isFinite(pose.x)) { uOn.value = 0; uHullC.value.set(FAR, FAR); return; }
    const s = boatShadow(pose, [sun.x, sun.y, sun.z]);
    uOn.value = s.on ? 1 : 0;
    uHullC.value.set(...s.hull.c); uHullF.value.set(...s.hull.f);
    setTri(uMain, s.main); setTri(uJib, s.jib);
  }

  const hash2 = (p) => fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))).mul(43758.5453));

  // one rounded-boulder layer at bed point p: { m (inside, soft), h (height, m), n (normal), tone, shade (cast + contact) }
  function layer(p, L, salt, density, sunU) {
    const id = floor(p.div(L.cell));
    const h1 = hash2(id.add(salt)), h2 = hash2(id.add(salt + 17.31));
    const r = mix(float(L.rMin), float(L.rMax), L.even ? h1.y : h1.y.mul(h1.y));   // cobbles: many small, a few big; boulders: even
    const pres = float(1).sub(step(density, h1.x));                              // 1 if this cell has one
    const room = max(float(L.cell * 0.5).sub(r), 0);
    const c = id.add(0.5).mul(L.cell).add(h2.sub(0.5).mul(2).mul(room));
    // not a disc: stretched one way, lumpy round its rim (a few metres of boulder field must not read as coins)
    const q0 = p.sub(c), st = mix(float(0.78), float(1.22), h2.y);
    const q1 = vec2(q0.x.mul(st), q0.y.div(st));
    const q = q1.add(vec2(sin(q1.y.div(r).mul(2.3).add(h1.x.mul(40))), sin(q1.x.div(r).mul(1.9).add(h2.x.mul(40)))).mul(r.mul(0.16)))
      .add(vec2(sin(q1.y.div(r).mul(5.1).add(h2.y.mul(30))), sin(q1.x.div(r).mul(4.7).add(h1.y.mul(30)))).mul(r.mul(0.07)));
    const rho2 = dot(q, q).div(r.mul(r));
    const inn = clamp(float(1).sub(rho2), 0, 1), sq = sqrt(inn);
    const m = smoothstep(1.0, 0.9, rho2).mul(pres);
    const a = r.mul(L.flat);                                                      // the dome's height
    const n = normalize(vec3(q.x, r.mul(sq).div(L.flat).add(1e-3), q.y));
    // the dome's cast shadow on the sand: a disk shifted away from the sun by ~0.6 of its height along the refracted sun
    const off = vec2(sunU.x, sunU.z).div(sunU.y).mul(a.mul(0.6));
    const qs = q.add(off), cast = smoothstep(1.0, 0.75, dot(qs, qs).div(r.mul(r))).mul(pres).mul(float(1).sub(m));
    const contact = smoothstep(2.4, 1.0, rho2).mul(pres).mul(float(1).sub(m));  // a soft dark ring where sand meets rock
    return { m, h: a.mul(sq).mul(pres), n, tone: h2.x, cast, contact };
  }

  // the water body's colour. legacy: water.js's L1 body (its bed, its absorption), drawn as it was wherever the pixel
  // can't resolve the bed's detail (the far shallows, the overlook: the approved look, the goldens), blended into this
  // bed near the camera. All inputs are TSL nodes from the water shader.
  function body({ legacy, vXZ, view, dBed, tDown, uSun, E, slope, time, footprint, sigma2, K, Bk }) {
    // the detail the pixel can resolve: its footprint, widened by the blur a rough surface gives a bed d m down
    const blur = footprint.add(dBed.mul(sqrt(sigma2)).mul(0.15));
    const wNear = float(1).sub(smoothstep(NEAR_BLUR * 0.3, NEAR_BLUR, blur)).mul(float(1).sub(smoothstep(18, 24, dBed)));
    const nearCol = Fn(() => {
      const col = vec3(0).toVar(), near = wNear.greaterThan(0);
      // sequential Ifs, not nested: one If holding the bed, the caustics and the shadow cost the High frame 2–3× more
      {
        // the light reaching the bed: the water's own E (the same total as the L1 body, so the mean look holds), split
        // into the sun's direct beam (about 3/4 of a clear day's light on a level bed with the sun up) and the sky's
        // diffuse part, both in E's colour. Only the direct part carries caustics, the rocks' shading and the boat's shadow.
        const fD = smoothstep(0.0, 0.35, uSun.y).mul(DIRECT_SHARE);
        const Esun = E.mul(fD), Esky = E.mul(float(1).sub(fD));
        // the bed point for the detail: the view refracted through a calmed normal (the slope × WOBBLE). The full normal
        // carries the sub-pixel ripples, and a bed a few metres down read through them scrambled every pixel into speckle;
        // the calmed one keeps the slow wobble of the waves.
        const bedAt = (k) => {
          const tr = refract(view.negate(), normalize(vec3(slope.x.mul(-k), 1, slope.y.mul(-k))), 1 / N_WATER);
          return vXZ.add(tr.xz.mul(dBed.div(max(tr.y.negate(), 0.05))));
        };
        const p = bedAt(WOBBLE), bedFlat = bedAt(0);
        const sunDownY = sqrt(max(float(1).sub(float(1).sub(uSun.y.mul(uSun.y)).div(N_WATER * N_WATER)), 0.01));
        const sunU = vec3(uSun.x.div(N_WATER), sunDownY, uSun.z.div(N_WATER));
        // the bed's image dims into the water's own light with the path up to the eye (forward scattering: Tahoe's fine
        // particles); its mean light still comes through (T below), so the hue still runs turquoise to cobalt
        const fade = exp(dBed.mul(-IMAGE_SCATTER).div(tDown));
        // the bed point's footprint (m) from its own screen derivatives (taken here, outside every If: WGSL needs uniform
        // control flow for them), the larger axis, so a grazing view's long footprint counts; plus a rough surface's blur
        const rippleFoot = max(length(dFdx(p)), length(dFdy(p))).add(dBed.mul(sqrt(sigma2)).mul(0.15)).toVar();
        const albedo = vec3(...BED.mean).toVar(), dirF = float(1).toVar(), amb = float(1).toVar(), dEff = dBed.toVar(), rockM = float(0).toVar();
        If(near, () => {
        // cheap shapes, not Perlin: 11 octaves of 3-D noise here cost the High frame ≈ 10 ms (now one octave, for the sand)
        const patch = smoothstep(0.25, 0.75, sin(p.x.mul(0.021).add(1.3)).mul(sin(p.y.mul(0.017).sub(0.4))).add(sin(p.x.add(p.y).mul(0.013).add(2.1))).mul(0.25).add(0.5));
        const B = BED.boulders, Cb = BED.cobbles;
        const dB = float(B.density).mul(patch.mul(0.5).add(0.5)).mul(float(1).sub(smoothstep(B.depthFull, B.depthNone, dBed)));
        const bo = layer(p, B, 3.7, dB, sunU);   // one cell a layer: rMax ≤ 0.4 cell (boulderFits)
        let co = null;
        if (!LOW) {
          const dC = float(0.5).mul(patch.mul(0.6).add(0.4)).mul(float(1).sub(smoothstep(Cb.depthFull, Cb.depthNone, dBed))).mul(float(1).sub(bo.m));
          co = layer(p, Cb, 11.9, dC.mul(float(1).sub(smoothstep(0.04, 0.12, blur))), sunU);
        }
        // sand: a tonal drift, and small wave ripples in patches in the wave-washed shallows. fix/bed-zebra (owner
        // 2026-11-06): one 0.6 m sine at a fixed angle, tilting the sunlit slope ±0.22, read as a "zebra" by the beaches
        // (35 % from crest to trough with a low sun). Now two sets (0.12 and 0.18 m) on a domain warp, so the crests bend,
        // branch and change spacing; one leads in each place; 9 % at most (clarity-optics.js rippleContrast); each fades
        // to its mean before the pixel can alias it (rippleAA, on the bed point's own screen derivatives); smooth sand
        // between the patches and past 3 m.
        const R = BED.ripples, dn = LOW ? null : mx_noise_float(vec3(p.mul(0.3), 7.7));
        const drift = LOW ? float(1) : dn.mul(0.12).add(1);
        const wq = p.mul(R.warpScale);
        const wn = LOW ? null : mx_noise_vec3(vec3(wq, 1.7));
        const warp = LOW ? vec2(sin(wq.y.mul(1.3).add(sin(wq.x.mul(0.7)).mul(1.4))), sin(wq.x.mul(1.1).sub(sin(wq.y.mul(0.9)).mul(1.4)))).mul(0.6) : wn.xy;
        const pw = p.add(warp.mul(R.warp));
        const d1 = vec2(0.8, 0.6), d2 = vec2(0.8 * Math.cos(R.turn) - 0.6 * Math.sin(R.turn), 0.8 * Math.sin(R.turn) + 0.6 * Math.cos(R.turn));
        const ph1 = dot(pw, d1).mul(2 * Math.PI / R.lambda[0]), ph2 = dot(pw, d2).mul(2 * Math.PI / R.lambda[1]).add(warp.y.mul(2.5));
        const aa = (lam) => float(1).sub(smoothstep(0.2 * lam, 0.45 * lam, rippleFoot));
        const aa1 = aa(R.lambda[0]), aa2 = aa(R.lambda[1]);
        // where they show: patches of the sand (phones: a cheap sine pattern), the shallows only; which set leads
        const patchR = LOW ? smoothstep(0.55, 0.85, sin(p.x.mul(0.31).add(sin(p.y.mul(0.23)).mul(1.7))).mul(sin(p.y.mul(0.27).sub(sin(p.x.mul(0.19)).mul(1.5)))).mul(0.5).add(0.5))
          : smoothstep(-0.05, 0.3, dn);
        const ampR = patchR.mul(float(1).sub(smoothstep(R.depthFull, R.depthNone, dBed)));
        const lead = LOW ? float(1) : smoothstep(-0.25, 0.25, wn.z);
        const hR = mix(sin(ph1).mul(aa1), sin(ph2).mul(aa2), lead).mul(ampR);   // −1 trough … 1 crest
        const gR = mix(d1.mul(cos(ph1).mul(aa1)), d2.mul(cos(ph2).mul(aa2)), lead).mul(ampR.mul(R.tilt));   // the slope
        const nSand = normalize(vec3(gR.x, 1, gR.y));
        const sandA = vec3(...BED.sand).mul(drift).mul(hR.mul(R.albedo).add(1));
        // rock: pale to grey granite, about one in five lichen-dark (blotched), a speckle, a light film on its top in the shallows
        const rockA = (L) => {
          const speck = sin(p.x.mul(7.3).add(L.tone.mul(20))).mul(sin(p.y.mul(6.1).sub(L.tone.mul(13)))).mul(float(0.12).mul(smoothstep(0.1, 0.03, blur))).add(1);
          const base = mix(vec3(...BED.granite), vec3(...BED.graniteDark), smoothstep(0, 0.78, L.tone));
          const blotch = sin(p.x.mul(1.7).add(L.tone.mul(31))).mul(sin(p.y.mul(1.3).sub(L.tone.mul(17)))).mul(0.25).add(0.85);
          // weathering: broad pale and grey patches on every rock (a flat tone read as a coin)
          const weather = sin(p.x.mul(2.1).add(L.tone.mul(23))).mul(sin(p.y.mul(1.8).sub(L.tone.mul(11)))).add(sin(p.x.add(p.y).mul(3.3))).mul(0.09).add(1);
          const dark = mix(base.mul(weather), vec3(...BED.lichen).mul(blotch), smoothstep(0.78, 0.82, L.tone)).mul(speck);
          return mix(dark, vec3(...BED.film), smoothstep(0.35, 0.95, L.n.y).mul(float(1).sub(smoothstep(1.5, 9, dBed))).mul(0.3));
        };
        let a = mix(sandA, rockA(bo), bo.m), nB = mix(nSand, bo.n, bo.m), hB = bo.h;
        let cast = bo.cast, contact = bo.contact, rm = bo.m;
        if (co) {
          a = mix(a, rockA(co), co.m); nB = mix(nB, co.n, co.m); hB = max(hB, co.h);
          cast = max(cast, co.cast); contact = max(contact, co.contact); rm = max(rm, co.m);
        }
        rockM.assign(rm);
        // a boulder (1–5 m across) is a big feature: it dims at half the rate of the bed's fine detail, as the boat's
        // shadow does (round 2: the boulders are what a player should see first)
        const fadeBig = sqrt(fade);
        albedo.assign(mix(vec3(...BED.mean), a, mix(fade, fadeBig, rm)));
        const nn = normalize(nB), lambert = max(dot(nn, sunU), 0).div(sunDownY);
        dirF.assign(mix(float(1), lambert.mul(float(1).sub(cast.mul(0.85))), fadeBig));
        // the sky light a rock's side sees: about half of a level bed's; the sand's ring at its foot darker still
        amb.assign(mix(float(1), float(1).sub(contact.mul(0.45)).mul(mix(float(1), nn.y.mul(0.65).add(0.35), rm)), fadeBig));
        dEff.assign(max(dBed.sub(hB.mul(fade)), 0.05));
        });
        // caustics: two Worley nets drifting across each other on a moving warp (phones: one net)
        const caust = float(1).toVar();
        If(near.and(dEff.lessThan(16)).and(uSun.y.greaterThan(0.03)), () => {
          const scale = float(1 / CAUSTIC_CELL);   // fixed: a depth-dependent scale times world coordinates (≈ 500 m) turned the depth map's per-pixel jitter into a shift of whole cells (speckle)
          const w = min(max(dEff.mul(0.012).add(0.08), blur.mul(scale).mul(3)), 0.5);   // its lines blur with depth, and widen to 3 pixels (thinner aliased into speckle)
          // read through a flat surface (any per-pixel slope jitters their thin lines into speckle), on a slow swirl
          const sw = vec2(sin(bedFlat.y.mul(0.37).add(time.mul(0.9))), sin(bedFlat.x.mul(0.41).sub(time.mul(0.7)))).mul(min(dEff, 6).mul(0.04));
          const cp0 = bedFlat.add(sw).mul(scale);
          // a domain warp in cell units: Worley's straight cell walls become the curved filaments real caustics have
          const cp = cp0.add(vec2(sin(cp0.y.mul(1.7).add(time.mul(0.5))), sin(cp0.x.mul(1.9).sub(time.mul(0.4)))).mul(0.22));
          // slow patterns over the bed: x where the caustics are strong, y which net's scale leads
          const vary = vec2(
            smoothstep(-0.4, 0.7, sin(bedFlat.x.mul(0.11).add(time.mul(0.03))).mul(sin(bedFlat.y.mul(0.09).sub(0.7))).add(sin(bedFlat.x.sub(bedFlat.y).mul(0.23).add(1.1)).mul(0.35))),
            smoothstep(-0.6, 0.6, sin(bedFlat.x.mul(0.07).add(bedFlat.y.mul(0.05)).add(2.3))));
          const line = (q) => { const f = mx_worley_noise_vec2(q); const e = sqrt(f.y).sub(sqrt(f.x)); return float(1).sub(smoothstep(0, w, e)); };
          const L = w.mul(CAUSTIC_LINE[0]).add(CAUSTIC_LINE[1]);   // a net's mean (clarity-optics.js causticLineMean)
          let c, mean;
          if (LOW) {   // phones: one 2-D net (9 cells, not 27) drifting on the warp
            c = line(cp.add(vec2(time.mul(0.21), time.mul(0.13)))); mean = L;
          } else {
            const l1 = line(cp.add(vec2(time.mul(0.11), time.mul(-0.07))));   // 2-D nets (9 cells; a 3-D one, 27, cost ≈ 4 ms): the warp above makes them dance
            const l2 = line(cp.mul(1.37).add(vec2(time.mul(-0.17), time.mul(0.23))).add(31.7));   // a 2-D net drifting across it
            // which net leads drifts across the bed (tens of metres), so the pattern's scale varies; the mean is the same either way
            c = mix(l1, l2, vary.y).add(l1.mul(l2).mul(1.5)); mean = L.add(L.mul(L).mul(1.5));
          }
          // round 2 (a real lake, not a pool): faint, patchy, soft by 3 m and gone by 8 m, weaker on dark rock and under a
          // rippled (windy) surface
          const strength = smoothstep(0.15, 0.9, dEff).mul(float(1).sub(smoothstep(3, 8, dEff)))
            .mul(smoothstep(0.03, 0.3, uSun.y)).mul(float(1).sub(smoothstep(0.3, 0.5, w))).mul(fade)
            .mul(mix(float(0.15), float(1), vary.x)).mul(float(1).sub(rockM.mul(0.5)))
            .mul(float(1).sub(smoothstep(0.05, 0.2, sqrt(sigma2)).mul(0.7))).mul(CAUSTIC_GAIN);
          caust.assign(mix(float(1), c.div(mean), strength));
        });
        // the boat's shadow: from the bed point, up along the refracted sun to the surface, against the hull and the sails
        const shadow = float(0).toVar();
        const surf = p.add(vec2(sunU.x, sunU.z).mul(dEff.div(sunDownY)));
        const dh = surf.sub(uHullC);
        If(near.and(uOn.greaterThan(0.5)).and(dot(dh, dh).lessThan(26 * 26)), () => {
          const soft = dEff.mul(0.05).add(0.1);
          const f = dot(dh, uHullF), s = dot(dh, vec2(uHullF.y.negate(), uHullF.x));
          const fn = f.div(HULL.halfL), taper = float(1).sub(max(fn, 0).mul(max(fn, 0)).mul(0.45));
          const sn = s.div(taper.mul(HULL.halfB));
          const hull = float(1).sub(smoothstep(soft.negate(), soft, sqrt(fn.mul(fn).add(sn.mul(sn))).sub(1).mul(HULL.halfB)));
          const tri = (U) => { const e = (u) => u.x.mul(surf.x).add(u.y.mul(surf.y)).add(u.z); return smoothstep(soft.negate(), soft, min(min(e(U[0]), e(U[1])), e(U[2]))); };
          shadow.assign(max(hull.mul(0.92), max(tri(uMain), tri(uJib)).mul(SAIL_SHADE)).mul(sqrt(fade)));   // a big shadow survives the scatter longer
        });
        const path = dEff.div(tDown).add(dEff.div(sunDownY));
        const T = exp(K.mul(path).negate());
        const Rinf = Bk.div(K.mul(2));
        const bedLight = Esky.mul(amb).add(Esun.mul(dirF).mul(caust).mul(float(1).sub(shadow)));
        if (debug === 'bed') col.assign(vec3(shadow, caust.mul(0.5), dirF.mul(0.5)).mul(0.05));   // ?cdebug=bed: r boat shadow, g caustics/2, b direct/2
        else col.assign(bedLight.mul(albedo).mul(T).add(E.mul(Rinf).mul(float(1).sub(T))));
      }
      return col;
    })();
    return debug === 'near' ? vec3(wNear).mul(0.05) : mix(legacy, nearCol, wNear);   // ?cdebug=near: where this bed is drawn
  }

  return { body, update, track: (fn) => { source = fn; }, level, uniforms: { uOn, uHullC, uHullF, uMain, uJib } };
}

// the clear bed as a water feature (src/waters/features.js slot body; src/core/world.js lists it unless ?clarity=0): it
// draws the body near the camera and keeps water.js's L1 body (in) past NEAR_BLUR; its frame tracks the boat's shadow.
// water.clarity is its api (the createClarity object: track(() => pose))
export function clarityWater(clarity) {
  return {
    id: 'clarity',
    body: { colour: (legacy, c) => clarity.body({ legacy, vXZ: c.world.xz, view: c.view, dBed: c.dBed, tDown: c.tDown, uSun: c.sun, E: c.E, slope: vec2(c.sx, c.sz), time: c.time, footprint: c.footprint, sigma2: c.sigma2, K: c.K, Bk: c.Bk }) },
    update: (t, { sun }) => clarity.update(sun),
    api: clarity,
  };
}
