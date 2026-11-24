// The ship's clock in words (owner, 2026-11-09: "I like the time in the top bar"; "remove the Sat info, keep it short"; "use 24hr, our
// goal is short"): the readout at the end of the top bar, "4 Jul · 21:45". It reads the game's hour (core.sun.hour, the day clock) and the
// map's date (src/place.js PLACE.date), never the wall clock. 24-hour, no weekday; minute resolution; the date is the map's day and does not
// advance past midnight. Plain JS, no DOM.
//   shipClock({ hour, date }) → { full, time, label }     full "4 Jul · 21:45"   time "21:45" (a window too narrow for the date)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MON_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// whole minutes into the day, 0..1439 (the minute that has begun; 21:45:59 reads 21:45)
export const minuteOfDay = (hour) => (((Math.floor(hour * 60 + 1e-6) % 1440) + 1440) % 1440);

export function shipClock({ hour, date } = {}) {
  if (!Number.isFinite(hour)) return null;
  const m = minuteOfDay(hour), time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const t = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(t)) return { full: time, time, label: time };
  const d = new Date(t), day = d.getUTCDate(), mon = d.getUTCMonth();
  return { full: `${day} ${MON[mon]} · ${time}`, time, label: `${day} ${MON_LONG[mon]}, ${time}` };
}
// the widest reading, for the bar's reserved width (tabular digits: any hh:mm is as wide as 20:59)
export const widest = ({ date } = {}) => shipClock({ hour: 20.99, date });
