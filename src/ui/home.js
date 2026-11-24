// The home card: the chart card is the menu, a float plan: WATERS, VESSEL, PLAN (a tap on a mode enters it), Enter, and
// a lower row of pages. This module is its logic. The card itself (#lk-load) and its first-paint style live in
// index.html (written by tools/loading_shell.py from src/ui/loading-shell.html); the pages are in src/ui/homePages.js.
//
//   state of #lk-load:  company (loading: Waters and Boat are inert; a mode tap queues) → home (live; Enter) → out → gone
//                       gone → menu (Esc or the mark, in play: the same card over the live blurred world; Resume) → gone
//                       home → attract (45 s untouched: the card slides aside, the world plays Cruise) → home
//   const home = createHome({ current, onMode, go, can, settings, wind, weather, keysHtml, scene, onOpen, onClose });
//   home.open(); home.close(); home.toggle(); home.setMode(id); home.show('settings'); home.dispose();
//   home.feedbackMailto()    // the form's mailto as it stands (the probe and the tests read it)
//
// While the card is up it holds the keyboard: arrows move between the rows (spatial), Tab walks them, Enter chooses,
// Esc goes back a page, then Resume. Every key stops here (typing in the form never steers the boat), and the world sees
// a blur first so no key stays held. It knows nothing of the modes: the shell (src/shell.js) passes what each row does.
import { relabelCaps } from './keyLabels.js';
import { createPlan } from './planState.js';
import { track } from '../metrics.js';
import { MODE_LABELS } from '../modeNames.js';
import { pickNames as pickRows } from '../modes/rows.js';   // the picks' names (the registry's pure half: no mode code)
import { ensureTokens, TOKENS } from './tokens.js';
import { CONTACT, FEEDBACK, feedbackMailto, techLines } from './feedback.js';
import { supportSource } from './support.js';
import { sharedTips } from './tips.js';
import { WATERS, WATERS_SOON, chosenWaters, watersById } from '../sim/waters/index.js';
import { VESSELS, VESSELS_SOON, chosenVessel, vesselById } from '../sim/vessels/index.js';
import { pagesHtml, PAGES_CSS, ICONS, HELP, dm } from './homePages.js';
import { closeOnOutside } from './cardClose.js';
import { createScrollFade, scrollKey, applyScroll } from './helpScroll.js';   // What's new and Credits: one page that scrolls
import { createIdle, attractSettings } from './attract.js';
import { createEnter } from './planEnter.js';
import { applyProfile, resetWelcome, planFor, needsStep2, PROFILES } from './profile.js';
import { escIsBrowsers } from './fullscreen.js';   // the first Esc in full screen is the browser's
import { FLAGS } from '../sim/core/flags.js';
import { featureSettings } from '../features/setup.js';   // the features' Setup rows (their pure half: no feature code)
import { uniqueFaces } from './fontFaces.js';   // one @font-face per family and style (no duplicate font fetches)

export { ICONS };
// the boat on the card's summary line: "Halcyon · 28 ft" (tools/loading_shell.py boat_line writes the same at first paint)
export const boatLine = (v) => { const m = /^([\d.]+)-ft/.exec(v?.short ?? ''); return m ? `${v.name} · ${m[1]} ft` : (v?.name ?? ''); };
export const MODES = pickRows().map(({ id, label }) => ({ id, label }));   // the card's picks (src/modes/registry.js)

const MARK_CSS = `
/* the mark: top-left, on the glass plate (design v2); the home card's own corner (the chart owns the top-right) */
button.lk-menu-mark{position:fixed;left:var(--lk-mx);top:var(--lk-my);z-index:var(--lk-z-hud);transition:opacity var(--lk-out) var(--lk-ease-out),color .2s}   /* a small round button: the top of the left column (tokens.css .lk-rd) */
.lk-menu-mark svg{vector-effect:non-scaling-stroke}
.lk-menu-mark[data-hidden]{opacity:0;pointer-events:none}
`;

const FOCUSABLE = 'button:not([disabled]):not([aria-disabled=true]), a[href], input:not([type=hidden]), textarea, summary';   // summary: a What's new release's date
// the Help sheet (Solaria stage 2): its sections, and the sub-page under Contact. A phone shows the nav as a screen of its own
// ('help'); a wider screen shows it beside the section, so there 'help' opens the first section.
const HELP_IDS = new Set([...HELP.map(([k]) => k), 'feedback', 'help']);
const PHONE_MQ = '(max-width:640px),(max-aspect-ratio:4/5)';   // the pages' own phone rule (homePages.js PAGES_CSS)
export const isPhone = () => !!globalThis.matchMedia?.(PHONE_MQ)?.matches;

export function createHome({ root = document.getElementById('lk-load'), body = document.body, current = 'sail', onMode = () => {}, go = {}, can = {},
  settings = null, sail = () => null, wind = null, weather = null, keysHtml = () => '', scene = () => null, onOpen = null, onClose = null, onWaters = null, onVessel = null, onProfile = null, exportSession = null, quality = null, hud = null,
  metric = track,   // the play counts' track() (src/metrics.js); a test passes its own to read support_click
  staged = false,   // the staged first visit (src/ui/firstVisit.js): the card never shows; the loading screen dissolves straight into Sail
  news = null,   // the app's What's new (src/ui/news.js newsMeta): v2 passes v2/ui/news.js V2_NEWS; none is v1's list
  pickToEnter = false,   // v2 (owner, 2026-11-15: "I need the enter mode gone"): the first card has no ENTER and no lit mode; only a tap (or a tabbed-to mode's own Enter or Space) enters, a loading-time tap still queues and lights its mode; in play the running mode stays lit
  deskEnter = () => false,   // v2 desktop (owner, 2026-11-17: "the Sail button is highlighted, and pressing Enter enters Sail"): with pickToEnter, true on a keyboard hand: the first card lights a mode (Sail first; arrows and Tab move it) and Enter or Space starts it. A phone or tablet (false): no lit mode, no Enter start. Still no ENTER button
  escFirst = () => false,   // true: a page over the game takes Esc first (the shell: the logbook, the pinned chart, the raised binoculars)
  voyage = null,   // v2: the card's voyage line as { waters, vessel, place }: "Emerald Bay · Halcyon 28 ft · Tessie's water ›"; none: v1's "Emerald Bay · Lake Tahoe · Halcyon · 28 ft"
  inside = () => false,   // v2: true for a target that belongs to the card though it is not in it (the live map behind the panel): a press there does not close the menu
  mapKeys = () => false,   // v2: true when the key is for the live map behind the panel (its host has the focus): the keys reach it (Tab walks its points, Enter opens one, arrows pan, + and − zoom)
  menuEsc = () => false,   // v2: true when the live map took Esc first (it closed its own card); the menu stays
  feedbackFrom = 'contact',   // the page Send feedback sits under (its nav row lit, Esc's way back): v1's Contact; v2 folds Contact into About (v2/ui/aboutPage.js)
  modeSelects = () => false,   // v2's panel on the live map (owner, 2026-11-18: "bring back the ENTER / RESUME button"): true while the card is the desktop or tablet panel: a mode press selects it (Sail first, else the mode last entered), the card's go button starts it; in play the go button is Resume
  remembered = () => null,   // with modeSelects: the mode the player last entered (settings lastMode), lit first on the entrance unless ?mode= names one
  goWord = 'ENTER',   // the go button's word on the first card (in play it reads Resume)
  canEnter = () => true,   // v2 phones (owner, 2026-11-17: "build the shaders, then present"): false while the modes are not ready; a tap on the live card then queues as a loading-time tap does, and released() enters it
  welcome = true,   // false (v2; owner, 2026-11-21: "remove the skill question"): no first-visit welcome and no "show the welcome again"; the profile is set in Setup only
  attract = attractSettings(FLAGS, globalThis.navigator?.webdriver) } = {}) {
  if (!root) throw new Error('home: no #lk-load card on this page');
  ensureTokens();
  if (!document.getElementById('lk-home-css')) { const st = document.createElement('style'); st.id = 'lk-home-css'; st.textContent = uniqueFaces(PAGES_CSS + MARK_CSS); document.head.appendChild(st); }
  const H = document.documentElement;
  const P = createPlan(current);
  const urlMode = FLAGS.mode;   // an explicit ?mode= is the player's own choice: the welcome keeps it
  const rated = {};   // the feedback's quick rows (1–5 each, any skipped)
  let snap = null;   // the technical details as the Details tab shows them: the mail sends this same snapshot
  let view = 'home', step1 = null, reopened = false, copied = 0, quiet = false, wChosen = chosenWaters(FLAGS, settings?.get('waters')), vChosen = chosenVessel(FLAGS, settings?.get('vessel'));
  const q = (s) => root.querySelector(s), qa = (s) => [...root.querySelectorAll(s)];
  if (H.classList.contains('lk-nol')) root.dataset.state = 'gone';   // ?noload / ?headless: there is no card to show, but Esc may still bring it

  // ---- build: the pages, inside the card ----
  const card = q('.lk-card');
  const pgs = document.createElement('div'); pgs.className = 'lk-pg';
  const markSvg = q('.lk-by .lk-mk')?.outerHTML.replace(/lk-mp\b/g, 'lk-mp2') ?? '';
  pgs.innerHTML = pagesHtml({ waters: WATERS, vessels: VESSELS, wChosen, vChosen, wSoon: WATERS_SOON, vSoon: VESSELS_SOON, mark: markSvg, playtest: !!exportSession, features: featureSettings(FLAGS), news });   // the features' Setup rows (src/features/index.js)
  card.appendChild(pgs);
  const fade = createScrollFade(pgs);   // the scrolling pages' bottom fade while more is below
  const mark = document.createElement('button'); mark.className = 'lk-menu-mark lk-rd sm'; mark.setAttribute('aria-label', 'Menu (Esc)'); mark.type = 'button';
  mark.innerHTML = `<span class="glass"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS.mark}</svg></span>`;
  body.appendChild(mark);
  const tips = sharedTips(); tips.add(mark, { side: 'down' });   // "Menu · Esc" on a hover or a long-press (tips.js), not a browser title
  root.setAttribute('aria-label', 'Velia');

  let hl = null;   // the desktop's highlighted mode on the first card (null: the plan's default)
  const pickable = (m) => { const b = m && q(`.lk-pick[data-mode="${m}"]`); return !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true'; };
  const selected = () => hl ?? (!urlMode && pickable(remembered?.()) ? remembered() : null) ?? P.plan;   // modeSelects: the mode the go button starts
  // ---- paint: the state shown ----
  function paint() {
    const w = watersById(wChosen), v = vesselById(vChosen);
    const vy = voyage?.(w, v);
    q('[data-v=waters]').textContent = vy?.waters ?? `${w.place} · ${w.region}`;
    q('[data-v=vessel]').textContent = vy?.vessel ?? boatLine(v);   // the name, then what it is, short: "Halcyon · 28 ft" (the card's one summary line, V2)
    { const pl = q('[data-v=place]'); if (pl) { pl.textContent = vy?.place ?? ''; pl.hidden = !vy?.place; if (pl.previousElementSibling) pl.previousElementSibling.hidden = !vy?.place; } }   // v2's birthplace word and its dot (ui/birthplaceCard.js adds them)
    const first = state() === 'home' || state() === 'company';
    const lit = first && modeSelects() ? (E.mode ?? selected()) : pickToEnter && first ? (E.mode ?? (state() === 'home' && deskEnter() ? hl ?? P.plan : null)) : P.plan;   // pickToEnter: no default on the first card, only a queued tap
    for (const b of qa('.lk-pick, .lk-sp')) b.setAttribute('aria-checked', String(b.dataset.mode === lit));   // the card's picks and the film's strip
    if (E.mode) root.dataset.queued = E.mode; else delete root.dataset.queued;
    for (const t of qa('.tile[data-waters]')) t.setAttribute('aria-checked', String(t.dataset.waters === wChosen));
    for (const t of qa('.tile[data-vessel]')) t.setAttribute('aria-checked', String(t.dataset.vessel === vChosen));
    q('.lk-plabel b').textContent = `${w.place} · ${w.region}`; q('.lk-plabel span').textContent = `${dm(w.lat, 'N', 'S')} ${dm(w.lon, 'E', 'W')}`;
    for (const b of qa('.lk-link[data-go=logbook],.lk-link[data-go=chart]')) {
      const ok = can[b.dataset.go]?.() ?? true;
      b.setAttribute('aria-disabled', String(!ok)); b.title = ok ? '' : 'in Sail'; b.style.fontStyle = ok ? '' : 'italic';
    }
    if (settings) for (const b of qa('.opt[data-t]')) b.setAttribute('aria-checked', String(!!settings.get(b.dataset.t)));
    const wv = wind?.get?.(), wOk = can.wind?.() ?? !!wind;
    for (const b of qa('.opt[data-r^="wind:"]')) { b.setAttribute('aria-checked', String(+b.dataset.r.slice(5) === wv)); b.disabled = !wOk; }
    { const wx = weather?.get?.(); for (const b of qa('.opt[data-r^="weather:"]')) { b.setAttribute('aria-checked', String(b.dataset.r.slice(8) === wx)); b.disabled = !weather || wx == null; } }   // wow/storm
    const tOk = can.assists?.() ?? true;
    for (const b of qa('.opt[data-t=pilot],.opt[data-t=crewTrim],.opt[data-t=hints]')) b.disabled = !tOk;
    const sc = sail();
    for (const b of qa('.opt[data-r^="pro:"]')) { b.setAttribute('aria-checked', String((b.dataset.r.slice(4) === 'pro') === !!sc?.pro)); b.disabled = !tOk; }
    if (settings) for (const b of qa('.opt[data-r^="autoReef:"]')) { b.setAttribute('aria-checked', String((b.dataset.r.slice(9) === 'on') === settings.get('autoReef'))); b.disabled = !tOk; }
    if (settings) for (const b of qa('.opt[data-r^="crewTrim:"]')) { b.setAttribute('aria-checked', String((b.dataset.r.slice(9) === 'on') === settings.get('crewTrim'))); b.disabled = !tOk; }
    if (settings) for (const b of qa('.opt[data-r^="shoal:"]')) b.setAttribute('aria-checked', String((b.dataset.r.slice(6) === 'on') === settings.get('shoalAssist')));
    if (settings) for (const b of qa('.opt[data-r^="voice:"]')) b.setAttribute('aria-checked', String((b.dataset.r.slice(6) === 'on') === settings.get('skipperVoice')));
    if (settings) for (const b of qa('.opt[data-r^="kayakCam:"]')) b.setAttribute('aria-checked', String((b.dataset.r.slice(9) === 'on') === settings.get('kayakCam')));
    if (settings) for (const b of qa('.opt[data-r^="steady:"]')) b.setAttribute('aria-checked', String((b.dataset.r.slice(7) === 'on') === settings.get('steadyHorizon')));
    if (settings) for (const b of qa('.opt[data-r^="profile:"]')) b.setAttribute('aria-checked', String(settings.get('welcomed') && b.dataset.r.slice(8) === settings.get('profile')));
    if (settings) for (const b of qa('.opt[data-r^="words:"]')) b.setAttribute('aria-checked', String(b.dataset.r.slice(6) === settings.get('words')));
    if (settings) for (const b of qa('.opt[data-r^="windLines:"]')) b.setAttribute('aria-checked', String(b.dataset.r.slice(10) === settings.get('windLines')));
    if (settings) for (const b of qa('.opt[data-r^="display:"]')) b.setAttribute('aria-checked', String(b.dataset.r.slice(8) === settings.get('display')));
    for (const b of qa('.opt[data-r^="hud:"]')) b.setAttribute('aria-checked', String(b.dataset.r.slice(4) === (hud?.get?.() ?? settings?.get('hud'))));   // the HUD in force (auto: the mode's default)
    if (settings) { const qs = settings.get('quality'), card = qs === 'balanced' ? 'low' : qs;   // a Balanced pin (?quality=balanced) shows on Battery
      for (const b of qa('[data-r^="quality:"]')) b.setAttribute('aria-checked', String(b.dataset.r.slice(8) === card)); }
    if (settings) for (const b of qa('.opt[data-r^="lang:"]')) b.setAttribute('aria-checked', String(b.dataset.r.slice(5) === settings.get('lang')));
    if (settings) for (const b of qa('.opt[data-r^="keyHints:"]')) b.setAttribute('aria-checked', String((b.dataset.r.slice(9) === 'on') === settings.get('keyHints')));
    if (settings) for (const b of qa('.opt[data-r^="edgeInst:"]')) b.setAttribute('aria-checked', String(b.dataset.r.slice(9) === settings.get('edgeInstruments')));
    if (settings) for (const b of qa('.opt[data-r^="tips:"]')) b.setAttribute('aria-checked', String((b.dataset.r.slice(5) === 'on') === settings.get('tips')));
    for (const b of qa('.opt[data-r^="rate:"]')) { const [, k, n] = b.dataset.r.split(':'); b.setAttribute('aria-checked', String(rated[k] === +n)); }
    const qn = q('[data-qnow]'); if (qn) { const a = (quality?.active?.() ?? '').replace(/^auto: /, ''); qn.textContent = a ? `Now: ${a}` : ''; }
    const go1 = q('.lk-go .pq'); if (go1) go1.textContent = state() === 'menu' ? 'Resume' : goWord;
    const gb = q('.lk-go'); if (gb) { gb.title = state() === 'menu' ? 'or press Esc' : 'enter the mode picked'; if (modeSelects()) gb.setAttribute('aria-label', state() === 'menu' ? 'Resume (Esc)' : `${goWord}: ${MODE_LABELS[selected()] ?? selected()}`); else gb.removeAttribute('aria-label'); }
  }
  const state = () => root.dataset.state;
  const live = () => ['home', 'menu', 'attract'].includes(state());

  // ---- pages ----
  function show(v, focus = true) {
    if (v === 'help' && !isPhone()) v = HELP[0][0];   // a wide screen: the nav stands beside the first section
    view = v;
    const onHome = v === 'home';
    if (onHome) delete root.dataset.pg; else root.dataset.pg = v;
    if (HELP_IDS.has(v)) root.dataset.help = ''; else delete root.dataset.help;
    const navOn = v === 'feedback' ? feedbackFrom : v;   // Send feedback sits under Contact (v2: About)
    for (const b of qa('.hn')) { if (b.dataset.nav === navOn) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    for (const n of qa('.pg')) n.classList.toggle('on', n.dataset.page === v), n.hidden = n.dataset.page !== v;
    if (v === 'keys') { q('.keys').innerHTML = keysHtml(); relabelCaps(q('.keys')); }
    if (v === 'feedback') paintTech();
    pgs.scrollTop = 0; for (const b of qa('.pg-b')) b.scrollTop = 0;   // a page opens at its top (its body scrolls: one card height, owner 2026-11-06)
    if (v === 'news') qa('.pg[data-page=news] details.rel').forEach((d, i) => (i ? d.removeAttribute('open') : d.setAttribute('open', '')));   // the newest release open, the older folded
    fade.update(); requestAnimationFrame(() => fade.update());
    paint();
    if (onHome && state() === 'home') idle.arm(); else idle.disarm();
    if (focus) setTimeout(() => focusFirst(), 40);
  }
  function focusFirst() {
    let el;
    if (view === 'home') el = q('.lk-go:not([hidden])') && visible(q('.lk-go')) ? q('.lk-go') : (state() === 'menu' && q('.lk-pick[aria-checked=true]:not([disabled])')) || (pickToEnter ? (deskEnter() ? q('.lk-pick[aria-checked=true]:not([disabled])') : null) : q('.lk-row'));   // no ENTER (v2's card): in play the lit mode; the first card holds no focus (Tab or an arrow starts the keyboard), never a default
    else if (view === 'help') el = q('.hn');
    else el = q(`.pg.on .choice[aria-checked=true]`) ?? q(`.pg.on .tile[aria-checked=true]`) ?? q(`.pg.on textarea`) ?? q(`.pg.on [role=tab][aria-selected=true]`) ?? q(`.pg.on .row2, .pg.on .opt:not([disabled]), .pg.on .pbtn`) ?? q('.pg.on.scr summary') ?? q('.pg.on .pg-back');
    el?.focus({ preventScroll: true });
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !el.closest('[inert]'); };
  const scopeEls = () => qa(FOCUSABLE).filter((el) => {
    if (!visible(el)) return false;
    if (view === 'home') return !el.closest('.lk-pg');
    return !!el.closest('.pg.on') || !!el.closest('.hnav');   // the Help nav is a column of the sheet (hidden, it is not visible)
  });
  // arrows move by rows, as a menu does: Up and Down to the next row (the checked choice of a group, else the nearest
  // in x), Left and Right along the row. A row is the focusables that share a line.
  function move(dir) {
    const els = scopeEls(); if (!els.length) return;
    let cur = els.includes(document.activeElement) ? document.activeElement : null;
    if (!cur && pickToEnter && deskEnter() && view === 'home' && state() === 'home') cur = els.find((el) => el.matches?.(`.lk-pick[data-mode="${hl ?? P.plan}"]`)) ?? null;   // desktop: the first arrow moves from the lit mode
    if (!cur) { els[0].focus(); return; }
    const items = els.map((el) => { const r = el.getBoundingClientRect(); return { el, cx: r.left + r.width / 2, cy: r.top + r.height / 2, h: r.height }; }).sort((a, b) => a.cy - b.cy || a.cx - b.cx);
    const rows = [];
    for (const it of items) { const last = rows[rows.length - 1]; if (last && it.cy - last.cy <= 0.6 * Math.min(it.h, last.h)) last.items.push(it); else rows.push({ cy: it.cy, h: it.h, items: [it] }); }
    const ri = rows.findIndex((r) => r.items.some((i) => i.el === cur)), row = rows[ri];
    const me = row.items.find((i) => i.el === cur);
    row.items.sort((a, b) => a.cx - b.cx);
    let to = null;
    if (dir === 'ArrowLeft' || dir === 'ArrowRight') {
      const k = row.items.indexOf(me) + (dir === 'ArrowRight' ? 1 : -1);
      to = row.items[k]?.el;
    } else {
      const nr = rows[ri + (dir === 'ArrowDown' ? 1 : -1)];
      if (nr) to = (nr.items.find((i) => i.el.getAttribute('aria-checked') === 'true') ?? nr.items.reduce((a, b) => (Math.abs(a.cx - me.cx) <= Math.abs(b.cx - me.cx) ? a : b))).el;
    }
    to?.focus({ preventScroll: false });
  }

  // ---- tabs (Settings, Keys): a page's second section instead of a scroll; a click, Enter or Space picks one ----
  function pickTab(t) {
    const list = t.closest('[role=tablist]'), pg = t.closest('.pg'); if (!list || !pg) return;
    for (const b of list.querySelectorAll('[role=tab]')) {
      const on = b === t; b.setAttribute('aria-selected', String(on));
      const panel = pg.querySelector(`#${b.getAttribute('aria-controls')}`); if (panel) panel.hidden = !on;
    }
  }

  // ---- open / close in play ----
  let closing = 0;
  function open() {
    if (state() === 'menu' && root.hasAttribute('data-off')) {   // opened again while it was closing: it stays
      clearTimeout(closing); root.removeAttribute('data-off'); root.dataset.on = ''; mark.dataset.hidden = ''; show('home', false); setTimeout(() => focusFirst(), 60); return;
    }
    if (state() !== 'gone') return;
    dispatchEvent(new Event('blur'));   // the world lets go of any held key (the controls, the hints, the chart clear on blur)
    clearTimeout(closing);
    for (const n of qa('[inert]')) n.removeAttribute('inert');   // a page that never showed the loading card (?noload=1) still has them
    root.removeAttribute('data-off'); root.removeAttribute('data-on'); root.dataset.state = 'menu'; root.style.opacity = '1'; root.style.transition = 'none';
    mark.dataset.hidden = '';
    P.reset(); show('home', false);
    requestAnimationFrame(() => requestAnimationFrame(() => { root.dataset.on = ''; }));
    onOpen?.();
    setTimeout(() => { if (state() === 'menu') focusFirst(); }, 80);
  }
  function close() {
    if (state() !== 'menu' || root.hasAttribute('data-off')) return;
    root.removeAttribute('data-on'); root.dataset.off = '';
    if (root.contains(document.activeElement)) document.activeElement.blur();
    delete mark.dataset.hidden; delete root.dataset.pg; idle.disarm();
    closing = setTimeout(() => { if (state() === 'menu') { root.dataset.state = 'gone'; root.removeAttribute('data-off'); root.style.opacity = ''; root.style.transition = ''; } }, 480);
    onClose?.();
  }
  const toggle = () => (state() === 'menu' ? close() : open());

  // ---- the attract: after 45 s untouched on the home card, the card slides aside and the world plays Cruise ----
  const idle = createIdle({
    idleS: attract.idleS,
    onAway: async () => {
      root.dataset.state = 'attract'; paint();
      if (P.running !== 'cruise') { quiet = true; try { await onMode('cruise'); } finally { quiet = false; } }
    },
    onBack: async () => {
      root.dataset.state = 'home'; paint(); focusFirst();
      if (P.toStart()) { quiet = true; try { await onMode(P.plan); } finally { quiet = false; } }
    },
  });
  let tickAt = performance.now();
  const timer = attract.on ? setInterval(() => { const n = performance.now(); if (canEnter()) idle.tick((n - tickAt) / 1000); tickAt = n; }, 500) : 0;   // the attract plays Cruise: not before the modes are ready
  const watch = () => { idle.poke(); };
  for (const t of ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel']) addEventListener(t, watch, { passive: true, capture: true });
  const wakeUp = (e) => { if (state() === 'attract') { e.stopPropagation(); e.preventDefault?.(); idle.wake(); return true; } return false; };
  addEventListener('lakeshore:home', () => { if (attract.on) { tickAt = performance.now(); } show('home'); });

  // ---- keys: a capture listener on window runs before the game's; while the card is up every key stops here ----
  const typing = (e) => e.target?.matches?.('textarea, input:not([type=checkbox])');
  const onKey = (e) => {
    let st = state();
    if (st === 'menu' && root.hasAttribute('data-off')) st = 'gone';   // closing: Esc opens it again
    if (e.code === 'Escape' || e.key === 'Escape') {
      if (escIsBrowsers()) return;   // full screen: the first Esc is the browser's (fullscreen.js)
      if (st === 'attract') { if (e.type === 'keydown') wakeUp(e); e.stopImmediatePropagation(); return; }
      if (st === 'home' || st === 'menu') {
        e.stopImmediatePropagation();
        if (e.type !== 'keydown' || e.repeat) return;
        e.preventDefault();
        if (view === 'welcome' || view === 'welcome2') { skipWelcome(); return; }
        if (view !== 'home') { show(prevOf(view)); return; }
        if (menuEsc()) return;
        if (st === 'menu') close();
        return;
      }
      if (e.type !== 'keydown' || e.repeat || st !== 'gone') return;
      if (escFirst()) return;   // their Esc first: the logbook, the pinned chart, the raised binoculars
      e.stopImmediatePropagation(); open(); return;
    }
    if (!live()) return;
    if (st === 'attract') { if (e.type === 'keydown' && !e.metaKey && !e.ctrlKey) wakeUp(e); e.stopImmediatePropagation(); return; }
    if (mapKeys(e)) return;
    e.stopImmediatePropagation();   // typing in the form never reaches the boat
    if (e.type !== 'keydown' || e.metaKey || e.ctrlKey || e.altKey) return;
    const scr = !typing(e) && view !== 'home' && q('.pg.on.scr > .pg-b');   // What's new, Credits: the keys scroll the page's body (helpScroll.js)
    if (scr) {
      const a = document.activeElement;
      const d = scrollKey(e.code, { inNav: !!a?.closest?.('.hnav'), onSummary: !!a?.matches?.('summary'), shift: e.shiftKey, page: scr.clientHeight });
      if (d) { e.preventDefault(); if (applyScroll(scr, d) || !e.code.startsWith('Arrow')) return; }   // at its end an arrow walks the focus as before
    }
    if (pickToEnter && st === 'home' && view === 'home' && (deskEnter() || modeSelects()) && (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') && !typing(e)) {
      const a = document.activeElement;
      if (modeSelects() && e.code !== 'Space' && a?.matches?.('.lk-pick[data-mode]') && root.contains(a)) {   // the panel: Space on a mode selects it (its click), Enter on it selects and starts it
        e.preventDefault();
        if (!e.repeat && !a.disabled && a.getAttribute('aria-disabled') !== 'true') { hl = a.dataset.mode; E.pick(hl); paint(); }
        return;
      }
      if (!(a && a !== document.body && root.contains(a) && a.matches?.('button, a[href], summary'))) {   // focus on a button: its own Enter or Space is the click; else the lit mode starts
        e.preventDefault();
        const m = modeSelects() ? selected() : hl ?? P.plan; const b = q(`.lk-pick[data-mode="${m}"]`);
        if (!e.repeat && b && !b.disabled && b.getAttribute('aria-disabled') !== 'true') E.pick(m);
        return;
      }
    }
    if (e.code.startsWith('Arrow') && !typing(e)) { e.preventDefault(); move(e.code); }
  };
  // the lit mode follows the focus (arrows, Tab) on the desktop's first card
  root.addEventListener('focusin', (e) => { const b = e.target?.closest?.('.lk-pick[data-mode]'); if (b && pickToEnter && deskEnter() && !modeSelects() && state() === 'home' && !b.disabled) { hl = b.dataset.mode; paint(); } });   // the panel (modeSelects): a press selects, never the focus
  // Esc steps back: Send feedback to Contact (feedbackFrom); a Help section to the nav on a phone (the card on a wider screen); the nav to the card
  const prevOf = (v) => (v === 'feedback' ? feedbackFrom : v !== 'help' && HELP_IDS.has(v) && isPhone() ? 'help' : 'home');
  addEventListener('keydown', onKey, true); addEventListener('keyup', onKey, true);
  // pointers inside the card stop here too (Cruise takes the helm on a drag; the hints count drags)
  const stop = (e) => e.stopPropagation();
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'wheel', 'click']) { root.addEventListener(t, stop); mark.addEventListener(t, stop); }
  root.addEventListener('pointerdown', (e) => { if (state() === 'attract') { e.preventDefault(); idle.wake(); } }, true);
  mark.addEventListener('click', () => open());
  // In play the card sits over a corner of the live world (owner, 2026-10-30: no full-screen veil). A press outside it
  // closes the menu, as the veil's click did, and is not passed on to the game (a click on the water would steer).
  const offOutside = closeOnOutside({ isOpen: () => state() === 'menu' && !root.hasAttribute('data-off'), inside: (t) => card.contains(t) || mark.contains(t) || inside(t), close });   // cardClose.js: the logbook closes the same way

  // ---- clicks ----
  // A tap on Cruise, Sail or Regatta enters it (fix/card-enter). While the world loads the pick is lit and waits: the card
  // enters the moment it goes live, except on a first visit, where the welcome comes first and the pick is dropped.
  const E = createEnter({
    ready: () => state() === 'home' && canEnter(),
    enter: (m) => { P.pick(m); if (modeSelects()) settings?.set?.('lastMode', m); enterPlay(); dispatchEvent(new Event('lakeshore:entered')); },
    queued: (m) => { P.pick(m); window.__veliaLoading?.say?.(`${MODE_LABELS[m] ?? m} picked. Entering when she is ready…`); },
    dropped: () => { P.reset(); },
  });
  const enterPlay = () => { if (state() === 'home') { track('set_sail', { mode: P.plan });   // the event name is kept for the stats; it fires on entering any mode   // once a page load: the card goes and does not come back as 'home'
       if (P.toStart()) onMode(P.plan);   // Enter starts the plan on the card
       window.__veliaLoading?.enter?.(); idle.disarm(); return true; } if (state() === 'menu') { close(); return true; } return false; };
  root.addEventListener('click', (e) => {
    if (state() === 'attract') return;
    const src = supportSource(e.target);
    if (src) { metric('support_click', { source: src }); return; }   // a plain link: the browser opens the studio's Ko-fi page in a new tab
    const t = e.target.closest('button, a'); if (!t) return;
    if (t.getAttribute('role') === 'tab') { pickTab(t); return; }
    if (t.classList.contains('lk-go')) {
      if (modeSelects()) { if (state() === 'menu') close(); else if (state() === 'home' || state() === 'company') { E.pick(selected()); paint(); } return; }   // the panel's go button: the selected mode (queued while loading); Resume in play
      if (!pickToEnter) enterPlay(); return;
    }   // pickToEnter: no ENTER path at all (v2 removes the button)
    if (t.dataset.w) { choose(t.dataset.w); return; }
    if (t.dataset.act === 'welcome-again' && settings && welcome) { resetWelcome(settings); reopened = true; step1 = null; show('welcome'); return; }
    if (t.dataset.r?.startsWith('profile:') && settings) { const id = t.dataset.r.slice(8); applyProfile(settings, id); onProfile?.(id); paint(); return; }
    if (t.dataset.mode && !t.disabled) {
      if ((state() === 'home' || state() === 'company') && modeSelects()) { hl = t.dataset.mode; if (E.mode) E.pick(hl); paint(); return; }   // the panel: a press selects (a queued pick follows it); the go button starts it
      if (state() === 'home' || state() === 'company') { E.pick(t.dataset.mode); paint(); return; }   // a tap enters that mode, or queues it while the world loads
      if (t.dataset.mode !== P.plan) { P.pick(t.dataset.mode); if (modeSelects()) settings?.set?.('lastMode', P.plan); paint(); onMode(P.plan); }   // paused mid-play: the plan switches behind the card; Resume closes it
      return;
    }
    const g = t.dataset.go;
    if (g === 'logbook' || g === 'chart') {
      if (t.getAttribute('aria-disabled') === 'true') return;
      const wasHome = state() === 'home'; enterPlay(); setTimeout(() => go[g]?.(), wasHome ? 700 : 60); return;
    }
    if (g && t.classList.contains('hn')) { show(g, false); t.focus({ preventScroll: true }); return; }   // a nav row: the section beside it, the focus stays in the nav
    if (g) return show(g);
    if (t.dataset.waters && !t.disabled) { pickWaters(t.dataset.waters); return; }
    if (t.dataset.vessel && !t.disabled) { pickVessel(t.dataset.vessel); return; }
    if (t.dataset.t && settings) { settings.set(t.dataset.t, !settings.get(t.dataset.t)); paint(); return; }
    if (t.dataset.r?.startsWith('weather:')) { weather?.set?.(t.dataset.r.slice(8)); setTimeout(paint, 30); return; }   // clear | fair | storm: the top bar's Weather, the same state
    if (t.dataset.r?.startsWith('wind:')) { wind?.set?.(+t.dataset.r.slice(5)); setTimeout(paint, 30); return; }
    if (t.dataset.r?.startsWith('pro:')) { sail()?.setPro?.(t.dataset.r.slice(4) === 'pro'); paint(); return; }
    if (t.dataset.r?.startsWith('autoReef:') && settings) { settings.set('autoReef', t.dataset.r.slice(9) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('crewTrim:') && settings) { settings.set('crewTrim', t.dataset.r.slice(9) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('shoal:') && settings) { settings.set('shoalAssist', t.dataset.r.slice(6) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('voice:') && settings) { settings.set('skipperVoice', t.dataset.r.slice(6) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('kayakCam:') && settings) { settings.set('kayakCam', t.dataset.r.slice(9) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('steady:') && settings) { settings.set('steadyHorizon', t.dataset.r.slice(7) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('words:') && settings) { settings.set('words', t.dataset.r.slice(6)); paint(); return; }
    if (t.dataset.r?.startsWith('windLines:') && settings) { settings.set('windLines', t.dataset.r.slice(10)); paint(); return; }
    if (t.dataset.r?.startsWith('display:') && settings) { settings.set('display', t.dataset.r.slice(8)); paint(); return; }
    if (t.dataset.r?.startsWith('hud:') && settings) { settings.set('hud', t.dataset.r.slice(4)); paint(); return; }
    if (t.dataset.r === 'quality:auto') { if (quality?.reset) quality.reset(); else settings?.set('quality', 'auto'); paint(); return; }   // Auto also clears the governor's step-downs (was "reset auto")
    if (t.dataset.r?.startsWith('quality:') && settings) { settings.set('quality', t.dataset.r.slice(8)); paint(); return; }
    if (t.dataset.r === 'lang:en' && settings) { settings.set('lang', 'en'); paint(); return; }
    if (t.dataset.r?.startsWith('keyHints:') && settings) { settings.set('keyHints', t.dataset.r.slice(9) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('edgeInst:') && settings) { settings.set('edgeInstruments', t.dataset.r.slice(9)); paint(); return; }
    if (t.dataset.r?.startsWith('tips:') && settings) { settings.set('tips', t.dataset.r.slice(5) === 'on'); paint(); return; }
    if (t.dataset.r?.startsWith('rate:')) { const [, k, n] = t.dataset.r.split(':'); if (rated[k] === +n) delete rated[k]; else rated[k] = +n; paint(); return; }   // a second press on the same number clears the row
    if (t.dataset.act === 'export-session') { e.preventDefault(); exportSession?.(); return; }
    if (t.dataset.act === 'copy') { e.preventDefault(); copy(); return; }
    if (t.dataset.act === 'send') { t.href = mailto(); return; }   // the browser follows the mailto: the player's own mail app
  });
  // ---- the first-visit welcome: step 1 "How do you sail?", step 2 (New only) Cruise or Sail ----
  const wParam = FLAGS.welcome;   // ?welcome=1 asks again (captures), ?welcome=0 never
  const welcomeDue = () => welcome && !!settings && wParam !== '0' && (wParam === '1' ? !welcomeShown : !settings.get('welcomed')) && !H.classList.contains('lk-nol');
  let welcomeShown = false;
  let stagedIn = false;
  function maybeWelcome() {
    // the staged first visit: the moment the card would go live it enters the plan instead (the same entry as Enter, in
    // the same task as the hand-off, so the card is never painted live); no welcome, no picker
    if (staged && !stagedIn && state() === 'home') { stagedIn = true; if (!E.flush(false)) { enterPlay(); dispatchEvent(new Event('lakeshore:entered')); } return; }
    if (state() === 'home' && E.mode && canEnter()) { E.flush(welcomeDue()); paint(); }   // a mode tapped while loading enters now, unless the welcome is due (a phone still building: at released())
    if (welcomeDue() && state() === 'home' && view === 'home') { welcomeShown = true; show('welcome'); }
  }
  function finishWelcome(mode) {
    reopened = false; step1 = null; show('home');
    if (mode && mode !== P.plan) { P.pick(mode); paint(); onMode(P.plan); }
  }
  function choose(key) {
    const [k, v] = key.split(':');
    if (k === 'profile' && PROFILES.includes(v)) {
      step1 = applyProfile(settings, v); onProfile?.(step1);
      if (needsStep2(step1, urlMode)) show('welcome2'); else finishWelcome(planFor(step1, null, urlMode));
    } else if (k === 'start') finishWelcome(planFor(step1 ?? settings.get('profile'), v, urlMode));
  }
  // Esc: step 1 takes the defaults (New, Sail); step 2 takes Sail; a welcome re-opened from Settings keeps the old profile
  function skipWelcome() {
    if (reopened) { settings.set('welcomed', true); finishWelcome(null); return; }
    if (view === 'welcome') { step1 = applyProfile(settings, 'new'); onProfile?.(step1); }
    finishWelcome(planFor(step1 ?? 'new', 'sail', urlMode));
  }
  const watchState = typeof MutationObserver === 'function' ? new MutationObserver(maybeWelcome) : null;
  watchState?.observe(root, { attributes: true, attributeFilter: ['data-state'] });

  // a choice saves in this browser and rides in the URL next to ?mode=; another lake or boat reloads the world (one of each today)
  function pickWaters(id) {
    const changed = id !== wChosen; wChosen = id; settings?.set('waters', id); paint(); show('home');
    if (changed) onWaters?.(id);
  }
  function pickVessel(id) {
    const changed = id !== vChosen; vChosen = id; settings?.set('vessel', id); paint(); show('home');
    if (changed) onVessel?.(id);
  }
  async function copy() {
    const b = q('[data-act=copy]');
    try { await navigator.clipboard.writeText(CONTACT); } catch {
      const r = document.createRange(); r.selectNodeContents(q('.addr .mail')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      try { document.execCommand('copy'); } catch { /* selected: the player can copy it */ }
    }
    b.textContent = 'copied'; b.classList.add('done'); clearTimeout(copied);
    copied = setTimeout(() => { b.textContent = 'copy'; b.classList.remove('done'); }, 1800);
  }
  // the feedback form: the five quick rows (1–5, each may be skipped), and the technical details shown exactly as the mail carries them
  const techOn = () => !!q('input[name=scene]')?.checked;
  function paintTech() {
    const pre = q('[data-fbtech]'); if (!pre) return;
    const on = techOn();
    snap = scene() ?? {};
    pre.textContent = on ? techLines(snap).join('\n') : 'Nothing technical is sent.';
    pre.classList.toggle('off', !on);
  }
  root.addEventListener('change', (e) => { if (e.target?.name === 'scene') paintTech(); });
  function mailto() {
    return feedbackMailto({ text: q('#lk-fb-text').value, email: q('#lk-fb-mail').value, scene: techOn() ? (snap ?? scene() ?? {}) : null, ratings: { ...rated } });
  }

    function setMode(m) { P.landed(m, quiet); paint(); }
  // canEnter turned true (the modes are ready): a mode tapped while waiting enters now (unless the first-visit welcome is due)
  function released() { if (state() === 'home' && E.mode && canEnter()) E.flush(welcomeDue()); paint(); }
  function dispose() {
    removeEventListener('keydown', onKey, true); removeEventListener('keyup', onKey, true); clearInterval(timer);
    offOutside();
    for (const t of ['pointermove', 'pointerdown', 'keydown', 'touchstart', 'wheel']) removeEventListener(t, watch, { capture: true });
    watchState?.disconnect(); fade.dispose(); pgs.remove(); tips.forget(mark); mark.remove();
  }
  function showMark(on) { if (on && state() === 'gone') delete mark.dataset.hidden; else mark.dataset.hidden = ''; }
  paint();
  mark.dataset.hidden = '';
  maybeWelcome();
  const api = { open, close, toggle, setMode, released, show, paint, dispose, showMark, el: root, mark, idle, feedbackMailto: mailto, feedbackEndpoint: FEEDBACK.endpoint,
    get isOpen() { return state() === 'menu' && !root.hasAttribute('data-off'); }, get state() { return state(); }, get mode() { return P.plan; }, get queued() { return E.mode; }, get view() { return view; }, get waters() { return wChosen; }, get vessel() { return vChosen; } };
  window.__veliaLoading?.setHome?.(api);   // the loading card goes live once the home logic is here (src/ui/loading.js)
  return api;
}
