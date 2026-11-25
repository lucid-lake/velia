// Carves Emerald Bay's entrance channel (v2/terrain/channel.js CHANNEL) into the full height grids: each texel's bed becomes the
// deeper of the survey and the trough (idempotent: a second run changes nothing). The bay's 2 m grid and the basin's 10 m grid; the
// lake (32 m) and the ring (96 m) are coarser than the trough and keep the survey (the bay's grid covers the mouth at every stage of
// the stream). Run after tools/terrain/build_tahoe.py, then tools/terrain/phone_terrain.mjs (the phone set from these), then the
// bakes that read the terrain (tools/v2-plan-bake.mjs and the others' --check).
//   node tools/terrain/carve_channel.mjs            write terrain/bay-h.lsh, terrain/basin-h.lsh and the manifest's byte count
//   node tools/terrain/carve_channel.mjs --check    exit 1 if a grid is not carved
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { predict } from './phone_terrain.mjs';
import { CHANNEL, channelBed } from '../../v2/terrain/channel.js';

const T = resolve(dirname(fileURLToPath(import.meta.url)), '../../terrain');
export const CARVED = ['bay', 'basin'];

function unpredict(p, w, h) {
  const n = w * h, q = new Uint16Array(n);
  for (let j = 0, k = 0; j < h; j++) for (let i = 0; i < w; i++, k++) {
    const r = (p[k] << 8) | p[n + k], left = i ? q[k - 1] : 0, up = j ? q[k - w] : 0, ul = i && j ? q[k - w - 1] : 0;
    q[k] = (r + (j && i ? left + up - ul : j ? up : left)) & 0xffff;
  }
  return q;
}

// carve one grid in place; → the texels deepened
export function carve(q, L, H, C = CHANNEL) {
  const reach = C.coreHalfM + C.sideM;
  let xs = Infinity, xe = -Infinity, zs = Infinity, ze = -Infinity;
  for (const [x, z] of C.pts) { xs = Math.min(xs, x); xe = Math.max(xe, x); zs = Math.min(zs, z); ze = Math.max(ze, z); }
  const i0 = Math.max(0, Math.floor((xs - reach - L.x0) / L.step)), i1 = Math.min(L.w - 1, Math.ceil((xe + reach - L.x0) / L.step));
  const j0 = Math.max(0, Math.floor((zs - reach - L.z0) / L.step)), j1 = Math.min(L.h - 1, Math.ceil((ze + reach - L.z0) / L.step));
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const y = channelBed(L.x0 + i * L.step, L.z0 + j * L.step, C);
    if (y == null) continue;
    const code = Math.max(0, Math.round((y - H.offset) / H.step)), k = j * L.w + i;
    if (code < q[k]) { q[k] = code; n++; }
  }
  return n;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const M = JSON.parse(readFileSync(resolve(T, 'tahoe.json'), 'utf8')), check = process.argv.includes('--check');
  let stale = 0;
  for (const L of M.levels.filter((l) => CARVED.includes(l.name))) {
    const f = resolve(T, L.height), q = unpredict(gunzipSync(readFileSync(f)), L.w, L.h), n = carve(q, L, M.height);
    if (check) { if (n) { console.error(`${L.height}: ${n} texels not carved`); stale++; } continue; }
    if (!n) { console.log(`${L.height}: already carved`); continue; }
    const bytes = gzipSync(predict(q, L.w, L.h), { level: 9 });
    writeFileSync(f, bytes);
    console.log(`${L.height}: ${n} texels deepened, ${bytes.length} bytes`);
  }
  if (check) { if (stale) process.exit(1); console.log('the channel is carved'); }
  else {   // the manifest's byte count (build_tahoe.py's: every file it lists)
    const files = new Set(); for (const L of M.levels) for (const k of ['height', 'distance', 'cover']) if (L[k]) files.add(L[k]);
    const total = [...files].reduce((s, n) => s + statSync(resolve(T, n)).size, 0), mf = resolve(T, 'tahoe.json');
    writeFileSync(mf, readFileSync(mf, 'utf8').replace(/"bytes": \d+/, `"bytes": ${total}`));   // the rest of the file as build_tahoe.py wrote it
  }
}
