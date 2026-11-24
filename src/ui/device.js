// The device's layout tier (pure: tests/touchUx.test.mjs). One answer for the helm station,
// the bar, the circles and the panel, so every piece agrees on what this screen is.
//   'desktop'     a mouse or a trackpad (the Mac): the layout as built
//   'tablet'      a finger on a screen whose short side is 500 px or more (an iPad): the desktop layout at u = 1, 44 pt targets
//   'phone-land'  a short side under 500 px, held on its side (an iPhone in landscape, 844 × 390)
//   'phone-port'  a short side under 500 px, held upright (an iPhone in portrait, 390 × 844)
// A desktop window dragged that small takes the phone layouts too (a mouse fits them; nothing else fits the window).
import { profile, profileFor, kindOf, LIMITS } from '../core/profile.js';

export const PHONE_SHORT = LIMITS.phoneShort;
// the kind now, from the device profile (src/core/profile.js kindOf): an iPad with a trackpad is a tablet
export const deviceKindNow = (win = globalThis) => kindOf(profileFor(win));

export function deviceKind({ w, h, coarse = false } = {}) {
  const short = Math.min(w, h);
  if (short < PHONE_SHORT) return h > w ? 'phone-port' : 'phone-land';
  return coarse ? 'tablet' : 'desktop';
}

// the html classes for a kind: lk-phone (+ lk-phone-l) or lk-tablet; none on a desktop. Kept for the JS that still reads them;
// every stylesheet reads the device profile's data-screen / data-input / data-form instead (src/core/profile.js)
export function deviceClasses(kind) {
  if (kind === 'phone-land') return ['lk-phone', 'lk-phone-l'];
  if (kind === 'phone-port') return ['lk-phone'];   // lk-phone-p is retired (2026-11-17): CSS reads [data-screen~=portrait] (src/core/profile.js)
  if (kind === 'tablet') return ['lk-tablet'];
  return [];
}
export const ALL_DEVICE_CLASSES = ['lk-phone', 'lk-phone-l', 'lk-phone-p', 'lk-tablet'];

// sets the classes on <html> now and on every resize (a phone turned); returns the kind now
export function watchDevice({ doc = globalThis.document, win = globalThis } = {}) {
  if (!doc?.documentElement) return 'desktop';
  const H = doc.documentElement;
  let kind = null;
  const apply = () => {
    profile.refresh();   // the device profile's data-* attributes on <html> (src/core/profile.js), on this same resize
    const k = deviceKindNow(win);
    if (k === kind) return;
    kind = k;
    for (const c of ALL_DEVICE_CLASSES) H.classList.remove(c);
    for (const c of deviceClasses(k)) H.classList.add(c);
    H.dataset.lkDevice = k;
  };
  apply();
  if (!H.dataset.lkDeviceWatch) { H.dataset.lkDeviceWatch = '1'; win.addEventListener?.('resize', apply); }
  return kind;
}

// a phone or a tablet (fix/ios-start: the memory and frame-pacing paths): the device profile's form (src/core/profile.js), so an
// iPad with a trackpad is on them too. A desktop window dragged phone-small keeps the desktop's memory and pacing (only its
// layout changes), so a Mac is never on these paths.
export function touchDevice(win = globalThis) {
  try { const p = profileFor(win); return p.form !== 'desktop' || p.input === 'touch'; } catch { return false; }   // ?touch=1 too, as before
}
