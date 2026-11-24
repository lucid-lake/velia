// K3, the game end (owner 2026-11-17: "when it happens, just like any RPG game, game end shows, the user sees the
// menu card and can start again"). A calm logbook page, not a red GAME OVER: a navy card, cream ink, the
// title, one line of what happened (from the sim), one tip, the session's line in the log (time, distance, top speed), and
// Start again (the same mode, the same weather) beside Menu. One card for every way a sail can end: `cause` picks the words
// ('knockdown' today; Tessie's revenge reuses it with 'tessie': "Tessie said no.").
//   endCardModel({ cause, event, log, hour })   pure: { cause, title, kicker, line, tip, log }
//   knockdownLine(e), knockdownTip(e), logLine(log, hour)   pure: the words
//   const card = createEndCard({ onAgain, onMenu });  card.show(model); card.hide(); card.isOpen
// Pure parts: v2/tests/end-card.test.mjs; the DOM: v2/tests/pages/knockdown.page.mjs.
const NM = 1852, KN = 1852 / 3600;

const END_TITLES = Object.freeze({ knockdown: 'Knocked down', tessie: 'Tessie said no.' });

// where the wind was: the true wind's angle off the bow (deg, signed)
export function windWords(twaDeg) {
  const a = Math.abs(twaDeg ?? 90);
  return a < 50 ? 'close-hauled' : a < 75 ? 'forward of the beam' : a < 110 ? 'on the beam' : a < 150 ? 'on the quarter' : 'from astern';
}
export const reefWords = (r) => (r >= 2 ? 'two reefs in' : r >= 1 ? 'one reef in' : 'full sail');
// the sheets: in when the boom was within 30° of the centreline and the main drawing
const sheetsIn = (e) => (e?.boomDeg ?? 0) <= 30 && (e?.mainFill ?? 1) > 0.5;

// "A 31 kn gust on the beam, full sail, sheets in"
export function knockdownLine(e = {}) {
  const kn = Math.round(Math.max(e.gustKn ?? 0, e.twsKn ?? 0));
  return `A ${kn} kn gust ${windWords(e.twaDeg)}, ${reefWords(e.reef ?? 0)}, ${sheetsIn(e) ? 'sheets in' : 'sheets eased'}`;
}
// one tip: reef first; reefed on a reach the answer is to ease, not luff (owner 2026-11-17); else ease in the gusts
export function knockdownTip(e = {}) {
  const a = Math.abs(e.twaDeg ?? 90);
  if (!(e.reef >= 1)) return 'Reef early, or ease the main in the gusts.';
  if (a >= 60 && a <= 120) return 'On a reach, ease the sheets in a gust. Don\'t luff.';
  return 'Ease the main in the gusts, and reef early.';
}
// the session's line in the log: "14:12 · 17 min · 2.4 nm · top 7.8 kn"
export function logLine(log = {}, hour = null) {
  const parts = [];
  if (Number.isFinite(hour)) { const tm = ((Math.floor(hour * 60 + 1e-6) % 1440) + 1440) % 1440; parts.push(`${String(Math.floor(tm / 60)).padStart(2, '0')}:${String(tm % 60).padStart(2, '0')}`); }
  const min = Math.max(0, Math.round((log.seconds ?? 0) / 60));
  parts.push(min < 1 ? 'under a minute' : `${min} min`);
  parts.push(`${((log.metres ?? 0) / NM).toFixed(1)} nm`);
  parts.push(`top ${((log.topMs ?? 0) / KN).toFixed(1)} kn`);
  return parts.join(' · ');
}

export function endCardModel({ cause = 'knockdown', event = {}, log = {}, hour = null, line = null, tip = null } = {}) {
  const k = cause === 'tessie' ? 'tessie' : 'knockdown';
  return {
    cause: k, title: END_TITLES[k], kicker: 'Logbook',
    line: line ?? (k === 'knockdown' ? knockdownLine(event) : 'She rolled you over.'),
    tip: tip ?? (k === 'knockdown' ? knockdownTip(event) : 'Give her room.'),
    log: logLine(log, hour),
  };
}

const CSS = `
#lk-end{position:fixed;z-index:30;right:max(4vw,calc(env(safe-area-inset-right,0px) + 16px));top:50%;transform:translateY(calc(-50% + var(--lk-rise,6px)));opacity:0;
  width:min(400px,44vw);box-sizing:border-box;padding:18px 20px 16px;color:rgb(var(--lk-cream));font-family:var(--lk-ui);text-align:left;
  background:linear-gradient(180deg,rgb(var(--lk-brand-navy) / .9),rgb(var(--lk-brand-navy) / .8));-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);
  border:var(--lk-line,1px) solid var(--lk-glass-edge);border-radius:var(--lk-glass-r,14px);box-shadow:var(--lk-glass-shadow);
  transition:opacity .6s var(--lk-ease),transform .6s var(--lk-ease);pointer-events:none}
#lk-end[data-on]{opacity:1;transform:translateY(-50%);pointer-events:auto}
#lk-end[hidden]{display:none}
#lk-end .k{font-size:var(--lk-fs-caption);letter-spacing:var(--lk-track-caps,.12em);text-transform:uppercase;color:rgb(var(--lk-cream) / .8)}
#lk-end h2{margin:2px 0 8px;font-family:var(--lk-font);font-weight:500;font-size:var(--lk-fs-title);line-height:1.1;color:rgb(var(--lk-cream))}
#lk-end .ln{font-size:var(--lk-fs-body);line-height:1.35;margin:0 0 8px}
#lk-end .tp{font-size:var(--lk-fs-caption);line-height:1.35;margin:0 0 10px;padding:6px 10px;border-left:2px solid rgb(var(--lk-cream) / .55);background:rgb(var(--lk-cream) / .07)}
#lk-end .lg{font-size:var(--lk-fs-caption);font-variant-numeric:tabular-nums;color:rgb(var(--lk-cream) / .85);padding-top:8px;border-top:1px solid rgb(var(--lk-cream) / .25)}
#lk-end .bt{display:flex;gap:8px;margin-top:14px}
#lk-end .bt button{font:inherit;font-size:var(--lk-fs-caption);min-height:44px;padding:0 16px;flex:1;border-radius:var(--lk-radius);cursor:pointer;text-shadow:none;color:rgb(var(--lk-cream));background:transparent;border:1px solid rgb(var(--lk-cream) / .5)}
#lk-end .bt .again{border-color:rgb(var(--lk-cream) / .9);background:rgb(var(--lk-cream) / .1);font-weight:600}
#lk-end .bt button:hover,#lk-end .bt button:focus-visible{background:rgb(var(--lk-cream) / .18);outline:none}
:root[data-screen~=tight] #lk-end{width:min(340px,40vw);right:max(2vw,calc(env(safe-area-inset-right,0px) + 12px));padding:12px 14px 12px;top:calc(50% + 18px)}
:root[data-screen~=tight] #lk-end h2{margin-bottom:4px}
:root[data-screen~=tight] #lk-end .bt{margin-top:10px}
@media (prefers-reduced-motion: reduce){#lk-end{transition:opacity .3s linear;transform:translateY(-50%)}}
`;

export function createEndCard({ onAgain = () => {}, onMenu = () => {}, doc = globalThis.document } = {}) {
  if (!doc.getElementById('lk-end-css')) { const s = doc.createElement('style'); s.id = 'lk-end-css'; s.textContent = CSS; doc.head.appendChild(s); }
  const el = doc.createElement('section');
  el.id = 'lk-end'; el.hidden = true; el.setAttribute('role', 'dialog'); el.setAttribute('aria-labelledby', 'lk-end-t');
  el.innerHTML = '<div class="k"></div><h2 id="lk-end-t"></h2><p class="ln"></p><p class="tp"></p><div class="lg"></div><div class="bt"><button type="button" class="again">Start again</button><button type="button" class="menu">Menu</button></div>';
  doc.body.appendChild(el);
  const q = (c) => el.querySelector(c);
  let open = false, model = null, armedAt = 0;
  const now = () => globalThis.performance?.now?.() ?? Date.now();
  const armed = () => now() - armedAt > 600;   // a tap still landing from the helm never starts again by itself
  const act = (btn) => { if (!armed()) return; if (btn === q('.again')) onAgain(model); else if (btn === q('.menu')) onMenu(model); };
  q('.again').addEventListener('click', (e) => { e.stopPropagation(); act(e.currentTarget); });
  q('.menu').addEventListener('click', (e) => { e.stopPropagation(); act(e.currentTarget); });
  const card = {
    el,
    get isOpen() { return open; }, get model() { return model; },
    // a press on the card while the menu card is up: the menu card's outside-press closer (src/ui/cardClose.js) would eat it; the
    // page's earlier window listener (main.js) asks here first: true when the press is the card's (its click acts on a button)
    press(e) { if (!open || !el.contains(e.target)) return false; if (e.type === 'click') act(e.target.closest?.('button')); return true; },
    show(m) {
      model = m; open = true; armedAt = now();
      q('.k').textContent = m.kicker ?? 'Logbook'; q('h2').textContent = m.title; q('.ln').textContent = m.line; q('.tp').textContent = m.tip; q('.lg').textContent = m.log;
      el.dataset.cause = m.cause; el.hidden = false;
      requestAnimationFrame(() => requestAnimationFrame(() => { if (open) el.dataset.on = ''; }));
      setTimeout(() => { if (open) try { q('.again').focus({ preventScroll: true }); } catch { /* */ } }, 650);
    },
    hide() { if (!open) return; open = false; delete el.dataset.on; setTimeout(() => { if (!open) el.hidden = true; }, 600); },
    dispose() { el.remove(); },
  };
  return card;
}
