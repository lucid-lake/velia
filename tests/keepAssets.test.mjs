// perf/phone-load: an upload keeps the last builds' hashed chunks (tools/keep_assets.mjs), so a page that loaded the old
// index.html a moment before the upload still finds its chunks. Pure: the plan only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { plan } from '../tools/keep_assets.mjs';

const DAY = 86400e3, now = 100 * DAY;

test('the new build keeps the earlier chunks it lacks, for 14 days; its own chunks are archived; older ones go', () => {
  const p = plan({
    dist: ['index-NEWHASH1.js', 'three.webgpu-B1bsjs5o.js', 'hero-1280-Dtj8g16C.webp', 'not-hashed.txt'],
    archived: { 'index-OLDHASH1.js': now - 2 * DAY, 'three.webgpu-B1bsjs5o.js': now - 3 * DAY, 'index-ANCIENT1.js': now - 20 * DAY },
    now, days: 14,
  });
  assert.deepEqual(p.copyIn, ['index-OLDHASH1.js'], 'the last build\'s entry chunk stays reachable');
  assert.deepEqual(p.stamp, ['hero-1280-Dtj8g16C.webp', 'index-NEWHASH1.js', 'three.webgpu-B1bsjs5o.js'], 'the new build\'s hashed files, dated now');
  assert.deepEqual(p.prune, ['index-ANCIENT1.js']);
});

test('a first run has nothing to keep', () => {
  assert.deepEqual(plan({ dist: ['a-12345678.js'], archived: {}, now, days: 14 }), { copyIn: [], stamp: ['a-12345678.js'], prune: [] });
});
