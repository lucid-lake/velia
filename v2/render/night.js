// The night's GPU side (M5e): the Milky Way's maps and the night record the sky draw and the water read
// (night-read.js), the stars as one instanced draw of soft points (v1's catalogue, the library's twinkle), and the
// glows: the towns' lights on the shore (v1's layout, packed: tools/v2-lights-pack.mjs) and the boat's nav lights, as
// camera-facing additive quads with a minimum size on screen and the energy of a far light spread over it. Everything
// is made at load (the textures at their full size, the buffers at their caps) and the data streams in after the first
// frame on a live page (a capture: before it), so there is nothing to create later and 0 pipelines after the first frame.
//   const night = createNight({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa, depthFormat });
//   createSky({ …, night })  night.attach(sky)      the sky draw binds night.bgl; the stars' pipeline binds the sky's group
//   night.waterBind(b0) → { layout, entries }      the record and the maps as the water draw group's bindings b0…b0+3
//   night.update({ hour, sunElevDeg, moon, levels, t, pose, eye, dims, focalPx })   each frame, before the uniform upload
//   night.load() → Promise (idempotent)             the maps, the stars and the lights (≈ 2.9 MB; 0.38 MB with milkyWay: false)
//   night.draw(pass, c, { boat })                   after the sky: the stars, the town lights, the boat's lights
//   night.setRace(f32, n)                           step D: a night race's lit marks (regatta/nightMarks.js raceLights), n 0 for none
import { NIGHT, decodeStars, decodeLights, navLights, NAV_GLOW, FAR_POINT, GLOW_FLOATS, STAR_FLOATS, LIGHT_FLOATS } from '../sim/night.js';
import { NIGHT_READ } from './night-read.js';
import { ATMO_WGSL, SKY_READ } from './sky.js';
import { createMoon } from '../sim/moon.js';

const TEX = globalThis.GPUTextureUsage ?? { TEXTURE_BINDING: 4, COPY_DST: 2, RENDER_ATTACHMENT: 16 };
const BUF = globalThis.GPUBufferUsage ?? { COPY_DST: 8, UNIFORM: 64, STORAGE: 128 };
const STAGE = globalThis.GPUShaderStage ?? { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

// feat/v2-sky-v1-grade: v1's desktop map (4K, 2.4 MB, its desktop size: src/core/index.js), one channel (r8unorm: the same 8 MB of GPU memory
// as the 2K map in rgba8 was); a phone never fetches it
export const NIGHT_FILES = Object.freeze({ mw: '/data/sky/milkyway-4k.webp', tint: '/data/sky/milkyway-tint.png', mwSize: [4096, 2048], tintSize: [256, 128], mwFormat: 'r8unorm' });
export const CAPS = Object.freeze({ stars: 10000, lights: 32768, nav: 4, race: 24 });   // nav: the sidelights, the sternlight, the anchor light   // race: step D's lit marks (24 since the glass boat's three nav lights, 2026-11-18) (regatta/nightMarks.js NIGHT_MARKS.max: 12), then the channel markers' lamps (v2/sim/channelMarks.js markLights)
export const GLOW = Object.freeze({ townRadiance: 0.5, minPx: 3.0, energyPow: 1.4, townsBelowDeg: 4 });   // a town window's HDR radiance when on; the point's least size on screen; the far light's energy fall-off
// the lights in the water (look/v2-night-look): each town and nav light drawn again at its mirror image under the lake's
// plane (y = 0), as a soft vertical streak stretch × its glow's size (a rippled lake draws a light into a column), broken
// along its length by moving ripples, each light on its own phase; k its share of the light (the water's Fresnel at a
// grazing look plus the ripples' spread), depth-tested at the point where the ray meets the water, so the land, the boat
// and the bed's dry ground hide it where the water is not
// a town light's image at k, a nav light's at navK and navW of its halo's width (its halo is a 22 px floor: at full width its column
// read as a solid white bar under the stern)
export const GLOW_REFLECT = Object.freeze({ k: 0.22, navK: 0.0006, navW: 0.5, stretch: 7, minPx: 2.0, ripple: Object.freeze([11.0, 2.2]), near: 0.985 });

// --- the stars: one soft point an instance, placed in the vertex stage from the catalogue ---
export const STARS_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${ATMO_WGSL}
${SKY_READ}
${NIGHT_READ(2, 0)}
@group(2) @binding(4) var<storage, read> STARS: array<vec4f>;
struct SV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f, @location(2) sig: f32 }
const TW_AMP = ${NIGHT.twinkle.amp}; const TW_HOR = ${NIGHT.twinkle.horizon}; const TW_HZ0 = ${NIGHT.twinkle.hz[0]}; const TW_HZ1 = ${NIGHT.twinkle.hz[1]}; const TW_COL = ${NIGHT.twinkle.colour};
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> SV {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let a = STARS[ii * 2u]; let b = STARS[ii * 2u + 1u];
  let d = normalize(vec3f(dot(NU.m0.xyz, a.xyz), dot(NU.m1.xyz, a.xyz), dot(NU.m2.xyz, a.xyz)));
  var o: SV; o.uv = vec2f(0.0); o.sig = 1.0;
  let clip = F.viewProj * vec4f(F.cam.xyz + d * 50000.0, 1.0);
  if (d.y < -0.01 || clip.w <= 0.0 || NU.p.y <= 0.0) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); o.col = vec3f(0.0); return o; }
  // feat/v2-sky-v1-grade: v1's pin-points. The star's light over a small gaussian: sigma NU.p.z px for the faint ones, up to
  // NU.q.w px for the brightest (magnitude −1 and brighter); the quad 3 sigma each way (at least 1.5 px)
  let sig = mix(NU.p.z, NU.q.w, 1.0 - smoothstep(-1.0, 4.0, a.w));
  let ext = max(3.0 * sig, 1.5);
  o.uv = corners[vi] * ext; o.sig = sig;
  let ndc = clip.xy / clip.w + corners[vi] * ext * F.res.zw * 2.0;
  o.pos = vec4f(ndc, 0.0, 1.0);
  // the brightness: the magnitude (10^(−0.4 m)), the air's extinction along d, the clouds' transmittance, the twinkle
  // (a seeded sum of two sines on the scene clock, more near the horizon: v1's round 5)
  let seed = fract(sin(f32(ii) * 12.9898) * 43758.5453);
  let t = NU.p.w;
  let s1 = sin(t * TW_HZ0 * 6.2831853 * (seed * 0.6 + 0.7) + seed * 61.7);
  let s2 = sin(t * TW_HZ1 * 6.2831853 * (seed * 0.5 + 0.75) + seed * 17.3);
  let air = (1.0 - smoothstep(0.05, 0.5, d.y));
  let k = 1.0 + (s1 * 0.6 + s2 * 0.4) * mix(TW_AMP, TW_HOR, air);
  let tint = vec3f(1.0 + s2 * TW_COL * air, 1.0, 1.0 - s2 * TW_COL * air);
  let rCam = Rg + F.sky.z;
  let L = NU.p.y * pow(10.0, -0.4 * a.w) * k * cloudAt(d).a / (6.2831853 * sig * sig);   // the peak: the light ÷ the gaussian's area
  o.col = b.xyz * tint * L * transAt(rCam, max(d.y, 0.0));
  return o;
}
@fragment fn fs(v: SV) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  return vec4f(v.col * exp(-r2 / (2.0 * v.sig * v.sig)), 1.0);
}`;

// --- the glows: a camera-facing soft quad a light, from a storage list; two modes in one pipeline (the record's w) ---
export const GLOWS_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
struct GlowU { mode: f32, radiance: f32, minPx: f32, focalPx: f32 }
struct Glow { p: vec4f, c: vec4f }   // p: x, y, z, size (m); c: r, g, b, w = the switch-on sun elevation (deg; mode 0) or the radiance now (mode 1)
@group(1) @binding(0) var<uniform> GU: GlowU;
@group(1) @binding(1) var<storage, read> G: array<Glow>;
struct GV { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) col: vec3f, @location(2) ph: f32 }
// A1: the nav lights (mode 1) as v1's halos: the quad's full width max(size, minPx px), no energy fall-off with distance
@vertex fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> GV {
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0), vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
  let g = G[ii];
  var o: GV; o.uv = corners[vi];
  let sunE = asin(clamp(F.sun.y, -1.0, 1.0)) * 57.29578;
  var on = g.c.w;
  let refl = GU.mode > 1.5; let mode = select(GU.mode, GU.mode - 2.0, refl);   // 2, 3: a town's or a nav light's image in the water
  if (mode < 0.5) { on = smoothstep(g.c.w + 1.0, g.c.w - 1.0, sunE) * GU.radiance; }   // a town light: on from its own sun elevation
  // the image: the light mirrored under the lake's plane; its depth where the eye's ray to it meets the water (a little nearer)
  let pm = select(g.p.xyz, vec3f(g.p.x, -g.p.y, g.p.z), refl);
  let clip = F.viewProj * vec4f(pm, 1.0);
  if (on <= 0.001 || clip.w <= 0.2 || (refl && (g.p.y <= 0.0 || F.cam.y <= 0.0))) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); o.col = vec3f(0.0); return o; }
  // a negative size: a far point light (sim/night.js FAR_POINT): the floor and the level fall with the distance past nearM
  let farPt = g.p.w < 0.0; let fk = select(0.0, smoothstep(${FAR_POINT.nearM.toFixed(1)}, ${FAR_POINT.farM.toFixed(1)}, clip.w), farPt);
  let pxTrue = abs(g.p.w) / clip.w * GU.focalPx;
  var px = max(pxTrue, mix(GU.minPx, min(GU.minPx, ${FAR_POINT.minPx.toFixed(1)}), fk));
  on = on * mix(1.0, ${FAR_POINT.dim.toFixed(2)}, fk);
  var fall = pow(min(pxTrue / px, 1.0), ${GLOW.energyPow});   // a far light's energy spread over the least size
  if (mode > 0.5) { px = 0.5 * px; fall = 1.0; }   // A1: size and minPx are the halo's full width; v1 keeps the level
  var ext = vec2f(px, px); var z = clip.z / clip.w;
  if (refl) {
    let q = F.cam.xyz + (pm - F.cam.xyz) * (F.cam.y / (F.cam.y + g.p.y) * ${GLOW_REFLECT.near});
    let cq = F.viewProj * vec4f(q, 1.0); z = cq.z / max(cq.w, 1e-4);
    let nv = mode > 0.5; let wR = select(px, px * ${GLOW_REFLECT.navW.toFixed(2)}, nv);
    ext = vec2f(wR, px * ${GLOW_REFLECT.stretch.toFixed(1)}); fall *= select(${GLOW_REFLECT.k.toFixed(3)}, ${GLOW_REFLECT.navK.toFixed(3)}, nv);
    o.ph = fract(sin(f32(ii) * 12.9898) * 43758.5453) * 6.2832;
  }
  let ndc = clip.xy / clip.w + corners[vi] * ext * F.res.zw * 2.0;
  o.pos = vec4f(ndc * clip.w, z * clip.w, clip.w);
  o.col = g.c.rgb * on * fall;
  return o;
}
@fragment fn fs(v: GV) -> @location(0) vec4f {
  let r2 = dot(v.uv, v.uv);
  // A1: v1's halo (src/boat/details-mesh.js): a hot core and a faint round bloom gone well inside the quad (0.006 : 0.6)
  // the image in the water: a soft column, brightest at its middle, broken along its length by the moving ripples
  if (GU.mode > 1.5) {
    let a = sin(v.uv.y * ${GLOW_REFLECT.ripple[0].toFixed(1)} + F.cam.w * ${GLOW_REFLECT.ripple[1].toFixed(1)} + v.ph); let b = sin(v.uv.y * 4.3 - F.cam.w * 1.3 + 2.0 * v.ph);
    let rip = smoothstep(0.1, 0.9, 0.5 + 0.5 * a) * (0.6 + 0.4 * b);   // dashes that drift: the ripples carrying the light
    let wob = v.uv.x + 0.25 * sin(v.uv.y * 7.0 + F.cam.w * 1.7 + v.ph);   // the column sways a little with the waves
    return vec4f(v.col * exp(-wob * wob * 6.0) * exp(-v.uv.y * v.uv.y * 3.0) * max(rip, 0.0), 1.0);
  }
  if (GU.mode > 0.5) { return vec4f(v.col * (exp(-r2 * 200.0) + 0.01 * exp(-r2 * 12.0)), 1.0); }
  return vec4f(v.col * exp(-r2 * 4.0) * step(r2, 1.0), 1.0);
}`;

export function createNight({ device, reg, frameBGL, frameBG, U, frameStruct, hdrTarget, msaa = 1, depthFormat = 'depth32float', errors = [], place = null, fetchImpl = (u) => fetch(u), milkyWay = true }) {
  const VF = STAGE.VERTEX | STAGE.FRAGMENT;
  const tex = (label, [w, h], format = 'rgba8unorm') => device.createTexture({ label, size: [w, h], format, usage: TEX.TEXTURE_BINDING | TEX.COPY_DST | TEX.RENDER_ATTACHMENT });
  // milkyWay false (a phone: src/core/features.js): the maps are never fetched, 1 × 1 textures stand in and the band's
  // scale stays 0 (the sky and the water read no Milky Way); the stars, the moon and the lights are unchanged
  const tMW = tex('night-milkyway', milkyWay ? NIGHT_FILES.mwSize : [1, 1], NIGHT_FILES.mwFormat), tMWt = tex('night-milkyway-tint', milkyWay ? NIGHT_FILES.tintSize : [1, 1]);
  const vMW = tMW.createView(), vMWt = tMWt.createView();
  const sMW = device.createSampler({ label: 'night-map', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', magFilter: 'linear', minFilter: 'linear' });
  const NU = new Float32Array(20);
  const nuBuf = device.createBuffer({ label: 'night-record', size: NU.byteLength, usage: BUF.UNIFORM | BUF.COPY_DST });
  const starsBuf = device.createBuffer({ label: 'night-stars', size: CAPS.stars * STAR_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const lightsBuf = device.createBuffer({ label: 'night-lights', size: CAPS.lights * GLOW_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const navBuf = device.createBuffer({ label: 'night-nav', size: CAPS.nav * GLOW_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const nav = new Float32Array(CAPS.nav * GLOW_FLOATS);
  const raceBuf = device.createBuffer({ label: 'night-race', size: CAPS.race * GLOW_FLOATS * 4, usage: BUF.STORAGE | BUF.COPY_DST });
  const glowU = [new Float32Array([0, GLOW.townRadiance, GLOW.minPx, 1000]), new Float32Array([1, 0, NAV_GLOW.minPx, 1000]),   // A1: the nav lights' own floor (v1's 22 px)
    new Float32Array([2, GLOW.townRadiance, GLOW_REFLECT.minPx, 1000]), new Float32Array([3, 0, NAV_GLOW.minPx, 1000])];   // their images in the water
  const glowBufs = glowU.map((_, i) => device.createBuffer({ label: `night-glow-${i}`, size: 16, usage: BUF.UNIFORM | BUF.COPY_DST }));
  // the night group (the sky draw's group 2, the stars' too): the record, the maps, the sampler, the stars
  const bgl = device.createBindGroupLayout({ label: 'night', entries: [
    { binding: 0, visibility: VF, buffer: { type: 'uniform' } }, { binding: 1, visibility: VF, texture: {} }, { binding: 2, visibility: VF, texture: {} }, { binding: 3, visibility: VF, sampler: {} },
    { binding: 4, visibility: STAGE.VERTEX, buffer: { type: 'read-only-storage' } }] });
  const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: nuBuf } }, { binding: 1, resource: vMW }, { binding: 2, resource: vMWt }, { binding: 3, resource: sMW }, { binding: 4, resource: { buffer: starsBuf } }] });
  const glowBGL = device.createBindGroupLayout({ label: 'night-glow', entries: [{ binding: 0, visibility: VF, buffer: { type: 'uniform' } }, { binding: 1, visibility: STAGE.VERTEX, buffer: { type: 'read-only-storage' } }] });
  const bgTowns = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[0] } }, { binding: 1, resource: { buffer: lightsBuf } }] });
  const bgNav = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[1] } }, { binding: 1, resource: { buffer: navBuf } }] });
  const bgTownsR = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[2] } }, { binding: 1, resource: { buffer: lightsBuf } }] });
  const bgNavR = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[3] } }, { binding: 1, resource: { buffer: navBuf } }] });
  // step D: the race's lit marks draw as nav lights (the halo, its 22 px floor, the faint image in the water) from their own list
  const bgRace = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[1] } }, { binding: 1, resource: { buffer: raceBuf } }] });
  const bgRaceR = device.createBindGroup({ layout: glowBGL, entries: [{ binding: 0, resource: { buffer: glowBufs[3] } }, { binding: 1, resource: { buffer: raceBuf } }] });
  const moon = createMoon(place ?? undefined);
  const M = new Float32Array(9);
  const state = { loaded: false, loading: null, error: null, stars: 0, lights: 0, band: 0, k: 0, bytes: 0, loadMs: 0, race: 0, milkyWay: !!milkyWay };
  device.queue.writeBuffer(nuBuf, 0, NU);
  for (let i = 0; i < glowU.length; i++) device.queue.writeBuffer(glowBufs[i], 0, glowU[i]);

  return {
    bgl, bg, moon, stats: state, textures: { tMW, tMWt }, buffers: { nuBuf, starsBuf, lightsBuf, navBuf, raceBuf },
    // step D: a night race's lit marks for this frame (GLOW_FLOATS each); n 0 draws none (a day race, outside a race)
    setRace(f32, n = 0) {
      const k = Math.max(0, Math.min(CAPS.race, n | 0));
      if (k > 0) device.queue.writeBuffer(raceBuf, 0, f32, 0, k * GLOW_FLOATS);
      state.race = k;
    },
    // the record and the maps as another draw group's bindings (the water: its group 2, bindings b0…b0+3)
    waterBind(b0 = 4) {
      return {
        layout: [{ binding: b0, visibility: STAGE.FRAGMENT, buffer: { type: 'uniform' } }, { binding: b0 + 1, visibility: STAGE.FRAGMENT, texture: {} }, { binding: b0 + 2, visibility: STAGE.FRAGMENT, texture: {} }, { binding: b0 + 3, visibility: STAGE.FRAGMENT, sampler: {} }],
        entries: [{ binding: b0, resource: { buffer: nuBuf } }, { binding: b0 + 1, resource: vMW }, { binding: b0 + 2, resource: vMWt }, { binding: b0 + 3, resource: sMW }],
      };
    },
    // the two draw pipelines, on the registry at load (after createSky: the stars bind the sky's read group for the air)
    attach(sky) {
      const add = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
      const mS = reg.shader('night-stars', STARS_WGSL(frameStruct));
      reg.add('night-stars', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL, bgl] }), vertex: { module: mS, entryPoint: 'vs' }, fragment: { module: mS, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: add }] },
        primitive: { topology: 'triangle-list' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: msaa } });
      const mG = reg.shader('night-glows', GLOWS_WGSL(frameStruct));
      reg.add('night-glows', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, glowBGL] }), vertex: { module: mG, entryPoint: 'vs' }, fragment: { module: mG, entryPoint: 'fs', targets: [{ ...hdrTarget, blend: add }] },
        primitive: { topology: 'triangle-list' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: msaa } });
    },
    // the maps, the catalogue and the lights (idempotent; a live page calls it once the sun is low, a capture before its first frame)
    load() {
      if (state.loading) return state.loading;
      const t0 = performance.now();
      state.loading = (async () => {
        const base = document.baseURI;
        const bitmap = async (url) => { const r = await fetchImpl(new URL(url, base)); if (!r.ok) throw new Error(`${url}: ${r.status}`); const b = await r.blob(); state.bytes += b.size; return createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); };
        const bytes = async (url) => { const r = await fetchImpl(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); const a = new Uint8Array(await r.arrayBuffer()); state.bytes += a.byteLength; return a; };
        const [mw, tint, st, li] = await Promise.all([milkyWay ? bitmap(NIGHT_FILES.mw) : null, milkyWay ? bitmap(NIGHT_FILES.tint) : null, bytes(new URL('../assets/night/stars.bin', import.meta.url)), bytes(new URL('../assets/night/lights.bin', import.meta.url))]);
        if (mw) device.queue.copyExternalImageToTexture({ source: mw }, { texture: tMW }, NIGHT_FILES.mwSize);
        if (tint) device.queue.copyExternalImageToTexture({ source: tint }, { texture: tMWt }, NIGHT_FILES.tintSize);
        const S = decodeStars(st), L = decodeLights(li);
        state.stars = Math.min(S.count, CAPS.stars); state.lights = Math.min(L.count, CAPS.lights);
        device.queue.writeBuffer(starsBuf, 0, S.data, 0, state.stars * STAR_FLOATS);
        // the lights as glow records: x, y, z, size | r, g, b, the switch-on elevation
        const G = new Float32Array(state.lights * GLOW_FLOATS);
        for (let i = 0; i < state.lights; i++) { const k = i * LIGHT_FLOATS, o = i * GLOW_FLOATS; G[o] = L.data[k]; G[o + 1] = L.data[k + 1]; G[o + 2] = L.data[k + 2]; G[o + 3] = L.data[k + 6]; G[o + 4] = L.data[k + 3]; G[o + 5] = L.data[k + 4]; G[o + 6] = L.data[k + 5]; G[o + 7] = L.data[k + 7]; }
        device.queue.writeBuffer(lightsBuf, 0, G);
        state.loaded = true; state.loadMs = +(performance.now() - t0).toFixed(1);
        return true;
      })().catch((e) => { state.error = String(e?.message ?? e); errors.push(`night: ${state.error}`); return false; });
      return state.loading;
    },
    // each frame, before the uniform ring's upload: the record (the sky's rotation at the hour, the levels, the twinkle's
    // clock), the boat's nav lights, the glows' focal length
    update({ hour, levels, t = 0, pose = null, eye, dims = null, sunElevDeg = 90, focalPx = 1000, mastHead = null }) {   // mastHead: the anchor light's hull-frame point (lit while pose.anchorLight)
      moon.skyMatrix(hour, M);
      NU[0] = M[0]; NU[1] = M[1]; NU[2] = M[2]; NU[4] = M[3]; NU[5] = M[4]; NU[6] = M[5]; NU[8] = M[6]; NU[9] = M[7]; NU[10] = M[8];
      const band = state.loaded ? levels.band : 0;
      NU[12] = milkyWay ? band * NIGHT.band * NIGHT.bandShow * NIGHT.airglow : 0; NU[13] = band * NIGHT.starScale; NU[14] = NIGHT.starPx; NU[15] = t;
      NU[16] = state.stars; NU[17] = state.lights; NU[18] = GLOW.townRadiance; NU[19] = NIGHT.starPxMax;
      device.queue.writeBuffer(nuBuf, 0, NU);
      state.band = band; state.k = levels.k;
      for (const u of glowU) u[3] = focalPx;
      device.queue.writeBuffer(glowBufs[0], 0, glowU[0]); device.queue.writeBuffer(glowBufs[2], 0, glowU[2]);
      if (pose && dims) navLights(nav, { pose, sunElevDeg, eye, dims, anchored: !!pose.anchorLight, mastHead }), device.queue.writeBuffer(navBuf, 0, nav);
      if ((pose && dims) || state.race > 0) { device.queue.writeBuffer(glowBufs[1], 0, glowU[1]); device.queue.writeBuffer(glowBufs[3], 0, glowU[3]); }   // step D: the race's marks share the nav lights' record
      state.navOn = !!(pose && dims) && sunElevDeg < 1.5;
      state.townsOn = state.loaded && sunElevDeg < GLOW.townsBelowDeg;
    },
    // after the sky: the stars (where the sky is), then the glows (depth-tested against the world)
    draw(pass, c, sky) {
      if (state.band > 0 && state.stars > 0) {
        pass.setBindGroup(1, sky.skyBG); pass.setBindGroup(2, bg);
        pass.setPipeline(reg.get('night-stars')); pass.draw(6, state.stars); c.calls++; c.triangles += state.stars * 2;
      }
      if (state.townsOn || state.navOn || state.race > 0) pass.setPipeline(reg.get('night-glows'));
      if (state.townsOn) { pass.setBindGroup(1, bgTowns); pass.draw(6, state.lights); pass.setBindGroup(1, bgTownsR); pass.draw(6, state.lights); c.calls += 2; c.triangles += state.lights * 4; }
      if (state.navOn) { pass.setBindGroup(1, bgNav); pass.draw(6, CAPS.nav); pass.setBindGroup(1, bgNavR); pass.draw(6, CAPS.nav); c.calls += 2; c.triangles += CAPS.nav * 4; }
      if (state.race > 0) { pass.setBindGroup(1, bgRace); pass.draw(6, state.race); pass.setBindGroup(1, bgRaceR); pass.draw(6, state.race); c.calls += 2; c.triangles += state.race * 4; }
    },
  };
}
