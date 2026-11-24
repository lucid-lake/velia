// Load-proof CPU timing for the fast suites (backlog v2 #29). A test that times its code once reads the machine's load
// as much as the code: under load 44 on 18 cores (2026-11-13) a single 50-frame batch of the boat's ribbons read over
// its 2 ms with the code unchanged. Many short batches and the fastest one measure the code's own cost: other processes
// only add time, and a batch of a few ms often runs inside one scheduler slice even when the machine is busy.
//   const ms = bestOf(() => work(), { batches: 15, per: 20 })   // ms per call, the fastest batch's mean
//   const ms = bestOf(() => work(), { batches: 15, per: 20, warm: 50 })
// `bestOfEach` runs a whole sequence `batches` times and keeps each step's fastest time (steps that differ, e.g. the
// forecast's job): → an array of ms, one per step.
export function bestOf(fn, { batches = 15, per = 20, warm = 0 } = {}) {
  for (let i = 0; i < warm; i++) fn(i);
  let best = Infinity;
  for (let b = 0; b < batches; b++) {
    const t0 = performance.now();
    for (let i = 0; i < per; i++) fn(i);
    best = Math.min(best, (performance.now() - t0) / per);
  }
  return best;
}

// `run(time)` runs the sequence once and calls `time(stepFn)` for each step it wants timed, in the same order each run.
export function bestOfEach(run, { batches = 5 } = {}) {
  let best = null;
  for (let b = 0; b < batches; b++) {
    const ms = [];
    run((step) => { const t0 = performance.now(); const r = step(); ms.push(performance.now() - t0); return r; });
    best = best ? best.map((v, i) => Math.min(v, ms[i] ?? Infinity)) : ms;
  }
  return best;
}
