// The passage: one answer to "where am I going and when do I get there", for the nav column's passage block
// (and later the chart dial's leg and the skipper's line;'s route sets it too). The target is whichever mark is in
// force: one set through the service (set / clear), else the one the chart already holds (Sail Pro's waypoint, Cruise's mark:
// chartplotter.js state.waypoint / state.dest), else Regatta's next mark (marks/course.js CourseTracker.target()). The leg starts
// where the boat was when the target appeared (or the previous waypoint when a route says so), so XTE is the error from that line.
//
//   passageTo(boat, wp, { from, hourAt, t, hour, rate })   pure: { dtw (nm), btw (deg true), closingKn, ttgMin | null, eta (h) | null, xte (nm), side }
//   etaHour(ttgMin, clock)                                the ship's clock hour on arrival
//   etaText(hour)                                          'hh:mm', the ship's clock's own 24 h form (shipClock.js)
//   ttgText(min)                                           { num, unit }: '14' min, '1:05' h, '—' when no closing speed
//   createPassage({ services })                            the 'passage' service: { set(t, from), clear(), target, from, sync() }
import { minuteOfDay } from './shipClock.js';

export const NM = 1852;
export const KN = 0.514444;
export const PASSAGE = { minClosingKn: 0.3 };
const DEG = 180 / Math.PI;

// boat: { x, z, sog (m/s), cog (rad clockwise from north) }; wp: { x, z }; from: [x, z] the leg's start (null: no leg, XTE 0)
// The ETA is on the ship's clock: hourAt(t + ttg) when the day clock is given (its schedule and rate are the truth), else
// hour + ttg x rate (rate: game seconds per sim second).
export function passageTo(boat, wp, { from = null, hourAt = null, t = 0, hour = null, rate = 1 } = {}) {
  const dx = wp.x - boat.x, dz = wp.z - boat.z, dM = Math.hypot(dx, dz);
  const btwRad = Math.atan2(dx, -dz);   // x east, z south: north is -z
  const closingKn = ((boat.sog ?? 0) * Math.cos((boat.cog ?? 0) - btwRad)) / KN;
  const ttgS = closingKn >= PASSAGE.minClosingKn ? dM / (closingKn * KN) : null;
  const eta = etaHour(ttgS == null ? null : ttgS / 60, { hourAt, t, hour, rate });
  let xte = 0, side = '';
  if (from) {
    const lx = wp.x - from[0], lz = wp.z - from[1], L = Math.hypot(lx, lz);
    if (L > 1) {
      const right = (boat.x - from[0]) * (-lz / L) + (boat.z - from[1]) * (lx / L);   // + to starboard of the track
      xte = Math.abs(right) / NM; side = right > 0.5 ? 'S' : right < -0.5 ? 'P' : '';
    }
  }
  return { dtw: dM / NM, btw: ((btwRad * DEG) % 360 + 360) % 360, closingKn, ttgMin: ttgS == null ? null : ttgS / 60, eta, xte, side };
}

// the ship's clock hour after ttgMin minutes of sailing (null: no closing speed)
export function etaHour(ttgMin, { hourAt = null, t = 0, hour = null, rate = 1 } = {}) {
  if (ttgMin == null || !Number.isFinite(ttgMin)) return null;
  if (typeof hourAt === 'function') { const h = hourAt(t + ttgMin * 60); return Number.isFinite(h) ? h : null; }
  return Number.isFinite(hour) ? hour + (ttgMin * 60 * rate) / 3600 : null;
}
export const etaText = (hour) => {
  if (!Number.isFinite(hour)) return '—';
  const m = minuteOfDay(hour);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const ttgText = (min) => {
  if (min == null || !Number.isFinite(min)) return { num: '—', unit: '' };
  const m = Math.round(min);
  return m < 60 ? { num: String(m), unit: 'min' } : { num: `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`, unit: 'h' };
};
export const dtwText = (nm) => (nm < 1 ? nm.toFixed(2) : nm < 100 ? nm.toFixed(1) : String(Math.round(nm)));

// the mark in force from the live sources (nothing set by hand): the chart's waypoint (Sail Pro) or destination (Cruise), else
// Regatta's next mark
export function chartTarget(services) {
  const st = services.get('chart')?.state;
  if (st?.waypoint) return { x: st.waypoint.x, z: st.waypoint.z, name: 'WP', kind: 'waypoint' };
  if (st?.dest) return { x: st.dest.x, z: st.dest.z, name: st.dest.name ?? 'your mark', kind: 'mark' };
  const tg = services.get('regatta')?.marks?.tracker?.target?.();
  if (tg?.at && !tg.done) return { x: tg.at.x, z: tg.at.z, name: /^m\d+$/.test(tg.mark ?? '') ? tg.mark.slice(1) : String(tg.mark ?? tg.leg + 1), kind: 'course' };   // 'MARK 2', 'MARK WINDWARD'
  return null;
}

export function createPassage({ services } = {}) {
  let manual = null, live = null, liveKey = '';
  const boat = () => services?.get?.('player')?.phys?.state ?? null;
  const api = {
    // t: { x, z, name }; from: [x, z] the leg's start (default: the boat now)
    set(t, from = null) { const b = boat(); manual = t ? { target: { x: t.x, z: t.z, name: t.name ?? 'your mark', kind: t.kind ?? 'route' }, from: from ?? (b ? [b.x, b.z] : null) } : null; },
    clear() { manual = null; },
    // the boat moved without sailing there (v2's birthplace move): the leg to the same target starts again from where she is now
    replan() { const b = boat(); if (!b) return; if (manual) manual.from = [b.x, b.z]; if (live) live.from = [b.x, b.z]; },
    // read the live sources once (the column calls it at its own rate); a new target starts a new leg from the boat
    sync() {
      if (manual) return manual;
      const tg = services ? chartTarget(services) : null, key = tg ? `${tg.kind}|${Math.round(tg.x)}|${Math.round(tg.z)}` : '';
      if (key !== liveKey) { liveKey = key; const b = boat(); live = tg ? { target: tg, from: b ? [b.x, b.z] : null } : null; }
      else if (live && tg) live.target = tg;
      return live;
    },
    get target() { return (manual ?? live)?.target ?? null; },
    get from() { return (manual ?? live)?.from ?? null; },
  };
  return api;
}
