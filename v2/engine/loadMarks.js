// The load's marks (the load report, ui/loadReport*.js): every boot stage leaves a User Timing mark, always (a mark is a
// few hundred bytes and no work), so a report can be opened for the load that just happened. The marks are named
// `velia:<stage>:s` and `velia:<stage>:e` (a span) or `velia:<point>` (a moment); the report pairs them.
//   lmStart('pipelines'); …; lmEnd('pipelines')      a span
//   lmPoint('frame1')                                a moment
//   lmSpan('cockpit', cockpit.ready)                 a span that ends when the promise settles
//   lmFact('quality', { level: 1 })                  a fact the report shows (the device's level, the GPU)
// Only with ?loadreport=1 does the recorder run (engine/loadRecorder.js: the long tasks and the main thread's stalls).
const LM_PREFIX = 'velia:';

const perf = () => globalThis.performance;
const mark = (name) => { try { perf()?.mark?.(LM_PREFIX + name); } catch { /* no User Timing */ } };
const has = (name) => { try { return (perf()?.getEntriesByName?.(LM_PREFIX + name, 'mark')?.length ?? 0) > 0; } catch { return false; } };

export const lmStart = (name) => mark(`${name}:s`);
export const lmEnd = (name) => { if (!has(`${name}:e`)) mark(`${name}:e`); };   // once: a stage ends where it first ended
export const lmPoint = (name) => { if (!has(name)) mark(name); };
export const lmHas = has;
export function lmSpan(name, p) {
  lmStart(name);
  Promise.resolve(p).then(() => lmEnd(name), () => lmEnd(name));
  return p;
}

// facts the boot knows (the GPU's adapter, the quality level, the terrain's decode time), kept on one page global
export function lmFact(key, value) {
  const g = globalThis;
  (g.__veliaLoadFacts ??= {})[key] = value;
}
export const lmFacts = () => globalThis.__veliaLoadFacts ?? {};

// the page keeps every resource of the load (the browser's default buffer is 250 entries; v2's first minute has more)
export function keepResources(n = 1000) { try { perf()?.setResourceTimingBufferSize?.(n); } catch { /* old browser */ } }
