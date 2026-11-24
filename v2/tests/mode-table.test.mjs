// v2's mode table (v2/engine/modes.js; refactor round 3 C1). Two checks:
//   1. a fake extra row (School, a stub chunk) is listed by the readers with no edit to them: the home card's picks, the menu's
//      gate, the mode switch (its enter, clock, Pro, speed), the phone's build order, the knockdown and the Tessie swap
//   2. a lint, on purpose (the one source-text check here): every mode-name literal outside the mode's own folder is in the
//      allow-list below, so a new string comparison is caught. A new one: read the table instead (a row fact), or, when it is a
//      real behaviour of that one mode, raise its file's count here and say why in the commit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addMode, modeRows, bootMode, knockOf } from '../engine/modes.js';

const V2 = fileURLToPath(new URL('..', import.meta.url));

test('a fake School row is listed by the readers, unedited', async () => {
  let entered = 0;
  const stub = { on: false, speed: () => 0.5, async enter() { stub.on = true; entered++; }, leave() { stub.on = false; } };
  addMode({ id: 'school', chunk: () => stub, enter: async (_k, { load }) => { const k = await load(); await k.enter(); },
    leave: (k) => k.leave(), clock: 'sail', pro: true, pipes: ['school'], knockdown: null });
  assert.ok(modeRows().some((r) => r.id === 'school' && r.label === 'School'), 'the label from src/modes/rows.js');
  // the readers, imported after the row (each test file is its own process)
  const { pickStates, V2_MODES } = await import('../ui/frontPlan.js');
  const { MODE_NAMES } = await import('../../src/modes/rows.js');
  assert.ok(V2_MODES.includes('school'));
  assert.equal(pickStates(MODE_NAMES).find((p) => p.id === 'school').ready, true, 'the card\'s pick is ready, not "soon"');
  const { PHONE_ORDER } = await import('../engine/buildGate.js');
  assert.ok(PHONE_ORDER.includes('school'), 'its pipeline group is built behind the phone\'s card');
  assert.equal(bootMode({ mode: 'sailing_school' }), 'school', '?mode= and its aliases open it');
  assert.equal(knockOf('school'), null);
  const { createKnockdownGame } = await import('../sim/knockdownGame.js');
  assert.equal(createKnockdownGame().knock({}, 'school'), false, 'no game end where the row says none');
  const { createModeSwitch } = await import('../ui/modeSwitch.js');
  const ui = { pro: false, setPro(v) { ui.pro = v; } }, landed = [];
  const M = createModeSwitch({ P: { speed: 2 }, ui: () => ui, settings: () => ({ get: () => true }), onMode: (m) => landed.push(m) });
  await M.go('school');
  assert.equal(entered, 1, 'its own chunk entered'); assert.equal(M.speed(), 0.5, 'its speed while on'); assert.equal(ui.pro, true);
  await M.go('sail');
  assert.equal(stub.on, false, 'left for Sail'); assert.equal(M.speed(), 2); assert.deepEqual(landed, ['sail']);
});

// mode-name literals ('sail', "cruise" …) in v2's code outside each mode's own folder, comments left out: file → count
const NAMES = /(['"`])(sail|cruise|regatta|school|fly)\1/g;
const OWN = ['cruise/', 'regatta/', 'engine/modes.js', 'tests/'];
const ALLOW = {
  'audio/fireworks.js': 3, 'audio/music.js': 7, 'audio/playlist.js': 1, 'audio/tessieMix.js': 1, 'living/kayaks.js': 2,
  'living/tessie.js': 1, 'living/tessiePlayer.js': 3, 'main.js': 5, 'render/kayak/asset.js': 1, 'sim/birds.js': 1,
  'sim/boat.js': 2, 'sim/kayak-stroke.js': 2, 'sim/solids.js': 1, 'sim/tessieHits.js': 1, 'sim/tessieRevenge.js': 3,
  'sim/waymark.js': 2, 'sim/wind.js': 4, 'ui/autoReef.js': 1, 'ui/chart/chartModel.js': 1, 'ui/chart/liveChart.js': 3,
  'ui/chart/mapScreen.js': 1, 'ui/cinematicIntro.js': 2, 'ui/engagement.js': 1, 'ui/firstSail.js': 1, 'ui/flat.js': 13,
  'ui/front.js': 3, 'ui/install.js': 2, 'ui/keyMap.js': 11, 'ui/metrics.js': 1, 'ui/nav.js': 1, 'ui/plan.js': 9,
  'ui/sail.js': 14, 'ui/setup.js': 2, 'ui/tessieMark.js': 1, 'ui/thumb.js': 2, 'ui/topBar.js': 3,
};
const files = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? (n === 'node_modules' ? [] : files(p)) : p.endsWith('.js') ? [p] : []; });
export function modeLiterals(src) {
  let n = 0;
  for (const line of src.split('\n')) n += (line.replace(/(^|\s)\/\/.*$/, '').match(NAMES) ?? []).length;
  return n;
}

test('every mode-name literal outside its mode\'s folder is allow-listed (read the mode table instead)', () => {
  const now = {};
  for (const f of files(V2)) {
    const rel = relative(V2, f).split('\\').join('/');
    if (OWN.some((o) => rel.startsWith(o))) continue;
    const n = modeLiterals(readFileSync(f, 'utf8'));
    if (n) now[rel] = n;
  }
  const over = Object.entries(now).filter(([f, n]) => n > (ALLOW[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${ALLOW[f] ?? 0})`);
  assert.deepEqual(over, [], 'new mode-name literals: read v2/engine/modes.js instead');
  const stale = Object.entries(ALLOW).filter(([f, n]) => (now[f] ?? 0) < n).map(([f, n]) => `${f}: ${now[f] ?? 0} < ${n}`);
  assert.deepEqual(stale, [], 'fewer literals than allowed: lower the allow-list');
});
