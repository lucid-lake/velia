// The panel's side plates' words and markup (v2/ui/chart/panelPlates.js): Waters has Emerald Bay and a greyed
// "More lakes later"; Boat has Halcyon and keeps Tessie out until the phase-1 flag is on; Start has the birthplaces;
// the conditions wear their captions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { plateHtml, boatsShown, KIND_OF, CAPTIONS } from '../ui/chart/panelPlates.js';

const keys = (html) => [...html.matchAll(/data-pc="([^"]+)"/g)].map((m) => m[1]);

test('every ledger row opens a plate kind; one conditions row (owner, 2026-11-20)', () => {
  assert.deepEqual(KIND_OF, { waters: 'waters', place: 'start', cond: 'cond' });   // the vessel row has no plate (two buttons in the row)
  const h = plateHtml('start', { births: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B', disabled: true }] });
  assert.match(h, /data-pc="start:b"[^>]* disabled/, 'a shallow pin is greyed while Tessie is picked');
  assert.doesNotMatch(h, /data-pc="start:a"[^>]* disabled/);
});

test('Waters: Emerald Bay and a greyed More lakes later', () => {
  const h = plateHtml('waters');
  assert.deepEqual(keys(h), ['waters:emerald', 'waters:more']);
  assert.match(h, /data-pc="waters:more"[^>]* disabled/);
  assert.doesNotMatch(h, /data-pc="waters:emerald"[^>]* disabled/);
  assert.match(h, />Waters</);
});

test('Boat: no plate any more (the row is two buttons); the boats’ words stay, Tessie only where she may be played', () => {
  assert.equal(plateHtml('boat', { tessie: true }), '');
  assert.deepEqual(boatsShown().map((b) => b.id), ['halcyon']);
  assert.deepEqual(boatsShown({ tessie: true }).map((b) => b.id), ['halcyon', 'tessie']);
});

test('Start: the birthplaces in the map’s names, no Surprise me', () => {
  const h = plateHtml('start', { births: [{ id: 'fannette', name: 'Off Fannette', mark: 'Tessie' }, { id: 'vikingsholm', name: 'Vikingsholm' }] });
  assert.deepEqual(keys(h), ['start:fannette', 'start:vikingsholm']);
  assert.match(h, /Off Fannette <small class="mk">Tessie<\/small>/, 'the Start plate: Tessie\'s small mark beside the name');
  assert.equal((h.match(/class="mk"/g) ?? []).length, 1);
  assert.doesNotMatch(h, /Surprise/);
});

test('conditions: a caption over each segmented row, matching its aria-label', () => {
  const h = plateHtml('cond', { times: [{ id: 'dawn', name: 'Dawn' }], weather: [{ id: 'fair', name: 'Fair' }], levels: [{ id: '1', name: 'Light' }] });
  for (const [k, label] of [['time', 'Time of day'], ['weather', 'Weather'], ['wind', 'Wind']]) {
    assert.equal(CAPTIONS[k], label);
    assert.match(h, new RegExp(`class="cap" aria-hidden="true">${label}<`));
    assert.match(h, new RegExp(`aria-label="${label}"`));
  }
  assert.deepEqual(keys(h), ['time:dawn', 'weather:fair', 'wind:1']);
});

test('names are escaped', () => {
  assert.doesNotMatch(plateHtml('start', { births: [{ id: 'x', name: '<b>' }] }), /<b>/);
});
