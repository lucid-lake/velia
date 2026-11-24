// Button tips (Solaria stage 1, owner 2026-11-06): ONE tip for every icon button — the tool dock,
// the top bar and its view switch, Cruise's bars, the cockpit's DOM hit layer (the control panel's cells, the PRO recess),
// the menu mark. It is the name tag (nameTag.js) with Velia's settings: 120 ms after a hover, a long-press on touch, the
// glass-dense plate at caption size, the key named ("Binoculars · B"), never over the skipper's line, gone on a drag or a
// steer. Settings › Screen › button tips turns it off (html[data-lk-tips=off]; the shell sets it from the setting).
//
//   const tips = sharedTips();          // the page's one instance (one tag element), made on first use
//   tips.add(button, { side: 'down' }); // its name and key from the aria-label "Binoculars (B)", or data-tip
//   if (tips.consumed(button)) return;  // the click that ends a long-press is not a press
//   setTipsOn(settings.get('tips'));    // the shell, at start and on a change
import { createNameTags } from './nameTag.js';

export const tipsOn = (doc = globalThis.document) => doc?.documentElement?.dataset?.lkTips !== 'off';
export function setTipsOn(on, doc = globalThis.document) {
  const H = doc?.documentElement; if (!H) return;
  if (on) delete H.dataset.lkTips; else H.dataset.lkTips = 'off';
  if (!on) shared.get(doc)?.hide();
}

// one createTips() for every bar: the defaults are the tip's (a new instance; most callers want sharedTips())
export function createTips(o = {}) {
  return createNameTags({ side: 'up', enabled: () => tipsOn(), ...o });
}

const shared = new WeakMap();   // document → its one tips instance
export function sharedTips(doc = globalThis.document) {
  let t = shared.get(doc);
  if (!t) { t = createTips(); shared.set(doc, t); }   // never disposed: a bar going away forgets its buttons (tips.forget)
  return t;
}
