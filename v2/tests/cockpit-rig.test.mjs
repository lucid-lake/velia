// M4: the cockpit's rig (v2/render/cockpit/rig.js) on the baked asset: v1's camera solves land the hub and the cap's lip on
// their screen shares, the hit layer's anchors project where v1's cockpitView says, and set() moves the parts v1's moves.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCockpit } from '../render/cockpit/asset.js';
import { createCockpitRig } from '../render/cockpit/rig.js';
import { COCKPIT, cockpitView } from '../../src/stations/sloop/cockpitView.js';
import { COCKPIT as V1_COCKPIT, cockpitView as v1View } from '../../classic/src/stations/sloop/cockpit3d.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = async (k) => { const a = await parseCockpit(gunzipSync(readFileSync(resolve(ROOT, `v2/assets/cockpit/${k}.ckb.gz`)))); return { a, rig: createCockpitRig(a.json, { coverFrames: a.coverFrames }) }; };

test('the seam: cockpitView.js is cockpit3d.js\'s own (the same objects, re-exported)', () => {
  assert.equal(V1_COCKPIT, COCKPIT);
  assert.equal(v1View, cockpitView);
});

test('desktop 1280×720: the hub lands at 99.6 % of the height, the wheel top over it, the rect from over the winches', async () => {
  const { rig } = await load('desktop');
  const { view, rect } = rig.layout({ w: 1280, h: 720 });
  const hub = rig.project('hub');
  assert.ok(Math.abs(hub.x - 640) < 0.5, `hub x ${hub.x}`);
  assert.ok(Math.abs(hub.y - COCKPIT.hub.at * 720) < 1.5, `hub y ${hub.y}`);
  assert.ok(Math.abs(rig.project('wheelTop').y - view.wheelTop) < 3, 'wheel top');
  assert.equal(rect.w, 1280); assert.ok(rect.y > 450 && rect.y < 600, `rect y ${rect.y}`);
  // the instruments sit in the coaming's ends: chart to port, wind to starboard, inside the frame
  const c = rig.project('i:chart'), w = rig.project('i:wind');
  assert.ok(c.x > 0 && c.x < 400 && w.x > 880 && w.x < 1280, `${c.x} ${w.x}`);
});

test('set(): the toggles\' bats, the lever, the fold, the PRO cover and the sliders move as cockpit3d.js moves them', async () => {
  const { rig, a } = await load('desktop');
  rig.layout({ w: 1280, h: 720 });
  const R = a.json.roles;
  assert.equal(rig.set({ toggles: { sails: true }, pro: { open: false }, sink: 0 }, 0), true);
  assert.ok(Math.abs(rig.nodes[R.toggles.sails.pivot].r[0] - 0.95) < 1e-9, 'a lit toggle stands up');
  assert.equal(rig.matOf[a.json.meshes.findIndex((m) => m.node === R.toggles.sails.led)], R.amberOn);
  rig.set({ lever: 1, sink: 0 }, 0);
  assert.ok(Math.abs(rig.nodes[R.stem].r[0] - (-0.68)) < 1e-9);
  const hub0 = rig.project('hub').y;
  rig.set({ sink: 1 }, 0);
  assert.ok(rig.project('hub').y > hub0 + 200, 'folded: the hub sinks out of view');
  assert.ok(Math.abs(rig.projectRest('hub').y - hub0) < 0.5, 'the rest place stays');
  // PRO opens over 0.4 s: the cars show, then stand on their values
  for (let i = 0; i < 30; i++) rig.set({ sink: 0, pro: { open: true, f: { traveller: 1 } } }, 1 / 60);
  assert.equal(rig.proK, 1);
  rig.compose();
  assert.equal(rig.visible[R.pro.sliders.traveller.car], 1);
  const sl = R.pro.sliders.traveller;
  assert.ok(Math.abs(rig.nodes[sl.car].p[0] - (a.json.nodes[sl.car].p[0] + 0.5 * sl.travel)) < 1e-9);
});

test('phone 844×390: the phone lens puts the hub at 98.5 %', async () => {
  const { rig } = await load('phone');
  rig.layout({ w: 844, h: 390, phone: true });
  assert.ok(Math.abs(rig.project('hub').y - 0.985 * 390) < 1.5);
});
