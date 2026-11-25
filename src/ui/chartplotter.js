// The chartplotter (owner, 2026-10-29): an on-demand instrument, the way a captain glances at the
// electronics or the paper chart. Hidden by default. N shows and hides a small round chart top-right (the corner
// opposite the hints); N held enlarges it while held, centred-left, north-up, the whole bay; a click or a tap on the
// small chart pins it enlarged (N, Escape or a click outside lets go). The gamepad's right-stick click (R3) does the
// same as N.
//
// The look is a chart plotter's (v2,: IHO S-52 in manner): depth in blues, the own-ship symbol in binnacle
// amber with a heading line and a COG vector, a compass rim with 10° ticks, text on chips of the chart's ground, nm, the
// marks in their real colours. Atkinson Hyperlegible for the text, the sail's cream on the navy, no loud colour. The
// small chart is head-up (what is ahead is up, as in the view behind the boat); the enlarged one north-up (a paper
// chart, steady under the pointer for a waypoint). Dusk to night turns the palette dim and warm (nightOf).
//
// Content: the real shoreline and depth bands with the 5, 10, 30 and 60 m contours (the terrain grid, baked once into
// an offscreen base), the mouth's sill hatched as a hazard, the mooring balls, the hazard and speed buoys, the light,
// the harbour's breakwaters, the landmarks as tiny glyphs (names only in the "the island" style, enlarged only),
// today's track, the boat, the AI boats and the paddlewheeler as AIS-style targets, the true wind's arrow and knots,
// the scale and north. Pro (setPro(true)): a click on the enlarged chart sets a waypoint (a click on it clears it);
// the laylines for the true wind and the polar's tacking angle; VMG to the waypoint; the depth under the keel; the
// lift / header trend when the instruments give one.
//
// Cost: 2D canvas only. The base (≈ 2 M px, the grid, the contours) builds in ≤ 4 ms slices after start; the dynamic
// layer redraws at PLOT.hz only while a chart is shown. stats() reports both.
//
//   const cp = createChartplotter({ terrain, shoreline, harbour, places, boat: () => ({ x, z, heading, sog, cog, trueWind }),
//     track: () => [{ x, z, v }], targets: () => [{ kind, x, z, heading, speed }], sunElevDeg: () => deg, trend: () => ({ kind, level }) | null,
//     kayaks: () => [{ x, z, heading }] (the kayakers: small paddle marks in the chart's ink),
//     hidden: () => bool });
//   cp.update(dt)        // each frame (real time)
//   cp.setPro(on); cp.setWaypoint({ x, z } | null); cp.dispose();
// Cruise (owner, 2026-10-30): onPick({ x, z, name }) is told of a click on the enlarged chart (name: the named place
// within 22 px, else null); the owner of the callback answers by cp.setDestination({ x, z, name } | null), which draws the
// mark (a ring, a dashed line from the boat, its name). In pro the waypoint click is the same click: onPick wins.
// cp.setDestination({ x, z, name, label }): label is a short name the small round chart prints beside the mark.
// The passage plan (owner go 2026-11-12): with { plan: true } the enlarged chart is the planner, with no mode:
// a tap on the water appends a waypoint, a tap on a name appends that place, a tap on a ring removes it, a drag moves it, a
// tap on a leg's midpoint dot inserts one. Each is told as onPick({ op: 'add' | 'insert' | 'move' | 'remove', index, x, z,
// name }); Set course and Clear (the tools row, Enter) as onPick({ op: 'set' | 'clear' }). The owner answers with
// cp.setRoute(points, { active, plan, live }) (active: the waypoint the course is on, −1 a draft; plan: routePlan()'s
// legs, for the bends and the laylines; live: the route is always in force, Cruise: no Set course). Without an onPick the
// chart edits its own route (chartplotterData.js editRoute). The route layer draws in the chart's own ink only while a
// route exists: numbered rings (the active one amber), the legs (the active solid, the rest dashed), the laylines of a beat
// or a run on the active leg (port red, starboard green), the wind barbs; the small chart shows the active leg and its ring.
// The whole lake (v2, the whole-lake chart): with { lake: { bounds, keep, gridM, baseM } } the enlarged chart has two more zooms
// (LAKE_R: 9.6 km and 19.2 km half-heights; their view kept on the box keep, the lake's, the last the whole lake) over a coarse
// base of the terrain over bounds (gridM, baseM: v2 40 m and 30 m), built after the bay's base; a two-finger pinch steps the zoom on a finger (the
// wheel on a mouse). mark: () => { x, z } | null is Sail's own mark (v2's double-tap mark): an amber ring and dot with a dotted
// line from the boat, drawn while no Cruise mark is set.
// areas: () => [{ id, x, z, name, glyph: { big, small } (images: the engraving, the silhouette), lenM, aspect, px: { big: { min, max },
// small: { min, max } }, engraveFromPx, ring, still, ringS, ringA, pickAt(x, z) }] are named areas (v2: Tessie's water,
// § 6.4): a glyph at the centre on both charts, world-sized (lenM m wide on the water, clamped to px min…max; the engraving from
// engraveFromPx up, the silhouette under it), its name in italic under it on the enlarged one at the place names' size; while
// ring, a faint water ring widens from the glyph and fades, in proportion (still: one quiet ring, no motion). A tap on the
// glyph is a tap on a name: onPick's and the planner's pick carry { name, area: id } at pickAt(the last waypoint or the boat).
// anchorages: () => [{ x, z, name }] are the good anchoring spots (v2's,
// v2/sim/anchorages.js): a small anchor in the chart's ink on a chip of its ground; a tap within ANCHOR_GLYPH.hitPx of one on the
// enlarged chart is told as onAnchorage(spot) (before the planner's tap). Without them the chart is v1's.
// pins: () => [{ id, name, x, z, why, lit }] are the birthplaces (v2, Phase 1b): a small compass-point mark each on the
// enlarged chart (the lit one amber, named; a hover or the Tab walk lifts one and names it); a tap on one, or Enter on the walk's, opens a
// small card (its name, its line, "Sail from here") and is not a waypoint. onPin(pin) → a promise of { ok, text }: ok closes the chart
// (the move's veil is seen), text (a refusal, in plain words) shows in the card. Esc closes the card first.
import { FONT, UI, TOKENS, ensureTokens } from './tokens.js';
import { PLOT, PALETTES, makeView, buildGrid, fillRows, contourSegments, paintBase, gridHeight, laylinePlan, laylineRays, vmgTo, toKn, proLine, nightOf, ChartToggle, CHART_TEXT_ALPHA, CHART_CHIP, NM, editRoute, barbGrid, PLAN } from './chartplotterData.js';

const CSS = `
.lk-chart{position:fixed;inset:0;z-index:var(--lk-z-chart);pointer-events:none;user-select:none;-webkit-user-select:none;
  --sz:min(clamp(140px,30.6vh,340px),40vw);--bz:min(calc(var(--sz) * 2.5),80vh,92vw);
  font:var(--lk-regular) var(--lk-fs-caption)/1 var(--lk-ui);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased}
.lk-chart .pane{position:absolute;overflow:hidden;opacity:0;transition:opacity var(--lk-out) var(--lk-ease-out);
  box-shadow:0 2px 14px rgb(4 8 12 / .42),0 0 0 var(--lk-line) rgb(var(--lk-cream) / .16)}
.lk-chart .pane.in{opacity:.96;pointer-events:auto;transition:opacity var(--lk-in) var(--lk-ease)}
.lk-chart .pane canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.lk-chart .pane::after{content:'';position:absolute;inset:0;pointer-events:none;border-radius:inherit;
  background:radial-gradient(closest-side,transparent 62%,rgb(4 7 11 / .34) 92%,rgb(4 7 11 / .55) 100%)}
.lk-chart .small{bottom:var(--lk-by);left:var(--lk-mx);width:var(--lk-d);height:var(--lk-d);border-radius:50%;cursor:zoom-in;
  box-shadow:var(--lk-glass-shadow)}   /* plain glass and a hairline, content to the rim: the round family (tokens.css .lk-rd) */
.lk-chart .small::after{opacity:1;border:0;inset:0}
.lk-chart .small .win{position:absolute;inset:0;border-radius:50%;overflow:hidden;pointer-events:none}
.lk-chart .small .sc{position:absolute;left:0;right:0}
.lk-chart .small .sc.t{top:0;height:33%;background:linear-gradient(rgb(var(--lk-brand-navy) / .88) 0 62%,transparent)}
.lk-chart .small .sc.b{bottom:0;height:44%;background:linear-gradient(0deg,rgb(var(--lk-brand-navy) / .88) 0 72%,transparent)}
.lk-chart .small .inr.t{top:8%}
.lk-chart .small .inr.b{bottom:12%}
:where(:root[data-screen~=narrow]) .lk-chart .small{left:auto;right:var(--lk-mx);bottom:calc(var(--lk-by) + var(--lk-row-h) + var(--lk-gap))}:where(:root[data-screen~=narrow]) .lk-chart .rw i,:where(:root[data-screen~=narrow]) .lk-cv .rw i{display:none}:where(:root[data-screen~=narrow]) .lk-chart .small .inr.b{bottom:15%}:where(:root[data-screen~=narrow]) .lk-chart .small .inr.t{top:10%}:where(:root[data-screen~=narrow]) .lk-chart .small .inr.b .rw.s{display:none}
.lk-chart .small .rw.s[data-alarm] i,.lk-chart .small .rw.s[data-alarm] b,.lk-chart .small .rw.s[data-alarm] small{color:var(--lk-lit-ink)}   /* the sounder's alarm (src/boat/sounder.js): under 3 m below the keel the depth is lit, amber; under 1 m it blinks */
.lk-chart .small .rw.s[data-alarm="2"] b{animation:lk-dpt 1.4s steps(1,end) infinite}
@keyframes lk-dpt{0%{opacity:1}50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.lk-chart .small .rw.s[data-alarm="2"] b{animation:none}}
.lk-chart .small .inr.b .rw.s[data-alarm],[data-input=touch] .lk-chart .small .inr.b .rw.s[data-alarm]{display:flex}   /* the alarm shows on a phone too */
.lk-chart .big{left:clamp(28px,6vw,96px);top:50%;transform:translateY(-50%);width:var(--bz);height:var(--bz);border-radius:var(--lk-glass-r);
  box-shadow:0 0 0 1px var(--lk-glass-edge),0 6px 28px rgb(var(--lk-shade) / .5)}
.lk-chart .big.pro,.lk-chart .big.pick{cursor:crosshair}
.lk-chart .big::after{background:radial-gradient(farthest-side,transparent 70%,rgb(4 7 11 / .30) 96%,rgb(4 7 11 / .45) 100%)}
.lk-chart .tools{position:absolute;left:12px;bottom:12px;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100% - 24px)}
.lk-chart .tools button{appearance:none;font:var(--lk-medium,500) calc(var(--lk-fs-caption) * .86)/1 var(--lk-ui);color:var(--lk-ink);background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);
  border-radius:calc(var(--lk-glass-r) * .6);padding:.55em .8em;cursor:pointer;letter-spacing:.01em}
.lk-chart .tools button:hover,.lk-chart .tools button:focus-visible{border-color:rgb(var(--lk-cream) / .6);outline:none}
.lk-chart .tools button[data-on]{border-color:rgb(255 122 40 / .9)}
.lk-chart .tools button.go{border-color:rgb(var(--lk-amber) / .95);color:rgb(var(--lk-amber))}   /* Set course: the one primary on the chart */
[data-input=touch] .lk-chart .tools button.pl{min-height:44px;min-width:44px}
.lk-chart .tools .say{align-self:center;color:var(--lk-ink-soft);font-size:calc(var(--lk-fs-caption) * .82);padding:0 .4em}
.lk-chart .pcard{position:absolute;z-index:4;box-sizing:border-box;width:min(248px,64vw);display:flex;flex-direction:column;gap:6px;padding:11px 13px 13px;pointer-events:auto;
  color:var(--lk-ink);background:var(--lk-glass-dense);border:var(--lk-line) solid var(--lk-glass-edge);border-radius:var(--lk-glass-r);box-shadow:0 6px 24px rgb(var(--lk-shade) / .5)}
.lk-chart .pcard[hidden]{display:none}
.lk-chart .pcard .t{font:var(--lk-medium,500) calc(var(--lk-fs-caption) * 1.12)/1.15 var(--lk-ui);letter-spacing:.02em}
.lk-chart .pcard .w{font:italic var(--lk-regular) var(--lk-fs-caption)/1.3 var(--lk-ui);color:var(--lk-ink-soft)}
.lk-chart .pcard .say{font-style:normal;font-size:var(--lk-fs-caption);line-height:1.3;color:rgb(var(--lk-amber))}
.lk-chart .pcard .say:empty{display:none}
.lk-chart .pcard .go{appearance:none;align-self:flex-start;min-height:36px;font:var(--lk-medium,500) var(--lk-fs-caption)/1 var(--lk-ui);color:rgb(var(--lk-amber));background:none;border:var(--lk-line) solid rgb(var(--lk-amber) / .95);border-radius:calc(var(--lk-glass-r) * .6);padding:.6em 1em;cursor:pointer;letter-spacing:.01em}
[data-input=touch] .lk-chart .pcard .go{min-height:44px}
.lk-chart .pcard .go:hover,.lk-chart .pcard .go:focus-visible{background:rgb(var(--lk-amber) / .14);outline:none}
.lk-chart .big:focus-visible{outline:none}
.lk-chart .opener{display:none}
:where(:root[data-f-finger-targets=on]) .lk-chart .opener{display:block;position:absolute;bottom:var(--lk-by);left:var(--lk-mx);color:var(--lk-rest);opacity:.8;pointer-events:auto;transition:opacity .28s}   /* a small round button: the chart's, on touch */
  :where(:root[data-f-finger-targets=on]) .lk-chart[data-shown] .opener{opacity:0;pointer-events:none}
@media (prefers-reduced-motion:reduce){.lk-chart .pane{transition:none}}
`;

const DEG = Math.PI / 180;
import { clampT as clamp } from '../sim/core/math.js';
// the whole lake's two zooms past the bay's three (v2: { lake }), m of half-height
const LAKE_R = [9600, 19200];

// the kayak's chart mark (px at k = 1): the hull stroke's half-length, the paddle's half-span, a blade's half-length and
// half-width, the ink's alpha; drawn only inside the chart's range (near)
export const KAYAK_MARK = Object.freeze({ hull: 3.2, span: 4.6, blade: 1.7, bladeW: 0.95, alpha: 0.78, width: 1.0 });
// draw the kayakers' paddle marks: g a 2D context, view the chart's (toPx, dirPx), list [{ x, z, heading }]; returns how
// many it drew (the tests read it)
export function drawKayakMarks(g, view, list, { k = 1, ink, near = () => true, M = KAYAK_MARK } = {}) {
  let n = 0;
  const P = [0, 0];
  for (const q of list ?? []) {
    if (!near(q.x, q.z, 0)) continue;
    view.toPx(q.x, q.z, P);
    const [ux, uy] = view.dirPx(q.heading ?? 0), px = -uy, py = ux;
    g.beginPath();
    g.moveTo(P[0] - ux * M.hull * k, P[1] - uy * M.hull * k); g.lineTo(P[0] + ux * M.hull * k, P[1] + uy * M.hull * k);   // the hull
    g.moveTo(P[0] - px * M.span * k, P[1] - py * M.span * k); g.lineTo(P[0] + px * M.span * k, P[1] + py * M.span * k);   // the shaft, across
    g.strokeStyle = ink(M.alpha); g.lineWidth = M.width * k; g.stroke();
    g.beginPath();
    for (const sd of [1, -1]) {   // the blades at the shaft's ends, along it
      const bx = P[0] + px * (M.span + M.blade * 0.6) * k * sd, by = P[1] + py * (M.span + M.blade * 0.6) * k * sd;
      g.moveTo(bx + px * M.blade * k, by + py * M.blade * k);
      g.ellipse(bx, by, M.blade * k, M.bladeW * k, Math.atan2(py, px), 0, Math.PI * 2);
    }
    g.fillStyle = ink(M.alpha); g.fill();
    n++;
  }
  return n;
}
// the aids to navigation (v2's channel markers, v2/sim/channelMarks.js): a chart's buoy symbols (US Chart No. 1, Q): a small
// position ring at the foot and the buoy leaning right from it, a can square-topped, a nun pointed, a lighted buoy a little taller, the regulatory buoy thin; the
// lateral buoys in port red and starboard green, the no-wake buoy cream with an orange band; a lit one carries the light's magenta
// flare; on the enlarged chart's closest zoom a lit one's number in quotes and its light's characteristic beside it. px at k = 1
export const AID_MARK = Object.freeze({ h: 7.5, w: 3.2, lean: 0.35, ring: 1.3, labelMpp: 5, showMpp: 9 });
const AID_COL = Object.freeze({ red: [232, 78, 64], green: [84, 208, 136], white: TOKENS.cream });
// draw the aids: list [{ x, z, colour, shape, number, light, lightText }]; returns the drawn ones' { id, px, py } (the tests read it)
export function drawAidMarks(g, view, list, { k = 1, near = () => true, dim = 1, bg = [11, 16, 22], ink = (a) => rgba(TOKENS.cream, a), label = null, M = AID_MARK } = {}) {
  const out = [], P = [0, 0];
  const col = (c, a) => rgba([c[0] * dim, c[1] * dim, c[2] * dim], a);
  for (const m of list ?? []) {
    if (!near(m.x, m.z, 10)) continue;
    view.toPx(m.x, m.z, P);
    const x = P[0], y = P[1], h = M.h * k * (m.shape === 'lighted' ? 1.2 : m.shape === 'regulatory' ? 1.1 : 1), w = M.w * k * (m.shape === 'regulatory' ? 0.55 : 1), L = M.lean;
    if (m.light) {   // the light's flare (a chart's light symbol), toward the top right, under the buoy
      g.beginPath(); g.moveTo(x + 1, y - 1); g.quadraticCurveTo(x + 7 * k, y - 4 * k, x + 8.5 * k, y - 10 * k); g.quadraticCurveTo(x + 3 * k, y - 8 * k, x + 1, y - 1);
      g.fillStyle = col([226, 92, 190], 0.78); g.fill();
    }
    // the body: a quad from the foot, leaning right by L of its height (the nun's top a point)
    const fx = x + 1.6 * k, fy = y - 0.4 * k, tx = fx + h * L, ty = fy - h;
    g.beginPath();
    g.moveTo(fx - w / 2, fy); g.lineTo(fx + w / 2, fy);
    if (m.shape === 'conical') g.lineTo(tx, ty);
    else { g.lineTo(tx + w / 2, ty); g.lineTo(tx - w / 2, ty); }
    g.closePath();
    const c = AID_COL[m.colour] ?? AID_COL.white;
    g.fillStyle = col(c, 0.96); g.fill(); g.strokeStyle = rgba(bg, 0.9); g.lineWidth = 0.9; g.stroke();
    if (m.colour === 'white') { g.beginPath(); const b = 0.45; g.moveTo(fx - w / 2 + h * L * b, fy - h * b); g.lineTo(fx + w / 2 + h * L * b, fy - h * b); g.strokeStyle = col([255, 106, 26], 0.95); g.lineWidth = 1.6 * k; g.stroke(); }
    g.beginPath(); g.arc(x, y, M.ring * k, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.9); g.fill(); g.strokeStyle = ink(0.9); g.lineWidth = 0.8; g.stroke();
    // the lit ones' number and light (a chart's legend: "1" Fl G 4s), the red's to the west of it, the green's to the east, so a
    // gate's two never meet; an unlit buoy's number stays off (the symbols say enough)
    if (label && m.number && m.light && m.lightText) { const west = m.colour === 'red'; label(`"${m.number}" ${m.lightText}`, west ? x - 6 * k : x + 9 * k, y - h * 0.5, west ? 'right' : 'left'); }
    out.push({ id: m.id, px: +x.toFixed(1), py: +y.toFixed(1) });
  }
  return out;
}
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const rgba = (c, a) => `rgb(${c[0] | 0} ${c[1] | 0} ${c[2] | 0} / ${a.toFixed(3)})`;
const canvas2d = (w, h) => (typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h }));

// the anchorage's glyph (a chart's anchorage symbol: ring, stock, shank, arms) at (x, y), s px half-height, on a chip of the ground
export const ANCHOR_GLYPH = Object.freeze({ big: 7, small: 5.5, hitPx: 16, lift: 1.3 });   // lift: the lit glyph's size (v2's anchorage cue)
export function drawAnchorGlyph(g, x, y, s, ink, chip) {
  g.beginPath(); g.arc(x, y, s * 1.25, 0, Math.PI * 2); g.fillStyle = chip; g.fill();
  g.strokeStyle = ink; g.lineWidth = Math.max(1, s * 0.17); g.lineCap = 'round';
  g.beginPath(); g.arc(x, y - s * 0.74, s * 0.19, 0, Math.PI * 2);
  g.moveTo(x, y - s * 0.55); g.lineTo(x, y + s * 0.74);
  g.moveTo(x - s * 0.4, y - s * 0.32); g.lineTo(x + s * 0.4, y - s * 0.32);
  g.moveTo(x - s * 0.66, y + s * 0.2); g.quadraticCurveTo(x - s * 0.52, y + s * 0.82, x, y + s * 0.74); g.quadraticCurveTo(x + s * 0.52, y + s * 0.82, x + s * 0.66, y + s * 0.2);
  g.stroke();
}
// the anchorage under a chart px (toPx(x, z) → [px, py]): the nearest within r px, else null (pure)
export function anchorageAt(list, toPx, px, py, r = ANCHOR_GLYPH.hitPx) {
  let hit = null, hd = r;
  for (const a of list ?? []) { const q = toPx(a.x, a.z), d = Math.hypot(q[0] - px, q[1] - py); if (d < hd) { hd = d; hit = a; } }
  return hit;
}

export function createChartplotter({ root = document.body, terrain, shoreline = null, harbour = null, places = {}, boat, track = () => [], targets = () => [], kayaks = () => [],
  sunElevDeg = () => 20, trend = () => null, hidden = () => false, pro = false, course = null, startAfterS = 2.5, sliceMs = 4, onPick = null,
  plan: planOn = false, windAt = null, time = () => 0, lake = null, mark = () => null, areas = () => [], anchorages = () => [], onAnchorage = null, aids = () => [], pins = null, onPin = null, poi = null, shoreWarn = false } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-chart-css')) {
    const st = document.createElement('style'); st.id = 'lk-chart-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div'); el.className = 'lk-chart';
  el.innerHTML = '<div class="pane small lk-rd"><canvas></canvas><div class="win"><i class="sc t"></i><i class="sc b"></i><div class="inr t"><div class="rw"><i>HDG</i><b><span class="hdg">000</span>°T</b></div></div><div class="inr b">' + (poi ? '<div class="rw s"><i>DPT</i><b><span class="dep">0</span><small>m</small></b></div><div class="rw s poi"><i class="pk"></i><b><span class="pd"></span><small>nm</small><span class="pb"></span></b></div>' : '<div class="rw"><i>SOG</i><b><span class="sog">0.0</span><small>kn</small></b></div><div class="rw s"><i>DPT</i><b><span class="dep">0</span><small>m</small></b></div>') + '</div></div></div><div class="pane big"><canvas></canvas></div><div class="opener lk-rd sm" role="button" aria-label="chart"><span class="glass"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20Z"/><path d="M9 4v13.5M15 6.5V20"/></svg></span></div>';
  root.appendChild(el);
  const small = el.querySelector('.small'), big = el.querySelector('.big'), opener = el.querySelector('.opener');
  // the tools row, bottom-left of the enlarged chart: the passage plan's Set course · Clear (only while a route exists) and
  // the course tool (the racing marks: lay a practice course for the wind, or clear it), whose Lay buttons fold behind one
  // Race ▾ while a plan exists (owner decision 6), so the row stays three buttons
  let toolsEl = null, sayEl = null;
  const planBtns = {}, raceBtns = [];
  let raceOpen = false;
  if (course || planOn) {
    toolsEl = document.createElement('div'); toolsEl.className = 'tools';
    const btn = (label, fn, key, cls) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; if (key) b.dataset.key = key; if (cls) b.className = cls; b.addEventListener('pointerdown', (e) => e.stopPropagation()); b.addEventListener('click', (e) => { e.stopPropagation(); fn(); dirty = true; }); toolsEl.appendChild(b); return b; };
    if (planOn) {
      planBtns.set = btn('Set course', () => routePick({ op: 'set' }), 'set', 'pl go');
      planBtns.clear = btn('Clear', () => routePick({ op: 'clear' }), 'clearRoute', 'pl');
      if (course) planBtns.race = btn('Race ▾', () => { raceOpen = !raceOpen; }, 'race', 'pl');
      for (const b of Object.values(planBtns)) b.hidden = true;
    }
    if (course) {
      for (const k of course.kinds) raceBtns.push(btn(`Lay ${k.label.toLowerCase()}`, () => { course.lay(k.id); }, k.id));
      raceBtns.push(btn('Clear course', () => course.clear(), 'clear'));
      sayEl = document.createElement('span'); sayEl.className = 'say'; toolsEl.appendChild(sayEl);
    }
    big.appendChild(toolsEl);
  }
  const show = (b, on) => { if (b && b.hidden === on) b.hidden = !on; };
  function syncTools() {
    if (!toolsEl) return;
    const has = route.length > 0;
    if (!has) raceOpen = false;
    show(planBtns.set, has && routeActive < 0 && !routeLive);
    show(planBtns.clear, has);
    show(planBtns.race, has);
    if (planBtns.race) { const w = raceOpen ? 'Race ▴' : 'Race ▾'; if (planBtns.race.textContent !== w) planBtns.race.textContent = w; }
    const race = !has || raceOpen;
    for (const b of raceBtns) show(b, race && (b.dataset.key !== 'clear' || !!course?.laid));
    if (sayEl) { const t = race && course.laid ? `${course.label}${course.done ? ' · sailed' : ''}` : ''; if (sayEl.textContent !== t) sayEl.textContent = t; }
  }
  const cvS = small.querySelector('canvas'), cvB = big.querySelector('canvas');
  const readEl = el.querySelector('.small .win'), hdgEl = readEl.querySelector('.hdg'), sogEl = readEl.querySelector('.sog'), depEl = readEl.querySelector('.dep'), poiRow = readEl.querySelector('.poi'), poiK = readEl.querySelector('.pk'), poiD = readEl.querySelector('.pd'), poiB = readEl.querySelector('.pb');

  // ---- the static marks (world metres) ----
  const L = shoreline ?? {}, marks = [];
  for (const b of [...(L.balls ?? []), ...(L.field ?? [])]) marks.push({ k: 'ball', x: b.x, z: b.z });
  for (const b of L.hazards ?? []) marks.push({ k: 'hazard', x: b.x, z: b.z });
  for (const b of L.speedLine ?? []) marks.push({ k: 'speed', x: b.x, z: b.z });
  if (L.tower) marks.push({ k: 'light', x: L.tower.x, z: L.tower.z });
  const piers = (L.piers ?? []).map((q) => [q.x, q.z, q.x + q.dirX * q.length, q.z + q.dirZ * q.length]);
  const breakwaters = (harbour?.breakwaters ?? []).map((b) => b.path);
  const docks = (harbour?.docks ?? []).filter((d) => d.a && d.b).map((d) => [d.a[0], d.a[1], d.b[0], d.b[1]]);
  const labels = [
    ['island', 'the island'], ['waterfall', 'the waterfall'], ['house', 'the stone house'], ['narrows', 'the narrows'],
    ['harbour', 'the harbour'], ['light', 'the light'], ['moorings', 'the moorings'], ['teahouse', 'the tea house'],
  ].filter(([id]) => places[id]).map(([id, name]) => ({ id, name: places[id].name ?? name, x: places[id].x, z: places[id].z }));
  const sill = terrain.mouth ? [(terrain.mouth.a[0] + terrain.mouth.b[0]) / 2, (terrain.mouth.a[1] + terrain.mouth.b[1]) / 2] : null;
  // the sill's own shallowest crossing, for its label: the shoal along the channel's axis
  let shoal = null;
  if (terrain.mouth) {
    const [a, b] = [terrain.mouth.a, terrain.mouth.b];
    for (let f = 0; f <= 1; f += 0.02) { const x = a[0] + (b[0] - a[0]) * f, z = a[1] + (b[1] - a[1]) * f, d = -terrain.heightAt(x, z); if (d > 0 && (!shoal || d < shoal.d)) shoal = { x, z, d }; }
  }

  // ---- the base: built in slices ----
  const B = PLOT.bounds, BW = Math.round((B.x1 - B.x0) / PLOT.baseM), BH = Math.round((B.z1 - B.z0) / PLOT.baseM);
  const grid = buildGrid(terrain.heightAt, B, PLOT.gridM, { fill: false });
  const contours = {};   // depth → Float32Array of segments
  const bases = { day: null, night: null };
  const buildMs = { day: 0, night: 0, grid: 0, contours: 0, slices: 0, maxSliceMs: 0 };
  const fine = { B, BW, BH, mpp: PLOT.baseM, grid, contours, bases, ms: buildMs };
  // the whole lake's coarse layer (v2): drawn under the bay's, built once the bay's day base is in
  const far = lake?.bounds ? (() => {
    const LB = lake.bounds, gm = lake.gridM ?? 40, bm = lake.baseM ?? 25;
    return { B: LB, keep: lake.keep ?? LB, BW: Math.round((LB.x1 - LB.x0) / bm), BH: Math.round((LB.z1 - LB.z0) / bm), mpp: bm, grid: buildGrid(terrain.heightAt, LB, gm, { fill: false }), contours: {},
      bases: { day: null, night: null }, ms: { day: 0, night: 0, grid: 0, contours: 0, slices: 0, maxSliceMs: 0 } };
  })() : null;
  const bigRs = far ? [...PLOT.bigR, ...LAKE_R] : PLOT.bigR;
  let building = null;
  function* buildSteps(name, layer = fine) {
    const pal = PALETTES[name], { B, BW, BH, grid, contours, bases } = layer, buildMs = layer.ms;
    if (grid.rows < grid.h) {
      const t = performance.now();
      for (let r = 0; r < grid.h; r += 16) { fillRows(grid, r, r + 16); yield; }
      buildMs.grid = performance.now() - t;
    }
    if (!contours.ready) {
      const t = performance.now();
      for (const d of [0, ...PLOT.contours]) {
        const parts = [];
        for (let r = 0; r < grid.h - 1; r += 40) { parts.push(contourSegments(grid, d, r, r + 40)); yield; }
        const n = parts.reduce((s, p) => s + p.length, 0), all = new Float32Array(n); let o = 0;
        for (const p of parts) { all.set(p, o); o += p.length; }
        contours[d] = all;
      }
      contours.ready = true; buildMs.contours = performance.now() - t;
    }
    const c = canvas2d(BW, BH), g = c.getContext('2d');
    const rows = 10, img = g.createImageData(BW, rows);
    for (let y = 0; y < BH; y += rows) {
      const n = Math.min(rows, BH - y), px = img.data;
      paintBase(px, BW, n, grid, pal, { mPerPx: layer.mpp, sill, y0: 0, y1: n, oy: y });
      g.putImageData(img, 0, y, 0, 0, BW, n);
      yield;
    }
    // the contours and the shore as hairlines, in base px
    g.lineJoin = 'round'; g.lineCap = 'round';
    const k = 1 / layer.mpp;
    for (const d of [...PLOT.contours, 0]) {
      const s = contours[d];
      g.beginPath();
      for (let i = 0; i < s.length; i += 4) { g.moveTo((s[i] - B.x0) * k, (s[i + 1] - B.z0) * k); g.lineTo((s[i + 2] - B.x0) * k, (s[i + 3] - B.z0) * k); }
      g.strokeStyle = rgba(pal.ink, d === 0 ? pal.shore : pal.contour * (d >= 30 ? 0.75 : 1));
      g.lineWidth = d === 0 ? 1.15 : 0.7;
      g.stroke();
      yield;
    }
    bases[name] = c;
  }
  function build(name, layer = fine) {
    if (layer.bases[name] || building) return;
    const it = buildSteps(name, layer), t0 = performance.now(), buildMs = layer.ms, bases = layer.bases;
    building = name;
    const run = () => {
      if (disposed) return;
      const t = performance.now();
      let done = false;
      while (performance.now() - t < sliceMs) { if (it.next().done) { done = true; break; } }
      const ms = performance.now() - t;
      buildMs.slices++; buildMs.maxSliceMs = Math.max(buildMs.maxSliceMs, ms);
      if (done) { buildMs[name] = performance.now() - t0; building = null; dirty = true; return; }
      setTimeout(run, 0);
    };
    setTimeout(run, 0);
  }

  // ---- input ----
  // the key's timing on the event clock, not the frames' sum: a slow frame must not turn a tap into a hold
  const tog = new ChartToggle(), now = () => performance.now() / 1000;
  tog.shown = true;   // the chart is the dashboard's left circle: always up (N taps open the big chart, N held enlarges it)
  let t = 0, disposed = false, dirty = true, since = 1, isPro = !!pro, waypoint = null, zoom = PLOT.bigZoom, lastBig = null;
  const onKeyDown = (e) => {
    if (e.code === 'KeyN' && !e.ctrlKey && !e.metaKey && !e.altKey) { if (!e.repeat) tog.down(now()); }
    else if (e.code === 'Escape' && selPin) closePinCard();   // the pin's card first
    else if (e.code === 'Escape' && tog.pinned) tog.unpin();
    else if (e.code === 'Enter' && planOn && tog.pinned && !e.repeat && route.length && routeActive < 0 && !routeLive) routePick({ op: 'set' });   // Set course
  };
  const onKeyUp = (e) => { if (e.code === 'KeyN') tog.up(now()); };
  const onBlur = () => { if (tog.downAt != null) { tog.downAt = null; tog.held = false; } };
  addEventListener('keydown', onKeyDown); addEventListener('keyup', onKeyUp); addEventListener('blur', onBlur);
  small.title = 'Open the chart (N)'; small.setAttribute('aria-label', 'chart: open it large');   // round 4: the circle is a button for the big chart
  small.addEventListener('pointerdown', (e) => { e.stopPropagation(); tog.pin(); dirty = true; });
  const touchUi = () => document.documentElement.dataset.input === 'touch';   // a finger: the opener opens the enlarged chart (the small one has no room; a tap outside closes both)
  opener.addEventListener('pointerdown', (e) => { e.stopPropagation(); tog.shown = true; if (touchUi()) tog.pin(); dirty = true; });
  // ---- the birthplace pins (Phase 1b): hover, the Tab walk, a small card with one action ----
  let hoverPin = null, selPin = null, focusPin = null, pinRows = [], pinBusy = false;
  const pcard = pins ? document.createElement('div') : null;
  if (pcard) {
    pcard.className = 'pcard'; pcard.hidden = true; pcard.setAttribute('role', 'dialog');
    pcard.innerHTML = '<b class="t"></b><span class="w"></span><button type="button" class="go">Sail from here</button><i class="say" role="status" aria-live="polite"></i>';
    el.appendChild(pcard);
    big.setAttribute('aria-label', 'Chart: Tab walks the places, Enter opens one');
    for (const ty of ['pointerdown', 'click']) pcard.addEventListener(ty, (e) => e.stopPropagation());
  }
  const pinAtPx = (px, py) => { let hit = null, hd = touchUi() ? 24 : 16; for (const r of pinRows) { const d = Math.hypot(r.px - px, r.py - py); if (d < hd) { hd = d; hit = r; } } return hit; };
  function placeCard() {
    if (!pcard || pcard.hidden) return;
    const r = pinRows.find((q) => q.id === selPin);
    if (!r || !big.classList.contains('in')) { closePinCard(); return; }
    const cr = cvB.getBoundingClientRect(), w = pcard.offsetWidth, h = pcard.offsetHeight;
    let x = cr.left + r.px + 16; if (x + w > innerWidth - 8) x = cr.left + r.px - 16 - w;
    pcard.style.left = `${Math.max(8, x)}px`; pcard.style.top = `${clamp(cr.top + r.py - 22, 8, Math.max(8, innerHeight - h - 8))}px`;
  }
  function selectPin(id) {
    const p = pins?.()?.find((q) => q.id === id); if (!p || !pcard) return;
    selPin = id; focusPin = id; pcard.hidden = false;
    pcard.querySelector('.t').textContent = p.name; pcard.querySelector('.w').textContent = p.why ?? ''; pcard.querySelector('.say').textContent = '';
    pcard.setAttribute('aria-label', p.name); dirty = true; placeCard();
    pcard.querySelector('.go').focus({ preventScroll: true });
  }
  function closePinCard() { if (!pcard) return; const had = !pcard.hidden; pcard.hidden = true; selPin = null; if (had) { dirty = true; if (document.activeElement && pcard.contains(document.activeElement)) big.focus({ preventScroll: true }); } }
  pcard?.querySelector('.go').addEventListener('click', async () => {
    const p = pins?.()?.find((q) => q.id === selPin); if (!p || pinBusy) return;
    pinBusy = true;
    let r = null; try { r = await onPin?.(p); } catch { r = { ok: false, text: 'That did not work.' }; }
    pinBusy = false;
    if (r?.ok) { closePinCard(); tog.unpin(); if (touchUi()) tog.shown = false; dirty = true; }
    else if (pcard) pcard.querySelector('.say').textContent = r?.text ?? '';
  });
  if (pins) {
    big.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = cvB.getBoundingClientRect(), h = pinAtPx(e.clientX - r.left, e.clientY - r.top), id = h?.id ?? null;
      if (id !== hoverPin) { hoverPin = id; big.style.cursor = id ? 'pointer' : ''; dirty = true; }
    });
    big.addEventListener('pointerleave', () => { if (hoverPin) { hoverPin = null; big.style.cursor = ''; dirty = true; } });
    big.addEventListener('keydown', (e) => {
      if (!pinRows.length || e.ctrlKey || e.metaKey || e.altKey) return;
      const i = pinRows.findIndex((q) => q.id === focusPin);
      if (e.code === 'Tab' || e.code === 'ArrowRight' || e.code === 'ArrowDown' || e.code === 'ArrowLeft' || e.code === 'ArrowUp') {
        const back = e.code === 'ArrowLeft' || e.code === 'ArrowUp' || (e.code === 'Tab' && e.shiftKey), n = i + (back ? -1 : 1);
        if (e.code === 'Tab' && (n < 0 || n >= pinRows.length)) { focusPin = null; dirty = true; return; }   // past the ends: the page's own Tab
        e.preventDefault(); focusPin = pinRows[(n + pinRows.length) % pinRows.length].id; dirty = true;
      } else if ((e.code === 'Enter' || e.code === 'Space') && focusPin) { e.preventDefault(); selectPin(focusPin); }
    });
    big.addEventListener('blur', () => { if (focusPin && !selPin) { focusPin = null; dirty = true; } });
  }
  // the nearest named place within 22 px of a chart px (the waterfall is on land: the owner of onPick snaps it to water)
  // a named area's glyph wins inside its own box (half its width, at least 22 px)
  const nameAt = (px, py) => {
    for (const a of areas()) {
      const q = lastBig.toPx(a.x, a.z), [gw, gh] = areaPx(a, true, lastBig.mPerPx), w = Math.max(16, gw / 2 + 6), h = Math.max(14, gh / 2 + 6);
      if (Math.abs(q[0] - px) >= w || Math.abs(q[1] - py) >= h) continue;
      const from = route.length ? route[route.length - 1] : boat(), at = (from && a.pickAt?.(from.x, from.z)) || { x: a.x, z: a.z };
      return { id: a.id, name: a.name, x: at.x, z: at.z, area: a.id };
    }
    let hit = null, hd = 22; for (const l of labels) { const q = lastBig.toPx(l.x, l.z), d = Math.hypot(q[0] - px, q[1] - py); if (d < hd) { hd = d; hit = l; } } return hit;
  };
  const areaOf = (hit) => (hit?.area ? { area: hit.area } : {});
  // an area's glyph on a chart, px [w, h]: its world length at the chart's scale, clamped (a row without lenM: the cap)
  function areaPx(a, isBig, mpp) {
    const lim = (isBig ? a.px?.big : a.px?.small) ?? { min: isBig ? 16 : 12, max: isBig ? 64 : 20 };
    const w = Math.min(lim.max, Math.max(lim.min, a.lenM ? a.lenM / mpp : lim.max));
    return [w, w * (a.aspect ?? 0.625)];
  }
  // the plan's taps (§ 6): a ring (36 px on a finger), a leg's midpoint dot (32 px), else the water or a
  // name; a drag starts after 8 px and moves the ring; the edit is told on the release
  let press = null;
  const hitR = () => (touchUi() ? 18 : 12), dotR = () => (touchUi() ? 16 : 9);
  function planHit(px, py) {
    const a = routeFrom(), s = boat();
    let best = null, bd = hitR();
    for (let i = a; i < route.length; i++) { const q = lastBig.toPx(route[i].x, route[i].z), d = Math.hypot(q[0] - px, q[1] - py); if (d < bd) { bd = d; best = { kind: 'ring', i }; } }
    if (best) return best;
    if (s) {
      let prev = s; bd = dotR();
      for (let i = a; i < route.length; i++) { const q = lastBig.toPx((prev.x + route[i].x) / 2, (prev.z + route[i].z) / 2), d = Math.hypot(q[0] - px, q[1] - py); if (d < bd) { bd = d; best = { kind: 'dot', i, x: (prev.x + route[i].x) / 2, z: (prev.z + route[i].z) / 2 }; } prev = route[i]; }
      if (best) return best;
    }
    return { kind: 'pick' };
  }
  const onPlanMove = (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (!press.moved && Math.hypot(e.clientX - press.cx, e.clientY - press.cy) > 8) press.moved = true;
    if (press.moved && press.kind === 'ring' && lastBig) { const r = cvB.getBoundingClientRect(), w = lastBig.toWorld(e.clientX - r.left, e.clientY - r.top); drag = { i: press.i, x: w[0], z: w[1] }; dirty = true; }
  };
  const onPlanUp = (e) => {
    if (!press || e.pointerId !== press.id) return;
    const p = press; press = null;
    const d = drag; drag = null; dirty = true;
    if (p.kind === 'ring') { if (p.moved && d) routePick({ op: 'move', index: p.i, x: d.x, z: d.z }); else if (!p.moved) routePick({ op: 'remove', index: p.i }); return; }
    if (p.moved) return;
    if (p.kind === 'dot') { routePick({ op: 'insert', index: p.i, x: p.x, z: p.z, name: null }); return; }
    const hit = nameAt(p.px, p.py), w = lastBig.toWorld(p.px, p.py);
    routePick(hit ? { op: 'add', append: true, index: route.length, x: hit.x, z: hit.z, name: hit.name, ...areaOf(hit) } : { op: 'add', append: true, index: route.length, x: w[0], z: w[1], name: null });
  };
  if (planOn) { addEventListener('pointermove', onPlanMove); addEventListener('pointerup', onPlanUp); addEventListener('pointercancel', onPlanUp); }
  big.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if ((!isPro && !onPick && !planOn) || !lastBig || pinch) return;
    const r = cvB.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
    if (pins) {   // a birthplace: its card, not a waypoint (an anchorage's glyph nearer to the tap than the pin keeps the tap)
      const hit = pinAtPx(px, py), anc = onAnchorage ? anchorageAt(anchorages(), (x, z) => lastBig.toPx(x, z), px, py) : null;
      const near = (q) => Math.hypot(q[0] - px, q[1] - py);
      if (hit && !(anc && near(lastBig.toPx(anc.x, anc.z)) < Math.hypot(hit.px - px, hit.py - py))) { selectPin(hit.id); return; }
      if (selPin) closePinCard();
    }
    if (onAnchorage) { const a = anchorageAt(anchorages(), (x, z) => lastBig.toPx(x, z), px, py); if (a) { onAnchorage(a); dirty = true; return; } }   // an anchorage: its owner's (v2: AUTO's target)
    if (planOn) { press = { ...planHit(px, py), id: e.pointerId, cx: e.clientX, cy: e.clientY, px, py, moved: false }; return; }
    if (onPick) {
      const w = lastBig.toWorld(px, py), hit = nameAt(px, py);
      onPick(hit ? { x: hit.x, z: hit.z, name: hit.name, ...areaOf(hit) } : { x: w[0], z: w[1], name: null });
      return;
    }
    if (waypoint) { const q = lastBig.toPx(waypoint.x, waypoint.z); if (Math.hypot(q[0] - px, q[1] - py) < 14) { setWaypoint(null); return; } }
    const w = lastBig.toWorld(px, py);
    setWaypoint({ x: w[0], z: w[1] });
  });
  big.addEventListener('wheel', (e) => { e.preventDefault(); zoom = clamp(zoom + (e.deltaY > 0 ? 1 : -1), 0, bigRs.length - 1); dirty = true; }, { passive: false });
  // a two-finger pinch on the enlarged chart steps the zoom (each step doubles the range); it cancels the first finger's tap
  const fingers = new Map();
  let pinch = null;
  big.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (fingers.size === 2) { const [a, b] = [...fingers.values()]; pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: zoom }; press = null; drag = null; }
  }, { capture: true });
  const onPinchMove = (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, [e.clientX, e.clientY]);
    if (!pinch || fingers.size < 2) return;
    const [a, b] = [...fingers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
    const z = clamp(pinch.z0 + Math.round(Math.log2(pinch.d0 / d)), 0, bigRs.length - 1);
    if (z !== zoom) { zoom = z; dirty = true; }
  };
  const onPinchUp = (e) => { fingers.delete(e.pointerId); if (fingers.size < 2) pinch = null; };
  addEventListener('pointermove', onPinchMove); addEventListener('pointerup', onPinchUp); addEventListener('pointercancel', onPinchUp);
  const onDocDown = (e) => { if (tog.pinned && !big.contains(e.target) && !small.contains(e.target)) { tog.unpin(); if (touchUi()) tog.shown = false; } };
  addEventListener('pointerdown', onDocDown);
  // the gamepad: the right stick's click (R3, standard button 11) is N; polled only once a pad has connected
  let padOn = typeof navigator !== 'undefined' && [...(navigator.getGamepads?.() ?? [])].some(Boolean), padDown = false;
  const onPad = () => { padOn = true; };
  addEventListener('gamepadconnected', onPad);
  function pollPad() {
    if (!padOn) return;
    const gp = [...(navigator.getGamepads?.() ?? [])].find((p) => p && p.connected);
    const b = !!gp?.buttons?.[11]?.pressed;
    if (b && !padDown) tog.down(now()); else if (!b && padDown) tog.up(now());
    padDown = b;
  }
  function setWaypoint(w) { waypoint = w ? { x: w.x, z: w.z } : null; dirty = true; }
  let dest = null;   // Cruise's chosen mark: { x, z, name }
  // label: a short name for the small round chart (the enlarged chart prints the full name), e.g. the fireworks' viewing spot
  function setDestination(d) { dest = d ? { x: d.x, z: d.z, name: d.name ?? null, label: d.label ?? null } : null; dirty = true; }
  function setPro(on) { isPro = !!on; big.classList.toggle('pro', isPro); if (!isPro) waypoint = null; dirty = true; }
  setPro(isPro);
  big.classList.toggle('pick', !!onPick || !!planOn);
  // the passage plan's route: [{ x, z, name }]; routeActive: the waypoint the course is on (−1: a draft); routePlanned:
  // routePlan()'s answer for route.slice(routeFrom()) (the bends, the laylines' angle); routeLive: always in force (Cruise)
  let route = [], routeActive = -1, routePlanned = null, routeLive = false, drag = null;
  const routeFrom = () => (routeActive > 0 ? Math.min(routeActive, route.length) : 0);
  function setRoute(pts, { active = -1, plan: rp = null, live = false } = {}) {
    route = (pts ?? []).map((p) => ({ x: p.x, z: p.z, name: p.name ?? null }));
    routeActive = route.length ? Math.min(active, route.length - 1) : -1; routePlanned = rp; routeLive = !!live; dirty = true;
  }
  // an edit or a button: to the owner (onPick), else the chart keeps its own draft
  function routePick(p) {
    if (onPick) { onPick(p); return; }
    const r = editRoute(route, p);
    if (r) setRoute(r, { active: routeActive, live: routeLive });
    else if (p.op === 'set' && route.length) setRoute(route, { active: 0 });
  }

  // ---- sizes ----
  let dpr = 1, sS = 0, sB = 0;
  function layout() {
    dpr = Math.min(3, globalThis.devicePixelRatio || 1);   // a 3x phone draws its chart at 3x (feat/portrait: crisp on the iPhone)
    const a = Math.max(0, small.clientWidth - 2) || 220, b = big.clientWidth || 550;
    if (a !== sS) { sS = a; cvS.width = Math.round(a * dpr); cvS.height = Math.round(a * dpr); }
    if (b !== sB) { sB = b; cvB.width = Math.round(b * dpr); cvB.height = Math.round(b * dpr); }
  }
  const onResize = () => { sS = sB = 0; dirty = true; };
  addEventListener('resize', onResize);

  // ---- drawing ----
  const stats = { redraws: 0, drawMs: [], updateMs: [], maxDrawMs: 0 };
  const P = [0, 0], Q = [0, 0];
  function drawBase(g, view, rWorld, wc, night) {
    if (far) drawLayer(g, view, rWorld, wc, night, far);
    drawLayer(g, view, rWorld, wc, night, fine);
  }
  function drawLayer(g, view, rWorld, wc, night, { B, BW, BH, mpp: baseM, bases }) {
    const PLOT = { baseM };
    const src = (b, a) => {
      if (!b || a <= 0.001) return;
      // the source square about the visible centre, in base px (a circle or a square of half-size rWorld)
      const x0 = clamp((wc[0] - rWorld * 1.45 - B.x0) / PLOT.baseM, 0, BW), x1 = clamp((wc[0] + rWorld * 1.45 - B.x0) / PLOT.baseM, 0, BW);
      const y0 = clamp((wc[1] - rWorld * 1.45 - B.z0) / PLOT.baseM, 0, BH), y1 = clamp((wc[1] + rWorld * 1.45 - B.z0) / PLOT.baseM, 0, BH);
      if (x1 - x0 < 1 || y1 - y0 < 1) return;
      g.save();
      g.globalAlpha = a;
      g.translate(view.ox, view.oy); g.rotate(-view.rot); g.scale(1 / view.mPerPx, 1 / view.mPerPx); g.translate(-view.cx, -view.cz);
      g.drawImage(b, x0, y0, x1 - x0, y1 - y0, B.x0 + x0 * PLOT.baseM, B.z0 + y0 * PLOT.baseM, (x1 - x0) * PLOT.baseM, (y1 - y0) * PLOT.baseM);
      g.restore();
    };
    src(bases.day, 1);
    if (bases.night) src(bases.night, night);
  }
  const seg = (g, view, x0, z0, x1, z1) => { view.toPx(x0, z0, P); view.toPx(x1, z1, Q); g.moveTo(P[0], P[1]); g.lineTo(Q[0], Q[1]); };

  // ---- the passage plan's layer: cream, amber for the active ring, red / green on the laylines only;
  // nothing pulses ----
  const routeAt = (i) => (drag && drag.i === i ? drag : route[i]);
  const drawn = { big: null, small: null };   // what the route layer last drew on each chart (stats(); the page test reads it)
  function drawRoute(g, view, { isBig, S, s, I, A, bg, windFrom, twsKn, near, txt, routeNames, night }) {
    const a = routeFrom(), legs = routePlanned?.legs ?? [];
    if (a >= route.length) return;
    const pts = [s, ...route.slice(a).map((_, k) => routeAt(a + k))];
    const line = (k) => {   // leg k's polyline: the A* bend when the plan has one (and no ring is being dragged), else straight
      const L = legs[k];
      if (L?.path && !drag) { g.moveTo(...view.toPx(pts[k].x, pts[k].z, P)); for (const q of L.path.slice(1, -1)) { view.toPx(q[0], q[1], P); g.lineTo(P[0], P[1]); } view.toPx(pts[k + 1].x, pts[k + 1].z, P); g.lineTo(P[0], P[1]); }
      else seg(g, view, pts[k].x, pts[k].z, pts[k + 1].x, pts[k + 1].z);
    };
    if (!isBig) {   // the small chart: the active leg and its ring only
      g.setLineDash([]); g.beginPath(); line(0); g.strokeStyle = rgba(bg, 0.7); g.lineWidth = 3.2; g.stroke(); g.strokeStyle = I(0.92); g.lineWidth = 1.4; g.stroke();
      const q = pts[1];
      const on = near(q.x, q.z, 30);
      if (on) { view.toPx(q.x, q.z, P); g.beginPath(); g.arc(P[0], P[1], 5, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.7); g.fill(); g.strokeStyle = A(1); g.lineWidth = 1.4; g.stroke(); }
      drawn.small = { rings: on ? 1 : 0, legs: 1 };
      return;
    }
    // the laylines through the active waypoint, when its leg is a beat or a run: port red, starboard green, dashed
    const L0 = legs[0], laid = L0 && (L0.point === 'beat' || L0.point === 'run') && windFrom != null && !drag;
    let rings = 0;
    if (laid) {
      const w = pts[1], len = Math.min(1500, Math.max(150, 0.8 * Math.hypot(w.x - s.x, w.z - s.z)));
      const [stbd, port] = laylineRays(w, windFrom, (L0.twaSail ?? 45) * DEG, len);
      const day = 1 - night * 0.5;
      g.setLineDash([4, 3]); g.lineWidth = 1.1;
      g.beginPath(); seg(g, view, ...port); g.strokeStyle = rgba(lerp3(TOKENS.port, TOKENS.night.port, night), 0.85 * day + 0.15); g.stroke();
      g.beginPath(); seg(g, view, ...stbd); g.strokeStyle = rgba(lerp3(TOKENS.stbd, TOKENS.night.stbd, night), 0.85 * day + 0.15); g.stroke();
      g.setLineDash([]);
    }
    // the legs: the active one solid on a dark under-stroke, the rest dashed
    for (let k = 0; k < pts.length - 1; k++) {
      g.beginPath(); line(k);
      if (k === 0) { g.setLineDash([]); g.strokeStyle = rgba(bg, 0.6); g.lineWidth = 3.4; g.stroke(); g.strokeStyle = I(0.92); g.lineWidth = 1.6; g.stroke(); }
      else { g.setLineDash([5, 4]); g.strokeStyle = I(0.6); g.lineWidth = 1.2; g.stroke(); g.setLineDash([]); }
    }
    // a leg's midpoint dot: tap it to insert a waypoint there (an editable plan only)
    if (planOn) for (let k = 0; k < pts.length - 1; k++) {
      view.toPx((pts[k].x + pts[k + 1].x) / 2, (pts[k].z + pts[k + 1].z) / 2, P);
      g.beginPath(); g.arc(P[0], P[1], 3.4, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.6); g.fill();
      g.beginPath(); g.arc(P[0], P[1], 2.2, 0, Math.PI * 2); g.fillStyle = I(0.7); g.fill();
    }
    // the waypoints: numbered rings on a chip of the chart's ground; the active one amber
    for (let k = 1; k < pts.length; k++) {
      const q = pts[k], i = a + k - 1, on = k === 1;
      if (!near(q.x, q.z, 30)) continue;
      view.toPx(q.x, q.z, P);
      g.beginPath(); g.arc(P[0], P[1], 9, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.72); g.fill(); g.strokeStyle = on ? A(1) : I(0.92); g.lineWidth = 1.4; g.stroke();
      g.font = `500 12px ${UI}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = on ? A(1) : I(0.94); g.fillText(String(i + 1), P[0], P[1] + 0.5);
      rings++;
    }
    const fs = Math.round(clamp(S / 38, 13, 16));
    for (const n of routeNames) txt(n.text, n.x, n.y, { align: n.al, fs, a: 0.95 });
    drawn.big = { rings, legs: pts.length - 1, solid: 1, dashed: pts.length - 2, laylines: !!laid, barbs: barbs?.length ?? 0 };
  }
  // the wind barbs: the staff toward where the wind comes from, one long feather per 10 kn and a short one
  // per 5, cream at .5; from the wind's 60 s mean (barbGrid), recomputed once a second, never per frame
  let barbs = null, barbAt = -Infinity, barbKey = '';
  function drawBarbs(g, view, S, I) {
    if (!windAt) return;
    // the grid spans the route's own water (the boat and its waypoints, padded), so the barbs read where the plan sails
    const s = boat(), phone = S < 480, pts = [s, ...route.slice(routeFrom())].filter(Boolean).map((q) => view.toPx(q.x, q.z, [0, 0]));
    const pad = Math.max(60, S * 0.08), minW = S * 0.45;
    let x0 = Math.min(...pts.map((q) => q[0])) - pad, x1 = Math.max(...pts.map((q) => q[0])) + pad, y0 = Math.min(...pts.map((q) => q[1])) - pad, y1 = Math.max(...pts.map((q) => q[1])) + pad;
    if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
    if (y1 - y0 < minW) { const c = (y0 + y1) / 2; y0 = c - minW / 2; y1 = c + minW / 2; }
    const edge = S * 0.04, rect = { x0: clamp(x0, edge, S - edge), y0: clamp(y0, edge, S - edge), x1: clamp(x1, edge, S - edge), y1: clamp(y1, edge, S - edge) };
    const key = `${S}|${zoom}|${Math.round(view.cx / 40)}|${Math.round(view.cz / 40)}|${route.length}|${routeFrom()}`;
    if (!barbs || t - barbAt >= PLAN.refreshS || key !== barbKey) {
      barbAt = t; barbKey = key;
      barbs = barbGrid(rect, view, windAt, time(), { cols: 3, rows: phone ? 2 : 3, isWater: (x, z) => gridOrTerrain(x, z) < -1 })
        .filter((b) => pts.every((q) => Math.hypot(b.px - q[0], b.py - q[1]) > 30));   // never on the own ship or a ring
    }
    const Lb = phone ? 16 : 22;
    g.setLineDash([]); g.lineWidth = 1.2; g.strokeStyle = I(0.5); g.fillStyle = I(0.5);
    for (const b of barbs) {
      view.toPx(b.x, b.z, P);
      const [ux, uy] = view.dirPx(b.fromRad), px = -uy, py = ux, kn = Math.round(b.kn / 5) * 5;
      g.beginPath(); g.arc(P[0], P[1], 1.6, 0, Math.PI * 2); g.fill();
      if (kn < 5) { g.beginPath(); g.arc(P[0], P[1], 4, 0, Math.PI * 2); g.stroke(); continue; }   // calm: a ring
      const ex = P[0] + ux * Lb, ey = P[1] + uy * Lb;
      g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(ex, ey);
      let o = 0;
      for (let n = Math.floor(kn / 10); n > 0; n--, o += 3.6) { const bx = ex - ux * o, by = ey - uy * o; g.moveTo(bx, by); g.lineTo(bx + px * Lb * 0.45 + ux * Lb * 0.16, by + py * Lb * 0.45 + uy * Lb * 0.16); }
      if (kn % 10 >= 5) { if (o === 0) o = 3.6; const bx = ex - ux * o, by = ey - uy * o; g.moveTo(bx, by); g.lineTo(bx + px * Lb * 0.24 + ux * Lb * 0.08, by + py * Lb * 0.24 + uy * Lb * 0.08); }
      g.stroke();
    }
  }

  function drawChart(g, S, view, { isBig, rWorld, wc, inside }) {
    const night = nightOf(sunElevDeg()), pal = night > 0.5 ? PALETTES.night : PALETTES.day;
    const ink = lerp3(PALETTES.day.ink, PALETTES.night.ink, night), bg = lerp3(PALETTES.day.bg, PALETTES.night.bg, night);
    const I = (a) => rgba(ink, a * (1 - 0.18 * night));
    const amber = lerp3(TOKENS.amber, TOKENS.night.amber, night), A = (a) => rgba(amber, a);
    const chipBg = rgba(bg, CHART_CHIP);
    let destName = null;   // the enlarged chart: where the destination's name goes ({ x, y, al }), placed with the names
    const routeNames = [];   // and the route's named waypoints' ({ text, x, y, al })
    // text on a chip of the chart's ground (the glass's way: the text never leans on the water or the land behind it)
    const txt = (text, x, y, { align = 'center', fs = 13, a = CHART_TEXT_ALPHA.label, w = 500, col = null, it = false } = {}) => {
      g.font = `${it ? 'italic ' : ''}${w} ${fs}px ${UI}`; g.textAlign = align; g.textBaseline = 'middle';
      const tw = g.measureText(text).width, x0 = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2;
      g.fillStyle = chipBg; g.beginPath(); g.roundRect(x0 - 4, y - fs / 2 - 3, tw + 8, fs + 6, 5); g.fill();
      g.fillStyle = col ?? I(a); g.fillText(text, x, y + 0.5);
    };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, S, S);
    g.fillStyle = rgba(bg, 1); g.fillRect(0, 0, S, S);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'medium';
    drawBase(g, view, rWorld, wc, night);
    if (!bases.day && !bases.night) { g.font = `400 ${isBig ? 15 : 13}px ${UI}`; g.textAlign = 'center'; g.fillStyle = I(0.8); g.fillText('charting…', S / 2, S / 2 + 4); }
    g.lineJoin = 'round'; g.lineCap = 'round';
    const mpp = view.mPerPx, near = (x, z, pad = 0) => inside(x, z, pad);
    // the wind barbs: only while a route exists (owner decision 5), on the enlarged chart, under everything else
    if (isBig && route.length) drawBarbs(g, view, S, I);

    // the harbour and the piers: hairlines (the enlarged chart; the small one when close)
    if (mpp < 9.5 || isBig) {
      g.beginPath();
      for (const p of breakwaters) for (let i = 1; i < p.length; i++) if (near(p[i][0], p[i][1], 200)) seg(g, view, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
      g.strokeStyle = I(0.7); g.lineWidth = 1.6; g.stroke();
      g.beginPath();
      for (const d of [...docks, ...piers]) if (near(d[0], d[1], 100)) seg(g, view, d[0], d[1], d[2], d[3]);
      g.strokeStyle = I(0.42); g.lineWidth = 0.8; g.stroke();
    }
    // the marks in their real colours and shapes: mooring balls and the 5-mph line are yellow special marks (a sphere; the
    // line's with an X topmark), a hazard is an isolated-danger buoy (red over black, a diamond), the light a magenta flare
    const dot = Math.max(1.5, Math.min(2.4, 12 / mpp)), dim = 1 - 0.45 * night;
    const YEL = (a) => rgba([247 * dim, 205 * dim, 70 * dim], a), RED = (a) => rgba([232 * dim, 78 * dim, 64 * dim], a), MAG = (a) => rgba([226 * dim, 92 * dim, 190 * dim], a);
    for (const m of marks) {
      if (m.k !== 'ball' && m.k !== 'speed') continue;
      if (!near(m.x, m.z)) continue;
      view.toPx(m.x, m.z, P);
      g.beginPath(); g.arc(P[0], P[1], dot, 0, Math.PI * 2); g.fillStyle = YEL(0.95); g.fill(); g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 0.9; g.stroke();
      if (m.k === 'speed') { const r = dot * 0.55; g.beginPath(); g.moveTo(P[0] - r, P[1] - r); g.lineTo(P[0] + r, P[1] + r); g.moveTo(P[0] + r, P[1] - r); g.lineTo(P[0] - r, P[1] + r); g.strokeStyle = rgba(bg, 0.9); g.lineWidth = 0.8; g.stroke(); }
    }
    for (const m of marks) {
      if ((m.k !== 'hazard' && m.k !== 'light') || !near(m.x, m.z)) continue;
      view.toPx(m.x, m.z, P);
      if (m.k === 'hazard') {
        const r = isBig ? 3.8 : 3.4; g.beginPath(); g.moveTo(P[0], P[1] - r); g.lineTo(P[0] + r, P[1]); g.lineTo(P[0], P[1] + r); g.lineTo(P[0] - r, P[1]); g.closePath();
        g.fillStyle = RED(0.95); g.fill(); g.strokeStyle = rgba(bg, 0.9); g.lineWidth = 1; g.stroke();
        g.beginPath(); g.moveTo(P[0] - r * 0.5, P[1]); g.lineTo(P[0] + r * 0.5, P[1]); g.strokeStyle = rgba(bg, 0.9); g.lineWidth = 1.2; g.stroke();
      } else {   // a light: a dot and a magenta flare (a chart's light symbol), the flare toward the top of the chart
        g.beginPath(); g.arc(P[0], P[1], 1.8, 0, Math.PI * 2); g.fillStyle = MAG(1); g.fill();
        g.beginPath(); g.moveTo(P[0] + 1.2, P[1] - 1.2); g.quadraticCurveTo(P[0] + 6, P[1] - 4, P[0] + 7.5, P[1] - 9); g.quadraticCurveTo(P[0] + 3, P[1] - 7, P[0] + 1.2, P[1] - 1.2);
        g.fillStyle = MAG(0.75); g.fill();
      }
    }
    // the aids to navigation (v2's channel markers): the buoys in their chart symbols, the lit ones' flares; numbers close in
    if (mpp < AID_MARK.showMpp) {
      drawn[isBig ? 'aidsBig' : 'aidsSmall'] = drawAidMarks(g, view, aids(), { k: isBig ? 1.15 : 1, near, dim, bg, ink: I,
        label: isBig && mpp < AID_MARK.labelMpp ? (t, x, y, align) => txt(t, x, y, { align, fs: 12 }) : null });
    } else drawn[isBig ? 'aidsBig' : 'aidsSmall'] = [];
    // the anchorages (v2): a small anchor each in the chart's ink, on a chip of its ground (a chart's anchorage symbol)
    const anc = [];
    for (const a of anchorages() ?? []) {
      if (!near(a.x, a.z, 20)) continue;
      view.toPx(a.x, a.z, P);
      // a.lit (v2's anchorage cue): the boat is inside it; the glyph lifts (a size up, a fine amber ring round its chip)
      const gs = (isBig ? ANCHOR_GLYPH.big : ANCHOR_GLYPH.small) * (a.lit ? ANCHOR_GLYPH.lift : 1);
      drawAnchorGlyph(g, P[0], P[1], gs, I(0.92), rgba(bg, 0.82));
      if (a.lit) { g.setLineDash([]); g.beginPath(); g.arc(P[0], P[1], gs * 1.25 + 2.5, 0, Math.PI * 2); g.lineWidth = 1.2; g.strokeStyle = A(0.9); g.stroke(); }
      anc.push({ name: a.name, x: a.x, z: a.z, px: +P[0].toFixed(1), py: +P[1].toFixed(1), lit: !!a.lit });
    }
    drawn[isBig ? 'anchorsBig' : 'anchorsSmall'] = anc;
    // the birthplaces (v2): a compass-point mark each, on the enlarged chart; the lit one amber and named, one hovered, walked to or opened
    // lifted (a wider ring) and named
    if (isBig && pins) {
      const rows = [];
      for (const p of pins() ?? []) {
        if (!near(p.x, p.z, 10)) continue;
        view.toPx(p.x, p.z, P);
        const x = P[0], y = P[1], hot = p.id === hoverPin || p.id === selPin || p.id === focusPin;
        g.setLineDash([]); g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.82); g.fill();
        g.lineWidth = 1.4; g.strokeStyle = p.lit ? A(1) : I(0.95); g.beginPath(); g.arc(x, y, 5, 0, Math.PI * 2); g.stroke();
        g.beginPath(); for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { g.moveTo(x + dx * 5, y + dy * 5); g.lineTo(x + dx * 8.5, y + dy * 8.5); } g.lineWidth = 1.1; g.stroke();
        g.beginPath(); g.arc(x, y, 1.9, 0, Math.PI * 2); g.fillStyle = p.lit ? A(1) : I(0.95); g.fill();
        if (hot) { g.beginPath(); g.arc(x, y, 11.5, 0, Math.PI * 2); g.lineWidth = 1.2; g.strokeStyle = A(0.95); g.stroke(); }
        if (hot || p.lit) txt(p.name, x, y - 19, { fs: 12, it: true, a: hot ? 0.98 : 0.8, col: p.lit ? A(1) : null });
        rows.push({ id: p.id, name: p.name, lit: !!p.lit, px: +x.toFixed(1), py: +y.toFixed(1) });
      }
      pinRows = rows; drawn.pinsBig = rows;
    }
    // the racing marks (a practice course): orange marks, the start line between the committee boat and the pin, the legs dashed
    if (course?.laid) {
      const cm = course.marks(), byId = Object.fromEntries(cm.map((m) => [m.id, m])), seq = course.sequence, nxt = course.next;
      const ORG = (a) => rgba([255 * dim, 106 * dim, 26 * dim], a), YL2 = (a) => rgba([255 * dim, 208 * dim, 40 * dim], a);
      const cb = byId.committee, pn = byId.pin;
      if (cb && pn) { g.setLineDash([]); g.beginPath(); seg(g, view, cb.x, cb.z, pn.x, pn.z); g.strokeStyle = ORG(0.95); g.lineWidth = 1.6; g.stroke(); }
      if (cb && pn && seq.length) {
        g.setLineDash([5, 4]); g.beginPath();
        let a = { x: (cb.x + pn.x) / 2, z: (cb.z + pn.z) / 2 };
        for (const id of seq) { const b = byId[id]; if (!b) continue; seg(g, view, a.x, a.z, b.x, b.z); a = b; }
        seg(g, view, a.x, a.z, (cb.x + pn.x) / 2, (cb.z + pn.z) / 2);
        g.strokeStyle = I(0.55); g.lineWidth = 0.9; g.stroke(); g.setLineDash([]);
      }
      for (const m of cm) {
        if (!near(m.x, m.z, 30)) continue;
        view.toPx(m.x, m.z, P);
        const r = isBig ? 4.2 : 3.4;
        if (m.id === 'committee') { g.fillStyle = rgba([27 * (1 + (1 - dim)), 42 * (1 + (1 - dim)), 70 * (1 + (1 - dim))], 1); g.fillRect(P[0] - r, P[1] - r * 0.6, r * 2, r * 1.2); g.strokeStyle = I(0.95); g.lineWidth = 0.9; g.strokeRect(P[0] - r, P[1] - r * 0.6, r * 2, r * 1.2); }
        else if (m.id === 'pin') { g.beginPath(); g.moveTo(P[0], P[1] - r); g.lineTo(P[0] + r * 0.9, P[1] + r * 0.7); g.lineTo(P[0] - r * 0.9, P[1] + r * 0.7); g.closePath(); g.fillStyle = ORG(1); g.fill(); g.strokeStyle = rgba(bg, 0.9); g.lineWidth = 0.9; g.stroke(); }
        else {
          g.beginPath(); g.arc(P[0], P[1], r, 0, Math.PI * 2); g.fillStyle = m.type === 'cylinder' || m.type === 'tetra' ? YL2(1) : ORG(1); g.fill(); g.strokeStyle = rgba(bg, 0.9); g.lineWidth = 1; g.stroke();
          if (m.id === nxt) { g.beginPath(); g.arc(P[0], P[1], r + 3.6, 0, Math.PI * 2); g.strokeStyle = I(0.9); g.lineWidth = 1; g.stroke(); }
          if (isBig) txt({ windward: 'W', leeward: 'L', m1: '1', m2: '2', m3: '3' }[m.id] ?? '', P[0] + r + 8, P[1] - r - 2, { fs: 12 });
        }
      }
    }
    // the landmarks: tiny glyphs; the names on the enlarged chart
    for (const l of labels) {
      if (!near(l.x, l.z, 60) || l.id === 'light' || l.id === 'moorings' || l.id === 'narrows') continue;
      view.toPx(l.x, l.z, P);
      g.strokeStyle = I(0.7); g.lineWidth = 0.9; g.beginPath();
      if (l.id === 'house') { g.moveTo(P[0] - 2.6, P[1] + 2.2); g.lineTo(P[0] - 2.6, P[1] - 0.6); g.lineTo(P[0], P[1] - 3); g.lineTo(P[0] + 2.6, P[1] - 0.6); g.lineTo(P[0] + 2.6, P[1] + 2.2); g.closePath(); }
      else if (l.id === 'waterfall') { for (const o of [-2, 0, 2]) { g.moveTo(P[0] + o, P[1] - 3); g.quadraticCurveTo(P[0] + o + 1.2, P[1], P[0] + o, P[1] + 3); } }
      else if (l.id === 'harbour') { g.arc(P[0], P[1] - 2.2, 1.1, 0, Math.PI * 2); g.moveTo(P[0], P[1] - 1.1); g.lineTo(P[0], P[1] + 3); g.moveTo(P[0] - 2.6, P[1] + 1); g.quadraticCurveTo(P[0], P[1] + 4.4, P[0] + 2.6, P[1] + 1); }
      else if (l.id === 'island' || l.id === 'teahouse') { g.rect(P[0] - 1.3, P[1] - 1.3, 2.6, 2.6); }
      g.stroke();
    }
    // the named areas (v2: Tessie's water): the glyph upright on both charts; until the first visit a faint water ring widens
    // from it and fades, two at once (still: one quiet ring); its name goes with the names below
    const areaRows = [];
    for (const a of areas()) {
      const [w, h] = areaPx(a, isBig, mpp);
      if (!near(a.x, a.z, Math.max(w, h) * mpp)) continue;
      view.toPx(a.x, a.z, P);
      const cx = P[0], cy = P[1];
      if (a.ring) {
        const r0 = Math.max(w, h) * 0.5, r1 = Math.max(w, h) * (isBig ? 0.95 : 1.15), per = a.ringS ?? 4.2, a0 = a.ringA ?? 0.34;
        g.setLineDash([]); g.lineWidth = isBig ? 1.1 : 0.9;
        const phases = a.still ? [0.45] : [(t / per) % 1, (t / per + 0.5) % 1];
        for (const f of phases) {
          const k = a.still ? 0.6 : Math.sin(Math.PI * f) ** 1.5;   // in and out softly: never a blink
          g.beginPath(); g.ellipse(cx, cy, r0 + (r1 - r0) * f, (r0 + (r1 - r0) * f) * 0.62, 0, 0, Math.PI * 2);
          g.strokeStyle = I(a0 * k); g.stroke();
        }
      }
      const im = isBig && w >= (a.engraveFromPx ?? 28) ? a.glyph?.big : a.glyph?.small;
      const ok = !!im && (im.complete === undefined || (im.complete && (im.naturalWidth ?? 1) > 0));
      if (ok) g.drawImage(im, cx - w / 2, cy - h / 2, w, h);
      areaRows.push({ a, x: cx, y: cy, w, h, ring: !!a.ring, drew: ok });
    }
    drawn[isBig ? 'areasBig' : 'areasSmall'] = areaRows.map((r) => ({ id: r.a.id, x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: r.w, h: r.h, ring: r.ring, glyph: r.drew }));
    if (isBig) {
      // the names, decluttered: in priority order, each at the first of four spots (right, left, above, below) that
      // clears the boat, the glyphs and the names already placed; a name with no clear spot waits for a closer zoom
      const fs = Math.round(clamp(S / 38, 13, 16));
      g.font = `500 ${fs}px ${UI}`; g.textBaseline = 'middle';
      const boxes = [];
      // the sloop's glyph (1.25 × its 7.5 px half-length, any heading) and the destination's ring and cross (11 px arms)
      const s0 = boat(); if (s0) { view.toPx(s0.x, s0.z, P); boxes.push([P[0] - 12, P[1] - 12, P[0] + 12, P[1] + 12]); }
      const destOn = dest && near(dest.x, dest.z, 60);
      if (destOn) { view.toPx(dest.x, dest.z, P); boxes.push([P[0] - 13, P[1] - 13, P[0] + 13, P[1] + 13]); }
      for (let i = routeFrom(); i < route.length; i++) if (near(route[i].x, route[i].z, 60)) { const q = routeAt(i); view.toPx(q.x, q.z, P); boxes.push([P[0] - 11, P[1] - 11, P[0] + 11, P[1] + 11]); }
      for (const l of labels) if (near(l.x, l.z)) { view.toPx(l.x, l.z, P); boxes.push([P[0] - 4, P[1] - 4, P[0] + 4, P[1] + 4]); }
      for (const r of areaRows) boxes.push([r.x - r.w / 2, r.y - r.h / 2, r.x + r.w / 2, r.y + r.h / 2]);
      const hit = (b) => boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
      // the first of the spots [dx, dy, align] that stays on the chart and clears every box so far: { x, y, al } (its box
      // taken), or null
      const spot = (text, x, y, spots) => {
        const w = g.measureText(text).width;
        for (const [dx, dy, al] of spots) {
          const x0 = al === 'left' ? x + dx : al === 'right' ? x + dx - w : x - w / 2, b = [x0 - 5, y + dy - fs / 2 - 4, x0 + w + 5, y + dy + fs / 2 + 4];
          if (b[0] < 4 || b[2] > S - 4 || b[1] < 4 || b[3] > S - 4 || hit(b)) continue;
          boxes.push(b);
          return { x: x + dx, y: y + dy, al };
        }
        return null;
      };
      const put = (text, x, y, a) => {
        const at = spot(text, x, y, [[8, 0, 'left'], [-8, 0, 'right'], [0, -fs - 4, 'center'], [0, fs + 4, 'center']]);
        if (!at) return false;
        txt(text, at.x, at.y, { align: at.al, fs, a });
        g.font = `500 ${fs}px ${UI}`;
        return true;
      };
      // the destination's name first (it outranks the landmarks): a chart's way, set off its mark clear of the cross and
      // the sloop, right, left, then the four corners, then above and below; drawn with the mark below
      if (destOn && dest.name) {
        view.toPx(dest.x, dest.z, P);
        const o = 17, d = 15, v = fs / 2 + 13;
        destName = spot(dest.name, P[0], P[1], [[o, 0, 'left'], [-o, 0, 'right'], [d, -v, 'left'], [-d, -v, 'right'], [d, v, 'left'], [-d, v, 'right'], [0, -v - 4, 'center'], [0, v + 4, 'center']]);
      }
      // a named waypoint's name (the destination of a route), placed the same way, before the landmarks' names
      for (let i = routeFrom(); i < route.length; i++) {
        const q = routeAt(i);
        if (!q.name || !near(q.x, q.z, 60) || areaRows.some((r) => r.a.name === q.name)) continue;   // an area's waypoint: its name is under its glyph already
        view.toPx(q.x, q.z, P);
        const at = spot(q.name, P[0], P[1], [[15, 0, 'left'], [-15, 0, 'right'], [0, -fs - 8, 'center'], [0, fs + 8, 'center']]);
        if (at) routeNames.push({ text: q.name, ...at });
      }
      // an area's name: italic, the chart's own label font, under its glyph (else above, right, left)
      for (const r of areaRows) {
        const fsA = fs;   // the place names' size
        g.font = `italic 500 ${fsA}px ${UI}`;
        const at = spot(r.a.name, r.x, r.y, [[0, r.h / 2 + fsA / 2 + 6, 'center'], [0, -r.h / 2 - fsA / 2 - 6, 'center'], [r.w / 2 + 6, 0, 'left'], [-r.w / 2 - 6, 0, 'right']]);
        if (at) txt(r.a.name, at.x, at.y, { align: at.al, fs: fsA, a: CHART_TEXT_ALPHA.label, it: true });
        g.font = `500 ${fs}px ${UI}`;
      }
      for (const id of ['teahouse', 'island', 'harbour', 'narrows', 'light', 'house', 'waterfall', 'moorings']) {
        const l = labels.find((q) => q.id === id);
        if (l && near(l.x, l.z, -20)) { view.toPx(l.x, l.z, P); put(l.name, P[0], P[1], CHART_TEXT_ALPHA.label); }
      }
      if (shoal && near(shoal.x, shoal.z)) { view.toPx(shoal.x, shoal.z, P); put(`shoal ${shoal.d.toFixed(1)} m`, P[0], P[1], CHART_TEXT_ALPHA.label); }
    }

    // today's track: a hairline, brighter where the boat was fast (the logbook's line)
    const tr = track();
    if (tr && tr.length > 1) {
      g.lineWidth = isBig ? 1.3 : 1.1;
      for (const pass of [0, 1]) {
        g.beginPath();
        let open = false;
        for (let i = 1; i < tr.length; i++) {
          const fast = (tr[i].v ?? 0) > 2.4;
          if ((pass === 1) !== fast) { open = false; continue; }
          if (!open) { view.toPx(tr[i - 1].x, tr[i - 1].z, P); g.moveTo(P[0], P[1]); open = true; }
          view.toPx(tr[i].x, tr[i].z, P); g.lineTo(P[0], P[1]);
        }
        g.strokeStyle = I(pass ? 0.62 : 0.36); g.stroke();
      }
    }

    // pro: the waypoint, the line to it, the laylines
    const s = boat();
    const tw = s?.trueWind, windFrom = s && tw ? s.heading + tw.angle : null, twsKn = tw ? toKn(tw.speed) : 0;
    let plan = null;
    // with a route, the pro line's VMG reads its active waypoint (the route draws its own laylines)
    if (isPro && !waypoint && route.length && s && windFrom != null) plan = laylinePlan(s, route[routeFrom()], windFrom, twsKn);
    if (isPro && waypoint && s && windFrom != null) {
      plan = laylinePlan(s, waypoint, windFrom, twsKn);
      g.setLineDash([]); g.beginPath();
      seg(g, view, ...plan.rays[0]); g.strokeStyle = I(0.6); g.lineWidth = 1; g.stroke();
      g.setLineDash([4, 3]); g.beginPath(); seg(g, view, ...plan.rays[1]); g.stroke();
      g.setLineDash([1.5, 3.5]); g.beginPath(); seg(g, view, s.x, s.z, waypoint.x, waypoint.z); g.strokeStyle = I(0.5); g.lineWidth = 1; g.stroke();
      g.setLineDash([]);
      view.toPx(waypoint.x, waypoint.z, P);
      g.beginPath(); g.arc(P[0], P[1], 5, 0, Math.PI * 2); g.moveTo(P[0] - 8, P[1]); g.lineTo(P[0] + 8, P[1]); g.moveTo(P[0], P[1] - 8); g.lineTo(P[0], P[1] + 8);
      g.strokeStyle = I(0.92); g.lineWidth = 1.1; g.stroke();
    }

    // Cruise's chosen mark: a dashed line from the boat, a ring with a cross, its name beside it
    if (dest && s) {
      g.setLineDash([2, 4]); g.beginPath(); seg(g, view, s.x, s.z, dest.x, dest.z); g.strokeStyle = A(0.8); g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      if (near(dest.x, dest.z, 60)) {
        view.toPx(dest.x, dest.z, P);
        g.beginPath(); g.arc(P[0], P[1], isBig ? 7 : 5, 0, Math.PI * 2); g.moveTo(P[0] - 11, P[1]); g.lineTo(P[0] + 11, P[1]); g.moveTo(P[0], P[1] - 11); g.lineTo(P[0], P[1] + 11);
        g.strokeStyle = A(0.95); g.lineWidth = 1.6; g.stroke();
        if (isBig && destName) txt(dest.name, destName.x, destName.y, { align: destName.al, fs: Math.round(clamp(S / 38, 13, 16)), a: 0.95 });
        // the small round chart: the short label beside the mark, at the first of right, left, above, below that stays
        // inside the circle and clear of the top and bottom scrims (HDG, SOG, DPT); none fits: the mark alone
        if (!isBig && dest.label && S >= 110) {
          const fs = Math.round(clamp(S / 18, 12, 14));
          g.font = `500 ${fs}px ${UI}`;
          const w = g.measureText(dest.label).width, R = S / 2 - 6;
          for (const [dx, dy, al] of [[14, 0, 'left'], [-14, 0, 'right'], [0, -fs - 6, 'center'], [0, fs + 6, 'center']]) {
            const x0 = al === 'left' ? P[0] + dx : al === 'right' ? P[0] + dx - w : P[0] - w / 2, y = P[1] + dy;
            const b = [x0 - 4, y - fs / 2 - 3, x0 + w + 4, y + fs / 2 + 3];
            if (b[1] < S * 0.22 || b[3] > S * 0.7) continue;
            if ([[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].some(([cx, cy]) => Math.hypot(cx - S / 2, cy - S / 2) > R)) continue;
            txt(dest.label, P[0] + dx, y, { align: al, fs, a: 0.95 });
            break;
          }
        }
      }
    }

    // Sail's own mark (v2's double-tap mark, no course): a dotted amber line from the boat, an amber ring and its centre dot
    const sm = !dest && s ? mark() : null;
    if (sm) {
      g.setLineDash([2, 4]); g.beginPath(); seg(g, view, s.x, s.z, sm.x, sm.z); g.strokeStyle = A(0.8); g.lineWidth = 1.2; g.stroke(); g.setLineDash([]);
      if (near(sm.x, sm.z, 60)) {
        view.toPx(sm.x, sm.z, P);
        g.beginPath(); g.arc(P[0], P[1], isBig ? 8 : 6, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.6); g.fill(); g.strokeStyle = A(0.95); g.lineWidth = 1.8; g.stroke();
        g.beginPath(); g.arc(P[0], P[1], 2, 0, Math.PI * 2); g.fillStyle = A(0.95); g.fill();
      }
      drawn.mark = { x: sm.x, z: sm.z, big: isBig };
    } else drawn.mark = null;

    // the passage plan's route, in the chart's own ink, only while one exists
    if (route.length && s) drawRoute(g, view, { isBig, S, s, I, A, bg, windFrom, twsKn, near, txt, routeNames, night });

    // the kayakers (feat/kayak-first-minute): a small paddle mark in the chart's own ink, a short hull stroke
    // along the heading and the double paddle across it, its two blades; no ring, no vector, no pulse: quiet, not a blip
    drawKayakMarks(g, view, kayaks(), { k: isBig ? 1.25 : 1, ink: I, near });

    // the AIS targets: a hollow triangle along the heading and a one-minute vector; the paddlewheeler filled
    for (const a of targets()) {
      if (!near(a.x, a.z, 40)) continue;
      view.toPx(a.x, a.z, P);
      const [ux, uy] = view.dirPx(a.heading ?? 0), px = -uy, py = ux, big2 = a.kind === 'paddlewheeler', r = big2 ? 6 : 4.6;
      g.beginPath(); g.moveTo(P[0] + ux * r * 1.3, P[1] + uy * r * 1.3); g.lineTo(P[0] - ux * r * 0.8 + px * r * 0.75, P[1] - uy * r * 0.8 + py * r * 0.75);
      g.lineTo(P[0] - ux * r * 0.8 - px * r * 0.75, P[1] - uy * r * 0.8 - py * r * 0.75); g.closePath();
      if (big2) { g.fillStyle = I(0.5); g.fill(); }
      g.strokeStyle = I(0.82); g.lineWidth = 0.9; g.stroke();
      const v = (a.speed ?? 0) * 60 / mpp;
      if (v > 2) { g.beginPath(); g.moveTo(P[0] + ux * r * 1.3, P[1] + uy * r * 1.3); g.lineTo(P[0] + ux * (r * 1.3 + v), P[1] + uy * (r * 1.3 + v)); g.strokeStyle = I(0.5); g.stroke(); }
    }

    // own ship: the heading line to the rim, the one-minute course-over-ground vector with its end ticks, the sloop in
    // binnacle amber on a dark under-stroke
    if (s) {
      view.toPx(s.x, s.z, P);
      const [hx, hy] = view.dirPx(s.heading), [cx, cy] = view.dirPx(s.cog ?? s.heading);
      g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(P[0] + hx * S * 1.2, P[1] + hy * S * 1.2); g.strokeStyle = I(0.5); g.lineWidth = 1; g.stroke();
      const v = (s.sog ?? 0) * 60 / mpp;
      if (v > 3) {
        g.beginPath(); g.moveTo(P[0], P[1]); g.lineTo(P[0] + cx * v, P[1] + cy * v);
        g.strokeStyle = rgba(bg, 0.8); g.lineWidth = 3.6; g.stroke(); g.strokeStyle = A(0.95); g.lineWidth = 1.6; g.stroke();
        const px2 = -cy, py2 = cx;
        g.beginPath(); g.moveTo(P[0] + cx * v + px2 * 3.4, P[1] + cy * v + py2 * 3.4); g.lineTo(P[0] + cx * v - px2 * 3.4, P[1] + cy * v - py2 * 3.4); g.stroke();
      }
      g.save(); g.translate(P[0], P[1]); g.rotate(Math.atan2(hx, -hy));
      const k = isBig ? 1.25 : 1.1;
      g.beginPath(); g.moveTo(0, -7.5 * k); g.bezierCurveTo(3.6 * k, -3.5 * k, 3.4 * k, 3 * k, 2.4 * k, 5.5 * k); g.lineTo(-2.4 * k, 5.5 * k); g.bezierCurveTo(-3.4 * k, 3 * k, -3.6 * k, -3.5 * k, 0, -7.5 * k); g.closePath();
      g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 3.8; g.stroke();
      g.fillStyle = A(0.3); g.fill(); g.strokeStyle = A(1); g.lineWidth = 1.7; g.stroke();
      g.restore();
    }

    // the bezel: a compass card on the small chart (10° ticks, N E S W, the lubber mark), north's arrow and the scale in nm on the big one
    const R = S / 2, bandW = 18;
    if (!isBig) {
      g.save(); g.beginPath(); g.arc(R, R, R, 0, Math.PI * 2); g.arc(R, R, R - bandW, 0, Math.PI * 2, true); g.fillStyle = chipBg; g.fill(); g.restore();
      g.beginPath(); g.arc(R, R, R - bandW, 0, Math.PI * 2); g.strokeStyle = I(0.45); g.lineWidth = 1; g.stroke();
      g.beginPath();
      for (let i = 0; i < 36; i++) { if (i % 9 === 0) continue; const [ux, uy] = view.dirPx(i * 10 * DEG), r0 = R - (i % 3 ? 5.5 : 9); g.moveTo(R + ux * (R - 2), R + uy * (R - 2)); g.lineTo(R + ux * r0, R + uy * r0); }
      g.strokeStyle = I(0.85); g.lineWidth = 1.2; g.stroke();
      const fsC = Math.round(clamp(S / 16, 12, 15));
      g.font = `500 ${fsC}px ${UI}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (const [d, c] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
        const [ux, uy] = view.dirPx(d * DEG); g.fillStyle = d === 0 ? I(CHART_TEXT_ALPHA.north) : I(CHART_TEXT_ALPHA.label); g.fillText(c, R + ux * (R - bandW / 2 - 0.5), R + uy * (R - bandW / 2 - 0.5) + 0.5);
      }
      // the lubber mark: the bow's own, fixed at the top of the card
      g.beginPath(); g.moveTo(R, bandW + 1); g.lineTo(R - 5, bandW + 10); g.lineTo(R + 5, bandW + 10); g.closePath();
      g.fillStyle = A(1); g.fill(); g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 1; g.stroke();
      // a range ring at a quarter of a nautical mile about the boat
      if (s) {
        view.toPx(s.x, s.z, P);
        const RR = NM / 4 / mpp;
        g.beginPath(); g.arc(P[0], P[1], RR, 0, Math.PI * 2); g.setLineDash([2, 4]); g.strokeStyle = I(0.5); g.lineWidth = 1; g.stroke(); g.setLineDash([]);
        const [nx] = view.dirPx(0), left = nx > 0;
        if (isBig || S >= 150) txt('¼ nm', P[0] + (left ? -1 : 1) * (RR + 6), P[1], { align: left ? 'right' : 'left', fs: 12, a: CHART_TEXT_ALPHA.scale });   // an upright phone's 110 px circle: the ring alone (its words clipped at the rim)
      }
      // the mini map (?dials=v2): the shore and the shallows as amber arcs on the compass band, the birthplaces, the nearest point of interest
      if (s && shoreWarn) {
        const reach = 240, step = 30, lim = -(PLOT.draft + 0.6);
        for (let i = 0; i < 24; i++) {
          const b = i * 15 * DEG, sx = Math.sin(b), sz = -Math.cos(b);
          let hit = 0;
          for (let d = step; d <= reach; d += step) { if (gridOrTerrain(s.x + sx * d, s.z + sz * d) > lim) { hit = d; break; } }
          if (!hit) continue;
          const [ux, uy] = view.dirPx(b), a0 = Math.atan2(uy, ux) - 6.5 * DEG, a1 = a0 + 13 * DEG;
          g.beginPath(); g.arc(R, R, R - bandW / 2, a0, a1); g.lineWidth = bandW - 6; g.lineCap = 'butt';
          g.strokeStyle = A(0.35 + 0.6 * (1 - hit / reach)); g.stroke(); g.lineCap = 'round';
        }
      }
      if (pins) for (const p of pins() ?? []) {
        if (!near(p.x, p.z, -40)) continue;
        view.toPx(p.x, p.z, P); const x = P[0], y = P[1];
        g.setLineDash([]); g.beginPath(); g.arc(x, y, 5.5, 0, Math.PI * 2); g.fillStyle = rgba(bg, 0.82); g.fill();
        g.lineWidth = 1.2; g.strokeStyle = I(0.95); g.beginPath(); g.arc(x, y, 3.8, 0, Math.PI * 2); g.stroke();
        g.beginPath(); for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) { g.moveTo(x + dx * 3.8, y + dy * 3.8); g.lineTo(x + dx * 6.5, y + dy * 6.5); } g.stroke();
      }
      const pq = s && poi ? poi() : null;
      if (pq) {
        view.toPx(s.x, s.z, P); const x0 = P[0], y0 = P[1];
        const [ux, uy] = view.dirPx(pq.brgDeg * DEG), rin = R - bandW - 4;
        view.toPx(pq.x, pq.z, P);
        let x1 = P[0], y1 = P[1];
        const inCard = Math.hypot(x1 - R, y1 - R) < rin - 6;
        if (!inCard) {   // off the card: the line runs to the band, a chevron points on
          const ox = x0 - R, oy = y0 - R, b2 = ox * ux + oy * uy, c = ox * ox + oy * oy - rin * rin, t = -b2 + Math.sqrt(Math.max(0, b2 * b2 - c));
          x1 = x0 + ux * t; y1 = y0 + uy * t;
        }
        g.setLineDash([3, 4]); g.beginPath(); g.moveTo(x0 + ux * 9, y0 + uy * 9); g.lineTo(x1 - ux * (inCard ? 8 : 0), y1 - uy * (inCard ? 8 : 0));
        g.strokeStyle = rgba(bg, 0.8); g.lineWidth = 3.4; g.stroke(); g.strokeStyle = I(0.95); g.lineWidth = 1.5; g.stroke(); g.setLineDash([]);
        if (!inCard) {
          const px = -uy, py = ux, hx = x1 + ux * 1, hy = y1 + uy * 1;
          g.beginPath(); g.moveTo(hx - ux * 7 + px * 5, hy - uy * 7 + py * 5); g.lineTo(hx, hy); g.lineTo(hx - ux * 7 - px * 5, hy - uy * 7 - py * 5);
          g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 3.6; g.stroke(); g.strokeStyle = I(0.98); g.lineWidth = 1.7; g.stroke();
        } else if (pq.kind === 'anchorage') drawAnchorGlyph(g, x1, y1, ANCHOR_GLYPH.small * 1.15, I(0.95), rgba(bg, 0.82));
        if (pq.name && S >= 150) {
          const fs = 12, lx = clamp(x1 - ux * (inCard ? 0 : 10) + (inCard ? 0 : 0), 40, S - 40), ly = clamp(y1 - uy * (inCard ? -14 : 12), 30, S * 0.62);
          txt(pq.name, lx, ly, { fs, it: true, a: 0.95 });
        }
      }
    } else {
      // north-up: a north arrow top-right; the scale bar bottom-right, in nautical miles
      g.beginPath(); g.moveTo(S - 22, 38); g.lineTo(S - 22, 12); g.moveTo(S - 27, 20); g.lineTo(S - 22, 12); g.lineTo(S - 17, 20); g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 3.6; g.stroke(); g.strokeStyle = I(0.95); g.lineWidth = 1.6; g.stroke();
      txt('N', S - 22, 50, { fs: 14, a: CHART_TEXT_ALPHA.north });
      const rz = bigRs[zoom], nm = rz > 12000 ? 5 : rz > 6000 ? 2 : rz > 3000 ? 1 : rz > 1500 ? 0.5 : 0.25, bar = nm * NM / mpp;
      g.beginPath(); g.moveTo(S - 18 - bar, S - 18); g.lineTo(S - 18, S - 18); g.moveTo(S - 18 - bar, S - 24); g.lineTo(S - 18 - bar, S - 18); g.moveTo(S - 18, S - 24); g.lineTo(S - 18, S - 18);
      g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 3.6; g.stroke(); g.strokeStyle = I(0.95); g.lineWidth = 1.6; g.stroke();
      txt(`${nm === 0.25 ? '¼' : nm === 0.5 ? '½' : nm} nm`, S - 18, S - 38, { align: 'right', fs: 13, a: CHART_TEXT_ALPHA.scale });
    }
    // the true wind: an arrow just inside the card from the side it comes from, pointing in, and TWS in kn on a chip
    if (windFrom != null) {
      const [ux, uy] = view.dirPx(windFrom), rr = isBig ? 0 : R - bandW - 8;
      const ax = isBig ? 44 : R + ux * rr, ay = isBig ? 44 : R + uy * rr, L2 = isBig ? 22 : S * 0.1;
      const bx = isBig ? ax - ux * L2 / 2 : ax, by = isBig ? ay - uy * L2 / 2 : ay;   // the enlarged chart's arrow sits in its own corner
      const hx = bx - ux * L2, hy = by - uy * L2, px = -uy, py = ux;
      g.beginPath(); g.moveTo(bx, by); g.lineTo(hx, hy); g.moveTo(hx + ux * 4.5 + px * 3.2, hy + uy * 4.5 + py * 3.2); g.lineTo(hx, hy); g.lineTo(hx + ux * 4.5 - px * 3.2, hy + uy * 4.5 - py * 3.2);
      g.strokeStyle = rgba(bg, 0.85); g.lineWidth = 4; g.stroke(); g.strokeStyle = I(0.98); g.lineWidth = 1.8; g.stroke();
      const kn = `TWS ${Math.round(twsKn)} kn`, fsz = Math.round(clamp(S / (isBig ? 38 : 17), 12, 15));
      g.font = `500 ${fsz}px ${UI}`;
      const kw = g.measureText(kn).width + 8, off = 9 + Math.abs(ux) * kw / 2 + Math.abs(uy) * (fsz + 6) / 2;
      if (isBig || (S >= 150 && !poi)) txt(kn, isBig ? ax + 20 : hx - ux * off, isBig ? ay : hy - uy * off, { align: isBig ? 'left' : 'center', fs: fsz, a: CHART_TEXT_ALPHA.depth, w: 500 });
    }
    // pro: the numbers a racing plotter shows, one quiet line at the foot
    if (isPro && s) {
      const line = proLine({ vmgKn: plan ? toKn(vmgTo(s, waypoint ?? route[routeFrom()])) : null, underM: -gridOrTerrain(s.x, s.z) - PLOT.draft, trend: trend()?.kind, plan, big: isBig });
      const fx = isBig ? 18 : R, fy = isBig ? S - 22 : S - (S * 0.13);
      txt(line, fx, fy, { align: isBig ? 'left' : 'center', fs: Math.round(clamp(S / (isBig ? 42 : 18), 12, 14)), a: CHART_TEXT_ALPHA.depth });
    }
    return plan;
  }
  const gridOrTerrain = (x, z) => (grid.rows >= grid.h && x >= B.x0 && x <= B.x1 && z >= B.z0 && z <= B.z1 ? gridHeight(grid, x, z) : terrain.heightAt(x, z));   // past the bay's grid (the open lake): the terrain

  let plan = null;
  function redraw(st) {
    const s = boat();
    layout();
    const t0 = performance.now();
    if (st.shown && !st.big && s) {
      // the readout plate under the dial: HDG in °T, SOG in kn, DPT in m (the chart's own depth under the boat)
      const hd = String(Math.round(((s.heading * 180 / Math.PI) % 360 + 360) % 360) % 360).padStart(3, '0'), sg = toKn(s.sog ?? 0).toFixed(1), dpv = Math.max(0, s.depthM ?? -gridOrTerrain(s.x, s.z)), dp = dpv < 10 ? dpv.toFixed(1) : String(Math.round(dpv)), al = s.sounderLevel | 0;   // a sounder reads a tenth of a metre in the shallows
      if (hdgEl.textContent !== hd) hdgEl.textContent = hd; if (sogEl && sogEl.textContent !== sg) sogEl.textContent = sg;
      if (poiRow) { const pq = poi?.(); poiRow.style.visibility = pq ? '' : 'hidden'; if (pq) { if (poiK.textContent !== pq.label) poiK.textContent = pq.label; const dt2 = pq.dText, bt = pq.bText ?? ''; if (poiD.textContent !== dt2) poiD.textContent = dt2; if (poiB.textContent !== bt) poiB.textContent = bt; } } if (depEl.textContent !== dp) depEl.textContent = dp;
      const rwS = depEl.closest('.rw'); if (rwS && (rwS.dataset.alarm ?? '') !== (al ? String(al) : '')) { if (al) rwS.dataset.alarm = String(al); else delete rwS.dataset.alarm; }
      const S = sS, mpp = PLOT.smallR / (S / 2);
      const view = makeView({ cx: s.x, cz: s.z, mPerPx: mpp, rot: s.heading, ox: S / 2, oy: S * PLOT.boatAt });
      const wc = view.toWorld(S / 2, S / 2);
      const inside = (x, z, pad = 0) => Math.hypot(x - wc[0], z - wc[1]) < PLOT.smallR + pad;
      const g = cvS.getContext('2d');
      g.save(); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.beginPath(); g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); g.clip();
      plan = drawChart(g, S, view, { isBig: false, rWorld: PLOT.smallR, wc, inside }) ?? plan;
      g.restore();
    }
    if (st.big && s) {
      const S = sB, rw = bigRs[zoom], mpp = rw / (S / 2);
      // the lake's zooms keep the view on the lake's box (the widest one: the whole lake); the bay's centre on the boat
      const keep = (v, a, b) => (b - a <= 2 * rw ? (a + b) / 2 : clamp(v, a + rw, b - rw));
      const lk = far && zoom >= PLOT.bigR.length, cx = lk ? keep(s.x, far.keep.x0, far.keep.x1) : s.x, cz = lk ? keep(s.z, far.keep.z0, far.keep.z1) : s.z;
      const view = makeView({ cx, cz, mPerPx: mpp, rot: 0, ox: S / 2, oy: S / 2 });
      lastBig = view;
      const inside = (x, z, pad = 0) => Math.abs(x - cx) < rw + pad && Math.abs(z - cz) < rw + pad;
      plan = drawChart(cvB.getContext('2d'), S, view, { isBig: true, rWorld: rw, wc: [cx, cz], inside });
    }
    const ms = performance.now() - t0;
    stats.redraws++; stats.drawMs.push(ms); if (stats.drawMs.length > 300) stats.drawMs.shift(); stats.maxDrawMs = Math.max(stats.maxDrawMs, ms);
  }

  let shownS = false, shownB = false;
  function update(dt = 1 / 60) {
    if (disposed) return;
    const u0 = performance.now();
    t += dt; since += dt;
    pollPad();
    const st0 = tog.update(now()), hide = hidden();
    const st = { shown: st0.shown && !hide, big: st0.big && !hide };
    if (t > startAfterS || st.shown || st.big) build('day');
    if (bases.day && nightOf(sunElevDeg()) > 0.02) build('night');
    if (far && bases.day) { build('day', far); if (bases.night && far.bases.day && nightOf(sunElevDeg()) > 0.02) build('night', far); }
    const wantS = st.shown && !st.big, wantB = st.big;
    if (wantS !== shownS) { small.classList.toggle('in', wantS); readEl.classList.toggle('in', wantS); shownS = wantS; dirty = true; }
    if (wantB !== shownB) { big.classList.toggle('in', wantB); shownB = wantB; dirty = true; if (pins) { big.tabIndex = wantB ? 0 : -1; if (!wantB) { closePinCard(); hoverPin = null; focusPin = null; } } }
    if (st0.shown) el.dataset.shown = ''; else delete el.dataset.shown;
    if (toolsEl && wantB) syncTools();
    if ((wantS || wantB) && (dirty || since >= 1 / PLOT.hz)) { since = 0; dirty = false; redraw(st); placeCard(); }
    const ms = performance.now() - u0;
    stats.updateMs.push(ms); if (stats.updateMs.length > 600) stats.updateMs.shift();
  }

  function dispose() {
    disposed = true;
    removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', onBlur);
    removeEventListener('pointerdown', onDocDown); removeEventListener('resize', onResize); removeEventListener('gamepadconnected', onPad);
    removeEventListener('pointermove', onPlanMove); removeEventListener('pointerup', onPlanUp); removeEventListener('pointercancel', onPlanUp);
    removeEventListener('pointermove', onPinchMove); removeEventListener('pointerup', onPinchUp); removeEventListener('pointercancel', onPinchUp);
    el.remove();
  }
  const pct = (a, p) => { if (!a.length) return 0; const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(p * b.length))]; };
  return {
    update, dispose, setPro, setWaypoint, setDestination, setRoute, el, toggle: tog,
    get route() { return route.map((p) => ({ ...p })); }, get routeActive() { return routeActive; },
    // the enlarged chart's pixel (page coordinates) for a world point, or null when it is not up (probes, tests)
    toClient(x, z) { if (!lastBig || !big.classList.contains('in')) return null; const r = cvB.getBoundingClientRect(), q = lastBig.toPx(x, z); return { x: r.left + q[0], y: r.top + q[1] }; },
    get state() { return { ...tog.state, hidden: hidden(), pro: isPro, waypoint, dest, zoom, route: route.length ? route.map((p) => ({ ...p })) : null, routeActive, zooms: bigRs.length, rangeM: bigRs[zoom], mark: drawn.mark ?? null, areas: { big: drawn.areasBig ?? [], small: drawn.areasSmall ?? [] }, anchorages: { big: drawn.anchorsBig ?? [], small: drawn.anchorsSmall ?? [] }, pins: drawn.pinsBig ?? [], pinCard: selPin, aids: { big: drawn.aidsBig ?? [], small: drawn.aidsSmall ?? [] }, ready: { day: !!bases.day, night: !!bases.night, lake: far ? !!far.bases.day : null } }; },
    // the enlarged chart's zoom step (0 nearest; probes and tests: the wheel and the pinch step it)
    setZoom(z) { zoom = clamp(z | 0, 0, bigRs.length - 1); dirty = true; return zoom; },
    get plan() { return plan; }, get pro() { return isPro; },
    stats: () => ({ redraws: stats.redraws, drawMsMean: +(stats.drawMs.reduce((a, b) => a + b, 0) / Math.max(1, stats.drawMs.length)).toFixed(3),
      drawMsP95: +pct(stats.drawMs, 0.95).toFixed(3), drawMsMax: +stats.maxDrawMs.toFixed(3),
      updateMsMean: +(stats.updateMs.reduce((a, b) => a + b, 0) / Math.max(1, stats.updateMs.length)).toFixed(4), updateMsP99: +pct(stats.updateMs, 0.99).toFixed(3),
      build: Object.fromEntries(Object.entries(buildMs).map(([k, v]) => [k, +v.toFixed(2)])), base: [BW, BH], grid: [grid.w, grid.h],
      lake: far ? { build: Object.fromEntries(Object.entries(far.ms).map(([k, v]) => [k, +v.toFixed(2)])), base: [far.BW, far.BH], grid: [far.grid.w, far.grid.h] } : null,
      contourSegs: Object.fromEntries([0, ...PLOT.contours].map((d) => [d, (contours[d]?.length ?? 0) / 4])), route: route.length ? { ...drawn } : null }),
  };
}
