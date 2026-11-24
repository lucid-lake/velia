// The bulkhead's instruments (owner, 2026-10-29: cheap captain's information sources). Real objects on the cabin's aft
// face (the companionway bulkhead), facing the helm, in the pod's family (src/boat/instruments.js): cream on navy, a
// dark bezel, no brand. Three:
//   1. a heel meter (starboard of the companionway): a pendulum inclinometer. A real needle hangs from a pivot over an
//      arc card and swings with the boat's heel (phys.state.heel with the waves' roll: the drawn pose), a damped
//      pendulum of 0.9 s, so a wave's roll shows as a swing and a steady heel as a steady reading.
//   2. a barometer (port, outboard): station pressure at the lake's 1,898 m (≈ 811 hPa), a slow drift and the daily
//      tide; on an advisory day it falls ≈ 5 hPa through the morning before the gale. A brass set hand shows the
//      reading 3 h earlier, as a skipper sets it, so the tendency reads at a glance.
//   3. a clock (port, inboard): the scene's local time (PDT, the D2 clock: core.sun.hour), hour and minute hands.
// Numbers appear only on these faces, at a face's own size, as on the pod.
//
//   const bh = createBulkhead({ hour: () => core.sun.hour, advisory, seed });
//   boat.sockets.hull.add(bh.group); bh.update(state, t) each frame (t: the scene clock, s)
//
// Plain parts (no three.js) for the tests: pressureHPa, HeelPendulum, clockHands, baroAngle, the draw functions.
import * as THREE from 'three/webgpu';
import { FACE_PALETTE, facePalette, faceGain, nightK } from '../../../src/boat/nightLight.js';

const DEG = Math.PI / 180;
const FONT = 'Jost, Helvetica Neue, sans-serif';

export const BULKHEAD = {
  // HULL frame (x starboard, y up, z aft; the origin on the waterline amidships). The companionway's aft face rises
  // from the sole (y 0.48) at z 1.40 and leans forward ≈ 10.5° (blender/m1_hull.py: trunk aft end 1.40, aft_face_run
  // 0.17 over ≈ 0.92 m); the opening is ± 0.19 m (the dropboards). The props stand 12 mm proud of the face, flush-mounted.
  face: { z0: 1.40, y0: 0.48, lean: 0.185, proud: 0.012 },
  heel: { x: 0.40, y: 1.10, w: 0.17, h: 0.10 },   // starboard of the opening
  clock: { x: -0.31, y: 1.12, r: 0.058 },          // port, inboard
  baro: { x: -0.47, y: 1.12, r: 0.058 },           // port, outboard
  pendulum: { periodS: 0.9, zeta: 0.55, maxDeg: 45 },   // damped: ≈ 12 % overshoot
  // the barometer's dial: 790–830 hPa over 270°
  dial: { lo: 790, hi: 830, sweepDeg: 270 },
  setHandH: 3,        // h: the set hand shows the reading this long ago
  hz: 4,              // face redraws a second at most (the needle of the heel meter is a mesh: every frame)
};
// where the face is at height y (z: it leans forward as it rises)
export const faceZ = (y) => BULKHEAD.face.z0 - BULKHEAD.face.lean * (y - BULKHEAD.face.y0) + BULKHEAD.face.proud;

// ---- the barometer --------------------------------------------------------------------------------------------
const hash = (i, s) => { const x = Math.sin(i * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Station pressure (hPa) at the lake's surface, 1,898 m: the standard atmosphere gives 805 hPa; a June high over the
// Sierra runs warmer, ≈ 811 ± 2 by the seed. A drift of ± 1.2 hPa over ≈ 20 h (smooth value noise), the semidiurnal
// tide (± 0.6 hPa, highs ≈ 10:00 and 22:00 local solar; solar = PDT − 1 h at 120.1° W). An advisory day (src/wind.js:
// the SW gale from ≈ 10–12) falls 5 hPa from 04:00 to 13:00 ahead of it, then levels.
export function pressureHPa(hour, { seed = 1, advisory = false } = {}) {
  const base = 811 + (hash(1, seed) - 0.5) * 4;
  const s = hour / 20, i = Math.floor(s), f = s - i, w = f * f * (3 - 2 * f);
  const drift = 1.2 * (2 * ((1 - w) * hash(10 + i, seed) + w * hash(11 + i, seed)) - 1);
  const tide = 0.6 * Math.cos(2 * Math.PI * ((hour - 1) - 10) / 12);
  const fall = advisory ? -5 * smooth(4, 13, hour) : 0;
  return base + drift + tide + fall;
}
// the dial's angle for a pressure: 0 at the top, + clockwise; lo at −135°, hi at +135°
export function baroAngle(hPa) {
  const D = BULKHEAD.dial, k = Math.min(1, Math.max(0, (hPa - D.lo) / (D.hi - D.lo)));
  return (-D.sweepDeg / 2 + D.sweepDeg * k) * DEG;
}

// ---- the clock --------------------------------------------------------------------------------------------------
// hands for a clock hour (0–24, fractional): angles from 12, clockwise (rad)
export function clockHands(hour) {
  const h = ((hour % 12) + 12) % 12, m = (hour * 60) % 60;
  return { hour: h / 12 * 2 * Math.PI, minute: m / 60 * 2 * Math.PI };
}

// ---- the heel meter's pendulum ----------------------------------------------------------------------------------
// A damped pendulum driven by the boat's roll: its angle relative to the boat is the heel (+ the heel's own sign:
// state.heel, rad; the needle hangs toward the low side). θ'' = −ω² (θ − heel) − 2ζω θ'. Stepped on the scene clock.
export class HeelPendulum {
  constructor() { this.a = null; this.v = 0; }
  step(heel, dt) {
    const P = BULKHEAD.pendulum, w = 2 * Math.PI / P.periodS, lim = P.maxDeg * DEG;
    if (this.a == null || !(dt >= 0) || dt > 1) { this.a = heel; this.v = 0; return this.a; }
    for (let n = Math.max(1, Math.ceil(dt * 240)), h = dt / n, i = 0; i < n; i++) {
      this.v += (-w * w * (this.a - heel) - 2 * P.zeta * w * this.v) * h;
      this.a += this.v * h;
    }
    if (Math.abs(this.a) > lim) { this.a = Math.sign(this.a) * lim; this.v = 0; }   // the card's stops
    return this.a;
  }
}

// ---- the faces --------------------------------------------------------------------------------------------------
function ring(g, S, r, P) {
  g.clearRect(0, 0, S, S);
  g.fillStyle = P.bg; g.beginPath(); g.arc(S / 2, S / 2, r, 0, 2 * Math.PI); g.fill();
}
function tick(g, cx, cy, a, r0, r1) { g.beginPath(); g.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); g.lineTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1); g.stroke(); }
function hand(g, cx, cy, a, len, width, color, tail = 0.18) {
  g.strokeStyle = color; g.lineWidth = width; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - Math.sin(a) * len * tail, cy + Math.cos(a) * len * tail); g.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len); g.stroke();
}

// P: the face's inks (nightLight.js facePalette: the day set, or the night set)
function drawClock(g, S, hour, P = FACE_PALETTE.day) {
  const r = S / 2 * 0.98, cx = S / 2, cy = S / 2;
  ring(g, S, r, P);
  g.strokeStyle = P.ink; g.lineCap = 'butt';
  for (let i = 0; i < 60; i++) {
    const big = i % 5 === 0; g.lineWidth = S * (big ? 0.02 : 0.007); g.globalAlpha = big ? 0.95 : 0.45;
    tick(g, cx, cy, i / 60 * 2 * Math.PI, r * (big ? 0.80 : 0.88), r * 0.94);
  }
  g.globalAlpha = 1; g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `300 ${Math.round(S * 0.16)}px ${FONT}`;
  for (const [n, a] of [[12, 0], [3, 90], [6, 180], [9, 270]]) g.fillText(String(n), cx + Math.sin(a * DEG) * r * 0.62, cy - Math.cos(a * DEG) * r * 0.62 + S * 0.01);
  const h = clockHands(hour);
  hand(g, cx, cy, h.hour, r * 0.48, S * 0.045, P.ink);
  hand(g, cx, cy, h.minute, r * 0.74, S * 0.028, P.ink);
  g.fillStyle = P.ink; g.beginPath(); g.arc(cx, cy, S * 0.035, 0, 2 * Math.PI); g.fill();
}

function drawBarometer(g, S, hPa, setHPa = null, P = FACE_PALETTE.day) {
  const D = BULKHEAD.dial, r = S / 2 * 0.98, cx = S / 2, cy = S / 2;
  ring(g, S, r, P);
  g.strokeStyle = P.ink; g.lineCap = 'butt';
  for (let p = D.lo; p <= D.hi; p += 1) {
    const big = p % 10 === 0, mid = p % 5 === 0; g.lineWidth = S * (big ? 0.02 : 0.008); g.globalAlpha = big ? 0.95 : mid ? 0.7 : 0.4;
    tick(g, cx, cy, baroAngle(p), r * (big ? 0.78 : mid ? 0.84 : 0.88), r * 0.94);
  }
  g.globalAlpha = 1; g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `300 ${Math.round(S * 0.12)}px ${FONT}`;
  for (let p = D.lo; p <= D.hi; p += 20) { const a = baroAngle(p); g.fillText(String(p), cx + Math.sin(a) * r * 0.58, cy - Math.cos(a) * r * 0.58); }
  g.globalAlpha = 0.6; g.font = `300 ${Math.round(S * 0.09)}px ${FONT}`; g.fillText('hPa', cx, cy + r * 0.62); g.globalAlpha = 1;
  if (setHPa != null) hand(g, cx, cy, baroAngle(setHPa), r * 0.86, S * 0.016, P.brass, 0);
  hand(g, cx, cy, baroAngle(hPa), r * 0.80, S * 0.03, P.ink);
  g.fillStyle = P.ink; g.beginPath(); g.arc(cx, cy, S * 0.035, 0, 2 * Math.PI); g.fill();
}

// the heel meter's card: a lower arc, the pivot at the top centre; ticks every 5° to ± 45°, 10 20 30 each side
function drawHeelCard(g, W, H, P = FACE_PALETTE.day) {
  g.clearRect(0, 0, W, H);
  g.fillStyle = P.bg; g.fillRect(0, 0, W, H);
  const cx = W / 2, cy = H * 0.08, R = H * 0.86;
  g.strokeStyle = P.ink; g.lineCap = 'butt';
  for (let d = -45; d <= 45; d += 5) {
    const a = d * DEG, big = d % 10 === 0; g.lineWidth = H * (big ? 0.02 : 0.01); g.globalAlpha = big ? 0.95 : 0.5;
    const x = (rr) => cx + Math.sin(a) * rr, y = (rr) => cy + Math.cos(a) * rr;
    g.beginPath(); g.moveTo(x(R * (big ? 0.80 : 0.86)), y(R * (big ? 0.80 : 0.86))); g.lineTo(x(R * 0.93), y(R * 0.93)); g.stroke();
  }
  g.globalAlpha = 1; g.fillStyle = P.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `300 ${Math.round(H * 0.13)}px ${FONT}`;
  for (const d of [10, 20, 30]) for (const s of [-1, 1]) { const a = s * d * DEG; g.fillText(String(d), cx + Math.sin(a) * R * 0.64, cy + Math.cos(a) * R * 0.64); }
  // the arc's guide line, and a faint band past the advisory heel (30°: src/boat/thrill.js, the rail goes under at 31°)
  g.strokeStyle = P.dim; g.lineWidth = H * 0.012;
  g.beginPath(); g.arc(cx, cy, R * 0.93, (90 - 45) * DEG, (90 + 45) * DEG); g.stroke();
  g.strokeStyle = P.faint; g.lineWidth = H * 0.05;
  for (const s of [-1, 1]) { g.beginPath(); g.arc(cx, cy, R * 0.965, (90 - s * 30) * DEG, (90 - s * 45) * DEG, s > 0); g.stroke(); }
}

function canvasTexture(w, h) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return { c, g: c.getContext('2d'), t };
}

export function createBulkhead({ hour = () => 12, advisory = false, seed = 1 } = {}) {
  const B = BULKHEAD;
  const group = new THREE.Group(); group.name = 'bulkhead-instruments';
  const bezelMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1f26, roughness: 0.5 });
  // a mount on the leaning face: the props' local +z is the face's normal (aft and 10.5° up), +y up the face
  const mount = (x, y) => { const o = new THREE.Group(); o.position.set(x, y, faceZ(y)); o.rotation.x = -Math.atan(B.face.lean); group.add(o); return o; };
  const dial = (spec, name, S = 256) => {
    const m = mount(spec.x, spec.y), tex = canvasTexture(S, S);
    const bez = new THREE.Mesh(new THREE.CylinderGeometry(spec.r + 0.008, spec.r + 0.010, 0.02, 40), bezelMat);
    bez.rotation.x = Math.PI / 2; m.add(bez);
    const face = new THREE.Mesh(new THREE.CircleGeometry(spec.r, 48), new THREE.MeshBasicNodeMaterial({ map: tex.t }));
    face.position.z = 0.0105; face.name = name; m.add(face);
    return { m, tex, face };
  };
  const clock = dial(B.clock, 'clock-face'), baro = dial(B.baro, 'barometer-face');
  // the heel meter: a plate, the card, the needle (a real mesh on a pivot) and its cap
  const hm = mount(B.heel.x, B.heel.y), card = canvasTexture(256, 152); drawHeelCard(card.g, 256, 152); card.t.needsUpdate = true;
  hm.add(new THREE.Mesh(new THREE.BoxGeometry(B.heel.w + 0.016, B.heel.h + 0.016, 0.02), bezelMat));
  const cardMesh = new THREE.Mesh(new THREE.PlaneGeometry(B.heel.w, B.heel.h), new THREE.MeshBasicNodeMaterial({ map: card.t }));
  cardMesh.position.z = 0.0105; cardMesh.name = 'heel-card'; hm.add(cardMesh);
  const pivot = new THREE.Group(); pivot.position.set(0, B.heel.h / 2 - B.heel.h * 0.08, 0.014); pivot.name = 'heel-needle'; hm.add(pivot);
  const L = B.heel.h * 0.86 * 0.9;
  // the needle and its bob: one material, its faint glow (the card's ink) held on screen by night (nightLight.js)
  const needleMat = new THREE.MeshStandardNodeMaterial({ color: 0xefe6d2, roughness: 0.6, emissive: 0x3a362e });
  const needle = new THREE.Mesh(new THREE.BoxGeometry(0.0025, L, 0.0015), needleMat);
  needle.position.y = -L / 2; pivot.add(needle);
  const bob = new THREE.Mesh(new THREE.CircleGeometry(0.006, 16), needleMat);
  bob.position.set(0, -L * 0.78, 0.001); pivot.add(bob);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.006, 16), new THREE.MeshStandardNodeMaterial({ color: 0xb8975a, roughness: 0.4, metalness: 0.6 }));
  cap.rotation.x = Math.PI / 2; cap.position.copy(pivot.position); hm.add(cap);

  const pend = new HeelPendulum();
  let prevT = null, acc = 1e9, lastMin = null, lastP = null;
  // by night (fix/helm-view-cockpit): the unlit faces held at their on-screen level and turned to the night set (nightLight.js);
  // the daylight's frame (src/daylight.js collects userData.daylight) sets them
  let night = false, gain = 1;
  const faces = [clock.face, baro.face, cardMesh];
  const DAY_EM = new THREE.Color(0x3a362e), NIGHT_EM = new THREE.Color(1, 0.36, 0.22).multiplyScalar(0.16);   // the night ink's glow at the face's gain
  function light(f = {}) {
    gain = faceGain(f); const k = nightK(f.elevDeg), n = k >= 0.5;
    for (const m of faces) m.material.color.setScalar(gain);
    needleMat.emissive.copy(DAY_EM).lerp(NIGHT_EM, k); needleMat.emissiveIntensity = Math.min(1, f.exposureComp ?? 1);
    needleMat.color.setHex(n ? 0x3a1a12 : 0xefe6d2);
    if (n !== night) { night = n; drawHeelCard(card.g, 256, 152, facePalette(night)); card.t.needsUpdate = true; lastMin = null; lastP = null; acc = 1e9; }
  }
  group.userData.daylight = light;
  const api = { group, update, light, pendulum: pend, needle: pivot, get reading() { return pend.a; }, get night() { return night; }, get gain() { return gain; }, pressure: null, hour: null };
  function update(state, t = performance.now() / 1000) {
    const dt = prevT == null ? 0 : t - prevT; prevT = t;
    // the needle hangs toward the low side: the hull frame's −y turned by +heel (the boat's Rz(−heel), undone)
    pivot.rotation.z = pend.step(state.heel ?? 0, dt);
    acc += Math.max(0, dt);
    if (acc < 1 / B.hz) return;
    acc = 0;
    const h = hour(), min = Math.floor(h * 60);
    api.hour = h;
    if (min !== lastMin) { lastMin = min; drawClock(clock.tex.g, 256, h, facePalette(night)); clock.tex.t.needsUpdate = true; }
    const p = pressureHPa(h, { seed, advisory });
    api.pressure = p;
    if (lastP == null || Math.abs(p - lastP) > 0.05) {
      lastP = p; drawBarometer(baro.tex.g, 256, p, pressureHPa(h - B.setHandH, { seed, advisory }), facePalette(night)); baro.tex.t.needsUpdate = true;
    }
  }
  return api;
}
