// The phone loads the Regatta's chunk but none of Tessie's code (main.js: her chunk only where her row is on). This walks the static
// imports from the Regatta's entry (v2/regatta/index.js, the mode table's chunk), as the bundler follows them (dynamic imports are
// their own chunks and are not followed), and fails on any module of the Tessie RPG or of her own sim reached that way, naming the path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEEP } from '../regatta/tessieDeep.js';
import { REVENGE } from '../sim/tessieRevenge.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENTRY = resolve(ROOT, 'v2/regatta/index.js');
// the RPG's modules and her sim's (each loaded by her own chunk, or by a dynamic import behind ?tessierpg=1)
const BANNED = ['tessieBounty', 'tessieSurge', 'tessieBreach', 'tessieLure', 'tessieSonar', 'tessieWary', 'tessieHud', 'tessieDeepRpg',
  'tessieRevenge', 'tessieClear', 'tessieSkills', 'tessieLevelUp', 'tessieHits', 'tessiePlay', 'tessieBehave', 'tessiePlayer'];
const bannedFile = (f) => BANNED.includes(f.split('/').pop().replace(/\.js$/, '')) || /\/v2\/sim\/tessie\.js$/.test(f) || /\/v2\/living\/tessie/.test(f);

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
// static imports and re-exports only: `import x from '…'`, `import '…'`, `export … from '…'` (not `import('…')`)
const STATIC = /(?:^|[^\w$.])(?:import|export)\s*(?:[\w*\s{},$]*?\s*from\s*)?['"]([^'"]+)['"]/g;

export function staticReach(entry) {
  const via = new Map([[entry, null]]), stack = [entry];
  while (stack.length) {
    const f = stack.pop();
    if (!f.endsWith('.js') || !existsSync(f)) continue;
    for (const m of strip(readFileSync(f, 'utf8')).matchAll(STATIC)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      let r = resolve(dirname(f), spec.split('?')[0]);
      if (!existsSync(r) && existsSync(r + '.js')) r += '.js';
      if (!via.has(r)) { via.set(r, f); stack.push(r); }
    }
  }
  return via;
}
const pathTo = (via, f) => { const out = []; for (let x = f; x; x = via.get(x)) out.unshift(relative(ROOT, x)); return out.join(' -> '); };

test('the Regatta\'s chunk reaches no Tessie RPG module and none of her sim through static imports', () => {
  const via = staticReach(ENTRY);
  assert.ok(via.size > 20, `the walk found the chunk (${via.size} modules)`);
  assert.ok([...via.keys()].some((f) => f.endsWith('v2/regatta/tessieDeep.js')), 'the race director itself is walked');
  const hits = [...via.keys()].filter(bannedFile).map((f) => pathTo(via, f));
  assert.deepEqual(hits, [], `Tessie code in the phone-loaded Regatta chunk:\n${hits.join('\n')}`);
});

test('the walk can fail: from her living chunk it reaches her sim and the RPG', () => {
  const via = staticReach(resolve(ROOT, 'v2/living/tessie.js'));
  assert.ok([...via.keys()].some(bannedFile));
});

test('the race\'s copy of her tail sweep\'s roll equals her revenge\'s', () => {
  assert.equal(DEEP.rollK, REVENGE.rollK);
});
