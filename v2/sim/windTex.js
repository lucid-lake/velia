// The water's wind texture (audit W1–W3, 2026-11-14): v1's (src/sim/wind-texture.js, src/water.js), the WindField's local
// wind over a 4,096 m square round the camera (snapped to 512 m), 256² texels of 16 m, with the speed's ≈ 800 m box mean
// beside it: the gust patches (the local wind over the mean), the whitecaps' and the spume's local gate, the wind lanes'
// local direction all read it. Packed for the GPU as half floats, four a texel: the wind vector (m/s, x and z), the mean
// speed, 0 (a storage buffer: the water's fragment stage is at the 16 sampled textures' limit; little-endian, so each pair
// is the WGSL's pack2x16float word).
//   const W = createWindTex({ field, live, makeWorker, terrain });
//   each frame: W.update(t, eyeX, eyeZ) → true when new texels wait; W.upload(queue, buffers) writes them into
//   buffers[W.slot]; W.blend(t) → this frame's cross-fade of the last two fills (render/windWater.js createWindBlend);
//   W.centre → [cx, cz] (the newest fill's)
// The fill costs ≈ 100–200 ms (the gust grid at 65,536 texels), so:
//   - a live page fills it in a worker (sim/wind-worker.js: its own WindField on a copy of the terrain's height grids, set
//     each request to the page's state: v1's windState / applyWindState) and uses the latest result, a few frames old (v1's
//     windLag); until the first result the water reads the frame's wind (no stall on the first frame);
//   - a capture (no worker) fills in place on the sim's steps: at the first frame, then every EVERY_STEPS frames or on a
//     cut: deterministic (the goldens run twice). A capture is ?headless=1 AND a ?filmui=1 film (the goldens' hud,
//     binoculars and home frames: a live page on the film clock): windTexLive says which. The worker's results land on the
//     wall clock, so on a film they landed on a different film frame each run (v2-hud-full 59 px run to run, 2026-11-14).
// fix(v2) shadow stepping (2026-11-18, a week-3 viewer: "the shadows stutter"): the gust patches' dark water on the lake reads
// as cloud shadow, and it jumped a step on every fill and held: every 30th film frame, every worker round trip (≈ 6–12
// frames) on a live page. Now the two newest fills are kept and cross-faded on the sim's clock: a new fill starts a segment
// that runs from the previous fill's state to its own over the time between their states (so the picture runs one fill
// behind: 0.25–1 s of gust drift), and the next fill waits until the segment is done (a late fill holds the last state, it
// never jumps). A cut (the first fill, a centre more than one snap away, the clock gone back) switches at once.
// No allocation a frame: the half-float buffers are made once (the worker's come back and are copied into them).
import { WIND_TEX, WIND_EXTENT, fillWindTexture, newWindBuffers, windState } from '../../src/sim/wind-texture.js';

export { WIND_TEX, WIND_EXTENT };
export const EVERY_STEPS = 30;
export const SNAP_M = 512;
export const MAX_FADE_S = 8;   // the longest fade (sim s): a live worker round trip is about 1 s of real time, 2 s of sim at the 2 x game speed
// whether the page fills the texture in the worker: a live page only, never a capture (?headless=1 or a ?filmui=1 film)
export const windTexLive = ({ headless = false, filmui = false } = {}) => !headless && filmui !== true;

export function createWindTex({ field, live = false, makeWorker = null, terrain = null, seed = 1 } = {}) {
  const n = WIND_TEX * WIND_TEX;
  const own = newWindBuffers();
  const packed = new Uint16Array(n * 4);   // rgba16float: wind x, wind z, mean, 0 (the newest fill, until uploaded)
  const centre = [NaN, NaN];
  let dirty = false, steps = 0, lastFill = -Infinity, fills = 0;
  let worker = null, busy = false, latest = null, reqKey = 0, reqT = 0;
  // the cross-fade: slot the newest fill's buffer (0 | 1), each slot's state time and centre; the segment's start (sim time)
  // and length (the time between the two fills' states; 0: no fade, the newest alone)
  let slot = 1, segStart = 0, segLen = 0;
  const fillT = [0, 0], fillC = [[NaN, NaN], [NaN, NaN]];
  const out = { w: 1, slot: 0, prev: 1, off: [0, 0], fills: 0 };
  const weight = (t) => (segLen > 0 && t >= segStart ? Math.min(1, (t - segStart) / segLen) : 1);
  const isCut = (cx, cz) => !(fills > 0) || Math.abs(cx - centre[0]) > SNAP_M || Math.abs(cz - centre[1]) > SNAP_M;
  // a new fill (its state at time tf, centred at cx, cz) taken at sim time t: into the other slot, a new segment from the last
  const adopt = (t, tf, cx, cz) => {
    const cut = isCut(cx, cz), prev = slot;
    slot = 1 - slot;
    fillT[slot] = tf; fillC[slot][0] = cx; fillC[slot][1] = cz;
    const gap = tf - fillT[prev];   // a gap over MAX_FADE_S (the sim fast-forwarded: a settle, a race sailed on) is a cut too
    segStart = t; segLen = cut || !(gap > 0) || gap > MAX_FADE_S ? 0 : gap;
    centre[0] = cx; centre[1] = cz; fills++; dirty = true;
  };
  const pack = (wind, mean) => { for (let k = 0; k < n; k++) { packed[4 * k] = wind[2 * k]; packed[4 * k + 1] = wind[2 * k + 1]; packed[4 * k + 2] = mean[k]; } };
  const fillHere = (t, cx, cz) => { fillWindTexture(field, t, cx, cz, own); pack(own.wind, own.mean); adopt(t, t, cx, cz); };
  const giveBack = (r) => worker.postMessage({ type: 'return', wind: r.wind, mean: r.mean }, [r.wind.buffer, r.mean.buffer]);

  if (live && makeWorker) {
    try { worker = makeWorker(); } catch { worker = null; }
    if (worker) {
      worker.onmessage = ({ data }) => {
        busy = false;
        if (data.error) { console.warn('wind worker:', data.error); return; }
        if (latest) giveBack(latest);   // a newer result before the last was taken: the older one's buffers back
        latest = data; latest.t = reqT;
      };
      worker.postMessage({ type: 'init', seed, H: terrain?.heightScale ?? null });
      terrain?.onSlot?.(({ k, grid, codes }) => worker.postMessage({ type: 'slot', k, grid: { x0: grid.x0, z0: grid.z0, step: grid.step, w: grid.w, h: grid.h, variant: grid.variant ?? null }, codes }));
    }
  }

  return {
    get centre() { return centre; },
    get fills() { return fills; },
    get packed() { return packed; },
    get slot() { return slot; },   // the buffer the newest fill goes into (upload)
    // t: the WindField's time (the boat's sim time); the eye's x, z. Returns whether new texels wait for upload()
    update(t, ex, ez) {
      steps++;
      const cx = Math.round(ex / SNAP_M) * SNAP_M, cz = Math.round(ez / SNAP_M) * SNAP_M;
      if (t < segStart) segLen = 0;   // the clock went back (a restart): the segment is over
      const done = weight(t) >= 0.999;   // (the sim's clock sums 1/120 s steps: a cadence's last frame lands a rounding short of 1)
      if (worker) {
        // the latest result once the segment is done (at once on a cut); nothing yet: the frame's wind until the first lands
        // (v1 fills once in place; here that stalled the first live frame 100–200 ms)
        if (latest && (done || isCut(latest.cx, latest.cz))) { const r = latest; latest = null; pack(r.wind, r.mean); adopt(t, r.t, r.cx, r.cz); giveBack(r); }
        if (!busy) { busy = true; reqT = t; worker.postMessage({ type: 'req', key: ++reqKey, state: windState(field, t), cx, cz }); }
      } else if (isCut(cx, cz) || (done && steps - lastFill >= EVERY_STEPS)) {
        fillHere(t, cx, cz); lastFill = steps;   // the cadence; a one-snap move waits for it (the texture's outer 15 % fades to the mean)
      }
      return dirty;
    },
    // buffers: the two fill slots (render/windWater.js createWindBlend .slots), or one buffer (no cross-fade)
    upload(queue, buffers) {
      if (!dirty) return false;
      queue.writeBuffer(Array.isArray(buffers) ? buffers[slot] : buffers, 0, packed.buffer, 0, packed.byteLength);
      dirty = false;
      return true;
    },
    // this frame's cross-fade at sim time t: w the newest fill's weight (1: it alone), slot and prev the two buffers, off the
    // newest's centre less the previous fill's, in texels (0, 0 unless the centre moved a snap)
    blend(t) {
      out.w = fills < 2 ? 1 : weight(t); out.slot = slot; out.prev = 1 - slot; out.fills = fills;
      const texel = WIND_EXTENT / WIND_TEX, p = fillC[1 - slot];
      out.off[0] = Number.isFinite(p[0]) ? Math.round((centre[0] - p[0]) / texel) : 0;
      out.off[1] = Number.isFinite(p[1]) ? Math.round((centre[1] - p[1]) / texel) : 0;
      return out;
    },
    stop() { worker?.terminate?.(); worker = null; },
  };
}
