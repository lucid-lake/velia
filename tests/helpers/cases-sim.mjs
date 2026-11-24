// The determinism cases (refactor Phase 2 step 5): each mode's 120 s scripted run, tick by tick, against the fixture main
// recorded before the shared stepper and the Simulation (tools/sim-record.mjs). The fast suite runs seed 1 of each
// (tests/sim-*.test.mjs), the slow lane the others (tests/slow/sim-*.slow.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { firstDiff } from './sim-record.mjs';

export const fixture = (mode) => JSON.parse(readFileSync(new URL(`../fixtures/sim-${mode}.json`, import.meta.url), 'utf8'));
export const TIERS = { 1: 'medium', 2: 'hard', 3: 'easy' };

// the pure Simulation: the live run's inputs (and world events) replayed with no DOM and no helm code; every tick bit for bit
export function pureCase(mode, seed, run, replay) {
  test(`${mode} seed ${seed}: the pure Simulation on the run's inputs, every tick bit for bit as main's`, () => {
    const want = fixture(mode)[seed], got = replay(run({ seed, keepInputs: true, ...(mode === 'regatta' ? { tier: TIERS[seed] } : {}) }));
    if (mode === 'regatta') {
      assert.equal(firstDiff(got.me, want.me), null, 'our boat');
      assert.equal(firstDiff(got.wren, want.wren), null, 'the rival');
    } else assert.equal(firstDiff(got, want), null);
  });
}

// the live path: the mode's own code, the frames at the jittery clock; every tick's state bit for bit
export function liveCase(mode, seed, run) {
  test(`${mode} seed ${seed}: the live path's 120 s, every tick bit for bit as main's`, () => {
    const want = fixture(mode)[seed], got = run({ seed, ...(mode === 'regatta' ? { tier: TIERS[seed] } : {}) });
    if (mode === 'regatta') {
      assert.equal(firstDiff(got.me, want.me), null, 'our boat');
      assert.equal(firstDiff(got.wren, want.wren), null, 'the rival');
    } else assert.equal(firstDiff(got, want), null);
  });
}
