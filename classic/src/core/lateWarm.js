// The late warm-up (perf/ready-first-frame): a live page is ready at its first frame, and what that view
// does not draw is built after, between live frames (src/core/warmup.js liveHooks: the warm-up's state is set only while
// three reads it, never across a frame). src/core/index.js makes the jobs; here, when the queue runs and how it drains.
//
//   lateOn({ warm, headless, filmui, latewarm })   true on a live page: captures (?headless) and films (?filmui) build
//     everything before their first picture (their draws wait for every build, so no picture changes); ?latewarm=boot
//     builds everything behind the card, as before (the A/B and the kill switch); no warm-up (?warm=0): nothing to queue
//   const q = createLateQueue(jobs, { D, probeJob })   jobs: [[name, async () => [result …]] …], run in order, one at a time
//     q.start()   at the first live frame (idempotent); holds the water probe's re-captures (probeJob.hold) until the
//                 'reprobe' job is done (probeJob.release), or the queue's end; a job that throws is logged and skipped
//     q.done      a promise: the queue drained
//   D.late = { start, end, jobs: [[name, ms] …] } and D.lateStep (the job running, null between) for the bench
//   (tools/phoneload.mjs); each job's results go to D.warm as [name, result]

export const lateOn = ({ warm, headless, filmui, latewarm }) => !!warm && !headless && !filmui && latewarm !== 'boot';

export function createLateQueue(jobs, { D, probeJob = null, now = () => performance.now() } = {}) {
  let started = false, resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  if (jobs.length) probeJob?.hold?.();   // no re-capture before its pipelines are in (the water keeps the load's probe)
  async function run() {
    D.late = { start: Math.round(now()), end: null, jobs: [] };
    try {
      for (const [name, job] of jobs) {
        D.lateStep = name;
        const t1 = now();
        try { for (const w of (await job()) ?? []) D.warm?.push([name, w]); } catch (e) { D.error?.('late', `${name}: ${e?.message ?? e}`); }
        D.late.jobs.push([name, Math.round(now() - t1)]);
        if (name === 'reprobe') probeJob?.release?.();
      }
    } finally {
      D.lateStep = null; probeJob?.release?.();
      D.late.end = Math.round(now());
      resolveDone(D.late);
    }
  }
  return {
    start() { if (started) return; started = true; if (!jobs.length) { resolveDone(null); return; } run(); },
    done,
    get started() { return started; },
  };
}

// --- The frame budget in play (perf/enter-freeze) ---
// three yields between every piece of a build (yieldToMain: scheduler.yield where the browser has it, else
// requestAnimationFrame: each node build's shader stages, each object of a compileAsync). In play the late queue's lanes
// resumed those pieces back to back and Chrome drew a frame only when its own starvation guard stepped in: frames of
// 100–270 ms on a desktop, 0.2–0.6 s on a phone, for the queue's whole drain. Installed, the budget replaces
// scheduler.yield: a yield resolves in a task of its own while this frame's work (since the first piece after the last
// display frame) is under `ms`, else after the next frame; one waiting piece at a time, first come first served. No piece
// is cut, so a frame can run one piece past the share. With on() false a yield resolves in the next task, at
// full speed. Nothing else in the page calls scheduler.yield.
//   const b = frameBudget({ ms, on })   ms: the share, or a function read per piece; b.yield(): the budgeted yield; b.install() → undo (scheduler.yield replaced, or a
//     scheduler made where the browser has none); b.stats { pieces, waits } (waits: a frame's share spent, the rest held)
//   raf, post, now: the frame's and the task's hooks (the tests pass their own)
export function frameBudget({ ms = 8, on = () => true, g = globalThis, now = () => performance.now(), raf = null, post = null } = {}) {
  raf ??= (f) => g.requestAnimationFrame(f);
  // each piece in a task of its own: the browser's scheduler.yield where it has one (its continuations go ahead of other
  // tasks, as three's own yields did: a plain task let the GLB parse and the timers in between and the kayak pair's
  // warm-up took 3× as long), else a MessageChannel message
  const native = typeof g.scheduler?.yield === 'function' ? g.scheduler.yield.bind(g.scheduler) : null;
  if (!post && native) post = (f) => { native().then(f); };
  if (!post) {
    const ch = new g.MessageChannel(), q = [];
    ch.port1.onmessage = () => q.shift()?.();
    ch.port1.unref?.(); ch.port2.unref?.();   // (Node: never keeps a test alive)
    post = (f) => { q.push(f); ch.port2.postMessage(0); };
  }
  const waiting = [], stats = { pieces: 0, waits: 0 };
  let sliceStart = null, frameAsked = false, blocked = false, posted = false;
  const schedule = () => { if (posted || blocked || !waiting.length) return; posted = true; post(pump); };
  const frame = () => { frameAsked = false; sliceStart = null; if (blocked) { blocked = false; schedule(); } };
  function pump() {
    posted = false;
    if (!waiting.length) return;
    if (on()) {
      const t = now();
      if (sliceStart == null) { sliceStart = t; if (!frameAsked) { frameAsked = true; raf(frame); } }   // the share ends at the next frame
      if (t - sliceStart >= (typeof ms === 'function' ? ms() : ms)) { blocked = true; stats.waits++; return; }   // spent: the rest after the next frame
    }
    stats.pieces++;
    waiting.shift()();   // the piece runs in this task's microtasks, then the next pump
    schedule();
  }
  const yieldNow = () => new Promise((res) => { waiting.push(res); schedule(); });
  function install() {
    const s = g.scheduler, own = !!s && Object.prototype.hasOwnProperty.call(s, 'yield'), prev = own ? s.yield : undefined;
    try { if (s) s.yield = yieldNow; else g.scheduler = { yield: yieldNow }; } catch { return () => {}; }
    return () => {
      try { if (!s) delete g.scheduler; else if (own) s.yield = prev; else delete s.yield; } catch { /* left as is */ }
      while (waiting.length) waiting.shift()();   // nothing left waiting on a budget that is gone
    };
  }
  return { yield: yieldNow, install, stats, get waiting() { return waiting.length; } };
}

// The policy (perf/enter-freeze; owner go 2026-11-11): from the first live frame every live warm-up yields on the budget
// (the late queue, behind the card and in play); a priority call (a kayak about to go full) at BUDGET.priority × the
// share, so the pair is not shown later (src/core/index.js). ?latebudget=<ms>: the frame's share (0: no budget). The
// home card does not hold Enter for the queue (owner, 2026-11-11: ENTER as before; the hold cost +4 s on a loaded desktop).
export const BUDGET = Object.freeze({ desktop: 8, phone: 16, priority: 3 });
export function budgetMs({ phone = false, latebudget = null } = {}) {
  const v = latebudget == null || latebudget === '' ? NaN : parseFloat(latebudget);
  return Number.isFinite(v) ? Math.max(0, v) : phone ? BUDGET.phone : BUDGET.desktop;
}
