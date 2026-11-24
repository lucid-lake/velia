// Tessie's mark on the chart (owner, 2026-11-17: "On the chart we should add a Tessie logo, maybe a monster SVG, very beautiful,
// to draw the user's attention to visit that area"). An old chart's sea creature, drawn as engraving: our
// Tessie B "Granite": her granite-scute humps breaking the water, her broad soft head with its barbels, a curl of
// water; cream ink line work with hatching on the chart's navy, her scutes in the home card's gold foil. Original art: no
// existing Tessie mascot, sea-monster print or chart artwork was copied.
//   tessieMarkSvg({ ink, gold, ground })       the engraved glyph (128 × 80 viewBox; the enlarged chart's when it is 28 px or more)
//   tessieDialSvg({ ink, gold, ground })       the small round chart's (the cockpit's chart dial): a plain silhouette, 32 × 20
//   const M = createTessieMark({ on, area, boat, store, reduced, mode, say })
//     M.areas()      → [] or one row for the chartplotter's areas layer ({ id, x, z, r, name, glyph, ring, still, size })
//     M.update()     each frame: the first visit (the boat inside her water) ends the ring, kept on the device
//     M.picked(p)    a chart pick on her mark: the skipper's line (once a minute at most); returns the line or null
//     M.visited      bool
// on(): feature('tessie').on (desktop only: a phone, a tablet never shows her); mode(): 'sail' | 'cruise' | 'race' (a race: none);
// store: localStorage or null (the visit survives a reload; a private window keeps it for the page's life).
export const TESSIE_MARK = Object.freeze({
  // world-sized (owner, 2026-11-17: "the mark is too big on the map: it's bigger than the island"): a chart vignette 105 m long on
  // the water, 65 % of Fannette Island's 162 m (its 0 m contour on the terrain grid), so it scales with the chart; clamped to a
  // size where it still reads and a cap. The enlarged chart's floor is 16 px (not more: at its default zoom, 2.4 km half-height on
  // a 550 px chart, the island itself is about 18 px); under engraveFromPx it draws the silhouette, the engraving above it
  lenM: 105, aspect: 0.625,
  big: Object.freeze({ min: 16, max: 64 }),     // px wide on the enlarged chart (the planner)
  small: Object.freeze({ min: 12, max: 20 }),   // px wide on the small round chart and so the cockpit's chart dial
  engraveFromPx: 28,
  edgeInM: 40,               // a tap's waypoint: this far inside her water's edge, on the side toward the boat (clear of her glyph)
  ringS: 4.2,                // s per ring: a faint water ring widens from the mark and fades, two at once, until the first visit
  ringA: 0.34,               // the ring's alpha at its start (cream ink)
  storeKey: 'lakeshore.tessieWaters.v1',
  line: 'Locals say she likes the deep water by the island.',
  lineEveryS: 60,
  label: "Tessie's water",
});
const CREAM = '#efe6d2', GOLD = '#c9a45a', NAVY = '#1c2340';
const f1 = (v) => +v.toFixed(2);

// a hump of her back: a rounded arch from x0 to x1 on the waterline Y, its crest h above it, leaning a touch forward (lean < 0.5:
// the front steeper, as a back rolling forward through the water) → its outline as points
function humpPts(x0, x1, Y, h, lean = 0.45, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, w = u < lean ? 0.5 * u / lean : 0.5 + 0.5 * (u - lean) / (1 - lean);
    pts.push([x0 + (x1 - x0) * u, Y - h * Math.pow(Math.sin(Math.PI * w), 0.78)]);
  }
  return pts;
}
const poly = (pts, close = true) => `M${pts.map((q) => `${f1(q[0])} ${f1(q[1])}`).join('L')}${close ? 'Z' : ''}`;
// the engraver's form shade: short strokes from the outline inward along its normal, every gap units of its length, longer
// toward the shaded end (len0 → len1 from u0 to u1 of the polyline), clipped to the part
function formHatch(pts, u0, u1, { gap = 1.7, len0 = 1.5, len1 = 6, side = 1, ink, w = 0.75, a = 0.85, id }) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const T = L[L.length - 1];
  let d = '', i = 1;
  for (let sLen = u0 * T; sLen <= u1 * T; sLen += gap) {
    while (i < pts.length - 1 && L[i] < sLen) i++;
    const A = pts[i - 1], B = pts[i], t = (sLen - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]);
    const x = A[0] + (B[0] - A[0]) * t, y = A[1] + (B[1] - A[1]) * t, dx = B[0] - A[0], dy = B[1] - A[1], l = Math.hypot(dx, dy) || 1;
    const nx = -dy / l * side, ny = dx / l * side, k = (sLen / T - u0) / Math.max(1e-9, u1 - u0), len = len0 + (len1 - len0) * k;
    d += `M${f1(x - nx * 0.6)} ${f1(y - ny * 0.6)}L${f1(x + nx * len)} ${f1(y + ny * len)}`;
  }
  return `<path clip-path="url(#${id})" d="${d}" stroke="${ink}" stroke-opacity="${a}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
}
// the scutes along a crest: rounded granite plates set on the outline between u0 and u1 (of its length), tangent to it: gold
// foil with a cream rim and a dark fleck; the middle plates the largest. Their tops break the outline: the humps read as rocks
function scutes(pts, u0, u1, n, size, { ink, gold, ground }) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const at = (s) => { let i = 1; while (i < pts.length - 1 && L[i] < s) i++; const t = (s - L[i - 1]) / Math.max(1e-9, L[i] - L[i - 1]), a = pts[i - 1], b = pts[i]; return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, Math.atan2(b[1] - a[1], b[0] - a[0])]; };
  let s = '';
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? (u0 + u1) / 2 : u0 + (u1 - u0) * i / (n - 1), [x, y, ang] = at(u * L[L.length - 1]);
    const k = 0.72 + 0.28 * Math.sin(Math.PI * (i + 0.5) / n), r = size * k;
    s += `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(ang * 180 / Math.PI)})"><path d="M${f1(-r)} 0.9C${f1(-r)} ${f1(-r * 0.95)} ${f1(r)} ${f1(-r * 0.95)} ${f1(r)} 0.9Z" fill="${gold}" stroke="${ink}" stroke-width="1" stroke-linejoin="round"/>`
      + `<path d="M${f1(-r * 0.45)} ${f1(-r * 0.28)}q${f1(r * 0.4)} ${f1(-r * 0.3)} ${f1(r * 0.8)} 0" stroke="${ground}" stroke-opacity="0.55" stroke-width="0.6" fill="none"/></g>`;
  }
  return s;
}

export function tessieMarkSvg({ ink = CREAM, gold = GOLD, ground = NAVY } = {}) {
  const W = 128, H = 80, Y = 54;   // the waterline
  // her neck and head (facing left): the neck rises in a soft arc from the water; a broad flattened head, a long shovel snout
  // with a blunt tip, the jaw closed
  const neck = 'M40.5 54C41 42.5 38.4 31.6 32.4 24.8C29.8 21.2 26.4 18 22.6 17.6C20.4 17.4 19 18.6 17 18.9C13.6 19.4 8.6 20.8 5.8 23C3.6 24.8 3.2 27.4 4.4 28.9C5.6 30.3 8 30.6 10.6 30.7C14.2 30.9 17.8 31 20.6 31.6C24 32.4 25.8 35.4 26.3 40.4C26.7 44.4 26.9 49 26.9 54Z';
  const back = [[31.2, 23.4], [34.4, 27.6], [37.4, 32.6], [39.6, 38.8], [40.6, 46], [40.5, 54]];
  const h1 = humpPts(46, 82, Y, 21.5, 0.44), h2 = humpPts(88, 112, Y, 13.5, 0.44);
  const hump1 = poly(h1), hump2 = poly(h2);
  // the tail: a slim arc out of the water, curling over, its small fluke
  const tail = 'M115 54C116 48.4 118.4 43.6 121.8 41.2C123.8 39.8 125.6 40.4 125.2 42.2C124.6 44.4 121.9 45.4 120.5 48.2C119.5 50.2 119.3 52.4 119.4 54Z';
  const fluke = 'M121.9 41.3C120.4 38.2 121 35.5 123.1 34.4C122.7 36.9 124.1 38.6 126.2 39.2C125 40.3 123.4 40.9 121.9 41.3Z';
  const body = (d) => `<path d="${d}" fill="${ground}" stroke="${ink}" stroke-width="1.9" stroke-linejoin="round"/>`;
  // the sea: the engraver's water, an oval of swell strokes that thins and fades away from her (the cartouche's sea)
  let sea = '';
  const rows = [[57.2, 1.15, 0.92], [60.6, 1.0, 0.78], [64, 0.9, 0.62], [67.4, 0.8, 0.46], [70.8, 0.7, 0.32]];
  for (const [y, w, a] of rows) {
    const hw = 63 * Math.sqrt(Math.max(0, 1 - ((y - Y + 1) / 19) ** 2));
    let d = '', x = 64 - hw + ((y * 7) % 4);
    while (x < 64 + hw - 3) { const len = 4.5 + ((x * 13 + y * 7) % 6); const xe = Math.min(64 + hw, x + len); d += `M${f1(x)} ${y}Q${f1((x + xe) / 2)} ${f1(y - 1.2)} ${f1(xe)} ${y}`; x = xe + 2 + ((x * 3) % 2.5); }
    sea += `<path d="${d}" stroke="${ink}" stroke-opacity="${a}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
  }
  const waterline = `M2 ${Y}Q8 ${Y - 1.5} 14 ${Y}T26.9 ${Y}M40.5 ${Y}Q43.2 ${Y - 1.4} 46 ${Y}M82 ${Y}Q85 ${Y - 1.5} 88 ${Y}M112 ${Y}Q113.5 ${Y - 1.1} 115 ${Y}M119.4 ${Y}Q123 ${Y - 1.5} 126.5 ${Y}`;
  // the curls (the classic engraved breaking water) where she meets the surface, and a spray of ticks
  const curls = 'M44.6 53.4C42.6 49.4 45 46.2 47.9 47.2C50 48 49.4 51.2 47.2 50.9C46 50.7 46.1 49.3 47.1 49.2'
    + 'M26 53.4C24.6 50.2 21.4 49.6 19.9 51.5C18.9 52.9 20.4 54.3 21.6 53.5'
    + 'M86.2 53.4C85.4 50.6 87.3 48.8 89.2 49.6'
    + 'M114.4 53.4C113.6 51.2 114.8 49.6 116.2 50';
  const ticks = 'M51.8 44.4l-1.9-1.5M49.6 47.6l-2.5-.5M33 49.6l1.7-1.9M17.4 48.6l-1.5-1.5M90.6 45.6l-1-1.8M84.4 48.6l-.9-1.9M118 47.6l1.4-1.5';
  // the shade (light from the upper left, as the chart's relief): contour lines bunched on the humps' right flanks, the
  // neck's back drawn again inside itself, short strokes at her waterline
  const defs = `<defs><clipPath id="tm-n"><path d="${neck}"/></clipPath><clipPath id="tm-h1"><path d="${hump1}"/></clipPath><clipPath id="tm-h2"><path d="${hump2}"/></clipPath><clipPath id="tm-t"><path d="${tail}"/></clipPath></defs>`;
  const S = { ink, gold, ground };
  // the right flanks: strokes in from the outline, from the crest down to the water (side -1: the outline runs left to right, so
  // its inward normal is down)
  const shade = formHatch(h1.slice(Math.round(h1.length * 0.5)), 0.05, 1, { ink, id: 'tm-h1', side: 1, len0: 1.2, len1: 6.5 })
    + formHatch(h2.slice(Math.round(h2.length * 0.5)), 0.05, 1, { ink, id: 'tm-h2', side: 1, len0: 1, len1: 4.6 })
    + formHatch(back, 0.0, 1, { ink, id: 'tm-n', side: 1, len0: 1.4, len1: 4.4, gap: 1.6 })
    + formHatch([[121.6, 41.4], [120, 44], [119, 48], [119.4, 54]], 0, 1, { ink, id: 'tm-t', side: -1, len0: 1, len1: 2.2, gap: 1.5 })
;
  // her face: a broad soft head, a small dark eye under a soft brow (all pupil: never a predator's eye), a closed lip line with
  // low corners (no smile, no teeth), four short barbels, a nostril, the head plates; the throat folds
  const face = `<path d="M17.4 20.4Q20.6 18.8 23.8 20.6" stroke="${ink}" stroke-width="1.05" fill="none" stroke-linecap="round"/>`
    + `<ellipse cx="20.6" cy="22" rx="1.35" ry="1.15" fill="${ink}"/><circle cx="20.15" cy="21.6" r="0.4" fill="${ground}"/>`
    + `<path d="M8 28.2Q13.4 29 18.8 28.4q1 .1 1.7.8" stroke="${ink}" stroke-width="0.95" fill="none" stroke-linecap="round"/>`
    + `<circle cx="6.4" cy="23.6" r="0.55" fill="${ink}"/>`
    + `<path d="M8.8 30.6q.9 2.4 3 3M12.4 30.8q.8 2 2.6 2.5" stroke="${ink}" stroke-width="0.85" fill="none" stroke-linecap="round"/>`
    + `<path d="M10.4 21Q18 18.6 27.4 21.2M24 18.4Q26.6 21.6 26.4 26M22.4 25Q25.4 25.8 27 29" stroke="${ink}" stroke-opacity="0.6" stroke-width="0.7" fill="none"/>`
    + `<path d="M24.2 37q3.2-1.1 6.4-.1M25.2 42.6q3.1-1 6.2 0M25.9 48.2q2.8-.9 5.8 0" stroke="${ink}" stroke-opacity="0.7" stroke-width="0.8" fill="none"/>`;
  // granite flecks on the humps' lit sides (the stipple of the boulders)
  let fleck = '';
  for (const [x, y] of [[54, 45], [56.5, 40.5], [59.5, 44.2], [55.5, 49.6], [58.4, 48], [62.5, 37.6], [52, 47.6], [92.5, 48.2], [95.2, 45], [94, 51]]) fleck += `<circle cx="${x}" cy="${y}" r="0.5" fill="${ink}" fill-opacity="0.75"/>`;
  const plates = scutes(h1, 0.2, 0.8, 6, 3.3, S) + scutes(h2, 0.24, 0.76, 4, 2.6, S)
    + scutes(back, 0.28, 0.68, 2, 1.9, S);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W * 2}" height="${H * 2}">${defs}`
    + `<g stroke-linecap="round" fill="none">${sea}<path d="${waterline}" stroke="${ink}" stroke-width="1.3"/></g>`
    + [neck, hump1, hump2, tail, fluke].map(body).join('') + shade + fleck + plates + face
    + `<path d="${curls}" stroke="${ink}" stroke-width="1.2" fill="none" stroke-linecap="round"/>`
    + `<path d="${ticks}" stroke="${ink}" stroke-opacity="0.85" stroke-width="0.85" fill="none" stroke-linecap="round"/></svg>`;
}

// the silhouette: under 28 px only a silhouette reads: the head and neck, two humps and the tail tip in cream on a navy halo,
// the waterline in gold
export function tessieDialSvg({ ink = CREAM, gold = GOLD, ground = NAVY } = {}) {
  const sil = 'M10.6 14C10.3 10.5 9 7.6 7.2 6C5.8 4.8 3.6 4.7 2.2 5.6C1.2 6.3 1.3 7.4 2.6 7.6C4 7.8 5.3 8.3 5.9 9.6C6.5 11 6.8 12.6 6.9 14Z'
    + 'M12.4 14C13.2 9.8 15 8.4 16.6 8.4C18.4 8.4 20 10 20.8 14Z'
    + 'M23 14C23.6 11.2 24.6 10.2 25.6 10.2C26.8 10.2 27.6 11.4 28 14Z'
    + 'M29 14C29.2 12 30 10.6 31.2 10.2C31.6 11 31 12.2 30.6 14Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 20" width="128" height="80">`
    + `<path d="${sil}" fill="${ground}" stroke="${ground}" stroke-width="2.6" stroke-linejoin="round"/>`
    + `<path d="M0.6 15.2H31.4" stroke="${ground}" stroke-width="3" stroke-linecap="round"/>`
    + `<path d="${sil}" fill="${ink}"/>`
    + `<path d="M1 15.2Q4 14.4 7 15.2T13 15.2T19 15.2T25 15.2T31 15.2" stroke="${gold}" stroke-width="1.1" fill="none" stroke-linecap="round"/></svg>`;
}

// an image of an SVG for the chart's 2D canvas (none outside a page: the tests read the rows, not the pixels)
function imageOf(svg) {
  if (typeof Image === 'undefined') return null;
  const im = new Image();
  im.decoding = 'async';
  im.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return im;
}

export function createTessieMark({ on = () => false, area = null, boat = () => null, store = null, reduced = () => false, mode = () => 'sail', say = null, now = () => performance.now() / 1000, M = TESSIE_MARK } = {}) {
  let visited = false, glyphs = null, saidAt = -1e9;
  try { visited = store?.getItem?.(M.storeKey) === '1'; } catch { /* a private window: the page's life */ }
  const shown = () => !!area && on() && mode() !== 'race';
  const row = () => {
    glyphs ??= { big: imageOf(tessieMarkSvg()), small: imageOf(tessieDialSvg()) };
    return { id: area.id, x: area.x, z: area.z, r: area.r, name: M.label, glyph: glyphs, ring: !visited, still: !!reduced(), ringS: M.ringS, ringA: M.ringA,
      lenM: M.lenM, aspect: M.aspect, px: { big: M.big, small: M.small }, engraveFromPx: M.engraveFromPx,
      // the waypoint a tap sets: inside the edge toward (fx, fz), so the route's ring never sits on her glyph (inside her water: the centre)
      pickAt: (fx, fz) => { const d = Math.hypot(fx - area.x, fz - area.z), k = area.r - M.edgeInM; return d <= k || !(d > 0) ? { x: area.x, z: area.z } : { x: area.x + (fx - area.x) / d * k, z: area.z + (fz - area.z) / d * k }; } };
  };
  const self = {
    M,
    get visited() { return visited; },
    areas() { return shown() ? [row()] : []; },
    update() {
      if (visited || !shown()) return;
      const s = boat();
      if (s && Number.isFinite(s.x) && Math.hypot(s.x - area.x, s.z - area.z) <= area.r) {
        visited = true;
        try { store?.setItem?.(M.storeKey, '1'); } catch { /* none */ }
      }
    },
    picked(p) {
      if (!p || p.area !== area?.id || !shown()) return null;
      const t = now();
      if (t - saidAt < M.lineEveryS) return null;
      saidAt = t;
      say?.(M.line);
      return M.line;
    },
  };
  return self;
}
