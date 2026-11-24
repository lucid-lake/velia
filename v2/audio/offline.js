// The beds rendered offline (an OfflineAudioContext, in a browser): the WAV test (v2/tests/pages/beds.page.mjs), the owner's
// A/B clips and the film's sound (tools/v2-beds-render.mjs, tools/v2-beds-film.mjs). The same mixer, code wind and v1
// recordings on v1's engines as the live page (hybrid), fed a list of frames (BedsMix inputs) at a fixed rate once the files
// are decoded, every parameter scheduled ahead, then rendered at once: deterministic, no wall clock. Not imported by the page.
// `code: true` renders the earlier all-code beds' mask only (the wind), without the recordings.
//   const r = await renderBeds({ frames, fps: 60 });   // → { channels: [L, R], sampleRate, stats }
import { BedsMix } from './bedsMix.js';
import { BoatMix } from '../../src/boatAudio.js';
import { createBeds } from './beds.js';
import { createRecorded } from './recorded.js';

// the voices and one-shots of each bed (an A/B clip plays one bed alone)
export const GROUPS = {
  wind: { gains: ['wind', 'rig', 'whistle'], events: [] },
  hull: { gains: ['chuckle', 'rush', 'roar', 'hiss', 'still', 'lap'], events: ['slap', 'slam'] },
  sails: { gains: ['flutter', 'flog', 'hum', 'note', 'run'], events: ['snap', 'roundup', 'creak', 'sheet', 'stall', 'sigh', 'click', 'sheetCreak'] },
  rain: { gains: ['rain', 'deck'], events: [] },
};
const structuredCloneGains = (m) => ({ ...m, gains: { ...m.gains } });
// the code wind's share of a bed alone: the wind voices for 'wind', nothing for the recorded beds
export function maskMix(m, only) {
  if (!only) return m;
  const keep = new Set(only.flatMap((k) => (k === 'wind' ? GROUPS.wind.gains : []))), ev = new Set(only.flatMap((k) => GROUPS[k].events));
  for (const k of Object.keys(m.gains)) if (k !== 'bus' && !keep.has(k)) m.gains[k] = 0;
  m.events = m.events.filter((e) => ev.has(e.kind));
  return m;
}

export async function renderBeds({ frames, fps = 60, sampleRate = 48000, seed = 1, only = null, master = 0.8, fadeInS = 0.3, base = '/audio/', fetchFn = (u) => fetch(u), waveHit = null, kinds = null, speedFeel = true }) {
  const seconds = (frames.length - 1) / fps;
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(seconds * sampleRate) + 1, sampleRate });
  const out = ctx.createGain(); out.gain.value = master; out.connect(ctx.destination);   // the page's master (v2/engine/audio.js: 0.8)
  const tb = performance.now();
  const beds = createBeds(ctx, { destination: out });
  const buildMs = performance.now() - tb;
  const nodesAfterBuild = beds.nodes;
  const wantRec = !only || only.some((k) => k !== 'wind');
  const rec = wantRec ? createRecorded(ctx, { effects: beds.inputs.effects, ambience: beds.inputs.ambience, base, seed, only, fadeS: 0.03, waveHit, kinds, speedFeel }) : null;
  if (rec) await rec.ready;
  beds.fade(1, 0, fadeInS / 3);
  const mix = new BedsMix({ seed }), times = [], windBoat = rec ? null : new BoatMix({ seed });   // the wind alone: v1's boat mix for the rig, no engine
  let events = 0, dipNow = 1;
  for (let i = 0; i < frames.length; i++) {
    const t0 = performance.now();
    const dp = Number.isFinite(frames[i].dip) ? Math.max(0, Math.min(1, frames[i].dip)) : 1;   // TK: Tessie's drone dips the beds (as the page's)
    if (Math.abs(dp - dipNow) > 0.01 || (dp === 1 && dipNow !== 1)) { dipNow = dp; beds.fade(dipNow, i / fps, 0.15); }
    const m = mix.stepWind(frames[i]);
    mix.withBoat(m, rec ? rec.update(frames[i], m, i / fps) : windBoat.step(frames[i].t, { ...frames[i].state, pitch: frames[i].pitch ?? 0 }, { camDist: frames[i].camDist ?? 20 }));
    events += m.events.length;
    beds.update(maskMix(structuredCloneGains(m), only), i / fps);
    times.push(performance.now() - t0);
  }
  const tr = performance.now();
  const audio = await ctx.startRendering();
  const renderMs = performance.now() - tr;
  times.sort((a, b) => a - b);
  const mean = times.reduce((a, b) => a + b, 0) / times.length;
  return {
    channels: [audio.getChannelData(0), audio.getChannelData(1)], sampleRate,
    stats: { seconds, buildMs, renderMs, nodes: beds.nodes, nodesAfterBuild, sets: beds.sets, bytes: rec?.bytes ?? 0, files: rec?.files ?? [], events, frames: frames.length, updateMsMean: mean, updateMsP99: times[Math.floor(times.length * 0.99)], updateMsMax: times[times.length - 1] },
  };
}

// the checks the WAV test makes (pure: node tests the meter on synthetic signals)
export function meter(channels, sampleRate, { silenceDb = -60, windowS = 0.05 } = {}) {
  let peak = 0, step = 0, sum = 0, n = 0;
  for (const d of channels) for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) peak = a; if (i) { const s = Math.abs(d[i] - d[i - 1]); if (s > step) step = s; } sum += d[i] * d[i]; n++; }
  // the longest run of 50 ms windows under silenceDb (both channels)
  const w = Math.round(windowS * sampleRate), thr = 10 ** (silenceDb / 20);
  let run = 0, longest = 0;
  for (let i = 0; i + w <= channels[0].length; i += w) {
    let e = 0; for (const d of channels) for (let j = i; j < i + w; j++) e += d[j] * d[j];
    const r = Math.sqrt(e / (w * channels.length));
    run = r < thr ? run + 1 : 0; longest = Math.max(longest, run);
  }
  // loudness: K-weighting is approximated by the plain RMS (dBFS) and, beside it, a gated RMS over 400 ms blocks (−70 abs,
  // −10 relative: BS.1770's gates without its filter)
  const blk = Math.round(0.4 * sampleRate), blocks = [];
  for (let i = 0; i + blk <= channels[0].length; i += blk / 4) { let e = 0; for (const d of channels) for (let j = i; j < i + blk; j++) e += d[j] * d[j]; blocks.push(e / (blk * channels.length)); }
  const abs = blocks.filter((e) => 10 * Math.log10(e + 1e-20) > -70), mAbs = abs.reduce((a, b) => a + b, 0) / Math.max(1, abs.length);
  const rel = abs.filter((e) => e > mAbs * 0.1), mRel = rel.reduce((a, b) => a + b, 0) / Math.max(1, rel.length);
  return { peakDb: 20 * Math.log10(peak + 1e-20), maxStep: step, rmsDb: 10 * Math.log10(sum / n + 1e-20), gatedDb: 10 * Math.log10(mRel + 1e-20), longestSilenceS: longest * windowS };
}

// a 16-bit PCM WAV (interleaved) as bytes
export function wavBytes(channels, sampleRate) {
  const n = channels[0].length, ch = channels.length, b = new ArrayBuffer(44 + n * ch * 2), v = new DataView(b);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + n * ch * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * ch * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) { const x = Math.max(-1, Math.min(1, channels[c][i])); v.setInt16(o, Math.round(x * 32767), true); o += 2; }
  return new Uint8Array(b);
}
