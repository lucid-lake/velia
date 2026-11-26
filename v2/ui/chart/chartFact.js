// The chart's lake fact (owner, 2026-11-24): the loading screen's rotating fact line left the loading screen, where nobody had the time to
// read it, for the chart, where it reads at leisure. One quiet line in the chart's own type (Jost italic, the face of the map hint),
// one fact a visit:
//   the day's     the local date picks it (factIndex), so a visit reads one fact and the next day another; no date (a deterministic
//                 page, ?hour set) reads the first
//   a tap         shows the next one (a button: Enter too); the press never reaches the map under it
//   where         desktop and tablet (the panel): the free map's lower left, clear of the + and − column; a phone (the
//                 box): under the map, the chart's caption (ui/phoneCard.js leaves the band)
//   when          at the entrance only (mapScreen.js: show(true) on home, show(false) in the in-game menu); never while a phone's build
//                 card runs its own lines (data-build=wait)
// The list is ui/loadFacts.js FACTS (each 60 characters or fewer, with its public source; the phone's build card reads it too).
//   const f = mountChartFact(parent, { date: () => new Date() });   f.el, f.text, f.next(), f.show(on), f.dispose()
import { FACTS } from '../loadFacts.js';

export { FACTS };
const DAY_MS = 86400000;

// the fact for a day (pure): the local calendar day's number, mod the list; no date: the first
export function factIndex(date, n = FACTS.length) {
  if (!n) return 0;
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return 0;
  const day = Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
  return ((day % n) + n) % n;
}

const CSS = `#lk-load .lkc-fact{all:unset;box-sizing:border-box;position:absolute;z-index:1;display:block;cursor:pointer;pointer-events:auto;
  font:italic var(--lk-regular) 15px/1.3 var(--lk-font);letter-spacing:.03em;color:var(--lk-ink);opacity:.86;
  text-shadow:0 0 6px rgb(var(--lk-brand-navy) / .95),0 1px 2px rgb(var(--lk-brand-navy) / .9);transition:opacity .2s var(--lk-ease)}
#lk-load .lkc-fact[hidden],#lk-load[data-build=wait] .lkc-fact{display:none}
#lk-load .lkc-fact:hover{opacity:1}
#lk-load .lkc-fact:focus-visible{opacity:1;outline:2px solid rgb(var(--lk-cream) / .7);outline-offset:3px;border-radius:4px}
#lk-load .lkc-fact::after{content:'';position:absolute;inset:-10px -6px}
#lk-load .lk-livechart .lkc-fact{left:calc(var(--lk-panel-in,0px) + 18px);bottom:14px;max-width:min(440px,calc(100% - var(--lk-panel-in,0px) - 120px))}
#lk-load .lk-card > .lkc-fact{left:16px;bottom:10px;width:calc(100% - var(--lk-rc,34%) - 48px);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#lk-load .lk-card > .lkc-fact::after{inset:-10px 0}`;

export function mountChartFact(parent, { doc = parent?.getRootNode?.() ?? globalThis.document, date = () => new Date(), list = FACTS } = {}) {
  if (!parent || !doc || !list.length) return null;
  if (!doc.getElementById('lk-chartfact-css')) { const s = doc.createElement('style'); s.id = 'lk-chartfact-css'; s.textContent = CSS; doc.head.appendChild(s); }
  let d = null; try { d = date?.() ?? null; } catch { d = null; }
  let i = factIndex(d, list.length);
  const el = doc.createElement('button'); el.type = 'button'; el.className = 'lkc-fact'; el.setAttribute('aria-live', 'polite');
  const paint = () => { el.textContent = list[i]; };
  const next = () => { i = (i + 1) % list.length; paint(); return list[i]; };
  el.addEventListener('click', (e) => { e.stopPropagation(); next(); });
  for (const ty of ['pointerdown', 'pointerup', 'wheel', 'dblclick']) el.addEventListener(ty, (e) => e.stopPropagation(), { passive: ty !== 'wheel' });
  paint(); el.hidden = true;
  parent.appendChild(el);
  return {
    el,
    get text() { return list[i]; },
    get index() { return i; },
    next,
    show(on) { el.hidden = !on; },
    dispose() { el.remove(); },
  };
}
