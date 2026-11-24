// Help's scrolling pages (What's new and Credits; owner 2026-11-15: no numbered pages, each is one page that scrolls).
// The Help nav, the title and Esc stay fixed; only the page's body (.pg.scr > .pg-b) scrolls: momentum on touch (CSS), a
// wheel, or the keys below on a desk (home.js calls scrollKey). While more is below, the body carries data-more and the
// pages' CSS fades its bottom edge (src/ui/homePages.js). No three, no DOM at import: the tests call these directly.
//
//   const fade = createScrollFade(root); fade.update(); fade.dispose();
//   scrollKey('PageDown', { page: 400 })   // -> { by: 340 } | { to: 'top' | 'end' } | null (not a scroll key here)

export const LINE_PX = 56;   // an arrow's step: about two lines of the page's text
// what a key does on a scrolling page. inNav: the focus is in the Help nav (its arrows walk the nav); onSummary: on a
// release's date (Space and Enter open or fold it); page: the body's height in px
export function scrollKey(code, { inNav = false, onSummary = false, shift = false, page = 400 } = {}) {
  const leaf = Math.max(LINE_PX, Math.round(page * 0.85));
  switch (code) {
    case 'ArrowDown': return inNav ? null : { by: LINE_PX };
    case 'ArrowUp': return inNav ? null : { by: -LINE_PX };
    case 'PageDown': return { by: leaf };
    case 'PageUp': return { by: -leaf };
    case 'Space': return onSummary || inNav ? null : { by: shift ? -leaf : leaf };
    case 'Home': return inNav ? null : { to: 'top' };
    case 'End': return inNav ? null : { to: 'end' };
    default: return null;
  }
}
// can the body move that way (a step at its end falls through to the arrows' focus walk)
const canScroll = (el, by) => (by > 0 ? el.scrollHeight - el.scrollTop - el.clientHeight > 1 : el.scrollTop > 0);
const moreBelow = (el) => el.scrollHeight - el.scrollTop - el.clientHeight > 2;
// apply one scrollKey result to a body; true when it moved (or would: a smooth scroll lands a frame later)
export function applyScroll(el, d) {
  if (!d) return false;
  if (d.to) { const top = d.to === 'top' ? 0 : el.scrollHeight; if ((d.to === 'top' && el.scrollTop <= 0) || (d.to === 'end' && !canScroll(el, 1))) return false; el.scrollTo({ top }); return true; }
  if (!canScroll(el, d.by)) return false;
  el.scrollBy({ top: d.by });
  return true;
}

export function createScrollFade(root) {
  const mark = (el) => { if (moreBelow(el)) el.setAttribute('data-more', ''); else el.removeAttribute('data-more'); };
  const update = () => { for (const el of root.querySelectorAll('.pg.scr > .pg-b')) mark(el); };
  const onScroll = (e) => { if (e.target?.matches?.('.pg.scr > .pg-b')) mark(e.target); };   // scroll does not bubble: caught on the way down
  const onToggle = () => update();   // a release opened or folded changes the height
  root.addEventListener('scroll', onScroll, true);
  root.addEventListener('toggle', onToggle, true);
  addEventListener('resize', update);
  return {
    update,
    dispose() { root.removeEventListener('scroll', onScroll, true); root.removeEventListener('toggle', onToggle, true); removeEventListener('resize', update); },
  };
}
