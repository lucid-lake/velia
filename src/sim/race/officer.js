// The race officer and the horns: the race committee's calls on VHF, as ONE clip of the sprite each (RACE_VOCAB;
// tools/vhf_vocab.mjs lists them for tools/vhf_voice.py, like the harbour master's), and the horns. Pure: tests/race-officer.test.mjs.
//   const o = createOfficer({ names: { me: 'Halcyon', wren: 'Osprey' } });
//   o.feed(raceEvents, clock);            // every tick's events from rules.js
//   const call = o.step(dt, { busy });    // at most one call, when the radio is quiet: { id, text, tokens, from } | null
//   o.horns(raceEvents) → [{ n, long }]   // the committee boat's horn, to play now
export const RACE_VOCAB = {
  rc_one_min:  'Race committee to all boats. One minute to the start.',
  rc_thirty:   'Race committee. Thirty seconds.',
  rc_start:    'Race committee. The race is started. Good sailing.',
  rc_ocs_me:   'Halcyon, over early. Return and restart.',
  rc_ocs_easy: 'Halcyon, you are early. Dip back behind the line.',
  rc_wrong:    'Halcyon, you missed the mark. Go back round it.',
  rc_pen_pst:  'Halcyon, port and starboard. One turn.',
  rc_pen_wl:   'Halcyon, windward and leeward. One turn.',
  rc_pen_mark: 'Halcyon, mark touched. One turn.',
  rc_w_me:     'Halcyon rounds the windward mark first.',
  rc_w_wren:   'Osprey rounds the windward mark first.',
  rc_i_me:     'Halcyon rounds the island mark first.',
  rc_i_wren:   'Osprey rounds the island mark first.',
  rc_fin_me:   'Halcyon finishes first.',
  rc_fin_wren: 'Osprey finishes first.',
  rc_photo:    'Race committee. Too close to call at the line. We are looking at the picture.',
  wren_luck:   'Osprey to Halcyon. Good luck, skipper.',
  wren_well:   'Osprey to Halcyon. Well sailed.',
  wren_next:   'Osprey to Halcyon. Next time, Halcyon.',
};
const SHOW = {
  rc_one_min: 'One minute to the start.', rc_thirty: 'Thirty seconds.', rc_start: 'The race is started.', rc_ocs_me: 'Halcyon, over early. Return and restart.', rc_ocs_easy: 'Early. Dip back behind the line.', rc_wrong: 'Missed the mark. Go back round it.',
  rc_pen_pst: 'Port and starboard. One turn.', rc_pen_wl: 'Windward and leeward. One turn.', rc_pen_mark: 'Mark touched. One turn.',
  rc_w_me: 'Halcyon rounds the windward mark first.', rc_w_wren: 'Osprey rounds the windward mark first.', rc_i_me: 'Halcyon rounds the island mark first.', rc_i_wren: 'Osprey rounds the island mark first.',
  rc_fin_me: 'Halcyon finishes first.', rc_fin_wren: 'Osprey finishes first.', rc_photo: 'Too close to call. Looking at the picture.',
  wren_luck: 'Osprey: good luck, skipper.', wren_well: 'Osprey: well sailed.', wren_next: 'Osprey: next time, Halcyon.',
};
export const OFFICER = { minGapS: 2.5, staleS: 14, from: { rc: 'Race committee', wren: 'Osprey' } };
export const call = (id) => ({ id, text: SHOW[id], from: id.startsWith('wren') ? OFFICER.from.wren : OFFICER.from.rc, tokens: [{ id, say: RACE_VOCAB[id], show: SHOW[id] }] });

export function createOfficer({ R = OFFICER, forgiving: forgive = false } = {}) {   // forgiving: a boolean or () => boolean (Easy)
  const forgiving = () => (typeof forgive === 'function' ? forgive() : forgive);
  let q = [], t = 0, lastAt = -Infinity, done = new Set();
  const push = (id, prio = 5, once = null) => { if (once && done.has(once)) return; if (once) done.add(once); q.push({ id, prio, at: t }); };
  function feed(events = [], clock = 0) {
    for (const e of events) {
      if (e.type === 'horn' && clock < -50 && e.n === 1 && !e.long) push('rc_one_min', 9, 'one');
      else if (e.type === 'horn' && !e.long && clock >= -31 && clock < -29) { push('rc_thirty', 9, 'thirty'); push('wren_luck', 4, 'luck'); }   // Osprey's hail follows the 30 s horn
      else if (e.type === 'gun') push('rc_start', 9, 'gun');
      else if (e.type === 'ocs' && e.id === 'me' && (!e.early || forgiving())) push(forgiving() ? 'rc_ocs_easy' : 'rc_ocs_me', forgiving() ? 10 : 8, forgiving() ? null : 'ocs');
      else if (e.type === 'wrongSide' && e.id === 'me') push('rc_wrong', 8);
      else if (e.type === 'penalty' && e.id === 'me' && !forgiving()) push(e.rule === 'port and starboard' ? 'rc_pen_pst' : e.rule === 'windward and leeward' ? 'rc_pen_wl' : 'rc_pen_mark', 7);
      else if (e.type === 'rounded' && e.place === 1) push(`rc_${e.mark === 'W' ? 'w' : 'i'}_${e.id === 'me' ? 'me' : 'wren'}`, 6, `r${e.mark}`);
      else if (e.type === 'photo') push('rc_photo', 11)
      else if (e.type === 'finished' && e.place === 1) push(e.id === 'me' ? 'rc_fin_me' : 'rc_fin_wren', 10, 'fin');
      else if (e.type === 'finished' && e.place === 2) push(e.id === 'wren' ? 'wren_next' : 'wren_well', 10, 'fin2');
    }
  }
  // one call at a time: the highest priority first, the oldest of those; a stale call is dropped (a mark rounding 14 s old is news no more)
  function step(dt, { busy = false } = {}) {
    t += dt;
    q = q.filter((c) => c.prio >= 10 || t - c.at <= R.staleS);
    if (!q.length || busy || t - lastAt < R.minGapS) return null;
    q.sort((a, b) => b.prio - a.prio || a.at - b.at);
    const c = q.shift(); lastAt = t;
    return call(c.id);
  }
  const horns = (events = []) => events.filter((e) => e.type === 'horn').map((e) => ({ n: e.n, long: !!e.long })).concat(events.filter((e) => e.type === 'tick').map(() => ({ n: 1, long: false, short: true })))
    .concat(events.filter((e) => e.type === 'ocs' && e.id === 'me' && !e.early).map(() => ({ n: 1, long: false })));
  
  function reset() { q = []; t = 0; lastAt = -Infinity; done = new Set(); }
  return { feed, step, horns, reset, get queued() { return q.map((c) => c.id); } };
}
