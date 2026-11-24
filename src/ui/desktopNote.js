// "Best on a desktop browser" (owner, 2026-10-31): on a phone or tablet only, one calm line, the home card foot's last caption
// (V2, 2026-11-06), with a one-tap "Why?". Shown on this device's first home card; after that it lives only in About. No pop-up,
// nothing on a desktop (the line exists only under html[data-input=touch], src/ui/touchUi.js).
//   installDesktopNote({ root: #lk-load, storage })
export const NOTE = 'Best on a desktop browser';
export const WHY = 'Fewer trees and clouds on phones: smoother water.';   // one line on a 390 px card: it takes the note's place
export const SEEN_KEY = 'lakeshore.desknote.v1';

const NOTE_CSS = `
#lk-load .lk-best{margin:.35em 0 0;font-size:max(.78em,12px);letter-spacing:.03em;opacity:.78;font-style:italic;line-height:1.35}
#lk-load .lk-best .lk-why{all:unset;cursor:pointer;font-style:normal;text-decoration:underline;text-underline-offset:.15em;margin-left:.4em;padding:0 .1em}
#lk-load .lk-best .lk-why:focus-visible{outline:2px solid currentColor;outline-offset:2px}
#lk-load .lk-best{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#lk-load .lk-best .lk-whytext{font-style:normal}
#lk-load .lk-best.why .lk-note{display:none}
.lk-pg .pg[data-page=about] .lk-best-about{white-space:normal}
:where(:root[data-screen~=tight]) #lk-load .lk-best:not(.lk-best-about){display:none}   /* a phone held sideways: no room above the links row; About has it */
#lk-load .lk-best .lk-whytext[hidden]{display:none}
#lk-load[data-state=fail] .lk-best,#lk-load[data-pg] .lk-best{display:none}
.lk-pg .pg[data-page=about] .lk-best-about{margin-top:.8em;font-style:italic;opacity:.85}
`;

// pure: does this page show the line on the card, and in About?
export function noteState({ touch, seen }) { return { card: !!touch && !seen, about: !!touch }; }

export function installDesktopNote({ root = document.getElementById('lk-load'), storage = globalThis.localStorage, doc = document } = {}) {
  const touch = doc.documentElement.dataset.input === 'touch';
  let seen = false;
  try { seen = storage?.getItem(SEEN_KEY) === '1'; } catch { /* no storage: show it */ }
  const st = noteState({ touch, seen });
  if (!st.about || !root) return null;
  if (!doc.getElementById('lk-desknote-css')) { const s = doc.createElement('style'); s.id = 'lk-desknote-css'; s.textContent = NOTE_CSS; doc.head.appendChild(s); }
  const line = () => {
    const p = doc.createElement('p'); p.className = 'lk-best';
    p.innerHTML = `<span class="lk-note">${NOTE}</span><span class="lk-whytext" hidden>${WHY}</span><button class="lk-why" type="button" aria-expanded="false">Why?</button>`;
    const b = p.querySelector('.lk-why'), w = p.querySelector('.lk-whytext');
    // the reason takes the note's place (one line: the card has no room for two above its links row)
    b.addEventListener('click', (e) => { e.stopPropagation(); w.hidden = !w.hidden; p.classList.toggle('why', !w.hidden); b.textContent = w.hidden ? 'Why?' : 'OK'; b.setAttribute('aria-expanded', String(!w.hidden)); });
    return p;
  };
  let card = null;
  if (st.card) {
    card = line();
    (root.querySelector('.lk-foot') ?? root.querySelector('.lk-status'))?.after(card);   // the foot's last caption (V2): never over the chart
    // seen only once it was really on screen (sideways it is hidden: the next upright card shows it)
    const mark = () => { if (card.offsetParent !== null && card.getClientRects().length) { try { storage?.setItem(SEEN_KEY, '1'); } catch { /* shown again */ } return true; } return false; };
    if (!mark()) { const on = () => { if (mark()) removeEventListener('resize', on); }; addEventListener('resize', on); }
  }
  const about = root.querySelector('.pg[data-page=about] .pg-b');
  let inAbout = null;
  if (about) { inAbout = line(); inAbout.className = 'lk-best lk-best-about'; about.appendChild(inAbout); }
  return { card, about: inAbout };
}
