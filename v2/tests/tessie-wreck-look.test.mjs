// Tessie's strike fitted to the boat and the look at her wreck (presentation only; the hit rules are tessie-hits.test.mjs's). Behaviour only:
//   the fit: her jaw meets each boat at its own freeboard (kayak 0.3 m < sailboat 0.75 m < glass boat 1.0 m), the paddle-wheeler on its side at
//     the waterline, a heeled boat's lee rail lower and its weather rail higher; a kayak gets a nudge (the jaw barely open), never a bite
//   the camera's pull-back grows with the boat's length (a kayak less, the paddle-wheeler most)
//   the wreck look: after a wreck, with no input, she turns to face it and stays up beside it; the eye eases round (at most 40°/s) and keeps the
//     wreck inside its view for the whole hold; a look drag ends it at once (the drag turns the eye as asked, that same frame); a key pressed
//     after the hit ends it, keys held through the hit do not; it ends by itself after FOCUS.holdS
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTessie } from '../sim/tessie.js';
import { createTessiePlay, contactPoint } from '../sim/tessiePlay.js';
import { fitOf, railAt, frameK } from '../sim/tessieFit.js';
import { createWreckFocus, FOCUS } from '../sim/tessieFocus.js';
import { createTessieCam, TCAM } from '../ui/tessieCam.js';

const DT = 1 / 60, DEG = Math.PI / 180;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

test('the fit: her jaw at each boat\'s own freeboard; the paddle-wheeler\'s side at the waterline; the heel lowers the lee rail', () => {
  const at = (kind, L, B, extra = {}) => contactPoint({ id: kind, kind, x: 0, z: 0, heading: 0, L, B, ...extra }, 5, 0, 'rail');   // her head off its starboard beam
  const kayak = at('kayak', 3.4, 0.85), sail = at('sail', 8.5, 3), glass = at('glass', 12.2, 3.8), paddle = at('paddle', 42, 10), jet = at('jetski', 3.2, 1.2);
  assert.ok(kayak[1] < jet[1] && jet[1] < sail[1] && sail[1] < glass[1], `the jaw's height by freeboard (kayak ${kayak[1]}, jet ski ${jet[1]}, sailboat ${sail[1]}, glass boat ${glass[1]})`);
  assert.equal(paddle[3], 'side'); assert.ok(paddle[1] <= 0.5, `the paddle-wheeler: a slam on its side at ${paddle[1]} m, not a bite on its 1.6 m rail`);
  // heeled 20° to starboard (+): her on the starboard (lee) side meets a lower rail; on the port (weather) side a higher one
  const lee = at('sail', 8.5, 3, { heel: 20 * DEG }), weather = contactPoint({ kind: 'sail', x: 0, z: 0, heading: 0, L: 8.5, B: 3, heel: 20 * DEG }, -5, 0, 'rail');
  assert.ok(lee[1] < sail[1] - 0.3 && weather[1] > sail[1] + 0.3, `the lee rail ${lee[1].toFixed(2)} m, upright ${sail[1]} m, the weather rail ${weather[1].toFixed(2)} m`);
  assert.ok(railAt({ kind: 'sail', B: 3, heel: 80 * DEG }, 1) >= 0.1, 'never under the water');
  // a kayak: a nudge (the jaw barely open, her neck low), the sailboat a full bite
  assert.ok(fitOf('kayak').gapeK <= 0.35 && fitOf('kayak').neckK < 0.6 && fitOf('sail').gapeK === 1 && fitOf('halcyon') === fitOf('sail'));
  // the camera's pull-back by size
  assert.ok(frameK({ kind: 'kayak', L: 3.4 }) < frameK({ kind: 'sail', L: 8.5 }) && frameK({ kind: 'sail', L: 8.5 }) < frameK({ kind: 'paddle', L: 42 }));
});

test('a kayak\'s nudge opens her jaw less than a sailboat\'s bite (her drawn gape)', () => {
  const gapeMax = (gapeK) => {
    const sim = createTessie({ seed: 3, depthAt: () => 40 }), C = createTessiePlay({ sim, depthAt: () => 40 });
    C.begin({ x: 0, z: 0, heading: 0 });
    for (let i = 0; i < 60; i++) { sim.step(DT, { playing: true }); C.step(DT, {}, {}); }
    sim.bite('rail', { aim: [0, 0.3, -6], side: 1, gapeK });
    let g = 0; for (let i = 0; i < 90; i++) { sim.step(DT, { playing: true }); g = Math.max(g, sim.state.gape ?? 0); }
    return g;
  };
  const nudge = gapeMax(fitOf('kayak').gapeK), bite = gapeMax(fitOf('sail').gapeK);
  assert.ok(bite > 0.1 && nudge < bite * 0.4, `gape: kayak ${(nudge / DEG).toFixed(1)}°, sailboat ${(bite / DEG).toFixed(1)}°`);
});

test('the focus: keys held through the hit keep it; a key pressed after it, a stick pushed or a press end it at once; it ends after FOCUS.holdS', () => {
  const F = createWreckFocus(), boat = { id: 'b', kind: 'sail', x: 10, z: 0, heading: 0 };
  F.start(boat, 0, ['KeyW']);
  assert.ok(F.on && F.face && F.view);
  F.input({ keys: ['KeyW'] }, 0.5); assert.ok(F.on, 'W held through the hit: still on');
  F.input({ keys: [] }, 0.6); assert.ok(F.on, 'W let go: still on');
  F.input({ keys: ['KeyW'] }, 0.7); assert.ok(!F.on, 'W pressed again: ended'); assert.equal(F.stats().why, 'keys');
  F.start(boat, 1, []); F.input({ keys: ['KeyA'] }, 1.1); assert.equal(F.stats().why, 'keys', 'a new key');
  F.start(boat, 2, []); F.input({ stick: true }, 2.1); assert.equal(F.stats().why, 'stick');
  F.start(boat, 3, []); F.input({ press: true }, 3.1); assert.equal(F.stats().why, 'press');
  F.start(boat, 4, []); F.input({ keys: ['KeyD'], pinned: true }, 4.1); assert.ok(F.on, 'a pinned pose never ends it');
  F.track({ x: 12, z: 1, heading: 0.3 }, 4 + FOCUS.holdS - 0.01); assert.ok(F.on && F.face.x === 12 && F.face.heading === 0.3, 'tracked where it lies');
  F.track(null, 4 + FOCUS.holdS); assert.ok(!F.on); assert.equal(F.stats().why, 'time');
});

// her real sim and controller at a drift, a wreck 15 m off her starboard beam, the page's focus and the camera fed as living/tessiePlayer.js does
function wreckFilm({ secs = 6, dragAt = null, wreck = null } = {}) {
  const sim = createTessie({ seed: 5, depthAt: () => 40 }), C = createTessiePlay({ sim, depthAt: () => 40 }), cam = createTessieCam(), F = createWreckFocus();
  C.begin({ x: 0, z: 0, heading: 0 });
  for (let i = 0; i < 4 / DT; i++) { sim.step(DT, { playing: true }); C.step(DT, {}, {}); const n = sim.state.nose; cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, speed: C.state.speed }); }
  const n0 = sim.state.nose, w = wreck ?? { id: 'w', kind: 'sail', x: n0.x + Math.cos(n0.psi) * 15 - Math.sin(n0.psi) * 2, z: n0.z + Math.sin(n0.psi) * 15 + Math.cos(n0.psi) * 2, heading: n0.psi + 0.4, L: 8.5, B: 3 };
  F.start(w, 0, []);
  const rows = [];
  for (let i = 0; i < secs / DT; i++) {
    const t = i * DT, drag = dragAt != null && t >= dragAt && t < dragAt + 0.25 ? [0.05, 0] : null;
    if (drag) F.cancel('look');
    F.track(w, t);
    sim.step(DT, { playing: true }); C.step(DT, {}, { face: F.face });
    const n = sim.state.nose, yaw0 = cam.state.yaw;
    const c = cam.step(DT, { spine: sim.state.spine, L: sim.L, psi: n.psi, nose: C.state.nose, speed: C.state.speed, orbit: drag, focus: F.view, pull: F.on ? 1 : 0 });
    const fx = c.target[0] - c.pos[0], fz = c.target[2] - c.pos[2], off = wrap(Math.atan2(w.x - c.pos[0], -(w.z - c.pos[2])) - Math.atan2(fx, -fz));
    rows.push({ t, off, yaw: cam.state.yaw, dyaw: wrap(cam.state.yaw - yaw0), focusK: cam.state.focusK, on: F.on, nose: C.state.nose, head: wrap(Math.atan2(w.x - n.x, -(w.z - n.z)) - n.psi), drag: !!drag });
  }
  return rows;
}

test('after a wreck: the eye eases round (at most 40°/s) and keeps the wreck in view through the hold; she turns to face it and stays up', () => {
  const rows = wreckFilm();
  const hHalf = Math.atan(Math.tan(TCAM.fov / 2 * DEG) * 16 / 9);   // the view's half-width at 16:9
  const first = rows.find((r) => Math.abs(r.off) < hHalf * 0.8);
  assert.ok(first && first.t < 1.6, `the wreck inside the view by ${first?.t.toFixed(2)} s (a 15 m-off beam wreck at ${(rows[0].off / DEG).toFixed(0)}° at the hit)`);
  for (const r of rows.filter((q) => q.t >= first.t && q.t < FOCUS.holdS)) assert.ok(Math.abs(r.off) < hHalf * 0.9, `the wreck ${(r.off / DEG).toFixed(1)}° off the view's middle at ${r.t.toFixed(2)} s`);
  const worst = Math.max(...rows.map((r) => Math.abs(r.dyaw) / DT));
  assert.ok(worst <= TCAM.focus.yawMax * DEG * 1.001, `the eye's turn at most ${TCAM.focus.yawMax}°/s (${(worst / DEG).toFixed(1)}°/s)`);
  const end = rows.find((r) => r.t >= FOCUS.holdS - 0.05);
  assert.ok(Math.abs(end.head) < 25 * DEG, `she faces it at the end of the hold (${(end.head / DEG).toFixed(1)}° off her nose)`);
  assert.ok(rows.every((r) => r.nose < 1.3), 'she stays up at the surface beside it');
  assert.ok(!rows.at(-1).on && rows.at(-1).focusK < 1, 'the hold ends by itself');
});

test('a look drag ends the wreck look at once: the eye turns as the drag asks that same frame, the focus weight gone', () => {
  const rows = wreckFilm({ dragAt: 1.0 });
  const d = rows.find((r) => r.drag);
  assert.ok(!d.on && d.focusK === 0, `the drag's frame: focus off (${d.on}), weight ${d.focusK}`);
  assert.ok(Math.abs(d.dyaw - -0.05) < 1e-9, `the eye turned by the drag itself (${d.dyaw.toFixed(4)} rad for −0.05)`);
  const after = rows.filter((r) => r.t > 1.3 && r.t < 2.5);
  assert.ok(after.every((r) => !r.on), 'it does not come back');
});
