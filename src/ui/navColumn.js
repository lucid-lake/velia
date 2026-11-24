// The nav column (owner go 2026-11-12 with every default): the left edge's mirror of the key legend. It prints what the
// two coaming dials lack (the chart dial has HDG · SOG · DPT, the wind dial AWA · AWS): COG, TWS, TWA, VMG, HEEL (+ RUD in Pro and
// Regatta), and the passage block (MARK, DTW, BTW, TTG, XTE; the passage service, passage.js). Same stylesheet as the legend
// (edgeStyle.js): the left margin, the one foot, the 36 px row, 15 px tracked caps, the navy shadow, the 400 ms fade. Mirrored:
// the label is outer, the number inner (the object faces the centre on both edges).
// It speaks only when it has something to say (owner, 2026-11-12: "regular people should not always look at it"): by default
// (setting 'auto') the passage block shows only while a mark or route is set, and the instrument rows only with Pro on and in
// Regatta; a regular player with no mark sees an empty left edge. Setup › Aids › edge instruments: auto | always | off.
// Labels at 60 % (the legend's words too, so the pair stays matched), numbers at 84 % (--lk-ink-soft; the floor is 80 %).
// Presence is not mirrored either: numbers are not hints, so the column never learns away; it stays in the helm view and in
// Instruments (the dials stay there too); it fades with the Calm HUD's dashboard (calmHud.js) like the legend.
// Numbers never jitter: tabular digits, a hidden ghost of each row's widest reading, smoothing in the data (never a CSS
// transition on a number) and a half-step-plus-0.2 hysteresis on the whole-degree rows.
//
//   NAV                                   the numbers: rows, gaps, sampling, smoothing, hysteresis
//   ROWS                                  { id: { label, unit, ghost } }
//   holdRound(prev, v, circular)          pure: the shown whole number with hysteresis
//   createReadings()                      pure: .step(input, dt) -> the smoothed, held readings (input from the boat's state)
//   createPassageReadings()               pure: .step(passageTo(...), dt) -> DTW, BTW (held), TTG (10 s EMA), XTE
//   fmt(id, readings)                     pure: { num, unit, side } strings for a row
//   rowsFor({ mode, readings, passage, pro, height, phone }) pure: the row ids, top to bottom ('gap' between groups), under the height budget
//   visibleColumn(facts)                  pure: should the column be on screen
//   footPx(h)                             the foot's height above the bottom (--lk-my + 12 vh) at a window height
//   createNavColumn({ services, settings, getMode, doc, win })   shell.js; .update() each frame, .dispose()
import { ensureTokens } from './tokens.js';
import { ensureEdgeStyle, EDGE } from './edgeStyle.js';
import { FLAGS } from '../sim/core/flags.js';
import { passageTo, ttgText, dtwText } from './passage.js';

const KN = 0.514444;   // m/s per knot
const DEG = 180 / Math.PI;
export const NAV = {
  rowPx: EDGE.rowPx, gapPx: 12,       // a reading's row; the gap row between groups
  topReservePx: 140,                  // the top bar and the skipper's line stay clear
  sampleS: 0.25,                      // the readings refresh 4 times a second
  passageS: 1,                        // the passage block refreshes once a second
  emaS: { tws: 1, vmg: 1, heel: 0.5, ttg: 10 },   // smoothing time constants (s)
  dropFirst: ['xte', 'btw'],   // a short window drops these passage rows first, in this order (never the readings)
  hyst: 0.2,                          // a whole-degree row flips only past the half step + 0.2
  phone: { top: 222, landFoot: 150 },  // px: upright, the column's top (under the circle, y 66-179, and the line, y 190-213 at 412 x 915);
                                       // sideways, its foot above the bottom (the chart dial's top at about 253 of 390, + 12 px clear)
};
// the rows (marine labels); ghost: the widest reading the number box keeps room for, so a 9 -> 10 step moves
// nothing. The six share one box ('888': 3 tabular digits; a speed is '9.4' or '12'), so their numbers right-align on one edge
// and their units stand in one column, as on a real instrument stack.
export const ROWS = {
  cog: { label: 'COG', unit: '°', ghost: '888' },
  tws: { label: 'TWS', unit: 'kn', ghost: '888' },
  twa: { label: 'TWA', unit: '°', ghost: '888' },
  vmg: { label: 'VMG', unit: 'kn', ghost: '888' },
  heel: { label: 'HEEL', unit: '°', ghost: '888' },
  rud: { label: 'RUD', unit: '°', ghost: '888' },
  // the passage block (DTW '12.3' and XTE '0.02' keep their own, wider box). No ETA row (owner, 2026-11-12): the bar's clock
  // already shows game time, and TTG says how long
  dtw: { label: 'DTW', unit: 'nm', ghost: '88.8' },
  btw: { label: 'BTW', unit: '°', ghost: '888' },
  ttg: { label: 'TTG', unit: 'min', ghost: '888' },
  xte: { label: 'XTE', unit: 'nm', ghost: '8.88' },
};
// the passage block's rows by mode: Sail and School all five; Regatta the next mark, its distance, bearing and time to go; Cruise
// the three a passenger asks (where, how far, how long)
export const PASSAGE_ROWS = {
  sail: ['mark', 'dtw', 'btw', 'ttg', 'xte'], school: ['mark', 'dtw', 'btw', 'ttg', 'xte'],
  regatta: ['mark', 'dtw', 'btw', 'ttg'], cruise: ['mark', 'dtw', 'ttg'],
};

// the shown whole number: it changes only once the true value is past the half step by NAV.hyst (220 holds through 220.69, 221
// from 220.7); circular: degrees on a compass (359 -> 0 is one step)
export function holdRound(prev, v, circular = false) {
  if (!Number.isFinite(v)) return prev ?? null;
  const r = Math.round(v), norm = (x) => (circular ? ((x % 360) + 360) % 360 : x);
  if (prev == null) return norm(r);
  let d = v - prev; if (circular) d = ((d + 540) % 360) - 180;
  return Math.abs(d) >= 0.5 + NAV.hyst - 1e-9 ? norm(r) : prev;
}
const ema = (prev, v, dt, tau) => (prev == null || !(tau > 0) ? v : prev + (v - prev) * (1 - Math.exp(-dt / tau)));

// input: { cog (rad), twsMs, twa (rad, + from starboard), sogMs, heel (rad, + to starboard), rudder (rad, + to starboard) }
export function createReadings() {
  let r = null;
  return {
    step(inp, dt = NAV.sampleS) {
      const p = r ?? {};
      const twsKn = (inp.twsMs ?? 0) / KN, vmgKn = Math.abs(((inp.sogMs ?? 0) / KN) * Math.cos(inp.twa ?? 0));
      r = {
        cog: holdRound(p.cog, (inp.cog ?? 0) * DEG, true),
        tws: ema(p.tws, twsKn, dt, NAV.emaS.tws),
        twa: holdRound(p.twa, (inp.twa ?? 0) * DEG),
        vmg: ema(p.vmg, vmgKn, dt, NAV.emaS.vmg),
        heelRaw: ema(p.heelRaw, (inp.heel ?? 0) * DEG, dt, NAV.emaS.heel),
        rud: holdRound(p.rud, (inp.rudder ?? 0) * DEG),
      };
      r.heel = holdRound(p.heel, r.heelRaw);
      return r;
    },
    reset() { r = null; },
    get now() { return r; },
  };
}

// p: passageTo()'s answer
export function createPassageReadings() {
  let r = null;
  return {
    step(p, dt = NAV.passageS) {
      if (!p) { r = null; return r; }
      const prev = r ?? {};
      const ttg = p.ttgMin == null ? null : prev.ttg == null ? p.ttgMin : ema(prev.ttg, p.ttgMin, dt, NAV.emaS.ttg);
      r = { dtw: p.dtw, btw: holdRound(prev.btw, p.btw, true), ttg, xte: p.xte, xteSide: p.side };
      return r;
    },
    reset() { r = null; },
    get now() { return r; },
  };
}

const pad3 = (d) => String(((Math.round(d) % 360) + 360) % 360).padStart(3, '0');
const side = (v) => (v > 0 ? 'S' : v < 0 ? 'P' : '');
// a speed: one decimal under 10, whole from 10 (9.4 kn, 12 kn)
export const speedText = (kn) => { const one = Math.round(kn * 10) / 10; return one >= 10 ? String(Math.round(kn)) : one.toFixed(1); };
// a row's strings from the readings: { num, unit, side } (side 'P' | 'S' | '')
export function fmt(id, v) {
  const x = v?.[id];
  if (x == null || !Number.isFinite(x)) return { num: '—', unit: '', side: '' };
  switch (id) {
    case 'cog': return { num: pad3(x), unit: '°', side: '' };
    case 'tws': case 'vmg': return { num: speedText(Math.abs(x)), unit: 'kn', side: '' };
    case 'twa': case 'heel': case 'rud': return { num: String(Math.abs(Math.round(x))), unit: '°', side: side(Math.round(x)) };
    case 'dtw': return { num: dtwText(x), unit: 'nm', side: '' };
    case 'btw': return { num: pad3(x), unit: '°', side: '' };
    case 'ttg': return { ...ttgText(x), side: '' };
    case 'xte': { const num = x.toFixed(2); return { num, unit: 'nm', side: num === '0.00' ? '' : v.xteSide ?? '' }; }
    default: return { num: String(x), unit: ROWS[id]?.unit ?? '', side: '' };
  }
}

// the foot above the window's bottom: --lk-my (clamp 26..50 px, 4.6 vh) + 12 vh
export const footPx = (h) => Math.min(50, Math.max(26, 0.046 * h)) + 0.12 * h;
// the rows that fit: floor((H - foot - topReserve) / row); a gap costs a third of a row
export const budgetRows = (h) => Math.floor((h - footPx(h) - NAV.topReservePx) / NAV.rowPx);
const cost = (ids) => ids.reduce((n, id) => n + (id === 'gap' ? NAV.gapPx / NAV.rowPx : 1), 0);
const tidy = (ids) => ids.filter((id, i, a) => id !== 'gap' || (i > 0 && i < a.length - 1 && a[i - 1] !== 'gap'));

// whether the instrument rows show: 'always' yes, 'off' no, 'auto' (the default) only with Pro on and in Regatta; never in Cruise
export const readingsOn = ({ mode = 'sail', pro = false, setting = 'auto' } = {}) =>
  mode !== 'cruise' && setting !== 'off' && (setting === 'always' || mode === 'regatta' || !!pro);

// the row ids, top to bottom. mode: 'sail' | 'school' | 'regatta' | 'cruise' | …; readings: the instrument rows show (readingsOn);
// pro: Pro mode (adds RUD); passage: a mark is set (the passage block joins); height: the window's (rows that do not fit go: XTE,
// BTW first, then from the bottom); phone: a phone (html[data-screen~=compact]): the circle prints HDG, SOG, DPT, so the column keeps TWS, VMG,
// HEEL and DTW, TTG
export function rowsFor({ mode = 'sail', readings = true, pro = false, passage = false, height = Infinity, phone = false } = {}) {
  let ids;
  if (phone && mode !== 'cruise') return tidy([...(readings ? ['tws', 'vmg', 'heel'] : []), ...(passage && PASSAGE_ROWS[mode] ? ['gap', 'dtw', 'ttg'] : [])]);
  if (!readings) ids = [];
  else if (mode === 'sail' || mode === 'school') ids = ['cog', 'tws', 'twa', 'gap', 'vmg', 'heel', ...(pro ? ['rud'] : [])];
  else if (mode === 'regatta') ids = ['cog', 'tws', 'twa', 'gap', 'vmg', 'heel', 'rud'];   // the race computer: RUD always
  else ids = [];
  if (passage && PASSAGE_ROWS[mode]) ids = [...ids, 'gap', ...PASSAGE_ROWS[mode]];
  ids = tidy(ids);
  if (Number.isFinite(height)) {
    const b = budgetRows(height);
    for (const id of NAV.dropFirst) if (cost(ids) > b) ids = ids.filter((x) => x !== id);
    while (ids.length && cost(ids) > b) ids = tidy(ids.slice(0, -1));
  }
  return ids;
}

// facts: { setting ('auto' | 'always' | 'off'), flag ('0' | '1' | null), mode, hud, blocked, loading, target (a mark is set) }
// (what shows inside is rowsFor's: an empty list is an empty edge)
// The column is not a hint: it stays in the helm view, in Instruments and under the fold; Clear takes it with everything else.
// Cruise (nothing at rest) shows only its passage block, only while a mark is set, and wakes with the bar.
export function visibleColumn(f) {
  if (f.flag === '0') return false;
  if (f.flag !== '1' && (f.setting === 'off' || f.setting === false)) return false;
  if (f.blocked || f.loading || f.hud === 'clear') return false;
  if (f.mode === 'cruise') return !!f.target;
  return f.mode === 'sail' || f.mode === 'school' || f.mode === 'regatta';
}

const CSS = `
.lk-nav .nr{display:grid;grid-column:1 / -1;grid-template-columns:subgrid;align-items:center;justify-items:start;height:var(--lk-edge-row);transition:opacity ${EDGE.fadeMs}ms var(--lk-ease)}
.lk-nav .nr.gap{height:${NAV.gapPx}px}
.lk-nav .nr.fade{opacity:0}
.lk-nav .nr.off{display:none}
.lk-nav .l{opacity:.6}   /* the legend's words are at .6 too (keyLegend.js OPACITY.full): one grey on both edges */
.lk-nav .n{display:inline-flex;align-items:baseline;opacity:.84;font-size:var(--lk-fs-num);line-height:1.2;letter-spacing:0;text-transform:none;font-variant-numeric:tabular-nums;white-space:nowrap}
.lk-nav .num{display:inline-grid;justify-items:end}
.lk-nav .num>i{grid-area:1 / 1;font-style:normal}
.lk-nav .num>.g{visibility:hidden}
.lk-nav .u{font-size:15px;letter-spacing:.04em;margin-left:.22em}
.lk-nav .u.deg{font-size:inherit;letter-spacing:0;margin-left:0}   /* the degree sign belongs to the number: 221°, not a word after it */
.lk-nav .sd{font-style:normal;font-size:15px;letter-spacing:.04em;margin-left:.3em}
.lk-nav .sd.p{color:rgb(var(--lk-port))}
.lk-nav .sd.s{color:rgb(var(--lk-stbd))}
.lk-nav .nr.mark>span{grid-column:1 / -1;opacity:.84}
.lk-nav .nr.mark b{font-weight:inherit;color:rgb(var(--lk-amber))}   /* a set mark is a state: the one amber on the left edge */
/* Regatta (no legend outside Sail): the race plates (the watch, the position, the next-mark pointer; regatta/plates.js) hold the
   left margin for the whole race, so the column takes the empty right edge, on the same anchors as the legend */
.lk-edgepair.lk-nav.at-right{left:auto;right:var(--lk-mx)}
/* phones: no legend on touch; a 30 px row, the 19 px number floor. Upright: under the chart circle and the
   skipper's line, over open water, clear of the bottom band. Sideways: at the phone's margin, its foot above the chart dial. */
html[data-screen~=compact] .lk-nav{--lk-edge-row:30px;left:max(14px,var(--lk-sal,0px))}
html[data-screen~=portrait]:where([data-screen~=compact]) .lk-nav{top:${NAV.phone.top}px;bottom:auto}
html[data-screen~=compact]:where(:not([data-screen~=portrait])) .lk-nav{bottom:${NAV.phone.landFoot}px}
@media (prefers-reduced-motion:reduce){.lk-nav .nr{transition:none}}`;

const PLAY_MODES = new Set(['sail', 'school', 'regatta', 'cruise']);

export function createNavColumn({ services, settings, getMode, passage = services.get('passage'), doc = globalThis.document, win = globalThis } = {}) {
  ensureTokens(); ensureEdgeStyle(doc);
  if (!doc.getElementById('lk-nav-css')) { const st = doc.createElement('style'); st.id = 'lk-nav-css'; st.textContent = CSS; doc.head.appendChild(st); }
  const el = doc.createElement('div'); el.className = 'lk-nav lk-edgepair left'; el.setAttribute('aria-hidden', 'true');
  const mk = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  // every row once; order and fades pick the ones shown (gaps: as many as a layout can need)
  const rows = new Map();
  for (const id of Object.keys(ROWS)) {
    const r = mk('div', 'nr off fade'), n = mk('span', 'n'), num = mk('span', 'num'), v = mk('i', 'v', '—'), u = mk('span', ROWS[id].unit === '°' ? 'u deg' : 'u', ROWS[id].unit), sd = mk('i', 'sd', '');
    num.appendChild(mk('i', 'g', ROWS[id].ghost)); num.appendChild(v); n.appendChild(num); n.appendChild(u); n.appendChild(sd);
    r.appendChild(mk('span', 'l', ROWS[id].label)); r.appendChild(n);
    r.dataset.id = id; el.appendChild(r); rows.set(id, { el: r, v, u, sd, text: '' });
  }
  { const r = mk('div', 'nr mark off fade'), line = mk('span', null, 'MARK '), b = mk('b', null, ''); line.appendChild(b); r.appendChild(line); r.dataset.id = 'mark'; el.appendChild(r); rows.set('mark', { el: r, name: b, text: '' }); }
  const gaps = [0, 1, 2].map((i) => { const g = mk('div', 'nr gap off fade'); g.dataset.id = `gap${i}`; el.appendChild(g); return { el: g }; });
  doc.body.appendChild(el);

  const readings = createReadings(), legs = createPassageReadings();
  let passageAt = -1e9, target = null;
  const samplePassage = (t) => {
    passageAt = t;
    const p = passage?.sync?.() ?? null, s = services.get('player')?.phys?.state;
    target = p?.target ?? null;
    if (!target || !s) { legs.reset(); return; }
    legs.step(passageTo(s, target, { from: p.from }));
  };
  const now = () => (win.performance?.now?.() ?? Date.now());
  const loadingUp = () => { const l = doc.getElementById?.('lk-load'); return !!l && l.isConnected && l.dataset.state !== 'gone' && !doc.documentElement?.classList.contains('lk-nol'); };
  // the same covers as the legend's: a menu, the logbook, the big chart, the keys list, the binoculars
  const blocked = () => !!services.get('menu')?.isOpen || !!services.get('logbook')?.logbook?.isOpen || !!services.get('chart')?.chart?.toggle?.big || !!services.get('chart')?.chart?.toggle?.pinned
    || services.get('controls')?.hint?.current === 'keys' || (services.get('controls')?.tools?.bino?.k ?? 0) > 0.02;
  const facts = () => ({ setting: settings?.get?.('edgeInstruments'), flag: FLAGS.navcol ?? null, mode: getMode(), hud: services.get('calm')?.mode ?? null,
    blocked: blocked(), loading: loadingUp(), target: !!target });
  let sampleAt = -1e9, last = '', api;
  const sample = (t) => {
    const s = services.get('player')?.phys?.state;
    if (!s) return false;
    const dt = Math.min(1, Math.max(0, t - sampleAt));
    readings.step({ cog: s.cog, twsMs: s.trueWind?.speed, twa: s.trueWind?.angle, sogMs: s.sog, heel: s.heel, rudder: s.rudderAngle }, sampleAt < 0 ? NAV.sampleS : dt);
    sampleAt = t; return true;
  };
  const write = (row, f) => {
    const key = `${f.num}|${f.unit}|${f.side}`;
    if (key === row.text) return;
    row.text = key;
    if (row.v.textContent !== f.num) row.v.textContent = f.num;
    if (row.u.textContent !== f.unit) { row.u.textContent = f.unit; row.u.className = f.unit === '°' ? 'u deg' : 'u'; }
    if (row.sd) { row.sd.textContent = f.side; row.sd.className = `sd${f.side === 'P' ? ' p' : f.side === 'S' ? ' s' : ''}`; }
  };
  const show = (r, at) => {
    r.style.order = String(at);
    win.clearTimeout?.(r._t);
    if (r.classList.contains('off')) { r.classList.remove('off'); void r.offsetWidth; }
    r.classList.remove('fade');
  };
  const hide = (r) => { if (r.classList.contains('fade')) return; r.classList.add('fade'); r._t = win.setTimeout?.(() => r.classList.add('off'), EDGE.fadeMs); };
  function update() {
    const f = facts(), t = now() / 1000;
    let vis = !api.hidden && PLAY_MODES.has(f.mode) && visibleColumn(f);
    if (vis && t - sampleAt >= NAV.sampleS && !sample(t) && sampleAt < 0) vis = false;   // no boat yet
    if (t - passageAt >= NAV.passageS) samplePassage(t);   // the passage is read even while hidden (Cruise shows on a mark)
    if (!vis) { sampleAt = -1e9; readings.reset(); }
    const phone = !!doc.documentElement?.classList?.contains('lk-phone');
    const pro = !!services.get('controls')?.pro;   // the PRO recess / TRIM: the same switch as the trim panel
    const instruments = readingsOn({ mode: f.mode, pro, setting: f.flag === '1' ? 'always' : f.setting ?? 'auto' });
    const ids = vis ? rowsFor({ mode: f.mode, readings: instruments, pro, passage: !!target, height: phone ? Infinity : win.innerHeight ?? Infinity, phone }) : [];
    const on = vis && ids.length > 0;
    const key = `${on}|${f.mode}|${phone}|${ids.join(',')}`;
    if (key !== last) {
      last = key;
      el.classList.toggle('on', on);
      el.classList.toggle('lk-wake-bar', f.mode === 'cruise');   // Cruise has no dashboard: the block comes and goes with the bar (calmHud.js)
      el.classList.toggle('at-right', f.mode === 'regatta' && !phone);   // the race plates own the left margin
      let g = 0; const shown = new Set();
      ids.forEach((id, i) => { const r = id === 'gap' ? gaps[g++] : rows.get(id); if (!r) return; shown.add(r); show(r.el, i); });
      for (const r of [...rows.values(), ...gaps]) if (!shown.has(r)) hide(r.el);
    }
    if (on) {
      const v = { ...readings.now, ...legs.now };
      for (const id of ids) {
        if (id === 'mark') { const m = rows.get('mark'), name = target?.name ?? ''; if (m.text !== name) { m.text = name; m.name.textContent = name; } continue; }
        if (rows.has(id)) write(rows.get(id), fmt(id, v));
      }
    }
  }
  api = { el, update, hidden: false, get readings() { return { ...readings.now, ...legs.now }; }, get target() { return target; },
    dispose() { el.remove(); doc.getElementById?.('lk-nav-css')?.remove(); } };
  return api;
}
