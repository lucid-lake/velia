// The GPU (split from src/core/index.js boot, refactor Phase 2 step 3): the renderer on WebGPU, else a WebGL2 context
// that really gets created; the device's state for ?diag=1 and the recovery from its death (src/ui/gpuRecover.js).
//
//   const gpu = await startGpu({ flags, msg, stage });   // null: the browser cannot draw (the plain card is shown)
//   gpu.renderer, gpu.D (the diag state), gpu.touch, gpu.tabStore, gpu.recover(reason), gpu.gpuDead(reason)
import * as THREE from 'three/webgpu';
import { attachKtx2 } from '../ktx2.js';
import { gpuClass } from '../../../src/metrics.js';
import { diagState, trackGpu, touchDevice } from '../ui/diag.js';
import { isGpuError, nextRecovery, backendWanted, lastLoss } from '../ui/gpuRecover.js';
import { FLAGS } from '../../../src/sim/core/flags.js';

// the GPU's coarse class (src/metrics.js gpuClass): WebGPU's adapter vendor, or WebGL's renderer string, classified here
// and never kept or sent as it is
function gpuClassOf(renderer) {
  try {
    const b = renderer.backend;
    if (b?.isWebGPUBackend) { const i = b.device?.adapterInfo ?? {}; return gpuClass({ vendor: i.vendor, renderer: i.description, fallback: i.isFallbackAdapter === true }); }
    const gl = b?.gl; if (!gl) return '';
    let r = String(gl.getParameter(gl.RENDERER) ?? '');
    if (/^(WebKit WebGL|Mozilla)$/i.test(r) || !r) { const x = gl.getExtension('WEBGL_debug_renderer_info'); if (x) r = String(gl.getParameter(x.UNMASKED_RENDERER_WEBGL) ?? ''); }
    return gpuClass({ renderer: r });
  } catch { return ''; }
}

// the GPU's own timer queries (three's trackTimestamp): the diag readout, the captures and films (?headless, ?film, ?filmui)
// and the probes, never a visitor. A film page must keep them: the frame's resolve waits for the GPU, which keeps the
// water's height read-back in step with the film clock (without it the live goldens drew the waves of another moment)
export const gpuTiming = (flags) => flags?.diag != null || flags?.headless != null || flags?.film === true || flags?.filmui === true || flags?.gputime === true;

export async function startGpu({ flags, msg, stage }) {
  // WebGPU, else a WebGL2 context that really gets created (getContext can return null); with neither, the plain card
  // ("Your browser can't run Velia") instead of an error.
  const noGpu = !navigator.gpu;
  const cantDraw = () => { window.__veliaLoading?.fail('nowebgpu'); msg.textContent = ''; };
  if (noGpu) {
    const gl2 = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch { return false; } })();
    if (!gl2) { cantDraw(); return null; }
    msg.textContent = 'WebGPU not available; running on WebGL2.';
  }

  stage('gpu', 0.02);
  // a phone or tablet: no multisampled canvas (the post chain draws one full-screen quad into it; ≈ 15 MB of MSAA targets at 390 x 844)
  // a tab whose WebGPU device died twice runs the WebGL2 backend (src/ui/gpuRecover.js; ?backend=gl forces it)
  const tabStore = (() => { try { return globalThis.sessionStorage ?? null; } catch { return null; } })();
  const forceWebGL = noGpu || backendWanted(tabStore, FLAGS) === 'gl';
  diagState().backendWanted = forceWebGL ? 'webgl2' : 'webgpu';   // load_fail's backend before the renderer is up (src/main.js)
  // GPU timestamps only where someone reads them (?diag, captures, ?gputime=1 for the live-page probes): for every visitor
  // they put a query on each pass, and the passes drawn outside the frame (the probe, the impostors, PMREM, the warm-ups)
  // filled the pool ("Maximum number of queries exceeded"), after which the GPU ms read was wrong. Without them the
  // strong-start check reads the frame interval, as on Safari (src/quality/tiers.js AfterReady).
  const renderer = new THREE.WebGPURenderer({ antialias: !touchDevice(), trackTimestamp: gpuTiming(flags), forceWebGL });
  renderer.highPrecision = true;   // the sky model's ECEF maths
  renderer.setPixelRatio(1);   // the quality tier sets the real ratio (src/core/quality-boot.js applyRatio)
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);
  try { await renderer.init(); } catch (e) {
    if (!/getSupportedExtensions|\bgl\b|WebGL|WebGPU|adapter|device/i.test(String(e?.message ?? e))) throw e;
    cantDraw(); return null;   // "this.gl is null", a null context, no adapter: the browser cannot draw the lake
  }
  // fix/ios-start: the GPU's own failures are counted for ?diag=1, and a lost device (a phone's GPU reset under memory
  // pressure) no longer leaves a frozen picture without a word: the page offers a reload (the failure path only)
  const D = diagState();
  const touch = touchDevice();
  if (touch || flags.diag != null) trackGpu(renderer.backend?.device, D);   // the GPU memory estimate (phones, ?diag=1): the Mac's own path is untouched
  // fix/first-load: the device's state, told truthfully (?diag=1), and its death recovered from without asking the player.
  // On iOS (WebKit) the device went invalid without device.lost: every GPU call threw InvalidStateError. Any of the
  // signals below marks it lost; recover() reloads the tab once with a new device, then once on WebGL2 (gpuRecover.js).
  D.gpuState = 'ok'; D.backend = renderer.backend?.isWebGPUBackend ? 'webgpu' : 'webgl2'; D.lastLoss = lastLoss(tabStore);
  D.gpuClass = gpuClassOf(renderer);   // a coarse class for load_fail and session_start (src/metrics.js gpuClass)
  const recover = (reason) => {
    if (flags.headless != null || D.recovering) return D.recovery ?? null;
    const step = nextRecovery(tabStore, reason); D.recovery = step;
    if (step.action === 'none') { D.error('gpu', `no recovery left (${step.n} this tab)`); return step; }
    D.recovering = true; D.error('gpu', `recovery ${step.n}: ${step.action === 'webgl' ? 'reload on WebGL2' : 'reload with a new device'}`);
    setTimeout(() => location.reload(), 50);
    return step;
  };
  const gpuDead = (reason) => {
    if (D.gpuState === 'lost') return;
    D.gpuState = 'lost'; D.gpuLost = String(reason || 'lost').slice(0, 120); D.error('gpu lost', D.gpuLost);
    recover(D.gpuLost);
  };
  D.gpuDead = gpuDead;
  { const dev = renderer.backend?.device, base = renderer.onDeviceLost?.bind(renderer);
    dev?.addEventListener?.('uncapturederror', (e) => { D.gpuErrors++; D.lastGpuError = String(e.error?.message ?? e.error ?? '').slice(0, 160); });
    renderer.onDeviceLost = (info) => { base?.(info); gpuDead(`device lost: ${info?.reason || ''} ${info?.message || ''}`.trim()); };
    const onErr = (e) => { const x = e.error ?? e.reason ?? e; if (isGpuError(x) || isGpuError({ message: e.message })) gpuDead(`${x?.name ?? 'error'}: ${x?.message ?? e.message ?? x}`); };
    addEventListener('error', onErr); addEventListener('unhandledrejection', onErr); }
  attachKtx2(renderer);   // the compressed-texture loader asks this device which block formats it has
  // perf/shader-warmup: every InstancedMesh reads its matrices from an instanced vertex
  // buffer, never from a uniform array. three 0.184 picks the array when it fits (≤ 1024 instances) and names it after
  // the mesh's own node (NodeBuffer_<id>), so each such mesh compiled its own shaders and pipeline even when it shared a
  // material with a hundred others. The same matrices, the same maths, one pipeline per material.
  { const caps = renderer.backend?.capabilities; if (typeof caps?.getUniformBufferLimit === 'function') caps.getUniformBufferLimit = () => 0; }
  return { renderer, D, touch, tabStore, recover, gpuDead };
}
