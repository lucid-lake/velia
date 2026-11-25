// The other boats' wakes (owner, 2026-11-18: "the wake ... like my photo": the glass boat's white prop wash behind her twin outboards,
// the Kelvin V spreading behind her tubes, the foam at her noses, fading over 20–40 s, scaled by her speed; none at a stop, a soft
// swirl as she slows into one; her towed kayaks' small wakes). One map in the player's wake buffer (render/wake.js: the vessels' map,
// after the creature map), which the water reads exactly as it reads the player's wake and Tessie's (its slope bends the normal and
// the mirror, its foam is drawn as the player's strip is: lanes, specks, ragged edges; its disturbed water calms the ripples). One
// compute writes it from a list of EMITTERS, any boat with a recorded trail: it is not the glass boat's alone (the busy lake's boats
// can be emitters: the map follows a focus, the boats inside its 128 m are drawn; a scattered fleet needs a map per cluster).
//   sources(emitters, focus) → { box, kelvin [x, z, tau, amp], strips [(x0, z0, x1, z1), (age0, age1, halfWidth, strength)],
//                                noses [x, z, radius, strength] }   (pure: the tests)
//   const VW = createVesselWake({ device, reg, wake, name })   (its compute in the caller's group, named name; nothing when wake.sizes.vessel is 0)
//   VW.update(emitters, focus)   once a frame before the water-sim pass (sets wake.vessel);   VW.run(pass, c)   in the water-sim pass
//   VW.pause()   stand down for a frame without touching wake.vessel (another owner's map holds it: the paddle-wheeler yields to the glass boat)
// An emitter: { trail: [{ age, x, z, fx, fz, v, churn }] newest first (sampled every VESSEL.dt s), length, lines: [{ x (m to starboard),
// aft (m aft of the middle), w (m wide), foam, life (s) }] (the props' wash, a hull's tails), noses: [[fwd, stbd]] (the bows), noseR,
// noseFoam, kelvinAmp (0: no V), kelvinAge, arms: { foam, w, life, x0 } (the V's arms breaking white) }
import { MX_NOISE_WGSL } from './wake.js';

export const VESSEL = Object.freeze({
  size: 192, extent: 128,       // texels a side (≈ 0.67 m: the 4 kn V's 2.7 m waves keep four texels), m
  maxK: 96, maxS: 170, maxN: 8, // the sources: Kelvin impulses, strip segments, bows
  dt: 0.5,                      // s between trail samples (the sim's)
  kelvinAge: 12, kdt: 0.25,     // s of the V kept (at 4 kn: 25 m, ≈ 2.3 hull lengths), s between its impulses (a bow crest and a stern trough)
  washLife: 36,                 // s of prop wash kept (its foam fades by FOAM_S; the disturbed water lasts longer)
  whiteS: 3,                    // s the wash stays solid white before it fades
  foamS: 10, roughS: 30,        // s: the strip's foam and slick e-folding times (gone to the eye by ≈ 30 s and ≈ 40 s)
  spread: 0.12,                 // m a second the strip widens
  rc: 0.5, r0: 0.6,             // the impulses' short-wave cutoff and core (the wake's maths: render/wake.js, creature-map.js)
  aheadM: 34,                   // m of the map ahead of the focus (the rest trails behind it)
});

// the sources for this frame from the emitters; focus { x, z, fx, fz }: the boat the map follows
export function sources(emitters, focus, V = VESSEL) {
  const cell = V.extent / V.size;
  const cx = focus.x + focus.fx * (V.aheadM - V.extent / 2), cz = focus.z + focus.fz * (V.aheadM - V.extent / 2);
  const x0 = Math.round((cx - V.extent / 2) / cell) * cell, z0 = Math.round((cz - V.extent / 2) / cell) * cell;
  const kelvin = [], strips = [], noses = [];
  const inBox = (x, z, m = 8) => x > x0 - m && x < x0 + V.extent + m && z > z0 - m && z < z0 + V.extent + m;
  for (const e of emitters) {
    const tr = e.trail ?? [], L = e.length ?? 4;
    // the V: a bow crest and a stern trough every kdt s younger than kelvinAge (the trail's samples interpolated: the player's 0.25 s,
    // sparser impulses read as separate rings, not a V), by the speed then (the player's impulse law: ∝ (U/3)²; none under 0.3 m/s)
    const kAge = e.kelvinAmp ? (e.kelvinAge ?? V.kelvinAge) : 0;
    for (let i = 0; i + 1 < tr.length && tr[i].age < kAge; i++) {
      const p = tr[i], q = tr[i + 1], span = q.age - p.age;
      if (!(span > 0) || Math.hypot(p.x - q.x, p.z - q.z) > 12) continue;
      for (let age = Math.ceil(p.age / V.kdt) * V.kdt; age < q.age && age < kAge && kelvin.length < V.maxK - 1; age += V.kdt) {
        const f = (age - p.age) / span, v = p.v + (q.v - p.v) * f;
        if (!(v > 0.3) || age < 0.1) continue;
        const x = p.x + (q.x - p.x) * f, z = p.z + (q.z - p.z) * f, fx = p.fx + (q.fx - p.fx) * f, fz = p.fz + (q.fz - p.fz) * f;
        const a = e.kelvinAmp * Math.min(1.5, (v / 3) ** 2);
        const bx = x + fx * L * 0.45, bz = z + fz * L * 0.45, sx = x - fx * L * 0.45, sz = z - fz * L * 0.45;
        if (inBox(bx, bz)) kelvin.push([bx, bz, age, a]);
        if (inBox(sx, sz)) kelvin.push([sx, sz, age, -a]);
      }
    }
    // the wash lines (the props' wash, the white water off a hull's tails): each line's path as segments, its strength the churn then
    // (speed, and the reverse thrust of slowing into a stop) × the line's foam, widening as it ages
    for (const ln of e.lines ?? []) {
      const life = ln.life ?? V.washLife, aft = ln.aft ?? L * 0.5, sx = ln.x ?? 0;
      const at = (p) => [p.x - p.fx * aft - p.fz * sx, p.z - p.fz * aft + p.fx * sx];
      for (let i = 0, j; i + 1 < tr.length && strips.length < V.maxS; i = j) {
        j = Math.min(tr.length - 1, i + (tr[i].age > 8 ? 2 : 1));   // older than 8 s: a segment every 1 s (it has spread wider than the bends)
        const p = tr[i], q = tr[j]; if (p.age > life) break;
        const s = (ln.foam ?? 1) * Math.max(p.churn ?? 0, q.churn ?? 0);
        if (!(s > 0.02)) continue;
        const [ax, az] = at(p), [bx, bz] = at(q);
        if (!inBox(ax, az, 12) && !inBox(bx, bz, 12)) continue;
        strips.push([ax, az, bx, bz, p.age, q.age, ln.w ?? 1, s]);
      }
    }
    // the V's two arms (the divergent crests breaking white near the hull, as in the photo): a line each side of her track at the Kelvin
    // angle (19.47°: tan 0.354) from the stern, out by the distance run since; its foam by the speed then, gone after arms.life s
    const A = e.arms;
    if (A && tr.length > 1) {
      let run = 0;
      const sa = L * 0.5, arm = (p, d, side) => { const o = 0.354 * d + (A.x0 ?? 1.2); return [p.x - p.fx * sa - p.fz * o * side, p.z - p.fz * sa + p.fx * o * side]; };
      for (let i = 0; i + 1 < tr.length && strips.length < V.maxS - 1; i++) {
        const p = tr[i], q = tr[i + 1]; if (p.age > (A.life ?? 10)) break;
        const seg = Math.hypot(p.x - q.x, p.z - q.z), r0 = run; run += seg;
        const s = (A.foam ?? 0.5) * Math.min(1, Math.max(0, (Math.min(p.v, q.v) - 0.5) / 1.5));
        if (!(s > 0.02) || seg > 12) continue;
        for (const side of [-1, 1]) {
          const [ax, az] = arm(p, r0, side), [bx, bz] = arm(q, run, side);
          if (inBox(ax, az, 12) || inBox(bx, bz, 12)) strips.push([ax, az, bx, bz, p.age, q.age, A.w ?? 0.5, s]);
        }
      }
    }
    // the bows' foam (the water piling at her noses): by her speed now
    const n0 = tr[0];
    if (n0 && n0.v > 0.6) for (const [f, sd] of e.noses ?? []) {
      if (noses.length >= V.maxN) break;
      const x = n0.x + n0.fx * f - n0.fz * sd, z = n0.z + n0.fz * f + n0.fx * sd;
      if (inBox(x, z)) noses.push([x, z, e.noseR ?? 0.35, Math.min(1, (n0.v - 0.6) / 1.4) * (e.noseFoam ?? 1)]);
    }
  }
  return { box: [x0, z0, V.extent], kelvin, strips, noses };
}

// the map: the V's slope, the wash's foam and slick, the bows' foam (the creature map's impulse maths: render/creature-map.js)
const VESSEL_COMPUTE_WGSL = ({ size, offset }, V = VESSEL) => `
struct VU { box: vec4f, cnt: vec4f, src: array<vec4f, ${V.maxK + 2 * V.maxS + V.maxN}> }
@group(0) @binding(0) var<uniform> C: VU;
@group(0) @binding(1) var<storage, read_write> M: array<vec2u>;
const S = ${size}u; const OFF = ${offset}u; const G = 9.81;
const NK = ${V.maxK}u; const NS = ${V.maxS}u;
${MX_NOISE_WGSL}
@compute @workgroup_size(8, 8) fn main(@builtin(global_invocation_id) g: vec3u) {
  if (g.x >= S || g.y >= S) { return; }
  let p = C.box.xy + (vec2f(g.xy) + 0.5) / f32(S) * C.box.z;
  let nk = u32(C.cnt.x); let ns = u32(C.cnt.y); let nn = u32(C.cnt.z); let t = C.box.w;
  let r02 = ${(V.r0 * V.r0).toFixed(3)}; let rc = ${V.rc.toFixed(3)};
  var sl = vec2f(0.0); var foam = 0.0; var rough = 0.0;
  let lanes = 0.55 + 0.6 * mxNoise(p * 2.6 + vec2f(0.0, t * 0.05));   // the old foam's lanes (one noise a texel)
  for (var i = 0u; i < nk; i++) {
    let e = C.src[i]; let tau = e.z;
    let rv = p - e.xy; let r2 = dot(rv, rv) + r02; let r = sqrt(r2);
    let k = tau * tau * G * 0.25 / r2; let ph = k * r;
    let env = e.w * tau * ${V.kdt.toFixed(3)} / r2 * exp(-k * rc);
    sl += env * sin(ph) * k / r * rv;
  }
  for (var i = 0u; i < ns; i++) {
    let a = C.src[NK + 2u * i]; let b = C.src[NK + 2u * i + 1u];
    let ab = a.zw - a.xy; let h = clamp(dot(p - a.xy, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
    let d = length(p - a.xy - ab * h); let age = mix(b.x, b.y, h);
    let w = b.z * 0.5 + ${V.spread.toFixed(3)} * age;
    if (d > w * 2.2 + 1.0) { continue; }
    let core = 1.0 - smoothstep(w * 0.6, w, d);
    // solid white for the first seconds (the churn), then torn into lanes as it fades (the water's foam draws under ≈ 0.6 as patches)
    let torn = mix(1.0, lanes, smoothstep(2.0, 10.0, age));
    foam = max(foam, b.w * core * exp(-max(age - ${V.whiteS.toFixed(1)}, 0.0) / ${V.foamS.toFixed(1)}) * torn);
    rough = max(rough, b.w * (1.0 - smoothstep(w, w * 2.2 + 1.0, d)) * exp(-age / ${V.roughS.toFixed(1)}));
  }
  for (var i = 0u; i < nn; i++) {
    let e = C.src[NK + 2u * NS + i]; let d = length(p - e.xy) - e.z;
    if (d > 2.5) { continue; }
    let edge = (1.0 - smoothstep(0.0, 0.8, d)) * step(-0.3, d);
    foam = max(foam, e.w * edge * (0.7 + 0.5 * mxNoise(p * 3.3 + vec2f(0.0, t * 0.6))));
    rough = max(rough, e.w * (1.0 - smoothstep(0.0, 2.5, d)));
  }
  M[OFF + g.y * S + g.x] = vec2u(pack2x16float(sl), pack2x16float(vec2f(clamp(foam, 0.0, 1.0), clamp(rough, 0.0, 1.0))));
}`;

export function createVesselWake({ device, reg, wake, V = VESSEL, name = 'vessel-wake' }) {
  const size = wake?.sizes?.vessel ?? 0;
  if (!size) return null;
  const CP = GPUShaderStage.COMPUTE, NSRC = V.maxK + 2 * V.maxS + V.maxN;
  const u = new Float32Array((2 + NSRC) * 4);
  const ubuf = device.createBuffer({ label: 'vessel-wake', size: u.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'vessel-wake', entries: [{ binding: 0, visibility: CP, buffer: { type: 'uniform' } }, { binding: 1, visibility: CP, buffer: { type: 'storage' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }, { binding: 1, resource: { buffer: wake.mapsBuffer } }] });
  reg.add(name, { layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module: reg.shader(name, VESSEL_COMPUTE_WGSL({ size, offset: wake.vesselOffset }, V)), entryPoint: 'main' } });
  const groups = Math.ceil(size / 8);
  let live = false, due = false, frame = 0;
  const box = [0, 0, V.extent];   // the last frame's box (re-stated on the frames between runs: another emitter's owner may have cleared the map's switch)
  const stats = { kelvin: 0, strips: 0, noses: 0, on: false, dispatches: 0 };
  const self = {
    stats, repeat: 1,   // repeat: the cost probe's dispatches a run (tools/v2-glass-boat-shots.mjs cost wakex20); 1 in play
    // this frame's sources (none: the map off); t: the sim time (the foam's noise drifts with it)
    update(emitters, focus, t = 0) {
      if (!emitters?.length || !focus) { live = false; due = false; wake.vessel.on = 0; stats.on = false; return; }
      // at half the frame rate (the map keeps its last frame and its box in between: her V moves ≈ 7 cm a frame): the cost halved
      due = !live || (frame++ & 1) === 0;
      if (!due) { wake.vessel.on = 1; wake.vessel.x0 = box[0]; wake.vessel.z0 = box[1]; wake.vessel.extent = box[2]; return; }
      const s = sources(emitters, focus, V);
      live = s.kelvin.length + s.strips.length + s.noses.length > 0;
      wake.vessel.on = live ? 1 : 0; wake.vessel.x0 = s.box[0]; wake.vessel.z0 = s.box[1]; wake.vessel.extent = s.box[2];
      box[0] = s.box[0]; box[1] = s.box[1]; box[2] = s.box[2];
      stats.kelvin = s.kelvin.length; stats.strips = s.strips.length; stats.noses = s.noses.length; stats.on = live;
      if (!live) return;
      u.fill(0);
      u.set([s.box[0], s.box[1], s.box[2], t, s.kelvin.length, s.strips.length, s.noses.length, 0], 0);
      s.kelvin.forEach((e, i) => u.set(e, 8 + i * 4));
      s.strips.forEach((e, i) => u.set(e, 8 + (V.maxK + 2 * i) * 4));
      s.noses.forEach((e, i) => u.set(e, 8 + (V.maxK + 2 * V.maxS + i) * 4));
      device.queue.writeBuffer(ubuf, 0, u);
    },
    // stand down without touching the map (another boat's map holds it this frame: one vessels' map on the page)
    pause() { live = false; due = false; stats.on = false; },
    run(pass, c) {
      if (!live || !due) return;
      stats.dispatches++;
      pass.setBindGroup(0, bg); pass.setPipeline(reg.get(name));
      for (let i = 0; i < self.repeat; i++) { pass.dispatchWorkgroups(groups, groups); c.dispatches++; }
    },
  };
  return self;
}
