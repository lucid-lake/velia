// K2, the knockdown's sound (owner 2026-11-17: "the gust roar, the hull slam, water over the rail, the sails
// cracking, from the existing beds; synthesised where needed"). No new node and no new file: v1's boat engine already plays every
// layer (src/boatAudio.js createBoatAudio: the hull rush and the surf's roar from it, the sail flog, the sail snaps, the water
// hits) and the beds' code wind (v2/audio/beds.js) is the gust's roar. This re-weights them from the roll (kdRoll on the drawn heel,
// 0 under 40°: nothing changes while she is upright) through the same adjust hook the speed feel uses, after it:
//   water over the rail   the roar (v1's surf roar, the rush low-passed) up to ROAR × LEVEL.roar, the rush's low-pass opened
//   the sails flogging    the flog loop up to FLOG × LEVEL.flog, faster (its playback rate up to 1.3)
//   the sails cracking    v1's sail snaps (the main and the jib), one every 0.35–0.9 s while the rig is in the water
//   the hull slam         one of v1's slams at its largest as the roll passes its middle (once per excursion)
//   the gust's roar       the beds' code wind × (1 + WIND × roll) (knockdownWind, on BedsMix.stepWind's output)
//   const ks = createKnockdownSound();  ks.adjust(mix, state)   // state.kdRoll 0..1, state.kdT the sim time (s)
// Pure: v2/tests/knockdown-sound.test.mjs.
import { LEVEL, rng, waterHit } from '../../src/boatAudio.js';

export const KD_SOUND = Object.freeze({ roar: 1.1, flog: 1.2, flogRate: 0.3, rushHz: 4000, wind: 0.7, slamAt: 0.45, snapGap: [0.35, 0.55], snapAt: 0.3 });

export function createKnockdownSound({ seed = 1 } = {}) {
  const r = rng(seed ^ 0x6b64);
  let slammed = false, nextSnap = 0, lastT = null;
  const L = { k: 0, slams: 0, snaps: 0 };
  function adjust(mix, s) {
    const k = Math.min(1, Math.max(0, s.kdRoll ?? 0)), t = s.kdT ?? 0;
    if (lastT != null && t < lastT - 1) { slammed = false; nextSnap = 0; }   // a new start (the clock went back)
    lastT = t; L.k = k;
    if (k <= 0) { slammed = false; return mix; }   // back under 40°: the next roll slams again
    mix.gains.roar = Math.max(mix.gains.roar ?? 0, KD_SOUND.roar * LEVEL.roar * k);
    mix.gains.flog = Math.max(mix.gains.flog ?? 0, KD_SOUND.flog * LEVEL.flog * k);
    if (mix.rate) mix.rate.flog = Math.max(mix.rate.flog ?? 1, 1 + KD_SOUND.flogRate * k);
    if (mix.hz) mix.hz.hull = Math.max(mix.hz.hull ?? 0, 700 + (KD_SOUND.rushHz - 700) * k);
    mix.gains.rush = Math.max(mix.gains.rush ?? 0, LEVEL.rush * 0.8 * k);
    if (!slammed && k >= KD_SOUND.slamAt) {
      slammed = true; L.slams++;
      mix.events.push({ kind: 'slam', gain: LEVEL.thud * 1.15, rate: 0.85, size: 1, hit: waterHit(r, 'slam', 1) });
    }
    if (k >= KD_SOUND.snapAt && t >= nextSnap) {
      const main = r() < 0.6;
      mix.events.push({ kind: 'snap', sail: main ? 'main' : 'jib', gain: LEVEL.snap * (0.7 + 0.5 * k) * (0.8 + 0.3 * r()), rate: (main ? 0.9 : 1.06) * (0.95 + 0.1 * r()) });
      nextSnap = t + KD_SOUND.snapGap[0] + KD_SOUND.snapGap[1] * r(); L.snaps++;
    }
    return mix;
  }
  return { adjust, get layers() { return L; }, reset() { slammed = false; nextSnap = 0; lastT = null; L.k = 0; } };
}

// the beds' code wind (BedsMix.stepWind's output o) in the gust's roar: louder and brighter with the roll (in place)
export function knockdownWind(o, k) {
  if (!(k > 0) || !o?.gains) return o;
  o.gains.wind *= 1 + KD_SOUND.wind * k;
  if (o.hz) o.hz.wind *= 1 + 0.35 * k;
  return o;
}
