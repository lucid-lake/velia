// The 3D cockpit's pure parts (src/stations/sloop/cockpit3d.js cockpitView; owner 2026-11-06, stage 1): the camera solve puts the wheel's hub
// and the cap's lip on their screen shares at every desktop size, about half the wheel's rim stands above the screen's edge, the
// subtitle's foot keeps its gap over the wheel's top, and the control panel's cockpit form names the 3D switches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cockpitView, COCKPIT } from '../classic/src/stations/sloop/cockpit3d.js';
import { panelCells, COCKPIT_CELLS } from '../src/stations/sloop/controlPanel.js';

const SIZES = [[1920, 1080], [1280, 720], [1512, 982], [1440, 900], [2560, 1080], [1024, 768]];

test('the camera solve lands the hub and the cap on their shares of the height', () => {
  for (const [w, h] of SIZES) {
    const v = cockpitView({ w, h });
    assert.ok(Math.abs(v.hubY - COCKPIT.hub.at * h) < 0.5, `${w}x${h}: hub at ${v.hubY.toFixed(1)}`);
    assert.ok(Math.abs(v.capY - COCKPIT.cap.at * h) < 0.5, `${w}x${h}: cap at ${v.capY.toFixed(1)}`);
    assert.ok(v.th > 0 && v.th < 0.2, `${w}x${h}: a gentle look down (${(v.th * 57.3).toFixed(2)}°)`);
  }
});

test('about half the wheel stands above the screen edge, and it is bigger than round 2 (213 px at 1080)', () => {
  const v = cockpitView({ w: 1920, h: 1080 });
  const above = (1080 - v.wheelTop) / v.wheelPx;
  assert.ok(above > 0.45 && above < 0.55, `share of the rim above the edge: ${above.toFixed(2)}`);
  assert.ok(v.wheelPx > 260, `wheel ${v.wheelPx.toFixed(0)} px across`);
});

test('an ultrawide keeps the 16:9 scale and widens the coaming so its ends still leave the frame', () => {
  const a = cockpitView({ w: 1920, h: 1080 }), b = cockpitView({ w: 2560, h: 1080 });
  assert.ok(Math.abs(a.f - b.f) < 1e-6, 'same focal length');
  assert.ok(b.hw > a.hw * 1.3, `half-width ${a.hw} → ${b.hw}`);
});

test('the control panel in the cockpit form: the three toggles, the engine key and MOOR (near a mooring), no PANEL row', () => {
  const c = panelCells('cockpit');
  assert.deepEqual(c.main, COCKPIT_CELLS);
  assert.equal(c.more, null);
  assert.deepEqual([...c.main].sort(), ['anchor', 'engine', 'lines', 'reef', 'sails']);
  assert.ok(!panelCells('grid').main.includes('engine') && !panelCells('keys').main.includes('engine'), 'the engine cell only in the cockpit');
});

test('the dials in the coaming (feat/cockpit-dials): the PRO recess to port, the engine beside the lever, the switches beyond it; every recess clear of the instruments, under the band; MAIN centred under its winch; MOOR on the cap', () => {
  const H = Object.entries(COCKPIT.holes).map(([k, [a, b]]) => [k, a, b]).sort((p, q) => p[1] - q[1]);
  assert.deepEqual(H.map((h) => h[0]), ['pro', 'engine', 'switches']);
  for (let i = 1; i < H.length; i++) assert.ok(H[i][1] > H[i - 1][2], `${H[i - 1][0]} | ${H[i][0]}`);
  const I = COCKPIT.inst, ramp = COCKPIT.x.inst - (I.R + I.pad + I.ramp) * Math.SQRT1_2;   // the step-up's foot along the 45° facet
  for (const [k, a, b] of H) { assert.ok(Math.max(Math.abs(a), Math.abs(b)) < ramp, `${k} clear of the instruments' step-up (${ramp.toFixed(2)} m)`); assert.ok(!COCKPIT.holes[k][2], `${k}: under the band`); }
  const [p0, p1] = COCKPIT.holes.pro;
  // look C3: the recess holds five targets, not eight, and gives 0.10 m of its outboard end to BINOS (1.41 → 1.31 m)
  assert.ok(p1 - p0 > 1.22, `the PRO recess wider than stage 2's 1.22 m (${(p1 - p0).toFixed(2)} m)`);
  assert.ok(COCKPIT.pro.px > 11, 'its words bigger than stage 2\'s 11 px');
  assert.ok(COCKPIT.holes.engine[0] > COCKPIT.lever.x + 0.2, 'the engine panel clear of the lever');
  // look C3: BINOS and VHF on the face between each recess and its instrument's step-up, mirrored
  assert.ok(COCKPIT.x.binos === -COCKPIT.x.vhf && COCKPIT.x.vhf > COCKPIT.holes.switches[1] + 0.06 && -COCKPIT.x.binos > -COCKPIT.holes.pro[0] + 0.06, 'BINOS and VHF beyond their recesses, mirrored');
  assert.ok(COCKPIT.toolY > COCKPIT.RY0 + 0.08 && COCKPIT.toolY < COCKPIT.CH - 0.05, 'the tool buttons inside the face');
  const T = COCKPIT.toggles.map((t) => t[2]), [w0, w1] = COCKPIT.holes.switches;
  assert.ok(Math.min(...T.slice(1).map((x, i) => x - T[i])) >= 0.32 && T[0] - w0 >= 0.15 && w1 - T.at(-1) >= 0.15, 'the switches 0.32 m or more apart (their 15 px words with clear space)');
  for (const [, , x] of COCKPIT.toggles) assert.ok(x > COCKPIT.holes.switches[0] && x < COCKPIT.holes.switches[1], 'the toggles in their recess');
  assert.ok(Math.abs(COCKPIT.x.moor) > Math.abs(COCKPIT.x.main) + 0.45 && Math.abs(COCKPIT.x.moor) < ramp, 'MOOR on the cap, beyond the MAIN winch, short of the step-up');
  assert.ok(I.y - (I.R + 0.026) * Math.cos(I.lean) > I.y0 && I.y + (I.R + 0.026) * Math.cos(I.lean) < COCKPIT.CH + I.rise - 0.03, 'each instrument inside its leaning face, under the lip\'s shadow');
  assert.ok(COCKPIT.fold.sink >= 2 && COCKPIT.fold.tilt > 0, 'the fold tips and sinks');
});
