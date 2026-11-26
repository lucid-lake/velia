// The Pro instruments panel (2026-11-25): the performance panel's twin (ui/perfHud.js) at the top-left, its mirror. The experts'
// numbers on one small glass plate, desktop only, while the cockpit is up in Sail and Regatta (ui/cockpitUp.js: hidden when folded,
// in Clear and Instruments, in Cruise, as Tessie, under a menu or a page) and never during the cinematic intro. It replaced the left
// edge's Pro nav column; the cockpit's PRO switch no longer decides it (PRO keeps its controls, and a few extras on the dials).
//   COG    236°        course over ground
//   TWA    58° P       true wind angle, the side it comes from
//   VMG    1.8 kn      speed made good to windward or downwind (SOG × cos TWA)
//   AWA    41° P       apparent wind angle
//   HEEL   12° S       the heel, the rail that is down
//   RUD    3° P        the rudder
// Setup › Screen › Pro instruments: off by default; its own stored key. A small × in the plate's top-right corner closes it: the
// same as Setup's off (stored; the row repaints). ?prohud=1 shows it for one load whatever the stored value (stills), ?prohud=0 never.
// The text is rebuilt 4 times a second, and only while shown; the readings smooth and hold as the old column's (src/ui/navColumn.js).
//   const hud = createProHud({ state, shown, onClose })   hud.update(dt) each frame; hud.state; hud.el; hud.dispose()
//   mountProRow(root, { settings })                       Setup's row
import { createReadings, fmt } from '../../src/ui/navColumn.js';
import { PERF_HUD } from './perfHud.js';

const DEG = 180 / Math.PI;
export const PRO_HUD = Object.freeze({
  hz: 4,             // text updates a second
  top: PERF_HUD.top, // px: the top bar's own top (the perf panel's)
  edge: PERF_HUD.edge, // px from the left edge (the page's side gutter)
  widthEm: 8.4,      // the plate's fixed width (the × gutter aside): the numbers are short
  closePx: PERF_HUD.closePx,
  key: 'lakeshore.v2.prohud',
  rows: Object.freeze(['cog', 'twa', 'vmg', 'awa', 'heel', 'rud']),
});
const LABEL = { cog: 'COG', twa: 'TWA', vmg: 'VMG', awa: 'AWA', heel: 'HEEL', rud: 'RUD' };

// whether the page may show it at all: the policy (a desktop), the URL, then the player's stored choice (off by default)
export function proHudAllowed({ policy = false, flag = null, stored = false } = {}) {
  if (!policy || flag === '0') return false;
  return flag === '1' ? true : stored === true;
}
// The rule (pure): allowed, not closed this load, the cockpit up, not the intro
export const proHudShown = ({ allowed = false, closed = false, cockpitUp = false, intro = false } = {}) => !!allowed && !closed && !!cockpitUp && !intro;

// the lines as [label, value, side] (pure: the tests read it); r: createReadings()'s readings; awaRad: the apparent wind angle
export function proLines(r, awaRad = 0) {
  const aw = Math.round(awaRad * DEG);
  const rows = { cog: fmt('cog', r), twa: fmt('twa', r), vmg: fmt('vmg', r), heel: fmt('heel', r), rud: fmt('rud', r), awa: { num: String(Math.abs(aw)), unit: '°', side: aw > 0 ? 'S' : aw < 0 ? 'P' : '' } };
  return PRO_HUD.rows.map((k) => { const v = rows[k]; return [LABEL[k], `${v.num}${v.unit === '°' ? '°' : v.unit ? ` ${v.unit}` : ''}`, v.side ?? '']; });
}

const CSS = `
.lk-proi{position:fixed;top:${PRO_HUD.top}px;left:calc(${PRO_HUD.edge}px + var(--lk-sal,0px));z-index:var(--lk-z-hud,10);pointer-events:none;user-select:none;
  display:grid;grid-template-columns:auto minmax(0,1fr) 1.4em;width:calc(${PRO_HUD.widthEm}em + ${PRO_HUD.closePx}px);column-gap:.6em;row-gap:.05em;padding:.5em calc(.8em + ${PRO_HUD.closePx}px - 6px) .5em .8em;box-sizing:border-box;
  font:var(--lk-regular,400) var(--lk-fs-caption,15px)/1.25 var(--lk-ui,sans-serif);font-variant-numeric:tabular-nums;letter-spacing:.01em;
  color:var(--lk-ink,rgb(244 244 242 / .94));background:var(--lk-glass,rgb(28 35 64 / .8));-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);
  border:var(--lk-line,1px) solid var(--lk-glass-edge,rgb(244 244 242 / .25));border-radius:var(--lk-glass-r,14px);box-shadow:var(--lk-glass-shadow);
  transition:opacity .3s linear,visibility 0s}
.lk-proi.gone{opacity:0;visibility:hidden;transition:opacity .3s linear,visibility 0s linear .3s}
.lk-proi .k{color:rgb(var(--lk-cream,244 244 242) / .8);letter-spacing:var(--lk-track-caps,.08em)}
.lk-proi .v{text-align:right;white-space:nowrap}
.lk-proi .sd{justify-self:start;align-self:center;font-size:.8em;line-height:1.2;padding:0 .3em;border-radius:.3em;color:rgb(var(--lk-navy,11 16 22))}
.lk-proi .sd:empty{visibility:hidden}
.lk-proi .sd.p{background:rgb(var(--lk-port,255 112 100))}
.lk-proi .sd.s{background:rgb(var(--lk-stbd,84 208 136))}
.lk-proi button.x{all:unset;position:absolute;top:3px;right:3px;width:${PRO_HUD.closePx}px;height:${PRO_HUD.closePx}px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;
  border-radius:6px;cursor:pointer;pointer-events:auto;color:rgb(var(--lk-cream,244 244 242) / .7);transition:background-color .15s linear,color .15s linear}
.lk-proi.gone button.x{pointer-events:none}
.lk-proi button.x svg{width:10px;height:10px;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;fill:none}
.lk-proi button.x:is(:hover,:focus-visible){color:rgb(var(--lk-cream,244 244 242) / .95);background:rgb(var(--lk-cream,244 244 242) / .12)}
.lk-proi button.x:focus-visible{outline:2px solid rgb(var(--lk-amber,232 168 56) / .9);outline-offset:0}
/* the cinematic intro (ui/cinematicIntro.js sets lk-intro-on from its start): gone at once, no fade over its first beat */
:root.lk-intro-on .lk-proi{opacity:0!important;visibility:hidden!important;transition:none!important}
@media (prefers-reduced-motion:reduce){.lk-proi,.lk-proi.gone,.lk-proi button.x{transition:none}}
`;

// state(): the boat's state; shown(): this frame's rule
export function createProHud({ state = () => null, shown = () => false, onClose = () => {}, hz = PRO_HUD.hz, doc = globalThis.document } = {}) {
  if (!doc.getElementById('lk-proi-css')) { const st = doc.createElement('style'); st.id = 'lk-proi-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const el = doc.createElement('div');
  el.className = 'lk-proi gone'; el.dataset.pro = '';
  const ks = [], vs = [], ss = [];
  for (const k of PRO_HUD.rows) {
    const a = doc.createElement('span'), b = doc.createElement('span'), c = doc.createElement('span');
    a.className = 'k'; b.className = 'v'; c.className = 'sd'; a.textContent = LABEL[k]; el.append(a, b, c); ks.push(a); vs.push(b); ss.push(c);
  }
  const x = doc.createElement('button');
  x.type = 'button'; x.className = 'x'; x.setAttribute('aria-label', 'Close Pro instruments');
  x.innerHTML = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5 8.5 8.5M8.5 1.5 1.5 8.5"/></svg>';
  x.addEventListener('pointerdown', (e) => e.stopPropagation());
  x.addEventListener('click', (e) => { e.stopPropagation(); x.blur?.(); onClose(); });
  el.appendChild(x);
  doc.body.appendChild(el);
  const readings = createReadings();
  let on = false, acc = Infinity, paints = 0, last = null;
  function paint(dt) {
    const s = state(); if (!s) return;
    const r = readings.step({ cog: s.cog, twsMs: s.trueWind?.speed, twa: s.trueWind?.angle, sogMs: s.sog, heel: s.heel, rudder: s.rudderAngle }, Math.min(1, dt));
    const lines = proLines(r, s.apparentWind?.angle ?? 0);
    lines.forEach(([, v, sd], i) => {
      if (vs[i].textContent !== v) vs[i].textContent = v;
      if (ss[i].textContent !== sd) { ss[i].textContent = sd; ss[i].className = `sd${sd === 'P' ? ' p' : sd === 'S' ? ' s' : ''}`; }
    });
    last = lines; paints++;
  }
  return {
    el, close: x,
    update(dt = 1 / 60) {
      const sh = !!shown();
      if (sh !== on) { on = sh; el.classList.toggle('gone', !sh); if (sh) { readings.reset(); acc = Infinity; } }
      if (!sh) return;
      acc += dt;
      if (acc >= 1 / hz) { paint(acc === Infinity ? 1 / hz : acc); acc = 0; }
    },
    get shown() { return on; },
    get state() { return { shown: on, paints, lines: last ? last.map((l) => [...l]) : null }; },
    dispose() { el.remove(); },
  };
}

// the stored choice (off by default): its own key; listen(fn) hears each change (the row, the panel)
const pageStore = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
let shared = null;
export function proHudSettings(store = pageStore()) {
  if (shared && shared.store === store) return shared;
  let memo = null;
  const read = () => {
    if (memo != null) return memo;
    let v = null; try { v = JSON.parse(store?.getItem?.(PRO_HUD.key) ?? 'null'); } catch { v = null; }
    memo = !!(v && typeof v === 'object' && v.on === true);
    return memo;
  };
  const fns = new Set();
  const api = {
    store,
    get on() { return read(); },
    set(v) { memo = !!v; try { store?.setItem?.(PRO_HUD.key, JSON.stringify({ on: memo })); } catch { /* private mode: this page only */ } for (const f of fns) f(memo); return memo; },
    listen(f) { fns.add(f); return () => fns.delete(f); },
    forget() { memo = null; },
  };
  shared = api;
  return api;
}

// Setup › Screen › Pro instruments: on · off (the home card's row style), after the performance stats row (else the text row)
export function mountProRow(root, { settings = proHudSettings(), doc = globalThis.document } = {}) {
  const tab = root?.querySelector?.('#tp-set-screen');
  if (!tab || tab.querySelector('[data-set="prohud"]')) return null;
  const row = doc.createElement('div');
  row.className = 'set'; row.dataset.set = 'prohud';
  row.innerHTML = '<span class="k">Pro instruments</span><span class="v"><button class="opt" type="button" role="radio" data-pi="on" aria-checked="false">on</button><button class="opt" type="button" role="radio" data-pi="off" aria-checked="false">off</button></span>';
  const after = tab.querySelector('[data-set="perfhud"]') ?? tab.querySelector('[data-set="text"]');
  if (after?.nextSibling) tab.insertBefore(row, after.nextSibling); else tab.appendChild(row);
  const btns = [...row.querySelectorAll('[data-pi]')];
  const paint = () => { const v = settings.on ? 'on' : 'off'; for (const b of btns) b.setAttribute('aria-checked', String(b.dataset.pi === v)); };
  const click = (e) => { const b = e.target.closest?.('[data-pi]'); if (!b) return; e.stopPropagation(); settings.set(b.dataset.pi === 'on'); paint(); };
  row.addEventListener('click', click);
  const off = settings.listen?.(paint);
  paint();
  return { row, buttons: btns, paint, dispose() { off?.(); row.removeEventListener('click', click); row.remove(); } };
}
