// Refactor round 2 B1: the stars' instanced draw covers only the slots still drawing (src/fireworks/drawSpan.js). The
// picture must stay exact: every star that draws anything at show time t sits in a slot below the span's count, also
// when the engine's ring wraps and overwrites part of an older spawn. Behaviour only: the module's output is checked
// against the star shader's windows (src/fireworks/engine.js starMaterial: the head while 0 ≤ age ≤ burn, the streak
// while 0 ≤ age ≤ burn + 3 tau; age = t − born − delay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDrawSpan, starEnd, DRAW_PAD } from '../src/fireworks/drawSpan.js';
import { buildShell, riserStar, ALL_TYPES, isGround } from '../src/fireworks/shells.js';
import { makeShow } from '../src/fireworks/show.js';

// the shader's own windows: does a star written at `born` draw anything at t?
const draws = (s, born, t) => { const age = t - born - (s.delay ?? 0); return age >= 0 && age <= Math.max(s.burn, s.burn + 3 * s.tau); };

test('drawSpan: 0 with nothing spawned, the highest live end, spans dropped after their end, 0 after a reset', () => {
  const sp = createDrawSpan();
  assert.equal(sp.count(0), 0);
  sp.add(0, 100, 5); sp.add(100, 300, 8);
  assert.equal(sp.count(1), 300);
  assert.equal(sp.count(8 + DRAW_PAD), 300);
  assert.equal(sp.count(8 + DRAW_PAD + 0.01), 0);
  sp.add(0, 50, 20);
  assert.equal(sp.count(10), 50);
  sp.reset();
  assert.equal(sp.count(10), 0);
});

test('drawSpan: starEnd covers the head and the streak of every shell type and the riser', () => {
  for (const type of ALL_TYPES) {
    const shell = buildShell(type, { inches: 8, seed: 4 });
    for (const s of shell.stars) {
      const end = starEnd(s, 10);
      assert.ok(!draws(s, 10, end + 1e-3), `${type}: a star draws after its end`);
    }
  }
  const r = riserStar({ v0: 1, t: 3.2, k: 0.01, trunk: true });
  assert.ok(!draws(r, 0, starEnd(r, 0) + 1e-3));
});

test('drawSpan: on a whole show in a small ring (wraps and overwrites), every drawing star is inside the span', () => {
  const N = 6000, show = makeShow(1), ev = show.events, slot = new Array(N).fill(null), sp = createDrawSpan();
  let cursor = 0, next = 0, wraps = 0, checks = 0, maxCount = 0;
  const alloc = (n) => { if (n > N) n = N; if (cursor + n > N) { cursor = 0; wraps++; } const s = cursor; cursor += n; return s; };
  for (let t = -1; t <= 320; t += 0.05) {
    while (next < ev.length && ev[next].t <= t + 0.5) {   // the engine's lookahead
      const e = ev[next++];
      const shell = buildShell(e.type, { inches: e.inches, colour: e.colour, colour2: e.colour2, seed: e.seed, tier: 'desktop', plane: [1, 0, 0], spread: e.spread ?? 1 });
      const list = [];
      if (!isGround(e.type)) list.push([riserStar({ v0: 1, t: e.rise, k: 0.01, trunk: e.type === 'palm' }), e.t]);
      for (const s of shell.stars) list.push([s, e.burst]);
      const start = alloc(list.length);
      let until = -Infinity;
      list.slice(0, N).forEach(([s, born], k) => { slot[start + k] = [s, born]; until = Math.max(until, starEnd(s, born)); });
      sp.add(start, start + Math.min(list.length, N), until);
    }
    const n = sp.count(t);
    maxCount = Math.max(maxCount, n);
    for (let i = n; i < N; i++) if (slot[i]) { checks++; assert.ok(!draws(slot[i][0], slot[i][1], t), `slot ${i} draws at t ${t.toFixed(2)} outside the span ${n}`); }
  }
  assert.ok(wraps > 3, `the ring wrapped ${wraps} times`);
  assert.ok(checks > 1e5 && maxCount > 0);
  assert.equal(sp.count(400), 0, 'after the show: no draw');
});
