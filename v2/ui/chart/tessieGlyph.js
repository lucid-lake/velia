// Tessie's tiny pin logo (owner, 2026-11-25): a lake monster's head and neck and two humps over a wave line, about 11 px tall, drawn in
// the ink around it (currentColor in the DOM; the chart's name ink on the canvas). One definition for every surface that draws a pin:
// the live chart's name sprites (Path2D of TESSIE_GLYPH.d), the Start plate, the card's mini chart and the phone card (tessieGlyphSvg).
// A pin has it when its row carries `mark` (the flag; Off Fannette's row today).
export const TESSIE_GLYPH = Object.freeze({
  w: 24, h: 14,        // the drawing's own units
  stroke: 1.25,        // px at any size (non-scaling in the DOM; divided by the scale on the canvas)
  title: "Tessie's water",
  d: 'M7 10 C6.4 6.6 6.8 4.2 5.7 3.1 C4.6 2.2 3 2.5 2.3 3.7 L3.7 4.3 M9.6 10 C9.9 6.5 13.3 6.5 13.6 10 M15.2 10 C15.5 7.5 18.1 7.5 18.4 10 M1 11.7 q1.9 -1.5 3.8 0 t3.8 0 t3.8 0 t3.8 0 t3.8 0 t3.8 0',
});
// the DOM mark: an inline svg 11 px tall in the text's ink, titled and labelled for assistive tech
export const tessieGlyphSvg = (cls = 'tg', hPx = 11) => {
  const G = TESSIE_GLYPH;
  return `<svg class="${cls}" viewBox="0 0 ${G.w} ${G.h}" width="${+(hPx * G.w / G.h).toFixed(1)}" height="${hPx}" role="img" aria-label="${G.title}" focusable="false"><title>${G.title}</title><path d="${G.d}" fill="none" stroke="currentColor" stroke-width="${G.stroke}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
};
// the canvas mark: drawn at (x, y) = the glyph's left and baseline-bottom, hPx tall, in the context's current stroke style; returns its width
export function drawTessieGlyph(g, x, y, hPx, style = null) {
  const G = TESSIE_GLYPH, s = hPx / G.h, w = G.w * s;
  if (typeof Path2D === 'undefined') return w;
  g.save(); if (style) g.strokeStyle = style;
  g.translate(x, y - hPx); g.scale(s, s); g.lineWidth = G.stroke / s; g.lineCap = 'round'; g.lineJoin = 'round';
  g.stroke(new Path2D(G.d)); g.restore();
  return w;
}
export const tessieGlyphWidth = (hPx) => (hPx * TESSIE_GLYPH.w) / TESSIE_GLYPH.h;
