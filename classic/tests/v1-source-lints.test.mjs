// Source-text lints on v1's private code (classic/src/), moved here from tests/ in refactor round 3 D2 so the shared lane
// (node --test tests/) keeps only what protects both apps. v1 is frozen: these run in `npm run test:classic`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KEYCAP } from '../../src/ui/modeLines.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

test('no Cruise or Regatta source shows a literal key line any more', () => {
  for (const f of ['classic/src/modes/chill/index.js', 'classic/src/modes/chill/passenger.js', 'classic/src/modes/chill/handover.js', 'classic/src/modes/regatta/briefingUi.js']) {
    const src = read(f);
    for (const m of src.matchAll(/line\.show\('([^']*)'/g)) assert.doesNotMatch(m[1], KEYCAP, `${f}: ${m[1]}`);
    assert.doesNotMatch(src, /'Start \(Enter\)'|any key to skip/, f);
  }
});

test('v1\'s UI modules read the tokens: no stray cream, halo, margin or font literals', () => {
  for (const f of ['classic/src/shell.js', 'classic/src/modes/chill/handover.js']) {
    const s = read(f);
    assert.match(s, /var\(--lk-/, `${f} uses the tokens`);
    assert.doesNotMatch(s, /239[ ,]+230[ ,]+210/, `${f}: the cream as a literal`);
    assert.doesNotMatch(s, /rgb\(6 12 18/, `${f}: the halo's dark as a literal`);
    assert.doesNotMatch(s, /clamp\(28px,3\.2vw,56px\)|clamp\(26px,4\.6vh,50px\)/, `${f}: a safe margin as a literal`);
    assert.doesNotMatch(s, /font:\s*[0-9]{3} [^;]*'Jost'/, `${f}: the font as a literal`);
    assert.doesNotMatch(s.replace(/@font-face\{[^}]*\}/g, ''), /'Jost'|'Atkinson/, `${f}: a font family name outside @font-face`);
    assert.doesNotMatch(s, /font-weight:\s*300(?![\d ])/, `${f}: nothing draws in Jost 300 but the loading card`);
  }
});

test('the page never calls a feedback endpoint: no fetch, beacon or form post in the shell', () => {
  const s = read('classic/src/shell.js').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(s, /fetch\(|sendBeacon|XMLHttpRequest|method=["']post/i);
});

test('v1\'s shell hands the steady-horizon setting to the controls', () => {
  assert.match(read('classic/src/shell.js'), /setSteady\?\.\(settings\.get\('steadyHorizon'\)\)/);
});

test('no names: the harbour source carries no text that could reach the screen', () => {
  const src = read('classic/src/harbour.js').replace(/\/\/.*$/gm, '');
  assert.ok(!/CanvasTexture|fillText|TextGeometry|FontLoader/.test(src), 'draws text');
  assert.ok(!/Math\.random|Date\.now|performance\.now/.test(src), 'is not deterministic');
});
