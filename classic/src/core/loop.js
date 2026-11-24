// The frame and the render loop (split from src/core/index.js boot, refactor Phase 2 step 3).
//
//   const frame = createFrame({ systems, renderer, pc, water, trees, quality, sun, CAM, SEED, D, time, headless });
//   frame.renderOnce()   one frame: every system's update in phase order (src/core/systems.js), the draw, the counters
//   frame.stats()        the capture contract's numbers (tools/capture.mjs)
//   frame.afterFrame(fn) fn(canvas) once, right after the next frame is drawn
//   startLoop({ … })     live pages: the requestAnimationFrame loop, the governor's feed, backgrounding, the watchdog's kick
//
// The frame's systems, in order: pre (the stream, the daylight, the storm), sim (the GPU counters' reset, the water),
// scene (trees, landmarks, towns, shore flags, birds), audio (the sound beds), post (the helm's objects, the draw).
import * as THREE from 'three/webgpu';
import { isGpuError } from '../ui/gpuRecover.js';
import { touchDevice, renderGate } from '../ui/diag.js';
import { tail } from './tail.js';

// the per-frame records keep their last FRAME_TAIL..2x entries (src/core/tail.js): Cruise runs for hours
const FRAME_TAIL = 600;

// streamFrame(): the streamed world for this camera (async: captures settle it); applyDaylight(): the clock's light on the
// sky, the sun and the probe; env: the frame's shared values (the daylight writes hour and sun)
export function createFrame({ systems, renderer, pc, water, trees, quality, sun, env, streamFrame, applyDaylight, CAM, SEED, D, time, headless }) {
  const { post, hud } = pc;
  const frameMs = tail(FRAME_TAIL);
  let lastFrameId = -1;   // the node frame id of the last draw
  let gpuMs = null, lastGpuMs = null, calls = 0, tris = 0; const callsPerFrame = tail(FRAME_TAIL);
  // afterFrame(fn): fn() runs once, right after the next frame is drawn, in the same task as post.render() (a WebGPU
  // canvas is readable only there: after renderOnce() resolves, drawImage of it is black). Day Sail's logbook grabs
  // its pictures here. Keep fn short: it runs inside the frame.
  const afterFrame = [];
  // three's own animation loop (a requestAnimationFrame tick, running from renderer.init() with or without our loop) resets
  // renderer.info before each tick while autoReset is true: a tick landing between two passes of the post chain left only
  // the last passes in the frame's counts ("2 calls, 2 tris" in captures, flaky). The 'gpu-info' system resets once per frame.
  renderer.info.autoReset = false;

  // the core's own systems round the world's (src/core/world.js worldSystems): the stream and the daylight first, the GPU
  // counters' reset before the water, then the helm's objects and the draw last
  systems.add({ id: 'stream', phase: 'pre', order: -20, update: () => streamFrame() });   // the streamed world for this camera (before the systems' own per-frame LOD)
  systems.add({ id: 'daylight', phase: 'pre', order: -10, update() { applyDaylight(); env.hour = sun.hour; env.sun = sun; } });   // before the counters' reset: a probe face rendered here is not the frame's own draw calls
  systems.add({ id: 'gpu-info', phase: 'sim', order: -10, update() { renderer.info.reset(); } });   // per-frame calls and triangles, not a running total
  systems.add({ id: 'hud', phase: 'post', order: -10, update() { hud.render({ light: sun.light, lum: 0.6 / sun.exposure }); } });   // the helm station's objects (none in captures)
  systems.add({ id: 'draw', phase: 'post', order: 0, async update() {
    const t0 = performance.now();
    // three runs the scene pass once per node frame, and its frame id advances only on a requestAnimationFrame tick: a second
    // renderOnce() in the same tick (a capture's back-to-back frames) drew only the final passes, "2 calls, 2 tris", and not
    // the scene (also on 5e19b05, before the split: flaky on builds, where a frame is fast). Bump the id when this draw would
    // reuse the last one's; a live frame, one per tick, never needs it.
    const nf = renderer._nodes?.nodeFrame;
    if (nf && nf.frameId === lastFrameId) nf.update();
    post.render();   // the renderer was initialised at boot (src/core/gpu.js): three's renderAsync only awaited init() again
    if (nf) lastFrameId = nf.frameId;
    hud.present();   // the helm's objects on their own canvas at the screen's density, when the scene draws below it (hud3d.js)
    frameMs.push(performance.now() - t0);
    if (afterFrame.length) for (const f of afterFrame.splice(0)) f(renderer.domElement);
    calls = renderer.info.render.drawCalls; tris = renderer.info.render.triangles;   // read now: after the timestamp resolve they flake to 0
    callsPerFrame.push(calls);
    // the GPU's timers, where they are on (src/core/gpu.js gpuTiming): both pools resolved every frame, the passes drawn
    // outside the frame's own (the probe, the impostors, PMREM) included, so neither pool fills
    if (renderer.backend?.trackTimestamp) try {
      await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
      await renderer.resolveTimestampsAsync(THREE.TimestampQuery.COMPUTE);   // the Ultra FFT's and the fireworks' compute passes
      gpuMs = renderer.info.render.timestamp; lastGpuMs = gpuMs > 0 ? gpuMs : null; (globalThis.__gpuAll ??= tail(FRAME_TAIL)).push(gpuMs);   // a tool may replace it with a plain array
    } catch { /* no timestamp-query on this adapter */ }
  } });

  // ctx: what every system's update reads; t is the scene clock as it is when the system runs
  const ctx = { get t() { return time(); }, headless };
  const drawOnce = () => systems.run(ctx);
  async function renderOnce() {
    D.inFlight++; D.renders++; if (D.inFlight > D.maxInFlight) D.maxInFlight = D.inFlight;
    try { await drawOnce(); } finally { D.inFlight--; }
  }
  function stats() {
    const sorted = frameMs.slice().sort((a, b) => a - b);
    const p = (q) => sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : null;
    return {
      hour: +sun.hour.toFixed(4), cam: CAM, seed: SEED, exposure: +sun.exposure.toFixed(3), sunElevationDeg: +sun.elevationDeg.toFixed(2),
      frames: frameMs.length, cpuMs: { p50: p(0.5), p95: p(0.95) }, gpuMs,
      backend: renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2',
      trees: trees.stats,   // the forest's counts and load-time ms (src/trees.js)
      quality: quality.name, pixelRatio: +renderer.getPixelRatio().toFixed(3), calls, triangles: tris, callsPerFrame: callsPerFrame.slice(), gpuMsMedian: (() => { const a = (globalThis.__gpuAll ?? []).slice(3).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : null; })(),
    };
  }
  return {
    renderOnce, stats,
    afterFrame: (fn) => { afterFrame.push(fn); },
    resetCounters() { frameMs.clear(); callsPerFrame.clear(); },
    get lastGpuMs() { return lastGpuMs; },
  };
}

// Live pages only; captures (?headless) call renderOnce() themselves. feed: the quality's per-frame step
// (src/core/quality-boot.js startGovernor); update(dt): the running mode's; readyAt(): when the first live frame was drawn.
export function startLoop({ renderer, D, frame, startGovernor, update, firstFrame, readyAt, gpuDead, recover, audio, core }) {
  let prev = performance.now();
  const feed = startGovernor(prev);
  // fix/ios-start: on a phone or tablet one render at a time. Safari has no timestamp query, so a frame's renderOnce()
  // never waits for the GPU and a slow GPU (the first minute of shader builds) piled frames up without limit: the
  // picture fell seconds behind the sim, the boat looked stuck. A frame that finds the last render still running steps
  // the sim and skips its draw. Desktops keep the old loop (?single=1|0 forces either).
  const single = touchDevice();
  const tick = () => {
    const now = performance.now(), dt = (now - prev) / 1000; prev = now;
    D.frame(dt);
    feed(dt, now, { readyAt: readyAt(), lastGpuMs: frame.lastGpuMs });
    // a mode's update that throws never stops the draw (fix/first-load: the wake's GPU pass threw in update on a dead
    // device, so no frame reached its render and the picture froze); a GPU error there is the device's death
    try { update(dt); } catch (e) { if ((D.updateErrors = (D.updateErrors ?? 0) + 1) === 1) console.error(e); D.error('update', e?.message ?? e); if (isGpuError(e)) gpuDead(`${e.name}: ${e.message}`); }
    if (!renderGate(single, D)) return;
    frame.renderOnce().then(firstFrame, (e) => { D.error('render', e?.message ?? e); if (isGpuError(e)) gpuDead(`${e?.name}: ${e?.message}`); });
  };
  // Backgrounding (a phone's app switch, a locked screen, a hidden tab): stop the loop and the sound, and start both
  // clean on return (prev is reset, so the first frame back is a normal one, not a minute-long step)
  const life = { hidden: false, suspends: 0, resumes: 0 };
  const setHidden = (h) => {
    if (h === life.hidden) return;
    life.hidden = h;
    if (h) { life.suspends++; renderer.setAnimationLoop(null); audio?.suspend?.(); }
    else { life.resumes++; prev = performance.now(); renderer.setAnimationLoop(tick); audio?.resume?.(); }
  };
  document.addEventListener('visibilitychange', () => setHidden(document.visibilityState === 'hidden'));
  window.addEventListener('pagehide', () => setHidden(true));
  window.addEventListener('pageshow', () => setHidden(document.visibilityState === 'hidden'));
  core.lifecycle = life;
  renderer.setAnimationLoop(tick);
  // the play watchdog's restart (src/ui/watchdog.js): the loop set again from now, and a render stuck in flight let go (the
  // single-render gate would skip every draw behind it)
  core.recover = (reason) => recover(reason);
  core.kick = () => { D.kicks = (D.kicks ?? 0) + 1; D.inFlight = 0; prev = performance.now(); if (!life.hidden) renderer.setAnimationLoop(tick); };
}
