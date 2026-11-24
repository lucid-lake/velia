// The close rock (owner, 2026-11-20: "Look comparison", the first of the four approved look items): within about
// 40 m of the eye the steep faces and the shore's rock take a tiled rock layer, so a cliff seen from the boat reads as stone,
// not a stretched photo. Poly Haven's Rock Face 03 (CC0; ATTRIBUTION.md) as two layers of the terrain's detail array
// (render/ground.js ROCK_FILES: 12 the albedo, 13 the normal x, y and a height from the albedo's luminance), read through hex
// tiles so it never repeats on a lattice:
//   hex tiling  the plane cut into a triangle grid whose vertices are the centres of hexagonal tiles; each tile reads the texture
//               with its own offset and a small turn, a point blends its triangle's three tiles by its barycentric weights to the
//               7th power (most of a tile reads one sample; a tile under 3–6 % of the strongest is not read: 1.4 reads on average)
//               and by each sample's height (the higher relief wins at a seam, no blur)
//   projection  biplanar from above and from the side the face looks to (the normal's shares past 0.35, to the 4th power), so a
//               cliff shows the rock at its own scale; each projection's slope turned back through its tile's turn
//   on the pixel the rock's grain rides on the colour beneath as a luminance ratio to the layer's mean (the island's pale granite,
//               the photo's tone, the shore's wet band all keep their colour) and its slope bends the normal; both fade from 25 to
//               40 m. Bed boulders and the stones out of the water (render/rocks.js) are not touched.
// A desktop or a tablet at L0-L1 (src/core/features.js rockDetail); elsewhere the function is empty and no layer is fetched.
// Cost: the fragments inside 40 m only, 2 projections at most, about 3 reads each (albedo + pack per read tile).
//
// The triangle grid, the tiles' centres and turns and the luminance-weighted blend are adapted from Ponlai's
// packages/render/materials/HexTiling.ts (github.com/HuberyLL/ponlai @ cca9056, MIT, © 2026 Hubery), itself adapted from
// hextile-demo by Morten S. Mikkelsen (github.com/mmikk/hextile-demo, hextiling.h; "Practical Real-Time Hex-Tiling", JCGT 11(3),
// 2022). Rewritten here in WGSL; the hash is the terrain's own (Hoskins' hash12, render/terrain.js NOISE_WGSL). Both notices
// (the full texts in v2/render/LICENSE-ponlai.txt):
//   SPDX-FileCopyrightText: Copyright (c) 2022 mmikk
//   SPDX-FileCopyrightText: Copyright (c) 2026 Hubery
//   SPDX-License-Identifier: MIT
//   Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files
//   (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify,
//   merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is
//   furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be
//   included in all copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
//   EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
//   NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
//   IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
//   IN THE SOFTWARE.

// layer: the albedo's layer in the detail array (the pack is layer + 1); tileM: the texture's size on the rock (m); maxTurn: a
// tile's largest turn (rad); exp, contrast, skip: the blend's power, the height's pull on it, a weak tile's cut; near, far: the
// fade (m); grain, gamma: the luminance ratio's clamp and its contrast; grainK, normalK: how much of the grain and the slope the rock takes
export const ROCK = Object.freeze({ layer: 12, tileM: 3.2, maxTurn: 0.5, exp: 7, contrast: 0.6, skip: [0.03, 0.06], near: 25, far: 40, grain: [0.45, 1.8], gamma: 1.4, grainK: 1.0, normalK: 1.2, side: 0.35 });
const HEX_GRID = 2 * Math.sqrt(3);
const f = (x, d = 4) => x.toFixed(d);

// --- the JS twins (the tests hold them) ---
// the triangle of the skewed grid that holds st: its three vertices (tiles) and st's barycentric weights for them
export function hexGrid(st) {
  const px = st[0] * HEX_GRID, py = st[1] * HEX_GRID;
  const sx = px - py * 0.57735027, sy = py * 1.15470054;
  const bx = Math.floor(sx), by = Math.floor(sy), fx = sx - bx, fy = sy - by;
  const z = 1 - fx - fy, s = z < 0 ? 1 : 0, s2 = 2 * s - 1;
  return { w: [-z * s2, s - fy * s2, s - fx * s2], v: [[bx + s, by + s], [bx + s, by + 1 - s], [bx + 1 - s, by + s]] };
}
// the base weights: the 7th power, a tile under skip[0]..skip[1] of the strongest faded out
export function hexBase(w, R = ROCK) {
  const b = w.map((x) => Math.max(x, 0) ** R.exp), top = Math.max(...b);
  const ss = (a, c, x) => { const t = Math.min(1, Math.max(0, (x - a) / (c - a))); return t * t * (3 - 2 * t); };
  return b.map((x) => x * ss(R.skip[0], R.skip[1], x / top));
}
// the fade with distance (1 near, 0 past far)
export function rockFade(dist, R = ROCK) { const t = Math.min(1, Math.max(0, (dist - R.near) / (R.far - R.near))); return 1 - t * t * (3 - 2 * t); }

// the WGSL (the terrain's draw: its tDetail, sDetail, M, hash() and srgbToLin()); 'off' an empty function
export const ROCK_DETAIL_WGSL = (tier = 'off') => (tier !== 'on'
  ? `fn rockDetail(p: vec3f, dist: f32, fp: f32, k: f32, A: ptr<function, vec3f>, n: ptr<function, vec3f>) {}`
  : `
const RD_GRID = ${f(HEX_GRID, 8)}; const RD_TILE = ${f(ROCK.tileM, 3)}; const RD_L = ${ROCK.layer};
struct RdTri { w: vec3f, v1: vec2f, v2: vec2f, v3: vec2f }
fn rdGrid(st: vec2f) -> RdTri {
  let p = st * RD_GRID;
  let sk = vec2f(p.x - p.y * 0.57735027, p.y * 1.15470054);
  let base = floor(sk); let fr = fract(sk);
  let z = 1.0 - fr.x - fr.y; let s = step(0.0, -z); let s2 = 2.0 * s - 1.0;
  var o: RdTri; o.w = vec3f(-z * s2, s - fr.y * s2, s - fr.x * s2);
  o.v1 = base + vec2f(s, s); o.v2 = base + vec2f(s, 1.0 - s); o.v3 = base + vec2f(1.0 - s, s);
  return o;
}
// a tile's read: the sample position (turned about the tile's centre, shifted by its hash) and the turn's cosine and sine
fn rdTap(st: vec2f, v: vec2f) -> vec4f {
  let cen = vec2f(v.x + v.y * 0.5, v.y / 1.15470054) / RD_GRID;
  let off = vec2f(hash(v + vec2f(3.7, 1.3)), hash(v + vec2f(19.1, 7.9)));
  let a = (hash(v.yx + vec2f(71.31, 71.31)) * 2.0 - 1.0) * ${f(ROCK.maxTurn)};
  let cs = cos(a); let si = sin(a); let d = st - cen;
  return vec4f(vec2f(d.x * cs + d.y * si, d.y * cs - d.x * si) + cen + off, cs, si);
}
// a tile's normal-map slope (GL: x along u, y against the image's rows) turned back into the projection's frame
fn rdBack(nm: vec2f, t: vec4f) -> vec2f {
  let g = vec2f(nm.x, -nm.y);
  let b = vec2f(g.x * t.z - g.y * t.w, g.x * t.w + g.y * t.z);
  return vec2f(b.x, -b.y);
}
struct RdS { col: vec3f, n: vec2f }
fn rdRead(st: vec2f, lod: f32) -> RdS {
  let g = rdGrid(st);
  var b = pow(max(g.w, vec3f(0.0)), vec3f(${f(ROCK.exp, 1)}));
  let top = max(b.x, max(b.y, b.z));
  b *= smoothstep(vec3f(${f(ROCK.skip[0], 3)}), vec3f(${f(ROCK.skip[1], 3)}), b / max(top, 1e-6));
  let t1 = rdTap(st, g.v1); let t2 = rdTap(st, g.v2); let t3 = rdTap(st, g.v3);
  var c1 = vec4f(0.5); var c2 = vec4f(0.5); var c3 = vec4f(0.5); var q1 = vec4f(0.5); var q2 = vec4f(0.5); var q3 = vec4f(0.5);
  if (b.x > 0.0) { c1 = textureSampleLevel(tDetail, sDetail, t1.xy, RD_L, lod); q1 = textureSampleLevel(tDetail, sDetail, t1.xy, RD_L + 1, lod); }
  if (b.y > 0.0) { c2 = textureSampleLevel(tDetail, sDetail, t2.xy, RD_L, lod); q2 = textureSampleLevel(tDetail, sDetail, t2.xy, RD_L + 1, lod); }
  if (b.z > 0.0) { c3 = textureSampleLevel(tDetail, sDetail, t3.xy, RD_L, lod); q3 = textureSampleLevel(tDetail, sDetail, t3.xy, RD_L + 1, lod); }
  let W0 = b * mix(vec3f(1.0), vec3f(q1.b, q2.b, q3.b), ${f(ROCK.contrast, 2)});
  let W = W0 / max(W0.x + W0.y + W0.z, 1e-6);
  var o: RdS;
  o.col = c1.rgb * W.x + c2.rgb * W.y + c3.rgb * W.z;
  o.n = rdBack(q1.rg * 2.0 - 1.0, t1) * W.x + rdBack(q2.rg * 2.0 - 1.0, t2) * W.y + rdBack(q3.rg * 2.0 - 1.0, t3) * W.z;
  return o;
}
// the rock on the pixel: k its share (steep or bare rock, not the green, the beach or the snow), A the albedo (linear), n the normal
fn rockDetail(p: vec3f, dist: f32, fp: f32, k: f32, A: ptr<function, vec3f>, n: ptr<function, vec3f>) {
  let w = k * (1.0 - smoothstep(${f(ROCK.near, 1)}, ${f(ROCK.far, 1)}, dist));
  if (w < 0.004 || M.detail.x < 0.5) { return; }
  let lod = max(log2(max(fp / RD_TILE * 512.0, 1.0)), 0.0);
  let nn = *n; let an = abs(nn);
  var wt = pow(max(an - vec3f(${f(ROCK.side, 2)}), vec3f(0.0)), vec3f(4.0));
  if (an.x >= an.z) { wt.z = 0.0; } else { wt.x = 0.0; }   // biplanar: from above and from the side the face looks to
  wt /= max(wt.x + wt.y + wt.z, 1e-6);
  var col = vec3f(0.0); var pert = vec3f(0.0);
  if (wt.y > 0.0) { let r = rdRead(p.xz / RD_TILE, lod); col += srgbToLin(r.col) * wt.y; pert += vec3f(r.n.x, 0.0, -r.n.y) * wt.y; }
  if (wt.x > 0.0) { let r = rdRead(vec2f(p.z, -p.y) / RD_TILE + vec2f(0.37, 0.11), lod); col += srgbToLin(r.col) * wt.x; pert += vec3f(0.0, r.n.y, r.n.x) * wt.x; }
  if (wt.z > 0.0) { let r = rdRead(vec2f(p.x, -p.y) / RD_TILE + vec2f(0.71, 0.53), lod); col += srgbToLin(r.col) * wt.z; pert += vec3f(r.n.x, r.n.y, 0.0) * wt.z; }
  let LW = vec3f(0.3, 0.55, 0.15);
  let mean = srgbToLin(textureSampleLevel(tDetail, sDetail, vec2f(0.5), RD_L, 9.0).rgb);
  let grain = clamp(pow(dot(col, LW) / max(dot(mean, LW), 0.02), ${f(ROCK.gamma, 2)}), ${f(ROCK.grain[0], 2)}, ${f(ROCK.grain[1], 2)});
  *A = *A * mix(1.0, grain, w * ${f(ROCK.grainK, 2)});
  *n = normalize(nn + (pert - nn * dot(pert, nn)) * (w * ${f(ROCK.normalK, 2)}));
}`);
