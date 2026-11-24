// Ultra M2 (texture room): the bay's height codes reach the terrain's fragment stage as a storage buffer, a GPU copy of the
// slot's r16uint texture (copyTextureToBuffer: rows padded to 256 bytes, two little-endian codes a u32 word), read by
// bedCode (render/terrain.js BED_HEIGHT_WGSL; its JS twin bedCodeAt). The copy must read back every code identically, for
// both bay grids (the full set's 2816 × 1792 at 2 m, the phone set's 1408 × 896 at 4 m) and any width (odd, under a row's
// 256 bytes). The GPU's own proof, every texel of the live buffer against the texture, is v2/tests/pages/bedPack.page.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bedPackLayout, bedCodeAt } from '../render/terrain.js';

// what copyTextureToBuffer writes for a w × h r16uint texture: each row's codes, little-endian, at row × bytesPerRow
function packAsCopy(codes, w, h) {
  const { bytesPerRow, bytes } = bedPackLayout(w, h);
  const buf = new ArrayBuffer(bytes), dv = new DataView(buf);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dv.setUint16(j * bytesPerRow + i * 2, codes[j * w + i], true);
  return new Uint32Array(buf);
}
const lcg = (s) => () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s; };

test('the layout: rows padded to WebGPU\'s 256 bytes; the bay grids need no padding (their rows are 22 and 11 × 256 bytes)', () => {
  for (const [w, h] of [[2816, 1792], [1408, 896]]) {
    const L = bedPackLayout(w, h);
    assert.equal(L.bytesPerRow % 256, 0);
    assert.equal(L.bytesPerRow, w * 2, `${w}: no padding`);
    assert.equal(L.bytes, w * 2 * h);
  }
  assert.equal(bedPackLayout(7, 3).bytesPerRow, 256);
  assert.equal(bedPackLayout(129, 1).bytesPerRow, 512);
});

test('every code reads back identically from the packed words (both bay grids, odd and padded widths)', () => {
  const rnd = lcg(7);
  for (const [w, h] of [[2816, 40], [1408, 40], [1001, 9], [7, 5], [129, 4]]) {
    const codes = new Uint16Array(w * h);
    for (let k = 0; k < codes.length; k++) codes[k] = rnd() & 0xffff;
    codes[0] = 0; codes[1] = 0xffff; codes[codes.length - 1] = 0x8001;   // the ends of the range, the last texel
    const words = packAsCopy(codes, w, h);
    let bad = 0;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (bedCodeAt(words, i, j, w) !== codes[j * w + i]) bad++;
    assert.equal(bad, 0, `${w} × ${h}: ${bad} codes differ`);
  }
});

test('the real bay grids (bay-h2.lsh at 2 m, bay-h.lsh at 4 m) pack and read back identically, every texel', async () => {
  const { inflate, unpredict } = await import('../terrain/decode.js');
  for (const file of ['tahoe.json', 'tahoe-phone.json']) {
    const man = JSON.parse(readFileSync(new URL(`../../terrain/${file}`, import.meta.url), 'utf8'));
    const L = man.levels.find((l) => l.name === 'bay');
    const codes = unpredict(await inflate(readFileSync(new URL(`../../terrain/${L.height}`, import.meta.url))), L.w, L.h);
    const words = packAsCopy(codes, L.w, L.h);
    let bad = 0;
    for (let j = 0; j < L.h; j++) for (let i = 0; i < L.w; i++) if (bedCodeAt(words, i, j, L.w) !== codes[j * L.w + i]) bad++;
    assert.equal(bad, 0, `${L.height}: ${bad} of ${L.w * L.h} codes differ`);
  }
});
