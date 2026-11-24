// Setup › Sail › your wake (owner, 2026-11-18): one Forget button that clears the water you have sailed, kept on this
// device for the chart (ui/chart/mapUx.js createWakeStore). The home card's row style (homePages.js setRow / opt); pure DOM, mounted by
// ui/sail.js with the wake. The button says "forgotten" for 2.5 s after a press, and "nothing yet" while there is no wake.
//   const row = mountWakeRow(root, { wake });   row.paint(); row.dispose()
const WAKE_ROW = Object.freeze({ label: 'your wake', forget: 'forget', done: 'forgotten', empty: 'nothing yet', doneMs: 2500 });

export function mountWakeRow(root, { wake, doc = globalThis.document } = {}) {
  const panel = root?.querySelector?.('#tp-set-sail');
  if (!panel || !wake || panel.querySelector('[data-set="wake"]')) return null;
  const row = doc.createElement('div');
  row.className = 'set'; row.dataset.set = 'wake';
  row.innerHTML = `<span class="k">${WAKE_ROW.label}</span><span class="v"><button class="opt" type="button" data-wake="forget" aria-checked="false"></button></span>`;
  panel.appendChild(row);
  const btn = row.querySelector('button');
  let doneT = 0, justDone = false;
  const paint = () => {
    const n = wake.count;
    btn.textContent = justDone ? WAKE_ROW.done : n ? WAKE_ROW.forget : WAKE_ROW.empty;
    btn.disabled = !justDone && !n;
    btn.setAttribute('aria-label', justDone ? 'Your wake is forgotten' : n ? 'Forget the water you have sailed' : 'No wake kept yet');
  };
  const click = (e) => {
    e.stopPropagation();
    if (!wake.count) return;
    wake.clear(); justDone = true; paint();
    clearTimeout(doneT); doneT = setTimeout(() => { justDone = false; paint(); }, WAKE_ROW.doneMs);
  };
  btn.addEventListener('click', click);
  // the page opens the Setup tab now and then: repaint when it shows (a wake grows while she sails)
  const mo = doc.defaultView?.MutationObserver ? new doc.defaultView.MutationObserver(() => { if (!justDone) paint(); }) : null;
  mo?.observe(root, { attributes: true, subtree: true, attributeFilter: ['hidden', 'data-pg', 'aria-selected'] });
  paint();
  return { row, paint, dispose() { clearTimeout(doneT); mo?.disconnect(); btn.removeEventListener('click', click); row.remove(); } };
}
