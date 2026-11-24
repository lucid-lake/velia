// The boat from above, as a wind instrument (the owner's "captain's view", second round, 2026-10-29;
// v2 2026-10-29: the classic analog wind display): a round glass dial, bottom-right, with the red (port)
// and green (starboard) close-hauled sectors near the bow, the apparent-wind needle, the plan-view boat at the centre,
// and under it a small plate reading AWA and AWS in a yacht's labels and units. When you press a key you see what
// changed on the boat and why it matters: the apparent wind arrow (what the sails feel), the main and the jib as lines
// that swing in and out with W/S and show their state by shape (a belly when drawing, a flutter when luffing, a hard
// straight line when stalled), the rudder at the stern, and the no-go wedge about the true wind when you point too
// high. Plain SVG in the DOM: no camera, no GPU.
//
//   const cv = createCaptainView({ state: () => phys.state });   // state(): the boat state (contract.js + crewSheet, mainStall, jibStall)
//   cv.update(dt, { sinceUse })   // each frame; shows on use, fades `hold` s after; rests faint in a first session
//                                 // cue: 'sails' (the sails pulse: the trim lines) | 'wedge' (the no-go wedge: the tack line) | null
//   cv.toggle()                   // auto → pinned → off → auto
//   cv.drag                       // the mouse's hand on it: null, { kind: 'sheet', sheet } or { kind: 'rudder', steer }
//   cv.dispose();
//
// A control surface too (owner, 2026-10-29: mouse friendly, touch-ready): drag the sail line in or out to trim (the
// sheet's target, which controls.js feeds to the same hand on the sheet as W/S, at the winch's rate), drag the rudder
// to steer. Only the two lines take the pointer, each through a wide invisible stroke (CAPTAIN.hitPx) laid over its
// hairline; the rest of the glyph lets clicks through to the water. Hovering or dragging wakes the glyph as a key does.
import { ensureTokens, TOKENS } from './tokens.js';
export const KN = 1.943844;   // m/s → kn

export const CAPTAIN = {
  size: 'calc(min(clamp(140px, 30.6vh, 340px), 40vw) * var(--lk-dm))',   // the dial's width and height (the --lk-d token, the same as the chart's, the chart's original size; tests/design.test.mjs keeps them equal)
  hold: 4, fadeIn: 0.25, fadeOut: 0.9, // s
  on: TOKENS.ink, rest: TOKENS.rest,   // the ink's alpha in use (the ink token, 0.94); at rest in a first session (the rest token, 0.70; 0 after it)
  restFor: 180,                        // s of a first session the glyph rests faint
  wedgeDeg: 42,                        // the no-go wedge's half-angle about the true wind
  sectorDeg: [22, 46],                 // the red and green close-hauled sectors, degrees off the bow
  awsFull: 10,                         // m/s of apparent wind for the longest arrow
  hitPx: 18,                           // px, the width of the invisible stroke that takes the pointer over a line
};

// Every value is a token (src/ui/tokens.css), but the glyph's own geometry (CAPTAIN.size) and its stroke weights.
const CSS = `
.lk-cv{position:fixed;right:var(--lk-mx);bottom:var(--lk-by);z-index:var(--lk-z-hud);pointer-events:none;user-select:none;
  --cv-ink:${CAPTAIN.on};font:var(--lk-regular) var(--lk-fs-caption)/1 var(--lk-ui);font-variant-numeric:tabular-nums;-webkit-font-smoothing:antialiased;opacity:0;transition:opacity .25s linear}
/* the face: the glass, a faint AI-made brushed-glass grain (brand/dial/dial-glass.webp, screen-blended so it takes the night's red), the teaching boat */
.lk-cv .dial{display:block;overflow:hidden}
.lk-cv .dial::before{content:'';position:absolute;inset:0;border-radius:50%;background:url(/brand/dial/dial-glass.webp) center/cover;opacity:.13;mix-blend-mode:screen;pointer-events:none}
:root[data-lk-theme=night] .lk-cv .dial::before{filter:sepia(1) saturate(3) hue-rotate(-35deg)}
.lk-cv .dial::after{content:'';position:absolute;left:0;right:0;bottom:0;height:34%;background:linear-gradient(0deg,rgb(var(--lk-brand-navy) / .8) 0 50%,transparent);pointer-events:none}
.lk-cv .dial svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.lk-cv .inr{bottom:12%}
:where(:root[data-screen~=narrow]) .lk-cv{bottom:calc(var(--lk-by) + var(--lk-row-h) + var(--lk-gap))}
.lk-cv .rw em{font-style:normal;font-size:var(--lk-fs-caption);font-weight:var(--lk-medium);margin-left:.3em;padding:.12em .38em;border-radius:.3em;color:rgb(var(--lk-navy));vertical-align:.08em}
.lk-cv .rw em:empty{display:none}
.lk-cv .rw em.p{background:rgb(var(--lk-port))}
.lk-cv .rw em.s{background:rgb(var(--lk-stbd))}
.lk-cv *{vector-effect:non-scaling-stroke}
.lk-cv .ln{fill:none;stroke:rgb(var(--lk-cream) / var(--cv-ink));stroke-width:1.6px;stroke-linecap:round;stroke-linejoin:round}
.lk-cv .ul{fill:none;stroke:rgb(var(--lk-navy) / .75);stroke-width:4.4px;stroke-linecap:round;stroke-linejoin:round}
.lk-cv .ring{fill:none;stroke:rgb(var(--lk-cream) / .7);stroke-width:1.2px}
.lk-cv .tick{fill:none;stroke:rgb(var(--lk-cream) / .85);stroke-width:1.3px;stroke-linecap:round}
.lk-cv .bow{fill:rgb(var(--lk-cream) / .9);stroke:none}
/* the teaching boat: a clean hull outline (port edge red, starboard green), the mast dot, and each sail a separate filled shape */
.lk-cv .hf{fill:rgb(var(--lk-cream) / .66);stroke:none}
.lk-cv .hull{stroke-width:1.6px}
.lk-cv .edge{fill:none;stroke-width:2.6px;stroke-linecap:round}
.lk-cv .edge.p{stroke:rgb(var(--lk-port))}
.lk-cv .edge.s{stroke:rgb(var(--lk-stbd))}
.lk-cv .sh{stroke:rgb(var(--lk-navy) / .45);stroke-width:1px;stroke-linejoin:round}
.lk-cv .sh.main{fill:rgb(var(--lk-cream) / var(--cv-ink))}
.lk-cv .sh.jib{fill:rgb(var(--lk-cream) / .9)}
.lk-cv .sh.hard{stroke-width:2.4px}
.lk-cv .sh.luff{fill-opacity:1}
.lk-cv .boom{stroke-width:2px}
.lk-cv .sheet{stroke:rgb(var(--lk-cream) / .85);stroke-width:1px;fill:none;stroke-linecap:round}
.lk-cv .wind{stroke-width:4.4px}
.lk-cv .wind.p{stroke:rgb(var(--lk-port))}
.lk-cv .wind.s{stroke:rgb(var(--lk-stbd))}
.lk-cv .wind.head{fill:rgb(var(--lk-cream) / var(--cv-ink));stroke-width:1.4px}
.lk-cv .wind.head.p{fill:rgb(var(--lk-port))}
.lk-cv .wind.head.s{fill:rgb(var(--lk-stbd))}
/* the no-go zone: a shaded wedge about the true wind, its edges the port (red) and starboard (green) close-hauled lines */
.lk-cv .wedge{fill:rgb(var(--lk-cream));stroke:none;opacity:.12;transition:opacity .4s}
.lk-cv .nedge{fill:none;stroke-width:2px;stroke-linecap:round;opacity:.95;transition:opacity .4s}
.lk-cv .nedge.p{stroke:rgb(var(--lk-port))}
.lk-cv .nedge.s{stroke:rgb(var(--lk-stbd))}
.lk-cv .mast{fill:rgb(var(--lk-cream));stroke:rgb(var(--lk-navy) / .5);stroke-width:1.4px}
.lk-cv .hit{fill:none;stroke:#000;stroke-opacity:0;stroke-width:${CAPTAIN.hitPx}px;stroke-linecap:round;pointer-events:stroke;cursor:grab;touch-action:none}
.lk-cv.off .hit{pointer-events:none}
.lk-cv.drag .hit{cursor:grabbing}
.lk-cv .target{stroke-dasharray:2.5 3;stroke:rgb(var(--lk-amber));opacity:0;transition:opacity .2s}
.lk-cv.drag .target{opacity:.9}
.lk-cv.cue-sails .sail{animation:lk-cv-pulse 1.4s ease-in-out infinite}
@keyframes lk-cv-pulse{0%,100%{opacity:.95}50%{opacity:.5}}
`;

const DEG = Math.PI / 180;
// the plan (viewBox 0 0 100 100, bow up): the hull 64 long and 20 wide, the mast 38 % aft of the bow
const BOW = [50, 18], STERN = [50, 82], MAST = [50, 42], BOOM = 34, JIB = 27, RUDDER = 11, CLEAT = [50, 70];   // CLEAT: where the main sheet leads on deck
const HULL_D = `M50 18 C61 30 64 48 63.4 63 C63 72 60 80 56 82 L44 82 C40 80 37 72 36.6 63 C36 48 39 30 50 18 Z`;   // a clean teaching hull: a plain pointed oval with a square transom
// The boat's plan is drawn at PLAN_K of its own size, its centre PLAN_AT units down (of 100), so the readings sit under it inside
// the round glass. A small dial (a phone's) draws the boat smaller and higher: its readings are taller against it.
let PLAN_K = 0.62, PLAN_AT = 44;
const BOAT_B = () => [50, PLAN_AT];   // the boat's centre in the dial's units: the wind arrow and the no-go wedge are drawn about it
import { clampT as clamp } from '../sim/core/math.js';
const f1 = (v) => (+v).toFixed(1);
const R0 = 25 * DEG, GAIN = 0.6;                     // the rudder's stop (BOAT.rudder.maxDeg) and its drawn gain
const SHEET_MIN = 12 * DEG, SHEET_MAX = 80 * DEG;   // the main's sheeting range (sheets.js HAND.min/max)

// ---- the glyph as a control (pure: tests/mouse.test.mjs) ----
// A point in the glyph's viewBox → the sheet (rad) that would put the sail line there: its angle from dead aft about
// the sail's pivot (the mast for the main, the bow for the jib), clamped to the sheeting range. Forward of the pivot
// is all the way out.
export function glyphSheet(x, y, sail = 'main') {
  const [px, py] = sail === 'jib' ? BOW : MAST;
  return clamp(Math.abs(Math.atan2(x - px, y - py)), SHEET_MIN, SHEET_MAX);
}
// A point → the helm (−1 port … +1 starboard, the rudder's share of its stop): the rudder line's angle about the
// stern, the drawn gain undone (the glyph draws |r|^0.6), so the line lands under the pointer
export function glyphRudder(x, y) {
  const rd = clamp(Math.atan2(x - STERN[0], Math.max(4, y - STERN[1])), -R0, R0);
  return Math.sign(rd) * Math.pow(Math.abs(rd) / R0, 1 / GAIN);
}
// The hand on the sheet toward a target: +1 pull in … −1 ease, full beyond 3° off, still within 0.3°
export function pullToward(sheet, target) {
  if (sheet == null || target == null) return 0;
  const e = (sheet - target) / DEG;
  return Math.abs(e) < 0.3 ? 0 : clamp(e / 3, -1, 1);
}

// a sail as a filled shape from `from`, its chord of length L at angle a (rad, + to starboard, 0 = dead aft): drawing, it fills out
// to leeward (the sail's own side) like a belly between the chord and the curve; luffing, the curve flutters about the chord (a wave
// that runs down it); stalled, it goes flat. Returns the outline and the clew.
function sailShape(from, L, a, { fill = 1, stall = 0, t = 0 }) {
  const dx = Math.sin(a), dy = Math.cos(a);          // along the chord, aft
  const nx = Math.cos(a), ny = -Math.sin(a);         // across it, to starboard
  const side = a >= 0 ? 1 : -1;                      // the sail's own side (the boom's)
  const belly = 9 * clamp(fill, 0, 1) * (1 - 0.8 * clamp(stall, 0, 1));   // a stalled sail goes flat
  const luff = 1 - clamp(fill, 0, 1);
  const n = 14, amp = 2.6 * luff, cur = [], chord = [];
  for (let i = 0; i <= n; i++) {
    const q = i / n, hump = Math.sin(q * Math.PI);
    const w = (luff < 0.15 ? 0 : Math.sin(q * Math.PI * 3 - t * 14) * amp * hump) + side * (belly * (1 - luff) + 1.8) * Math.sqrt(hump);   // 1.1: never a bare line
    cur.push([from[0] + dx * L * q + nx * w, from[1] + dy * L * q + ny * w]);
    chord.push([from[0] + dx * L * q, from[1] + dy * L * q]);
  }
  const d = cur.map((p, i) => `${i ? 'L' : 'M'}${f1(p[0])} ${f1(p[1])}`).join('') + chord.reverse().map((p) => `L${f1(p[0])} ${f1(p[1])}`).join('') + 'Z';
  return { d, clew: [from[0] + dx * L, from[1] + dy * L] };
}

// always: the wind circle is always visible, like the chart (owner, 2026-10-30): pinned from the start, V never hides it
export function createCaptainView({ root = document.body, state = () => null, once = true, storage = globalThis.localStorage, always = false } = {}) {
  ensureTokens();
  if (!document.getElementById('lk-cv-css')) {
    const st = document.createElement('style'); st.id = 'lk-cv-css'; st.textContent = CSS; document.head.appendChild(st);
  }
  const el = document.createElement('div'); el.className = 'lk-cv lk-rd';
  const pt = (deg, R) => `${f1(50 + Math.sin(deg * DEG) * R)} ${f1(50 - Math.cos(deg * DEG) * R)}`;
  const ticks = Array.from({ length: 36 }, (_, i) => i).filter((i) => i).map((i) => { const d = i * 10, r1 = i % 3 ? 45.6 : 43.4; return `M${pt(d, 48.4)} L${pt(d, r1)}`; }).join(' ');
  const PLAN = '<g class="plan">';
  el.innerHTML = `<div class="dial glass"><svg viewBox="0 0 100 100" aria-hidden="true">
    <circle class="ring" cx="50" cy="50" r="48.4"/>
    <path class="tick" d="${ticks}"/>
    <path class="bow" d="M50 5 L46.8 11.5 L53.2 11.5 Z"/>
    <path class="wedge" d=""/>
    <path class="nedge p" d=""/>
    <path class="nedge s" d=""/>
    ${PLAN}
    <path class="hf" d="${HULL_D}"/>
    <path class="ln hull" d="${HULL_D}"/>
    <path class="edge p" d="M50 18 C39 30 36 48 36.6 63 C37 72 40 80 44 82"/>
    <path class="edge s" d="M50 18 C61 30 64 48 63.4 63 C63 72 60 80 56 82"/>
    <path class="sheet main" d=""/>
    <path class="sheet jib" d=""/>
    <path class="ln boom" d=""/>
    <path class="sh sail main" d=""/>
    <path class="sh sail jib" d=""/>
    <circle class="mast" cx="${MAST[0]}" cy="${MAST[1]}" r="3"/>
    <path class="ln rud" d=""/>
    </g>
    <g class="windg"><path class="ln wind" d="M0 0 L0 0"/><path class="ln wind head" d=""/></g>
    <path class="ln trend" d="" style="opacity:0"/>
    ${PLAN}
    <path class="ln target" d=""/>
    <path class="hit hsail" data-k="main" d=""/>
    <path class="hit hsail" data-k="jib" d=""/>
    <path class="hit hrud" d=""/>
    </g>
  </svg><div class="inr"><div class="rw"><i>AWA</i><b><span class="awa">0</span>°<em class="side"></em></b></div><div class="rw s"><i>AWS</i><b><span class="aws">0.0</span><small>kn</small></b></div></div></div>`;
  root.appendChild(el);
  const planGs = [...el.querySelectorAll('.plan')];
  const applyPlan = () => {
    const w = document.documentElement.classList.contains('lk-dials-in') ? el.offsetWidth * 0.8 : (el.getBoundingClientRect().width || 200);   // in the cockpit's instruments: its raised size (the hidden one is shrunk onto the face)
    PLAN_K = w < 130 ? 0.36 : w < 190 ? 0.5 : 0.62; PLAN_AT = w < 130 ? 36 : w < 190 ? 41 : 44;
    for (const g of planGs) g.setAttribute('transform', `translate(50 ${PLAN_AT}) scale(${PLAN_K}) translate(-50 -50)`);
  };
  applyPlan(); addEventListener('resize', applyPlan);
  const planRo = typeof ResizeObserver === 'function' ? new ResizeObserver(applyPlan) : null; planRo?.observe(el);   // the touch class arrives after the dial is built
  const q = (c) => el.querySelector(c);
  const wedge = q('.wedge'), nedgeP = q('.nedge.p'), nedgeS = q('.nedge.s'), boom = q('.boom'), sheetM = q('.sheet.main'), sheetJ = q('.sheet.jib'), main = q('.sail.main'), jib = q('.sail.jib'), rud = q('.rud'), wind = q('.wind'), head = q('.wind.head'), trendEl = q('.trend');
  // every moving line has a dark under-stroke, a hair wider (the chart-plotter way of keeping a line on any ground)
  for (const ln of [rud, wind, head, boom]) { const u = document.createElementNS('http://www.w3.org/2000/svg', 'path'); u.setAttribute('class', 'ul'); ln.parentNode.insertBefore(u, ln); ln._u = u; }
  const D = (ln, d) => { ln.setAttribute('d', d); ln._u?.setAttribute('d', d); };
  const awaEl = q('.awa'), awsEl = q('.aws'), sideEl = q('.side');
  let trend = null;   // pro: the pod's lift / header trend ({ kind, level }), drawn as a small chevron by the arrow's tail
  const svg = q('svg'), targetEl = q('.target'), hitMain = q('.hit[data-k=main]'), hitJib = q('.hit[data-k=jib]'), hitRud = q('.hit.hrud');
  // ---- the pointer: drag the sail line, drag the rudder (touch too: pointer events, touch-action none) ----
  let drag = null, hover = false, nogoAsk = false, hitT = 1;
  const toBox = (e) => { const r = svg.getBoundingClientRect(); return [50 + ((e.clientX - r.left) / r.width * 100 - 50) / PLAN_K, 50 + ((e.clientY - r.top) / r.height * 100 - PLAN_AT) / PLAN_K]; };   // into the plan's own units
  const onDown = (e) => {
    if (mode === 'off' || e.button > 0) return;
    const [x, y] = toBox(e), path = e.currentTarget;
    drag = path === hitRud ? { kind: 'rudder', steer: glyphRudder(x, y) } : { kind: 'sheet', sail: path.dataset.k, sheet: glyphSheet(x, y, path.dataset.k) };
    drag.id = e.pointerId; el.classList.add('drag');
    try { path.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
    e.preventDefault(); e.stopPropagation();
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const [x, y] = toBox(e);
    if (drag.kind === 'rudder') drag.steer = glyphRudder(x, y); else drag.sheet = glyphSheet(x, y, drag.sail);
    e.preventDefault();
  };
  const onUp = (e) => { if (drag && e.pointerId === drag.id) { drag = null; el.classList.remove('drag'); targetEl.setAttribute('d', ''); } };
  for (const h of [hitMain, hitJib, hitRud]) {
    h.addEventListener('pointerdown', onDown); h.addEventListener('pointermove', onMove);
    h.addEventListener('pointerup', onUp); h.addEventListener('pointercancel', onUp); h.addEventListener('lostpointercapture', onUp);
    const gl = h === hitRud ? 'helm' : h === hitJib ? 'jib' : 'mainsheet';   // the sailor's words: a hover glosses the part (ui/gloss.js)
    h.addEventListener('pointerenter', (e) => { hover = true; if (e.pointerType !== 'touch') dispatchEvent(new CustomEvent('lk-gloss', { detail: { term: gl, x: e.clientX, y: e.clientY } })); });
    h.addEventListener('pointerleave', () => { hover = false; dispatchEvent(new Event('lk-gloss-off')); });
  }

  let seen = false;
  try { seen = once && storage?.getItem('lakeshore.hints.v2') === '1'; } catch { /* run it */ }
  let mode = always ? 'pinned' : 'auto', a = 0, t = 0, visible = false, disposed = false, cue = null;

  function draw(s) {
    const awa = s.apparentWind?.angle ?? 0, aws = s.apparentWind?.speed ?? 0, twa = s.trueWind?.angle ?? 0;
    // the sails: the boom and the clew as the physics reports them
    const sm = sailShape(MAST, BOOM, s.boomAngle ?? 0, { fill: s.mainFill ?? 1, stall: s.mainStall ?? 0, t });
    const sj = sailShape(BOW, JIB, s.jibAngle ?? 0, { fill: s.jibFill ?? 1, stall: s.jibStall ?? 0, t });
    D(main, sm.d); D(jib, sj.d);
    // the boom, and the sheets from the clews to the deck: eased they run long and out, pulled in they run short and fair
    D(boom, `M${MAST[0]} ${MAST[1]} L${f1(sm.clew[0])} ${f1(sm.clew[1])}`);
    D(sheetM, `M${f1(sm.clew[0])} ${f1(sm.clew[1])} L${CLEAT[0]} ${CLEAT[1]}`);
    const jc = Math.sign(s.jibAngle || 1) * 7;   // the jib's sheet leads to the winch on its own side
    D(sheetJ, `M${f1(sj.clew[0])} ${f1(sj.clew[1])} L${50 + jc} 66`);
    drawHits(s);
    const hardM = (s.mainStall ?? 0) > 0.6 && Math.abs(awa) < 80 * DEG, hardJ = (s.jibStall ?? 0) > 0.6 && Math.abs(awa) < 80 * DEG;
    main.classList.toggle('hard', hardM); jib.classList.toggle('hard', hardJ);
    main.classList.toggle('luff', (s.mainFill ?? 1) < 0.5); jib.classList.toggle('luff', (s.jibFill ?? 1) < 0.5);
    // the rudder: the trailing edge swings to the side the boat turns to
    // drawn with a gain on small angles (|r|^0.6 of the 25° stop), so the pilot's few degrees of weather helm in a
    // gust read as a swing (5° draws as ≈ 9.5°); the stop draws at the stop
    const R0 = 25 * DEG, r = Math.sign(s.rudderAngle ?? 0) * R0 * Math.pow(Math.min(1, Math.abs(s.rudderAngle ?? 0) / R0), 0.6);
    D(rud, `M${STERN[0]} ${STERN[1]} L${f1(STERN[0] + RUDDER * Math.sin(r))} ${f1(STERN[1] + RUDDER * Math.cos(r))}`);
    // the apparent wind: a big arrow from the side it comes from, pointing at the boat, stopping a hair short of the sails; coloured by
    // the side the wind comes from (port red, starboard green), cream within 5° of the bow or the stern. Its width grows with the strength.
    const ux = Math.sin(awa), uy = -Math.cos(awa);     // the direction the wind comes FROM, bow up
    const [bx, by] = BOAT_B();
    // where a ray from the boat's centre leaves the glass (the circle of radius 48 about the dial's centre): the tail and the wedge stop there
    const leave = (dx, dy) => { const ox = bx - 50, oy = by - 50, b2 = ox * dx + oy * dy, c = ox * ox + oy * oy - 48 * 48; const t = -b2 + Math.sqrt(b2 * b2 - c); return [bx + dx * t, by + dy * t]; };
    const rs = 1 / Math.sqrt((ux / (BOOM * PLAN_K * 0.95)) ** 2 + (uy / (36 * PLAN_K * 0.92)) ** 2) + 1;   // how far from the boat's centre the sails and hull reach, in this direction
    const frac = clamp(aws / CAPTAIN.awsFull, 0, 1);
    const [tx, ty] = leave(ux, uy), hx = bx + ux * rs, hy = by + uy * rs;   // the tail starts at the rim
    D(wind, `M${f1(tx)} ${f1(ty)} L${f1(hx + ux * 7)} ${f1(hy + uy * 7)}`);
    wind.style.strokeWidth = `${(3.2 + 2.6 * frac).toFixed(1)}px`;
    const px = -uy, py = ux;                           // across the arrow
    const hw = 6.4 + 2.4 * frac;
    D(head, `M${f1(hx)} ${f1(hy)} L${f1(hx + ux * 12 + px * hw)} ${f1(hy + uy * 12 + py * hw)} L${f1(hx + ux * 12 - px * hw)} ${f1(hy + uy * 12 - py * hw)} Z`);
    const aw = Math.abs(awa) / DEG, side = aw < 5 || aw > 175 ? '' : awa < 0 ? 'p' : 's';
    wind.classList.toggle('p', side === 'p'); wind.classList.toggle('s', side === 's'); head.classList.toggle('p', side === 'p'); head.classList.toggle('s', side === 's');
    const aT = String(Math.round(aw)), sT = (aws * KN).toFixed(1);
    if (awaEl.textContent !== aT) awaEl.textContent = aT;
    if (awsEl.textContent !== sT) awsEl.textContent = sT;
    if (sideEl.textContent !== side.toUpperCase()) { sideEl.textContent = side.toUpperCase(); sideEl.className = `side ${side}`; }
    // pro: the trend chevron beside the arrow, up (toward the bow) for a lift, down for a header
    if (trend?.kind) {
      const c = 2.6 + 1.6 * (trend.level ?? 0), d = trend.kind === 'lift' ? -1 : 1, tcx = bx + ux * 44 + px * 9, tcy = by + uy * 44 + py * 9;
      trendEl.setAttribute('d', `M${f1(tcx - c)} ${f1(tcy - d * c * 0.6)} L${f1(tcx)} ${f1(tcy + d * c * 0.6)} L${f1(tcx + c)} ${f1(tcy - d * c * 0.6)}`);
      trendEl.style.opacity = (0.5 + 0.45 * (trend.level ?? 0)).toFixed(2);
    } else trendEl.style.opacity = 0;
    // the no-go zone: a shaded wedge about the true wind, always there (it is the lesson), brighter as the bow comes inside it; its edges
    // are the port (red) and starboard (green) close-hauled lines
    const at = Math.abs(twa), w = CAPTAIN.wedgeDeg * DEG;
    const c0 = twa - w, c1 = twa + w, hot = at < w || nogoAsk || cue === 'wedge';
    const wp = (c) => leave(Math.sin(c), -Math.cos(c)).map(f1).join(' ');
    wedge.setAttribute('d', `M${f1(bx)} ${f1(by)} L${wp(c0)} A48 48 0 0 1 ${wp(c1)} Z`);
    nedgeP.setAttribute('d', `M${f1(bx)} ${f1(by)} L${wp(c0)}`); nedgeS.setAttribute('d', `M${f1(bx)} ${f1(by)} L${wp(c1)}`);
    wedge.style.opacity = hot ? 0.3 : 0.12;
    nedgeP.style.opacity = nedgeS.style.opacity = hot ? 1 : 0.95;
  }

  // the hit strokes: straight chords over the lines (a sail's belly or flutter stays inside the wide stroke); kept
  // current at 4 Hz while the glyph is hidden, so a hover over a faded glyph finds its lines and wakes it
  function drawHits(s) {
    const chord = (from, L, a) => `M${f1(from[0])} ${f1(from[1])} L${f1(from[0] + Math.sin(a) * L)} ${f1(from[1] + Math.cos(a) * L)}`;
    hitMain.setAttribute('d', chord(MAST, BOOM, s.boomAngle ?? 0));
    hitJib.setAttribute('d', chord(BOW, JIB, s.jibAngle ?? 0));
    const R0d = R0 * Math.pow(Math.min(1, Math.abs(s.rudderAngle ?? 0) / R0), GAIN) * Math.sign(s.rudderAngle ?? 0);
    hitRud.setAttribute('d', `M${STERN[0]} ${STERN[1] - 2} L${f1(STERN[0] + (RUDDER + 3) * Math.sin(R0d))} ${f1(STERN[1] + (RUDDER + 3) * Math.cos(R0d))}`);
    // dragging the sheet: a dashed line where the sheet is going (the sail swings to it as the winch brings it)
    if (drag?.kind === 'sheet') {
      const side = Math.sign(s.boomAngle || 1), [px, py] = drag.sail === 'jib' ? BOW : MAST, L = drag.sail === 'jib' ? JIB : BOOM;
      targetEl.setAttribute('d', `M${f1(px)} ${f1(py)} L${f1(px + Math.sin(side * drag.sheet) * L)} ${f1(py + Math.cos(side * drag.sheet) * L)}`);
    }
  }

  function update(dt, { sinceUse = Infinity, trend: tr = null, nogo = false, cue: c = null } = {}) {
    if (disposed) return;
    trend = tr; nogoAsk = !!nogo;
    t += dt;
    el.classList.toggle('off', mode === 'off');
    if (c !== cue) { el.classList.toggle('cue-sails', c === 'sails'); cue = c; }
    const rest = !seen && t < CAPTAIN.restFor ? CAPTAIN.rest : 0;
    const want = mode === 'off' ? 0 : mode === 'pinned' || sinceUse < CAPTAIN.hold || drag || hover || cue ? CAPTAIN.on : rest;
    a = want > a ? Math.min(want, a + dt / CAPTAIN.fadeIn * CAPTAIN.on) : Math.max(want, a - dt / CAPTAIN.fadeOut * CAPTAIN.on);
    visible = a > 0.005;
    // the plates must stay opaque (an element under opacity < 1 loses its blur): the plate fades in to the rest level,
    // the ink's own alpha carries the rest and in-use levels (--cv-ink)
    el.style.opacity = visible ? Math.min(1, a / CAPTAIN.rest).toFixed(3) : '0';
    el.style.setProperty('--cv-ink', Math.max(a, CAPTAIN.rest).toFixed(3));
    if (!visible) { hitT += dt; if (hitT > 0.25 && mode !== 'off') { hitT = 0; const s = state(); if (s) drawHits(s); } return; }
    const s = state(); if (s) draw(s);
    if (!seen && t > 120) { try { seen = storage?.getItem('lakeshore.hints.v2') === '1'; } catch { /* ignore */ } }
  }
  function toggle() { if (always) return mode; mode = { auto: 'pinned', pinned: 'off', off: 'auto' }[mode]; return mode; }
  function dispose() { disposed = true; removeEventListener('resize', applyPlan); planRo?.disconnect(); el.remove(); }
  return { update, toggle, dispose, el, draw, get drag() { return drag; }, get hover() { return hover; }, get mode() { return mode; }, get pinned() { return mode === 'pinned'; }, get visible() { return visible; }, get alpha() { return a; } };
}
