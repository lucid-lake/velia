// The Emerald Cup (§ 6 C4; owner 2026-11-17): four fleet races dealt for the series, low-point scoring (1st = 1 …,
// DNF = the fleet + 1), the standings after each race, the store checked and clamped on read, the podium at the end and a new Cup.
// Pure: no browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CUP, CUP_KEY, newCup, loadCup, saveCup, clampCup, points, recordRace, standings, cupState, podium, cupHand, cupWords, cupPlaces } from '../regatta/cup.js';
import { validHand, DEFAULT_SETUP, COURSES } from '../regatta/setup.js';

const NAMES = { wren: 'Osprey', tern: 'Tern', kestrel: 'Kestrel', heron: 'Heron', plover: 'Plover' };
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
const SETUP = { ...DEFAULT_SETUP, skill: 'medium', aids: 'club' };
// a race's places: the ids in finishing order (null for a DNF)
const race = (...ids) => Object.fromEntries(CUP.ids.map((id) => [id, ids.includes(id) ? ids.indexOf(id) + 1 : null]));

test('a new Cup: 4 fleet races dealt for the series, a mix of courses and conditions, each a valid hand with the full fleet', () => {
  for (const seed of [1, 2, 3, 77]) {
    const c = newCup(seed, SETUP);
    assert.equal(c.races.length, CUP.races); assert.equal(c.results.length, 0);
    //): the hub deals only the Island Sprint of the old courses until the cups take over the series (1b)
    assert.ok(c.races.every((r) => r.course === 'island-sprint'), `seed ${seed}: courses ${c.races.map((r) => r.course).join(', ')}`);
    assert.ok(new Set(c.races.map((r) => `${r.wind}|${r.time}|${r.shifts}|${r.sky}`)).size >= 3, `seed ${seed}: conditions vary`);
    assert.ok(c.races.every((r) => r.course !== 'bay-tour' && r.length !== 'full'), `seed ${seed}: no Bay Tour, no Full length`);
    for (let i = 0; i < c.races.length; i++) {
      const h = cupHand({ ...c, results: c.results.concat(Array(i).fill(race(...CUP.ids))) }, SETUP);
      assert.ok(validHand(h), `seed ${seed} race ${i + 1}: a valid hand ${JSON.stringify(h)}`);
      assert.equal(h.event, 'fleet'); assert.equal(h.rivals, CUP.rivals); assert.deepEqual(h.cup, { id: c.id, i, of: 4 });
      assert.equal(h.tier, 'medium'); assert.equal(h.aids, 'club');
    }
    assert.deepEqual(newCup(seed, SETUP), c, 'the same seed deals the same Cup');
  }
});

test('low-point scoring: 1st = 1 point, DNF = the fleet + 1; the standings after each race, ties broken by the better places', () => {
  assert.equal(points(1), 1); assert.equal(points(6), 6); assert.equal(points(null), 7); assert.equal(points(0), 7);
  let c = newCup(5, SETUP);
  c = recordRace(c, race('me', 'wren', 'tern', 'kestrel', 'heron', 'plover'));
  let st = standings(c, NAMES);
  assert.deepEqual(st.map((r) => [r.id, r.pts]), [['me', 1], ['wren', 2], ['tern', 3], ['kestrel', 4], ['heron', 5], ['plover', 6]]);
  c = recordRace(c, race('wren', 'tern', 'kestrel', 'heron', 'plover'));   // she did not finish: 7 points
  st = standings(c, NAMES);
  assert.equal(st.find((r) => r.id === 'me').pts, 8); assert.equal(st[0].id, 'wren'); assert.equal(st[0].pts, 3);
  assert.deepEqual(st.find((r) => r.id === 'me').places, [1, null]);
  // a tie on points: the boat with the better places wins it (Osprey 1 + 4 = 5 against Tern 2 + 3 = 5: Osprey has the win)
  let t = newCup(9, SETUP);
  t = recordRace(t, race('wren', 'tern', 'me', 'kestrel', 'heron', 'plover'));
  t = recordRace(t, race('me', 'kestrel', 'tern', 'wren', 'heron', 'plover'));
  const s2 = standings(t, NAMES), w = s2.find((r) => r.id === 'wren'), tn = s2.find((r) => r.id === 'tern');
  assert.equal(w.pts, 5); assert.equal(tn.pts, 5); assert.ok(w.rank < tn.rank, `the tie: Osprey ${w.rank}, Tern ${tn.rank}`);
  assert.deepEqual(s2.map((r) => r.rank), [1, 2, 3, 4, 5, 6]);
  // the state words after a race: race 2 of 4 next, her place and points
  const s = cupState(recordRace(newCup(5, SETUP), race('wren', 'me', 'tern', 'kestrel', 'heron', 'plover')), NAMES);
  assert.equal(s.raceN, 2); assert.equal(s.of, 4); assert.equal(s.me.ord, '2nd'); assert.equal(s.me.pts, 2); assert.equal(s.done, false);
  const w2 = cupWords(recordRace(newCup(5, SETUP), race('wren', 'me', 'tern', 'kestrel', 'heron', 'plover')), NAMES);
  assert.equal(w2.button, 'Continue the Cup ›'); assert.match(w2.title, /race 2 of 4/); assert.match(w2.line, /You are 2nd on 2 pts/); assert.match(w2.next, /^Next: /);
  assert.equal(cupWords(null).button, 'Start the Cup ›');
});

test('a race\'s places from the order: the rivals by their order, the player DNF when she did not finish', () => {
  assert.deepEqual(cupPlaces(['wren', 'me', 'tern', 'kestrel', 'heron', 'plover'], { me: true }), { me: 2, wren: 1, tern: 3, kestrel: 4, heron: 5, plover: 6 });
  assert.deepEqual(cupPlaces(['wren', 'me', 'tern', 'kestrel', 'heron', 'plover'], { me: false }), { me: null, wren: 1, tern: 2, kestrel: 3, heron: 4, plover: 5 });
});

test('the store: saved and read back; a broken or tampered store is clamped (bad races drop the Cup, bad results stop the list)', () => {
  const st = memStore();
  assert.equal(loadCup(st), null);
  let c = saveCup(st, recordRace(newCup(3, SETUP), race('me', 'wren', 'tern', 'kestrel', 'heron', 'plover')));
  assert.deepEqual(loadCup(st), c);
  // tampered: an impossible place, a duplicate place, a string: the results stop at the first bad one
  const raw = JSON.parse(st.getItem(CUP_KEY));
  raw.results.push({ me: 9, wren: 1 }); raw.results.push(race('me', 'wren', 'tern', 'kestrel', 'heron', 'plover'));
  st.setItem(CUP_KEY, JSON.stringify(raw));
  assert.equal(loadCup(st).results.length, 1, 'the bad race and everything after it dropped');
  raw.results = [{ me: 1, wren: 1, tern: 2, kestrel: 3, heron: 4, plover: 5 }]; st.setItem(CUP_KEY, JSON.stringify(raw));
  assert.equal(loadCup(st).results.length, 0, 'a duplicate place is not a race');
  // more results than races: clamped to 4
  raw.results = Array(7).fill(race('me', 'wren', 'tern', 'kestrel', 'heron', 'plover')); st.setItem(CUP_KEY, JSON.stringify(raw));
  assert.equal(loadCup(st).results.length, 4);
  // a broken race list, a wrong version, junk: no Cup (the hub offers a new one)
  for (const bad of ['{', '"x"', '[]', JSON.stringify({ ...raw, v: 2 }), JSON.stringify({ ...raw, races: raw.races.slice(0, 3) }), JSON.stringify({ ...raw, races: [{ ...raw.races[0], course: 'nowhere' }, ...raw.races.slice(1)] })]) {
    st.setItem(CUP_KEY, bad); assert.equal(loadCup(st), null, `clamped: ${bad.slice(0, 40)}`);
  }
  // a blocked store never throws
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.equal(loadCup(blocked), null); assert.ok(saveCup(blocked, newCup(1, SETUP)));
  assert.ok(COURSES.length >= 2); assert.equal(clampCup(null), null);
});

test('the podium at the end: the top 3 with their points, the Cup done, a new Cup starts clean', () => {
  let c = newCup(11, SETUP);
  c = recordRace(c, race('wren', 'me', 'tern', 'kestrel', 'heron', 'plover'));
  c = recordRace(c, race('me', 'wren', 'kestrel', 'tern', 'heron', 'plover'));
  c = recordRace(c, race('tern', 'wren', 'me', 'kestrel', 'plover', 'heron'));
  assert.equal(cupState(c, NAMES).done, false);
  c = recordRace(c, race('wren', 'tern', 'me', 'heron', 'kestrel', 'plover'));
  const s = cupState(c, NAMES), p = podium(c, NAMES);
  assert.equal(s.done, true); assert.equal(s.next, null); assert.equal(cupHand(c, SETUP), null);
  assert.deepEqual(p.map((r) => [r.name, r.pts]), [['Osprey', 6], ['You', 9], ['Tern', 10]]);
  assert.deepEqual(recordRace(c, race(...CUP.ids)), c, 'a done Cup takes no more races');
  const w = cupWords(c, NAMES);
  assert.equal(w.state, 'done'); assert.equal(w.button, 'Start a new Cup ›'); assert.match(w.line, /You finished 2nd on 9 pts/);
  const n = newCup(12, SETUP);
  assert.equal(n.results.length, 0); assert.equal(cupState(n, NAMES).raceN, 1); assert.equal(cupWords(n, NAMES).button, 'Start the Cup ›');
});
