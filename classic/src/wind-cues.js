// Visible wind on the water (2026-10-29). Two cues a sailor reads, drawn from the
// wind field itself (no HUD, no per-effect wind). Their patterns are drawn once a frame into the look map
// (src/water-look.js: the lanes, the whitecaps' foam with its age); the water fragment reads one texel and shapes it.
//
// 1. WIND LANES (streaks): from ≈ 5–6 kn the surface shows lanes along the wind: rougher, darker bands 1–3 m across
//    and tens of metres long, between smoother slicks (Langmuir rows; SailZing "glassy streaks form in the wind's
//    direction" at 8–12 mph; Wikipedia: windrows from a 3 m/s threshold, rows 0–20° right of the wind). We orient
//    each lane by the LOCAL wind vector (the field texture), so a shift ahead bends the lanes, and a gust's lanes
//    run with the gust: the player reads the wind ahead the way a sailor does. They only darken, never lighten (a
//    pale lane lifted toward the sky at dusk in the gust work).
// 2. WHITECAPS: breaking crests from Beaufort 3–4 (7–16 kn: "scattered" to "fairly frequent white horses"); the
//    coverage follows Monahan & O'Muircheartaigh 1980, W = 3.84e-6·U10^3.41 (an ocean fit; a lake with short fetch
//    caps later, so the gate starts at 6 m/s). Above ≈ 25 kn the foam is blown into streaks along the wind (spume).
//    The crest measure comes from the surface (A's Jacobian of the Gerstner map, water.js), drawn per pixel.
import { vec2, float, max, clamp, smoothstep, dot, sin, mx_noise_float } from 'three/tsl';

// 2-D gradient noise (one octave ≈ 4 gradient taps; the 3-D fractal noise cost 8 a tap × octaves per water pixel and
// blew the frame budget, 2026-10-29): time goes into a slow drift of the coordinates, not a third axis
const n2 = (x, y) => mx_noise_float(vec2(x, y));

// the onsets and the coverage law are the shared sim's numbers (src/sim/windCues.js)
import { STREAK_ONSET, WHITECAP_ONSET, SPUME_ONSET, whitecapCoverage } from '../../src/sim/windCues.js';
export { STREAK_ONSET, WHITECAP_ONSET, SPUME_ONSET, whitecapCoverage };
const STREAK_DARK = 0.12;           // how much a lane darkens (added to the gust look's weight)
const STREAK_RIP = 0.55;            // the lanes' ripple contrast: ripple amplitude × (1 + 0.55·streak): rough lanes, smooth slicks
const STREAK_SLOPE2 = 0.006;        // extra mean-square slope on a lane (rougher water)
const STREAK_ACROSS_M = 2.2, STREAK_ALONG_M = 30;   // a lane's scale: across and along the wind
const STREAK_DRIFT = 0.03;          // the lanes drift downwind at ≈ 3 % of the wind (surface drift)

// the lane pattern at a rest point: −1..1 (positive = a rough, dark lane), already gated by the local wind speed
// xz: world rest position (vec2); windVec: the local wind vector (vec2, m/s); t: seconds. Evaluated in the look map
// pass (src/water-look.js), not per water pixel. The coordinates are relative to `anchor` (fp32 keeps centimetres),
// and warped by a slow 70 m noise (± 6 m) so a lane meanders as Langmuir rows do: a straight lane read as a ruled
// line from the overlook (2026-10-29)
const STREAK_WARP_M = 70, STREAK_WARP_AMP = 6;
export const streakAt = (xz, windVec, t, anchor = vec2(0, 0)) => {
  const U = max(windVec.length(), 0.1), wd = windVec.div(U);
  const r = xz.sub(anchor);
  const wq = r.div(STREAK_WARP_M);
  const r2 = r.add(vec2(n2(wq.x.add(t.mul(0.004)), wq.y), n2(wq.y.add(3.7), wq.x.sub(t.mul(0.004)))).mul(STREAK_WARP_AMP));
  const along = dot(r2, wd).sub(t.mul(U).mul(STREAK_DRIFT)), across = dot(r2, vec2(wd.y.negate(), wd.x));
  // two octaves of gradient noise, stretched ≈ 14:1 along the wind; a second finer set crosses it a little so the
  // lanes are not ruled lines
  const ev = t.mul(0.02);   // a slow evolution: the lanes re-form over ≈ 20 s, as Bethwaite describes
  const nA = n2(across.div(STREAK_ACROSS_M).add(ev), along.div(STREAK_ALONG_M));
  const nB = n2(across.div(STREAK_ACROSS_M * 0.5).add(7.3).sub(ev), along.div(STREAK_ALONG_M * 0.5).add(2.1));
  const gate = smoothstep(STREAK_ONSET[0], STREAK_ONSET[1], U);
  return clamp(nA.mul(1.5).add(nB.mul(0.6)), -1, 1).mul(gate);
};

// the lanes' visibility at a pixel: 1 near, 0 where a lane (2.2 m across) would alias. footprint: m per pixel along
// the view (already stretched by the grazing angle); vy: the view's vertical component. Past ≈ 0.9 m a pixel the
// lanes are texture, not lines; at grazing angles under ≈ 3° they go too (they foreshorten into horizontal rulings)
export const laneVisibility = (footprint, vy) =>
  float(1).sub(smoothstep(0.3, 0.9, footprint)).mul(smoothstep(0.025, 0.09, vy));

// whitecaps at a rest point: 0..1 foam. crest: 0..1 (1 = a crest about to break); localU: m/s; streak: streakAt()
// breakingIn: true when `crest` is already "this pixel is breaking, 0..1" as frequent as the law says (Fable A's
// Jacobian measure, log 12:57): then no second coverage pick; B only shapes the foam
export const whitecapAt = (crest, localU, xz, t, streak = float(0), windVec = vec2(0, 1), { breakingIn = false, swell = float(0.5) } = {}) => {
  const gate = smoothstep(WHITECAP_ONSET[0], WHITECAP_ONSET[1], localU);
  const U = max(localU, 0.1), wdir = windVec.div(U);
  const alongW = dot(xz, wdir), acrossW = dot(xz, vec2(wdir.y.negate(), wdir.x));
  let cap;
  if (breakingIn) {
    // the crest measure is A's Jacobian `breaking` (1 where the crest folds now, ≈ 0.45 where it folded 0.7 s ago),
    // already as frequent as Monahan's law says. B shapes it (integrator, 2026-10-29: the flat grey scraps):
    // - crest-aligned: cells ≈ 1.2 m along the wind × 5 m across it (along the crest), moving with the waves;
    // - clustered on the big crests: × the swell (height / Hs) and a 20–40 m wave-group noise;
    // - a soft falloff into lace: fine 0.3 m noise thresholded by the strength, so the breaking crest is solid
    //   white and the trailing, persisted part (0.45) thins into lacy streaks the water shows through.
    const cells = n2(alongW.mul(0.85).sub(t.mul(0.7)), acrossW.mul(0.2).add(t.mul(0.04)));
    // the wave groups: two crossed slow sines (≈ 25 × 40 m), not a noise tap (the bench allowance is +0.5 ms)
    const groups = sin(alongW.mul(0.25).sub(t.mul(0.12))).mul(sin(acrossW.mul(0.16).add(alongW.mul(0.07)).add(1.3)));
    const lace = n2(alongW.mul(3.4).add(t.mul(0.9)).add(5.1), acrossW.mul(0.7).sub(t.mul(0.2)));   // 0.3 m × 1.4 m, along the crest
    const strength = crest.mul(smoothstep(-0.45, 0.45, cells).mul(0.7).add(0.5))
      .mul(smoothstep(-0.5, 0.5, groups).mul(1.0).add(0.35)).mul(swell.mul(0.8).add(0.5));
    const solid = smoothstep(0.0, 0.7, lace.mul(0.55).add(strength.mul(1.7)).sub(0.55));   // solid at the fold, lace behind
    cap = solid.mul(strength.mul(0.5).add(0.5)).mul(gate);                                   // the lace is translucent
  } else {
    // the interim measure: height / (Hs/2); pick the capped crests by the coverage law
    const cells = n2(alongW.mul(0.65).add(t.mul(0.3)), acrossW.mul(0.16).add(t.mul(0.05))).mul(1.3);
    const thr = float(0.62).sub(smoothstep(6, 16, localU).mul(0.45));
    const pick = smoothstep(thr, thr.add(0.15), cells);
    cap = smoothstep(0.8, 1.0, crest).mul(pick).mul(gate);
  }
  // spume: at 23 kn and up the cap foam streaks downwind along the lanes, on the upper faces of the waves
  const spume = smoothstep(SPUME_ONSET[0], SPUME_ONSET[1], localU).mul(max(streak, 0)).mul(smoothstep(0.3, 0.8, crest)).mul(0.6);
  return clamp(cap.add(spume), 0, 1);
};

// The hook the water shader calls (since 2026-10-29 the patterns come from the look map):
//   createWater({ ..., windLook: createWindLook() })
//   look = windLook.lanes({ streak })             // the look map's lanes, already faded by laneVisibility
//     → { streak, dark: added to the gust-patch weight, rough: extra mean-square slope on the lanes,
//         ripple: a scale on the wind ripples' amplitude (rough lanes, smooth slicks: what the glint shows) }
//   caps = windLook.foam({ rest, wv, localU, crest, time, streak: look.streak, swell })   → 0..1 foam (whitecaps and spume)
//     (restored to the pre-look-map whitecaps, owner 2026-10-29: the aged-foam lace read as snow)
// No toVar/assign here: the water shader is plain nodes outside a Fn(), where an assign is silently dropped.
export function createWindLook({ gain = 1, breakingIn = true } = {}) {
  const lanes = ({ streak }) => {
    const lane = max(streak, 0);
    return { streak, dark: lane.mul(STREAK_DARK * gain), rough: lane.mul(STREAK_SLOPE2 * gain), ripple: float(1).add(streak.mul(STREAK_RIP)) };
  };
  const foam = ({ rest, wv, localU, crest = float(0), time, streak = float(0), swell = float(0.5) }) =>
    whitecapAt(crest, localU, rest, time, streak, wv, { breakingIn, swell });
  return { lanes, foam, streakAt };
}
