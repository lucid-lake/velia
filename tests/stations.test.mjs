// The station seam (refactor round 2, Phase C step 9; src/stations/index.js): the sail controller mounts the helm station
// through the registry, keyed by the craft. Every craft in the craft registry has a station, or is named below as one still
// to be built (the kayak: its paddle station is Kayak mode's work); a craft added without one, or a station row dropped,
// fails here first.
import { mountSail } from './helpers/sail-controls.mjs';   // first: it primes the small test lake before src/terrain.js loads
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATIONS, stationFor } from '../classic/src/stations/index.js';
import { mountSloopStation } from '../classic/src/stations/sloop/index.js';
import { CRAFTS } from '../src/sim/craft/index.js';

// crafts with no station yet: each is refused by name until its folder lands (then move it out of this list)
const NOT_YET = ['kayak'];
// the station's own elements (the trim panel, the panel, the PRO recess, the helm station, the Tack pill, the lever)
const PARTS = ['lk-tp', 'lk-cp', 'lk-pro', 'lk-helm', 'lk-tackb', 'lk-thr'];
const onPage = (c) => [...document.body.children].some((e) => e.id === c || e.classList?.contains(c));

test('the registry: the sloop\'s mount, frozen; an unknown craft is refused by name', () => {
  assert.equal(stationFor('sloop'), mountSloopStation);
  assert.equal(typeof stationFor('sloop'), 'function');
  assert.ok(Object.isFrozen(STATIONS));
  assert.throws(() => stationFor('kayak'), /stations: no station for craft 'kayak'/);
  assert.throws(() => stationFor('toString'), /no station for craft 'toString'/);
  assert.throws(() => stationFor(undefined), /no station for craft 'undefined'/);
});

test('every craft has a station, or is named as one still to build', () => {
  for (const id of Object.keys(CRAFTS)) {
    if (NOT_YET.includes(id)) assert.throws(() => stationFor(id), new RegExp(`no station for craft '${id}'`), `${id} has a station now: take it off NOT_YET`);
    else assert.equal(typeof stationFor(id), 'function', `craft '${id}' has no station in src/stations/index.js`);
  }
  for (const id of Object.keys(STATIONS)) assert.ok(Object.hasOwn(CRAFTS, id), `station '${id}' names no craft`);
});

test('Sail mounts the sloop\'s station: the same services as before, gone with the controls (the throttle stays with the mode)', () => {
  const s = mountSail();
  const disposeControls = s.c.dispose; s.c.dispose = () => {};
  try {
    for (const n of ['station', 'panel', 'throttle', 'tackBtn', 'helmPick', 'hud']) assert.ok(s.services.get(n), `provided: ${n}`);
    assert.equal(s.services.get('helmPick'), s.c.helmPick);
    assert.equal(s.services.get('hud'), s.core.hud);
    for (const c of PARTS) assert.ok(onPage(c), `on the page: ${c}`);
    s.step(3);
    disposeControls();
    for (const n of ['station', 'panel', 'tackBtn', 'helmPick']) assert.equal(s.services.has(n), false, `removed: ${n}`);
    assert.ok(s.services.has('throttle'), 'the throttle stays with the mode\'s scope, as before');
    for (const c of PARTS) assert.equal(onPage(c), false, `gone: ${c}`);
  } finally { s.dispose(); }
});

test('no 3D HUD: no station, panel or lever; the trim panel and the helm view\'s parts still there', () => {
  const s = mountSail({ hud: false });
  try {
    assert.equal(s.services.get('station'), null);
    assert.equal(s.services.get('panel'), null);
    assert.equal(s.services.get('throttle'), null);
    assert.equal(s.services.get('tackBtn'), null);
    assert.ok(s.services.get('helmPick'));
    s.step(3);
  } finally { s.dispose(); }
});
