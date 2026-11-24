// Play as Tessie, phase 2b (§ 3.8): the light under the water's CPU rules. Behaviour only: the modules are called and
// their output read.
//   the shafts' strength: strongest by day, fading at dusk, none at night, less in chop, almost none in a storm, eased in under the surface
//   the bubbles: they rise (a bigger one faster), go at the surface or at their life's end, never grow the pool past its size; the same
//     steps give the same bubbles (deterministic); her run, a sharp turn, a fast dive and the breach make them, a drift none; the
//     propellers only near the eye
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaftStrength, createBubblePool, createBubbleEmitter, BUBBLES, SHAFT } from '../render/underLight.js';

test('the shafts: by day, fading at dusk, none at night; less in chop; almost none in a storm; eased in under the surface', () => {
  const noon = shaftStrength({ sunY: 0.9, wind: 3, eyeDepth: 8 });
  const dusk = shaftStrength({ sunY: 0.12, wind: 3, eyeDepth: 8 });
  assert.ok(Math.abs(noon - SHAFT.gain) < 1e-6, `noon at full (${noon})`);
  assert.ok(dusk > 0 && dusk < 0.5 * noon, `dusk fainter (${dusk.toFixed(3)})`);
  assert.equal(shaftStrength({ sunY: -0.1, eyeDepth: 8 }), 0, 'none at night');
  assert.ok(shaftStrength({ sunY: 0.9, wind: 14, eyeDepth: 8 }) < 0.5 * noon, 'chop breaks them');
  assert.ok(shaftStrength({ sunY: 0.9, wind: 3, storm: 1, eyeDepth: 8 }) <= 0.1 * noon + 1e-9, 'a storm: almost none');
  assert.equal(shaftStrength({ sunY: 0.9, eyeDepth: -1 }), 0, 'the eye over the water: none');
  assert.ok(shaftStrength({ sunY: 0.9, eyeDepth: 0.4 }) < noon && shaftStrength({ sunY: 0.9, eyeDepth: 0.4 }) > 0, 'eased in over the first 0.8 m');
});

const spine = (N = 64, y = -6) => { const s = new Float32Array(N * 8); for (let i = 0; i < N; i++) { s[i * 8] = 0; s[i * 8 + 1] = y; s[i * 8 + 2] = i * 0.3; } return s; };

test('the bubbles rise, a bigger one faster, and go at the surface; the pool never grows past its size', () => {
  const P = createBubblePool({ max: 50 });
  P.emit(2, (i) => [0, -5, 0, i ? 0.05 : 0.005]);
  P.step(1, () => 0);
  const y0 = P.data[1], y1 = P.data[9];
  assert.ok(y0 > -5 && y1 > y0, `both rise, the big one faster (${y0.toFixed(3)}, ${y1.toFixed(3)})`);
  for (let k = 0; k < 40; k++) P.step(1, () => 0);
  assert.equal(P.count, 0, 'all gone by the surface or their life');
  P.emit(200, () => [0, -10, 0, 0.01]);
  assert.equal(P.count, 50, 'a full pool replaces, never grows');
});

test('the bubbles are deterministic: the same steps give the same bubbles', () => {
  const run = () => {
    const P = createBubblePool({ seed: 3 }), E = createBubbleEmitter(P), sp = spine();
    for (let i = 0; i < 120; i++) { E.step({ dt: 1 / 60, spine: sp, N: 64, speed: 17, sprint: true, nose: 6, climb: 0 }); P.step(1 / 60, () => 0); }
    return Array.from(P.data.slice(0, P.count * 8));
  };
  assert.deepEqual(run(), run());
});

test('her bubbles: a run, a sharp turn, a fast dive and the breach make them; a drift none; the propellers only near the eye', () => {
  const count = (src, secs = 1) => { const P = createBubblePool(), E = createBubbleEmitter(P); for (let i = 0; i < secs * 60; i++) E.step({ dt: 1 / 60, spine: spine(), N: 64, nose: 6, ...src }); return P.emitted; };
  assert.equal(count({ speed: 0.5 }), 0, 'a drift: none');
  const run = count({ speed: 17, sprint: true });
  assert.ok(run > 0.8 * BUBBLES.run && run < 1.2 * BUBBLES.run, `a run: about ${BUBBLES.run} a second (${run})`);
  assert.ok(count({ speed: 8, yawRate: 0.8 }) > 0.8 * BUBBLES.turn, 'a sharp turn');
  assert.ok(count({ speed: 8, climb: 4 }) > 0.8 * BUBBLES.dive, 'a fast dive');
  assert.equal(count({ speed: 8, sprint: true, nose: 0.5 }), 0, 'a run at the surface: none under the water');
  assert.equal(count({ speed: 8, breachStart: true }, 1 / 60), BUBBLES.breach, 'the breach: one burst');
  const P = createBubblePool(), E = createBubbleEmitter(P);
  for (let i = 0; i < 60; i++) E.step({ dt: 1 / 60, eye: [0, -3, 0], props: [{ x: 10, z: 0, heading: 0 }, { x: 500, z: 0, heading: 0 }] });
  assert.ok(P.emitted > 0.8 * BUBBLES.prop && P.emitted < 1.3 * BUBBLES.prop, `one near propeller (${P.emitted})`);
  // her bubbles leave her skin, never inside her
  const Q = createBubblePool(), F = createBubbleEmitter(Q);
  F.step({ dt: 1, spine: spine(64, -10), N: 64, girth: () => 1.5, speed: 17, sprint: true, nose: 10 });
  for (let j = 0; j < Q.count; j++) {
    let d = Infinity; for (let i = 0; i < 64; i++) d = Math.min(d, Math.hypot(Q.data[j * 8], Q.data[j * 8 + 1] + 10, Q.data[j * 8 + 2] - i * 0.3));
    assert.ok(d > 0.9, `bubble ${j} off her skin (${d.toFixed(2)} m from her spine)`);
  }
});
