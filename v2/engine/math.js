// Column-major 4×4 matrices on Float32Array(16), WebGPU clip space (z in [0, 1], y up). Every function writes into the
// `out` it is given, so a frame reuses its arrays (no allocation in the frame).
export const DEG = Math.PI / 180;

export const mat4 = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

// a perspective projection with z mapped to [0, 1] (near → 0, far → 1), fovY in radians
export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = far / (near - far); out[11] = -1;
  out[14] = (near * far) / (near - far);
  return out;
}

// the same with reversed z (M2: near → 1, far → 0), for a float depth buffer cleared to 0 and compared 'greater'
export function perspectiveReversed(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  out.fill(0);
  out[0] = f / aspect; out[5] = f;
  out[10] = near / (far - near); out[11] = -1;
  out[14] = (near * far) / (far - near);
  return out;
}

// a view matrix from eye, forward (unit) and world up
export function lookDir(out, eye, fwd, up = [0, 1, 0]) {
  const fx = fwd[0], fy = fwd[1], fz = fwd[2];
  let rx = fy * up[2] - fz * up[1], ry = fz * up[0] - fx * up[2], rz = fx * up[1] - fy * up[0];
  const rl = Math.hypot(rx, ry, rz) || 1; rx /= rl; ry /= rl; rz /= rl;
  const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
  out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * eye[0] + ry * eye[1] + rz * eye[2]);
  out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * eye[0] + uy * eye[1] + uz * eye[2]);
  out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = fx * eye[0] + fy * eye[1] + fz * eye[2];
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

export function multiply(out, a, b) {   // out = a × b
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    out[c * 4 + r] = s;
  }
  return out;
}

export function invert(out, m) {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3], a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11], a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return out;
}

// a unit forward vector from a compass yaw (deg, 0 = north = −z, 90 = east = +x) and a pitch (deg, + up)
export function forwardOf(out, yawDeg, pitchDeg) {
  const y = yawDeg * DEG, p = pitchDeg * DEG, c = Math.cos(p);
  out[0] = Math.sin(y) * c; out[1] = Math.sin(p); out[2] = -Math.cos(y) * c;
  return out;
}
