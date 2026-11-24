// The GPU's death and the recovery (fix/first-load, 2026-10-31). On the owner's iPhone (Chrome iOS and Safari, both
// WebKit) the WebGPU device went invalid seconds after the first live frame: every createCommandEncoder threw
// InvalidStateError ("Unable to make command encoder"), device.lost never resolved, the diag said "gpu ok". The boat's
// wake renders inside the mode's update, so the throw ended each frame before its draw: frames ran, renders stopped, the
// sim sailed on behind a frozen picture. A refresh got a new device.
//
// What this does: any GPU-death signal (device.lost, an InvalidStateError from a GPU call, anywhere) marks the device
// lost (the diag says so, with the reason) and recovers the way the refresh did, without asking the player:
//   1st loss in this tab: reload with a new WebGPU device (the refresh), straight back into play (no card);
//   2nd loss within 10 min: reload on the WebGL2 backend (the classic water), straight into play;
//   after that: no more reloads (never a loop); the diag keeps the record.
// A sessionStorage guard holds the count, so it is per tab and never survives the browser.
//   isGpuError(e)                                  // pure: tests/gpuRecover.test.mjs
//   const step = nextRecovery(storage, reason)     // { action: 'reload' | 'webgl' | 'none', n }
//   backendWanted(storage, flags)                  // 'gl' when this tab already fell back (or ?backend=gl)
//   resumeWanted(storage)                          // true once, on the page a recovery reloaded: skip the card
import { FLAGS, toFlags } from '../../../src/sim/core/flags.js';
const GPU_KEY = 'lakeshore.gpu.v1';
export const RESUME_KEY = 'lakeshore.resume.v1';
const GPU_WINDOW_MS = 10 * 60e3;

export function isGpuError(e) {
  if (!e) return false;
  const msg = String(e.message ?? e.reason ?? e ?? '');
  if (/createCommandEncoder|Unable to make command encoder|GPUDevice|GPUQueue|GPUCommandEncoder|GPUBuffer\.mapAsync|device (was |is |has been )?(lost|destroyed)/i.test(msg)) return true;
  return e.name === 'OperationError' && /GPU|device/i.test(msg);
}

const readGuard = (storage) => { try { return JSON.parse(storage?.getItem(GPU_KEY) ?? 'null'); } catch { return null; } };

export function nextRecovery(storage, reason = '', now = Date.now()) {
  let g = readGuard(storage);
  if (g && now - (g.at ?? 0) > GPU_WINDOW_MS) g = { ...g, n: 0 };   // an old loss (a long session): start over
  const n = (g?.n ?? 0) + 1;
  const action = n === 1 ? 'reload' : n === 2 ? 'webgl' : 'none';
  if (action === 'none') return { action, n: n - 1 };
  try {
    storage.setItem(GPU_KEY, JSON.stringify({ n, at: now, reason: String(reason).slice(0, 120), backend: action === 'webgl' ? 'gl' : g?.backend ?? null }));
    storage.setItem(RESUME_KEY, String(now));
  } catch { return { action: 'none', n: 0 }; }   // no storage: no guard, so no reload (never a loop)
  return { action, n };
}

export function backendWanted(storage, flags = FLAGS) {
  flags = toFlags(flags);   // a flags object (or a query string: the tests)
  if (flags.backend === 'gl') return 'gl';
  if (flags.backend === 'gpu') return 'gpu';
  return readGuard(storage)?.backend === 'gl' ? 'gl' : 'gpu';
}

export function resumeWanted(storage, now = Date.now()) {
  let at = null;
  try { at = parseFloat(storage?.getItem(RESUME_KEY) ?? ''); storage?.removeItem?.(RESUME_KEY); } catch { return false; }
  return Number.isFinite(at) && now - at < 60e3;
}

// what the diag shows of the last loss this tab recovered from
export const lastLoss = (storage) => readGuard(storage);
