// The edge pair's one stylesheet: the key legend on the right edge (keyLegend.js) and the
// nav column on the left (navColumn.js) stand on the same anchors, in the same type, with the same shadow and the same fade.
// Mirrored: each block hugs its own margin (--lk-mx) and grows upward from one foot (--lk-edge-foot = --lk-my + 12 vh, above
// the coaming dials). No plate, no pointer. What is a block's own (the legend's caps and levels, the column's numbers) stays
// in its own file.
//
//   ensureEdgeStyle(doc)     installs the shared CSS once (id lk-edgepair-css); both blocks call it
//   EDGE                     { rowPx, fadeMs }: the 36 px row (a 1.9 em cap plus the .5 em gap at 15 px) and the 400 ms fade
//   <div class="lk-edgepair right"> the legend · <div class="lk-edgepair left"> the column · .on shows a block (opacity only)
export const EDGE = { rowPx: 36, fadeMs: 400 };

export const EDGE_CSS = `
:root{--lk-edge-row:${EDGE.rowPx}px;--lk-edge-foot:calc(var(--lk-my) + 12vh)}
.lk-edgepair{position:fixed;bottom:var(--lk-edge-foot);z-index:var(--lk-z-hud);pointer-events:none;user-select:none;
  display:grid;grid-template-columns:max-content max-content;column-gap:.7em;font:var(--lk-medium) 15px/1.2 var(--lk-ui);letter-spacing:var(--lk-track-caps);text-transform:uppercase;
  color:rgb(var(--lk-cream));text-shadow:0 1px 2px rgb(var(--lk-brand-navy) / .9),0 0 8px rgb(var(--lk-brand-navy) / .7);opacity:0;visibility:hidden;
  transition:opacity ${EDGE.fadeMs}ms var(--lk-ease),visibility 0s linear ${EDGE.fadeMs}ms;-webkit-font-smoothing:antialiased}
.lk-edgepair.on{opacity:1;visibility:visible;transition:opacity ${EDGE.fadeMs}ms var(--lk-ease),visibility 0s}
.lk-edgepair.right{right:var(--lk-mx)}
.lk-edgepair.left{left:var(--lk-mx)}
@media (prefers-reduced-motion:reduce){.lk-edgepair{transition:none}}`;

export function ensureEdgeStyle(doc = globalThis.document) {
  if (!doc?.head || doc.getElementById('lk-edgepair-css')) return;
  const st = doc.createElement('style'); st.id = 'lk-edgepair-css'; st.textContent = EDGE_CSS;
  doc.head.appendChild(st);
}
