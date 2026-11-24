// K3 the game end's timeline (v2/sim/knockdownGame.js): the warning's line (not repeated within 8 s) and its 4 s of amber; the
// knockdown: the frame slows from 0.9 s and the card comes at 2.2 s (alone: no menu card); Start again sails at full time with a
// fresh log; Cruise never; Regatta's time back to full once its results card is up; the log counts only while she sails.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createKnockdownGame, WARN, END } from '../sim/knockdownGame.js';

const run = (G, secs, dt = 1 / 60) => { const seen = []; for (let i = 0; i < Math.round(secs / dt); i++) { const o = G.frame(dt); seen.push({ t: (i + 1) * dt, ...o }); } return seen; };

test('the warning: the line once, the amber for 4 s, not again within 8 s; never in Cruise', () => {
  const G = createKnockdownGame();
  assert.equal(G.warn({}, 'sail'), WARN.line); assert.equal(G.warnOn, true);
  run(G, 3); assert.equal(G.warnOn, true); run(G, 1.1); assert.equal(G.warnOn, false);
  assert.equal(G.warn({}, 'sail'), null, 'said 4 s ago'); assert.equal(G.warnOn, true, 'the amber again');
  run(G, 9); assert.equal(G.warn({}, 'sail'), WARN.line);
  const C = createKnockdownGame(); assert.equal(C.warn({}, 'cruise'), null); assert.equal(C.warnOn, false);
});

test('the knockdown: the frame slows, the card at 2.2 s and nothing more; Start again at full time with a fresh log', () => {
  const G = createKnockdownGame();
  G.sail(120, 3); G.sail(60, 4.5);
  assert.deepEqual({ ...G.log }, { seconds: 180, metres: 630, topMs: 4.5 });
  assert.equal(G.knock({ gustKn: 31 }, 'sail'), true); assert.equal(G.knock({}, 'sail'), false, 'once');
  G.sail(10, 9); assert.equal(G.log.seconds, 180, 'nothing counted once over');
  const seen = run(G, 5);
  const at = (t) => seen.find((x) => x.t >= t - 1e-9);
  assert.equal(at(END.slowAtS - 0.05).timeScale, 1);
  assert.ok(at(END.slowAtS + END.slowS + 0.05).timeScale - END.slow < 1e-9);
  const card = seen.filter((x) => x.card);
  assert.equal(card.length, 1); assert.ok(Math.abs(card[0].t - END.cardAtS) < 0.02);
  assert.ok(seen.every((x) => !('menu' in x)), 'no menu card of its own');
  assert.equal(G.state, 'ended');
  assert.ok(Math.abs(seen.at(-1).timeScale - END.still) < 1e-9, `under the card a near stop (${seen.at(-1).timeScale})`);
  G.again(); assert.equal(G.state, 'sailing'); assert.equal(G.frame(1 / 60).timeScale, 1); assert.equal(G.log.seconds, 0);
});

test('Cruise never; Regatta back to full time once its results card is up', () => {
  const C = createKnockdownGame(); assert.equal(C.knock({}, 'cruise'), false); assert.equal(C.state, 'sailing');
  const R = createKnockdownGame(); R.knock({}, 'regatta');
  const seen = run(R, 4);
  assert.ok(seen.some((x) => x.timeScale < 0.5)); assert.equal(seen.at(-1).timeScale, 1);
});
