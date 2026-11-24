// The home card's mini chart: the real shoreline of Emerald Bay and its mouth as engraved-chart paths, baked from the planner's
// grid (v2/ui/planChart.bin: the bay level at 10 m, the lake level at 40 m, both v1's own terrain). The card draws it in the world's
// own metres (x east, z south, Fannette Island's summit at 0, 0), so the birthplace pins (src/waters/tahoe-emerald.json
// "birthplaces") stand on it at their real places, and the island is the island.
//   coast   the shore (distance 0 m) as closed loops: the land's fill and its hairline
//   rings   the engraver's lines in the water, parallel to the shore, at 35, 85 and 160 m off it
//   node tools/v2-minichart-bake.mjs            write v2/ui/miniChartData.js
//   node tools/v2-minichart-bake.mjs --check    exit 1 if the committed file differs from a fresh bake
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePlanGrid } from '../v2/ui/planChart.js';
import { MINI_BOX } from '../v2/ui/birthplaceCard.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'v2/ui/miniChartData.js');
// the chart's window in the world's metres (x0, z0, width, height): v2/ui/birthplaceCard.js MINI_BOX (the pins and their names inside it)
const BOX = MINI_BOX;
const STEP = 10, PAD = 2;
const LEVELS = [{ at: 0, tol: 4 }, { at: 35, tol: 8 }, { at: 85, tol: 11 }, { at: 160, tol: 14 }];

const g = decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(resolve(ROOT, 'v2/ui/planChart.bin')))));
const bay = g.levels.bay, lake = g.levels.lake;
const bil = (L, x, z) => {
  const fx = Math.min(L.nx - 1.001, Math.max(0, (x - L.x0) / L.cell)), fz = Math.min(L.nz - 1.001, Math.max(0, (z - L.z0) / L.cell));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * L.nx + i, s = L.shore;
  return (s[k] * (1 - u) + s[k + 1] * u) * (1 - v) + (s[k + L.nx] * (1 - u) + s[k + L.nx + 1] * u) * v;
};
const inBay = (x, z) => x >= bay.x0 && x <= bay.x0 + bay.cell * (bay.nx - 1.01) && z >= bay.z0 && z <= bay.z0 + bay.cell * (bay.nz - 1.01);
const shoreAt = (x, z) => (inBay(x, z) ? bil(bay, x, z) : bil(lake, x, z));

const [bx, bz, bw, bh] = BOX;
const nx = Math.round(bw / STEP) + 1 + 2 * PAD, nz = Math.round(bh / STEP) + 1 + 2 * PAD;
const x0 = bx - PAD * STEP, z0 = bz - PAD * STEP;
const F = new Float32Array(nx * nz);
for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
  const edge = i === 0 || j === 0 || i === nx - 1 || j === nz - 1;
  F[j * nx + i] = edge ? 400 : shoreAt(x0 + i * STEP, z0 + j * STEP);   // the outer ring is water: every land and every ring closes inside the grid
}

// marching squares: segments joined into polylines (closed when they meet)
function contours(level) {
  const segs = [];
  const P = (ax, az, av, bx2, bz2, bv) => { const t = (level - av) / (bv - av); return [ax + (bx2 - ax) * t, az + (bz2 - az) * t]; };
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = F[j * nx + i], b = F[j * nx + i + 1], c = F[(j + 1) * nx + i + 1], d = F[(j + 1) * nx + i];
    const X = x0 + i * STEP, Z = z0 + j * STEP;
    const code = (a >= level ? 1 : 0) | (b >= level ? 2 : 0) | (c >= level ? 4 : 0) | (d >= level ? 8 : 0);
    if (code === 0 || code === 15) continue;
    const top = () => P(X, Z, a, X + STEP, Z, b), right = () => P(X + STEP, Z, b, X + STEP, Z + STEP, c), bottom = () => P(X, Z + STEP, d, X + STEP, Z + STEP, c), left = () => P(X, Z, a, X, Z + STEP, d);
    const add = (p, q) => segs.push([p, q]);
    switch (code) {
      case 1: case 14: add(left(), top()); break;
      case 2: case 13: add(top(), right()); break;
      case 3: case 12: add(left(), right()); break;
      case 4: case 11: add(right(), bottom()); break;
      case 6: case 9: add(top(), bottom()); break;
      case 7: case 8: add(left(), bottom()); break;
      case 5: { const m = (a + b + c + d) / 4 >= level; if (m) { add(left(), top()); add(right(), bottom()); } else { add(left(), bottom()); add(top(), right()); } break; }
      case 10: { const m = (a + b + c + d) / 4 >= level; if (m) { add(left(), bottom()); add(top(), right()); } else { add(left(), top()); add(right(), bottom()); } break; }
    }
  }
  const key = (p) => `${Math.round(p[0] * 50)},${Math.round(p[1] * 50)}`;
  const ends = new Map();
  segs.forEach((s, n) => { for (const p of s) { const k = key(p); (ends.get(k) ?? ends.set(k, []).get(k)).push(n); } });
  const used = new Uint8Array(segs.length), lines = [];
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const line = [segs[n][0], segs[n][1]];
    for (let grow = 0; grow < 2; grow++) {
      for (;;) {
        const tail = line[line.length - 1], k = key(tail), next = (ends.get(k) ?? []).find((m) => !used[m]);
        if (next === undefined) break;
        used[next] = 1;
        const [p, q] = segs[next];
        line.push(key(p) === k ? q : p);
      }
      line.reverse();
    }
    lines.push(line);
  }
  return lines;
}
// Douglas-Peucker
function simplify(pts, tol, closed) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop(); let md = 0, mi = -1;
    const [ax, az] = pts[s], [bx2, bz2] = pts[e], dx = bx2 - ax, dz = bz2 - az, L = Math.hypot(dx, dz) || 1e-9;
    for (let i = s + 1; i < e; i++) { const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > tol) { keep[mi] = 1; stack.push([s, mi], [mi, e]); }
  }
  const out = pts.filter((_, i) => keep[i]);
  return closed && out.length < 4 ? pts : out;
}
const path = (lines, tol) => {
  let d = '';
  for (const line of lines) {
    const closed = Math.hypot(line[0][0] - line[line.length - 1][0], line[0][1] - line[line.length - 1][1]) < 0.5;
    const pts = simplify(line, tol, closed).map(([x, z]) => [Math.round(x), Math.round(z)]);
    if (pts.length < 3 + (closed ? 1 : 0)) continue;
    // drop what lies wholly outside the window (the padding's loops)
    if (pts.every(([x, z]) => x < bx - 40 || x > bx + bw + 40 || z < bz - 40 || z > bz + bh + 40)) continue;
    let px = pts[0][0], pz = pts[0][1]; d += `M${px} ${pz}`;
    for (let i = 1; i < pts.length - (closed ? 1 : 0); i++) { d += `l${pts[i][0] - px} ${pts[i][1] - pz}`; px = pts[i][0]; pz = pts[i][1]; }
    if (closed) d += 'z';
  }
  return d;
};

const out = { box: BOX, coast: path(contours(0), 4), rings: LEVELS.slice(1).map((l) => path(contours(l.at), l.tol)) };
const text = `// The home card's mini chart: the shoreline of Emerald Bay and its mouth, baked by tools/v2-minichart-bake.mjs from the planner's grid
// (v2/ui/planChart.bin). World metres: x east, z south, Fannette Island's summit at 0, 0. box = [x0, z0, width, height].
// coast: closed loops (land); rings: the engraver's lines in the water at 35, 85 and 160 m off the shore. Do not edit by hand.
export const MINI = ${JSON.stringify(out)};
`;
if (process.argv.includes('--check')) {
  let old = ''; try { old = readFileSync(OUT, 'utf8'); } catch { /* none */ }
  if (old !== text) { console.error('miniChartData.js is stale: node tools/v2-minichart-bake.mjs'); process.exit(1); }
  console.log('mini chart current');
} else { writeFileSync(OUT, text); console.log(`wrote ${OUT}: coast ${out.coast.length} B, rings ${out.rings.map((r) => r.length).join(' / ')} B`); }
