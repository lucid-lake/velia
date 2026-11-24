// The design tokens for JS. The CSS lives in src/ui/tokens.css; this module gives
// canvas code the same numbers (TOKENS) and makes sure a page has the CSS (ensureTokens). tests/design.test.mjs keeps
// TOKENS equal to tokens.css.
//
//   import { ensureTokens, TOKENS, FONT } from './tokens.js';
//   ensureTokens();                        // before the first element is styled; a no-op once the tokens are there
//   ctx.strokeStyle = `rgb(${TOKENS.cream.join(' ')} / .5)`;

export const TOKENS = {
  cream: [239, 230, 210],    // --lk-cream
  amber: [247, 192, 96],     // --lk-amber: binnacle amber, the one accent
  port: [255, 112, 100],     // --lk-port
  stbd: [84, 208, 136],      // --lk-stbd
  navy: [11, 16, 22],        // --lk-navy: the pages' ground
  brandNavy: [28, 35, 64],   // --lk-brand-navy: the Lucid Lake logo's navy (#1C2340), the glass's and the capsule's ground
  shade: [6, 12, 18],        // --lk-shade
  ink: 0.94, soft: 0.84, faint: 0.8, hair: 0.5, rest: 0.7, litFill: 0.16,   // the cream's alphas (litFill: the amber's)
  glass: 0.8, nightGlass: 0.86, glassEdge: 0.25,                                             // the plate: the brand navy at 80 %, a cream hairline at 25 %
  night: { cream: [255, 112, 90], amber: [255, 160, 104], port: [255, 96, 84], stbd: [72, 190, 120], navy: [9, 3, 4], shade: [4, 1, 2] },   // the night-red set
  inS: 0.6, outS: 0.45, risePx: 6, staggerS: 0.04,                           // motion
};
export const FONT = `'Jost', -apple-system, 'Helvetica Neue', 'Segoe UI', sans-serif`;                                       // the brand voice
export const UI = `'Atkinson Hyperlegible Next', -apple-system, 'Helvetica Neue', 'Segoe UI', sans-serif`;                    // every small UI text

// The tokens arrive inline with the loading shell (index.html: <style id="lk-tokens">). A page without the shell (a
// demo) gets the stylesheet here, once.
export function ensureTokens(doc = globalThis.document) {
  if (!doc || doc.getElementById('lk-tokens')) return;
  const link = doc.createElement('link');
  link.id = 'lk-tokens'; link.rel = 'stylesheet';
  link.href = new URL('./tokens.css', import.meta.url).href;
  doc.head.prepend(link);
}
