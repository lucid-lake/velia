// The load-time bake's worker (src/prebake.js): runs one job of the heavy CPU grids and posts the typed arrays back.
// The same functions the page would run, on the same inputs: the numbers are the same.
// terrain.js loads the real grids with a top-level await: imported lazily, so the message handler below is set before
// the first message arrives (a static import would hold the module, and the messages posted meanwhile would be lost)
import { acceptFiles } from '../../src/sim/terrain-data.js';
import { scatterTrees, RIM_RULES } from './trees-scatter.js';
import { shoreDistanceMap, depthMap } from '../../src/sim/water-spectrum.js';
import { shapeValues, detailValues, weatherBytes } from './clouds-noise.js';
import { chunkHeights } from './terrain-lod.js';
import { horizonMap } from './forest/horizon.js';
import { loadTops, setTops } from './forest/treetops.js';

let makeTerrain = null;
// the towns (art/towns): one job builds the masks once ('towns', src/prebake.js); the scatter bands get their crop of
// them (maskBundle) and make the queries here
let townsLib = null;
const townsLibrary = async () => (townsLib ??= await Promise.all([import('./towns-layout.js'), import('../../src/sim/geo.js')]));
const terrains = new Map();
const terrainOf = (seed) => { if (!terrains.has(seed)) terrains.set(seed, makeTerrain({ seed })); return terrains.get(seed); };
const NEEDS_TERRAIN = new Set(['towns', 'scatter', 'rim', 'tiles', 'shore', 'depth', 'lod', 'windtex']);
// the wind's terrain caches for the water's wind texture (src/wind.js textureCache; world streaming): one field per
// worker, on the real terrain (its terrain parts depend on nothing else)
let windField = null, WindFieldCls = null;

const JOBS = {
  scatter: ({ seed, treeSeed, rows, towns }) => { const r = scatterTrees(terrainOf(seed), { seed: treeSeed, rows, towns: towns && townsLib[0].makeQueries(towns) }); return [r, Object.values(r).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer)]; },
  rim: ({ seed, treeSeed, rows, towns }) => { const r = scatterTrees(terrainOf(seed), { seed: treeSeed, rules: RIM_RULES, rows, towns: towns && townsLib[0].makeQueries(towns) }); return [r, Object.values(r).filter((v) => ArrayBuffer.isView(v)).map((v) => v.buffer)]; },
  // the forest's scatter by tile (src/forest/scatter-tiles.js): one row band of a pass, some of its tiles
  tiles: ({ seed, treeSeed, group, rows, tiles, towns }) => {
    const q = towns && townsLib[0].makeQueries(towns), rules = group === 'rim' ? RIM_RULES : undefined, out = [], transfer = [];
    for (const [key, ia, ib] of tiles) {
      const r = scatterTrees(terrainOf(seed), { seed: treeSeed, rules, rows, cols: [ia, ib], towns: q });
      out.push([key, r]); for (const v of Object.values(r)) if (ArrayBuffer.isView(v)) transfer.push(v.buffer);
    }
    return [out, transfer];
  },
  horizon: ({ seed, rows }) => { const r = horizonMap(terrainOf(seed).heightAt, { rows }); return [r, [r.buffer]]; },
  shore: ({ seed, opts }) => { const r = shoreDistanceMap(terrainOf(seed).shoreDistance, opts); return [r, [r.buffer]]; },
  depth: ({ seed, opts }) => { const r = depthMap(terrainOf(seed).heightAt, opts); return [r, [r.buffer]]; },
  shape: ({ seed, size, z0, z1 }) => { const r = shapeValues(seed, size, z0, z1); return [r, [r.buffer]]; },
  detail: ({ seed, size }) => { const r = detailValues(seed, size); return [r, [r.buffer]]; },
  weather: ({ seed }) => { const r = weatherBytes(seed); return [r, [r.buffer]]; },
  windtex: ({ seed, sizePx, extentM, cx, cz, bins }) => {
    if (!windField) { windField = new WindFieldCls({ seed, cache: /^phone/.test(self.name ?? '') ? { f32: true } : null }); windField.setTerrain(terrainOf(seed).heightAt); }   // a phone's page keeps its bins in Float32: so do its workers
    const c = windField.textureCache(sizePx, extentM, cx, cz, bins);
    return [c, [c.px.buffer, c.pz.buffer, c.rough.buffer, ...c.bins.map(([, a]) => a.buffer)]];
  },
  lod: ({ seed, chunks }) => {
    const t = terrainOf(seed), out = chunks.map(([x0, z0, size]) => chunkHeights(t.heightAt, x0, z0, size));
    return [out, out.map((a) => a.buffer)];
  },
};

self.onmessage = async ({ data }) => {
  if (acceptFiles(data)) return;   // a phone's page posts its grid bytes first (src/terrain-data.js primeWorker)
  const { id, job, args } = data;
  try {
    if (NEEDS_TERRAIN.has(job) && !makeTerrain) ({ makeTerrain } = await import('../../src/sim/terrain.js'));
    if (job === 'towns' || ((job === 'scatter' || job === 'rim' || job === 'tiles') && args.towns)) await townsLibrary();
    if (job === 'towns') {   // the whole masks, once: transferred to the page, which crops them for the scatter bands
      const [{ loadTownsData, buildTownsLayout }, { lonLatToWorld }] = townsLib;
      // args.full: the whole layout too (src/towns.js takes it: the page does not lay the towns out again)
      const L = buildTownsLayout(await loadTownsData(), { heightAt: terrainOf(args.seed).heightAt, lonLatToWorld, masksOnly: !args.full });
      const pick = (r) => ({ x0: r.x0, z0: r.z0, cell: r.cell, w: r.w, h: r.h, channels: r.channels, data: r.data });
      const result = { mask: pick(L.mask), fine: pick(L.fine), foot: L.foot };
      const transfer = [result.mask.data.buffer, result.fine.data.buffer, result.foot.buffer];
      if (args.full) {
        result.layout = { buildings: L.buildings, clusters: L.clusters, lights: L.lights, osmPiers: L.osmPiers, lifts: L.lifts, piers: L.piers, stats: L.stats };
        for (const k of ['buildings', 'lights', 'lifts', 'piers']) transfer.push(L[k].data.buffer);
        for (const c of L.clusters) transfer.push(c.sizes.buffer);
      }
      self.postMessage({ id, result }, transfer);
      return;
    }
    if (job === 'scatter' || job === 'tiles') setTops(args.lidar === false ? null : await loadTops());   // the lidar's crowns (src/forest/treetops.js); args.lidar false: the rules everywhere
    if (job === 'windtex' && !WindFieldCls) { const m = await import('../../src/sim/wind.js'); WindFieldCls = m.WindField; }
    const [result, transfer] = JOBS[job](args);
    self.postMessage({ id, result }, transfer);
  } catch (e) {
    self.postMessage({ id, error: String(e?.stack ?? e) });
  }
};
