// The towns' mask on the GPU (v2/towns/format.js mask.vtm, bound as one read-only storage buffer of u32): the reader, the
// terrain's paint (v1's src/towns.js ground hook: the ski runs' summer meadow and their last snow, Hwy 89's asphalt, the
// cut's decomposed granite) and the forest's keep-out (v1's keepOut and the runs' thinning). The buffer before the data
// lands is 16 zero bytes: no rasters, no paint, nothing kept out.
import { KEEP, RASTER } from './format.js';

const lin = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
const v3 = (h) => `vec3f(${lin(h).map((x) => x.toFixed(4)).join(', ')})`;

// the reader: `TWN` must be declared by the includer (TOWNS_BIND)
export const TOWNS_BIND = (g, b) => `@group(${g}) @binding(${b}) var<storage, read> TWN: array<u32>;`;
export const TOWNS_READ = `
fn twF(w: u32) -> f32 { return bitcast<f32>(TWN[w]); }
fn twB(b: u32) -> f32 { return f32((TWN[b >> 2u] >> ((b & 3u) * 8u)) & 255u); }
// raster r's two channels at level l, bilinear on the texel centres, 0 outside (v1's sampler; the JS twin: sampleRaster)
fn twSample(r: u32, l: u32, x: f32, z: f32) -> vec2f {
  let o = 4u + 16u * r;
  let s = f32(1u << l); let cell = twF(o + 2u) * s;
  let w = i32((TWN[o + 3u] + (1u << l) - 1u) >> l); let h = i32((TWN[o + 4u] + (1u << l) - 1u) >> l);
  let ch = TWN[o + 5u]; let base = TWN[o + 8u + l];
  let fx = (x - twF(o)) / cell - 0.5; let fz = (z - twF(o + 1u)) / cell - 0.5;
  let i = i32(floor(fx)); let j = i32(floor(fz)); let u = fx - floor(fx); let v = fz - floor(fz);
  var t = array<vec2f, 4>(vec2f(0.0), vec2f(0.0), vec2f(0.0), vec2f(0.0));
  for (var k = 0; k < 4; k++) {
    let a = i + (k & 1); let q = j + (k >> 1u);
    if (a >= 0 && q >= 0 && a < w && q < h) {
      let b = base + u32(q * w + a) * ch;
      t[k] = vec2f(twB(b), select(0.0, twB(b + 1u), ch > 1u));
    }
  }
  return (mix(t[0], t[1], u) * (1.0 - v) + mix(t[2], t[3], u) * v) / 255.0;
}
fn twInside(r: u32, x: f32, z: f32) -> bool {
  let o = 4u + 16u * r; let c = twF(o + 2u);
  let x0 = twF(o); let z0 = twF(o + 1u);
  return x >= x0 - c && z >= z0 - c && x <= x0 + f32(TWN[o + 3u] + 1u) * c && z <= z0 + f32(TWN[o + 4u] + 1u) * c;
}
// the ground's marks at (x, z): x road (asphalt), y cut, z ski; fp the pixel's footprint (m): the level's mean by it,
// two levels blended (0: the finest level)
fn twMarks(x: f32, z: f32, fp: f32) -> vec3f {
  var m = vec3f(0.0);
  let n = min(TWN[1], 4u);
  for (var r = 0u; r < n; r++) {
    if (!twInside(r, x, z)) { continue; }
    let o = 4u + 16u * r; let levels = TWN[o + 6u];
    let lf = clamp(log2(max(fp / twF(o + 2u), 1.0)), 0.0, f32(levels - 1u));
    let l0 = u32(floor(lf)); let l1 = min(l0 + 1u, levels - 1u);
    var s = twSample(r, l0, x, z);
    if (l1 != l0 && lf > f32(l0)) { s = mix(s, twSample(r, l1, x, z), lf - f32(l0)); }
    if (TWN[o + 7u] == ${RASTER.FINE}u) { m.x = max(m.x, s.x); m.y = max(m.y, s.y); } else { m.z = max(m.z, s.x); }
  }
  return m;
}
// v1's keep-out (src/towns-layout.js makeQueries keepOut; the footprints wait for the buildings) and the runs' thinning
fn twKeepOut(x: f32, z: f32) -> bool {
  let m = twMarks(x, z, 0.0);
  return m.z > ${KEEP.ski} || m.x > ${KEEP.road} || m.y > ${KEEP.cut};
}
// v2's cards draw a crown 1.35 × the lidar's radius (render/forest.js): a crown whose edge reaches the road or the cut
// would close the corridor v1 clears, so the road and the cut are also tested at four points KEEP.reach × r out (format.js)
fn twKeepOutR(x: f32, z: f32, r: f32) -> bool {
  if (twKeepOut(x, z)) { return true; }
  let d = r * ${KEEP.reach};
  for (var k = 0; k < 4; k++) {
    let a = f32(k) * 1.5707963;
    let m = twMarks(x + cos(a) * d, z + sin(a) * d, 0.0);
    if (m.x > ${KEEP.road} || m.y > ${KEEP.cut}) { return true; }
  }
  return false;
}
fn twSkiKeep(x: f32, z: f32) -> f32 { return 1.0 - ${KEEP.thinShare} * smoothstep(${KEEP.thinA}, ${KEEP.thinB}, twMarks(x, z, 0.0).z); }`;

// the terrain's paint (v1's src/towns.js groundFn, cut to the runs and the bay's road): over the photo's colour, before the
// detail's grain (which then rides on it, as v1's `grain`) and the forest floor (the paint takes the forest's share).
// p the world point, n the ground's normal, fp the footprint; vnoise (0–1) is the terrain's (NOISE_WGSL)
export const TOWNS_PAINT_WGSL = `
fn twN(q: vec2f) -> f32 { return vnoise(q) * 2.0 - 1.0; }
fn townsPaint(p: vec3f, n: vec3f, fp: f32, A: ptr<function, vec3f>, fshare: ptr<function, f32>) {
  if (TWN[1] == 0u) { return; }
  let m = twMarks(p.x, p.z, fp);
  if (max(m.x, max(m.y, m.z)) < 0.004) { return; }
  let n1 = twN(p.xz * 0.012); let n2 = twN(p.xz * 0.07); let n3 = twN(p.xz * 0.028 + vec2f(5.3, 2.1));
  // the runs in summer (South Lake's look, 2026-11-25): clearings in the forest, not painted lines. Low on the mountain a dry
  // mountain meadow (the grass gone to straw by July, greener in the swales); from ≈ 650 m above the lake thin soil over
  // decomposed granite with the grass in patches; worn dirt in patches (the cat tracks, the steep pitches); the winter's last
  // snow only well above the season's line, old and grey, in patches on the shaded top. The run's edge is ragged (a noise on
  // the mark's share), and the forest's keep-out (twSkiKeep) leaves the edge trees standing, so a run reads as a glade.
  let grass = mix(${v3(0x55613a)}, ${v3(0x6f7147)}, n1 * 0.5 + 0.5) * (n2 * 0.08 + 0.96);
  let straw = mix(${v3(0x7d7a4f)}, ${v3(0x8c8460)}, n3 * 0.5 + 0.5);
  let meadowLow = mix(grass, straw, smoothstep(0.0, 0.7, n3));
  let soil = mix(${v3(0x857b60)}, ${v3(0x726c58)}, n2 * 0.5 + 0.5);   // decomposed-granite soil
  let meadowHigh = mix(soil, meadowLow, smoothstep(0.1, 0.7, n1 * 0.6 + n2 * 0.4));
  var meadow = mix(meadowLow, meadowHigh, smoothstep(650.0, 1000.0, p.y + n1 * 60.0));
  let worn = smoothstep(0.5, 0.85, twN(p.xz * 0.05 + vec2f(3.1, 1.7))) * 0.6;
  meadow = mix(meadow, soil * 0.92, worn);
  let north = clamp(-n.z * 3.0, 0.0, 1.0);
  let line = TU.season.x - TU.season2.w - north * TU.season.z;   // the season's snow line, m above the lake
  let snowW = smoothstep(line + 60.0, line + 200.0, p.y + n1 * 70.0) * smoothstep(0.1, 0.6, n2) * 0.8;
  let run = mix(meadow, ${v3(0xd4d8da)}, snowW);
  let asphalt = mix(${v3(0x2e2e2c)}, ${v3(0x45443f)}, (n2 * 0.5 + 0.5) * 0.6);
  let sk = smoothstep(0.08, 0.7, m.z * (0.8 + 0.45 * (twN(p.xz * 0.035) * 0.5 + 0.5)));   // the ragged edge
  var o = mix(${v3(0x4c463c)}, run, sk); var w = sk;
  o = mix(o, asphalt, m.x); w = max(w, m.x);
  *A = mix(*A, o, clamp(w, 0.0, 1.0));
  // the Hwy 89 cut: not a paint; the ground's own colour shifted toward weathered decomposed granite's warm buff and a
  // touch lighter; the scar reads by the missing forest (the keep-out) and this shift
  let cut = m.y * (1.0 - m.x) * 0.8;
  let dg = *A * vec3f(1.13, 1.05, 0.9) * mix(1.0, 1.12, smoothstep(-0.3, 0.5, n2));
  *A = mix(*A, dg, cut);
  *fshare = *fshare * (1.0 - clamp(max(w, cut), 0.0, 1.0));
}`;
