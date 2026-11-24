// The browser half of the quality tiers: the device facts (WebGPU adapter, memory hint, screen, UA) and the 2–3 s
// warm-up that runs behind the loading card before the world is built. The decisions
// are in tiers.js (pure, tested); this file only gathers and measures.
import * as THREE from 'three/webgpu';
import { Fn, float, vec2, vec3, vec4, uv, uniform, sin, cos, Loop } from 'three/tsl';
import { readSignals } from './tiers.js';

export async function gatherSignals(renderer) {
  let adapter = null;
  try {
    const a = await navigator.gpu?.requestAdapter?.();
    if (a) adapter = { isFallbackAdapter: a.isFallbackAdapter ?? a.info?.isFallbackAdapter ?? false, info: a.info ?? {}, limits: { maxTextureDimension2D: a.limits?.maxTextureDimension2D, maxBufferSize: a.limits?.maxBufferSize } };
  } catch { /* no adapter info: the facts stay empty */ }
  const dev = renderer?.backend?.device;
  if (adapter && dev?.limits) adapter.limits = { maxTextureDimension2D: dev.limits.maxTextureDimension2D, maxBufferSize: dev.limits.maxBufferSize };
  return readSignals({
    adapter, deviceMemory: navigator.deviceMemory ?? null, ua: navigator.userAgent, platform: navigator.platform ?? '', touch: navigator.maxTouchPoints ?? 0,
    screen: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
  });
}

const WARMUP = { w: 960, h: 540, loop: 1024, batch: 4, minS: 1.2, maxS: 2.6 };

// One frame of a fixed full-screen workload (hash-free trig feedback: ALU and register bound, like the water and cloud
// shaders) at 960 × 540, drawn in batches; each batch ends with the queue's own "done" signal, so the time is the GPU's
// and needs no timestamp query (Safari has none). Returns the lower-quartile ms of one frame, or null if it could not run.
export async function runWarmup(renderer, { loop = WARMUP.loop, onProgress = null } = {}) {
  const dev = renderer.backend?.device;
  if (!dev?.queue?.onSubmittedWorkDone) return null;
  const rt = new THREE.RenderTarget(WARMUP.w, WARMUP.h, { type: THREE.HalfFloatType, depthBuffer: false });
  const k = uniform(0.37);
  const mat = new THREE.NodeMaterial();
  mat.fragmentNode = Fn(() => {
    const p = uv().mul(6.0).toVar(), acc = float(0).toVar();
    Loop(loop, () => {
      p.assign(vec2(sin(p.y.add(acc.mul(0.31))).mul(1.3).add(p.x.mul(0.9)), cos(p.x.mul(1.1).sub(acc.mul(0.17))).add(p.y.mul(0.8))));
      acc.addAssign(sin(p.x.mul(p.y).add(k)).mul(0.5).add(0.5));
    });
    return vec4(vec3(acc.mul(1 / loop)), 1);
  })();
  const quad = new THREE.QuadMesh(mat);
  const was = renderer.getRenderTarget(), mrt = renderer.getMRT?.();
  const frame = () => { k.value += 0.013; renderer.setMRT?.(null); renderer.setRenderTarget(rt); quad.render(renderer); };
  const out = [];
  try {
    for (let i = 0; i < 3; i++) frame();                       // compile + first-use costs
    await dev.queue.onSubmittedWorkDone();
    const t0 = performance.now();
    while (true) {
      const b0 = performance.now();
      for (let i = 0; i < WARMUP.batch; i++) frame();
      await dev.queue.onSubmittedWorkDone();
      const t = performance.now(), ms = (t - b0) / WARMUP.batch;
      out.push(ms);
      onProgress?.(Math.min(1, (t - t0) / 1000 / WARMUP.minS));
      const el = (t - t0) / 1000;
      if (el >= WARMUP.maxS || (el >= WARMUP.minS && out.length >= 3) || (out.length >= 2 && ms * WARMUP.batch > 600)) break;
    }
  } catch { return null; }
  finally { renderer.setRenderTarget(was); if (mrt) renderer.setMRT(mrt); rt.dispose(); mat.dispose(); }
  // the lower quartile, not the median: a busy Mac (a render, a video call) only ever makes a batch slower, so the quiet
  // batches say what the GPU can do; the governor still watches the real frames
  out.sort((a, b) => a - b);
  return out[out.length >> 2];
}
