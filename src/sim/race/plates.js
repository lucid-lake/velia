// The race plates' models (moved from src/modes/regatta/plates.js, refactor Phase 2 step 5, so the shared race
// results read them without mode code): the watch's text, the position, the next-mark pointer, the finish card's rows. Pure
// and tested (tests/race-officer.test.mjs); src/modes/regatta/plates.js draws them on the page.
export const GAP_SHOW_S = 6;
const DEG = Math.PI / 180;
export const mmss = (s) => { const a = Math.max(0, s); return `${Math.floor(a / 60)}:${String(Math.floor(a % 60)).padStart(2, '0')}`; };
export const mmss1 = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
// the watch: the countdown before the gun (the digits of the second still to run), the race clock after
export const watchText = (clock) => (clock < 0 ? mmss(Math.ceil(-clock)) : mmss(clock));
export const ordinal = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);
export function positionText(order, me = 'me', names = { me: 'Halcyon', wren: 'Osprey' }) {
  const i = order.indexOf(me), other = order.find((id) => id !== me);
  return { place: ordinal(i + 1), other: names[other] ?? '' };
}
// the next-mark pointer: the bearing to the mark relative to the bow (deg, + to starboard), the line "W · 420 m · leave to port"
export function pointer({ pose, target, names = { W: 'W', I: 'I' }, rounding = 'port' }) {
  if (!target) return { rel: 0, text: 'Finish · cross the line', show: false };
  const dx = target.at.x - pose.x, dz = target.at.z - pose.z, brg = Math.atan2(dx, -dz);
  let rel = (brg - pose.heading) / DEG; rel = ((rel + 540) % 360) - 180;
  const d = Math.round(Math.hypot(dx, dz));
  return { rel, show: true, text: target.mark === 'Start' ? `${names.Start ?? 'Line'} · ${d} m` : `${names[target.mark] ?? target.mark} · ${d} m · leave to ${rounding}` };
}
// the finish card's rows: the winner first, never "You lose"
export function cardRows({ order, views, names, best = null }) {
  const lead = views[order[0]], rows = order.map((id, i) => {
    const v = views[id], t = v.finishedAt;
    return { id, place: ordinal(i + 1), name: names[id], time: t == null ? 'DNF' : i === 0 ? mmss1(t) : `+${mmss1(t - lead.finishedAt)}`, start: v.delayS == null ? '-' : v.ocs || v.delayS < 0 ? 'OCS' : `+${v.delayS.toFixed(1)} s`,
      splits: v.splits.map((s) => `${s.mark} ${mmss1(s.t)}`).join(' · '), topKn: v.topKn.toFixed(1) };
  });
  return { rows, best };
}
