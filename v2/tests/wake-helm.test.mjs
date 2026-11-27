// The helm's term on the wake (v2/sim/wake.js WAKE.helmM): with the helm over, the transom's point now (the strip's first metre)
// moves across the track toward the side the rudder's trailing edge points (+ rudder turns her to starboard: the wash to port), by
// helmM × sin(rudder) at speed; nothing with the helm amidships or at rest; the older points (the track behind) never move.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWakeTrack, WAKE, POINT_FLOATS } from '../sim/wake.js';

function packed(rudder, u = 3, heading = 0) {
  const W = createWakeTrack();
  for (let i = 0; i < 120; i++) W.update(null, { x: 0, z: -i * u / 60, u, heading, rudderAngle: i === 119 ? rudder : 0 }, 1 / 60);
  const out = new Float32Array((W.trailN + 1) * POINT_FLOATS), n = W.pack(out);
  return { out, n, W };
}
test('the rudder bends the strip\'s first metre toward its trailing edge; amidships and at rest, nothing', () => {
  const R = 25 * Math.PI / 180;
  const a = packed(0), p = packed(R), s = packed(-R);
  // heading 0: the bow to −z, starboard +x; + rudder: the transom's point to port (−x)
  assert.ok(Math.abs(a.out[0]) < 1e-6, 'amidships: on the track');
  const dx = p.out[0] - a.out[0];
  assert.ok(dx < -0.3 && dx > -WAKE.helmM, `+25° of helm: ${dx.toFixed(3)} m to port`);
  assert.ok(Math.abs((s.out[0] - a.out[0]) + dx) < 1e-6, 'the other way mirrored');
  for (let k = 1; k < a.n; k++) assert.equal(p.out[k * POINT_FLOATS], a.out[k * POINT_FLOATS], 'the older points stay on the track');
  const rest = packed(R, 0), rest0 = packed(0, 0);
  assert.equal(rest.out[0], rest0.out[0], 'at rest the helm moves nothing');
  // turned east (heading 90°): starboard is +z, so the wash to port is −z
  const e0 = packed(0, 3, Math.PI / 2), e1 = packed(R, 3, Math.PI / 2);
  assert.ok(e1.out[1] - e0.out[1] < -0.3, 'heading east: to port is north');
});
