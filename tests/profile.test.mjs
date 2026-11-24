// The device profile (src/core/profile.js): each axis from a forced device, the old helpers routed through it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { profileFor, profileOf, readFacts, kindOf, screenTokens, parseProfileFlag, forcedOf, LIMITS } from '../src/core/profile.js';
import { isCoarse } from '../src/ui/touchMap.js';
import { deviceKindNow, touchDevice } from '../src/ui/device.js';

import { UA, fakeWin, DEVICES } from './helpers/devices.mjs';

test('the six devices: input, form, screen, quirks and the layout kind', () => {
  const want = {
    ipadTrackpad: { input: 'mixed', form: 'tablet', screen: 'full', kind: 'tablet', ios: true, touch: true },
    touchLaptop: { input: 'mixed', form: 'desktop', screen: 'full', kind: 'desktop', ios: false, touch: false },
    smallDesktop: { input: 'keys', form: 'desktop', screen: 'compact', kind: 'phone-land', ios: false, touch: false },
    iphoneTurned: { input: 'touch', form: 'phone', screen: 'compact', kind: 'phone-land', ios: true, touch: true },
    androidSideways: { input: 'touch', form: 'phone', screen: 'compact', kind: 'phone-land', ios: false, touch: true },
    desktop: { input: 'keys', form: 'desktop', screen: 'full', kind: 'desktop', ios: false, touch: false },
  };
  for (const [name, w] of Object.entries(want)) {
    const p = profileFor(DEVICES[name]);
    assert.equal(p.input, w.input, `${name} input`); assert.equal(p.form, w.form, `${name} form`); assert.equal(p.screen, w.screen, `${name} screen`);
    assert.equal(kindOf(p), w.kind, `${name} kind`); assert.equal(deviceKindNow(DEVICES[name]), w.kind, `${name} deviceKindNow`);
    assert.equal(p.quirks.includes('ios-webkit'), w.ios, `${name} ios-webkit`);
    assert.equal(touchDevice(DEVICES[name]), w.touch, `${name} touchDevice (the memory and pacing paths)`);
    assert.equal(isCoarse(DEVICES[name]), w.input === 'touch', `${name} isCoarse`);
  }
  assert.ok(profileFor(DEVICES.iphoneTurned).quirks.includes('rotated'));
  assert.ok(!profileFor(DEVICES.androidSideways).quirks.includes('rotated'));
});

test('screen: compact under 500 px short side, short under 370 px tall, the tokens from LIMITS', () => {
  assert.equal(profileFor(fakeWin({ coarse: true, ua: UA.iphone, touch: 5, screen: [390, 844], inner: [844, 340], frameH: 340 })).screen, 'short', 'a browser tab');
  assert.equal(profileFor(fakeWin({ coarse: true, ua: UA.iphone, touch: 5, screen: [390, 844], inner: [844, 390] })).screen, 'compact', 'the Home Screen');
  assert.deepEqual(screenTokens(1280, 720), ['full']);
  assert.deepEqual(screenTokens(640, 900), ['full', 'narrow', 'upright', 'portrait']);
  assert.deepEqual(screenTokens(844, 390), ['compact', 'low', 'tight']);
  assert.deepEqual(screenTokens(844, 340, 340), ['short', 'compact', 'low', 'tight'], 'a short frame is compact too');
  assert.deepEqual(screenTokens(390, 844), ['compact', 'narrow', 'slim', 'upright', 'portrait']);
  assert.deepEqual(screenTokens(LIMITS.narrow + 100, LIMITS.low), ['full', 'low']);
  assert.deepEqual(screenTokens(LIMITS.narrow + 100, LIMITS.tight), ['full', 'low', 'tight']);
});

test('?profile= forces axes; ?touch=1|0 is the input alias; a bad value is ignored', () => {
  assert.deepEqual(parseProfileFlag('form:phone,input:touch,gpu:2'), { form: 'phone', input: 'touch', gpu: 2 });
  assert.deepEqual(parseProfileFlag('gpu:7,form:watch,quirks:rotated+nope'), { quirks: ['rotated'] });
  assert.deepEqual(parseProfileFlag('1'), {}, '?profile=1 is the load-time marks (src/profile.js)');
  assert.deepEqual(forcedOf('?touch=1'), { input: 'touch' });
  assert.deepEqual(forcedOf('?touch=0&profile=input:mixed'), { input: 'mixed' });
  const p = profileFor({ ...DEVICES.desktop, location: { search: '?profile=form:phone,input:touch,gpu:2,screen:short' } });
  assert.equal(p.form, 'phone'); assert.equal(p.input, 'touch'); assert.equal(p.gpu, 2); assert.equal(p.screen, 'short'); assert.ok(p.forced);
  assert.equal(profileFor({ ...DEVICES.desktop, location: { search: '?touch=1' } }).form, 'desktop', '?touch=1 is the hands, not the device');
});

test('gpu follows what the page sets; facts read safely from a bare object', () => {
  const f = readFacts({});
  assert.equal(f.coarse, false); assert.equal(f.w, 1280);
  assert.equal(profileOf(f, {}, { gpu: 3 }).gpu, 3);
  assert.equal(profileOf(f, { gpu: 1 }, { gpu: 3 }).gpu, 1, 'a forced gpu wins');
  assert.ok(profileOf(f, {}, { slowCompiler: true }).quirks.includes('slow-compiler'));
});
