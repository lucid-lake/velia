// The clouds' colour samples (fix(v2) cloud colour, 2026-11-14): one frame with the deck and one with ?clouds=0 at the same
// pose; their difference is the cloud mask. Median sRGB (0–255) of each region; used by tools/v2-cloud-colour.mjs and the
// lock test v2/tests/pages/cloudColour.page.mjs. Pure: pixels in (RGBA, row-major), numbers out.
//   top     the brightest quarter of the cloud's core (the core: the frame moved > 24 levels by the deck)
//   under   the darkest quarter of the core
//   edge    the thin rim (moved 6–24 levels)
//   sky     clear sky within 30 px of a cloud (the skyline per column: the first rough row from the top of the deck-off frame)
//   horizon the deck-off sky in the 12 rows over the skyline; up30 the deck-off sky at 28.5–31.5° of elevation
//   measurePixels(on, off, cam, W, H) → { top, under, edge, sky, horizon, up30, cover, n }   cam: { fwd, fov } (vertical fov, deg)
import { PNG } from 'pngjs';
import { readFileSync } from 'node:fs';
const load = (f) => PNG.sync.read(readFileSync(f));
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function elevMap(cam, W, H) {
  const f = norm(cam.fwd), r = norm(cross(f, [0, 1, 0])), u = cross(r, f), t = Math.tan((cam.fov * Math.PI) / 360), a = W / H;
  const e = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = ((x + 0.5) / W) * 2 - 1, ny = 1 - ((y + 0.5) / H) * 2;
    const d = norm([f[0] + r[0] * nx * t * a + u[0] * ny * t, f[1] + r[1] * nx * t * a + u[1] * ny * t, f[2] + r[2] * nx * t * a + u[2] * ny * t]);
    e[y * W + x] = (Math.asin(d[1]) * 180) / Math.PI;
  }
  return e;
}
const med = (a) => { if (!a.length) return null; const s = Float64Array.from(a).sort(); return s[s.length >> 1]; };
const lum = (d, i) => 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
export function measure(onFile, offFile, camFile) {
  const a = load(onFile);
  return measurePixels(a.data, load(offFile).data, JSON.parse(readFileSync(camFile, 'utf8')).cam, a.width, a.height);
}
export function measurePixels(on, off, cam, W, H) {
  const elev = elevMap(cam, W, H);
  // the skyline: per column, the first rough row from the top of the deck-off frame
  const sky = new Uint8Array(W * H), skyline = new Int32Array(W).fill(H);
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H - 1; y++) {
      const i = (y * W + x) * 4, j = i + W * 4;
      const g = Math.abs(off[i] - off[j]) + Math.abs(off[i + 1] - off[j + 1]) + Math.abs(off[i + 2] - off[j + 2]);
      if (g > 12) { skyline[x] = y; break; }
    }
    for (let y = 0; y < skyline[x] - 2; y++) sky[y * W + x] = 1;
  }
  const dm = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) { const i = k * 4; dm[k] = Math.max(Math.abs(on[i] - off[i]), Math.abs(on[i + 1] - off[i + 1]), Math.abs(on[i + 2] - off[i + 2])); }
  const cloud = (k) => dm[k] > 6 && elev[k] > 0.3 && sky[k];
  // a cloud's neighbourhood (30 px box) for the sky beside it
  const near = new Uint8Array(W * H), R = 30;
  const colHas = new Int32Array(W * H);
  for (let x = 0; x < W; x++) { let run = -1e9; for (let y = 0; y < H; y++) { if (cloud(y * W + x)) run = y; colHas[y * W + x] = y - run <= R ? 1 : 0; } run = 1e9; for (let y = H - 1; y >= 0; y--) { if (cloud(y * W + x)) run = y; if (run - y <= R) colHas[y * W + x] = 1; } }
  for (let y = 0; y < H; y++) { let last = -1e9; for (let x = 0; x < W; x++) { if (colHas[y * W + x]) last = x; if (x - last <= R) near[y * W + x] = 1; } last = 1e9; for (let x = W - 1; x >= 0; x--) { if (colHas[y * W + x]) last = x; if (last - x <= R) near[y * W + x] = 1; } }
  const core = [], edge = [], skyB = [], hor = [], up30 = [];
  for (let k = 0; k < W * H; k++) {
    const i = k * 4;
    if (cloud(k)) { (dm[k] > 24 ? core : edge).push(k); continue; }
    if (sky[k] && dm[k] <= 2 && near[k] && elev[k] > 0.5) skyB.push(k);
    if (sky[k] && elev[k] > 28.5 && elev[k] < 31.5) up30.push(k);
  }
  for (let x = 0; x < W; x++) for (let y = Math.max(0, skyline[x] - 14); y < skyline[x] - 2; y++) hor.push(y * W + x);
  core.sort((a, b) => lum(on, a * 4) - lum(on, b * 4));
  const q = Math.max(1, Math.floor(core.length / 4));
  const tops = core.slice(core.length - q), unders = core.slice(0, q);
  const rgb = (list, d) => (list.length < 50 ? null : [0, 1, 2].map((c) => Math.round(med(list.map((k) => d[k * 4 + c])))));
  return {
    n: { core: core.length, edge: edge.length, sky: skyB.length, hor: hor.length, up30: up30.length },
    top: rgb(tops, on), under: rgb(unders, on), edge: rgb(edge, on), sky: rgb(skyB, on),
    horizon: rgb(hor, off), up30: rgb(up30, off), cover: +(100 * (core.length + edge.length) / (W * H)).toFixed(1),
  };
}

