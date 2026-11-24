// Full screen (owner, 2026-10-30): the Fullscreen API on the document element, with the webkit prefixes (Safari). Where the API is
// missing (iPhone) supported() is false and the top bar hides the button. Esc leaves full screen as the browser does: the first Esc
// is the browser's, so the home card ignores an Esc while full screen is on or just left (escIsBrowsers).
//   const fs = createFullscreen(document); fs.supported(); fs.active(); fs.toggle(); fs.on(fn)
// The key: Shift+F (plain F is the jib sheet in every mode; keys.js).
const LEFT_MS = 400;
let leftAt = -1e9;
// Android, phones landscape-first (feat/cockpit-phone, owner 2026-11-06): entering full screen in Sail turns the phone sideways for
// the cockpit: screen.orientation.lock('landscape') (Chrome allows it only in full screen; a refusal is ignored). An iPhone cannot
// lock (no API): nothing there. lock: () => bool, asked at each entry (landscapeLock below for Sail's bar).
export const landscapeLock = ({ ua = globalThis.navigator?.userAgent ?? '', phone = false } = {}) => !!phone && /Android/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
export function createFullscreen(doc = globalThis.document, now = () => Date.now(), { lock = () => false, screen: scr = globalThis.screen } = {}) {
  const el = () => doc.documentElement;
  const reqFn = () => el()?.requestFullscreen ?? el()?.webkitRequestFullscreen;
  const exitFn = () => doc.exitFullscreen ?? doc.webkitExitFullscreen;
  const active = () => !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  const fns = new Set();
  let was = active();
  const changed = () => { const a = active(); if (was && !a) leftAt = now(); was = a; for (const f of fns) f(a); };
  doc.addEventListener?.('fullscreenchange', changed); doc.addEventListener?.('webkitfullscreenchange', changed);
  return {
    supported: () => !!reqFn() && !!exitFn(),
    active,
    toggle() {
      if (!reqFn() || !exitFn()) return false;
      const entering = !active();
      const r = entering ? reqFn().call(el()) : exitFn().call(doc);
      r?.catch?.(() => {});   // a refusal (no gesture) is silent
      if (entering && lock()) {
        const turn = () => { try { scr?.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* no lock: as it was */ } };
        if (r?.then) r.then(turn, () => {}); else turn();
      }
      return true;
    },
    on(f) { fns.add(f); return () => fns.delete(f); },
    dispose() { doc.removeEventListener?.('fullscreenchange', changed); doc.removeEventListener?.('webkitfullscreenchange', changed); fns.clear(); },
  };
}
export const escIsBrowsers = (doc = globalThis.document, now = Date.now()) => !!(doc?.fullscreenElement ?? doc?.webkitFullscreenElement) || now - leftAt < LEFT_MS;
export const markLeft = (t = Date.now()) => { leftAt = t; };   // tests
