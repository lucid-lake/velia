// The creature map's maths (render/wake.js WAKEU.cr: a small map in the wake's own buffer, after its two maps, that the water
// reads as it reads the boat's wake): rings, a V, the foam at a waterline, the slick. Tessie's (render/tessie.js, a desktop
// page: 128² over 64 m centred on her) and the osprey's strike (living/birds-splash.js: its rings and foam patch, on every
// form) write it with this one compute; one writer at a time (wake.creature.writer). Pure strings: no GPU here.
//   sources (CrU.src): the V's impulses [x, z, tau, amp] (maxK), the rings [x, z, age, amp] (maxR), the waterline's
//   cross-sections [x, z, radius, 0] (maxC)
import { MX_NOISE_WGSL } from './wake.js';

export const CREATURE = Object.freeze({ size: 128, extent: 64, maxK: 24, maxR: 16, maxC: 24, rc: 0.45, r0: 0.5, dtK: 1 / 3 });

// the creature map: rings, the V, the waterline's foam, the slick (the wake's impulse maths: render/wake.js WAKE_COMPUTE_WGSL)
export const WATER_COMPUTE_WGSL = ({ size, offset }) => `
struct CrU { box: vec4f, cnt: vec4f, src: array<vec4f, ${CREATURE.maxK + CREATURE.maxR + CREATURE.maxC}> }
@group(0) @binding(0) var<uniform> C: CrU;
@group(0) @binding(1) var<storage, read_write> M: array<vec2u>;
const S = ${size}u; const OFF = ${offset}u; const G = 9.81;
const NK = ${CREATURE.maxK}u; const NR = ${CREATURE.maxR}u;
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
  M[OFF + g.y * S + g.x] = vec2u(pack2x16float(acc.yz), pack2x16float(vec2f(clamp(foam, 0.0, 1.0), clamp(rough, 0.0, 1.0))));
}`;
