// The boat's wake (v2): the track of impulses v1's wake leaves (src/boat/wake.js update + pushImpulse), on the shared
// sim's physics (src/sim/boat/wakePhysics.js: the Kelvin laws, TRAIL_DT, TRAIL_N, the CPU impulse sum), packed for the
// GPU, plus the JS twins of what v2's two wake maps compute from it (render/wake.js). Pure: node runs it (tests).
//
// v1 keeps two GPU maps: the Kelvin map (recomputed every frame from the track: the Cauchy–Poisson impulses, a bow crest
// and a stern trough every 0.25 s) and a FOAM MAP that feeds back on itself (stamped at the transom and along the bow,
// decayed and blurred every frame). v2 keeps the first as v1 has it and computes the second from the same track
// instead: every 0.25 s point of the transom's path carries its age, so the strip's strength at a point is the decay
// of the nearest segment's age across v1's strip, a band blurred by a Gaussian that widens as v1's 5-tap blur does
// (σ² ≈ 0.09 m²/s); the band and its edge were fitted to v1's own foam map, read back from its GPU (below).
// The result is v1's strip with no history: a capture's 20 s settle needs no 1,200 GPU passes, nothing smears as
// the map scrolls, and a frame is the same frame at any frame rate.
//
//   const wake = createWakeTrack({ length, beam });       // the boat's dims (the waterline length: bow and stern ±L/2)
//   new BoatOnWater({ water, wake, … })                   // the shared ride calls wake.update(renderer, state, dt)
//   wake.pack(out)                                        // → the GPU's points (newest first), relative to the boat
import { G, TRAIL_DT, TRAIL_N } from '../../src/sim/boat/wakePhysics.js';

// v1's numbers (src/boat/wake.js): the foam's and the slick's e-folding (s), the waterline beam over the max beam, the
// impulse knobs (amp 1: 16 cm transverse crests one length behind at 3 m/s; rc the hull's short-wave cutoff; r0 the
// near-field softening; the bow source's gain), the Kelvin map's extent (m)
export const WAKE = Object.freeze({
  foamS: 6, roughS: 14, bwl: 0.86, amp: 1.0, rc: 0.8, r0: 0.6, bowGain: 1.0,
  kelvinExtentM: 128, foamExtentM: 256,
  // v1's 5-tap blur: 1.2 % of a 0.5 m texel's strength to its 4 neighbours every 1/60 s frame → σ² grows 0.09 m²/s
  spreadM2s: 0.09,
  // the strip's profile: a band of half-width core × the beam, its edge a Gaussian of σ² = edgeM² + spread × age. Fitted
  // to v1's foam map read back from its GPU (the Sail start at 13:00, level-2 wind, 20 s settled, 2.95 m/s: along the
  // track 1.00 / 0.92 / 0.81 / 0.73 / 0.51 / 0.26 at 0.5 / 2 / 4 / 6 / 10 / 15 m, the 6 s decay; across it 5 m aft 0.75 /
  // 0.59 / 0.25 / 0.055 / 0.013 at 0 / 0.5 / 1 / 1.5 / 2.5 m, the slick the same shape at the 14 s decay). The fit:
  // foam half-width 0.27 B (0.85 m), the slick's 0.35 B (1.1 m: v1's bow band widens its rough water), edge 0.2 m. v1's bow band leaves nothing behind the transom in that map (0.055 at
  // 1.5–2 m), so v2 draws none either
  core: 0.27, roughCore: 0.35, edgeM: 0.2,
  // a segment longer than this is a jump (a reset, a teleport), not a track
  maxSegM: 12,
});
// sizes (texels): the desktop's Kelvin map at 0.5 m (the transverse waves at 6 kn are 5.8 m, the divergent ones past
// the hull's cutoff ≥ 2.5 m: 5 texels a wave) and the foam map at 0.5 m (v1's); the phone's at 0.67 m
export const WAKE_SIZES = Object.freeze({ full: { kelvin: 256, foam: 512 }, phone: { kelvin: 192, foam: 384 } });
export const POINT_FLOATS = 12;   // per point: (x, z, age, amp) (fx, fz, U, go) (prop, aft, 0, 0), relative to the boat
// #14 prop wash (marked): v1's churn behind the transom under power (src/boat/wake.js update: |thrust| / the bollard pull while
// the engine turns; 0.25 + 0.75 × it once over 0.02) and where it boils (1.2 m aft of the transom going ahead, 1.5 m forward of it
// astern: the wash runs forward); each point carries the churn of its moment, the foam map draws v1's stamp along that history
export const PROP = Object.freeze({ bollardN: 1450, ahead: 1.2, astern: -1.5, disc: [0.5, 1.4], foam: 0.55 });
export function propChurn(state) {
  const churn = Math.min(1, Math.abs(state.thrust ?? 0) / PROP.bollardN) * ((state.engineRpm ?? 0) > 0 ? 1 : 0);
  return { prop: churn > 0.02 ? 0.25 + 0.75 * churn : 0, aft: (state.thrust ?? 0) >= 0 ? PROP.ahead : PROP.astern };
}
import { smooth } from '../../src/sim/core/math.js'; export { smooth };
// the impulse's strength at speed U (v1's pushImpulse): the hull's pressure field scales with U², nothing under 0.6 m/s
export const impulseAmp = (U, amp = WAKE.amp) => amp * Math.pow(Math.max(U, 0) / 3, 2) * (U > 0.6 ? 1 : 0);
// the transom's stamp at speed U (v1's foam pass: nothing at rest, full by ≈ 3 m/s ≈ 6 kn)
export const stampGo = (U) => smooth(0.6, 3.0, U);

export function createWakeTrack({ length = 7.26, beam = 3.15, trailN = TRAIL_N, dt = TRAIL_DT } = {}) {
  // the ring: per impulse the stern point (f64: world), its emit time, amplitude, heading and speed
  const px = new Float64Array(trailN), pz = new Float64Array(trailN), pt = new Float64Array(trailN).fill(-1e9);
  const pa = new Float32Array(trailN), pfx = new Float32Array(trailN), pfz = new Float32Array(trailN).fill(-1), pu = new Float32Array(trailN);
  const pp = new Float32Array(trailN), paft = new Float32Array(trailN);   // #14 prop wash: the churn and its offset at each point
  let head = 0, clock = 0, tNow = 0, live = false, count = 0;
  const boat = { x: 0, z: 0, fx: 0, fz: -1, speed: 0, heel: 0, prop: 0, aft: PROP.ahead };
  function push(x, z, fx, fz, speed) {
    px[head] = x - fx * length * 0.5; pz[head] = z - fz * length * 0.5; pt[head] = tNow;
    pa[head] = impulseAmp(speed); pfx[head] = fx; pfz[head] = fz; pu[head] = speed; pp[head] = boat.prop; paft[head] = boat.aft;
    head = (head + 1) % trailN; count = Math.min(trailN, count + 1);
  }
  const T = {
    length, beam, trailN, dt,
    get t() { return tNow; }, get live() { return live; }, get count() { return count; }, boat,
    // the shared ride's call (src/sim/boat/ride.js step): renderer unused (v2's maps are made from pack() in the frame)
    update(_renderer, state, sdt) {
      const speed = Math.max(state.u ?? 0, 0), h = state.heading ?? 0, fx = Math.sin(h), fz = -Math.cos(h);
      sdt = Math.max(sdt, 1e-4);
      const pw = propChurn(state); boat.prop = pw.prop; boat.aft = pw.aft;   // #14 prop wash
      tNow += sdt; clock += sdt;
      if (clock >= dt) { clock -= dt; push(state.x, state.z, fx, fz, speed); }
      boat.x = state.x; boat.z = state.z; boat.fx = fx; boat.fz = fz; boat.speed = speed; boat.heel = state.heel ?? 0; live = true;
    },
    reset() { pt.fill(-1e9); pa.fill(0); pp.fill(0); head = 0; clock = 0; count = 0; live = false; },
    // the GPU's points into `out` (Float32Array, ≥ (trailN + 1) × 8): point 0 is the transom now (age 0), then the
    // impulses newest first; positions relative to (ox, oz) (the boat: f32 keeps millimetres); → the point count and
    // the strip's box (relative, padded by the widest profile) into box[0..3]
    pack(out, ox = boat.x, oz = boat.z, box = null) {
      const sx = boat.x - boat.fx * length * 0.5, sz = boat.z - boat.fz * length * 0.5;
      let n = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
      let px0 = Infinity, pz0 = Infinity, px1 = -Infinity, pz1 = -Infinity;   // #14: the prop's discs' box
      const put = (x, z, age, amp, fx, fz, U, prop = 0, aft = 0) => {
        const o = n * POINT_FLOATS, rx = x - ox, rz = z - oz;
        out[o] = rx; out[o + 1] = rz; out[o + 2] = age; out[o + 3] = amp;
        out[o + 4] = fx; out[o + 5] = fz; out[o + 6] = U; out[o + 7] = stampGo(U);
        out[o + 8] = prop; out[o + 9] = aft; out[o + 10] = 0; out[o + 11] = 0;
        if (prop > 0) { const qx = rx - fx * aft, qz = rz - fz * aft; if (qx < px0) px0 = qx; if (qx > px1) px1 = qx; if (qz < pz0) pz0 = qz; if (qz > pz1) pz1 = qz; }
        if (rx < x0) x0 = rx; if (rx > x1) x1 = rx; if (rz < z0) z0 = rz; if (rz > z1) z1 = rz;
        n++;
      };
      if (!live) { if (box) { box[0] = box[1] = box[2] = box[3] = 0; } return 0; }
      put(sx, sz, 0, 0, boat.fx, boat.fz, boat.speed, boat.prop, boat.aft);
      for (let k = 1; k <= count; k++) {
        const i = (head - k + trailN) % trailN;
        put(px[i], pz[i], tNow - pt[i], pa[i], pfx[i], pfz[i], pu[i], pp[i], paft[i]);
      }
      if (box) { const pad = beam * WAKE.roughCore + 3 * Math.sqrt(WAKE.edgeM * WAKE.edgeM + WAKE.spreadM2s * trailN * dt) + 0.5; box[0] = x0 - pad; box[1] = z0 - pad; box[2] = x1 + pad; box[3] = z1 + pad;
        if (px1 >= px0) { const r = PROP.disc[1] + 0.1; box[0] = Math.min(box[0], px0 - r); box[1] = Math.min(box[1], pz0 - r); box[2] = Math.max(box[2], px1 + r); box[3] = Math.max(box[3], pz1 + r); } }
      return n;
    },
  };
  return T;
}

// --- the JS twins of the GPU maps (render/wake.js WGSL), on packed points (tests) ---------------------------------
// the Kelvin map's height at (x, z) relative to the boat: v1's kelvinStep, the impulses 1..n−1 (point 0 is the transom
// now, no impulse); the same sum as src/sim/boat/wakePhysics.js wakeHeightCPU on a straight track
export function kelvinAtCPU(pts, n, x, z, { length = 7.26, rc = WAKE.rc, r0 = WAKE.r0, bowGain = WAKE.bowGain, dt = TRAIL_DT } = {}) {
  let h = 0;
  for (let i = 1; i < n; i++) {
    const o = i * POINT_FLOATS, tau = pts[o + 2], a = pts[o + 3];
    if (!(tau > 0.02 && a > 0)) continue;
    const base = a * tau * dt, g4 = tau * tau * G * 0.25;
    for (const [sx, sz, sgn] of [[pts[o], pts[o + 1], -1], [pts[o] + pts[o + 4] * length, pts[o + 1] + pts[o + 5] * length, bowGain]]) {
      const dx = x - sx, dz = z - sz, r2 = dx * dx + dz * dz + r0 * r0, r = Math.sqrt(r2), k = g4 / r2;
      h += base * sgn / r2 * Math.exp(-k * rc) * Math.cos(k * r);
    }
  }
  return h;
}
// the foam map at (x, z) relative to the boat: [foam, rough] (0..1): over the transom's path, the nearest segment's age
// decayed, v1's profile widened by the blur's spread
export function foamAtCPU(pts, n, x, z, { length = 7.26, beam = 3.15 } = {}) {
  let foam = 0, rough = 0;
  for (let i = 0; i + 1 < n; i++) {
    const a = i * POINT_FLOATS, b = a + POINT_FLOATS;
    const abx = pts[b] - pts[a], abz = pts[b + 1] - pts[a + 1], l2 = abx * abx + abz * abz;
    if (l2 > WAKE.maxSegM * WAKE.maxSegM) continue;
    const t = Math.min(1, Math.max(0, ((x - pts[a]) * abx + (z - pts[a + 1]) * abz) / Math.max(l2, 1e-6)));
    const d = Math.hypot(x - pts[a] - abx * t, z - pts[a + 1] - abz * t);
    if (d > beam + 2) continue;   // the GPU's cut (render/wake.js): the strip's tails past it are under 1e-4
    const age = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * t, U = pts[a + 6] + (pts[b + 6] - pts[a + 6]) * t, go = pts[a + 7] + (pts[b + 7] - pts[a + 7]) * t;
    const p = stripProfile(d, age, go, beam);
    foam = Math.max(foam, p[0]); rough = Math.max(rough, p[1]);
    const q = propProfile(pts, a, b, x, z);   // #14 prop wash
    foam = Math.max(foam, q[0]); rough = Math.max(rough, q[1]);
  }
  return [foam, rough];
}
// erf (Winitzki's approximation, ≤ 0.1 % off)
export function erf(x) {
  const x2 = x * x, a = 0.147, v = Math.sqrt(1 - Math.exp(-x2 * (4 / Math.PI + a * x2) / (1 + a * x2)));
  return x < 0 ? -v : v;
}
// a band of half-width w blurred by a Gaussian of σ, at distance d from its middle
export const blurredBand = (d, w, s) => 0.5 * (erf((w - d) / (s * Math.SQRT2)) + erf((w + d) / (s * Math.SQRT2)));
// the strip at distance d from the transom's path, `age` s after it passed, stamped at `go`: [foam, rough]
export function stripProfile(d, age, go, beam = 3.15) {
  const s = Math.sqrt(WAKE.edgeM * WAKE.edgeM + WAKE.spreadM2s * Math.max(age, 0));
  const tail = go * (1 - smooth(TRAIL_N * TRAIL_DT - 4, TRAIL_N * TRAIL_DT, age));   // the ring's end: no hard edge
  return [blurredBand(d, WAKE.core * beam, s) * Math.exp(-age / WAKE.foamS) * tail, blurredBand(d, WAKE.roughCore * beam, s) * Math.exp(-age / WAKE.roughS) * tail];
}
// #14 prop wash (marked): v1's stamp (a disc of 1 − smoothstep(0.5, 1.4, r) × the churn: foam × 0.55, the disturbed water × 1)
// along the history of the prop's point (each point's own offset along its heading), decayed at v1's 6 s and 14 s: [foam, rough]
export function propProfile(pts, a, b, x, z) {
  const sa = pts[a + 8], sb = pts[b + 8];
  if (!(sa > 0 || sb > 0)) return [0, 0];
  const ax = pts[a] - pts[a + 4] * pts[a + 9], az = pts[a + 1] - pts[a + 5] * pts[a + 9];
  const bx = pts[b] - pts[b + 4] * pts[b + 9], bz = pts[b + 1] - pts[b + 5] * pts[b + 9];
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez;
  const t = Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / Math.max(l2, 1e-6)));
  const d = Math.hypot(x - ax - ex * t, z - az - ez * t);
  const age = pts[a + 2] + (pts[b + 2] - pts[a + 2]) * t, k = (sa + (sb - sa) * t) * (1 - smooth(PROP.disc[0], PROP.disc[1], d));
  return [PROP.foam * k * Math.exp(-age / WAKE.foamS), k * Math.exp(-age / WAKE.roughS)];
}
