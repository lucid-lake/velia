// The storm's sound (wow/storm): thunder, synthesised (no file), on src/audio.js's context through audio.attach, and
// the rain bed (the CC0 rain_water loop the mixer already has: worldState's rain, src/audio.js mixAt).
//
// Thunder: a strike's sound reaches the listener after distance / 343 m/s (stormArc.js thunderOf) and rolls on until
// the far end of the channel has arrived (its top, ≈ 4.5 km up). Near (under ≈ 1.5 km): a sharp crack first, then the
// boom. Far: low and soft, the highs gone (air absorbs them, ≈ 1 dB per 100 m above 2 kHz). Every one echoes off the
// bay's granite walls: three late taps, lower and duller. The waveform is computed here in plain JS from the strike's
// seed (a small LCG, no Math.random()), so a page and an OfflineAudioContext (tools/storm_film.mjs) make the same sound.

// a deterministic LCG in [0, 1)
const lcg = (seed) => { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
const ECHOES = [[0.55, 0.32, 0.6], [1.35, 0.22, 0.45], [2.4, 0.14, 0.3]];   // [delay s, gain, lowpass memory] off the bay's walls

// the thunder's samples (mono Float32Array) at sampleRate: { distM, rollS, level, seed }
export function thunderSamples({ distM = 3000, rollS = 6, level = 1, seed = 1 }, sampleRate = 24000) {
  const rnd = lcg(seed * 2654435761);
  const near = Math.max(0, 1 - distM / 2000);            // the crack's share
  const tail = Math.min(14, rollS + 3.5), echoEnd = ECHOES.at(-1)[0];
  const n = Math.ceil((tail + echoEnd) * sampleRate), out = new Float32Array(n);
  // the rumble's own swells: 4–7 bursts across the roll (the channel's parts arriving one after another)
  const swells = [];
  const k = 4 + Math.floor(rnd() * 4);
  for (let i = 0; i < k; i++) swells.push({ at: (i / k) * rollS * (0.6 + rnd() * 0.5) + 0.12 * near, w: 0.4 + rnd() * 1.2, a: (i === 0 ? 1 : 0.35 + rnd() * 0.65) });
  // the low-pass: lower and duller with distance (≈ 900 Hz near, ≈ 140 Hz past 8 km)
  const fc = 140 + 760 * Math.exp(-distM / 2500), a1 = Math.exp(-2 * Math.PI * fc / sampleRate);
  const a2 = Math.exp(-2 * Math.PI * 60 / sampleRate);   // the deep body: a second, lower pole
  const rise = 0.04 + 0.5 * Math.min(1, distM / 6000);   // a far one swells in; a near one hits
  let y1 = 0, y2 = 0, brown = 0;
  const dry = new Float32Array(Math.ceil(tail * sampleRate));
  for (let i = 0; i < dry.length; i++) {
    const t = i / sampleRate, w = rnd() * 2 - 1;
    brown = 0.985 * brown + 0.06 * w;
    y1 = a1 * y1 + (1 - a1) * w;
    y2 = a2 * y2 + (1 - a2) * brown;
    let env = 0;
    for (const s of swells) { const x = (t - s.at) / s.w; if (x > -0.15) env += s.a * (x < 0 ? (x + 0.15) / 0.15 : Math.exp(-x * 1.6)); }
    env *= Math.min(1, t / rise) * (1 - Math.min(1, Math.max(0, (t - tail + 1.5) / 1.5)));
    const crack = near > 0 && t < 0.35 ? near * w * Math.exp(-t / 0.05) * 4 : 0;   // a ripping crack, then the boom
    dry[i] = (y1 * 2.2 + y2 * 5.0) * env + crack;
  }
  // the echoes off the walls: later, quieter, duller
  for (let i = 0; i < dry.length; i++) out[i] += dry[i];
  for (const [d, g, mem] of ECHOES) {
    const o = Math.round(d * sampleRate);
    let z = 0;
    for (let i = 0; i < dry.length; i++) { z = mem * z + (1 - mem) * dry[i]; out[i + o] += z * g; }
  }
  // normalise to the level (peak ≈ 0.7 × level)
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const s = (0.7 * level) / peak;
  for (let i = 0; i < n; i++) out[i] *= s;
  return out;
}

// plays thunder on a Web Audio context (live: src/audio.js's, through attach; films: an OfflineAudioContext)
// worker (live pages; fix/first-visit-hitches): the samples are computed in src/weather/thunderWorker.js (40–90 ms of
// JavaScript a strike froze a frame on the main thread), then played at `at`, or at once if they come back after it
// (the sound's delay is distance / 343 m/s). play() then returns null. Films and tests compute in place (worker: false).
const workerWanted = (ctx) => typeof Worker === 'function' && !(typeof OfflineAudioContext === 'function' && ctx instanceof OfflineAudioContext);
export function createThunder(ctx, dest, { sampleRate = Math.min(24000, ctx.sampleRate), gain = 1, worker = workerWanted(ctx) } = {}) {
  const bus = new GainNode(ctx, { gain });
  bus.connect(dest);
  const live = new Set();
  function start(at, data) {
    const buf = new AudioBuffer({ length: data.length, sampleRate, numberOfChannels: 1 });
    buf.copyToChannel(data, 0);
    const src = new AudioBufferSourceNode(ctx, { buffer: buf });
    src.connect(bus);
    src.start(Math.max(ctx.currentTime, at));
    live.add(src);
    src.onended = () => { live.delete(src); src.disconnect(); };
    return src;
  }
  // the worker, made now (its module is fetched long before the first strike); a failure computes in place
  let wk = null, nextId = 1, gen = 0;
  const pending = new Map();
  if (worker) {
    try {
      wk = new Worker(new URL('./thunderWorker.js', import.meta.url), { type: 'module' });
      wk.onmessage = (e) => { const p = pending.get(e.data.id); pending.delete(e.data.id); if (p && p.gen === gen) start(p.at, e.data.d); };
      wk.onerror = () => { wk = null; for (const p of pending.values()) if (p.gen === gen) start(p.at, thunderSamples(p.t, sampleRate)); pending.clear(); };
    } catch { wk = null; }
  }
  return {
    // at: the context's time; t: { distM, rollS, level, seed }
    play(at, t) {
      if (wk) { const id = nextId++; pending.set(id, { at, t, gen }); wk.postMessage({ id, t, sampleRate }); return null; }
      return start(at, thunderSamples(t, sampleRate));
    },
    stop() { gen++; pending.clear(); for (const s of live) { try { s.stop(); } catch { /* done */ } } live.clear(); },
    bus,
  };
}
