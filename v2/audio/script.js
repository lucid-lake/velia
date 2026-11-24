// A scripted sail for the beds' offline checks (the 60 s WAV test, the owner's A/B clips): the sim state BedsMix reads, frame
// by frame, from a fixed script. Deterministic (a seeded curve for the gusts and the waves). Not the physics: the shapes and
// ranges are v1's sloop's (a C28 at Tahoe: hull speed ≈ 7 kn, the sails' force ≈ 18 N per (m/s)² full, heel 15–25° in a gust).
//   0–8 s     calm: 3 m/s, ghosting at 0.5 → 2 kn (the still lap, the chuckle)
//   8–24 s    the breeze fills and gusts: 7 → 11 m/s, 4 → 6.5 kn, heel to 22°, chop at the bow (the rush, the slaps, the load)
//   24–32 s   a tack: the bow through the wind 26–28 s (both sails luff and flog), the new side fills (the snaps), 5.5 → 3 → 5 kn
//   32–44 s   luffing: the main eased past its trim on a reach (the flutter), then trimmed in on the winch (the clicks)
//   44–60 s   rain sets in under a darker 9 m/s wind (the rain on the water and on the deck)
//   sailScript(t) → BedsMix input;  frames(seconds, fps) → [input, …]
import { rng } from './noise.js';

const DEG = Math.PI / 180, KN = 0.514444;
import { clamp01 } from '../../src/sim/core/math.js';
const sm = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
import { lerp } from '../../src/sim/core/math.js';

// a smooth seeded curve, unit-ish amplitude, `hz` wiggles a second
function curve(seed, hz) {
  const r = rng(seed), nodes = Array.from({ length: 512 }, () => r() * 2 - 1);
  return (t) => { const x = t * hz, k = Math.floor(x), f = x - k, u = f * f * (3 - 2 * f); const a = nodes[((k % 512) + 512) % 512], b = nodes[(((k + 1) % 512) + 512) % 512]; return a + (b - a) * u; };
}
const gustC = curve(11, 0.35), gustF = curve(12, 1.3), wave1 = curve(13, 0.55), wave2 = curve(14, 0.9);

export const PHASES = { calm: [0, 8], gusty: [8, 24], tack: [24, 32], luff: [32, 44], rain: [44, 60] };

export function sailScript(t) {
  // the wind at the boat (true) and its gusts
  const base = t < 8 ? 3 : t < 12 ? lerp(3, 8, sm(8, 12, t)) : t < 24 ? 8.5 : t < 44 ? 7.5 : 9;
  const gustK = t < 8 ? 0.08 : t < 24 ? 0.22 : 0.14;
  const tws = Math.max(0.5, base * (1 + gustK * (0.75 * gustC(t) + 0.25 * gustF(t))));
  // the course: close-hauled on starboard (AWA +35°), the tack to port (−35°) through 24–32 s, a reach (+70°) while luffing
  let awaDeg;
  if (t < 24) awaDeg = 38;
  else if (t < 32) { const u = sm(24.5, 28.5, t); awaDeg = lerp(38, -38, u); }
  else if (t < 44) awaDeg = lerp(-38, -70, sm(32, 34, t));
  else awaDeg = -45;
  // the speed: ghosting, then up to near hull speed with the gusts, slowed through the tack
  let sogKn = t < 8 ? lerp(0.5, 2, sm(2, 8, t)) : t < 24 ? lerp(2, 5.2, sm(8, 14, t)) + 1.3 * sm(12, 18, t) * (0.5 + 0.5 * gustC(t)) : t < 32 ? lerp(5.5, 3, sm(24, 28, t)) + 2 * sm(29, 32, t) : t < 44 ? 5 - 1.2 * sm(33, 35, t) * (1 - sm(39, 42, t)) : 5.2;
  sogKn = Math.max(0, sogKn);
  // the apparent wind from the true wind and the boat's speed (close-hauled the AWS is the larger)
  const aws = Math.hypot(tws + 0.6 * sogKn * KN * Math.cos(awaDeg * DEG), 0.4 * sogKn * KN) ;
  // the sails' fill: full on the wind; both luff through the tack (26–28 s), then fill on the new side; eased main 32.5–40 s
  const tackLuff = sm(25.4, 26.2, t) * (1 - sm(28.05, 28.3, t));   // head to wind 26–28 s, the new side fills in a quarter second
  const ease = sm(32.5, 33.5, t) * (1 - sm(39.5, 41, t));
  const mainFill = clamp01(1 - 0.95 * tackLuff - 0.62 * ease + 0.05 * Math.sin(t * 7.1) * ease);
  const jibFill = clamp01(1 - tackLuff - 0.2 * ease);
  const force = 18 * aws * aws * (0.55 * mainFill + 0.45 * jibFill);
  const heel = Math.min(26, force / 2000 * 22) * DEG * Math.sign(awaDeg || 1);
  // the waves at the bow: pitch (rad, + bow up) and the bow's speed against the water, growing with the wind's fetch
  const sea = t < 8 ? 0.15 : t < 24 ? lerp(0.3, 1, sm(8, 18, t)) : 0.8;
  const pitch = (1.6 * wave1(t) + 0.9 * wave2(t)) * DEG * sea * 1.4;
  const bowRelVel = (1.1 * wave1(t + 0.05) - 1.1 * wave1(t - 0.05)) * 10 * sea;
  // the sheet: eased 32.5–34 s (it runs out), trimmed on the winch 39.5–42 s (clicks)
  const sheetDeg = 18 + 22 * sm(32.5, 34, t) - 22 * sm(39.5, 42, t);
  const pull = t > 39.5 && t < 42 ? 1 : t > 32.5 && t < 34 ? -1 : 0;
  // the listener: the follow camera behind the boat; the wind's side (+ right) from the apparent wind angle
  return {
    t, wallT: t, hour: 15,
    state: {
      sog: sogKn * KN, heading: 0, heel, apparentWind: { speed: aws, angle: awaDeg * DEG }, trueWind: { speed: tws, angle: awaDeg * DEG * 1.2 },
      mainFill, jibFill, mainTopFill: mainFill, jibTopFill: jibFill, drive: force * 0.35, side: force * 0.94, mainStall: 0,
      surf: 0, slam: 0, rail: clamp01((Math.abs(heel) / DEG - 18) / 8), roundUp: 0, groove: 0, grooveHeld: 0,
    },
    pitch, bowRelVel, earWind: tws, pan: Math.sin(awaDeg * DEG),
    rain: sm(45, 50, t) * (0.7 + 0.3 * sm(52, 58, t)), camDist: 12, shoreDist: 500,
    sheet: sheetDeg * DEG, pull, rudder: t > 24.5 && t < 29 ? -0.8 : 0, steer: t > 24.5 && t < 29 ? -1 : 0,
  };
}

export function frames(seconds = 60, fps = 60, t0 = 0, fn = sailScript) {
  const out = [];
  for (let i = 0; i <= Math.round(seconds * fps); i++) out.push(fn(t0 + i / fps));
  return out;
}
