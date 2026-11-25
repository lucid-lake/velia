// The two dials as 2D modules of their own (?dials=modules, the mock stage): the chart dial (src/ui/chartplotter.js .small) and the
// wind dial (src/ui/captainView.js .lk-cv) leave the cockpit. Desktop and tablet: bottom-left and bottom-right at the size a dial grew
// to when the pointer rested on it (0.8 × --lk-d), each centred over its coaming end's plain face (station.js moduleFrame), the
// edge columns lifted clear above them; the helm view keeps their size; a tablet (no cockpit) keeps the wind module left of its sheet
// buttons; a phone keeps flat.js's compact corners under the top bar (the point of sail and the ring
// only when a tap enlarges the wind dial). Shown in Sail and Regatta (Calm dims them after its idle, never hides them), not in Cruise, hidden in Clear and while
// Tessie is played. The cockpit's own dial faces go plain glass (ui/station.js, render/cockpit/rig.js inst.plain).
//   const dm = createDialModules({ calm, inMode: () => true, played: () => false });   // inMode: the mode shows them (Sail, Regatta)
//   dm.update()       // each frame: the html classes lk-dm-off and lk-dm-dim
//   open: { chart(), log() }   a click on a module opens its page (the chart dial the chart, the wind dial the logbook; a phone's
//                     flat.js buttons keep their own taps)
//   dm.state          // { off, dim }
export const DIAL_MODULES = Object.freeze({
  k: 0.8,          // × --lk-d: the raised (hover) size the cockpit's dials grew to (station.js instFrame's D)
  dim: 0.45,       // the modules' opacity in Calm after its idle
  lift: 12,        // px above --lk-by: the circle and its bezel clear the cockpit's fold tabs (⌄) in the bottom corners
  hands: 92,       // px from the right edge: a tablet's sheet buttons (ui/touch.js #hands .sheet: right 16, 64 wide) and a 12 px gap
  gap: 12,         // px: the edge columns (the nav column, the key legend) stand this far above the modules
});

const CSS = `
:root.lk-dm{--lk-dmd:round(calc(var(--lk-d) * ${DIAL_MODULES.k}),1px)}
:root.lk-dm[data-lk-view=helm]{--lk-dm:1}
:root.lk-dm[data-lk-view=helm][data-lk-text=large]{--lk-dm:1.12}
:root.lk-dm.lk-dm:not(.lk-flat){--lk-edge-foot:calc(var(--lk-by) + ${DIAL_MODULES.lift}px + var(--lk-dmd) + ${DIAL_MODULES.gap}px)}
:root.lk-dm.lk-dm:not(.lk-flat):not(.lk-flat) .lk-chart .small{left:calc(var(--lk-dm-cx,calc(var(--lk-mx) + var(--lk-sal,0px) + var(--lk-dmd) / 2)) - var(--lk-dmd) / 2);bottom:calc(var(--lk-by) + ${DIAL_MODULES.lift}px);top:auto;right:auto;width:var(--lk-dmd);height:var(--lk-dmd);transform:none;
  box-shadow:0 0 0 3px #2A2E34,0 0 0 4.5px #9AA1A8,0 10px 20px rgb(0 0 0 / .4)}
:root.lk-dm.lk-dm:not(.lk-flat):not(.lk-flat) .lk-cv{--d:var(--lk-dmd);left:calc(var(--lk-dm-wx,calc(100vw - var(--lk-mx) - var(--lk-sar,0px) - var(--lk-dmd) / 2)) - var(--lk-dmd) / 2);bottom:calc(var(--lk-by) + ${DIAL_MODULES.lift}px);top:auto;right:auto;transform:none;
  box-shadow:0 0 0 3.5px #2A2E34,0 0 0 5px #9AA1A8,0 10px 20px rgb(0 0 0 / .4)}
:root.lk-dm.lk-dm:not(.lk-flat):not(.lk-cockpit):has(#hands) .lk-cv{left:calc(100vw - ${DIAL_MODULES.hands}px - var(--lk-sar,0px) - var(--lk-dmd))}
:root.lk-dm :is(.lk-cv,.lk-chart .small){visibility:visible!important;opacity:1!important;transition:opacity var(--lk-calm-fade,.6s) ease}
/* Calm's dash rule hides the chart's whole layer (calmHud.js DASH): the module keeps it (the enlarged chart's own pane is not affected) */
html.lk-dm.lk-dm.lk-dm:is(.lk-calm-dash,.lk-puck-chart):not(.lk-dm-off):not(.v2-rg-hub):not(.lk-bino-up):not(.lk-intro-on) .lk-chart{opacity:1!important;visibility:visible!important}
:root.lk-dm.lk-dm-dim :is(.lk-cv,.lk-chart .small){opacity:${DIAL_MODULES.dim}!important}
:root.lk-dm.lk-dm-off :is(.lk-cv,.lk-chart .small){opacity:0!important;visibility:hidden!important;pointer-events:none!important}
/* the pages and moments that clear the screen keep doing so: Regatta's hub, the binoculars, the cinematic intro (the whole of it: lk-intro-on, set by ui/cinematicIntro.js from its start to its handover), the
   home card over the live lake (their own rules hid .lk-cv and .lk-chart; the modules' visible rule above would outrank them) */
:root.lk-dm.lk-dm.lk-dm:is(.v2-rg-hub,.lk-bino-up,.lk-intro-on) :is(.lk-cv,.lk-chart .small),
:root.lk-dm:has(#lk-load[data-reel-end=live][data-state=home]) :is(.lk-cv,.lk-chart .small){opacity:0!important;visibility:hidden!important;pointer-events:none!important}
:root.lk-dm button.lk-puck{display:none!important}
/* a click opens the dial's page (owner, 2026-11-17): the wind face takes the pointer too (its sail lines and rudder still drag) */
:root.lk-dm:not(.lk-flat):not(.lk-dm-off) .lk-cv .dial{pointer-events:auto;cursor:pointer}
:root.lk-dm:not(.lk-flat):not(.lk-dm-off) .lk-chart .small{cursor:pointer}
/* a phone's compact wind dial (flat.js): the readings as before; the point of sail and the sector ring only once a tap enlarges it */
:root.lk-dm.lk-flat:not(.lk-fl-wup) .lk-cv :is(.rw.pos,.sect){display:none}
:root.lk-dm.lk-flat:not(.lk-fl-wup) .lk-cv.pos .inr{bottom:12%}
/* the enlarged wind dial covers the "⋯" button under it: the button steps out while the dial is up (a second tap on the dial brings it back) */
:root.lk-dm.lk-flat.lk-fl-wup .lk-flat .b.more{opacity:0!important;pointer-events:none!important}
`;

export function dialModuleState({ inMode = true, preset = 'calm', dash = true, played = false } = {}) {
  const off = !inMode || preset === 'clear' || played;
  return { off, dim: !off && (preset === 'calm' || preset === 'auto') && !dash };
}

export function createDialModules({ calm = null, inMode = () => true, played = () => false, open = null, doc = document } = {}) {
  if (!doc.getElementById('lk-dm-css')) { const st = doc.createElement('style'); st.id = 'lk-dm-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const H = doc.documentElement;
  H.classList.add('lk-dm');
  let state = { off: false, dim: false };
  // the clicks: in the capture phase, ahead of the chart's own pointerdown (it pins the old enlarged chart) and the page's look drag
  const desk = () => !H.classList.contains('lk-flat') && !state.off;
  let windDown = false;
  const onDown = (e) => {
    if (!open || !desk() || e.button > 0) return;
    const t = e.target;
    if (t?.closest?.('.lk-chart .small') && !t.closest('button')) { e.stopPropagation(); e.preventDefault(); open.chart?.(); return; }
    windDown = !!t?.closest?.('.lk-cv .dial') && !t.closest('.hit');
  };
  const onClick = (e) => { if (open && windDown && desk() && e.target?.closest?.('.lk-cv .dial') && !e.target.closest('.hit')) open.log?.(); windDown = false; };
  doc.defaultView?.addEventListener('pointerdown', onDown, { capture: true });
  doc.defaultView?.addEventListener('click', onClick, { capture: true });
  return {
    update() {
      const v = calm?.view ?? {};
      const next = dialModuleState({ inMode: !!inMode(), preset: calm?.mode ?? 'calm', dash: v.dash !== false, played: !!played() });
      if (next.off !== state.off) H.classList.toggle('lk-dm-off', next.off);
      if (next.dim !== state.dim) H.classList.toggle('lk-dm-dim', next.dim);
      state = next;
    },
    get state() { return { ...state }; },
    dispose() { H.classList.remove('lk-dm', 'lk-dm-off', 'lk-dm-dim'); doc.defaultView?.removeEventListener('pointerdown', onDown, { capture: true }); doc.defaultView?.removeEventListener('click', onClick, { capture: true }); },
  };
}
