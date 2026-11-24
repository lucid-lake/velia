// The asymmetric cruising gennaker (BACKLOG "Later play: spinnaker"): the downwind sail, tacked at the bow with
// no pole, its sheet led to the quarter. Plain JS, no DOM: src/sim/boat.js steps it inside the sloop's tick (only once the
// sail has been asked for: a boat that never hoists it keeps every byte of her ticks and snapshots), the v2 cloth
// (v2/render/boat/gennaker.js), the sound (src/boatAudio.js) and the controls read its state. v2/tests/gennaker.test.mjs.
//
//   const G = createGennaker();                       // plain data (the snapshot keeps it)
//   stepGennaker(G, { want, dt, t, awa, va, err })   // the hoist, the clew's side, the fill and the bang; → G
//   gkCoef(awa) → [CL, CD]                           // the sail trimmed to its best for that apparent wind angle (rad, |awa|)
//
// The model:
// - Hoist and douse, in visible phases (round 2, owner 2026-11-21: "the swap must be visible, not a flash"): (a) the sail goes up
//   in its sock while the jib still draws (G.sock 0 → 1 over sockS: a slim tube from the bow to the masthead), (b) the jib rolls
//   away on its furler (G.roll 0 → 1 over rollS: the jib's area, and its force, shrink from the leech), (c) the sock lifts (G.lift
//   0 → 1 over liftS) and the sail fills with the bang. The douse runs it backwards: the sock comes down over the sail (snuffS: it
//   collapses), the jib unrolls (unrollS), the sock is lowered (lowerS). A change of mind mid-way runs from where it is. G.deploy is
//   the whole hoist's share (0 … 1, by time); hoistS and douseS are the totals.
// - The window: the sail flies from an apparent wind angle of awaFly[0] (its luff collapses forward of it) to awaFly[1]; deeper
//   than awaBlanket[0] the main blankets it, gone by awaBlanket[1] (it collapses). Forward of the window it still draws, and
//   its side force is large: in a breeze it heels her and rounds her up (the hull's own physics: src/sim/boat.js).
// - The trim: err (rad, + = the sheet eased past its best, − = over-trimmed): eased, the luff curls and the sail collapses
//   (trimCurl); over-trimmed, it stalls: less drive, more heel (overStall).
// - Collapse and refill: the fill falls fast (collapseTau) when the target drops; a collapsed sail waits refillS once the
//   target is back, then snaps full (snapTau): the cloth goes from slack to full in ≈ 0.3 s. Each refill from under bangLow to
//   over bangHigh is a bang (G.bangs counts them; G.bang 1 → 0 over bangS for the cloth's overshoot and the sound).
// - The gybe: the clew flies round the forestay to the new leeward side over gybeS (G.sx −1 port … +1 starboard); the sail is
//   collapsed while it crosses and refills (a bang) on the new side.
// Speeds m/s, angles rad, forces N. Cheat on timing (the hoist is ≈ 4 × quicker than a real crew's), never on motion: the
// sail's forces go through the boat's own equations of motion.

const DEG = Math.PI / 180;
import { clampT as clamp } from '../core/math.js';
import { smooth } from '../core/math.js';

// Size: a C28 standard rig's asymmetric, 500 ft² (46.5 m²; luff 37 ft, foot 18 ft, leech 34.5 ft: goodoldboat.com sail data,
// read 2026-11-21); a cruising cut a little smaller: 46 m² (495 ft²), 2.3 × the foretriangle (I·J/2 = 18.4 m²).
// ceZ, ceX: the centre of effort above the water and forward of the waterline's centre (the tack 0.5 m forward of the stem
// fitting on a short tack line; the CE ≈ 40 % up the luff, a third back along the foot) [est].
export const GENNAKER = Object.freeze({
  areaM2: 46, luffM: 11.3, footM: 5.5, leechM: 10.5, ceZ: 5.4, ceX: 2.0,
  sockS: 4, rollS: 3, liftS: 1, snuffS: 1.5, unrollS: 3, lowerS: 2.5,   // the phases (s); hoistS 8, douseS 7 below
  awaFly: [48 * DEG, 62 * DEG], awaBlanket: [142 * DEG, 158 * DEG],
  minVa: 1.5,                                   // m/s apparent: under it the cloth hangs (no fill)
  collapseTau: 0.3, refillS: 0.35, snapTau: 0.1, fillTau: 0.6,
  bangLow: 0.35, bangHigh: 0.85, bangS: 0.8,
  gybeS: 2.2,
  trimCurl: [8 * DEG, 24 * DEG],                // eased past its best: the luff curls from 8°, gone by 24°
  overStall: [0, 20 * DEG], stallCl: 0.45, stallCd: 0.6,
  crewSpill: 22 * DEG,                          // the crew's ease in a hard heel (autoTrim): up to this far past its best
  flogCd: 0.25,                                 // a collapsed sail's flogging drag (× its area, along the air)
  clScale: 1.2,                                 // the polar's tune (the gains by wind)
  get hoistS() { return this.sockS + this.rollS + this.liftS; },
  get douseS() { return this.snuffS + this.unrollS + this.lowerS; },
});

// The coefficients of an asymmetric spinnaker trimmed to its best, by apparent wind angle (deg): the shape of the ORC VPP's
// asymmetric-spinnaker table (lift high from a close reach to the beam, drag rising toward the run) [est,]
const COEF = [[30, 0, 0.05], [45, 0.35, 0.10], [60, 0.95, 0.20], [75, 1.10, 0.32], [90, 1.10, 0.47], [105, 1.02, 0.62],
  [120, 0.88, 0.75], [135, 0.68, 0.85], [150, 0.44, 0.92], [165, 0.2, 0.95], [180, 0, 0.95]];
export function gkCoef(awa) {
  const d = clamp(Math.abs(awa) / DEG, 30, 180);
  let i = 0; while (i < COEF.length - 2 && COEF[i + 1][0] < d) i++;
  const [d0, l0, c0] = COEF[i], [d1, l1, c1] = COEF[i + 1], f = (d - d0) / (d1 - d0);
  return [(l0 + (l1 - l0) * f) * GENNAKER.clScale, c0 + (c1 - c0) * f];
}

// the window's share (0 … 1) at an apparent wind angle (|awa| rad)
export const gkWindow = (awa, K = GENNAKER) => smooth(K.awaFly[0], K.awaFly[1], Math.abs(awa)) * (1 - smooth(K.awaBlanket[0], K.awaBlanket[1], Math.abs(awa)));
// the trim's share: eased past its best the luff curls (err > 0)
const gkCurl = (err, K = GENNAKER) => 1 - smooth(K.trimCurl[0], K.trimCurl[1], err);
// over-trimmed (err < 0): 0 … 1 of the stall
export const gkStall = (err, K = GENNAKER) => smooth(K.overStall[0], K.overStall[1], -err);
// the drawn chord's angle off the centreline (rad, unsigned) for an apparent wind angle and the trim: out with the wind
export const gkChord = (awa, err = 0) => clamp(0.72 * Math.abs(awa) - 8 * DEG + 0.8 * err, 14 * DEG, 104 * DEG);

export function createGennaker() {
  return { deploy: 0, sock: 0, roll: 0, lift: 0, phase: 'stowed', want: false, sx: 0, side: 0, fill: 0, target: 0, wait: 0, minFill: 0, bangs: 0, bang: 0, bangT: -1, gybing: false };
}

// the hoist's phases (a snapshot from before round 2 has only deploy: read as the old single ramp, the sock first)
function stepPhases(G, want, dt, K) {
  if (G.sock == null) { const d = G.deploy ?? 0; G.sock = d > 0 ? 1 : 0; G.roll = d; G.lift = d >= 0.999 ? 1 : 0; }
  const up = (f, T, r) => { if (r <= 0 || G[f] >= 1) return r; const use = Math.min(r, (1 - G[f]) * T); G[f] = use >= (1 - G[f]) * T - 1e-9 ? 1 : G[f] + use / T; return r - use; };
  const down = (f, T, r) => { if (r <= 0 || G[f] <= 0) return r; const use = Math.min(r, G[f] * T); G[f] = use >= G[f] * T - 1e-9 ? 0 : G[f] - use / T; return r - use; };
  if (want) up('lift', K.liftS, up('roll', K.rollS, up('sock', K.sockS, dt)));
  else down('sock', K.lowerS, down('roll', K.unrollS, down('lift', K.snuffS, dt)));
  G.deploy = (G.sock * K.sockS + G.roll * K.rollS + G.lift * K.liftS) / K.hoistS;
  G.phase = gkPhase(G);
}
// the phase's name: stowed | sock (the sock going up or down, the jib set) | roll (the jib rolling away or out) | lift (the sock
// lifting off the sail or coming down over it) | flying
export function gkPhase(G) {
  if (!(G.sock > 0)) return 'stowed';
  if (G.lift >= 1) return 'flying';
  if (G.lift > 0) return 'lift';
  if (G.roll > 0) return 'roll';
  return 'sock';
}

// one tick: want (the sail asked up), dt s, t s (the sim clock), awa rad (+ = from starboard: its sign picks the leeward side),
// va m/s (apparent at the sail), err rad (the sheet past its best). → G (its fields updated)
export function stepGennaker(G, { want, dt, t = 0, awa, va, err = 0 }, K = GENNAKER) {
  G.want = !!want;
  stepPhases(G, !!want, dt, K);
  // the clew's side: to leeward (−sign of the wind's side); dead downwind (within 10° of the stern) it stays where it is
  const lee = awa < 0 ? 1 : -1;
  if (G.side === 0) { G.side = lee; G.sx = lee; }
  else if (lee !== G.side && Math.abs(awa) < Math.PI - 10 * DEG) G.side = lee;
  const step = (2 / K.gybeS) * dt;
  G.sx = clamp(G.sx + clamp(G.side - G.sx, -step, step), -1, 1);
  G.gybing = Math.abs(G.sx - G.side) > 0.05;
  // the target fill: the sock lifted, the window, the trim, the clew settled on its side, air to fill it
  const up = G.lift >= 0.999 ? 1 : 0;
  const tgt = up * gkWindow(awa, K) * gkCurl(err, K) * (G.gybing ? 0 : 1) * smooth(K.minVa, K.minVa + 1, va);
  G.target = tgt;
  if (tgt < G.fill) { G.fill += (tgt - G.fill) * (1 - Math.exp(-dt / K.collapseTau)); G.wait = 0; }
  else if (G.fill < 0.5 && tgt > 0.6) {
    // collapsed and the wind back: a beat of slack, then the snap
    G.wait += dt;
    if (G.wait >= K.refillS) G.fill += (tgt - G.fill) * (1 - Math.exp(-dt / K.snapTau));
  } else {
    G.fill += (tgt - G.fill) * (1 - Math.exp(-dt / (G.fill >= 0.5 ? K.snapTau : K.fillTau)));
    if (G.fill >= 0.5) G.wait = 0;
  }
  if (G.sock === 0) { G.fill = 0; G.sx = G.side; }
  // the bang: a refill from slack to full
  const prevMin = G.minFill;
  G.minFill = Math.min(G.minFill, G.fill);
  if (G.fill >= K.bangHigh) {
    if (prevMin < K.bangLow) { G.bangs++; G.bang = 1; G.bangT = t; }
    G.minFill = G.fill;
  }
  G.bang = Math.max(0, G.bang - dt / K.bangS);
  return G;
}
