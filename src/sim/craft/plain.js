// A craft's state as plain data and back (moved from src/sail/simulation.js, refactor round 2 Phase C step 5, so the
// crafts' physics factories and the Simulation share it with no import cycle). Same code.
// SKIP: a physics' constants (P: the params rebuild them), its per-tick scratch and its profile (kept by its id)
const SKIP = new Set(['P', 'trim', '_good', 'vessel']);
export function plain(v) {
  if (v == null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(plain);
  const o = {};
  for (const k of Object.keys(v)) if (!SKIP.has(k) && typeof v[k] !== 'function') o[k] = plain(v[k]);
  return o;
}
// src's plain fields into target: nested objects merged into the target's own (their classes kept), the rest set
export function assign(target, src) {
  for (const k of Object.keys(src)) {
    const v = src[k], cur = target[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) assign(cur, v);
    else target[k] = plain(v);
  }
  return target;
}
