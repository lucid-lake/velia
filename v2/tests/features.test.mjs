// The feature registry (src/core/features.js) on the six devices the owner named (2026-11-17): each feature's tier from the
// device profile's axes, the URL aliases, a capture, and fixed-at-build against a live level step.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeatures, POLICIES } from '../../src/core/features.js';
import { profileOf, readFacts, forcedOf } from '../../src/core/profile.js';
import { DEVICES } from '../../tests/helpers/devices.mjs';

// a page's profile for a fake window at a ladder level (the gpu axis the page sets)
const fakeProfile = (win, gpu) => {
  const subs = new Set(); let g = gpu;
  const get = () => profileOf(readFacts(win), forcedOf(win.location?.search ?? ''), { gpu: g });
  return { get, on: (ev, fn) => { subs.add(fn); return () => subs.delete(fn); }, setGpu(v) { g = v; for (const f of subs) f(get()); } };
};
const make = (dev, gpu, ctx = {}, search = '') => {
  const win = { ...DEVICES[dev], location: { search } };
  const pr = fakeProfile(win, gpu);
  const f = createFeatures({ profile: pr, doc: null }).configure({ headless: false, flags: {}, ...ctx });
  return { f, pr };
};
// the levels each device boots at (engine/quality.js guessLevel): a Mac L0, an integrated laptop L1, an iPad L1, an iPhone L1, a mid Android L2
const LEVEL = { ipadTrackpad: 1, touchLaptop: 1, smallDesktop: 0, iphoneTurned: 1, androidSideways: 2, desktop: 0 };
const WANT = {
  //                terrainSet townsTier birdsTier kayaksTier fireworksTier cockpitModel cockpitMaterials flatControls touchHands glassBoat (2026-11-18: a tablet as a desktop, by the GPU level; never a phone)
  ipadTrackpad:    ['phone',   'full',   'high',   'full',    'desktop',    'full',      'full',          'off',       'on', 'full'],   // L1: a tablet by its level, like a desktop (2026-11-18)
  touchLaptop:     ['full',    'full',   'high',   'full',    'desktop',    'full',      'full',          'off',       'off', 'full'],
  smallDesktop:    ['full',    'full',   'high',   'full',    'desktop',    'full',      'full',          'off',       'off', 'full'],
  iphoneTurned:    ['phone',   'lite',   'low',    'lite',    'phone',      'phone',     'lite',          'on',        'on', 'off'],
  androidSideways: ['phone',   'lite',   'low',    'lite',    'phone',      'phone',     'lite',          'on',        'on', 'off'],
  desktop:         ['full',    'full',   'high',   'full',    'desktop',    'full',      'full',          'off',       'off', 'full'],
};
const NAMES = ['terrainSet', 'townsTier', 'birdsTier', 'kayaksTier', 'fireworksTier', 'cockpitModel', 'cockpitMaterials', 'flatControls', 'touchHands', 'glassBoat'];

test('the six devices: every feature\'s tier', () => {
  for (const [dev, want] of Object.entries(WANT)) {
    const { f } = make(dev, LEVEL[dev]);
    NAMES.forEach((n, i) => assert.equal(f.feature(n).tier, want[i], `${dev} ${n}`));
  }
});

// step 3: the behaviours
const WANT_B = {
  //                deskTrim binoculars deskEnter quietSkipper shoreSpray pipelineDeferral levelRetry fingerTargets tessie ospreyDive buildAllFirst teaHouse oldRuin islandGranite fleetDetail chartGround cinematicIntro tessieArt
  ipadTrackpad:    ['on',    'on',      'on',     'off',       'full',    'on',            'on',      'on', 'on', 'on', 'off', 'on', 'off', 'full', 'full', 'live', 'on', 'on', 'on', 'on', 'full'],
  touchLaptop:     ['on',    'on',      'on',     'off',       'full',    'on',            'on',      'off', 'on', 'on', 'off', 'on', 'off', 'full', 'full', 'live', 'on', 'on', 'on', 'on', 'full'],
  smallDesktop:    ['on',    'on',      'on',     'off',       'full',    'on',            'on',      'off', 'on', 'on', 'off', 'on', 'off', 'full', 'full', 'live', 'on', 'on', 'on', 'off', 'full'],
  iphoneTurned:    ['off',   'off',     'off',    'off',       'full',    'on',            'on',      'on', 'off', 'off', 'on', 'off', 'off', 'lite', 'lite', 'webp', 'off', 'off', 'off', 'off', 'none'],
  androidSideways: ['off',   'off',     'off',    'off',       'lite',    'on',            'on',      'on', 'off', 'off', 'on', 'off', 'off', 'lite', 'lite', 'webp', 'off', 'off', 'off', 'off', 'none'],
  desktop:         ['on',    'on',      'on',     'off',       'full',    'on',            'on',      'off', 'on', 'on', 'off', 'on', 'off', 'full', 'full', 'live', 'on', 'on', 'on', 'off', 'full'],
};
const NAMES_B = ['deskTrim', 'binoculars', 'deskEnter', 'quietSkipper', 'shoreSpray', 'pipelineDeferral', 'levelRetry', 'fingerTargets', 'tessie', 'ospreyDive', 'buildAllFirst', 'teaHouse', 'oldRuin', 'islandGranite', 'fleetDetail', 'chartGround', 'cinematicIntro', 'tessieArt', 'playTessie', 'tessieTouch', 'tessieUnder'];

test('the six devices: the behaviours (binoculars, the desk\'s trim and Enter, the quiet skipper, the shore, the load)', () => {
  for (const [dev, want] of Object.entries(WANT_B)) {
    const { f } = make(dev, LEVEL[dev]);
    NAMES_B.forEach((n, i) => assert.equal(f.feature(n).tier, want[i], `${dev} ${n}`));
  }
});

// owner, 2026-11-18: "Tablets get desktop features, scaled by GPU power". Every feature row for a tablet at L0 and at L3 (and L1, L2),
// against a desktop at the same level: the same tier on every row except the layout/input rows and terrainSet (a memory row).
const TABLETS = ['ipadTrackpad', 'ipadPro', 'ipadOld', 'androidTablet'];
const LAYOUT_ROWS = new Set(['tessieTouch', 'flatControls', 'touchHands', 'fingerTargets', 'cockpitModel', 'deskTrim', 'binoculars', 'deskEnter', 'quietSkipper', 'phoneCard', 'perfHud', 'proHud']);   // perfHud: the top-right panel beside the desktop's top bar and cockpit (v2/tests/perf-hud.test.mjs)
const MEMORY_ROWS = new Set(['terrainSet']);
test('the tablet rule: every feature row for a tablet equals a desktop\'s at the same GPU level (layout, input and memory rows aside)', () => {
  for (const tab of TABLETS) for (const lvl of [0, 1, 2, 3]) {
    const t = make(tab, lvl).f, d = make('desktop', lvl).f;
    for (const n of Object.keys(POLICIES)) {
      if (LAYOUT_ROWS.has(n) || MEMORY_ROWS.has(n)) continue;
      assert.equal(t.feature(n).tier, d.feature(n).tier, `${tab} L${lvl} ${n}`);
    }
  }
});
test('the tablet rule: a tablet at L0 takes the full tiers and every hero feature; at L3 the lite tiers and no dive or Tessie', () => {
  const FULL = { townsTier: 'full', birdsTier: 'high', kayaksTier: 'full', fireworksTier: 'desktop', cockpitMaterials: 'full', fleetDetail: 'full', shoreSpray: 'full', ospreyDive: 'on', tessie: 'on',
    teaHouse: 'on', chartGround: 'live', islandGranite: 'full', cinematicIntro: 'on', fireworks: 'on', milkyWay: 'on', rainbow: 'on', storm: 'on', bloom: 'on', anchoredBoats: 'on', anchorDetail: 'on', birds: 'on', farTowns: 'on', lightningBolts: 'on' };
  const LITE = { ...FULL, townsTier: 'lite', birdsTier: 'low', kayaksTier: 'lite', fireworksTier: 'phone', cockpitMaterials: 'lite', fleetDetail: 'lite', shoreSpray: 'lite', ospreyDive: 'off', tessie: 'off' };
  for (const tab of TABLETS) {
    const a = make(tab, 0).f, b = make(tab, 3).f;
    for (const [n, w] of Object.entries(FULL)) assert.equal(a.feature(n).tier, w, `${tab} L0 ${n}`);
    for (const [n, w] of Object.entries(LITE)) assert.equal(b.feature(n).tier, w, `${tab} L3 ${n}`);
    // the memory row: a tablet keeps the phone grid set at every level; layout rows follow the screen and the finger
    assert.equal(a.feature('terrainSet').tier, 'phone', `${tab} terrainSet (memory)`); assert.equal(b.feature('terrainSet').tier, 'phone');
    assert.equal(a.feature('cockpitModel').tier, 'full', `${tab} cockpitModel: a full frame`);
    assert.equal(a.feature('phoneCard').tier, 'off', `${tab} phoneCard`);
    assert.equal(a.feature('fingerTargets').tier, 'on', `${tab} fingerTargets`);
  }
  assert.equal(make('ipadPro', 0).f.feature('touchHands').tier, 'on'); assert.equal(make('ipadPro', 0).f.feature('binoculars').tier, 'off', 'a finger-only tablet: no binoculars (input)');
  assert.equal(make('ipadPro', 0).f.feature('cinematicIntro').on, true, 'a touch-only tablet plays the intro (a tap skips it)');
  // a phone stays the lean sail sim at every level
  for (const lvl of [0, 3]) for (const n of ['fireworks', 'storm', 'bloom', 'birds', 'tessie', 'ospreyDive', 'teaHouse', 'cinematicIntro', 'islandGranite']) assert.notEqual(make('iphoneTurned', lvl).f.feature(n).tier, FULL[n], `phone L${lvl} ${n}`);
});

// owner, 2026-11-18: the phone's own thumb-first home card (v2/ui/phoneCard.js); every other device keeps the desktop card
const WANT_C = { ipadTrackpad: 'off', touchLaptop: 'off', smallDesktop: 'off', iphoneTurned: 'on', androidSideways: 'on', desktop: 'off' };
test('the six devices: the phone card (a phone only)', () => {
  for (const [dev, want] of Object.entries(WANT_C)) assert.equal(make(dev, LEVEL[dev]).f.feature('phoneCard').tier, want, `${dev} phoneCard`);
  for (const [dev, want] of Object.entries(WANT_C)) assert.equal(make(dev, LEVEL[dev]).f.feature('loadPhoneAdvice').tier, want, `${dev} loadPhoneAdvice (the loading page's Home Screen / computer plate, v2/ui/loadWords.js)`);
  assert.equal(make('desktop', 0, {}, '?profile=form:phone').f.feature('phoneCard').on, true, 'a desktop forced to a phone');
});

// (owner, 2026-11-18): the bed's big boulders on a desktop or a tablet at L0-L1; a phone and L2-L3 keep v1's one layer
const WANT_BB = { ipadTrackpad: 'full', touchLaptop: 'full', smallDesktop: 'full', iphoneTurned: 'lite', androidSideways: 'lite', desktop: 'full' };
test('the six devices: the bed\'s big boulders (a desktop or a tablet at L0-L1)', () => {
  for (const [dev, want] of Object.entries(WANT_BB)) assert.equal(make(dev, LEVEL[dev]).f.feature('bedBoulders').tier, want, `${dev} bedBoulders`);
  assert.equal(make('ipadTrackpad', 2).f.feature('bedBoulders').tier, 'lite', 'a tablet at L2');
  assert.equal(make('desktop', 0, {}, '?profile=form:phone').f.feature('bedBoulders').tier, 'lite', 'a desktop forced to a phone');
});

// (owner, 2026-11-17: "No fireworks, Milky Way, rainbow [on phones]. The phone is mainly for the sail sim."): desktop only on a phone
const WANT_P = {
  //                fireworks milkyWay rainbow birds  farTowns lightningBolts storm bloom anchorDetail anchoredBoats lensRain buildings   (round 2, owner 2026-11-17; storm, bloom and the ground tackle 2026-11-18; the boats at anchor 2026-11-18)
  ipadTrackpad:    ['on',     'on',    'on',   'on',  'on',    'on',          'on', 'on', 'on', 'on', 'on', 'on'],
  touchLaptop:     ['on',     'on',    'on',   'on',  'on',    'on',          'on', 'on', 'on', 'on', 'on', 'on'],
  smallDesktop:    ['on',     'on',    'on',   'on',  'on',    'on',          'on', 'on', 'on', 'on', 'on', 'on'],
  iphoneTurned:    ['off',    'off',   'off',  'off', 'off',   'off',         'off', 'off', 'off', 'off', 'off', 'off'],
  androidSideways: ['off',    'off',   'off',  'off', 'off',   'off',         'off', 'off', 'off', 'off', 'off', 'off'],
  desktop:         ['on',     'on',    'on',   'on',  'on',    'on',          'on', 'on', 'on', 'on', 'on', 'on'],
};
const NAMES_P = ['fireworks', 'milkyWay', 'rainbow', 'birds', 'farTowns', 'lightningBolts', 'storm', 'bloom', 'anchorDetail', 'anchoredBoats', 'lensRain', 'buildings'];  // lensRain: rain on the lens (owner 2026-11-24), only where the storm is

test('the six devices: the phone is for the sail sim (no fireworks, Milky Way, rainbow, birds, ski runs and far towns, or lightning bolts on a phone)', () => {
  for (const [dev, want] of Object.entries(WANT_P)) {
    const { f } = make(dev, LEVEL[dev]);
    NAMES_P.forEach((n, i) => assert.equal(f.feature(n).tier, want[i], `${dev} ${n}`));
    for (const n of NAMES_P) assert.equal(f.feature(n).fixed, true, `${n} is fixed at build`);
  }
  // a weak desktop GPU keeps them (the form decides, not the level); a capture keeps them unless ?profile= forces a phone
  for (const n of NAMES_P) {
    assert.equal(make('desktop', 3).f.feature(n).tier, 'on', `desktop L3 ${n}`);
    assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature(n).tier, 'on', `capture ${n}`);
    assert.equal(make('desktop', 0, { headless: true, flags: { touch: '1' } }).f.feature(n).tier, 'on', `the phone golden (?touch=1) ${n}`);
    assert.equal(make('desktop', 0, { headless: true }, '?profile=form:phone').f.feature(n).tier, 'off', `?profile=form:phone ${n}`);
    assert.equal(make('iphoneTurned', 1, {}, '?profile=form:tablet').f.feature(n).tier, 'on', `?profile=form:tablet on a phone ${n}`);
  }
});

test('live features follow the page: the quiet skipper the flat controls\' mount, the shore spray the level; slow-compiler stops the retry', () => {
  const { f, pr } = make('iphoneTurned', 1);
  assert.equal(f.feature('quietSkipper').on, false);
  f.mounted('flatControls', true); assert.equal(f.feature('quietSkipper').on, true, 'the flat layout is up');
  f.mounted('flatControls', false); assert.equal(f.feature('quietSkipper').on, false);
  assert.equal(f.feature('shoreSpray').tier, 'full'); pr.setGpu(2); assert.equal(f.feature('shoreSpray').tier, 'lite', 'a level step down');
  assert.equal(make('desktop', 0, {}, '?profile=quirks:slow-compiler').f.feature('levelRetry').on, false);
  assert.equal(make('desktop', 0, { headless: true }).f.feature('pipelineDeferral').on, false, 'a capture builds everything first');
  assert.equal(make('desktop', 0, { flags: { pipes: 'all' } }).f.feature('pipelineDeferral').on, false);
});

// owner, 2026-11-17 ("For phones, the best experience is to build the shaders, then present"): a phone builds every pipeline before
// the modes; a capture, ?pipes=all and a forced form follow the deferral's own rule
test('buildAllFirst: a phone only, on a live page; a capture and ?pipes=all build everything first anyway; ?profile= forces the form', () => {
  assert.equal(make('iphoneTurned', 1).f.feature('buildAllFirst').fixed, true);
  assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature('buildAllFirst').on, false, 'a capture: every pipeline before the first frame');
  assert.equal(make('androidSideways', 2, { flags: { pipes: 'all' } }).f.feature('buildAllFirst').on, false, '?pipes=all: the same');
  assert.equal(make('desktop', 0, {}, '?profile=form:phone').f.feature('buildAllFirst').on, true, 'a desktop forced to a phone');
  assert.equal(make('iphoneTurned', 1, {}, '?profile=form:tablet').f.feature('buildAllFirst').on, false, 'a phone forced to a tablet');
  assert.equal(make('desktop', 3).f.feature('buildAllFirst').on, false, 'a weak desktop GPU keeps the deferral (the form decides)');
  const { f, pr } = make('iphoneTurned', 1); assert.equal(f.feature('buildAllFirst').on, true); pr.setGpu(3); assert.equal(f.feature('buildAllFirst').on, true, 'fixed at build');
});

// Phase 2b: the in-game menu map is glass over the live lake on a desktop and a tablet, opaque with the lake paused on a phone
const WANT_G = { ipadTrackpad: 'on', touchLaptop: 'on', smallDesktop: 'on', iphoneTurned: 'off', androidSideways: 'off', desktop: 'on' };
test('the six devices: the menu map\'s glass (a phone is opaque)', () => {
  for (const [dev, want] of Object.entries(WANT_G)) assert.equal(make(dev, LEVEL[dev]).f.feature('chartGlass').tier, want, `${dev} chartGlass`);
});

// the busy lake (owner, 2026-11-18; v2/living/busyLake.js): up to 6 sailboats on a desktop or a tablet at L0-L1 (the tablet rule), 3 at L2-L3, 1 on a phone
const WANT_BL = { ipadTrackpad: 'full', touchLaptop: 'full', smallDesktop: 'full', iphoneTurned: 'phone', androidSideways: 'phone', desktop: 'full' };
test('the six devices: the busy lake (full on a desktop or tablet, lite on a weak GPU, one boat on a phone; ?traffic= overrides)', () => {
  for (const [dev, want] of Object.entries(WANT_BL)) assert.equal(make(dev, LEVEL[dev]).f.feature('busyLake').tier, want, `${dev} busyLake`);
  assert.equal(make('desktop', 2).f.feature('busyLake').tier, 'lite', 'a desktop at L2');
  assert.equal(make('ipadTrackpad', 2).f.feature('busyLake').tier, 'lite', 'a tablet at L2');
  assert.equal(make('desktop', 0, { flags: { traffic: '0' } }).f.feature('busyLake').tier, 'off');
  assert.equal(make('iphoneTurned', 1, { flags: { traffic: '1' } }).f.feature('busyLake').tier, 'full');
  assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature('busyLake').tier, 'full', 'a capture: the full lake');
  assert.equal(make('desktop', 0, { headless: true }, '?profile=form:phone').f.feature('busyLake').tier, 'phone');
});

// the regions' kayakers (owner, 2026-11-19; v2/living/busyLake.js residentKayaks) and the stage's staged pairs: one source of kayaks
const WANT_MR = { ipadTrackpad: 'on', touchLaptop: 'on', smallDesktop: 'on', iphoneTurned: 'off', androidSideways: 'off', desktop: 'on' };
test('boatMirrors: the boats\' mirrors in the water on a desktop or a tablet at L0-L1, none on a phone or at L2-L3; ?mirrors= overrides', () => {
  for (const [dev, want] of Object.entries(WANT_MR)) assert.equal(make(dev, LEVEL[dev]).f.feature('boatMirrors').tier, want, `${dev} boatMirrors`);
  assert.equal(make('ipadTrackpad', 2).f.feature('boatMirrors').tier, 'off', 'a tablet at L2');
  assert.equal(make('desktop', 3).f.feature('boatMirrors').tier, 'off', 'a desktop at L3');
  assert.equal(make('iphoneTurned', 1, { flags: { mirrors: '1' } }).f.feature('boatMirrors').tier, 'on', '?mirrors=1 on a phone');
  assert.equal(make('desktop', 0, { flags: { mirrors: '0' } }).f.feature('boatMirrors').tier, 'off', '?mirrors=0');
  assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature('boatMirrors').tier, 'on', 'a capture: on');
  assert.equal(make('desktop', 0, { flags: { mirrors: 'all' } }).f.feature('boatMirrors').tier, 'all', '?mirrors=all: every boat\'s and kayak\'s (parked)');
});
const WANT_RK = { ipadTrackpad: ['on', 'off'], touchLaptop: ['on', 'off'], smallDesktop: ['on', 'off'], iphoneTurned: ['off', 'on'], androidSideways: ['off', 'on'], desktop: ['on', 'off'] };
test('the six devices: the regions\' kayakers on a desktop or a tablet, the staged pairs only where they are off (a phone keeps v1\'s kayaks)', () => {
  for (const [dev, [rk, sk]] of Object.entries(WANT_RK)) { const { f } = make(dev, LEVEL[dev]); assert.equal(f.feature('regionKayaks').tier, rk, `${dev} regionKayaks`); assert.equal(f.feature('stagedKayaks').tier, sk, `${dev} stagedKayaks`); }
  assert.equal(make('desktop', 0, { flags: { regionkayaks: '0' } }).f.feature('stagedKayaks').tier, 'on', '?regionkayaks=0: the staged pairs back');
  assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature('regionKayaks').tier, 'on', 'a capture: the regions\' kayakers');
});

// (owner, 2026-11-19): the water's detail on a desktop and a strong tablet, as the boats' mirrors
test('waterDetail: the variation layer and the persistent foam on a desktop or a tablet at L0-L1, none on a phone or at L2-L3; ?waterdetail= overrides', () => {
  for (const [dev, want] of Object.entries(WANT_MR)) assert.equal(make(dev, LEVEL[dev]).f.feature('waterDetail').tier, want, `${dev} waterDetail`);
  assert.equal(make('ipadTrackpad', 2).f.feature('waterDetail').tier, 'off', 'a tablet at L2');
  assert.equal(make('iphoneTurned', 1, { flags: { waterdetail: '1' } }).f.feature('waterDetail').tier, 'on', '?waterdetail=1 on a phone');
  assert.equal(make('desktop', 0, { flags: { waterdetail: '0' } }).f.feature('waterDetail').tier, 'off', '?waterdetail=0');
  assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature('waterDetail').tier, 'on', 'a capture: on');
});
// (owner, 2026-11-20): the close rock on a desktop and a strong tablet, as the water's detail
test('rockDetail: the close rock on a desktop or a tablet at L0-L1, none on a phone or at L2-L3; ?rockdetail= overrides', () => {
  for (const [dev, want] of Object.entries(WANT_MR)) assert.equal(make(dev, LEVEL[dev]).f.feature('rockDetail').tier, want, `${dev} rockDetail`);
  assert.equal(make('ipadTrackpad', 2).f.feature('rockDetail').tier, 'off', 'a tablet at L2');
  assert.equal(make('desktop', 3).f.feature('rockDetail').tier, 'off', 'a desktop at L3');
  assert.equal(make('iphoneTurned', 1, { flags: { rockdetail: '1' } }).f.feature('rockDetail').tier, 'on', '?rockdetail=1 on a phone');
  assert.equal(make('desktop', 0, { flags: { rockdetail: '0' } }).f.feature('rockDetail').tier, 'off', '?rockdetail=0');
  assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature('rockDetail').tier, 'on', 'a capture: on');
});
test('every policy is named in a six-device table, with its axes and a reason', () => {
  for (const [n, P] of Object.entries(POLICIES)) {
    assert.ok(NAMES.includes(n) || NAMES_B.includes(n) || NAMES_P.includes(n) || n === 'phoneCard' || n === 'loadPhoneAdvice' || n === 'chartGlass' || n === 'bedBoulders' || n === 'busyLake' || n === 'boatMirrors' || n === 'waterDetail' || n === 'rockDetail' || n === 'regionKayaks' || n === 'stagedKayaks' || n === 'phoneClouds' /* v2/tests/phone-clouds.test.mjs */ || n === 'gennakerCloth' /* v2/tests/gennaker.test.mjs */ || n === 'paddleWheeler' /* v2/tests/paddle-wheeler.test.mjs */ || n === 'paddleboards' /* v2/tests/south-paddlers.test.mjs */ || n === 'powerBoats' /* v2/tests/south-traffic.test.mjs */ || n === 'perfHud' /* v2/tests/perf-hud.test.mjs */ || n === 'proHud' /* v2/tests/dials-north-star.test.mjs */, `${n}: add it to a six-device table`);
    assert.ok(P.axes && P.why && typeof P.tier === 'function', n);
  }
});

test('play as Tessie under the water (phase 2a): full at L0-L1, lite at L2, none at L3 and on a phone', () => {
  assert.equal(make('desktop', 0).f.feature('tessieUnder').tier, 'full');
  assert.equal(make('desktop', 1).f.feature('tessieUnder').tier, 'full');
  assert.equal(make('desktop', 2).f.feature('tessieUnder').tier, 'lite');
  assert.equal(make('desktop', 3).f.feature('tessieUnder').tier, 'none');
  assert.equal(make('iphoneTurned', 0).f.feature('tessieUnder').tier, 'none');
});

test('a weak desktop GPU (L2) takes the lite assets; a capture never does', () => {
  assert.equal(make('desktop', 2).f.feature('townsTier').tier, 'lite');
  assert.equal(make('desktop', 2).f.feature('terrainSet').tier, 'full', 'the terrain set follows the form only');
  const cap = make('iphoneTurned', 1, { headless: true }).f;
  for (const n of ['terrainSet', 'townsTier', 'kayaksTier', 'fireworksTier', 'flatControls', 'touchHands']) assert.match(cap.feature(n).tier, /full|high|desktop|off/, `capture ${n}`);
});

test('the old URL flags are aliases: ?terrain, ?touch, ?portrait', () => {
  assert.equal(make('desktop', 0, { flags: { terrain: 'phone' } }).f.feature('terrainSet').tier, 'phone');
  assert.equal(make('desktop', 0, { flags: { terrain: 'phone' } }).f.feature('townsTier').tier, 'lite');
  assert.equal(make('desktop', 0, { headless: true, flags: { touch: '1' } }).f.feature('fireworksTier').tier, 'phone', 'the phone golden: ?touch=1');
  assert.equal(make('desktop', 0, { headless: true, flags: { touch: '1' } }).f.feature('touchHands').tier, 'on');
  assert.equal(make('iphoneTurned', 1, { flags: { touch: '0' } }).f.feature('touchHands').tier, 'off');
  assert.equal(make('iphoneTurned', 1, { flags: { portrait: '1' } }).f.feature('flatControls').tier, 'off');
  assert.equal(make('desktop', 0, { flags: { birddive: '0' } }).f.feature('ospreyDive').tier, 'off', '?birddive=0: no dive, no splash');
  assert.equal(make('desktop', 3).f.feature('ospreyDive').tier, 'off', 'off at L3');
  assert.equal(make('desktop', 2).f.feature('ospreyDive').tier, 'on', 'on at L2');
  assert.equal(make('desktop', 0, {}, '?profile=form:phone,input:touch,screen:compact').f.feature('flatControls').tier, 'on', '?profile= forces the device');
});

test('fixed at build: a level step after the first read keeps an asset tier', () => {
  const { f, pr } = make('desktop', 0);
  assert.equal(f.feature('townsTier').tier, 'full');
  pr.setGpu(3);
  assert.equal(f.feature('townsTier').tier, 'full', 'decided at load, like the ladder\'s BUILD_KEYS');
  assert.ok(f.lines().every((l) => typeof l === 'string'));
});

test('bloom: ?bloom=0 turns it off everywhere, ?bloom=1 on everywhere (a phone too); a capture keeps it unless ?profile= forces a phone', () => {
  assert.equal(make('desktop', 0, { flags: { bloom: '0' } }).f.feature('bloom').on, false);
  assert.equal(make('iphoneTurned', 1, { flags: { bloom: '1' } }).f.feature('bloom').on, true);
  assert.equal(make('iphoneTurned', 1, { headless: true }).f.feature('bloom').on, true, 'a capture of a phone-sized page keeps it');
  assert.equal(make('desktop', 0, { headless: true }, '?profile=form:phone').f.feature('bloom').on, false, 'a forced phone');
  assert.equal(make('desktop', 3).f.feature('bloom').on, true, 'the form decides, not the level');
});

test('cinematicIntro: a live desktop page only (owner 2026-11-18: a tablet is a desktop, only a phone skips it); ?cinema=0 off, ?cinema=1 on in a capture, never on a phone', () => {
  const want = { desktop: true, smallDesktop: true, touchLaptop: true, ipadTrackpad: true, iphoneTurned: false, androidSideways: false };
  for (const [dev, on] of Object.entries(want)) assert.equal(make(dev, LEVEL[dev]).f.feature('cinematicIntro').on, on, dev);
  assert.equal(make('desktop', 0, { headless: true }).f.feature('cinematicIntro').on, false, 'a capture: off');
  assert.equal(make('desktop', 0, { headless: true, flags: { cinema: '1' } }).f.feature('cinematicIntro').on, true, '?cinema=1 in a capture');
  assert.equal(make('desktop', 0, { flags: { cinema: '0' } }).f.feature('cinematicIntro').on, false, '?cinema=0');
  assert.equal(make('iphoneTurned', 1, { flags: { cinema: '1' } }).f.feature('cinematicIntro').on, false, 'a phone even with ?cinema=1');
});
