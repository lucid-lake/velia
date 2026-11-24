// The logbook's picture treatment off the main thread: an ImageBitmap of the grabbed 300 × 188 frame in, the treated
// JPEG data URL out (src/ui/logbook.js treat(), the same pixels). The read-back, the treatment and the JPEG encode all
// block this worker, never a frame.
import { treat } from '../ui/logbook.js';

self.onmessage = async ({ data: { id, bitmap } }) => {
  try {
    const t0 = performance.now();
    const c = treat(bitmap); bitmap.close();
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    const jpeg = new FileReaderSync().readAsDataURL(blob);
    self.postMessage({ id, jpeg, rawMean: c.rawMean, workerMs: performance.now() - t0 });
  } catch (e) { self.postMessage({ id, error: String(e) }); }
};
