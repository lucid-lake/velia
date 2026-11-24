// Regatta's guidance pass (owner 2026-11-16: "a first-time player doesn't know which side to round a mark, where the next mark is, or
// where the finish is"): one thing at a time on the water per phase (the segments drawn: the pre-start's leg 1 only, then the current
// leg and its faint "then" leg, the laylines near the mark only and only the one to tack on, the rounding gate on the side not to pass
// in port's or starboard's colour, the finish alone on the last leg), the marks numbered 1 … F with the laps, the watch's leg line, the
// coach without its step count, and the fly-over (skippable, once a course a session, never with reduce motion, the race held for it).
// The browser half: v2/tests/pages/regatta.page.mjs (the watch's words, the tags, the card).
import test from 'node:test';
import assert from 'node:assert/strict';
import { courseFor, loadCourse, snapCourse } from '../../src/sim/race/course.js';
import { steadyWind } from '../../src/sim/boat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { courseToWind, ZONE_M } from '../regatta/geometry.js';
import { createSegmentWriter, buildRaceLines, INK, LAY, LEG, WIDTH, laylinesShown, gateInk } from '../regatta/lines.js';
import { markNumbers, legMark, legLine, gateArc, GATE, ROUND_SYMBOL } from '../regatta/marks.js';
import { createCoach } from '../regatta/coach.js';
import { watchLines } from '../regatta/ui.js';
import { createFlyover, flyoverWanted, FLY } from '../regatta/flyover.js';
import { createRegatta } from '../regatta/index.js';
import { targetOf, createBeacon } from '../sim/waymark.js';
import { SEG_FLOATS } from '../render/raceLines.js';

const DEG = Math.PI / 180;
const pk = (c) => ((Math.round(c[0] * 255) & 255) | ((Math.round(c[1] * 255) & 255) << 8) | ((Math.round(c[2] * 255) & 255) << 16) | ((Math.round(c[3] * 255) & 255) << 24)) >>> 0;
const C1 = courseToWind(courseFor('tahoe-emerald', 'island-sprint'), 210, { loadCourse, snapCourse, scale: 0.35 });
const C2 = courseToWind(courseFor('tahoe-emerald', 'twice-round'), 210, { loadCourse, snapCourse, scale: 0.35 });
const L = C1.line, M1 = C1.legs[0].to, M2 = C1.legs[1].to;
// the segments as { a, b, col, w, dash, far }
function segs(pic) {
  const W = createSegmentWriter(), n = buildRaceLines(W, pic), out = [];
  for (let i = 0; i < n; i++) { const o = i * SEG_FLOATS; out.push({ a: [W.f32[o], W.f32[o + 2]], ay: W.f32[o + 1], b: [W.f32[o + 4], W.f32[o + 6]], by: W.f32[o + 5], w: W.f32[o + 3], col: W.u32[o + 8], dash: W.f32[o + 9], phase: W.f32[o + 10], far: W.f32[o + 11] >= 2 }); }
  return out;
}
const near = (p, q, e = 0.5) => Math.hypot(p[0] - q[0], p[1] - q[1]) < e;
const onSeg = (s, a, b) => near(s.a, a) && near(s.b, b);
const dashed = (pic) => segs(pic).filter((s) => s.dash > 0 && s.ay === 0 && s.by === 0);

// ---------------- the water, one thing at a time ----------------
test('the pre-start: the start line and its posts, the ghost, the stay-below guide, leg 1 dashed faint; no later leg, no layline, no zone', () => {
  const ghost = [L.centre[0] - L.up[0] * 30, L.centre[1] - L.up[1] * 30];
  const S = segs({ line: L, clock: -30, legs: C1.legs, leg: 0, ghost, path: [ghost[0] - 20, ghost[1]], laylines: { port: [M1, [M1[0] + 100, M1[1]]], stbd: [M1, [M1[0] - 100, M1[1]]] }, layTarget: 'port', layTargetM: 5, markM: 30,
    zone: { at: M1, r: ZONE_M, inside: false, rounding: 'port' }, gate: { at: M1, r: 39, rounding: 'port', a: 0 }, boat: [0, 0] });
  assert.ok(S.some((s) => onSeg(s, L.pin, L.committee) && s.col === pk(INK.cream)), 'the start line, cream');
  assert.equal(S.filter((s) => s.by === 7).length, 2, 'its two posts');
  assert.ok(S.some((s) => s.col === pk(INK.amber)), 'the ghost (amber)');
  const legs = S.filter((s) => s.dash === LEG.dashM);
  assert.equal(legs.length, 1, 'one leg'); assert.ok(onSeg(legs[0], C1.legs[0].from, M1) && legs[0].col === pk(INK.creamFaint), 'leg 1, dashed faint');
  assert.ok(!S.some((s) => s.far), 'no layline'); assert.ok(!S.some((s) => s.col === pk(INK.stbd) || s.col === pk(INK.port)), 'no gate');
  assert.ok(!S.some((s) => near(s.a, [M1[0] + ZONE_M, M1[1]], 2)), 'no zone ring');
});

test('racing: only the current leg (from the boat, cream, marching to the mark) and a faint "then" leg; the start line faint and unlit', () => {
  const boat = [M1[0] + 120, M1[1] + 200], base = { line: L, clock: 60, legs: C1.legs, leg: 0, boat, markM: 230 };
  const D = dashed(base);
  assert.equal(D.length, 2, `the current leg and the then leg (${D.length})`);
  const cur = D.find((s) => near(s.a, boat)), then = D.find((s) => onSeg(s, M1, M2));
  assert.ok(cur && near(cur.b, M1) && cur.col === pk(INK.cream) && cur.w === WIDTH.leg, 'the current leg: boat → mark 1, cream');
  assert.ok(then && then.col === pk(INK.creamFaint) && then.w < cur.w, 'then: mark 1 → mark 2, faint');
  assert.ok(!D.some((s) => onSeg(s, M2, L.centre)), 'no later leg');
  const line = segs(base).find((s) => onSeg(s, L.pin, L.committee));
  assert.equal(line.col, pk(INK.creamFaint), 'the start line faint');
  // the dashes march toward the mark at about 1 m/s: the phase moves by the time × LEG.marchMs (mod one dash period)
  const ph = (t) => dashed({ ...base, march: t }).find((s) => near(s.a, boat)).phase, P = 2 * LEG.dashM;
  const d = (((ph(0) - ph(1)) % P) + P) % P;
  assert.ok(Math.abs(d - LEG.marchMs) < 1e-4, `1 s moves the dashes ${d.toFixed(3)} m toward the mark`);
  // the coach's nextLeg cue lights the then leg amber (index.js holds it for LEG.thenLitS); a phone draws no then leg
  assert.equal(dashed({ ...base, thenLit: true }).find((s) => onSeg(s, M1, M2)).col, pk(INK.amber));
  assert.equal(LEG.thenLitS, 3);
  assert.equal(dashed({ ...base, compactScreen: true }).length, 1, 'a compact screen: the current leg only');
  // the leg after mark 2 goes to the finish: its then leg is mark 2 → the line's middle
  assert.ok(dashed({ ...base, leg: 1, boat: M1 }).some((s) => onSeg(s, M2, L.centre)));
});

test('the laylines: only near the mark (2.5 zone radii) or near the one to tack on, only that one, amber; Pro sees the other, cream', () => {
  const lay = { port: [M1, [M1[0] + 300, M1[1] + 300]], stbd: [M1, [M1[0] - 300, M1[1] + 300]] };
  const base = { line: L, clock: 60, legs: C1.legs, leg: 0, laylines: lay, boat: [0, 0], aids: { laylines: true, level: 'beginner' } };
  assert.equal(LAY.showM, 2.5 * ZONE_M);
  assert.deepEqual(laylinesShown({ ...base, layTarget: 'port', layTargetM: 200, markM: 300 }), [], 'far: none');
  assert.deepEqual(laylinesShown({ ...base, layTarget: 'port', layTargetM: 200, markM: LAY.showM - 1 }), ['port'], 'near the mark: the target');
  assert.deepEqual(laylinesShown({ ...base, layTarget: 'stbd', layTargetM: LAY.showM - 1, markM: 300 }), ['stbd'], 'near the line: the target');
  assert.deepEqual(laylinesShown({ ...base, layTarget: 'port', layTargetM: 10, markM: 50, aids: { laylines: true, level: 'pro' } }).sort(), ['port', 'stbd'], 'Pro: both');
  assert.deepEqual(laylinesShown({ ...base, layTarget: 'port', layTargetM: 10, markM: 50, aids: { laylines: false, level: 'pro' } }), [], 'Pro without its option: none');
  assert.deepEqual(laylinesShown({ ...base, layTarget: 'port', layTargetM: 10, markM: 50, finish: true }), [], 'the last leg: none');
  const S = segs({ ...base, layTarget: 'port', layTargetM: 200, markM: 50 }).filter((s) => s.far);
  assert.equal(S.length, 1); assert.equal(S[0].col, pk(INK.amber), 'the one to tack on is amber');
});

test('the rounding gate: an arc at 1.5 zone radii on the side not to pass, green leaving to port, red to starboard, arrowheads, never across her line', () => {
  assert.equal(gateInk('port'), INK.stbd); assert.equal(gateInk('starboard'), INK.port);
  assert.ok(INK.stbd[1] > 0.6 && INK.stbd[0] < 0.3, 'green'); assert.ok(INK.port[0] > 0.7 && INK.port[1] < 0.3, 'red');
  // she is due south of the mark (bearing angle π/2; x east, z south) heading north: leaving it to port she passes east (angle 0), so
  // the gate sits west (angle π); to starboard, east
  const p = gateArc(Math.PI / 2, 'port'), s = gateArc(Math.PI / 2, 'starboard');
  assert.ok(Math.abs(Math.cos(p.mid) + 1) < 1e-9, `port: the gate west (${p.mid})`); assert.ok(Math.abs(Math.cos(s.mid) - 1) < 1e-9, `starboard: the gate east (${s.mid})`);
  for (const [g, r] of [[p, 'port'], [s, 'starboard']]) {
    const at = [100, -500], R = GATE.zoneK * ZONE_M, a = Math.PI / 2;
    const S = segs({ line: L, clock: 60, legs: C1.legs, leg: 0, boat: [100, -300], markM: 200, gate: { at, r: R, rounding: r, a } }).filter((x) => x.col === pk(gateInk(r)));
    const arc = S.filter((x) => Math.abs(Math.hypot(x.a[0] - at[0], x.a[1] - at[1]) - R) < 0.1 && Math.abs(Math.hypot(x.b[0] - at[0], x.b[1] - at[1]) - R) < 0.1);
    assert.equal(arc.length, 24, `${r}: the arc`); assert.equal(S.length - arc.length, 2 * GATE.heads, `${r}: ${GATE.heads} arrowheads`);
    // the arc's angles: within its sweep of the not-to-pass side, clear of her own line (a) and of the side she passes (a + sgn π/2)
    const ang = (q) => Math.atan2(q[1] - at[1], q[0] - at[0]), diff = (x, y) => Math.abs(Math.atan2(Math.sin(x - y), Math.cos(x - y)));
    for (const x of arc) for (const q of [x.a, x.b]) {
      assert.ok(diff(ang(q), g.mid) <= GATE.sweep / 2 + 1e-6, `${r}: inside the sweep`);
      assert.ok(diff(ang(q), a) >= (Math.PI - GATE.sweep) / 2 - 1e-6, `${r}: never across her line in`);
      assert.ok(diff(ang(q), a + g.sgn * Math.PI / 2) > Math.PI / 2, `${r}: never on her side`);
    }
    assert.ok(Math.abs(GATE.sweep - 0.75 * Math.PI) < 1e-12 && GATE.sweep < Math.PI, 'a short arc, not a full half');
  }
  // the zone ring stays cream, amber inside; no gate drawn before the gun or on the last leg
  const z = { at: M1, r: ZONE_M, inside: false, rounding: 'port' }, g = { at: M1, r: 39, rounding: 'port', a: 0 };
  assert.ok(segs({ line: L, clock: 60, legs: C1.legs, leg: 0, boat: [0, 0], zone: z }).some((x) => x.col === pk(INK.cream) && Math.abs(Math.hypot(x.a[0] - M1[0], x.a[1] - M1[1]) - ZONE_M) < 0.1));
  assert.ok(segs({ line: L, clock: 60, legs: C1.legs, leg: 0, boat: [0, 0], zone: { ...z, inside: true } }).some((x) => x.col === pk(INK.amber) && Math.abs(Math.hypot(x.a[0] - M1[0], x.a[1] - M1[1]) - ZONE_M) < 0.1));
  assert.ok(!segs({ line: L, clock: -10, legs: C1.legs, leg: 0, gate: g }).some((x) => x.col === pk(INK.stbd)), 'no gate before the gun');
  assert.ok(!segs({ line: L, clock: 200, legs: C1.legs, leg: 2, finish: true, gate: g, zone: z, boat: [0, 0] }).some((x) => x.col === pk(INK.stbd)), 'no gate on the last leg');
});

test('the last leg: the finish line only (the chequer at 6 px), the pin\'s cream post, the leg dashed to the line\'s middle; no mark, no layline, no zone', () => {
  const boat = [M2[0] - 40, M2[1] - 40];
  const S = segs({ line: L, clock: 300, legs: C1.legs, leg: 2, finish: true, boat, laylines: { port: [M1, [M1[0] + 9, M1[1]]], stbd: [M1, [M1[0] - 9, M1[1]]] }, layTarget: 'port', layTargetM: 1, markM: 1,
    zone: { at: M2, r: ZONE_M, inside: false, rounding: 'port' } });
  const fin = S.filter((s) => onSeg(s, L.pin, L.committee));
  assert.deepEqual(fin.map((s) => [s.w, s.col]).sort(), [[WIDTH.finish, pk(INK.cream)], [WIDTH.finish - 2, pk(INK.navy)]].sort(), 'the finish: cream under navy dashes, 6 px');
  assert.equal(WIDTH.finish, 6);
  assert.ok(!fin.some((s) => s.col === pk(INK.creamFaint)), 'no faint start line beside it');
  const posts = S.filter((s) => s.by > 5);
  assert.equal(posts.length, 1, 'one post'); assert.ok(near(posts[0].a, L.pin) && posts[0].col === pk(INK.cream), 'the pin\'s post, cream (the committee boat has the beacon\'s pillar)');
  const D = S.filter((s) => s.dash === LEG.dashM);
  assert.equal(D.length, 1); assert.ok(near(D[0].a, boat) && near(D[0].b, L.centre), 'the leg to the line\'s middle');
  assert.ok(!S.some((s) => s.far), 'no layline'); assert.ok(!S.some((s) => Math.abs(Math.hypot(s.a[0] - M2[0], s.a[1] - M2[1]) - ZONE_M) < 0.1), 'no zone');
});

// ---------------- the marks' numbers and the watch ----------------
test('the marks numbered by order 1, 2 … F, the laps named; the watch\'s first line names the leg, the mark and the side', () => {
  assert.deepEqual([...markNumbers(C1)], [['W', 1], ['I', 2]]);
  assert.deepEqual(C1.legs.map((_, i) => legMark(C1, i).text), ['1', '2', 'FINISH']);
  assert.deepEqual(C2.legs.map((_, i) => legMark(C2, i).text), ['1', '2', '1 (lap 2)', '2 (lap 2)', 'FINISH']);
  assert.deepEqual(C2.legs.map((_, i) => legMark(C2, i).num), ['1', '2', '1', '2', 'F']);
  const bay = courseFor('tahoe-emerald', 'bay-tour');
  assert.deepEqual([...markNumbers(bay).values()], [1, 2, 3, 4]);
  assert.equal(legLine(C1, 0), 'Leg 1 of 3 · Mark 1 · round to port');
  assert.equal(legLine(C1, 0, true), `Leg 1/3 · ${ROUND_SYMBOL.port} 1`);
  assert.equal(legLine(C1, 2), 'Leg 3 of 3 · Finish'); assert.equal(legLine(C1, 2, true), 'Leg 3/3 · F');
  assert.equal(legLine(C2, 3), 'Leg 4 of 5 · Mark 2 (lap 2) · round to port');
  const stb = { ...C1, legs: C1.legs.map((g) => (g.rounding ? { ...g, rounding: 'starboard' } : g)) };
  assert.equal(legLine(stb, 1), 'Leg 2 of 3 · Mark 2 · round to starboard'); assert.equal(legLine(stb, 1, true), `Leg 2/3 · ${ROUND_SYMBOL.starboard} 2`);
  // the watch: line 1 the leg line, line 2 only the amber cue (no "W 296 m", no lap line, no "Head for the finish")
  const w = watchLines({ clock: 60, status: 'racing', line: { distM: -100 }, next: { text: legLine(C1, 0) } });
  assert.deepEqual([w.l1, w.l2], ['Leg 1 of 3 · Mark 1 · round to port', '']);
  const c = watchLines({ clock: 60, status: 'racing', line: { distM: -100 }, next: { text: legLine(C1, 0) }, layline: { side: 'port', m: 30 } });
  assert.equal(c.l2, 'Tack line in 30 m'); assert.equal(c.l2amber, true);
  assert.equal(watchLines({ clock: 200, status: 'racing', next: { text: legLine(C1, 2) } }).l2, '');
});

test('one voice per fact: the coach\'s card says "Coach" (no step count) and names the marks by number', () => {
  const C = createCoach({ coach: 'all' });
  const sit = { clock: -40, status: 'prestart', ocs: false, legKind: null, leg: 0, finishLeg: false, lay: null, inZone: false, rounding: 'port', next: null, target: null, tacked: false };
  const line = C.update(-40, sit);
  assert.equal(line.kind, 'coach'); assert.equal(line.sub, 'Coach'); assert.doesNotMatch(line.sub, /step|of \d/);
  const C2c = createCoach({ coach: 'all' });
  C2c.update(10, { ...sit, clock: 10, status: 'racing' });
  const r = C2c.update(30, { ...sit, clock: 30, status: 'racing', inZone: true, legKind: 'beat', next: { id: 'I', num: '2' }, target: { id: 'W', num: '1' } });
  assert.equal(r?.id, 'rounding'); assert.match(r.text, /head for mark 2\.$/); assert.doesNotMatch(r.text, /\bI\b/);
});

// ---------------- the fly-over ----------------
test('the fly-over: wanted on a course\'s first race, never twice a session, never with reduce motion, an automated browser only with ?flyover=1', () => {
  const seen = new Set();
  assert.equal(flyoverWanted({ live: true, seen, key: 'island-sprint' }), true);
  seen.add('island-sprint');
  assert.equal(flyoverWanted({ live: true, seen, key: 'island-sprint' }), false, 'once a course a session');
  assert.equal(flyoverWanted({ live: true, seen, key: 'bay-tour' }), true, 'another course: again');
  assert.equal(flyoverWanted({ live: true, reduced: true, key: 'x' }), false, 'reduce motion: never');
  assert.equal(flyoverWanted({ live: true, webdriver: true, key: 'x' }), false, 'an automated browser: off');
  assert.equal(flyoverWanted({ live: true, webdriver: true, key: 'x', flags: { flyover: '1' } }), true, '?flyover=1 forces it');
  assert.equal(flyoverWanted({ live: true, key: 'x', flags: { flyover: '0' } }), false, '?flyover=0');
  assert.equal(flyoverWanted({ live: false, key: 'x' }), false, 'a capture: off');
});

test('the fly-over\'s path: about 4 s up the course, each mark lit in turn, eased out of the race camera and back, skippable', () => {
  const F = createFlyover({ course: C1 });
  assert.deepEqual(F.stops.map((s) => s.id), ['start', 'W', 'I']);
  const base = { pos: [L.centre[0], 7, L.centre[1] + 30], target: [L.centre[0], 0, L.centre[1]], fov: 50 };
  const lit = [], cams = [];
  let t = 0;
  while (!F.done && t < 10) { const c = F.update(1 / 30, base); t += 1 / 30; cams.push(c); if (F.mark != null && lit.at(-1) !== F.mark) lit.push(F.mark); }
  assert.ok(Math.abs(t - FLY.durS) < 0.1, `${t.toFixed(2)} s`);
  assert.deepEqual(lit, [1, 2], 'mark 1, then mark 2');
  assert.ok(cams.some((c) => c.pos[1] > 40), 'it rises over the course'); assert.ok(Math.abs(cams.at(-1).pos[1] - base.pos[1]) < 1, 'and lands back on the race camera');
  assert.ok(cams.every((c) => c.pos.every(Number.isFinite) && c.target.every(Number.isFinite)));
  const G = createFlyover({ course: C1 }); G.update(0.5, base); G.skip();
  assert.ok(G.done && G.mark == null && G.update(0.1, base) === base, 'skipped: the race camera at once');
});

const fakeLines = () => ({ stats: { active: false, count: 0 }, setActive(on) { this.stats.active = on; }, write(f, n) { this.stats.count = n; this.f = f.slice(0, n * SEG_FLOATS); } });
const fakeProps = () => ({ stats: { instances: 0 }, setActive() {}, begin() {}, put() {}, end() {} });
const memStore = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
function raceInNode(flags = {}) {
  const wind = { sample: (x, z, t) => { const v = steadyWind(6, 210)(x, z, t); return { vx: v.vx, vz: v.vz }; }, base: { dirDeg: 210, speedMs: 6 }, setLevel() { return 1; } };
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: () => -40, wind, headless: true });
  const clock = { t: 0, hourUnwrappedAt: () => 15, setHour: () => {} };
  const lines = fakeLines();
  const R = createRegatta({ B, windField: wind, clock, terrain: { field: { height: () => -40 } }, flags: { seed: '1', course: 'short', ...flags }, P: { headless: true }, lines, props: fakeProps(), store: memStore(), persist: false });
  return { R, B, lines };
}
const VP = Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

test('the fly-over in a race: the race waits at −0:45 while it plays, the beacon lights each mark then the committee boat, a steer skips it', async () => {
  const { R, B } = raceInNode({ flyover: '1' });
  await R.enter();
  assert.ok(R.fly && !R.fly.done, 'the first race of the course: the fly-over');
  const keys = [];
  const base = { pos: [B.state.x, 7, B.state.z + 20], target: [B.state.x, 0, B.state.z], fov: 50 };
  for (let i = 0; i < 60; i++) { R.camera(1 / 30, base); R.settle(1 / 30); const tg = targetOf({ race: R.beaconView() }); if (tg && keys.at(-1) !== tg.key) keys.push(tg.key); }
  assert.ok(R.state().clock <= -44.9, `held at ${R.state().clock}`);
  assert.ok(keys.length >= 2 && keys[0].includes('W') && keys.some((k) => k.includes('|I|')), `the pillar from mark to mark (${keys.join(', ')})`);
  R.beforeStep({ steer: 0.5 });   // a steer: skipped
  R.settle(0.1);
  assert.equal(R.fly, null, 'skipped and gone');
  R.settle(3); assert.ok(R.state().clock > -44, `the race runs again (${R.state().clock})`);
  // Race again: no fly-over (once a course a session); Show course plays it again before the gun
  R.restart(); assert.equal(R.fly, null);
  R.flyover(); assert.ok(R.fly, 'Show course');
});

test('the beacon on the last leg stands on the committee boat; before it, on the next mark', async () => {
  const { R } = raceInNode({ flyover: '0' });
  await R.enter();
  assert.equal(R.fly, null, '?flyover=0');
  const v = R.beaconView(); assert.equal(v.target.mark, 'W', 'the pre-start: mark 1');
  // force the last leg: the view's leg on the finish
  const view = R.session.race.view;
  R.session.race.view = (id) => (id === 'me' ? { ...view(id), status: 'racing', leg: R.course.legs.length - 1, target: null } : view(id));
  const f = R.beaconView(); const L2 = R.course.line;
  assert.equal(f.target.mark, 'finish'); assert.ok(Math.abs(f.target.at.x - L2.committee[0]) < 1e-9 && Math.abs(f.target.at.z - L2.committee[1]) < 1e-9, 'the committee boat');
  R.session.race.view = view;
});

test('the race\'s picture in node: before the gun one leg, the gate and the then leg after it (segments written by the race)', async () => {
  const { R, lines } = raceInNode({ flyover: '0', autoplay: '1' });
  await R.enter();
  R.frame(VP, 1280, 720, 1 / 10);
  const legsIn = () => { const out = []; for (let i = 0; i < lines.stats.count; i++) { const o = i * SEG_FLOATS; if (lines.f[o + 9] === LEG.dashM) out.push(lines.f[o + 3]); } return out; };
  assert.equal(legsIn().length, 1, 'the pre-start: leg 1 only');
  R.settle(70); R.frame(VP, 1280, 720, 1 / 10);
  const v = R.session.race.view('me');
  assert.equal(v.status, 'racing');
  assert.equal(legsIn().length, 2, 'racing: the current leg and the then leg');
  const gateCols = new Set([pk(INK.stbd), pk(INK.port)]), u32 = new Uint32Array(lines.f.buffer, lines.f.byteOffset, lines.f.length);
  let gate = 0; for (let i = 0; i < lines.stats.count; i++) if (gateCols.has(u32[i * SEG_FLOATS + 8])) gate++;
  const b = R.session.boats.find((x) => x.id === 'me')?.phys?.state ?? null, inZone = b && Math.hypot(v.target.at.x - b.x, v.target.at.z - b.z) < ZONE_M;
  assert.ok(gate === 24 + 2 * GATE.heads || inZone, `the gate drawn (${gate})`);
});

test('the fly-over on a flying start: the race held at its own first clock, the boat held at her speed, the start runs after it', async () => {
  const { R, B } = raceInNode({ flyover: '1', handseed: '7', course: undefined });
  await R.enter({ deal: true });   // a dealt hand (a capture deals none by itself)
  assert.ok(R.session.flying, 'a dealt hand: the flying start');
  assert.ok(R.fly, 'the fly-over');
  const c0 = R.state().clock, v0 = B.phys.state.u;
  assert.ok(c0 > -20 && c0 < 0, `the flying start's first clock (${c0})`);
  for (let i = 0; i < 30; i++) R.settle(1 / 30);
  assert.ok(Math.abs(R.state().clock - c0) < 0.05, `held at ${c0} (${R.state().clock})`);
  assert.ok(B.phys.state.u > 0.5 * v0 && v0 > 0.5, `still at speed while held (${v0.toFixed(2)} → ${B.phys.state.u.toFixed(2)} m/s)`);
  R.beforeStep({ steer: 0.5 }); R.settle(0.1);
  assert.equal(R.fly, null);
  R.settle(2); assert.ok(R.state().clock > c0 + 1, `the countdown runs again (${R.state().clock})`);
});

// the beacon in a real race (owner 2026-11-16: "the beacon's arrival effect misleads the player into thinking the leg is done"): inside
// 50 m of mark 1 before the rounding the beam stays lit with no ring; the session's rounding plays the arrival at mark 1 and lights the
// next; the finish plays it on the crossing; the coach never says "arrived" or done before the rounding
test('the beacon in a race in node: lit through the approach to mark 1, the arrival on the rounding, the next lit, the finish on the crossing', async () => {
  const { R, B } = raceInNode({ flyover: '0', autoplay: '1' });
  await R.enter();
  const S = createBeacon(), dt = 0.2;
  let near50 = 0, roundedAt = null, arriveAt = null, nextLit = false, finishedAt = null, finishArrive = null, ringSeen = false, legAtArrive = null;
  for (let k = 0; k < 6000 && !finishArrive; k++) {
    R.settle(dt);
    const v = R.session.race.view('me'), b = B.state;
    const s = S.update(targetOf({ race: R.beaconView() }), b, dt);
    if (s.ring) ringSeen = true;
    const rounded1 = v.splits.length >= 1;
    if (!rounded1 && v.status === 'racing' && v.target?.at && Math.hypot(v.target.at.x - b.x, v.target.at.z - b.z) < 50) {
      near50++; assert.ok(s.phase === 'on' && s.arriveT < 0, `inside 50 m of mark 1 before the rounding the beam stays lit (${s.phase})`);
    }
    if (rounded1 && roundedAt == null) roundedAt = R.session.race.clock;
    if (s.phase === 'arrive' && arriveAt == null) { arriveAt = R.session.race.clock; legAtArrive = v.leg; }
    if (arriveAt != null && !nextLit && (s.phase === 'in' || s.phase === 'on') && s.key !== `race|W|0`) nextLit = s.key;
    if (v.status === 'finished' && finishedAt == null) finishedAt = R.session.race.clock;
    if (finishedAt != null && s.phase === 'arrive') finishArrive = R.session.race.clock;
  }
  assert.ok(near50 > 3, `she sailed inside 50 m of mark 1 before rounding it (${near50} samples)`);
  assert.ok(roundedAt != null && arriveAt != null && arriveAt >= roundedAt - 1e-6 && arriveAt - roundedAt <= dt + 1e-6, `the arrival on the rounding (rounded ${roundedAt}, arrival ${arriveAt})`);
  assert.equal(legAtArrive, 1, 'the arrival played as the race moved on to leg 2');
  assert.ok(nextLit && /^race\|/.test(nextLit), `then the next mark lit (${nextLit})`);
  assert.ok(finishedAt != null && finishArrive != null && finishArrive - finishedAt <= dt + 1e-6, `the finish's arrival on the crossing (${finishedAt}, ${finishArrive})`);
  assert.equal(ringSeen, false, 'no beacon ring in the race');
  // the coach: nothing about arriving or a leg done (its rounding line asks for the turn, inside the zone)
  for (const l of R.coach.log) assert.ok(!/arriv|leg done|you made it/i.test(l.text), `coach: "${l.text}"`);
});
