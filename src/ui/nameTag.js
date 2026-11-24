// A button's name, and its key, in a small tag beside it (owner, 2026-11-06: Cruise's bars, one rule for both modes;
// Solaria stage 1 the same day: every icon button). A desktop shows the bars' buttons as icon + word; a phone, or a window
// too narrow for the words, shows icons only. A hover (a mouse, after NAME_TAG.hoverMs) or a long-press (a finger) shows
// the tag: the name, and the key when the button has one ("Binoculars · B"). A button whose word is on screen and which
// has no key gets no tag (the word says it). No browser tooltip (a title floated over the sky). A long-press is not a press:
// the click it ends in is swallowed (consumed(b), checked by the button's own handler).
//
// The tag never covers the skipper's line (avoid(): the boxes it must keep clear of; it tries its side, then the other,
// else it stays down), and goes the moment the player drags or steers (a key, a press elsewhere, a drag, a wheel).
// It is off when enabled() says so (Settings › Screen › button tips: html[data-lk-tips=off], src/ui/tips.js).
//
//   const tags = createNameTags({ side: 'up' | 'down' });
//   tags.add(button, { side, shown, name });   // per button: its side, "is its word on screen", its tag text
//   if (tags.consumed(button)) return;   // in the button's click handler
//   tags.forget(button); tags.dispose();
// Its name comes from (in order) data-tip, else the aria-label with its "(K)" key, else the .w word.
// Tests: tests/tips.test.mjs, tests/viewSwitch.test.mjs, tests/pages/tips.page.mjs.
import { ensureTokens } from './tokens.js';

export const NAME_TAG = { holdMs: 450, hoverMs: 120, showMs: 1600, gapPx: 10, dragPx: 8 };

// the glass-dense tip, at caption size (tokens.css): no colour of its own, so a palette swap is a token change
const CSS = `
.lk-ntag{position:fixed;z-index:var(--lk-z-gloss);left:0;top:0;padding:.38em .8em .36em;border-radius:999px;white-space:nowrap;pointer-events:none;
  background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);box-shadow:var(--lk-glass-shadow);
  color:var(--lk-chrome-ink);font:var(--lk-medium) var(--lk-fs-caption)/1.2 var(--lk-ui);letter-spacing:var(--lk-track);-webkit-font-smoothing:antialiased}
.lk-ntag[hidden]{display:none}
.lk-ntags button,[data-tipped]{-webkit-touch-callout:none}
`;

// the word is on screen: laid out, not display:none (the bars hide their words where they do not fit, and on a phone)
function wordShown(b) {
  const w = b?.querySelector?.('.w');
  if (!w) return false;
  const cs = globalThis.getComputedStyle?.(w);
  if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) return false;
  return (w.getBoundingClientRect?.().width ?? 0) > 0;
}
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : '');
// the name a tag says: the word on the button, or its aria-label (without its key), first letter up
export function nameOf(b) {
  const t = (b?.querySelector?.('.w')?.textContent || b?.getAttribute?.('aria-label') || '').trim();
  return cap(t.replace(/\s*\([^()]*\)\s*$/, ''));
}
// the key a button names in its aria-label, "Binoculars (B)" → "B"; data-tip-key wins
export function keyOf(b) {
  const k = b?.dataset?.tipKey ?? b?.getAttribute?.('aria-label')?.match(/\(([^()]+)\)\s*$/)?.[1];
  return k ? k.trim() : '';
}
// the tag's text: data-tip as it stands, else the name and the key ("Binoculars · B"); with a key the name is the
// aria-label's (it says more than a one-word label: "Full screen · Shift+F")
export function tipText(b) {
  if (b?.dataset?.tip) return b.dataset.tip;
  const k = keyOf(b);
  if (!k) return nameOf(b);
  const label = (b.getAttribute?.('aria-label') ?? '').replace(/\s*\([^()]*\)\s*$/, '').trim();
  return `${cap(label) || nameOf(b)} · ${k}`;
}
// the skipper's line (tokens.css .lk-hint > .row): the boxes a tag keeps clear of, when they hold words
function skipperBoxes(doc = globalThis.document) {
  const out = [];
  for (const r of doc?.querySelectorAll?.('.lk-hint > .row') ?? []) {
    if (!(r.textContent ?? '').trim() || r.hidden) continue;
    const cs = globalThis.getComputedStyle?.(r);
    if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.05)) continue;
    const b = r.getBoundingClientRect?.(); if (b && b.width > 0 && b.height > 0) out.push(b);
  }
  return out;
}
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

export function createNameTags({ root = document.body, side = 'up', shown = wordShown, name = tipText, hoverMs = NAME_TAG.hoverMs,
  enabled = () => true, avoid = () => skipperBoxes(), target = globalThis } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-ntag-css')) { const st = document.createElement('style'); st.id = 'lk-ntag-css'; st.textContent = CSS; document.head.appendChild(st); }
  const tag = document.createElement('div'); tag.className = 'lk-ntag'; tag.hidden = true; tag.setAttribute('aria-hidden', 'true'); tag.setAttribute('role', 'tooltip'); tag.dataset.side = side;
  root.appendChild(tag);
  const opts = new Map();   // button → { side, shown, name }
  let timer = null, hideTimer = null, eaten = null, on = null, pend = null, downAt = null;
  const clear = () => { if (timer) { clearTimeout(timer); timer = null; } pend = null; };
  const o = (b) => opts.get(b) ?? {};
  const textOf = (b) => (o(b).name ?? name)(b);
  // a tag only when it says something the screen does not: the word is hidden, or there is a key to learn (or data-tip)
  const wants = (b) => !!textOf(b) && (!(o(b).shown ?? shown)(b) || !!keyOf(b) || !!b.dataset?.tip);
  // a finger's long-press names the button without its key: a touch device shows no keyboard hints (owner, 2026-11-15)
  const keyless = (b, t) => { const k = keyOf(b); return k && t.endsWith(` · ${k}`) ? t.slice(0, -(k.length + 3)) : t; };
  function show(b, { touch = false } = {}) {
    clearTimeout(hideTimer); hideTimer = null;
    if (!enabled()) return;
    const t0 = textOf(b); if (!t0) return;
    const t = touch ? keyless(b, t0) : t0;
    tag.textContent = t; tag.hidden = false; on = b;
    const r = b.getBoundingClientRect?.() ?? { left: 0, top: 0, bottom: 0, width: 0 };
    const vw = document.documentElement?.clientWidth || globalThis.innerWidth || 0, vh = document.documentElement?.clientHeight || globalThis.innerHeight || 0;
    const w = tag.offsetWidth || 0, h = tag.offsetHeight || 0;
    const x = Math.max(8, Math.min(Math.max(8, vw - w - 8), r.left + r.width / 2 - w / 2));
    const s0 = o(b).side ?? side;
    const yOf = (s) => (s === 'up' ? r.top - NAME_TAG.gapPx - h : r.bottom + NAME_TAG.gapPx);
    const fits = (s) => { const y = yOf(s); return y >= 4 && (!vh || y + h <= vh - 4); };
    const clearOf = (s) => { const y = yOf(s), box = { left: x, right: x + w, top: y, bottom: y + h }; return !avoid().some((a) => overlaps(box, a)); };
    // its side, else the other side, else no tag: it never covers the skipper's line
    const s = [s0, s0 === 'up' ? 'down' : 'up'].find((k) => (h === 0 || fits(k)) && clearOf(k));
    if (!s) { hide(); return; }
    tag.dataset.side = s;
    tag.style.left = `${Math.round(x)}px`; tag.style.top = `${Math.round(yOf(s))}px`;
  }
  function hide() { clear(); clearTimeout(hideTimer); hideTimer = null; tag.hidden = true; on = null; }
  const touchy = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
  const mine = (b, t) => !!b && (b === t || !!b.contains?.(t));
  function add(b, o2 = {}) {
    if (opts.has(b)) { opts.set(b, { ...opts.get(b), ...o2 }); return b; }
    opts.set(b, o2);
    if (b.dataset) b.dataset.tipped = '';   // no iOS callout on a long-press (an attribute: a bar's classes stay its own)
    b.parentElement?.closest?.('.lk-view')?.classList.add('lk-ntags');
    b.addEventListener('pointerenter', (e) => {
      if (touchy(e) || e.buttons) return;   // a drag passing over is not a hover
      clear(); if (wants(b)) { pend = b; timer = setTimeout(() => { timer = null; pend = null; show(b); }, o(b).hoverMs ?? hoverMs); }
    });
    b.addEventListener('pointerleave', (e) => { if (!touchy(e)) hide(); });
    b.addEventListener('pointerdown', (e) => {
      clear();
      if (!touchy(e)) { hide(); return; }   // a mouse press is the press
      eaten = null;
      if (!enabled()) return;
      pend = b; timer = setTimeout(() => { timer = null; pend = null; show(b, { touch: true }); eaten = b; }, NAME_TAG.holdMs);
    });
    const up = (e) => {
      if (!touchy(e)) return;
      clear();
      if (on === b) { clearTimeout(hideTimer); hideTimer = setTimeout(() => { hideTimer = null; tag.hidden = true; on = null; }, NAME_TAG.showMs); }
    };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => { if (eaten === b || timer) e.preventDefault?.(); });   // Android's long-press menu
    return b;
  }
  // the player drags or steers: the tag goes at once (a key, a press elsewhere, a drag, the wheel)
  const onKey = () => { if (on || pend) hide(); };
  const onDown = (e) => { downAt = { x: e.clientX ?? 0, y: e.clientY ?? 0 }; if ((on || pend) && !mine(on ?? pend, e.target)) hide(); };
  const onMove = (e) => {
    if (!(on || pend) || !e.buttons) return;
    const d = downAt ? Math.hypot((e.clientX ?? 0) - downAt.x, (e.clientY ?? 0) - downAt.y) : Infinity;
    if (d > NAME_TAG.dragPx || !mine(on ?? pend, e.target)) { if (eaten && mine(eaten, e.target)) eaten = null; hide(); }
  };
  const onWheel = () => { if (on || pend) hide(); };
  target.addEventListener?.('keydown', onKey, true);
  target.addEventListener?.('pointerdown', onDown, true);
  target.addEventListener?.('pointermove', onMove, { capture: true, passive: true });
  target.addEventListener?.('wheel', onWheel, { capture: true, passive: true });
  return {
    el: tag, add, show, hide,
    get shown() { return !tag.hidden; }, get text() { return tag.hidden ? null : tag.textContent; }, get side() { return tag.hidden ? null : tag.dataset.side; },
    // true once, for the click that ends a long-press (the press showed the name; it does not also run the button)
    consumed(b) { if (eaten && eaten === b) { eaten = null; return true; } return false; },
    forget(b) { if (on === b || pend === b) hide(); opts.delete(b); },
    dispose() {
      hide(); tag.remove(); opts.clear();
      target.removeEventListener?.('keydown', onKey, true); target.removeEventListener?.('pointerdown', onDown, true);
      target.removeEventListener?.('pointermove', onMove, { capture: true }); target.removeEventListener?.('wheel', onWheel, { capture: true });
    },
  };
}
