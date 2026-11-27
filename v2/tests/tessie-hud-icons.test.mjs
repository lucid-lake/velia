// Play as Tessie, the skills row's icons and the Sonar's ping on the dial (the RTS pass): five distinct tiles of one family, the
// cooldown's wipe, the ping's blips at their true bearing and range, type-coded, lit by the wave and fading with the marks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ICONS, tileSvg, wipePath, pingBlips, BLIP_SHAPE, blipPath, HUD, RPG_SKILLS } from '../ui/tessieHud.js';
import { SKILL_ORDER } from '../sim/tessieBounty.js';

test('five icons, one per skill, each a different figure; every tile has the family\'s ground, bevel, wipe and frame', () => {
  assert.deepEqual(Object.keys(ICONS), SKILL_ORDER);
  assert.equal(new Set(Object.values(ICONS)).size, 5, 'no two icons alike');
  for (const id of SKILL_ORDER) {
    const svg = tileSvg(id);
    for (const part of ['class="bg"', 'class="lt"', 'class="gl"', 'class="cd"', 'class="bv"', 'class="base"', 'class="rg"', 'pathLength="100"']) assert.ok(svg.includes(part), `${id}: ${part}`);
    assert.match(ICONS[id], /class="f"/, `${id}: a filled silhouette`);
    assert.doesNotMatch(svg, /<image|href="http|\.png|\.jpg/, `${id}: inline vector only`);
    assert.ok(svg.includes(`url(#tpc-${id})`), `${id}: its own clip`);
  }
  assert.deepEqual(RPG_SKILLS.map((s) => s.short), ['LURE', 'SONAR', 'SURGE', 'BREACH'], 'the names under the slots after DASH');
});

test('the cooldown wipe: nothing at 0, the whole tile at 1, a quarter wedge from nine to twelve at 0.25', () => {
  assert.equal(wipePath(0), ''); assert.equal(wipePath(-1), '');
  assert.equal(wipePath(1), 'M-4 -4H68V68H-4Z');
  const q = wipePath(0.25);
  assert.match(q, /^M32 32L-14\.00 32\.00A46 46 0 0 1 32 -14Z$/, q);
  assert.match(wipePath(0.75), / 0 1 1 32 -14Z$/, 'past half: the large arc');
});

test('the ping on the dial: each marked boat at its true bearing and range on the ping\'s scale; unmarked boats left out', () => {
  const her = { x: 0, z: 0, psi: Math.PI / 2 };   // heading east: ahead is +x, right is +z
  const boats = [
    { id: 'a', kind: 'sail', x: 150, z: 0, heading: Math.PI / 2 },   // 150 m dead ahead: half way up
    { id: 'b', kind: 'power', x: 0, z: 300, heading: 0 },            // 300 m to her right: on the rim at three o'clock
    { id: 'c', kind: 'kayak', x: -150 * Math.SQRT1_2, z: -150 * Math.SQRT1_2, heading: 0 },   // 150 m astern to port
    { id: 'n', kind: 'sail', x: 50, z: 0 },                          // not marked
  ];
  const ping = { rangeM: 300, at: 10, until: 18, has: (id) => id !== 'n' };
  const B = pingBlips(her, boats, ping, 11);
  assert.deepEqual(B.map((b) => b.id), ['a', 'c', 'b'], 'nearest first, the unmarked one left out');
  const at = (id) => B.find((b) => b.id === id);
  const R = HUD.ping.R;
  assert.ok(Math.abs(at('a').x - 66) < 0.01 && Math.abs(at('a').y - (66 - R / 2)) < 0.01, `ahead, half the range (${at('a').x}, ${at('a').y})`);
  assert.ok(Math.abs(at('b').x - (66 + R)) < 0.01 && Math.abs(at('b').y - 66) < 0.01 && !at('b').out, 'right, on the rim');
  const c = at('c'); assert.ok(c.x < 66 && c.y > 66 && Math.abs(Math.hypot(c.x - 66, c.y - 66) - R / 2) < 0.01, 'astern to port, half the range');
  assert.equal(at('a').rot, 0, 'a heading as hers points up');
  assert.deepEqual(B.map((b) => b.shape), ['tri', 'lens', 'arrow'], 'type-coded: a sail, a kayak, a runabout');
  const far = pingBlips(her, [{ id: 'f', kind: 'glass', x: 400, z: 0 }], ping, 12)[0];
  assert.ok(far.out && Math.abs(far.y - (66 - R)) < 0.01, 'past the range: on the rim, flagged out');
});

test('the ping\'s wave lights each blip as it passes; the blips fade as the marks run out; reduced motion lights them at once', () => {
  const her = { x: 0, z: 0, psi: 0 };   // heading north: ahead is −z
  const boats = [{ id: 'near', kind: 'sail', x: 0, z: -30 }, { id: 'far', kind: 'glass', x: 0, z: -270 }];
  const ping = { rangeM: 300, at: 0, until: 10, has: () => true };
  const t0 = pingBlips(her, boats, ping, 0.2);
  assert.deepEqual(t0.map((b) => b.on), [true, false], 'at 0.2 s the wave has passed 30 m, not 270 m');
  assert.ok(pingBlips(her, boats, ping, HUD.ping.waveS).every((b) => b.on), 'after the wave every blip is lit');
  assert.ok(pingBlips(her, boats, ping, 0.2, { reduced: true }).every((b) => b.on), 'reduced motion: all at once');
  const op = (t) => pingBlips(her, boats, ping, t)[0].op;
  assert.equal(op(0), 1); assert.ok(op(5) < op(1) && op(9.9) < op(5)); assert.ok(op(10) >= HUD.ping.fadeMin - 1e-9 && op(10) <= HUD.ping.fadeMin + 1e-9);
  assert.deepEqual(pingBlips(her, boats, null, 1), []); assert.deepEqual(pingBlips(null, boats, ping, 1), []);
});

test('every boat kind on the water has a blip shape, each a real path', () => {
  for (const k of ['sail', 'halcyon', 'glass', 'kayak', 'power', 'paddle', 'jetski', 'anchored', 'rival']) assert.ok(BLIP_SHAPE[k], k);
  assert.equal(new Set(['sail', 'power', 'kayak', 'glass', 'paddle', 'jetski'].map((k) => BLIP_SHAPE[k])).size, 6, 'six types, six shapes');
  for (const sh of new Set(Object.values(BLIP_SHAPE))) assert.match(blipPath(sh), /^M[-\d. ]+/, sh);
});

test('a pile of blips spreads to the minimum spacing, near its true spot; a lone blip stays put', () => {
  const her = { x: 0, z: 0, psi: 0 };
  const pile = [0, 1, 2, 3, 4].map((i) => ({ id: `k${i}`, kind: 'kayak', x: i * 0.5, z: -100 })).concat([{ id: 's', kind: 'sail', x: 150, z: 0 }]);
  const B = pingBlips(her, pile, { rangeM: 300, at: 0, until: 8, has: () => true }, 2);
  const ks = B.filter((b) => b.id[0] === 'k');
  for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) assert.ok(Math.hypot(ks[i].x - ks[j].x, ks[i].y - ks[j].y) >= HUD.ping.minPx - 0.6, `${ks[i].id}–${ks[j].id} apart`);
  assert.ok(ks.every((b) => Math.hypot(b.x - b.tx, b.y - b.ty) < 3 * HUD.ping.minPx), 'each near its true spot');
  const s = B.find((b) => b.id === 's'); assert.deepEqual([s.x, s.y], [s.tx, s.ty], 'the lone sailboat exactly at its bearing and range');
});

test('the Sonar icon is a scope (a ring, a sweep wedge, blips), not a broadcast fan; the Dash is her head and neck', () => {
  assert.match(ICONS.sonar, /<circle class="s" cx="32" cy="29" r="17"/); assert.doesNotMatch(ICONS.sonar, /A31\.5/);
  assert.match(ICONS.dash, /class="d" cx="50"/, 'an eye on her head');
});
