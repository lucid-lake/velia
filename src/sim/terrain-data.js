import { fetchRetry } from './fetchRetry.js';
import { toFlags } from './core/flags.js';
import { feature } from '../core/features.js';
import { CURRENT_WATERS } from './waters/current.js';
import { dayToken } from './day.js';
// A lake's terrain grids (Tahoe's: tools/terrain/build_tahoe.py → terrain/*.lsh + terrain/tahoe.json): the loader
// and the fast CPU queries. Plain JS, no three.js: the page, the bake workers and node tests all use it. Which files:
// the lake profile's terrain block (src/waters/<id>.json: dir, full, phone; this page's lake by default).
//   const D = await loadTerrain();        // fetch (browser, worker) or read (node) and decode: ≈ 25 MB of Uint16
//   loadTerrain(variant, waters)          // another lake's grids (its profile)
//   const s = makeSampler(D);             // s.height(x, z), s.distance(x, z), s.cover(x, z, out)
// A level is a north-up grid of texel centres: x = x0 + i·step, z = z0 + j·step. A query takes the finest level
// that holds the point and blends into the next coarser one over its last BLEND texels, so level edges never step.
// Encoding (.lsh): gzip of a uint16 grid, 2-D predicted (left + up − up-left, mod 2^16), hi-byte plane then lo-byte
// plane; cover grids are plain gzip'd uint8 class ids (build_tahoe.py NLCD_MAP).

const BLEND = 12;   // texels

async function inflate(bytes) {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('gzip');
    const buf = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
    return new Uint8Array(buf);
  }
  const { gunzipSync } = await import('node:zlib');
  return new Uint8Array(gunzipSync(bytes));
}

function unpredict(p, w, h) {
  const n = w * h, q = new Uint16Array(n);
  for (let j = 0, k = 0; j < h; j++) {
    for (let i = 0; i < w; i++, k++) {
      const r = (p[k] << 8) | p[n + k];
      const left = i ? q[k - 1] : 0, up = j ? q[k - w] : 0, ul = i && j ? q[k - w - 1] : 0;
      q[k] = (r + (j && i ? left + up - ul : j ? up : left)) & 0xffff;
    }
  }
  return q;
}

const isNode = typeof process !== 'undefined' && !!process.versions?.node && typeof window === 'undefined' && typeof self === 'undefined';

// Phones share the page's grid bytes with their workers (fix/ios-start-2): a page that loads the phone set keeps the
// compressed files (3.5 MB) and posts a copy to each worker before its first job (primeWorker); a worker reads them from
// there, not the network (each of the load-time bake's workers fetched the whole set again: about 10 s on the phone
// profile's 4G). The desktop is as before: each worker fetches (from the HTTP cache).
const kept = new Map();
let keptDone = null, keptReady = null;
export const terrainFilesReady = () => (keptReady ??= new Promise((r) => { keptDone = r; }));
// tops: the phone treetops' bytes, when the page has them (src/prebake.js fetches them once for its workers)
export const keptTops = { buf: null };
// topsLater (perf/slow-loading-2): the grids now, the treetops in a second message (primeTops) when they land, so the
// bake's other jobs start at once; a worker's treetops wait for that message (src/forest/treetops.js)
export function primeWorker(w, { topsLater = false } = {}) {
  if (!kept.size) return false;
  const files = [...kept].map(([k, b]) => [k, b.slice(0)]), tops = !topsLater && keptTops.buf ? keptTops.buf.slice(0) : null;
  w.postMessage({ terrainFiles: files, tops, topsLater }, [...files.map(([, b]) => b), ...(tops ? [tops] : [])]);
  return true;
}
export function primeTops(w, buf) {
  const tops = buf ? buf.slice(0) : null;
  w.postMessage({ topsOnly: true, tops }, tops ? [tops] : []);
}
// in a worker: what the page posted (see primeWorker, primeTops), for this module and src/forest/treetops.js. A module's
// own state, not a global: a worker has no services registry, and its modules are one graph
//   files: name -> bytes (the grids); tops: the treetops' bytes; wait: resolves when they land (topsLater); done: its resolve
export const workerPrime = { files: null, tops: null, wait: null, done: null };
export function acceptFiles(data) {
  if (data?.topsOnly) { if (data.tops) workerPrime.tops = data.tops; workerPrime.done?.(); return true; }
  if (!data?.terrainFiles) return false;
  workerPrime.files = new Map(data.terrainFiles);
  if (data.tops) workerPrime.tops = data.tops;
  if (data.topsLater) workerPrime.wait = new Promise((r) => { workerPrime.done = r; setTimeout(r, 30000); });   // never a deadlock: past it the worker fetches its own
  return true;
}

async function readFile(name, dir = CURRENT_WATERS.terrain.dir) {
  const primed = workerPrime.files?.get(name);
  if (primed) return new Uint8Array(primed);
  if (isNode) {
    const { readFile: rf } = await import('node:fs/promises');
    // the repo's terrain/ as before; another lake's folder (its profile's terrain.dir, from the repo root) by a plain URL
    // string (a URL template on import.meta.url with the folder in it makes the bundler copy every file two folders deep)
    const here = import.meta.url, url = dir === 'terrain' ? new URL(`../../terrain/${name}`, import.meta.url) : new URL(`${here.slice(0, here.lastIndexOf('/src/') + 1)}${dir}/${name}`);
    return new Uint8Array(await rf(url));
  }
  // a worker takes the HTTP cache's copy without asking the server again (perf/slow-loading): the page fetched
  // every grid (src/terrain.js's top-level await) before any worker exists, so the copy is this load's; asking again cost
  // each of the ≈ 20 workers a round trip per file (280 revalidations on the desktop: ≈ 20 s at Slow 4G's 562 ms)
  const r = await fetchRetry(`/${dir}/${name}`, typeof document === 'undefined' ? { cache: 'force-cache' } : undefined);
  if (!r.ok) throw new Error(`terrain: ${name} ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
}

// Which grid set this page (or worker) loads (fix/ios-start-2): 'phone' is the same land averaged down (the bay and the
// basin 2x, the lake and the ring 4x: 3.5 MB to fetch, not 10.1, and a quarter of the memory; tools/terrain/
// phone_terrain.mjs). A page picks it on a phone or tablet (src/core/features.js terrainSet, or ?terrain=phone); a
// worker is told by its name (src/stream/workers.js names it); node and the desktop load the full set.
export function terrainVariant(g = globalThis) {
  if (isNode) return g.__lakeshoreTerrain ?? 'full';
  if (typeof g.document === 'undefined') return /^phone/.test(g.name ?? '') ? 'phone' : 'full';   // a worker
  const flags = toFlags(g.location?.search ?? '');
  if (flags.terrain === 'phone' || flags.terrain === 'full') return flags.terrain;
  if (flags.headless != null) return 'full';   // captures and goldens: the full land, always
  return feature('terrainSet').tier;   // the registry (src/core/features.js): a phone or a tablet takes the phone set
}
const manifestFile = (v = terrainVariant(), waters = CURRENT_WATERS) => (v === 'phone' && waters.terrain.phone ? waters.terrain.phone : waters.terrain.full);
// a worker's name: its grid set, the lake (src/waters/current.js reads it) and the day (src/day.js reads it: the season)
export const workerName = (v = terrainVariant()) => `${v} ${CURRENT_WATERS.id} ${dayToken()}`;

export async function loadTerrain(variant = terrainVariant(), waters = CURRENT_WATERS, { manifest: given = null } = {}) {   // given: a composed manifest (a region level in the bay's slot: v2/terrain/region.js shoreManifest) in place of the file's
  const dir = waters.terrain.dir, read = (name) => readFile(name, dir);
  const manifest = given ?? JSON.parse(new TextDecoder().decode(await read(manifestFile(variant, waters))));
  const keep = variant === 'phone' && typeof document !== 'undefined';   // the page of a phone keeps the bytes for its workers
  const levels = await Promise.all(manifest.levels.map(async (L) => {
    const [hb, db, cb] = await Promise.all([read(L.height), read(L.distance), L.cover ? read(L.cover) : null]);
    if (keep) { kept.set(L.height, hb.slice().buffer); kept.set(L.distance, db.slice().buffer); if (cb) kept.set(L.cover, cb.slice().buffer); }
    const [hp, dp, cp] = await Promise.all([inflate(hb), inflate(db), cb ? inflate(cb) : null]);
    return { ...L, H: unpredict(hp, L.w, L.h), D: unpredict(dp, L.dw, L.dh), C: cp };
  }));
  if (keep) kept.set(manifestFile(variant, waters), new TextEncoder().encode(JSON.stringify(manifest)).buffer);
  if (typeof document !== 'undefined' && variant === terrainVariant()) { terrainFilesReady(); keptDone(true); }   // the page's own set is in (a phone keeps its bytes for the workers; a desktop's workers read the HTTP cache)
  return { manifest, levels };
}

// Cover classes (build_tahoe.py): 0 none, 1 lake, 2 urban, 3 open developed, 4 rock, 5 forest, 6 shrub, 7 grass,
// 8 wetland, 9 snow/ice, 10 another lake (a pond above ours)
import { COVER } from './terrain-cover.js';
export { COVER };

export function makeSampler({ manifest, levels }) {
  const HO = manifest.height.offset, HS = manifest.height.step, DS = manifest.distance.step;
  const n = levels.length;
  // flat per-level arrays, finest first (the hot loop reads these, not objects)
  const X0 = new Float64Array(n), Z0 = new Float64Array(n), ST = new Float64Array(n), IS = new Float64Array(n);
  const W = new Int32Array(n), Hh = new Int32Array(n), HG = levels.map((L) => L.H);
  const DX0 = new Float64Array(n), DZ0 = new Float64Array(n), DST = new Float64Array(n), DIS = new Float64Array(n);
  const DW = new Int32Array(n), DH = new Int32Array(n), DG = levels.map((L) => L.D);
  levels.forEach((L, k) => {
    X0[k] = L.x0; Z0[k] = L.z0; ST[k] = L.step; IS[k] = 1 / L.step; W[k] = L.w; Hh[k] = L.h;
    const ds = L.dstep ?? L.step * L.dk;   // the phone set says where its shared distance grid sits (dx0, dz0, dstep)
    DX0[k] = L.dx0 ?? L.x0; DZ0[k] = L.dz0 ?? L.z0; DST[k] = ds; DIS[k] = 1 / ds; DW[k] = L.dw; DH[k] = L.dh;
  });

  // bilinear on grid g (w × h) at fractional texel (fx, fz), clamped
  function bil(g, w, h, fx, fz) {
    if (fx < 0) fx = 0; else if (fx > w - 1) fx = w - 1;
    if (fz < 0) fz = 0; else if (fz > h - 1) fz = h - 1;
    let i = fx | 0, j = fz | 0;
    if (i > w - 2) i = w - 2; if (j > h - 2) j = h - 2;
    const u = fx - i, v = fz - j, k = j * w + i;
    const a = g[k], b = g[k + 1], c = g[k + w], d = g[k + w + 1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  function height(x, z) {
    let acc = 0, left = 1;
    for (let k = 0; k < n; k++) {
      const fx = (x - X0[k]) * IS[k], fz = (z - Z0[k]) * IS[k], w = W[k], h = Hh[k];
      const m = Math.min(fx, fz, w - 1 - fx, h - 1 - fz);
      if (m <= 0 && k < n - 1) continue;
      const v = HO + HS * bil(HG[k], w, h, fx, fz);
      if (m >= BLEND || k === n - 1) return acc + left * v;
      const t = m / BLEND, s = t * t * (3 - 2 * t);
      acc += left * s * v; left *= 1 - s;
    }
    return acc;
  }

  function distance(x, z) {
    let acc = 0, left = 1;
    for (let k = 0; k < n; k++) {
      const fx = (x - DX0[k]) * DIS[k], fz = (z - DZ0[k]) * DIS[k], w = DW[k], h = DH[k];
      const m = Math.min(fx, fz, w - 1 - fx, h - 1 - fz);
      if (m <= 0 && k < n - 1) continue;
      const v = DS * (bil(DG[k], w, h, fx, fz) - 32768);
      if (m >= BLEND || k === n - 1) return acc + left * v;
      const t = m / BLEND, s = t * t * (3 - 2 * t);
      acc += left * s * v; left *= 1 - s;
    }
    return acc;
  }

  // the finest level's spacing at (x, z): the scale normals and slopes are taken at
  function spacing(x, z) {
    for (let k = 0; k < n; k++) {
      const fx = (x - X0[k]) * IS[k], fz = (z - Z0[k]) * IS[k];
      if (Math.min(fx, fz, W[k] - 1 - fx, Hh[k] - 1 - fz) > 1) return ST[k];
    }
    return ST[n - 1];
  }

  // cover: the class weights of the four nearest texels of the finest cover grid that holds (x, z) (11 classes)
  const CL = levels.filter((L) => L.C).map((L) => ({ x0: L.cx0 ?? L.x0, z0: L.cz0 ?? L.z0, step: L.cstep ?? L.step * L.ck, w: L.cw, h: L.ch, C: L.C }));
  function cover(x, z, out = new Float32Array(COVER.length)) {
    out.fill(0);
    for (const L of CL) {
      const fx = (x - L.x0) / L.step, fz = (z - L.z0) / L.step;
      if (fx < 0 || fz < 0 || fx > L.w - 1 || fz > L.h - 1) continue;
      const i = Math.min(L.w - 2, fx | 0), j = Math.min(L.h - 2, fz | 0), u = fx - i, v = fz - j, k = j * L.w + i;
      out[L.C[k]] += (1 - u) * (1 - v); out[L.C[k + 1]] += u * (1 - v);
      out[L.C[k + L.w]] += (1 - u) * v; out[L.C[k + L.w + 1]] += u * v;
      return out;
    }
    return out;   // outside every cover grid: all zero (the caller falls back to elevation rules)
  }

  return { height, distance, spacing, cover, levels, manifest };
}
