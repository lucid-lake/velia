// The boat on Plan's map: the Coach's own drawing (src/ui/captainView.js coachBoat, the group the cockpit's Coach dial draws too): the
// hull, the sails at the live trim with their words when something needs doing, the boom, the rudder, the apparent-wind arrow with
// "feels N", the no-go wedge, windward and leeward; turned to the heading on the north-up map, every word kept upright; under her a
// small navy chip (the chart's own ink) with the point of sail, the tack, SPEED and WIND. 70 px at the lake zoom to 130 px in a cove (smaller than the
// mock's 110–200, 2026-11-25), words at 11 px, the chip folded under 80 px; port and starboard in muted tones, the words kept.
// One factory, so a later drawing replaces it in one place: setMapBoat(factory).
//   const b = mountMapBoat({ root, state })   root: the map's layer element; state(): the boat state (B.state)
//   b.place({ x, y, sizePx, headingDeg }), b.update(dt), b.destroy(), b.el
import { coachBoat, ensureCaptainCss, CAPTAIN } from '../../../src/ui/captainView.js';
import { luffAwaDeg, BOAT as BOAT_P } from '../../../src/sim/boat.js';
import { trimCue, steerCue, heelCue, tackOf, DIALS_V2 } from '../dialsV2.js';

export const MAP_BOAT = Object.freeze({ minPx: 70, maxPx: 130, chipPx: 80, pxPerScale: 340, wordPx: 11 });
// the boat's size for the map's scale (screen px per metre): the lake zoom's glance to a cove's every word
export const mapBoatPx = (pxPerM) => Math.max(MAP_BOAT.minPx, Math.min(MAP_BOAT.maxPx, MAP_BOAT.pxPerScale * (pxPerM || 0)));

const CSS = `
.lkp-boat{position:absolute;inset:0;z-index:3;pointer-events:none;overflow:hidden}
/* port and starboard muted on the map (2026-11-25): the map's own two, the cockpit keeps its own */
.lkp-boat{--lk-port:var(--lk-map-port,190 122 106);--lk-stbd:var(--lk-map-stbd,108 158 130)}
.lkp-cb{position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform;pointer-events:none}
/* the inner .lk-cv carries the Coach's own sheet; the page's dial rules (placement, the calm fade, the flat layout) never reach it here */
#lk-load .lkp-cb > .lk-cv{position:absolute!important;inset:0!important;left:0!important;top:0!important;right:auto!important;bottom:auto!important;width:100%!important;height:100%!important;
  opacity:1!important;visibility:visible!important;transform:none!important;pointer-events:none!important;z-index:auto!important;transition:none!important;
  border:0!important;outline:0!important;background:none!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
#lk-load .lkp-cb > .lk-cv::before,#lk-load .lkp-cb > .lk-cv::after{display:none!important}
.lkp-boat .lk-cv svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.lkp-boat .lk-cv svg text{transform-box:fill-box;transform-origin:center;transform:rotate(calc(-1 * var(--hdg,0deg)))}
#lk-load .lkp-cb .inr{position:absolute;left:50%;top:50%;bottom:auto;right:auto;width:max-content;display:flex;flex-direction:column;align-items:center;gap:1px;transform-origin:0 0;
  transform:rotate(calc(-1 * var(--hdg,0deg))) translate(-50%,var(--chip-dy,40px));padding:3px 8px 4px;border-radius:9px;font:500 11px/1.15 var(--lk-ui);font-variant-numeric:tabular-nums;
  background:rgb(var(--lk-brand-navy) / .78);border:1px solid rgb(var(--lk-cream) / .22);color:rgb(var(--lk-cream));
  -webkit-backdrop-filter:blur(14px) saturate(1.3);backdrop-filter:blur(14px) saturate(1.3)}
#lk-load .lkp-cb .rw{display:flex;align-items:baseline;gap:.35em;white-space:nowrap}
#lk-load .lkp-cb .rw i{font-style:normal;font-size:10px;letter-spacing:.14em;opacity:.7}
#lk-load .lkp-cb .rw b,#lk-load .lkp-cb .rw small{font-size:11px;font-weight:500;color:inherit}
#lk-load .lkp-cb .rw em{font-style:normal;font-size:10px;padding:.05em .4em;border-radius:.4em;background:transparent!important;color:inherit}
#lk-load .lkp-cb .rw em.p{box-shadow:inset 0 0 0 1px rgb(var(--lk-port))}
#lk-load .lkp-cb .rw em.s{box-shadow:inset 0 0 0 1px rgb(var(--lk-stbd))}
.lkp-cb[data-small] .inr .rw:not(.c1){display:none}
`;

function coachMapBoat({ root, state }) {
  const doc = globalThis.document;
  ensureCaptainCss();
  if (!doc.getElementById('lkp-boat-css')) { const st = doc.createElement('style'); st.id = 'lkp-boat-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const host = doc.createElement('div'); host.className = 'lkp-boat'; root.appendChild(host);
  const el = doc.createElement('div'); el.className = 'lkp-cb';
  el.innerHTML = '<div class="lk-cv coach"><svg viewBox="0 0 100 100" aria-hidden="true"></svg><div class="inr"><div class="rw c1"></div><div class="rw c2"></div><div class="rw c3"></div></div></div>';
  el.firstChild.style.setProperty('--cv-ink', String(CAPTAIN.on));
  host.appendChild(el);
  let size = 100, heelS = 0, t = 0;
  const coach = { pro: () => false, race: () => false, gybeAwaDeg: DIALS_V2.gybeAwaDeg, cues: (s, posId) => {
    heelS += ((s.heel ?? 0) * 180 / Math.PI - heelS) * 0.05;
    return { main: trimCue(s, 'main'), jib: trimCue(s, 'jib'), steer: steerCue(s, posId), heel: heelCue(heelS), tack: tackOf(s.trueWind?.angle ?? 0) };
  } };
  // the plan at the dial's full size, centred (the chip sits outside, under her); words at 11 px on screen
  const boat = coachBoat({ svg: el.querySelector('svg'), scale: () => ({ k: 0.62, at: 50, fs: (MAP_BOAT.wordPx * 100) / size }), coach, wedge: 'apparent',
    luffDeg: (s) => Math.round(luffAwaDeg(BOAT_P, s.leeway ?? 0)), rows: [...el.querySelectorAll('.rw')] });
  return {
    el, boat,
    place({ x, y, sizePx, headingDeg }) {
      if (sizePx !== size) { size = sizePx; boat.layout(); }
      el.style.width = el.style.height = `${sizePx}px`;
      el.style.setProperty('--hdg', `${headingDeg.toFixed(1)}deg`);
      el.style.setProperty('--chip-dy', `${(sizePx * 0.44).toFixed(0)}px`);
      el.toggleAttribute('data-small', sizePx < MAP_BOAT.chipPx);
      el.style.transform = `translate(${(x - sizePx / 2).toFixed(1)}px,${(y - sizePx / 2).toFixed(1)}px) rotate(${headingDeg.toFixed(1)}deg)`;
    },
    update(dt) { t += dt; const s = state(); if (!s) return; try { boat.draw(s, { t }); } catch (e) { /* a missing field must not stop the map's frame */ } },
    destroy() { host.remove(); },
  };
}

let factory = coachMapBoat;
export const mountMapBoat = (o) => factory(o);
// a later drawing replaces the map's boat here; null restores the Coach's
export function setMapBoat(f) { factory = typeof f === 'function' ? f : coachMapBoat; }

// the layer on the live chart (sail.js): the boat placed each frame while the map shows in play (the chart's own sloop glyph off then),
// her bow by the map's own direction (toClient of a point ahead), her size by the map's scale; nothing runs while the map is hidden
export function mountMapBoatLayer({ chart, host, state, shown = () => true }) {
  const root = chart?.el ?? host; if (!root) return null;
  let b = null, raf = 0, last = 0, own = true;
  const doc = globalThis.document, win = globalThis;
  function frame(now) {
    raf = win.requestAnimationFrame(frame);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0; last = now;
    const on = !!shown() && !!state();
    if (on === own) { own = !on; chart.setOwnBoat?.(own); }
    if (!on) { if (b) b.el.style.visibility = 'hidden'; return; }
    b ??= mountMapBoat({ root, state });
    const s = state(), r = root.getBoundingClientRect(), q = chart.toClient(s.x, s.z), ahead = chart.toClient(s.x + Math.sin(s.heading) * 100, s.z - Math.cos(s.heading) * 100);
    const pxPerM = Math.hypot(ahead.x - q.x, ahead.y - q.y) / 100, deg = (Math.atan2(ahead.x - q.x, -(ahead.y - q.y)) * 180) / Math.PI;
    b.el.style.visibility = '';
    b.place({ x: q.x - r.left, y: q.y - r.top, sizePx: mapBoatPx(pxPerM), headingDeg: deg });
    b.update(dt);
  }
  raf = win.requestAnimationFrame(frame);
  void doc;
  return { get boat() { return b; }, destroy() { win.cancelAnimationFrame(raf); b?.destroy(); chart.setOwnBoat?.(true); } };
}
