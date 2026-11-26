// The live chart's model (Phase 2a): the view (centre, metres per pixel, north up), the three sizes,
// the zoom classes and the names' fades, the points of interest with their one action, hit-testing, the Tab walk, the labels' layout.
// Plain JS: no DOM, no canvas, no Math.random, no wall clock; the chart component (v2/ui/chart/liveChart.js) and the node tests read it.
//   chartView({ cx, cz, mpp, w, h })          → { toPx(x, z), toWorld(px, py), … }: world (x east, z south, m) ↔ px, north up
//   zoomAbout(view, px, py, mpp)               → { cx, cz, mpp }: the world point under (px, py) stays under it
//   panBy(view, dx, dy)                        → { cx, cz, mpp }: the map moves with a drag of (dx, dy) px
//   clampView(v, { w, h, size, box, insets })  → v inside the size's zoom range and the paper (ground.js PAPER)
//   frameBirthplaces(list, { w, h, insets, size, card })  → { center: { x, z }, mpp }: the entrance's first view, every birthplace (where
//                                              the chart draws it) inside what the insets leave, with a margin
//   sheetWanted(sheet, v, { w, h, lit })      a lazy sheet's fetch: the view on it at its loadMpp or closer, or the start on it
//   classVisible(cls, mpp, maxClass)           A always, B at mpp ≤ 6, C at mpp ≤ 2.5 (the size's maxClass caps it)
//   fadeTo(a, target, dt)                      a name's alpha one step toward its target (0.2 s for the whole way)
//   buildPois(src, { mode })                   → [{ id, kind, x, z, name, line, zoomClass, action }]
//   actionFor(kind, mode)                      → 'sail' | 'target' | 'anchor' | 'race' | null
//   hitTest(rows, toPx, px, py, r, mpp)        → the nearest shown row within r px, or null
//   walkOrder(rows, cx, cz, mpp)               → the shown rows, nearest the centre first (the Tab walk)
//   layoutLabels(labels, toPx, measure, o)     → [{ id, x, y, w, h, shown }]: by class, then by distance to the centre, no overlaps
//   ease(t)                                    cubic-bezier(.2, 0, 0, 1), the zoom's and the glide's curve
import { GROUND, PAPER } from './ground.js';
import { edgePoint, farName, farLine } from './edge.js';   // a pin past the paper (a region the chart's sheets do not cover) at its edge
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';
import { regionLabelsOf, regionNamesOf } from '../../sim/regions.js';

// metres per pixel of each zoom class's threshold: a name of class B shows at mpp ≤ 6, class C at mpp ≤ 2.5
export const ZOOM_CLASS = Object.freeze({ A: Infinity, B: 6, C: 2.5 });
const RANK = { A: 0, B: 1, C: 2 };
export const FADE_S = 0.2;
// the three sizes of the one component: the card's map, the full-window menu map, the in-play chart.
//   minMpp, maxMpp   the zoom range (1.2 m a pixel: a cove, the tea house about 4 px; the widest: the card and the menu out to every
//                    birthplace, the bay to South Lake, kept inside the paper; in play the whole bay)
//   maxClass         the closest names this size shows (the card: A and B, as a phone's)
//   follow           the view follows the boat until a pan (in play)
//   bayWide          the widest zoom is the bay's ground's (in play: the whole bay at most, as before the sheets; it pans the paper)
export const SIZES = Object.freeze({
  card: Object.freeze({ minMpp: 2.5, maxMpp: 48, maxClass: 'B', follow: false }),
  menu: Object.freeze({ minMpp: 1.2, maxMpp: 48, maxClass: 'C', follow: false }),
  play: Object.freeze({ minMpp: 1.2, maxMpp: 6.5, maxClass: 'C', follow: true, bayWide: true }),
});
// the bookmarks (keys 1 · 2 · 3): the whole bay, mid, a cove
export const BOOKMARKS = Object.freeze([6.5, 3, 1.4]);
// the names' ink: cream at 55 % on the water, 68 % on the land, 94 % when lifted (hover or focus)
export const INK = Object.freeze({ water: 0.55, land: 0.68, lifted: 0.94, sounding: 0.5 });
// the night's names (owner, 2026-11-18: the night chart readable at arm's length, names at 4.5:1 or better): a cool moonlight cream at
// higher alphas over a soft dark halo (the halo's colour and strength under the glyphs); v2/tests/live-chart.test.mjs checks the contrast
export const NIGHT_INK = Object.freeze({ ink: Object.freeze([214, 222, 236]), water: 0.86, land: 0.9, sounding: 0.7, halo: Object.freeze([12, 18, 30]), haloA: 0.7 });
export const HIT_PX = Object.freeze({ mouse: 16, touch: 24 });
export const ACTION_WORDS = Object.freeze({ sail: 'Sail from here', target: 'Set as target', anchor: 'Anchor here', race: 'Start a race here', raceHere: 'Race here', beTessie: 'Be Tessie' });   // beTessie: her water's card in play

import { clampT as clamp } from '../../../src/sim/core/math.js';

export function chartView({ cx = 0, cz = 0, mpp = 4, w = 800, h = 600 } = {}) {
  const k = 1 / mpp, ox = w / 2, oy = h / 2;
  return {
    cx, cz, mpp, w, h,
    toPx(x, z, out = [0, 0]) { out[0] = ox + (x - cx) * k; out[1] = oy + (z - cz) * k; return out; },
    toWorld(px, py, out = [0, 0]) { out[0] = cx + (px - ox) * mpp; out[1] = cz + (py - oy) * mpp; return out; },
    dirPx(bearing) { return [Math.sin(bearing), -Math.cos(bearing)]; },   // a bearing (rad, clockwise from north) as a px direction
  };
}
export function zoomAbout(v, px, py, mpp) {
  const [wx, wz] = chartView(v).toWorld(px, py);
  return { cx: wx - (px - v.w / 2) * mpp, cz: wz - (py - v.h / 2) * mpp, mpp };
}
export const panBy = (v, dx, dy) => ({ cx: v.cx - dx * v.mpp, cz: v.cz - dy * v.mpp, mpp: v.mpp });

// the widest mpp at which a w × h view still lies inside the box
const fitMpp = (w, h, box = PAPER) => Math.min((box.x1 - box.x0) / Math.max(1, w), (box.z1 - box.z0) / Math.max(1, h));
export function zoomRange(w, h, size = 'play', box = PAPER) {
  const S = SIZES[size] ?? SIZES.play, hi = Math.min(S.maxMpp, fitMpp(w, h, box), S.bayWide ? fitMpp(w, h, GROUND.box) : Infinity);
  return { min: Math.min(S.minMpp, hi), max: hi };
}
export function clampView(v, { w, h, size = 'play', box = PAPER } = {}) {
  const r = zoomRange(w, h, size, box), mpp = clamp(v.mpp, r.min, r.max);
  const hw = (w / 2) * mpp, hh = (h / 2) * mpp;
  const cx = box.x1 - box.x0 <= 2 * hw ? (box.x0 + box.x1) / 2 : clamp(v.cx, box.x0 + hw, box.x1 - hw);
  const cz = box.z1 - box.z0 <= 2 * hh ? (box.z0 + box.z1) / 2 : clamp(v.cz, box.z0 + hh, box.z1 - hh);
  return { cx, cz, mpp };
}
// the centre that puts the world point (x, z) at the middle of what the insets leave (a panel on the left: insets.left px)
export function centreFor(x, z, mpp, insets = {}) {
  const l = insets.left ?? 0, r = insets.right ?? 0, t = insets.top ?? 0, b = insets.bottom ?? 0;
  return { cx: x - ((l - r) / 2) * mpp, cz: z - ((t - b) / 2) * mpp };
}

// The entrance's first view (owner, 2026-11-24: the default chart view includes every birthplace): the birthplaces of every region row
// (list: [{ x, z, locked? }], the service's), each where the chart draws it (a pin past the paper at its edge), framed in what the insets
// leave less a margin a side, 12 % more round them, at the size's zoom range; centred in that free part. The margins (px):
//   panel   the desktop's and the tablet's map beside the panel: 95 each side for the names, 75 top and bottom (the layer bar, the fact)
//   card    a phone's box: 24 on the left, 76 on the right (its layers, + and − column, 44 px buttons), 28 top and bottom
export const FRAME = Object.freeze({ panel: Object.freeze({ l: 95, r: 95, t: 75, b: 75 }), card: Object.freeze({ l: 24, r: 76, t: 28, b: 28 }), k: 1.12 });
export function frameBirthplaces(list, { w, h, insets = {}, size = 'menu', card = false, box = PAPER } = {}) {
  const pts = (list ?? []).filter((r) => !r.locked && Number.isFinite(r.x) && Number.isFinite(r.z)).map((r) => edgePoint(r.x, r.z, box));
  if (!pts.length || !w) return null;
  const m = card ? FRAME.card : FRAME.panel;
  const ins = { left: (insets.left ?? 0) + m.l, right: (insets.right ?? 0) + m.r, top: (insets.top ?? 0) + m.t, bottom: (insets.bottom ?? 0) + m.b };
  const freeW = Math.max(120, w - ins.left - ins.right), freeH = Math.max(120, h - ins.top - ins.bottom);
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const { min, max } = zoomRange(w, h, size, box);
  const mpp = clamp(Math.max((x1 - x0) / freeW, (z1 - z0) / freeH, 0.001) * FRAME.k, min, max);
  const c = centreFor((x0 + x1) / 2, (z0 + z1) / 2, mpp, ins);
  return { center: { x: c.cx, z: c.cz }, mpp };
}

// a lazy sheet (ground.js SHEETS.south) is fetched when the view (w × h px) overlaps its box at its loadMpp or closer, or when the lit
// birthplace (the start: lit { x, z }) is on it; never for a view of the whole lake or a start elsewhere
export function sheetWanted(sheet, v, { w = 0, h = 0, lit = null } = {}) {
  if (!sheet?.lazy) return true;
  const B = sheet.box, inB = (x, z) => x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1;
  if (lit && Number.isFinite(lit.x) && inB(lit.x, lit.z)) return true;
  if (!v || !(v.mpp <= (sheet.loadMpp ?? Infinity))) return false;
  const hw = (w / 2) * v.mpp, hh = (h / 2) * v.mpp;
  return v.cx + hw > B.x0 && v.cx - hw < B.x1 && v.cz + hh > B.z0 && v.cz - hh < B.z1;
}

export const classVisible = (cls, mpp, maxClass = 'C') => RANK[cls] <= RANK[maxClass] && mpp <= ZOOM_CLASS[cls];
export function fadeTo(a, target, dt, T = FADE_S) {
  const s = dt / T;
  return a < target ? Math.min(target, a + s) : Math.max(target, a - s);
}

// ---- the names set into the land and the water: world m, the class, water (italic) or land (upright); angle: the
// text's turn in degrees (the bay's name along its axis) ----
// the regions' own names first: each region row's label in the lake profile's region table (v2/sim/regions.js; refactor round 3 C5)
export const NAMES = Object.freeze([
  ...regionLabelsOf(CURRENT_WATERS),
  ...regionNamesOf(CURRENT_WATERS),   // the regions' towns and marinas (South Lake's: Ski Run, Tahoe Keys, Camp Richardson)
  { id: 'n-fannette', text: 'Fannette Island', x: 0, z: 110, cls: 'A', kind: 'land', pri: -1, alt: [[0, -85], [-250, -110], [-40, 135], [40, -105], [-260, 120]] },
  { id: 'n-vikingsholm', text: 'Vikingsholm', x: -640, z: 330, cls: 'B', kind: 'land' },
  { id: 'n-falls', text: 'Eagle Falls', x: -960, z: 250, cls: 'B', kind: 'land' },
  { id: 'n-emerald-pt', text: 'Emerald Point', x: 1180, z: -1520, cls: 'B', kind: 'land' },
  { id: 'n-eagle-pt', text: 'Eagle Point', x: 1950, z: -980, cls: 'B', kind: 'land' },
  { id: 'n-narrows', text: 'The narrows', x: 1010, z: -900, cls: 'B', kind: 'water' },
  { id: 'n-beach', text: 'the beach', x: -600, z: 160, cls: 'C', kind: 'land' },
]);

// one name a place (owner, 2026-11-18): a static name whose place is also a birthplace (Vikingsholm) gives way to the pin's own label
export const namesFor = (birthplaces = []) => { const bp = new Set(birthplaces.map((b) => String(b.name).toLowerCase())); return NAMES.filter((n) => !bp.has(n.text.toLowerCase())); };

// ---- the points of interest: one list from what the page has ----
// kind → its zoom class and its line when the source gives none
const KINDS = Object.freeze({
  birthplace: { cls: 'A' }, anchorage: { cls: 'B' }, place: { cls: 'B' }, area: { cls: 'B' }, channel: { cls: 'B' },
  buoy: { cls: 'C' }, barge: { cls: 'A' }, raceMark: { cls: 'A' }, racePin: { cls: 'A' }, corner: { cls: 'B' },
});
// the one action each kind offers, by where the chart is open: 'entrance' (the first card: no lake yet), 'play' (Sail, Cruise), 'hub'
// (Regatta's hub). At the entrance a place can be the first sail's target; anchoring and racing wait for play and the hub
export function actionFor(kind, mode = 'play') {
  switch (kind) {
    case 'birthplace': return mode === 'hub' ? null : 'sail';
    case 'anchorage': return mode === 'play' ? 'anchor' : mode === 'entrance' ? 'target' : null;
    case 'place': case 'area': case 'channel': case 'barge': return mode === 'hub' ? null : 'target';
    case 'raceMark': return mode === 'hub' ? 'race' : null;
    case 'racePin': return mode === 'entrance' ? null : 'raceHere';   // a place race's pin: Race here, in play and in the hub; the entrance has no lake yet
    default: return null;   // a buoy: a card only
  }
}
// src: { birthplaces: [{ id, name, x, z, why }], current, anchorages: [{ x, z, name, depth }], places: [{ id, name, x, z, line }],
// beTessie: true where she can be played (desktop and tablet, never in a race): the flagged pin's card (Off Fannette) adds "Be Tessie" in play
// areas: [{ id, name, x, z, r, line }], aids: [{ id, x, z, number, lightText, colour }], channel: { pts, line } | null,
// barges: [{ x, z, line, at: { x, z } }], raceMarks: [{ id, x, z, line }], racePins: [{ id, name, x, z, no, line }],
// corners: [{ id, hunt, name, x, z, found, line }] (the cups' hunts, v2/regatta/hunts.js: ◇ until found, filled after; a card only) }
export function buildPois(src = {}, { mode = 'play' } = {}) {
  const rows = [];
  const add = (r) => rows.push({ ...r, zoomClass: r.zoomClass ?? KINDS[r.kind].cls, action: actionFor(r.kind, mode) });
  // a birthplace past the chart's paper (a region its sheets do not cover yet; South Lake's is on the paper) stands at the paper's edge
  // toward it, its name with the continuation mark; a tap picks it as any pin (the service moves her to the real place)
  for (const b of src.birthplaces ?? []) { const e = edgePoint(b.x, b.z, PAPER); add({ id: `bp-${b.id}`, ref: b.id, kind: 'birthplace', x: e.x, z: e.z, name: e.far ? farName(b.name) : b.name, line: e.far ? farLine(b.why, e) : b.why ?? '', ...(b.mark ? { mark: b.mark } : {}), ...(b.mark && src.beTessie && mode === 'play' ? { actions: [actionFor('birthplace', mode), 'beTessie'] } : {}), lit: b.id === src.current, ...(e.far ? { far: true, at: [b.x, b.z] } : {}) }); }
  for (const a of src.anchorages ?? []) add({ id: `an-${Math.round(a.x)}-${Math.round(a.z)}`, kind: 'anchorage', x: a.x, z: a.z, name: a.name,
    line: a.depth != null ? `${Math.round(a.depth)} m of water, good holding.` : 'Good holding.', lit: !!a.lit });   // lit: the boat is inside it (the anchorage cue)
  for (const p of src.places ?? []) add({ id: `pl-${p.id}`, ref: p.id, kind: 'place', x: p.x, z: p.z, name: p.name, line: p.line ?? '', zoomClass: p.zoomClass });
  for (const a of src.areas ?? []) add({ id: `ar-${a.id}`, ref: a.id, kind: 'area', x: a.x, z: a.z, r: a.r ?? 0, name: a.name, line: a.line ?? '', ...(a.actions && mode === 'play' ? { actions: [actionFor('area', mode), ...a.actions] } : {}) });   // actions: more on its card (Be Tessie, in play)
  for (const m of src.aids ?? []) add({ id: `bu-${m.id}`, ref: m.id, kind: 'buoy', x: m.x, z: m.z, colour: m.colour ?? null, name: m.number ? `Buoy "${m.number}"` : 'Buoy',
    line: m.lightText ? `"${m.number}" ${m.lightText}` : m.colour === 'white' ? 'No wake: 5 mph inside.' : 'Unlit.' });
  if (src.channel?.pts?.length) {
    const p = src.channel.pts, mid = p[Math.floor(p.length / 2)];
    add({ id: 'ch-mouth', kind: 'channel', x: mid[0], z: mid[1], name: 'The channel', line: src.channel.line ?? '36 m wide, 4 m deep. Keep right.', at: { x: p[p.length - 1][0], z: p[p.length - 1][1] } });
  }
  for (const [i, b] of (src.barges ?? []).entries()) add({ id: `bg-${i}`, kind: 'barge', x: b.x, z: b.z, name: 'The show barges', line: b.line ?? '', at: b.at ?? null });
  for (const m of src.racePins ?? []) add({ id: `rp-${m.id}`, ref: m.id, kind: 'racePin', x: m.x, z: m.z, name: m.name, no: m.no ?? null, line: m.line ?? '' });
  for (const m of src.raceMarks ?? []) add({ id: `rm-${m.id}`, ref: m.id, kind: 'raceMark', x: m.x, z: m.z, name: m.name ?? 'Mark', line: m.line ?? '' });
  for (const c of src.corners ?? []) add({ id: `cn-${c.id}`, ref: c.id, kind: 'corner', x: c.x, z: c.z, name: c.name, line: c.line ?? '', found: !!c.found, hunt: c.hunt ?? null });
  return rows;
}
// the place races' pins from places.js listCups(): one per available race, at its start line's middle, numbered in its cup; the card's
// line is its length, minutes and best ("0.72 km · about 5 min · best 2:58 · gold"), its name the race's own
const mmss = (t) => `${Math.floor(t / 60)}:${(t - Math.floor(t / 60) * 60).toFixed(1).padStart(4, '0')}`;
export function racePins(cups = []) {
  const out = [];
  for (const c of cups) c.races.filter((r) => r.available && r.at).forEach((r, i) => out.push({ id: r.id, name: r.name, x: r.at[0], z: r.at[1], no: i + 1, cup: c.name,
    line: `${r.km.toFixed(2)} km · about ${r.mins} min${r.best ? ` · best ${mmss(r.best.timeS)}${r.best.medal ? ` · ${r.best.medal}` : ''}` : ''}` }));
  return out;
}
// where an action aims: an area at its edge nearest the boat, the channel at its mouth, a barge at its viewing spot, else the point
export function aimOf(row, boat = null) {
  if (row.kind === 'area' && row.r > 0 && boat) {
    const dx = boat.x - row.x, dz = boat.z - row.z, d = Math.hypot(dx, dz) || 1;
    return d <= row.r ? { x: boat.x, z: boat.z } : { x: row.x + (dx / d) * row.r, z: row.z + (dz / d) * row.r };
  }
  return row.at ? { x: row.at.x, z: row.at.z } : { x: row.x, z: row.z };
}
export const poiShown = (row, mpp, maxClass = 'C') => row.lit || classVisible(row.zoomClass, mpp, row.zoomClass === 'A' ? 'A' : maxClass);

export function hitTest(rows, toPx, px, py, r = HIT_PX.mouse, mpp = 1, maxClass = 'C') {
  let hit = null, hd = r;
  const q = [0, 0];
  for (const row of rows) {
    if (!poiShown(row, mpp, maxClass)) continue;
    toPx(row.x, row.z, q);
    const d = Math.hypot(q[0] - px, q[1] - py);
    if (d < hd || (d === hd && hit && row.zoomClass < hit.zoomClass)) { hd = d; hit = row; }
  }
  return hit;
}
export const walkOrder = (rows, cx, cz, mpp, maxClass = 'C') => rows.filter((r) => poiShown(r, mpp, maxClass))
  .map((r) => [r, Math.hypot(r.x - cx, r.z - cz)]).sort((a, b) => a[1] - b[1] || (a[0].id < b[0].id ? -1 : 1)).map((e) => e[0]);

// the names' layout: each shown class's names in class order, then nearest the view's centre first, at their own spot, or at their
// alternative spots in order (alt: [[x, z], …]: an island's name under it, else over it; pri: first within its class); a name that overlaps a placed one, a kept box
// (a pin, the boat) or the edge at every spot waits. measure(name) → { w, h } in px (unturned; a turned name is a row of boxes on its line)
export function layoutLabels(labels, toPx, measure, { w, h, mpp, maxClass = 'C', keep = [], cx = 0, cz = 0, pad = 4 } = {}) {
  const boxes = keep.map((b) => [...b]), out = [], q = [0, 0];
  const cand = labels.filter((l) => classVisible(l.cls, mpp, maxClass))
    .map((l) => [l, Math.hypot(l.x - cx, l.z - cz)]).sort((a, b) => RANK[a[0].cls] - RANK[b[0].cls] || (a[0].pri ?? 0) - (b[0].pri ?? 0) || a[1] - b[1]).map((e) => e[0]);
  for (const l of cand) {
    const m = measure(l), a = ((l.angle ?? 0) * Math.PI) / 180, bw = Math.abs(m.w * Math.cos(a)) + Math.abs(m.h * Math.sin(a)), bh = Math.abs(m.w * Math.sin(a)) + Math.abs(m.h * Math.cos(a));
    let placed = null, first = null;
    // the world spots (alt), then, for a pin's name, the other sides of its mark (altPx: [dx, dy, align]: right, below, left, above)
    const spots = [[l.x, l.z, l.dx ?? 0, l.dy ?? 0, l.align], ...(l.alt ?? []).map(([x, z]) => [x, z, l.dx ?? 0, l.dy ?? 0, l.align]), ...(l.altPx ?? []).map(([dx, dy, al]) => [l.x, l.z, dx, dy, al])];
    for (const [x, z, ddx, ddy, align] of spots) {
      toPx(x, z, q);
      q[0] += ddx; q[1] += ddy;   // a pin's name: set off its mark by (dx, dy) px, its left edge there (align 'left')
      first ??= [q[0], q[1]];
      const lx = align === 'left' ? q[0] : align === 'right' ? q[0] - bw : q[0] - bw / 2;
      const b = [lx - pad, q[1] - bh / 2 - pad, lx + bw + pad, q[1] + bh / 2 + pad];
      if (b[0] < 0 || b[2] > w || b[1] < 0 || b[3] > h) continue;   // wholly on the chart, never cut by its edge
      const np = Math.max(1, Math.ceil(m.w / m.h));
      const parts = a ? Array.from({ length: np }, (_, i) => {
        const t = ((i + 0.5) / np - 0.5) * m.w, px = q[0] + Math.cos(a) * t, py = q[1] + Math.sin(a) * t, r = m.h / 2 + pad;
        return [px - r, py - r, px + r, py + r];
      }) : [b];
      if (parts.some((p) => boxes.some((o) => p[0] < o[2] && p[2] > o[0] && p[1] < o[3] && p[3] > o[1]))) continue;
      boxes.push(...parts); placed = [q[0], q[1], align]; break;
    }
    const at = placed ?? first;
    out.push({ id: l.id, x: at[0], y: at[1], w: m.w, h: m.h, shown: !!placed, align: placed ? placed[2] : l.align });
  }
  for (const l of labels) if (!out.some((o) => o.id === l.id)) out.push({ id: l.id, x: NaN, y: NaN, w: 0, h: 0, shown: false });
  return out;
}

// cubic-bezier(.2, 0, 0, 1): x(s) = 3(1−s)²s·0.2 + s³ solved for s by Newton, then y(s) = 3(1−s)s² + s³
export function ease(t) {
  if (t <= 0) return 0; if (t >= 1) return 1;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const x = 0.6 * (1 - s) * (1 - s) * s + s * s * s - t, dx = 0.6 * (1 - s) * (1 - 3 * s) + 3 * s * s;
    if (Math.abs(dx) < 1e-6) break;
    s = clamp(s - x / dx, 0, 1);
  }
  return 3 * (1 - s) * s * s + s * s * s;
}
