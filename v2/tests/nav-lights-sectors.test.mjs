// The sloop's navigation lights by bearing (v2/sim/night.js navLights; COLREGs rule 21, 23, 25): swept all round the boat at
// night, the green shows from dead ahead to 112.5° on the starboard side, the red the same to port, the white sternlight over
// the 135° astern; each cut within a couple of degrees, no gap and no overlap past the fade. The masthead (steaming) light over
// the forward 225° only while the engine drives her (in gear, turning); at anchor the all-round white alone. None by day, all
// of them on after sunset.
import test from 'node:test';
import assert from 'node:assert/strict';
import { navLights, GLOW_FLOATS, NAV_GLOW, STEAMING_AT } from '../sim/night.js';
import { DEFAULT_DIMS } from '../../src/sim/boat/dims.js';

const dims = DEFAULT_DIMS.HULL, MAST = [0, 12, -0.74];
const pose = { x: 0, z: 0, heading: 0, heave: 0, pitch: 0, heel: 0 };   // the bow toward −z
const out = new Float32Array(5 * GLOW_FLOATS);
// the lights seen from bearing b (deg from the bow, + starboard) 300 m off at eye height (the lenses' own offsets under 1°): { green, red, stern, mast, steaming }
function seen(b, o = {}) {
  const r = b * Math.PI / 180, eye = [Math.sin(r) * 300, 2, -Math.cos(r) * 300];
  navLights(out, { pose: { ...pose, ...o.pose }, sunElevDeg: o.sun ?? -10, eye, dims, mastHead: MAST, anchored: !!o.anchored, mode: o.mode ?? 'sailing' });
  return { green: out[7], red: out[GLOW_FLOATS + 7], stern: out[2 * GLOW_FLOATS + 7], mast: out[3 * GLOW_FLOATS + 7], steaming: out[4 * GLOW_FLOATS + 7] };
}
const ON = NAV_GLOW.radiance * 0.5;

test('sailing at night: green 0 to 112.5° starboard, red 0 to 112.5° port, white over the 135° astern', () => {
  for (let b = -178; b <= 178; b += 2) {
    const s = seen(b), a = Math.abs(b);
    const want = { green: b > 3 && b < 109.5, red: b < -3 && b > -109.5, stern: a > 115.5 };
    const off = { green: b < -3 || b > 115.5, red: b > 3 || b < -115.5, stern: a < 109.5 };
    for (const k of ['green', 'red', 'stern']) {
      if (want[k]) assert.ok(s[k] > ON, `${k} lit at ${b}° (${s[k]})`);
      if (off[k]) assert.equal(s[k], 0, `${k} dark at ${b}°`);
    }
    assert.equal(s.mast, 0, 'no anchor light under way'); assert.equal(s.steaming, 0, 'no steaming light under sail');
    // every bearing shows a light: no dark gap at the cuts but the lenses' own parallax (the bow and stern lights 8.5 m apart)
    if (Math.abs(a - 112.5) > 1.5) assert.ok(s.green + s.red + s.stern > ON * 0.9, `a light seen at ${b}°`);
  }
});

test('motoring: the masthead light over the forward 225° (to 22.5° abaft each beam), with the sidelights and the sternlight', () => {
  for (const [b, lit] of [[0, true], [90, true], [-109, true], [116, false], [180, false], [-150, false]]) {
    const s = seen(b, { mode: 'motoring' });
    if (lit) assert.ok(s.steaming > ON, `steaming lit at ${b}°`); else assert.equal(s.steaming, 0, `steaming dark at ${b}°`);
  }
  assert.ok(seen(30, { mode: 'motoring' }).green > ON && seen(180, { mode: 'motoring' }).stern > ON, 'the sidelights and the sternlight too');
  // the light stands on the mast's front, well above the sidelights and below the truck
  navLights(out, { pose, sunElevDeg: -10, eye: [0, 2, -60], dims, mastHead: MAST, mode: 'motoring' });
  const y = out[4 * GLOW_FLOATS + 1];
  assert.ok(y > dims.navBow[1] + 3 && y < MAST[1] - 1, `the steaming light ${y.toFixed(2)} m up`);
  assert.ok(STEAMING_AT[1] > 3, 'its rig height');
});

test('at anchor: the all-round white alone; by day nothing', () => {
  for (const b of [0, 60, 120, 180, -90]) {
    const s = seen(b, { anchored: true });
    assert.ok(s.mast > ON && s.green === 0 && s.red === 0 && s.stern === 0 && s.steaming === 0, `anchored at ${b}°`);
  }
  for (const b of [0, 90, 180, -90]) for (const m of ['sailing', 'motoring']) {
    const s = seen(b, { sun: 12, mode: m });
    assert.deepEqual([s.green, s.red, s.stern, s.mast, s.steaming], [0, 0, 0, 0, 0], `by day (${m}, ${b}°)`);
  }
  // dusk: off with the sun 2° up, on once it has set
  assert.equal(seen(30, { sun: 2 }).green, 0);
  assert.ok(seen(30, { sun: -3 }).green > ON);
});
