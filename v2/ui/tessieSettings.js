// Play as Tessie's two settings (owner, 2026-11-20, every default approved): "Invert up/down" (off: dragging up looks up)
// and "Camera follows her" (on: 1.0 s after a drag the camera swings in behind her). Their own stored key (the v1 store is shared with
// /classic/), read each frame by the player (living/tessiePlayer.js), switched in Setup › Aids › tessie (her own row, the UI audit 2026-11-21:
// one row per subject; mounted only where play as Tessie is on: src/core/features.js playTessie).
//   const S = tessieSettings(store);  S.get('invert') → false; S.set('follow', false)
//   mountTessieRow(root, { settings }) → { paint, dispose } | null
export const TESSIE_SETTINGS = Object.freeze({ key: 'lakeshore.v2.tessie', defaults: Object.freeze({ invert: false, follow: true }) });

const pageStore = () => { try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; } };
let shared = null;
export function tessieSettings(store = pageStore()) {
  if (shared && shared.store === store) return shared;
  let memo = null;
  const read = () => {
    if (memo) return memo;
    let v = null; try { v = JSON.parse(store?.getItem?.(TESSIE_SETTINGS.key) ?? 'null'); } catch { v = null; }
    memo = { ...TESSIE_SETTINGS.defaults, ...(v && typeof v === 'object' ? v : {}) };
    return memo;
  };
  const api = {
    store,
    get: (k) => read()[k] ?? TESSIE_SETTINGS.defaults[k],
    set(k, val) { if (!(k in TESSIE_SETTINGS.defaults)) return false; memo = { ...read(), [k]: !!val }; try { store?.setItem?.(TESSIE_SETTINGS.key, JSON.stringify(memo)); } catch { /* private mode: this page only */ } return true; },
    forget() { memo = null; },
  };
  shared = api;
  return api;
}

// Setup › Aids › tessie: "invert up/down" and "camera follows her" switches (v1's row style, homePages.js opt('toggle')), a row of its own
// after the gennaker's (or assists, before that row mounts)
export function mountTessieRow(root, { settings = tessieSettings(), doc = globalThis.document } = {}) {
  const tab = root?.querySelector?.('#tp-set-aids');
  if (!tab || tab.querySelector('[data-set="tessie"]')) return null;
  const row = doc.createElement('div');
  row.className = 'set'; row.dataset.set = 'tessie';
  row.innerHTML = '<span class="k">tessie</span><span class="v"></span>';
  const v = row.querySelector('.v');
  const after = tab.querySelector('[data-set="gennaker"]') ?? tab.querySelector('[data-set="assists"]');
  if (after?.nextSibling) tab.insertBefore(row, after.nextSibling); else tab.appendChild(row);
  const rows = [['invert', 'invert up/down'], ['follow', 'camera follows her']];
  const btns = rows.map(([k, label]) => {
    const b = doc.createElement('button');
    b.className = 'opt'; b.type = 'button'; b.setAttribute('role', 'switch'); b.dataset.ts = k; b.textContent = label;
    v.appendChild(b);
    return b;
  });
  const paint = () => { for (const b of btns) b.setAttribute('aria-checked', String(!!settings.get(b.dataset.ts))); };
  const click = (e) => { const b = e.target.closest?.('[data-ts]'); if (!b) return; e.stopPropagation(); settings.set(b.dataset.ts, !settings.get(b.dataset.ts)); paint(); };
  v.addEventListener('click', click);
  paint();
  return { row, buttons: btns, paint, dispose() { v.removeEventListener('click', click); row.remove(); } };
}
