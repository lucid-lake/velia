// The birds' marks on the water (fix/bird-splash): no geometry on the lake. An impact's rings are a short train of
// capillary-gravity waves spreading from the spot (a normal perturbation, fading as it spreads; what the pixel cannot
// resolve goes into roughness), the plunge's hole is a patch of chaotic, rough water that closes in ≈ 1 s, and the foam
// is the water's own foam term, broken into bubbly flecks, fading in a few seconds. A goose's run leaves a trail: a
// strip of disturbed water and foam flecks that widens and fades behind it.
// The marks are a water feature (birdMarks: src/waters/features.js slots slope and foam), gated on BW.on: the water's
// shader only carries them when the birds are on (src/core/world.js), and with no source they are +0.
//   const w = birdWaterSources(); w.ring(now, x, z, kind, gain); w.trail(now, id, x, z, gain); w.step(now); w.upload(waterAt)
import * as THREE from 'three/webgpu';
import { Fn, If, Loop, float, vec2, vec3, vec4, uniform, uniformArray, smoothstep, length, max, min, exp, sin, dot, clamp, mx_worley_noise_float, mx_noise_float } from 'three/tsl';
import { addSlope } from '../../../src/sim/waters/features.js';
import { clamp01 } from '../../../src/sim/core/math.js';

const RINGS_MAX = 12, TRAILS_MAX = 8;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// each kind's mark at age τ (s): ring radius R and wavelength lam (m), the ring's slope, the hole, the foam and its radius
export const RING_KINDS = {
  plunge: { life: 8, at: (τ, g) => { const R = 0.45 + 0.8 * Math.pow(τ, 0.8); return { R, lam: 0.24 + 0.05 * τ, ring: g * 0.3 * Math.exp(-τ / 2.6) * smooth(0, 0.15, τ) * Math.sqrt(0.8 / (R + 0.3)), hole: g * Math.exp(-τ / 0.7) * smooth(0, 0.06, τ), foam: g * 0.7 * smooth(0.1, 0.6, τ) * Math.exp(-Math.max(0, τ - 0.6) / 2.2), foamR: 0.45 + 0.35 * Math.sqrt(τ) }; } },
  lift: { life: 6, at: (τ, g) => { const R = 0.4 + 0.65 * Math.pow(τ, 0.8); return { R, lam: 0.2 + 0.04 * τ, ring: g * 0.2 * Math.exp(-τ / 2) * smooth(0, 0.12, τ) * Math.sqrt(0.8 / (R + 0.3)), hole: g * 0.5 * Math.exp(-τ / 0.45), foam: g * 0.5 * Math.exp(-τ / 1.6), foamR: 0.55 + 0.2 * Math.sqrt(τ) }; } },
  slap: { life: 3, at: (τ, g) => { const R = 0.2 + 0.5 * τ; return { R, lam: 0.13, ring: g * 0.14 * Math.exp(-τ / 1.0), hole: g * 0.2 * Math.exp(-τ / 0.3), foam: g * 0.3 * Math.exp(-τ / 0.6), foamR: 0.3 }; } },
  land: { life: 5, at: (τ, g) => { const R = 0.3 + 0.6 * Math.pow(τ, 0.8); return { R, lam: 0.16 + 0.03 * τ, ring: g * 0.18 * Math.exp(-τ / 1.8) * Math.sqrt(0.8 / (R + 0.3)), hole: g * 0.3 * Math.exp(-τ / 0.5), foam: g * 0.45 * Math.exp(-τ / 1.3), foamR: 0.5 }; } },
};
export const TRAIL = { life: 3.5, join: 0.6 };   // a trail is gone 3.5 s after its last step; a step within 0.6 s extends it

// the uniforms the water reads: per ring (x, z, R, lam), (ring, hole, foam, foamR); per trail (x0, z0, x1, z1), (age0, age1, gain, 0)
export const BW = {
  on: uniform(0),
  rA: uniformArray(Array.from({ length: RINGS_MAX }, () => new THREE.Vector4()), 'vec4'),
  rB: uniformArray(Array.from({ length: RINGS_MAX }, () => new THREE.Vector4()), 'vec4'),
  tA: uniformArray(Array.from({ length: TRAILS_MAX }, () => new THREE.Vector4()), 'vec4'),
  tB: uniformArray(Array.from({ length: TRAILS_MAX }, () => new THREE.Vector4()), 'vec4'),
  nRings: uniform(0, 'int'), nTrails: uniform(0, 'int'),
};

// plain JS: the sources and their state (tests/birds.test.mjs); upload() writes BW
export function birdWaterSources() {
  const rings = [], trails = [];
  let now = 0;
  function ring(t, x, z, kind, gain = 1) {
    if (!RING_KINDS[kind]) return;
    rings.push({ t0: t, x, z, kind, gain });
    if (rings.length > RINGS_MAX) rings.splice(0, rings.length - RINGS_MAX);   // the oldest go first
  }
  function trail(t, id, x, z, gain = 1) {
    const tr = trails.find((q) => q.id === id && t - q.t1 < TRAIL.join);
    if (tr) { tr.x1 = x; tr.z1 = z; tr.t1 = t; tr.g1 = gain; return; }
    trails.push({ id, x0: x, z0: z, x1: x, z1: z, t0: t, t1: t, g0: gain, g1: gain });
    if (trails.length > TRAILS_MAX) trails.splice(0, trails.length - TRAILS_MAX);
  }
  function step(t) {
    now = t;
    for (let i = rings.length - 1; i >= 0; i--) if (now - rings[i].t0 > RING_KINDS[rings[i].kind].life) rings.splice(i, 1);
    for (let i = trails.length - 1; i >= 0; i--) if (now - trails[i].t1 > TRAIL.life) trails.splice(i, 1);
  }
  const at = (q) => RING_KINDS[q.kind].at(Math.max(0, now - q.t0), q.gain);
  function upload() {
    for (let i = 0; i < rings.length; i++) {
      const q = rings[i], s = at(q);
      BW.rA.array[i].set(q.x, q.z, s.R, s.lam); BW.rB.array[i].set(s.ring, s.hole, s.foam, s.foamR);
    }
    for (let i = 0; i < trails.length; i++) {
      const q = trails[i];
      BW.tA.array[i].set(q.x0, q.z0, q.x1, q.z1); BW.tB.array[i].set(now - q.t0, now - q.t1, (q.g0 + q.g1) / 2, 0);
    }
    BW.nRings.value = rings.length; BW.nTrails.value = trails.length;
    BW.on.value = rings.length + trails.length > 0 ? 1 : 0;
  }
  return { ring, trail, step, upload, at, rings, trails, get now() { return now; } };
}

// --- the shader: the marks at a rest point (world xz) for a pixel of the given footprint (m) ------------------------
const TAU = Math.PI * 2;
const birdWaterAt = ({ rest, time, footprint }) => {
  const v = Fn(() => {
  const sx = float(0).toVar(), sz = float(0).toVar(), rough = float(0).toVar(), foam = float(0).toVar();
  const addS = (g) => { sx.addAssign(g.x); sz.addAssign(g.y); };
  If(BW.on.greaterThan(0.5), () => {
    Loop(BW.nRings, ({ i }) => {
      const a = BW.rA.element(i), b = BW.rB.element(i);
      const d = rest.sub(a.xy), r = length(d);
      If(r.lessThan(max(a.z.add(a.w.mul(3)), b.w.mul(1.4))), () => {
        const dir = d.div(max(r, 1e-3));
        // the ring train: two or three crests round the leading radius
        const u = r.sub(a.z).div(a.w), env = exp(u.mul(u).mul(-0.35));
        const prof = sin(u.mul(TAU)).mul(env);
        const res = smoothstep(2, 5, a.w.div(footprint));
        addS(dir.mul(b.x.mul(prof).mul(res)));
        rough.addAssign(b.x.mul(b.x).mul(0.5).mul(env).mul(float(1).sub(res)));
        // the hole and the foam's footprint, with a ragged edge
        const edge = mx_noise_float(vec3(rest.mul(3.1), float(i).mul(7.3))).mul(0.25);
        const m = float(1).sub(smoothstep(0.35, 1.0, r.div(b.w).add(edge)));
        const q = rest.mul(TAU / 0.3);
        const ch = vec2(sin(q.x.add(q.y.mul(0.7)).add(time.mul(9))), sin(q.y.mul(1.3).sub(q.x.mul(0.6)).sub(time.mul(7.5))));
        addS(ch.mul(b.y.mul(m).mul(0.35).mul(smoothstep(1.5, 4, float(0.3).div(footprint)))));
        rough.addAssign(b.y.mul(m).mul(0.09));
        // bubbly foam: clusters of cells, thinning from the middle out
        const cells = float(1).sub(mx_worley_noise_float(vec3(rest.mul(3.2), float(i).mul(3.7).add(time.mul(0.12)))));
        const fl = smoothstep(0.45, 0.85, cells.add(mx_noise_float(vec3(rest.mul(1.3), float(i).add(time.mul(0.1)))).mul(0.4)));
        foam.assign(max(foam, clamp(b.z.mul(m).mul(fl), 0, 0.6)));
      });
    });
    Loop(BW.nTrails, ({ i }) => {
      const a = BW.tA.element(i), b = BW.tB.element(i);
      const p0 = a.xy, seg = a.zw.sub(p0), L2 = max(dot(seg, seg), 1e-4);
      const s = clamp(dot(rest.sub(p0), seg).div(L2), 0, 1);
      const d = length(rest.sub(p0.add(seg.mul(s))));
      const age = b.x.add(b.y.sub(b.x).mul(s));       // older at the start of the run
      const w = age.mul(0.22).add(0.2);                // the wake widens as it ages
      If(d.lessThan(w.mul(1.6)), () => {
        const k = exp(age.div(1.5).negate()).mul(b.z), m = float(1).sub(smoothstep(0.3, 1.0, d.div(w)));
        const q = rest.mul(TAU / 0.25);
        const ch = vec2(sin(q.x.add(q.y.mul(0.8)).add(time.mul(8))), sin(q.y.mul(1.2).sub(q.x.mul(0.7)).sub(time.mul(6.5))));
        addS(ch.mul(k.mul(m).mul(0.12).mul(smoothstep(1.5, 4, float(0.25).div(footprint)))));
        rough.addAssign(k.mul(m).mul(0.03));
        const cells = float(1).sub(mx_worley_noise_float(vec3(rest.mul(3.5), float(i).mul(5.1).add(9))));
        const fl = smoothstep(0.35, 0.8, cells);
        foam.assign(max(foam, clamp(exp(age.div(0.7).negate()).mul(b.z).mul(m).mul(fl).mul(0.75), 0, 0.6)));
      });
    });
  });
  return vec4(sx, sz, rough, foam);
  })();
  return { sx: v.x, sz: v.y, rough: v.z, foam: v.w };
};

// the birds' marks as a water feature (src/waters/features.js; src/core/world.js lists it only when the birds are on):
// their slope and roughness join the slope after the rain's, their foam the water's foam (one marks pass a pixel)
export function birdMarks() {
  let marks = null;
  return {
    id: 'birds',
    slope: { add: (acc, c) => { marks = birdWaterAt({ rest: c.rest, time: c.time, footprint: c.footprint }); return addSlope(acc, marks); } },
    foam: { add: (f) => (marks ? max(f, marks.foam) : f) },
  };
}
