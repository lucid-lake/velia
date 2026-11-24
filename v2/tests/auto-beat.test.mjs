// AUTO (the NAV button) beats to an upwind target and runs to a downwind one (owner, 2026-11-17: "I didn't see AUTO zigzag to reach an
// upwind target"; v2/sim/beat.js BeatSkipper, v2/sim/autoNav.js): on the whole-lake chart in Sail's own wind (the level-3 day with
// the experienced sailor's shifts), no input: a mark dead upwind is reached by a zigzag of ≥ 2 tacks with boards of 50 to 120 s and a
// VMG near the polar's best; a mark 20° off the wind too; a mark dead downwind by broad reaches and gybes; a big wind shift re-plans
// (a header tacks her); the pilot says the beat's line once at the first tack and the assist key shows the tack lit.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { OUT } from '../../tools/v2-plan-bake.mjs';
import { decodePlanGrid, planChart } from '../ui/planChart.js';
import { chartInputs } from '../cruise/chartRows.js';
import { createAutoNav } from '../sim/autoNav.js';
import { BEAT } from '../sim/beat.js';
import { createBoatSim, waterFor } from '../sim/boat.js';
import { createPilot, PILOT_SAY } from '../ui/autopilot.js';
import { createAssist } from '../ui/assist.js';
import { chillWorld } from '../../src/modes/chill/sim.js';
import { CHILL } from '../../src/sim/modes/chill/params.js';
import { WindField } from '../../src/sim/wind.js';
import { sailWindOptions } from '../sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';
import { polarTargets } from '../../src/sim/ai/skipper.js';

const WORLD = JSON.parse(readFileSync(new URL('../cruise/chartWorld.json', import.meta.url), 'utf8'));
const chart = planChart(decodePlanGrid(new Uint8Array(gunzipSync(readFileSync(OUT)))), chartInputs(WORLD));
const W = chillWorld({ seed: 1, hour: parseFloat(CHILL.hour) });
const MID = [8000, -12000];   // mid-lake: open water every way for 2 km
const DEG = Math.PI / 180, wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function sailBoat({ wind = null, profile = 'sail' } = {}) {
  const start = { x: MID[0], z: MID[1], headingDeg: 0, speed: 2.5 };
  const w = wind ?? new WindField({ seed: 1, bay: CURRENT_WATERS.windBay, ...sailWindOptions({}, { hour: 13, start }), sailShifts: profile });
  const B = createBoatSim({ water: waterFor(() => 0), heightAt: W.terrain.heightAt, wind: w, start });
  for (let i = 0; i < 120; i++) B.step(1 / 60, null, 1 / 60);
  return B;
}
// a mark `dist` m off, `offDeg` from the wind's eye (180: dead downwind)
function markFrom(B, offDeg, dist) {
  const s = B.phys.state, a = s.heading + s.trueWind.angle + offDeg * DEG;
  return { x: s.x + Math.sin(a) * dist, z: s.z - Math.cos(a) * dist, name: 'Mark' };
}
// sail with no input until AUTO lets go at the mark (or maxS): the manoeuvres (t, kind, why), the boards between them, the VMG on boards
function sail(B, A, maxS) {
  const ev = []; let lt = 0, lg = 0, vS = 0, vN = 0, i = 0;
  for (; i < 60 * maxS && A.on; i++) {
    B.step(1 / 60, null, 1 / 60);
    const t = i / 60, s = B.phys.state;
    if (A.tacks !== lt || A.gybes !== lg) { ev.push({ t, kind: A.tacks !== lt ? 'tack' : 'gybe', why: A.skipper?.rep.why ?? null }); lt = A.tacks; lg = A.gybes; }
    if (A.beating && !A.turning && i % 30 === 0) { vS += s.sog * Math.cos(Math.abs(s.trueWind.angle)); vN++; }
  }
  const boards = ev.slice(1).map((e, k) => e.t - ev[k].t);
  return { ev, boards, vmg: vN ? vS / vN : 0, t: i / 60 };
}

test('AUTO to a mark dead upwind beats there: a zigzag of ≥ 2 tacks, boards of 50 to 120 s, VMG near the polar\'s best, and she stops at the mark', () => {
  const B = sailBoat(), tg = markFrom(B, 0, 900), A = createAutoNav({ B, chart });
  assert.equal(A.engage(tg).ok, true);
  const r = sail(B, A, 700);
  assert.equal(A.on, false, `she reached the mark in ${r.t.toFixed(0)} s (${Math.round(A.distance() ?? -1)} m left)`);
  assert.ok(Math.hypot(B.phys.state.x - tg.x, B.phys.state.z - tg.z) < 110, 'at the mark');
  assert.ok(r.ev.filter((e) => e.kind === 'tack').length >= 2, `tacks: ${r.ev.map((e) => `${e.t.toFixed(0)} s ${e.why}`).join(', ')}`);
  assert.ok(r.ev[0].t >= 30, `the first board sailed (first tack at ${r.ev[0].t.toFixed(0)} s, not at once)`);
  const mid = r.boards.filter((_, k) => !['layline', 'hazard'].includes(r.ev[k + 1].why));
  assert.ok(mid.every((b) => b >= 45 && b <= BEAT.legMaxS + 15), `boards inside the cone 45 to ${BEAT.legMaxS + 15} s: ${r.boards.map((b) => b.toFixed(0)).join(', ')}`);
  const best = polarTargets(B.phys.state.trueWind.speed).up.vmg * 0.514444;
  assert.ok(r.vmg >= 0.8 * best, `VMG on the boards ${r.vmg.toFixed(2)} m/s, the polar's best ${best.toFixed(2)}`);
  B.step(1 / 60, null, 1 / 60);
  assert.ok(!B.driven, 'at the mark the navigator lets go (the pilot holds the heading she has)');
});

test('AUTO to a mark 20° off the wind: close-hauled, a tack at the layline, and there', () => {
  const B = sailBoat(), tg = markFrom(B, 20, 800), A = createAutoNav({ B, chart });
  assert.equal(A.engage(tg).ok, true);
  const r = sail(B, A, 650);
  assert.equal(A.on, false, `there in ${r.t.toFixed(0)} s`);
  assert.ok(r.ev.filter((e) => e.kind === 'tack').length >= 1, `a tack (${r.ev.map((e) => `${e.t.toFixed(0)} s ${e.why}`).join(', ')})`);
});

test('AUTO to a mark dead downwind: broad reaches and gybes (no dead run), and there', () => {
  const B = sailBoat(), tg = markFrom(B, 180, 800), A = createAutoNav({ B, chart });
  assert.equal(A.engage(tg).ok, true);
  let deep = 0, n = 0;
  const ev = []; let lg = 0;
  for (let i = 0; i < 60 * 600 && A.on; i++) {
    B.step(1 / 60, null, 1 / 60);
    if (A.gybes !== lg) { ev.push(i / 60); lg = A.gybes; }
    if (i > 60 * 30 && i % 60 === 0 && !A.turning) { n++; if (Math.abs(B.phys.state.trueWind.angle) > 170 * DEG) deep++; }
  }
  assert.equal(A.on, false, 'there');
  assert.ok(ev.length >= 1, `gybes at ${ev.map((t) => t.toFixed(0)).join(', ')} s`);
  assert.ok(deep / n < 0.15, `a dead run (TWA over 170°) ${(100 * deep / n).toFixed(0)} % of the time`);
});

test('a big wind shift re-plans: a header of 25° tacks her within a minute; the pilot\'s beat line once, the key lit while she tacks', () => {
  // a steady 6 m/s from the north, turned 25° against her board at t = 150 s over 10 s
  let shiftAt = null, sign = 0;
  const fromAt = (t) => (shiftAt == null ? 0 : sign * 25 * DEG * Math.min(1, Math.max(0, (t - shiftAt) / 10)));
  const wind = { sample: (x, z, t) => { const f = fromAt(t), S = 6; return { vx: -Math.sin(f) * S, vz: Math.cos(f) * S, speed: S, dirDeg: f / DEG }; } };
  const B = sailBoat({ wind });
  const tg = markFrom(B, 0, 1600), A = createAutoNav({ B, chart });
  const lines = [], tips = [];
  const P = createPilot({ B, target: () => tg, nav: () => A, say: (t) => lines.push(t), tip: (id, t) => tips.push([id, t]) });
  const assist = createAssist({ B, pilotTurn: () => P.turning });
  P.load();   // the navigator now (in play it loads at the first NAV with a target)
  return Promise.resolve().then(() => {
    P.update(); assert.equal(P.auto(), 'to');
    let lit = 0, tackT = [], lt = 0, replans0 = null;
    for (let i = 0; i < 60 * 220; i++) {
      const t = B.sim.t;
      if (shiftAt == null && t > 150 && !A.turning) { shiftAt = t; sign = -A.skipper.side; replans0 = A.replans; }   // a backing wind heads a starboard board (+1)
      assist.update(1 / 60, {}); B.step(1 / 60, null, 1 / 60); P.update();
      if (assist.lit && P.turning) lit++;
      if (A.tacks !== lt) { tackT.push([t, A.skipper.rep.why]); lt = A.tacks; }
    }
    assert.ok(shiftAt != null);
    assert.ok(A.replans > replans0, `the shift re-planned (${replans0} → ${A.replans})`);
    const after = tackT.filter(([t]) => t > shiftAt && t < shiftAt + 60);
    assert.ok(after.length >= 1, `a tack within 60 s of the header (tacks at ${tackT.map(([t, w]) => `${t.toFixed(0)} s ${w}`).join(', ')}; shift at ${shiftAt.toFixed(0)} s)`);
    assert.ok(lit > 30, `the key lit while she tacks (${lit} frames)`);
    assert.deepEqual(tips, [['beat', PILOT_SAY.beat]], 'the beat\'s line once, at the first tack');
  });
});
