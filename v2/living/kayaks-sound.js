// The kayaks' capsize sound (feat/v2-kayak-capsize): a recorded splash (audio/sfx/kayak_splash: a body going into a river,
// Freesound 585744, CC0; ATTRIBUTION.md), two takes in 2.5 s slots. On v2's page sound (engine/audio.js: made in the first
// gesture; a capture is silent); the file is fetched once, on the first capsize (nothing before: most sails never need it).
//   const S = createKayakSound({ audio })   S.play(e, cam)   e: the fleet's { type: 'capsize' | 'righted', x, z }; cam { x, z }
import { decodeFile } from '../../src/audioFormat.js';

const SPLASH_SOUND = Object.freeze({ url: 'audio/sfx/kayak_splash.opus', slot: 2.5, gain: 0.9, near: 25 });

// the level by distance from the camera (m): full within a few metres, half at ≈ 25 m, a faint splash at 150 m
export const splashGain = (d, S = SPLASH_SOUND) => Math.min(1, 1 / (0.3 + d / S.near));

export function createKayakSound({ audio, fetchFn = (u) => fetch(u) } = {}) {
  let ctx = null, out = null, buf = null, loading = null;
  audio?.ready?.then(({ ctx: c, master }) => { ctx = c; out = new GainNode(c, { gain: SPLASH_SOUND.gain }); out.connect(master); });
  const load = () => (loading ??= decodeFile(ctx, fetchFn, SPLASH_SOUND.url).then((b) => { buf = b; return b; }).catch(() => { loading = null; return null; }));
  function start(e, cam) {
    if (!ctx || !buf || ctx.state === 'closed') return false;
    const d = cam ? Math.hypot(e.x - cam.x, e.z - cam.z) : 20, g = splashGain(d) * (e.type === 'capsize' ? 1 : 0.55);
    const src = new AudioBufferSourceNode(ctx, { buffer: buf, playbackRate: e.type === 'capsize' ? 1 : 1.08 }), v = new GainNode(ctx, { gain: g });
    src.connect(v).connect(out);
    src.start(ctx.currentTime + 0.01, e.type === 'capsize' ? 0 : SPLASH_SOUND.slot, SPLASH_SOUND.slot);
    return true;
  }
  return {
    play(e, cam) {
      if (!ctx) return false;
      if (buf) return start(e, cam);
      load().then((b) => { if (b) start(e, cam); });
      return true;
    },
  };
}
