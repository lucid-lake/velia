// The test hook, window.__velia: what tools/capture.mjs and tools/goldens.mjs read (the same shape as v1's:
// ready, renderOnce(), stats() with cpuMs {p50, p95}, gpuMs, backend, calls, triangles, pixelRatio; plus v2's own
// frames, errors, pipelines {total, afterFirstFrame}, firstFrameMs, governor, size). stats() is the only place that
// allocates (a sort of the frame-time tail); the frame itself writes into fixed rings.
export function createHook({ errors }) {
  const N = 240;
  const cpu = new Float64Array(N); let cpuN = 0, cpuI = 0;
  const hook = {
    version: 'v2', ready: false, frames: 0, errors,
    renderOnce: null,          // set by main once the engine runs: async () => one frame, settled
    _stats: null,              // main's provider: () => the live numbers
    stats() {
      const n = Math.min(cpuN, N), a = Array.from(cpu.subarray(0, n)).sort((x, y) => x - y);
      const p = (q) => (a.length ? +a[Math.min(a.length - 1, Math.floor(q * a.length))].toFixed(3) : null);
      return { ...(hook._stats?.() ?? {}), frames: hook.frames, cpuMs: { p50: p(0.5), p95: p(0.95) }, errors: errors.slice(), backend: 'webgpu' };
    },
    cpuSample(ms) { cpu[cpuI] = ms; cpuI = (cpuI + 1) % N; cpuN++; },
    resetCounters() { cpuN = 0; cpuI = 0; },
  };
  return hook;
}
