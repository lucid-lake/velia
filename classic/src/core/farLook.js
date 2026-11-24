// The far field (S3 + S4, the Tahoe wallpaper look): the crest 20-30 km off read as a pale grey wall 6 L*
// under the sky. Measured on the bay mouth's sill at noon (A/B, 2026-11-12):
//   - the valley mist alone (?mist=0) and a far albedo alone (even at 0) did not move the crest (L* 75): takram's aerial
//     haze on it was near opaque in our setup; with that haze scaled down, the mist and the pale slate tint became the haze;
//   - the waterline's dark line is water 300-800 m off (4 px under a 1.8 m eye's horizon), not the far water. The mist's
//     colour (half the sky's horizon level) darkened it; a Fresnel cap, a higher Smith floor, a raised probe horizon and a
//     hazed trace each left it unchanged, so its cause is still open (week 1's report).
// The answer, lake-wide (no place in it): the aerial haze on surfaces kept at hazeK (Tahoe's 100 km air; takram's own
// aerosols are LUTs built from its parameters, so the scale is ours, after it), the far ground toward a deep blue slate
// and darker by albedoK past albedoNear..albedoFar, the mist thinner (mistK; the owner, 2026-10-29: the default view crisp
// and clear) and at the sky's horizon level (mistGain), and the spring snow line for the look (cheat on when: the highlight
// day is July 4, a big snow year holds 2,500 m into July;'s 3,000 m stays the day's own number for the trees
// and the towns). ?far=old: all of it off (the look before week 1).
export const FAR_LOOK = Object.freeze({
  hazeK: 0.15,         // the share of the aerial haze kept on surfaces (sky pixels untouched)
  slate: 0x2c4664,     // the far ground's depth-tint colour (was 0x55697a: a pale slate)
  albedoK: 0.35,       // the far ground's albedo scale, ramped in over albedoNear..albedoFar (m)
  albedoNear: 6000, albedoFar: 18000,
  mistGain: 2,         // the valley mist's colour scale
  mistK: 0.35,         // the valley mist's density scale
  snowLine: 2500,      // m, sea level: the ground's snow (the day's season keeps its own for the trees and towns)
});
export const farLookOn = (flags) => flags?.far !== 'old';
