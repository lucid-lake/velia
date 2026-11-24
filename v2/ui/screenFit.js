// A phone's real screen space (owner 2026-11-16): the page is laid out by the height the player can see, not the
// phone model, and it draws edge to edge (viewport-fit=cover in index.html) with every control inside the safe areas.
//   - the frame: the visible viewport (visualViewport, else innerWidth × innerHeight), in the layout frame (a turned page's
//     width and height swapped, ui/landscape.js). Safari's bars come and go without a resize on some builds: a visualViewport
//     resize that moves the frame re-sends a window resize, so every layout listener (ui/flat.js, the station, the sheets)
//     re-lays out live. html carries --lk-vh and --lk-vw (the visible frame, px) and, on a phone, lk-short under TALL px
//     (a browser tab, about 320–360 px tall: the compact tier) or lk-tall (the Home Screen, Android full screen: 390–430 px).
//   - the insets: CSS reads --lk-sat/-sar/-sab/-sal (src/ui/touchUi.js: env(safe-area-inset-*), turned with the page by
//     ui/landscape.js). The Safari 26 viewport-fit bug (WebKit 306465) can leave them at 0 while the page draws under the notch:
//     on a notched iPhone, when every inset reads 0 and the page reaches the notch (it spans the screen's long side, sideways,
//     or it is a Home Screen launch), the fallback sets the insets an iPhone has (FALLBACK) inline on <html>, in the layout
//     frame, and html.lk-fit-fallback; so the controls keep off the notch as before cover. ?fit=cover never falls back,
//     ?fit=bars always does (the A/B and the tests).
//   - standalone: html.lk-standalone on a Home Screen launch (display-mode standalone or fullscreen, or iOS navigator.standalone).
// A test or a tool reads window.__veliaScreen: { frame(), tier(), insets(), fallback(), standalone(), sync() }.

import { profileFor, LIMITS } from '../../src/core/profile.js';
export const SCREEN = Object.freeze({
  tall: LIMITS.tall,  // a visible frame this tall or more is the full tier (ui/flat.js FLAT.tall: the same line)
  phoneShort: LIMITS.phoneShort,    // a short side under this is a phone (src/core/profile.js LIMITS)
  // the notched iPhones' screen long sides, CSS px (X, XS, 11 Pro, 12/13 mini: 812; 12–14: 844; 14 Pro–16: 852; 16 Pro, 17: 874;
  // XR, XS Max, 11, 11 Pro Max: 896; 12–14 Plus/Pro Max: 926; 14 Pro Max–16 Plus: 932; 16 Pro Max, 17 Pro Max: 956). SE and 8 have none.
  notched: [812, 844, 852, 874, 896, 926, 932, 956],
  // the insets the fallback sets, screen frame: sideways the notch or island side (either, the phone may be turned either way)
  // and the home indicator; upright (a turned page) the status bar and the home indicator
  fallbackSide: { top: 0, bottom: 21, left: 59, right: 59 },
  fallbackUp: { top: 59, bottom: 34, left: 0, right: 0 },
});

// a notched iPhone (pure): an iPhone UA and a notched screen size (screen.width × height are the upright ones on iOS)
export function notchedIphone({ ua = '', sw = 0, sh = 0 } = {}) {
  if (!/iPhone/.test(ua)) return false;
  return SCREEN.notched.includes(Math.round(Math.max(sw, sh)));
}

// the safe-area fallback's decision (pure). insets: the env() insets read now (screen frame); pw: the page's own width in the
// screen frame (innerWidth, untouched by the turn); upright: the phone is held upright (the page turned); fit: the ?fit flag.
// Returns null (keep the browser's insets) or the screen-frame insets to use.
export function fallbackInsets({ ua = '', sw = 0, sh = 0, pw = 0, upright = false, standalone = false, insets = {}, fit = null } = {}) {
  if (fit === 'cover') return null;
  const pick = upright ? SCREEN.fallbackUp : SCREEN.fallbackSide;
  if (fit === 'bars') return { ...pick };
  if (!notchedIphone({ ua, sw, sh })) return null;
  const any = ['top', 'right', 'bottom', 'left'].some((k) => (insets[k] ?? 0) > 0.5);
  if (any) return null;   // the browser gives insets: cover works
  // the page reaches the notch: sideways it spans the screen's long side (a letterboxed page stops short of it: nothing to do);
  // upright, a Home Screen launch draws under the status bar (black-translucent)
  const long = Math.max(sw, sh);
  const reaches = upright ? standalone : Math.abs(pw - long) <= 2;
  return reaches ? { ...pick } : null;
}

// screen-frame insets → the layout frame of a page turned a quarter (ui/landscape.js: the layout's top is the screen's right, its
// right the screen's bottom, its bottom the screen's left, its left the screen's top)
export const insetsToLayout = (s, rotated) => (rotated ? { top: s.right, right: s.bottom, bottom: s.left, left: s.top } : { ...s });

// the tier for a visible frame (pure): only a phone has one
export const tierFor = ({ w, h, phone }) => (!phone ? null : h >= SCREEN.tall ? 'tall' : 'short');

// a Home Screen launch (pure of the page: pass matchMedia and navigator)
function isStandalone({ win = globalThis } = {}) {
  try {
    if (win.navigator?.standalone === true) return true;
    const mm = (q) => { try { return !!win.matchMedia?.(q)?.matches; } catch { return false; } };
    return mm('(display-mode: standalone)') || mm('(display-mode: fullscreen)');
  } catch { return false; }
}

let installed = null;

export function installScreenFit({ win = globalThis, doc = globalThis.document, fit = null } = {}) {
  if (installed) return installed;
  if (!doc?.documentElement || !win) return null;
  const H = doc.documentElement;
  const turn = () => win.__veliaTurn ?? null;
  const rotated = () => !!turn()?.rotated?.();
  // the page's own frame (innerWidth/innerHeight are the layout frame's while turned: ui/landscape.js)
  const frame = () => {
    const vv = win.visualViewport;
    let w = win.innerWidth, h = win.innerHeight;
    if (vv && vv.width > 0 && vv.height > 0 && Math.abs((vv.scale ?? 1) - 1) < 0.01) {
      // visualViewport is in the screen frame: swap it for a turned page. The smaller of the two each way: never lay out past
      // either (an iPhone Home Screen launch's innerHeight stops under the status bar; a tab's bars shrink the visual viewport)
      const vw = Math.round(vv.width), vh = Math.round(vv.height);
      const [lw, lh] = rotated() ? [vh, vw] : [vw, vh];
      w = Math.min(w, lw); h = Math.min(h, lh);
    }
    return { w, h };
  };
  // an inset probe in the screen frame: an element on <html> (never turned), its offsetWidth (never patched)
  const probe = (v) => {
    const p = doc.createElement('div');
    p.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;height:0;width:${v}`;
    H.appendChild(p); const w = p.offsetWidth; p.remove();
    return Number.isFinite(w) ? w : 0;
  };
  const envInsets = () => ({ top: probe('env(safe-area-inset-top,0px)'), right: probe('env(safe-area-inset-right,0px)'), bottom: probe('env(safe-area-inset-bottom,0px)'), left: probe('env(safe-area-inset-left,0px)') });
  let last = { w: 0, h: 0 }, tierNow = null, fb = null, standaloneNow = false, insetsNow = { top: 0, right: 0, bottom: 0, left: 0 }, resending = false;
  const phone = () => profileFor(win).form === 'phone';   // the device profile's form (src/core/profile.js: the physical screen)

  const sync = () => {
    const f = frame();
    standaloneNow = isStandalone({ win });
    H.classList.toggle('lk-standalone', standaloneNow);
    H.style.setProperty('--lk-vh', `${f.h}px`); H.style.setProperty('--lk-vw', `${f.w}px`);
    const t = tierFor({ ...f, phone: phone() });
    if (t !== tierNow) { tierNow = t; H.classList.toggle('lk-short', t === 'short'); H.classList.toggle('lk-tall', t === 'tall'); }
    // the insets: the browser's, or the fallback's
    const env = envInsets(), rot = rotated();
    const upright = rot;   // a turned page is an upright phone
    const pw = rot ? win.innerHeight : win.innerWidth;   // the screen frame's width (the turn swaps innerWidth and innerHeight)
    const next = fallbackInsets({ ua: win.navigator?.userAgent ?? '', sw: win.screen?.width ?? 0, sh: win.screen?.height ?? 0, pw, upright, standalone: standaloneNow, insets: env, fit });
    const key = (o) => (o ? `${o.top},${o.right},${o.bottom},${o.left}` : '');
    const lay = next ? insetsToLayout(next, rot) : null;
    if (key(lay) !== key(fb)) {
      fb = lay;
      H.classList.toggle('lk-fit-fallback', !!fb);
      for (const [k, v] of [['sat', 'top'], ['sar', 'right'], ['sab', 'bottom'], ['sal', 'left']]) { if (fb) H.style.setProperty(`--lk-${k}`, `${fb[v]}px`); else H.style.removeProperty(`--lk-${k}`); }
    }
    insetsNow = fb ? { ...fb } : insetsToLayout(env, rot);
    const moved = f.w !== last.w || f.h !== last.h;
    last = f;
    return moved;
  };
  // a visualViewport resize that moves the frame (Safari's bars) re-sends a window resize, once, so every layout listener re-lays out
  const onVV = () => {
    if (resending) return;
    const before = { ...last };
    if (!sync()) return;
    if (before.w === 0) return;
    resending = true;
    try { win.dispatchEvent(new win.Event('resize')); } finally { resending = false; }
    win.dispatchEvent(new win.CustomEvent('lk-screen', { detail: { frame: { ...last }, tier: tierNow } }));
  };
  const onResize = () => {
    if (resending) return;
    const t0 = tierNow;
    sync();
    if (tierNow !== t0) win.dispatchEvent(new win.CustomEvent('lk-screen', { detail: { frame: { ...last }, tier: tierNow } }));
  };
  win.addEventListener('resize', onResize);
  win.addEventListener('orientationchange', () => setTimeout(onResize, 0));
  win.visualViewport?.addEventListener?.('resize', onVV);
  win.visualViewport?.addEventListener?.('scroll', onVV);
  try { win.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', onResize); } catch { /* old Safari */ }
  sync();

  installed = {
    frame: () => ({ ...last }),
    tier: () => tierNow,
    insets: () => ({ ...insetsNow }),
    fallback: () => !!fb,
    standalone: () => standaloneNow,
    sync: () => { sync(); return { ...last }; },
  };
  win.__veliaScreen = installed;
  return installed;
}
