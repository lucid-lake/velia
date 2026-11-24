// Play as Tessie, phase 2a (§ 3.10; owner, 2026-11-20: "the other demos let the camera move gradually from above water to
// fully inside"): the eye at the waterline, drawn per pixel. In the deferred 'under' group (only where src/core/features.js
// tessieUnder is on):
//   under-back   the underwater background where nothing drew (no bed past 60 m, past the bed's range), in the sky's place while the eye
//                is under: the water's own light along the view at the eye's depth (umBack: navy below, brighter toward the surface).
//                Abyssal Garden's vsB / fsB shape (a full-screen triangle at the far plane; MIT © 2026 Maksymilian Dendura,
//                render/LICENSE-abyssal-garden.txt) with Tahoe's numbers.
//   the split    while the surface is within LENS.band of the eye (main.js 'under-split'), the scene is drawn a second time for the
//                other side of the surface into the split's own targets (the air's pipelines or the under-water twins, from its own copy
//                of the frame block: the eye just on that side, the near plane at the lens, so the surface crossed at the lens is not
//                drawn there and the water beyond it is), then under-merge lays it over the frame per pixel: each pixel takes
//                the side its view ray starts on, the side of the real (wavy) surface its point LENS.m along the view is on (the
//                surface's height and two slopes at the lens, F.under, and a small moving ripple). So with the eye at the waterline
//                the frame is half and half, the line across the view rising and falling with the swell, the above-water pixels by the
//                air's path and the below-water pixels by the water's, at every camera height; no switch, no wipe. A thin dark meniscus
//                and a 1 px bright edge mark the line. No droplets, no blur, no flash (no lens effects in play). The virtual
//                lens (LENS.m) stands in for a camera housing: the eye's ray is judged a hand ahead of it, so the split shows over
//                about ±0.5 m of the eye's height (a real lens would show it over millimetres: a switch). Abyssal Garden keeps its eye
//                1.2 m under the surface and web-ocean above it (neither crosses); the per-pixel side test is ours.
import { ATMO_WGSL, SKY_READ } from './sky.js';
import { WATER_WGSL } from './terrain.js';
import { UNDER_WGSL } from './underMedium.js';
import { FULLSCREEN } from './shaders.js';

export const SPLIT_IDLE = 60;   // frames without the split before its targets are freed (1 s at 60 fps; a swim along the band's edge keeps them)
export const LENS = Object.freeze({ m: 1.0, band: 1.5, ripple: 0.025, meniscusPx: 2.0 });   // m along the view (the virtual lens); m of eye height the split runs within; m of ripple; px

// the waterline on the lens (the CPU's twin of the shader's test, for the tests): the point m along the unit view dir from the eye against
// the surface (height h, slopes sx, sz at the lens) → the signed height of the point over the surface (m; < 0: the pixel takes the water's path)
export function lensSide(eye, dir, { h = 0, sx = 0, sz = 0 } = {}, m = LENS.m) {
  const p = [eye[0] + dir[0] * m, eye[1] + dir[1] * m, eye[2] + dir[2] * m];
  return p[1] - (h + sx * (p[0] - eye[0]) + sz * (p[2] - eye[2]));
}
// which side each pixel takes: 'water' | 'air' (the merge's rule, for the tests)
export const pixelSide = (eye, dir, surf, m = LENS.m) => (lensSide(eye, dir, surf, m) < 0 ? 'water' : 'air');

const UNDER_BACK_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${FULLSCREEN}
${ATMO_WGSL}
${SKY_READ}
${WATER_WGSL}
${UNDER_WGSL}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  return vec4f(umBack(viewDir(v.ndc)), 1.0);
}`;

const UNDER_MERGE_WGSL = (frameStruct) => `diagnostic(off, derivative_uniformity);
${frameStruct}
@group(0) @binding(0) var<uniform> F: Frame;
${FULLSCREEN}
@group(1) @binding(0) var tOther: texture_2d<f32>;
const LENS_M = ${LENS.m.toFixed(3)}; const LENS_RIP = ${LENS.ripple.toFixed(4)}; const LENS_MEN = ${LENS.meniscusPx.toFixed(2)};
// the signed height (m) of the pixel's lens point over the surface at the lens (< 0: its ray starts in the water), a ripple's two crossed swells on it
fn lensF(ndc: vec2f) -> f32 {
  let d = viewDir(ndc);
  let p = F.cam.xyz + d * LENS_M;
  let rx = p.x - F.cam.x; let rz = p.z - F.cam.z;
  let rip = LENS_RIP * (sin(p.x * 5.1 + F.cam.w * 2.3) * 0.6 + sin(p.z * 3.7 - F.cam.w * 1.7 + p.x * 1.9) * 0.4);
  return p.y - (F.under.y + F.under.z * rx + F.under.w * rz + rip);
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let f = lensF(v.ndc);
  let px = f / max(fwidth(f), 1e-6);           // the pixel's distance to the line (px; < 0 under it)
  let mainWater = F.underK.x > 0.5;            // the side the frame was drawn for
  let pixWater = px < 0.0;
  var c = vec4f(0.0);
  if (pixWater != mainWater) { c = vec4f(textureLoad(tOther, vec2i(v.pos.xy), 0).rgb, 1.0); }   // the other side's drawing
  // the meniscus: a thin dark band along the line, a 1 px bright edge on its air side
  let dark = (1.0 - smoothstep(0.0, LENS_MEN, abs(px))) * 0.7;
  let edge = (1.0 - smoothstep(0.0, 1.0, abs(px - 1.5))) * 0.25;
  c = vec4f(c.rgb * (1.0 - dark) + vec3f(edge), max(c.a, max(dark, edge)));
  return c;
}`;

export function createUnderBack({ device, reg, frameBGL, sky, frameStruct, hdrTarget, msaa = 1, depthFormat = 'depth32float', hdrFormat = 'rgba16float' }) {
  const prev = reg.group?.('under');
  const m = reg.shader('under-back', UNDER_BACK_WGSL(frameStruct));
  reg.add('under-back', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, sky.skyBGL] }), vertex: { module: m, entryPoint: 'vs' }, fragment: { module: m, entryPoint: 'fs', targets: [hdrTarget] },
    primitive: { topology: 'triangle-list' }, depthStencil: { format: depthFormat, depthWriteEnabled: false, depthCompare: 'greater-equal' }, multisample: { count: msaa } });
  // the merge: onto the frame's single-sample colour (the resolve), no depth
  const mergeBGL = device.createBindGroupLayout({ label: 'under-merge', entries: [{ binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'unfilterable-float' } }] });
  const mm = reg.shader('under-merge', UNDER_MERGE_WGSL(frameStruct));
  const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' } };
  reg.add('under-merge', { layout: device.createPipelineLayout({ bindGroupLayouts: [frameBGL, mergeBGL] }), vertex: { module: mm, entryPoint: 'vs' }, fragment: { module: mm, entryPoint: 'fs', targets: [{ format: hdrFormat, blend }] },
    primitive: { topology: 'triangle-list' } });
  if (prev != null) reg.group(prev);
  // the split's own targets: the other side's colour (at the scene's sample count, resolved) and depth; made on the first use and on a resize,
  // freed after SPLIT_IDLE frames without the split (refactor round 3 B4: 219 MB at 2560 × 1600, 4× MSAA, held for the whole visit after
  // her first surface swap) and made again on the next use (three textures and a bind group: no pipeline, the merge's layout kept)
  const T = { w: 0, h: 0, n: 0, color: null, resolve: null, depth: null, colorView: null, resolveView: null, depthView: null, bg: null, idle: 0 };
  function release() {
    for (const k of ['color', 'resolve', 'depth']) { T[k]?.destroy(); T[k] = null; }
    T.colorView = T.resolveView = T.depthView = T.bg = null; T.w = T.h = T.n = 0;
  }
  function ensure(w, h, n) {
    T.idle = 0;
    if (T.w === w && T.h === h && T.n === n && T.color) return;
    release();
    T.w = w; T.h = h; T.n = n;
    T.color = device.createTexture({ label: 'under-split', size: [w, h], format: hdrFormat, sampleCount: n, usage: GPUTextureUsage.RENDER_ATTACHMENT | (n === 1 ? GPUTextureUsage.TEXTURE_BINDING : 0) });
    T.colorView = T.color.createView();
    if (n > 1) { T.resolve = device.createTexture({ label: 'under-split-resolve', size: [w, h], format: hdrFormat, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING }); T.resolveView = T.resolve.createView(); }
    else { T.resolve = null; T.resolveView = T.colorView; }
    T.depth = device.createTexture({ label: 'under-split-depth', size: [w, h], format: depthFormat, sampleCount: n, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    T.depthView = T.depth.createView();
    T.bg = device.createBindGroup({ layout: mergeBGL, entries: [{ binding: 0, resource: T.resolveView }] });
  }
  const stats = { back: 0, split: 0 };
  return {
    stats,
    // the background (in the sky's place) while the eye is under
    drawBack(pass, c) {
      if (!reg.has?.('under-back')) return false;
      pass.setBindGroup(1, sky.skyBG); pass.setPipeline(reg.get('under-back')); pass.draw(3); c.calls++; c.triangles += 1; stats.back++;
      return true;
    },
    ready: () => !!reg.has?.('under-merge') && !!reg.has?.('under-back'),
    // a frame without the split (she left the band, dived, or was given back): the targets go after SPLIT_IDLE such frames
    skip() { if (T.color && ++T.idle >= SPLIT_IDLE) release(); },
    get held() { return !!T.color; },
    // the split: draw(pass) draws the other side's scene into the split's targets; then the merge over the frame's resolved colour
    encode(enc, { targets, msaa, frameBG, offset, draw, ts }) {
      ensure(targets.w, targets.h, msaa);
      const d = { label: 'under-split', colorAttachments: [{ view: T.colorView, resolveTarget: msaa > 1 ? T.resolveView : undefined, loadOp: 'clear', storeOp: msaa > 1 ? 'discard' : 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        depthStencilAttachment: { view: T.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' } };
      if (ts) d.timestampWrites = { querySet: ts.querySet, beginningOfPassWriteIndex: ts.beginningOfPassWriteIndex };
      const p1 = enc.beginRenderPass(d); draw(p1); p1.end();
      const m2 = { label: 'under-merge', colorAttachments: [{ view: targets.resolveView, loadOp: 'load', storeOp: 'store' }] };
      if (ts) m2.timestampWrites = { querySet: ts.querySet, endOfPassWriteIndex: ts.endOfPassWriteIndex };
      const p2 = enc.beginRenderPass(m2);
      p2.setBindGroup(0, frameBG, [offset]); p2.setBindGroup(1, T.bg); p2.setPipeline(reg.get('under-merge')); p2.draw(3); p2.end();
      stats.split++;
      return true;
    },
  };
}
