// The forest worker (M5b): fetch a forest file, inflate it, decode its planes into the GPU's records, hand them back
// (transferred). 581 k shrubs decode in ≈ 15 ms: never on the main thread.
//   post { id, url } → { id, file: decodeForest(…) without the copy, bytes (on the wire), ms } or { id, error }
import { inflate } from '../terrain/decode.js';
import { decodeForest } from './format.js';

self.onmessage = async (e) => {
  const { id, url } = e.data;
  try {
    const t = performance.now();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const raw = new Uint8Array(await r.arrayBuffer());
    const f = decodeForest(await inflate(raw));
    self.postMessage({ id, file: f, bytes: raw.length, ms: performance.now() - t }, [f.inst.buffer, f.start.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
