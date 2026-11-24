// The in-play Menu card without a Resume step (owner, 2026-11-15: "tapping Cruise, Sail or Race must enter that mode at
// once"), mounted by ui/front.js on v1's home card (src/ui/home.js; no v1 file touched). In play (data-state=menu):
//   a mode      a tap (or Enter on it) enters that mode and closes the card; a tap on the current mode just closes it
//   no Resume   the ENTER pill (it read Resume here) is hidden; the four page links share its row
//   the way back  Esc, the × at the card's top-right, a tap on the world outside the card (cardClose.js), or the current mode
// The home card at first load: no ENTER button on any device (owner, 2026-11-15). Desktop (data-hand=keys; owner, 2026-11-17: "the Sail
// button is highlighted, and pressing Enter enters Sail"): Sail is lit, Enter or Space starts the lit mode, arrows and Tab move it
// (home.js deskEnter). Phones and tablets: no lit mode, no Enter-key start; only a tap on a mode (or a tabbed-to mode's own Enter
// or Space) enters it (home.js createEnter; a tap while loading still queues and lights it). The status line says to pick one.
// The idle attract stays.
// By the hand (src/ui/hand.js): a finger's KEYS link reads Controls (it opens the touch rows alone, front.js keysPageHtml phone).
// The way in: the card leaves with the loading shell by fading from full, never by coming back first (data-out-from below).
// Step D1 (owner 2026-11-17: "the menu over the live scene, polished … same for the home menu card"): in play a soft scrim behind the
// card's side of the screen (a navy radial wash, no blur; the world past it stays clear, as the 2026-10-30 ruling wants) fades in and out
// with the card, and the camera drifts gently while the card is up (ui/menuDrift.js).
//   const m = mountMenuCard(root, home);   m.dispose()
export const CLOSE_LABEL = 'Close menu (Esc)';
export const CLOSE_LABEL_TOUCH = 'Close menu';
export const HOME_LINE = 'Ready to cast off. Pick a mode.';

const CSS = `#lk-load .lk-links{grid-template-columns:repeat(4,1fr)}
#lk-load .lk-links .lk-go{display:none}
#lk-load .lk-card .lk-links .lk-link.lk-tut{display:none!important}   /* TUTORIAL is the desktop panel's (ui/chart/panelPlan.js); the phone's ⋯ menu and the old card keep their rows */
#lk-load .lk-link .hk-t{display:none}
:root[data-hand=touch] #lk-load .lk-link .hk-k{display:none}
:root[data-hand=touch] #lk-load .lk-link .hk-t{display:inline}
#lk-load .lk-card .lk-x{display:none}
#lk-load[data-state=menu]:not([data-pg]) .lk-card .lk-x{all:unset;box-sizing:border-box;position:absolute;z-index:4;top:.75em;right:.85em;display:inline-flex;align-items:center;justify-content:center;width:var(--btn);height:var(--btn);border:1px solid var(--hair);border-radius:50%;background:var(--back);color:var(--navy);cursor:pointer;font-size:max(1.15em,17px);line-height:1}
#lk-load[data-state=menu] .lk-card .lk-x:hover,#lk-load[data-state=menu] .lk-card .lk-x:focus-visible{background:linear-gradient(rgb(var(--ink3) / .16),rgb(var(--ink3) / .16)),var(--back);border-color:rgb(var(--ink3) / .95)}
#lk-load[data-state=menu] .lk-card .lk-x:focus-visible{outline:2px solid var(--navy);outline-offset:2px}
:root #lk-load[data-state=menu]:not([data-pg]) .lk-veil{display:block;position:fixed;inset:0;z-index:2;pointer-events:none;opacity:0;transition:opacity .5s var(--lk-ease);
  background:radial-gradient(ellipse 58% 90% at 16% 52%,rgb(var(--lk-brand-navy) / .44) 0%,rgb(var(--lk-brand-navy) / .2) 52%,rgb(var(--lk-brand-navy) / 0) 82%),radial-gradient(ellipse 80% 75% at 55% 50%,rgb(var(--lk-brand-navy) / 0) 62%,rgb(var(--lk-brand-navy) / .2) 100%)}
:root #lk-load[data-state=menu][data-on]:not([data-pg]) .lk-veil{opacity:1}
:root #lk-load[data-state=menu][data-off] .lk-veil{opacity:0;transition-duration:.45s}
:root:where([data-screen~=tight]) #lk-load[data-state=menu]:not([data-pg]) .lk-veil{background:radial-gradient(ellipse 70% 100% at 30% 50%,rgb(var(--lk-brand-navy) / .4),rgb(var(--lk-brand-navy) / .12) 60%,rgb(var(--lk-brand-navy) / 0) 90%)}`;

// Leave race (owner, 2026-11-20: "We need a way to quit the current game; I can only restart or refresh the page"): in play during a
// race (race.now() → { live } | null; the hub is not a race) a row under Resume (the panel) or above the page links (the phone card):
// Leave race. While the race is in progress it asks once, in place ("Leave race?" Yes / No; Esc is No, the card stays); Yes (or the
// row after the finish) leaves: race.leave() (Sail where she is) and the card closes.
//   mountMenuCard(root, home, { race: { now, leave } })   m.refresh() (on each open: the row shown or not), m.escTaken() (home.js's
//   menuEsc: true when Esc answered the question)
export const LEAVE_WORD = 'Leave race', LEAVE_ASK = 'Leave race?';
const LEAVE_CSS = `#lk-load .lk-leave{display:none}
#lk-load[data-state=menu][data-race]:not([data-pg]) .lk-card .lk-leave{display:flex;grid-column:1 / -1;order:-1;align-items:center;justify-content:center;gap:10px;margin:-8px 0 18px;min-height:44px}
#lk-load .lk-leave button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:40px;padding:0 1.2em;border-radius:999px;border:1px solid var(--hair,rgb(var(--lk-cream) / .4));color:inherit;cursor:pointer;font-family:var(--lk-font);font-size:15px;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}
#lk-load .lk-leave .lk-leave-b{flex:1}
#lk-load .lk-leave button:hover,#lk-load .lk-leave button:focus-visible{background:rgb(var(--lk-cream) / .1)}
#lk-load .lk-leave button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
#lk-load .lk-leave .lk-leave-q{display:flex;align-items:center;gap:10px;flex:1;justify-content:center}
#lk-load .lk-leave .lk-leave-q[hidden],#lk-load .lk-leave .lk-leave-b[hidden]{display:none}
#lk-load .lk-leave .lk-leave-q .t{font-size:16px;font-weight:600;margin-right:4px}
#lk-load .lk-leave .lk-leave-q .y{background:rgb(var(--lk-amber));color:rgb(var(--lk-brand-navy));border-color:rgb(var(--lk-amber));font-weight:600}
:root[data-hand=touch] #lk-load .lk-leave button{height:44px}
/* the phone's card (ui/phoneCard.js: its page links sit in the ⋯ list): the row in the thumb's column, over the three modes */
:root[data-f-phone-card=on] #lk-load[data-state=menu][data-race]:not([data-pg]) .lk-card .lk-leave{position:absolute;right:14px;bottom:184px;width:var(--lk-rc,160px);margin:0;z-index:3}
:root[data-f-phone-card=on] #lk-load .lk-leave button{font-size:14px;letter-spacing:.08em;padding:0 .9em}
:root[data-f-phone-card=on] #lk-load .lk-leave .lk-leave-q{flex-wrap:wrap;gap:6px 8px}
:root[data-f-phone-card=on] #lk-load .lk-leave .lk-leave-q .t{flex-basis:100%;text-align:center;margin:0}
:root[data-f-phone-card=on] #lk-load .lk-leave .lk-leave-q button{flex:1}`;

export function mountMenuCard(root, home, { doc = globalThis.document, race = null } = {}) {
  const card = root?.querySelector?.('.lk-card');
  if (!card || !home || card.querySelector('.lk-x')) return null;
  if (!doc.getElementById('lk-menucard-css')) { const s = doc.createElement('style'); s.id = 'lk-menucard-css'; s.textContent = CSS; doc.head.appendChild(s); }
  const inPlay = () => root.dataset.state === 'menu' && !root.hasAttribute('data-off') && !root.dataset.pg;
  const x = doc.createElement('button');
  const touch = () => doc.documentElement?.dataset?.hand === 'touch';
  x.type = 'button'; x.className = 'lk-x'; x.setAttribute('aria-label', touch() ? CLOSE_LABEL_TOUCH : CLOSE_LABEL); x.innerHTML = '<span aria-hidden="true">×</span>';
  x.addEventListener('click', () => home.close());
  card.appendChild(x);
  // KEYS: Controls for a finger (both words in the button; the CSS above shows the hand's)
  const keys = root.querySelector('.lk-links [data-go=keys]');
  if (keys && !keys.querySelector('.hk-k')) keys.innerHTML = '<span class="hk-k">Keys</span><span class="hk-t">Controls</span>';
  const onHand = () => x.setAttribute('aria-label', touch() ? CLOSE_LABEL_TOUCH : CLOSE_LABEL);
  const win = doc.defaultView ?? globalThis;
  win.addEventListener?.('lk-hand', onHand);
  // no ENTER on the phone card and the old card: the button is hidden (its row is the four page links); the desktop and tablet panel
  // on the live map shows it as its one primary action, Set sail, and Resume in play (owner, 2026-11-18; ui/chart/panelPlan.js)
  const atHome = () => root.dataset.state === 'home' && !root.dataset.pg;
  const onLive = () => setTimeout(() => { if (atHome()) win.__veliaLoading?.say?.(HOME_LINE); }, 60);   // a mode tapped while loading is entering already
  win.addEventListener?.('lakeshore:home', onLive);
  if (atHome()) onLive();
  // the way in (owner 2026-11-16: "the menu card flashes again, then it enters"): the loading shell's out state fades the card from
  // full only if the card was on screen (data-out-from=card, v2/index.html lk-cardout); a tap while loading (company → home → out in
  // one task, the card never painted) keeps it away. The first record of a batch holds the state the last frame showed.
  // A phone that builds every shader first (engine/buildGate.js) holds a loading-time tap on the live card for a few frames, while
  // the card is still sliding in: what the last painted frame showed decides, not the state's name. While the state is home a
  // frame sampler keeps the card's shown opacity (the root's × the card's); the out fade starts from it (--lk-out-op), and a card
  // never painted (under 2 %) stays away.
  const MO = win.MutationObserver;
  let shown = 0, sampling = 0;
  const shownNow = () => { const card2 = root.querySelector('.lk-card'); if (!card2 || !win.getComputedStyle) return 1; const a = win.getComputedStyle(root), b = win.getComputedStyle(card2);
    return a.display === 'none' || a.visibility === 'hidden' || b.display === 'none' || b.visibility === 'hidden' ? 0 : (+a.opacity || 0) * (+b.opacity || 0); };
  const sample = () => { sampling = 0; if (root.dataset.state !== 'home') return; shown = shownNow(); sampling = win.requestAnimationFrame?.(sample) ?? 0; };
  const startSampling = () => { if (!sampling && root.dataset.state === 'home' && win.requestAnimationFrame) { shown = 0; sampling = win.requestAnimationFrame(sample); } };
  const outFrom = MO ? new MO((recs) => {
    const was = recs.find((r) => r.attributeName === 'data-state')?.oldValue;
    if (root.dataset.state === 'home') { startSampling(); return; }
    if (root.dataset.state !== 'out') return;
    const op = !win.requestAnimationFrame ? 1 : shown;   // no frames (the node tests): as before
    if (was === 'home' && op > 0.02) { root.dataset.outFrom = 'card'; root.style.setProperty('--lk-out-op', op.toFixed(3)); } else delete root.dataset.outFrom;
  }) : null;
  startSampling();
  outFrom?.observe(root, { attributes: true, attributeFilter: ['data-state'], attributeOldValue: true });
  // home.js's own click listener on the card runs first (registered earlier): a new mode switches behind the card; then this closes it
  const onClick = (e) => {
    if (!inPlay()) return;
    const b = e.target?.closest?.('.lk-pick[data-mode]');
    if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
    home.close();
  };
  root.addEventListener('click', onClick);
  // the keyboard's first stop in play: the lit mode (ENTER, home.js's first stop, is hidden here); Enter on it goes back to the game
  const goShown = () => { const g = root.querySelector('.lk-links .lk-go'); return !!g && g.getClientRects().length > 0; };   // the panel's Resume
  const focusLit = () => { if (inPlay() && (!root.contains(doc.activeElement) || doc.activeElement?.matches?.('.lk-row.lk-sum'))) (goShown() ? root.querySelector('.lk-links .lk-go') : root.querySelector('.lk-pick[aria-checked=true]'))?.focus({ preventScroll: true }); };
  // Leave race: the row in the links' grid, after Resume (CSS: its own full-width row first)
  let leave = null;
  if (race) {
    if (!doc.getElementById('lk-leave-css')) { const st = doc.createElement('style'); st.id = 'lk-leave-css'; st.textContent = LEAVE_CSS; doc.head.appendChild(st); }
    leave = doc.createElement('div'); leave.className = 'lk-leave';
    leave.innerHTML = `<button type="button" class="lk-leave-b">${LEAVE_WORD}</button><span class="lk-leave-q" role="group" aria-label="${LEAVE_ASK}" hidden><span class="t">${LEAVE_ASK}</span><button type="button" class="y">Yes</button><button type="button" class="n">No</button></span>`;
    const links = root.querySelector('.lk-links') ?? card;
    const g = links.querySelector(':scope > .lk-go');
    links.insertBefore(leave, g ? g.nextSibling : links.firstChild);
  }
  const lb = leave?.querySelector('.lk-leave-b'), lq = leave?.querySelector('.lk-leave-q');
  const askLeave = (on) => { if (!leave) return; lq.hidden = !on; lb.hidden = !!on; try { (on ? lq.querySelector('.y') : lb).focus({ preventScroll: true }); } catch { /* */ } };
  const goLeave = () => { askLeave(false); race.leave(); home.close(); };
  // the phone's card keeps its page links in the ⋯ list: there the row sits on the card itself (its CSS puts it over the modes)
  const place = () => { const phone = doc.documentElement?.dataset?.fPhoneCard === 'on', links = root.querySelector('.lk-links');
    if (phone && leave.parentNode !== card) card.appendChild(leave);
    else if (!phone && links && leave.parentNode !== links) { const g = links.querySelector(':scope > .lk-go'); links.insertBefore(leave, g ? g.nextSibling : links.firstChild); } };
  const refresh = () => { if (!leave) return false; place(); const r = race.now(); root.toggleAttribute('data-race', !!r); askLeave(false); return !!r; };
  if (leave) {
    lb.addEventListener('click', (e) => { e.stopPropagation(); const r = race.now(); if (!r) { refresh(); return; } if (r.live) askLeave(true); else goLeave(); });
    lq.querySelector('.y').addEventListener('click', (e) => { e.stopPropagation(); goLeave(); });
    lq.querySelector('.n').addEventListener('click', (e) => { e.stopPropagation(); askLeave(false); });
  }
  const escTaken = () => { if (!leave || lq.hidden) return false; askLeave(false); return true; };   // Esc answers No; the card stays
  return { x, focusLit, refresh, escTaken, leave, get asking() { return !!lq && !lq.hidden; }, dispose() { leave?.remove(); root.removeAttribute('data-race'); outFrom?.disconnect(); if (sampling) win.cancelAnimationFrame?.(sampling); root.removeEventListener('click', onClick); win.removeEventListener?.('lk-hand', onHand); win.removeEventListener?.('lakeshore:home', onLive); x.remove(); } };
}
