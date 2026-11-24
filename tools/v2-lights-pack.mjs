// M5e (the night): v1's town lights and the star catalogue packed for v2, streamed after the first frame.
//   node tools/v2-lights-pack.mjs [--check]
// Lights: v1's own layout (src/towns-layout.js buildTownsLayout on the full terrain set and the shared projection: the
// windows, street lights, lots and pier heads with their colours, sizes and switch-on sun elevations) → v2/assets/night/
// lights.bin: a 16-byte header ('VLT1', count, 0, 0) then 12 bytes a light: x, z (int16, m), y (int16, 0.25 m),
// r, g, b (uint8, ×255), size (uint8, 0.1 m), on (int8, 0.5°). Deterministic (v1's hashes of indices): the data test
// demands the shipped bytes.
// Stars: @takram/three-atmosphere's stars.bin (MIT; the Yale Bright Star Catalog v5's 9,096 stars as J2000 directions,
// magnitudes and black-body colours, 10 bytes a star: int16 × 3 position, uint8 magnitude, uint8 × 3 colour) copied as
// it is to v2/assets/night/stars.bin (v1 draws the same file through the library's StarsNode). ATTRIBUTION.md lists both.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'v2/assets/night');
const check = process.argv.includes('--check');

export const LIGHT_BYTES = 12, HEADER_BYTES = 16, MAGIC = 'VLT1';

// the layout → the packed bytes (pure; the test packs a small layout and decodes it with v2/sim/lights.js)
export function packLights(lights) {
  const n = lights.count, buf = new ArrayBuffer(HEADER_BYTES + n * LIGHT_BYTES), dv = new DataView(buf), u8 = new Uint8Array(buf);
  for (let i = 0; i < 4; i++) u8[i] = MAGIC.charCodeAt(i);
  dv.setUint32(4, n, true);
  const q = (v, s, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v / s)));
  for (let i = 0; i < n; i++) {
    const o = HEADER_BYTES + i * LIGHT_BYTES, d = lights.data, k = i * 8;
    dv.setInt16(o, q(d[k], 1, -32768, 32767), true);
    dv.setInt16(o + 2, q(d[k + 2], 1, -32768, 32767), true);
    dv.setInt16(o + 4, q(d[k + 1], 0.25, -32768, 32767), true);
    u8[o + 6] = q(d[k + 3], 1 / 255, 0, 255); u8[o + 7] = q(d[k + 4], 1 / 255, 0, 255); u8[o + 8] = q(d[k + 5], 1 / 255, 0, 255);
    u8[o + 9] = q(d[k + 6], 0.1, 0, 255);
    dv.setInt8(o + 10, q(d[k + 7], 0.5, -128, 127));
    u8[o + 11] = 0;
  }
  return new Uint8Array(buf);
}

async function main() {
  const { loadTerrain, makeSampler } = await import('../src/sim/terrain-data.js');
  const { makeGeo } = await import('../src/sim/geo.js');
  const { loadTownsData, buildTownsLayout } = await import('../classic/src/towns-layout.js');
  const { CURRENT_WATERS } = await import('../src/sim/waters/current.js');
  const S = makeSampler(await loadTerrain('full'));
  const L = buildTownsLayout(await loadTownsData(), { heightAt: S.height, lonLatToWorld: makeGeo(CURRENT_WATERS).lonLatToWorld });
  const lights = packLights(L.lights);
  const stars = readFileSync(resolve(ROOT, 'node_modules/@takram/three-atmosphere/assets/stars.bin'));
  mkdirSync(OUT, { recursive: true });
  const files = { 'lights.bin': lights, 'stars.bin': new Uint8Array(stars) };
  let bad = 0;
  for (const [name, bytes] of Object.entries(files)) {
    const p = resolve(OUT, name);
    if (check) {
      const same = existsSync(p) && Buffer.compare(readFileSync(p), Buffer.from(bytes)) === 0;
      console.log(`${name}: ${bytes.length} B ${same ? 'matches' : 'DIFFERS'}`); if (!same) bad++;
    } else { writeFileSync(p, bytes); console.log(`${p}: ${bytes.length} B`); }
  }
  console.log(`lights ${L.lights.count}, stars ${stars.length / 10}`);
  if (bad) process.exit(1);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
