// The clock's menu (owner, 2026-11-09: click the clock in the top bar, a small menu under it changes the time of day): five rows,
// Dawn · Midday · Golden hour · Night · Fireworks. It reuses the one way the game moves its clock today: core.clock.setHour with
// hourJump (a cut, always forward: the day and the wind's history only run on; the same call as Cruise's Mood picker and "wait for
// dawn"). The hours (TIMES, below; they were Cruise's Mood picker's until the bottom bar was deleted, 2026-11-11): dawn 05:36, midday 13:00, golden hour 19:15,
// night 22:30 (full dark at 22:27, the Milky Way's band at its best, no moon yet). Fireworks is July 4 at the show's start
// (21:44): the clock to 10 game s before it and the evening invited, so the show runs (src/fireworks/world.js); on a page with no show
// (?day=normal) it opens the share link, as Cruise's Fireworks button does. Plain JS, no DOM.
//   const m = timeMenu({ clock, simT: () => t, hour: () => h, fireworks: () => service | null, fireworksGo?: () => … });
//   m.rows → [{ id, name }]   m.current() → the row id that matches now, or null   m.pick(id) → what it did
import { featureTimeRows, FIREWORKS_LEAD_H } from '../features/timeRows.js';   // the rows after the hours come from the features (Fireworks; the features list's pure half, so v2 can mount the menu)

// The day's periods (local PDT at Tahoe on the highlight day, 2026-07-04: sunrise 05:40, sunset 20:29, civil dusk 21:01, USNO; the
// normal day 2026-06-15: 05:34, 20:28, 21:00; golden hour from about 18:20, src/modes/chill/params.js). `hour` is where a pick puts the
// clock (null: a period that is named but never picked); `from` is where the period starts. The clock menu offers four of them.
export const TIMES = [
  { id: 'dawn', name: 'Dawn', hour: 5.6, from: 4.75 },
  { id: 'morning', name: 'Morning', hour: 8.5, from: 7 },
  { id: 'noon', name: 'Noon', hour: 13, from: 11 },
  { id: 'afternoon', name: 'Afternoon', hour: null, from: 16 },
  { id: 'golden', name: 'Golden hour', hour: 19.25, from: 18.25 },
  { id: 'dusk', name: 'Dusk', hour: 20.6, from: 20.25 },
  { id: 'night', name: 'Night', hour: 22.5, from: 21.75 },
];
// the period an hour of day falls in
export function timeOf(hourOfDay) {
  const h = ((hourOfDay % 24) + 24) % 24;
  let out = TIMES[TIMES.length - 1];   // before dawn: still the night
  for (const t of TIMES) if (h >= t.from) out = t;
  return out;
}
// the clock's next unwrapped hour at this hour of day: always ahead (the day and the wind's history only run forward)
export function hourJump(unwrapped, target) {
  const now = ((unwrapped % 24) + 24) % 24;
  let d = (((target - now) % 24) + 24) % 24;
  if (d < 1e-6) d = 24;
  return unwrapped + d;
}

const at = (id) => TIMES.find((t) => t.id === id).hour;
export const TIME_ROWS = Object.freeze([
  { id: 'dawn', name: 'Dawn', hour: at('dawn') },
  { id: 'midday', name: 'Midday', hour: at('noon') },
  { id: 'golden', name: 'Golden hour', hour: at('golden') },
  { id: 'night', name: 'Night', hour: at('night') },
  ...featureTimeRows().map(({ id, name }) => ({ id, name, hour: null })),
]);
export { FIREWORKS_LEAD_H };   // the clock lands this far before the first shell's clock (game s; src/features/timeRows.js)

// the row that matches this hour of day (the Mood's periods: Dawn from 04:45, Noon from 11:00, Golden hour from 18:15, Night from
// 21:45); mid-morning, the afternoon and dusk match none. A feature's row lit by the phase wins (the evening's lapse or show: Fireworks).
const ROW_OF = { dawn: 'dawn', noon: 'midday', golden: 'golden', night: 'night' };
export const rowFor = (hour, phase = null) => featureTimeRows().find((r) => r.lit(phase))?.id ?? ROW_OF[timeOf(hour).id] ?? null;

export function timeMenu({ clock, simT = () => 0, hour = () => null, fireworks = () => null, fireworksGo = null, search = () => globalThis.location?.search ?? '', go = (q) => { globalThis.location.search = q; } } = {}) {
  const cut = (h) => clock.setHour(hourJump(clock.hourAt(simT()), h), simT());
  return {
    rows: TIME_ROWS.map(({ id, name }) => ({ id, name })),
    current: () => { const h = hour(); return Number.isFinite(h) ? rowFor(h, fireworks()?.phase ?? null) : null; },
    pick(id) {
      const row = TIME_ROWS.find((r) => r.id === id);
      if (!row) return null;
      if (row.hour != null) { cut(row.hour); return 'time'; }
      // a feature's row (src/features/index.js timeRows: Fireworks): its own pick
      return featureTimeRows().find((r) => r.id === id).pick({ cut, fireworks, fireworksGo, search, go });
    },
  };
}
