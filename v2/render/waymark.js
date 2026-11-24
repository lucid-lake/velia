// The target beacon's picture (owner ask 2026-11-15; the rules: v2/sim/waymark.js). A soft column of
// light standing on the water over the mark in force, readable from 2–4 km over the far shore, softer near, gone on arrival with a
// lift and a ring on the water. The owner's pick (2026-11-15): the light pillar, in cream: a tall soft beam (cream core, warm glow, a
// slow shimmer), its broken reflection on the water, a pool of light. On by default; ?beacon=0 turns it off (the A/B).
// ONE pipeline ('beacon'), declared at load with the rest (none after the first frame); ONE instanced draw of 4 quads (the beam, the
// water's pool and ring, the reflection, the base glow), after the sky: depth-tested (the land in front hides its foot, its top stands
// over the ridge), no depth written, additive. The widths keep a floor in CSS pixels (pxScale: the backing pixels per CSS pixel, so a
// phone at dpr 3 gets the same on-screen width), so the beam is a few pixels wide at 3 km and a few metres wide close by; far off
// (from farFromM out to farToM) the core and the glow brighten and widen (the owner, 2026-11-15: "bolder far"), near they are as
// before. Colours are divided by the frame's exposure (render/raceLines.js's rule): the cream reads cream at noon and at night; the
// night widens the glow, the storm's haze too. Nothing is recorded while no beacon shows.
//   const BF = createBeaconFx({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa, depthFormat });
//   BF.frame({ snap, y, focalPx, pxScale, t, nightK, haze })   the rules' snapshot (sim/waymark.js) and the frame's facts: one writeBuffer
//   BF.draw(pass, c)                                            the scene pass, after the sky
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

// the colours (linear, before the exposure): the core, the glow. Cream and warm amber are the brand's light (amber only for
// a lit state, never red or green: port and starboard)
export const BEACON_COLOUR = Object.freeze({ core: [1.0, 0.93, 0.80], glow: [1.0, 0.74, 0.42] });
// the shape: H the beam's height (m); coreM / corePx the core's half width floor in metres and in CSS pixels; glowMul the glow's half
// width in cores, glowPx its pixel floor; I the core's brightness; glowI the glow's; reflK the reflection's share; poolM the pool of
// light's radius floor; glowS / glowSPx the base glow's radius floor (m, px); far: from farFromM to farToM the core gains farI and the
// glow farGlowI of their brightness, and the pixel floors farPx of their width (the far beam reads at 2–4 km; near is unchanged)
export const BEACON_LOOK = Object.freeze({ H: 520, coreM: 1.4, corePx: 1.6, glowMul: 9, glowPx: 18, I: 2.4, glowI: 1.0, reflK: 0.55, poolM: 6, glowS: 4, glowSPx: 7,
  farFromM: 700, farToM: 3000, farI: 1.1, farGlowI: 0.8, farPx: 0.6 });
// the arrival's ring on the water (Sail and Cruise; Regatta draws none): a small splash ring tight round the mark (owner, 2026-11-16:
// "too wide"; was 5 → 46 m over the whole 1.6 s), from 3 m out to 15 m over ringS, 0.8 m soft, fading; the arrival distances (50 m
// Sail, 70 m Cruise) stay logic only (sim/waymark.js)
export const BEACON_ARRIVE = Object.freeze({ ringFromM: 3, ringToM: 15, ringS: 0.9, ringWM: 0.8, ringI: 0.6 });
const PARTS = 4;

export const BEACON_WGSL = (fs) => `diagnostic(off, derivative_uniformity);
${fs}
struct BU { p0: vec4f, p1: vec4f, core: vec4f, glow: vec4f, p4: vec4f, n: vec4f, w: vec4f, x: vec4f, y: vec4f }
@group(0) @binding(0) var<uniform> F: Frame;
@group(1) @binding(0) var<uniform> B: BU;
// p0: base x y z, the arrival's seconds (< 0: none) | p1: alpha, near, lift, the ring's radius (m) | core: rgb, I | glow: rgb, glowI
// p4: focal px, haze, H, time | n: the night's k, pxScale, farFromM, farToM | w: coreM, corePx, glowMul, glowPx | x: reflK, poolM, -, ring alpha
// y: glowS, glowSPx, farI, farGlowI (farPx rides in the vertex: far widens the floors)
struct BV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) part: u32, @location(2) @interpolate(flat) k: vec4f }
fn ppm(d: f32) -> f32 { return B.p4.x / max(d, 1.0); }   // backing pixels per metre at distance d
fn farK(d: f32) -> f32 { return smoothstep(B.n.z, B.n.w, d); }
fn toward(p: vec3f, m: f32) -> vec3f { return p + normalize(F.cam.xyz - p) * m; }
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> BV {
  var o: BV;
  o.part = ii;
  var cs = array<vec2f, 6>(vec2f(-1.0, 0.0), vec2f(1.0, 0.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, 0.0), vec2f(1.0, 1.0));
  let c = cs[vi];
  let base = B.p0.xyz; let eye = F.cam.xyz;
  let toE = eye - base; let D = length(toE);
  let hz = normalize(vec3f(toE.z, 0.0, -toE.x) + vec3f(1e-5, 0.0, 0.0));   // the billboard's right (horizontal, square to the eye)
  let up = vec3f(0.0, 1.0, 0.0);
  let night = B.n.x; let haze = B.p4.y; let H = B.p4.z; let lift = B.p1.z;
  let px = B.n.y * (1.0 + ${BEACON_LOOK.farPx.toFixed(2)} * farK(D));           // the pixel floors: CSS px in backing px, wider far
  let wc = max(B.w.x, B.w.y * px / ppm(D));                                    // the core's half width (m)
  let wg = max(wc * B.w.z, B.w.w * px / ppm(D)) * (1.0 + 0.7 * night + 0.6 * haze);  // the glow's
  var P = base;
  if (ii == 0u) {   // the beam: from its foot (lifting away on arrival) to the sky
    let yb = lift * H * 0.85; let yt = H * (1.0 + 0.25 * lift);
    P = base + hz * c.x * wg + up * mix(yb, yt, c.y);
    o.uv = vec2f(c.x * wg / wc, c.y); o.k = vec4f(wg / wc, yt - yb, farK(D), 0.0);
  } else if (ii == 1u) {   // the water's pool and ring: a flat square on the water
    let rest = max(B.x.y, 4.0 * B.n.y / ppm(D));
    let R = max(rest * 2.6, B.p1.w + 10.0);
    let q = vec2f(c.x, c.y * 2.0 - 1.0) * R;
    P = toward(base + vec3f(q.x, 0.25, q.y), 0.9);
    o.uv = q; o.k = vec4f(rest, R, 0.0, 0.0);
  } else if (ii == 2u) {   // the reflection: the beam's foot mirrored under the water, each corner laid on the water along the eye's ray
    let hr = H * 0.14; let wr = max(wc * 2.4, 2.0 * px / ppm(D));
    let Pm = base + hz * c.x * wr - up * (c.y * hr);
    let h0 = max(eye.y - base.y, 0.05);
    let s = h0 / max(h0 + (base.y - Pm.y), 1e-3);
    P = toward(eye + (Pm - eye) * s + vec3f(0.0, 0.15, 0.0), 0.6);
    o.uv = vec2f(c.x, c.y); o.k = vec4f(hr, 0.0, 0.0, 0.0);
  } else {   // the base glow: the bloom where the beam meets the water, facing the eye
    let fwd = normalize(toE); let r = normalize(cross(up, fwd)); let u = cross(fwd, r);
    let s = max(B.y.x, B.y.y * px / ppm(D)) * (1.0 + 0.5 * night + 0.5 * haze) * (1.0 - 0.6 * lift);
    let ctr = base + up * 0.8;
    P = toward(ctr + r * c.x * s + u * (c.y * 2.0 - 1.0) * s, 1.0);
    o.uv = vec2f(c.x, c.y * 2.0 - 1.0); o.k = vec4f(s, 0.0, 0.0, 0.0);
  }
  o.pos = F.viewProj * vec4f(P, 1.0);
  return o;
}
fn ex(c: vec3f) -> vec3f { return c / max(F.params.x, 1e-4); }   // the exposure divided out
@fragment fn fs(v: BV) -> @location(0) vec4f {
  let t = B.p4.w; let a = B.p1.x * B.p1.y; let night = B.n.x; let haze = B.p4.y;
  let boost = 1.0 + 0.35 * night + 0.5 * haze;
  if (v.part == 0u) {
    let qmax = max(v.k.x, 1.0); let q = abs(v.uv.x); let s = q / qmax; let y = v.uv.y; let L = v.k.y; let fk = v.k.z;
    let core = exp(-q * q * 1.3);
    let glow = (exp(-s * s * 9.0) * 0.75 + exp(-s * 3.5) * 0.25) * (1.0 - s);   // a soft halo, its tail out to the quad's edge
    let foot = 1.0 + 1.3 * exp(-y * L / 7.0);                     // brighter where it stands on the water
    let top = pow(1.0 - y, mix(1.7, 1.25, fk)) * smoothstep(0.0, 0.004, y);   // far, it holds its light higher up
    let sh = 0.86 + 0.14 * sin(y * L * 0.07 - t * 1.6 + 2.0 * sin(y * L * 0.019 + t * 0.5));   // a slow shimmer
    let col = B.core.rgb * core * B.core.w * (1.0 + B.y.z * fk) + B.glow.rgb * glow * B.glow.w * (1.0 + 0.6 * night) * (1.0 + B.y.w * fk);
    return vec4f(ex(col * foot * top * sh * a * boost), 0.0);
  }
  if (v.part == 1u) {
    let r = length(v.uv); let rest = v.k.x;
    var col = B.glow.rgb * exp(-(r / rest) * (r / rest) * 1.2) * 0.55 * a;
    if (B.x.w > 0.0) { col += B.core.rgb * exp(-pow((r - B.p1.w) / ${BEACON_ARRIVE.ringWM.toFixed(2)}, 2.0)) * B.x.w * ${BEACON_ARRIVE.ringI.toFixed(2)}; }   // the arrival's ring
    col *= 1.0 - smoothstep(v.k.y * 0.8, v.k.y, r);
    return vec4f(ex(col * boost), 0.0);
  }
  if (v.part == 2u) {   // broken by the ripples, fading down
    let y = v.uv.y; let x = v.uv.x + 0.35 * sin(y * 37.0 + t * 2.3) * y;
    let across = exp(-x * x * 2.2);
    let bands = 0.55 + 0.45 * sin(y * 70.0 - t * 3.1 + sin(y * 23.0 + t));
    let col = (B.core.rgb * 0.6 + B.glow.rgb * 0.6) * across * bands * exp(-y * 3.2) * smoothstep(0.0, 0.03, y);
    return vec4f(ex(col * B.x.x * a * B.core.w * 0.5 * boost), 0.0);
  }
  let r2 = dot(v.uv, v.uv); if (r2 > 1.0) { discard; }
  let col = (B.core.rgb * exp(-r2 * 16.0) * 1.4 + B.glow.rgb * exp(-r2 * 4.5) * 0.5) * (1.0 - r2);
  return vec4f(ex(col * a * boost * (1.0 + 0.6 * B.p1.z)), 0.0);
}`;

export function createBeaconFx({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa = 1, depthFormat = 'depth32float' }) {
  const look = BEACON_LOOK, col = BEACON_COLOUR;
  const data = new Float32Array(36);
  const ubuf = device.createBuffer({ label: 'beacon', size: data.byteLength, usage: BUF.UNIFORM | BUF.COPY_DST });
  const bgl = device.createBindGroupLayout({ label: 'beacon', entries: [{ binding: 0, visibility: STAGE.VERTEX | STAGE.FRAGMENT, buffer: { type: 'uniform' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } }] });
  const m = reg.shader('beacon', BEACON_WGSL(frameStruct));
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  reg.add('beacon', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, bgl] }), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [{ ...hdrTarget, blend }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
  const stats = { visible: false, uploads: 0, draws: 0, phase: 'off', ringA: 0 };
  // the frame's facts in: the rules' snapshot (sim/waymark.js), the water's height at the mark, the focal length (backing px), the
  // backing pixels per CSS pixel, the scene clock (s), the night's k (0 day … 1 night), the haze (the storm's rain and murk, 0–1)
  function frame({ snap, y = 0, focalPx = 600, pxScale = 1, t = 0, nightK = 0, haze = 0 }) {
    stats.visible = !!snap?.visible && snap.alpha + (snap.arriveT >= 0 ? 1 : 0) > 0.001; stats.phase = snap?.phase ?? 'off';
    if (!stats.visible) return;
    const at = snap.arriveT, k = at >= 0 ? Math.min(1, at / BEACON_ARRIVE.ringS) : 0, ease = 1 - (1 - k) ** 3, rung = at >= 0 && snap.ring !== false;   // Regatta: no ring (the mark's zone ring is the race's; owner 2026-11-16)
    const ringR = rung ? BEACON_ARRIVE.ringFromM + (BEACON_ARRIVE.ringToM - BEACON_ARRIVE.ringFromM) * ease : 0, ringA = rung ? (1 - k) ** 2 : 0;
    const ps = Math.min(3, Math.max(1, Number.isFinite(pxScale) ? pxScale : 1));
    data.set([snap.x, y, snap.z, at,
      snap.alpha, snap.near, snap.lift, ringR,
      ...col.core, look.I, ...col.glow, look.glowI,
      focalPx, haze, look.H, t,
      nightK, ps, look.farFromM, look.farToM,
      look.coreM, look.corePx, look.glowMul, look.glowPx,
      look.reflK, look.poolM, 0, ringA,
      look.glowS, look.glowSPx, look.farI, look.farGlowI]);
    device.queue.writeBuffer(ubuf, 0, data); stats.uploads++; stats.ringA = ringA;
  }
  function draw(pass, c) {
    if (!stats.visible) return;   // no beacon: nothing recorded
    pass.setPipeline(reg.get('beacon'));
    pass.setBindGroup(0, frameBG, [U.byteOffset]); pass.setBindGroup(1, bg);
    pass.draw(6, PARTS); c.calls++; c.triangles += 2 * PARTS; stats.draws++;
  }
  return { stats, frame, draw, look, colour: col };
}
