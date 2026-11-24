// Controls hint: the quiet on-screen teaching for Sail (design:; the controls).
// Plain DOM + CSS, no framework, no edits to main.js. One line at a time, bottom-left, in the sail's cream on a
// soft dark halo, no box, no icons. A hint appears only when it is relevant, brightens when its key is pressed,
// and fades once used. Hold H for the full list.
//
//   import { createControlsHint } from './ui/controlsHint.js';
//   const hint = createControlsHint({ state: () => phys.state });   // state(): the boat state (mainFill, mainStall, apparentWind, trueWind, sog) or null
//   hint.update(dt);                 // every frame, dt in s (real time, not sim time)
//   hint.force('pull');              // pin a state for a capture: none | pull | ease | irons | steer | tack | gybe | heavy | gusts | groove | wind | look | whisper | keys
//   hint.dispose();
//
// The skill model decides (src/sail/skills.js): a skill line shows only while
// the player struggles with a skill they have not shown, never on a timer alone, and nothing at all once the model has
// seen a pro (or "I sail" is on). Pass { skills } (Sail feeds it the real inputs); without one the hint keeps its
// own, fed from the keys it sees. Holding H shows the list, and while H is held: I "I sail" (the newbie hints off),
// 5 the crew's net (auto → 12 s → 25 s → off), 6 the pilot, 7 I sail (every letter is taken: keys.js). The pro rows join the list once trim is
// mastered, or while pro is on ({ proKeys: () => true }: P, ?pro=1).
// Each line has a mouse phrasing (feat/mouse), chosen by the input modality ({ modality }: by default
// the 'modality' service's kind, 'mouse' | 'keys' | 'pad'); a shown line is re-said when the hand changes.
// It listens to keydown/keyup, mousedown/mousemove and wheel on window to see what the player has used; it never
// stops an event. The non-skill lines (wind, look) run once per browser (localStorage 'lakeshore.hints.v2'); pass
// { once: false } to run them every time, or ?hint=<state> on the page to pin a state.
import { relabelCaps } from './keyLabels.js';
import { createSkills } from '../sail/skills.js';
import { createWords } from './words.js';
import { prepareLine, windOnScreen } from './subtitleWind.js';
import { LIST_ROWS, PRO_ROWS } from './keysContent.js';
import { say as SAY, sayText as SAYT, TEXT as SAYTEXT, MOUSE_TEXT } from './skipper.js';   // the old skipper's voice
import { lineText } from './skipperText.js';   // what the spoken voice reads (skipperVoice.js)

import { FONT, UI, ensureTokens } from './tokens.js';
import { FLAGS } from '../sim/core/flags.js';
import { createPhoneQuiet } from './phoneQuiet.js';   // the phone's quiet skipper (owner 2026-11-16): the one rule for html.lk-flat
import { uniqueFaces } from './fontFaces.js';   // one @font-face per family and style (no duplicate font fetches)
export { FONT, UI };   // captainView.js and chartplotter.js import it from here

// Every value is a token (src/ui/tokens.css).
// The subtitle faces (type study 2026-10-30; renders/…/subfont-sheet): A Fraunces (SOFT 100, WONK, opsz 60: the default), B Cormorant Garamond 600, C Newsreader,
// D Spectral 500, E Figtree; `?subfont=b..e` picks another, the tuning (size, tracking, weight) is in tokens.css. Latin subsets in /fonts/sub/, all SIL OFL 1.1.
export const SUBFONTS = ['a', 'b', 'c', 'd', 'e'];
const SUBFACE = (n, f, w) => `@font-face{font-family:'Velia Sub ${n}';font-style:normal;font-weight:${w};font-display:swap;src:url(/fonts/sub/${f}.woff2) format('woff2')}`;
const CSS = `
${SUBFACE('A', 'fraunces-soft', '400 700')}${SUBFACE('B', 'cormorant-garamond-600', '600')}${SUBFACE('C', 'newsreader', '400 700')}${SUBFACE('D', 'spectral-500', '500')}${SUBFACE('E', 'figtree', '300 900')}
@font-face{font-family:'Jost';font-style:normal;font-weight:300 500;font-display:swap;src:url(/fonts/jost-latin.woff2) format('woff2')}
@font-face{font-family:'Jost';font-style:italic;font-weight:300 500;font-display:swap;src:url(/fonts/jost-italic-latin.woff2) format('woff2')}
.lk-hint{position:fixed;left:var(--lk-mx);bottom:var(--lk-my);z-index:var(--lk-z-hud);pointer-events:none;user-select:none;
  font:var(--lk-regular) var(--lk-fs-label)/1.2 var(--lk-ui);color:var(--lk-ink);letter-spacing:var(--lk-track);font-variant-numeric:tabular-nums;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.lk-showcam .lk-hint{opacity:0;transition:opacity .4s}   /* the one-tap fireworks' camera: no line over the show (src/sail/showNow.js) */
.lk-hint .row{display:flex;align-items:center;gap:.55em;width:fit-content;padding:var(--lk-glass-pad);opacity:0;transform:translateY(var(--lk-rise));
  transition:opacity var(--lk-out) var(--lk-ease-out),transform var(--lk-out) var(--lk-ease-out)}
.lk-hint .row.in{opacity:1;transform:none;transition:opacity var(--lk-in) var(--lk-ease) var(--d,0s),transform var(--lk-in) var(--lk-ease) var(--d,0s)}
.lk-hint .row.now{transition:none}
.lk-hint .cap{display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box;min-width:1.7em;height:1.7em;padding:0 .5em;
  border:var(--lk-line) solid var(--lk-hair);border-radius:var(--lk-radius);font-weight:var(--lk-medium);font-size:var(--lk-fs-caption);letter-spacing:.02em;
  transition:border-color .12s,color .12s,background-color .12s}
.lk-hint .cap.wide{letter-spacing:.04em;padding:0 .6em}
.lk-hint .cap.hot{border-color:var(--lk-lit);color:var(--lk-lit-ink);background:var(--lk-lit-fill)}
.lk-hint .label{margin-left:.35em}
.lk-hint .row[data-tap]{min-height:44px;box-sizing:border-box}   /* a line that is its own tap target (note's onTap): a finger's 44 px */
.lk-hint .row[data-tap].in{pointer-events:auto;cursor:pointer}
.lk-hint .dot{margin:0 .3em;color:var(--lk-ink-soft)}
.lk-hint .caps{display:inline-flex;align-items:center;gap:.5em}
.lk-hint .list{display:flex;flex-direction:column;gap:.7em;padding:.85em 1.1em;opacity:0;transition:opacity var(--lk-out) var(--lk-ease-out)}
.lk-hint .list:has(.row.in){opacity:1;transition:opacity var(--lk-in) var(--lk-ease)}
.lk-hint .list .row{background:none;-webkit-backdrop-filter:none;backdrop-filter:none;border:0;box-shadow:none;border-radius:0;padding:0;width:auto}
.lk-hint .list .row>.caps:first-child{min-width:7.6em}
.lk-hint .list .row{--d:0s}
.lk-hint .soft{color:var(--lk-ink-soft)}
/* the old skipper's line: in quotes, Jost italic, a touch larger (Jost sits small) and lighter than the UI's face; the term tag stays upright */
.lk-hint .say{font-style:normal}   /* round 3: a subtitle is upright; tokens.css sets its face */
.lk-hint .say .tag{font-style:normal;font-family:var(--lk-ui);font-size:.93em;color:var(--lk-ink-soft)}
.lk-hint .credit{font-size:var(--lk-fs-caption);letter-spacing:.02em;color:var(--lk-ink-faint);margin-top:.3em}
/* phone width: the row lifts above the toast's line, the list wraps short of the glyph's column and
   keeps only the verbs (the asides are for a wide screen) */
:where(:root[data-screen~=narrow]) .lk-hint{bottom:calc(var(--lk-my) + 2.9em);right:calc(var(--lk-mx) + var(--lk-d) + 12px)}
  :where(:root[data-screen~=narrow]) .lk-hint .row{flex-wrap:wrap;row-gap:.45em}
  :where(:root[data-screen~=narrow]) .lk-hint .list{gap:.45em;padding:.6em .8em}
  :where(:root[data-screen~=narrow]) .lk-hint .list .row{row-gap:.15em}
  :where(:root[data-screen~=narrow]) .lk-hint .list .row>.caps:first-child{min-width:0}
  :where(:root[data-screen~=narrow]) .lk-hint .list .label{margin-left:.15em}
  :where(:root[data-screen~=narrow]) .lk-hint .credit{display:none}
  :where(:root[data-screen~=narrow]) .lk-hint:has(.list){right:calc(100vw - 196px)}   /* the list stays left of the small chart's column */
  :where(:root[data-screen~=narrow]) .lk-hint .list .row:nth-child(n+6){display:none}   /* a phone has no keyboard: the five that matter; the full list is on the menu's Keys page */
  :where(:root[data-screen~=narrow]) .lk-hint .soft{display:none}
/* the wind (subtitleWind.js): letters arrive from upwind and leave downwind; only transform, opacity and a 2 px blur move */
.lk-hint .row .wd{display:inline-block;white-space:nowrap}
.lk-hint .row .lt{display:inline-block;opacity:0;will-change:transform,opacity}
.lk-hint .row.in .lt{animation:lk-sub-in .46s cubic-bezier(.22,.7,.2,1) var(--ld,0s) both}
.lk-hint .row.out .lt{animation:lk-sub-out .62s cubic-bezier(.5,0,.8,.6) var(--lo,0s) both}
.lk-hint .row.now .lt{animation:none;opacity:1}
@keyframes lk-sub-in{
  0%{opacity:0;transform:translate(calc(var(--wx,-1) * -.3em * var(--g,1)),calc(var(--wy,0) * -.3em * var(--g,1))) rotate(calc((var(--r,.5) - .5) * -6deg));filter:blur(2px)}
  55%{opacity:1;transform:translate(calc(var(--wx,-1) * .035em),calc(var(--wy,0) * .035em));filter:blur(.4px)}
  100%{opacity:1;transform:none;filter:blur(0)}}
@keyframes lk-sub-out{
  0%{opacity:1;transform:none;filter:blur(0)}
  100%{opacity:0;transform:translate(calc(var(--wx,-1) * (.36em + var(--r,.5) * .22em) * var(--g,1)),calc(var(--wy,0) * .3em - (.2em + var(--r,.5) * .18em))) rotate(calc((var(--r,.5) - .3) * 14deg));filter:blur(1.2px)}}
@media (prefers-reduced-motion:reduce){.lk-hint .row{transform:none}.lk-hint .row .lt,.lk-hint .row.in .lt,.lk-hint .row.out .lt{animation:none!important;opacity:1;filter:none;transform:none}}
`;

// The hints. keys: what makes it "used"; the conditions live in update().
const CAP = (k) => `<span class="cap${k.length > 2 ? ' wide' : ''}" data-k="${k}">${k}</span>`;
const CAPS = (...ks) => `<span class="caps">${ks.map(CAP).join('')}</span>`;
const ROW = (caps, label) => CAPS(...caps) + `<span class="label">${label}</span>`;
const LINE = (label) => `<span class="label" style="margin-left:0">${label}</span>`;
const STEER = ['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight'], PULL = ['KeyW', 'ArrowUp'], EASE = ['KeyS', 'ArrowDown'], WIND = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const HINTS = {
  pull:    { html: ROW(['W'], SAY('pull')), keys: PULL },
  ease:    { html: ROW(['S'], SAY('ease')), keys: EASE },
  irons:   { html: ROW(['A', 'D'], SAY('irons')), keys: STEER },
  steer:   { html: ROW(['A', 'D'], SAY('steer')), keys: STEER },
  // the skill lines, in the same hand
  tack:    { html: ROW(['A', 'D'], SAY('tack')), keys: STEER },
  gybe:    { html: ROW(['W'], SAY('gybe')), keys: PULL },
  heavy:   { html: ROW(['S'], SAY('heavy')), keys: EASE },
  gusts:   { html: LINE(SAY('gusts')), keys: [] },
  groove:  { html: ROW(['W', 'S'], SAY('groove')), keys: [...PULL, ...EASE] },
  chart:   { html: ROW(['N'], SAYT(SAYTEXT.chart)), keys: ['KeyN'] },
  wind:    { html: ROW(['1', '2', '3', '4'], SAYT(SAYTEXT.wind)), keys: WIND },
  look:    { html: CAPS('drag') + '<span class="label">' + SAYT(SAYTEXT.look) + '</span><span class="dot">·</span>' + CAPS('wheel') + '<span class="label">' + SAYT(SAYTEXT.closer) + '</span>', keys: ['drag', 'wheel'] },
  whisper: { html: `<span class="whisper">${CAP('H')}<span class="label">${SAYT(SAYTEXT.whisper)}</span></span>`, keys: ['KeyH'] },
};
// The full list, under H: the same table as the Keys page (keysContent.js), two items to a line.
export const LIST = LIST_ROWS;
const CREDIT = '<span class="credit">Map data © OpenStreetMap contributors</span>';   // ODbL attribution (the towns)
// The pro rows (in the list only once trim is mastered, or while pro is on: Settings, ?pro=1). Settings (sailing: pro) turns pro mode
// on (feat/pro-sailing): the sail controls the crew keeps in basic mode; the untaught crew keys after.
export const PRO_LIST = PRO_ROWS;
// Mouse-phrased lines (feat/mouse), shown instead when the input modality is 'mouse'
const MOUSE = {
  pull:   LINE(SAY('pull')),   // one wording on every input: "pull the sails in" (front-door review, 2026-11-04)
  ease:   LINE(SAY('ease')),
  irons:  CAPS('click') + '<span class="label">' + SAY('irons') + '</span>',
  steer:  CAPS('click') + '<span class="label">' + SAY('steer') + '</span>',
  tack:   CAPS('click') + '<span class="label">' + SAY('tack') + '</span>',
  gybe:   CAPS('drag') + '<span class="label">' + SAY('gybe') + '</span>',
  heavy:  CAPS('drag') + '<span class="label">' + SAY('heavy') + '</span>',
  groove: CAPS('drag') + '<span class="label">' + SAY('groove') + '</span>',
  chart:  CAPS('click') + '<span class="label">' + SAYT(MOUSE_TEXT.chart) + '</span>',
};
// Touch-phrased lines (owner, 2026-10-31: iOS still showed key caps): the finger's words, never a cap. The sail and helm lines
// come from words.js PHRASES.touch ("drag a winch down", "drag the wheel"); the rest are whole sentences. Shown when the
// input modality is touch (pointer.js: a finger last, or a coarse device before any input).
const TOUCH_TEXT = { chart: 'Lost? Tap the chart, top right', wind: 'Want a different breeze? Tap Wind, top bar', look: 'Have a look round: drag with two fingers, pinch to come closer' };
const TOUCH = {
  pull: LINE(SAY('pull')), ease: LINE(SAY('ease')), irons: LINE(SAY('irons')), steer: LINE(SAY('steer')), tack: LINE(SAY('tack')),
  gybe: LINE(SAY('gybe')), heavy: LINE(SAY('heavy')), groove: LINE(SAY('groove')), gusts: HINTS.gusts.html,
  chart: LINE(SAYT(TOUCH_TEXT.chart)), wind: LINE(SAYT(TOUCH_TEXT.wind)), look: LINE(SAYT(TOUCH_TEXT.look)),
};
// The keep-turning line (fix/tack-wind, 2026-11-04; tackCarry.js): while the bow is in the no-go zone and still turning
// through a tack, the hint line says which way to keep going. Plain words, no term, no voice (it lasts a few seconds).
// keys: the cap of the side (A port, D starboard); a mouse or a finger: the side in words.
export const KEEP = {
  keys: (dir) => ROW([dir < 0 ? 'A' : 'D'], 'keep turning, through the wind'),
  hand: (dir) => LINE(`keep turning ${dir < 0 ? 'left' : 'right'}, through the wind`),
};
// The settings rows, under H: the assists and "I sail" (the keys work while H is held)
const netLabel = (sk) => { const v = sk.netAfter; const s = v === Infinity ? 'off' : `${v} s`; return sk.netAuto ? `${s} · as you learn` : s; };
const SETTINGS = (sk, pilotOn) => [
  ROW(['5'], 'the crew\'s net') + `<span class="label soft">· ${netLabel(sk)}</span><span class="dot">·</span>` + CAP('6') + '<span class="label">the pilot</span>' + `<span class="label soft">· ${pilotOn ? 'on' : 'off'}</span>`,
  ROW(['7'], 'I sail') + `<span class="label soft">· ${sk.iSail ? 'on: the hints are quiet' : 'mutes the hints'}</span>`,
];

// a page whose bar differs from v1's names its own places (v2's new top bar: v2/ui/topBar.js): setTouchLine('wind', 'Want …')
export function setTouchLine(name, text) { if (TOUCH[name]) TOUCH[name] = LINE(SAYT(text)); }
// a page with no key for a line (v2's lean set: no 1–4 for the wind) says it in words for the keys and the mouse too, no caps
export function setHintLine(name, text) { if (HINTS[name]) HINTS[name] = { ...HINTS[name], html: LINE(SAYT(text)), keys: [] }; if (MOUSE[name]) MOUSE[name] = LINE(SAYT(text)); }
export { HINTS, MOUSE, TOUCH, SETTINGS };   // tests/words.test.mjs reads every string a hint can say
const ALIAS = { sheets: 'pull', luff: 'pull', stall: 'ease', first: 'steer', all: 'keys', list: 'keys', '': 'none' };
const DEG = Math.PI / 180;
// how many times a session each skill line may show (the gusts and groove lines: once per browser)
const CAPS_PER_SESSION = { pull: 4, ease: 3, steer: 2, tack: 3, gybe: 2, heavy: 2, irons: Infinity, gusts: 1, groove: 1, chart: 1 };

export function createControlsHint({ root = document.body, state = () => null, once = true, storage = globalThis.localStorage,
  skills = null, proKeys = () => false, pilot = () => true, onPilot = null, voice = null,
  services = null,   // the page's registry (src/core/services.js): the modality, the chart and the boat by default
  modality = () => services?.get('modality')?.kind, touch = () => !!services?.get('modality')?.touch, chart = () => !!services?.get('chart'), words = null,
  phoneQuiet = null,
  lean = false,   // v2's lean key set: H holds no list, H+5/6/7 do nothing, no "hold H" whisper line
  list = null } = {}) {   // list(): a page's own H list lines (v2/ui/keyMap.js hListHtml, by mode and Pro); null: the full table (v1)   // phoneQuiet: src/ui/phoneQuiet.js's rule (sail.js passes one that knows the engine); by default one of our own
  ensureTokens();
  try { const f = FLAGS.subfont?.toLowerCase(); if (SUBFONTS.includes(f)) document.documentElement.dataset.subfont = f; } catch { /* no location */ }
  if (!document.getElementById('lk-hint-css')) {
    const st = document.createElement('style'); st.id = 'lk-hint-css'; st.textContent = uniqueFaces(CSS); document.head.appendChild(st);
  }
  const el = document.createElement('div'); el.className = 'lk-hint'; root.appendChild(el);
  const caps = el.getElementsByClassName?.('cap') ?? null;   // live: heat() runs every frame (a test DOM without it queries)

  let seen = false;
  try { seen = once && storage?.getItem('lakeshore.hints.v2') === '1'; } catch { /* private mode: run it */ }
  // no skill model given (a demo page): our own, in memory, fed from the keys we see
  const own = !skills;
  const sk = skills ?? createSkills({ storage: null });
  const W = words ?? createWords({ skills: sk });   // the sailor's words (words.js): the plain line, its term beside it, fading with skill
  const PQ = phoneQuiet ?? createPhoneQuiet({ storage: once ? storage : null });   // on a phone (html.lk-flat): first sail, stuck, replies only
  const used = new Set();                     // what the player has used so far: key codes, 'drag', 'wheel', and the hints shown
  const down = new Set();                     // keys down now
  const shown = {};                           // per hint, this session
  let t = 0, idle = 0, cur = 'none', forced = null, shownAt = 0, usedFor = 0;
  let fullFor = 0, drawFor = 0, whisperAt = Infinity, whisperShownOnce = false;
  let holdH = false, hFrom = 0, dragging = false, moved = 0;
  // H held shows the list; a tap of the player's own key is the cockpit's fold (calmHud.js), so the list waits 0.3 s for a hold.
  // The dock's KEYS button and a pad's menu button (synthetic events) open it at once.
  const H_HOLD_S = 0.3;
  let keepDir = 0, keepShown = 0, keepOff = 0;   // the keep-turning line: the side asked (tackCarry.js), the side shown, s since it was asked

  // ---- DOM ----
  // a one-off line (feat/engine-anchor: "the sails are quieter · stop the engine", "slow under 1 kn to anchor"): one
  // key and a few words, shown only into a quiet moment, gone after NOTE_S or when its key is pressed
  let noteSpec = null;
  // a brief status line (owner, 2026-11-05: no pill under the top bar): it takes this line at once for secs, in the same type, then the line it replaced comes back
  let flashSpec = null, resumeName = null;
  const listRows = () => [...(list?.() ?? [...LIST, ...(sk.mastered('trim') || sk.pro || proKeys() ? PRO_LIST : [])]), ...SETTINGS(sk, pilot()), CREDIT];
  // the old skipper says a line the first time it shows (skipperVoice.js keeps the rules: once, gesture, sound, no overlap)
  const speak = (text) => { if (voice && text && el.style.display !== 'none') voice.say(text); };
  const breeze = (r) => { try { prepareLine(r, windOnScreen(services?.get('player')?.phys?.state?.trueWind, services?.get('view'))); } catch { /* a line without a wind keeps its plain fade */ } };
  const show = (name, { now = false, say = true } = {}) => {
    if (name === cur) return;
    if (name === 'whisper' && (touch() || lean)) return;   // "hold H" has no touch way: the Keys page's Touch sheet is on the menu
    if (name === 'keep') { cur = name; shownAt = t; usedFor = 0; keepShown = keepDir; el.innerHTML = ''; const r = document.createElement('div'); r.className = 'row'; r.innerHTML = W.expand(touch() || modality() === 'mouse' ? KEEP.hand(keepDir) : KEEP.keys(keepDir)); el.appendChild(r); breeze(r); requestAnimationFrame(() => r.classList.add('in')); return; }
    if (name === 'flash' && flashSpec) { cur = name; shownAt = t; usedFor = 0; el.innerHTML = ''; const r = document.createElement('div'); r.className = 'row'; const fk = flashSpec.key && !touch() ? [flashSpec.key] : [];
      r.innerHTML = W.expand(flashSpec.keyAfter && fk.length ? `<span class="label">${SAYT(flashSpec.text)}</span>${CAPS(...fk)}` : ROW(fk, SAYT(flashSpec.text))); el.appendChild(r); breeze(r); requestAnimationFrame(() => r.classList.add('in')); return; }
    if (name === 'note' && noteSpec) { if (noteSpec.kind === 'first') PQ.firstShown(); cur = name; shownAt = t; usedFor = 0; el.innerHTML = ''; const r = document.createElement('div'); r.className = 'row'; r.innerHTML = W.expand(ROW(noteSpec.key && !touch() ? [noteSpec.key] : [], noteSpec.text), { meetTerms: true }); if (noteSpec.onTap) tappable(r, noteSpec.onTap); el.appendChild(r); breeze(r); requestAnimationFrame(() => r.classList.add('in')); speak(noteSpec.speak); return; }
    cur = name; shownAt = t; usedFor = 0;
    el.innerHTML = '';
    if (name === 'none') return;
    if (name === 'keys') {
      const list = document.createElement('div'); list.className = 'list';
      listRows().forEach((html, i) => { const r = document.createElement('div'); r.className = 'row' + (now ? ' now' : ''); r.style.setProperty('--d', `calc(var(--lk-stagger) * ${i})`); r.innerHTML = W.expand(html, { mouse: modality() === 'mouse', touch: touch(), meetTerms: true }); list.appendChild(r); });
      el.appendChild(list); relabelCaps(list);
      requestAnimationFrame(() => [...list.children].forEach((r) => r.classList.add('in')));
      if (now) [...list.children].forEach((r) => r.classList.add('in'));
      return;
    }
    const r = document.createElement('div'); r.className = 'row' + (now ? ' now' : ''); const tc = touch() && !!TOUCH[name], mouse = !tc && modality() === 'mouse' && !!MOUSE[name];
    r.innerHTML = W.expand(tc ? TOUCH[name] : mouse ? MOUSE[name] : HINTS[name].html, { mouse, touch: tc, meetTerms: true }); el.appendChild(r); breeze(r);
    if (now) r.classList.add('in'); else requestAnimationFrame(() => r.classList.add('in'));
    if (say) speak(lineText(name, W, { mouse, mouseHtml: MOUSE[name] }))   // a finger's line reads the plain wording (no key names);
  };
  const offW = W.onChange?.((ev) => { if (ev.type === 'mode') { redrawList(); if (cur !== 'none' && cur !== 'keys' && cur !== 'note') { const c = cur; cur = 'none'; show(c, { now: true, say: false }); } } });
  const redrawList = () => { if (cur === 'keys') { cur = 'none'; show('keys', { now: true }); } };
  // a note with onTap: the line itself is the button (a tap or a click runs it once and the line goes; the press never reaches the page under it)
  const tappable = (r, fn) => {
    r.dataset.tap = ''; r.setAttribute('role', 'button');
    r.addEventListener('pointerdown', (e) => e.stopPropagation?.());
    let done = false;
    r.addEventListener('click', (e) => { e.preventDefault?.(); e.stopPropagation?.(); if (done) return; done = true; if (cur === 'note') hide(); noteSpec = null; fn(); });
  };
  const hide = () => { if (cur === 'none') return; [...el.querySelectorAll('.row')].forEach((r) => { if (r.classList.contains('in')) { r.classList.remove('in'); if (r.querySelector('.lt')) r.classList.add('out'); } }); cur = 'none'; shownAt = t; };
  const heat = () => {                        // the pressed cap brightens
    for (const c of caps ?? el.querySelectorAll('.cap')) {
      const k = c.dataset.k;
      const hot = (k.length === 1 && (down.has(`Key${k}`) || down.has(`Digit${k}`) || (k === 'W' && down.has('ArrowUp')) || (k === 'S' && down.has('ArrowDown')) || (k === 'A' && down.has('ArrowLeft')) || (k === 'D' && down.has('ArrowRight'))))
        || (k === 'drag' && dragging) || (k === 'wheel' && t - (used.wheelAt ?? -9) < 0.25) || (k === 'H' && holdH);
      c.classList.toggle('hot', hot);
    }
  };

  // ---- input watch (never consumes an event) ----
  const onKeyDown = (e) => {
    down.add(e.code); used.add(e.code); idle = 0;
    if (STEER.includes(e.code)) used.add('steer'); if (PULL.includes(e.code) || EASE.includes(e.code)) used.add('sheets'); if (!lean && WIND.includes(e.code)) used.add('wind');
    if (e.code === 'KeyH' && !holdH && !lean) { holdH = true; hFrom = e.isTrusted === true && !e.lkDock ? t : -Infinity; }
    // the settings, only while the list is held open (so a stray key never flips one)
    if (holdH && !e.repeat && !e.lkVirtual) {
      if (e.code === 'Digit7') { sk.setISail(); redrawList(); }
      else if (e.code === 'Digit5') { sk.cycleNet(); redrawList(); }
      else if (e.code === 'Digit6') { const on = !pilot(); sk.setPilot(on); onPilot?.(on); redrawList(); }
    }
  };
  const onKeyUp = (e) => { down.delete(e.code); if (e.code === 'KeyH') holdH = false; };
  const onDown = () => { dragging = true; moved = 0; idle = 0; };
  const onMove = (e) => { if (dragging) { moved += Math.abs(e.movementX) + Math.abs(e.movementY); if (moved > 24) used.add('drag'); } };
  const onUp = () => { dragging = false; };
  const onWheel = () => { used.add('wheel'); used.wheelAt = t; idle = 0; };
  const onBlur = () => { down.clear(); holdH = false; dragging = false; };
  const onModality = () => { if ((MOUSE[cur] || TOUCH[cur]) && !forced) { const c = cur, a = shownAt, u = usedFor; cur = 'none'; show(c, { now: true, say: false }); shownAt = a; usedFor = u; } };   // feat/mouse: re-say a shown line in the new hand's words
  addEventListener('lk-modality', onModality);
  addEventListener('keydown', onKeyDown); addEventListener('keyup', onKeyUp); addEventListener('mousedown', onDown);
  addEventListener('mousemove', onMove); addEventListener('mouseup', onUp); addEventListener('wheel', onWheel, { passive: true }); addEventListener('blur', onBlur);

  const using = (name) => HINTS[name]?.keys.some((k) => (k === 'drag' ? dragging && moved > 24 : k === 'wheel' ? t - (used.wheelAt ?? -9) < 0.25 : down.has(k)));
  const key = (...codes) => (codes.some((c) => down.has(c)) ? 1 : 0);

  // ---- the state machine ----
  function update(dt = 1 / 60) {
    t += dt; idle += dt;
    const s = state();
    if (own && s) {
      sk.update(dt, { twa: s.trueWind?.angle, tws: s.trueWind?.speed, awa: s.apparentWind?.angle, sog: s.sog, heading: s.heading, heel: s.heel,
        mainFill: s.mainFill, mainStall: s.mainStall, boomAngle: s.boomAngle, surf: s.surf, roundUp: s.roundUp, groove: s.groove,
        steer: key('KeyD', 'ArrowRight') - key('KeyA', 'ArrowLeft'), pull: key('KeyW', 'ArrowUp') - key('KeyS', 'ArrowDown'), crew: false, gust: null });
    }
    heat();
    const pq = PQ.on;
    PQ.update(dt, s);
    if (forced) return;
    if (holdH && t - hFrom >= H_HOLD_S) { if (cur !== 'keys') show('keys'); return; }
    if (cur === 'keys') hide();
    if (flashSpec && t - flashSpec.at > flashSpec.secs) { const was = cur === 'flash'; flashSpec = null; if (was) { hide(); shownAt = t - 1; } const r = resumeName; resumeName = null; if (was && r && HINTS[r] && !sk.muted) { cur = 'none'; show(r, { now: true, say: false }); } }
    if (flashSpec) { if (cur !== 'flash') show('flash'); return; }

    const twa = Math.abs(s?.trueWind?.angle ?? 1), awa = Math.abs(s?.apparentWind?.angle ?? 1);
    const fill = s?.mainFill ?? 1, stall = awa < 80 * DEG ? (s?.mainStall ?? 0) : 0;
    const irons = s != null && !s.held && twa < 0.55 && (s.sog ?? 1) < 0.8;   // head to wind, stopped (not on an anchor, a ball or the lines: feat/engine-anchor)
    fullFor = fill > 0.8 ? fullFor + dt : 0; drawFor = stall < 0.3 ? drawFor + dt : 0;
    if (cur !== 'none') usedFor = using(cur) ? usedFor + dt : usedFor;
    const age = t - shownAt;

    // the pro, or "I sail": every newbie line goes quiet, at once. The notes stay: R.'s safety and situation lines (the shore,
    // rocks, aground, the engine, the anchor) are not newbie hints (fix/regressions, 2026-10-30: the pro detector had muted
    // the shore warning and with it every line the skipper's voice says)
    if (sk.muted || hushed || quieted) {   // hushed: the staged first visit's minutes (src/ui/firstStage.js): R.'s notes only; quieted: a sheet let fly (src/sail/letFly.js)
      if (cur !== 'none' && cur !== 'note') hide();
      if (cur === 'note' && (age > 7 || (noteSpec && age > 0.8 && down.has(noteSpec.code)))) { hide(); noteSpec = null; return; }
      if (noteSpec && cur !== 'note' && t - noteSpec.at > 4) noteSpec = null;
      if (noteSpec && cur === 'none' && t - shownAt > 0.6) show('note');
      return;
    }
    // the keep-turning line (tackCarry.js): mid-tack it takes the line at once, and fades 0.8 s after the bow stops turning
    if (keepDir && !pq) { keepOff = 0; if (cur !== 'keep' || keepShown !== keepDir) { if (cur === 'keep') cur = 'none'; show('keep'); } return; }
    if (cur === 'keep') { keepOff += dt; if (keepOff > 0.8) hide(); return; }
    // what the skill model asks for now (struggling and not mastered), in its priority order, inside the caps
    // the sails down or the boat held (an anchor, a ball, the lines): no sail-trim or tacking lines (the anchor seen, 2026-11-17:
    // "Sails shaking — pull the sails in" came up at anchor with the sails furled)
    const sailsOff = !!s && (!!s.held || (s.furl ?? 0) > 0.5), trimLine = (h) => h === 'pull' || h === 'ease' || h === 'tack' || h === 'irons' || h === 'gybe' || h === 'groove';
    const needs = (pq ? PQ.wants(sk.needs()) : sk.needs().filter((n) => (shown[n.hint] ?? 0) < (CAPS_PER_SESSION[n.hint] ?? 1) && (n.hint !== 'chart' || (chart() && !used.has('KeyN'))))).filter((n) => !(sailsOff && trimLine(n.hint)));
    const wants = new Set(needs.map((n) => n.hint));

    // the boat stuck or the sails wrong take a soft line's place at once
    const soft = cur === 'steer' || cur === 'wind' || cur === 'look' || cur === 'whisper' || cur === 'gusts' || cur === 'groove' || cur === 'chart';
    const urgent = wants.has('tack') || wants.has('irons') || wants.has('pull') || wants.has('ease');
    if (soft && urgent && age > 1.5) { hide(); shownAt = t - 1.2; }
    // a shown line fades when used, when its reason is gone, or after a while
    const out = twa > 40 * DEG;
    if (sailsOff && trimLine(cur)) { hide(); return; }   // the sails came down or she was made fast: its reason is gone
    if (cur === 'pull' && (usedFor > 0.6 || fullFor > 2 || age > 20)) { hide(); return; }
    if (cur === 'ease' && (usedFor > 0.6 || drawFor > 2 || age > 15)) { hide(); return; }
    if (cur === 'irons' && (out || age > 20)) { hide(); return; }
    if (cur === 'tack' && (out || (s?.sog ?? 0) > 1.2 || age > 15)) { hide(); return; }
    if (cur === 'gybe' && (usedFor > 0.6 || age > 10)) { hide(); return; }
    if (cur === 'heavy' && (usedFor > 0.6 || age > 10)) { hide(); return; }
    if (cur === 'gusts' && age > 10) { hide(); return; }
    if (cur === 'groove' && (usedFor > 1 || age > 12)) { hide(); return; }
    if (cur === 'chart' && (usedFor > 0 || age > 10)) { hide(); return; }
    if (cur === 'steer' && (usedFor > 1.5 || age > 25)) { hide(); whisperAt = t + 6; return; }
    if (cur === 'wind' && (usedFor > 0 || age > 10)) { hide(); return; }
    if (cur === 'look' && (used.has('drag') || age > 8)) { hide(); return; }
    if (cur === 'whisper' && (age > 10 || holdH)) { hide(); whisperShownOnce = true; return; }
    if (cur === 'note' && (age > 7 || (noteSpec && age > 0.8 && down.has(noteSpec.code)))) { hide(); noteSpec = null; return; }
    if (noteSpec && cur !== 'note' && t - noteSpec.at > 4) noteSpec = null;   // a note that found no quiet moment is dropped
    if (noteSpec && cur === 'none' && age > 0.6 && !urgent) { show('note'); return; }
    if (cur !== 'none') return;
    if (age < 1.2) return;                                              // a breath between lines

    // the skill lines first (the model's order: the boat stuck, the sails, heavy air, the gybe, the helm, the rest)
    if (needs.length) {
      const n = needs[0];
      shown[n.hint] = (shown[n.hint] ?? 0) + 1;
      if (pq) { PQ.said(n.hint, { stuck: !!n.stuck }); show(n.hint); return; }   // a phone: the rule counted it; no caps, no once-per-browser marks
      if (n.hint === 'steer') used.add('steerHint');
      if (n.hint === 'gusts' || n.hint === 'groove' || n.hint === 'chart') sk.once(n.hint);
      show(n.hint); return;
    }
    if (pq) return;   // a phone: no breeze, look-round or whisper line
    // then the non-skill lines, once per browser, only for a player the helm line has helped
    if (!seen) {
      if (used.has('steerHint') && !used.has('wind') && t > 60 && !used.has('windHint')) { used.add('windHint'); show('wind'); return; }
      if (used.has('steerHint') && !used.has('drag') && t > 90 && !used.has('look')) { used.add('look'); show('look'); return; }
    }
    if (!lean && !whisperShownOnce && !used.has('KeyH') && t > whisperAt) { show('whisper'); return; }
    if (!lean && used.has('steerHint') && !used.has('KeyH') && idle > 60 && t > 120) { idle = 0; show('whisper'); return; }   // lost? the list is one key away
    if (!seen && t > 120) { seen = true; try { storage?.setItem('lakeshore.hints.v2', '1'); } catch { /* ignore */ } }
  }

  // hush(on): only R.'s notes (and the H list) show; the skill hints, the tips and the status flashes wait (the staged first visit)
  let hushed = false;
  // quiet(on): the same, while a sheet is let fly (the luff it makes on purpose is not a "pull in" moment); R.'s notes still show
  let quieted = false;
  const quiet = (on) => { quieted = !!on; return quieted; };
  const hush = (on) => { hushed = !!on; if (hushed && cur === 'flash') { flashSpec = null; resumeName = null; hide(); } return hushed; };   // a flash already up (a reef at the start) goes too
  // kind: what the line is (src/ui/phoneQuiet.js PHONE_KEEP: 'first', 'status', 'reply', 'sea.<id>'); a phone drops the kinds it does not keep (true: handled)
  // onTap: the line is its own tap target (min 44 px high), e.g. "Tessie's up. Tap here to be her."
  function note(text, key, speakText = null, { kind = null, onTap = null } = {}) {
    if (!text || forced) return false;
    if (!PQ.allow(kind)) return true;
    const code = !key ? '' : key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
    noteSpec = { text, key, code, at: t, speak: speakText, kind, onTap: typeof onTap === 'function' ? onTap : null };
    if (cur !== 'none' && cur !== 'keys' && cur !== 'note') hide();   // a press just made: say it now
    else if (cur === 'note') { cur = 'none'; shownAt = t - 1; }
    return true;
  }
  // flash(text, { key, secs }): a status line (a reef, a wind level, a song-less event) in the subtitle line; the newest wins; false while a capture pins a hint
  function flash(text, { key = null, secs = 2.4, keyAfter = false, kind = null } = {}) {
    if (!text || forced || hushed) return false;
    if (!PQ.allow(kind)) return true;
    if (cur !== 'none' && cur !== 'keys' && cur !== 'note' && cur !== 'keep' && cur !== 'flash' && !resumeName) resumeName = cur;
    flashSpec = { text, key, secs, at: t, keyAfter };
    if (cur === 'flash') { cur = 'none'; show('flash'); }
    return true;
  }
  // drop(kind): a note of this kind, up or waiting, goes now (its reason is gone)
  function drop(kind) { if (!kind || noteSpec?.kind !== kind) return false; if (cur === 'note') hide(); noteSpec = null; return true; }
  function force(name, { animate = false } = {}) {   // animate: the line enters or leaves on the wind, as in play (a capture of the motion)
    name = ALIAS[name] ?? name;
    if (animate && name != null && name !== 'off') { forced = name; if (name === 'none') hide(); else { cur = 'none'; show(name, { now: false }); } return; }
    if (name == null || name === 'off') { forced = null; return; }
    if (!(name in HINTS) && name !== 'keys' && name !== 'none') throw new Error(`controlsHint: no state "${name}" (none | ${Object.keys(HINTS).join(' | ')} | keys)`);
    forced = name; cur = 'none'; show(name, { now: true });
  }

  function dispose() {
    removeEventListener('lk-modality', onModality);
    removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('mousedown', onDown);
    removeEventListener('mousemove', onMove); removeEventListener('mouseup', onUp); removeEventListener('wheel', onWheel); removeEventListener('blur', onBlur);
    offW?.(); el.remove();
  }

  // pro mode on / off (feat/pro-sailing's controls call it): the list's gate is proKeys(), so a shown list redraws
  const setPro = () => redrawList();
  // keep(dir): −1 / +1 while the bow is in the no-go zone turning through a tack (port / starboard), 0 when not
  const keep = (dir) => { keepDir = dir < 0 ? -1 : dir > 0 ? 1 : 0; };
  return { update, force, note, drop, flash, keep, hush, get free() { return cur !== 'note' && cur !== 'flash' && cur !== 'keep' && !noteSpec && !flashSpec && !keepDir && !forced; },   // nothing a status must not cut: no note, status or keep line up or waiting
     get hushed() { return hushed; }, quiet, get quieted() { return quieted; }, dispose, el, skills: sk, words: W, phoneQuiet: PQ, redrawList, setPro, get current() { return cur; }, get shown() { return { ...shown }; }, states: ['none', ...Object.keys(HINTS), 'keys'] };
}
