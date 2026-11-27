// Speed feel's sound (owner, 2026-11-17: "the boat cutting the water ... like cutting butter, silky"): the speed she has,
// heard building. No new node and no new file: it re-weights three layers v1's boat engine already plays (src/boatAudio.js
// createBoatAudio: the hull rush's low-pass, the hiss band, the rig's hum) through its update's adjust hook, from the physics
// the beds already read (the speed over the ground, the drawn heel, the apparent wind):
//   the rush → hiss   near hull speed the rush's low-pass opens past v1's (up to 12 kHz) and a quiet high hiss of water along
//                     the hull comes in on v1's hiss band (more as the lee side works: leeK)
//   the rail's fizz   the hiss band louder only while the lee deck edge is in the water (railWet on the drawn heel; v1's own
//                     rail hiss, from 0.25 m of clearance, is folded in here: the fizz is the wet rail alone)
//   the rig's hum     a faint lift of v1's hum (its 92/139/205 Hz resonances) near hull speed in a breeze
//   gaining, losing   the rush a little louder and brighter while she gains way, quieter and duller while she loses it (accel)
// Mixed under the rush (v1's 0.6): the hiss band never over HISS_CAP, the hum never over v1's own top (1.4 × its level).
//   const ss = createSpeedSound();  boat.update(t, state, { adjust: ss.adjust })   // state.heelDrawn: the drawn heel (rad)
// Pure: v2/tests/speed-feel.test.mjs. adjust writes into v1's mix in place: nothing allocated a frame.
import { LEVEL } from '../../src/boatAudio.js';
import { speedK, leeK, railWet } from '../sim/speedFeel.js';

const KN = 1852 / 3600;
import { smooth } from '../../src/sim/core/math.js';

export const SPEED_SOUND = Object.freeze({
  hiss: 0.35,          // × v1's LEVEL.hiss (0.22): the speed hiss at hull speed, the lee side working
  fizz: 0.9,           // × LEVEL.hiss: the wet rail's fizz at full
  hum: 0.3,            // × LEVEL.hum (0.22): the rig's hum added at hull speed in a breeze
  humWind: [4, 9],     // m/s of apparent wind where the hum's lift comes in
  hullHz: 12000,       // the rush's low-pass at hull speed (v1's tops out near 9 kHz at 7.5 kn)
  hissCap: 0.3,        // the hiss band's ceiling (v1's rail hiss at full was 0.22)
  // speed legible (research 101 #1): gaining or losing way heard. The speed over the ground low-passed (sogTau s: the waves'
  // surge filtered out), its rate of change low-passed again (accTau s), as a share of fullMs2 (m/s²: a gust's push) in −1..1:
  // the rush × (1 + rush × k) and its playback rate × (1 + rate × k): +2.9 dB and 4 % brighter gaining, −4.4 dB and 4 % duller
  // losing (sogTau as the Boat view's own speed filter: v2/sim/boat.js CAM_SLOW); nothing at a steady speed, so v1's level holds
  accel: Object.freeze({ sogTau: 3, accTau: 1.2, fullMs2: 0.15, rush: 0.4, rate: 0.04 }),
});

// the gaining/losing share as the rush's gain and rate factors (pure): k in −1..1 → { gain, rate }
export function rushAccel(k, A = SPEED_SOUND.accel, out = { gain: 1, rate: 1 }) {
  const c = Math.max(-1, Math.min(1, k || 0));
  out.gain = 1 + A.rush * c; out.rate = 1 + A.rate * c;
  return out;
}
// the tracker of the gaining/losing share: update(t s, sog m/s) → k (−1..1); t not moving (a frame drawn again) or a jump
// (over 0.5 s: a reset, a new start) changes nothing or starts afresh. No allocation.
export function createAccelTrack(A = SPEED_SOUND.accel) {
  let t0 = NaN, slow = 0, prev = 0, acc = 0, k = 0;
  return {
    get k() { return k; },
    update(t, sog) {
      if (!Number.isFinite(t)) return k;
      const dt = t - t0;
      if (!(dt > 0) || dt > 0.5) { if (!(dt > 0) && Number.isFinite(t0) && dt > -1e-9) return k; t0 = t; slow = prev = sog; acc = 0; k = 0; return k; }
      t0 = t;
      slow += (sog - slow) * (1 - Math.exp(-dt / A.sogTau));
      const raw = (slow - prev) / dt; prev = slow;
      acc += (raw - acc) * (1 - Math.exp(-dt / A.accTau));
      k = Math.max(-1, Math.min(1, acc / A.fullMs2));
      return k;
    },
    reset() { t0 = NaN; slow = prev = acc = k = 0; },
  };
}

// the speed feel's layers (pure): sogMs m/s; heel rad (the drawn heel); awsMs m/s → { hiss, fizz, hum, hullHz } (written into out)
export function speedLayers(sogMs, heel, awsMs, out = { hiss: 0, fizz: 0, hum: 0, hullHz: 0 }) {
  const k = speedK(sogMs), sogKn = Math.max(0, sogMs) / KN;
  out.hiss = LEVEL.hiss * SPEED_SOUND.hiss * k * k * (0.7 + 0.3 * leeK(heel));
  out.fizz = LEVEL.hiss * SPEED_SOUND.fizz * railWet(heel) * smooth(2, 5, sogKn);
  out.hum = LEVEL.hum * SPEED_SOUND.hum * k * k * smooth(SPEED_SOUND.humWind[0], SPEED_SOUND.humWind[1], awsMs);
  out.hullHz = 700 * (SPEED_SOUND.hullHz / 700) ** k;
  return out;
}

// v1's mix re-weighted in place (createBoatAudio's update calls adjust(mix, state) before it sets the nodes)
function applySpeedSound(mix, s, L, acc, R) {
  const heel = s.heelDrawn ?? s.heel ?? 0;
  speedLayers(s.sog ?? 0, heel, s.apparentWind?.speed ?? 0, L);
  L.accel = acc.update(s.simT, Math.max(0, s.sog ?? 0));   // simT: the caller's clock (v2/audio/recorded.js); none: steady
  if (L.accel !== 0) { rushAccel(L.accel, SPEED_SOUND.accel, R); mix.gains.rush *= R.gain; if (mix.rate) mix.rate.rush = (mix.rate.rush ?? 1) * R.rate; }
  mix.gains.hiss = Math.min(SPEED_SOUND.hissCap, L.hiss + L.fizz);
  mix.gains.hum = Math.min(1.4 * LEVEL.hum, mix.gains.hum + L.hum);
  if (L.hullHz > mix.hz.hull) mix.hz.hull = L.hullHz;
  return mix;
}

export function createSpeedSound({ on = true } = {}) {
  const L = { hiss: 0, fizz: 0, hum: 0, hullHz: 0, accel: 0 }, acc = createAccelTrack(), R = { gain: 1, rate: 1 };
  const adjust = (mix, s) => applySpeedSound(mix, s, L, acc, R);
  return { get on() { return on; }, set on(v) { on = !!v; }, get layers() { return L; }, get adjust() { return on ? adjust : null; } };
}
