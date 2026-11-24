// Dirty air: a boat's wind shadow, a cone downwind of the rig. 7 mast heights long (85 m), 1.5 boat
// lengths wide at the boat to 3 at the end, -18 % of the wind speed at the core, fading to 0 at the edge and the end.
// Symmetric and the same for both boats; not drawn. Plain JS.
//   const windAt = shadowed(baseWindAt, () => [{ x, z }, ...]);   // → windAt(x, z, t) with the shadows taken out
export const SHADOW = { lengthM: 85, w0: 1.5 * 8.6, w1: 3 * 8.6, core: 0.18 };

// the fraction of the wind removed at (x, z) by a boat at (sx, sz) with the wind blowing toward (tx, tz) (unit)
export function shadowAt(sx, sz, tx, tz, x, z, S = SHADOW) {
  const dx = x - sx, dz = z - sz, d = dx * tx + dz * tz;
  if (d <= 0 || d >= S.lengthM) return 0;
  const c = Math.abs(dx * -tz + dz * tx), half = (S.w0 + (S.w1 - S.w0) * d / S.lengthM) / 2;
  if (c >= half) return 0;
  return S.core * (1 - d / S.lengthM) * (1 - c / half);
}

export function shadowed(windAt, others, S = SHADOW) {
  return (x, z, t) => {
    const w = windAt(x, z, t), v = Math.hypot(w.vx, w.vz);
    if (v < 0.3) return w;
    const tx = w.vx / v, tz = w.vz / v;
    let keep = 1;
    for (const o of others()) keep *= 1 - shadowAt(o.x, o.z, tx, tz, x, z, S);
    return keep === 1 ? w : { ...w, vx: w.vx * keep, vz: w.vz * keep };
  };
}
