// Setup › Sound › music (owner, 2026-11-14: "play songs randomly so users don't get bored"): Shuffle (the default) or By time of day
// (the beds' scheduler, today's behaviour), on the home card's Sound tab in v1's row style (homePages.js setRow / opt). It writes
// its own stored key (v2/audio/shuffle.js savePick: v1's settings store keeps only v1's keys) and tells the music at once
// (music.setPick). Pure DOM, mounted by ui/front.js. v2/tests/shuffle.test.mjs, v2/tests/pages/shuffle.page.mjs.
//   const row = mountMusicRow(root, { store, music });   row.paint(); row.dispose()
import { loadPick, savePick, pageStore } from '../audio/shuffle.js';

const CHOICES = [['shuffle', 'shuffle'], ['time', 'by time of day']];

export function mountMusicRow(root, { store = pageStore(), music = null, doc = globalThis.document } = {}) {
  const panel = root?.querySelector?.('#tp-set-sound');
  if (!panel || panel.querySelector('[data-set="musicPick"]')) return null;
  const row = doc.createElement('div');
  row.className = 'set'; row.dataset.set = 'musicPick';
  row.innerHTML = `<span class="k">music</span><span class="v">${CHOICES.map(([id, label]) => `<button class="opt" type="button" role="radio" data-mp="${id}" aria-checked="false">${label}</button>`).join('')}</span>`;
  const sound = panel.querySelector('[data-set="sound"]');
  if (sound?.nextSibling) panel.insertBefore(row, sound.nextSibling); else panel.appendChild(row);   // under the sound switches
  let pick = loadPick(store);
  music?.setPick?.(pick);
  const paint = () => { for (const b of row.querySelectorAll('[data-mp]')) b.setAttribute('aria-checked', String(b.dataset.mp === pick)); };
  const click = (e) => {
    const b = e.target.closest?.('[data-mp]'); if (!b || !row.contains(b)) return;
    e.stopPropagation();
    pick = savePick(store, b.dataset.mp);   // a private window: this page keeps it (savePick returns the pick)
    music?.setPick?.(pick);
    paint();
  };
  row.addEventListener('click', click);
  paint();
  return { row, paint, get pick() { return pick; }, dispose() { row.removeEventListener('click', click); row.remove(); } };
}
