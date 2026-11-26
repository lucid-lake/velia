// The chart's "Be Tessie": the boat moves to the flagged pin's water (Off Fannette, her own row folded into it), and the entry waits.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTessie } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createBirthplaces } from '../sim/birthplace.js';
import { createTessiePlayer } from '../living/tessiePlayer.js';
import { chartActions } from '../ui/chart/liveChart.js';

const WATERS = JSON.parse(fs.readFileSync(new URL('../../src/waters/tahoe-emerald.json', import.meta.url), 'utf8'));
const deep = () => 40;

function rig() {
  const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const placed = [];
  const birthplaces = createBirthplaces({ waters: WATERS, windAt: () => 200, depthAt: deep, place: (p) => placed.push(p) });
  const plugin = { sim: createTessie({ seed: 1, depthAt: deep }), render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
  const P = createTessiePlayer({ plugin, B, depthAt: deep, headless: true, veil: () => {}, storage: null, birthplaces });
  return { P, birthplaces, placed };
}

test('Be Tessie with no row moves the boat to the row that carries her mark', async () => {
  const { P, birthplaces, placed } = rig();
  const r = await P.fromChart();
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(birthplaces.current, 'fannette');
  assert.equal(placed.length, 1);
});

test("the chart card's Be Tessie passes its pin and lands there", async () => {
  const { P, birthplaces } = rig();
  const A = chartActions({ get: (n) => (n === 'tessiePlay' ? P : null) });
  const r = await A.beTessie({ id: 'bp-fannette', ref: 'fannette', kind: 'birthplace' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(birthplaces.current, 'fannette');
});
