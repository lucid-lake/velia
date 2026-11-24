// Regatta's adaptive score (owner, 2026-10-30): the pre-start piece builds for the 60 s of the countdown, a 1.5 s crossfade at the
// gun into the race loop, a lift on the final leg or when the gap is under 10 s, a duck under the race officer (the skipper's voice
// ducks the music bus already: src/audio.js), a fade out at the finish into the results card. The state machine (createScore) is
// pure: tests/race-music.test.mjs; createRaceMusic plays it on the music bus. The score owns the bus from each piece it
// starts (src/audio.js claimMusic: Sail's bed fades out; the bar's next-song tap takes the bus back and the score fades
// out until its next cue); it keeps the bus through the results card (silence, no bed) and gives it back when the mode goes.
//   const score = createScore();  const a = score.step(dt, { clock, over, finalLeg, gapS, voice });  // → { state, preOffsetS, xfade, lift, duck, events }
import { decodeFile } from '../../../../src/audioFormat.js';

export const SCORE = { xfadeS: 1.5, outS: 3, liftDb: 2, liftHz: [3200, 18000], liftGapS: 10, liftTauS: 2, duckDb: -6, duckAttackS: 0.3, duckReleaseS: 1.2, loopFromS: 24, loopXfadeS: 2 };
export const URLS = { prestart: '/audio/music/race_prestart_a.opus', race: '/audio/music/race_main_a.opus' };

export function createScore({ S = SCORE } = {}) {
  let state = 'idle', lastClock = null, lift = 0, liftOn = false, duck = 0;
  return {
    // input: { clock (s, < 0 before the gun), over (the card is up), finalLeg, gapS (null before both boats have a split), voice (the officer is on the radio) }
    step(dt, { clock, over = false, finalLeg = false, gapS = null, voice = false } = {}) {
      const events = [];
      if (lastClock != null && clock < lastClock - 1) { state = 'idle'; lift = 0; liftOn = false; events.push('restart'); }   // R: back to -60 s
      lastClock = clock;
      let xfade = 0, preOffsetS = 0;
      if (over) { if (state !== 'out') { state = 'out'; events.push('out'); xfade = S.outS; } }
      else if (state === 'idle') { state = clock < 0 ? 'prestart' : 'race'; preOffsetS = Math.max(0, 60 + clock); events.push(state === 'prestart' ? 'prestart' : 'race'); }
      else if (state === 'prestart' && clock >= 0) { state = 'race'; xfade = S.xfadeS; events.push('race'); }
      // the lift: the final leg, or a close race (hysteresis: on under 10 s, off over 14 s); only while racing
      const racing = state === 'race', was = liftOn;
      liftOn = racing && (finalLeg || (gapS != null && gapS < (liftOn ? S.liftGapS + 4 : S.liftGapS)));
      if (liftOn !== was) events.push(liftOn ? 'lift' : 'unlift');
      lift += ((liftOn ? 1 : 0) - lift) * (1 - Math.exp(-dt / S.liftTauS));
      const target = voice ? 1 : 0, tau = target > duck ? S.duckAttackS : S.duckReleaseS;
      duck += (target - duck) * (1 - Math.exp(-dt / tau));
      return { state, preOffsetS, xfade, lift, liftOn, duck, duckDb: S.duckDb * duck, liftDb: S.liftDb * lift, cutoffHz: S.liftHz[0] + (S.liftHz[1] - S.liftHz[0]) * lift, events };
    },
    get state() { return state; },
  };
}

// the player: two pieces on the music bus (audio.attach(..., 'music')); everything but the decoding follows the score's actions
export function createRaceMusic({ audio, urls = URLS, fetchFn = globalThis.fetch?.bind(globalThis), S = SCORE } = {}) {
  const score = createScore({ S });
  let ctx = null, out = null, duckG = null, lp = null, liftG = null, bufs = {}, cur = null, errors = [], gen = 0;
  // the score as the music bus's player: another owner's claim fades the piece playing and cancels a piece still decoding
  const player = { name: 'regatta', release(s) { gen++; stopPiece(cur, s); cur = null; } };
  const PIECE = ['restart', 'prestart', 'race', 'out'];
  const gainTo = (g, v, s) => { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(v, t + Math.max(0.02, s)); };
  const load = (k) => (bufs[k] ??= decodeFile(ctx, fetchFn, urls[k], undefined, { mono: false }).catch((e) => { errors.push(String(e.message ?? e)); return null; }));
  function play(k, buf, { offset = 0, fadeS = 0.05, loop = false }) {
    if (!buf) return null;
    const g = new GainNode(ctx, { gain: 0 }), src = new AudioBufferSourceNode(ctx, { buffer: buf });
    if (loop) { src.loop = true; src.loopStart = S.loopFromS; src.loopEnd = buf.duration; }
    src.connect(g); g.connect(liftG);
    const t = ctx.currentTime; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + Math.max(0.02, fadeS));
    src.start(t, Math.min(offset, buf.duration - 0.1));
    const p = { k, src, g }; return p;
  }
  const stopPiece = (p, s) => { if (!p) return; gainTo(p.g, 0, s); try { p.src.stop(ctx.currentTime + s + 0.1); } catch { /* ended */ } };
  // a piece cue cancels any earlier cue still decoding (gen): only the newest one starts
  async function act(a) {
    const g = a.events.some((ev) => PIECE.includes(ev)) ? ++gen : gen;
    for (const ev of a.events) {
      if (ev === 'restart') { stopPiece(cur, 0.3); cur = null; }
      if (ev === 'prestart') { const b = await load('prestart'); if (g !== gen) return; stopPiece(cur, 0.3); cur = play('prestart', b, { offset: a.preOffsetS, fadeS: 1.5 }); }
      if (ev === 'race') { const b = await load('race'); if (g !== gen) return; stopPiece(cur, a.xfade || S.xfadeS); cur = play('race', b, { fadeS: a.xfade || S.xfadeS, loop: true }); }
      if (ev === 'out') { stopPiece(cur, a.xfade || S.outS); cur = null; }
    }
  }
  return {
    score,
    start() { audio.attach(({ ctx: c, master }) => {
      ctx = c; out = new GainNode(ctx, { gain: 1 }); duckG = new GainNode(ctx, { gain: 1 }); lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: S.liftHz[0], Q: 0.5 }); liftG = new GainNode(ctx, { gain: 1 });
      liftG.connect(lp); lp.connect(duckG); duckG.connect(out); out.connect(master);
    }, 'music'); },
    update(dt, input) {
      const a = score.step(dt, input);
      if (!ctx) return a;
      duckG.gain.setTargetAtTime(Math.pow(10, a.duckDb / 20), ctx.currentTime, 0.1);
      liftG.gain.setTargetAtTime(Math.pow(10, a.liftDb / 20), ctx.currentTime, 0.2);
      lp.frequency.setTargetAtTime(a.cutoffHz, ctx.currentTime, 0.3);
      if (a.events.some((ev) => ev === 'prestart' || ev === 'race')) audio.claimMusic?.(player);   // a piece cue: the bus is the score's
      if (a.events.length) act(a);
      return a;
    },
    stop() { gen++; try { stopPiece(cur, 0.5); } catch { /* not started */ } cur = null; audio.yieldMusic?.(player); },
    get errors() { return errors; },
  };
}
