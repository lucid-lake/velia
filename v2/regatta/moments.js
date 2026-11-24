// The race's moments (BACKLOG-v2 #12 R4, the owner's pacing note 2026-11-14: "if we don't keep stimulating them, they get bored"):
// short lines on the coach's card for what the fleet does round the player, so something happens every 10–20 s of real time. Pure:
// no DOM; v2/tests/regatta-r4.test.mjs.
//   - a crossing: a rival converging with her (the closest point under 2 lengths within 10 s): who has the right of way, what to do
//   - an overlap at a mark: a rival alongside inside the zone
//   - a place won or lost (held 4 s so a see-saw does not chatter)
//   - the leader rounding a mark; the last leg with her place and the gap ahead
//   - a gust coming down the course (the wind 40–120 m upwind 15 % over hers)
//   - on a long quiet board (nothing on the card for 22 race seconds): the mark's distance, her place, the boat ahead or behind
// Each kind has its own quiet time (race seconds); the coach's card arbitrates (one line at a time, coach.js).
//   const M = createMoments({ names });  M.update(now, ctx) → [{ id, text, s }] (usually empty; the array is reused)
//   ctx: { me: state, rivals: [{ id, state }], order: [ids], view: me's view, inZone, finishLeg, windAt(x, z), events: [] }
import { atFault } from '../../src/sim/race/rules.js';
import { cpa } from './fleet.js';

export const MOMENTS = Object.freeze({ crossM: 17, crossS: 10, crossQuietS: 20, overlapM: 12, overlapQuietS: 20, placeHoldS: 4, placeQuietS: 8, gustRatio: 1.15, gustQuietS: 30, leaderQuietS: 10, idleS: 18, statusQuietS: 20 });
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th'];
export const ordinal = (i) => ORD[i] ?? `${i + 1}th`;

export function createMoments({ names = {}, M = MOMENTS } = {}) {
  const out = [], last = {};
  let place = null, cand = null, candAt = 0, lastLeg = false;
  const quiet = (k, now, s) => now - (last[k] ?? -1e9) >= s;
  const say = (k, now, text, s = 4) => { last[k] = now; out.push({ id: k, text, s }); };
  const name = (id) => names[id] ?? id;
  function reset() { for (const k in last) delete last[k]; place = null; cand = null; lastLeg = false; }
  function update(now, c) {
    out.length = 0;
    if (!c.me || !c.view) return out;
    const racing = c.view.status === 'racing', me = c.me;
    // the leader rounding a mark (rules.js 'rounded' with place 1), not the player
    for (const e of c.events ?? []) if (e.type === 'rounded' && e.place === 1 && e.id !== 'me' && quiet('leader', now, M.leaderQuietS)) say('leader', now, `${name(e.id)} rounds ${e.mark} first.`, 3.5);
    if (!racing) return out;
    // a crossing or an overlap with the nearest converging rival
    const windFrom = c.windFrom;
    for (const r of c.rivals) {
      const q = r.state, d = Math.hypot(q.x - me.x, q.z - me.z);
      if (d > 45) continue;
      if (c.inZone && d < M.overlapM && quiet('overlap', now, M.overlapQuietS)) { say('overlap', now, `${name(r.id)} is alongside at the mark: hold your line, no touching.`, 4); break; }
      const k = cpa(me, q, M.crossS);
      if (k.d < M.crossM && k.t > 1 && quiet('cross', now, M.crossQuietS)) {
        const f = atFault(me, q, windFrom), port = f.rule === 'port and starboard';
        say('cross', now, f.fault === 0
          ? (port ? `${name(r.id)} is on starboard: she has right of way. Duck behind her or tack.` : `${name(r.id)} is to leeward: keep clear, head up.`)
          : (port ? `You are on starboard: ${name(r.id)} must keep clear. Hold your course.` : `You are to leeward: ${name(r.id)} must keep clear.`), 4.5);
        if (f.fault === 0) out[out.length - 1].giveWay = true;   // she must keep clear: the lean skipper's MUST (v2/ui/leanSkipper.js)
        break;
      }
    }
    // her place: changed and held a moment
    const i = c.order.indexOf('me');
    if (i >= 0) {
      if (place == null) place = i;
      else if (i !== place) {
        if (cand !== i) { cand = i; candAt = now; }
        else if (now - candAt >= M.placeHoldS && quiet('place', now, M.placeQuietS)) {
          const won = i < place, other = won ? c.order[i + 1] : c.order[i - 1];
          say('place', now, won ? `You passed ${name(other)}: ${ordinal(i)} of ${c.order.length}.` : `${name(other)} got past you: ${ordinal(i)} of ${c.order.length}.`, 4);
          place = i; cand = null;
        }
      } else cand = null;
    }
    // the last leg: once, with her place and the gap to the boat ahead
    if (c.finishLeg && !lastLeg) {
      lastLeg = true;
      const ahead = i > 0 ? c.rivals.find((r) => r.id === c.order[i - 1]) : null;
      const gap = ahead ? (c.progress && c.progress[ahead.id] != null && c.progress.me != null ? Math.round(Math.abs(c.progress[ahead.id] - c.progress.me)) : Math.round(Math.hypot(ahead.state.x - me.x, ahead.state.z - me.z))) : null;
      say('lastLeg', now, i === 0 ? 'Last leg, and you lead! Hold it to the finish.' : `Last leg! ${ordinal(i)} of ${c.order.length}, ${name(c.order[i - 1])} ${gap} m ahead.`, 5);
    }
    // a gust coming down the course: the wind upwind of her against hers
    if (c.windAt && quiet('gust', now, M.gustQuietS)) {
      const w0 = c.windAt(me.x, me.z), v0 = Math.hypot(w0.vx, w0.vz);
      if (v0 > 0.5) {
        const ux = -w0.vx / v0, uz = -w0.vz / v0;   // toward where the wind comes from
        let best = 0;
        for (const dd of [40, 80, 120]) { const w = c.windAt(me.x + ux * dd, me.z + uz * dd); best = Math.max(best, Math.hypot(w.vx, w.vz) / v0); }
        if (best >= M.gustRatio) say('gust', now, 'A gust is coming down the course: dark water ahead. Ease a little as it hits.', 4);
      }
    }
    // nothing on the card for a while (a long board): the race in one line, the mark's distance, her place, the gap ahead or behind
    if (!out.length && (c.cardIdleS ?? 0) >= M.idleS && quiet('status', now, M.statusQuietS) && c.markM != null) {
      const ahead = i > 0 ? c.order[i - 1] : null, behind = i >= 0 && i < c.order.length - 1 ? c.order[i + 1] : null;
      const q = (id) => { if (c.progress && c.progress[id] != null && c.progress.me != null) return Math.round(Math.abs(c.progress[id] - c.progress.me)); const r = c.rivals.find((x) => x.id === id); return r ? Math.round(Math.hypot(r.state.x - me.x, r.state.z - me.z)) : null; };   // along the course when the caller gives the progress
      const who = ahead ? `${name(ahead)} ${q(ahead)} m ahead` : behind ? `${name(behind)} ${q(behind)} m behind` : '';
      say('status', now, `${c.markName ?? 'The mark'} in ${Math.round(c.markM)} m. You are ${ordinal(i)} of ${c.order.length}${who ? `, ${who}` : ''}.`, 4);
    }
    return out;
  }
  return { update, reset };
}
