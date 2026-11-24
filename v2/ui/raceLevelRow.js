// Setup's "race level" row (BACKLOG-v2 #12 R3): Beginner, Club, Pro and, at Pro, the laylines; on the home card's Setup page, a
// fifth tab "Race" (the Sail and Aids tabs are full: their card would scroll), in v1's row style (homePages.js setRow / opt). It writes the stored choice (levels.js saveLevel: a race on the page hears it
// through 'velia:regatta-level' and goes back in the box with that level). Tiny and pure DOM: ui/front.js mounts it without the race's
// chunk. v2/tests/regatta-r3.test.mjs.
//   const row = mountLevelRow(root, { store });   row.paint(); row.dispose()
import { LEVEL_IDS, LEVELS, loadLevel, saveLevel } from '../sim/raceLevels.js';

export const RACE_TAB_CSS = ':where(:root[data-screen~=narrow]) #lk-load .pg[data-page=settings] h2{font-size:1.2em}:where(:root[data-screen~=narrow]) #lk-load .pg[data-page=settings] .tabs{gap:.08em}:where(:root[data-screen~=narrow]) #lk-load .pg[data-page=settings] .tab{padding:.16em .38em .14em;font-size:max(.74em,12px);letter-spacing:0}';
export function mountLevelRow(root, { store = globalThis.localStorage, doc = globalThis.document } = {}) {
  const screen = root?.querySelector?.('#tp-set-screen'), tabScreen = root?.querySelector?.('#tab-set-screen');
  if (!screen || !tabScreen || root.querySelector('#tp-set-race')) return null;
  // a fifth tab, Race (v1's tab markup: home.js pickTab switches any [role=tab] by its aria-controls)
  // R4 (R3's phone polish): with the fifth tab the strip crowded Setup's title on a phone (it sits on the title's line, right); there it
  // stays on the title's line with a smaller title and tighter tabs (on its own line it cost the Aids tab 35 px: the card scrolled)
  if (doc.getElementById && doc.head && !doc.getElementById('v2-race-tab-css')) { const st = doc.createElement('style'); st.id = 'v2-race-tab-css'; st.textContent = RACE_TAB_CSS; doc.head?.appendChild(st); }
  const tab = doc.createElement('button');
  tab.className = 'tab'; tab.type = 'button'; tab.id = 'tab-set-race'; tab.dataset.tab = 'race';
  tab.setAttribute('role', 'tab'); tab.setAttribute('aria-controls', 'tp-set-race'); tab.setAttribute('aria-selected', 'false'); tab.textContent = 'Race';
  tabScreen.parentNode.insertBefore(tab, tabScreen.nextSibling);
  const panel = doc.createElement('div');
  panel.className = 'tp'; panel.id = 'tp-set-race'; panel.dataset.tp = 'race'; panel.hidden = true;
  panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', 'tab-set-race');
  screen.parentNode.insertBefore(panel, screen.nextSibling);
  const row = doc.createElement('div');
  row.className = 'set'; row.dataset.set = 'raceLevel';
  row.innerHTML = `<span class="k">race level</span><span class="v">${LEVEL_IDS.map((id) => `<button class="opt" type="button" role="radio" data-rl="${id}" aria-checked="false">${LEVELS[id].label.toLowerCase()}</button>`).join('')}<button class="opt" type="button" role="switch" data-rll="1" aria-checked="false">laylines</button></span>`;
  panel.appendChild(row);
  const paint = () => {
    const o = loadLevel(store);
    for (const b of row.querySelectorAll('[data-rl]')) b.setAttribute('aria-checked', String(b.dataset.rl === o.level));
    const ll = row.querySelector('[data-rll]');
    ll.setAttribute('aria-checked', String(o.level === 'pro' ? o.laylines : true)); ll.disabled = o.level !== 'pro';
    ll.title = o.level === 'pro' ? 'Pro: show the laylines' : 'Beginner and Club always show the laylines';
  };
  const click = (e) => {
    const b = e.target.closest?.('button'); if (!b || !row.contains(b)) return;
    e.stopPropagation();
    const o = loadLevel(store);
    if (b.dataset.rl) saveLevel(store, { level: b.dataset.rl, laylines: b.dataset.rl === 'pro' ? o.laylines : false });
    else if (b.dataset.rll && o.level === 'pro') saveLevel(store, { level: 'pro', laylines: !o.laylines });
    paint();
  };
  row.addEventListener('click', click);
  const heard = () => paint();
  globalThis.addEventListener?.('velia:regatta-level', heard);
  paint();
  return { row, paint, dispose() { row.removeEventListener('click', click); globalThis.removeEventListener?.('velia:regatta-level', heard); panel.remove(); tab.remove(); doc.getElementById?.('v2-race-tab-css')?.remove(); } };
}
