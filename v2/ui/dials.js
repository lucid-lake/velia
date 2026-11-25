// The two dials as 2D modules of their own (?dials=modules, the mock stage): the chart dial (src/ui/chartplotter.js .small) and the
// wind dial (src/ui/captainView.js .lk-cv) leave the cockpit. Desktop and tablet: bottom-left and bottom-right at the size a dial grew
// to when the pointer rested on it (0.8 × --lk-d), each centred over its coaming end's plain face (station.js moduleFrame), the
// edge columns lifted clear above them; a phone keeps flat.js's compact corners under the top bar (the point of sail and the ring
// only when a tap enlarges the wind dial). Shown in Sail and Regatta (Calm dims them after its idle, never hides them), not in Cruise, hidden in Clear and while
// Tessie is played. The cockpit's own dial faces go plain glass (ui/station.js, render/cockpit/rig.js inst.plain).
//   const dm = createDialModules({ calm, inMode: () => true, played: () => false });   // inMode: the mode shows them (Sail, Regatta)
//   dm.update()       // each frame: the html classes lk-dm-off and lk-dm-dim
//   dm.state          // { off, dim }
export const DIAL_MODULES = Object.freeze({
  k: 0.8,          // × --lk-d: the raised (hover) size the cockpit's dials grew to (station.js instFrame's D)
  dim: 0.45,       // the modules' opacity in Calm after its idle
  lift: 12,        // px above --lk-by: the circle and its bezel clear the cockpit's fold tabs (⌄) in the bottom corners
  gap: 12,         // px: the edge columns (the nav column, the key legend) stand this far above the modules
});

const CSS = `
:root.lk-dm{--lk-dmd:round(calc(var(--lk-d) * ${DIAL_MODULES.k}),1px)}
:root.lk-dm.lk-dm:not(.lk-flat){--lk-edge-foot:calc(var(--lk-by) + ${DIAL_MODULES.lift}px + var(--lk-dmd) + ${DIAL_MODULES.gap}px)}
:root.lk-dm.lk-dm:not(.lk-flat):not(.lk-flat) .lk-chart .small{left:calc(var(--lk-dm-cx,calc(var(--lk-mx) + var(--lk-sal,0px) + var(--lk-dmd) / 2)) - var(--lk-dmd) / 2);bottom:calc(var(--lk-by) + ${DIAL_MODULES.lift}px);top:auto;right:auto;width:var(--lk-dmd);height:var(--lk-dmd);transform:none;
  box-shadow:0 0 0 3px #2A2E34,0 0 0 4.5px #9AA1A8,0 10px 20px rgb(0 0 0 / .4)}
:root.lk-dm.lk-dm:not(.lk-flat):not(.lk-flat) .lk-cv{--d:var(--lk-dmd);left:calc(var(--lk-dm-wx,calc(100vw - var(--lk-mx) - var(--lk-sar,0px) - var(--lk-dmd) / 2)) - var(--lk-dmd) / 2);bottom:calc(var(--lk-by) + ${DIAL_MODULES.lift}px);top:auto;right:auto;transform:none;
  box-shadow:0 0 0 3.5px #2A2E34,0 0 0 5px #9AA1A8,0 10px 20px rgb(0 0 0 / .4)}
:root.lk-dm :is(.lk-cv,.lk-chart .small){visibility:visible!important;opacity:1!important;transition:opacity var(--lk-calm-fade,.6s) ease}
:root.lk-dm.lk-dm-dim :is(.lk-cv,.lk-chart .small){opacity:${DIAL_MODULES.dim}!important}
:root.lk-dm.lk-dm-off :is(.lk-cv,.lk-chart .small){opacity:0!important;visibility:hidden!important;pointer-events:none!important}
:root.lk-dm button.lk-puck{display:none!important}
/* a phone's compact wind dial (flat.js): the readings as before; the point of sail and the sector ring only once a tap enlarges it */
:root.lk-dm.lk-flat:not(.lk-fl-wup) .lk-cv :is(.rw.pos,.sect){display:none}
:root.lk-dm.lk-flat:not(.lk-fl-wup) .lk-cv.pos .inr{bottom:12%}
`;

export function dialModuleState({ inMode = true, preset = 'calm', dash = true, played = false } = {}) {
  const off = !inMode || preset === 'clear' || played;
  return { off, dim: !off && (preset === 'calm' || preset === 'auto') && !dash };
}

export function createDialModules({ calm = null, inMode = () => true, played = () => false, doc = document } = {}) {
  if (!doc.getElementById('lk-dm-css')) { const st = doc.createElement('style'); st.id = 'lk-dm-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const H = doc.documentElement;
  H.classList.add('lk-dm');
  let state = { off: false, dim: false };
  return {
    update() {
      const v = calm?.view ?? {};
      const next = dialModuleState({ inMode: !!inMode(), preset: calm?.mode ?? 'calm', dash: v.dash !== false, played: !!played() });
      if (next.off !== state.off) H.classList.toggle('lk-dm-off', next.off);
      if (next.dim !== state.dim) H.classList.toggle('lk-dm-dim', next.dim);
      state = next;
    },
    get state() { return { ...state }; },
    dispose() { H.classList.remove('lk-dm', 'lk-dm-off', 'lk-dm-dim'); },
  };
}
