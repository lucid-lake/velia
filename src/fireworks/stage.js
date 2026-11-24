// The staging (owner decision 2026-11-08, strategy A): a nearby barge show off Emerald Bay's mouth,
// shells drawn 3×, the real South Lake show and Tahoe City's pops small on the horizon. Plain JS (tests/fireworks).
// Bearings clockwise from north; world x east, z south (src/geo.js).
import { burstHeight, burstRadius, SHELL_SPEC } from './shells.js';
import { riserFor } from './physics.js';
import { makeFarShow } from './show.js';

export const SILL = [1687, -1270];          // the mouth's sill, 14.5 m deep: the far shows' reference
// The wow round (owner 2026-11-08: "I need the boat close"; "the whole reason we added July 4 is this breathtaking
// moment"): the shells drawn 2.2× (from 250 m they fill the sky over the mast, the biggest overhead), was 3× from 720 m
export const SCALE = 2.2;                   // the shells' scale (sizes, heights and gravity; times stay real)
// The viewing spot (realism round, 2026-11-08; the same for Sail, Cruise and the share link): Cruise's anchorage inside the
// mouth (src/fireworks/share.js CRUISE_SPOT, 9.7 m deep). The game's mouth has no channel: its deepest crossing is 0.55 m
// (a 10 m grid's widest path, the game's terrain) and the keel draws 1.6 m, so no boat of ours anchors outside the bar.
// The barges came in to it instead (they were 760–780 m off the sill, 1.2 km from here): 720 m off it, through the
// mouth, in 70–80 m of open water outside the bar. With the shells drawn 3×, 720 m looks like a real show from 240 m: NFPA
// 1123's rule of thumb (70 ft an inch of the largest shell) asks 256 m for a 12" shell. A literal 300–400 m with 3× shells
// would look like a real show from 100–130 m: the finale overhead, out of any frame that keeps the water.
export const VIEW = [1350, -960];
// The wow round: two flat steel barges 250 m from the viewing spot, inside the bay south-west of it (the keel cannot reach
// any water outside the bar within 400 m; the owner: the barges' realism is secondary, the wow primary), in 30–33 m of
// water, 240–300 m off the shore, the bay's walls and Fannette behind the show. Was 720 m out through the mouth.
export const BARGE_SPOTS = [{ bearing: 228, d: 250 }, { bearing: 258, d: 250 }];
export const AIM = (BARGE_SPOTS[0].bearing + BARGE_SPOTS[1].bearing) / 2;   // the show's middle from the viewing spot, 243°

export const at = (bearingDeg, d, from = VIEW) => { const a = bearingDeg * Math.PI / 180; return [from[0] + d * Math.sin(a), from[1] - d * Math.cos(a)]; };
const bearingTo = (x, z, from = VIEW) => ((Math.atan2(x - from[0], -(z - from[1])) * 180 / Math.PI) + 360) % 360;
// each barge: its world spot and its long axis, square to the line of sight from the viewing spot (the cakes fan along it)
export const bargesWorld = (spots = BARGE_SPOTS, from = VIEW) => spots.map(({ bearing, d }) => {
  const [x, z] = at(bearing, d, from), a = bearing * Math.PI / 180;
  return { x, z, axis: [Math.cos(a), Math.sin(a)], bearing, d };
});

// a shell seen from a point: its burst's elevation, its top's, and its width across the sky (degrees)
export function shellAngles(from, barge, inches, scale = SCALE, eye = 3) {
  const d = Math.hypot(barge.x - from[0], barge.z - from[1]);
  const h = burstHeight(inches) * scale, r = burstRadius(inches) * scale, deg = 180 / Math.PI;
  return { d, burst: Math.atan2(h - eye, d) * deg, top: Math.atan2(h + r - eye, d) * deg, low: Math.atan2(h - r - eye, d) * deg, width: 2 * Math.atan2(r, d) * deg };
}
// the finale's span along the horizon (degrees): from the left edge of the leftmost big burst to the right edge of the rightmost
export function finaleSpan(from = VIEW, barges = bargesWorld(), inches = 12, scale = SCALE) {
  const half = barges.map((b) => shellAngles(from, b, inches, scale).width / 2), br = barges.map((b) => bearingTo(b.x, b.z, from));
  return Math.max(...br.map((b, i) => b + half[i])) - Math.min(...br.map((b, i) => b - half[i]));
}

// The frame (owner, 2026-11-08 polish: "the biggest finale shells still clip at the top of the frame"). At 3× from 780 m a
// 12" shell is 52° wide and its top stars climb past 65°: no frame that keeps the water fits it. Two levers together:
// the cameras look higher and wider during the show (SHOW_FRAME: Sail's follow camera, eased in and out by
// src/fireworks/world.js; HERO_CAM: the demo's hero framing), and the near show's shells over 6" are drawn a little smaller
// (fitShow: height and radius × FRAME_LAW.g(inches), the star count kept, so the big ones stay dense and bright).
// Realism round: the viewing spot is 720 m from the barges (was the sill at 780 m), the same law holds (tested from VIEW).
export const SHOW_FRAME = { look: 0.62, fov: 40 };   // wow round: was 0.55 / 30 (the show 720 m off)   // the follow camera's tilt up (rad) and extra field (degrees) during the show
export const HERO_CAM = { back: 15, y: 1.4, pitch: 32, fov: 84 };   // wow round: the close film's lens (was 34 m back, 1.8 m, 22°)   // 1.8 m over the water, 34 m behind the boat, pitched up, an 84° field
const FRAME_LAW = { from: 6, k: 0.45 };   // over 6": each inch above draws as k of an inch (12" as 8.7", 10" as 7.8")
export const frameGain = (inches, law = FRAME_LAW) => (inches <= law.from ? 1 : (law.from + (inches - law.from) * law.k) / inches);
// the show with the frame law applied: an aerial over 6" bursts lower (a new riser to the lower height) and opens smaller
// (e.spread for buildShell); ground effects and the rest unchanged. Pure: a new show, the same events otherwise.
// The game's show (wow round): seed's script with a second seed's shells joined in before the finale's climax (twice
// the density from the opening to 268 s; the finale left as is: the pool), without the Niagaras (a picket fence of drips
// this close) and the palms (the trunk a thick rod); the frame law over it. Pure, deterministic.
export function wowShow(makeShow, seed = 1, { until = 268, tall = false, barges = bargesWorld() } = {}) {   // barges: v2's launch site (v2/sim/fireworksSite.js)
  const a = makeShow(seed), b = makeShow(seed + 1000);
  const extra = b.events.filter((e) => e.t < until).map((e) => ({ ...e, seed: (e.seed ^ 0x5a5a) >>> 0 }));
  const events = [...a.events, ...extra].filter((e) => e.type !== 'niagara' && e.type !== 'palm')
    .sort((p, q) => p.t - q.t || p.i - q.i).map((e, i) => ({ ...e, i }));
  return spreadShow(fitShow({ ...a, events }), { barges, law: tall ? SPREAD_TALL : SPREAD_LAW });
}
// Look round 2 (F2 staging; owner: the bursts pile at the top centre and are cut by the top edge). A show
// designer's layout, a cheat on where (never on motion: each riser is a new, real one to its own height and lean): the
// mortars are angled across the view and the shells burst at different heights, so the sky fills from the ridge line up
// and from side to side. Small shells go wide, big ones stay near the middle and lower (a 12" drawn as 8.7" is 48° wide
// from 250 m: it only fits the middle). Per barge, the k-th aerial takes its lean and its height from two even sequences
// (the golden ratio's and the plastic number's), so shells that follow each other land in different parts of the sky.
//   lean: the riser's tilt along the barge's axis (the viewer's right), rad; the left barge leans left, the right one right
//   low..high: the burst height x this (the frame law's height first)
//   highSmall..highBig: the top of that range by size; edge: the top comes down by this share at the full lean (a wide lens
//   draws what is off its axis higher: a burst at the side of the frame must sit lower to keep its top in)
// Two layouts (fitted on the boat shots, tests/fireworksCruise.test.mjs): the wide screen's spreads across the sky and keeps
// the big shells low enough for the top edge; an upright phone's frame is 62 deg wide (one 6" burst is 33 deg), so its
// layout stacks the bursts up the tall frame, leaning in a little (out < 0), never wide.
// fall: the falling shells (FALLING: willows, horsetails, brocades, whose trails droop for seconds) lean away from the
// boat's mast (lean + up to 0.1 more), at the others' heights: near the mast their trails stood as a column behind it and
// read as a fire on board (round 2's flaw). The mast's side of the frame is the boat shot's at the burst (MAST_SIDE:
// src/fireworks/shots.js, the one-tap show's boat shots; +1 right of the middle, -1 left; tests/fireworksCruise.test.mjs
// checks it against the shots' own cameras)
export const FALLING = new Set(['willow', 'horsetail', 'brocade']);
// awaySmall..awayBig: the riser's tilt away from the viewer by size (rad; a display's mortars lean away from the crowd):
// a big shell bursts farther off, so it fits the frame without being drawn low
// floor: no burst lower than floor x its own radius (the type's reach and the frame law's spread in): lower, its bottom
// stars opened near the water and fell into the frame's water band and in front of the hills (round 2's flaw: a 5"
// brocade at 0.4 burst at 132 m with a 144 m radius)
export const MAST_SIDE = (t) => (t >= 75 && t < 205 ? -1 : 1);   // the reflection and boat shots (and the crowd spans' boat shot) put her left
export const SPREAD_LAW = { small: 4, big: 8, leanSmall: 0.55, leanBig: 0.24, out: 0.08, lowSmall: 0.8, lowBig: 0.7, highSmall: 1, highBig: 0.85, edge: 0.3,
  fall: { lean: 0.36, low: 0.95, high: 1 }, floor: 1.7, awaySmall: 0, awayBig: 0.3 };
export const SPREAD_TALL = { small: 4, big: 8, leanSmall: 0.1, leanBig: 0.03, out: -0.06, lowSmall: 0.6, lowBig: 0.7, highSmall: 1.3, highBig: 1.1, edge: 0 };
export function spreadShow(show, { barges = bargesWorld(), law = SPREAD_LAW, mastSide = MAST_SIDE } = {}) {
  const count = barges.map(() => 0), mid = (barges.length - 1) / 2;
  const events = show.events.map((e) => {
    if (e.ground) return e;
    const bi = e.barge % barges.length, k = count[bi]++, ax = barges[bi].axis;
    const u = (k * 0.6180339887 + bi * 0.37) % 1, v = (k * 0.7548776662 + 0.31 + bi * 0.5) % 1;
    const big = Math.min(1, Math.max(0, (e.inches - law.small) / (law.big - law.small)));
    const fall = law.fall && FALLING.has(e.type);
    const lean = fall ? -mastSide(e.burst) * (law.fall.lean + 0.1 * u) : (u * 2 - 1) * (law.leanSmall + (law.leanBig - law.leanSmall) * big) + Math.sign(bi - mid) * law.out;
    const low = fall ? law.fall.low : law.lowSmall + (law.lowBig - law.lowSmall) * big;
    const high = fall ? law.fall.high : (law.highSmall + (law.highBig - law.highSmall) * big) * (1 - law.edge * Math.abs(u * 2 - 1));
    const floor = law.floor ? law.floor * burstRadius(e.inches) * (SHELL_SPEC[e.type]?.reach ?? 1) * (e.spread ?? 1) : 0;
    const height = +Math.min(e.height, Math.max(floor, e.height * (low + (high - low) * v))).toFixed(2), R = riserFor(Math.round(height));
    const away = (law.awaySmall ?? 0) + ((law.awayBig ?? 0) - (law.awaySmall ?? 0)) * big;   // along the line of sight (ax turned a quarter: away from the viewer)
    return { ...e, height, tilt: [+(e.tilt[0] + ax[0] * lean + ax[1] * away).toFixed(4), +(e.tilt[1] + ax[1] * lean - ax[0] * away).toFixed(4)], v0: +R.v0.toFixed(4), rise: +R.t.toFixed(4), burst: +(e.t + R.t).toFixed(4) };
  });
  return { ...show, events };
}
export function fitShow(show, law = FRAME_LAW) {
  const events = show.events.map((e) => {
    const g = e.ground ? 1 : frameGain(e.inches, law);
    if (g === 1) return e;
    const height = +(e.height * g).toFixed(2), R = riserFor(Math.round(height));
    return { ...e, height, spread: +g.toFixed(4), v0: +R.v0.toFixed(4), rise: +R.t.toFixed(4), burst: +(e.t + R.t).toFixed(4) };
  });
  return { ...show, events };
}

// The far shows (S2): South Lake's Lights on the Lake on its real bearing from the sill, drawn at 3.6 km (a third of its
// 10.8 km, as the near show is drawn 3×), and Tahoe City's at 7.7 km on its own bearing; both at real size, on our show's
// clock. Their bursts open FAR_SPREAD × wider than real (S4 fix, with the far tier's few dozen stars: a 5" peony at 3.6 km
// was a 15 px ball of merged heads, a floating disc over the horizon; wider and sparser it reads as a burst of points).
// lonLatToWorld: src/geo.js's (passed in, so this file stays plain JS for the tests). → { show, barges }
export const FAR_SPREAD = 1.6;
const FAR_SPOTS = [{ lat: 38.9665, lon: -119.9560, d: 3600 }, { lat: 39.1675, lon: -120.1390, d: 7700 }];
export function farStage(seed, lonLatToWorld, from = SILL) {
  const barges = FAR_SPOTS.map(({ lat, lon, d }) => { const [x, z] = lonLatToWorld(lon, lat), [px, pz] = at(bearingTo(x, z, from), d, from); return { x: px, z: pz, axis: [0, 1] }; });   // from the sill, as before
  const sl = makeFarShow({ seed: seed * 7 + 1, start: -240, length: 560, gap: [1.5, 4], finaleAt: 300 });
  const tc = makeFarShow({ seed: seed * 7 + 2, start: -900, length: 1250, gap: [5, 11] });
  const events = [...sl.events.map((e) => ({ ...e, barge: 0 })), ...tc.events.map((e) => ({ ...e, barge: 1 }))]
    .sort((a, b) => a.t - b.t).map((e, i) => ({ ...e, i, spread: e.ground ? 1 : FAR_SPREAD }));
  return { show: { events, far: true }, barges };
}
