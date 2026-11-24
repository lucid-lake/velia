// The key legend (src/ui/keyLegend.js): when it shows, which lines it carries and when, how a line learns and dims, and that every cap is a real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visible, legendLevels, countUse, loadCounts, linesFor, lineOf, LINES, LINE_OF, LEARN_AT, STORE_KEY, MIN_WIDTH,
  legendLines, sixLines, sixLevels, SIX_IDS, stepMoments, landmarkSignal, shoreDistance, ALL_LINES, CONTEXT_LINES } from '../src/ui/keyLegend.js';
import { KEYMAP, MODES } from '../src/sail/keys.js';
import { SETTINGS, createSettings } from '../src/ui/settings.js';

const ok = { setting: true, flag: null, fine: true, width: 1600, mode: 'sail', cockpit: true, helm: false, blocked: false, loading: false };

test('shows on a desktop in Sail with the cockpit up', () => assert.equal(visible(ok), true));

test('hidden: phones, tablets, narrow windows, other modes, helm view, no cockpit, menus, loading, setting off', () => {
  for (const o of [{ fine: false }, { width: MIN_WIDTH - 1 }, { mode: 'cruise' }, { mode: 'regatta' }, { helm: true }, { cockpit: false },
    { blocked: true }, { loading: true }, { setting: false }]) assert.equal(visible({ ...ok, ...o }), false, JSON.stringify(o));
  assert.equal(visible({ ...ok, width: MIN_WIDTH }), true, 'the floor itself shows');
});

test('the flag: 0 forces off; 1 skips the device facts but not the cockpit, the menu or the mode', () => {
  assert.equal(visible({ ...ok, flag: '0' }), false);
  assert.equal(visible({ ...ok, flag: '1', fine: false, width: 390, setting: false }), true);
  for (const o of [{ helm: true }, { blocked: true }, { loading: true }, { mode: 'cruise' }, { cockpit: false }]) assert.equal(visible({ ...ok, flag: '1', ...o }), false, JSON.stringify(o));
});

test('a line dims after three uses, only that line', () => {
  let c = {};
  for (let i = 0; i < LEARN_AT - 1; i++) c = countUse(c, 'KeyW');
  assert.ok(legendLevels(c).lines.every((l) => l.level === 'full'));
  c = countUse(c, 'ArrowUp');   // the arrows count as the same action
  const lv = legendLevels(c);
  assert.equal(lv.lines.find((l) => l.id === 'main').level, 'learned');
  assert.equal(lv.lines.filter((l) => l.level === 'learned').length, 1);
  assert.equal(lv.show, true);
});

test('every line learned: the legend fades out; "?" shows it at full', () => {
  let c = {};
  for (const { id } of LINES) { const code = Object.keys(LINE_OF).find((k) => LINE_OF[k] === id); for (let i = 0; i < LEARN_AT; i++) c = countUse(c, code); }
  assert.equal(legendLevels(c).show, false);
  const r = legendLevels(c, true);
  assert.equal(r.show, true);
  assert.ok(r.lines.every((l) => l.level === 'full'));
});

test('countUse ignores keys that teach nothing and does not mutate', () => {
  const c = { main: 1 };
  assert.equal(countUse(c, 'KeyQ'), c);        // Q is a Pro key
  assert.equal(countUse(c, 'KeyA'), c);        // A D and Esc are guessed: no line
  assert.equal(countUse(c, 'Escape'), c);
  const d = countUse(c, 'KeyS');
  assert.equal(c.main, 1); assert.equal(d.main, 2);
});

test('counts persist through storage and survive junk', () => {
  const m = new Map(); const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  storage.setItem(STORE_KEY, JSON.stringify({ main: 5, tack: 'x', reef: -2, wing: 3 }));
  const c = loadCounts(storage);
  assert.equal(c.main, 5); assert.equal(c.tack, 0); assert.equal(c.reef, 0); assert.equal(c.wing, 3);
  assert.deepEqual(loadCounts({ getItem: () => '{not json' }), loadCounts(null));
  assert.deepEqual(loadCounts({ getItem: () => { throw new Error('blocked'); } }), loadCounts(null));
});

test('every cap is a real Sail key, bound to that action in the mode that shows it', () => {
  const codes = new Set(KEYMAP.map((k) => k.code));
  for (const code of Object.keys(LINE_OF)) assert.ok(codes.has(code), `${code} is in src/sail/keys.js`);
  const named = { W: 'KeyW', S: 'KeyS', R: 'KeyR', F: 'KeyF', Space: 'Space', C: 'KeyC', K: 'KeyK', G: 'KeyG', J: 'KeyJ', I: 'KeyI', B: 'KeyB' };
  for (const l of [...LINES, ...CONTEXT_LINES]) for (const k of l.caps) assert.equal(LINE_OF[named[k]], l.id === 'shake' ? 'reef' : l.id, `${k} teaches ${l.id}`);
  const word = { reef: /reef/, shake: /reef/, wing: /wing on wing/, anchor: /anchor/, engine: /engine/, bino: /binoculars/, tack: /tack/, view: /helm view/, main: /sheets/ };
  for (const keys of MODES) for (const l of [...linesFor(keys), ...CONTEXT_LINES]) {
    if (!word[l.id]) continue;
    for (const cap of l.caps) assert.ok(KEYMAP.some((k) => k.code === (cap === 'Space' ? 'Space' : `Key${cap}`) && (!k.modes || k.modes.includes(keys)) && word[l.id].test(k.action)), `${keys}: ${cap} is ${l.word}`);
  }
});

test('Esc and A D are guessed: in no mode, not even with every moment on', () => {
  for (const l of ALL_LINES) for (const k of l.caps) assert.ok(!['Esc', 'A', 'D'].includes(k), `${k} is not a legend cap`);
  for (const keys of MODES) assert.equal(legendLines({ keys, windKn: 25, twaDeg: 170, shoreM: 10, landmarkInView: true }).some((l) => l.caps.some((k) => ['Esc', 'A', 'D'].includes(k))), false);
});

test('calm open water, basic: the four always lines, in the Keys sheet words', () => {
  const calm = { keys: 'basic', windKn: 8, reefed: false, twaDeg: 60, shoreM: Infinity, depthM: 80, harbour: false, landmarkInView: false };
  assert.deepEqual(legendLines(calm).map((l) => l.id), ['main', 'jib', 'tack', 'view']);
  assert.equal(legendLines(calm).find((l) => l.id === 'main').word, 'sails in, out');   // keysContent.js: "sails in, out"
  assert.equal(legendLines({ ...calm, keys: 'raw' }).find((l) => l.id === 'main').word, 'main sheet');
});

test('K reef: from 17 kn, lets go under 14, none when reefed; reefed and easing: shake out', () => {
  const ids = (o, was) => legendLines({ keys: 'basic', ...o }, was).map((l) => l.id);
  assert.ok(!ids({ windKn: 16.9 }).includes('reef'));
  assert.ok(ids({ windKn: 17 }).includes('reef'));
  assert.ok(ids({ windKn: 15 }, { reef: true }).includes('reef'), 'hysteresis: still on at 15 once on');
  assert.ok(!ids({ windKn: 15 }, {}).includes('reef'), 'and not on at 15 from off');
  assert.ok(!ids({ windKn: 13.9 }, { reef: true }).includes('reef'));
  assert.ok(!ids({ windKn: 25, reefed: true }).includes('reef'), 'reefed: no reef line');
  assert.ok(ids({ windKn: 11, reefed: true }).includes('shake'));
  assert.ok(!ids({ windKn: 13, reefed: true }).includes('shake'));
  assert.ok(ids({ windKn: 13, reefed: true }, { shake: true }).includes('shake'));
  assert.equal(legendLines({ keys: 'basic', windKn: 20 }).find((l) => l.id === 'reef').word, 'reef');
});

test('G wing on wing: from 150 deg off the wind, lets go under 140, either tack', () => {
  const ids = (twaDeg, was) => legendLines({ keys: 'basic', twaDeg }, was).map((l) => l.id);
  assert.ok(!ids(149).includes('wing')); assert.ok(ids(150).includes('wing')); assert.ok(ids(-172).includes('wing'));
  assert.ok(ids(145, { wing: true }).includes('wing')); assert.ok(!ids(139, { wing: true }).includes('wing'));
});

test('J anchor and I engine: near shore, shallow or in the harbour; they let go farther out', () => {
  const ids = (o, was) => legendLines({ keys: 'basic', shoreM: Infinity, depthM: 80, ...o }, was).map((l) => l.id);
  assert.deepEqual(ids({}).filter((i) => i === 'anchor' || i === 'engine'), []);
  for (const o of [{ shoreM: 149 }, { depthM: 9 }, { harbour: true }]) assert.deepEqual(ids(o).slice(4), ['anchor', 'engine'], JSON.stringify(o));
  assert.ok(!ids({ shoreM: 150 }).includes('anchor') && !ids({ depthM: 10 }).includes('anchor'), 'the thresholds are strict');
  assert.ok(ids({ shoreM: 200 }, { shore: true }).includes('anchor'), 'on until 220 m');
  assert.ok(!ids({ shoreM: 221 }, { shore: true }).includes('anchor'));
  assert.ok(ids({ depthM: 12 }, { shore: true }).includes('engine') && !ids({ depthM: 15 }, { shore: true }).includes('engine'));
});

test('B binoculars: a landmark 400 to 3000 m away within 30 deg of the bow, with clear sight', () => {
  const at = (d) => ({ waterfall: { x: 0, z: -d, y: 20 } }), boat = (o) => ({ x: 0, z: 0, heading: 0, ...o });   // heading 0 looks along −z
  assert.equal(landmarkSignal(boat(), at(1000)), true);
  assert.equal(landmarkSignal(boat({ heading: Math.PI }), at(1000)), false, 'astern');
  assert.equal(landmarkSignal(boat({ heading: 31 * Math.PI / 180 }), at(1000)), false, '31 deg off');
  assert.equal(landmarkSignal(boat({ heading: 29 * Math.PI / 180 }), at(1000)), true);
  assert.equal(landmarkSignal(boat({ heading: 35 * Math.PI / 180 }), at(1000), true), true, 'hysteresis: 40 deg once on');
  assert.equal(landmarkSignal(boat(), at(399)), false); assert.equal(landmarkSignal(boat(), at(400)), true);
  assert.equal(landmarkSignal(boat(), at(3000)), true); assert.equal(landmarkSignal(boat(), at(3001)), false);
  assert.equal(landmarkSignal(boat(), at(3400), true), true); assert.equal(landmarkSignal(boat(), at(3600), true), false);
  assert.equal(landmarkSignal(boat(), at(1000), false, () => false), false, 'a hill in the way');
  assert.equal(landmarkSignal(boat(), { nowhere: { x: 0, z: -1000 } }), false, 'only the named landmarks');
  assert.deepEqual(legendLines({ keys: 'basic', landmarkInView: true }).map((l) => l.id).slice(4), ['bino']);
});

test('shoreDistance finds the nearest land on its rings', () => {
  assert.equal(shoreDistance((x) => (x > 70 ? 5 : -20), 0, 0), 80);
  assert.equal(shoreDistance(() => -20, 0, 0), Infinity);
});

test('the moments hold at least 10 s once on, then fade with the facts', () => {
  const calm = { windKn: 8 }, strong = { windKn: 22 };
  let st = stepMoments({ on: {}, since: {} }, strong, 100);
  assert.equal(st.on.reef, true);
  st = stepMoments(st, calm, 105); assert.equal(st.on.reef, true, '5 s: held');
  st = stepMoments(st, calm, 109.9); assert.equal(st.on.reef, true);
  st = stepMoments(st, calm, 110.1); assert.equal(st.on.reef, false, 'after 10 s: gone');
  st = stepMoments(st, strong, 111); assert.equal(st.on.reef, true); assert.equal(st.since.reef, 111, 'comes on again with a fresh clock');
  let f = { on: {}, since: {} }, flips = 0, prev = false;   // a flicker around the threshold does not flicker the line
  for (let i = 0; i < 60; i++) { f = stepMoments(f, { windKn: i % 2 ? 17.5 : 14.5 }, 200 + i * 0.25); if (f.on.reef !== prev) flips++; prev = f.on.reef; }
  assert.equal(flips, 1, 'on once at 17.5, then held by the 14 kn release');
});

test('at most two moments at once, in the order a sailor needs them; Pro trims come last', () => {
  const all = { keys: 'basic', windKn: 25, twaDeg: 170, shoreM: 50, depthM: 5, landmarkInView: true };
  assert.deepEqual(legendLines(all).map((l) => l.id), ['main', 'jib', 'tack', 'view', 'reef', 'anchor'], 'basic: 4 always + 2');
  assert.deepEqual(legendLines({ ...all, keys: 'pro-raw' }).map((l) => l.id), ['main', 'jib', 'tack', 'view', 'reef', 'anchor', 'lead', 'traveller', 'twist', 'backstay']);
  assert.deepEqual(legendLines({ keys: 'pro-basic', shoreM: 50 }).map((l) => l.id), ['main', 'lead', 'tack', 'view', 'anchor', 'engine', 'traveller', 'twist', 'backstay']);
});

test('moments learn: a learned moment line is hidden, a learned always line dims; "?" recalls all', () => {
  let c = {};
  for (let i = 0; i < LEARN_AT; i++) c = countUse(c, 'KeyK');
  const lines = legendLines({ keys: 'basic', windKn: 22 });
  assert.deepEqual(legendLevels(c, false, 'basic', lines).lines.map((l) => l.id), ['main', 'jib', 'tack', 'view'], 'reef is learned: not shown');
  assert.equal(legendLevels(c, true, 'basic', lines).lines.length, 5, 'recall shows it');
  assert.equal(legendLevels(c, false, 'basic', legendLines({ keys: 'basic', windKn: 5, reefed: true })).lines.some((l) => l.id === 'shake'), false, 'shake out is the same K');
  for (const code of ['KeyW', 'KeyR', 'Space', 'KeyC']) for (let i = 0; i < LEARN_AT; i++) c = countUse(c, code);
  assert.equal(legendLevels(c, false, 'basic', legendLines({ keys: 'basic' })).show, false, 'all learned, calm: the legend fades out');
  const j = legendLevels(c, false, 'basic', legendLines({ keys: 'basic', shoreM: 60 }));
  assert.equal(j.show, true); assert.deepEqual(j.lines.map((l) => l.level), ['learned', 'learned', 'learned', 'learned', 'full', 'full']);
});

test('the setting: on by default, saved, and rejects a non-boolean', () => {
  assert.equal(SETTINGS.keyHints, true);
  const m = new Map(); const storage = { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) };
  const s = createSettings({ storage });
  s.set('keyHints', false); s.set('keyHints', 'off');
  assert.equal(createSettings({ storage }).get('keyHints'), false);
});

test('Pro adds the trim lines: traveller, twist, backstay and the jib lead, as keys.js binds them', () => {
  assert.deepEqual(linesFor('basic').map((l) => l.id), LINES.map((l) => l.id));
  assert.deepEqual(linesFor('pro-basic').map((l) => l.id), ['main', 'lead', 'tack', 'view', 'traveller', 'twist', 'backstay']);
  assert.deepEqual(linesFor('pro-raw').map((l) => l.id), ['main', 'jib', 'tack', 'view', 'lead', 'traveller', 'twist', 'backstay']);
  assert.equal(lineOf('KeyR', false, 'pro-basic'), 'lead'); assert.equal(lineOf('KeyR', false, 'pro-raw'), 'jib');
  assert.equal(lineOf('KeyR', true, 'pro-raw'), 'lead'); assert.equal(lineOf('KeyF', true, 'pro-basic'), null);   // Shift+F: full screen there
  assert.equal(lineOf('KeyZ', true, 'pro-basic'), 'backstay'); assert.equal(lineOf('KeyQ', false, 'basic'), null);
});

test('every Pro cap is the key keys.js binds to that action in that mode', () => {
  const act = { traveller: /traveller/, twist: /twist/, backstay: /backstay/, lead: /jib lead/, jib: /jib sheet/ };
  for (const keys of MODES) for (const l of linesFor(keys)) {
    if (!act[l.id]) continue;
    const shift = l.caps[0] === '⇧';
    for (const cap of l.caps.filter((c) => c !== '⇧')) {
      const hit = KEYMAP.find((k) => k.code === `Key${cap}` && (k.shift === undefined || k.shift === shift) && (!k.modes || k.modes.includes(keys)) && act[l.id].test(k.action));
      assert.ok(hit, `${keys}: ${shift ? 'Shift+' : ''}${cap} is ${l.word}`);
      assert.equal(lineOf(`Key${cap}`, shift, keys), l.id);
    }
  }
});

test('v2\'s six (the lean set): W S, Space, C, B, I, J in that order; in Pro R F takes B\'s place after W S (still six rows); no K, no G, no Pro trim line', () => {
  for (const keys of MODES.concat('pro-sheet')) {
    const ids = sixLines(keys).map((l) => l.id);
    assert.equal(ids.length, 6, `${keys}: six rows`);
    if (keys.startsWith('pro')) assert.deepEqual(ids, ['main', 'jib', 'tack', 'view', 'engine', 'anchor'], keys);
    else assert.deepEqual(ids, SIX_IDS, keys);
    assert.equal(ids.includes('jib'), keys.startsWith('pro'), `${keys}: R F only in Pro`);
  }
  assert.deepEqual(sixLines('basic').map((l) => l.caps.join('')), ['WS', 'Space', 'C', 'B', 'I', 'J']);
  assert.deepEqual(sixLines('pro-sheet').map((l) => l.caps.join('')), ['WS', 'RF', 'Space', 'C', 'I', 'J']);
  assert.deepEqual(sixLines('basic').map((l) => l.word), ['sails', 'tack', 'view', 'binoculars', 'engine', 'anchor']);   // one short word a row
  assert.ok(!sixLines('basic').some((l) => ['K', 'G'].includes(l.caps[0])), 'no reef and no wing row');
});

test('the six\'s levels: B lit while a landmark is ahead, I and J while the shore is near, idle (35 %) otherwise; a learned row dims; "?" lights all', () => {
  const lv = (counts, rec, on) => Object.fromEntries(sixLevels(counts, rec, on).lines.map((l) => [l.id, l.level]));
  assert.deepEqual(lv({}, false, {}), { main: 'full', tack: 'full', view: 'full', bino: 'idle', engine: 'idle', anchor: 'idle' });
  assert.equal(lv({}, false, { bino: true }).bino, 'full');
  assert.equal(lv({}, false, { shore: true }).anchor, 'full'); assert.equal(lv({}, false, { shore: true }).engine, 'full');
  assert.equal(lv({ anchor: 3 }, false, { shore: true }).anchor, 'learned');
  assert.equal(lv({ main: 3 }, false, {}).main, 'learned');
  assert.ok(Object.values(lv({ main: 3, anchor: 3 }, true, {})).every((x) => x === 'full'));
  assert.equal(sixLevels({ main: 3, tack: 3, view: 3 }, false, {}).show, false);   // all learned, no moment: the legend fades (v1 only; v2 passes always)
});
