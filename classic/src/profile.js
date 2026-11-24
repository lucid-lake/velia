// Load-time marks behind ?profile=1 (tools/loadprof.mjs reads every "ls:" mark and measure). Off: no-ops.
//   import { span, mark } from './profile.js';
//   const end = span('water'); …; end();       // a performance.measure "ls:water"
//   span('lod', t0)();                         // a span that began at t0
//   mark('lut-done');                           // a performance.mark "ls:lut-done"
import { FLAGS } from '../../src/sim/core/flags.js';
const ON = typeof location !== 'undefined' && FLAGS.profile === '1';   // ?profile=form:phone… is the device profile's (src/core/profile.js)

export function mark(name) { if (ON) performance.mark(`ls:${name}`); }
export function span(name, t0 = performance.now()) {
  if (!ON) return () => {};
  return () => performance.measure(`ls:${name}`, { start: t0, end: performance.now() });
}
