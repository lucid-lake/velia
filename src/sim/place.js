// Where and when the light is (owner, 2026-10-29: real Lake Tahoe; owner, 2026-11-07: each map fixed at its highlight
// day, a normal day kept in the system: src/day.js). Plain JS, no three.js: the sky (src/core/sky.js), the daylight
// (src/daylight.js) and the analytic sun (src/timeOfDay.js) all read it.
//   The observer: the lake's origin (Fannette Island's summit, src/geo.js ORIGIN), on the lake surface (Y0, 1,897.9 m).
//   The day: the highlight day, 2026-07-04 (?day=normal: 2026-06-15; ?day=YYYY-MM-DD: any date). The scene's hour is
//   local clock time, PDT (UTC−7): ?hour=18 is 6 pm at the lake.
// At Tahoe (120.1° W) on 2026-07-04: sunrise 05:40, solar noon 13:05, sunset 20:29, civil dusk 21:01 PDT; on
// 2026-06-15: 05:34, 13:01, 20:28, 21:00 (USNO Astronomical Applications). The wind's day
// (src/wind.js) is written in the same local clock hours.
// The numbers are the lake profile's (src/waters/<id>.json: lat, lon, terrain.surfaceM, day): makePlace(waters, day).
import { CURRENT_WATERS } from './waters/current.js';
import { pickDay, dayChoice } from './day.js';

export const makePlace = (waters, day = pickDay(waters, dayChoice())) => ({
  latDeg: waters.lat,                // 38.954159° N
  lonDeg: waters.lon,                // −120.100464° (W)
  altM: waters.terrain.surfaceM,     // the lake surface, m (the atmosphere's world y = 0)
  date: day.date,                    // '2026-07-04' (the highlight day; '2026-06-15' the normal day)
  day: day.key,                      // 'highlight' | 'normal' | the ?day date
  utcOffsetH: day.utcOffsetH,        // −7: PDT
});
// this page's lake (src/waters/current.js) on this page's day; the terrain object carries the same (makeTerrain().place)
export const PLACE = makePlace(CURRENT_WATERS);

// ms since the epoch at the scene's hour (local clock hours on PLACE.date; past 24 runs into the next day)
export function timeAt(hour, place = PLACE) {
  return Date.parse(`${place.date}T00:00:00Z`) + (hour - place.utcOffsetH) * 3600 * 1000;
}
