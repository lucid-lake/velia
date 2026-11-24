// The shore grids' worker (v2/sim/lake.js): inflate + unpredict one of v1's -d.lsh grids off the main thread (the bay's
// 1.26 M texels take a few ms), the codes back transferred.
//   post { id, bytes (Uint8Array, transferred), w, h } → { id, codes (Uint16Array) } | { id, error }
import { inflate, unpredict } from '../terrain/decode.js';

self.onmessage = async (e) => {
  const { id, bytes, w, h } = e.data;
  try {
    const codes = unpredict(await inflate(bytes), w, h);
    self.postMessage({ id, codes }, [codes.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
