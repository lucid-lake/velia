// BACKLOG-v2 #20, the boat's own wind instruments: the jib's luff telltales, the main's leech telltales, the masthead
// wind vane. Every piece reads the physics (src/sim/boat.js: the bands' angles of attack,
// the stall, the apparent and true wind); nothing moves on its own clock except the cloth's flap, whose frequency rises
// with the wind. Pure JS, no GPU: v2/render/boat.js draws the lines as its rope ribbons (one more small buffer, RIG
// frame); the node tests call telltaleStates() and the vane's direction directly.
//   const d = createBoatDetails(rigPoints);   each frame: d.update(pose, t, sails) → d.lines (reused objects, no allocation)
//
// How real telltales read (and how these do):
//   jib luff, windward face: lifts and spins when the sail meets the wind at too small an angle: pinching (steering too
//     close to the wind) or the sheet eased too far. Here: the band's angle of attack under ≈ 6° (the luff starts at 1°).
//   jib luff, leeward face: droops, wanders and curls forward when the flow on the lee side separates: the sheet too
//     tight, or bearing away without easing. Here: the band's angle of attack past ≈ 13° (the physics' stall is 15–25°).
//   main leech: streams aft off the leech while the flow leaves it cleanly; curls round behind the sail (to leeward)
//     when the main is sheeted too hard (stalled). Here: the band's angle of attack past ≈ 14°; a luffing main flaps them.
// Colours: real telltales are often red (port) and green (starboard); Velia keeps red and green for port and starboard
// lights and marks only, so the yarns are dark navy (the jib's port face) and a dyed amber (its starboard face, and the
// leech): navy reads on the cream cloth and against the sky, amber on the cloth and over the navy lake behind the leech.
// Sizes: about 1.6 x a real 30-footer's (a 0.42 m luff yarn, 0.5 m leech ribbons, a 0.8 m vane), so they
// read at the follow camera's distance; the shapes and the motion stay real.
import { RIG } from '../../../src/boat/rig.js';

const DEG = Math.PI / 180;
import { clampT as clamp } from '../../../src/sim/core/math.js';
import { smooth } from '../../../src/sim/core/math.js';
const wrap = (a) => { a = (a + Math.PI) % (2 * Math.PI); return (a < 0 ? a + 2 * Math.PI : a) - Math.PI; };
const lin = (hex) => [16, 8, 0].map((s) => { const c = ((hex >> s) & 255) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

export const TELL = Object.freeze({
  // trim thresholds (degrees of the band's angle of attack): windward lifts below lift[1], fully at lift[0];
  // leeward stalls from lee[0] to lee[1]; the leech curls from curl[0] to curl[1]
  lift: [1, 6], lee: [13, 21], curl: [14, 21],
  jib: Object.freeze({ u: 0.15, v: [0.25, 0.5, 0.75], L: 0.42, diam: 0.045, off: 0.015 }),
  leech: Object.freeze({ v: RIG.battens.slice(-3), L: 0.5, diam: 0.05 }),
  vane: Object.freeze({ head: 0.36, tail: 0.42, fin: 0.16, tabs: 32, tabL: 0.26, omega: 5, zeta: 0.55 }),
  segs: 6,
  // owner (2026-11-16, "make them bigger"): a floor on screen, in CSS px at the boat's distance, for a 720 px tall view (scaled
  // by the view's CSS height / 720 within 0.75–1.5: 22.5 px long on an 844 x 390 phone, 45 px at 1080): each piece grows (length
  // and width together; the width also on its own, never under 3 px) until it meets its floor, up to `cap` x its size; close up
  // the floor is met already and nothing grows. The motion is the physics' at any size
  screen: Object.freeze({ yarnPx: 30, yarnWPx: 3.5, minWPx: 3, vanePx: 40, cap: 4.5, capW: 5 }),
  navy: lin(0x223F78), amber: lin(0xD99A2B), cream: lin(0xEFE6D2), graphite: lin(0x2A2D31),
});
// the cloth's flutter (boat.js CLOTH.flutter and its wave, the same as the GPU's): the yarns ride the cloth
const FLUTTER = 0.06;
const wave1 = (u, v, t) => { const T = 2 * Math.PI; return Math.sin((u * 2.2 - t * 3.1) * T + v * 5.0) * 0.6 + Math.sin((u * 3.7 - t * 4.3) * T + v * 2.0 + 1.3) * 0.4; };
const ampAt = (u, luff) => luff * (1 - smooth(0, 0.35, u)) * 0.6 + smooth(0.4, 1, luff) * (u * 0.7 + 0.3);

// --- the trim → the telltales (pure) ---
// aoa in radians, signed as the physics' (≥ 0 with the wind on the sail's right face); fill 0 luffing … 1 drawing
export function jibTell(aoa, backed = false) {
  if (backed) return { windward: 0.6, leeward: 0.6 };   // a backed jib has no clean flow either side
  const a = aoa / DEG;
  return { windward: 1 - smooth(TELL.lift[0], TELL.lift[1], a), leeward: smooth(TELL.lee[0], TELL.lee[1], a) };
}
export function leechTell(aoa, fill = 1) {
  const a = aoa / DEG, luffing = 1 - clamp(fill, 0, 1);
  return { curl: smooth(TELL.curl[0], TELL.curl[1], a) * (1 - smooth(0.3, 0.9, luffing)), flap: smooth(0.2, 0.9, luffing) };
}
// the three heights' states from a pose (the physics' bands: low, the whole sail, top); out reused
export function telltaleStates(p, out = { jib: [{}, {}, {}], leech: [{}, {}, {}] }) {
  const ja = [p.jibLowAoA ?? p.jibAoA ?? 0, p.jibAoA ?? 0, p.jibTopAoA ?? p.jibAoA ?? 0];
  const ma = [p.mainLowAoA ?? p.mainAoA ?? 0, p.mainAoA ?? 0, p.mainTopAoA ?? p.mainAoA ?? 0];
  const mf = [p.mainLowFill ?? p.mainFill ?? 1, p.mainFill ?? 1, p.mainTopFill ?? p.mainFill ?? 1];
  for (let i = 0; i < 3; i++) {
    const j = jibTell(ja[i], !!p.jibBacked), l = leechTell(ma[i], mf[i]);
    out.jib[i].windward = j.windward; out.jib[i].leeward = j.leeward; out.leech[i].curl = l.curl; out.leech[i].flap = l.flap;
  }
  return out;
}
// the vane's target: the apparent wind's angle (rad from the bow, + from starboard); the arrow points INTO the wind,
// along (sin θ, 0, −cos θ) in the boat frame (bow −z, starboard +x).
const vaneTarget = (p) => p.apparentWind?.angle ?? 0;

// --- the lines ---
const V3 = () => [0, 0, 0];
const line = (n, diam, color, taper = null) => ({ points: Array.from({ length: n }, V3), diameterM: -diam, d0: diam, taper, color, ...(taper ? { diams: Array.from({ length: n }, (_, i) => -diam * (taper[0] + (taper[1] - taper[0]) * i / (n - 1))) } : {}) });
// a line's width this frame (its own diameter × k; the taper kept)
const widen = (ln, k) => { const d = ln.d0 * k; ln.diameterM = -d; if (ln.diams) { const n = ln.diams.length, tp = ln.taper; for (let i = 0; i < n; i++) ln.diams[i] = -d * (tp[0] + (tp[1] - tp[0]) * i / (n - 1)); } };
// the growth to meet a floor of px on screen at ppm px a metre (1 … cap)
const growFor = (sizeM, px, ppm, cap) => (ppm > 0 ? clamp(px / (sizeM * ppm), 1, cap) : 1);   // − diameter: a detail line (boat.js: at least 2.2 px, opaque)
const set = (o, x, y, z) => { o[0] = x; o[1] = y; o[2] = z; return o; };
const norm = (o) => { const l = Math.hypot(o[0], o[1], o[2]) || 1; o[0] /= l; o[1] /= l; o[2] /= l; return o; };
const cross = (o, a, b) => set(o, a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]);

// rp: the rig's points in the RIG frame (src/boat/spars.js solveRig: S.mastTop, S.backstayPlate, points.crane)
export function createBoatDetails(rp) {
  const S = rp.S, N = TELL.segs + 1;
  const jibLines = [], leechLines = [];
  for (let i = 0; i < 3; i++) for (const face of [-1, 1]) jibLines.push({ ...line(N, TELL.jib.diam, face < 0 ? TELL.navy : TELL.amber, [1, 0.7]), face, h: i, phase: i * 1.7 + (face > 0 ? 0.9 : 0) });
  for (let i = 0; i < 3; i++) leechLines.push({ ...line(N, TELL.leech.diam, TELL.amber, [1, 0.7]), h: i, phase: i * 2.3 + 0.4 });
  // the Windex: on the stick's top (spars.js: the vane's stick from the masthead forward and up)
  const vaneAt = [0, S.mastTop + 0.42, -0.30];
  const spindle = line(2, 0.008, TELL.graphite), shaft = line(2, 0.018, TELL.graphite), head = line(2, 0.08, TELL.graphite, [0.1, 1]), fin = line(2, TELL.vane.fin, TELL.cream, [0.45, 1]);   // a cream fin: the masthead is seen against the lake and the shore from the follow camera
  const tabs = [line(2, 0.014, TELL.cream), line(2, 0.014, TELL.cream)];
  const vaneLines = [spindle, shaft, head, fin, tabs[0], tabs[1]];
  const lines = [];   // the active lines this frame, the jib's first (boat.js draws them again, faint, through the cloth)
  const st = telltaleStates({});
  const vane = { angle: 0, rate: 0, t: null };
  let jibCount = 0, nodeChord = 1;
  const grow = { yarn: 1, yarnW: 1, leech: 1, leechW: 1, vane: 1 };
  const A = V3(), Nn = V3(), B = V3(), D = V3(), down = V3(), R = V3();

  // one yarn: from root r, flowing along a (unit), off-surface n (unit), length L. lift: rad off the surface by the
  // tip; yaw: rad of wander in the surface; curl: rad turned back past the normal; flap: the travelling wave's amplitude
  // (fraction of L); hang: 0..1 how much it falls to gravity; f the flap's frequency, Hz
  function yarn(out, r, a, n, L, { lift = 0, yaw = 0, flap = 0.05, hang = 0, f = 2, phase = 0, t = 0 }) {
    cross(B, n, a);
    const pts = out.points, k = 2 * Math.PI / (0.6 * L), ds = L / (pts.length - 1);
    let x = r[0], y = r[1], z = r[2];
    set(pts[0], x, y, z);
    for (let i = 1; i < pts.length; i++) {
      const s = i / (pts.length - 1);
      const ph = lift * s, yw = yaw * s;
      const c = Math.cos(ph), sp = Math.sin(ph), cy = Math.cos(yw), sy = Math.sin(yw);
      D[0] = a[0] * c * cy + n[0] * sp + B[0] * c * sy; D[1] = a[1] * c * cy + n[1] * sp + B[1] * c * sy; D[2] = a[2] * c * cy + n[2] * sp + B[2] * c * sy;
      const g = hang * s; D[0] += down[0] * g; D[1] += down[1] * g; D[2] += down[2] * g; norm(D);
      x += D[0] * ds; y += D[1] * ds; z += D[2] * ds;
      const w = Math.sin(k * s * L - 2 * Math.PI * f * t + phase) * flap * L * s;
      set(pts[i], x + n[0] * w, y + n[1] * w, z + n[2] * w);
    }
  }
  // a grid node of a filled sail (boat/mesh.js fillSail) with the cloth's flutter as the GPU draws it
  function node(sl, u, v, t, face, off) {
    const g = sl.g, i = Math.round(u * g.nu), j = Math.round(v * g.nv), k = j * (g.nu + 1) + i;
    const uu = i / g.nu, vv = j / g.nv;
    const luff = sl.luff + (sl.luffTop - sl.luff) * smooth(0.3, 0.75, vv);
    const chord = Math.max(g.metric[2 * k] / Math.max(uu, 1e-3), 0.05); nodeChord = chord;
    const d = ampAt(uu, luff) * FLUTTER * chord * wave1(uu, vv, t);
    set(Nn, g.normal[3 * k], g.normal[3 * k + 1], g.normal[3 * k + 2]);
    const fs = face * (Math.sign(Nn[0]) || 1);   // face: +1 starboard, −1 port (the grid's normal's own side varies)
    set(R, g.position[3 * k] + Nn[0] * (d + fs * off), g.position[3 * k + 1] + Nn[1] * (d + fs * off), g.position[3 * k + 2] + Nn[2] * (d + fs * off));
    Nn[0] *= fs; Nn[1] *= fs; Nn[2] *= fs;   // now toward the face's side
    set(A, g.tanU[3 * k], g.tanU[3 * k + 1], g.tanU[3 * k + 2]);
    return R;
  }

  return {
    lines, TELL, vaneAt,
    get jibLines() { return jibCount; },   // the first n of `lines` are the jib's (the through-the-cloth pass)
    get states() { return st; },
    get vaneAngle() { return vane.angle; },
    get grow() { return grow; },   // this frame's growth of each piece (1: its own size)
    // pose: the physics' pose (its trim, winds, heel); t the sim time (s); sails: { jib, main } each { g, luff, luffTop, shown }
    // ppm: CSS px a metre at the boat's distance (0: no floor, the pieces at their own size)
    // viewH: the view's CSS height (the floors' scale)
    update(p, t, sails, { instant = false, ppm = 0, viewH = 720 } = {}) {
      const SC = TELL.screen, vs = clamp(viewH / 720, 0.75, 1.5), wPx = Math.max(SC.minWPx, SC.yarnWPx * vs);
      grow.yarn = growFor(TELL.jib.L, SC.yarnPx * vs, ppm, SC.cap); grow.yarnW = Math.max(grow.yarn, growFor(TELL.jib.diam, wPx, ppm, SC.capW));
      grow.leech = growFor(TELL.leech.L, SC.yarnPx * vs, ppm, SC.cap); grow.leechW = Math.max(grow.leech, growFor(TELL.leech.diam, wPx, ppm, SC.capW));
      grow.vane = growFor(TELL.vane.head + TELL.vane.tail, SC.vanePx * vs, ppm, SC.cap);
      telltaleStates(p, st);
      const wild = p.kdWild > 0 ? Math.min(1, p.kdWild) : 0;   // K2 (v2/sim/knockdownFx.js): knocked down, every yarn flies and the vane spins wild
      if (wild > 0) for (const g of [st.jib, st.leech]) for (const x of g) { if ('windward' in x) { x.windward = Math.max(x.windward, wild); x.leeward = Math.max(x.leeward, wild); } if ('flap' in x) x.flap = Math.max(x.flap, wild); }
      lines.length = 0; jibCount = 0;
      const heel = p.heel ?? 0, pitch = p.pitch ?? 0;
      set(down, Math.sin(heel) * Math.cos(pitch), -Math.cos(heel) * Math.cos(pitch), Math.sin(pitch));   // the world's down in the rig frame (boat.js Mroot)
      const aws = p.apparentWind?.speed ?? 0;
      const fA = 0.9 + 0.55 * aws, flyA = clamp(aws / 2.5, 0, 1);
      const hangCalm = clamp(2.3 / (aws * aws + 2.3), 0, 1);   // v1's streamer: tan(droop) = 2.3 / v²
      // which face is to leeward: the clew's side (+ starboard); a centred clew, away from the wind
      const lee = Math.sign(p.jibAngle ?? 0) || -Math.sign(p.apparentWind?.angle ?? 1) || 1;
      if (sails.jib?.shown) {
        for (const ln of jibLines) {
          const s = st.jib[ln.h], windward = ln.face !== lee;
          const r = node(sails.jib, TELL.jib.u, TELL.jib.v[ln.h], t, ln.face, TELL.jib.off);
          const k = windward ? s.windward : s.leeward;
          const wan = Math.sin(2 * Math.PI * 0.7 * t + ln.phase * 3.1) * 1.2 + Math.sin(2 * Math.PI * 1.9 * t + ln.phase) * 0.6;
          widen(ln, grow.yarnW);
          // grown, a yarn still ends on its cloth: at most 60 % of the chord aft of it (a 1.4 m yarn on the jib's narrow head ran
          // past the leech and hung in the air beside the main)
          const Lj = Math.min(TELL.jib.L * grow.yarn, Math.max(TELL.jib.L, 0.6 * (1 - TELL.jib.u) * nodeChord));
          yarn(ln, r, A, Nn, Lj, windward
            ? { lift: k * 1.5, yaw: k * wan * 0.9, flap: 0.03 + 0.14 * k, hang: hangCalm * (1 - k) * 0.8, f: fA, phase: ln.phase, t }
            : { lift: k * (0.5 + 0.9 * smooth(0.6, 1, k)), yaw: k * wan * 1.1 - k * 0.6, flap: 0.03 + 0.1 * k, hang: Math.max(hangCalm, 0.75 * k), f: fA * (1 - 0.5 * k), phase: ln.phase, t });
          lines.push(ln); jibCount++;
        }
      }
      if (sails.main?.shown) {
        for (const ln of leechLines) {
          const s = st.leech[ln.h];
          const r = node(sails.main, 1, TELL.leech.v[ln.h], t, lee, 0.004);   // Nn: toward the lee side
          const wan = Math.sin(2 * Math.PI * 0.8 * t + ln.phase * 2.7) + 0.5 * Math.sin(2 * Math.PI * 2.1 * t + ln.phase);
          // curled: round behind the sail to leeward and back toward the luff (lift past 90°)
          widen(ln, grow.leechW);
          yarn(ln, r, A, Nn, TELL.leech.L * grow.leech, { lift: s.curl * 2.3, yaw: (s.curl * 0.5 + s.flap * 0.9) * wan, flap: 0.04 + 0.08 * s.curl + 0.12 * s.flap, hang: hangCalm * (1 - s.curl) * 0.8 * flyA + (1 - flyA) * 0.6, f: fA, phase: ln.phase, t });
          lines.push(ln);
        }
      }
      // the vane: a damped turn toward the apparent wind (a vane's own inertia and the bearing's friction)
      const target = vaneTarget(p) + (wild > 0 ? wild * (1.4 * Math.sin(2 * Math.PI * 0.9 * t) + 0.8 * Math.sin(2 * Math.PI * 2.3 * t + 1.7)) : 0);   // K2: the air over a rig on its side swirls
      if (instant || vane.t == null || !(t - vane.t >= 0) || t - vane.t > 0.5) { vane.angle = target; vane.rate = 0; }
      else {
        const { omega: w, zeta: z } = TELL.vane;
        let dt = t - vane.t;
        while (dt > 1e-6) { const h = Math.min(dt, 1 / 120); vane.rate += (w * w * wrap(target - vane.angle) - 2 * z * w * vane.rate) * h; vane.angle = wrap(vane.angle + vane.rate * h); dt -= h; }
      }
      vane.t = t;
      const G = grow.vane, dx = Math.sin(vane.angle), dz = -Math.cos(vane.angle), V = vaneAt, VH = TELL.vane.head * G, VT = TELL.vane.tail * G;
      const py = V[1] + 0.06 * G;
      for (const ln of vaneLines) widen(ln, G);
      set(spindle.points[0], V[0], V[1], V[2]); set(spindle.points[1], V[0], py + 0.01, V[2]);
      set(shaft.points[0], V[0] + dx * VH, py, V[2] + dz * VH); set(shaft.points[1], V[0] - dx * VT, py, V[2] - dz * VT);
      set(head.points[0], V[0] + dx * VH, py, V[2] + dz * VH); set(head.points[1], V[0] + dx * (VH - 0.1 * G), py, V[2] + dz * (VH - 0.1 * G));
      set(fin.points[0], V[0] - dx * (VT - 0.2 * G), py + 0.05 * G, V[2] - dz * (VT - 0.2 * G)); set(fin.points[1], V[0] - dx * VT, py + 0.05 * G, V[2] - dz * VT);
      for (let i = 0; i < 2; i++) {   // the reference tabs, aft at ± the close-hauled angle: the tail lines up with one on the wind
        const a = (i ? 1 : -1) * TELL.vane.tabs * DEG;
        set(tabs[i].points[0], V[0], V[1] + 0.02 * G, V[2]); set(tabs[i].points[1], V[0] + Math.sin(a) * TELL.vane.tabL * G, V[1] + 0.02 * G, V[2] + Math.cos(a) * TELL.vane.tabL * G);
      }
      lines.push(spindle, tabs[0], tabs[1], shaft, head, fin);
      return lines;
    },
  };
}
