// The launch gate: the page's second module, after v1's loading screen (ui/loading.js). It checks WebGPU (the
// API, then a real adapter, with a timeout: engine/gpuCheck.js) before main.js, the engine, is fetched; a browser that cannot
// draw v2 gets the gate page (#nogpu: the front door's look, the browsers that work, the link to the classic Velia) and
// downloads no engine and no asset. The visitor chooses the classic page; nothing redirects (BACKLOG-v2: no automatic
// fallback to v1). On a pass the adapter goes to main.js (engine/device.js reads globalThis.__veliaGate once).
import { checkGpu } from './engine/gpuCheck.js';
import { showNoGpu } from './engine/device.js';
import { startPageMetrics, track } from './ui/metrics.js';
import { profile } from '../src/core/profile.js';
import { lmStart, lmEnd, lmPoint, lmFact } from './engine/loadMarks.js';   // the load report's marks (ui/loadReportDoor.js)   // v1's play counts (src/metrics.js), the same events

profile.install();   // the device profile (src/core/profile.js): data-input, data-form, data-screen, data-quirks on <html> before the engine loads
startPageMetrics();   // js_error and session_end from here; nothing on a headless, automated or local page (v1's rules)

// ?webgpu=0 (a V2_ROWS row): the page as a browser without WebGPU sees it, for a live check on any browser
lmStart('gate');
const r = new URLSearchParams(location.search).get('webgpu') === '0' ? await checkGpu({ nav: {} }) : await checkGpu({ nav: navigator });
lmEnd('gate'); lmFact('gate', { ok: !!r.ok, kind: r.kind ?? '', why: r.ok ? '' : String(r.why ?? '').slice(0, 120) });
if (r.ok) {
  globalThis.__veliaGate = { adapter: r.adapter, kind: r.kind };
  window.__veliaLoading?.bar?.mark('gate');   // the voyage bar's milestone (ui/loadBar.js): the engine's chunk is on its way
  lmStart('main');   // the engine's chunk fetched and run (main.js ends it at its first line)
  await import('./main.js');
} else {
  lmPoint('fail');
  globalThis.__veliaGate = { adapter: null, kind: r.kind, why: r.why };   // tests and the diag read why the gate shut
  showNoGpu(r.why, 'nogpu');
  // v1's load_fail (stage, why, device, ms): how many visitors meet the gate; no new field
  track('load_fail', { stage: `gpu:${r.kind}`, why: 'error', ms: performance.now(),
    device: profile.get().form });   // the device profile's form (src/core/profile.js): phone | tablet | desktop
  window.__veliaLoading?.dispose?.();   // the loading card steps aside for the gate page (as main.js does on a failed start)
}
