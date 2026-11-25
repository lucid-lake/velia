// Wall-time budgets in the fast suite (refactor round 2, A4): they gate only with LAKESHORE_STRICT=1, on a quiet machine.
// Otherwise the measured time is printed (one short line, so drift stays visible) and the test passes: the suite runs beside renders and other windows (load
// average 16-19 on 18 cores, 2026-11-11), and a time is not behaviour. The page suite has the same switch (--strict).
//   budget(ms, 400, 'grid')   // assert ms < 400 when strict; else a console line with the time
// A work budget (a count of boxes, steps, bytes) is not a time: assert it with assert, always, no switch.
// tests/budget-lint.test.mjs fails a test file that reads the wall clock and asserts on it without this helper.
import assert from 'node:assert/strict';

export const STRICT = process.env.LAKESHORE_STRICT === '1';

export function budget(value, limit, what, unit = 'ms') {
  const msg = `${what}: ${value.toFixed(2)} ${unit} (budget ${limit} ${unit})`;
  if (STRICT) assert.ok(value < limit, msg);
  else console.log(`${value < limit ? 'time' : 'over budget, not gated (LAKESHORE_STRICT=1 on a quiet machine)'}: ${msg}`);
}
