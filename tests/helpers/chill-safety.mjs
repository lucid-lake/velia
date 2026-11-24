// The Chill safety asserts shared by tests/navigator*.test.mjs: the hard rules of src/modes/chill/navigator.js NAV.hard.
import assert from 'node:assert/strict';
import { NAV } from '../../src/sim/modes/chill/navigator.js';

const fmt = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'at').map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(1) : v]));

export function assertSafe(name, out) {
  const r = out.rec, H = NAV.hard;
  console.log(`# ${name}: ${JSON.stringify(fmt(r))} stops ${out.reached.map((x) => `${x.key}@${x.t | 0}s`).join(' ')} · ${JSON.stringify(out.nav)}`);
  assert.ok(r.minDepth >= H.depth, `${name}: depth ${r.minDepth.toFixed(1)} m at ${r.at.depth}`);
  assert.ok(r.minShore >= H.shore, `${name}: shore ${r.minShore.toFixed(1)} m at ${r.at.shore}`);
  assert.ok(r.minIsland >= H.shore, `${name}: island ${r.minIsland.toFixed(1)} m`);
  assert.ok(r.minObj >= H.obj, `${name}: object ${r.minObj.toFixed(1)} m at ${r.at.obj}`);
  assert.ok(r.minBuoy >= H.buoy, `${name}: buoy ${r.minBuoy.toFixed(1)} m`);
  assert.ok(r.minTraffic >= H.traffic, `${name}: traffic ${r.minTraffic.toFixed(1)} m at ${r.at.traffic}`);
  assert.ok(r.worstStallS <= 30, `${name}: in irons ${r.worstStallS.toFixed(1)} s at ${r.at.stall}`);
}

