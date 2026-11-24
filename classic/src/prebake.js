// Load-time bake: the first load's heavy CPU grids, computed in parallel workers (src/bake-worker.js) while the
// page's modules wait on this module's top-level await; their users then take them: take(key) ?? compute().
// They run the same functions on the same inputs, so the numbers are the same, and a missing key (another seed, a
// changed preset, a failed worker, node tests) only means the user computes in place, as before.
// Before (2026-10-29, M5 Pro, cold sail load): ≈ 3.3 s of one main thread; the page froze for 3.8 s.
//   import { take } from './prebake.js';
//   const scatter = take(`scatter:${terrain.seed}:${seed}`) ?? scatterTrees(terrain, { seed });
// Keys:   scatter:tiles:<seed>                         Map tile key → the start bubble's scatter tiles   (src/trees.js)
//         takeLater(<tile key>)                        a promise: a forest tile past the start bubble, still baking
//         shore|depth:<seed>:<size>:<extent>:<cx>:<cz>  Float32Array               (src/water.js, the four maps)
//         clouds:shape|detail:<seed>:<size>, clouds:weather:<seed>   Uint8Array    (src/clouds.js)
//         lod:<seed>:<x0>,<z0>,<size>                  chunk heights             (src/terrain-mesh.js)
// ?prebake=0 turns it off (for A/B timing); the demos never bake. Inputs come from the URL as the core reads them (src/core/: seed, cam, drive).
import { terrainVariant, workerName, terrainFilesReady, primeWorker, primeTops, keptTops } from '../../src/sim/terrain-data.js';   // the workers load the same grid set as the page (phone or full)
import { TREE_RULES, RIM_RULES } from './trees-scatter.js';
import { allScatterTiles, tilesNear, byTileRow } from './forest/scatter-tiles.js';
import { rectDist } from './stream/grid.js';
import { maskBundle } from './towns-layout.js';
import { lodLeaves } from './terrain-lod.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { toBytes } from './clouds-noise.js';
import { span } from './profile.js';
import { CAMERAS, MODE_STARTS } from '../../src/sim/core/presets.js';   // the core's camera presets: the first lod.update() is at the preset's position
import { fetchBytes } from '../../src/fetchGz.js';
import { FLAGS } from '../../src/sim/core/flags.js';
import { CURRENT_VESSEL } from '../../src/sim/vessels/current.js';
import { prefetchBytes } from '../../src/prefetch.js';
import { STBN_URL } from './core/stbnUrl.js';
import { GROUND_TEXTURES } from './ground-layout.js';

const store = new Map();
export function take(key) {
  const v = store.get(key);
  if (v !== undefined) store.delete(key);   // each is taken once; drop the reference
  return v;
}
// results still baking after the page went on (the forest's tiles past the start bubble): a promise per key, taken
// once; it resolves to the result, or to undefined if the bake gave up (the caller builds it elsewhere)
const later = new Map();
const laterOf = (key) => { let e = later.get(key); if (!e) { let resolve; const promise = new Promise((r) => { resolve = r; }); later.set(key, (e = { promise, resolve, taken: false })); } return e; };
const settleLater = (key, v) => laterOf(key).resolve(v);
const failLater = () => { for (const e of later.values()) e.resolve(undefined); };
// The start bubble's scatter (perf/slow-loading-2): on a live page the module graph no longer waits for it. Its
// jobs need the treetops (3.3 MB as a gzip twin on the desktop: ≈ 17 s at Slow 4G), so the bake used to hit its 20 s
// timeout and hold the GPU's start for it. Now the page goes on once the other jobs are done, and src/trees.js awaits this
// promise (the same tiles, from the same workers; undefined parts are scattered in place, as before). Captures: the bake
// waits for them, as before, so this resolves at once there.
let firstSettle = null;
const firstPromise = new Promise((r) => { firstSettle = r; });
export const startBubbleReady = () => firstPromise;
export function takeLater(key) {
  const e = later.get(key);
  if (!e || e.taken) return undefined;
  e.taken = true; later.delete(key);
  return e.promise;
}
// where the page starts (the camera preset, a mode's start, ?start=): the forest's start bubble is round these
const START_BUBBLE = 1500;
const BACKGROUND_WORKERS = 4;   // the bake's workers that go on with the background tiles (the rest end: the page's main thread needs the cores)   // m: the near band at rest (src/stream/config.js STREAM.bands.near) plus a margin
function startCentres(flags) {
  const out = [];
  const pos = CAMERAS[flags.cam ?? 'A']?.pos; if (pos) out.push([pos[0], pos[2]]);
  const st = flags.start?.split(',').map(parseFloat);
  if (st?.length === 2) out.push(st);
  else if (MODE_STARTS[flags.mode]) out.push(MODE_STARTS[flags.mode]);
  const cp = flags.campos?.split(',').map(Number); if (cp?.length === 3) out.push([cp[0], cp[2]]);
  return out;
}

// src/water.js's shore and depth maps: the inner 1024² over 4096 m round the bay, the outer 512² over 40 960 m round the
// lake (their centres: the lake profile's terrain.bayCentre, terrain.lakeCentre; this page's lake)
const [BX, BZ] = CURRENT_WATERS.terrain.bayCentre, [LX, LZ] = CURRENT_WATERS.terrain.lakeCentre;
const WATER_MAPS = [{ size: 1024, extent: 4096, cx: BX, cz: BZ, bands: 8 }, { size: 512, extent: 40960, cx: LX, cz: LZ, bands: 2 }];
const SHAPE = 96, DETAIL = 32;
const TIMEOUT_MS = 20000;   // a stuck worker never holds the page: the rest is computed in place

function bands(n, k) { const out = []; for (let b = 0; b < k; b++) out.push([Math.round(b * n / k), Math.round((b + 1) * n / k)]); return out; }
function concat(parts, Type) {
  const out = new Type(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function bake(flags) {
  const seed = parseInt(flags.seed ?? '1', 10);
  const jobs = [];   // [cost, job, args, onResult]; run longest first
  const join = (n, onAll) => { const parts = new Array(n); let left = n; return (i) => (r) => { parts[i] = r; if (--left === 0) onAll(parts); }; };

  // the towns' masks (src/towns-layout.js), built once in a worker; the page keeps them for createTowns (prebuilt) and
  // hands each scatter band its crop (maskBundle). The scatter bands wait for them (they go on the queue when it lands).
  const withTowns = true;
  const late = [];   // jobs released when the towns' masks arrive
  const background = [];   // jobs that do not hold the page: the forest's tiles past the start bubble
  let mastsReady = !withTowns;
  // the forest's scatter by tile (src/forest/scatter-tiles.js): only the start bubble's tiles hold
  // the page (the first frame); the rest bake right after, in the same workers, in the background, nearest first, and
  // stream in (src/trees.js takes them with takeLater). One job per tile row band (the towns' mask crop).
  const centres = startCentres(flags);
  const all = allScatterTiles(), first = new Set(tilesNear(all, centres, START_BUBBLE).map((t) => t.key));
  const dist = (t) => Math.min(...centres.map(([x, z]) => rectDist(x, z, t.rect)));
  const scatterJob = (tiles, blocking) => {
    const t0 = tiles[0], R = t0.group === 'rim' ? RIM_RULES : TREE_RULES;
    if (blocking) firstLeft += tiles.length;
    const job = [blocking ? 1 : 0, 'tiles', { seed, treeSeed: seed, lidar: true, group: t0.group, rows: t0.rows, tiles: tiles.map((t) => [t.key, t.cols[0], t.cols[1]]),
      zBand: [R.region.z0 + t0.rows[0] * R.cell, R.region.z0 + t0.rows[1] * R.cell] }, (res) => {
      for (const [key, r] of res) { if (blocking) firstTiles.set(key, r); else settleLater(key, r); }
      if (blocking && (firstLeft -= tiles.length) <= 0) firstSettle(true);
    }, blocking ? 0 : Math.min(...tiles.map(dist))];
    for (const t of tiles) if (!blocking) laterOf(t.key);   // a promise exists from now on
    return job;
  };
  const firstTiles = new Map(); store.set(`scatter:tiles:${seed}`, firstTiles);
  let firstLeft = 0;
  for (const row of byTileRow(all)) {
    const a = row.filter((t) => first.has(t.key)), b = row.filter((t) => !first.has(t.key));
    if (a.length) (withTowns ? late : jobs).push(scatterJob(a, true));
    if (b.length) background.push(scatterJob(b, false));
  }
  background.sort((x, y) => x[4] - y[4]);
  if (!firstLeft) firstSettle(true);
  if (withTowns) jobs.push([100, 'towns', { seed, full: true }, (r) => {
    if (r.layout) { store.set(`towns:layout:${seed}`, r.layout); delete r.layout; }   // the whole layout (src/towns.js)
    store.set(`towns:masks:${seed}`, r); store.set(`towns:masks:scatter:${seed}`, r);   // the second for the forest's streamed tiles
    for (const j of late) { j[2].towns = maskBundle(r, ...j[2].zBand); }
    for (const j of background) { j[2].towns = maskBundle(r, ...j[2].zBand); }
    mastsReady = true;
    late.sort((a, b) => b[0] - a[0]);
    jobs.push(...late); late.length = 0;
    wake();
  }]);
  // (the terrain's skyline is a baked file now: terrain/naip/horizon-bay.hzg, src/horizon-fine.js)
  // the water's shore distance and depth maps (src/water.js)
  for (const m of WATER_MAPS) for (const kind of ['shore', 'depth']) {
    const B = bands(m.size, m.bands), done = join(B.length, (p) => store.set(`${kind}:${seed}:${m.size}:${m.extent}:${m.cx}:${m.cz}`, concat(p, Float32Array)));
    B.forEach((rows, i) => jobs.push([m.size * (rows[1] - rows[0]) / 40000, kind, { seed, opts: { size: m.size, extent: m.extent, cx: m.cx, cz: m.cz, rows } }, done(i)]));
  }
  // the cloud volumes (src/clouds.js): the shape in z slabs; the percentile stretch on the whole, here, as there
  { const B = bands(SHAPE, 12), done = join(B.length, (p) => store.set(`clouds:shape:${seed}:${SHAPE}`, toBytes(concat(p, Float32Array))));
    B.forEach(([z0, z1], i) => jobs.push([z1 - z0, 'shape', { seed, size: SHAPE, z0, z1 }, done(i)]));
    jobs.push([1, 'detail', { seed, size: DETAIL }, (r) => store.set(`clouds:detail:${seed}:${DETAIL}`, toBytes(r))]);
    jobs.push([1, 'weather', { seed }, (r) => store.set(`clouds:weather:${seed}`, r)]); }
  // the terrain chunks for the first camera (src/terrain-mesh.js), in batches
  const pos = flags.drive == null ? CAMERAS[flags.cam ?? 'A']?.pos : null;
  if (pos) {
    const leaves = lodLeaves({ x: pos[0], y: pos[1], z: pos[2] });
    for (let i = 0; i < leaves.length; i += 16) {
      const chunks = leaves.slice(i, i + 16);
      jobs.push([chunks.length / 16, 'lod', { seed, chunks }, (hs) => chunks.forEach((c, k) => store.set(`lod:${seed}:${c.join(',')}`, hs[k]))]);
    }
  }
  jobs.sort((a, b) => b[0] - a[0]);
  // the page's own jobs (all but the start bubble's tile bands): a live page goes on when they are done (above)
  let pageLeft = jobs.filter((j) => j[1] !== 'tiles').length;
  let pageSettle = null;
  const pageDone = new Promise((r) => { pageSettle = r; });
  const pageJob = (job) => { if (job !== 'tiles' && --pageLeft <= 0) pageSettle(true); };
  if (pageLeft <= 0) pageSettle(true);

  // the background queue (the forest past the start bubble): the workers go on with it once the page's own jobs are
  // done, after the bake's promise resolved; then they end
  const nextBackground = () => (mastsReady && background.length ? background.shift() : null);
  const n = Math.max(2, Math.min(16, (navigator.hardwareConcurrency || 4) - 2));
  const workers = Array.from({ length: n }, () => new Worker(new URL('./bake-worker.js', import.meta.url), { type: 'module', name: workerName() }));
  // a phone: the workers take the page's grid bytes (one fetch, not one per worker): wait for them, then start
  if (terrainVariant() === 'phone') {
    const tops = fetchBytes('/terrain/forest/treetops-phone.tps').catch(() => null);   // once, for every worker (the gzip twin in a build: src/fetchGz.js)
    await Promise.race([terrainFilesReady(), new Promise((r) => setTimeout(r, 20000))]);
    // the grids at once, the treetops when they land (perf/slow-loading-2: the bake's other jobs no longer wait ≈ 3 s for them)
    for (const w of workers) primeWorker(w, { topsLater: true });
    tops.then((buf) => { keptTops.buf = buf; for (const w of workers) primeTops(w, buf); });
  } else await Promise.race([terrainFilesReady(), new Promise((r) => setTimeout(r, 20000))]);   // a desktop: the page's grids first, so its workers read them from the HTTP cache (perf/slow-loading)
  // the boat's models (1 MB as gzip twins) take the link the bake leaves idle (perf/slow-loading: ≈ 4.6 s on the phone's
  // Slow 4G between the treetops and the GPU's start); the loading screen asks again at 'gpu' (the same request, src/prefetch.js)
  const livePage = FLAGS.headless == null && FLAGS.noload == null;
  if (livePage) for (const u of Object.values(CURRENT_VESSEL.models ?? {})) prefetchBytes(u);
  // The next downloads, in their turn (perf/slow-loading-2): the bake's link is not idle (the workers' chunks,
  // the towns' data, the treetops), and these 2.5 MB fetched beside them held the GPU's start 8 s on the phone's Slow 4G.
  // So they wait: on a phone for the bake's own jobs (the moment the GPU starts), on a desktop for the start bubble's
  // scatter (its treetops, 3.3 MB, are the trees stage's).
  //   the atmosphere's blue noise (1 MB, a hashed asset with a year's cache): the first frame's shaders find it in the HTTP
  //     cache (src/core/stbn.js)
  //   a phone's two ground strips (0.47 MB of WebP; its tier never takes their KTX2 twins, src/quality/apply.js), which the
  //     world's 'shore' stage waits for
  //   the mode's chunks, together, not one round trip after another (src/preloadChunks.js)
  const nextDownloads = () => {
    fetch(STBN_URL).then((r) => r.arrayBuffer()).catch(() => {});
    if (terrainVariant() === 'phone') for (const g of Object.values(GROUND_TEXTURES)) prefetchBytes(g.url);
    import('./preloadChunks.js').then((m) => m.preloadModeChunks()).catch(() => {});
  };
  // (20 s: never a deadlock; a worker without them fetches)
  let next = 0;
  // a worker with nothing to do waits while jobs are still to come (the scatter bands, after the towns' masks)
  const idle = [];
  const wake = () => { while (idle.length && (next < jobs.length || !pending())) idle.shift()(); };   // all of them once nothing more is to come
  const pending = () => late.length > 0;
  const run = (w) => new Promise((resolve) => {
    const step = () => {
      let item = null;
      if (next < jobs.length) item = jobs[next++];
      else if (pending()) { idle.push(step); return; }
      else { resolve(); wake(); item = workers.indexOf(w) < BACKGROUND_WORKERS ? nextBackground() : null; if (!item) { finished(w); return; } }
      const [, job, args, onResult] = item;
      w.onmessage = ({ data }) => {
        if (data.error) { console.warn(`prebake: ${job} failed; computed in place`, data.error); if (job === 'towns') { jobs.push(...late); late.length = 0; wake(); } if (job === 'tiles') { for (const [key] of args.tiles) settleLater(key, undefined); if (item[0] === 1 && (firstLeft -= args.tiles.length) <= 0) firstSettle(true); } }
        else onResult(data.result);
        if (onResult && !item.counted) { item.counted = true; pageJob(job); }
        step();
      };
      const transfer = args.towns ? [args.towns.mask.data.buffer, args.towns.foot.buffer, ...(args.towns.fine ? [args.towns.fine.data.buffer] : [])] : [];
      w.postMessage({ id: next, job, args }, transfer);
    };
    w.onerror = (e) => { console.warn('prebake: a worker failed; the rest is computed in place', e.message); resolve(); finished(w); };
    step();
  });
  // a worker ends when nothing is left for it; past the timeout every one ends, and what never came is built elsewhere
  // (src/trees.js asks the stream's workers for a tile whose promise failed)
  const done = new Set();
  const finished = (w) => { if (done.has(w)) return; done.add(w); w.terminate(); if (done.size === workers.length) { failLater(); firstSettle(false); } };
  setTimeout(() => { for (const w of workers) finished(w); }, TIMEOUT_MS + 30000);
  const allRun = Promise.all(workers.map(run));
  // a live page: on once the page's own jobs are done (the start bubble's scatter keeps baking: startBubbleReady); a
  // capture waits for everything, as before
  const live = FLAGS.headless == null;
  if (livePage) (terrainVariant() === 'phone' ? pageDone : firstPromise).then(nextDownloads);
  await Promise.race([live ? pageDone : allRun, new Promise((r) => setTimeout(r, TIMEOUT_MS))]);
  if (!live) firstSettle(true);
  else setTimeout(() => firstSettle(false), TIMEOUT_MS + 30000);   // never a deadlock: past it the trees scatter what is missing
}

const flags = typeof location !== 'undefined' ? FLAGS : null;
// the demos (demos/*.html) import some of these modules with other inputs: no bake there
if (flags && typeof Worker !== 'undefined' && flags.prebake && !location.pathname.includes('/demos/')) {
  const end = span('prebake');
  try { await bake(flags); } catch (e) { console.warn('prebake: skipped', e); firstSettle(false); }
  end();
}
