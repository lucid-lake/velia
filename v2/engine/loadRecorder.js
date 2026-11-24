// The load report's recorder (?loadreport=1 only; ui/loading.js starts it as the page's first module): what the marks
// cannot see.
//   long tasks   PerformanceObserver 'longtask' (Chrome, Edge, Android), with the browser's attribution
//   stalls       a 50 ms heartbeat's late beats (every browser: Safari has no long-task entries), so an iPhone still shows
//                when the main thread was held
//   heap         performance.memory where it exists (Chrome), sampled at each stall and at the end
//   visibility   when the page was hidden (a phone pauses a hidden page: a load that waited there is not slow)
// It stops itself once the report is shown (stop()) or after `maxMs`. Nothing is sent anywhere.
//   const rec = startLoadRecorder();   rec.data() → { longTasks, stalls, heap, observed: { longtask } }
export const BEAT_MS = 50, STALL_MS = 120;

export function startLoadRecorder({ perf = globalThis.performance, PO = globalThis.PerformanceObserver, maxMs = 120000, setT = globalThis.setTimeout?.bind(globalThis), clearT = globalThis.clearTimeout?.bind(globalThis) } = {}) {
  const longTasks = [], stalls = [], heap = [], visibility = [];
  let observer = null, stopped = false, timer = null;
  const observed = { longtask: false };
  try {
    if (PO && (PO.supportedEntryTypes ?? []).includes('longtask')) {
      observer = new PO((list) => {
        for (const e of list.getEntries()) {
          const a = e.attribution?.[0];
          longTasks.push({ start: e.startTime, dur: e.duration, attr: a ? [a.name, a.containerType, a.containerName].filter((x) => x && x !== 'unknown' && x !== 'self').join(' ') || 'self' : '' });
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      observed.longtask = true;
    }
  } catch { observer = null; }
  const doc = globalThis.document;
  const onVis = () => visibility.push({ t: perf.now(), state: doc.visibilityState });   // an iPhone holds a hidden page's timers and GPU
  if (doc?.addEventListener) { if (doc.visibilityState === 'hidden') onVis(); doc.addEventListener('visibilitychange', onVis); }
  const sampleHeap = () => { const m = perf?.memory; if (m) heap.push({ t: perf.now(), usedMB: m.usedJSHeapSize / 1048576, limitMB: m.jsHeapSizeLimit / 1048576 }); };
  let last = perf.now();
  const beat = () => {
    if (stopped) return;
    const now = perf.now(), gap = now - last;
    if (gap > STALL_MS) { stalls.push({ start: last + BEAT_MS, dur: gap - BEAT_MS }); sampleHeap(); }
    last = now;
    if (now > maxMs) { stop(); return; }
    timer = setT(beat, BEAT_MS);
  };
  timer = setT?.(beat, BEAT_MS);
  function stop() {
    if (stopped) return;
    stopped = true;
    if (timer != null) clearT?.(timer);
    try { observer?.disconnect(); } catch { /* gone */ }
    doc?.removeEventListener?.('visibilitychange', onVis);
    sampleHeap();
  }
  return { stop, get stopped() { return stopped; }, data: () => ({ longTasks: longTasks.slice(), stalls: stalls.slice(), heap: heap.slice(), visibility: visibility.slice(), observed: { ...observed } }) };
}
