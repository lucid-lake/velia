// The new top bar (owner, 2026-11-15), the default since the owner's OK (2026-11-15); ?bar=old keeps today's bar
// for one release. It re-lays v1's bar
// (src/ui/viewSwitch.js, frozen) from the v2 side, as v2 patches v1 elsewhere: the same buttons and menus, moved and parked, never
// rewritten. Five things, left to right, by how often a player reaches for them:
//   Sail     Menu · Full │ Cruise ⇄ │ Boat | Helm │ Conditions ▾
//   Cruise   Menu · Full │ Sail ⇄ │ Boat ▾ │ Conditions ▾   (the camera on screen; Boat at the start, Cinematic last: owner 2026-11-15)
// The mode button (owner, 2026-11-18: Menu and Esc open the chart now, so the Chart button went) is labelled with where it takes you
// and switches in place (v2/ui/modeSwitch.js swap); in a race it is not shown.
// Parked (in the DOM, hidden, their keys and code untouched): Setup (the Menu card's Setup row), Music, Wind, Weather, the clock (all in
// the Conditions sheet now), Take the helm (the Menu card's Sail, A / D, the ` key) and the Locker (its rows: Chart on the bar, Glasses
// and Photo in Cruise's View menu, VHF in the sheet's Sound row, Logbook on the Menu card).
// The Conditions pill reads the world now, sky → water → ear ("18:50 ☁ · 16 kn S · ♪": the time, the weather beside it, the wind, the
// note only while music plays; no caret: the whole pill is the button) and opens one navy sheet in the same order:
// Time of day (the sun strip with the fireworks' marker at the show's time, one segmented bar Dawn · Midday · Golden · Night), Weather
// (Clear · Fair · Storm, one segmented bar), Wind (a compass dial of where it blows from, the four levels as one 2 × 2 group), Sound
// (play / pause, next, the volume across the rest of the row; Cruise's VHF at its end). Each header shows its value on the right.
// Every control calls the same api the old buttons called.
//
//   const bar = mountTopBar(viewSwitch, { mode: 'sail', chart: { go, lit }, hour, date, wind: () => ({ kn, fromDeg }), windPick,
//                                         weather, clockMenu, music: () => player, radio: { on, toggle } | null });
//   bar.update(dt) (wrapped into viewSwitch.update); bar.open() / bar.close() / bar.isOpen; bar.dispose()
// Pure parts (condWords, compass8, sunPoint, fwMark, SEG_NAMES): v2/tests/top-bar.test.mjs; the page: v2/tests/pages/topBar.page.mjs.
import { WEATHER_ICONS, WIND_LEVELS } from '../../src/ui/viewSwitch.js';
import { ICONS } from '../../src/ui/toolDock.js';
import { sharedTips } from '../../src/ui/tips.js';
import { shipClock } from '../../src/ui/shipClock.js';
import { parseV2Flags } from '../engine/flags.js';
import { setTouchLine, setHintLine } from '../../src/ui/controlsHint.js';
import { setTouchRow } from '../../src/ui/keysContent.js';
import { SHOW_START_HOUR } from '../../src/features/timeRows.js';

// the bar flag (v2/engine/flags.js): the new bar by default (owner, 2026-11-15); ?bar=old is the fallback to the old bar for one release
export const newBarOn = (search = globalThis.location?.search ?? '') => parseV2Flags(search).bar !== 'old';

export const BAR_ORDER = { sail: ['menu', 'fullscreen', 'mode', 'view', 'cond'], cruise: ['menu', 'fullscreen', 'mode', 'views', 'cond'] };
export const PARKED = ['settings', 'sound', 'wind', 'weather', 'clock', 'take', 'locker'];
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass8 = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
// the pill's words: the time (always), then the wind as a sailor says it ("15 kn SW": the speed and where it blows from)
export function condWords({ hour, date = null, kn = null, fromDeg = null } = {}) {
  const time = Number.isFinite(hour) ? shipClock({ hour, date }).time : '';
  const wind = Number.isFinite(kn) ? `${Math.round(kn)} kn${Number.isFinite(fromDeg) ? ` ${compass8(fromDeg)}` : ''}` : '';
  return { time, wind, label: `Conditions · ${[time, wind].filter(Boolean).join(' · ')}` };
}
// the sun strip: hour → a point on a 0–24 h strip, the sun's arc over a summer day at the lake (rise ≈ 05:35, set ≈ 20:30)
export const SUN = { rise: 5.6, set: 20.5 };
export function sunPoint(hour, { w = 280, h = 44, pad = 8 } = {}) {
  const hh = ((hour % 24) + 24) % 24, x = pad + (w - 2 * pad) * hh / 24;
  const day = (hh - SUN.rise) / (SUN.set - SUN.rise);
  const up = day >= 0 && day <= 1;
  const y = up ? h * 0.62 - h * 0.5 * Math.sin(Math.PI * day) : h * 0.62 + 6;
  return { x, y, up };
}

// the fireworks' marker on the strip: the show's clock time and where it sits (the strip's own 0–280 units; % of its width)
export function fwMark(hour = SHOW_START_HOUR, o = {}) {
  const m = Math.round(hour * 60), time = `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const { x } = sunPoint(hour, o);
  return { time, x, pct: 100 * x / (o.w ?? 280), label: `Fireworks ${time}` };
}
// the segments' words: short, so four sit as equal parts of one bar ("Golden hour" is "Golden" there; the time menu keeps its names)
export const SEG_NAMES = { golden: 'Golden' };

const svg = (ic, cls = '') => `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${ic}</svg>`;
// the swap glyph beside the word: two arrows, one each way
const SWAP = '<path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5"/>';
const NOTE = '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>';
const SI = { play: '<path d="M8 5.2v13.6l11-6.8Z"/>', pause: '<path d="M8.6 5.5v13M15.4 5.5v13"/>', next: '<path d="M5.5 5.5v13l9.5-6.5ZM18.4 5.5v13"/>',
  vol: '<path d="M4 9.6h3.4L12 5.6v12.8l-4.6-4H4Z"/><path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.8 6.8a7.4 7.4 0 0 1 0 10.4"/>', mute: '<path d="M4 9.6h3.4L12 5.6v12.8l-4.6-4H4Z"/><path d="M15.6 9.6l4.4 4.8M20 9.6l-4.4 4.8"/>', radio: ICONS.radio ?? '' };
const BURST = '<circle cx="12" cy="12" r="1.3"/><path d="M12 5.2v3.6M12 15.2v3.6M5.2 12h3.6M15.2 12h3.6M7.2 7.2l2.5 2.5M14.3 14.3l2.5 2.5M16.8 7.2l-2.5 2.5M9.7 14.3l-2.5 2.5"/>';

const CSS = `
.lk-view .nb-park{display:none!important}
/* an upright phone's two circles stand under the bar's foot, notch included (tokens.css put them at a fixed 66 px, so on a phone with a
   top inset the bar slid down over them; v1's helmStation sets these from its layout, v2's station does not) */
:root[data-screen~=portrait]:where([data-screen~=compact]).lk-cpanel .lk-chart .small{top:var(--lk-chart-t,var(--lk-cap-top,66px))}
:root[data-screen~=portrait]:where([data-screen~=compact]).lk-cpanel .lk-cv{top:var(--lk-dial-t,var(--lk-cap-top,66px))}
:root[data-screen~=portrait]:where([data-screen~=compact]).lk-cpanel .lk-hint{top:calc(var(--lk-circ-b,calc(var(--lk-cap-top,66px) + 114px)) + 8px)}   /* the skipper's line under them (180 px with no inset, as before) */
.lk-view.nb.sheet{z-index:var(--lk-z-page,12)}   /* the open sheet sits over the phone's trim and dock buttons */
.lk-view.nb .xt[data-x=cond]{gap:.45em;padding:0 .8em;background:rgb(255 255 255 / .08);box-shadow:inset 0 0 0 var(--lk-line) rgb(255 255 255 / .22)}
.lk-view.nb .xt[data-x=cond]:hover,.lk-view.nb .xt[data-x=cond][aria-expanded=true]{background:rgb(255 255 255 / .16)}
.lk-view.nb .xt[data-x=cond] .ct{font-weight:inherit;font-variant-numeric:tabular-nums}
.lk-view.nb .xt[data-x=cond] .w{font-variant-numeric:tabular-nums;opacity:.9;min-width:4.6em}
.lk-view.nb .xt[data-x=cond] .ns{display:inline-flex;align-items:center;gap:.45em;opacity:.9}
.lk-view.nb .xt[data-x=cond] .ns[hidden]{display:none}
.lk-view.nb .xt[data-x=cond] .nt{width:round(1.05em,1px);height:round(1.05em,1px)}
.lk-view.nb .xt[data-x=mode][hidden],.lk-view.nb .dv[hidden]{display:none!important}
.lk-view.nb .xt[data-x=mode] svg{width:1.15em;height:1.15em}
/* the sheet: four sections in the pill's order (sky → water → ear), one control style each, equal spacing, each header's value right */
.lk-cond{--hair:rgb(255 255 255 / .16);--edge:rgb(255 255 255 / .26);--seg-h:32px;
  position:absolute;top:calc(100% + .5em);z-index:8;box-sizing:border-box;width:min(392px,calc(100vw - 16px));max-height:calc(100dvh - var(--lk-edge-gap,12px) - 56px);overflow:auto;
  padding:14px 16px;border-radius:16px;background:rgb(var(--lk-brand-navy) / .94);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);
  border:var(--lk-line,1px) solid var(--lk-glass-edge);box-shadow:0 8px 28px rgb(0 0 0 / .4);color:var(--lk-chrome-ink,#fff);font:var(--lk-medium) var(--lk-fs-caption,13px)/1.25 var(--lk-ui);letter-spacing:var(--lk-track);
  pointer-events:auto;text-align:left;display:grid;grid-template-columns:minmax(0,1fr);gap:12px;align-content:start}
.lk-cond[hidden]{display:none}
.lk-cond section{display:grid;grid-template-columns:minmax(0,1fr);gap:8px;min-width:0;align-content:start}
.lk-cond section+section{border-top:var(--lk-line,1px) solid var(--hair);padding-top:12px}
.lk-cond h3{all:unset;display:flex;align-items:baseline;justify-content:space-between;gap:1em;min-width:0;font-size:.8em;letter-spacing:.14em;text-transform:uppercase}
.lk-cond h3>span{flex:none;opacity:.66}
.lk-cond h3 b{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:inherit;letter-spacing:var(--lk-track);text-transform:none;font-size:1.25em;font-variant-numeric:tabular-nums;opacity:.92}
.lk-cond button{all:unset;position:relative;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:.45em;min-height:var(--seg-h);padding:0 .75em;cursor:pointer;
  white-space:nowrap;touch-action:manipulation;-webkit-tap-highlight-color:transparent;transition:background-color .12s,color .12s}
.lk-cond button:hover{background:rgb(255 255 255 / .1)}
.lk-cond button:focus-visible{outline:2px solid var(--lk-chrome-ink,#fff);outline-offset:-2px}
.lk-cond button svg{width:17px;height:17px;flex:none;fill:none;stroke:currentColor;stroke-width:1.7px;stroke-linecap:round;stroke-linejoin:round}
/* the segmented bar: equal parts of one outlined bar, hairlines between; the lit part amber (the one state colour) */
.lk-cond .seg{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);border-radius:10px;box-shadow:inset 0 0 0 var(--lk-line,1px) var(--edge);overflow:hidden}
.lk-cond .seg button{padding:0 .4em;border-radius:0}
.lk-cond .seg button+button{box-shadow:inset var(--lk-line,1px) 0 0 var(--hair)}
.lk-cond .seg button.on,.lk-cond .seg button.on+button{box-shadow:none}
.lk-cond .seg button.on{color:rgb(var(--lk-amber));background:rgb(var(--lk-amber) / .12);box-shadow:inset 0 0 0 var(--lk-line,1px) rgb(var(--lk-amber) / .8)}
.lk-cond .seg button:first-child{border-radius:10px 0 0 10px}.lk-cond .seg button:last-child{border-radius:0 10px 10px 0}
.lk-cond .seg.g2{grid-auto-flow:row;grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.lk-cond .seg.g2 button{justify-content:flex-start;padding:0 .7em;box-shadow:none}
.lk-cond .seg.g2 button:nth-child(2){box-shadow:inset var(--lk-line,1px) 0 0 var(--hair)}
.lk-cond .seg.g2 button:nth-child(3){box-shadow:inset 0 var(--lk-line,1px) 0 var(--hair)}
.lk-cond .seg.g2 button:nth-child(4){box-shadow:inset var(--lk-line,1px) var(--lk-line,1px) 0 var(--hair)}
.lk-cond .seg.g2 button.on{box-shadow:inset 0 0 0 var(--lk-line,1px) rgb(var(--lk-amber) / .8)}
.lk-cond .seg.g2 button:nth-child(1){border-radius:10px 0 0 0}.lk-cond .seg.g2 button:nth-child(2){border-radius:0 10px 0 0}
.lk-cond .seg.g2 button:nth-child(3){border-radius:0 0 0 10px}.lk-cond .seg.g2 button:nth-child(4){border-radius:0 0 10px 0}
.lk-cond .seg.g2 b{font-weight:inherit;opacity:.7;font-variant-numeric:tabular-nums}
/* the sun strip, full width, and its lane: the fireworks' ✳ sits on the horizon at the show's time, "Fireworks 21:44" under it; during
   the show the ✳ and the words turn amber ("Fireworks now") and the ✳ breathes gently; a tap jumps to the show */
.lk-cond .sky{position:relative;padding-bottom:22px;color:var(--lk-chrome-ink,#fff)}
.lk-cond .strip{width:100%;height:auto;aspect-ratio:280/44;display:block;overflow:visible}
.lk-cond .strip .fwm{color:inherit;opacity:.9}
.lk-cond .sky.show .strip .fwm{color:rgb(var(--lk-amber));opacity:1;animation:lkcond-breathe 2.4s cubic-bezier(.4,0,.6,1) infinite}
@keyframes lkcond-breathe{50%{opacity:.45}}
@media (prefers-reduced-motion:reduce){.lk-cond .sky.show .strip .fwm{animation:none}}
.lk-cond .fw{position:absolute;bottom:0;right:2.86%;min-height:22px;padding:0 4px;border-radius:6px;font-size:.92em;opacity:.88}
.lk-cond .fw::after{content:'';position:absolute;inset:-26px -6px -4px}   /* the hit area reaches up over the ✳ */
.lk-cond .fw.on{color:rgb(var(--lk-amber));opacity:1}
.lk-cond .wind{display:grid;grid-template-columns:76px minmax(0,1fr);gap:14px;align-items:center}
.lk-cond .dial{width:76px;height:76px;display:block}
/* the sound row: play / pause, next, then the volume across the rest (Cruise: the VHF at its end) */
.lk-cond .snd{display:flex;align-items:center;gap:8px}
.lk-cond .snd .rb{width:var(--seg-h);min-width:var(--seg-h);padding:0;border-radius:50%;box-shadow:inset 0 0 0 var(--lk-line,1px) var(--edge)}
.lk-cond .snd .rb.mt.off{opacity:.6}
.lk-cond .snd .vhf{border-radius:999px;box-shadow:inset 0 0 0 var(--lk-line,1px) var(--edge);padding:0 .75em 0 .6em}
.lk-cond .snd .vhf.on{color:rgb(var(--lk-amber));background:rgb(var(--lk-amber) / .12);box-shadow:inset 0 0 0 var(--lk-line,1px) rgb(var(--lk-amber) / .8)}
.lk-cond input[type=range]{-webkit-appearance:none;appearance:none;flex:1;min-width:60px;width:auto;height:var(--seg-h);margin:0 4px;background:none;cursor:pointer;touch-action:none}
.lk-cond input[type=range]::-webkit-slider-runnable-track{height:2px;background:linear-gradient(90deg,var(--lk-chrome-ink,#fff) var(--v,100%),rgb(255 255 255 / .28) var(--v,100%))}
.lk-cond input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:14px;height:14px;margin-top:-6px;border-radius:50%;background:var(--lk-chrome-ink,#fff);border:0}
.lk-cond input[type=range]::-moz-range-track{height:2px;background:rgb(255 255 255 / .28)}
.lk-cond input[type=range]::-moz-range-progress{height:2px;background:var(--lk-chrome-ink,#fff)}
.lk-cond input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--lk-chrome-ink,#fff);border:0}
.lk-cond input[type=range]:focus-visible{outline:2px solid var(--lk-chrome-ink,#fff);outline-offset:2px}
:where(:root[data-f-finger-targets=on]) .lk-cond{--seg-h:44px}:where(:root[data-f-finger-targets=on]) .lk-cond .sky{padding-bottom:30px}:where(:root[data-f-finger-targets=on]) .lk-cond .fw{min-height:30px}:where(:root[data-f-finger-targets=on]) .lk-cond .fw::after{inset:-30px -8px -4px}
/* a short window (a sideways phone, 390 px tall): two columns, the sky (time, weather) | the water and the ear (wind, sound), so the
   sheet never scrolls; the wind's ranges go (the levels' names stay) */
@media (max-height:520px) and (min-width:600px){
  .lk-cond{--seg-h:36px;width:min(660px,calc(100vw - 16px));grid-template-columns:minmax(0,1fr) minmax(0,1fr);grid-template-rows:auto 1fr;grid-auto-flow:column;column-gap:22px;row-gap:10px;padding:10px 14px}
  .lk-cond section+section{border-top:0;padding-top:0}
  .lk-cond section[data-s=wind]{align-content:space-between}   /* the 2 × 2 group's foot on the time bar's foot */
  .lk-cond section[data-s=weather],.lk-cond section[data-s=sound]{border-top:var(--lk-line,1px) solid var(--hair);padding-top:10px}
  .lk-cond section[data-s=time],.lk-cond section[data-s=weather]{position:relative}
  .lk-cond section[data-s=time]::after,.lk-cond section[data-s=weather]::after{content:'';position:absolute;top:0;bottom:0;right:-11px;border-right:var(--lk-line,1px) solid var(--hair)}
  .lk-cond section[data-s=weather]::after{top:10px}
  .lk-cond .seg.g2 b{display:none}.lk-cond .dial{width:64px;height:64px}.lk-cond .wind{grid-template-columns:64px minmax(0,1fr);gap:12px}
  .lk-cond .sky{padding-bottom:26px}.lk-cond .fw{min-height:26px}}
`;

let mounts = 0;
const wxRows0 = (weather) => (weather?.rows ?? []).length;

export function mountTopBar(vs, { mode = 'sail', swap = null, hour = () => null, date = () => null, wind = () => null, windPick = null, weather = null,
  clockMenu = null, music = () => null, radio = null, sound = null, doc = globalThis.document } = {}) {   // sound: { muted, toggle } | null: the sheet's sound on/off (M went)
  const el = vs.el, lay = el.querySelector('.lay.full');
  if (!doc.getElementById('lk-topbar-css')) { const st = doc.createElement('style'); st.id = 'lk-topbar-css'; st.textContent = CSS; doc.head.appendChild(st); }
  el.classList.add('nb'); el.dataset.bar = 'new';
  // the touch lines that named v1's bar ("Tap Wind, top bar", "Tap the chart, top right") say where this bar has them (audit 2026-11-15)
  setTouchLine('wind', 'Want a different breeze? Tap the weather and time, top bar');
  setHintLine('wind', 'Want a different breeze? Open the weather and time, top bar');   // no 1–4 keys any more
  setTouchLine('chart', 'Lost? Tap Menu, top bar');   // Menu opens the chart (owner, 2026-11-18)
  setTouchRow('Chart', 'tap Menu on the top bar');
  const q = (s) => lay.querySelector(s);
  const park = doc.createElement('div'); park.className = 'nb-park'; park.setAttribute('aria-hidden', 'true'); el.appendChild(park);
  // the old buttons that leave the bar: parked, so their own code (the clock's ticks, the music's song caption) runs on unseen
  const old = { settings: q('.xt[data-x=settings]'), sound: q('.mus'), wind: q('.xt[data-x=wind]'), weather: q('.xt[data-x=weather]'),
    clock: q('.clk'), clockDv: q('.clkdv'), take: q('.xt[data-x=take]'), locker: q('.xt[data-x=locker]') };
  for (const n of Object.values(old)) if (n) { park.appendChild(n); for (const b of n.matches?.('button') ? [n] : n.querySelectorAll('button')) b.tabIndex = -1; }
  for (const d of [...lay.querySelectorAll('.dv')]) d.remove();
  const menuBtn = q('.mn'), fsBtn = q('.xt[data-x=fullscreen]'), where = q('.pill') ?? q('.xt[data-x=views]');
  const mk = (html) => { const t = doc.createElement('span'); t.innerHTML = html; return t.firstElementChild; };
  const dv = () => mk('<span class="dv"></span>');
  // the mode button: the word is where it takes you ("Cruise" in Sail, "Sail" in Cruise), a swap glyph beside it (no key: ` went)
  const modeBtn = mk(`<button type="button" class="xt" data-x="mode" aria-label="Switch to Cruise">${svg(SWAP)}<span class="w">Cruise</span></button>`);
  const modeDv = dv();
  // sky → water → ear: the time, the weather beside it, the wind, the note only while music plays; no caret (the pill is the button,
  // aria-expanded says the sheet is open)
  const condBtn = mk(`<button type="button" class="xt" data-x="cond" aria-haspopup="dialog" aria-expanded="false" aria-label="Conditions"><b class="ct"></b>${svg(WEATHER_ICONS.fair, 'wx')}<span class="w"></span><span class="ns" hidden>·${svg(NOTE, 'nt')}</span></button>`);
  if (!wxRows0(weather)) condBtn.querySelector('.wx').style.display = 'none';   // no Weather rows (a phone, owner 2026-11-21): no sky icon in the pill
  // Menu · Full │ Chart │ the view │ Conditions
  const order = [menuBtn, fsBtn, ...(swap ? [modeDv, modeBtn] : []), ...(where ? [dv(), where] : []), dv(), condBtn].filter(Boolean);
  for (const n of order) lay.appendChild(n);
  const tips = sharedTips(doc);
  for (const b of [modeBtn, condBtn]) tips.add(b, { side: 'down' });
  const eaten = (b) => !!tips.consumed?.(b);
  modeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  modeBtn.addEventListener('click', (e) => { e.stopPropagation(); if (eaten(modeBtn)) return; close(); swap?.go?.(); modeBtn.blur(); });
  for (const ev of ['pointerenter', 'focus', 'touchstart']) modeBtn.addEventListener(ev, () => swap?.warm?.(), { passive: true, once: true });   // Cruise's chunk and lake load before the press
  let modeKey = '';
  const paintMode = () => {
    if (!swap) return;
    const show = swap.show ? !!swap.show() : true, to = swap.to?.() ?? 'cruise', k = `${show}|${to}`;
    if (k === modeKey) return;
    modeKey = k;
    const name = to === 'sail' ? 'Sail' : 'Cruise';
    modeBtn.hidden = modeDv.hidden = !show;   // a race: not shown
    modeBtn.querySelector('.w').textContent = name;
    modeBtn.setAttribute('aria-label', `Switch to ${name}`); modeBtn.dataset.tip = `Switch to ${name}, same boat, same place`; modeBtn.dataset.to = to;
  };

  // ---- the sheet ----
  const sheet = doc.createElement('div'); sheet.className = 'lk-cond'; sheet.hidden = true;
  sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Conditions');
  const timeRows = clockMenu?.rows ?? [], wxRows = weather?.rows ?? [];
  const hourRows = timeRows.filter((r) => r.id !== 'fireworks'), fw = timeRows.some((r) => r.id === 'fireworks') ? fwMark() : null;
  const radio_ = (attrs, inner) => `<button type="button" role="radio" aria-checked="false" ${attrs}>${inner}</button>`;
  sheet.innerHTML = `
    <section data-s="time"><h3><span>Time of day</span> <b class="tnow"></b></h3>
      <div class="sky"><svg class="strip" viewBox="0 0 280 44" aria-hidden="true"></svg>${fw ? `<button type="button" class="fw" data-t="fireworks" aria-label="Jump to the fireworks, ${fw.time}" data-tip="Jump to the fireworks">${fw.label}</button>` : ''}</div>
      <div class="seg" role="radiogroup" aria-label="Time of day">${hourRows.map((r) => radio_(`data-t="${r.id}" aria-label="${r.name}"`, SEG_NAMES[r.id] ?? r.name)).join('')}</div></section>
    ${wxRows.length ? `<section data-s="weather"><h3><span>Weather</span> <b class="xnow"></b></h3>
      <div class="seg" role="radiogroup" aria-label="Weather">${wxRows.map((r) => radio_(`data-w="${r.id}"`, `${svg(WEATHER_ICONS[r.id] ?? '')}${r.name}`)).join('')}</div></section>` : ''}
    <section data-s="wind"><h3><span>Wind</span> <b class="wnow"></b></h3>
      <div class="wind"><svg class="dial" viewBox="0 0 76 76" aria-hidden="true"></svg>
      <div class="seg g2" role="radiogroup" aria-label="Wind">${WIND_LEVELS.map((l, i) => radio_(`data-l="${i + 1}" aria-label="Wind ${i + 1} · ${l.name}, ${l.range}"`, `${l.name} <b>${l.range.replace(' kn', '')}</b>`)).join('')}</div></div></section>
    <section data-s="sound"><h3><span>Sound</span> <b class="snow"></b></h3>
      <div class="snd">
        ${sound ? `<button type="button" class="rb mt" role="switch" aria-checked="true" aria-label="sound on or off">${svg(SI.vol)}</button>` : ''}
        <button type="button" class="rb pp" aria-label="pause music">${svg(SI.pause)}</button>
        <button type="button" class="rb nx" aria-label="next song (])">${svg(SI.next)}</button>
        <input type="range" min="0" max="100" step="1" value="100" aria-label="music volume">
        ${radio ? `<button type="button" class="vhf" role="switch" aria-checked="false" aria-label="VHF weather forecast">${svg(SI.radio)}VHF</button>` : ''}</div></section>`;
  el.appendChild(sheet);
  const $ = (s) => sheet.querySelector(s), $$ = (s) => [...sheet.querySelectorAll(s)];
  const fwBtn = $('.fw'), skyEl = $('.sky');
  if (fwBtn) tips.add(fwBtn, { side: 'down' });
  for (const ev of ['pointerdown', 'wheel']) sheet.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  sheet.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'Enter') e.stopPropagation();   // the sheet's own, not the boat's (Space tacks)
    if (/^Arrow/.test(e.code) && e.target.closest?.('[role=radiogroup]')) {   // arrows move inside a group, as a radio group does
      const g = [...e.target.closest('[role=radiogroup]').querySelectorAll('button')], i = g.indexOf(e.target);
      const d = e.code === 'ArrowRight' || e.code === 'ArrowDown' ? 1 : -1;
      g[(i + d + g.length) % g.length]?.focus(); e.preventDefault(); e.stopPropagation();
    }
  });
  // a jump (the four hours, or the show from the strip's ✳: a short fade to dark, the clock set straight there, the fade back in; the ✳
  // closes the sheet; no beacon; the boat, the helm and the camera stay: v2/ui/dayClock.js)
  for (const b of $$('[data-t]')) b.addEventListener('click', (e) => { e.stopPropagation(); if (b === fwBtn && eaten(b)) return; clockMenu?.pick?.(b.dataset.t); if (b.dataset.t === 'fireworks') close(); else paint(true); });
  for (const b of $$('[data-l]')) b.addEventListener('click', (e) => { e.stopPropagation(); windPick?.set?.(+b.dataset.l); paint(true); });
  for (const b of $$('[data-w]')) b.addEventListener('click', (e) => { e.stopPropagation(); weather?.pick?.(b.dataset.w); paint(true); });
  $('.pp').addEventListener('click', (e) => { e.stopPropagation(); music()?.toggle?.(); paint(true); });
  $('.nx').addEventListener('click', (e) => { e.stopPropagation(); const m = music(); if (!m) return; if (m.off) m.turnOn?.(); m.next?.(); paint(true); });
  const vol = $('input[type=range]'), paintVol = () => vol.style.setProperty('--v', `${vol.value}%`);
  vol.addEventListener('input', () => { music()?.setVolume?.(vol.value / 100); paintVol(); });
  $('.vhf')?.addEventListener('click', (e) => { e.stopPropagation(); radio?.toggle?.(); paint(true); });
  $('.mt')?.addEventListener('click', (e) => { e.stopPropagation(); sound?.toggle?.(); paint(true); });

  // the strip: night, a dawn and a dusk glow, the sun's arc, the cut hours as ticks, the sun (or the moon) now
  const strip = $('.strip');
  const gid = `lkcond-sky-${++mounts}`;   // one id per sheet: Sail's and Cruise's sheets share the page, and a url(#id) into the hidden one paints nothing
  const arc = Array.from({ length: 49 }, (_, i) => { const p = sunPoint(SUN.rise + (SUN.set - SUN.rise) * i / 48); return `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`; }).join('');
  const hz = sunPoint(12).y + 0, base = 44 * 0.62;
  const ticks = [5.6, 13, 19.25, 22.5].map((h) => sunPoint(h).x);
  strip.innerHTML = `<defs><linearGradient id="${gid}" x1="0" x2="1"><stop offset="0" stop-color="rgb(255 255 255 / .04)"/><stop offset="${(SUN.rise / 24).toFixed(3)}" stop-color="rgb(255 255 255 / .04)"/>`
    + `<stop offset="${((SUN.rise + 2) / 24).toFixed(3)}" stop-color="rgb(255 255 255 / .14)"/><stop offset="${((SUN.set - 2) / 24).toFixed(3)}" stop-color="rgb(255 255 255 / .14)"/>`
    + `<stop offset="${(SUN.set / 24).toFixed(3)}" stop-color="rgb(255 255 255 / .04)"/><stop offset="1" stop-color="rgb(255 255 255 / .04)"/></linearGradient></defs>`
    + `<rect x="8" y="2" width="264" height="${(base - 2).toFixed(1)}" rx="6" fill="url(#${gid})"/>`
    + `<path d="M8 ${base.toFixed(1)}H272" stroke="rgb(255 255 255 / .4)" stroke-width="1"/>`
    + `<path d="${arc}" fill="none" stroke="rgb(255 255 255 / .35)" stroke-width="1" stroke-dasharray="2 3"/>`
    + ticks.map((x) => `<path d="M${x.toFixed(1)} ${(base - 3).toFixed(1)}v6" stroke="rgb(255 255 255 / .5)" stroke-width="1"/>`).join('')
    + ['00', '06', '12', '18', '24'].map((t, i) => `<text x="${(8 + 264 * i / 4).toFixed(1)}" y="42" font-size="7.5" fill="rgb(255 255 255 / .55)" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${t}</text>`).join('')
    + (fw ? `<g class="fwm" transform="translate(${(fw.x - 6).toFixed(1)} ${(base - 6).toFixed(1)}) scale(.5)" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="5.5" fill="rgb(var(--lk-brand-navy))" stroke="none"/>${BURST}</g>` : '')
    + '<g class="now"></g>';
  void hz;
  const nowG = strip.querySelector('.now');
  // the dial: a compass ring, N at the top, eight ticks, the arrow from where the wind blows toward the centre
  const dial = $('.dial');
  dial.innerHTML = '<circle cx="38" cy="38" r="33" fill="rgb(255 255 255 / .05)" stroke="rgb(255 255 255 / .35)" stroke-width="1"/>'
    + Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4, r0 = i % 2 ? 30 : 27; return `<path d="M${(38 + Math.sin(a) * r0).toFixed(1)} ${(38 - Math.cos(a) * r0).toFixed(1)}L${(38 + Math.sin(a) * 33).toFixed(1)} ${(38 - Math.cos(a) * 33).toFixed(1)}" stroke="rgb(255 255 255 / .55)" stroke-width="1"/>`; }).join('')
    + '<text x="38" y="20" font-size="9" text-anchor="middle" fill="rgb(255 255 255 / .8)">N</text>'
    + '<g class="arw"><path d="M38 9v40" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M32.5 43 38 51l5.5-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><circle cx="38" cy="9" r="2.2" fill="currentColor"/></g>'
    + '';
  const arw = dial.querySelector('.arw');

  // ---- painting: the pill each frame (text only on a change), the sheet while open ----
  let key = '', sheetKey = '', acc = 1;
  function paint(force = false) {
    const w = wind?.() ?? null, hr = hour?.(), d = date?.();
    const cw = condWords({ hour: hr, date: d, kn: w?.kn, fromDeg: w?.fromDeg });
    const wx = weather?.current?.() ?? 'fair', m = music?.(), playing = !!m && !m.paused && !m.off;
    const k = `${cw.time}|${cw.wind}|${wx}|${playing}`;
    if (k !== key || force) {
      key = k;
      condBtn.querySelector('.wx').innerHTML = WEATHER_ICONS[wx] ?? WEATHER_ICONS.fair;
      condBtn.querySelector('.ct').textContent = cw.time;
      condBtn.querySelector('.w').textContent = cw.wind ? `· ${cw.wind}` : '';
      condBtn.querySelector('.ns').hidden = !playing;
      const wxName = !wxRows.length ? '' : wxRows.find((r) => r.id === wx)?.name ?? (wx ? wx[0].toUpperCase() + wx.slice(1) : '');
      const label = `${cw.label}${wxName ? ` · ${wxName}` : ''}${m ? ` · music ${playing ? 'on' : 'paused'}` : ''}`;
      condBtn.setAttribute('aria-label', label); condBtn.dataset.tip = label;
    }
    paintMode();
    if (sheet.hidden) return;
    const lv = windPick?.level?.() ?? null, tnow = clockMenu?.current?.() ?? null;
    const sk = `${k}|${lv}|${tnow}|${m?.title}|${radio?.on?.()}|${Math.round(w?.fromDeg ?? 0)}`;
    if (sk === sheetKey && !force) return;
    sheetKey = sk;
    $('.tnow').textContent = cw.time;
    for (const b of $$('[data-t]')) { const on = b.dataset.t === tnow; b.classList.toggle('on', on); if (b !== fwBtn) b.setAttribute('aria-checked', String(on)); }
    if (fwBtn) { const show = tnow === 'fireworks'; skyEl.classList.toggle('show', show); fwBtn.textContent = show ? 'Fireworks now' : fw.label; }
    if (fwBtn && tnow === 'fireworks') nowG.innerHTML = '';   // in the show the lit ✳ is the time now (the moon sat on it)
    else if (Number.isFinite(hr)) {
      const p = sunPoint(hr);
      nowG.innerHTML = p.up ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="rgb(var(--lk-cream, 255 248 230))" />`
        : `<path d="M${(p.x + 2).toFixed(1)} ${(p.y - 5).toFixed(1)}a5 5 0 1 0 3.6 8.4 4 4 0 0 1-3.6-8.4Z" fill="rgb(var(--lk-cream, 255 248 230) / .85)"/>`;
    }
    $('.wnow').textContent = cw.wind ? `${cw.wind.replace(/ (\w+)$/, ' from $1')}` : '';
    if (Number.isFinite(w?.fromDeg)) arw.setAttribute('transform', `rotate(${w.fromDeg.toFixed(1)} 38 38)`);
    for (const b of $$('[data-l]')) { const on = +b.dataset.l === lv; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    const wxName = wxRows.find((r) => r.id === wx)?.name ?? '';
    const xn = $('.xnow'); if (xn) xn.textContent = wxName;   // no Weather section on a phone
    for (const b of $$('[data-w]')) { const on = b.dataset.w === wx; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
    $('.snow').textContent = m?.title || (m ? '' : 'The lake'); $('.snow').title = m?.title ?? '';
    const pp = $('.pp'), paused = !playing; pp.innerHTML = svg(paused ? SI.play : SI.pause); pp.setAttribute('aria-label', paused ? 'play music' : 'pause music');
    const mt = $('.mt'); if (mt) { const on = !sound.muted(); mt.setAttribute('aria-checked', String(on)); mt.classList.toggle('off', !on); mt.innerHTML = svg(on ? SI.vol : SI.mute); }
    const vhf = $('.vhf'); if (vhf) { const on = !!radio.on(); vhf.classList.toggle('on', on); vhf.setAttribute('aria-checked', String(on)); }
  }
  const place = () => {
    const br = condBtn.getBoundingClientRect(), vw = doc.documentElement.clientWidth, w = sheet.offsetWidth;
    sheet.style.left = `${Math.round(Math.max(8, Math.min(vw - w - 8, br.right - w)))}px`;   // right edge under the pill's, never off screen
  };
  function open({ focus = false } = {}) {
    if (!sheet.hidden) return;
    sheet.hidden = false; condBtn.setAttribute('aria-expanded', 'true'); el.classList.add('sheet');
    const m = music?.(); vol.value = String(Math.round(100 * (Number.isFinite(m?.volume) ? m.volume : +vol.value / 100))); paintVol();
    paint(true); place();
    if (focus) (sheet.querySelector('button.on') ?? sheet.querySelector('button'))?.focus();
  }
  function close({ refocus = false } = {}) {
    if (sheet.hidden) return;
    sheet.hidden = true; condBtn.setAttribute('aria-expanded', 'false'); el.classList.remove('sheet');
    if (refocus) condBtn.focus();
  }
  condBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  condBtn.addEventListener('click', (e) => { e.stopPropagation(); if (eaten(condBtn)) return; if (sheet.hidden) open({ focus: e.detail === 0 }); else close(); if (e.detail > 0) condBtn.blur(); });
  const onDown = (e) => { if (!sheet.hidden && !sheet.contains(e.target) && !condBtn.contains(e.target)) close(); };
  const onKey = (e) => { if (e.code === 'Escape' && !sheet.hidden) { close({ refocus: sheet.contains(doc.activeElement) }); e.stopImmediatePropagation(); e.preventDefault(); } };
  addEventListener('pointerdown', onDown, true);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', () => { if (!sheet.hidden) place(); });
  // the music's song caption belongs to the parked segment now: it never squeezes the bar (no .tight, no .song on the bar)
  const unsqueeze = () => {
    if (el.classList.contains('tight') || el.classList.contains('song')) { el.classList.remove('tight', 'song'); for (const n of lay.children) { n.style.width = ''; n.style.flexShrink = ''; } }
  };
  const update0 = vs.update;
  const bar = {
    el: sheet, pill: condBtn, mode: modeBtn, order: () => [...lay.children].filter((n) => n.matches('button,.pill')).map((n) => n.dataset.x ?? (n.classList.contains('pill') ? 'view' : n.classList.contains('mn') ? 'menu' : '?')),
    open, close, get isOpen() { return !sheet.hidden; }, paint,
    update(dt) {
      unsqueeze();
      if (el.classList.contains('off')) close();
      acc += dt; if (acc >= 0.25 || !sheet.hidden) { acc = 0; paint(); }   // the pill's words four times a second (the minute and the knots)
    },
    dispose() { removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey, true); sheet.remove(); park.remove(); tips.forget?.(modeBtn); tips.forget?.(condBtn); },
  };
  vs.update = (dt) => { update0(dt); bar.update(dt); };
  vs.topBar = bar;
  paint(true);
  dispatchEvent(new Event('resize'));   // the bar measures itself again (its words, its width)
  return bar;
}
