// The determinism record (refactor Phase 2 step 5): a scripted run's boat state, tick by tick, as bits. Each tick's
// row is a sha-1 (8 hex) of the float64 bits of FIELDS; every 600th tick (10 s) also keeps the numbers themselves, so a
// mismatch names the field and the second. tests/fixtures/sim-*.json hold the rows main made before the shared stepper
// and the Simulation (tools/sim-record.mjs writes them; tests/sim-determinism.test.mjs and tests/slow/ compare).
import { createHash } from 'node:crypto';

// position, heading, heel, speed, the helm and the sail state (sheets, sails' angles and fill, reef, furl, pro trim, engine)
export const FIELDS = ['x', 'z', 'heading', 'heel', 'pitch', 'heave', 'u', 'v', 'yawRate', 'sog', 'cog', 'rudderAngle',
  'boomAngle', 'jibAngle', 'mainSheet', 'jibSheet', 'mainFill', 'jibFill', 'reef', 'reefing', 'furl',
  'traveller', 'twist', 'backstay', 'jibLead', 'throttle', 'engineRpm'];

const H = 8;   // hex digits a tick
const buf = new Float64Array(FIELDS.length + 1);
export function hashState(s, t) {
  buf[0] = t;
  for (let i = 0; i < FIELDS.length; i++) { const v = s[FIELDS[i]]; buf[i + 1] = typeof v === 'number' ? v : typeof v === 'boolean' ? +v : NaN; }
  return createHash('sha1').update(new Uint8Array(buf.buffer)).digest('hex').slice(0, H);
}

// a run's record: rec.tick(state, t) after every physics tick
export function recorder() {
  const rows = [], marks = [];
  return {
    rows, marks,
    tick(s, t) {
      if (rows.length % 600 === 0) marks.push([rows.length, t, ...FIELDS.map((k) => s[k])]);
      rows.push(hashState(s, t));
    },
    out() { return { ticks: rows.length, rows: rows.join(''), marks: JSON.parse(JSON.stringify(marks)) }; },   // the marks as a fixture holds them
  };
}

// the frames' wall-clock steps: a jittery display (60, 144, 30, 90, 120 Hz, a 50 ms hitch and a 150 ms stall that the
// modes clamp to 100 ms), so the accumulator's remainder and the interpolation alpha take every kind of value
export const FRAME_DTS = [1 / 60, 1 / 60, 1 / 144, 1 / 30, 1 / 90, 1 / 120, 0.05, 1 / 60, 0.15, 1 / 144, 1 / 144];
export const frameDt = (i) => FRAME_DTS[i % FRAME_DTS.length];

// compare a run with its fixture: the first tick that differs, with the nearest checkpoint's numbers
export function firstDiff(got, want) {
  if (got.ticks !== want.ticks) return `ticks ${got.ticks} != ${want.ticks}`;
  for (let i = 0; i < want.ticks; i++) {
    if (got.rows.slice(i * H, i * H + H) !== want.rows.slice(i * H, i * H + H)) {
      const m = want.marks.findLast((r) => r[0] <= i), g = got.marks.find((r) => r[0] === m?.[0]);
      const fields = m && g ? FIELDS.filter((k, j) => !Object.is(m[j + 2], g[j + 2])).join(',') : '';
      return `tick ${i} (t ${(i / 60).toFixed(2)} s) differs${fields ? `; at tick ${m[0]} already: ${fields}` : ''}`;
    }
  }
  return null;
}
