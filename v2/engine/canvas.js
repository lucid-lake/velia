// Canvas sizing: the backing store is CSS size × min(devicePixelRatio, dprCap) × the governor's scale, then shrunk to
// the pixel budget (maxPx). The CSS size is read once per resize (a ResizeObserver), never in the frame. A fixed size
// (?w=&h= or a capture's viewport at DPR 1) pins it. The pure part, backingSize(), is what the tests check.
//   backingSize({ cssW, cssH, dpr, dprCap, maxPx, scale }) → [w, h]
export function backingSize({ cssW, cssH, dpr = 1, dprCap = 2, maxPx = 3.4e6, scale = 1 }) {
  const r = Math.min(dpr || 1, dprCap) * Math.min(1, Math.max(0.1, scale));
  let w = cssW * r, h = cssH * r;
  const px = w * h;
  if (px > maxPx) { const k = Math.sqrt(maxPx / px); w *= k; h *= k; }
  return [Math.max(1, Math.round(w)), Math.max(1, Math.round(h))];
}

// watches the canvas's CSS box; sizeNow(scale) returns the backing size for the current box and applies it to the canvas
// when it changed (true when it did). Nothing here touches the GPU: the frame graph resizes its targets on `true`.
export function createCanvasSizer(canvas, { dprCap = 2, maxPx = 3.4e6, fixed = null, pixelRatio = NaN } = {}) {
  let cssW = canvas.clientWidth || 1, cssH = canvas.clientHeight || 1, dirty = true;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => {
    for (const e of es) { const b = e.contentRect; if (b.width && b.height) { cssW = b.width; cssH = b.height; dirty = true; } }
  }) : null;
  ro?.observe(canvas);
  return {
    get css() { return [cssW, cssH]; },
    get caps() { return { dprCap, maxPx }; },
    // the phone pass: a quality level's caps, live (the next sizeNow applies them; the frame graph resizes on its true)
    setCaps(o = {}) { if (o.dprCap > 0) dprCap = o.dprCap; if (o.maxPx > 0) maxPx = o.maxPx; },
    sizeNow(scale = 1) {
      const dpr = Number.isFinite(pixelRatio) ? pixelRatio : (globalThis.devicePixelRatio || 1);
      const [w, h] = fixed ?? backingSize({ cssW, cssH, dpr, dprCap, maxPx, scale });
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; dirty = false; return true; }
      dirty = false; return false;
    },
    stop() { ro?.disconnect(); },
  };
}
