// The chart card's map: Emerald Bay drawn from the game's own terrain grids (terrain/*.lsh, via src/terrain-data.js).
// Writes brand/chart-bay.svg: a fragment of paths in a 0 0 W H box (class names only; src/ui/loading-shell.html styles them):
//   .land (fill, even-odd: everything above the water line), .shoal (fill: water shallower than 10 m), .shore (the shoreline),
//   .c10 (the 10 m contour), .c30 (the 30 m contour, dashed) and the depth soundings in whole metres (<text class="snd">).
// Frame: world metres (x east, z south; Fannette Island's summit is 0,0); the window is chosen so the island lands at ISLE.
//   node tools/brand/chart_bay.mjs [--check]
import { loadTerrain, makeSampler } from '../../src/sim/terrain-data.js';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = resolve(ROOT, 'brand/chart-bay.svg');
const WI = JSON.parse(readFileSync(resolve(ROOT, 'src/waters/index.json'), 'utf8'));
const LAKE = JSON.parse(readFileSync(resolve(ROOT, 'src/waters', WI.waters.find((w) => w.id === WI.default).file), 'utf8')), CH = LAKE.chart;   // the default lake's descriptor (src/waters/)
const [W, H] = CH.box;
const MPP = CH.metresPerUnit;         // metres per px
const ISLE = CH.destination.at;       // where the destination's summit lands in the box
const X0 = -ISLE[0] * MPP, Z0 = -ISLE[1] * MPP;   // world coordinates of the box's top-left corner
const COURSE = [CH.course.from, CH.course.to];   // the pencilled course (box px), drawn by src/ui/loading-shell.html
const ROSE = [0, 0, 0];                       // no clear zone needed: the compass rose sits in the title block
const STEP = 6;                       // m, the sampling grid

const D = await loadTerrain(), S = makeSampler(D);
const nx = Math.ceil(W * MPP / STEP) + 3, nz = Math.ceil(H * MPP / STEP) + 3;   // one cell of padding each side
const gx = (i) => X0 + (i - 1) * STEP, gz = (j) => Z0 + (j - 1) * STEP;
const hgt = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) hgt[j * nx + i] = S.height(gx(i), gz(j));
const px = (x) => (x - X0) / MPP, pz = (z) => (z - Z0) / MPP;

// marching squares → closed loops of [x, z] (world m) at `level`, with `pad` the value of the outer ring (forces closure)
function loops(level, pad, below) {   // below: true = the region h < level is "inside" (water side)
  const v = (i, j) => (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) ? pad : hgt[j * nx + i];
  const segs = new Map(), pts = new Map();
  const edge = (i, j, k) => {   // k 0: edge (i,j)-(i+1,j), 1: edge (i,j)-(i,j+1)
    const key = k * 1e7 + j * 4000 + i;
    if (!pts.has(key)) {
      const a = v(i, j), b = k ? v(i, j + 1) : v(i + 1, j), t = (level - a) / (b - a);
      pts.set(key, k ? [gx(i), gz(j) + t * STEP] : [gx(i) + t * STEP, gz(j)]);
    }
    return key;
  };
  const link = (a, b) => { (segs.get(a) ?? segs.set(a, []).get(a)).push(b); (segs.get(b) ?? segs.set(b, []).get(b)).push(a); };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const c = [v(i, j), v(i + 1, j), v(i + 1, j + 1), v(i, j + 1)].map((x) => (x < level ? 1 : 0));
    const code = c[0] | c[1] << 1 | c[2] << 2 | c[3] << 3;
    if (code === 0 || code === 15) continue;
    const T = edge(i, j, 0), R = edge(i + 1, j, 1), B = edge(i, j + 1, 0), L = edge(i, j, 1);
    const tab = { 1: [[L, T]], 2: [[T, R]], 3: [[L, R]], 4: [[R, B]], 5: [[L, T], [R, B]], 6: [[T, B]], 7: [[L, B]], 8: [[L, B]], 9: [[T, B]], 10: [[L, B], [T, R]], 11: [[R, B]], 12: [[L, R]], 13: [[T, R]], 14: [[L, T]] };
    for (const [a, b] of tab[code]) link(a, b);
  }
  const seen = new Set(), out = [];
  for (const start of segs.keys()) {
    if (seen.has(start)) continue;
    const loop = []; let prev = null, cur = start;
    while (cur != null && !seen.has(cur)) {
      seen.add(cur); loop.push(pts.get(cur));
      const nb = segs.get(cur); const next = nb.find((q) => q !== prev && !seen.has(q)) ?? null;
      prev = cur; cur = next;
    }
    if (loop.length > 3) out.push(loop);
  }
  return out;
}
function rdp(p, eps) {
  if (p.length < 3) return p;
  let dm = 0, im = 0; const [a, b] = [p[0], p[p.length - 1]], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < p.length - 1; i++) { const d = Math.abs(dy * p[i][0] - dx * p[i][1] + b[0] * a[1] - b[1] * a[0]) / L; if (d > dm) { dm = d; im = i; } }
  return dm > eps ? [...rdp(p.slice(0, im + 1), eps).slice(0, -1), ...rdp(p.slice(im), eps)] : [a, b];
}
const path = (ls, eps = 0.55, close = true) => ls.map((l) => {
  const q = rdp(l.map(([x, z]) => [px(x), pz(z)]), eps);
  if (q.length < 3) return '';
  const f = (n) => (Math.round(n * 10) / 10).toString();
  return 'M' + q.map(([x, y]) => f(x) + ' ' + f(y)).join('L') + (close ? 'Z' : '');
}).join('');
const area = (l) => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
const big = (ls, m2) => ls.filter((l) => area(l) > m2);

const water = big(loops(0, 1, true), 2500);      // the shoreline: outer ring = land, so water bodies close inside the box
const deep10 = big(loops(-10, 0, true), 2500);   // water deeper than 10 m (ring = 0: shallow, so the loops close)
const deep30 = big(loops(-30, 0, true), 2500);
const rect = `M-4 -4H${W + 4}V${H + 4}H-4Z`;

// soundings: a loose grid of depths in whole metres, away from the shore, jittered by a hash so it does not look like a grid
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const snd = [];
for (let a = 0; a < 9; a++) for (let b = 0; b < 8; b++) {
  const x = X0 + (a + 0.25 + 0.5 * hash(a, b)) * (W * MPP / 9), z = Z0 + (b + 0.25 + 0.5 * hash(b, a + 40)) * (H * MPP / 8);
  const h = S.height(x, z); if (h > -4 || h < -60) continue;
  if (S.distance(x, z) > -45) continue;
  const X = px(x), Y = pz(z);
  const [[ax, ay], [bx, by]] = COURSE, dx = bx - ax, dy = by - ay, u = Math.max(0, Math.min(1, ((X - ax) * dx + (Y - ay) * dy) / (dx * dx + dy * dy)));
  if (Math.hypot(X - ax - u * dx, Y - ay - u * dy) < 16 || Math.hypot(X - ROSE[0], Y - ROSE[1]) < ROSE[2]) continue;
  snd.push([X, Y, Math.round(-h)]);
}
const f1 = (n) => (Math.round(n * 10) / 10).toString();
const svg = [
  `<!-- Emerald Bay from the game's terrain grids (tools/brand/chart_bay.mjs); box ${W}x${H}, ${MPP} m per px, Fannette Island's summit at ${ISLE.join(',')}; soundings in metres -->`,
  `<path class="land" fill-rule="evenodd" d="${rect}${path(water)}"/>`,
  `<path class="shoal" fill-rule="evenodd" d="${path(water)}${path(deep10)}"/>`,
  `<path class="c30" d="${path(deep30, 0.8)}"/>`,
  `<path class="c10" d="${path(deep10, 0.8)}"/>`,
  `<path class="shore" d="${path(water, 0.5)}"/>`,
  ...snd.map(([x, y, d]) => `<text class="snd" x="${f1(x)}" y="${f1(y)}">${d}</text>`),
].join('\n') + '\n';
if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== svg) { console.error('brand/chart-bay.svg is stale'); process.exit(1); }
  console.log('chart-bay.svg current');
} else { writeFileSync(OUT, svg); console.log(`brand/chart-bay.svg ${svg.length} B, ${snd.length} soundings, ${water.length} water loops`); }
