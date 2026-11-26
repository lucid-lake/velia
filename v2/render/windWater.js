// The wind on v2's water (audit W1–W3, 2026-11-14): v1's recipes, read from the local wind (sim/windTex.js: v1's wind
// texture, bound at WIND_BINDING; the frame's `windfx` row: its centre x, z, the switches, the sea's Hs).
//   W1 the gust patches (src/gustFx-water.js + src/water.js gustW, water-spectrum.js gustVisual, GUST_LOOK): the weight from
//      the local wind over its ≈ 800 m mean (the soft gustVisual × 1.45, a crisp 1.05–1.075 contour ragged by a 9 m noise,
//      a fresh-front band where the wind 28 m downwind is still the old air); the patch's fine ripples (two crossed
//      cosines, 13 and 8.3 cm, along the local wind, slope² 0.04, broken up by a 7 m and a 23 m noise); the mirror cut
//      (× 1 − 0.3 w), the mirrored sky's luminance toward the open sky above (−10 % / +9 %, the hue kept), the glitter
//      dimmed (× 1 − 0.8 w); v1's body tint (GUST_LOOK.body) is not ported (the body's colour stays); the short cascades follow the local wind (v1's
//      rippleFactor against the mean's, on each cascade's gust response).
//   W2 the whitecaps: since #56 M1 the water's own (Ultra's foam on v1's coverage, render/water.js), their onset read on the
//      LOCAL wind (v1's whitecaps gate on it: gusts cap, lees do not); the spume rides them.
//   W3 the wind lanes (src/wind-cues.js streakAt via the look map): render/spume.js spLane along the LOCAL wind, faded where
//      a lane would alias and past v1's look square; a lane darkens like a gust (0.12), roughens (slope² 0.006) and scales
//      the short ripples (× 1 + 0.55 lane: rough lanes, smooth slicks).
// The switches (F.windfx.z bits): 1 the texture holds a fill, 2 the gust look, 4 the lanes, 8 v1's whitecaps, 16 the aged foam's streaks (the in-page A/B:
// __velia.setWindFx). The JS below are the WGSL's reference for the tests.
import { GUST_EDGE, GUST_FULL, GUST_ONSET, GUST_LOOK, WHITECAP, gustResponse, RIPPLE_ONSET } from '../../src/sim/water-spectrum.js';
import { WHITECAP_ONSET } from '../../src/sim/windCues.js';
import { WIND_TEX, WIND_EXTENT } from '../sim/windTex.js';

export const WIND_BINDING = 14;   // after the shore's mirror (12) and #56 M1's surface uniform (13)
// v1's gust look on the water (src/gustFx-water.js GUST_FX), the numbers the port reads
export const GUST_FX = Object.freeze({ gain: 1.45, crisp: [1.05, 1.075], crispW: 0.9, rag: 0.012, ragM: 9, edgeM: 28, edge: 0.5, edgeRatio: [0.03, 0.12],
  slope: 1.1, glint: 0.8, lumDown: 0.1, lumUp: 0.09, skyUp: 0.6, dark: 0.6, fres: 0.3 });
export const LANE = Object.freeze({ dark: 0.12, rip: 0.55, slope2: 0.006, meanPos: 0.205 });   // src/wind-cues.js STREAK_DARK, STREAK_RIP, STREAK_SLOPE2
export const WIND_RESP = Object.freeze([0, gustResponse(5), gustResponse(0.9), gustResponse(0.2)]);   // each cascade's answer to the local wind (as render/wake.js WAKE_RESP)
// ?lanes=: the wind lanes (W3) and the aged foam's streaks. OFF BY DEFAULT (owner, 2026-11-26: "seems detached from the water waves
// below, more like wind lines"); ?lanes=on (or 1) restores today's look, the code paths below are intact. =off / =streaks0 both off
// (the default); =0 the lanes off, the streaks on (the A/B's middle value).
export function lanesMode(v) {
  if (v === 'on' || v === '1') return { lanes: true, streaks: true };
  if (v === '0') return { lanes: false, streaks: true };
  return { lanes: false, streaks: false };
}
export const BITS = Object.freeze({ tex: 1, gust: 2, lanes: 4, caps: 8, streaks: 16 });

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// v1's gustVisual × GUST_FX's soft part, the crisp contour and the front (rag: the 9 m noise's value × 0.012 at the point;
// downU: the wind 28 m downwind) → the gust look's weight 0..1
export function gustWeight(localU, aroundU, downU, rag = 0) {
  const r = localU / Math.max(aroundU, 0.3);
  const soft = (0.7 * sm(GUST_EDGE[0], GUST_EDGE[1], r) + 0.3 * Math.min(1, Math.max(0, (r - GUST_EDGE[1]) / (GUST_FULL - GUST_EDGE[1])))) * sm(GUST_ONSET[0], GUST_ONSET[1], localU);
  const onset = sm(1, 2, localU), fresh = r - downU / Math.max(aroundU, 0.3);
  const front = sm(GUST_FX.edgeRatio[0], GUST_FX.edgeRatio[1], fresh) * sm(1.03, 1.08, r) * onset;
  const crisp = sm(GUST_FX.crisp[0], GUST_FX.crisp[1], r + rag) * onset;
  return Math.min(1, Math.max(0, Math.max(soft * GUST_FX.gain, crisp * GUST_FX.crispW) + front * GUST_FX.edge));
}
// the whitecaps' onset on the local wind (#56 M1's foamWind, v1's 4–8 m/s, read at the point's own wind: audit W2)
export { foamWind as capGate } from './water-surface.js';

const f = (v) => (Number.isInteger(v) ? `${v}.0` : String(v));
const v3 = (a) => `vec3f(${a.map(f).join(', ')})`;
// the local wind read (the one wind texture, any effect: the water here, the trees' sway in render/forest.js); needs the
// frame F; bound at @group(2) @binding(binding)
export const WIND_READ_WGSL = (binding = WIND_BINDING) => `
// a storage buffer, not a texture (the water's fragment stage is at the 16 sampled textures' limit): per texel two words,
// pack2x16float(wind x, z) and pack2x16float(mean, 0), read bilinear by hand
@group(2) @binding(${binding}) var<storage, read> bWind: array<vec2u>;
const WT_N = ${f(WIND_TEX)}; const WT_EXT = ${f(WIND_EXTENT)};
fn wfxOn(b: u32) -> bool { return (u32(F.windfx.z + 0.5) & b) != 0u; }
fn wtTexel(i: i32, j: i32) -> vec3f { let q = bWind[u32(j) * u32(WT_N) + u32(i)]; return vec3f(unpack2x16float(q.x), unpack2x16float(q.y).x); }
// the texels bilinear at a point (texel centres at (i + 0.5) × 16 m from the square's corner; clamped at the edge)
fn wtSample(xz: vec2f) -> vec3f {
  let f = clamp(((xz - F.windfx.xy) / WT_EXT + 0.5) * WT_N - 0.5, vec2f(0.0), vec2f(WT_N - 1.0));
  let i0 = vec2i(min(floor(f), vec2f(WT_N - 2.0))); let t = f - vec2f(i0);
  let a = wtTexel(i0.x, i0.y); let b = wtTexel(i0.x + 1, i0.y); let c = wtTexel(i0.x, i0.y + 1); let d = wtTexel(i0.x + 1, i0.y + 1);
  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}
// v1's windEdge: the texture fades to the mean over its outer 15 % (its clamped edge smeared kilometre-long lines)
fn wtEdge(xz: vec2f) -> f32 { let q = abs(xz - F.windfx.xy) * (2.0 / WT_EXT); return 1.0 - smoothstep(0.82, 0.97, max(q.x, q.y)); }
fn wtMean() -> vec2f { return vec2f(cos(F.wind.y), sin(F.wind.y)) * F.wind.x; }
// the local wind vector (m/s) and the mean speed round it at a point; without a fill, the frame's wind everywhere
fn windLocal(xz: vec2f) -> vec3f {
  if (!wfxOn(${BITS.tex}u)) { return vec3f(wtMean(), F.wind.x); }
  let s = wtSample(xz); let e = wtEdge(xz);
  let wv = mix(wtMean(), s.xy, e);
  return vec3f(wv, max(mix(length(wv), s.z, e), 0.3));
}`;
// needs spNoise, spLane (render/spume.js) and the frame F
export const WIND_WATER_WGSL = (binding = WIND_BINDING) => `${WIND_READ_WGSL(binding)}
const WIND_RESP = array<f32, 4>(${WIND_RESP.map((x) => x.toFixed(4)).join(', ')});
// v1's rippleFactor at the local wind over the mean's (the composed sea already carries the mean's): the short cascades follow a gust
fn ripRel(localU: f32) -> f32 {
  let m = smoothstep(${f(RIPPLE_ONSET[0])}, ${f(RIPPLE_ONSET[1])}, F.wind.x);
  if (m < 1e-3) { return 1.0; }
  return smoothstep(${f(RIPPLE_ONSET[0])}, ${f(RIPPLE_ONSET[1])}, localU) / m * pow(localU / max(F.wind.x, 0.1), 1.5);
}
// W1: v1's gust weight at the displaced point xz (world), from the local wind wv (m/s), its speed and the mean round it
fn gustWeight(xz: vec2f, wv: vec2f, localU: f32, aroundU: f32) -> f32 {
  let r = localU / aroundU;
  if (r <= ${GUST_EDGE[0]}) { return 0.0; }   // every term needs the local wind 3 % over the mean (rag: ± 1.2 %)
  let soft = (smoothstep(${GUST_EDGE[0]}, ${GUST_EDGE[1]}, r) * 0.7 + clamp((r - ${GUST_EDGE[1]}) / ${(GUST_FULL - GUST_EDGE[1]).toFixed(4)}, 0.0, 1.0) * 0.3) * smoothstep(${GUST_ONSET[0]}, ${GUST_ONSET[1]}, localU);
  let wd = wv / max(localU, 0.1);
  let downU = length(windLocal(xz + wd * ${f(GUST_FX.edgeM)}).xy);   // the wind just downwind: still the old air at a front
  let fresh = r - downU / aroundU;
  let onset = smoothstep(1.0, 2.0, localU);
  let front = smoothstep(${GUST_FX.edgeRatio[0]}, ${GUST_FX.edgeRatio[1]}, fresh) * smoothstep(1.03, 1.08, r) * onset;
  let rag = spNoise(xz / ${f(GUST_FX.ragM)}) * ${GUST_FX.rag};
  let crisp = smoothstep(${GUST_FX.crisp[0]}, ${GUST_FX.crisp[1]}, r + rag) * onset;
  return clamp(max(soft * ${GUST_FX.gain}, crisp * ${GUST_FX.crispW}) + front * ${GUST_FX.edge}, 0.0, 1.0);
}
// W1: the patch's fine ripples' slope gain (the gust's own 7 m and 23 m noise, no tiling)
fn gustFine(rest: vec2f) -> f32 { return max((spNoise(rest / 7.0) * 0.55 + spNoise(rest / 23.0 + 4.1) * 0.35 + 1.0) * ${GUST_FX.slope}, 0.2); }
// W1: the sky a patch mirrors: its luminance toward the open sky above, capped, the hue kept (Tahoe stays navy)
fn gustSky(sky: vec3f, w: f32, open: vec3f) -> vec3f {
  let L = vec3f(0.2126, 0.7152, 0.0722); let Ls = max(dot(sky, L), 1e-5);
  let bright = smoothstep(0.8, 1.25, Ls / max(dot(open, L), 1e-5));
  let goal = dot(mix(open, sky * ${GUST_FX.dark}, bright), L) / Ls;
  return sky * mix(1.0, clamp(goal, ${1 - GUST_FX.lumDown}, ${1 + GUST_FX.lumUp}), w);
}`;

// fix(v2) shadow stepping (2026-11-18): the cross-fade of the wind texture's two newest fills (sim/windTex.js blend()), one
// compute dispatch into the buffer every reader binds (the water, the spume, the trees' sway), so the gust patches drift every
// frame instead of stepping on each fill. 65,536 texels, 16 B read and 8 B written each (≈ 1.5 MB); it runs while a fade is
// under way and once when a fill is whole (w = 1), not on the frames between
export const WIND_BLEND_WGSL = `
struct Blend { w: f32, ox: i32, oz: i32, n: u32 }
@group(0) @binding(0) var<uniform> B: Blend;
@group(0) @binding(1) var<storage, read> prev: array<vec2u>;
@group(0) @binding(2) var<storage, read> cur: array<vec2u>;
@group(0) @binding(3) var<storage, read_write> dst: array<vec2u>;
fn texel(q: vec2u) -> vec4f { return vec4f(unpack2x16float(q.x), unpack2x16float(q.y)); }
@compute @workgroup_size(8, 8, 1) fn main(@builtin(global_invocation_id) g: vec3u) {
  let n = B.n;
  if (g.x >= n || g.y >= n) { return; }
  let i = g.y * n + g.x;
  let c = texel(cur[i]);
  // the previous fill's texel at the same world point (its centre a snap away: whole texels); outside it, the newest alone
  let p = vec2i(g.xy) + vec2i(B.ox, B.oz);
  var v = c;
  if (all(p >= vec2i(0)) && all(p < vec2i(i32(n)))) { v = mix(texel(prev[u32(p.y) * n + u32(p.x)]), c, B.w); }
  dst[i] = vec2u(pack2x16float(v.xy), pack2x16float(v.zw));
}`;
// the reference for the tests: the blended texel (wind x, z, mean) at (i, j) from the two fills' unpacked texels (at(i, j) → [x, z, m])
export function blendTexel(prevAt, curAt, i, j, w, off, n = WIND_TEX) {
  const c = curAt(i, j), pi = i + off[0], pj = j + off[1];
  if (pi < 0 || pj < 0 || pi >= n || pj >= n) return c;
  const p = prevAt(pi, pj);
  return c.map((v, k) => p[k] + (v - p[k]) * w);
}
// createWindBlend({ device, reg, out }) → { slots: [a, b] (the fills' buffers: sim/windTex.js upload), set(blend), run(pass, c) }
export function createWindBlend({ device, reg, out, n = WIND_TEX }) {
  const BU = globalThis.GPUBufferUsage, ST = globalThis.GPUShaderStage;
  const bytes = n * n * 8;
  const slots = [0, 1].map((k) => device.createBuffer({ label: `water-wind-fill-${k}`, size: bytes, usage: BU.STORAGE | BU.COPY_DST }));
  const ubuf = device.createBuffer({ label: 'water-wind-blend', size: 16, usage: BU.UNIFORM | BU.COPY_DST });
  const C = ST.COMPUTE;
  const bgl = device.createBindGroupLayout({ label: 'water-wind-blend', entries: [{ binding: 0, visibility: C, buffer: { type: 'uniform' } },
    { binding: 1, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 2, visibility: C, buffer: { type: 'read-only-storage' } }, { binding: 3, visibility: C, buffer: { type: 'storage' } }] });
  // bgs[k]: slot k holds the newest fill, the other the previous
  const bgs = [0, 1].map((k) => device.createBindGroup({ label: `water-wind-blend-${k}`, layout: bgl, entries: [{ binding: 0, resource: { buffer: ubuf } },
    { binding: 1, resource: { buffer: slots[1 - k] } }, { binding: 2, resource: { buffer: slots[k] } }, { binding: 3, resource: { buffer: out } }] }));
  reg.add('water-wind-blend', { layout: device.createPipelineLayout({ bindGroupLayouts: [bgl] }), compute: { module: reg.shader('water-wind-blend', WIND_BLEND_WGSL), entryPoint: 'main' } });
  const u = new ArrayBuffer(16), uf = new Float32Array(u), ui = new Int32Array(u), uu = new Uint32Array(u);
  let due = false, slot = 0, doneKey = -1;
  const stats = { runs: 0, w: 1 };
  return {
    slots, stats,
    // this frame's blend (sim/windTex.js blend(t)): a dispatch while the fade runs, and once when the newest fill is whole
    set(b) {
      stats.w = b.w;
      due = false;
      if (!(b.fills > 0)) return;
      const key = b.w >= 1 ? b.fills : -1;
      if (key >= 0 && key === doneKey) return;
      due = true; doneKey = key; slot = b.slot;
      uf[0] = Math.min(1, Math.max(0, b.w)); ui[1] = b.off[0]; ui[2] = b.off[1]; uu[3] = n;
      device.queue.writeBuffer(ubuf, 0, u);
    },
    run(pass, c) {
      if (!due) return;
      pass.setPipeline(reg.get('water-wind-blend')); pass.setBindGroup(0, bgs[slot]);
      pass.dispatchWorkgroups(Math.ceil(n / 8), Math.ceil(n / 8));
      if (c) c.dispatches++;
      stats.runs++;
    },
  };
}
