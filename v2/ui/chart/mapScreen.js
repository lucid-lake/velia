// The map screen (Phase 2b): the live chart (liveChart.js) is the page behind the card, at the voyage start and in the
// in-game menu: one screen. It mounts the chart in the shell (#lk-load), under the card, and follows the shell's state:
//   home      the entrance: the whole bay with the five pins in what the panel leaves; a pin tapped is the pick (the voyage line names it,
//             the lit mode starts from the card's Sail from here); the chart is opaque on the shell
//   out       a mode was pressed: the map zooms into the chosen pin (0.9 s) as the shell fades and the lake shows through; with
//             reduced motion it is a cut (the chart's own glide)
//   menu      Esc, the bar's Menu or Chart, N: the same chart centred on the boat (the panel's width kept clear on the left, so the panel
//             never covers her), her track behind her; the ground is glass over the live lake on a desktop and a tablet (90 %, a 14 px
//             blur), opaque with the lake paused on a phone; a pin's one action is Sail from here (a move under the veil, then the menu closes)
//   gone      the chart stops (no frame loop)
// Desktop and tablet (data-map-card=panel): the host fills the shell and the card is the slim left panel (PANEL_CSS). A phone
// (data-map-card=box): the approved phone card (layout A, ui/phoneCard.js) stays; the chart takes the left box where its mini chart was.
//   const screen = mountMapScreen({ host, root, services, sources, ground, touch, reduced, box, glass, home, ux, showTessie, deepAt });   ux: ?mapux=1's mock (liveChart.js)
// factDate: () => the Date whose lake fact the chart shows (chartFact.js; null on a deterministic page: the first)
//   screen.chart, screen.fact, screen.showAll() (the card's CHART: the whole bay at the entrance, the boat in the menu), screen.panelWidth(), screen.destroy()
import { createChart, CHART_TIMING } from './liveChart.js';
import { centreFor, zoomRange } from './chartModel.js';
import { mountPanelPlan } from './panelPlan.js';
import { mountChartFact } from './chartFact.js';

const PANEL_W = 'clamp(300px,26vw,360px)';
const ZOOM_IN_S = 0.9;       // the entrance's zoom into the pin
const ZOOM_IN_MPP = 1.6;     // how close it ends (the pin's cove)
const MENU_MPP = 3.2;        // the menu's first zoom: the bay about the boat
const MENU_MPP_BOX = 5;      // a phone's small box: more of the bay

const P = 'html[data-map-card=panel] #lk-load:not([data-pg])';
const PANEL_CSS = `#lk-load .lk-livechart{display:none;position:absolute;inset:0;z-index:1;pointer-events:auto}
#lk-load .lk-livechart:not([hidden]){display:block}
#lk-load[data-state=menu] .lk-livechart{opacity:0;transition:opacity .4s var(--lk-ease)}
#lk-load[data-state=menu][data-on] .lk-livechart{opacity:1}
#lk-load[data-state=menu][data-off] .lk-livechart{opacity:0;transition-duration:.45s}
#lk-load .lk-livechart[data-glass]{backdrop-filter:blur(14px) saturate(.8);-webkit-backdrop-filter:blur(14px) saturate(.8)}
#lk-load .lk-livechart .lkc-surprise{position:absolute;z-index:1;left:calc(var(--lk-panel-in,0px) + 16px);bottom:14px;min-height:30px;padding:0 .9em;display:inline-flex;align-items:center;cursor:pointer;
  font:italic 400 15px/1 var(--lk-font);letter-spacing:.03em;color:var(--lk-ink);background:var(--lk-glass-dense);border:1px solid var(--lk-glass-edge);border-radius:999px}
#lk-load .lk-livechart .lkc-surprise:hover,#lk-load .lk-livechart .lkc-surprise:focus-visible{border-color:rgb(var(--lk-cream) / .6);outline:none}
#lk-load .lk-livechart[data-touch] .lkc-surprise{min-height:44px}
html[data-map-card=panel] #lk-load .lk-card{z-index:3}   /* the pages (Keys, Setup, About) open on the big card: it stays above the map */
html[data-map-card=panel] #lk-load[data-pg] .lk-livechart :is(.lkc-ctl,.lkc-surprise,.lkc-hint){visibility:hidden}
${P}{--lk-panel:${PANEL_W}}
html[data-map-card=panel] #lk-load{--lk-panel:${PANEL_W}}
${P} .lk-card{--cw:var(--lk-panel);--F:calc(var(--lk-panel) / 23.5);left:0;top:0;bottom:0;width:var(--lk-panel);height:auto;min-height:0;display:flex;flex-direction:column;border-radius:0;transform:none;z-index:3;
  background:rgb(var(--pan) / .78);backdrop-filter:blur(14px) saturate(1.15);-webkit-backdrop-filter:blur(14px) saturate(1.15);border-right:1px solid rgb(var(--ink3) / .34);box-shadow:6px 0 28px rgb(var(--lk-shade) / .4);animation:lk-panelin .4s cubic-bezier(.2,0,0,1) both}
@keyframes lk-panelin{from{opacity:0;transform:translateX(-24px)}to{opacity:1;transform:none}}
${P}[data-state=menu] .lk-card{animation:none;transform:translateX(-24px);transition:opacity .4s var(--lk-ease),transform .4s cubic-bezier(.2,0,0,1)}
${P}[data-state=menu][data-on] .lk-card{transform:none}
${P}[data-state=out] .lk-card{animation:none;transform:translateX(-24px);transition:opacity .4s var(--lk-ease),transform .4s cubic-bezier(.2,0,0,1)}
${P}[data-state=out][data-out-from=card]:not([data-strip=on]) .lk-card{animation:none}
${P} .lk-card > .lk-art-n,${P} .lk-card > .lk-art,${P} .lk-card .lk-map,${P} .lk-light,${P} .lk-rose,${P} .lk-bp{display:none!important}
${P} .lk-card::before,${P} .lk-card::after{display:none}
${P} .lk-links{background:none}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){${P} .lk-card{background:rgb(var(--pan) / .97)}}
@media (prefers-reduced-transparency:reduce){${P} .lk-card{background:rgb(var(--pan));backdrop-filter:none;-webkit-backdrop-filter:none}}
${P} .lk-sheet{position:relative!important;inset:auto!important;flex:none;padding:1.5em 1.5em 0!important}
${P} .lk-word{font-size:2.5em}
${P} .lk-by{flex-wrap:wrap;gap:.4em .7em;white-space:normal;letter-spacing:.2em}
${P} .lk-row.lk-sum{order:3;margin-top:1.8em!important;padding:.45em .5em;justify-content:flex-start;text-align:left;font-size:max(1em,15px)}
${P} .lk-row.lk-sum .v{white-space:normal;overflow:visible}
${P} .lk-row.plan{order:4;margin-top:.8em}
${P} .lk-foot{margin:.25em 0 0;padding:.35em 0 .05em;gap:.4em}
${P} .lk-sup{padding:0 .6em 0 .45em!important;font-size:14px!important;gap:.3em;white-space:nowrap}
${P} .lk-foot .lk-gh,${P} .lk-card .lk-news .t{font-size:14px!important;letter-spacing:.03em!important}
${P} .lk-ver::before,${P} .lk-card .lk-news::before{margin:0 .22em!important}
${P} .lk-foot .lk-gh{padding:0 .2em!important}
${P} .lk-card .lk-news{padding:0!important}
${P} .lk-row .v.picks{width:100%}
${P} .lk-card .lk-pick{flex:1 1 0;justify-content:center;padding-left:.3em;padding-right:.3em}
${P} .lk-links{position:static!important;flex:1 1 auto;margin:0!important;padding:.9em 1.2em 1em;display:grid;grid-template-columns:repeat(4,auto);grid-template-rows:auto 1fr;justify-content:space-between;align-content:stretch;background:none}
${P} .lk-links .lk-foot{grid-column:1 / -1;align-self:end}
${P} .lk-card .lk-link{font-size:max(.9em,13px);letter-spacing:.12em;padding-left:.4em;padding-right:.4em}
${P} .lk-card .lk-link + .lk-link{padding-left:.4em}
@media (prefers-reduced-motion:reduce){${P} .lk-card,${P}[data-state=menu] .lk-card,${P}[data-state=out] .lk-card{animation:none;transform:none;transition:opacity .2s}}`;

// the box on a phone: the chart where the card's mini chart was (ui/phoneCard.js .lk-bp: left 12 px, top 100 px, the left of the thumb's column)
const PHONE = ':root[data-f-phone-card=on] #lk-load';
const BOX_CSS = `html[data-map-card=box] #lk-load .lk-livechart{display:none;position:absolute;z-index:3;left:12px;right:auto;top:100px;bottom:12px;width:calc(100% - var(--lk-rc,34%) - 40px);border-radius:12px;overflow:hidden;
  border:1px solid rgb(var(--lk-cream) / .28);pointer-events:auto}
html[data-map-card=box] #lk-load .lk-livechart:not([hidden]){display:block}
html[data-map-card=box] #lk-load .lk-livechart .lkc-surprise{position:absolute;z-index:1;left:8px;bottom:8px;min-height:44px;padding:0 1em;display:inline-flex;align-items:center;cursor:pointer;
  font:italic 400 15px/1 var(--lk-font);color:var(--lk-ink);background:var(--lk-glass-dense);border:1px solid var(--lk-glass-edge);border-radius:999px}
${PHONE} .lk-card .lk-bp{display:none!important}
/* the map fades in over 0.3 s when it appears on the phone's card (the card's engraving is off there: ui/phoneCard.js, one chart on the card) */
html[data-map-card=box] #lk-load[data-state=home] .lk-livechart:not([hidden]){animation:lk-boxin .3s var(--lk-ease) both}
@keyframes lk-boxin{from{opacity:0}to{opacity:1}}
@media (prefers-reduced-motion:reduce){html[data-map-card=box] #lk-load[data-state=home] .lk-livechart:not([hidden]){animation:none}}`;

import { clampT as clamp } from '../../../src/sim/core/math.js';

export function mountMapScreen({ host, root = globalThis.document?.getElementById('lk-load'), services, sources = {}, ground = {}, touch = () => false, reduced = () => false,
  box = false, glass = true, mapHint = null, ux = null, home = () => services?.get?.('menu') ?? null, showTessie = () => false, deepAt = null, factDate = () => new Date() } = {}) {
  if (!host || !root) return null;
  const doc = root.getRootNode?.() ?? globalThis.document, html = doc.documentElement, win = doc.defaultView ?? globalThis;
  if (!doc.getElementById('lk-mapscreen-css')) { const s = doc.createElement('style'); s.id = 'lk-mapscreen-css'; s.textContent = PANEL_CSS + '\n' + BOX_CSS; doc.head.appendChild(s); }
  html.dataset.mapCard = box ? 'box' : 'panel';
  const card = () => root.querySelector('.lk-card');
  if (box) { const c = card(); c?.insertBefore(host, c.firstChild); } else root.insertBefore(host, card() ?? null);
  const st = () => root.dataset.state, off = () => root.hasAttribute('data-off');
  const bp = () => services?.get?.('birthplace') ?? null;
  const rawBoat = () => { try { return sources.boat?.() ?? null; } catch { return null; } };
  let entrance = true;   // the entrance (home, and the zoom-in that leaves it): no boat of her own on the map, the pins say where she starts

  // the entrance's "Sail from here" picks the pin and starts the lit mode from the card; in the menu it is the move (the default)
  // the panel's mode press only selects (Set sail starts it), so press Set sail when it is there; the phone card's pick enters on a tap
  const enterLit = () => {
    const go = root.querySelector('.lk-links .lk-go');
    if (html.dataset.mapCard === 'panel' && go?.getClientRects().length) { go.click(); return; }
    (root.querySelector('.lk-pick[aria-checked=true]') ?? root.querySelector('.lk-pick[data-mode=sail]'))?.click?.();
  };
  const actions = {
    async sail(row) {
      const s = bp();
      if (!s) return { ok: false, why: 'unknown' };
      if (entrance) { if (!s.pick(row.ref)) return { ok: false, why: 'unknown' }; setTimeout(enterLit, 0); return { ok: true, picked: row.ref }; }
      return (await s.moveTo(row.ref)) ?? { ok: false, why: 'unknown' };
    },
  };
  const chart = createChart({ hint: mapHint, el: host, size: box ? 'card' : 'menu', mode: 'entrance', services, actions, ground, touch, reduced, ux: ux && box ? { ...ux, compact: true } : ux,   // ux: the crosshair, layers and wake (?mapux=0 none); a phone's box: one Layers button
    sources: { ...sources, boat: () => (entrance ? null : rawBoat()) } });
  host.hidden = true;
  // the panel's float plan: the ledger rows, the conditions plate, the art (desktop and tablet; the phone card keeps layout A)
  const plan = box ? null : mountPanelPlan({ root, services, chart, showTessie, deepAt });   // showTessie: feature('playTessie').on; deepAt: her deep pins

  // Surprise me: a small italic link on the water (a seeded pick among the five); the entrance picks, the menu moves her
  const surprise = doc.createElement('button'); surprise.type = 'button'; surprise.className = 'lkc-surprise'; surprise.textContent = 'Surprise me';
  surprise.setAttribute('aria-label', 'Surprise me: a place picked for you');
  surprise.addEventListener('click', async (e) => {
    e.stopPropagation();
    const s = bp(); if (!s) return;
    if (entrance) { s.pick('random'); return; }
    const r = await s.moveTo('random');
    if (r?.ok) home()?.close?.();
  });
  for (const ty of ['pointerdown', 'pointerup', 'wheel', 'dblclick']) surprise.addEventListener(ty, (e) => e.stopPropagation(), { passive: ty !== 'wheel' });
  host.appendChild(surprise);
  // the day's lake fact: the chart's quiet caption at the entrance (chartFact.js); a phone's goes under its box, on the card
  const fact = mountChartFact(box ? (card() ?? host) : host, { doc, date: factDate });

  const panelPx = () => (box ? 0 : (card()?.offsetWidth ?? 0));
  const insets = () => ({ left: panelPx(), right: 0, top: 0, bottom: 0 });
  const syncInsets = () => { const l = panelPx(); host.style.setProperty('--lk-panel-in', `${l}px`); chart.setInsets({ left: l }); return l; };

  // the whole bay: every pin inside what the panel leaves (the entrance's first view)
  function fitPins() {
    const list = (bp()?.list?.() ?? []).filter((r) => !r.locked && Number.isFinite(r.x));
    const { w, h } = chart.state;
    if (!list.length || !w) return null;
    const ins = insets(), freeW = Math.max(120, w - ins.left - (box ? 70 : 190)), freeH = Math.max(120, h - (box ? 60 : 150));
    const xs = list.map((r) => r.x), zs = list.map((r) => r.z);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const { min, max } = zoomRange(w, h, chart.state.size);
    const mpp = clamp(Math.max((x1 - x0) / freeW, (z1 - z0) / freeH, 0.001) * 1.12, min ?? 1.2, max ?? 6.5);
    const c = centreFor((x0 + x1) / 2, (z0 + z1) / 2, mpp, ins);
    return { center: { x: c.cx, z: c.cz }, mpp };
  }
  function toEntrance() {
    entrance = true;
    chart.setMode('entrance'); chart.setSize(box ? 'card' : 'menu'); chart.setGlass(1);
    syncInsets(); host.hidden = false; chart.show(true); fact?.show(true);
    const v = fitPins(); if (v) chart.setView({ ...v, animate: false });
    lake(false);
  }
  let lastMpp = box ? MENU_MPP_BOX : MENU_MPP;
  function toMenu() {
    entrance = false;
    chart.setMode('play'); chart.setSize(box ? 'card' : 'menu'); chart.setGlass(glass ? 0.9 : 1);
    syncInsets(); host.hidden = false; chart.show(true); fact?.show(false);
    centreOnBoat(false);
    lake(!glass);
  }
  function centreOnBoat(animate) {
    const b = rawBoat(), w = chart.state.w, h = chart.state.h;
    if (!b || !w) { const v = fitPins(); if (v) chart.setView({ ...v, animate: false }); return; }
    const { min, max } = zoomRange(w, h, chart.state.size), mpp = clamp(lastMpp, min ?? 1.2, max ?? 6.5), c = centreFor(b.x, b.z, mpp, insets());
    chart.setView({ center: { x: c.cx, z: c.cz }, mpp, animate: false });
    chart.recentre();   // follows her from here (the chip returns after a pan); she is already where the glide ends: nothing moves
  }
  // a mode pressed: zoom into the pin as the shell fades; the chart's glide is a cut under reduced motion
  function zoomIn() {
    const b = rawBoat(), pin = bp()?.list?.().find((r) => r.id === bp()?.current);
    const at = pin && Number.isFinite(pin.x) ? pin : b;
    if (!at) return;
    chart.select(null);
    chart.setView({ center: { x: at.x, z: at.z }, mpp: ZOOM_IN_MPP, animate: true, duration: ZOOM_IN_S });
  }
  // a phone: the lake sleeps under the opaque menu (the render loop reads the attribute; main.js)
  function lake(paused) { html.toggleAttribute('data-lake-paused', !!paused); }

  let prev = st();
  function sync() {
    const s = st();
    if (s === 'home' && (prev !== 'home' || host.hidden)) toEntrance();
    else if (s === 'menu' && !off() && (prev !== 'menu' || host.hidden)) toMenu();
    else if (s === 'out' && prev === 'home') zoomIn();
    else if (s === 'gone' || s === 'company' || s === 'attract' || s === 'fail') { if (!host.hidden) { chart.show(false); host.hidden = true; } fact?.show(false); lake(false); }
    prev = s;
  }
  const mo = win.MutationObserver ? new win.MutationObserver(sync) : null;
  mo?.observe(root, { attributes: true, attributeFilter: ['data-state', 'data-off'] });
  const ro = win.ResizeObserver ? new win.ResizeObserver(() => { if (!host.hidden) { chart.resize(); syncInsets(); } }) : null;
  ro?.observe(root); { const c = card(); if (c && !box) ro?.observe(c); }

  // events: a pin tapped at the entrance is the pick; a move in the menu closes it so the veil is seen; the card's Esc goes to the chart's card first
  const offSel = chart.on('select', (row) => { if (entrance && st() === 'home' && row?.kind === 'birthplace') bp()?.pick?.(row.ref); });
  const offAct = chart.on('action', (e) => { if (!entrance && e.action === 'sail' && e.result?.ok) home()?.close?.(); });
  // a tap on the water no longer closes the menu (owner, 2026-11-18): in play it opens the water's card (Set as target, Add waypoint);
  // the menu closes by its ×, Esc or Resume only
  const offView = chart.on('view', (v) => { if (!entrance && st() === 'menu') lastMpp = v.mpp; });

  sync();   // the shell may be home already
  const api = {
    chart, host, actions,
    get entrance() { return entrance; },
    panelWidth: panelPx,
    // true when the chart took Esc (its open card closed); home.js menuEsc
    escTaken() { if (plan?.escTaken()) return true; if (chart.state.card) { chart.select(null); return true; } return false; },
    // the card's CHART: the whole bay at the entrance, the boat in the menu
    showAll() {
      if (host.hidden) return;
      if (entrance) { const v = fitPins(); if (v) chart.setView({ ...v, animate: true, duration: CHART_TIMING.glideS }); } else centreOnBoat(true);
    },
    plan, fact,
    insideHost: (t) => host.contains(t) || !!plan?.contains(t),
    destroy() { plan?.dispose(); fact?.dispose(); mo?.disconnect(); ro?.disconnect(); offSel(); offAct(); offView(); chart.destroy(); lake(false); host.remove(); delete html.dataset.mapCard; },
  };
  return api;
}
