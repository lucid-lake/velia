// The planner's chart grid for v2 over the whole lake (feat(v2): the passage plan; the whole-lake chart): what v1's planner
// (src/sail/passagePlan.js createPlanner) and Cruise's navigator read from v1's terrain, which v2 does not load. Two levels, both
// v1's own terrain (src/sim/terrain.js: terrain.shoreDistance and terrain.heightAt) sampled once at each node:
//   bay   v1's navigator chart's own nodes (src/sim/modes/chill/navigator.js buildChart's default region: the bay and the open water
//         off its mouth, 10 m, 301 × 381), float32, as before, so v2 builds the bay's chart with buildChart as it is
//   lake  the whole lake (v2/ui/planChart.js LAKE: x −5800…15400, z −33000…3200, 40 m, 531 × 906): int16 in LAKE's steps
//         (the shore 0.1 m, the depth 0.05 m, clamped to LAKE.depthHi; −1 on land)
//   shore  −shoreDistance (+ in the water), clamped to [SHORE.lo, SHORE.hi]: past them no chart function a plan reads changes (the
//          margins saturate: fixedAt ≤ reach − obj = 98 m, so the shore counts to 183 m, comfort to 170 m; on land only the sign is
//          read). v2/tests/plan.test.mjs proves the bay's A* grid, margins and plans are v1's.
//   depth  −heightAt where the node is water (as buildChart: −1 on land); the bay's exact, the lake's clamped (fixedAt saturates
//          by 18.3 m, comfort by 10 m)
// File: gzip of [u32 header length][header JSON, space-padded to 4 bytes][per level: shore planes, depth planes] (the byte planes
// of each value: 4 for f32, 2 for i16).
//   node tools/v2-plan-bake.mjs            write v2/ui/planChart.bin
//   node tools/v2-plan-bake.mjs --check    exit 1 if the committed file's grid differs from a fresh bake
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodePlanGrid, SHORE, LAKE } from '../v2/ui/planChart.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(ROOT, 'v2/ui/planChart.bin');
const SEED = 1;   // v1's world seed (src/core/params.js SEED, the default)

// v1's terrain sampled at buildChart's own nodes (its default region, read from a chart it builds) and at the lake's
export async function bakePlanGrid() {
  const { makeTerrain } = await import('../src/sim/terrain.js');
  const { buildChart } = await import('../src/sim/modes/chill/navigator.js');
  const T = makeTerrain({ seed: SEED });
  const probe = buildChart({ shoreDistance: () => 1, heightAt: () => 0 }), { x0, z0, cell } = probe.region, { nx, nz } = probe;
  const level = (name, x0, z0, cell, nx, nz, enc) => {
    const shore = new Float32Array(nx * nz), depth = new Float32Array(nx * nz);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const x = x0 + i * cell, z = z0 + j * cell, k = j * nx + i;   // buildChart's own arithmetic, so the same points
      const d = T.shoreDistance(x, z);
      shore[k] = Math.min(SHORE.hi, Math.max(SHORE.lo, -d));
      depth[k] = d < 0 ? -T.heightAt(x, z) : -1;
      if (enc === 'i16') {   // the stored steps, so a fresh bake compares with the decoded file
        shore[k] = Math.round(shore[k] / LAKE.shoreQ) * LAKE.shoreQ;
        depth[k] = depth[k] < 0 ? -1 : Math.round(Math.min(LAKE.depthHi, depth[k]) / LAKE.depthQ) * LAKE.depthQ;
      }
    }
    return { name, x0, z0, cell, nx, nz, enc, ...(enc === 'i16' ? { shoreQ: LAKE.shoreQ, depthQ: LAKE.depthQ, depthHi: LAKE.depthHi } : {}), shore, depth };
  };
  const L = LAKE, lnx = Math.round((L.x1 - L.x0) / L.cell) + 1, lnz = Math.round((L.z1 - L.z0) / L.cell) + 1;
  return { v: 2, seed: SEED, shoreLo: SHORE.lo, shoreHi: SHORE.hi,
    levels: { bay: level('bay', x0, z0, cell, nx, nz, 'f32'), lake: level('lake', L.x0, L.z0, L.cell, lnx, lnz, 'i16') } };
}

const planes = (b, n, k) => { const o = new Uint8Array(b.length); for (let i = 0; i < n; i++) for (let c = 0; c < k; c++) o[c * n + i] = b[i * k + c]; return o; };
const bytesOf = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export function encodePlanGrid(g) {
  const lv = Object.values(g.levels);
  let head = JSON.stringify({ v: g.v, seed: g.seed, shoreLo: g.shoreLo, shoreHi: g.shoreHi,
    levels: lv.map(({ shore, depth, ...L }) => L) });
  head += ' '.repeat((4 - (head.length % 4)) % 4);
  const hb = new TextEncoder().encode(head), len = new Uint8Array(new Uint32Array([hb.length]).buffer);
  const parts = [len, hb];
  for (const L of lv) {
    const n = L.nx * L.nz;
    if (L.enc === 'f32') { parts.push(planes(bytesOf(L.shore), n, 4), planes(bytesOf(L.depth), n, 4)); continue; }
    const s = new Int16Array(n), d = new Int16Array(n);
    for (let i = 0; i < n; i++) { s[i] = Math.round(L.shore[i] / L.shoreQ); d[i] = L.depth[i] < 0 ? -1 : Math.round(L.depth[i] / L.depthQ); }
    parts.push(planes(bytesOf(s), n, 2), planes(bytesOf(d), n, 2));
  }
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

const sameF = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-6);
const sameL = (a, b) => a.nx === b.nx && a.nz === b.nz && a.x0 === b.x0 && a.z0 === b.z0 && a.cell === b.cell && sameF(a.shore, b.shore) && sameF(a.depth, b.depth);
const same = (a, b) => ['bay', 'lake'].every((k) => a.levels[k] && b.levels[k] && sameL(a.levels[k], b.levels[k]));

// the committed file's grid equals a fresh bake (compared decoded: another zlib may pack the same bytes differently)
export async function planBakeCurrent() {
  let raw; try { raw = readFileSync(OUT); } catch { return false; }
  const { gunzipSync } = await import('node:zlib');
  return same(decodePlanGrid(new Uint8Array(gunzipSync(raw))), await bakePlanGrid());
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    if (!(await planBakeCurrent())) { console.error('v2/ui/planChart.bin is stale: run node tools/v2-plan-bake.mjs'); process.exit(1); }
    console.log('v2/ui/planChart.bin is current');
  } else {
    const g = await bakePlanGrid(), bytes = encodePlanGrid(g);
    writeFileSync(OUT, bytes);
    const line = (L) => { let water = 0; for (const v of L.depth) if (v >= 0) water++; return `${L.name} ${L.nx} × ${L.nz} nodes every ${L.cell} m (${water} water)`; };
    console.log(`wrote v2/ui/planChart.bin: ${bytes.length} bytes; ${Object.values(g.levels).map(line).join('; ')}`);
  }
}
