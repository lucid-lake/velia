// Sail's options and start (moved from src/modes/daysail/index.js, refactor Phase 2 step 5): the start pose, the first gust,
// the day clock and coreOptions, shared by Sail, Regatta (which starts from Sail's) and Cruise's hand-over (the options
// in force once the player has the helm). Plain JS.
import { firstGustFor, DEFAULT_WIND_LEVEL } from '../../../src/sim/wind.js';
import { gustFxOn } from '../../../src/gustFx.js';
import { DEFAULT_TIMERATE, SAIL_HOUR, dayClockSchedule, clockIsFlat } from '../../../src/sim/timeOfDay.js';
import { createWake } from '../boat/wake.js';
import { STAGE_START, isStaged } from '../../../src/ui/firstVisit.js';
import { CURRENT_WATERS } from '../../../src/sim/waters/current.js';

// The start pose (art/terrain, 2026-10-29: the real Emerald Bay; was (−350, −225) 145° on the old basin, tune/opening):
// just inside the bay's mouth, on a close reach up the bay toward Fannette Island, so the opening minute has the
// island ahead, the bay's walls and a felt gust at once. (1200, −1050), heading 251° (TWA ≈ 55° to the 18:00
// breeze from ≈ 196°, channelled up the bay; port tack), under way at 2.75 m/s. The local true wind 4.5–4.7 m/s
// (≈ 9 kn: the bay's lee), so a 1.35× gust line moves the boat (SOG 2.88 → 3.21 m/s, +11 %; heel 13 → 20°, found
// at ≈ 38 s of sim time). The island 22° off the port bow at 1.6 km; ≥ 4 m deep and ≥ 30 m off the shore for the
// first 600 m (the mouth's sill is behind). Picked by a scan of the bay's water for TWA 55°, the island within 25°
// of the bow and 4–5 m/s of local wind, then the first-gust run of tests/discoveries on each.
// The pose is the lake profile's (start: { x, z, headingDeg, speed }); START is this page's lake's.
export const START = CURRENT_WATERS.start;
export const startPose = (flags, waters = CURRENT_WATERS) => {
  const START = waters.start, at = flags.start?.split(',').map(parseFloat);
  return { x: at?.length === 2 ? at[0] : START.x, z: at?.length === 2 ? at[1] : START.z, headingDeg: flags.heading != null ? parseFloat(flags.heading) : START.headingDeg, speed: isStaged(flags) ? STAGE_START.speed : START.speed };   // the staged first visit (src/ui/firstVisit.js): its own start speed
};
// D1: the first gust line, placed for the default start (met at ≈ 25 s of scene time, the surge found at ≈ 30 s:
// 15 s at 2×). 195 m ahead on the bow, × 1.35, a sharp 10 m edge (a gust line, so the step is felt, not a slow
// ramp across a 75 m blur). tests/gusts, tests/discoveries. The lake profile's (firstGust), tuned with its start.
export const FIRST_GUST = CURRENT_WATERS.firstGust;

export const daySchedule = () => dayClockSchedule({ base: DEFAULT_TIMERATE });

// What the core builds differently for Sail, before start(): the hour, the day's wind, the wake; and what the shared UI does
// in it (the mode in force's options, the 'modeOptions' service: src/modes/README.md). Regatta starts from these.
export function sailCoreOptions(flags, waters = CURRENT_WATERS) {
  const S = startPose(flags, waters);
  // Wind (L6, the CTO): Tahoe's day on the scene clock (glassy dawn, morning drift, the 13:40 lull, the afternoon
  // southwesterly 12–20 kt from ≈14:15, the evening fade), channelled along the valley with a local lee.
  // ?winddir= / ?windspeed= give a fixed wind instead (the core's steady wind); ?advisory=1 a strong afternoon.
  const fixedWind = flags.winddir || flags.windspeed;
  return {
    hud: 'calm',          // the Calm HUD's default (src/ui/calmHud.js): the bar and the dashboard fade at rest
    card: 'sail',         // the loading card and the dock speak for Sail (src/ui/loading.js markMode)
    stage: true,          // the staged first visit plays here (src/ui/firstStage.js)
    firstSail: 'goal',    // the first sail's lines and the island goal (src/ui/firstSail.js)
    fullscreenKey: true,  // Shift+F is full screen (src/shell.js)
    defaultHour: SAIL_HOUR,   // 18:45 PDT: a low warm sun at +17.4° (the approved 18:00 frame's light), the breeze fading
    timeSchedule: clockIsFlat(flags) ? null : daySchedule(),   // the day clock: slow golden hours, a quick night (?clock=flat: the constant rate)
    timeRate: DEFAULT_TIMERATE,   // D2: the day runs, 1 game hour per 3 real minutes at the default 2×
    wind: fixedWind ? null : (hour) => ({ day: { hour, rate: 1,   // the core then puts the day on its clock (setClock)
 advisory: flags.advisory },
      // the wind level 1–4 on the open bay (src/wind.js; 3 by default); ?windref=start pins it to the start's spot
      level: Math.min(4, Math.max(1, parseInt(flags.wind ?? DEFAULT_WIND_LEVEL, 10) || DEFAULT_WIND_LEVEL)),
      levelRef: flags.windref === 'start' ? { x: S.x, z: S.z } : 'bay',
      // D1: the first gust line, placed ahead of the start pose (off with ?nogust=1)
      firstGust: flags.nogust || isStaged(flags) ? null : firstGustFor({ x: S.x, z: S.z, headingDeg: S.headingDeg, ...waters.firstGust }),   // the staged first visit lays its own during play (src/ui/firstStage.js gustAt)
      // pro: the readable shifts (src/wind-shifts.js), on in Day Sail; ?shifts=0 turns them off. Chill keeps the plain
      // day (its navigator was tuned on it; it can tack on the shifts later)
      shifts: flags.shifts,
      // the gust cells (src/wind-cells.js, wow/gusts): puffs with a sharp leading edge you see coming; ?gustfx=0 off
      cells: gustFxOn(flags) }),
    // M10: the wake, which the water reads (?nowake=1 drops it); tuning knobs ?wake_amp= ?wake_rc= ?wake_r0= ?wake_bow=
    createWake: flags.nowake ? null : () => {
      const w = createWake({ kelvinSize: 512, trailN: 96 });   // the Kelvin map's size and the track's impulse count
      for (const [k, u] of [['wake_amp', 'uAmp'], ['wake_rc', 'uRc'], ['wake_r0', 'uR0'], ['wake_bow', 'uBowGain']]) {
        if (flags[k] != null) w.uniforms[u].value = parseFloat(flags[k]);
      }
      return w;
    },
  };
}
