// fix/ios-start: the boot's touch check and crash guard (src/ui/diag.js).
// v1 only (/classic/): trimmed to its representative check(s).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { touchDevice } from '../src/ui/diag.js';

test('touch devices: device.js decides (a coarse pointer, a phone or tablet kind); a Mac trackpad never', () => {
  const win = (coarse, w = 390, h = 844, search = '') => ({ innerWidth: w, innerHeight: h, location: { search }, matchMedia: (q) => ({ matches: q.includes('any-pointer: fine') ? !coarse : coarse }) });
  assert.equal(touchDevice(win(true)), true);
  assert.equal(touchDevice(win(true, 1180, 820)), true, 'an iPad');
  assert.equal(touchDevice(win(false, 390, 844)), false, 'a desktop window dragged small');
  assert.equal(touchDevice(win(false, 1512, 945)), false, 'the Mac');
});

test('crash safety: a load that never reached its first frame drops the next one to Low, then the classic water', async () => {
  const { bootGuard, bootDone } = await import('../src/ui/diag.js');
  const m = new Map(), st = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  assert.equal(bootGuard(st, 1000).level, 0);            // first load
  bootDone(st);
  assert.equal(bootGuard(st, 2000).level, 0);            // the last one finished
  assert.equal(bootGuard(st, 3000).level, 1);            // it did not: Low
  assert.equal(bootGuard(st, 4000).level, 2);            // two in a row: Low and the classic water
  bootDone(st); assert.equal(bootGuard(st, 5000).level, 0);
  assert.equal(bootGuard(st, 5000 + 11 * 60e3).level, 0, 'an old mark (a closed tab) does not count');
});
