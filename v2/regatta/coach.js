// The coach (BACKLOG-v2 #12 R3): one line at a time under the top bar, the cue it talks about lit on the water,
// the steps following the race: the pre-start, the gun, the beat, the layline, the rounding, the reach or run, the finish (and,
// when they happen, over early and a penalty). It never spams: one line on screen, each cleared by the action it asks for or after
// its time; a new step waits COACH.gapS after the last one started (an urgent one, COACH.urgentS); a step shows once a race (once
// a leg for the leg's own). v1's race officer shares the same card (text, with the committee boat's horns): a hail takes the card
// for COACH.officerS, the coach's line waits under it and comes back if it still applies; the officer waits while a coach line is
// fresh (busy), so the two never overlap. Pure: v2/tests/regatta-r3.test.mjs (the step machine over a scripted race).
//   const C = createCoach({ coach: 'all' | 'mistakes' | 'off' });
//   C.event(e)           the race's events (rules.js: gun, ocs, started, rounded, wrongSide, finished, penalty; the helper's helperOff/On)
//   C.officer(text, now) a hail;  C.busy(now) → the officer should wait
//   C.update(now, sit) → C.line: { kind: 'coach' | 'officer' | 'note', id, text, sub, lit: [] } | null
//     sit: { clock, status, ocs, flying (a flying start), legKind: 'beat' | 'reach' | 'run' | null, leg, finishLeg, lay: { side, m } | null, inZone,
//            wrongSide (the rounding line crossed on the wrong side, rounding.js), rounding: 'port' | 'starboard', next: { id, num, colour } | null (after this mark), target: { id, num, colour } | null (this leg's), tacked }
//            (num: the mark's number on screen, marks.js; the ids stay internal)
//   C.reset()            R: a new race
export const COACH = Object.freeze({ gapS: 8, urgentS: 2.5, officerS: 4.5, officerWaitS: 3, staleS: 8, steps: 6 });
const side = (r) => (r === 'starboard' ? 'right' : 'left');

// the steps, in race order; n: the step's place in the race; mistake: Club's coach says it too
export const STEPS = Object.freeze([
  { id: 'prestart', n: 1, maxS: 12, lit: ['line', 'ghost'], text: () => 'Stay below the white line. Be at the gold boat when the clock hits 0:00.',
    when: (s) => !s.flying && s.clock < -8 && s.status === 'prestart' && !s.ocs, done: (s) => s.ocs || s.clock >= 0 },
  // the flying start (sit.flying): already sailing at the line with a few seconds to spare; nothing to hold
  { id: 'flying', n: 1, maxS: 8, lit: ['line'], text: () => 'Line ahead: ease off a moment, then go at the gun.',
    when: (s) => !!s.flying && s.clock < -2 && s.status === 'prestart' && !s.ocs, done: (s) => s.ocs || s.clock >= 0 },
  { id: 'ocs', n: 1, maxS: 12, urgent: true, mistake: true, repeat: 10, lit: ['line'], text: () => 'Too early: turn back below the line, then cross again.',
    when: (s) => s.ocs, done: (s) => !s.ocs },
  { id: 'gun', n: 2, maxS: 6, urgent: true, lit: ['line'], text: () => 'Gun! Cross the line now.',
    when: (s) => s.clock >= 0 && s.clock < 6 && !s.ocs && s.status !== 'racing', done: (s) => s.status === 'racing' },
  { id: 'beat', n: 3, maxS: 10, perLeg: true, lit: ['laylines'], text: () => 'The mark is upwind: zig-zag. Tack when its line lights up.',
    when: (s) => s.status === 'racing' && s.legKind === 'beat' && !!s.lay && !s.inZone, done: (s) => s.tacked || s.inZone },
  { id: 'layline', n: 3, maxS: 8, urgent: true, mistake: true, perLeg: true, lit: (s) => [`layline:${s.lay?.side ?? 'port'}`], text: () => 'Tack now: the mark is straight ahead.',
    when: (s) => s.status === 'racing' && s.legKind === 'beat' && !!s.lay && s.lay.m < 12 && !s.inZone, done: (s) => s.tacked || s.inZone },
  { id: 'rounding', n: 4, maxS: 12, urgent: true, perLeg: true, lit: ['zone', 'nextLeg'], text: (s) => `Turn ${side(s.rounding)} round the mark, then head for ${s.next?.id === 'finish' ? 'the finish' : s.next?.num ? `mark ${s.next.num}` : 'the next mark'}.`,
    when: (s) => s.status === 'racing' && s.inZone, done: (s, e) => e.rounded },
  // the rounding line crossed on the wrong side (owner 2026-11-17; Club, and Beginner past its margin): at once, the gate glowing
  { id: 'wrongSide', n: 4, maxS: 10, urgent: true, preempt: true, mistake: true, repeat: 12, lit: ['gate'], text: (s) => `Go round mark ${s.target?.num ?? ''} \u2014 keep it on your ${side(s.rounding)}.`.replace('mark  ', 'the mark '),
    when: (s, e) => s.status === 'racing' && (!!s.wrongSide || e.wrongSide), done: (s, e) => e.rounded || (!s.wrongSide && !e.wrongSide) },
  { id: 'run', n: 5, maxS: 8, perLeg: true, lit: ['nextLeg'], text: (s) => `Ease the sails. Head for ${s.target?.num ? `mark ${s.target.num}` : 'the next mark'}.`,
    when: (s) => s.status === 'racing' && (s.legKind === 'reach' || s.legKind === 'run') && !s.finishLeg && !s.inZone, done: (s) => s.inZone },
  { id: 'finish', n: 6, maxS: 10, lit: ['finish'], text: () => 'Straight through the finish line!',
    when: (s) => s.status === 'racing' && s.finishLeg, done: (s) => s.status === 'finished' },
  { id: 'penalty', n: 0, maxS: 6, urgent: true, mistake: true, repeat: 10, lit: [], text: () => 'Penalty: sail one full turn, then race on.',
    when: (s, e) => e.penalty, done: () => false },
]);
const BY_ID = Object.fromEntries(STEPS.map((s) => [s.id, s]));

export function createCoach({ coach = 'all', C = COACH } = {}) {
  let cur = null, pend = null, lastStart = -Infinity, hail = null, notes = [];
  const shown = new Map(), log = [];
  const ev = { rounded: false, penalty: false, wrongSide: false };
  const allowed = (st) => coach === 'all' || (coach === 'mistakes' && st.mistake);
  const key = (st, s) => (st.perLeg ? `${st.id}:${s.leg ?? 0}` : st.id);
  function reset() { cur = null; pend = null; lastStart = -Infinity; hail = null; notes = []; shown.clear(); log.length = 0; ev.rounded = false; ev.penalty = false; ev.wrongSide = false; }
  function event(e) {
    if (e.id != null && e.id !== 'me') return;
    if (e.type === 'rounded') ev.rounded = true;
    else if (e.type === 'penalty') ev.penalty = true;
    else if (e.type === 'wrongSide') ev.wrongSide = true;
  }
  // an info line (the helper's hand-back, a clean start): only when the card is free, only with the full coach
  // now: it answers the player's own action (a steer handing the helm back), so it takes the card at once (over a teaching line)
  function note(text, s = 4, id = 'note', now = false) { if (coach === 'all') { if (now) notes.length = 0; notes.push({ id, text, s, now }); } }
  // R4: a moment (moments.js: a crossing, a place, the last leg, a gust): the same quiet path as a note, at every level the caller
  // allows (index.js: Pro hears its places and the last leg only)
  function moment(text, s = 4, id = 'moment') { notes.push({ id, text, s, now: false }); }
  function officer(text, now, call = null) { hail = { text, at: now, until: now + C.officerS, call }; }   // call: the officer's id (rc_ocs_me…: a phone keeps the start and recall calls)
  const busy = (now) => !!cur && (now - cur.at < C.officerWaitS || (!!cur.st?.urgent && now < cur.until));
  const start = (st, s, now) => {
    const lit = typeof st.lit === 'function' ? st.lit(s) : st.lit;
    cur = { st, at: now, until: now + st.maxS, text: st.text(s), lit, kind: 'coach' };
    shown.set(key(st, s), now); lastStart = now; pend = null;
    log.push({ id: st.id, at: +now.toFixed(2), text: cur.text });
  };
  function update(now, s) {
    // the current line: cleared by its action, or after its time
    if (cur) {
      if (cur.kind === 'note' ? now >= cur.until : (now >= cur.until || cur.st.done(s, ev))) cur = null;
    }
    // the candidates that apply now, in race order
    let cand = null;
    for (const st of STEPS) {
      if (!allowed(st)) continue;
      const k = key(st, s), at = shown.get(k);
      if (at != null && !(st.repeat && now - at >= st.repeat)) continue;
      if (!st.when(s, ev)) continue;
      if (cur?.st === st) continue;
      if (!cand || (st.urgent && !cand.urgent)) cand = st;
    }
    ev.rounded = false; ev.penalty = false; ev.wrongSide = false;
    if (cand) { if (!pend || pend.st !== cand) pend = { st: cand, at: now }; }
    else if (pend && (!pend.st.when(s, ev) || now - pend.at > C.staleS)) pend = null;
    const hailing = hail && now < hail.until;
    if (hail && !hailing) hail = null;
    if (pend && !hailing) {
      const st = pend.st, gap = now - lastStart;
      const free = !cur || cur.kind === 'note';
      if (free && gap >= (st.preempt ? 0 : st.urgent ? C.urgentS : C.gapS)) start(st, s, now);
      else if (cur && cur.kind === 'coach' && st.urgent && !cur.st.urgent && gap >= C.urgentS) start(st, s, now);   // urgent beats a teaching line
      else if (cur && cur.kind === 'coach' && st.preempt && cur.st !== st) start(st, s, now);   // the wrong side: at once, over any line
    }
    // a note fills a free card (never within the urgent gap of a line)
    if (notes[0]?.now && !hailing && (!cur || !cur.st?.urgent)) cur = null;   // the player's own action: answered at once
    if (!cur && notes.length && !hailing && (notes[0].now || now - lastStart >= C.urgentS)) { const n = notes.shift(); cur = { st: null, at: now, until: now + n.s, text: n.text, lit: [], kind: 'note', id: n.id }; lastStart = now; log.push({ id: n.id, at: +now.toFixed(2), text: n.text }); }
    if (notes.length > 2) notes.splice(0, notes.length - 2);
    if (hailing) { api.line = { kind: 'officer', id: 'officer', call: hail.call, text: hail.text, sub: 'Race committee', lit: [] }; return api.line; }
    if (!cur) { api.line = null; return null; }
    const st = cur.st;
    api.line = cur.kind === 'note' ? { kind: 'note', id: cur.id, text: cur.text, sub: 'Coach', lit: [] }
      : { kind: 'coach', id: st.id, text: cur.text, sub: 'Coach', lit: cur.lit };   // one voice per fact (owner 2026-11-16): no step count
    return api.line;
  }
  const api = { line: null, event, note, moment, officer, busy, update, reset, log, get current() { return cur; }, get pending() { return pend; }, steps: STEPS, byId: BY_ID };
  return api;
}

// the leg's kind from the boat's course to the next mark against the wind: a beat (the mark within 50° of the wind), a run (within
// 35° of dead downwind), else a reach
export function legKind(from, to, windFromRad) {
  const brg = Math.atan2(to[0] - from[0], -(to[1] - from[1]));
  let d = brg - windFromRad; d = Math.atan2(Math.sin(d), Math.cos(d));
  const off = Math.abs(d) * 180 / Math.PI;
  return off < 50 ? 'beat' : off > 145 ? 'run' : 'reach';
}
