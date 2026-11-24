// The binoculars' look (owner, 2026-10-29; the rim 2026-10-30): two soft circles merging (a horizontal figure-eight), the dark outside them, a darkened rim with a faint colour fringe, drawn once per window
// size on a 2-D canvas over the page; it fades in with the raise. The focus pull is a CSS blur on the page's canvas
// for the first 0.7 s (BINO.focusPx → 0). No reticle, no numbers. Plain DOM.
//   const view = createBinocularsView({ canvas: renderer.domElement }); view.update(k, blurPx); view.dispose()
export const VIGNETTE = { r: 0.44, sep: 0.72, edge: 0.09, dark: 'rgb(3,5,7)' };   // r, edge: × the window's height; sep: the circles' centres apart, × r

export function createBinocularsView({ canvas: page = null, root = document.body } = {}) {
  const c = document.createElement('canvas');
  c.className = 'lk-bino';
  Object.assign(c.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '8', opacity: '0', display: 'none' });
  root.appendChild(c);
  let w = 0, h = 0, shown = -1, blurShown = -1;
  // per pixel, once per window size (half resolution): m = the distance to the NEARER eyepiece's centre over its radius, so
  // the two fields read as one figure-eight with no seam; the image darkens toward the field stop, a faint warm/cool fringe
  // rides the stop (warm on the left eyepiece's outer edge, cool on the right's), and outside it is the dark
  function draw() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    w = Math.round(innerWidth * dpr / 2); h = Math.round(innerHeight * dpr / 2);
    c.width = w; c.height = h;
    const g = c.getContext('2d'), V = VIGNETTE, r = V.r * h, e = V.edge * h / r, dx = V.sep * r / 2;
    const img = g.createImageData(w, h), D = img.data, dark = [3, 5, 7];
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    for (let y = 0; y < h; y++) {
      const yy = y - h / 2;
      for (let x = 0; x < w; x++) {
        const dl = Math.hypot(x - (w / 2 - dx), yy) / r, dr = Math.hypot(x - (w / 2 + dx), yy) / r, m = Math.min(dl, dr);
        const out = sm(1 - e * 0.55, 1 + e * 0.35, m);                    // the field stop's soft edge
        const rim = 0.55 * sm(0.62, 1, m) ** 2;                             // the darkening toward it
        const fr = Math.exp(-(((m - 0.965) / 0.018) ** 2)) * 0.22 * (1 - out);   // the thin fringe just inside the stop
        const warm = dl < dr;
        const k = (y * w + x) * 4;
        D[k] = dark[0] + (warm ? 120 : 20) * fr; D[k + 1] = dark[1] + 60 * fr; D[k + 2] = dark[2] + (warm ? 20 : 130) * fr;
        D[k + 3] = Math.round(255 * Math.min(1, out + rim * (1 - out) + fr));
      }
    }
    g.putImageData(img, 0, 0);
  }
  const onResize = () => { if (shown > 0) draw(); else w = 0; };
  addEventListener('resize', onResize);
  function update(k, blurPx = 0) {
    if (k > 0 && !w) draw();
    const o = Math.round(k * 100) / 100;
    if (o !== shown) { shown = o; c.style.opacity = String(o); c.style.display = o > 0 ? 'block' : 'none'; }
    const b = Math.round(blurPx * 10) / 10;
    if (page && b !== blurShown) { blurShown = b; page.style.filter = b > 0.05 ? `blur(${b}px)` : ''; }
  }
  function dispose() { removeEventListener('resize', onResize); c.remove(); if (page) page.style.filter = ''; }
  return { el: c, update, dispose };
}
