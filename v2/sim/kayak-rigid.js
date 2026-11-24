// Rigid transforms as three rows of [r | t] (12 floats, the kayaks' palette and instance format: clip.js poseRows), with a
// uniform scale allowed in r. Pure, allocation-free (the caller's arrays; a few module scratch numbers).
//   mulRows(a, b, out)        out = a · b
//   invRigid(a, out)          out = a⁻¹ (a rotation × a uniform scale, and a translation)
//   blendRows(a, b, k, out)   between a (k 0) and b (k 1): the turn by a normalised quaternion lerp, the place and the
//                             scale by a lerp (a light object eased from one pose to the next: the paddle, the climber)
const Q0 = new Float64Array(4), Q1 = new Float64Array(4), T = new Float64Array(12);

export function mulRows(a, b, out, ao = 0, bo = 0, oo = 0) {
  for (let r = 0; r < 3; r++) {
    const a0 = a[ao + r * 4], a1 = a[ao + r * 4 + 1], a2 = a[ao + r * 4 + 2], a3 = a[ao + r * 4 + 3];
    T[r * 4] = a0 * b[bo] + a1 * b[bo + 4] + a2 * b[bo + 8];
    T[r * 4 + 1] = a0 * b[bo + 1] + a1 * b[bo + 5] + a2 * b[bo + 9];
    T[r * 4 + 2] = a0 * b[bo + 2] + a1 * b[bo + 6] + a2 * b[bo + 10];
    T[r * 4 + 3] = a0 * b[bo + 3] + a1 * b[bo + 7] + a2 * b[bo + 11] + a3;
  }
  for (let k = 0; k < 12; k++) out[oo + k] = T[k];
  return out;
}

export function invRigid(a, out) {
  const s2 = a[0] * a[0] + a[4] * a[4] + a[8] * a[8] || 1;   // the scale², from the first column
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) T[r * 4 + c] = a[c * 4 + r] / s2;
  for (let r = 0; r < 3; r++) T[r * 4 + 3] = -(T[r * 4] * a[3] + T[r * 4 + 1] * a[7] + T[r * 4 + 2] * a[11]);
  for (let k = 0; k < 12; k++) out[k] = T[k];
  return out;
}

function toQuat(m, q) {
  const s = Math.hypot(m[0], m[4], m[8]) || 1;
  const m00 = m[0] / s, m01 = m[1] / s, m02 = m[2] / s, m10 = m[4] / s, m11 = m[5] / s, m12 = m[6] / s, m20 = m[8] / s, m21 = m[9] / s, m22 = m[10] / s;
  const tr = m00 + m11 + m22;
  if (tr > 0) { const k = 0.5 / Math.sqrt(tr + 1); q[3] = 0.25 / k; q[0] = (m21 - m12) * k; q[1] = (m02 - m20) * k; q[2] = (m10 - m01) * k; }
  else if (m00 > m11 && m00 > m22) { const k = 2 * Math.sqrt(1 + m00 - m11 - m22); q[3] = (m21 - m12) / k; q[0] = 0.25 * k; q[1] = (m01 + m10) / k; q[2] = (m02 + m20) / k; }
  else if (m11 > m22) { const k = 2 * Math.sqrt(1 + m11 - m00 - m22); q[3] = (m02 - m20) / k; q[0] = (m01 + m10) / k; q[1] = 0.25 * k; q[2] = (m12 + m21) / k; }
  else { const k = 2 * Math.sqrt(1 + m22 - m00 - m11); q[3] = (m10 - m01) / k; q[0] = (m02 + m20) / k; q[1] = (m12 + m21) / k; q[2] = 0.25 * k; }
  return s;
}

export function blendRows(a, b, k, out) {
  if (k <= 0) { for (let i = 0; i < 12; i++) out[i] = a[i]; return out; }
  if (k >= 1) { for (let i = 0; i < 12; i++) out[i] = b[i]; return out; }
  const sa = toQuat(a, Q0), sb = toQuat(b, Q1), sg = Q0[0] * Q1[0] + Q0[1] * Q1[1] + Q0[2] * Q1[2] + Q0[3] * Q1[3] < 0 ? -1 : 1;
  let x = Q0[0] * (1 - k) + sg * Q1[0] * k, y = Q0[1] * (1 - k) + sg * Q1[1] * k, z = Q0[2] * (1 - k) + sg * Q1[2] * k, w = Q0[3] * (1 - k) + sg * Q1[3] * k;
  const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
  const s = sa * (1 - k) + sb * k, tx = a[3] * (1 - k) + b[3] * k, ty = a[7] * (1 - k) + b[7] * k, tz = a[11] * (1 - k) + b[11] * k;
  out[0] = (1 - 2 * (y * y + z * z)) * s; out[1] = 2 * (x * y - z * w) * s; out[2] = 2 * (x * z + y * w) * s; out[3] = tx;
  out[4] = 2 * (x * y + z * w) * s; out[5] = (1 - 2 * (x * x + z * z)) * s; out[6] = 2 * (y * z - x * w) * s; out[7] = ty;
  out[8] = 2 * (x * z - y * w) * s; out[9] = 2 * (y * z + x * w) * s; out[10] = (1 - 2 * (x * x + y * y)) * s; out[11] = tz;
  return out;
}
