import { decodeFile } from './audioFormat.js';
import { cardFetch } from './ui/deferLoad.js';
import { clamp01 } from './sim/core/math.js';
// The boat's sound (D1, "feel the gust and the load"): the hull's water, the rig and the sheets under load, the sails,
// the wind in the rigging. It plugs into src/audio.js's context and master (audio.attach), sits under the ambience,
// and is driven every frame by the boat state (phys.state, src/boat.js) and the follow camera's distance.
//
//   import { createBoatAudio } from './boatAudio.js';
//   const boatAudio = createBoatAudio({ audio, seed: SEED });             // silent until audio.start() (a user gesture)
//   boatAudio.update(simT, phys.state, { camDist });                      // every frame
//
// What drives each layer (Cairn's lesson,: sound follows the load trend, not a meter):
// 1. hull: the chuckle (soft, ≈1 kn) gives way to the rush (≈6–7 kn), the low-pass opening with speed; a bow slap
//    when the bow bottoms out in chop (the pitch's low point, only with way on).
// 2. load: the sails' force (hypot(drive, side)) on a log scale, a fast and a slow average; their gap is the trend
//    (per second). The breathing matrix (level × trend): rising breathes in (the rig hums up, the sheet groans on the
//    winch, creaks come), stable holds (rare creaks), falling exhales (one sigh, the hum settles). Creaks are sparse:
//    a seeded draw, never two within 3 s.
// 3. sails: flutter when a sail luffs, a flog head to wind, a snap when a sail fills fast after a luff (fill rising
//    through 0.6 within 0.25 s of being under 0.4, after ≥ 0.4 s of luffing), never dead head to wind (|AWA| < 20°,
//    where the physics flickers a backed sail's fill between 0 and 1).
// 4. wind: no music for a gust. The ambience's wind beds already rise with the wind at the camera (mixAt); on top,
//    the apparent wind in the rig (rising faster on a gust's trend) and a thin whistle above ≈15 kn apparent.
//
// 5. the thrills (2026-10-29, read from the physics' cues, src/boat/thrill.js): the surf's roar (a second, slower and
//    darker hull rush while the boat rides a face past hull speed, state.surf), the slam's whoomp (a deep, dull
//    splash and a spray sheet when the bow hits a face past Ochi's threshold, state.slam; no tonal boom), the lee rail hissing in the water (state.rail),
//    and the round-up (a crack and a long flog as the boat heads up and the sails spill, state.roundUp).
// 6. the groove (src/boat/groove.js, state.groove): the flutter and the flog fall silent, the creaks thin out, the hum
//    stops breathing and the stays sing one steady Aeolian note (f = 0.2·V/d, Strouhal 0.2, a 6.35 mm stay); held 8 s,
//    a soft musical swell (src/audio.js grooveSwell; the bed scheduler allows one every few minutes).
// The core (BoatMix, Trend, CreakScheduler, SailWatch, SlapDetector, hullMix, windMix, distanceMix) is plain JS with no
// Web Audio and no Math.random(): node tests drive it (tests/boatAudio.test.mjs). Sources: audio/sources.json "boat"
// (CC0 Freesound, tools/boat_audio_pack.py); the hum, whistle, sigh and the water hits (slap, slam: WATER) are
// synthesised from seeded noise.

export const KN = 0.514444;
const DEG = Math.PI / 180;
const LOOP_FILES = ['hull_chuckle', 'hull_rush', 'sail_flutter', 'sail_flog'];
const BANK_FILES = ['creak_rig', 'creak_sheet', 'sail_snap'];
const HIT_FILES = ['hull_slap'];           // ?wavehit=rec only (v2): the recorded hits, slots of HIT_SLOT_S, smallest first
export const HIT_SLOT_S = 1;
export const SLOT_S = 2;                    // a bank's one-shots sit at i * SLOT_S (tools/boat_audio_pack.py)
// each layer's level at full drive, before the bus. Loops are at −26 dBFS RMS, bank one-shots at −20 dBFS.
export const LEVEL = {
  chuckle: 0.3, rush: 0.6, slap: 0.3,
  hum: 0.22, creak: 0.32, sheet: 0.38, sigh: 0.22,
  flutter: 0.8, flog: 1.2, snap: 0.5,
  rig: 0.8, whistle: 0.07,
  roar: 0.75, thud: 0.55, hiss: 0.22, roundUp: 0.9, note: 0.05,
};
// the thrills' shapes: the roar's rate and low-pass, the slam's gap (s) and the level that fires it, the rail's hiss
// band, the round-up's flog boost; the stays' Aeolian note (Strouhal number, wire diameter m, the note's range Hz)
export const THRILL = { roarRate: 0.78, roarHz: 1300, slamOn: 0.35, slamGapS: 0.6, hissHz: 3800, flogBoost: 1.4,
  strouhal: 0.2, wireM: 0.00635, noteHz: [140, 720], swellHeldS: 8 };
// the whole boat under the ambience (the beds' loops reach 0.5–0.9 before the 0.8 master)
export const BUS_LEVEL = 0.6;
const LOAD_REF_N = 2000;              // N of sail force that counts as full load (≈16 kn apparent on a reach)
export const DIST = { refM: 35, farM: 250, nearHz: 16000, farHz: 2500 };

import { smooth as smoothstep } from './sim/core/math.js';

// mulberry32: a seeded 0–1 generator (the creak timing, slot and gain; the noise buffers)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- the mapping (pure) -------------------------------------------------------------------------------------------

// The hull's water by speed over ground (kn). Returns the chuckle and rush gains, the low-pass on the rush (Hz) and
// the rush's playback rate (a touch faster with speed).
export function hullMix(sogKn) {
  const s = Math.max(0, sogKn);
  return {
    chuckle: LEVEL.chuckle * smoothstep(0.2, 1.2, s) * (1 - 0.75 * smoothstep(2.5, 6.5, s)),
    rush: LEVEL.rush * smoothstep(1.5, 7.5, s) ** 2,   // full at 7.5 kn, past the C28's ≈7 kn hull speed: a gust there still adds
    lowpassHz: 700 * (9000 / 700) ** smoothstep(0.5, 7.5, s),
    rushRate: 0.92 + 0.16 * smoothstep(1, 7, s),
  };
}

// The wind in the rig by apparent wind (kn) and its trend (ln units per s). The rig layer rises with the apparent wind
// and up to +60 % on a rising trend (the gust arriving); the whistle only above ≈15 kn, its pitch rising with speed.
export function windMix(awsKn, trend = 0) {
  return {
    rig: Math.min(1.6 * LEVEL.rig, LEVEL.rig * smoothstep(5, 22, awsKn) * (1 + 0.6 * clamp01(trend / 0.15))),
    whistle: LEVEL.whistle * smoothstep(15, 24, awsKn),
    whistleHz: 1900 + 70 * Math.min(15, Math.max(0, awsKn - 15)),
  };
}

// The follow camera's distance (m): 1 inside refM, then ≈ 1/d; the air dulls the highs far off.
export function distanceMix(camDist = DIST.refM) {
  const d = Math.max(1, camDist);
  return { gain: Math.min(1, DIST.refM / d), lowpassHz: DIST.nearHz * (DIST.farHz / DIST.nearHz) ** smoothstep(DIST.refM, DIST.farM, d) };
}

// A trend detector: a fast and a slow exponential average of x; trend = (fast − slow) / (τslow − τfast), which equals
// dx/dt on a steady ramp. phase: 'rising' past +on, back to 'stable' under +off (and the same mirrored for 'falling'),
// so a noisy signal does not chatter. Returns { x, trend, phase, entered } (entered: the phase just begun, or null).
export class Trend {
  constructor({ tauFast = 0.3, tauSlow = 2, on = 0.12, off = 0.05 } = {}) {
    Object.assign(this, { tauFast, tauSlow, on, off });
    this.fast = null; this.slow = null; this.phase = 'stable'; this.trend = 0;
  }
  update(dt, x) {
    if (this.fast === null) { this.fast = this.slow = x; return { x, trend: 0, phase: this.phase, entered: null }; }
    this.fast += (x - this.fast) * (1 - Math.exp(-dt / this.tauFast));
    this.slow += (x - this.slow) * (1 - Math.exp(-dt / this.tauSlow));
    const tr = (this.fast - this.slow) / (this.tauSlow - this.tauFast);
    this.trend = tr;
    const was = this.phase;
    if (this.phase === 'stable') this.phase = tr > this.on ? 'rising' : tr < -this.on ? 'falling' : 'stable';
    else if (this.phase === 'rising') this.phase = tr < -this.on ? 'falling' : tr < this.off ? 'stable' : 'rising';
    else this.phase = tr > this.on ? 'rising' : tr > -this.off ? 'stable' : 'falling';
    return { x, trend: tr, phase: this.phase, entered: this.phase !== was ? this.phase : null };
  }
}

// The load: the sails' force over LOAD_REF_N (0 … ≈1.5).
export const loadOf = (s) => Math.hypot(s.drive ?? 0, s.side ?? 0) / LOAD_REF_N;
// The load trend runs on ln(force + 200 N): a gust that doubles the force reads the same at any wind.
export const loadLog = (load) => Math.log(load * LOAD_REF_N + 200);

// The breathing matrix: the load level (0–1+) and its phase → the hum's gain and the creak rate (per s).
export function breath(load, phase) {
  const l = clamp01(load);
  const k = phase === 'rising' ? 1.4 : phase === 'falling' ? 0.75 : 1;
  return {
    hum: LEVEL.hum * smoothstep(0.05, 1, l) ** 0.8 * k,   // up to 1.4 × LEVEL.hum: a gust at full load still breathes in
    creakRate: phase === 'rising' ? 0.25 + 0.5 * l : phase === 'stable' ? 0.04 * l : 0,
  };
}

// The creaks and the sigh: seeded draws, sparse by construction. On a rising entry with some load, the sheet groans
// on the winch at once (if the gap allows); then rig creaks at creakRate, never two within minGapS. On a falling entry
// after a peak load ≥ 0.25, one sigh (never within sighGapS of the last). Events: { kind, slot, gain, rate }.
export class CreakScheduler {
  constructor({ seed = 1, minGapS = 3, sighGapS = 6, rigSlots = 9, sheetSlots = 4 } = {}) {
    Object.assign(this, { minGapS, sighGapS, rigSlots, sheetSlots });
    this.r = rng(seed ^ 0x51ed);
    this.lastCreak = -Infinity; this.lastSigh = -Infinity; this.lastSlot = -1; this.peak = 0;
  }
  pick(n) {
    let i = Math.floor(this.r() * n);
    if (i === this.lastSlot && n > 1) i = (i + 1) % n;
    this.lastSlot = i;
    return i;
  }
  update(t, dt, { load, phase, entered, creakRate }) {
    const out = [];
    if (phase !== 'falling') this.peak = Math.max(this.peak, load);
    const draw = this.r();   // one draw every tick, used or not: the sequence depends only on the tick count
    const gap = t - this.lastCreak >= this.minGapS;
    if (entered === 'rising' && load > 0.15 && gap) {
      out.push({ kind: 'sheet', slot: this.pick(this.sheetSlots), gain: LEVEL.sheet * (0.6 + 0.4 * clamp01(load)), rate: 0.95 + 0.1 * this.r() });
      this.lastCreak = t;
    } else if (gap && draw < 1 - Math.exp(-creakRate * dt)) {
      out.push({ kind: 'creak', slot: this.pick(this.rigSlots), gain: LEVEL.creak * (0.5 + 0.5 * clamp01(load)) * (0.8 + 0.2 * this.r()), rate: 0.94 + 0.12 * this.r() });
      this.lastCreak = t;
    }
    if (entered === 'falling') {
      if (this.peak >= 0.25 && t - this.lastSigh >= this.sighGapS) {
        out.push({ kind: 'sigh', gain: LEVEL.sigh * clamp01(this.peak), rate: 1 });
        this.lastSigh = t;
      }
      this.peak = load;
    }
    return out;
  }
}

// The sails: flutter and flog levels, and the snap trigger per sail.
// luff: the area-weighted unfilled part (main 0.55, jib 0.45); it needs wind to sound (2–7 m/s apparent).
// Head to wind (|AWA| under 25°, fading out by 45°) the luff is a flog; otherwise a flutter.
//: the gennaker's bang: the sail-snap sample played low and loud (a big nylon sail cracking full), and 0.12 s after it the
// sheet's groan on the winch (creak_sheet, low); its flog while collapsed (× the flutter's level)
export const GK_SOUND = Object.freeze({ snapGain: 2.2, snapRate: 0.7, groanGain: 1.6, groanRate: 0.78, groanLagS: 0.12, flog: 1.3 });
export const gkBangEvents = (aw) => (aw > 0.01 ? [{ kind: 'snap', sail: 'gennaker', slot: 0, gain: Math.min(1, LEVEL.snap * GK_SOUND.snapGain * aw), rate: GK_SOUND.snapRate },
  { kind: 'sheet', slot: 1, gain: Math.min(1, LEVEL.sheet * GK_SOUND.groanGain * aw), rate: GK_SOUND.groanRate, delay: GK_SOUND.groanLagS }] : []);
export const SNAP = { low: 0.4, high: 0.6, armS: 0.4, riseS: 0.25, gapS: 1, minAwa: 20 * DEG, size: { main: 1, jib: 0.7 } };
export function sailMix(s) {
  const aws = s.apparentWind?.speed ?? 0, awa = Math.abs(s.apparentWind?.angle ?? 0);
  const luff = 0.55 * (1 - (s.mainFill ?? 1)) + 0.45 * (1 - (s.jibFill ?? 1));
  const wf = smoothstep(1.5, 7, aws), htw = 1 - smoothstep(25 * DEG, 45 * DEG, awa);
  // pro: how much of the luff is the head's (the upper bands, src/boat.js; 0 in basic): a head luffing on its own (an
  // over-twisted sail) flutters thinner and faster, the leech's small rapid tremble, not the whole sail's shake
  const headLuff = 0.4 * (0.55 * (1 - (s.mainTopFill ?? s.mainFill ?? 1)) + 0.45 * (1 - (s.jibTopFill ?? s.jibFill ?? 1)));
  const head = luff > 1e-3 ? clamp01((headLuff / luff - 0.4) / 0.6) : 0;
  return { luff, flutter: LEVEL.flutter * luff * wf * (1 - htw), flog: LEVEL.flog * luff * wf * htw, flogRate: 0.9 + 0.25 * smoothstep(4, 10, aws),
    head, flutterRate: 1 + 0.3 * head, flutterHz: 250 + 450 * head };
}
export class SailWatch {
  constructor() { this.sails = { main: { prev: 1, lowFor: 0, tLow: -Infinity, last: -Infinity }, jib: { prev: 1, lowFor: 0, tLow: -Infinity, last: -Infinity } }; }
  update(t, dt, s) {
    const aws = s.apparentWind?.speed ?? 0, awa = Math.abs(s.apparentWind?.angle ?? 0), snaps = [];
    for (const k of ['main', 'jib']) {
      const S = this.sails[k], f = k === 'main' ? s.mainFill ?? 1 : s.jibFill ?? 1;
      if (f < SNAP.low) { S.lowFor += dt; S.tLow = t; }
      if (f >= SNAP.high && S.prev < SNAP.high) {
        if (S.lowFor >= SNAP.armS && t - S.tLow <= SNAP.riseS && t - S.last >= SNAP.gapS && awa >= SNAP.minAwa) {
          const strength = LEVEL.snap * SNAP.size[k] * smoothstep(2, 8, aws);
          if (strength > 0.01) { snaps.push({ kind: 'snap', sail: k, gain: strength, rate: k === 'main' ? 0.92 : 1.08 }); S.last = t; }
        }
        S.lowFor = 0;
      }
      S.prev = f;
    }
    return snaps;
  }
}

// The stall creak (the one sail state the body does not read): a soft groan from the sheet on the winch
// as the main goes past its stall (state.mainStall over STALL.on for armS, forward of a broad reach: a run's sail is a
// flat plate by nature), then again every 4–7 s while it stays stalled. Its own seeded draws, so the creak
// sequence above is unchanged. Events: { kind: 'stall', slot, gain, rate } (the creak_sheet bank, pitched down).
export const STALL = { on: 0.6, off: 0.35, armS: 0.4, againS: [4, 7], maxAwa: 80 * DEG, gain: 0.24 };
export class StallWatch {
  constructor({ seed = 1, slots = 4 } = {}) { this.r = rng(seed ^ 0x57a1); this.slots = slots; this.for = 0; this.next = Infinity; this.on = false; }
  update(t, dt, s) {
    const st = Math.abs(s.apparentWind?.angle ?? Math.PI) < STALL.maxAwa ? (s.mainStall ?? 0) : 0;
    const draw = this.r(), draw2 = this.r();   // two draws every tick: the sequence depends only on the tick count
    if (st < STALL.off) { this.for = 0; this.on = false; this.next = Infinity; return null; }
    if (st >= STALL.on) this.for += dt;
    if (!this.on && this.for >= STALL.armS) { this.on = true; this.next = t; }
    if (!this.on || t < this.next) return null;
    this.next = t + STALL.againS[0] + (STALL.againS[1] - STALL.againS[0]) * draw;
    const aws = s.apparentWind?.speed ?? 0;
    return { kind: 'stall', slot: Math.floor(draw2 * this.slots), gain: STALL.gain * smoothstep(2, 8, aws) * (0.7 + 0.3 * clamp01((st - STALL.on) / (1 - STALL.on))), rate: 0.8 + 0.08 * draw2 };
  }
}

// The thrills and the groove (pure): the layer gains from the physics' cues. sogKn, awsMs as BoatMix.
export function thrillMix(s, sogKn, awsMs) {
  const groove = clamp01(s.groove ?? 0), wf = smoothstep(1.5, 7, awsMs);
  const noteHz = Math.min(THRILL.noteHz[1], Math.max(THRILL.noteHz[0], THRILL.strouhal * awsMs / THRILL.wireM));
  return {
    roar: LEVEL.roar * clamp01(s.surf ?? 0) * smoothstep(4.5, 7, sogKn),
    hiss: LEVEL.hiss * clamp01(s.rail ?? 0) * smoothstep(2, 5, sogKn),
    roundUp: clamp01(s.roundUp ?? 0) * wf,
    groove, note: LEVEL.note * groove * smoothstep(3, 8, awsMs), noteHz,
  };
}
// The water hits (2026-11-05, a sailor's note on the old sound: "bang, bang, bang", metallic). A fibreglass keelboat
// meeting chop is mostly water: a soft "whump" with a slow onset (15–50 ms), a broadband splash falling away over
// 0.1–0.4 s, a spray hiss arriving late and quiet, a few drops pattering back, and under it only a faint, low, damped
// body (low-passed noise, no tone, no ring). No two hits alike: each draws its own noise offset, filters, onset, decay,
// spray and drops. size 0..1: a bigger hit is deeper, longer and sprays more. r: a seeded 0–1 generator.
export const WATER = {
  slap: { attackS: [0.016, 0.034], bodyHz: [100, 150], body: 0.3, splashHz: [900, 2300], splash: 1, decayS: [0.07, 0.16],
    sprayDelayS: [0.05, 0.15], sprayHz: [2600, 5500], spray: 0.22, sprayDecayS: [0.12, 0.3], drops: [0, 2], jitterS: 0.07 },
  slam: { attackS: [0.026, 0.05], bodyHz: [75, 115], body: 0.8, splashHz: [650, 1500], splash: 1.6, decayS: [0.17, 0.32],
    sprayDelayS: [0.12, 0.28], sprayHz: [2200, 4800], spray: 0.38, sprayDecayS: [0.3, 0.65], drops: [2, 5], jitterS: 0.05 },
};
export function waterHit(r, kind = 'slap', size = 0.5) {
  const W = WATER[kind] ?? WATER.slap, k = clamp01(size), lerp = ([a, b], u) => a + (b - a) * u;
  // the size leans each draw (bigger: deeper, longer, wetter); the draw keeps half the range free
  const pick = (range, lean) => lerp(range, clamp01(0.5 * r() + 0.5 * (lean > 0 ? k : 1 - k)));
  const sprayDelay = pick(W.sprayDelayS, 1), nDrops = Math.round(lerp(W.drops, clamp01(0.5 * r() + 0.5 * k)));
  return {
    delay: W.jitterS * r(), offset: r(), attack: pick(W.attackS, 1),
    bodyHz: pick(W.bodyHz, -1), body: W.body * (0.6 + 0.6 * r()),
    splashHz: pick(W.splashHz, -1), splash: W.splash * (0.8 + 0.3 * r()), decay: pick(W.decayS, 1),
    sprayDelay, sprayHz: lerp(W.sprayHz, r()), spray: W.spray * (0.5 + 0.7 * k) * (0.7 + 0.6 * r()), sprayDecay: pick(W.sprayDecayS, 1),
    drops: Array.from({ length: nDrops }, () => ({ t: sprayDelay + 0.05 + 0.45 * r(), hz: 3000 + 4000 * r(), g: 0.06 + 0.12 * r() })),
  };
}

// The slam's thud and the round-up's crack: one event as the cue rises through its level (slam: at most one per
// slamGapS plus a seeded 0–slamJitterS, so a run of slams never falls into a beat; the round-up: once per round-up, at
// its onset). The swell: once per lock-in, when the groove has held THRILL.swellHeldS.
// Events: { kind: 'slam', gain, rate, size, hit } | { kind: 'roundup', gain } | { kind: 'swell' }.
const SLAM_JITTER_S = 0.7;
export class ThrillWatch {
  constructor({ seed = 1 } = {}) { this.r = rng(seed ^ 0x5a1a); this.slamPrev = 0; this.lastSlam = -Infinity; this.slamGap = THRILL.slamGapS; this.ruPrev = 0; this.swelled = false; }
  update(t, s) {
    const out = [], slam = s.slam ?? 0, ru = s.roundUp ?? 0;
    if (slam >= THRILL.slamOn && this.slamPrev < THRILL.slamOn && t - this.lastSlam >= this.slamGap && (s.sog ?? 0) > 1) {
      const size = clamp01((slam - THRILL.slamOn) / (1 - THRILL.slamOn));
      out.push({ kind: 'slam', gain: LEVEL.thud * (0.5 + 0.5 * size) * (0.8 + 0.3 * this.r()), rate: 0.9 + 0.2 * clamp01(slam), size, hit: waterHit(this.r, 'slam', size) });
      this.lastSlam = t; this.slamGap = THRILL.slamGapS + SLAM_JITTER_S * this.r();
    }
    this.slamPrev = slam;
    if (ru >= 0.5 && this.ruPrev < 0.5) out.push({ kind: 'roundup', gain: LEVEL.snap * 1.2 * smoothstep(3, 9, s.apparentWind?.speed ?? 0) });
    this.ruPrev = ru;
    if ((s.grooveHeld ?? 0) >= THRILL.swellHeldS && !this.swelled) { out.push({ kind: 'swell' }); this.swelled = true; }
    if ((s.grooveHeld ?? 0) === 0) this.swelled = false;
    return out;
  }
}

// The bow slap: at the pitch's low point (its rate turning from bow-down to bow-up), sized by the swing since the last
// high point, with way on (2–6 kn). pitch: rad, + = bow up (src/boat.js state.pitch). rough: the sea state 0..1
// (BoatMix's seaRough). Not every trough slaps: a seeded draw per trough, likelier for a bigger swing and a rougher
// sea; each trough's threshold is drawn too (higher in calm water), the gap after a slap is 0.5–1.5 s (shorter in a
// rough sea) and the gain varies ±25 % and grows as swing^1.5, so small chop is near-silent under the hull's rush and
// a run of slaps never falls into a beat. Events: { kind: 'slap', gain, rate, size, hit } (hit: waterHit).
export class SlapDetector {
  constructor({ swingRef = 2 * DEG, minSwing = 0.3 * DEG, seed = 1 } = {}) {
    Object.assign(this, { swingRef, minSwing });
    this.r = rng(seed ^ 0x51a9);
    this.prev = null; this.prevRate = 0; this.high = null; this.last = -Infinity; this.gap = 0.5;
  }
  update(t, dt, pitch, sogKn, rough = 0.5) {
    if (this.prev === null || dt <= 0) { this.prev = pitch; this.high = pitch; return null; }
    const rate = (pitch - this.prev) / dt;
    let ev = null;
    if (this.prevRate > 0 && rate <= 0) this.high = this.prev;                     // a high point
    if (this.prevRate < 0 && rate >= 0 && this.high !== null) {                  // a low point
      const sea = clamp01(rough), swing = this.high - this.prev, size = clamp01(swing / this.swingRef);
      const d1 = this.r(), d2 = this.r(), d3 = this.r(), d4 = this.r();   // four draws per trough, used or not
      const thr = this.minSwing * (1 + 1.5 * (1 - sea)) * (0.8 + 0.5 * d1);
      const p = Math.min(0.85, (0.25 + 0.75 * sea) * (0.2 + 1.1 * size));   // even a rough sea skips a trough
      const g = LEVEL.slap * size ** 1.5 * smoothstep(2, 6, sogKn) * (0.75 + 0.5 * d2);
      if (swing >= thr && d3 < p && g > 0.01 && t - this.last >= this.gap) {
        ev = { kind: 'slap', gain: g, rate: 0.9 + 0.2 * size, size, hit: waterHit(this.r, 'slap', size) };
        this.last = t; this.gap = 0.5 + (0.4 + 0.6 * d4) * (1 - 0.4 * sea);
      }
    }
    this.prev = pitch; this.prevRate = rate;
    return ev;
  }
}

// One frame of the whole boat: the layer gains, the filters and the one-shot events. Pure and deterministic: the
// same sequence of (t, state, opts) gives the same output. opts: { camDist (m) }.
export class BoatMix {
  constructor({ seed = 1 } = {}) {
    this.load = new Trend({ tauFast: 0.3, tauSlow: 2, on: 0.12, off: 0.05 });
    this.aws = new Trend({ tauFast: 0.3, tauSlow: 2, on: 0.06, off: 0.02 });
    this.creaks = new CreakScheduler({ seed });
    this.sails = new SailWatch();
    this.slap = new SlapDetector({ seed });
    this.stall = new StallWatch({ seed });
    this.thrill = new ThrillWatch({ seed });
    this.lastT = null; this.lastSlam = -Infinity;
  }
  step(t, s, { camDist = DIST.refM } = {}) {
    const dt = this.lastT === null ? 0 : Math.min(0.1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const sogKn = (s.sog ?? 0) / KN, awsKn = (s.apparentWind?.speed ?? 0) / KN;
    const load = loadOf(s);
    const L = this.load.update(dt, loadLog(load));
    const W = this.aws.update(dt, Math.log((s.apparentWind?.speed ?? 0) + 1));
    const th = thrillMix(s, sogKn, s.apparentWind?.speed ?? 0), gr = th.groove;
    // in the groove the hum stops breathing (the stable phase's level) and the creaks thin to a fifth
    const b0 = breath(load, L.phase), bs = breath(load, 'stable');
    const b = { hum: b0.hum + (bs.hum - b0.hum) * gr, creakRate: b0.creakRate * (1 - 0.8 * gr) };
    // the sea's roughness 0..1 (s.seaRough: the bow's vertical speed against the water, smoothed, src/sail/controls.js): the hull's wash
    // and the slaps grow with the waves (owner 2026-10-30: the waves must be felt, and heard)
    const rough = clamp01(s.seaRough ?? 0), h0 = hullMix(sogKn), h = { ...h0, chuckle: h0.chuckle * (1 + 0.8 * rough), rush: h0.rush * (1 + 0.45 * rough) };
    const w = windMix(awsKn, W.trend), sm = sailMix(s), d = distanceMix(camDist);
    const events = dt > 0 ? [...this.creaks.update(t, dt, { load, phase: L.phase, entered: L.entered, creakRate: b.creakRate }), ...this.sails.update(t, dt, s), ...this.thrill.update(t, s)] : [];
    // the slap reads the sea state (calm water: few, soft hits); never on the heels of a slam, nor as
    // one builds (one wave, one hit)
    if (events.some((e) => e.kind === 'slam')) this.lastSlam = t;
    const slap = this.slap.update(t, dt, s.pitch ?? 0, sogKn, rough);
    if (slap && t - this.lastSlam >= 0.45 && (s.slam ?? 0) < 0.6 * THRILL.slamOn) { slap.gain = Math.min(1, slap.gain * (0.4 + 1.2 * rough)); events.push(slap); }
    const stall = dt > 0 ? this.stall.update(t, dt, s) : null;
    if (stall && stall.gain > 0.01) events.push(stall);
    // the gennaker: its bang (the cloth's crack as it fills, a low, loud snap) and the sheet's groan on the winch as it
    // loads; collapsed it flogs (the flutter, louder: the biggest sail aboard). Only once it has been hoisted: a boat without it is unchanged.
    let gkFlog = 0;
    if (s.gk) {
      const gk = s.gk, aw = smoothstep(2, 8, gk.aws ?? 0);
      if ((gk.bangs ?? 0) > (this.gkBangs ?? 0) && dt > 0) events.push(...gkBangEvents(aw));
      this.gkBangs = gk.bangs ?? 0;
      gkFlog = LEVEL.flutter * GK_SOUND.flog * (gk.deploy ?? 0) * (1 - (gk.fill ?? 0)) * aw;
    }
    return {
      t, load, trend: L.trend, phase: L.phase, awsTrend: W.trend, events,
      // the groove silences the luff; a round-up flogs whatever the angle (the sails spill as the bow comes up)
      gains: { chuckle: h.chuckle, rush: h.rush, hum: b.hum, flutter: sm.flutter * (1 - gr) + gkFlog, flog: Math.max(sm.flog * (1 - gr), LEVEL.flog * THRILL.flogBoost * th.roundUp), rig: w.rig, whistle: w.whistle,
        roar: th.roar, hiss: th.hiss, note: th.note, bus: BUS_LEVEL * d.gain },
      hz: { hull: h.lowpassHz, whistle: w.whistleHz, dist: d.lowpassHz, note: th.noteHz, flutter: sm.flutterHz },
      rate: { rush: h.rushRate, flog: sm.flogRate + 0.15 * th.roundUp, flutter: sm.flutterRate },
    };
  }
}

// ---- the browser engine -------------------------------------------------------------------------------------------
// Either { audio } (src/audio.js: the graph is built when audio.start() runs, inside the user gesture) or
// { ctx, destination } (a demo or an OfflineAudioContext). taps: optional { hull, load, sails, wind: AudioNode } that
// also receive each group's signal (pre-bus; the offline meter). files: { <name>: url } overrides base + name.opus.
export const GROUPS = ['hull', 'load', 'sails', 'wind'];
// swell: (at) → plays the groove's swell on this context, for an offline render with no src/audio.js scheduler.
// waveHit: the slaps' and slams' sound, 'today' (v1's, WATER) | 'rec' (audio/boat/hull_slap) | 'synth' (soft) | 'off' (v2's
// ?wavehit=); kinds: the one-shot kinds played (an A/B render of one sound alone, tools/v2-wave-hit.mjs), null for all.
export function createBoatAudio({ audio, ctx: ctx0, destination, base = '/audio/boat/', windUrl = '/audio/wind_strong.opus', files = {}, seed = 1, taps = null, swell = null, fetchFn = cardFetch, waveHit = 'today', kinds = null } = {}) {   // fetchFn: on a phone, once the card is live (src/ui/deferLoad.js)
  const mixer = new BoatMix({ seed });
  let ctx = null, g = null, mix = null, ready = null;
  const bufs = {}, played = [];

  async function decode(url) {
    return decodeFile(ctx, fetchFn, url);
  }

  function noiseBuffer(sec, s) {
    const r = rng(s), b = new AudioBuffer({ length: Math.round(sec * ctx.sampleRate), sampleRate: ctx.sampleRate, numberOfChannels: 1 });
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = r() * 2 - 1;
    return b;
  }

  function init(c, dest) {
    ctx = c;
    const G = (v = 0) => new GainNode(ctx, { gain: v });
    const F = (type, frequency, Q = 0.7) => new BiquadFilterNode(ctx, { type, frequency, Q });
    g = { bus: G(mix?.gains.bus ?? BUS_LEVEL), dist: F('lowpass', DIST.nearHz, 0.5), group: {} };
    g.bus.connect(g.dist).connect(dest);
    for (const k of GROUPS) { g.group[k] = G(1); g.group[k].connect(g.bus); if (taps?.[k]) g.group[k].connect(taps[k]); }
    // the loops' gains and filters (the sources start once decoded)
    g.chuckle = G(); g.chuckle.connect(g.group.hull);
    g.rush = G(); g.rushLp = F('lowpass', 2000, 0.5); g.rushLp.connect(g.rush).connect(g.group.hull);
    g.flutter = G(); g.flutterHp = F('highpass', 250); g.flutterHp.connect(g.flutter).connect(g.group.sails);
    g.flog = G(); g.flog.connect(g.group.sails);
    g.rig = G(); g.rigHp = F('highpass', 1400, 0.6); g.rigHp.connect(g.rig).connect(g.group.wind);
    // synthesised: the rig's hum (seeded noise through two resonances, a hollow drone of the mast and stays) and the whistle
    g.noise = noiseBuffer(6, seed);
    const loopNoise = (offset) => { const src = new AudioBufferSourceNode(ctx, { buffer: g.noise, loop: true }); src.start(0, offset); return src; };
    g.hum = G(); g.hum.connect(g.group.load);
    const humIn = G(4);   // make-up: a Q-10 band of white noise is ≈ −20 dB; the hum stays under the water
    for (const [hz, q, off] of [[92, 10, 0], [139, 12, 2.1], [205, 9, 4.3]]) loopNoise(off).connect(F('bandpass', hz, q)).connect(humIn);
    humIn.connect(g.hum);
    // the thrills: the surf's roar (a second hull_rush loop, slower and darker, below), the rail's hiss (noise through
    // a high band), the stays' Aeolian note (a sine and a quiet octave, gliding to the apparent wind's note)
    g.roar = G(); g.roarLp = F('lowpass', THRILL.roarHz, 0.6); g.roarLp.connect(g.roar).connect(g.group.hull);
    g.hiss = G(); loopNoise(3.7).connect(F('highpass', 1800, 0.5)).connect(F('bandpass', THRILL.hissHz, 0.9)).connect(g.hiss).connect(g.group.hull);
    g.note = G(); g.noteOsc = [new OscillatorNode(ctx, { frequency: 300 }), new OscillatorNode(ctx, { frequency: 600 })];
    g.noteOsc[0].connect(g.note); g.noteOsc[1].connect(G(0.18)).connect(g.note); g.note.connect(g.group.load);
    for (const o of g.noteOsc) o.start(0);
    g.whistle = G(); g.whistle.connect(g.group.wind);
    g.whistleBp = [F('bandpass', 1900, 28), F('bandpass', 2850, 34)];
    const wIn = G(14);
    for (const [i, f] of g.whistleBp.entries()) loopNoise(1.3 + i * 2.2).connect(f).connect(wIn);
    wIn.connect(g.whistle);
    const urls = Object.fromEntries([...LOOP_FILES, ...BANK_FILES, ...(waveHit === 'rec' ? HIT_FILES : [])].map((k) => [k, files[k] ?? `${base}${k}.opus`]));
    if (windUrl) urls.wind = files.wind ?? windUrl;
    ready = Promise.all(Object.entries(urls).map(async ([k, u]) => {
      try { bufs[k] = await decode(u); } catch (e) { played.push({ error: String(e.message ?? e), file: k }); return; }
      const into = { hull_chuckle: g.chuckle, hull_rush: g.rushLp, sail_flutter: g.flutterHp, sail_flog: g.flog, wind: g.rigHp }[k];
      if (k === 'hull_rush') {   // the roar: the same water, a fifth lower and darker, offset in the loop
        const r = new AudioBufferSourceNode(ctx, { buffer: bufs[k], loop: true, playbackRate: THRILL.roarRate });
        r.connect(g.roarLp); r.start(0, (rng(seed + 41)() * bufs[k].duration) % bufs[k].duration); g.roarSrc = r;
      }
      if (!into) return;
      const src = new AudioBufferSourceNode(ctx, { buffer: bufs[k], loop: true });
      src.connect(into);
      // the loop's start point: seeded, so two boats or two runs line up the same
      src.start(0, (rng(seed + k.length * 7919)() * bufs[k].duration) % bufs[k].duration);
      g[`${k}Src`] = src;
    }));
    return ready;
  }

  if (ctx0) init(ctx0, destination ?? ctx0.destination);
  else audio?.attach?.(({ ctx: c, master }) => init(c, master));

  // a water hit (slap or slam, WATER above): no oscillator. Four layers of the seeded noise, each from its own drawn
  // offset: the body (twice low-passed, no resonance), the splash (a broad band), the late spray (a high band) and a
  // few drops; every onset a raised-cosine swell, every tail an exponential fall. ev.hit: waterHit(); an event without
  // one (an old caller) gets a mid-sized hit from a fixed draw.
  const HIT_RISE = Float32Array.from({ length: 16 }, (_, i) => Math.sin(0.5 * Math.PI * i / 15) ** 2);
  const BODY_MAKEUP = 6, SPLASH_MAKEUP = 2.4, SPRAY_MAKEUP = 1.1;
  function waterHitAt(ev, at) {
    const p = ev.hit ?? waterHit(rng(7), ev.kind, 0.5), t0 = at + p.delay, N = g.noise.duration;
    const F = (type, frequency, Q = 0.5) => new BiquadFilterNode(ctx, { type, frequency, Q });
    const layer = (u, len, chain, peak, start, attack, tau) => {
      // never in the past: Chrome moves a curve that starts before currentTime up to it, the curve then ends after
      // start + attack, and the tail's setTargetAtTime below lands inside it and throws ("overlaps setValueCurveAtTime";
      // a throttled or headless page, where the audio clock runs ahead of the frame's `at`)
      const now = ctx.currentTime;
      if (Number.isFinite(now)) start = Math.max(start, now + 0.005);
      const src = new AudioBufferSourceNode(ctx, { buffer: g.noise }), env = new GainNode(ctx, { gain: 0 });
      let node = src;
      for (const f of chain) node = node.connect(f);
      node.connect(env).connect(g.group.hull);
      try {
        env.gain.setValueCurveAtTime(HIT_RISE.map((v) => v * peak), start, attack);
        env.gain.setTargetAtTime(0, start + attack + 1e-4, tau);
      } catch { return; }   // a layer that cannot be scheduled is dropped, never thrown out of the frame's update
      src.start(start, (u % 1) * (N - len), len);
    };
    const tail = (tau) => Math.min(2.5, p.attack + 7 * tau);
    layer(p.offset, tail(p.decay * 0.9), [F('lowpass', p.bodyHz), F('lowpass', p.bodyHz)], ev.gain * p.body * BODY_MAKEUP, t0, p.attack * 1.3, p.decay * 0.9);
    layer(p.offset + 0.31, tail(p.decay), [F('highpass', 220), F('lowpass', p.splashHz, 0.6)], ev.gain * p.splash * SPLASH_MAKEUP, t0, p.attack, p.decay);
    layer(p.offset + 0.57, tail(p.sprayDecay), [F('bandpass', p.sprayHz, 0.8)], ev.gain * p.spray * SPRAY_MAKEUP, t0 + p.sprayDelay, 0.06, p.sprayDecay);
    for (const [i, d] of p.drops.entries()) layer(p.offset + 0.13 * (i + 1), 0.08, [F('bandpass', d.hz, 2.5)], ev.gain * d.g * SPRAY_MAKEUP * 2, t0 + d.t, 0.004, 0.012);
  }

  // The other wave hits (v2's ?wavehit=, 2026-11-15: the hits above heard as metal). Same events, same draws (ev.hit).
  // rec: a recorded slot of audio/boat/hull_slap (real water on a hull, CC0): a slap picks from the smaller half, a slam from
  // the larger half (leaning bigger with size); a bigger hit plays a touch slower (deeper).
  const REC_MAKEUP = 2.2, SOFT_MAKEUP = 2.1;
  function recHitAt(ev, at) {
    const buf = bufs.hull_slap;
    if (!buf) return;
    const p = ev.hit ?? waterHit(rng(7), ev.kind, 0.5), n = Math.max(1, Math.round(buf.duration / HIT_SLOT_S)), k = clamp01(ev.size ?? 0.5);
    const half = Math.max(1, Math.floor(n / 2)), u = clamp01(0.6 * p.offset + 0.4 * k);
    const slot = ev.kind === 'slam' ? Math.min(n - 1, half + Math.floor(u * (n - half))) : Math.min(half - 1, Math.floor(u * half));
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: 1.06 - 0.14 * k });
    src.connect(new GainNode(ctx, { gain: ev.gain * REC_MAKEUP })).connect(g.group.hull);
    src.start(Math.max(at + p.delay, ctx.currentTime || 0), slot * HIT_SLOT_S, HIT_SLOT_S);
  }
  // synth: soft low-passed noise only, no band-pass, no spray band, no drops. Two swells: the bow meeting the face, then the
  // water falling back 40-90 ms later, each white noise through a high-pass at 90 Hz (no boom) and two low-passes (Q 0.5)
  // whose cut-off falls over the tail (at most 1.4 kHz, to a third of it); onsets 35-80 ms.
  function softHitAt(ev, at) {
    const p = ev.hit ?? waterHit(rng(7), ev.kind, 0.5), N = g.noise.duration;
    const swell = (u, f0, peak, start, attack, tau) => {
      const now = ctx.currentTime;
      if (Number.isFinite(now)) start = Math.max(start, now + 0.005);
      const len = Math.min(2.5, attack + 6 * tau);
      const src = new AudioBufferSourceNode(ctx, { buffer: g.noise }), env = new GainNode(ctx, { gain: 0 });
      const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: 90, Q: 0.5 });
      const lps = [0, 1].map(() => new BiquadFilterNode(ctx, { type: 'lowpass', frequency: f0, Q: 0.5 }));
      src.connect(hp).connect(lps[0]).connect(lps[1]).connect(env).connect(g.group.hull);
      try {
        for (const lp of lps) { lp.frequency.setValueAtTime(f0, start); lp.frequency.exponentialRampToValueAtTime(f0 / 3, start + len); }
        env.gain.setValueCurveAtTime(HIT_RISE.map((v) => v * peak), start, attack);
        env.gain.setTargetAtTime(0, start + attack + 1e-4, tau);
      } catch { return; }
      src.start(start, (u % 1) * (N - len), len);
    };
    const t0 = at + p.delay, f0 = Math.min(1400, 0.75 * p.splashHz), attack = Math.min(0.08, Math.max(0.035, 1.6 * p.attack));
    const back = 0.04 + 0.05 * ((p.offset * 7.3) % 1);
    swell(p.offset, f0, ev.gain * p.splash * SOFT_MAKEUP, t0, attack, 0.9 * p.decay);
    swell(p.offset + 0.43, 0.7 * f0, 0.55 * ev.gain * p.splash * SOFT_MAKEUP, t0 + back, 1.3 * attack, 1.4 * p.decay);
  }

  // a one-shot at audio time `at`
  function fire(ev, at) {
    const G = (v) => new GainNode(ctx, { gain: v });
    if (ev.kind === 'creak' || ev.kind === 'sheet' || ev.kind === 'snap' || ev.kind === 'stall') {
      const buf = bufs[{ creak: 'creak_rig', sheet: 'creak_sheet', stall: 'creak_sheet', snap: 'sail_snap' }[ev.kind]];
      if (!buf) return;
      const n = Math.max(1, Math.round(buf.duration / SLOT_S));
      const slot = ev.slot ?? (ev.sail === 'main' ? 0 : 1) % n;
      const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: ev.rate ?? 1 });
      src.connect(G(ev.gain)).connect(ev.kind === 'snap' ? g.group.sails : g.group.load);
      src.start(at, slot * SLOT_S, SLOT_S);
    } else if (ev.kind === 'sigh') {
      // the rig exhaling: a band of noise swelling over 0.35 s and falling away over 1.5 s, its band sweeping down
      const src = new AudioBufferSourceNode(ctx, { buffer: g.noise }), bp = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 1100, Q: 1.2 }), env = G(0);
      bp.frequency.setValueAtTime(1100, at); bp.frequency.exponentialRampToValueAtTime(320, at + 1.8);
      env.gain.setValueAtTime(0, at); env.gain.linearRampToValueAtTime(ev.gain * 3, at + 0.35); env.gain.setTargetAtTime(0, at + 0.4, 0.45);
      src.connect(bp).connect(env).connect(g.group.load);
      src.start(at, 0.5, 2.4);
    } else if (ev.kind === 'slam' || ev.kind === 'slap') {
      if (waveHit === 'off') return;
      if (waveHit === 'rec') recHitAt(ev, at);
      else if (waveHit === 'synth') softHitAt(ev, at);
      else waterHitAt(ev, at);
    } else if (ev.kind === 'roundup') {
      // the sails spilling: the snap's crack, twice, as the main and the jib let go
      const buf = bufs.sail_snap;
      if (buf) for (const [i, dly] of [[0, 0], [1, 0.22]]) {
        const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: i ? 1.1 : 0.85 });
        src.connect(G(ev.gain * (i ? 0.7 : 1))).connect(g.group.sails);
        src.start(at + dly, (i % Math.max(1, Math.round(buf.duration / SLOT_S))) * SLOT_S, SLOT_S);
      }
    } else if (ev.kind === 'swell') {
      // the groove's swell: the music scheduler decides (never over a bed, once every few minutes); offline, the page
      // passes its own swell(at)
      if (audio?.groove) audio.groove(ev.t ?? 0);
      else swell?.(at);
    }
  }

  // Every frame: the sim time (s), the boat state, { camDist }. `at` is the audio time to schedule at (default now;
  // an offline render passes its own timeline).
  // opts.extra: one-shots from outside the mixer (the gust's sail-fill snap, src/gustFx.js; an event's delay s plays it
  // that much later); opts.rushMul: the hull rush's gain × this (the gust's rising rush); opts.adjust(mix, state): a caller's
  // re-weighting of the mix in place (v2's speed feel), after the two above
  function update(t, state, opts = {}, at = ctx?.currentTime) {
    mix = mixer.step(t, state, opts);
    if (opts.extra?.length) mix.events.push(...opts.extra);
    if (opts.rushMul != null) mix.gains.rush *= opts.rushMul;
    opts.adjust?.(mix, state);   // v2's speed feel (v2/audio/speedSound.js): the mix re-weighted in place before the nodes are set
    if (!ctx || !g) return mix;
    const set = (p, v, tau) => p.setTargetAtTime(v, at, tau);
    set(g.bus.gain, mix.gains.bus * trims.bus, 0.3); set(g.dist.frequency, mix.hz.dist, 0.3);
    set(g.chuckle.gain, mix.gains.chuckle, 0.3); set(g.rush.gain, mix.gains.rush, 0.3); set(g.rushLp.frequency, mix.hz.hull, 0.3);
    set(g.hum.gain, mix.gains.hum, 0.35);
    set(g.flutter.gain, mix.gains.flutter, 0.12); set(g.flog.gain, mix.gains.flog, 0.15);
    set(g.rig.gain, mix.gains.rig, 0.4); set(g.whistle.gain, mix.gains.whistle, 0.6);
    for (const f of g.whistleBp) set(f.frequency, mix.hz.whistle * (f === g.whistleBp[0] ? 1 : 1.5), 0.8);
    set(g.roar.gain, mix.gains.roar, mix.gains.roar > g.roar.gain.value ? 0.12 : 0.6); set(g.hiss.gain, mix.gains.hiss, 0.25);
    set(g.note.gain, mix.gains.note, 0.8); set(g.noteOsc[0].frequency, mix.hz.note, 1.5); set(g.noteOsc[1].frequency, mix.hz.note * 2, 1.5);
    if (g.hull_rushSrc) set(g.hull_rushSrc.playbackRate, mix.rate.rush, 0.5);
    if (g.sail_flogSrc) set(g.sail_flogSrc.playbackRate, mix.rate.flog, 0.5);
    if (g.sail_flutterSrc) set(g.sail_flutterSrc.playbackRate, mix.rate.flutter ?? 1, 0.3);   // pro: the head's flutter
    set(g.flutterHp.frequency, mix.hz.flutter ?? 250, 0.3);
    for (const ev of mix.events) { if (kinds && !kinds.includes(ev.kind)) continue; fire({ t, ...ev }, at + (ev.delay ?? 0)); played.push({ t, ...ev }); }
    if (played.length > 400) played.splice(0, played.length - 400);
    return mix;
  }

  // the owner's trims (the demo's sliders): { hull, load, sails, wind, bus } as multipliers, 1 = as designed
  const trims = { hull: 1, load: 1, sails: 1, wind: 1, bus: 1 };
  function trim(t) {
    Object.assign(trims, t);
    if (g) for (const k of GROUPS) g.group[k].gain.value = trims[k];
  }

  function stats() {
    return { started: !!ctx, t: mix?.t ?? null, load: mix?.load ?? 0, phase: mix?.phase ?? 'stable', gains: mix?.gains ?? null, events: played.slice(-20) };
  }

  return { update, stats, trim, ready: () => ready, mixer };
}
