// A phone's flat controls (option C, thumb arcs; owner 2026-11-16: "drop the 3D cockpit on phones"). A phone held
// sideways (or upright, turned: ui/landscape.js) has no 3D cockpit; these DOM controls take its place. Tablets and desktops keep the
// cockpit (ui/station.js). One material, the top bar's: frosted navy glass, one cream hairline, cream icons and words in the bar's
// type; amber only while Auto is on, a tack or gybe the player started runs, or the engine is in gear.
// One interaction rule (owner, 2026-11-16): the rings are dragged, the corner quarters are tapped.
//   - the corners: a frosted quarter disc in each bottom corner, centred on the safe area's corner. Right: the assist (ui/assist.js:
//     Tack, Gybe, Free out of irons, Refloat aground; a word and an icon per state, dim where a press does nothing), STOP (neutral)
//     while the motor runs. Left: Auto, the desktop's AUTO (ui/autopilot.js): it holds the heading she has, or
//     sails to a double-tap mark or chart target (the navigator; under engine it steers there); any drag on the steer ring hands the
//     helm back. In Cruise the left quarter is "Take the helm" and nothing else shows.
//   - the rings: concentric round each quarter, FLAT.gap away, like an instrument's bezel, engraved cream ticks.
//     Steer ring (left): a slim cream needle rides it at the rudder (the centre tick is amidships); a drag takes the wheel at the
//     rudder she has, FLAT.steerDeg of sweep is full helm, clockwise = starboard.
//     Sheet ring (right): a needle at the main's sheet (the top end sheeted in, the bottom end eased out) and a soft band where the
//     crew would trim it for this wind (the boat's crewSheet); a drag sets the sheet (relative, past a slop), a tap on either half
//     nudges one step. Sheets Split: the ring is the main's, a small inner ring the jib's; both end at FLAT.splitDeg, clear of "⋯".
//     Under motor the same ring crossfades (0.3 s) into the throttle ring: Ahead the upper half, Astern the lower, N the detent at
//     the middle, the lever's notches as ticks; a drag moves the lever (the release snaps to a notch), a tap steps a notch. The crew
//     trims the sails meanwhile.
//   - "⋯": a round button of its own at the right edge under the wind dial, FLAT.moreClear from either ring (owner, 2026-11-16:
//     a drag on a ring never reaches it); the drawer (Sails, Engine, Anchor, Pro; Restart in a race instead of Anchor); Pro on opens the Pro panel (Reef, Sheets
//     Both | Split, Crew, Traveller, Vang, Jib lead, Backstay). A tap outside closes them.
//   - the dials: the game's own chart and wind dials shrunk into the top corners; no speed or heading readout (the chart dial shows both), and Recentre
//     is a round button like "⋯", mirrored on the left edge under the chart dial, shown only while the view is off-centre (owner, 2026-11-17).
//   - the camera: one finger on the water looks round, two pinch (ui/touch.js oneLook); FLAT.returnS after the last finger it eases
//     back behind the boat in FLAT.easeS; the Recentre chip shows only while the player has moved it off.
//   - the thumb zones (owner, 2026-11-17): round each corner, FLAT.guard past the outer ring and out to the screen's edges, an invisible
//     zone under the controls takes any press that misses the drawn ring or quarter (zonePick: the nearest one); a ring's press is
//     captured until the finger lifts. The camera only ever gets a press that starts on the open water.
//   - Regatta: the race clock in the wind dial, the next mark's bearing on the chart dial's ring, the race chip top centre, the line
//     readout and the Helper under the chart dial, the coach's line along the foot; the results card alone.
// The DOM is built on the first active frame; a frame writes the DOM only when a shown value changes.
//   const fl = createFlat({ ... });  each frame before the boat's step: fl.update(dt); then B.station({ helm: fl.helm, main: fl.take('main'), ... })
import { PILOT_LABEL } from './pilotLabel.js';   // the autopilot button's name (NAV; owner 2026-11-17)
import { features } from '../../src/core/features.js';
import { ensureTokens } from '../../src/ui/tokens.js';
import { HELM_IN } from '../../src/stations/sloop/helmInput.js';
import { NOTCHES, notchIndex } from '../../src/stations/sloop/throttleLever.js';

const DEG = Math.PI / 180;
export const FLAT = Object.freeze({
  band: 44,          // each ring's width, px (a finger)
  gap: 8, gapSmall: 6,   // between a quarter and its ring, and between two rings (the compact tier's tighter)
  quarter: 72, quarterSmall: 64,   // the corner quarters' radius (≥ 60, owner); the compact one under FLAT.tall
  tall: 370,         // a visible frame this tall or more takes the full sizes (a Home Screen launch); under it the compact tier (a browser
                     // tab, 320–360 px tall:; ui/screenFit.js SCREEN.tall is the same line)
  steerDeg: 31,      // the steer ring's sweep for full helm from amidships (amidships at 45°)
  splitDeg: 55,      // with Sheets Split both right rings end here, clear of "⋯" (owner: no target on or next to a ring's end)
  moreClear: 24,     // "⋯" stays this far from either ring's outer edge
  slop: 6,           // px a press travels before it is a drag (a tap nudges)
  guard: 30,         // the thumb zone round each corner: this far past the outer ring's edge, and the whole corner to the screen's
                     // edges, belongs to the controls (owner, 2026-11-17: "too easy to mis-trigger the camera"); a press there that
                     // misses the drawn ring or quarter goes to the nearest one, never to the camera
  tapDrift: 14,      // px a press on a zone's quarter part may travel and still be the quarter's tap
  sheet: [12 * DEG, 80 * DEG],     // the main's sheeting range (src/sim/sail/sheets.js HAND.min, max)
  jib: [8 * DEG, 80 * DEG],        // the jib's drawn range on its ring
  ideal: 4 * DEG,                  // the ideal-trim band: the crew's sheet ± this
  dial: 76, dialSmall: 56,
  returnS: 3, easeS: 0.8, fadeS: 0.3,
  offDeg: 8, offZoom: 0.1, movedDeg: 2, movedZoom: 0.03,
  detent: 0.1,
  edge: 16, foot: 12,
});
const clamp = (v, a = -1, b = 1) => Math.max(a, Math.min(b, v));
import { wrap } from '../../src/sim/core/math.js';
export const smootherstep = (k) => { const x = clamp(k, 0, 1); return x * x * x * (x * (6 * x - 15) + 10); };
// the steer ring's helm (pure): the sweep since the press (degrees, + = anticlockwise, toward port) on top of the helm at the press
export const arcHelm = (h0, a0, a, steerDeg = FLAT.steerDeg) => clamp(h0 + (a0 - a) / steerDeg);
// the steer needle's angle for a rudder (pure): amidships 45°, full port 76°, full starboard 14°
export const knobDeg = (rudder, max = HELM_IN.rudderMax, steerDeg = FLAT.steerDeg) => 45 - clamp(rudder / max) * steerDeg;
// the sheet ring (pure): a sheet (rad) ↔ its angle on the ring, the top end (span) sheeted in, 0 eased out
export const sheetDeg = (sheet, span, range = FLAT.sheet) => span * clamp((range[1] - sheet) / (range[1] - range[0]), 0, 1);
export const sheetAt = (a, span, range = FLAT.sheet) => range[1] - clamp(a / span, 0, 1) * (range[1] - range[0]);
// the throttle ring (pure): the lever ↔ its angle (Astern 0 … N span/2 … Ahead span), N a detent; the notch a released lever snaps to
export const leverDeg = (v, span) => span / 2 + clamp(v) * span / 2;
export function leverFromDeg(a, span, detent = FLAT.detent) { const v = clamp((a - span / 2) / (span / 2)); return Math.abs(v) < detent ? 0 : v; }
export const leverSnap = (v) => NOTCHES[notchIndex(v)].v;
// a point at angle a (degrees above the horizontal toward the middle) and radius r round a corner pivot (side +1 left, −1 right)
export const arcPt = (p, a, r) => ({ x: p.x + p.side * r * Math.cos(a * DEG), y: p.y - r * Math.sin(a * DEG) });
// a finger's angle round a pivot (degrees, as arcPt)
export const arcAngle = (p, x, y) => Math.atan2(p.y - y, p.side * (x - p.x)) / DEG;

// The layout (pure). w, h: the frame; inset: the safe area { l, r, b }; capTop: the top bar's foot (--lk-cap-top); split: Sheets
// Split (the jib's inner ring); mode: 'sail' | 'race' | 'cruise'. Shapes for the overlap checks: { kind: 'rect', x, y, w, h } |
// { kind: 'circle', cx, cy, r } | { kind: 'quarter', p, r } | { kind: 'band', p, r0, r1, a0, a1 }.
export function flatLayout({ w, h, inset = {}, capTop = 62, split = false, mode = 'sail' } = {}) {
  const SL = Math.max(inset.l ?? 0, FLAT.edge), SR = Math.max(inset.r ?? 0, FLAT.edge), SB = Math.max(inset.b ?? 0, FLAT.foot);
  const tall = h >= FLAT.tall, q = tall ? FLAT.quarter : FLAT.quarterSmall, bw = FLAT.band, g = tall ? FLAT.gap : FLAT.gapSmall;
  const ring = (r0) => ({ r0, r: r0 + bw / 2, r1: r0 + bw });
  const steer = { ...ring(q + g), a0: 0, a1: 90 };
  const jib = split ? { ...ring(q + g), a0: 0, a1: FLAT.splitDeg } : null;
  const main = { ...ring(split ? jib.r1 + g : q + g), a0: 0, a1: split ? FLAT.splitDeg : 90 };
  const pl = { x: SL, y: h - SB, side: 1 }, pr = { x: w - SR, y: h - SB, side: -1 };
  const d = tall ? FLAT.dial : FLAT.dialSmall, top = Math.round(capTop - 2);
  const dials = { chart: { x: SL + 8, y: top, d }, wind: { x: w - SR - 8 - d, y: top, d } };
  // "⋯": its own round button at the right edge under the wind dial, never on a ring (owner, 2026-11-16)
  let more = { x: pr.x - 22, y: dials.wind.y + d + g + 22, r: 22 };
  // the compact tier's shortest frames (about 320 px): too near the sheet ring under the dial, it moves beside the dial instead
  if (Math.hypot(pr.x - more.x, pr.y - more.y) - main.r1 - more.r < FLAT.moreClear) more = { x: dials.wind.x - g - 22, y: dials.wind.y + d / 2, r: 22 };
  const L = { w, h, SL, SR, SB, q, g, pl, pr, steer, main, jib, more, dials, mode, split, tall };
  const footL = pl.x + steer.r1 + 8, footR = pr.x - main.r1 - 8;   // the foot's free span between the two rings
  if (mode === 'race') {
    L.chip = { x: Math.round(w / 2 - 85), y: top, w: 170, h: 44 };
    L.readout = { x: dials.chart.x, y: top + d + 6, w: 162, h: 44, lines: 2 };
    L.helper = { x: dials.chart.x + 170, y: top + d + 6, w: 80, h: 44 };
    L.pick = { x: L.readout.x + 258, y: top + 44 + 6, w: Math.min(dials.wind.x, more.x - 22) - 8 - (L.readout.x + 258), h: 56 };
    if (L.pick.y + L.pick.h > pr.y - main.r1 - 8) L.pick.w = Math.min(L.pick.w, pr.x - main.r1 - 8 - L.pick.x);   // a short frame: clear of the sheet ring
    L.coach = { x: footL, y: h - SB - 4 - 52, w: footR - footL, h: 52 };
  } else {
  }
  // Recentre (owner, 2026-11-17): a round button like "⋯", mirrored on the left edge under the chart dial. It stays FLAT.moreClear past the left thumb zone (FLAT.guard past the steer ring) and steps beside the dial when
  // the ring is too near, and always in a race (the line readout and the Helper sit under the dial there)
  L.recentre = { x: pl.x + 22, y: dials.chart.y + d + g + 22, r: 22 };
  if (mode === 'race' || Math.hypot(pl.x - L.recentre.x, pl.y - L.recentre.y) - steer.r1 - 22 < FLAT.guard + FLAT.moreClear) L.recentre = { x: dials.chart.x + d + g + 22, y: dials.chart.y + Math.round(d / 2), r: 22 };
  const rows = 4, dh = 12 + 30 + rows * 44 + (rows - 1) * 8 + 16;
  L.drawer = { x: Math.round(more.x - 22 - 8 - 280), y: top, w: 280, h: dh };   // left of "⋯", which stays above the veil and closes it
  L.pro = { x: SL + 6, y: top, w: L.drawer.x - 10 - (SL + 6), h: dh };
  L.shapes = flatShapes(L);
  // the thumb zones (owner, 2026-11-17): FLAT.guard past each corner's outer ring, the corner to the screen's edges, but 4 px short
  // of every other control (a dial, "⋯", Recentre, the race's chip, picker and Helper: only the shortest frames' right zone shrinks)
  const others = Object.entries(L.shapes).filter(([k]) => !['auto', 'tack', 'take', 'steer', 'sheet', 'jib', 'readout', 'coach'].includes(k)).map(([, v]) => v);
  const zone = (p, r) => ({ p, r: Math.min(r, ...others.map((o) => zoneReach(p, o) - 4)) });
  L.zones = { l: zone(pl, steer.r1 + FLAT.guard), r: zone(pr, main.r1 + FLAT.guard) };
  return L;
}
// the shapes the screen shows for a layout (the drawer and the Pro panel apart: they cover the rest on purpose)
export function flatShapes(L) {
  const S = {};
  if (L.mode === 'cruise') { S.take = { kind: 'quarter', p: L.pl, r: L.q }; return S; }
  const band = (p, R, a0 = R.a0, a1 = R.a1) => ({ kind: 'band', p, r0: R.r0, r1: R.r1, a0, a1 });
  S.auto = { kind: 'quarter', p: L.pl, r: L.q };
  S.tack = { kind: 'quarter', p: L.pr, r: L.q };
  S.steer = band(L.pl, L.steer);
  S.sheet = band(L.pr, L.main);
  S.more = { kind: 'circle', cx: L.more.x, cy: L.more.y, r: 22 };
  if (L.jib) S.jib = band(L.pr, L.jib);
  for (const k of ['chart', 'wind']) { const dd = L.dials[k]; S[`dial-${k}`] = { kind: 'circle', cx: dd.x + dd.d / 2, cy: dd.y + dd.d / 2, r: dd.d / 2 }; }
  if (L.readout) S.readout = { kind: 'rect', ...L.readout };
  if (L.helper) S.helper = { kind: 'rect', ...L.helper };
  S.recentre = { kind: 'circle', cx: L.recentre.x, cy: L.recentre.y, r: 22 };
  if (L.chip) S.chip = { kind: 'rect', ...L.chip };
  if (L.coach) S.coach = { kind: 'rect', ...L.coach };
  if (L.pick) S.pick = { kind: 'rect', ...L.pick };
  return S;
}
// is the point inside a shape (pure)
export function inShape(s, x, y) {
  if (s.kind === 'rect') return x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h;
  if (s.kind === 'circle') return Math.hypot(x - s.cx, y - s.cy) <= s.r;
  const dx = s.p.side * (x - s.p.x), dy = s.p.y - y, rr = Math.hypot(dx, dy);
  if (dx < 0 || dy < 0) return false;
  if (s.kind === 'quarter') return rr <= s.r;
  const a = Math.atan2(dy, dx) / DEG;
  return rr >= s.r0 && rr <= s.r1 && a >= s.a0 && a <= s.a1;
}
// a thumb zone (pure): within z.r of the corner pivot, or anywhere between the pivot and the screen's side or foot edge (the strip
// under the notch or the home indicator) up to z.r along the other axis
export function inZone(z, x, y) {
  const dx = z.p.side * (x - z.p.x), dy = z.p.y - y;
  if (dx <= 0 && dy <= z.r) return true;
  if (dy <= 0 && dx <= z.r) return true;
  return Math.hypot(dx, dy) <= z.r;
}
// the least zone radius that reaches a shape (pure): inZone's measure, hypot of the parts toward the middle, over the shape's outline
export function zoneReach(p, s) {
  const pts = [];
  if (s.kind === 'circle') for (let i = 0; i < 72; i++) pts.push([s.cx + s.r * Math.cos(i * 5 * DEG), s.cy + s.r * Math.sin(i * 5 * DEG)]);
  else if (s.kind === 'rect') for (let i = 0; i <= 20; i++) { const fx = s.x + s.w * i / 20, fy = s.y + s.h * i / 20; pts.push([fx, s.y], [fx, s.y + s.h], [s.x, fy], [s.x + s.w, fy]); }
  else return Infinity;
  return Math.min(...pts.map(([x, y]) => Math.hypot(Math.max(0, p.side * (x - p.x)), Math.max(0, p.y - y))));
}
// the zone's box in the frame and its clip path in the box's own px (pure)
export function zoneBox(z, w, h) {
  const r = z.r, left = z.p.side > 0, x = left ? 0 : z.p.x - r, wd = left ? z.p.x + r : w - x, y = z.p.y - r, ht = h - y;
  const px = z.p.x - x, py = z.p.y - y, f = (v) => v.toFixed(1);
  const path = left ? `M0 0 L${f(px)} 0 A${f(r)} ${f(r)} 0 0 1 ${f(px + r)} ${f(py)} L${f(wd)} ${f(ht)} L0 ${f(ht)} Z`
    : `M${f(wd)} 0 L${f(px)} 0 A${f(r)} ${f(r)} 0 0 0 ${f(px - r)} ${f(py)} L0 ${f(ht)} L${f(wd)} ${f(ht)} Z`;
  return { x, y, w: wd, h: ht, path };
}
// what a press in a thumb zone takes (pure): side 'l' | 'r'; motor: the right ring is the throttle (no jib ring). The quarter if it is
// nearer the quarter than the ring (half the gap), else the ring under it (with Split, the jib's inner ring or the main's by the
// middle of the gap between them), its angle snapped onto the ring's sweep; null outside the zone
export function zonePick(L, side, x, y, { motor = false } = {}) {
  const z = L.zones?.[side]; if (!z || !inZone(z, x, y)) return null;
  const p = z.p, rr = Math.hypot(p.side * (x - p.x), p.y - y);
  if (rr <= L.q + L.g / 2) return { kind: 'quarter' };
  const ring = side === 'l' ? 'steer' : L.jib && !motor && rr < (L.jib.r1 + L.main.r0) / 2 ? 'jib' : 'main';
  const R = ring === 'steer' ? L.steer : L[ring];
  return { kind: 'ring', ring, a: clamp(arcAngle(p, x, y), R.a0, R.a1) };
}
// the shape's bounding box (pure)
export function shapeBox(s) {
  if (s.kind === 'rect') return { x: s.x, y: s.y, w: s.w, h: s.h };
  if (s.kind === 'circle') return { x: s.cx - s.r, y: s.cy - s.r, w: 2 * s.r, h: 2 * s.r };
  const R = s.kind === 'quarter' ? s.r : s.r1;
  return { x: s.p.side > 0 ? s.p.x : s.p.x - R, y: s.p.y - R, w: R, h: R };
}
// the pairs of shapes that share a pixel, on a `step` px grid (pure)
export function overlaps(shapes, step = 1) {
  const ids = Object.keys(shapes), out = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = shapes[ids[i]], b = shapes[ids[j]], A = shapeBox(a), B = shapeBox(b);
    const x0 = Math.max(A.x, B.x), x1 = Math.min(A.x + A.w, B.x + B.w), y0 = Math.max(A.y, B.y), y1 = Math.min(A.y + A.h, B.y + B.h);
    if (x0 >= x1 || y0 >= y1) continue;
    let hit = false;
    for (let y = y0 + step / 2; y < y1 && !hit; y += step) for (let x = x0 + step / 2; x < x1; x += step) if (inShape(a, x, y) && inShape(b, x, y)) { hit = true; break; }
    if (hit) out.push([ids[i], ids[j]]);
  }
  return out;
}
// an SVG / clip-path path for a band round a corner pivot, in the frame's px (minus an origin)
export function bandPath(p, r0, r1, a0, a1, o = { x: 0, y: 0 }) {
  const P = (a, rr) => { const q = arcPt(p, a, rr); return `${(q.x - o.x).toFixed(1)} ${(q.y - o.y).toFixed(1)}`; }, sw = p.side > 0 ? 0 : 1, big = a1 - a0 > 180 ? 1 : 0;
  return `M${P(a0, r1)} A${r1} ${r1} 0 ${big} ${sw} ${P(a1, r1)} L${P(a1, r0)} A${r0} ${r0} 0 ${big} ${1 - sw} ${P(a0, r0)} Z`;
}

const ICON = {
  tack: '<path d="M6 16a7 7 0 0 1 12-6"/><path d="M18.5 4.5v5.6h-5.6"/>',
  free: '<path d="M8.5 21v-6.5L12 9l3.5 5.5V21"/><path d="M12 2.5v4.5"/><path d="M10 5l2 2.2L14 5"/>',   // the bow, the wind on it
  refloat: '<path d="M4.5 7.5h15l-2.8 5H7.3z"/><path d="M12 12.5V17"/><path d="M3 20h18"/>',   // the keel over the bottom
  gybe: '<path d="M18 8a7 7 0 0 1-12 6"/><path d="M5.5 19.5v-5.6h5.6"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5"/>',
  auto: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4"/><circle cx="12" cy="12" r="1.6"/>',
  helm: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 3v7M12 14v7M3 12h7M14 12h7"/>',
  sails: '<path d="M11 3v16"/><path d="M11 4c4 4 6 9 6 14h-6"/><path d="M4 20h16"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13"/><path d="M5 13a7 7 0 0 0 14 0"/><path d="M8 10h8"/>',
  engine: '<rect x="5" y="8" width="12" height="9" rx="1.5"/><path d="M17 11h3v3h-3M8 8V5h6v3"/>',
  pro: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  more: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  recentre: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.8v4M12 17.2v4M2.8 12h4M17.2 12h4"/><circle cx="12" cy="12" r="1.6"/>',
  restart: '<path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4h4"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
const WORD = { tack: 'Tack', gybe: 'Gybe', free: 'Free', refloat: 'Refloat' };
const LABEL = { tack: 'Tack', gybe: 'Gybe', free: 'Free: get her out of irons', refloat: 'Refloat: kedge her off' };
const SLIDERS = [   // ui/proRecess.js PRO_SLIDERS: the value at the track's left and right ends
  { id: 'traveller', key: 'traveller', lo: -1, hi: 1, word: 'Traveller' },
  { id: 'vang', key: 'twist', lo: 1, hi: -1, word: 'Vang' },
  { id: 'jibLead', key: 'jibLead', lo: -1, hi: 1, word: 'Jib lead' },
  { id: 'backstay', key: 'backstay', lo: 0, hi: 1, word: 'Backstay' },
];

// the top bar's material (src/ui/viewSwitch.js .isl): navy glass, the blur, one hairline, the shadow; its type and icon stroke
export const FLAT_CSS = `
div.lk-flat{--fl-glass:rgb(var(--lk-brand-navy) / .78);--fl-edge:var(--lk-glass-edge);--fl-shadow:0 2px 12px rgb(0 0 0 / .35);--fl-ink:var(--lk-chrome-ink);
  --fl-font:var(--lk-medium) calc(var(--lk-fs-caption) * .88)/1 var(--lk-ui);--fl-amber:rgb(var(--lk-amber));
  position:fixed;inset:0;pointer-events:none;z-index:var(--lk-z-hud);font:var(--fl-font);letter-spacing:var(--lk-track);color:var(--fl-ink);
  -webkit-font-smoothing:antialiased;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;touch-action:none}
div.lk-flat[hidden],div.lk-flat [hidden]{display:none!important}
div.lk-flat .side{position:absolute;pointer-events:none}
div.lk-flat .zone{position:absolute;pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent}
div.lk-flat .ring{position:absolute;inset:0;background:var(--fl-glass);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);pointer-events:auto;touch-action:none;
  cursor:pointer;-webkit-tap-highlight-color:transparent;transition:background-color .2s}
div.lk-flat .ring:focus-visible{outline:none;background:rgb(var(--lk-brand-navy) / .9)}
div.lk-flat .side.r.warn .ring.sheet{animation:lk-fl-warn 1.1s ease-in-out infinite;box-shadow:0 0 0 2px var(--fl-amber)}
@keyframes lk-fl-warn{0%,100%{box-shadow:0 0 0 1px rgb(var(--lk-amber) / .35)}50%{box-shadow:0 0 0 4px rgb(var(--lk-amber) / .95)}}
@media (prefers-reduced-motion: reduce){div.lk-flat .side.r.warn .ring.sheet{animation:none;box-shadow:0 0 0 3px var(--fl-amber)}}
div.lk-flat .eng{position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:1}
div.lk-flat .eng .hl{fill:none;stroke:var(--fl-edge);stroke-width:1;vector-effect:non-scaling-stroke}
div.lk-flat .eng .tk{stroke:rgb(var(--lk-cream) / .5);stroke-width:1;stroke-linecap:round}
div.lk-flat .eng .tk.z{stroke:rgb(var(--lk-cream) / .9);stroke-width:1.5}
div.lk-flat .eng .tk.p{stroke:rgb(var(--lk-port) / .9);stroke-width:1.5}
div.lk-flat .eng .tk.s{stroke:rgb(var(--lk-stbd) / .9);stroke-width:1.5}
div.lk-flat .eng .nd{stroke:var(--fl-ink);stroke-width:3;stroke-linecap:round;filter:drop-shadow(0 0 1.5px rgb(0 0 0 / .7))}
div.lk-flat .eng .nd.lit{stroke:var(--fl-amber);filter:drop-shadow(0 0 5px rgb(var(--lk-amber) / .7))}
div.lk-flat .eng .ib{fill:rgb(var(--lk-cream) / .16);stroke:none}
div.lk-flat .eng text{fill:var(--fl-ink);font:var(--fl-font);letter-spacing:var(--lk-track);text-anchor:middle;dominant-baseline:central;opacity:.82}
div.lk-flat .more,div.lk-flat .rc{z-index:2;border-radius:50%;width:44px;height:44px}
div.lk-flat .eng g{transition:opacity var(--fl-fade,.3s) ease}
div.lk-flat .side.r g.tg{opacity:0}
div.lk-flat .side.r.motor g.sg{opacity:0}
div.lk-flat .side.r.motor g.tg{opacity:1}
div.lk-flat .side.r.motor .ring.sg{display:none}
div.lk-flat .side.l.dim .tk,div.lk-flat .side.l.dim .nd{opacity:.45}
div.lk-flat .side.l.held .nd{filter:drop-shadow(0 0 4px rgb(var(--lk-cream) / .8))}
div.lk-flat .b{all:unset;box-sizing:border-box;position:absolute;display:flex;align-items:center;justify-content:center;gap:.42em;min-width:44px;min-height:44px;
  background:var(--fl-glass);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--fl-edge);box-shadow:var(--fl-shadow);
  color:var(--fl-ink);font:var(--fl-font);letter-spacing:var(--lk-track);pointer-events:auto;touch-action:none;-webkit-tap-highlight-color:transparent;cursor:pointer;border-radius:999px;
  transition:opacity var(--fl-fade,.3s) ease,background .25s ease,box-shadow .25s ease,color .25s ease,border-color .25s ease}
div.lk-flat .b:focus-visible{outline:var(--lk-line) solid var(--fl-ink);outline-offset:2px}
div.lk-flat .b svg{flex:none;width:round(1.4em,1px);height:round(1.4em,1px);fill:none;stroke:currentColor;stroke-width:1.7px;stroke-linecap:round;stroke-linejoin:round}
div.lk-flat .qd{flex-direction:column;gap:5px;padding:0}
div.lk-flat .qd.l{border-radius:0 100% 0 0}
div.lk-flat .qd.r{border-radius:100% 0 0 0}
div.lk-flat .qd .in{position:absolute;display:flex;flex-direction:column;align-items:center;gap:5px;transform:translate(-50%,-50%);white-space:nowrap}
div.lk-flat .qd.take .in{white-space:normal;text-align:center;line-height:1.15;width:56px}
div.lk-flat .qd.take svg{display:none}
div.lk-flat .qd.dim .in{opacity:.45}
div.lk-flat .qd.lit{color:var(--fl-amber);border-color:rgb(var(--lk-amber) / .55);background:linear-gradient(rgb(var(--lk-amber) / .2),rgb(var(--lk-amber) / .2)),var(--fl-glass);
  box-shadow:var(--fl-shadow),0 0 18px rgb(var(--lk-amber) / .3)}
div.lk-flat .qd.gone{opacity:0;pointer-events:none}
/* the mark set and NAV off: the corner's glow rises once, slow and calm */
div.lk-flat .qd.pulse{animation:lk-fl-pulse 1.8s cubic-bezier(.4,0,.6,1) 1}
@keyframes lk-fl-pulse{0%,100%{box-shadow:var(--fl-shadow)}35%{box-shadow:var(--fl-shadow),0 0 22px rgb(255 255 255 / .55)}}
@media (prefers-reduced-motion:reduce){div.lk-flat .qd.pulse{animation:none;box-shadow:var(--fl-shadow),0 0 14px rgb(255 255 255 / .4)}}
div.lk-flat .qd.tack::after{content:'';position:absolute;inset:0;border-radius:inherit;background:rgb(var(--lk-cream) / .18);opacity:var(--cue,0);pointer-events:none}
div.lk-flat .dl{border-radius:50%;background:none;border:0;box-shadow:none;-webkit-backdrop-filter:none;backdrop-filter:none}
div.lk-flat .ro{position:absolute;display:flex;align-items:center;gap:.42em;height:32px;padding:0 .85em;border-radius:16px;background:var(--fl-glass);-webkit-backdrop-filter:var(--lk-glass-blur);
  backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--fl-edge);box-shadow:var(--fl-shadow);pointer-events:none;font-variant-numeric:tabular-nums;white-space:nowrap;box-sizing:border-box}
div.lk-flat .ro i{font-style:normal;opacity:.7}
div.lk-flat .ro .sep{opacity:.4}
div.lk-flat .ro.race{flex-direction:column;align-items:flex-start;justify-content:center;gap:4px;height:44px;border-radius:12px;padding:0 .75em}
div.lk-flat .ro.race span{max-width:100%;overflow:hidden;text-overflow:ellipsis}
div.lk-flat .ro.race .a{color:var(--fl-amber)}
div.lk-flat .ro.race .a:empty{display:none}
div.lk-flat .help{border-radius:12px;color:var(--fl-amber);border-color:rgb(var(--lk-amber) / .55);background:linear-gradient(rgb(var(--lk-amber) / .2),rgb(var(--lk-amber) / .2)),var(--fl-glass)}
div.lk-flat .clk{position:absolute;display:flex;align-items:center;justify-content:center;border-radius:50%;background:rgb(var(--lk-brand-navy) / .9);border:var(--lk-line) solid var(--fl-edge);
  font:var(--lk-medium) 17px/1 var(--lk-ui);font-variant-numeric:tabular-nums;pointer-events:none;box-sizing:border-box}
div.lk-flat .clk.warn{color:var(--fl-amber);border-color:rgb(var(--lk-amber) / .55)}
div.lk-flat .mk{position:absolute;pointer-events:none;width:0;height:0;will-change:transform}
div.lk-flat .mk::before{content:'';position:absolute;left:-6px;top:0;border:6px solid transparent;border-top:0;border-bottom:10px solid var(--fl-amber)}
div.lk-flat .rc.off{opacity:0;visibility:hidden;pointer-events:none;transition:opacity var(--fl-fade,.3s) ease,visibility 0s linear var(--fl-fade,.3s)}
div.lk-flat .scrim{position:absolute;inset:0;background:rgb(var(--lk-brand-navy) / .3);pointer-events:auto;touch-action:none}
div.lk-flat .sheet{position:absolute;box-sizing:border-box;padding:12px 14px;border-radius:18px;background:rgb(var(--lk-brand-navy) / .9);-webkit-backdrop-filter:var(--lk-glass-blur);
  backdrop-filter:var(--lk-glass-blur);border:var(--lk-line) solid var(--fl-edge);box-shadow:0 8px 28px rgb(0 0 0 / .4);pointer-events:auto;touch-action:none;z-index:1}
div.lk-flat .sheet h3{margin:0 0 6px;height:24px;font:var(--lk-medium) 12px/24px var(--lk-ui);letter-spacing:.16em;text-transform:uppercase;opacity:.75}
div.lk-flat .row{display:flex;align-items:center;gap:10px;height:44px;margin-bottom:8px}
div.lk-flat .row svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round;flex:none}
div.lk-flat .row .lbl{flex:1;min-width:0;white-space:nowrap}
div.lk-flat .pair{display:flex;border-radius:22px;overflow:hidden;flex:none;box-shadow:inset 0 0 0 var(--lk-line) var(--fl-edge)}
div.lk-flat .pair button{all:unset;box-sizing:border-box;min-width:56px;padding:0 12px;height:44px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--fl-ink);
  -webkit-tap-highlight-color:transparent;touch-action:none;font:var(--fl-font)}
div.lk-flat .pair button+button{box-shadow:inset var(--lk-line) 0 0 rgb(var(--lk-cream) / .14)}
div.lk-flat .b.more.cue,div.lk-flat .pair button.cue{box-shadow:inset 0 0 0 var(--lk-line) rgb(var(--lk-amber) / .45),0 0 10px rgb(var(--lk-amber) / .22)}
div.lk-flat .pair button.on{color:var(--fl-amber);background:rgb(var(--lk-amber) / .14);box-shadow:inset 0 0 0 var(--lk-line) rgb(var(--lk-amber) / .7)}
div.lk-flat .act{all:unset;box-sizing:border-box;height:44px;padding:0 16px;border-radius:22px;box-shadow:inset 0 0 0 var(--lk-line) var(--fl-edge);display:flex;align-items:center;gap:8px;cursor:pointer;touch-action:none}
div.lk-flat .pro .grid{display:grid;grid-template-columns:auto 1fr;column-gap:16px}
div.lk-flat .pro .row{gap:8px}
div.lk-flat .pro .pair button{min-width:44px}
div.lk-flat .sl{flex:1;position:relative;height:44px;min-width:100px;touch-action:none;cursor:pointer}
div.lk-flat .sl .tr{position:absolute;left:15px;right:15px;top:21px;height:2px;border-radius:1px;background:rgb(var(--lk-cream) / .35)}
div.lk-flat .sl .kb{position:absolute;top:8px;width:28px;height:28px;margin-left:-14px;border-radius:50%;background:rgb(var(--lk-cream) / .95);box-shadow:0 1px 4px rgb(0 0 0 / .4)}
html.lk-flat #hands,html.lk-flat .lk-tackb,html.lk-flat .lk-nav{display:none!important}
html.lk-flat .lk-chart .small{left:var(--fl-cd-x)!important;top:var(--fl-cd-y)!important;right:auto!important;bottom:auto!important;transform:scale(var(--fl-cd-s))!important;transform-origin:0 0!important;
  opacity:1!important;pointer-events:none!important;transition:none!important}
html.lk-flat .lk-chart .small *{pointer-events:none!important}
html.lk-flat .lk-cv{left:var(--fl-wd-x)!important;top:var(--fl-wd-y)!important;right:auto!important;bottom:auto!important;transform:scale(var(--fl-wd-s))!important;transform-origin:0 0!important;
  opacity:1!important;visibility:visible!important;transition:transform .25s var(--lk-ease)!important}
html.lk-flat .lk-cv *{pointer-events:none!important}
html.lk-flat.lk-fl-wup .lk-cv{transform:scale(1)!important;left:var(--fl-wd-x1)!important}
html.lk-flat.lk-fl-off .lk-cv,html.lk-flat.lk-fl-off .lk-chart .small,html.lk-flat.lk-fl-res .lk-cv,html.lk-flat.lk-fl-res .lk-chart .small{visibility:hidden!important}
html.lk-flat.lk-fl-race .lk-cv svg{opacity:.4}
html.lk-flat .lk-chart .opener{display:none!important}
html.lk-flat #rg .watch{display:none!important}
html.lk-flat #rg .fleet{left:50%!important;right:auto!important;top:var(--fl-chip-y)!important;transform:translateX(-50%);width:auto!important;min-width:120px;max-width:170px;cursor:pointer}
html.lk-flat #rg .fleet:not(.open) .r{display:none!important}
html.lk-flat #rg .fleet .h{display:flex!important;height:44px;padding:0 16px;justify-content:center;align-items:center;letter-spacing:var(--lk-track);text-transform:none;opacity:1;white-space:nowrap;
  font:var(--lk-medium) calc(var(--lk-fs-caption) * .88)/1 var(--lk-ui);text-shadow:none;background:rgb(var(--lk-brand-navy) / .78);-webkit-backdrop-filter:var(--lk-glass-blur);backdrop-filter:var(--lk-glass-blur);
  border:var(--lk-line) solid var(--lk-glass-edge);border-radius:22px;box-shadow:0 2px 12px rgb(0 0 0 / .35);box-sizing:border-box}
html.lk-flat #rg .fleet.open{width:170px!important}
html.lk-flat #rg .fleet.open .r{display:flex!important}
html.lk-flat #rg .fleet .r .nm,html.lk-flat #rg .fleet .r .sn{display:none}
html.lk-flat #rg .fleet .r .cd{display:block;flex:1}
html.lk-flat #rg:has(.fleet.open) .coach{opacity:0}
html.lk-flat #rg .coach{top:auto!important;bottom:var(--fl-coach-b)!important;left:var(--fl-coach-cx)!important;transform:translateX(-50%)!important;max-width:var(--fl-coach-w)!important;
  max-height:52px;overflow:hidden;box-sizing:border-box}
html.lk-flat #rg .coach .o{display:none}
html.lk-flat #rg .pick{left:var(--fl-pick-x)!important;top:var(--fl-pick-y)!important;max-width:var(--fl-pick-w)!important;right:auto!important}
html.lk-flat #rg .pick button{height:44px}
html.lk-flat #rg .pick .h{display:none}
@media (prefers-reduced-motion:reduce){div.lk-flat{--fl-fade:0s}}
`;

// io: the page's pieces (v2/ui/sail.js), every function the code the cockpit already used
//   active()         the flat controls are the page's (a touch phone, the landscape frame)
//   hidden()         a page over the dashboard (the menu, the logbook, the binoculars, the big chart, the keys)
//   mode()           'sail' | 'cruise'; race(): null or { view (the race's view of her), ui (the race's plates) }
//   state()          the boat's state; B: the boat (station, holdCourse, setPilot, assists, follow); views: the views
//   pilot            ui/autopilot.js createPilot's (the left corner's Auto, one rule with the desktop's AUTO)
//   tack             tackButton.js's object (offer, active, kind, press); assist: ui/assist.js's (word, lit, dim, cue, press: the right
//                    corner); sea, eng: the seamanship and its engine
//   run(id)          the dock's action (sails, anchor); lit: { sails(), anchor() }
//   pro: { on(), set(on) }; ctl: the boat's controls (reef, traveller, twist, jibLead, backstay)
//   chart()          open the big chart; takeHelm(): Cruise's hand-over; canvas: the page's canvas (the fingers on the water)
//   warn()           the knockdown's warning is up (K2: the sheet ring pulses amber; v2/sim/knockdownGame.js)
export function createFlat({ active = () => false, hidden = () => false, mode = () => 'sail', race = () => null, state = () => null, B = null, views = null,
  tack = null, assist = null, pilot = null, sea = null, eng = null, run = () => {}, lit = {}, cue = {}, pro = null, ctl = {}, chart = () => {}, takeHelm = () => {}, canvas = null, onUse = () => {}, warn = () => false,
  root = document.body } = {}) {
  const H = document.documentElement;
  let el = null, E = null, on = false, shownNow = null, L = null, layKey = '', t = 0;
  let helm = null, split = false, drawerOpen = false, motorNow = false, crewByMotor = false;
  const pend = { main: 0, jib: 0 };   // the sheet rings' drags and taps since the last take (rad, + = in)
  const shown = {};
  const set = (n, v) => { if (n.textContent !== v) n.textContent = v; };
  const cls = (n, c, v) => { if (n.classList.contains(c) !== !!v) n.classList.toggle(c, !!v); };

  // ---- the camera's fingers on the water and the ease back ----
  const cam = { fingers: new Set(), lastUp: -9, moved: false, at: null, ease: null, home: null };
  if (canvas) {
    canvas.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || !on) return; cam.fingers.add(e.pointerId); cam.ease = null; cam.at = null; });
    const up = (e) => { if (!cam.fingers.delete(e.pointerId)) return; if (!cam.fingers.size) cam.lastUp = t; };
    for (const ev of ['pointerup', 'pointercancel']) canvas.addEventListener(ev, up);
  }
  const followNow = () => { const f = B?.follow, s = state(); return f && s ? { yawOff: wrap(f.yaw - s.heading), pitch: f.pitch, dist: f.dist, look: f.look ?? 0 } : null; };
  const offness = (p) => (p && cam.home ? Math.max(Math.abs(p.yawOff) / (FLAT.offDeg * DEG), Math.abs(p.pitch - cam.home.pitch) / (FLAT.offDeg * DEG), Math.abs(p.dist / cam.home.dist - 1) / FLAT.offZoom, p.look / (FLAT.offDeg * DEG)) : 0);
  function camera(dt) {
    const f = B?.follow, s = state(); if (!f || !s) return;
    cam.home ??= { pitch: f.pitch, dist: f.dist };
    const helmView = views && (views.view === 'helm' || views.k > 0.5);
    const p = followNow();
    if (cam.fingers.size) {   // a finger on the water: has it moved the camera since it came down?
      cam.at ??= { ...p };
      if (Math.abs(wrap(p.yawOff - cam.at.yawOff)) > FLAT.movedDeg * DEG || Math.abs(p.pitch - cam.at.pitch) > FLAT.movedDeg * DEG || Math.abs(p.dist / cam.at.dist - 1) > FLAT.movedZoom || Math.abs(p.look - cam.at.look) > FLAT.movedDeg * DEG) cam.moved = true;
      return;
    }
    if (helmView) return;
    if (!cam.ease && cam.moved && t - cam.lastUp >= FLAT.returnS) startEase();
    if (cam.ease) {
      cam.ease.k += dt / FLAT.easeS;
      const e = smootherstep(cam.ease.k), a = cam.ease.from;
      f.yaw = wrap(s.heading + a.yawOff * (1 - e)); f.pitch = a.pitch + (cam.home.pitch - a.pitch) * e; f.dist = a.dist + (cam.home.dist - a.dist) * e; f.look = a.look * (1 - e);
      if (cam.ease.k >= 1) { cam.ease = null; cam.moved = false; }
    }
  }
  function startEase() { const p = followNow(); if (p) cam.ease = { k: 0, from: p }; }

  // ---- the DOM ----
  const quarter = (cls2, label, icon, word, extra = '') => `<button type="button" class="b qd ${cls2} fl-plate" aria-label="${label}" ${extra}><span class="in">${icon ? svg(icon) : ''}<span class="w">${word}</span></span></button>`;
  function build() {
    ensureTokens();
    if (!document.getElementById('lk-flat-css')) { const st = document.createElement('style'); st.id = 'lk-flat-css'; st.textContent = FLAT_CSS; document.head.appendChild(st); }
    el = document.createElement('div'); el.className = 'lk-flat'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'boat controls'); el.hidden = true;
    const pairRow = (id, icon, word, opts) => `<div class="row" data-row="${id}">${icon ? svg(icon) : ''}<span class="lbl">${word}</span><span class="pair" role="group" aria-label="${word.toLowerCase()}">`
      + opts.map((o, i) => `<button type="button" data-v="${i}">${o}</button>`).join('') + '</span></div>';
    el.innerHTML = '<div class="zone l" aria-hidden="true"></div><div class="zone r" aria-hidden="true"></div><div class="side l fl-plate"></div><div class="side r fl-plate"></div>'
      + quarter('l auto', `${PILOT_LABEL}: hold this course, or sail to a mark`, 'auto', PILOT_LABEL, 'aria-pressed="false"')
      + quarter('l take', 'Take the helm', null, 'Take the helm', 'hidden')
      + quarter('r tack', 'Tack', 'tack', 'Tack')
      + quarter('r stop gone', 'Stop: the engine to neutral', 'stop', 'Stop')
      + `<button type="button" class="b more fl-plate" aria-label="more controls" aria-expanded="false">${svg('more')}</button>`
      + '<button type="button" class="b dl fl-plate" data-k="chart" aria-label="chart: open the big chart"></button><button type="button" class="b dl fl-plate" data-k="wind" aria-label="Coach: raise it" aria-expanded="false"></button>'
      + '<div class="ro race fl-plate" aria-live="off"></div><button type="button" class="b help fl-plate" hidden>Helper</button>'
      + '<div class="clk" hidden></div><div class="mk" hidden></div>'
      + `<button type="button" class="b rc fl-plate off" aria-label="Recentre view" tabindex="-1">${svg('recentre')}</button>`
      + '<div class="scrim" hidden></div>'
      + `<div class="sheet drawer" role="dialog" aria-label="more controls" hidden><h3>Boat</h3>${pairRow('sails', 'sails', 'Sails', ['Up', 'Down'])}${pairRow('engine', 'engine', 'Engine', ['Off', 'On'])}`
      + `${pairRow('anchor', 'anchor', 'Anchor', ['Up', 'Down'])}<div class="row" data-row="restart" hidden>${svg('restart')}<span class="lbl">Race</span><button type="button" class="act" data-act="restart">Restart</button></div>`
      + `${pairRow('pro', 'pro', 'Pro', ['Off', 'On'])}</div>`
      + '<div class="sheet pro" role="dialog" aria-label="pro trim" hidden><h3>Pro</h3><div class="grid">'
      + [pairRow('reef', null, 'Reef', ['A', '0', '1', '2']), pairRow('sheets', null, 'Sheets', ['Both', 'Split']), pairRow('crew', null, 'Crew', ['Off', 'On']), '<div class="row"></div>']
        .map((lft, i) => lft + `<div class="row" data-sl="${SLIDERS[i].id}"><span class="lbl" style="flex:none;width:76px">${SLIDERS[i].word}</span><div class="sl" role="slider" tabindex="0" aria-label="${SLIDERS[i].word}" aria-valuemin="0" aria-valuemax="100"><div class="tr"></div><div class="kb"></div></div></div>`).join('')
      + '</div></div>';
    root.appendChild(el);
    const q = (s) => el.querySelector(s);
    E = { zl: q('.zone.l'), zr: q('.zone.r'), sl: q('.side.l'), sr: q('.side.r'), auto: q('.auto'), take: q('.take'), tack: q('.tack'), tackW: q('.tack .w'), tackI: q('.tack svg'), stop: q('.stop'),
      more: q('.more'), dChart: q('.dl[data-k=chart]'), dWind: q('.dl[data-k=wind]'), ro: q('.ro'), help: q('.help'), clk: q('.clk'), mk: q('.mk'),
      rc: q('.rc'), scrim: q('.scrim'), drawer: q('.drawer'), pro: q('.sheet.pro') };
    // nothing here is the canvas's press (the camera): a press that starts on a control stays the control's
    for (const n of el.querySelectorAll('.b,.sheet,.scrim')) n.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    const click = (n, fn) => n.addEventListener('click', (e) => { e.stopPropagation(); n.blur?.(); fn(e); onUse(); });
    click(E.auto, () => setAuto(!autoOn()));
    click(E.take, () => takeHelm());
    click(E.tack, () => (assist ? assist.press() : tack?.press?.()));
    click(E.stop, () => sea?.actions.neutral());
    click(E.more, () => setDrawer(!drawerOpen));
    click(E.dChart, () => chart());
    click(E.dWind, () => { const up = !H.classList.contains('lk-fl-wup'); H.classList.toggle('lk-fl-wup', up); E.dWind.setAttribute('aria-expanded', String(up)); });
    click(E.help, () => document.querySelector('#rg .watch .help')?.click());
    click(E.rc, () => startEase());
    E.scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); setDrawer(false); });
    for (const r of el.querySelectorAll('.row[data-row]')) for (const b of r.querySelectorAll('.pair button')) click(b, () => rowPress(r.dataset.row, +b.dataset.v));
    click(el.querySelector('[data-act=restart]'), () => { document.querySelector('#rg .watch .rst')?.click(); setDrawer(false); });
    for (const r of el.querySelectorAll('.row[data-sl]')) sliderWire(r);
    zoneWire(E.zl, 'l'); zoneWire(E.zr, 'r');
  }
  // a thumb zone (owner, 2026-11-17): a press that misses the drawn ring or quarter by a little is still theirs: the nearest ring takes
  // it as its own press (the angle snapped onto the ring for a tap), the quarter takes a tap; nothing here reaches the camera. A press
  // already held on that ring (another finger) leaves this one dead.
  function zoneWire(n, side) {
    let grab = null;   // { id, ctl } a ring's press, or { id, x0, y0, btn } the quarter's
    n.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (grab || !L) return;
      const pick = zonePick(L, side, e.clientX, e.clientY, { motor: motorNow });
      if (!pick) return;
      if (pick.kind === 'quarter') {
        const btn = side === 'l' ? (mode() === 'cruise' ? E.take : E.auto) : motorNow ? E.stop : E.tack;
        grab = { id: e.pointerId, x0: e.clientX, y0: e.clientY, btn }; try { n.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
        return;
      }
      const ctl = E.ctl?.[pick.ring];
      if (ctl && ctl.begin(e, n, pick.a)) grab = { id: e.pointerId, ctl };
    });
    n.addEventListener('pointermove', (e) => { if (grab?.id === e.pointerId) { e.preventDefault(); grab.ctl?.move(e); } });
    const up = (e) => {
      if (grab?.id !== e.pointerId) return;
      const g = grab; grab = null;
      if (g.ctl) g.ctl.up(e);
      else if (e.type === 'pointerup' && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) <= FLAT.tapDrift && !g.btn.hidden && !g.btn.classList.contains('gone')) g.btn.click();
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) n.addEventListener(ev, up);
  }
  const crewOff = () => { if (B?.assists?.crewTrim) B.assists.crewTrim = false; crewByMotor = false; };   // the sheet in the player's hand: the trim is theirs
  function sliderWire(r) {
    const spec = SLIDERS.find((s) => s.id === r.dataset.sl), n = r.querySelector('.sl'); let id = null, box = null;
    const setAt = (x) => { const f = clamp((x - box.left - 15) / Math.max(1, box.width - 30), 0, 1); if (pro?.on()) { ctl[spec.key] = spec.lo + (spec.hi - spec.lo) * f; onUse(); } };
    n.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); id = e.pointerId; box = n.getBoundingClientRect(); try { n.setPointerCapture(e.pointerId); } catch { /* synthetic */ } setAt(e.clientX); });
    n.addEventListener('pointermove', (e) => { if (e.pointerId === id) { e.preventDefault(); setAt(e.clientX); } });
    for (const ev of ['pointerup', 'pointercancel']) n.addEventListener(ev, (e) => { if (e.pointerId === id) id = null; });
  }
  // Auto: the desktop's AUTO (ui/autopilot.js createPilot): hold, or sail to a double-tap mark or chart target; a steer-ring drag lets go
  const autoOn = () => (pilot ? pilot.engaged : !!B?.assists?.pilot) && helm == null;
  function setAuto(v) { if (pilot) { if (v !== pilot.engaged) pilot.auto(); return; } if (!B) return; if (v) B.holdCourse?.(); else B.setPilot?.(false); }
  function setDrive(motor) { if (!sea || !eng) return; if (motor && !eng.on) sea.actions.engine(); else if (!motor && eng.on) { sea.actions.neutral(); sea.actions.engine(); } }
  // a row's half: only a change runs the action (the cockpit's switches: a toggle under the hood)
  function rowPress(id, v) {
    if (id === 'sails') { const down = !lit.sails?.(); if ((v === 1) !== down) run('sails'); }
    else if (id === 'anchor') { const down = !!lit.anchor?.(); if ((v === 1) !== down) run('anchor'); }
    else if (id === 'engine') setDrive(v === 1);
    else if (id === 'pro') pro?.set(v === 1);
    else if (id === 'reef') B?.setReef?.(['A', 0, 1, 2][v]);
    else if (id === 'sheets') { split = v === 1; layKey = ''; }
    else if (id === 'crew') { if (B?.assists) B.assists.crewTrim = v === 1; crewByMotor = false; }
    paintSheets(true);
  }
  function setDrawer(open) {
    drawerOpen = !!open && on;
    if (!E) return;
    E.scrim.hidden = !drawerOpen; E.drawer.hidden = !drawerOpen;
    E.more.setAttribute('aria-expanded', String(drawerOpen));
    paintSheets(true);
  }
  let sheetKey = '';
  function paintSheets(force = false) {
    if (!drawerOpen) { if (E && !E.pro.hidden) E.pro.hidden = true; return; }
    const raceOn = !!race();
    const st = { sails: lit.sails?.() ? 0 : 1, engine: eng?.on ? 1 : 0, anchor: lit.anchor?.() ? 1 : 0, pro: pro?.on() ? 1 : 0, reef: Math.max(0, ['A', 0, 1, 2].indexOf(B?.reefSel ?? 0)),   // the selector's stop: A · 0 · 1 · 2 (ui/autoReef.js)
       sheets: split ? 1 : 0, crew: B?.assists?.crewTrim ? 1 : 0 };
    const sl = SLIDERS.map((s) => { const v = ctl[s.key] ?? (s.key === 'backstay' ? state()?.backstay ?? 0 : 0); return Math.round(clamp((v - s.lo) / (s.hi - s.lo), 0, 1) * 100); });
    const anc = !raceOn && !!cue.anchor?.() && !lit.anchor?.();
    const key = JSON.stringify([st, sl, raceOn, anc]);
    if (!force && key === sheetKey) return;
    sheetKey = key;
    E.pro.hidden = !st.pro;
    el.querySelector('.row[data-row=anchor]').hidden = raceOn; el.querySelector('.row[data-row=restart]').hidden = !raceOn;
    for (const r of el.querySelectorAll('.row[data-row]')) for (const b of r.querySelectorAll('.pair button')) { const o = +b.dataset.v === st[r.dataset.row]; cls(b, 'on', o); cls(b, 'cue', anc && r.dataset.row === 'anchor' && b.dataset.v === '1'); b.setAttribute('aria-pressed', String(o)); }
    el.querySelectorAll('.row[data-sl]').forEach((r, i) => { const n = r.querySelector('.sl'); n.querySelector('.kb').style.left = `calc(15px + (100% - 30px) * ${sl[i] / 100})`; n.setAttribute('aria-valuenow', String(sl[i])); });
  }

  // ---- the rings: drawn on each relayout (paths in each side's own px), dragged ----
  // a ring's press: a tap (under FLAT.slop) calls tap(angle), a drag calls drag(a0, a) each move and end() on release
  // The press is captured: a drag that slides off the ring keeps the ring until the finger lifts (owner, 2026-11-17). begin(e, host,
  // aTap) starts a press from another element (a thumb zone, which holds the capture and forwards its moves and lifts); aTap is the
  // press's angle snapped onto the ring (a tap's), the drag runs from where the finger really landed.
  function ringWire(n, p, { down = () => {}, drag = () => {}, tap = () => {}, end = () => {} }) {
    let id = null, a0 = 0, aTap = 0, x0 = 0, y0 = 0, dragging = false;
    const begin = (e, host = n, at = null) => {
      if (id != null) return false;
      e.preventDefault(); e.stopPropagation(); id = e.pointerId; try { host.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      a0 = arcAngle(p(), e.clientX, e.clientY); aTap = at ?? a0; x0 = e.clientX; y0 = e.clientY; dragging = false; down(aTap); onUse();
      return true;
    };
    const move = (e) => {
      if (e.pointerId !== id) return; e.preventDefault();
      if (!dragging && Math.hypot(e.clientX - x0, e.clientY - y0) < FLAT.slop) return;
      dragging = true; drag(a0, arcAngle(p(), e.clientX, e.clientY));
    };
    const up = (e) => { if (e.pointerId !== id) return; id = null; if (!dragging && e.type === 'pointerup') tap(aTap); end(dragging); dragging = false; };
    n.addEventListener('pointerdown', (e) => { if (id != null) { e.preventDefault(); e.stopPropagation(); return; } begin(e); });
    n.addEventListener('pointermove', move);
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) n.addEventListener(ev, up);
    return { begin, move, up, get busy() { return id != null; } };
  }
  function drawSides() {
    const R = L.main, outer = R.r1;
    const boxOf = (p, rr) => ({ x: p.side > 0 ? p.x : p.x - rr - 2, y: p.y - rr - 2, w: rr + 2, h: rr + 2 });
    const bl = boxOf(L.pl, L.steer.r1), br = boxOf(L.pr, outer);
    for (const [n, b] of [[E.sl, bl], [E.sr, br]]) Object.assign(n.style, { left: `${b.x}px`, top: `${b.y}px`, width: `${b.w}px`, height: `${b.h}px` });
    const ring = (cls2, p, o, r0, r1, a0, a1, attrs) => `<div class="ring ${cls2}" ${attrs} style="clip-path:path('${bandPath(p, r0, r1, a0, a1, o)}')"></div>`;
    const hl = (p, o, r0, r1, a0, a1, c = '') => `<path class="hl ${c}" d="${bandPath(p, r0, r1, a0, a1, o)}"/>`;
    const tick = (p, o, rr0, rr1, a, c = '') => { const A = arcPt(p, a, rr0), Bq = arcPt(p, a, rr1); return `<line class="tk ${c}" x1="${(A.x - o.x).toFixed(1)}" y1="${(A.y - o.y).toFixed(1)}" x2="${(Bq.x - o.x).toFixed(1)}" y2="${(Bq.y - o.y).toFixed(1)}"/>`; };
    const txt = (p, o, a, rr, s, c = '') => { const m = arcPt(p, a, rr); return `<text class="${c}" x="${(m.x - o.x).toFixed(1)}" y="${(m.y - o.y).toFixed(1)}">${s}</text>`; };
    // the steer ring: ticks every sixth of the helm, the zero longer, port and starboard ends red and green
    const S = L.steer, ol = bl;
    let st = '';
    for (let k = -3; k <= 3; k++) { const a = 45 + k * FLAT.steerDeg / 3; st += tick(L.pl, ol, S.r1 - (k ? 7 : 12), S.r1 - 2, a, k === 0 ? 'z' : k === -3 ? 's' : k === 3 ? 'p' : ''); }
    E.sl.innerHTML = ring('steer', L.pl, ol, S.r0, S.r1, S.a0, S.a1, 'role="slider" aria-label="steer: drag round the corner, clockwise to starboard" aria-valuemin="-25" aria-valuemax="25" tabindex="0"')
      + `<svg class="eng" width="${ol.w}" height="${ol.h}" viewBox="0 0 ${ol.w} ${ol.h}">${hl(L.pl, ol, S.r0, S.r1, S.a0, S.a1)}${st}<line class="nd"/></svg>`;
    // the right side: the main's ring (the sheet, or the throttle under motor), the jib's inner ring with Split
    const o = br, span = R.a1 - R.a0;
    let sg = '', tg = '';
    for (let k = 0; k <= 6; k++) sg += tick(L.pr, o, R.r1 - 7, R.r1 - 2, R.a0 + span * k / 6);
    sg += txt(L.pr, o, R.a0 + span * 0.82, R.r, split ? 'Main' : 'In') + txt(L.pr, o, R.a0 + span * 0.16, R.r, 'Ease');
    sg += '<path class="ib main"/><line class="nd main"/>';
    if (L.jib) { const J = L.jib; sg += hl(L.pr, o, J.r0, J.r1, J.a0, J.a1) + txt(L.pr, o, J.a1 * 0.5, J.r, 'Jib') + '<path class="ib jib"/><line class="nd jib"/>'; }
    for (const nt of NOTCHES) tg += tick(L.pr, o, R.r1 - (nt.v === 0 ? 14 : 8), R.r1 - 2, R.a0 + leverDeg(nt.v, span), nt.v === 0 ? 'z' : '');
    tg += txt(L.pr, o, R.a0 + span * 0.8, R.r - 4, 'Ahead') + txt(L.pr, o, R.a0 + span * 0.5, R.r - 6, 'N') + txt(L.pr, o, R.a0 + span * 0.18, R.r - 4, 'Astern') + '<line class="nd thr"/>';
    // one ring for the main's sheet and, under motor, the throttle (its aria follows: see update)
    E.sr.innerHTML = ring('sheet', L.pr, o, R.r0, R.r1, R.a0, R.a1, 'role="slider" tabindex="0"')
      + (L.jib ? ring('jibring sg', L.pr, o, L.jib.r0, L.jib.r1, L.jib.a0, L.jib.a1, 'role="slider" aria-label="jib sheet: drag up to pull in, down to ease" aria-valuemin="0" aria-valuemax="100" tabindex="0"') : '')
      + `<svg class="eng" width="${o.w}" height="${o.h}" viewBox="0 0 ${o.w} ${o.h}">${hl(L.pr, o, R.r0, R.r1, R.a0, R.a1)}`
      + `<g class="sg">${sg}</g><g class="tg">${tg}</g></svg>`;
    E.steerRing = E.sl.querySelector('.ring.steer'); E.steerNd = E.sl.querySelector('.nd');
    E.sheetRing = E.sr.querySelector('.ring.sheet'); E.jibRing = E.sr.querySelector('.ring.jibring'); E.thrRing = E.sheetRing;
    E.nd = { main: E.sr.querySelector('.nd.main'), jib: E.sr.querySelector('.nd.jib'), thr: E.sr.querySelector('.nd.thr') };
    E.ib = { main: E.sr.querySelector('.ib.main'), jib: E.sr.querySelector('.ib.jib') };
    E.origin = { l: ol, r: o };
    wireRings();
    for (const k of Object.keys(shown)) if (k.startsWith('nd') || k.startsWith('ib')) delete shown[k];
  }
  // a needle across a ring at angle a (the side's own px)
  const needle = (n, p, o, Rg, a) => { const A = arcPt(p, a, Rg.r0 + 6), Bq = arcPt(p, a, Rg.r1 - 6); n.setAttribute('x1', (A.x - o.x).toFixed(1)); n.setAttribute('y1', (A.y - o.y).toFixed(1)); n.setAttribute('x2', (Bq.x - o.x).toFixed(1)); n.setAttribute('y2', (Bq.y - o.y).toFixed(1)); };
  function wireRings() {
    const pl = () => L.pl, pr = () => L.pr;
    // the steer ring: the wheel in the hand from the press (a tap takes it too, then lets go: she keeps her rudder)
    let h0 = 0;
    E.ctl = {};
    E.ctl.steer = ringWire(E.steerRing, pl, {
      down: () => { h0 = clamp((state()?.rudderAngle ?? 0) / HELM_IN.rudderMax); if (pilot?.engaged) pilot.release(); helm = h0; },   // a hand on the ring: NAV lets go (its passage too); steady hands takes the heading again when the ring is let go (ui/steadyHands.js)
      drag: (a0, a) => { helm = arcHelm(h0, a0, a); },
      end: () => { helm = null; },
    });
    // the sheet rings: relative drags (the sheet follows the finger along the ring), a tap nudges one step toward its end
    const sheetWire = (n, side, Rg, range) => {
      const span = Rg.a1 - Rg.a0, mid = Rg.a0 + span / 2;
      let s0 = 0, sent = 0;
      return ringWire(n, pr, {
        down: () => { s0 = side === 'main' ? (state()?.mainSheet ?? range[1]) : (state()?.jibSheet ?? range[1]); sent = 0; crewOff(); },
        drag: (a0, a) => { const want = sheetAt(sheetDeg(s0, span, range) + (a - a0), span, range), d = s0 - want; pend[side] += d - sent; sent = d; },
        tap: (a0) => { pend[side] += (a0 >= mid ? 1 : -1) * HELM_IN.step; },
      });
    };
    // the main's ring: the sheet, or under motor the throttle (a drag moves the lever, the release on a notch; a tap steps a notch)
    const R = L.main, span = R.a1 - R.a0, mid = R.a0 + span / 2;
    let s0 = 0, sent = 0, thr = false;
    E.ctl.main = ringWire(E.sheetRing, pr, {
      down: () => { thr = motorNow; if (thr) return; s0 = state()?.mainSheet ?? FLAT.sheet[1]; sent = 0; crewOff(); },
      drag: (a0, a) => {
        if (thr) { sea?.actions.lever(leverFromDeg(a - R.a0, span)); return; }
        const want = sheetAt(sheetDeg(s0, span) + (a - a0), span), d = s0 - want; pend.main += d - sent; sent = d;
      },
      tap: (a0) => { if (thr) sea?.actions.step(a0 >= mid ? 1 : -1); else pend.main += (a0 >= mid ? 1 : -1) * HELM_IN.step; },
      end: (dragged) => { if (thr && dragged && eng) sea?.actions.lever(leverSnap(eng.lever), { snap: true }); },
    });
    E.ctl.jib = E.jibRing ? sheetWire(E.jibRing, 'jib', L.jib, FLAT.jib) : null;
  }

  // the inset and the bar's foot (on resize only). The insets are the page's --lk-sa* (src/ui/touchUi.js: env(), turned with the page by
  // ui/landscape.js, or ui/screenFit.js's fallback), never env() read inline here (an inline env() is the screen's, not a turned page's)
  const px = (v, d0) => { const p = document.createElement('div'); p.style.cssText = `position:absolute;visibility:hidden;width:${v}`; document.body.appendChild(p); const w = p.getBoundingClientRect().width; p.remove(); return Number.isFinite(w) ? w : d0; };
  let measured = null;
  const measure = () => { measured = { inset: { l: px('var(--lk-sal,env(safe-area-inset-left,0px))', 0), r: px('var(--lk-sar,env(safe-area-inset-right,0px))', 0), b: px('var(--lk-sab,env(safe-area-inset-bottom,0px))', 0) }, cap: px('var(--lk-cap-top,62px)', 62) }; layKey = ''; };
  addEventListener('resize', () => { if (el) measure(); });
  addEventListener('lk-screen', () => { if (el) measure(); });   // the visible frame moved (Safari's bars) or its tier changed
  // the frame the player sees (ui/screenFit.js: the visual viewport, the layout frame), else the window's
  const frame = () => { const f = globalThis.__veliaScreen?.frame?.(); return f && f.w > 0 && f.h > 0 ? f : { w: innerWidth, h: innerHeight }; };
  const pos = (n, r) => Object.assign(n.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
  function relayout(m) {
    if (!measured) measure();
    const f = frame(), key = [f.w, f.h, m, split, JSON.stringify(measured)].join();
    if (key === layKey) return false;
    if (Object.values(E.ctl ?? {}).some((c) => c?.busy)) return false;   // a finger holds a ring: the redraw would replace it (its press, its capture); the new layout lands the frame after it lifts
    layKey = key;
    L = flatLayout({ w: f.w, h: f.h, inset: measured.inset, capTop: measured.cap, split, mode: m });
    drawSides();
    for (const [k, n] of [['l', E.zl], ['r', E.zr]]) { const b = zoneBox(L.zones[k], f.w, f.h); pos(n, b); n.style.clipPath = `path('${b.path}')`; }
    const qbox = (p) => ({ x: p.side > 0 ? p.x : p.x - L.q, y: p.y - L.q, w: L.q, h: L.q });
    for (const n of [E.auto, E.take]) { pos(n, qbox(L.pl)); const c = n.querySelector('.in'); c.style.left = `${Math.round(L.q * 0.42)}px`; c.style.top = `${Math.round(L.q * 0.58)}px`; }
    for (const n of [E.tack, E.stop]) { pos(n, qbox(L.pr)); const c = n.querySelector('.in'); c.style.left = `${Math.round(L.q * 0.58)}px`; c.style.top = `${Math.round(L.q * 0.58)}px`; }
    for (const [k, n] of [['chart', E.dChart], ['wind', E.dWind]]) { const d = L.dials[k]; pos(n, { x: d.x, y: d.y, w: d.d, h: d.d }); }
    if (L.readout) { pos(E.ro, L.readout); E.ro.style.maxWidth = `${L.readout.w}px`; shown.ro = undefined; }
    if (L.helper) pos(E.help, L.helper);
    pos(E.rc, { x: Math.round(L.recentre.x - 22), y: Math.round(L.recentre.y - 22), w: 44, h: 44 });
    pos(E.more, { x: Math.round(L.more.x - 22), y: Math.round(L.more.y - 22), w: 44, h: 44 });
    const wd = L.dials.wind, cd = L.dials.chart, cs = Math.round(wd.d * 0.62);
    pos(E.clk, { x: Math.round(wd.x + (wd.d - cs) / 2), y: Math.round(wd.y + (wd.d - cs) / 2), w: cs, h: cs });
    pos(E.drawer, L.drawer); pos(E.pro, L.pro);
    dialVars(true);
    const vars = { '--fl-chip-y': `${L.chip?.y ?? 0}px` };
    if (L.coach) Object.assign(vars, { '--fl-coach-b': `${L.h - L.coach.y - L.coach.h}px`, '--fl-coach-cx': `${L.coach.x + L.coach.w / 2}px`, '--fl-coach-w': `${L.coach.w}px` });
    if (L.pick) Object.assign(vars, { '--fl-pick-x': `${L.pick.x}px`, '--fl-pick-y': `${L.pick.y}px`, '--fl-pick-w': `${L.pick.w}px` });
    for (const [k, v] of Object.entries(vars)) H.style.setProperty(k, v);
    E.mkR = cd.d / 2; E.mkC = { x: cd.x + cd.d / 2, y: cd.y + cd.d / 2 };
    shown.vk = undefined; shown.motor = undefined;
    return true;
  }
  // the game's own dials, shrunk into the corners: their own size read on a relayout and once a second (the chart mounts late)
  let natKey = '', natAt = -9;
  function dialVars(force = false) {
    const cdEl = document.querySelector('.lk-chart .small'), wdEl = document.querySelector('.lk-cv');
    const nc = cdEl?.offsetWidth || 122, nw = wdEl?.offsetWidth || 122, k = `${nc},${nw}`;
    if (!force && k === natKey) return;
    natKey = k;
    const cd = L.dials.chart, wd = L.dials.wind;
    const vars = { '--fl-cd-x': `${cd.x}px`, '--fl-cd-y': `${cd.y}px`, '--fl-cd-s': (cd.d / nc).toFixed(4), '--fl-wd-x': `${wd.x}px`, '--fl-wd-y': `${wd.y}px`,
      '--fl-wd-s': (wd.d / nw).toFixed(4), '--fl-wd-x1': `${wd.x + wd.d - nw}px` };
    for (const [n, v] of Object.entries(vars)) H.style.setProperty(n, v);
  }
  function show(v) {
    if (v === shownNow) return;
    shownNow = v; el.hidden = !v; H.classList.toggle('lk-fl-off', !v);
    if (!v) { setDrawer(false); helm = null; pend.main = 0; pend.jib = 0; }
  }

  // the trim the ring shows now (pure of the DOM): the sheets' and the ideal band's angles on the main's ring
  function trimNow(s) {
    const R = L.main, span = R.a1 - R.a0, ideal = s?.crewSheet ?? null;
    return { main: R.a0 + sheetDeg(s?.mainSheet ?? FLAT.sheet[1], span), jib: L.jib ? L.jib.a0 + sheetDeg(s?.jibSheet ?? FLAT.jib[1], L.jib.a1 - L.jib.a0, FLAT.jib) : null,
      band: ideal == null ? null : [R.a0 + sheetDeg(ideal + FLAT.ideal, span), R.a0 + sheetDeg(ideal - FLAT.ideal, span)] };
  }

  // each frame, before the boat's step
  function update(dt) {
    t += dt;
    const want = !!active();
    if (want !== on) {
      on = want;
      H.classList.toggle('lk-flat', on); features.mounted('flatControls', on);   // the registry's quietSkipper follows it (src/core/features.js)
      if (on && !el) build();
      if (el) show(false);
      if (!on) { helm = null; pend.main = 0; pend.jib = 0; H.classList.remove('lk-fl-race', 'lk-fl-wup', 'lk-fl-off', 'lk-fl-res'); }
    }
    if (!on) return;
    const vis = !hidden();
    show(vis);
    if (!vis) return;
    const m = mode() === 'cruise' ? 'cruise' : race() ? 'race' : 'sail', R = m === 'race' ? race() : null;
    const results = !!R?.ui?.resultsOpen, motor = !!eng?.on && m !== 'cruise';
    relayout(m);
    if (t - natAt > 1) { natAt = t; dialVars(); }
    camera(dt);
    // under motor the crew trims the sails (they come back to the player's hand when the motor stops)
    if (motor !== motorNow) {
      motorNow = motor;
      if (motor && B?.assists && !B.assists.crewTrim && lit.sails?.()) { B.assists.crewTrim = true; crewByMotor = true; }
      else if (!motor && crewByMotor && B?.assists) { B.assists.crewTrim = false; crewByMotor = false; }
    }
    const s = state();
    const ctrls = m !== 'cruise' && !results;
    const vk = `${m}|${ctrls}|${results}`;
    if (vk !== shown.vk) {
      shown.vk = vk;
      E.take.hidden = m !== 'cruise'; E.auto.hidden = m === 'cruise';
      for (const n of [E.zl, E.zr, E.sl, E.sr, E.auto, E.tack, E.stop, E.more]) n.style.display = ctrls ? '' : 'none';
      for (const n of [E.dChart, E.dWind]) n.style.display = m === 'cruise' || results ? 'none' : '';
      E.ro.style.display = m !== 'race' || results ? 'none' : '';
      H.classList.toggle('lk-fl-race', m === 'race'); H.classList.toggle('lk-fl-res', results);
      if (!ctrls) setDrawer(false);
    }
    if (motor !== shown.motor) { shown.motor = motor; cls(E.sr, 'motor', motor); E.sheetRing.setAttribute('aria-label', motor ? 'throttle: drag up for ahead, down for astern; N in the middle; tap an end for a notch' : `${split ? 'main sheet' : 'sheets'}: drag up to pull in, down to ease; tap an end for a step`); E.sheetRing.setAttribute('aria-valuemin', motor ? '-1' : '0'); E.sheetRing.setAttribute('aria-valuemax', motor ? '1' : '100'); cls(E.tack, 'gone', motor); cls(E.stop, 'gone', !motor); E.tack.setAttribute('aria-hidden', String(motor)); E.stop.setAttribute('aria-hidden', String(!motor)); }
    // the anchorage cue: More glows faintly inside an anchorage or by a free ball (the anchor is in its drawer)
    const anc = ctrls && m === 'sail' && !!cue.anchor?.() && !lit.anchor?.();
    if (anc !== shown.anc) { shown.anc = anc; cls(E.more, 'cue', anc); if (drawerOpen) paintSheets(true); }
    if (!s) return;
    cls(E.sr, 'warn', ctrls && !motor && !!warn());   // K2: the knockdown's warning: the sheet ring pulses amber (ease the sails)
    if (ctrls) {
      const kd = Math.round(knobDeg(s.rudderAngle ?? 0) * 4) / 4;
      if (kd !== shown.ndS) { shown.ndS = kd; needle(E.steerNd, L.pl, E.origin.l, L.steer, kd); E.steerRing.setAttribute('aria-valuenow', String(Math.round((s.rudderAngle ?? 0) / DEG))); }
      const ao = autoOn();
      if (ao !== shown.auto) { shown.auto = ao; cls(E.auto, 'lit', ao); E.auto.setAttribute('aria-pressed', String(ao)); }
      cls(E.sl, 'dim', ao); cls(E.sl, 'held', helm != null);
      const T = assist ?? { word: 'TACK', lit: !!tack?.active, dim: !tack?.offer && !tack?.active, cue: 0 }, tk = `${T.word}|${T.lit}|${T.dim}`;   // amber only while a manoeuvre runs (ui/assist.js)
      if (tk !== shown.tack) { shown.tack = tk; const k = T.word.toLowerCase(); cls(E.tack, 'lit', T.lit); cls(E.tack, 'dim', T.dim); set(E.tackW, WORD[k] ?? T.word); E.tack.setAttribute('aria-label', LABEL[k] ?? T.word); E.tack.setAttribute('aria-disabled', String(!!T.dim)); E.tackI.innerHTML = ICON[k] ?? ICON.tack; E.tack.dataset.word = k; }
      const cue = Math.round((T.cue ?? 0) * 50) / 50;
      if (cue !== shown.cue) { shown.cue = cue; E.tack.style.setProperty('--cue', String(cue)); }
      if (motor) {
        const v = eng.lever ?? 0, a = Math.round((L.main.a0 + leverDeg(v, L.main.a1 - L.main.a0)) * 4) / 4;
        if (a !== shown.ndT) { shown.ndT = a; needle(E.nd.thr, L.pr, E.origin.r, L.main, a); E.thrRing.setAttribute('aria-valuenow', v.toFixed(2)); }
        cls(E.nd.thr, 'lit', Math.abs(v) >= FLAT.detent);
      } else {
        const tr = trimNow(s), am = Math.round(tr.main * 4) / 4;
        if (am !== shown.ndM) { shown.ndM = am; needle(E.nd.main, L.pr, E.origin.r, L.main, am); E.sheetRing.setAttribute('aria-valuenow', String(Math.round(am / (L.main.a1 - L.main.a0) * 100))); }
        const bk = tr.band ? tr.band.map((x) => Math.round(x * 2) / 2).join() : '';
        if (bk !== shown.ib) { shown.ib = bk; E.ib.main.setAttribute('d', tr.band ? bandPath(L.pr, L.main.r0 + 1, L.main.r1 - 1, Math.max(L.main.a0, tr.band[0]), Math.min(L.main.a1, Math.max(tr.band[0] + 0.5, tr.band[1])), E.origin.r) : ''); }
        if (L.jib && E.nd.jib) {
          const aj = Math.round(tr.jib * 4) / 4;
          if (aj !== shown.ndJ) { shown.ndJ = aj; needle(E.nd.jib, L.pr, E.origin.r, L.jib, aj); }
        }
        E.trim = tr;
      }
    }
    // the readout and the race's pieces in the dials
    if (m === 'race') {
      const w = document.querySelector('#rg .watch');
      const l1 = w?.querySelector('.l1')?.textContent ?? '', l2 = w?.querySelector('.l2')?.textContent ?? '';
      const ro = `${l1}|${l2}`;
      if (ro !== shown.ro) { shown.ro = ro; E.ro.innerHTML = '<span></span><span class="a"></span>'; E.ro.children[0].textContent = l1; E.ro.children[1].textContent = l2; }
      set(E.clk, w?.querySelector('.clk')?.textContent ?? ''); cls(E.clk, 'warn', !!w?.classList.contains('warn'));
      const hb = w?.querySelector('.help');
      E.help.hidden = results || !hb || hb.hidden;
      const v = R?.view, tg = v?.status === 'racing' && v.target?.at ? v.target.at : null;
      if (tg && !results) {
        const b = wrap(Math.atan2(tg.x - s.x, -(tg.z - s.z)) - (s.heading ?? 0)), rr = E.mkR - 2;
        E.mk.hidden = false; E.mk.style.transform = `translate(${(E.mkC.x + Math.sin(b) * rr).toFixed(1)}px,${(E.mkC.y - Math.cos(b) * rr).toFixed(1)}px) rotate(${(b / DEG).toFixed(1)}deg)`;
      } else E.mk.hidden = true;
    }
    if (m !== 'race') { E.help.hidden = true; E.mk.hidden = true; }
    E.clk.hidden = m !== 'race' || results;
    const rc = ctrls && cam.moved && !cam.ease && offness(followNow()) > 1 && !(views && views.view === 'helm');
    if (rc !== shown.rc) { shown.rc = rc; E.rc.classList.toggle('off', !rc); E.rc.tabIndex = rc ? 0 : -1; }
    if (drawerOpen) paintSheets();
  }

  // NAV's one calm pulse on the left corner
  let pulseT = null;
  const pulse = () => { const n = E?.auto; if (!n) return false; n.classList.remove('pulse'); void n.offsetWidth; n.classList.add('pulse'); clearTimeout(pulseT); pulseT = setTimeout(() => n.classList.remove('pulse'), 2000); return true; };
  return {
    update, pulse,
    get el() { return el; }, get on() { return on; }, get shown() { return !!shownNow; },
    get helm() { return on && shownNow ? helm : null; }, get steering() { return helm != null; },
    take(side) { const d = pend[side]; pend[side] = 0; return d; },
    get hold() { return { main: 0, jib: 0 }; },
    get drawer() { return drawerOpen; }, open(v = true) { setDrawer(v); },
    get split() { return split; }, get layout() { return L; }, get zones() { return L?.zones ?? null; }, get motor() { return motorNow; },
    get trim() { return E?.trim ?? null; },
    get camera() { return { moved: cam.moved, easing: !!cam.ease, fingers: cam.fingers.size, off: offness(followNow()) }; },
    get auto() { return autoOn(); },
    recentre: startEase,
    dispose() { H.classList.remove('lk-flat', 'lk-fl-race', 'lk-fl-wup', 'lk-fl-off', 'lk-fl-res'); features.mounted('flatControls', false); el?.remove(); },
  };
}
