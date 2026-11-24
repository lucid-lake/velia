// The kayaks' asset (KYB1, baked from v1 by tools/v2-kayak-bake.mjs). Pure: no DOM, no three.js.
//   const a = await parseKayakAsset(bytes)   → { json, vertexBytes: ArrayBuffer, indices: Uint16Array (local to each part), clipFrames: Int16Array,
//                                               clipRates: Float32Array, vertices: { count, vertex(i) } }
//   KYB1: 'KYB1', u32 jsonBytes, the JSON (utf8), zero pad to 4, one blob; json.buffers.* = [byteOffset, byteLength]
// The vertex (24 B): snorm16 × 4 position (× posRange m, in the bind frame of its slots), snorm8 × 4 normal, uint8 × 4 slots,
// unorm8 × 4 weights, uint8 × 4 (the material class, three class bytes). The clips: per figure, gait and frame, every slot's
// S (a rotation, a translation, a uniform scale) as int16 (q × 32767, t × tScale m, s × sScale) in 8 shorts; per frame the phase rate (1/s) and the hull's surge (× its mean).
export const KYB_MAGIC = 'KYB1';
export const POS_RANGE = 2.5;     // m: every bind-frame position fits ±2.5 m (the kayak is 3.0 m long, its frame at the middle)
export const T_SCALE = 8192;      // the clips' translations in 1/8192 m (±4 m)
export const S_SCALE = 16384;     // the clips' uniform scales in 1/16384 (0–2: the figure is scaled after its bind)
export const GAIT_NAMES = Object.freeze(['rest', 'cruise', 'sprint', 'back', 'sweepR', 'sweepL']);   // src/sim/kayaks/agent.js GAIT's keys
// the material classes (v1's material names → a byte the WGSL switches on)
export const CLASSES = Object.freeze({
  hull: 0, kayak_nylon: 1, kayak_cord: 2, kayak_holes: 3, kayak_seatback: 4, kayak_seat_frame: 5,
  kayak_paddle_shaft: 6, kayak_paddle_blades: 7, kayak_paddle_rings: 8,
  paddler_body: 10, paddler_pfd: 11, paddler_hair: 12, paddler_brows: 13, paddler_eyes: 14, paddler_hat: 15, paddler_shoe_l: 16, paddler_shoe_r: 16,
  mid_torso: 20, mid_head: 21, mid_paddle: 22,   // v1's mid tier (fleet.js: its torso, head and paddle colours)
});

async function gunzip(u8) {
  if (u8.length < 2 || u8[0] !== 0x1f || u8[1] !== 0x8b) return u8;
  const s = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export async function parseKayakAsset(bytes) {
  const u8 = await gunzip(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  if (u8.length < 8 || String.fromCharCode(u8[0], u8[1], u8[2], u8[3]) !== KYB_MAGIC) throw new Error('not a KYB1 kayak asset');
  const jl = new DataView(u8.buffer, u8.byteOffset, u8.byteLength).getUint32(4, true);
  const json = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl)));
  if (json.version !== 1) throw new Error(`KYB1 version ${json.version}`);
  const b0 = u8.byteOffset + 8 + jl + ((4 - ((8 + jl) % 4)) % 4);
  const slice = ([o, l]) => u8.buffer.slice(b0 + o, b0 + o + l);
  const vertexBytes = slice(json.buffers.vertices);
  const indices = new Uint16Array(slice(json.buffers.indices));
  const clipFrames = new Int16Array(slice(json.buffers.clipFrames));
  const clipRates = new Float32Array(slice(json.buffers.clipRates));
  const dv = new DataView(vertexBytes), stride = json.vertexStride, R = json.posRange;
  const vertices = {
    count: vertexBytes.byteLength / stride,
    // one vertex decoded (the tests and the bake's check): p (m), n, j (slots), w (sum 1), cls, c (3 class bytes 0–1)
    vertex(i) {
      const o = i * stride;
      return {
        p: [0, 1, 2].map((c) => Math.max(-1, dv.getInt16(o + c * 2, true) / 32767) * R),
        n: [0, 1, 2].map((c) => Math.max(-1, dv.getInt8(o + 8 + c) / 127)),
        j: [0, 1, 2, 3].map((c) => dv.getUint8(o + 12 + c)),
        w: [0, 1, 2, 3].map((c) => dv.getUint8(o + 16 + c) / 255),
        cls: dv.getUint8(o + 20), c: [1, 2, 3].map((c) => dv.getUint8(o + 20 + c) / 255),
      };
    },
  };
  return { json, vertexBytes, indices, clipFrames, clipRates, vertices };
}
