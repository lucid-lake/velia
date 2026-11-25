// Play as Tessie, phase 2d step 4: the HUD family's pure parts: the layout (1280 × 720, a narrow desktop, a tablet),
// the sonar's blips about her heading, the legend's learning (dims, never hides), a skill slot's ring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HUD, hudLayout, sonarBlips, legendLevels, legendLineOf, slotLook, LEGEND, legendVisible, capLine } from '../ui/tessieHud.js';
import { createSkills, SKILLS, SLOT_COUNT, skillOfCode, slotLabel } from '../sim/tessieSkills.js';

test('the layout at 1280 × 720: DEPTH bottom left, SONAR bottom right, the four slots bottom centre, the keys on the right edge above the sonar', () => {
  const L = hudLayout({ w: 1280, h: 720 });
  assert.deepEqual(L.depth, { left: 22, bottom: 22, size: 132 });
  assert.deepEqual(L.sonar, { right: 22, bottom: 22, size: 132 });
  assert.equal(L.skills.width, 4 * 64 + 3 * 12); assert.equal(L.skills.left, (1280 - 292) / 2); assert.equal(L.skills.bottom, 22);
  assert.ok(L.skills.left > 22 + 132 && L.skills.left + L.skills.width < 1280 - 22 - 132, 'the row stands clear between the dials');
  assert.equal(L.legend.show, true); assert.equal(L.legend.right, undefined, 'the right margin is Sail\'s (--lk-mx, the edge pair)'); assert.ok(L.legend.minBottom >= 22 + 132 + 12, 'its foot at least clear above the sonar');
  const n = hudLayout({ w: 1024, h: 700 });
  assert.equal(n.legend.show, false); assert.equal(n.depth.size, 112); assert.equal(n.skills.slot, 56);
});

test('the layout on a tablet (1180 × 820): the dials in the top corners under the bar, the slots bottom centre in the free band, no key legend', () => {
  const L = hudLayout({ w: 1180, h: 820, tablet: true, barB: 58 });
  assert.deepEqual(L.depth, { left: 16, top: 74, size: 104 }); assert.deepEqual(L.sonar, { right: 16, top: 74, size: 104 });
  assert.equal(L.legend.show, false); assert.equal(L.skills.slot, 72);
  const mid = L.skills.left + L.skills.width / 2;
  assert.ok(Math.abs(mid - 708) < 12, `centred in the free band (${mid})`);
  assert.ok(L.skills.left > 1180 * 0.4 && L.skills.left + L.skills.width < 1180 - HUD.tablet.buttonsW, 'clear of the stick and the buttons');
});

test('the sonar: boats about her heading (ahead up, right right), 160 m at the rim, the nearest 12, the target, the lock, the seen tick', () => {
  const her = { x: 0, z: 0, psi: Math.PI / 2 };   // heading east
  const boats = [
    { id: 'a', kind: 'sail', x: 80, z: 0, heading: Math.PI / 2 },   // 80 m ahead, the same heading
    { id: 'b', kind: 'kayak', x: 0, z: 40, heading: 0 },            // 40 m to her right (south when facing east)
    { id: 'far', kind: 'sail', x: 0, z: -170, heading: 0 },         // past the rim
    { id: 'h', kind: 'halcyon', x: -100, z: 0, heading: 0 },
  ];
  const B = sonarBlips(her, boats, { targetId: 'a', lockId: 'a', seen: (b, d) => d < 60 });
  assert.deepEqual(B.map((b) => b.id), ['b', 'a', 'h'], 'nearest first; past 160 m none');
  const a = B.find((b) => b.id === 'a'), b = B.find((x) => x.id === 'b'), h = B.find((x) => x.id === 'h');
  assert.ok(Math.abs(a.v - 0.5) < 1e-9 && Math.abs(a.u) < 1e-9 && Math.abs(a.rot) < 1e-9 && a.target && a.lock && !a.seen);
  assert.ok(Math.abs(b.u - 0.25) < 1e-9 && Math.abs(b.v) < 1e-9 && b.seen, 'the kayak to her right; it has seen her');
  assert.ok(h.v < -0.6 && h.kind === 'halcyon');
  const many = Array.from({ length: 20 }, (_, i) => ({ id: `s${i}`, kind: 'sail', x: 5 + i, z: 0 }));
  assert.equal(sonarBlips(her, many).length, 12);
  assert.deepEqual(sonarBlips(null, boats), []);
});

test('the legend: Swim W A S D, Dash 1 / ⇧, Bite Space (SPC) or click, Up / Down E Q, View C, Halcyon T; a line dims after 3 uses and never hides', () => {
  assert.deepEqual(LEGEND.map((l) => `${l.word} ${l.caps.join(' ')}`), ['Swim W A S D', 'Dash 1 ⇧', 'Bite Space click', 'Up / Down E Q', 'View C', 'Halcyon T']);
  assert.equal(legendLineOf('ShiftLeft'), 'dash'); assert.equal(legendLineOf('Digit1'), 'dash'); assert.equal(legendLineOf('Digit2'), null); assert.equal(legendLineOf('ArrowUp'), 'swim'); assert.equal(legendLineOf('KeyR'), null);
  const L = legendLevels({ dash: 3, view: 2 });
  assert.equal(L.length, 6, 'every line stays');
  assert.equal(L.find((l) => l.id === 'dash').level, 'learned'); assert.equal(L.find((l) => l.id === 'view').level, 'full');
});

test('a skill slot: the ring full and cream when ready, emptying in amber while it runs, refilling dim as it cools', () => {
  const S = createSkills();
  assert.deepEqual(slotLook(S.state('dash')), { ring: 1, ink: 'ready', glyph: 1 });
  S.press('dash'); S.step(0.45);
  const a = slotLook(S.state('dash')); assert.equal(a.ink, 'amber'); assert.ok(Math.abs(a.ring - 0.75) < 1e-9);
  S.step(1.35 + 1.125);
  const c = slotLook(S.state('dash')); assert.equal(c.ink, 'cool'); assert.ok(Math.abs(c.ring - 0.25) < 1e-9); assert.equal(c.glyph, 0.5);
  assert.deepEqual(slotLook(null), { ring: 0, ink: 'empty', glyph: 0.28 });
});

test('the skills row is an RPG bar: slot 1 is the dash (1 or Shift, one cooldown), slots 2 to 4 are reserved and their keys do nothing', () => {
  assert.equal(SLOT_COUNT, 4);
  assert.deepEqual([SKILLS.dash.slot, SKILLS.dash.keys, SKILLS.dash.cooldownS, SKILLS.dash.level], [1, ['Digit1', 'ShiftLeft', 'ShiftRight'], 4.5, 1]);
  assert.equal(skillOfCode('Digit1'), 'dash'); assert.equal(skillOfCode('ShiftLeft'), 'dash'); assert.equal(skillOfCode('ShiftRight'), 'dash');
  for (const c of ['Digit2', 'Digit3', 'Digit4', 'KeyW']) assert.equal(skillOfCode(c), null, `${c} presses no skill`);
  assert.deepEqual([1, 2, 3, 4].map((n) => slotLabel(n)), ['1 · ⇧', '2', '3', '4']);
  // the key and the slot's click are one press: the cooldown applies to both
  const S = createSkills();
  assert.equal(S.press(skillOfCode('Digit1')), true, 'the 1 key dashes');
  S.step(1.8); assert.equal(S.state('dash').phase, 'cool');
  assert.equal(S.press('dash'), false, 'a click on the slot in the cooldown: nothing');
  assert.equal(S.press(skillOfCode('ShiftLeft')), false, 'and Shift too');
  S.step(4.5); assert.equal(S.state('dash').phase, 'ready');
  assert.equal(S.press('dash'), true, 'the slot dashes'); assert.equal(S.state('dash').count, 2);
});

test('her legend honours Setup › key hints, as Sail\'s: shown only while she is played, on a wide desktop, with key hints on', () => {
  const wide = hudLayout({ w: 1280, h: 720 }), narrow = hudLayout({ w: 1024, h: 700 }), tab = hudLayout({ w: 1180, h: 820, tablet: true });
  assert.equal(legendVisible({ shown: true, layout: wide, keyHints: true }), true);
  assert.equal(legendVisible({ shown: true, layout: wide, keyHints: false }), false, 'key hints off: no legend');
  assert.equal(legendVisible({ shown: false, layout: wide, keyHints: true }), false, 'not while you are the boat');
  assert.equal(legendVisible({ shown: true, layout: narrow }), false); assert.equal(legendVisible({ shown: true, layout: tab }), false);
});

test('a line\'s key marks become the skipper line\'s own caps: [K] → .cap, Space reads SPC, past two characters wide', () => {
  assert.equal(capLine('Hold [Q] to dive.'), 'Hold <span class="cap" data-k="Q">Q</span> to dive.');
  assert.match(capLine('[SPC] to bite'), /<span class="cap wide" data-k="SPC">SPC<\/span>/);
  assert.match(capLine('[Space]'), /data-k="SPC"/, 'Space reads SPC (Sail\'s legend)');
  assert.equal(capLine('Look up to see the boats.'), 'Look up to see the boats.', 'no marks, no caps');
});
