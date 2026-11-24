// The water's wind texture off the main thread. Plain JS: node tests, src/water.js and the worker
// (src/wind-worker.js) share it. The texture is the WindField's toTexture() at the frame's time over a 4 km square
// round a 512 m snapped centre, stored as half floats, with an ≈ 800 m box mean of the speed beside it.
//
// The worker runs the SAME toTexture() on its own WindField: the page sends the field's per-frame state (the day's
// base, gusts and shift at t, the advection at t, the level fronts, the first gust: windState), the worker applies
// it (applyWindState: the modifiers' states too, src/wind-modifiers.js) and its terrain caches are its own
// (terrain-only numbers). So a result for the same t and centre is the same bits as the page's own. The page uses it
// when it matches the frame; while time moves it may use the last one (a frame or two old), and with nothing yet it
// computes in place, as before.
import { WindShifts } from './wind-shifts.js';
import { SailShifts } from './sail-shifts.js';

export const WIND_TEX = 256;   // px; over WIND_EXTENT that is 16 m a texel, well under a gust (~180 m)
export const WIND_EXTENT = 4096;   // centred on the camera (snapped), so the open lake never sees a clamped edge
const MEAN_R = 25;   // texels: 25 × 16 m each side, an ≈ 800 m box

// a separable box mean of radius r texels over an n × n map (edges clamped), running sums: ≈ 0.3 ms for 256²
function boxMean(src, out, n, r) {
  const tmp = boxMean.tmp?.length === src.length ? boxMean.tmp : (boxMean.tmp = new Float32Array(src.length));
  for (const [a, b, sx, sy] of [[src, tmp, 1, n], [tmp, out, n, 1]]) {
    for (let line = 0; line < n; line++) {
      const o = line * sy;
      let sum = 0;
      for (let k = -r; k <= r; k++) sum += a[o + Math.min(n - 1, Math.max(0, k)) * sx];
      for (let i = 0; i < n; i++) {
        b[o + i * sx] = sum / (2 * r + 1);
        sum += a[o + Math.min(n - 1, i + r + 1) * sx] - a[o + Math.max(0, i - r) * sx];
      }
    }
  }
  return out;
}

// float → half float, three.js's DataUtils.toHalfFloat (the same tables; tests/wind-texture checks every case)
const T = (() => {
  const buffer = new ArrayBuffer(4), floatView = new Float32Array(buffer), uint32View = new Uint32Array(buffer);
  const baseTable = new Uint32Array(512), shiftTable = new Uint32Array(512);
  for (let i = 0; i < 256; ++i) {
    const e = i - 127;
    if (e < -27) { baseTable[i] = 0x0000; baseTable[i | 0x100] = 0x8000; shiftTable[i] = 24; shiftTable[i | 0x100] = 24; }
    else if (e < -14) { baseTable[i] = 0x0400 >> (-e - 14); baseTable[i | 0x100] = (0x0400 >> (-e - 14)) | 0x8000; shiftTable[i] = -e - 1; shiftTable[i | 0x100] = -e - 1; }
    else if (e <= 15) { baseTable[i] = (e + 15) << 10; baseTable[i | 0x100] = ((e + 15) << 10) | 0x8000; shiftTable[i] = 13; shiftTable[i | 0x100] = 13; }
    else if (e < 128) { baseTable[i] = 0x7c00; baseTable[i | 0x100] = 0xfc00; shiftTable[i] = 24; shiftTable[i | 0x100] = 24; }
    else { baseTable[i] = 0x7c00; baseTable[i | 0x100] = 0xfc00; shiftTable[i] = 13; shiftTable[i | 0x100] = 13; }
  }
  return { floatView, uint32View, baseTable, shiftTable };
})();
export function toHalf(val) {
  val = Math.min(65504, Math.max(-65504, val));
  T.floatView[0] = val;
  const f = T.uint32View[0], e = (f >> 23) & 0x1ff;
  return T.baseTable[e] + ((f & 0x007fffff) >> T.shiftTable[e]);
}

// the field's state toTexture() reads at t, as plain data (after the field's own at(t) and advection(t))
export function windState(field, t) {
  field.at(t);
  const adv = field.advection(t);
  return {
    t, adv, seed: field.seed, dayMs: field.dayMs, day: !!field.day,
    base: { ...field.base }, gust: { ...field.gust }, shift: { ...field.shift },
    first: field.first ? { ...field.first } : null,
    // each modifier's state (src/wind-modifiers.js: the gust cells' options, the storm's outflow), plain data
    ...Object.fromEntries(field.modifiers.map((m) => [m.key, field[m.key] ? { ...field[m.key] } : null])),
    lv: field.lv ? JSON.parse(JSON.stringify(field.lv)) : null,          // the level, its fronts, its settled scale
    shifts: field.shifts ? JSON.parse(JSON.stringify(field.shifts.o)) : null,   // the readable shifts' options (Day Sail)
    sailShifts: field.sailShifts ? field.sailShifts.state() : null,   // Sail's shifts by experience (src/sim/sail-shifts.js): the profile and its blend
    pattern: !!field.pattern,   // a race's pattern runs (the worker has none: it drops Sail's shifts and keeps the lake's own, as before)
  };
}
// a field (the worker's) set to that state: its clock and advection answer from it
export function applyWindState(field, s) {
  Object.assign(field.base, s.base); Object.assign(field.gust, s.gust); Object.assign(field.shift, s.shift);
  field.dayMs = s.dayMs; field.first = s.first; field.day = s.day ? (field.day ?? {}) : null;
  field.lv = s.lv;
  for (const m of field.modifiers) field[m.key] = s[m.key] ?? null;   // the same modifiers run on the worker's field
  const so = s.shifts ? JSON.stringify(s.shifts) : null;
  if (so !== field.shiftsKey) { field.shifts = s.shifts ? new WindShifts(field, s.shifts) : null; field.shiftsKey = so; }
  const ss = s.sailShifts && !s.pattern ? JSON.stringify(s.sailShifts) : null;   // a race's pattern: the lake's own, as before
  if (ss !== field.sailShiftsKey) { field.sailShifts = ss ? SailShifts.fromState(s.sailShifts) : null; field.sailShiftsKey = ss; }
  field.at = () => {};
  field.advection = () => s.adv;
}

// the texture and its mean for a field at t, as half floats (into out's arrays)
export function fillWindTexture(field, t, cx, cz, out = newWindBuffers()) {
  const f = field.toTexture(WIND_TEX, WIND_EXTENT, t, cx, cz);
  for (let k = 0; k < f.length; k++) out.wind[k] = toHalf(f[k]);
  for (let k = 0; k < out.speed.length; k++) out.speed[k] = Math.hypot(f[2 * k], f[2 * k + 1]);
  boxMean(out.speed, out.meanF, WIND_TEX, MEAN_R);
  for (let k = 0; k < out.mean.length; k++) out.mean[k] = toHalf(out.meanF[k]);
  return out;
}
export function newWindBuffers() {
  const n = WIND_TEX * WIND_TEX;
  return { wind: new Uint16Array(n * 2), mean: new Uint16Array(n), speed: new Float32Array(n), meanF: new Float32Array(n) };
}
