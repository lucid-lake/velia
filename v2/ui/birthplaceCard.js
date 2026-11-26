// The card's mini chart: where a sail starts (Phase 1b; v2/sim/birthplace.js is the service). The five birthplaces are pins on
// the card's engraved chart (cream ink, no chips, no boxes for the names). The chosen
// one is lit (brass, the sloop on it, bobbing). The voyage line under the title reads "Emerald Bay · Halcyon 28 ft · <the place> ›".
//   the first card (data-state home)   a pin picks (service.pick): she is moved there behind the loading shell (main.js); Sail enters
//   the Menu card in play (data-state menu)   a pin is service.moveTo, the veil; the card closes so the move is seen. A phone card
//                                      (feature phoneCard) asks twice: the first tap shows the name and its line and offers
//                                      "Sail from here", the second tap on the same pin (or that button) moves her
//   hover or focus   the name lifts and its one line shows; on a finger the line shows for the pin tapped last
//   keyboard   each pin is a button (Tab, Enter or Space); the voyage line's place word focuses the lit pin
// A refusal (a race, knocked down) shows its reason in plain words in the same line. Reduced motion: no bob, no ring.
// The desktop card (no phoneCard; owner 2026-11-18): the box is the card's mini chart, larger, in the sheet's own column between the studio line
// and the voyage line (its caption). The chart is the real shoreline of the bay (v2/ui/miniChartData.js, baked by tools/v2-minichart-bake.mjs
// from the planner's grid) drawn in the engraved manner, in the world's metres: each pin stands at its birthplace's x, z, so Fannette Island
// is the island at (0, 0) with Off Fannette (Tessie's tiny logo on its pin) east of it and Vikingsholm at the head. A short frame falls back to the row.
//   const m = mountBirthplaceCard(root, { service, home, touch: () => bool }); m.paint(); m.dispose()

import { edgePoint, farName } from './chart/edge.js';   // a pin past the mini chart's window at its edge (none of today's table)
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { birthplaceRows } from '../sim/regions.js';
import { tessieGlyphSvg } from './chart/tessieGlyph.js';   // Tessie's tiny logo on a pin that carries her flag (Off Fannette)

export const REFUSALS = Object.freeze({
  race: 'Not during a race. Finish or leave it first.',
  knockdown: 'Get her upright first.',
  moving: 'One move at a time.',
  unknown: 'That place is not on the chart.',
});
// the desktop chart's window in the world's metres (x0, z0, width, height; x east, z south, Fannette's summit 0, 0), framed on every
// birthplace of the region table (owner, 2026-11-24: the default view includes the new birthplace): 900 m round them east and west for the
// names, at least 700 m north and south (and 7 % of the width: a pin's name keeps its room when the pins run far north, as Rubicon Point's),
// no flatter than 2.4 : 1, on a 100 m grid. The bake (tools/v2-minichart-bake.mjs) reads it
export function miniBoxOf(rows) {
  const pts = rows.filter((r) => Number.isFinite(r.x) && Number.isFinite(r.z));
  if (!pts.length) return Object.freeze([-900, -1800, 3500, 2700]);
  const xs = pts.map((r) => r.x), zs = pts.map((r) => r.z), r100 = (v) => Math.round(v / 100) * 100;
  const x0 = r100(Math.min(...xs) - 900), x1 = r100(Math.max(...xs) + 900), w = x1 - x0;
  const zc = (Math.min(...zs) + Math.max(...zs)) / 2, h = r100(Math.max(Math.max(...zs) - Math.min(...zs) + 2 * Math.max(700, 0.07 * w), w / 2.4));
  return Object.freeze([x0, r100(zc - h / 2), w, h]);
}
export const MINI_BOX = miniBoxOf(birthplaceRows(CURRENT_WATERS));
// where a pin's name sits on the desktop chart (r right, l left, br below and to the right), clear of its neighbours at the chart's scale
const DESK_SIDE = { vikingsholm: 'l', fannette: 'br', narrows: 'r', lake: 'r', 'ski-run': 'l' };   // Off Ski Run: near the east edge, its name inward
// the pins' places in the box, percent of its width and height: a loose chart of the bay (west left, north up), not a survey
const SPOT = {
  vikingsholm: [9, 74, 'r'], fannette: [34, 56, 'r'], narrows: [64, 30, 'r'], lake: [50, 8, 'r'],
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SLOOP = '<g transform="scale(-.2 .2) translate(-70 -122)"><path class="s" d="M 78 2 L 78 100 L 140 100 Q 124 54 78 2 Z"/><path class="s" d="M 70 22 L 8 100 L 58 100 Q 66 64 70 22 Z"/><path class="h" d="M 0 108 H 140 L 134 124 H 24 Q 10 124 0 108 Z"/></g>';
const GLYPH = `<svg class="g" viewBox="-22 -36 44 48" aria-hidden="true"><g class="sl"><g class="bob" transform="translate(0 -5)">${SLOOP}</g></g><circle class="ring" r="6.2"/><circle class="dot" r="2.2"/></svg>`;

const CSS = `#lk-load .lk-bp{position:absolute;z-index:3;left:1.6em;right:1.6em;display:none;pointer-events:none}
#lk-load[data-state=home]:not([data-pg]) .lk-bp,#lk-load[data-state=menu]:not([data-pg]) .lk-bp{display:block}
#lk-load[data-state=menu]:not([data-pg]) .lk-card:has(.lk-bp) .lk-course-g,#lk-load[data-state=home]:not([data-pg]) .lk-card:has(.lk-bp) .lk-course-g{opacity:0;transition:opacity .5s var(--lk-ease)}
#lk-load .lk-bp-pin{all:unset;box-sizing:border-box;position:absolute;left:var(--x);top:var(--y);width:44px;height:44px;margin:-22px 0 0 -22px;display:flex;align-items:center;justify-content:center;cursor:pointer;pointer-events:auto;
  color:var(--navy);-webkit-tap-highlight-color:transparent}
#lk-load .lk-bp-pin .g{position:absolute;left:50%;top:50%;width:44px;height:48px;margin:-30px 0 0 -22px;overflow:visible;pointer-events:none}
#lk-load .lk-bp-pin .ring{fill:var(--paper);stroke:currentColor;stroke-width:1.5;opacity:.86;transition:r .25s var(--lk-ease),opacity .25s}
#lk-load .lk-bp-pin .dot{fill:currentColor;opacity:.9}
#lk-load .lk-bp-pin .sl{opacity:0;transition:opacity .35s var(--lk-ease)}
#lk-load .lk-bp-pin .s{fill:var(--sail);stroke:var(--navy);stroke-width:9;stroke-linejoin:round}
#lk-load .lk-bp-pin .h{fill:var(--navy);stroke:var(--navy);stroke-width:6;stroke-linejoin:round}
#lk-load .lk-bp-pin .bob{animation:lk-bob 3.6s ease-in-out infinite;transform-box:view-box}
#lk-load .lk-bp-pin[aria-pressed=true]{color:var(--brass)}
#lk-load .lk-bp-pin[aria-pressed=true] .ring{fill:var(--brass);stroke:var(--brass);opacity:1}
#lk-load .lk-bp-pin[aria-pressed=true] .dot{fill:var(--paper)}
#lk-load .lk-bp-pin[aria-pressed=true] .sl{opacity:1}
#lk-load .lk-bp-pin:hover .ring,#lk-load .lk-bp-pin:focus-visible .ring{r:8;opacity:1}
#lk-load .lk-bp-pin:focus-visible{outline:2px solid var(--navy);outline-offset:-4px;border-radius:50%}
#lk-load .lk-bp-pin .n{position:absolute;top:50%;transform:translateY(-50%);white-space:nowrap;font:italic var(--lk-book) max(.82em,12px)/1 var(--lk-font);letter-spacing:.04em;color:var(--navy);opacity:.66;transition:opacity .2s;text-shadow:0 0 .5em var(--paper),0 0 .2em var(--paper)}
#lk-load .lk-bp-pin .n .tg{display:inline-block;vertical-align:-1px;margin-left:.5em;opacity:.8}
#lk-load .lk-bp.row .lk-bp-pin .n .tg{display:block;margin:2px auto 0}
#lk-load .lk-bp-pin[data-side=r] .n{left:calc(50% + 11px)}
#lk-load .lk-bp-pin[data-side=l] .n{right:calc(50% + 11px)}
#lk-load .lk-bp-pin:hover .n,#lk-load .lk-bp-pin:focus-visible .n{opacity:.94}
#lk-load .lk-bp-pin[aria-pressed=true] .n{opacity:1;color:var(--brass)}
#lk-load .lk-bp-pin[data-side=r][aria-pressed=true] .n{left:calc(50% + 20px)}
#lk-load .lk-bp-say{position:absolute;left:.2em;right:.2em;bottom:0;margin:0;min-height:2.5em;font:italic var(--lk-book) max(.86em,12.5px)/1.25 var(--lk-font);letter-spacing:.02em;color:var(--navy);opacity:.9;pointer-events:none}
#lk-load .lk-bp-say b{font-weight:var(--lk-medium);font-style:normal;letter-spacing:.06em}
#lk-load .lk-bp-say[data-warn]{color:var(--brass)}
#lk-load .lk-bp-say .go{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;min-height:44px;padding:0 .9em;margin-left:.6em;border:1px solid var(--brass);border-radius:999px;color:var(--brass);font-style:normal;cursor:pointer;pointer-events:auto}
/* a short frame (no room for a loose chart): one row of pins, the names under them */
#lk-load .lk-bp.row .lk-bp-pin{position:relative;left:auto;top:auto;margin:0;flex:1 1 0;min-width:44px;height:auto;min-height:44px;flex-direction:column;justify-content:flex-start;padding-top:22px}
#lk-load .lk-bp.row{display:none}
#lk-load[data-state=home]:not([data-pg]) .lk-bp.row,#lk-load[data-state=menu]:not([data-pg]) .lk-bp.row{display:flex;align-items:flex-start;gap:0}
#lk-load .lk-bp.row .lk-bp-pin .g{top:8px;margin-top:-4px}
#lk-load .lk-bp.row .lk-bp-pin .n{position:static;transform:none;margin-top:3px;font-size:max(.78em,11px)}
#lk-load .lk-bp.row .lk-bp-say{display:none}
#lk-load .lk-bp.row[data-say] .lk-bp-pin .n{opacity:0}
#lk-load .lk-bp.row[data-say] .lk-bp-say{display:block;top:calc(100% - 2.4em);bottom:auto;text-align:center}
#lk-load .lk-sum .v.p{cursor:pointer}
/* the desktop card's chart (owner 2026-11-18): in the sheet's column, the plate fitted to the chart's own aspect and centred in what the column leaves */
#lk-load .lk-bp.flow{position:relative;left:auto;right:auto;top:auto;bottom:auto;height:auto;order:3;flex:1 1 0;min-height:0;align-self:stretch;margin:.7em 0 .15em}
#lk-load .lk-bp-plate,#lk-load .lk-bp-lbl{display:none}
#lk-load .lk-bp.chart .lk-bp-plate{display:block;position:absolute;left:var(--ox);top:var(--oy);width:var(--fw);height:var(--fh);box-sizing:border-box;overflow:hidden;pointer-events:none;
  border:1px solid rgb(var(--ink3) / .6);border-radius:4px;background:rgb(var(--pan));box-shadow:inset 0 0 0 4px rgb(var(--pan)),inset 0 0 0 5px rgb(var(--ink3) / .26)}
#lk-load .lk-bp-plate svg{position:absolute;inset:0;width:100%;height:100%;display:block;overflow:hidden}
#lk-load .lk-bp-plate .land{fill:rgb(var(--ink3) / .09);fill-rule:evenodd;stroke:none}
#lk-load .lk-bp-plate .hat{fill:url(#lk-bp-h);fill-rule:evenodd;stroke:none}
#lk-load .lk-bp-plate .coast{fill:none;fill-rule:evenodd;stroke:rgb(var(--ink3) / .9);stroke-width:1.15px;stroke-linejoin:round;vector-effect:non-scaling-stroke}
#lk-load .lk-bp-plate .ring{fill:none;stroke:rgb(var(--ink3));stroke-width:.75px;stroke-linejoin:round;vector-effect:non-scaling-stroke}
#lk-load .lk-bp.chart .lk-bp-pin{left:calc(var(--ox) + var(--ux) * var(--fw));top:calc(var(--oy) + var(--uy) * var(--fh))}
#lk-load .lk-bp.chart .lk-bp-lbl{display:block;position:absolute;z-index:1;left:calc(var(--ox) + var(--ux) * var(--fw));top:calc(var(--oy) + var(--uy) * var(--fh));pointer-events:none;white-space:nowrap;color:var(--navy);
  font:italic var(--lk-book) max(.82em,12px)/1 var(--lk-font);letter-spacing:.04em;opacity:.58;transform:translate(-50%,-100%);text-shadow:0 0 .5em var(--paper),0 0 .2em var(--paper)}
#lk-load .lk-bp.chart .lk-bp-pin[data-side=br] .n,#lk-load .lk-bp.chart .lk-bp-pin[data-side=br][aria-pressed=true] .n{left:calc(50% + 5px);top:calc(50% + 12px);transform:none}
#lk-load .lk-bp.chart .lk-bp-say{left:var(--ox);right:auto;width:var(--fw);bottom:var(--oy);box-sizing:border-box;min-height:0;padding:1.5em .9em .55em;background:linear-gradient(transparent,rgb(var(--pan) / .97) 46%);border-radius:0 0 4px 4px;opacity:0;transition:opacity .2s}
#lk-load .lk-bp.chart[data-say] .lk-bp-say{opacity:1}
@media (prefers-reduced-motion:reduce){#lk-load .lk-bp-pin .bob{animation:none}#lk-load .lk-bp-pin .ring,#lk-load .lk-bp-pin .sl,#lk-load .lk-bp-pin .n{transition:none}}`;

export function mountBirthplaceCard(root, { service, home = null, touch = () => false, doc = globalThis.document } = {}) {
  const card = root?.querySelector?.('.lk-card');
  if (!card || !service || card.querySelector('.lk-bp')) return null;
  if (!doc.getElementById('lk-bp-css')) { const s = doc.createElement('style'); s.id = 'lk-bp-css'; s.textContent = CSS; doc.head.appendChild(s); }
  const win = doc.defaultView ?? globalThis;
  // the voyage line: "Emerald Bay · Halcyon 28 ft · Off Fannette ›" (src/ui/home.js voyage option adds the words; the span is here)
  const sum = card.querySelector('.lk-sum');
  const vessel = sum?.querySelector('[data-v=vessel]');
  if (vessel && !sum.querySelector('[data-v=place]')) {
    const dot = doc.createElement('span'); dot.className = 'dot'; dot.setAttribute('aria-hidden', 'true'); dot.textContent = ' · '; dot.hidden = true;
    const place = doc.createElement('span'); place.className = 'v b p'; place.dataset.v = 'place'; place.hidden = true;
    vessel.after(dot, place);
  }
  const box = doc.createElement('div'); box.className = 'lk-bp'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Where to start');
  const rows = service.list();
  const spots = rows.map((r, i) => SPOT[r.id] ?? [10 + (80 * i) / Math.max(1, rows.length - 1), 20 + (i % 3) * 20, 'r']);
  // the desktop card: the chart in the sheet's column; a pin's place is its birthplace's x, z in the chart's window (--ux, --uy: 0 to 1)
  const desk = !touch() && !!card.querySelector('.lk-sheet');
  const [bx, bz, bw, bh] = MINI_BOX, mbox = { x0: bx, z0: bz, x1: bx + bw, z1: bz + bh };
  // a pin past the window (a region added without a rebake) stands at the window's edge toward it, its name with ›
  const edge = (r) => (Number.isFinite(r.x) && Number.isFinite(r.z) ? edgePoint(r.x, r.z, mbox, 0.06 * bw) : { far: false });
  const unit = (r, i) => { const e = edge(r); return e.x != null ? [(e.x - bx) / bw, (e.z - bz) / bh] : [spots[i][0] / 100, spots[i][1] / 100]; };
  const nameOf = (r) => (desk && edge(r).far ? farName(r.name) : r.name);
  const lbl = (cls, text, x, z) => `<span class="lk-bp-lbl ${cls}" aria-hidden="true" style="--ux:${(x - bx) / bw};--uy:${(z - bz) / bh}">${text}</span>`;
  box.innerHTML = (desk ? '<div class="lk-bp-plate" aria-hidden="true"></div>' + lbl('isl', 'Fannette Island', 0, -70) : '')
    + rows.map((r, i) => { const u = unit(r, i); return `<button class="lk-bp-pin" type="button" data-id="${esc(r.id)}" data-side="${desk ? DESK_SIDE[r.id] ?? spots[i][2] : spots[i][2]}" style="--x:${spots[i][0]}%;--y:${spots[i][1]}%;--ux:${u[0].toFixed(4)};--uy:${u[1].toFixed(4)}" aria-pressed="false" aria-label="${esc(r.name)}${r.mark ? ", Tessie's water" : ''}. ${esc(r.why)}">${GLYPH}<span class="n">${esc(nameOf(r))}${r.mark ? tessieGlyphSvg('tg') : ''}</span></button>`; }).join('')
    + '<p class="lk-bp-say" role="status" aria-live="polite"></p>';
  if (desk) { box.classList.add('flow'); const sheet = card.querySelector('.lk-sheet'); sheet.insertBefore(box, sheet.querySelector('.lk-plan')); } else card.appendChild(box);
  const plate = box.querySelector('.lk-bp-plate');
  { const ver = desk ? card.querySelector('.lk-ver') : null, m = /([\d.]+)/.exec(ver?.firstChild?.textContent ?? ''); if (ver && m) { ver.dataset.short = `v${m[1]}`; ver.setAttribute('aria-label', `What\u2019s new in v${m[1]}`); } }   // the desktop row's version alone: "v0.7" (the words stay in the DOM)
  let hatch = null;
  if (plate) import('./miniChartData.js').then(({ MINI }) => {
    if (!box.isConnected) return;
    plate.innerHTML = `<svg viewBox="${MINI.box.join(' ')}" preserveAspectRatio="none" focusable="false"><defs><pattern id="lk-bp-h" patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="4" style="stroke:rgb(var(--ink3) / .24);stroke-width:.9"/></pattern></defs>`
      + MINI.rings.map((d, k) => `<path class="ring" style="opacity:${[0.4, 0.26, 0.15][k] ?? 0.12}" d="${d}"/>`).reverse().join('')
      + `<path class="land" d="${MINI.coast}"/><path class="hat" d="${MINI.coast}"/><path class="coast" d="${MINI.coast}"/></svg>`;
    hatch = plate.querySelector('pattern'); place();
  }).catch(() => {});
  const say = box.querySelector('.lk-bp-say'), pins = [...box.querySelectorAll('.lk-bp-pin')];
  const byId = (id) => rows.find((r) => r.id === id);
  const inPlay = () => root.dataset.state === 'menu';
  const lit = () => service.current ?? service.chosen;
  let lastHtml = null, hover = null, selected = null, warn = null, warnT = 0;   // shown: the id whose line is up; selected: a phone's first tap in play

  function sayText() {
    if (warn) return { html: esc(warn), warn: true };
    const id = hover ?? selected ?? (touch() ? lit() : null);
    const r = byId(id); if (!r) return { html: '' };
    const go = inPlay() && touch() && selected === r.id ? `<button class="go" type="button">Sail from here</button>` : '';
    return { html: `<b>${esc(r.name)}</b> ${esc(r.why)}${go}` };
  }
  function paint() {
    const cur = lit();
    for (const p of pins) p.setAttribute('aria-pressed', String(p.dataset.id === cur));
    const t = sayText();
    if (t.html !== lastHtml) { say.innerHTML = t.html; lastHtml = t.html; }   // never rebuild an unchanged line: a tap on its button must find it where it was
    if (t.warn) say.setAttribute('data-warn', ''); else say.removeAttribute('data-warn');
    box.toggleAttribute('data-say', !!t.html && (!!warn || !!hover || !!selected));
    home?.paint?.();
  }
  const flash = (why) => { warn = REFUSALS[why] ?? REFUSALS.unknown; paint(); clearTimeout(warnT); warnT = setTimeout(() => { warn = null; paint(); }, 4500); };
  async function go(id) {
    const r = await service.moveTo(id);
    if (!r?.ok) { flash(r?.why); return; }
    selected = null; paint(); home?.close?.();   // the card goes so the veil's move is seen
  }
  function press(id) {
    warn = null;
    if (!inPlay()) { service.pick(id); selected = null; paint(); return; }   // the first card: the pick only (main.js moves her behind the shell)
    if (touch() && selected !== id) { selected = id; paint(); return; }      // a finger: show it, then ask again
    go(id);
  }
  box.addEventListener('click', (e) => {
    if (e.target.closest?.('.go')) { e.preventDefault(); const id = selected; if (id) go(id); return; }
    const p = e.target.closest?.('.lk-bp-pin'); if (p) press(p.dataset.id);
  });
  box.addEventListener('pointerover', (e) => { const p = e.target.closest?.('.lk-bp-pin'); if (p && e.pointerType !== 'touch') { hover = p.dataset.id; paint(); } });
  box.addEventListener('pointerout', (e) => { const p = e.target.closest?.('.lk-bp-pin'); if (p && !p.contains(e.relatedTarget) && e.pointerType !== 'touch') { hover = null; paint(); } });
  box.addEventListener('focusin', (e) => { const p = e.target.closest?.('.lk-bp-pin'); if (p && p.matches(':focus-visible')) { hover = p.dataset.id; paint(); } });
  box.addEventListener('focusout', () => { hover = null; paint(); });
  // the voyage line's place word: the lit pin takes the focus (its line shows); the lake and boat words keep opening their page
  const onSum = (e) => {
    if (!e.target.closest?.('[data-v=place]')) return;
    e.stopImmediatePropagation(); e.preventDefault();
    (pins.find((p) => p.dataset.id === lit()) ?? pins[0])?.focus({ focusVisible: true });
  };
  card.addEventListener('click', onSum, true);
  // the box's place: in the card's own gap between the mode row and the page links (offsets, as buildCard.js); a phone card's CSS places it itself
  const offIn = (n) => { let y = 0; for (let e = n; e && e !== card; e = e.offsetParent) y += e.offsetTop; return y; };
  function place() {
    if (desk) {   // the column's gap is the box (flex); fit the chart's plate in it, whole, centred; a short gap is the row of pins
      const links = card.querySelector('.lk-links');
      if (links?.offsetHeight) card.style.setProperty('--lhd', `${card.clientHeight - links.offsetTop}px`);   // the links and the foot's height (src/ui/loading.js's --lh also steers the old chart's sloop)
      const w = box.clientWidth, h = box.clientHeight;
      if (!w || !h) return;
      const row = h < 118, aspect = bw / bh;
      box.classList.toggle('row', row); box.classList.toggle('chart', !row);
      let fw = w, fh = w / aspect; if (fh > h) { fh = h; fw = h * aspect; }
      const st = box.style; st.setProperty('--fw', `${fw.toFixed(1)}px`); st.setProperty('--fh', `${fh.toFixed(1)}px`); st.setProperty('--ox', `${((w - fw) / 2).toFixed(1)}px`); st.setProperty('--oy', `${((h - fh) / 2).toFixed(1)}px`);
      hatch?.setAttribute('patternTransform', `rotate(45) scale(${(bw / fw).toFixed(3)})`);   // a hatch line every 4 px at any size
      return;
    }
    if (touch() && root.querySelector('.lk-card.pc')) return;
    const plan = card.querySelector('.lk-row.plan'), links = card.querySelector('.lk-links');
    if (!plan?.offsetHeight || !links?.offsetHeight) return;
    const top = offIn(plan) + plan.offsetHeight + 4, bottom = offIn(links) - 4, h = Math.max(0, bottom - top);
    box.style.top = `${top}px`; box.style.height = `${h}px`;
    box.classList.toggle('row', h < 118);
  }
  const ro = win.ResizeObserver ? new win.ResizeObserver(place) : null;
  ro?.observe(card); if (desk) { ro?.observe(box); const lk = card.querySelector('.lk-links'); if (lk) ro?.observe(lk); }
  win.addEventListener?.('resize', place);
  const offMoved = service.on('moved', () => { selected = null; paint(); });
  const offPick = service.on('pick', () => paint());
  place(); paint();
  const mo = win.MutationObserver ? new win.MutationObserver(() => { selected = null; hover = null; place(); paint(); }) : null;
  mo?.observe(root, { attributes: true, attributeFilter: ['data-state'] });
  return { box, pins, say, paint, place, flash, press, dispose() { ro?.disconnect(); mo?.disconnect(); offMoved(); offPick(); win.removeEventListener?.('resize', place); card.removeEventListener('click', onSum, true); clearTimeout(warnT); box.remove(); } };
}
