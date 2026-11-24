// M4: the cockpit asset's reader (CKB1, baked from v1's live page by tools/v2-cockpit-bake.mjs). Pure: no DOM, no three.js.
//   const ck = await parseCockpit(bytes)        → { json, vertices: ArrayBuffer, indices: Uint32Array, atlasPng: Uint8Array,
//                                                   coverFrames: Float32Array, streams: { position, normal, uv, sh } (typed views) }
//                                                   bytes: ArrayBuffer | Uint8Array, gzipped (1f 8b) or not
//   composeNodes(json.nodes, out?)              → Float32Array(16 × nodes): each node's matrix in the cockpit root's frame
//                                                   (column-major, WebGPU's and three's order), from the local TRS
//   setRotation(json.nodes, i, axis, rad)       → sets r[axis] ('x' | 'y' | 'z' | 0..2) and rebuilds q (Euler XYZ, three's default)
// CKB1: 'CKB1', u32 jsonBytes, the JSON (utf8), zero pad to 4, one binary blob; json.buffers.* = [byteOffset, byteLength] in the blob.
export const CKB_MAGIC = 'CKB1';

async function inflate(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('gzip input needs DecompressionStream');
  const ds = new DecompressionStream('gzip');
  const out = new Blob([u8]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function parseCockpit(bytes) {
  let u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) u8 = await inflate(u8);
  if (u8.length < 8 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== CKB_MAGIC) throw new Error('not a CKB1 cockpit asset');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const jl = dv.getUint32(4, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl)));
  if (json.version !== 1) throw new Error(`CKB1 version ${json.version}`);
  const b0 = u8.byteOffset + 8 + jl + ((4 - ((8 + jl) % 4)) % 4);   // the blob's start in the underlying buffer (4-aligned in the file)
  const slice = ([o, l]) => u8.buffer.slice(b0 + o, b0 + o + l);   // copies: aligned, and independent of the input
  const vertices = slice(json.buffers.vertices);
  const indices = new Uint32Array(slice(json.buffers.indices));
  const atlasPng = new Uint8Array(slice(json.buffers.atlasPng));
  const coverFrames = new Float32Array(slice(json.buffers.coverFrames ?? [0, 0]));
  const n = json.layout.vertexCount, streams = {};
  for (const s of json.layout.streams) {
    const T = s.format.startsWith('float32') ? Float32Array : s.format.startsWith('snorm8') ? Int8Array : null;
    const k = +s.format.match(/x(\d)$/)[1];
    if (T) streams[s.name] = new T(vertices, s.offset, n * k);
  }
  return { json, vertices, indices, atlasPng, coverFrames, streams };
}

// a quaternion from Euler angles in three's XYZ order (q = qx · qy · qz)
export function quatFromEulerXYZ(x, y, z, out = [0, 0, 0, 1]) {
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2), s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  out[0] = s1 * c2 * c3 + c1 * s2 * s3;
  out[1] = c1 * s2 * c3 - s1 * c2 * s3;
  out[2] = c1 * c2 * s3 + s1 * s2 * c3;
  out[3] = c1 * c2 * c3 - s1 * s2 * s3;
  return out;
}

export function setRotation(nodes, i, axis, rad) {
  const nd = nodes[i], a = typeof axis === 'number' ? axis : 'xyz'.indexOf(axis);
  if (a < 0 || a > 2) throw new Error(`axis ${axis}`);
  if (nd.order && nd.order !== 'XYZ') throw new Error(`node ${i}: Euler order ${nd.order}`);
  nd.r[a] = rad;
  quatFromEulerXYZ(nd.r[0], nd.r[1], nd.r[2], nd.q);
  return nd;
}

// local TRS → column-major matrix into m at offset o
function trs(m, o, p, q, s) {
  const [x, y, z, w] = q, x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2, wx = w * x2, wy = w * y2, wz = w * z2;
  m[o] = (1 - (yy + zz)) * s[0]; m[o + 1] = (xy + wz) * s[0]; m[o + 2] = (xz - wy) * s[0]; m[o + 3] = 0;
  m[o + 4] = (xy - wz) * s[1]; m[o + 5] = (1 - (xx + zz)) * s[1]; m[o + 6] = (yz + wx) * s[1]; m[o + 7] = 0;
  m[o + 8] = (xz + wy) * s[2]; m[o + 9] = (yz - wx) * s[2]; m[o + 10] = (1 - (xx + yy)) * s[2]; m[o + 11] = 0;
  m[o + 12] = p[0]; m[o + 13] = p[1]; m[o + 14] = p[2]; m[o + 15] = 1;
}

// parents come before children (the bake's depth-first order), so one pass composes the tree. The products run in float64
// (a scratch) and land in the Float32Array out.
const L = new Float64Array(16);
export function composeNodes(nodes, out = new Float32Array(16 * nodes.length), work = new Float64Array(16 * nodes.length)) {
  for (let i = 0; i < nodes.length; i++) {
    const nd = nodes[i], o = 16 * i;
    if (nd.parent < 0) { trs(work, o, nd.p, nd.q, nd.s); continue; }
    if (nd.parent >= i) throw new Error(`node ${i}: parent ${nd.parent} is not before it`);
    trs(L, 0, nd.p, nd.q, nd.s);
    const po = 16 * nd.parent;
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      work[o + 4 * c + r] = work[po + r] * L[4 * c] + work[po + 4 + r] * L[4 * c + 1] + work[po + 8 + r] * L[4 * c + 2] + work[po + 12 + r] * L[4 * c + 3];
    }
  }
  for (let k = 0; k < 16 * nodes.length; k++) out[k] = work[k];
  return out;
}
