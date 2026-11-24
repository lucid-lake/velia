// WCAG 2.x contrast maths, pure (tools/probe_contrast.mjs and tests/contrast.test.mjs share it).
// Colours are [r, g, b] 0–255; alpha 0–1.: the glass is the contrast guarantee.

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const x = luminance(a), y = luminance(b), hi = Math.max(x, y), lo = Math.min(x, y); return (hi + 0.05) / (lo + 0.05); };
// colour c at alpha a over the opaque colour bg
export const over = (c, a, bg) => [0, 1, 2].map((i) => c[i] * a + bg[i] * (1 - a));
// the contrast of ink (colour + alpha) laid on a backdrop pixel
export const inkRatio = (ink, alpha, bg) => ratio(over(ink, alpha, bg), bg);
// WCAG AA: 4.5 for text, 3 for large text (≥ 24 px, or ≥ 18.66 px bold) and for icons and other graphics
export const need = ({ kind = 'text', px = 16, weight = 400 } = {}) => (kind === 'icon' || px >= 24 || (px >= 18.66 && weight >= 700) ? 3 : 4.5);
// the plate: glass of colour `glass` at alpha over a world pixel
export const plate = (glass, alpha, world) => over(glass, alpha, world);
