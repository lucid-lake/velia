// Sail's music pools (fix/regressions, 2026-10-30): each world state the scheduler asks for (src/audio.js BedScheduler) is
// a pool, not one file: both takes of its own brief and one take of a neighbouring state's brief where the mood fits.
// The ten pieces of audio/music/ (tools/music_pack.py, ATTRIBUTION.md § Music); the race score stays Regatta's.
const M = (n) => `/audio/music/${n}.opus`;
export const SAIL_BEDS = {
  dawn:   [M('first_light_a'), M('first_light_b'), M('over_the_ridge_b')],
  wind:   [M('wind_rising_a'), M('wind_rising_b'), M('over_the_ridge_a')],
  vista:  [M('over_the_ridge_a'), M('over_the_ridge_b'), M('wind_rising_b'), M('first_light_a')],
  golden: [M('golden_hour_a'), M('golden_hour_b'), M('dusk_water_a'), M('first_light_b')],
  night:  [M('dusk_water_a'), M('dusk_water_b'), M('golden_hour_b')],
};
