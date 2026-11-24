// M4: the cockpit's hit layer (v2/ui/station.js cockpitRects + v1's proLayout) against v1's own: the rects below were read
// from v1's live Sail page at 1280 × 720 (window.__lakeshore.station.rects, 2026-11-13, ?mode=sail&hud=full). Each target
// within 2 px of v1's, so a tap or a drag lands on the same part in both games.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCockpit } from '../render/cockpit/asset.js';
import { createCockpitRig } from '../render/cockpit/rig.js';
import { cockpitRects, WHEEL_PAD } from '../ui/station.js';
import { proLayout } from '../../src/stations/sloop/proRecess.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const V1 = { wheel: { x: 551, y: 628, w: 179, h: 179 }, jib: { x: 364, y: 546, w: 103, h: 103 }, main: { x: 819, y: 557, w: 91, h: 91 }, thr: { x: 736, y: 583, w: 44, h: 136 },
  // ENGINE: v2's key at its recess's outboard end (owner 2026-11-16; v1's at { x: 758, y: 651 }); TACK is the pilot head's (no cell here)
  // SAILS · ANCHOR · REEF: v2's switch panel moved left off VHF (owner 2026-11-17: 7–8 px left of v1's 827, 869, 921)
  cells: { sails: { x: 820, y: 653, w: 44, h: 48 }, anchor: { x: 862, y: 655, w: 44, h: 48 }, reef: { x: 913, y: 657, w: 44, h: 48 }, engine: { x: 778, y: 652, w: 44, h: 44 } },
  pro: { traveller: { x: 369, y: 632, w: 74, h: 44 }, jibLead: { x: 443, y: 632, w: 73, h: 44 }, vang: { x: 369, y: 676, w: 74, h: 44 }, backstay: { x: 443, y: 676, w: 73, h: 44 }, pro: { x: 324, y: 632, w: 45, h: 88 },
    binoculars: { x: 274, y: 670, w: 44, h: 44 }, radio: { x: 964, y: 670, w: 44, h: 44 } } };
const near = (a, b, name, tol = 2) => { for (const k of ['x', 'y', 'w', 'h']) assert.ok(Math.abs(a[k] - b[k]) <= tol, `${name}.${k}: v2 ${a[k]} v1 ${b[k]}`); };

async function rig1280() {
  const a = await parseCockpit(gunzipSync(readFileSync(resolve(ROOT, 'v2/assets/cockpit/desktop.ckb.gz'))));
  const rig = createCockpitRig(a.json, { coverFrames: a.coverFrames });
  rig.layout({ w: 1280, h: 720 });
  rig.set({ sink: 0, toggles: {}, pro: { open: false } }, 0);
  return rig;
}

test('the wheel, the winches, the lever and the switches\' cells land on v1\'s (1280 × 720), the engine key at its new place', async () => {
  const R = cockpitRects(await rig1280(), { w: 1280, h: 720 });
  for (const k of ['wheel', 'jib', 'main', 'thr']) near(R[k], V1[k], k);
  assert.equal(R.tack, undefined, 'no TACK cell on the cap (TACK is the helm readout\'s button)');
  for (const k of Object.keys(V1.cells)) near(R.cells[k], V1.cells[k], `cells.${k}`);
  assert.equal(WHEEL_PAD.cockpit, 1.15, 'the drag pad reaches past the rim (fix/wheel-rim-drag)');
});

test('the PRO recess\'s cells and BINOS / VHF land on v1\'s', async () => {
  const rig = await rig1280(), R = cockpitRects(rig, { w: 1280, h: 720 });
  const pts = {}; for (const k of rig.anchorNames) if (k.startsWith('p:') || k === 'binos' || k === 'vhf') pts[k] = rig.project(k);
  const face = (side) => { const [l, r, t, b] = ['l', 'r', 't', 'b'].map((e) => rig.project(`i:${side}:${e}`)); return { x: Math.min(l.x, r.x), y: Math.min(t.y, b.y), w: Math.abs(r.x - l.x), h: Math.abs(b.y - t.y) }; };
  const box = (r, m) => ({ x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m });
  const pro = proLayout(pts, { H: 720, avoid: [R.thr, ...Object.values(R.cells), box(R.jib, 4), box(R.main, 4), face('chart'), face('wind')] });
  for (const k of Object.keys(V1.pro)) near(pro[k], V1.pro[k], `pro.${k}`);
});

// A touch phone has no cockpit since (v2/ui/flat.js; the flat layout's own checks: tests/flat.test.mjs), so the phone's
// spread cells, steering zone and finger targets went with it.
