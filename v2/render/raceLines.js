// Regatta's on-water lines (BACKLOG-v2 #12): the start line and its posts, the 20 m line, the
// gold ghost, the laylines (cream, the one to tack on amber; owner 2026-11-15), the mark's zone and turn arrow, the course
// line, the lit finish. ONE pipeline ('race-lines'), declared at load with the rest; one instanced draw of screen-space quads on
// world segments (the rig ribbons' technique), after the water and the sky: depth-tested, no depth written, so hulls and sails
// pass in front (the LiveLine look), premultiplied blend, the glow a falloff across a wider quad (no blur pass). The segments
// sit in one storage buffer made at load (MAX_SEGMENTS × 48 B) and are rewritten only when the race's picture changes.
// Outside a race nothing is recorded: draw() returns before setPipeline (stats.draws counts the draws, the guard test reads it).
//   const RL = createRaceLines({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa, depthFormat });
//   RL.setActive(on)      Regatta on or off (off: no draw, no upload)
//   RL.write(seg, n)      the race's segments (seg: a SegmentWriter's Float32Array, n ≤ MAX_SEGMENTS): one writeBuffer
//   RL.draw(pass, c)      the scene pass, after the sky
// A segment (12 floats, 48 B): ax ay az widthPx | bx by bz glowPx | rgba8 (u32 bits) dashM phaseM flags (1 pulse + 2 far)
// pulse (R3, the coach's lit cue: "Tack at the glowing line" while the target layline glows): 1 makes the glow breathe on the
// frame's clock (F.wind.w, the sim time mod 300 s; LINE_LOOK.pulseS a breath), wider and brighter, the core a little brighter.
// far (R3, the laylines on the beat): the line widens with its distance from the eye, up to LINE_LOOK.farGain more at farM, so a
// layline 300–400 m off still reads near the horizon (R2's constant 3 px did not)
export const MAX_SEGMENTS = 1024;
export const SEG_FLOATS = 12;
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

// the lines' brightness after the tonemap: a colour c draws as aces(c × LINE_GAIN) whatever the exposure (the frame's exposure
// factor is divided out), so the cream reads cream at noon and at dusk
export const LINE_LOOK = Object.freeze({ gain: 1.05, glowAlpha: 0.22, lift: 0.25, toward: 0.9, pulseS: 1.2, pulseGlow: 0.7, pulseAlpha: 0.38, pulseCore: 0.45, farNearM: 60, farM: 400, farGain: 0.9 });

export const RACE_LINES_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
@group(0) @binding(0) var<uniform> F: Frame;
@group(1) @binding(0) var<storage, read> SEG: array<vec4f>;
struct LV { @builtin(position) pos: vec4f, @location(0) across: f32, @location(1) along: f32, @location(2) @interpolate(flat) look: vec4f, @location(3) @interpolate(flat) col: vec4f, @location(4) @interpolate(flat) pulse: f32 }
fn breath() -> f32 { return 0.5 + 0.5 * sin(F.wind.w * ${(2 * Math.PI / LINE_LOOK.pulseS).toFixed(6)}); }
fn unpackCol(u: u32) -> vec4f { return vec4f(f32(u & 255u), f32((u >> 8u) & 255u), f32((u >> 16u) & 255u), f32(u >> 24u)) / 255.0; }
// lifted a little and pulled toward the eye: the waves' crests never cut the line, a hull still passes in front
fn lifted(p: vec3f) -> vec3f { let q = p + vec3f(0.0, ${LINE_LOOK.lift}, 0.0); return q + normalize(F.cam.xyz - q) * ${LINE_LOOK.toward}; }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> LV {
  var o: LV;
  let s0 = SEG[3u * ii]; let s1 = SEG[3u * ii + 1u]; let s2 = SEG[3u * ii + 2u];
  var A = F.viewProj * vec4f(lifted(s0.xyz), 1.0); var B = F.viewProj * vec4f(lifted(s1.xyz), 1.0);
  let len = distance(s0.xyz, s1.xyz);
  var la = 0.0; var lb = len;
  let eps = 0.05;   // the near clip in w (reversed z: w is the view depth)
  if (A.w < eps && B.w < eps) { o.pos = vec4f(0.0, 0.0, -2.0, 1.0); return o; }
  if (A.w < eps) { let t = (eps - A.w) / (B.w - A.w); A = mix(A, B, t); la = len * t; }
  if (B.w < eps) { let t = (eps - B.w) / (A.w - B.w); B = mix(B, A, t); lb = len * (1.0 - t); }
  let half = F.res.xy * 0.5;
  let sa = A.xy / A.w * half; let sb = B.xy / B.w * half;
  var d = sb - sa; let dl = length(d); d = select(vec2f(1.0, 0.0), d / dl, dl > 1e-4);
  let n = vec2f(-d.y, d.x);
  let fl = u32(s2.w + 0.5); let isPulse = (fl & 1u) != 0u; let isFar = (fl & 2u) != 0u;
  let pk = select(0.0, breath(), isPulse);
  let core = 0.5 * s0.w; let glowW = select(s1.w, max(s1.w, 4.0) * (1.0 + ${LINE_LOOK.pulseGlow} * pk), isPulse); let wide = core + glowW + 1.0;
  var cs = array<vec2f, 6>(vec2f(0.0, -1.0), vec2f(1.0, -1.0), vec2f(0.0, 1.0), vec2f(0.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let k = cs[vi];
  var P = select(A, B, k.x > 0.5);
  let sc = select(1.0, 1.0 + ${LINE_LOOK.farGain} * smoothstep(${LINE_LOOK.farNearM.toFixed(1)}, ${LINE_LOOK.farM.toFixed(1)}, P.w), isFar);   // far: wider with distance (the fragment works in unscaled px)
  let off = (n * k.y * wide * sc + d * (k.x * 2.0 - 1.0) * min(wide, 3.0)) / half;   // the quad's half width, and a short cap
  P = vec4f(P.xy + off * P.w, P.zw);
  o.pos = P; o.across = k.y * wide; o.along = mix(la, lb, k.x);
  o.look = vec4f(core, glowW, s2.y, s2.z);
  o.col = unpackCol(bitcast<u32>(s2.x));
  o.pulse = pk;
  return o;
}
@fragment fn fs(v: LV) -> @location(0) vec4f {
  let d = abs(v.across); let core = v.look.x; let glow = max(v.look.y, 1e-3);
  let aa = max(fwidth(v.across), 0.6);
  var a = 1.0 - smoothstep(core - aa, core + aa, d);
  if (v.look.y > 0.0) { let g = max(d - core, 0.0) / glow; a = max(a, (${LINE_LOOK.glowAlpha} + ${LINE_LOOK.pulseAlpha} * v.pulse) * exp(-3.0 * g * g)); }
  if (v.look.z > 0.0) {   // a dash: on for dashM, off for dashM (metres along the segment, perspective-correct)
    let u = fract((v.along + v.look.w) / (2.0 * v.look.z));
    let w = max(fwidth(v.along) / (2.0 * v.look.z), 1e-4);
    a *= 1.0 - smoothstep(0.5 - w, 0.5 + w, u) + smoothstep(1.0 - w, 1.0, u);
  }
  a *= v.col.a;
  let rgb = v.col.rgb * ${LINE_LOOK.gain} * (1.0 + ${LINE_LOOK.pulseCore} * v.pulse) / max(F.params.x, 1e-4);
  return vec4f(rgb * a, a);
}`;

export function createRaceLines({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa = 1, depthFormat = 'depth32float' }) {
  const bytes = MAX_SEGMENTS * SEG_FLOATS * 4;
  const sbuf = device.createBuffer({ label: 'race-lines', size: bytes, usage: BUF.STORAGE | BUF.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'race-lines', entries: [{ binding: 0, visibility: STAGE.VERTEX, buffer: { type: 'read-only-storage' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: sbuf } }] });
  const m = reg.shader('race-lines', RACE_LINES_WGSL(frameStruct));
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  reg.add('race-lines', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bgl] }), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  const stats = { active: false, count: 0, uploads: 0, draws: 0, bytes };
  return {
    stats,
    get active() { return stats.active; },
    setActive(on) { stats.active = !!on; if (!on) stats.count = 0; },
    write(seg, n) {
      if (!stats.active) return;
      n = Math.max(0, Math.min(MAX_SEGMENTS, n | 0));
      if (n) device.queue.writeBuffer(sbuf, 0, seg.buffer, seg.byteOffset, n * SEG_FLOATS * 4);
      stats.count = n; stats.uploads++;
    },
    draw(pass, c) {
      if (!stats.active || !stats.count) return;   // outside a race: nothing recorded
      pass.setPipeline(reg.get('race-lines'));
      pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, bg);
      pass.draw(6, stats.count); c.calls++; c.triangles += 2 * stats.count; stats.draws++;
    },
  };
}
