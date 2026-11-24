// The diagnostics' one object per global (src/ui/diag.js builds it; the 'diag' service). Its own module, so the boat's
// NaN guard (src/sim/boat.js) reads it without importing the UI.
//   peekDiag()   that object if the page made one, else null
export const DIAG_STATES = new WeakMap();   // one diag object per global (the page; a test passes its own)
export const peekDiag = (g = globalThis) => DIAG_STATES.get(g) ?? null;
