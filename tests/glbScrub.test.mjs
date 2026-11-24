// The GLB scrub (tools/build/scrub.mjs § 7) and the generator patch (tools/glb-set-generator.mjs): a GLB's JSON chunk
// is shipped text, so no internal word may sit in it (2026-11-15: v1's paddler figures carried "lakeshore …py").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { glbJson, glbHits } from '../tools/build/scrub.mjs';
import { setGenerator } from '../tools/glb-set-generator.mjs';

const glb = (json, bin = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])) => {
  let js = Buffer.from(JSON.stringify(json));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const h = Buffer.alloc(20), bh = Buffer.alloc(8);
  h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(28 + js.length + bin.length, 8);
  h.writeUInt32LE(js.length, 12); h.writeUInt32LE(0x4e4f534a, 16);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, js, bh, bin]);
};

test('every committed model GLB is free of scrub words', () => {
  assert.deepEqual(glbHits(fileURLToPath(new URL('../models', import.meta.url))), []);
});

test('glbJson reads the JSON chunk of a .glb and a gzipped .glb', () => {
  const g = glb({ asset: { version: '2.0', generator: 'Lakeshore x.py' } });
  assert.match(glbJson(g), /Lakeshore x\.py/);
  assert.equal(glbJson(gzipSync(g)), glbJson(g));
  assert.equal(glbJson(Buffer.from('not a glb at all, just text')), null);
});

test('setGenerator changes only the generator, keeps the BIN chunk and is idempotent', () => {
  const src = glb({ asset: { version: '2.0', generator: 'lakeshore paddler-strip-glb.py', copyright: 'CC0' }, nodes: [{ name: 'a' }] });
  const out = setGenerator(src, 'Velia');
  const j = JSON.parse(glbJson(out));
  assert.deepEqual(j, { asset: { version: '2.0', generator: 'Velia', copyright: 'CC0' }, nodes: [{ name: 'a' }] });
  assert.equal(out.readUInt32LE(8), out.length);
  assert.equal(out.readUInt32LE(12) % 4, 0);
  assert.ok(out.subarray(20 + out.readUInt32LE(12)).equals(src.subarray(20 + src.readUInt32LE(12))));
  assert.ok(setGenerator(out, 'Velia').equals(out));
});
