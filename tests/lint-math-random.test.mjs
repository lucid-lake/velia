// One determinism lint (refactor round 3 D2; was five greps in air, boatAudio, sfx, birds, race-rules): the URL contract says
// no Math.random() in the scene. Code only (comments stripped).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['src/sim/air.js', 'src/boatAudio.js', 'src/sfx.js', 'src/audio.js', 'src/sim/race/rules.js',
  ...readdirSync(join(ROOT, 'src/birds')).filter((f) => f.endsWith('.js')).map((f) => `src/birds/${f}`)];

test('no Math.random() in the air, the boat and sfx audio, the birds or the race rules', () => {
  for (const f of FILES) {
    const code = readFileSync(join(ROOT, f), 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(!/Math\.random\s*\(/.test(code), `${f}: Math.random()`);
  }
});
