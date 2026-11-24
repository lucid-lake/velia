// M3b: v2's own GLB reader (engine/gltf.js) on a tiny fixture built here, and the packer (tools/build/glb-pack.mjs) on it:
// the container, accessors (float, normalized int8/int16/uint8, strided), node transforms down the tree, materials with
// their defaults and extensions, the image bytes, the gzip sniffing, and the quantized copy's round trip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { parseGlb, readAccessor, sceneNodes, meshPrimitives, materialOf, imageBytes, gunzipMaybe, trsMatrix, mul4 } from '../engine/gltf.js';
import { packGlb } from '../../tools/build/glb-pack.mjs';

// a GLB from a JSON and binary chunks (each chunk padded to 4 bytes)
export function makeGlb(json, bin) {
  let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const b = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
  const h = Buffer.alloc(12); h.writeUInt32LE(0x46546c67, 0); h.writeUInt32LE(2, 4); h.writeUInt32LE(12 + 8 + js.length + 8 + b.length, 8);
  const jh = Buffer.alloc(8); jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  const bh = Buffer.alloc(8); bh.writeUInt32LE(b.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([h, jh, js, bh, b]);
}

// two triangles (a quad 2 m × 1 m) under a parent moved and turned, a strided int16 normal, an RGBA8 colour, a fake image
function fixture() {
  const pos = new Float32Array([0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]);
  const nrm = new Int16Array([0, 0, 32767, 0, 0, 0, 32767, 0, 0, 0, 32767, 0, 0, 0, 32767, 0]);   // VEC3 with a stride of 8
  const col = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const idx = new Uint16Array([0, 1, 2, 0, 2, 3]);
  const img = new Uint8Array([1, 2, 3, 4, 5]);
  const parts = [pos, nrm, col, idx, img].map((a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength));
  const offs = []; let o = 0; for (const p of parts) { offs.push(o); o += p.length + ((4 - (p.length % 4)) % 4); }
  const bin = Buffer.concat(parts.map((p) => Buffer.concat([p, Buffer.alloc((4 - (p.length % 4)) % 4)])));
  const json = {
    asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }],
    nodes: [{ name: 'root', translation: [1, 2, 3], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], children: [1] }, { name: 'quad', mesh: 0, scale: [2, 2, 2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    materials: [{ name: 'paint.003', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.25, 0.1, 1], roughnessFactor: 0.4 }, extensions: { KHR_materials_clearcoat: { clearcoatFactor: 0.5 } }, normalTexture: { index: 0 } }],
    textures: [{ extensions: { EXT_texture_webp: { source: 0 } } }], images: [{ name: 'tex', mimeType: 'image/webp', bufferView: 4 }],
    bufferViews: [{ buffer: 0, byteOffset: offs[0], byteLength: 48 }, { buffer: 0, byteOffset: offs[1], byteLength: 32, byteStride: 8 }, { buffer: 0, byteOffset: offs[2], byteLength: 16 },
      { buffer: 0, byteOffset: offs[3], byteLength: 12 }, { buffer: 0, byteOffset: offs[4], byteLength: 5 }],
    accessors: [{ bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [2, 1, 0] }, { bufferView: 1, componentType: 5122, normalized: true, count: 4, type: 'VEC3' },
      { bufferView: 2, componentType: 5121, normalized: true, count: 4, type: 'VEC4' }, { bufferView: 3, componentType: 5123, count: 6, type: 'SCALAR' }],
    buffers: [{ byteLength: bin.length }],
  };
  return makeGlb(json, bin);
}

test('parseGlb: the container, the chunks; a non-GLB and an unknown required extension are refused', () => {
  const g = parseGlb(fixture());
  assert.equal(g.json.asset.version, '2.0'); assert.ok(g.bin.byteLength >= 48 + 32 + 16 + 12 + 5);
  assert.throws(() => parseGlb(new Uint8Array(32)), /not a GLB/);
  const bad = makeGlb({ asset: { version: '2.0' }, extensionsRequired: ['KHR_draco_mesh_compression'], nodes: [], scenes: [{ nodes: [] }] }, Buffer.alloc(0));
  assert.throws(() => parseGlb(bad), /requires KHR_draco/);
});

test('readAccessor: floats as they are, normalized int16 through a stride, uint8 colours to 0..1, indices as integers', () => {
  const g = parseGlb(fixture());
  assert.deepEqual([...readAccessor(g, 0).array], [0, 0, 0, 2, 0, 0, 2, 1, 0, 0, 1, 0]);
  const n = readAccessor(g, 1);
  assert.equal(n.size, 3); assert.deepEqual([...n.array].slice(0, 6), [0, 0, 1, 0, 0, 1]);
  const c = readAccessor(g, 2);
  assert.deepEqual([...c.array].slice(0, 8), [1, 0, 0, 1, 0, 1, 0, 1]);
  const i = readAccessor(g, 3, { asFloat: false });
  assert.ok(i.array instanceof Uint16Array); assert.deepEqual([...i.array], [0, 1, 2, 0, 2, 3]);
});

test('sceneNodes: world = parent × child (translate, a quarter turn about y, a scale of 2)', () => {
  const g = parseGlb(fixture());
  const nodes = sceneNodes(g), quad = nodes.find((n) => n.name === 'quad');
  assert.equal(quad.parent, 0);
  const W = quad.world, p = [2, 0, 0];   // the quad's corner (2, 0, 0) → scale 4 → turned +90° about y → (0, 0, −4) → + (1, 2, 3)
  const x = W[0] * p[0] + W[4] * p[1] + W[8] * p[2] + W[12], y = W[1] * p[0] + W[5] * p[1] + W[9] * p[2] + W[13], z = W[2] * p[0] + W[6] * p[1] + W[10] * p[2] + W[14];
  assert.ok(Math.abs(x - 1) < 1e-6 && Math.abs(y - 2) < 1e-6 && Math.abs(z + 1) < 1e-6, `${x}, ${y}, ${z}`);
  const m = mul4(trsMatrix([1, 0, 0]), trsMatrix(undefined, undefined, [3, 3, 3]));
  assert.equal(m[0], 3); assert.equal(m[12], 1);
});

test('materialOf and imageBytes: the factors, glTF defaults (metal 1), the clear coat, the WebP source; primitives', () => {
  const g = parseGlb(fixture());
  const m = materialOf(g, 0);
  assert.equal(m.name, 'paint.003'); assert.deepEqual(m.base, [0.5, 0.25, 0.1, 1]); assert.equal(m.metal, 1); assert.equal(m.rough, 0.4);
  assert.deepEqual(m.clearcoat, [0.5, 0]); assert.equal(m.tex.normal, 0); assert.equal(m.tex.base, null);
  const im = imageBytes(g, 0); assert.equal(im.mime, 'image/webp'); assert.deepEqual([...im.bytes], [1, 2, 3, 4, 5]);
  const [p] = meshPrimitives(g, 0);
  assert.equal(p.attributes.POSITION.count, 4); assert.equal(p.indices.array.length, 6); assert.equal(p.material, 0);
});

test('gunzipMaybe: undoes gzip, passes plain bytes through (a host may already have decoded it)', async () => {
  const raw = fixture();
  assert.deepEqual(Buffer.from(await gunzipMaybe(new Uint8Array(gzipSync(raw)))), raw);
  assert.equal((await gunzipMaybe(new Uint8Array(raw))).byteLength, raw.byteLength);
});

test('packGlb: KHR_mesh_quantization copy; the same world positions within a step, names, material and image kept', () => {
  const src = fixture(), r = packGlb(src), g = parseGlb(r.glb);
  assert.ok(g.json.extensionsRequired.includes('KHR_mesh_quantization'));
  const a = parseGlb(src);
  const world = (gg) => { const out = []; for (const n of sceneNodes(gg)) if (n.mesh != null) for (const p of meshPrimitives(gg, n.mesh)) { const P = p.attributes.POSITION.array, W = n.world; for (let i = 0; i < P.length; i += 3) out.push(W[0] * P[i] + W[4] * P[i + 1] + W[8] * P[i + 2] + W[12], W[1] * P[i] + W[5] * P[i + 1] + W[9] * P[i + 2] + W[13], W[2] * P[i] + W[6] * P[i + 1] + W[10] * P[i + 2] + W[14]); } return out; };
  const wa = world(a), wb = world(g);
  assert.equal(wa.length, wb.length);
  for (let i = 0; i < wa.length; i++) assert.ok(Math.abs(wa[i] - wb[i]) < 4 / 32767 + 1e-6, `vertex ${i}: ${wa[i]} vs ${wb[i]}`);
  assert.ok(sceneNodes(g).some((n) => n.name === 'quad'), 'the node keeps its name (its mesh on a #q child)');
  assert.equal(materialOf(g, 0).name, 'paint.003');
  assert.deepEqual([...imageBytes(g, 0).bytes], [1, 2, 3, 4, 5]);
  const [p] = meshPrimitives(g, 0);
  assert.equal(p.attributes.TEXCOORD_0, undefined);
  assert.ok(Math.abs(p.attributes.NORMAL.array[2] - 1) < 0.01, 'the normal survives as int8');
  assert.equal(r.gzipped, r.gz.length);
});
