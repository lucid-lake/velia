// v2's boat models, packed (M3b): v1's GLBs (models/boat/*.glb, never touched) rewritten as small, still standard glTF
// 2.0 binaries, then gzipped. Node only (zlib). Used by tools/v2-boat-pack.mjs (the CLI) and v2/vite.config.js (the dev
// server packs on request; a build writes dist-v2/models/boat/*.glb.gz).
//   KHR_mesh_quantization: positions as normalized int16 in a per-mesh cube (0.14 mm steps on the 9 m shell), the cube's
//     offset and uniform scale on a new child node that carries the mesh (the old node keeps its name, transform and
//     children, so every socket and moving part keeps its frame; a uniform scale leaves the normals' directions alone);
//     normals as normalized int8 (≤ 0.5°); COLOR_0 as normalized uint8; texture coordinates stay float (the teak's and the
//     cushions' run to ±80: an int16 would need KHR_texture_transform); indices as they are.
//   Dropped: texture coordinates no material reads (readsUv), COLOR_1 (v1's materials read COLOR_0 only: three's vertexColor(); the cockpit's baked AO in COLOR_1 never
//     reached v1's screen), node extras, the generator string. Kept: every node, material and the WebP images byte for byte.
//   packGlb(buf) → { glb: Buffer, gz: Buffer, raw, quantized, gzipped }   (byte counts)
import { gzipSync } from 'node:zlib';
import { parseGlb, readAccessor } from '../../v2/engine/gltf.js';

const align4 = (n) => (n + 3) & ~3;
// a primitive keeps its texture coordinates only where its material reads them: a texture, or v1's procedural teak
// (hullMaterials.js teakDeck: the planks from the UVs); the gelcoat, non-skid and antifouling work from the position
export const readsUv = (json, mi) => {
  const m = json.materials?.[mi]; if (!m) return false;
  const p = m.pbrMetallicRoughness ?? {};
  return !!(p.baseColorTexture || p.metallicRoughnessTexture || m.normalTexture || m.occlusionTexture || m.emissiveTexture) || /^teak/.test(m.name ?? '');
};

export function packGlb(buf) {
  const g = parseGlb(buf);
  const src = g.json;
  const json = JSON.parse(JSON.stringify(src));
  delete json.asset.generator; json.asset.generator = 'velia-pack';
  for (const n of json.nodes) delete n.extras;
  for (const m of json.meshes ?? []) delete m.extras;
  const chunks = [];
  let off = 0;
  const views = [], accessors = [];
  const view = (bytes, { stride, target } = {}) => {
    const pad = align4(off) - off; if (pad) { chunks.push(Buffer.alloc(pad)); off += pad; }
    views.push({ buffer: 0, byteOffset: off, byteLength: bytes.byteLength, ...(stride ? { byteStride: stride } : {}), ...(target ? { target } : {}) });
    chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)); off += bytes.byteLength;
    return views.length - 1;
  };
  const acc = (a) => { accessors.push(a); return accessors.length - 1; };

  // images first (byte for byte)
  for (const im of json.images ?? []) {
    const bv = src.bufferViews[im.bufferView];
    im.bufferView = view(new Uint8Array(g.bin.buffer, g.bin.byteOffset + (bv.byteOffset ?? 0), bv.byteLength));
  }
  // per mesh: one quantization cube over all its primitives' positions
  const cube = (json.meshes ?? []).map((m, mi) => {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of src.meshes[mi].primitives) {
      const a = src.accessors[p.attributes.POSITION];
      for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], a.min[c]); mx[c] = Math.max(mx[c], a.max[c]); }
    }
    const centre = mn.map((v, c) => 0.5 * (v + mx[c]));
    const half = Math.max(1e-6, ...mx.map((v, c) => 0.5 * (v - mn[c])));
    return { centre, half };
  });
  for (const [mi, m] of (json.meshes ?? []).entries()) {
    const { centre, half } = cube[mi];
    m.primitives = src.meshes[mi].primitives.map((p) => {
      const out = { attributes: {}, ...(p.material != null ? { material: p.material } : {}), ...(p.mode != null ? { mode: p.mode } : {}) };
      for (const [name, ai] of Object.entries(p.attributes)) {
        const a = readAccessor(g, ai, { asFloat: true }), n = a.count;
        if (name === 'POSITION') {
          const q = new Int16Array(n * 4); const mn = [32767, 32767, 32767], mx = [-32767, -32767, -32767];
          for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) {
            const v = Math.max(-32767, Math.min(32767, Math.round(((a.array[i * 3 + c] - centre[c]) / half) * 32767)));
            q[i * 4 + c] = v; mn[c] = Math.min(mn[c], v); mx[c] = Math.max(mx[c], v);
          }
          out.attributes.POSITION = acc({ bufferView: view(q, { stride: 8, target: 34962 }), componentType: 5122, normalized: true, count: n, type: 'VEC3', min: mn.map((v) => v / 32767), max: mx.map((v) => v / 32767) });
        } else if (name === 'NORMAL') {
          const q = new Int8Array(n * 4);
          for (let i = 0; i < n; i++) {
            const x = a.array[i * 3], y = a.array[i * 3 + 1], z = a.array[i * 3 + 2], l = Math.hypot(x, y, z) || 1;
            q[i * 4] = Math.round((x / l) * 127); q[i * 4 + 1] = Math.round((y / l) * 127); q[i * 4 + 2] = Math.round((z / l) * 127);
          }
          out.attributes.NORMAL = acc({ bufferView: view(q, { stride: 4, target: 34962 }), componentType: 5120, normalized: true, count: n, type: 'VEC3' });
        } else if (name === 'COLOR_0') {
          const q = new Uint8Array(n * 4);
          for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) q[i * 4 + c] = c < a.size ? Math.round(Math.max(0, Math.min(1, a.array[i * a.size + c])) * 255) : 255;
          out.attributes.COLOR_0 = acc({ bufferView: view(q, { stride: 4, target: 34962 }), componentType: 5121, normalized: true, count: n, type: 'VEC4' });
        } else if (name === 'COLOR_1' || (name.startsWith('TEXCOORD') && !readsUv(src, p.material))) {
          continue;
        } else {
          const f = Float32Array.from(a.array);
          const lo = new Array(a.size).fill(Infinity), hi = new Array(a.size).fill(-Infinity);
          for (let i = 0; i < n; i++) for (let c = 0; c < a.size; c++) { lo[c] = Math.min(lo[c], f[i * a.size + c]); hi[c] = Math.max(hi[c], f[i * a.size + c]); }
          out.attributes[name] = acc({ bufferView: view(f, { target: 34962 }), componentType: 5126, count: n, type: src.accessors[ai].type, min: lo, max: hi });
        }
      }
      if (p.indices != null) {
        const a = readAccessor(g, p.indices, { asFloat: false });
        let mx = 0; for (const v of a.array) mx = Math.max(mx, v);
        const arr = mx < 65536 ? Uint16Array.from(a.array) : Uint32Array.from(a.array);
        out.indices = acc({ bufferView: view(arr, { target: 34963 }), componentType: arr instanceof Uint16Array ? 5123 : 5125, count: arr.length, type: 'SCALAR' });
      }
      return out;
    });
  }
  // the dequantization: each mesh node's mesh moves to a new child with the cube's offset and scale
  const N = json.nodes.length;
  for (let i = 0; i < N; i++) {
    const n = json.nodes[i];
    if (n.mesh == null) continue;
    const { centre, half } = cube[n.mesh];
    json.nodes.push({ name: `${n.name ?? `node${i}`}#q`, mesh: n.mesh, translation: centre, scale: [half, half, half] });
    delete n.mesh;
    n.children = [json.nodes.length - 1, ...(n.children ?? [])];   // first: the traversal order (and so the draw order) stays the source's
  }
  json.bufferViews = views; json.accessors = accessors;
  json.buffers = [{ byteLength: align4(off) }];
  json.extensionsUsed = [...new Set([...(json.extensionsUsed ?? []), 'KHR_mesh_quantization'])];
  json.extensionsRequired = [...new Set([...(json.extensionsRequired ?? []), 'KHR_mesh_quantization'])];
  const bin = Buffer.concat([...chunks, Buffer.alloc(align4(off) - off)]);
  let js = Buffer.from(JSON.stringify(json), 'utf8');
  js = Buffer.concat([js, Buffer.alloc(align4(js.length) - js.length, 0x20)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  const total = 12 + 8 + js.length + 8 + bin.length;
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(total, 8);
  jh.writeUInt32LE(js.length, 0); jh.writeUInt32LE(0x4e4f534a, 4);
  bh.writeUInt32LE(bin.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([head, jh, js, bh, bin]);
  const gz = gzipSync(glb, { level: 9, mtime: 0 });
  return { glb, gz, raw: buf.byteLength, quantized: glb.length, gzipped: gz.length };
}

export const BOAT_MODELS = Object.freeze(['hull', 'cockpit', 'hardware', 'wheel']);   // models/boat/<name>.glb → <name>.glb.gz
