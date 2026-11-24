// The hand on <html> (fix/v2-phone-desktop-text, owner 2026-11-15: "lots of desktop version info on the phone"): one answer
// for CSS and JS to word and show things by. data-hand="touch" | "keys" on the root element:
//   touch   a finger is the hand: the device's main pointer is coarse (touchMap.js isCoarse, ?touch=1|0) before any input,
//           and the input modality's last pointer was a finger (pointer.js createModality, its window event 'lk-modality')
//   keys    a keyboard, a mouse or a pad (a desktop, an iPad with a trackpad once it is used)
// The device itself is the profile's (src/core/profile.js: data-input, data-form, data-screen); this one names the hand in use.
//   watchHand()          // sets data-hand now and follows the modality; returns dispose()
//   hand()               // 'touch' | 'keys' (the attribute, else isCoarse())
//   touchHand()          // hand() === 'touch'
//   handOf({ kind, pointer }, coarse)   // pure: the modality's state → 'touch' | 'keys'
import { isCoarse } from './touchMap.js';
import { feature } from '../core/features.js';
import { profile } from '../core/profile.js';

export const HANDS = ['touch', 'keys'];

export function handOf({ kind = null, pointer = null } = {}, coarse = false) {
  if (kind === null) return coarse ? 'touch' : 'keys';
  return kind === 'mouse' && pointer === 'touch' ? 'touch' : 'keys';
}

const rootEl = (doc) => doc?.documentElement ?? null;

export function hand({ doc = globalThis.document, win = globalThis } = {}) {
  const h = rootEl(doc)?.dataset?.hand;
  if (h === 'touch' || h === 'keys') return h;
  return isCoarse(win) ? 'touch' : 'keys';
}
export const touchHand = (o) => hand(o) === 'touch';

// A label's key, said in brackets at its end ("Menu (Esc)", "Take the helm (A D)", "next song (])", "Full screen (Shift+F)"):
// a screen reader on a phone reads no key (owner 2026-11-15; audit row 15). keyless('Boat view (C)') → 'Boat view'
const KEY_TAIL = /\s\((?:Esc|Space|Shift\+[A-Z]|⇧[A-Z]|[A-Z](?: [A-Z])?|[`[\]0-9+−-])\)$/;
export const keyless = (label) => String(label ?? '').replace(KEY_TAIL, '');

// What a finger never gets (owner, 2026-11-15: "binoculars is not needed for phone"): the glasses' every way in, the cockpit's
// BINOS target, the PANEL row's cell, the dock's slot and the Locker's or the View menu's row. The key B still works on a keyboard.
// One rule: the registry's binoculars (src/core/features.js: off when the device is finger-only), so CSS and JS agree.
export const HAND_CSS = `:root[data-f-binoculars=off] :is(.lk-cp,.lk-cpx,.lk-pro) .c[data-id=binoculars],
:root[data-f-binoculars=off] .lk-dock .it[data-id=binoculars],
:root[data-f-binoculars=off] .lk-timepick button:is([data-id=binoculars],[data-id=glasses],[data-v=glasses]){display:none!important}`;

export function watchHand({ doc = globalThis.document, win = globalThis } = {}) {
  const H = rootEl(doc); if (!H) return () => {};
  profile.refresh(); feature('fingerTargets');   // the device profile's data-* and the finger targets' rule before the first card's CSS reads them
  feature('binoculars');   // decides and publishes data-f-binoculars (src/core/features.js) before HAND_CSS reads it
  if (doc.head && !doc.getElementById('lk-hand-css')) { const st = doc.createElement('style'); st.id = 'lk-hand-css'; st.textContent = HAND_CSS; doc.head.appendChild(st); }
  // the labels' keys leave while the hand is a finger (a MutationObserver over aria-label and title; the desktop's stay as written)
  let mo = null;
  const strip = (el, a) => { const v = el.getAttribute?.(a); if (v && KEY_TAIL.test(v)) el.setAttribute(a, keyless(v)); };
  const sweep = () => { for (const el of doc.querySelectorAll?.('[aria-label],[title]') ?? []) { strip(el, 'aria-label'); strip(el, 'title'); } };
  const follow = (h) => {
    if (h === 'touch' && !mo && typeof win.MutationObserver === 'function' && doc.body) {
      sweep();
      mo = new win.MutationObserver((recs) => { for (const r of recs) {
        if (r.type === 'attributes') strip(r.target, r.attributeName);
        else for (const n of r.addedNodes) if (n.nodeType === 1) { strip(n, 'aria-label'); strip(n, 'title'); for (const el of n.querySelectorAll('[aria-label],[title]')) { strip(el, 'aria-label'); strip(el, 'title'); } }
      } });
      mo.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-label', 'title'] });
    } else if (h !== 'touch' && mo) { mo.disconnect(); mo = null; }
  };
  const set = (h) => { if (H.dataset.hand !== h) { H.dataset.hand = h; follow(h); try { win.dispatchEvent?.(new CustomEvent('lk-hand', { detail: { hand: h } })); } catch { /* no DOM */ } } };
  set(handOf({}, isCoarse(win)));
  if (!doc.body) doc.addEventListener?.('DOMContentLoaded', () => follow(H.dataset.hand), { once: true });
  const onMod = (e) => set(handOf(e?.detail ?? {}, isCoarse(win)));
  win.addEventListener?.('lk-modality', onMod);
  return () => { win.removeEventListener?.('lk-modality', onMod); mo?.disconnect(); mo = null; };
}
