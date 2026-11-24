// The thrills the physics already makes, read back as cues (owner, 2026-10-29: "real sailing thrills through the body:
// heel, surge, spray, sound, risk"). Plain JS, no three.js, no Web Audio: the sound (src/boatAudio.js), the spray
// (src/boat/spray.js), the camera and the hints read these; tests/thrill.test.mjs drives them.
//
//   surfCue   0..1: the boat riding a wave's forward face above hull speed (the waves' surge, src/boat.js § 6b)
//   slamCue   a slam event when the bow plunges into a face faster than Ochi's threshold (src/boat/float.js bowRelVel)
//   railCue   0..1: the lee rail in the water (the heel past the deck edge's immersion angle)
//   RoundUp   a round-up detector: a hard luff (the yaw toward the wind) at a big heel, until the boat is back on its feet
//
// Frames and signs as src/boat.js. Speeds m/s, angles rad.
import { clamp01 } from '../core/math.js';

const DEG = Math.PI / 180, G = 9.81;
import { smooth } from '../core/math.js';
const LWL = 7.26;   // m (src/boat/dims.js HULL.lwl; kept local so this module stays dependency-free)

// Surfing: the wave pushes the boat forward (the surge share of the hull's resistance) while the boat runs past hull
// speed (Fn 0.40, 6.5 kn for the 7.26 m waterline; the wave-making wall rises from there, src/boat.js hullResistance).
// fn: the Froude numbers where the cue fades in; push: the waves' surge over the hull's resistance where it fades in.
// attackS / releaseS: the cue's own smoothing (the burst swells in fast, the drop off the back is slower).
export const SURF = { fn: [0.385, 0.425], push: [0.05, 0.35], attackS: 0.45, releaseS: 0.7, on: 0.5, off: 0.25 };
export class surfCue {
  constructor() { this.v = 0; }
  update(dt, s) {
    const fn = Math.abs(s.u ?? 0) / Math.sqrt(G * LWL);
    const share = (s.waveSurge ?? 0) / Math.max(200, s.hullRes ?? 0);
    const raw = smooth(SURF.fn[0], SURF.fn[1], fn) * smooth(SURF.push[0], SURF.push[1], share);
    const tau = raw > this.v ? SURF.attackS : SURF.releaseS;
    this.v += (raw - this.v) * (1 - Math.exp(-dt / tau));
    return this.v;
  }
}

// The lee rail: its height over the still water amidships, freeboard·cos φ − ½·beam·sin φ (the C28's sheer 0.95 m
// [est] over a 1.575 m half-beam: the rail meets the water at 31°, within 0.2 m of it from 25°). railCue 0..1: from
// RAIL.nearM of clearance to the rail awash.
const RAIL = { freeboard: 0.95, halfBeam: 1.575, nearM: 0.25 };
export const railClearance = (heel) => RAIL.freeboard * Math.cos(heel) - RAIL.halfBeam * Math.sin(Math.abs(heel));
export const railCue = (s) => 1 - smooth(0, RAIL.nearM, railClearance(s.heel ?? 0));

// The round-up: a gust over a pressed boat (heel past ROUND.heel) swings its bow toward the wind faster than
// ROUND.yawDegS (the weather helm beating the rudder, src/boat.js § 8); it lasts until the boat is back on its feet
// (heel under ROUND.backHeel and the swing over, for ROUND.backS) or ROUND.maxS. update → { level 0..1, onset }.
export const ROUND = { heel: 26 * DEG, yawDegS: 3, backHeel: 18 * DEG, backS: 1, maxS: 20, attackS: 0.1, releaseS: 1.2 };
export class RoundUp {
  constructor() { this.active = false; this.t = 0; this.calm = 0; this.v = 0; }
  update(dt, s) {
    const toWind = Math.sign(s.trueWind?.angle ?? 0) * (s.yawRate ?? 0) / DEG;   // °/s, + = the bow swinging up
    let onset = false;
    if (!this.active && Math.abs(s.heel ?? 0) > ROUND.heel && toWind > ROUND.yawDegS) { this.active = true; this.t = 0; this.calm = 0; onset = true; }
    else if (this.active) {
      this.t += dt;
      this.calm = Math.abs(s.heel ?? 0) < ROUND.backHeel && toWind < 1 ? this.calm + dt : 0;
      if (this.calm >= ROUND.backS || this.t > ROUND.maxS) this.active = false;
    }
    const tau = this.active ? ROUND.attackS : ROUND.releaseS;
    this.v += ((this.active ? 1 : 0) - this.v) * (1 - Math.exp(-dt / tau));
    return { level: this.v, onset, active: this.active };
  }
}

// Slamming (Ochi 1964): the bow meets the water at a relative velocity past 0.093·√(g·L) (0.78 m/s for the 7.26 m
// waterline), with way on. slamLevel 0..1 from 0.6× to 1.6× the threshold (the spray sheet and the thud).
export const SLAM = { v0: 0.093 * Math.sqrt(G * LWL), lo: 0.6, hi: 1.6, minU: 1.5 };
export const slamLevel = (relVel, u) => smooth(SLAM.lo * SLAM.v0, SLAM.hi * SLAM.v0, relVel) * smooth(SLAM.minU, SLAM.minU + 1, u);
