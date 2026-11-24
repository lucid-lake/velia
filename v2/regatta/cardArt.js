// The course cards' art (step D4; owner 2026-11-17: "course cards rendered properly"): each course drawn
// as a small chart, the hub's own course drawing (hub.js courseSvg: the legs, the marks numbered 1, 2 … F with their rounding's symbol,
// the start line, the wind arrow) laid on a navy chart ground (a faint graticule, a few depth contours, the chart's neatline, a small
// compass rose), then baked to crisp PNGs at 1× and 2× by tools/v2-regatta-cards.mjs (headless Chromium: the hub's fonts, no hinting
// guesswork in a 1.3 px stroke at 96 px). The words beside the art (the course's length and time) stay HTML on the card, so they always
// say the player's own length, wind and pace. Pure and deterministic (no Math.random, no clock): v2/tests/regatta-cards.test.mjs.
//   cardSvg(course, { kind }) → the SVG string the renderer bakes; CARD_KINDS: the sizes (CSS px; the 2× file is twice each side)
//   chartGround({ w, h, seed, rose }) → the ground alone (the hub's course board draws the live course over it)
import { courseSvg } from './hub.js';

export const CARD_KINDS = Object.freeze({
  card: Object.freeze({ w: 240, h: 150, pad: 20, labels: true, stroke: 1.6, size: 14, rose: true }),    // Custom's preview: the numbers and symbols
  tile: Object.freeze({ w: 120, h: 80, pad: 11, labels: false, stroke: 1.5, size: 0, rose: false }),     // Custom's course cards and its Course row
  plate: Object.freeze({ w: 150, h: 118, pad: 13, labels: false, stroke: 1.5, size: 0, rose: false }),   // the hub's hand plate
  board: Object.freeze({ w: 412, h: 250, pad: 0, labels: false, stroke: 0, size: 0, rose: true }),       // the course board's ground only
});
export const CHART = Object.freeze({ navy: '#1c2340', deep: '#161c34', ink: 'rgb(239 230 210)', grid: 0.07, contour: 0.11, rule: 0.42 });

const f1 = (v) => (Math.round(v * 10) / 10).toString();
// a small seeded stream (mulberry32) from a string: the contours' shapes are the course's own and never change between bakes
function streamOf(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  let a = h || 1;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// the chart's ground: navy deepening toward one corner, the graticule (a ruled grid as a chart's meridians and parallels), three or four
// depth contours (closed, smooth, the deep water's lines round a shoal off one side), the neatline (a heavy rule and a hairline inside it,
// the home card's chart), and a small compass rose in a corner (rose)
export function chartGround({ w, h, seed = 'chart', rose = true } = {}) {
  const r = streamOf(seed), C = CHART, out = [];
  const gid = `g${(streamOf(`${seed}#id`)() * 1e9) >>> 0}`;
  out.push(`<defs><radialGradient id="${gid}" cx="${f1(20 + r() * 60)}%" cy="${f1(20 + r() * 60)}%" r="85%"><stop offset="0" stop-color="${C.navy}"/><stop offset="1" stop-color="${C.deep}"/></radialGradient></defs>`);
  out.push(`<rect width="${w}" height="${h}" fill="url(#${gid})"/>`);
  // the graticule: every step px, offset by the seed (a chart is never cut on its lines)
  const step = w >= 300 ? 48 : w >= 200 ? 36 : 24, ox = r() * step, oy = r() * step, g = [];
  for (let x = ox; x < w; x += step) g.push(`M${f1(x)} 0V${h}`);
  for (let y = oy; y < h; y += step) g.push(`M0 ${f1(y)}H${w}`);
  out.push(`<path d="${g.join('')}" stroke="${C.ink}" stroke-opacity="${C.grid}" stroke-width="${w >= 200 ? 0.6 : 0.5}" fill="none"/>`);
  // the contours: closed curves round a shoal centre off the card's middle, each a ring of 10 points with seeded radii, smoothed
  const cx = w * (r() < 0.5 ? -0.05 + r() * 0.25 : 0.8 + r() * 0.25), cy = h * (0.15 + r() * 0.7), rings = w >= 200 ? 4 : 3;
  for (let k = 0; k < rings; k++) {
    const R = (0.22 + k * 0.17) * Math.max(w, h), n = 10, pts = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI, rr = R * (0.82 + r() * 0.36); pts.push([cx + Math.cos(a) * rr * 1.25, cy + Math.sin(a) * rr * 0.8]); }
    // a closed Catmull-Rom through the ring, as cubic Béziers
    const d = [`M${f1(pts[0][0])} ${f1(pts[0][1])}`];
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i + n - 1) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      d.push(`C${f1(p1[0] + (p2[0] - p0[0]) / 6)} ${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)} ${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])} ${f1(p2[1])}`);
    }
    out.push(`<path d="${d.join('')}Z" stroke="${C.ink}" stroke-opacity="${f1(C.contour * (1 - k * 0.18) * 100) / 100}" stroke-width="${w >= 200 ? 0.8 : 0.6}" stroke-dasharray="${k % 2 ? '3 3' : 'none'}" fill="none"/>`);
  }
  // the compass rose: a ring and a four-point star, faint, in the corner away from the shoal
  if (rose) {
    const rr = Math.min(w, h) * 0.13, x = cx < w / 2 ? w - rr - 14 : rr + 14, y = h - rr - 14;
    out.push(`<g stroke="${C.ink}" stroke-opacity=".18" fill="none" stroke-width=".7"><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rr)}"/><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(rr * 0.78)}"/></g>`);
    const s = rr * 0.95, q = rr * 0.16;
    out.push(`<path d="M${f1(x)} ${f1(y - s)}L${f1(x + q)} ${f1(y - q)}L${f1(x + s)} ${f1(y)}L${f1(x + q)} ${f1(y + q)}L${f1(x)} ${f1(y + s)}L${f1(x - q)} ${f1(y + q)}L${f1(x - s)} ${f1(y)}L${f1(x - q)} ${f1(y - q)}Z" fill="${C.ink}" fill-opacity=".12"/>`);
  }
  // the neatline
  const m = w >= 200 ? 5 : 3;
  out.push(`<rect x="${m}" y="${m}" width="${w - 2 * m}" height="${h - 2 * m}" fill="none" stroke="${C.ink}" stroke-opacity="${C.rule}" stroke-width="${w >= 200 ? 1.4 : 1}"/>`);
  if (w >= 200) out.push(`<rect x="${m + 3}" y="${m + 3}" width="${w - 2 * m - 6}" height="${h - 2 * m - 6}" fill="none" stroke="${C.ink}" stroke-opacity="${C.rule * 0.6}" stroke-width=".5"/>`);
  return out.join('');
}

export function cardSvg(course, { kind = 'card' } = {}) {
  const K = CARD_KINDS[kind] ?? CARD_KINDS.card, { w, h } = K;
  const ground = chartGround({ w, h, seed: `${course?.id ?? 'course'}:${kind}`, rose: K.rose });
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`, ground];
  if (kind !== 'board' && course?.line) {
    // the course drawn by the hub's own hand, inset inside the neatline (nested svg: its own viewBox)
    const inner = courseSvg(course, { w, h, pad: K.pad, labels: K.labels, stroke: K.stroke, size: K.size || 15 }).replace('<svg ', '<svg x="0" y="0" ');
    out.push(inner);
  }
  out.push('</svg>');
  return out.join('');
}
