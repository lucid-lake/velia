// Phones are landscape-only (owner ruling 2026-11-15): a phone held upright shows the landscape page turned on
// its side, a phone held sideways shows it as it is. The technique is Abyssal Garden's (Maksymilian Dendura, MIT,
// third_party/abyssal-garden, ATTRIBUTION.md): one CSS rule turns the body 90° (the home indicator on the right, the usual
// landscape hold), and on entering a mode the phone asks for full screen and a landscape lock (Android; iPhone has neither).
//
// What the turn needs beyond the CSS rule, all in this one module, so no other code knows the page is turned:
//   - the frame: while turned, the page's own JS sees the landscape layout frame everywhere. innerWidth/innerHeight are swapped;
//     a pointer's clientX/clientY (and x, y, pageX, pageY, movementX/Y; Touch too) and getBoundingClientRect/getClientRects come
//     back in the layout frame; elementFromPoint(s) take layout points; documentElement.clientWidth/Height and scrollWidth/Height are swapped. So the
//     drag to look, the pinch, the double-tap marks, the chart's taps, the wheel, the winches, the rails, the sheets' swipes and
//     every placement maths work unchanged. The browser's own hit testing already follows the transform.
//   - the CSS: the stylesheets were written for a viewport, not a turned body. While turned, every sheet is turned in place
//     (viewport units become shares of the body's box, --lk-rw × --lk-rh, not the other viewport unit; see flipDecls):
//     size media queries swap width and height (orientation and aspect ratio too), and the safe-area insets
//     move round by a quarter turn (the notch is on the layout's left, the home indicator on its right). New <style> and
//     <link> sheets are turned as they arrive; turning the phone back restores each rule's own text.
//   - the first paint: earlyTurn, written into index.html's <head> by v2/vite.config.js, turns the page and flips the sheets
//     before the first paint; the module carries on from there.
// ?portrait=1 (engine/flags.js) keeps the upright layouts for one release, as before this ruling; a tablet and a desktop never
// turn. A test or a tool reaches window.__veliaTurn: { rotated(), toScreen(x, y), toLayout(x, y), screenRect(el) }.
import { readFacts, LIMITS } from '../../src/core/profile.js';

export const PHONE_SHORT = LIMITS.phoneShort;   // src/core/profile.js: a short side under 500 px is a phone (turnKit keeps its own 500: it is inlined)

// The turn's pure kit, one self-contained function: the module uses it, and v2/vite.config.js writes its source into index.html's
// <head> (earlyTurn below), so the first paint is already turned and flipped with no wait for the modules (a hidden or a
// mis-laid page for seconds on a slow phone otherwise). Nothing in it may refer to anything outside it.
export function turnKit() {
  const SHORT = 500;
  // a phone held upright (a coarse pointer, taller than wide, short side under 500 px), unless ?portrait=1
  const rotatedFor = ({ w, h, coarse, portrait = false }) => !portrait && !!coarse && h > w && Math.min(w, h) < SHORT;
  // the body is rotate(90deg) translateY(-100%) about its top-left corner, W the screen's (upright) width
  const toLayout = (sx, sy, W) => [sy, W - sx];
  const toScreen = (lx, ly, W) => [W - ly, lx];
  const rectToLayout = ({ left, top, width, height }, W) => ({ left: top, top: W - left - width, width: height, height: width });
  // a media query for the turned body: width and height swap, portrait and landscape swap, min-aspect-ratio a/b is max b/a
  const SWAP = { width: 'height', height: 'width', portrait: 'landscape', landscape: 'portrait', min: 'max', max: 'min' };
  const flipMedia = (text) => String(text)
    .replace(/\b(min|max)-aspect-ratio(\s*:\s*)([\d.]+)\s*\/\s*([\d.]+)/g, (m, mm, c, a, b) => `${SWAP[mm]}-aspect-ratio${c}${b}/${a}`)
    .replace(/\b((?:min-|max-)?(?:device-)?)(width|height)\b/g, (m, pre, wh) => pre + SWAP[wh])
    .replace(/\b(portrait|landscape)\b/g, (m) => SWAP[m]);
  // a declaration block for the turned body: a viewport unit becomes a share of the turned frame, the body's own box
  // (--lk-rw × --lk-rh on <html>: the screen's innerHeight × innerWidth, the frame every layout and projection maths reads),
  // so vw is the layout's width, vh (dvh, svh, lvh) its height. Not the other viewport unit: on an iPhone launched from the
  // Home Screen 100vh is the whole screen while innerHeight stops under the status bar (2026-11-16: the canvas 61 px longer
  // than the frame, the cockpit cut off and every hit target a control away from its drawn switch). The safe-area insets go
  // a quarter turn round (layout top is the screen's right, right its bottom, bottom its left, left its top).
  const INSET_ON = { top: 'right', right: 'bottom', bottom: 'left', left: 'top' };
  const share = (n) => +(n / 100).toPrecision(6);
  const flipDecls = (text) => String(text)
    .replace(/(-?)(\d*\.?\d+)([dsl]?)v([wh])\b/g, (m, sg, n, k, a) => `calc(var(--lk-${a === 'w' ? 'rw' : 'rh'}) * ${sg}${share(+n)})`)
    .replace(/safe-area-inset-(top|right|bottom|left)\b/g, (m, x) => `safe-area-inset-${INSET_ON[x]}`);
  const NEEDS = /\d[dsl]?v[wh]\b|safe-area-inset-/;
  // turns one sheet's rules in place (dir 1: @media queries flipped, declaration blocks rewritten, each rule's own text kept in
  // orig) or back (dir -1: each rule's kept text restored)
  const flipRules = (rules, dir = 1, orig = new WeakMap()) => {
    for (const r of rules ?? []) {
      const media = r.media && typeof r.media.mediaText === 'string' && r.cssRules, style = r.style && r.constructor?.name !== 'CSSFontFaceRule';
      if (dir > 0) {
        const o = {};
        if (media) { o.media = r.media.mediaText; r.media.mediaText = flipMedia(o.media); }
        if (style) { const t = r.style.cssText; if (NEEDS.test(t)) { o.css = t; r.style.cssText = flipDecls(t); } }
        if (o.media != null || o.css != null) orig.set(r, o);
      } else {
        const o = orig.get(r);
        if (o?.media != null) r.media.mediaText = o.media; else if (media) r.media.mediaText = flipMedia(r.media.mediaText);
        if (o?.css != null) r.style.cssText = o.css;
        orig.delete(r);
      }
      if (r.cssRules && r.constructor?.name !== 'CSSImportRule') flipRules(r.cssRules, dir, orig);
    }
  };
  return { rotatedFor, toLayout, toScreen, rectToLayout, flipMedia, flipDecls, flipRules };
}
export const { rotatedFor, toLayout, toScreen, rectToLayout, flipMedia, flipDecls, flipRules } = turnKit();

// The first paint's turn (index.html, written by v2/vite.config.js as (earlyTurn)((turnKit)()) at the end of <head>, after every
// stylesheet the page starts with): sets html.lk-rot and the body's size, flips the sheets so far and leaves them in
// window.__veliaTurnFlipped (a WeakMap the module carries on). Self-contained like turnKit.
export function earlyTurn(kit) {
  const H = document.documentElement, w = innerWidth, h = innerHeight;
  const coarse = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
  if (!kit.rotatedFor({ w, h, coarse, portrait: /[?&]portrait=1\b/.test(location.search) })) return;
  H.classList.add('lk-rot'); H.style.setProperty('--lk-rw', `${h}px`); H.style.setProperty('--lk-rh', `${w}px`);
  const orig = window.__veliaTurnOrig = new WeakMap();
  const done = window.__veliaTurnFlipped = new WeakMap(), keep = [...document.querySelectorAll('style[data-lk-keep]')].map((e) => e.sheet);
  for (const s of document.styleSheets) {
    if (keep.includes(s)) continue;
    try { kit.flipRules(s.cssRules, 1, orig); done.set(s, true); } catch { /* not readable */ }
  }
  H.classList.add('lk-rot-css');
}

let installed = null;

export function installLandscape({ win = globalThis, doc = globalThis.document, portrait = false } = {}) {
  if (installed) return installed;
  if (!doc?.documentElement || typeof win.matchMedia !== 'function') return null;
  const H = doc.documentElement;
  const coarse = () => readFacts(win).coarse;   // the device profile's fact (src/core/profile.js), the same query earlyTurn reads at the first paint
  const find = (o, k) => { for (let p = o; p; p = Object.getPrototypeOf(p)) { const d = Object.getOwnPropertyDescriptor(p, k); if (d) return d; } return null; };
  const iw = find(win, 'innerWidth'), ih = find(win, 'innerHeight');
  const W = () => iw.get.call(win), Hh = () => ih.get.call(win);
  let rot = false;
  const nativeRect = win.Element?.prototype.getBoundingClientRect;   // the screen's frame, for tests and tools (screenRect)

  // the sheets: each flipped once per turn; the state per sheet object (a style's new text makes a new, unflipped sheet)
  const flipped = win.__veliaTurnFlipped ?? new WeakMap();   // the first paint's flips (earlyTurn), carried on
  const orig = win.__veliaTurnOrig ?? new WeakMap();          // each turned rule's own text, for the turn back
  const keepEls = [...(doc.querySelectorAll?.('style[data-lk-keep]') ?? [])];   // index.html's turn rule: never flipped
  const keep = (s) => keepEls.some((e) => e.sheet === s);
  const flipSheets = () => {
    for (const s of doc.styleSheets ?? []) {
      if (keep(s) || !!flipped.get(s) === rot) continue;
      try { flipRules(s.cssRules, rot ? 1 : -1, orig); flipped.set(s, rot); } catch { /* not readable yet (a loading link) */ }
    }
  };
  let queued = false;
  const later = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; flipSheets(); }); };
  const isSheet = (n) => n.nodeName === 'STYLE' || (n.nodeName === 'LINK' && /stylesheet/i.test(n.rel ?? ''));
  const mo = typeof win.MutationObserver === 'function' ? new win.MutationObserver((list) => {
    for (const m of list) {
      if (m.target?.nodeName === 'STYLE') { later(); return; }
      for (const n of m.addedNodes) {
        if (isSheet(n)) { if (n.nodeName === 'LINK') n.addEventListener('load', later, { once: true }); later(); return; }
        if (n.nodeType === 1 && n.firstElementChild && n.querySelector?.('style,link[rel~=stylesheet]')) { later(); return; }
      }
    }
  }) : null;

  const sync = () => {
    const now = rotatedFor({ w: W(), h: Hh(), coarse: coarse(), portrait });
    if (now) { H.style.setProperty('--lk-rw', `${Hh()}px`); H.style.setProperty('--lk-rh', `${W()}px`); }
    if (now === rot && H.classList.contains('lk-rot') === now && H.classList.contains('lk-rot-css') === now) return;
    rot = now;
    H.classList.toggle('lk-rot', rot);
    if (!rot) { H.style.removeProperty('--lk-rw'); H.style.removeProperty('--lk-rh'); }
    flipSheets();
    if (rot) mo?.observe(H, { childList: true, subtree: true }); else mo?.disconnect();
    H.classList.toggle('lk-rot-css', rot);
    try { win.dispatchEvent(new win.CustomEvent('lk-turn', { detail: { rotated: rot } })); } catch { /* no DOM */ }   // the device profile's rotated quirk
  };

  // the frame: patched once (only where a phone can be turned: a coarse pointer); every getter reads the native one unless turned
  const patched = coarse() && !portrait;
  if (patched) {
    const getter = (proto, k, fn) => {
      const d = proto && Object.getOwnPropertyDescriptor(proto, k);
      if (!d?.get) return;
      const nat = d.get;
      Object.defineProperty(proto, k, { ...d, get() { return rot ? fn.call(this, nat) : nat.call(this); } });
    };
    const pair = (proto, kx, ky) => {
      const dx = proto && Object.getOwnPropertyDescriptor(proto, kx), dy = proto && Object.getOwnPropertyDescriptor(proto, ky);
      if (!dx?.get || !dy?.get) return;
      const gx = dx.get, gy = dy.get;
      getter(proto, kx, function () { return gy.call(this); });
      getter(proto, ky, function () { return W() - gx.call(this); });
    };
    for (const C of [win.MouseEvent, win.Touch]) {
      const P = C?.prototype;
      pair(P, 'clientX', 'clientY'); pair(P, 'pageX', 'pageY');
      if (C === win.MouseEvent) {
        pair(P, 'x', 'y');
        const dmx = Object.getOwnPropertyDescriptor(P, 'movementX'), dmy = Object.getOwnPropertyDescriptor(P, 'movementY');
        if (dmx?.get && dmy?.get) { const gx = dmx.get, gy = dmy.get; getter(P, 'movementX', function () { return gy.call(this); }); getter(P, 'movementY', function () { return -gx.call(this); }); }
      }
    }
    Object.defineProperty(win, 'innerWidth', { configurable: true, enumerable: true, get: () => (rot ? Hh() : W()), set: iw.set ? (v) => iw.set.call(win, v) : undefined });
    Object.defineProperty(win, 'innerHeight', { configurable: true, enumerable: true, get: () => (rot ? W() : Hh()), set: ih.set ? (v) => ih.set.call(win, v) : undefined });
    const E = win.Element?.prototype;
    if (E) {
      const gbcr = E.getBoundingClientRect, gcr = E.getClientRects;
      const lay = (r) => { const o = rectToLayout(r, W()); return new win.DOMRect(o.left, o.top, o.width, o.height); };
      E.getBoundingClientRect = function () { const r = gbcr.call(this); return rot ? lay(r) : r; };
      E.getClientRects = function () { const l = gcr.call(this); return rot ? Array.from(l, lay) : l; };
      for (const [kw, kh] of [['clientWidth', 'clientHeight'], ['scrollWidth', 'scrollHeight']]) {   // the root's: the viewport's, swapped
        const dw = Object.getOwnPropertyDescriptor(E, kw), dh = Object.getOwnPropertyDescriptor(E, kh);
        if (!dw?.get || !dh?.get) continue;
        const gw = dw.get, gh = dh.get;
        getter(E, kw, function (nat) { return this === doc.documentElement ? gh.call(this) : nat.call(this); });
        getter(E, kh, function (nat) { return this === doc.documentElement ? gw.call(this) : nat.call(this); });
      }
    }
    const D = win.Document?.prototype;
    for (const k of ['elementFromPoint', 'elementsFromPoint']) {
      const f = D?.[k];
      if (typeof f === 'function') D[k] = function (x, y) { if (!rot) return f.call(this, x, y); const [sx, sy] = toScreen(x, y, W()); return f.call(this, sx, sy); };
    }
  }
  if (!patched) { H.classList.remove('lk-rot'); H.classList.add('lk-rot-css'); }   // never turned: the inline script's guess is undone, the body shown
  else {
    win.addEventListener('resize', sync, { capture: true });   // before every other resize listener: they read the new frame
    win.addEventListener('orientationchange', sync, { capture: true });
    sync();
  }

  installed = {
    rotated: () => rot,
    portrait,
    toScreen: (x, y) => (rot ? toScreen(x, y, W()) : [x, y]),
    toLayout: (x, y) => (rot ? toLayout(x, y, W()) : [x, y]),
    screenRect: (el) => nativeRect.call(el),
    sync,
  };
  win.__veliaTurn = installed;
  return installed;
}

// on entering a mode on an upright phone (a tap: the gesture both APIs need): full screen, then the landscape lock (Android; Chrome locks
// only in full screen). Where either is refused (an iPhone has neither), the CSS turn above stands. Failures are silent.
export function enterLandscape({ win = globalThis, doc = globalThis.document, portrait = !!installed?.portrait } = {}) {
  try {
    if (portrait || !installed?.rotated()) return false;   // only a turned page (an upright phone): a sideways phone is landscape already
    const s = win.screen, short = Math.min(s?.width ?? 0, s?.height ?? 0);
    if (!(short > 0 && short < PHONE_SHORT)) return false;
    const el = doc.documentElement, req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    const lock = () => { try { s?.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* no lock */ } };
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) { lock(); return true; }
    if (typeof req !== 'function') return false;
    const r = req.call(el);
    if (r?.then) r.then(lock, () => {}); else lock();
    return true;
  } catch { return false; }
}
