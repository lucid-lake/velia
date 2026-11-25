// The birthplaces' check: each row of the waters file's `birthplaces` against the baked depth grid
// (v2/ui/planChart.bin: the bay level at 10 m, the lake level at 40 m; a row whose region declares its own level, e.g. South Lake's,
// against that level's desktop heights and shore distance, the ground the page starts it on: regionDepth): the depth under her (≥ 8 m), the clear water on
// every bearing (the nearest water under the keel's 2.6 m, every 30°, out to 600 m; the shore ≥ 150 m off), and the reach
// rule's 400 m land probe: never both tacks blocked in the day's winds (DAY_WINDS); other winds (?winddir=) are listed only. Prints one line a row; exit 1 on a failing row.
//   node tools/birthplace-check.mjs [--json]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { OUT } from './v2-plan-bake.mjs';
import { decodePlanGrid, gridTerrain } from '../v2/ui/planChart.js';
import { CURRENT_WATERS } from '../src/sim/waters/current.js';
import { listBirthplaces, birthPose, BIRTH } from '../v2/sim/birthplace.js';
import { dayWind } from '../src/sim/wind.js';
import { regionLevels, levelOfBirth } from '../v2/terrain/region.js';
import { inflate, unpredict, metres } from '../v2/terrain/decode.js';

// a region level's desktop grids as { depthAt, shoreAt } (inside its box; the baked grid outside it)
export async function regionDepth(level, base = bakedDepth(), terrainDir = new URL('../terrain/', import.meta.url)) {
  const M = JSON.parse(readFileSync(new URL(`${level.dir}/${level.full}`, terrainDir), 'utf8')), L = M.levels[0];
  const grid = async (f, w, h) => unpredict(await inflate(readFileSync(new URL(`${level.dir}/${f}`, terrainDir))), w, h);
  const H = await grid(L.height, L.w, L.h), D = await grid(L.distance, L.dw, L.dh), ds = L.step * L.dk;
  const bil = (g, w, h, x0, z0, step, x, z) => {
    const fx = (x - x0) / step, fz = (z - z0) / step;
    if (fx < 0 || fz < 0 || fx > w - 1 || fz > h - 1) return null;
    const i = Math.min(Math.floor(fx), w - 2), j = Math.min(Math.floor(fz), h - 2), u = fx - i, v = fz - j, k = j * w + i;
    return (g[k] * (1 - u) + g[k + 1] * u) * (1 - v) + (g[k + w] * (1 - u) + g[k + w + 1] * u) * v;
  };
  return {
    depthAt: (x, z) => { const q = bil(H, L.w, L.h, L.x0, L.z0, L.step, x, z); return q == null ? base.depthAt(x, z) : -metres(q, M.height); },
    shoreAt: (x, z) => { const q = bil(D, L.dw, L.dh, L.x0, L.z0, ds, x, z); return q == null ? base.shoreAt(x, z) : (q - 32768) * M.distance.step; },
  };
}
// every region level's depth provider, by region id (await once; checkRows takes it)
export async function regionDepths(waters = CURRENT_WATERS, base = bakedDepth()) {
  const out = {};
  for (const l of regionLevels(waters)) out[l.id] = await regionDepth(l, base);
  return out;
}

// the baked grid as one depthAt(x, z) in metres (positive: water; the bay level inside its box, else the lake's)
export function bakedDepth() {
  const g = decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(OUT))));
  const B = g.levels.bay, bay = gridTerrain(B), lake = gridTerrain(g.levels.lake);
  const inBay = (x, z) => x >= B.x0 && z >= B.z0 && x <= B.x0 + B.cell * (B.nx - 1) && z <= B.z0 + B.cell * (B.nz - 1);
  return {
    depthAt: (x, z) => -(inBay(x, z) ? bay : lake).heightAt(x, z),
    shoreAt: (x, z) => (inBay(x, z) ? bay : lake).shoreDistance(x, z),
  };
}

export const DAY_WINDS = [...Array.from({ length: 13 }, (_, i) => (345 + 5 * i) % 360), ...Array.from({ length: 13 }, (_, i) => 170 + 5 * i)];   // 345–45° and 170–230°, every 5° (the day's 15° and 195–200° with ± 30° of shift)
const ALL_WINDS = Array.from({ length: 24 }, (_, i) => i * 15);

export function checkRows(waters = CURRENT_WATERS, baked = bakedDepth(), regions = {}) {
  const out = [];
  for (const bp of listBirthplaces(waters, { all: true })) {
    const { depthAt, shoreAt } = regions[levelOfBirth(waters, bp.id)?.id] ?? baked;
    const depth = depthAt(bp.x, bp.z), shore = shoreAt(bp.x, bp.z), clear = [];
    for (let b = 0; b < 360; b += 30) {
      let d = 0;
      for (; d <= 600; d += 10) { const r = b * Math.PI / 180; if (depthAt(bp.x + Math.sin(r) * d, bp.z - Math.cos(r) * d) < BIRTH.keelM) break; }
      clear.push(d);
    }
    const hours = [7, 10, 13, 16, 19.5].map((hour) => {
      const W = dayWind(hour, { seed: 1 }).dirDeg, p = birthPose(bp, { windDeg: W, depthAt });
      return { hour, windDeg: +W.toFixed(0), heading: +p.headingDeg.toFixed(0), tack: p.tack, blocked: p.blocked, offWind: +p.offWindDeg.toFixed(0) };
    });
    // the day's winds (from ≈15° at night and in the morning, ≈200° in the afternoon, 195° in the evening: src/sim/wind.js dayWind)
    // with their shifts, ± 30°: no row may have both tacks blocked at any of them
    const sweep = DAY_WINDS.filter((W) => birthPose(bp, { windDeg: W, depthAt }).blocked);
    const any = ALL_WINDS.filter((W) => birthPose(bp, { windDeg: W, depthAt }).blocked);
    const fail = [];
    if (sweep.length) fail.push(`both tacks blocked in a day's wind from ${sweep.join(', ')}°`);
    if (depth < 8) fail.push(`depth ${depth.toFixed(1)} m < 8`);
    if (Math.min(...clear) < 150) fail.push(`shore ${Math.min(...clear)} m < 150 on a bearing`);
    for (const h of hours) if (h.blocked) fail.push(`both tacks blocked at ${h.hour} h`);
    out.push({ id: bp.id, ground: levelOfBirth(waters, bp.id)?.id ?? 'plan', x: bp.x, z: bp.z, depth: +depth.toFixed(1), shore: +shore.toFixed(0), minClear: Math.min(...clear), clear, hours, blockedAny: any, ok: !fail.length, fail });
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = checkRows(CURRENT_WATERS, bakedDepth(), await regionDepths());
  if (process.argv.includes('--json')) console.log(JSON.stringify(rows, null, 1));
  else for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.id.padEnd(12)} (${r.x}, ${r.z}) [${r.ground}] depth ${r.depth} m, clear ≥ ${r.minClear} m [${r.clear.join(' ')}]  ${r.hours.map((h) => `${h.hour}h W${h.windDeg}→${h.heading}${h.tack[0]}`).join(' ')}${r.blockedAny.length ? `  (any wind: blocked from ${r.blockedAny.join(', ')}°)` : ''}${r.fail.length ? '  ' + r.fail.join('; ') : ''}`);
  process.exit(rows.every((r) => r.ok) ? 0 : 1);
}
