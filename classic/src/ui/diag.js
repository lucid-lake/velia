// The diagnostics (fix/ios-start, 2026-10-31): a few counters every live page keeps (cheap: numbers, no DOM), and with
// ?diag=1 a small readout in the top-left corner the owner can screenshot on a phone: fps, frames drawn, render calls in
// flight, the sim's ticks and the boat's speed, the loading stages (ms), the water's reads, the GPU's state and the
// last error. Nothing is drawn without ?diag=1; captures (?headless) never show it.
//   const D = diagState();            // the one shared object per page (the 'diag' service; tools: window.__lakeshore.diag)
//   peekDiag()                        // that object if the page made one, else null (the boat's NaN guard)
//   D.error('boat NaN', detail)       // any module may note an error; the last one shows
//   mountDiag({ services })           // ?diag=1: the readout, refreshed 4 times a second
import { track } from '../../../src/metrics.js';
import { DIAG_STATES as states, peekDiag } from '../../../src/sim/diagRegistry.js';   // the registry (the boat's NaN guard reads it)

export { peekDiag };
export function diagState(g = globalThis) {
  if (states.has(g)) return states.get(g);
  const D = {
    frames: 0, renders: 0, inFlight: 0, maxInFlight: 0, skipped: 0, fps: 0, lastDt: 0, maxDt: 0,
    gpuLost: null, gpuErrors: 0, lastGpuError: null, nanTrips: 0, errors: [],
    error(kind, detail) {
      const e = { kind, detail: String(detail ?? '').slice(0, 160), at: Math.round((g.performance?.now?.() ?? 0)) };
      D.errors.push(e); if (D.errors.length > 8) D.errors.shift();
      // anonymous counts (src/metrics.js): the two recovery events; track() is a no-op until a live page starts metrics
      if (kind === 'gpu lost') track('gpu_lost', { reason: e.detail, backend: D.backend });
      else if (kind === 'watchdog' && /^reload/.test(e.detail)) track('watchdog_reload', { reason: e.detail.slice(0, 60) });
      return e;
    },
    get lastError() { return D.errors.at(-1) ?? null; },
    // the frame loop's wall time (s): fps as a 1 s running mean
    frame(dt) {
      D.frames++; D.lastDt = dt; if (dt > D.maxDt && dt < 30) D.maxDt = dt;
      if (dt > 0 && dt < 5) D.fps += ((1 / dt) - D.fps) * Math.min(1, dt);
    },
  };
  // the boot's steps (src/core/index.js sets D.bootStep: warm, probe, compile …), each with its start in ms from navigation,
  // for load_fail's step timings (src/metrics.js loadSteps; perf/phone-load)
  let step;
  D.steps = [];
  Object.defineProperty(D, 'bootStep', { enumerable: true, configurable: true, get: () => step,
    set: (v) => { step = v; if (D.steps.length < 40) D.steps.push([String(v), Math.round(g.performance?.now?.() ?? 0)]); } });
  states.set(g, D);
  g.addEventListener?.('error', (e) => D.error('error', e.message ?? e.error));
  g.addEventListener?.('unhandledrejection', (e) => D.error('promise', e.reason?.message ?? e.reason));
  return D;
}

// the readout's lines (pure: tests/diag.test.mjs)
export function diagLines(services, D, now = 0) {   // services: the page's registry (src/core/services.js)
  const s = services?.get('player')?.phys?.state, phys = services?.get('player')?.phys, q = services?.get('quality'), u = services?.get('core')?.water?.ultra;
  const st = (globalThis.__veliaLoading?.log ?? []).map((r) => `${r[0]} ${(r[2] / 1000).toFixed(1)}`).join(' · ');
  const e = D.lastError;
  return [
    `Velia diag · ${services?.get('mode') ?? '-'} · ${q?.name ?? '-'}${q?.ratio ? ` ${q.ratio}x` : ''} · ${services?.get('core')?.renderer?.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'}`,
    `fps ${D.fps.toFixed(0)} · frames ${D.frames} · renders ${D.renders} · in flight ${D.inFlight}/${D.maxInFlight} · skipped ${D.skipped} · max dt ${(D.maxDt * 1000).toFixed(0)} ms`,
    `sim ticks ${phys?.t != null ? Math.round(phys.t * 60) : '-'} · speed ${s ? (s.sog * 1.944).toFixed(1) + ' kn' : '-'} · at ${s ? `${s.x.toFixed(0)},${s.z.toFixed(0)}` : '-'} · wind ${s?.trueWind ? (s.trueWind.speed * 1.944).toFixed(1) + ' kn' : '-'} · NaN ${D.nanTrips}`,
    `water ${u ? `ultra reads ${u.reads}` : 'classic'} · gpu ${D.gpuState === 'lost' || D.gpuLost ? 'LOST ' + (D.gpuLost ?? '') : 'ok'} · gpu errors ${D.gpuErrors}${D.updateErrors ? ` · update errors ${D.updateErrors}` : ''}${D.lastLoss ? ` · recovered from: ${D.lastLoss.reason} (${D.lastLoss.n}x${D.lastLoss.backend === 'gl' ? ', now WebGL2' : ''})` : ''}`,
    `gpu memory ${D.gpu ? `${(D.gpu.bytes / 1048576).toFixed(0)} MB (peak ${(D.gpu.peak / 1048576).toFixed(0)}) · ${D.gpu.textures} textures · ${D.gpu.buffers} buffers` : '-'}${globalThis.performance?.memory ? ` · js ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB` : ''}${D.safeMode ? ` · SAFE: ${D.safeMode}` : ''}`,
    `stages ${st || '-'}`,
    `last error ${e ? `${e.kind} at ${(e.at / 1000).toFixed(1)} s: ${e.detail}` : 'none'}${D.lastGpuError ? ` · gpu: ${D.lastGpuError}` : ''}`,
    `watchdog ${D.watchdog?.length ? D.watchdog.map((w) => `${w.what}@${w.t}`).join(' ') : 'quiet'}${D.watchdogReloaded ? ' · reloaded once' : ''}`,
    `t ${(now / 1000).toFixed(1)} s · ${typeof navigator !== 'undefined' ? navigator.userAgent.replace(/^Mozilla\/5\.0 /, '').slice(0, 90) : ''}`,
  ];
}

export function mountDiag({ services, D = diagState(), doc = document } = {}) {
  const el = doc.createElement('pre');
  el.id = 'lk-diag';
  el.setAttribute('aria-hidden', 'true');
  el.style.cssText = 'position:fixed;left:max(6px,env(safe-area-inset-left));top:calc(max(6px,env(safe-area-inset-top)) + 44px);z-index:2147483000;margin:0;padding:6px 8px;'
    + `max-width:calc(100vw - 12px);white-space:pre-wrap;word-break:break-word;font:${(doc.defaultView?.innerWidth ?? 1280) < 560 ? '8.5px/1.25' : '11px/1.35'} ui-monospace,Menlo,monospace;color:#f3eee2;${(doc.defaultView?.innerWidth ?? 1280) < 560 ? 'opacity:.82;' : ''}`   // a phone: small, so the subtitle and the boat stay in view (fix/first-load)
    + ''
    + 'background:rgba(16,30,56,.86);border-radius:6px;pointer-events:none';
  doc.body.appendChild(el);
  const draw = () => { el.textContent = diagLines(services, D, performance.now()).join('\n'); };
  draw();
  const timer = setInterval(draw, 250);
  return { el, dispose() { clearInterval(timer); el.remove(); } };
}

// GPU memory, estimated: every texture and buffer the device creates, by size at creation, less what is destroyed
// (fix/ios-start: iOS kills a page's process near its memory limit without an error). Wraps the device's create calls;
// the objects are the same, so nothing renders differently.
const BPT = { r8: 1, rg8: 2, rgba8: 4, bgra8: 4, r16: 2, rg16: 4, rgba16: 8, r32: 4, rg32: 8, rgba32: 16, depth16: 2, depth24: 4, depth32: 4, rgb10a2: 4, rg11b10: 4, rgb9e5: 4, bc: 1, etc2: 1, astc: 1 };
function bytesPerTexel(format = '') {
  const f = String(format).toLowerCase();
  if (/^(bc[1-7]|etc2|eac|astc)/.test(f)) return /bc1|bc4|etc2-rgb8unorm|eac-r11/.test(f) ? 0.5 : 1;   // block formats: bytes per texel
  for (const k of ['rgba32', 'rgba16', 'rg32', 'rg16', 'rgba8', 'bgra8', 'rg8', 'r32', 'r16', 'r8', 'depth32', 'depth24', 'depth16', 'rgb10a2', 'rg11b10', 'rgb9e5']) if (f.startsWith(k)) return BPT[k] + (f.includes('stencil8') ? 1 : 0);
  return 4;
}
export function textureBytes(d = {}) {
  const sz = Array.isArray(d.size) ? { width: d.size[0], height: d.size[1] ?? 1, depthOrArrayLayers: d.size[2] ?? 1 } : (d.size ?? {});
  const w = sz.width ?? 1, h = sz.height ?? 1, z = sz.depthOrArrayLayers ?? 1, mips = d.mipLevelCount ?? 1;
  const mipF = mips > 1 ? 4 / 3 : 1;
  return Math.round(w * h * z * bytesPerTexel(d.format) * mipF * (d.sampleCount ?? 1));
}
export function trackGpu(device, D = diagState()) {
  if (!device || device.__lkTracked) return D;
  device.__lkTracked = true;
  const G = D.gpu = { textures: 0, buffers: 0, bytes: 0, peak: 0, live: new Map() };
  const add = (obj, kind, bytes, label) => {
    G.bytes += bytes; if (G.bytes > G.peak) G.peak = G.bytes;
    if (kind === 'texture') G.textures++; else G.buffers++;
    G.live.set(obj, { kind, bytes, label });
    const destroy = obj.destroy?.bind(obj);
    if (destroy) obj.destroy = () => { const e = G.live.get(obj); if (e) { G.bytes -= e.bytes; G.live.delete(obj); if (e.kind === 'texture') G.textures--; else G.buffers--; } return destroy(); };
  };
  const cT = device.createTexture?.bind(device), cB = device.createBuffer?.bind(device);
  if (cT) device.createTexture = (d) => { const t = cT(d); try { const s = Array.isArray(d.size) ? d.size : [d.size?.width, d.size?.height, d.size?.depthOrArrayLayers]; add(t, 'texture', textureBytes(d), d.label || `${d.format} ${s.filter((x) => x != null).join('x')}${(d.mipLevelCount ?? 1) > 1 ? ' mips' : ''}`); } catch { /* a count only */ } return t; };
  if (cB) device.createBuffer = (d) => { const b = cB(d); try { add(b, 'buffer', d.size ?? 0, d.label || `buffer ${d.size}`); } catch { /* a count only */ } return b; };
  return D;
}
// the biggest live allocations: [label, MB]
export function topGpu(D = diagState(), n = 10) {
  const by = new Map();
  for (const e of D.gpu?.live?.values() ?? []) { const k = `${e.kind}: ${e.label}`; const v = by.get(k) ?? { mb: 0, n: 0 }; v.mb += e.bytes / 1048576; v.n++; by.set(k, v); }
  return [...by.entries()].sort((a, b) => b[1].mb - a[1].mb).slice(0, n).map(([k, v]) => [v.n > 1 ? `${k} x${v.n}` : k, +v.mb.toFixed(1)]);
}

export { touchDevice } from '../../../src/ui/device.js';   // one detector (src/ui/device.js)

// the live loop's draw gate (fix/ios-start): with `single` (phones, tablets) a frame draws only when the last render has
// finished, else it counts a skip (the sim has already stepped); without it every frame draws, as before
export function renderGate(single, D = diagState()) {
  if (single && D.inFlight > 0) { D.skipped++; return false; }
  return true;
}

// The boot mark (fix/ios-start): set at the start of a load, cleared at its first frame. A mark still set at the next
// start (within 10 minutes) means that load died: level 1 (Low), then 2 (Low and the classic water) after two in a row.
const BOOT_KEY = 'lakeshore.boot.v1';
export function bootGuard(storage, now = Date.now()) {
  let prev = null;
  try { prev = JSON.parse(storage?.getItem(BOOT_KEY) ?? 'null'); } catch { prev = null; }
  const fails = prev && prev.pending && now - (prev.at ?? 0) < 10 * 60e3 ? (prev.fails ?? 0) + 1 : 0;
  try { storage?.setItem(BOOT_KEY, JSON.stringify({ at: now, pending: true, fails })); } catch { /* private mode: no guard */ }
  return { level: fails >= 2 ? 2 : fails >= 1 ? 1 : 0, fails, mark: true };
}
export function bootDone(storage) {
  try { storage?.setItem(BOOT_KEY, JSON.stringify({ at: Date.now(), pending: false, fails: 0 })); } catch { /* no storage */ }
}
