// The launch gate's WebGPU check: runs in v2/start.js before main.js (the engine, ≈ 290 kB gzip) is even
// fetched, so a browser that cannot draw v2 downloads no engine and no asset. Two steps: the API (navigator.gpu), then a
// real adapter (requestAdapter, with a timeout: a driver that never answers must not leave a blank page). Pure: the caller
// passes the navigator and a timer; v2/tests/launch-gate.test.mjs drives every case.
//   const r = await checkGpu({ nav: navigator });
//   r.ok, r.kind ('ok' | 'no-api' | 'no-adapter' | 'timeout' | 'error'), r.adapter (ok only), r.why (one line, the small print)
// The adapter is handed to main.js (start.js: globalThis.__veliaGate), so the page asks once. A device lost at load or a
// pipeline the browser refuses is the later 'failed' case (engine/device.js, main.js showError): the same gate page.
export const GATE_TIMEOUT_MS = 5000;   // Chrome and Safari answer in ≈ 5–50 ms; a hung driver stops here
export const ADAPTER_OPTIONS = Object.freeze({ powerPreference: 'high-performance' });   // engine/device.js asks the same

export async function checkGpu({ nav = globalThis.navigator, timeoutMs = GATE_TIMEOUT_MS, setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout } = {}) {
  const gpu = nav?.gpu;
  if (!gpu || typeof gpu.requestAdapter !== 'function') return { ok: false, kind: 'no-api', adapter: null, why: 'navigator.gpu is missing (no WebGPU in this browser)' };
  let timer = null;
  const late = new Promise((done) => { timer = setTimer(() => done('timeout'), timeoutMs); });
  let adapter;
  try {
    adapter = await Promise.race([Promise.resolve().then(() => gpu.requestAdapter(ADAPTER_OPTIONS)), late]);
  } catch (e) {
    return { ok: false, kind: 'error', adapter: null, why: `requestAdapter threw: ${e?.message ?? e}` };
  } finally { clearTimer?.(timer); }
  if (adapter === 'timeout') return { ok: false, kind: 'timeout', adapter: null, why: `requestAdapter did not answer in ${timeoutMs / 1000} s` };
  if (!adapter) return { ok: false, kind: 'no-adapter', adapter: null, why: 'requestAdapter returned null (no usable GPU)' };
  return { ok: true, kind: 'ok', adapter, why: '' };
}

// which gate page a result shows: 'nogpu' (this browser or device has no WebGPU) or 'failed' (it has, but v2 could not start)
export const gateKind = (kind) => (kind === 'failed' || kind === 'lost' ? 'failed' : 'nogpu');
