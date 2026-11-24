// An act's handle (v2/stage/acts.js start → { done, stop, step? }) with its end readable at once: the director steps on a
// sim clock (a test runs 600 s in one synchronous loop), so it reads `result` and never waits for the promise to settle.
//   const h = makeHandle({ step, stop });  h.finish(result) once ('played' | 'skipped' | 'stopped' | …); h.result (undefined
//   while on stage); h.done resolves with it
export function makeHandle({ step = null, stop = null } = {}) {
  let resolve = null;
  const h = {
    result: undefined,
    done: new Promise((r) => { resolve = r; }),
    finish(result = 'played') { if (h.result !== undefined) return; h.result = result; resolve(result); },
    step: step ? (dt) => { if (h.result === undefined) step(dt, h); } : null,
    stop() { if (h.result !== undefined) return; stop?.(h); h.finish('stopped'); },
  };
  return h;
}
