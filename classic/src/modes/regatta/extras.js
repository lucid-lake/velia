// The mode's UI and sound: the five plates, the committee boat's horn (synthesised: an air horn is two detuned reeds
// through a horn bell, no asset), the race officer and Wren's hails on the VHF radio (src/vhf/radio.js) with the words also on the
// skipper's subtitle line. The results card and the photo finish: src/modes/regatta/finish.js (commit 6).
import { createRadio } from '../../../../src/vhf/radio.js';
import { track } from '../../../../src/metrics.js';
import { createOfficer } from '../../../../src/sim/race/officer.js';
import { fmtGap } from '../../../../src/sim/race/progress.js';
import { createRaceMusic } from './raceMusic.js';
import { createPlates, positionText, pointer, mmss1 } from './plates.js';
import { createBriefing, createIntroCaption, createEdgeMarker } from './briefingUi.js';
import { createWorldMarks } from './worldMarks.js';
import { settingsNow } from '../../../../src/ui/settings.js';
import { diffById, guideModel, edgeMarker, gapWords, createCoach, finishNote } from '../../../../src/sim/race/newbie.js';
import { timeToLine } from '../../../../src/sim/race/line.js';
import { buildResult, recordBest, loadBest, bestLine, logLine } from '../../../../src/sim/race/results.js';
import { createPhoto, etaToLine, photoCam } from '../../../../src/sim/race/photo.js';

// one horn blast: a long one is 1.3 s, a short one 0.22 s; louder near the committee boat
function createHorn({ audio, at }) {
  let ctx = null, out = null;
  audio?.attach?.(({ ctx: c, master }) => { ctx = c; out = new GainNode(c, { gain: 0.5 }); out.connect(master); });
  return {
    play({ long = false } = {}, from = null) {
      if (!ctx || ctx.state === 'closed') return false;
      const d = from ? Math.hypot(from.x - at.x, from.z - at.z) : 40, g = Math.min(1, 1 / (0.25 + d / 120)), t0 = ctx.currentTime + 0.01, dur = long ? 1.3 : 0.22;
      const env = new GainNode(ctx, { gain: 0 }), bell = new BiquadFilterNode(ctx, { type: 'bandpass', frequency: 520, Q: 1.4 }), lp = new BiquadFilterNode(ctx, { type: 'lowpass', frequency: 2400 });
      env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(0.7 * g, t0 + 0.03); env.gain.setValueAtTime(0.7 * g, t0 + dur - 0.05); env.gain.linearRampToValueAtTime(0, t0 + dur);
      for (const f of [415, 523]) { const o = new OscillatorNode(ctx, { type: 'sawtooth', frequency: f }); o.connect(bell); o.start(t0); o.stop(t0 + dur + 0.02); }
      bell.connect(lp).connect(env).connect(out);
      return true;
    },
  };
}

export function regattaExtras({ core, course, sail, rival, marks, controls, api, session, flow }) {
  const { headless } = core;
  const names = { me: core.vessel?.name ?? 'Halcyon', wren: 'Osprey' };   // the player's boat: its profile's name
  const briefing = createBriefing({ course, flow, services: core.services, onStart: () => { flow.start(); } });
  const help = createBriefing({ course, flow, help: true, services: core.services, onStart: () => { flow.close(); } });
  const caption = createIntroCaption({ services: core.services }), edge = createEdgeMarker();
  const wmarks = headless && !flow.running ? null : createWorldMarks({ core, course, rival, sail, marks });
  const coach = createCoach();
  let pendingEv = [], lastCover = null, routeIdx = 0, lastMark = null, wasRun = null;
  const plates = createPlates({ onHelp: () => { if (flow.reopen()) help.show(); }, onRematch: () => api.restart(), onHome: () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape' })) });
  const officer = createOfficer({ forgiving: () => session.forgiving });
  const horn = createHorn({ audio: core.audio, at: { x: course.line.committee[0], z: course.line.committee[1] } });
  const radio = headless ? null : createRadio({ audio: core.audio });
  const music = headless || !core.flags.music ? null : createRaceMusic({ audio: core.audio }); music?.start();
  let flags = [], gap = null, hornQ = [], hornT = 0, pendingCard = false, shown = null;
  const photo = createPhoto();
  let store = null; try { store = globalThis.localStorage ?? null; } catch { store = null; }
  const say = (text) => controls?.viewSwitch?.say?.(text);

  function onEvents(ev) {
    const clock = session.race.clock; pendingEv.push(...ev);
    officer.feed(ev, clock);
    for (const h of officer.horns(ev)) hornQ.push(h);
    for (const e of ev) {
      if (e.type === 'finished' && e.place === 1 && !session.race.done) {   // the other boat is about to cross: a photo finish if it is within 2 s
        const other = e.id === 'me' ? 'wren' : 'me', st = (other === 'me' ? sail : rival).phys.state;
        if (photo.arm({ gapS: etaToLine(course.line, { x: st.x, z: st.z, heading: st.heading, u: st.u }) })) { controls?.setRate?.(photo.rate()); officer.feed([{ type: 'photo' }], clock); }
      }
      if (e.type === 'over') pendingCard = true;
      if (e.type === 'flag') flags = e.up;
      if (e.type === 'gap') {
        const meTrails = e.trailer === 'me';
        gap = `${meTrails ? '+' : '-'}${fmtGap(e.s, e.m).slice(1)}`;
      }
    }
  }
  const tierName = () => diffById(flow.difficulty).tier;
  const services = core.services, boatSvc = services.get('boat');   // the 'boat' service: its env each paint
  const toLine = () => { const st = sail.phys.state; return timeToLine({ ...course.line, up: course.line.up }, st.x, st.z, st.heading, Math.max(st.u, 0.3)); };
  function paint(dt) {
    const s = session.race, v = s.view('me'), w = s.view('wren'), order = s.order(), pos = positionText(order, 'me', names);
    const lone = !w.startedAt && s.clock < 0;
    const racing = v.status === 'racing', target = racing ? v.target : v.status === 'finished' ? null : { mark: 'Start', at: { x: course.line.centre[0], z: course.line.centre[1] } };
    const lead = w.progressM - v.progressM;   // > 0: Osprey leads
    // Easy: "Line in 8 s", then "Go!"; a missed mark says how to fix it
    let pointerText = null;
    if (session.forgiving && !racing && v.status !== 'finished') {
      if (s.clock < 0 && s.clock > -30) { const t = toLine(); if (Number.isFinite(t) && t > 0) pointerText = `Line in ${Math.ceil(t)} s`; }
      else if (s.clock >= 0 && s.clock < 4) pointerText = v.ocs ? 'Early: dip back behind the line' : 'Go! Cross the line';
    }
    if (racing && v.target && pendingWrong) pointerText = `Go back round ${v.target.mark}, keeping it on your left`;
    plates.paint(dt, { clock: s.clock, flags, ocs: !!v.ocs, place: lone ? '-' : pos.place, other: gapWords(lead, names.wren), gap, pointerText,
      pointer: pointer({ pose: sail.phys.state, target, rounding: 'port', names: { W: 'W', I: 'I', Start: 'Line' } }) });
    gap = null;
  }
  let pendingWrong = false;
  function showCard() {
    const r = session.race, order = r.order(), views = { me: r.view('me'), wren: r.view('wren') };
    const res = buildResult({ course, order, views, names, tier: tierName(), seed: api.seed });
    let best = null, note;
    if (views.me.finishedAt != null) { const rec = recordBest(store, { course: course.id, tier: tierName(), t: views.me.finishedAt }); best = bestLine(rec); note = finishNote({ place: order.indexOf('me') + 1, tierId: flow.difficulty, isNew: rec.isNew, prev: rec.prev }); track('regatta_finish', { place: order.indexOf('me') + 1, level: flow.difficulty }); }
    else { const b = loadBest(store, course.id, tierName()); best = b != null ? `Best: ${mmss1(b)}` : null; note = 'You are out on the water, and that is a start. Rematch?'; }
    plates.showCard({ rows: res.rows, best: [note, best].filter(Boolean).join(' · ') });
    try { store?.setItem?.('lakeshore.regatta.first', '1'); } catch { /* blocked */ }
    const line = logLine(res, 'me'); shown = res;
    marks.log?.push?.({ t: core.time, text: line }); say(line);
  }
  function coachAndWorld(dt) {
    const r = session.race, v = r.view('me'), st = sail.phys.state, easy = session.forgiving, ev = pendingEv; pendingEv = [];
    for (const e of ev) { if (e.type === 'wrongSide' && e.id === 'me') pendingWrong = true; if (e.type === 'rounded' && e.id === 'me') pendingWrong = false; }
    const cv = session.brain.sk.lastCoverT, covered = cv != null && cv !== lastCover && (lastCover = cv, true);
    let gust = 1; try { const env = boatSvc.env(session.sim), up = [Math.sin(session.windFrom), -Math.cos(session.windFrom)], a = env.windAt(st.x, st.z, session.sim), b = env.windAt(st.x + up[0] * 120, st.z + up[1] * 120, session.sim); gust = Math.hypot(b.vx, b.vz) / Math.max(0.5, Math.hypot(a.vx, a.vz)); } catch { /* no wind yet */ }
    const line = flow.running ? coach.step(dt, { clock: r.clock, easy, events: ev, covered, gustRatio: gust, lineS: toLine() }) : null;
    if (line) say(`R.: ${line}`);
    // the water: the guide, the glow, the tag; the rival's marker at the screen edge
    const racing = v.status === 'racing', g = racing && v.target ? guideModel({ pose: st, target: v.target, routeIdx: v.target.mark === lastMark ? routeIdx : 0 }) : null;
    if (g) { routeIdx = g.routeIdx; lastMark = v.target.mark; }
    wmarks?.update({ guide: g, guideOn: diffById(flow.difficulty).guide, ocs: !!v.ocs, lineOn: r.clock < 8 || !!v.ocs, tagOn: true });
    const rs = rival.phys.state, cam = core.camera;
    const vec = cam.position.clone().set(rs.x, 6, rs.z).project(cam), clipW = cam.projectionMatrix.elements[11] * 0 + (new (cam.position.constructor)(rs.x, 6, rs.z).applyMatrix4(cam.matrixWorldInverse).z < 0 ? 1 : -1);
    const m = edgeMarker({ x: vec.x, y: vec.y, w: clipW }, { width: innerWidth || 1280, height: innerHeight || 720 });
    const d = Math.hypot(rs.x - st.x, rs.z - st.z), ahead = Math.sin(st.heading) * (rs.x - st.x) - Math.cos(st.heading) * (rs.z - st.z) > 0;
    edge.paint(flow.running || flow.state === 'help' ? m : { offscreen: false }, `Osprey · ${Math.round(d / 5) * 5} m ${ahead ? 'ahead' : 'behind'}`);
  }
  function update(dt) {
    // the first-race flow: the card, the rival intro, then the countdown starts (the sim and the player's boat held until then)
    flow.step(dt);
    const run = flow.running;
    session.paused = !run;
    if (wasRun !== run) { controls?.setRate?.(run ? photo.rate() : 0); wasRun = run; }
    if (flow.state === 'brief') { if (!briefing.visible) briefing.show(); } else if (briefing.visible) briefing.hide();
    if (flow.state === 'help') { if (!help.visible) help.show(); } else if (help.visible) help.hide();
    caption.show(flow.state === 'intro');
    if (flow.state === 'brief' && flow.difficulty !== diffApplied) { diffApplied = flow.difficulty; applyDifficulty(); }
    if (flow.state === 'intro' && diffApplied !== flow.difficulty) { diffApplied = flow.difficulty; applyDifficulty(); }
    photo.step(dt);
    if (photo.done && photo.rate() === 1 && controls?.setRate) controls.setRate(1);
    if (pendingCard && !photo.active) { pendingCard = false; showCard(); }
    hornT -= dt;
    if (hornQ.length && hornT <= 0) { const h = hornQ.shift(); horn.play(h, sail.phys.state); hornT = h.long ? 1.5 : 0.35; }
    const call = run ? officer.step(dt, { busy: !!radio?.state.playing }) : null;
    if (call) { say(`${call.from}: ${call.text}`); try { if (settingsNow(services).get('vhf') !== false) radio?.play(radio.plan(call.tokens)); } catch { /* the sprite may be absent: the line still shows */ } }
    radio?.update(dt);
    if (music) {
      const r = session.race, v = r.view('me'), w = r.view('wren'), both = v.splits.length > 0 && w.splits.length > 0;
      music.update(dt, { clock: r.clock, over: r.done || !plates.card.hidden, finalLeg: v.status === 'racing' && v.leg >= course.legs.length - 1, gapS: both && v.status === 'racing' ? Math.abs(r.liveGap('me').s) : null, voice: !!radio?.state.playing });
    }
    coachAndWorld(dt);
    paint(dt);
  }
  // the difficulty: the rival's tier and whether the race forgives; changing it before the gun rebuilds the race at -60 s
  let diffApplied = null;
  function applyDifficulty() { const d = diffById(flow.difficulty); session.setDifficulty(d.tier, d.forgiving); api.tier = d.tier; pendingEv = []; coach.reset(); }
  applyDifficulty(); diffApplied = flow.difficulty;
  // a key or a click skips the rival intro
  const skip = (e) => { if (flow.state === 'intro') { flow.skip(); e.stopPropagation?.(); } };
  addEventListener('keydown', skip, true); addEventListener('pointerdown', skip, true);
  return {
    onEvents, update, paint, flow,
    onRestart() { officer.reset(); coach.reset(); flags = []; gap = null; hornQ = []; pendingCard = false; pendingWrong = false; shown = null; routeIdx = 0; photo.reset(); controls?.setRate?.(1); plates.hideCard(); },
    // the camera: the rival intro's pan (Osprey, then back to the player), or the photo finish's cut, else null
    camera({ base = null } = {}) {
      if (flow.state === 'intro') {
        const rs = rival.phys.state, h = rs.heading, t = flow.t, k = Math.min(1, Math.max(0, (t - (4 - 0.9)) / 0.9));
        const pos = [rs.x - Math.sin(h) * 26 + Math.cos(h) * 14, 7, rs.z + Math.cos(h) * 26 + Math.sin(h) * 14], tgt = [rs.x, 6, rs.z];
        if (!base || k === 0) return { pos, target: tgt };
        const bp = base.pos, bt = base.target, mix = (a, b) => a.map((v, i) => v + (b[i] - v) * k);
        return { pos: mix(pos, bp), target: mix(tgt, bt) };
      }
      return photo.active ? photoCam(course.line) : null;
    },
    rate: () => photo.rate(), get result() { return shown; }, photo, plates, officer, briefing,
    dispose() { removeEventListener('keydown', skip, true); removeEventListener('pointerdown', skip, true); music?.stop(); radio?.stop?.(); briefing.dispose(); help.dispose(); caption.dispose(); edge.dispose(); wmarks?.dispose(); plates.dispose(); },
  };
}
