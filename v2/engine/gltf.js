// A small glTF 2.0 binary (GLB) reader (M3b): no three.js, no dependency. Enough for v1's boat models and their
// quantized copies (tools/v2-boat-pack.mjs): the GLB container, accessors of every component type (normalized integers
// dequantized, KHR_mesh_quantization's int8/int16 positions, normals and colours), sparse-free buffer views with a
// byteStride, node transforms (TRS or matrix) composed down the tree, the materials' PBR factors and texture slots
// (KHR_materials_clearcoat, KHR_materials_sheen kept as plain numbers), and the images as bytes with their mime type
// (EXT_texture_webp too). Pure: node tests parse fixtures with it; the boat's worker runs it in the browser.
//   const g = parseGlb(arrayBuffer)              → { json, bin }
//   readAccessor(g, i)                           → { array: Float32Array | Uint16Array | Uint32Array, size, count }
//   const scene = sceneNodes(g)                  → [{ index, name, mesh, world: Float32Array(16), local, parent, children }]
//   meshPrimitives(g, meshIndex)                 → [{ attributes: { POSITION: {array,size,count}, … }, indices, material, mode }]
//   materialOf(g, i)                             → { name, base: [r,g,b,a], metal, rough, alpha, doubleSided, clearcoat, sheen, tex: { base, normal, mr } }
//   imageBytes(g, imageIndex)                    → { bytes: Uint8Array, mime }
export const GLB_MAGIC = 0x46546c67;   // 'glTF'
const CHUNK_JSON = 0x4e4f534a, CHUNK_BIN = 0x004e4942;

export function parseGlb(buf) {
  const ab = buf instanceof ArrayBuffer ? buf : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const dv = new DataView(ab);
  if (ab.byteLength < 20 || dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('not a GLB');
  if (dv.getUint32(4, true) !== 2) throw new Error(`GLB version ${dv.getUint32(4, true)}`);
  const total = Math.min(dv.getUint32(8, true), ab.byteLength);
  let off = 12, json = null, bin = null;
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true);
    const body = new Uint8Array(ab, off + 8, len);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body));
    else if (type === CHUNK_BIN && !bin) bin = body;
    off += 8 + len + ((4 - (len % 4)) % 4);
  }
  if (!json) throw new Error('GLB without a JSON chunk');
  const req = json.extensionsRequired ?? [];
  for (const e of req) if (!SUPPORTED.has(e)) throw new Error(`GLB requires ${e}`);
  return { json, bin };
}
export const SUPPORTED = new Set(['KHR_mesh_quantization', 'EXT_texture_webp', 'KHR_materials_clearcoat', 'KHR_materials_sheen']);

const COMP = {   // componentType → [TypedArray, bytes, normalized divisor]
  5120: [Int8Array, 1, 127], 5121: [Uint8Array, 1, 255], 5122: [Int16Array, 2, 32767], 5123: [Uint16Array, 2, 65535],
  5125: [Uint32Array, 4, 4294967295], 5126: [Float32Array, 4, 1],
};
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

// an accessor as a tightly packed array: floats (normalized integers → [−1, 1] or [0, 1], glTF's max(c / d, −1)), or the
// integers themselves for indices (an index accessor is never normalized); `asFloat` forces floats for an integer
// attribute (KHR_mesh_quantization's unnormalized int16 positions)
export function readAccessor(g, i, { asFloat = null } = {}) {
  const a = g.json.accessors[i];
  if (!a) throw new Error(`accessor ${i}`);
  if (a.sparse) throw new Error('sparse accessors are not supported');
  const [T, bytes, div] = COMP[a.componentType] ?? [];
  if (!T) throw new Error(`componentType ${a.componentType}`);
  const size = SIZE[a.type], count = a.count, n = size * count;
  const float = asFloat ?? (a.componentType === 5126 || !!a.normalized);
  const out = float ? new Float32Array(n) : new (a.componentType === 5125 ? Uint32Array : a.componentType === 5121 ? Uint16Array : T)(n);
  if (a.bufferView == null) return { array: out, size, count };   // all zeros (glTF: an accessor with no view)
  const bv = g.json.bufferViews[a.bufferView];
  const base = g.bin.byteOffset + (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const stride = bv.byteStride ?? size * bytes;
  const scale = a.normalized ? 1 / div : 1, signed = a.componentType === 5120 || a.componentType === 5122;
  if (stride === size * bytes && base % bytes === 0) {
    const src = new T(g.bin.buffer, base, n);
    if (!float || a.componentType === 5126) out.set(src);
    else if (scale === 1) out.set(src);
    else for (let k = 0; k < n; k++) { const v = src[k] * scale; out[k] = signed && v < -1 ? -1 : v; }
    return { array: out, size, count };
  }
  const dv = new DataView(g.bin.buffer);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  for (let e = 0, k = 0; e < count; e++) for (let c = 0; c < size; c++, k++) {
    const v = dv[get](base + e * stride + c * bytes, true) * scale;
    out[k] = signed && a.normalized && v < -1 ? -1 : v;
  }
  return { array: out, size, count };
}

// --- node transforms (column-major Float32Array(16), as engine/math.js) ---
export function trsMatrix(t = [0, 0, 0], r = [0, 0, 0, 1], s = [1, 1, 1], out = new Float32Array(16)) {
  const [x, y, z, w] = r, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  out[0] = (1 - (yy + zz)) * s[0]; out[1] = (xy + wz) * s[0]; out[2] = (xz - wy) * s[0]; out[3] = 0;
  out[4] = (xy - wz) * s[1]; out[5] = (1 - (xx + zz)) * s[1]; out[6] = (yz + wx) * s[1]; out[7] = 0;
  out[8] = (xz + wy) * s[2]; out[9] = (yz - wx) * s[2]; out[10] = (1 - (xx + yy)) * s[2]; out[11] = 0;
  out[12] = t[0]; out[13] = t[1]; out[14] = t[2]; out[15] = 1;
  return out;
}
export function mul4(a, b, out = new Float32Array(16)) {   // out = a × b
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}
export const nodeLocal = (n) => (n.matrix ? Float32Array.from(n.matrix) : trsMatrix(n.translation, n.rotation, n.scale));

// every node under the default scene with its world matrix (relative to the scene root) and its parent
export function sceneNodes(g) {
  const { json } = g, out = [];
  const scene = json.scenes?.[json.scene ?? 0];
  const roots = scene?.nodes ?? json.nodes.map((_, i) => i).filter((i) => !json.nodes.some((n) => n.children?.includes(i)));
  const visit = (i, parentWorld, parent) => {
    const n = json.nodes[i], local = nodeLocal(n), world = parentWorld ? mul4(parentWorld, local) : local;
    out.push({ index: i, name: n.name ?? `node${i}`, mesh: n.mesh ?? null, local, world, parent, children: n.children ?? [] });
    for (const c of n.children ?? []) visit(c, world, i);
  };
  for (const r of roots) visit(r, null, null);
  return out;
}

export function meshPrimitives(g, m) {
  const mesh = g.json.meshes[m];
  return mesh.primitives.map((p) => {
    const attributes = {};
    for (const [k, i] of Object.entries(p.attributes)) attributes[k] = readAccessor(g, i, { asFloat: true });
    return { attributes, indices: p.indices != null ? readAccessor(g, p.indices, { asFloat: false }) : null, material: p.material ?? null, mode: p.mode ?? 4 };
  });
}

// a material's numbers (glTF defaults filled in); texture slots as image indices (EXT_texture_webp's source first)
export function materialOf(g, i) {
  const m = i == null ? {} : g.json.materials?.[i] ?? {};
  const pbr = m.pbrMetallicRoughness ?? {}, ext = m.extensions ?? {};
  const img = (t) => { if (!t) return null; const tex = g.json.textures?.[t.index]; if (!tex) return null; return tex.extensions?.EXT_texture_webp?.source ?? tex.source ?? null; };
  return {
    name: m.name ?? '', base: pbr.baseColorFactor ?? [1, 1, 1, 1], metal: pbr.metallicFactor ?? 1, rough: pbr.roughnessFactor ?? 1,
    alpha: m.alphaMode ?? 'OPAQUE', doubleSided: !!m.doubleSided,
    clearcoat: ext.KHR_materials_clearcoat ? [ext.KHR_materials_clearcoat.clearcoatFactor ?? 0, ext.KHR_materials_clearcoat.clearcoatRoughnessFactor ?? 0] : [0, 0],
    sheen: ext.KHR_materials_sheen ? [...(ext.KHR_materials_sheen.sheenColorFactor ?? [0, 0, 0]), ext.KHR_materials_sheen.sheenRoughnessFactor ?? 0] : null,
    tex: { base: img(pbr.baseColorTexture), normal: img(m.normalTexture), mr: img(pbr.metallicRoughnessTexture) },
  };
}

export function imageBytes(g, i) {
  const im = g.json.images[i], bv = g.json.bufferViews[im.bufferView];
  return { name: im.name ?? `image${i}`, mime: im.mimeType ?? 'image/png', bytes: new Uint8Array(g.bin.buffer, g.bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength) };
}

// gzip or not: the packed copies ship gzipped (a host may already have undone it as Content-Encoding); → the GLB bytes
export async function gunzipMaybe(u8) {
  if (u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}
