// The visible wind's numbers (split from src/wind-cues.js for the shared sim; Sprint 0): the wind speeds at
// which the lanes, the whitecaps and the spume appear, and the whitecap coverage law. The shader half (src/wind-cues.js)
// draws them; the wake and the tests read the same numbers. Sources: src/wind-cues.js's header.
export const STREAK_ONSET = [3.0, 8.0];    // m/s local wind: lanes fade in from 3 (6 kn), full by 8 (16 kn)
export const WHITECAP_ONSET = [6.0, 10.0]; // m/s: no caps under 6 (12 kn) on the lake, the law's coverage by 10
export const SPUME_ONSET = [12, 17];       // m/s (23–33 kn): foam blown in streaks along the wind

// Monahan & O'Muircheartaigh (1980): the fraction of the sea covered by whitecaps at 10 m wind U (m/s)
export const whitecapCoverage = (U) => 3.84e-6 * Math.pow(Math.max(U, 0), 3.41);
