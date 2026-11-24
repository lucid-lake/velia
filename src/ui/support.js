// Support Velia (Solaria stage 1, owner 2026-11-06): the studio's Ko-fi page as a plain
// link. No widget script, no pixel, no cookie: an <a target=_blank rel=noopener>, nothing else. Three fixed places, never a
// pop-up, a timer or anything in play:
//   card    the home card's foot (src/ui/loading-shell.html: the cup + "Support Velia", the line under it)
//   help    Help › Support: the gold Support Velia and its one line (src/ui/homePages.js)
//   about   the end of About: the skipper's line, then the button "Buy the skipper a coffee"
// A press counts once, as support_click with its source (src/metrics.js; home.js fires it): no id, nothing typed.
export const SUPPORT = {
  url: 'https://ko-fi.com/lucidlake',
  label: 'Support Velia',
  cardLine: 'A coffee keeps the lake open.',
  aboutLine: 'The wind is free. The skipper runs on coffee.',
  aboutLink: 'Buy the skipper a coffee',
};
// the cup, on our 24 grid in the icons' hairline (the CSS sets the 1.7 px stroke): a mug, its handle, two curls of steam
export const CUP_ICON = '<path d="M4.5 10h11.5v4.2a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-5-5Z"/><path d="M16 11.5h1.4a2.6 2.6 0 0 1 0 5.2H15.6"/><path class="st" d="M8.6 3.6c-.9 1.1.9 2.1 0 3.4M12 3.6c-.9 1.1.9 2.1 0 3.4"/>';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// the link's markup: the same attributes everywhere (the card's own copy is in loading-shell.html; tests/support.test.mjs keeps them equal)
export function supportLink(source, inner, cls = '') {
  return `<a${cls ? ` class="${esc(cls)}"` : ''} href="${SUPPORT.url}" target="_blank" rel="noopener" data-support="${esc(source)}">${inner}</a>`;
}
// the source of a press (a click's target inside a support link), or null
export const supportSource = (el) => el?.closest?.('a[data-support]')?.dataset.support ?? null;
