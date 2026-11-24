// The race's review (BACKLOG-v2 #12 R3): what went wrong, measured while she sails, and the results card's numbers:
// the place, the time, the gap to the winner, the medal and ONE tip, drawn from the biggest loss. Pure: v2/tests/regatta-r3.test.mjs.
//   const R = createReview();
//   R.sample(dt, { clock, status, legKind, x, z, heading, u, twaSign, mark: [x, z] | null, windFrom, alpha, inZone })   each tick or frame
//   R.event(e)            the race's events for the player (ocs, started, rounded, penalty)
//   R.faults → [{ id, costS, ... }]      the losses found: over early, a late start, an overstood layline, a slow tack, a wide rounding
//   tipFor(faults, { level }) → { id, text }     the one tip (the biggest loss; a clean race gets the next step)
//   medalFor({ place, boats, finished }) → 'gold' | 'silver' | 'bronze' | null
//   resultCard({ order, views, names, me, level, faults }) → the card's model (place, of, time, gap, winner, medal, tip)
const DEG = Math.PI / 180;
export const REVIEW = Object.freeze({ lateS: 4, overstandM: 25, slowTackS: 9, tackRecover: 0.85, wideM: 18, tackLossS: 6 });
const mmss1 = (s) => { const a = Math.max(0, s); const m = Math.floor(a / 60), r = a - m * 60; return `${m}:${r.toFixed(1).padStart(4, '0')}`; };
export { mmss1 };

// the medals ("trophies by placement"; the plan's medal rules): gold for the win, silver for second, bronze for third;
// nothing for a boat that did not finish. In a fleet of two, second is silver only within MEDAL.closeS of the winner, else bronze
export const MEDAL = Object.freeze({ closeS: 30 });
export function medalFor({ place, boats = 2, finished = true, gapS = null }) {
  if (!finished || !place) return null;
  if (place === 1) return 'gold';
  if (place === 2) return boats <= 2 && gapS != null && gapS > MEDAL.closeS ? 'bronze' : 'silver';
  if (place === 3) return 'bronze';
  return null;
}

export function createReview(R = REVIEW) {
  const faults = [];
  let ocs = 0, start = null, tack = null, lastSign = 0, over = 0, overSide = null, zone = null, legSeen = -1, uAvg = 0;
  const add = (f) => { const i = faults.findIndex((x) => x.id === f.id); if (i < 0) faults.push(f); else if (f.costS > faults[i].costS) faults[i] = f; };
  function event(e) {
    if (e.id != null && e.id !== 'me') return;
    if (e.type === 'ocs') { ocs++; add({ id: 'overEarly', costS: 12 + 4 * (ocs - 1), n: ocs }); }
    else if (e.type === 'started') { start = e.delayS; if (e.delayS > R.lateS) add({ id: 'lateStart', costS: e.delayS, delayS: e.delayS }); }
    else if (e.type === 'penalty') add({ id: 'penalty', costS: 10 });
  }
  function sample(dt, s) {
    if (s.status !== 'racing') return;
    uAvg += ((s.u ?? 0) - uAvg) * Math.min(1, dt / 5);   // her recent speed (5 s): the speed a tack is measured against
    // a tack: the wind crosses the bow (the true wind's side flips) on the beat; slow while she is under REVIEW.tackRecover of her speed before it
    const sign = Math.sign(s.twaSign ?? 0);
    if (s.legKind === 'beat' && sign && lastSign && sign !== lastSign) tack = { t: 0, u0: Math.max(uAvg, 0.5), minU: s.u ?? 0 };
    if (sign) lastSign = sign;
    if (tack) {
      tack.t += dt; tack.minU = Math.min(tack.minU, s.u ?? 0);
      if ((s.u ?? 0) >= R.tackRecover * tack.u0 || tack.t > 30) {
        if (tack.t > R.slowTackS) add({ id: 'slowTack', costS: tack.t - R.tackLossS, s: +tack.t.toFixed(1) });
        tack = null;
      }
    }
    // overstood: on the beat, outside the laylines' cone below the mark (she sails extra metres to fetch it)
    if (s.legKind === 'beat' && s.mark && s.alpha && !s.inZone) {
      const dx = s.x - s.mark[0], dz = s.z - s.mark[1], dn = [-Math.sin(s.windFrom), Math.cos(s.windFrom)];   // downwind from the mark
      const along = dx * dn[0] + dz * dn[1], across = dx * dn[1] - dz * dn[0];
      if (along > 0) {
        const beyond = Math.abs(across) - along * Math.tan(s.alpha);   // metres across, outside the layline
        const b = beyond * Math.cos(s.alpha);
        if (b > over) { over = b; overSide = across > 0 ? 'one' : 'other'; }
        if (over > R.overstandM) add({ id: 'overstood', costS: over / Math.max(1, uAvg) * 0.8, m: Math.round(over) });
      }
    }
    // wide rounding: the closest she came to the mark inside its zone
    if (s.inZone && s.mark) {
      const d = Math.hypot(s.x - s.mark[0], s.z - s.mark[1]);
      if (!zone || zone.leg !== legSeen) zone = { leg: legSeen, min: d };
      zone.min = Math.min(zone.min, d);
    } else if (zone) {
      if (zone.min > R.wideM) add({ id: 'wideRounding', costS: (zone.min - 8) * 2 / Math.max(1, uAvg), m: Math.round(zone.min) });
      zone = null;
    }
    if (s.leg != null && s.leg !== legSeen) legSeen = s.leg;
    void overSide;
  }
  return { event, sample, get faults() { return faults.slice(); }, get start() { return start; }, get overstoodM() { return over; } };
}

// the one tip: the biggest measured loss, in the coach's plain words; a clean race gets the next step
export function tipFor(faults = [], { level = 'beginner', place = 1 } = {}) {
  const f = faults.slice().sort((a, b) => b.costS - a.costS)[0];
  if (!f) return place === 1 ? { id: 'clean', text: level === 'pro' ? 'A clean race. Race again and beat your time.' : `A clean race. Try ${level === 'beginner' ? 'Club' : 'Pro'} next.` }
    : { id: 'clean', text: 'A clean race. Hold your speed through each tack to catch up.' };
  switch (f.id) {
    case 'overEarly': return { id: f.id, text: 'You crossed early. Stay below the white line until the clock hits 0:00.' };
    case 'lateStart': return { id: f.id, text: `You started ${Math.round(f.delayS)} s late. Aim to be at the gold boat at 0:00.` };
    case 'overstood': return { id: f.id, text: `You sailed ${f.m} m past the layline. Tack at the glowing line.` };
    case 'slowTack': return { id: f.id, text: `A tack took ${Math.round(f.s)} s to get back up to speed. Turn smoothly and ease the sails out of the tack.` };
    case 'wideRounding': return { id: f.id, text: `You rounded ${f.m} m from the mark. Come in wide and leave close: pass a boat length away.` };
    case 'penalty': return { id: f.id, text: 'A penalty cost you a turn. Keep clear of boats on starboard and of the marks.' };
    default: return { id: f.id, text: 'Race again and sail a little cleaner.' };
  }
}

// the card's model: me and the winner from v1's race views
export function resultCard({ order, views, names = {}, me = 'me', level = 'beginner', faults = [] }) {
  const v = views[me], place = v?.place ?? (order.indexOf(me) + 1), boats = order.length, finished = v?.finishedAt != null;
  const wid = order[0], w = views[wid], winnerDone = w?.finishedAt != null;
  const gapS = finished && winnerDone && wid !== me ? v.finishedAt - w.finishedAt : null;
  const second = order[1] != null ? views[order[1]] : null;
  const leadS = place === 1 && second?.finishedAt != null ? second.finishedAt - v.finishedAt : null;
  const medal = medalFor({ place, boats, finished, gapS });
  const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th'][place - 1] ?? `${place}th`;
  return {
    place, ord, boats, finished, medal, time: finished ? mmss1(v.finishedAt) : '–', timeS: finished ? v.finishedAt : null,
    winner: wid === me ? 'You' : names[wid] ?? wid, gapS, leadS,
    gap: wid === me ? (leadS != null ? `Won by ${leadS.toFixed(1)} s` : 'You won') : gapS != null ? `+${gapS.toFixed(1)} s behind ${names[wid] ?? wid}` : `${names[wid] ?? wid} leads`,
    tip: tipFor(faults, { level, place }), level,
  };
}
void DEG;
