// Regatta's race step (refactor round 3 C4: cut out of index.js createRegatta; one shared state R).
// Each sim step while racing: beforeStep (a steer hands the helm back), afterStep (the session advanced, its events, the
// coach, the officer, the results card's timing), the race's situation for the coach, the shifts' coach, the box held behind
// the hub, settle (a capture) and the quality ladder's quiet moments (racing, quiet).
import { saluteDue } from './salute.js';
import { track } from '../../src/metrics.js';
import { raceFinished } from '../ui/engagement.js';
import { DT } from '../../src/sim/boat.js';
import { ZONE_M, laylineAhead, laylines, tackAngle } from './geometry.js';
import { LEG } from './lines.js';
import { roundRule, roundingCue } from './rounding.js';
import { legKind } from './coach.js';
import { TRIAL, splitDelta, splitWord, toFrame } from './events.js';
import { shiftOf, shiftTo } from './shifts.js';
import { legMark, markNumbers } from './marks.js';
import { DEG, PRO_MOMENTS, QUIET, RACE_CAM, RESULTS, ROUND_FX, SHIFT_COACH, rivalRef } from './tuning.js';

/** @param {object} R the Regatta's shared state (index.js createRegatta) */
export function installRaceStep(R) {
  const { B, mctx, onSalute, pic, placeRow, sit, stats, windFromAt } = R;
  // a steer (the keys, the strip) or the cockpit's wheel in the hand (helm: the station's rudder command, null when not held) hands the
  // helm back to the player
  function beforeStep(h, helm = null) {
    if (R.fly && (Math.abs(h?.steer ?? 0) > 0.05 || helm != null)) R.fly.skip();   // a steer skips the fly-over
    if (!R.on || R.hubOpen || !R.S?.helper) return;
    const steer = Math.abs(h?.steer ?? 0) > 0.05 || helm != null;
    if (steer) { if (helm != null) stats.wheel++; R.S.takeHelm(); B.ctl && (B.ctl.jibFree = false); if (!R.auto) B.drive(null); }   // the helper's let-fly jib back on its sheet (helper.js COAST)
  }
  function afterStep() {
    if (!R.on) return;
    if (R.hubOpen) { holdBox(); return; }   // the hub: the race held at −0:45, nothing advances
    if (R.fly?.done) R.endFly();
    if (R.fly && R.flyHold) { R.S.t = B.t; R.holdFly(); return; }   // the fly-over at the race's start: the race waits at its first clock
    stats.ticks += R.S.advanceTo(B.t);
    const ev = R.S.drain();
    if (ev.length) onEvents(ev);
    R.tickEvents = ev;
    if (R.S.place) R.placeStep();
    const r = R.S.race, v = r.view('me'), s = B.phys.state;
    const dt = R.lastClock == null ? 0 : Math.max(0, r.clock - R.lastClock);
    R.lastClock = r.clock;
    // a time trial: her path from the gun, every TRIAL.everyS of race clock, in the course's frame (kept with a best run)
    if (R.trial && r.clock >= R.trial.next && v.status !== 'finished' && R.trial.rec.length < TRIAL.maxPts) { const [a, u] = toFrame(R.course.line, s.x, s.z); R.trial.rec.push([a, u, +r.clock.toFixed(2)]); R.trial.next = Math.max(0, r.clock) + TRIAL.everyS; }
    stats.status = v.status; stats.clock = r.clock; stats.helper = R.S.helper;
    situation(r, v, s);
    R.review.sample(dt, { status: v.status, legKind: sit.legKind, leg: v.leg, x: s.x, z: s.z, heading: s.heading, u: s.u, twaSign: s.trueWind?.angle ?? 0,
      mark: v.target?.at ? [v.target.at.x, v.target.at.z] : null, windFrom: windFromAt(s.x, s.z), alpha: tackAngle(s.trueWind?.speed ?? 5, B.phys.vessel?.polar), inZone: sit.inZone });
    // the coach first (a step due now takes the card: the gun's line at 0:00), then the officer, who waits while a coach line is fresh
    // R4: the fleet's moments (a crossing, a place, the leader's rounding, the last leg, a gust) on the coach's quiet path; Pro hears
    // only its places, the leader and the last leg (its coach is off)
    mctx.rivals.length = 0; for (const b of R.S.rivals) mctx.rivals.push(rivalRef(b));
    mctx.me = s; mctx.order = r.order(); mctx.view = v; mctx.inZone = sit.inZone; mctx.finishLeg = sit.finishLeg; mctx.windFrom = R.S.windFrom; mctx.events = R.tickEvents;
    for (const id of mctx.order) mctx.progress[id] = r.view(id).progressM ?? 0;
    mctx.cardIdleS = r.clock - R.lastLineAt; mctx.markM = v.target?.at ? Math.hypot(v.target.at.x - s.x, v.target.at.z - s.z) : null; mctx.markName = v.target?.mark ?? null;
    for (const m of R.moments.update(r.clock, mctx)) {
      if (R.aids.coach === 'off' && !PRO_MOMENTS.has(m.id)) continue;
      R.coach.moment(m.text, m.s, m.giveWay ? 'giveWay' : m.id); stats.moments.push({ id: m.id, at: +r.clock.toFixed(1) }); if (stats.moments.length > 60) stats.moments.shift();
    }
    if (R.pattern && R.aids.coach !== 'off') shiftCoach(r, v, s);
    let line = R.coach.update(r.clock, sit);
    const call = R.officer.step(dt, { busy: R.coach.busy(r.clock) });
    if (call) { stats.calls.push(call.id); if (stats.calls.length > 20) stats.calls.shift(); R.coach.officer(call.text, r.clock, call.id); line = R.coach.update(r.clock, sit); }
    if (line && line !== R.lastLine) R.lastLineAt = r.clock;
    R.lastLine = line;
    stats.line = line ? { kind: line.kind, id: line.id } : null;
    const lit = line?.lit ?? [];
    if (lit.length !== pic.lit.size || lit.some((k) => !pic.lit.has(k))) { if (lit.includes('nextLeg') && !pic.lit.has('nextLeg')) R.thenUntil = R.realT + LEG.thenLitS; pic.lit = new Set(lit); R.lastKey = ''; }
    // the results card, a moment after she finishes (the winner's gap fills in as the others finish)
    // on the session's own clock (the race's clock stops once every boat is home: the last boat home, or alone in a time trial, would
    // never see her card)
    if (R.finishAt == null && r.done && R.result == null) R.finishAt = R.S.t - RESULTS.afterS;   // the race's time limit with her still out: the card says she did not finish
    if (R.finishAt != null && R.S.t - R.finishAt >= RESULTS.afterS + (R.salute?.shown ? RESULTS.saluteS * (R.aids.pace ?? 2) : 0) && (R.result == null || R.S.t - R.resultT >= 1)) { const firstCard = R.result == null; R.result = R.makeResult(r); if (firstCard) { track('regatta_finish', { place: R.result.place, level: R.level }); raceFinished(track, { finished: R.result.finished === true, place: R.hand?.place, event: R.result.event }); } R.resultT = R.S.t; stats.result = { place: R.result.place, medal: R.result.medal, tip: R.result.tip.id, time: R.result.time, gapS: R.result.gapS, title: R.result.title ?? null, gap: R.result.gap ?? null, tm: R.result.tmLine ?? null, event: R.result.event, cup: R.result.cup ? { sailed: R.result.cup.sailed, done: R.result.cup.done } : null }; R.ui?.results(R.result); R.ui?.picker(false); }   // made once per update (a time trial's best and a Cup's places are recorded on the first)
  }
  // the coach on the race's shifts: the day's pattern once after the gun, then a header on her tack on a beat ("tack onto the lift")
  function shiftCoach(r, v, s) {
    if (v.status !== 'racing') return;
    const sh = shiftOf(R.pattern.id);
    if (!R.shiftSaid.intro && r.clock >= SHIFT_COACH.introS) { R.shiftSaid.intro = true; R.coach.moment(sh.coach, 5, 'shiftIntro'); stats.shiftLines.push({ id: 'shiftIntro', at: +r.clock.toFixed(1) }); return; }
    if (R.pattern.id === 'steady' || sit.legKind !== 'beat' || r.clock - R.shiftSaid.at < SHIFT_COACH.everyS) return;
    const d = R.pattern.deg(B.t), from = windFromAt(s.x, s.z), x = from - s.heading, tack = Math.atan2(Math.sin(x), Math.cos(x)) > 0 ? 'stbd' : 'port';
    if (Math.abs(d) < SHIFT_COACH.deg || shiftTo(d, tack) !== 'header') return;
    R.shiftSaid.at = r.clock;
    R.coach.moment(`Headed ${Math.round(Math.abs(d))}°: tack onto the lift.`, 4, 'header'); stats.shiftLines.push({ id: 'header', at: +r.clock.toFixed(1), deg: +d.toFixed(1), tack });
  }
  // behind the hub the boat stays in her box (she drifts, so she is put back when she has moved a few metres or turned)
  function holdBox() {
    const s = B.phys.state, p = R.S.me0;
    if (Math.hypot(s.x - p.x, s.z - p.z) > 6 || Math.abs(Math.atan2(Math.sin(s.heading - p.heading), Math.cos(s.heading - p.heading))) > 0.5) B.place({ x: p.x, z: p.z, headingDeg: p.heading / DEG, speed: 0 });
  }
  // the race's situation for the coach: the leg's kind, the laylines ahead, the zone, a tack
  function situation(r, v, s) {
    sit.clock = r.clock; sit.status = v.status; sit.ocs = !!v.ocs || v.status === 'ocs'; sit.leg = v.leg; sit.flying = !!R.S.flying;
    const t = v.target, legs = R.course.legs, leg = legs[Math.min(v.leg, legs.length - 1)];
    sit.finishLeg = v.status === 'racing' && v.leg >= legs.length - 1;
    sit.legKind = v.status === 'racing' && leg ? legKind(leg.from, leg.to, windFromAt(leg.to[0], leg.to[1])) : null;
    if (sit.legKind === 'beat' && t?.at) {
      const m = [t.at.x, t.at.z], al = tackAngle(s.trueWind?.speed ?? 5, B.phys.vessel?.polar), lay = laylines(m, windFromAt(m[0], m[1]), al, R.layLen(m, al));
      sit.lay = laylineAhead(lay, s.x, s.z, s.heading);
    } else sit.lay = null;
    sit.inZone = v.status === 'racing' && !!t?.at && !t.gate && Math.hypot(s.x - t.at.x, s.z - t.at.z) < ZONE_M;   // a gate has no zone (no wide-rounding tip)
    sit.rounding = t?.rounding ?? 'port';
    // the game's rounding (rounding.js; Beginner and Club): the line crossed on the wrong side (the coach's "Go round mark 1"), and near
    // the mark not counted yet (the watch's "Round mark 1 →", the gate brightened); Pro's real rule has neither
    const rule = sit.finishLeg ? null : roundRule(R.aids.level), gd = v.status === 'racing' && v.guide?.k === v.leg ? v.guide : null;
    sit.wrongSide = !!rule && !!gd?.wrong;
    sit.cue = !!rule && !!gd && (gd.wrong || roundingCue(gd, rule)); stats.cue = sit.cue;
    const nextLeg = legs[Math.min(v.leg + 1, legs.length - 1)], nextMark = nextLeg && R.course.byId[nextLeg.toId];
    sit.next = v.leg + 1 < legs.length ? { id: nextLeg.toId, num: legMark(R.course, v.leg + 1).text, colour: nextMark?.colour ?? null } : null;   // after this leg's mark
    sit.target = leg ? { id: leg.toId, num: legMark(R.course, v.leg).text, colour: R.course.byId[leg.toId]?.colour ?? null } : null;          // this leg's mark
    const sign = Math.sign(s.trueWind?.angle ?? 0);
    sit.tacked = !!sign && !!R.lastSign && sign !== R.lastSign;
    if (sign) R.lastSign = sign;
  }
  function onEvents(ev) {
    stats.events += ev.length;
    // Pass the Channel: the player's finish fires the barges' salute (once); a page without fireworks (a phone) has the horn only
    if (R.S.place && saluteDue(ev, { hooks: placeRow()?.hooks ?? [], fired: !!R.salute })) {
      let shown = false; try { shown = !!onSalute(); } catch { shown = false; }
      R.salute = { at: +R.S.race.clock.toFixed(1), shown }; stats.salute = { ...R.salute };
      R.horn?.play({ n: 1, long: true }, B.phys.state);
    }
    if (R.S.place) for (const e of ev) {
      if (e.id !== 'me') continue;
      if (e.type === 'gateMissed') R.coach?.note(`Missed gate ${markNumbers(R.course).get(e.mark) ?? ''}: go back through it, red to port.`, 5, 'gateMissed', true);
      else if (e.type === 'gateWrong') R.coach?.note('Through the gate the wrong way: red to port, going out.', 5, 'gateWrong', true);
    }
    R.officer.feed(ev, R.S.race.clock);
    for (const h of R.officer.horns(ev)) R.horn?.play(h, B.phys.state);
    for (const e of ev) {
      R.coach.event(e); R.review.event(e);
      if (e.type === 'helperOff') { if (B.ctl) B.ctl.jibFree = false; if (!R.auto && B.driven) B.drive(null); R.coach.note(e.why === 'hands' ? 'You have the helm. The helper is off.' : 'Clean start. You have the helm: sail for the mark.', 5, 'helperOff', e.why === 'hands'); if (e.why === 'hands' && R.aids.helper) R.ui?.helperButton(R.S.race.clock < 0); }
      else if (e.type === 'helperOn') R.ui?.helperButton(false);
      else if (e.type === 'gun') R.ui?.helperButton(false);
      else if (e.type === 'started' && e.id === 'me') { stats.start = +e.delayS.toFixed(2); if (!R.S.helper) R.coach.note(e.delayS < 3 ? 'A clean start!' : `Started, ${Math.round(e.delayS)} s after the gun.`, 4, 'started'); }
      else if (e.type === 'finished' && e.id === 'me') R.finishAt = R.S.t;
      else if (e.type === 'rounded' && e.id === 'me') {   // the moment (owner 2026-11-17): the watch's tick, the chime, the new leg lit
        const n = markNumbers(R.course).get(e.mark) ?? '';
        R.flash = `${R.course.byId[e.mark]?.kind === 'gate' ? 'Gate' : 'Mark'} ${n} \u2713`; R.flashUntil = R.realT + ROUND_FX.flashS; R.legLitUntil = R.realT + LEG.litS; R.lastKey = '';
        R.chime?.play();
        stats.rounds.push({ mark: e.mark, n, at: +e.clock.toFixed(2), close: !!e.close }); if (stats.rounds.length > 20) stats.rounds.shift();
        if (e.close) R.coach.note(`Mark ${n} counts. Next time keep it on your ${(R.course.byId[e.mark]?.rounding ?? 'port') === 'starboard' ? 'right' : 'left'}.`, 5, 'close');
      }
      if (R.trial && e.type === 'rounded' && e.id === 'me') {   // a time trial's split at each mark, against the best run's
        const k = R.trial.splits.length, n = legMark(R.course, k).text, best = R.trial.best?.splits?.[k] ?? null, d = splitDelta(e.clock, best);
        R.trial.splits.push({ n, t: e.clock, d }); stats.splits.push({ n, t: +e.clock.toFixed(1), d });
        R.trial.lastSplit = { n, d, until: R.realT + 8 };
        if (R.aids.coach !== 'off') R.coach.moment(splitWord(n, e.clock, best), 6, 'split');
      }
    }
  }

  // step D2: the race's quality ladder (engine/quality.js createRaceLadder) runs while a race is sailed (the hub closed, before her
  // results card) and steps down only in a quiet moment: not the start (QUIET.beforeS before the gun to QUIET.afterS after it, a
  // pursuit's own start too), not a rounding (within QUIET.markK zones of her next mark), not the finish (the last leg within
  // QUIET.finishM of the line), not the fly-over
  function racing() { return !!(R.on && !R.hubOpen && R.S && R.result == null && R.S.race.view('me').status !== 'finished'); }
  const qv = { quiet: false, why: '' };
  function quiet() {
    if (!racing()) { qv.quiet = false; qv.why = 'no race'; return qv; }
    const r = R.S.race, v = r.view('me'), s = B.phys.state, gunAt = R.S.slots?.me ?? 0;
    const say = (q, why) => { qv.quiet = q; qv.why = why; return qv; };
    if (R.fly) return say(false, 'the fly-over');
    if (r.clock > -QUIET.beforeS && r.clock < QUIET.afterS) return say(false, 'the start');
    if (gunAt > 0 && r.clock > gunAt - QUIET.beforeS && r.clock < gunAt + QUIET.afterS) return say(false, 'her start');
    if (v.status === 'racing' && v.leg >= R.course.legs.length - 1) { const L = R.course.finish ?? R.course.line; if (Math.hypot(s.x - L.centre[0], s.z - L.centre[1]) < QUIET.finishM) return say(false, 'the finish'); }
    else if (v.status === 'racing' && v.target?.at && Math.hypot(s.x - v.target.at.x, s.z - v.target.at.z) < QUIET.markK * ZONE_M) return say(false, 'a rounding');
    return say(true, '');
  }

  // a capture: the race sailed on `seconds` (the helper at the start, ?autoplay=1's pro after it), the camera settled
  function settle(seconds) {
    const n = Math.round(seconds / DT);
    for (let i = 0; i < n; i++) { B.step(DT, { steer: 0, pull: 0 }, DT); afterStep(); }
    R.camK = R.S.race.clock < 0 ? 1 : Math.max(0, 1 - R.S.race.clock / RACE_CAM.easeS);
  }
  Object.assign(R, { beforeStep, afterStep, racing, quiet, settle });
}
