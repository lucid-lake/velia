// The control panel (owner, 2026-10-30): the boat's switches in one grid, as on a real helm console,
// but with no plate since round 2 of § 10 (owner: only the controls, over the scene like the wheel and the winches), the
// white caps over each control with a soft dark halo; real toggles for what stays on or off (ENGINE, ANCHOR, SAILS, each with its status LED),
// stainless illuminated push-buttons for the rest (MOOR, GLASSES, TRIM: the ring lights amber when on). Sprites:
// blender/dash_panel.py, packed by tools/dash/pack_panel.py (brand/dash/cpanel*, ctl*). Bottom right of centre, next to the
// wind circle, never over the boat (helmStation.js helmLayout places it). The keys stay (I, J, U, Y, B, O).
//
//   const cp = createControlPanel({ dock, lit: { binoculars: () => bool, pro: () => bool } });
//   cp.place(rect, form, lay)   // css px; form 'grid' (3 × 2, the desktop and the iPad) or 'keys' (a phone: SAILS · ANCHOR · PANEL · CHART)
//   cp.update(dt); cp.dispose();
// A phone keeps four keys on screen: the two rockers, PANEL and CHART. PANEL opens the rest of the
// panel as one row over the bottom (BINOCULARS · VHF · REEF · MOOR · TRIM · LOG; a tap outside closes it), CHART opens the big
// chart (no small chart circle on a phone). The throttle lever is its own column (throttleLever.js), placed by the same layout.
// The registry is still the dock's (toolDock.js): each control runs the registered action, so a key and the panel are one.
import { ensureTokens } from '../../ui/tokens.js';
import { sharedTips } from '../../ui/tips.js';

// [id in the dock's registry, the engraved word, the kind]
// The order and the emphasis (owner, 2026-10-30): by how often players use them. Top row: SAILS (the most used: the largest,
// an UP / DOWN rocker), BINOCULARS, TRIM (Pro on / off, the Settings → Sailing choice); bottom row: ANCHOR (an UP / DOWN rocker), MOOR (rarely: smaller and dim until a
// ball or a pier is near, then it lights and pulses once). The throttle lever is the right-hand column (throttleLever.js),
// its engine start / stop key at its base (ENGINE left the grid). Emphasis by size, place and brightness, never colour.
// [id in the dock's registry, the engraved word, the kind, the weight, the rocker's halves or the cap's icon]
export const PANEL = [
  ['sails', 'SAILS', 'rocker', 'big', { up: 'Up · hoist the sails', down: 'Down · lower and furl' }],
  ['binoculars', 'BINOCULARS', 'push', 'mid', 'binoculars'],
  ['pro', 'TRIM', 'push', 'mid', 'trim'],   // owner 2026-10-30: TRIM took VHF's slot; VHF moved to the pro trim panel (trimPanel.js)
  ['anchor', 'ANCHOR', 'rocker', 'mid', { up: 'Up · weigh the anchor', down: 'Down · drop the anchor' }],
  ['lines', 'MOOR', 'push', 'small', 'lines'],
  ['reef', 'REEF', 'push', 'mid', 'reef'],   // K: a reef in, a second, shaken out (the keyboard-only gap, owner 2026-10-30)
];
// a finger's tap on the cockpit's hit layer: the finger may drift slopPx between down and up; the browser's click that follows within
// clickMs is the same tap (swallowed)
const FINGER_TAP = Object.freeze({ slopPx: 14, clickMs: 800 });
// a phone: these four on screen; PANEL holds the rest, in this order
export const PHONE_KEYS = ['sails', 'anchor', 'more', 'chart'];
export const PANEL_MORE = ['binoculars', 'radio', 'reef', 'lines', 'pro', 'logbook'];
// the phone's own cells: PANEL and CHART on the bottom row, VHF and LOG in the PANEL row (on a desktop VHF is in the pro trim panel, LOG in the bar)
export const PHONE_CELLS = [
  ['more', 'PANEL', 'push', 'mid', 'panel'],
  ['chart', 'CHART', 'push', 'mid', 'chart'],
  ['radio', 'VHF', 'push', 'mid', 'radio'],
  ['logbook', 'LOG', 'push', 'mid', 'log'],
  ['engine', 'ENGINE', 'push', 'mid', 'engine'],   // the cockpit's key switch (COCKPIT_CELLS)
];
// the cockpit (cockpit3d.js, a desktop): the panel's DOM is the invisible hit layer over the 3D switches, each cell placed on its
// part; the engine's key switch is a cell of its own there (I: start / stop), as the 3D panel has one. BINOCULARS, TRIM (PRO), VHF
// and LOG are the PRO recess's own (stage 2: proRecess.js)
export const COCKPIT_CELLS = ['sails', 'anchor', 'reef', 'engine', 'lines'];   // MOOR only while a mooring or a pier is near (the layout's cells say)
// which cells a layout shows: { main: ids on the panel, more: ids in the PANEL row (null: no row) }
export function panelCells(form) {
  if (form === 'keys') return { main: [...PHONE_KEYS], more: [...PANEL_MORE] };
  if (form === 'cockpit') return { main: [...COCKPIT_CELLS], more: null };
  return { main: PANEL.map((p) => p[0]), more: null };
}
// The engraved glyphs (feat/portrait, the owner: "all the symbols on iPhone are very low quality design"): redrawn on a 24 grid for
// 14–18 px, few strokes, whole and half units, one 1.6 px non-scaling stroke in the brand navy on the stainless cap (capSvg)
export const CAP_ICONS = {
  binoculars: '<circle cx="7" cy="16" r="4"/><circle cx="17" cy="16" r="4"/><path d="M4 14.5 7.5 5h3v7.5M20 14.5 16.5 5h-3v7.5M10.5 9h3"/>',
  trim: '<path d="M10 3v16M10 4c4.5 3.5 6.5 8.5 6 13h-6"/><path d="M4 20.5h16"/><path d="M4.5 9h3M4.5 13h3"/>',
  reef: '<path d="M10 3v16M10 4c4.5 3.5 6.5 8.5 6 13h-6"/><path d="M4 20.5h16"/><path d="M10 13.5h5.5" stroke-dasharray="1.5 1.8"/>',
  lines: '<circle cx="7.5" cy="12" r="4.5"/><path d="M12 12h3.5c2 0 2.5-3 4.5-3M15.5 12c2 0 2.5 3 4.5 3"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M8 8v8M12 8v8M16 8v8"/><path d="M6.5 13h3M10.5 10h3M14.5 12h3"/>',
  chart: '<path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2Z"/><path d="M9 4.5v13M15 6.5v13"/>',
  radio: '<rect x="7" y="7" width="10" height="14" rx="2"/><path d="M14.5 7V2.5M10 11h4"/><circle cx="12" cy="16.5" r="1.5"/>',
  log: '<path d="M6 4h11a1.5 1.5 0 0 1 1.5 1.5V20H7.5A2.5 2.5 0 0 1 5 17.5V5a1 1 0 0 1 1-1Z"/><path d="M5 17.5A2.5 2.5 0 0 1 7.5 15h11M9 8h6M9 11h4"/>',
};
// a stainless push-button, drawn (was the ctl sprite): a turned bezel, a ring that lights amber when on, the cap, the glyph
export const capSvg = (glyph) => '<svg class="cap" viewBox="0 0 48 48" aria-hidden="true"><circle class="bz" cx="24" cy="24" r="22.5"/><circle class="rg" cx="24" cy="24" r="18.75"/>'
  + `<circle class="cp" cx="24" cy="24" r="16.25"/><path class="hl" d="M12.5 19a12.5 12.5 0 0 1 23 0"/><g class="ic" transform="translate(12.5 12.5) scale(.96)">${glyph}</g></svg>`;
const DEFS = '<svg id="lk-cp-defs" width="0" height="0" style="position:absolute" aria-hidden="true"><defs>'
  + '<linearGradient id="lkcp-bz" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6F7F9"/><stop offset=".42" stop-color="#B4BAC1"/><stop offset=".58" stop-color="#7A818A"/><stop offset="1" stop-color="#D6DADF"/></linearGradient>'
  + '<radialGradient id="lkcp-cp" cx=".42" cy=".34" r=".75"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#DADDE2"/><stop offset="1" stop-color="#A3A9B1"/></radialGradient>'
  + '<radialGradient id="lkcp-cpn" cx=".42" cy=".34" r=".75"><stop offset="0" stop-color="#7A3A30"/><stop offset="1" stop-color="#3A1612"/></radialGradient>'
  + '</defs></svg>';
const IS = (n) => `image-set(url(/brand/dash/${n}@1x.webp) 1x,url(/brand/dash/${n}@2x.webp) 2x,url(/brand/dash/${n}@3x.webp) 3x)`;
const U = 'var(--cp-u,1px)';
const CSS = `
.lk-cp{position:fixed;z-index:var(--lk-z-dock);box-sizing:border-box;display:grid;user-select:none;-webkit-user-select:none;pointer-events:auto;
  /* no plate (owner, 2026-10-30): only the controls, over the scene as the wheel and the winches are; each keeps its own shading and contact shadow */
  padding:calc(${U} * 2) 0 0;column-gap:0;align-items:start;justify-items:center;
  font:600 calc(${U} * 11)/1 var(--lk-ui);letter-spacing:.11em;color:rgb(242 244 250 / .93);-webkit-font-smoothing:antialiased;
  filter:drop-shadow(0 1px 3px rgb(0 0 0 / .4));opacity:1;transition:opacity var(--lk-in) var(--lk-ease)}
.lk-cp.off{opacity:0;pointer-events:none;transition:opacity var(--lk-out) var(--lk-ease-out)}
.lk-cp.off *{pointer-events:none!important}
.lk-cp .c{all:unset;position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:calc(${U} * 3);width:100%;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
/* the engraved words now sit on the scene: white with a soft dark halo, legible over bright water, sky and snow */
.lk-cp .w{display:block;height:calc(${U} * 12);line-height:calc(${U} * 12);white-space:nowrap;text-shadow:0 0 3px rgb(10 14 28 / .95),0 0 6px rgb(10 14 28 / .7),0 1px 1px rgb(0 0 0 / .9)}
/* the weights: the most used reads first (a larger cap, a brighter word), the rare one is quiet */
.lk-cp .c[data-wt=big] .w{font-size:calc(${U} * 12);color:rgb(250 251 255)}
.lk-cp .c[data-wt=mid] .w{opacity:.86}
.lk-cp .c[data-id=binoculars] .w{letter-spacing:.04em;font-size:calc(${U} * 9.5)}
.lk-cp .c[data-wt=small] .w{font-size:calc(${U} * 11);opacity:.78}
.lk-cp .c[data-wt=small] .o{width:calc(${U} * 25);height:calc(${U} * 25);margin-top:calc(${U} * 4)}
/* the push-button (capSvg): vector at any density; the glyph a 1.6 px navy stroke, the ring amber when on */
.lk-cp .o svg.cap,.lk-cpx .o svg.cap{position:absolute;inset:0;width:100%;height:100%;overflow:visible;filter:drop-shadow(1px 1.5px 1.2px rgb(0 0 0 / .5))}
.lk-cp .cap .bz,.lk-cpx .cap .bz{fill:url(#lkcp-bz);stroke:#3A4048;stroke-width:.8}
.lk-cp .cap .rg,.lk-cpx .cap .rg{fill:#3B2C26;transition:fill .15s}
.lk-cp .cap .cp,.lk-cpx .cap .cp{fill:url(#lkcp-cp)}
.lk-cp .cap .hl,.lk-cpx .cap .hl{fill:none;stroke:#fff;stroke-opacity:.7;stroke-width:1.2;stroke-linecap:round}
.lk-cp .cap .ic,.lk-cpx .cap .ic{fill:none;stroke:rgb(var(--lk-brand-navy));stroke-width:1.6px;stroke-linecap:round;stroke-linejoin:round}
.lk-cp .cap .ic *,.lk-cpx .cap .ic *{vector-effect:non-scaling-stroke}
.lk-cp .c.on .cap .rg,.lk-cpx .c.on .cap .rg{fill:#FFC23A}
.lk-cp .c.on .o svg.cap,.lk-cpx .c.on .o svg.cap{filter:drop-shadow(0 0 2.5px rgb(255 194 58 / .75)) drop-shadow(1px 1.5px 1.2px rgb(0 0 0 / .5))}
.lk-cp .c[data-k=push]:active .cap .cp,.lk-cpx .c:active .cap .cp{filter:brightness(.88)}
:root[data-lk-theme=night] .lk-cp .cap .cp,:root[data-lk-theme=night] .lk-cpx .cap .cp{fill:url(#lkcp-cpn)}
:root[data-lk-theme=night] .lk-cp .cap .ic,:root[data-lk-theme=night] .lk-cpx .cap .ic{stroke:rgb(255 170 150)}
:root[data-lk-theme=night] .lk-cp .c.on .cap .rg,:root[data-lk-theme=night] .lk-cpx .c.on .cap .rg{fill:rgb(255 110 90)}
/* the UP / DOWN rocker, drawn (was the rocker2 sprite; feat/portrait): a stainless frame, two black halves, the words live text; the
   pressed half sits lower and its word is lit amber, the other white; each half is its own button */
.lk-cp .c[data-k=rocker]{cursor:default}
.lk-cp .rk{--rp:calc(${U} * 2.2);position:relative;display:block;box-sizing:border-box;width:calc(${U} * 25);height:calc(${U} * 36);border-radius:calc(${U} * 5);
  background:linear-gradient(180deg,#F1F3F5,#AEB4BB 46%,#80878F 54%,#CDD1D6);box-shadow:0 0 0 .75px #2A2F35,1px 2px 3px rgb(0 0 0 / .45)}
.lk-cp .c[data-wt=big] .rk{width:calc(${U} * 30);height:calc(${U} * 43)}
.lk-cp .rk button{all:unset;position:absolute;left:var(--rp);right:var(--rp);height:calc(50% - var(--rp) - .5px);display:flex;align-items:center;justify-content:center;cursor:pointer;-webkit-tap-highlight-color:transparent;
  border-radius:calc(${U} * 3.2);background:linear-gradient(180deg,#3A3C42,#1E1F23);box-shadow:inset 0 1px 0 rgb(255 255 255 / .14),inset 0 -1px 0 rgb(0 0 0 / .5)}
.lk-cp .rk button b{font:700 calc(${U} * 6.8)/1 var(--lk-ui);letter-spacing:0;color:#EEF0F4;text-shadow:none}
.lk-cp .c[data-wt=big] .rk button b{font-size:calc(${U} * 7.8)}
.lk-cp .rk button[data-h=up]{top:var(--rp)}.lk-cp .rk button[data-h=down]{bottom:var(--rp)}
.lk-cp .c.up .rk button[data-h=up],.lk-cp .c.down .rk button[data-h=down]{background:linear-gradient(180deg,#1B1C20,#2A2C31);box-shadow:inset 0 1px 2px rgb(0 0 0 / .7)}
.lk-cp .c.up .rk button[data-h=up] b,.lk-cp .c.down .rk button[data-h=down] b{color:#FFC23A;text-shadow:0 0 4px rgb(255 190 40 / .6)}
:root[data-lk-theme=night] .lk-cp .rk button b{color:rgb(255 170 150)}
:root[data-lk-theme=night] .lk-cp .c.up .rk button[data-h=up] b,:root[data-lk-theme=night] .lk-cp .c.down .rk button[data-h=down] b{color:rgb(255 110 90);text-shadow:0 0 4px rgb(255 90 70 / .6)}
.lk-cp .rk button:focus-visible{outline:var(--lk-line) solid var(--lk-lit);outline-offset:-1px;border-radius:calc(${U} * 3)}
/* the crew at work (a sail coming down, the chain running): a thin progress bar under the control */
.lk-cp .pg{position:absolute;left:18%;right:18%;bottom:calc(${U} * -3);height:calc(${U} * 2);border-radius:1px;background:rgb(255 255 255 / .12);opacity:0;transition:opacity .3s}
.lk-cp .pg i{display:block;height:100%;width:calc(var(--p,0) * 100%);background:rgb(var(--lk-amber));border-radius:1px}
.lk-cp .c.busy .pg{opacity:1}
/* MOOR wakes when a ball or a pier is near: it lights and pulses once */
.lk-cp .c.wake .o{animation:lk-wake 1.1s var(--lk-ease) 1}
@keyframes lk-wake{0%{transform:scale(1)}30%{transform:scale(1.14);filter:brightness(1.35)}100%{transform:scale(1)}}
.lk-cp .c[data-wt=small]:not(.dead) .w{opacity:.92}
.lk-cp .o{position:relative;display:block;width:calc(${U} * 32);height:calc(${U} * 32)}
/* the status LED by a toggle (ref: a breaker panel's lamp), small, at the control's upper right */
.lk-cp .led{position:absolute;right:calc(${U} * -3);top:calc(${U} * 8);width:calc(${U} * 16);height:calc(${U} * 16);background:${IS('ctl')} 0 100%/300% 300% no-repeat;pointer-events:none}
.lk-cp .c.on .led{background-position:50% 100%}
/* the engraved divider between the boat's switches and the tools */
.lk-cp .c.dv::before{content:'';position:absolute;left:calc(${U} * -1);top:calc(${U} * 2);bottom:calc(${U} * -2);width:1px;background:rgb(255 255 255 / .16);box-shadow:-1px 0 0 rgb(0 0 0 / .5)}
/* MOOR with no ball near: the switch is there, dead (a windlass with no chain) */
.lk-cp .c.dead{cursor:default}.lk-cp .c.dead .o{opacity:.55;filter:saturate(.3)}.lk-cp .c.dead .w{opacity:.62}
.lk-cp .c:focus-visible{outline:none}.lk-cp .c:focus-visible .o{outline:var(--lk-line) solid var(--lk-lit);outline-offset:1px;border-radius:50%}
.lk-cp .c:hover:not(.dead) .o{filter:brightness(1.08)}
:root[data-lk-theme=night] .lk-cp{color:rgb(255 140 120 / .92)}
:root[data-lk-theme=night] .lk-cp .led{background-image:${IS('ctl-night')}}
.lk-dim .lk-cp .w{opacity:.7}
.lk-cp .c[hidden]{display:none}
[data-input=touch] .lk-cp .c{min-height:44px;min-width:44px}
/* a finger: the whole rocker is the target (44 pt or more); the tap's half (above or below its middle) picks UP or DOWN */
[data-input=touch] .lk-cp .rk button{pointer-events:none}
[data-input=touch] .lk-cp .c[data-k=rocker]{cursor:pointer}
/* a phone's four keys (form 'keys'): one row, the words 10 px */
.lk-cp[data-form=keys] .w{font-size:10px;height:13px;line-height:13px}
[data-screen~=portrait]:where([data-screen~=compact]) .lk-cp[data-form=keys] .w{letter-spacing:.03em}   /* an upright 375 px phone: ANCHOR in its 45 px cell */
.lk-cp[data-form=keys] .c[data-wt=big] .w{font-size:11px}
.lk-cp[data-form=keys] .c[data-id=binoculars] .w{font-size:9px}
.lk-cp [hidden]{display:none!important}
/* the PANEL row (a phone): the rest of the switches as one row over the bottom, on navy glass; a tap outside closes it */
.lk-cpx{position:fixed;z-index:calc(var(--lk-z-dock) + 1);box-sizing:border-box;display:grid;grid-auto-flow:column;grid-auto-columns:1fr;align-items:center;justify-items:center;padding:6px 6px 4px;
  border-radius:16px;background:rgb(var(--lk-brand-navy) / .86);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--lk-glass-edge);box-shadow:var(--lk-glass-shadow);
  font:600 10px/1 var(--lk-ui);letter-spacing:.1em;color:rgb(242 244 250 / .93);-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none;--cp-u:1.1px;
  opacity:1;transform:none;transition:opacity var(--lk-in) var(--lk-ease),transform var(--lk-in) var(--lk-ease)}
.lk-cpx[hidden]{display:grid;opacity:0;transform:translateY(8px);pointer-events:none}
.lk-cpx[hidden] *{pointer-events:none!important}
.lk-cpx .c{all:unset;position:relative;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;gap:3px;min-width:44px;min-height:44px;cursor:pointer;-webkit-tap-highlight-color:transparent;touch-action:manipulation}
.lk-cpx .w{display:block;height:12px;line-height:12px;white-space:nowrap}
.lk-cpx .c[data-id=binoculars] .w{letter-spacing:.02em;font-size:9px}
.lk-cpx .o{position:relative;display:block;width:36px;height:36px}
.lk-cpx .c.dead{cursor:default}.lk-cpx .c.dead .o{opacity:.55;filter:saturate(.3)}.lk-cpx .c.dead .w{opacity:.62}
.lk-cpx .pg{display:none}
:root[data-lk-theme=night] .lk-cpx{color:rgb(255 140 120 / .92)}
@media (prefers-reduced-motion:reduce){.lk-cp{transition:none}}
/* the cockpit (cockpit3d.js): no picture, only the hit layer; each cell sits on its 3D switch, the focus ring stays visible */
.lk-cp[data-form=cockpit]{display:block;padding:0;filter:none;pointer-events:none;background:none}
.lk-cp[data-form=cockpit] .c{position:absolute;display:block;pointer-events:auto;border-radius:10px}
.lk-cp[data-form=cockpit] .c>:not(.rk),.lk-cp[data-form=cockpit] .rk button b{opacity:0!important}
.lk-cp[data-form=cockpit] .rk{position:absolute;inset:0;width:auto;height:auto;background:none!important;box-shadow:none!important}
.lk-cp[data-form=cockpit] .rk button{background:none!important;box-shadow:none!important;left:0;right:0}
.lk-cp[data-form=cockpit] .c:focus-visible,.lk-cp[data-form=cockpit] .c:has(:focus-visible){outline:2px solid rgb(var(--lk-amber) / .9);outline-offset:-2px}
.lk-cp[data-form=cockpit] .c:focus-visible .o{outline:none}
`;

// lit: per id, the control's state now (a rocker: true = DOWN); progress: per id, 0–1 while the crew works, else null; onPress(id, via): the playtest's count
export function createControlPanel({ dock, lit = {}, progress = {}, onPress = null, root = document.body, hidden = () => false } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-cp-css')) { const st = document.createElement('style'); st.id = 'lk-cp-css'; st.textContent = CSS; document.head.appendChild(st); }
  document.documentElement.classList.add('lk-cpanel');
  if (!document.getElementById('lk-cp-defs')) document.body.insertAdjacentHTML('beforeend', DEFS);   // the caps' shared gradients
  const el = document.createElement('div'); el.className = 'lk-cp'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'control panel');
  const cellHtml = ([id, word, kind, wt, extra]) => (kind === 'rocker'
    ? `<div class="c" data-id="${id}" data-k="rocker" data-wt="${wt}" role="group" aria-label="${word.toLowerCase()}"><span class="w">${word}</span><span class="rk">`
      + `<button type="button" data-h="up" aria-label="${extra.up}"><b aria-hidden="true">UP</b></button><button type="button" data-h="down" aria-label="${extra.down}"><b aria-hidden="true">DOWN</b></button></span><span class="pg"><i></i></span></div>`
    : `<button type="button" class="c" data-id="${id}" data-k="push" data-wt="${wt}"><span class="w">${word}</span>`
      + `<span class="o" aria-hidden="true">${capSvg(CAP_ICONS[extra] ?? '')}</span><span class="pg"><i></i></span></button>`);
  const SPEC = Object.fromEntries([...PANEL, ...PHONE_CELLS].map((p) => [p[0], p]));
  el.innerHTML = PANEL.map(cellHtml).join('') + PHONE_CELLS.slice(0, 2).map(cellHtml).join('') + cellHtml(SPEC.engine);
  root.appendChild(el);
  // the PANEL row (a phone): its own copies of the moved switches, in PANEL_MORE's order
  const row = document.createElement('div'); row.className = 'lk-cpx'; row.hidden = true; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'panel');
  row.innerHTML = PANEL_MORE.map((id) => cellHtml(SPEC[id])).join('');
  root.appendChild(row);
  const cells = [...el.querySelectorAll('.c'), ...row.querySelectorAll('.c')];
  // the page's one tip (tips.js; Solaria stage 1): each control's name and key above it on a hover or a long-press, the cockpit's
  // hit layer included (its words are the 3D panel's engraving); the click that ends a long-press is not a press
  const tips = sharedTips();
  for (const c of cells) tips.add(c, { side: 'up' });
  let form = 'grid';
  const openRow = (on) => { row.hidden = !on; el.querySelector('.c[data-id=more]')?.classList.toggle('on', !!on); };
  // a tap outside the row (and outside PANEL itself) closes it
  addEventListener('pointerdown', (e) => { if (!row.hidden && !row.contains(e.target) && !e.target.closest?.('.lk-cp .c[data-id=more]')) openRow(false); }, { capture: true });
  const press = (id, via) => { onPress?.(id, via); };
  // A finger on the cockpit's hit layer (owner, 2026-11-15: the toggles were hard to throw back): the press is the finger's own
  // pointerdown and pointerup on the cell, within FINGER_TAP.slopPx, not the browser's click (which a long-press tip ate, and
  // which a phone's gesture engine may hold or drop between two quick taps); the click that follows is swallowed
  const tapOf = new WeakMap(), acts = new WeakMap();
  const act = (c) => acts.get(c)?.();
  const fingerTap = (c, e) => form === 'cockpit' && e.pointerType === 'touch' && !c.classList.contains('dead');
  const swallowed = (c, e) => { const tp = tapOf.get(c); if (tp?.done && e.timeStamp - tp.done < FINGER_TAP.clickMs) { e.stopPropagation(); e.preventDefault?.(); return true; } return false; };
  for (const c of cells) {
    c.addEventListener('pointerdown', (e) => {
      e.stopPropagation();   // not the camera's press, not a course
      if (!fingerTap(c, e)) return;
      tapOf.set(c, { id: e.pointerId, x: e.clientX, y: e.clientY, done: 0 });
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    });
    c.addEventListener('pointerup', (e) => {
      const tp = tapOf.get(c);
      if (!tp || tp.id !== e.pointerId || tp.done || form !== 'cockpit') return;
      tp.id = null;
      if (Math.hypot(e.clientX - tp.x, e.clientY - tp.y) > FINGER_TAP.slopPx) return;
      tp.done = e.timeStamp || 1; e.stopPropagation();
      act(c);
    });
    c.addEventListener('pointercancel', () => { const tp = tapOf.get(c); if (tp) tp.id = null; });
    if (c.dataset.k === 'rocker') {
      // a half: UP wants the rocker's "up" state, DOWN its "down"; only a change runs the action (the Y / J keys toggle as before)
      const half = (want) => {
        const now = c.classList.contains('down') ? 'down' : 'up';
        if (want !== now) { dock.run(c.dataset.id); press(c.dataset.id, want); }
        else dispatchEvent(new Event('lk-click'));
      };
      acts.set(c, () => half(c.classList.contains('down') ? 'up' : 'down'));   // the cockpit's toggle: a tap throws it
      for (const b of c.querySelectorAll('.rk button')) b.addEventListener('click', (e) => { if (swallowed(c, e)) return; e.stopPropagation(); b.blur(); if (tips.consumed(c)) return; half(form === 'cockpit' && e.detail > 0 ? (c.classList.contains('down') ? 'up' : 'down') : b.dataset.h); });   // the cockpit's toggle: a click throws it (a key press keeps its half)
      // a finger: the whole cell is the target; the half is the side of the rocker's middle the tap fell on
      c.addEventListener('click', (e) => {
        if (swallowed(c, e)) return;
        if (tips.consumed(c)) { e.stopPropagation(); return; }
        if (form === 'cockpit') { e.stopPropagation(); if (e.target.closest('.rk button')) return; half(c.classList.contains('down') ? 'up' : 'down'); return; }   // the toggle: a click throws it
        if (e.target.closest('.rk button') && !document.documentElement.dataset.input === 'touch') return;
        e.stopPropagation();
        const r = c.querySelector('.rk').getBoundingClientRect();
        half(e.clientY < r.top + r.height / 2 ? 'up' : 'down');
      });
    } else {
      const push = () => {
        if (c.classList.contains('dead')) return;
        const id = c.dataset.alt || c.dataset.id;
        if (id === 'more') { openRow(row.hidden); dispatchEvent(new Event('lk-click')); press('more', 'push'); return; }
        dock.run(id); press(id, 'push');
        if (row.contains(c) && id !== 'reef') openRow(false);   // the row closes behind a choice (REEF steps: in, a second, out)
      };
      acts.set(c, push);
      c.addEventListener('click', (e) => {
        if (swallowed(c, e)) return;
        e.stopPropagation(); c.blur();
        if (tips.consumed(c)) return;
        push();
      });
    }
  }
  let thr = null;   // the throttle lever (throttleLever.js): its own column; it hides with the panel
  const attach = (col) => { thr = col; };
  const place = (r, f = 'grid', lay = null) => {
    if (!r) return;
    form = f;
    if (f === 'cockpit') {
      const show = panelCells(f);
      openRow(false);
      for (const c of el.querySelectorAll('.c')) { c.hidden = !show.main.includes(c.dataset.id) || !lay?.cells?.[c.dataset.id]; c.style.order = ''; }
      Object.assign(el.style, { left: '0px', top: '0px', width: '0px', height: '0px', gridTemplateColumns: '', gridTemplateRows: '', rowGap: '' });
      el.dataset.form = f;
      for (const [id, cr] of Object.entries(lay?.cells ?? {})) {
        const c = el.querySelector(`.c[data-id=${id}]`); if (!c) continue;
        Object.assign(c.style, { left: `${cr.x}px`, top: `${cr.y}px`, width: `${cr.w}px`, height: `${cr.h}px` });
      }
      return;
    }
    for (const c of el.querySelectorAll('.c')) Object.assign(c.style, { left: '', top: '', width: '', height: '' });
    const show = panelCells(f);
    for (const c of el.querySelectorAll('.c')) c.hidden = !show.main.includes(c.dataset.id);
    for (const [i, id] of show.main.entries()) el.querySelector(`.c[data-id=${id}]`).style.order = String(i);
    if (!show.more) openRow(false);
    const cols = f === 'grid' ? 3 : show.main.length;
    const u = lay?.cpU ?? (f === 'grid' ? r.w / 192 : Math.min(r.h / 50, r.w / (cols * 52)));   // an upright phone sets its own (portraitLayout)
    el.style.setProperty('--cp-u', `${Math.max(0.6, u).toFixed(3)}px`);
    Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px`, gridTemplateColumns: `repeat(${cols},1fr)`, rowGap: f === 'grid' ? `calc(${U} * 4)` : '0', gridTemplateRows: f === 'grid' ? 'auto auto' : '' });
    el.dataset.form = f;
    const m = lay?.more;
    if (m) Object.assign(row.style, { left: `${m.x}px`, top: `${m.y}px`, width: `${m.w}px`, height: `${m.h}px` });
  };
  function update(dt) {
    const off = hidden();
    el.classList.toggle('off', off);
    if (off && !row.hidden) openRow(false);
    thr?.hide?.(off); thr?.update(dt);
    // every frame (five cells): a press shows on the control at once (owner, 2026-10-30: within 150 ms)
    // MOOR's slot is DAWN while at anchor after dark (the key-cleanup's "wait for dawn" button; MOOR is dead there anyway)
    { const dawn = dock.visible('dawn') && !dock.visible('lines'); for (const m of cells.filter((c) => c.dataset.id === 'lines'))
      if (m && (m.dataset.alt === 'dawn') !== dawn) { if (dawn) m.dataset.alt = 'dawn'; else delete m.dataset.alt; m.querySelector('.w').textContent = dawn ? 'DAWN' : 'MOOR'; } }
    for (const c of cells) {
      if (c.hidden || (row.hidden && row.contains(c))) continue;
      if (c.dataset.id === 'more') { c.classList.toggle('on', !row.hidden); c.setAttribute('aria-pressed', String(!row.hidden)); c.setAttribute('aria-expanded', String(!row.hidden)); c.setAttribute('aria-label', document.documentElement.dataset.hand === 'touch' ? 'panel: VHF, reef, moor, trim, log' : 'panel: binoculars, VHF, reef, moor, trim, log'); continue; }   // a finger has no binoculars (src/ui/hand.js HAND_CSS)
      const id = c.dataset.alt || c.dataset.id, spec = dock.spec(id);
      const live = !!spec && dock.visible(id);
      if (live && c.classList.contains('dead') && c.dataset.wt === 'small') { c.classList.remove('wake'); void c.offsetWidth; c.classList.add('wake'); }   // MOOR wakes: one pulse
      c.classList.toggle('dead', !live);
      let on = false;
      try { on = !!(lit[id] ? lit[id]() : spec?.lit?.()); } catch { /* not ready */ }
      if (c.dataset.k === 'rocker') { c.classList.toggle('down', on); c.classList.toggle('up', !on); }
      else { c.classList.toggle('on', on && live); c.setAttribute('aria-pressed', String(on)); }
      let p = null; try { p = progress[id]?.() ?? null; } catch { /* not ready */ }
      c.classList.toggle('busy', p != null); if (p != null) c.style.setProperty('--p', p.toFixed(2));
      if (spec) c.setAttribute('aria-label', `${spec.label?.() ?? spec.name}${spec.key ? ` (${spec.key})` : ''}`);   // label(): a state in the words (v2's REEF: one reef in)   // read aloud, and the tip's words on a hover or a long-press (tips.js; owner 2026-11-06, Solaria stage 1)
    }
  }
  return { el, row, place, update, attach, open: openRow, get form() { return form; }, get rowOpen() { return !row.hidden; },
    get cells() { return cells.map((c) => ({ id: c.dataset.id, inRow: row.contains(c), on: c.classList.contains('on') || c.classList.contains('down'), dead: c.classList.contains('dead'), busy: c.classList.contains('busy'), hidden: c.hidden })); },
    dispose() { for (const c of cells) tips.forget(c); el.remove(); row.remove(); document.documentElement.classList.remove('lk-cpanel'); } };
}
