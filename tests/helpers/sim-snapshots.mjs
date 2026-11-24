// The snapshot gate (refactor round 2, Phase C step 5): the Simulation's
// snapshot text, byte for byte, over the recorded voyages. Each mode × seed runs its live path once (keepInputs), replays
// the inputs on the pure Simulation and takes encodeState(sim.snapshot()) at ticks 600 (10 s) and 7200 (120 s); Sail
// also takes the live controls' own Simulation at the end. tests/fixtures/sim-snapshots.json holds each text's sha-256
// and byte length (tools/sim-snapshots.mjs --write records them on the reference commit), plus the full text of sail
// seed 1 at tick 600 so a miss reads as a diff. The modes are passed in (run, replay): Sail runs on the small test lake
// and Cruise on the real one, so one process holds one mode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { encodeState } from '../../src/sim/sail/simulation.js';
import { TIERS } from './cases-sim.mjs';

export const SNAP_TICKS = [600, 7200];
export const TEXT_KEY = 'sail/1/600';   // the one snapshot kept as text
export const FIXTURE_URL = new URL('../fixtures/sim-snapshots.json', import.meta.url);
export const digest = (text) => ({ sha256: createHash('sha256').update(text).digest('hex'), bytes: Buffer.byteLength(text) });

// the run with its inputs (and, for Sail, the live controls' snapshot)
export function recordRun(mode, seed, run) {
  return run({ seed, keepInputs: true, ...(mode === 'regatta' ? { tier: TIERS[seed] } : {}), ...(mode === 'sail' ? { liveSnap: true } : {}) });
}

// { 600: text, 7200: text, live?: text } for one recorded run; opts go to the replay (Sail's vessel)
export function snapshotTexts(mode, r, replay, opts = {}) {
  const out = {};
  for (const at of SNAP_TICKS) out[at] = encodeState(replay(r, { ...opts, at }).sim.snapshot());
  if (r.liveSnap) out.live = r.liveSnap;
  return out;
}

export const readFixture = () => JSON.parse(readFileSync(FIXTURE_URL, 'utf8'));

// the gate: every snapshot of mode × seed has the fixture's hash and length
export function snapshotCase(mode, seed, run, replay) {
  test(`${mode} seed ${seed}: the Simulation's snapshots at ticks ${SNAP_TICKS.join(' and ')}${mode === 'sail' ? ' and the live controls\' at 120 s' : ''}, byte for byte as recorded`, () => {
    const fx = readFixture(), want = fx.snapshots[mode][seed];
    const texts = snapshotTexts(mode, recordRun(mode, seed, run), replay);
    assert.deepEqual(Object.keys(texts).sort(), Object.keys(want).sort(), 'the same snapshots taken');
    for (const [k, text] of Object.entries(texts)) {
      if (`${mode}/${seed}/${k}` === TEXT_KEY) assert.equal(text, fx.text[TEXT_KEY], `${mode} ${seed} tick ${k}: the text`);
      assert.deepEqual(digest(text), want[k], `${mode} seed ${seed} at ${k}`);
    }
  });
}
