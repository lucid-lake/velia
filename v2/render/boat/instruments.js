// The skipper's two instruments (M4), v1's src/boat/instruments.js without three.js: the compass card under the
// binnacle's dome on the wheel pedestal (it holds north, the lubber line on the bezel reads the heading) and the pod on
// the pedestal guard's rail facing the helm (the apparent wind's angle as a needle, the boat's speed in knots). Pure:
// the 2D-canvas drawing, the numbers, and the update rule (redraw at most INSTRUMENTS.hz a second and only when a value
// moves; the speed damped as a real pod's, longer in the groove; the night set when the sun is down). The GPU side is
// render/boatInstruments.js; the night palette and gains are v1's own (src/boat/nightLight.js: pure, imported).
//   drawCard(g, S)                         the card's face on a S × S 2D context (once)
//   drawDisplay(g, W, H, values, palette)  the pod's face
//   const L = instrumentLogic();  L.light({ elevDeg, exposureComp }) once a frame; const r = L.update(state, t)
//     → r.cardAngle (rad, the card's turn about the HULL frame's up: + = counter-clockwise seen from above; cardLocal);
//       r.redraw (true when the face must be redrawn now) with r.values ({ awaDeg, kn, trend }) and r.palette
//
// Copied from src/boat/instruments.js (three-bound there: it imports three/webgpu for its CanvasTexture and meshes):
//   CREAM, NAVY, INSTRUMENTS          ← lines 15–26
//   drawCard                          ← lines 35–56 (unchanged)
//   drawDisplay                       ← lines 62–90 (unchanged)
//   light()                           ← lines 106–115 (the face's gain, the card's red night emissive, the palette switch)
//   update()                          ← lines 124–143 (the card's turn, the damping, the 10 Hz gate, the move thresholds)
import { FACE_PALETTE, facePalette, faceGain, nightK } from '../../../src/boat/nightLight.js';
import { ShiftTrend } from '../../../src/sim/wind-shifts.js';

const DEG = Math.PI / 180;
export const CREAM = '#EFE6D2', NAVY = '#0d131b';
export const INSTRUMENTS = Object.freeze({
  // HULL frame (x starboard, y up, z aft; the origin on the waterline amidships). The pedestal: blender/m3_cockpit.py
  // (the axle 1.20 m up, the dome 0.10–0.16 m above it, radius 0.10 at its base); the card sits just under the dome.
  card: Object.freeze({ at: Object.freeze([0, 1.305, 2.45]), r: 0.072 }),
  // the lubber line: a short cream mark on the bezel's aft edge, fixed to the boat (v1: a 4 × 3 × 16 mm box)
  lubber: Object.freeze({ size: Object.freeze([0.004, 0.003, 0.016]), dy: 0.002, rK: 0.96 }),
  // the display: a 0.12 × 0.06 m pod on the pedestal guard's rail, facing the helm and tilted 25° (three's rotation.x)
  display: Object.freeze({ at: Object.freeze([0, 1.335, 2.33]), w: 0.12, h: 0.06, tiltDeg: 25, bezel: 0.016, depth: 0.022, faceZ: 0.0115 }),
  hz: 10,
  dampS: Object.freeze([1, 2.5]),   // the speed's damping time (s): out of the groove, locked in
  moveDeg: 1.5, moveKn: 0.08,       // a redraw needs the needle to move this much, or the numeral this much
  cardEmissive: Object.freeze([1, 0.36, 0.22]), cardEmissiveK: 0.1,   // by night the card lit red from under the dome
  cardRoughness: 0.85, bezelColor: 0x1a1f26, bezelRoughness: 0.5, lubberColor: 0xefe6d2, lubberRoughness: 0.6,
  texSize: Object.freeze({ card: 256, display: Object.freeze([256, 128]) }),
});
export const KNOT = 0.514444;   // m/s

const FONT = 'Jost, Helvetica Neue, sans-serif';

// the card: 360° of marks, the cardinal letters, tens at every 30° (as a real card: 3, 6, 9 … 33)
export function drawCard(g, S) {
  const r = S / 2, cx = r, cy = r;
  g.clearRect(0, 0, S, S);
  g.fillStyle = NAVY; g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fill();
  g.strokeStyle = CREAM; g.lineCap = 'butt';
  for (let d = 0; d < 360; d += 5) {
    const a = d * DEG, big = d % 30 === 0, mid = d % 10 === 0;
    g.lineWidth = big ? S * 0.012 : S * 0.006; g.globalAlpha = big ? 0.95 : mid ? 0.7 : 0.4;
    const r0 = r * (big ? 0.80 : mid ? 0.86 : 0.90), r1 = r * 0.97;
    g.beginPath(); g.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); g.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1); g.stroke();
  }
  g.globalAlpha = 1; g.fillStyle = CREAM; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let d = 0; d < 360; d += 30) {
    const a = d * DEG, rr = r * 0.66, x = cx + Math.sin(a) * rr, y = cy - Math.cos(a) * rr;
    const card = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[d];
    g.font = `${card ? 400 : 300} ${Math.round(S * (card ? 0.13 : 0.095))}px ${FONT}`;
    g.save(); g.translate(x, y); g.rotate(a); g.fillText(card ?? String(d / 10), 0, 0); g.restore();
  }
}

// the display: the apparent wind's angle on a dial (the bow up), the speed in knots; pro: the lift / header trend
// (trend: { kind: 'lift' | 'header' | null, level 0..1 }) as a small chevron, up for a lift, down for a header
// P: the face's inks (nightLight.js: the day set, or the night set)
export function drawDisplay(g, W, H, { awaDeg = 0, kn = 0, trend = null } = {}, P = FACE_PALETTE.day) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
  const r = H * 0.40, cx = H * 0.5, cy = H * 0.5;
  g.strokeStyle = P.dim; g.lineWidth = H * 0.018;
  g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
  for (let d = 0; d < 360; d += 30) {        // ticks, the close-hauled ones (±45°) longer
    const a = d * DEG, long = d === 45 || d === 315 || d === 0;
    g.lineWidth = H * (long ? 0.03 : 0.015); g.globalAlpha = long ? 0.9 : 0.5;
    g.beginPath(); g.moveTo(cx + Math.sin(a) * r * (long ? 0.74 : 0.84), cy - Math.cos(a) * r * (long ? 0.74 : 0.84)); g.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r); g.stroke();
  }
  g.globalAlpha = 1;
  // the hull: a slim pointed shape, bow up
  g.fillStyle = P.dim; g.beginPath(); g.moveTo(cx, cy - r * 0.42); g.quadraticCurveTo(cx + r * 0.16, cy, cx + r * 0.12, cy + r * 0.40); g.lineTo(cx - r * 0.12, cy + r * 0.40); g.quadraticCurveTo(cx - r * 0.16, cy, cx, cy - r * 0.42); g.fill();
  // the needle: the wind FROM this angle off the bow
  const a = awaDeg * DEG;
  g.strokeStyle = P.ink; g.lineWidth = H * 0.04; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx + Math.sin(a) * r * 0.55, cy - Math.cos(a) * r * 0.55); g.lineTo(cx + Math.sin(a) * r * 0.97, cy - Math.cos(a) * r * 0.97); g.stroke();
  // the speed
  g.fillStyle = P.ink; g.textAlign = 'right'; g.textBaseline = 'alphabetic';
  g.font = `300 ${Math.round(H * 0.62)}px ${FONT}`; g.fillText(kn.toFixed(1), W * 0.80, H * 0.66);
  g.font = `300 ${Math.round(H * 0.20)}px ${FONT}`; g.globalAlpha = 0.6; g.fillText('kn', W * 0.95, H * 0.66); g.globalAlpha = 1;
  // pro: the trend chevron, right of the dial, above the numeral's baseline band (a lift points up, a header down)
  if (trend?.kind) {
    const up = trend.kind === 'lift', s = H * (0.10 + 0.07 * (trend.level ?? 0)), x = W * 0.43, y = H * 0.83;
    g.strokeStyle = P.ink; g.lineWidth = H * 0.035; g.lineJoin = 'round'; g.lineCap = 'round'; g.globalAlpha = 0.55 + 0.4 * (trend.level ?? 0);
    g.beginPath(); g.moveTo(x - s, y + (up ? s * 0.55 : -s * 0.55)); g.lineTo(x, y + (up ? -s * 0.55 : s * 0.55)); g.lineTo(x + s, y + (up ? s * 0.55 : -s * 0.55)); g.stroke();
    g.font = `300 ${Math.round(H * 0.16)}px ${FONT}`; g.textAlign = 'left'; g.fillStyle = P.ink;
    g.fillText(up ? 'LIFT' : 'HDR', x + s * 1.5, y + H * 0.055); g.globalAlpha = 1;
  }
}

// the card's mark (compass deg, 0..360) under a HULL-frame horizontal direction (dx, dz) from the card's centre, for a
// card turned by cardAngle (cardLocal's frame: the canvas's mark d sits at local (sin d, cos d)). Toward the bow
// (0, −1) it reads the heading; v1's lubber line sits on the aft edge (0, +1), over the reciprocal (a plain card, not a
// front-reading one: v1's as it is)
export function cardMarkAt(cardAngle, dx, dz) {
  const c = Math.cos(cardAngle), s = Math.sin(cardAngle);
  const lx = c * dx - s * dz, ly = -s * dx - c * dz;
  return ((Math.atan2(lx, ly) / DEG) % 360 + 360) % 360;
}

// the parts' HULL-frame matrices (column-major mat4, as engine/math.js), v1's three.js transforms: the card at its spot,
// rotation.x = −90° then rotation.z = cardAngle (three's Euler XYZ: T · Rx · Rz), so the canvas's top (north) turns about
// the hull's up; the pod at its spot, rotation.x = tiltDeg
export function cardLocal(out, cardAngle, I = INSTRUMENTS) {
  const c = Math.cos(cardAngle), s = Math.sin(cardAngle), [x, y, z] = I.card.at;
  // Rx(−90°) · Rz(a): local x → (c, 0, −s), local y → (−s, 0, −c), local z → (0, 1, 0)
  out.set([c, 0, -s, 0, -s, 0, -c, 0, 0, 1, 0, 0, x, y, z, 1]);
  return out;
}
export function podLocal(out, I = INSTRUMENTS) {
  const t = I.display.tiltDeg * DEG, c = Math.cos(t), s = Math.sin(t), [x, y, z] = I.display.at;
  out.set([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, x, y, z, 1]);
  return out;
}

// v1's update logic and light(), state only (no canvas, no GPU): the caller draws when r.redraw is true
export function instrumentLogic({ pro = false } = {}) {
  const I = INSTRUMENTS;
  let night = false, gain = 1, cardEmissive = 0;
  let last = { awa: NaN, kn: NaN, trend: null }, acc = 0, prevT = null, knD = null;
  const trend = new ShiftTrend(); let tr = null;
  const out = { cardAngle: 0, redraw: false, values: { awaDeg: 0, kn: 0, trend: null }, palette: FACE_PALETTE.day };
  const api = {
    pro,
    get night() { return night; }, get gain() { return gain; }, get cardEmissive() { return cardEmissive; }, get trend() { return tr; }, get kn() { return knD; },
    // f: { elevDeg, exposureComp } (v1's daylight frame): the face's gain, the card's emissive intensity, the palette;
    // a palette switch forces the next update to redraw
    light(f = {}) {
      gain = faceGain(f);
      const k = nightK(f.elevDeg), n = k >= 0.5;
      cardEmissive = I.cardEmissiveK * k * Math.min(1, f.exposureComp ?? 1);
      if (n !== night) { night = n; last = { awa: NaN, kn: NaN, trend: null }; acc = 1e9; }
      return api;
    },
    // state: the physics state (heading rad clockwise from north, sog m/s, groove 0..1, apparentWind/trueWind { angle rad });
    // t: the scene's time (s)
    update(state, t = 0) {
      out.redraw = false;
      // the card holds north: turned back by the heading (+ counter-clockwise seen from above; the heading is clockwise)
      out.cardAngle = state.heading ?? 0;
      const dt = prevT == null ? 1 : Math.max(0, t - prevT); prevT = t; acc += dt;
      const raw = (state.sog ?? 0) / KNOT, tau = I.dampS[0] + (I.dampS[1] - I.dampS[0]) * Math.min(1, Math.max(0, state.groove ?? 0));
      knD = knD == null ? raw : knD + (raw - knD) * (1 - Math.exp(-Math.min(dt, 1) / tau));
      if (acc < 1 / I.hz) return out;
      const tdt = acc; acc = 0;
      const twa = state.trueWind?.angle ?? 0;
      tr = trend.update(Math.min(tdt, 1), ((state.heading ?? 0) + twa) / DEG, twa);
      const awa = (state.apparentWind?.angle ?? 0) / DEG, kn = knD;
      const tk = api.pro && tr.kind ? `${tr.kind}${Math.round(tr.level * 4)}` : null;
      if (Math.abs(awa - last.awa) < I.moveDeg && Math.abs(kn - last.kn) < I.moveKn && tk === last.trend) return out;
      last = { awa, kn, trend: tk };
      out.redraw = true; out.values = { awaDeg: awa, kn, trend: api.pro ? tr : null }; out.palette = facePalette(night);
      return out;
    },
  };
  return api;
}
