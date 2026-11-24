// Loading page: the game's hero (design).
// The markup and CSS are inline in index.html (the "lk-load" block), so the studio card (G1) paints before any bundle
// loads and the title runs its timing in CSS. This module takes over as soon as it arrives: the voyage (the loading
// bar: a small sloop sails the hairline, its wake the progress) driven by the real loading stages, the stage caption,
// the hand-off to the home card (the float plan, src/ui/home.js: Enter enters, and that gesture starts the sound), the no-WebGPU state, and
// the demo pins. One import (the URL flags, src/core/flags.js, itself import-free), no edits to main.js: main.js only calls
//
//   window.__veliaLoading?.stage('sky', 0.55);   // at 4–6 points (the table below); name + fraction so far
//   window.__veliaLoading?.ready();              // once the first live frame has rendered
//   window.__veliaLoading?.fail('nowebgpu');     // instead of ready, when the scene cannot be drawn
//
import { FLAGS } from '../sim/core/flags.js';
import { CURRENT_VESSEL } from '../sim/vessels/current.js';
import { installReel } from './attractReel.js';   // the film behind the loading: the mark, the osprey, the day, the storm, the rainbow
import { installStrip } from './attractStrip.js';   // the slim row that stands in for the card while the film plays
import { prefetchBytes } from '../prefetch.js';   // the boat's models ahead, handed to the assembly (perf/slow-loading)
import { CARDS } from '../modes/rows.js';   // the card looks (markMode; the registry's pure half)
import { reelLink } from './deferLoad.js';   // the link as measured: the desktop's film only on a fast one (perf/slow-loading)
// index.html loads this file as a module before main.js with data-auto on #lk-load; a page without data-auto (the demo)
// calls installLoading({ ... }) itself. With ?headless=1 or ?noload=1 the shell is display:none and every call is a no-op.

// the sailor's status line on the card (owner, 2026-10-30; replaced the lake's invitation): it names the real stage,
// so it moves with the bar: the wind and the water, then the boat's rigging, then the sails
const WIND = 'Checking the wind…', RIG = `Rigging ${CURRENT_VESSEL.name}…`, HOIST = 'Hoisting the main…';
export const READY_LINE = 'Ready to cast off.';
// the language picker (owner, 2026-10-30): English for now. P2 (Chinese): add 'zh' to LANGS here and in src/ui/settings.js,
// enable its <li> in src/ui/loading-shell.html, put the strings in a table keyed by lang and make setLang() swap them.
export const LANGS = ['en'];
export const STAGES = {   // name → [caption, fraction when the stage begins, the status line]; the line creeps toward the next stage between calls
  modules: ['loading', 0.0, WIND],
  gpu: ['waking the lake', 0.02, WIND],
  terrain: ['raising the ridges', 0.04, WIND],
  water: ['filling the lake', 0.12, WIND],
  trees: ['planting the pines', 0.26, RIG],
  shore: ['setting the shore', 0.42, RIG],
  sky: ['building the sky', 0.72, HOIST],
  boat: ['rigging the boat', 0.95, HOIST],
};   // the fractions follow a measured load: the sky (LUTs + shader compile) is the long one
const ORDER = Object.keys(STAGES);
const FAIL = {
  nowebgpu: null,   // the inline copy
  error: ['The lake did not load.', 'Reload the page; if it happens again, tell us which browser.'],
};
const MIN_CARD = 1.0;   // s from the first paint before the invitation may show (paint first: the card's stagger ends at ≈ 0.9 s; there is no studio beat any more)
const OUT = 1.6;        // s, the dissolve
export const FILM_READY_P = 0.95;   // ?filmui=1 only: the bar's value at ready(), history-free (ready() below)

// the mode the card speaks for: its coreOptions' card, one of the registry's CARDS (src/modes/registry.js; the html class
// the inline script set from ?mode=), else Sail's; the PLAN row's lit pick is src/ui/home.js
export function markMode(card, H = document.documentElement) {
  H.classList.remove(...CARDS.map((c) => `lk-m-${c}`));
  H.classList.add(`lk-m-${CARDS.includes(card) ? card : 'sail'}`);
}

export function installLoading({
  root = document.getElementById('lk-load'),
  minCard = MIN_CARD, gate = true, still = null, mode = null, onDone = null, reducedMotion = null, reel = null,   // reel: a test's own film api
  prefetch = true,   // false: no boat prefetch at the first stage (Velia v2: its boat models are its own packed files; v2/ui/loading.js)
  home =root?.hasAttribute('data-auto') ?? false,   // wait for src/ui/home.js (the float plan's logic) before the card goes live; the demo page has none
} = {}) {
  const stub = window.__veliaLoading ?? { t0: performance.now(), q: [] };
  const t0 = stub.t0 ?? performance.now();
  const H = document.documentElement;
  const off = !root || H.classList.contains('lk-nol');
  const log = [];   // [stage, fraction, ms since first paint]
  if (off) {   // headless captures, ?noload=1, or no shell on the page: every call is a no-op
    const noop = () => {};
    return (window.__veliaLoading = { live: true, off: true, t0, log, stage: noop, ready: noop, fail: noop, pin: noop, dispose: noop, setHome: noop, state: 'off', progress: 0 });
  }
  let homeApi = null;   // the home card's logic (src/ui/home.js createHome hands itself over: setHome)
  const api = { live: true, t0, log, stage, ready, fail, pin, dispose, setHome: (h) => { homeApi = h ?? null; }, enter: () => out(), say: (t) => line(t), pick: null, get state() { return root?.dataset.state; }, get progress() { return shown; }, reel: null, get soundWanted() { return !!api.reel?.soundWanted; } };
  window.__veliaLoading = api;

  const q = (s) => root.querySelector(s);
  const stageEl = q('.lk-stage'), img = q('.lk-still'), say = q('.lk-say'), psay = q('.lk-psay'), prog = q('.lk-prog');
  // the film and its controls (src/ui/attractReel.js): a page without the film's markup (the demo pins) gets none
  try { api.reel = reel ?? installReel({ root, link: reelLink }); } catch { api.reel = null; }   // link: the film waits for a measured fast link (perf/slow-loading)
  try { api.strip = installStrip({ root, reel: api.reel }); } catch { api.strip = null; }
  // the chart ends where the action row starts (V2): --lh is the row and the foot's height on the card, so the
  // sloop keeps its gap at every size; the CSS has a first-paint guess
  // The sloop (the course's end) then sits in the middle of the gap between the choices and the action row: the map is scaled by
  // the card's width, so moving its bottom moves the sloop by the same pixels. --sum-b: the summary line's bottom, where a phone's
  // EN sits (off the compass rose).
  {
    const card = q('.lk-card'), links = q('.lk-links'), plan = q('.lk-plan'), sum = q('.lk-sum'), sloop = q('.lk-sloop .b');
    const fitMap = () => {
      if (!card || !links || !card.clientHeight || root.dataset.pg) return;
      let lh = Math.max(0, card.clientHeight - links.offsetTop);
      card.style.setProperty('--lh', `${lh}px`);
      // the chart's words in the pause card are set in chart units: 15.5 screen px, whatever the card's size (the CSS reads --lk-u)
      const map = q('.lk-map'), vb = map?.viewBox?.baseVal;
      if (vb?.width) {
        const mr = map.getBoundingClientRect(), k = Math.max(mr.width / vb.width, mr.height / vb.height);   // the map's "slice" scale
        if (k > 0.05) card.style.setProperty('--lk-u', `${(15.5 / k).toFixed(1)}px`);
      }
      const cr = card.getBoundingClientRect();
      if (sum) { const sr = sum.getBoundingClientRect(); card.style.setProperty('--sum-b', `${Math.round(sr.bottom - cr.top)}px`); card.style.setProperty('--sum-c', `${Math.round((sr.top + sr.bottom) / 2 - cr.top)}px`); }
      if (plan && sloop) {
        // the sloop moves less than the map's bottom (the chart's "slice" scale grows with the box), so one correction undershoots:
        // measure and correct again until it sits mid-gap (3 passes at most; the phone card was 1 px out after one, 2026-11-07)
        for (let pass = 0; pass < 3; pass++) {
          // the pause card centres the whole course (island name, line, sloop) in the gap; the home card, the sloop alone
          const cgr = root.dataset.state === 'menu' ? q('.lk-course-g')?.getBoundingClientRect() : null;
          const s = cgr && cgr.height > 0 ? { top: cgr.top, height: cgr.height } : sloop.getBoundingClientRect(), pb = plan.getBoundingClientRect().bottom, lt = links.getBoundingClientRect().top;
          if (!(s.height > 0 && lt > pb)) break;
          const off = (s.top + s.height / 2) - (pb + lt) / 2;
          if (Math.abs(off) < 0.5) break;
          lh = Math.max(0, lh + off); card.style.setProperty('--lh', `${Math.round(lh)}px`);
        }
      }
    };
    fitMap();
    if (card && links && typeof ResizeObserver === 'function') { const ro = new ResizeObserver(() => fitMap()); ro.observe(card); ro.observe(links); }
    addEventListener('lakeshore:home', () => requestAnimationFrame(fitMap));
    api.fitMap = fitMap;
  }
  const rm = reducedMotion ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  void mode;

  // the hero frame is in the markup (preloaded, so it is in by the title); a caller may swap it
  if (img && still) img.src = still;
  if (img?.complete && img.naturalWidth) img.classList.add('on');
  const g1 = q('.lk-g1'); if (g1?.complete && g1.naturalWidth) g1.parentNode.classList.add('g1');

  // --- progress: shown → target (fast), target → creep goal (slow), never backwards -------------
  // --p on the card drives the voyage (the wake's length, the sloop's place, her heel and her sails); the CSS creep
  // that ran before this module is replaced by this one, from where it had got to
  const creep = parseFloat(getComputedStyle(root).getPropertyValue('--p')) || 0;
  let shown = creep, target = creep, goal = Math.max(0.06, creep), done = false, failed = false, readyAt = null, raf = 0, last = performance.now();
  root.style.animation = 'none';
  let pct = -1;
  const setP = (v) => { root.style.setProperty('--p', v.toFixed(4)); const n = Math.round(v * 100); if (n !== pct && prog) { pct = n; prog.setAttribute('aria-valuenow', String(n)); } };
  const step = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!rm) {
      target += (goal - target) * (1 - Math.exp(-dt / 9));      // the slow creep toward the next stage
      shown += (target - shown) * (1 - Math.exp(-dt / 0.35));   // the ease to the stage's own mark
    } else { shown = target = goal; }
    setP(shown);
    if (readyAt != null && !done && now - t0 >= minCard * 1000 && shown > 0.985 && (!gate || !home || homeApi)) handoff();
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);

  // the status line: fades out, swaps, fades in (the same pace as the caption)
  let sayTimer = 0, sayText = say?.textContent ?? '';
  function line(text) {
    if ((!say && !psay) || text === sayText) return;
    sayText = text; clearTimeout(sayTimer);
    say?.classList.add('off'); psay?.classList.add('off');
    sayTimer = setTimeout(() => { if (say) { say.textContent = text; say.classList.remove('off'); } if (psay) { psay.textContent = text; psay.classList.remove('off'); } }, rm ? 0 : 250);
  }

  // --- the language chip: a tiny list, English checked, Chinese disabled (soon) ------------------
  const lang = q('.lk-lang'), langBtn = q('.lk-langbtn'), langList = q('.lk-langlist');
  const opts = () => [...(langList?.querySelectorAll('[role=option]') ?? [])];
  const enabled = () => opts().filter((o) => o.getAttribute('aria-disabled') !== 'true');
  function setLang(code, { silent = false } = {}) {   // the hook for P2: today only 'en'
    if (!LANGS.includes(code)) return false;
    for (const o of opts()) o.setAttribute('aria-selected', String(o.dataset.lang === code));
    const cur = opts().find((o) => o.dataset.lang === code);
    const nm = q('.lk-langname'); if (nm && cur) nm.textContent = cur.dataset.lang.toUpperCase();   // the corner says the code (EN); the list says the name
    document.documentElement.lang = code;
    if (!silent) dispatchEvent(new CustomEvent('lakeshore:lang', { detail: { lang: code } }));   // src/shell.js saves it as settings.lang
    return true;
  }
  function openLang(focus = true) {
    if (!langList || !langList.hidden) return;
    langList.hidden = false; langBtn.setAttribute('aria-expanded', 'true');
    if (focus) (opts().find((o) => o.getAttribute('aria-selected') === 'true') ?? enabled()[0])?.focus();
  }
  function closeLang(back = false) {
    if (!langList || langList.hidden) return;
    langList.hidden = true; langBtn.setAttribute('aria-expanded', 'false');
    if (back) langBtn.focus();
  }
  if (langBtn && langList) {
    langBtn.addEventListener('click', () => (langList.hidden ? openLang() : closeLang()));
    langList.addEventListener('click', (e) => {
      const o = e.target.closest('[role=option]'); if (!o) return;
      if (o.getAttribute('aria-disabled') !== 'true') setLang(o.dataset.lang);
      if (o.getAttribute('aria-disabled') !== 'true') closeLang(true);
    });
    // keys: a capture listener on window, installed before src/ui/home.js's, so the card's arrow-walk and Esc never take the
    // list's keys; it only acts while focus is inside the chip
    addEventListener('keydown', (e) => {
      if (!e.target || e.target === globalThis || !lang.contains(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      const list = enabled(), i = list.indexOf(document.activeElement), onBtn = e.target === langBtn;
      const mine = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      if (e.key === 'Escape') { if (langList.hidden) return; mine(); closeLang(true); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { mine(); if (onBtn && langList.hidden) openLang(); else if (e.key === 'ArrowDown') list[Math.min(list.length - 1, i + 1)]?.focus(); else list[Math.max(0, i - 1)]?.focus(); }
      else if (!onBtn && (e.key === 'Enter' || e.key === ' ')) { mine(); document.activeElement.click(); }
      else if (e.key === 'Tab') closeLang();
      else if (onBtn && (e.key === 'Enter' || e.key === ' ')) e.stopImmediatePropagation();   // the button's own click opens it
    }, true);
    addEventListener('pointerdown', (e) => { if (!lang.contains(e.target)) closeLang(); });
  }
  api.setLang = setLang;

  let captionTimer = 0;
  function caption(text) {
    clearTimeout(captionTimer);
    if (stageEl.textContent === text && stageEl.classList.contains('on')) return;
    stageEl.classList.remove('on');
    captionTimer = setTimeout(() => { stageEl.textContent = text; stageEl.classList.add('on'); }, stageEl.textContent ? 450 : 0);
  }

  function stage(name, fraction) {
    if (prefetch) prefetchBoat();   // the game's modules are in: the boat's models may take the network now (below)
    if (done || failed) return;
    const t = Math.round(performance.now() - t0);
    const known = STAGES[name];
    const f = Math.max(target, Math.min(0.97, fraction ?? known?.[1] ?? target));
    const i = ORDER.indexOf(name);
    const next = i >= 0 && i + 1 < ORDER.length ? STAGES[ORDER[i + 1]][1] : Math.min(0.97, f + 0.12);
    target = f; goal = f + 0.7 * (next - f);
    log.push([name, +f.toFixed(3), t]);
    if (known?.[0]) caption(known[0]);
    if (known?.[2]) line(known[2]);
    api.reel?.stage(name);   // a phone's film starts at 'sky' (the downloads are in)
  }

  function ready() {
    if (done || failed || readyAt != null) return;
    readyAt = performance.now(); target = 1; goal = 1;
    // a film page (?filmui=1, capture only): the bar's last ease starts from a pinned point, so the dissolve (and the staged
    // first visit's clock behind it) lands on the same film frame every run. Before, it started from wherever the creep
    // had got to on the load's wall clock (≈ 0.95, 0.002 either side of a frame boundary): the first-visit golden's flake.
    if (FLAGS.filmui) shown = FILM_READY_P;
    log.push(['ready', 1, Math.round(readyAt - t0)]);
    caption('');
  }

  function handoff() {
    if (done) return;
    done = true;
    if (gate) {
      // the card goes live: the plan rows ink in and take clicks and keys, Enter appears, and it
      // waits unless a mode was tapped while loading (src/ui/home.js enters it then). Enter (src/ui/home.js calls enter()) is the gesture that also starts the sound
      // (src/audio.js listens for the same keydown / pointerdown on the window), so nothing here stops it.
      root.dataset.state = 'home';
      const qd = homeApi?.queued;   // a mode tapped while loading: the line says it is entering
      line(qd ? `Entering ${qd[0].toUpperCase()}${qd.slice(1)}…` : READY_LINE);
      for (const n of root.querySelectorAll('[inert]')) n.removeAttribute('inert');
      dispatchEvent(new CustomEvent('lakeshore:home'));
    } else out();
  }

  function out() {
    root.dataset.state = 'out';
    setTimeout(() => { root.dataset.state = 'gone'; cancelAnimationFrame(raf); api.reel?.gone(); onDone?.(); }, OUT * 1000 + 200);
  }

  function fail(reason = 'nowebgpu') {
    if (done) return;
    failed = true;
    const copy = reason in FAIL ? FAIL[reason] : FAIL.error;
    if (copy) { const p = q('.lk-fail'); p.innerHTML = ''; p.append(copy[0], document.createElement('br'), copy[1]); }
    root.dataset.state = 'fail';
    log.push(['fail:' + reason, shown, Math.round(performance.now() - t0)]);
  }

  // demo pins: company | title | progress (p=…) | ready | gate | out | fail
  function pin(state, { p = 0.6, stage: s = 'sky' } = {}) {
    cancelAnimationFrame(raf); clearTimeout(captionTimer); clearTimeout(sayTimer);
    root.dataset.pin = state;
    root.dataset.state = state === 'fail' ? 'fail' : state === 'gate' || state === 'home' ? 'home' : state === 'out' ? 'out' : 'company';
    if (state === 'gate' || state === 'home') for (const n of root.querySelectorAll('[inert]')) n.removeAttribute('inert');
    img?.classList.add('on');
    root.style.animation = 'none';
    const set = (v) => { shown = target = goal = v; setP(v); };
    const cap = (t) => { stageEl.textContent = t; stageEl.classList.toggle('on', !!t); };
    const sayNow = (t) => { sayText = t; if (say) { say.textContent = t; say.classList.remove('off'); } if (psay) { psay.textContent = t; psay.classList.remove('off'); } };
    sayNow(state === 'ready' || state === 'gate' || state === 'home' || state === 'out' ? READY_LINE : state === 'progress' ? (STAGES[s]?.[2] ?? WIND) : WIND);
    if (state === 'company') { set(0.0); cap(''); }
    if (state === 'title') { set(0.1); cap(STAGES.gpu[0]); }
    if (state === 'progress') { set(p); cap(STAGES[s]?.[0] ?? s); }
    if (state === 'ready' || state === 'gate' || state === 'home' || state === 'out') { set(1); cap(''); }
    if (state === 'fail') { set(0); fail('nowebgpu'); }
    done = state !== 'progress';
  }

  function dispose() { cancelAnimationFrame(raf); clearTimeout(captionTimer); clearTimeout(sayTimer); api.reel?.gone(); root.remove(); }

  // calls that arrived before this module did
  for (const c of stub.q ?? []) {
    if (c[0] === 'stage') stage(c[1], c[2]);
    else if (c[0] === 'ready') ready();
    else if (c[0] === 'fail') fail(c[1]);
  }
  return api;
}

// A phone or tablet (fix/ios-start-2): the boat's models (3 MB) download ahead, while the world is built and the shaders
// compile; the loader takes them from the HTTP cache when the boat is built (the 'mode' step, many seconds later).
// perf/phone-load: they start at the first loading stage ('gpu': the game's modules are in), no longer with the page:
// the module graph waits on the terrain grids (src/terrain.js's top-level await) and then on the bake's workers (their
// module chunks), and the 3 MB shared the phone's link with them (Fast 4G: the grids landed 2.4 s later). Starting them
// when the grids were in (before the workers' chunks) put the GPU's start 1.5 s later on Fast 4G, so: at 'gpu'.
// perf/slow-loading: every device now, the desktop too (it fetched the hull at the 'mode' step, then the rest:
// 100 s of the desktop's Slow 4G start, in series), and the bytes are handed to the assembly (src/prefetch.js), not
// fetched again. The models are the boat profile's.
export const BOAT_MODELS = Object.values(CURRENT_VESSEL.models);
let boatAsked = typeof document === 'undefined' || typeof fetch !== 'function' || FLAGS.headless === '1' || FLAGS.noload === '1';
function prefetchBoat() {
  if (boatAsked) return;
  boatAsked = true;
  for (const u of BOAT_MODELS) prefetchBytes(u);
}

if (typeof document !== 'undefined' && document.getElementById('lk-load')?.hasAttribute('data-auto')) {
  const flags = FLAGS;
  // The home card waits for Enter (owner, 2026-10-29). ?gate=0 goes straight in when ready. Automated
  // browsers (navigator.webdriver: the probes and tests that drive the live page) go straight in too, as they always
  // have, unless ?gate=1 asks for the card (tools/capture_loading.mjs --live does).
  // A page the GPU recovery reloaded (src/ui/gpuRecover.js RESUME_KEY, written within the last minute) goes straight back
  // into play: the player already pressed Enter (fix/first-load; the key is read here by name: this module imports only the flags)
  let resume = false;
  try { const at = parseFloat(sessionStorage.getItem('lakeshore.resume.v1') ?? ''); sessionStorage.removeItem('lakeshore.resume.v1'); resume = Number.isFinite(at) && Date.now() - at < 60e3; } catch { /* no storage */ }
  const gate = !resume && (flags.gate === '1' || (flags.gate !== '0' && !navigator.webdriver));
  installLoading({ gate: gate && flags.menu });   // ?menu=0 leaves the shell out, so no home card either
}
