// The phone terrain (fix/ios-start-2): the same Tahoe grids with each height level averaged down (the bay and the basin
// 2x, the lake and the ring 4x; the island as it is), re-encoded the way build_tahoe.py writes them (2-D predicted,
// hi-byte plane then lo-byte plane, gzip). The distance and cover grids are shared with the full set; the manifest
// says where each one sits (dx0/dz0/dstep, cx0/cz0/cstep), since a halved height grid no longer gives their spacing.
//   node tools/terrain/phone_terrain.mjs        -> terrain/tahoe-phone.json + terrain/<level>-h<k>.lsh
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const T = resolve(dirname(fileURLToPath(import.meta.url)), '../../terrain');
export const PHONE_FACTOR = { island: 1, bay: 2, basin: 2, lake: 4, ring: 4 };

function unpredict(p, w, h) {
  const n = w * h, q = new Uint16Array(n);
  for (let j = 0, k = 0; j < h; j++) for (let i = 0; i < w; i++, k++) {
    const r = (p[k] << 8) | p[n + k], left = i ? q[k - 1] : 0, up = j ? q[k - w] : 0, ul = i && j ? q[k - w - 1] : 0;
    q[k] = (r + (j && i ? left + up - ul : j ? up : left)) & 0xffff;
  }
  return q;
}
export function predict(q, w, h) {
  const n = w * h, p = new Uint8Array(2 * n);
  for (let j = 0, k = 0; j < h; j++) for (let i = 0; i < w; i++, k++) {
    const left = i ? q[k - 1] : 0, up = j ? q[k - w] : 0, ul = i && j ? q[k - w - 1] : 0;
    const r = (q[k] - (j && i ? left + up - ul : j ? up : left)) & 0xffff;
    p[k] = r >> 8; p[n + k] = r & 255;
  }
  return p;
}
// the mean of each f x f block (texel centres: the block's centre)
export function downsample(q, w, h, f) {
  const W = Math.floor(w / f), H = Math.floor(h / f), o = new Uint16Array(W * H);
  for (let J = 0; J < H; J++) for (let I = 0; I < W; I++) {
    let s = 0; for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) s += q[(J * f + j) * w + I * f + i];
    o[J * W + I] = Math.round(s / (f * f));
  }
  return { q: o, w: W, h: H };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const M = JSON.parse(readFileSync(resolve(T, 'tahoe.json'), 'utf8'));
  const out = { ...M, variant: 'phone', levels: [] };
  let before = 0, after = 0;
  for (const L of M.levels) {
    const f = PHONE_FACTOR[L.name] ?? 1;
    const src = readFileSync(resolve(T, L.height)); before += src.length;
    const P = { ...L, dx0: L.x0, dz0: L.z0, dstep: L.step * L.dk, ...(L.cover ? { cx0: L.x0, cz0: L.z0, cstep: L.step * L.ck } : {}) };
    if (f > 1) {
      const q = unpredict(gunzipSync(src), L.w, L.h), d = downsample(q, L.w, L.h, f);
      const name = L.height.replace(/\.lsh$/, `${f}.lsh`), bytes = gzipSync(predict(d.q, d.w, d.h), { level: 9 });
      writeFileSync(resolve(T, name), bytes); after += bytes.length;
      Object.assign(P, { height: name, step: L.step * f, x0: L.x0 + L.step * (f - 1) / 2, z0: L.z0 + L.step * (f - 1) / 2, w: d.w, h: d.h });
      console.log(`${L.name}: ${L.w}x${L.h} @${L.step} m -> ${d.w}x${d.h} @${P.step} m, ${(src.length / 1e6).toFixed(2)} -> ${(bytes.length / 1e6).toFixed(2)} MB`);
    } else after += src.length;
    out.levels.push(P);
  }
  writeFileSync(resolve(T, 'tahoe-phone.json'), JSON.stringify(out, null, 1) + '\n');
  const shared = M.levels.reduce((s, L) => s + statSync(resolve(T, L.distance)).size + (L.cover ? statSync(resolve(T, L.cover)).size : 0), 0);
  console.log(`heights ${(before / 1e6).toFixed(2)} -> ${(after / 1e6).toFixed(2)} MB; with the shared distance and cover grids ${((before + shared) / 1e6).toFixed(2)} -> ${((after + shared) / 1e6).toFixed(2)} MB`);
}
