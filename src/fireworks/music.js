// The fireworks evening's music (S4, owner picks 2026-11-08), on src/audio.js's music bus (the menu's music switch,
// the bar's volume and M all apply; the bus has one owner at a time: claimMusic / yieldMusic):
//   Sail     the show has its natural sound only; "Over The Clouds" (Marcelo Fernandez, CC BY 4.0, the loop version) fades in
//            as the finale's echoes die and plays on through the drift home, then fades out at 23:10 (the moonrise's hour).
//   score    "Full Moon" (Marcelo Fernandez, CC BY 4.0) is the show's score: from 75 s of the show so its 3:38 ends with the
//            finale's climax. Cruise's show score (S5 switches it on). It ducks a little under
//            the big bursts (−2 to −6 dB), never over them.
//   radio    the boat's radio, off by default (Settings › sound › radio, shown on the show's evening; no key): the two Sousa
//            marches by the US Marine Band (public domain), quiet, through a small cockpit speaker (band-passed, a touch of
//            grit). It plays whenever it is on and is the player's choice: it wins over the two above.
//   hush     Cruise with the score (S5: on in Cruise): from 20 s before the show to the score, the bus is held silent (the
//            playlist fades out; the opening has its natural sound only), then "Full Moon"; after it the bus goes back
//            and Cruise starts its playlist again (src/modes/chill/index.js).
// The plan (musicWant) is plain JS; tests/fireworksSound.test.mjs drives it. `mode` and `score` may be functions (the mode
// changes on Cruise's hand-over).
import { SHOW_START_HOUR } from './show.js';

export const TRACKS = {
  home: 'over_the_clouds', score: 'full_moon', radio: ['radio_stars_and_stripes', 'radio_semper_fidelis'],
};
export const MUSIC = {
  home: { fromShowT: 299, untilHour: 23 + 10 / 60, fadeInS: 9, fadeOutS: 10, level: 0.8 },
  score: { fromShowT: 75, lengthS: 218, fadeInS: 5, fadeOutS: 4, level: 0.7 },
  hush: { fromShowT: -20, fadeOutS: 0 },
  radio: { level: 0.32, lowHz: 380, highHz: 3200 },
  duck: { minGain: 0.45, db: [-2, -6], holdS: 0.25, releaseS: 0.7 },
};
// show s → game hour (the show's clock: 4 game s a show s from 21:44; src/fireworks/world.js)
export const hourOfShow = (t) => SHOW_START_HOUR + (t * 4) / 3600;

// What should play now: { want: 'radio' | 'score' | 'home' | null, offset (s into the piece, the score only) }.
// showT: the show clock (or null outside its window); hour: the game's clock; mode: 'sail' | 'cruise' | …
export function musicWant({ showT = null, hour = 12, mode = 'sail', score = false, radio = false, off = false }) {
  if (off) return { want: null };
  if (radio) return { want: 'radio' };
  const S = MUSIC.score;
  if (score && showT != null && showT >= S.fromShowT && showT < S.fromShowT + S.lengthS) return { want: 'score', offset: showT - S.fromShowT };
  if (score && mode === 'cruise' && showT != null && showT >= MUSIC.hush.fromShowT && showT < S.fromShowT) return { want: 'hush' };
  if (mode !== 'cruise' && hour >= hourOfShow(MUSIC.home.fromShowT) && hour < MUSIC.home.untilHour) return { want: 'home' };
  return { want: null };
}
// the duck under a burst arriving with cue gain g (SOUND scale): 0 dB under minGain, then −2 to −6 dB
export function duckDb(g) {
  const D = MUSIC.duck;
  if (g < D.minGain) return 0;
  const k = Math.min(1, (g - D.minGain) / 1.2);
  return D.db[0] + (D.db[1] - D.db[0]) * k;
}

// a small speaker's grit (a WaveShaper curve: a soft tanh)
function gritCurve(n = 1025, drive = 2.2) { const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / Math.tanh(drive); } return c; }

// One piece's chain on a context: src → (radio: band-pass, grit) → fade → duck → dest. Returns { src, fade, duck }.
export function pieceChain(ctx, buf, dest, { radio = false, loop = false } = {}) {
  const src = new AudioBufferSourceNode(ctx, { buffer: buf, loop });
  const fade = new GainNode(ctx, { gain: 0 }), duck = new GainNode(ctx, { gain: 1 });
  let head = src;
  if (radio) {
    const hp = new BiquadFilterNode(ctx, { type: 'highpass', frequency: MUSIC.radio.lowHz, Q: 0.7 });
    const lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: MUSIC.radio.highHz, Q: 0.9 });
    const peak = new BiquadFilterNode(ctx, { type: 'peaking', frequency: 1400, Q: 1.2, gain: 4 });   // the cone's honk
    const sh = new WaveShaperNode(ctx, { curve: gritCurve() });
    head = src.connect(hp).connect(peak).connect(lp).connect(sh);
  }
  head.connect(fade).connect(duck).connect(dest);
  return { src, fade, duck };
}

export function createFireworksMusic({ audio = null, base = '/audio/fireworks/music/', mode = 'sail', score = false, off = false, radioOn = () => false,
  fetchFn = globalThis.fetch?.bind(globalThis), decode = null } = {}) {
  let ctx = null, dest = null, now = null, radioIdx = 0, gen = 0, radioEnded = false;
  const modeOf = () => (typeof mode === 'function' ? mode() : mode), scoreOf = () => (typeof score === 'function' ? score() : score);
  const bufs = {}, dec = decode ?? (async (c, f, url) => (await import('../audioFormat.js')).decodeFile(c, f, url, undefined, { mono: false }));
  // another player took the bus (Cruise's playlist, the bar's next-song tap): this one lets go and waits for its next want
  const player = { name: 'fireworks', release: (s) => stop(s) };
  audio?.attach?.(({ ctx: c, master }) => { ctx = c; dest = master; }, 'music');
  const buffer = (name) => (bufs[name] ??= dec(ctx, fetchFn, `${base}${name}.opus`).catch(() => null));

  function stop(s = 1) {
    gen++;
    if (!now || !ctx || !now.fade) { now = null; return; }   // the hush has no piece
    const t = ctx.currentTime, n = now;
    try { n.fade.gain.cancelScheduledValues(t); n.fade.gain.setValueAtTime(n.fade.gain.value, t); n.fade.gain.linearRampToValueAtTime(0, t + s); n.src.stop(t + s + 0.1); } catch { /* ended */ }
    now = null;
  }
  async function start(want, offset = 0) {
    const g = ++gen;
    if (want === 'hush') { audio?.claimMusic?.(player); now = { want, name: null, src: null, fade: null, duck: null }; return; }
    const name = want === 'radio' ? TRACKS.radio[radioIdx % TRACKS.radio.length] : TRACKS[want];
    const buf = await buffer(name);
    if (g !== gen || !buf || !ctx) return;
    audio?.claimMusic?.(player);   // the beds (or another player) fade out; this piece has the bus
    const radio = want === 'radio', P = radio ? MUSIC.radio : MUSIC[want];
    const n = pieceChain(ctx, buf, dest, { radio, loop: want === 'home' });
    const t = ctx.currentTime, fin = radio ? 1.2 : P.fadeInS;
    n.fade.gain.setValueAtTime(0, t); n.fade.gain.linearRampToValueAtTime(P.level, t + fin);
    const off0 = Math.max(0, Math.min(offset, buf.duration - 1));
    n.src.start(t, off0);
    if (want === 'score') { const left = buf.duration - off0; n.fade.gain.setValueAtTime(P.level, t + Math.max(fin, left - P.fadeOutS)); n.fade.gain.linearRampToValueAtTime(0, t + left); }
    if (radio) n.src.onended = () => { if (now?.src === n.src) { now = null; radioIdx++; radioEnded = true; } };   // the next march at the next frame
    now = { ...n, want, name };
  }

  // every frame: the show clock and the game hour. `target`: what was last asked to play (its decode may still run)
  let target = null;
  const fadeFor = (w) => (w === 'home' ? MUSIC.home.fadeOutS : w === 'score' ? MUSIC.score.fadeOutS : w === 'hush' ? 0 : 0.8);
  function update({ showT = null, hour = 12 } = {}) {
    if (!ctx || ctx.state !== 'running') return;
    if (target === 'radio' && !now && radioEnded) { radioEnded = false; target = null; }   // a march ended: the next one
    const w = musicWant({ showT, hour, mode: modeOf(), score: scoreOf(), radio: radioOn(), off });
    if (w.want === target) return;
    const was = target;
    if (was) stop(fadeFor(was));
    target = w.want;
    if (w.want) start(w.want, w.offset ?? 0);
    else audio?.yieldMusic?.(player);   // the bus back to the beds
  }
  // a dip under a big burst arriving at context time `when` (src/fireworks/sound.js onBang)
  function duck(when, gain) {
    if (!now?.duck || !ctx || now.want === 'home') return;
    const db = duckDb(gain);
    if (!db) return;
    const g = now.duck.gain, v = 10 ** (db / 20);
    g.setTargetAtTime(v, when, 0.02); g.setTargetAtTime(1, when + MUSIC.duck.holdS, MUSIC.duck.releaseS / 3);
  }
  // prefetch the piece the evening will want next (before it is due), so it starts on time
  function prefetch(hour) { if (ctx && !off && hour > 21.5 && hour < MUSIC.home.untilHour) { buffer(TRACKS.home); if (scoreOf()) buffer(TRACKS.score); } }
  return { update, duck, prefetch, stop, get playing() { return now ? { want: now.want, name: now.name } : null; }, player };
}
