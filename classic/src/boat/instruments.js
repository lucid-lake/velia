// The skipper's instruments (owner, 2026-10-29: "a few things that mimic what the captain really sees"):
// real objects on the boat, drawn from the physics, no HUD. Two for Day Sail:
//   1. the compass card under the binnacle's dome on the wheel pedestal (cockpit.glb has the dome and the binnacle;
//      the card is ours): it stays on north as the boat turns, a lubber line on the bezel reads the heading;
//   2. one display on the cabin's aft bulkhead, port of the companionway, facing the helm: the apparent wind's angle as
//      a needle on a dial, and the boat's speed in knots as a numeral. A real instrument shows numbers; this is the
//      only place a number appears in Day Sail, and only at the size a face has (the captain's view reads it).
// Both are canvas textures redrawn at most 10× a second and only when a value moves; cream on navy, the hints' family.
// Telltales and the burgee are details.js's (they already read the flow); the wheel turns in Boat.js.
//   const inst = createInstruments(); boat.sockets.hull.add(inst.group); inst.update(state) each frame
import * as THREE from 'three/webgpu';
import { ShiftTrend } from '../../../src/sim/wind-shifts.js';
import { FACE_PALETTE, facePalette, faceGain, nightK } from '../../../src/boat/nightLight.js';

const DEG = Math.PI / 180;
const CREAM = '#EFE6D2', NAVY = '#0d131b';
const INSTRUMENTS = {
  // HULL frame (x starboard, y up, z aft; the origin on the waterline amidships). The pedestal: blender/m3_cockpit.py
  // (the axle 1.20 m up, the dome 0.10–0.16 m above it, radius 0.10 at its base); the card sits just under the dome.
  // (the pedestal stands at HULL z 2.45, the wheel 0.14 m aft of it; the guard's rail 0.12 m forward, 1.25 m up)
  card: { at: [0, 1.305, 2.45], r: 0.072 },
  // the display: a 0.12 × 0.06 m pod on the pedestal guard's rail, facing the helm and tilted up 25°, as a pedestal pod
  // is; a C28's bulkhead instruments would hide under the dodger from the helm's camera
  display: { at: [0, 1.335, 2.33], w: 0.12, h: 0.06, tiltDeg: 25 },
  hz: 10,
  dampS: [1, 2.5],   // the speed's damping time (s): out of the groove, locked in
};

function canvasTexture(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t };
}

// the card: 360° of marks, the cardinal letters, tens at every 30° (as a real card: 3, 6, 9 … 33)
function drawCard(g, S) {
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
    g.font = `${card ? 400 : 300} ${Math.round(S * (card ? 0.13 : 0.095))}px Jost, Helvetica Neue, sans-serif`;
    g.save(); g.translate(x, y); g.rotate(a); g.fillText(card ?? String(d / 10), 0, 0); g.restore();
  }
}

// the display: the apparent wind's angle on a dial (the bow up), the speed in knots; pro: the lift / header trend
// (trend: { kind: 'lift' | 'header' | null, level 0..1 }) as a small chevron over the speed, up for a lift, down for a
// header, its size with the shift, the way a tactical instrument's trend page shows it
// P: the face's inks (nightLight.js: the day set, or the night set)
function drawDisplay(g, W, H, { awaDeg = 0, kn = 0, trend = null } = {}, P = FACE_PALETTE.day) {
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
  g.font = `300 ${Math.round(H * 0.62)}px Jost, Helvetica Neue, sans-serif`; g.fillText(kn.toFixed(1), W * 0.80, H * 0.66);
  g.font = `300 ${Math.round(H * 0.20)}px Jost, Helvetica Neue, sans-serif`; g.globalAlpha = 0.6; g.fillText('kn', W * 0.95, H * 0.66); g.globalAlpha = 1;
  // pro: the trend chevron, right of the dial, above the numeral's baseline band (a lift points up, a header down)
  if (trend?.kind) {
    const up = trend.kind === 'lift', s = H * (0.10 + 0.07 * (trend.level ?? 0)), x = W * 0.43, y = H * 0.83;
    g.strokeStyle = P.ink; g.lineWidth = H * 0.035; g.lineJoin = 'round'; g.lineCap = 'round'; g.globalAlpha = 0.55 + 0.4 * (trend.level ?? 0);
    g.beginPath(); g.moveTo(x - s, y + (up ? s * 0.55 : -s * 0.55)); g.lineTo(x, y + (up ? -s * 0.55 : s * 0.55)); g.lineTo(x + s, y + (up ? s * 0.55 : -s * 0.55)); g.stroke();
    g.font = `300 ${Math.round(H * 0.16)}px Jost, Helvetica Neue, sans-serif`; g.textAlign = 'left'; g.fillStyle = P.ink;
    g.fillText(up ? 'LIFT' : 'HDR', x + s * 1.5, y + H * 0.055); g.globalAlpha = 1;
  }
}

export function createInstruments() {
  const I = INSTRUMENTS;
  const group = new THREE.Group(); group.name = 'instruments';
  // the card
  const card = canvasTexture(256, 256); drawCard(card.g, 256); card.t.needsUpdate = true;
  const cardMesh = new THREE.Mesh(new THREE.CircleGeometry(I.card.r, 48), new THREE.MeshStandardNodeMaterial({ map: card.t, roughness: 0.85, metalness: 0 }));
  cardMesh.rotation.x = -Math.PI / 2; cardMesh.position.set(...I.card.at); cardMesh.name = 'compass-card'; group.add(cardMesh);
  // the lubber line: a short cream mark on the bezel's aft edge, fixed to the boat
  const lub = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.003, 0.016), new THREE.MeshStandardNodeMaterial({ color: 0xefe6d2, roughness: 0.6 }));
  lub.position.set(I.card.at[0], I.card.at[1] + 0.002, I.card.at[2] + I.card.r * 0.96); group.add(lub);
  // the display: a bezel and a lit face
  const disp = canvasTexture(256, 128); drawDisplay(disp.g, 256, 128, {}); disp.t.needsUpdate = true;
  const pod = new THREE.Group(); pod.position.set(...I.display.at); pod.rotation.x = I.display.tiltDeg * DEG; group.add(pod);   // the face leans back toward the helm
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(I.display.w + 0.016, I.display.h + 0.016, 0.022), new THREE.MeshStandardNodeMaterial({ color: 0x1a1f26, roughness: 0.5 }));
  pod.add(bezel);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(I.display.w, I.display.h), new THREE.MeshBasicNodeMaterial({ map: disp.t }));
  face.position.z = 0.0115; face.name = 'wind-speed-display'; pod.add(face);
  // by night (fix/helm-view-cockpit; nightLight.js): the pod's face held at its on-screen level in the night set, and the card lit
  // red from under the dome as a binnacle's night light does (its marks glow, the navy stays dark)
  let night = false, gain = 1, last = { awa: NaN, kn: NaN, trend: null }, acc = 0, prevT = null, knD = null;
  const cardMat = cardMesh.material; cardMat.emissive.setRGB(1, 0.36, 0.22); cardMat.emissiveMap = card.t; cardMat.emissiveIntensity = 0;
  function light(f = {}) {
    gain = faceGain(f); face.material.color.setScalar(gain);
    const k = nightK(f.elevDeg), n = k >= 0.5;
    cardMat.emissiveIntensity = 0.1 * k * Math.min(1, f.exposureComp ?? 1);
    if (n !== night) { night = n; last = { awa: NaN, kn: NaN, trend: null }; acc = 1e9; }
  }
  group.userData.daylight = light;

  // the speed's damping (a real pod's: ≈ 1 s), longer in the groove (src/boat/groove.js): the boat locked in reads one
  // steady number, not a flicker of tenths

  // pro: the lift / header trend from the true wind at the boat (the scene clock: t is sim time); drawn only with pro on
  const trend = new ShiftTrend(); let tr = null;
  const api = { group, update, light, card: cardMesh, display: face, pro: false, get trend() { return tr; }, get night() { return night; }, get gain() { return gain; } };
  function update(state, t = performance.now() / 1000) {
    // the card holds north: turn it back by the heading (three's +y rotation is counter-clockwise seen from above,
    // the heading is clockwise from north)
    cardMesh.rotation.z = state.heading ?? 0;
    const dt = prevT == null ? 1 : Math.max(0, t - prevT); prevT = t; acc += dt;
    const raw = (state.sog ?? 0) / 0.514444, tau = I.dampS[0] + (I.dampS[1] - I.dampS[0]) * Math.min(1, Math.max(0, state.groove ?? 0));
    knD = knD == null ? raw : knD + (raw - knD) * (1 - Math.exp(-Math.min(dt, 1) / tau));
    if (acc < 1 / I.hz) return;
    const tdt = acc; acc = 0;
    const twa = state.trueWind?.angle ?? 0;
    tr = trend.update(Math.min(tdt, 1), ((state.heading ?? 0) + twa) / DEG, twa);
    const awa = (state.apparentWind?.angle ?? 0) / DEG, kn = knD;
    const tk = api.pro && tr.kind ? `${tr.kind}${Math.round(tr.level * 4)}` : null;
    if (Math.abs(awa - last.awa) < 1.5 && Math.abs(kn - last.kn) < 0.08 && tk === last.trend) return;
    last = { awa, kn, trend: tk };
    drawDisplay(disp.g, 256, 128, { awaDeg: awa, kn, trend: api.pro ? tr : null }, facePalette(night)); disp.t.needsUpdate = true;
  }
  return api;
}
