// BACKLOG-v2 #2: a phone's controls as v1's. The one-finger tiller and rope (v2/ui/touch.js) on v1's numbers (src/sail/pads.js);
// the station's form per device kind; an upright phone's slot cameras (v2/render/cockpit/rig.js slotCam, v2/ui/station.js
// SLOT_CAMS) against the screen points v1's own page gave on a 390 × 844 phone (window.__lakeshore.station.screen, 2026-11-14:
// renders/v2-phone-controls/tmp/measure-v1.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUCH, tillerFromDrag, ropeDrag } from '../ui/touch.js';
import { TOUCH as V1, TouchSheet } from '../../src/sail/pads.js';
import { stationForm, SLOT_CAMS, WINCHES } from '../ui/station.js';
import { parseCockpit } from '../render/cockpit/asset.js';
import { createCockpitRig } from '../render/cockpit/rig.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('the tiller and the rope are v1\'s: half helm at 0.06 of the width, the rope at v1\'s rate', () => {
  assert.deepEqual({ helmFrac: TOUCH.helmFrac, ropeFrac: TOUCH.ropeFrac, edgePx: TOUCH.edgePx }, { helmFrac: V1.helmFrac, ropeFrac: V1.ropeFrac, edgePx: V1.edgePx });
  assert.equal(tillerFromDrag(0.06 * 402, 402), 0.5);
  assert.equal(tillerFromDrag(-0.5 * 402, 402), -1, 'clamped at the stop');
  // v1 pads.js: each move adds dy × 200 / (ropeFrac × the height); a 0.1-height drag hauls in at the full rate for 0.4 s
  const r = new TouchSheet(); r.drag(ropeDrag(0.1 * 874, 874));
  let haul = 0; for (let i = 0; i < 60; i++) haul += r.update(1 / 60) / 60;
  assert.ok(Math.abs(haul - 0.4) < 0.01, `hauled ${haul.toFixed(3)} s at the full rate`);
});

test('the station\'s form: the cockpit on a desktop and a narrow window (a touch phone has no station: ui/flat.js), the one-thumb controls on an upright phone (the grid with ?thumb=0), none on a tablet', () => {
  assert.equal(stationForm('desktop'), 'cockpit');
  assert.equal(stationForm('phone-land'), 'cockpit');
  assert.equal(stationForm('phone-port'), 'thumb');
  assert.equal(stationForm('phone-port', { thumb: false }), 'grid', '?thumb=0');
  assert.equal(stationForm('desktop', { thumb: false }), 'cockpit');
  assert.equal(stationForm('tablet'), 'none');
  assert.equal(stationForm('phone-port', { rig: false }), 'none');
  assert.equal(stationForm('desktop', { cockpit: false }), 'none', '?panel=dom');
});

test('an upright phone\'s slots: v1\'s cameras put the wheel\'s hub and each drum\'s top where v1\'s page did (390 × 844)', async () => {
  const a = await parseCockpit(gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/cockpit/phone.ckb.gz'))));
  const rig = createCockpitRig(a.json, { coverFrames: a.coverFrames });
  rig.layout({ w: 390, h: 844 });
  const rects = { wheel: { x: 10, y: 732, w: 100, h: 100 }, jib: { x: 131, y: 670, w: 80, h: 80 }, main: { x: 221, y: 670, w: 80, h: 80 } };
  const v1 = { wheel: { x: 60, y: 782 }, jib: { x: 171, y: 705.26 }, main: { x: 261, y: 705.06 } };
  for (const k of ['wheel', 'jib', 'main']) {
    const S = rig.slotCam(k, SLOT_CAMS[k], rects[k]);
    assert.equal(S.rect.w, rects[k].w);
    const p = k === 'wheel' ? rig.projectSlot('wheel', 'wheel.item', [0, 0, 0]) : rig.projectSlot(k, `winch.${k}.item`, [0, WINCHES[k].y1 - WINCHES[k].y0, 0]);
    assert.ok(Math.hypot(p.x - v1[k].x, p.y - v1[k].y) < 1.5, `${k}: v2 ${p.x.toFixed(2)},${p.y.toFixed(2)} v1 ${v1[k].x},${v1[k].y}`);
    if (k !== 'wheel') {
      const g = rig.projectSlot(k, `winch.${k}.spin`, rig.grip(k)), r = rects[k];
      assert.ok(g.x > r.x && g.x < r.x + r.w && g.y > r.y && g.y < r.y + r.h, `${k}: the grip inside its slot (${g.x.toFixed(1)}, ${g.y.toFixed(1)})`);
    }
  }
});
