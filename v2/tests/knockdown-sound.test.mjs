// K2 the knockdown's sound (v2/audio/knockdownSound.js): v1's mix untouched while she is upright; past 40° the roar (water over the
// rail), the flog and the rush come up with the roll, one slam as the roll passes its middle (once per excursion), the sails crack
// every 0.35–0.9 s; the gust's roar on the beds' code wind; through the recorded engine's adjust hook after the speed feel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKnockdownSound, knockdownWind, KD_SOUND } from '../audio/knockdownSound.js';
import { LEVEL } from '../../src/boatAudio.js';

const mixOf = () => ({ gains: { roar: 0.05, flog: 0.1, rush: 0.2, wind: 0.4 }, hz: { hull: 900, wind: 600 }, rate: { flog: 1 }, events: [] });

test('upright: the mix is untouched', () => {
  const ks = createKnockdownSound(), m = mixOf(), before = JSON.stringify(m);
  for (let i = 0; i < 120; i++) ks.adjust(m, { kdRoll: 0, kdT: i / 60 });
  assert.equal(JSON.stringify(m), before);
  const o = { gains: { wind: 0.4 }, hz: { wind: 600 } }; knockdownWind(o, 0); assert.equal(o.gains.wind, 0.4);
});

test('the roll: roar, flog and rush rise with it; one slam per excursion; the sails crack; the wind roars', () => {
  const ks = createKnockdownSound(); let slams = 0, snaps = 0, last = null;
  for (let i = 0; i <= 240; i++) {
    const k = Math.min(1, i / 120), m = mixOf();
    ks.adjust(m, { kdRoll: k, kdT: i / 60 });
    slams += m.events.filter((e) => e.kind === 'slam').length; snaps += m.events.filter((e) => e.kind === 'snap').length;
    if (k === 1) last = m;
  }
  assert.equal(slams, 1);
  assert.ok(snaps >= 3 && snaps <= 10, `snaps ${snaps}`);
  assert.ok(Math.abs(last.gains.roar - KD_SOUND.roar * LEVEL.roar) < 1e-9 && last.gains.flog >= KD_SOUND.flog * LEVEL.flog - 1e-9 && last.rate.flog > 1.2 && last.hz.hull > 3000);
  // back upright, the next roll slams again
  ks.adjust(mixOf(), { kdRoll: 0, kdT: 5 });
  const m = mixOf(); ks.adjust(m, { kdRoll: 0.8, kdT: 5.1 }); assert.equal(m.events.filter((e) => e.kind === 'slam').length, 1);
  const o = { gains: { wind: 0.4 }, hz: { wind: 600 } }; knockdownWind(o, 1);
  assert.ok(Math.abs(o.gains.wind - 0.4 * (1 + KD_SOUND.wind)) < 1e-12 && o.hz.wind > 600);
});
