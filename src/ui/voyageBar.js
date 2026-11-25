// The voyage bar (owner, 2026-11-17: "This Tessie logo is beautiful; consider using it in the loading bar as well, i.e. boat +
// Tessie"): the loading line as engraving, one small reusable piece. A slim engraved rule (a hairline, a fainter second rule
// under it and a scale's ticks, the chart's scale bar) fills in cream as the page loads; an engraved sloop sails along it
// (navy hulls and sails drawn in cream ink, panel seams, a gold sheer line) and Tessie's humps surface and sink in its wake (the
// chart mark's style: cream ink, gold scutes). Calm, never a cartoon: one slow bob, one slow surfacing; under reduced motion
// nothing moves but the position. Inline SVG and CSS only: no request, it paints with the shell before any script.
// The line spans the whole width of its box (owner, 2026-11-25: the bar starts at the far left and ends at the far right): no side margin.
// Single source: tools/loading_shell.py inlines VOYAGE_CSS and VOYAGE_SVG (between their backticks) into the shell, so the boot
// screen of index.html, demos/loading.html and v2/index.html carry it; another screen (a card's loading line) builds the same
// markup with voyageBarHtml() and moves it with setVoyage().
//   VOYAGE_CSS                    the rules (.lk-line, .lk-sailed, .lk-psloop, .lk-tw; --p is the progress 0…1)
//   VOYAGE_SVG                    the sloop and Tessie (in .lk-psloop)
//   voyageBarHtml()               '<div class="lk-line">…</div>' (the line, the sailed part, the boat and Tessie)
//   setVoyage(el, p)              sets --p on el (the bar or any ancestor) and aria-valuenow on the nearest [role=progressbar]
export const VOYAGE_CSS = `.lk-line{position:relative;height:2px;margin:0;background:rgb(var(--lk-cream) / .3);border-radius:1px;box-shadow:0 4px 0 -1.5px rgb(var(--lk-cream) / .14)}
    .lk-line::before{content:'';position:absolute;left:0;right:0;top:-3px;height:8px;background:repeating-linear-gradient(90deg,rgb(var(--lk-cream) / .28) 0 1px,transparent 1px 10%);pointer-events:none}
    .lk-sailed{position:absolute;left:0;top:0;bottom:0;width:100%;background:rgb(var(--lk-cream) / .92);transform-origin:0 50%;transform:scaleX(var(--p));border-radius:1px}
    .lk-psloop{position:absolute;left:calc(var(--p) * 100%);top:50%;width:clamp(28px,3.2vh,40px);height:auto;transform:translate(-50%,-78%);color:var(--lk-ink);filter:drop-shadow(0 1px 4px rgb(var(--lk-brand-navy) / .6))}
    #lk-load .lk-psloop svg{display:block;width:100%;height:auto;overflow:visible;animation:lk-pbob 3.6s ease-in-out infinite}
    .lk-psloop .s,.lk-psloop .h,.lk-psloop .tb{fill:rgb(var(--lk-brand-navy));stroke:rgb(var(--lk-cream));stroke-width:6;stroke-linejoin:round}
    .lk-psloop .k{fill:none;stroke:rgb(var(--lk-cream));stroke-width:3;stroke-linecap:round;opacity:.75}
    .lk-psloop .g{fill:none;stroke:#c9a45a;stroke-width:4;stroke-linecap:round}
    .lk-psloop .gd{fill:#c9a45a}
    .lk-tw{animation:lk-tsurf 7.2s ease-in-out infinite}
    @keyframes lk-pbob{0%,100%{transform:translateY(0) rotate(0)}50%{transform:translateY(-1px) rotate(-1.4deg)}}
    @keyframes lk-tsurf{0%,100%{transform:translateY(0)}45%,55%{transform:translateY(46px)}}
    @media (prefers-reduced-motion:reduce){.lk-tw,#lk-load .lk-psloop svg{animation:none}}`;
// the sloop (viewBox 140 × 130, facing the way she sails), her wake, and Tessie behind her (x < 0: outside the box, the svg's
// overflow shows her), surfacing through the waterline (y 113) under a clip. Owner, 2026-11-17: Tessie as tall as the sloop: her
// head at its highest 111 units over the waterline, the masthead's height (the silhouette's 9.3 units × 12)
export const VOYAGE_SVG = `<svg viewBox="0 0 140 130"><defs><clipPath id="lk-twc"><rect x="-440" y="-80" width="440" height="193"/></clipPath></defs>`
  + `<path class="k" d="M-6 116h-14M-40 119h-22M-90 116h-18M-150 119h-22M-215 116h-18M-285 119h-22M-350 116h-18M-410 119h-14"/>`
  + `<g clip-path="url(#lk-twc)"><g class="lk-tw"><g transform="translate(-26 -55) scale(-12 12)">`
  + `<path class="tb" style="stroke-width:.5" d="M10.6 14C10.3 10.5 9 7.6 7.2 6C5.8 4.8 3.6 4.7 2.2 5.6C1.2 6.3 1.3 7.4 2.6 7.6C4 7.8 5.3 8.3 5.9 9.6C6.5 11 6.8 12.6 6.9 14ZM12.4 14C13.2 9.8 15 8.4 16.6 8.4C18.4 8.4 20 10 20.8 14ZM23 14C23.6 11.2 24.6 10.2 25.6 10.2C26.8 10.2 27.6 11.4 28 14Z"/>`
  + `<path class="k" style="stroke-width:.22" d="M18 10l1.6 2.6M19 9.6l1.4 3M26.4 11l.9 2"/>`
  + `<circle class="gd" cx="14.6" cy="9.4" r=".75"/><circle class="gd" cx="16.6" cy="8.7" r=".8"/><circle class="gd" cx="18.6" cy="9.4" r=".75"/><circle class="gd" cx="25" cy="10.6" r=".65"/><circle class="gd" cx="26.6" cy="10.9" r=".6"/>`
  + `<circle cx="4.2" cy="6.3" r=".45" fill="rgb(var(--lk-cream))"/></g></g></g>`
  + `<g transform="scale(-1 1) translate(-140 0)"><path class="s" d="M 78 2 L 78 100 L 140 100 Q 124 54 78 2 Z"/><path class="s" d="M 70 22 L 8 100 L 58 100 Q 66 64 70 22 Z"/>`
  + `<path class="k" d="M78 30 L106 30M78 56 L124 56M78 80 L134 80M58 48 L44 52M60 72 L28 78"/>`
  + `<path class="h" d="M 0 108 H 140 L 134 124 H 24 Q 10 124 0 108 Z"/><path class="g" d="M8 114 H134"/></g></svg>`;

export const voyageBarHtml = () => `<div class="lk-line"><i class="lk-sailed"></i><span class="lk-psloop" aria-hidden="true">${VOYAGE_SVG}</span></div>`;

export function setVoyage(el, p) {
  if (!el?.style) return;
  const v = Math.min(1, Math.max(0, +p || 0));
  el.style.setProperty('--p', v.toFixed(4));
  const bar = el.getAttribute?.('role') === 'progressbar' ? el : el.closest?.('[role=progressbar]') ?? el.querySelector?.('[role=progressbar]');
  bar?.setAttribute?.('aria-valuenow', String(Math.round(v * 100)));
}
