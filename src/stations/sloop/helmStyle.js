// The helm station's stylesheet and its sail-leaf marker (refactor round 2, Phase D: moved unchanged from helmStation.js).

import { FOLD_CSS } from './foldButton.js';
export const LEAF = '<svg viewBox="0 0 20 24" aria-hidden="true"><path class="sail" d="M5 2.5C11 7 15.5 14 16.5 21.5H5Z"/><path class="flat" d="M5 2.5 16.5 21.5H5Z"/><path class="mast" d="M5 1.5v21"/></svg>';
export const CSS = `
.lk-helm{position:fixed;inset:0;z-index:var(--lk-z-hud);pointer-events:none;user-select:none;-webkit-user-select:none;font:var(--lk-medium) var(--lk-fs-caption)/1 var(--lk-ui);color:var(--lk-ink);
  opacity:1;transition:opacity var(--lk-in) var(--lk-ease)}
.lk-helm.off{opacity:0;transition:opacity var(--lk-out) var(--lk-ease-out)}
.lk-helm.off *{pointer-events:none!important}
.lk-helm .pad{position:absolute;pointer-events:auto;border-radius:50%;touch-action:none;cursor:grab;-webkit-tap-highlight-color:transparent;outline:none}
.lk-helm .pad.held{cursor:grabbing}
.lk-helm .pad.steer{border-radius:0;cursor:ew-resize}
.lk-helm .pad.steer[hidden]{display:none}
.lk-helm .pad:focus-visible{box-shadow:0 0 0 var(--lk-line) rgb(var(--lk-amber) / .9)}
.lk-helm .wheel.gone{opacity:0;pointer-events:none}
/* the rudder angle under the hub while the wheel is in the hand */
.lk-helm .rd{position:absolute;transform:translate(-50%,0);padding:.25em .55em;border-radius:.35em;background:var(--lk-glass-dense);font-variant-numeric:tabular-nums;font-size:var(--lk-fs-caption);
  opacity:0;transition:opacity .3s;white-space:nowrap;display:flex;gap:.35em;align-items:center}
.lk-helm .rd.in{opacity:1;transition:opacity .1s}
.lk-helm .rd em{font-style:normal;padding:.08em .35em;border-radius:.25em;color:rgb(var(--lk-brand-navy));font-weight:var(--lk-medium)}
.lk-helm .rd em.p{background:rgb(var(--lk-port))}.lk-helm .rd em.s{background:rgb(var(--lk-stbd))}.lk-helm .rd em:empty{display:none}
/* the label tape: cream embossed tape with navy capitals, as a crew labels a winch */
.lk-helm .tape{position:absolute;transform:translate(-50%,0);padding:.18em .5em .14em;border-radius:2px;background:linear-gradient(180deg,#f3ecdc,#e3dac6);color:rgb(var(--lk-brand-navy));
  font-weight:600;font-size:calc(var(--lk-hu,1px) * 9.5);letter-spacing:.16em;line-height:1;box-shadow:0 1px 2px rgb(0 0 0 / .45),inset 0 -1px 0 rgb(0 0 0 / .12);white-space:nowrap}
:root[data-lk-theme=night] .lk-helm .tape{background:linear-gradient(180deg,#5a1d18,#48150f);color:rgb(255 140 120)}
/* the sail leaf: green drawing, amber luffing (a fluttering dash), amber and flat stalled, faint when the sails are down */
.lk-helm .leaf{position:absolute;width:calc(var(--lk-hu,1px) * 20);height:calc(var(--lk-hu,1px) * 24);transform:translate(-50%,-50%);filter:drop-shadow(0 1px 1.5px rgb(0 0 0 / .55))}
.lk-helm .leaf svg{width:100%;height:100%;overflow:visible}
.lk-helm .leaf .mast{stroke:rgb(var(--lk-cream) / .9);stroke-width:1.6;stroke-linecap:round;fill:none}
.lk-helm .leaf .sail,.lk-helm .leaf .flat{stroke-width:1.4;stroke-linejoin:round}
.lk-helm .leaf .flat{display:none}
.lk-helm .leaf[data-s=draw] .sail{fill:rgb(var(--lk-stbd));stroke:rgb(var(--lk-stbd))}
.lk-helm .leaf[data-s=draw]{filter:drop-shadow(0 0 3px rgb(var(--lk-stbd) / .6)) drop-shadow(0 1px 1.5px rgb(0 0 0 / .55))}
.lk-helm .leaf[data-s=luff] .sail{fill:rgb(var(--lk-amber) / .45);stroke:rgb(var(--lk-amber));stroke-dasharray:2.4 1.8;animation:lk-luff .42s linear infinite}
.lk-helm .leaf[data-s=stall] .sail{display:none}
.lk-helm .leaf[data-s=stall] .flat{display:block;fill:rgb(var(--lk-amber) / .85);stroke:rgb(var(--lk-amber))}
.lk-helm .leaf[data-s=off]{opacity:.35}.lk-helm .leaf[data-s=off] .sail{fill:rgb(var(--lk-cream) / .3);stroke:rgb(var(--lk-cream) / .6)}
@keyframes lk-luff{to{stroke-dashoffset:-4.2}}
/* the step buttons: on hover or focus (always on a touch screen with room) */
.lk-helm .stp{position:absolute;pointer-events:auto;display:flex;flex-direction:column;gap:calc(var(--lk-hu,1px) * 22);opacity:0;transition:opacity .2s}
.lk-helm .grp:hover .stp,.lk-helm .grp.hov .stp,.lk-helm .grp:focus-within .stp{opacity:1}
.lk-helm [hidden]{display:none!important}
.lk-helm .stp button{all:unset;box-sizing:border-box;display:flex;align-items:center;justify-content:center;width:calc(var(--lk-hu,1px) * 28);height:calc(var(--lk-hu,1px) * 28);min-width:28px;min-height:28px;border-radius:50%;cursor:pointer;
  background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);color:var(--lk-ink);font-size:calc(var(--lk-hu,1px) * 11);touch-action:none;-webkit-tap-highlight-color:transparent}
.lk-helm .stp button:hover{border-color:rgb(var(--lk-cream) / .6)}
.lk-helm .stp button:active,.lk-helm .stp button.on{background:rgb(var(--lk-cream) / .22)}
[data-input=touch] .lk-helm .stp button{min-width:44px;min-height:44px}
.lk-helm .stp.row{flex-direction:row;gap:8px}
.lk-helm .grp{position:absolute;pointer-events:none}
.lk-helm .stp[hidden]{display:none}
/* the trim readout (owner, 2026-10-30: obvious feedback): over the winch while the sheet is worked, gone 1 s after */
.lk-helm .ro{position:absolute;transform:translate(-50%,0);padding:.25em .55em;border-radius:.35em;background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);
  font-size:var(--lk-fs-caption);font-variant-numeric:tabular-nums;white-space:nowrap;opacity:0;transition:opacity .35s}
.lk-helm .ro.in{opacity:1;transition:opacity .08s}
.lk-helm .ro b{font-weight:600;letter-spacing:.08em}
.lk-dim .lk-helm .tape{opacity:.75}
/* the binoculars' view is HUD-less: the chart circle steps out with the rest */
.lk-bino-up .lk-chart .small{opacity:0!important;pointer-events:none!important;transition:opacity .3s}
@media (prefers-reduced-motion:reduce){.lk-helm .leaf[data-s=luff] .sail{animation:none}.lk-helm{transition:none}}
/* the cockpit (cockpit3d.js): the DOM is the hit layer; the engraved words and the 3D parts are the picture */
.lk-cockpit .lk-helm .tape{display:none}
.lk-cockpit .lk-helm .pad:focus-visible{box-shadow:0 0 0 2px rgb(var(--lk-amber) / .9)}
/* the top (layout B): the chart dial top-left, the wind dial top-right, at 90 %, clear of the bar */
:root.lk-cockpit:not(.lk-dials-in) .lk-chart .small{left:var(--lk-ck-dx,26px);top:var(--lk-ck-dy,12px);right:auto;bottom:auto;transform:scale(.9);transform-origin:0 0}
:root.lk-cockpit:not(.lk-dials-in) .lk-cv{right:var(--lk-ck-dx,26px);top:var(--lk-ck-dy,12px);left:auto;bottom:auto;transform:scale(.9);transform-origin:100% 0}
/* the skipper's line with the cockpit (owner, 2026-11-06, stage 1b): back up just under the top bar, quieter. 72 % of the old size,
   a lighter weight, cream at 85 % with a soft shadow (no stroke, no plate), one line up to half the screen (a second grows
   downward), a gentle fade; the key chips smaller to match. Only on a desktop with the cockpit: phones and Cruise keep theirs */
:root.lk-cockpit .lk-hint:not(:has(.list)){top:var(--lk-cap-top);bottom:auto;max-width:50vw;font-size:calc(clamp(17px,min(4.2vh,3.4vw),46px) * var(--lk-sub-k) * .72)}
:root.lk-cockpit .lk-hint > .row{--sub-ink:rgb(var(--lk-cream) / .85);color:var(--sub-ink);font-weight:calc(var(--lk-sub-w) - 100);-webkit-text-stroke:0;
  text-shadow:0 1px 2px rgb(var(--lk-shade) / .75),0 0 10px rgb(var(--lk-shade) / .5),0 0 22px rgb(var(--lk-shade) / .3);transition:opacity .8s var(--lk-ease),transform .8s var(--lk-ease)}
:root.lk-cockpit .lk-hint .say,:root.lk-cockpit .lk-hint .say .tag{color:var(--sub-ink)}
:root.lk-cockpit .lk-hint > .row .cap{font-size:.5em;opacity:.8;border-color:rgb(var(--lk-cream) / .55);background:rgb(var(--lk-brand-navy) / .6)}
/* the instruments (feat/cockpit-dials): the dials live in the coaming's ends as 3D instruments (cockpit3d.js); the DOM dials are
   their full views, hidden at the instrument's face and raised from it (hover, a tap, a winch's drag), their foot on its head.
   --lk-i{c,w}-x/y: the raised box's left/top; -dy: the face's centre below the raised centre; -s0: the face's size / the box's */
:root.lk-cockpit.lk-dials-in .lk-chart .small{left:var(--lk-ic-x);top:var(--lk-ic-y);width:var(--lk-ic-d);height:var(--lk-ic-d);right:auto;bottom:auto;transform-origin:50% 50%;transform:none;
  box-shadow:0 0 0 3px #2A2E34,0 0 0 4.5px #9AA1A8,0 14px 24px rgb(0 0 0 / .45);transition:transform .36s var(--lk-ease),opacity .2s linear}
:root.lk-cockpit.lk-dials-in .lk-cv{left:var(--lk-iw-x);top:var(--lk-iw-y);right:auto;bottom:auto;transform-origin:50% 50%;transform:scale(var(--lk-iw-s1,.8));
  box-shadow:0 0 0 3.5px #2A2E34,0 0 0 5px #9AA1A8,0 14px 24px rgb(0 0 0 / .45);transition:transform .36s var(--lk-ease),opacity .2s linear}
:root.lk-cockpit.lk-dials-in:not(.lk-raise-chart) .lk-chart .small{transform:translate(0,var(--lk-ic-dy)) scale(var(--lk-ic-s0));opacity:0!important;visibility:hidden;pointer-events:none!important;
  transition:transform .36s var(--lk-ease),opacity .22s linear .1s,visibility 0s linear .36s}
:root.lk-cockpit.lk-dials-in:not(.lk-raise-wind) .lk-cv{transform:translate(0,var(--lk-iw-dy)) scale(var(--lk-iw-s0));opacity:0!important;visibility:hidden;
  transition:transform .36s var(--lk-ease),opacity .22s linear .1s,visibility 0s linear .36s}
:root.lk-cockpit.lk-dials-in:not(.lk-raise-wind) .lk-cv *{pointer-events:none!important}
@media (prefers-reduced-motion:reduce){:root.lk-cockpit.lk-dials-in :is(.lk-cv,.lk-chart .small){transition:none!important}}
/* the instruments' hit and accessibility layer: a round target over each face (≥ 44 px) */
.lk-helm button.lk-inst{all:unset;position:absolute;box-sizing:border-box;pointer-events:auto;cursor:pointer;border-radius:50%;-webkit-tap-highlight-color:transparent}
.lk-helm button.lk-inst:focus-visible{box-shadow:0 0 0 2px rgb(var(--lk-amber) / .9)}
.lk-helm button.lk-inst[hidden]{display:none}
/* the sail's flag only while it luffs or stalls (amber); hidden while it draws or the sails are down */
.lk-cockpit .lk-helm .leaf{transition:opacity .3s var(--lk-ease)}
.lk-cockpit .lk-helm .leaf:is([data-s=draw],[data-s=off]){opacity:0}
/* the ▲ ▼ steps: only while the pointer is over that winch (a desktop; touch layouts keep theirs). A finger's row (.row, on
   lk-touch) stays up: this rule caught it too (BACKLOG-v2 #50, v2's #30), so its 44 px steps sat at opacity 0 with no pointer
   events and a tap fell through to the canvas under them. Only the buttons take the finger: the row's 8 px gap and its box stay
   the thumb's steering ground under it */
.lk-cockpit .lk-helm .stp{transition:opacity .25s var(--lk-ease)}
.lk-cockpit .lk-helm .grp:not(:hover):not(.hov):not(:focus-within) .stp:not(.row){opacity:0;pointer-events:none}
:root[data-input=touch].lk-cockpit .lk-helm .stp.row{opacity:1;pointer-events:none}
:root[data-input=touch].lk-cockpit .lk-helm .stp.row button{pointer-events:auto}
/* the fold button (foldButton.js): its rules ride in this sheet, so the head keeps its children */
${FOLD_CSS}
`;
