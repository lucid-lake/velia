// fix/first-load: the play watchdog: a frozen sim is kicked after 8 s, reloaded once if the kick fails, never twice.
// v1 only (/classic/): trimmed to three representative checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWatchdog } from '../src/ui/watchdog.js';

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };
function run({ frozenFrom = 0, recoverAt = Infinity, visible = () => true, storage = mem(), until = 30 }) {
  let simT = 0, kicks = 0, reloads = 0; const out = [];
  const wd = createWatchdog({ read: () => ({ armed: true, simT, x: simT, z: 0 }), kick: () => kicks++, reload: () => reloads++, storage });
  for (let t = 0; t <= until; t += 0.5) {
    if (t < frozenFrom || t >= recoverAt) simT = t;
    out.push(wd.tick(t, visible(t)));
  }
  return { kicks, reloads, out, log: wd.log };
}

test('a sailing boat is never touched', () => { const r = run({ frozenFrom: Infinity }); assert.equal(r.kicks, 0); assert.equal(r.reloads, 0); });
test('a kick that fails reloads once; a second page never reloads again', () => {
  const storage = mem();
  const a = run({ frozenFrom: 1, storage }); assert.equal(a.kicks, 1); assert.equal(a.reloads, 1);
  const b = run({ frozenFrom: 1, storage }); assert.equal(b.reloads, 0); assert.ok(b.log.some((e) => /already/.test(e.what)));
});

// fix/regatta-watchdog-vhf: Regatta's briefing card holds the boat (the sim's rate 0) while the loop draws on; the
// watchdog reloaded the page after ≈ 13 s. Held, the loop's frames are the liveness: a still boat is fine, a dead loop is not.
function held({ loopDiesAt = Infinity, until = 30 }) {
  const storage = mem(); let frames = 0, renders = 0, kicks = 0, reloads = 0;
  const wd = createWatchdog({ read: () => ({ armed: true, held: true, simT: 0, x: 0, z: 0, frames, renders }), kick: () => kicks++, reload: () => reloads++, storage });
  for (let t = 0; t <= until; t += 0.5) { if (t < loopDiesAt) { frames += 30; renders += 30; } wd.tick(t); }
  return { kicks, reloads, log: wd.log };
}
test('a boat held on a card (the Regatta briefing) while the loop draws is never touched', () => {
  const r = held({}); assert.equal(r.kicks, 0, JSON.stringify(r.log)); assert.equal(r.reloads, 0);
});
