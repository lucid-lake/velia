// The gennaker drawn: a shaped cloth mesh on the sails' own cloth shader (render/boat.js CLOTH_WGSL, kind 2: navy
// body, a cream head, one brass stripe), its steady shape filled on the CPU when the physics' gennaker moves (as the main and the
// jib: mesh.js fillSail), the flutter on the GPU. Not a cloth simulation: the shape is the physics' (the hoist, the fill, the clew's
// side and its chord), so it never disagrees with what the boat feels. Plain JS (node tests read it: v2/tests/gennaker.test.mjs).
//   gkDesc(state) → null (never hoisted, or down and stowed) | { deploy, sock, lift, roll, fill, angle, side, bang }
//   round 2 (owner, 2026-11-21: "the swap must be visible"): sock 0 … 1 the sock's tube climbing from the tack to the masthead, lift
//   0 … 1 the sock riding up off the sail from the foot (the freed cloth fills below it); the jib's roll is rig.js's furl (gk.jibFurl)
//   gennakerPoint(u, v, d, t, out) → [x, y, z] in the RIG frame (x starboard, y up from the mast step, z aft), u luff → leech,
//   v foot → head
//   gkClew(d) → the clew's point (the sheet's end); GK_GRID: the cloth grids by the gennakerCloth policy (src/core/features.js)
import { RIG, camber } from '../../../src/boat/rig.js';

import { clampT as clamp } from '../../../src/sim/core/math.js';
import { lerp } from '../../../src/sim/core/math.js';
export const GK_GRID = Object.freeze({ full: [28, 48], lite: [14, 24] });
// the corners in the RIG frame: the tack on a short tack line 0.55 m forward of the furler, the head on a crane at the masthead [est]
export const GK_DRAW = Object.freeze({
  tack: [0, RIG.tack[1] + 0.22, RIG.tack[2] - 0.55], head: [0, RIG.head[1] - 0.05, RIG.head[2] - 0.2],
  foot: 5.5, clewRise: 1.8, depth: 0.27, luffBow: 1.3, leechBow: 2.0, chordK: 0.75, sockW: 0.34, sockUp: 0.6,   // sockW: the sock's tube (m across; round 2 draws it as a rounded ribbon)
});

export function gkDesc(state) {
  const g = state?.gk;
  if (!g || !(g.deploy > 0.002)) return null;
  const d = { deploy: g.deploy, fill: clamp(g.fill, 0, 1), angle: g.angle ?? 0, side: clamp(g.side ?? 1, -1, 1), bang: g.bang ?? 0 };
  d.sock = gkSock(g); d.lift = gkOpen(g); d.roll = clamp(g.roll ?? g.jibFurl ?? 0, 0, 1);
  return d;
}
// the sock's height (0 … 1) and the sail's freed share (0 … 1); a descriptor without the phases (before round 2) reads deploy
const gkSock = (d) => clamp(d.sock ?? (d.deploy ?? 0) / GK_DRAW.sockUp, 0, 1);
const gkOpen = (d) => clamp(d.lift ?? ((d.deploy ?? 0) - GK_DRAW.sockUp) / (1 - GK_DRAW.sockUp), 0, 1);

const T = GK_DRAW.tack, Hd = GK_DRAW.head;
// the clew: foot metres from the tack along the chord's drawn angle (side × θ off the centreline, aft), lifted clewRise; collapsed it
// falls in toward the forestay and down. Mid-gybe (|side| < 1) it swings round in front of the forestay.
export function gkClew(d, out = [0, 0, 0]) {
  const sx = d.side, s = Math.sign(sx) || 1, th = GK_DRAW.chordK * Math.abs(d.angle);
  const round = 1 - Math.abs(sx);                                   // 0 settled … 1 crossing the bow
  const f = 0.45 + 0.55 * d.fill, F = GK_DRAW.foot * f;
  out[0] = T[0] + F * Math.sin(th) * sx;
  out[1] = T[1] + GK_DRAW.clewRise * (0.35 + 0.65 * d.fill);
  out[2] = T[2] + F * Math.cos(th) * (1 - 2.2 * round) - 0.8 * round;   // round the front of the forestay
  if (!Number.isFinite(out[0])) out[0] = s * 0.1;
  // in the sock the clew is held in the tube just above the tack
  const o = gkOpen(d);
  if (o < 1) { out[0] = lerp(T[0] + s * 0.05, out[0], o); out[1] = lerp(T[1] + 0.35, out[1], o); out[2] = lerp(T[2] + 0.05, out[2], o); }
  return out;
}

const C = [0, 0, 0];
export function gennakerPoint(u, v, d, t, out = [0, 0, 0]) {
  const up = gkSock(d), open = gkOpen(d);   // the sock climbs first (up), then rides up off the sail from the foot (open)
  const s = Math.sign(d.side) || 1, fill = d.fill * open;
  gkClew(d, C);
  // the head's height with the hoist; the row's height on the luff
  const hy = lerp(T[1] + 0.4, Hd[1], up), hz = lerp(T[2], Hd[2], up);
  const vy = v;
  const Lx = T[0], Ly = lerp(T[1], hy, vy), Lz = lerp(T[2], hz, vy);
  // the luff bows to leeward and forward as the sail fills (an asymmetric's luff is free: only its ends are held)
  const inSock = vy > open + 1e-6;   // the rows still in the sock (it rides up from the foot)
  const bow = Math.sin(Math.PI * vy) * GK_DRAW.luffBow * (0.25 + 0.75 * fill) * (inSock ? 0.25 : 1);
  // deep (the chord past 80°: a run) the free luff rotates round to windward of the forestay, as an asymmetric's does without a pole
  const deep = clamp((Math.abs(d.angle) - 80 * Math.PI / 180) / (20 * Math.PI / 180), 0, 1);
  const lx = Lx + s * bow * (1 - 1.6 * deep), ly = Ly, lz = Lz - 0.5 * bow;
  // in the sock: a slim tube along the luff, the ribbon sockW across (aft), rounded out to both sides by u so it reads as a tube
  if (inSock) {
    const a = Math.PI * u, r = GK_DRAW.sockW * 0.5;
    out[0] = lx + s * r * Math.sin(a) * 0.9; out[1] = ly; out[2] = lz + r * (1 - Math.cos(a));
    return out;
  }
  // the leech: clew → head, bowed out and aft (the rows below the sock: the freed cloth)
  const ev = Math.pow(vy, 0.9);
  let rx = lerp(C[0], Hd[0], ev), ry = lerp(C[1], hy, ev), rz = lerp(C[2], hz, ev);
  const lb = Math.sin(Math.PI * vy) * GK_DRAW.leechBow * fill;
  rx += s * lb; rz += lb * 0.4;
  ry -= (1 - fill) * 1.2 * Math.sin(Math.PI * vy) * open;               // a collapsed leech droops
  // along the chord, with the camber to leeward (horizontal, ⟂ to the chord), deep when full; the bang overshoots it a little
  const cx = rx - lx, cz = rz - lz, cl = Math.hypot(cx, cz) || 1e-6;
  const nxS = cz / cl * s, nzS = -cx / cl * s;                           // to leeward of the chord (the chord runs aft: x to side s)
  const depth = GK_DRAW.depth * Math.hypot(cx, ry - ly, cz) * (0.08 + 0.92 * fill) * (1 + 0.1 * d.bang);
  const off = depth * camber(u);
  out[0] = lerp(lx, rx, u) + nxS * off;
  out[1] = lerp(ly, ry, u) + off * 0.15;
  out[2] = lerp(lz, rz, u) + nzS * off;
  return out;
}
