// Touch input mapping (src/ui/touchMap.js): the helm strip, the Tack / Gybe offer and the manoeuvre. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { helmFromStrip, tackOffer, TackAssist, isCoarse, TOUCHUI } from '../src/ui/touchMap.js';

const D = Math.PI / 180;

test('helm strip: amidships inside the dead zone, full at the throw, monotonic and odd', () => {
  const W = 300, full = W * TOUCHUI.throwFrac;
  assert.equal(helmFromStrip(0, W), 0);
  assert.equal(helmFromStrip(2, W), 0);
  assert.equal(helmFromStrip(full, W), 1);
  assert.equal(helmFromStrip(full * 3, W), 1);
  assert.equal(helmFromStrip(-full * 3, W), -1);
  let prev = -2;
  for (let dx = -full; dx <= full; dx += 5) { const v = helmFromStrip(dx, W); assert.ok(v >= prev); assert.equal(helmFromStrip(-dx, W) + 0, -v + 0); prev = v; }
  assert.ok(helmFromStrip(full / 2, W) < 0.5, 'fine near the middle');
});

test('tack offer: near the bow a Tack, running a Gybe, a reach nothing, a stopped boat nothing', () => {
  assert.equal(tackOffer({ twa: -45 * D, speed: 3 }), 'tack');
  assert.equal(tackOffer({ twa: 60 * D, speed: 3 }), 'tack');
  assert.equal(tackOffer({ twa: 90 * D, speed: 3 }), null);
  assert.equal(tackOffer({ twa: 160 * D, speed: 3 }), 'gybe');
  assert.equal(tackOffer({ twa: -170 * D, speed: 3 }), 'gybe');
  assert.equal(tackOffer({ twa: -45 * D, speed: 0.1 }), null);
});

// a toy turn: the bow swings at rate 12°/s per unit helm; + helm turns to starboard, which lowers the wind angle
// measured from the bow (wind comes from a fixed direction)
function run(kind, twa0) {
  const a = new TackAssist(); a.start(kind, twa0 * D);
  let twa = twa0 * D, t = 0, maxHelm = 0, sign = Math.sign(twa);
  while (a.active && t < 20) {
    const h = a.step(0.05, twa); maxHelm = Math.max(maxHelm, Math.abs(h));
    twa -= h * 12 * D * 0.05; if (twa > Math.PI) twa -= 2 * Math.PI; if (twa < -Math.PI) twa += 2 * Math.PI;
    t += 0.05;
  }
  return { twa: twa / D, t, maxHelm, active: a.active, sign };
}

test('tack: from the port bow the helm goes to port, the wind ends on the starboard bow and the helm eases out', () => {
  const r = run('tack', -42);
  assert.ok(!r.active); assert.ok(r.twa > 25, `ended at ${r.twa}`); assert.ok(r.maxHelm > 0.8);
  const s = run('tack', 42);
  assert.ok(s.twa < -25, `ended at ${s.twa}`);
});

test('tack steers toward the wind (port wind → negative helm), gybe away from it', () => {
  const a = new TackAssist(); a.start('tack', -40 * D); assert.ok(a.step(0.05, -40 * D) < 0);
  const g = new TackAssist(); g.start('gybe', -150 * D); assert.ok(g.step(0.05, -150 * D) > 0);
});

test('gybe: the stern goes through the wind and the manoeuvre ends', () => {
  const r = run('gybe', -150);
  assert.ok(!r.active); assert.ok(r.twa > 0 && r.twa < 160, `ended at ${r.twa}`);
});

test('a manoeuvre that never finishes times out; cancel stops it at once; a bad kind does not start', () => {
  const a = new TackAssist(); a.start('tack', -40 * D);
  let t = 0; while (a.active && t < 30) { a.step(0.1, -40 * D); t += 0.1; }
  assert.ok(!a.active && t < TOUCHUI.tackTimeoutS + TOUCHUI.easeS + 0.5);
  const b = new TackAssist(); b.start('tack', 0.5); b.cancel(); assert.equal(b.step(0.1, 0.5), 0);
  assert.equal(new TackAssist().start('jump', 0), false);
});

test('isCoarse reads the pointer media query and the ?touch flag', () => {
  const win = (search, coarse, fine = false) => ({ location: { search }, matchMedia: (q) => ({ matches: q.includes('any-pointer') ? fine : coarse }) });
  assert.equal(isCoarse(win('', true)), true);
  assert.equal(isCoarse(win('', false)), false);
  assert.equal(isCoarse(win('', true, true)), false, 'a tablet with a mouse attached');
  assert.equal(isCoarse(win('?touch=1', false)), true);
  assert.equal(isCoarse(win('?touch=0', true)), false);
});
