// v2's own ground for node tests (refactor round 3, C7a): what the page holds once the terrain has streamed, read from
// the repo's terrain/ files with v2's own decoder, so v2's tests no longer import v1's loader (src/sim/terrain.js,
// src/sim/terrain-data.js).
//   ground(variant)  v2/terrain/decode.js → v2/terrain/sample.js createHeightField with every grid of the set in (the
//                    stream plan's order: phone, then full); its heights are v1's heightAt to 1e-6 m (terrain-data.test.mjs)
//   lake             v2/sim/lake.js lakeTerrain over that field and the shore grids (SHORE_LEVELS: the island, the bay, and
//                    the lake-wide basin and lake): the lake object the page's living lake and Cruise read (heightAt,
//                    shoreDistance, lake, places, landmarks, climate …). Its shoreDistance is v1's on the whole lake (but
//                    where v1's basin grid reads too far, v2/sim/lake.js SHORE_REPAIR); its coverAt has no cover grid (the
//                    elevation rules alone), as on the page.
// The v1-shaped names below (makeTerrain, heightAt, TAHOE, LANDMARKS …) are this lake's, so a test swaps its import line.
import { readFileSync } from 'node:fs';
import { inflate, unpredict } from '../../terrain/decode.js';
import { streamPlan, SLOTS } from '../../terrain/levels.js';
import { createHeightField } from '../../terrain/sample.js';
import { shoreSampler, lakeTerrain, shoreGrid, SHORE_LEVELS } from '../../sim/lake.js';

const T = (f) => new URL(`../../../terrain/${f}`, import.meta.url);
export const manifests = { full: JSON.parse(readFileSync(T('tahoe.json'), 'utf8')), phone: JSON.parse(readFileSync(T('tahoe-phone.json'), 'utf8')) };
export const decodeGrid = async (g) => { const p = await inflate(readFileSync(T(g.file))); return g.kind === 'h' ? unpredict(p, g.w, g.h) : p.slice(0, g.w * g.h); };

const memo = new Map();
// the height field with every grid of `variant` in; levels: the grid in each slot ({ name, x0, z0, step, w, h, H }), finest first
export function ground(variant = 'full') {
  if (!memo.has(variant)) memo.set(variant, (async () => {
    const { full, phone } = manifests;
    const field = createHeightField(full.height);
    const inSlot = new Map();
    for (const g of streamPlan(full, phone, variant).flat().filter((q) => q.kind === 'h')) {
      const H = await decodeGrid(g);
      field.setSlot(SLOTS.indexOf(g.slot), g, H);
      inSlot.set(g.slot, { name: g.slot, x0: g.x0, z0: g.z0, step: g.step, w: g.w, h: g.h, H });
    }
    const levels = SLOTS.filter((s) => inSlot.has(s)).map((s) => inSlot.get(s));
    return { field, levels, height: (x, z) => field.height(x, z), spacing: (x, z) => field.spacing(x, z) };
  })());
  return memo.get(variant);
}

// the shore-distance grids (SHORE_LEVELS, finest first), as v2/sim/lake.js loadShore decodes them
export const shoreLevels = () => Promise.all(manifests.full.levels.filter((L) => SHORE_LEVELS.includes(L.name)).map(shoreGrid)
  .map(async (g) => ({ ...g, D: unpredict(await inflate(readFileSync(T(g.file))), g.dw, g.dh) })));

const G = await ground('full');
export const lake = lakeTerrain({ height: G.height, distance: shoreSampler(await shoreLevels()).distance });
export const makeTerrain = () => lake;
export const TAHOE = lake.climate, LANDMARKS = lake.landmarks;
export const { heightAt, shoreDistance, waterfall } = lake;
