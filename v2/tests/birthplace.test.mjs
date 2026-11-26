// The birthplaces (v2/sim/birthplace.js, 73 § 2; owner, 2026-11-18): the waters file's rows pass the depth and
// shore check; the reach rule is never in irons in any wind at any row; the land probe flips the tack; a tie is starboard; the
// fireworks evening faces the show out of irons; the first visit is Off Fannette (Tessie's mark on its pin); a stored or flagged 'tessie' falls back to it; the saved pick,
// ?birth= and the URL pin; the move under the veil, refused in a race or a knockdown; the fan-out's
// pieces (the first gust relaid, the stage quiet, the passage's leg).
import test from 'node:test';
import assert from 'node:assert/strict';
import { listBirthplaces, chooseBirthplace, birthPose, landAhead, resolveStart, createBirthplaces, BIRTH } from '../sim/birthplace.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { FADE } from '../ui/dayClock.js';
import { checkRows, bakedDepth, regionDepths } from '../../tools/birthplace-check.mjs';
import { relayGust } from '../sim/wind.js';
import { WindField } from '../../src/sim/wind.js';
import { createStageDirector } from '../stage/director.js';
import { createPassage } from '../../src/ui/passage.js';
import { parseV2Flags } from '../engine/flags.js';

const W = CURRENT_WATERS, ROWS = listBirthplaces(W);
const off = (h, w) => Math.abs(((h - w + 540) % 360) - 180);
const store = (init = {}) => { const v = { ...init }; return { get: (k) => v[k], set: (k, x) => { v[k] = x; }, v }; };
const { depthAt } = bakedDepth();

test('the rows: 4 in the bay, Open lake and Off Ski Run (South Lake, on its own level), all playable; each passes the depth and shore check (tools/birthplace-check.mjs)', async () => {
  assert.deepEqual(ROWS.map((r) => r.id), ['fannette', 'vikingsholm', 'narrows', 'lake', 'ski-run']);
  for (const r of ROWS) { assert.ok(r.name && r.why && r.look && r.region, `${r.id}: name, why, look, region`); assert.equal(r.locked, false); }
  assert.equal(W.start.x, 1200); assert.equal(W.start.headingDeg, 251, 'the waters file\'s start is untouched (v1, ?start=)');
  const rows = checkRows(W, bakedDepth(), await regionDepths());
  for (const c of rows) assert.ok(c.ok, `${c.id}: ${c.fail.join('; ')}`);
  // Off Ski Run on South Lake's 4 m ground: 22.85 m deep; a reach east (95°) in the afternoon's wind from 200°, 120° in the morning's from 15°
  const ski = rows.find((c) => c.id === 'ski-run');
  assert.equal(ski.ground, 'south-lake'); assert.ok(Math.abs(ski.depth - 22.85) < 0.1, `${ski.depth} m`);
  assert.deepEqual(ski.hours.filter((h) => h.windDeg === 200).map((h) => [h.heading, h.tack]), [[95, 'starboard'], [95, 'starboard']]);
  assert.deepEqual(ski.hours.filter((h) => h.windDeg === 15).map((h) => h.heading), [120, 120]);
});

test('never in irons: every row, every wind from 0 to 355° (5° steps), with the land probe: 105° off; the fireworks guard ≥ 50°', () => {
  for (const r of ROWS) for (let w = 0; w < 360; w += 5) {
    const p = birthPose(r, { windDeg: w, depthAt });
    assert.ok(Math.abs(p.offWindDeg - BIRTH.offDeg) < 1e-6 && off(p.headingDeg, w) >= 45, `${r.id} in ${w}°: ${p.headingDeg}°`);
    const s = birthPose(r, { windDeg: w, depthAt, showDeg: (w + 20) % 360 });
    assert.ok(off(s.headingDeg, w) >= BIRTH.showIronsDeg - 1e-6, `${r.id} show in ${w}°: ${s.headingDeg}°`);
  }
});

test('the tack: the hero nearest the bow; a tie is starboard; land in 400 m flips it; both blocked stands, flagged', () => {
  const open = () => 50;
  // the look due east, wind from the north: reaches 255 (stbd: W − 105) and 105 (port): the look (90°) is nearer 105
  const r = { id: 'x', x: 0, z: 0, look: [500, 0] };
  let p = birthPose(r, { windDeg: 0, depthAt: open });
  assert.equal(p.tack, 'port'); assert.equal(p.headingDeg, 105);
  // the look straight downwind (south, 180°): 255 and 105 are both 75° off: starboard
  p = birthPose({ ...r, look: [0, 500] }, { windDeg: 0, depthAt: open });
  assert.equal(p.tack, 'starboard'); assert.equal(p.headingDeg, 255);
  // land east of x = 300 (the look far off to the east, past the land): the probe flips to starboard
  const eastLand = (x) => (x > 300 ? 0 : 50);
  p = birthPose({ ...r, look: [5000, 0] }, { windDeg: 0, depthAt: eastLand });
  assert.equal(p.tack, 'starboard'); assert.equal(p.blocked, false);
  assert.ok(landAhead(0, 0, 90, eastLand) && !landAhead(0, 0, 270, eastLand));
  // land everywhere past 100 m: both blocked, the hero's tack kept, flagged
  p = birthPose({ ...r, look: [5000, 0] }, { windDeg: 0, depthAt: (x, z) => (Math.hypot(x, z) > 100 ? 0 : 50) });
  assert.equal(p.blocked, true); assert.equal(p.tack, 'port'); assert.equal(p.offWindDeg, 105);
  // toward the hero itself the probe stops 200 m short of it (sailing at the island is the point)
  p = birthPose({ ...r, look: [500, 0] }, { windDeg: 0, depthAt: (x) => (x > 380 ? 0 : 50) });
  assert.equal(p.tack, 'port', 'the island 380 m off does not flip the tack toward it');
  // the camera turns to a hero over 35° off the bow, at most 90°
  p = birthPose({ ...r, look: [0, 500] }, { windDeg: 0, depthAt: open });
  assert.ok(Math.abs(p.camYawDeg) > 35 && Math.abs(p.camYawDeg) <= 90, `cam ${p.camYawDeg}`);
});

test('the fireworks evening faces the show; a show within 50° of the wind turns out to 50° on its side', () => {
  const r = ROWS[0];
  assert.equal(birthPose(r, { windDeg: 195, showDeg: 128 }).headingDeg, 128, 'Off Fannette to the barges, 67° off: as is');
  assert.equal(birthPose(r, { windDeg: 195, showDeg: 170 }).headingDeg, 145, '25° off on the left: 50° off on the left');
  assert.equal(birthPose(r, { windDeg: 195, showDeg: 210 }).headingDeg, 245);
  assert.equal(birthPose(r, { windDeg: 195, showDeg: 210 }).rule, 'show');
});

test('Off Fannette carries Tessie\'s small mark and the tea house line; the old \'tessie\' id falls back to it (stored, ?birth=) without an error', () => {
  const f = ROWS.find((r) => r.id === 'fannette');
  assert.equal(f.mark, 'Tessie'); assert.match(f.why, /tea house 200 m/); assert.equal(ROWS.filter((r) => r.mark).length, 1, 'one mark, on one pin');
  assert.equal(BIRTH.first, 'fannette');
  assert.equal(resolveStart({ waters: W, settings: store({ birthplace: 'tessie' }) }).id, 'fannette', 'a stored tessie: Off Fannette');
  assert.equal(resolveStart({ waters: W, settings: store(), flags: parseV2Flags('?birth=tessie') }).id, 'fannette', '?birth=tessie: Off Fannette');
  const bp = createBirthplaces({ waters: W, settings: store({ birthplace: 'tessie' }), windAt: () => 200, depthAt, place: () => {} });
  assert.equal(bp.chosen, 'fannette'); assert.equal(bp.pick('tessie'), null, 'no row, no pick');
  assert.ok(depthAt(f.x, f.z) >= 10, `Tessie (the vessel) starts there: ${depthAt(f.x, f.z).toFixed(1)} m of water, her pins need 10 m`);
});

test('the opening camera faces Fannette Island: heading plus the glance lands on the island within 1 degree in every wind (already within 10 degrees of it: no glance); the heading stays the wind rule\'s', () => {
  const f = ROWS.find((r) => r.id === 'fannette'), toIsland = (Math.atan2(f.look[0] - f.x, -(f.look[1] - f.z)) * 180 / Math.PI + 360) % 360;
  for (const windDeg of [0, 45, 90, 135, 180, 195, 200, 225, 270, 315]) {
    const p = birthPose(f, { windDeg, depthAt });
    assert.ok(Math.abs(Math.abs(((p.headingDeg - windDeg + 540) % 360) - 180) - 105) < 1e-6 || p.rule !== 'reach', `wind ${windDeg}: still the reach rule (${p.headingDeg})`);
    const faced = (p.headingDeg + p.camYawDeg + 360) % 360, miss = Math.abs(((faced - toIsland + 540) % 360) - 180);
    assert.ok(miss < 1 || (p.camYawDeg === 0 && miss <= f.camOffDeg) || Math.abs(p.camYawDeg) === BIRTH.camMaxDeg, `wind ${windDeg}: camera ${faced.toFixed(1)} deg vs island ${toIsland.toFixed(1)} (${miss.toFixed(1)} off)`);
  }
  const p = birthPose(f, { windDeg: 195, depthAt });
  assert.ok(Math.abs(p.camYawDeg) > 10, `the 195 deg wind: the camera turns ${p.camYawDeg.toFixed(1)} deg to the island, it was 34 deg short of the old 35 deg rule`);
});

test('the first visit: Off Fannette, within 600 m of the island; the saved pick; ?birth= wins once; ?start= / ?heading= pin today\'s pose', () => {
  const first = resolveStart({ waters: W, settings: store() });
  assert.deepEqual(first, { id: 'fannette', pick: 'fannette', source: 'first' });
  const t = ROWS.find((r) => r.id === 'fannette');
  assert.ok(Math.hypot(t.x, t.z) <= 600, `${Math.hypot(t.x, t.z).toFixed(0)} m from Fannette`);
  assert.equal(resolveStart({ waters: W, settings: store({ birthplace: 'vikingsholm' }) }).id, 'vikingsholm');
  assert.equal(resolveStart({ waters: W, settings: store({ birthplace: 'gone' }) }).id, 'fannette', 'an unknown saved id: the first row');
  const s = store({ birthplace: 'vikingsholm' });
  assert.equal(resolveStart({ waters: W, settings: s, flags: parseV2Flags('?birth=lake') }).id, 'lake');
  assert.equal(s.v.birthplace, 'vikingsholm', '?birth= is never saved');
  assert.equal(resolveStart({ waters: W, settings: s, flags: parseV2Flags('?start=1200,-1050&heading=251') }), null);
  assert.equal(resolveStart({ waters: W, settings: s, flags: parseV2Flags('?heading=251') }), null);
  assert.equal(resolveStart({ waters: W, settings: s, flags: parseV2Flags('?birth=narrows&heading=200') }).id, 'narrows', '?birth= with a heading: the row (the page pins the heading)');
});

test('an old saved or flagged \'random\' (the removed Surprise me) falls back to the default row', async () => {
  const first = resolveStart({ waters: W }).id;
  const a = resolveStart({ waters: W, settings: store({ birthplace: 'random' }) });
  assert.equal(a.id, first); assert.equal(chooseBirthplace(ROWS, 'random').id, first);
  assert.equal(resolveStart({ waters: W, flags: parseV2Flags('?birth=random') }).id, first);
  const s = service({ veil: null });
  s.settings.set('birthplace', 'random');
  assert.equal(s.bp.chosen, first, 'the service reads a stored random as the default');
  assert.equal((await s.bp.moveTo('random')).why, 'unknown'); assert.equal(s.bp.pick('random'), null);
});

test('the dayClock veil and the move\'s are the same (0.35 s out, 0.05 s held, 0.45 s in)', () => {
  assert.deepEqual({ ...BIRTH.veil }, { ...FADE });
});

function service(o = {}) {
  const placed = [], veils = [], moved = [], settings = store();
  const bp = createBirthplaces({ waters: W, settings, seed: 1, current: 'fannette', windAt: () => 200, depthAt, place: (p) => placed.push(p),
    veil: (op, s) => veils.push([op, s]), ...o });
  bp.on('moved', (e) => moved.push(e));
  return { bp, placed, veils, moved, settings };
}

test('moveTo: the veil out, the place at 0.40 s, one frame dark, the veil in; remembered; the moved event; one move at a time', async () => {
  const { bp, placed, veils, moved, settings } = service();
  assert.equal(bp.list().length, 5); assert.equal(bp.current, 'fannette');
  const p = bp.moveTo('vikingsholm');
  assert.deepEqual(veils, [[1, 0.35]]); assert.equal(placed.length, 0); assert.equal(bp.moving, true);
  assert.deepEqual(await bp.moveTo('lake'), { ok: false, why: 'moving' });
  bp.step(0.2); assert.equal(placed.length, 0);
  bp.step(0.21); assert.equal(placed.length, 1, 'placed after out + hold');
  assert.equal(placed[0].id, 'vikingsholm'); assert.equal(off(placed[0].headingDeg, 200), 105);
  bp.step(1 / 60); assert.deepEqual(veils.at(-1), [0, 0.45]);
  bp.step(0.5); assert.equal(bp.moving, false);
  const r = await p;
  assert.equal(r.ok, true); assert.equal(r.id, 'vikingsholm'); assert.equal(bp.current, 'vikingsholm');
  assert.equal(moved.length, 1); assert.equal(moved[0].from, 'fannette'); assert.equal(moved[0].name, 'Vikingsholm');
  assert.equal(settings.v.birthplace, 'vikingsholm', 'the last pick is remembered');
});

test('moveTo: at once with no veil or reduced motion; refused in a race and in a knockdown; unknown ids; pick() saves only', async () => {
  let s = service({ veil: null });
  assert.equal((await s.bp.moveTo('lake')).ok, true); assert.equal(s.placed.length, 1);
  s = service({ reduced: () => true });
  assert.equal((await s.bp.moveTo('lake')).ok, true); assert.equal(s.veils.length, 0);
  s = service({ canMove: () => 'race' });
  assert.deepEqual(await s.bp.moveTo('lake'), { ok: false, why: 'race' }); assert.equal(s.placed.length, 0);
  s = service({ canMove: () => 'knockdown' });
  assert.equal((await s.bp.moveTo('lake')).why, 'knockdown');
  s = service({ veil: null });
  assert.equal((await s.bp.moveTo('nowhere')).why, 'unknown');
  assert.equal(s.bp.pick('nowhere'), null);
  assert.equal(s.bp.pick('narrows').id, 'narrows'); assert.equal(s.settings.v.birthplace, 'narrows'); assert.equal(s.placed.length, 0);
  assert.equal(s.bp.chosen, 'narrows');
});

test('the fan-out: the first gust relaid ahead of the new pose and spreading in; the stage quiet 15 s; the passage\'s leg from here', () => {
  const field = new WindField({ seed: 1, day: { hour: 15 }, firstGust: { x: 0, z: 0 } });
  const pose = { x: 460, z: -50, headingDeg: 270 };
  const g = relayGust(field, pose, { t: 120 });
  assert.equal(field.first, g); assert.ok(g.x < 460 - 100, `ahead (west) of her: ${g.x}`);
  assert.equal(g.riseAt, 120); assert.equal(g.holdS, 270);
  assert.equal(field.firstGustAt(g.x, g.z, 119), 1, 'not yet risen');
  assert.ok(field.firstGustAt(g.x, g.z, 130) > 1.2, 'risen');
  assert.equal(relayGust(field, pose, { t: 5, flags: { nogust: true } }), null);
  const b0 = relayGust(new WindField({ seed: 1, day: { hour: 15 } }), pose, { t: 0 });
  assert.equal(b0.riseAt, undefined); assert.equal(b0.holdS, 150, 'at boot: as the constructor lays it');
  // the stage: an opening act at 5 s; a quiet at 1 s holds it until 16 s
  let started = 0;
  const acts = [{ id: 'a', opening: { order: 1, atS: 5 }, durationS: [5, 10], start: () => { started++; return { step() {}, result: undefined }; } }];
  const d = createStageDirector({ acts, seed: 1, overrides: { a: { atS: 5 } } });
  d.step(1); d.quiet(15);
  for (let i = 0; i < 14; i++) d.step(1);
  assert.equal(started, 0, 'quiet at 15 s of play');
  d.step(1.5); assert.equal(started, 1, 'the opening goes on after the quiet');
  // the passage: the leg to the same target starts again from where she is
  const boat = { x: 0, z: 0 };
  const P = createPassage({ services: { get: (k) => (k === 'player' ? { phys: { state: boat } } : null) } });
  P.set({ x: 100, z: 100 }); boat.x = 900; P.replan();
  assert.deepEqual(P.from, [900, 0]); assert.equal(P.target.x, 100);
});

test('the settings row: none picked by default (a first visit, Cruise keeps its own start); a pick is saved and read back', async () => {
  const { createSettings } = await import('../../src/ui/settings.js');
  const mem = new Map(), storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = createSettings({ storage });
  assert.equal(resolveStart({ waters: W, settings: s }).source, 'first');
  s.set('birthplace', 'narrows');
  assert.equal(resolveStart({ waters: W, settings: createSettings({ storage }) }).id, 'narrows', 'remembered across loads');
});

test('moveTo { instant }: no veil even with one (the first card: she is placed behind the loading shell); the moved event still fires', async () => {
  const s = service({});   // a veil is wired
  const seen = []; s.bp.on('moved', (e) => seen.push(e.id));
  const r = await s.bp.moveTo('fannette', { instant: true });
  assert.equal(r.ok, true); assert.equal(s.veils.length, 0); assert.equal(s.placed.length, 1); assert.deepEqual(seen, ['fannette']); assert.equal(s.bp.current, 'fannette');
});
