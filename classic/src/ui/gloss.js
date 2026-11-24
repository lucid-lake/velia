// The hover / long-press gloss ('s words): one quiet line under a term, "Winch · winds the rope in",
// in the hints' hand (design tokens, a halo, never a box). It shows on:
//   - a mouse hovering a .term[data-term] anywhere on the page (the hint rows, the H list, the words page);
//   - a finger held 0.45 s on one (the line stays 2.6 s);
//   - a 'lk-gloss' window event ({ detail: { term, x, y } }) from the 3D parts (the helm view's winch, the sheet's
//     tail, the wheel) and the glyph; 'lk-gloss-off' hides it. Showing a gloss means the player met the term.
//
//   const gloss = createGloss({ words });   // words: createWords() from words.js
//   gloss.show('winch', x, y); gloss.hide(); gloss.dispose();
import { ensureTokens } from '../../../src/ui/tokens.js';

const CSS = `
.lk-gloss{position:fixed;left:0;top:0;z-index:var(--lk-z-gloss);pointer-events:none;user-select:none;white-space:nowrap;
  font:var(--lk-regular) var(--lk-fs-caption)/1.2 var(--lk-ui);color:var(--lk-ink);letter-spacing:var(--lk-track);
  padding:.4em .8em;border-radius:var(--lk-glass-r);background:var(--lk-glass-dense);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--lk-glass-edge);box-shadow:var(--lk-glass-shadow);
  opacity:0;transform:translateY(var(--lk-rise));
  transition:opacity var(--lk-out) var(--lk-ease-out),transform var(--lk-out) var(--lk-ease-out);
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.lk-gloss.in{opacity:1;transform:none;transition:opacity var(--lk-in) var(--lk-ease),transform var(--lk-in) var(--lk-ease)}
.lk-gloss b{font-weight:var(--lk-medium);color:var(--lk-lit-ink)}
.lk-gloss .dot{margin:0 .45em;color:var(--lk-ink-soft)}
.term{cursor:help;text-decoration:underline dotted var(--lk-rest);text-underline-offset:.28em;text-decoration-thickness:1px}
.lk-hint .term,.lk-log .term,.lk-menu .term{pointer-events:auto}
.lk-hint .tag{color:var(--lk-ink-soft)}
@media (prefers-reduced-motion:reduce){.lk-gloss{transform:none}}
`;

export function createGloss({ words, root = document.body } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-gloss-css')) { const st = document.createElement('style'); st.id = 'lk-gloss-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div'); el.className = 'lk-gloss'; el.setAttribute('role', 'tooltip'); root.appendChild(el);
  let cur = null, holdT = 0, offT = 0;

  function show(id, x, y, { hold = 0 } = {}) {
    const g = words?.gloss?.(id); if (!g) return;
    clearTimeout(holdT); clearTimeout(offT);
    if (cur !== id) el.innerHTML = `<b>${g.term}</b><span class="dot">·</span>${g.gloss}`;
    cur = id;
    words.meet(id);
    // under the point, centred, kept inside the safe margins (the viewport; 16 px at least)
    const w = el.offsetWidth || 220, vw = globalThis.innerWidth || 1280, vh = globalThis.innerHeight || 720;
    const left = Math.max(16, Math.min(vw - w - 16, x - w / 2));
    const top = y + 20 > vh - 56 ? Math.max(16, y - 44) : Math.max(16, y + 20);   // under the point; above it near the bottom edge (the hint row)
    el.style.transform = ''; el.style.left = `${Math.round(left)}px`; el.style.top = `${Math.round(top)}px`;
    el.classList.add('in');
    if (hold) offT = setTimeout(hide, hold);
  }
  function hide() { clearTimeout(offT); cur = null; el.classList.remove('in'); }

  // ---- the pointer: hover (mouse) and a long press (touch) on any .term ----
  const termAt = (t) => t?.closest?.('.term[data-term]');
  const rectPoint = (n) => { const r = n.getBoundingClientRect(); return [r.left + r.width / 2, r.bottom - 4]; };
  const onOver = (e) => { if (e.pointerType === 'touch') return; const n = termAt(e.target); if (n) { const [x, y] = rectPoint(n); show(n.dataset.term, x, y); } };
  const onOut = (e) => { if (e.pointerType === 'touch') return; if (termAt(e.target)) hide(); };
  let pressNode = null;
  const onDown = (e) => {
    if (e.pointerType !== 'touch') return;
    const n = termAt(e.target); if (!n) return;
    pressNode = n; clearTimeout(holdT);
    const [x, y] = rectPoint(n), id = n.dataset.term;   // the spot now: a hint may redraw while the finger is down
    holdT = setTimeout(() => show(id, x, y, { hold: 2600 }), 450);
  };
  const onUp = () => { clearTimeout(holdT); pressNode = null; };
  const onEvt = (e) => { const d = e.detail ?? {}; if (d.term) show(d.term, d.x ?? 0, d.y ?? 0); };
  const onOff = () => hide();
  const onKey = (e) => { if (cur && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(Shift|Control|Alt|Meta)/.test(e.key ?? '')) hide(); };   // the player moved on: the logbook, the menu, a key
  addEventListener('pointerover', onOver); addEventListener('pointerout', onOut);
  addEventListener('pointerdown', onDown); addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);
  addEventListener('keydown', onKey);
  addEventListener('lk-gloss', onEvt); addEventListener('lk-gloss-off', onOff);

  function dispose() {
    removeEventListener('pointerover', onOver); removeEventListener('pointerout', onOut);
    removeEventListener('pointerdown', onDown); removeEventListener('pointerup', onUp); removeEventListener('pointercancel', onUp);
    removeEventListener('keydown', onKey); removeEventListener('lk-gloss', onEvt); removeEventListener('lk-gloss-off', onOff);
    clearTimeout(holdT); clearTimeout(offT); el.remove();
  }
  return { show, hide, dispose, el, get current() { return cur; } };
}
