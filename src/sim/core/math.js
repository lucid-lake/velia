// The small maths every module used to define for itself (refactor round 2, Phase D; round 3, D2): one home for them.
// Each export is the exact arithmetic of the local copies it replaced (checked on a grid with Object.is, NaN, ±0 and ±∞
// included), so a swap changes no frame and no number. Copies that differ stay in their files.
//
// clamp keeps Math.min / Math.max's behaviour (b wins when a > b; -0 in becomes +0 at a lower bound of 0).
// clampT is the ternary form (x < a ? a : x > b ? b : x): it differs from clamp for -0 and for a > b, so both exist.
export function clamp(x, a, b) { return Math.min(b, Math.max(a, x)); }
export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const clampT = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
// Hermite smoothstep of x between the edges a and b (0 below a, 1 above b); smooth and smoothstep are one function
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const smoothstep = smooth;
// an angle wrapped to [−π, π] through atan2 (the form most copies used; the `% TAU` and Math.round forms round differently)
export const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
