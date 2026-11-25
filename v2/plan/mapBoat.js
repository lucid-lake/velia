// The boat on Plan's map: the boat dial's own drawing (the hull, the sails at the live trim, the boom, the rudder, the apparent-wind
// arrow, the no-go wedge, AWA and AWS), mounted in the chart's layer with the dial's glass, ring and ticks off, turned to the heading on
// the north-up map, its readings kept upright on a small glass chip under her; 70 px at the lake zoom to 130 px in a cove (owner, 2026-11-25:
// smaller than the mock's 110–200), the chip hidden under 80 px; port and starboard in muted glass tones, the words kept. One function, so the Coach's shared boat group replaces it in one place: setMapBoat(factory).
// TODO(coach): when the dials build lands, the default becomes the Coach's coachBoat({ svg, scale }) group (src/ui/captainView.js).
//   const b = mountMapBoat({ root, state })   root: the map's layer element; state(): the boat state (B.state)
//   b.place({ x, y, sizePx, headingDeg }), b.update(dt), b.destroy(), b.el
import { createCaptainView } from '../../src/ui/captainView.js';

export const MAP_BOAT = Object.freeze({ minPx: 70, maxPx: 130, chipPx: 80, pxPerScale: 340 });
// the boat's size for the map's scale (screen px per metre): the lake zoom's glance to a cove's every word
export const mapBoatPx = (pxPerM) => Math.max(MAP_BOAT.minPx, Math.min(MAP_BOAT.maxPx, MAP_BOAT.pxPerScale * (pxPerM || 0)));

const CSS = `
.lkp-boat{position:absolute;inset:0;z-index:3;pointer-events:none;overflow:hidden}
#lk-load .lkp-boat .lk-cv,.lkp-boat .lk-cv{position:absolute!important;right:auto!important;bottom:auto!important;left:0;top:0;transform-origin:50% 50%;will-change:transform;opacity:1!important;pointer-events:none!important;z-index:1!important;
  background:none!important;border:0!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.lkp-boat .lk-cv::after{display:none!important}
.lkp-boat .lk-cv .dial{background:none!important;border:0!important;box-shadow:none!important;overflow:visible!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
.lkp-boat .lk-cv .dial::before,.lkp-boat .lk-cv .dial::after,.lkp-boat .lk-cv .ring,.lkp-boat .lk-cv .tick,.lkp-boat .lk-cv .sect,.lkp-boat .lk-cv .bow{display:none!important}
.lkp-boat .lk-cv .hit{display:none}
.lkp-boat .lk-cv .inr{position:absolute!important;left:50%!important;top:50%!important;bottom:auto!important;right:auto!important;width:max-content;transform-origin:0 0;
  transform:rotate(calc(-1 * var(--hdg,0deg))) translate(-50%,var(--chip-dy,70px));padding:5px 10px 6px;border-radius:12px;
  background:var(--plan-gl-bg,rgba(18,22,32,.5));border:1px solid var(--plan-gl-edge,rgba(255,255,255,.18));color:rgb(var(--plan-gl-ink,244 240 232));
  -webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3)}
.lkp-boat .lk-cv[data-small] .inr{display:none!important}
.lkp-boat .lk-cv .inr{font-size:11px;padding:3px 8px 4px;border-radius:9px}
.lkp-boat .lk-cv .rw i,.lkp-boat .lk-cv .rw b,.lkp-boat .lk-cv .rw em{font-size:11px!important}
/* port and starboard muted for the map (owner, 2026-11-25: the red read too loud); TODO(glass): take --lk-port / --lk-stbd from the glass tokens when they land */
.lkp-boat{--lk-port:var(--plan-port,190 122 106);--lk-stbd:var(--plan-stbd,108 158 130)}
.lkp-boat .lk-cv .rw em.p,.lkp-boat .lk-cv .rw em.s{background:transparent!important;color:rgb(var(--plan-gl-ink,244 240 232))}
.lkp-boat .lk-cv .rw em.p{box-shadow:inset 0 0 0 1px rgb(var(--lk-port))}
.lkp-boat .lk-cv .rw em.s{box-shadow:inset 0 0 0 1px rgb(var(--lk-stbd))}
`;

function defaultBoat({ root, state }) {
  const doc = root.ownerDocument;
  if (!doc.getElementById('lkp-boat-css')) { const st = doc.createElement('style'); st.id = 'lkp-boat-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const host = doc.createElement('div'); host.className = 'lkp-boat'; root.appendChild(host);
  const cv = createCaptainView({ root: host, state, always: true, once: false, wedge: 'apparent', storage: null });
  const el = cv.el;
  return {
    el,
    place({ x, y, sizePx, headingDeg }) {
      el.style.width = el.style.height = `${sizePx}px`;
      el.style.setProperty('--lk-d', `${sizePx}px`);
      el.style.setProperty('--hdg', `${headingDeg.toFixed(1)}deg`);
      el.style.setProperty('--chip-dy', `${(sizePx * 0.42).toFixed(0)}px`);
      el.toggleAttribute('data-small', sizePx < MAP_BOAT.chipPx);
      el.style.transform = `translate(${(x - sizePx / 2).toFixed(1)}px,${(y - sizePx / 2).toFixed(1)}px) rotate(${headingDeg.toFixed(1)}deg)`;
    },
    update(dt) { try { cv.update(dt, { sinceUse: 0 }); } catch (e) { /* a missing field must not stop the map's frame */ } },
    destroy() { cv.dispose(); host.remove(); },
  };
}

let factory = defaultBoat;
export const mountMapBoat = (o) => factory(o);
// the Coach (dials build) replaces the drawing here; null restores the dial's teaching boat
export function setMapBoat(f) { factory = typeof f === 'function' ? f : defaultBoat; }
