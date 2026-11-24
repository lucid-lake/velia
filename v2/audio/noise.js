// The beds' source material (v2 step 3): a few seconds of each kind of noise, computed once, looped by
// always-running buffer sources (v2/audio/beds.js). Pure: Float32Arrays from a seed and a sample rate, so node tests and
// the offline render make the same samples. Nothing is recorded; 0 audio bytes ship.
//   white    two independent channels of Gaussian noise (the spray, the whistle's source, the rain's hiss)
//   pink     Kellet's filter bank, two channels, the loop's start cross-faded with what would have followed its end (the
//            wind, the hull's rush)
//   lfo      slow fractal curves, unit variance, two channels; played back at a few to a few hundred samples a second they
//            are the gusts, each ear's buffeting, the bow's gurgle and the flap's jitter
//   patter   sparse grains with a 1.1 ms decay (Cold Smoke's snow coming back down): the rain's drops, the chuckle's bubbles
//
// Ported from Cold Smoke (https://github.com/huiskylabs/cold-smoke, commit eaf635c, src/18_sound.js `material`), MIT:
//   MIT License. Copyright (c) 2026 Huisky. Permission is hereby granted, free of charge, to any person obtaining a copy of
//   this software and associated documentation files (the "Software"), to deal in the Software without restriction,
//   including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
//   of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
//   The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
//   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO
//   THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
//   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
//   OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
// Changes: v1's mulberry32 for the seed; the drop density and grain size of `patter` are parameters (the rain); the creak,
// chirp and pole banks are not ported (the boat's creaks are voices in beds.js).

// mulberry32 (the same generator as src/boatAudio.js rng and Cold Smoke's RNG)
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gaussOf = (r) => () => (r() + r() + r() + r() - 2) * 1.7320508;   // unit variance, bounded at ±3.46

// white: `ch` channels of n samples, RMS 0.25
export function white(n, r, ch = 2) {
  const g = gaussOf(r), out = [];
  for (let c = 0; c < ch; c++) { const d = new Float32Array(n); for (let i = 0; i < n; i++) d[i] = g() * 0.25; out.push(d); }
  return out;
}

// pink: Kellet's bank (Cold Smoke's coefficients and 0.055 scale), the first 50 ms cross-faded with the samples after the end
export function pink(n, r, sr, ch = 2) {
  const g = gaussOf(r), f = Math.round(sr * 0.05), out = [];
  for (let c = 0; c < ch; c++) {
    const x = new Float32Array(n + f), d = new Float32Array(n);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = -4000; i < n + f; i++) {
      const w = g();
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      if (i >= 0) x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.055;
      b6 = w * 0.115926;
    }
    for (let i = 0; i < n; i++) { if (i < f) { const k = (i / f) * Math.PI / 2; d[i] = x[i] * Math.sin(k) + x[n + i] * Math.cos(k); } else d[i] = x[i]; }
    out.push(d);
  }
  return out;
}

// lfo: octaves of smoothed value noise from a period of 128 samples down to 4, each 0.8 of the last, unit variance; the
// curve wraps (its last node is its first), so a looped playback never steps
export function lfo(n, r, ch = 2) {
  const out = [];
  for (let c = 0; c < ch; c++) {
    const d = new Float32Array(n);
    let amp = 1, tot = 0;
    for (let per = 128; per >= 4; per >>= 1) {
      const K = n / per, nodes = new Float32Array(K + 1);
      for (let k = 0; k < K; k++) nodes[k] = r() * 2 - 1;
      nodes[K] = nodes[0];
      for (let i = 0; i < n; i++) { const x = i / per, k = Math.floor(x), f = x - k, u = f * f * (3 - 2 * f); d[i] += amp * (nodes[k] + (nodes[k + 1] - nodes[k]) * u); }
      tot += amp * amp; amp *= 0.8;
    }
    const s = 1 / Math.sqrt(tot / 3);
    for (let i = 0; i < n; i++) d[i] *= s;
    out.push(d);
  }
  return out;
}

// patter: grains at `rate` a second (Poisson), each a cube-weighted kick to an envelope that decays over `decayS`, the envelope
// shaping Gaussian noise. Cold Smoke: 560 a second, 1.1 ms. The rain on the water is dense and fine, on the deck sparse and
// heavier. Each sample is soft-limited at ±0.5 (a grain's peak could reach 3). The first 20 ms are faded in and the last 20 ms out, so the loop's seam has no grain cut in half.
export function patter(n, r, sr, { rate = 560, decayS = 0.0011, gain = 0.55, ch = 2 } = {}) {
  const g = gaussOf(r), dec = Math.exp(-1 / (sr * decayS)), p = rate / sr, f = Math.round(sr * 0.02), out = [];
  for (let c = 0; c < ch; c++) {
    const d = new Float32Array(n);
    let e = 0;
    for (let i = 0; i < n; i++) {
      if (r() < p) { const a = r(); e += a * a * a * 1.7; }
      e *= dec;
      const edge = Math.min(1, i / f, (n - 1 - i) / f);
      const x = g() * e * gain;
      d[i] = edge * 0.5 * Math.tanh(x / 0.5);   // a soft ceiling: a drop's crest stays a tick, not a step (the WAV test's 0.25 a sample)
    }
    out.push(d);
  }
  return out;
}

export const rms = (d) => { let s = 0; for (let i = 0; i < d.length; i++) s += d[i] * d[i]; return Math.sqrt(s / Math.max(1, d.length)); };

// The whole material for one sample rate (beds.js turns each into an AudioBuffer). About 1.3 M samples at 48 kHz; the
// lengths are prime-ish so two loops never line up.
export const MATERIAL = { whiteS: 3.1, pinkS: 4.3, patterS: 2.9, deckS: 3.7, lfoN: 4096 };
export function material(sr, seed = 90210) {
  const r = rng(seed);
  return {
    white: white(Math.round(sr * MATERIAL.whiteS), r),
    pink: pink(Math.round(sr * MATERIAL.pinkS), r, sr),
    lfo: lfo(MATERIAL.lfoN, r),
    patter: patter(Math.round(sr * MATERIAL.patterS), r, sr, { rate: 900, decayS: 0.0011 }),          // the rain on the water, the chuckle's bubbles
    deck: patter(Math.round(sr * MATERIAL.deckS), r, sr, { rate: 70, decayS: 0.0024, gain: 0.9 }),     // the rain on the deck: fewer, heavier drops
  };
}
