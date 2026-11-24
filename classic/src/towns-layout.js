// The human geography round the lake, as data in the world frame: the towns' buildings,
// the ski runs and lifts, the roads, piers and marinas, the night lights, and the masks the terrain and the trees
// read. Plain JS, no three.js: node tests, workers and src/towns.js share it.
//
//   import { loadTownsData, buildTownsLayout } from './towns-layout.js';
//   const data = await loadTownsData();                         // data/geo/tahoe-towns.json (OSM, ODbL; UTM 10N)
//   const L = buildTownsLayout(data, { heightAt, lonLatToWorld });
//   L.buildings   { count, data: Float32Array × BSTRIDE }      x, yBase, z, len, wid, yaw, wall, roof, kind, facade, seed, size,
//                                                              ground (the mean ground under it)
//   L.clusters    [{ x, z, r, start, count, sizes }]           3 km cells, each sorted by size, largest first (the LOD)
//   L.lights      { count, data: Float32Array × LSTRIDE }      x, y, z, r, g, b, size (m), on (sun elevation, deg)
//   L.mask        { x0, z0, cell, w, h, data: Uint8Array RGBA } R built ground, G ski run / lift line, B asphalt, A lawn
//   L.fine        { x0, z0, cell, w, h, data: Uint8Array RG }   the Emerald Bay road window: R asphalt, G the cut's scar
//   L.coverAt(x, z) → { built, ski, glade, road, lawn }  (0–1, from the mask, bilinear)
//   L.keepOut(x, z) → true where no tree stands: a footprint (+3 m), a run, a lift line, a road, a lawn, a lot
//   L.treeDensity(x, z) → 0–1, the share of the forest kept (towns thin it: TOWN_RULES.thin)
//   L.lifts, L.piers: instance lists for src/towns.js
// Deterministic: hashes of indices only; no Math.random(), no clock.
import { fromUTM } from '../../src/sim/geo/utm.js';
import { fetchRetry } from '../../src/sim/fetchRetry.js';
import { clamp } from '../../src/sim/core/math.js';

export const BSTRIDE = 13, LSTRIDE = 8;
export const TOWN_RULES = {
  cluster: 4000,          // m, the LOD cells
  maskCell: 25,           // m, the coarse mask
  fineCell: 2.5,          // m, the Emerald Bay window
  fineBox: { lon: [-120.128, -120.07], lat: [38.935, 38.975] },   // Hwy 89 round the bay (Inspiration Point to the north wall)
  treeGap: 3,             // m, round a footprint
  thin: 0.55,             // the forest kept on fully built ground (Tahoe's towns stand in the trees)
  snowLineY: 952,         // m above the lake: 2,850 m, the normal day's (mid-June); src/core/world.js passes the day's (TAHOE.season)
  snowAspectM: 300,       // m lower on north faces (TAHOE.season.aspectM)
};

const hash = (i, s) => {
  let h = Math.imul(i ^ 0x9e3779b9, 2654435761) ^ Math.imul(s + 0x632be5ab, 1442695041);
  h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export async function loadTownsData(url = '/data/geo/tahoe-towns.json') {
  if (typeof window === 'undefined' && typeof process !== 'undefined') {
    const { readFile } = await import('node:fs/promises');
    const p = new URL('../../data/geo/tahoe-towns.json', import.meta.url);
    return JSON.parse(await readFile(p, 'utf8'));
  }
  const r = await fetchRetry(url);
  if (!r.ok) throw new Error(`towns data: ${r.status} ${url}`);
  return r.json();
}

// UTM 10N (the data's grid) → the world frame, through lon/lat and the shared projection
function makeToWorld(data, lonLatToWorld) {
  const [E0, N0] = data.origin;
  return (e, n) => { const g = fromUTM(e + E0, n + N0); return lonLatToWorld(g.lon, g.lat); };
}

// segment distance (squared-free): from (px, pz) to a–b; t out
function segDist(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-9;
  const t = clamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1);
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}

// a raster with max-compositing writers (coverage 0–1 → bytes)
function raster(x0, z0, cell, w, h, channels) {
  const data = new Uint8Array(w * h * channels);
  const put = (i, j, c, v) => {
    if (i < 0 || j < 0 || i >= w || j >= h || v <= 0) return;
    const k = (j * w + i) * channels + c, b = Math.round(clamp(v, 0, 1) * 255);
    if (b > data[k]) data[k] = b;
  };
  // a polyline of width wM: coverage by the cell centre's distance (a box filter one cell wide)
  function stroke(pts, wM, c, gain = 1) {
    const half = wM / 2, reach = half + cell;
    for (let s = 0; s + 3 < pts.length; s += 2) {
      const ax = pts[s], az = pts[s + 1], bx = pts[s + 2], bz = pts[s + 3];
      const i0 = Math.floor((Math.min(ax, bx) - reach - x0) / cell), i1 = Math.ceil((Math.max(ax, bx) + reach - x0) / cell);
      const j0 = Math.floor((Math.min(az, bz) - reach - z0) / cell), j1 = Math.ceil((Math.max(az, bz) + reach - z0) / cell);
      for (let j = Math.max(0, j0); j <= Math.min(h - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(w - 1, i1); i++) {
        const d = segDist(x0 + (i + 0.5) * cell, z0 + (j + 0.5) * cell, ax, az, bx, bz);
        put(i, j, c, gain * clamp(0.5 + (half - d) / cell, 0, 1) * Math.min(1, wM / cell + 0.25));
      }
    }
  }
  // a polygon (flat [x, z, …], closed or not): even-odd scanline at the cell centres
  function fill(pts, c, v = 1) {
    const n = pts.length / 2;
    let zmin = Infinity, zmax = -Infinity;
    for (let k = 0; k < n; k++) { zmin = Math.min(zmin, pts[2 * k + 1]); zmax = Math.max(zmax, pts[2 * k + 1]); }
    const ja = Math.max(0, Math.floor((zmin - z0) / cell)), jb = Math.min(h - 1, Math.ceil((zmax - z0) / cell));
    const xs = [];
    for (let j = ja; j <= jb; j++) {
      const z = z0 + (j + 0.5) * cell; xs.length = 0;
      for (let k = 0, m = n - 1; k < n; m = k++) {
        const za = pts[2 * m + 1], zb = pts[2 * k + 1];
        if ((za > z) !== (zb > z)) xs.push(pts[2 * m] + (z - za) / (zb - za) * (pts[2 * k] - pts[2 * m]));
      }
      xs.sort((a, b) => a - b);
      for (let q = 0; q + 1 < xs.length; q += 2) {
        const ia = Math.max(0, Math.ceil((xs[q] - x0) / cell - 0.5)), ib = Math.min(w - 1, Math.floor((xs[q + 1] - x0) / cell - 0.5));
        for (let i = ia; i <= ib; i++) put(i, j, c, v);
      }
      // a polygon narrower than a cell still marks the cell it is in, partly
      if (xs.length >= 2 && Math.floor((xs[0] - x0) / cell) === Math.floor((xs[xs.length - 1] - x0) / cell)) put(Math.floor((xs[0] - x0) / cell), j, c, v * clamp((xs[xs.length - 1] - xs[0]) / cell, 0, 1));
    }
  }
  const sample = (x, z, c) => {   // bilinear, 0–1
    const fx = (x - x0) / cell - 0.5, fz = (z - z0) / cell - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const at = (a, b) => (a < 0 || b < 0 || a >= w || b >= h) ? 0 : data[(b * w + a) * channels + c];
    return ((at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v) / 255;
  };
  return { x0, z0, cell, w, h, channels, data, put, stroke, fill, sample };
}

// masksOnly: the buildings, the masks and the queries only (a tree-scatter worker); no lights, props or piers
// bilinear 0–1 sample of a plain raster { x0, z0, cell, w, h, channels, data }
export function sampler(r) {
  const { x0, z0, cell, w, h, channels, data } = r;
  return (x, z, c) => {
    const fx = (x - x0) / cell - 0.5, fz = (z - z0) / cell - 0.5, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const at = (a, b) => (a < 0 || b < 0 || a >= w || b >= h) ? 0 : data[(b * w + a) * channels + c];
    return ((at(i, j) * (1 - u) + at(i + 1, j) * u) * (1 - v) + (at(i, j + 1) * (1 - u) + at(i + 1, j + 1) * u) * v) / 255;
  };
}

// The tree-facing queries from plain data, so a worker can take them as a bundle (towns-layout's maskBundle) instead of
// building the layout: mask and fine rasters, and the footprints foot = Float32Array [x, z, len, wid, yaw] × n.
export function makeQueries({ mask, fine, foot, rules = TOWN_RULES }) {
  const R = rules, mS = sampler(mask), fS = fine ? sampler(fine) : () => 0;
  const BH = 64, bucket = new Map();
  for (let o = 0; o < foot.length; o += 5) {
    const x = foot[o], z = foot[o + 1], r = Math.hypot(foot[o + 2], foot[o + 3]) / 2 + R.treeGap;
    for (let j = Math.floor((z - r) / BH); j <= Math.floor((z + r) / BH); j++) for (let i = Math.floor((x - r) / BH); i <= Math.floor((x + r) / BH); i++) {
      const key = i * 100003 + j; if (!bucket.has(key)) bucket.set(key, []); bucket.get(key).push(o);
    }
  }
  function inFootprint(x, z, gap = R.treeGap) {
    const list = bucket.get(Math.floor(x / BH) * 100003 + Math.floor(z / BH));
    if (!list) return false;
    for (const o of list) {
      const dx = x - foot[o], dz = z - foot[o + 1], c = Math.cos(foot[o + 4]), s = Math.sin(foot[o + 4]);
      const u = dx * c - dz * s, v = dx * s + dz * c;   // along the long axis (c, −s), across (s, c)
      if (Math.abs(u) < foot[o + 2] / 2 + gap && Math.abs(v) < foot[o + 3] / 2 + gap) return true;
    }
    return false;
  }
  const coverAt = (x, z, out = {}) => {
    out.built = mS(x, z, 0); out.ski = mS(x, z, 1); out.road = Math.max(mS(x, z, 2), fS(x, z, 0)); out.lawn = mS(x, z, 3);
    out.cut = fS(x, z, 1);
    return out;
  };
  const tmp = {};
  function keepOut(x, z) {
    coverAt(x, z, tmp);
    if (tmp.ski > 0.6 || tmp.road > 0.3 || tmp.lawn > 0.5 || tmp.cut > 0.3) return true;
    return inFootprint(x, z);
  }
  const treeDensity = (x, z) => { coverAt(x, z, tmp); return (1 - (1 - R.thin) * Math.min(1, tmp.built)) * (1 - 0.55 * smooth(0.3, 0.6, tmp.ski)); };
  return { coverAt, keepOut, treeDensity, inFootprint };
}

// The masks a band of the tree scatter needs (z0 … z1 in the world, ± margin): the rows of both rasters and the
// footprints there, as transferable typed arrays (a few hundred kB a band, not the whole 23 MB)
export function maskBundle({ mask, fine, foot }, z0, z1, margin = 80) {
  const crop = (r) => {
    if (!r) return null;
    const ja = Math.max(0, Math.floor((z0 - margin - r.z0) / r.cell)), jb = Math.min(r.h, Math.ceil((z1 + margin - r.z0) / r.cell));
    if (jb <= ja) return null;
    return { x0: r.x0, z0: r.z0 + ja * r.cell, cell: r.cell, w: r.w, h: jb - ja, channels: r.channels, data: r.data.slice(ja * r.w * r.channels, jb * r.w * r.channels) };
  };
  const keep = [];
  for (let o = 0; o < foot.length; o += 5) if (foot[o + 1] > z0 - margin && foot[o + 1] < z1 + margin) keep.push(o);
  const f = new Float32Array(keep.length * 5);
  keep.forEach((o, k) => f.set(foot.subarray(o, o + 5), k * 5));
  const m = crop(mask) ?? { x0: 0, z0: 0, cell: 1, w: 1, h: 1, channels: 4, data: new Uint8Array(4) };
  return { mask: m, fine: crop(fine), foot: f };
}

// prebuilt: { mask, fine } rasters a worker already made (src/prebake.js 'towns'): the same numbers, not made twice
export function buildTownsLayout(data, { heightAt = () => 0, lonLatToWorld, rules = TOWN_RULES, masksOnly = false, prebuilt = null } = {}) {
  if (!lonLatToWorld) throw new Error('buildTownsLayout: lonLatToWorld is required (src/geo.js)');
  const R = rules, toW = makeToWorld(data, lonLatToWorld);
  const line = (p) => { const out = new Float64Array(p.length); for (let k = 0; k < p.length; k += 2) { const [x, z] = toW(p[k], p[k + 1]); out[k] = x; out[k + 1] = z; } return out; };

  // ---- buildings: world position, the base on the lowest corner, the walls sunk to the ground's relief ----
  const D = data.buildings, NB = D.length / 9;
  const bd = new Float32Array(NB * BSTRIDE);
  let bmin = [Infinity, Infinity], bmax = [-Infinity, -Infinity], nb = 0;
  for (let k = 0; k < NB; k++) {
    const o = k * 9, e = D[o], n = D[o + 1], len = D[o + 2] / 2, wid = D[o + 3] / 2, ang = D[o + 4] / 10 * Math.PI / 180;
    const [x, z] = toW(e, n), [x2, z2] = toW(e + Math.cos(ang) * 10, n + Math.sin(ang) * 10);
    const yaw = Math.atan2(-(z2 - z), x2 - x);   // world: about +y, from +x toward −z (north); three's rotation.y
    const ca = Math.cos(yaw), sa = Math.sin(yaw);
    // the four corners' ground (the long axis along (ca, −sa) in x, z)
    let y0 = Infinity, y1 = -Infinity, ym = 0;
    for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
      const cx = x + u * len * ca + v * wid * sa, cz = z - u * len * sa + v * wid * ca;
      const y = heightAt(cx, cz); y0 = Math.min(y0, y); y1 = Math.max(y1, y); ym += y / 4;
    }
    if (y1 < 0.3) continue;   // under the lake (a pier house, or the terrain is not real yet)
    const wall = D[o + 5] / 2, roof = D[o + 6] / 2, kind = D[o + 7], facade = D[o + 8];
    // the walls run from below the low corner (at most 6 m below the mean: a hillside house stands on a tall
    // downhill wall, a big block on steep ground sinks into it) to the eaves, `wall` above the mean ground (+ up to 4 m
    // on the uphill side)
    const base = Math.max(y0, ym - 6) - 0.5, eaves = ym + wall + Math.min(4, Math.max(0, y1 - 3 - ym));
    const b = nb++ * BSTRIDE;
    bd[b] = x; bd[b + 1] = base; bd[b + 2] = z; bd[b + 3] = len; bd[b + 4] = wid; bd[b + 5] = yaw;
    bd[b + 6] = eaves - base;
    bd[b + 7] = roof; bd[b + 8] = kind; bd[b + 9] = facade; bd[b + 10] = hash(k, 7);
    bd[b + 11] = Math.max(len, wid, wall + roof);   // the size the LOD culls by
    bd[b + 12] = ym;
    bmin = [Math.min(bmin[0], x), Math.min(bmin[1], z)]; bmax = [Math.max(bmax[0], x), Math.max(bmax[1], z)];
  }
  const buildings = { count: nb, data: bd.subarray(0, nb * BSTRIDE) };

  // ---- clusters: 3 km cells; inside each, sorted by size (largest first) so a count draws the biggest ----
  const cells = new Map();
  for (let k = 0; k < nb; k++) {
    const x = bd[k * BSTRIDE], z = bd[k * BSTRIDE + 2], key = `${Math.floor(x / R.cluster)},${Math.floor(z / R.cluster)}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(k);
  }
  const order = [], clusters = [];
  for (const key of [...cells.keys()].sort()) {
    const ids = cells.get(key).sort((a, b) => bd[b * BSTRIDE + 11] - bd[a * BSTRIDE + 11] || a - b);
    let cx = 0, cz = 0, cy = 0;
    for (const k of ids) { cx += bd[k * BSTRIDE]; cz += bd[k * BSTRIDE + 2]; cy += bd[k * BSTRIDE + 1]; }
    cx /= ids.length; cz /= ids.length; cy /= ids.length;
    let r = 0; for (const k of ids) r = Math.max(r, Math.hypot(bd[k * BSTRIDE] - cx, bd[k * BSTRIDE + 2] - cz) + bd[k * BSTRIDE + 11]);
    clusters.push({ x: cx, y: cy, z: cz, r, start: order.length, count: ids.length, sizes: Float32Array.from(ids, (k) => bd[k * BSTRIDE + 11]) });
    order.push(...ids);
  }
  { const sorted = new Float32Array(nb * BSTRIDE); order.forEach((k, i) => sorted.set(bd.subarray(k * BSTRIDE, (k + 1) * BSTRIDE), i * BSTRIDE)); buildings.data = sorted; }

  // ---- the coarse mask over everything we place ----
  const runs = data.runs.map((r) => ({ ...r, xz: line(r.p) }));
  const lifts = data.lifts.map((l) => ({ ...l, xz: line(l.p) }));
  const roads = data.roads.map((r) => ({ ...r, xz: line(r.p) }));
  const land = data.land.map((l) => ({ ...l, xz: line(l.r) }));
  const piers = data.piers.map((p) => ({ ...p, xz: line(p.p) }));
  for (const f of [...runs, ...lifts, ...roads, ...land]) for (let k = 0; k < f.xz.length; k += 2) {
    bmin = [Math.min(bmin[0], f.xz[k]), Math.min(bmin[1], f.xz[k + 1])]; bmax = [Math.max(bmax[0], f.xz[k]), Math.max(bmax[1], f.xz[k + 1])];
  }
  const C = R.maskCell, mx0 = Math.floor(bmin[0] / C) * C - 4 * C, mz0 = Math.floor(bmin[1] / C) * C - 4 * C;
  const mw = Math.ceil((bmax[0] - mx0) / C) + 4, mh = Math.ceil((bmax[1] - mz0) / C) + 4;
  const M = raster(mx0, mz0, C, mw, mh, 4);
  if (prebuilt?.mask?.data.length === M.data.length) M.data.set(prebuilt.mask.data);
  else {
  // built ground: the residential tint, the commercial ground, the footprints themselves
  for (const l of land) {
    if (l.k === 0) M.fill(l.xz, 0, 0.3);
    else if (l.k === 1 || l.k === 2) M.fill(l.xz, 0, 0.7);
    else if (l.k === 3) M.fill(l.xz, 3, 1);          // golf: lawn
    else if (l.k === 4 || l.k === 6) M.fill(l.xz, 2, l.k === 4 ? 0.9 : 0.6);   // parking, the airfield: asphalt
  }
  for (let k = 0; k < nb; k++) {
    const o = k * BSTRIDE, x = buildings.data[o], z = buildings.data[o + 2], area = buildings.data[o + 3] * buildings.data[o + 4];
    const i = Math.floor((x - mx0) / C), j = Math.floor((z - mz0) / C), k0 = (j * mw + i) * 4;
    if (i < 0 || j < 0 || i >= mw || j >= mh) continue;
    M.data[k0] = Math.min(255, M.data[k0] + Math.round(255 * Math.min(1, area / (C * C)) * 1.2));   // roofs add up
  }
  for (const r of runs) {
    const g = r.glade ? 0.45 : 1;
    if (r.area) M.fill(r.xz, 1, g); else M.stroke(r.xz, r.w, 1, g);
  }
  // lift lines are cleared corridors: a chair's wide and plain, a gondola's or tram's narrow (its cabins ride high)
  for (const l of lifts) M.stroke(l.xz, l.k === 0 ? 12 : 8, 1, l.k === 0 ? 0.7 : 0.4);
  for (const r of roads) if (!r.br) M.stroke(r.xz, r.w, 2, 1);
  }

  // ---- the fine window: Hwy 89 on Emerald Bay's walls, the asphalt and the pale cut above it, the fill below ----
  const FB = R.fineBox;
  const [fa0, fa1] = [lonLatToWorld(FB.lon[0], FB.lat[1]), lonLatToWorld(FB.lon[1], FB.lat[0])];
  const FC = R.fineCell, fx0 = Math.floor(fa0[0] / FC) * FC, fz0 = Math.floor(fa0[1] / FC) * FC;
  const F = raster(fx0, fz0, FC, Math.ceil((fa1[0] - fx0) / FC), Math.ceil((fa1[1] - fz0) / FC), 2);
  const fineDone = prebuilt?.fine?.data.length === F.data.length;
  if (fineDone) F.data.set(prebuilt.fine.data);
  for (const r of fineDone ? [] : roads) {
    if (!r.s) continue;
    const p = r.xz;
    let inside = false;
    for (let k = 0; k < p.length; k += 2) if (p[k] > fx0 && p[k] < fx0 + F.w * FC && p[k + 1] > fz0 && p[k + 1] < fz0 + F.h * FC) { inside = true; break; }
    if (!inside) continue;
    F.stroke(p, r.w, 0, 1);
    // the scar: walk the road every 6 m; where the ground falls away across it, a cut uphill and a fill downhill,
    // wider on the steeper wall (a 30° slope: ≈ 8 m of cut; 45°: ≈ 18 m)
    for (let s = 0; s + 3 < p.length; s += 2) {
      const ax = p[s], az = p[s + 1], bx = p[s + 2], bz = p[s + 3], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.1) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      for (let t = 0; t < L; t += 6) {
        const x = ax + (bx - ax) * t / L, z = az + (bz - az) * t / L, off = r.w / 2 + 6;
        const hl = heightAt(x + nx * off, z + nz * off), hr = heightAt(x - nx * off, z - nz * off);
        const slope = Math.abs(hl - hr) / (2 * off), up = hl > hr ? 1 : -1;
        const cut = 2 + 18 * smooth(0.35, 1.0, slope), fill = 1 + 9 * smooth(0.35, 1.0, slope);
        const seg = [x - (bx - ax) / L * 3, z - (bz - az) / L * 3, x + (bx - ax) / L * 3, z + (bz - az) / L * 3];
        const shift = (d, w) => seg.map((v, i) => v + (i % 2 ? nz : nx) * up * d);
        F.stroke(shift(r.w / 2 + cut / 2, cut), cut, 1, 0.9);
        F.stroke(shift(-(r.w / 2 + fill / 2), fill), fill, 1, 0.55);
      }
    }
  }

  // ---- the queries the trees read (keepOut, treeDensity) and the footprints they use ----
  const foot = new Float32Array(nb * 5);
  for (let k = 0; k < nb; k++) { const o = k * BSTRIDE; foot.set([buildings.data[o], buildings.data[o + 2], buildings.data[o + 3], buildings.data[o + 4], buildings.data[o + 5]], k * 5); }
  const { coverAt, keepOut, treeDensity, inFootprint } = makeQueries({ mask: M, fine: F, foot, rules: R });

  if (masksOnly) return { rules: R, buildings, mask: M, fine: F, foot, coverAt, keepOut, treeDensity, inFootprint };

  // ---- night lights ----
  const L = [];
  const WARM = [1.0, 0.62, 0.32], LED = [1.0, 0.82, 0.62], SODIUM = [1.0, 0.5, 0.16], WHITE = [0.9, 0.93, 1.0], GREEN = [0.35, 1.0, 0.5];
  const light = (x, y, z, c, size, on) => L.push(x, y, z, c[0], c[1], c[2], size, on);
  for (let k = 0; k < nb; k++) {
    const o = k * BSTRIDE, b = buildings.data, x = b[o], y = b[o + 1], z = b[o + 2], len = b[o + 3], wid = b[o + 4], yaw = b[o + 5];
    const kind = b[o + 8], s = b[o + 10] * 1e6 | 0, ca = Math.cos(yaw), sa = Math.sin(yaw);
    const ground = b[o + 12];   // the mean ground under it
    const at = (u, v, hgt) => [x + u * ca + v * sa, ground + hgt, z - u * sa + v * ca];
    if (kind === 0 || kind === 5 || kind === 3) {          // houses, cabins, lodges: a window or two, warm
      const n = kind === 3 ? 3 : hash(s, 1) < 0.62 ? (hash(s, 2) < 0.3 ? 2 : 1) : 0;
      for (let i = 0; i < n; i++) {
        const side = hash(s, 10 + i) < 0.5 ? -1 : 1, u = (hash(s, 20 + i) - 0.5) * len * 0.8;
        light(...at(u, side * (wid / 2 + 0.3), 2.2 + (hash(s, 30 + i) < 0.3 ? 2.8 : 0)), hash(s, 40 + i) < 0.85 ? WARM : LED, 1.2, -1.5 - 5 * hash(s, 50 + i));
      }
    } else if (kind === 1 || kind === 4) {                  // shops, offices, hotels: lights round the walls
      const n = Math.min(8, 1 + Math.floor(len * wid / 350));
      for (let i = 0; i < n; i++) {
        const side = i % 4, u = side < 2 ? (hash(s, 60 + i) - 0.5) * len : (side === 2 ? -1 : 1) * len / 2, v = side < 2 ? (side ? 1 : -1) * wid / 2 : (hash(s, 70 + i) - 0.5) * wid;
        light(...at(u * 1.02, v * 1.02, 3 + 3 * hash(s, 80 + i)), hash(s, 90 + i) < 0.5 ? LED : WHITE, 1.6, 1.5 - 3 * hash(s, 95 + i));
      }
    } else if (kind === 2) {                                 // high-rise: the crown's corners (the windows are the shader's)
      for (const [u, v] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) light(...at(u * len, v * wid, b[o + 6] - 0.5 + 1), WHITE, 3.0, 2.5);
    }
  }
  // street lights along the roads where the ground is built (≈ every 40 m, both sides on the trunk roads)
  for (const r of roads) {
    const p = r.xz;
    let acc = 0;
    for (let s = 0; s + 3 < p.length; s += 2) {
      const ax = p[s], az = p[s + 1], bx = p[s + 2], bz = p[s + 3], Lg = Math.hypot(bx - ax, bz - az);
      if (Lg < 0.1) continue;
      const nx = -(bz - az) / Lg, nz = (bx - ax) / Lg;
      for (let t = (40 - acc) % 40; t < Lg; t += 40) {
        const x = ax + (bx - ax) * t / Lg, z = az + (bz - az) * t / Lg;
        const built = M.sample(x, z, 0) + 0.6 * M.sample(x, z, 2);
        if (built < 0.25) continue;
        const id = Math.round(x * 7.1 + z * 13.3) | 0;
        const sides = r.c <= 1 ? [-1, 1] : [hash(id, 3) < 0.5 ? -1 : 1];
        for (const sd of sides) {
          const off = sd * (r.w / 2 + 1.5);
          const y = heightAt(x + nx * off, z + nz * off);
          if (y < 0.3) continue;
          light(x + nx * off, y + 8, z + nz * off, hash(id, 5 + sd) < 0.55 ? SODIUM : LED, 2.0, 1.0 - 1.5 * hash(id, 9 + sd));
        }
      }
      acc = (acc + Lg) % 40;
    }
  }
  // the big lots: lamp posts on a 36 m grid (the casinos', the ski bases')
  for (const l of land) {
    if (l.k !== 4) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 0; k < l.xz.length; k += 2) { x0 = Math.min(x0, l.xz[k]); x1 = Math.max(x1, l.xz[k]); z0 = Math.min(z0, l.xz[k + 1]); z1 = Math.max(z1, l.xz[k + 1]); }
    for (let z = z0 + 18; z < z1; z += 36) for (let x = x0 + 18; x < x1; x += 36) {
      if (M.sample(x, z, 2) < 0.6) continue;
      const y = heightAt(x, z); if (y < 0.3) continue;
      light(x, y + 9, z, WHITE, 2.2, 0.5);
    }
  }
  // piers: a light at the head of the longer ones (white; a green on a few public piers)
  for (const p of piers) {
    if (p.k !== 0 || p.a) continue;
    const q = p.xz, n = q.length / 2;
    let len = 0; for (let k = 1; k < n; k++) len += Math.hypot(q[2 * k] - q[2 * k - 2], q[2 * k + 1] - q[2 * k - 1]);
    if (len < 30) continue;
    // the head: the end over the water
    const h0 = heightAt(q[0], q[1]), h1 = heightAt(q[2 * n - 2], q[2 * n - 1]);
    const [hx, hz] = h0 < h1 ? [q[0], q[1]] : [q[2 * n - 2], q[2 * n - 1]];
    const id = Math.round(hx * 3.7 + hz * 5.1) | 0;
    if (hash(id, 1) < 0.55) light(hx, 3.2, hz, hash(id, 2) < 0.12 ? GREEN : WHITE, 1.4, 0.5 - 2 * hash(id, 3));
  }
  const lights = { count: L.length / LSTRIDE, data: Float32Array.from(L) };

  // ---- lift towers: every ≈ 70 m along each line; the terminals at the ends ----
  const towers = [];
  for (const l of lifts) {
    const p = l.xz, n = p.length / 2;
    for (let k = 0; k + 1 < n; k++) {
      const ax = p[2 * k], az = p[2 * k + 1], bx = p[2 * k + 2], bz = p[2 * k + 3], Lg = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax);
      const m = Math.max(1, Math.round(Lg / 70));
      for (let i = 0; i <= m; i++) {
        if (i === m && k + 2 < n) continue;
        const x = ax + (bx - ax) * i / m, z = az + (bz - az) * i / m, end = (k === 0 && i === 0) || (k + 2 === n && i === m);
        towers.push(x, heightAt(x, z), z, yaw, end ? 1 : 0, l.k);
      }
    }
  }

  // ---- piers and breakwaters as deck segments ----
  const decks = [];
  for (const p of piers) {
    const q = p.xz;
    for (let k = 0; k + 3 < q.length; k += 2) {
      const ax = q[k], az = q[k + 1], bx = q[k + 2], bz = q[k + 3], Lg = Math.hypot(bx - ax, bz - az);
      if (Lg < 0.5) continue;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2, g = heightAt(mx, mz);
      const y = p.k === 0 ? Math.max(1.2, g + 1.2) : Math.max(1.5, g + 1.5);
      decks.push(mx, y, mz, Lg + (p.a ? 0 : p.w * 0.5), p.w, Math.atan2(-(bz - az), bx - ax), p.k);
    }
  }
  // the straight piers as root → head (the root on the higher ground), for src/shoreline.js's pilings and boathouses
  const osmPiers = [];
  for (const p of piers) {
    if (p.k !== 0 || p.a || p.xz.length < 4) continue;
    const n = p.xz.length / 2, a = [p.xz[0], p.xz[1]], b = [p.xz[2 * n - 2], p.xz[2 * n - 1]];
    const [r, h] = heightAt(a[0], a[1]) >= heightAt(b[0], b[1]) ? [a, b] : [b, a];
    const length = Math.hypot(h[0] - r[0], h[1] - r[1]);
    if (length < 8 || heightAt(h[0], h[1]) > -0.3) continue;   // a pier ends over water
    osmPiers.push({ x: r[0], z: r[1], dirX: (h[0] - r[0]) / length, dirZ: (h[1] - r[1]) / length, length, width: p.w });
  }
  return {
    rules: R, buildings, clusters, lights, mask: M, fine: F, foot, coverAt, keepOut, treeDensity, inFootprint, osmPiers,
    lifts: { count: towers.length / 6, data: Float32Array.from(towers) },
    piers: { count: decks.length / 7, data: Float32Array.from(decks) },
    stats: { buildings: nb, clusters: clusters.length, lights: L.length / LSTRIDE, towers: towers.length / 6, decks: decks.length / 7, mask: [mw, mh], fine: [F.w, F.h] },
  };
}
