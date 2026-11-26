// The boat on the live map: a chart plotter's drawing, top-down and tidy. A hairline cream hull with a faint translucent fill, a short dashed
// amber heading line ahead of the bow and a short dotted wake along her real track (the course over ground); close in, the mast, the boom and the sails as thin lines at the live trim
// (each sail's curve on its own side, its leech in amber; the fill brighter amber while it needs trim), a hairline rudder and the true
// wind as a thin arrow with a small caps "WIND". At the lake zoom she collapses to the slim hull and the wake. Under her the point of
// sail, the speed and the wind in small letter-spaced caps on a navy halo (no plate: the map shows through), moved to another side of her
// or faded where they would sit on a name or a pin; the "WIND" label fades there too. Turned to the heading on the north-up map, every word upright.
// 70 px at the lake zoom to 130 px in a cove; the detail from 90 px.
// One factory, so a later drawing replaces it in one place: setMapBoat(factory).
//   const b = mountMapBoat({ root, state })   root: the map's layer element; state(): the boat state (B.state)
//   b.place({ x, y, sizePx, headingDeg, marks, at }), b.update(dt), b.destroy(), b.el
import { ensureTokens } from '../../../src/ui/tokens.js';
import { pointOfSail, pointLabel } from '../../../src/ui/pointOfSail.js';
import { clampT as clamp } from '../../../src/sim/core/math.js';
import { trimCue, heelCue } from '../dialsV2.js';

export const MAP_BOAT = Object.freeze({ minPx: 70, maxPx: 130, detailPx: 90, pxPerScale: 340, wordPx: 10 });
// the boat's size for the map's scale (screen px per metre): the lake zoom's glance to a cove's every line
export const mapBoatPx = (pxPerM) => Math.max(MAP_BOAT.minPx, Math.min(MAP_BOAT.maxPx, MAP_BOAT.pxPerScale * (pxPerM || 0)));

const KN = 1.943844, DEG = Math.PI / 180;
const f1 = (v) => (+v).toFixed(1);
// the plan (viewBox 0 0 100 100, bow up, centre 50 50): 60 long, 19 wide, a fine entry and a square transom; the mast 40 % aft of the bow
const HULL_D = 'M50 20 C57.5 31 59.6 46 59.4 60 C59.2 69 57.4 77 54.6 80 L45.4 80 C42.6 77 40.8 69 40.6 60 C40.4 46 42.5 31 50 20 Z';
const BOW = [50, 21.5], MAST = [50, 44], STERN = [50, 80], BOOM = 30, JIB = 24, HALF = 30;
// the plan's scale (of the viewBox) for the boat's box: a slim glyph at the lake zoom, the whole rig in a cove
const planK = (px) => 0.42 + 0.2 * clamp((px - MAP_BOAT.minPx) / (MAP_BOAT.maxPx - MAP_BOAT.minPx), 0, 1);

// a sail as a thin curve from `from`, its chord L long at angle a (rad, + to starboard, 0 = dead aft), bellied to its own side by its
// fill (flat when stalled); luffing, the curve ripples about the chord. Returns the curve, the closed panel and the clew.
function sailLine(from, L, a, { fill = 1, stall = 0, t = 0 }) {
  const dx = Math.sin(a), dy = Math.cos(a), nx = Math.cos(a), ny = -Math.sin(a), side = a >= 0 ? 1 : -1;
  const luff = 1 - clamp(fill, 0, 1), belly = 6.5 * clamp(fill, 0, 1) * (1 - 0.8 * clamp(stall, 0, 1));
  const cur = [];
  for (let i = 0; i <= 10; i++) {
    const q = i / 10, hump = Math.sin(q * Math.PI);
    const w = (luff < 0.15 ? 0 : Math.sin(q * Math.PI * 3 - t * 14) * 2 * luff * hump) + side * (belly * (1 - luff) + 1) * Math.sqrt(hump);
    cur.push(`${i ? 'L' : 'M'}${f1(from[0] + dx * L * q + nx * w)} ${f1(from[1] + dy * L * q + ny * w)}`);
  }
  const clew = [from[0] + dx * L, from[1] + dy * L], curve = cur.join('');
  return { curve, panel: `${curve}L${f1(from[0])} ${f1(from[1])}Z`, clew };
}

const CSS = `
.lkp-boat{position:absolute;inset:0;z-index:3;pointer-events:none;overflow:hidden}
.lkp-cb{position:absolute;left:0;top:0;transform-origin:50% 50%;will-change:transform;pointer-events:none}
.lkp-cb svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.lkp-cb svg *{vector-effect:non-scaling-stroke}
.lkp-cb .hull{fill:rgb(var(--lk-cream) / .1);stroke:rgb(var(--lk-cream) / .95);stroke-width:1.2px;stroke-linejoin:round}
.lkp-cb .hl{fill:none;stroke:rgb(var(--lk-cream) / .32);stroke-width:.8px}
.lkp-cb .ln{fill:none;stroke:rgb(var(--lk-cream) / .9);stroke-width:1.1px;stroke-linecap:round}
.lkp-cb .boom{stroke-width:1.5px}
.lkp-cb .mast{fill:rgb(var(--lk-cream));stroke:none}
.lkp-cb .panel{fill:rgb(var(--lk-amber) / .1);stroke:none;transition:fill .3s}
.lkp-cb .panel.warn{fill:rgb(var(--lk-amber) / .34)}
.lkp-cb .leech{fill:none;stroke:rgb(var(--lk-amber) / .95);stroke-width:1.2px;stroke-linecap:round;stroke-linejoin:round}
.lkp-cb .wake{fill:rgb(var(--lk-cream) / .75)}
.lkp-cb .hdg{fill:none;stroke:rgb(var(--lk-amber) / .85);stroke-width:1.1px;stroke-dasharray:2.5 2.5;stroke-linecap:round}
.lkp-cb .wind{fill:none;stroke:rgb(var(--lk-cream) / .7);stroke-width:1px;stroke-linecap:round;stroke-linejoin:round}
.lkp-cb .wl{font:500 8px var(--lk-ui);letter-spacing:.16em;fill:rgb(var(--lk-cream) / .72);paint-order:stroke;stroke:rgb(var(--lk-brand-navy) / .8);stroke-width:2.4px;stroke-linejoin:round;vector-effect:none;
  transform-box:fill-box;transform-origin:center;transform:rotate(calc(-1 * var(--hdg,0deg)));transition:opacity .25s}
.lkp-cb .dt{display:none}
.lkp-cb[data-detail] .dt{display:inline}
.lkp-cb .inr{position:absolute;left:50%;top:50%;width:max-content;display:flex;flex-direction:column;align-items:center;gap:2px;transform-origin:0 0;
  transform:rotate(calc(-1 * var(--hdg,0deg))) translate(var(--chip-dx,-50%),var(--chip-dy,40px));font:500 ${MAP_BOAT.wordPx}px/1.1 var(--lk-ui);font-variant-numeric:tabular-nums;
  text-transform:uppercase;letter-spacing:.14em;color:rgb(var(--lk-cream) / .94);opacity:var(--chip-a,1);transition:opacity .25s;
  paint-order:stroke fill;-webkit-text-stroke:2.6px rgb(var(--lk-brand-navy) / .82);text-shadow:0 0 3px rgb(var(--lk-brand-navy) / .6)}
.lkp-cb .rw{white-space:nowrap}
.lkp-cb .rw i{font-style:normal;opacity:.66}
.lkp-cb .rw.c2{font-size:${MAP_BOAT.wordPx - 1}px}
`;

function chartMapBoat({ root, state }) {
  const doc = globalThis.document;
  ensureTokens(doc);
  if (!doc.getElementById('lkp-boat-css')) { const st = doc.createElement('style'); st.id = 'lkp-boat-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const host = doc.createElement('div'); host.className = 'lkp-boat'; root.appendChild(host);
  const el = doc.createElement('div'); el.className = 'lkp-cb';
  el.innerHTML = `<svg viewBox="0 0 100 100" aria-hidden="true">
    <g class="wk"></g><path class="hdg" d=""/>
    <g class="dt"><path class="wind" d=""/><text class="wl" text-anchor="middle" dominant-baseline="middle">WIND</text></g>
    <g class="plan">
      <path class="hull" d="${HULL_D}"/>
      <g class="dt"><path class="hl" d="M45.5 62 L54.5 62 L54.5 76 L45.5 76 Z"/>
      <path class="ln rud" d=""/>
      <path class="panel jp" d=""/><path class="leech jl" d=""/>
      <path class="panel mp" d=""/><path class="ln boom" d=""/><path class="leech ml" d=""/>
      <circle class="mast" cx="${MAST[0]}" cy="${MAST[1]}" r="1.6"/></g>
    </g></svg><div class="inr"><div class="rw c1"></div><div class="rw c2"></div></div>`;
  host.appendChild(el);
  const q = (c) => el.querySelector(c);
  const hdg = q('.hdg'), inr = q('.inr'), plan = q('.plan'), wk = q('.wk'), wind = q('.wind'), wl = q('.wl'), rud = q('.rud');
  const mp = q('.mp'), ml = q('.ml'), boom = q('.boom'), jp = q('.jp'), jl = q('.jl'), rows = [q('.c1'), q('.c2')];
  const cgWords = [wl];
  const dots = Array.from({ length: 6 }, () => { const c = doc.createElementNS('http://www.w3.org/2000/svg', 'circle'); c.setAttribute('class', 'wake'); wk.appendChild(c); return c; });
  let size = 0, K = planK(100), detail = true, side = 'below', t = 0, heelS = 0, posId = null;
  const setH = (n, h) => { if (n._h !== h) { n._h = h; n.innerHTML = h; } };
  const toBox = (p) => [50 + (p[0] - 50) * K, 50 + (p[1] - 50) * K];   // a plan point in the box's units
  function draw(s) {
    const twa = s.trueWind?.angle ?? 0, sogKn = (s.sog ?? 0) * KN;
    // the wake: dots astern along the real track (the course over ground against the heading), more with speed, fading aft
    const d = (s.cog ?? s.heading ?? 0) - (s.heading ?? 0), ax = -Math.sin(d), ay = Math.cos(d), u = 100 / size;   // px → box units
    const [sx, sy] = toBox(STERN), n = Math.round(clamp(sogKn / 1.2, 0, dots.length));
    dots.forEach((c, i) => {
      if (i >= n) { c.setAttribute('r', '0'); return; }
      const k = (5 + i * 4.5) * u; c.setAttribute('cx', f1(sx + ax * k)); c.setAttribute('cy', f1(sy + ay * k));
      c.setAttribute('r', ((1 - i / (dots.length + 1)) * 1.25 * u).toFixed(2)); c.style.opacity = (1 - i / (dots.length + 0.5)).toFixed(2);
    });
    if (detail) {
      const main = sailLine(MAST, BOOM, s.boomAngle ?? 0, { fill: s.mainFill ?? 1, stall: s.mainStall ?? 0, t });
      const jib = sailLine(BOW, JIB, s.jibAngle ?? 0, { fill: s.jibFill ?? 1, stall: s.jibStall ?? 0, t });
      mp.setAttribute('d', main.panel); ml.setAttribute('d', main.curve); jp.setAttribute('d', jib.panel); jl.setAttribute('d', jib.curve);
      boom.setAttribute('d', `M${MAST[0]} ${MAST[1]}L${f1(main.clew[0])} ${f1(main.clew[1])}`);
      heelS += ((s.heel ?? 0) / DEG - heelS) * 0.05;
      mp.classList.toggle('warn', trimCue(s, 'main').state !== 'draw' || heelCue(heelS)); jp.classList.toggle('warn', trimCue(s, 'jib').state !== 'draw');
      const ra = Math.sign(s.rudderAngle ?? 0) * 25 * DEG * Math.pow(Math.min(1, Math.abs(s.rudderAngle ?? 0) / (25 * DEG)), 0.6);
      rud.setAttribute('d', `M${STERN[0]} ${STERN[1]}L${f1(STERN[0] + 8 * Math.sin(ra))} ${f1(STERN[1] + 8 * Math.cos(ra))}`);
      // the true wind: a thin arrow from the side it comes from, its head short of the rig, "WIND" at its tail
      const wx = Math.sin(twa), wy = -Math.cos(twa), r0 = HALF * K + 4, r1 = r0 + 15, px = -wy, py = wx;
      const hx = 50 + wx * r0, hy = 50 + wy * r0;
      wind.setAttribute('d', `M${f1(50 + wx * r1)} ${f1(50 + wy * r1)}L${f1(hx)} ${f1(hy)}M${f1(hx + wx * 3.2 + px * 2.2)} ${f1(hy + wy * 3.2 + py * 2.2)}L${f1(hx)} ${f1(hy)}L${f1(hx + wx * 3.2 - px * 2.2)} ${f1(hy + wy * 3.2 - py * 2.2)}`);
      wl.setAttribute('x', f1(50 + wx * (r1 + 6))); wl.setAttribute('y', f1(50 + wy * (r1 + 6)));
    }
    posId = pointOfSail(twa / DEG, posId);
    setH(rows[0], pointLabel(posId));
    setH(rows[1], `${sogKn.toFixed(1)} <i>kn</i> · <i>wind</i> ${Math.round((s.trueWind?.speed ?? 0) * KN)} <i>kn</i>`);
  }
  return {
    el,
    // the words' side: under her (default), above, right or left of her, or faded (0.3) where every side would cover a name or a pin; marks: client-px boxes
    // [x0, y0, x1, y1] of what the map shows; at: her centre in client px. Keeps its side while that side is clear (no flicker)
    place({ x, y, sizePx, headingDeg, marks = null, at = null }) {
      if (sizePx !== size) {
        size = sizePx; K = planK(sizePx); detail = sizePx >= MAP_BOAT.detailPx;
        plan.setAttribute('transform', `translate(50 50) scale(${K.toFixed(3)}) translate(-50 -50)`);
        el.toggleAttribute('data-detail', detail);
        wl.setAttribute('font-size', f1((8 * 100) / sizePx));   // 8 px on screen
      }
      el.style.width = el.style.height = `${sizePx}px`;
      const bowY = 50 - HALF * K, u = 100 / sizePx;   // the heading: a short dashed amber line ahead of the bow, 14 px (close in 22 px)
      hdg.setAttribute('d', `M50 ${f1(bowY - 2 * u)}L50 ${f1(bowY - (detail ? 22 : 14) * u)}`);
      el.style.setProperty('--hdg', `${headingDeg.toFixed(1)}deg`);
      const reach = HALF * K * sizePx / 100 + (detail ? 10 : 6), w = inr.offsetWidth, h = inr.offsetHeight;   // just past the hull
      // the box's top-left from her centre, each side; the first clear one in this order, the current one kept while it stays clear
      const at0 = { below: [-w / 2, reach], above: [-w / 2, -reach - h], right: [reach, -h / 2], left: [-reach - w, -h / 2] };
      const clear = (k) => { const [ox, oy] = at0[k]; return !marks || !at || !marks.some((m) => at.x + ox + w > m[0] && at.x + ox < m[2] && at.y + oy + h > m[1] && at.y + oy < m[3]); };
      if (!clear(side)) side = Object.keys(at0).find(clear) ?? 'below';
      const a = clear(side) ? 1 : 0.3;
      el.style.setProperty('--chip-dx', `${at0[side][0].toFixed(0)}px`);
      el.style.setProperty('--chip-dy', `${at0[side][1].toFixed(0)}px`);
      el.style.setProperty('--chip-a', String(a));
      el.dataset.words = a < 1 ? 'faded' : side;
      // the "WIND" label fades the same way where it sits on a name or a pin
      for (const tx of cgWords) {
        if (!marks || !detail) { tx.style.opacity = ''; continue; }
        const r = tx.getBoundingClientRect(), hit = r.width > 0 && marks.some((m) => r.right > m[0] && r.left < m[2] && r.bottom > m[1] && r.top < m[3]);
        tx.style.opacity = hit ? '0.2' : '';
      }
      el.style.transform = `translate(${(x - sizePx / 2).toFixed(1)}px,${(y - sizePx / 2).toFixed(1)}px) rotate(${headingDeg.toFixed(1)}deg)`;
    },
    update(dt) { t += dt; const s = state(); if (!s) return; try { draw(s); } catch (e) { /* a missing field must not stop the map's frame */ } },
    destroy() { host.remove(); },
  };
}

let factory = chartMapBoat;
export const mountMapBoat = (o) => factory(o);
// a later drawing replaces the map's boat here; null restores the chart's own
export function setMapBoat(f) { factory = typeof f === 'function' ? f : chartMapBoat; }

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
    b.place({ x: q.x - r.left, y: q.y - r.top, sizePx: mapBoatPx(pxPerM), headingDeg: deg, marks: chart.marks?.() ?? null, at: q });
    b.update(dt);
  }
  raf = win.requestAnimationFrame(frame);
  void doc;
  return { get boat() { return b; }, destroy() { win.cancelAnimationFrame(raf); b?.destroy(); chart.setOwnBoat?.(true); } };
}
