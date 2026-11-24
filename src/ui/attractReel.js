// The attract loading's reel (owner, 2026-11-06/07: attention through the whole wait,
// and never a slower game). Behind the loading overlay a film of our own renders plays from the first seconds: the
// Lucid Lake mark thinning onto the July 4th finale over the boat, then the osprey, the kayaks, the storm, the rainbow,
// golden hour, the Milky Way, the clear water, and the live game's own opening pose (owner, 2026-11-09). The card arrives at
// ready. While the world still loads, the film loops (owner, 2026-11-09: "not a freeze on the last frame"): 1 s before its
// end a second copy starts from the fireworks and dissolves in over it (REEL.loopS). Once the world is ready the film plays
// to its end (owner, 2026-11-07: no loop behind the card) and the picture cross-fades into the live lake behind the card
// (or the strip). A clear Skip (the button, Esc, a tap on the footage)
// stops the film on a calm still with the loading line, then the same cross-fade at ready (at once if the card is up),
// and the choice is remembered per visitor.
// A true first visit (src/ui/firstVisit.js: no card, the loading dissolves straight into the staged first minute) sees the
// same film in the same order (owner, 2026-11-09: first visits see the reel; this replaced the 2026-11-07 rule that cut to
// the opening pose after the fireworks so no live beat was spoilt). At ready the staged visit enters and the loading screen
// dissolves into the live lake over 1.2 s (the shell's #lk-load[data-first][data-state=out]), wherever the film is.
//
//   decideReel({ flags, reduced, saveData, effectiveType, canPlay, stored, coarse })   → { mode, startAt, why }  (pure)
//   captionAt(t)                                                                       → the shot under the clock, or null
//   installReel({ root, decision, ... })                                               → the DOM half (src/ui/loading.js calls it)
//
// The bytes rule (measured): the reel never shares the link with the game's own downloads. A desktop
// starts it as soon as this module runs (the game's modules are in; a local link is not the limit there); a phone waits
// for the 'sky' stage (the downloads are in, the shaders compile). Save-Data, reduced motion, a slow link, no H.264, or a
// remembered skip: no video at all, the stills breathe instead (the measured cost: none).
import { profileFor } from '../core/profile.js';
import { FLAGS } from '../sim/core/flags.js';
import { decideFirstVisit, SETTINGS_KEY } from './firstVisit.js';

export const REEL = Object.freeze({
  desktop: '/reel/reel-1080.mp4', phone: '/reel/reel-720p.mp4',   // landscape 1920x1080 and portrait 720x1280, 35.4 s (2026-11-09: tools/reel/build.sh; sizes)
  logoS: 1.7,       // the mark holds fully this long (owner, 2026-11-07), and until the film's first frame moves
  logoFadeS: 1.7,   // then thins over the running picture, eased in and out (owner); never over black or a frozen frame
  logoMaxS: 5,      // a clip that still has no frame by then: the mark thins onto the slow-drifting still of the same shot; the film fades in over it later, when it plays
  liveS: 1.2,       // the film's end: the picture cross-fades into the live lake (CSS: #lk-load[data-reel-end=live]; the camera differs, so 1.2 s, not the 0.6 s scene fade)
  durS: 35.4,       // the film's length (the files' own; the element's duration wins once it is known)
  loopS: 1.0,       // still loading near the end: a second copy from 0 (the fireworks) dissolves in over the last second (the reel's own 1 s dissolves; owner, 2026-11-09)
  loopPrepS: 2.0,   // ...made and buffered this long before the dissolve, so it moves at once
  playAt: 1.0,      // a desktop's film is fetched at once but starts moving 1 s in, so the mark's thinning (1.7 s on: 0.7-2.4 s film time) reveals the first big burst blooming (from 1.9 s)
});
export const STORE_KEY = 'lakeshore.reel.v1';   // 'skip' when the visitor skipped the film; cleared when they play it again
export const STILLS = Object.freeze(['golden', 'fireworks', 'clear', 'night', 'open']);   // brand/stills/reel-<n>-{960,1280,1920}.webp (our renders at 1080p from the shot files); the first is the shell's first paint: golden hour off Fannette (the osprey's sky read empty as a still at every size, 2026-11-07, so it is not in the set)
const STILL_S = 9;   // each still breathes this long (the Ken Burns cycle in the shell's CSS: 45 s for five)
export const stillSrc = (n, w = 1920) => `/brand/stills/reel-${n}-${w}.webp`;
const stillSrcset = (n) => [960, 1280, 1920].map((w) => `${stillSrc(n, w)} ${w}w`).join(', ');

// the shots of the cut (the mp4 files under public/reel/; tools/reel/build.sh): seconds in the file, and the
// place caption (MSFS style): the place, then the scene's facts (src/place.js's hour, the shot's wind level). Owner, 2026-11-09:
// the fireworks first, then the osprey and the kayaks' close call, the storm and the rainbow moved up, the clear water near
// the end; the dawn and the surf retired.
export const SHOTS = Object.freeze([
  { id: 'fireworks', in: 0, out: 7.0, place: 'July 4th', facts: '10:02 pm · the finale' },   // tools/fireworks/close_film.mjs, show 274.2-281.2 s (22:02 on the show's clock)
  { id: 'hover', in: 6.0, out: 10.0, place: 'An osprey', facts: 'the bay head · 12:30 pm' },   // tools/birds_director.js hover (the long lens: the bird reads big)
  { id: 'kayak', in: 9.0, out: 13.4, place: 'The lake is busy', facts: '9:00 am · a close call' },   // the owner's trim of the kayaks' close call
  { id: 'storm', in: 12.4, out: 16.4, place: 'The west ridge', facts: '6:15 pm · a storm builds' },
  { id: 'rainbow', in: 15.4, out: 19.9, place: 'The clearing', facts: '6:35 pm · the rainbow' },
  { id: 'golden', in: 18.9, out: 21.9, place: 'Fannette Island', facts: '6:24 pm · wind 10 kn' },
  { id: 'night', in: 20.9, out: 26.9, place: 'The mouth of the bay', facts: '10:30 pm · the Milky Way' },   // tools/film/shots/attract-night.json
  { id: 'clear', in: 25.9, out: 29.4, place: 'The bay head', facts: '12:30 pm · depth 3 m' },   // tools/film/shots/wow-clarity.json
  { id: 'open', in: 28.4, out: 35.4, place: 'Emerald Bay', facts: '6:45 pm · wind 15 kn' },
]);
const CAP_IN = 1.1, CAP_OUT = 1.0;   // a caption shows once the 1 s dissolve has settled and leaves before the next one starts

export function captionAt(t, shots = SHOTS) {
  for (const s of shots) if (t >= s.in + CAP_IN && t < s.out - CAP_OUT) return s;
  return null;
}

// what to show, from the visitor's facts; every input is plain so the tests cover each rule
export function decideReel({
  flags = FLAGS, reduced = false, saveData = false, effectiveType = '4g', canPlay = true, stored = null, coarse = false, webdriver = false,
} = {}) {
  const f = flags.reel;
  if (f === '0') return { mode: 'stills', startAt: null, why: 'flag' };
  if (f !== '1') {
    if (webdriver) return { mode: 'stills', startAt: null, why: 'automated' };   // the goldens and the probes: a still frame, never a film's clock
    if (!canPlay) return { mode: 'stills', startAt: null, why: 'codec' };
    if (saveData) return { mode: 'stills', startAt: null, why: 'save-data' };
    if (reduced) return { mode: 'stills', startAt: null, why: 'reduced-motion' };
    if (/^(slow-2g|2g|3g)$/.test(String(effectiveType))) return { mode: 'stills', startAt: null, why: 'slow-link' };
    if (stored === 'skip') return { mode: 'stills', startAt: null, why: 'skipped' };
  }
  return { mode: 'video', startAt: coarse ? 'sky' : 'now', why: f === '1' ? 'flag' : 'ok' };
}

// the visitor's choice, kept in localStorage (a browser without storage keeps nothing and never throws)
export function readSkip(storage = globalThis.localStorage) {
  try { return storage?.getItem(STORE_KEY) === 'skip' ? 'skip' : null; } catch { return null; }
}
export function rememberSkip(on, storage = globalThis.localStorage) {
  try { if (on) storage?.setItem(STORE_KEY, 'skip'); else storage?.removeItem(STORE_KEY); return true; } catch { return false; }
}

// the facts a browser gives, read once (each guarded: a test or an old browser may lack any of them)
function browserFacts(win = globalThis) {
  const nav = win.navigator ?? {}, mm = (q) => { try { return !!win.matchMedia?.(q)?.matches; } catch { return false; } };
  let canPlay = true;
  try { canPlay = !!win.document?.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'); } catch { canPlay = false; }
  const prof = profileFor(win);
  return {
    reduced: mm('(prefers-reduced-motion: reduce)'),
    saveData: !!nav.connection?.saveData,
    effectiveType: nav.connection?.effectiveType ?? '4g',
    canPlay,
    coarse: prof.input === 'touch',   // the device profile (src/core/profile.js)
    webdriver: !!nav.webdriver,
    phone: prof.tokens.some((t) => t === 'narrow' || t === 'upright' || t === 'low'),   // the profile's screen tokens (LIMITS: 640 wide, 4/5 upright, 520 low)
  };
}

// ---- the DOM half ------------------------------------------------------------------------------------------------
// installReel({ root: #lk-load, decision, facts, storage, doc, win, now }) → api
//   api.stage(name)   loading.js's stages: a phone's film starts at 'sky'
//   api.skip()        stop the film: the still, the loading line; remembered
//   api.play()        the film again (the remembered skip is cleared)
//   api.sound()       the ♪ chip: asks the world for sound (the event lakeshore:sound; the click itself is the browser's gesture)
//   api.gone()        the shell is gone: release the decoder
export function installReel({
  root, decision = null, facts = null, storage = globalThis.localStorage, doc = globalThis.document, win = globalThis,
  now = () => performance.now(), clock = (f, ms) => setTimeout(f, ms), unclock = (id) => clearTimeout(id), first = null,   // first: a test's own first-visit decision
  link = null,   // () → 'fast' | 'mid' | 'slow' | null (unknown yet): the link as measured (src/ui/deferLoad.js reelLink; the loading screen passes it)
} = {}) {
  if (!root) return null;
  const F = facts ?? browserFacts(win);
  const stored = readSkip(storage);
  const D = decision ?? decideReel({ flags: FLAGS, ...F, stored });
  const FV = first ?? (() => { let st = null; try { st = storage?.getItem(SETTINGS_KEY) ?? null; } catch { /* no storage */ } return decideFirstVisit({ flags: FLAGS, stored: st, webdriver: F.webdriver }).stage; })();
  if (FV) root.dataset.first = '';   // the shell: the dissolve into the staged first minute is the hand-over's 1.2 s fade
  const q = (s) => root.querySelector(s);
  const bg = q('.lk-bg'), company = q('.lk-company'), cap = q('.lk-fcap'), skipBtn = q('.lk-skip'), soundBtn = q('.lk-sound');
  const t0 = now();
  let video = null, mode = D.mode, started = false, playing = false, logoDone = false, timers = [], disposed = false, lastCap = null;
  let ended = false, handover = false, live = false;   // ended: the film ran out; handover: the live lake is due at ready (the end, or a skip); live: it has taken over
  const subs = [], emit = (kind, why) => { for (const f of subs) { try { f(kind, why); } catch { /* a listener's own fault */ } } };   // the strip listens (src/ui/attractStrip.js)
  root.dataset.reel = mode;
  const setCap = (s) => {
    if (!cap) return;
    const key = s ? s.id : null;
    if (key === lastCap) return;
    lastCap = key;
    if (!s) { cap.classList.remove('on'); return; }
    const b = cap.querySelector('b'), sp = cap.querySelector('span');
    if (b) b.textContent = s.place; if (sp) sp.textContent = s.facts;   // the ' · ' is CSS: a phone puts the facts on their own line
    cap.classList.add('on');
  };
  const after = (ms, f) => { const id = clock(f, ms); timers.push(id); return id; };

  // the studio's mark: it holds REEL.logoS, and until the film's first frame moves; then it thins (CSS: .lk-company.off)
  function logoOut() {
    if (logoDone || disposed) return;
    logoDone = true;
    company?.classList.add('off');
    root.dataset.logo = 'off';
    if (mode === 'stills') stillsOn();
  }
  function maybeLogoOut() {
    const held = now() - t0 >= REEL.logoS * 1000;
    if (held && (mode === 'stills' || playing)) logoOut();
  }
  after(REEL.logoS * 1000, maybeLogoOut);
  after(REEL.logoMaxS * 1000, () => { if (!logoDone) { if (!playing) root.dataset.reelLate = ''; logoOut(); } });   // the still under the mark shows; the film fades in over it when it plays

  // the stills breathing (the Ken Burns moves: CSS on .lk-bg.lk-kb): the first still is the shell's own; two more join
  function stillsOn() {
    if (!bg || bg.classList.contains('lk-kb')) return;
    for (const n of STILLS.slice(1)) {
      const img = doc.createElement('img');
      img.className = 'lk-kb2'; img.alt = ''; img.decoding = 'async';
      img.setAttribute('sizes', '(max-width:640px),(max-aspect-ratio:4/5) 420px, max(100vw, 177.8vh)');
      img.setAttribute('srcset', stillSrcset(n)); img.src = stillSrc(n);
      bg.appendChild(img);
    }
    bg.classList.add('lk-kb');
    // the caption follows the still on show (the cycle is the CSS's: STILL_S each)
    const capOf = (i) => setCap(SHOTS.find((s) => s.id === STILLS[i % STILLS.length]) ?? null);
    capOf(0);
    const t1 = now();
    const turn = () => { if (disposed || mode !== 'stills' || live) return; capOf(Math.round((now() - t1) / (STILL_S * 1000))); after(STILL_S * 1000, turn); };
    // an automated browser (the goldens, the probes) holds the first still's caption: the turn is a wall-clock timer, so a slower or
    // faster load swapped the caption (and a golden flipped on a one-comment change in index.html, 2026-11-07)
    if (root.dataset.reelWhy !== 'automated' && D.why !== 'automated') after(STILL_S * 1000, turn);
  }
  function toStills(why) {
    mode = 'stills'; root.dataset.reel = 'stills'; root.dataset.reelWhy = why;
    emit('stills', why);
    releaseVideo();
    playing = false;
    if (logoDone) stillsOn();
    reelBtn();
  }
  const reelBtn = () => { if (skipBtn) { skipBtn.dataset.on = ''; skipBtn.setAttribute('aria-label', 'Play the film'); const t = skipBtn.querySelector('.t'); if (t) t.textContent = 'Reel'; } };
  const dropVideo = (v) => { try { v.pause(); v.removeAttribute('src'); v.load(); } catch { /* a stub */ } v.remove(); };
  const releaseVideo = () => {   // every copy: the running one, the loop's next, the one dissolving out
    for (const v of [video, next, fading]) if (v) dropVideo(v);
    video = null; next = null; fading = null;
  };

  // the hand-over (owner, 2026-11-07): the film's end, or a skip, gives the screen to the live lake once the world is ready
  // (the card up: state home, or its idle attract); before that the film's last frame (or the stills) holds with the line
  const worldUp = () => root.dataset.state === 'home' || root.dataset.state === 'attract';
  function goLive(why) {
    if (live || disposed || !handover || !worldUp()) return;
    live = true;
    root.dataset.reelEnd = 'live';   // CSS: the picture and the navy ground fade over REEL.liveS; the wash and the words stay
    setCap(null);
    reelBtn();
    const v = video;
    after(REEL.liveS * 1000 + 200, () => { if (live && video === v) releaseVideo(); });   // the decoder goes once the fade is done
    emit('live', why);
  }
  win.addEventListener?.('lakeshore:home', () => goLive(ended ? 'end' : 'skip'));

  // the film: low priority, muted, inline; captions from its clock. While loading it loops with a dissolve (a second copy
  // from 0 fades in over the last second); once the world is ready its end hands over to the live lake.
  let next = null, fading = null;   // next: the loop's second copy, made before the end; fading: the copy dissolving out under it
  function makeVideo() {
    const v = doc.createElement('video');
    v.className = 'lk-reelv'; v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('muted', '');
    v.preload = 'auto'; v.disablePictureInPicture = true; v.setAttribute('aria-hidden', 'true');
    try { v.fetchPriority = 'low'; v.setAttribute('fetchpriority', 'low'); } catch { /* no attribute */ }
    v.src = F.phone ? REEL.phone : REEL.desktop;
    return v;
  }
  const durOf = (v) => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration : REEL.durS);
  function wire(v) {
    v.addEventListener('playing', () => { if (video !== v) return; playing = true; v.classList.add('on'); maybeLogoOut(); emit('playing'); });
    v.addEventListener('timeupdate', () => {
      if (mode !== 'video' || video !== v) return;
      const t = v.currentTime, left = durOf(v) - t;
      if (inLoading() && !next && left <= REEL.loopS + REEL.loopPrepS) prepLoop();
      if (inLoading() && next && left <= REEL.loopS) { loop(); return; }
      setCap(captionAt(t));
    });
    v.addEventListener('ended', () => {
      if (video !== v || mode !== 'video') return;
      if (inLoading()) { loop(); return; }   // a clock that never reached the dissolve (a stalled decoder): the loop now
      ended = true; handover = true;   // the world is ready: no loop behind the card, the live lake
      if (!worldUp()) root.dataset.reelEnd = 'held';   // (inside the staged visit's own dissolve: the last frame under the fade)
      setCap(null);
      emit('ended');
      goLive('end');
    });
    v.addEventListener('error', () => { if (video === v) toStills('error'); });
  }
  function prepLoop() {
    if (next || disposed || !bg) return;
    next = makeVideo();
    next.style.transitionDuration = `${REEL.loopS}s`;   // the reel's own 1 s dissolve, not the 0.6 s first fade-in
    bg.appendChild(next);   // a later sibling: on top of the running copy
    try { next.load?.(); } catch { /* a stub */ }
  }
  function loop() {
    if (disposed || mode !== 'video') return;
    if (!next) prepLoop();
    const old = video, v = next;
    if (!v) return;
    next = null;
    if (fading) dropVideo(fading);
    fading = old; video = v;
    wire(v);
    setCap(null);
    const p = v.play?.(); if (p?.catch) p.catch(() => { if (video === v) toStills('autoplay'); });
    // the new copy fades in ('playing' adds .on) over the old one's last second; then the old one's decoder goes
    after(REEL.loopS * 1000 + 400, () => { if (fading === old) { dropVideo(old); fading = null; } });
    emit('loop');
  }
  function start() {
    if (started || disposed || mode !== 'video' || !bg) return;
    started = true;
    const v = makeVideo();
    wire(v);
    bg.appendChild(v);
    video = v;
    const go = () => { if (video !== v || disposed) return; const p = v.play?.(); if (p?.catch) p.catch(() => { if (!playing) toStills('autoplay'); }); };
    // a desktop (the film from the first second): fetched now, moving at playAt, so the mark's thinning reveals the first burst;
    // a phone (the film from the 'sky' stage): moving at once
    const wait = D.startAt === 'now' ? Math.max(0, REEL.playAt * 1000 - (now() - t0)) : 0;
    if (wait > 0) { try { v.load?.(); } catch { /* a stub */ } after(wait, go); } else go();
  }
  // The link gate (perf/slow-loading): the desktop's film (16 MB) started with the page and shared the link with the
  // game's downloads: on DevTools' Fast 4G (9 Mbps) 15.5 MB of film came in before ready, and the game was ready at 80 s,
  // not 35. With a measure (link), the film starts at once only on a fast link (the still and the first scripts are in by
  // LINK_MS on any broadband: the mark holds 1.7 s, so the start is unchanged there); a mid link waits for the 'sky' stage
  // (the downloads are in), as a phone does; a slow one, or one still unknown at 'sky' and slow then, keeps the stills.
  let linkWait = false;
  const LINK_MS = 600;
  if (mode === 'video' && D.startAt === 'now') {
    if (!link) start();
    else after(LINK_MS, () => {
      if (disposed || mode !== 'video' || started) return;
      const v = link();
      if (v === 'fast') start(); else if (v === 'slow') toStills('slow-link'); else linkWait = true;
    });
  }

  // the controls: Skip (the button, Esc, a tap on the footage), the ♪ chip
  // a skip ends like the film's end: while loading the stills hold with the line (as before), then the live lake at ready;
  // once the card is up the live lake at once. Remembered either way.
  function skip() {
    if (mode !== 'video' || live) return;
    rememberSkip(true, storage);
    handover = true;
    if (worldUp()) { pauseVideo(); goLive('skip'); } else toStills('skip');
  }
  const pauseVideo = () => { if (video) try { video.pause(); } catch { /* a stub */ } };
  function play() {
    rememberSkip(false, storage);
    if (mode === 'video' && !ended && !live) return;
    releaseVideo();
    ended = false; handover = false; live = false; playing = false; delete root.dataset.reelEnd;
    mode = 'video'; root.dataset.reel = 'video'; delete root.dataset.reelWhy; started = false;
    bg?.classList.remove('lk-kb'); for (const i of bg?.querySelectorAll('.lk-kb2') ?? []) i.remove();
    if (skipBtn) { delete skipBtn.dataset.on; skipBtn.setAttribute('aria-label', 'Skip the film'); skipBtn.querySelector('.t').textContent = 'Skip'; }
    start();
    emit('play');
  }
  const inLoading = () => root.dataset.state === 'company';
  skipBtn?.addEventListener('click', (e) => { e.stopPropagation(); if (skipBtn.dataset.on != null) play(); else skip(); });
  const onKey = (e) => { if (e.key === 'Escape' && mode === 'video' && inLoading()) { e.preventDefault?.(); e.stopImmediatePropagation?.(); skip(); } };
  win.addEventListener?.('keydown', onKey, true);
  bg?.addEventListener('click', () => { if (inLoading()) skip(); });
  if (stored === 'skip' && skipBtn) { skipBtn.dataset.on = ''; skipBtn.setAttribute('aria-label', 'Play the film'); const t = skipBtn.querySelector('.t'); if (t) t.textContent = 'Reel'; }

  let soundWanted = false;
  function sound() {
    soundWanted = true;
    root.dataset.sound = 'on';
    soundBtn?.setAttribute('aria-pressed', 'true');
    try { win.dispatchEvent?.(new CustomEvent('lakeshore:sound')); } catch { /* no CustomEvent */ }   // src/core/world.js starts the audio (the click is the browser's gesture)
  }
  soundBtn?.addEventListener('click', (e) => { e.stopPropagation(); sound(); });

  function stage(name) {
    if (name !== 'sky' || mode !== 'video') return;
    if (D.startAt === 'sky') start();
    else if (linkWait) { linkWait = false; if (link?.() === 'slow') toStills('slow-link'); else start(); }   // a desktop on a mid link (above)
  }
  function gone() {
    if (disposed) return;
    disposed = true;
    for (const id of timers) unclock(id);
    win.removeEventListener?.('keydown', onKey, true);
    releaseVideo();
  }
  return { stage, skip, play, sound, gone, on: (f) => { subs.push(f); return () => { const i = subs.indexOf(f); if (i >= 0) subs.splice(i, 1); }; }, get mode() { return mode; }, get video() { return video; }, get playing() { return playing; }, get logoDone() { return logoDone; }, first: FV, get ended() { return ended; }, get live() { return live; }, get soundWanted() { return soundWanted; }, decision: D };
}
