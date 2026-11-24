// Setup › Aids › gennaker: auto | off (round 2; owner, 2026-11-21: option A, "the crew flies the gennaker, like crew trim").
// auto (the default): the crew hoists it on a broad reach or a run and douses it as she heads up (v2/sim/gennakerCrew.js); off: never
// flown, unless Pro flies it by hand (F held at the jib's full ease). Every skill level and every device: the one way to switch it, as
// the gennaker has no key and no button. The page's one settings store ('gennaker': src/ui/settings.js); sail.js reads it each frame.
//   mountGennakerRow(root, { settings }) → { buttons, paint, dispose } | null
const GENNAKER_ROW = Object.freeze({ key: 'gennaker', modes: Object.freeze(['auto', 'off']) });

export function mountGennakerRow(root, { settings = null, doc = globalThis.document } = {}) {
  const tab = root?.querySelector?.('#tp-set-aids');
  if (!tab || !settings || tab.querySelector('[data-set="gennaker"]')) return null;
  const row = doc.createElement('div');
  row.className = 'set'; row.dataset.set = 'gennaker';
  row.innerHTML = `<span class="k">gennaker</span><span class="v">${GENNAKER_ROW.modes.map((m) => `<button class="opt" type="button" role="radio" data-gk="${m}" aria-checked="false">${m}</button>`).join('')}</span>`;
  const after = tab.querySelector('[data-set="assists"]');
  if (after?.nextSibling) tab.insertBefore(row, after.nextSibling); else tab.appendChild(row);
  const btns = [...row.querySelectorAll('[data-gk]')];
  const paint = () => { const v = settings.get(GENNAKER_ROW.key) ?? 'auto'; for (const b of btns) b.setAttribute('aria-checked', String(b.dataset.gk === v)); };
  const click = (e) => { const b = e.target.closest?.('[data-gk]'); if (!b) return; e.stopPropagation(); settings.set(GENNAKER_ROW.key, b.dataset.gk); paint(); };
  row.addEventListener('click', click);
  paint();
  return { row, buttons: btns, paint, dispose() { row.removeEventListener('click', click); row.remove(); } };
}
