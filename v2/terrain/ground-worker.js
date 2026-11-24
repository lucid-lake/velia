// The ground worker (M5c): fetch a WebP (a photo tile or one of v1's detail strips), decode it off the main thread
// (createImageBitmap + an OffscreenCanvas: a 256² tile in ≈ 2 ms, a 512 × 3072 strip in ≈ 20 ms), hand the RGBA bytes
// back transferred. `scale` draws the image larger (the 256² pack strip to 512², so the detail array's layers match).
//   post { id, url, scale? } → { id, w, h, data: Uint8ClampedArray, bytes (on the wire), ms } or { id, error }
self.onmessage = async (e) => {
  const { id, url, scale = 1 } = e.data;
  try {
    const t = performance.now();
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    const blob = await r.blob();
    const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const w = bmp.width * scale, h = bmp.height * scale;
    const cv = new OffscreenCanvas(w, h), ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = scale !== 1;
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const img = ctx.getImageData(0, 0, w, h);
    self.postMessage({ id, w, h, data: img.data, bytes: blob.size, ms: performance.now() - t }, [img.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
