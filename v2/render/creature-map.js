// The creature map's maths (render/wake.js WAKEU.cr: a small map in the wake's own buffer, after its two maps, that the water
// reads as it reads the boat's wake): rings, a V, the foam at a waterline, the slick. Tessie's (render/tessie.js, a desktop
// page: 128² over 64 m centred on her) and the osprey's strike (living/birds-splash.js: its rings and foam patch, on every
// form) write it with this one compute; one writer at a time (wake.creature.writer). Pure strings: no GPU here.
//   sources (CrU.src): the V's impulses [x, z, tau, amp] (maxK), the rings [x, z, age, amp] (maxR), the waterline's
//   cross-sections [x, z, radius, 0] (maxC), the skill waves [x, z, age, kind] [p0, p1, p2, p3] (maxS = 2 × SKILL_WAVE_MAX vec4;
//   their count in box.w: sim/tessieWaves.js)
import { MX_NOISE_WGSL } from './wake.js';
import { SKILL_WAVE_MAX } from '../sim/tessieWaves.js';   // the RPG's skill waves (the swell, the inward ripples, the churn)

export const CREATURE = Object.freeze({ size: 128, extent: 64, maxK: 24, maxR: 16, maxC: 24, maxS: SKILL_WAVE_MAX * 2, rc: 0.45, r0: 0.5, dtK: 1 / 3 });
export const CREATURE_VEC4 = 2 + CREATURE.maxK + CREATURE.maxR + CREATURE.maxC + CREATURE.maxS;   // the uniform's vec4 (box, cnt, the sources)

// the creature map: rings, the V, the waterline's foam, the slick (the wake's impulse maths: render/wake.js WAKE_COMPUTE_WGSL)
export const WATER_COMPUTE_WGSL = ({ size, offset }) => `
struct CrU { box: vec4f, cnt: vec4f, src: array<vec4f, ${CREATURE.maxK + CREATURE.maxR + CREATURE.maxC + CREATURE.maxS}> }
@group(0) @binding(0) var<uniform> C: CrU;
@group(0) @binding(1) var<storage, read_write> M: array<vec2u>;
const S = ${size}u; const OFF = ${offset}u; const G = 9.81;
const NK = ${CREATURE.maxK}u; const NR = ${CREATURE.maxR}u; const NC = ${CREATURE.maxC}u;
${MX_NOISE_WGSL}
fn source(p: vec2f, at: vec2f, amp: f32, g4: f32, r02: f32, rc: f32, acc: ptr<function, vec3f>) {
  let rv = p - at; let r2 = dot(rv, rv) + r02; let r = sqrt(r2);
  let k = g4 / r2; let ph = k * r;
  let env = amp / r2 * exp(-k * rc);
  let ds = env * sin(ph) * k / r;
  *acc += vec3f(env * cos(ph), ds * rv.x, ds * rv.y);
}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= S || g.y >= S) { return; }
  let p = C.box.xy + (vec2f(g.xy) + 0.5) / f32(S) * C.box.z;
  let nk = u32(C.cnt.x); let nr = u32(C.cnt.y); let nc = u32(C.cnt.z); let t = C.cnt.w;
  let r02 = ${(CREATURE.r0 * CREATURE.r0).toFixed(3)}; let rc = ${CREATURE.rc.toFixed(3)};
  var acc = vec3f(0.0); var foam = 0.0; var rough = 0.0;
  // the V: a pressure point's impulses along her neck's path (the boat's wake, one source each)
  for (var i = 0u; i < nk; i++) {
    let e = C.src[i]; let tau = e.z;
    source(p, e.xy, e.w * tau * ${CREATURE.dtK.toFixed(4)}, tau * tau * G * 0.25, r02, rc, &acc);
    rough = max(rough, e.w * 1.6 * exp(-tau / 8.0) * (1.0 - smoothstep(0.6, 2.6, length(p - e.xy))));
  }
  // the rings: one impulse each, where she broke or left the surface; young ones carry a broken ring of foam
  for (var i = 0u; i < nr; i++) {
    let e = C.src[NK + i]; let age = max(e.z, 0.05);
    source(p, e.xy, e.w * age * 0.55, age * age * G * 0.25, r02, rc, &acc);
    let d = length(p - e.xy); let rr = 0.9 + 0.9 * age;
    let ring = (1.0 - smoothstep(0.0, 0.35 + 0.25 * age, abs(d - rr))) * (1.0 - smoothstep(0.4, 2.8, age)) * e.w;
    foam = max(foam, ring * (0.75 + 0.45 * mxNoise(p * 2.2 + vec2f(t * 0.3, 0.0))));
    rough = max(rough, e.w * exp(-age / 5.0) * (1.0 - smoothstep(rr * 0.6, rr + 1.5, d)));
  }
  // her waterline: foam where the water meets her (the union of her cross-sections at the surface), broken by the noise
  var dmin = 1e9;
  for (var i = 0u; i < nc; i++) { let e = C.src[NK + NR + i]; dmin = min(dmin, length(p - e.xy) - e.z); }
  if (nc > 0u) {
    // broken, irregular patches that thin out away from her skin (a churned rim, never a solid collar with a hard edge)
    let n1 = mxNoise(p * 1.6 + vec2f(t * 0.25, -t * 0.4)); let n2 = mxNoise(p * 4.7 - vec2f(t * 0.6, t * 0.2));
    let edge = (1.0 - smoothstep(-0.2, 0.6 + 1.1 * n1, dmin)) * smoothstep(-0.55, -0.05, dmin);
    foam = max(foam, edge * smoothstep(0.32, 0.9, 0.55 * n1 + 0.55 * n2) * 0.9);
    rough = max(rough, 1.0 - smoothstep(0.0, 3.0, dmin));
  }
  // the RPG's skill waves (sim/tessieWaves.js): a source is two vec4, [x, z, age, kind] [p0 … p3]; acc.yz is the slope as the
  // impulses write it (minus the height's gradient)
  let ns = u32(C.box.w); let cell = C.box.z / f32(S);
  for (var i = 0u; i < ns; i++) {
    let a = C.src[NK + NR + NC + 2u * i]; let q = C.src[NK + NR + NC + 2u * i + 1u];
    let rv = p - a.xy; let d = length(rv) + 1e-4; let dir = rv / d; let age = a.z; let kind = u32(a.w + 0.5);
    if (kind == 1u) {
      // the swell: one raised crest (a hump, a shallow trough behind it) rolling out; foam torn along its top and front face
      let w = max(q.w, cell * 1.8); let rr = min(q.y, q.x * age);
      let fade = select(1.0, max(0.0, 1.0 - (q.x * age - q.y) / (q.x * 0.6)), q.x * age >= q.y);
      let A = q.z * sqrt(4.0 / max(4.0, rr)) * fade;
      let x = (d - rr) / w; let x2 = x + 1.6;
      if (abs(x) > 4.5 && abs(x2) > 3.0) { continue; }
      let e1 = exp(-x * x); let e2 = exp(-x2 * x2);
      let dh = A * (-2.0 * x * e1 + 0.7 * x2 * e2) / w;
      acc += vec3f(A * (e1 - 0.35 * e2), -dh * dir.x, -dh * dir.y);
      let n = mxNoise(p * 0.9 + dir * age * 3.0) * 0.6 + mxNoise(p * 2.6 - vec2f(age * 1.7, 0.0)) * 0.5;
      let lip = smoothstep(0.35, 0.95, e1) * (0.55 + 0.45 * smoothstep(-0.6, 0.4, x));
      let thin = fade * (1.0 - 0.4 * smoothstep(0.0, q.y, rr));
      foam = max(foam, lip * smoothstep(-0.3, 0.3, n) * thin);
      rough = max(rough, e1 * 0.3 * fade);   // a little calm on its back only: a wide slick would read as a flat pale band
    } else if (kind == 2u) {
      // the inward ripples: a short train closing in on her, no foam but a glint of specks on its crests
      let rr = max(0.0, q.x - q.y * age); let w = max(q.w, cell * 2.2);
      let x = (d - rr) / w;
      if (abs(x) > 3.5) { continue; }
      let env = exp(-0.35 * x * x) * smoothstep(0.0, 0.4, age) * smoothstep(1.0, 4.0, rr);
      let k = 6.2832 / w; let ph = (d - rr) * k;
      let dh = q.z * env * cos(ph) * k;
      acc += vec3f(q.z * env * sin(ph), -dh * dir.x, -dh * dir.y);
      foam = max(foam, env * smoothstep(0.55, 1.0, sin(ph)) * smoothstep(0.25, 0.6, mxNoise(p * 3.1 + vec2f(age, -age))) * 0.5);
      rough = max(rough, env * 0.6);
    } else if (kind == 3u) {
      // the churn: a white, boiling disc that fades over its life
      let r = q.x + q.z * age;
      if (d > r * 1.2) { continue; }
      let life = clamp(1.0 - age / max(q.w, 0.1), 0.0, 1.0);
      let m = (1.0 - smoothstep(0.5 * r, 1.15 * r, d)) * q.y * life;
      let pp = p * 1.4 + vec2f(age * 0.8, -age * 1.1);
      let n0 = mxNoise(pp); let nx = mxNoise(pp + vec2f(0.35, 0.0)) - n0; let nz = mxNoise(pp + vec2f(0.0, 0.35)) - n0;
      acc += vec3f(0.0, nx * m * 0.9, nz * m * 0.9);
      foam = max(foam, m * smoothstep(-0.25, 0.35, n0 * 0.7 + mxNoise(p * 4.3 - vec2f(age * 2.0, 0.0)) * 0.5));
      rough = max(rough, m);
    }
  }
  M[OFF + g.y * S + g.x] = vec2u(pack2x16float(acc.yz), pack2x16float(vec2f(clamp(foam, 0.0, 1.0), clamp(rough, 0.0, 1.0))));
}`;
