// Play as Tessie's sound, the state mapping (step 8). Pure: no
// Web Audio, no clock, no Math.random. The player reads her state each frame and this module says what to hear: the rush's level and
// pitch from her speed and gait, the world's low-pass from the eye's depth, the underwater ambience's layers, the distant engines, and
// which one-shots fire (each once) from the frame's events and the state's edges. v2/living/tessie-sound.js turns the answers into nodes
// (tests: v2/tests/tessie-sound-mix.test.mjs).
import { GAIT } from '../sim/tessie.js';

import { clampT as clamp } from '../../src/sim/core/math.js';
import { smooth } from '../../src/sim/core/math.js';
import { lerp } from '../../src/sim/core/math.js';
const logLerp = (a, b, t) => a * (b / a) ** t;

export const TMIX = Object.freeze({
  rush: Object.freeze({ gain: 0.3, floor: 0.02, dashGain: 1.35, hz: [300, 1000], dashHz: 1500, pulse: 0.16 }),   // the body through water: a low-passed rush, its pitch and level up with speed, louder and brighter on the dash; a stroke's swell at her gait's rate
  world: Object.freeze({ open: 20000, justUnder: 800, deep: 350, justM: 0.6, deepM: 20 }),   // the air's world (beds, music, her own breath) low-passed after the master: 800 Hz just under, 350 Hz at 20 m
  ambience: Object.freeze({ rumble: 0.22, wash: 0.07, washHz: 420, reverb: 0.16, fullM: 1.5, bubbleHz: 5 }),   // the water's body under the surface; a soft 5 s reverb on these layers only
  engines: Object.freeze({ rangeM: 150, max: 3, near: 14, gain: 0.07, idleHz: 41, runHz: 58, bladeHz: [6, 22] }),   // distant outboards and propellers, heard under the water only, to 150 m
  surge: Object.freeze({ gain: 0.3, from: 0.2 }),   // the rising strike's surge from below, over its rise
  lock: Object.freeze({ gain: 0.1 }),   // the lock-on's one low throat note (0.2 s, about -18 dB)
  ready: Object.freeze({ gain: 0.05 }),
  gapS: Object.freeze({ windup: 0.25, knock: 0.2, dash: 0.4, ready: 1.0, lock: 1.5 }),
});

// the stroke's rate (Hz) from her gait (drift 0.35, surface 0.8, under 1.0, dash 1.6 Hz), by her speed, depth and the dash
export function gaitHz(speed, nose, dash = false) {
  if (dash) return GAIT.dash.hz;
  const base = lerp(GAIT.surface.hz, GAIT.under.hz, smooth(1.2, 3.0, nose));
  return lerp(GAIT.drift.hz, base, smooth(0.5, GAIT.cruiseV, speed));
}

// her rush (speedK 0 … 1 of her top speed; dash; the eye under the water) → { gain, hz (low-pass), pulse (the stroke's swell, share), strokeHz }
export function rushMix(speedK, { dash = false, under = false, speed = 0, nose = 0 } = {}) {
  const R = TMIX.rush, k = clamp(speedK || 0, 0, 1);
  const hz = R.hz[0] + (R.hz[1] - R.hz[0]) * k;
  const gain = (R.gain * k * k + R.floor) * (dash ? R.dashGain : 1) * (under ? 1.15 : 1);
  return { gain, hz: (dash ? lerp(hz, R.dashHz, 0.6) : hz) * (under ? 0.75 : 1), pulse: R.pulse * smooth(0.05, 0.4, k), strokeHz: gaitHz(speed, nose, dash) };
}

// the world's low-pass (Hz) from the eye's depth under the surface (m; 0 or less: in the air, open): 800 Hz just under, 350 Hz at 20 m
export function worldLowpassHz(depthM) {
  const W = TMIX.world;
  if (!(depthM > 0)) return W.open;
  if (depthM < W.justM) return logLerp(W.open, W.justUnder, smooth(0, W.justM, depthM));
  return logLerp(W.justUnder, W.deep, clamp((depthM - W.justM) / (W.deepM - W.justM), 0, 1));
}
// how far under the eye is (0 in the air … 1 at the ambience's full depth)
export const underK = (depthM) => smooth(0, TMIX.ambience.fullM, depthM || 0);

// the water's body: the rumble stays, the wash thins with depth, the reverb send follows how far under she is
export function ambienceMix(depthM) {
  const A = TMIX.ambience, k = underK(depthM), deep = smooth(2, TMIX.world.deepM, depthM || 0);
  return { rumble: A.rumble * k * (0.7 + 0.3 * deep), wash: A.wash * k * (1 - 0.7 * deep), washHz: A.washHz * (1 - 0.35 * deep), reverb: A.reverb * k, bubbles: A.bubbleHz * k };
}

// the distant engines (pure): boats { id, kind, x, z, u, motoring, rpm }, her { x, z, psi } → up to `max`, loudest first: { id, hz, blade, gain, pan }.
// The glass boat's twin outboards always run; a sailboat only while motoring; a kayak never. Level by distance, none past rangeM; the
// pan from the bearing off her heading (−1 left … 1 right); the propeller's blade rate (Hz) rises with the boat's speed
export function boatHums(boats, her, k = 1) {
  const E = TMIX.engines, out = [];
  if (!her || !(k > 0)) return out;
  for (const b of boats ?? []) {
    const on = b.kind === 'glass' || ((b.kind === 'sail' || b.kind === 'halcyon') && b.motoring);
    if (!on) continue;
    const dx = b.x - her.x, dz = b.z - her.z, d = Math.hypot(dx, dz);
    if (!(d < E.rangeM)) continue;
    const run = b.kind === 'glass' ? clamp((b.u ?? 0) / 2.06, 0, 1) : clamp(b.rpm != null ? b.rpm / 2400 : 0.5, 0, 1);
    const gain = E.gain * k * Math.min(1, 1 / (0.4 + d / E.near) ** 1.3) * (1 - d / E.rangeM);
    const bearing = Math.atan2(dx * Math.cos(her.psi) + dz * Math.sin(her.psi), dx * Math.sin(her.psi) - dz * Math.cos(her.psi));
    out.push({ id: b.id, hz: lerp(E.idleHz, E.runHz, run), blade: lerp(E.bladeHz[0], E.bladeHz[1], run), gain, pan: clamp(Math.sin(bearing), -1, 1) });
  }
  out.sort((a, b) => b.gain - a.gain);
  return out.slice(0, E.max);
}

// the nearest hull within rangeM that is not a kayak (a hull overhead creaks and slaps softly, under the water): { id, d, x, z } or null
export function nearestHull(boats, her, rangeM = 20) {
  if (!her) return null;
  let best = null;
  for (const b of boats ?? []) {
    if (b.kind === 'kayak' || b.kind === 'sup') continue;
    const d = Math.hypot(b.x - her.x, b.z - her.z);
    if (d < rangeM && (!best || d < best.d)) best = { id: b.id, d, x: b.x, z: b.z };
  }
  return best;
}

// the rising strike's surge from below (0 … 1) from its lunge { phase, t }: it swells over the warning and the rise, gone at the breach
export function surgeLevel(L) {
  if (!L || L.phase !== 'rise') return 0;
  return clamp(TMIX.surge.from + (1 - TMIX.surge.from) * smooth(0, 2.2, L.t ?? 0), 0, 1);
}

// the hull's material for a knock: the Halcyon's wood, a glass boat's and a sailboat's fibreglass, a kayak's plastic shell
export const hullOf = (kind) => (kind === 'halcyon' ? 'wood' : kind === 'kayak' || kind === 'sup' ? 'shell' : 'glass');

// the one-shots (each fires once): feed one frame at a time, get the cues { type, ... } to play this frame.
//   frame { events (the controller's: dash, ...), knocks ([{ kind, hit, x, z, where, mult }]: the player's contact results),
//           skill (the dash's { phase }), phase (the strike's: 'swim' | 'windup' | 'strike' | 'follow' | 'recover' | 'rise' | 'breach'),
//           bite ({ kind }), lunge ({ phase }), lockId, t (s, the real clock), casts ([{ type: 'lure' | 'ping', echoes }]: the RPG's skills) }
export function createCueTracker() {
  let skillWas = 'ready', phaseWas = 'swim', lungeWas = null, lockWas = null;
  const last = {};
  const gap = (type, t, s) => { if (t - (last[type] ?? -1e9) < s) return false; last[type] = t; return true; };
  return {
    step(f) {
      const cues = [], t = f.t ?? 0, G = TMIX.gapS;
      for (const e of f.events ?? []) if (e.type === 'dash' && gap('dash', t, G.dash)) cues.push({ type: 'dash' });
      const ph = f.skill?.phase ?? 'ready';
      if (skillWas === 'cool' && ph === 'ready' && gap('ready', t, G.ready)) cues.push({ type: 'ready' });   // the cooldown ended with no press waiting
      skillWas = ph;
      const phase = f.phase ?? 'swim';
      if (phase === 'windup' && phaseWas !== 'windup' && gap('windup', t, G.windup)) cues.push({ type: 'windup', kind: f.bite?.kind ?? 'snap' });
      phaseWas = phase;
      const lp = f.lunge?.phase ?? null;
      if (lp === 'rise' && lungeWas !== 'rise') cues.push({ type: 'riseStart' });
      lungeWas = lp;
      for (const k of f.knocks ?? []) if (gap('knock', t, G.knock)) cues.push({ ...k, type: k.hit ? 'knock' : 'miss' });
      for (const c of f.casts ?? []) cues.push(c);   // the RPG's skills fired this frame: Lure's fish splashes, Sonar's ping and its echoes
      const id = f.lockId ?? null;
      if (id && id !== lockWas && gap('lock', t, G.lock)) cues.push({ type: 'lock' });   // a new lock only; never repeated while it holds
      lockWas = id;
      return cues;
    },
    reset() { skillWas = 'ready'; phaseWas = 'swim'; lungeWas = null; lockWas = null; },
  };
}
