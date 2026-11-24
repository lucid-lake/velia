// Cruise's one quiet line (moved unchanged out of passenger.js, Velia v2's Cruise, 2026-11-14: passenger.js reaches three.js,
// this does not, so v2 mounts the same line). passenger.js imports it and re-exports LANE.
//   const line = quietLine();  line.show(text, forMs); line.hide(); line.text; line.dispose()
import { ensureTokens } from '../../ui/tokens.js';

// One quiet line, bottom centre, in the subtitle's style with no panel (tokens.css; owner, 2026-11-07): its bottom at the edge gap +
// LANE.upPx. The bottom bar is gone (2026-11-11), so the lane is the edge gap itself (was 56 px above it).
export const LANE = { upPx: 0 };
export function quietLine() {
  const css = document.createElement('style');
  ensureTokens();   // the design tokens (src/ui/tokens.css)
  css.textContent = `.lk-chill{position:fixed;left:50%;bottom:calc(var(--lk-sab,0px) + var(--lk-edge-gap) + ${LANE.upPx}px);transform:translate(-50%,var(--lk-rise));z-index:var(--lk-z-hud);pointer-events:none;user-select:none;
    width:max-content;max-width:min(92vw,46em);text-align:center;box-sizing:border-box;
    padding:0;font-family:var(--lk-sub-font);font-weight:var(--lk-sub-w);font-size:calc(clamp(17px,min(3.4vh,3vw),38px) * var(--lk-sub-k));line-height:1.22;color:#fff;letter-spacing:var(--lk-sub-track);text-wrap:balance;
    -webkit-text-stroke:.1em rgb(var(--lk-shade) / .92);paint-order:stroke fill;text-shadow:0 .04em .12em rgb(var(--lk-shade) / .85),0 .06em .35em rgb(var(--lk-shade) / .6);   /* the subtitle's own look (tokens.css), no panel (owner, 2026-11-07) */
    opacity:0;transition:opacity 1.2s var(--lk-ease-out),transform 1.2s var(--lk-ease-out);
    -webkit-font-smoothing:antialiased}
  .lk-chill.in{opacity:1;transform:translate(-50%,0)}
  html.lk-m-cruise .lk-chart .opener{display:none!important}   /* no chart dial in Cruise, nor its round opener on a finger: the Locker's Chart opens the big chart */`;
  document.head.appendChild(css);
  const el = document.createElement('div'); el.className = 'lk-chill'; document.body.appendChild(el);
  let timer = 0;
  return {
    show(text, forMs = 0) { clearTimeout(timer); el.textContent = text; requestAnimationFrame(() => el.classList.add('in')); if (forMs) timer = setTimeout(() => el.classList.remove('in'), forMs); },
    hide() { clearTimeout(timer); el.classList.remove('in'); },
    get text() { return el.classList.contains('in') ? el.textContent : ''; },
    dispose() { el.remove(); css.remove(); },
  };
}
