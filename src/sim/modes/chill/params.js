// Chill's settings, shared by the page (index.js) and the headless voyages (sim.js, the tests).
import { nightSchedule, dayClockSchedule, clockIsFlat } from '../../timeOfDay.js';

export const CHILL = {
  // 17:54 PDT (sun +27°, the elevation the old 47° N 17:00 start had): the afternoon breeze fading, golden hour from
  // ≈ 18:20; sunset (+3°, the night water, 20:05) ≈ 6.6 real minutes in
  hour: '17.9',
  // the reference start (the first wind sample; chooseStart picks the real one): open water east of the island
  start: { x: 270, z: 30, headingDeg: 110, speed: 2.5 },
  // the sim runs at 1× (the boat moves in real time: calm, not a time-lapse); the light runs at Day Sail's real-time
  // pace (its default 2× game speed × its 10 game s per sim s = 20 game s per real s: 1 game hour per 3 real minutes)
  simSpeed: 1,
  timeRate: 20,
  // the quick night (integrator, 2026-10-29): past deep dusk the light runs 11× faster (220 game s per sim s), so the
  // night under the stars takes ≈ 2.1 real minutes (sun under −8°: 21:13 → 04:50 PDT) instead of ≈ 23; the rate ramps
  // up from −6° to −10° and back down from −9° (the first blue light) to +6° (≈ 06:14), so dawn and the glassy calm
  // after it run at the day's pace again. A 17:54 start reaches the night ≈ 9.8 min in; the whole day loops in ≈ 49 min.
  // (At the old 47° N place: fast 9, the dusk ramp −6.5° to −9.5°. Tahoe's June night is 1.4 h longer under −8°, so
  // 11 keeps the 127 s night; the sun sinks faster here, so the wider ramp keeps the rate's frame step under 1 %.)
  night: { fast: 11, duskDeg: [-6, -10], dawnDeg: [-9, 6] },
};

// Chill's clock rate: hourOfDay → game s per sim s (src/timeOfDay.js TimeOfDay's schedule)
export const chillSchedule = () => nightSchedule({ base: CHILL.timeRate, ...CHILL.night });

// the default: the day clock (slow golden hours, a quick night); ?clock=flat keeps the old quick night above
export const chillClock = (flags) => clockIsFlat(flags) ? chillSchedule() : dayClockSchedule({ base: CHILL.timeRate });
