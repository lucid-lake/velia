// The shared wind for v2, from src/sim/wind.js (the one wind module every effect reads; three-free since the sim
// split): the day's base wind (dayWind: night drainage, glassy dawn, the morning down-valley drift, the early-afternoon
// lull, the afternoon up-lake breeze, the evening fade; seeded) and v1's level bands. M1 reads the day's base at the
// scene's hour, with no gusts, shifts or terrain: the full WindField (gust noise, valley steering, lee, crest) joins at
// M2 with the terrain it reads. Frame: dirDeg is where the wind comes FROM in compass degrees (0 a north wind blowing
// toward +z south, 270 a west wind toward +x east), speed in m/s, as src/sim/wind.js says.
//   windFor({ hour, seed, level, speedMs, dirDeg }) → { speedMs, dirDeg, regime, travelRad }
//   level 1–4 (v1's ?wind levels: 4–7, 8–12, 13–17, 18–24 kn) pins the speed at the band's mean; ?windspeed / ?winddir
//   pin the numbers (v1's rows). travelRad: the waves' travel direction as atan2(z, x), the spectrum's angle.
import { dayWind, WIND_LEVELS, firstGustFor, DEFAULT_WIND_LEVEL } from '../../src/sim/wind.js';
import { CURRENT_WATERS } from '../../src/sim/waters/current.js';

const DEG = Math.PI / 180, KT = 0.514444;
export { dayWind, WIND_LEVELS };

// the waves travel downwind: from a compass direction `from`, the travel vector is (−sin from, +cos from) in (x east, z south)
export const travelRadOf = (fromDeg) => Math.atan2(Math.cos(fromDeg * DEG), -Math.sin(fromDeg * DEG));

export function windFor({ hour = 13, seed = 1, level = null, speedMs = null, dirDeg = null } = {}) {
  const day = dayWind(hour, { seed });
  let speed = day.speedMs, from = day.dirDeg, regime = day.regime;
  if (level != null && Number.isFinite(level)) { const L = WIND_LEVELS[Math.min(4, Math.max(1, Math.round(level))) - 1]; speed = L.meanKn * KT; regime = `level ${Math.round(level)}`; }
  if (speedMs != null && Number.isFinite(speedMs)) { speed = Math.max(0, speedMs); regime = 'pinned'; }
  if (dirDeg != null && Number.isFinite(dirDeg)) from = ((dirDeg % 360) + 360) % 360;
  return { speedMs: speed, dirDeg: from, regime, travelRad: travelRadOf(from) };
}

// The WindField's options on a Sail page: v1's (src/sail/options.js sailCoreOptions(flags).wind(hour), not imported: that module
// reaches the wake's three-bound code) for a day wind: the level 1–4 on the open bay (3 by default), its reference ('bay', or the
// start with ?windref=start), D1's first gust line placed ahead of the start (off with ?nogust=1 or v1's staged first visit,
// ?fv), the readable shifts (?shifts=0 off) and the gust cells (?gustfx=0 off). v2/tests/sea-parity.test.mjs holds it to
// v1's own function. start: { x, z, headingDeg } (the page's start pose); rate: the day's clock (v2's timerate).
export function sailWindOptions(flags, { hour, start = CURRENT_WATERS.start, rate = 1, waters = CURRENT_WATERS } = {}) {
  const on = (v) => v !== false && v !== '0' && v !== 0;
  const level = Math.min(4, Math.max(1, parseInt(flags.wind ?? DEFAULT_WIND_LEVEL, 10) || DEFAULT_WIND_LEVEL));
  return {
    day: { hour, rate, advisory: flags.advisory },
    level,
    levelRef: flags.windref === 'start' ? { x: start.x, z: start.z } : 'bay',
    firstGust: flags.nogust || flags.fv ? null : firstGustFor({ x: start.x, z: start.z, headingDeg: start.headingDeg, ...waters.firstGust }),
    shifts: flags.shifts ?? true,
    cells: on(flags.gustfx ?? true),
  };
}

// The first gust laid again at a new start (a birthplace's move; or the boot pose the birthplace rule chose
// after the field was built): firstGustFor ahead of the pose, on the field's base wind now. t > 0 (in play): it spreads in over
// riseS and holds its 150 s from t (src/ui/firstStage.js's staged gust does the same); t = 0: as the constructor lays it. Off
// where the page has none (?nogust=1, ?fv). The worker's copy follows through windState (src/sim/wind-texture.js).
export function relayGust(field, pose, { t = 0, flags = {}, waters = CURRENT_WATERS, riseS = 4 } = {}) {
  if (!field || flags.nogust || flags.fv) return null;
  const g = firstGustFor({ x: pose.x, z: pose.z, headingDeg: pose.headingDeg, ...waters.firstGust });
  const F = { alongM: 95, acrossM: 150, edgeM: 30, gain: 0.3, holdS: 150, fadeS: 60, driftFrac: 0, dirDeg: field.base.dirDeg, speedMs: field.base.speedMs, ...g };
  if (t > 0) Object.assign(F, { riseAt: t, riseS, holdS: t + F.holdS });
  field.first = F;
  return F;
}

// Sail's wind shifts by the player's experience (owner, 2026-11-17; src/sim/sail-shifts.js on the one WindField): which profile
// blows now. ?windshift=new|sail|race wins (0 or off: none, the lake's own shifts as before; ?shifts=0 turns both off); Cruise
// and Regatta: none (the autopilot sails Cruise's own wind, a race its pattern); Pro or the "I race" profile: race; the
// "New to it" profile, once the welcome was answered: new; else sail (the default: an experienced sailor).
//   settings: the page's store (src/ui/settings.js: profile, welcomed); pro: Pro is on now
export function sailShiftProfile({ flags = {}, mode = 'sail', settings = null, pro = false } = {}) {
  const f = flags.windshift;
  if (flags.shifts === '0' || flags.shifts === false || flags.shifts === 0) return null;
  if (f != null && f !== '') return ['new', 'sail', 'race'].includes(String(f)) ? String(f) : null;
  if (mode !== 'sail') return null;
  const profile = settings?.get?.('profile');
  if (pro || profile === 'race') return 'race';
  if (profile === 'new' && settings?.get?.('welcomed')) return 'new';
  return 'sail';
}
