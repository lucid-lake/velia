// The streaming worker pool: a few long-lived module workers running src/bake-worker.js's jobs (the same functions
// as the load-time bake, so a tile built here matches one built at load). Created on first use.
//   import { workerPool } from './stream/workers.js';
//   const hs = await workerPool().run('lod', { seed, chunks: [[x0, z0, size]] });
// No Worker (node tests): run() rejects and the caller builds in place.
import { workerName, primeWorker } from '../../../src/sim/terrain-data.js';   // the workers load the same grid set as the page (phone or full)
let pool = null;

export function workerPool(n = 2) {
  if (pool) return pool;
  if (typeof Worker === 'undefined') return (pool = { run: () => Promise.reject(new Error('no workers')), size: 0 });
  const workers = Array.from({ length: n }, () => new Worker(new URL('../bake-worker.js', import.meta.url), { type: 'module', name: workerName() }));
  const pending = new Map(), busy = new Map(workers.map((w) => [w, 0])); let id = 0;
  for (const w of workers) {
    primeWorker(w);   // a phone: the page's grid bytes, before any job
    w.onmessage = ({ data }) => { const p = pending.get(data.id); if (!p) return; pending.delete(data.id); busy.set(w, busy.get(w) - 1); data.error ? p.reject(new Error(data.error)) : p.resolve(data.result); };
    w.onerror = (e) => { for (const [k, p] of pending) { pending.delete(k); p.reject(new Error(e.message)); } };
  }
  pool = {
    size: n,
    run(job, args) {
      return new Promise((resolve, reject) => {
        const k = ++id; pending.set(k, { resolve, reject });
        let w = workers[0]; for (const x of workers) if (busy.get(x) < busy.get(w)) w = x;   // the least busy
        busy.set(w, busy.get(w) + 1); w.postMessage({ id: k, job, args });
      });
    },
    terminate() { for (const w of workers) w.terminate(); pool = null; },
  };
  return pool;
}
