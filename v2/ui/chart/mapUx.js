// The map's crosshair, layers and wake (owner go 2026-11-18 with the defaults; on by default, ?mapux=0 turns them off for
// one release): three ideas from the map screens of open-world and sailing games, in the chart's quiet manner:
//   cursor   a thin full-width crosshair that eases after the pointer (an exponential follow, tau 0.1 s, frame-rate independent;
//            none under reduced motion), snaps to a shown point within 22 px (the ring tightens, the point lifts), and reads the
//            spot under it: bearing (true) and distance from the boat, else latitude and longitude. A mouse only: a finger has no hover.
//   layers   quiet toggles at the map's top edge: All · Places · Races · Anchorages · Marks · Wildlife · Your wake. A toggle hides its points
//            and their names; the bay's own names (the chart's geography) always stay. All turns every layer on. A phone's box: one
//            round Layers button (44 px) opens the same toggles as a 2 x 3 grid.
//   wake     the last 3 voyages sailed (newest full, then 60 %, 30 %), kept per device (localStorage, try/catch: a private window simply forgets), drawn
//            as a soft wash with a fine core under today's track, on the start screen too: an exploring feeling, no fog of war.
//            Setup › Sail › your wake › forget clears it (ui/wakeRow.js).
// Plain JS; the DOM and canvas parts take their host. The model parts (easeToward, snapTo, readout, layerOf, createWakeStore) have no
// DOM and no wall clock: v2/tests/map-ux.test.mjs reads them.
import { worldToLonLat } from '../../../src/sim/geo.js';

export const UX = Object.freeze({ tauS: 0.1, snapPx: 22, settlePx: 0.3, wakeStepM: 12, wakeJumpM: 90, wakeMaxPts: 8000, wakeSaveEvery: 20, wakeVoyages: 3, wakeFade: [1, 0.6, 0.3] });
export const LAYERS = Object.freeze([
  { id: 'places', word: 'Places', kinds: ['birthplace', 'place', 'corner'] },   // the hunts' corners with the places (no new toggle)
  { id: 'anchorages', word: 'Anchorages', kinds: ['anchorage'] },
  { id: 'marks', word: 'Marks', kinds: ['buoy', 'channel', 'raceMark', 'barge'] },
  { id: 'wildlife', word: 'Wildlife', kinds: ['area'] },
  { id: 'wake', word: 'Your wake', kinds: [] },
]);
// the Races layer (owner 2026-11-19: only in Regatta): each place race's pin; it joins the bar, on, while Regatta is the mode
// (setRaces(true)) and leaves it in Sail and Cruise, so their bar and their points are as before
export const RACES_LAYER = Object.freeze({ id: 'races', word: 'Races', kinds: ['racePin'] });
const KIND_LAYER = Object.fromEntries([...LAYERS, RACES_LAYER].flatMap((l) => l.kinds.map((k) => [k, l.id])));
export const layerOf = (kind) => KIND_LAYER[kind] ?? null;

// one step of the eased follow: the cursor moves 1 − e^(−dt/tau) of the way to the target (the same feel at 30 and 120 fps)
export function easeToward(cur, target, dt, tau = UX.tauS) {
  if (!cur || tau <= 0) return { x: target.x, y: target.y };
  const k = 1 - Math.exp(-Math.max(0, dt) / tau);
  return { x: cur.x + (target.x - cur.x) * k, y: cur.y + (target.y - cur.y) * k };
}
// the magnet: the nearest shown point within r px of the pointer, else none (pts: [{ id, px, py }])
export function snapTo(pts, px, py, r = UX.snapPx) {
  let best = null, bd = r;
  for (const p of pts) { const d = Math.hypot(p.px - px, p.py - py); if (d <= bd) { bd = d; best = p; } }
  return best;
}
const NM = 1852;
export function distWords(m) { return m < 0.1 * NM ? `${Math.round(m / 5) * 5} m` : `${(m / NM).toFixed(2)} nm`; }
export function dmLine(deg, pos, neg) {   // 38.95416 → 38°57.25′ N (minutes to 0.01: about 18 m)
  const a = Math.abs(deg); let d = Math.floor(a), m = +((a - d) * 60).toFixed(2);
  if (m >= 60) { d += 1; m = 0; }
  return `${d}°${m.toFixed(2).padStart(5, '0')}′ ${deg >= 0 ? pos : neg}`;
}
// what the crosshair reads at world (x, z): from the boat, the true bearing and the distance; always the position
export function readout(x, z, boat = null) {
  const [lon, lat] = worldToLonLat(x, z), pos = `${dmLine(lat, 'N', 'S')}  ${dmLine(lon, 'E', 'W')}`;
  if (!boat) return { main: pos, sub: null };
  const dx = x - boat.x, dz = z - boat.z, d = Math.hypot(dx, dz);
  const brg = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;   // x east, z south: north is −z
  return { main: `${String(Math.round(brg) % 360).padStart(3, '0')}°T  ${distWords(d)}`, sub: pos };
}

// the wake, by voyage (owner, 2026-11-19: "keep only the last 3 voyages"). A voyage is one page session's sailing: it begins when the session
// has sailed one step (12 m; the idle boat's first sample at the start screen is only a pending point, and a move before she sails drops it),
// so a bare reload cannot push a real voyage out; it holds segments of [x, z]
// points (whole metres), a point each wakeStepM sailed. A move to another birthplace in play starts a new segment of the SAME voyage (a
// jump of more than wakeJumpM). The newest wakeVoyages voyages are kept, oldest first; older ones are dropped from storage. Storage
// 'lakeshore.wake.v2' = { v: 2, voyages: [{ t, s: segments }] }; the v1 key (a bare array of segments, no times) is read once as one old
// voyage and removed on the next save. The point cap (max) is over all voyages, the oldest voyage's oldest points going first.
export function createWakeStore({ storage = null, key = 'lakeshore.wake.v2', oldKey = 'lakeshore.wake.v1', max = UX.wakeMaxPts, keep = UX.wakeVoyages, now = () => Date.now() } = {}) {
  const sailed = (o) => o.segs.some((s) => s.length >= 2);   // a voyage that never made a step is not one
  const clean = (list) => (Array.isArray(list) ? list.filter((s) => Array.isArray(s)).map((s) => s.filter((p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map(([x, z]) => [Math.round(x), Math.round(z)])).filter((s) => s.length) : []);
  let vs = [];   // [{ t, segs }], oldest first
  try {
    const raw = storage?.getItem(key);
    if (raw) { const v = JSON.parse(raw); if (Array.isArray(v?.voyages)) vs = v.voyages.map((o) => ({ t: Number(o?.t) || 0, segs: clean(o?.s) })).filter(sailed); }
    else { const old = storage?.getItem(oldKey); if (old) { const segs = clean(JSON.parse(old)); if (segs.some((s) => s.length >= 2)) vs = [{ t: 0, segs }]; } }   // v1: everything stored is one old voyage
  } catch { vs = []; }
  vs = vs.slice(-keep);
  let started = false, pend = null, unsaved = 0, version = 0, last = null;   // started: this session has its own voyage yet; pend: its first point before the second
  const count = () => vs.reduce((n, o) => n + o.segs.reduce((m, s) => m + s.length, 0), 0);
  function save() {
    unsaved = 0;
    try { storage?.setItem(key, JSON.stringify({ v: 2, voyages: vs.map((o) => ({ t: o.t, s: o.segs })) })); storage?.removeItem?.(oldKey); } catch { /* full or blocked: the wake lives for this visit */ }
  }
  function trim() {
    let n = count();
    while (n > max && vs.length) {
      const o = vs[0], s = o.segs[0], cut = Math.min(s.length, n - max);
      s.splice(0, cut); n -= cut;
      if (!s.length) o.segs.shift();
      if (!o.segs.length) vs.shift();
    }
  }
  return {
    get voyages() { return vs; },   // [{ t, segs }], oldest first: the last is the newest (drawn at full strength)
    get segments() { return vs.flatMap((o) => o.segs); },
    get version() { return version; },
    get count() { return count(); },
    sample(x, z) {
      if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
      const p = [Math.round(x), Math.round(z)];
      if (!started || !vs.length) {   // no voyage of this session yet: the first point waits for the second
        if (!pend || Math.hypot(p[0] - pend[0], p[1] - pend[1]) > UX.wakeJumpM) { pend = p; return true; }
        if (Math.hypot(p[0] - pend[0], p[1] - pend[1]) < UX.wakeStepM) return false;
        started = true; vs.push({ t: now(), segs: [[pend]] }); while (vs.length > keep) vs.shift(); last = pend; pend = null;
      }
      const cur = vs.at(-1);
      if (last) { const d = Math.hypot(p[0] - last[0], p[1] - last[1]); if (d < UX.wakeStepM) return false; if (d > UX.wakeJumpM) cur.segs.push([]); }
      cur.segs.at(-1).push(p); last = p; version++;
      trim();
      if (++unsaved >= UX.wakeSaveEvery) save();
      return true;
    },
    // a list of segments is one voyage; seedVoyages takes a list of those, oldest first
    seed(list) { this.seedVoyages([list]); },
    seedVoyages(lists) { vs = lists.map((l) => ({ t: 0, segs: clean(l) })).filter((o) => o.segs.length).slice(-keep); started = false; pend = null; last = null; version++; trim(); save(); },
    clear() { vs = []; started = false; pend = null; last = null; version++; save(); },
    save,
  };
}

const CSS = `
.lkc .lkc-xh{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1}
.lkc .lkc-layers{position:absolute;z-index:2;top:14px;left:calc(var(--lkc-in,0px) + (100% - var(--lkc-in,0px)) / 2);transform:translateX(-50%);display:flex;gap:2px;padding:3px 6px;
  background:var(--lk-glass-dense);border:1px solid var(--lk-glass-edge);border-radius:999px;white-space:nowrap}
.lkc .lkc-layers button{appearance:none;background:none;border:0;cursor:pointer;min-height:32px;padding:0 .75em;font:500 15px/1 var(--lk-ui);letter-spacing:.06em;
  color:rgb(var(--lk-cream) / .58);border-radius:999px;transition:color .12s,background .12s}
.lkc .lkc-layers button[aria-pressed=true]{color:var(--lk-ink);background:rgb(var(--lk-cream) / .13)}
.lkc .lkc-layers button:hover,.lkc .lkc-layers button:focus-visible{color:var(--lk-ink);outline:none}
.lkc .lkc-layers .sep{width:1px;margin:7px 4px;background:var(--lk-glass-edge)}
.lkc .lkc-lyb{position:absolute;z-index:2;top:8px;right:8px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;padding:0;cursor:pointer;
  color:var(--lk-ink);background:var(--lk-glass-dense);border:1px solid var(--lk-glass-edge);border-radius:50%}
.lkc .lkc-lyb[aria-expanded=true]{border-color:rgb(var(--lk-cream) / .6)}
.lkc .lkc-lyb svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linejoin:round}
.lkc .lkc-layers[data-compact]{top:58px;left:auto;right:8px;transform:none;display:grid;grid-template-columns:1fr 1fr;gap:2px;padding:6px;border-radius:14px}
.lkc .lkc-layers[data-compact][hidden]{display:none}
.lkc .lkc-layers[data-compact] button{min-height:44px;text-align:left}
.lkc .lkc-layers[data-compact] .sep{display:none}
`;
const LYR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" style="fill:none;width:22px;height:22px"><path d="M12 4l9 4.5-9 4.5-9-4.5z"/><path d="M3 12.5l9 4.5 9-4.5"/><path d="M3 16.5l9 4.5 9-4.5"/></svg>';

// the DOM half: mounted by createChart when ux is on. ctx gives it the chart's own reads.
//   ctx: { el, rgba, ink(), touch(), reduced(), insets(), boat(), toWorld(px, py), points() → [{ id, px, py }], hover(id|null), redraw() }
export function mountMapUx(ctx, { wake = null, layers = true, cursor = true, compact = false } = {}) {   // compact: a phone's box (one Layers button opens a 2 × 3 grid)
  const { el } = ctx;
  if (!document.getElementById('lk-mapux-css')) { const s = document.createElement('style'); s.id = 'lk-mapux-css'; s.textContent = CSS; document.head.appendChild(s); }
  let active = [...LAYERS];   // the layers in the bar now: the base five, and Races while Regatta is the mode
  const on = new Set(active.map((l) => l.id));
  // ---- the layers ----
  let bar = null, lyb = null;
  const btns = new Map();
  function setOpen(o) { if (!lyb || !bar) return; bar.hidden = !o; lyb.setAttribute('aria-expanded', String(!!o)); }
  function syncBar() { const all = on.size === active.length; btns.get('all')?.setAttribute('aria-pressed', String(all)); for (const l of active) btns.get(l.id)?.setAttribute('aria-pressed', String(!all && on.has(l.id))); }
  if (layers) {
    bar = document.createElement('div'); bar.className = 'lkc-layers'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Chart layers');
    const mk = (id, word) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = word; b.dataset.layer = id; btns.set(id, b); bar.appendChild(b); return b; };
    mk('all', 'All');
    const sep = document.createElement('i'); sep.className = 'sep'; bar.appendChild(sep);
    for (const l of LAYERS) mk(l.id, l.word);
    bar.addEventListener('click', (e) => {
      const id = e.target?.dataset?.layer; if (!id) return;
      e.stopPropagation();
      if (id === 'all') active.forEach((l) => on.add(l.id));
      else if (on.size === active.length) { on.clear(); on.add(id); }   // from All, a layer pressed shows that layer alone
      else { if (on.has(id)) on.delete(id); else on.add(id); if (!on.size) active.forEach((l) => on.add(l.id)); }
      syncBar(); ctx.redraw();
    });
    for (const ty of ['pointerdown', 'pointerup', 'wheel', 'dblclick']) bar.addEventListener(ty, (e) => e.stopPropagation(), { passive: ty !== 'wheel' });
    el.appendChild(bar); syncBar();
    if (compact) {   // a phone: the grid sits behind one round Layers button (44 px) in the box's top-right corner; a press on the map folds it
      bar.dataset.compact = ''; bar.hidden = true;
      lyb = document.createElement('button'); lyb.type = 'button'; lyb.className = 'lkc-lyb'; lyb.innerHTML = LYR_SVG;
      lyb.setAttribute('aria-label', 'Chart layers'); lyb.setAttribute('aria-expanded', 'false');
      lyb.addEventListener('click', (e) => { e.stopPropagation(); setOpen(bar.hidden); });
      for (const ty of ['pointerdown', 'pointerup', 'wheel', 'dblclick']) lyb.addEventListener(ty, (e) => e.stopPropagation(), { passive: ty !== 'wheel' });
      el.appendChild(lyb);
      el.querySelector('canvas')?.addEventListener('pointerdown', () => setOpen(false));
    }
  }
  // ---- the crosshair: its own canvas over the chart's, so the chart's draw never runs for it ----
  const xc = document.createElement('canvas'); xc.className = 'lkc-xh'; xc.setAttribute('aria-hidden', 'true');
  el.querySelector('canvas')?.after(xc);
  let ptr = null, cur = null, snap = null, raf = 0, lastT = 0, W = 0, H = 0, dpr = 1, shown = false;
  const wants = () => cursor && !ctx.touch();
  function size() {
    const w = el.clientWidth || 1, h = el.clientHeight || 1, d = Math.min(2, globalThis.devicePixelRatio || 1);
    if (w !== W || h !== H || d !== dpr) { W = w; H = h; dpr = d; xc.width = Math.round(w * d); xc.height = Math.round(h * d); }
  }
  function drawX() {
    size();
    const g = xc.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    if (!cur || !ptr) return;
    const ins = ctx.insets(), ink = ctx.ink(), I = (a) => ctx.rgba(ink, a), x = Math.round(cur.x) + 0.5, y = Math.round(cur.y) + 0.5, gap = snap ? 13 : 9;
    const L = ins.left, R = W - (ins.right ?? 0);
    g.lineWidth = 1; g.strokeStyle = I(snap ? 0.42 : 0.3); g.beginPath();
    g.moveTo(L, y); g.lineTo(x - gap, y); g.moveTo(x + gap, y); g.lineTo(R, y);
    g.moveTo(x, 0); g.lineTo(x, y - gap); g.moveTo(x, y + gap); g.lineTo(x, H);
    g.stroke();
    // the ticks where the lines meet the edges: a chart's border scale, read at a glance
    g.strokeStyle = I(0.55); g.beginPath(); g.moveTo(L, y); g.lineTo(L + 8, y); g.moveTo(R - 8, y); g.lineTo(R, y); g.moveTo(x, 0); g.lineTo(x, 8); g.moveTo(x, H - 8); g.lineTo(x, H); g.stroke();
    g.beginPath(); g.arc(x, y, snap ? 11.5 : 5, 0, Math.PI * 2); g.strokeStyle = I(snap ? 0 : 0.75); if (!snap) g.stroke();
    // the reading: two short lines in the chart's own small figures, a soft dark halo under them
    const w = ctx.toWorld(snap ? snap.px : cur.x, snap ? snap.py : cur.y), r = readout(w[0], w[1], ctx.boat());
    g.font = `500 13px ${ctx.uiFont}`; g.textBaseline = 'top';
    const lines = [r.main, r.sub].filter(Boolean), tw = Math.max(...lines.map((s) => g.measureText(s).width));
    let tx = x + 16, ty = y + (snap ? 24 : 14); const th = lines.length * 17;   // snapped: under the point's own name
    if (tx + tw > R - 10) tx = x - 16 - tw; if (ty + th > H - 60) ty = y - 14 - th;
    g.textAlign = 'left';
    lines.forEach((s, i) => {
      g.lineWidth = 3; g.lineJoin = 'round'; g.strokeStyle = ctx.rgba(ctx.halo(), 0.7); g.strokeText(s, tx, ty + i * 17);
      g.fillStyle = I(i === 0 ? 0.86 : 0.62); g.fillText(s, tx, ty + i * 17);
    });
  }
  function tick() {
    raf = 0;
    if (!shown) return;
    const t = performance.now(), dt = Math.min(0.1, lastT ? (t - lastT) / 1000 : 0); lastT = t;
    if (ptr && wants()) {
      const pts = ctx.points();
      const s = snapTo(pts, ptr.x, ptr.y);
      if ((s?.id ?? null) !== (snap?.id ?? null)) ctx.hover(s?.id ?? null);
      snap = s;
      const target = s ? { x: s.px, y: s.py } : ptr;
      cur = ctx.reduced() ? { ...target } : easeToward(cur ?? target, target, dt);
      drawX();
      raf = requestAnimationFrame(tick);   // while the pointer is on the map: the target moves with the map under it too
    } else { cur = null; snap = null; drawX(); }
  }
  const kick = () => { if (!raf && shown) { lastT = 0; raf = requestAnimationFrame(tick); } };
  const cv = el.querySelector('canvas');
  const onMove = (e) => { if (e.pointerType === 'touch' || !wants()) return; const r = cv.getBoundingClientRect(); ptr = { x: e.clientX - r.left, y: e.clientY - r.top }; kick(); };
  const onLeave = () => { ptr = null; if (snap) ctx.hover(null); snap = null; kick(); };
  cv.addEventListener('pointermove', onMove); cv.addEventListener('pointerleave', onLeave);
  return {
    // the chart's filter: false hides a point (and its name)
    visible: (row) => { const l = layerOf(row.kind); return !l || on.has(l); },
    wakeOn: () => !!wake && on.has('wake'),
    wake,
    get layers() { return active.filter((l) => on.has(l.id)).map((l) => l.id); },
    setLayers(ids) { on.clear(); (ids?.length ? ids : active.map((l) => l.id)).forEach((i) => on.add(i)); syncBar(); ctx.redraw(); },
    // Regatta only: the Races layer joins the bar (right after Places), on; out of Regatta it leaves, and its pins with it
    setRaces(yes) {
      yes = !!yes; if (yes === active.includes(RACES_LAYER)) return;
      const wasAll = on.size === active.length;
      if (yes) {
        active = [LAYERS[0], RACES_LAYER, ...LAYERS.slice(1)]; on.add('races');
        if (bar) { const b = document.createElement('button'); b.type = 'button'; b.textContent = RACES_LAYER.word; b.dataset.layer = 'races'; btns.set('races', b); btns.get('places')?.after(b); }
      } else {
        active = [...LAYERS]; on.delete('races'); btns.get('races')?.remove(); btns.delete('races');
        if (!on.size) active.forEach((l) => on.add(l.id));
      }
      if (wasAll) active.forEach((l) => on.add(l.id));
      syncBar();
    },
    get snapped() { return snap?.id ?? null; },
    get cursor() { return cur ? { x: +cur.x.toFixed(1), y: +cur.y.toFixed(1), pointer: ptr ? { ...ptr } : null } : null; },
    setInset(px) { el.style.setProperty('--lkc-in', `${px}px`); },
    show(v) { shown = !!v; if (bar) bar.hidden = !shown || !!lyb; if (lyb) { lyb.hidden = !shown; setOpen(false); } if (shown) kick(); else { ptr = null; cur = null; snap = null; drawX(); } },
    destroy() { shown = false; if (raf) cancelAnimationFrame(raf); cv.removeEventListener('pointermove', onMove); cv.removeEventListener('pointerleave', onLeave); xc.remove(); bar?.remove(); lyb?.remove(); },
  };
}

// the wake on the chart: a broad soft wash (about 22 m wide, at least 3 px) with a fine cream core, under today's track. voyages: oldest
// first; the newest is drawn at the full style, the one before at 60 %, the oldest at 30 % (UX.wakeFade)
export function drawWake(g, v, voyages, { rgba, ink, deep, mpp }) {
  if (!voyages?.length) return;
  const P = [0, 0];
  g.save(); g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash([]);
  const wide = Math.max(3, Math.min(16, 22 / mpp));
  // a soft cream wash over the sailed water and a fine cream core along it (owner, 2026-11-18: "a little more visible"); the deep navy
  // under the wash keeps it from greying the light shallows
  for (let k = 0; k < voyages.length; k++) {
    const age = voyages.length - 1 - k, f = UX.wakeFade[Math.min(age, UX.wakeFade.length - 1)], segs = voyages[k].segs ?? voyages[k];
    for (const [lw, c, a] of [[wide + 2, deep, 0.28], [wide, ink, 0.13], [Math.max(1.2, wide * 0.2), ink, 0.42]]) {
      g.lineWidth = lw; g.strokeStyle = rgba(c, a * f); g.beginPath();
      for (const s of segs) {
        if (s.length < 2) continue;
        v.toPx(s[0][0], s[0][1], P); g.moveTo(P[0], P[1]);
        for (let i = 1; i < s.length; i++) { v.toPx(s[i][0], s[i][1], P); g.lineTo(P[0], P[1]); }
      }
      g.stroke();
    }
  }
  g.restore();
}
