// The PRO recess's hit and accessibility layer (owner, 2026-11-06, the cockpit's stage 2; the picture is cockpit3d.js's third
// recess): invisible DOM over the 3D parts, each ≥ 44 css px, keyboard focusable, placed each frame by the helm station.
//   closed   one button over the whole smoked-glass cover: PRO (opens it: Pro mode on, the same switch as Settings → Sailing)
//   open     PRO (closes it); TRAVELLER, JIB LEAD, VANG and BACKSTAY, each a car on its track: each a slider (drag along the
//            coaming, scroll, ← → ↑ ↓, Home / End), each driving the controls' own values (src/boat.js PRO)
//   always   the cockpit's two tool buttons (look C3, owner 2026-11-12): BINOS by the chart (a click raises the glasses, as B) and
//            VHF by the wind (a click turns the radio on and off); LOG left the cockpit (the Menu's Logbook, L)
// VANG is the twist control seen from the vang's side: more vang, less twist (the car right = twist closed).
//
//   const pr = createProRecess({ get, set, open: () => bool, onPro, onTool: (id) => …, lit: { binoculars, radio } });
//   pr.place(rects | null)   // { cover, pro, binoculars, radio, traveller, jibLead, vang, backstay } css px; sliders carry { a, b } (the drag's ends, x)
//   pr.hover                 // the part under the pointer, the focus or a press ('binoculars' | 'radio' | a slider's id | null): its 3D
//                            // cap or car brightens (look/pro-sliders: the car answers the pointer)
//   pr.suppress(id, bool)    // a tool's target stands aside for a moment (a phone: BINOS's while the JIB winch's steps show over it)
//   proLayout(pts, opts)     // the rects from the projected anchors (pure: tests/proRecess.test.mjs)
//   pr.f                     // the sliders' values as car positions 0..1 now
//   pr.shownF                // where the 3D cars stand: f plus the one quiet demo's nudge (look/pro-sliders)
// The demo (owner 2026-11-12, look/pro-sliders: "go sliders"): the first time PRO opens in a session each car slides a little way and
// back once, about 1 s in all, staggered; never on headless, golden or automated pages, nor with reduced motion; never again. It moves
// only the drawing, never a value; a touch on a slider ends it.
// Pure parts (PRO_SLIDERS, fOf, valueOf, stepF, demoNudge, demoAllowed): tests/proRecess.test.mjs.
import { wheelPx } from './helmInput.js';
import { sharedTips } from '../../ui/tips.js';

// id (the 3D car), key (the controls' value), the value at the track's left and right ends, the aria name
export const PRO_SLIDERS = [
  { id: 'traveller', key: 'traveller', lo: -1, hi: 1, name: 'traveller (down, up)' },
  { id: 'jibLead', key: 'jibLead', lo: -1, hi: 1, name: 'jib lead (forward, aft)' },
  { id: 'vang', key: 'twist', lo: 1, hi: -1, name: 'vang (eased: twist open; on: twist closed)' },
  { id: 'backstay', key: 'backstay', lo: 0, hi: 1, name: 'backstay (ease, on)' },
];
export const PRO_BUTTONS = [['pro', 'PRO trim']];
export const PRO_TOOLS = [['binoculars', 'binoculars (B)'], ['radio', 'VHF radio']];   // shown open or closed: real objects on the cockpit
// the recess's grid of targets (look C3): TRAVELLER and JIB LEAD over VANG and BACKSTAY; PRO's toggle a column of its own
export const PRO_ROWS = [['traveller', 'jibLead'], ['vang', 'backstay']];

// The hit rects (css px, each ≥ 44) from the projected anchors: pts { 'p:<id>:a', 'p:<id>:b' (a slider's drag ends), 'p:btn:pro',
// 'p:r0', 'p:r1' (the recess's top-left and foot-right), 'p:g0' (the grid's outboard edge), binos, vhf }. Two bands: the top
// row's from over it down to the middle between the rows, the bottom row's from there to the screen's foot; in a row each control's
// cell runs to the midpoints between it and its neighbours (the grid's edge and the recess's end outside). PRO's toggle: its column,
// both bands (≥ 44 wide: it may reach outboard of the recess). Closed, the cover's one rect over the toggle and the grid. sc: the
// screen's height / 1080.
// avoid: other controls' rects (the lever, the switches, ENGINE, TACK, the winches): the tools' cells step to the nearest place clear of them
export function proLayout(pts, { H, sc = H / 1080, rows = PRO_ROWS, avoid = [] } = {}) {
  const cx = (id) => (pts[`p:${id}:a`].x + pts[`p:${id}:b`].x) / 2;
  const cy = (id) => (pts[`p:${id}:a`].y + pts[`p:${id}:b`].y) / 2;
  const r0 = pts['p:r0'], r1 = pts['p:r1'], g0 = pts['p:g0']?.x ?? r0.x;
  const ys = rows.map((row) => row.reduce((m, id) => m + cy(id), 0) / row.length);
  const mid = Math.min((ys[0] + ys[1]) / 2, H - 44), topH = Math.max(44, 2 * (mid - ys[0]));
  const out = {};
  rows.forEach((row, ri) => {
    const ids = [...row].sort((p, q) => cx(p) - cx(q)), xs = ids.map(cx), n = ids.length;
    let ed = ids.map((_, i) => [i ? (xs[i - 1] + xs[i]) / 2 : Math.min(g0, xs[0] - 22), i < n - 1 ? (xs[i] + xs[i + 1]) / 2 : Math.max(r1.x, xs[n - 1] + 22)]);
    if (ed.some(([a, b]) => b - a < 44)) { const m = (ed[0][0] + ed[n - 1][1]) / 2, w = Math.max(44, (ed[n - 1][1] - ed[0][0]) / n); ed = ids.map((_, i) => [m + (i - n / 2) * w, m + (i + 1 - n / 2) * w]); }
    ids.forEach((id, i) => {
      const r = ri === 0 ? { x: ed[i][0], y: mid - topH, w: ed[i][1] - ed[i][0], h: topH } : { x: ed[i][0], y: mid, w: ed[i][1] - ed[i][0], h: Math.max(44, H - mid) };
      r.a = pts[`p:${id}:a`].x; r.b = pts[`p:${id}:b`].x;
      out[id] = r;
    });
  });
  const left = Math.min(...rows.map((row) => out[[...row].sort((p, q) => cx(p) - cx(q))[0]].x)), top = mid - topH;
  if (pts['p:btn:pro']) { const x0 = Math.min(r0.x, left - 44); out.pro = { x: x0, y: top, w: left - x0, h: H - top }; }   // the toggle's column
  out.cover = { x: out.pro?.x ?? r0.x, y: Math.min(r0.y, top), w: r1.x - (out.pro?.x ?? r0.x), h: Math.min(H, Math.max(r1.y, mid + 44)) - Math.min(r0.y, top) };
  // the two tool buttons (look C3): a square on each dome, a little taller below it (its engraved word)
  for (const [id, k] of [['binoculars', 'binos'], ['radio', 'vhf']]) if (pts[k]) { const d = Math.max(44, 58 * sc); out[id] = { x: pts[k].x - d / 2, y: pts[k].y - d * 0.45, w: d, h: d }; }
  const over = (a, b) => Math.min(a.x + a.w, b.x + b.w) > Math.max(a.x, b.x) && Math.min(a.y + a.h, b.y + b.h) > Math.max(a.y, b.y);
  // the nearest place (within 64 px, 2 px steps) where the tool's cell overlaps neither those controls nor the recess's cells
  const mine = () => Object.entries(out).filter(([k]) => k !== 'cover' && k !== 'radio' && k !== 'binoculars').map(([, r]) => r);
  for (const id of ['radio', 'binoculars']) {
    const t = out[id]; if (!t) continue;
    t.x = Math.round(t.x); t.y = Math.round(t.y); t.w = Math.ceil(t.w); t.h = Math.ceil(t.h);   // whole pixels, so a cell can sit flush against a neighbour
    const block = [...avoid, ...mine(), ...(id === 'binoculars' && out.radio ? [out.radio] : [])];
    const free = (x, y) => y + t.h <= H && !block.some((r) => over({ x, y, w: t.w, h: t.h }, r));
    if (free(t.x, t.y)) continue;
    // the dome stays inside its cell (a cell moved off the dome left VHF unclickable at 1024 x 800: REEF's cell overlapped by 12 px
    // and the search moved it 59 px up); with no free place on the dome, the least overlap there wins
    const lim = Math.floor(Math.min(t.w, t.h) / 2) - 8, area = (x, y) => block.reduce((s, r) => s + Math.max(0, Math.min(x + t.w, r.x + r.w) - Math.max(x, r.x)) * Math.max(0, Math.min(y + t.h, r.y + r.h) - Math.max(y, r.y)), 0);
    let best = null;
    for (let dx = -lim; dx <= lim; dx += 2) for (let dy = -lim; dy <= lim; dy += 2) { if (t.y + dy + t.h > H) continue; const k = [area(t.x + dx, t.y + dy), Math.hypot(dx, dy)]; if (!best || k[0] < best[2] || (k[0] === best[2] && k[1] < best[3])) best = [dx, dy, ...k]; }
    if (best) { t.x += best[0]; t.y += best[1]; }
  }
  for (const r of Object.values(out)) { const x1 = Math.round(r.x + r.w), y1 = Math.round(r.y + r.h); for (const k of ['x', 'y', 'a', 'b']) if (k in r) r[k] = Math.round(r[k]); r.w = x1 - r.x; r.h = y1 - r.y; }   // round the edges: neighbours share an edge
  return out;
}
const TOOL_IDS = new Set(PRO_TOOLS.map(([id]) => id));
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const fOf = (spec, v) => clamp01(((v ?? (spec.lo + spec.hi) / 2) - spec.lo) / (spec.hi - spec.lo));
export const valueOf = (spec, f) => spec.lo + clamp01(f) * (spec.hi - spec.lo);
export const stepF = (f, dir, step = 0.05) => clamp01(Math.round((f + dir * step) / step) * step);

// the demo's shape: slider i (0..3) starts DEMO.stagger · i s in, slides DEMO.amp of its track toward the middle and back in DEMO.each s
// (a raised cosine: still at both ends, no snap); signed by where the car stands (f over the middle slides left)
export const DEMO = { stagger: 0.12, each: 0.6, amp: 0.18, wait: 0.5, key: 'lakeshore.proDemo.v1' };
export const DEMO_S = DEMO.stagger * (PRO_SLIDERS.length - 1) + DEMO.each;   // ≈ 0.96 s
export function demoNudge(t, i, f = 0.5) {
  const u = (t - DEMO.stagger * i) / DEMO.each;
  if (!(u > 0 && u < 1)) return 0;
  return (f > 0.5 ? -1 : 1) * DEMO.amp * (1 - Math.cos(2 * Math.PI * u)) / 2;
}
// whether the demo may play on this page: a person's page, once a session (storage: sessionStorage or null), no reduced motion
export function demoAllowed({ flags = {}, webdriver = false, reduced = false, storage = null } = {}) {
  if (flags.prodemo === '1') return true;   // ?prodemo=1: the review shots force it
  if (flags.prodemo === '0' || flags.headless || flags.golden || flags.film || webdriver || reduced) return false;
  if (!storage) return false;   // no storage: it could replay on every load
  try { return !storage.getItem(DEMO.key); } catch { return false; }
}

const CSS = `
.lk-pro{position:fixed;inset:0;z-index:var(--lk-z-dock);pointer-events:none}
.lk-pro .c{all:unset;position:absolute;box-sizing:border-box;pointer-events:auto;cursor:pointer;border-radius:8px;-webkit-tap-highlight-color:transparent;touch-action:none}
.lk-pro .c[role=slider]{cursor:ew-resize}
.lk-pro .c[hidden]{display:none}
.lk-pro .c:focus-visible{outline:2px solid rgb(var(--lk-amber) / .9);outline-offset:-2px}
.lk-pro.off .c{pointer-events:none}
`;

export function createProRecess({ get = () => ({}), set = () => {}, open = () => false, onPro = () => {}, onTool = () => {}, lit = {}, onUse = () => {}, root = document.body, demo = false, onDemo = () => {}, step = 0.05 } = {}) {   // step: a scroll notch or an arrow key (v2: 0.1)
  if (!document.getElementById('lk-pro-css')) { const st = document.createElement('style'); st.id = 'lk-pro-css'; st.textContent = CSS; document.head.appendChild(st); }
  const el = document.createElement('div'); el.className = 'lk-pro off'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'PRO trim');
  el.innerHTML = [...PRO_BUTTONS, ...PRO_TOOLS].map(([id, name]) => `<button type="button" class="c" data-id="${id}" aria-label="${name}" aria-pressed="false" hidden></button>`).join('')
    + PRO_SLIDERS.map((t) => `<div class="c" data-id="${t.id}" role="slider" tabindex="0" aria-label="${t.name}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" hidden></div>`).join('');
  root.appendChild(el);
  const cell = (id) => el.querySelector(`.c[data-id=${id}]`);
  let rects = null;
  const fNow = () => { const v = get(); return Object.fromEntries(PRO_SLIDERS.map((t) => [t.id, fOf(t, v[t.key])])); };
  const put = (t, f) => { set(t.key, valueOf(t, f)); onUse(t.id); };
  const tips = sharedTips();   // the push buttons' names and keys over the 3D recess (tips.js); the sliders are dragged, not named
  let hover = null;
  let held = null;   // the slider a press holds (its car stays bright while dragged, a finger's too)
  for (const id of [...PRO_TOOLS.map(([k]) => k), ...PRO_SLIDERS.map((t) => t.id)]) {   // under the pointer or the focus their 3D parts brighten (cockpit3d set({ hover }))
    const b = cell(id);
    b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') hover = id; });
    b.addEventListener('pointerleave', () => { if (hover === id) hover = null; });
    b.addEventListener('focus', () => { hover = id; }); b.addEventListener('blur', () => { if (hover === id) hover = null; });
  }
  for (const [id] of [...PRO_BUTTONS, ...PRO_TOOLS]) {
    const b = cell(id);
    if (id === 'pro') tips.add(b, { side: 'up' });   // the tools carry their engraved words: no tag
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', (e) => { e.stopPropagation(); b.blur(); if (tips.consumed(b)) return; if (id === 'pro') onPro(!open()); else onTool(id); onUse(id); });
  }
  for (const t of PRO_SLIDERS) {
    const c = cell(t.id); let pid = null;
    const fAtX = (x) => { const r = rects?.[t.id]; return r ? clamp01((x - r.a) / Math.max(1, r.b - r.a)) : 0.5; };
    c.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); if (e.pointerType === 'mouse' && e.button > 0) return;
      pid = e.pointerId; held = t.id; demoT = Infinity; nudge = {}; try { c.setPointerCapture(pid); } catch { /* synthetic */ }
      put(t, fAtX(e.clientX)); e.preventDefault();
    });
    c.addEventListener('pointermove', (e) => { if (e.pointerId !== pid) return; put(t, fAtX(e.clientX)); e.preventDefault(); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) c.addEventListener(ev, (e) => { if (e.pointerId === pid) { pid = null; if (held === t.id) held = null; } });
    c.addEventListener('click', (e) => e.stopPropagation());
    c.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); const d = wheelPx(e, { horizontal: true }); if (Math.abs(d) > 1) put(t, stepF(fNow()[t.id], d < 0 ? 1 : -1, step)); }, { passive: false });
    c.addEventListener('keydown', (e) => {
      const f = fNow()[t.id];
      const to = e.code === 'ArrowRight' || e.code === 'ArrowUp' ? stepF(f, 1, step) : e.code === 'ArrowLeft' || e.code === 'ArrowDown' ? stepF(f, -1, step) : e.code === 'Home' ? 0 : e.code === 'End' ? 1 : null;
      if (to == null) return;
      put(t, to); e.preventDefault(); e.stopPropagation();
    });
  }
  const css = (n, r) => { n.style.left = `${Math.round(r.x)}px`; n.style.top = `${Math.round(r.y)}px`; n.style.width = `${Math.round(r.w)}px`; n.style.height = `${Math.round(r.h)}px`; };
  let isOpen = null; const aside = new Set();
  // the demo: demoT the time since the panel stood open (null: waiting for PRO to open; Infinity: played or never)
  let demoT = demo ? null : Infinity, nudge = {};
  // rects: null hides the layer (no cockpit, folded, faded)
  function place(r) {
    rects = r;
    el.classList.toggle('off', !r);
    if (!r) { for (const c of el.querySelectorAll('.c')) c.hidden = true; return; }
    const o = !!open();
    for (const c of el.querySelectorAll('.c')) {
      const id = c.dataset.id, rr = id === 'pro' && !o ? r.cover : r[id];
      c.hidden = !rr || (!o && id !== 'pro' && !TOOL_IDS.has(id)) || aside.has(id);
      if (!c.hidden) css(c, rr); else if (hover === id) hover = null;
    }
    if (o !== isOpen) { isOpen = o; const p = cell('pro'); p.setAttribute('aria-pressed', String(o)); p.setAttribute('aria-expanded', String(o)); p.setAttribute('aria-label', o ? 'PRO trim: close' : 'PRO trim: open'); }
  }
  function update(dt = 0) {
    if (rects && !!open() !== isOpen) place(rects);   // Pro switched elsewhere (the dock, Settings, P): the targets follow
    const f = fNow();
    if (demoT !== Infinity) {
      if (rects && open()) { if (demoT == null) { demoT = -DEMO.wait; try { onDemo(); } catch { /* storage */ } } else demoT += dt; }
      else if (demoT != null) demoT = DEMO_S;   // closed or folded mid-way: it ends, never replays
      nudge = demoT == null ? {} : Object.fromEntries(PRO_SLIDERS.map((t, i) => [t.id, demoNudge(demoT, i, f[t.id])]));
      if (demoT != null && demoT >= DEMO_S) { demoT = Infinity; nudge = {}; }
    }
    for (const t of PRO_SLIDERS) { const c = cell(t.id); if (!c.hidden) c.setAttribute('aria-valuenow', String(Math.round(f[t.id] * 100))); }
    for (const [id] of PRO_TOOLS) { let on = false; try { on = !!lit[id]?.(); } catch { /* not ready */ } const b = cell(id); if (b.getAttribute('aria-pressed') !== String(on)) b.setAttribute('aria-pressed', String(on)); }
  }
  const suppress = (id, on) => { if (aside.has(id) === !!on) return; if (on) aside.add(id); else aside.delete(id); if (rects) place(rects); };
  return { el, place, update, suppress, get f() { return fNow(); },
    get shownF() { const f = fNow(); for (const k in nudge) f[k] = clamp01(f[k] + nudge[k]); return f; }, get demoing() { return demoT !== Infinity && demoT != null; },
    get rects() { return rects; }, get shown() { return !!rects && !!open(); }, get hover() { return rects ? held ?? hover : null; },
    get cells() { return [...el.querySelectorAll('.c')].map((c) => ({ id: c.dataset.id, hidden: c.hidden, pressed: c.getAttribute('aria-pressed'), r: c.hidden ? null : c.getBoundingClientRect?.() })); },
    dispose() { tips.forget(cell('pro')); el.remove(); } };
}
