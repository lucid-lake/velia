// "Tessie's up." (owner, 2026-11-24: the Be Tessie pill was too persistent and an outlier; one skipper line instead): when she shows
// herself near the boat the skipper's line says "Tessie's up. [T] to be her." (a tablet: "Tessie's up. Tap here to be her.", the line
// itself the tap target). The lean skipper's 'tip.tessie.be': the first sighting of a session, later sightings at most every 4 min, at
// most 3 a session, under the 20 s gap and the busy rule; never again once the player has swapped in by T or the tap (stored). No pill.
// Behaviour only. Run: npm run test:v2
import test from 'node:test';
import assert from 'node:assert/strict';
import { install } from '../../tests/helpers/dom-stub.mjs';
import { createBeLine, BE_LINE, createTessiePlayer } from '../living/tessiePlayer.js';
import { createLeanSkipper, classOf, TIP, LEAN, LEAN_REPEAT } from '../ui/leanSkipper.js';
import { createTessie, TESSIE } from '../sim/tessie.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { steadyWind } from '../../src/sim/boat.js';
import { SWAP } from '../sim/tessieSwap.js';
import { createSkills } from '../../src/sail/skills.js';
import { createWords } from '../../src/ui/words.js';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
// a hint row as controlsHint.note behaves on v2: the lean skipper (its phoneQuiet) decides; a line it allows shows
function hintWith(lean) {
  const shown = [], dropped = [];
  return { shown, dropped, phoneQuiet: lean, note(text, key, speak, o = {}) { if (lean.allow(o.kind)) shown.push({ text, ...o }); return true; }, drop(kind) { dropped.push(kind); return true; } };
}
// a session: the lean clock and the line stepped together; sight(secs) = she shows herself that long, away(secs) = she is gone
function session({ storage = null, touch = false, busy = () => false } = {}) {
  const lean = createLeanSkipper({ storage, busy }), h = hintWith(lean);
  let taps = 0;
  const L = createBeLine({ hint: () => h, touch: () => touch, onTap: () => { taps++; } });
  const run = (secs, up) => { for (let t = 0; t < secs; t += 0.5) { lean.update(0.5); L.step(0.5, up); } };
  return { lean, h, L, sight: (s = 6) => run(s, true), away: (s) => run(s, false), get taps() { return taps; } };
}

test('the line: a tip.tessie.be TIP, "Tessie\'s up. [T] to be her." with the T cap inline', () => {
  assert.equal(BE_LINE.kind, 'tip.tessie.be');
  assert.equal(classOf(BE_LINE.kind), TIP);
  assert.deepEqual({ ...LEAN_REPEAT[BE_LINE.kind] }, { everyS: 240, max: 3 });
  const S = session();
  S.sight(2);
  assert.equal(S.h.shown.length, 1, 'shown on the first sighting');
  const l = S.h.shown[0];
  assert.equal(l.kind, 'tip.tessie.be');
  assert.match(l.text, /^Tessie's up\. <span class="cap" data-k="T">T<\/span> to be her\.$/, 'the cap inline (capLine)');
  assert.equal(l.onTap, undefined, 'a keyboard line is no button');
});

test('a tablet: "Tessie\'s up. Tap here to be her." with no cap, and the line is the tap target', () => {
  const S = session({ touch: true });
  S.sight(2);
  const l = S.h.shown[0];
  assert.equal(l.text, "Tessie's up. Tap here to be her.");
  assert.doesNotMatch(l.text, /class="cap"|\[/);
  assert.equal(typeof l.onTap, 'function');
  l.onTap();
  assert.equal(S.taps, 1, 'the tap swaps her in');
});

test('once a sighting, again after 4 min, at most 3 a session; gone with her', () => {
  const S = session();
  S.sight(10);
  assert.equal(S.h.shown.length, 1, 'once per sighting, not every second');
  S.away(2);
  assert.deepEqual(S.h.dropped, ['tip.tessie.be'], 'she dives out of the window: the line goes too');
  S.away(50); S.sight(10);
  assert.equal(S.h.shown.length, 1, 'a sighting a minute later: no line (4 min)');
  S.away(150); S.sight(10);
  assert.equal(S.h.shown.length, 1, 'nor 3.7 min later');
  S.away(30);
  assert.equal(S.h.shown.length, 1, 'she is gone at the 4 min mark: nothing');
  S.sight(6);
  assert.equal(S.h.shown.length, 2, 'past 4 min, a new sighting: again');
  S.away(LEAN_REPEAT[BE_LINE.kind].everyS); S.sight(6);
  assert.equal(S.h.shown.length, 3, 'a third');
  for (let i = 0; i < 4; i++) { S.away(LEAN_REPEAT[BE_LINE.kind].everyS); S.sight(6); }
  assert.equal(S.h.shown.length, 3, 'at most 3 a session');
  assert.equal(S.lean.state.counts[BE_LINE.kind], 3);
});

test('under the lean rules: the 20 s gap after another line, nothing mid-manoeuvre; a long sighting waits for the quiet moment', () => {
  let busy = true;
  const S = session({ busy: () => busy });
  S.sight(8);
  assert.equal(S.h.shown.length, 0, 'nothing mid-manoeuvre');
  busy = false; S.sight(1);
  assert.equal(S.h.shown.length, 1, 'then, while she is still up');
  const T = session();
  T.lean.update(1); assert.equal(T.lean.gate('tip.helm'), true);
  T.sight(LEAN.gapS - 3);
  assert.equal(T.h.shown.length, 0, 'the 20 s gap after another line');
  T.sight(4);
  assert.equal(T.h.shown.length, 1);
});

test('never again after a swap by T or the tap: retired in the lean store, a new session too', () => {
  const storage = store();
  const S = session({ storage });
  S.sight(2); assert.equal(S.h.shown.length, 1);
  S.L.retire();
  assert.ok(S.lean.state.seen.includes('tip.tessie.be'), 'stored with the once-ever marks');
  assert.ok(S.h.dropped.includes('tip.tessie.be'), 'a line up goes at once');
  S.away(300); S.sight(10);
  assert.equal(S.h.shown.length, 1, 'not this session');
  const S2 = session({ storage });
  S2.sight(10);
  assert.equal(S2.h.shown.length, 0, 'nor the next');
});

// the real skipper's row (src/ui/controlsHint.js) on a tablet: the line carries the tap, one tap runs it once and the line goes
test('the skipper\'s row: a note with onTap is its own tap target (data-tap, a button), one tap runs it once', async () => {
  install();
  const { createControlsHint } = await import('../../src/ui/controlsHint.js');
  const sk = createSkills({ storage: null }), lean = createLeanSkipper({ storage: null });
  const st = { x: 0, z: 1600, heading: 0, sog: 2.6, furl: 0, held: false, mainFill: 1, mainStall: 0, groove: 1, trueWind: { angle: Math.PI / 2, speed: 5 }, apparentWind: { angle: 1.2, speed: 6 } };
  const hint = createControlsHint({ state: () => st, skills: sk, words: createWords({ skills: sk }), once: false, storage: null, touch: () => true, modality: () => 'touch', phoneQuiet: lean });
  let taps = 0;
  const L = createBeLine({ hint: () => hint, touch: () => true, onTap: () => { taps++; } });
  for (let i = 0; i < 60; i++) { lean.update(1 / 30); L.step(1 / 30, true); hint.update(1 / 30); }
  const row = hint.el.querySelectorAll('.row')[0];
  assert.ok(row, 'the line is up');
  assert.equal(hint.current, 'note');
  assert.match(row.innerHTML.replace(/<[^>]*>/g, ''), /Tessie's up\. ?Tap here to be her\./);
  assert.equal(row.dataset.tap, '', 'data-tap: the 44 px tap rule');
  assert.equal(row.getAttribute('role'), 'button');
  row.fire('click'); row.fire('click');
  assert.equal(taps, 1, 'one tap, once');
  assert.equal(hint.current, 'none', 'the line goes');
  // a plain note carries no tap
  hint.note('Shoaling — bear away', '', null, { kind: 'sea.shoal' });
  for (let i = 0; i < 60; i++) { lean.update(1 / 30); hint.update(1 / 30); }
  const plain = hint.el.querySelectorAll('.row').at(-1);
  assert.match(plain?.innerHTML ?? '', /Shoaling/);
  assert.equal(plain.dataset.tap, undefined);
  assert.equal(hint.drop('sea.shoal'), true, 'drop(kind) takes a line of that kind down');
  assert.equal(hint.current, 'none');
});

// the player: no pill in her DOM; T in Sail while she shows herself swaps her in and retires the line
test('the player: no .tp-be pill in the DOM; T while she shows herself swaps in and retires the line', () => {
  const html = []; const keys = {};
  const mk = (tag = 'div') => { const kids = {}; return { tagName: tag.toUpperCase(), dataset: {}, style: {}, hidden: false, children: [],
    set innerHTML(h) { html.push(h); }, get innerHTML() { return ''; },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, hasAttribute() { return false; },
    appendChild(c) { return c; }, prepend() {}, append() {}, after() {}, before() {}, replaceChildren() {}, insertBefore(c) { return c; }, remove() {}, matches() { return false; }, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    querySelector(s) { return (kids[s] ??= mk()); }, querySelectorAll() { return []; }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } }; };
  globalThis.addEventListener = (t, f) => { (keys[t] ??= []).push(f); }; globalThis.removeEventListener = () => {};
  globalThis.document = { createElement: (t) => mk(t), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: mk('body'), head: mk('head'), documentElement: mk('html'), activeElement: null, addEventListener() {}, removeEventListener() {} };
  try {
    const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
    const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
    const sim = createTessie({ seed: 1, depthAt: () => 40 });
    const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
    const storage = store(), lean = createLeanSkipper({ storage }), h = hintWith(lean);
    const services = { get: (k) => (k === 'hint' ? h : null), provide() {} };
    const P = createTessiePlayer({ plugin, B, depthAt: () => 40, touch: () => false, veil: () => {}, storage: null, services: () => services });
    sim.ambush(30, -40, Math.PI / 2, TESSIE.U); sim.hunt(false);
    for (let k = 0; k < 240; k++) sim.step(1 / 30, { playing: true, boat: { x: 0, z: 0, heading: 0, speed: 0 }, view: { x: 0, z: 20, yaw: 0, hHalf: 0.6 } });
    P.camera(1 / 30, { pos: [0, 3, 20], target: [0, 1, 0], fov: 55 });
    P.swap.step(1 / 30, { on: true, shown: true, distM: 50 });
    assert.ok(P.pill, 'she shows herself: the swap window is open');
    const kd = (keys.keydown ?? [])[0]; assert.ok(kd, 'the capture key listener');
    kd({ code: 'KeyT', repeat: false, preventDefault() {}, stopImmediatePropagation() {} });
    assert.equal(P.as, 'tessie', 'T swaps you in');
    assert.ok(lean.state.seen.includes('tip.tessie.be'), 'the line retired for good');
    assert.ok(html.length > 0, 'her DOM was built');
    for (const s of html) assert.doesNotMatch(s, /tp-be|Be Tessie/, 'no pill');
  } finally { delete globalThis.document; delete globalThis.addEventListener; delete globalThis.removeEventListener; }
});

// A late line (a slow machine, a busy skipper): the line can wait in the lean queue until she is nearly gone. Once it shows, T read off
// it must still swap for SWAP.readS, then the window closes as before. (The page test met this under load: the line up, T ignored.)
test('a late line: T read off it swaps for readS after it shows, though her own window would have closed', () => {
  const DT = 1 / 30;
  const mk = (tag = 'div') => { const kids = {}; return { tagName: tag.toUpperCase(), dataset: {}, style: {}, hidden: false, children: [], innerHTML: '',
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, hasAttribute() { return false; },
    appendChild(c) { return c; }, prepend() {}, append() {}, after() {}, before() {}, replaceChildren() {}, insertBefore(c) { return c; }, remove() {}, matches() { return false; }, setPointerCapture() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; },
    querySelector(s) { return (kids[s] ??= mk()); }, querySelectorAll() { return []; }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } } }; };
  // one session: her sighting from its first frame (?tessie=now), the skipper busy until freeAt s, then T pressed pressAfter s after the line shows
  const run = ({ freeAt, pressAfter, until = 40 }) => {
    const keys = {};
    globalThis.addEventListener = (t, f) => { (keys[t] ??= []).push(f); }; globalThis.removeEventListener = () => {};
    globalThis.document = { createElement: (t) => mk(t), getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: mk('body'), head: mk('head'), documentElement: mk('html'), activeElement: null, addEventListener() {}, removeEventListener() {} };
    try {
      const wind = { pattern: null, base: { dirDeg: 200, speedMs: 6 }, setLevel() { return 1; }, sample(x, z, t) { const v = steadyWind(6, 200)(x, z, t); return { vx: v.vx, vz: v.vz }; } };
      const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
      const sim = createTessie({ seed: 1, depthAt: () => 40 });
      const plugin = { sim, render: { ready: true }, playing: false, revenge: null, boatFor: null, playDip: 1 };
      let t = 0;
      const lean = createLeanSkipper({ storage: store(), busy: () => t < freeAt }), h = hintWith(lean);
      const services = { get: (k) => (k === 'hint' ? h : null), provide() {} };
      const P = createTessiePlayer({ plugin, B, depthAt: () => 40, touch: () => false, veil: () => {}, storage: null, services: () => services });
      const b0 = { x: B.state.x, z: B.state.z, heading: 0, speed: 0 }, view = { x: b0.x, z: b0.z + 20, yaw: 0, hHalf: 0.6 };
      sim.now(11, { boat: b0, view });
      let shownAt = null, closedAt = null, pillAtPress = null, wasUp = false, endAt = null;
      for (; t < until && P.as === 'boat'; t += DT) {
        lean.update(DT);
        sim.step(DT, { playing: true, boat: b0, view }); P.step(DT); P.camera(DT, { pos: [b0.x, 3, b0.z + 20], target: [b0.x, 1, b0.z], fov: 55 });
        if (P.pill) wasUp = true; else if (wasUp && endAt == null) endAt = t;
        if (shownAt == null && h.shown.some((l) => l.kind === BE_LINE.kind)) shownAt = t;
        if (shownAt != null && closedAt == null && !P.pill) closedAt = t;
        if (pressAfter != null && shownAt != null && t >= shownAt + pressAfter) {
          pillAtPress = P.pill;
          for (const f of keys.keydown ?? []) f({ code: 'KeyT', repeat: false, preventDefault() {}, stopImmediatePropagation() {} });
          break;
        }
      }
      return { shownAt, closedAt, pillAtPress, endAt, as: P.as };
    } finally { delete globalThis.document; delete globalThis.addEventListener; delete globalThis.removeEventListener; }
  };
  // her own window, no line (the skipper busy all along): it closes a few seconds after she goes under
  const own = run({ freeAt: Infinity, pressAfter: null });
  assert.equal(own.shownAt, null, 'busy throughout: no line');
  assert.ok(own.endAt > 18 && own.endAt < 20, `her own window closes at ${own.endAt?.toFixed(2)} s`);
  // the late line: the skipper frees up 1.2 s before her window would close; T pressed 3 s after the line shows, past that close
  const late = run({ freeAt: 17.8, pressAfter: 3 });
  assert.ok(late.shownAt != null && late.shownAt < own.endAt && late.shownAt + 3 > own.endAt, `the late line shows, the press falls past her own close (${late.shownAt?.toFixed(2)} s)`);
  assert.equal(late.pillAtPress, true, `the window stays open after the line (shown at ${late.shownAt?.toFixed(2)} s)`);
  assert.equal(late.as, 'tessie', 'T read off the late line swaps her in');
  // and the hold ends: no press, the window closes about readS after the line
  const idle = run({ freeAt: 17.8, pressAfter: null });
  assert.ok(idle.closedAt != null && idle.closedAt - idle.shownAt <= SWAP.readS + 0.2 && idle.closedAt - idle.shownAt >= SWAP.readS - 0.2, `closed ${(idle.closedAt - idle.shownAt).toFixed(2)} s after the line`);
});
