// The glass is the contrast guarantee. Fast, no browser: the tokens' own colours,
// laid on a plate over the brightest world the 12 px blur can leave, must pass WCAG AA. The live check on the real page
// (every element, the worst backgrounds, three viewports) is tools/probe_contrast.mjs. Run: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luminance, ratio, over, inkRatio, need } from '../src/ui/contrast.js';
import { TOKENS } from '../src/ui/tokens.js';

// the brightest blurred backdrop we have seen under a plate: sun glare or a snow field (the probe's p99 stays under it)
const BRIGHT = [225, 225, 225];
const day = { cream: TOKENS.cream, amber: TOKENS.amber, port: TOKENS.port, stbd: TOKENS.stbd, navy: TOKENS.navy };

test('wcag maths: the reference ratios', () => {
  assert.equal(+ratio([0, 0, 0], [255, 255, 255]).toFixed(2), 21);
  assert.equal(+ratio([119, 119, 119], [255, 255, 255]).toFixed(2), 4.48);   // #777 on white: the classic just-under-AA
  assert.ok(luminance([255, 255, 255]) > 0.99);
  assert.deepEqual(over([100, 100, 100], 0.5, [0, 0, 0]), [50, 50, 50]);
  assert.equal(need({ kind: 'text', px: 16 }), 4.5); assert.equal(need({ kind: 'icon' }), 3); assert.equal(need({ kind: 'text', px: 24 }), 3);
});

for (const [name, set, world] of [['day', day, BRIGHT], ['night', { ...TOKENS.night }, [90, 70, 70]]]) {
  test(`${name}: text, the lit colour and port / starboard hold AA on a plate over a bright world`, () => {
    const plate = over(set.navy, name === 'day' ? TOKENS.glass : TOKENS.nightGlass, world);
    for (const [k, c, a] of [['ink', set.cream, TOKENS.ink], ['soft ink', set.cream, TOKENS.soft], ['faint ink (the floor)', set.cream, TOKENS.faint], ['lit amber', set.amber, 1]]) {
      const r = inkRatio(c, a, plate);
      assert.ok(r >= 4.5, `${name} ${k}: ${r.toFixed(2)}:1 on a plate over ${world}`);
    }
    // port red and starboard green are graphics (the needle, the sectors): 3:1; the P and S letters sit on a chip of that colour, in navy
    for (const [k, c] of [['port', set.port], ['starboard', set.stbd]]) {
      assert.ok(inkRatio(c, 1, plate) >= 3, `${name} ${k} graphic`);
      assert.ok(ratio(set.navy, c) >= 4.5, `${name} ${k} chip letter`);
    }
    // icons and the rest state need 3:1
    assert.ok(inkRatio(set.cream, TOKENS.rest, plate) >= 3, `${name} rest icon`);
  });
}

test('the old design could not promise it: 62 % cream with no plate fails on the same world', () => {
  assert.ok(inkRatio(TOKENS.cream, 0.62, BRIGHT) < 3);
});
