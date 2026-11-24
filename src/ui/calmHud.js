// The Calm HUD (owner, 2026-11-05, from the mockups in renders/mockups/calm/): after load the game is clean, as in a big
// console game; the instruments come back when the hand reaches for them, or when the boat needs them.
// Stage 2 of the cockpit (owner, 2026-11-06) makes it one model of presets, a fold and peeks:
//   Full         everything as before.
//   Calm         after CALM.idleS with no input the top bar and the bottom helm dashboard fade out (CALM.fadeMs); the skipper's
//                subtitle line stays. A mouse move brings the bar; the steering, trim and throttle keys, or the pointer on the
//                dashboard's area, bring the dashboard; a tap on a touch screen brings both.
//   Instruments  the two dials only, the cockpit folded away (the bar stays).
//   Clear        only the boat, the lake and the subtitle line (was Off); the corner mark opens the menu.
//   The fold     (Full and Calm, where a cockpit exists; owner 2026-11-12: two states only): the fold button (foldButton.js) or
//                H lowers the whole cockpit out of view in one 0.4 s eased slide: wheel, winches, panels and dials, with no
//                peek and no pucks left behind; the button again (or the bottom strip, or H) raises it all.
//   The helm     (fix/helm-view-cockpit, owner 2026-11-06: "two cockpits at once"): in the helm view the camera stands in the
//                boat's own cockpit, so the drawn one folds away as the tab folds it (and comes back as the camera leaves); the
//                real wheel, winches and sheet tail are the controls there (src/stations/sloop/helmPick.js), so no winch peek raises the
//                drawn one; the dials go to their pucks (Instruments: open). The player's own fold is kept apart (not saved).
//   The peeks    whatever is folded or faded, the boat's needs call single pieces back: a sail's winch while that sail luffs,
//                stalls or its sheet is let fly, both while the hint says ease, the chart dial while the sounder alarms, the
//                throttle while the engine runs; each leaves CALM.needHoldS after. A phone keeps its wheel faint (CALM.wheelFaint).
//   H            (a tap) is the fold button: lowers the cockpit or raises it (from Instruments or Clear: back to the base; with no
//                cockpit it still cycles the presets); held, it is still the keys list. The presets are Settings → Screen → HUD.
// Defaults: Calm in Sail and Cruise, Full in Regatta and School (racing and learning need the instruments). Settings →
// Screen → HUD keeps the player's pick (settings 'hud'; 'auto' is the default by mode; H writes it too); ?hud= wins for a page.
// The fold and the base are remembered (localStorage FOLD_KEY). Never on a capture: headless, ?shot= and ?gate= pages stay
// Full (the goldens hold).
//
//   const calm = createCalmHud({ services, settings, getOptions });   // shell.js; the 'calm' service; getOptions: the mode in force's options
//   calm.update(dt)                                        // each frame
//   calm.slotTargets                                       // { wheel, jib, main } the 3D objects' opacity (helmStation.js)
//   calm.cycle(); calm.tab(); calm.openDial('chart'|'wind')   // the presets' cycle, H and the fold button, a puck
//   calm.tapWoke()                                         // true once if the last touch only woke the HUD (no course set)
// CalmClock and the helpers are pure (tests/calmHud.test.mjs).
import { isCoarse } from './touchMap.js';
import { ensureTokens } from './tokens.js';
import { FLAGS } from '../sim/core/flags.js';

export const CALM = { idleS: 5, fadeMs: 600, needHoldS: 5, wheelFaint: 0.35, foldMs: 400, tapS: 0.35 };
export const HUD_MODES = ['full', 'calm', 'instruments', 'clear'];
const HUD_ALIAS = { off: 'clear' };   // the old name: saved settings and URLs keep working
const ONCE_KEY = 'lakeshore.calm.v1';
export const FOLD_KEY = 'lakeshore.hud.v2';   // { base, fold }: the preset H comes back to, and the cockpit's fold
export const LINE = { mouse: 'Move the mouse to show the helm', touch: 'Tap to show the helm' };
// the keys that bring the dashboard: the helm, the sheets (and the jib's own), the throttle
export const DASH_KEYS = new Set(['KeyA', 'KeyD', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyS', 'ArrowUp', 'ArrowDown', 'KeyR', 'KeyF',
  'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract', 'Digit0', 'KeyI', 'Space']);
const norm = (m) => HUD_ALIAS[m] ?? m;
const isBase = (m) => m === 'auto' || m === 'full' || m === 'calm';

// the mode in force: the URL's pick, then the setting, then the mode's default (its coreOptions' hud: Regatta 'full', the
// others 'calm')
export function hudFor({ setting = 'auto', modeHud = 'calm', url = null } = {}) {
  if (HUD_MODES.includes(norm(url))) return norm(url);
  if (HUD_MODES.includes(norm(setting))) return norm(setting);
  return HUD_MODES.includes(norm(modeHud)) ? norm(modeHud) : 'calm';
}
// H: the base (Full or Calm) → Instruments → Clear → the base again. base: the setting H came from ('auto' | 'full' | 'calm')
export const nextPreset = (mode, base = 'auto') => {
  const m = norm(mode);
  if (m === 'instruments') return 'clear';
  if (m === 'clear') return isBase(base) ? base : 'auto';
  return 'instruments';
};
// a capture never runs Calm: headless pages, pinned shots and the gate's frames (golden/frames.json)
export const calmAllowed = (flags) => !(flags.headless != null || flags.shot != null || flags.gate != null);

// The state machine. Times in seconds of play; wake(what) is an input, tick() the frame.
// fold: the cockpit folded by its tab (Full and Calm; foldable: only where a cockpit exists); open: a puck opened back to its dial
const NONE = () => ({ trim: false, jib: false, main: false, depth: false, thr: false });
export class CalmClock {
  constructor({ idleS = CALM.idleS, needHoldS = CALM.needHoldS, mode = 'calm', faintWheel = false, fold = false, foldable = true } = {}) {
    Object.assign(this, { idleS, needHoldS, mode: norm(mode), faintWheel, fold: !!fold, foldable, helm: false, shot: false });
    this.t = 0; this.barAt = 0; this.dashAt = 0; this.open = { chart: false, wind: false };
    this.needAt = { trim: -Infinity, jib: -Infinity, main: -Infinity, depth: -Infinity, thr: -Infinity };
  }
  setMode(m) { m = norm(m); if (!HUD_MODES.includes(m) || m === this.mode) return this.mode; this.mode = m; this.open = { chart: false, wind: false }; this.wake('all'); return m; }
  // the tab: the cockpit folded away (the dials to pucks), or back
  setFold(on) { this.fold = !!on; this.open = { chart: false, wind: false }; this.wake('all'); return this.fold; }
  openDial(side) { if (side in this.open) this.open[side] = true; }
  // 'bar' | 'dash' | 'all'
  wake(what = 'all') {
    if (what === 'bar' || what === 'all') this.barAt = this.t;
    if (what === 'dash' || what === 'all') this.dashAt = this.t;
  }
  // the cockpit is away: a folded preset, or the tab's fold in Full and Calm
  // helm: the helm view (the boat's own cockpit is on screen: the drawn one stays away)
  // shot: a scene's camera shot (the kayaks' notice shot, src/kayaks/notice.js): the drawn cockpit away while it runs (not saved)
  get folded() { return this.mode === 'instruments' || this.mode === 'clear' || ((this.fold || this.helm || this.shot) && this.foldable); }
  // busy: a menu, a page or a popover open, a drag held, the loading card: nothing fades. hoverBar / hoverDash: the
  // pointer rests there. needs: { trim, jib, main, depth, thr } conditions true now.
  tick(dt, { busy = false, hoverBar = false, hoverDash = false, needs = {} } = {}) {
    this.t += dt;
    if (busy) { this.barAt = this.t; this.dashAt = this.t; }
    if (hoverBar) this.barAt = this.t;
    if (hoverDash) this.dashAt = this.t;
    for (const k of Object.keys(this.needAt)) if (needs[k]) this.needAt[k] = this.t;
    return this.view;
  }
  // dials: { chart, wind }, each 'open' | 'puck' | 'off' (off: gone with the dashboard)
  get view() {
    const m = this.mode;
    const barCalm = this.t - this.barAt < this.idleS, dashCalm = this.t - this.dashAt < this.idleS;
    if (!this.folded) {
      if (m === 'full') return { bar: true, dash: true, need: { trim: true, jib: true, main: true, depth: true, thr: true }, anchor: false, wheel: 1, dials: { chart: 'open', wind: 'open' }, fold: false };
      const need = {}; for (const k of Object.keys(this.needAt)) need[k] = dashCalm || this.t - this.needAt[k] < this.needHoldS;
      return { bar: barCalm, dash: dashCalm, need, anchor: !barCalm, wheel: dashCalm ? 1 : this.faintWheel ? CALM.wheelFaint : 0,
        dials: { chart: dashCalm || need.depth ? 'open' : 'off', wind: dashCalm ? 'open' : 'off' }, fold: false };
    }
    // folded: only the peeks bring pieces back (the boat's needs, held needHoldS after)
    const need = NONE(); for (const k of Object.keys(this.needAt)) need[k] = this.t - this.needAt[k] < this.needHoldS;
    if ((this.helm || this.shot) && this.foldable) need.trim = need.jib = need.main = false;   // the real winches are in view: no drawn one peeks
    // the player's fold (the button or H, Full and Calm): the whole cockpit away, nothing peeks, no pucks (owner, 2026-11-12: "it fully
    // lower and disappear"); the sounder's alarm still sounds and the skipper still says it
    const away = this.fold && this.foldable && (m === 'full' || m === 'calm');
    if (away) Object.assign(need, NONE());
    const bar = m === 'clear' ? false : m === 'calm' ? barCalm : true;
    const dials = m === 'instruments' ? { chart: 'open', wind: 'open' } : m === 'clear' || away || (this.shot && this.foldable) ? { chart: 'off', wind: 'off' }   // (a shot: no pucks in its corners either)
      : { chart: this.open.chart ? 'open' : 'puck', wind: this.open.wind ? 'open' : 'puck' };
    if (need.depth) dials.chart = 'open';   // the safety peek: the sounder's alarm opens the chart (not in the player's fold: above)
    return { bar, dash: false, need, anchor: !bar, wheel: 0, dials, fold: true };
  }
}

// one value eased toward its target at a constant rate (the 3D slots fade as the DOM does); instant with reduced motion
export const approach = (v, target, dt, fadeS, instant = false) => {
  if (instant || !(fadeS > 0)) return target;
  const step = dt / fadeS;
  return v < target ? Math.min(target, v + step) : Math.max(target, v - step);
};

// smoothstep: eases in and out, never past its ends (the fold's slide has no bounce)
export const easeIO = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
// one value glided to its target, eased from where it stood when the target changed; the whole 0..1 span takes fadeS (shorter spans
// take their share, as approach() does); instant with reduced motion
export class Glide {
  constructor(v = 1) { this.v = v; this.from = v; this.to = v; this.p = 1; }
  step(to, dt, fadeS, instant = false) {
    if (instant || !(fadeS > 0)) { this.v = this.from = this.to = to; this.p = 1; return to; }
    if (to !== this.to) { this.from = this.v; this.to = to; this.p = 0; }
    const d = Math.abs(this.to - this.from);
    this.p = d < 1e-6 ? 1 : Math.min(1, this.p + dt / (fadeS * d));
    this.v = this.p >= 1 ? this.to : this.from + (this.to - this.from) * easeIO(this.p);
    return this.v;
  }
}

// the pucks' readings: HDG in whole degrees true (000–359), AWA in whole degrees with its side
export const puckText = ({ heading = 0, awa = 0 } = {}) => {
  const h = ((Math.round(heading * 180 / Math.PI) % 360) + 360) % 360, a = Math.round(awa * 180 / Math.PI);
  return { hdg: `${String(h).padStart(3, '0')}°`, awa: `${Math.abs(a)}°`, side: a === 0 ? '' : a < 0 ? 'P' : 'S' };
};

// the pieces: the top bar (every mode's one bar, a .lk-view), the
// bottom dashboard (Sail's helm station), and the ones that come back alone
const BAR = '.lk-view';
const DASH = '.lk-cv,.lk-chart,.lk-tackb,.lk-cp,.lk-cpx,.lk-thr,.lk-dock,.lk-tp,.lk-pro';
const HIDE = 'opacity:0!important;visibility:hidden!important;pointer-events:none!important;transition:opacity var(--lk-calm-fade) ease,visibility 0s linear var(--lk-calm-fade)!important';
const CSS = `
:root{--lk-calm-fade:${CALM.fadeMs}ms}
@media (prefers-reduced-motion:reduce){:root{--lk-calm-fade:0ms}}
html.lk-calm-bar ${BAR}{${HIDE}}
html.lk-calm-dash :is(.lk-tackb,.lk-cp,.lk-cpx,.lk-dock,.lk-tp,.lk-pro),
html.lk-calm-dash:not(.lk-dial-wind) .lk-cv,html.lk-puck-wind .lk-cv,
html.lk-calm-dash:not(.lk-calm-depth):not(.lk-dial-chart) .lk-chart,html.lk-puck-chart:not(.lk-calm-depth) .lk-chart,
html.lk-calm-dash:not(.lk-calm-thr) .lk-thr,
html.lk-calm-dash:not(.lk-calm-trim):not(.lk-calm-jib) .lk-helm>:is(.grp,.leaf,.tape,.ro)[data-w=jib],
html.lk-calm-dash:not(.lk-calm-trim):not(.lk-calm-main) .lk-helm>:is(.grp,.leaf,.tape,.ro)[data-w=main],
html.lk-calm-dash:not(.lk-calm-faint) .lk-helm>:is(.pad.wheel,.rd){${HIDE}}
/* the edge pair (edgeStyle.js; owner, 2026-11-12, decision 3): the key legend and the nav column fade with the dashboard,
   not the bar (the dials go, so do their numbers and the keys that explain them); folded (the helm view, Instruments, the tab) the dials
   stay as dials or pucks and so does the column; a block marked lk-wake-bar (the column in Cruise, which has no dashboard) wakes with the bar */
html.lk-calm-dash:not(.lk-folded) .lk-edgepair:not(.lk-wake-bar),html.lk-calm-bar .lk-edgepair.lk-wake-bar{${HIDE}}
button.lk-calm-mark{position:fixed;left:max(12px,var(--lk-sal,0px));top:max(10px,var(--lk-sat,0px));z-index:var(--lk-z-hud);display:grid;place-items:center;
  width:40px;height:40px;padding:0;border:0;background:none;color:rgb(var(--lk-cream));opacity:0;visibility:hidden;pointer-events:none;cursor:pointer;
  filter:drop-shadow(0 1px 3px rgb(0 0 0 / .55));transition:opacity var(--lk-calm-fade) ease,visibility 0s linear var(--lk-calm-fade)}
/* a phone: the top-right corner, clear of the bar's own ≡ at the top left */
:is([data-input=touch],[data-screen~=compact]) button.lk-calm-mark{left:auto;right:max(12px,var(--lk-sar,0px))}
button.lk-calm-mark svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round}
html.lk-calm-anchor button.lk-calm-mark{opacity:.35;visibility:visible;pointer-events:auto;transition:opacity var(--lk-calm-fade) ease,visibility 0s}
html.lk-calm-anchor button.lk-calm-mark:hover,html.lk-calm-anchor button.lk-calm-mark:focus-visible{opacity:.8}
/* the pucks (stage 2): a folded dial as a compact ring in its bottom corner, its key number; a click opens the dial */
button.lk-puck{all:unset;box-sizing:border-box;position:fixed;bottom:max(18px,var(--lk-sab,0px));z-index:var(--lk-z-hud);width:68px;height:68px;border-radius:50%;cursor:pointer;
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:rgb(var(--lk-cream));-webkit-tap-highlight-color:transparent;
  background:radial-gradient(circle at 50% 38%,rgb(var(--lk-brand-navy) / .78),rgb(var(--lk-brand-navy) / .92));-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);
  box-shadow:0 0 0 3px #C9CED4,0 0 0 4.5px #5E646C,0 8px 16px rgb(0 0 0 / .45);font:var(--lk-medium) 11px/1 var(--lk-ui);letter-spacing:.1em;
  opacity:0;visibility:hidden;pointer-events:none;transform:scale(.6);transition:opacity .3s var(--lk-ease),transform .3s var(--lk-ease),visibility 0s linear .3s}
button.lk-puck.chart{left:max(22px,var(--lk-sal,0px))}button.lk-puck.wind{right:max(22px,var(--lk-sar,0px))}
button.lk-puck b{font:700 17px/1 var(--lk-ui);letter-spacing:0;font-variant-numeric:tabular-nums}
button.lk-puck b i{font-style:normal;font-size:.62em;margin-left:2px;padding:1px 3px;border-radius:3px;background:rgb(var(--lk-port));color:rgb(var(--lk-brand-navy))}
button.lk-puck b i.s{background:rgb(var(--lk-stbd))}button.lk-puck b i:empty{display:none}
button.lk-puck:hover{box-shadow:0 0 0 3px #E4E7EA,0 0 0 4.5px #5E646C,0 8px 16px rgb(0 0 0 / .45)}
button.lk-puck:focus-visible{outline:2px solid rgb(var(--lk-amber) / .9);outline-offset:4px}
html.lk-puck-chart:not(.lk-calm-depth) button.lk-puck.chart,html.lk-puck-wind button.lk-puck.wind{opacity:1;visibility:visible;pointer-events:auto;transform:none;transition:opacity .3s var(--lk-ease),transform .3s var(--lk-ease),visibility 0s}
:root[data-lk-theme=night] button.lk-puck{color:rgb(255 140 120)}
:root[data-lk-theme=night] button.lk-puck b{color:rgb(var(--lk-amber));text-shadow:0 0 6px rgb(255 120 80 / .55)}
@media (prefers-reduced-motion:reduce){button.lk-puck{transition:none}}
`;
const MARK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14M5 12h14M5 16h9"/></svg>';

// quiet(): true while the one-time line would be stale (v2's upright-phone one-thumb controls never fade, so there is no helm to show)
export function createCalmHud({ services, settings = null, getOptions = () => services.get('modeOptions') ?? {}, flags = FLAGS, doc = document, storage = globalThis.localStorage ?? null, quiet = () => false, foldOnDown = false } = {}) {   // foldOnDown (v2): H only folds, on key-down (there is no H hold to wait out)
  ensureTokens();
  const H = doc.documentElement;
  const allowed = calmAllowed(flags);
  const urlHud = flags.hud;
  const once = flags.once;
  const coarse = () => (services.get('modality') ? !!services.get('modality').touch : isCoarse());   // before any input: the device profile's input (src/core/profile.js)
  // the remembered fold and base (never on a capture)
  let mem = { base: 'auto', fold: false };
  try { if (allowed) mem = { ...mem, ...(JSON.parse(storage?.getItem(FOLD_KEY) ?? '{}') ?? {}) }; } catch { /* blocked */ }
  if (!isBase(mem.base)) mem.base = 'auto';
  const remember = () => { try { if (allowed) storage?.setItem(FOLD_KEY, JSON.stringify(mem)); } catch { /* private mode */ } };
  const clock = new CalmClock({ mode: 'full', faintWheel: coarse(), fold: allowed && !!mem.fold, foldable: false });
  if (!doc.getElementById('lk-calm-css')) { const st = doc.createElement('style'); st.id = 'lk-calm-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const mark = doc.createElement('button'); mark.type = 'button'; mark.className = 'lk-calm-mark'; mark.setAttribute('aria-label', 'Menu (Esc)'); mark.innerHTML = MARK;
  doc.body.appendChild(mark);
  // the pucks
  const puck = {};
  for (const [side, word, label] of [['chart', 'HDG', 'heading: open the chart dial'], ['wind', 'AWA', 'apparent wind: open the wind dial']]) {
    const b = doc.createElement('button'); b.type = 'button'; b.className = `lk-puck ${side}`; b.setAttribute('aria-label', label);
    b.innerHTML = `<span>${word}</span><b><span class="n">—</span><i></i></b>`;
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); openDial(side); });
    doc.body.appendChild(b); puck[side] = b;
  }
  const reduced = () => !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // the one-time line (per player; ?once=0: per page)
  let told = false;
  try { told = once && !!JSON.parse(storage?.getItem(ONCE_KEY) ?? '{}')?.told; } catch { told = false; }
  const tell = () => {
    if (told || quiet() || services.get('controls')?.hint?.hushed || services.get('played')?.played) return; told = true;   // not while the player is Tessie (v2: her keys, no helm)   // hushed (the staged first visit): told on a later fade
    try { if (once) storage?.setItem(ONCE_KEY, JSON.stringify({ told: true })); } catch { /* private mode */ }
    const text = coarse() ? LINE.touch : LINE.mouse;
    if (services.get('controls')?.hint?.flash) services.get('controls').hint.flash(text, { secs: 5 });
    else services.get('cruiseLine')?.show?.(text, 5000);
  };

  // pick: H's choice on a page whose URL pins ?hud= (else H writes the setting, and the setting decides)
  let pick = null;
  const settingNow = () => settings?.get('hud') ?? 'auto';
  const modeNow = () => (allowed ? hudFor({ setting: settingNow(), modeHud: getOptions().hud, url: pick ?? urlHud }) : 'full');
  clock.setMode(modeNow());
  const setPreset = (next) => {
    if (!allowed) return clock.mode;
    if (urlHud != null || !settings) pick = next; else { settings.set('hud', next); pick = null; }
    clock.setMode(modeNow());
    return clock.mode;
  };
  // H: the next visible preset; leaving the base remembers it, coming back clears the fold (Full is the whole cockpit)
  function cycle() {
    if (!allowed) return clock.mode;
    const now = clock.mode;
    if (now === 'full' || now === 'calm') { const s = urlHud != null ? pick ?? now : settingNow(); mem.base = isBase(s) ? s : now; }
    const next = nextPreset(now, mem.base);
    if (isBase(next)) { clock.setFold(false); mem.fold = false; }
    remember();
    return setPreset(next);
  }
  // the fold tab: in Full and Calm it folds the cockpit or brings it back; in Instruments it brings the base back
  function tab() {
    if (!allowed) return false;
    if (clock.mode === 'instruments' || clock.mode === 'clear') { clock.setFold(false); mem.fold = false; remember(); setPreset(isBase(mem.base) ? mem.base : 'auto'); return false; }
    if (!clock.foldable) return false;
    mem.fold = clock.setFold(!clock.fold); remember();
    return mem.fold;
  }
  function openDial(side) { clock.openDial(side); dispatchEvent?.(new Event('lk-click')); }

  // ---- the inputs ----
  const off = new AbortController(), signal = off.signal;
  let pointer = null, held = 0, woke = false, hDownAt = -1;
  const hiddenNow = () => { const v = clock.view; return !v.bar || !v.dash; };
  const rectHit = (r, x, y, pad = 0) => !!r && r.width > 0 && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad;
  let zone = null, zoneAt = -1;
  // the dashboard's area: every bottom-half piece's box (hidden ones keep their boxes), padded
  const dashZone = () => {
    if (clock.t - zoneAt < 0.5 && zone) return zone;
    zoneAt = clock.t; let z = null;
    for (const n of doc.querySelectorAll(`${DASH},.lk-helm>*,.lk-chart .small`)) {
      // a screen-sized holder (the chart's own layer) is not a piece: its small dial is
      const r = n.getBoundingClientRect(); if (!(r.width > 0) || r.height > innerHeight * 0.6 || r.top + r.height / 2 < innerHeight / 2) continue;
      z = z ? { left: Math.min(z.left, r.left), top: Math.min(z.top, r.top), right: Math.max(z.right, r.right), bottom: Math.max(z.bottom, r.bottom), width: 1 } : { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: 1 };
    }
    return (zone = z);
  };
  const inDash = (x, y) => rectHit(dashZone(), x, y, 24);
  // the pointer resting on the bar, or on Cruise's strip, holds them up (every .lk-view: a live list, no query per frame)
  const bars = typeof doc.getElementsByClassName === 'function' ? doc.getElementsByClassName(BAR.slice(1)) : null;
  const inBar = (x, y) => {
    if (!bars) return rectHit(doc.querySelector(BAR)?.getBoundingClientRect(), x, y, 8);
    for (let i = 0; i < bars.length; i++) if (rectHit(bars[i].getBoundingClientRect(), x, y, 8)) return true;
    return false;
  };
  addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    pointer = [e.clientX, e.clientY];
    clock.wake('bar');
    if (inDash(e.clientX, e.clientY)) clock.wake('dash');
  }, { capture: true, passive: true, signal });
  addEventListener('pointerdown', (e) => {
    held++;
    if (e.target === mark || mark.contains(e.target)) return;   // the glyph opens the menu: no wake under it
    if (e.pointerType === 'touch') { woke = hiddenNow() && clock.mode === 'calm' && !e.target.closest?.('.lk-helm,.lk-hint,.lk-view'); clock.wake('all'); return; }
    clock.wake('bar');
    if (inDash(e.clientX, e.clientY)) clock.wake('dash');
  }, { capture: true, passive: true, signal });
  const up = () => { held = Math.max(0, held - 1); };
  addEventListener('pointerup', up, { capture: true, passive: true, signal });
  addEventListener('pointercancel', up, { capture: true, passive: true, signal });
  addEventListener('blur', () => { held = 0; hDownAt = -1; }, { signal });
  addEventListener('wheel', (e) => { if (inDash(e.clientX, e.clientY)) clock.wake('dash'); }, { capture: true, passive: true, signal });
  // H: a tap is the fold button (a hold is the keys list, controlsHint.js); only the player's own key (not the dock's or a pad's)
  const ownH = (e) => e.code === 'KeyH' && e.isTrusted !== false && !e.lkVirtual && !e.lkDock && !e.ctrlKey && !e.metaKey && !e.altKey;
  const fold = () => { if (!/^(INPUT|SELECT|TEXTAREA)$/.test(doc.activeElement?.tagName ?? '') && !services.get('menu')?.isOpen) { if (clock.foldable || clock.mode === 'instruments' || clock.mode === 'clear') tab(); else cycle(); } };
  addEventListener('keydown', (e) => {
    if (ownH(e) && !e.repeat) { if (foldOnDown) fold(); else hDownAt = e.timeStamp; }   // the key's own times (ms): a long frame does not turn a tap into a hold
    if (DASH_KEYS.has(e.code) && !e.ctrlKey && !e.metaKey) clock.wake('dash');
  }, { capture: true, signal });
  addEventListener('keyup', (e) => {
    if (foldOnDown || !ownH(e) || hDownAt < 0) return;
    const tap = e.timeStamp - hDownAt < CALM.tapS * 1000; hDownAt = -1;
    if (tap) fold();
  }, { capture: true, signal });
  mark.addEventListener('pointerdown', (e) => e.stopPropagation());
  mark.addEventListener('click', (e) => { e.stopPropagation(); services.get('menu')?.open?.(); });
  settings?.on?.((k) => { if (k === 'hud') { pick = null; clock.setMode(modeNow()); } });

  // ---- what keeps the HUD up, and what calls a piece back ----
  const loadingUp = () => { const l = doc.getElementById('lk-load'); return !!l && l.isConnected && l.dataset.state !== 'gone' && !H.classList.contains('lk-nol'); };
  // an open picker or panel: live collections (no selector match over the whole document each frame); the same test as
  // doc.querySelector('.lk-windpick:not([hidden]),.lk-sndpick:not([hidden]),.lk-tp.in,.lk-bf:not([hidden])')
  const live = typeof doc.getElementsByClassName === 'function';
  const PICK = live ? ['lk-windpick', 'lk-sndpick', 'lk-bf'].map((k) => doc.getElementsByClassName(k)) : [], TP = live ? doc.getElementsByClassName('lk-tp') : [];
  const openPicker = () => {
    if (!live) return !!doc.querySelector('.lk-windpick:not([hidden]),.lk-sndpick:not([hidden]),.lk-tp.in,.lk-bf:not([hidden])');   // a test DOM
    for (const list of PICK) for (let i = 0; i < list.length; i++) if (!list[i].hasAttribute('hidden')) return true;
    for (let i = 0; i < TP.length; i++) if (TP[i].classList.contains('in')) return true;
    return false;
  };
  const busy = () => loadingUp() || held > 0 || !!services.get('menu')?.isOpen || !!services.get('logbook')?.logbook?.isOpen || !!services.get('chart')?.chart?.toggle?.big || !!services.get('chart')?.chart?.toggle?.pinned
    || services.get('controls')?.hint?.current === 'keys' || !!services.get('controls')?.tools?.latched || (services.get('controls')?.tools?.bino?.k ?? 0) > 0.02
    || openPicker();
  const needsNow = () => {
    const c = services.get('controls'), s = services.get('player')?.phys?.state, st = services.get('station');
    const eng = services.get('player')?.phys?.engine;
    const shakes = (w) => st?.sails?.[w] === 'luff' || st?.sails?.[w] === 'stall' || !!st?.free?.[w];
    return {
      trim: c?.hint?.current === 'ease',   // overpowered, ease both sheets: both winches ('pull' is a shaking sail: its own)
      jib: shakes('jib'), main: shakes('main'),   // a luffing or stalled sail calls back its own winch only; a sheet let fly too
      depth: (s?.sounderLevel ?? 0) >= 1,
      thr: !!eng && (eng.state === 'running' || eng.state === 'cranking'),
    };
  };

  // ---- each frame ----
  // slots: what the 3D objects get, each glided to its target (eased: no bounce)
  const slots = { wheel: 1, jib: 1, main: 1 }, glide = { wheel: new Glide(), jib: new Glide(), main: new Glide() };
  let wasHidden = false, last = '', puckAt = -1, puckKey = '', foldUntil = -1;
  function update(dt) {
    clock.faintWheel = coarse();
    const st = services.get('station'); clock.foldable = !!st?.cockpit && st.el?.isConnected !== false;   // the fold is the desktop cockpit's (a phone keeps its own layout)
    clock.helm = !!st?.helmView;   // the helm view: the drawn cockpit away (see the head)
    clock.shot = !!services.get('kayaks')?.shotOn?.() || !!services.get('played')?.played;   // the kayaks' notice shot, and play as Tessie (v2): the drawn cockpit away while it runs
    const m = modeNow(); if (m !== clock.mode) clock.setMode(m);
    const xy = pointer;
    const v = clock.tick(dt, { busy: busy(), hoverBar: !!xy && inBar(xy[0], xy[1]), hoverDash: !!xy && inDash(xy[0], xy[1]), needs: needsNow() });
    const cls = { 'lk-calm-bar': !v.bar, 'lk-calm-dash': !v.dash, 'lk-calm-trim': v.need.trim, 'lk-calm-jib': v.need.jib, 'lk-calm-main': v.need.main, 'lk-calm-depth': v.need.depth, 'lk-calm-thr': v.need.thr,
      'lk-calm-faint': !v.dash && v.wheel > 0, 'lk-calm-anchor': v.anchor && !services.get('menu')?.isOpen,
      'lk-dial-chart': v.dials.chart === 'open', 'lk-dial-wind': v.dials.wind === 'open', 'lk-puck-chart': v.dials.chart === 'puck', 'lk-puck-wind': v.dials.wind === 'puck', 'lk-folded': v.fold,
      [`lk-hud-${clock.mode}`]: true };
    const key = Object.entries(cls).map(([k, on]) => (on ? k : '')).join();
    if (key !== last) { last = key; for (const p of HUD_MODES) if (p !== clock.mode) H.classList.remove(`lk-hud-${p}`); for (const [k, on] of Object.entries(cls)) H.classList.toggle(k, on); }
    // the pucks' numbers (4 Hz)
    if ((v.dials.chart === 'puck' || v.dials.wind === 'puck') && clock.t - puckAt > 0.25) {
      puckAt = clock.t;
      const s = services.get('player')?.phys?.state, p = puckText({ heading: s?.heading ?? 0, awa: s?.apparentWind?.angle ?? 0 });
      const k2 = `${p.hdg}|${p.awa}|${p.side}`;
      if (k2 !== puckKey) {
        puckKey = k2;
        puck.chart.querySelector('.n').textContent = p.hdg; puck.wind.querySelector('.n').textContent = p.awa;
        const i = puck.wind.querySelector('i'); i.textContent = p.side; i.className = p.side === 'S' ? 's' : '';
      }
    }
    // the 3D wheel and winches: their own opacity and the cockpit's sink, at the DOM's pace; a fold or a raise at its own (0.4 s), eased
    if (v.fold !== slots.fold) foldUntil = clock.t + CALM.foldMs / 1000;
    const fadeS = (clock.t < foldUntil ? CALM.foldMs : CALM.fadeMs) / 1000, instant = reduced();
    slots.fold = v.fold;
    slots.wheel = glide.wheel.step(v.wheel, dt, fadeS, instant);
    for (const w of ['jib', 'main']) slots[w] = glide[w].step(v.dash || v.need.trim || v.need[w] ? 1 : 0, dt, fadeS, instant);
    // the first time Calm takes the whole HUD away: the one-time line
    const hidden = !v.bar && !v.dash;
    if (hidden && !wasHidden && clock.mode === 'calm') tell();
    wasHidden = hidden;
  }

  return {
    clock, update, el: mark, pucks: puck, cycle, tab, openDial, setPreset,
    get mode() { return clock.mode; }, get view() { return clock.view; }, get slotTargets() { return slots; },
    get folded() { return clock.folded; }, get fold() { return clock.fold; }, get base() { return mem.base; },
    get told() { return told; },
    wake: (what) => clock.wake(what),
    tapWoke() { const w = woke; woke = false; return w; },
    dispose() { off.abort(); mark.remove(); puck.chart.remove(); puck.wind.remove(); for (const k of ['lk-calm-bar', 'lk-calm-dash', 'lk-calm-trim', 'lk-calm-jib', 'lk-calm-main', 'lk-calm-depth', 'lk-calm-thr', 'lk-calm-faint', 'lk-calm-anchor', 'lk-dial-chart', 'lk-dial-wind', 'lk-puck-chart', 'lk-puck-wind', 'lk-folded', ...HUD_MODES.map((m) => `lk-hud-${m}`)]) H.classList.remove(k); },
  };
}
