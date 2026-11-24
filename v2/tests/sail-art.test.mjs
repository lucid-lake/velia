// The mainsail's graphics (owner 2026-11-18, Mix; render/sailArt.js): the flag's off switch, each rival told apart by her sail and the
// same sail every race, the glyph packing the shader reads, and the layout inside the racing rules (RRS Appendix G1.3). The atlas's
// painting needs a canvas (the browser's): the page tests and the stills cover it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sailArtOn, boatArt, rivalArt, packArt, packGlyphs, textUnits, CLOTH_KIND, LAYOUT, ATLAS, RIVAL_CLOTH } from '../render/sailArt.js';
import { FLEET } from '../regatta/session.js';
import { parseV2Flags } from '../engine/flags.js';
import { RIG } from '../../src/boat/rig.js';

test('sailart: on by default, ?sailart=off turns it off', () => {
  assert.equal(sailArtOn(parseV2Flags('').sailart), true);
  assert.equal(sailArtOn(parseV2Flags('?sailart=off').sailart), false);
  assert.equal(sailArtOn(parseV2Flags('?sailart=mix').sailart), true);
});

test('sailart: every rival her own number and a sail unlike the others (cloth or insignia colour), from FLEET, the same each call', () => {
  const arts = FLEET.map((f, i) => rivalArt(f, i + 1));
  assert.equal(new Set(arts.map((a) => a.number)).size, FLEET.length);
  assert.equal(new Set(arts.map((a) => `${a.cloth}|${a.inkB}`)).size, FLEET.length);
  assert.ok(new Set(arts.map((a) => a.cloth)).size >= 4, 'white, tan, grey and black laminate all sail');
  assert.deepEqual(arts, FLEET.map((f, i) => rivalArt(f, i + 1)));
  for (const f of FLEET) assert.ok(f.id in RIVAL_CLOTH);
  for (const a of arts) assert.equal(a.inkB, FLEET.find((f) => a.number === `USA ${f.sail}`).hull, 'the insignia in the HUD chip\'s colour');
  const me = boatArt(0);
  assert.equal(me.cloth, 'white'); assert.equal(me.number, 'USA 28');
});

test('sailart: the record packs exactly in f32s (the shader decodes the cloth, the rose\'s opacity and 6 glyphs)', () => {
  const r = packArt(boatArt(0));
  for (const x of r) assert.equal(Math.fround(x), x);
  const code = r[0] - 1;
  assert.equal(code % 16, CLOTH_KIND.white); assert.equal(Math.floor(code / 16), 62);
  const g = packGlyphs('USA 28'), codes = Array.from({ length: 6 }, (_, i) => Math.floor(g / 2 ** (4 * i)) % 16);
  assert.deepEqual(codes, [10, 11, 12, 14, 2, 8]);
  const g2 = packGlyphs('USA 4'), c2 = Array.from({ length: 6 }, (_, i) => Math.floor(g2 / 2 ** (4 * i)) % 16);
  assert.deepEqual(c2, [10, 11, 12, 14, 4, 15]);
});

test('sailart: the layout keeps the racing rules (insignia above the numbers, starboard uppermost, inside the 60 % arc, on the cloth)', () => {
  const chord = (y) => { const v = y / RIG.mainLuff; return RIG.boom * (1 - v) + RIG.mainHead * v + RIG.roach * 4 * v * (1 - v); };
  const L = LAYOUT, r = L.roseD / 2;
  assert.ok(L.numYS > L.numYP, 'the starboard numbers uppermost');
  assert.ok(L.roseY - r * 0.98 > L.numYS + L.numH, 'the insignia above the numbers');
  assert.ok(L.roseX - r > 0.07, 'clear of the luff tape');
  for (let a = -Math.PI; a < Math.PI; a += 0.1) { const x = L.roseX + Math.cos(a) * r, y = L.roseY + Math.sin(a) * r; assert.ok(x < chord(y), `the rose's ring inside the leech at ${a.toFixed(1)}`); }
  // the 60 % arc: the head point (the luff's top), 60 % of the leech's length; every corner of the numbers' boxes inside it
  const leech = Math.hypot(RIG.boom - RIG.mainHead, RIG.mainLuff), head = [RIG.mainHead / 2, RIG.mainLuff];
  const w = textUnits('USA 28') * L.numH / 160;
  for (const y0 of [L.numYS, L.numYP]) {
    const cx = chord(y0 + L.numH / 2) / 2;
    assert.ok(w <= chord(y0 + L.numH) * L.fit + 1e-9, 'the line fits without shrinking');
    for (const [x, y] of [[cx - w / 2, y0], [cx + w / 2, y0], [cx - w / 2, y0 + L.numH], [cx + w / 2, y0 + L.numH]]) assert.ok(Math.hypot(x - head[0], y - head[1]) <= 0.6 * leech, `(${x.toFixed(2)}, ${y.toFixed(2)}) inside the arc`);
  }
  assert.ok(L.numH >= 0.375, 'G1.2: 375 mm for a boat of 8.5–11 m');
});

test('sailart: one shared atlas about 0.7 MB with its mips', () => {
  let bytes = 0, w = ATLAS.w, h = ATLAS.h;
  for (let i = 0; i < ATLAS.mips; i++) { bytes += w * h; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
  assert.ok(bytes < 0.8e6, `${bytes} B`);
});
