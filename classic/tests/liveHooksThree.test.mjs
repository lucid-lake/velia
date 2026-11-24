// The guard on src/core/warmup.js liveHooks (refactor round 2, Phase D): it wraps three's private renderer internals
// (renderer._nodes: getForRenderAsync, _createNodeBuilder, updateBefore, updateForRender, updateAfter; renderer._objects.get),
// written against one three revision. Any other three (an upgrade, a stray install) fails here first, so the hooks are
// re-checked by hand before the bump (three 0.184.0 is pinned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REVISION } from 'three';
import { LIVE_HOOKS_THREE } from '../src/core/warmup.js';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
// The three that `import 'three'` loads, found the way Node finds it (a worktree without its own node_modules resolves
// up to the main checkout's). three's "exports" hide './package.json', so resolve the entry and walk up to its package root.
function installedThree() {
  let d = dirname(fileURLToPath(import.meta.resolve('three')));
  for (;;) {
    const f = join(d, 'package.json');
    if (existsSync(f)) { const j = JSON.parse(readFileSync(f, 'utf8')); if (j.name === 'three') return j; }
    const up = dirname(d);
    if (up === d) throw new Error('no package.json named three above the resolved entry');
    d = up;
  }
}
const installed = installedThree();

test('liveHooks: three is the revision its private-API hooks were written for', () => {
  assert.equal(pkg.dependencies.three, `0.${LIVE_HOOKS_THREE}.0`, 'package.json pins the revision liveHooks knows (an exact version, no range)');
  assert.equal(installed.version, pkg.dependencies.three, 'the installed three is the pinned one');
  assert.equal(REVISION, LIVE_HOOKS_THREE, `three r${REVISION} is loaded; liveHooks was written for r${LIVE_HOOKS_THREE}: re-check its hooks, then move LIVE_HOOKS_THREE`);
});
