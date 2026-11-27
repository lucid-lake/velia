// The beds' recorded half (step 3, hybrid; the owner, 2026-11-13: the code hull, sails and rain "very poor, not like real",
// "hybrid sound"): the hull and water, the sails, the load and the controls play v1's own recordings on v1's own engines, so
// the triggers, the levels and the files are v1's exactly; the wind stays code (v2/audio/beds.js).
//   src/boatAudio.js createBoatAudio   audio/boat: hull_chuckle, hull_rush (and the surf's roar from it), sail_flutter,
//                                      sail_flog, creak_rig, creak_sheet, sail_snap; v1's synthesised hum, Aeolian note, sigh
//                                      and water hits (slaps, slams: v1 has no recording of them). Its wind group (the rig's
//                                      recorded rush and v1's whistle) is trimmed to 0: beds.js's code wind has its own rig.
//   src/sfx.js createSfx               audio/sfx: winch_click, sheet_run, wheel_creak (and the boat's creak_sheet, hull_chuckle)
//   src/audio.js's lake loops          audio/lake_lap, audio/rain_water, audio/birds_dawn, audio/loon at mixAt's gains (BedsMix
//                                      gains.lap, gains.rain, gains.birds, gains.loon: S1a, the dawn chorus 05:54–08:30 and the
//                                      loons at night and twilight, v1's LEVEL × its windows)
// Files load after the first gesture (the page's context exists only then), through src/audioFormat.js (Opus, the AAC twin
// where Opus does not decode: Safari), each fetched once, by v1's paths: a later compressed set at the same paths needs no change
// here. Everything enters beds.js's effects and ambience inputs through a gain held at 0 until the files are in, then faded up
// over ≈ 0.3 s (no loop starts with a step). v1's engines make no node on a frame without an event; a one-shot (a creak, a
// snap, a click, a water hit) makes its source and gain (a water hit ≈ 16 nodes), as in v1.
//   const rec = createRecorded(ctx, { effects: beds.inputs.effects, ambience: beds.inputs.ambience });
//   await rec.ready;  const boatMix = rec.update(input, mix, at)   // input: BedsMix's; mix: BedsMix.stepWind's (rough, lap, rain)
import { createBoatAudio } from '../../src/boatAudio.js';
import { createSfx } from '../../src/sfx.js';
import { decodeFile } from '../../src/audioFormat.js';
import { createSpeedSound } from './speedSound.js';
import { createKnockdownSound } from './knockdownSound.js';   // K2: the knockdown's sound on the same layers (input.kdRoll; nothing under 40°)

export const AMB_LOOPS = ['lake_lap', 'rain_water', 'birds_dawn', 'loon'];
// one bed alone (the owner's A/B clips): v1's group trims and lake loops by bed
const TRIM_BY_BED = { hull: ['hull'], sails: ['sails', 'load'], rain: [], wind: [] };
const AMB_BY_BED = { hull: ['lake_lap'], rain: ['rain_water'], sails: [], wind: [] };

// the bow's wave hits (?wavehit=, fix/v2-wave-hit-sound 2026-11-15: v1's layered noise hits were heard as metal): rec a recorded
// slap of water on a hull (audio/boat/hull_slap, CC0), synth soft low-passed noise, today v1's hits, off none (src/boatAudio.js)
export const WAVE_HIT = Object.freeze({ modes: ['rec', 'synth', 'today', 'off'], dflt: 'rec' });
export const waveHitMode = (v) => (WAVE_HIT.modes.includes(v) ? v : WAVE_HIT.dflt);

// groove(t): the boat engine's 'swell' event (the groove held 8 s) goes to the music's scheduler (v1: createBoatAudio's audio.groove)
// speedFeel: the speed feel's sound (v2/audio/speedSound.js: v1's rush, hiss and hum re-weighted by the speed and the heel; no node
// added); false is ?speedfeel=0's sound, v1's mix as it was
export function createRecorded(ctx, { effects, ambience, base = 'audio/', seed = 1, fetchFn = (u) => fetch(u), only = null, fadeS = 0.3, groove = null, waveHit = null, kinds = null, speedFeel = true, rain = true } = {}) {   // rain: false (no storm on this device): the rain loop never fetched
  const feel = createSpeedSound({ on: speedFeel });
  const kdSound = createKnockdownSound({ seed });
  const adjust = (mix, st) => { feel.adjust?.(mix, st); if (st.kdRoll > 0 || kdSound.layers.k > 0) kdSound.adjust(mix, st); return mix; };   // the speed feel, then the knockdown
  const files = new Map();   // url → Promise<ArrayBuffer>: one fetch per file
  let bytes = 0;
  const fetchOnce = (u) => {
    if (!u) return Promise.reject(new Error('no file'));
    if (!files.has(u)) files.set(u, Promise.resolve(fetchFn(u)).then(async (r) => { if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`); const ab = await r.arrayBuffer(); bytes += ab.byteLength; return ab; }));
    return files.get(u).then((ab) => ({ ok: true, status: 200, arrayBuffer: async () => ab.slice(0) }), (e) => { throw e; });
  };
  const inE = ctx.createGain(), inA = ctx.createGain();
  inE.gain.value = 0; inA.gain.value = 0; inE.connect(effects); inA.connect(ambience);
  const wantBoat = !only || only.some((k) => TRIM_BY_BED[k].length), wantSfx = !only || only.includes('sails');
  const boat = wantBoat ? createBoatAudio({ ctx, destination: inE, base: `${base}boat/`, windUrl: null, seed, fetchFn: fetchOnce, waveHit: waveHitMode(waveHit), kinds, ...(groove ? { audio: { groove } } : {}) }) : null;
  const keep = only ? new Set(only.flatMap((k) => TRIM_BY_BED[k])) : null;
  boat?.trim(Object.fromEntries(['hull', 'load', 'sails', 'wind'].map((k) => [k, k !== 'wind' && (!keep || keep.has(k)) ? 1 : 0])));
  const sfx = wantSfx ? createSfx({ ctx, destination: inE, base: `${base}sfx/`, boatBase: `${base}boat/`, windUrl: null, seed, preload: false, fetchFn: fetchOnce }) : null;
  const ambKeep = only ? new Set(only.flatMap((k) => AMB_BY_BED[k])) : new Set(AMB_LOOPS);
  if (!rain) ambKeep.delete('rain_water');
  const amb = {};
  const ambReady = Promise.all(AMB_LOOPS.filter((k) => ambKeep.has(k)).map(async (k) => {
    const buf = await decodeFile(ctx, fetchOnce, `${base}${k}.opus`);
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(inA);
    const filter = k === 'lake_lap' ? ctx.createBiquadFilter() : null;
    if (filter) { filter.type = 'lowpass'; filter.frequency.value = 12000; filter.Q.value = 0.5; filter.connect(gain); }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.connect(filter ?? gain); src.start(0, 0);
    amb[k] = { gain, filter, v: NaN, f: NaN };
  })).catch(() => {});
  const ready = Promise.all([boat?.ready(), sfx?.ready(), ambReady]).then(() => {
    const t = ctx.currentTime;
    for (const g of [inE, inA]) g.gain.setTargetAtTime(1, t, fadeS / 3);
  });
  const set = (o, key, p, v, at, tau) => { if (Math.abs(v - o[key]) <= 0.006 * Math.max(Math.abs(v), Math.abs(o[key]) || 0, 0.02)) return; o[key] = v; p.setTargetAtTime(v, at, tau); };
  return {
    ready,
    update(inp, mix, at = ctx.currentTime) {
      const s = inp.state ?? {};
      const bm = boat?.update(inp.t ?? 0, { ...s, pitch: inp.pitch ?? s.pitch ?? 0, seaRough: mix.rough ?? 0, heelDrawn: inp.heelDrawn ?? s.heel ?? 0, kdRoll: inp.kdRoll ?? 0, kdT: inp.t ?? 0, simT: inp.t }, { camDist: inp.camDist ?? 20, extra: inp.gustEvents ?? undefined, rushMul: inp.rushMul ?? undefined, adjust }, at);   // audit W4: the gust's snap and rush (v1's opts); the speed feel's re-weighting
      sfx?.update(inp.wallT ?? inp.t ?? 0, { pull: inp.pull ?? 0, sheet: inp.sheet ?? null, rudder: inp.rudder ?? 0, steer: inp.steer ?? 0, sog: s.sog ?? 0, load: Math.hypot(s.drive ?? 0, s.side ?? 0) / 2000 }, at);
      if (amb.lake_lap) { set(amb.lake_lap, 'v', amb.lake_lap.gain.gain, mix.gains.lap, at, 0.4); set(amb.lake_lap, 'f', amb.lake_lap.filter.frequency, mix.hz.lap, at, 0.4); }
      if (amb.rain_water) set(amb.rain_water, 'v', amb.rain_water.gain.gain, mix.gains.rain, at, 0.4);
      if (amb.birds_dawn) set(amb.birds_dawn, 'v', amb.birds_dawn.gain.gain, mix.gains.birds ?? 0, at, 0.4);   // S1a: v1's chorus (src/audio.js mixAt)
      if (amb.loon) set(amb.loon, 'v', amb.loon.gain.gain, mix.gains.loon ?? 0, at, 0.4);
      return bm ?? null;   // v1's boat mix this frame (its rig, whistle, bus and distance drive the code wind's rig)
    },
    // a one-off cue on v1's sfx (src/sfx.js cue): 'thud' { v, mat } (L3: a bump against the show's barges, v1's player.cue)
    cue(kind, o = {}, at = ctx.currentTime) { return sfx?.cue?.(kind, o, at) ?? null; },
    get bytes() { return bytes; },
    get files() { return [...files.keys()]; },
    stats: () => ({ boat: boat?.stats() ?? null, sfx: sfx?.stats() ?? null, feel: feel.on ? { ...feel.layers } : null }),
    feel,   // the speed feel's switch (feel.on) and this frame's layers
    kdSound,   // K2: the knockdown's layers this frame (k, slams, snaps)
  };
}
