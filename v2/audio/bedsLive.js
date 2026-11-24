// The beds on a live page (v2 step 3, hybrid): the mixer, the code wind (beds.js) and v1's recordings on v1's engines
// (recorded.js) on the page's AudioContext (v2/engine/audio.js: made on the first gesture, so the files load after the first
// frame), v1's Settings (sound: all; effects: the boat), and the hide fade. A headless capture never makes one, so
// captures stay silent and every frame is unchanged (the goldens).
//   const beds = createBedsLive({ audio, settings });   // after createAudio
//   beds.update(input | () => input);                   // every frame (BedsMix.step's input, or a function making it), after the boat steps
//   beds.stats()                                        // { on, nodes, sets, fired, mainMs: { mean, max, frames, windows } }
// mainMs.windows: the means of the last 32 runs of 15 frames (ms), so a check can judge the quiet windows: a loaded machine
// only adds time, in a few preempted frames (backlog v2 #54; tests/helpers/bestOf.mjs does the same for the fast suites).
import { BedsMix } from './bedsMix.js';
import { createBeds } from './beds.js';
import { createRecorded } from './recorded.js';

export function createBedsLive({ audio, settings = null, seed = 1, base = 'audio/', fetchFn = (u) => fetch(u), doc = globalThis.document, now = () => performance.now(), groove = null, waveHit = null, speedFeel = true, rain = true }) {   // rain: false where the storm is off (a phone, src/core/features.js storm): no rain loop fetched
    // speedFeel: v2/audio/speedSound.js (false: ?speedfeel=0)   // groove(t): v1's boat engine's swell event to the music (v2/audio/music.js)
  const mix = new BedsMix({ seed });
  let beds = null, rec = null, ctx = null, hideT = 0, last = null, inp = null;
  let dipNow = 1;   // TK: the input's dip (Tessie's drone: the wind and water under it), on the beds' out fade while visible
  const attached = [];   // #14: more of v1's sound on the boat's bus (the engine and the chain: v2/audio/engine.js)
  const ms = { n: 0, sum: 0, max: 0, wSum: 0, wN: 0, windows: [] };
  const WIN = 15, WINS = 32;
  const visible = () => !doc || doc.visibilityState !== 'hidden';
  const sw = (k) => (settings ? settings.get(k) !== false : true);
  audio.ready.then(({ ctx: c, master }) => {
    ctx = c;
    // the material and the graph after the first frame, in the gesture's task (≈ 1.3 M noise samples at 48 kHz: tens of ms once)
    beds = createBeds(c, { destination: master });
    rec = createRecorded(c, { effects: beds.inputs.effects, ambience: beds.inputs.ambience, base, seed, fetchFn, groove, waveHit, speedFeel, rain });
    beds.sound(sw('sound')); beds.effects(sw('effects'));
    beds.fade(visible() ? 1 : 0, c.currentTime, 0.5 / 3);   // up over ≈ 0.5 s
    for (const fn of attached) fn({ ctx: c, effects: beds.inputs.effects });
  });
  settings?.on?.((k, v) => { if (k === 'sound') beds?.sound(v !== false); if (k === 'effects') beds?.effects(v !== false); });
  // going to the background: fade first (a clock stopped dead leaves a click), then suspend; back: resume, then come up
  doc?.addEventListener?.('visibilitychange', () => {
    if (!ctx || !beds) return;
    clearTimeout(hideT);
    if (!visible()) { beds.fade(0, ctx.currentTime, 0.03); hideT = setTimeout(() => { if (!visible()) ctx.suspend().catch(() => {}); }, 160); }
    else { ctx.resume().catch(() => {}); beds.fade(dipNow, ctx.currentTime, 0.25 / 3); }
  });
  return {
    // #14: fn({ ctx, effects }) once the beds are built (at once if they are): v1's engine sound joins the boat's bus (v1: audio.attach on 'effects')
    // the speed feel's sound on or off in place (the A/B; ?speedfeel=0 starts it off)
    setSpeedFeel(v) { speedFeel = !!v; if (rec) rec.feel.on = speedFeel; return speedFeel; },
    attach(fn) { attached.push(fn); if (beds) fn({ ctx, effects: beds.inputs.effects }); },
    update(input) {
      if (!beds || ctx.state !== 'running') return null;
      const t0 = now();
      inp = typeof input === 'function' ? input() : input;   // a function: its cost (the wind at the ear) is counted too
      const dp = Number.isFinite(inp?.dip) ? Math.max(0, Math.min(1, inp.dip)) : 1;
      if (Math.abs(dp - dipNow) > 0.01 || (dp === 1 && dipNow !== 1)) { dipNow = dp; if (visible()) beds.fade(dipNow, ctx.currentTime, 0.15); }
      last = mix.stepWind(inp);
      mix.withBoat(last, rec.update(inp, last, ctx.currentTime));
      beds.update(last, ctx.currentTime);
      const d = now() - t0;
      ms.n++; ms.sum += d; ms.max = Math.max(ms.max, d);
      ms.wSum += d; if (++ms.wN === WIN) { ms.windows.push(ms.wSum / WIN); if (ms.windows.length > WINS) ms.windows.shift(); ms.wSum = 0; ms.wN = 0; }
      return last;
    },
    // a one-off cue on v1's sfx through the effects bus (L3: the thud of a bump), once the sound runs; else dropped
    cue(kind, o = {}) { if (!rec || !ctx || ctx.state !== 'running') return null; return rec.cue(kind, o, ctx.currentTime); },
    stats() {
      return { feel: rec?.stats().feel ?? null, on: !!beds && ctx?.state === 'running', nodes: beds?.nodes ?? 0, sets: beds?.sets ?? 0, bytes: rec?.bytes ?? 0, files: rec?.files.length ?? 0, played: (rec?.stats().boat?.events.length ?? 0), mainMs: { mean: ms.n ? +(ms.sum / ms.n).toFixed(4) : 0, max: +ms.max.toFixed(3), frames: ms.n, windows: ms.windows.map((v) => +v.toFixed(4)) }, gains: last?.gains ?? null };
    },
  };
}
