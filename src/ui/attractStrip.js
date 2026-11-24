// The strip (owner, 2026-11-07: "the card is too big and blocks the film"): while the film plays behind a live card, the
// full card stays away and a slim glass row stands in: the Cruise · Sail · Regatta switch, a bright ENTER and Menu, which
// opens the full card. The card also opens on Skip and when there is no film to watch (the stills). When the film ends
// (it plays once: owner, 2026-11-07) the picture cross-fades into the live lake and the strip stays, over the lake. The
// card keeps every function and its own logic (src/ui/home.js): the strip only delegates to it, and marks it inert while
// it is away, so a screen reader meets one float plan at a time.
//
//   const strip = installStrip({ root, reel })      src/ui/loading.js, once the film is installed
//   strip.decide()      at ready: the strip if the film is running, else the card
//   strip.openCard()    Menu: the card slides in and takes focus
//   strip.showing       true while the strip stands in

export function installStrip({ root, reel = null, doc = globalThis.document, win = globalThis, focusDelay = (f) => setTimeout(f, 60) } = {}) {
  const strip = root?.querySelector('.lk-strip');
  if (!root || !strip) return null;
  const q = (s) => root.querySelector(s);
  const card = q('.lk-card');
  let showing = false, byMenu = false;   // byMenu: the visitor asked for the card; a film that starts later leaves it alone

  const atHome = () => root.dataset.state === 'home';
  const filmRunning = () => !!reel && reel.mode === 'video' && (reel.playing || reel.ended);   // a film that ran out holds its last frame, then the live lake: still the strip

  function paint() {   // the strip's cells mirror the card's picks (the card's logic owns the choice)
    for (const b of strip.querySelectorAll('.lk-sp')) {
      const pick = q(`.lk-pick[data-mode="${b.dataset.mode}"]`);
      b.setAttribute('aria-checked', pick?.getAttribute('aria-checked') === 'true' ? 'true' : 'false');
    }
  }
  function show() {
    if (showing) return;
    showing = true;
    root.dataset.strip = 'on';
    strip.hidden = false;
    card?.setAttribute('inert', '');
    paint();
    focusDelay(() => { if (showing) strip.querySelector('.lk-sgo')?.focus?.({ preventScroll: true }); });
  }
  function openCard(fromMenu = false) {
    if (fromMenu) byMenu = true;
    if (!showing) return;
    showing = false;
    delete root.dataset.strip;
    card?.removeAttribute('inert');
    strip.hidden = true;
    focusDelay(() => { if (!showing && atHome()) q('.lk-go')?.focus?.({ preventScroll: true }); });
  }
  // at ready: the strip only when the film is running; a late first frame (a slow link) brings it in then
  function decide() {
    if (!atHome()) return;
    if (filmRunning() && !byMenu) show(); else openCard();
  }
  win.addEventListener?.('lakeshore:home', () => decide());

  // the film's turns: the stills (a skip, an error, no film) and a skip once the card is up (the live lake at once) open the card;
  // the film's own end keeps what is up; the film played again brings the strip back
  reel?.on?.((kind, why) => {
    if (!atHome()) return;
    if (kind === 'stills' || (kind === 'live' && why === 'skip')) openCard();
    else if (kind === 'playing' && !byMenu) show();   // the first moving frame after ready (a slow link): the strip
    else if (kind === 'play') { byMenu = false; show(); }   // "Reel" again: the visitor wants the film
  });

  // the strip's controls delegate to the card's own
  strip.addEventListener('click', (e) => {
    const t = e.target.closest?.('button'); if (!t) return;
    e.stopPropagation();
    if (t.classList.contains('lk-sp')) { q(`.lk-pick[data-mode="${t.dataset.mode}"]`)?.click(); paint(); }
    else if (t.classList.contains('lk-sgo')) q('.lk-go')?.click();
    else if (t.classList.contains('lk-smenu')) openCard(true);
  });
  // the card's picks change from the card too (a key, a page): keep the cells true
  try {
    const mo = new win.MutationObserver(() => paint());
    for (const p of root.querySelectorAll('.lk-pick')) mo.observe(p, { attributes: true, attributeFilter: ['aria-checked'] });
  } catch { /* no observer */ }

  return { decide, show, openCard, paint, get showing() { return showing; } };
}
